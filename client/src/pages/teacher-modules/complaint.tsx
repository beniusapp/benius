import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Plus, FileDown, Upload, X, Pencil, Trash2,
  Shield, Calendar, MessageSquare, ChevronDown, ChevronUp, Send, Search,
  Users, AlertTriangle, CheckCircle, Clock, ArrowUpCircle
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface SearchResult {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  photoUrl: string | null;
}
interface ComplaintEntry {
  id: number;
  ticketId: string;
  teacherId: number;
  studentId: number | null;
  complaintType: string;
  status: string;
  content: string;
  reportedStudentName: string | null;
  studentName: string | null;
  fileUrl: string | null;
  createdAt: string;
  resolutionRemarks: string | null;
  escalatedToPrincipal: boolean;
  notifyAdmin: boolean;
}
interface ComplaintNote {
  id: number;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
}

interface ClassFeedEntry {
  id: number;
  ticketId: string;
  status: string;
  content: string;
  reportedStudentName: string | null;
  incidentDate: string | null;
  complainantClass: string | null;
  complainantSection: string | null;
  resolutionRemarks: string | null;
  escalatedToPrincipal: boolean | null;
  complainantStudentName: string | null;
  createdAt: string;
}

type ComplaintType = "teacher-to-student" | "teacher-to-admin";

const STATUS_STYLES: Record<string, string> = {
  Pending: "bg-red-100 text-red-700 border-red-300",
  Investigating: "bg-orange-100 text-orange-700 border-orange-300",
  Resolved: "bg-green-100 text-green-700 border-green-300",
};

const TYPE_LABELS: Record<string, string> = {
  "teacher-to-student": "Teacher → Student",
  "teacher-to-admin": "Teacher → Admin (Private)",
};

const TYPE_PILLS: Record<string, string> = {
  "teacher-to-student": "bg-blue-100 text-blue-700",
  "teacher-to-admin": "bg-amber-100 text-amber-700",
};

