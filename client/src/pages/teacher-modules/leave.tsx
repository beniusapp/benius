import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Send, CheckCircle, Forward, Calendar, Briefcase, Clock, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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

interface LeaveBalance {
  sick: number;
  casual: number;
  earned: number;
  sickMax: number;
  casualMax: number;
  earnedMax: number;
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
}

const leaveTypes = ["Sick Leave", "Casual Leave", "Earned Leave"];

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  forwarded: "outline",
};

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

  const { data: balance, isLoading: balanceLoading } = useQuery<LeaveBalance>({
    queryKey: ["/api/leave/balance", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/leave/balance/${teacher.id}`, { credentials: "include" });
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
      await apiRequest("PATCH", `/api/student-leaves/${id}/teacher-reject`, { rejectionReason: reason });
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

  const balanceCards = [
    {
      label: "Sick Leave",
      used: balance?.sick ?? 0,
      max: balance?.sickMax ?? 12,
      icon: Briefcase,
    },
    {
      label: "Casual Leave",
      used: balance?.casual ?? 0,
      max: balance?.casualMax ?? 12,
      icon: Calendar,
    },
    {
      label: "Earned Leave",
      used: balance?.earned ?? 0,
      max: balance?.earnedMax ?? 15,
      icon: Clock,
    },
  ];

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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {balanceCards.map((b) => {
              const remaining = b.max - b.used;
              return (
                <Card key={b.label}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <b.icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium" data-testid={`text-balance-label-${b.label.toLowerCase().replace(/\s/g, "-")}`}>
                        {b.label}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold" data-testid={`text-balance-remaining-${b.label.toLowerCase().replace(/\s/g, "-")}`}>
                        {balanceLoading ? "-" : remaining}
                      </span>
                      <span className="text-xs text-muted-foreground">/ {b.max} remaining</span>
                    </div>
                    <div className="mt-2 w-full bg-muted rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-primary transition-all"
                        style={{ width: `${Math.min((b.used / b.max) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1" data-testid={`text-balance-used-${b.label.toLowerCase().replace(/\s/g, "-")}`}>
                      {balanceLoading ? "..." : `${b.used} used`}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg" data-testid="text-leave-title">Apply for Leave</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={leaveType} onValueChange={setLeaveType}>
                <SelectTrigger data-testid="select-leave-type">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Start Date</label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="input-start-date"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">End Date</label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="input-end-date"
                  />
                </div>
              </div>
              <Textarea
                placeholder="Reason for leave..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                data-testid="input-leave-reason"
              />
              <Button
                onClick={() => submitMutation.mutate()}
                disabled={!leaveType || !startDate || !endDate || !reason.trim() || submitMutation.isPending}
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

          <Card>
            <CardHeader>
              <CardTitle className="text-lg" data-testid="text-leave-history-title">Leave History</CardTitle>
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
                    <div key={l.id} className="p-3 rounded-md border" data-testid={`card-leave-${l.id}`}>
                      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm">{l.leaveType}</span>
                        <Badge variant={statusVariant[l.status] || "secondary"} data-testid={`badge-status-${l.id}`}>
                          {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(l.startDate)} to {formatDate(l.endDate)}
                      </p>
                      <p className="text-sm mt-1">{l.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="student-leave" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg" data-testid="text-student-leave-title">
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
                    <div key={sl.id} className="p-3 rounded-md border" data-testid={`card-student-leave-${sl.id}`}>
                      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                        <span className="font-medium text-sm" data-testid={`text-student-name-${sl.id}`}>
                          {sl.studentName || `Student #${sl.studentId}`}
                        </span>
                        <Badge variant={statusVariant[sl.status] || "secondary"} data-testid={`badge-student-status-${sl.id}`}>
                          {sl.status.charAt(0).toUpperCase() + sl.status.slice(1)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(sl.startDate)} to {formatDate(sl.endDate)}
                      </p>
                      <p className="text-sm mt-1 mb-2">{sl.reason}</p>
                      {sl.status === "pending" && rejectingId !== sl.id && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            size="sm"
                            onClick={() => approveMutation.mutate(sl.id)}
                            disabled={approveMutation.isPending}
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
                            className="text-sm"
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
                      {sl.status === "rejected" && (sl as StudentLeaveEntry & { rejectionReason?: string }).rejectionReason && (
                        <p className="text-xs text-red-500 mt-1">Reason: {(sl as StudentLeaveEntry & { rejectionReason?: string }).rejectionReason}</p>
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
