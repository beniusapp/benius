import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { z } from "zod";
import { GraduationCap, Loader2, LogIn, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";

const studentLoginSchema = z.object({
  dsid: z.string().min(1, "DSID is required"),
  password: z.string().min(1, "Password is required"),
});

type StudentLoginForm = z.infer<typeof studentLoginSchema>;

export default function StudentLogin() {
  const [, setLocation] = useLocation();
  const [errorMessage, setErrorMessage] = useState("");

  const form = useForm<StudentLoginForm>({
    resolver: zodResolver(studentLoginSchema),
    defaultValues: { dsid: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: StudentLoginForm) => {
      await apiRequest("POST", "/api/student-login", data);
    },
    onSuccess: () => {
      setErrorMessage("");
      queryClient.clear();
      setLocation("/student-dashboard");
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
    },
  });

  function onSubmit(data: StudentLoginForm) {
    setErrorMessage("");
    loginMutation.mutate(data);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-app-title">BENIUS</h1>
          <span className="text-sm text-muted-foreground ml-1">Student Portal</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2 text-xl">
              <LogIn className="w-5 h-5" />
              Student Login
            </CardTitle>
            <CardDescription>
              Sign in with your Digital Student ID and password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {errorMessage && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-student-login-error">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {errorMessage}
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="dsid"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Digital Student ID (DSID)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. MLS-0001" data-testid="input-student-dsid" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Enter your password" data-testid="input-student-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginMutation.isPending}
                  data-testid="button-student-login"
                >
                  {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Sign In
                </Button>
                <p className="text-center text-sm text-muted-foreground">
                  Haven't activated your account?{" "}
                  <Link href="/register" className="text-primary underline" data-testid="link-register">
                    Register here
                  </Link>
                </p>
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
