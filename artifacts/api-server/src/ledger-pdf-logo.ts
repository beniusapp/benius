import { constants as fsConstants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import sharp from "sharp";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_LOGO_PIXELS = 4_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_ADAM7_PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function pngCrc32(type: Buffer, data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of type) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function expectedPngDataLength(
  width: number,
  height: number,
  bitsPerPixel: number,
  interlace: number,
): number | null {
  const passes = interlace === 0 ? [[0, 0, 1, 1]] : PNG_ADAM7_PASSES;
  let total = 0;
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
    const passHeight = height <= startY ? 0 : Math.ceil((height - startY) / stepY);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8);
    total += (rowBytes + 1) * passHeight;
    if (!Number.isSafeInteger(total) || total > MAX_LOGO_PIXELS * 8 + height * 7 + 8) {
      return null;
    }
  }
  return total > 0 ? total : null;
}

function validPng(buffer: Buffer): boolean {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;

  let offset = 8;
  let header: {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    interlace: number;
  } | null = null;
  let sawPalette = false;
  let sawIdat = false;
  let idatEnded = false;
  let sawIend = false;
  let idatBytes = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) return false;
    const chunkLength = buffer.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) return false;

    const type = buffer.subarray(offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type.toString("ascii")) || (type[2] & 0x20) !== 0) return false;
    const typeName = type.toString("ascii");
    const chunkData = buffer.subarray(dataStart, dataEnd);
    if (buffer.readUInt32BE(dataEnd) !== pngCrc32(type, chunkData)) return false;

    if (header === null) {
      if (offset !== 8 || typeName !== "IHDR" || chunkLength !== 13) return false;
      const width = chunkData.readUInt32BE(0);
      const height = chunkData.readUInt32BE(4);
      const bitDepth = chunkData[8];
      const colorType = chunkData[9];
      const interlace = chunkData[12];
      const validDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        width === 0 ||
        height === 0 ||
        width * height > MAX_LOGO_PIXELS ||
        !validDepths[colorType]?.includes(bitDepth) ||
        chunkData[10] !== 0 ||
        chunkData[11] !== 0 ||
        (interlace !== 0 && interlace !== 1)
      ) {
        return false;
      }
      header = { width, height, bitDepth, colorType, interlace };
    } else if (typeName === "IHDR") {
      return false;
    }

    if (sawIdat && typeName !== "IDAT") idatEnded = true;
    if (typeName === "PLTE") {
      if (sawPalette || sawIdat || chunkLength === 0 || chunkLength > 768 || chunkLength % 3 !== 0) {
        return false;
      }
      sawPalette = true;
    } else if (typeName === "IDAT") {
      if (idatEnded) return false;
      sawIdat = true;
      idatBytes += chunkData.length;
      if (idatBytes > MAX_LOGO_BYTES) return false;
      idatChunks.push(chunkData);
    } else if (typeName === "IEND") {
      if (chunkLength !== 0 || !sawIdat || chunkEnd !== buffer.length) return false;
      sawIend = true;
      offset = chunkEnd;
      break;
    } else if (!["IHDR", "PLTE"].includes(typeName) && (type[0] & 0x20) === 0) {
      return false;
    }
    offset = chunkEnd;
  }

  if (!header || !sawIdat || !sawIend || (header.colorType === 3 && !sawPalette)) return false;
  const channelCount: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const expectedLength = expectedPngDataLength(
    header.width,
    header.height,
    channelCount[header.colorType] * header.bitDepth,
    header.interlace,
  );
  if (!expectedLength) return false;

  try {
    const compressed = Buffer.concat(idatChunks, idatBytes);
    const inflated = inflateSync(compressed, {
      maxOutputLength: expectedLength + 1,
      info: true,
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (
      inflated.buffer.length !== expectedLength ||
      inflated.engine.bytesWritten !== compressed.length
    ) {
      return false;
    }

    let dataOffset = 0;
    const passes = header.interlace === 0 ? [[0, 0, 1, 1]] : PNG_ADAM7_PASSES;
    for (const [startX, startY, stepX, stepY] of passes) {
      const passWidth = header.width <= startX ? 0 : Math.ceil((header.width - startX) / stepX);
      const passHeight = header.height <= startY ? 0 : Math.ceil((header.height - startY) / stepY);
      if (passWidth === 0 || passHeight === 0) continue;
      const rowBytes = Math.ceil((passWidth * channelCount[header.colorType] * header.bitDepth) / 8);
      for (let row = 0; row < passHeight; row += 1) {
        if (inflated.buffer[dataOffset] > 4) return false;
        dataOffset += rowBytes + 1;
      }
    }
    return dataOffset === inflated.buffer.length;
  } catch {
    return false;
  }
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    marker === 0xc0 ||
    marker === 0xc1 ||
    marker === 0xc2 ||
    marker === 0xc3 ||
    marker === 0xc5 ||
    marker === 0xc6 ||
    marker === 0xc7 ||
    marker === 0xc9 ||
    marker === 0xca ||
    marker === 0xcb ||
    marker === 0xcd ||
    marker === 0xce ||
    marker === 0xcf
  );
}

