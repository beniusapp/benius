import { useState, useRef } from "react";
import { fmtDate } from "@/lib/dateUtils";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Loader2, Search, BookOpen, RotateCcw, Upload, FileText,
  CheckCircle, Clock, XCircle, BookMarked, Download, Eye,
  GraduationCap, Tag, History, User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSchoolConfig } from "@/hooks/use-school-config";
import { useArchiveMode, type TeacherMe } from "@/pages/teacher-dashboard";

interface BookEntry {
  id: number;
  title: string;
  author: string;
  isbn: string | null;
  targetClass: string | null;
  category: string | null;
  fileUrl: string | null;
  fileType: string | null;
  verificationStatus: string;
  totalCopies: number;
  availableCopies: number;
  uploadedById?: number | null;
  uploaderName?: string | null;
  createdAt?: string;
}

interface BorrowEntry {
  id: number;
  bookTitle: string;
  bookAuthor: string;
  borrowedAt: string;
  bookFileUrl?: string | null;
  bookFileType?: string | null;
}

const CATEGORIES = ["Fiction", "Non-Fiction", "Science", "Mathematics", "History", "Geography", "Literature", "Technology", "Reference", "Other"];

const CATEGORY_COLORS: Record<string, string> = {
  Fiction: "#a78bfa", "Non-Fiction": "#60a5fa", Science: "#34d399",
  Mathematics: "#f59e0b", History: "#f87171", Geography: "#38bdf8",
  Literature: "#e879f9", Technology: "#06b6d4", Reference: "#94a3b8", Other: "#9ca3af",
};

function bookGradient(title: string): string {
  const gradients = [
    "linear-gradient(135deg,#1e3a5f,#0f4c75)", "linear-gradient(135deg,#1a1a2e,#16213e)",
    "linear-gradient(135deg,#0d2137,#1b4332)", "linear-gradient(135deg,#2d1b69,#11998e)",
    "linear-gradient(135deg,#1a0533,#4a0e8f)", "linear-gradient(135deg,#0f3443,#34e89e40)",
  ];
  const idx = title.charCodeAt(0) % gradients.length;
  return gradients[idx];
}

function initials(title: string) {
  return title.split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("") || "📖";
}

