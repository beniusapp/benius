import { storage } from "./storage";

export async function syncGoogleCalendarForSchool(
  schoolId: number,
  calendarId: string,
  apiKey: string
): Promise<{ count: number; error?: string }> {
  const now = new Date();
  const timeMin = new Date(now.getFullYear() - 1, 0, 1).toISOString();
  const timeMax = new Date(now.getFullYear() + 3, 11, 31).toISOString();
  const url = [
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    `?key=${apiKey}`,
    `&singleEvents=true`,
    `&maxResults=2500`,
    `&timeMin=${encodeURIComponent(timeMin)}`,
    `&timeMax=${encodeURIComponent(timeMax)}`,
    `&orderBy=startTime`,
  ].join("");

  let gcalRes: Response;
  try {
    gcalRes = await fetch(url);
  } catch {
    return { count: 0, error: "Failed to reach Google Calendar API" };
  }

  if (!gcalRes.ok) {
    let errMsg = `Google API error ${gcalRes.status}`;
    try {
      const errBody = await gcalRes.json() as any;
      errMsg = errBody?.error?.message || errMsg;
    } catch {}
    return { count: 0, error: errMsg };
  }

  const data = await gcalRes.json() as any;
  const googleEvents: any[] = data.items || [];

  const entries: {
    schoolId: number; title: string; description: string | null;
    eventType: string; venue: string; colorCode: string; isRecurring: boolean; date: string;
  }[] = [];

  for (const gEvent of googleEvents) {
    const startDateStr: string | undefined = gEvent.start?.date || gEvent.start?.dateTime?.split("T")[0];
    const endDateStr: string | undefined = gEvent.end?.date || gEvent.end?.dateTime?.split("T")[0];
    if (!startDateStr) continue;

    const title = (gEvent.summary as string | undefined) || "Untitled Event";
    const description = (gEvent.description as string | undefined) || null;
    const isAllDay = !!gEvent.start?.date;

    const text = (title + " " + (description || "")).toLowerCase();
    let eventType = "event";
    if (/holiday|vacation|break|diwali|christmas|eid|holi|pongal|navratri|independence|republic|gandhi|guru nanak|deepavali/.test(text)) {
      eventType = "holiday";
    } else if (/exam|test|assessment|quiz|board|final|mid.?term|unit test|viva|evaluation/.test(text)) {
      eventType = "examination";
    } else if (/class|lecture|academic|school day|study|curriculum|workshop|seminar|orientation|ptm|parent/.test(text)) {
      eventType = "academic";
    }

    const colorCode = eventType === "holiday" ? "#ef4444"
      : eventType === "examination" ? "#8b5cf6"
      : eventType === "academic" ? "#3b82f6"
      : "#10b981";

    const startD = new Date(startDateStr + "T00:00:00");
    const limit = isAllDay && endDateStr
      ? new Date(endDateStr + "T00:00:00")
      : new Date(startD.getTime() + 86400000);

    for (let d = new Date(startD); d < limit; d.setDate(d.getDate() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      entries.push({
        schoolId, title,
        description: description ? description.slice(0, 500) : null,
        eventType, venue: "gcal-sync", colorCode, isRecurring: false, date: dateStr,
      });
    }
  }

  await storage.deleteGoogleSyncedCalendarEvents(schoolId);
  if (entries.length > 0) await storage.createCalendarEvents(entries);

  await storage.setSchoolMetadataRaw(schoolId, "google_calendar_last_sync", {
    syncedAt: new Date().toISOString(),
    count: entries.length,
  });

  return { count: entries.length };
}
