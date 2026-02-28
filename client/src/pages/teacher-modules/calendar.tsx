import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface CalendarEventEntry { id: number; title: string; date: string; eventType: string; }

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function CalendarModule({ teacher }: { teacher: TeacherMe }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const { data: events = [], isLoading, isError } = useQuery<CalendarEventEntry[]>({
    queryKey: ["/api/calendar", teacher.schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/calendar/${teacher.schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [month, year]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEventEntry[]> = {};
    events.forEach(e => {
      const d = e.date.split("T")[0];
      if (!map[d]) map[d] = [];
      map[d].push(e);
    });
    return map;
  }, [events]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function getDateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (isError) return <Card><CardContent className="py-8 text-center text-destructive" data-testid="text-calendar-error">Failed to load calendar events. Please try again later.</CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={prevMonth} data-testid="button-prev-month"><ChevronLeft className="w-5 h-5" /></Button>
          <CardTitle className="text-lg" data-testid="text-calendar-title">{monthNames[month]} {year}</CardTitle>
          <Button variant="ghost" size="icon" onClick={nextMonth} data-testid="button-next-month"><ChevronRight className="w-5 h-5" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
          {dayNames.map(d => (
            <div key={d} className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
          {calendarDays.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} className="bg-card p-2 min-h-[60px]" />;
            const key = getDateKey(day);
            const dayEvents = eventsByDate[key] || [];
            const hasHoliday = dayEvents.some(e => e.eventType === "holiday");
            const hasEvent = dayEvents.some(e => e.eventType === "event");
            return (
              <div
                key={key}
                className={`bg-card p-1.5 min-h-[60px] ${hasHoliday ? "bg-red-50 dark:bg-red-950/30" : ""}`}
                data-testid={`cell-day-${day}`}
              >
                <span className={`text-xs font-medium ${hasHoliday ? "text-red-600" : ""}`}>{day}</span>
                {dayEvents.map(ev => (
                  <div
                    key={ev.id}
                    className={`mt-0.5 px-1 py-0.5 rounded text-[10px] truncate ${ev.eventType === "holiday" ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"}`}
                    title={ev.title}
                  >
                    {ev.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
