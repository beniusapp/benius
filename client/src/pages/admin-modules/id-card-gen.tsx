import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CreditCard, Search, Download, RefreshCw, AlertTriangle,
  GraduationCap, Users, UserCog, Loader2,
  SlidersHorizontal, Lock, X, Check, Save,
  Smartphone, Monitor, LayoutTemplate,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, sessionFetch } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

// ─── Types ──────────────────────────────────────────────────────────────────

type SubModule = "student" | "teacher" | "support-staff";

// Optional field keys that map directly to the Student Registry schema
export type OptionalFieldKey =
  | "dob"
  | "bloodGroup"
  | "phone"
  | "rollNumber"
  | "gender"
  | "guardianName"
  | "fatherName"
  | "motherName"
  | "address"
  | "aadharNumber"
  | "dateOfAdmission";

// ─── Theme system ─────────────────────────────────────────────────────────────

export type ThemeKey = "modern-dark" | "classic-light" | "minimal-accent";

export const CARD_THEMES: Record<ThemeKey, {
  name: string;
  swatches: [string, string];
  cardBg: string;
  cardBorder: string;
  accentColor: string;
  accentClass: string;
  labelClass: string;
  nameClass: string;
  valueClass: string;
  badgeBg: string;
  badgeText: string;
  footerBorder: string;
  headerBorder: string;
  schoolNameClass: string;
  footerTextClass: string;
  barcodeBg: string;
  dark: boolean;
}> = {
  "modern-dark": {
    name: "Modern Dark / Navy",
    swatches: ["#0A1628", "#D4AF37"],
    cardBg: "from-[#0A1628] to-[#1A2942]",
    cardBorder: "border-[#D4AF37]",
    accentColor: "#D4AF37",
    accentClass: "text-[#D4AF37]",
    labelClass: "text-white/40",
    nameClass: "text-white",
    valueClass: "text-white",
    badgeBg: "bg-[#D4AF37]/10",
    badgeText: "text-[#D4AF37]/60",
    footerBorder: "border-[#D4AF37]/30",
    headerBorder: "border-[#D4AF37]/30",
    schoolNameClass: "text-white/60",
    footerTextClass: "text-white/30",
    barcodeBg: "bg-white",
    dark: true,
  },
  "classic-light": {
    name: "Classic Clean (Light)",
    swatches: ["#f8fafc", "#1d4ed8"],
    cardBg: "from-white to-slate-100",
    cardBorder: "border-blue-600",
    accentColor: "#1d4ed8",
    accentClass: "text-blue-700",
    labelClass: "text-slate-400",
    nameClass: "text-slate-800",
    valueClass: "text-slate-700",
    badgeBg: "bg-blue-100",
    badgeText: "text-blue-700",
    footerBorder: "border-blue-200",
    headerBorder: "border-blue-200",
    schoolNameClass: "text-slate-500",
    footerTextClass: "text-slate-400",
    barcodeBg: "bg-slate-200",
    dark: false,
  },
  "minimal-accent": {
    name: "Minimal Accent",
    swatches: ["#111827", "#34d399"],
    cardBg: "from-[#111827] to-[#1f2937]",
    cardBorder: "border-emerald-400",
    accentColor: "#34d399",
    accentClass: "text-emerald-400",
    labelClass: "text-white/40",
    nameClass: "text-white",
    valueClass: "text-white",
    badgeBg: "bg-emerald-400/10",
    badgeText: "text-emerald-400/70",
    footerBorder: "border-emerald-400/30",
    headerBorder: "border-emerald-400/30",
    schoolNameClass: "text-white/60",
    footerTextClass: "text-white/30",
    barcodeBg: "bg-white",
    dark: true,
  },
};

export interface CardTemplate {
  version: 1;
  activeFields: OptionalFieldKey[];
  orientation: "portrait" | "landscape";
  theme: ThemeKey;
  printFormat: "pvc-cr80" | "a4-grid";
  savedAt?: string;
}

// ─── Template constants ──────────────────────────────────────────────────────

const TEMPLATE_STORAGE_KEY = "benius_student_id_card_template_v1";

export const OPTIONAL_FIELDS: {
  key: OptionalFieldKey;
  label: string;
  hint: string;
  studentProp: string;
}[] = [
  { key: "dob",             label: "Date of Birth",     hint: "e.g. 15/03/2009",        studentProp: "dob"            },
  { key: "bloodGroup",      label: "Blood Group",       hint: "e.g. B+",                studentProp: "bloodGroup"     },
  { key: "phone",           label: "Phone Number",      hint: "e.g. 9876543210",         studentProp: "phone"          },
  { key: "rollNumber",      label: "Roll Number",       hint: "e.g. 24",                 studentProp: "rollNumber"     },
  { key: "gender",          label: "Gender",            hint: "e.g. Male",               studentProp: "gender"         },
  { key: "guardianName",    label: "Guardian Name",     hint: "e.g. Rajesh Sharma",      studentProp: "guardianName"   },
  { key: "fatherName",      label: "Father's Name",     hint: "e.g. Rajesh Sharma",      studentProp: "fatherName"     },
  { key: "motherName",      label: "Mother's Name",     hint: "e.g. Priya Sharma",       studentProp: "motherName"     },
  { key: "address",         label: "Address",           hint: "e.g. 12, Park Street",    studentProp: "address"        },
  { key: "aadharNumber",    label: "Aadhaar Number",    hint: "e.g. 1234 5678 9012",     studentProp: "aadharNumber"   },
  { key: "dateOfAdmission", label: "Date of Admission", hint: "e.g. 01/04/2021",         studentProp: "dateOfAdmission"},
];

const DEFAULT_TEMPLATE: CardTemplate = {
  version: 1,
  activeFields: ["dob", "phone"],
  orientation: "portrait",
  theme: "modern-dark",
  printFormat: "pvc-cr80",
};

// Sample student used in the configure-template live preview
const PREVIEW_STUDENT = {
  id: 0,
  name: "Aarav Sharma",
  digitalStudentId: "MIS-S001",
  class: "10",
  section: "A",
  photoUrl: null,
  dob: "2009-03-15",
  bloodGroup: "B+",
  phone: "9876543210",
  rollNumber: "24",
  gender: "Male",
  guardianName: "Rajesh Sharma",
  fatherName: "Rajesh Sharma",
  motherName: "Priya Sharma",
  address: "12, Park Street, Kolkata",
  aadharNumber: "123456789012",
  dateOfAdmission: "2021-04-01",
  idCardPendingReissue: false,
};

function loadTemplate(): CardTemplate {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return DEFAULT_TEMPLATE;
    const parsed = JSON.parse(raw) as Partial<CardTemplate>;
    if (parsed.version !== 1) return DEFAULT_TEMPLATE;
    // Spread defaults so older saved templates get new fields gracefully
    return { ...DEFAULT_TEMPLATE, ...parsed } as CardTemplate;
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

function saveTemplate(tpl: CardTemplate) {
  try {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify({ ...tpl, savedAt: new Date().toISOString() }));
  } catch { /* ignore quota errors */ }
}

