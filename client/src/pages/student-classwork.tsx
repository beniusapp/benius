import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, PenLine, GraduationCap, Loader2, Calendar,
  ChevronLeft, ChevronRight, FileText, X, ExternalLink,
  Play, Image as ImageIcon, BookOpen,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

interface StudentMeResponse {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  schoolName: string;
  schoolCode: string;
  schoolId?: number;
}

interface ClassworkItem {
  id: number;
  subject: string;
  content: string;
  fileUrl: string | null;
  createdAt: string;
  teacherName: string;
}

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function toDisplayDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB");
}

function getWeekDates(anchor: Date): Date[] {
  const day = anchor.getDay();
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

function getResourceTag(fileUrl: string | null): { label: string; icon: typeof FileText; color: string } | null {
  if (!fileUrl) return null;
  const lower = fileUrl.toLowerCase();
  if (lower.endsWith(".pdf")) return { label: "#Notes", icon: FileText, color: "text-red-600 bg-red-50 border-red-200" };
  if (lower.match(/\.(mp4|webm|mov|avi)$/)) return { label: "#Video", icon: Play, color: "text-purple-600 bg-purple-50 border-purple-200" };
  if (lower.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) return { label: "#Reference_Material", icon: ImageIcon, color: "text-blue-600 bg-blue-50 border-blue-200" };
  return { label: "#Reference_Material", icon: BookOpen, color: "text-amber-700 bg-amber-50 border-amber-200" };
}

function getSubjectColor(subject: string): string {
  const colors: Record<string, string> = {
    mathematics: "text-blue-600 bg-blue-50 border-blue-200",
    math: "text-blue-600 bg-blue-50 border-blue-200",
    science: "text-purple-600 bg-purple-50 border-purple-200",
    english: "text-pink-600 bg-pink-50 border-pink-200",
    history: "text-amber-700 bg-amber-50 border-amber-200",
    geography: "text-green-600 bg-green-50 border-green-200",
    physics: "text-indigo-600 bg-indigo-50 border-indigo-200",
    chemistry: "text-orange-600 bg-orange-50 border-orange-200",
    biology: "text-emerald-600 bg-emerald-50 border-emerald-200",
    hindi: "text-red-600 bg-red-50 border-red-200",
  };
  return colors[subject.toLowerCase()] ?? "text-emerald-700 bg-emerald-50 border-emerald-200";
}

function ClassworkViewer({ cw, onClose }: { cw: ClassworkItem; onClose: () => void }) {
  const tag = getResourceTag(cw.fileUrl);
  const isImage = cw.fileUrl?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  const isVideo = cw.fileUrl?.match(/\.(mp4|webm|mov)$/i);
  const isPdf = cw.fileUrl?.toLowerCase().endsWith(".pdf");
  const subjectColor = getSubjectColor(cw.subject);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f0fdf4]" data-testid="classwork-viewer">
      <header className="sticky top-0 z-10 bg-[#10b981] shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors flex-shrink-0"
            data-testid="button-close-viewer"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{cw.subject}</p>
            <p className="text-emerald-100 text-xs">{toDisplayDate(cw.createdAt.split("T")[0])} · {cw.teacherName}</p>
          </div>
          {cw.fileUrl && (
            <a
              href={cw.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition-colors flex-shrink-0"
              data-testid="link-open-external"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open
            </a>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto max-w-5xl mx-auto w-full px-4 py-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${subjectColor}`}>{cw.subject}</span>
          {tag && (
            <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${tag.color}`}>
              <tag.icon className="w-3 h-3" /> {tag.label}
            </span>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-slate-600 mb-2">Instructions / Description</h2>
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{cw.content}</p>
        </div>

        {cw.fileUrl && (
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
            {isImage && (
              <img
                src={cw.fileUrl}
                alt="Classwork attachment"
                className="w-full max-h-[60vh] object-contain"
                data-testid="viewer-image"
              />
            )}
            {isPdf && (
              <iframe
                src={cw.fileUrl!}
                title="PDF Viewer"
                className="w-full"
                style={{ height: "70vh", border: "none" }}
                data-testid="viewer-pdf-iframe"
              />
            )}
            {isVideo && (
              <video
                src={cw.fileUrl}
                controls
                className="w-full max-h-[60vh]"
                data-testid="viewer-video"
              />
            )}
            {!isImage && !isPdf && !isVideo && (
              <div className="flex flex-col items-center gap-3 p-6">
                <BookOpen className="w-12 h-12 text-amber-400" />
                <p className="text-sm text-slate-600 font-medium">Attached Resource</p>
                <a
                  href={cw.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold hover:bg-amber-100 transition-colors"
                  data-testid="link-open-file"
                >
                  <ExternalLink className="w-4 h-4" /> Open File
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DatePickerModal({ value, onSelect, onClose }: {
  value: string; onSelect: (d: string) => void; onClose: () => void;
}) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(() => new Date(value + "T00:00:00").getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date(value + "T00:00:00").getMonth());

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayStr = toISODate(today);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    const next = new Date(viewYear, viewMonth + 1, 1);
    if (next > today) return;
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const isNextMonthDisabled = new Date(viewYear, viewMonth + 1, 1) > today;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-4"
        onClick={e => e.stopPropagation()}
        data-testid="datepicker-modal"
      >
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100" data-testid="datepicker-prev-month">
            <ChevronLeft className="w-5 h-5 text-slate-600" />
          </button>
          <span className="font-bold text-slate-800 text-sm">{MONTH_NAMES[viewMonth]} {viewYear}</span>
          <button onClick={nextMonth} disabled={isNextMonthDisabled} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-40" data-testid="datepicker-next-month">
            <ChevronRight className="w-5 h-5 text-slate-600" />
          </button>
        </div>
        <div className="grid grid-cols-7 mb-1">
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
            <div key={d} className="text-center text-[10px] font-bold text-slate-400 py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const num = i + 1;
            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(num).padStart(2, "0")}`;
            const isFuture = dateStr > todayStr;
            const isSelected = dateStr === value;
            const isToday = dateStr === todayStr;
            return (
              <button
                key={dateStr}
                disabled={isFuture}
                onClick={() => { onSelect(dateStr); onClose(); }}
                className={`
                  aspect-square w-full flex items-center justify-center rounded-full text-xs font-semibold transition-colors
                  ${isSelected ? "bg-[#10b981] text-white" : ""}
                  ${!isSelected && isToday ? "bg-emerald-100 text-emerald-700" : ""}
                  ${!isSelected && !isToday && !isFuture ? "hover:bg-slate-100 text-slate-700" : ""}
                  ${isFuture ? "text-slate-300 cursor-not-allowed" : ""}
                `}
                data-testid={`datepicker-day-${dateStr}`}
              >
                {num}
              </button>
            );
          })}
        </div>
        <button onClick={onClose} className="mt-3 w-full text-xs text-slate-500 hover:text-slate-700 py-1" data-testid="datepicker-close">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function StudentClasswork() {
  const [, setLocation] = useLocation();

  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(() => toISODate(today));
  const [showCalendar, setShowCalendar] = useState(false);
  const [activeCw, setActiveCw] = useState<ClassworkItem | null>(null);

  const weekDates = getWeekDates(new Date(selectedDate + "T12:00:00"));
  const todayStr = toISODate(today);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: cwList, isLoading: cwLoading } = useQuery<ClassworkItem[]>({
    queryKey: ["/api/student/classwork", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/student/classwork?date=${selectedDate}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load classwork");
      return res.json();
    },
    enabled: !!student,
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const handleDateSelect = useCallback((d: string) => {
    setSelectedDate(d);
    setActiveCw(null);
  }, []);

  if (studentLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }
  if (!student) return null;

  if (activeCw) {
    return <ClassworkViewer cw={activeCw} onClose={() => setActiveCw(null)} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f0fdf4]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#10b981] shadow-md">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-11 h-11 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
            data-testid="button-back"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <PenLine className="w-5 h-5 text-white" />
            <div className="leading-tight">
              <p className="text-white font-bold text-base">Classwork</p>
              <p className="text-emerald-100 text-xs">{student.schoolName}</p>
            </div>
          </div>
          <div className="ml-auto text-right">
            <p className="text-white text-xs font-semibold">{student.digitalStudentId}</p>
            <p className="text-emerald-100 text-[10px]">Class {student.class}–{student.section}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-5 space-y-5">
        {/* Smart Date Navigation */}
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-3">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
            {weekDates.map(d => {
              const iso = toISODate(d);
              const isFuture = iso > todayStr;
              const isSelected = iso === selectedDate;
              const isToday = iso === todayStr;
              return (
                <button
                  key={iso}
                  disabled={isFuture}
                  onClick={() => handleDateSelect(iso)}
                  className={`
                    flex-shrink-0 flex flex-col items-center justify-center gap-0.5
                    w-12 h-14 rounded-xl text-xs font-semibold transition-all
                    ${isSelected ? "bg-[#10b981] text-white shadow-md" : ""}
                    ${!isSelected && isToday ? "bg-emerald-100 text-emerald-700" : ""}
                    ${!isSelected && !isToday && !isFuture ? "text-slate-600 hover:bg-emerald-50" : ""}
                    ${isFuture ? "text-slate-300 cursor-not-allowed" : ""}
                  `}
                  data-testid={`date-chip-${iso}`}
                >
                  <span className="text-[10px] uppercase tracking-wide opacity-80">{SHORT_DAY[d.getDay()]}</span>
                  <span className="text-sm font-bold">{d.getDate()}</span>
                  {isToday && !isSelected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                </button>
              );
            })}
            <button
              onClick={() => setShowCalendar(true)}
              className="flex-shrink-0 flex flex-col items-center justify-center w-12 h-14 rounded-xl text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
              data-testid="button-open-calendar"
              aria-label="Open date picker"
            >
              <Calendar className="w-5 h-5" />
              <span className="text-[9px] mt-0.5">Pick</span>
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2 text-center">
            Classwork for <span className="font-semibold text-slate-600">{new Date(selectedDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
          </p>
        </div>

        {/* Content */}
        {cwLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-4 animate-pulse h-28" />
            ))}
          </div>
        ) : !cwList || cwList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
              <PenLine className="w-10 h-10 text-emerald-400" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-700">No classwork for this date</p>
              <p className="text-sm text-slate-400 mt-1">Try selecting another day or check back later</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {cwList.map(cw => {
              const tag = getResourceTag(cw.fileUrl);
              const subjectColor = getSubjectColor(cw.subject);
              return (
                <button
                  key={cw.id}
                  onClick={() => setActiveCw(cw)}
                  className="w-full text-left bg-white rounded-2xl border border-emerald-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-all p-4 flex flex-col gap-3 focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:ring-offset-2"
                  data-testid={`card-classwork-${cw.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${subjectColor}`}>{cw.subject}</span>
                      {tag && (
                        <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${tag.color}`}>
                          <tag.icon className="w-3 h-3" /> {tag.label}
                        </span>
                      )}
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1 text-[11px] text-slate-400">
                      <span>{toDisplayDate(cw.createdAt.split("T")[0])}</span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed line-clamp-2">{cw.content}</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>By {cw.teacherName}</span>
                    {cw.fileUrl && (
                      <span className="flex items-center gap-1 text-emerald-600 font-medium">
                        <FileText className="w-3 h-3" /> View resource
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {showCalendar && (
        <DatePickerModal
          value={selectedDate}
          onSelect={handleDateSelect}
          onClose={() => setShowCalendar(false)}
        />
      )}
    </div>
  );
}