function ResolutionThread({ complaintId, teacherId }: { complaintId: number; teacherId: number }) {
  const { toast } = useToast();
  const [noteContent, setNoteContent] = useState("");
  const [expanded, setExpanded] = useState(false);

  const { data: notes = [], isLoading } = useQuery<ComplaintNote[]>({
    queryKey: ["/api/complaints", complaintId, "notes"],
    queryFn: async () => {
      const res = await fetch(`/api/complaints/${complaintId}/notes`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: expanded,
  });

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/complaints/${complaintId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent }),
        credentials: "include",
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Note Added" });
      setNoteContent("");
      queryClient.invalidateQueries({ queryKey: ["/api/complaints", complaintId, "notes"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="mt-3 pt-3 border-t border-dashed">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`button-toggle-thread-${complaintId}`}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        Resolution Thread
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {notes.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-muted text-[10px]">{notes.length}</span>}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {isLoading ? (
            <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin" /></div>
          ) : notes.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No resolution notes yet.</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="p-2.5 rounded-lg bg-muted/40 border" data-testid={`note-${n.id}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold">{n.authorName}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${n.authorRole === "admin" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                    {n.authorRole === "admin" ? "Principal" : "Teacher"}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(n.createdAt).toLocaleDateString("en-GB")}
                  </span>
                </div>
                <p className="text-xs whitespace-pre-wrap">{n.content}</p>
              </div>
            ))
          )}

          <div className="flex gap-2 mt-2">
            <Input
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Add a resolution note..."
              className="rounded-lg text-xs h-8"
              data-testid={`input-note-${complaintId}`}
            />
            <Button
              size="sm"
              onClick={() => addNoteMutation.mutate()}
              disabled={!noteContent.trim() || addNoteMutation.isPending}
              className="h-8 px-3 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs"
              data-testid={`button-add-note-${complaintId}`}
            >
              {addNoteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StudentSearchInput({
  schoolId,
  label,
  onSelect,
  selectedStudent,
  onClear,
}: {
  schoolId: number;
  label: string;
  onSelect: (student: SearchResult) => void;
  selectedStudent: SearchResult | null;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: results = [], isFetching } = useQuery<SearchResult[]>({
    queryKey: ["/api/students/search", schoolId, debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/students/search/${schoolId}?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: debouncedQuery.length >= 2,
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (selectedStudent) {
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        <Card className="rounded-xl border" data-testid="card-student-mini-profile">
          <CardContent className="p-3 flex items-center gap-3">
            <Avatar className="h-10 w-10" data-testid="img-student-avatar">
              <AvatarImage src={selectedStudent.photoUrl || undefined} alt={selectedStudent.name} />
              <AvatarFallback className="bg-indigo-100 text-indigo-700 text-sm font-semibold dark:bg-indigo-950 dark:text-indigo-300">
                {selectedStudent.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" data-testid="text-student-name">{selectedStudent.name}</p>
              <p className="text-xs text-muted-foreground" data-testid="text-student-details">
                {selectedStudent.digitalStudentId} · Class {selectedStudent.class}-{selectedStudent.section}
              </p>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
              data-testid="button-clear-student"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-1 relative" ref={containerRef}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          placeholder="Search by name or DSID (min 2 chars)..."
          className="rounded-xl pl-9"
          data-testid="input-search-student"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {showDropdown && debouncedQuery.length >= 2 && (
        <div className="absolute z-50 w-full mt-1 bg-card border rounded-xl shadow-lg max-h-60 overflow-y-auto" data-testid="dropdown-search-results">
          {results.length === 0 && !isFetching ? (
            <div className="p-3 text-center text-xs text-muted-foreground">No students found</div>
          ) : (
            results.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onSelect(s);
                  setQuery("");
                  setDebouncedQuery("");
                  setShowDropdown(false);
                }}
                className="w-full flex items-center gap-3 p-2.5 text-left hover-elevate transition-colors"
                data-testid={`option-student-${s.id}`}
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={s.photoUrl || undefined} alt={s.name} />
                  <AvatarFallback className="bg-muted text-xs font-semibold">
                    {s.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.digitalStudentId} · {s.class}-{s.section}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function feedStatusBadge(status: string) {
  const cfg: Record<string, { label: string; cls: string; Icon: typeof CheckCircle }> = {
    Pending:   { label: "Pending",   cls: "bg-amber-400 text-black border-amber-500",   Icon: Clock         },
    Resolved:  { label: "Resolved",  cls: "bg-emerald-400 text-black border-emerald-500", Icon: CheckCircle },
    Escalated: { label: "Escalated", cls: "bg-red-400 text-black border-red-500",         Icon: AlertTriangle },
  };
  const s = cfg[status] ?? { label: status, cls: "bg-gray-300 text-black border-gray-400", Icon: Clock };
  const Icon = s.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${s.cls}`}>
      <Icon className="w-3 h-3" /> {s.label}
    </span>
  );
}

function ClassFeedDrawer({
  entry, teacher, onClose,
}: {
  entry: ClassFeedEntry;
  teacher: TeacherMe;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [resolveRemarks, setResolveRemarks] = useState("");
  const [showResolveBox, setShowResolveBox] = useState(false);

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/complaints/${entry.id}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionRemarks: resolveRemarks }),
        credentials: "include",
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Complaint Resolved" });
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/class-feed"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const escalateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/complaints/${entry.id}/escalate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Escalated to Principal" });
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/class-feed"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canAct = entry.status === "Pending" || entry.status === "Investigating";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl p-5 space-y-4"
        onClick={e => e.stopPropagation()}
        data-testid="drawer-class-feed"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="font-bold text-sm">Peer Report #{entry.ticketId}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(entry.createdAt).toLocaleDateString("en-GB")} · Class {entry.complainantClass}-{entry.complainantSection}
            </p>
          </div>
          {feedStatusBadge(entry.status)}
        </div>

        <div className="space-y-2 text-sm">
          <div><span className="text-xs font-semibold text-muted-foreground">Reported by</span>
            <p className="font-medium">{entry.complainantStudentName || "Anonymous"}</p>
          </div>
          {entry.reportedStudentName && (
            <div><span className="text-xs font-semibold text-muted-foreground">Against</span>
              <p className="font-medium">{entry.reportedStudentName}</p>
            </div>
          )}
          {entry.incidentDate && (
            <div><span className="text-xs font-semibold text-muted-foreground">Incident Date</span>
              <p>{new Date(entry.incidentDate).toLocaleDateString("en-GB")}</p>
            </div>
          )}
          <div><span className="text-xs font-semibold text-muted-foreground">Description</span>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{entry.content}</p>
          </div>
          {entry.resolutionRemarks && (
            <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-xl border border-green-200">
              <p className="text-xs font-bold text-green-800">
                {entry.escalatedToPrincipal ? "Principal's Remarks" : "Resolution Remarks"}
              </p>
              <p className="text-xs font-semibold text-green-700 mt-0.5">{entry.resolutionRemarks}</p>
            </div>
          )}
          {entry.escalatedToPrincipal && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-bold">
              <AlertTriangle className="w-3.5 h-3.5" /> Escalated to Principal
              {!entry.resolutionRemarks && <span className="font-normal ml-1 text-red-500">— awaiting response</span>}
            </div>
          )}
        </div>

        {canAct && (
          <div className="pt-2 space-y-3 border-t">
            {showResolveBox ? (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Resolution Remarks *</label>
                <Textarea
                  value={resolveRemarks}
                  onChange={e => setResolveRemarks(e.target.value)}
                  rows={3}
                  placeholder="Describe how this was resolved..."
                  className="rounded-xl resize-none text-sm"
                  data-testid="input-resolve-remarks"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => resolveMutation.mutate()}
                    disabled={!resolveRemarks.trim() || resolveMutation.isPending}
                    className="rounded-xl bg-emerald-400 hover:bg-emerald-500 text-black font-bold flex-1"
                    data-testid="button-confirm-resolve"
                  >
                    {resolveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />}
                    Confirm Resolve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowResolveBox(false)} className="rounded-xl">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => setShowResolveBox(true)}
                  className="rounded-xl bg-emerald-400 hover:bg-emerald-500 text-black font-bold flex-1"
                  data-testid="button-resolve"
                >
                  <CheckCircle className="w-4 h-4 mr-1" /> Mark as Solved
                </Button>
                <Button
                  size="sm"
                  onClick={() => escalateMutation.mutate()}
                  disabled={escalateMutation.isPending || !!entry.escalatedToPrincipal}
                  className="rounded-xl bg-amber-400 hover:bg-amber-500 text-black font-bold flex-1"
                  data-testid="button-escalate"
                >
                  {escalateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4 mr-1" />}
                  Escalate to Principal
                </Button>
              </div>
            )}
          </div>
        )}

        <Button variant="ghost" size="sm" onClick={onClose} className="w-full rounded-xl" data-testid="button-close-drawer">
          Close
        </Button>
      </div>
    </div>
  );
}

