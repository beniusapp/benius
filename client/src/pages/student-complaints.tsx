import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { fmtDate, fmtDateTimeAmPm } from "@/lib/dateUtils";
import {
  ArrowLeft, Mail, ShieldAlert, UserX, Loader2,
  AlertTriangle, CheckCircle, Clock, Plus, Lock, ChevronDown, ChevronUp,
  Search, X,
} from "lucide-react";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface StudentMe {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  phone: string;
  schoolName: string;
  schoolCode: string;
  schoolId: number;
}

interface TeacherOption {
  id: number;
  name: string;
  subject: string;
}

interface PeerStudent {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  photoUrl: string | null;
}

interface ComplaintRecord {
  id: number;
  ticketId: string;
  complaintType: string;
  status: string;
  content: string;
  reportedStudentName: string | null;
  incidentDate: string | null;
  contactNumber: string | null;
  suggestions: string | null;
  teacherName?: string | null;
  resolutionRemarks: string | null;
  escalatedToPrincipal: boolean | null;
  createdAt: string;
}

type TabId = "inbox" | "staff" | "peer";

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string; icon: typeof CheckCircle }> = {
    "Pending":       { label: "Pending",       cls: "bg-amber-50   text-amber-700   border-amber-200",   icon: Clock         },
    "Investigating": { label: "Investigating", cls: "bg-blue-50    text-blue-700    border-blue-200",    icon: Clock         },
    "Resolved":      { label: "Resolved",      cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle   },
    "Escalated":     { label: "Escalated",     cls: "bg-red-50     text-red-700     border-red-200",     icon: AlertTriangle },
  };
  const s = cfg[status] ?? { label: status, cls: "bg-gray-50 text-gray-600 border-gray-200", icon: Clock };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${s.cls}`}>
      <Icon className="w-3 h-3" />
      {s.label}
    </span>
  );
}


function InboxCard({ c }: { c: ComplaintRecord & { teacherName: string } }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-4 flex gap-3" data-testid={`card-inbox-${c.id}`}>
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
        <AlertTriangle className="w-5 h-5 text-red-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <p className="text-sm font-bold text-gray-800">{c.teacherName}</p>
            <p className="text-xs text-gray-400 mt-0.5">{fmtDateTimeAmPm(c.createdAt)} · #{c.ticketId}</p>
          </div>
          <StatusBadge status={c.status} />
        </div>
        <p className={`text-sm text-gray-600 mt-2 ${expanded ? "" : "line-clamp-2"}`}>{c.content}</p>
        {c.content.length > 100 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-[#10b981] font-medium mt-1 min-h-[32px]"
            data-testid={`btn-expand-inbox-${c.id}`}
          >
            {expanded ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Read more</>}
          </button>
        )}
      </div>
    </div>
  );
}

function FiledCard({ c }: { c: ComplaintRecord }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4" data-testid={`card-filed-${c.id}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs text-gray-400">#{c.ticketId} · {fmtDateTimeAmPm(c.createdAt)}</p>
          {c.complaintType === "student-to-staff" && c.teacherName && (
            <p className="text-sm font-semibold text-gray-700 mt-0.5">Against: {c.teacherName}</p>
          )}
          {c.complaintType === "student-peer-report" && c.reportedStudentName && (
            <p className="text-sm font-semibold text-gray-700 mt-0.5">Reported: {c.reportedStudentName}</p>
          )}
          {c.complaintType === "student-peer-report" && c.incidentDate && (
            <p className="text-xs text-gray-500 mt-0.5">
              Incident: {fmtDate(c.incidentDate)}
            </p>
          )}
        </div>
        <StatusBadge status={c.status} />
      </div>
      <p className="text-sm text-gray-600 mt-2 line-clamp-2">{c.content}</p>
      {c.status === "Resolved" && c.resolutionRemarks && (
        <div className="mt-2 px-3 py-2 bg-emerald-50 rounded-xl border border-emerald-100">
          <p className="text-xs font-semibold text-emerald-700">Resolution</p>
          <p className="text-xs text-emerald-600 mt-0.5">{c.resolutionRemarks}</p>
        </div>
      )}
      {c.escalatedToPrincipal && (
        <div className="mt-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-red-500" />
          <p className="text-xs text-red-600 font-medium">Escalated to Principal</p>
        </div>
      )}
    </div>
  );
}

