import express from "express";
import http from "http";

import { registerFeesRoutes } from "../../server/fees-routes";
import { checkSessionContext } from "../../server/routes";

const SCHOOL_ID = 1;
const SESSION_ID = 42;
const OUTPUT_DIR = ".agents/outputs/financial-analytics-pdf-audit/api";

const requests = {
  today: "?preset=today",
  this_week: "?preset=this_week",
  this_month: "?preset=this_month",
  academic_year: "?preset=academic_year",
  custom: "?preset=custom&startDate=2026-06-01&endDate=2026-08-23",
};

async function main() {
  const app = express();
  app.use((req: any, _res, next) => {
    req.session = { userId: 1, userRole: "admin", schoolId: SCHOOL_ID };
    next();
  });
  app.use(checkSessionContext);
  registerFeesRoutes(app);

  const server = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Audit server did not expose a TCP port.");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(OUTPUT_DIR, { recursive: true }));

    for (const [name, query] of Object.entries(requests)) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/fees/analytics${query}`, {
        headers: { "x-view-session-id": String(SESSION_ID) },
      });
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}: ${await response.text()}`);
      const payload = await response.json();
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(`${OUTPUT_DIR}/${name}.json`, `${JSON.stringify(payload, null, 2)}\n`),
      );
      console.log(`${name}: ${payload.filter.startDate}..${payload.filter.endDate}`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});