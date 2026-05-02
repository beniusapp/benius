import { useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Plus, FileDown, Upload, X, Pencil, Trash2,
  BookOpen, Calendar, CheckCircle
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";
import { useSchoolConfigStrict } from "@/hooks/use-school-config";

interface ClassworkEntry {
  id: number;
  teacherId: number;
  subject: string;
  content: string;
  fileUrl: string | null;
  createdAt: string;
  class: string;
  section: string;
  teacherName: string;
}

const SUBJECT_COLORS: Record<string, string> = {
  Mathematics: "bg-blue-100 text-blue-700",
  Science: "bg-green-100 text-green-700",
  English: "bg-purple-100 text-purple-700",
  Hindi: "bg-orange-100 text-orange-700",
  History: "bg-amber-100 text-amber-700",
  Geography: "bg-teal-100 text-teal-700",
  Physics: "bg-indigo-100 text-indigo-700",
  Chemistry: "bg-emerald-100 text-emerald-700",
  Biology: "bg-lime-100 text-lime-700",
  Computer: "bg-cyan-100 text-cyan-700",
};

function getSubjectColor(subject: string): string {
  if (SUBJECT_COLORS[subject]) return SUBJECT_COLORS[subject];
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = subject.charCodeAt(i) + ((hash << 5) - hash);
  const palette = [
    "bg-sky-100 text-sky-700", "bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700",
    "bg-fuchsia-100 text-fuchsia-700", "bg-pink-100 text-pink-700", "bg-teal-100 text-teal-700",
  ];
  return palette[Math.abs(hash) % palette.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || "?").toUpperCase();
}

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ["bg-violet-500", "bg-indigo-500", "bg-sky-500", "bg-teal-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-pink-500"];
  return colors[Math.abs(hash) % colors.length];
}

