import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Check, X, BookOpen, Image, UserCheck, Loader2,
  CalendarOff, ImageOff, BookMarked, Users, Inbox,
} from "lucide-react";
import { fmtDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number }

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

// ── Main component ─────────────────────────────────────────────────────────────
export default function ApprovalCenter({ schoolId }: Props) {
  const { toast } = useToast();

  const { data: leaveRequests = [], isLoading: leavesLoading } = useQuery<any[]>({
    queryKey: ["/api/leave/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/leave/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: galleryItems = [], isLoading: galleryLoading } = useQuery<any[]>({
    queryKey: ["/api/gallery", schoolId, "all"],
    queryFn: async () => {
      const r = await fetch(`/api/gallery/${schoolId}?all=true`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: pendingEbooks = [], isLoading: ebooksLoading } = useQuery<any[]>({
    queryKey: ["/api/library/books", schoolId, "pending"],
    queryFn: async () => {
      const r = await fetch(`/api/library/books/${schoolId}/pending`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: studentLeaves = [], isLoading: sleavesLoading } = useQuery<any[]>({
    queryKey: ["/api/student-leaves/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/student-leaves/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const pendingLeaves          = leaveRequests.filter((l: any) => l.status === "pending");
  const pendingGallery         = galleryItems.filter((g: any) => !g.approved);
  const forwardedStudentLeaves = studentLeaves; // server already filters to forwarded_to_admin only

  const leaveStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await apiRequest("PATCH", `/api/leave/${id}/status`, { status });
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.status === "approved" ? "Leave Approved" : "Leave Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/school", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const galleryApproveMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/gallery/${id}/approve`); },
    onSuccess: () => {
      toast({ title: "Image Approved" });
      queryClient.invalidateQueries({ queryKey: ["/api/gallery", schoolId, "all"] });
    },
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

  const studentLeaveApproveMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "admin-approve" | "reject" }) => {
      await apiRequest("PATCH", `/api/student-leaves/${id}/${action}`, {});
    },
    onSuccess: (_, vars) => {
      toast({
        title: vars.action === "admin-approve"
          ? "Student Leave Approved & Attendance Synced"
          : "Leave Rejected",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/student-leaves/school", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isPending =
    leaveStatusMutation.isPending ||
    galleryApproveMutation.isPending ||
    ebookVerifyMutation.isPending ||
    studentLeaveApproveMutation.isPending;

  const Spinner = () => (
    <div className="flex justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: "rgba(255,255,255,0.30)" }} />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="mb-1">
        <h2 className="text-2xl font-extrabold text-white tracking-tight">Approval Center</h2>
        <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
          Unified hub for all pending approvals · Leave approval auto-syncs attendance
        </p>
      </div>

      {/* ── Teacher Leave Requests ── */}
      <Section title="Teacher Leave Requests" icon={UserCheck} badge={pendingLeaves.length} variant="teacher">
        {leavesLoading ? <Spinner /> :
          pendingLeaves.length === 0
            ? <EmptyState label="No pending teacher leave requests" variant="teacher" />
            : (
              <div className="space-y-2">
                {pendingLeaves.map((l: any) => (
                  <ItemRow key={l.id} testId={`card-leave-${l.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm">{l.teacherName}</p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                        {l.leaveType} · {fmtDate(l.startDate)} – {fmtDate(l.endDate)}
                      </p>
                      <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.45)" }}>
                        {l.reason}
                      </p>
                    </div>
                    <ActionButtons
                      disabled={isPending}
                      onApprove={() => leaveStatusMutation.mutate({ id: l.id, status: "approved" })}
                      onReject={() => leaveStatusMutation.mutate({ id: l.id, status: "rejected" })}
                      approveTestId={`button-approve-leave-${l.id}`}
                      rejectTestId={`button-reject-leave-${l.id}`}
                    />
                  </ItemRow>
                ))}
              </div>
            )
        }
      </Section>

      {/* ── Student Leave Requests (forwarded) ── */}
      <Section
        title="Student Leave Requests (Forwarded by Teacher)"
        icon={Users}
        badge={forwardedStudentLeaves.length}
        variant="student"
      >
        {sleavesLoading ? <Spinner /> :
          forwardedStudentLeaves.length === 0
            ? <EmptyState label="No student leave requests forwarded" variant="student" />
            : (
              <div className="space-y-2">
                {forwardedStudentLeaves.map((l: any) => (
                  <ItemRow key={l.id} testId={`card-student-leave-${l.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm">
                        {l.studentName}{" "}
                        <span className="font-normal text-xs" style={{ color: "rgba(255,255,255,0.40)" }}>
                          ({l.dsid})
                        </span>
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                        Class {l.class}-{l.section} · {fmtDate(l.startDate)} – {fmtDate(l.endDate)}
                      </p>
                      <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.45)" }}>
                        {l.reason}
                      </p>
                      <span
                        className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: "rgba(234,179,8,0.15)", color: "#fbbf24" }}
                      >
                        {l.status}
                      </span>
                    </div>
                    <ActionButtons
                      disabled={isPending}
                      onApprove={() =>
                        studentLeaveApproveMutation.mutate({ id: l.id, action: "admin-approve" })
                      }
                      onReject={() =>
                        studentLeaveApproveMutation.mutate({ id: l.id, action: "reject" })
                      }
                      approveLabel="Approve + Sync"
                      approveTestId={`button-approve-student-leave-${l.id}`}
                      rejectTestId={`button-reject-student-leave-${l.id}`}
                    />
                  </ItemRow>
                ))}
              </div>
            )
        }
      </Section>

      {/* ── Gallery Approvals ── */}
      <Section title="Gallery Approvals" icon={Image} badge={pendingGallery.length} variant="gallery">
        {galleryLoading ? <Spinner /> :
          pendingGallery.length === 0
            ? <EmptyState label="No pending gallery images" variant="gallery" />
            : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {pendingGallery.map((g: any) => (
                  <div
                    key={g.id}
                    className="rounded-xl overflow-hidden transition-all duration-200 hover:scale-[1.03]"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(168,85,247,0.20)",
                      boxShadow: "0 2px 12px rgba(168,85,247,0.12)",
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(168,85,247,0.45)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(168,85,247,0.20)";
                    }}
                    data-testid={`card-gallery-${g.id}`}
                  >
                    <img src={g.imageUrl} alt={g.title} className="w-full h-28 object-cover" />
                    <div className="p-2">
                      <p className="text-xs font-medium text-white truncate mb-1.5">{g.title}</p>
                      <button
                        disabled={galleryApproveMutation.isPending}
                        onClick={() => galleryApproveMutation.mutate(g.id)}
                        data-testid={`button-approve-gallery-${g.id}`}
                        className="w-full h-7 rounded-lg text-xs font-bold flex items-center justify-center gap-1
                          transition-all duration-150 disabled:opacity-50 hover:brightness-110 active:scale-95"
                        style={{
                          background: "linear-gradient(135deg, #a855f7, #ec4899)",
                          boxShadow: "0 2px 10px rgba(168,85,247,0.30)",
                          color: "#fff",
                        }}
                      >
                        <Check className="w-3 h-3" /> Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
        }
      </Section>

      {/* ── E-Book Verifications ── */}
      <Section title="E-Book Verifications" icon={BookOpen} badge={pendingEbooks.length} variant="ebook">
        {ebooksLoading ? <Spinner /> :
          pendingEbooks.length === 0
            ? <EmptyState label="No pending e-books" variant="ebook" />
            : (
              <div className="space-y-2">
                {pendingEbooks.map((b: any) => (
                  <ItemRow key={b.id} testId={`card-ebook-${b.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm">{b.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                        by {b.author} · {b.category} · Class {b.targetClass}
                      </p>
                    </div>
                    <ActionButtons
                      disabled={ebookVerifyMutation.isPending}
                      onApprove={() => ebookVerifyMutation.mutate({ id: b.id, status: "approved" })}
                      onReject={() => ebookVerifyMutation.mutate({ id: b.id, status: "rejected" })}
                      approveTestId={`button-approve-ebook-${b.id}`}
                      rejectTestId={`button-reject-ebook-${b.id}`}
                    />
                  </ItemRow>
                ))}
              </div>
            )
        }
      </Section>
    </div>
  );
}
