import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, Camera, CheckCircle, Clock, XCircle, AlertCircle, Loader2,
  User, Lock, Eye, EyeOff, GraduationCap, FileText, Shield,
  ChevronRight, AlertTriangle, MoreVertical, X,
} from "lucide-react";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

interface StudentMeResponse {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  phone: string;
  dob: string;
  photoUrl: string | null;
  enrollmentDate: string | null;
  schoolName: string;
  schoolCode: string;
  schoolId?: number;
}

interface StudentProfileRecord {
  id: number;
  studentId: number;
  schoolId: number;
  status: "draft" | "pending" | "approved" | "rejected";
  fullName: string | null;
  class: string | null;
  section: string | null;
  rollNo: string | null;
  fatherName: string | null;
  motherName: string | null;
  presentAddress: string | null;
  photoUrl: string | null;
  photoStatus: "none" | "pending" | "approved";
  rejectionNote: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
}

interface VerifiedProfileData {
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

interface LiveStudentData {
  name: string;
  class: string;
  section: string;
  digitalStudentId: string;
  photoUrl: string | null;
  enrollmentDate: string | null;
  verifiedProfile: VerifiedProfileData | null;
}

interface ApprovedSnapshot {
  fullName: string | null;
  class: string | null;
  section: string | null;
  rollNo: string | null;
  fatherName: string | null;
  motherName: string | null;
  presentAddress: string | null;
  photoUrl: string | null;
  approvedAt: string | null;
}

interface StudentProfileResponse {
  profile: StudentProfileRecord | null;
  approvedSnapshot: ApprovedSnapshot | null;
  liveData: LiveStudentData;
}

interface VerificationLimit {
  used: number;
  remaining: number;
  allowed: number;
}

const menuVariants = {
  hidden: { opacity: 0, y: -8, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 400, damping: 30 } },
  exit: { opacity: 0, y: -6, scale: 0.96, transition: { duration: 0.15 } },
};

