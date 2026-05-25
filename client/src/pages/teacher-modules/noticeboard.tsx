import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Plus, FileDown, Upload, X, Megaphone, Calendar,
  CheckCircle, Bell, AlertTriangle, PartyPopper, GraduationCap, Palmtree,
  Pencil, Trash2, Check,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSchoolConfig } from "@/hooks/use-school-config";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface NoticeEntry {
  id: number;
  content: string;
  fileUrl: string | null;
  createdAt: string;
  creatorRole: string;
  targetType: string;
  targetClass: string | null;
  targetSection: string | null;
  noticeType: string | null;
}

const DEFAULT_NOTICE_TYPES = ["Routine", "Urgent", "Holiday", "Exam", "Event"];

type ScopeType = "specific" | "entire" | "multi_class" | "whole_school";

const NOTICE_TYPE_STYLES: Record<string, { border: string; bg: string; text: string; pill: string }> = {
  Routine: { border: "border-slate-300", bg: "bg-slate-50 dark:bg-slate-900/30", text: "text-slate-600", pill: "bg-slate-100 text-slate-700 border-slate-300" },
  Urgent: { border: "border-red-400", bg: "bg-red-50/50 dark:bg-red-950/20", text: "text-red-600", pill: "bg-red-100 text-red-700 border-red-300" },
  Holiday: { border: "border-green-400", bg: "bg-green-50/50 dark:bg-green-950/20", text: "text-green-600", pill: "bg-green-100 text-green-700 border-green-300" },
  Exam: { border: "border-blue-400", bg: "bg-blue-50/50 dark:bg-blue-950/20", text: "text-blue-600", pill: "bg-blue-100 text-blue-700 border-blue-300" },
  Event: { border: "border-purple-400", bg: "bg-purple-50/50 dark:bg-purple-950/20", text: "text-purple-600", pill: "bg-purple-100 text-purple-700 border-purple-300" },
};

function getNoticeIcon(type: string | null) {
  switch (type) {
    case "Urgent": return <AlertTriangle className="w-3.5 h-3.5" />;
    case "Holiday": return <Palmtree className="w-3.5 h-3.5" />;
    case "Exam": return <GraduationCap className="w-3.5 h-3.5" />;
    case "Event": return <PartyPopper className="w-3.5 h-3.5" />;
    default: return <Bell className="w-3.5 h-3.5" />;
  }
}

function getTargetLabel(entry: NoticeEntry): string {
  if (entry.targetType === "whole_school") return "Whole School";
  if (!entry.targetClass) return "All Classes";
  if (entry.targetClass.includes(",")) {
    const classes = entry.targetClass.split(",").map(c => `Cls ${c}`).join(", ");
    return `${classes} (All Sections)`;
  }
  if (!entry.targetSection) return `Class ${entry.targetClass} (All Sections)`;
  if (entry.targetSection.includes(",")) return `Class ${entry.targetClass} — Sec ${entry.targetSection}`;
  return `Class ${entry.targetClass}${entry.targetSection}`;
}

// ── Unread notice tracking (localStorage) ─────────────────────────────────
function readKey(teacherId: number) { return `noticeReads_teacher_${teacherId}`; }

function getReadIds(teacherId: number): Set<number> {
  try {
    const raw = localStorage.getItem(readKey(teacherId));
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
  } catch { return new Set(); }
}

function markIdsRead(teacherId: number, ids: number[]) {
  try {
    const existing = getReadIds(teacherId);
    ids.forEach(id => existing.add(id));
    localStorage.setItem(readKey(teacherId), JSON.stringify([...existing]));
  } catch {}
}

