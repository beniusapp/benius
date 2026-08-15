import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import Cropper from "react-easy-crop";
import type { Point, Area } from "react-easy-crop";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, useMotionValue, useTransform } from "framer-motion";
import {
  GraduationCap, LogOut, Users, UserCheck, Settings, BookOpen, Clock,
  Bell, BarChart2, Shield, UserSquare, CreditCard, Package,
  TrendingUp, MessageSquare, CalendarDays, ChevronLeft, Loader2,
  ArrowRight, AlertTriangle, UserCircle2, X, KeyRound, Lock, Phone, Mail,
  CheckCircle2, ChevronDown, PanelLeftClose, PanelLeftOpen, Menu,
  CalendarRange, Check, Building2, Upload, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getQueryFn, setViewSessionId, sessionFetch } from "@/lib/queryClient";
import { SessionViewContext, type AcademicSession } from "@/contexts/session-view-context";

const SchoolSetup         = lazy(() => import("./admin-modules/school-setup"));
const StudentRegistry     = lazy(() => import("./admin-modules/student-registry"));
const FacultyMapping      = lazy(() => import("./admin-modules/faculty-mapping"));
const TeacherRegistry     = lazy(() => import("./admin-modules/teacher-registry"));
const NonTeachingStaff    = lazy(() => import("./admin-modules/non-teaching-staff"));
const ApprovalCenter      = lazy(() => import("./admin-modules/approval-center"));
const LeaveRequests       = lazy(() => import("./admin-modules/leave-requests"));
const AuditLogsModule     = lazy(() => import("./admin-modules/audit-logs"));
const VisitorLogModule    = lazy(() => import("./admin-modules/visitor-log"));
const AttendanceOverview  = lazy(() => import("./admin-modules/attendance-overview"));
const PerformanceAnalytics= lazy(() => import("./admin-modules/performance-analytics"));
const ExamController      = lazy(() => import("./admin-modules/exam-controller"));
const ComplaintHub        = lazy(() => import("./admin-modules/complaint-hub"));
const NoticeboardAdmin    = lazy(() => import("./admin-modules/noticeboard-admin"));
const TimetableMaster     = lazy(() => import("./admin-modules/timetable-master"));
const IdCardGen           = lazy(() => import("./admin-modules/id-card-gen"));
const AssetsInventory     = lazy(() => import("./admin-modules/assets-inventory"));
const SchoolCalendar      = lazy(() => import("./admin-modules/school-calendar"));
const FeesManager              = lazy(() => import("./admin-modules/fees-manager"));
const RemovedTeacherHistory    = lazy(() => import("./admin-modules/removed-teacher-history"));

interface MeResponse {
  id: number; email: string; role: string;
  schoolId: number; schoolName: string; schoolCode: string; studentCount: number;
  allowedModules?: string[];
  displayName?: string;
  designation?: string;
}

interface AdminProfileResponse {
  id: number;
  email: string;
  recoveryEmail: string | null;
  recoveryPhone: string | null;
  isInitialized: boolean;
  hasPin: boolean;
  logoUrl: string | null;
  // Contact & Location
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pinCode: string | null;
  country: string | null;
  schoolPhone: string | null;
  schoolEmail: string | null;
  schoolWebsite: string | null;
  // Academic Identity
  schoolBoard: string | null;
  schoolType: string | null;
  affiliationNumber: string | null;
  udiseCode: string | null;
  establishedYear: number | null;
  // Legal & Tax
  registrationNumber: string | null;
  pan: string | null;
  gstin: string | null;
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
  | "teacher-registry" | "non-teaching-staff" | "fees-manager"
  | "leave-requests" | "removed-teacher-history";

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
  { id: "approval-center",    label: "Approval Center",       icon: UserCheck,     emoji: "✅",  group: "Management", desc: "Gallery & e-book media approvals",            accentColor: "#a855f7", badgeKey: "approvals" },
  { id: "leave-requests",     label: "Leave Requests",        icon: CalendarDays,  emoji: "📋",  group: "Management", desc: "Teacher leave balances and student leave requests", accentColor: "#22d3ee", badgeKey: "leave-requests" },
  { id: "teacher-registry",   label: "Teacher Registry",      icon: BookOpen,      emoji: "📖",  group: "Management", desc: "Register & manage teaching staff",           accentColor: "#3b82f6" },
  { id: "non-teaching-staff", label: "Support Staff",         icon: UserSquare,    emoji: "👷",  group: "Management", desc: "Admin, security, accounts & more",           accentColor: "#64748b" },
  { id: "faculty-mapping",    label: "Faculty Mapping",       icon: Users,         emoji: "🗂️", group: "Management", desc: "Assign teachers to classes & sections",      accentColor: "#6366f1" },
  { id: "student-registry",   label: "Student Registry",      icon: GraduationCap, emoji: "🎓",  group: "Management", desc: "5000+ students with smart pagination",       accentColor: "#8b5cf6" },
  { id: "fees-manager",       label: "Fees & Payments",       icon: CreditCard,    emoji: "💰",  group: "Management", desc: "Student fee records, dues and receipts",      accentColor: "#10b981" },
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
  recoveryPhone: z.string().length(10, "Phone must be exactly 10 digits").regex(/^\d{10}$/, "Only digits allowed").optional().or(z.literal("")),
});

const CUR_YEAR = new Date().getFullYear();

