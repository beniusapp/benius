import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@shared": path.resolve(root, "src/shared"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/pages/__tests__/student-dashboard-navigation.test.tsx"],
    testTimeout: 8000,
  },
});
