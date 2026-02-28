import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Send, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface StudentInfo { studentId: number; name: string; dsid: string; }
interface ComplaintEntry { id: number; studentId: number; studentName: string; content: string; createdAt: string; }

export default function ComplaintModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [selectedStudent, setSelectedStudent] = useState("");
  const [content, setContent] = useState("");
  const [search, setSearch] = useState("");
  const today = new Date().toISOString().split("T")[0];

  const { data: students = [] } = useQuery<StudentInfo[]>({
    queryKey: ["/api/attendance", teacher.schoolId, teacher.assignedClass, teacher.assignedSection, today],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/${teacher.schoolId}/${teacher.assignedClass}/${teacher.assignedSection}/${today}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: complaints = [], isLoading } = useQuery<ComplaintEntry[]>({
    queryKey: ["/api/complaints/teacher", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/complaints/teacher/${teacher.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const filteredStudents = useMemo(() => {
    if (!search) return students;
    const q = search.toLowerCase();
    return students.filter(s => s.name.toLowerCase().includes(q) || s.dsid.toLowerCase().includes(q));
  }, [students, search]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/complaints", { studentId: parseInt(selectedStudent), content });
    },
    onSuccess: () => {
      toast({ title: "Complaint Filed" });
      setContent("");
      setSelectedStudent("");
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/teacher", teacher.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-complaint-title">File Complaint</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={selectedStudent} onValueChange={setSelectedStudent}>
            <SelectTrigger data-testid="select-student">
              <SelectValue placeholder="Select a student" />
            </SelectTrigger>
            <SelectContent>
              {students.map((s) => (
                <SelectItem key={s.studentId} value={String(s.studentId)}>
                  {s.name} ({s.dsid})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Describe the complaint..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            data-testid="input-complaint-content"
          />
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!selectedStudent || !content.trim() || submitMutation.isPending}
            data-testid="button-submit-complaint"
          >
            {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Submit Complaint
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Complaint History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : complaints.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-complaints">No complaints filed yet.</p>
          ) : (
            <div className="space-y-3">
              {complaints.map((c) => (
                <div key={c.id} className="p-3 rounded-md border" data-testid={`card-complaint-${c.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{c.studentName}</span>
                    <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