const schoolInfoSchema = z.object({
  // Contact & Location
  addressLine1:       z.string().min(1, "Address Line 1 is required").max(200),
  addressLine2:       z.string().max(200).optional().or(z.literal("")),
  city:               z.string().min(1, "City is required").max(100),
  state:              z.string().min(1, "State is required").max(100),
  pinCode:            z.string().min(1, "PIN code is required")
                        .regex(/^[1-9][0-9]{5}$/, "Enter a valid 6-digit PIN code"),
  country:            z.string().max(60).optional().or(z.literal("")),
  schoolPhone:        z.string().min(1, "School phone is required")
                        .regex(/^[\d\s+\-()/]{7,20}$/, "Enter a valid phone number"),
  schoolEmail:        z.string().min(1, "School email is required")
                        .email("Enter a valid email address"),
  schoolWebsite:      z.string().url("Enter a valid URL starting with https://").optional().or(z.literal("")),
  // Academic Identity
  schoolBoard:        z.string().max(100).optional().or(z.literal("")),
  schoolType:         z.string().max(60).optional().or(z.literal("")),
  affiliationNumber:  z.string().max(50).optional().or(z.literal("")),
  udiseCode:          z.string().regex(/^(\d{11})?$/, "UDISE code must be exactly 11 digits").optional().or(z.literal("")),
  establishedYear:    z.string()
                        .refine(v => !v || (/^\d{4}$/.test(v) && +v >= 1800 && +v <= CUR_YEAR),
                          { message: `Enter a valid year between 1800 and ${CUR_YEAR}` })
                        .optional().or(z.literal("")),
  // Legal & Tax
  registrationNumber: z.string().max(100).optional().or(z.literal("")),
  pan:                z.string().regex(/^([A-Z]{5}[0-9]{4}[A-Z]{1})?$/, "Invalid PAN (e.g. AABCP1234C)").optional().or(z.literal("")),
  gstin:              z.string().regex(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})?$/, "Invalid GSTIN format").optional().or(z.literal("")),
});

function useCountUp(target: number, duration = 1100) {
  const [count, setCount] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
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

function StatRing({ value, max, color, size = 52, icon }: {
  value: number; max: number; color: string; size?: number; icon?: React.ReactNode;
}) {
  const sw = 3.5;
  const r = (size - sw) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const offset = circumference * (1 - pct);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={sw} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      {icon && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          {icon}
        </div>
      )}
    </div>
  );
}

function TileCard({ tile, badge, onClick }: {
  tile: TileConfig;
  badge?: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useTransform(mouseY, [-0.5, 0.5], [8, -8]);
  const rotateY = useTransform(mouseX, [-0.5, 0.5], [-8, 8]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  }, [mouseX, mouseY]);

  const handleMouseLeave = useCallback(() => {
    mouseX.set(0);
    mouseY.set(0);
    setHovered(false);
  }, [mouseX, mouseY]);

  return (
    <motion.button
      variants={cardVariants}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleMouseLeave}
      whileHover={{ scale: 1.04 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      data-testid={`tile-${tile.id}`}
      className="relative text-left focus:outline-none flex flex-col"
      style={{
        rotateX,
        rotateY,
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
        padding: "clamp(12px, 3vw, 20px)",
        minHeight: "140px",
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
          boxShadow: hovered
            ? `0 0 28px ${tile.accentColor}50, 0 0 60px ${tile.accentColor}18`
            : `0 0 22px ${tile.accentColor}28, 0 0 40px ${tile.accentColor}10`,
          fontSize: "30px",
          lineHeight: 1,
          flexShrink: 0,
          transition: "box-shadow 0.25s ease",
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

// ── Canvas helper: cut the cropped pixels out of the source image ─────────────
async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });
  const canvas = document.createElement("canvas");
  canvas.width  = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas toBlob failed")), "image/jpeg", 0.92);
  });
}

