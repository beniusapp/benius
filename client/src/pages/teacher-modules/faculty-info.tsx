import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, User, Phone, BookOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface FacultyMember {
  id: number;
  fullName: string;
  subject: string;
  phone: string;
  assignedClass: string;
  assignedSection: string;
  mappings: { className: string; section: string; subject: string | null }[];
}

export default function FacultyInfoModule({ teacher }: { teacher: TeacherMe }) {
  const [search, setSearch] = useState("");

  const { data: faculty = [], isLoading } = useQuery<FacultyMember[]>({
    queryKey: ["/api/faculty", teacher.schoolId],
    queryFn: async () => {
      const res = await fetch(`/api/faculty/${teacher.schoolId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!search) return faculty;
    const q = search.toLowerCase();
    return faculty.filter(f =>
      f.fullName.toLowerCase().includes(q) ||
      f.subject.toLowerCase().includes(q) ||
      f.mappings.some(m => (m.subject ?? "").toLowerCase().includes(q))
    );
  }, [faculty, search]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-faculty-title">Faculty Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or subject..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search-faculty"
            />
          </div>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-faculty">No faculty members found.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((f) => {
                const hasMappings = (f.mappings ?? []).length > 0;
                return (
                  <div key={f.id} className="p-4 rounded-md border flex items-start gap-3" data-testid={`card-faculty-${f.id}`}>
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 flex-shrink-0">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">{f.fullName}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <BookOpen className="w-3 h-3 flex-shrink-0" /> {f.subject}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3 flex-shrink-0" /> {f.phone}
                      </p>
                      {hasMappings ? (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(f.mappings ?? []).map((m, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20"
                              data-testid={`badge-class-${f.id}-${idx}`}
                            >
                              {m.className}{m.section}{m.subject ? ` · ${m.subject}` : ""}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Class {f.assignedClass}-{f.assignedSection}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
