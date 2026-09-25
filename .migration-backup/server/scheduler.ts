import { storage } from "./storage";
import { syncGoogleCalendarForSchool } from "./google-calendar-sync";

function fmt(label: string, msg: string) {
  const t = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  console.log(`${t} [scheduler] ${label}: ${msg}`);
}

function msUntil2AM(): number {
  const now = new Date();
  const next = new Date();
  next.setHours(2, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function runNightlySync() {
  fmt("gcal-auto-sync", "Starting nightly Google Calendar sync...");
  try {
    const schools = await storage.getSchoolsWithGoogleAutoSync();
    if (schools.length === 0) {
      fmt("gcal-auto-sync", "No schools with auto-sync enabled — skipping");
    } else {
      fmt("gcal-auto-sync", `Syncing ${schools.length} school(s)...`);
      for (const s of schools) {
        try {
          const result = await syncGoogleCalendarForSchool(s.schoolId, s.calendarId, s.apiKey);
          if (result.error) {
            fmt("gcal-auto-sync", `School ${s.schoolId} FAILED: ${result.error}`);
          } else {
            fmt("gcal-auto-sync", `School ${s.schoolId} OK: ${result.count} events imported`);
          }
        } catch (err) {
          fmt("gcal-auto-sync", `School ${s.schoolId} ERROR: ${String(err)}`);
        }
      }
    }
  } catch (err) {
    fmt("gcal-auto-sync", `Nightly sync error: ${String(err)}`);
  }

  scheduleNext();
}

function scheduleNext() {
  const delay = msUntil2AM();
  const h = Math.floor(delay / 3600000);
  const m = Math.floor((delay % 3600000) / 60000);
  fmt("gcal-auto-sync", `Next run scheduled in ${h}h ${m}m (2:00 AM)`);
  setTimeout(runNightlySync, delay);
}

export function initScheduler() {
  const delay = msUntil2AM();
  const h = Math.floor(delay / 3600000);
  const m = Math.floor((delay % 3600000) / 60000);
  fmt("gcal-auto-sync", `Scheduler initialized — first run at 2:00 AM (in ${h}h ${m}m)`);
  setTimeout(runNightlySync, delay);
}