export default function LibraryModule({ teacher }: { teacher: TeacherMe }) {
  const isArchiveMode = useArchiveMode();
  const { toast } = useToast();
  const { classes } = useSchoolConfig(teacher.schoolId);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("catalog");

  const [ebookTitle, setEbookTitle] = useState("");
  const [ebookAuthor, setEbookAuthor] = useState("");
  const [ebookTargetClasses, setEbookTargetClasses] = useState<string[]>([]);
  const [ebookCategory, setEbookCategory] = useState("");
  const [ebookFile, setEbookFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: books = [], isLoading: loadingBooks } = useQuery<BookEntry[]>({
    queryKey: ["/api/library/books", teacher.schoolId, searchQuery],
    queryFn: async () => {
      const q = searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : "";
      const res = await fetch(`/api/library/books/${teacher.schoolId}${q}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const approvedBooks = books.filter(b => b.verificationStatus === "approved");

  const { data: myBooks = [], isLoading: loadingMyBooks } = useQuery<BorrowEntry[]>({
    queryKey: ["/api/library/my-books"],
    queryFn: async () => {
      const res = await fetch("/api/library/my-books", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: myEbooks = [], isLoading: loadingMyEbooks } = useQuery<BookEntry[]>({
    queryKey: ["/api/library/my-ebooks"],
    queryFn: async () => {
      const res = await fetch("/api/library/my-ebooks", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const borrowMutation = useMutation({
    mutationFn: async (bookId: number) => { await apiRequest("POST", "/api/library/borrow", { bookId }); },
    onSuccess: () => {
      toast({ title: "Book Borrowed" });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", teacher.schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/my-books"] });
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const returnMutation = useMutation({
    mutationFn: async (borrowId: number) => { await apiRequest("POST", `/api/library/return/${borrowId}`); },
    onSuccess: () => {
      toast({ title: "Book Returned" });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", teacher.schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/my-books"] });
    },
    onError: (error: Error) => { toast({ title: "Error", description: error.message, variant: "destructive" }); },
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/library/ebooks", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) { const err = await res.json().catch(() => ({ message: "Upload failed" })); throw new Error(err.message || "Upload failed"); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "E-Book Uploaded", description: "Your e-book has been submitted for verification." });
      setEbookTitle(""); setEbookAuthor(""); setEbookTargetClasses([]); setEbookCategory(""); setEbookFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", teacher.schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/my-ebooks"] });
    },
    onError: (error: Error) => { toast({ title: "Upload Failed", description: error.message, variant: "destructive" }); },
  });

  function handleEbookSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isArchiveMode) return;
    if (!ebookTitle.trim() || !ebookAuthor.trim()) {
      toast({ title: "Validation Error", description: "Title and Author are required.", variant: "destructive" }); return;
    }
    if (!ebookFile) {
      toast({ title: "Validation Error", description: "Please select a PDF or EPUB file.", variant: "destructive" }); return;
    }
    const formData = new FormData();
    formData.append("title", ebookTitle.trim());
    formData.append("author", ebookAuthor.trim());
    if (ebookTargetClasses.length > 0) formData.append("targetClass", ebookTargetClasses.join(","));
    if (ebookCategory) formData.append("category", ebookCategory);
    formData.append("file", ebookFile);
    uploadMutation.mutate(formData);
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* ── Tab bar ── */}
        <TabsList
          className="grid w-full grid-cols-3"
          style={{ background: "rgba(15,23,42,0.60)", border: "1px solid rgba(20,184,166,0.18)", borderRadius: "14px" }}
          data-testid="tabs-library"
        >
          {[
            { value: "catalog",  label: "Catalog",      icon: <BookOpen className="w-3.5 h-3.5" /> },
            { value: "upload",   label: "Upload E-Book", icon: <Upload className="w-3.5 h-3.5" /> },
            { value: "mybooks",  label: "My Books",      icon: <BookMarked className="w-3.5 h-3.5" /> },
          ].map(t => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="flex items-center gap-1.5 text-xs font-semibold rounded-[10px]
                data-[state=active]:bg-teal-500 data-[state=active]:text-white data-[state=inactive]:text-slate-400"
              data-testid={`tab-${t.value}`}
            >
              {t.icon}{t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ══════════════════════════════════════════
            CATALOG TAB
        ══════════════════════════════════════════ */}
        <TabsContent value="catalog" className="space-y-4">
          {/* Header */}
          <div
            className="rounded-2xl p-4"
            style={{ background: "linear-gradient(135deg,rgba(15,23,42,0.95),rgba(13,42,37,0.90))", border: "1px solid rgba(20,184,166,0.22)" }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(20,184,166,0.15)", border: "1px solid rgba(20,184,166,0.30)" }}>
                <BookOpen className="w-5 h-5" style={{ color: "#14b8a6" }} />
              </div>
              <div>
                <h2 className="font-bold text-white text-base leading-tight" data-testid="text-library-title">Library Catalog</h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                  {approvedBooks.length} approved {approvedBooks.length === 1 ? "book" : "books"} in your school
                </p>
              </div>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(255,255,255,0.35)" }} />
              <input
                placeholder="Search by title, author, or class…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none"
                style={{
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
                  color: "white", caretColor: "#14b8a6",
                }}
                data-testid="input-search-books"
              />
            </div>
          </div>

          {/* Book cards */}
          {loadingBooks ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#14b8a6" }} /></div>
          ) : approvedBooks.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(20,184,166,0.08)", border: "1px solid rgba(20,184,166,0.15)" }}>
                <BookOpen className="w-7 h-7" style={{ color: "rgba(20,184,166,0.50)" }} />
              </div>
              <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.40)" }} data-testid="text-no-books">
                {searchQuery ? "No books match your search." : "No approved books yet."}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {approvedBooks.map(book => {
                const catColor = CATEGORY_COLORS[book.category ?? ""] ?? "#9ca3af";
                return (
                  <div
                    key={book.id}
                    className="rounded-2xl overflow-hidden transition-all hover:scale-[1.01]"
                    style={{ background: "rgba(15,23,42,0.90)", border: "1px solid rgba(20,184,166,0.14)", boxShadow: "0 2px 12px rgba(0,0,0,0.30)" }}
                    data-testid={`card-book-${book.id}`}
                  >
                    <div className="flex">
                      {/* Cover art */}
                      <div
                        className="w-20 flex-shrink-0 flex flex-col items-center justify-center relative"
                        style={{ background: bookGradient(book.title), minHeight: "108px" }}
                      >
                        <span className="text-2xl font-black text-white/80 select-none leading-none">{initials(book.title)}</span>
                        {book.fileUrl && (
                          <div className="absolute bottom-1.5 left-0 right-0 flex justify-center">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                              style={{ background: "rgba(0,0,0,0.55)", color: "#5eead4" }}>
                              {(book.fileType || "pdf").toUpperCase()}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0 p-3 flex flex-col justify-between">
                        <div>
                          <p className="font-bold text-sm text-white leading-snug truncate" data-testid={`text-book-title-${book.id}`}>
                            {book.title}
                          </p>
                          <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.50)" }}>{book.author}</p>

                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {book.targetClass && book.targetClass.split(",").map(cls => cls.trim()).filter(Boolean).map(cls => (
                              <span key={cls} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                style={{ background: "rgba(20,184,166,0.12)", color: "#5eead4", border: "1px solid rgba(20,184,166,0.22)" }}
                                data-testid={`badge-class-${book.id}-${cls}`}>
                                <GraduationCap className="w-2.5 h-2.5" />Class {cls}
                              </span>
                            ))}
                            {book.category && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                style={{ background: `${catColor}18`, color: catColor, border: `1px solid ${catColor}35` }}
                                data-testid={`badge-category-${book.id}`}>
                                <Tag className="w-2.5 h-2.5" />{book.category}
                              </span>
                            )}
                            {book.totalCopies > 0 && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${book.availableCopies > 0 ? "" : ""}`}
                                style={{
                                  background: book.availableCopies > 0 ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
                                  color: book.availableCopies > 0 ? "#34d399" : "#f87171",
                                  border: `1px solid ${book.availableCopies > 0 ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
                                }}
                                data-testid={`badge-copies-${book.id}`}>
                                {book.availableCopies}/{book.totalCopies} copies
                              </span>
                            )}
                          </div>
                          {book.isbn && (
                            <p className="text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.30)" }}>ISBN: {book.isbn}</p>
                          )}
                          {book.uploaderName && (
                            <p className="flex items-center gap-1 text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.38)" }}>
                              <User className="w-2.5 h-2.5" />Uploaded by {book.uploaderName}
                            </p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-1.5 mt-2">
                          {book.fileUrl && (
                            <button
                              onClick={() => window.open(book.fileUrl!, "_blank")}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                              style={{ background: "rgba(20,184,166,0.15)", color: "#5eead4", border: "1px solid rgba(20,184,166,0.28)" }}
                              data-testid={`button-read-${book.id}`}
                            >
                              <Eye className="w-3 h-3" /> Read
                            </button>
                          )}
                          {book.fileUrl && (
                            <button
                              onClick={() => window.open(book.fileUrl!, "_blank")}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                              style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.60)", border: "1px solid rgba(255,255,255,0.10)" }}
                              data-testid={`button-download-${book.id}`}
                            >
                              <Download className="w-3 h-3" />
                            </button>
                          )}
                          {book.totalCopies > 0 && book.availableCopies > 0 && (
                            <button
                              onClick={() => borrowMutation.mutate(book.id)}
                              disabled={isArchiveMode || borrowMutation.isPending}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                              style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.28)" }}
                              data-testid={`button-borrow-${book.id}`}
                            >
                              <BookMarked className="w-3 h-3" /> Borrow
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════
            UPLOAD E-BOOK TAB
        ══════════════════════════════════════════ */}
        <TabsContent value="upload" className="space-y-4">
          <div
            className="rounded-2xl p-5"
            style={{ background: "rgba(15,23,42,0.90)", border: "1px solid rgba(20,184,166,0.18)" }}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(20,184,166,0.12)", border: "1px solid rgba(20,184,166,0.25)" }}>
                <Upload className="w-5 h-5" style={{ color: "#14b8a6" }} />
              </div>
              <div>
                <h2 className="font-bold text-white text-base" data-testid="text-upload-title">Upload E-Book</h2>
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.40)" }}>Submit for principal approval</p>
              </div>
            </div>

            {isArchiveMode && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2.5 rounded-xl text-xs font-semibold"
                style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)", color: "#fbbf24" }}
                data-testid="banner-archive-mode">
                ⚠️ Form Locked: You cannot upload new resources to an archived academic session.
              </div>
            )}

            <form onSubmit={handleEbookSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>Title *</label>
                  <input
                    id="ebook-title"
                    placeholder="Enter book title"
                    value={ebookTitle}
                    onChange={e => setEbookTitle(e.target.value)}
                    disabled={isArchiveMode}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "white" }}
                    data-testid="input-ebook-title"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>Author *</label>
                  <input
                    id="ebook-author"
                    placeholder="Enter author name"
                    value={ebookAuthor}
                    onChange={e => setEbookAuthor(e.target.value)}
                    disabled={isArchiveMode}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "white" }}
                    data-testid="input-ebook-author"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>
                    Target Classes
                    {ebookTargetClasses.length > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px]"
                        style={{ background: "rgba(20,184,166,0.20)", color: "#5eead4" }}>
                        {ebookTargetClasses.length} selected
                      </span>
                    )}
                  </label>
                  <div
                    className="flex flex-wrap gap-2 p-3 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
                    data-testid="multiselect-ebook-class"
                  >
                    {classes.map(cls => {
                      const checked = ebookTargetClasses.includes(cls);
                      return (
                        <button
                          key={cls}
                          type="button"
                          disabled={isArchiveMode}
                          onClick={() => {
                            if (isArchiveMode) return;
                            setEbookTargetClasses(prev =>
                              checked ? prev.filter(c => c !== cls) : [...prev, cls]
                            );
                          }}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all disabled:opacity-50"
                          style={{
                            background: checked ? "rgba(20,184,166,0.22)" : "rgba(255,255,255,0.06)",
                            color: checked ? "#5eead4" : "rgba(255,255,255,0.50)",
                            border: checked ? "1px solid rgba(20,184,166,0.45)" : "1px solid rgba(255,255,255,0.10)",
                            boxShadow: checked ? "0 0 8px rgba(20,184,166,0.20)" : "none",
                          }}
                          data-testid={`class-pill-${cls}`}
                        >
                          {checked && <span className="mr-1">✓</span>}Class {cls}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>Category</label>
                  <Select value={ebookCategory} onValueChange={setEbookCategory} disabled={isArchiveMode}>
                    <SelectTrigger
                      className="rounded-xl"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "white" }}
                      data-testid="select-ebook-category"
                    >
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>File (PDF/EPUB) *</label>
                <label
                  className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all hover:brightness-110"
                  style={{ background: "rgba(255,255,255,0.04)", border: "2px dashed rgba(20,184,166,0.28)" }}
                >
                  <FileText className="w-5 h-5 flex-shrink-0" style={{ color: "#14b8a6" }} />
                  <span className="text-sm" style={{ color: ebookFile ? "white" : "rgba(255,255,255,0.40)" }}>
                    {ebookFile ? `${ebookFile.name} (${(ebookFile.size / 1024 / 1024).toFixed(2)} MB)` : "Choose PDF or EPUB file…"}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.epub"
                    className="hidden"
                    onChange={e => setEbookFile(e.target.files?.[0] || null)}
                    disabled={isArchiveMode}
                    data-testid="input-ebook-file"
                  />
                </label>
              </div>

              <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: "rgba(20,184,166,0.06)", border: "1px solid rgba(20,184,166,0.14)", color: "rgba(255,255,255,0.45)" }}>
                <Clock className="w-3 h-3 inline-block mr-1.5" style={{ color: "#14b8a6" }} />
                Uploaded e-books are submitted as <span style={{ color: "#14b8a6" }}>Pending Verification</span> and need principal approval before appearing in the catalog.
              </div>

              <button
                type="submit"
                disabled={isArchiveMode || uploadMutation.isPending}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#0f766e,#0d9488)", color: "white" }}
                data-testid="button-upload-ebook"
              >
                {uploadMutation.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                  : <><Upload className="w-4 h-4" /> Upload E-Book</>
                }
              </button>
            </form>
          </div>

          {/* ── Upload History ── */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(15,23,42,0.90)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex items-center gap-2.5 px-4 py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
              <History className="w-4 h-4" style={{ color: "#14b8a6" }} />
              <span className="font-bold text-sm text-white">My Upload History</span>
              {myEbooks.length > 0 && (
                <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background: "rgba(20,184,166,0.15)", color: "#5eead4", border: "1px solid rgba(20,184,166,0.22)" }}>
                  {myEbooks.length}
                </span>
              )}
            </div>

            {loadingMyEbooks ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "#14b8a6" }} /></div>
            ) : myEbooks.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2">
                <Upload className="w-7 h-7" style={{ color: "rgba(20,184,166,0.30)" }} />
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>No e-books uploaded yet.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                {myEbooks.map(book => {
                  const catColor = CATEGORY_COLORS[book.category ?? ""] ?? "#9ca3af";
                  const statusConfig = {
                    approved: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: "Approved", bg: "rgba(52,211,153,0.12)", color: "#34d399", border: "rgba(52,211,153,0.25)" },
                    rejected: { icon: <XCircle className="w-3.5 h-3.5" />,      label: "Rejected", bg: "rgba(248,113,113,0.12)", color: "#f87171", border: "rgba(248,113,113,0.25)" },
                    pending:  { icon: <Clock className="w-3.5 h-3.5" />,        label: "Pending",  bg: "rgba(251,191,36,0.10)", color: "#fbbf24", border: "rgba(251,191,36,0.22)" },
                  }[book.verificationStatus] ?? { icon: <Clock className="w-3.5 h-3.5" />, label: book.verificationStatus, bg: "rgba(255,255,255,0.05)", color: "#9ca3af", border: "rgba(255,255,255,0.10)" };

                  return (
                    <div key={book.id} className="flex items-start gap-3 px-4 py-3" data-testid={`history-item-${book.id}`}>
                      {/* Mini cover */}
                      <div className="w-9 h-11 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-black text-white/70"
                        style={{ background: bookGradient(book.title) }}>
                        {initials(book.title)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate" data-testid={`history-title-${book.id}`}>{book.title}</p>
                        <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.45)" }}>{book.author}</p>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {book.targetClass && book.targetClass.split(",").map(c => c.trim()).filter(Boolean).map(c => (
                            <span key={c} className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                              style={{ background: "rgba(20,184,166,0.10)", color: "#5eead4" }}>
                              Class {c}
                            </span>
                          ))}
                          {book.category && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                              style={{ background: `${catColor}15`, color: catColor }}>
                              {book.category}
                            </span>
                          )}
                          {book.fileType && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                              style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.50)" }}>
                              {book.fileType.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold"
                          style={{ background: statusConfig.bg, color: statusConfig.color, border: `1px solid ${statusConfig.border}` }}
                          data-testid={`history-status-${book.id}`}>
                          {statusConfig.icon}{statusConfig.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════
            MY BOOKS TAB
        ══════════════════════════════════════════ */}
        <TabsContent value="mybooks" className="space-y-4">
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "rgba(15,23,42,0.90)", border: "1px solid rgba(20,184,166,0.18)" }}
          >
            <div className="flex items-center gap-2.5 px-4 py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
              <BookMarked className="w-4 h-4" style={{ color: "#14b8a6" }} />
              <span className="font-bold text-sm text-white" data-testid="text-mybooks-title">My Borrowed Books</span>
              {myBooks.length > 0 && (
                <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={{ background: "rgba(20,184,166,0.15)", color: "#5eead4", border: "1px solid rgba(20,184,166,0.22)" }}>
                  {myBooks.length}
                </span>
              )}
            </div>
            {loadingMyBooks ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "#14b8a6" }} /></div>
            ) : myBooks.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2">
                <BookOpen className="w-7 h-7" style={{ color: "rgba(20,184,166,0.30)" }} />
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }} data-testid="text-no-borrowed">No books borrowed.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                {myBooks.map(b => (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-3" data-testid={`card-borrowed-${b.id}`}>
                    <div className="w-9 h-11 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-black text-white/70"
                      style={{ background: bookGradient(b.bookTitle) }}>
                      {initials(b.bookTitle)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-white truncate" data-testid={`text-borrowed-title-${b.id}`}>{b.bookTitle}</p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                        {b.bookAuthor} · Borrowed {fmtDate(b.borrowedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {b.bookFileUrl && (
                        <button
                          onClick={() => window.open(b.bookFileUrl!, "_blank")}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                          style={{ background: "rgba(20,184,166,0.12)", color: "#5eead4", border: "1px solid rgba(20,184,166,0.22)" }}
                          data-testid={`button-read-borrowed-${b.id}`}
                        >
                          <Eye className="w-3 h-3" /> Read
                        </button>
                      )}
                      <button
                        onClick={() => returnMutation.mutate(b.id)}
                        disabled={isArchiveMode || returnMutation.isPending}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-50"
                        style={{ background: "rgba(248,113,113,0.10)", color: "#f87171", border: "1px solid rgba(248,113,113,0.22)" }}
                        data-testid={`button-return-${b.id}`}
                      >
                        {returnMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                        Return
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
