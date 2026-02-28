import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Search, Save, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface StudentAttendance {
  studentId: number;
  name: string;
  dsid: string;
  status: string;
  editCount: number;
  markedBy: string | null;
  markedAt: string | null;
  hasRecord: boolean;
}

const statusOptions = [
  { value: "present", label: "Present", color: "bg-green-500 hover:bg-green-600" },
  { value: "absent", label: "Absent", color: "bg-red-500 hover:bg-red-600" },
  { value: "late", label: "Late", color: "bg-yellow-500 hover:bg-yellow-600" },
  { value: "halfday", label: "Half Day", color: "bg-orange-500 hover:bg-orange-600" },
];

export default function AttendanceModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [searchQuery, setSearchQuery] = useState("");
  const [localStatuses, setLocalStatuses] = useState<Record<number, string>>({});

  const sevenDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  }, []);

  const isEditable = selectedDate >= sevenDaysAgo && selectedDate <= today;

  const { data: students = [], isLoading, isError } = useQuery<StudentAttendance[]>({
    queryKey: ["/api/attendance", teacher.schoolId, teacher.assignedClass, teacher.assignedSection, selectedDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/attendance/${teacher.schoolId}/${teacher.assignedClass}/${teacher.assignedSection}/${selectedDate}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load attendance");
      return res.json();
    },
  });

  const filteredStudents = useMemo(() => {
    if (!searchQuery) return students;
    const q = searchQuery.toLowerCase();
    return students.filter(s => s.name.toLowerCase().includes(q) || s.dsid.toLowerCase().includes(q));
  }, [students, searchQuery]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const records = students.map(s => ({
        studentId: s.studentId,
        status: localStatuses[s.studentId] || s.status,
      }));
      const res = await apiRequest("POST", "/api/attendance", { date: selectedDate, records });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Attendance Saved", description: data.message });
      setLocalStatuses({});
      queryClient.invalidateQueries({ queryKey: ["/api/attendance", teacher.schoolId, teacher.assignedClass, teacher.assignedSection, selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher-me"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function getStatus(studentId: number, defaultStatus: string) {
    return localStatuses[studentId] || defaultStatus;
  }

  function setStatus(studentId: number, status: string) {
    setLocalStatuses(prev => ({ ...prev, [studentId]: status }));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-attendance-title">
            Class Attendance - {teacher.assignedClass} {teacher.assignedSection}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Date</label>
              <Input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setLocalStatuses({});
                }}
                className="w-44"
                data-testid="input-date"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or DSID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search"
                />
              </div>
            </div>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!isEditable || saveMutation.isPending}
              data-testid="button-save-attendance"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Save Attendance
            </Button>
          </div>

          {!isEditable && selectedDate < sevenDaysAgo && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              This date is outside the 7-day edit window.
            </div>
          )}
          {selectedDate > today && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              Cannot mark attendance for future dates.
            </div>
          )}
          {isError && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-attendance-error">
              <AlertCircle className="w-4 h-4" />
              Failed to load attendance data. Please try again later.
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-students">
          No students found for this class.
        </div>
      ) : (
        <div className="space-y-2">
          {filteredStudents.map((student) => {
            const currentStatus = getStatus(student.studentId, student.status);
            const locked = student.editCount >= 3;
            return (
              <Card key={student.studentId} className={locked ? "opacity-60" : ""} data-testid={`card-student-${student.studentId}`}>
                <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate" data-testid={`text-student-name-${student.studentId}`}>{student.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{student.dsid}</p>
                    {student.markedBy && (
                      <p className="text-xs text-muted-foreground mt-1" data-testid={`text-audit-${student.studentId}`}>
                        Last: {student.markedBy}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {statusOptions.map((opt) => (
                      <Button
                        key={opt.value}
                        size="sm"
                        variant={currentStatus === opt.value ? "default" : "outline"}
                        className={currentStatus === opt.value ? `${opt.color} text-white border-0 text-xs px-2.5` : "text-xs px-2.5"}
                        disabled={locked || !isEditable}
                        onClick={() => setStatus(student.studentId, opt.value)}
                        data-testid={`button-status-${opt.value}-${student.studentId}`}
                      >
                        {opt.label}
                      </Button>
                    ))}
                    {locked && (
                      <span className="text-xs text-destructive ml-1" data-testid={`text-locked-${student.studentId}`}>
                        Edit limit reached
                      </span>
                    )}
                    {student.editCount > 0 && !locked && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({student.editCount}/3 edits)
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
