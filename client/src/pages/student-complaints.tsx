import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { fmtDate, fmtDateTimeAmPm } from "@/lib/dateUtils";
import {
  ArrowLeft, Mail, ShieldAlert, UserX, Loader2,
  AlertTriangle, CheckCircle, Clock, Plus, Lock, ChevronDown, ChevronUp,
  Search, X, MessageSquare, Send, ChevronRight,
} from "lucide-react";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSessionView } from "@/contexts/session-view-context";

interface StudentMe {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  phone: string;
  schoolName: string;
  schoolCode: string;
  schoolId: number;
}

interface TeacherOption {
  id: number;
  name: string;
  subject: string;
}

interface PeerStudent {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  photoUrl: string | null;
}

interface ComplaintNote {
  id: number;
  complaintId: number;
  authorId: number;
  authorRole: string;
  authorName: string;
  content: string;
  createdAt: string;
}

interface ComplaintRecord {
  id: number;
  ticketId: string;
  complaintType: string;
  status: string;
  content: string;
  reportedStudentName: string | null;
  incidentDate: string | null;
  contactNumber: string | null;
  suggestions: string | null;
  teacherName?: string | null;
  resolutionRemarks: string | null;
  escalatedToPrincipal: boolean | null;
  createdAt: string;
  studentName?: string | null;
  studentClass?: string | null;
  studentSection?: string | null;
  students?: { id: number; name: string; class: string | null; section: string | null }[];
  batchPeers?: { name: string; class: string | null; section: string | null }[];
}

