import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { resolveLedgerPdfLogo } from "./ledger-pdf-logo";
import { renderLedgerPdf } from "./ledger-pdf";

const SCHOOL_ID = 314;
const PNG_PATH = `/uploads/schools/${SCHOOL_ID}/logo-1760000000000.png`;
const JPEG_PATH = `/uploads/schools/${SCHOOL_ID}/logo-0123456789abcdef01234567.jpg`;

async function createFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ledger-logo-test-"));
  const uploadsRoot = path.join(directory, "uploads");
  const schoolDirectory = path.join(uploadsRoot, "schools", String(SCHOOL_ID));
  await mkdir(schoolDirectory, { recursive: true });
  return {
    directory,
    uploadsRoot,
    schoolDirectory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function createPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: { r: 17, g: 93, b: 154, alpha: 1 },
    },
  }).png().toBuffer();
}

async function createJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 17, g: 93, b: 154 },
    },
  }).jpeg().toBuffer();
}

async function storeLogo(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  storedPath: string,
  bytes: Buffer,
): Promise<string> {
  const filename = path.posix.basename(storedPath);
  await writeFile(path.join(fixture.schoolDirectory, filename), bytes);
  return storedPath;
}

function pdfInput(logoData: Buffer | null) {
  return {
    school: {
      name: "Synthetic School",
      logoData,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      pinCode: null,
      phone: null,
      email: null,
    },
    sessionLabel: "2026–2027",
    filters: {},
    rows: [],
    generatedAtIST: "10 Oct 2026, 10:00 AM IST",
  };
}

test("valid locally uploaded PNG and JPEG logos resolve only from the matching school directory", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const png = await createPng();
  const jpeg = await createJpeg();
  await storeLogo(fixture, PNG_PATH, png);
  await storeLogo(fixture, JPEG_PATH, jpeg);

  assert.deepEqual(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), png);
  assert.deepEqual(await resolveLedgerPdfLogo(JPEG_PATH, SCHOOL_ID, fixture.uploadsRoot), jpeg);
  assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID + 1, fixture.uploadsRoot), null);
});

test("missing logo values and missing local files return no logo", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  assert.equal(await resolveLedgerPdfLogo(null, SCHOOL_ID, fixture.uploadsRoot), null);
  assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);
});

test("rejects external, internal, protocol-relative, traversal, malformed, and unsupported paths without network access", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  let networkCalls = 0;
  const originalHttpGet = http.get;
  const originalHttpsGet = https.get;
  http.get = ((..._args: Parameters<typeof http.get>) => {
    networkCalls += 1;
    throw new Error("network access must not occur");
  }) as typeof http.get;
  https.get = ((..._args: Parameters<typeof https.get>) => {
    networkCalls += 1;
    throw new Error("network access must not occur");
  }) as typeof https.get;

  try {
    const rejectedPaths = [
      "https://example.invalid/logo.png",
      "http://example.invalid/logo.png",
      "http://127.0.0.1/logo.png",
      "http://10.0.0.1/logo.png",
      "http://localhost/logo.png",
      "//example.invalid/logo.png",
      "file:///etc/passwd",
      `/uploads/schools/${SCHOOL_ID}/%2e%2e/logo-1760000000000.png`,
      `/uploads/schools/${SCHOOL_ID}/../logo-1760000000000.png`,
      `/etc/passwd`,
      `/uploads/other/${SCHOOL_ID}/logo-1760000000000.png`,
      `/uploads/schools/${SCHOOL_ID}/logo-%ZZ.png`,
      `${PNG_PATH}?host=127.0.0.1`,
      `${PNG_PATH}#fragment`,
      `/uploads/schools/${SCHOOL_ID}/logo-1760000000000.webp`,
      `/uploads/schools/${SCHOOL_ID}\\logo-1760000000000.png`,
    ];
    for (const value of rejectedPaths) {
      assert.equal(await resolveLedgerPdfLogo(value, SCHOOL_ID, fixture.uploadsRoot), null, value);
    }
  } finally {
    http.get = originalHttpGet;
    https.get = originalHttpsGet;
  }
  assert.equal(networkCalls, 0);
});

