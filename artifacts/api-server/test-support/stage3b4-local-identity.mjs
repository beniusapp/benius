import { readFileSync, realpathSync, lstatSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const TEST_URL_ENV = "BENIUS_STAGE3B4_TEST_DATABASE_URL";
const BASE_PREFIX = "/tmp/benius-stage3b4.";
const DATABASE_NAME = "benius_stage3b4_test";
const ROLE_NAME = "benius_stage3b4_test";
const MARKER_SCHEMA = "stage3b4_meta";
const MARKER_TABLE = "cluster_identity";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(message) {
  throw new Error(message);
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail("Invalid Stage 3B-4 test database URL encoding.");
  }
}

function validateMetadataShape(metadata, metadataPath) {
  if (!metadata || typeof metadata !== "object") {
    fail("Invalid Stage 3B-4 local cluster metadata.");
  }

  const baseDirectory = metadata.baseDirectory;
  if (
    typeof baseDirectory !== "string" ||
    !/^\/tmp\/benius-stage3b4\.[A-Za-z0-9]+$/.test(baseDirectory) ||
    path.dirname(baseDirectory) !== "/tmp" ||
    path.basename(baseDirectory) === ""
  ) {
    fail("Stage 3B-4 metadata does not identify an approved temporary cluster.");
  }

  let realBase;
  let realMetadata;
  try {
    if (lstatSync(baseDirectory).isSymbolicLink()) {
      fail("Stage 3B-4 temporary cluster path must not be a symbolic link.");
    }
    realBase = realpathSync(baseDirectory);
    realMetadata = realpathSync(metadataPath);
  } catch {
    fail("Stage 3B-4 local cluster metadata or directory is unavailable.");
  }

  if (
    realBase !== baseDirectory ||
    path.dirname(realMetadata) !== realBase ||
    metadata.dataDirectory !== path.join(realBase, "data") ||
    metadata.socketDirectory !== path.join(realBase, "socket") ||
    !Number.isInteger(metadata.port) ||
    metadata.port < 1 ||
    metadata.port > 65535 ||
    metadata.databaseName !== DATABASE_NAME ||
    metadata.roleName !== ROLE_NAME ||
    typeof metadata.clusterId !== "string" ||
    !UUID_PATTERN.test(metadata.clusterId) ||
    typeof metadata.markerKey !== "string" ||
    !UUID_PATTERN.test(metadata.markerKey)
  ) {
    fail("Stage 3B-4 local cluster metadata failed validation.");
  }

  try {
    const dataDirectory = path.join(realBase, "data");
    const socketDirectory = path.join(realBase, "socket");
    if (
      lstatSync(dataDirectory).isSymbolicLink() ||
      lstatSync(socketDirectory).isSymbolicLink() ||
      readFileSync(path.join(dataDirectory, "PG_VERSION"), "utf8").trim() !== "16"
    ) {
      fail("Stage 3B-4 cluster is not PostgreSQL 16.");
    }
    if (
      !lstatSync(dataDirectory).isDirectory() ||
      !lstatSync(socketDirectory).isDirectory()
    ) {
      fail("Stage 3B-4 data and socket paths must be directories.");
    }
  } catch {
    fail("Stage 3B-4 PostgreSQL data or socket directory failed validation.");
  }

  return metadata;
}

export function loadStage3B4Metadata(metadataPath) {
  if (typeof metadataPath !== "string" || metadataPath.length === 0) {
    fail("A Stage 3B-4 metadata path is required.");
  }

  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    fail("Unable to read Stage 3B-4 local cluster metadata.");
  }

  return validateMetadataShape(metadata, metadataPath);
}

export function validateStage3B4TestUrl(connectionString, metadata) {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    fail(`${TEST_URL_ENV} is required; refusing to continue.`);
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    fail(`${TEST_URL_ENV} is malformed; refusing to continue.`);
  }

  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "localhost" ||
    url.port !== String(metadata.port) ||
    decode(url.username) !== metadata.roleName ||
    decode(url.password).trim() === "" ||
    decode(url.pathname.slice(1)) !== metadata.databaseName ||
    url.hash !== ""
  ) {
    fail(`${TEST_URL_ENV} does not identify the approved local test database.`);
  }

  const queryEntries = [...url.searchParams.entries()];
  if (
    queryEntries.length !== 1 ||
    queryEntries[0][0] !== "host" ||
    queryEntries[0][1] !== metadata.socketDirectory
  ) {
    fail(`${TEST_URL_ENV} must use the approved local Unix socket.`);
  }

  return {
    host: metadata.socketDirectory,
    port: metadata.port,
    database: metadata.databaseName,
    user: metadata.roleName,
    password: decode(url.password),
  };
}

export async function verifyStage3B4LocalIdentity({
  env = process.env,
  metadataPath,
} = {}) {
  const metadata = loadStage3B4Metadata(metadataPath);
  const connection = validateStage3B4TestUrl(env[TEST_URL_ENV], metadata);
  const client = new Client({
    ...connection,
    connectionTimeoutMillis: 2500,
    query_timeout: 2500,
    application_name: "beni-us-stage3b4-identity-check",
  });

  try {
    await client.connect();
    const serverResult = await client.query(`
      SELECT
        current_database() AS database_name,
        current_user AS role_name,
        current_setting('cluster_name') AS cluster_id,
        current_setting('unix_socket_directories') AS socket_directory,
        current_setting('port')::integer AS port,
        current_setting('listen_addresses') AS listen_addresses,
        inet_server_addr() IS NULL AS unix_socket
    `);
    const markerResult = await client.query(
      `SELECT marker_key, cluster_id, database_name, role_name, socket_directory, port
       FROM ${MARKER_SCHEMA}.${MARKER_TABLE}
       WHERE marker_key = $1`,
      [metadata.markerKey],
    );

    const server = serverResult.rows[0];
    const marker = markerResult.rows[0];
    if (
      !server ||
      !marker ||
      server.database_name !== metadata.databaseName ||
      server.role_name !== metadata.roleName ||
      server.cluster_id !== metadata.clusterId ||
      server.socket_directory !== metadata.socketDirectory ||
      Number(server.port) !== metadata.port ||
      server.listen_addresses !== "" ||
      server.unix_socket !== true ||
      marker.marker_key !== metadata.markerKey ||
      marker.cluster_id !== metadata.clusterId ||
      marker.database_name !== metadata.databaseName ||
      marker.role_name !== metadata.roleName ||
      marker.socket_directory !== metadata.socketDirectory ||
      Number(marker.port) !== metadata.port
    ) {
      fail("The connected PostgreSQL server does not match the approved local cluster.");
    }

    return {
      databaseName: metadata.databaseName,
      roleName: metadata.roleName,
      clusterId: metadata.clusterId,
      socketDirectory: metadata.socketDirectory,
      port: metadata.port,
      unixSocketOnly: true,
      markerVerified: true,
    };
  } catch {
    fail("Stage 3B-4 local database identity verification failed; connection details were suppressed.");
  } finally {
    await client.end().catch(() => {});
  }
}
