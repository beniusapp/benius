import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Timer, ToggleLeft, ToggleRight, X, Check, Plus, Trash2,
  ChevronDown, ChevronUp, Globe, BookOpen, GraduationCap, UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PolicyForm {
  policyName: string;
  expectedArrivalTime: string;
  gracePeriodMinutes: number;
  halfDayCutoffTime: string;
  schoolEndTime: string;
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
  schoolEndTime: string;
  attendanceTarget: number;
  isActive: boolean;
}

interface LocalCard {
  localId: string;
  serverId: number | null;
  form: PolicyForm;
  expanded: boolean;
}

let _cnt = 0;
function uid() { return `lc-${++_cnt}`; }

function blankForm(): PolicyForm {
  return {
    policyName: "",
    expectedArrivalTime: "09:00",
    gracePeriodMinutes: 0,
    halfDayCutoffTime: "12:00",
    schoolEndTime: "17:00",
    attendanceTarget: 85,
    isActive: true,
    applicableClasses: [],
  };
}

function serverToForm(p: ServerPolicy): PolicyForm {
  return {
    policyName:          p.policyName,
    expectedArrivalTime: p.expectedArrivalTime,
    gracePeriodMinutes:  p.gracePeriodMinutes,
    halfDayCutoffTime:   p.halfDayCutoffTime,
    schoolEndTime:       p.schoolEndTime ?? "17:00",
    attendanceTarget:    p.attendanceTarget,
    isActive:            p.isActive,
    applicableClasses:   p.applicableClasses,
  };
}

// ── Status preview ─────────────────────────────────────────────────────────────

function previewRows(form: PolicyForm) {
  const [ah, am] = form.expectedArrivalTime.split(":").map(Number);
  const [hh, hm] = form.halfDayCutoffTime.split(":").map(Number);
  const [eh, em] = (form.schoolEndTime || "17:00").split(":").map(Number);
  const arrMin  = ah * 60 + (am ?? 0);
  const halfMin = hh * 60 + (hm ?? 0);
  const endMin  = eh * 60 + (em ?? 0);
  const grace   = form.gracePeriodMinutes;

  const samples = [
    { label: "On time",             minutes: arrMin - 1 },
    { label: `Grace (+${grace}m)`,  minutes: arrMin + grace },
    { label: "After grace",         minutes: arrMin + grace + 5 },
    { label: "Half-day cutoff",     minutes: halfMin },
    { label: "After cutoff",        minutes: halfMin + 5 },
    { label: "School end",          minutes: endMin },
    { label: "After school end",    minutes: endMin + 5 },
  ].filter(s => s.minutes >= 0);

  return samples.map(s => {
    let status: string, color: string;
    if (s.minutes > endMin)               { status = "Leave";    color = "text-red-400";    }
    else if (s.minutes <= arrMin + grace) { status = "Present";  color = "text-emerald-400"; }
    else if (s.minutes <= halfMin)        { status = "Late";     color = "text-amber-400";   }
    else                                  { status = "Half Day"; color = "text-orange-400";  }
    const h = Math.floor(s.minutes / 60), m = s.minutes % 60;
    return { label: s.label, time: `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`, status, color };
  });
}

// ── PolicyCard component ───────────────────────────────────────────────────────

interface PolicyCardProps {
  card: LocalCard;
  classes: string[];
  targetRole: "TEACHER" | "STUDENT";
  onUpdate: (localId: string, patch: Partial<LocalCard>) => void;
  onSaved:  (localId: string, saved: ServerPolicy) => void;
  onDelete: (localId: string, serverId: number | null) => void;
}

