import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Send, CheckCircle, Forward, Calendar, Clock, XCircle, AlertCircle, Trash2, Eye, Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { fmtDate } from "@/lib/dateUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface LeaveEntry {
  id: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  createdAt: string;
}

interface LeaveBalanceItem {
  policyId: number;
  name: string;
  annualLimit: number;
  carryForward: number;
  used: number;
  remaining: number;
  periodStart: string;
  validUntil: string;
}

interface LeavePolicy {
  id: number;
  name: string;
  annualLimit: number;
  isActive: boolean;
}

interface StudentLeaveEntry {
  id: number;
  studentId: number;
  studentName?: string;
  studentClass?: string;
  studentSection?: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  createdAt: string;
  rejectionReason?: string;
}


function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "approved") return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
      Approved
    </span>
  );
  if (s === "rejected") return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
      Rejected
    </span>
  );
  if (s === "forwarded") return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
      Forwarded
    </span>
  );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
      Pending
    </span>
  );
}

export default function LeaveModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [activeTab, setActiveTab] = useState("my-leave");
  const [pendingAction, setPendingAction] = useState<{ id: number; type: "approve" | "reject" | "escalate" } | null>(null);
  const [actionComment, setActionComment] = useState("");
  const [selectedLeave, setSelectedLeave] = useState<any | null>(null);

  const { data: leaves = [], isLoading } = useQuery<LeaveEntry[]>({
    queryKey: ["/api/leave/teacher", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/leave/teacher/${teacher.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: rawBalance, isLoading: balanceLoading } = useQuery({
    queryKey: ["/api/leave/balance", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/leave/balance/${teacher.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const balanceItems: LeaveBalanceItem[] = Array.isArray(rawBalance) ? rawBalance : [];

  const { data: policies = [] } = useQuery<LeavePolicy[]>({
    queryKey: ["/api/leave/policies", teacher.schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/leave/policies/${teacher.schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: studentLeaves = [], isLoading: studentLeavesLoading } = useQuery<StudentLeaveEntry[]>({
    queryKey: ["/api/student-leaves/teacher/mine"],
    queryFn: async () => {
      const res = await fetch("/api/student-leaves/teacher/mine", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const selectedBalance = balanceItems.find(b => b.name === leaveType);
  const isBalanceZero = selectedBalance ? selectedBalance.remaining === 0 : false;

  const submitMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/leave", { leaveType, startDate, endDate, reason });
    },
    onSuccess: () => {
      toast({ title: "Leave Request Submitted" });
      setLeaveType("");
      setStartDate("");
      setEndDate("");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/leave/teacher", teacher.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/balance", teacher.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment?: string }) => {
      await apiRequest("PATCH", `/api/student-leaves/${id}/approve`, { teacherComment: comment || undefined });
    },
    onSuccess: () => {
      toast({ title: "Leave Approved", description: "Attendance has been auto-synced for the leave dates." });
      setPendingAction(null); setActionComment("");
      queryClient.invalidateQueries({ queryKey: ["/api/student-leaves/teacher/mine"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const forwardMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: number; comment?: string }) => {
      await apiRequest("PATCH", `/api/student-leaves/${id}/forward`, { teacherComment: comment || undefined });
    },
    onSuccess: () => {
      toast({ title: "Leave Escalated", description: "Leave request forwarded to principal." });
      setPendingAction(null); setActionComment("");
      queryClient.invalidateQueries({ queryKey: ["/api/student-leaves/teacher/mine"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMyLeaveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/leave/${id}`, undefined);
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.message || "Failed to delete");
      }
    },
    onSuccess: () => {
      toast({ title: "Leave request deleted", description: "Your balance has been restored." });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/teacher", teacher.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/balance", teacher.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      await apiRequest("PATCH", `/api/student-leaves/${id}/reject`, { rejectionReason: reason });
    },
    onSuccess: () => {
      toast({ title: "Leave Rejected", description: "The student has been notified." });
      setPendingAction(null); setActionComment("");
      queryClient.invalidateQueries({ queryKey: ["/api/student-leaves/teacher/mine"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full" data-testid="tabs-leave">
          <TabsTrigger value="my-leave" className="flex-1" data-testid="tab-my-leave">
            My Leave
          </TabsTrigger>
          <TabsTrigger value="student-leave" className="flex-1" data-testid="tab-student-leave">
            Student Leave Requests
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my-leave" className="space-y-4 mt-4">
          {/* Balance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {balanceLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="bg-white">
                  <CardContent className="p-4 flex items-center justify-center h-24">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </CardContent>
                </Card>
              ))
            ) : balanceItems.length === 0 ? (
              <div className="col-span-3 text-center py-6 text-sm text-muted-foreground">
                No leave policies configured. Contact your administrator.
              </div>
            ) : (
              balanceItems.map((b) => (
                <Card key={b.policyId} className="bg-white border border-gray-200 shadow-sm">
                  <CardContent className="p-4">
                    {/* Header: name + period */}
                    <div className="flex items-start justify-between gap-1 mb-3">
                      <div>
                        <span className="text-sm font-bold text-gray-900 block" data-testid={`text-balance-label-${b.policyId}`}>
                          {b.name}
                        </span>
                        <span className="text-[10px] text-gray-400 flex items-center gap-0.5 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {fmtDate(b.periodStart)} – {fmtDate(b.validUntil)}
                        </span>
                      </div>
                      {b.remaining === 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-bold flex-shrink-0">
                          Exhausted
                        </span>
                      )}
                    </div>

                    {/* Breakdown rows */}
                    <div className="space-y-1.5 mb-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-500">Current Year</span>
                        <span className="text-xs font-bold text-gray-900">{b.annualLimit} days</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-500">Carried Over</span>
                        <span className={`text-xs font-bold ${b.carryForward > 0 ? "text-emerald-600" : "text-gray-400"}`}
                          data-testid={`text-balance-carry-${b.policyId}`}>
                          {b.carryForward > 0 ? `+${b.carryForward} days` : "0 days"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-500">Used</span>
                        <span className="text-xs font-bold text-gray-900" data-testid={`text-balance-used-${b.policyId}`}>
                          {b.used} days
                        </span>
                      </div>
                      <div className="h-px bg-gray-100 my-1" />
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-700">Net Available</span>
                        <span className="text-sm font-bold text-gray-900" data-testid={`text-balance-remaining-${b.policyId}`}>
                          {b.remaining} days
                        </span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${(b.annualLimit + b.carryForward) > 0 ? Math.min((b.used / (b.annualLimit + b.carryForward)) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Apply for Leave */}
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg text-gray-900" data-testid="text-leave-title">Apply for Leave</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={leaveType} onValueChange={setLeaveType}>
                <SelectTrigger data-testid="select-leave-type" className="text-gray-900">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((p) => (
                    <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isBalanceZero && leaveType && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-600">No remaining balance for {leaveType}. Submission is disabled.</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">Start Date</label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="text-gray-900"
                    data-testid="input-start-date"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-gray-500">End Date</label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="text-gray-900"
                    data-testid="input-end-date"
                  />
                </div>
              </div>
              <Textarea
                placeholder="Reason for leave..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="text-gray-900"
                data-testid="input-leave-reason"
              />
              <Button
                onClick={() => submitMutation.mutate()}
                disabled={!leaveType || !startDate || !endDate || !reason.trim() || submitMutation.isPending || isBalanceZero}
                data-testid="button-submit-leave"
              >
                {submitMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Submit Request
              </Button>
            </CardContent>
          </Card>

          {/* Leave History */}
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg text-gray-900" data-testid="text-leave-history-title">Leave History</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : leaves.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-leaves">
                  No leave requests yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {leaves.map((l) => (
                    <div key={l.id} className="p-3 rounded-md border border-gray-100 bg-white" data-testid={`card-leave-${l.id}`}>
                      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-sm text-gray-900">{l.leaveType}</span>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={l.status} />
                          {l.status === "pending" && (
                            <button
                              onClick={() => deleteMyLeaveMutation.mutate(l.id)}
                              disabled={deleteMyLeaveMutation.isPending}
                              className="flex items-center justify-center w-7 h-7 rounded-md text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                              title="Delete this pending request"
                              data-testid={`button-delete-leave-${l.id}`}
                            >
                              {deleteMyLeaveMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        {fmtDate(l.startDate)} to {fmtDate(l.endDate)}
                      </p>
                      <p className="text-sm mt-1 text-gray-700">{l.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="student-leave" className="space-y-4 mt-4">
          <Card className="bg-white border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg text-gray-900" data-testid="text-student-leave-title">
                Student Leave Requests — Your Classes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {studentLeavesLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : studentLeaves.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-student-leaves">
                  No student leave requests for your class.
                </p>
              ) : (
                <div className="space-y-3">
                  {studentLeaves.map((sl) => (
                    <div key={sl.id} className="p-3 rounded-md border border-gray-100 bg-gray-50" data-testid={`card-student-leave-${sl.id}`}>
                      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-sm text-gray-900" data-testid={`text-student-name-${sl.id}`}>
                            {sl.studentName || `Student #${sl.studentId}`}
                          </span>
                          {sl.class && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-medium">
                              {sl.class}-{sl.section}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setSelectedLeave(sl)}
                            className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                            data-testid={`button-view-leave-${sl.id}`}
                            title="View details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <StatusBadge status={sl.status} />
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">
                        {fmtDate(sl.startDate)} to {fmtDate(sl.endDate)}
                      </p>
                      <p className="text-sm mt-1 mb-2 text-gray-700 line-clamp-2">{sl.reason}</p>
                      {/* ── Action Buttons ── */}
                      {sl.status === "pending_teacher" && !(pendingAction?.id === sl.id) && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            size="sm"
                            onClick={() => { setPendingAction({ id: sl.id, type: "approve" }); setActionComment(""); }}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            data-testid={`button-approve-leave-${sl.id}`}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setPendingAction({ id: sl.id, type: "reject" }); setActionComment(""); }}
                            className="border-red-200 text-red-600 hover:bg-red-50"
                            data-testid={`button-reject-leave-${sl.id}`}
                          >
                            <XCircle className="w-3 h-3 mr-1" />
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setPendingAction({ id: sl.id, type: "escalate" }); setActionComment(""); }}
                            data-testid={`button-forward-leave-${sl.id}`}
                          >
                            <Forward className="w-3 h-3 mr-1" />
                            Escalate
                          </Button>
                        </div>
                      )}

                      {/* ── Inline Confirm Panel (shown after clicking any action) ── */}
                      {sl.status === "pending_teacher" && pendingAction?.id === sl.id && (
                        <div className="mt-2 space-y-2 p-3 rounded-md border border-gray-200 bg-white">
                          <p className="text-xs font-medium text-gray-700">
                            {pendingAction.type === "approve" && "✓ Approving this leave request"}
                            {pendingAction.type === "reject" && "✕ Rejecting this leave request"}
                            {pendingAction.type === "escalate" && "→ Escalating to Principal"}
                          </p>
                          <Textarea
                            placeholder={
                              pendingAction.type === "approve"
                                ? "Add a note for the student (optional)…"
                                : pendingAction.type === "reject"
                                ? "Reason for rejection (optional)…"
                                : "Reason for escalating to principal (optional)…"
                            }
                            value={actionComment}
                            onChange={e => setActionComment(e.target.value)}
                            rows={2}
                            className="text-sm text-gray-900 resize-none"
                            data-testid={`input-action-comment-${sl.id}`}
                          />
                          <div className="flex gap-2">
                            {pendingAction.type === "approve" && (
                              <Button
                                size="sm"
                                onClick={() => approveMutation.mutate({ id: sl.id, comment: actionComment })}
                                disabled={approveMutation.isPending}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                data-testid={`button-confirm-approve-${sl.id}`}
                              >
                                {approveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                                Confirm Approve
                              </Button>
                            )}
                            {pendingAction.type === "reject" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => rejectMutation.mutate({ id: sl.id, reason: actionComment })}
                                disabled={rejectMutation.isPending}
                                data-testid={`button-confirm-reject-${sl.id}`}
                              >
                                {rejectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                                Confirm Reject
                              </Button>
                            )}
                            {pendingAction.type === "escalate" && (
                              <Button
                                size="sm"
                                onClick={() => forwardMutation.mutate({ id: sl.id, comment: actionComment })}
                                disabled={forwardMutation.isPending}
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                                data-testid={`button-confirm-escalate-${sl.id}`}
                              >
                                {forwardMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Forward className="w-3 h-3 mr-1" />}
                                Confirm Escalate
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setPendingAction(null); setActionComment(""); }}
                              data-testid={`button-cancel-action-${sl.id}`}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                      {sl.status === "rejected" && sl.rejectionReason && (
                        <p className="text-xs text-red-500 mt-1">Reason: {sl.rejectionReason}</p>
                      )}
                      {sl.status === "forwarded_to_admin" && (
                        <p className="text-xs text-blue-500 mt-1">Sent to Principal for final review</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Student Leave Detail Modal ── */}
      {selectedLeave && (
        <Dialog open={!!selectedLeave} onOpenChange={() => setSelectedLeave(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-gray-900 text-lg font-bold">Student Leave Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Student</span>
                <span className="font-semibold text-gray-900 text-sm">
                  {selectedLeave.studentName}
                  {selectedLeave.dsid && (
                    <span className="ml-1.5 font-normal text-gray-400 text-[11px]">({selectedLeave.dsid})</span>
                  )}
                </span>
              </div>
              {selectedLeave.class && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Class</span>
                  <span className="text-gray-900 text-sm">{selectedLeave.class}-{selectedLeave.section}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Dates</span>
                <span className="text-gray-900 text-sm">
                  {fmtDate(selectedLeave.startDate)} – {fmtDate(selectedLeave.endDate)}
                </span>
              </div>
              {selectedLeave.category && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Category</span>
                  <span className="text-gray-900 text-sm">{selectedLeave.category}</span>
                </div>
              )}
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs text-gray-500 mt-0.5 flex-shrink-0">Reason</span>
                <span className="text-gray-900 text-sm text-right leading-relaxed">{selectedLeave.reason}</span>
              </div>
              {selectedLeave.attachmentUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Attachment</span>
                  <a
                    href={selectedLeave.attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 text-sm transition-colors"
                    data-testid={`link-teacher-leave-attachment-${selectedLeave.id}`}
                  >
                    <Paperclip className="w-3 h-3" /> View file
                  </a>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Submitted</span>
                <span className="text-gray-900 text-sm">{fmtDate(selectedLeave.createdAt)}</span>
              </div>
            </div>
            <DialogFooter className="gap-2 mt-1">
              <Button variant="outline" onClick={() => setSelectedLeave(null)} data-testid="button-close-leave-detail">
                Close
              </Button>
              {selectedLeave.status === "pending_teacher" && (
                <>
                  <Button
                    variant="outline"
                    className="border-red-200 text-red-600 hover:bg-red-50"
                    onClick={() => { setRejectingId(selectedLeave.id); setRejectionReason(""); setSelectedLeave(null); }}
                    data-testid={`button-detail-reject-${selectedLeave.id}`}
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                  </Button>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => { approveMutation.mutate(selectedLeave.id); setSelectedLeave(null); }}
                    disabled={approveMutation.isPending}
                    data-testid={`button-detail-approve-${selectedLeave.id}`}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