function ClassFeedTab({ teacher }: { teacher: TeacherMe }) {
  const [selected, setSelected] = useState<ClassFeedEntry | null>(null);

  const { data: feed = [], isLoading } = useQuery<ClassFeedEntry[]>({
    queryKey: ["/api/complaints/class-feed"],
    queryFn: async () => {
      const res = await fetch("/api/complaints/class-feed", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-purple-600" />
        <h2 className="text-base font-bold">Class Feed — Peer Reports</h2>
        <span className="ml-auto text-xs text-muted-foreground">Class {teacher.assignedClass}-{teacher.assignedSection}</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-purple-600" /></div>
      ) : feed.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-20" />
          <p className="text-sm">No peer reports for your class yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {feed.map(entry => (
            <button
              key={entry.id}
              onClick={() => setSelected(entry)}
              className="w-full text-left rounded-xl border bg-card shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 p-4"
              data-testid={`card-feed-${entry.id}`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="font-mono text-xs font-bold text-purple-600 bg-purple-50 dark:bg-purple-950/30 px-2 py-0.5 rounded">
                  {entry.ticketId}
                </span>
                {feedStatusBadge(entry.status)}
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                <span className="font-semibold text-foreground">{entry.complainantStudentName || "Anonymous"}</span>
                {entry.reportedStudentName && <span> → against <span className="font-semibold text-foreground">{entry.reportedStudentName}</span></span>}
              </p>
              <p className="text-sm line-clamp-2 text-muted-foreground">{entry.content}</p>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1 flex-wrap">
                <Calendar className="w-3 h-3" />
                {entry.incidentDate
                  ? <>Incident: {new Date(entry.incidentDate).toLocaleDateString("en-GB")}</>
                  : <>Filed: {new Date(entry.createdAt).toLocaleDateString("en-GB")}</>
                }
                {entry.escalatedToPrincipal && <span className="ml-2 text-red-500 font-medium">· Escalated</span>}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ClassFeedDrawer
          entry={selected}
          teacher={teacher}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

export default function ComplaintModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<"my" | "feed">("my");

  const [complaintType, setComplaintType] = useState<ComplaintType>("teacher-to-student");
  const [selectedStudent, setSelectedStudent] = useState<SearchResult | null>(null);
  const [content, setContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [notifyAdmin, setNotifyAdmin] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const { data: complaints = [], isLoading } = useQuery<ComplaintEntry[]>({
    queryKey: ["/api/complaints/teacher", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/complaints/teacher/${teacher.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const canPost = (() => {
    if (!content.trim()) return false;
    if (complaintType === "teacher-to-admin") return true;
    return selectedStudent !== null;
  })();

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

  const submitMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("content", content);
      fd.append("complaintType", complaintType);
      if (complaintType !== "teacher-to-admin" && selectedStudent) fd.append("studentId", String(selectedStudent.id));
      if (selectedFile) fd.append("file", selectedFile);
      if (notifyAdmin && complaintType === "teacher-to-student") fd.append("notifyAdmin", "true");
      const res = await fetch("/api/complaints", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Complaint Filed", description: "A unique ticket ID has been generated." });
      setContent("");
      setSelectedStudent(null);
      setNotifyAdmin(false);
      clearFile();
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/teacher", teacher.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (id: number) => {
      const fd = new FormData();
      fd.append("content", editContent);
      fd.append("keepFile", "true");
      const res = await fetch(`/api/complaints/${id}`, { method: "PATCH", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Complaint Updated" });
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/teacher", teacher.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/complaints/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Complaint Removed" });
      setDeleteConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/complaints/teacher", teacher.id] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-muted/50 rounded-xl" data-testid="complaint-view-toggle">
        <button
          onClick={() => setActiveView("my")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "my" ? "bg-white dark:bg-gray-900 shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-my-complaints"
        >
          <Shield className="w-3.5 h-3.5" /> My Complaints
        </button>
        <button
          onClick={() => setActiveView("feed")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "feed" ? "bg-white dark:bg-gray-900 shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          data-testid="tab-class-feed"
        >
          <Users className="w-3.5 h-3.5" /> Class Feed
        </button>
      </div>

      {activeView === "feed" && <ClassFeedTab teacher={teacher} />}

      {activeView === "my" && (
      <div className="space-y-6">
      <Card className="rounded-2xl shadow-lg border-0 bg-white dark:bg-gray-950" data-testid="card-create-complaint">
        <CardContent className="p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-bold tracking-tight" data-testid="text-complaint-title">Discipline & Resolution Hub</h2>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Complaint Type</label>
            <div className="flex gap-1 p-1 bg-muted/50 rounded-xl" data-testid="complaint-type-toggle">
              {([
                { key: "teacher-to-student" as ComplaintType, label: "Teacher → Student" },
                { key: "teacher-to-admin" as ComplaintType, label: "To Admin (Private)" },
              ]).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setComplaintType(opt.key); setSelectedStudent(null); setNotifyAdmin(false); }}
                  className={`flex-1 px-2 py-2 rounded-lg text-xs font-semibold transition-all ${
                    complaintType === opt.key
                      ? "bg-white dark:bg-gray-900 shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`type-${opt.key}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {complaintType === "teacher-to-student" && (
            <>
              <StudentSearchInput
                schoolId={teacher.schoolId}
                label="Student *"
                onSelect={(s) => setSelectedStudent(s)}
                selectedStudent={selectedStudent}
                onClear={() => setSelectedStudent(null)}
              />
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors" data-testid="label-notify-admin">
                <input
                  type="checkbox"
                  checked={notifyAdmin}
                  onChange={e => setNotifyAdmin(e.target.checked)}
                  className="w-4 h-4 accent-amber-600 cursor-pointer"
                  data-testid="checkbox-notify-admin"
                />
                <div>
                  <p className="text-xs font-bold text-amber-800">Also Notify Principal / Admin</p>
                  <p className="text-[11px] text-amber-700">Sends a copy to the Admin Complaint Hub for visibility.</p>
                </div>
              </label>
            </>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Description *</label>
            <Textarea
              placeholder="Describe the incident in detail..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="rounded-xl resize-none"
              data-testid="input-complaint-content"
            />
          </div>

          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx"
              data-testid="input-complaint-file"
            />
            {!selectedFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-muted-foreground/25 rounded-xl p-5 flex flex-col items-center gap-2 text-muted-foreground hover:border-red-400 hover:bg-red-50/30 dark:hover:bg-red-950/20 transition-colors cursor-pointer"
                data-testid="dropzone-evidence"
              >
                <Upload className="w-7 h-7 opacity-40" />
                <span className="text-sm font-medium">Upload Evidence (Photo / Screenshot)</span>
                <span className="text-xs opacity-60">JPG, PNG, PDF (Max 10MB)</span>
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
                <button type="button" onClick={clearFile}
                  className="w-8 h-8 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center transition-colors shrink-0"
                  data-testid="button-remove-file">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!canPost || submitMutation.isPending}
            className={`w-full h-12 rounded-xl text-sm font-semibold transition-all ${
              canPost
                ? "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white shadow-md active:scale-[0.98]"
                : "opacity-50 cursor-not-allowed bg-gradient-to-r from-red-600 to-rose-600 text-white"
            }`}
            data-testid="button-submit-complaint"
          >
            {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            {canPost ? "File Complaint" : "Complete Form to File Complaint"}
          </Button>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-base font-bold tracking-tight mb-3" data-testid="text-history-title">
          Complaint History
        </h3>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="rounded-xl border bg-card p-5 animate-pulse">
                <div className="flex justify-between mb-3">
                  <div className="h-5 w-32 bg-muted rounded-full" />
                  <div className="h-5 w-20 bg-muted rounded-full" />
                </div>
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : complaints.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm" data-testid="text-no-complaints">
            <Shield className="w-10 h-10 mx-auto mb-2 opacity-20" />
            No complaints filed yet.
          </div>
        ) : (
          <div className="space-y-3">
            {complaints.map((c) => {
              const isEditing = editingId === c.id;
              const isDeleting = deleteConfirmId === c.id;
              const isOwner = c.teacherId === teacher.id;
              const isPending = c.status === "Pending";

              return (
                <div key={c.id}
                  className="rounded-xl border bg-card shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                  data-testid={`card-complaint-${c.id}`}
                >
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded"
                          data-testid={`badge-ticket-${c.id}`}>
                          {c.ticketId}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${TYPE_PILLS[c.complaintType] || TYPE_PILLS["teacher-to-student"]}`}
                          data-testid={`badge-type-${c.id}`}>
                          {TYPE_LABELS[c.complaintType] || c.complaintType}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLES[c.status] || STATUS_STYLES.Pending}`}
                          data-testid={`badge-status-${c.id}`}>
                          {c.status}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                        <Calendar className="w-3 h-3" />
                        {new Date(c.createdAt).toLocaleDateString("en-GB")}
                      </span>
                    </div>

                    {c.studentName && (
                      <p className="text-xs text-muted-foreground mb-1">
                        <span className="font-semibold text-foreground">{c.studentName}</span>
                      </p>
                    )}

                    {isEditing ? (
                      <div className="space-y-3">
                        <Textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          rows={3}
                          className="rounded-xl resize-none"
                          data-testid={`input-edit-content-${c.id}`}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => updateMutation.mutate(c.id)}
                            disabled={updateMutation.isPending}
                            className="rounded-lg bg-gradient-to-r from-red-600 to-rose-600 text-white"
                            data-testid={`button-save-edit-${c.id}`}>
                            {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                            Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="rounded-lg"
                            data-testid={`button-cancel-edit-${c.id}`}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap leading-relaxed" data-testid={`text-content-${c.id}`}>
                        {c.content}
                      </p>
                    )}

                    {c.fileUrl && !isEditing && (
                      <a href={c.fileUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-3 text-xs text-red-600 hover:text-red-700 font-medium"
                        data-testid={`link-evidence-${c.id}`}>
                        <FileDown className="w-3.5 h-3.5" /> View Evidence
                      </a>
                    )}

                    {/* Principal's Remarks for escalated teacher→student complaints */}
                    {c.escalatedToPrincipal && c.complaintType === "teacher-to-student" && (
                      <div className={`mt-3 px-3 py-2 rounded-lg border text-xs ${c.resolutionRemarks ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}
                        data-testid={`remarks-block-${c.id}`}>
                        <p className={`font-bold ${c.resolutionRemarks ? "text-green-800" : "text-amber-700"}`}>
                          Principal's Remarks
                        </p>
                        {c.resolutionRemarks ? (
                          <p className="font-semibold text-green-700 mt-0.5" data-testid={`text-principal-remarks-${c.id}`}>
                            {c.resolutionRemarks}
                          </p>
                        ) : (
                          <p className="text-amber-600 italic mt-0.5">— awaiting principal's response</p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3 pt-3 border-t">
                      <span className="text-xs text-muted-foreground">
                        Filed by {teacher.fullName}
                      </span>
                      {isOwner && isPending && !isEditing && (
                        <div className="flex items-center gap-1">
                          {isDeleting ? (
                            <>
                              <span className="text-xs text-destructive mr-1">Delete?</span>
                              <Button size="sm" variant="destructive" className="h-7 px-2 rounded-lg text-xs"
                                onClick={() => deleteMutation.mutate(c.id)} disabled={deleteMutation.isPending}
                                data-testid={`button-confirm-delete-${c.id}`}>
                                {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-2 rounded-lg text-xs"
                                onClick={() => setDeleteConfirmId(null)} data-testid={`button-cancel-delete-${c.id}`}>
                                No
                              </Button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingId(c.id); setEditContent(c.content); }}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                data-testid={`button-edit-${c.id}`}>
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => setDeleteConfirmId(c.id)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                data-testid={`button-delete-${c.id}`}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <ResolutionThread complaintId={c.id} teacherId={teacher.id} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
}
