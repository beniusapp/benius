import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { GraduationCap, Loader2, LogIn, AlertCircle, KeyRound, ArrowLeft, Mail, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";

type LoginStep = "credentials" | "pin" | "forgot-request" | "forgot-otp" | "forgot-pin" | "forgot-reset";

const credSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
const forgotSchema = z.object({ recoveryEmail: z.string().email("Enter your registered recovery email"), schoolCode: z.string().min(1, "School code required") });
const otpSchema = z.object({ otp: z.string().length(6, "Enter all 6 digits") });
const resetSchema = z.object({
  newPassword: z.string().min(6, "Minimum 6 characters"),
  confirmPassword: z.string().min(6),
  newPin: z.string().length(6).regex(/^\d{6}$/, "6-digit PIN required").optional().or(z.literal("")),
}).refine(d => d.newPassword === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

type CredForm = z.infer<typeof credSchema>;
type ForgotForm = z.infer<typeof forgotSchema>;
type ResetForm = z.infer<typeof resetSchema>;

function PinKeypad({ value, onChange, onSubmit, submitLabel = "✓" }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; submitLabel?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", submitLabel];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKey(k: string) {
    if (k === "⌫") { onChange(value.slice(0, -1)); inputRef.current?.focus(); return; }
    if (k === submitLabel) { if (value.length === 6 && onSubmit) onSubmit(); return; }
    if (value.length < 6) { onChange(value + k); inputRef.current?.focus(); }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
    onChange(v);
    if (v.length === 6 && onSubmit) onSubmit();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && value.length === 6 && onSubmit) onSubmit();
    if (e.key === "Backspace") { onChange(value.slice(0, -1)); e.preventDefault(); }
  }

  return (
    <div className="space-y-4" onClick={() => inputRef.current?.focus()}>
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        autoFocus
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        maxLength={6}
        data-testid="pin-hidden-input"
        className="absolute opacity-0 w-px h-px pointer-events-none"
        aria-label="Enter your 6-digit PIN"
      />
      <div className="flex justify-center gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center text-xl font-bold transition-all
            ${i < value.length ? "border-primary bg-primary/10 text-primary" : "border-muted bg-muted/30 text-muted-foreground"}`}>
            {i < value.length ? "●" : "○"}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {keys.map(k => (
          <button
            key={k}
            type="button"
            onClick={() => handleKey(k)}
            data-testid={`pin-key-${k}`}
            className={`h-16 text-xl font-bold rounded-xl border transition-all select-none active:scale-95
              ${k === submitLabel ? "bg-primary text-primary-foreground border-primary" :
                k === "⌫" ? "bg-muted text-foreground border-border hover:bg-muted/80" :
                "bg-white dark:bg-gray-800 text-foreground border-border hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm"}`}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<LoginStep>("credentials");
  const [errorMessage, setErrorMessage] = useState("");
  const [pin, setPin] = useState("");
  const [resetPin, setResetPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [otpDisplay, setOtpDisplay] = useState("");
  const [maskedRecoveryEmail, setMaskedRecoveryEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const credForm = useForm<CredForm>({ resolver: zodResolver(credSchema), defaultValues: { email: "", password: "" } });
  const forgotForm = useForm<ForgotForm>({ resolver: zodResolver(forgotSchema), defaultValues: { recoveryEmail: "", schoolCode: "" } });
  const otpForm = useForm<z.infer<typeof otpSchema>>({ resolver: zodResolver(otpSchema), defaultValues: { otp: "" } });
  const resetForm = useForm<ResetForm>({ resolver: zodResolver(resetSchema), defaultValues: { newPassword: "", confirmPassword: "", newPin: "" } });

  const loginMutation = useMutation({
    mutationFn: async (data: CredForm) => {
      const res = await apiRequest("POST", "/api/login", data);
      return res.json();
    },
    onSuccess: (data) => {
      setErrorMessage("");
      if (data.role === "support_staff") {
        queryClient.invalidateQueries({ queryKey: ["/api/me"] });
        setLocation("/admin-dashboard");
        return;
      }
      if (data.requiresInit) { setLocation("/admin-setup"); return; }
      if (data.requiresPin) { setPin(""); setTempToken(data.tempToken || ""); setStep("pin"); }
    },
    onError: (e: Error) => setErrorMessage(e.message || "Invalid credentials"),
  });

  const verifyPinMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await apiRequest("POST", "/api/admin/verify-pin", { pin: p, ...(tempToken ? { tempToken } : {}) });
      return res.json();
    },
    onSuccess: () => {
      setErrorMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      setLocation("/admin-dashboard");
    },
    onError: (e: Error) => { setErrorMessage(e.message || "Incorrect PIN"); setPin(""); },
  });

  const forgotMutation = useMutation({
    mutationFn: async (data: ForgotForm) => {
      const res = await apiRequest("POST", "/api/admin/forgot-password", data);
      return res.json();
    },
    onSuccess: (data) => {
      setErrorMessage("");
      if (data.otp === null) {
        setErrorMessage("If those details match, an OTP has been sent to your recovery email. Please check and try again.");
      } else {
        setOtpDisplay(data.otp);
        setMaskedRecoveryEmail(data.recoveryEmail || "");
        setStep("forgot-otp");
      }
    },
    onError: (e: Error) => setErrorMessage(e.message || "Could not find account"),
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async (data: z.infer<typeof otpSchema>) => {
      const res = await apiRequest("POST", "/api/admin/verify-otp", { otp: data.otp });
      return res.json();
    },
    onSuccess: (data) => {
      setErrorMessage("");
      setResetPin("");
      if (data.requiresPin) {
        setStep("forgot-pin");
      } else {
        setResetToken(data.resetToken || "");
        setStep("forgot-reset");
      }
    },
    onError: (e: Error) => setErrorMessage(e.message || "Invalid OTP"),
  });

  const verifyResetPinMutation = useMutation({
    mutationFn: async (p: string) => {
      const res = await apiRequest("POST", "/api/admin/verify-reset-pin", { pin: p });
      return res.json();
    },
    onSuccess: (data) => {
      setErrorMessage("");
      setResetToken(data.resetToken);
      setStep("forgot-reset");
    },
    onError: (e: Error) => { setErrorMessage(e.message || "Incorrect PIN"); setResetPin(""); },
  });

  const resetMutation = useMutation({
    mutationFn: async (data: ResetForm) => {
      const res = await apiRequest("POST", "/api/admin/reset-password", {
        resetToken,
        newPassword: data.newPassword,
        newPin: data.newPin || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setErrorMessage("");
      setNewPin("");
      setStep("credentials");
      credForm.reset();
    },
    onError: (e: Error) => setErrorMessage(e.message || "Reset failed"),
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-app-title">BENIUS</h1>
          <span className="text-sm text-muted-foreground ml-1">School Management</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <Card className="w-full max-w-md">

          {step === "credentials" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2 text-xl">
                  <LogIn className="w-5 h-5" /> Principal Login
                </CardTitle>
                <CardDescription>Sign in with your school admin credentials</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...credForm}>
                  <form onSubmit={credForm.handleSubmit(d => { setErrorMessage(""); loginMutation.mutate(d); })} className="space-y-4">
                    {errorMessage && (
                      <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-login-error">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {errorMessage}
                      </div>
                    )}
                    <FormField control={credForm.control} name="email" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="principal@school.com" data-testid="input-login-email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={credForm.control} name="password" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input type={showPassword ? "text" : "password"} placeholder="Enter your password" data-testid="input-login-password" {...field} />
                            <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" data-testid="toggle-login-password">
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="button-login">
                      {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Sign In
                    </Button>
                    <button type="button" onClick={() => { setStep("forgot-request"); setErrorMessage(""); }}
                      className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors"
                      data-testid="link-forgot-password">
                      Forgot password?
                    </button>
                  </form>
                </Form>
              </CardContent>
            </>
          )}

          {step === "pin" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2 text-xl">
                  <KeyRound className="w-5 h-5" /> Enter Your PIN
                </CardTitle>
                <CardDescription>Enter your 6-digit security PIN to continue</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {errorMessage && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-pin-error">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {errorMessage}
                  </div>
                )}
                <PinKeypad value={pin} onChange={(v) => {
                  setPin(v);
                  if (v.length === 6) { setErrorMessage(""); verifyPinMutation.mutate(v); }
                }} onSubmit={() => { if (pin.length === 6) { setErrorMessage(""); verifyPinMutation.mutate(pin); } }} />
                {verifyPinMutation.isPending && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
                  </div>
                )}
                <button type="button" onClick={() => { setStep("credentials"); setPin(""); setErrorMessage(""); }}
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 transition-colors"
                  data-testid="button-back-to-login">
                  <ArrowLeft className="w-3 h-3" /> Back to login
                </button>
              </CardContent>
            </>
          )}

          {step === "forgot-request" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2 text-xl">
                  <Mail className="w-5 h-5" /> Forgot Password
                </CardTitle>
                <CardDescription>Enter your recovery email and school code to get a one-time password</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...forgotForm}>
                  <form onSubmit={forgotForm.handleSubmit(d => { setErrorMessage(""); forgotMutation.mutate(d); })} className="space-y-4">
                    {errorMessage && (
                      <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {errorMessage}
                      </div>
                    )}
                    <FormField control={forgotForm.control} name="recoveryEmail" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recovery Email</FormLabel>
                        <FormControl><Input type="email" placeholder="backup@gmail.com" data-testid="input-forgot-email" {...field} /></FormControl>
                        <p className="text-xs text-muted-foreground">The recovery email you set up when you first initialized your account.</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={forgotForm.control} name="schoolCode" render={({ field }) => (
                      <FormItem>
                        <FormLabel>School Code</FormLabel>
                        <FormControl><Input placeholder="e.g. PPS" data-testid="input-forgot-schoolcode" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" className="w-full" disabled={forgotMutation.isPending} data-testid="button-send-otp">
                      {forgotMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Get OTP
                    </Button>
                    <button type="button" onClick={() => { setStep("credentials"); setErrorMessage(""); }}
                      className="w-full text-center text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1"
                      data-testid="button-back-to-credentials">
                      <ArrowLeft className="w-3 h-3" /> Back to login
                    </button>
                  </form>
                </Form>
              </CardContent>
            </>
          )}

          {step === "forgot-otp" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-xl">Enter OTP</CardTitle>
                <CardDescription>Your one-time password has been generated</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {otpDisplay && (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center">
                    <p className="text-xs text-amber-600 font-medium mb-1">Your OTP (valid 10 min)</p>
                    <p className="text-3xl font-mono font-bold tracking-widest text-amber-700" data-testid="text-otp-display">{otpDisplay}</p>
                    {maskedRecoveryEmail && (
                      <p className="text-xs text-amber-600 mt-2">Would be sent to: <span className="font-semibold">{maskedRecoveryEmail}</span></p>
                    )}
                  </div>
                )}
                {errorMessage && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {errorMessage}
                  </div>
                )}
                <Form {...otpForm}>
                  <form onSubmit={otpForm.handleSubmit(d => { setErrorMessage(""); verifyOtpMutation.mutate(d); })} className="space-y-4">
                    <FormField control={otpForm.control} name="otp" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Enter the OTP above</FormLabel>
                        <FormControl><Input placeholder="6-digit OTP" maxLength={6} data-testid="input-otp" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" className="w-full" disabled={verifyOtpMutation.isPending} data-testid="button-verify-otp">
                      {verifyOtpMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Verify OTP
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </>
          )}

          {step === "forgot-pin" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="flex items-center justify-center gap-2 text-xl">
                  <ShieldCheck className="w-5 h-5" /> Verify Your PIN
                </CardTitle>
                <CardDescription>Enter your current 6-digit PIN to confirm your identity before resetting your password</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {errorMessage && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-reset-pin-error">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {errorMessage}
                  </div>
                )}
                <PinKeypad value={resetPin} onChange={(v) => {
                  setResetPin(v);
                  if (v.length === 6) { setErrorMessage(""); verifyResetPinMutation.mutate(v); }
                }} onSubmit={() => { if (resetPin.length === 6) { setErrorMessage(""); verifyResetPinMutation.mutate(resetPin); } }} />
                {verifyResetPinMutation.isPending && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Verifying PIN…
                  </div>
                )}
                <p className="text-center text-xs text-muted-foreground">
                  This extra step ensures only you can reset your password.
                </p>
              </CardContent>
            </>
          )}

          {step === "forgot-reset" && (
            <>
              <CardHeader className="text-center">
                <CardTitle className="text-xl">Set New Password</CardTitle>
                <CardDescription>Create a new password and optionally update your PIN</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...resetForm}>
                  <form onSubmit={resetForm.handleSubmit(d => { setErrorMessage(""); resetMutation.mutate(d); })} className="space-y-4">
                    {errorMessage && (
                      <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {errorMessage}
                      </div>
                    )}
                    {resetMutation.isSuccess && (
                      <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium text-center" data-testid="text-reset-success">
                        Password reset! Please log in again.
                      </div>
                    )}
                    <FormField control={resetForm.control} name="newPassword" render={({ field }) => (
                      <FormItem>
                        <FormLabel>New Password</FormLabel>
                        <FormControl><Input type="password" placeholder="Min 6 characters" data-testid="input-reset-password" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={resetForm.control} name="confirmPassword" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirm Password</FormLabel>
                        <FormControl><Input type="password" placeholder="Repeat password" data-testid="input-reset-confirm-password" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="border-t pt-4">
                      <p className="text-xs text-muted-foreground mb-3">Optional: also reset your 6-digit PIN</p>
                      <div className="space-y-2">
                        <p className="text-sm font-medium">New PIN (optional)</p>
                        <PinKeypad value={newPin} onChange={v => { setNewPin(v); resetForm.setValue("newPin", v); }} />
                      </div>
                    </div>
                    <Button type="submit" className="w-full" disabled={resetMutation.isPending} data-testid="button-reset-password">
                      {resetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Reset Password
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </>
          )}

        </Card>
      </main>
    </div>
  );
}
