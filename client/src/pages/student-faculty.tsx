import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, UserCheck, Search, GraduationCap, Loader2 } from "lucide-react";
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
  mappedSubject?: string | null;
  designation: string | null;
  qualifications: string | null;
  department: string | null;
  profileImageUrl: string | null;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map(n => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-5 bg-white/80 border border-white/70 shadow-sm animate-pulse">
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full bg-gray-200" />
        <div className="w-full space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto" />
          <div className="h-3 bg-gray-100 rounded w-1/2 mx-auto" />
          <div className="h-3 bg-gray-100 rounded w-2/3 mx-auto" />
          <div className="flex justify-center gap-1 mt-2">
            <div className="h-5 w-16 bg-emerald-50 rounded-full" />
            <div className="h-5 w-16 bg-emerald-50 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function FacultyCard({ member }: { member: FacultyMember }) {
  const [imgError, setImgError] = useState(false);
  const displaySubject = member.mappedSubject || member.subject;
  const subjects = displaySubject
    ? displaySubject.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  return (
    <div
      className="rounded-2xl p-5 bg-white/80 border border-white/70 shadow-sm flex flex-col items-center gap-3 hover:shadow-md transition-shadow"
      data-testid={`card-faculty-${member.id}`}
    >
      {/* Circular avatar */}
      <div className="relative">
        {member.profileImageUrl && !imgError ? (
          <img
            src={normalizeImageUrl(member.profileImageUrl)}
            alt={member.fullName}
            className="w-20 h-20 rounded-full object-cover border-4 border-[#10b981] shadow-sm"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-[#10b981] border-4 border-[#10b981] shadow-sm flex items-center justify-center">
            <span className="text-white font-bold text-xl select-none">{getInitials(member.fullName)}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="text-center flex-1 min-w-0 w-full">
        <p className="text-sm font-bold text-gray-900 leading-tight" data-testid={`text-faculty-name-${member.id}`}>
          {member.fullName}
        </p>
        {member.designation && (
          <p className="text-xs text-gray-500 mt-0.5 font-medium">{member.designation}</p>
        )}
        {member.department && (
          <p className="text-xs text-gray-400 mt-0.5">{member.department}</p>
        )}
        {member.qualifications && (
          <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-snug">{member.qualifications}</p>
        )}

        {/* Subject badges */}
        {subjects.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1 mt-2.5">
            {subjects.map((sub, idx) => (
              <span
                key={idx}
                className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-[#10b981] text-[10px] font-semibold"
              >
                {sub}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function StudentFaculty() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeDept, setActiveDept] = useState("all");

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe | null>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  useEffect(() => {
    if (!studentLoading && !student) {
      setLocation("/student-login");
    }
  }, [studentLoading, student, setLocation]);

  const { data: faculty = [], isLoading: facultyLoading } = useQuery<FacultyMember[]>({
    queryKey: ["/api/student/faculty"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!student,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30000,
  });

  const departments = useMemo(() => {
    const depts = faculty
      .map(f => f.department)
      .filter((d): d is string => d !== null && d !== "");
    return Array.from(new Set(depts)).sort();
  }, [faculty]);

  const filtered = useMemo(() => {
    return faculty.filter(f => {
      const displaySubject = f.mappedSubject || f.subject;
      const matchSearch = !searchQuery.trim() ||
        f.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        displaySubject.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDept = activeDept === "all" || f.department === activeDept;
      return matchSearch && matchDept;
    });
  }, [faculty, searchQuery, activeDept]);

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f8fafc" }}>
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: "#f8fafc" }}>

      {/* ── Decorative blobs ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div style={{ position: "absolute", top: "-120px", right: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", bottom: "-100px", left: "-60px", width: "460px", height: "460px", borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 65%)" }} />
        <div style={{ position: "absolute", top: "38%", left: "28%", width: "360px", height: "360px", borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)" }} />
      </div>

      {/* ── Sticky Header ── */}
      <header
        className="sticky top-0 z-30"
        style={{
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          background: "rgba(255, 255, 255, 0.75)",
          borderBottom: "1px solid rgba(255,255,255,0.7)",
          boxShadow: "0 1px 28px rgba(0,0,0,0.07)",
        }}
      >
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-colors flex-shrink-0"
            style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0" style={{ background: "linear-gradient(135deg, #14b8a6, #3b82f6)" }}>
              <UserCheck className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="font-bold text-sm text-slate-800">Faculty Directory</p>
              <p className="text-[11px] text-slate-400 truncate">{student.schoolName}</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.06)" }}>
            <UserCheck className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-600 text-xs font-semibold">{faculty.length} staff</span>
          </div>
        </div>
      </header>

      {/* ── Search & Department Filter ── */}
      <div className="sticky top-14 z-20 bg-white/80 backdrop-blur-sm border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 py-3 space-y-2.5">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name or subject…"
              className="w-full pl-9 pr-4 h-11 rounded-xl border border-emerald-100 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
              data-testid="input-search-faculty"
            />
          </div>

          {/* Department filter chips */}
          {departments.length > 0 && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
              <button
                onClick={() => setActiveDept("all")}
                className={`flex-shrink-0 px-4 h-11 rounded-full text-xs font-semibold transition-all ${
                  activeDept === "all"
                    ? "bg-[#10b981] text-white"
                    : "bg-white text-gray-600 border border-emerald-100 hover:border-[#10b981] hover:text-[#10b981]"
                }`}
                data-testid="dept-filter-all"
              >
                All Departments
              </button>
              {departments.map(dept => (
                <button
                  key={dept}
                  onClick={() => setActiveDept(dept)}
                  className={`flex-shrink-0 px-4 h-11 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                    activeDept === dept
                      ? "bg-[#10b981] text-white"
                      : "bg-white text-gray-600 border border-emerald-100 hover:border-[#10b981] hover:text-[#10b981]"
                  }`}
                  data-testid={`dept-filter-${dept}`}
                >
                  {dept}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <motion.main
        className="flex-1 max-w-5xl mx-auto w-full px-4 py-5"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >

        {/* ── Loading Skeletons ── */}
        {facultyLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* ── Empty State ── */}
        {!facultyLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-5 text-center">
            <div className="w-24 h-24 rounded-3xl bg-white border border-emerald-100 shadow-sm flex items-center justify-center">
              <GraduationCap className="w-12 h-12 text-emerald-200" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-700">
                {searchQuery || activeDept !== "all" ? "No matches found" : "No Faculty Listed"}
              </h3>
              <p className="text-sm text-gray-400 mt-1 max-w-xs">
                {searchQuery || activeDept !== "all"
                  ? "Try adjusting your search or filter."
                  : `${student.schoolName} hasn't added any faculty profiles here yet.`}
              </p>
            </div>
          </div>
        )}

        {/* ── Faculty Grid ── */}
        {!facultyLoading && filtered.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {filtered.map(member => (
              <FacultyCard key={member.id} member={member} />
            ))}
          </div>
        )}
      </motion.main>
    </div>
  );
}
