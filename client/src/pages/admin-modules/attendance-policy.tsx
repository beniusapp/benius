import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Timer, ToggleLeft, ToggleRight, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── Types ────────────────────────────────────────────────────────────────────

interface PolicyForm {
  policyName: string;
  expectedArrivalTime: string;
  gracePeriodMinutes: number;
  halfDayCutoffTime: string;
  attendanceTarget: number;
  isActive: boolean;
  applicableClasses: string[];
}

interface ServerPolicy {
  id: number;
  schoolId: number;
  targetRole: "TEACHER" | "STUDENT";
  policyName: string;
  applicableClasses: string[];
  expectedArrivalTime: string;
  gracePeriodMinutes: number;
  halfDayCutoffTime: string;
  attendanceTarget: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

function defaultForm(): PolicyForm {
  return {
    policyName: "",
    expectedArrivalTime: "09:00",
    gracePeriodMinutes: 0,
    halfDayCutoffTime: "12:00",
    attendanceTarget: 85,
    isActive: true,
    applicableClasses: [],
  };
}

function serverToForm(p: ServerPolicy): PolicyForm {
  return {
    policyName: p.policyName,
    expectedArrivalTime: p.expectedArrivalTime,
    gracePeriodMinutes: p.gracePeriodMinutes,
    halfDayCutoffTime: p.halfDayCutoffTime,
    attendanceTarget: p.attendanceTarget,
    isActive: p.isActive,
    applicableClasses: p.applicableClasses,
  };
}

// ── Status preview helper ─────────────────────────────────────────────────────

function previewRows(form: PolicyForm) {
  const [arrH, arrM] = form.expectedArrivalTime.split(":").map(Number);
  const [halfH, halfM] = form.halfDayCutoffTime.split(":").map(Number);
  const arrMin = arrH * 60 + (arrM ?? 0);
  const halfMin = halfH * 60 + (halfM ?? 0);
  const grace = form.gracePeriodMinutes;

  const samples: Array<{ label: string; minutes: number }> = [
    { label: `Before ${form.expectedArrivalTime}`, minutes: arrMin - 10 },
    { label: form.expectedArrivalTime, minutes: arrMin },
    ...(grace > 0 ? [{ label: `+${grace}m grace limit`, minutes: arrMin + grace }] : []),
    { label: "After grace", minutes: arrMin + grace + 5 },
    { label: `${form.halfDayCutoffTime} (half-day cutoff)`, minutes: halfMin },
    { label: `After ${form.halfDayCutoffTime}`, minutes: halfMin + 5 },
  ].filter(s => s.minutes >= 0);

  return samples.map(s => {
    let status: string;
    let color: string;
    if (s.minutes <= arrMin + grace)  { status = "Present";  color = "text-emerald-400"; }
    else if (s.minutes <= halfMin)    { status = "Late";     color = "text-amber-400";   }
    else                              { status = "Half Day"; color = "text-orange-400";  }
    const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
    return { label: s.label, time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, status, color };
  });
}

// ── PolicySection (fully self-contained per role) ─────────────────────────────

interface PolicySectionProps {
  role: "TEACHER" | "STUDENT";
  serverPolicy: ServerPolicy | null;
  isLoaded: boolean;
  classes: string[];
}

function PolicySection({ role, serverPolicy, isLoaded, classes }: PolicySectionProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<PolicyForm>(defaultForm);
  const [savedId, setSavedId] = useState<number | null>(null);
  const hasSynced = useRef(false);

  // Sync from server once when data first becomes available — never overwrites
  // user edits made after that initial load
  useEffect(() => {
    if (!isLoaded || hasSynced.current) return;
    hasSynced.current = true;
    if (serverPolicy) {
      setForm(serverToForm(serverPolicy));
      setSavedId(serverPolicy.id);
    }
  }, [isLoaded, serverPolicy]);

  const isTeacher = role === "TEACHER";
  const accent      = isTeacher ? "#38bdf8" : "#34d399";
  const headerBg    = isTeacher ? "border-sky-500/20 bg-sky-500/5"    : "border-emerald-500/20 bg-emerald-500/5";
  const iconBg      = isTeacher ? "bg-sky-500/15"                     : "bg-emerald-500/15";
  const iconColor   = isTeacher ? "text-sky-300"                      : "text-emerald-300";
  const chipSel     = isTeacher ? "bg-sky-500/20 border-sky-500/40 text-sky-300"     : "bg-emerald-500/20 border-emerald-500/40 text-emerald-300";
  const previewBdr  = isTeacher ? "border-sky-500/15 bg-sky-500/5"   : "border-emerald-500/15 bg-emerald-500/5";
  const saveBg      = isTeacher ? "bg-sky-500 hover:bg-sky-600"       : "bg-emerald-500 hover:bg-emerald-600";

  function patch(p: Partial<PolicyForm>) {
    setForm(prev => ({ ...prev, ...p }));
  }

  function toggleClass(cls: string) {
    setForm(prev => {
      const has = prev.applicableClasses.includes(cls);
      return {
        ...prev,
        applicableClasses: has
          ? prev.applicableClasses.filter(c => c !== cls)
          : [...prev.applicableClasses, cls],
      };
    });
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = { targetRole: role, ...form };
      if (savedId) {
        const r = await apiRequest("PUT", `/api/admin/attendance-policies/${savedId}`, body);
        return r.json() as Promise<ServerPolicy>;
      } else {
        const r = await apiRequest("POST", "/api/admin/attendance-policies", body);
        return r.json() as Promise<ServerPolicy>;
      }
    },
    onSuccess: (saved: ServerPolicy) => {
      // Re-sync local form from exactly what the server stored
      // — this ensures applicableClasses and all fields reflect the saved state
      setForm(serverToForm(saved));
      setSavedId(saved.id);
      // Invalidate admin list
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance-policies"] });
      // Invalidate the role-specific attendance-policy cache so teacher / student
      // modules pick up the new thresholds without waiting for staleTime
      if (role === "TEACHER") {
        queryClient.invalidateQueries({ queryKey: ["/api/teacher/attendance-policy"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/student/attendance-policy"] });
      }
      toast({ title: savedId ? `${isTeacher ? "Teacher" : "Student"} policy updated` : `${isTeacher ? "Teacher" : "Student"} policy created` });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const rows = previewRows(form);

  return (
    <div
      className={`rounded-2xl border ${headerBg} bg-[#1A2942] overflow-hidden`}
      data-testid={`policy-section-${role.toLowerCase()}`}
    >
      {/* ── Section header ── */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
        <div className={`p-2 rounded-lg ${iconBg}`}>
          <Timer className={`w-4 h-4 ${iconColor}`} />
        </div>
        <div className="flex-1">
          <h3 className="text-white font-semibold text-sm">
            {isTeacher ? "Teacher" : "Student"} Attendance Policy
          </h3>
          <p className="text-white/35 text-xs mt-0.5">
            {isTeacher
              ? "Controls Present / Late / Half-Day thresholds for teacher check-in."
              : "Controls arrival target and attendance goal for students."}
          </p>
        </div>
        {savedId && (
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
            form.isActive
              ? isTeacher
                ? "bg-sky-500/15 border-sky-500/20 text-sky-300"
                : "bg-emerald-500/15 border-emerald-500/20 text-emerald-300"
              : "bg-white/5 border-white/10 text-white/30"
          }`}>
            {form.isActive ? "Active" : "Inactive"}
          </span>
        )}
      </div>

      {/* ── Form body ── */}
      <div className="p-5 space-y-5">

        {/* Policy name */}
        <div>
          <label className="text-xs font-medium text-white/60 mb-1 block">Policy Name</label>
          <Input
            value={form.policyName}
            onChange={e => patch({ policyName: e.target.value })}
            placeholder={isTeacher ? "e.g. Standard Teacher Policy" : "e.g. Standard Student Policy"}
            className="bg-[#0A1628] border-white/10 text-white text-sm h-9 placeholder:text-white/20"
            data-testid={`input-policy-name-${role.toLowerCase()}`}
          />
        </div>

        {/* Timing grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-white/60 mb-1 block">Expected Arrival (IST)</label>
            <Input
              type="time"
              value={form.expectedArrivalTime}
              onChange={e => patch({ expectedArrivalTime: e.target.value })}
              className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
              data-testid={`input-arrival-${role.toLowerCase()}`}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-white/60 mb-1 block">Grace Period (minutes)</label>
            <Input
              type="number" min={0} max={120}
              value={form.gracePeriodMinutes}
              onChange={e => patch({ gracePeriodMinutes: parseInt(e.target.value) || 0 })}
              placeholder="0"
              className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
              data-testid={`input-grace-${role.toLowerCase()}`}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-white/60 mb-1 block">Half-Day Cutoff (IST)</label>
            <Input
              type="time"
              value={form.halfDayCutoffTime}
              onChange={e => patch({ halfDayCutoffTime: e.target.value })}
              className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
              data-testid={`input-halfday-${role.toLowerCase()}`}
            />
          </div>
        </div>

        {/* Attendance target + active toggle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-white/60 mb-1 block">
              Attendance Target:{" "}
              <span style={{ color: accent }} className="font-bold">{form.attendanceTarget}%</span>
            </label>
            <input
              type="range" min={50} max={100} step={1}
              value={form.attendanceTarget}
              onChange={e => patch({ attendanceTarget: parseInt(e.target.value) })}
              className="w-full"
              style={{ accentColor: accent }}
              data-testid={`slider-target-${role.toLowerCase()}`}
            />
            <div className="flex justify-between text-xs text-white/20 mt-0.5">
              <span>50%</span><span>75%</span><span>100%</span>
            </div>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => patch({ isActive: !form.isActive })}
              className="flex items-center gap-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
              data-testid={`toggle-active-${role.toLowerCase()}`}
            >
              {form.isActive
                ? <ToggleRight className="w-8 h-8 text-emerald-400" />
                : <ToggleLeft className="w-8 h-8 text-white/20" />}
              {form.isActive ? "Policy Active" : "Policy Inactive"}
            </button>
          </div>
        </div>

        {/* Applicable classes */}
        <div>
          <label className="text-xs font-medium text-white/60 mb-2 block">
            Applicable Classes
            <span className="ml-1 text-white/30 font-normal">(leave empty for all classes)</span>
          </label>
          {classes.length === 0 ? (
            <p className="text-white/25 text-xs italic">No classes configured in School Setup yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {classes.map(cls => {
                const selected = form.applicableClasses.includes(cls);
                return (
                  <button
                    key={cls}
                    onClick={() => toggleClass(cls)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      selected ? chipSel : "bg-white/5 border-white/10 text-white/35 hover:bg-white/10"
                    }`}
                    data-testid={`chip-class-${cls}-${role.toLowerCase()}`}
                  >
                    {selected && <Check className="w-3 h-3 inline mr-1" />}
                    {cls}
                  </button>
                );
              })}
              {form.applicableClasses.length > 0 && (
                <button
                  onClick={() => patch({ applicableClasses: [] })}
                  className="px-2 py-1.5 rounded-lg text-xs text-white/30 hover:text-white/60 border border-white/5 transition-colors"
                  data-testid={`btn-clear-classes-${role.toLowerCase()}`}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          {classes.length > 0 && form.applicableClasses.length === 0 && (
            <p className="text-white/25 text-xs mt-1.5">This policy applies to all classes (school-wide).</p>
          )}
        </div>

        {/* Live status preview */}
        <div className={`rounded-xl border p-3 ${previewBdr}`}>
          <p className="text-xs text-white/35 mb-2 uppercase tracking-wider font-medium">Status Preview</p>
          <div className="flex flex-wrap gap-2">
            {rows.map((row, ri) => (
              <div key={ri} className="rounded-lg bg-white/5 px-3 py-2 text-center min-w-[90px]">
                <p className="text-xs text-white/30 leading-tight">{row.label}</p>
                <p className={`text-xs font-bold ${row.color} mt-1`}>{row.status}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Save button */}
        <div>
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!form.policyName.trim() || saveMut.isPending}
            className={`${saveBg} text-white h-9 font-semibold px-6`}
            data-testid={`btn-save-policy-${role.toLowerCase()}`}
          >
            {saveMut.isPending ? "Saving…" : savedId ? "Save Changes" : "Create Policy"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AttendancePolicySetup({ schoolId }: { schoolId: number }) {
  const { data: adminConfig } = useQuery<{ classes: string[] }>({
    queryKey: ["/api/admin/school-config"],
    queryFn: async () => {
      const r = await fetch("/api/admin/school-config", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load school config");
      return r.json();
    },
    enabled: !!schoolId,
  });
  const classes = adminConfig?.classes ?? [];

  const { isLoading, data: serverPolicies } = useQuery<ServerPolicy[]>({
    queryKey: ["/api/admin/attendance-policies", schoolId],
    queryFn: async () => {
      const r = await fetch("/api/admin/attendance-policies", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!schoolId,
  });

  const isLoaded = !isLoading && serverPolicies !== undefined;
  const teacherPolicy = serverPolicies?.find(p => p.targetRole === "TEACHER") ?? null;
  const studentPolicy = serverPolicies?.find(p => p.targetRole === "STUDENT") ?? null;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => <div key={i} className="h-48 rounded-2xl bg-white/5 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-white/40 text-xs">
        Set time-based rules for teacher and student attendance. Each group has its own independent configuration — changes to one do not affect the other.
      </p>

      {/* Teacher section — top */}
      <PolicySection
        role="TEACHER"
        serverPolicy={teacherPolicy}
        isLoaded={isLoaded}
        classes={classes}
      />

      {/* Student section — bottom */}
      <PolicySection
        role="STUDENT"
        serverPolicy={studentPolicy}
        isLoaded={isLoaded}
        classes={classes}
      />

      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
        <p className="text-xs text-white/25">
          <span className="text-white/40 font-medium">System Default</span> — if no policy is saved for a role, the system falls back to: arrival 09:00, 0 min grace, half-day after 12:00, 85% target.
        </p>
      </div>
    </div>
  );
}
