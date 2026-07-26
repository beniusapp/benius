import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CheckCircle, XCircle, Clock, Loader2, User, Eye,
  Users, FileText, ChevronLeft, ShieldCheck, Pencil, Save, Camera, History, X,
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
  aadharNumber: string | null;
  gender: string | null;
  phone: string | null;
  dob: string | null;
  enrollmentDate: string | null;
  guardianName: string | null;
  bloodGroup: string | null;
  photoUrl: string | null;
  photoStatus: string;
  rejectionNote: string | null;
  submittedAt: string | null;
  approvedSnapshot: string | null;
  currentVerifiedProfile: string | null;
  studentName: string;
  dsid: string;
}

interface HistoryRecord {
  id: number;
  studentId: number;
  studentName: string;
  dsid: string;
  class: string;
  section: string;
  fullName: string | null;
  fatherName: string | null;
  motherName: string | null;
  presentAddress: string | null;
  aadharNumber: string | null;
  gender: string | null;
  phone: string | null;
  dob: string | null;
  enrollmentDate: string | null;
  guardianName: string | null;
  bloodGroup: string | null;
  rollNo: string | null;
  photoUrl: string | null;
  verifiedAt: string | null;
  approvedSnapshot: string | null;
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

const FIELD_LABELS: { key: string; label: string; editable: boolean }[] = [
  { key: "fullName",       label: "Full Name",         editable: true  },
  { key: "class",          label: "Class",              editable: false },
  { key: "section",        label: "Section",            editable: false },
  { key: "gender",         label: "Gender",             editable: true  },
  { key: "rollNo",         label: "Roll Number",        editable: true  },
  { key: "guardianName",   label: "Guardian Name",      editable: true  },
  { key: "phone",          label: "Phone",              editable: true  },
  { key: "dob",            label: "Date of Birth",      editable: true  },
  { key: "enrollmentDate", label: "Date of Admission",  editable: true  },
  { key: "bloodGroup",     label: "Blood Group",        editable: true  },
  { key: "fatherName",     label: "Father's Name",      editable: true  },
  { key: "motherName",     label: "Mother's Name",      editable: true  },
  { key: "aadharNumber",   label: "Aadhaar Number",     editable: true  },
  { key: "presentAddress", label: "Present Address",    editable: true  },
];

type EditableFields = {
  fullName: string;
  rollNo: string;
  fatherName: string;
  motherName: string;
  presentAddress: string;
  aadharNumber: string;
  gender: string;
  phone: string;
  dob: string;
  enrollmentDate: string;
  guardianName: string;
  bloodGroup: string;
};

function initEdits(p: PendingProfile): EditableFields {
  return {
    fullName:       p.fullName       ?? "",
    rollNo:         p.rollNo         ?? "",
    fatherName:     p.fatherName     ?? "",
    motherName:     p.motherName     ?? "",
    presentAddress: p.presentAddress ?? "",
    aadharNumber:   p.aadharNumber   ?? "",
    gender:         p.gender         ?? "",
    phone:          p.phone          ?? "",
    dob:            p.dob            ?? "",
    enrollmentDate: p.enrollmentDate ?? "",
    guardianName:   p.guardianName   ?? "",
    bloodGroup:     p.bloodGroup     ?? "",
  };
}

export default function StudentProfilesModule({ teacher }: { teacher: TeacherMe }) {
  const isArchiveMode = useArchiveMode();
  const { toast } = useToast();
  const [selectedIds,      setSelectedIds]      = useState<Set<number>>(new Set());
  const [reviewProfile,    setReviewProfile]    = useState<PendingProfile | null>(null);
  const [photoPreview,     setPhotoPreview]     = useState<string | null>(null);
  const [rejectNote,       setRejectNote]       = useState("");
  const [showRejectInput,  setShowRejectInput]  = useState(false);
  const [editMode,         setEditMode]         = useState(false);
  const [editedFields,     setEditedFields]     = useState<EditableFields>({ fullName:"", rollNo:"", fatherName:"", motherName:"", presentAddress:"", aadharNumber:"", gender:"", phone:"", dob:"", enrollmentDate:"", guardianName:"", bloodGroup:"" });
  const [livePhotoUrl,     setLivePhotoUrl]     = useState<string | null>(null);
  const [showHistory,      setShowHistory]      = useState(false);
  const [historyDetail,    setHistoryDetail]    = useState<HistoryRecord | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { data: profiles = [], isLoading } = useQuery<PendingProfile[]>({
    queryKey: ["/api/teacher/pending-profiles"],
    refetchInterval: 30000,
  });

  const { data: historyRecords = [], isLoading: historyLoading } = useQuery<HistoryRecord[]>({
    queryKey: ["/api/teacher/profiles/approval-history"],
    enabled: showHistory,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ studentId, corrections }: { studentId: number; corrections?: Record<string, string> }) => {
      return apiRequest("POST", `/api/teacher/profiles/${studentId}/approve`, { corrections });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles/count"] });
      toast({ title: "Profile approved!" });
      closeModal();
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ studentId, note }: { studentId: number; note: string }) => {
      return apiRequest("POST", `/api/teacher/profiles/${studentId}/reject`, { note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles/count"] });
      toast({ title: "Profile rejected." });
      closeModal();
    },
    onError: (e: Error) => toast({ title: "Rejection failed", description: e.message, variant: "destructive" }),
  });

