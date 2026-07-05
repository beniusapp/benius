/**
 * AcademicSessions — tenant-scoped academic year management.
 *
 * Rules enforced:
 *  • Only ONE session per school may be active at any time.
 *  • Activation requires typing "ROLLOVER" in a safety confirmation modal
 *    because changing the live session shifts rosters for all teachers & students.
 *  • Deleting an active session is blocked in the UI.
 *  • All API calls carry implicit tenant scope via the admin session cookie.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CalendarRange, Plus, Trash2, Zap, CheckCircle2,
  Clock, Loader2, AlertTriangle, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fmtDate } from "@/lib/dateUtils";

// ── Types ──────────────────────────────────────────────────────────────────────
interface AcademicSession {
  id: number;
  schoolId: number;
  sessionName: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: string | null;
}

interface Props { schoolId: number }

// ── Glassmorphic helpers ───────────────────────────────────────────────────────
const GLASS = {
  card: {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.08)",
  } as React.CSSProperties,
  activeCard: {
    background: "rgba(34,211,238,0.06)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(34,211,238,0.25)",
    boxShadow: "0 0 24px rgba(34,211,238,0.10)",
  } as React.CSSProperties,
  modalOverlay: {
    background: "rgba(0,0,0,0.75)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
  } as React.CSSProperties,
  modal: {
    background: "rgba(15,25,45,0.96)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(255,255,255,0.12)",
  } as React.CSSProperties,
};

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-4">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(34,211,238,0.08)" }}
      >
        <CalendarRange className="w-7 h-7 text-cyan-400/50" />
      </div>
      <div className="text-center">
        <p className="font-semibold text-white/70">No academic sessions yet</p>
        <p className="text-xs mt-1 text-white/40">
          Create your first session to start tracking enrollments by year.
        </p>
      </div>
    </div>
  );
}

// ── Add-session modal ──────────────────────────────────────────────────────────
interface AddModalProps {
  onClose: () => void;
  onSave: (name: string, start: string, end: string) => void;
  isPending: boolean;
}
function AddModal({ onClose, onSave, isPending }: AddModalProps) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  function submit() {
    if (!name.trim() || !start || !end) return;
    onSave(name.trim(), start, end);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={GLASS.modalOverlay}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-5"
        style={GLASS.modal}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #22d3ee, #6366f1)" }}
            >
              <CalendarRange className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white">New Academic Session</h3>
              <p className="text-xs text-white/40">Define the year's date range</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-white/60 block mb-1.5">
              Session Name
            </label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. 2026–2027"
              className="bg-[#0A1628] border-white/15 text-white placeholder:text-white/25 focus:border-cyan-400/50"
              data-testid="input-session-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/60 block mb-1.5">Start Date</label>
              <input
                type="date"
                value={start}
                onChange={e => setStart(e.target.value)}
                className="w-full h-9 px-3 rounded-md text-sm text-white bg-[#0A1628] border border-white/15 focus:outline-none focus:border-cyan-400/50"
                data-testid="input-session-start"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/60 block mb-1.5">End Date</label>
              <input
                type="date"
                value={end}
                onChange={e => setEnd(e.target.value)}
                min={start}
                className="w-full h-9 px-3 rounded-md text-sm text-white bg-[#0A1628] border border-white/15 focus:outline-none focus:border-cyan-400/50"
                data-testid="input-session-end"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-white/15 text-white/60 hover:bg-white/5"
            data-testid="button-modal-cancel"
          >
            Cancel
          </Button>
          <button
            disabled={!name.trim() || !start || !end || isPending}
            onClick={submit}
            data-testid="button-modal-save"
            className="flex-1 h-9 rounded-lg font-semibold text-sm flex items-center justify-center gap-2
              disabled:opacity-50 transition-all hover:brightness-110 active:scale-95"
            style={{
              background: "linear-gradient(135deg, #22d3ee, #6366f1)",
              color: "#fff",
            }}
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rollover confirmation modal ────────────────────────────────────────────────
interface RolloverModalProps {
  session: AcademicSession;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}
function RolloverModal({ session, onClose, onConfirm, isPending }: RolloverModalProps) {
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim() === "ROLLOVER";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={GLASS.modalOverlay}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 space-y-5"
        style={{
          ...GLASS.modal,
          border: "1px solid rgba(239,68,68,0.35)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Warning header */}
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: "rgba(239,68,68,0.15)" }}
          >
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-white">Session Rollover Warning</h3>
            <p className="text-xs text-white/50 mt-1">
              Activating <span className="font-semibold text-cyan-300">"{session.sessionName}"</span> will
              immediately shift the <strong className="text-white">live tracking roster</strong> for all
              teachers and students to this session. All new attendance marks, homework, and grades
              will be logged against the new session.
            </p>
          </div>
        </div>

        {/* Impact summary */}
        <div
          className="rounded-xl p-3 space-y-1.5 text-xs"
          style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.20)" }}
        >
          {[
            "The currently active session will be automatically archived.",
            "New student registrations will be enrolled in this session.",
            "Existing data from the previous session is retained and unaffected.",
          ].map(line => (
            <p key={line} className="flex items-start gap-2 text-white/65">
              <span className="text-red-400 mt-0.5 shrink-0">›</span> {line}
            </p>
          ))}
        </div>

        {/* Type-to-confirm */}
        <div>
          <label className="text-xs font-semibold text-white/60 block mb-1.5">
            Type <span className="font-mono text-red-400 font-bold">ROLLOVER</span> to confirm
          </label>
          <Input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder="ROLLOVER"
            className="bg-[#0A1628] border-red-500/30 text-white placeholder:text-white/20 font-mono tracking-widest focus:border-red-400/60"
            data-testid="input-rollover-confirm"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 border-white/15 text-white/60 hover:bg-white/5"
            data-testid="button-rollover-cancel"
          >
            Cancel
          </Button>
          <button
            disabled={!confirmed || isPending}
            onClick={onConfirm}
            data-testid="button-rollover-proceed"
            className="flex-1 h-9 rounded-lg font-semibold text-sm flex items-center justify-center gap-2
              disabled:opacity-40 transition-all hover:brightness-110 active:scale-95"
            style={{
              background: confirmed ? "linear-gradient(135deg, #dc2626, #ef4444)" : "rgba(239,68,68,0.20)",
              color: "#fff",
              border: "1px solid rgba(239,68,68,0.50)",
            }}
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Activate Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation modal ──────────────────────────────────────────────────
interface DeleteModalProps {
  session: AcademicSession;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}
