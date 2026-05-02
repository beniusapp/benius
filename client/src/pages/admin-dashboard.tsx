import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import {
  GraduationCap, LogOut, Users, UserCheck, Settings, BookOpen, Clock,
  Bell, BarChart2, Shield, UserSquare, CreditCard, Package,
  TrendingUp, MessageSquare, CalendarDays, ChevronLeft, Loader2,
  ArrowRight, AlertTriangle, UserCircle2, X, KeyRound, Lock, Phone, Mail,
  CheckCircle2, ChevronDown, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";

import SchoolSetup from "./admin-modules/school-setup";
import StudentRegistry from "./admin-modules/student-registry";
import FacultyMapping from "./admin-modules/faculty-mapping";
import TeacherRegistry from "./admin-modules/teacher-registry";
import NonTeachingStaff from "./admin-modules/non-teaching-staff";
import ApprovalCenter from "./admin-modules/approval-center";
import AuditLogsModule from "./admin-modules/audit-logs";
import VisitorLogModule from "./admin-modules/visitor-log";
import AttendanceOverview from "./admin-modules/attendance-overview";
import PerformanceAnalytics from "./admin-modules/performance-analytics";
import ExamController from "./admin-modules/exam-controller";
import ComplaintHub from "./admin-modules/complaint-hub";
import NoticeboardAdmin from "./admin-modules/noticeboard-admin";
import TimetableMaster from "./admin-modules/timetable-master";
import IdCardGen from "./admin-modules/id-card-gen";
import AssetsInventory from "./admin-modules/assets-inventory";
import SchoolCalendar from "./admin-modules/school-calendar";

interface MeResponse {
  id: number; email: string; role: string;
  schoolId: number; schoolName: string; schoolCode: string; studentCount: number;
}

interface AdminProfileResponse {
  id: number;
  email: string;
  recoveryEmail: string | null;
  recoveryPhone: string | null;
  isInitialized: boolean;
  hasPin: boolean;
}

interface SecurityAuditEntry {
  id: number;
  userId: number | null;
  schoolId: number | null;
  action: string;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

type ActiveModule =
  | "grid" | "school-setup" | "timetable" | "attendance" | "exam-controller"
  | "complaint-hub" | "noticeboard" | "approval-center" | "faculty-mapping"
  | "student-registry" | "analytics" | "audit-logs" | "visitor-log"
  | "id-card-gen" | "assets" | "school-calendar"
  | "teacher-registry" | "non-teaching-staff";

interface TileConfig {
  id: ActiveModule;
  label: string;
  icon: React.ElementType;
  emoji: string;
  group: string;
  desc: string;
  accentColor: string;
  badgeKey?: string;
}

const TILES: TileConfig[] = [
  { id: "school-setup",       label: "School Setup",          icon: Settings,      emoji: "⚙️",  group: "Foundation", desc: "Classes, Sections, Subjects, Exam Types",   accentColor: "#D4AF37" },
  { id: "timetable",          label: "Timetable Master",      icon: Clock,         emoji: "📅",  group: "Foundation", desc: "Map teachers to periods and classes",        accentColor: "#3b82f6" },
  { id: "school-calendar",    label: "School Calendar",       icon: CalendarDays,  emoji: "🗓️", group: "Foundation", desc: "Events, holidays and academic schedule",     accentColor: "#06b6d4" },
  { id: "attendance",         label: "Attendance Overview",   icon: CalendarDays,  emoji: "📊",  group: "Oversight",  desc: "School-wide daily presence stats",           accentColor: "#10b981" },
  { id: "exam-controller",    label: "Exam Controller",       icon: Shield,        emoji: "🏆",  group: "Oversight",  desc: "Lock scores & generate report cards",        accentColor: "#f59e0b" },
  { id: "complaint-hub",      label: "Complaint Hub",         icon: MessageSquare, emoji: "🛡️", group: "Oversight",  desc: "All teacher complaints in one place",        accentColor: "#ef4444", badgeKey: "complaints" },
  { id: "noticeboard",        label: "Noticeboard",           icon: Bell,          emoji: "🔔",  group: "Oversight",  desc: "Post notices to classes or whole school",    accentColor: "#eab308" },
  { id: "approval-center",    label: "Approval Center",       icon: UserCheck,     emoji: "✅",  group: "Management", desc: "Leaves, gallery, e-books — unified",         accentColor: "#10b981", badgeKey: "approvals" },
  { id: "teacher-registry",   label: "Teacher Registry",      icon: BookOpen,      emoji: "📖",  group: "Management", desc: "Register & manage teaching staff",           accentColor: "#3b82f6" },
  { id: "non-teaching-staff", label: "Support Staff",         icon: UserSquare,    emoji: "👷",  group: "Management", desc: "Admin, security, accounts & more",           accentColor: "#64748b" },
  { id: "faculty-mapping",    label: "Faculty Mapping",       icon: Users,         emoji: "🗂️", group: "Management", desc: "Assign teachers to classes & sections",      accentColor: "#6366f1" },
  { id: "student-registry",   label: "Student Registry",      icon: GraduationCap, emoji: "🎓",  group: "Management", desc: "5000+ students with smart pagination",       accentColor: "#8b5cf6" },
  { id: "analytics",          label: "Performance Analytics", icon: BarChart2,     emoji: "📈",  group: "Enterprise", desc: "Exam scores and class analytics",            accentColor: "#06b6d4" },
  { id: "audit-logs",         label: "Audit Logs",            icon: Shield,        emoji: "🔐",  group: "Enterprise", desc: "Immutable trail of all admin actions",       accentColor: "#D4AF37" },
  { id: "visitor-log",        label: "Visitor Log",           icon: UserSquare,    emoji: "🚪",  group: "Enterprise", desc: "Campus visitor check-in & check-out",        accentColor: "#14b8a6" },
  { id: "id-card-gen",        label: "ID Card Gen",           icon: CreditCard,    emoji: "💳",  group: "Enterprise", desc: "Generate & print student ID cards",          accentColor: "#a855f7" },
  { id: "assets",             label: "Assets & Inventory",    icon: Package,       emoji: "📦",  group: "Enterprise", desc: "Track school equipment and resources",       accentColor: "#f97316" },
];

const GROUP_ORDER = ["Foundation", "Oversight", "Management", "Enterprise"];

const GROUP_ZONE: Record<string, { color: string; sidebarClass: string }> = {
  Foundation: { color: "#6366f1", sidebarClass: "text-indigo-400" },
  Oversight:  { color: "#06b6d4", sidebarClass: "text-cyan-400" },
  Management: { color: "#10b981", sidebarClass: "text-emerald-400" },
  Enterprise: { color: "#D4AF37", sidebarClass: "text-yellow-500" },
};

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 200, damping: 22 } },
};

