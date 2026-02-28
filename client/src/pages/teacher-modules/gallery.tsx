import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Upload, Image as ImageIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface GalleryEntry { id: number; title: string; imageUrl: string; approved: boolean; createdAt: string; }

export default function GalleryModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: items = [], isLoading } = useQuery<GalleryEntry[]>({
    queryKey: ["/api/gallery", teacher.schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/gallery/${teacher.schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!fileRef.current?.files?.[0]) throw new Error("Select an image");
      const fd = new FormData();
      fd.append("title", title);
      fd.append("schoolId", String(teacher.schoolId));
      fd.append("image", fileRef.current.files[0]);
      const res = await fetch("/api/gallery", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Image Uploaded", description: "Your image has been submitted for approval." });
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/gallery", teacher.schoolId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-gallery-title">School Gallery</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <Input placeholder="Image title" value={title} onChange={(e) => setTitle(e.target.value)} className="max-w-xs" data-testid="input-gallery-title" />
            <input type="file" ref={fileRef} accept="image/*" className="text-sm" data-testid="input-gallery-file" />
            <Button onClick={() => uploadMutation.mutate()} disabled={!title.trim() || uploadMutation.isPending} data-testid="button-upload-image">
              {uploadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload for Approval
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-gallery">No gallery images yet.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((item) => (
            <Card key={item.id} className="overflow-hidden" data-testid={`card-gallery-${item.id}`}>
              <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
              </div>
              <CardContent className="p-3">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
