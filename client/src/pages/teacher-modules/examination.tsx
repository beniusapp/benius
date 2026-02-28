import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface StudentInfo { studentId: number; name: string; dsid: string; }
interface ExamScoreEntry { id: number; studentId: number; studentName: string; dsid: string; marks: number; }

const examTypes = ["Unit Test 1", "Unit Test 2", "Mid-term", "Final"];

export default function ExaminationModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [subject, setSubject] = useState(teacher.subject);
  const [examType, setExamType] = useState("");
  const [marks, setMarks] = useState<Record<number, string>>({});
  const today = new Date().toISOString().split("T")[0];

  const { data: students = [] } = useQuery<StudentInfo[]>({
    queryKey: ["/api/attendance", teacher.schoolId, teacher.assignedClass, teacher.assignedSection, today],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/${teacher.schoolId}/${teacher.assignedClass}/${teacher.assignedSection}/${today}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: existingScores = [] } = useQuery<ExamScoreEntry[]>({
    queryKey: ["/api/exam-scores", teacher.schoolId, subject, examType, teacher.assignedClass, teacher.assignedSection],
    queryFn: async () => {
      if (!subject || !examType) return [];
      const res = await fetch(`/api/exam-scores/${teacher.schoolId}/${encodeURIComponent(subject)}/${encodeURIComponent(examType)}/${teacher.assignedClass}/${teacher.assignedSection}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subject && !!examType,
  });

  useEffect(() => {
    if (existingScores.length > 0) {
      const m: Record<number, string> = {};
      existingScores.forEach(s => { m[s.studentId] = String(s.marks); });
      setMarks(m);
    }
  }, [existingScores]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const scores = students
        .filter(s => marks[s.studentId] !== undefined && marks[s.studentId] !== "")
        .map(s => ({ studentId: s.studentId, marks: marks[s.studentId] }));
      const res = await apiRequest("POST", "/api/exam-scores", { scores, subject, examType });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Scores Saved", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/exam-scores", teacher.schoolId, subject, examType, teacher.assignedClass, teacher.assignedSection] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-examination-title">
            Examination - Class {teacher.assignedClass} {teacher.assignedSection}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Subject</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="input-subject" />
            </div>
            <div className="space-y-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Exam Type</label>
              <Select value={examType} onValueChange={setExamType}>
                <SelectTrigger data-testid="select-exam-type"><SelectValue placeholder="Select exam type" /></SelectTrigger>
                <SelectContent>
                  {examTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {examType && students.length > 0 && (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>DSID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-32">Marks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((s) => (
                      <TableRow key={s.studentId} data-testid={`row-student-${s.studentId}`}>
                        <TableCell className="font-mono text-sm">{s.dsid}</TableCell>
                        <TableCell>{s.name}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={marks[s.studentId] || ""}
                            onChange={(e) => setMarks(prev => ({ ...prev, [s.studentId]: e.target.value }))}
                            className="w-20"
                            data-testid={`input-marks-${s.studentId}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-scores">
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save Scores
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
