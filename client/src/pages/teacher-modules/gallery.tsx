import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, Upload, X, ZoomIn, ChevronLeft, ChevronRight,
  Clock, CheckCircle2, Images, Plus, History, Calendar,
  Camera, XCircle, ImageOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { fmtDate } from "@/lib/dateUtils";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface GalleryEntry {
  id: number;
  title: string;
  description: string | null;
  eventTag: string | null;
  capturedDate: string | null;
  capturedTime: string | null;
  imageUrl: string;
  approved: boolean;
  uploadedById: number;
  createdAt: string;
}

export default function GalleryModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();

  const [showUpload, setShowUpload] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxSource, setLightboxSource] = useState<"gallery" | "history">("gallery");

  const [title, setTitle] = useState("");
  const [eventName, setEventName] = useState("");
  const [capturedDate, setCapturedDate] = useState("");
  const [capturedTime, setCapturedTime] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: schoolItems = [], isLoading } = useQuery<GalleryEntry[]>({
    queryKey: ["/api/gallery", teacher.schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/gallery/${teacher.schoolId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const { data: myItems = [], isLoading: myLoading } = useQuery<GalleryEntry[]>({
    queryKey: ["/api/gallery/teacher/mine"],
    queryFn: async () => {
      const res = await fetch("/api/gallery/teacher/mine", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const approvedItems = schoolItems.filter((i) => i.approved);
  const myPendingItems = myItems.filter((i) => !i.approved);
  const myHistoryItems = myItems.filter((i) => i.approved || (!i.approved && i.createdAt));

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 10) {
      toast({ title: "Too many files", description: "Up to 10 images at once.", variant: "destructive" });
      return;
    }
    setSelectedFiles(files);
    setPreviews(files.map((f) => URL.createObjectURL(f)));
  }, [toast]);

  const removeFile = useCallback((i: number) => {
    setSelectedFiles((p) => p.filter((_, idx) => idx !== i));
    setPreviews((p) => { URL.revokeObjectURL(p[i]); return p.filter((_, idx) => idx !== i); });
  }, []);

  const resetForm = () => {
    setTitle(""); setEventName(""); setCapturedDate(""); setCapturedTime(""); setDescription("");
    setSelectedFiles([]); previews.forEach((u) => URL.revokeObjectURL(u)); setPreviews([]);
    setUploadProgress(0); setIsUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const doUpload = async () => {
    if (!selectedFiles.length) throw new Error("Select at least one image");
    if (!title.trim()) throw new Error("Title is required");
    setIsUploading(true); setUploadProgress(0);
    const fd = new FormData();
    fd.append("title", title.trim());
    fd.append("schoolId", String(teacher.schoolId));
    if (description.trim()) fd.append("description", description.trim());
    if (eventName.trim()) fd.append("eventTag", eventName.trim());
    if (capturedDate) fd.append("capturedDate", capturedDate);
    if (capturedTime) fd.append("capturedTime", capturedTime);

    const isBatch = selectedFiles.length > 1;
    if (!isBatch) fd.append("image", selectedFiles[0]);
    else selectedFiles.forEach((f) => fd.append("images", f));

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(JSON.parse(xhr.responseText)?.message || "Upload failed"));
      });
      xhr.addEventListener("error", () => reject(new Error("Upload failed")));
      xhr.open("POST", isBatch ? "/api/gallery/batch" : "/api/gallery");
      xhr.withCredentials = true;
      xhr.send(fd);
    });
  };

  const handleUpload = async () => {
    try {
      await doUpload();
      toast({ title: "Upload Successful", description: "Images submitted for approval." });
      resetForm();
      setShowUpload(false);
      queryClient.invalidateQueries({ queryKey: ["/api/gallery", teacher.schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/gallery/teacher/mine"] });
    } catch (err: any) {
      toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
      setIsUploading(false); setUploadProgress(0);
    }
  };

  const lightboxItems = lightboxSource === "gallery" ? approvedItems : myHistoryItems;

  return (
    <div className="relative min-h-full pb-24">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Images className="w-5 h-5 text-violet-400" />
            School Gallery
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
            {approvedItems.length} approved photo{approvedItems.length !== 1 ? "s" : ""} from your school
          </p>
        </div>
      </div>

      {/* ── My Pending Uploads ── */}
      {myPendingItems.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.50)" }}>
            <Clock className="w-3.5 h-3.5" /> Awaiting Approval ({myPendingItems.length})
          </p>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {myPendingItems.map((item) => (
              <div
                key={item.id}
                className="relative flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.10)" }}
                data-testid={`card-gallery-pending-${item.id}`}
              >
                <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-end pb-1.5 px-1">
                  <span className="text-white text-[9px] font-semibold truncate w-full text-center">{item.title}</span>
                  <span className="text-[8px] mt-0.5 px-1.5 py-0.5 rounded-full bg-yellow-500/80 text-black font-bold">Pending</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Approved Gallery Grid ── */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400" data-testid="loader-gallery" />
        </div>
      ) : approvedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3" data-testid="text-no-gallery">
          <ImageOff className="w-12 h-12" style={{ color: "rgba(255,255,255,0.20)" }} />
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.40)" }}>No approved photos yet in the school gallery.</p>
        </div>
      ) : (
        <div className="columns-2 sm:columns-3 gap-3 space-y-3" data-testid="container-masonry-grid">
          {approvedItems.map((item, idx) => (
            <div
              key={item.id}
              className="break-inside-avoid relative rounded-xl overflow-hidden cursor-pointer group"
              onClick={() => { setLightboxSource("gallery"); setLightboxIndex(idx); }}
              data-testid={`card-gallery-${item.id}`}
              style={{ border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <img src={item.imageUrl} alt={item.title} className="w-full object-cover block" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2.5">
                <p className="text-white text-xs font-semibold leading-tight truncate">{item.title}</p>
                {item.eventTag && (
                  <p className="text-[10px] mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.70)" }}>{item.eventTag}</p>
                )}
                {item.capturedDate && (
                  <p className="text-[9px] mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                    {fmtDate(item.capturedDate)}{item.capturedTime ? ` · ${item.capturedTime}` : ""}
                  </p>
                )}
                <ZoomIn className="absolute top-2 right-2 w-4 h-4 text-white/70" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Approval History button ── */}
      <div className="mt-8 flex justify-center">
        <button
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.12)" }}
          data-testid="button-gallery-history"
        >
          <History className="w-4 h-4" /> My Upload History
        </button>
      </div>

      {/* ── FAB: + Upload button (fixed bottom-right) ── */}
      <button
        onClick={() => setShowUpload(true)}
        className="fixed bottom-6 right-4 flex items-center gap-2 px-4 py-3 rounded-2xl font-bold text-sm shadow-2xl z-50 transition-all active:scale-95"
        style={{
          background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
          color: "#fff",
          boxShadow: "0 8px 32px rgba(124,58,237,0.50)",
        }}
        data-testid="button-fab-upload"
      >
        <Plus className="w-5 h-5" />
        Upload
      </button>

      {/* ── Upload Dialog ── */}
      <Dialog open={showUpload} onOpenChange={(v) => { if (!v) resetForm(); setShowUpload(v); }}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col bg-white">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-gray-900">
              <Camera className="w-5 h-5 text-violet-600" />
              Upload Photos
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-3 pr-0.5 mt-1">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Album / Image Title *</label>
              <Input
                placeholder="e.g. Annual Sports Day 2026"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="input-gallery-title"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Event Name</label>
              <Input
                placeholder="e.g. Republic Day Celebration"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                data-testid="input-gallery-event-name"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Captured Date
                </label>
                <Input
                  type="date"
                  value={capturedDate}
                  onChange={(e) => setCapturedDate(e.target.value)}
                  data-testid="input-gallery-date"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Captured Time
                </label>
                <Input
                  type="time"
                  value={capturedTime}
                  onChange={(e) => setCapturedTime(e.target.value)}
                  data-testid="input-gallery-time"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Description</label>
              <Textarea
                placeholder="Brief description (optional)…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="resize-none"
                rows={2}
                data-testid="input-gallery-description"
              />
            </div>

            <div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full py-3 rounded-xl border-2 border-dashed text-sm font-medium transition-colors"
                style={{ borderColor: selectedFiles.length ? "#7c3aed" : "#e5e7eb", color: selectedFiles.length ? "#7c3aed" : "#9ca3af" }}
                data-testid="button-select-images"
              >
                <Images className="w-4 h-4 inline mr-2" />
                {selectedFiles.length ? `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected` : "Select Images (up to 10)"}
              </button>
              <input type="file" ref={fileRef} accept="image/*" multiple className="hidden" onChange={handleFileSelect} data-testid="input-gallery-file" />
            </div>

            {previews.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {previews.map((url, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
                      data-testid={`button-remove-preview-${i}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {isUploading && (
              <div className="space-y-1">
                <Progress value={uploadProgress} className="h-1.5" />
                <p className="text-xs text-gray-400 text-right">{uploadProgress}%</p>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-3 border-t flex-shrink-0">
            <Button variant="outline" className="flex-1" onClick={() => { resetForm(); setShowUpload(false); }}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
              onClick={handleUpload}
              disabled={!title.trim() || selectedFiles.length === 0 || isUploading}
              data-testid="button-upload-image"
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload for Approval
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Upload History Modal ── */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col bg-white">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-gray-900">
              <History className="w-5 h-5 text-violet-600" />
              My Upload History
            </DialogTitle>
            <p className="text-xs text-gray-500">All photos you have uploaded — approved or pending</p>
          </DialogHeader>

          {myLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
            </div>
          ) : myItems.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">You haven't uploaded any photos yet.</div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 mt-1">
              {myItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-2.5 rounded-xl border"
                  style={{
                    borderColor: item.approved ? "#bbf7d0" : "#fde68a",
                    background: item.approved ? "#f0fdf4" : "#fffbeb",
                  }}
                  data-testid={`history-gallery-${item.id}`}
                >
                  <div
                    className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 cursor-pointer"
                    onClick={() => { setLightboxSource("history"); setLightboxIndex(myItems.indexOf(item)); setShowHistory(false); }}
                  >
                    <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
                    {item.eventTag && <p className="text-xs text-gray-600 truncate">{item.eventTag}</p>}
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {item.capturedDate && (
                        <p className="text-[10px] text-gray-400">{fmtDate(item.capturedDate)}{item.capturedTime ? ` · ${item.capturedTime}` : ""}</p>
                      )}
                      <p className="text-[10px] text-gray-400">Uploaded {fmtDate(item.createdAt)}</p>
                    </div>
                  </div>
                  <span
                    className="flex-shrink-0 flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      background: item.approved ? "#dcfce7" : "#fef3c7",
                      color: item.approved ? "#15803d" : "#92400e",
                    }}
                  >
                    {item.approved ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                    {item.approved ? "Approved" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Lightbox ── */}
      <Dialog open={lightboxIndex !== null} onOpenChange={() => setLightboxIndex(null)}>
        <DialogContent className="max-w-4xl p-0 border-none overflow-hidden" style={{ background: "rgba(0,0,0,0.95)" }} data-testid="dialog-lightbox">
          {lightboxIndex !== null && lightboxItems[lightboxIndex] && (() => {
            const item = lightboxItems[lightboxIndex];
            return (
              <div className="relative flex flex-col items-center">
                <div className="relative w-full flex items-center justify-center min-h-[50vh] max-h-[80vh]">
                  <img src={item.imageUrl} alt={item.title} className="max-w-full max-h-[80vh] object-contain" data-testid="img-lightbox" />
                  {lightboxItems.length > 1 && (
                    <>
                      <Button size="icon" variant="ghost" className="absolute left-2 top-1/2 -translate-y-1/2 text-white bg-white/10"
                        onClick={(e) => { e.stopPropagation(); setLightboxIndex((p) => p !== null ? (p - 1 + lightboxItems.length) % lightboxItems.length : null); }}
                        data-testid="button-lightbox-prev">
                        <ChevronLeft className="w-5 h-5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="absolute right-2 top-1/2 -translate-y-1/2 text-white bg-white/10"
                        onClick={(e) => { e.stopPropagation(); setLightboxIndex((p) => p !== null ? (p + 1) % lightboxItems.length : null); }}
                        data-testid="button-lightbox-next">
                        <ChevronRight className="w-5 h-5" />
                      </Button>
                    </>
                  )}
                </div>
                <div className="w-full p-4 text-white">
                  <h3 className="text-base font-semibold" data-testid="text-lightbox-title">{item.title}</h3>
                  {item.eventTag && <p className="text-sm text-white/70 mt-0.5">{item.eventTag}</p>}
                  {item.description && <p className="text-sm text-white/60 mt-1" data-testid="text-lightbox-description">{item.description}</p>}
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {item.capturedDate && (
                      <span className="text-xs text-white/50 flex items-center gap-1">
                        <Camera className="w-3 h-3" />
                        {fmtDate(item.capturedDate)}{item.capturedTime ? ` at ${item.capturedTime}` : ""}
                      </span>
                    )}
                    <span className="text-xs text-white/40" data-testid="text-lightbox-date">
                      {lightboxIndex + 1} / {lightboxItems.length}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