test("rejects symlinked upload directories and symlinked logo files", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const outside = path.join(fixture.directory, "outside");
  await mkdir(outside);
  const png = await createPng();
  await writeFile(path.join(outside, path.posix.basename(PNG_PATH)), png);

  await rm(path.join(fixture.uploadsRoot, "schools"), { recursive: true });
  await symlink(outside, path.join(fixture.uploadsRoot, "schools"));
  assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);

  await rm(path.join(fixture.uploadsRoot, "schools"));
  await mkdir(path.join(fixture.uploadsRoot, "schools"));
  await symlink(outside, path.join(fixture.uploadsRoot, "schools", String(SCHOOL_ID)));
  assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);

  await rm(path.join(fixture.uploadsRoot, "schools"), { recursive: true });
  await mkdir(fixture.schoolDirectory, { recursive: true });
  await symlink(path.join(outside, path.posix.basename(PNG_PATH)), path.join(fixture.schoolDirectory, path.posix.basename(PNG_PATH)));
  assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);
});

test("rejects directories, oversized files, unsupported content, and extension/content mismatches", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  const directoryPath = path.join(fixture.schoolDirectory, path.posix.basename(PNG_PATH));
  await mkdir(directoryPath);
  assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);
  await rm(directoryPath, { recursive: true });

  await writeFile(directoryPath, Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);
  await rm(directoryPath);

  await writeFile(directoryPath, Buffer.from("not an image"));
  assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);
  await writeFile(directoryPath, await createJpeg());
  assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);
});

test("rejects corrupt or truncated PNG/JPEG content", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const png = await createPng();
  const jpeg = await createJpeg();
  const corruptPng = Buffer.from(png);
  corruptPng[corruptPng.length - 1] ^= 0xff;
  const truncatedPng = png.subarray(0, png.length - 12);
  const truncatedJpeg = jpeg.subarray(0, jpeg.length - 2);

  for (const bytes of [corruptPng, truncatedPng]) {
    await writeFile(path.join(fixture.schoolDirectory, path.posix.basename(PNG_PATH)), bytes);
    assert.equal(await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);
  }
  await writeFile(path.join(fixture.schoolDirectory, path.posix.basename(JPEG_PATH)), truncatedJpeg);
  assert.equal(await resolveLedgerPdfLogo(JPEG_PATH, SCHOOL_ID, fixture.uploadsRoot), null);
});

test("Ledger PDF renders with a validated logo and continues without missing or unsafe logos", async () => {
  const fixture = await createFixture();
  try {
    const png = await createPng();
    const jpeg = await createJpeg();
    await storeLogo(fixture, PNG_PATH, png);
    await storeLogo(fixture, JPEG_PATH, jpeg);
    const resolved = await resolveLedgerPdfLogo(PNG_PATH, SCHOOL_ID, fixture.uploadsRoot);
    const resolvedJpeg = await resolveLedgerPdfLogo(JPEG_PATH, SCHOOL_ID, fixture.uploadsRoot);
    assert.ok(resolved);
    assert.ok(resolvedJpeg);
    for (const logo of [resolved, resolvedJpeg]) {
      const withLogo = await renderLedgerPdf(pdfInput(logo));
      assert.equal(withLogo.subarray(0, 5).toString("ascii"), "%PDF-");
      assert.match(withLogo.toString("latin1"), /\/Subtype\s*\/Image/);
    }

    const noLogo = await renderLedgerPdf(pdfInput(null));
    assert.equal(noLogo.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.doesNotMatch(noLogo.toString("latin1"), /\/Subtype\s*\/Image/);

    const unsafe = await resolveLedgerPdfLogo("https://127.0.0.1/logo.png", SCHOOL_ID, fixture.uploadsRoot);
    const unsafePdf = await renderLedgerPdf(pdfInput(unsafe));
    assert.equal(unsafePdf.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.doesNotMatch(unsafePdf.toString("latin1"), /\/Subtype\s*\/Image/);
  } finally {
    await fixture.cleanup();
  }
});
