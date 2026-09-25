---
name: API TypeScript test runner
description: Runtime constraints for executing API server TypeScript tests in this workspace.
---

Node 20 cannot execute the API server's TypeScript tests directly, and the API package does not include a TypeScript runtime loader. Bundle the test with the existing esbuild toolchain as CommonJS, then run the generated `.cjs` with `node --test`. Keep the bundle in CommonJS because Express dependencies use dynamic requires of Node built-ins that fail in an ESM bundle.

**Why:** The workspace build tooling can compile TypeScript, but a TypeScript test runner is not installed; ESM bundling a route test failed on a dynamic `require("tty")`, while the CommonJS bundle ran successfully.

**How to apply:** For API TypeScript tests, use the package's existing esbuild tooling to create an ignored CommonJS test bundle and execute it with Node's built-in test runner rather than adding a new runtime dependency.