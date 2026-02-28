import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Search, BookOpen, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface BookEntry { id: number; title: string; author: string; isbn: string | null; totalCopies: number; availableCopies: number; }
interface BorrowEntry { id: number; bookTitle: string; bookAuthor: string; borrowedAt: string; }

export default function LibraryModule({ teacher }: { teacher: TeacherMe }) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-library-title">Library</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search books by title or author..."
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
            <div className="space-y-2">
              {books.map((book) => (
                <div key={book.id} className="p-3 rounded-md border flex items-center justify-between gap-3" data-testid={`card-book-${book.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{book.title}</p>
                    <p className="text-xs text-muted-foreground">{book.author}{book.isbn ? ` | ISBN: ${book.isbn}` : ""}</p>
                    <p className="text-xs text-muted-foreground">Available: {book.availableCopies}/{book.totalCopies}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={book.availableCopies <= 0 || borrowMutation.isPending}
                    onClick={() => borrowMutation.mutate(book.id)}
                    data-testid={`button-borrow-${book.id}`}
                  >
                    <BookOpen className="w-3.5 h-3.5 mr-1" /> Borrow
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">My Borrowed Books</CardTitle>
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
                  <div>
                    <p className="font-medium text-sm">{b.bookTitle}</p>
                    <p className="text-xs text-muted-foreground">{b.bookAuthor} | Borrowed: {new Date(b.borrowedAt).toLocaleDateString()}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => returnMutation.mutate(b.id)} disabled={returnMutation.isPending} data-testid={`button-return-${b.id}`}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" /> Return
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