function validJpegStructure(buffer: Buffer): boolean {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[buffer.length - 2] !== 0xff ||
    buffer[buffer.length - 1] !== 0xd9
  ) {
    return false;
  }

  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return false;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return false;
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9) return sawFrame && sawScan && offset === buffer.length;
    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (marker === 0x01) continue;
    if (offset + 2 > buffer.length) return false;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return false;
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 8) return false;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width === 0 || height === 0 || width * height > MAX_LOGO_PIXELS) return false;
      sawFrame = true;
    }

    offset += segmentLength;
    if (marker !== 0xda) continue;
    if (!sawFrame) return false;
    sawScan = true;

    let foundNextMarker = false;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const markerOffset = offset;
      offset += 1;
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      if (offset >= buffer.length) return false;
      const scanMarker = buffer[offset];
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
        offset += 1;
        continue;
      }
      offset = markerOffset;
      foundNextMarker = true;
      break;
    }
    if (!foundNextMarker) return false;
  }
  return false;
}

function filenameForSchool(storedPath: unknown, schoolId: number): string | null {
  if (typeof storedPath !== "string" || !Number.isSafeInteger(schoolId) || schoolId <= 0) {
    return null;
  }
  const prefix = `/uploads/schools/${schoolId}/`;
  if (!storedPath.startsWith(prefix)) return null;
  const filename = storedPath.slice(prefix.length);
  return /^logo-(?:\d+|[a-f0-9]{24})\.(?:png|jpe?g)$/.test(filename) ? filename : null;
}

async function openChildDirectory(parent: FileHandle, child: string): Promise<FileHandle> {
  const fdPath = `/proc/self/fd/${parent.fd}/${child}`;
  return fs.open(fdPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
}

async function readBoundedImage(handle: FileHandle, expectedSize: number): Promise<Buffer | null> {
  const bytes = Buffer.allocUnsafe(MAX_LOGO_BYTES + 1);
  let total = 0;
  while (total < bytes.length) {
    const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  const afterRead = await handle.stat();
  if (
    total === 0 ||
    total > MAX_LOGO_BYTES ||
    total !== expectedSize ||
    afterRead.size !== expectedSize
  ) {
    return null;
  }
  return Buffer.from(bytes.subarray(0, total));
}

async function validImageContent(buffer: Buffer, filename: string): Promise<boolean> {
  const extension = path.extname(filename);
  const expectedFormat = extension === ".png" ? "png" : "jpeg";
  if (expectedFormat === "png" ? !validPng(buffer) : !validJpegStructure(buffer)) return false;

  try {
    const image = sharp(buffer, { limitInputPixels: MAX_LOGO_PIXELS, failOn: "error", sequentialRead: true });
    const metadata = await image.metadata();
    if (
      metadata.format !== expectedFormat ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_LOGO_PIXELS
    ) {
      return false;
    }
    await sharp(buffer, { limitInputPixels: MAX_LOGO_PIXELS, failOn: "error", sequentialRead: true }).stats();
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve only a server-generated logo path belonging to this school. The
 * optional root argument is a test seam; production callers use process.cwd()/uploads.
 */
export async function resolveLedgerPdfLogo(
  storedPath: unknown,
  schoolId: number,
  uploadsRoot = path.resolve(process.cwd(), "uploads"),
): Promise<Buffer | null> {
  const filename = filenameForSchool(storedPath, schoolId);
  if (
    !filename ||
    process.platform !== "linux" ||
    !fsConstants.O_NOFOLLOW ||
    !fsConstants.O_DIRECTORY
  ) {
    return null;
  }

  const handles: FileHandle[] = [];
  try {
    const uploads = await fs.open(
      path.resolve(uploadsRoot),
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    handles.push(uploads);

    const schools = await openChildDirectory(uploads, "schools");
    handles.push(schools);

    const schoolDirectory = await openChildDirectory(schools, String(schoolId));
    handles.push(schoolDirectory);

    const logo = await fs.open(
      `/proc/self/fd/${schoolDirectory.fd}/${filename}`,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    handles.push(logo);

    const stat = await logo.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_LOGO_BYTES) return null;
    const buffer = await readBoundedImage(logo, stat.size);
    if (!buffer || !(await validImageContent(buffer, filename))) return null;
    return buffer;
  } catch {
    return null;
  } finally {
    for (const handle of handles.reverse()) {
      await handle.close().catch(() => undefined);
    }
  }
}
