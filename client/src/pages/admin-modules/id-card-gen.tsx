import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CreditCard, Search, Printer, RefreshCw, AlertTriangle,
  GraduationCap, Users, UserCog, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, sessionFetch } from "@/lib/queryClient";
import { useSessionView } from "@/contexts/session-view-context";

// ─── Types ──────────────────────────────────────────────────────────────────

type SubModule = "student" | "teacher" | "support-staff";

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

const SUB_MODULES: { id: SubModule; label: string; icon: React.ElementType; accent: string; textAccent: string; borderClass: string; bgClass: string }[] = [
  {
    id: "student",
    label: "Student ID Cards",
    icon: GraduationCap,
    accent: "#D4AF37",
    textAccent: "text-[#D4AF37]",
    borderClass: "border-[#D4AF37]",
    bgClass: "from-[#0A1628] to-[#1A2942]",
  },
  {
    id: "teacher",
    label: "Teacher ID Cards",
    icon: Users,
    accent: "#0EA5E9",
    textAccent: "text-sky-400",
    borderClass: "border-sky-500",
    bgClass: "from-[#0A1628] to-[#0c2233]",
  },
  {
    id: "support-staff",
    label: "Support Staff ID Cards",
    icon: UserCog,
    accent: "#A855F7",
    textAccent: "text-purple-400",
    borderClass: "border-purple-500",
    bgClass: "from-[#0A1628] to-[#1a0d2e]",
  },
];

// ─── ID Card Components ──────────────────────────────────────────────────────

