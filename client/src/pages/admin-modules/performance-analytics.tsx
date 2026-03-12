import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props { schoolId: number; classes: string[]; subjects: string[]; examTypes: string[] }

export default function PerformanceAnalytics({ schoolId, classes, subjects, examTypes }: Props) {
  const [filterClass, setFilterClass] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterExam, setFilterExam] = useState("");

  const params = new URLSearchParams();
  if (filterClass) params.set("class", filterClass);
  if (filterSubject) params.set("subject", filterSubject);
  if (filterExam) params.set("examType", filterExam);

  const { data: scores = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/exam-scores/school", schoolId, filterClass, filterSubject, filterExam],
    queryFn: async () => {
      if (!filterClass || !filterSubject || !filterExam) return [];
      const r = await fetch(`/api/exam-scores/${schoolId}/${filterSubject}/${filterExam}/${filterClass}/A`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!schoolId && !!filterClass && !!filterSubject && !!filterExam,
  });

  const avg = scores.length > 0 ? Math.round(scores.reduce((s: number, r: any) => s + (Number(r.score) || 0), 0) / scores.length) : 0;
  const highest = scores.length > 0 ? Math.max(...scores.map((r: any) => Number(r.score) || 0)) : 0;
  const lowest = scores.length > 0 ? Math.min(...scores.map((r: any) => Number(r.score) || 0)) : 0;
  const passing = scores.filter((r: any) => Number(r.score) >= 35).length;

  const buckets = [
    { range: "0-34", label: "Fail", count: 0 },
    { range: "35-49", label: "Pass", count: 0 },
    { range: "50-59", label: "Average", count: 0 },
    { range: "60-74", label: "Good", count: 0 },
    { range: "75-89", label: "Very Good", count: 0 },
    { range: "90-100", label: "Excellent", count: 0 },
  ];
  scores.forEach((r: any) => {
    const s = Number(r.score) || 0;
    if (s < 35) buckets[0].count++;
    else if (s < 50) buckets[1].count++;
    else if (s < 60) buckets[2].count++;
    else if (s < 75) buckets[3].count++;
    else if (s < 90) buckets[4].count++;
    else buckets[5].count++;
  });

  const COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#D4AF37"];

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-white">Performance Analytics</h2>
        <p className="text-white/50 text-sm">Exam score distribution and class-level analytics</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={filterClass} onValueChange={setFilterClass}>
          <SelectTrigger className="w-32 bg-[#1A2942] border-white/20 text-white" data-testid="select-analytics-class">
            <SelectValue placeholder="Class" />
          </SelectTrigger>
          <SelectContent>{(classes.length > 0 ? classes : ["1","2","3","4","5","6","7","8","9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterSubject} onValueChange={setFilterSubject}>
          <SelectTrigger className="w-36 bg-[#1A2942] border-white/20 text-white" data-testid="select-analytics-subject">
            <SelectValue placeholder="Subject" />
          </SelectTrigger>
          <SelectContent>{(subjects.length > 0 ? subjects : ["Math","Science","English"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterExam} onValueChange={setFilterExam}>
          <SelectTrigger className="w-36 bg-[#1A2942] border-white/20 text-white" data-testid="select-analytics-exam">
            <SelectValue placeholder="Exam Type" />
          </SelectTrigger>
          <SelectContent>{(examTypes.length > 0 ? examTypes : ["UT1","UT2","Mid-term","Annual"]).map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {!filterClass || !filterSubject || !filterExam ? (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 text-white/20" />
          <p className="text-white/40">Select Class, Subject, and Exam Type to view analytics</p>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
      ) : scores.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
          <p className="text-white/40">No exam scores found for this filter combination</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Class Average", value: `${avg}%`, color: "text-[#D4AF37]" },
              { label: "Highest Score", value: `${highest}%`, color: "text-green-400" },
              { label: "Lowest Score", value: `${lowest}%`, color: "text-red-400" },
              { label: "Pass Rate", value: `${scores.length > 0 ? Math.round((passing / scores.length) * 100) : 0}%`, color: "text-blue-400" },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-white/10 bg-[#1A2942] p-4">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-white/50 text-sm mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5">
            <h3 className="font-semibold text-white mb-4">Score Distribution</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={buckets} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#0F1E35", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} labelStyle={{ color: "white" }} itemStyle={{ color: "#D4AF37" }} />
                <Bar dataKey="count" radius={[4,4,0,0]}>
                  {buckets.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
