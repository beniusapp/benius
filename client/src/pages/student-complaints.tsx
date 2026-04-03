import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  ArrowLeft, Mail, ShieldAlert, UserX, Loader2,
  AlertTriangle, CheckCircle, Clock, Plus, Lock, ChevronDown, ChevronUp,
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
}

interface TeacherOption {
  id: number;
  name: string;
  subject: string;
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
  createdAt: string;
}

type TabId = "inbox" | "staff" | "peer";

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    "Pending":              { label: "Pending",              cls: "bg-amber-50  text-amber-700  border-amber-200"  },
    "Investigating":        { label: "Under Investigation",  cls: "bg-blue-50   text-blue-700   border-blue-200"   },
    "Resolved":             { label: "Resolved",             cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  };
  const s = cfg[status] ?? { label: status, cls: "bg-gray-50 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${s.cls}`}>
      {status === "Resolved" ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {s.label}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
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
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(c.createdAt)} · #{c.ticketId}</p>
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
          <p className="text-xs text-gray-400">#{c.ticketId} · {formatDate(c.createdAt)}</p>
          {c.complaintType === "student-to-staff" && c.teacherName && (
            <p className="text-sm font-semibold text-gray-700 mt-0.5">Against: {c.teacherName}</p>
          )}
          {c.complaintType === "student-peer-report" && c.reportedStudentName && (
            <p className="text-sm font-semibold text-gray-700 mt-0.5">Reported: {c.reportedStudentName}</p>
          )}
        </div>
        <StatusBadge status={c.status} />
      </div>
      <p className="text-sm text-gray-600 mt-2 line-clamp-2">{c.content}</p>
    </div>
  );
}

export default function StudentComplaints() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>("inbox");
  const [showFabForm, setShowFabForm] = useState(false);

  const [staffTeacherId, setStaffTeacherId] = useState("");
  const [staffContent, setStaffContent] = useState("");
  const [staffContact, setStaffContact] = useState("");
  const [staffSuggestions, setStaffSuggestions] = useState("");

  const [peerName, setPeerName] = useState("");
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
      setStaffTeacherId(""); setStaffContent(""); setStaffSuggestions("");
      setShowFabForm(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const peerMutation = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/student/complaints/peer-report", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/complaints/filed"] });
      toast({ title: "Report submitted", description: "Your peer report has been filed." });
      setPeerName(""); setPeerIncidentDate(""); setPeerContent("");
      setShowFabForm(false);
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
      contactNumber: staffContact || student.phone,
      suggestions: staffSuggestions,
    });
  };

  const handlePeerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerName.trim() || !peerContent.trim()) {
      toast({ title: "Missing fields", description: "Please fill in the required fields.", variant: "destructive" });
      return;
    }
    peerMutation.mutate({
      reportedStudentName: peerName,
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
              onClick={() => { setActiveTab(id); setShowFabForm(false); }}
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
            {/* Confidentiality notice */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
              <Lock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-blue-800">Direct to Principal — Strictly Confidential</p>
                <p className="text-xs text-blue-600 mt-0.5">Your complaint is sent directly to the Principal only. The staff member you are reporting will have no access to this record.</p>
              </div>
            </div>

            {/* Submission form */}
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
                    value={staffContact}
                    onChange={e => setStaffContact(e.target.value)}
                    placeholder={student.phone || "Enter contact number"}
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

            {/* History */}
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
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Target Student Name / ID *</label>
                  <input
                    type="text"
                    value={peerName}
                    onChange={e => setPeerName(e.target.value)}
                    placeholder="Enter student name or school ID"
                    className="w-full px-3 h-11 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-peer-name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Incident Date & Time</label>
                  <input
                    type="datetime-local"
                    value={peerIncidentDate}
                    onChange={e => setPeerIncidentDate(e.target.value)}
                    className="w-full px-3 h-11 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    data-testid="input-peer-incident-date"
                  />
                </div>

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
                  disabled={peerMutation.isPending}
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
              setShowFabForm(v => !v);
              const formId = activeTab === "staff" ? "form-staff-grievance" : "form-peer-report";
              setTimeout(() => {
                document.querySelector(`[data-testid="${formId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 100);
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
