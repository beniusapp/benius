import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { fmtDate } from "@/lib/dateUtils";
import {
  ArrowLeft, BookOpen, GraduationCap, Loader2, Calendar,
  ChevronLeft, ChevronRight, Upload, X, FileText, AlertCircle,
  CheckCircle, Clock, ExternalLink, Send, RefreshCw, Pencil, Lock,
} from "lucide-react";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSessionView } from "@/contexts/session-view-context";

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

interface HomeworkSubmission {
  id: number;
  homeworkId: number;
  studentId: number;
  status: string;
  fileUrl: string | null;
  textAnswer: string | null;
  submittedAt: string;
}

interface HomeworkItem {
  id: number;
  subject: string;
  content: string;
  fileUrl: string | null;
  dueDate: string | null;
  createdAt: string;
  teacherName: string;
  submission: HomeworkSubmission | null;
}

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
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

function isDueWithin24h(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate + "T23:59:59");
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
}

function StatusBadge({ submission, dueDate }: { submission: HomeworkSubmission | null; dueDate: string | null }) {
  if (!submission) {
    const pulsing = isDueWithin24h(dueDate);
    return (
      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-300 ${pulsing ? "animate-pulse" : ""}`}>
        <Clock className="w-3 h-3" /> Pending
      </span>
    );
  }
  if (submission.status === "approved") return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
      <CheckCircle className="w-3 h-3" /> Completed
    </span>
  );
  if (submission.status === "rejected") return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-300">
      <AlertCircle className="w-3 h-3" /> Pending
    </span>
  );
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-300">
      <CheckCircle className="w-3 h-3" /> Submitted
    </span>
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
                  ${isFuture ? "text-slate-300 cursor-not-allowed" : "cursor-pointer"}
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

function SubmitDrawer({ hw, studentId, onClose, onSuccess }: {
  hw: HomeworkItem; studentId: number; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { isArchiveMode } = useSessionView();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textAnswer, setTextAnswer] = useState(hw.submission?.textAnswer || "");
  const today = toISODate(new Date());
  const isOverdue = hw.dueDate && hw.dueDate < today;
  const isApproved = hw.submission?.status === "approved";

  const canSubmit = textAnswer.trim().length > 0 || selectedFile !== null;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (selectedFile) formData.append("file", selectedFile);
      if (textAnswer.trim()) formData.append("textAnswer", textAnswer.trim());
      const res = await fetch(`/api/student/homework/${hw.id}/submit`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Submission failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.isLate ? "Submitted (Late)" : "Submitted!",
        description: data.isLate
          ? "Your submission was received but it's past the due date."
          : "Your homework has been submitted successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/student/homework"] });
      onSuccess();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  }

  const subjectColor = getSubjectColor(hw.subject);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 sm:bg-black/30" onClick={onClose} />
      <div
        className="fixed z-50 bg-white shadow-2xl flex flex-col
          bottom-0 left-0 right-0 rounded-t-3xl max-h-[90vh]
          sm:top-0 sm:right-0 sm:bottom-0 sm:left-auto sm:w-[440px] sm:rounded-none sm:max-h-none"
        data-testid="homework-drawer"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${subjectColor}`}>{hw.subject}</span>
            {hw.submission && <StatusBadge submission={hw.submission} dueDate={hw.dueDate} />}
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 transition-colors" data-testid="button-close-drawer">
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Meta */}
          <div>
            <p className="text-xs text-slate-400 mb-1">Assigned by {hw.teacherName}</p>
            <div className="flex flex-wrap gap-2 text-xs text-slate-500">
              <span>Assigned: {fmtDate(hw.createdAt.split("T")[0])}</span>
              {hw.dueDate && (
                <span className={isOverdue && !hw.submission ? "text-red-600 font-semibold" : ""}>
                  · Due: {fmtDate(hw.dueDate)}
                </span>
              )}
            </div>
          </div>

          {/* Instructions */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-1">Instructions</h3>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{hw.content}</p>
          </div>

          {/* Teacher attachment */}
          {hw.fileUrl && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Attached Resource</h3>
              <a
                href={hw.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors text-sm text-emerald-700 font-medium"
                data-testid="link-homework-attachment"
              >
                <FileText className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <span className="truncate">View Attachment</span>
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            </div>
          )}

          {/* Previous submission */}
          {hw.submission && (
            <div className={`rounded-xl p-3 border ${
              hw.submission.status === "approved" ? "bg-emerald-50 border-emerald-200" :
              hw.submission.status === "rejected" ? "bg-amber-50 border-amber-200" :
              "bg-blue-50 border-blue-200"
            }`}>
              <p className="text-xs font-semibold text-slate-600 mb-1">Current Submission</p>
              <p className="text-xs text-slate-400">
                Submitted: {new Date(hw.submission.submittedAt).toLocaleDateString("en-GB")}
              </p>
              {hw.submission.textAnswer && (
                <div className="mt-2 p-2 bg-white/70 rounded-lg border border-slate-200">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                    <Pencil className="w-3 h-3" /> Written Answer
                  </p>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed line-clamp-4">
                    {hw.submission.textAnswer}
                  </p>
                </div>
              )}
              {hw.submission.fileUrl && (
                <a
                  href={hw.submission.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  data-testid="link-submission-file"
                >
                  <ExternalLink className="w-3 h-3" /> View submitted file
                </a>
              )}
            </div>
          )}

          {/* Submission form — archive lock */}
          {!isApproved && isArchiveMode && (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: "#fefce8", border: "1.5px solid #fde68a" }}
              data-testid="banner-archive-hw"
            >
              <Lock className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <p className="text-xs font-semibold text-amber-800">
                Submissions are locked in Archive Mode. Switch to the active session to submit.
              </p>
            </div>
          )}

          {/* Submission form — live mode */}
          {!isApproved && !isArchiveMode && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">
                {hw.submission ? "Update Submission" : "Submit Homework"}
              </h3>

              {isOverdue && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 mb-3">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Past due date — late submission will still be accepted
                </div>
              )}

              {/* Write Answer */}
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <Pencil className="w-3.5 h-3.5 text-emerald-600" />
                  Write Answer
                </p>
                <textarea
                  value={textAnswer}
                  onChange={e => setTextAnswer(e.target.value)}
                  placeholder="Type your answer, explanation, or solution here…"
                  rows={5}
                  maxLength={5000}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:border-emerald-400 focus:bg-white resize-none leading-relaxed transition-colors"
                  data-testid="textarea-text-answer"
                />
                <div className="flex justify-end">
                  <span className="text-[10px] text-slate-400">{textAnswer.length}/5000</span>
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">and / or</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* Upload File */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-emerald-600" />
                  Upload File
                </p>
                <div
                  className={`relative flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                    dragging ? "border-[#10b981] bg-emerald-50" : "border-slate-200 bg-slate-50 hover:border-emerald-300 hover:bg-emerald-50/40"
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="dropzone-upload"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
                    data-testid="input-file-upload"
                  />
                  <Upload className="w-7 h-7 text-slate-400" />
                  {selectedFile ? (
                    <div className="text-center">
                      <p className="text-sm font-semibold text-emerald-700 truncate max-w-[220px]">{selectedFile.name}</p>
                      <p className="text-xs text-slate-400">{(selectedFile.size / 1024).toFixed(0)} KB · ready to submit</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm text-slate-600 font-medium">Tap to select file</p>
                      <p className="text-xs text-slate-400 mt-0.5">PDF, image, doc · Max 10 MB</p>
                    </div>
                  )}
                </div>
                {selectedFile && (
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                    data-testid="button-remove-file"
                  >
                    <X className="w-3 h-3" /> Remove file
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer — hidden in archive mode */}
        {!isApproved && !isArchiveMode && (
          <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0">
            <button
              onClick={() => submitMutation.mutate()}
              disabled={submitMutation.isPending || !canSubmit}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#10b981] hover:bg-emerald-600 active:bg-emerald-700 text-white font-bold text-sm transition-colors disabled:opacity-50 min-h-[48px]"
              data-testid="button-submit-homework"
            >
              {submitMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
              ) : hw.submission ? (
                <><RefreshCw className="w-4 h-4" /> Update Submission</>
              ) : (
                <><Send className="w-4 h-4" /> Submit Homework</>
              )}
            </button>
            {!canSubmit && (
              <p className="text-center text-[11px] text-slate-400 mt-2">
                Write an answer or select a file to enable submission
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function StudentHomework() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(() => toISODate(today));
  const [showCalendar, setShowCalendar] = useState(false);
  const [activeHw, setActiveHw] = useState<HomeworkItem | null>(null);

  const weekDates = getWeekDates(new Date(selectedDate + "T12:00:00"));

  const { data: student, isLoading: studentLoading } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: hwList, isLoading: hwLoading } = useQuery<HomeworkItem[]>({
    queryKey: ["/api/student/homework", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/student/homework?date=${selectedDate}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load homework");
      return res.json();
    },
    enabled: !!student,
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const handleDateSelect = useCallback((d: string) => {
    setSelectedDate(d);
    setActiveHw(null);
  }, []);

  if (studentLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }
  if (!student) return null;

  const todayStr = toISODate(today);

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: "#f8fafc" }}>
      {/* ── Decorative blobs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", top: "38%", left: "28%", width: "360px", height: "360px", borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)" }} />
      </div>

      {/* Header */}
      <header
        className="sticky top-0 z-30"
        style={{
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          background: "rgba(255, 255, 255, 0.75)",
          borderBottom: "1px solid rgba(255,255,255,0.7)",
          boxShadow: "0 1px 28px rgba(0,0,0,0.07)",
        }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-colors flex-shrink-0"
            style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="button-back"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: "linear-gradient(135deg, #f59e0b, #10b981)" }}>
              <BookOpen className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="font-bold text-sm text-slate-800">Homework</p>
              <p className="text-[11px] text-slate-400 truncate">{student.schoolName}</p>
            </div>
          </div>
          <div className="hidden sm:block text-right flex-shrink-0">
            <p className="text-xs font-semibold text-slate-600">{student.digitalStudentId}</p>
            <p className="text-[10px] text-slate-400">Class {student.class}–{student.section}</p>
          </div>
        </div>
      </header>

      <motion.main
        className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-5 space-y-5 relative z-10"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        {/* Smart Date Navigation */}
        <div className="rounded-2xl p-3 bg-white/80 border border-white/70 shadow-sm">
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
            Showing homework for <span className="font-semibold text-slate-600">{new Date(selectedDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
          </p>
        </div>

        {/* Content */}
        {hwLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-2xl p-4 bg-white/80 border border-white/70 shadow-sm animate-pulse h-40" />
            ))}
          </div>
        ) : !hwList || hwList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center">
              <BookOpen className="w-10 h-10 text-emerald-400" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-700">No homework for this date</p>
              <p className="text-sm text-slate-400 mt-1">Try selecting another day or check back later</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {hwList.map(hw => {
              const today2 = toISODate(new Date());
              const isOverdue = hw.dueDate && hw.dueDate < today2 && !hw.submission;
              const subColor = getSubjectColor(hw.subject);
              return (
                <button
                  key={hw.id}
                  onClick={() => setActiveHw(hw)}
                  className="text-left rounded-2xl bg-white/80 border border-white/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-all p-4 flex flex-col gap-3 focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:ring-offset-2"
                  data-testid={`card-homework-${hw.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${subColor}`}>{hw.subject}</span>
                    <StatusBadge submission={hw.submission} dueDate={hw.dueDate} />
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed line-clamp-3">{hw.content}</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-auto">
                    <span>By {hw.teacherName}</span>
                    <div className="flex flex-col items-end gap-0.5">
                      <span>Assigned: {fmtDate(hw.createdAt.split("T")[0])}</span>
                      {hw.dueDate && (
                        <span className={isOverdue ? "text-red-500 font-semibold" : ""}>
                          Due: {fmtDate(hw.dueDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  {hw.fileUrl && (
                    <div className="flex items-center gap-1 text-[11px] text-emerald-600">
                      <FileText className="w-3 h-3" /> Attachment available
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </motion.main>

      {showCalendar && (
        <DatePickerModal
          value={selectedDate}
          onSelect={handleDateSelect}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {activeHw && (
        <SubmitDrawer
          hw={activeHw}
          studentId={student.id}
          onClose={() => setActiveHw(null)}
          onSuccess={() => setActiveHw(null)}
        />
      )}
    </div>
  );
}
