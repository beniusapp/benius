import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CreditCard, Search, Printer, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Props { schoolId: number; schoolName: string; classes: string[]; sections: string[] }

function IDCard({ student, schoolName, showReissueBanner }: { student: any; schoolName: string; showReissueBanner?: boolean }) {
  return (
    <div className={`w-72 rounded-xl border-2 bg-gradient-to-br from-[#0A1628] to-[#1A2942] p-5 shadow-xl relative
      ${showReissueBanner && student.idCardPendingReissue ? "border-orange-400/80" : "border-[#D4AF37]"}`}
      data-testid={`card-id-${student.id}`}>
      {showReissueBanner && student.idCardPendingReissue && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold shadow-lg whitespace-nowrap">
          <AlertTriangle className="w-2.5 h-2.5" /> PENDING RE-ISSUANCE
        </div>
      )}
      <div className="flex items-center gap-3 mb-3 border-b border-[#D4AF37]/30 pb-3">
        <div className="w-10 h-10 rounded-full bg-[#D4AF37] flex items-center justify-center text-[#0A1628] font-bold text-lg">
          {student.name?.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-[#D4AF37] text-xs font-semibold tracking-wider">BENIUS</p>
          <p className="text-white/60 text-xs">{schoolName}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-white font-bold text-lg leading-tight">{student.name}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><p className="text-white/40">DSID</p><p className="text-[#D4AF37] font-mono">{student.digitalStudentId}</p></div>
          <div><p className="text-white/40">Class</p><p className="text-white">{student.class}-{student.section}</p></div>
          <div><p className="text-white/40">DOB</p><p className="text-white">{student.dob ? new Date(student.dob).toLocaleDateString("en-GB") : "—"}</p></div>
          <div><p className="text-white/40">Phone</p><p className="text-white">{student.phone}</p></div>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-[#D4AF37]/30 flex items-center justify-between">
        <div className="w-16 h-8 bg-white rounded flex items-center justify-center">
          <p className="text-[#0A1628] text-[8px] font-bold font-mono">{student.digitalStudentId}</p>
        </div>
        <p className="text-white/30 text-[9px]">Academic Year 2025-26</p>
      </div>
    </div>
  );
}

export default function IdCardGen({ schoolId, schoolName, classes, sections }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"search" | "reissue">("search");
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState(false);

  const params = new URLSearchParams();
  if (cls) params.set("cls", cls);
  if (section) params.set("section", section);
  if (q) params.set("q", q);
  params.set("page", "1");
  if (tab === "reissue") params.set("pendingReissue", "true");

  const { data, isLoading } = useQuery<{ data: any[]; total: number }>({
    queryKey: ["/api/schools", schoolId, "students", "paginated", q, cls, section, 1, tab],
    queryFn: async () => {
      const r = await fetch(`/api/schools/${schoolId}/students/paginated?${params}`, { credentials: "include" });
      return r.ok ? r.json() : { data: [], total: 0 };
    },
    enabled: !!schoolId && (tab === "reissue" || searched),
    staleTime: 0,
  });

  const clearFlagMut = useMutation({
    mutationFn: async (studentIds: number[]) =>
      apiRequest("POST", "/api/admin/students/clear-reissue-flag", { studentIds }),
    onSuccess: (_data, studentIds) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schools", schoolId, "students"] });
      toast({ title: "✅ Flags cleared", description: `${studentIds.length} student(s) marked as re-issued.`, duration: 3000 });
    },
    onError: () => toast({ title: "Failed to clear flags", variant: "destructive" }),
  });

  const handleSearch = () => setSearched(true);

  const reissueStudents = (data?.data ?? []).filter(s => s.idCardPendingReissue);

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-white">ID Card Generator</h2>
        <p className="text-white/50 text-sm">Generate digital student ID cards for printing</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => { setTab("search"); setSearched(false); }}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === "search" ? "bg-[#D4AF37] text-[#0A1628]" : "bg-[#1A2942] text-white/60 hover:text-white border border-white/10"}`}
          data-testid="tab-idcard-search">
          <Search className="w-3.5 h-3.5 inline mr-1.5" />Search
        </button>
        <button
          onClick={() => setTab("reissue")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors relative ${tab === "reissue" ? "bg-orange-500 text-white" : "bg-[#1A2942] text-orange-400 hover:text-orange-300 border border-orange-400/30"}`}
          data-testid="tab-idcard-reissue">
          <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />Pending Re-issuance
          {(data?.total ?? 0) > 0 && tab === "reissue" && (
            <span className="ml-1.5 bg-white/20 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{data?.total}</span>
          )}
        </button>
      </div>

      {tab === "search" && (
        <div className="rounded-xl border border-[#D4AF37]/30 bg-[#1A2942] p-5 space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-white/60 mb-1">Search Student</label>
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Name or DSID..."
                className="bg-[#0A1628] border-white/20 text-white" data-testid="input-idcard-search"
                onKeyDown={e => e.key === "Enter" && handleSearch()} />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Class</label>
              <Select value={cls} onValueChange={setCls}>
                <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-idcard-class"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(classes.length > 0 ? classes : ["9","10","11","12"]).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Section</label>
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger className="w-28 bg-[#0A1628] border-white/20 text-white" data-testid="select-idcard-section"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(sections.length > 0 ? sections : ["A","B","C"]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSearch} className="bg-[#D4AF37] hover:bg-[#B8962E] text-[#0A1628] font-semibold" data-testid="button-search-idcard">
              <Search className="w-4 h-4 mr-1" /> Search
            </Button>
            {data && data.data.length > 0 && (
              <Button variant="outline" className="border-white/20 text-white hover:bg-white/10"
                onClick={() => { window.print(); toast({ title: "Print dialog opened" }); }} data-testid="button-print-cards">
                <Search className="w-4 h-4 mr-1" /> Print All
              </Button>
            )}
          </div>
        </div>
      )}

      {tab === "reissue" && (
        <div className="rounded-xl border border-orange-400/30 bg-[#1A2942] p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-orange-300 font-semibold text-sm flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Promoted Students — ID Cards Need Re-printing
              </p>
              <p className="text-white/40 text-xs mt-0.5">
                These students were promoted to a new class. Their old ID cards show the wrong class and must be reprinted.
              </p>
            </div>
            {reissueStudents.length > 0 && (
              <Button
                onClick={() => {
                  window.print();
                  toast({ title: "Print dialog opened", description: "After printing, click 'Mark All Printed' to clear the flags." });
                }}
                className="bg-orange-500 hover:bg-orange-400 text-white font-semibold shrink-0"
                data-testid="button-print-reissue">
                <Printer className="w-4 h-4 mr-1.5" /> Print {reissueStudents.length} Card{reissueStudents.length !== 1 ? "s" : ""}
              </Button>
            )}
            {reissueStudents.length > 0 && (
              <Button variant="outline"
                onClick={() => clearFlagMut.mutate(reissueStudents.map(s => s.id))}
                disabled={clearFlagMut.isPending}
                className="border-orange-400/40 text-orange-400 hover:bg-orange-400/10 shrink-0"
                data-testid="button-mark-printed">
                {clearFlagMut.isPending ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                Mark All Printed
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Card Grid */}
      {(tab === "reissue" || searched) && (
        isLoading ? (
          <p className="text-center text-white/40 py-8">Loading students...</p>
        ) : !data || data.data.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
            <CreditCard className="w-10 h-10 mx-auto mb-3 text-white/20" />
            {tab === "reissue"
              ? <p className="text-white/40">No pending re-issuances — all ID cards are up to date.</p>
              : <p className="text-white/40">No students found. Try different filters.</p>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-4 pt-2" id="print-area">
            {data.data.slice(0, 20).map(s => (
              <IDCard key={s.id} student={s} schoolName={schoolName} showReissueBanner={tab === "reissue"} />
            ))}
          </div>
        )
      )}

      {tab === "search" && !searched && (
        <div className="rounded-xl border border-white/10 bg-[#1A2942] py-16 text-center">
          <CreditCard className="w-10 h-10 mx-auto mb-3 text-white/20" />
          <p className="text-white/40">Search for students to preview and print ID cards</p>
          <p className="text-white/25 text-sm mt-1">Up to 20 cards shown at a time · Use Class/Section filter for batch print</p>
        </div>
      )}
    </div>
  );
}
