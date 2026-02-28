import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  GraduationCap, Loader2, LogOut, Users, Upload, AlertTriangle, UserPlus,
  ChevronDown, ChevronUp, Trash2, BookOpen, Calendar, Bell, Image,
  Clock, CalendarOff, Check, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import type { Student } from "@shared/schema";

interface MeResponse {
  id: number;
  email: string;
  role: string;
  schoolId: number;
  schoolName: string;
  schoolCode: string;
  studentCount: number;
}

interface UploadResponse {
  count: number;
  skipped: number;
  warnings: string[];
  message: string;
}

interface TeacherEntry {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  subject: string;
  assignedClass: string;
  assignedSection: string;
}

interface LeaveEntry {
  id: number;
  teacherName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
}

interface GalleryEntry {
  id: number;
  title: string;
  imageUrl: string;
  approved: boolean;
}

interface LibraryBookEntry {
  id: number;
  title: string;
  author: string;
  isbn: string | null;
  totalCopies: number;
  availableCopies: number;
}

interface CalendarEventEntry {
  id: number;
  title: string;
  date: string;
  eventType: string;
}

interface TimetableEntryData {
  id: number;
  teacherName: string;
  dayOfWeek: number;
  period: number;
  class: string;
  section: string;
  subject: string;
}

const addStudentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  class: z.string().min(1, "Class is required"),
  section: z.string().min(1, "Section is required"),
  phone: z.string().min(7, "Valid phone number is required"),
  dob: z.string().min(1, "Date of birth is required"),
});

type AddStudentForm = z.infer<typeof addStudentSchema>;

const addTeacherSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(6, "At least 6 characters"),
  phone: z.string().min(7, "Valid phone number is required"),
  subject: z.string().min(1, "Subject is required"),
  assignedClass: z.string().min(1, "Class is required"),
  assignedSection: z.string().min(1, "Section is required"),
});

type AddTeacherForm = z.infer<typeof addTeacherSchema>;

