import assert from "node:assert/strict";
import {
  loadStage3B4Metadata,
  validateStage3B4TestUrl,
  verifyStage3B4LocalIdentity,
} from "./stage3b4-local-identity.mjs";

const usage =
  "Usage: stage3b4-b1-runner.mjs --self-test | --verify-isolation --metadata <path>";

function syntheticMetadata() {
  return {
    baseDirectory: "/tmp/benius-stage3b4.synthetic",
    dataDirectory: "/tmp/benius-stage3b4.synthetic/data",
    socketDirectory: "/tmp/benius-stage3b4.synthetic/socket",
    port: 55432,
    databaseName: "benius_stage3b4_test",
    roleName: "benius_stage3b4_test",
    clusterId: "123e4567-e89b-42d3-a456-426614174000",
    markerKey: "123e4567-e89b-42d3-a456-426614174001",
  };
}

function syntheticUrl(metadata) {
  const socket = encodeURIComponent(metadata.socketDirectory);
  return `postgresql://${metadata.roleName}:synthetic-only-password@localhost:${metadata.port}/${metadata.databaseName}?host=${socket}`;
}

function runSelfTests() {
  const expected = syntheticMetadata();
  const goodUrl = syntheticUrl(expected);
  assert.equal(
    validateStage3B4TestUrl(goodUrl, expected).host,
    expected.socketDirectory,
  );
  assert.throws(() => validateStage3B4TestUrl(undefined, expected), /required/);
  assert.throws(() => validateStage3B4TestUrl("", expected), /required/);
  assert.throws(
    () => validateStage3B4TestUrl(goodUrl.replace("@localhost:", "@remote.example:"), expected),
    /does not identify/,
  );
  assert.throws(
    () => validateStage3B4TestUrl(goodUrl.replace(":55432/", ":55433/"), expected),
    /does not identify/,
  );
  assert.throws(
    () => validateStage3B4TestUrl(goodUrl.replace("/benius_stage3b4_test?", "/other_db?"), expected),
    /does not identify/,
  );
  assert.throws(
    () => validateStage3B4TestUrl(goodUrl.replace("benius_stage3b4_test:synthetic", "other_role:synthetic"), expected),
    /does not identify/,
  );
  assert.throws(
    () => validateStage3B4TestUrl(goodUrl.replace("synthetic-only-password", ""), expected),
    /does not identify/,
  );
  assert.throws(
    () =>
      validateStage3B4TestUrl(
        goodUrl.replace(encodeURIComponent(expected.socketDirectory), encodeURIComponent("/tmp/other/socket")),
        expected,
      ),
    /approved local Unix socket/,
  );
  assert.throws(
    () => loadStage3B4Metadata("/tmp/benius-stage3b4-does-not-exist/identity.json"),
    /Unable to read/,
  );

  console.log("PASS: Stage 3B-4 guard accepts only the synthetic expected local URL shape.");
  console.log("PASS: missing, malformed, remote, wrong-port, wrong-database, wrong-role, and wrong-socket cases are rejected without connecting.");
  console.log("PASS: metadata absence is rejected.");
}

async function main() {
  const [action, ...args] = process.argv.slice(2);

  if (action === "--self-test" && args.length === 0) {
    runSelfTests();
    return;
  }

  if (action === "--verify-isolation") {
    const metadataIndex = args.indexOf("--metadata");
    const metadataPath = metadataIndex >= 0 ? args[metadataIndex + 1] : undefined;
    if (!metadataPath || args.length !== 2 || metadataIndex !== 0) {
      throw new Error(usage);
    }
    const identity = await verifyStage3B4LocalIdentity({ metadataPath });
    console.log("PASS: dedicated PostgreSQL identity and local-only socket verified.");
    console.log(
      JSON.stringify({
        databaseName: identity.databaseName,
        roleName: identity.roleName,
        clusterId: identity.clusterId,
        socketDirectory: identity.socketDirectory,
        port: identity.port,
        unixSocketOnly: identity.unixSocketOnly,
        markerVerified: identity.markerVerified,
      }),
    );
    return;
  }

  throw new Error(
    "REFUSED: Phase B1 permits isolation verification only. This runner never executes Examination database tests; Phase B2 requires separate owner approval.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Stage 3B-4 runner refused.");
  process.exitCode = 2;
});
