import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Timer, ChevronDown, ChevronUp, ToggleLeft, ToggleRight, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── Per-role configuration block ────────────────────────────────────────────
interface RoleConfig {
  expectedArrivalTime: string;
  gracePeriodMinutes: number;
  halfDayCutoffTime: string;
  attendanceTarget: number;
  applicableClasses: string[];
  isActive: boolean;
}

function defaultRoleConfig(): RoleConfig {
  return {
    expectedArrivalTime: "09:00",
    gracePeriodMinutes: 0,
    halfDayCutoffTime: "12:00",
    attendanceTarget: 85,
    applicableClasses: [],
    isActive: true,
  };
}

// ── UI draft card (not the server shape) ────────────────────────────────────
interface PolicyCard {
  id?: number;
  schoolId?: number;
  policyName: string;
  activeRole: "TEACHER" | "STUDENT";
  configs: { TEACHER: RoleConfig; STUDENT: RoleConfig };
  editing: boolean;
  expanded: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ── Server response shape ────────────────────────────────────────────────────
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

function serverToCard(p: ServerPolicy): PolicyCard {
  const cfg: RoleConfig = {
    expectedArrivalTime: p.expectedArrivalTime,
    gracePeriodMinutes: p.gracePeriodMinutes,
    halfDayCutoffTime: p.halfDayCutoffTime,
    attendanceTarget: p.attendanceTarget,
    applicableClasses: p.applicableClasses,
    isActive: p.isActive,
  };
  return {
    id: p.id,
    schoolId: p.schoolId,
    policyName: p.policyName,
    activeRole: p.targetRole,
    configs: {
      TEACHER: p.targetRole === "TEACHER" ? cfg : defaultRoleConfig(),
      STUDENT: p.targetRole === "STUDENT" ? cfg : defaultRoleConfig(),
    },
    editing: false,
    expanded: false,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function emptyCard(): PolicyCard {
  return {
    policyName: "",
    activeRole: "TEACHER",
    configs: { TEACHER: defaultRoleConfig(), STUDENT: defaultRoleConfig() },
    editing: true,
    expanded: true,
  };
}

// ── Status preview helper ────────────────────────────────────────────────────
function previewRows(cfg: RoleConfig) {
  const [arrH, arrM] = cfg.expectedArrivalTime.split(":").map(Number);
  const [halfH, halfM] = cfg.halfDayCutoffTime.split(":").map(Number);
  const arrMin = arrH * 60 + (arrM ?? 0);
  const halfMin = halfH * 60 + (halfM ?? 0);
  const grace = cfg.gracePeriodMinutes;

  const samples: Array<{ label: string; minutes: number }> = [
    { label: `Before ${cfg.expectedArrivalTime}`, minutes: arrMin - 10 },
    { label: cfg.expectedArrivalTime, minutes: arrMin },
    ...(grace > 0 ? [{ label: `+${grace}m grace limit`, minutes: arrMin + grace }] : []),
    { label: `After grace`, minutes: arrMin + grace + 5 },
    { label: `${cfg.halfDayCutoffTime} (half-day cutoff)`, minutes: halfMin },
    { label: `After ${cfg.halfDayCutoffTime}`, minutes: halfMin + 5 },
  ].filter(s => s.minutes >= 0);

  return samples.map(s => {
    let status: string;
    let color: string;
    if (s.minutes <= arrMin + grace)  { status = "Present";  color = "text-emerald-400"; }
    else if (s.minutes <= halfMin)    { status = "Late";     color = "text-amber-400";   }
    else                              { status = "Half Day"; color = "text-orange-400";  }
    const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
    return { label: s.label, time: `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`, status, color };
  });
}

// ── Component ────────────────────────────────────────────────────────────────
export function AttendancePolicySetup({ schoolId }: { schoolId: number }) {
  const { toast } = useToast();

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

  const [cards, setCards] = useState<PolicyCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [previewFor, setPreviewFor] = useState<number | null>(null);

  const { isLoading, data: serverPolicies } = useQuery<ServerPolicy[]>({
    queryKey: ["/api/admin/attendance-policies", schoolId],
    queryFn: async () => {
      const r = await fetch("/api/admin/attendance-policies", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!schoolId,
  });

  if (!loaded && serverPolicies) {
    setCards(serverPolicies.map(serverToCard));
    setLoaded(true);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Update top-level card fields (policyName, activeRole, editing, expanded) */
  function updateCard(idx: number, patch: Partial<PolicyCard>) {
    setCards(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }

  /** Update a field inside configs[role] — never touches the other role's block */
  function updateConfig(idx: number, role: "TEACHER" | "STUDENT", patch: Partial<RoleConfig>) {
    setCards(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      return { ...c, configs: { ...c.configs, [role]: { ...c.configs[role], ...patch } } };
    }));
  }

  function toggleClass(idx: number, role: "TEACHER" | "STUDENT", cls: string) {
    setCards(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      const current = c.configs[role].applicableClasses;
      const next = current.includes(cls) ? current.filter(x => x !== cls) : [...current, cls];
      return { ...c, configs: { ...c.configs, [role]: { ...c.configs[role], applicableClasses: next } } };
    }));
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async (card: PolicyCard) => {
      const cfg = card.configs[card.activeRole];
      const body = {
        targetRole: card.activeRole,
        policyName: card.policyName,
        applicableClasses: cfg.applicableClasses,
        expectedArrivalTime: cfg.expectedArrivalTime,
        gracePeriodMinutes: cfg.gracePeriodMinutes,
        halfDayCutoffTime: cfg.halfDayCutoffTime,
        attendanceTarget: cfg.attendanceTarget,
        isActive: cfg.isActive,
      };
      if (card.id) {
        const r = await apiRequest("PUT", `/api/admin/attendance-policies/${card.id}`, body);
        return r.json();
      } else {
        const r = await apiRequest("POST", "/api/admin/attendance-policies", body);
        return r.json();
      }
    },
    onSuccess: (saved: ServerPolicy, vars: PolicyCard) => {
      setCards(prev => prev.map(c => c === vars ? serverToCard(saved) : c));
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
      setCards(prev => prev.filter(c => c.id !== id));
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance-policies"] });
      toast({ title: "Policy deleted" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading && !loaded) {
    return <div className="space-y-3">{[1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <p className="text-white/40 text-xs flex-1">
          Set time-based rules for teacher and student attendance. Rules apply per class or school-wide.
        </p>
        <Button
          size="sm"
          onClick={() => setCards(prev => [...prev, emptyCard()])}
          className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-semibold h-9 shrink-0"
          data-testid="btn-add-attendance-policy"
        >
          <Plus className="w-4 h-4 mr-1" /> Add Policy
        </Button>
      </div>

      {/* Empty state */}
      {cards.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 p-10 text-center">
          <Timer className="w-8 h-8 mx-auto mb-2 text-white/20" />
          <p className="text-white/40 text-sm">No attendance policies configured yet.</p>
          <p className="text-white/25 text-xs mt-1">Click "Add Policy" to create your first rule.</p>
        </div>
      )}

      {/* Policy cards */}
      <div className="space-y-3">
        {cards.map((card, idx) => {
          const role = card.activeRole;
          const cfg = card.configs[role];

          return (
            <div
              key={card.id ?? `new-${idx}`}
              className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden"
              data-testid={`attendance-policy-card-${idx}`}
            >
              {!card.editing ? (
                /* ── View mode ── */
                <div>
                  <div className="flex items-center gap-3 px-5 py-4">
                    <div className="p-2 rounded-lg bg-[#8b5cf6]/10 flex-shrink-0">
                      <Timer className="w-4 h-4 text-[#8b5cf6]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-white text-sm">{card.policyName}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          role === "TEACHER" ? "bg-sky-500/15 text-sky-300" : "bg-emerald-500/15 text-emerald-300"
                        }`}>
                          {role === "TEACHER" ? "Teachers" : "Students"}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          cfg.isActive ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/30"
                        }`}>
                          {cfg.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <p className="text-white/40 text-xs mt-0.5">
                        Arrival {cfg.expectedArrivalTime}
                        {cfg.gracePeriodMinutes > 0 ? ` · ${cfg.gracePeriodMinutes}m grace` : ""}
                        {` · Half-day after ${cfg.halfDayCutoffTime}`}
                        {" · "}Target {cfg.attendanceTarget}%
                        {cfg.applicableClasses.length > 0
                          ? ` · Classes: ${cfg.applicableClasses.join(", ")}`
                          : " · All classes"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setPreviewFor(previewFor === idx ? null : idx)}
                        className="text-[#8b5cf6] hover:text-[#a78bfa] transition-colors h-8 px-2"
                        data-testid={`btn-preview-policy-${idx}`}
                      >
                        {previewFor === idx ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => updateCard(idx, { editing: true, expanded: true })}
                        className="text-white/50 hover:text-white h-8 text-xs"
                        data-testid={`btn-edit-policy-${idx}`}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => { if (card.id) deleteMut.mutate(card.id); else setCards(p => p.filter((_, i) => i !== idx)); }}
                        className="text-red-400/60 hover:text-red-400 h-8"
                        data-testid={`btn-delete-policy-${idx}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {previewFor === idx && (
                    <div className="border-t border-white/5 px-5 py-3">
                      <p className="text-xs text-white/35 mb-2 uppercase tracking-wider font-medium">Status Preview</p>
                      <div className="grid grid-cols-3 gap-2">
                        {previewRows(cfg).map((row, ri) => (
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

                  {/* Policy name + Applies To toggle */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">Policy Name</label>
                      <Input
                        value={card.policyName}
                        onChange={e => updateCard(idx, { policyName: e.target.value })}
                        placeholder={role === "STUDENT" ? "e.g. Standard Student Policy" : "e.g. Standard Teacher Policy"}
                        className="bg-[#0A1628] border-white/10 text-white text-sm h-9 placeholder:text-white/20"
                        data-testid={`input-policy-name-${idx}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">Applies To</label>
                      <div className="flex gap-2">
                        {(["TEACHER", "STUDENT"] as const).map(r => (
                          <button
                            key={r}
                            onClick={() => updateCard(idx, { activeRole: r })}
                            className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-all border ${
                              role === r
                                ? "bg-[#8b5cf6] border-[#8b5cf6] text-white"
                                : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                            }`}
                            data-testid={`btn-role-${r.toLowerCase()}-${idx}`}
                          >
                            {r === "TEACHER" ? "Teachers" : "Students"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Role indicator banner — makes it crystal-clear which block is active */}
                  <div className={`rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-2 ${
                    role === "TEACHER"
                      ? "bg-sky-500/10 border border-sky-500/20 text-sky-300"
                      : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${role === "TEACHER" ? "bg-sky-400" : "bg-emerald-400"}`} />
                    Editing <strong>{role === "TEACHER" ? "Teacher" : "Student"}</strong> configuration — changes here do not affect the other group.
                  </div>

                  {/* Timing fields — bound to cfg (the active role's block only) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">Expected Arrival (IST)</label>
                      <Input
                        type="time"
                        value={cfg.expectedArrivalTime}
                        onChange={e => updateConfig(idx, role, { expectedArrivalTime: e.target.value })}
                        className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                        data-testid={`input-arrival-time-${idx}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">Grace Period (minutes)</label>
                      <Input
                        type="number" min={0} max={120}
                        value={cfg.gracePeriodMinutes}
                        onChange={e => updateConfig(idx, role, { gracePeriodMinutes: parseInt(e.target.value) || 0 })}
                        placeholder="0"
                        className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                        data-testid={`input-grace-${idx}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">Half-Day Cutoff (IST)</label>
                      <Input
                        type="time"
                        value={cfg.halfDayCutoffTime}
                        onChange={e => updateConfig(idx, role, { halfDayCutoffTime: e.target.value })}
                        className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                        data-testid={`input-halfday-cutoff-${idx}`}
                      />
                    </div>
                  </div>

                  {/* Attendance target + active toggle */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-white/60 mb-1 block">
                        Attendance Target: <span className="text-[#8b5cf6] font-bold">{cfg.attendanceTarget}%</span>
                      </label>
                      <input
                        type="range" min={50} max={100} step={1}
                        value={cfg.attendanceTarget}
                        onChange={e => updateConfig(idx, role, { attendanceTarget: parseInt(e.target.value) })}
                        className="w-full accent-[#8b5cf6]"
                        data-testid={`slider-target-${idx}`}
                      />
                      <div className="flex justify-between text-xs text-white/20 mt-0.5">
                        <span>50%</span><span>75%</span><span>100%</span>
                      </div>
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => updateConfig(idx, role, { isActive: !cfg.isActive })}
                        className="flex items-center gap-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
                        data-testid={`toggle-active-${idx}`}
                      >
                        {cfg.isActive
                          ? <ToggleRight className="w-8 h-8 text-emerald-400" />
                          : <ToggleLeft className="w-8 h-8 text-white/20" />}
                        {cfg.isActive ? "Policy Active" : "Policy Inactive"}
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
                        const selected = cfg.applicableClasses.includes(cls);
                        return (
                          <button
                            key={cls}
                            onClick={() => toggleClass(idx, role, cls)}
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
                      {cfg.applicableClasses.length > 0 && (
                        <button
                          onClick={() => updateConfig(idx, role, { applicableClasses: [] })}
                          className="px-2 py-1.5 rounded-lg text-xs text-white/30 hover:text-white/60 border border-white/5 transition-colors"
                          data-testid={`btn-clear-classes-${idx}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {cfg.applicableClasses.length === 0 && (
                      <p className="text-white/25 text-xs mt-1.5">This policy applies to all classes (school-wide).</p>
                    )}
                  </div>

                  {/* Live status preview */}
                  <div className="rounded-xl border border-[#8b5cf6]/15 bg-[#8b5cf6]/5 p-3">
                    <p className="text-xs text-white/35 mb-2 uppercase tracking-wider font-medium">Status Preview</p>
                    <div className="flex flex-wrap gap-2">
                      {previewRows(cfg).map((row, ri) => (
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
                      onClick={() => saveMut.mutate(card)}
                      disabled={!card.policyName.trim() || saveMut.isPending}
                      className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white h-9 font-semibold"
                      data-testid={`btn-save-policy-${idx}`}
                    >
                      {saveMut.isPending ? "Saving…" : card.id ? "Save Changes" : "Create Policy"}
                    </Button>
                    {card.id && (
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => updateCard(idx, { editing: false })}
                        className="text-white/40 hover:text-white h-9"
                      >
                        Cancel
                      </Button>
                    )}
                    {!card.id && (
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => setCards(prev => prev.filter((_, i) => i !== idx))}
                        className="text-red-400/60 hover:text-red-400 h-9"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* System default note */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
        <p className="text-xs text-white/25">
          <span className="text-white/40 font-medium">System Default</span> — if no policy matches a teacher/student,
          the system falls back to: arrival 09:00, 0 min grace, half-day after 12:00, 85% target.
        </p>
      </div>

    </div>
  );
}