// ── School logo crop modal ────────────────────────────────────────────────────
function SchoolLogoCropper({
  src, onCancel, onSave,
}: { src: string; onCancel: () => void; onSave: (blob: Blob) => void }) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const onCropComplete = useCallback((_: Area, pxArea: Area) => {
    setCroppedAreaPixels(pxArea);
  }, []);

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    setSaving(true);
    try {
      const blob = await getCroppedImg(src, croppedAreaPixels);
      onSave(blob);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <p className="font-bold text-gray-800 text-sm">Crop School Logo</p>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Crop area */}
        <div className="relative bg-gray-900" style={{ height: 280 }}>
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={1}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            cropShape="rect"
            showGrid={false}
            style={{
              containerStyle: { borderRadius: 0 },
              cropAreaStyle: { border: "2px solid #3b82f6" },
            }}
          />
        </div>

        {/* Zoom slider */}
        <div className="px-4 py-3 flex items-center gap-3">
          <span className="text-xs text-gray-500 w-10 text-right">{zoom.toFixed(1)}×</span>
          <input
            type="range"
            min={0.1} max={3} step={0.05}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1 accent-blue-600"
          />
        </div>

        <div className="px-4 pb-4 flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2 text-sm font-semibold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2 text-sm font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {saving ? "Saving…" : "Crop & Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminProfilePanel({ me, onClose }: { me: MeResponse; onClose: () => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"info" | "school" | "password" | "pin" | "log">("info");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);

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

  const schoolInfoForm = useForm<z.infer<typeof schoolInfoSchema>>({
    resolver: zodResolver(schoolInfoSchema),
    defaultValues: {
      addressLine1: "", addressLine2: "", city: "", state: "",
      pinCode: "", country: "India", schoolPhone: "", schoolEmail: "",
      schoolWebsite: "", schoolBoard: "", schoolType: "",
      affiliationNumber: "", udiseCode: "", establishedYear: "",
      registrationNumber: "", pan: "", gstin: "",
    },
    values: {
      addressLine1:       profile?.addressLine1       ?? "",
      addressLine2:       profile?.addressLine2       ?? "",
      city:               profile?.city               ?? "",
      state:              profile?.state              ?? "",
      pinCode:            profile?.pinCode            ?? "",
      country:            profile?.country            ?? "India",
      schoolPhone:        profile?.schoolPhone        ?? "",
      schoolEmail:        profile?.schoolEmail        ?? "",
      schoolWebsite:      profile?.schoolWebsite      ?? "",
      schoolBoard:        profile?.schoolBoard        ?? "",
      schoolType:         profile?.schoolType         ?? "",
      affiliationNumber:  profile?.affiliationNumber  ?? "",
      udiseCode:          profile?.udiseCode          ?? "",
      establishedYear:    profile?.establishedYear    != null ? String(profile.establishedYear) : "",
      registrationNumber: profile?.registrationNumber ?? "",
      pan:                profile?.pan               ?? "",
      gstin:              profile?.gstin             ?? "",
    },
  });

  const schoolInfoMutation = useMutation({
    mutationFn: async (data: z.infer<typeof schoolInfoSchema>) => {
      const res = await apiRequest("PATCH", "/api/admin/school/info", {
        addressLine1:       data.addressLine1       || null,
        addressLine2:       data.addressLine2       || null,
        city:               data.city               || null,
        state:              data.state              || null,
        pinCode:            data.pinCode            || null,
        country:            data.country            || "India",
        phone:              data.schoolPhone        || null,
        email:              data.schoolEmail        || null,
        website:            data.schoolWebsite      || null,
        board:              data.schoolBoard        || null,
        schoolType:         data.schoolType         || null,
        affiliationNumber:  data.affiliationNumber  || null,
        udiseCode:          data.udiseCode          || null,
        establishedYear:    data.establishedYear ? Number(data.establishedYear) : null,
        registrationNumber: data.registrationNumber || null,
        pan:                data.pan               || null,
        gstin:              data.gstin             || null,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "School information updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/profile"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Logo: pick file → validate → open cropper ──────────────────────────
  const handleLogoFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!ALLOWED.includes(file.type)) {
      toast({ title: "Unsupported format", description: "Please choose a JPG, PNG, or WebP image.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum allowed size is 5 MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => { if (ev.target?.result) setCropSrc(ev.target.result as string); };
    reader.readAsDataURL(file);
  };

  // ── Logo: crop done → POST multipart ──────────────────────────────────
  const handleCropSave = async (blob: Blob) => {
    setLogoUploading(true);
    setCropSrc(null);
    try {
      const form = new FormData();
      form.append("file", blob, "logo.jpg");
      const res = await fetch("/api/admin/school/logo", { method: "POST", body: form, credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Upload failed");
      toast({ title: "Logo updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/profile"] });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setLogoUploading(false);
    }
  };

  // ── Logo: remove ───────────────────────────────────────────────────────
  const handleLogoRemove = async () => {
    try {
      const res = await fetch("/api/admin/school/logo", { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Remove failed");
      toast({ title: "Logo removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/profile"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

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
    <>
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-sm h-full bg-white shadow-2xl flex flex-col overflow-hidden text-gray-900" onClick={e => e.stopPropagation()}>
        <div className="border-b px-5 py-4 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center overflow-hidden flex-shrink-0">
              {profile?.logoUrl
                ? <img src={profile.logoUrl} alt="School logo" className="w-full h-full object-contain" />
                : <UserCircle2 className="w-6 h-6 text-blue-600" />}
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

        <div className="flex border-b bg-gray-50 overflow-x-auto">
          {([
            { key: "info",     label: "Profile"  },
            { key: "school",   label: "School"   },
            { key: "password", label: "Password" },
            { key: "pin",      label: "PIN"      },
            { key: "log",      label: "Log"      },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              data-testid={`profile-tab-${key}`}
              className={`flex-shrink-0 flex-1 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${tab === key ? "border-b-2 border-blue-600 text-blue-600 bg-white" : "text-gray-500 hover:text-gray-700"}`}>
              {label}
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
                          <Input className="pl-8 text-sm" placeholder="10-digit mobile number" inputMode="numeric" maxLength={10} data-testid="input-profile-recovery-phone" {...field} onChange={e => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 10))} />
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

          {tab === "school" && (
            <Form {...schoolInfoForm}>
              <form onSubmit={schoolInfoForm.handleSubmit(d => schoolInfoMutation.mutate(d))} className="space-y-5">

                {/* ── 1. SCHOOL IDENTITY ──────────────────────────────────── */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">School Identity</p>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 rounded-lg bg-gray-50 border space-y-0.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">School Name</p>
                      <p className="font-semibold text-gray-800 text-sm leading-snug">{me.schoolName}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-gray-50 border space-y-0.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">School Code</p>
                      <p className="font-bold text-gray-700 text-sm font-mono">{me.schoolCode}</p>
                    </div>
                  </div>

                  {/* Logo */}
                  <div className="p-3 rounded-lg bg-gray-50 border space-y-3">
                    <p className="text-xs text-gray-500 font-medium">School Logo</p>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
                        {profile?.logoUrl
                          ? <img src={profile.logoUrl} alt="School logo" className="w-full h-full object-contain" />
                          : <Building2 className="w-7 h-7 text-gray-300" />}
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <p className="text-[11px] text-gray-400 leading-snug">PNG, JPG or WebP · max 5 MB<br />Recommended: 512 × 512 px</p>
                        <div className="flex gap-2 flex-wrap">
                          <button type="button" onClick={() => logoFileInputRef.current?.click()} disabled={logoUploading}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-60">
                            {logoUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                            {profile?.logoUrl ? "Replace" : "Upload"}
                          </button>
                          {profile?.logoUrl && (
                            <button type="button" onClick={handleLogoRemove}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                              <Trash2 className="w-3 h-3" />Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <input ref={logoFileInputRef} type="file" accept="image/jpeg,image/jpg,image/png,image/webp"
                    className="hidden" onChange={handleLogoFilePick} />
                </div>

                <div className="border-t" />

                {/* ── 2. CONTACT & LOCATION ───────────────────────────────── */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Contact & Location</p>

                  <FormField control={schoolInfoForm.control} name="addressLine1" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Address Line 1 <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <Input className="text-sm" placeholder="Building / Street / Area" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={schoolInfoForm.control} name="addressLine2" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Address Line 2 <span className="text-gray-400 font-normal">(optional)</span></FormLabel>
                      <FormControl>
                        <Input className="text-sm" placeholder="Landmark / Locality" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={schoolInfoForm.control} name="city" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">City <span className="text-red-500">*</span></FormLabel>
                        <FormControl><Input className="text-sm" placeholder="e.g. Kolkata" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={schoolInfoForm.control} name="pinCode" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">PIN Code <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder="6-digit PIN" inputMode="numeric" maxLength={6}
                            {...field} onChange={e => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={schoolInfoForm.control} name="state" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">State <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <select className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" {...field}>
                            <option value="">Select state…</option>
                            {[
                              "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat",
                              "Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh",
                              "Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab",
                              "Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh",
                              "Uttarakhand","West Bengal",
                              "Andaman & Nicobar Islands","Chandigarh","Dadra & Nagar Haveli and Daman & Diu",
                              "Delhi (NCT)","Jammu & Kashmir","Ladakh","Lakshadweep","Puducherry",
                            ].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={schoolInfoForm.control} name="country" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Country</FormLabel>
                        <FormControl><Input className="text-sm" placeholder="India" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={schoolInfoForm.control} name="schoolPhone" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">School Phone <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                          <Input className="pl-8 text-sm" placeholder="STD or mobile number" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={schoolInfoForm.control} name="schoolEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Official School Email <span className="text-red-500">*</span></FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                          <Input className="pl-8 text-sm" placeholder="office@school.edu.in" {...field} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={schoolInfoForm.control} name="schoolWebsite" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Website <span className="text-gray-400 font-normal">(optional)</span></FormLabel>
                      <FormControl>
                        <Input className="text-sm" placeholder="https://www.school.edu.in" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="border-t" />

                {/* ── 3. ACADEMIC IDENTITY ────────────────────────────────── */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Academic Identity</p>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={schoolInfoForm.control} name="schoolBoard" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Board / Affiliation</FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder="e.g. CBSE, CISCE, West Bengal Board, IB, Cambridge, etc." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={schoolInfoForm.control} name="schoolType" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">School Type</FormLabel>
                        <FormControl>
                          <select className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" {...field}>
                            <option value="">Select…</option>
                            {["Private Unaided","Private Aided","Government","Central Government","Missionary / Trust","Other"].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={schoolInfoForm.control} name="affiliationNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">
                        Affiliation Number
                        {schoolInfoForm.watch("schoolBoard") === "CBSE" && <span className="ml-1 text-[10px] text-blue-500">(CBSE: 7-digit number)</span>}
                        {schoolInfoForm.watch("schoolBoard") === "CISCE / ICSE" && <span className="ml-1 text-[10px] text-blue-500">(CISCE index number)</span>}
                        {!schoolInfoForm.watch("schoolBoard") && <span className="ml-1 text-gray-400 font-normal">(optional)</span>}
                      </FormLabel>
                      <FormControl>
                        <Input className="text-sm" placeholder="Board affiliation / index number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={schoolInfoForm.control} name="udiseCode" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">UDISE Code <span className="text-gray-400 font-normal">(11 digits)</span></FormLabel>
                        <FormControl>
                          <Input className="text-sm font-mono" placeholder="e.g. 19151234567" inputMode="numeric" maxLength={11}
                            {...field} onChange={e => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 11))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={schoolInfoForm.control} name="establishedYear" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Est. Year</FormLabel>
                        <FormControl>
                          <Input className="text-sm" placeholder={`e.g. 1985`} inputMode="numeric" maxLength={4}
                            {...field} onChange={e => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                <div className="border-t" />

                {/* ── 4. LEGAL & TAX ──────────────────────────────────────── */}
                <div className="space-y-3">
                  <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Legal & Tax</p>
                  <p className="text-[11px] text-gray-400">All fields in this section are optional.</p>

                  <FormField control={schoolInfoForm.control} name="registrationNumber" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">School Registration Number</FormLabel>
                      <FormControl>
                        <Input className="text-sm font-mono" placeholder="Govt. registration / society number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={schoolInfoForm.control} name="pan" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">PAN</FormLabel>
                        <FormControl>
                          <Input className="text-sm font-mono uppercase" placeholder="AABCP1234C" maxLength={10}
                            {...field} onChange={e => field.onChange(e.target.value.toUpperCase().slice(0, 10))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={schoolInfoForm.control} name="gstin" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">GSTIN</FormLabel>
                        <FormControl>
                          <Input className="text-sm font-mono uppercase" placeholder="27AABCP1234C1Z5" maxLength={15}
                            {...field} onChange={e => field.onChange(e.target.value.toUpperCase().slice(0, 15))} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={schoolInfoMutation.isPending}>
                  {schoolInfoMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Save School Information
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

    {/* Cropper modal — rendered outside the panel slide so it covers full screen */}
    {cropSrc && (
      <SchoolLogoCropper
        src={cropSrc}
        onCancel={() => setCropSrc(null)}
        onSave={handleCropSave}
      />
    )}
    </>
  );
}

function SessionSwitcher({
  sessions, selected, onSelect, isLoading,
}: {
  sessions: AcademicSession[];
  selected: AcademicSession | null;
  onSelect: (s: AcademicSession) => void;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const isArchive = selected ? !selected.isActive : false;
  const label = selected ? selected.sessionName : (isLoading ? "Loading…" : "No Session");

  return (
    <div ref={ref} className="relative" data-testid="session-switcher">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all duration-200"
        style={{
          background: isArchive ? "rgba(251,191,36,0.12)" : "rgba(34,211,238,0.10)",
          border: `1px solid ${isArchive ? "rgba(251,191,36,0.35)" : "rgba(34,211,238,0.25)"}`,
          color: isArchive ? "#fbbf24" : "rgba(94,234,212,0.9)",
          backdropFilter: "blur(8px)",
        }}
        data-testid="button-session-switcher"
      >
        {isArchive
          ? <CalendarRange className="w-3 h-3 flex-shrink-0" />
          : <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse flex-shrink-0" style={{ boxShadow: "0 0 6px #22d3ee" }} />}
        <span className="hidden sm:inline max-w-[180px] truncate">
          {label}{selected?.isActive ? " · Active" : " · Archive"}
        </span>
        <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-64 rounded-xl overflow-hidden z-50"
          style={{
            background: "rgba(10,22,40,0.98)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.70), 0 0 0 1px rgba(34,211,238,0.07)",
          }}
          data-testid="session-switcher-dropdown"
        >
          <div
            className="px-4 py-2.5 border-b"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}
          >
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Switch View Session</p>
          </div>

          {sessions.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-white/30">
              {isLoading ? "Fetching sessions…" : "No sessions found"}
            </div>
          ) : (
            <div className="py-1">
              {sessions.map(s => {
                const isSel = selected?.id === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => { onSelect(s); setOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5"
                    data-testid={`session-option-${s.id}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: s.isActive ? "#22d3ee" : "rgba(255,255,255,0.18)", boxShadow: s.isActive ? "0 0 6px #22d3ee88" : "none" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${isSel ? "text-white" : "text-white/65"}`}>
                        {s.sessionName}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: s.isActive ? "#22d3ee99" : "rgba(255,255,255,0.28)" }}>
                        {s.isActive ? "● Active Session" : "⊘ Archived"}
                      </p>
                    </div>
                    {isSel && <Check className="w-3.5 h-3.5 flex-shrink-0 text-cyan-400" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [matchedModule, moduleParams]               = useRoute("/admin-dashboard/:module");
  const [matchedSetupSub,    setupSubParams]         = useRoute("/admin-dashboard/school-setup/:tab");
  const [matchedTimetableSub, timetableSubParams]   = useRoute("/admin-dashboard/timetable/:tab");
  const [matchedApprovalSub,  approvalSubParams]    = useRoute("/admin-dashboard/approval-center/:tab");
  const [matchedLeaveReqSub,  leaveReqSubParams]    = useRoute("/admin-dashboard/leave-requests/:tab");
  const [matchedComplaintSub, complaintSubParams]   = useRoute("/admin-dashboard/complaint-hub/:tab");
  const [matchedAnalyticsSub, analyticsSubParams]   = useRoute("/admin-dashboard/analytics/:tab");
  const [matchedIdCardSub,    idCardSubParams]       = useRoute("/admin-dashboard/id-card-gen/:tab");

  const activeModule: ActiveModule =
      matchedSetupSub     ? "school-setup"
    : matchedTimetableSub ? "timetable"
    : matchedApprovalSub  ? "approval-center"
    : matchedLeaveReqSub  ? "leave-requests"
    : matchedComplaintSub ? "complaint-hub"
    : matchedAnalyticsSub ? "analytics"
    : matchedIdCardSub    ? "id-card-gen"
    : matchedModule && moduleParams?.module
    ? (moduleParams.module as ActiveModule)
    : "grid";

  const setupSection = matchedSetupSub ? (setupSubParams?.tab ?? undefined) : undefined;
  const [showProfile, setShowProfile] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    Foundation: true, Oversight: true, Management: true, Enterprise: true,
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 640);

  // Hoisted here (before the data queries) so that selectedViewSession.id can
  // be included in every session-scoped queryKey.  The default is null; the
  // useEffect below sets it to the active session once sessions data loads.
  const [selectedViewSession, setSelectedViewSession] = useState<AcademicSession | null>(null);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 640) setSidebarOpen(false);
      else setSidebarOpen(true);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function toggleGroup(group: string) {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  }

  function goToModule(id: ActiveModule | "grid") {
    if (window.innerWidth < 640) setSidebarOpen(false);
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

  useEffect(() => {
    if (!isLoading && me?.role === "support_staff" && activeModule !== "grid") {
      if (!me.allowedModules?.includes(activeModule)) setLocation("/admin-dashboard");
    }
  }, [me, isLoading, activeModule]);

  const { data: schoolMeta } = useQuery<{
    classes: string[]; sections: string[]; subjects: string[]; exam_types: string[];
    class_sections: Record<string, string[]>;
    class_subjects: Record<string, string[]>;
    class_exam_types: Record<string, string[]>;
  }>({
    queryKey: ["/api/school-metadata", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return { classes: [], sections: [], subjects: [], exam_types: [], class_sections: {}, class_subjects: {}, class_exam_types: {} };
      const r = await fetch(`/api/school-metadata/${me.schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : { classes: [], sections: [], subjects: [], exam_types: [], class_sections: {}, class_subjects: {}, class_exam_types: {} };
    },
    enabled: !!me?.schoolId,
  });

  // sessionFetch is used for every custom queryFn so that x-view-session-id is
  // automatically attached to the request and the backend checkSessionContext
  // middleware can set req.viewSessionId for any optional session-scoped filtering.

  const { data: teachersList = [] } = useQuery<unknown[]>({
    queryKey: ["/api/schools", me?.schoolId, "teachers"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await sessionFetch(`/api/schools/${me.schoolId}/teachers`);
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const today = new Date().toISOString().split("T")[0];

  // selectedViewSession?.id is included in the queryKey so React Query creates
  // a separate cache entry for each academic year and triggers a fresh fetch
  // whenever the admin switches sessions.  The backend will receive
  // x-view-session-id via sessionFetch and can scope the response accordingly.
  const { data: dailySummary } = useQuery<{ total: number; present: number; percentage: number }>({
    queryKey: ["/api/attendance/daily-summary", me?.schoolId, today, selectedViewSession?.id],
    queryFn: async () => {
      if (!me?.schoolId) return { total: 0, present: 0, percentage: 0 };
      const r = await sessionFetch(`/api/attendance/daily-summary/${me.schoolId}/${today}`);
      return r.ok ? r.json() : { total: 0, present: 0, percentage: 0 };
    },
    enabled: !!me?.schoolId,
  });

  const { data: pendingLeaves = [] } = useQuery<unknown[]>({
    queryKey: ["/api/leave/school", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await sessionFetch(`/api/leave/school/${me.schoolId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: forwardedStudentLeaves = [] } = useQuery<unknown[]>({
    queryKey: ["/api/student-leaves/school", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await sessionFetch(`/api/student-leaves/school/${me.schoolId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: galleryItems = [] } = useQuery<unknown[]>({
    queryKey: ["/api/gallery", me?.schoolId, "all"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await sessionFetch(`/api/gallery/${me.schoolId}?all=true`);
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: pendingEbooks = [] } = useQuery<unknown[]>({
    queryKey: ["/api/library/books", me?.schoolId, "pending"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await sessionFetch(`/api/library/books/${me.schoolId}/pending`);
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: complaints = [] } = useQuery<unknown[]>({
    queryKey: ["/api/complaints/school", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await sessionFetch(`/api/complaints/school/${me.schoolId}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  const { data: sessions = [], isLoading: isSessionsLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/admin/academic-sessions", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const r = await fetch("/api/admin/academic-sessions", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!me?.schoolId,
  });

  useEffect(() => {
    if (sessions.length > 0 && !selectedViewSession) {
      const active = sessions.find(s => s.isActive) ?? sessions[0];
      setSelectedViewSession(active);
    }
  }, [sessions, selectedViewSession]);

  const isArchiveMode = selectedViewSession ? !selectedViewSession.isActive : false;

  useEffect(() => {
    setViewSessionId(selectedViewSession?.id ?? null);
    // Bust every cached query so all modules immediately refetch
    // scoped to the newly-selected session.
    queryClient.invalidateQueries();
  }, [selectedViewSession]);

  const pendingLeavesCount          = (pendingLeaves          as { status: string }[]).filter(l => l.status === "pending").length;
  const forwardedStudentLeavesCount = (forwardedStudentLeaves as unknown[]).length;
  const pendingGalleryCount         = (galleryItems           as { approved: boolean }[]).filter(g => !g.approved).length;
  const openComplaintsCount         = (complaints             as { status: string }[]).filter(c => c.status === "open" || c.status === "in_progress").length;
  const totalActionRequired         = pendingLeavesCount + forwardedStudentLeavesCount + pendingGalleryCount + pendingEbooks.length;

  const BADGES: Record<string, number> = {
    approvals:        pendingGalleryCount + pendingEbooks.length,
    "leave-requests": pendingLeavesCount + forwardedStudentLeavesCount,
    complaints:       openComplaintsCount,
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
    classes:        schoolMeta?.classes         ?? [],
    sections:       schoolMeta?.sections        ?? [],
    subjects:       schoolMeta?.subjects        ?? [],
    exam_types:     schoolMeta?.exam_types      ?? [],
    classSections:  schoolMeta?.class_sections  ?? {},
    classSubjects:  schoolMeta?.class_subjects  ?? {},
    classExamTypes: schoolMeta?.class_exam_types ?? {},
  };

  const visibleTiles = me?.role === "support_staff"
    ? TILES.filter(t => me.allowedModules?.includes(t.id))
    : TILES;

  function getSubsFor(moduleId: string): string[] | undefined {
    if (me?.role !== "support_staff") return undefined;
    return (me.allowedModules ?? [])
      .filter((k: string) => k.startsWith(moduleId + ":"))
      .map((k: string) => k.split(":")[1]);
  }

  const renderModule = () => {
    if (me?.role === "support_staff" && activeModule !== "grid" && !me.allowedModules?.includes(activeModule)) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.20)" }}>
            <Shield className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Access Denied</h2>
          <p className="text-white/50 text-sm max-w-sm">
            You don't have permission to view this module. Contact your Principal to request access.
          </p>
          <button
            onClick={() => setLocation("/admin-dashboard")}
            className="text-[#D4AF37] text-sm hover:underline mt-2"
          >
            ← Return to Dashboard
          </button>
        </div>
      );
    }
    switch (activeModule) {
      case "school-setup":      return <SchoolSetup schoolId={me.schoolId} section={setupSection} onNavigateSection={(sec) => { if (sec === null) setLocation("/admin-dashboard/school-setup"); else setLocation(`/admin-dashboard/school-setup/${sec}`); }} isArchiveMode={isArchiveMode} />;
      case "student-registry":  return <StudentRegistry schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} viewSessionId={selectedViewSession?.id} isArchiveMode={isArchiveMode} allowedSubs={getSubsFor("student-registry")} />;
      case "faculty-mapping":   return <FacultyMapping schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} allowedSubs={getSubsFor("faculty-mapping")} isArchiveMode={isArchiveMode} />;
      case "teacher-registry":  return <TeacherRegistry schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} onNavigate={(mod) => goToModule(mod as ActiveModule)} allowedSubs={getSubsFor("teacher-registry")} />;
      case "non-teaching-staff":return <NonTeachingStaff schoolId={me.schoolId} allowedSubs={getSubsFor("non-teaching-staff")} />;
      case "approval-center":   return <ApprovalCenter schoolId={me.schoolId} initialSection={approvalSubParams?.tab ?? null} onNavigateSection={(sec) => { if (sec) setLocation(`/admin-dashboard/approval-center/${sec}`); else setLocation("/admin-dashboard/approval-center"); }} allowedSubs={getSubsFor("approval-center")} isArchiveMode={isArchiveMode} />;
      case "leave-requests":    return <LeaveRequests schoolId={me.schoolId} initialSection={leaveReqSubParams?.tab ?? null} onNavigateSection={(sec) => { if (sec) setLocation(`/admin-dashboard/leave-requests/${sec}`); else setLocation("/admin-dashboard/leave-requests"); }} allowedSubs={getSubsFor("leave-requests")} />;
      case "audit-logs":        return <AuditLogsModule schoolId={me.schoolId} />;
      case "visitor-log":       return <VisitorLogModule schoolId={me.schoolId} allowedSubs={getSubsFor("visitor-log")} />;
      case "attendance":        return <AttendanceOverview schoolId={me.schoolId} onViewStudent={() => goToModule("student-registry")} />;
      case "analytics":         return <PerformanceAnalytics schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} examTypes={meta.exam_types} classSections={meta.classSections} classSubjects={meta.classSubjects} classExamTypes={meta.classExamTypes} initialTab={analyticsSubParams?.tab} onNavigateTab={(t) => setLocation(`/admin-dashboard/analytics/${t}`)} allowedSubs={getSubsFor("analytics")} />;
      case "exam-controller":   return <ExamController schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} examTypes={meta.exam_types} allowedSubs={getSubsFor("exam-controller")} />;
      case "complaint-hub":     return <ComplaintHub schoolId={me.schoolId} initialTab={complaintSubParams?.tab} onNavigateTab={(t) => setLocation(`/admin-dashboard/complaint-hub/${t}`)} allowedSubs={getSubsFor("complaint-hub")} />;
      case "noticeboard":       return <NoticeboardAdmin schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} adminUserId={me.id} allowedSubs={getSubsFor("noticeboard")} />;
      case "timetable":         return <TimetableMaster schoolId={me.schoolId} classes={meta.classes} sections={meta.sections} subjects={meta.subjects} initialTab={timetableSubParams?.tab} onNavigateTab={(t) => setLocation(`/admin-dashboard/timetable/${t}`)} allowedSubs={getSubsFor("timetable")} />;
      case "id-card-gen":       return <IdCardGen schoolId={me.schoolId} schoolName={me.schoolName} classes={meta.classes} sections={meta.sections} initialTab={idCardSubParams?.tab} onNavigateTab={(t) => setLocation(`/admin-dashboard/id-card-gen/${t}`)} allowedSubs={getSubsFor("id-card-gen")} />;
      case "assets":            return <AssetsInventory schoolId={me.schoolId} allowedSubs={getSubsFor("assets")} />;
      case "school-calendar":   return <SchoolCalendar allowedSubs={getSubsFor("school-calendar")} />;
      case "fees-manager":      return <FeesManager schoolId={me.schoolId} allowedSubs={getSubsFor("fees-manager")} />;
      case "removed-teacher-history": return <RemovedTeacherHistory schoolId={me.schoolId} onBack={() => goToModule("teacher-registry")} />;
      default: return null;
    }
  };

  const attendancePresent = dailySummary?.present ?? 0;
  const attendanceTotal   = dailySummary?.total   ?? 0;

  const adminInitials = (me.role === "support_staff" && me.displayName)
    ? me.displayName.trim().split(/\s+/).slice(0, 2).map((w: string) => w[0].toUpperCase()).join("")
    : me.email.split("@")[0].split(/[._-]/).filter(Boolean).map((w: string) => w[0].toUpperCase()).slice(0, 2).join("");

  return (
    <SessionViewContext.Provider value={{
      sessions,
      selectedSession: selectedViewSession,
      setSelectedSession: setSelectedViewSession,
      isArchiveMode,
      isSessionsLoading,
      pendingActivation: null,
      confirmActivation: () => { /* admin portal never shows the activation modal */ },
      subscribeToPaymentUpdate: () => () => { /* admin portal uses its own SSE listener */ },
    }}>
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Mobile hamburger / sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors sm:hidden"
              data-testid="button-toggle-sidebar-mobile"
              aria-label="Toggle navigation"
            >
              <Menu className="w-5 h-5 text-white/60" />
            </button>
            {activeModule !== "grid" && (
              <button
                onClick={() => goToModule("grid")}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                data-testid="button-back-to-grid"
              >
                <ChevronLeft className="w-5 h-5 text-white/60" />
              </button>
            )}
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)", boxShadow: "0 4px 16px rgba(99,102,241,0.35)" }}
            >
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <h1 className="text-base font-extrabold text-white tracking-tight" data-testid="text-dashboard-title">BENIUS</h1>
              <p className="text-[10px] text-white/35 leading-none font-medium truncate" data-testid="text-school-name">{me.schoolName}</p>
            </div>
          </div>

          <div className="flex-1 flex justify-center">
            <SessionSwitcher
              sessions={sessions}
              selected={selectedViewSession}
              onSelect={setSelectedViewSession}
              isLoading={isSessionsLoading}
            />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Initials avatar — taps to open profile */}
            <button
              onClick={() => setShowProfile(true)}
              data-testid="button-open-profile"
              className="flex items-center gap-2"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.35), rgba(6,182,212,0.35))",
                  border: "2px solid rgba(6,182,212,0.40)",
                }}
                data-testid="div-navbar-initials"
              >
                <span className="text-[10px] font-bold text-teal-300">{adminInitials}</span>
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-xs font-semibold text-white leading-none" data-testid="text-admin-email">
                  {me.email.split("@")[0]}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">{me.schoolName}</p>
              </div>
            </button>

            {/* Logout */}
            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              data-testid="button-logout"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.55)",
              }}
            >
              {logoutMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <LogOut className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>

        {/* ── Archive Mode Banner ── */}
        {isArchiveMode && selectedViewSession && (
          <div
            className="flex items-center justify-center gap-2.5 py-2 text-xs font-bold tracking-wide"
            style={{
              background: "linear-gradient(90deg, rgba(251,191,36,0.08) 0%, rgba(251,191,36,0.16) 50%, rgba(251,191,36,0.08) 100%)",
              borderTop: "1px solid rgba(251,191,36,0.22)",
              color: "#fbbf24",
            }}
            data-testid="banner-archive-mode"
          >
            <span role="img" aria-label="warning">⚠️</span>
            <span>Viewing Archive Mode (Read-Only)</span>
            <span className="opacity-40">·</span>
            <span className="font-semibold opacity-80">{selectedViewSession.sessionName}</span>
          </div>
        )}
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
              <StatRing
                value={studentCountAnimated}
                max={Math.max(me.studentCount, 1)}
                color="#D4AF37"
                icon={
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: [1, 1.12, 1] }}
                    transition={{
                      opacity: { duration: 0.35, delay: 0.15 },
                      scale: { duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.35 },
                    }}
                    style={{ filter: "drop-shadow(0 0 5px #D4AF37aa)" }}
                  >
                    <GraduationCap size={18} color="#D4AF37" strokeWidth={1.8} />
                  </motion.div>
                }
              />
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
              <StatRing
                value={facultyCountAnimated}
                max={Math.max(teachersList.length, 1)}
                color="#3b82f6"
                icon={
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1, rotateZ: [-6, 6, -6] }}
                    transition={{
                      opacity: { duration: 0.35, delay: 0.2 },
                      scale: { duration: 0.35, delay: 0.2 },
                      rotateZ: { duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.45 },
                    }}
                    style={{ filter: "drop-shadow(0 0 5px #3b82f6aa)" }}
                  >
                    <BookOpen size={17} color="#3b82f6" strokeWidth={1.8} />
                  </motion.div>
                }
              />
              <div className="min-w-0">
                <p className="text-[10px] text-white/40 leading-none mb-1 font-medium">Faculty Strength</p>
                <p className="text-xl font-extrabold text-white tracking-tight">{facultyCountAnimated}</p>
              </div>
            </div>

            {/* Daily Presence */}
            {(() => {
              const hasData = attendanceTotal > 0;
              const isHealthy = hasData && (dailySummary?.percentage ?? 0) >= 75;
              const presenceColor = hasData
                ? (isHealthy ? "#10b981" : "#ef4444")
                : "#6b7280";
              const presenceBg = hasData
                ? (isHealthy ? "rgba(16,185,129,0.07)" : "rgba(239,68,68,0.07)")
                : "rgba(255,255,255,0.03)";
              const presenceBorder = hasData
                ? (isHealthy ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)")
                : "rgba(255,255,255,0.06)";
              const pulseBg = isHealthy ? "bg-emerald-400" : "bg-red-400";
              return (
                <div
                  className="flex items-center gap-3 rounded-xl px-4 py-3"
                  style={{ background: presenceBg, border: `1px solid ${presenceBorder}` }}
                  data-testid="stat-attendance"
                >
                  <StatRing
                    value={attendancePctAnimated}
                    max={100}
                    color={presenceColor}
                    icon={
                      <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: [1, 1.10, 1] }}
                        transition={{
                          opacity: { duration: 0.35, delay: 0.25 },
                          scale: { duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 0.5 },
                        }}
                        style={{ filter: `drop-shadow(0 0 5px ${presenceColor}aa)` }}
                      >
                        <UserCheck size={17} color={presenceColor} strokeWidth={1.8} />
                      </motion.div>
                    }
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <p className="text-[10px] text-white/40 leading-none font-medium">Daily Presence</p>
                      {attendanceTotal > 0 && (
                        <span className="relative flex h-2 w-2">
                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${pulseBg} opacity-75`} />
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${pulseBg}`} />
                        </span>
                      )}
                    </div>
                    <p className="text-xl font-extrabold text-white tracking-tight">
                      {attendanceTotal ? `${attendancePctAnimated}%` : "—"}
                    </p>
                    {attendanceTotal > 0 && (
                      <p className="text-[10px] text-white/30 mt-0.5">{attendancePresent}/{attendanceTotal} present</p>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Action Required — hidden for support_staff (count spans all categories, not just their allowed ones) */}
            {me?.role !== "support_staff" && <div
              className="flex items-center gap-3 rounded-xl px-4 py-3 cursor-pointer transition-all hover:bg-red-500/12"
              style={{
                background: totalActionRequired > 0 ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${totalActionRequired > 0 ? "rgba(239,68,68,0.20)" : "rgba(255,255,255,0.06)"}`,
              }}
              onClick={() => goToModule("approval-center")}
              data-testid="stat-action-required"
            >
              <StatRing
                value={Math.min(actionCountAnimated, 10)}
                max={10}
                color={totalActionRequired > 0 ? "#ef4444" : "#4b5563"}
                icon={
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={totalActionRequired > 0 ? {
                      opacity: 1,
                      scale: 1,
                      rotateZ: [0, 14, -14, 10, -10, 6, -6, 0],
                    } : { opacity: 1, scale: 1, rotateZ: 0 }}
                    transition={totalActionRequired > 0 ? {
                      opacity: { duration: 0.35, delay: 0.3 },
                      scale: { duration: 0.35, delay: 0.3 },
                      rotateZ: { type: "spring", stiffness: 260, damping: 18, repeat: Infinity, repeatDelay: 2.3, delay: 0.55 },
                    } : { opacity: { duration: 0.35, delay: 0.3 }, scale: { duration: 0.35, delay: 0.3 } }}
                    style={{
                      filter: totalActionRequired > 0
                        ? "drop-shadow(0 0 5px #ef4444aa)"
                        : "drop-shadow(0 0 3px #4b556388)",
                      transformOrigin: "top center",
                    }}
                  >
                    <Bell
                      size={17}
                      color={totalActionRequired > 0 ? "#ef4444" : "#6b7280"}
                      strokeWidth={1.8}
                    />
                  </motion.div>
                }
              />
              <div className="min-w-0">
                <p className="text-[10px] text-white/40 leading-none mb-1 font-medium">Action Required</p>
                <p className={`text-xl font-extrabold tracking-tight ${totalActionRequired > 0 ? "text-red-400" : "text-white"}`}>
                  {actionCountAnimated}
                </p>
              </div>
            </div>}

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

        {/* Mobile backdrop overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 sm:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}

        {/* ── Translucent Floating Sidebar ── */}
        <aside
          className={`
            flex flex-col flex-shrink-0 border-r overflow-hidden
            fixed top-0 bottom-0 left-0 z-40
            sm:relative sm:top-auto sm:bottom-auto sm:left-auto sm:z-auto
            transition-all duration-300 ease-in-out
            ${sidebarOpen ? "w-60 translate-x-0" : "w-0 -translate-x-full sm:translate-x-0"}
          `}
          style={{
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            background: "rgba(15,23,42,0.97)",
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
                const groupTiles = visibleTiles.filter(t => t.group === group);
                if (!groupTiles.length) return null;
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
                        const badge = (tile.badgeKey && me?.role !== "support_staff") ? BADGES[tile.badgeKey] : undefined;
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
                            onMouseEnter={isActive ? undefined : (e) => {
                              const el = e.currentTarget;
                              el.style.background = `${tile.accentColor}09`;
                              el.style.borderLeft = `3px solid ${tile.accentColor}55`;
                              el.style.paddingLeft = "17px";
                              el.style.color = "rgba(255,255,255,0.82)";
                            }}
                            onMouseLeave={isActive ? undefined : (e) => {
                              const el = e.currentTarget;
                              el.style.background = "";
                              el.style.borderLeft = "";
                              el.style.paddingLeft = "";
                              el.style.color = "rgba(255,255,255,0.45)";
                            }}
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
                className="hidden sm:flex items-center gap-2 mb-5 text-xs text-white/35 hover:text-white transition-colors"
                data-testid="button-expand-sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" /> Show navigation
              </button>
            )}

            {activeModule === "grid" ? (
              <div className="space-y-10">
                {GROUP_ORDER.map(group => {
                  const groupTiles = visibleTiles.filter(t => t.group === group);
                  if (!groupTiles.length) return null;
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
                        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4"
                      >
                        {groupTiles.map(tile => (
                          <TileCard
                            key={tile.id}
                            tile={tile}
                            badge={(tile.badgeKey && me?.role !== "support_staff") ? BADGES[tile.badgeKey] : undefined}
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
                <div className="mb-6 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setupSection ? setLocation("/admin-dashboard/school-setup") : goToModule("grid")}
                    className="text-white/40 hover:text-white text-sm flex items-center gap-1 transition-colors"
                    data-testid="breadcrumb-back"
                  >
                    <ChevronLeft className="w-4 h-4" /> Dashboard
                  </button>
                  <span className="text-white/15">/</span>
                  {setupSection ? (
                    <>
                      <button
                        onClick={() => setLocation("/admin-dashboard/school-setup")}
                        className="text-white/40 hover:text-white text-sm transition-colors"
                        data-testid="breadcrumb-setup"
                      >
                        School Setup
                      </button>
                      <span className="text-white/15">/</span>
                      <span className="text-white/65 text-sm capitalize">
                        {setupSection.replace(/-/g, " ").replace(/\b(\w)/g, c => c.toUpperCase())}
                      </span>
                    </>
                  ) : (
                    <span className="text-white/65 text-sm">{TILES.find(t => t.id === activeModule)?.label ?? activeModule}</span>
                  )}
                </div>
                <Suspense fallback={
                  <div className="flex items-center justify-center py-24">
                    <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
                  </div>
                }>
                  {renderModule()}
                </Suspense>
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
    </SessionViewContext.Provider>
  );
}
