import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Check, X, BookOpen, Image, UserCheck, Loader2,
  CalendarOff, ImageOff, BookMarked, Users, Inbox, Eye, Paperclip, UserCircle2,
  History, CheckCircle2, XCircle, Camera, Plus, Trash2, MapPin, Images,
  ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon, ArrowLeft,
  Upload, FileText, Download, User,
} from "lucide-react";
import { fmtDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSchoolConfigStrict } from "@/hooks/use-school-config";

interface Props { schoolId: number; initialSection?: string | null; onNavigateSection?: (sec: string | null) => void; allowedSubs?: string[]; }

// ── Section colours keyed by variant ──────────────────────────────────────────
const VARIANTS = {
  teacher: {
    gradient: "linear-gradient(135deg, #0ea5e9, #06b6d4)",
    glow: "rgba(14,165,233,0.25)",
    border: "rgba(14,165,233,0.20)",
    borderHover: "rgba(14,165,233,0.45)",
    badge: "from-sky-500 to-cyan-500",
    emptyIcon: CalendarOff,
    emptyColor: "text-sky-400/50",
    emptyBg: "rgba(14,165,233,0.08)",
  },
  student: {
    gradient: "linear-gradient(135deg, #818cf8, #6366f1)",
    glow: "rgba(99,102,241,0.25)",
    border: "rgba(99,102,241,0.20)",
    borderHover: "rgba(99,102,241,0.45)",
    badge: "from-indigo-500 to-violet-500",
    emptyIcon: Users,
    emptyColor: "text-indigo-400/50",
    emptyBg: "rgba(99,102,241,0.08)",
  },
  gallery: {
    gradient: "linear-gradient(135deg, #a855f7, #ec4899)",
    glow: "rgba(168,85,247,0.25)",
    border: "rgba(168,85,247,0.20)",
    borderHover: "rgba(168,85,247,0.45)",
    badge: "from-purple-500 to-pink-500",
    emptyIcon: ImageOff,
    emptyColor: "text-purple-400/50",
    emptyBg: "rgba(168,85,247,0.08)",
  },
  ebook: {
    gradient: "linear-gradient(135deg, #f59e0b, #f97316)",
    glow: "rgba(245,158,11,0.25)",
    border: "rgba(245,158,11,0.20)",
    borderHover: "rgba(245,158,11,0.45)",
    badge: "from-amber-500 to-orange-500",
    emptyIcon: BookMarked,
    emptyColor: "text-amber-400/50",
    emptyBg: "rgba(245,158,11,0.08)",
  },
} as const;

type Variant = keyof typeof VARIANTS;

// ── Glassmorphic Section shell ─────────────────────────────────────────────────
function Section({
  title, icon: Icon, badge, variant, children,
}: {
  title: string;
  icon: React.ElementType;
  badge?: number;
  variant: Variant;
  children: React.ReactNode;
}) {
  const v = VARIANTS[variant];
  return (
    <div
      className="rounded-2xl p-5 transition-all duration-300"
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: `1px solid ${v.border}`,
        boxShadow: `0 4px 24px ${v.glow}`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{
            background: v.gradient,
            boxShadow: `0 0 16px ${v.glow}`,
          }}
        >
          <Icon className="w-4 h-4 text-white" />
        </div>
        <h3 className="font-bold text-white tracking-tight">{title}</h3>
        {badge !== undefined && badge > 0 && (
          <span
            className={`ml-auto px-2.5 py-0.5 rounded-full text-xs font-bold text-white bg-gradient-to-r ${v.badge} shadow-lg`}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Empty state slot ───────────────────────────────────────────────────────────
function EmptyState({ label, variant }: { label: string; variant: Variant }) {
  const v = VARIANTS[variant];
  const EmptyIcon = v.emptyIcon;
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: v.emptyBg }}
      >
        <EmptyIcon className={`w-6 h-6 ${v.emptyColor}`} />
      </div>
      <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
        {label}
      </p>
    </div>
  );
}

// ── Glassmorphic item row ──────────────────────────────────────────────────────
function ItemRow({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div
      className="group flex items-center justify-between gap-3 p-3 rounded-xl
        transition-all duration-200 cursor-default
        hover:scale-[1.015]"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.20)";
        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.07)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)";
        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
      }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

// ── Approve / Reject button pair ───────────────────────────────────────────────
function ActionButtons({
  disabled,
  onApprove,
  onReject,
  approveLabel = "Approve",
  approveTestId,
  rejectTestId,
}: {
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  approveLabel?: string;
  approveTestId: string;
  rejectTestId: string;
}) {
  return (
    <div className="flex gap-2 shrink-0">
      <button
        disabled={disabled}
        onClick={onApprove}
        data-testid={approveTestId}
        className="flex items-center gap-1 h-7 px-3 rounded-lg text-xs font-semibold
          text-white transition-all duration-150 disabled:opacity-50
          hover:brightness-110 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #16a34a, #22c55e)",
          boxShadow: "0 2px 10px rgba(34,197,94,0.30)",
        }}
      >
        <Check className="w-3 h-3" /> {approveLabel}
      </button>
      <button
        disabled={disabled}
        onClick={onReject}
        data-testid={rejectTestId}
        className="flex items-center gap-1 h-7 px-3 rounded-lg text-xs font-semibold
          text-red-400 transition-all duration-150 disabled:opacity-50
          hover:bg-red-500/15 active:scale-95"
        style={{
          border: "1px solid rgba(239,68,68,0.40)",
          background: "rgba(239,68,68,0.08)",
        }}
      >
        <X className="w-3 h-3" /> Reject
      </button>
    </div>
  );
}

// ── Gallery Hub types ──────────────────────────────────────────────────────────
interface GalleryItemWithTeacher {
  id: number; schoolId: number; uploadedById: number; title: string;
  description: string | null; eventTag: string | null; capturedDate: string | null;
  capturedTime: string | null; location: string | null; imageUrl: string;
  approved: boolean; createdAt: string; teacherName: string | null;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
      <p className="text-[11px] font-semibold mb-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{label}</p>
      <p className="text-sm text-white">{value}</p>
    </div>
  );
}

