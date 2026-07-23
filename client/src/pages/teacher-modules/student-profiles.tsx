import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle, XCircle, Clock, Loader2, User, Eye,
  Users, FileText, ChevronLeft, ShieldCheck,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useArchiveMode, type TeacherMe } from "@/pages/teacher-dashboard";

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
  approvedSnapshot: string | null;
  currentVerifiedProfile: string | null;
  studentName: string;
  dsid: string;
}

interface ParsedVerifiedProfile {
  fullName: string | null;
  class: string | null;
  section: string | null;
  rollNo: string | null;
  fatherName: string | null;
  motherName: string | null;
  presentAddress: string | null;
  photoUrl: string | null;
  verifiedAt: string | null;
}

function parseProfile(json: string | null): ParsedVerifiedProfile | null {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function getRequestType(profile: PendingProfile): string {
  return profile.currentVerifiedProfile ? "Data Update" : "New Registration";
}

const FIELD_LABELS: { key: keyof ParsedVerifiedProfile | "fullName" | "class" | "section" | "rollNo" | "fatherName" | "motherName" | "presentAddress"; label: string }[] = [
  { key: "fullName", label: "Full Name" },
  { key: "class", label: "Class" },
  { key: "section", label: "Section" },
  { key: "rollNo", label: "Roll Number" },
  { key: "fatherName", label: "Father's Name" },
  { key: "motherName", label: "Mother's Name" },
  { key: "presentAddress", label: "Present Address" },
];

type ProfileField = keyof Pick<PendingProfile, "fullName" | "class" | "section" | "rollNo" | "fatherName" | "motherName" | "presentAddress">;

export default function StudentProfilesModule({ teacher }: { teacher: TeacherMe }) {
  const isArchiveMode = useArchiveMode();
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [reviewProfile, setReviewProfile] = useState<PendingProfile | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

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
      setReviewProfile(null);
      toast({ title: "Profile approved", description: "The student's profile has been approved and verified." });
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
      setReviewProfile(null);
      setRejectNote("");
      setShowRejectInput(false);
      toast({ title: "Profile rejected", description: "The student has been notified with your feedback." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async (studentIds: number[]) => {
      const res = await apiRequest("POST", "/api/teacher/profiles/bulk-approve", { studentIds });
      return res.json() as Promise<{ approved: number; skipped: number }>;
    },
    onSuccess: (data: { approved: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles/count"] });
      setSelectedIds(new Set());
      toast({
        title: `Bulk approved ${data.approved} profile${data.approved !== 1 ? "s" : ""}`,
        description: data.skipped > 0 ? `${data.skipped} were skipped (already processed).` : "All selected profiles approved.",
      });
    },
    onError: (e: Error) => {
      toast({ title: "Bulk approve failed", description: e.message, variant: "destructive" });
    },
  });

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === profiles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(profiles.map((p) => p.studentId)));
    }
  }

  function openReview(p: PendingProfile) {
    setReviewProfile(p);
    setRejectNote("");
    setShowRejectInput(false);
  }

  function submitRejection() {
    if (!rejectNote.trim()) {
      toast({ title: "Note required", description: "Please provide a reason for rejection.", variant: "destructive" });
      return;
    }
    if (!reviewProfile) return;
    rejectMutation.mutate({ studentId: reviewProfile.studentId, note: rejectNote });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allSelected = profiles.length > 0 && selectedIds.size === profiles.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Archive mode banner */}
      {isArchiveMode && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-400 text-xs font-semibold" data-testid="banner-archive-mode">
          🔒 Archive Mode — This is a read-only historical session. No changes can be saved.
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2" data-testid="text-module-title">
            <ShieldCheck className="w-5 h-5 text-amber-600" />
            Approval Center
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Class {teacher.assignedClass}-{teacher.assignedSection} · {profiles.length} pending
          </p>
        </div>
        {profiles.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 bg-red-50 border border-red-200 text-red-700 text-sm font-semibold px-3 py-1.5 rounded-xl">
              <Clock className="w-4 h-4" />
              <span data-testid="text-pending-count">{profiles.length} Pending</span>
            </span>
            {someSelected && (
              <button
                onClick={() => bulkApproveMutation.mutate(Array.from(selectedIds))}
                disabled={isArchiveMode || bulkApproveMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors disabled:opacity-60 shadow"
                data-testid="button-bulk-approve"
              >
                {bulkApproveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                Approve Selected ({selectedIds.size})
              </button>
            )}
          </div>
        )}
      </div>

      {profiles.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-border">
          <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-700">All caught up!</h3>
          <p className="text-sm text-muted-foreground mt-1">No pending student profile submissions for your class.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-3 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 accent-emerald-500 cursor-pointer"
              data-testid="checkbox-select-all"
            />
            <span>Student Name</span>
            <span className="hidden sm:block">Date</span>
            <span className="hidden sm:block">Request Type</span>
            <span>Action</span>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-border">
            {profiles.map((profile) => {
              const initials = profile.studentName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
              const requestType = getRequestType(profile);
              const isChecked = selectedIds.has(profile.studentId);
              const dateStr = profile.submittedAt
                ? new Date(profile.submittedAt).toLocaleDateString("en-GB")
                : "—";

              return (
                <div
                  key={profile.studentId}
                  className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-3.5 transition-colors ${isChecked ? "bg-emerald-50/60" : "hover:bg-muted/10"}`}
                  data-testid={`row-profile-${profile.studentId}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelect(profile.studentId)}
                    className="w-4 h-4 accent-emerald-500 cursor-pointer"
                    data-testid={`checkbox-profile-${profile.studentId}`}
                  />

                  {/* Name + avatar */}
                  <div className="flex items-center gap-3 min-w-0">
                    {profile.photoUrl ? (
                      <button
                        onClick={() => setPhotoPreview(profile.photoUrl)}
                        className="relative flex-shrink-0"
                        data-testid={`button-photo-${profile.studentId}`}
                        title="View photo"
                      >
                        <img
                          src={profile.photoUrl}
                          alt={profile.studentName}
                          className="w-9 h-9 rounded-full object-cover border-2 border-yellow-300"
                        />
                        <Eye className="absolute bottom-0 right-0 w-3 h-3 bg-white text-gray-400 rounded-full p-0.5 shadow" />
                      </button>
                    ) : (
                      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200">
                        <span className="text-gray-600 font-bold text-xs">{initials}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate" data-testid={`text-name-${profile.studentId}`}>
                        {profile.studentName}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{profile.dsid}</p>
                    </div>
                  </div>

                  <span className="hidden sm:block text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-date-${profile.studentId}`}>
                    {dateStr}
                  </span>

                  <span className={`hidden sm:inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                    requestType === "New Registration"
                      ? "bg-blue-50 text-blue-700 border border-blue-100"
                      : "bg-purple-50 text-purple-700 border border-purple-100"
                  }`} data-testid={`text-type-${profile.studentId}`}>
                    {requestType === "New Registration" ? <User className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                    {requestType}
                  </span>

                  <button
                    onClick={() => openReview(profile)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0A1628] hover:bg-[#1A2942] text-white text-xs font-semibold transition-colors whitespace-nowrap"
                    data-testid={`button-review-${profile.studentId}`}
                  >
                    <Eye className="w-3 h-3" />
                    Review
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Photo Preview Modal */}
      {photoPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPhotoPreview(null)}
          data-testid="modal-photo-preview"
        >
          <div className="relative max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <img src={photoPreview} alt="Student photo" className="w-full rounded-2xl shadow-2xl" />
            <button
              onClick={() => setPhotoPreview(null)}
              className="absolute top-3 right-3 w-8 h-8 bg-white rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100 text-lg font-bold"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Side-by-side Review Modal */}
      {reviewProfile && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-6"
          onClick={() => { setReviewProfile(null); setShowRejectInput(false); setRejectNote(""); }}
          data-testid="modal-review"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-[#0A1628] rounded-t-2xl">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setReviewProfile(null); setShowRejectInput(false); setRejectNote(""); }}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                  data-testid="button-close-modal"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div>
                  <h3 className="font-bold text-white text-base">{reviewProfile.studentName}</h3>
                  <p className="text-xs text-blue-200 font-mono">{reviewProfile.dsid} · {getRequestType(reviewProfile)}</p>
                </div>
              </div>
              {reviewProfile.submittedAt && (
                <span className="text-xs text-blue-200 hidden sm:block">
                  Submitted: {new Date(reviewProfile.submittedAt).toLocaleDateString("en-GB")}
                </span>
              )}
            </div>

            {/* Side-by-side content */}
            <div className="flex flex-col sm:flex-row flex-1 overflow-auto divide-y sm:divide-y-0 sm:divide-x divide-border">
              {/* LEFT: Current live data */}
              <div className="flex-1 p-5 space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Users className="w-4 h-4 text-gray-400" />
                  <h4 className="text-sm font-bold text-gray-600">
                    {parseProfile(reviewProfile.currentVerifiedProfile) ? "Current Live Data" : "New Registration"}
                  </h4>
                </div>

                {(() => {
                  const liveData = parseProfile(reviewProfile.currentVerifiedProfile);
                  if (!liveData) {
                    return (
                      <div className="flex flex-col items-center justify-center py-10 text-center text-gray-400 gap-3">
                        <User className="w-10 h-10 opacity-30" />
                        <p className="text-sm font-medium">No previous verified data</p>
                        <p className="text-xs">This is the student's first registration</p>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-3">
                      {liveData.photoUrl && (
                        <div className="flex justify-center mb-3">
                          <img
                            src={liveData.photoUrl}
                            alt="Current photo"
                            className="w-20 h-20 rounded-full object-cover border-4 border-gray-200 shadow"
                          />
                        </div>
                      )}
                      {FIELD_LABELS.map(({ key, label }) => (
                        <div key={key} className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                          <p className="text-xs text-gray-400 font-medium">{label}</p>
                          <p className="text-sm font-semibold text-gray-700 mt-0.5">
                            {liveData[key as keyof ParsedVerifiedProfile] || <span className="text-gray-300 italic">—</span>}
                          </p>
                        </div>
                      ))}
                      {liveData.verifiedAt && (
                        <p className="text-xs text-gray-400 text-center pt-1">
                          Verified on {new Date(liveData.verifiedAt).toLocaleDateString("en-GB")}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* RIGHT: Pending submission */}
              <div className="flex-1 p-5 space-y-4 bg-emerald-50/30">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-emerald-600" />
                  <h4 className="text-sm font-bold text-emerald-700">Pending Submission</h4>
                  <span className="ml-auto text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                    AWAITING REVIEW
                  </span>
                </div>

                {(() => {
                  const liveData = parseProfile(reviewProfile.currentVerifiedProfile);
                  return (
                    <div className="space-y-3">
                      {reviewProfile.photoUrl && (
                        <div className="flex justify-center mb-3">
                          <div className="relative">
                            <img
                              src={reviewProfile.photoUrl}
                              alt="Pending photo"
                              className="w-20 h-20 rounded-full object-cover border-4 border-emerald-400 shadow"
                            />
                            {reviewProfile.photoStatus === "pending" && (
                              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold bg-yellow-400 text-white px-2 py-0.5 rounded-full whitespace-nowrap shadow">
                                PHOTO PENDING
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      {FIELD_LABELS.map(({ key, label }) => {
                        const newVal = reviewProfile[key as ProfileField];
                        const oldVal = liveData ? liveData[key as keyof ParsedVerifiedProfile] : null;
                        const changed = liveData && newVal !== oldVal;
                        return (
                          <div
                            key={key}
                            className={`rounded-lg border px-3 py-2 transition-colors ${
                              changed
                                ? "bg-emerald-50 border-emerald-300 ring-1 ring-emerald-200"
                                : "bg-white border-gray-100"
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs text-gray-400 font-medium">{label}</p>
                              {changed && (
                                <span className="text-[9px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">CHANGED</span>
                              )}
                            </div>
                            <p className={`text-sm font-semibold mt-0.5 ${changed ? "text-emerald-700" : "text-gray-700"}`}>
                              {newVal || <span className="text-gray-300 italic">—</span>}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Modal footer: actions */}
            <div className="border-t border-border px-5 py-4 bg-gray-50 rounded-b-2xl">
              {showRejectInput ? (
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-gray-700">
                    Rejection Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Explain what needs to be corrected (e.g. 'Check Father's Name spelling')"
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                    autoFocus
                    data-testid="input-rejection-note"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setShowRejectInput(false); setRejectNote(""); }}
                      className="flex-1 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted/50 transition-colors"
                      data-testid="button-cancel-reject"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitRejection}
                      disabled={isArchiveMode || rejectMutation.isPending}
                      className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                      data-testid="button-confirm-reject"
                    >
                      {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Confirm Rejection"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setShowRejectInput(true)}
                    disabled={isArchiveMode}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
                    data-testid="button-reject"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </button>
                  <button
                    onClick={() => approveMutation.mutate(reviewProfile.studentId)}
                    disabled={isArchiveMode || approveMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors disabled:opacity-60 shadow"
                    data-testid="button-approve"
                  >
                    {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Approve Profile
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
