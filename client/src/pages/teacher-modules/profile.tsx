import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  User, Mail, Phone, BookOpen, GraduationCap,
  Camera, Loader2, Lock, Eye, EyeOff, CheckCircle, X,
  ZoomIn, ZoomOut, MoreVertical, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import type { TeacherMe } from "@/pages/teacher-dashboard";

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", (e) => reject(e));
    img.crossOrigin = "anonymous";
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Canvas is empty"));
        else resolve(blob);
      },
      "image/jpeg",
      0.92,
    );
  });
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const menuVariants = {
  hidden: { opacity: 0, scale: 0.95, y: -6 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: "easeOut" } },
  exit: { opacity: 0, scale: 0.95, y: -4, transition: { duration: 0.13, ease: "easeIn" } },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.22, ease: "easeOut" } },
  exit: { opacity: 0, scale: 0.94, transition: { duration: 0.15, ease: "easeIn" } },
};

export default function ProfileModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Photo crop state
  const [cropOpen, setCropOpen] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  // ⋮ menu state
  const [menuOpen, setMenuOpen] = useState(false);

  // Security modal state
  const [securityOpen, setSecurityOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  // Clear password fields when modal closes
  useEffect(() => {
    if (!securityOpen) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowCurrent(false);
      setShowNew(false);
      setShowConfirm(false);
    }
  }, [securityOpen]);

  const fields = [
    { icon: User, label: "Full Name", value: teacher.fullName },
    { icon: Mail, label: "Email", value: teacher.email },
    { icon: Phone, label: "Phone", value: teacher.phone || "—" },
    { icon: BookOpen, label: "Subject", value: teacher.subject || "—" },
    {
      icon: GraduationCap,
      label: "Assigned Class",
      value: teacher.assignedClass ? `${teacher.assignedClass} – ${teacher.assignedSection}` : "—",
    },
  ];

  const uploadMutation = useMutation({
    mutationFn: async (blob: Blob) => {
      const fd = new FormData();
      fd.append("file", blob, "profile.jpg");
      const res = await fetch("/api/teacher/profile-picture", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Profile photo updated!" });
      queryClient.invalidateQueries({ queryKey: ["/api/teacher-me"] });
      setCropOpen(false);
      setRawImageSrc(null);
    },
    onError: (e: Error) =>
      toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/teacher/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
        credentials: "include",
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message);
      }
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Security credentials updated successfully." });
      setSecurityOpen(false);
      await fetch("/api/teacher-logout", { method: "POST", credentials: "include" });
      setLocation("/teacher-login");
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum 8MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRawImageSrc(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleCropSave = async () => {
    if (!rawImageSrc || !croppedAreaPixels) return;
    const blob = await getCroppedImg(rawImageSrc, croppedAreaPixels);
    uploadMutation.mutate(blob);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Password too short", description: "At least 6 characters required.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate();
  };

  const initials = teacher.fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      {/* ── Crop Modal ── */}
      <Dialog open={cropOpen} onOpenChange={(o) => { if (!o) { setCropOpen(false); setRawImageSrc(null); } }}>
        <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl bg-[#0f1c30] border border-white/10">
          <DialogHeader className="px-5 pt-4 pb-2">
            <DialogTitle className="text-white text-base font-semibold flex items-center gap-2">
              <Camera className="w-4 h-4 text-[#10b981]" /> Crop Profile Photo
            </DialogTitle>
          </DialogHeader>

          <div className="relative w-full h-72 bg-black">
            {rawImageSrc && (
              <Cropper
                image={rawImageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            )}
          </div>

          <div className="px-5 py-3 space-y-3">
            <div className="flex items-center gap-3">
              <ZoomOut className="w-4 h-4 text-white/50 flex-shrink-0" />
              <Slider
                min={1}
                max={3}
                step={0.05}
                value={[zoom]}
                onValueChange={([v]) => setZoom(v)}
                className="flex-1"
              />
              <ZoomIn className="w-4 h-4 text-white/50 flex-shrink-0" />
            </div>
            <p className="text-xs text-white/40 text-center">Drag to reposition · Pinch or scroll to zoom</p>
          </div>

          <div className="px-5 pb-5 flex gap-3">
            <Button
              variant="ghost"
              className="flex-1 border border-white/15 text-white/70 hover:bg-white/8 rounded-xl"
              onClick={() => { setCropOpen(false); setRawImageSrc(null); }}
              disabled={uploadMutation.isPending}
            >
              <X className="w-4 h-4 mr-1.5" /> Cancel
            </Button>
            <Button
              className="flex-1 bg-[#10b981] hover:bg-emerald-600 text-white font-semibold rounded-xl"
              onClick={handleCropSave}
              disabled={uploadMutation.isPending || !croppedAreaPixels}
              data-testid="button-crop-save"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-1.5" />
              )}
              Crop & Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Security / Password Modal ── */}
      <Dialog open={securityOpen} onOpenChange={setSecurityOpen}>
        <DialogContent className="max-w-sm mx-4 p-0 overflow-hidden rounded-2xl bg-[#0f1c30] border border-white/10 shadow-2xl">
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <DialogHeader className="px-5 pt-5 pb-3 border-b border-white/8">
              <DialogTitle className="text-white text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#10b981]" /> Update Password
              </DialogTitle>
              <p className="text-xs text-white/40 mt-0.5">Enter your current password to confirm identity</p>
            </DialogHeader>

            <form onSubmit={handlePasswordSubmit} className="px-5 py-5 space-y-4">
              {/* Current Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wide">
                  Current Password
                </label>
                <div className="relative">
                  <Input
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="rounded-xl pr-10 bg-white/[0.06] border-white/[0.12] text-white placeholder:text-white/25 focus:border-[#10b981]/50 focus:ring-[#10b981]/20"
                    data-testid="input-current-password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    data-testid="button-toggle-current"
                  >
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wide">
                  New Password <span className="text-white/25 normal-case">(min 6 chars)</span>
                </label>
                <div className="relative">
                  <Input
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="rounded-xl pr-10 bg-white/[0.06] border-white/[0.12] text-white placeholder:text-white/25 focus:border-[#10b981]/50 focus:ring-[#10b981]/20"
                    data-testid="input-new-password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    data-testid="button-toggle-new"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-white/50 uppercase tracking-wide">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className={`rounded-xl pr-10 bg-white/[0.06] border-white/[0.12] text-white placeholder:text-white/25 focus:border-[#10b981]/50 focus:ring-[#10b981]/20 ${
                      confirmPassword && confirmPassword !== newPassword ? "border-red-400/50" : ""
                    }`}
                    data-testid="input-confirm-password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    data-testid="button-toggle-confirm"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPassword && confirmPassword !== newPassword && (
                  <p className="text-xs text-red-400">Passwords do not match</p>
                )}
                {confirmPassword && confirmPassword === newPassword && newPassword.length >= 6 && (
                  <p className="text-xs text-[#10b981] flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Passwords match
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1 border border-white/15 text-white/60 hover:bg-white/[0.06] rounded-xl h-11"
                  onClick={() => setSecurityOpen(false)}
                  disabled={changePasswordMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={changePasswordMutation.isPending}
                  className="flex-1 h-11 rounded-xl bg-[#10b981] hover:bg-emerald-600 text-white font-semibold shadow-lg shadow-emerald-900/30 transition-all"
                  data-testid="button-change-password"
                >
                  {changePasswordMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Lock className="w-4 h-4 mr-2" />
                  )}
                  Update Security
                </Button>
              </div>
            </form>
          </motion.div>
        </DialogContent>
      </Dialog>

      {/* ── Hidden file input ── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelect}
        data-testid="input-photo-file"
      />

      <motion.div
        className="max-w-2xl mx-auto space-y-5"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* ── Identity Card ── */}
        <motion.div
          variants={fadeUp}
          className="relative rounded-2xl overflow-visible border border-white/10 bg-gradient-to-br from-[#0f1e34]/90 to-[#0a1628]/90 backdrop-blur-sm shadow-xl"
        >
          <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_top_right,_rgba(16,185,129,0.12),_transparent_60%)] pointer-events-none" />

          {/* ⋮ Three-dot menu */}
          <div ref={menuRef} className="absolute top-3 right-3 z-20">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-11 h-11 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10 active:bg-white/15 transition-colors"
              aria-label="Options menu"
              data-testid="button-menu"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  variants={menuVariants}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  className="absolute right-0 top-12 w-52 rounded-2xl bg-[#0f1c30] border border-white/15 shadow-2xl overflow-hidden z-30"
                  data-testid="menu-options"
                >
                  <button
                    onClick={() => { setMenuOpen(false); setSecurityOpen(true); }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-white/80 hover:text-white hover:bg-white/[0.08] active:bg-white/[0.12] transition-colors min-h-[44px]"
                    data-testid="menu-security-option"
                  >
                    <ShieldCheck className="w-4 h-4 text-[#10b981] flex-shrink-0" />
                    Security & Credentials
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative px-6 pt-7 pb-6 flex flex-col items-center gap-1 text-center">
            {/* Avatar */}
            <div className="relative group mb-2">
              {teacher.profileImageUrl ? (
                <img
                  src={teacher.profileImageUrl}
                  alt={teacher.fullName}
                  className="w-24 h-24 rounded-full object-cover border-4 border-[#10b981]/60 shadow-xl"
                  data-testid="img-profile-photo"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#10b981]/30 to-emerald-700/30 border-4 border-[#10b981]/40 flex items-center justify-center shadow-xl">
                  <span className="text-2xl font-bold text-[#10b981]">{initials}</span>
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer backdrop-blur-sm"
                aria-label="Change photo"
                data-testid="button-upload-photo"
              >
                <Camera className="w-6 h-6 text-white" />
              </button>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-1 flex items-center gap-1.5 text-xs text-[#10b981] hover:text-emerald-400 font-medium transition-colors py-1 px-3 rounded-full border border-[#10b981]/30 hover:border-[#10b981]/60 hover:bg-[#10b981]/[0.08]"
              data-testid="button-change-photo"
            >
              <Camera className="w-3 h-3" /> Change Photo
            </button>

            <h2 className="mt-3 text-xl font-bold text-white" data-testid="text-profile-name">
              {teacher.fullName}
            </h2>
            <p className="text-sm text-emerald-300/80">{teacher.schoolName} · {teacher.schoolCode}</p>
          </div>

          {/* Info fields */}
          <div className="px-5 pb-6 space-y-2">
            {fields.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.label}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] hover:border-white/[0.15] transition-colors"
                  data-testid={`field-${f.label.toLowerCase().replace(/\s/g, "-")}`}
                >
                  <Icon className="w-4 h-4 text-[#10b981] flex-shrink-0" />
                  <div>
                    <p className="text-[10px] text-white/40 uppercase tracking-wide">{f.label}</p>
                    <p className="text-sm font-medium text-white">{f.value}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}
