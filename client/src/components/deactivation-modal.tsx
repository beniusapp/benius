import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface DeactivationModalProps {
  open: boolean;
  onClose: () => void;
  type: "student" | "teacher";
  targetId: number;
  targetName: string;
  schoolId: number;
  invalidateKeys: string[][];
}

const STUDENT_REASONS = ["Graduated", "Transferred", "Disciplinary", "Long Absence", "Fee Default", "Other"];
const TEACHER_REASONS = ["Resigned", "Transferred", "Terminated", "Retired", "Contract Ended", "Other"];

const BATCH_YEARS = Array.from({ length: 15 }, (_, i) => {
  const start = 2015 + i;
  return `${start}-${start + 1}`;
});

export default function DeactivationModal({
  open, onClose, type, targetId, targetName, schoolId, invalidateKeys,
}: DeactivationModalProps) {
  const { toast } = useToast();
  const [reason, setReason]         = useState("");
  const [batchYear, setBatchYear]   = useState("");
  const [comments, setComments]     = useState("");
  const [password, setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verifyError, setVerifyError]   = useState("");

  const reasons = type === "student" ? STUDENT_REASONS : TEACHER_REASONS;

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      // client-side pre-verify for fast UX feedback
      const verifyRes  = await apiRequest("POST", "/api/admin/verify-password", { password });
      const verifyData: { valid: boolean } = await verifyRes.json();
      if (!verifyData.valid) throw new Error("Incorrect password");

      const url = type === "student"
        ? `/api/students/${targetId}/deactivate`
        : `/api/teachers/${targetId}/deactivate`;
      const res = await apiRequest("PATCH", url, { reason, batchYear, comments, password });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Server error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: `${type === "student" ? "Student" : "Teacher"} Deactivated`,
        description: `${targetName} has been deactivated and removed from active lists.`,
      });
      invalidateKeys.forEach(key => queryClient.invalidateQueries({ queryKey: key }));
      handleClose();
    },
    onError: (e: Error) => setVerifyError(e.message),
  });

  function handleClose() {
    setReason(""); setBatchYear(""); setComments(""); setPassword("");
    setShowPassword(false); setVerifyError("");
    onClose();
  }

  if (!open) return null;

  const canSubmit = reason && batchYear && password && !deactivateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />
      <div
        className="relative w-full max-w-md rounded-2xl border border-red-500/30 bg-[#1A0A0A] shadow-2xl shadow-red-900/20 p-6 space-y-4 overflow-y-auto"
        style={{ maxHeight: "90vh" }}
        data-testid="deactivation-modal"
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-red-400" data-testid="modal-title">
              Deactivate {type === "student" ? "Student" : "Teacher"}
            </h2>
            <p className="text-sm text-white/60 mt-0.5">
              This action will permanently deactivate{" "}
              <span className="text-white font-semibold">{targetName}</span>.
              Their login will be blocked and they will be removed from active lists.
              This action is logged and cannot be undone without database access.
            </p>
          </div>
        </div>

        {/* Reason */}
        <div className="space-y-1">
          <label className="text-sm text-white/70 font-medium">
            Reason for Deactivation <span className="text-red-400">*</span>
          </label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="bg-[#0A0808] border-red-500/30 text-white" data-testid="select-deactivation-reason">
              <SelectValue placeholder="Select a reason…" />
            </SelectTrigger>
            <SelectContent>
              {reasons.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Batch Year */}
        <div className="space-y-1">
          <label className="text-sm text-white/70 font-medium">
            Batch Year <span className="text-red-400">*</span>
          </label>
          <Select value={batchYear} onValueChange={setBatchYear}>
            <SelectTrigger className="bg-[#0A0808] border-red-500/30 text-white">
              <SelectValue placeholder="Select batch year…" />
            </SelectTrigger>
            <SelectContent>
              {BATCH_YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Comments */}
        <div className="space-y-1">
          <label className="text-sm text-white/70 font-medium">
            Comments{" "}
            <span className="text-white/30 text-xs font-normal">(optional)</span>
          </label>
          <Textarea
            value={comments}
            onChange={e => setComments(e.target.value)}
            placeholder="Add any additional notes or context…"
            className="bg-[#0A0808] border-red-500/30 text-white placeholder:text-white/30 resize-none"
            rows={3}
          />
        </div>

        {/* Admin Password */}
        <div className="space-y-1">
          <label className="text-sm text-white/70 font-medium">
            Confirm Your Admin Password <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setVerifyError(""); }}
              placeholder="Enter your password to confirm"
              className="bg-[#0A0808] border-red-500/30 text-white pr-10 placeholder:text-white/30"
              data-testid="input-admin-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              data-testid="button-toggle-password"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {verifyError && (
            <p className="text-red-400 text-xs mt-1" data-testid="error-password">{verifyError}</p>
          )}
        </div>

        {/* Warning */}
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-red-300 text-xs leading-relaxed">
            <strong>Warning:</strong> You are about to deactivate <strong>{targetName}</strong>.
            This will immediately revoke all login access. This action is audit-logged.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <Button
            variant="outline" onClick={handleClose}
            className="flex-1 border-white/20 text-white/70 hover:bg-white/10"
            data-testid="button-cancel-deactivation"
          >
            Cancel
          </Button>
          <Button
            onClick={() => deactivateMutation.mutate()}
            disabled={!canSubmit}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-40"
            data-testid="button-confirm-deactivation"
          >
            {deactivateMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Deactivating…</>
              : "Deactivate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