/* ── Peer Student Autocomplete Search ── */
function PeerStudentSearch({
  onSelect,
  selectedStudent,
  onClear,
}: {
  onSelect: (s: PeerStudent) => void;
  selectedStudent: PeerStudent | null;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce
  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(val), 300);
    setShowDropdown(true);
  }, []);

  const { data: results = [], isFetching } = useQuery<PeerStudent[]>({
    queryKey: ["/api/student/search-peers", debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/student/search-peers?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 10000,
  });

  // Click outside to close
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // If a student is already selected, show their chip
  if (selectedStudent) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#10b981] bg-emerald-50" data-testid="peer-selected-chip">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{selectedStudent.name}</p>
          <p className="text-xs text-gray-600">{selectedStudent.digitalStudentId} · Class {selectedStudent.class}-{selectedStudent.section}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500 hover:text-red-500 transition-colors flex-shrink-0"
          data-testid="button-clear-peer"
          aria-label="Clear selected student"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          onFocus={() => query.length >= 2 && setShowDropdown(true)}
          placeholder="Type a name or ID (min 2 characters)…"
          className="w-full pl-9 pr-4 h-11 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
          data-testid="input-peer-search"
          autoComplete="off"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[#10b981]" />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && debouncedQuery.length >= 2 && (
        <div
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-56 overflow-y-auto"
          data-testid="peer-search-dropdown"
        >
          {!isFetching && results.length === 0 ? (
            <div className="p-3 text-center text-sm font-semibold text-gray-500">
              No students found
            </div>
          ) : (
            results.map(s => (
              <button
                key={s.id}
                type="button"
                onMouseDown={e => {
                  e.preventDefault(); // prevent blur first
                  onSelect(s);
                  setQuery("");
                  setDebouncedQuery("");
                  setShowDropdown(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-emerald-50 transition-colors border-b border-gray-100 last:border-b-0"
                data-testid={`peer-option-${s.id}`}
              >
                <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-emerald-700">
                    {s.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{s.name}</p>
                  <p className="text-xs font-semibold text-gray-600">{s.digitalStudentId} · Class {s.class}-{s.section}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function StudentComplaints() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("inbox");

  const [staffTeacherId, setStaffTeacherId] = useState("");
  const [staffContent, setStaffContent] = useState("");
  const [staffContact, setStaffContact] = useState<string | null>(null);
  const [staffSuggestions, setStaffSuggestions] = useState("");

  // Peer report state
  const [peerSelectedStudent, setPeerSelectedStudent] = useState<PeerStudent | null>(null);
  const [peerIncidentDate, setPeerIncidentDate] = useState("");
  const [peerContent, setPeerContent] = useState("");

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: inboxData = [], isLoading: inboxLoading } = useQuery<(ComplaintRecord & { teacherName: string })[]>({
    queryKey: ["/api/student/complaints/inbox"],
    enabled: !!student,
  });

  const { data: filedData = [], isLoading: filedLoading } = useQuery<ComplaintRecord[]>({
    queryKey: ["/api/student/complaints/filed"],
    enabled: !!student,
  });

  const { data: teacherOptions = [], isLoading: teachersLoading } = useQuery<TeacherOption[]>({
    queryKey: ["/api/student/complaint-teachers"],
    enabled: !!student,
  });

  const staffMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/student/complaints/staff-grievance", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/complaints/filed"] });
      toast({ title: "Grievance submitted", description: "Your complaint has been sent directly to the Principal." });
      setStaffTeacherId(""); setStaffContent(""); setStaffContact(null); setStaffSuggestions("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const peerMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/student/complaints/peer-report", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/complaints/filed"] });
      toast({ title: "Report submitted", description: "Your peer report has been filed." });
      setPeerSelectedStudent(null); setPeerIncidentDate(""); setPeerContent("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  const staffGrievances = filedData.filter(c => c.complaintType === "student-to-staff");
  const peerReports = filedData.filter(c => c.complaintType === "student-peer-report");

  const tabs: { id: TabId; label: string; Icon: typeof Mail; count?: number }[] = [
    { id: "inbox", label: "From Teachers", Icon: Mail,        count: inboxData.length },
    { id: "staff", label: "Staff Grievance", Icon: ShieldAlert },
    { id: "peer",  label: "Peer Reports",   Icon: UserX },
  ];

  const handleStaffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffTeacherId || !staffContent.trim()) {
      toast({ title: "Missing fields", description: "Please select a teacher and describe your complaint.", variant: "destructive" });
      return;
    }
    staffMutation.mutate({
      teacherId: parseInt(staffTeacherId),
      content: staffContent,
      contactNumber: staffContact !== null ? staffContact : student.phone,
      suggestions: staffSuggestions,
    });
  };

  const handlePeerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerSelectedStudent || !peerContent.trim()) {
      toast({ title: "Missing fields", description: "Please select a student and describe the incident.", variant: "destructive" });
      return;
    }
    peerMutation.mutate({
      reportedStudentName: peerSelectedStudent.name,
      reportedStudentId: peerSelectedStudent.id,
      incidentDate: peerIncidentDate || null,
      content: peerContent,
    });
  };

  return (
    <div className="min-h-screen bg-[#f0fdf4] flex flex-col">

      {/* ── Sticky header ── */}
      <header className="sticky top-0 z-30 bg-[#10b981] shadow-md">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors flex-shrink-0"
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight">Conduct & Grievance Hub</p>
            <p className="text-emerald-100 text-xs">{student.digitalStudentId} · Class {student.class}-{student.section}</p>
          </div>
          <span className="hidden sm:flex items-center px-2.5 py-1 rounded-full bg-white/20 text-white text-xs font-semibold">
            {student.schoolCode}
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-5 space-y-5 pb-24">

        {/* ── Three-Tab Segmented Toggle ── */}
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-1.5 flex gap-1">
          {tabs.map(({ id, label, Icon, count }) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); }}
              className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-2 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[52px] ${
                activeTab === id
                  ? "bg-[#10b981] text-white shadow-sm"
                  : "text-gray-500 hover:bg-emerald-50 hover:text-[#10b981]"
              }`}
              data-testid={`tab-${id}`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="leading-tight text-center">{label}</span>
              {count !== undefined && count > 0 && (
                <span className={`rounded-full text-[10px] font-bold px-1.5 py-0.5 ${activeTab === id ? "bg-white/25 text-white" : "bg-red-100 text-red-600"}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab: From Teachers ── */}
        {activeTab === "inbox" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <Mail className="w-4 h-4 text-[#10b981]" />
              <h2 className="text-sm font-bold text-gray-700">Conduct Alerts from Teachers</h2>
            </div>
            {inboxLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#10b981]" /></div>
            ) : inboxData.length === 0 ? (
              <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-8 flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
                  <Mail className="w-7 h-7 text-emerald-300" />
                </div>
                <h3 className="text-base font-bold text-gray-700">All Clear</h3>
                <p className="text-sm text-gray-400 max-w-xs">No conduct alerts from your teachers.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {inboxData.map(c => <InboxCard key={c.id} c={c} />)}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Staff Grievance ── */}
        {activeTab === "staff" && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
              <Lock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-blue-800">Direct to Principal — Strictly Confidential</p>
                <p className="text-xs text-blue-600 mt-0.5">Your complaint is sent directly to the Principal only. The staff member you are reporting will have no access to this record.</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5" data-testid="form-staff-grievance">
              <h2 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#10b981]" /> File a Staff Grievance
              </h2>
              <form onSubmit={handleStaffSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Staff Member *</label>
                  <select
                    value={staffTeacherId}
                    onChange={e => setStaffTeacherId(e.target.value)}
                    className="w-full px-3 h-11 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="select-staff-teacher"
                    required
                  >
                    <option value="">Select a staff member…</option>
                    {teacherOptions.map(t => (
                      <option key={t.id} value={t.id}>{t.name}{t.subject ? ` (${t.subject})` : ""}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Complaint Description *</label>
                  <textarea
                    value={staffContent}
                    onChange={e => setStaffContent(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                    rows={4}
                    placeholder="Describe the incident or issue in detail…"
                    data-testid="textarea-staff-content"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Your Contact Number</label>
                  <input
                    type="tel"
                    value={staffContact !== null ? staffContact : (student.phone || "")}
                    onChange={e => setStaffContact(e.target.value)}
                    placeholder="Enter contact number"
                    className="w-full px-3 h-11 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-staff-contact"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Suggestions for Improvement</label>
                  <textarea
                    value={staffSuggestions}
                    onChange={e => setStaffSuggestions(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                    rows={3}
                    placeholder="Any suggestions to prevent this in future…"
                    data-testid="textarea-staff-suggestions"
                  />
                </div>

                <button
                  type="submit"
                  disabled={staffMutation.isPending || teachersLoading}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-[#10b981] hover:bg-[#059669] text-white text-sm font-semibold transition-colors disabled:opacity-60"
                  data-testid="button-submit-staff"
                >
                  {staffMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                  Submit Grievance
                </button>
              </form>
            </div>

            {filedLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[#10b981]" /></div>
            ) : staffGrievances.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide px-1">Your Filed Grievances</h3>
                {staffGrievances.map(c => <FiledCard key={c.id} c={c} />)}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Peer Reports ── */}
        {activeTab === "peer" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-5" data-testid="form-peer-report">
              <h2 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
                <UserX className="w-4 h-4 text-[#10b981]" /> Report Peer Misconduct
              </h2>
              <form onSubmit={handlePeerSubmit} className="space-y-4">

                {/* ── Student Autocomplete Search ── */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Target Student * <span className="font-normal text-gray-400">(search by name or ID)</span>
                  </label>
                  <PeerStudentSearch
                    onSelect={setPeerSelectedStudent}
                    selectedStudent={peerSelectedStudent}
                    onClear={() => setPeerSelectedStudent(null)}
                  />
                </div>

                {/* ── Incident Date & Time ── */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Incident Date &amp; Time <span className="font-normal text-gray-400">(DD/MM/YYYY)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={peerIncidentDate}
                    onChange={e => setPeerIncidentDate(e.target.value)}
                    className="w-full px-3 h-11 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-peer-incident-date"
                  />
                  {/* Show formatted preview once a date is picked */}
                  {peerIncidentDate && (
                    <p className="text-xs text-gray-500 mt-1 pl-1">
                      {fmtDateTimeAmPm(peerIncidentDate)}
                    </p>
                  )}
                </div>

                {/* ── Description ── */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Description of Incident *</label>
                  <textarea
                    value={peerContent}
                    onChange={e => setPeerContent(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                    rows={4}
                    placeholder="Describe what happened, when, and where…"
                    data-testid="textarea-peer-content"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={peerMutation.isPending || !peerSelectedStudent}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-[#10b981] hover:bg-[#059669] text-white text-sm font-semibold transition-colors disabled:opacity-60"
                  data-testid="button-submit-peer"
                >
                  {peerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                  Submit Report
                </button>
              </form>
            </div>

            {/* History */}
            {filedLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[#10b981]" /></div>
            ) : peerReports.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide px-1">Your Filed Peer Reports</h3>
                {peerReports.map(c => <FiledCard key={c.id} c={c} />)}
              </div>
            )}

            {!filedLoading && peerReports.length === 0 && (
              <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-6 flex flex-col items-center gap-2 text-center">
                <UserX className="w-8 h-8 text-gray-200" />
                <p className="text-sm text-gray-400">No peer reports filed yet.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Mobile FAB ── */}
      {(activeTab === "staff" || activeTab === "peer") && (
        <div className="sm:hidden fixed bottom-6 right-5 z-40">
          <button
            onClick={() => {
              const formId = activeTab === "staff" ? "form-staff-grievance" : "form-peer-report";
              document.querySelector(`[data-testid="${formId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="w-14 h-14 rounded-full bg-[#10b981] hover:bg-[#059669] text-white shadow-lg flex items-center justify-center transition-all active:scale-95"
            data-testid="button-fab"
            aria-label="File a complaint"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
