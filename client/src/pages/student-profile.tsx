import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, Camera, CheckCircle, Clock, XCircle, AlertCircle, Loader2,
  User, Users, Home, Lock, Eye, EyeOff, GraduationCap, RefreshCw,
} from "lucide-react";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

const STATUS_CONFIG = {
  draft: {
    icon: AlertCircle,
    label: "Draft — Not Submitted",
    banner: "bg-gray-50 border-gray-200 text-gray-700",
    iconColor: "text-gray-500",
  },
  pending: {
    icon: Clock,
    label: "Pending Teacher Verification",
    banner: "bg-yellow-50 border-yellow-200 text-yellow-800",
    iconColor: "text-yellow-500",
  },
  approved: {
    icon: CheckCircle,
    label: "Profile Approved",
    banner: "bg-emerald-50 border-emerald-200 text-emerald-800",
    iconColor: "text-emerald-500",
  },
  rejected: {
    icon: XCircle,
    label: "Profile Rejected — Please Edit & Re-Submit",
    banner: "bg-red-50 border-red-200 text-red-800",
    iconColor: "text-red-500",
  },
};

const CLASS_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const SECTION_OPTIONS = ["A", "B", "C", "D", "E", "F"];

export default function StudentProfile() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [activeSection, setActiveSection] = useState<"profile" | "security">("profile");

  const { data: student, isLoading: studentLoading } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: profileData, isLoading: profileLoading } = useQuery<StudentProfileResponse | null>({
    queryKey: ["/api/student/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
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
      toast({ title: "Draft saved", description: "Your profile has been saved as a draft." });
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
      toast({ title: "Submitted!", description: "Your profile has been sent to your teacher for verification." });
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
      toast({ title: "Photo uploaded", description: "Your photo has been submitted for approval." });
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
      toast({ title: "Password changed", description: "Your password has been updated successfully." });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  if (studentLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  if (!student) {
    setLocation("/student-login");
    return null;
  }

  const status = profile?.status || "draft";
  const statusCfg = STATUS_CONFIG[status];
  const StatusIcon = statusCfg.icon;
  const canSubmit = status !== "pending";

  const dob = student.dob
    ? new Date(student.dob).toLocaleDateString("en-GB")
    : "—";

  const enrollmentDateDisplay = student.enrollmentDate
    ? new Date(student.enrollmentDate).toLocaleDateString("en-GB")
    : "—";

  const photoToShow = profile?.photoUrl || student.photoUrl;

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
  }

  function handleSaveDraft() {
    saveMutation.mutate(form);
  }

  function handleSubmit() {
    if (!form.fullName || !form.fatherName || !form.motherName || !form.presentAddress) {
      toast({
        title: "Missing fields",
        description: "Please fill in Full Name, Father's Name, Mother's Name, and Present Address before submitting.",
        variant: "destructive",
      });
      return;
    }
    submitMutation.mutate();
  }

  function handleChangePassword() {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({ title: "Password mismatch", description: "New password and confirm password do not match.", variant: "destructive" });
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      toast({ title: "Too short", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    passwordMutation.mutate();
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f0fdf4]">
      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-30 bg-[#10b981] shadow-md">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-white" />
            <div className="leading-tight">
              <p className="text-white font-bold text-base">My Profile</p>
              <p className="text-emerald-100 text-xs">{student.schoolName}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 space-y-5">

        {/* ── Status Banner ── */}
        <div className={`flex items-start gap-3 p-4 rounded-xl border ${statusCfg.banner}`} data-testid="status-banner">
          <StatusIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${statusCfg.iconColor}`} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" data-testid="status-label">{statusCfg.label}</p>
            {status === "rejected" && profile?.rejectionNote && (
              <p className="text-xs mt-1 text-red-600" data-testid="rejection-note">
                Reason: {profile.rejectionNote}
              </p>
            )}
            {status === "pending" && profile?.submittedAt && (
              <p className="text-xs mt-1 opacity-75">
                Submitted on {new Date(profile.submittedAt).toLocaleDateString("en-GB")}
              </p>
            )}
            {status === "approved" && profile?.verifiedAt && (
              <p className="text-xs mt-1 opacity-75">
                Verified on {new Date(profile.verifiedAt).toLocaleDateString("en-GB")}
              </p>
            )}
          </div>
        </div>

        {/* ── Sub-nav tabs ── */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveSection("profile")}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              activeSection === "profile"
                ? "bg-[#10b981] text-white shadow"
                : "bg-white text-gray-600 border border-emerald-100 hover:bg-emerald-50"
            }`}
            data-testid="tab-profile"
          >
            Profile Details
          </button>
          <button
            onClick={() => setActiveSection("security")}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              activeSection === "security"
                ? "bg-[#10b981] text-white shadow"
                : "bg-white text-gray-600 border border-emerald-100 hover:bg-emerald-50"
            }`}
            data-testid="tab-security"
          >
            Security
          </button>
        </div>

        {activeSection === "profile" && (
          <>
            {/* ── Photo Upload ── */}
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-6 flex flex-col items-center gap-4">
              <div className="relative">
                {photoToShow ? (
                  <img
                    src={photoToShow}
                    alt="Profile photo"
                    className="w-24 h-24 rounded-full object-cover border-4 border-[#10b981] shadow"
                    data-testid="img-profile-photo"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-[#10b981] flex items-center justify-center shadow border-4 border-white">
                    <span className="text-white font-bold text-2xl select-none">{initials}</span>
                  </div>
                )}
                {profile?.photoStatus === "pending" && (
                  <span className="absolute -bottom-1 -right-1 bg-yellow-400 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow">
                    PENDING
                  </span>
                )}
                {profile?.photoStatus === "approved" && (
                  <span className="absolute -bottom-1 -right-1 bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow">
                    APPROVED
                  </span>
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-800">{student.name}</p>
                <p className="text-xs text-gray-500">DSID: {student.digitalStudentId}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
                data-testid="input-photo-file"
              />
              {profile?.photoStatus !== "approved" && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={photoMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[#10b981] text-sm font-medium hover:bg-emerald-100 transition-colors disabled:opacity-60"
                  data-testid="button-upload-photo"
                >
                  {photoMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  {profile?.photoStatus === "pending" ? "Replace Photo" : "Upload Photo"}
                </button>
              )}
              {profile?.photoStatus === "pending" && (
                <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-3 py-1.5 rounded-lg text-center">
                  Photo submitted — awaiting teacher approval
                </p>
              )}
            </div>

            {/* ── Read-Only Fields (from DSID registration) ── */}
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-emerald-50 flex items-center gap-2">
                <User className="w-4 h-4 text-[#10b981]" />
                <h2 className="text-sm font-bold text-gray-800">Basic Information</h2>
                <span className="ml-auto text-xs text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">Read-only</span>
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Name (as registered)</label>
                  <p className="mt-1 text-sm font-semibold text-gray-900" data-testid="field-reg-name">{student.name}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">DSID</label>
                  <p className="mt-1 text-sm font-semibold text-gray-900 font-mono" data-testid="field-dsid">{student.digitalStudentId}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Class</label>
                  <p className="mt-1 text-sm font-semibold text-gray-900" data-testid="field-class">Class {student.class} – {student.section}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Date of Birth</label>
                  <p className="mt-1 text-sm font-semibold text-gray-900" data-testid="field-dob">{dob}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Phone</label>
                  <p className="mt-1 text-sm font-semibold text-gray-900" data-testid="field-phone">{student.phone}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Enrollment Date</label>
                  <p className="mt-1 text-sm font-semibold text-gray-900" data-testid="field-enrollment-date">{enrollmentDateDisplay}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">School</label>
                  <p className="mt-1 text-sm font-semibold text-gray-900" data-testid="field-school">{student.schoolName}</p>
                </div>
              </div>
            </div>

            {/* ── Approved re-edit notice ── */}
            {status === "approved" && (
              <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 text-xs">
                <RefreshCw className="w-4 h-4 flex-shrink-0" />
                <span>Your profile is approved. You may still edit the fields below — doing so will reset it to draft and require re-verification.</span>
              </div>
            )}

            {/* ── Last Approved Data snapshot ── */}
            {approvedSnapshot && status !== "approved" && (
              <div className="bg-emerald-50 rounded-2xl border border-emerald-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-emerald-100 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-sm font-bold text-emerald-800">Last Verified Data</h2>
                  {approvedSnapshot.approvedAt && (
                    <span className="ml-auto text-xs text-emerald-600">
                      Verified {new Date(approvedSnapshot.approvedAt).toLocaleDateString("en-GB")}
                    </span>
                  )}
                </div>
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {approvedSnapshot.fullName && (
                    <div>
                      <span className="text-emerald-600 font-medium">Full Name:</span>
                      <span className="ml-1 text-emerald-900 font-semibold">{approvedSnapshot.fullName}</span>
                    </div>
                  )}
                  {(approvedSnapshot.class || approvedSnapshot.section) && (
                    <div>
                      <span className="text-emerald-600 font-medium">Class/Section:</span>
                      <span className="ml-1 text-emerald-900 font-semibold">{approvedSnapshot.class} – {approvedSnapshot.section}</span>
                    </div>
                  )}
                  {approvedSnapshot.rollNo && (
                    <div>
                      <span className="text-emerald-600 font-medium">Roll No:</span>
                      <span className="ml-1 text-emerald-900 font-semibold">{approvedSnapshot.rollNo}</span>
                    </div>
                  )}
                  {approvedSnapshot.fatherName && (
                    <div>
                      <span className="text-emerald-600 font-medium">Father's Name:</span>
                      <span className="ml-1 text-emerald-900 font-semibold">{approvedSnapshot.fatherName}</span>
                    </div>
                  )}
                  {approvedSnapshot.motherName && (
                    <div>
                      <span className="text-emerald-600 font-medium">Mother's Name:</span>
                      <span className="ml-1 text-emerald-900 font-semibold">{approvedSnapshot.motherName}</span>
                    </div>
                  )}
                  {approvedSnapshot.presentAddress && (
                    <div className="sm:col-span-2">
                      <span className="text-emerald-600 font-medium">Address:</span>
                      <span className="ml-1 text-emerald-900">{approvedSnapshot.presentAddress}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Editable Verification Fields ── */}
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-emerald-50 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#10b981]" />
                <h2 className="text-sm font-bold text-gray-800">Verification Details</h2>
                {status === "pending" && (
                  <span className="ml-auto text-xs text-yellow-600 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded-full">
                    Under Review
                  </span>
                )}
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.fullName}
                      onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                      placeholder="Full name as in certificate"
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                      data-testid="input-full-name"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Roll Number</label>
                    <input
                      type="text"
                      value={form.rollNo}
                      onChange={(e) => setForm((f) => ({ ...f, rollNo: e.target.value }))}
                      placeholder="e.g. 01"
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                      data-testid="input-roll-no"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Class</label>
                    <select
                      value={form.class}
                      onChange={(e) => setForm((f) => ({ ...f, class: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white"
                      data-testid="select-class"
                    >
                      <option value="">Select class</option>
                      {CLASS_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Section</label>
                    <select
                      value={form.section}
                      onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white"
                      data-testid="select-section"
                    >
                      <option value="">Select section</option>
                      {SECTION_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">
                      Father's Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.fatherName}
                      onChange={(e) => setForm((f) => ({ ...f, fatherName: e.target.value }))}
                      placeholder="Father's full name"
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                      data-testid="input-father-name"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">
                      Mother's Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.motherName}
                      onChange={(e) => setForm((f) => ({ ...f, motherName: e.target.value }))}
                      placeholder="Mother's full name"
                      className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                      data-testid="input-mother-name"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    Present Address <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={form.presentAddress}
                    onChange={(e) => setForm((f) => ({ ...f, presentAddress: e.target.value }))}
                    placeholder="Full residential address"
                    rows={3}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                    data-testid="input-address"
                  />
                </div>
              </div>
            </div>

            {/* ── Action Buttons ── */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleSaveDraft}
                disabled={saveMutation.isPending || submitMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-[#10b981] text-[#10b981] text-sm font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-60"
                data-testid="button-save-draft"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save Changes
              </button>
              {canSubmit && (
                <button
                  onClick={handleSubmit}
                  disabled={saveMutation.isPending || submitMutation.isPending}
                  className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-[#10b981] text-white text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-60 shadow-md"
                  data-testid="button-submit"
                >
                  {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Submit for Verification
                </button>
              )}
              {!canSubmit && (
                <div className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm font-semibold">
                  <Clock className="w-4 h-4" />
                  Awaiting Teacher Review
                </div>
              )}
            </div>
          </>
        )}

        {activeSection === "security" && (
          <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-emerald-50 flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#10b981]" />
              <h2 className="text-sm font-bold text-gray-800">Change Password</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Current Password</label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? "text" : "password"}
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
                    placeholder="Enter current password"
                    className="w-full px-3 py-2.5 pr-10 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">New Password</label>
                <div className="relative">
                  <input
                    type={showNewPw ? "text" : "password"}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                    placeholder="At least 6 characters"
                    className="w-full px-3 py-2.5 pr-10 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Confirm New Password</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                  placeholder="Repeat new password"
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  data-testid="input-confirm-password"
                />
              </div>
              <button
                onClick={handleChangePassword}
                disabled={passwordMutation.isPending}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#10b981] text-white text-sm font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-60 shadow-md"
                data-testid="button-change-password"
              >
                {passwordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Update Password
              </button>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <p className="text-center text-xs text-gray-400 pb-4">
          © {new Date().getFullYear()} BENIUS · {student.schoolName}
        </p>
      </main>
    </div>
  );
}
