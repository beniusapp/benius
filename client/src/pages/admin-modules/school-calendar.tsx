import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { fmtDateLong } from "@/lib/dateUtils";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, CalendarDays, Loader2,
  Calendar, Repeat, Flame, BookOpen, Award, Star, X, RefreshCw, Pencil,
  AlertTriangle, Users, BookMarked, Tag,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CalendarEvent {
  id: number;
  schoolId: number;
  title: string;
  date: string;
  eventType: string;
  venue: string | null;
  description: string | null;
  colorCode: string | null;
  isRecurring: boolean;
  audienceScope: string;
  targetClass: string | null;
  targetSection: string | null;
}

interface SchoolConfigData {
  classes: string[];
  sections: string[];
  subjects: string[];
  classSections: Record<string, string[]>;
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const EVENT_TYPES = [
  { value: "holiday", label: "Holiday", color: "#ef4444", icon: Flame },
  { value: "academic", label: "Academic", color: "#3b82f6", icon: BookOpen },
  { value: "examination", label: "Examination", color: "#3b82f6", icon: Award },
  { value: "event", label: "Event", color: "#10b981", icon: Star },
];

const YEAR_START = 2026;
const YEAR_END = 2126;
const YEARS = Array.from({ length: YEAR_END - YEAR_START + 1 }, (_, i) => YEAR_START + i);

function getEventColor(ev: CalendarEvent) {
  return ev.colorCode || EVENT_TYPES.find(t => t.value === ev.eventType)?.color || "#D4AF37";
}

function buildKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

const SELECT_CLS = "w-full bg-[#0A1628] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#D4AF37]/50 cursor-pointer [color-scheme:dark] appearance-none";
const INPUT_CLS  = "w-full bg-[#0A1628] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#D4AF37]/50";

const EMPTY_FORM = {
  title: "",
  description: "",
  eventType: "holiday",
  startDate: "",
  endDate: "",
  isRecurring: false,
  colorCode: "",
  targetClass: "",
  targetSection: "",
};

const EMPTY_EDIT = {
  title: "",
  description: "",
  eventType: "holiday",
  date: "",
  isRecurring: false,
  colorCode: "",
  targetClass: "",
  targetSection: "",
};

function invalidateAll() {
  queryClient.invalidateQueries({ queryKey: ["/api/admin/calendar"] });
  queryClient.invalidateQueries({ queryKey: ["/api/teacher/calendar"] });
  queryClient.invalidateQueries({ queryKey: ["/api/student/calendar"] });
}

function AudienceBadge({ ev }: { ev: CalendarEvent }) {
  if (ev.audienceScope === "Entire_Class") {
    return (
      <span className="ml-1 px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 text-[10px] normal-case font-medium">
        Class {ev.targetClass}
      </span>
    );
  }
  if (ev.audienceScope === "Specific_Section") {
    return (
      <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] normal-case font-medium">
        Class {ev.targetClass}-{ev.targetSection}
      </span>
    );
  }
  return (
    <span className="ml-1 px-1.5 py-0.5 rounded bg-white/5 text-white/30 text-[10px] normal-case">
      All School
    </span>
  );
}