function PolicyCard({ card, classes, targetRole, onUpdate, onSaved, onDelete }: PolicyCardProps) {
  const { toast } = useToast();
  const { form, expanded, serverId, localId } = card;
  const isSchoolWide = form.applicableClasses.length === 0;

  // Colour palette: teachers use gold, students use cyan
  const isTeacher = targetRole === "TEACHER";
  const accent     = isTeacher ? "#D4AF37" : "#22d3ee";
  const cardBorder = isTeacher
    ? (isSchoolWide ? "border-amber-500/20"  : "border-amber-500/10")
    : (isSchoolWide ? "border-cyan-500/20"   : "border-cyan-500/10");
  const headerBg   = isTeacher
    ? (isSchoolWide ? "bg-amber-500/5"   : "bg-amber-500/3")
    : (isSchoolWide ? "bg-cyan-500/5"    : "bg-cyan-500/3");
  const chipSel    = isTeacher
    ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
    : "bg-cyan-500/20 border-cyan-500/40 text-cyan-300";

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
      const body = { targetRole, ...form };
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/attendance-policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher/attendance-policy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/attendance-policy"] });
      toast({ title: serverId ? "Policy updated" : "Policy created" });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (serverId) await apiRequest("DELETE", `/api/admin/attendance-policies/${serverId}`);
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
    <div
      className={`rounded-xl border overflow-hidden bg-[#1A2942] ${cardBorder}`}
      data-testid={`policy-card-${localId}`}
    >
      {/* Header */}
      <div
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none ${headerBg}`}
        onClick={() => onUpdate(localId, { expanded: !expanded })}
      >
        <div className="flex-shrink-0">
          {isSchoolWide
            ? <Globe className={`w-4 h-4 ${isTeacher ? "text-amber-400" : "text-cyan-400"}`} />
            : <BookOpen className={`w-4 h-4 ${isTeacher ? "text-amber-400/60" : "text-cyan-400/60"}`} />}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {form.policyName || <span className="text-white/25 italic font-normal">Unnamed policy</span>}
          </p>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {isSchoolWide
              ? <span className={`text-[10px] font-medium ${isTeacher ? "text-amber-400/60" : "text-cyan-400/60"}`}>
                  All classes (school-wide)
                </span>
              : form.applicableClasses.map(c => (
                  <span
                    key={c}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      isTeacher
                        ? "bg-amber-500/15 text-amber-300/80"
                        : "bg-cyan-500/15 text-cyan-300/80"
                    }`}
                  >
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
              : "bg-white/5 border-white/10 text-white/25"
          }`}>
            {form.isActive ? "Active" : "Inactive"}
          </span>
          <button
            onClick={e => { e.stopPropagation(); deleteMut.mutate(); }}
            disabled={deleteMut.isPending}
            className="p-1 rounded text-white/20 hover:text-red-400 transition-colors"
            data-testid={`btn-delete-${localId}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {expanded
            ? <ChevronUp   className="w-4 h-4 text-white/25" />
            : <ChevronDown className="w-4 h-4 text-white/25" />}
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4">

          {/* Name */}
          <div>
            <label className="text-xs font-medium text-white/50 mb-1 block">Policy Name</label>
            <Input
              value={form.policyName}
              onChange={e => patchForm({ policyName: e.target.value })}
              placeholder="e.g. Standard Policy, Senior Block…"
              className="bg-[#0A1628] border-white/10 text-white text-sm h-9 placeholder:text-white/20"
              data-testid={`input-name-${localId}`}
            />
          </div>

          {/* Timing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-white/50 mb-1 block">Expected Arrival (IST)</label>
              <Input
                type="time"
                value={form.expectedArrivalTime}
                onChange={e => patchForm({ expectedArrivalTime: e.target.value })}
                className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                data-testid={`input-arrival-${localId}`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/50 mb-1 block">Grace Period (min)</label>
              <Input
                type="number" min={0} max={120}
                value={form.gracePeriodMinutes}
                onChange={e => patchForm({ gracePeriodMinutes: parseInt(e.target.value) || 0 })}
                className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                data-testid={`input-grace-${localId}`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/50 mb-1 block">Half-Day Cutoff (IST)</label>
              <Input
                type="time"
                value={form.halfDayCutoffTime}
                onChange={e => patchForm({ halfDayCutoffTime: e.target.value })}
                className="bg-[#0A1628] border-white/10 text-white text-sm h-9"
                data-testid={`input-halfday-${localId}`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-white/50 mb-1 block">
                School End Time (IST)
                <span className="ml-1 text-red-400/60 font-normal text-[10px]">check-in after this → Leave</span>
              </label>
              <Input
                type="time"
                value={form.schoolEndTime}
                onChange={e => patchForm({ schoolEndTime: e.target.value })}
                className="bg-[#0A1628] border-red-500/20 text-white text-sm h-9"
                data-testid={`input-school-end-${localId}`}
              />
            </div>
          </div>

          {/* Target + Active */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-white/50 mb-1 block">
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
                className="flex items-center gap-2 text-sm font-medium text-white/50 hover:text-white transition-colors"
                data-testid={`toggle-active-${localId}`}
              >
                {form.isActive
                  ? <ToggleRight className="w-8 h-8 text-emerald-400" />
                  : <ToggleLeft  className="w-8 h-8 text-white/20" />}
                {form.isActive ? "Policy Active" : "Policy Inactive"}
              </button>
            </div>
          </div>

          {/* Classes */}
          <div>
            <label className="text-xs font-medium text-white/50 mb-2 block">
              Applicable Classes
              <span className="ml-1 text-white/25 font-normal">(empty = school-wide fallback)</span>
            </label>
            {classes.length === 0 ? (
              <p className="text-white/25 text-xs italic">No classes configured yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {classes.map(cls => {
                  const selected = form.applicableClasses.includes(cls);
                  return (
                    <button
                      key={cls}
                      onClick={() => toggleClass(cls)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        selected
                          ? chipSel
                          : "bg-white/5 border-white/10 text-white/30 hover:bg-white/10"
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
                    className="px-2 py-1.5 rounded-lg text-xs text-white/25 hover:text-white/50 border border-white/5 transition-colors"
                    title="Clear selection (make school-wide)"
                    data-testid={`btn-clear-classes-${localId}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
            {isSchoolWide && classes.length > 0 && (
              <p className={`text-xs mt-1.5 ${isTeacher ? "text-amber-400/50" : "text-cyan-400/50"}`}>
                ✦ Acts as the school-wide default for all {targetRole === "TEACHER" ? "teachers" : "students"} with no class-specific match.
              </p>
            )}
          </div>

          {/* Preview */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
            <p className="text-xs text-white/30 mb-2 uppercase tracking-wider font-medium">Status Preview</p>
            <div className="flex flex-wrap gap-2">
              {rows.map((row, ri) => (
                <div key={ri} className="rounded-lg bg-white/5 px-3 py-2 text-center min-w-[90px]">
                  <p className="text-xs text-white/25 leading-tight">{row.label}</p>
                  <p className="text-[10px] text-white/20">{row.time}</p>
                  <p className={`text-xs font-bold ${row.color} mt-0.5`}>{row.status}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => saveMut.mutate()}
              disabled={!form.policyName.trim() || saveMut.isPending}
              className="h-9 font-semibold px-6 text-sm"
              style={{ background: accent, color: isTeacher ? "#0A1628" : "#0A1628" }}
              data-testid={`btn-save-${localId}`}
            >
              {saveMut.isPending ? "Saving…" : serverId ? "Save Changes" : "Create Policy"}
            </Button>
            {!form.policyName.trim() && (
              <p className="text-xs text-white/25">Enter a policy name to save.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── PolicySection — one panel per role ────────────────────────────────────────

interface PolicySectionProps {
  targetRole: "TEACHER" | "STUDENT";
  classes: string[];
  allPolicies: ServerPolicy[];
}

function PolicySection({ targetRole, classes, allPolicies }: PolicySectionProps) {
  const [cards, setCards] = useState<LocalCard[]>([]);
  const initialised = useRef(false);

  const isTeacher = targetRole === "TEACHER";
  const accent     = isTeacher ? "#D4AF37" : "#22d3ee";
  const label      = isTeacher ? "Teacher" : "Student";
  const Icon       = isTeacher ? UserCheck : GraduationCap;
  const sectionBorder = isTeacher ? "border-amber-500/15" : "border-cyan-500/15";
  const headerBg      = isTeacher ? "bg-amber-500/5"      : "bg-cyan-500/5";

  // Initialise cards from server data (once)
  useEffect(() => {
    if (initialised.current) return;
    const mine = allPolicies.filter(p =>
      p.targetRole === targetRole || p.targetRole === "ALL"
    );
    if (mine.length === 0 && allPolicies.length === 0) return; // wait for data
    initialised.current = true;
    setCards(mine.map(p => ({
      localId:  uid(),
      serverId: p.id,
      form:     serverToForm(p),
      expanded: false,
    })));
  }, [allPolicies, targetRole]);

  const handleUpdate = useCallback((localId: string, patch: Partial<LocalCard>) => {
    setCards(prev => prev.map(c => c.localId === localId ? { ...c, ...patch } : c));
  }, []);

  const handleSaved = useCallback((localId: string, saved: ServerPolicy) => {
    setCards(prev => prev.map(c =>
      c.localId === localId ? { ...c, serverId: saved.id, form: serverToForm(saved) } : c
    ));
  }, []);

  const handleDelete = useCallback((localId: string) => {
    setCards(prev => prev.filter(c => c.localId !== localId));
  }, []);

  const addCard = useCallback(() => {
    setCards(prev => [{
      localId:  uid(),
      serverId: null,
      form:     blankForm(),
      expanded: true,
    }, ...prev]);
  }, []);

  return (
    <div className={`rounded-2xl border overflow-hidden ${sectionBorder}`}>
      {/* Section header */}
      <div className={`flex items-center justify-between px-5 py-4 ${headerBg}`}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-white/5">
            <Icon className="w-4 h-4" style={{ color: accent }} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">{label} Attendance Policies</h3>
            <p className="text-xs text-white/35 mt-0.5">
              {isTeacher
                ? "Controls check-in status and attendance target for teaching staff."
                : "Controls attendance status and target percentage for students."}
            </p>
          </div>
        </div>
        <Button
          onClick={addCard}
          className="flex items-center gap-1.5 text-xs font-semibold h-8 px-4"
          style={{ background: accent, color: "#0A1628" }}
          data-testid={`btn-add-${targetRole}`}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Policy
        </Button>
      </div>

      {/* Cards list */}
      <div className="p-4 space-y-3">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 border border-dashed border-white/8 rounded-xl">
            <Timer className="w-7 h-7 text-white/15" />
            <p className="text-white/25 text-xs">No {label.toLowerCase()} policies yet.</p>
            <button
              onClick={addCard}
              className="text-xs font-semibold mt-1"
              style={{ color: accent }}
              data-testid={`btn-add-first-${targetRole}`}
            >
              + Add first policy
            </button>
          </div>
        ) : (
          cards.map(card => (
            <PolicyCard
              key={card.localId}
              card={card}
              classes={classes}
              targetRole={targetRole}
              onUpdate={handleUpdate}
              onSaved={handleSaved}
              onDelete={handleDelete}
            />
          ))
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-4 pt-1 text-xs text-white/25">
          <span className="flex items-center gap-1.5">
            <Globe className="w-3 h-3" style={{ color: accent }} />
            No classes = school-wide fallback
          </span>
          <span className="flex items-center gap-1.5">
            <BookOpen className="w-3 h-3" style={{ color: accent }} />
            Specific classes = overrides fallback
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function AttendancePolicySetup({ schoolId }: { schoolId: number }) {
  // Fetch school config for class list
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

  // Fetch all policies (shared between both sections)
  const { isLoading, data: serverPolicies = [] } = useQuery<ServerPolicy[]>({
    queryKey: ["/api/admin/attendance-policies", schoolId],
    queryFn: async () => {
      const r = await fetch("/api/admin/attendance-policies", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    enabled: !!schoolId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => <div key={i} className="h-28 rounded-2xl bg-white/5 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Resolution note */}
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
        <p className="text-xs text-white/25 leading-relaxed">
          <span className="text-white/40 font-medium">Resolution order</span> —
          Class-specific policy → School-wide policy → System default (09:00 arrival, 12:00 half-day, 17:00 school end, 85% target).
          Check-in after school end time is recorded as <span className="text-red-400/70 font-medium">Leave</span>.
          Teacher and student policies are resolved independently.
        </p>
      </div>

      {/* Teacher section */}
      <PolicySection
        targetRole="TEACHER"
        classes={classes}
        allPolicies={serverPolicies}
      />

      {/* Student section */}
      <PolicySection
        targetRole="STUDENT"
        classes={classes}
        allPolicies={serverPolicies}
      />
    </div>
  );
}