// ── Gallery Hub ────────────────────────────────────────────────────────────────
function GalleryHub({ schoolId }: { schoolId: number }) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"gallery-images" | "gallery-approval">("gallery-images");
  const [showUpload, setShowUpload] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [viewGroup, setViewGroup] = useState<GalleryItemWithTeacher[] | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [eventName, setEventName] = useState("");
  const [capturedDate, setCapturedDate] = useState("");
  const [capturedTime, setCapturedTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: allItems = [], isLoading } = useQuery<GalleryItemWithTeacher[]>({
    queryKey: ["/api/admin/gallery", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/admin/gallery/${schoolId}`, { credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: r.statusText }));
        console.error("[GalleryHub] API error", r.status, err);
        return [];
      }
      return r.json();
    },
    enabled: !!schoolId,
  });

  const approvedItems = allItems.filter(i => i.approved);
  const previewItem = previewIdx !== null ? approvedItems[previewIdx] ?? null : null;
  const pendingItems  = allItems.filter(i => !i.approved);

  const pendingGroups = useMemo(() => {
    const map = new Map<string, GalleryItemWithTeacher[]>();
    for (const item of pendingItems) {
      const key = `${item.uploadedById}|${item.title}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.values());
  }, [pendingItems]);

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/gallery", schoolId] });
    queryClient.invalidateQueries({ queryKey: ["/api/gallery", schoolId] });
    queryClient.invalidateQueries({ queryKey: ["/api/gallery", schoolId, "all"] });
  };

  const approveMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map(id => apiRequest("PATCH", `/api/gallery/${id}/approve`)));
    },
    onSuccess: () => {
      toast({ title: "Gallery Approved", description: "Images are now live in the school gallery." });
      refetch();
      setViewGroup(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async ({ ids, reason }: { ids: number[]; reason?: string }) => {
      await apiRequest("POST", "/api/gallery/batch-delete", { ids, reason });
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.reason === "rejected" ? "Submission Rejected" : `${vars.ids.length} image${vars.ids.length > 1 ? "s" : ""} deleted` });
      setSelectedIds(new Set());
      setViewGroup(null);
      refetch();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function resetForm() {
    setTitle(""); setEventName(""); setCapturedDate(""); setCapturedTime("");
    setLocation(""); setDescription(""); setSelectedFiles([]); setPreviews([]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 10);
    setSelectedFiles(files);
    setPreviews(files.map(f => URL.createObjectURL(f)));
  }

  async function handleUpload() {
    if (!title.trim() || selectedFiles.length === 0) {
      toast({ title: "Required fields missing", description: "Add a title and select at least one image.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("schoolId", String(schoolId));
      if (eventName) fd.append("eventTag", eventName);
      if (capturedDate) fd.append("capturedDate", capturedDate);
      if (capturedTime) fd.append("capturedTime", capturedTime);
      if (location) fd.append("location", location);
      if (description) fd.append("description", description);
      selectedFiles.forEach(f => fd.append("images", f));
      const r = await fetch("/api/gallery/batch", { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) throw new Error((await r.json()).message || "Upload failed");
      toast({ title: "Photos uploaded & published", description: "Images are now live in the gallery." });
      refetch();
      setShowUpload(false);
      resetForm();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const isPendingMutation = approveMutation.isPending || batchDeleteMutation.isPending;

  return (
    <div
      className="rounded-2xl transition-all duration-300"
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(168,85,247,0.22)",
        boxShadow: "0 4px 28px rgba(168,85,247,0.16)",
      }}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-4">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)", boxShadow: "0 0 18px rgba(168,85,247,0.40)" }}
        >
          <Image className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-white tracking-tight text-base">Gallery Hub</h3>
          <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>Manage & approve school photos</p>
        </div>
        {pendingItems.length > 0 && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white bg-gradient-to-r from-purple-500 to-pink-500 shadow-lg">
            {pendingItems.length} pending
          </span>
        )}
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:brightness-110 active:scale-95"
          style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)", color: "#fff", boxShadow: "0 4px 16px rgba(168,85,247,0.40)" }}
          data-testid="button-gallery-hub-upload"
        >
          <Plus className="w-3.5 h-3.5" /> Upload
        </button>
      </div>

      {/* ── Tab Switcher ── */}
      <div className="px-5 pb-5">
        <div
          className="flex gap-1 p-1 rounded-xl mb-4"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}
        >
          {(["gallery-images", "gallery-approval"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelectedIds(new Set()); }}
              className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all duration-200"
              style={{
                background: activeTab === tab ? "linear-gradient(135deg, #a855f7, #ec4899)" : "transparent",
                color: activeTab === tab ? "#fff" : "rgba(255,255,255,0.55)",
                boxShadow: activeTab === tab ? "0 2px 14px rgba(168,85,247,0.35)" : "none",
              }}
              data-testid={`tab-gallery-hub-${tab}`}
            >
              {tab === "gallery-images"
                ? `🖼 Gallery Images (${approvedItems.length})`
                : `⏳ Gallery Approval (${pendingItems.length})`}
            </button>
          ))}
        </div>

        {/* ── TAB A: Gallery Images ── */}
        {activeTab === "gallery-images" && (
          <div>
            {/* ── Action bar ── */}
            {approvedItems.length > 0 && (
              <div className="flex items-center justify-between mb-4 gap-3">
                <button
                  onClick={() =>
                    selectedIds.size === approvedItems.length
                      ? setSelectedIds(new Set())
                      : setSelectedIds(new Set(approvedItems.map(i => i.id)))
                  }
                  className="text-xs font-semibold transition-colors flex items-center gap-1.5"
                  style={{ color: selectedIds.size === approvedItems.length ? "#c084fc" : "rgba(255,255,255,0.45)" }}
                  data-testid="button-gallery-select-all"
                >
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      background: selectedIds.size === approvedItems.length ? "#a855f7" : "transparent",
                      border: `2px solid ${selectedIds.size === approvedItems.length ? "#a855f7" : "rgba(255,255,255,0.30)"}`,
                    }}
                  >
                    {selectedIds.size === approvedItems.length && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  {selectedIds.size === approvedItems.length ? "Deselect All" : "Select All"}
                </button>

                {selectedIds.size > 0 ? (
                  <button
                    disabled={batchDeleteMutation.isPending}
                    onClick={() => batchDeleteMutation.mutate({ ids: Array.from(selectedIds) })}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all
                      hover:brightness-110 active:scale-95 disabled:opacity-50"
                    style={{
                      background: "linear-gradient(135deg, #ef4444, #dc2626)",
                      color: "#fff",
                      boxShadow: "0 4px 16px rgba(239,68,68,0.40)",
                    }}
                    data-testid="button-gallery-delete-selected"
                  >
                    {batchDeleteMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />}
                    Delete {selectedIds.size} Selected
                  </button>
                ) : (
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.30)" }}>
                    {approvedItems.length} photo{approvedItems.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "rgba(255,255,255,0.30)" }} />
              </div>
            ) : approvedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.18)" }}
                >
                  <ImageOff className="w-7 h-7 text-purple-400/50" />
                </div>
                <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.50)" }}>No approved images yet</p>
                <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.28)" }}>
                  Approve teacher submissions from the Gallery Approval tab,<br />or upload directly using the Upload button above.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {approvedItems.map(item => {
                  const sel = selectedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      data-testid={`card-gallery-img-${item.id}`}
                      className="relative rounded-2xl overflow-hidden group cursor-pointer transition-all duration-250"
                      style={{
                        border: sel
                          ? "2px solid #a855f7"
                          : "1px solid rgba(255,255,255,0.09)",
                        boxShadow: sel
                          ? "0 0 0 4px rgba(168,85,247,0.22), 0 8px 32px rgba(168,85,247,0.22)"
                          : "0 4px 18px rgba(0,0,0,0.30)",
                        transform: sel ? "scale(1.02)" : "scale(1)",
                      }}
                      onMouseEnter={e => {
                        if (!sel) {
                          (e.currentTarget as HTMLDivElement).style.border = "1px solid rgba(168,85,247,0.45)";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 28px rgba(168,85,247,0.25)";
                          (e.currentTarget as HTMLDivElement).style.transform = "scale(1.025)";
                        }
                      }}
                      onMouseLeave={e => {
                        if (!sel) {
                          (e.currentTarget as HTMLDivElement).style.border = "1px solid rgba(255,255,255,0.09)";
                          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 18px rgba(0,0,0,0.30)";
                          (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
                        }
                      }}
                    >
                      {/* Image — click to preview */}
                      <div
                        className="relative h-44 overflow-hidden cursor-zoom-in"
                        onClick={() => setPreviewIdx(approvedItems.indexOf(item))}
                      >
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="w-full h-full object-cover transition-transform duration-400 group-hover:scale-[1.06]"
                        />

                        {/* Selection tint */}
                        {sel && (
                          <div
                            className="absolute inset-0"
                            style={{ background: "rgba(168,85,247,0.18)" }}
                          />
                        )}

                        {/* Hover gradient (bottom-up) */}
                        <div
                          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
                          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 50%)" }}
                        />

                        {/* Trash — hover-only (always shown when selected) */}
                        <button
                          onClick={e => { e.stopPropagation(); toggleSelect(item.id); }}
                          data-testid={`button-gallery-trash-${item.id}`}
                          title={sel ? "Deselect" : "Mark for deletion"}
                          className={`absolute top-2 right-2 flex items-center justify-center w-7 h-7 rounded-full
                            transition-all duration-200 hover:scale-110 active:scale-95 z-10
                            ${sel ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                          style={{
                            background: sel ? "rgba(239,68,68,0.90)" : "rgba(0,0,0,0.60)",
                            backdropFilter: "blur(6px)",
                            border: sel ? "1.5px solid rgba(239,68,68,0.95)" : "1.5px solid rgba(255,255,255,0.30)",
                            boxShadow: sel ? "0 0 14px rgba(239,68,68,0.55)" : "none",
                          }}
                        >
                          <Trash2
                            className="w-3.5 h-3.5"
                            style={{ color: "#fff" }}
                          />
                        </button>

                        {/* Event tag pill — hover only */}
                        {item.eventTag && (
                          <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                            <span
                              className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold"
                              style={{ background: "rgba(168,85,247,0.80)", color: "#f0e6ff", backdropFilter: "blur(4px)" }}
                            >
                              {item.eventTag}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Caption bar */}
                      <div
                        className="px-3 py-2.5"
                        style={{ background: "rgba(10,16,32,0.92)" }}
                      >
                        <p className="text-white font-semibold text-xs leading-snug truncate">{item.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {item.eventTag && (
                            <span className="text-[10px] truncate" style={{ color: "rgba(192,132,252,0.80)" }}>
                              {item.eventTag}
                            </span>
                          )}
                          {item.capturedDate && (
                            <span className="text-[10px] flex items-center gap-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                              <CalendarIcon className="w-2.5 h-2.5" />
                              {fmtDate(item.capturedDate)}
                            </span>
                          )}
                          {!item.eventTag && !item.capturedDate && item.location && (
                            <span className="text-[10px] flex items-center gap-0.5 truncate" style={{ color: "rgba(255,255,255,0.35)" }}>
                              <MapPin className="w-2.5 h-2.5" />
                              {item.location}
                            </span>
                          )}
                        </div>
                        {sel && (
                          <div className="mt-1.5 flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            <span className="text-[10px] font-semibold" style={{ color: "#f87171" }}>
                              Marked for deletion
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bottom delete confirmation strip */}
            {selectedIds.size > 0 && (
              <div
                className="mt-4 flex items-center justify-between gap-3 px-4 py-3 rounded-2xl"
                style={{
                  background: "rgba(239,68,68,0.10)",
                  border: "1px solid rgba(239,68,68,0.30)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 flex-shrink-0" style={{ color: "#f87171" }} />
                  <p className="text-sm font-semibold" style={{ color: "#f87171" }}>
                    {selectedIds.size} image{selectedIds.size !== 1 ? "s" : ""} selected for deletion
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
                    style={{ color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.07)" }}
                    data-testid="button-gallery-cancel-delete"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={batchDeleteMutation.isPending}
                    onClick={() => batchDeleteMutation.mutate({ ids: Array.from(selectedIds) })}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all
                      hover:brightness-110 active:scale-95 disabled:opacity-50"
                    style={{
                      background: "linear-gradient(135deg,#ef4444,#dc2626)",
                      color: "#fff",
                      boxShadow: "0 4px 14px rgba(239,68,68,0.40)",
                    }}
                    data-testid="button-gallery-confirm-delete"
                  >
                    {batchDeleteMutation.isPending
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Trash2 className="w-3 h-3" />}
                    Confirm Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB B: Gallery Approval ── */}
        {activeTab === "gallery-approval" && (
          <div>
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "rgba(255,255,255,0.30)" }} />
              </div>
            ) : pendingGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(168,85,247,0.08)" }}>
                  <ImageOff className="w-6 h-6 text-purple-400/50" />
                </div>
                <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.50)" }}>No pending gallery submissions</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingGroups.map((group, gi) => {
                  const first = group[0];
                  return (
                    <div
                      key={gi}
                      className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200 hover:scale-[1.015]"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(168,85,247,0.18)" }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(168,85,247,0.42)";
                        (e.currentTarget as HTMLDivElement).style.background = "rgba(168,85,247,0.07)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(168,85,247,0.18)";
                        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
                      }}
                      data-testid={`card-gallery-pending-group-${gi}`}
                    >
                      <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0" style={{ border: "1px solid rgba(168,85,247,0.20)" }}>
                        <img src={first.imageUrl} alt={first.title} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-sm truncate">{first.title}</p>
                        <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                          {first.teacherName ?? "Unknown Teacher"}
                          {group.length > 1 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: "rgba(168,85,247,0.22)", color: "#c084fc" }}>
                              {group.length} photos
                            </span>
                          )}
                        </p>
                        {first.eventTag && (
                          <p className="text-[10px] mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.38)" }}>{first.eventTag}</p>
                        )}
                      </div>
                      <button
                        onClick={() => { setViewGroup(group); setLightboxIdx(0); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                          transition-all hover:brightness-110 active:scale-95 flex-shrink-0"
                        style={{ background: "rgba(168,85,247,0.15)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.32)" }}
                        data-testid={`button-view-gallery-group-${gi}`}
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Single Image Preview Modal ── */}
      {previewItem && previewIdx !== null && (
        <Dialog open={!!previewItem} onOpenChange={v => { if (!v) setPreviewIdx(null); }}>
          <DialogContent
            className="max-w-2xl max-h-[92vh] flex flex-col p-0 overflow-hidden"
            style={{ background: "#070d1a", border: "1px solid rgba(168,85,247,0.30)" }}
          >
            {/* Full image with left/right nav */}
            <div className="relative flex-shrink-0" style={{ maxHeight: "62vh" }}>
              <img
                src={previewItem.imageUrl}
                alt={previewItem.title}
                className="w-full object-contain"
                style={{ maxHeight: "62vh", background: "#000" }}
              />

              {/* Prev arrow */}
              {previewIdx > 0 && (
                <button
                  onClick={() => setPreviewIdx(previewIdx - 1)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full z-20
                    transition-all hover:scale-110 active:scale-95"
                  style={{ background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.22)", backdropFilter: "blur(6px)" }}
                  data-testid="button-preview-prev"
                >
                  <ChevronLeft className="w-5 h-5 text-white" />
                </button>
              )}

              {/* Next arrow */}
              {previewIdx < approvedItems.length - 1 && (
                <button
                  onClick={() => setPreviewIdx(previewIdx + 1)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full z-20
                    transition-all hover:scale-110 active:scale-95"
                  style={{ background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.22)", backdropFilter: "blur(6px)" }}
                  data-testid="button-preview-next"
                >
                  <ChevronRight className="w-5 h-5 text-white" />
                </button>
              )}

              {/* Close button */}
              <button
                onClick={() => setPreviewIdx(null)}
                className="absolute top-3 right-3 flex items-center justify-center w-8 h-8 rounded-full z-20
                  transition-all hover:scale-110 active:scale-95"
                style={{ background: "rgba(0,0,0,0.70)", border: "1px solid rgba(255,255,255,0.20)" }}
                data-testid="button-preview-close"
              >
                <X className="w-4 h-4 text-white" />
              </button>

              {/* Counter pill */}
              <div className="absolute top-3 left-3 z-20">
                <span
                  className="px-2.5 py-1 rounded-full text-[11px] font-bold"
                  style={{ background: "rgba(0,0,0,0.65)", color: "rgba(255,255,255,0.80)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  {previewIdx + 1} / {approvedItems.length}
                </span>
              </div>

              {/* Event tag overlay */}
              {previewItem.eventTag && (
                <div className="absolute bottom-3 left-3 z-10">
                  <span
                    className="px-3 py-1 rounded-full text-xs font-bold"
                    style={{ background: "rgba(168,85,247,0.85)", color: "#f0e6ff", backdropFilter: "blur(6px)" }}
                  >
                    {previewItem.eventTag}
                  </span>
                </div>
              )}
            </div>

            {/* Thumbnail strip */}
            {approvedItems.length > 1 && (
              <div
                className="flex gap-1.5 px-4 py-2 overflow-x-auto flex-shrink-0"
                style={{ background: "rgba(0,0,0,0.40)", borderTop: "1px solid rgba(255,255,255,0.07)" }}
              >
                {approvedItems.map((img, i) => (
                  <button
                    key={img.id}
                    onClick={() => setPreviewIdx(i)}
                    className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden transition-all"
                    style={{
                      border: i === previewIdx ? "2px solid #a855f7" : "2px solid transparent",
                      opacity: i === previewIdx ? 1 : 0.45,
                      boxShadow: i === previewIdx ? "0 0 10px rgba(168,85,247,0.55)" : "none",
                    }}
                    data-testid={`thumb-preview-${img.id}`}
                  >
                    <img src={img.imageUrl} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Metadata panel */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <div>
                <h3 className="text-white font-bold text-base leading-snug">{previewItem.title}</h3>
                {previewItem.description && (
                  <p className="text-sm mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,0.60)" }}>
                    {previewItem.description}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {previewItem.capturedDate && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <CalendarIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#c084fc" }} />
                    <div>
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>Date</p>
                      <p className="text-xs text-white font-medium">{fmtDate(previewItem.capturedDate)}</p>
                    </div>
                  </div>
                )}
                {previewItem.capturedTime && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#c084fc" }} />
                    <div>
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>Time</p>
                      <p className="text-xs text-white font-medium">{previewItem.capturedTime}</p>
                    </div>
                  </div>
                )}
                {previewItem.location && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl col-span-2"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#c084fc" }} />
                    <div>
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>Venue</p>
                      <p className="text-xs text-white font-medium">{previewItem.location}</p>
                    </div>
                  </div>
                )}
                {previewItem.teacherName && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl col-span-2"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <UserCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#c084fc" }} />
                    <div>
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>Uploaded by</p>
                      <p className="text-xs text-white font-medium">{previewItem.teacherName}</p>
                    </div>
                  </div>
                )}
              </div>
              {/* Delete this image */}
              <button
                onClick={() => {
                  batchDeleteMutation.mutate({ ids: [previewItem.id] });
                  setPreviewIdx(null);
                }}
                disabled={batchDeleteMutation.isPending}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold
                  transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                style={{
                  background: "rgba(239,68,68,0.10)",
                  color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.28)",
                }}
                data-testid={`button-preview-delete-${previewItem.id}`}
              >
                <Trash2 className="w-4 h-4" /> Delete this photo
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Upload Dialog ── */}
      <Dialog open={showUpload} onOpenChange={v => { if (!v) resetForm(); setShowUpload(v); }}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col bg-white">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-gray-900">
              <Camera className="w-5 h-5 text-purple-600" />
              Upload Photos to Gallery
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-0.5 mt-1">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Album / Image Title *</label>
              <Input placeholder="e.g. Annual Sports Day 2026" value={title} onChange={e => setTitle(e.target.value)} data-testid="input-hub-gallery-title" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Event Name</label>
              <Input placeholder="e.g. Republic Day Celebration" value={eventName} onChange={e => setEventName(e.target.value)} data-testid="input-hub-gallery-event" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block flex items-center gap-1">
                  <CalendarIcon className="w-3 h-3" /> Captured Date
                </label>
                <Input type="date" value={capturedDate} onChange={e => setCapturedDate(e.target.value)} data-testid="input-hub-gallery-date" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Captured Time
                </label>
                <Input type="time" value={capturedTime} onChange={e => setCapturedTime(e.target.value)} data-testid="input-hub-gallery-time" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Location / Venue
              </label>
              <Input placeholder="e.g. School Auditorium" value={location} onChange={e => setLocation(e.target.value)} data-testid="input-hub-gallery-location" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Description</label>
              <Textarea placeholder="Brief description (optional)…" value={description} onChange={e => setDescription(e.target.value)} className="resize-none" rows={2} data-testid="input-hub-gallery-desc" />
            </div>
            <div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full py-3 rounded-xl border-2 border-dashed text-sm font-medium transition-colors"
                style={{ borderColor: selectedFiles.length ? "#a855f7" : "#e5e7eb", color: selectedFiles.length ? "#a855f7" : "#9ca3af" }}
                data-testid="button-hub-select-images"
              >
                <Images className="w-4 h-4 inline mr-2" />
                {selectedFiles.length
                  ? `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected`
                  : "Select Images (up to 10)"}
              </button>
              <input type="file" ref={fileRef} accept="image/*" multiple className="hidden" onChange={handleFileSelect} data-testid="input-hub-gallery-file" />
            </div>
            {previews.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {previews.map((url, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => {
                        setSelectedFiles(f => f.filter((_, j) => j !== i));
                        setPreviews(p => p.filter((_, j) => j !== i));
                      }}
                      className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                      data-testid={`button-hub-remove-preview-${i}`}
                    ><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="flex-shrink-0 pt-3 gap-2">
            <Button variant="outline" onClick={() => { resetForm(); setShowUpload(false); }} data-testid="button-hub-cancel-upload">Cancel</Button>
            <button
              disabled={isUploading || !title.trim() || selectedFiles.length === 0}
              onClick={handleUpload}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold
                transition-all disabled:opacity-50 hover:brightness-110 active:scale-95"
              style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)", color: "#fff" }}
              data-testid="button-hub-submit-upload"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {isUploading ? "Uploading…" : "Upload Photos"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Inspection Modal ── */}
      {viewGroup && (
        <Dialog open={!!viewGroup} onOpenChange={v => { if (!v) setViewGroup(null); }}>
          <DialogContent
            className="max-w-2xl max-h-[92vh] flex flex-col"
            style={{ background: "#0A1628", border: "1px solid rgba(168,85,247,0.32)", color: "#fff" }}
          >
            <DialogHeader className="flex-shrink-0">
              <DialogTitle className="text-white flex items-center gap-2 flex-wrap">
                <Image className="w-4 h-4 flex-shrink-0" style={{ color: "#a855f7" }} />
                <span className="truncate">{viewGroup[0].title}</span>
                <span
                  className="ml-auto text-xs font-normal px-2.5 py-1 rounded-full flex-shrink-0"
                  style={{ background: "rgba(168,85,247,0.15)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.25)" }}
                >
                  by {viewGroup[0].teacherName ?? "Principal"}
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto space-y-4 mt-2 pr-1">
              {/* Image viewer */}
              {viewGroup.length === 1 ? (
                <img
                  src={viewGroup[0].imageUrl} alt={viewGroup[0].title}
                  className="w-full max-h-72 object-contain rounded-xl"
                  style={{ background: "rgba(0,0,0,0.45)" }}
                />
              ) : (
                <div>
                  <div className="relative">
                    <img
                      src={viewGroup[lightboxIdx].imageUrl} alt=""
                      className="w-full h-64 object-contain rounded-xl"
                      style={{ background: "rgba(0,0,0,0.45)" }}
                    />
                    {lightboxIdx > 0 && (
                      <button
                        onClick={() => setLightboxIdx(i => i - 1)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0,0,0,0.65)" }}
                        data-testid="button-lightbox-prev"
                      ><ChevronLeft className="w-4 h-4 text-white" /></button>
                    )}
                    {lightboxIdx < viewGroup.length - 1 && (
                      <button
                        onClick={() => setLightboxIdx(i => i + 1)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0,0,0,0.65)" }}
                        data-testid="button-lightbox-next"
                      ><ChevronRight className="w-4 h-4 text-white" /></button>
                    )}
                  </div>
                  <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                    {viewGroup.map((item, i) => (
                      <button
                        key={item.id}
                        onClick={() => setLightboxIdx(i)}
                        className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 transition-all"
                        style={{ border: `2px solid ${i === lightboxIdx ? "#a855f7" : "transparent"}`, opacity: i === lightboxIdx ? 1 : 0.5 }}
                        data-testid={`thumb-gallery-${item.id}`}
                      >
                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                  <p className="text-center text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.38)" }}>
                    {lightboxIdx + 1} / {viewGroup.length}
                  </p>
                </div>
              )}

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {viewGroup[0].eventTag && <MetaRow label="Event Name" value={viewGroup[0].eventTag} />}
                {viewGroup[0].capturedDate && <MetaRow label="Captured Date" value={viewGroup[0].capturedDate} />}
                {viewGroup[0].capturedTime && <MetaRow label="Captured Time" value={viewGroup[0].capturedTime} />}
                {viewGroup[0].location && <MetaRow label="Venue / Location" value={viewGroup[0].location} />}
              </div>
              {viewGroup[0].description && (
                <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
                  <p className="text-[11px] font-semibold mb-1" style={{ color: "rgba(255,255,255,0.45)" }}>Description</p>
                  <p className="text-sm text-white leading-relaxed">{viewGroup[0].description}</p>
                </div>
              )}
            </div>

            {/* Action footer */}
            <DialogFooter
              className="flex-shrink-0 gap-3 pt-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}
            >
              <button
                disabled={isPendingMutation}
                onClick={() => batchDeleteMutation.mutate({ ids: viewGroup.map(i => i.id), reason: "rejected" })}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold
                  transition-all disabled:opacity-50 hover:brightness-110 active:scale-95"
                style={{
                  background: "rgba(239,68,68,0.10)",
                  color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.35)",
                }}
                data-testid="button-modal-gallery-reject"
              >
                <X className="w-4 h-4" /> Reject Submission
              </button>
              <button
                disabled={isPendingMutation}
                onClick={() => approveMutation.mutate(viewGroup.map(i => i.id))}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold
                  transition-all disabled:opacity-50 hover:brightness-110 active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #22c55e, #16a34a)",
                  color: "#fff",
                  boxShadow: "0 4px 18px rgba(34,197,94,0.32)",
                }}
                data-testid="button-modal-gallery-approve"
              >
                <Check className="w-4 h-4" /> Approve All & Publish
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ── Sub-section type ───────────────────────────────────────────────────────────
type ActiveSection = "gallery-hub" | "ebook" | null;

// ── Landing tile card ──────────────────────────────────────────────────────────
function ApprovalTile({
  title, subtitle, icon: Icon, gradient, glow, badge, badgeColor, onClick,
}: {
  title: string; subtitle: string; icon: React.ElementType;
  gradient: string; glow: string; badge: number | null; badgeColor: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`tile-approval-${title.toLowerCase().replace(/\s+/g, "-")}`}
      className="w-full text-left rounded-2xl p-5 flex flex-col gap-3 transition-all duration-200
        hover:scale-[1.025] active:scale-[0.98] group"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: `0 4px 24px ${glow}`,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.border = `1px solid rgba(255,255,255,0.22)`;
        (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 8px 32px ${glow}`;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.border = "1px solid rgba(255,255,255,0.10)";
        (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 4px 24px ${glow}`;
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: gradient, boxShadow: `0 0 20px ${glow}` }}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
        {badge !== null && badge > 0 && (
          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white flex-shrink-0"
            style={{ background: badgeColor }}
          >
            {badge} pending
          </span>
        )}
      </div>
      <div className="flex-1">
        <p className="font-bold text-white text-base leading-tight">{title}</p>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,0.50)" }}>{subtitle}</p>
      </div>
      <span className="text-xs font-semibold flex items-center gap-1 mt-1 transition-colors"
        style={{ color: "rgba(255,255,255,0.40)" }}>
        Open <ChevronRight className="w-3 h-3" />
      </span>
    </button>
  );
}

// ── Section back-header ────────────────────────────────────────────────────────
function SectionHeader({
  title, icon: Icon, gradient, glow, onBack, badge,
}: {
  title: string; icon: React.ElementType; gradient: string; glow: string;
  onBack: () => void; badge?: number;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <button
        onClick={onBack}
        data-testid="button-approval-back"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex-shrink-0"
        style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.12)" }}
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: gradient, boxShadow: `0 0 16px ${glow}` }}
      >
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-white tracking-tight text-lg">{title}</h3>
      </div>
      {badge !== undefined && badge > 0 && (
        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white flex-shrink-0"
          style={{ background: gradient }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
const EBOOK_CATEGORIES = ["Fiction", "Non-Fiction", "Science", "Mathematics", "History", "Literature", "Technology", "Arts", "Reference", "Other"];

export default function ApprovalCenter({ schoolId, initialSection, onNavigateSection, allowedSubs }: Props) {
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<ActiveSection>((initialSection as ActiveSection) ?? null);
  useEffect(() => {
    setActiveSection((initialSection as ActiveSection) ?? null);
  }, [initialSection]);
  const [showHistory, setShowHistory] = useState(false);

  // E-Book Library state
  const [ebookTab, setEbookTab] = useState<"catalog" | "verification" | "upload">("catalog");
  const [adminEbookTitle, setAdminEbookTitle] = useState("");
  const [adminEbookAuthor, setAdminEbookAuthor] = useState("");
  const [adminEbookClasses, setAdminEbookClasses] = useState<string[]>([]);
  const [adminEbookCategory, setAdminEbookCategory] = useState("");
  const [adminEbookFile, setAdminEbookFile] = useState<File | null>(null);
  const adminEbookFileRef = useRef<HTMLInputElement>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const { classes: schoolClasses, isLoading: schoolConfigLoading } = useSchoolConfigStrict(schoolId);

  const { data: historyData, isLoading: historyLoading } = useQuery<any>({
    queryKey: ["/api/approval-history", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/approval-history/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : { teacherLeaves: [], studentLeaves: [], gallery: [], ebooks: [] };
    },
    enabled: !!schoolId && showHistory,
  });

  const { data: pendingEbooks = [], isLoading: ebooksLoading } = useQuery<any[]>({
    queryKey: ["/api/library/books", schoolId, "pending"],
    queryFn: async () => {
      const r = await fetch(`/api/library/books/${schoolId}/pending`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: allBooks = [], isLoading: allBooksLoading } = useQuery<any[]>({
    queryKey: ["/api/library/books", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/library/books/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const approvedBooks = allBooks.filter((b: any) => b.verificationStatus === "approved");
  const filteredCatalog = catalogSearch.trim()
    ? approvedBooks.filter((b: any) => {
        const q = catalogSearch.toLowerCase();
        return (
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          (b.targetClass && b.targetClass.toLowerCase().includes(q))
        );
      })
    : approvedBooks;

  const ebookDeleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/library/books/${id}`); },
    onSuccess: () => {
      toast({ title: "Book Deleted", description: "Removed from all views." });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", schoolId, "pending"] });
    },
    onError: (e: Error) => toast({ title: "Delete Failed", description: e.message, variant: "destructive" }),
  });

  const adminEbookUploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const r = await fetch("/api/library/ebooks/admin", { method: "POST", body: formData, credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({ message: "Upload failed" })); throw new Error(e.message); }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "E-Book Uploaded", description: "Book added to catalog directly." });
      setAdminEbookTitle(""); setAdminEbookAuthor(""); setAdminEbookClasses([]); setAdminEbookCategory(""); setAdminEbookFile(null);
      if (adminEbookFileRef.current) adminEbookFileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", schoolId] });
      setEbookTab("catalog");
    },
    onError: (e: Error) => toast({ title: "Upload Failed", description: e.message, variant: "destructive" }),
  });

  const ebookVerifyMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/library/books/${id}/verify`, { status });
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.status === "approved" ? "E-Book Approved" : "E-Book Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", schoolId, "pending"] });
    },
  });

  const isPending = ebookVerifyMutation.isPending;

  const { data: allGalleryForCount = [] } = useQuery<any[]>({
    queryKey: ["/api/gallery", schoolId, "all"],
    queryFn: async () => {
      const r = await fetch(`/api/gallery/${schoolId}?all=true`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });
  const galleryPendingCount = allGalleryForCount.filter((g: any) => !g.approved).length;

  const Spinner = () => (
    <div className="flex justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: "rgba(255,255,255,0.30)" }} />
    </div>
  );

  const hCanGallery = !allowedSubs || allowedSubs.includes("gallery-hub");
  const hCanEbooks  = !allowedSubs || allowedSubs.includes("ebook");
  const hTabCount   = [hCanGallery, hCanEbooks].filter(Boolean).length;
  const hDefaultTab = hCanGallery ? "gallery" : "ebooks";
  const hGridCols   = hTabCount === 1 ? "grid-cols-1" : "grid-cols-2";

  const HistoryModal = (
    <Dialog open={showHistory} onOpenChange={setShowHistory}>
      <DialogContent className="max-w-3xl max-h-[82vh] flex flex-col"
        style={{ background: "#0A1628", border: "1px solid rgba(212,175,55,0.25)", color: "#fff" }}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-white text-lg">
            <History className="w-5 h-5" style={{ color: "#D4AF37" }} />
            Approval History
          </DialogTitle>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.50)" }}>Admin-actioned gallery photos and e-books</p>
        </DialogHeader>
        {historyLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" style={{ color: "#D4AF37" }} /></div>
        ) : (
          <Tabs defaultValue={hDefaultTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className={`flex-shrink-0 grid ${hGridCols} w-full`} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }}>
              {hCanGallery && (
                <TabsTrigger value="gallery" className="text-xs data-[state=active]:text-white data-[state=active]:bg-amber-600/20" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Gallery <span className="ml-1 text-[10px] opacity-70">({historyData?.gallery?.length ?? 0})</span>
                </TabsTrigger>
              )}
              {hCanEbooks && (
                <TabsTrigger value="ebooks" className="text-xs data-[state=active]:text-white data-[state=active]:bg-amber-600/20" style={{ color: "rgba(255,255,255,0.55)" }}>
                  E-Books <span className="ml-1 text-[10px] opacity-70">({historyData?.ebooks?.length ?? 0})</span>
                </TabsTrigger>
              )}
            </TabsList>
            {hCanGallery && (
            <TabsContent value="gallery" className="flex-1 overflow-y-auto mt-3 space-y-2 pr-1">
              {!historyData?.gallery?.length ? <div className="text-center py-10 text-sm" style={{ color: "rgba(255,255,255,0.40)" }}>No gallery approval history</div>
                : historyData.gallery.map((g: any) => (
                  <HistoryRow key={g.id} status="approved">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm">{g.title || "Untitled Photo"}</p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>Uploaded by {g.uploaderName}{g.eventTag ? ` · ${g.eventTag}` : ""}</p>
                      {g.createdAt && <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.40)" }}>{fmtDate(g.createdAt)}</p>}
                    </div>
                    <StatusChip status="approved" />
                  </HistoryRow>
                ))}
            </TabsContent>
            )}
            {hCanEbooks && (
            <TabsContent value="ebooks" className="flex-1 overflow-y-auto mt-3 space-y-2 pr-1">
              {!historyData?.ebooks?.length ? <div className="text-center py-10 text-sm" style={{ color: "rgba(255,255,255,0.40)" }}>No e-book history</div>
                : historyData.ebooks.map((b: any) => (
                  <HistoryRow key={b.id} status={b.verificationStatus}>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm">{b.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>by {b.author} · Class {b.targetClass}{b.category ? ` · ${b.category}` : ""}</p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.40)" }}>Uploaded by {b.uploaderName}</p>
                    </div>
                    <StatusChip status={b.verificationStatus} />
                  </HistoryRow>
                ))}
            </TabsContent>
            )}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );

  /* ── LANDING PAGE ── */
  if (activeSection === null) {
    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight">Approval Center</h2>
            <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
              Gallery photos and e-book media approvals
            </p>
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 mt-1 transition-all"
            style={{ background: "rgba(212,175,55,0.15)", color: "#D4AF37", border: "1px solid rgba(212,175,55,0.30)" }}
            data-testid="button-approval-history"
          >
            <History className="w-3.5 h-3.5" /> History
          </button>
        </div>

        {/* 2 tiles */}
        <div className="grid grid-cols-2 gap-4">
          {(!allowedSubs || allowedSubs.includes("gallery-hub")) && (
          <ApprovalTile
            title="Gallery Hub"
            subtitle="Upload, manage and approve school photos from teachers."
            icon={Image}
            gradient="linear-gradient(135deg, #a855f7, #ec4899)"
            glow="rgba(168,85,247,0.18)"
            badge={galleryPendingCount}
            badgeColor="linear-gradient(135deg,#a855f7,#ec4899)"
            onClick={() => { setActiveSection("gallery-hub"); onNavigateSection?.("gallery-hub"); }}
          />
          )}
          {(!allowedSubs || allowedSubs.includes("ebook")) && (
          <ApprovalTile
            title="E-Book Library"
            subtitle="Verify and approve e-books submitted by teachers."
            icon={BookOpen}
            gradient="linear-gradient(135deg, #f59e0b, #f97316)"
            glow="rgba(245,158,11,0.18)"
            badge={pendingEbooks.length}
            badgeColor="linear-gradient(135deg,#f59e0b,#f97316)"
            onClick={() => { setActiveSection("ebook"); onNavigateSection?.("ebook"); }}
          />
          )}
        </div>

        {HistoryModal}
      </div>
    );
  }

  /* ── SUB-SECTION VIEWS ── */
  return (
    <div className="space-y-4">
      {/* ── Gallery Hub ── */}
      {activeSection === "gallery-hub" && (
        <>
          <SectionHeader
            title="Gallery Hub"
            icon={Image}
            gradient="linear-gradient(135deg,#a855f7,#ec4899)"
            glow="rgba(168,85,247,0.25)"
            onBack={() => { setActiveSection(null); onNavigateSection?.(null); }}
            badge={galleryPendingCount}
          />
          <GalleryHub schoolId={schoolId} />
        </>
      )}

      {/* ── E-Book Library ── */}
      {activeSection === "ebook" && (
        <>
          <SectionHeader
            title="E-Book Library"
            icon={BookOpen}
            gradient="linear-gradient(135deg,#f59e0b,#f97316)"
            glow="rgba(245,158,11,0.25)"
            onBack={() => { setActiveSection(null); setEbookTab("catalog"); onNavigateSection?.(null); }}
            badge={pendingEbooks.length}
          />

          {/* Tab bar */}
          <div className="flex gap-2 mb-4">
            {([
              { key: "catalog",      label: "Catalog",      icon: <BookOpen className="w-3.5 h-3.5" /> },
              { key: "verification", label: "Verification", icon: <CheckCircle2 className="w-3.5 h-3.5" />, badge: pendingEbooks.length },
              { key: "upload",       label: "Upload E-Book", icon: <Upload className="w-3.5 h-3.5" /> },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => setEbookTab(t.key)}
                data-testid={`tab-ebook-${t.key}`}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-semibold transition-all relative"
                style={{
                  background: ebookTab === t.key ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.05)",
                  color: ebookTab === t.key ? "#fbbf24" : "rgba(255,255,255,0.50)",
                  border: ebookTab === t.key ? "1px solid rgba(245,158,11,0.40)" : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {t.icon}{t.label}
                {"badge" in t && t.badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                    style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)" }}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Catalog tab ── */}
          {ebookTab === "catalog" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <BookOpen className="w-5 h-5 flex-shrink-0" style={{ color: "#f59e0b" }} />
                <div>
                  <p className="font-bold text-white text-sm">Library Catalog</p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.40)" }}>{approvedBooks.length} approved book{approvedBooks.length !== 1 ? "s" : ""} in your school</p>
                </div>
              </div>
              <div className="relative">
                <input
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  placeholder="Search by title, author, class…"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", color: "white" }}
                  data-testid="input-catalog-search"
                />
                <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.30)" }} />
              </div>
              {allBooksLoading ? <Spinner /> : filteredCatalog.length === 0
                ? <EmptyState label="No approved books yet" variant="ebook" />
                : (
                  <div className="space-y-2">
                    {filteredCatalog.map((b: any) => {
                      const initials = b.title.charAt(0).toUpperCase();
                      const classes = b.targetClass ? b.targetClass.split(",").map((c: string) => c.trim()).filter(Boolean) : [];
                      return (
                        <div key={b.id} data-testid={`card-catalog-${b.id}`}
                          className="flex gap-3 p-3 rounded-xl"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                            style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)", color: "white" }}>
                            {initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-semibold text-sm leading-tight">{b.title}</p>
                            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.50)" }}>{b.author}</p>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {classes.map((c: string) => (
                                <span key={c} className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(20,184,166,0.15)", color: "#5eead4", border: "1px solid rgba(20,184,166,0.25)" }}>Class {c}</span>
                              ))}
                              {b.category && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" }}>{b.category}</span>}
                              {b.fileType && <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase" style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.50)", border: "1px solid rgba(255,255,255,0.10)" }}>{b.fileType}</span>}
                            </div>
                            {b.uploaderName && (
                              <p className="flex items-center gap-1 text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>
                                <User className="w-2.5 h-2.5" />Uploaded by {b.uploaderName}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-col gap-1.5 flex-shrink-0">
                            {b.fileUrl && (<>
                              <button onClick={() => window.open(b.fileUrl, "_blank")}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                                style={{ background: "rgba(20,184,166,0.15)", color: "#5eead4", border: "1px solid rgba(20,184,166,0.28)" }}
                                data-testid={`button-read-catalog-${b.id}`}>
                                <Eye className="w-3 h-3" /> Read
                              </button>
                              <button onClick={() => {
                                const a = document.createElement("a");
                                a.href = b.fileUrl; a.download = `${b.title}.${b.fileType ?? "pdf"}`;
                                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                              }}
                                className="flex items-center justify-center px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.10)" }}
                                data-testid={`button-download-catalog-${b.id}`}>
                                <Download className="w-3 h-3" />
                              </button>
                            </>)}
                            <button
                              onClick={() => { if (confirm(`Delete "${b.title}"? This removes it for all teachers and students.`)) ebookDeleteMutation.mutate(b.id); }}
                              disabled={ebookDeleteMutation.isPending}
                              className="flex items-center justify-center px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-125 disabled:opacity-50"
                              style={{ background: "rgba(239,68,68,0.10)", color: "#f87171", border: "1px solid rgba(239,68,68,0.22)" }}
                              data-testid={`button-delete-catalog-${b.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              }
            </div>
          )}

          {/* ── Verification tab ── */}
          {ebookTab === "verification" && (
            <Section title="E-Book Verifications" icon={CheckCircle2} badge={pendingEbooks.length} variant="ebook">
              {ebooksLoading ? <Spinner /> :
                pendingEbooks.length === 0
                  ? <EmptyState label="No pending e-books" variant="ebook" />
                  : (
                    <div className="space-y-2">
                      {pendingEbooks.map((b: any) => {
                        const classes = b.targetClass ? b.targetClass.split(",").map((c: string) => c.trim()).filter(Boolean) : [];
                        return (
                          <ItemRow key={b.id} testId={`card-ebook-${b.id}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-semibold text-sm">{b.title}</p>
                              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>by {b.author}</p>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {classes.map((c: string) => (
                                  <span key={c} className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(20,184,166,0.15)", color: "#5eead4", border: "1px solid rgba(20,184,166,0.25)" }}>Class {c}</span>
                                ))}
                                {b.category && <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>{b.category}</span>}
                              </div>
                              {b.fileUrl && (
                                <button onClick={() => window.open(b.fileUrl, "_blank")}
                                  className="mt-1.5 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold"
                                  style={{ background: "rgba(20,184,166,0.10)", color: "#5eead4", border: "1px solid rgba(20,184,166,0.20)" }}
                                  data-testid={`button-preview-ebook-${b.id}`}>
                                  <Eye className="w-2.5 h-2.5" /> Preview
                                </button>
                              )}
                            </div>
                            <ActionButtons
                              disabled={ebookVerifyMutation.isPending}
                              onApprove={() => ebookVerifyMutation.mutate({ id: b.id, status: "approved" })}
                              onReject={() => ebookVerifyMutation.mutate({ id: b.id, status: "rejected" })}
                              approveTestId={`button-approve-ebook-${b.id}`}
                              rejectTestId={`button-reject-ebook-${b.id}`}
                            />
                          </ItemRow>
                        );
                      })}
                    </div>
                  )
              }
            </Section>
          )}

          {/* ── Upload E-Book tab ── */}
          {ebookTab === "upload" && (
            <div className="rounded-2xl p-5 space-y-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(245,158,11,0.15)" }}>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)", boxShadow: "0 0 16px rgba(245,158,11,0.25)" }}>
                  <Upload className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-white text-base">Upload E-Book</h2>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.40)" }}>Admin uploads go directly to the catalog</p>
                </div>
              </div>

              <form onSubmit={(e) => {
                e.preventDefault();
                if (!adminEbookTitle.trim() || !adminEbookAuthor.trim()) {
                  toast({ title: "Validation Error", description: "Title and Author are required.", variant: "destructive" }); return;
                }
                if (!adminEbookFile) {
                  toast({ title: "Validation Error", description: "Please select a PDF or EPUB file.", variant: "destructive" }); return;
                }
                const fd = new FormData();
                fd.append("title", adminEbookTitle.trim());
                fd.append("author", adminEbookAuthor.trim());
                if (adminEbookClasses.length > 0) fd.append("targetClass", adminEbookClasses.join(","));
                if (adminEbookCategory) fd.append("category", adminEbookCategory);
                fd.append("file", adminEbookFile);
                adminEbookUploadMutation.mutate(fd);
              }} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>Title *</label>
                    <input value={adminEbookTitle} onChange={e => setAdminEbookTitle(e.target.value)}
                      placeholder="Enter book title"
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "white" }}
                      data-testid="input-admin-ebook-title" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>Author *</label>
                    <input value={adminEbookAuthor} onChange={e => setAdminEbookAuthor(e.target.value)}
                      placeholder="Enter author name"
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "white" }}
                      data-testid="input-admin-ebook-author" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>
                    Target Classes
                    {adminEbookClasses.length > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px]"
                        style={{ background: "rgba(245,158,11,0.20)", color: "#fbbf24" }}>
                        {adminEbookClasses.length} selected
                      </span>
                    )}
                  </label>
                  <div className="flex flex-wrap gap-2 p-3 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
                    data-testid="multiselect-admin-ebook-class">
                    {schoolConfigLoading && (
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Loading classes…</span>
                    )}
                    {schoolClasses.map(cls => {
                      const checked = adminEbookClasses.includes(cls);
                      return (
                        <button key={cls} type="button"
                          onClick={() => setAdminEbookClasses(prev => checked ? prev.filter(c => c !== cls) : [...prev, cls])}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                          style={{
                            background: checked ? "rgba(245,158,11,0.22)" : "rgba(255,255,255,0.06)",
                            color: checked ? "#fbbf24" : "rgba(255,255,255,0.50)",
                            border: checked ? "1px solid rgba(245,158,11,0.45)" : "1px solid rgba(255,255,255,0.10)",
                          }}
                          data-testid={`admin-class-pill-${cls}`}>
                          {checked && <span className="mr-1">✓</span>}Class {cls}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>Category</label>
                  <Select value={adminEbookCategory} onValueChange={setAdminEbookCategory}>
                    <SelectTrigger className="rounded-xl"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "white" }}
                      data-testid="select-admin-ebook-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {EBOOK_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>File (PDF/EPUB) *</label>
                  <label className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all hover:brightness-110"
                    style={{ background: "rgba(255,255,255,0.04)", border: "2px dashed rgba(245,158,11,0.28)" }}>
                    <FileText className="w-5 h-5 flex-shrink-0" style={{ color: "#f59e0b" }} />
                    <span className="text-sm" style={{ color: adminEbookFile ? "white" : "rgba(255,255,255,0.40)" }}>
                      {adminEbookFile ? `${adminEbookFile.name} (${(adminEbookFile.size / 1024 / 1024).toFixed(2)} MB)` : "Choose PDF or EPUB file…"}
                    </span>
                    <input ref={adminEbookFileRef} type="file" accept=".pdf,.epub" className="hidden"
                      onChange={e => setAdminEbookFile(e.target.files?.[0] || null)}
                      data-testid="input-admin-ebook-file" />
                  </label>
                </div>

                <div className="px-3 py-2.5 rounded-xl text-xs"
                  style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.14)", color: "rgba(255,255,255,0.45)" }}>
                  <CheckCircle2 className="w-3 h-3 inline-block mr-1.5" style={{ color: "#f59e0b" }} />
                  Admin uploads are <span style={{ color: "#fbbf24" }}>automatically approved</span> and appear in the catalog immediately.
                </div>

                <button type="submit" disabled={adminEbookUploadMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#d97706,#f59e0b)", color: "white" }}
                  data-testid="button-admin-upload-ebook">
                  {adminEbookUploadMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                    : <><Upload className="w-4 h-4" /> Upload E-Book</>
                  }
                </button>
              </form>
            </div>
          )}
        </>
      )}

      {HistoryModal}
    </div>
  );
}

// ── History helper sub-components ──────────────────────────────────────────────
function HistoryRow({ children, status }: { children: React.ReactNode; status: string }) {
  const borderColor = status === "approved" ? "rgba(34,197,94,0.30)" : "rgba(239,68,68,0.30)";
  return (
    <div
      className="flex items-start gap-3 px-3 py-2.5 rounded-lg"
      style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${borderColor}` }}
    >
      {children}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const approved = status === "approved";
  return (
    <span
      className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 self-start mt-0.5"
      style={{
        background: approved ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
        color: approved ? "#4ade80" : "#f87171",
        border: `1px solid ${approved ? "rgba(34,197,94,0.30)" : "rgba(239,68,68,0.30)"}`,
      }}
    >
      {approved ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {approved ? "Approved" : "Rejected"}
    </span>
  );
}
