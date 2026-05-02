import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, X, BookOpen, Image, UserCheck, Loader2 } from "lucide-react";
import { fmtDate } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number }


function Section({ title, icon: Icon, badge, children }: { title: string; icon: any; badge?: number; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 rounded-lg bg-[#D4AF37]/20"><Icon className="w-4 h-4 text-[#D4AF37]" /></div>
        <h3 className="font-semibold text-white">{title}</h3>
        {badge !== undefined && badge > 0 && (
          <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-bold bg-red-500 text-white">{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

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

  const pendingLeaves = leaveRequests.filter((l: any) => l.status === "pending");
  const pendingGallery = galleryItems.filter((g: any) => !g.approved);
  const forwardedStudentLeaves = studentLeaves.filter((l: any) => l.status === "forwarded" || l.status === "pending");

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
      toast({ title: vars.action === "admin-approve" ? "Student Leave Approved & Attendance Synced" : "Leave Rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/student-leaves/school", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isPending = leaveStatusMutation.isPending || galleryApproveMutation.isPending || ebookVerifyMutation.isPending || studentLeaveApproveMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="mb-2">
        <h2 className="text-xl font-bold text-white">Approval Center</h2>
        <p className="text-white/50 text-sm">Unified hub for all pending approvals. Leave approval auto-syncs attendance.</p>
      </div>

      {/* Teacher Leave Requests */}
      <Section title="Teacher Leave Requests" icon={UserCheck} badge={pendingLeaves.length}>
        {leavesLoading ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div> :
          pendingLeaves.length === 0 ? <p className="text-white/40 text-sm py-4 text-center">No pending teacher leave requests</p> :
          <div className="space-y-2">
            {pendingLeaves.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#0A1628] border border-white/10" data-testid={`card-leave-${l.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm">{l.teacherName}</p>
                  <p className="text-white/50 text-xs">{l.leaveType} · {fmtDate(l.startDate)} – {fmtDate(l.endDate)}</p>
                  <p className="text-white/40 text-xs truncate">{l.reason}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" disabled={isPending} onClick={() => leaveStatusMutation.mutate({ id: l.id, status: "approved" })}
                    className="h-7 px-3 bg-green-600 hover:bg-green-500 text-white" data-testid={`button-approve-leave-${l.id}`}>
                    <Check className="w-3 h-3 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => leaveStatusMutation.mutate({ id: l.id, status: "rejected" })}
                    className="h-7 px-3 border-red-500/50 text-red-400 hover:bg-red-500/10" data-testid={`button-reject-leave-${l.id}`}>
                    <X className="w-3 h-3 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        }
      </Section>

      {/* Student Leave Requests (forwarded by teacher) */}
      <Section title="Student Leave Requests (Forwarded by Teacher)" icon={UserCheck} badge={forwardedStudentLeaves.length}>
        {sleavesLoading ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div> :
          forwardedStudentLeaves.length === 0 ? <p className="text-white/40 text-sm py-4 text-center">No student leave requests forwarded</p> :
          <div className="space-y-2">
            {forwardedStudentLeaves.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#0A1628] border border-white/10" data-testid={`card-student-leave-${l.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm">{l.studentName} <span className="text-white/40 text-xs">({l.dsid})</span></p>
                  <p className="text-white/50 text-xs">Class {l.class}-{l.section} · {fmtDate(l.startDate)} – {fmtDate(l.endDate)}</p>
                  <p className="text-white/40 text-xs truncate">{l.reason}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">{l.status}</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" disabled={isPending} onClick={() => studentLeaveApproveMutation.mutate({ id: l.id, action: "admin-approve" })}
                    className="h-7 px-3 bg-green-600 hover:bg-green-500 text-white" data-testid={`button-approve-student-leave-${l.id}`}>
                    <Check className="w-3 h-3 mr-1" /> Approve + Sync
                  </Button>
                  <Button size="sm" variant="outline" disabled={isPending} onClick={() => studentLeaveApproveMutation.mutate({ id: l.id, action: "reject" })}
                    className="h-7 px-3 border-red-500/50 text-red-400 hover:bg-red-500/10" data-testid={`button-reject-student-leave-${l.id}`}>
                    <X className="w-3 h-3 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        }
      </Section>

      {/* Gallery Approvals */}
      <Section title="Gallery Approvals" icon={Image} badge={pendingGallery.length}>
        {galleryLoading ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div> :
          pendingGallery.length === 0 ? <p className="text-white/40 text-sm py-4 text-center">No pending gallery images</p> :
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {pendingGallery.map((g: any) => (
              <div key={g.id} className="rounded-lg overflow-hidden border border-white/10 bg-[#0A1628]" data-testid={`card-gallery-${g.id}`}>
                <img src={g.imageUrl} alt={g.title} className="w-full h-28 object-cover" />
                <div className="p-2">
                  <p className="text-xs text-white truncate">{g.title}</p>
                  <Button size="sm" disabled={galleryApproveMutation.isPending} onClick={() => galleryApproveMutation.mutate(g.id)}
                    className="mt-1 w-full h-7 text-xs bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid={`button-approve-gallery-${g.id}`}>
                    <Check className="w-3 h-3 mr-1" /> Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        }
      </Section>

      {/* E-Book Verifications */}
      <Section title="E-Book Verifications" icon={BookOpen} badge={pendingEbooks.length}>
        {ebooksLoading ? <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div> :
          pendingEbooks.length === 0 ? <p className="text-white/40 text-sm py-4 text-center">No pending e-books</p> :
          <div className="space-y-2">
            {pendingEbooks.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[#0A1628] border border-white/10" data-testid={`card-ebook-${b.id}`}>
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">{b.title}</p>
                  <p className="text-white/50 text-xs">by {b.author} · {b.category} · Class {b.targetClass}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={ebookVerifyMutation.isPending} onClick={() => ebookVerifyMutation.mutate({ id: b.id, status: "approved" })}
                    className="h-7 px-3 bg-green-600 hover:bg-green-500 text-white" data-testid={`button-approve-ebook-${b.id}`}>
                    <Check className="w-3 h-3 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={ebookVerifyMutation.isPending} onClick={() => ebookVerifyMutation.mutate({ id: b.id, status: "rejected" })}
                    className="h-7 px-3 border-red-500/50 text-red-400 hover:bg-red-500/10" data-testid={`button-reject-ebook-${b.id}`}>
                    <X className="w-3 h-3 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        }
      </Section>
    </div>
  );
}
