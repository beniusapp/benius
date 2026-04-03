import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, UserCheck, Search, GraduationCap, Loader2 } from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";

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
    <div className="bg-white rounded-2xl border border-emerald-50 shadow-sm p-5 animate-pulse">
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
  const subjects = member.subject
    ? member.subject.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  return (
    <div
      className="bg-white rounded-2xl border border-emerald-50 shadow-sm p-5 flex flex-col items-center gap-3 hover:shadow-md transition-shadow"
      data-testid={`card-faculty-${member.id}`}
    >
      {/* Circular avatar */}
      <div className="relative">
        {member.profileImageUrl && !imgError ? (
          <img
            src={member.profileImageUrl}
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

  const { data: student, isLoading: studentLoading } = useQuery<StudentMe>({
    queryKey: ["/api/student-me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: faculty = [], isLoading: facultyLoading } = useQuery<FacultyMember[]>({
    queryKey: ["/api/student/faculty"],
    enabled: !!student,
  });

  const departments = useMemo(() => {
    const depts = faculty
      .map(f => f.department)
      .filter((d): d is string => d !== null && d !== "");
    return Array.from(new Set(depts)).sort();
  }, [faculty]);

  const filtered = useMemo(() => {
    return faculty.filter(f => {
      const matchSearch = !searchQuery.trim() ||
        f.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.subject.toLowerCase().includes(searchQuery.toLowerCase());
      const matchDept = activeDept === "all" || f.department === activeDept;
      return matchSearch && matchDept;
    });
  }, [faculty, searchQuery, activeDept]);

  if (studentLoading || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0fdf4]">
        <Loader2 className="w-9 h-9 animate-spin text-[#10b981]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fdf4] flex flex-col">

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-30 bg-[#10b981] shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setLocation("/student-dashboard")}
            className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors flex-shrink-0"
            data-testid="button-back"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm leading-tight">Faculty Directory</p>
            <p className="text-emerald-100 text-xs">{student.schoolName}</p>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/20">
            <UserCheck className="w-3.5 h-3.5 text-white" />
            <span className="text-white text-xs font-semibold">{faculty.length} staff</span>
          </div>
        </div>
      </header>

      {/* ── Search & Department Filter ── */}
      <div className="sticky top-[60px] z-20 bg-[#f0fdf4]/90 backdrop-blur-sm border-b border-emerald-100">
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

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-5">

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
      </main>
    </div>
  );
}