type TabId = "inbox" | "staff" | "peer";

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string; icon: typeof CheckCircle }> = {
    "Pending":       { label: "Pending",       cls: "bg-amber-50   text-amber-700   border-amber-200",   icon: Clock         },
    "Investigating": { label: "Investigating", cls: "bg-blue-50    text-blue-700    border-blue-200",    icon: Clock         },
    "Resolved":      { label: "Resolved",      cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle   },
    "Escalated":     { label: "Escalated",     cls: "bg-red-50     text-red-700     border-red-200",     icon: AlertTriangle },
  };
  const s = cfg[status] ?? { label: status, cls: "bg-gray-50 text-gray-600 border-gray-200", icon: Clock };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${s.cls}`}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}


/* ── Inbox Detail Drawer ── */
function InboxDetailDrawer({
  c,
  student,
  onClose,
}: {
  c: ComplaintRecord & { teacherName: string };
  student: StudentMe;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isArchiveMode } = useSessionView();
  const [commentText, setCommentText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: notes = [], isLoading: notesLoading } = useQuery<ComplaintNote[]>({
    queryKey: ["/api/student/complaints", c.id, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/student/complaints/${c.id}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load comments");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const postNote = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/student/complaints/${c.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: commentText.trim() }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      setCommentText("");
      queryClient.invalidateQueries({ queryKey: ["/api/student/complaints", c.id, "notes"] });
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior }), 200);
  }, [notes.length]);

  // Build the full list of involved students, marking the current student as "You"
  const allStudents = c.students && c.students.length > 0 ? c.students : [];
  const legacyPeers = c.batchPeers ?? [];

  function roleAvatar(role: string, name: string) {
    const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
    if (role === "student") return { bg: "bg-emerald-100", text: "text-emerald-700", initials };
    if (role === "teacher") return { bg: "bg-red-100", text: "text-red-700", initials };
    return { bg: "bg-blue-100", text: "text-blue-700", initials };
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
      data-testid="overlay-inbox-detail"
    >
      <div
        className="relative bg-white rounded-t-3xl w-full max-w-2xl mx-auto flex flex-col"
        style={{ maxHeight: "90dvh" }}
        onClick={e => e.stopPropagation()}
        data-testid="drawer-inbox-detail"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="px-5 pb-3 pt-1 border-b border-gray-100 flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">{c.ticketId}</span>
              <StatusBadge status={c.status} />
            </div>
            <p className="text-sm font-bold text-gray-800 mt-1">{c.teacherName}</p>
            <p className="text-xs text-gray-400">{fmtDateTimeAmPm(c.createdAt)}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 mt-0.5"
            data-testid="button-close-inbox-detail"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Students in incident */}
          {(allStudents.length > 0 || legacyPeers.length > 0 || c.studentName) && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Students in this incident</p>
              <div className="flex flex-wrap gap-1.5">
                {allStudents.length > 0 ? (
                  // New-style: show all students from junction table, mark current student as "You"
                  allStudents.map((s, idx) => {
                    const isMe = s.id === student.id;
                    return (
                      <div key={idx} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border ${isMe ? "bg-red-100 border-red-200" : "bg-orange-50 border-orange-200"}`}>
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${isMe ? "bg-red-300" : "bg-orange-200"}`}>
                          <span className={`text-[8px] font-bold ${isMe ? "text-red-800" : "text-orange-800"}`}>{s.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <span className={`text-xs font-bold ${isMe ? "text-red-800" : "text-orange-800"}`}>{isMe ? "You" : s.name}</span>
                        {s.class && (
                          <span className={`text-[10px] font-semibold ${isMe ? "text-red-500" : "text-orange-500"}`}>
                            · Class {s.class}{s.section ? `-${s.section}` : ""}
                          </span>
                        )}
                      </div>
                    );
                  })
                ) : (
                  // Legacy-style: show "You" chip + batchPeers
                  <>
                    <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 border border-red-200">
                      <div className="w-4 h-4 rounded-full bg-red-300 flex items-center justify-center flex-shrink-0">
                        <span className="text-[8px] font-bold text-red-800">
                          {c.studentName ? c.studentName.charAt(0).toUpperCase() : "Y"}
                        </span>
                      </div>
                      <span className="text-xs font-bold text-red-800">You</span>
                      {c.studentClass && (
                        <span className="text-[10px] font-semibold text-red-500">
                          · Class {c.studentClass}{c.studentSection ? `-${c.studentSection}` : ""}
                        </span>
                      )}
                    </div>
                    {legacyPeers.map((peer, idx) => (
                      <div key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-50 border border-orange-200">
                        <div className="w-4 h-4 rounded-full bg-orange-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-[8px] font-bold text-orange-800">{peer.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <span className="text-xs font-semibold text-orange-800">{peer.name}</span>
                        {peer.class && (
                          <span className="text-[10px] font-semibold text-orange-500">
                            · Class {peer.class}{peer.section ? `-${peer.section}` : ""}
                          </span>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Complaint content */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Details</p>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
              {c.content}
            </p>
          </div>

          {/* Resolution / Escalation banners */}
          {c.resolutionRemarks && (
            <div className="flex items-start gap-2 px-4 py-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-bold text-emerald-700">Resolution</p>
                <p className="text-xs text-emerald-600 mt-0.5">{c.resolutionRemarks}</p>
              </div>
            </div>
          )}
          {c.escalatedToPrincipal && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-50 rounded-xl border border-red-200">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-xs font-bold text-red-700">
                Escalated to Principal {!c.resolutionRemarks && "— awaiting response"}
              </p>
            </div>
          )}

          {/* Notes / Comments thread */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Comments</p>
              {notes.length > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{notes.length}</span>
              )}
            </div>

            {notesLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
              </div>
            ) : notes.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">No comments yet. Be the first to respond.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {notes.map(note => {
                  const av = roleAvatar(note.authorRole, note.authorName);
                  const isMe = note.authorRole === "student";
                  return (
                    <div key={note.id} className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`} data-testid={`note-${note.id}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${av.bg}`}>
                        <span className={`text-[10px] font-bold ${av.text}`}>{av.initials}</span>
                      </div>
                      <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                        <div className={`flex items-center gap-1.5 mb-0.5 ${isMe ? "flex-row-reverse" : ""}`}>
                          <span className="text-[10px] font-bold text-gray-600">{isMe ? "You" : note.authorName}</span>
                          <span className="text-[9px] text-gray-400">{fmtDateTimeAmPm(note.createdAt)}</span>
                        </div>
                        <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                          isMe
                            ? "bg-[#10b981] text-white rounded-tr-sm"
                            : note.authorRole === "teacher"
                            ? "bg-red-50 text-gray-800 border border-red-100 rounded-tl-sm"
                            : "bg-blue-50 text-gray-800 border border-blue-100 rounded-tl-sm"
                        }`}>
                          {note.content}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>

        {/* Comment input */}
        {isArchiveMode ? (
          <div
            className="flex-shrink-0 px-4 py-3 border-t border-gray-100 bg-white rounded-b-3xl flex items-center justify-center gap-2"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
            data-testid="banner-archive-comments"
          >
            <Lock className="w-3.5 h-3.5 text-amber-500" />
            <p className="text-xs font-semibold text-amber-700">Read-only in Archive Mode</p>
          </div>
        ) : (
        <div className="flex-shrink-0 px-4 py-3 border-t border-gray-100 bg-white rounded-b-3xl" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <div className="flex gap-2 items-end">
            <textarea
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey && commentText.trim()) {
                  e.preventDefault();
                  postNote.mutate();
                }
              }}
              placeholder="Write a comment…"
              rows={1}
              className="flex-1 px-4 py-2.5 rounded-2xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-gray-50"
              style={{ maxHeight: "96px" }}
              data-testid="input-inbox-comment"
            />
            <button
              onClick={() => postNote.mutate()}
              disabled={!commentText.trim() || postNote.isPending}
              className="w-10 h-10 rounded-full bg-[#10b981] disabled:bg-gray-200 flex items-center justify-center flex-shrink-0 transition-colors"
              data-testid="button-send-inbox-comment"
              aria-label="Send comment"
            >
              {postNote.isPending
                ? <Loader2 className="w-4 h-4 animate-spin text-white" />
                : <Send className="w-4 h-4 text-white" />
              }
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function InboxCard({ c, studentId, onOpen }: { c: ComplaintRecord & { teacherName: string }; studentId?: number; onOpen: () => void }) {
  // Prefer new junction-table students[], fall back to legacy batchPeers
  const allStudents = c.students && c.students.length > 0 ? c.students : null;
  const legacyPeers = c.batchPeers ?? [];
  const totalInvolved = allStudents ? allStudents.length : 1 + legacyPeers.length;

  return (
    <button
      className="w-full text-left rounded-2xl p-4 flex gap-3 bg-white/80 border border-white/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 active:scale-[0.99]"
      onClick={onOpen}
      data-testid={`card-inbox-${c.id}`}
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
        <AlertTriangle className="w-5 h-5 text-red-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-bold text-gray-800">{c.teacherName}</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmtDateTimeAmPm(c.createdAt)} · {c.ticketId}</p>
          </div>
          <StatusBadge status={c.status} />
        </div>

        {/* Students chips */}
        <div className="mt-2 mb-1 flex flex-wrap gap-1.5" data-testid={`chip-student-info-${c.id}`}>
          {allStudents ? (
            allStudents.map((s, idx) => {
              const isMe = studentId ? s.id === studentId : false;
              return (
                <div key={idx} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border ${isMe ? "bg-red-100 border-red-200" : "bg-orange-50 border-orange-200"}`}>
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${isMe ? "bg-red-300" : "bg-orange-200"}`}>
                    <span className={`text-[8px] font-bold ${isMe ? "text-red-800" : "text-orange-800"}`}>{s.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <span className={`text-xs font-bold truncate max-w-[120px] ${isMe ? "text-red-800" : "text-orange-800"}`}>{isMe ? "You" : s.name}</span>
                  {s.class && (
                    <span className={`text-[10px] font-semibold ${isMe ? "text-red-500" : "text-orange-500"}`}>
                      · {s.class}{s.section ? `-${s.section}` : ""}
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <>
              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 border border-red-200">
                <div className="w-4 h-4 rounded-full bg-red-300 flex items-center justify-center flex-shrink-0">
                  <span className="text-[8px] font-bold text-red-800">{c.studentName ? c.studentName.charAt(0).toUpperCase() : "Y"}</span>
                </div>
                <span className="text-xs font-bold text-red-800">You</span>
                {c.studentClass && (
                  <span className="text-[10px] font-semibold text-red-500">· Class {c.studentClass}{c.studentSection ? `-${c.studentSection}` : ""}</span>
                )}
              </div>
              {legacyPeers.map((peer, idx) => (
                <div key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-50 border border-orange-200" data-testid={`chip-peer-${c.id}-${idx}`}>
                  <div className="w-4 h-4 rounded-full bg-orange-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-[8px] font-bold text-orange-800">{peer.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <span className="text-xs font-semibold text-orange-800 truncate max-w-[120px]">{peer.name}</span>
                  {peer.class && <span className="text-[10px] font-semibold text-orange-500">· Class {peer.class}{peer.section ? `-${peer.section}` : ""}</span>}
                </div>
              ))}
            </>
          )}
        </div>
        {totalInvolved > 1 && (
          <p className="text-[10px] text-gray-400 mb-1.5">
            This notice was issued to {totalInvolved} students in the same incident.
          </p>
        )}

        <p className="text-sm text-gray-600 mt-1.5 line-clamp-2">{c.content}</p>
        <div className="flex items-center gap-1 text-[10px] text-[#10b981] font-semibold mt-2">
          <MessageSquare className="w-3 h-3" />
          <span>Tap to view details &amp; comment</span>
          <ChevronRight className="w-3 h-3 ml-auto" />
        </div>
      </div>
    </button>
  );
}

function FiledCard({ c }: { c: ComplaintRecord }) {
  return (
    <div className="rounded-2xl p-4 bg-white/80 border border-white/70 shadow-sm" data-testid={`card-filed-${c.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs text-gray-400">#{c.ticketId} · {fmtDateTimeAmPm(c.createdAt)}</p>
          {c.complaintType === "student-to-staff" && c.teacherName && (
            <p className="text-sm font-semibold text-gray-700 mt-0.5">Against: {c.teacherName}</p>
          )}
          {c.complaintType === "student-peer-report" && c.reportedStudentName && (
            <p className="text-sm font-semibold text-gray-700 mt-0.5">Reported: {c.reportedStudentName}</p>
          )}
          {c.complaintType === "student-peer-report" && c.incidentDate && (
            <p className="text-xs text-gray-500 mt-0.5">
              Incident: {fmtDate(c.incidentDate)}
            </p>
          )}
        </div>
        <StatusBadge status={c.status} />
      </div>
      <p className="text-sm text-gray-600 mt-2 line-clamp-2">{c.content}</p>
      {c.status === "Resolved" && c.resolutionRemarks && (
        <div className="mt-2 px-3 py-2 bg-emerald-50 rounded-xl border border-emerald-100">
          <p className="text-xs font-semibold text-emerald-700">Resolution</p>
          <p className="text-xs text-emerald-600 mt-0.5">{c.resolutionRemarks}</p>
        </div>
      )}
      {c.escalatedToPrincipal && (
        <div className="mt-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-red-500" />
          <p className="text-xs text-red-600 font-medium">Escalated to Principal</p>
        </div>
      )}
    </div>
  );
}

