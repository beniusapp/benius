import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { sessionFetch } from "@/lib/queryClient";
import {
  Search, ChevronLeft, ChevronRight, AlignJustify, FileDown,
  RotateCcw, Eye, Loader2, ArrowLeft, X, UserX, RefreshCw, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { KeyboardEvent } from "react";

const PAGE_SIZE = 50;

type DeactivatedStudent = {
  id: number;
  digitalStudentId: string;
  name: string;
  class: string;
  section: string;
  phone: string;
  gender: string | null;
  guardianName: string | null;
  dob: string | null;
  enrollmentDate: string | null;
  bloodGroup: string | null;
  rollNumber: number | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  batchYear: string | null;
};

type Me = {
  id: number;
  schoolId: number;
  schoolName: string;
  role: string;
};

function SkeletonRow({ compact, cols }: { compact: boolean; cols: number }) {
  return (
    <tr className="border-b border-white/5">
      {[...Array(cols)].map((_, i) => (
        <td key={i} className={compact ? "py-1.5 px-3" : "py-3 px-3"}>
          <div
            className="h-3.5 rounded bg-white/10 animate-pulse"
            style={{ width: `${50 + (i * 13) % 40}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

function GenderBadge({ gender }: { gender: string | null | undefined }) {
  if (!gender) return <span className="text-white/30 text-xs">—</span>;
  const isBoy = gender === "Boy";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold
      ${isBoy ? "bg-blue-500/20 text-blue-300" : "bg-pink-500/20 text-pink-300"}`}>
      {gender}
    </span>
  );
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return "—";
  }
}

function cleanReason(raw: string | null) {
  if (!raw) return "—";
  return raw.replace(/^Student .+? deactivated\. Reason:\s*/i, "") || raw;
}

export default function DeactivatedStudentsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [gotoPage, setGotoPage] = useState("");
  const [compact, setCompact] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [viewTarget, setViewTarget] = useState<DeactivatedStudent | null>(null);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // ── School context ─────────────────────────────────────────────────────────
  const { data: me } = useQuery<Me>({
    queryKey: ["/api/me"],
    queryFn: async () => {
      const r = await sessionFetch("/api/me");
      if (!r.ok) throw new Error("Not authenticated");
      return r.json();
    },
  });
  const schoolId = me?.schoolId;

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: allStudents, isLoading, isError, error, refetch } = useQuery<DeactivatedStudent[]>({
    queryKey: ["/api/schools", schoolId, "students", "deactivated"],
    queryFn: async () => {
      const r = await sessionFetch(`/api/schools/${schoolId}/students/deactivated`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message ?? `Server error ${r.status}`);
      }
      return r.json();
    },
    enabled: !!schoolId,
    staleTime: 0,       // always re-fetch on mount for this page
    retry: 1,
  });

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = useCallback((val: string) => {
    setQ(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => { setDebouncedQ(val); setPage(1); }, 400);
    setDebounceTimer(t);
  }, [debounceTimer]);

  function handleResetFilters() {
    setQ(""); setDebouncedQ(""); setPage(1);
  }

  const hasFilters = !!q;

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!allStudents) return [];
    if (!debouncedQ) return allStudents;
    const lq = debouncedQ.toLowerCase();
    return allStudents.filter(s =>
      s.name.toLowerCase().includes(lq) ||
      s.digitalStudentId.toLowerCase().includes(lq) ||
      s.phone.includes(debouncedQ)
    );
  }, [allStudents, debouncedQ]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: filtered.length,
    boys: filtered.filter(s => s.gender === "Boy").length,
    girls: filtered.filter(s => s.gender === "Girl").length,
  }), [filtered]);

  // ── Pagination ─────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function commitGotoPage() {
    const n = parseInt(gotoPage);
    if (!isNaN(n) && n >= 1 && n <= totalPages) setPage(n);
    setGotoPage("");
  }
  function onGotoKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitGotoPage();
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  async function handleExport() {
    if (!schoolId) return;
    setIsExporting(true);
    try {
      const exportParams = new URLSearchParams();
      if (debouncedQ) exportParams.set("q", debouncedQ);
      const r = await fetch(
        `/api/schools/${schoolId}/students/deactivated/export?${exportParams}`,
        { credentials: "include" },
      );
      if (!r.ok) {
        toast({ title: "Export Failed", description: "Could not generate the file.", variant: "destructive" });
        return;
      }
      const blob = await r.blob();
      const disposition = r.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="(.+)"/);
      const filename = match ? match[1] : `Deactivated_Students_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      toast({ title: "Export Failed", description: "An unexpected error occurred.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }

  const cell = compact ? "py-1.5 px-3 text-xs" : "py-3 px-3 text-sm";
  // Normal: DSID Name Gender Phone Guardian DOB Admission Blood DeactivatedOn BatchYear Reason View Status = 13
  // Compact: DSID Name Gender Phone BatchYear View Status = 7
  const colCount = compact ? 7 : 13;

  return (
    <div className="min-h-screen" style={{ background: "#080c14" }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-[#080c14]/95 backdrop-blur-sm">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-3 px-6 py-3">
          <button
            onClick={() => navigate("/admin-dashboard/student-registry")}
            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Student Registry
          </button>
          <span className="text-white/20">·</span>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-red-500/20 flex items-center justify-center">
              <UserX className="w-3.5 h-3.5 text-red-400" />
            </div>
            <span className="text-white font-semibold text-sm">Deactivated Students</span>
          </div>
          {me?.schoolName && (
            <span className="text-white/30 text-xs ml-auto">{me.schoolName}</span>
          )}
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-4">

        {/* Error state */}
        {isError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-300">Failed to load deactivated students</p>
              <p className="text-xs text-red-400/70 mt-0.5 break-all">{(error as Error)?.message}</p>
            </div>
            <Button size="sm" variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0"
              onClick={() => refetch()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </div>
        )}

        {/* Header row */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Deactivated Students</h2>
            <p className="text-white/50 text-sm">
              {isLoading
                ? "Loading…"
                : `${filtered.length} record${filtered.length !== 1 ? "s" : ""}${hasFilters ? " (filtered)" : ""} · Page ${page} of ${totalPages}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setCompact(c => !c)}
              title={compact ? "Normal View" : "Compact View"}
              className={`flex items-center gap-1.5 px-3 rounded-lg border text-xs font-medium transition-colors h-11
                ${compact
                  ? "border-[#10b981]/50 bg-[#10b981]/10 text-[#10b981]"
                  : "border-white/20 text-white/60 hover:bg-white/10"}`}
            >
              <AlignJustify className="w-3.5 h-3.5" />
              {compact ? "Compact" : "Normal"}
            </button>
            <Button
              size="sm" variant="outline"
              className="border-[#D4AF37]/40 text-[#D4AF37] hover:bg-[#D4AF37]/10 h-11"
              onClick={handleExport}
              disabled={isExporting || !schoolId}
            >
              {isExporting
                ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                : <FileDown className="w-4 h-4 mr-1" />}
              {isExporting ? "Exporting…" : "Export"}
            </Button>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-red-500/20 bg-[#1A2942] p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
              <UserX className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wide">Total Deactivated</p>
              <p className="text-2xl font-bold text-white">{isLoading ? "—" : stats.total}</p>
            </div>
          </div>
          <div className="rounded-xl border border-blue-500/20 bg-[#1A2942] p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
              <span className="text-blue-300 text-lg font-bold">♂</span>
            </div>
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wide">Boys</p>
              <p className="text-2xl font-bold text-blue-300">{isLoading ? "—" : stats.boys}</p>
            </div>
          </div>
          <div className="rounded-xl border border-pink-500/20 bg-[#1A2942] p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-pink-500/15 flex items-center justify-center shrink-0">
              <span className="text-pink-300 text-lg font-bold">♀</span>
            </div>
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wide">Girls</p>
              <p className="text-2xl font-bold text-pink-300">{isLoading ? "—" : stats.girls}</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <Input
              value={q}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search name, DSID or phone…"
              className="pl-9 bg-[#1A2942] border-white/20 text-white placeholder:text-white/30"
            />
          </div>
          {hasFilters && (
            <Button
              size="sm" variant="outline" onClick={handleResetFilters}
              className="border-white/20 text-white/60 hover:bg-white/10 h-11"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset
            </Button>
          )}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-white/10 bg-[#1A2942]">
          <div className="overflow-x-auto" style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <table
              className="text-sm"
              style={{ minWidth: compact ? "780px" : "1400px", width: "100%", tableLayout: "fixed" }}
            >
              <colgroup>
                <col style={{ width: "128px" }} />
                <col style={{ width: "auto" }} />
                <col style={{ width: "70px" }} />
                <col style={{ width: "112px" }} />
                <col style={{ width: "96px" }} />
                {!compact && <col style={{ width: "130px" }} />}
                {!compact && <col style={{ width: "96px" }} />}
                {!compact && <col style={{ width: "108px" }} />}
                {!compact && <col style={{ width: "78px" }} />}
                {!compact && <col style={{ width: "118px" }} />}
                {!compact && <col style={{ width: "200px" }} />}
                <col style={{ width: "52px" }} />
                <col style={{ width: "96px" }} />
              </colgroup>
              <thead className="bg-[#0F1E35] sticky top-0 z-10">
                <tr>
                  <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">DSID</th>
                  <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Name</th>
                  <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Gender</th>
                  <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Phone</th>
                  <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Batch Year</th>
                  {!compact && <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Guardian</th>}
                  {!compact && <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">DOB</th>}
                  {!compact && <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Admission</th>}
                  {!compact && <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Blood Grp</th>}
                  {!compact && <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Deactivated On</th>}
                  {!compact && <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Reason</th>}
                  <th className="py-3 px-2" />
                  <th className="text-left py-3 px-3 text-white/60 font-medium text-xs uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(8)].map((_, i) => <SkeletonRow key={i} compact={compact} cols={colCount} />)
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="py-12 text-center text-white/40">
                      <UserX className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      {hasFilters
                        ? "No students match the current filters"
                        : "No deactivated students on record"}
                    </td>
                  </tr>
                ) : paginated.map(s => (
                  <tr
                    key={s.id}
                    className="border-b border-white/5 hover:bg-red-500/[0.03] even:bg-white/[0.015] transition-colors"
                  >
                    <td className={`${cell} font-mono overflow-hidden`}>
                      <span className="text-red-400/80 truncate block">{s.digitalStudentId}</span>
                    </td>
                    <td className={`${cell} text-white/80 font-medium overflow-hidden text-ellipsis`}>{s.name}</td>
                    <td className={cell}><GenderBadge gender={s.gender} /></td>
                    <td className={`${cell} text-white/60 overflow-hidden text-ellipsis font-mono`}>{s.phone}</td>
                    <td className={`${cell} text-white/70 font-mono`}>{s.batchYear ?? <span className="text-white/20">—</span>}</td>
                    {!compact && <td className={`${cell} text-white/60 overflow-hidden text-ellipsis`}>{s.guardianName ?? "—"}</td>}
                    {!compact && <td className={`${cell} text-white/50 font-mono`}>{s.dob ?? "—"}</td>}
                    {!compact && <td className={`${cell} text-white/50 font-mono`}>{s.enrollmentDate ?? "—"}</td>}
                    {!compact && <td className={`${cell} text-white/60`}>{s.bloodGroup ?? "—"}</td>}
                    {!compact && (
                      <td className={`${cell} text-white/50 font-mono`}>
                        {formatDate(s.deactivatedAt)}
                      </td>
                    )}
                    {!compact && (
                      <td
                        className={`${cell} text-white/40 overflow-hidden text-ellipsis`}
                        title={cleanReason(s.deactivationReason)}
                      >
                        {cleanReason(s.deactivationReason)}
                      </td>
                    )}
                    <td className={compact ? "py-1.5 px-2" : "py-2 px-2"}>
                      <Button
                        variant="ghost" size="icon"
                        className="text-white/40 hover:text-white hover:bg-white/10 h-9 w-9 shrink-0"
                        onClick={() => setViewTarget(s)}
                        title="View profile"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                    <td className={compact ? "py-1.5 px-3" : "py-3 px-3"}>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/20 whitespace-nowrap">
                        Deactive
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-white/40 text-sm">
            Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="border-white/20 text-white hover:bg-white/10 h-11 min-w-[44px]"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="px-3 py-2 rounded bg-[#1A2942] text-white text-sm min-w-[70px] text-center">
              {page} / {totalPages}
            </span>
            <input
              type="number" min={1} max={totalPages}
              value={gotoPage}
              onChange={e => setGotoPage(e.target.value)}
              onKeyDown={onGotoKeyDown}
              onBlur={commitGotoPage}
              placeholder="Go to…"
              className="w-[72px] h-11 px-2 rounded bg-[#1A2942] border border-white/20 text-white text-sm text-center placeholder:text-white/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:border-[#10b981]/60"
            />
            <Button
              size="sm" variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="border-white/20 text-white hover:bg-white/10 h-11 min-w-[44px]"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── View Profile Modal ───────────────────────────────────────────── */}
      {viewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setViewTarget(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-[#1A2942] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                  <UserX className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Student Profile</h3>
                  <p className="text-xs text-white/40">{viewTarget.digitalStudentId}</p>
                </div>
              </div>
              <button
                onClick={() => setViewTarget(null)}
                className="rounded-lg hover:bg-white/10 text-white/50 hover:text-white h-11 w-11 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto" style={{ maxHeight: "75vh" }}>
              {[
                { label: "Full Name",        value: viewTarget.name },
                { label: "DSID",             value: viewTarget.digitalStudentId, mono: true, gold: true },
                { label: "Batch Year",       value: viewTarget.batchYear ?? "Not recorded" },
                { label: "Gender",           value: viewTarget.gender ?? "Not set" },
                { label: "Phone",            value: viewTarget.phone },
                { label: "Guardian",         value: viewTarget.guardianName ?? "Not recorded" },
                { label: "Blood Group",      value: viewTarget.bloodGroup ?? "Not recorded" },
                { label: "Date of Birth",    value: viewTarget.dob ?? "—" },
                { label: "Date of Admission",value: viewTarget.enrollmentDate ?? "Not recorded" },
              ].map(({ label, value, mono, gold }) => (
                <div key={label} className="flex justify-between items-start gap-3 text-sm">
                  <span className="text-white/50 shrink-0">{label}</span>
                  <span className={`text-right break-all ${mono ? "font-mono" : ""} ${gold ? "text-[#D4AF37]" : "text-white"}`}>
                    {value}
                  </span>
                </div>
              ))}
              {/* Deactivation info */}
              <div className="pt-3 mt-3 border-t border-white/10 space-y-3">
                <div className="flex justify-between items-start gap-3 text-sm">
                  <span className="text-white/50 shrink-0">Deactivated On</span>
                  <span className="text-red-400/80 text-right font-mono">
                    {formatDate(viewTarget.deactivatedAt)}
                  </span>
                </div>
                <div className="flex justify-between items-start gap-3 text-sm">
                  <span className="text-white/50 shrink-0">Reason</span>
                  <span className="text-white/60 text-right break-words max-w-[180px]">
                    {cleanReason(viewTarget.deactivationReason)}
                  </span>
                </div>
                <div className="flex justify-between items-start gap-3 text-sm">
                  <span className="text-white/50 shrink-0">Status</span>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/20">
                    Deactive
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
