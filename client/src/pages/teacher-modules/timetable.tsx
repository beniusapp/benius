import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeacherMe } from "@/pages/teacher-dashboard";

interface TimetableEntry { id: number; dayOfWeek: number; period: number; class: string; section: string; subject: string; }

const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const periods = [1, 2, 3, 4, 5, 6, 7, 8];

export default function TimetableModule({ teacher }: { teacher: TeacherMe }) {
  const { data: entries = [], isLoading, isError } = useQuery<TimetableEntry[]>({
    queryKey: ["/api/timetable/teacher", teacher.id],
    queryFn: async () => {
      const res = await fetch(`/api/timetable/teacher/${teacher.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  function getEntry(day: number, period: number) {
    return entries.find(e => e.dayOfWeek === day && e.period === period);
  }

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (isError) return <Card><CardContent className="py-8 text-center text-destructive" data-testid="text-timetable-error">Failed to load timetable. Please try again later.</CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg" data-testid="text-timetable-title">Weekly Timetable</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-timetable">No timetable entries yet. Your admin will set up your schedule.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border p-2 bg-muted text-xs font-medium text-muted-foreground">Period</th>
                  {dayNames.map((d, i) => (
                    <th key={i} className="border p-2 bg-muted text-xs font-medium text-muted-foreground">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p}>
                    <td className="border p-2 text-center text-sm font-medium bg-muted/50">{p}</td>
                    {dayNames.map((_, dayIdx) => {
                      const entry = getEntry(dayIdx, p);
                      return (
                        <td key={dayIdx} className="border p-2 text-center" data-testid={`cell-${dayIdx}-${p}`}>
                          {entry ? (
                            <div>
                              <p className="text-sm font-medium">{entry.subject}</p>
                              <p className="text-xs text-muted-foreground">{entry.class}-{entry.section}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
