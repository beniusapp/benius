import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, UserCheck, Search, GraduationCap, Loader2,
  Phone, BookOpen, X, Users, Award, Building2,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

function normalizeImageUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//")) return url;
  return `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface StudentMe {
  id: number;
  name: string;
  digitalStudentId: string;
  class: string;
  section: string;
  schoolName: string;
  schoolCode: string;
}

interface FacultyMember {
  id: number;
  fullName: string;
  subject: string;
  phone: string;
  assignedClass: string;
  assignedSection: string;
  designation: string | null;
  qualifications: string | null;
  department: string | null;
  profileImageUrl: string | null;
  mappings: { className: string; section: string; subject: string | null }[];
}

function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
}

function getAvatarColor(name: string): string {
  const colors = [
    "#10b981", "#3b82f6", "#8b5cf6", "#f59e0b",
    "#ef4444", "#06b6d4", "#ec4899", "#14b8a6",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function getUniqueSubjects(member: FacultyMember): string[] {
  const subjects = new Set<string>();
  member.mappings.forEach(m => { if (m.subject) m.subject.split(",").forEach(s => { const t = s.trim(); if (t) subjects.add(t); }); });
  if (member.subject) member.subject.split(",").forEach(s => { const t = s.trim(); if (t) subjects.add(t); });
  return Array.from(subjects);
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-4 bg-white border border-gray-100 shadow-sm animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-14 h-14 rounded-full bg-gray-200 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-gray-100 rounded w-full" />
        <div className="flex gap-1">
          <div className="h-5 w-14 bg-emerald-50 rounded-full" />
          <div className="h-5 w-14 bg-emerald-50 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function FacultyCard({ member, onClick }: { member: FacultyMember; onClick: () => void }) {
  const [imgError, setImgError] = useState(false);
  const subjects = getUniqueSubjects(member);
  const color = getAvatarColor(member.fullName);
  const classes = member.mappings.filter(m => m.className).map(m => `${m.className}-${m.section}`);
  const uniqueClasses = Array.from(new Set(classes)).slice(0, 3);

  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="rounded-2xl p-4 bg-white border border-gray-100 shadow-sm active:shadow-md transition-shadow cursor-pointer"
      data-testid={`card-faculty-${member.id}`}
    >
      {/* Avatar + Name row */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-shrink-0 relative">
          {member.profileImageUrl && !imgError ? (
            <img
              src={normalizeImageUrl(member.profileImageUrl)}
              alt={member.fullName}
              className="w-14 h-14 rounded-full object-cover border-2"
              style={{ borderColor: color }}
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center border-2"
              style={{ background: color, borderColor: color }}
            >
              <span className="text-white font-bold text-lg select-none">{getInitials(member.fullName)}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm text-gray-900 leading-tight truncate" data-testid={`text-faculty-name-${member.id}`}>
            {member.fullName}
          </p>
          {member.designation ? (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{member.designation}</p>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5">Faculty</p>
          )}
          {member.phone && (
            <div className="flex items-center gap-1 mt-1">
              <Phone className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <span className="text-[11px] text-gray-500 font-medium">{member.phone}</span>
            </div>
          )}
        </div>
      </div>

      {/* Subjects */}
      {subjects.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {subjects.slice(0, 3).map((sub, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: `${color}15`, color }}
            >
              <BookOpen className="w-2.5 h-2.5" />
              {sub}
            </span>
          ))}
          {subjects.length > 3 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">
              +{subjects.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Classes */}
      {uniqueClasses.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {uniqueClasses.map((cls, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600">
              Class {cls}
            </span>
          ))}
          {classes.length > 3 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-400">
              +{Array.from(new Set(classes)).length - 3} more
            </span>
          )}
        </div>
      )}

      <p className="text-[10px] text-gray-400 mt-2 text-right">Tap for details →</p>
    </motion.div>
  );
}

function DetailModal({ member, onClose }: { member: FacultyMember; onClose: () => void }) {
  const [imgError, setImgError] = useState(false);
  const subjects = getUniqueSubjects(member);
  const color = getAvatarColor(member.fullName);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />

        {/* Sheet */}
        <motion.div
          className="relative z-10 w-full max-w-md mx-auto bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
        >
          {/* Banner */}
          <div className="h-24 w-full" style={{ background: `linear-gradient(135deg, ${color}cc, ${color}66)` }} />

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/20 flex items-center justify-center"
            data-testid="button-close-faculty-modal"
          >
            <X className="w-4 h-4 text-white" />
          </button>

          {/* Avatar overlapping banner */}
          <div className="px-6 -mt-12">
            <div className="w-24 h-24 rounded-full border-4 border-white shadow-lg overflow-hidden flex-shrink-0"
              style={{ background: color }}>
              {member.profileImageUrl && !imgError ? (
                <img
                  src={normalizeImageUrl(member.profileImageUrl)}
                  alt={member.fullName}
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-white font-bold text-3xl select-none">{getInitials(member.fullName)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="px-6 pb-8 pt-3 max-h-[65vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900">{member.fullName}</h2>
            {member.designation && (
              <p className="text-sm text-gray-500 mt-0.5 font-medium">{member.designation}</p>
            )}

            <div className="mt-4 space-y-3">

              {/* Phone */}
              {member.phone && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
                  <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Contact</p>
                    <p className="text-sm font-semibold text-gray-800">{member.phone}</p>
                  </div>
                </div>
              )}

              {/* Subjects */}
              {subjects.length > 0 && (
                <div className="p-3 rounded-xl bg-gray-50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <BookOpen className="w-4 h-4 text-purple-600" />
                    </div>
                    <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Subjects</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 ml-11">
                    {subjects.map((sub, i) => (
                      <span
                        key={i}
                        className="px-3 py-1 rounded-full text-xs font-semibold"
                        style={{ background: `${color}15`, color }}
                      >
                        {sub}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Class Assignments */}
              {member.mappings.filter(m => m.className).length > 0 && (
                <div className="p-3 rounded-xl bg-gray-50">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Users className="w-4 h-4 text-blue-600" />
                    </div>
                    <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Classes Taught</p>
                  </div>
                  <div className="space-y-1.5 ml-11">
                    {member.mappings.filter(m => m.className).map((m, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">Class {m.className} – {m.section}</span>
                        {m.subject && (
                          <span className="text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
                            {m.subject}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Qualifications */}
              {member.qualifications && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50">
                  <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Award className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Qualifications</p>
                    <p className="text-sm text-gray-700 mt-0.5">{member.qualifications}</p>
                  </div>
                </div>
              )}

              {/* Department */}
              {member.department && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
                  <div className="w-9 h-9 rounded-full bg-teal-100 flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Department</p>
                    <p className="text-sm font-semibold text-gray-800">{member.department}</p>
                  </div>
                </div>
              )}

              {/* No extra details message */}
              {!member.phone && subjects.length === 0 && member.mappings.filter(m => m.className).length === 0 && !member.qualifications && !member.department && (
                <p className="text-sm text-gray-400 text-center py-4">No additional details available.</p>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function StudentFaculty() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<FacultyMember | null>(null);

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) setLocation("/student-login");
  }, [studentLoading, student, setLocation]);

  const { data: faculty = [], isLoading: facultyLoading } = useQuery<FacultyMember[]>({
    queryKey: ["/api/student/faculty"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!student,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30000,
  });

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return faculty;
    const q = searchQuery.toLowerCase();
    return faculty.filter(f => {
      const subjects = getUniqueSubjects(f).join(" ").toLowerCase();
      return f.fullName.toLowerCase().includes(q) || subjects.includes(q) ||
        (f.designation ?? "").toLowerCase().includes(q) ||
        (f.department ?? "").toLowerCase().includes(q);
    });
  }, [faculty, searchQuery]);

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: "#f8fafc" }}>

      {/* Decorative blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
      </div>

      {/* Sticky Header */}
      <header
        className="sticky top-0 z-30"
        style={{
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          background: "rgba(255,255,255,0.85)",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          boxShadow: "0 1px 20px rgba(0,0,0,0.06)",
        }}
      >
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-colors flex-shrink-0"
            style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #14b8a6, #3b82f6)" }}>
              <UserCheck className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="font-bold text-sm text-slate-800">Faculty Directory</p>
              <p className="text-[11px] text-slate-400 truncate">{student.schoolName}</p>
            </div>
          </div>
          <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full flex-shrink-0">
            {faculty.length} staff
          </span>
        </div>
      </header>

      {/* Search bar */}
      <div className="sticky top-14 z-20 bg-white/80 backdrop-blur-sm border-b border-slate-100">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, subject or department…"
              className="w-full pl-9 pr-4 h-11 rounded-xl border border-emerald-100 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
              data-testid="input-search-faculty"
            />
          </div>
        </div>
      </div>

      <motion.main
        className="flex-1 max-w-2xl mx-auto w-full px-4 py-5"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {facultyLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {!facultyLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <div className="w-20 h-20 rounded-3xl bg-white border border-emerald-100 shadow-sm flex items-center justify-center">
              <GraduationCap className="w-10 h-10 text-emerald-200" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-700">
                {searchQuery ? "No matches found" : "No Faculty Listed"}
              </h3>
              <p className="text-sm text-gray-400 mt-1 max-w-xs">
                {searchQuery ? "Try a different name or subject." : `${student.schoolName} hasn't added any faculty profiles yet.`}
              </p>
            </div>
          </div>
        )}

        {!facultyLoading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map(member => (
              <FacultyCard
                key={member.id}
                member={member}
                onClick={() => setSelectedMember(member)}
              />
            ))}
          </div>
        )}
      </motion.main>

      {/* Detail Modal */}
      {selectedMember && (
        <DetailModal member={selectedMember} onClose={() => setSelectedMember(null)} />
      )}
    </div>
  );
}
