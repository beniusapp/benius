import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Timer, ChevronDown, ChevronUp, ToggleLeft, ToggleRight, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSchoolConfig } from "@/hooks/use-school-config";

interface AttendancePolicy {
  id?: number;
  schoolId?: number;
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
  // ui-only
  editing?: boolean;
  expanded?: boolean;
}

function emptyPolicy(): AttendancePolicy {
  return {
    targetRole: "TEACHER",
    policyName: "",
    applicableClasses: [],
    expectedArrivalTime: "09:00",
    gracePeriodMinutes: 0,
    halfDayCutoffTime: "12:00",
    attendanceTarget: 85,
    isActive: true,
    editing: true,
    expanded: true,
  };
}

/** Compute preview rows: what status at a sample of times */
function previewRows(policy: AttendancePolicy) {
  const [arrH, arrM] = policy.expectedArrivalTime.split(":").map(Number);
  const [halfH, halfM] = policy.halfDayCutoffTime.split(":").map(Number);
  const arrMin = arrH * 60 + (arrM ?? 0);
  const halfMin = halfH * 60 + (halfM ?? 0);
  const grace = policy.gracePeriodMinutes;

  const samples: Array<{ label: string; minutes: number }> = [
    { label: `Before ${policy.expectedArrivalTime}`, minutes: arrMin - 10 },
    { label: policy.expectedArrivalTime, minutes: arrMin },
    ...(grace > 0 ? [{ label: `+${grace}m grace limit`, minutes: arrMin + grace }] : []),
    { label: `After grace`, minutes: arrMin + grace + 5 },
    { label: `${policy.halfDayCutoffTime} (half-day cutoff)`, minutes: halfMin },
    { label: `After ${policy.halfDayCutoffTime}`, minutes: halfMin + 5 },
  ].filter(s => s.minutes >= 0);

  return samples.map(s => {
    let status: string;
    let color: string;
    if (s.minutes <= arrMin + grace) { status = "Present"; color = "text-emerald-400"; }
    else if (s.minutes <= halfMin)   { status = "Late";    color = "text-amber-400";   }
    else                              { status = "Half Day"; color = "text-orange-400"; }
    const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
    return { label: s.label, time: `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`, status, color };
  });
}

