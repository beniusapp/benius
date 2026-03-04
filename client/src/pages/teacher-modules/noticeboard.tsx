import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Plus, FileDown, Upload, X, Megaphone, Calendar,
  CheckCircle, Bell, AlertTriangle, PartyPopper, GraduationCap, Palmtree
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
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

const CLASS_OPTIONS = ["L.K.G", "U.K.G", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const SECTION_OPTIONS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const NOTICE_TYPES = ["Routine", "Urgent", "Holiday", "Exam", "Event"];

type ScopeType = "specific" | "entire" | "range";

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
  if (!entry.targetClass) return "All Classes";
  if (entry.targetClass.includes("-")) return `Classes ${entry.targetClass}`;
  if (!entry.targetSection) return `Class ${entry.targetClass} (All Sections)`;
  if (entry.targetSection.includes(",")) return `Class ${entry.targetClass} — Sec ${entry.targetSection}`;
  return `Class ${entry.targetClass}${entry.targetSection}`;
}

export default function NoticeboardModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"admin" | "student">("admin");

  const [scope, setScope] = useState<ScopeType>("specific");
  const [targetClass, setTargetClass] = useState(teacher.assignedClass || "");
  const [selectedSections, setSelectedSections] = useState<string[]>([teacher.assignedSection || "A"]);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [noticeType, setNoticeType] = useState("Routine");
  const [content, setContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleSection = (s: string) => {
    setSelectedSections(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
    );
  };

  const getPostTargetClass = (): string => {
    if (scope === "range") return `${rangeFrom}-${rangeTo}`;
    return targetClass;
  };

  const getPostTargetSection = (): string | null => {
    if (scope === "entire") return null;
    if (scope === "range") return null;
    return selectedSections.join(",");
  };

  const canPost = (() => {
    if (!content.trim()) return false;
    if (scope === "specific") return targetClass !== "" && selectedSections.length > 0;
    if (scope === "entire") return targetClass !== "";
    if (scope === "range") return rangeFrom !== "" && rangeTo !== "" && CLASS_OPTIONS.indexOf(rangeTo) >= CLASS_OPTIONS.indexOf(rangeFrom);
    return false;
  })();

  const { data: adminNotices = [], isLoading: loadingAdmin } = useQuery<NoticeEntry[]>({
    queryKey: ["/api/notices", teacher.schoolId, "teacher"],
    queryFn: async () => {
      const res = await fetch(`/api/notices/${teacher.schoolId}?target=teacher`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

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

  const postMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", content);
      fd.append("targetType", "student");
      fd.append("targetClass", getPostTargetClass());
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
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const scopeLabel = scope === "specific" ? "Specific Section" : scope === "entire" ? "Entire Class" : "Class Range";

  return (
    <div className="space-y-6">
      <div className="flex gap-2 p-1 bg-muted/50 rounded-xl" data-testid="tabs-notice">
        <button
          onClick={() => setTab("admin")}
          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            tab === "admin" ? "bg-white dark:bg-gray-900 shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-admin"
        >
          <Bell className="w-4 h-4 inline mr-1.5" />
          From Admin
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
                return (
                  <div key={n.id}
                    className={`rounded-xl border-2 ${style.border} ${style.bg} shadow-sm transition-all hover:shadow-md`}
                    data-testid={`card-admin-notice-${n.id}`}
                  >
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
                <div className="flex gap-1 p-1 bg-muted/50 rounded-xl" data-testid="scope-toggle">
                  {([
                    { key: "specific" as ScopeType, label: "Specific Section" },
                    { key: "entire" as ScopeType, label: "Entire Class" },
                    { key: "range" as ScopeType, label: "Class Range" },
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

              {scope === "range" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">From Class *</label>
                    <Select value={rangeFrom} onValueChange={setRangeFrom}>
                      <SelectTrigger className="rounded-xl" data-testid="select-range-from">
                        <SelectValue placeholder="From" />
                      </SelectTrigger>
                      <SelectContent>
                        {CLASS_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">To Class *</label>
                    <Select value={rangeTo} onValueChange={setRangeTo}>
                      <SelectTrigger className="rounded-xl" data-testid="select-range-to">
                        <SelectValue placeholder="To" />
                      </SelectTrigger>
                      <SelectContent>
                        {CLASS_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
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

          <div>
            <h3 className="text-base font-bold tracking-tight mb-3" data-testid="text-student-notices-title">
              Student Notice Feed
            </h3>
            {loadingStudent ? (
              <div className="space-y-3">
                {[1, 2].map(i => (
                  <div key={i} className="rounded-xl border bg-card p-5 animate-pulse">
                    <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                    <div className="h-4 bg-muted rounded w-1/2" />
                    <div className="h-3 bg-muted rounded w-24 mt-4" />
                  </div>
                ))}
              </div>
            ) : studentNotices.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm" data-testid="text-no-student-notices">
                <Megaphone className="w-10 h-10 mx-auto mb-2 opacity-20" />
                No notices posted to students yet.
              </div>
            ) : (
              <div className="space-y-3">
                {studentNotices.map((n) => {
                  const nt = n.noticeType || "Routine";
                  const style = NOTICE_TYPE_STYLES[nt] || NOTICE_TYPE_STYLES.Routine;
                  return (
                    <div key={n.id}
                      className={`rounded-xl border-2 ${style.border} ${style.bg} shadow-sm transition-all hover:shadow-md`}
                      data-testid={`card-student-notice-${n.id}`}
                    >
                      <div className="p-4 sm:p-5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style.pill}`}
                              data-testid={`badge-student-notice-type-${n.id}`}>
                              {getNoticeIcon(nt)}
                              {nt}
                            </span>
                            <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted/60 rounded-full">
                              {getTargetLabel(n)}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                            <Calendar className="w-3 h-3" />
                            {new Date(n.createdAt).toLocaleDateString("en-GB")}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid={`text-student-notice-content-${n.id}`}>
                          {n.content}
                        </p>
                        {n.fileUrl && (
                          <a href={n.fileUrl} target="_blank" rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1.5 mt-3 text-xs ${style.text} font-medium`}
                            data-testid={`link-student-notice-file-${n.id}`}>
                            <FileDown className="w-3.5 h-3.5" /> View Attachment
                          </a>
                        )}
                        <div className="flex items-center mt-3 pt-2 border-t border-dashed">
                          <span className="text-xs text-muted-foreground">
                            Posted by {n.creatorRole === "teacher" ? "Teacher" : "Admin"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
