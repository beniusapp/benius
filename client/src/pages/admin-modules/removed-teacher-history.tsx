import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, Trash2, ChevronLeft, ChevronRight, Calendar, User, Phone, BookOpen, MapPin, CreditCard, GraduationCap, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateOnly, formatDateTimeIST } from "@shared/ist-time";

interface Props {
  schoolId: number;
  onBack?: () => void;
}

interface RemovedTeacher {
  id: number;
  digitalTeacherId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  subject: string | null;
  assignedClass: string | null;
  assignedSection: string | null;
  designation: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  govtIdType: string | null;
  govtIdNumber: string | null;
  address: string | null;
  joiningDate: string | null;
  qualifications: string | null;
  removalReason: string;
  removedByEmail: string | null;
  removedAt: string;
}

const PAGE_SIZE = 20;

function formatDate(val: string | null | undefined) {
  return formatDateOnly(val);
}

function formatDateTime(val: string | null | undefined) {
  return formatDateTimeIST(val);
}

export default function RemovedTeacherHistory({ schoolId, onBack }: Props) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery<{ data: RemovedTeacher[]; total: number; pages: number }>({
    queryKey: ["/api/admin/teachers/removed-history", schoolId, page, q],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (q.trim()) params.set("q", q.trim());
      const r = await fetch(`/api/admin/teachers/removed-history?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const handleSearch = (val: string) => { setQ(val); setPage(1); };

  const rangeStart = data ? (page - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = data ? Math.min(page * PAGE_SIZE, data.total) : 0;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-1">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-white/50 hover:text-white text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Teacher Registry
        </button>
        <span className="text-white/20">/</span>
        <span className="text-white/60 text-sm">Removed History</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-400" />
            Removed Teacher History
          </h2>
          <p className="text-white/40 text-xs mt-0.5">
            {data ? `${data.total} record${data.total !== 1 ? "s" : ""}` : "Loading…"}
          </p>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <Input
          value={q}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search by name, ID or email…"
          className="pl-9 bg-[#0A1628] border-white/15 text-white placeholder:text-white/30 h-9 text-sm"
        />
      </div>

      {/* ── Table ── */}
      <div className="rounded-xl border border-white/10 overflow-x-auto bg-[#0D1B2E]">
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              {["DTID", "Name", "Email", "Phone", "Subject", "Class / Sec", "Designation", "Gender", "DOB", "Joining", "Qualification", "Govt ID", "Removal Reason", "Removed By", "Removed At", ""].map(h => (
                <th key={h} className="py-3 px-3 text-left text-[10px] font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={16} className="py-16 text-center text-white/30 text-sm">Loading history…</td></tr>
            ) : isError ? (
              <tr><td colSpan={16} className="py-16 text-center text-red-400 text-sm">Failed to load removed teacher history.</td></tr>
            ) : !data?.data.length ? (
              <tr>
                <td colSpan={16} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3 text-white/30">
                    <Trash2 className="w-10 h-10 opacity-30" />
                    <p className="text-sm">{q ? "No records match your search." : "No teachers have been removed yet."}</p>
                  </div>
                </td>
              </tr>
            ) : data.data.map(r => (
              <>
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer"
                  onClick={() => setExpandedRow(expandedRow === r.id ? null : r.id)}>
                  {/* DTID */}
                  <td className="py-3 px-3 whitespace-nowrap">
                    <span className="font-mono text-xs font-semibold text-red-400">{r.digitalTeacherId || "—"}</span>
                  </td>
                  {/* Name */}
                  <td className="py-3 px-3 whitespace-nowrap">
                    <span className="text-white font-medium text-xs">{r.fullName}</span>
                  </td>
                  {/* Email */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/60 text-xs">{r.email || "—"}</td>
                  {/* Phone */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/60 text-xs">{r.phone || "—"}</td>
                  {/* Subject */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/60 text-xs">{r.subject || "—"}</td>
                  {/* Class/Section */}
                  <td className="py-3 px-3 text-white/60 text-xs max-w-[120px]">
                    {r.assignedClass || "—"}
                  </td>
                  {/* Designation */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/60 text-xs">{r.designation || "—"}</td>
                  {/* Gender */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/60 text-xs">{r.gender || "—"}</td>
                  {/* DOB */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/60 text-xs">{formatDate(r.dateOfBirth)}</td>
                  {/* Joining */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/60 text-xs">{formatDate(r.joiningDate)}</td>
                  {/* Qualification */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/60 text-xs">{r.qualifications || "—"}</td>
                  {/* Govt ID */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/60 text-xs">
                    {r.govtIdType && r.govtIdNumber ? `${r.govtIdType} · ${r.govtIdNumber}` : r.govtIdNumber || "—"}
                  </td>
                  {/* Reason */}
                  <td className="py-3 px-3 max-w-[160px]">
                    <span className="text-orange-300 text-xs line-clamp-2">{r.removalReason}</span>
                  </td>
                  {/* Removed By */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/50 text-xs">{r.removedByEmail || "—"}</td>
                  {/* Removed At */}
                  <td className="py-3 px-3 whitespace-nowrap text-white/50 text-xs">{formatDateTime(r.removedAt)}</td>
                  {/* Expand toggle */}
                  <td className="py-3 px-3 whitespace-nowrap">
                    <span className="text-white/30 text-[10px]">{expandedRow === r.id ? "▲" : "▼"}</span>
                  </td>
                </tr>

                {/* Expanded detail row */}
                {expandedRow === r.id && (
                  <tr key={`exp-${r.id}`} className="border-b border-white/10 bg-[#0A1628]/60">
                    <td colSpan={16} className="px-5 py-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                        <Detail icon={<User className="w-3 h-3" />} label="Full Name" value={r.fullName} />
                        <Detail icon={<BookOpen className="w-3 h-3" />} label="Digital Teacher ID" value={r.digitalTeacherId} />
                        <Detail icon={<Phone className="w-3 h-3" />} label="Phone" value={r.phone} />
                        <Detail icon={<BookOpen className="w-3 h-3" />} label="Subject" value={r.subject} />
                        <Detail icon={<BookOpen className="w-3 h-3" />} label="Class / Section" value={r.assignedClass && r.assignedSection ? `${r.assignedClass} – ${r.assignedSection}` : null} />
                        <Detail icon={<User className="w-3 h-3" />} label="Designation" value={r.designation} />
                        <Detail icon={<User className="w-3 h-3" />} label="Gender" value={r.gender} />
                        <Detail icon={<Calendar className="w-3 h-3" />} label="Date of Birth" value={formatDate(r.dateOfBirth)} />
                        <Detail icon={<Calendar className="w-3 h-3" />} label="Joining Date" value={formatDate(r.joiningDate)} />
                        <Detail icon={<GraduationCap className="w-3 h-3" />} label="Qualification" value={r.qualifications} />
                        <Detail icon={<CreditCard className="w-3 h-3" />} label="Govt ID" value={r.govtIdType && r.govtIdNumber ? `${r.govtIdType}: ${r.govtIdNumber}` : r.govtIdNumber} />
                        <Detail icon={<MapPin className="w-3 h-3" />} label="Address" value={r.address} />
                        <div className="col-span-2 sm:col-span-3 lg:col-span-2">
                          <Detail icon={<AlertCircle className="w-3 h-3 text-orange-400" />} label="Removal Reason" value={r.removalReason} highlight />
                        </div>
                        <Detail icon={<User className="w-3 h-3" />} label="Removed By" value={r.removedByEmail} />
                        <Detail icon={<Clock className="w-3 h-3" />} label="Removed At" value={formatDateTime(r.removedAt)} />
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-white/40">
          <span>{rangeStart}–{rangeEnd} of {data.total}</span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="px-2 text-white/60">{page} / {data.pages}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
              onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string | null | undefined; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 text-white/30 text-[10px] uppercase tracking-wide">
        {icon} {label}
      </div>
      <p className={`text-xs font-medium ${highlight ? "text-orange-300" : "text-white/80"}`}>
        {value || "—"}
      </p>
    </div>
  );
}
