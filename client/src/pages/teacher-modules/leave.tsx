import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface LeaveEntry { id: number; leaveType: string; startDate: string; endDate: string; reason: string; status: string; createdAt: string; }

const leaveTypes = ["Sick Leave", "Casual Leave", "Personal Leave"];

export default function LeaveModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const { data: leaves = [], isLoading } = useQuery<LeaveEntry[]>({
    queryKey: ["/api/leave/teacher", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/leave/teacher/${teacher.id}`, { credentials: "include" });
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
      setLeaveType(""); setStartDate(""); setEndDate(""); setReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/leave/teacher", teacher.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-leave-title">Apply for Leave</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={leaveType} onValueChange={setLeaveType}>
            <SelectTrigger data-testid="select-leave-type"><SelectValue placeholder="Select leave type" /></SelectTrigger>
            <SelectContent>
              {leaveTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Start Date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="input-start-date" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">End Date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} data-testid="input-end-date" />
            </div>
          </div>
          <Textarea placeholder="Reason for leave..." value={reason} onChange={(e) => setReason(e.target.value)} rows={3} data-testid="input-leave-reason" />
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!leaveType || !startDate || !endDate || !reason.trim() || submitMutation.isPending}
            data-testid="button-submit-leave"
          >
            {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Submit Request
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Leave History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-leaves">No leave requests yet.</p>
          ) : (
            <div className="space-y-3">
              {leaves.map((l) => (
                <div key={l.id} className="p-3 rounded-md border" data-testid={`card-leave-${l.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm">{l.leaveType}</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[l.status] || ""}`} data-testid={`badge-status-${l.id}`}>
                      {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{l.startDate} to {l.endDate}</p>
                  <p className="text-sm mt-1">{l.reason}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
