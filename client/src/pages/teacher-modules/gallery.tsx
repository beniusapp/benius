import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Upload, X, ZoomIn, ChevronLeft, ChevronRight, Clock, CheckCircle2, Images } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface GalleryEntry {
  id: number;
  title: string;
  description: string | null;
  eventTag: string | null;
  imageUrl: string;
  approved: boolean;
  createdAt: string;
}

const EVENT_TAGS = ["Sports", "Cultural", "Academic", "Other"];

export default function GalleryModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventTag, setEventTag] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: items = [], isLoading } = useQuery<GalleryEntry[]>({
    queryKey: ["/api/gallery", teacher.schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/gallery/${teacher.schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const approvedItems = items.filter((i) => i.approved);
  const pendingItems = items.filter((i) => !i.approved);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 10) {
      toast({ title: "Too many files", description: "You can upload up to 10 images at once.", variant: "destructive" });
      return;
    }
    setSelectedFiles(files);
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
  }, [toast]);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (selectedFiles.length === 0) throw new Error("Select at least one image");
      if (!title.trim()) throw new Error("Title is required");

      setIsUploading(true);
      setUploadProgress(0);

      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("schoolId", String(teacher.schoolId));
      if (description.trim()) fd.append("description", description.trim());
      if (eventTag) fd.append("eventTag", eventTag);

      if (selectedFiles.length === 1) {
        fd.append("image", selectedFiles[0]);
        const xhr = new XMLHttpRequest();
        return new Promise((resolve, reject) => {
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
            else reject(new Error(JSON.parse(xhr.responseText)?.message || "Upload failed"));
          });
          xhr.addEventListener("error", () => reject(new Error("Upload failed")));
          xhr.open("POST", "/api/gallery");
          xhr.withCredentials = true;
          xhr.send(fd);
        });
      } else {
        selectedFiles.forEach((f) => fd.append("images", f));
        const xhr = new XMLHttpRequest();
        return new Promise((resolve, reject) => {
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
            else reject(new Error(JSON.parse(xhr.responseText)?.message || "Upload failed"));
          });
          xhr.addEventListener("error", () => reject(new Error("Upload failed")));
          xhr.open("POST", "/api/gallery/batch");
          xhr.withCredentials = true;
          xhr.send(fd);
        });
      }
    },
    onSuccess: () => {
      toast({ title: "Upload Successful", description: "Your images have been submitted for approval." });
      setTitle("");
      setDescription("");
      setEventTag("");
      setSelectedFiles([]);
      previews.forEach((u) => URL.revokeObjectURL(u));
      setPreviews([]);
      setUploadProgress(0);
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/gallery", teacher.schoolId] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
      setIsUploading(false);
      setUploadProgress(0);
    },
  });

  const lightboxItems = approvedItems;

  return (
    <div className="space-y-6">
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
          <CardTitle className="text-lg flex items-center gap-2" data-testid="text-gallery-title">
            <Images className="w-5 h-5" />
            School Gallery
          </CardTitle>
          <Badge variant="secondary" data-testid="badge-gallery-count">
            {approvedItems.length} approved
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              placeholder="Album / Image title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-gallery-title"
            />
            <Select value={eventTag} onValueChange={setEventTag}>
              <SelectTrigger data-testid="select-event-tag">
                <SelectValue placeholder="Event Tag" />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag} data-testid={`option-event-tag-${tag.toLowerCase()}`}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="resize-none"
            rows={2}
            data-testid="input-gallery-description"
          />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                data-testid="button-select-images"
              >
                <Images className="w-4 h-4 mr-2" />
                Select Images (up to 10)
              </Button>
              <input
                type="file"
                ref={fileRef}
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileSelect}
                data-testid="input-gallery-file"
              />
              {selectedFiles.length > 0 && (
                <span className="text-sm text-muted-foreground" data-testid="text-file-count">
                  {selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""} selected
                </span>
              )}
            </div>

            {previews.length > 0 && (
              <div className="flex flex-wrap gap-2" data-testid="container-previews">
                {previews.map((url, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden group">
                    <img src={url} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" />
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
              <div className="space-y-1" data-testid="container-upload-progress">
                <Progress value={uploadProgress} className="h-2" />
                <p className="text-xs text-muted-foreground text-right">{uploadProgress}%</p>
              </div>
            )}

            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!title.trim() || selectedFiles.length === 0 || uploadMutation.isPending}
              data-testid="button-upload-image"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload for Approval
            </Button>
          </div>
        </CardContent>
      </Card>

      {pendingItems.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2" data-testid="text-pending-header">
            <Clock className="w-4 h-4" />
            Pending Approval ({pendingItems.length})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {pendingItems.map((item) => (
              <Card key={item.id} className="overflow-visible opacity-75" data-testid={`card-gallery-pending-${item.id}`}>
                <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden rounded-t-md relative">
                  <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                  <Badge variant="secondary" className="absolute top-2 right-2 text-xs">
                    <Clock className="w-3 h-3 mr-1" />
                    Pending
                  </Badge>
                </div>
                <CardContent className="p-3">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  {item.eventTag && (
                    <Badge variant="outline" className="mt-1 text-xs">
                      {item.eventTag}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" data-testid="loader-gallery" />
        </div>
      ) : approvedItems.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-gallery">
          No approved gallery images yet.
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2" data-testid="text-approved-header">
            <CheckCircle2 className="w-4 h-4" />
            Approved ({approvedItems.length})
          </h3>
          <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 space-y-3" data-testid="container-masonry-grid">
            {approvedItems.map((item, idx) => (
              <Card
                key={item.id}
                className="break-inside-avoid overflow-visible cursor-pointer hover-elevate"
                onClick={() => setLightboxIndex(idx)}
                data-testid={`card-gallery-${item.id}`}
              >
                <div className="overflow-hidden rounded-t-md">
                  <img src={item.imageUrl} alt={item.title} className="w-full object-cover" />
                </div>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      {item.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{item.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(item.createdAt).toLocaleDateString("en-GB")}
                      </p>
                    </div>
                    <ZoomIn className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  </div>
                  {item.eventTag && (
                    <Badge variant="outline" className="mt-2 text-xs">
                      {item.eventTag}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={lightboxIndex !== null} onOpenChange={() => setLightboxIndex(null)}>
        <DialogContent className="max-w-4xl p-0 bg-black/95 border-none overflow-hidden" data-testid="dialog-lightbox">
          {lightboxIndex !== null && lightboxItems[lightboxIndex] && (
            <div className="relative flex flex-col items-center">
              <div className="relative w-full flex items-center justify-center min-h-[50vh] max-h-[80vh]">
                <img
                  src={lightboxItems[lightboxIndex].imageUrl}
                  alt={lightboxItems[lightboxIndex].title}
                  className="max-w-full max-h-[80vh] object-contain"
                  data-testid="img-lightbox"
                />

                {lightboxItems.length > 1 && (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-white bg-white/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxIndex((prev) =>
                          prev !== null ? (prev - 1 + lightboxItems.length) % lightboxItems.length : null
                        );
                      }}
                      data-testid="button-lightbox-prev"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white bg-white/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxIndex((prev) =>
                          prev !== null ? (prev + 1) % lightboxItems.length : null
                        );
                      }}
                      data-testid="button-lightbox-next"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </Button>
                  </>
                )}
              </div>

              <div className="w-full p-4 text-white">
                <h3 className="text-lg font-medium" data-testid="text-lightbox-title">
                  {lightboxItems[lightboxIndex].title}
                </h3>
                {lightboxItems[lightboxIndex].description && (
                  <p className="text-sm text-white/70 mt-1" data-testid="text-lightbox-description">
                    {lightboxItems[lightboxIndex].description}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {lightboxItems[lightboxIndex].eventTag && (
                    <Badge variant="secondary" className="text-xs" data-testid="badge-lightbox-tag">
                      {lightboxItems[lightboxIndex].eventTag}
                    </Badge>
                  )}
                  <span className="text-xs text-white/50" data-testid="text-lightbox-date">
                    {new Date(lightboxItems[lightboxIndex].createdAt).toLocaleDateString("en-GB")}
                  </span>
                  <span className="text-xs text-white/50">
                    {lightboxIndex + 1} / {lightboxItems.length}
                  </span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
