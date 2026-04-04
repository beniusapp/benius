import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Trash2, Clock, Loader2, Lock, ShieldCheck, AlertTriangle,
  BookOpen, BarChart3, RefreshCw, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[] }

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

interface TimetableEntry {
  id: number; teacherId: number; schoolId: number; dayOfWeek: number;
  period: number; class: string; section: string; subject: string;
  status: string; room: string | null; teacherName: string;
}

interface TeacherAllocation {
  id: number; teacherId: number; schoolId: number; subject: string;
  class: string; section: string; weeklyQuota: number; teacherName: string;
}

interface ClassStatus {
  class: string; section: string; totalCount: number; draftCount: number; publishedCount: number;
}

export default function TimetableMaster({ schoolId, classes, sections, subjects }: Props) {
  const { toast } = useToast();

  const CLASS_LIST = classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"];
  const SECTION_LIST = sections.length > 0 ? sections : ["A","B","C","D"];
  const SUBJECT_LIST = subjects.length > 0 ? subjects : ["Math","Science","English","Hindi","Social Studies","Computer"];

  const [activeSection, setActiveSection] = useState<"allocations" | "status" | "entries">("allocations");

  // Allocation form state
  const [allocTeacher, setAllocTeacher] = useState("");
  const [allocSubject, setAllocSubject] = useState("");
  const [allocClass, setAllocClass] = useState("");
  const [allocSection, setAllocSection] = useState("");
  const [allocQuota, setAllocQuota] = useState("6");

  // Entry form state
  const [entryTeacher, setEntryTeacher] = useState("");
  const [entryDay, setEntryDay] = useState("");
  const [entryPeriod, setEntryPeriod] = useState("");
  const [entryClass, setEntryClass] = useState("");
  const [entrySection, setEntrySection] = useState("");
  const [entrySubject, setEntrySubject] = useState("");
  const [entryRoom, setEntryRoom] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const { data: teachers = [] } = useQuery<{ id: number; fullName: string }[]>({
    queryKey: ["/api/schools", schoolId, "teachers"],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/teachers`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery<TimetableEntry[]>({
    queryKey: ["/api/timetable/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: allocations = [], isLoading: allocLoading } = useQuery<TeacherAllocation[]>({
    queryKey: ["/api/teacher-allocations"],
    queryFn: async () => {
      const r = await fetch("/api/teacher-allocations", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const { data: classStatuses = [], isLoading: statusLoading } = useQuery<ClassStatus[]>({
    queryKey: ["/api/timetable/class-status"],
    queryFn: async () => {
      const r = await fetch("/api/timetable/class-status", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const createAllocMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/teacher-allocations", {
        teacherId: allocTeacher, subject: allocSubject,
        class: allocClass, section: allocSection, weeklyQuota: parseInt(allocQuota),
      });
    },
    onSuccess: () => {
      toast({ title: "Allocation Created", description: `${allocSubject} for Class ${allocClass}-${allocSection} assigned.` });
      setAllocTeacher(""); setAllocSubject(""); setAllocClass(""); setAllocSection(""); setAllocQuota("6");
      queryClient.invalidateQueries({ queryKey: ["/api/teacher-allocations"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteAllocMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/teacher-allocations/${id}`); },
    onSuccess: () => {
      toast({ title: "Allocation Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher-allocations"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addEntryMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/timetable", {
        teacherId: entryTeacher, schoolId, dayOfWeek: entryDay,
        period: entryPeriod, class: entryClass, section: entrySection, subject: entrySubject,
      });
    },
    onSuccess: () => {
      toast({ title: "Timetable Entry Added" });
      setEntryDay(""); setEntryPeriod(""); setEntryClass(""); setEntrySection(""); setEntrySubject(""); setEntryRoom("");
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/school", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/class-status"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteEntryMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/timetable/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/school", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/class-status"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: async ({ cls, sec }: { cls: string; sec: string }) => {
      await apiRequest("PATCH", "/api/timetable/publish", { class: cls, section: sec });
    },
    onSuccess: (_, vars) => {
      toast({ title: "Published!", description: `Class ${vars.cls}-${vars.sec} timetable is now live for students.` });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/school", schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/class-status"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = entries.filter(e =>
    (!filterDay || String(e.dayOfWeek) === filterDay) &&
    (!filterClass || e.class === filterClass) &&
    (!filterStatus || e.status === filterStatus)
  );

  const sectionTabs = [
    { id: "allocations" as const, label: "Allocation Engine", icon: BookOpen },
    { id: "status" as const, label: "Class Status", icon: BarChart3 },
    { id: "entries" as const, label: "All Entries", icon: Clock },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Lock className="w-4 h-4 text-[#D4AF37]" />
          <h2 className="text-xl font-bold text-white">Timetable Master</h2>
        </div>
        <p className="text-white/50 text-sm">{entries.length} entries · {allocations.length} allocations · School-isolated</p>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#0A1628] border border-white/10">
        {sectionTabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                activeSection === tab.id
                  ? "bg-[#D4AF37] text-[#0A1628]"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── SECTION 1: ALLOCATION ENGINE ── */}
      {activeSection === "allocations" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
            <h3 className="font-semibold text-white flex items-center gap-2 mb-4">
              <BookOpen className="w-4 h-4 text-[#D4AF37]" />
              Assign Teacher Allocation
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Teacher</label>
                <Select value={allocTeacher} onValueChange={setAllocTeacher}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-alloc-teacher">
                    <SelectValue placeholder="Select teacher" />
                  </SelectTrigger>
                  <SelectContent>
                    {teachers.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.fullName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Subject</label>
                <Select value={allocSubject} onValueChange={setAllocSubject}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-alloc-subject">
                    <SelectValue placeholder="Subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBJECT_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Class</label>
                <Select value={allocClass} onValueChange={setAllocClass}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-alloc-class">
                    <SelectValue placeholder="Class" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASS_LIST.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Section</label>
                <Select value={allocSection} onValueChange={setAllocSection}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-alloc-section">
                    <SelectValue placeholder="Section" />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTION_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Weekly Quota (periods)</label>
                <Select value={allocQuota} onValueChange={setAllocQuota}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-alloc-quota">
                    <SelectValue placeholder="Quota" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1,2,3,4,5,6,7,8,9,10,12].map(n => <SelectItem key={n} value={String(n)}>{n} periods/week</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  disabled={!allocTeacher || !allocSubject || !allocClass || !allocSection || createAllocMutation.isPending}
                  onClick={() => createAllocMutation.mutate()}
                  className="w-full bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
                  data-testid="button-create-allocation"
                >
                  {createAllocMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" />Allocate</>}
                </Button>
              </div>
            </div>
          </div>

          {/* Allocation List */}
          <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-xs font-semibold text-white/50 uppercase tracking-wide">Current Allocations</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-[#0F1E35]">
                <tr>
                  {["Teacher","Subject","Class","Section","Quota",""].map(h => (
                    <th key={h} className="text-left py-2.5 px-4 text-white/50 font-medium text-xs uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allocLoading ? (
                  <tr><td colSpan={6} className="py-10 text-center text-white/40"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                ) : allocations.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-white/40">No allocations yet. Assign teachers above.</td></tr>
                ) : allocations.map(a => (
                  <tr key={a.id} className="border-b border-white/5 hover:bg-white/5" data-testid={`row-alloc-${a.id}`}>
                    <td className="py-2.5 px-4 text-white/80 text-xs">{a.teacherName}</td>
                    <td className="py-2.5 px-4 text-[#D4AF37] text-xs">{a.subject}</td>
                    <td className="py-2.5 px-4 text-white/60 text-xs">{a.class}</td>
                    <td className="py-2.5 px-4 text-white/60 text-xs">{a.section}</td>
                    <td className="py-2.5 px-4 text-white/60 text-xs">{a.weeklyQuota}/wk</td>
                    <td className="py-2.5 px-4">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:bg-red-500/10"
                        onClick={() => deleteAllocMutation.mutate(a.id)} data-testid={`button-delete-alloc-${a.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SECTION 2: CLASS STATUS GRID ── */}
      {activeSection === "status" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-white/50">
              <span className="w-3 h-3 rounded-full bg-orange-500 inline-block" />Draft slots
            </div>
            <div className="flex items-center gap-1.5 text-xs text-white/50">
              <span className="w-3 h-3 rounded-full bg-[#10b981] inline-block" />Fully Published
            </div>
          </div>

          {statusLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-[#D4AF37]" /></div>
          ) : classStatuses.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#1A2942] p-10 text-center text-white/40">
              No timetable entries yet. Add entries in the "All Entries" tab.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {classStatuses.map(cs => {
                const allPublished = cs.totalCount > 0 && cs.draftCount === 0;
                const hasEntries = cs.totalCount > 0;
                return (
                  <div
                    key={`${cs.class}-${cs.section}`}
                    className={`rounded-xl border p-4 ${allPublished ? "border-emerald-500/30 bg-emerald-900/10" : "border-orange-500/30 bg-orange-900/10"}`}
                    data-testid={`card-class-status-${cs.class}-${cs.section}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-white font-bold text-sm">Class {cs.class} – {cs.section}</p>
                        <p className="text-white/40 text-xs mt-0.5">{cs.totalCount} total periods</p>
                      </div>
                      {allPublished ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-900/30 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                          <ShieldCheck className="w-3 h-3" />Published
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-orange-400 bg-orange-900/30 border border-orange-500/30 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" />Draft
                        </span>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 rounded-full bg-white/10 mb-3 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#10b981] transition-all duration-500"
                        style={{ width: cs.totalCount > 0 ? `${(cs.publishedCount / cs.totalCount) * 100}%` : "0%" }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-white/50 mb-3">
                      <span>{cs.publishedCount} published · {cs.draftCount} draft</span>
                    </div>

                    {hasEntries && cs.draftCount > 0 && (
                      <Button
                        size="sm"
                        className="w-full bg-[#10b981] hover:bg-[#059669] text-white text-xs font-semibold"
                        onClick={() => publishMutation.mutate({ cls: cs.class, sec: cs.section })}
                        disabled={publishMutation.isPending}
                        data-testid={`button-publish-${cs.class}-${cs.section}`}
                      >
                        {publishMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        )}
                        Publish All for {cs.class}-{cs.section}
                      </Button>
                    )}
                    {allPublished && (
                      <p className="text-center text-xs text-emerald-400/70 mt-1">
                        ✓ Students can see this timetable
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SECTION 3: ALL ENTRIES ── */}
      {activeSection === "entries" && (
        <div className="space-y-4">
          {/* Add Entry Form */}
          <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
            <h3 className="font-semibold text-white flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-[#D4AF37]" />
              Add Timetable Entry (Admin)
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-white/60 mb-1">Teacher</label>
                <Select value={entryTeacher} onValueChange={setEntryTeacher}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-teacher">
                    <SelectValue placeholder="Select teacher" />
                  </SelectTrigger>
                  <SelectContent>{teachers.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Day</label>
                <Select value={entryDay} onValueChange={setEntryDay}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-day">
                    <SelectValue placeholder="Day" />
                  </SelectTrigger>
                  <SelectContent>{DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Period</label>
                <Select value={entryPeriod} onValueChange={setEntryPeriod}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-period">
                    <SelectValue placeholder="Period" />
                  </SelectTrigger>
                  <SelectContent>{PERIODS.map(p => <SelectItem key={p} value={String(p)}>Period {p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Class</label>
                <Select value={entryClass} onValueChange={setEntryClass}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-class">
                    <SelectValue placeholder="Class" />
                  </SelectTrigger>
                  <SelectContent>{CLASS_LIST.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Section</label>
                <Select value={entrySection} onValueChange={setEntrySection}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-section">
                    <SelectValue placeholder="Section" />
                  </SelectTrigger>
                  <SelectContent>{SECTION_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs text-white/60 mb-1">Subject</label>
                <Select value={entrySubject} onValueChange={setEntrySubject}>
                  <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-subject">
                    <SelectValue placeholder="Subject" />
                  </SelectTrigger>
                  <SelectContent>{SUBJECT_LIST.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2 md:col-span-3">
                <Button
                  disabled={!entryTeacher || !entryDay || !entryPeriod || !entryClass || !entrySection || !entrySubject || addEntryMutation.isPending}
                  onClick={() => addEntryMutation.mutate()}
                  className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold"
                  data-testid="button-add-timetable"
                >
                  {addEntryMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" />Add Entry</>}
                </Button>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <Select value={filterDay} onValueChange={v => setFilterDay(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-day">
                <SelectValue placeholder="All Days" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Days</SelectItem>
                {DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterClass} onValueChange={v => setFilterClass(v === "all" ? "" : v)}>
              <SelectTrigger className="w-32 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-tt-class">
                <SelectValue placeholder="All Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {CLASS_LIST.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft Only</SelectItem>
                <SelectItem value="published">Published Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Entries Table */}
          <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#0F1E35]">
                <tr>
                  {["Status","Teacher","Day","Period","Class","Section","Subject",""].map(h => (
                    <th key={h} className="text-left py-2.5 px-3 text-white/50 font-medium text-xs uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entriesLoading ? (
                  <tr><td colSpan={8} className="py-12 text-center text-white/40"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-white/40">No timetable entries</td></tr>
                ) : filtered.map(e => (
                  <tr key={e.id} className="border-b border-white/5 hover:bg-white/5" data-testid={`row-tt-${e.id}`}>
                    <td className="py-2.5 px-3">
                      {e.status === "published" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-emerald-400 bg-emerald-900/30 border border-emerald-500/30">
                          <ShieldCheck className="w-3 h-3" />Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-orange-400 bg-orange-900/30 border border-orange-500/30">
                          <AlertTriangle className="w-3 h-3" />Draft
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-white/80 text-xs">{e.teacherName}</td>
                    <td className="py-2.5 px-3 text-white/60 text-xs">{DAY_NAMES[e.dayOfWeek]}</td>
                    <td className="py-2.5 px-3 text-[#D4AF37] text-xs">P{e.period}</td>
                    <td className="py-2.5 px-3 text-white/60 text-xs">{e.class}</td>
                    <td className="py-2.5 px-3 text-white/60 text-xs">{e.section}</td>
                    <td className="py-2.5 px-3 text-white/80 text-xs">{e.subject}</td>
                    <td className="py-2.5 px-3">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:bg-red-500/10"
                        onClick={() => deleteEntryMutation.mutate(e.id)} data-testid={`button-delete-tt-${e.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
