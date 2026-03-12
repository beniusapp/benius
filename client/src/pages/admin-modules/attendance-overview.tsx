import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, TrendingUp, UserX, Loader2 } from "lucide-react";

interface Props { schoolId: number }

export default function AttendanceOverview({ schoolId }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);

  const { data: summary, isLoading } = useQuery<{ total: number; present: number; absent: number; leave: number; percentage: number }>({
    queryKey: ["/api/attendance/daily-summary", schoolId, date],
    queryFn: async () => {
      const r = await fetch(`/api/attendance/daily-summary/${schoolId}/${date}`, { credentials: "include" });
      return r.ok ? r.json() : { total: 0, present: 0, absent: 0, leave: 0, percentage: 0 };
    },
    enabled: !!schoolId,
  });

  const stats = [
    { label: "Present", value: summary?.present ?? 0, color: "text-green-400", bg: "bg-green-500/20", icon: Users },
    { label: "Absent", value: summary?.absent ?? 0, color: "text-red-400", bg: "bg-red-500/20", icon: UserX },
    { label: "On Leave", value: summary?.leave ?? 0, color: "text-yellow-400", bg: "bg-yellow-500/20", icon: Users },
    { label: "Total Marked", value: summary?.total ?? 0, color: "text-blue-400", bg: "bg-blue-500/20", icon: TrendingUp },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Attendance Overview</h2>
          <p className="text-white/50 text-sm">School-wide daily attendance summary</p>
        </div>
        <div>
          <label className="block text-xs text-white/50 mb-1">Select Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="bg-[#1A2942] border border-white/20 text-white rounded-lg px-3 py-2 text-sm"
            data-testid="input-attendance-date" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map(s => (
              <div key={s.label} className="rounded-xl border border-white/10 bg-[#1A2942] p-5">
                <div className={`inline-flex p-2 rounded-lg ${s.bg} mb-3`}>
                  <s.icon className={`w-5 h-5 ${s.color}`} />
                </div>
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-white/50 text-sm mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-white/10 bg-[#1A2942] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">Daily Presence Rate</h3>
              <span className="text-3xl font-bold text-[#D4AF37]" data-testid="text-presence-pct">{summary?.percentage ?? 0}%</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-4 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${summary?.percentage ?? 0}%`,
                  background: "linear-gradient(90deg, #D4AF37, #F4D03F)",
                }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-white/40">
              <span>0%</span>
              <span>Target: 85%</span>
              <span>100%</span>
            </div>
          </div>

          {(summary?.total ?? 0) === 0 && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-center">
              <p className="text-yellow-400 text-sm">No attendance records found for {new Date(date).toLocaleDateString("en-GB")}. Teachers may not have marked attendance yet.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
