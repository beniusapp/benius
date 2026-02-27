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
