import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, BookOpen, Eye, Download, Loader2, Search, User, BookMarked } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

interface StudentMe {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  schoolName: string;
  schoolCode: string;
  schoolId: number;
}

interface LibraryBook {
  id: number;
  title: string;
  author: string;
  targetClass: string | null;
  category: string | null;
  fileUrl: string | null;
  fileType: string | null;
  uploaderName: string | null;
  verificationStatus: string;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Science:      { bg: "rgba(20,184,166,0.15)",  text: "#5eead4", border: "rgba(20,184,166,0.30)" },
  Mathematics:  { bg: "rgba(99,102,241,0.15)",  text: "#a5b4fc", border: "rgba(99,102,241,0.30)" },
  Literature:   { bg: "rgba(236,72,153,0.15)",  text: "#f9a8d4", border: "rgba(236,72,153,0.30)" },
  Fiction:      { bg: "rgba(245,158,11,0.15)",  text: "#fbbf24", border: "rgba(245,158,11,0.30)" },
  History:      { bg: "rgba(234,179,8,0.15)",   text: "#fde047", border: "rgba(234,179,8,0.30)" },
  Technology:   { bg: "rgba(59,130,246,0.15)",  text: "#93c5fd", border: "rgba(59,130,246,0.30)" },
};

function getCategoryStyle(cat: string | null) {
  if (!cat) return { bg: "rgba(255,255,255,0.08)", text: "rgba(255,255,255,0.55)", border: "rgba(255,255,255,0.12)" };
  return CATEGORY_COLORS[cat] ?? { bg: "rgba(255,255,255,0.08)", text: "rgba(255,255,255,0.55)", border: "rgba(255,255,255,0.12)" };
}

function getInitialColor(title: string) {
  const colors = [
    "linear-gradient(135deg,#0ea5e9,#06b6d4)",
    "linear-gradient(135deg,#8b5cf6,#6366f1)",
    "linear-gradient(135deg,#10b981,#059669)",
    "linear-gradient(135deg,#f59e0b,#f97316)",
    "linear-gradient(135deg,#ec4899,#db2777)",
    "linear-gradient(135deg,#14b8a6,#0d9488)",
  ];
  const idx = title.charCodeAt(0) % colors.length;
  return colors[idx];
}

export default function StudentLibrary() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const { data: books = [], isLoading: booksLoading } = useQuery<LibraryBook[]>({
    queryKey: ["/api/student/library"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!student,
  });

  const filtered = search.trim()
    ? books.filter(b => {
        const q = search.toLowerCase();
        return (
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q) ||
          (b.targetClass && b.targetClass.toLowerCase().includes(q)) ||
          (b.category && b.category.toLowerCase().includes(q))
        );
      })
    : books;

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0f172a" }}>
        <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: "linear-gradient(135deg,#0f172a 0%,#0c1a2e 100%)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 px-4 pt-4 pb-3"
        style={{ background: "rgba(15,23,42,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            data-testid="button-back"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
            style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#10b981,#059669)", boxShadow: "0 0 16px rgba(16,185,129,0.35)" }}>
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-white text-base leading-tight">E-Library</h1>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.40)" }}>{student.schoolName}</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.25)" }}>
            <BookMarked className="w-3 h-3" style={{ color: "#34d399" }} />
            <span className="text-xs font-semibold" style={{ color: "#34d399" }}>{books.length}</span>
          </div>
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.30)" }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by title, author, class, category…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", color: "white" }}
            data-testid="input-library-search"
          />
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {booksLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-3">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.18)" }}>
              <BookOpen className="w-7 h-7" style={{ color: "rgba(16,185,129,0.50)" }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.40)" }}>
              {search ? "No books match your search" : "No e-books available yet"}
            </p>
          </div>
        ) : (
          filtered.map(book => {
            const classes = book.targetClass
              ? book.targetClass.split(",").map(c => c.trim()).filter(Boolean)
              : [];
            const catStyle = getCategoryStyle(book.category);
            const initials = book.title.charAt(0).toUpperCase();
            const gradient = getInitialColor(book.title);

            return (
              <div
                key={book.id}
                data-testid={`card-book-${book.id}`}
                className="flex gap-3 p-4 rounded-2xl"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                {/* Avatar */}
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: gradient, color: "white", boxShadow: "0 2px 8px rgba(0,0,0,0.30)" }}>
                  {initials}
                  {book.fileType && (
                    <span className="absolute mt-8 ml-6 text-[8px] font-bold px-1 py-px rounded uppercase"
                      style={{ background: "rgba(0,0,0,0.70)", color: "rgba(255,255,255,0.80)" }}>
                      {book.fileType}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm leading-snug">{book.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.50)" }}>{book.author}</p>

                  <div className="flex flex-wrap gap-1 mt-2">
                    {classes.map(c => (
                      <span key={c}
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: "rgba(16,185,129,0.15)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.25)" }}>
                        Class {c}
                      </span>
                    ))}
                    {book.category && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: catStyle.bg, color: catStyle.text, border: `1px solid ${catStyle.border}` }}>
                        {book.category}
                      </span>
                    )}
                    {book.fileType && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
                        style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.10)" }}>
                        {book.fileType}
                      </span>
                    )}
                  </div>

                  {book.uploaderName && (
                    <p className="flex items-center gap-1 text-[10px] mt-1.5" style={{ color: "rgba(255,255,255,0.32)" }}>
                      <User className="w-2.5 h-2.5" /> {book.uploaderName}
                    </p>
                  )}
                </div>

                {/* Actions */}
                {book.fileUrl && (
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => window.open(book.fileUrl!, "_blank")}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                      style={{ background: "rgba(16,185,129,0.15)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.28)" }}
                      data-testid={`button-read-${book.id}`}
                    >
                      <Eye className="w-3 h-3" /> Read
                    </button>
                    <button
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = book.fileUrl!;
                        a.download = `${book.title}.${book.fileType ?? "pdf"}`;
                        document.body.appendChild(a); a.click(); document.body.removeChild(a);
                      }}
                      className="flex items-center justify-center px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                      style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.10)" }}
                      data-testid={`button-download-${book.id}`}
                    >
                      <Download className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