export default function NoticeboardModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const { classes: CLASS_OPTIONS, sections: SECTION_OPTIONS, examTypes } = useSchoolConfig(teacher.schoolId);
  const [tab, setTab] = useState<"admin" | "student">("admin");

  // Unread state — initialise from localStorage, re-computed when notices load
  const [readIds, setReadIds] = useState<Set<number>>(() => getReadIds(teacher.id));

  const NOTICE_TYPES = (() => {
    const merged = [...DEFAULT_NOTICE_TYPES];
    for (const et of examTypes) {
      if (!merged.includes(et)) merged.push(et);
    }
    return merged;
  })();

  const [scope, setScope] = useState<ScopeType>("specific");
  const [targetClass, setTargetClass] = useState(teacher.assignedClass || "");
  const [selectedSections, setSelectedSections] = useState<string[]>([teacher.assignedSection || "A"]);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [noticeType, setNoticeType] = useState("Routine");
  const [content, setContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  const toggleSection = (s: string) => {
    setSelectedSections(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  const toggleClass = (c: string) => {
    setSelectedClasses(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  };

  const getPostTargetClass = (): string => {
    if (scope === "whole_school") return "";
    if (scope === "multi_class") return selectedClasses.join(",");
    return targetClass;
  };

  const getPostTargetSection = (): string | null => {
    if (scope === "whole_school") return null;
    if (scope === "entire") return null;
    if (scope === "multi_class") return null;
    return selectedSections.join(",");
  };

  const canPost = (() => {
    if (!content.trim()) return false;
    if (scope === "whole_school") return true;
    if (scope === "specific") return targetClass !== "" && selectedSections.length > 0;
    if (scope === "entire") return targetClass !== "";
    if (scope === "multi_class") return selectedClasses.length > 0;
    return false;
  })();

  const { data: adminNotices = [], isLoading: loadingAdmin } = useQuery<NoticeEntry[]>({
    queryKey: ["/api/notices", teacher.schoolId, "teacher"],
    queryFn: async () => {
      const res = await fetch(`/api/notices/${teacher.schoolId}?target=teacher`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Count how many admin notices haven't been read yet
  const unreadCount = useMemo(
    () => adminNotices.filter(n => !readIds.has(n.id)).length,
    [adminNotices, readIds]
  );

  // Auto-mark all currently visible admin notices as read when teacher is on the admin tab
  useEffect(() => {
    if (tab === "admin" && adminNotices.length > 0) {
      const ids = adminNotices.map(n => n.id);
      markIdsRead(teacher.id, ids);
      setReadIds(getReadIds(teacher.id));
    }
  }, [tab, adminNotices, teacher.id]);

  const { data: studentNotices = [], isLoading: loadingStudent } = useQuery<NoticeEntry[]>({
    queryKey: ["/api/notices", teacher.schoolId, "student"],
    queryFn: async () => {
      const res = await fetch(`/api/notices/${teacher.schoolId}?target=student`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const handleFileSelect = useCallback((file: File | null) => {
    setSelectedFile(file);
    if (filePreview) URL.revokeObjectURL(filePreview);
    if (file && file.type.startsWith("image/")) {
      setFilePreview(URL.createObjectURL(file));
    } else {
      setFilePreview(null);
    }
  }, [filePreview]);

  const clearFile = useCallback(() => {
    setSelectedFile(null);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [filePreview]);

  const { data: myNotices = [], isLoading: loadingMyNotices } = useQuery<NoticeEntry[]>({
    queryKey: ["/api/notices/teacher/mine"],
    queryFn: async () => {
      const res = await fetch("/api/notices/teacher/mine", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", content);
      fd.append("targetType", scope === "whole_school" ? "whole_school" : "student");
      const postTargetClass = getPostTargetClass();
      if (postTargetClass) fd.append("targetClass", postTargetClass);
      const sec = getPostTargetSection();
      if (sec) fd.append("targetSection", sec);
      fd.append("noticeType", noticeType);
      fd.append("schoolId", String(teacher.schoolId));
      if (selectedFile) fd.append("file", selectedFile);
      const res = await fetch("/api/notices", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Notice Posted!", description: "Students can now view the notice." });
      setContent("");
      clearFile();
      queryClient.invalidateQueries({ queryKey: ["/api/notices", teacher.schoolId, "student"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notices/teacher/mine"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("DELETE", `/api/notices/${id}`, undefined);
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      toast({ title: "Notice Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/notices/teacher/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notices", teacher.schoolId, "student"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, content }: { id: number; content: string }) => {
      const r = await apiRequest("PUT", `/api/notices/${id}`, { content });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      toast({ title: "Notice Updated" });
      setEditingId(null);
      setEditContent("");
      queryClient.invalidateQueries({ queryKey: ["/api/notices/teacher/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notices", teacher.schoolId, "student"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const scopeLabel = scope === "specific" ? "Specific Section" : scope === "entire" ? "Entire Class" : scope === "multi_class" ? "Multi Class" : "Whole School";

  return (
    <div className="space-y-6">
      <div className="flex gap-2 p-1 bg-muted/50 rounded-xl" data-testid="tabs-notice">
        <button
          onClick={() => setTab("admin")}
          className={`relative flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            tab === "admin" ? "bg-white dark:bg-gray-900 shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-admin"
        >
          <Bell className="w-4 h-4 inline mr-1.5" />
          From Admin
          {unreadCount > 0 && tab !== "admin" && (
            <span className="absolute top-1.5 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow-sm"
              data-testid="badge-unread-count">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("student")}
          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            tab === "student" ? "bg-white dark:bg-gray-900 shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-student"
        >
          <Megaphone className="w-4 h-4 inline mr-1.5" />
          Post to Students
        </button>
      </div>

      {tab === "admin" && (
        <div>
          <h3 className="text-base font-bold tracking-tight mb-3" data-testid="text-admin-notices-title">
            Admin Notices
          </h3>
          {loadingAdmin ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="rounded-xl border bg-card p-5 animate-pulse">
                  <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                  <div className="h-3 bg-muted rounded w-24 mt-4" />
                </div>
              ))}
            </div>
          ) : adminNotices.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm" data-testid="text-no-admin-notices">
              <Bell className="w-10 h-10 mx-auto mb-2 opacity-20" />
              No notices from admin yet.
            </div>
          ) : (
            <div className="space-y-3">
              {adminNotices.map((n) => {
                const nt = n.noticeType || "Routine";
                const style = NOTICE_TYPE_STYLES[nt] || NOTICE_TYPE_STYLES.Routine;
                const isUnread = !readIds.has(n.id);
                return (
                  <div key={n.id}
                    className={`relative rounded-xl border-2 ${style.border} ${style.bg} shadow-sm transition-all hover:shadow-md
                      ${isUnread ? "ring-2 ring-red-400/40 shadow-red-100 dark:shadow-red-950/20" : ""}`}
                    data-testid={`card-admin-notice-${n.id}`}
                  >
                    {/* Unread red dot */}
                    {isUnread && (
                      <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm animate-pulse"
                        data-testid={`dot-unread-${n.id}`} />
                    )}
                    <div className="p-4 sm:p-5">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style.pill}`}
                          data-testid={`badge-notice-type-${n.id}`}>
                          {getNoticeIcon(nt)}
                          {nt}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(n.createdAt).toLocaleDateString("en-GB")}
                        </span>
                        {isUnread && (
                          <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide ml-auto">New</span>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid={`text-notice-content-${n.id}`}>
                        {n.content}
                      </p>
                      {n.fileUrl && (
                        <a href={n.fileUrl} target="_blank" rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1.5 mt-3 text-xs ${style.text} font-medium`}
                          data-testid={`link-notice-file-${n.id}`}>
                          <FileDown className="w-3.5 h-3.5" /> View Attachment
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "student" && (
        <>
          <Card className="rounded-2xl shadow-lg border-0 bg-white dark:bg-gray-950" data-testid="card-create-notice">
            <CardContent className="p-5 sm:p-6 space-y-5">
              <div className="flex items-center gap-2 mb-1">
                <Megaphone className="w-5 h-5 text-amber-500" />
                <h2 className="text-lg font-bold tracking-tight" data-testid="text-notice-title">Post Notice to Students</h2>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Targeting Scope</label>
                <div className="flex gap-1 p-1 bg-muted/50 rounded-xl flex-wrap" data-testid="scope-toggle">
                  {([
                    { key: "specific" as ScopeType, label: "Specific Section" },
                    { key: "entire" as ScopeType, label: "Entire Class" },
                    { key: "multi_class" as ScopeType, label: "Multi Class" },
                    { key: "whole_school" as ScopeType, label: "Whole School" },
                  ]).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setScope(opt.key)}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                        scope === opt.key
                          ? "bg-white dark:bg-gray-900 shadow-sm text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid={`scope-${opt.key}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {scope === "specific" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Class *</label>
                      <Select value={targetClass} onValueChange={setTargetClass}>
                        <SelectTrigger className="rounded-xl" data-testid="select-target-class">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {CLASS_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Sections * (tap to select)</label>
                    <div className="flex flex-wrap gap-1.5" data-testid="section-pills">
                      {SECTION_OPTIONS.map(s => (
                        <button
                          key={s}
                          onClick={() => toggleSection(s)}
                          className={`w-9 h-9 rounded-lg text-xs font-bold transition-all ${
                            selectedSections.includes(s)
                              ? "bg-amber-500 text-white shadow-sm"
                              : "bg-muted/60 text-muted-foreground hover:bg-muted"
                          }`}
                          data-testid={`pill-section-${s}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {scope === "entire" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Class *</label>
                    <Select value={targetClass} onValueChange={setTargetClass}>
                      <SelectTrigger className="rounded-xl" data-testid="select-entire-class">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        {CLASS_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end pb-1">
                    <span className="text-xs text-muted-foreground">All sections will receive this notice</span>
                  </div>
                </div>
              )}

              {scope === "multi_class" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Classes * (tap to select, all their sections will receive this notice)
                  </label>
                  <div className="flex flex-wrap gap-1.5" data-testid="class-pills">
                    {CLASS_OPTIONS.map(c => (
                      <button
                        key={c}
                        onClick={() => toggleClass(c)}
                        className={`px-3 h-9 rounded-lg text-xs font-bold transition-all ${
                          selectedClasses.includes(c)
                            ? "bg-amber-500 text-white shadow-sm"
                            : "bg-muted/60 text-muted-foreground hover:bg-muted"
                        }`}
                        data-testid={`pill-class-${c}`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {selectedClasses.length > 0 && (
                    <p className="text-[11px] text-amber-600 font-medium mt-1">
                      Selected: {selectedClasses.join(", ")}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notice Type</label>
                <Select value={noticeType} onValueChange={setNoticeType}>
                  <SelectTrigger className="rounded-xl" data-testid="select-notice-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTICE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>
                        <span className="flex items-center gap-2">
                          {getNoticeIcon(t)}
                          {t}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notice Content *</label>
                <Textarea
                  placeholder="Write your notice here..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={4}
                  className="rounded-xl resize-none"
                  data-testid="input-notice-content"
                />
              </div>

              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx"
                  data-testid="input-notice-file"
                />
                {!selectedFile ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-muted-foreground/25 rounded-xl p-6 flex flex-col items-center gap-2 text-muted-foreground hover:border-amber-400 hover:bg-amber-50/30 dark:hover:bg-amber-950/20 transition-colors cursor-pointer"
                    data-testid="dropzone-notice-upload"
                  >
                    <Upload className="w-8 h-8 opacity-40" />
                    <span className="text-sm font-medium">Click to upload image or document</span>
                    <span className="text-xs opacity-60">JPG, PNG, PDF, DOC (Max 10MB)</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-4 p-3 border rounded-xl bg-muted/30" data-testid="file-preview-notice">
                    {filePreview ? (
                      <img src={filePreview} alt="Preview" className="w-[100px] h-[100px] object-cover rounded-lg border" />
                    ) : (
                      <div className="w-[100px] h-[100px] rounded-lg border bg-muted flex items-center justify-center">
                        <FileDown className="w-8 h-8 text-muted-foreground/40" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                      type="button"
                      onClick={clearFile}
                      className="w-8 h-8 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center transition-colors shrink-0"
                      data-testid="button-remove-notice-file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <Button
                onClick={() => postMutation.mutate()}
                disabled={!canPost || postMutation.isPending}
                className={`w-full h-12 rounded-xl text-sm font-semibold transition-all ${
                  canPost
                    ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md active:scale-[0.98]"
                    : "opacity-50 cursor-not-allowed bg-gradient-to-r from-amber-500 to-orange-500 text-white"
                }`}
                data-testid="button-post-notice"
              >
                {postMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                {!canPost ? `Complete ${scopeLabel} Selection to Post` : `Post ${noticeType} Notice`}
              </Button>
            </CardContent>
          </Card>

          {/* ── My Posted Notices (last 50, scrollable, with edit/delete) ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-tight flex items-center gap-2" data-testid="text-my-notices-title">
                <Megaphone className="w-4 h-4 text-amber-500" />
                My Posted Notices
                <span className="text-muted-foreground font-normal text-xs">(last 50)</span>
              </h3>
              {!loadingMyNotices && (
                <span className="text-muted-foreground text-xs">{myNotices.length} notice{myNotices.length !== 1 ? "s" : ""}</span>
              )}
            </div>

            <div className="overflow-y-auto max-h-[480px] divide-y divide-border" data-testid="my-notices-feed">
              {loadingMyNotices ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : myNotices.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground text-sm" data-testid="text-no-my-notices">
                  <Megaphone className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  No notices posted yet.
                </div>
              ) : (
                myNotices.map((n) => {
                  const nt = n.noticeType || "Routine";
                  const style = NOTICE_TYPE_STYLES[nt] || NOTICE_TYPE_STYLES.Routine;
                  const isEditing = editingId === n.id;
                  return (
                    <div
                      key={n.id}
                      className="px-4 py-3 hover:bg-muted/30 transition-colors"
                      data-testid={`card-my-notice-${n.id}`}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${style.pill}`}>
                            {getNoticeIcon(nt)}
                            {nt}
                          </span>
                          <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted/60 rounded-full">
                            {getTargetLabel(n)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(n.createdAt).toLocaleDateString("en-GB")}
                          </span>
                          {!isEditing && (
                            <>
                              <button
                                onClick={() => { setEditingId(n.id); setEditContent(n.content); }}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                                title="Edit notice"
                                data-testid={`button-edit-my-notice-${n.id}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteMutation.mutate(n.id)}
                                disabled={deleteMutation.isPending}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40"
                                title="Delete notice"
                                data-testid={`button-delete-my-notice-${n.id}`}
                              >
                                {deleteMutation.isPending
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <Trash2 className="w-3.5 h-3.5" />
                                }
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Content / inline edit */}
                      {isEditing ? (
                        <div className="space-y-2 mt-1">
                          <Textarea
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            className="rounded-xl resize-none text-sm min-h-[80px]"
                            data-testid={`textarea-edit-my-notice-${n.id}`}
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => editMutation.mutate({ id: n.id, content: editContent })}
                              disabled={!editContent.trim() || editMutation.isPending}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                              data-testid={`button-save-my-notice-${n.id}`}
                            >
                              {editMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              Save
                            </button>
                            <button
                              onClick={() => { setEditingId(null); setEditContent(""); }}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground text-xs font-semibold transition-colors"
                              data-testid={`button-cancel-edit-my-notice-${n.id}`}
                            >
                              <X className="w-3 h-3" />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid={`text-my-notice-content-${n.id}`}>
                          {n.content}
                        </p>
                      )}

                      {n.fileUrl && !isEditing && (
                        <a href={n.fileUrl} target="_blank" rel="noopener noreferrer"
                          className={`inline-flex items-center gap-1.5 mt-2 text-xs ${style.text} font-medium`}>
                          <FileDown className="w-3 h-3" /> View Attachment
                        </a>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
