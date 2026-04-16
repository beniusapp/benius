import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Send, CheckCircle, Forward, Calendar, Clock, XCircle, AlertCircle } from "lucide-react";
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

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
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
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const { data: leaves = [], isLoading } = useQuery<LeaveEntry[]>({
    queryKey: ["/api/leave/teacher", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/leave/teacher/${teacher.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: balanceItems = [], isLoading: balanceLoading } = useQuery<LeaveBalanceItem[]>({
    queryKey: ["/api/leave/balance", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/leave/balance/${teacher.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: policies = [] } = useQuery<LeavePolicy[]>({
    queryKey: ["/api/leave/policies", teacher.schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/leave/policies/${teacher.schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: studentLeaves = [], isLoading: studentLeavesLoading } = useQuery<StudentLeaveEntry[]>({
    queryKey: ["/api/student-leaves", teacher.schoolId, teacher.assignedClass, teacher.assignedSection],
    queryFn: async () => {
      const res = await fetch(
        `/api/student-leaves/${teacher.schoolId}/${encodeURIComponent(teacher.assignedClass)}/${encodeURIComponent(teacher.assignedSection)}`,
        { credentials: "include" }
      );
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
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/student-leaves/${id}/approve`, {});
    },
    onSuccess: () => {
      toast({ title: "Leave Approved", description: "Attendance has been auto-synced for the leave dates." });
      queryClient.invalidateQueries({ queryKey: ["/api/student-leaves", teacher.schoolId, teacher.assignedClass, teacher.assignedSection] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const forwardMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/student-leaves/${id}/forward`, {});
    },
    onSuccess: () => {
      toast({ title: "Leave Forwarded", description: "Leave request forwarded to principal." });
      queryClient.invalidateQueries({ queryKey: ["/api/student-leaves", teacher.schoolId, teacher.assignedClass, teacher.assignedSection] });
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
      setRejectingId(null);
      setRejectionReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/student-leaves", teacher.schoolId, teacher.assignedClass, teacher.assignedSection] });
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
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="w-4 h-4 text-gray-500" />
                      <span className="text-sm font-semibold text-gray-900" data-testid={`text-balance-label-${b.policyId}`}>
                        {b.name}
                      </span>
                      {b.remaining === 0 && (
                        <span className="ml-auto text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">Full</span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1 mb-1">
                      <span className="text-2xl font-bold text-gray-900" data-testid={`text-balance-remaining-${b.policyId}`}>
                        {b.remaining}
                      </span>
                      <span className="text-xs text-gray-400">
                        / {b.annualLimit + b.carryForward} remaining
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mb-1">
                      <div
                        className="h-1.5 rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${Math.min((b.used / (b.annualLimit + b.carryForward)) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400" data-testid={`text-balance-used-${b.policyId}`}>
                      {b.used} used
                      {b.carryForward > 0 && <span className="ml-1 text-emerald-600">· +{b.carryForward} carried over</span>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      <Clock className="w-3 h-3 inline mr-0.5" />
                      Valid until {formatDate(b.validUntil)}
                    </p>
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
                    <div key={l.id} className="p-3 rounded-md border border-gray-100 bg-gray-50" data-testid={`card-leave-${l.id}`}>
                      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm text-gray-900">{l.leaveType}</span>
                        <StatusBadge status={l.status} />
                      </div>
                      <p className="text-xs text-gray-500">
                        {formatDate(l.startDate)} to {formatDate(l.endDate)}
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
                Student Leave Requests — Class {teacher.assignedClass} {teacher.assignedSection}
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
                        <span className="font-medium text-sm text-gray-900" data-testid={`text-student-name-${sl.id}`}>
                          {sl.studentName || `Student #${sl.studentId}`}
                        </span>
                        <StatusBadge status={sl.status} />
                      </div>
                      <p className="text-xs text-gray-500">
                        {formatDate(sl.startDate)} to {formatDate(sl.endDate)}
                      </p>
                      <p className="text-sm mt-1 mb-2 text-gray-700">{sl.reason}</p>
                      {sl.status === "pending" && rejectingId !== sl.id && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            size="sm"
                            onClick={() => approveMutation.mutate(sl.id)}
                            disabled={approveMutation.isPending}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            data-testid={`button-approve-leave-${sl.id}`}
                          >
                            {approveMutation.isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <CheckCircle className="w-3 h-3 mr-1" />
                            )}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setRejectingId(sl.id); setRejectionReason(""); }}
                            className="border-red-200 text-red-600 hover:bg-red-50"
                            data-testid={`button-reject-leave-${sl.id}`}
                          >
                            <XCircle className="w-3 h-3 mr-1" />
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => forwardMutation.mutate(sl.id)}
                            disabled={forwardMutation.isPending}
                            data-testid={`button-forward-leave-${sl.id}`}
                          >
                            {forwardMutation.isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <Forward className="w-3 h-3 mr-1" />
                            )}
                            Escalate
                          </Button>
                        </div>
                      )}
                      {sl.status === "pending" && rejectingId === sl.id && (
                        <div className="mt-2 space-y-2">
                          <Textarea
                            placeholder="Reason for rejection (optional)..."
                            value={rejectionReason}
                            onChange={e => setRejectionReason(e.target.value)}
                            rows={2}
                            className="text-sm text-gray-900"
                            data-testid={`input-rejection-reason-${sl.id}`}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => rejectMutation.mutate({ id: sl.id, reason: rejectionReason })}
                              disabled={rejectMutation.isPending}
                              data-testid={`button-confirm-reject-${sl.id}`}
                            >
                              {rejectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                              Confirm Reject
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRejectingId(null)}>Cancel</Button>
                          </div>
                        </div>
                      )}
                      {sl.status === "rejected" && sl.rejectionReason && (
                        <p className="text-xs text-red-500 mt-1">Reason: {sl.rejectionReason}</p>
                      )}
                      {sl.status === "forwarded" && (
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
    </div>
  );
}
