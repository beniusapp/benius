import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, Camera, CheckCircle, Clock, XCircle, AlertCircle, Loader2,
  User, Users, Lock, Eye, EyeOff, GraduationCap, RefreshCw,
  MoreVertical, FileText, Shield, X, ChevronRight, AlertTriangle,
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

const CLASS_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const SECTION_OPTIONS = ["A", "B", "C", "D", "E", "F"];

type View = "main" | "edit" | "security";

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: 0, opacity: 1, transition: { type: "spring", stiffness: 300, damping: 32 } },
  exit: (dir: number) => ({ x: dir < 0 ? "100%" : "-100%", opacity: 0, transition: { duration: 0.22 } }),
};

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

export default function StudentProfile() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<View>("main");
  const [viewDir, setViewDir] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);

  const [form, setForm] = useState({
    fullName: "",
    class: "",
    section: "",
    rollNo: "",
    fatherName: "",
    motherName: "",
    presentAddress: "",
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

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
      setForm({
        fullName: profile.fullName || "",
        class: profile.class || "",
        section: profile.section || "",
        rollNo: profile.rollNo || "",
        fatherName: profile.fatherName || "",
        motherName: profile.motherName || "",
        presentAddress: profile.presentAddress || "",
      });
    }
  }, [profile?.id]);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      return await apiRequest("POST", "/api/student/profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/profile"] });
      toast({ title: "Draft saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/student/profile", form);
      return await apiRequest("POST", "/api/student/profile/submit");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/verification-limit"] });
      toast({ title: "Submitted for verification!" });
      goTo("main", -1);
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
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast({ title: "Password changed successfully." });
      goTo("main", -1);
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

  function goTo(v: View, dir: number) {
    setViewDir(dir);
    setView(v);
    setMenuOpen(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    photoMutation.mutate(file);
    e.target.value = "";
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

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#0a1628] via-[#0a1e2a] to-[#061410]">

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-40 bg-[#10b981]/90 backdrop-blur-md shadow-lg shadow-emerald-900/20">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => {
              if (view !== "main") goTo("main", -1);
              else setLocation("/student-dashboard");
            }}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors flex-shrink-0"
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex-1 flex items-center gap-2 min-w-0">
            <GraduationCap className="w-5 h-5 text-white/80 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-white font-bold text-sm leading-tight truncate">
                {view === "main" ? "My Profile" : view === "edit" ? "Submit for Verification" : "Security"}
              </p>
              <p className="text-emerald-100/70 text-[11px] truncate">{student.schoolName}</p>
            </div>
          </div>

          {/* Hamburger (⋮) — only on main view */}
          {view === "main" && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors"
                data-testid="button-menu"
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              <AnimatePresence>
                {menuOpen && (
                  <>
                    {/* Backdrop */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuOpen(false)}
                    />
                    <motion.div
                      variants={menuVariants}
                      initial="hidden"
                      animate="show"
                      exit="exit"
                      className="absolute right-0 top-12 z-50 w-56 rounded-2xl bg-[#0f2a1e]/95 backdrop-blur-xl border border-white/12 shadow-2xl shadow-black/40 overflow-hidden"
                      data-testid="menu-options"
                    >
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
                          goTo("edit", 1);
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

                      <button
                        onClick={() => goTo("security", 1)}
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
                  </>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </header>

      {/* ── Animated View Container ── */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence custom={viewDir} mode="wait">

          {/* ══ MAIN / READ-ONLY VIEW ══ */}
          {view === "main" && (
            <motion.main
              key="main"
              custom={viewDir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="absolute inset-0 overflow-y-auto"
            >
              <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

                {/* Status banner */}
                <StatusBadge status={status} profile={profile} />

                {/* ── Identity Card ── */}
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden shadow-xl">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(16,185,129,0.08),_transparent_60%)] pointer-events-none rounded-2xl" />

                  <div className="px-5 py-6 flex items-center gap-5">
                    {/* Avatar */}
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
                      {/* Verified badge */}
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

                {/* Photo status sub-card */}
                {profile?.photoStatus === "pending" && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-yellow-400/25 bg-yellow-400/8">
                    <Camera className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    <p className="text-xs text-yellow-300 font-medium">
                      Your photo is pending teacher review and not yet visible on ID cards.
                    </p>
                  </div>
                )}

                {/* Last verified snapshot (shown when re-editing after approved) */}
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

                {/* Hint to open menu */}
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-white/8 bg-white/3">
                  <MoreVertical className="w-4 h-4 text-white/30" />
                  <p className="text-xs text-white/35">
                    Tap the ⋮ menu above to submit for verification or change your password.
                  </p>
                </div>
              </div>
            </motion.main>
          )}

          {/* ══ EDIT / SUBMIT FOR VERIFICATION VIEW ══ */}
          {view === "edit" && (
            <motion.main
              key="edit"
              custom={viewDir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="absolute inset-0 overflow-y-auto"
            >
              <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

                {/* Verification limit banner */}
                {limitData && (
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
                    isVerificationLocked
                      ? "border-red-400/30 bg-red-400/10 text-red-300"
                      : limitData.remaining === 1
                      ? "border-yellow-400/30 bg-yellow-400/8 text-yellow-300"
                      : "border-[#10b981]/30 bg-[#10b981]/10 text-emerald-300"
                  }`} data-testid="verification-limit-banner">
                    {isVerificationLocked ? (
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-400" />
                    ) : (
                      <FileText className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span>
                      {isVerificationLocked
                        ? "You have used all submissions for this month."
                        : `You have ${limitData.remaining} of ${limitData.allowed} submission attempts remaining this month.`}
                    </span>
                  </div>
                )}

                {/* ── Photo Upload section ── */}
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm px-5 py-5 flex flex-col items-center gap-3">
                  <div className="relative group">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange}
                      data-testid="input-photo-file"
                    />
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

                {/* ── Form fields ── */}
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/8 flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#10b981]" />
                    <h2 className="text-sm font-bold text-white">Verification Details</h2>
                    {status === "pending" && (
                      <span className="ml-auto text-[10px] text-yellow-400 bg-yellow-400/10 border border-yellow-400/25 px-2 py-0.5 rounded-full">
                        Under Review
                      </span>
                    )}
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-white/50 mb-1.5 block">
                          Full Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={form.fullName}
                          onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                          placeholder="Full name as in certificate"
                          className="w-full px-3 py-2.5 rounded-xl bg-white/6 border border-white/12 text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]/40 focus:border-[#10b981]/40"
                          data-testid="input-full-name"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-white/50 mb-1.5 block">Roll Number</label>
                        <input
                          type="text"
                          value={form.rollNo}
                          onChange={(e) => setForm((f) => ({ ...f, rollNo: e.target.value }))}
                          placeholder="e.g. 01"
                          className="w-full px-3 py-2.5 rounded-xl bg-white/6 border border-white/12 text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]/40 focus:border-[#10b981]/40"
                          data-testid="input-roll-no"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-white/50 mb-1.5 block">Class</label>
                        <select
                          value={form.class}
                          onChange={(e) => setForm((f) => ({ ...f, class: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl bg-[#0f2015] border border-white/12 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]/40"
                          data-testid="select-class"
                        >
                          <option value="">Select class</option>
                          {CLASS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-white/50 mb-1.5 block">Section</label>
                        <select
                          value={form.section}
                          onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl bg-[#0f2015] border border-white/12 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]/40"
                          data-testid="select-section"
                        >
                          <option value="">Select section</option>
                          {SECTION_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-white/50 mb-1.5 block">
                          Father's Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={form.fatherName}
                          onChange={(e) => setForm((f) => ({ ...f, fatherName: e.target.value }))}
                          placeholder="Father's full name"
                          className="w-full px-3 py-2.5 rounded-xl bg-white/6 border border-white/12 text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]/40"
                          data-testid="input-father-name"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-white/50 mb-1.5 block">
                          Mother's Name <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={form.motherName}
                          onChange={(e) => setForm((f) => ({ ...f, motherName: e.target.value }))}
                          placeholder="Mother's full name"
                          className="w-full px-3 py-2.5 rounded-xl bg-white/6 border border-white/12 text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]/40"
                          data-testid="input-mother-name"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-white/50 mb-1.5 block">
                        Present Address <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        value={form.presentAddress}
                        onChange={(e) => setForm((f) => ({ ...f, presentAddress: e.target.value }))}
                        placeholder="Full residential address"
                        rows={3}
                        className="w-full px-3 py-2.5 rounded-xl bg-white/6 border border-white/12 text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981]/40 resize-none"
                        data-testid="input-address"
                      />
                    </div>
                  </div>
                </div>

                {/* Fixed Info (Read-only strip) */}
                <div className="rounded-xl border border-white/8 bg-white/3 px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-3.5 h-3.5 text-white/30" />
                    <span className="text-[10px] text-white/30 uppercase tracking-widest">System-assigned (read-only)</span>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <div><span className="text-white/30">DSID: </span><span className="text-white/60 font-mono">{student.digitalStudentId}</span></div>
                    <div><span className="text-white/30">School: </span><span className="text-white/60 font-mono">{student.schoolCode}</span></div>
                    <div><span className="text-white/30">Enrolled: </span><span className="text-white/60">{enrollmentDateDisplay}</span></div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => saveMutation.mutate(form)}
                    disabled={saveMutation.isPending || submitMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl border-2 border-[#10b981]/40 text-[#10b981] text-sm font-semibold hover:bg-[#10b981]/10 transition-colors disabled:opacity-50"
                    data-testid="button-save-draft"
                  >
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Save Draft
                  </button>
                  {canSubmit && !isVerificationLocked && (
                    <button
                      onClick={handleSubmit}
                      disabled={saveMutation.isPending || submitMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-[#10b981] text-white text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50 shadow-lg shadow-emerald-900/30"
                      data-testid="button-submit"
                    >
                      {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                      Submit for Verification
                    </button>
                  )}
                  {!canSubmit && (
                    <div className="flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl border border-yellow-400/30 bg-yellow-400/8 text-yellow-300 text-sm font-semibold">
                      <Clock className="w-4 h-4" />
                      Awaiting Review
                    </div>
                  )}
                  {isVerificationLocked && canSubmit && (
                    <div className="flex-1 flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl border border-red-400/25 bg-red-400/8 text-red-300 text-sm font-semibold">
                      <Lock className="w-4 h-4" />
                      Monthly limit reached
                    </div>
                  )}
                </div>
              </div>
            </motion.main>
          )}

          {/* ══ SECURITY VIEW ══ */}
          {view === "security" && (
            <motion.main
              key="security"
              custom={viewDir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="absolute inset-0 overflow-y-auto"
            >
              <div className="max-w-2xl mx-auto px-4 py-6">
                <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/8 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-400" />
                    <h2 className="text-sm font-bold text-white">Change Password</h2>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    <div>
                      <label className="text-xs font-medium text-white/50 uppercase tracking-wide mb-1.5 block">Current Password</label>
                      <div className="relative">
                        <input
                          type={showCurrentPw ? "text" : "password"}
                          value={passwordForm.currentPassword}
                          onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
                          placeholder="Enter current password"
                          className="w-full px-3 py-2.5 pr-10 rounded-xl bg-white/6 border border-white/12 text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30"
                          data-testid="input-current-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPw((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                        >
                          {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-white/50 uppercase tracking-wide mb-1.5 block">New Password</label>
                      <div className="relative">
                        <input
                          type={showNewPw ? "text" : "password"}
                          value={passwordForm.newPassword}
                          onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                          placeholder="At least 6 characters"
                          className={`w-full px-3 py-2.5 pr-10 rounded-xl bg-white/6 border text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 ${
                            passwordForm.newPassword && passwordForm.newPassword.length < 6
                              ? "border-red-400/40 focus:ring-red-400/30"
                              : "border-white/12 focus:ring-blue-400/30"
                          }`}
                          data-testid="input-new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPw((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                        >
                          {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {passwordForm.newPassword && passwordForm.newPassword.length < 6 && (
                        <p className="text-xs text-red-400 mt-1">Minimum 6 characters</p>
                      )}
                    </div>

                    <div>
                      <label className="text-xs font-medium text-white/50 uppercase tracking-wide mb-1.5 block">Confirm New Password</label>
                      <input
                        type="password"
                        value={passwordForm.confirmPassword}
                        onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                        placeholder="Repeat new password"
                        className={`w-full px-3 py-2.5 rounded-xl bg-white/6 border text-white placeholder:text-white/25 text-sm focus:outline-none focus:ring-2 ${
                          passwordForm.confirmPassword && passwordForm.confirmPassword !== passwordForm.newPassword
                            ? "border-red-400/40 focus:ring-red-400/30"
                            : passwordForm.confirmPassword && passwordForm.confirmPassword === passwordForm.newPassword
                            ? "border-[#10b981]/40 focus:ring-[#10b981]/30"
                            : "border-white/12 focus:ring-blue-400/30"
                        }`}
                        data-testid="input-confirm-password"
                      />
                      {passwordForm.confirmPassword && passwordForm.confirmPassword !== passwordForm.newPassword && (
                        <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
                      )}
                      {passwordForm.confirmPassword && passwordForm.confirmPassword === passwordForm.newPassword && passwordForm.newPassword.length >= 6 && (
                        <p className="text-xs text-[#10b981] mt-1">✓ Passwords match</p>
                      )}
                    </div>

                    <button
                      onClick={handleChangePassword}
                      disabled={passwordMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-50 shadow-lg shadow-blue-900/30 mt-2"
                      data-testid="button-change-password"
                    >
                      {passwordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                      Update Password
                    </button>
                  </div>
                </div>
              </div>
            </motion.main>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
