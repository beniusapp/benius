import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  GraduationCap,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const GENERIC_MESSAGE =
  "If those details match a student account, a verification code has been sent to the recovery contact on file.";

type RecoveryStep = "start" | "otp" | "reset";

function Header() {
  return (
    <header className="border-b bg-card">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
          <GraduationCap className="w-5 h-5 text-primary-foreground" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">BENIUS</h1>
        <span className="text-sm text-muted-foreground ml-1">Student Portal</span>
      </div>
    </header>
  );
}

function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" aria-live="assertive" className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

export default function StudentForgotPassword() {
  const [location, setLocation] = useLocation();
  const step: RecoveryStep = location.endsWith("/otp") ? "otp" : location.endsWith("/reset") ? "reset" : "start";
  const [schoolCode, setSchoolCode] = useState("");
  const [dsid, setDsid] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resetComplete, setResetComplete] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef(false);
  const generationRef = useRef(0);
  const locationRef = useRef(location);
  locationRef.current = location;

  function isCurrentOperation(token: number, expectedLocation: string) {
    return generationRef.current === token && locationRef.current === expectedLocation;
  }

  function invalidateOperation() {
    generationRef.current += 1;
    submitRef.current = false;
  }

  useEffect(() => {
    firstFieldRef.current?.focus();
    setError("");
    setMessage(step === "otp" ? GENERIC_MESSAGE : "");
    setResetComplete(false);
    return () => {
      invalidateOperation();
    };
  }, [location]);

  useEffect(() => {
    if (resetComplete) successRef.current?.focus();
  }, [resetComplete]);

  const startMutation = useMutation({
    mutationFn: (operation: { token: number }) =>
      apiRequest("POST", "/api/student/forgot-password", { schoolCode, dsid }),
    onSuccess: (_response, operation) => {
      if (!isCurrentOperation(operation.token, "/student/forgot-password")) return;
      setMessage(GENERIC_MESSAGE);
      setOtp("");
      setLocation("/student/forgot-password/otp");
    },
    onError: (_error, operation) => {
      if (isCurrentOperation(operation.token, "/student/forgot-password")) {
        setError("We couldn't start recovery right now. Please check your details and try again.");
      }
    },
    onSettled: (_response, _error, operation) => {
      if (isCurrentOperation(operation.token, "/student/forgot-password")) submitRef.current = false;
    },
  });

  const otpMutation = useMutation({
    mutationFn: (operation: { token: number }) =>
      apiRequest("POST", "/api/student/verify-recovery-otp", { otp }),
    onSuccess: (_response, operation) => {
      if (!isCurrentOperation(operation.token, "/student/forgot-password/otp")) return;
      setError("");
      setNewPassword("");
      setConfirmPassword("");
      setLocation("/student/forgot-password/reset");
    },
    onError: (_error, operation) => {
      if (isCurrentOperation(operation.token, "/student/forgot-password/otp")) {
        setError("That code could not be verified. It may be invalid or expired. Please start again.");
      }
    },
    onSettled: (_response, _error, operation) => {
      if (isCurrentOperation(operation.token, "/student/forgot-password/otp")) submitRef.current = false;
    },
  });

  const resetMutation = useMutation({
    mutationFn: (operation: { token: number }) =>
      apiRequest("POST", "/api/student/reset-password", { newPassword }),
    onSuccess: (_response, operation) => {
      if (!isCurrentOperation(operation.token, "/student/forgot-password/reset")) return;
      setError("");
      setResetComplete(true);
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (_error, operation) => {
      if (isCurrentOperation(operation.token, "/student/forgot-password/reset")) {
        setError("Your recovery session could not be completed. Please start again.");
      }
    },
    onSettled: (_response, _error, operation) => {
      if (isCurrentOperation(operation.token, "/student/forgot-password/reset")) submitRef.current = false;
    },
  });

  function restart() {
    if (pending) return;
    invalidateOperation();
    setSchoolCode("");
    setDsid("");
    setOtp("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage("");
    setError("");
    setResetComplete(false);
    startMutation.reset();
    otpMutation.reset();
    resetMutation.reset();
    setLocation("/student/forgot-password");
  }

  function submitStart(event: React.FormEvent) {
    event.preventDefault();
    if (submitRef.current || !schoolCode.trim() || !dsid.trim()) return;
    submitRef.current = true;
    const token = ++generationRef.current;
    setError("");
    startMutation.mutate({ token });
  }

  function submitOtp(event: React.FormEvent) {
    event.preventDefault();
    if (submitRef.current || otp.length !== 6) {
      if (otp.length !== 6) setError("Enter the complete 6-digit verification code.");
      return;
    }
    submitRef.current = true;
    const token = ++generationRef.current;
    setError("");
    otpMutation.mutate({ token });
  }

  function submitReset(event: React.FormEvent) {
    event.preventDefault();
    if (submitRef.current) return;
    if (newPassword.length < 6) return setError("Password must be at least 6 characters.");
    if (newPassword !== confirmPassword) return setError("Passwords do not match.");
    submitRef.current = true;
    const token = ++generationRef.current;
    setError("");
    resetMutation.mutate({ token });
  }

  const pending = startMutation.isPending || otpMutation.isPending || resetMutation.isPending;

  function navigateBack(target: string) {
    if (pending) return;
    invalidateOperation();
    setLocation(target);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background" data-testid="student-recovery-page">
      <Header />
      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto flex items-center justify-center w-12 h-12 rounded-md bg-primary">
              {step === "start" ? <ShieldCheck className="w-6 h-6 text-primary-foreground" /> :
                step === "otp" ? <KeyRound className="w-6 h-6 text-primary-foreground" /> :
                <LockKeyhole className="w-6 h-6 text-primary-foreground" />}
            </div>
            <CardTitle className="text-xl mt-2">
              {resetComplete ? "Password reset complete" : step === "start" ? "Forgot your password?" : step === "otp" ? "Verify your identity" : "Create a new password"}
            </CardTitle>
            <CardDescription>
              {resetComplete ? "Your student account is ready to use." :
                step === "start" ? "Enter your school details to securely recover your account." :
                step === "otp" ? "Enter the 6-digit code sent to your recovery contact." :
                "Choose a new password with at least 6 characters."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {message && step === "otp" && (
              <div role="status" aria-live="polite" className="mb-4 rounded-md bg-muted/60 p-3 text-sm text-muted-foreground" data-testid="student-recovery-generic-message">{message}</div>
            )}
            <ErrorNotice message={error} />
            {resetComplete ? (
                <div ref={successRef} tabIndex={-1} role="status" aria-live="polite" className="space-y-5 text-center focus:outline-none">
                <div className="rounded-md bg-muted/60 p-4 flex items-center gap-3 text-left">
                  <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                  <p className="text-sm">Your password has been updated. Sign in with your new password.</p>
                </div>
                <Button type="button" className="w-full" disabled={pending} onClick={() => navigateBack("/student-login")}>Return to Student Login</Button>
              </div>
            ) : step === "start" ? (
              <form onSubmit={submitStart} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="school-code">School Code</Label>
                  <Input ref={firstFieldRef} id="school-code" autoComplete="organization" value={schoolCode} onChange={(event) => setSchoolCode(event.target.value)} placeholder="Enter your school code" required data-testid="input-student-recovery-school-code" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="recovery-dsid">Digital Student ID (DSID)</Label>
                  <Input id="recovery-dsid" autoComplete="username" value={dsid} onChange={(event) => setDsid(event.target.value)} placeholder="e.g. MLS-0001" required data-testid="input-student-recovery-dsid" />
                </div>
                <Button type="submit" className="w-full" disabled={pending} data-testid="button-student-recovery-start">{startMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Send recovery code</Button>
                <button type="button" disabled={pending} onClick={() => navigateBack("/student-login")} className="w-full text-sm text-muted-foreground hover:text-foreground inline-flex justify-center items-center gap-1"><ArrowLeft className="w-3 h-3" />Back to Student Login</button>
              </form>
            ) : step === "otp" ? (
              <form onSubmit={submitOtp} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="recovery-otp">Six-digit verification code</Label>
                  <Input ref={firstFieldRef} id="recovery-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} className="text-center text-xl tracking-[0.35em]" aria-invalid={otp.length > 0 && otp.length !== 6} data-testid="input-student-recovery-otp" />
                </div>
                <Button type="submit" className="w-full" disabled={pending} data-testid="button-student-recovery-verify">{otpMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Verify code</Button>
                <div className="text-center space-y-2">
                  <button type="button" disabled={pending} onClick={restart} className="text-sm text-primary hover:underline disabled:opacity-50">Start again</button>
                  <button type="button" disabled={pending} onClick={() => navigateBack("/student-login")} className="w-full text-sm text-muted-foreground hover:text-foreground inline-flex justify-center items-center gap-1 disabled:opacity-50"><ArrowLeft className="w-3 h-3" />Cancel recovery</button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input ref={firstFieldRef} id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 6 characters" required data-testid="input-student-recovery-new-password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your new password" required data-testid="input-student-recovery-confirm-password" />
                </div>
                <Button type="submit" className="w-full" disabled={pending} data-testid="button-student-recovery-reset">{resetMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Update password</Button>
                <button type="button" disabled={pending} onClick={restart} className="w-full text-sm text-muted-foreground hover:text-foreground disabled:opacity-50" data-testid="button-student-recovery-restart">Start recovery again</button>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}