  const photoUploadMutation = useMutation({
    mutationFn: async ({ studentId, file }: { studentId: number; file: File }) => {
      const fd = new FormData();
      fd.append("photo", file);
      const r = await fetch(`/api/teacher/students/${studentId}/photo`, {
        method: "POST", body: fd, credentials: "include",
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || "Upload failed"); }
      return r.json() as Promise<{ photoUrl: string }>;
    },
    onSuccess: (data) => {
      setLivePhotoUrl(data.photoUrl);
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles"] });
      toast({ title: "Photo updated!" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !reviewProfile) return;
    e.target.value = "";
    if (file.size > 1 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Please upload an image smaller than 1 MB.", variant: "destructive" });
      return;
    }
    photoUploadMutation.mutate({ studentId: reviewProfile.studentId, file });
  }

  const bulkApproveMutation = useMutation({
    mutationFn: async (ids: number[]) => apiRequest("POST", "/api/teacher/profiles/bulk-approve", { studentIds: ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/pending-profiles/count"] });
      toast({ title: "Profiles approved!" });
      setSelectedIds(new Set());
    },
    onError: (e: Error) => toast({ title: "Bulk approval failed", description: e.message, variant: "destructive" }),
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
    setLivePhotoUrl(null);
    setEditedFields(initEdits(p));
    setEditMode(false);
    setRejectNote("");
    setShowRejectInput(false);
  }

  function closeModal() {
    setReviewProfile(null);
    setEditMode(false);
    setShowRejectInput(false);
    setRejectNote("");
  }

  function submitRejection() {
    if (!rejectNote.trim()) {
      toast({ title: "Note required", description: "Please provide a reason for rejection.", variant: "destructive" });
      return;
    }
    if (!reviewProfile) return;
    rejectMutation.mutate({ studentId: reviewProfile.studentId, note: rejectNote });
  }

  function handleApprove() {
    if (!reviewProfile) return;
    // Build corrections: only changed editable fields
    const corrections: Record<string, string> = {};
    (Object.keys(editedFields) as (keyof EditableFields)[]).forEach((k) => {
      const original = (reviewProfile[k as keyof PendingProfile] as string | null) ?? "";
      if (editedFields[k] !== original) corrections[k] = editedFields[k];
    });
    approveMutation.mutate({ studentId: reviewProfile.studentId, corrections: Object.keys(corrections).length > 0 ? corrections : undefined });
  }

  // Build subtitle: list all classes this teacher covers
  const classCoverage = (() => {
    const pairs: string[] = [];
    if (teacher.assignedClass && teacher.assignedSection)
      pairs.push(`${teacher.assignedClass}-${teacher.assignedSection}`);
    (teacher.mappings ?? []).forEach(m => {
      const label = `${m.className}-${m.section}`;
      if (!pairs.includes(label)) pairs.push(label);
    });
    return pairs.length > 0 ? pairs.join(", ") : "No class assigned";
  })();

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
            Class {classCoverage} · {profiles.length} pending
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* History button — always visible */}
          <button
            onClick={() => { setShowHistory(true); setHistoryDetail(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-sm font-semibold hover:bg-violet-100 transition-colors"
            data-testid="button-approval-history"
          >
            <History className="w-4 h-4" />
            Approval History
          </button>
          {profiles.length > 0 && (
            <>
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
            </>
          )}
        </div>
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
          onClick={closeModal}
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
                  onClick={closeModal}
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
              <div className="flex items-center gap-2">
                {reviewProfile.submittedAt && (
                  <span className="text-xs text-blue-200 hidden sm:block">
                    Submitted: {new Date(reviewProfile.submittedAt).toLocaleDateString("en-GB")}
                  </span>
                )}
                {!isArchiveMode && !showRejectInput && (
                  <button
                    onClick={() => setEditMode(e => !e)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      editMode
                        ? "bg-amber-400 text-amber-900 hover:bg-amber-300"
                        : "bg-white/10 hover:bg-white/20 text-white"
                    }`}
                  >
                    {editMode ? <Save className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                    {editMode ? "Editing…" : "Edit"}
                  </button>
                )}
              </div>
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
                            {(liveData as any)[key] || <span className="text-gray-300 italic">—</span>}
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

              {/* RIGHT: Pending submission (editable in edit mode) */}
              <div className="flex-1 p-5 space-y-4 bg-emerald-50/30">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-emerald-600" />
                  <h4 className="text-sm font-bold text-emerald-700">Pending Submission</h4>
                  <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    editMode
                      ? "bg-amber-100 text-amber-700 border-amber-300"
                      : "bg-emerald-100 text-emerald-700 border-emerald-200"
                  }`}>
                    {editMode ? "EDITING" : "AWAITING REVIEW"}
                  </span>
                </div>

                {(() => {
                  const liveData = parseProfile(reviewProfile.currentVerifiedProfile);
                  return (
                    <div className="space-y-3">
                      {/* Photo with teacher upload button */}
                      <div className="flex flex-col items-center gap-2 mb-3">
                        <div className="relative">
                          {(livePhotoUrl || reviewProfile.photoUrl) ? (
                            <img
                              src={livePhotoUrl || reviewProfile.photoUrl!}
                              alt="Student photo"
                              className="w-20 h-20 rounded-full object-cover border-4 border-emerald-400 shadow"
                            />
                          ) : (
                            <div className="w-20 h-20 rounded-full bg-gray-100 border-4 border-gray-200 flex items-center justify-center">
                              <User className="w-8 h-8 text-gray-300" />
                            </div>
                          )}
                          {reviewProfile.photoStatus === "pending" && !livePhotoUrl && (
                            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold bg-yellow-400 text-white px-2 py-0.5 rounded-full whitespace-nowrap shadow">
                              PHOTO PENDING
                            </span>
                          )}
                          {livePhotoUrl && (
                            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold bg-emerald-500 text-white px-2 py-0.5 rounded-full whitespace-nowrap shadow">
                              UPDATED
                            </span>
                          )}
                        </div>
                        {!isArchiveMode && (
                          <button
                            onClick={() => photoInputRef.current?.click()}
                            disabled={photoUploadMutation.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-50"
                          >
                            {photoUploadMutation.isPending
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Camera className="w-3 h-3" />}
                            {photoUploadMutation.isPending ? "Uploading…" : "Change Photo"}
                          </button>
                        )}
                        <input
                          ref={photoInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handlePhotoFile}
                        />
                        <p className="text-[10px] text-gray-400">Max 1 MB · Teacher can change anytime</p>
                      </div>
                      {FIELD_LABELS.map(({ key, label, editable }) => {
                        const rawVal = (reviewProfile as any)[key] as string | null;
                        const oldVal = liveData ? (liveData as any)[key] : null;
                        const currentVal = (editMode && editable)
                          ? (editedFields as any)[key]
                          : (rawVal ?? "");
                        const changed = liveData && rawVal !== oldVal;

                        return (
                          <div
                            key={key}
                            className={`rounded-lg border px-3 py-2 transition-colors ${
                              editMode && editable
                                ? "bg-amber-50 border-amber-300 ring-1 ring-amber-200"
                                : changed
                                  ? "bg-emerald-50 border-emerald-300 ring-1 ring-emerald-200"
                                  : "bg-white border-gray-100"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <p className="text-xs text-gray-400 font-medium">{label}</p>
                              {!editMode && changed && (
                                <span className="text-[9px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">CHANGED</span>
                              )}
                              {editMode && editable && (
                                <span className="text-[9px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded-full">EDITABLE</span>
                              )}
                              {editMode && !editable && (
                                <span className="text-[9px] text-gray-400 italic ml-auto">system-assigned</span>
                              )}
                            </div>
                            {editMode && editable ? (
                              key === "presentAddress" ? (
                                <textarea
                                  value={(editedFields as any)[key]}
                                  onChange={(e) => setEditedFields(prev => ({ ...prev, [key]: e.target.value }))}
                                  rows={2}
                                  className="w-full text-sm font-semibold text-amber-800 bg-transparent border-none outline-none resize-none placeholder-amber-300"
                                  placeholder={`Enter ${label}…`}
                                />
                              ) : (
                                <input
                                  type="text"
                                  value={(editedFields as any)[key]}
                                  onChange={(e) => setEditedFields(prev => ({ ...prev, [key]: e.target.value }))}
                                  className="w-full text-sm font-semibold text-amber-800 bg-transparent border-none outline-none placeholder-amber-300"
                                  placeholder={`Enter ${label}…`}
                                />
                              )
                            ) : (
                              <p className={`text-sm font-semibold mt-0.5 ${changed ? "text-emerald-700" : "text-gray-700"}`}>
                                {rawVal || <span className="text-gray-300 italic">—</span>}
                              </p>
                            )}
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
                    onClick={handleApprove}
                    disabled={isArchiveMode || approveMutation.isPending}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-60 shadow ${
                      editMode
                        ? "bg-amber-500 hover:bg-amber-600"
                        : "bg-emerald-500 hover:bg-emerald-600"
                    }`}
                    data-testid="button-approve"
                  >
                    {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    {editMode ? "Save Edits & Approve" : "Approve Profile"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Approval History Panel ─────────────────────────────────────────── */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="ml-auto w-full max-w-lg h-full bg-white flex flex-col shadow-2xl">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-white sticky top-0 z-10">
              {historyDetail ? (
                <button
                  onClick={() => setHistoryDetail(null)}
                  className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back to History
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-violet-600" />
                  <h3 className="text-base font-bold text-slate-800">Approval History</h3>
                  {!historyLoading && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                      {historyRecords.length}
                    </span>
                  )}
                </div>
              )}
              <button
                onClick={() => { setShowHistory(false); setHistoryDetail(null); }}
                className="p-1.5 rounded-full hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto">
              {historyLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
                </div>
              ) : historyDetail ? (
                /* ── Detail view ── */
                <div className="p-5 space-y-5">
                  {/* Student identity */}
                  <div className="flex items-center gap-4 p-4 rounded-xl bg-violet-50 border border-violet-100">
                    {historyDetail.photoUrl ? (
                      <img src={historyDetail.photoUrl} alt={historyDetail.studentName}
                        className="w-14 h-14 rounded-full object-cover border-2 border-violet-300 flex-shrink-0" />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-violet-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-violet-700 font-bold text-lg">
                          {historyDetail.studentName.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="font-bold text-slate-800 text-base">{historyDetail.studentName}</p>
                      <p className="text-xs text-slate-500">{historyDetail.dsid} · Class {historyDetail.class}-{historyDetail.section}</p>
                      <p className="text-xs text-violet-600 font-semibold mt-1">
                        ✓ Approved {historyDetail.verifiedAt ? new Date(historyDetail.verifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Approved fields */}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Approved Data</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {FIELD_LABELS.map(({ key, label }) => {
                        const val = (historyDetail as any)[key] ?? null;
                        return (
                          <div key={key} className={`rounded-lg border px-3 py-2 bg-white ${key === "presentAddress" ? "col-span-2" : ""}`}>
                            <p className="text-[10px] text-slate-400 font-medium">{label}</p>
                            <p className="text-sm font-semibold text-slate-700 mt-0.5">
                              {val || <span className="text-slate-300 italic text-xs">—</span>}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : historyRecords.length === 0 ? (
                /* ── Empty state ── */
                <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                  <div className="w-16 h-16 rounded-full bg-violet-50 flex items-center justify-center mb-4">
                    <History className="w-8 h-8 text-violet-300" />
                  </div>
                  <p className="font-semibold text-slate-600">No approvals yet</p>
                  <p className="text-sm text-slate-400 mt-1">Profiles you approve will appear here.</p>
                </div>
              ) : (
                /* ── List view ── */
                <div className="divide-y divide-slate-100">
                  {historyRecords.map((rec) => {
                    const initials = rec.studentName.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
                    const dateStr = rec.verifiedAt
                      ? new Date(rec.verifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                      : "—";
                    const timeStr = rec.verifiedAt
                      ? new Date(rec.verifiedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                      : "";
                    return (
                      <button
                        key={rec.id}
                        onClick={() => setHistoryDetail(rec)}
                        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                      >
                        {/* Avatar */}
                        {rec.photoUrl ? (
                          <img src={rec.photoUrl} alt={rec.studentName}
                            className="w-10 h-10 rounded-full object-cover border-2 border-violet-200 flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-violet-700 font-bold text-xs">{initials}</span>
                          </div>
                        )}
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 text-sm truncate">{rec.studentName}</p>
                          <p className="text-xs text-slate-400 truncate">{rec.dsid} · Class {rec.class}-{rec.section}</p>
                        </div>
                        {/* Date + check */}
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            <CheckCircle className="w-3 h-3" />
                            Approved
                          </span>
                          <span className="text-[10px] text-slate-400">{dateStr}</span>
                          <span className="text-[10px] text-slate-300">{timeStr}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
