import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Bell, Send, Loader2, Pencil, Trash2, Check, X,
  Megaphone, BookOpen, AlertTriangle, Info,
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
  fileUrl: string | null;
  createdAt: string;
}

const TARGET_TYPES = [
  { value: "whole_school", label: "Whole School" },
  { value: "teacher",      label: "All Teachers" },
  { value: "student",      label: "All Students" },
  { value: "class",        label: "Specific Class" },
];

const NOTICE_TYPES = [
  { value: "Routine",  label: "Routine",  icon: Info,          color: "text-gray-400" },
  { value: "Academic", label: "Academic", icon: BookOpen,      color: "text-blue-400" },
  { value: "Event",    label: "Event",    icon: Megaphone,     color: "text-purple-400" },
  { value: "Urgent",   label: "Urgent",   icon: AlertTriangle, color: "text-red-400" },
];

function targetLabel(n: Notice): string {
  if (n.targetType === "whole_school") return "Whole School";
  if (n.targetType === "teacher") return "All Teachers";
  if (n.targetType === "student") return "All Students";
  if (n.targetType === "class") {
    const c = n.targetClass ? `Class ${n.targetClass}` : "Class";
    const s = n.targetSection ? ` – ${n.targetSection}` : "";
    return c + s;
  }
  return n.targetType;
}

function senderLabel(n: Notice): string {
  return n.creatorRole === "teacher" ? "Teacher" : "Admin";
}

function formatDate(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function getTypeStyle(t: string | null) {
  const cfg = NOTICE_TYPES.find(x => x.value === t) || NOTICE_TYPES[0];
  return cfg;
}

export default function NoticeboardAdmin({ schoolId, classes, sections, adminUserId }: Props) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [targetType, setTargetType] = useState("whole_school");
  const [targetClass, setTargetClass] = useState("");
  const [targetSection, setTargetSection] = useState("");
  const [noticeType, setNoticeType] = useState("Routine");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  const { data: allNotices = [], isLoading } = useQuery<Notice[]>({
    queryKey: ["/api/notices", schoolId, "all"],
    queryFn: async () => {
      const r = await fetch(`/api/notices/${schoolId}/all`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", content);
      fd.append("targetType", targetType);
      fd.append("schoolId", String(schoolId));
      fd.append("noticeType", noticeType);
      if (targetType === "class" && targetClass) {
        fd.append("targetClass", targetClass);
        if (targetSection) fd.append("targetSection", targetSection);
      }
      const r = await fetch("/api/notices", { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      toast({ title: "Notice Posted", description: "Your notice has been published." });
      setContent("");
      setTargetClass("");
      setTargetSection("");
      queryClient.invalidateQueries({ queryKey: ["/api/notices", schoolId, "all"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("DELETE", `/api/notices/${id}`, undefined);
      if (!r.ok) { const e = await r.json(); throw new Error(e.message); }
    },
    onSuccess: () => {
      toast({ title: "Notice Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/notices", schoolId, "all"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/notices", schoolId, "all"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function startEdit(n: Notice) {
    setEditingId(n.id);
    setEditContent(n.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent("");
  }

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
          {/* Target */}
          <Select value={targetType} onValueChange={v => { setTargetType(v); setTargetClass(""); setTargetSection(""); }}>
            <SelectTrigger className="w-44 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARGET_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Type */}
          <Select value={noticeType} onValueChange={setNoticeType}>
            <SelectTrigger className="w-36 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Class + Section (when class selected) */}
          {targetType === "class" && (
            <>
              <Select value={targetClass} onValueChange={setTargetClass}>
                <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-class">
                  <SelectValue placeholder="Class" />
                </SelectTrigger>
                <SelectContent>
                  {(classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={targetSection} onValueChange={setTargetSection}>
                <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-notice-section">
                  <SelectValue placeholder="Section (opt)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sections</SelectItem>
                  {(sections.length > 0 ? sections : ["A","B","C","D"]).map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
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
          disabled={!content.trim() || postMutation.isPending}
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

      {/* ── Last 50 Notices Feed ── */}
      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h3 className="font-semibold text-white text-sm flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#D4AF37]" />
            Recent Notices
            <span className="text-white/40 font-normal text-xs">(last 50)</span>
          </h3>
          {!isLoading && (
            <span className="text-white/30 text-xs">{allNotices.length} notice{allNotices.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        <div className="overflow-y-auto max-h-[520px] divide-y divide-white/5" data-testid="notice-feed-scroll">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-white/40" />
            </div>
          ) : allNotices.length === 0 ? (
            <p className="text-center text-white/30 py-10 text-sm">No notices posted yet</p>
          ) : (
            allNotices.map(n => {
              const typeCfg = getTypeStyle(n.noticeType);
              const TypeIcon = typeCfg.icon;
              const isOwn = n.creatorRole === "admin" && n.createdById === adminUserId;
              const isEditing = editingId === n.id;

              return (
                <div
                  key={n.id}
                  className="px-4 py-3 hover:bg-white/5 transition-colors"
                  data-testid={`card-notice-${n.id}`}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeIcon className={`w-3.5 h-3.5 flex-shrink-0 ${typeCfg.color}`} strokeWidth={2} />
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#D4AF37]/15 text-[#D4AF37] border border-[#D4AF37]/25 font-medium">
                        {targetLabel(n)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${typeCfg.color} bg-white/5`}>
                        {typeCfg.label}
                      </span>
                      <span className="text-white/30 text-xs">by {senderLabel(n)}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-white/25 text-xs tabular-nums">{formatDate(n.createdAt)}</span>
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

                  {/* Content / edit area */}
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
                          <X className="w-3 h-3" />
                          Cancel
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
    </div>
  );
}