interface Props {
  schoolId: number;
  schoolName: string;
  classes: string[];
  sections: string[];
  initialTab?: string;
  onNavigateTab?: (tab: string) => void;
  allowedSubs?: string[];
}

// ─── Sub-module definitions ──────────────────────────────────────────────────

const SUB_MODULES: {
  id: SubModule;
  label: string;
  desc: string;
  icon: React.ElementType;
  accent: string;
  accentHex: string;
  textAccent: string;
  borderClass: string;
  bgClass: string;
  glowClass: string;
}[] = [
  {
    id: "student",
    label: "Student ID Cards",
    desc: "Generate & print ID cards for enrolled students",
    icon: GraduationCap,
    accent: "text-[#D4AF37]",
    accentHex: "#D4AF37",
    textAccent: "text-[#D4AF37]",
    borderClass: "border-[#D4AF37]",
    bgClass: "from-[#0A1628] to-[#1A2942]",
    glowClass: "shadow-[0_0_24px_rgba(212,175,55,0.18)]",
  },
  {
    id: "teacher",
    label: "Teacher ID Cards",
    desc: "Generate & print ID cards for teaching faculty",
    icon: Users,
    accent: "text-sky-400",
    accentHex: "#0EA5E9",
    textAccent: "text-sky-400",
    borderClass: "border-sky-500",
    bgClass: "from-[#0A1628] to-[#0c2233]",
    glowClass: "shadow-[0_0_24px_rgba(14,165,233,0.18)]",
  },
  {
    id: "support-staff",
    label: "Support Staff ID Cards",
    desc: "Generate & print ID cards for non-teaching staff",
    icon: UserCog,
    accent: "text-purple-400",
    accentHex: "#A855F7",
    textAccent: "text-purple-400",
    borderClass: "border-purple-500",
    bgClass: "from-[#0A1628] to-[#1a0d2e]",
    glowClass: "shadow-[0_0_24px_rgba(168,85,247,0.18)]",
  },
];

// ─── ID Card Components ──────────────────────────────────────────────────────

function renderOptionalField(student: any, key: OptionalFieldKey): string {
  switch (key) {
    case "dob":
      return student.dob ? new Date(student.dob).toLocaleDateString("en-GB") : "—";
    case "bloodGroup":
      return student.bloodGroup || "—";
    case "phone":
      return student.phone || "—";
    case "fatherName":
      return student.fatherName || "—";
    case "motherName":
      return student.motherName || "—";
    case "address":
      return student.address || "—";
    case "rollNumber":
      return student.rollNumber ? String(student.rollNumber) : "—";
    case "gender":
      return student.gender || "—";
    case "guardianName":
      return student.guardianName || "—";
    case "aadharNumber":
      return student.aadharNumber
        ? String(student.aadharNumber).replace(/(.{4})(.{4})(.{4})/, "$1 $2 $3")
        : "—";
    case "dateOfAdmission":
      return student.dateOfAdmission
        ? new Date(student.dateOfAdmission).toLocaleDateString("en-GB")
        : "—";
    default:
      return "—";
  }
}

function StudentIDCard({
  student,
  schoolName,
  showReissueBanner,
  activeFields,
  orientation = "portrait",
  theme = "modern-dark",
  academicSession,
}: {
  student: any;
  schoolName: string;
  showReissueBanner?: boolean;
  activeFields: OptionalFieldKey[];
  orientation?: "portrait" | "landscape";
  theme?: ThemeKey;
  academicSession?: string | null;
}) {
  const t = CARD_THEMES[theme] ?? CARD_THEMES["modern-dark"];

  const pairs: [OptionalFieldKey, OptionalFieldKey | null][] = [];
  for (let i = 0; i < activeFields.length; i += 2) {
    pairs.push([activeFields[i], activeFields[i + 1] ?? null]);
  }

  const fieldMeta: Record<OptionalFieldKey, string> = {
    dob: "Date of Birth", bloodGroup: "Blood Group", phone: "Phone",
    rollNumber: "Roll No.", gender: "Gender", guardianName: "Guardian",
    fatherName: "Father", motherName: "Mother",
    address: "Address", aadharNumber: "Aadhaar", dateOfAdmission: "Admission",
  };

  const avatarEl = student.photoUrl
    ? <img src={student.photoUrl} alt={student.name} className="w-full h-full object-cover rounded-full" />
    : <span>{student.name?.charAt(0).toUpperCase()}</span>;

  const reissueBanner = showReissueBanner && student.idCardPendingReissue && (
    <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold shadow-lg whitespace-nowrap">
      <AlertTriangle className="w-2.5 h-2.5" /> PENDING RE-ISSUANCE
    </div>
  );

  const optionalGrid = (
    <>
      {pairs.map(([a, b], i) => (
        <div key={i} className="contents">
          <div>
            <p className={t.labelClass}>{fieldMeta[a]}</p>
            <p className={`${t.valueClass} truncate`}>{renderOptionalField(student, a)}</p>
          </div>
          {b ? (
            <div>
              <p className={t.labelClass}>{fieldMeta[b]}</p>
              <p className={`${t.valueClass} truncate`}>{renderOptionalField(student, b)}</p>
            </div>
          ) : <div />}
        </div>
      ))}
    </>
  );

  /* ── Landscape layout ─────────────────────────────────────── */
  if (orientation === "landscape") {
    const borderClass = showReissueBanner && student.idCardPendingReissue ? "border-orange-400/80" : t.cardBorder;
    return (
      <div
        className={`w-[420px] rounded-xl border-2 bg-gradient-to-br ${t.cardBg} ${borderClass} p-4 shadow-xl relative flex gap-0`}
        data-testid={`card-student-${student.id}`}
      >
        {reissueBanner}

        {/* Left strip — avatar + school meta + barcode */}
        <div className={`w-28 shrink-0 flex flex-col items-center gap-2 border-r ${t.headerBorder} pr-4 mr-4`}>
          <p className={`${t.accentClass} text-[9px] font-bold tracking-widest`}>BENIUS</p>
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-2xl overflow-hidden"
            style={{ backgroundColor: t.accentColor, color: t.dark ? "#0A1628" : "white" }}
          >
            {avatarEl}
          </div>
          <p className={`${t.schoolNameClass} text-[8px] text-center leading-tight`}>{schoolName}</p>
          <span className={`text-[8px] font-bold ${t.badgeText} ${t.badgeBg} px-1.5 py-0.5 rounded`}>STUDENT</span>
          <div className={`w-full h-6 ${t.barcodeBg} rounded flex items-center justify-center mt-auto`}>
            <p className="text-[#0A1628] text-[7px] font-bold font-mono truncate px-1">{student.digitalStudentId}</p>
          </div>
        </div>

        {/* Right — name + field grid */}
        <div className="flex-1 min-w-0 flex flex-col">
          <p className={`${t.nameClass} font-bold text-base leading-tight truncate mb-2`}>{student.name}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs flex-1">
            <div>
              <p className={t.labelClass}>DSID</p>
              <p className={`${t.accentClass} font-mono text-[11px]`}>{student.digitalStudentId}</p>
            </div>
            <div>
              <p className={t.labelClass}>Class</p>
              <p className={`${t.valueClass} text-[11px]`}>{student.class}-{student.section}</p>
            </div>
            {optionalGrid}
          </div>
          <p className={`${t.footerTextClass} text-[8px] mt-2`}>
            {academicSession ? `Session: ${academicSession}` : "Academic ID"}
          </p>
        </div>
      </div>
    );
  }

  /* ── Portrait layout (default) ────────────────────────────── */
  const borderClass = showReissueBanner && student.idCardPendingReissue ? "border-orange-400/80" : t.cardBorder;
  return (
    <div
      className={`w-72 rounded-xl border-2 bg-gradient-to-br ${t.cardBg} ${borderClass} p-5 shadow-xl relative`}
      data-testid={`card-student-${student.id}`}
    >
      {reissueBanner}

      {/* Header */}
      <div className={`flex items-center gap-3 mb-3 border-b ${t.headerBorder} pb-3`}>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg overflow-hidden shrink-0"
          style={{ backgroundColor: t.accentColor, color: t.dark ? "#0A1628" : "white" }}
        >
          {avatarEl}
        </div>
        <div className="min-w-0">
          <p className={`${t.accentClass} text-xs font-semibold tracking-wider`}>BENIUS</p>
          <p className={`${t.schoolNameClass} text-xs truncate`}>{schoolName}</p>
        </div>
        <span className={`ml-auto text-[9px] font-bold ${t.badgeText} ${t.badgeBg} px-1.5 py-0.5 rounded shrink-0`}>STUDENT</span>
      </div>

      {/* Body */}
      <div className="space-y-1.5">
        <p className={`${t.nameClass} font-bold text-lg leading-tight truncate`}>{student.name}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className={t.labelClass}>DSID</p>
            <p className={`${t.accentClass} font-mono`}>{student.digitalStudentId}</p>
          </div>
          <div>
            <p className={t.labelClass}>Class</p>
            <p className={t.valueClass}>{student.class}-{student.section}</p>
          </div>
          {optionalGrid}
        </div>
      </div>

      {/* Footer */}
      <div className={`mt-4 pt-3 border-t ${t.footerBorder} flex items-center justify-between`}>
        <div className={`w-16 h-8 ${t.barcodeBg} rounded flex items-center justify-center`}>
          <p className="text-[#0A1628] text-[8px] font-bold font-mono">{student.digitalStudentId}</p>
        </div>
        <p className={`${t.footerTextClass} text-[9px]`}>
          {academicSession ? `Session: ${academicSession}` : "Academic ID"}
        </p>
      </div>
    </div>
  );
}

