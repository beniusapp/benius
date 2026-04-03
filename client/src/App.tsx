import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import SuperMaster from "@/pages/super-master";
import Login from "@/pages/login";
import AdminDashboard from "@/pages/admin-dashboard";
import Register from "@/pages/register";
import StudentLogin from "@/pages/student-login";
import StudentDashboard from "@/pages/student-dashboard";
import TeacherLogin from "@/pages/teacher-login";
import TeacherDashboard from "@/pages/teacher-dashboard";
import StudentProfilePage from "@/pages/student-profile";
import StudentAttendance from "@/pages/student-attendance";
import StudentHomework from "@/pages/student-homework";
import StudentClasswork from "@/pages/student-classwork";
import StudentExamination from "@/pages/student-examination";
import StudentComplaints from "@/pages/student-complaints";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/super-master" component={SuperMaster} />
      <Route path="/login" component={Login} />
      <Route path="/admin-dashboard" component={AdminDashboard} />
      <Route path="/register" component={Register} />
      <Route path="/student-login" component={StudentLogin} />
      <Route path="/student-dashboard" component={StudentDashboard} />
      <Route path="/student-profile" component={StudentProfilePage} />
      <Route path="/student/attendance" component={StudentAttendance} />
      <Route path="/student/homework" component={StudentHomework} />
      <Route path="/student/classwork" component={StudentClasswork} />
      <Route path="/student/examination" component={StudentExamination} />
      <Route path="/student/complaints" component={StudentComplaints} />
      <Route path="/teacher-login" component={TeacherLogin} />
      <Route path="/teacher-dashboard" component={TeacherDashboard} />
      <Route path="/teacher-dashboard/:module" component={TeacherDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
