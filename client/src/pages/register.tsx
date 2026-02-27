import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Link } from "wouter";
import { GraduationCap, Loader2, UserCheck, AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest } from "@/lib/queryClient";

const verifySchema = z.object({
  dsid: z.string().min(1, "DSID is required"),
  phone: z.string().min(7, "Valid phone number is required"),
  dob: z.string().min(1, "Date of birth is required"),
});

const passwordSchema = z.object({
  password: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type VerifyForm = z.infer<typeof verifySchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

export default function Register() {
  const [step, setStep] = useState<"verify" | "password" | "done">("verify");
  const [errorMessage, setErrorMessage] = useState("");
  const [studentName, setStudentName] = useState("");
  const [verifiedData, setVerifiedData] = useState<VerifyForm | null>(null);

  const verifyForm = useForm<VerifyForm>({
    resolver: zodResolver(verifySchema),
    defaultValues: { dsid: "", phone: "", dob: "" },
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const verifyMutation = useMutation({
    mutationFn: async (data: VerifyForm) => {
      const res = await apiRequest("POST", "/api/students/verify", data);
      return res.json();
    },
    onSuccess: (data, variables) => {
      setErrorMessage("");
      setStudentName(data.studentName);
      setVerifiedData(variables);
      setStep("password");
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (data: PasswordForm) => {
      const res = await apiRequest("POST", "/api/students/activate", {
        dsid: verifiedData!.dsid,
        phone: verifiedData!.phone,
        dob: verifiedData!.dob,
        password: data.password,
      });
      return res.json();
    },
    onSuccess: () => {
      setErrorMessage("");
      setStep("done");
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
    },
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-app-title">BENIUS</h1>
          <span className="text-sm text-muted-foreground ml-1">Student Registration</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-8">
        <Card className="w-full max-w-md">
          {step === "verify" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2 text-xl">
                  <UserCheck className="w-5 h-5" />
                  Activate Your Account
                </CardTitle>
                <CardDescription>
                  Enter your DSID, phone number, and date of birth to verify your identity
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...verifyForm}>
                  <form onSubmit={verifyForm.handleSubmit((data) => { setErrorMessage(""); verifyMutation.mutate(data); })} className="space-y-4">
                    {errorMessage && (
                      <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-verify-error">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {errorMessage}
                      </div>
                    )}
                    <FormField
                      control={verifyForm.control}
                      name="dsid"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Digital Student ID (DSID)</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. MLS-0001" data-testid="input-verify-dsid" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={verifyForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. 9876543210" data-testid="input-verify-phone" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={verifyForm.control}
                      name="dob"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date of Birth</FormLabel>
                          <FormControl>
                            <Input type="date" data-testid="input-verify-dob" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={verifyMutation.isPending}
                      data-testid="button-verify"
                    >
                      {verifyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Verify Identity
                    </Button>
                    <p className="text-center text-sm text-muted-foreground">
                      Already activated?{" "}
                      <Link href="/student-login" className="text-primary underline" data-testid="link-student-login">
                        Log in here
                      </Link>
                    </p>
                  </form>
                </Form>
              </CardContent>
            </>
          )}

          {step === "password" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2 text-xl">
                  <UserCheck className="w-5 h-5" />
                  Create Your Password
                </CardTitle>
                <CardDescription>
                  Welcome, <span className="font-semibold" data-testid="text-student-name">{studentName}</span>! Set a password for your account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...passwordForm}>
                  <form onSubmit={passwordForm.handleSubmit((data) => { setErrorMessage(""); activateMutation.mutate(data); })} className="space-y-4">
                    {errorMessage && (
                      <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-activate-error">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {errorMessage}
                      </div>
                    )}
                    <FormField
                      control={passwordForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="At least 6 characters" data-testid="input-create-password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={passwordForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="Re-enter your password" data-testid="input-confirm-password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={activateMutation.isPending}
                      data-testid="button-activate"
                    >
                      {activateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Activate Account
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </>
          )}

          {step === "done" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2 text-xl text-green-600 dark:text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                  Account Activated!
                </CardTitle>
                <CardDescription>
                  Your account has been activated successfully. You can now log in with your DSID and password.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/student-login">
                  <Button className="w-full" data-testid="button-go-login">
                    Go to Student Login
                  </Button>
                </Link>
              </CardContent>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