function CollapsibleSection({ title, icon: Icon, testId, children }: { title: string; icon: any; testId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icon className="w-5 h-5" />
            {title}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)} data-testid={`button-toggle-${testId}`}>
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTeacherForm, setShowTeacherForm] = useState(false);

  const [noticeContent, setNoticeContent] = useState("");
  const [calTitle, setCalTitle] = useState("");
  const [calDate, setCalDate] = useState("");
  const [calType, setCalType] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [bookIsbn, setBookIsbn] = useState("");
  const [bookCopies, setBookCopies] = useState("1");
  const [ttTeacher, setTtTeacher] = useState("");
  const [ttDay, setTtDay] = useState("");
  const [ttPeriod, setTtPeriod] = useState("");
  const [ttClass, setTtClass] = useState("");
  const [ttSection, setTtSection] = useState("");
  const [ttSubject, setTtSubject] = useState("");

  const form = useForm<AddStudentForm>({
    resolver: zodResolver(addStudentSchema),
    defaultValues: { name: "", class: "", section: "", phone: "", dob: "" },
  });

  const teacherForm = useForm<AddTeacherForm>({
    resolver: zodResolver(addTeacherSchema),
    defaultValues: { fullName: "", email: "", password: "", phone: "", subject: "", assignedClass: "", assignedSection: "" },
  });

  const { data: me, isLoading, isError } = useQuery<MeResponse | null>({
    queryKey: ["/api/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!isLoading && (isError || !me)) {
      setLocation("/login");
    }
  }, [isLoading, isError, me, setLocation]);

  const { data: students = [], isLoading: studentsLoading } = useQuery<Student[]>({
    queryKey: ["/api/schools", me?.schoolId, "students"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const res = await fetch(`/api/schools/${me.schoolId}/students`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch students");
      return res.json();
    },
    enabled: !!me?.schoolId,
  });

  const { data: teachersList = [] } = useQuery<TeacherEntry[]>({
    queryKey: ["/api/schools", me?.schoolId, "teachers"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const res = await fetch(`/api/schools/${me.schoolId}/teachers`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!me?.schoolId,
  });

  const { data: leaveRequests = [] } = useQuery<LeaveEntry[]>({
    queryKey: ["/api/leave/school", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const res = await fetch(`/api/leave/school/${me.schoolId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!me?.schoolId,
  });

  const { data: galleryItems = [] } = useQuery<GalleryEntry[]>({
    queryKey: ["/api/gallery", me?.schoolId, "all"],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const res = await fetch(`/api/gallery/${me.schoolId}?all=true`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!me?.schoolId,
  });

  const { data: libraryBooks = [] } = useQuery<LibraryBookEntry[]>({
    queryKey: ["/api/library/books", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const res = await fetch(`/api/library/books/${me.schoolId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!me?.schoolId,
  });

  const { data: calendarEvents = [] } = useQuery<CalendarEventEntry[]>({
    queryKey: ["/api/calendar", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const res = await fetch(`/api/calendar/${me.schoolId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!me?.schoolId,
  });

  const { data: timetableEntries = [] } = useQuery<TimetableEntryData[]>({
    queryKey: ["/api/timetable/school", me?.schoolId],
    queryFn: async () => {
      if (!me?.schoolId) return [];
      const res = await fetch(`/api/timetable/school/${me.schoolId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!me?.schoolId,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/logout"); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/me"] }); setLocation("/login"); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File): Promise<UploadResponse> => {
      const formData = new FormData(); formData.append("file", file);
      const res = await fetch(`/api/schools/${me!.schoolId}/students/upload`, { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Upload failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Upload Complete", description: data.message });
      if (data.warnings.length > 0) setUploadWarnings(data.warnings);
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schools", me?.schoolId, "students"] });
    },
    onError: (error: Error) => { toast({ title: "Upload Failed", description: error.message, variant: "destructive" }); },
  });

  const addStudentMutation = useMutation({
    mutationFn: async (data: AddStudentForm) => { const res = await apiRequest("POST", `/api/schools/${me!.schoolId}/students`, data); return res.json(); },
    onSuccess: (data) => {
      toast({ title: "Student Added", description: `DSID: ${data.digitalStudentId}` });
      form.reset(); setShowAddForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/schools", me?.schoolId, "students"] });
    },
    onError: (error: Error) => { toast({ title: "Failed to Add Student", description: error.message, variant: "destructive" }); },
  });

  const addTeacherMutation = useMutation({
    mutationFn: async (data: AddTeacherForm) => { const res = await apiRequest("POST", `/api/schools/${me!.schoolId}/teachers`, data); return res.json(); },
    onSuccess: () => {
      toast({ title: "Teacher Added" });
      teacherForm.reset(); setShowTeacherForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/schools", me?.schoolId, "teachers"] });
    },
    onError: (error: Error) => { toast({ title: "Failed", description: error.message, variant: "destructive" }); },
  });

  const deleteTeacherMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/teachers/${id}`); },
    onSuccess: () => { toast({ title: "Teacher Deleted" }); queryClient.invalidateQueries({ queryKey: ["/api/schools", me?.schoolId, "teachers"] }); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const postNoticeMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", noticeContent); fd.append("targetType", "teacher"); fd.append("schoolId", String(me!.schoolId));
      const res = await fetch("/api/notices", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
    },
    onSuccess: () => { toast({ title: "Notice Posted" }); setNoticeContent(""); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const addCalendarMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/calendar", { title: calTitle, date: calDate, eventType: calType, schoolId: me!.schoolId }); },
    onSuccess: () => {
      toast({ title: "Event Added" }); setCalTitle(""); setCalDate(""); setCalType("");
      queryClient.invalidateQueries({ queryKey: ["/api/calendar", me?.schoolId] });
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const deleteCalendarMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/calendar/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/calendar", me?.schoolId] }); },
  });

  const leaveStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => { await apiRequest("PATCH", `/api/leave/${id}/status`, { status }); },
    onSuccess: () => { toast({ title: "Leave Updated" }); queryClient.invalidateQueries({ queryKey: ["/api/leave/school", me?.schoolId] }); },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const approveGalleryMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("PATCH", `/api/gallery/${id}/approve`); },
    onSuccess: () => { toast({ title: "Image Approved" }); queryClient.invalidateQueries({ queryKey: ["/api/gallery", me?.schoolId, "all"] }); },
  });

  const addBookMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/library/books", { title: bookTitle, author: bookAuthor, isbn: bookIsbn || null, totalCopies: bookCopies, schoolId: me!.schoolId }); },
    onSuccess: () => {
      toast({ title: "Book Added" }); setBookTitle(""); setBookAuthor(""); setBookIsbn(""); setBookCopies("1");
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", me?.schoolId] });
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const deleteBookMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/library/books/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/library/books", me?.schoolId] }); },
  });

  const addTimetableMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/timetable", { teacherId: ttTeacher, schoolId: me!.schoolId, dayOfWeek: ttDay, period: ttPeriod, class: ttClass, section: ttSection, subject: ttSubject });
    },
    onSuccess: () => {
      toast({ title: "Timetable Entry Added" }); setTtDay(""); setTtPeriod(""); setTtClass(""); setTtSection(""); setTtSubject("");
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/school", me?.schoolId] });
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const deleteTimetableMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/timetable/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/timetable/school", me?.schoolId] }); },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) { setUploadWarnings([]); uploadMutation.mutate(file); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (isLoading || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const pendingLeaves = leaveRequests.filter(l => l.status === "pending");
  const pendingGallery = galleryItems.filter(g => !g.approved);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
              <GraduationCap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight" data-testid="text-dashboard-title">BENIUS</h1>
              <p className="text-xs text-muted-foreground">Admin Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground" data-testid="text-user-email">{me.email}</span>
            <Button variant="secondary" size="sm" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending} data-testid="button-logout">
              <LogOut className="w-3.5 h-3.5 mr-1" /> Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/10">
                  <GraduationCap className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">School</p>
                  <h2 className="text-lg font-bold tracking-tight" data-testid="text-school-name">{me.schoolName}</h2>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/10">
                  <Users className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Students</p>
                  <h2 className="text-lg font-bold tracking-tight" data-testid="text-student-count">{me.studentCount}</h2>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-md bg-primary/10">
                  <UserPlus className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Teachers</p>
                  <h2 className="text-lg font-bold tracking-tight" data-testid="text-teacher-count">{teachersList.length}</h2>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ADD STUDENT */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-lg"><UserPlus className="w-5 h-5" /> Add Student</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setShowAddForm(!showAddForm)} data-testid="button-toggle-add-form">
                {showAddForm ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                {showAddForm ? "Hide" : "Manual Add"}
              </Button>
            </div>
          </CardHeader>
          {showAddForm && (
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((d) => addStudentMutation.mutate(d))} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="Student full name" data-testid="input-add-name" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="class" render={({ field }) => (<FormItem><FormLabel>Class</FormLabel><FormControl><Input placeholder="e.g. 10" data-testid="input-add-class" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="section" render={({ field }) => (<FormItem><FormLabel>Section</FormLabel><FormControl><Input placeholder="e.g. A" data-testid="input-add-section" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="e.g. 9876543210" data-testid="input-add-phone" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="dob" render={({ field }) => (<FormItem><FormLabel>Date of Birth</FormLabel><FormControl><Input type="date" data-testid="input-add-dob" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <div className="flex items-end">
                    <Button type="submit" disabled={addStudentMutation.isPending} className="w-full" data-testid="button-add-student">
                      {addStudentMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                      Add Student
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          )}
        </Card>

        {/* STUDENT LIST */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-lg"><Users className="w-5 h-5" /> Student List</CardTitle>
              <div>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv,.xlsx,.xls" className="hidden" data-testid="input-file-upload" />
                <Button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending} data-testid="button-upload-students">
                  {uploadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                  Upload (Excel/CSV)
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {uploadWarnings.length > 0 && (
              <div className="mb-4 p-3 rounded-md bg-muted border border-border" data-testid="upload-warnings">
                <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-medium">Upload Warnings</span></div>
                <ul className="text-xs text-muted-foreground space-y-1">{uploadWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}
            {studentsLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : students.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-students">No students registered yet.</div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>DSID</TableHead><TableHead>Name</TableHead><TableHead>Class</TableHead><TableHead>Section</TableHead><TableHead>Phone</TableHead><TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((s) => (
                      <TableRow key={s.id} data-testid={`row-student-${s.id}`}>
                        <TableCell className="font-mono text-sm" data-testid={`text-dsid-${s.id}`}>{s.digitalStudentId}</TableCell>
                        <TableCell data-testid={`text-student-name-${s.id}`}>{s.name}</TableCell>
                        <TableCell>{s.class}</TableCell><TableCell>{s.section}</TableCell><TableCell>{s.phone}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.isActivated ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"}`} data-testid={`text-status-${s.id}`}>
                            {s.isActivated ? "Activated" : "Pending"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* MANAGE TEACHERS */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-lg"><Users className="w-5 h-5" /> Manage Teachers</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setShowTeacherForm(!showTeacherForm)} data-testid="button-toggle-teacher-form">
                {showTeacherForm ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                {showTeacherForm ? "Hide" : "Add Teacher"}
              </Button>
            </div>
          </CardHeader>
          {showTeacherForm && (
            <CardContent className="border-b pb-6">
              <Form {...teacherForm}>
                <form onSubmit={teacherForm.handleSubmit((d) => addTeacherMutation.mutate(d))} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <FormField control={teacherForm.control} name="fullName" render={({ field }) => (<FormItem><FormLabel>Full Name</FormLabel><FormControl><Input placeholder="Teacher name" data-testid="input-teacher-name" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={teacherForm.control} name="email" render={({ field }) => (<FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="teacher@school.com" data-testid="input-teacher-email" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={teacherForm.control} name="password" render={({ field }) => (<FormItem><FormLabel>Password</FormLabel><FormControl><Input type="password" placeholder="Initial password" data-testid="input-teacher-password" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={teacherForm.control} name="phone" render={({ field }) => (<FormItem><FormLabel>Phone</FormLabel><FormControl><Input placeholder="9876543210" data-testid="input-teacher-phone" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={teacherForm.control} name="subject" render={({ field }) => (<FormItem><FormLabel>Subject</FormLabel><FormControl><Input placeholder="e.g. Mathematics" data-testid="input-teacher-subject" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={teacherForm.control} name="assignedClass" render={({ field }) => (<FormItem><FormLabel>Class</FormLabel><FormControl><Input placeholder="e.g. 10" data-testid="input-teacher-class" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={teacherForm.control} name="assignedSection" render={({ field }) => (<FormItem><FormLabel>Section</FormLabel><FormControl><Input placeholder="e.g. A" data-testid="input-teacher-section" {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <div className="flex items-end">
                    <Button type="submit" disabled={addTeacherMutation.isPending} className="w-full" data-testid="button-add-teacher">
                      {addTeacherMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                      Add Teacher
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          )}
          <CardContent className={showTeacherForm ? "pt-6" : ""}>
            {teachersList.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-sm" data-testid="text-no-teachers">No teachers added yet.</div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Subject</TableHead><TableHead>Class</TableHead><TableHead>Section</TableHead><TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teachersList.map((t) => (
                      <TableRow key={t.id} data-testid={`row-teacher-${t.id}`}>
                        <TableCell data-testid={`text-teacher-name-${t.id}`}>{t.fullName}</TableCell>
                        <TableCell>{t.email}</TableCell><TableCell>{t.subject}</TableCell><TableCell>{t.assignedClass}</TableCell><TableCell>{t.assignedSection}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => deleteTeacherMutation.mutate(t.id)} data-testid={`button-delete-teacher-${t.id}`}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* TEACHER NOTICES */}
        <CollapsibleSection title="Post Notice to Teachers" icon={Bell} testId="notices">
          <div className="space-y-3">
            <Textarea placeholder="Notice content..." value={noticeContent} onChange={(e) => setNoticeContent(e.target.value)} rows={3} data-testid="input-admin-notice" />
            <Button onClick={() => postNoticeMutation.mutate()} disabled={!noticeContent.trim() || postNoticeMutation.isPending} data-testid="button-post-teacher-notice">
              {postNoticeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Bell className="w-4 h-4 mr-2" />}
              Post Notice
            </Button>
          </div>
        </CollapsibleSection>

        {/* CALENDAR EVENTS */}
        <CollapsibleSection title="Calendar Events" icon={Calendar} testId="calendar">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <Input placeholder="Event title" value={calTitle} onChange={(e) => setCalTitle(e.target.value)} className="max-w-xs" data-testid="input-cal-title" />
              <Input type="date" value={calDate} onChange={(e) => setCalDate(e.target.value)} className="w-44" data-testid="input-cal-date" />
              <Select value={calType} onValueChange={setCalType}>
                <SelectTrigger className="w-36" data-testid="select-cal-type"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="holiday">Holiday</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => addCalendarMutation.mutate()} disabled={!calTitle || !calDate || !calType || addCalendarMutation.isPending} data-testid="button-add-event">
                Add
              </Button>
            </div>
            {calendarEvents.length > 0 && (
              <div className="space-y-2">
                {calendarEvents.map(e => (
                  <div key={e.id} className="flex items-center justify-between p-2 rounded border text-sm" data-testid={`card-event-${e.id}`}>
                    <div>
                      <span className={`inline-block w-2 h-2 rounded-full mr-2 ${e.eventType === "holiday" ? "bg-red-500" : "bg-blue-500"}`} />
                      {e.title} — {e.date}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteCalendarMutation.mutate(e.id)} data-testid={`button-delete-event-${e.id}`}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* LEAVE REQUESTS */}
        <CollapsibleSection title={`Leave Requests${pendingLeaves.length > 0 ? ` (${pendingLeaves.length} pending)` : ""}`} icon={CalendarOff} testId="leave">
          {leaveRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-leave-requests">No leave requests.</p>
          ) : (
            <div className="space-y-3">
              {leaveRequests.map(l => (
                <div key={l.id} className="p-3 rounded-md border" data-testid={`card-leave-${l.id}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="font-medium text-sm">{l.teacherName} — {l.leaveType}</p>
                      <p className="text-xs text-muted-foreground">{l.startDate} to {l.endDate}</p>
                      <p className="text-sm mt-1">{l.reason}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {l.status === "pending" ? (
                        <>
                          <Button size="sm" variant="outline" className="text-green-600" onClick={() => leaveStatusMutation.mutate({ id: l.id, status: "approved" })} data-testid={`button-approve-leave-${l.id}`}>
                            <Check className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-600" onClick={() => leaveStatusMutation.mutate({ id: l.id, status: "rejected" })} data-testid={`button-reject-leave-${l.id}`}>
                            <X className="w-3.5 h-3.5 mr-1" /> Reject
                          </Button>
                        </>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${l.status === "approved" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                          {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* GALLERY APPROVAL */}
        <CollapsibleSection title={`Gallery${pendingGallery.length > 0 ? ` (${pendingGallery.length} pending)` : ""}`} icon={Image} testId="gallery">
          {galleryItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No gallery uploads.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {galleryItems.map(g => (
                <div key={g.id} className="border rounded-md overflow-hidden" data-testid={`card-gallery-admin-${g.id}`}>
                  <div className="aspect-square bg-muted overflow-hidden">
                    <img src={g.imageUrl} alt={g.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="p-2 flex items-center justify-between">
                    <p className="text-xs truncate">{g.title}</p>
                    {!g.approved && (
                      <Button size="sm" variant="outline" onClick={() => approveGalleryMutation.mutate(g.id)} data-testid={`button-approve-gallery-${g.id}`}>
                        <Check className="w-3 h-3 mr-1" /> Approve
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* LIBRARY */}
        <CollapsibleSection title="Library Management" icon={BookOpen} testId="library">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <Input placeholder="Book title" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} className="max-w-xs" data-testid="input-book-title" />
              <Input placeholder="Author" value={bookAuthor} onChange={(e) => setBookAuthor(e.target.value)} className="max-w-xs" data-testid="input-book-author" />
              <Input placeholder="ISBN" value={bookIsbn} onChange={(e) => setBookIsbn(e.target.value)} className="w-36" data-testid="input-book-isbn" />
              <Input type="number" min="1" placeholder="Copies" value={bookCopies} onChange={(e) => setBookCopies(e.target.value)} className="w-24" data-testid="input-book-copies" />
              <Button onClick={() => addBookMutation.mutate()} disabled={!bookTitle || !bookAuthor || addBookMutation.isPending} data-testid="button-add-book">
                Add Book
              </Button>
            </div>
            {libraryBooks.length > 0 && (
              <div className="space-y-2">
                {libraryBooks.map(b => (
                  <div key={b.id} className="flex items-center justify-between p-2 rounded border text-sm" data-testid={`card-book-admin-${b.id}`}>
                    <div>
                      <span className="font-medium">{b.title}</span> by {b.author}
                      <span className="text-muted-foreground ml-2">({b.availableCopies}/{b.totalCopies} available)</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteBookMutation.mutate(b.id)} data-testid={`button-delete-book-${b.id}`}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* TIMETABLE */}
        <CollapsibleSection title="Timetable Management" icon={Clock} testId="timetable">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <Select value={ttTeacher} onValueChange={setTtTeacher}>
                <SelectTrigger className="w-44" data-testid="select-tt-teacher"><SelectValue placeholder="Teacher" /></SelectTrigger>
                <SelectContent>
                  {teachersList.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={ttDay} onValueChange={setTtDay}>
                <SelectTrigger className="w-32" data-testid="select-tt-day"><SelectValue placeholder="Day" /></SelectTrigger>
                <SelectContent>
                  {dayNames.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={ttPeriod} onValueChange={setTtPeriod}>
                <SelectTrigger className="w-28" data-testid="select-tt-period"><SelectValue placeholder="Period" /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,4,5,6,7,8].map(p => <SelectItem key={p} value={String(p)}>Period {p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Class" value={ttClass} onChange={(e) => setTtClass(e.target.value)} className="w-20" data-testid="input-tt-class" />
              <Input placeholder="Section" value={ttSection} onChange={(e) => setTtSection(e.target.value)} className="w-20" data-testid="input-tt-section" />
              <Input placeholder="Subject" value={ttSubject} onChange={(e) => setTtSubject(e.target.value)} className="w-32" data-testid="input-tt-subject" />
              <Button onClick={() => addTimetableMutation.mutate()} disabled={!ttTeacher || !ttDay || !ttPeriod || !ttClass || !ttSection || !ttSubject} data-testid="button-add-timetable">
                Add
              </Button>
            </div>
            {timetableEntries.length > 0 && (
              <div className="space-y-2">
                {timetableEntries.map(e => (
                  <div key={e.id} className="flex items-center justify-between p-2 rounded border text-sm" data-testid={`card-tt-${e.id}`}>
                    <span>{e.teacherName} | {dayNames[e.dayOfWeek]} P{e.period} | {e.class}-{e.section} {e.subject}</span>
                    <Button variant="ghost" size="icon" onClick={() => deleteTimetableMutation.mutate(e.id)} data-testid={`button-delete-tt-${e.id}`}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleSection>
      </main>
    </div>
  );
}