// ─── Configure Template Modal ─────────────────────────────────────────────────

function ConfigureTemplateModal({
  initial,
  schoolName,
  academicSession,
  onApply,
  onClose,
}: {
  initial: CardTemplate;
  schoolName: string;
  academicSession?: string | null;
  onApply: (tpl: CardTemplate, save: boolean) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState<Set<OptionalFieldKey>>(new Set(initial.activeFields));
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(initial.orientation ?? "portrait");
  const [theme, setTheme] = useState<ThemeKey>(initial.theme ?? "modern-dark");
  const [printFormat, setPrintFormat] = useState<"pvc-cr80" | "a4-grid">(initial.printFormat ?? "pvc-cr80");
  const [saveDefault, setSaveDefault] = useState(false);

  const toggle = useCallback((key: OptionalFieldKey) => {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const orderedActive = OPTIONAL_FIELDS.filter(f => active.has(f.key)).map(f => f.key);

  const handleApply = () => {
    onApply({ version: 1, activeFields: orderedActive, orientation, theme, printFormat }, saveDefault);
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const mandatoryFields = ["Student Photo", "Full Name", "DSID", "Class", "Section", "Academic Session"];

  const themeOptions: { key: ThemeKey; swatches: [string, string] }[] = [
    { key: "modern-dark",    swatches: ["#0A1628", "#D4AF37"] },
    { key: "classic-light",  swatches: ["#f8fafc", "#1d4ed8"] },
    { key: "minimal-accent", swatches: ["#111827", "#34d399"] },
  ];

  const printOptions = [
    { id: "pvc-cr80" as const, label: "Standard PVC Card (CR80)", sub: "85.6 × 54 mm — credit card size" },
    { id: "a4-grid"  as const, label: "Paper Sheet Grid (A4 Print)", sub: "Multiple cards per A4 sheet" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={handleBackdrop}
    >
      <div className="w-full max-w-4xl rounded-2xl bg-[#0d1b2e] border border-[#D4AF37]/30 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="w-5 h-5 text-[#D4AF37]" />
            <div>
              <h3 className="text-white font-bold text-base">Configure Card Template</h3>
              <p className="text-white/45 text-xs">Customize layout, design, and visible fields for printed ID cards</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left panel — controls */}
          <div className="w-72 shrink-0 border-r border-white/10 overflow-y-auto">

            {/* Section 1: Card Template & Design */}
            <div className="px-4 pt-4 pb-3">
              <p className="text-[#D4AF37] text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <LayoutTemplate className="w-3 h-3" /> Card Template &amp; Design
              </p>

              {/* Orientation */}
              <div className="mb-3">
                <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-1.5">Orientation</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { id: "portrait"  as const, label: "Vertical",   sub: "Portrait",  Icon: Smartphone },
                    { id: "landscape" as const, label: "Horizontal",  sub: "Landscape", Icon: Monitor    },
                  ]).map(o => (
                    <button
                      key={o.id}
                      onClick={() => setOrientation(o.id)}
                      className={`flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-lg border transition-all ${
                        orientation === o.id
                          ? "border-[#D4AF37] bg-[#D4AF37]/10 text-[#D4AF37]"
                          : "border-white/15 text-white/40 hover:border-white/30 hover:text-white/60"
                      }`}
                    >
                      <o.Icon className="w-4 h-4" />
                      <span className="text-[10px] font-semibold">{o.label}</span>
                      <span className="text-[9px] opacity-60">{o.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Visual Theme */}
              <div className="mb-3">
                <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-1.5">Visual Theme</p>
                <div className="space-y-1.5">
                  {themeOptions.map(opt => {
                    const on = theme === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setTheme(opt.key)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all ${
                          on ? "border-[#D4AF37] bg-[#D4AF37]/8" : "border-white/10 hover:border-white/20"
                        }`}
                      >
                        <div className="flex gap-0.5 shrink-0">
                          {opt.swatches.map((c, i) => (
                            <div key={i} className="w-4 h-4 rounded" style={{ backgroundColor: c, outline: "1px solid rgba(255,255,255,0.12)" }} />
                          ))}
                        </div>
                        <span className={`text-xs font-medium flex-1 text-left transition-colors ${on ? "text-[#D4AF37]" : "text-white/55"}`}>
                          {CARD_THEMES[opt.key].name}
                        </span>
                        {on && <Check className="w-3 h-3 text-[#D4AF37] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Target Print Format */}
              <div>
                <p className="text-white/40 text-[10px] font-semibold uppercase tracking-wider mb-1.5">Target Print Format</p>
                <div className="space-y-1.5">
                  {printOptions.map(p => {
                    const on = printFormat === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setPrintFormat(p.id)}
                        className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-lg border transition-all text-left ${
                          on ? "border-[#D4AF37] bg-[#D4AF37]/8" : "border-white/10 hover:border-white/20"
                        }`}
                      >
                        <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                          on ? "border-[#D4AF37]" : "border-white/25"
                        }`}>
                          {on && <div className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" />}
                        </div>
                        <div>
                          <p className={`text-xs font-medium transition-colors ${on ? "text-[#D4AF37]" : "text-white/55"}`}>{p.label}</p>
                          <p className="text-white/25 text-[9px]">{p.sub}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mx-4 h-px bg-white/10" />

            {/* Section 2: Mandatory Fields */}
            <div className="px-4 py-3">
              <p className="text-white/35 text-[10px] font-semibold uppercase tracking-widest mb-2">Mandatory</p>
              <div className="space-y-1">
                {mandatoryFields.map(label => (
                  <div key={label} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-white/[0.03]">
                    <div className="w-4 h-4 rounded flex items-center justify-center bg-[#D4AF37]/20 shrink-0">
                      <Lock className="w-2.5 h-2.5 text-[#D4AF37]" />
                    </div>
                    <span className="text-white/60 text-xs">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mx-4 h-px bg-white/10" />

            {/* Section 3: Optional Fields */}
            <div className="px-4 py-3">
              <p className="text-white/35 text-[10px] font-semibold uppercase tracking-widest mb-2">Optional Fields</p>
              <div className="space-y-1">
                {OPTIONAL_FIELDS.map(f => {
                  const on = active.has(f.key);
                  return (
                    <button
                      key={f.key}
                      onClick={() => toggle(f.key)}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-all ${
                        on ? "bg-[#D4AF37]/12 border border-[#D4AF37]/40" : "hover:bg-white/[0.04] border border-transparent"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded shrink-0 flex items-center justify-center border transition-colors ${
                        on ? "bg-[#D4AF37] border-[#D4AF37]" : "border-white/25 bg-transparent"
                      }`}>
                        {on && <Check className="w-2.5 h-2.5 text-[#0A1628]" />}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-xs font-medium truncate transition-colors ${on ? "text-white" : "text-white/55"}`}>{f.label}</p>
                        <p className="text-white/25 text-[10px] truncate">{f.hint}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right panel — live preview */}
          <div className="flex-1 flex flex-col items-center bg-[#080f1c] overflow-y-auto p-6 gap-4">
            <p className="text-white/30 text-xs font-semibold uppercase tracking-widest">Live Preview</p>

            {/* Active settings chips */}
            <div className="flex gap-1.5 flex-wrap justify-center">
              {[
                orientation === "portrait" ? "↕ Portrait" : "↔ Landscape",
                CARD_THEMES[theme].name,
                printFormat === "pvc-cr80" ? "PVC CR80" : "A4 Grid",
              ].map(label => (
                <span key={label} className="text-[9px] text-white/30 px-2 py-0.5 rounded-full border border-white/10">
                  {label}
                </span>
              ))}
            </div>

            {/* Card preview — scaled to fit */}
            <div className={`${orientation === "landscape" ? "scale-[0.72]" : "scale-90"} origin-top shrink-0`}>
              <StudentIDCard
                student={PREVIEW_STUDENT}
                schoolName={schoolName}
                activeFields={orderedActive}
                orientation={orientation}
                theme={theme}
                academicSession={academicSession ?? "2026–2027"}
              />
            </div>

            {/* Field count badge */}
            <p className="text-white/20 text-[10px] text-center">
              {orderedActive.length === 0
                ? "No optional fields selected — only mandatory fields will print."
                : `${orderedActive.length} optional field${orderedActive.length !== 1 ? "s" : ""} enabled`}
            </p>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between gap-4 flex-wrap bg-[#0d1b2e] shrink-0">
          {/* Save as Default toggle */}
          <button onClick={() => setSaveDefault(p => !p)} className="flex items-center gap-2.5 group">
            <div className={`w-9 h-5 rounded-full relative transition-colors ${saveDefault ? "bg-[#D4AF37]" : "bg-white/15"}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${saveDefault ? "left-4" : "left-0.5"}`} />
            </div>
            <div>
              <p className={`text-xs font-semibold transition-colors ${saveDefault ? "text-[#D4AF37]" : "text-white/50 group-hover:text-white/70"}`}>
                Save as Default Template
              </p>
              <p className="text-white/25 text-[10px]">Remember this layout on next visit</p>
            </div>
          </button>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="border-white/20 text-white/70 hover:bg-white/10">
              Cancel
            </Button>
            <Button onClick={handleApply} className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold gap-1.5">
              {saveDefault ? <Save className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
              {saveDefault ? "Save & Apply" : "Apply"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeacherIDCard({ teacher, schoolName }: { teacher: any; schoolName: string }) {
  const initials = (teacher.fullName ?? "T")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w: string) => w[0].toUpperCase())
    .join("");

  return (
    <div
      className="w-72 rounded-xl border-2 border-sky-500 bg-gradient-to-br from-[#0A1628] to-[#0c2233] p-5 shadow-xl"
      data-testid={`card-teacher-${teacher.id}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 border-b border-sky-500/30 pb-3">
        <div className="w-10 h-10 rounded-full bg-sky-500 flex items-center justify-center text-white font-bold text-sm overflow-hidden shrink-0">
          {teacher.profileImageUrl
            ? <img src={teacher.profileImageUrl} alt={teacher.fullName} className="w-full h-full object-cover rounded-full" />
            : initials}
        </div>
        <div className="min-w-0">
          <p className="text-sky-400 text-xs font-semibold tracking-wider">BENIUS</p>
          <p className="text-white/60 text-xs truncate">{schoolName}</p>
        </div>
        <span className="ml-auto text-[9px] font-bold text-sky-400/70 bg-sky-400/10 px-1.5 py-0.5 rounded shrink-0">FACULTY</span>
      </div>
      {/* Body */}
      <div className="space-y-1.5">
        <p className="text-white font-bold text-lg leading-tight truncate">{teacher.fullName}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-white/40">Teacher ID</p>
            <p className="text-sky-400 font-mono">{teacher.digitalTeacherId ?? "—"}</p>
          </div>
          <div>
            <p className="text-white/40">Department</p>
            <p className="text-white truncate">{teacher.department || teacher.subject || "—"}</p>
          </div>
          <div>
            <p className="text-white/40">Designation</p>
            <p className="text-white truncate">{teacher.designation || "Teacher"}</p>
          </div>
          <div>
            <p className="text-white/40">Phone</p>
            <p className="text-white">{teacher.phone || "—"}</p>
          </div>
        </div>
      </div>
      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-sky-500/30 flex items-center justify-between">
        <div className="w-16 h-8 bg-white rounded flex items-center justify-center">
          <p className="text-[#0A1628] text-[8px] font-bold font-mono">{teacher.digitalTeacherId ?? teacher.id}</p>
        </div>
        <p className="text-white/30 text-[9px]">Faculty ID</p>
      </div>
    </div>
  );
}

function SupportStaffIDCard({ staff, schoolName }: { staff: any; schoolName: string }) {
  const initials = (staff.fullName ?? "S")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w: string) => w[0].toUpperCase())
    .join("");

  return (
    <div
      className="w-72 rounded-xl border-2 border-purple-500 bg-gradient-to-br from-[#0A1628] to-[#1a0d2e] p-5 shadow-xl"
      data-testid={`card-staff-${staff.id}`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 border-b border-purple-500/30 pb-3">
        <div className="w-10 h-10 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold text-sm overflow-hidden shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-purple-400 text-xs font-semibold tracking-wider">BENIUS</p>
          <p className="text-white/60 text-xs truncate">{schoolName}</p>
        </div>
        <span className="ml-auto text-[9px] font-bold text-purple-400/70 bg-purple-400/10 px-1.5 py-0.5 rounded shrink-0">STAFF</span>
      </div>
      {/* Body */}
      <div className="space-y-1.5">
        <p className="text-white font-bold text-lg leading-tight truncate">{staff.fullName}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-white/40">Staff ID</p>
            <p className="text-purple-400 font-mono">{staff.staffId ?? `SS-${String(staff.id).padStart(3, "0")}`}</p>
          </div>
          <div>
            <p className="text-white/40">Designation</p>
            <p className="text-white truncate">{staff.designation || "—"}</p>
          </div>
          <div>
            <p className="text-white/40">Phone</p>
            <p className="text-white">{staff.phone || "—"}</p>
          </div>
          <div>
            <p className="text-white/40">Email</p>
            <p className="text-white text-[10px] truncate">{staff.email || "—"}</p>
          </div>
        </div>
      </div>
      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-purple-500/30 flex items-center justify-between">
        <div className="w-16 h-8 bg-white rounded flex items-center justify-center">
          <p className="text-[#0A1628] text-[8px] font-bold font-mono">{staff.staffId ?? `SS-${String(staff.id).padStart(3, "0")}`}</p>
        </div>
        <p className="text-white/30 text-[9px]">Support Staff ID</p>
      </div>
    </div>
  );
}

// ─── Print execution utility ─────────────────────────────────────────────────

/**
 * Exports ID cards directly as a downloaded PDF — no print dialog.
 *
 * Strategy:
 *   • html2canvas renders each card element (already visible in the DOM,
 *     so all Tailwind CSS and cached images apply automatically) to a canvas.
 *   • jsPDF assembles the canvases into a PDF and triggers a direct download.
 *   • PVC CR80: one card per page, page sized exactly to the card dimensions.
 *   • A4 grid : cards arranged in a 2-col (portrait) or 3-col (landscape) grid.
 *
 * @param setExporting  state setter — true while async work is running
 * @param setProgress   0-100 progress setter shown on the button
 */
async function executeExport(
  format: CardTemplate["printFormat"],
  orientation: CardTemplate["orientation"],
  filterIds: Set<number> | undefined,
  setExporting: (v: boolean) => void,
  setProgress: (v: number) => void,
) {
  const printArea = document.getElementById("printable-id-card-area");
  if (!printArea) return;

  // ── 1. Collect the card elements to export ────────────────────────────────
  // Each [data-print-card] wrapper has:  [checkbox overlay, ...] + card (last child)
  const allWrappers = Array.from(
    printArea.querySelectorAll<HTMLElement>("[data-print-card]")
  );
  const visibleWrappers = (filterIds && filterIds.size > 0)
    ? allWrappers.filter(w => w.hasAttribute("data-selected"))
    : allWrappers;
  if (visibleWrappers.length === 0) return;

  // The actual card component is always the last child of the wrapper div
  const cardEls = visibleWrappers
    .map(w => w.lastElementChild as HTMLElement)
    .filter(Boolean);

  setExporting(true);
  setProgress(0);

  try {
    // ── 2. Dynamic import (keeps bundle lean) ─────────────────────────────
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);

    const isLandscape = orientation === "landscape";

    // ── 3. Render each card into a clean off-screen host ─────────────────
    //
    // WHY cloning is needed:
    //   html2canvas computes element position from the document root, then
    //   subtracts the viewport scroll. When the card lives inside the
    //   AdminDashboard's overflow-y-auto pane, that inner scroll is invisible
    //   to html2canvas — so the captured rect is shifted and the right/bottom
    //   edges are clipped.
    //
    // WHY host at (0,0):
    //   Placing the host at position:absolute top:0 left:0 with width:0
    //   height:0 overflow:visible puts the clone at document coordinates
    //   (0,0). With scrollX:0 scrollY:0 we tell html2canvas "start rendering
    //   from the document origin" — the element is right there, no offset
    //   arithmetic needed.
    //   A negative left (e.g. -9999px) would require a matching scrollX
    //   correction; keeping it at 0 eliminates all that complexity.
    //
    // WHY NOT setting windowWidth/windowHeight:
    //   Setting windowWidth to the card's pixel width (288px) makes
    //   html2canvas think the browser viewport is 288px wide — this breaks
    //   font metrics and line-wrap calculations, causing text to be clipped.
    //   Omitting those options lets html2canvas use the real window size.

    // ── 4. Render each card to a canvas ──────────────────────────────────
    //
    // Why position:fixed at (0,0):
    //   - An element's getBoundingClientRect() depends on both its document
    //     position AND the current scroll offset.  When the clone is at
    //     position:absolute top:0 but the page is scrolled 500px, its
    //     getBoundingClientRect().top is −500.  With scrollY:0 that causes
    //     html2canvas to try rendering at canvas-y = −500 → blank or shifted.
    //   - position:fixed elements are always at their declared viewport
    //     coordinates regardless of scroll.  A clone at fixed top:0 left:0
    //     always has getBoundingClientRect() = {top:0, left:0}, so
    //     html2canvas finds it at (0,0) every time — no scroll arithmetic.
    //   - z-index:−1 hides it behind the page; pointer-events:none prevents
    //     any accidental interaction.
    const canvases: HTMLCanvasElement[] = [];
    for (let i = 0; i < cardEls.length; i++) {
      setProgress(Math.round((i / cardEls.length) * 85));

      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed;top:0;left:0;z-index:-1;pointer-events:none;";
      document.body.appendChild(host);

      const clone = cardEls[i].cloneNode(true) as HTMLElement;
      clone.style.overflow = "visible";
      clone.style.height   = "auto";
      host.appendChild(clone);

      // One animation frame so the browser computes layout (offsetWidth/Height)
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      const canvas = await html2canvas(clone, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        logging: false,
        // Clone is at fixed (0,0) — no scroll offset needed
        scrollX: 0,
        scrollY: 0,
      });
      canvases.push(canvas);
      host.remove();
    }

    setProgress(90);

    // ── 5. Build PDF ──────────────────────────────────────────────────────
    //
    // KEY FIX: do NOT use hardcoded CR80 page dimensions (54×85.6mm).
    // The canvas aspect ratio rarely matches exactly, so a hardcoded page
    // leaves blank space and stretches/squashes text.
    //
    // Instead, keep the standard CR80 width as the reference and derive
    // the page height from the actual canvas aspect ratio — page then
    // fits the card exactly with no distortion and no blank space.

    if (format === "pvc-cr80") {
      // Reference width: 85.6mm landscape / 54mm portrait (CR80 standard)
      const refW = isLandscape ? 85.6 : 54;

      canvases.forEach((canvas, i) => {
        const ar = canvas.height / canvas.width;   // height:width ratio
        const pw = refW;
        const ph = parseFloat((pw * ar).toFixed(4));
        const pageOri = ph > pw ? "portrait" : "landscape";

        if (i === 0) {
          // First page — create the PDF with the first card's dimensions
          const pdf = new jsPDF({ orientation: pageOri, unit: "mm", format: [pw, ph] });
          pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pw, ph);

          // Remaining cards
          canvases.slice(1).forEach((c) => {
            const ar2 = c.height / c.width;
            const ph2 = parseFloat((pw * ar2).toFixed(4));
            pdf.addPage([pw, ph2], ph2 > pw ? "portrait" : "landscape");
            pdf.addImage(c.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, pw, ph2);
          });

          pdf.save(`id-cards-${Date.now()}.pdf`);
        }
      });

    } else {
      // A4 grid — 2 cols portrait / 3 cols landscape
      const pgW = isLandscape ? 297 : 210;
      const pgH = isLandscape ? 210 : 297;
      const cols = isLandscape ? 3 : 2;
      const margin = 10;
      const gap = 6;
      const cellW = (pgW - margin * 2 - gap * (cols - 1)) / cols;

      const pdf = new jsPDF({
        orientation: isLandscape ? "landscape" : "portrait",
        unit: "mm",
        format: "a4",
      });

      // Compute rows using the first canvas aspect ratio as representative
      const ar0 = canvases[0] ? canvases[0].height / canvases[0].width : 1.585;
      const cellH0 = cellW * ar0;
      const rows = Math.max(1, Math.floor((pgH - margin * 2 + gap) / (cellH0 + gap)));
      const perPage = cols * rows;

      canvases.forEach((canvas, i) => {
        const posInPage = i % perPage;
        if (i > 0 && posInPage === 0) pdf.addPage();
        const col = posInPage % cols;
        const row = Math.floor(posInPage / cols);
        const x = margin + col * (cellW + gap);
        // Use each card's own aspect ratio for cell height
        const cellH = cellW * (canvas.height / canvas.width);
        const y = margin + row * (cellH0 + gap);
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", x, y, cellW, cellH);
      });

      pdf.save(`id-cards-${Date.now()}.pdf`);
    }

    setProgress(100);
  } finally {
    setExporting(false);
  }
}

// ─── Sub-module panels ───────────────────────────────────────────────────────

function StudentPanel({
  schoolId,
  schoolName,
  classes,
  sections,
  isArchiveMode,
}: {
  schoolId: number;
  schoolName: string;
  classes: string[];
  sections: string[];
  isArchiveMode: boolean;
}) {
  const { toast } = useToast();
  const { selectedSession } = useSessionView();
  // Use whichever session the admin has selected in the switcher — the printed
  // card reflects the year being viewed (active or archive).
  const academicSession = selectedSession?.sessionName ?? null;
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState(false);

  // ── Template state ────────────────────────────────────────────────────────
  const [template, setTemplate] = useState<CardTemplate>(() => loadTemplate());
  const [showConfig, setShowConfig] = useState(false);

  // ── Card selection ────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // ── Export state ──────────────────────────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleApplyTemplate = useCallback((tpl: CardTemplate, save: boolean) => {
    setTemplate(tpl);
    if (save) saveTemplate(tpl);
    setShowConfig(false);
    toast({
      title: save ? "✅ Template saved" : "✅ Template applied",
      description: `${tpl.activeFields.length} optional field${tpl.activeFields.length !== 1 ? "s" : ""} active on ID cards.`,
      duration: 3000,
    });
  }, [toast]);

  const params = new URLSearchParams();
  if (cls && cls !== "all") params.set("cls", cls);
  if (section && section !== "all") params.set("section", section);
  if (q) params.set("q", q);
  params.set("page", "1");

  const { data, isLoading } = useQuery<{ data: any[]; total: number }>({
    // Include selectedSession?.id so the query re-fires whenever the admin
    // switches the session switcher — different session = different cohort.
    queryKey: ["/api/schools", schoolId, "students", "paginated", q, cls, section, 1, selectedSession?.id ?? null],
    queryFn: async () => {
      const r = await sessionFetch(`/api/schools/${schoolId}/students/paginated?${params}`);
      return r.ok ? r.json() : { data: [], total: 0 };
    },
    enabled: !!schoolId && searched,
    staleTime: 0,
  });

  // Clear selection whenever the result set changes (new search / tab switch)
  useEffect(() => { setSelectedIds(new Set()); }, [data]);

  // Reset to "not yet searched" when the admin switches sessions so stale
  // results from the previous year don't linger on screen.
  useEffect(() => {
    setSearched(false);
    setSelectedIds(new Set());
  }, [selectedSession?.id]);

  return (
    <div className="space-y-4">
      {/* Search controls */}
      <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-white/60 mb-1">Search Student</label>
              <Input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Name or DSID..."
                className="bg-[#0A1628] border-white/20 text-white"
                data-testid="input-student-search"
                onKeyDown={e => e.key === "Enter" && setSearched(true)}
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Class</label>
              <Select value={cls} onValueChange={setCls}>
                <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-student-class">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(classes.length > 0 ? classes : ["9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Section</label>
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-student-section">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(sections.length > 0 ? sections : ["A","B","C"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => setSearched(true)}
              className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
              data-testid="button-search-students"
            >
              <Search className="w-4 h-4 mr-1" /> Search
            </Button>
            {data && data.data.length > 0 && (
              <Button
                className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold gap-1.5"
                disabled={isExporting}
                onClick={() => {
                  const ids = selectedIds.size > 0 ? selectedIds : undefined;
                  const count = ids ? ids.size : (data?.data.length ?? 0);
                  toast({
                    title: `⬇️ Preparing ${count} card${count !== 1 ? "s" : ""}…`,
                    description: "PDF will download automatically.",
                    duration: 3000,
                  });
                  executeExport(
                    template.printFormat,
                    template.orientation,
                    ids,
                    setIsExporting,
                    setExportProgress,
                  ).catch(() => toast({ title: "Export failed", description: "Please try again.", variant: "destructive" }));
                }}
                data-testid="button-export-student-cards"
              >
                {isExporting
                  ? <><Loader2 className="w-4 h-4 animate-spin" />{exportProgress < 100 ? `Exporting ${exportProgress}%` : "Saving…"}</>
                  : <><Download className="w-4 h-4" />{selectedIds.size > 0 ? `Export Selected (${selectedIds.size})` : "Export PDF"}</>
                }
              </Button>
            )}
          </div>

          {/* Configure Template row */}
          <div className="flex items-center justify-between pt-1 border-t border-white/8">
            <div className="flex items-center gap-2">
              <p className="text-white/35 text-xs">
                Active optional fields:&nbsp;
                {template.activeFields.length === 0
                  ? <span className="text-white/25 italic">none</span>
                  : template.activeFields
                      .map(k => OPTIONAL_FIELDS.find(f => f.key === k)?.label)
                      .filter(Boolean)
                      .join(", ")
                }
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowConfig(true)}
              className="border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10 hover:border-[#D4AF37]/70 h-8 px-3 text-xs gap-1.5"
              data-testid="button-configure-template"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Configure Template
            </Button>
          </div>
        </div>

      {/* Configure Template Modal */}
      {showConfig && (
        <ConfigureTemplateModal
          initial={template}
          schoolName={schoolName}
          academicSession={academicSession}
          onApply={handleApplyTemplate}
          onClose={() => setShowConfig(false)}
        />
      )}

      {/* Card grid */}
      {searched && (
        isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-white/40">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading students…
          </div>
        ) : !data || data.data.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
            <CreditCard className="w-10 h-10 mx-auto mb-3 text-white/20" />
            <p className="text-white/40">No students found. Try different filters.</p>
          </div>
        ) : (
          <>
          {/* Selection summary bar */}
          {(() => {
            const all = data.data.slice(0, 20);
            const allSelected = all.length > 0 && all.every(s => selectedIds.has(s.id));
            const someSelected = selectedIds.size > 0 && !allSelected;
            return (
              <div className="flex items-center gap-3 py-1 px-1">
                {/* Select All checkbox */}
                <button
                  onClick={() => {
                    if (allSelected) setSelectedIds(new Set());
                    else setSelectedIds(new Set(all.map(s => s.id)));
                  }}
                  className="flex items-center gap-2 text-xs text-white/50 hover:text-white/80 transition-colors"
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                    allSelected ? "bg-[#D4AF37] border-[#D4AF37]"
                    : someSelected ? "border-[#D4AF37]/60 bg-[#D4AF37]/15"
                    : "border-white/30 bg-transparent"
                  }`}>
                    {allSelected && <Check className="w-2.5 h-2.5 text-[#0A1628]" />}
                    {someSelected && <div className="w-2 h-0.5 rounded bg-[#D4AF37]" />}
                  </div>
                  {allSelected ? "Deselect All" : "Select All"}
                </button>

                {selectedIds.size > 0 && (
                  <>
                    <span className="text-white/20 text-xs">·</span>
                    <span className="text-[#D4AF37] text-xs font-semibold">
                      {selectedIds.size} of {all.length} selected
                    </span>
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="text-white/30 hover:text-white/60 text-xs transition-colors"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            );
          })()}

          {/* Card grid */}
          <div className="flex flex-wrap gap-4 pt-1" id="printable-id-card-area">
            {data.data.slice(0, 20).map(s => {
              const isSelected = selectedIds.has(s.id);
              return (
                <div
                  key={s.id}
                  data-print-card
                  {...(isSelected ? { "data-selected": "" } : {})}
                  className="relative group cursor-pointer"
                  onClick={() => toggleSelect(s.id)}
                >
                  {/* Checkbox overlay — top-left of card */}
                  <div
                    className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center
                      transition-all pointer-events-none shadow-sm
                      ${isSelected
                        ? "bg-[#D4AF37] border-[#D4AF37] opacity-100"
                        : "bg-black/55 border-white/45 opacity-0 group-hover:opacity-100"
                      }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-[#0A1628]" />}
                  </div>

                  {/* Gold ring when selected */}
                  {isSelected && (
                    <div className="absolute inset-0 rounded-xl ring-2 ring-[#D4AF37] ring-offset-2 ring-offset-[#0d1b2e] pointer-events-none z-20" />
                  )}

                  <StudentIDCard
                    student={s}
                    schoolName={schoolName}
                    showReissueBanner={false}
                    activeFields={template.activeFields}
                    orientation={template.orientation}
                    theme={template.theme}
                    academicSession={academicSession}
                  />
                </div>
              );
            })}
          </div>
          </>
        )
      )}

      {!searched && (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
          <GraduationCap className="w-10 h-10 mx-auto mb-3 text-white/20" />
          <p className="text-white/40">Search for students to preview and print ID cards</p>
          <p className="text-white/25 text-sm mt-1">Up to 20 cards shown at a time · Use Class/Section filter for batch print</p>
        </div>
      )}
    </div>
  );
}

function TeacherPanel({
  schoolId,
  schoolName,
}: {
  schoolId: number;
  schoolName: string;
}) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Use the flat-array teachers endpoint (paginated /api/admin/teachers returns { data, total })
  const { data: teachers, isLoading } = useQuery<any[]>({
    queryKey: ["/api/schools", schoolId, "teachers"],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/teachers`, { credentials: "include" });
      if (!r.ok) return [];
      const result = await r.json();
      // Guard: some endpoints return { data: [] } — unwrap if needed
      return Array.isArray(result) ? result : (result?.data ?? []);
    },
    enabled: !!schoolId,
    staleTime: 60_000,
  });

  const filtered = (teachers ?? []).filter(t => {
    if (!q) return true;
    const lower = q.toLowerCase();
    return (
      t.fullName?.toLowerCase().includes(lower) ||
      t.digitalTeacherId?.toLowerCase().includes(lower) ||
      t.department?.toLowerCase().includes(lower) ||
      t.subject?.toLowerCase().includes(lower) ||
      t.designation?.toLowerCase().includes(lower)
    );
  });

  const displayed = q ? filtered : (searched ? filtered : []);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="rounded-xl border border-sky-500/30 bg-[#1A2942] p-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-white/60 mb-1">Search Teacher</label>
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Name, Teacher ID, Department…"
              className="bg-[#0A1628] border-white/20 text-white"
              data-testid="input-teacher-search"
              onKeyDown={e => e.key === "Enter" && setSearched(true)}
            />
          </div>
          <Button
            onClick={() => setSearched(true)}
            className="bg-sky-500 hover:bg-sky-400 text-white font-semibold"
            data-testid="button-search-teachers"
          >
            <Search className="w-4 h-4 mr-1" /> Search
          </Button>
          {(searched || q) && filtered.length > 0 && (
            <Button
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10 gap-1.5"
              disabled={isExporting}
              onClick={() => {
                toast({ title: "⬇️ Preparing cards…", description: "PDF will download automatically.", duration: 3000 });
                executeExport("pvc-cr80", "portrait", undefined, setIsExporting, setExportProgress)
                  .catch(() => toast({ title: "Export failed", variant: "destructive" }));
              }}
              data-testid="button-export-teacher-cards"
            >
              {isExporting
                ? <><Loader2 className="w-4 h-4 animate-spin" />{exportProgress < 100 ? `${exportProgress}%` : "Saving…"}</>
                : <><Download className="w-4 h-4" /> Export PDF</>
              }
            </Button>
          )}
        </div>
      </div>

      {/* Card grid */}
      {(searched || q) && (
        isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-white/40">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading teachers…
          </div>
        ) : displayed.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
            <CreditCard className="w-10 h-10 mx-auto mb-3 text-white/20" />
            <p className="text-white/40">No teachers found matching "{q}".</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4 pt-2" id="printable-id-card-area">
            {displayed.slice(0, 20).map(t => (
              <div key={t.id} data-print-card>
                <TeacherIDCard teacher={t} schoolName={schoolName} />
              </div>
            ))}
          </div>
        )
      )}

      {!searched && !q && !isLoading && (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 text-white/20" />
          <p className="text-white/40">Search for teachers to preview and print ID cards</p>
          <p className="text-white/25 text-sm mt-1">Filter by name, Teacher ID, or department</p>
        </div>
      )}
    </div>
  );
}