function DeleteModal({ session, onClose, onConfirm, isPending }: DeleteModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={GLASS.modalOverlay}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 space-y-4"
        style={{ ...GLASS.modal, border: "1px solid rgba(239,68,68,0.25)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.12)" }}>
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h3 className="font-bold text-white">Delete Session</h3>
            <p className="text-xs text-white/50">
              "{session.sessionName}" and all its enrollment records will be permanently removed.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <Button variant="outline" onClick={onClose} className="flex-1 border-white/15 text-white/60" data-testid="button-delete-cancel">
            Cancel
          </Button>
          <button
            disabled={isPending}
            onClick={onConfirm}
            data-testid="button-delete-confirm"
            className="flex-1 h-9 rounded-lg font-semibold text-sm text-white flex items-center justify-center gap-2
              disabled:opacity-50 hover:brightness-110 active:scale-95 transition-all"
            style={{ background: "linear-gradient(135deg, #dc2626, #ef4444)" }}
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function AcademicSessions({ schoolId }: Props) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [rolloverTarget, setRolloverTarget] = useState<AcademicSession | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AcademicSession | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: sessions = [], isLoading } = useQuery<AcademicSession[]>({
    queryKey: ["/api/admin/academic-sessions"],
    queryFn: async () => {
      const r = await fetch("/api/admin/academic-sessions", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load sessions");
      return r.json();
    },
  });

  const activeSession = sessions.find(s => s.isActive);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: async (body: { sessionName: string; startDate: string; endDate: string }) => {
      const r = await apiRequest("POST", "/api/admin/academic-sessions", body);
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message || "Failed to create session");
      }
      return r.json();
    },
    onSuccess: () => {
      setShowAdd(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
      toast({ title: "Session created", description: "The new academic session has been added." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const activateMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("PATCH", `/api/admin/academic-sessions/${id}/activate`, {});
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message || "Failed to activate session");
      }
      return r.json();
    },
    onSuccess: () => {
      setRolloverTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
      toast({ title: "Session activated", description: "Roster rolled over to the new session." });
    },
    onError: (e: Error) => toast({ title: "Activation failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("DELETE", `/api/admin/academic-sessions/${id}`, undefined);
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message || "Failed to delete session");
      }
    },
    onSuccess: () => {
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/academic-sessions"] });
      toast({ title: "Session deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Section header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-bold text-white text-lg tracking-tight">Academic Sessions</h3>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.50)" }}>
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} · Only one may be active at a time
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          data-testid="button-add-session"
          className="flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-semibold
            text-white transition-all hover:brightness-110 active:scale-95"
          style={{
            background: "linear-gradient(135deg, #22d3ee, #6366f1)",
            boxShadow: "0 4px 16px rgba(34,211,238,0.25)",
          }}
        >
          <Plus className="w-4 h-4" /> Add Session
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400/50" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && sessions.length === 0 && <EmptyState />}

      {/* Session cards */}
      {!isLoading && sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map(session => {
            const isActive = session.isActive;
            return (
              <div
                key={session.id}
                className="rounded-xl p-4 flex items-center gap-4 transition-all duration-200
                  hover:scale-[1.01]"
                style={isActive ? GLASS.activeCard : GLASS.card}
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.18)";
                    (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.06)";
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)";
                    (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
                  }
                }}
                data-testid={`session-card-${session.id}`}
              >
                {/* Icon */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isActive
                      ? "linear-gradient(135deg, #22d3ee, #6366f1)"
                      : "rgba(255,255,255,0.06)",
                    boxShadow: isActive ? "0 0 14px rgba(34,211,238,0.30)" : "none",
                  }}
                >
                  {isActive
                    ? <CheckCircle2 className="w-5 h-5 text-white" />
                    : <Clock className="w-5 h-5 text-white/35" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-white text-sm">{session.sessionName}</p>
                    {isActive ? (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-bold tracking-wide"
                        style={{
                          background: "rgba(34,211,238,0.15)",
                          color: "#22d3ee",
                          border: "1px solid rgba(34,211,238,0.30)",
                        }}
                      >
                        ● ACTIVE
                      </span>
                    ) : (
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{
                          background: "rgba(255,255,255,0.06)",
                          color: "rgba(255,255,255,0.40)",
                          border: "1px solid rgba(255,255,255,0.10)",
                        }}
                      >
                        ARCHIVED
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.50)" }}>
                    {fmtDate(session.startDate)} → {fmtDate(session.endDate)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Activate toggle — only shown for inactive sessions */}
                  {!isActive && (
                    <button
                      onClick={() => setRolloverTarget(session)}
                      data-testid={`button-activate-${session.id}`}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold
                        text-cyan-300 transition-all hover:brightness-110 active:scale-95"
                      style={{
                        background: "rgba(34,211,238,0.10)",
                        border: "1px solid rgba(34,211,238,0.25)",
                      }}
                    >
                      <Zap className="w-3.5 h-3.5" /> Activate
                    </button>
                  )}

                  {/* Delete — blocked for active session */}
                  {isActive ? (
                    <span
                      className="text-[10px] text-white/20 px-2"
                      title="Cannot delete the active session"
                    >
                      Protected
                    </span>
                  ) : (
                    <button
                      onClick={() => setDeleteTarget(session)}
                      data-testid={`button-delete-session-${session.id}`}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400/60
                        hover:text-red-400 hover:bg-red-500/10 transition-all active:scale-95"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info note */}
      {sessions.length > 0 && (
        <p className="text-xs mt-5 text-center" style={{ color: "rgba(255,255,255,0.28)" }}>
          New students are automatically enrolled in the active session at registration time.
        </p>
      )}

      {/* Modals */}
      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onSave={(name, start, end) => createMut.mutate({ sessionName: name, startDate: start, endDate: end })}
          isPending={createMut.isPending}
        />
      )}
      {rolloverTarget && (
        <RolloverModal
          session={rolloverTarget}
          onClose={() => setRolloverTarget(null)}
          onConfirm={() => activateMut.mutate(rolloverTarget.id)}
          isPending={activateMut.isPending}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          session={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMut.mutate(deleteTarget.id)}
          isPending={deleteMut.isPending}
        />
      )}
    </>
  );
}
