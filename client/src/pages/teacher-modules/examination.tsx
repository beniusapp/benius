import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Save, GraduationCap, BarChart3, Download, ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";
import { useSchoolConfigStrict } from "@/hooks/use-school-config";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

interface StudentInfo { studentId: number; name: string; dsid: string; }
interface ExamScoreEntry {
  id: number;
  studentId: number;
  studentName: string;
  dsid: string;
  marks: number;
  totalMarks: number;
  isAbsent: boolean;
}
interface StudentExamScore {
  id: number;
  subject: string;
  examType: string;
  marks: number;
  totalMarks: number;
  isAbsent: boolean;
}

function getGrade(pct: number): { grade: string; color: string } {
  if (pct >= 90) return { grade: "A+", color: "text-emerald-700 bg-emerald-100" };
  if (pct >= 80) return { grade: "A", color: "text-green-700 bg-green-100" };
  if (pct >= 70) return { grade: "B+", color: "text-teal-700 bg-teal-100" };
  if (pct >= 60) return { grade: "B", color: "text-blue-700 bg-blue-100" };
  if (pct >= 50) return { grade: "C+", color: "text-indigo-700 bg-indigo-100" };
  if (pct >= 40) return { grade: "C", color: "text-amber-700 bg-amber-100" };
  if (pct >= 33) return { grade: "D", color: "text-orange-700 bg-orange-100" };
  return { grade: "F", color: "text-red-700 bg-red-100" };
}

interface ClassAvgEntry { examType: string; avgPercentage: number; }

