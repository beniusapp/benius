import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, ChevronRight, Calendar, CalendarDays, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface CalendarEventEntry {
  id: number;
  title: string;
  date: string;
  eventType: string;
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayNamesFull = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type ViewMode = "month" | "week";

function getEventColor(eventType: string) {
  switch (eventType) {
    case "holiday":
      return {
        bg: "bg-red-100 dark:bg-red-900/40",
        text: "text-red-700 dark:text-red-300",
        dot: "bg-red-500",
        border: "border-red-200 dark:border-red-800",
        label: "Holiday",
      };
    case "academic":
      return {
        bg: "bg-blue-100 dark:bg-blue-900/40",
        text: "text-blue-700 dark:text-blue-300",
        dot: "bg-blue-500",
        border: "border-blue-200 dark:border-blue-800",
        label: "Academic",
      };
    case "event":
      return {
        bg: "bg-green-100 dark:bg-green-900/40",
        text: "text-green-700 dark:text-green-300",
        dot: "bg-green-500",
        border: "border-green-200 dark:border-green-800",
        label: "Event",
      };
    default:
      return {
        bg: "bg-muted",
        text: "text-muted-foreground",
        dot: "bg-muted-foreground",
        border: "border-muted",
        label: eventType,
      };
  }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function getDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isToday(year: number, month: number, day: number) {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day;
}

function getWeekDates(date: Date): Date[] {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function EventPopover({ event }: { event: CalendarEventEntry }) {
  const color = getEventColor(event.eventType);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`w-full text-left px-1.5 py-0.5 rounded-md text-[11px] truncate cursor-pointer ${color.bg} ${color.text} border ${color.border}`}
          data-testid={`button-event-${event.id}`}
        >
          {event.title}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" side="top" align="start">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="font-semibold text-sm" data-testid={`text-event-title-${event.id}`}>
              {event.title}
            </h4>
            <Badge variant="secondary" className={`${color.bg} ${color.text} text-[10px]`} data-testid={`badge-event-type-${event.id}`}>
              {color.label}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="w-3.5 h-3.5" />
            <span data-testid={`text-event-date-${event.id}`}>{formatDate(event.date)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${color.dot}`} />
            <span className={`text-xs ${color.text}`}>{color.label}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function CalendarModule({ teacher }: { teacher: TeacherMe }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [weekDate, setWeekDate] = useState(new Date());

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
    events.forEach((e) => {
      const d = e.date.split("T")[0];
      if (!map[d]) map[d] = [];
      map[d].push(e);
    });
    return map;
  }, [events]);

  const weekDates = useMemo(() => getWeekDates(weekDate), [weekDate]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function prevWeek() {
    setWeekDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() - 7);
      return nd;
    });
  }

  function nextWeek() {
    setWeekDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() + 7);
      return nd;
    });
  }

  function goToToday() {
    const today = new Date();
    setMonth(today.getMonth());
    setYear(today.getFullYear());
    setWeekDate(today);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive" data-testid="text-calendar-error">
          Failed to load calendar events. Please try again later.
        </CardContent>
      </Card>
    );
  }

  const weekRangeLabel = weekDates.length > 0
    ? `${weekDates[0].getDate()} ${monthNames[weekDates[0].getMonth()].slice(0, 3)} – ${weekDates[6].getDate()} ${monthNames[weekDates[6].getMonth()].slice(0, 3)} ${weekDates[6].getFullYear()}`
    : "";

  return (
    <div className="space-y-4">
      <Card className="backdrop-blur-sm bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={viewMode === "month" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("month")}
                data-testid="button-view-month"
              >
                <Calendar className="w-4 h-4 mr-1.5" />
                Month
              </Button>
              <Button
                variant={viewMode === "week" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("week")}
                data-testid="button-view-week"
              >
                <CalendarDays className="w-4 h-4 mr-1.5" />
                Week
              </Button>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={viewMode === "month" ? prevMonth : prevWeek}
                data-testid="button-prev-month"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <CardTitle className="text-base min-w-[180px] text-center" data-testid="text-calendar-title">
                {viewMode === "month" ? `${monthNames[month]} ${year}` : weekRangeLabel}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={viewMode === "month" ? nextMonth : nextWeek}
                data-testid="button-next-month"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>

            <Button variant="outline" size="sm" onClick={goToToday} data-testid="button-today">
              Today
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="flex items-center gap-4 flex-wrap px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-xs text-muted-foreground">Holiday</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span className="text-xs text-muted-foreground">Academic</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="text-xs text-muted-foreground">Event</span>
        </div>
      </div>

      {viewMode === "month" ? (
        <Card className="backdrop-blur-sm bg-card/80">
          <CardContent className="p-3">
            <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
              {dayNames.map((d) => (
                <div
                  key={d}
                  className="bg-muted p-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
              {calendarDays.map((day, i) => {
                if (day === null) {
                  return <div key={`e-${i}`} className="bg-card p-2 min-h-[72px]" />;
                }
                const key = getDateKey(year, month, day);
                const dayEvents = eventsByDate[key] || [];
                const today = isToday(year, month, day);
                const hasHoliday = dayEvents.some((e) => e.eventType === "holiday");

                return (
                  <div
                    key={key}
                    className={`bg-card p-1.5 min-h-[72px] ${hasHoliday ? "bg-red-50/50 dark:bg-red-950/20" : ""} ${today ? "ring-2 ring-inset ring-primary/50" : ""}`}
                    data-testid={`cell-day-${day}`}
                  >
                    <span
                      className={`inline-flex items-center justify-center text-xs font-medium w-6 h-6 rounded-full ${today ? "bg-primary text-primary-foreground" : ""} ${hasHoliday && !today ? "text-red-600 dark:text-red-400" : ""}`}
                      data-testid={`text-day-number-${day}`}
                    >
                      {day}
                    </span>
                    <div className="mt-0.5 space-y-0.5">
                      {dayEvents.slice(0, 2).map((ev) => (
                        <EventPopover key={ev.id} event={ev} />
                      ))}
                      {dayEvents.length > 2 && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              className="w-full text-left px-1.5 py-0.5 rounded-md text-[10px] text-muted-foreground cursor-pointer hover-elevate"
                              data-testid={`button-more-events-${day}`}
                            >
                              +{dayEvents.length - 2} more
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-56 p-2" side="bottom" align="start">
                            <div className="space-y-1">
                              {dayEvents.slice(2).map((ev) => {
                                const c = getEventColor(ev.eventType);
                                return (
                                  <div
                                    key={ev.id}
                                    className={`px-2 py-1 rounded-md text-xs ${c.bg} ${c.text}`}
                                  >
                                    {ev.title}
                                  </div>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="backdrop-blur-sm bg-card/80">
          <CardContent className="p-3">
            <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden">
              {weekDates.map((d, idx) => {
                const dayKey = getDateKey(d.getFullYear(), d.getMonth(), d.getDate());
                const dayEvents = eventsByDate[dayKey] || [];
                const today = isToday(d.getFullYear(), d.getMonth(), d.getDate());
                const hasHoliday = dayEvents.some((e) => e.eventType === "holiday");

                return (
                  <div key={dayKey} className="flex flex-col">
                    <div
                      className={`bg-muted p-2 text-center ${today ? "bg-primary/10" : ""}`}
                    >
                      <div className="text-[10px] font-medium text-muted-foreground uppercase">
                        {dayNames[idx]}
                      </div>
                      <div
                        className={`text-sm font-semibold mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-full ${today ? "bg-primary text-primary-foreground" : ""}`}
                        data-testid={`text-week-day-${d.getDate()}`}
                      >
                        {d.getDate()}
                      </div>
                    </div>
                    <div
                      className={`bg-card p-1.5 min-h-[200px] space-y-1 ${hasHoliday ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}
                      data-testid={`cell-week-day-${idx}`}
                    >
                      {dayEvents.map((ev) => (
                        <EventPopover key={ev.id} event={ev} />
                      ))}
                      {dayEvents.length === 0 && (
                        <div className="text-[10px] text-muted-foreground/50 text-center pt-4">
                          No events
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
