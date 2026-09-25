import path from "node:path";
import { fileURLToPath } from "node:url";

// The production command starts from the workspace root, while development
// starts from this artifact. The legacy upload handlers use process.cwd(), so
// set it before loading them to keep existing and new uploads in one place.
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

// Preserve the original BENIUS initialization, session, maintenance, and route order.
await import("./legacy-index");
