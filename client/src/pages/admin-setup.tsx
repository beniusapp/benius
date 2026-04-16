import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { GraduationCap, ShieldCheck, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";

const setupSchema = z.object({
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Please confirm your password"),
  pin: z.string().length(6, "PIN must be exactly 6 digits").regex(/^\d{6}$/, "PIN must be numeric"),
  confirmPin: z.string().length(6),
  recoveryEmail: z.string().email("Enter a valid recovery email address"),
  recoveryPhone: z.string().min(7, "Enter a valid phone number").max(20),
}).refine(d => d.newPassword === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] })
  .refine(d => d.pin === d.confirmPin, { message: "PINs do not match", path: ["confirmPin"] });

type SetupForm = z.infer<typeof setupSchema>;

function PinDots({ value, label, active }: { value: string; label: string; active: boolean }) {
  return (
    <div className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${active ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white"}`}>
      <p className={`text-xs font-semibold mb-3 ${active ? "text-blue-600" : "text-gray-500"}`}>{label}</p>
      <div className="flex justify-center gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`w-9 h-9 rounded-lg border-2 flex items-center justify-center text-base font-bold transition-all
            ${i < value.length
              ? active ? "border-blue-500 bg-blue-100 text-blue-600" : "border-emerald-400 bg-emerald-50 text-emerald-600"
              : "border-gray-200 bg-gray-50 text-gray-300"}`}>
            {i < value.length ? "●" : "○"}
          </div>
        ))}
      </div>
      {value.length === 6 && !active && (
        <p className="text-center text-xs text-emerald-600 mt-2 font-medium">✓ Set</p>
      )}
    </div>
  );
}

export default function AdminSetup() {
  const [, setLocation] = useLocation();
  const [errorMessage, setErrorMessage] = useState("");
  const [pinValue, setPinValue] = useState("");
  const [confirmPinValue, setConfirmPinValue] = useState("");
  const [activeField, setActiveField] = useState<"pin" | "confirm">("pin");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const { data: pendingStatus, isLoading: checkingSession } = useQuery<{ pending: boolean }>({
    queryKey: ["/api/admin/pending-session"],
    queryFn: async () => {
      const r = await fetch("/api/admin/pending-session", { credentials: "include" });
      return r.ok ? r.json() : { pending: false };
    },
  });

  useEffect(() => {
    if (!checkingSession && pendingStatus && !pendingStatus.pending) {
      setLocation("/login");
    }
  }, [pendingStatus, checkingSession, setLocation]);

  const form = useForm<SetupForm>({
    resolver: zodResolver(setupSchema),
    defaultValues: { newPassword: "", confirmPassword: "", pin: "", confirmPin: "", recoveryEmail: "", recoveryPhone: "" },
  });

  const setupMutation = useMutation({
    mutationFn: async (data: SetupForm) => {
      const res = await apiRequest("POST", "/api/admin/initialize", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me"] });
      setLocation("/admin-dashboard");
    },
    onError: (e: Error) => setErrorMessage(e.message || "Setup failed. Please try again."),
  });

  function handleKeyPress(k: string) {
    if (activeField === "pin") {
      if (k === "⌫") { const v = pinValue.slice(0, -1); setPinValue(v); form.setValue("pin", v); }
      else if (pinValue.length < 6) { const v = pinValue + k; setPinValue(v); form.setValue("pin", v); if (v.length === 6) setActiveField("confirm"); }
    } else {
      if (k === "⌫") { const v = confirmPinValue.slice(0, -1); setConfirmPinValue(v); form.setValue("confirmPin", v); }
      else if (confirmPinValue.length < 6) { const v = confirmPinValue + k; setConfirmPinValue(v); form.setValue("confirmPin", v); }
    }
  }

  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "C"];

  function onSubmit(data: SetupForm) {
    setErrorMessage("");
    setupMutation.mutate(data);
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!pendingStatus?.pending) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="border-b bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-md bg-blue-600">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">BENIUS</h1>
            <p className="text-xs text-gray-500">First-Time Account Setup</p>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-start justify-center px-6 py-10">
        <div className="w-full max-w-lg">
          <div className="mb-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
              <ShieldCheck className="w-8 h-8 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Secure Your Account</h2>
            <p className="text-gray-500 mt-1 text-sm">Set your permanent password, 6-digit PIN, and recovery email. This is done only once.</p>
          </div>

          <Card className="bg-white shadow-md border-0">
            <CardHeader className="border-b bg-gray-50 rounded-t-lg pb-3">
              <CardTitle className="text-base font-semibold text-gray-800">Account Security Setup</CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  {errorMessage && (
                    <div className="flex items-center gap-2 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm" data-testid="text-setup-error">
                      <AlertCircle className="w-4 h-4 shrink-0" /> {errorMessage}
                    </div>
                  )}

                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-gray-700">Step 1: Set Your Permanent Password</p>
                    <p className="text-xs text-gray-400">Your temporary password assigned by Super Master will be replaced.</p>
                    <FormField control={form.control} name="newPassword" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-gray-600">New Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="At least 6 characters"
                              data-testid="input-new-password"
                              {...field}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(p => !p)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              data-testid="toggle-new-password"
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-gray-600">Confirm Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showConfirmPassword ? "text" : "password"}
                              placeholder="Repeat your new password"
                              data-testid="input-confirm-password"
                              {...field}
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(p => !p)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              data-testid="toggle-confirm-password"
                            >
                              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-700">Step 2: Create Your 6-Digit PIN</p>
                    <p className="text-xs text-gray-400">You will enter this PIN every time you log in.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div onClick={() => setActiveField("pin")}>
                        <PinDots value={pinValue} label="Create PIN" active={activeField === "pin"} />
                        {form.formState.errors.pin && <p className="text-xs text-red-500 mt-1">{form.formState.errors.pin.message}</p>}
                      </div>
                      <div onClick={() => setActiveField("confirm")}>
                        <PinDots value={confirmPinValue} label="Confirm PIN" active={activeField === "confirm"} />
                        {form.formState.errors.confirmPin && <p className="text-xs text-red-500 mt-1">{form.formState.errors.confirmPin.message}</p>}
                      </div>
                    </div>

                    <div className="p-1">
                      <p className="text-xs text-center text-gray-400 mb-3">
                        {activeField === "pin" ? "Entering: Create PIN" : "Entering: Confirm PIN"} — tap a number below
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {KEYS.map(k => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => {
                              if (k === "C") {
                                if (activeField === "pin") { setPinValue(""); form.setValue("pin", ""); }
                                else { setConfirmPinValue(""); form.setValue("confirmPin", ""); }
                              } else {
                                handleKeyPress(k);
                              }
                            }}
                            data-testid={`setup-key-${k}`}
                            className={`h-14 text-lg font-bold rounded-xl border transition-all select-none active:scale-95
                              ${k === "⌫" || k === "C" ? "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200" :
                                "bg-white text-gray-900 border-gray-200 hover:bg-gray-50 shadow-sm"}`}
                          >
                            {k}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-700">Step 3: Recovery Options</p>
                    <FormField control={form.control} name="recoveryEmail" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-gray-600">Recovery Email <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="backup@gmail.com" data-testid="input-recovery-email" {...field} />
                        </FormControl>
                        <p className="text-xs text-gray-400">Used to verify your identity if you need to reset your password.</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="recoveryPhone" render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs text-gray-600">Recovery Phone <span className="text-gray-400">(optional)</span></FormLabel>
                        <FormControl>
                          <Input type="tel" placeholder="+91 98765 43210" data-testid="input-recovery-phone" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={setupMutation.isPending} data-testid="button-complete-setup">
                    {setupMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
                    Complete Setup & Enter Dashboard
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-gray-400 mt-4">
            Your PIN is bcrypt-encrypted (12 rounds) and never stored in plain text.
          </p>
        </div>
      </main>
    </div>
  );
}