function AudiencePicker({
  targeted, onToggle,
  targetClass, onClassChange,
  targetSection, onSectionChange,
  configClasses, getSectionsFor,
  testPrefix,
}: {
  targeted: boolean;
  onToggle: (val: boolean) => void;
  targetClass: string;
  onClassChange: (val: string) => void;
  targetSection: string;
  onSectionChange: (val: string) => void;
  configClasses: string[];
  getSectionsFor: (cls: string) => string[];
  testPrefix: string;
}) {
  const sectionOptions = targetClass ? getSectionsFor(targetClass) : [];

  return (
    <div>
      <label className="text-xs text-white/50 uppercase tracking-wide block mb-2">Audience</label>
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => onToggle(false)}
          data-testid={`${testPrefix}-scope-all`}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition-all ${
            !targeted
              ? "bg-[#D4AF37]/20 border-[#D4AF37]/50 text-[#D4AF37]"
              : "border-white/10 text-white/40 hover:text-white/60"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          All School
        </button>
        <button
          type="button"
          onClick={() => onToggle(true)}
          data-testid={`${testPrefix}-scope-targeted`}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition-all ${
            targeted
              ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
              : "border-white/10 text-white/40 hover:text-white/60"
          }`}
        >
          <BookMarked className="w-3.5 h-3.5" />
          Target Class
        </button>
      </div>

      {targeted && (
        <div className="space-y-2.5 p-3 bg-[#0A1628]/60 rounded-lg border border-white/5">
          <div>
            <label className="text-xs text-white/40 block mb-1">
              Class <span className="text-red-400">*</span>
            </label>
            {configClasses.length > 0 ? (
              <select
                value={targetClass}
                onChange={e => onClassChange(e.target.value)}
                className={SELECT_CLS}
                data-testid={`${testPrefix}-target-class`}
              >
                <option value="">— Select class —</option>
                {configClasses.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : (
              <input
                value={targetClass}
                onChange={e => onClassChange(e.target.value)}
                placeholder="e.g. 6"
                className={INPUT_CLS}
                data-testid={`${testPrefix}-target-class`}
              />
            )}
          </div>

          {targetClass && (
            <div>
              <label className="text-xs text-white/40 block mb-1 flex items-center gap-1.5">
                <Tag className="w-3 h-3" />
                Section
                <span className="text-white/25 font-normal">(optional — blank = entire class)</span>
              </label>
              {sectionOptions.length > 0 ? (
                <select
                  value={targetSection}
                  onChange={e => onSectionChange(e.target.value)}
                  className={SELECT_CLS}
                  data-testid={`${testPrefix}-target-section`}
                >
                  <option value="">All sections of Class {targetClass}</option>
                  {sectionOptions.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={targetSection}
                  onChange={e => onSectionChange(e.target.value)}
                  placeholder="Optional — e.g. A"
                  className={INPUT_CLS}
                  data-testid={`${testPrefix}-target-section`}
                />
              )}
              <p className="text-[10px] text-white/25 mt-1">
                {targetSection
                  ? `Only students in Class ${targetClass}-${targetSection} will see this event.`
                  : `All students in Class ${targetClass} (every section) will see this event.`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SchoolCalendar() {
  const { toast } = useToast();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [addOpen, setAddOpen] = useState(false);
  const [addTargeted, setAddTargeted] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const [editOpen, setEditOpen] = useState(false);
  const [editTargeted, setEditTargeted] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);

  const { data: schoolConfig } = useQuery<SchoolConfigData>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load school config");
      return r.json();
    },
    staleTime: 60_000,
  });

  const configClasses = schoolConfig?.classes ?? [];
  const configSections = schoolConfig?.sections ?? [];
  const configClassSections = schoolConfig?.classSections ?? {};

  function getSectionsFor(cls: string): string[] {
    if (cls && configClassSections[cls]?.length) return configClassSections[cls];
    return configSections;
  }

  const { data: events = [], isLoading, refetch, isFetching } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/admin/calendar", month + 1, year],
    queryFn: async () => {
      const r = await fetch(`/api/admin/calendar?month=${month + 1}&year=${year}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load events");
      return r.json();
    },
    staleTime: 30000,
  });

  const addMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/admin/calendar", data),
    onSuccess: () => {
      invalidateAll();
      closeAddModal();
      toast({ title: "Event added", description: "Calendar updated successfully." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: (data: typeof editForm & { id: number }) =>
      apiRequest("PATCH", `/api/admin/calendar/${data.id}`, data),
    onSuccess: () => {
      invalidateAll();
      closeEditModal();
      toast({ title: "Event updated", description: "Changes saved successfully." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/calendar/${id}`),
    onSuccess: () => {
      invalidateAll();
      closeEditModal();
      setSelectedDay(null);
      toast({ title: "Event deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function closeAddModal() {
    setAddOpen(false);
    setAddTargeted(false);
    setForm(EMPTY_FORM);
  }

  function closeEditModal() {
    setEditOpen(false);
    setEditingEvent(null);
    setDeleteConfirm(false);
    setEditTargeted(false);
    setEditForm(EMPTY_EDIT);
  }

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    return days;
  }, [month, year]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach(e => {
      const k = e.date.split("T")[0];
      if (!map[k]) map[k] = [];
      map[k].push(e);
    });
    return map;
  }, [events]);

  const selectedDayEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  function prevMonth() {
    if (month === 0) {
      if (year > YEAR_START) { setMonth(11); setYear(y => y - 1); }
    } else {
      setMonth(m => m - 1);
    }
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) {
      if (year < YEAR_END) { setMonth(0); setYear(y => y + 1); }
    } else {
      setMonth(m => m + 1);
    }
    setSelectedDay(null);
  }
  function goToday() {
    setMonth(now.getMonth()); setYear(now.getFullYear()); setSelectedDay(null);
  }

  const isToday = (d: number) => {
    const t = new Date();
    return t.getFullYear() === year && t.getMonth() === month && t.getDate() === d;
  };

  function openAddForDay(dayKey: string) {
    setForm(f => ({ ...f, startDate: dayKey, endDate: dayKey }));
    setAddTargeted(false);
    setAddOpen(true);
  }

  function openEdit(ev: CalendarEvent) {
    setEditingEvent(ev);
    setEditTargeted(ev.audienceScope !== "All_School");
    setEditForm({
      title: ev.title,
      description: ev.description || "",
      eventType: ev.eventType,
      date: ev.date.split("T")[0],
      isRecurring: ev.isRecurring,
      colorCode: ev.colorCode || "",
      targetClass: ev.targetClass || "",
      targetSection: ev.targetSection || "",
    });
    setDeleteConfirm(false);
    setEditOpen(true);
  }

  function openEditWithDelete(ev: CalendarEvent, e: React.MouseEvent) {
    e.stopPropagation();
    openEdit(ev);
    setDeleteConfirm(true);
  }

  const monthEventCount = events.length;
  const holidayCount = events.filter(e => e.eventType === "holiday").length;

  const legend = (
    <div className="flex items-center gap-4 flex-wrap">
      {EVENT_TYPES.map(t => (
        <div key={t.value} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
          <span className="text-xs text-white/50">{t.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-3 ml-auto">
        <span className="flex items-center gap-1 text-[10px] text-white/30">
          <span className="w-2 h-2 rounded-full bg-white/20" />All School
        </span>
        <span className="flex items-center gap-1 text-[10px] text-purple-400/70">
          <span className="w-2 h-2 rounded-full bg-purple-500/40" />Entire Class
        </span>
        <span className="flex items-center gap-1 text-[10px] text-blue-400/70">
          <span className="w-2 h-2 rounded-full bg-blue-500/40" />Specific Section
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white" data-testid="heading-school-calendar">School Event Calendar</h2>
          <p className="text-white/40 text-sm mt-0.5">{monthEventCount} events · {holidayCount} holidays this month</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-sync-now"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white/50 text-sm hover:text-white hover:border-white/20 transition-colors disabled:opacity-60"
            title="Refresh calendar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => {
              const todayKey = buildKey(now.getFullYear(), now.getMonth(), now.getDate());
              setForm(f => ({ ...f, startDate: todayKey, endDate: todayKey }));
              setAddTargeted(false);
              setAddOpen(true);
            }}
            data-testid="button-add-event"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#D4AF37]/15 border border-[#D4AF37]/30 text-[#D4AF37] text-sm font-medium hover:bg-[#D4AF37]/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Event
          </button>
        </div>
      </div>

      {legend}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <div className="bg-[#1A2942] rounded-xl border border-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 gap-2">
              <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white" data-testid="button-prev-month">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <select
                  value={month}
                  onChange={e => { setMonth(parseInt(e.target.value)); setSelectedDay(null); }}
                  className="bg-[#0A1628] border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-[#D4AF37]/50 cursor-pointer"
                  data-testid="select-month"
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i}>{m}</option>
                  ))}
                </select>
                <select
                  value={year}
                  onChange={e => { setYear(parseInt(e.target.value)); setSelectedDay(null); }}
                  className="bg-[#0A1628] border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-[#D4AF37]/50 cursor-pointer w-24"
                  data-testid="input-year"
                  aria-label="Year (2026–2126)"
                >
                  {YEARS.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <button onClick={goToday} className="text-[10px] px-2 py-0.5 rounded border border-[#D4AF37]/40 text-[#D4AF37]/70 hover:text-[#D4AF37] hover:border-[#D4AF37] transition-colors" data-testid="button-today">
                  Today
                </button>
              </div>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white" data-testid="button-next-month">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <p className="text-center text-white/50 text-sm py-1 border-b border-white/5 font-medium" data-testid="text-calendar-month">{MONTHS[month]} {year}</p>

            <div className="grid grid-cols-7">
              {DAYS.map(d => (
                <div key={d} className="py-2 text-center text-[11px] font-medium text-white/30 border-b border-white/5">{d}</div>
              ))}
              {isLoading ? (
                <div className="col-span-7 flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-white/40" />
                </div>
              ) : (
                calendarDays.map((day, i) => {
                  if (day === null) {
                    return <div key={`empty-${i}`} className="min-h-[72px] border-b border-r border-white/5 bg-white/[0.01]" />;
                  }
                  const key = buildKey(year, month, day);
                  const dayEvs = eventsByDate[key] || [];
                  const today = isToday(day);
                  const isSelected = selectedDay === key;
                  const hasHoliday = dayEvs.some(e => e.eventType === "holiday");

                  return (
                    <div
                      key={key}
                      onClick={() => setSelectedDay(isSelected ? null : key)}
                      data-testid={`cell-day-${day}`}
                      className={`min-h-[72px] border-b border-r border-white/5 p-1.5 cursor-pointer transition-colors
                        ${hasHoliday ? "bg-red-500/5" : ""}
                        ${isSelected ? "bg-[#D4AF37]/10" : "hover:bg-white/5"}
                      `}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full
                            ${today ? "bg-[#D4AF37] text-[#0A1628] font-bold" : "text-white/60"}
                          `}
                          style={today ? { boxShadow: "0 0 0 3px rgba(212,175,55,0.3), 0 0 10px rgba(212,175,55,0.4)" } : {}}
                          data-testid={`text-day-${day}`}
                        >
                          {day}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        {dayEvs.slice(0, 2).map(ev => (
                          <div
                            key={ev.id}
                            className="px-1 py-0.5 rounded text-[10px] truncate font-medium hover:opacity-80 transition-opacity"
                            style={{ backgroundColor: `${getEventColor(ev)}25`, color: getEventColor(ev) }}
                            data-testid={`event-chip-${ev.id}`}
                            onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                            title={`${ev.title}${ev.audienceScope === "Specific_Section" ? ` (Class ${ev.targetClass}-${ev.targetSection})` : ev.audienceScope === "Entire_Class" ? ` (Class ${ev.targetClass})` : ""}`}
                          >
                            {ev.title}
                            {ev.audienceScope !== "All_School" && (
                              <span className="opacity-50 ml-0.5">
                                {ev.targetClass}{ev.targetSection ? `-${ev.targetSection}` : ""}
                              </span>
                            )}
                          </div>
                        ))}
                        {dayEvs.length > 2 && (
                          <div className="text-[9px] text-white/30 pl-1">+{dayEvs.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-[#1A2942] rounded-xl border border-white/10 p-4">
            <h4 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-[#D4AF37]" />
              {selectedDay ? fmtDateLong(selectedDay) : "Events"}
            </h4>
            {!selectedDay ? (
              <p className="text-xs text-white/30 text-center py-4">Click a day on the calendar to view or manage its events.</p>
            ) : selectedDayEvents.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-white/30 text-sm mb-3">No events on this day</p>
                <button
                  onClick={() => openAddForDay(selectedDay)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[#D4AF37]/15 border border-[#D4AF37]/30 text-[#D4AF37] hover:bg-[#D4AF37]/25 transition-colors"
                  data-testid="button-add-for-selected-day"
                >
                  <Plus className="w-3 h-3 inline mr-1" />Add Event
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedDayEvents.map(ev => (
                  <div
                    key={ev.id}
                    className="group flex items-start gap-2 p-2 rounded-lg border border-white/5 hover:border-white/15 transition-colors cursor-pointer"
                    data-testid={`event-card-${ev.id}`}
                    onClick={() => openEdit(ev)}
                  >
                    <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: getEventColor(ev) }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate" data-testid={`text-event-title-${ev.id}`}>{ev.title}</p>
                      <p className="text-[11px] text-white/40 capitalize flex items-center flex-wrap gap-0.5">
                        {ev.eventType}{ev.isRecurring ? " · recurring" : ""}
                        <AudienceBadge ev={ev} />
                      </p>
                      {ev.description && <p className="text-[11px] text-white/30 mt-0.5 line-clamp-1">{ev.description}</p>}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                        className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                        data-testid={`button-edit-event-${ev.id}`}
                        aria-label="Edit event"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => openEditWithDelete(ev, e)}
                        className="p-1 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                        data-testid={`button-delete-event-${ev.id}`}
                        aria-label="Delete event"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => openAddForDay(selectedDay)}
                  className="w-full mt-1 text-xs px-2 py-1.5 rounded-lg border border-dashed border-white/20 text-white/30 hover:text-[#D4AF37] hover:border-[#D4AF37]/40 transition-colors"
                  data-testid="button-add-to-day"
                >
                  <Plus className="w-3 h-3 inline mr-1" />Add to this day
                </button>
              </div>
            )}
          </div>

          <div className="bg-[#1A2942] rounded-xl border border-white/10 p-4">
            <h4 className="text-sm font-semibold text-white/70 mb-3">This Month</h4>
            {events.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-2">No events yet</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {events
                  .slice()
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map(ev => (
                    <div
                      key={ev.id}
                      className="flex items-center gap-2 group cursor-pointer hover:bg-white/5 rounded-lg px-1 py-0.5 transition-colors"
                      data-testid={`sidebar-event-${ev.id}`}
                      onClick={() => openEdit(ev)}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getEventColor(ev) }} />
                      <span className="text-xs text-white/50 shrink-0">{new Date(ev.date + "T00:00:00").getDate()}</span>
                      <span className="text-xs text-white/70 truncate flex-1">{ev.title}</span>
                      {ev.audienceScope === "Entire_Class" && (
                        <span className="text-[9px] text-purple-400/70 shrink-0">Cl.{ev.targetClass}</span>
                      )}
                      {ev.audienceScope === "Specific_Section" && (
                        <span className="text-[9px] text-blue-400/70 shrink-0">{ev.targetClass}-{ev.targetSection}</span>
                      )}
                      {ev.isRecurring && <Repeat className="w-3 h-3 text-white/20 shrink-0" />}
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ ADD EVENT MODAL ══ */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="bg-[#1A2942] rounded-xl border border-white/10 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 sticky top-0 bg-[#1A2942] z-10">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#D4AF37]" />
                Add Calendar Event
              </h3>
              <button onClick={closeAddModal} className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors" data-testid="button-close-add-modal">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wide block mb-1">Event Title *</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Annual Sports Day"
                  className={INPUT_CLS}
                  data-testid="input-event-title"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wide block mb-1">Start Date *</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={e => setForm(f => ({
                      ...f,
                      startDate: e.target.value,
                      endDate: !f.endDate || f.endDate < e.target.value ? e.target.value : f.endDate,
                    }))}
                    className={INPUT_CLS + " [color-scheme:dark]"}
                    data-testid="input-start-date"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/50 uppercase tracking-wide block mb-1">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                    min={form.startDate}
                    className={INPUT_CLS + " [color-scheme:dark]"}
                    data-testid="input-end-date"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-white/50 uppercase tracking-wide block mb-1">Event Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  {EVENT_TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, eventType: t.value }))}
                      data-testid={`button-type-${t.value}`}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all"
                      style={{
                        borderColor: form.eventType === t.value ? t.color : "rgba(255,255,255,0.1)",
                        backgroundColor: form.eventType === t.value ? `${t.color}20` : "transparent",
                        color: form.eventType === t.value ? t.color : "rgba(255,255,255,0.4)",
                      }}
                    >
                      <t.icon className="w-3.5 h-3.5" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <AudiencePicker
                targeted={addTargeted}
                onToggle={(val) => {
                  setAddTargeted(val);
                  if (!val) setForm(f => ({ ...f, targetClass: "", targetSection: "" }));
                }}
                targetClass={form.targetClass}
                onClassChange={(val) => setForm(f => ({ ...f, targetClass: val, targetSection: "" }))}
                targetSection={form.targetSection}
                onSectionChange={(val) => setForm(f => ({ ...f, targetSection: val }))}
                configClasses={configClasses}
                getSectionsFor={getSectionsFor}
                testPrefix="button-add"
              />

              <div>
                <label className="text-xs text-white/50 uppercase tracking-wide block mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={2}
                  placeholder="Optional notes..."
                  className={INPUT_CLS + " resize-none"}
                  data-testid="input-event-description"
                />
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isRecurring}
                  onChange={e => setForm(f => ({ ...f, isRecurring: e.target.checked }))}
                  className="w-4 h-4 rounded accent-[#D4AF37]"
                  data-testid="checkbox-recurring"
                />
                <span className="text-sm text-white/60 flex items-center gap-1.5">
                  <Repeat className="w-3.5 h-3.5" />
                  Recurring annually through 2126
                </span>
              </label>
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-white/10 sticky bottom-0 bg-[#1A2942]">
              <button
                onClick={closeAddModal}
                className="flex-1 py-2.5 rounded-lg border border-white/10 text-white/50 text-sm hover:text-white hover:border-white/20 transition-colors"
                data-testid="button-cancel-add"
              >
                Cancel
              </button>
              <button
                onClick={() => addMutation.mutate(form)}
                disabled={addMutation.isPending || !form.title || !form.startDate || (addTargeted && !form.targetClass)}
                className="flex-1 py-2.5 rounded-lg bg-[#D4AF37] text-[#0A1628] text-sm font-bold hover:bg-[#D4AF37]/90 transition-colors disabled:opacity-60"
                data-testid="button-confirm-add"
              >
                {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Add Event"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ EDIT EVENT MODAL ══ */}
      {editOpen && editingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="bg-[#1A2942] rounded-xl border border-white/10 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 sticky top-0 bg-[#1A2942] z-10">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Pencil className="w-4 h-4 text-[#D4AF37]" />
                {deleteConfirm ? "Confirm Delete" : "Edit Event"}
              </h3>
              <button
                onClick={closeEditModal}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                data-testid="button-close-edit-modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {deleteConfirm ? (
              <div className="px-5 py-6 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <p className="text-white font-semibold mb-1">Delete this event?</p>
                  <p className="text-white/50 text-sm">
                    "<span className="text-white/70">{editingEvent.title}</span>" on {fmtDateLong(editingEvent.date.split("T")[0])} will be permanently removed.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="flex-1 py-2.5 rounded-lg border border-white/10 text-white/50 text-sm hover:text-white hover:border-white/20 transition-colors"
                    data-testid="button-cancel-delete"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(editingEvent.id)}
                    disabled={deleteMutation.isPending}
                    className="flex-1 py-2.5 rounded-lg bg-red-500 text-white text-sm font-bold hover:bg-red-600 transition-colors disabled:opacity-60"
                    data-testid="button-confirm-delete"
                  >
                    {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Yes, Delete"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="px-5 py-4 space-y-4">
                  <div>
                    <label className="text-xs text-white/50 uppercase tracking-wide block mb-1">Event Title *</label>
                    <input
                      value={editForm.title}
                      onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                      className={INPUT_CLS}
                      data-testid="input-edit-event-title"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 uppercase tracking-wide block mb-1">Date *</label>
                    <input
                      type="date"
                      value={editForm.date}
                      onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))}
                      className={INPUT_CLS + " [color-scheme:dark]"}
                      data-testid="input-edit-event-date"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 uppercase tracking-wide block mb-1">Event Type *</label>
                    <div className="grid grid-cols-2 gap-2">
                      {EVENT_TYPES.map(t => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setEditForm(f => ({ ...f, eventType: t.value }))}
                          data-testid={`button-edit-type-${t.value}`}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all"
                          style={{
                            borderColor: editForm.eventType === t.value ? t.color : "rgba(255,255,255,0.1)",
                            backgroundColor: editForm.eventType === t.value ? `${t.color}20` : "transparent",
                            color: editForm.eventType === t.value ? t.color : "rgba(255,255,255,0.4)",
                          }}
                        >
                          <t.icon className="w-3.5 h-3.5" />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <AudiencePicker
                    targeted={editTargeted}
                    onToggle={(val) => {
                      setEditTargeted(val);
                      if (!val) setEditForm(f => ({ ...f, targetClass: "", targetSection: "" }));
                    }}
                    targetClass={editForm.targetClass}
                    onClassChange={(val) => setEditForm(f => ({ ...f, targetClass: val, targetSection: "" }))}
                    targetSection={editForm.targetSection}
                    onSectionChange={(val) => setEditForm(f => ({ ...f, targetSection: val }))}
                    configClasses={configClasses}
                    getSectionsFor={getSectionsFor}
                    testPrefix="button-edit"
                  />

                  <div>
                    <label className="text-xs text-white/50 uppercase tracking-wide block mb-1">Description</label>
                    <textarea
                      value={editForm.description}
                      onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                      rows={2}
                      placeholder="Optional notes..."
                      className={INPUT_CLS + " resize-none"}
                      data-testid="input-edit-event-description"
                    />
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editForm.isRecurring}
                      onChange={e => setEditForm(f => ({ ...f, isRecurring: e.target.checked }))}
                      className="w-4 h-4 rounded accent-[#D4AF37]"
                      data-testid="checkbox-edit-recurring"
                    />
                    <span className="text-sm text-white/60 flex items-center gap-1.5">
                      <Repeat className="w-3.5 h-3.5" />
                      Recurring annually
                    </span>
                  </label>
                </div>
                <div className="px-5 py-4 border-t border-white/10 space-y-2 sticky bottom-0 bg-[#1A2942]">
                  <div className="flex gap-3">
                    <button
                      onClick={closeEditModal}
                      className="flex-1 py-2.5 rounded-lg border border-white/10 text-white/50 text-sm hover:text-white hover:border-white/20 transition-colors"
                      data-testid="button-cancel-edit"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => editMutation.mutate({ ...editForm, id: editingEvent.id })}
                      disabled={editMutation.isPending || !editForm.title || !editForm.date || (editTargeted && !editForm.targetClass)}
                      className="flex-1 py-2.5 rounded-lg bg-[#D4AF37] text-[#0A1628] text-sm font-bold hover:bg-[#D4AF37]/90 transition-colors disabled:opacity-60"
                      data-testid="button-submit-edit"
                    >
                      {editMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save Changes"}
                    </button>
                  </div>
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="w-full py-2.5 rounded-lg border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-colors"
                    data-testid="button-open-delete-confirm"
                  >
                    <Trash2 className="w-3.5 h-3.5 inline mr-1.5" />
                    Delete Event
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
