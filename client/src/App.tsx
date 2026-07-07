import { lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { StudentSessionProvider } from "@/contexts/student-session-provider";

import NotFound from "@/pages/not-found";
import Home from "@/pages/home";

// Core dashboards — eager-loaded so there is zero Suspense delay after login
import AdminDashboard  from "@/pages/admin-dashboard";
import TeacherDashboard from "@/pages/teacher-dashboard";
import Login           from "@/pages/login";
import StudentLogin    from "@/pages/student-login";
import TeacherLogin    from "@/pages/teacher-login";

// Everything else stays lazy — only downloaded when first visited
const SuperMaster         = lazy(() => import("@/pages/super-master"));
const Register            = lazy(() => import("@/pages/register"));
const AdminSetup          = lazy(() => import("@/pages/admin-setup"));
const StudentDashboard    = lazy(() => import("@/pages/student-dashboard"));
const StudentProfilePage  = lazy(() => import("@/pages/student-profile"));
const StudentAttendance   = lazy(() => import("@/pages/student-attendance"));
const StudentHomework     = lazy(() => import("@/pages/student-homework"));
const StudentClasswork    = lazy(() => import("@/pages/student-classwork"));
const StudentExamination  = lazy(() => import("@/pages/student-examination"));
const StudentComplaints   = lazy(() => import("@/pages/student-complaints"));
const StudentGallery      = lazy(() => import("@/pages/student-gallery"));
const StudentFaculty      = lazy(() => import("@/pages/student-faculty"));
const StudentCalendar     = lazy(() => import("@/pages/student-calendar"));
const StudentTimetable    = lazy(() => import("@/pages/student-timetable"));
const StudentLeave        = lazy(() => import("@/pages/student-leave"));
const StudentNoticeboard  = lazy(() => import("@/pages/student-noticeboard"));
const StudentFees         = lazy(() => import("@/pages/student-fees"));
const StudentArchives     = lazy(() => import("@/pages/student-archives"));
const StudentLibrary      = lazy(() => import("@/pages/student-library"));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#080c14" }}>
      <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
    </div>
  );
}

function TeacherRedirect({ module }: { module?: string }) {
  const [, nav] = useLocation();
  if (module) nav(`/teacher-dashboard/${module}`);
  else nav("/teacher-dashboard");
  return null;
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/super-master" component={SuperMaster} />
        <Route path="/login" component={Login} />
        <Route path="/admin-setup" component={AdminSetup} />
        <Route path="/admin-dashboard" component={AdminDashboard} />
        <Route path="/admin-dashboard/school-setup/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/timetable/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/approval-center/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/complaint-hub/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/analytics/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/id-card-gen/:tab" component={AdminDashboard} />
        <Route path="/admin-dashboard/:module" component={AdminDashboard} />
        <Route path="/register" component={Register} />
        <Route path="/student-login" component={StudentLogin} />
        <Route path="/student-dashboard" component={StudentDashboard} />
        <Route path="/student-profile" component={StudentProfilePage} />
        <Route path="/student/attendance" component={StudentAttendance} />
        <Route path="/student/homework" component={StudentHomework} />
        <Route path="/student/classwork" component={StudentClasswork} />
        <Route path="/student/examination" component={StudentExamination} />
        <Route path="/student/complaints" component={StudentComplaints} />
        <Route path="/student/gallery" component={StudentGallery} />
        <Route path="/student/faculty" component={StudentFaculty} />
        <Route path="/student/calendar" component={StudentCalendar} />
        <Route path="/student/timetable" component={StudentTimetable} />
        <Route path="/student/leave" component={StudentLeave} />
        <Route path="/student/noticeboard" component={StudentNoticeboard} />
        <Route path="/student/fees" component={StudentFees} />
        <Route path="/student/archives" component={StudentArchives} />
        <Route path="/student/library" component={StudentLibrary} />
        <Route path="/teacher-login" component={TeacherLogin} />
        <Route path="/teacher-dashboard" component={TeacherDashboard} />
        <Route path="/teacher-dashboard/:module" component={TeacherDashboard} />
        <Route path="/teacher/dashboard/:module">
          {(params) => <TeacherRedirect module={params.module} />}
        </Route>
        <Route path="/teacher/dashboard">
          {() => <TeacherRedirect />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <StudentSessionProvider>
          <Router />
        </StudentSessionProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
