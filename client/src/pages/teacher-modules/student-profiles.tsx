import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, Loader2, User, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface PendingProfile {
  id: number;
  studentId: number;
  schoolId: number;
  status: string;
  fullName: string | null;
  class: string | null;
  section: string | null;
  rollNo: string | null;
  fatherName: string | null;
  motherName: string | null;
  presentAddress: string | null;
  photoUrl: string | null;
  photoStatus: string;
  rejectionNote: string | null;
  submittedAt: string | null;
  studentName: string;
  dsid: string;
}

interface RejectDialogState {
  open: boolean;
  studentId: number | null;
  studentName: string;
  note: string;
}

export default function StudentProfilesModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [rejectDialog, setRejectDialog] = useState<RejectDialogState>({
    open: false,
    studentId: null,
    studentName: "",
    note: "",
  });
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const { data: profiles = [], isLoading } = useQuery<PendingProfile[]>({
    queryKey: ["/api/teacher/pending-profiles"],
    refetchInterval: 30000,
  });

  const approveMutation = useMutation({
    mutationFn: async (studentId: number) => {
      return await apiRequest("POST", `/api/teacher/profiles/${studentId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles/count"] });
      toast({ title: "Profile approved", description: "The student's profile has been approved." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ studentId, note }: { studentId: number; note: string }) => {
      return await apiRequest("POST", `/api/teacher/profiles/${studentId}/reject`, { note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles/count"] });
      setRejectDialog({ open: false, studentId: null, studentName: "", note: "" });
      toast({ title: "Profile rejected", description: "The student has been notified to make corrections." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  function openRejectDialog(profile: PendingProfile) {
    setRejectDialog({ open: true, studentId: profile.studentId, studentName: profile.studentName, note: "" });
  }

  function submitRejection() {
    if (!rejectDialog.note.trim()) {
      toast({ title: "Note required", description: "Please provide a reason for rejection.", variant: "destructive" });
      return;
    }
    if (!rejectDialog.studentId) return;
    rejectMutation.mutate({ studentId: rejectDialog.studentId, note: rejectDialog.note });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight" data-testid="text-module-title">
            Student Profile Verification
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Class {teacher.assignedClass}-{teacher.assignedSection} · {profiles.length} pending
          </p>
        </div>
        <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2">
          <Clock className="w-4 h-4 text-yellow-600" />
          <span className="text-sm font-semibold text-yellow-800" data-testid="text-pending-count">
            {profiles.length} Pending
          </span>
        </div>
      </div>

      {profiles.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-border">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-700">All caught up!</h3>
          <p className="text-sm text-muted-foreground mt-1">No pending student profile submissions for your class.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((profile) => {
            const isExpanded = expandedId === profile.studentId;
            const initials = profile.studentName
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")
              .toUpperCase();

            return (
              <div
                key={profile.studentId}
                className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden"
                data-testid={`card-profile-${profile.studentId}`}
              >
                {/* Collapsed row */}
                <div className="p-4 flex items-center gap-4">
                  {/* Avatar / Photo */}
                  {profile.photoUrl ? (
                    <button
                      onClick={() => setPhotoPreview(profile.photoUrl)}
                      className="relative flex-shrink-0"
                      data-testid={`button-photo-preview-${profile.studentId}`}
                      title="View photo"
                    >
                      <img
                        src={profile.photoUrl}
                        alt={profile.studentName}
                        className="w-12 h-12 rounded-full object-cover border-2 border-yellow-300"
                      />
                      <Eye className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-white text-gray-500 rounded-full p-0.5 shadow" />
                    </button>
                  ) : (
                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center border-2 border-gray-200">
                      <span className="text-gray-600 font-bold text-sm">{initials}</span>
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate" data-testid={`text-student-name-${profile.studentId}`}>
                      {profile.studentName}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{profile.dsid}</p>
                    {profile.submittedAt && (
                      <p className="text-xs text-muted-foreground">
                        Submitted: {new Date(profile.submittedAt).toLocaleDateString("en-GB")}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => approveMutation.mutate(profile.studentId)}
                      disabled={approveMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors disabled:opacity-60"
                      data-testid={`button-approve-${profile.studentId}`}
                    >
                      {approveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                      Approve
                    </button>
                    <button
                      onClick={() => openRejectDialog(profile)}
                      disabled={rejectMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-semibold transition-colors disabled:opacity-60"
                      data-testid={`button-reject-${profile.studentId}`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : profile.studentId)}
                      className="p-1.5 rounded-lg border border-border hover:bg-muted/50 text-muted-foreground transition-colors"
                      data-testid={`button-expand-${profile.studentId}`}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { label: "Full Name (Cert)", value: profile.fullName },
                      { label: "Roll Number", value: profile.rollNo },
                      { label: "Father's Name", value: profile.fatherName },
                      { label: "Mother's Name", value: profile.motherName },
                    ].map((field) => (
                      <div key={field.label}>
                        <p className="text-xs text-muted-foreground font-medium">{field.label}</p>
                        <p className="text-sm font-semibold text-gray-800 mt-0.5">{field.value || <span className="text-muted-foreground italic">Not provided</span>}</p>
                      </div>
                    ))}
                    <div className="sm:col-span-2">
                      <p className="text-xs text-muted-foreground font-medium">Present Address</p>
                      <p className="text-sm font-semibold text-gray-800 mt-0.5">{profile.presentAddress || <span className="text-muted-foreground italic">Not provided</span>}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">Photo Status</p>
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full mt-0.5 ${
                        profile.photoStatus === "pending"
                          ? "bg-yellow-100 text-yellow-700"
                          : profile.photoStatus === "approved"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-600"
                      }`}>
                        {profile.photoStatus === "none" ? "No photo" : profile.photoStatus.charAt(0).toUpperCase() + profile.photoStatus.slice(1)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Photo Preview Modal ── */}
      {photoPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPhotoPreview(null)}
          data-testid="modal-photo-preview"
        >
          <div className="relative max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={photoPreview}
              alt="Student photo"
              className="w-full rounded-2xl shadow-2xl"
            />
            <button
              onClick={() => setPhotoPreview(null)}
              className="absolute top-3 right-3 w-8 h-8 bg-white rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Rejection Dialog ── */}
      {rejectDialog.open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setRejectDialog((d) => ({ ...d, open: false }))}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
            data-testid="modal-reject"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <XCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Reject Profile</h3>
                <p className="text-xs text-muted-foreground">{rejectDialog.studentName}</p>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Reason for Rejection <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rejectDialog.note}
                onChange={(e) => setRejectDialog((d) => ({ ...d, note: e.target.value }))}
                placeholder="Explain what needs to be corrected..."
                rows={4}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                data-testid="input-rejection-note"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setRejectDialog((d) => ({ ...d, open: false }))}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted/50 transition-colors"
                data-testid="button-cancel-reject"
              >
                Cancel
              </button>
              <button
                onClick={submitRejection}
                disabled={rejectMutation.isPending}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                data-testid="button-confirm-reject"
              >
                {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
