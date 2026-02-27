import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { GraduationCap, Loader2, LogOut, IdCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface StudentMeResponse {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  phone: string;
  dob: string;
  schoolName: string;
  schoolCode: string;
}

export default function StudentDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: student, isLoading, isError } = useQuery<StudentMeResponse | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!isLoading && (isError || !student)) {
      setLocation("/student-login");
    }
  }, [isLoading, isError, student, setLocation]);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/student-logout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student-me"] });
      setLocation("/student-login");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
              <GraduationCap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight" data-testid="text-app-title">BENIUS</h1>
              <p className="text-xs text-muted-foreground">Student Portal</p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            data-testid="button-student-logout"
          >
            <LogOut className="w-3.5 h-3.5 mr-1" />
            Logout
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8 space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight" data-testid="text-welcome">
            Welcome, {student.name}!
          </h2>
          <p className="text-muted-foreground mt-1">Here is your Digital Student ID Card</p>
        </div>

        <div className="flex justify-center">
          <Card className="w-full max-w-lg">
            <CardHeader className="text-center border-b">
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
                  <GraduationCap className="w-5 h-5 text-primary-foreground" />
                </div>
              </div>
              <CardTitle className="text-lg" data-testid="text-card-school-name">{student.schoolName}</CardTitle>
              <p className="text-xs text-muted-foreground">Digital Student Identity Card</p>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex items-start gap-6">
                <div className="flex items-center justify-center w-20 h-20 rounded-lg bg-primary/10 shrink-0">
                  <IdCard className="w-10 h-10 text-primary" />
                </div>
                <div className="space-y-3 flex-1">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Student Name</p>
                    <p className="text-lg font-semibold" data-testid="text-card-name">{student.name}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">DSID</p>
                      <p className="font-mono font-semibold text-primary" data-testid="text-card-dsid">{student.digitalStudentId}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Class</p>
                      <p className="font-semibold" data-testid="text-card-class">{student.class} - {student.section}</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
