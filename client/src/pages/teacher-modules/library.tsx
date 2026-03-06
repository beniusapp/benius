import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Search, BookOpen, RotateCcw, Upload, FileText, CheckCircle, Clock, XCircle } from "lucide-react";
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
import type { TeacherMe } from "@/pages/teacher-dashboard";

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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function VerificationBadge({ status }: { status: string }) {
  if (status === "approved") {
    return <Badge variant="secondary" data-testid="badge-verified"><CheckCircle className="w-3 h-3 mr-1" /> Verified</Badge>;
  }
  if (status === "rejected") {
    return <Badge variant="destructive" data-testid="badge-rejected"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
  }
  return <Badge variant="outline" data-testid="badge-pending"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
}

function AvailabilityBadge({ available, total }: { available: number; total: number }) {
  if (total === 0) {
    return <Badge variant="outline" data-testid="badge-digital"><FileText className="w-3 h-3 mr-1" /> Digital</Badge>;
  }
  if (available > 0) {
    return <Badge variant="secondary" data-testid="badge-available">{available}/{total} Available</Badge>;
  }
  return <Badge variant="destructive" data-testid="badge-unavailable">Unavailable</Badge>;
}

export default function LibraryModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const { classes } = useSchoolConfig(teacher.schoolId);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("catalog");

  const [ebookTitle, setEbookTitle] = useState("");
  const [ebookAuthor, setEbookAuthor] = useState("");
  const [ebookTargetClass, setEbookTargetClass] = useState("");
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

  const { data: myBooks = [], isLoading: loadingMyBooks } = useQuery<BorrowEntry[]>({
    queryKey: ["/api/library/my-books"],
    queryFn: async () => {
      const res = await fetch("/api/library/my-books", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const borrowMutation = useMutation({
    mutationFn: async (bookId: number) => {
      await apiRequest("POST", "/api/library/borrow", { bookId });
    },
    onSuccess: () => {
      toast({ title: "Book Borrowed" });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", teacher.schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/my-books"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const returnMutation = useMutation({
    mutationFn: async (borrowId: number) => {
      await apiRequest("POST", `/api/library/return/${borrowId}`);
    },
    onSuccess: () => {
      toast({ title: "Book Returned" });
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", teacher.schoolId] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/my-books"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch("/api/library/ebooks", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "E-Book Uploaded", description: "Your e-book has been submitted for verification." });
      setEbookTitle("");
      setEbookAuthor("");
      setEbookTargetClass("");
      setEbookCategory("");
      setEbookFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/library/books", teacher.schoolId] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    },
  });

  function handleEbookSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ebookTitle.trim() || !ebookAuthor.trim()) {
      toast({ title: "Validation Error", description: "Title and Author are required.", variant: "destructive" });
      return;
    }
    if (!ebookFile) {
      toast({ title: "Validation Error", description: "Please select a PDF or EPUB file.", variant: "destructive" });
      return;
    }
    const formData = new FormData();
    formData.append("title", ebookTitle.trim());
    formData.append("author", ebookAuthor.trim());
    if (ebookTargetClass) formData.append("targetClass", ebookTargetClass);
    if (ebookCategory) formData.append("category", ebookCategory);
    formData.append("file", ebookFile);
    uploadMutation.mutate(formData);
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3" data-testid="tabs-library">
          <TabsTrigger value="catalog" data-testid="tab-catalog">Catalog</TabsTrigger>
          <TabsTrigger value="upload" data-testid="tab-upload">Upload E-Book</TabsTrigger>
          <TabsTrigger value="mybooks" data-testid="tab-mybooks">My Books</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-lg" data-testid="text-library-title">
                <BookOpen className="w-5 h-5 inline-block mr-2" />
                Library Catalog
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by title, author, or class..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-books"
                />
              </div>
              {loadingBooks ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : books.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-books">No books found.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {books.map((book) => (
                    <Card key={book.id} className="hover-elevate" data-testid={`card-book-${book.id}`}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate" data-testid={`text-book-title-${book.id}`}>{book.title}</p>
                            <p className="text-xs text-muted-foreground">{book.author}</p>
                          </div>
                          <VerificationBadge status={book.verificationStatus} />
                        </div>
                        <div className="flex items-center flex-wrap gap-1">
                          <AvailabilityBadge available={book.availableCopies} total={book.totalCopies} />
                          {book.targetClass && (
                            <Badge variant="outline" data-testid={`badge-class-${book.id}`}>Class {book.targetClass}</Badge>
                          )}
                          {book.category && (
                            <Badge variant="outline" data-testid={`badge-category-${book.id}`}>{book.category}</Badge>
                          )}
                          {book.fileUrl && (
                            <Badge variant="outline" data-testid={`badge-filetype-${book.id}`}>
                              <FileText className="w-3 h-3 mr-1" />
                              {(book.fileType || "pdf").toUpperCase()}
                            </Badge>
                          )}
                        </div>
                        {book.isbn && (
                          <p className="text-xs text-muted-foreground">ISBN: {book.isbn}</p>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          {book.totalCopies > 0 && book.verificationStatus === "approved" && (
                            <Button
                              size="sm"
                              disabled={book.availableCopies <= 0 || borrowMutation.isPending}
                              onClick={() => borrowMutation.mutate(book.id)}
                              data-testid={`button-borrow-${book.id}`}
                            >
                              {borrowMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <BookOpen className="w-3.5 h-3.5 mr-1" />}
                              Borrow
                            </Button>
                          )}
                          {book.fileUrl && book.verificationStatus === "approved" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(book.fileUrl!, "_blank")}
                              data-testid={`button-read-${book.id}`}
                            >
                              <FileText className="w-3.5 h-3.5 mr-1" /> Read
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="upload" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg" data-testid="text-upload-title">
                <Upload className="w-5 h-5 inline-block mr-2" />
                Upload E-Book
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEbookSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ebook-title">Title *</Label>
                  <Input
                    id="ebook-title"
                    placeholder="Enter book title"
                    value={ebookTitle}
                    onChange={(e) => setEbookTitle(e.target.value)}
                    data-testid="input-ebook-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ebook-author">Author *</Label>
                  <Input
                    id="ebook-author"
                    placeholder="Enter author name"
                    value={ebookAuthor}
                    onChange={(e) => setEbookAuthor(e.target.value)}
                    data-testid="input-ebook-author"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Target Class</Label>
                    <Select value={ebookTargetClass} onValueChange={setEbookTargetClass}>
                      <SelectTrigger data-testid="select-ebook-class">
                        <SelectValue placeholder="Select class" />
                      </SelectTrigger>
                      <SelectContent>
                        {classes.map((cls) => (
                          <SelectItem key={cls} value={cls}>{cls}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={ebookCategory} onValueChange={setEbookCategory}>
                      <SelectTrigger data-testid="select-ebook-category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ebook-file">File (PDF/EPUB) *</Label>
                  <Input
                    id="ebook-file"
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.epub"
                    onChange={(e) => setEbookFile(e.target.files?.[0] || null)}
                    data-testid="input-ebook-file"
                  />
                  {ebookFile && (
                    <p className="text-xs text-muted-foreground" data-testid="text-selected-file">
                      Selected: {ebookFile.name} ({(ebookFile.size / 1024 / 1024).toFixed(2)} MB)
                    </p>
                  )}
                </div>
                <div className="rounded-md border p-3 bg-muted/50">
                  <p className="text-xs text-muted-foreground">
                    <Clock className="w-3 h-3 inline-block mr-1" />
                    Uploaded e-books will be submitted as "Pending Verification" and will need admin approval before appearing in the catalog.
                  </p>
                </div>
                <Button
                  type="submit"
                  disabled={uploadMutation.isPending}
                  data-testid="button-upload-ebook"
                >
                  {uploadMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  {uploadMutation.isPending ? "Uploading..." : "Upload E-Book"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mybooks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg" data-testid="text-mybooks-title">
                <BookOpen className="w-5 h-5 inline-block mr-2" />
                My Borrowed Books
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingMyBooks ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : myBooks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-borrowed">No books borrowed.</p>
              ) : (
                <div className="space-y-2">
                  {myBooks.map((b) => (
                    <div key={b.id} className="p-3 rounded-md border flex items-center justify-between gap-3" data-testid={`card-borrowed-${b.id}`}>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm" data-testid={`text-borrowed-title-${b.id}`}>{b.bookTitle}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.bookAuthor} | Borrowed: {formatDate(b.borrowedAt)}
                        </p>
                        {b.bookFileUrl && (
                          <Badge variant="outline" className="mt-1">
                            <FileText className="w-3 h-3 mr-1" />
                            {(b.bookFileType || "pdf").toUpperCase()}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {b.bookFileUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(b.bookFileUrl!, "_blank")}
                            data-testid={`button-read-borrowed-${b.id}`}
                          >
                            <FileText className="w-3.5 h-3.5 mr-1" /> Read
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => returnMutation.mutate(b.id)}
                          disabled={returnMutation.isPending}
                          data-testid={`button-return-${b.id}`}
                        >
                          {returnMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
                          Return
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
