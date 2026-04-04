import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  User, Mail, Phone, BookOpen, GraduationCap,
  Camera, Loader2, Lock, Eye, EyeOff, CheckCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

export default function ProfileModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);

  const fields = [
    { icon: User, label: "Full Name", value: teacher.fullName },
    { icon: Mail, label: "Email", value: teacher.email },
    { icon: Phone, label: "Phone", value: teacher.phone || "—" },
    { icon: BookOpen, label: "Subject", value: teacher.subject || "—" },
    { icon: GraduationCap, label: "Assigned Class", value: teacher.assignedClass ? `${teacher.assignedClass} - ${teacher.assignedSection}` : "—" },
  ];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/teacher/profile-picture", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile picture updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher-me"] });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/teacher/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
        credentials: "include",
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed successfully" });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 4000);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum size is 5MB.", variant: "destructive" });
      return;
    }
    uploadMutation.mutate(file);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "All fields are required", variant: "destructive" }); return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Password too short", description: "At least 6 characters required.", variant: "destructive" }); return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" }); return;
    }
    changePasswordMutation.mutate();
  };

  const initials = teacher.fullName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* ── Avatar card ── */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="text-center pb-2">
          <div className="relative mx-auto w-24 h-24">
            {teacher.profileImageUrl ? (
              <img
                src={teacher.profileImageUrl}
                alt={teacher.fullName}
                className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-md"
                data-testid="img-profile-photo"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center border-4 border-white shadow-md">
                <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-300">{initials}</span>
              </div>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-lg transition-colors disabled:opacity-60"
              aria-label="Upload profile picture"
              data-testid="button-upload-photo"
            >
              {uploadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePhotoSelect}
              data-testid="input-photo-file"
            />
          </div>
          <CardTitle className="text-xl mt-2" data-testid="text-profile-name">{teacher.fullName}</CardTitle>
          <p className="text-sm text-muted-foreground">{teacher.schoolName} · {teacher.schoolCode}</p>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          {fields.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.label} className="flex items-center gap-3 p-3 rounded-xl bg-muted/50" data-testid={`field-${f.label.toLowerCase().replace(/\s/g, "-")}`}>
                <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="text-sm font-medium">{f.value}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Change Password card ── */}
      <Card className="rounded-2xl shadow-sm" data-testid="card-change-password">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="w-4 h-4 text-indigo-600" /> Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pwSuccess && (
            <div className="flex items-center gap-2 mb-4 p-3 rounded-xl bg-green-50 border border-green-200">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <p className="text-sm font-medium text-green-700">Password changed successfully!</p>
            </div>
          )}
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Current Password *</label>
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="rounded-xl pr-10"
                  data-testid="input-current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-current"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">New Password * (min 6 characters)</label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="rounded-xl pr-10"
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-new"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Confirm New Password *</label>
              <div className="relative">
                <Input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className={`rounded-xl pr-10 ${confirmPassword && confirmPassword !== newPassword ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                  data-testid="input-confirm-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-confirm"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && confirmPassword !== newPassword && (
                <p className="text-xs text-red-500 mt-0.5">Passwords do not match</p>
              )}
            </div>

            <Button
              type="submit"
              disabled={changePasswordMutation.isPending}
              className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              data-testid="button-change-password"
            >
              {changePasswordMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
              Update Password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