function SupportStaffPanel({
  schoolId,
  schoolName,
}: {
  schoolId: number;
  schoolName: string;
}) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const { data: staff, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/non-teaching-staff"],
    queryFn: async () => {
      const r = await fetch("/api/admin/non-teaching-staff", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
    staleTime: 60_000,
  });

  const filtered = (staff ?? []).filter(s => {
    if (!q) return true;
    const lower = q.toLowerCase();
    return (
      s.fullName?.toLowerCase().includes(lower) ||
      s.designation?.toLowerCase().includes(lower) ||
      s.email?.toLowerCase().includes(lower) ||
      s.phone?.includes(q)
    );
  });

  const displayed = q ? filtered : (searched ? filtered : []);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="rounded-xl border border-purple-500/30 bg-[#1A2942] p-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs text-white/60 mb-1">Search Support Staff</label>
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Name, designation, email…"
              className="bg-[#0A1628] border-white/20 text-white"
              data-testid="input-staff-search"
              onKeyDown={e => e.key === "Enter" && setSearched(true)}
            />
          </div>
          <Button
            onClick={() => setSearched(true)}
            className="bg-purple-600 hover:bg-purple-500 text-white font-semibold"
            data-testid="button-search-staff"
          >
            <Search className="w-4 h-4 mr-1" /> Search
          </Button>
          {(searched || q) && filtered.length > 0 && (
            <Button
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10 gap-1.5"
              disabled={isExporting}
              onClick={() => {
                toast({ title: "⬇️ Preparing cards…", description: "PDF will download automatically.", duration: 3000 });
                executeExport("pvc-cr80", "portrait", undefined, setIsExporting, setExportProgress)
                  .catch(() => toast({ title: "Export failed", variant: "destructive" }));
              }}
              data-testid="button-export-staff-cards"
            >
              {isExporting
                ? <><Loader2 className="w-4 h-4 animate-spin" />{exportProgress < 100 ? `${exportProgress}%` : "Saving…"}</>
                : <><Download className="w-4 h-4" /> Export PDF</>
              }
            </Button>
          )}
        </div>
      </div>

      {/* Card grid */}
      {(searched || q) && (
        isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-white/40">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading staff…
          </div>
        ) : displayed.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
            <CreditCard className="w-10 h-10 mx-auto mb-3 text-white/20" />
            <p className="text-white/40">No staff members found matching "{q}".</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4 pt-2" id="printable-id-card-area">
            {displayed.slice(0, 20).map(s => (
              <div key={s.id} data-print-card>
                <SupportStaffIDCard staff={s} schoolName={schoolName} />
              </div>
            ))}
          </div>
        )
      )}

      {!searched && !q && !isLoading && (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
          <UserCog className="w-10 h-10 mx-auto mb-3 text-white/20" />
          <p className="text-white/40">Search for support staff to preview and print ID cards</p>
          <p className="text-white/25 text-sm mt-1">Filter by name, designation, or email</p>
        </div>
      )}
    </div>
  );
}