function StatusBadge({ status, profile }: { status: string; profile: StudentProfileRecord | null }) {
  if (status === "pending") {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-yellow-400/30 bg-yellow-400/10 text-yellow-300 text-xs font-medium" data-testid="status-banner">
        <Clock className="w-3.5 h-3.5 flex-shrink-0 text-yellow-400" />
        <span data-testid="status-label">Awaiting Teacher Verification</span>
        {profile?.submittedAt && (
          <span className="ml-auto text-yellow-400/70 text-[10px]">
            {new Date(profile.submittedAt).toLocaleDateString("en-GB")}
          </span>
        )}
      </div>
    );
  }
  if (status === "approved") {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#10b981]/40 bg-[#10b981]/15 text-emerald-300 text-xs font-semibold" data-testid="status-banner">
        <CheckCircle className="w-4 h-4 flex-shrink-0 text-[#10b981]" />
        <span data-testid="status-label">Profile Verified</span>
        {profile?.verifiedAt && (
          <span className="ml-auto text-emerald-400/60 text-[10px] font-normal">
            {new Date(profile.verifiedAt).toLocaleDateString("en-GB")}
          </span>
        )}
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-red-400/30 bg-red-400/10 text-red-300" data-testid="status-banner">
        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-400" />
        <div>
          <p className="font-semibold text-sm" data-testid="status-label">Rejected — Please resubmit</p>
          {profile?.rejectionNote && (
            <p className="text-xs mt-1 text-red-400/80" data-testid="rejection-note">
              {profile.rejectionNote}
            </p>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-white/40 text-xs" data-testid="status-banner">
      <AlertCircle className="w-3.5 h-3.5 text-white/30" />
      <span data-testid="status-label">Draft — Submit for verification to get approved</span>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-white/6 last:border-0">
      <span className="text-xs text-white/40 uppercase tracking-wide flex-shrink-0">{label}</span>
      <span className={`text-sm font-semibold text-white text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ReadOnlyField({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-white/40 mb-1.5 block">{label}</label>
      <div
        className="w-full px-3 py-2.5 rounded-xl bg-white/4 border border-white/8 text-white/50 text-sm flex items-center gap-2"
        data-testid={testId}
      >
        <Lock className="w-3 h-3 text-white/25 flex-shrink-0" />
        <span>{value || "—"}</span>
      </div>
    </div>
  );
}

export default function StudentProfile() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [form, setForm] = useState({
    fullName: "",
    rollNo: "",
    fatherName: "",
    motherName: "",
    presentAddress: "",
  });

  const originalFormRef = useRef(form);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: profileData, isLoading: profileLoading } = useQuery<StudentProfileResponse | null>({
    queryKey: ["/api/student/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: limitData } = useQuery<VerificationLimit>({
    queryKey: ["/api/student/verification-limit"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!student,
    staleTime: 30000,
  });

  const profile = profileData?.profile ?? null;
  const approvedSnapshot = profileData?.approvedSnapshot ?? null;

  useEffect(() => {
    if (profile) {
      const vals = {
        fullName: profile.fullName || "",
        rollNo: profile.rollNo || "",
        fatherName: profile.fatherName || "",
        motherName: profile.motherName || "",
        presentAddress: profile.presentAddress || "",
      };
      setForm(vals);
      originalFormRef.current = vals;
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!securityOpen) {
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setShowCurrentPw(false);
      setShowNewPw(false);
      setShowConfirmPw(false);
    }
  }, [securityOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (isEditing) {
      const timer = setTimeout(() => {
        fullNameRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isEditing]);

  useEffect(() => {
    if (securityOpen) {
      const timer = setTimeout(() => {
        currentPasswordRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [securityOpen]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/student/profile", form);
      return await apiRequest("POST", "/api/student/profile/submit");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/verification-limit"] });
      toast({ title: "Submitted for verification!" });
      setIsEditing(false);
    },
    onError: (e: Error) => {
      toast({ title: "Submission failed", description: e.message, variant: "destructive" });
    },
  });

  const photoMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("photo", file);
      const res = await fetch("/api/student/profile/photo", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Photo upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/profile"] });
      toast({ title: "Photo uploaded", description: "Awaiting teacher approval." });
    },
    onError: (e: Error) => {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/student/change-password", {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
    },
    onSuccess: () => {
      setSecurityOpen(false);
      toast({ title: "Password changed successfully." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  if (studentLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0a1628] to-[#0a2018]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  if (!student) {
    setLocation("/student-login");
    return null;
  }

  const status = profile?.status || "draft";
  const canSubmit = status !== "pending";
  const isVerificationLocked = !!(limitData && limitData.remaining <= 0);

  const dob = student.dob
    ? new Date(student.dob).toLocaleDateString("en-GB")
    : "—";

  const enrollmentDateDisplay = student.enrollmentDate
    ? new Date(student.enrollmentDate).toLocaleDateString("en-GB")
    : "—";

  const photoToShow = profile?.photoUrl || student.photoUrl;
  const photoIsApproved = profile?.photoStatus === "approved";

  const initials = student.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    photoMutation.mutate(file);
    e.target.value = "";
  }

  function handleStartEditing() {
    originalFormRef.current = { ...form };
    setIsEditing(true);
    setSecurityOpen(false);
    setMenuOpen(false);
  }

  function handleCancel() {
    setForm({ ...originalFormRef.current });
    setIsEditing(false);
  }

  function handleSubmit() {
    if (!form.fullName || !form.fatherName || !form.motherName || !form.presentAddress) {
      toast({
        title: "Missing fields",
        description: "Please fill in Full Name, Father's Name, Mother's Name, and Address.",
        variant: "destructive",
      });
      return;
    }
    submitMutation.mutate();
  }

  function handleChangePassword() {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      toast({ title: "Too short", description: "At least 6 characters.", variant: "destructive" });
      return;
    }
    passwordMutation.mutate();
  }

  function handleOpenSecurity() {
    setSecurityOpen(true);
    setIsEditing(false);
    setMenuOpen(false);
  }

  const inputBase = "w-full px-3 py-2.5 rounded-xl bg-white border text-[#1a1a1a] placeholder:text-gray-400 text-base focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors";
  const editingBorder = "border-gray-300 focus:ring-[#10b981] focus:border-[#10b981]";
  const defaultBorder = "border-gray-300 focus:ring-[#10b981] focus:border-[#10b981]";
  const inputStyle: React.CSSProperties = {
    pointerEvents: 'auto',
    touchAction: 'manipulation',
    WebkitUserSelect: 'text',
    position: 'relative',
    zIndex: 10000,
    caretColor: '#10b981',
  };

  const isAnyFormOpen = isEditing || securityOpen;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#0a1628] via-[#0a1e2a] to-[#061410]">

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-40 bg-[#10b981]/90 backdrop-blur-md shadow-lg shadow-emerald-900/20">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">

          {/* Left: Back / Cancel */}
          {isEditing ? (
            <button
              onClick={handleCancel}
              className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors flex-shrink-0 text-sm font-medium"
              data-testid="button-back"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          ) : securityOpen ? (
            <button
              onClick={() => setSecurityOpen(false)}
              className="flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors flex-shrink-0 text-sm font-medium"
              data-testid="button-back"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          ) : (
            <button
              onClick={() => setLocation("/student-dashboard")}
              className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors flex-shrink-0"
              data-testid="button-back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}

          <div className="flex-1 flex items-center gap-2 min-w-0">
            <GraduationCap className="w-5 h-5 text-white/80 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-white font-bold text-sm leading-tight truncate">
                {isEditing ? "Verification Details" : securityOpen ? "Security" : "My Profile"}
              </p>
              <p className="text-emerald-100/70 text-[11px] truncate">{student.schoolName}</p>
            </div>
          </div>

          {/* Right: ⋮ menu (read-only mode only) */}
          {!isAnyFormOpen ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors"
                data-testid="button-menu"
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    variants={menuVariants}
                    initial="hidden"
                    animate="show"
                    exit="exit"
                    className="absolute right-0 top-12 z-50 w-60 rounded-2xl bg-[#0f2a1e]/95 backdrop-blur-xl border border-white/12 shadow-2xl shadow-black/40 overflow-hidden"
                    data-testid="menu-options"
                  >
                    {/* Submit for Verification */}
                    <button
                      onClick={() => {
                        if (isVerificationLocked) {
                          toast({
                            title: "Monthly limit reached",
                            description: "You have used all 3 submissions for this month.",
                            variant: "destructive",
                          });
                          setMenuOpen(false);
                          return;
                        }
                        handleStartEditing();
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                        isVerificationLocked
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-white/8"
                      }`}
                      data-testid="menu-submit-verification"
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#10b981]/20 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-[#10b981]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white">Submit for Verification</p>
                        {limitData && (
                          <p className={`text-[10px] mt-0.5 ${isVerificationLocked ? "text-red-400" : "text-emerald-400"}`}>
                            {isVerificationLocked
                              ? "Limit reached this month"
                              : `${limitData.remaining} of ${limitData.allowed} attempts left`}
                          </p>
                        )}
                      </div>
                      {!isVerificationLocked && <ChevronRight className="w-4 h-4 text-white/30 flex-shrink-0" />}
                      {isVerificationLocked && <Lock className="w-4 h-4 text-red-400/60 flex-shrink-0" />}
                    </button>

                    <div className="h-px bg-white/8 mx-3" />

                    {/* Security */}
                    <button
                      onClick={handleOpenSecurity}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/8 transition-colors"
                      data-testid="menu-security"
                    >
                      <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                        <Shield className="w-4 h-4 text-blue-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-white">Security</p>
                        <p className="text-[10px] text-white/40 mt-0.5">Change password</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-white/30 flex-shrink-0" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : null}
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

          {/* ══ READ-ONLY VIEW ══ */}
          {!isEditing && !securityOpen && (
            <>
              <StatusBadge status={status} profile={profile} />

              {/* Identity Card */}
              <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden shadow-xl">
                <div className="px-5 py-6 flex items-center gap-5">
                  <div className="relative flex-shrink-0">
                    {photoToShow ? (
                      <img
                        src={photoToShow}
                        alt="Profile"
                        className={`w-20 h-20 rounded-full object-cover border-3 shadow-lg ${
                          photoIsApproved
                            ? "border-[#10b981]"
                            : profile?.photoStatus === "pending"
                            ? "border-yellow-400"
                            : "border-white/20"
                        }`}
                        data-testid="img-profile-photo"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#10b981]/30 to-emerald-700/20 border-2 border-[#10b981]/40 flex items-center justify-center shadow-lg">
                        <span className="text-xl font-bold text-[#10b981]">{initials}</span>
                      </div>
                    )}
                    {photoIsApproved && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-[#10b981] border-2 border-[#0a1628] flex items-center justify-center shadow-lg"
                        title="Photo Verified"
                        data-testid="badge-verified"
                      >
                        <CheckCircle className="w-3.5 h-3.5 text-white" />
                      </span>
                    )}
                    {profile?.photoStatus === "pending" && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-yellow-400 border-2 border-[#0a1628] flex items-center justify-center shadow-lg" title="Photo Pending">
                        <Clock className="w-3 h-3 text-[#0a1628]" />
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold text-white truncate" data-testid="text-student-name">
                      {profile?.fullName || student.name}
                    </h2>
                    <p className="text-sm text-emerald-300/80 mt-0.5">
                      Class {student.class} – {student.section}
                    </p>
                    <p className="text-xs text-white/40 mt-1 font-mono">{student.digitalStudentId}</p>
                  </div>
                </div>

                <div className="px-5 pb-5 space-y-0">
                  <InfoRow label="DSID" value={student.digitalStudentId} mono />
                  <InfoRow label="School" value={student.schoolCode} mono />
                  <InfoRow label="Class / Section" value={`${student.class} – ${student.section}`} />
                  <InfoRow label="Date of Birth" value={dob} />
                  <InfoRow label="Enrolled" value={enrollmentDateDisplay} />
                  {profile?.rollNo && <InfoRow label="Roll No" value={profile.rollNo} />}
                  {profile?.fatherName && <InfoRow label="Father's Name" value={profile.fatherName} />}
                  {profile?.motherName && <InfoRow label="Mother's Name" value={profile.motherName} />}
                  {profile?.presentAddress && <InfoRow label="Address" value={profile.presentAddress} />}
                </div>
              </div>

              {/* Photo pending sub-card */}
              {profile?.photoStatus === "pending" && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-yellow-400/25 bg-yellow-400/8">
                  <Camera className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  <p className="text-xs text-yellow-300 font-medium">
                    Your photo is pending teacher review and not yet visible on ID cards.
                  </p>
                </div>
              )}

              {/* Last verified snapshot */}
              {approvedSnapshot && status !== "approved" && (
                <div className="rounded-2xl border border-[#10b981]/25 bg-[#10b981]/8 overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#10b981]/15 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-[#10b981]" />
                    <h3 className="text-xs font-bold text-emerald-300 uppercase tracking-wide">Last Verified Data</h3>
                    {approvedSnapshot.approvedAt && (
                      <span className="ml-auto text-[10px] text-emerald-500">
                        {new Date(approvedSnapshot.approvedAt).toLocaleDateString("en-GB")}
                      </span>
                    )}
                  </div>
                  <div className="px-4 py-3 grid grid-cols-2 gap-2 text-xs">
                    {approvedSnapshot.fullName && (
                      <div>
                        <span className="text-[#10b981]/70">Full Name: </span>
                        <span className="text-emerald-200 font-semibold">{approvedSnapshot.fullName}</span>
                      </div>
                    )}
                    {approvedSnapshot.fatherName && (
                      <div>
                        <span className="text-[#10b981]/70">Father: </span>
                        <span className="text-emerald-200 font-semibold">{approvedSnapshot.fatherName}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Hint */}
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-white/8 bg-white/3">
                <MoreVertical className="w-4 h-4 text-white/30" />
                <p className="text-xs text-white/35">
                  Tap the ⋮ menu above to submit for verification or change your password.
                </p>
              </div>
            </>
          )}

          {/* ══ EDIT / INLINE MODE — VERIFICATION DETAILS ══ */}
          {isEditing && (
            <>
              {/* Verification limit banner */}
              {limitData && (
                <div
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
                    isVerificationLocked
                      ? "border-red-400/30 bg-red-400/10 text-red-300"
                      : limitData.remaining === 1
                      ? "border-yellow-400/30 bg-yellow-400/8 text-yellow-300"
                      : "border-[#10b981]/30 bg-[#10b981]/10 text-emerald-300"
                  }`}
                  data-testid="verification-limit-banner"
                >
                  {isVerificationLocked
                    ? <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-400" />
                    : <FileText className="w-4 h-4 flex-shrink-0" />}
                  <span>
                    {isVerificationLocked
                      ? "Monthly limit (3) reached. Please contact Admin."
                      : `${limitData.remaining} of ${limitData.allowed} submission attempts remaining this month.`}
                  </span>
                </div>
              )}

              {/* Photo upload section */}
              <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-5 flex flex-col items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                  data-testid="input-photo-file"
                />
                <div className="relative group">
                  {photoToShow ? (
                    <img
                      src={photoToShow}
                      alt="Profile"
                      className="w-24 h-24 rounded-full object-cover border-4 border-[#10b981]/50 shadow-lg"
                      data-testid="img-profile-photo-edit"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#10b981]/20 to-emerald-700/15 border-4 border-[#10b981]/30 flex items-center justify-center shadow-lg">
                      <span className="text-2xl font-bold text-[#10b981]/70">{initials}</span>
                    </div>
                  )}
                  {profile?.photoStatus !== "approved" && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={photoMutation.isPending}
                      className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Upload photo"
                      data-testid="button-upload-photo"
                    >
                      {photoMutation.isPending
                        ? <Loader2 className="w-6 h-6 text-white animate-spin" />
                        : <Camera className="w-6 h-6 text-white" />}
                    </button>
                  )}
                  {photoIsApproved && (
                    <span className="absolute -bottom-1 -right-1 bg-[#10b981] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-[#0a1628]">
                      ✓ VERIFIED
                    </span>
                  )}
                </div>

                {profile?.photoStatus === "pending" && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-yellow-400/25 bg-yellow-400/8 text-yellow-300 text-xs w-full">
                    <Camera className="w-3.5 h-3.5 flex-shrink-0" />
                    Photo pending teacher review
                  </div>
                )}

                {profile?.photoStatus !== "approved" && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={photoMutation.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#10b981]/30 text-[#10b981] text-xs font-medium hover:bg-[#10b981]/10 transition-colors"
                    data-testid="button-upload-photo-alt"
                  >
                    {photoMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                    {profile?.photoStatus === "pending" ? "Replace Photo" : "Upload Photo"}
                  </button>
                )}
              </div>

              {/* Form fields card — no overflow-hidden to prevent Android keyboard clipping */}
              <div
                className="rounded-2xl border border-[#10b981]/25 bg-white/5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-5 py-4 border-b border-white/8 flex items-center gap-2">
                  <User className="w-4 h-4 text-[#10b981]" />
                  <h2 className="text-sm font-bold text-white">Verification Details</h2>
                  {status === "pending" && (
                    <span className="ml-auto text-[10px] text-yellow-400 bg-yellow-400/10 border border-yellow-400/25 px-2 py-0.5 rounded-full">
                      Under Review
                    </span>
                  )}
                </div>

                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                    {/* Full Name — editable */}
                    <div>
                      <label className="text-xs font-medium text-white/50 mb-1.5 block">
                        Full Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        ref={fullNameRef}
                        type="text"
                        value={form.fullName}
                        onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                        placeholder="Full name as in certificate"
                        className={`${inputBase} ${editingBorder}`}
                        style={inputStyle}
                        data-testid="input-full-name"
                      />
                    </div>

                    {/* Roll Number — editable */}
                    <div>
                      <label className="text-xs font-medium text-white/50 mb-1.5 block">Roll Number</label>
                      <input
                        type="text"
                        value={form.rollNo}
                        onChange={(e) => setForm((f) => ({ ...f, rollNo: e.target.value }))}
                        placeholder="e.g. 01"
                        className={`${inputBase} ${editingBorder}`}
                        style={inputStyle}
                        data-testid="input-roll-no"
                      />
                    </div>

                    {/* Class — read-only (system-assigned) */}
                    <ReadOnlyField label="Class (System-assigned)" value={`Class ${student.class}`} testId="select-class" />

                    {/* Section — read-only (system-assigned) */}
                    <ReadOnlyField label="Section (System-assigned)" value={`Section ${student.section}`} testId="select-section" />

                    {/* Father's Name — editable */}
                    <div>
                      <label className="text-xs font-medium text-white/50 mb-1.5 block">
                        Father's Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.fatherName}
                        onChange={(e) => setForm((f) => ({ ...f, fatherName: e.target.value }))}
                        placeholder="Father's full name"
                        className={`${inputBase} ${editingBorder}`}
                        style={inputStyle}
                        data-testid="input-father-name"
                      />
                    </div>

                    {/* Mother's Name — editable */}
                    <div>
                      <label className="text-xs font-medium text-white/50 mb-1.5 block">
                        Mother's Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.motherName}
                        onChange={(e) => setForm((f) => ({ ...f, motherName: e.target.value }))}
                        placeholder="Mother's full name"
                        className={`${inputBase} ${editingBorder}`}
                        style={inputStyle}
                        data-testid="input-mother-name"
                      />
                    </div>
                  </div>

                  {/* Address — editable, full-width */}
                  <div>
                    <label className="text-xs font-medium text-white/50 mb-1.5 block">
                      Present Address <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={form.presentAddress}
                      onChange={(e) => setForm((f) => ({ ...f, presentAddress: e.target.value }))}
                      placeholder="Full residential address"
                      rows={3}
                      className={`${inputBase} ${editingBorder} resize-none`}
                      style={inputStyle}
                      data-testid="input-address"
                    />
                  </div>
                </div>
              </div>

              {/* System-assigned read-only strip */}
              <div className="rounded-xl border border-white/8 bg-white/3 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Lock className="w-3.5 h-3.5 text-white/30" />
                  <span className="text-[10px] text-white/30 uppercase tracking-widest">System-assigned (read-only)</span>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <div><span className="text-white/30">DSID: </span><span className="text-white/60 font-mono">{student.digitalStudentId}</span></div>
                  <div><span className="text-white/30">School: </span><span className="text-white/60 font-mono">{student.schoolCode}</span></div>
                  <div><span className="text-white/30">Enrolled: </span><span className="text-white/60">{enrollmentDateDisplay}</span></div>
                </div>
              </div>

              {/* Action buttons — full-width on mobile */}
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleCancel}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl border-2 border-[#10b981]/40 text-[#10b981] text-sm font-semibold hover:bg-[#10b981]/10 transition-colors"
                  data-testid="button-cancel-bottom"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>

                <div className="flex-1 flex flex-col gap-1">
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit || isVerificationLocked || submitMutation.isPending}
                    className={`w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
                      !canSubmit
                        ? "bg-yellow-400/15 border border-yellow-400/30 text-yellow-300 opacity-80"
                        : isVerificationLocked
                        ? "bg-red-400/15 border border-red-400/25 text-red-300 opacity-80"
                        : "bg-[#10b981] hover:bg-emerald-600 text-white shadow-lg shadow-emerald-900/30"
                    }`}
                    data-testid="button-submit"
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : !canSubmit ? (
                      <Clock className="w-4 h-4" />
                    ) : isVerificationLocked ? (
                      <Lock className="w-4 h-4" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    {!canSubmit
                      ? "Awaiting Review"
                      : isVerificationLocked
                      ? "Monthly limit (3) reached"
                      : submitMutation.isPending
                      ? "Submitting…"
                      : "Submit for Approval"}
                  </button>
                  {isVerificationLocked && canSubmit && (
                    <p className="text-[10px] text-red-400/70 text-center">
                      Monthly limit (3) reached. Please contact Admin.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ══ SECURITY / CHANGE PASSWORD — INLINE FULL-PAGE VIEW ══ */}
          {securityOpen && (
            <div
              className="rounded-2xl border border-white/10 bg-[#0f2a1e]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header row */}
              <div className="px-5 py-4 border-b border-white/8 flex items-center gap-3">
                <Shield className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <h2 className="text-sm font-bold text-white">Change Password</h2>
              </div>

              <div className="p-5 space-y-4">
                {/* Current Password */}
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-wide mb-1.5 block">Current Password</label>
                  <div className="relative">
                    <input
                      ref={currentPasswordRef}
                      type={showCurrentPw ? "text" : "password"}
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
                      placeholder="Enter current password"
                      autoComplete="current-password"
                      className={`${inputBase} ${defaultBorder} pr-10`}
                      style={inputStyle}
                      data-testid="input-current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      style={{ zIndex: 10001 }}
                    >
                      {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-wide mb-1.5 block">New Password</label>
                  <div className="relative">
                    <input
                      type={showNewPw ? "text" : "password"}
                      value={passwordForm.newPassword}
                      onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                      placeholder="At least 6 characters"
                      autoComplete="new-password"
                      className={`${inputBase} pr-10 ${
                        passwordForm.newPassword && passwordForm.newPassword.length < 6
                          ? "border-red-400/40 focus:ring-red-400 focus:border-red-400"
                          : defaultBorder
                      }`}
                      style={inputStyle}
                      data-testid="input-new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      style={{ zIndex: 10001 }}
                    >
                      {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passwordForm.newPassword && passwordForm.newPassword.length < 6 && (
                    <p className="text-xs text-red-600 mt-1 font-medium">Minimum 6 characters</p>
                  )}
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="text-xs font-medium text-white/50 uppercase tracking-wide mb-1.5 block">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPw ? "text" : "password"}
                      value={passwordForm.confirmPassword}
                      onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                      placeholder="Repeat new password"
                      autoComplete="new-password"
                      className={`${inputBase} pr-10 ${
                        passwordForm.confirmPassword && passwordForm.confirmPassword !== passwordForm.newPassword
                          ? "border-red-400/40 focus:ring-red-400 focus:border-red-400"
                          : passwordForm.confirmPassword && passwordForm.confirmPassword === passwordForm.newPassword
                          ? "border-[#10b981] focus:ring-[#10b981] focus:border-[#10b981]"
                          : defaultBorder
                      }`}
                      style={inputStyle}
                      data-testid="input-confirm-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 min-w-[44px] min-h-[44px] flex items-center justify-center"
                      style={{ zIndex: 10001 }}
                    >
                      {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passwordForm.confirmPassword && passwordForm.confirmPassword !== passwordForm.newPassword && (
                    <p className="text-xs text-red-600 mt-1 font-medium">Passwords do not match</p>
                  )}
                  {passwordForm.confirmPassword && passwordForm.confirmPassword === passwordForm.newPassword && passwordForm.newPassword.length >= 6 && (
                    <p className="text-xs text-[#10b981] mt-1 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Passwords match
                    </p>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    onClick={() => setSecurityOpen(false)}
                    className="flex-1 flex items-center justify-center py-3 px-4 rounded-xl border border-white/15 text-white/60 text-sm font-medium hover:bg-white/8 transition-colors"
                    data-testid="button-close-security-modal"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleChangePassword}
                    disabled={passwordMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#10b981] hover:bg-emerald-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 shadow-lg shadow-emerald-900/30"
                    data-testid="button-change-password"
                  >
                    {passwordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    Update Password
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
