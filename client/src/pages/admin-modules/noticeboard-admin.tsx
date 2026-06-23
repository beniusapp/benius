import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { fmtDateTime } from "@/lib/dateUtils";
import {
  Bell, Send, Loader2, Pencil, Trash2, Check, X,
  Megaphone, BookOpen, AlertTriangle, Info, Filter,
  ShieldCheck, GraduationCap, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props {
  schoolId: number;
  classes: string[];
  sections: string[];
  adminUserId: number;
}

interface Notice {
  id: number;
  content: string;
  targetType: string;
  targetClass: string | null;
  targetSection: string | null;
  noticeType: string | null;
  creatorRole: string;
  createdById: number;
  creatorName: string | null;
  fileUrl: string | null;
  createdAt: string;
}

type RoleFilter = "all" | "admin" | "teacher";

const TARGET_TYPES = [
  { value: "whole_school", label: "Whole School" },
  { value: "teacher",      label: "All Teachers" },
  { value: "student",      label: "All Students" },
  { value: "class_only",   label: "Class (All Sections)" },
  { value: "class",        label: "Class + Section" },
];

const NOTICE_TYPES = [
  { value: "Routine",  label: "Routine",  icon: Info,          color: "text-gray-400" },
  { value: "Academic", label: "Academic", icon: BookOpen,      color: "text-blue-400" },
  { value: "Event",    label: "Event",    icon: Megaphone,     color: "text-purple-400" },
  { value: "Urgent",   label: "Urgent",   icon: AlertTriangle, color: "text-red-400" },
];

const BULK_DELETE_OPTIONS: { label: string; days: number }[] = [
  { label: "Older than 30 days",  days: 30  },
  { label: "Older than 60 days",  days: 60  },
  { label: "Older than 90 days",  days: 90  },
  { label: "Older than 180 days", days: 180 },
  { label: "All notices",         days: 0   },
];

function targetLabel(n: Notice): string {
  if (n.targetType === "whole_school") return "Whole School";
  if (n.targetType === "teacher") return "All Teachers";
  if (n.targetType === "student") return "All Students";
  if (n.targetType === "class") {
    const c = n.targetClass ? `Class ${n.targetClass}` : "Class";
    const s = n.targetSection ? ` – Sec ${n.targetSection}` : " (All Sections)";
    return c + s;
  }
  return n.targetType;
}

function getTypeStyle(t: string | null) {
  return NOTICE_TYPES.find(x => x.value === t) || NOTICE_TYPES[0];
}

export default function NoticeboardAdmin({ schoolId, classes, sections, adminUserId }: Props) {
  const { toast } = useToast();

  // Form state
  const [content, setContent] = useState("");
  const [targetType, setTargetType] = useState("whole_school");
  const [targetClass, setTargetClass] = useState("");
  const [targetSection, setTargetSection] = useState("");
  const [noticeType, setNoticeType] = useState("Routine");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  // Filter state
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  // Bulk delete state
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [bulkDays, setBulkDays] = useState(30);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDays, setPendingDays] = useState<number | null>(null);

  // Ref for outside-click detection (stats card + bulk panel)
  const statsAreaRef = useRef<HTMLDivElement>(null);

  // ── Close panel on back button ─────────────────────────────────────────────
  useEffect(() => {
    if (bulkPanelOpen) {
      // Push a sentinel history entry so Back has something to pop
      window.history.pushState({ bulkNoticePanel: true }, "");
      const handlePop = () => setBulkPanelOpen(false);
      window.addEventListener("popstate", handlePop);
      return () => window.removeEventListener("popstate", handlePop);
    }
  }, [bulkPanelOpen]);

  // ── Close panel on outside click ──────────────────────────────────────────
  useEffect(() => {
    if (!bulkPanelOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (statsAreaRef.current && !statsAreaRef.current.contains(e.target as Node)) {
        setBulkPanelOpen(false);
      }
    };
    // Delay so the toggle-button click that opened it doesn't immediately close it
    const timerId = setTimeout(() => document.addEventListener("mousedown", handleClick), 0);
    return () => {
      clearTimeout(timerId);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [bulkPanelOpen]);

  // ── Data Fetch ────────────────────────────────────────────────────────────
  const { data: allNotices = [], isLoading } = useQuery<Notice[]>({
    queryKey: ["/api/notices", schoolId, "all"],
    queryFn: async () => {
      const r = await fetch(`/api/notices/${schoolId}/all`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  // ── Computed counts ───────────────────────────────────────────────────────
  const totalCount   = allNotices.length;
  const adminCount   = allNotices.filter(n => n.creatorRole === "admin").length;
  const teacherCount = allNotices.filter(n => n.creatorRole === "teacher").length;

  const filteredNotices = roleFilter === "all"
    ? allNotices
    : allNotices.filter(n => n.creatorRole === roleFilter);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidateNotices = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/notices", schoolId, "all"] });

  // "class_only" is a frontend-only sentinel; backend always receives "class"
  const isClassTarget = targetType === "class" || targetType === "class_only";
  const canPost = !!content.trim() &&
    !(isClassTarget && !targetClass) &&
    !(targetType === "class" && !targetSection);

  const postMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", content);
      // Map frontend sentinel "class_only" → backend value "class" (no section)
      fd.append("targetType", targetType === "class_only" ? "class" : targetType);
      fd.append("schoolId", String(schoolId));
      fd.append("noticeType", noticeType);
      if (isClassTarget && targetClass) {
        fd.append("targetClass", targetClass);
        // Only attach a specific section for "Class + Section" mode
        if (targetType === "class" && targetSection && targetSection !== "all") {
          fd.append("targetSection", targetSection);
        }
      }
      const r = await fetch("/api/notices", { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      toast({ title: "Notice Posted", description: "Your notice has been published." });
      setContent(""); setTargetClass(""); setTargetSection("");
      invalidateNotices();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("DELETE", `/api/notices/${id}`, undefined);
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
    },
    onSuccess: () => { toast({ title: "Notice Deleted" }); invalidateNotices(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, content }: { id: number; content: string }) => {
      const r = await apiRequest("PUT", `/api/notices/${id}`, { content });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      toast({ title: "Notice Updated" });
      setEditingId(null); setEditContent("");
      invalidateNotices();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (olderThanDays: number) =>
      apiRequest("DELETE", "/api/admin/notices/bulk", { olderThanDays })
        .then(r => r.json() as Promise<{ deleted: number }>),
    onSuccess: (data) => {
      toast({
        title: "Bulk Delete Complete",
        description: data.deleted === 0
          ? "No notices found for deletion."
          : `${data.deleted} notice(s) permanently deleted.`,
      });
      setConfirmOpen(false);
      setPendingDays(null);
      setBulkPanelOpen(false);   // auto-close panel on success
      invalidateNotices();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function startEdit(n: Notice) { setEditingId(n.id); setEditContent(n.content); }
  function cancelEdit() { setEditingId(null); setEditContent(""); }

  const ROLE_FILTERS: { value: RoleFilter; label: string; count: number; icon: typeof Bell; color: string }[] = [
    { value: "all",     label: "All Notices",     count: totalCount,   icon: Bell,          color: "text-[#D4AF37]" },
    { value: "admin",   label: "Admin Notices",   count: adminCount,   icon: ShieldCheck,   color: "text-amber-400" },
    { value: "teacher", label: "Teacher Notices", count: teacherCount, icon: GraduationCap, color: "text-blue-400"  },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white">Noticeboard</h2>
        <p className="text-white/50 text-sm">Post notices to teachers, classes, or the whole school</p>
      </div>

      {/* ── Post New Notice ── */}
      <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5 space-y-3">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Bell className="w-4 h-4 text-[#D4AF37]" />
          Post New Notice
        </h3>

        <div className="flex gap-3 flex-wrap">
          <Select value={targetType} onValueChange={v => { setTargetType(v); setTargetClass(""); setTargetSection(""); }}>
            <SelectTrigger className="w-44 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARGET_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={noticeType} onValueChange={setNoticeType}>
            <SelectTrigger className="w-36 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {isClassTarget && (
            <Select value={targetClass} onValueChange={setTargetClass}>
              <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-class">
                <SelectValue placeholder="Class *" />
              </SelectTrigger>
              <SelectContent>
                {(classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {targetType === "class" && (
            <Select value={targetSection} onValueChange={setTargetSection}>
              <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-section">
                <SelectValue placeholder="Section *" />
              </SelectTrigger>
              <SelectContent>
                {(sections.length > 0 ? sections : ["A","B","C","D"]).map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <Textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Write your notice here..."
          className="bg-[#0A1628] border-white/20 text-white placeholder:text-white/30 min-h-[100px]"
          data-testid="textarea-notice-content"
        />

        <Button
          disabled={!canPost || postMutation.isPending}
          onClick={() => postMutation.mutate()}
          className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
          data-testid="button-post-notice"
        >
          {postMutation.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <><Send className="w-4 h-4 mr-1" /> Post Notice</>
          }
        </Button>
      </div>

      {/* ── Notice Statistics + collapsible Bulk Delete ── */}
      <div ref={statsAreaRef} className="space-y-0">

        {/* Statistics card */}
        <div
          className={`rounded-xl border bg-[#1A2942] p-4 transition-all duration-200 ${
            bulkPanelOpen
              ? "border-rose-500/30 rounded-b-none border-b-0"
              : "border-white/10"
          }`}
          data-testid="notice-stats"
        >
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#D4AF37]" />
              <h3 className="text-sm font-bold text-white">Notice Statistics</h3>
            </div>
            {/* Bulk-delete toggle icon */}
            <button
              onClick={() => setBulkPanelOpen(prev => !prev)}
              title={bulkPanelOpen ? "Close bulk delete" : "Bulk delete notices"}
              data-testid="button-toggle-bulk-delete"
              className={`p-1.5 rounded-lg transition-all duration-200 ${
                bulkPanelOpen
                  ? "bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40"
                  : "text-white/25 hover:text-rose-400 hover:bg-rose-500/10"
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Stat tiles */}
          {isLoading ? (
            <div className="flex gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex-1 h-14 rounded-lg bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total Notices",   count: totalCount,   color: "text-[#D4AF37]", bg: "bg-[#D4AF37]/10 border-[#D4AF37]/20", testId: "stat-total"   },
                { label: "Admin Notices",   count: adminCount,   color: "text-amber-400",  bg: "bg-amber-400/10 border-amber-400/20",  testId: "stat-admin"   },
                { label: "Teacher Notices", count: teacherCount, color: "text-blue-400",   bg: "bg-blue-400/10 border-blue-400/20",    testId: "stat-teacher" },
              ].map(stat => (
                <div key={stat.label} className={`rounded-lg border ${stat.bg} p-3 text-center`} data-testid={stat.testId}>
                  <p className={`text-2xl font-black tabular-nums ${stat.color}`}>{stat.count}</p>
                  <p className="text-white/50 text-[11px] font-semibold mt-0.5 leading-tight">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Collapsible Bulk Delete panel (accordion via CSS grid trick) ── */}
        <div
          className={`grid transition-[grid-template-rows] duration-250 ease-in-out ${
            bulkPanelOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div
              className="rounded-b-xl border border-t-0 border-rose-500/30 bg-[#1A2942] px-4 pt-3 pb-4 space-y-3"
              data-testid="bulk-delete-panel"
            >
              {/* Panel header */}
              <div className="flex items-center gap-2">
                <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">Manual Bulk Delete</span>
              </div>
              <p className="text-white/40 text-xs">Permanently delete notices. This action is irreversible.</p>

              {/* Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={bulkDays}
                  onChange={e => setBulkDays(parseInt(e.target.value))}
                  className="flex-1 min-w-[170px] px-3 py-2 rounded-lg bg-[#0A1628] border border-white/10 text-white/80 text-xs font-semibold focus:outline-none focus:border-rose-500/60 transition-colors"
                  data-testid="select-bulk-notice-days"
                >
                  {BULK_DELETE_OPTIONS.map(o => (
                    <option key={o.days} value={o.days}>{o.label}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={() => { setPendingDays(bulkDays); setConfirmOpen(true); }}
                  className="h-9 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shrink-0"
                  data-testid="button-bulk-notice-delete-open"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Notices Feed ── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        {/* Card Header */}
        <div className="px-4 py-3 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white text-sm flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#D4AF37]" />
              Recent Notices
            </h3>
            {!isLoading && (
              <span className="text-white/30 text-xs tabular-nums">
                {filteredNotices.length} of {totalCount} notice{totalCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Role Filter Chips */}
          <div className="flex items-center gap-1.5 flex-wrap" data-testid="notice-filter-bar">
            <Filter className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
            {ROLE_FILTERS.map(f => {
              const isActive = roleFilter === f.value;
              const Icon = f.icon;
              return (
                <button
                  key={f.value}
                  onClick={() => setRoleFilter(f.value)}
                  data-testid={`filter-notice-${f.value}`}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border transition-all duration-150 ${
                    isActive
                      ? "bg-[#D4AF37] border-[#D4AF37] text-[#0A1628] shadow-sm"
                      : "bg-white/5 border-white/10 text-white/50 hover:border-white/30 hover:text-white/80"
                  }`}
                >
                  <Icon className={`w-3 h-3 ${isActive ? "text-[#0A1628]" : f.color}`} />
                  {f.label}
                  <span className={`ml-0.5 ${isActive ? "opacity-70" : "opacity-50"}`}>({f.count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Notice List */}
        <div className="overflow-y-auto max-h-[540px] divide-y divide-white/5" data-testid="notice-feed-scroll">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-white/40" />
            </div>
          ) : filteredNotices.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Bell className="w-8 h-8 text-white/10 mx-auto mb-2" />
              <p className="text-white/30 text-sm font-semibold">
                {roleFilter !== "all"
                  ? `No ${roleFilter === "admin" ? "Admin" : "Teacher"} notices posted`
                  : "No notices posted yet"}
              </p>
            </div>
          ) : (
            filteredNotices.map(n => {
              const typeCfg = getTypeStyle(n.noticeType);
              const TypeIcon = typeCfg.icon;
              const isOwn = n.creatorRole === "admin" && n.createdById === adminUserId;
              const isEditing = editingId === n.id;
              const isTeacher = n.creatorRole === "teacher";

              return (
                <div
                  key={n.id}
                  className="px-4 py-3 hover:bg-white/5 transition-colors"
                  data-testid={`card-notice-${n.id}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeIcon className={`w-3.5 h-3.5 flex-shrink-0 ${typeCfg.color}`} strokeWidth={2} />
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25 font-medium">
                        {targetLabel(n)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${typeCfg.color} bg-white/5`}>
                        {typeCfg.label}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                        isTeacher
                          ? "bg-blue-500/15 text-blue-400 border border-blue-500/20"
                          : "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      }`}>
                        {isTeacher ? (n.creatorName ?? "Teacher") : "Admin"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-white/25 text-xs tabular-nums">{fmtDateTime(n.createdAt)}</span>
                      {isOwn && !isEditing && (
                        <>
                          <button
                            onClick={() => startEdit(n)}
                            className="p-1.5 rounded-lg text-white/40 hover:text-[#D4AF37] hover:bg-[#D4AF37]/10 transition-colors"
                            title="Edit notice"
                            data-testid={`button-edit-notice-${n.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => deleteMutation.mutate(n.id)}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
                            title="Delete notice"
                            data-testid={`button-delete-notice-${n.id}`}
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

                  {isEditing ? (
                    <div className="space-y-2 mt-1">
                      <Textarea
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        className="bg-[#0A1628] border-white/20 text-white text-sm min-h-[80px] resize-none"
                        data-testid={`textarea-edit-notice-${n.id}`}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => editMutation.mutate({ id: n.id, content: editContent })}
                          disabled={!editContent.trim() || editMutation.isPending}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] text-xs font-semibold disabled:opacity-50 transition-colors"
                          data-testid={`button-save-notice-${n.id}`}
                        >
                          {editMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors"
                          data-testid={`button-cancel-edit-notice-${n.id}`}
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-white/75 text-sm leading-relaxed">{n.content}</p>
                  )}

                  {n.fileUrl && (
                    <a
                      href={n.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-1 text-xs text-[#D4AF37]/70 underline hover:no-underline"
                    >
                      View Attachment
                    </a>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Bulk Delete Confirmation Modal ── */}
      {confirmOpen && pendingDays !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          data-testid="bulk-notice-delete-modal"
        >
          <div className="bg-[#1A2942] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-rose-500/20 flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirm Bulk Deletion</h3>
                <p className="text-white/40 text-xs mt-0.5">This action cannot be undone</p>
              </div>
            </div>

            <div className="px-4 py-3 rounded-xl bg-rose-900/20 border border-rose-500/30 space-y-1">
              <p className="text-xs text-white/80 font-semibold">
                Are you sure you want to permanently delete{" "}
                {pendingDays === 0
                  ? <span className="text-rose-300 font-bold">all notices</span>
                  : <>notices <span className="text-rose-300 font-bold">older than {pendingDays} days</span></>
                }?
              </p>
              <p className="text-[11px] text-white/40">This action cannot be undone.</p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setConfirmOpen(false); setPendingDays(null); }}
                disabled={bulkDeleteMutation.isPending}
                className="flex-1 h-9 text-white/60 hover:text-white font-bold text-xs border border-white/10 rounded-xl"
                data-testid="button-bulk-notice-cancel"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => bulkDeleteMutation.mutate(pendingDays)}
                disabled={bulkDeleteMutation.isPending}
                className="flex-1 h-9 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl"
                data-testid="button-bulk-notice-confirm"
              >
                {bulkDeleteMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><Trash2 className="w-3.5 h-3.5 mr-1" /> Yes, Delete</>
                }
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
