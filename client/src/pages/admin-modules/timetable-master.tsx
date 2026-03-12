import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number; classes: string[]; sections: string[]; subjects: string[] }

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function TimetableMaster({ schoolId, classes, sections, subjects }: Props) {
  const { toast } = useToast();
  const [teacher, setTeacher] = useState("");
  const [day, setDay] = useState("");
  const [period, setPeriod] = useState("");
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [subject, setSubject] = useState("");
  const [filterDay, setFilterDay] = useState("");
  const [filterClass, setFilterClass] = useState("");

  const { data: teachers = [] } = useQuery<any[]>({
    queryKey: ["/api/schools", schoolId, "teachers"],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/teachers`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const { data: entries = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/timetable/school", schoolId],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/school/${schoolId}`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/timetable", { teacherId: teacher, schoolId, dayOfWeek: day, period, class: cls, section, subject });
    },
    onSuccess: () => {
      toast({ title: "Timetable Entry Added" });
      setDay(""); setPeriod(""); setCls(""); setSection(""); setSubject("");
      queryClient.invalidateQueries({ queryKey: ["/api/timetable/school", schoolId] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/timetable/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/timetable/school", schoolId] }); },
  });

  const filtered = entries.filter((e: any) =>
    (!filterDay || String(e.dayOfWeek) === filterDay) &&
    (!filterClass || e.class === filterClass)
  );

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-white">Timetable Master</h2>
        <p className="text-white/50 text-sm">{entries.length} timetable entries configured</p>
      </div>

      <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5">
        <h3 className="font-semibold text-white flex items-center gap-2 mb-3"><Clock className="w-4 h-4 text-[#D4AF37]" /> Add Timetable Entry</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-white/60 mb-1">Teacher</label>
            <Select value={teacher} onValueChange={setTeacher}>
              <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-teacher">
                <SelectValue placeholder="Select teacher" />
              </SelectTrigger>
              <SelectContent>{teachers.map((t: any) => <SelectItem key={t.id} value={String(t.id)}>{t.fullName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1">Day</label>
            <Select value={day} onValueChange={setDay}>
              <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-day">
                <SelectValue placeholder="Day" />
              </SelectTrigger>
              <SelectContent>{DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1">Period</label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-period">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>{[1,2,3,4,5,6,7,8].map(p => <SelectItem key={p} value={String(p)}>Period {p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1">Class</label>
            <Select value={cls} onValueChange={setCls}>
              <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-class">
                <SelectValue placeholder="Class" />
              </SelectTrigger>
              <SelectContent>{(classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1">Section</label>
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-section">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>{(sections.length > 0 ? sections : ["A","B","C","D"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1">Subject</label>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger className="bg-[#0A1628] border-white/20 text-white" data-testid="select-tt-subject">
                <SelectValue placeholder="Subject" />
              </SelectTrigger>
              <SelectContent>{(subjects.length > 0 ? subjects : ["Math","Science","English"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 md:col-span-3">
            <Button disabled={!teacher || !day || !period || !cls || !section || !subject || addMutation.isPending}
              onClick={() => addMutation.mutate()}
              className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid="button-add-timetable">
              {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> Add Entry</>}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={filterDay} onValueChange={v => setFilterDay(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-day">
            <SelectValue placeholder="All Days" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Days</SelectItem>
            {DAY_NAMES.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterClass} onValueChange={v => setFilterClass(v === "all" ? "" : v)}>
          <SelectTrigger className="w-32 bg-[#1A2942] border-white/20 text-white" data-testid="select-filter-tt-class">
            <SelectValue placeholder="All Classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Classes</SelectItem>
            {(classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#1A2942] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0F1E35]">
            <tr>{["Teacher","Day","Period","Class","Section","Subject",""].map(h => (
              <th key={h} className="text-left py-2.5 px-4 text-white/60 font-medium text-xs uppercase">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="py-12 text-center text-white/40"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-white/40">No timetable entries</td></tr>
            ) : filtered.map((e: any) => (
              <tr key={e.id} className="border-b border-white/5 hover:bg-white/5" data-testid={`row-tt-${e.id}`}>
                <td className="py-2.5 px-4 text-white/80">{e.teacherName}</td>
                <td className="py-2.5 px-4 text-white/60 text-xs">{DAY_NAMES[e.dayOfWeek]}</td>
                <td className="py-2.5 px-4 text-[#D4AF37] text-xs">P{e.period}</td>
                <td className="py-2.5 px-4 text-white/60 text-xs">{e.class}</td>
                <td className="py-2.5 px-4 text-white/60 text-xs">{e.section}</td>
                <td className="py-2.5 px-4 text-white/80 text-xs">{e.subject}</td>
                <td className="py-2.5 px-4">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:bg-red-500/10"
                    onClick={() => deleteMutation.mutate(e.id)} data-testid={`button-delete-tt-${e.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