function StudentIDCard({
  student,
  schoolName,
  showReissueBanner,
}: {
  student: any;
  schoolName: string;
  showReissueBanner?: boolean;
}) {
  return (
    <div
      className={`w-72 rounded-xl border-2 bg-gradient-to-br from-[#0A1628] to-[#1A2942] p-5 shadow-xl relative
        ${showReissueBanner && student.idCardPendingReissue ? "border-orange-400/80" : "border-[#D4AF37]"}`}
      data-testid={`card-student-${student.id}`}
    >
      {showReissueBanner && student.idCardPendingReissue && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold shadow-lg whitespace-nowrap">
          <AlertTriangle className="w-2.5 h-2.5" /> PENDING RE-ISSUANCE
        </div>
      )}
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 border-b border-[#D4AF37]/30 pb-3">
        <div className="w-10 h-10 rounded-full bg-[#D4AF37] flex items-center justify-center text-[#0A1628] font-bold text-lg overflow-hidden shrink-0">
          {student.photoUrl
            ? <img src={student.photoUrl} alt={student.name} className="w-full h-full object-cover rounded-full" />
            : student.name?.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-[#D4AF37] text-xs font-semibold tracking-wider">BENIUS</p>
          <p className="text-white/60 text-xs truncate">{schoolName}</p>
        </div>
        <span className="ml-auto text-[9px] font-bold text-[#D4AF37]/60 bg-[#D4AF37]/10 px-1.5 py-0.5 rounded shrink-0">STUDENT</span>
      </div>
      {/* Body */}
      <div className="space-y-1.5">
        <p className="text-white font-bold text-lg leading-tight truncate">{student.name}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-white/40">DSID</p>
            <p className="text-[#D4AF37] font-mono">{student.digitalStudentId}</p>
          </div>
          <div>
            <p className="text-white/40">Class</p>
            <p className="text-white">{student.class}-{student.section}</p>
          </div>
          <div>
            <p className="text-white/40">DOB</p>
            <p className="text-white">{student.dob ? new Date(student.dob).toLocaleDateString("en-GB") : "—"}</p>
          </div>
          <div>
            <p className="text-white/40">Phone</p>
            <p className="text-white">{student.phone}</p>
          </div>
        </div>
      </div>
      {/* Footer / barcode strip */}
      <div className="mt-4 pt-3 border-t border-[#D4AF37]/30 flex items-center justify-between">
        <div className="w-16 h-8 bg-white rounded flex items-center justify-center">
          <p className="text-[#0A1628] text-[8px] font-bold font-mono">{student.digitalStudentId}</p>
        </div>
        <p className="text-white/30 text-[9px]">Academic ID</p>
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
  const [innerTab, setInnerTab] = useState<"search" | "reissue">("search");
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState(false);

  const params = new URLSearchParams();
  if (cls && cls !== "all") params.set("cls", cls);
  if (section && section !== "all") params.set("section", section);
  if (q) params.set("q", q);
  params.set("page", "1");
  if (innerTab === "reissue") params.set("pendingReissue", "true");

  const { data, isLoading } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/schools", schoolId, "students", "paginated", q, cls, section, 1, innerTab],
    queryFn: async () => {
      const r = await sessionFetch(`/api/schools/${schoolId}/students/paginated?${params}`);
      return r.ok ? r.json() : { data: [], total: 0 };
    },
    enabled: !!schoolId && (innerTab === "reissue" || searched),
    staleTime: 0,
  });

  const clearFlagMut = useMutation({
    mutationFn: async (studentIds: number[]) =>
      apiRequest("POST", "/api/admin/students/clear-reissue-flag", { studentIds }),
    onSuccess: (_data, studentIds) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students"] });
      toast({ title: "✅ Flags cleared", description: `${studentIds.length} student(s) marked as re-issued.`, duration: 3000 });
    },
    onError: () => toast({ title: "Failed to clear flags", variant: "destructive" }),
  });

  const reissueStudents = (data?.data ?? []).filter(s => s.idCardPendingReissue);

  return (
    <div className="space-y-4">
      {/* Inner tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => { setInnerTab("search"); setSearched(false); }}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${innerTab === "search" ? "bg-[#D4AF37] text-[#0A1628]" : "bg-[#1A2942] text-white/60 hover:text-white border border-white/10"}`}
          data-testid="tab-student-search"
        >
          <Search className="w-3.5 h-3.5 inline mr-1.5" />Search
        </button>
        <button
          onClick={() => setInnerTab("reissue")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors relative ${innerTab === "reissue" ? "bg-orange-500 text-white" : "bg-[#1A2942] text-orange-400 hover:text-orange-300 border border-orange-400/30"}`}
          data-testid="tab-student-reissue"
        >
          <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />Pending Re-issuance
          {(data?.total ?? 0) > 0 && innerTab === "reissue" && (
            <span className="ml-1.5 bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{data.total}</span>
          )}
        </button>
      </div>

      {/* Search controls */}
      {innerTab === "search" && (
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
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
                onClick={() => { window.print(); toast({ title: "Print dialog opened" }); }}
                data-testid="button-print-student-cards"
              >
                <Printer className="w-4 h-4 mr-1" /> Print All
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Re-issuance banner */}
      {innerTab === "reissue" && (
        <div className="rounded-xl border border-orange-400/30 bg-[#1A2942] p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-orange-300 font-semibold text-sm flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Promoted Students — ID Cards Need Re-printing
              </p>
              <p className="text-white/40 text-xs mt-0.5">
                These students were promoted to a new class. Their old ID cards show the wrong class and must be reprinted.
              </p>
            </div>
            {reissueStudents.length > 0 && (
              <Button
                onClick={() => { window.print(); toast({ title: "Print dialog opened", description: "After printing, click 'Mark All Printed' to clear the flags." }); }}
                className="bg-orange-500 hover:bg-orange-400 text-white font-semibold shrink-0"
                data-testid="button-print-reissue"
              >
                <Printer className="w-4 h-4 mr-1.5" /> Print {reissueStudents.length} Card{reissueStudents.length !== 1 ? "s" : ""}
              </Button>
            )}
            {reissueStudents.length > 0 && (
              <Button
                variant="outline"
                onClick={() => clearFlagMut.mutate(reissueStudents.map(s => s.id))}
                disabled={clearFlagMut.isPending || isArchiveMode}
                className="border-orange-400/40 text-orange-400 hover:bg-orange-400/10 shrink-0"
                data-testid="button-mark-printed"
              >
                {clearFlagMut.isPending ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                Mark All Printed
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Card grid */}
      {(innerTab === "reissue" || searched) && (
        isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-white/40">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading students…
          </div>
        ) : !data || data.data.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
            <CreditCard className="w-10 h-10 mx-auto mb-3 text-white/20" />
            {innerTab === "reissue"
              ? <p className="text-white/40">No pending re-issuances — all ID cards are up to date.</p>
              : <p className="text-white/40">No students found. Try different filters.</p>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-4 pt-2" id="print-area">
            {data.data.slice(0, 20).map(s => (
              <StudentIDCard key={s.id} student={s} schoolName={schoolName} showReissueBanner={innerTab === "reissue"} />
            ))}
          </div>
        )
      )}

      {innerTab === "search" && !searched && (
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

  const { data: teachers, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/teachers"],
    queryFn: async () => {
      const r = await fetch("/api/admin/teachers", { credentials: "include" });
      return r.ok ? r.json() : [];
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
              className="border-white/20 text-white hover:bg-white/10"
              onClick={() => { window.print(); toast({ title: "Print dialog opened" }); }}
              data-testid="button-print-teacher-cards"
            >
              <Printer className="w-4 h-4 mr-1" /> Print All
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
          <div className="flex flex-wrap gap-4 pt-2" id="print-area">
            {displayed.slice(0, 20).map(t => (
              <TeacherIDCard key={t.id} teacher={t} schoolName={schoolName} />
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
              className="border-white/20 text-white hover:bg-white/10"
              onClick={() => { window.print(); toast({ title: "Print dialog opened" }); }}
              data-testid="button-print-staff-cards"
            >
              <Printer className="w-4 h-4 mr-1" /> Print All
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
          <div className="flex flex-wrap gap-4 pt-2" id="print-area">
            {displayed.slice(0, 20).map(s => (
              <SupportStaffIDCard key={s.id} staff={s} schoolName={schoolName} />
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
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-bold text-white">ID Card Generator</h2>
        <p className="text-white/50 text-sm">Generate and print ID cards for students, teachers, and support staff</p>
      </div>

      {/* Sub-module tabs */}
      <div className="flex gap-2 flex-wrap">
        {visibleMods.map(mod => {
          const Icon = mod.icon;
          const isActive = active === mod.id;
          return (
            <button
              key={mod.id}
              onClick={() => switchTab(mod.id)}
              data-testid={`tab-idcard-${mod.id}`}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border ${
                isActive
                  ? "text-[#0A1628] shadow-lg"
                  : "bg-[#1A2942] text-white/60 hover:text-white border-white/10 hover:border-white/20"
              }`}
              style={isActive ? { backgroundColor: mod.accent, borderColor: mod.accent } : undefined}
            >
              <Icon className="w-4 h-4" />
              {mod.label}
            </button>
          );
        })}
      </div>

      {/* Divider with active sub-module label */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <activeMod.icon className={`w-4 h-4 ${activeMod.textAccent}`} />
          <span className={`text-sm font-semibold ${activeMod.textAccent}`}>{activeMod.label}</span>
        </div>
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