/* ── Peer Student Autocomplete Search ── */
function PeerStudentSearch({
  onSelect,
  selectedStudent,
  onClear,
}: {
  onSelect: (s: PeerStudent) => void;
  selectedStudent: PeerStudent | null;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce
  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(val), 300);
    setShowDropdown(true);
  }, []);

  const { data: results = [], isFetching } = useQuery<PeerStudent[]>({
    queryKey: ["/api/student/search-peers", debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/student/search-peers?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 10000,
  });

  // Click outside to close
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // If a student is already selected, show their chip
  if (selectedStudent) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#10b981] bg-emerald-50" data-testid="peer-selected-chip">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{selectedStudent.name}</p>
          <p className="text-xs text-gray-600">{selectedStudent.digitalStudentId} · Class {selectedStudent.class}-{selectedStudent.section}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:text-red-500 transition-colors flex-shrink-0"
          data-testid="button-clear-peer"
          aria-label="Clear selected student"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          onFocus={() => query.length >= 2 && setShowDropdown(true)}
          placeholder="Type a name or ID (min 2 characters)…"
          className="w-full pl-9 pr-4 h-11 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
          data-testid="input-peer-search"
          autoComplete="off"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[#10b981]" />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && debouncedQuery.length >= 2 && (
        <div
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-56 overflow-y-auto"
          data-testid="peer-search-dropdown"
        >
          {!isFetching && results.length === 0 ? (
            <div className="p-3 text-center text-sm font-semibold text-gray-500">
              No students found
            </div>
          ) : (
            results.map(s => (
              <button
                key={s.id}
                type="button"
                onMouseDown={e => {
                  e.preventDefault(); // prevent blur first
                  onSelect(s);
                  setQuery("");
                  setDebouncedQuery("");
                  setShowDropdown(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-emerald-50 transition-colors border-b border-gray-100 last:border-b-0"
                data-testid={`peer-option-${s.id}`}
              >
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-emerald-700">
                    {s.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{s.name}</p>
                  <p className="text-xs font-semibold text-gray-600">{s.digitalStudentId} · Class {s.class}-{s.section}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function StudentComplaints() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isArchiveMode } = useSessionView();
  const [activeTab, setActiveTab] = useState<TabId>("inbox");
  const [selectedInboxItem, setSelectedInboxItem] = useState<(ComplaintRecord & { teacherName: string }) | null>(null);

  const [staffTeacherId, setStaffTeacherId] = useState("");
  const [staffContent, setStaffContent] = useState("");
  const [staffContact, setStaffContact] = useState<string | null>(null);
  const [staffSuggestions, setStaffSuggestions] = useState("");

  // Peer report state
  const [peerSelectedStudent, setPeerSelectedStudent] = useState<PeerStudent | null>(null);
  const [peerIncidentDate, setPeerIncidentDate] = useState("");
  const [peerIncidentDateText, setPeerIncidentDateText] = useState("");
  const [peerContent, setPeerContent] = useState("");

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: inboxData = [], isLoading: inboxLoading } = useQuery<(ComplaintRecord & { teacherName: string })[]>({
    queryKey: ["/api/student/complaints/inbox"],
    enabled: !!student,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: filedData = [], isLoading: filedLoading } = useQuery<ComplaintRecord[]>({
    queryKey: ["/api/student/complaints/filed"],
    enabled: !!student,
  });

  const { data: teacherOptions = [], isLoading: teachersLoading } = useQuery<TeacherOption[]>({
    queryKey: ["/api/student/complaint-teachers"],
    enabled: !!student,
  });

  const staffMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/student/complaints/staff-grievance", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/complaints/filed"] });
      toast({ title: "Grievance submitted", description: "Your complaint has been sent directly to the Principal." });
      setStaffTeacherId(""); setStaffContent(""); setStaffContact(null); setStaffSuggestions("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const peerMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/student/complaints/peer-report", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/complaints/filed"] });
      toast({ title: "Report submitted", description: "Your peer report has been filed." });
      setPeerSelectedStudent(null); setPeerIncidentDate(""); setPeerIncidentDateText(""); setPeerContent("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  const staffGrievances = filedData.filter(c => c.complaintType === "student-to-staff");
  const peerReports = filedData.filter(c => c.complaintType === "student-peer-report");

  const tabs: { id: TabId; label: string; Icon: typeof Mail; count?: number }[] = [
    { id: "inbox", label: "From Teachers", Icon: Mail,        count: inboxData.length },
    { id: "staff", label: "Staff Grievance", Icon: ShieldAlert },
    { id: "peer",  label: "Peer Reports",   Icon: UserX },
  ];

  const handleStaffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffTeacherId || !staffContent.trim()) {
      toast({ title: "Missing fields", description: "Please select a teacher and describe your complaint.", variant: "destructive" });
      return;
    }
    staffMutation.mutate({
      teacherId: parseInt(staffTeacherId),
      content: staffContent,
      contactNumber: staffContact !== null ? staffContact : student.phone,
      suggestions: staffSuggestions,
    });
  };

  const handlePeerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerSelectedStudent || !peerContent.trim()) {
      toast({ title: "Missing fields", description: "Please select a student and describe the incident.", variant: "destructive" });
      return;
    }
    peerMutation.mutate({
      reportedStudentName: peerSelectedStudent.name,
      reportedStudentId: peerSelectedStudent.id,
      incidentDate: peerIncidentDate || null,
      content: peerContent,
    });
  };

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: "#f8fafc" }}>

      {/* ── Decorative blobs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", top: "38%", left: "28%", width: "360px", height: "360px", borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)" }} />
      </div>

      {/* ── Sticky header ── */}
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
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-colors flex-shrink-0"
            style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: "linear-gradient(135deg, #ec4899, #8b5cf6)" }}>
              <Mail className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="font-bold text-sm text-slate-800 truncate">Conduct & Grievance</p>
              <p className="text-[11px] text-slate-400 truncate">{student.digitalStudentId} · Class {student.class}-{student.section}</p>
            </div>
          </div>
          <span className="hidden sm:flex items-center px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0" style={{ background: "rgba(0,0,0,0.05)", color: "#475569" }}>
            {student.schoolCode}
          </span>
        </div>
      </header>

      <motion.main
        className="flex-1 max-w-3xl mx-auto w-full px-4 py-5 space-y-5 pb-24"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >

        {/* ── Three-Tab Segmented Toggle ── */}
        <div className="rounded-2xl p-1.5 flex gap-1 bg-white/80 border border-white/70 shadow-sm">
          {tabs.map(({ id, label, Icon, count }) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); }}
              className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-2 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[52px] ${
                activeTab === id
                  ? "bg-[#10b981] text-white shadow-sm"
                  : "text-gray-500 hover:bg-emerald-50 hover:text-[#10b981]"
              }`}
              data-testid={`tab-${id}`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="leading-tight text-center">{label}</span>
              {count !== undefined && count > 0 && (
                <span className={`rounded-full text-[10px] font-bold px-1.5 py-0.5 ${activeTab === id ? "bg-white/25 text-white" : "bg-red-100 text-red-600"}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab: From Teachers ── */}
        {activeTab === "inbox" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Mail className="w-4 h-4 text-[#10b981]" />
              <h2 className="text-sm font-bold text-gray-700">Conduct Alerts from Teachers</h2>
            </div>
            {inboxLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#10b981]" /></div>
            ) : inboxData.length === 0 ? (
              <div className="rounded-2xl p-8 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
                  <Mail className="w-7 h-7 text-emerald-300" />
                </div>
                <h3 className="text-base font-bold text-gray-700">All Clear</h3>
                <p className="text-sm text-gray-400 max-w-xs">No conduct alerts from your teachers.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {inboxData.map(c => (
                  <InboxCard key={c.id} c={c} studentId={student?.id} onOpen={() => setSelectedInboxItem(c)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Staff Grievance ── */}
        {activeTab === "staff" && (
          <div className="space-y-4">
            {isArchiveMode ? (
              <div className="rounded-2xl p-5 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 text-center" data-testid="banner-archive-staff">
                <Lock className="w-8 h-8 text-amber-400" />
                <p className="text-sm font-bold text-amber-800">Archive Mode — Read Only</p>
                <p className="text-xs text-amber-600 max-w-xs">Switch to the active session to file a new staff grievance. You can still view previously filed grievances below.</p>
              </div>
            ) : (
            <>
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
              <Lock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-blue-800">Direct to Principal — Strictly Confidential</p>
                <p className="text-xs text-blue-600 mt-0.5">Your complaint is sent directly to the Principal only. The staff member you are reporting will have no access to this record.</p>
              </div>
            </div>

            <div className="rounded-2xl p-5 bg-white/80 border border-white/70 shadow-sm" data-testid="form-staff-grievance">
              <h2 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#10b981]" /> File a Staff Grievance
              </h2>
              <form onSubmit={handleStaffSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Staff Member *</label>
                  <select
                    value={staffTeacherId}
                    onChange={e => setStaffTeacherId(e.target.value)}
                    className="w-full px-3 h-11 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="select-staff-teacher"
                    required
                  >
                    <option value="">Select a staff member…</option>
                    {teacherOptions.map(t => (
                      <option key={t.id} value={t.id}>{t.name}{t.subject ? ` (${t.subject})` : ""}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Complaint Description *</label>
                  <textarea
                    value={staffContent}
                    onChange={e => setStaffContent(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                    rows={4}
                    placeholder="Describe the incident or issue in detail…"
                    data-testid="textarea-staff-content"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Your Contact Number</label>
                  <input
                    type="tel"
                    value={staffContact !== null ? staffContact : (student.phone || "")}
                    onChange={e => setStaffContact(e.target.value)}
                    placeholder="Enter contact number"
                    className="w-full px-3 h-11 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-staff-contact"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Suggestions for Improvement</label>
                  <textarea
                    value={staffSuggestions}
                    onChange={e => setStaffSuggestions(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                    rows={3}
                    placeholder="Any suggestions to prevent this in future…"
                    data-testid="textarea-staff-suggestions"
                  />
                </div>

                <button
                  type="submit"
                  disabled={staffMutation.isPending || teachersLoading}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-[#10b981] hover:bg-[#059669] text-white text-sm font-semibold transition-colors disabled:opacity-60"
                  data-testid="button-submit-staff"
                >
                  {staffMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                  Submit Grievance
                </button>
              </form>
            </div>
            </>
            )}

            {filedLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[#10b981]" /></div>
            ) : staffGrievances.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide px-1">Your Filed Grievances</h3>
                {staffGrievances.map(c => <FiledCard key={c.id} c={c} />)}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Peer Reports ── */}
        {activeTab === "peer" && (
          <div className="space-y-4">
            {isArchiveMode ? (
              <div className="rounded-2xl p-5 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 text-center" data-testid="banner-archive-peer">
                <Lock className="w-8 h-8 text-amber-400" />
                <p className="text-sm font-bold text-amber-800">Archive Mode — Read Only</p>
                <p className="text-xs text-amber-600 max-w-xs">Switch to the active session to file a new peer report. Your past reports are shown below.</p>
              </div>
            ) : (
            <div className="rounded-2xl p-5 bg-white/80 border border-white/70 shadow-sm" data-testid="form-peer-report">
              <h2 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                <UserX className="w-4 h-4 text-[#10b981]" /> Report Peer Misconduct
              </h2>
              <form onSubmit={handlePeerSubmit} className="space-y-4">

                {/* ── Student Autocomplete Search ── */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Target Student * <span className="font-normal text-gray-400">(search by name or ID)</span>
                  </label>
                  <PeerStudentSearch
                    onSelect={setPeerSelectedStudent}
                    selectedStudent={peerSelectedStudent}
                    onClear={() => setPeerSelectedStudent(null)}
                  />
                </div>

                {/* ── Incident Date & Time ── */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Incident Date &amp; Time <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="DD/MM/YYYY HH:MM"
                    value={peerIncidentDateText}
                    onChange={e => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
                      let out = digits;
                      if (digits.length > 2)  out = `${digits.slice(0,2)}/${digits.slice(2)}`;
                      if (digits.length > 4)  out = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
                      if (digits.length > 8)  out = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4,8)} ${digits.slice(8)}`;
                      if (digits.length > 10) out = `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4,8)} ${digits.slice(8,10)}:${digits.slice(10,12)}`;
                      setPeerIncidentDateText(out);
                      const m = out.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
                      if (m) {
                        const [, dd, mm, yyyy, hh, min] = m;
                        const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
                        setPeerIncidentDate(isNaN(d.getTime()) ? "" : `${yyyy}-${mm}-${dd}T${hh}:${min}`);
                      } else {
                        setPeerIncidentDate("");
                      }
                    }}
                    maxLength={16}
                    className="w-full px-3 h-11 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-peer-incident-date"
                  />
                </div>

                {/* ── Description ── */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description of Incident *</label>
                  <textarea
                    value={peerContent}
                    onChange={e => setPeerContent(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                    rows={4}
                    placeholder="Describe what happened, when, and where…"
                    data-testid="textarea-peer-content"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={peerMutation.isPending || !peerSelectedStudent}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-[#10b981] hover:bg-[#059669] text-white text-sm font-semibold transition-colors disabled:opacity-60"
                  data-testid="button-submit-peer"
                >
                  {peerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                  Submit Report
                </button>
              </form>
            </div>
            )}

            {/* History */}
            {filedLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[#10b981]" /></div>
            ) : peerReports.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide px-1">Your Filed Peer Reports</h3>
                {peerReports.map(c => <FiledCard key={c.id} c={c} />)}
              </div>
            )}

            {!filedLoading && peerReports.length === 0 && (
              <div className="rounded-2xl p-6 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-2 text-center">
                <UserX className="w-8 h-8 text-gray-200" />
                <p className="text-sm text-gray-400">No peer reports filed yet.</p>
              </div>
            )}
          </div>
        )}
      </motion.main>

      {/* ── Mobile FAB ── */}
      {(activeTab === "staff" || activeTab === "peer") && (
        <div className="sm:hidden fixed bottom-6 right-5 z-40">
          <button
            onClick={() => {
              const formId = activeTab === "staff" ? "form-staff-grievance" : "form-peer-report";
              document.querySelector(`[data-testid="${formId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="w-14 h-14 rounded-full bg-[#10b981] hover:bg-[#059669] text-white shadow-lg flex items-center justify-center transition-all active:scale-95"
            data-testid="button-fab"
            aria-label="File a complaint"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* ── Inbox Detail Drawer ── */}
      {selectedInboxItem && student && (
        <InboxDetailDrawer
          c={selectedInboxItem}
          student={student}
          onClose={() => setSelectedInboxItem(null)}
        />
      )}
    </div>
  );
}
