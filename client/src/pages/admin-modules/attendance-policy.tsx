import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Timer, ToggleLeft, ToggleRight, X, Check, Plus, Trash2,
  ChevronDown, ChevronUp, Globe, BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  targetRole: string;
  policyName: string;
  applicableClasses: string[];
  expectedArrivalTime: string;
  gracePeriodMinutes: number;
  halfDayCutoffTime: string;
  attendanceTarget: number;
  isActive: boolean;
}

interface LocalCard {
  localId: string;
  serverId: number | null;
  form: PolicyForm;
  expanded: boolean;
}

let _localIdCounter = 0;
function newLocalId() { return `local-${++_localIdCounter}`; }

function blankForm(): PolicyForm {
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

// ── Status preview helper ──────────────────────────────────────────────────────

function previewRows(form: PolicyForm) {
  const [ah, am] = form.expectedArrivalTime.split(":").map(Number);
  const [hh, hm] = form.halfDayCutoffTime.split(":").map(Number);
  const arrMin  = ah * 60 + (am ?? 0);
  const halfMin = hh * 60 + (hm ?? 0);
  const grace   = form.gracePeriodMinutes;

  const samples = [
    { label: `On time (≤ ${form.expectedArrivalTime})`,   minutes: arrMin - 1 },
    { label: `Grace limit (+${grace}m)`,                  minutes: arrMin + grace },
    { label: `After grace`,                               minutes: arrMin + grace + 5 },
    { label: `Half-day cutoff (${form.halfDayCutoffTime})`, minutes: halfMin },
    { label: `After cutoff`,                              minutes: halfMin + 5 },
  ].filter(s => s.minutes >= 0);

  return samples.map(s => {
    let status: string, color: string;
    if (s.minutes <= arrMin + grace) { status = "Present";  color = "text-emerald-400"; }
    else if (s.minutes <= halfMin)   { status = "Late";     color = "text-amber-400";   }
    else                             { status = "Half Day"; color = "text-orange-400";  }
    const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
    return { label: s.label, time: `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`, status, color };
  });
}

// ── PolicyCard ─────────────────────────────────────────────────────────────────

interface PolicyCardProps {
  card: LocalCard;
  classes: string[];
  onUpdate: (localId: string, patch: Partial<LocalCard>) => void;
  onSaved:  (localId: string, saved: ServerPolicy) => void;
  onDelete: (localId: string, serverId: number | null) => void;
}

function PolicyCard({ card, classes, onUpdate, onSaved, onDelete }: PolicyCardProps) {
  const { toast } = useToast();
  const { form, expanded, serverId, localId } = card;
  const isSchoolWide = form.applicableClasses.length === 0;

  // Accent colours: gold for school-wide, indigo for class-specific
  const accent    = isSchoolWide ? "#D4AF37" : "#818cf8";
  const chipSel   = isSchoolWide
    ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
    : "bg-indigo-500/20 border-indigo-500/40 text-indigo-300";
  const headerBdr = isSchoolWide
    ? "border-amber-500/20 bg-amber-500/5"
    : "border-indigo-500/20 bg-indigo-500/5";
  const previewBdr = isSchoolWide
    ? "border-amber-500/15 bg-amber-500/5"
    : "border-indigo-500/15 bg-indigo-500/5";

  function patchForm(p: Partial<PolicyForm>) {
    onUpdate(localId, { form: { ...form, ...p } });
  }

  function toggleClass(cls: string) {
    const has = form.applicableClasses.includes(cls);
    patchForm({
      applicableClasses: has
        ? form.applicableClasses.filter(c => c !== cls)
        : [...form.applicableClasses, cls],
    });
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = { targetRole: "ALL", ...form };
      if (serverId) {
        const r = await apiRequest("PUT", `/api/admin/attendance-policies/${serverId}`, body);
        return r.json() as Promise<ServerPolicy>;
      } else {
        const r = await apiRequest("POST", "/api/admin/attendance-policies", body);
        return r.json() as Promise<ServerPolicy>;
      }
    },
    onSuccess: (saved: ServerPolicy) => {
      onSaved(localId, saved);
      // Invalidate all caches so teacher/student pages get the new policy
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance-policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/attendance-policy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/attendance-policy"] });
      toast({ title: serverId ? "Policy updated" : "Policy created" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (serverId) {
        await apiRequest("DELETE", `/api/admin/attendance-policies/${serverId}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance-policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/attendance-policy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/attendance-policy"] });
      onDelete(localId, serverId);
      toast({ title: "Policy removed" });
    },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const rows = previewRows(form);

  return (
    <div className={`rounded-2xl border overflow-hidden ${headerBdr} bg-[#1A2942]`} data-testid={`policy-card-${localId}`}>

      {/* ── Card header ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => onUpdate(localId, { expanded: !expanded })}
      >
        <div className="flex-shrink-0">
          {isSchoolWide
            ? <Globe className="w-4 h-4 text-amber-400" />
            : <BookOpen className="w-4 h-4 text-indigo-400" />}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {form.policyName || <span className="text-white/30 italic">Unnamed Policy</span>}
          </p>
          <div className="flex flex-wrap gap-1 mt-1">
            {isSchoolWide
              ? <span className="text-[10px] text-amber-400/70 font-medium">All classes (school-wide default)</span>
              : form.applicableClasses.map(c => (
                  <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 font-medium">
                    Class {c}
                  </span>
                ))
            }
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
            form.isActive
              ? "bg-emerald-500/15 border-emerald-500/20 text-emerald-400"
              : "bg-white/5 border-white/10 text-white/30"
          }`}>
            {form.isActive ? "Active" : "Inactive"}
          </span>
          <button
            onClick={e => { e.stopPropagation(); deleteMut.mutate(); }}
            disabled={deleteMut.isPending}
            className="p-1 rounded text-white/25 hover:text-red-400 transition-colors"
            data-testid={`btn-delete-policy-${localId}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-white/30" />
            : <ChevronDown className="w-4 h-4 text-white/30" />}
        </div>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4">

          {/* Policy name */}
          <div>
            <label className="text-xs font-medium text-white/60 mb-1 block">Policy Name</label>
            <Input
              value={form.policyName}
              onChange={e => patchForm({ policyName: e.target.value })}
              placeholder="e.g. Standard Policy, Class 6 Policy…"
              className="bg-[#0A1628] border-white/10 text-white text-sm h-9 placeholder:text-white/20"
              data-testid={`input-name-${localId}`}
            />
          </div>

          {/* Timing fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-white/60 mb-1 block">Expected Arrival (IST)</label>
              <Input
                type="time"
                value={form.expectedArrivalTime}
                onChange={e => patchForm({ expectedArrivalTime: e.target.value })}
                className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                data-testid={`input-arrival-${localId}`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/60 mb-1 block">Grace Period (minutes)</label>
              <Input
                type="number" min={0} max={120}
                value={form.gracePeriodMinutes}
                onChange={e => patchForm({ gracePeriodMinutes: parseInt(e.target.value) || 0 })}
                placeholder="0"
                className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                data-testid={`input-grace-${localId}`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/60 mb-1 block">Half-Day Cutoff (IST)</label>
              <Input
                type="time"
                value={form.halfDayCutoffTime}
                onChange={e => patchForm({ halfDayCutoffTime: e.target.value })}
                className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                data-testid={`input-halfday-${localId}`}
              />
            </div>
          </div>

          {/* Target + Active */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-white/60 mb-1 block">
                Attendance Target:{" "}
                <span style={{ color: accent }} className="font-bold">{form.attendanceTarget}%</span>
              </label>
              <input
                type="range" min={50} max={100} step={1}
                value={form.attendanceTarget}
                onChange={e => patchForm({ attendanceTarget: parseInt(e.target.value) })}
                className="w-full"
                style={{ accentColor: accent }}
                data-testid={`slider-target-${localId}`}
              />
              <div className="flex justify-between text-xs text-white/20 mt-0.5">
                <span>50%</span><span>75%</span><span>100%</span>
              </div>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => patchForm({ isActive: !form.isActive })}
                className="flex items-center gap-2 text-sm font-medium text-white/60 hover:text-white transition-colors"
                data-testid={`toggle-active-${localId}`}
              >
                {form.isActive
                  ? <ToggleRight className="w-8 h-8 text-emerald-400" />
                  : <ToggleLeft  className="w-8 h-8 text-white/20" />}
                {form.isActive ? "Policy Active" : "Policy Inactive"}
              </button>
            </div>
          </div>

          {/* Applicable classes */}
          <div>
            <label className="text-xs font-medium text-white/60 mb-2 block">
              Applicable Classes
              <span className="ml-1 text-white/30 font-normal">(leave empty = school-wide default)</span>
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
                      data-testid={`chip-class-${cls}-${localId}`}
                    >
                      {selected && <Check className="w-3 h-3 inline mr-1" />}
                      Class {cls}
                    </button>
                  );
                })}
                {form.applicableClasses.length > 0 && (
                  <button
                    onClick={() => patchForm({ applicableClasses: [] })}
                    className="px-2 py-1.5 rounded-lg text-xs text-white/30 hover:text-white/60 border border-white/5 transition-colors"
                    title="Clear — make school-wide"
                    data-testid={`btn-clear-classes-${localId}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
            {form.applicableClasses.length === 0 && classes.length > 0 && (
              <p className="text-amber-400/60 text-xs mt-1.5">
                ✦ This policy is school-wide — it applies to all teachers and students with no other matching policy.
              </p>
            )}
          </div>

          {/* Status preview */}
          <div className={`rounded-xl border p-3 ${previewBdr}`}>
            <p className="text-xs text-white/35 mb-2 uppercase tracking-wider font-medium">
              Status Preview — applies to both Teachers &amp; Students
            </p>
            <div className="flex flex-wrap gap-2">
              {rows.map((row, ri) => (
                <div key={ri} className="rounded-lg bg-white/5 px-3 py-2 text-center min-w-[100px]">
                  <p className="text-xs text-white/30 leading-tight">{row.label}</p>
                  <p className="text-[10px] text-white/20">{row.time}</p>
                  <p className={`text-xs font-bold ${row.color} mt-0.5`}>{row.status}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => saveMut.mutate()}
              disabled={!form.policyName.trim() || saveMut.isPending}
              className="bg-indigo-500 hover:bg-indigo-600 text-white h-9 font-semibold px-6"
              style={{ background: accent }}
              data-testid={`btn-save-policy-${localId}`}
            >
              {saveMut.isPending ? "Saving…" : serverId ? "Save Changes" : "Create Policy"}
            </Button>
            {!form.policyName.trim() && (
              <p className="text-xs text-white/30">Enter a policy name to save.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function AttendancePolicySetup({ schoolId }: { schoolId: number }) {
  const { toast } = useToast();
  const [cards, setCards] = useState<LocalCard[]>([]);
  const initialised = useRef(false);

  // Fetch school config for the class list
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

  // Fetch saved policies
  const { isLoading, data: serverPolicies } = useQuery<ServerPolicy[]>({
    queryKey: ["/api/admin/attendance-policies", schoolId],
    queryFn: async () => {
      const r = await fetch("/api/admin/attendance-policies", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!schoolId,
  });

  // Initialise local cards from server data (once only)
  useEffect(() => {
    if (!serverPolicies || initialised.current) return;
    initialised.current = true;
    setCards(
      serverPolicies.map(p => ({
        localId:   newLocalId(),
        serverId:  p.id,
        form:      serverToForm(p),
        expanded:  false,
      }))
    );
  }, [serverPolicies]);

  // ── Card management callbacks ──────────────────────────────────────────────

  const handleUpdate = useCallback((localId: string, patch: Partial<LocalCard>) => {
    setCards(prev => prev.map(c => c.localId === localId ? { ...c, ...patch } : c));
  }, []);

  const handleSaved = useCallback((localId: string, saved: ServerPolicy) => {
    setCards(prev => prev.map(c =>
      c.localId === localId
        ? { ...c, serverId: saved.id, form: serverToForm(saved) }
        : c
    ));
  }, []);

  const handleDelete = useCallback((localId: string, _serverId: number | null) => {
    setCards(prev => prev.filter(c => c.localId !== localId));
  }, []);

  const addNewPolicy = useCallback(() => {
    const newCard: LocalCard = {
      localId:  newLocalId(),
      serverId: null,
      form:     blankForm(),
      expanded: true,
    };
    setCards(prev => [newCard, ...prev]);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Intro + Add button */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-white/50 text-xs leading-relaxed">
            Create one policy per class, or a single school-wide default. Each policy applies to
            <span className="text-white/70 font-medium"> both teachers and students</span> in the selected classes.
            A school-wide policy (no classes selected) serves as the fallback for everyone.
          </p>
        </div>
        <Button
          onClick={addNewPolicy}
          className="flex-shrink-0 flex items-center gap-1.5 bg-[#D4AF37] hover:bg-[#c9a42e] text-[#0A1628] font-semibold text-xs h-8 px-4"
          data-testid="btn-add-policy"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Policy
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-white/30">
        <span className="flex items-center gap-1.5">
          <Globe className="w-3 h-3 text-amber-400" />
          Gold = school-wide (fallback)
        </span>
        <span className="flex items-center gap-1.5">
          <BookOpen className="w-3 h-3 text-indigo-400" />
          Indigo = class-specific (overrides school-wide)
        </span>
      </div>

      {/* Policy cards */}
      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center py-12 gap-3">
          <Timer className="w-8 h-8 text-white/15" />
          <p className="text-white/30 text-sm">No attendance policies yet.</p>
          <Button
            onClick={addNewPolicy}
            className="flex items-center gap-1.5 bg-[#D4AF37] hover:bg-[#c9a42e] text-[#0A1628] font-semibold text-xs h-8 px-4"
          >
            <Plus className="w-3.5 h-3.5" />
            Add First Policy
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map(card => (
            <PolicyCard
              key={card.localId}
              card={card}
              classes={classes}
              onUpdate={handleUpdate}
              onSaved={handleSaved}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* System default note */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
        <p className="text-xs text-white/25">
          <span className="text-white/40 font-medium">Resolution order</span> —
          class-specific policy → school-wide policy → system default (09:00 arrival, 12:00 half-day, 85% target).
          The most specific matching policy always wins.
        </p>
      </div>
    </div>
  );
}
