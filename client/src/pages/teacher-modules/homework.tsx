import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Plus, FileDown, Paperclip } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface HomeworkEntry {
  id: number;
  content: string;
  fileUrl: string | null;
  createdAt: string;
}

export default function HomeworkModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: entries = [], isLoading } = useQuery<HomeworkEntry[]>({
    queryKey: ["/api/homework", teacher.schoolId, teacher.assignedClass, teacher.assignedSection],
    queryFn: async () => {
      const res = await fetch(`/api/homework/${teacher.schoolId}/${teacher.assignedClass}/${teacher.assignedSection}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", content);
      fd.append("class", teacher.assignedClass);
      fd.append("section", teacher.assignedSection);
      if (fileRef.current?.files?.[0]) fd.append("file", fileRef.current.files[0]);
      const res = await fetch("/api/homework", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Homework Posted" });
      setContent("");
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/homework", teacher.schoolId, teacher.assignedClass, teacher.assignedSection] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-homework-title">
            Homework - Class {teacher.assignedClass} {teacher.assignedSection}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Enter homework details..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            data-testid="input-homework-content"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-muted-foreground" />
              <input type="file" ref={fileRef} className="text-sm" data-testid="input-homework-file" />
            </div>
            <Button
              onClick={() => { if (content.trim()) createMutation.mutate(); }}
              disabled={!content.trim() || createMutation.isPending}
              data-testid="button-post-homework"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Post Homework
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Previous Homework</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-homework">No homework posted yet.</p>
          ) : (
            <div className="space-y-3">
              {entries.map((e) => (
                <div key={e.id} className="p-3 rounded-md border" data-testid={`card-homework-${e.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</span>
                    {e.fileUrl && (
                      <a href={e.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1" data-testid={`link-file-${e.id}`}>
                        <FileDown className="w-3 h-3" /> Attachment
                      </a>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{e.content}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
