import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Plus, FileDown, Paperclip } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface NoticeEntry {
  id: number;
  content: string;
  fileUrl: string | null;
  createdAt: string;
  creatorRole: string;
}

export default function NoticeboardModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"admin" | "student">("admin");
  const [content, setContent] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: adminNotices = [], isLoading: loadingAdmin } = useQuery<NoticeEntry[]>({
    queryKey: ["/api/notices", teacher.schoolId, "teacher"],
    queryFn: async () => {
      const res = await fetch(`/api/notices/${teacher.schoolId}?target=teacher`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: studentNotices = [], isLoading: loadingStudent } = useQuery<NoticeEntry[]>({
    queryKey: ["/api/notices", teacher.schoolId, "student", teacher.assignedClass, teacher.assignedSection],
    queryFn: async () => {
      const res = await fetch(`/api/notices/${teacher.schoolId}?target=student&class=${teacher.assignedClass}&section=${teacher.assignedSection}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", content);
      fd.append("targetType", "student");
      fd.append("targetClass", teacher.assignedClass);
      fd.append("targetSection", teacher.assignedSection);
      fd.append("schoolId", String(teacher.schoolId));
      if (fileRef.current?.files?.[0]) fd.append("file", fileRef.current.files[0]);
      const res = await fetch("/api/notices", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Notice Posted" });
      setContent("");
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/notices", teacher.schoolId, "student", teacher.assignedClass, teacher.assignedSection] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant={tab === "admin" ? "default" : "outline"} onClick={() => setTab("admin")} data-testid="tab-admin-notices">
          From Admin
        </Button>
        <Button variant={tab === "student" ? "default" : "outline"} onClick={() => setTab("student")} data-testid="tab-student-notices">
          Post to Students
        </Button>
      </div>

      {tab === "admin" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg" data-testid="text-admin-notices-title">Admin Notices</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingAdmin ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : adminNotices.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-admin-notices">No notices from admin.</p>
            ) : (
              <div className="space-y-3">
                {adminNotices.map((n) => (
                  <div key={n.id} className="p-3 rounded-md border" data-testid={`card-notice-${n.id}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleDateString()}</span>
                      {n.fileUrl && (
                        <a href={n.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1">
                          <FileDown className="w-3 h-3" /> Attachment
                        </a>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg" data-testid="text-post-notice-title">
                Post Notice to Class {teacher.assignedClass} {teacher.assignedSection}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Enter notice content..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                data-testid="input-notice-content"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-muted-foreground" />
                  <input type="file" ref={fileRef} className="text-sm" data-testid="input-notice-file" />
                </div>
                <Button
                  onClick={() => { if (content.trim()) postMutation.mutate(); }}
                  disabled={!content.trim() || postMutation.isPending}
                  data-testid="button-post-notice"
                >
                  {postMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  Post Notice
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Posted Notices</CardTitle></CardHeader>
            <CardContent>
              {loadingStudent ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : studentNotices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No notices posted yet.</p>
              ) : (
                <div className="space-y-3">
                  {studentNotices.map((n) => (
                    <div key={n.id} className="p-3 rounded-md border" data-testid={`card-student-notice-${n.id}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleDateString()}</span>
                        {n.fileUrl && (
                          <a href={n.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1">
                            <FileDown className="w-3 h-3" /> Attachment
                          </a>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