export function AttendancePolicySetup({ schoolId }: { schoolId: number }) {
  const { toast } = useToast();
  const { classes } = useSchoolConfig(schoolId);
  const [policies, setPolicies] = useState<AttendancePolicy[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [previewFor, setPreviewFor] = useState<number | null>(null);

  const { isLoading, data: serverPolicies } = useQuery<AttendancePolicy[]>({
    queryKey: ["/api/admin/attendance-policies", schoolId],
    queryFn: async () => {
      const r = await fetch("/api/admin/attendance-policies", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!schoolId,
  });

  // Seed local state once from server data
  if (!loaded && serverPolicies) {
    setPolicies(serverPolicies.map(p => ({ ...p, editing: false, expanded: false })));
    setLoaded(true);
  }

  const saveMut = useMutation({
    mutationFn: async (p: AttendancePolicy) => {
      const body = {
        targetRole: p.targetRole, policyName: p.policyName,
        applicableClasses: p.applicableClasses,
        expectedArrivalTime: p.expectedArrivalTime,
        gracePeriodMinutes: p.gracePeriodMinutes,
        halfDayCutoffTime: p.halfDayCutoffTime,
        attendanceTarget: p.attendanceTarget,
        isActive: p.isActive,
      };
      if (p.id) {
        const r = await apiRequest("PUT", `/api/admin/attendance-policies/${p.id}`, body);
        return r.json();
      } else {
        const r = await apiRequest("POST", "/api/admin/attendance-policies", body);
        return r.json();
      }
    },
    onSuccess: (saved: AttendancePolicy, vars: AttendancePolicy) => {
      setPolicies(prev => prev.map(p => p === vars ? { ...saved, editing: false, expanded: false } : p));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance-policies"] });
      toast({ title: vars.id ? "Policy updated" : "Policy created" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/attendance-policies/${id}`, undefined);
    },
    onSuccess: (_: unknown, id: number) => {
      setPolicies(prev => prev.filter(p => p.id !== id));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance-policies"] });
      toast({ title: "Policy deleted" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  function update(idx: number, patch: Partial<AttendancePolicy>) {
    setPolicies(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }

  function toggleClass(idx: number, cls: string) {
    setPolicies(prev => prev.map((p, i) => {
      if (i !== idx) return p;
      const has = p.applicableClasses.includes(cls);
      return { ...p, applicableClasses: has ? p.applicableClasses.filter(c => c !== cls) : [...p.applicableClasses, cls] };
    }));
  }

  if (isLoading && !loaded) {
    return <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-4">

      {/* Header row */}
      <div className="flex items-center gap-3">
        <p className="text-white/40 text-xs flex-1">
          Set time-based rules for teacher and student attendance. Rules apply per class or school-wide.
        </p>
        <Button
          size="sm"
          onClick={() => setPolicies(prev => [...prev, emptyPolicy()])}
          className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-semibold h-9 shrink-0"
          data-testid="btn-add-attendance-policy"
        >
          <Plus className="w-4 h-4 mr-1" /> Add Policy
        </Button>
      </div>

      {/* Empty state */}
      {policies.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-10 text-center">
          <Timer className="w-8 h-8 mx-auto mb-2 text-white/20" />
          <p className="text-white/40 text-sm">No attendance policies configured yet.</p>
          <p className="text-white/25 text-xs mt-1">Click "Add Policy" to create your first rule (e.g. "Teachers — 09:00 arrival, 15 min grace").</p>
        </div>
      )}

      {/* Policy cards */}
      <div className="space-y-3">
        {policies.map((policy, idx) => (
          <div
            key={policy.id ?? `new-${idx}`}
            className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden"
            data-testid={`attendance-policy-card-${idx}`}
          >
            {!policy.editing ? (
              /* ── View mode ── */
              <div>
                <div className="flex items-center gap-3 px-5 py-4">
                  <div className="p-2 rounded-lg bg-[#8b5cf6]/10 flex-shrink-0">
                    <Timer className="w-4 h-4 text-[#8b5cf6]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white text-sm">{policy.policyName}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        policy.targetRole === "TEACHER"
                          ? "bg-sky-500/15 text-sky-300"
                          : "bg-emerald-500/15 text-emerald-300"
                      }`}>
                        {policy.targetRole === "TEACHER" ? "Teachers" : "Students"}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        policy.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/30"
                      }`}>
                        {policy.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="text-white/40 text-xs mt-0.5">
                      Arrival {policy.expectedArrivalTime}
                      {policy.gracePeriodMinutes > 0 ? ` · ${policy.gracePeriodMinutes}m grace` : ""}
                      {policy.targetRole === "TEACHER" ? ` · Half-day after ${policy.halfDayCutoffTime}` : ""}
                      {" · "}Target {policy.attendanceTarget}%
                      {policy.applicableClasses.length > 0
                        ? ` · Classes: ${policy.applicableClasses.join(", ")}`
                        : " · All classes"}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setPreviewFor(previewFor === idx ? null : idx)}
                      className="text-[#8b5cf6] hover:text-[#a78bfa] transition-colors h-8 px-2 text-xs font-medium"
                      data-testid={`btn-preview-policy-${idx}`}
                    >
                      {previewFor === idx ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => update(idx, { editing: true, expanded: true })}
                      className="text-white/50 hover:text-white h-8 text-xs"
                      data-testid={`btn-edit-policy-${idx}`}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => { if (policy.id) deleteMut.mutate(policy.id); else setPolicies(p => p.filter((_,i) => i !== idx)); }}
                      className="text-red-400/60 hover:text-red-400 h-8"
                      data-testid={`btn-delete-policy-${idx}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Preview table */}
                {previewFor === idx && (
                  <div className="border-t border-white/5 px-5 py-3">
                    <p className="text-xs text-white/35 mb-2 uppercase tracking-wider font-medium">Status Preview</p>
                    <div className="grid grid-cols-3 gap-2">
                      {previewRows(policy).map((row, ri) => (
                        <div key={ri} className="rounded-lg bg-white/5 px-3 py-2">
                          <p className="text-xs text-white/30 leading-tight">{row.label}</p>
                          <p className="text-sm font-bold text-white/70 tabular-nums">{row.time}</p>
                          <p className={`text-xs font-semibold ${row.color}`}>{row.status}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* ── Edit mode ── */
              <div className="p-5 space-y-4">

                {/* Row 1: name + role */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Policy Name</label>
                    <Input
                      value={policy.policyName}
                      onChange={e => update(idx, { policyName: e.target.value })}
                      placeholder="e.g. Standard Teacher Policy"
                      className="bg-[#0A1628] border-white/10 text-white text-sm h-9 placeholder:text-white/20"
                      data-testid={`input-policy-name-${idx}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Applies To</label>
                    <div className="flex gap-2">
                      {(["TEACHER", "STUDENT"] as const).map(role => (
                        <button
                          key={role}
                          onClick={() => update(idx, { targetRole: role })}
                          className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-all border ${
                            policy.targetRole === role
                              ? "bg-[#8b5cf6] border-[#8b5cf6] text-white"
                              : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                          }`}
                          data-testid={`btn-role-${role.toLowerCase()}-${idx}`}
                        >
                          {role === "TEACHER" ? "Teachers" : "Students"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Row 2: timing */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Expected Arrival (IST)</label>
                    <Input
                      type="time"
                      value={policy.expectedArrivalTime}
                      onChange={e => update(idx, { expectedArrivalTime: e.target.value })}
                      className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                      data-testid={`input-arrival-time-${idx}`}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">Grace Period (minutes)</label>
                    <Input
                      type="number" min={0} max={120} value={policy.gracePeriodMinutes}
                      onChange={e => update(idx, { gracePeriodMinutes: parseInt(e.target.value) || 0 })}
                      placeholder="0"
                      className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                      data-testid={`input-grace-${idx}`}
                    />
                  </div>
                  {policy.targetRole === "TEACHER" && (
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">Half-Day Cutoff (IST)</label>
                      <Input
                        type="time"
                        value={policy.halfDayCutoffTime}
                        onChange={e => update(idx, { halfDayCutoffTime: e.target.value })}
                        className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                        data-testid={`input-halfday-cutoff-${idx}`}
                      />
                    </div>
                  )}
                </div>

                {/* Row 3: target % + active toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-white/60 mb-1 block">
                      Attendance Target: <span className="text-[#8b5cf6] font-bold">{policy.attendanceTarget}%</span>
                    </label>
                    <input
                      type="range" min={50} max={100} step={1}
                      value={policy.attendanceTarget}
                      onChange={e => update(idx, { attendanceTarget: parseInt(e.target.value) })}
                      className="w-full accent-[#8b5cf6]"
                      data-testid={`slider-target-${idx}`}
                    />
                    <div className="flex justify-between text-xs text-white/20 mt-0.5">
                      <span>50%</span><span>75%</span><span>100%</span>
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() => update(idx, { isActive: !policy.isActive })}
                      className="flex items-center gap-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
                      data-testid={`toggle-active-${idx}`}
                    >
                      {policy.isActive
                        ? <ToggleRight className="w-8 h-8 text-emerald-400" />
                        : <ToggleLeft className="w-8 h-8 text-white/20" />}
                      {policy.isActive ? "Policy Active" : "Policy Inactive"}
                    </button>
                  </div>
                </div>

                {/* Applicable classes */}
                <div>
                  <label className="text-xs font-medium text-white/60 mb-2 block">
                    Applicable Classes
                    <span className="ml-1 text-white/30 font-normal">(leave empty for all classes)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {classes.map(cls => {
                      const selected = policy.applicableClasses.includes(cls);
                      return (
                        <button
                          key={cls}
                          onClick={() => toggleClass(idx, cls)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                            selected
                              ? "bg-[#8b5cf6]/20 border-[#8b5cf6]/40 text-[#a78bfa]"
                              : "bg-white/5 border-white/10 text-white/35 hover:bg-white/10"
                          }`}
                          data-testid={`chip-class-${cls}-${idx}`}
                        >
                          {selected && <Check className="w-3 h-3 inline mr-1" />}
                          {cls}
                        </button>
                      );
                    })}
                    {policy.applicableClasses.length > 0 && (
                      <button
                        onClick={() => update(idx, { applicableClasses: [] })}
                        className="px-2 py-1.5 rounded-lg text-xs text-white/30 hover:text-white/60 border border-white/5 transition-colors"
                        data-testid={`btn-clear-classes-${idx}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {policy.applicableClasses.length === 0 && (
                    <p className="text-white/25 text-xs mt-1.5">This policy applies to all classes (school-wide).</p>
                  )}
                </div>

                {/* Live preview */}
                <div className="rounded-xl border border-[#8b5cf6]/15 bg-[#8b5cf6]/5 p-3">
                  <p className="text-xs text-white/35 mb-2 uppercase tracking-wider font-medium">Status Preview</p>
                  <div className="flex flex-wrap gap-2">
                    {previewRows(policy).map((row, ri) => (
                      <div key={ri} className="rounded-lg bg-white/5 px-3 py-2 text-center min-w-[90px]">
                        <p className="text-xs text-white/30 leading-tight">{row.label}</p>
                        <p className={`text-xs font-bold ${row.color} mt-1`}>{row.status}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => saveMut.mutate(policy)}
                    disabled={!policy.policyName.trim() || saveMut.isPending}
                    className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white h-9 font-semibold"
                    data-testid={`btn-save-policy-${idx}`}
                  >
                    {saveMut.isPending ? "Saving…" : policy.id ? "Save Changes" : "Create Policy"}
                  </Button>
                  {policy.id && (
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => update(idx, { editing: false })}
                      className="text-white/40 hover:text-white h-9"
                    >
                      Cancel
                    </Button>
                  )}
                  {!policy.id && (
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => setPolicies(prev => prev.filter((_,i) => i !== idx))}
                      className="text-red-400/60 hover:text-red-400 h-9"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Default policy note */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
        <p className="text-xs text-white/25">
          <span className="text-white/40 font-medium">System Default</span> — if no policy matches a teacher/student,
          the system falls back to: arrival 09:00, 0 min grace, half-day after 12:00, 85% target.
        </p>
      </div>

    </div>
  );
}