const changePwSchema = z.object({
  currentPassword: z.string().min(1, "Required"),
  newPassword: z.string().min(6, "Minimum 6 characters"),
  confirmPassword: z.string().min(6),
}).refine(d => d.newPassword === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

const changePinSchema = z.object({
  currentPin: z.string().length(6, "6 digits required"),
  newPin: z.string().length(6).regex(/^\d{6}$/, "6 digits required"),
  confirmPin: z.string().length(6),
}).refine(d => d.newPin === d.confirmPin, { message: "PINs do not match", path: ["confirmPin"] });

const profileSchema = z.object({
  recoveryEmail: z.string().email("Valid email").optional().or(z.literal("")),
  recoveryPhone: z.string().max(20).optional().or(z.literal("")),
});

function useCountUp(target: number, duration = 1100) {
  const [count, setCount] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    const startTime = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      setCount(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return count;
}

function CircularProgress({ value, max, color, size = 52 }: {
  value: number; max: number; color: string; size?: number;
}) {
  const sw = 3.5;
  const r = (size - sw) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circumference * (1 - pct);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={sw} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1)" }}
      />
    </svg>
  );
}

function TileCard({ tile, badge, onClick }: {
  tile: TileConfig;
  badge?: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [tiltX, setTiltX] = useState(0);
  const [tiltY, setTiltY] = useState(0);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 16;
    const y = -((e.clientY - rect.top) / rect.height - 0.5) * 16;
    setTiltX(x);
    setTiltY(y);
    setHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTiltX(0);
    setTiltY(0);
    setHovered(false);
  }, []);

  return (
    <motion.button
      variants={cardVariants}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ rotateX: tiltY, rotateY: tiltX, scale: hovered ? 1.04 : 1 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      data-testid={`tile-${tile.id}`}
      className="relative text-left focus:outline-none flex flex-col"
      style={{
        transformStyle: "preserve-3d",
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRadius: "16px",
        border: "1px solid rgba(255,255,255,0.08)",
        borderTop: `3px solid ${tile.accentColor}`,
        boxShadow: hovered
          ? `0 24px 64px ${tile.accentColor}20, 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px ${tile.accentColor}25`
          : "0 4px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)",
        padding: "20px",
        minHeight: "164px",
        cursor: "pointer",
      }}
    >
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute top-3 right-3 min-w-[20px] h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1.5"
          data-testid={`badge-${tile.id}`}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}

      <div
        className="flex items-center justify-center rounded-2xl mb-4"
        style={{
          width: "60px",
          height: "60px",
          background: `${tile.accentColor}18`,
          boxShadow: `0 0 22px ${tile.accentColor}28, 0 0 40px ${tile.accentColor}10`,
          fontSize: "30px",
          lineHeight: 1,
          flexShrink: 0,
          transition: "box-shadow 0.2s",
          ...(hovered ? { boxShadow: `0 0 28px ${tile.accentColor}50, 0 0 60px ${tile.accentColor}18` } : {}),
        }}
      >
        {tile.emoji}
      </div>

      <h3 className="font-bold text-white text-sm leading-tight mb-1.5">{tile.label}</h3>
      <p className="text-white/40 text-xs leading-relaxed flex-1">{tile.desc}</p>

      <div
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg self-start transition-all duration-200"
        style={{
          background: hovered ? `${tile.accentColor}20` : "transparent",
          color: hovered ? tile.accentColor : "rgba(255,255,255,0.30)",
          border: `1px solid ${hovered ? tile.accentColor + "40" : "transparent"}`,
        }}
      >
        Open <ArrowRight className="w-3 h-3" />
      </div>
    </motion.button>
  );
}

function PinInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Input
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={6}
      placeholder={placeholder ?? "••••••"}
      value={value}
      onChange={e => {
        const v = e.target.value.replace(/\D/g, "").slice(0, 6);
        onChange(v);
      }}
      className="tracking-widest text-center font-mono text-lg"
    />
  );
}

function AdminProfilePanel({ me, onClose }: { me: MeResponse; onClose: () => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"info" | "password" | "pin" | "log">("info");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const { data: profile } = useQuery<AdminProfileResponse>({
    queryKey: ["/api/admin/profile"],
    queryFn: async () => {
      const r = await fetch("/api/admin/profile", { credentials: "include" });
      return r.ok ? r.json() : null;
    },
  });

  const { data: secLog = [] } = useQuery<SecurityAuditEntry[]>({
    queryKey: ["/api/admin/security-log"],
    queryFn: async () => {
      const r = await fetch("/api/admin/security-log", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: tab === "log",
  });

  const pwForm = useForm<z.infer<typeof changePwSchema>>({
    resolver: zodResolver(changePwSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { recoveryEmail: profile?.recoveryEmail ?? "", recoveryPhone: profile?.recoveryPhone ?? "" },
    values: { recoveryEmail: profile?.recoveryEmail ?? "", recoveryPhone: profile?.recoveryPhone ?? "" },
  });

  const changePwMutation = useMutation({
    mutationFn: async (data: z.infer<typeof changePwSchema>) => {
      const res = await apiRequest("POST", "/api/admin/change-password", data);
      return res.json();
    },
    onSuccess: () => { toast({ title: "Password changed" }); pwForm.reset(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const changePinMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/change-pin", { currentPin, newPin, confirmPin });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "PIN changed" });
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const profileMutation = useMutation({
    mutationFn: async (data: z.infer<typeof profileSchema>) => {
      const res = await apiRequest("PATCH", "/api/admin/profile", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/profile"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const EVENT_LABELS: Record<string, string> = {
    login_success: "Login successful",
    login_failed: "Login attempt failed",
    login_unknown_email: "Unknown email login attempt",
    login_deactivated: "Deactivated account login attempt",
    pin_failed: "PIN attempt failed",
    password_changed: "Password changed",
    password_change_failed: "Password change failed",
    password_reset: "Password reset via OTP",
    pin_changed: "PIN changed",
    pin_change_failed: "PIN change failed",
    init_complete: "Account initialized",
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-sm h-full bg-white shadow-2xl flex flex-col overflow-hidden text-gray-900" onClick={e => e.stopPropagation()}>
        <div className="border-b px-5 py-4 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <UserCircle2 className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm capitalize">{me.email.split("@")[0].replace(/[._]/g, " ")}</p>
              <p className="text-xs text-gray-500">{me.email}</p>
              <p className="text-xs text-gray-400">{me.schoolName} · {me.schoolCode}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors" data-testid="button-close-profile">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex border-b bg-gray-50">
          {(["info", "password", "pin", "log"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              data-testid={`profile-tab-${t}`}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab === t ? "border-b-2 border-blue-600 text-blue-600 bg-white" : "text-gray-500 hover:text-gray-700"}`}>
              {t === "info" ? "Profile" : t === "password" ? "Password" : t === "pin" ? "PIN" : "Log"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {tab === "info" && (
            <Form {...profileForm}>
              <form onSubmit={profileForm.handleSubmit(d => profileMutation.mutate(d))} className="space-y-4">
                <div className="p-3 rounded-lg bg-gray-50 border space-y-1">
                  <p className="text-xs text-gray-500">School</p>
                  <p className="font-semibold text-gray-800 text-sm">{me.schoolName}</p>
                  <p className="text-xs text-gray-400 font-mono">{me.schoolCode}</p>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 border space-y-1">
                  <p className="text-xs text-gray-500">Admin Email</p>
                  <p className="font-semibold text-gray-800 text-sm">{me.email}</p>
                </div>
                {profile?.recoveryPhone && (
                  <div className="p-3 rounded-lg bg-gray-50 border space-y-1">
                    <p className="text-xs text-gray-500">Phone</p>
                    <p className="font-semibold text-gray-800 text-sm">{profile.recoveryPhone}</p>
                  </div>
                )}
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
                  <div className="flex items-center gap-2 text-xs text-blue-700 font-medium mb-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {profile?.isInitialized ? "Account initialized & secured" : "Account not yet initialized"}
                  </div>
                  <p className="text-xs text-blue-500">PIN protection: {profile?.hasPin ? "Enabled" : "Not set"}</p>
                </div>
                <div className="space-y-3">
                  <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Recovery Options</p>
                  <FormField control={profileForm.control} name="recoveryEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Recovery Email</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                          <Input className="pl-8 text-sm" placeholder="backup@email.com" data-testid="input-profile-recovery-email" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={profileForm.control} name="recoveryPhone" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Recovery Phone</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                          <Input className="pl-8 text-sm" placeholder="+91 98765 43210" data-testid="input-profile-recovery-phone" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <Button type="submit" className="w-full" disabled={profileMutation.isPending} data-testid="button-save-profile">
                  {profileMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Save Changes
                </Button>
              </form>
            </Form>
          )}

          {tab === "password" && (
            <Form {...pwForm}>
              <form onSubmit={pwForm.handleSubmit(d => changePwMutation.mutate(d))} className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 text-xs">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  Use a strong password with letters, numbers and symbols.
                </div>
                <FormField control={pwForm.control} name="currentPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Current Password</FormLabel>
                    <FormControl><Input type="password" placeholder="••••••••" data-testid="input-current-password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={pwForm.control} name="newPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">New Password</FormLabel>
                    <FormControl><Input type="password" placeholder="Min 6 characters" data-testid="input-new-password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={pwForm.control} name="confirmPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Confirm New Password</FormLabel>
                    <FormControl><Input type="password" placeholder="Repeat password" data-testid="input-confirm-password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={changePwMutation.isPending} data-testid="button-change-password">
                  {changePwMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Change Password
                </Button>
              </form>
            </Form>
          )}

          {tab === "pin" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 text-xs">
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                Your PIN is required every time you log in as a second security step.
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Current PIN</label>
                  <PinInput value={currentPin} onChange={setCurrentPin} placeholder="Enter current PIN" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">New PIN</label>
                  <PinInput value={newPin} onChange={setNewPin} placeholder="Enter new PIN" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Confirm New PIN</label>
                  <PinInput value={confirmPin} onChange={setConfirmPin} placeholder="Repeat new PIN" />
                </div>
              </div>
              <Button className="w-full" disabled={changePinMutation.isPending || currentPin.length < 6 || newPin.length < 6 || confirmPin.length < 6}
                onClick={() => changePinMutation.mutate()} data-testid="button-change-pin">
                {changePinMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Change PIN
              </Button>
            </div>
          )}

          {tab === "log" && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Recent Security Events</p>
              {secLog.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">No events recorded yet</div>
              ) : (
                secLog.map((ev) => (
                  <div key={ev.id} className="p-3 rounded-lg border bg-gray-50 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold ${(ev.action || "").includes("failed") || (ev.action || "").includes("unknown") || (ev.action || "").includes("deactivated") ? "text-red-600" : "text-emerald-600"}`}>
                        {EVENT_LABELS[ev.action] ?? ev.action}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(ev.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} {new Date(ev.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                      </span>
                    </div>
                    {ev.ipAddress && <p className="text-[10px] text-gray-400 font-mono">IP: {ev.ipAddress}</p>}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [matchedModule, moduleParams] = useRoute("/admin-dashboard/:module");
  const activeModule: ActiveModule = matchedModule && moduleParams?.module
    ? (moduleParams.module as ActiveModule)
    : "grid";
  const [showProfile, setShowProfile] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    Foundation: true, Oversight: true, Management: true, Enterprise: true,
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  function toggleGroup(group: string) {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  }

  function goToModule(id: ActiveModule | "grid") {
    if (id === "grid") setLocation("/admin-dashboard");
    else setLocation(`/admin-dashboard/${id}`);
  }

  const { data: me, isLoading, isError } = useQuery<MeResponse | null>({
    queryKey: ["/api/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!isLoading && (isError || !me)) setLocation("/login");
  }, [isLoading, isError, me, setLocation]);

  const { data: schoolMeta } = useQuery<{ classes: string[]; sections: string[]; subjects: string[]; exam_types: string[] }>({
    queryKey: ["/api/school-metadata", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return { classes: [], sections: [], subjects: [], exam_types: [] };
      const r = await fetch(`/api/school-metadata/${me.schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [], exam_types: [] };
    },
    enabled: !!me?.schoolId,
  });

  const { data: teachersList = [] } = useQuery<unknown[]>({
    queryKey: ["/api/schools", me?.schoolId, "teachers"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/schools/${me.schoolId}/teachers`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const today = new Date().toISOString().split("T")[0];
  const { data: dailySummary } = useQuery<{ total: number; present: number; percentage: number }>({
    queryKey: ["/api/attendance/daily-summary", me?.schoolId, today],
    queryFn: async () => {
      if (!me?.schoolId) return { total: 0, present: 0, percentage: 0 };
      const r = await fetch(`/api/attendance/daily-summary/${me.schoolId}/${today}`, { credentials: "include" });
      return r.ok ? r.json() : { total: 0, present: 0, percentage: 0 };
    },
    enabled: !!me?.schoolId,
  });

  const { data: pendingLeaves = [] } = useQuery<unknown[]>({
    queryKey: ["/api/leave/school", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/leave/school/${me.schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: galleryItems = [] } = useQuery<unknown[]>({
    queryKey: ["/api/gallery", me?.schoolId, "all"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/gallery/${me.schoolId}?all=true`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: pendingEbooks = [] } = useQuery<unknown[]>({
    queryKey: ["/api/library/books", me?.schoolId, "pending"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/library/books/${me.schoolId}/pending`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: complaints = [] } = useQuery<unknown[]>({
    queryKey: ["/api/complaints/school", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch(`/api/complaints/school/${me.schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const pendingLeavesCount   = (pendingLeaves  as { status: string }[]).filter(l => l.status === "pending").length;
  const pendingGalleryCount  = (galleryItems   as { approved: boolean }[]).filter(g => !g.approved).length;
  const openComplaintsCount  = (complaints     as { status: string }[]).filter(c => c.status === "open" || c.status === "in_progress").length;
  const totalActionRequired  = pendingLeavesCount + pendingGalleryCount + pendingEbooks.length;

  const BADGES: Record<string, number> = {
    approvals:  totalActionRequired,
    complaints: openComplaintsCount,
  };

  const studentCountAnimated   = useCountUp(me?.studentCount ?? 0);
  const facultyCountAnimated   = useCountUp(teachersList.length);
  const attendancePctAnimated  = useCountUp(dailySummary?.percentage ?? 0);
  const actionCountAnimated    = useCountUp(totalActionRequired);

  const logoutMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/logout"); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/me"] }); setLocation("/login"); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0f172a" }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-9 h-9 animate-spin" style={{ color: "#6366f1" }} />
          <p className="text-sm text-white/40 font-medium">Loading Command Center…</p>
        </div>
      </div>
    );
  }

  const meta = {
    classes:    schoolMeta?.classes    ?? [],
    sections:   schoolMeta?.sections   ?? [],
    subjects:   schoolMeta?.subjects   ?? [],
    exam_types: schoolMeta?.exam_types ?? [],
  };

  const renderModule = () => {
    switch (activeModule) {
      case "school-setup":      return <SchoolSetup schoolId={me.schoolId} />;
      case "student-registry":  return <StudentRegistry schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} />;
      case "faculty-mapping":   return <FacultyMapping schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} />;
      case "teacher-registry":  return <TeacherRegistry schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} onNavigate={(mod) => goToModule(mod as ActiveModule)} />;
      case "non-teaching-staff":return <NonTeachingStaff schoolId={me.schoolId} />;
      case "approval-center":   return <ApprovalCenter schoolId={me.schoolId} />;
      case "audit-logs":        return <AuditLogsModule schoolId={me.schoolId} />;
      case "visitor-log":       return <VisitorLogModule schoolId={me.schoolId} />;
      case "attendance":        return <AttendanceOverview schoolId={me.schoolId} onViewStudent={() => goToModule("student-registry")} />;
      case "analytics":         return <PerformanceAnalytics schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} examTypes={meta.exam_types} />;
      case "exam-controller":   return <ExamController schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} examTypes={meta.exam_types} />;
      case "complaint-hub":     return <ComplaintHub schoolId={me.schoolId} />;
      case "noticeboard":       return <NoticeboardAdmin schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} adminUserId={me.id} />;
      case "timetable":         return <TimetableMaster schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} />;
      case "id-card-gen":       return <IdCardGen schoolId={me.schoolId} schoolName={me.schoolName} classes={meta.classes} sections={meta.sections} />;
      case "assets":            return <AssetsInventory schoolId={me.schoolId} />;
      case "school-calendar":   return <SchoolCalendar />;
      default: return null;
    }
  };

  const attendancePresent = dailySummary?.present ?? 0;
  const attendanceTotal   = dailySummary?.total   ?? 0;

  return (
    <div className="min-h-screen text-white flex flex-col" style={{ background: "#0f172a" }}>

      {/* ── Decorative background radial blobs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden>
        <div style={{ position: "absolute", top: "-160px", right: "-100px",  width: "600px", height: "600px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-140px", left: "-80px", width: "560px", height: "560px", borderRadius: "50%", background: "radial-gradient(circle, rgba(6,182,212,0.07) 0%, transparent 65%)"  }} />
        <div style={{ position: "absolute", top: "40%", left: "35%",         width: "420px", height: "420px", borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.05) 0%, transparent 65%)" }} />
      </div>

      {/* ══════════ STICKY GLASS NAVBAR ══════════ */}
      <header
        className="sticky top-0 z-50 border-b"
        style={{
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          background: "rgba(15,23,42,0.85)",
          borderColor: "rgba(99,102,241,0.18)",
          boxShadow: "0 1px 0 rgba(99,102,241,0.10)",
        }}
        data-testid="admin-navbar"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {activeModule !== "grid" && (
              <button
                onClick={() => goToModule("grid")}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors mr-1"
                data-testid="button-back-to-grid"
              >
                <ChevronLeft className="w-5 h-5 text-white/60" />
              </button>
            )}
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)", boxShadow: "0 4px 16px rgba(99,102,241,0.35)" }}
            >
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-extrabold text-white tracking-tight" data-testid="text-dashboard-title">BENIUS</h1>
              <p className="text-[10px] text-white/35 leading-none font-medium" data-testid="text-school-name">{me.schoolName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-sm text-white/35 font-medium" data-testid="text-user-email">{me.email}</span>
            <Button
              variant="ghost" size="sm"
              onClick={() => setShowProfile(true)}
              className="text-white/50 hover:text-white hover:bg-white/10"
              data-testid="button-open-profile"
            >
              <UserCircle2 className="w-4 h-4 mr-1" /> Profile
            </Button>
            <Button
              variant="ghost" size="sm"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="text-white/50 hover:text-white hover:bg-white/10"
              data-testid="button-logout"
            >
              {logoutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <LogOut className="w-4 h-4 mr-1" />}
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* ══════════ PREMIUM STATS BAR ══════════ */}
      <div
        className="relative z-10 border-b"
        style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.018)" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

            {/* Total Students */}
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ background: "rgba(212,175,55,0.07)", border: "1px solid rgba(212,175,55,0.15)" }}
              data-testid="stat-students"
            >
              <CircularProgress value={studentCountAnimated} max={Math.max(me.studentCount, 1)} color="#D4AF37" />
              <div className="min-w-0">
                <p className="text-[10px] text-white/40 leading-none mb-1 font-medium">Total Students</p>
                <p className="text-xl font-extrabold text-white tracking-tight">{studentCountAnimated.toLocaleString()}</p>
              </div>
            </div>

            {/* Faculty Strength */}
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.15)" }}
              data-testid="stat-teachers"
            >
              <CircularProgress value={facultyCountAnimated} max={Math.max(teachersList.length, 1)} color="#3b82f6" />
              <div className="min-w-0">
                <p className="text-[10px] text-white/40 leading-none mb-1 font-medium">Faculty Strength</p>
                <p className="text-xl font-extrabold text-white tracking-tight">{facultyCountAnimated}</p>
              </div>
            </div>

            {/* Daily Presence */}
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.15)" }}
              data-testid="stat-attendance"
            >
              <CircularProgress value={attendancePctAnimated} max={100} color="#10b981" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-[10px] text-white/40 leading-none font-medium">Daily Presence</p>
                  {dailySummary?.total ? (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                    </span>
                  ) : null}
                </div>
                <p className="text-xl font-extrabold text-white tracking-tight">
                  {attendanceTotal ? `${attendancePctAnimated}%` : "—"}
                </p>
                {attendanceTotal > 0 && (
                  <p className="text-[10px] text-white/30 mt-0.5">{attendancePresent}/{attendanceTotal} present</p>
                )}
              </div>
            </div>

            {/* Action Required */}
            <div
              className="flex items-center gap-3 rounded-xl px-4 py-3 cursor-pointer transition-all hover:bg-red-500/12"
              style={{
                background: totalActionRequired > 0 ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${totalActionRequired > 0 ? "rgba(239,68,68,0.20)" : "rgba(255,255,255,0.06)"}`,
              }}
              onClick={() => goToModule("approval-center")}
              data-testid="stat-action-required"
            >
              <CircularProgress value={Math.min(actionCountAnimated, 10)} max={10} color={totalActionRequired > 0 ? "#ef4444" : "#4b5563"} />
              <div className="min-w-0">
                <p className="text-[10px] text-white/40 leading-none mb-1 font-medium">Action Required</p>
                <p className={`text-xl font-extrabold tracking-tight ${totalActionRequired > 0 ? "text-red-400" : "text-white"}`}>
                  {actionCountAnimated}
                </p>
              </div>
            </div>

          </div>

          {/* Date pill */}
          <div className="mt-3 flex justify-end">
            <span className="text-[11px] text-white/25 font-medium">
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </span>
          </div>
        </div>
      </div>

      {/* ══════════ CONTENT ROW: sidebar + main ══════════ */}
      <div className="relative z-10 flex flex-1 min-h-0">

        {/* ── Translucent Floating Sidebar ── */}
        <aside
          className={`flex flex-col flex-shrink-0 border-r transition-all duration-300 ease-in-out overflow-hidden ${sidebarOpen ? "w-60" : "w-0"}`}
          style={{
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            background: "rgba(255,255,255,0.03)",
            borderColor: "rgba(255,255,255,0.06)",
          }}
          data-testid="admin-sidebar"
        >
          <div className="w-60 flex flex-col h-full overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Navigation</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1 rounded-md text-white/25 hover:text-white hover:bg-white/8 transition-colors"
                data-testid="button-collapse-sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 py-2 space-y-0" data-testid="sidebar-nav">
              {GROUP_ORDER.map(group => {
                const isOpen = expandedGroups[group];
                const groupTiles = TILES.filter(t => t.group === group);
                const zone = GROUP_ZONE[group];
                return (
                  <div key={group}>
                    <button
                      onClick={() => toggleGroup(group)}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors group"
                      data-testid={`sidebar-group-${group.toLowerCase()}`}
                    >
                      <span className={`text-[10px] font-extrabold uppercase tracking-widest ${zone.sidebarClass}`}>
                        {group}
                      </span>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-white/25 group-hover:text-white/50 transition-all duration-200 ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    <div
                      className="overflow-hidden transition-all duration-250 ease-in-out"
                      style={{ maxHeight: isOpen ? `${groupTiles.length * 44}px` : "0px" }}
                    >
                      {groupTiles.map(tile => {
                        const isActive = activeModule === tile.id;
                        const badge = tile.badgeKey ? BADGES[tile.badgeKey] : undefined;
                        return (
                          <button
                            key={tile.id}
                            onClick={() => goToModule(tile.id)}
                            data-testid={`sidebar-item-${tile.id}`}
                            className="w-full flex items-center gap-3 px-5 py-2.5 text-sm text-left transition-all duration-150 relative"
                            style={isActive ? {
                              background: `${tile.accentColor}12`,
                              borderRight: `2px solid ${tile.accentColor}`,
                              color: tile.accentColor,
                            } : { color: "rgba(255,255,255,0.45)" }}
                          >
                            <tile.icon
                              className="w-4 h-4 flex-shrink-0"
                              style={{ color: isActive ? tile.accentColor : "rgba(255,255,255,0.30)" }}
                            />
                            <span className="truncate text-xs font-medium">{tile.label}</span>
                            {badge !== undefined && badge > 0 && (
                              <span className="ml-auto flex-shrink-0 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                                {badge > 9 ? "9+" : badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">

            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex items-center gap-2 mb-5 text-xs text-white/35 hover:text-white transition-colors"
                data-testid="button-expand-sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" /> Show navigation
              </button>
            )}

            {activeModule === "grid" ? (
              <div className="space-y-10">
                {GROUP_ORDER.map(group => {
                  const groupTiles = TILES.filter(t => t.group === group);
                  const zone = GROUP_ZONE[group];
                  return (
                    <motion.section
                      key={group}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.4 }}
                    >
                      {/* Zone header */}
                      <div className="flex items-center gap-4 mb-5">
                        <h2
                          className="text-xs font-extrabold uppercase tracking-[0.18em] whitespace-nowrap"
                          style={{ color: zone.color, textShadow: `0 0 20px ${zone.color}55` }}
                        >
                          {group}
                        </h2>
                        <div
                          className="flex-1 h-px"
                          style={{ background: `linear-gradient(to right, ${zone.color}50, transparent)` }}
                        />
                      </div>

                      {/* Cards grid with staggered entrance */}
                      <motion.div
                        variants={containerVariants}
                        initial="hidden"
                        animate="show"
                        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                      >
                        {groupTiles.map(tile => (
                          <TileCard
                            key={tile.id}
                            tile={tile}
                            badge={tile.badgeKey ? BADGES[tile.badgeKey] : undefined}
                            onClick={() => goToModule(tile.id)}
                          />
                        ))}
                      </motion.div>
                    </motion.section>
                  );
                })}
              </div>
            ) : (
              <div>
                <div className="mb-6 flex items-center gap-2">
                  <button
                    onClick={() => goToModule("grid")}
                    className="text-white/40 hover:text-white text-sm flex items-center gap-1 transition-colors"
                    data-testid="breadcrumb-back"
                  >
                    <ChevronLeft className="w-4 h-4" /> Dashboard
                  </button>
                  <span className="text-white/15">/</span>
                  <span className="text-white/65 text-sm">{TILES.find(t => t.id === activeModule)?.label ?? activeModule}</span>
                </div>
                {renderModule()}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ══════════ FOOTER ══════════ */}
      <footer
        className="relative z-10 border-t py-4 text-center"
        style={{ borderColor: "rgba(255,255,255,0.04)" }}
      >
        <p className="text-white/15 text-xs">
          BENIUS Command Center · {me.schoolName} ·{" "}
          <span className="font-mono" style={{ color: "#D4AF37", opacity: 0.5 }}>{me.schoolCode}</span>
        </p>
      </footer>

      {showProfile && <AdminProfilePanel me={me} onClose={() => setShowProfile(false)} />}
    </div>
  );
}
