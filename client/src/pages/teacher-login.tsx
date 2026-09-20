import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Building2, CheckCircle2, Eye, EyeOff, GraduationCap, KeyRound, Loader2, Lock, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Step = "login" | "change-password" | "forgot-password" | "verify-otp" | "reset-password" | "reset-success";

const GENERIC_RECOVERY_MESSAGE =
  "If those details match, an OTP has been sent to your recovery email. Please check and try again.";

const EMPTY_OTP = "";

export default function TeacherLogin() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotSchoolCode, setForgotSchoolCode] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [otp, setOtp] = useState(EMPTY_OTP);
  const [recoveryMessage, setRecoveryMessage] = useState(GENERIC_RECOVERY_MESSAGE);
  const forgotSubmittingRef = useRef(false);
  const otpSubmittingRef = useRef(false);
  const resetSubmittingRef = useRef(false);

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/teacher-login", { email, password });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.clear();
      if (data.mustChangePassword) {
        setStep("change-password");
        toast({ title: "First Login", description: "Please change your password to continue." });
      } else {
        setLocation("/teacher-dashboard");
      }
    },
    onError: (error: Error) => {
      toast({ title: "Login Failed", description: error.message, variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/teacher/change-password", { currentPassword: password, newPassword });
    },
    onSuccess: () => {
      toast({ title: "Password Changed", description: "Security credentials updated successfully." });
      setLocation("/teacher-dashboard");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/teacher/forgot-password", {
        schoolCode: forgotSchoolCode,
        email: forgotEmail,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setRecoveryMessage(
        typeof data?.message === "string" ? data.message : GENERIC_RECOVERY_MESSAGE,
      );
      setOtp(EMPTY_OTP);
      setStep("verify-otp");
      toast({ title: "Check Your Email", description: GENERIC_RECOVERY_MESSAGE });
    },
    onError: () => {
      toast({
        title: "Unable to Send OTP",
        description: "Please wait a moment and try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      forgotSubmittingRef.current = false;
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/teacher/verify-otp", { otp });
      return res.json();
    },
    onSuccess: () => {
      setNewPassword("");
      setConfirmPassword("");
      setStep("reset-password");
      toast({ title: "OTP Verified", description: "Please set your new password." });
    },
    onError: () => {
      toast({
        title: "Unable to Verify OTP",
        description: "The OTP is invalid or expired. Please request a new OTP and try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      otpSubmittingRef.current = false;
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/teacher/reset-password", {
        newPassword,
        confirmPassword,
      });
    },
    onSuccess: () => {
      setOtp(EMPTY_OTP);
      setStep("reset-success");
    },
    onError: () => {
      toast({
        title: "Unable to Reset Password",
        description: "Your recovery session may have expired. Please start again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      resetSubmittingRef.current = false;
    },
  });

  function clearRecoveryState() {
    setForgotSchoolCode("");
    setForgotEmail("");
    setOtp(EMPTY_OTP);
    setNewPassword("");
    setConfirmPassword("");
    setRecoveryMessage(GENERIC_RECOVERY_MESSAGE);
    forgotPasswordMutation.reset();
    verifyOtpMutation.reset();
    resetPasswordMutation.reset();
  }

  function returnToLogin() {
    clearRecoveryState();
    setEmail("");
    setPassword("");
    setStep("login");
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    loginMutation.mutate();
  }

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate();
  }

  function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (forgotSubmittingRef.current || !forgotSchoolCode || !forgotEmail) return;
    forgotSubmittingRef.current = true;
    forgotPasswordMutation.mutate();
  }

  function handleOtpChange(value: string) {
    setOtp(value.replace(/\D/g, "").slice(0, 6));
  }

  function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otpSubmittingRef.current) return;
    if (otp.length !== 6) {
      toast({ title: "Error", description: "Please enter the complete 6-digit OTP", variant: "destructive" });
      return;
    }
    otpSubmittingRef.current = true;
    verifyOtpMutation.mutate();
  }

  function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (resetSubmittingRef.current) return;
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    resetSubmittingRef.current = true;
    resetPasswordMutation.mutate();
  }

  function handleResendOtp() {
    if (forgotSubmittingRef.current) return;
    forgotSubmittingRef.current = true;
    setOtp(EMPTY_OTP);
    forgotPasswordMutation.mutate();
  }

  const stepTitles: Record<Step, string> = {
    "login": "Teacher Login",
    "change-password": "Change Password",
    "forgot-password": "Forgot Password",
    "verify-otp": "Enter OTP",
    "reset-password": "Set New Password",
    "reset-success": "Password Reset",
  };

  const stepDescriptions: Record<Step, string> = {
    "login": "Sign in to your teacher account",
    "change-password": "Please set a new password to continue",
    "forgot-password": "Enter your school code and registered email",
    "verify-otp": "Enter the 6-digit OTP sent to your recovery email",
    "reset-password": "Create a new password for your account",
    "reset-success": "Your password has been updated securely",
  };

  const stepIcons: Record<Step, typeof GraduationCap> = {
    "login": GraduationCap,
    "change-password": Lock,
    "forgot-password": Mail,
    "verify-otp": KeyRound,
    "reset-password": Lock,
    "reset-success": CheckCircle2,
  };

  const StepIcon = stepIcons[step];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-md bg-primary">
            <StepIcon className="w-7 h-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            {stepTitles[step]}
          </CardTitle>
          <p className="text-sm text-muted-foreground" data-testid="text-step-description">
            {stepDescriptions[step]}
          </p>
        </CardHeader>
        <CardContent>
          {step === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="teacher@school.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-email"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10"
                    required
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loginMutation.isPending}
                data-testid="button-login"
              >
                {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Sign In
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { clearRecoveryState(); setStep("forgot-password"); }}
                  className="text-sm text-primary hover:underline"
                  data-testid="link-forgot-password"
                >
                  Forgot Password?
                </button>
              </div>
            </form>
          )}

          {step === "change-password" && (
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Repeat your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  data-testid="input-confirm-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={changePasswordMutation.isPending}
                data-testid="button-change-password"
              >
                {changePasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Update Password
              </Button>
            </form>
          )}

          {step === "forgot-password" && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgotSchoolCode">School Code</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="forgotSchoolCode"
                    type="text"
                    autoComplete="organization"
                    placeholder="Enter your school code"
                    value={forgotSchoolCode}
                    onChange={(e) => setForgotSchoolCode(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-forgot-school-code"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="forgotEmail">Registered Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="forgotEmail"
                    type="email"
                    placeholder="teacher@school.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-forgot-email"
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={forgotPasswordMutation.isPending}
                data-testid="button-send-otp"
              >
                {forgotPasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Send OTP
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={returnToLogin}
                  className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  data-testid="link-back-to-login"
                >
                  <ArrowLeft className="w-3 h-3" />
                  Back to Login
                </button>
              </div>
            </form>
          )}

          {step === "verify-otp" && (
            <form onSubmit={handleVerifyOtp} className="space-y-6">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-sm text-muted-foreground" data-testid="text-otp-message">
                   {recoveryMessage}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="teacherRecoveryOtp">Six-digit OTP</Label>
                <Input
                  id="teacherRecoveryOtp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => handleOtpChange(e.target.value)}
                  className="w-full text-center text-xl font-semibold tracking-[0.35em]"
                  aria-invalid={otp.length > 0 && otp.length !== 6}
                  data-testid="input-otp"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={verifyOtpMutation.isPending}
                data-testid="button-verify-otp"
              >
                {verifyOtpMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Verify OTP
              </Button>
              <div className="text-center space-y-2">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={forgotPasswordMutation.isPending}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                  data-testid="link-resend-otp"
                >
                  {forgotPasswordMutation.isPending ? "Sending..." : "Resend OTP"}
                </button>
                <div>
                  <button
                    type="button"
                    onClick={returnToLogin}
                    className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    data-testid="link-back-to-login-otp"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back to Login
                  </button>
                </div>
              </div>
            </form>
          )}

          {step === "reset-password" && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="resetNewPassword">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="resetNewPassword"
                    type="password"
                    placeholder="At least 6 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-reset-new-password"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="resetConfirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="resetConfirmPassword"
                    type="password"
                    placeholder="Repeat your new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-reset-confirm-password"
                  />
                </div>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={resetPasswordMutation.isPending}
                data-testid="button-reset-password"
              >
                {resetPasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Reset Password
              </Button>
            </form>
          )}

          {step === "reset-success" && (
            <div className="space-y-6 text-center" data-testid="reset-success-state">
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="font-medium" data-testid="text-reset-success">
                  Password reset successfully.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Please log in with your new password.
                </p>
              </div>
              <Button
                type="button"
                className="w-full"
                onClick={returnToLogin}
                data-testid="button-back-to-login-after-reset"
              >
                Back to Login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