function StudentTimeline({ studentId, studentName, schoolId, subject, examTypes, viewClass, viewSection }: {
  studentId: number; studentName: string; schoolId: number; subject: string; examTypes: string[];
  viewClass: string; viewSection: string;
}) {
  const { data: scores = [], isLoading } = useQuery<StudentExamScore[]>({
    queryKey: ["/api/exam-scores/student", studentId, schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/exam-scores/student/${studentId}/${schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: classAverages = [] } = useQuery<ClassAvgEntry[]>({
    queryKey: ["/api/exam-scores/class-average", schoolId, viewClass, viewSection, subject],
    queryFn: async () => {
      const res = await fetch(`/api/exam-scores/class-average/${schoolId}/${encodeURIComponent(viewClass)}/${encodeURIComponent(viewSection)}/${encodeURIComponent(subject)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!viewClass && !!viewSection && !!subject,
  });

  const subjectScores = useMemo(() => scores.filter(s => s.subject === subject && !s.isAbsent), [scores, subject]);

  const chartData = useMemo(() => {
    const avgMap = new Map(classAverages.map(a => [a.examType, a.avgPercentage]));
    return examTypes.map(et => {
      const s = subjectScores.find(sc => sc.examType === et);
      const studentPct = s ? Math.round((s.marks / s.totalMarks) * 100) : null;
      const classAvg = avgMap.get(et) ?? null;
      if (studentPct === null && classAvg === null) return null;
      return { exam: et, studentPct, classAvg };
    }).filter(Boolean) as { exam: string; studentPct: number | null; classAvg: number | null }[];
  }, [subjectScores, classAverages, examTypes]);

  const allSubjects = useMemo(() => {
    const map: Record<string, StudentExamScore[]> = {};
    for (const s of scores) {
      if (!map[s.subject]) map[s.subject] = [];
      map[s.subject].push(s);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [scores]);

  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="mt-3 p-4 bg-muted/30 rounded-xl border" data-testid={`timeline-${studentId}`}>
      <h4 className="text-sm font-bold mb-3">{studentName} — Performance ({subject})</h4>

      {subjectScores.length === 0 ? (
        <p className="text-xs text-muted-foreground">No exam records found for this subject.</p>
      ) : (
        <>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1.5 px-2">Exam</th>
                  <th className="text-center py-1.5 px-2">Marks</th>
                  <th className="text-center py-1.5 px-2">%</th>
                  <th className="text-center py-1.5 px-2">Grade</th>
                </tr>
              </thead>
              <tbody>
                {subjectScores.map((s, i) => {
                  const pct = Math.round((s.marks / s.totalMarks) * 100);
                  const g = getGrade(pct);
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 px-2 font-medium">{s.examType}</td>
                      <td className="py-1.5 px-2 text-center">{s.marks}/{s.totalMarks}</td>
                      <td className="py-1.5 px-2 text-center">{pct}%</td>
                      <td className="py-1.5 px-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${g.color}`}>{g.grade}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {chartData.length > 1 && (
            <div className="h-52 w-full" data-testid={`chart-dual-line-${studentId}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="exam" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip formatter={(value: number, name: string) => [`${value}%`, name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="studentPct" stroke="#6366f1" strokeWidth={2}
                    name={`${studentName}`} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
                  <Line type="monotone" dataKey="classAvg" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5"
                    name="Class Average" dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {allSubjects.length > 0 && (
        <div className="mt-4 pt-4 border-t" data-testid={`history-360-${studentId}`}>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="w-4 h-4 text-indigo-500" />
            <h4 className="text-sm font-bold">360° Academic History</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {allSubjects.map(([subj, subjectScoresList]) => (
              <div key={subj} className="rounded-lg border bg-background p-3" data-testid={`history-subject-${subj}`}>
                <h5 className="text-xs font-semibold mb-2 text-indigo-600">{subj}</h5>
                <div className="space-y-1">
                  {subjectScoresList.map((s, i) => {
                    if (s.isAbsent) {
                      return (
                        <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-muted-foreground">{s.examType}</span>
                          <span className="font-bold text-gray-500">AB</span>
                        </div>
                      );
                    }
                    const pct = Math.round((s.marks / s.totalMarks) * 100);
                    const g = getGrade(pct);
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-muted-foreground">{s.examType}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.marks}/{s.totalMarks}</span>
                          <span className="text-muted-foreground">({pct}%)</span>
                          <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${g.color}`}>{g.grade}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExaminationModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const {
    classes,
    subjects,
    examTypes,
    isLoading: configLoading,
    hasClasses,
    hasSections,
    getSectionsForClass,
    getSubjectsForClass,
    getExamTypesForClass,
  } = useSchoolConfigStrict(teacher.schoolId);
  const today = new Date().toISOString().split("T")[0];
  const [tab, setTab] = useState<"add" | "view">("add");

  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [subject, setSubject] = useState("");
  const [examType, setExamType] = useState("");
  const [totalMarks, setTotalMarks] = useState("100");
  const [marks, setMarks] = useState<Record<number, string>>({});
  const [absentMap, setAbsentMap] = useState<Record<number, boolean>>({});
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const [viewClass, setViewClass] = useState("");
  const [viewSection, setViewSection] = useState("");
  const [viewSubject, setViewSubject] = useState("");

  const addSectionOpts = useMemo(
    () => getSectionsForClass(selectedClass),
    [selectedClass, getSectionsForClass]
  );
  const viewSectionOpts = useMemo(
    () => getSectionsForClass(viewClass),
    [viewClass, getSectionsForClass]
  );
  const addSubjectOpts = useMemo(
    () => getSubjectsForClass(selectedClass),
    [selectedClass, getSubjectsForClass]
  );
  const viewSubjectOpts = useMemo(
    () => getSubjectsForClass(viewClass),
    [viewClass, getSubjectsForClass]
  );
  const addExamTypeOpts = useMemo(
    () => getExamTypesForClass(selectedClass),
    [selectedClass, getExamTypesForClass]
  );
  const viewExamTypeOpts = useMemo(
    () => getExamTypesForClass(viewClass),
    [viewClass, getExamTypesForClass]
  );

  function handleAddClassChange(cls: string) {
    setSelectedClass(cls);
    setSelectedSection("");
    setSubject("");
    setExamType("");
  }
  function handleViewClassChange(cls: string) {
    setViewClass(cls);
    setViewSection("");
    setViewSubject("");
  }
  const [viewExamType, setViewExamType] = useState("");
  const [expandedStudent, setExpandedStudent] = useState<number | null>(null);

  const { data: students = [] } = useQuery<StudentInfo[]>({
    queryKey: ["/api/attendance", teacher.schoolId, selectedClass, selectedSection, today],
    queryFn: async () => {
      const res = await fetch(`/api/attendance/${teacher.schoolId}/${encodeURIComponent(selectedClass)}/${selectedSection}/${today}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedClass && !!selectedSection,
  });

  const { data: existingScores = [] } = useQuery<ExamScoreEntry[]>({
    queryKey: ["/api/exam-scores", teacher.schoolId, subject, examType, selectedClass, selectedSection],
    queryFn: async () => {
      if (!subject || !examType) return [];
      const res = await fetch(`/api/exam-scores/${teacher.schoolId}/${encodeURIComponent(subject)}/${encodeURIComponent(examType)}/${encodeURIComponent(selectedClass)}/${selectedSection}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!subject && !!examType && !!selectedClass && !!selectedSection,
  });

  const { data: viewScores = [], isLoading: viewLoading } = useQuery<ExamScoreEntry[]>({
    queryKey: ["/api/exam-scores", teacher.schoolId, viewSubject, viewExamType, viewClass, viewSection],
    queryFn: async () => {
      if (!viewSubject || !viewExamType) return [];
      const res = await fetch(`/api/exam-scores/${teacher.schoolId}/${encodeURIComponent(viewSubject)}/${encodeURIComponent(viewExamType)}/${encodeURIComponent(viewClass)}/${viewSection}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: tab === "view" && !!viewSubject && !!viewExamType && !!viewClass && !!viewSection,
  });

  useEffect(() => {
    if (existingScores.length > 0) {
      const m: Record<number, string> = {};
      const a: Record<number, boolean> = {};
      existingScores.forEach(s => {
        m[s.studentId] = String(s.marks);
        a[s.studentId] = s.isAbsent;
      });
      setMarks(m);
      setAbsentMap(a);
    }
  }, [existingScores]);

  const maxMarks = parseInt(totalMarks) || 100;

  const hasInvalidMarks = useMemo(() => {
    return students.some(s => {
      if (absentMap[s.studentId]) return false;
      const v = parseInt(marks[s.studentId] || "0");
      return v > maxMarks;
    });
  }, [students, marks, absentMap, maxMarks]);

  const classAverage = useMemo(() => {
    const validStudents = students.filter(s => !absentMap[s.studentId] && marks[s.studentId] && marks[s.studentId] !== "");
    if (validStudents.length === 0) return null;
    const total = validStudents.reduce((sum, s) => sum + (parseInt(marks[s.studentId]) || 0), 0);
    return Math.round((total / validStudents.length / maxMarks) * 100);
  }, [students, marks, absentMap, maxMarks]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const scores = students
        .filter(s => absentMap[s.studentId] || (marks[s.studentId] !== undefined && marks[s.studentId] !== ""))
        .map(s => ({
          studentId: s.studentId,
          marks: absentMap[s.studentId] ? 0 : marks[s.studentId],
          isAbsent: !!absentMap[s.studentId],
        }));
      const res = await apiRequest("POST", "/api/exam-scores", { scores, subject, examType, totalMarks: maxMarks });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Scores Saved", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/exam-scores", teacher.schoolId, subject, examType, selectedClass, selectedSection] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleTabNav = useCallback((studentId: number, studentIndex: number, e: React.KeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const nextIndex = e.shiftKey ? studentIndex - 1 : studentIndex + 1;
      if (nextIndex >= 0 && nextIndex < students.length) {
        const nextStudent = students[nextIndex];
        inputRefs.current[nextStudent.studentId]?.focus();
      }
    }
  }, [students]);

  const readyToSave = !!selectedClass && !!selectedSection && !!subject && !!examType && !hasInvalidMarks;

  const notConfigured = !configLoading && (!hasClasses || !hasSections);

  if (configLoading) {
    return (
      <div className="space-y-4" data-testid="loading-config">
        {[0,1].map(i => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (notConfigured) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-6 text-center" data-testid="banner-not-configured">
        <GraduationCap className="w-8 h-8 mx-auto text-amber-500 mb-3" />
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">School setup incomplete</p>
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Ask your admin to configure classes and sections in School Setup before recording exam scores.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2 p-1 bg-muted/50 rounded-xl" data-testid="tabs-exam">
        <button onClick={() => setTab("add")}
          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            tab === "add" ? "bg-white dark:bg-gray-900 shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`} data-testid="tab-add-marks">
          <GraduationCap className="w-4 h-4 inline mr-1.5" />
          Add Marks
        </button>
        <button onClick={() => setTab("view")}
          className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
            tab === "view" ? "bg-white dark:bg-gray-900 shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`} data-testid="tab-view-marks">
          <BarChart3 className="w-4 h-4 inline mr-1.5" />
          View Marks
        </button>
      </div>

      {tab === "add" && (
        <Card className="rounded-2xl shadow-lg border-0 bg-white dark:bg-gray-950" data-testid="card-add-marks">
          <CardContent className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <GraduationCap className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-bold tracking-tight" data-testid="text-examination-title">
                Examination & Performance Engine
              </h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Class *</label>
                <Select value={selectedClass} onValueChange={handleAddClassChange}>
                  <SelectTrigger className="rounded-xl" data-testid="select-class">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Section *</label>
                <Select value={selectedSection} onValueChange={setSelectedSection} disabled={!selectedClass}>
                  <SelectTrigger className="rounded-xl" data-testid="select-section">
                    <SelectValue placeholder="Select section" />
                  </SelectTrigger>
                  <SelectContent>
                    {addSectionOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Subject *</label>
                {addSubjectOpts.length > 0 ? (
                  <Select value={subject} onValueChange={setSubject}>
                    <SelectTrigger className="rounded-xl" data-testid="select-subject">
                      <SelectValue placeholder="Select subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {addSubjectOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)}
                    placeholder="Enter subject *" className="rounded-xl" data-testid="input-subject" />
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Exam Type *</label>
                <Select value={examType} onValueChange={setExamType}>
                  <SelectTrigger className="rounded-xl" data-testid="select-exam-type">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {addExamTypeOpts.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Total Marks</label>
                <Input type="number" value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)}
                  min="1" className="rounded-xl" data-testid="input-total-marks" />
              </div>
            </div>

            {examType && selectedClass && selectedSection && students.length > 0 && (
              <>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm" data-testid="table-marks">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground w-10">#</th>
                        <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">DSID</th>
                        <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Name</th>
                        <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground w-24">Marks</th>
                        <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground w-16">%</th>
                        <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground w-16">Grade</th>
                        <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground w-12">Ab</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s, idx) => {
                        const isAbsent = !!absentMap[s.studentId];
                        const val = parseInt(marks[s.studentId] || "0");
                        const pct = isAbsent ? 0 : (maxMarks > 0 ? Math.round((val / maxMarks) * 100) : 0);
                        const g = getGrade(pct);
                        const isOverMax = !isAbsent && val > maxMarks;

                        return (
                          <tr key={s.studentId} className="border-b last:border-0 hover:bg-muted/20"
                            data-testid={`row-student-${s.studentId}`}>
                            <td className="py-2 px-3 text-xs text-muted-foreground">{idx + 1}</td>
                            <td className="py-2 px-3 font-mono text-xs">{s.dsid}</td>
                            <td className="py-2 px-3 text-sm font-medium">{s.name}</td>
                            <td className="py-2 px-3 text-center">
                              {isAbsent ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-gray-200 text-gray-600">AB</span>
                              ) : (
                                <Input
                                  ref={(el) => { inputRefs.current[s.studentId] = el; }}
                                  type="number"
                                  min="0"
                                  max={maxMarks}
                                  value={marks[s.studentId] || ""}
                                  onChange={(e) => setMarks(prev => ({ ...prev, [s.studentId]: e.target.value }))}
                                  onKeyDown={(e) => handleTabNav(s.studentId, idx, e)}
                                  className={`w-20 h-8 text-center rounded-lg text-xs mx-auto ${isOverMax ? "border-red-500 border-2 bg-red-50" : ""}`}
                                  data-testid={`input-marks-${s.studentId}`}
                                />
                              )}
                            </td>
                            <td className="py-2 px-3 text-center text-xs font-medium">
                              {isAbsent ? "—" : `${pct}%`}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {isAbsent ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${g.color}`}>{g.grade}</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <Checkbox
                                checked={isAbsent}
                                onCheckedChange={(checked) => {
                                  setAbsentMap(prev => ({ ...prev, [s.studentId]: !!checked }));
                                }}
                                data-testid={`checkbox-absent-${s.studentId}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {classAverage !== null && (
                      <tfoot>
                        <tr className="bg-muted/30 border-t-2">
                          <td colSpan={4} className="py-2.5 px-3 text-xs font-bold text-right">Class Average:</td>
                          <td className="py-2.5 px-3 text-center text-xs font-bold text-indigo-600">{classAverage}%</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${getGrade(classAverage).color}`}>
                              {getGrade(classAverage).grade}
                            </span>
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                {hasInvalidMarks && (
                  <p className="text-xs text-red-600 font-medium" data-testid="text-marks-error">
                    Some marks exceed the total marks limit ({maxMarks}). Please correct before saving.
                  </p>
                )}

                <Button
                  onClick={() => saveMutation.mutate()}
                  disabled={!readyToSave || saveMutation.isPending}
                  className={`w-full h-12 rounded-xl text-sm font-semibold transition-all ${
                    readyToSave
                      ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-md active:scale-[0.98]"
                      : "opacity-50 cursor-not-allowed bg-gradient-to-r from-indigo-600 to-purple-600 text-white"
                  }`}
                  data-testid="button-save-scores"
                >
                  {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Scores
                </Button>
              </>
            )}

            {examType && selectedClass && selectedSection && students.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <GraduationCap className="w-10 h-10 mx-auto mb-2 opacity-20" />
                No students found for this class/section.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "view" && (
        <Card className="rounded-2xl shadow-lg border-0 bg-white dark:bg-gray-950" data-testid="card-view-marks">
          <CardContent className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-bold tracking-tight">View Marks — 360° History</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Class *</label>
                <Select value={viewClass} onValueChange={handleViewClassChange}>
                  <SelectTrigger className="rounded-xl" data-testid="select-view-class">
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Section *</label>
                <Select value={viewSection} onValueChange={setViewSection} disabled={!viewClass}>
                  <SelectTrigger className="rounded-xl" data-testid="select-view-section">
                    <SelectValue placeholder="Select section" />
                  </SelectTrigger>
                  <SelectContent>
                    {viewSectionOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Subject *</label>
                {viewSubjectOpts.length > 0 ? (
                  <Select value={viewSubject} onValueChange={setViewSubject}>
                    <SelectTrigger className="rounded-xl" data-testid="select-view-subject">
                      <SelectValue placeholder="Select subject" />
                    </SelectTrigger>
                    <SelectContent>
                      {viewSubjectOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={viewSubject} onChange={(e) => setViewSubject(e.target.value)}
                    placeholder="Enter subject *" className="rounded-xl" data-testid="input-view-subject" />
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Exam Type *</label>
                <Select value={viewExamType} onValueChange={setViewExamType}>
                  <SelectTrigger className="rounded-xl" data-testid="select-view-exam-type">
                    <SelectValue placeholder="Select exam type" />
                  </SelectTrigger>
                  <SelectContent>
                    {viewExamTypeOpts.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {viewLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="rounded-xl border bg-card p-4 animate-pulse">
                    <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                    <div className="h-4 bg-muted rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : viewExamType && viewScores.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-scores">
                <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-20" />
                No scores recorded yet for this selection.
              </div>
            ) : viewExamType && viewScores.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm" data-testid="table-view-scores">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground w-10">#</th>
                        <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">DSID</th>
                        <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Name</th>
                        <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground">Marks</th>
                        <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground">%</th>
                        <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground">Grade</th>
                        <th className="text-center py-2.5 px-3 text-xs font-semibold text-muted-foreground w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewScores.map((s, idx) => {
                        const isExpanded = expandedStudent === s.studentId;
                        const pct = s.isAbsent ? 0 : Math.round((s.marks / s.totalMarks) * 100);
                        const g = getGrade(pct);
                        return (
                          <Fragment key={s.studentId}>
                            <tr className="border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                              onClick={() => setExpandedStudent(isExpanded ? null : s.studentId)}
                              data-testid={`row-view-${s.studentId}`}>
                              <td className="py-2 px-3 text-xs text-muted-foreground">{idx + 1}</td>
                              <td className="py-2 px-3 font-mono text-xs">{s.dsid}</td>
                              <td className="py-2 px-3 text-sm font-medium text-indigo-600 hover:underline">{s.studentName}</td>
                              <td className="py-2 px-3 text-center text-xs">
                                {s.isAbsent ? <span className="font-bold text-gray-500">AB</span> : `${s.marks}/${s.totalMarks}`}
                              </td>
                              <td className="py-2 px-3 text-center text-xs font-medium">
                                {s.isAbsent ? "—" : `${pct}%`}
                              </td>
                              <td className="py-2 px-3 text-center">
                                {s.isAbsent ? <span className="text-xs text-muted-foreground">—</span> : (
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${g.color}`}>{g.grade}</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center">
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={7} className="p-0">
                                  <StudentTimeline
                                    studentId={s.studentId}
                                    studentName={s.studentName}
                                    schoolId={teacher.schoolId}
                                    subject={viewSubject}
                                    examTypes={examTypes}
                                    viewClass={viewClass}
                                    viewSection={viewSection}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Button variant="outline" className="rounded-xl"
                  onClick={() => toast({ title: "Coming Soon", description: "PDF progress report generation will be available soon." })}
                  data-testid="button-download-report">
                  <Download className="w-4 h-4 mr-2" />
                  Download Progress Report
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