export default function ClassworkModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const {
    classes,
    subjects,
    isLoading: configLoading,
    hasClasses,
    hasSections,
    getSectionsForClass,
  } = useSchoolConfigStrict(teacher.schoolId);
  const today = new Date().toISOString().split("T")[0];

  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSection, setSelectedSection] = useState("");
  const [subject, setSubject] = useState("");

  const sectionOpts = useMemo(
    () => getSectionsForClass(selectedClass),
    [selectedClass, getSectionsForClass]
  );

  function handleClassChange(cls: string) {
    setSelectedClass(cls);
    setSelectedSection("");
  }

  function handleSectionChange(sec: string) {
    setSelectedSection(sec);
  }
  const [content, setContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editContent, setEditContent] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const classSelected = selectedClass !== "";
  const sectionSelected = selectedSection !== "";
  const subjectSelected = subject.trim() !== "";
  const canPost = classSelected && sectionSelected && subjectSelected && content.trim().length > 0;

  const { data: entries = [], isLoading } = useQuery<ClassworkEntry[]>({
    queryKey: ["/api/classwork", teacher.schoolId, selectedClass, selectedSection],
    queryFn: async () => {
      const res = await fetch(
        `/api/classwork/${teacher.schoolId}/${encodeURIComponent(selectedClass)}/${selectedSection}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: classSelected && sectionSelected,
  });

  const handleFileSelect = useCallback((file: File | null) => {
    setSelectedFile(file);
    if (filePreview) URL.revokeObjectURL(filePreview);
    if (file && file.type.startsWith("image/")) {
      setFilePreview(URL.createObjectURL(file));
    } else {
      setFilePreview(null);
    }
  }, [filePreview]);

  const clearFile = useCallback(() => {
    setSelectedFile(null);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [filePreview]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", content);
      fd.append("subject", subject || teacher.subject || "General");
      fd.append("class", selectedClass);
      fd.append("section", selectedSection);
      if (selectedFile) fd.append("file", selectedFile);
      const res = await fetch("/api/classwork", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Activity Posted!", description: "Class activity has been logged successfully." });
      setContent("");
      setSubject("");
      clearFile();
      queryClient.invalidateQueries({ queryKey: ["/api/classwork", teacher.schoolId, selectedClass, selectedSection] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (id: number) => {
      const fd = new FormData();
      fd.append("content", editContent);
      fd.append("subject", editSubject);
      fd.append("keepFile", "true");
      const res = await fetch(`/api/classwork/${id}`, { method: "PATCH", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Activity Updated" });
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/classwork", teacher.schoolId, selectedClass, selectedSection] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/classwork/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Activity Deleted" });
      setDeleteConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/classwork", teacher.schoolId, selectedClass, selectedSection] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function startEdit(entry: ClassworkEntry) {
    setEditingId(entry.id);
    setEditSubject(entry.subject);
    setEditContent(entry.content);
  }

  const notConfigured = !configLoading && (!hasClasses || !hasSections);

  if (configLoading) {
    return (
      <div className="space-y-4" data-testid="loading-config">
        {[0,1].map(i => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}
      </div>
    );
  }

  if (notConfigured) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-6 text-center" data-testid="banner-not-configured">
        <BookOpen className="w-8 h-8 mx-auto text-amber-500 mb-3" />
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">School setup incomplete</p>
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Ask your admin to configure classes and sections in School Setup before posting class activities.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl shadow-lg border-0 bg-white dark:bg-gray-950" data-testid="card-create-classwork">
        <CardContent className="p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold tracking-tight" data-testid="text-classwork-title">Post Class Activity</h2>
            <span className="text-xs text-muted-foreground ml-auto">Class Activity / Lesson Log</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Class *</label>
              <Select value={selectedClass} onValueChange={handleClassChange}>
                <SelectTrigger className="rounded-xl" data-testid="select-class">
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Section *</label>
              <Select value={selectedSection} onValueChange={handleSectionChange} disabled={!selectedClass}>
                <SelectTrigger className="rounded-xl" data-testid="select-section">
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
                <SelectContent>
                  {sectionOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Subject *</label>
              {subjects.length > 0 ? (
                <Select value={subject} onValueChange={setSubject}>
                  <SelectTrigger className="rounded-xl" data-testid="select-subject">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Enter subject *"
                  className="rounded-xl"
                  data-testid="input-subject"
                />
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Activity Date</label>
              <Input type="date" value={today} readOnly className="rounded-xl bg-muted/50 cursor-not-allowed" data-testid="input-date" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description *</label>
            <Textarea
              placeholder="Describe the class activity or lesson details..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="rounded-xl resize-none"
              data-testid="input-classwork-content"
            />
          </div>

          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx"
              data-testid="input-classwork-file"
            />
            {!selectedFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-muted-foreground/25 rounded-xl p-6 flex flex-col items-center gap-2 text-muted-foreground hover:border-emerald-400 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 transition-colors cursor-pointer"
                data-testid="dropzone-upload"
              >
                <Upload className="w-8 h-8 opacity-40" />
                <span className="text-sm font-medium">Click to upload image or document</span>
                <span className="text-xs opacity-60">JPG, PNG, PDF, DOC (Max 10MB)</span>
              </button>
            ) : (
              <div className="flex items-center gap-4 p-3 border rounded-xl bg-muted/30" data-testid="file-preview">
                {filePreview ? (
                  <img src={filePreview} alt="Preview" className="w-[100px] h-[100px] object-cover rounded-lg border" />
                ) : (
                  <div className="w-[100px] h-[100px] rounded-lg border bg-muted flex items-center justify-center">
                    <FileDown className="w-8 h-8 text-muted-foreground/40" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={clearFile}
                  className="w-8 h-8 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center transition-colors shrink-0"
                  data-testid="button-remove-file"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canPost || createMutation.isPending}
            className={`w-full h-12 rounded-xl text-sm font-semibold transition-all ${
              canPost
                ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md active:scale-[0.98]"
                : "opacity-50 cursor-not-allowed bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
            }`}
            data-testid="button-post-classwork"
          >
            {createMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            {!classSelected || !sectionSelected ? "Select Class & Section to Post" : "Post Class Activity"}
          </Button>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-base font-bold tracking-tight mb-3" data-testid="text-history-title">
          {classSelected && sectionSelected ? `Activity Feed — ${selectedClass} ${selectedSection}` : "Select a class to view activities"}
        </h3>

        {!classSelected || !sectionSelected ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-20" />
            Choose a class and section above to view or post class activities.
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-xl border bg-card p-5 animate-pulse">
                <div className="flex justify-between mb-3">
                  <div className="h-5 w-20 bg-muted rounded-full" />
                  <div className="h-8 w-8 bg-muted rounded-full" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </div>
                <div className="h-3 bg-muted rounded w-24 mt-4" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm" data-testid="text-no-classwork">
            <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-20" />
            No class activities logged yet for this class.
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => {
              const isEditing = editingId === entry.id;
              const isDeleting = deleteConfirmId === entry.id;
              const isOwner = entry.teacherId === teacher.id;

              return (
                <div
                  key={entry.id}
                  className="rounded-xl border bg-card shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                  data-testid={`card-classwork-${entry.id}`}
                >
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getSubjectColor(entry.subject)}`}
                          data-testid={`badge-subject-${entry.id}`}>
                          {entry.subject}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(entry.createdAt).toLocaleDateString("en-GB")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${getAvatarColor(entry.teacherName)}`}
                          title={entry.teacherName}>
                          {getInitials(entry.teacherName)}
                        </div>
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="space-y-3">
                        <Input
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          placeholder="Subject"
                          className="rounded-xl"
                          data-testid={`input-edit-subject-${entry.id}`}
                        />
                        <Textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={3}
                          className="rounded-xl resize-none"
                          data-testid={`input-edit-content-${entry.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => updateMutation.mutate(entry.id)}
                            disabled={updateMutation.isPending}
                            className="rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white"
                            data-testid={`button-save-edit-${entry.id}`}
                          >
                            {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="rounded-lg"
                            data-testid={`button-cancel-edit-${entry.id}`}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid={`text-content-${entry.id}`}>
                        {entry.content}
                      </p>
                    )}

                    {entry.fileUrl && !isEditing && (
                      <a
                        href={entry.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-3 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                        data-testid={`link-file-${entry.id}`}
                      >
                        <FileDown className="w-3.5 h-3.5" /> View Attachment
                      </a>
                    )}

                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                      <span className="text-xs text-muted-foreground">
                        Posted by {entry.teacherName}
                      </span>
                      {isOwner && !isEditing && (
                        <div className="flex items-center gap-1">
                          {isDeleting ? (
                            <>
                              <span className="text-xs text-destructive mr-1">Delete?</span>
                              <Button size="sm" variant="destructive" className="h-7 px-2 rounded-lg text-xs"
                                onClick={() => deleteMutation.mutate(entry.id)}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-confirm-delete-${entry.id}`}
                              >
                                {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-2 rounded-lg text-xs"
                                onClick={() => setDeleteConfirmId(null)}
                                data-testid={`button-cancel-delete-${entry.id}`}
                              >
                                No
                              </Button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEdit(entry)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                                data-testid={`button-edit-${entry.id}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(entry.id)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                data-testid={`button-delete-${entry.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