// ─── Root component ──────────────────────────────────────────────────────────

export default function IdCardGen({
  schoolId,
  schoolName,
  classes,
  sections,
  initialTab,
  onNavigateTab,
  allowedSubs,
}: Props) {
  const { isArchiveMode } = useSessionView();

  // Resolve valid sub-modules for this user
  const visibleMods = SUB_MODULES.filter(
    m => !allowedSubs || allowedSubs.includes(m.id),
  );

  const defaultSub: SubModule = visibleMods[0]?.id ?? "student";

  const resolveTab = (raw?: string): SubModule => {
    const candidate = raw as SubModule | undefined;
    if (candidate && visibleMods.some(m => m.id === candidate)) return candidate;
    return defaultSub;
  };

  const [active, setActive] = useState<SubModule>(() => resolveTab(initialTab));

  // Push the URL to the default sub-route on first mount when no :tab is in the URL
  useEffect(() => {
    if (!initialTab) onNavigateTab?.(active);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync when dashboard navigates to a new sub-route
  useEffect(() => {
    if (initialTab) setActive(resolveTab(initialTab));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  const switchTab = (id: SubModule) => {
    setActive(id);
    onNavigateTab?.(id);
  };

  const activeMod = SUB_MODULES.find(m => m.id === active)!;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-bold text-white">ID Card Generator</h2>
        <p className="text-white/50 text-sm">Generate and print ID cards for students, teachers, and support staff</p>
      </div>

      {/* ── Three card boxes ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {visibleMods.map(mod => {
          const Icon = mod.icon;
          const isActive = active === mod.id;
          return (
            <button
              key={mod.id}
              onClick={() => switchTab(mod.id)}
              data-testid={`tab-idcard-${mod.id}`}
              className={[
                "group relative flex flex-col items-start gap-3 rounded-2xl border-2 p-5 text-left transition-all duration-200 focus:outline-none",
                isActive
                  ? `${mod.borderClass} bg-gradient-to-br ${mod.bgClass} ${mod.glowClass}`
                  : "border-white/10 bg-[#111c2e] hover:border-white/25 hover:bg-[#152035]",
              ].join(" ")}
            >
              {/* Icon circle */}
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl transition-colors"
                style={{
                  backgroundColor: isActive ? `${mod.accentHex}22` : "rgba(255,255,255,0.06)",
                  border: `1.5px solid ${isActive ? mod.accentHex + "55" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                <Icon
                  className="w-6 h-6 transition-colors"
                  style={{ color: isActive ? mod.accentHex : "rgba(255,255,255,0.45)" }}
                />
              </div>

              {/* Text */}
              <div className="space-y-1 min-w-0">
                <p
                  className="text-sm font-bold leading-tight transition-colors"
                  style={{ color: isActive ? mod.accentHex : "rgba(255,255,255,0.85)" }}
                >
                  {mod.label}
                </p>
                <p className={`text-xs leading-snug ${isActive ? "text-white/60" : "text-white/35 group-hover:text-white/50"}`}>
                  {mod.desc}
                </p>
              </div>

              {/* Active indicator bar at bottom */}
              {isActive && (
                <span
                  className="absolute bottom-0 left-4 right-4 h-0.5 rounded-full"
                  style={{ backgroundColor: mod.accentHex }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Active module divider */}
      <div className="flex items-center gap-3">
        <activeMod.icon className={`w-4 h-4 ${activeMod.textAccent}`} />
        <span className={`text-sm font-semibold ${activeMod.textAccent}`}>{activeMod.label}</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      {/* Active panel */}
      {active === "student" && (
        <StudentPanel
          schoolId={schoolId}
          schoolName={schoolName}
          classes={classes}
          sections={sections}
          isArchiveMode={isArchiveMode}
        />
      )}
      {active === "teacher" && (
        <TeacherPanel schoolId={schoolId} schoolName={schoolName} />
      )}
      {active === "support-staff" && (
        <SupportStaffPanel schoolId={schoolId} schoolName={schoolName} />
      )}
    </div>
  );
}
