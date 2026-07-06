import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { GraduationCap, Loader2, Lock, Mail, Eye, EyeOff, Phone, ArrowLeft, KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Step = "login" | "change-password" | "forgot-password" | "verify-otp" | "reset-password";

export default function TeacherLogin() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotPhone, setForgotPhone] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [resetToken, setResetToken] = useState("");
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (step === "verify-otp") {
      otpRefs.current[0]?.focus();
    }
  }, [step]);

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
      const res = await apiRequest("POST", "/api/teacher/forgot-password", { email: forgotEmail, phone: forgotPhone });
      return res.json();
    },
    onSuccess: (data) => {
      setTeacherId(data.teacherId);
      setOtpDigits(["", "", "", "", "", ""]);
      setStep("verify-otp");
      toast({ title: "OTP Sent", description: "OTP sent to your phone. Check console for dev OTP." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async () => {
      const otp = otpDigits.join("");
      const res = await apiRequest("POST", "/api/teacher/verify-otp", { teacherId, otp });
      return { ...(await res.json()), otp };
    },
    onSuccess: (data) => {
      setResetToken(data.resetToken);
      setNewPassword("");
      setConfirmPassword("");
      setStep("reset-password");
      toast({ title: "OTP Verified", description: "Please set your new password." });
    },
    onError: (error: Error) => {
      toast({ title: "Invalid OTP", description: error.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/teacher/reset-password", { teacherId, resetToken, newPassword });
    },
    onSuccess: () => {
      toast({ title: "Password Reset", description: "Your password has been reset successfully. Please login." });
      setStep("login");
      setEmail("");
      setPassword("");
      setForgotEmail("");
      setForgotPhone("");
      setResetToken("");
      setTeacherId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

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
    if (!forgotEmail || !forgotPhone) return;
    forgotPasswordMutation.mutate();
  }

  function handleOtpChange(index: number, value: string) {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;
    const newDigits = [...otpDigits];
    newDigits[index] = value;
    setOtpDigits(newDigits);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 0) return;
    const newDigits = [...otpDigits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || "";
    }
    setOtpDigits(newDigits);
    const focusIdx = Math.min(pasted.length, 5);
    otpRefs.current[focusIdx]?.focus();
  }

  function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    const otp = otpDigits.join("");
    if (otp.length !== 6) {
      toast({ title: "Error", description: "Please enter the complete 6-digit OTP", variant: "destructive" });
      return;
    }
    verifyOtpMutation.mutate();
  }

  function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    resetPasswordMutation.mutate();
  }

  function handleResendOtp() {
    setOtpDigits(["", "", "", "", "", ""]);
    forgotPasswordMutation.mutate();
  }

  const stepTitles: Record<Step, string> = {
    "login": "Teacher Login",
    "change-password": "Change Password",
    "forgot-password": "Forgot Password",
    "verify-otp": "Enter OTP",
    "reset-password": "Set New Password",
  };

  const stepDescriptions: Record<Step, string> = {
    "login": "Sign in to your teacher account",
    "change-password": "Please set a new password to continue",
    "forgot-password": "Enter your registered email and phone number",
    "verify-otp": "Enter the 6-digit OTP sent to your phone",
    "reset-password": "Create a new password for your account",
  };

  const stepIcons: Record<Step, typeof GraduationCap> = {
    "login": GraduationCap,
    "change-password": Lock,
    "forgot-password": Mail,
    "verify-otp": KeyRound,
    "reset-password": Lock,
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
                  onClick={() => { setForgotEmail(""); setForgotPhone(""); setStep("forgot-password"); }}
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
              <div className="space-y-2">
                <Label htmlFor="forgotPhone">Registered Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="forgotPhone"
                    type="tel"
                    placeholder="9876543210"
                    value={forgotPhone}
                    onChange={(e) => setForgotPhone(e.target.value)}
                    className="pl-10"
                    required
                    data-testid="input-forgot-phone"
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
                  onClick={() => setStep("login")}
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
                  OTP sent to your phone. It expires in 5 minutes.
                </p>
              </div>
              <div className="flex justify-center gap-2" onPaste={handleOtpPaste}>
                {otpDigits.map((digit, i) => (
                  <Input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-12 h-12 text-center text-xl font-semibold"
                    data-testid={`input-otp-${i}`}
                  />
                ))}
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
                    onClick={() => setStep("login")}
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
        </CardContent>
      </Card>
    </div>
  );
}
