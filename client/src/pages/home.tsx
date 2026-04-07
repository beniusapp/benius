import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Shield, BookOpen, GraduationCap, Zap, Lock, Globe } from "lucide-react";

/* ── Portal card data ─────────────────────────────────────────────── */
const portals = [
  {
    href: "/login",
    testId: "link-portal-admin",
    label: "ADMINISTRATION",
    title: "The Command Center",
    description: "Secure operations, faculty mapping, and global school oversight.",
    Icon: Shield,
    iconBg: "bg-blue-500/20",
    iconColor: "text-blue-400",
    borderHover: "hover:border-blue-500/40",
    glowColor: "#3b82f6",
    badge: "Admin Portal",
    badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  {
    href: "/teacher-login",
    testId: "link-portal-teacher",
    label: "TEACHERS",
    title: "The Classroom Hub",
    description: "Manage your schedule, track student growth, and resolve classroom peer reports.",
    Icon: BookOpen,
    iconBg: "bg-emerald-500/20",
    iconColor: "text-emerald-400",
    borderHover: "hover:border-emerald-500/40",
    glowColor: "#10b981",
    badge: "Teacher Portal",
    badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  {
    href: "/student-login",
    testId: "link-portal-student",
    label: "STUDENTS",
    title: "The Learning Path",
    description: "View your daily timetable, track your attendance, and access your profile.",
    Icon: GraduationCap,
    iconBg: "bg-violet-500/20",
    iconColor: "text-violet-400",
    borderHover: "hover:border-violet-500/40",
    glowColor: "#8b5cf6",
    badge: "Student Portal",
    badgeColor: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  },
] as const;

/* ── Portal card component ────────────────────────────────────────── */
function PortalCard({
  portal,
  animDelay,
}: {
  portal: (typeof portals)[number];
  animDelay: number;
}) {
  const [glow, setGlow] = useState({ x: 50, y: 50, visible: false });

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setGlow({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
  }

  const {
    href,
    testId,
    label,
    title,
    description,
    Icon,
    iconBg,
    iconColor,
    borderHover,
    glowColor,
    badge,
    badgeColor,
  } = portal;

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: animDelay }}
    >
      <Link href={href} data-testid={testId}>
        <motion.div
          onMouseMove={onMouseMove}
          onMouseLeave={() => setGlow((g) => ({ ...g, visible: false }))}
          whileHover={{ scale: 1.03, y: -4 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className={`relative rounded-2xl border border-white/10 ${borderHover} overflow-hidden cursor-pointer min-h-[240px] p-7 flex flex-col gap-5 transition-colors duration-300`}
          style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(12px)" }}
        >
          {/* Mouse-tracking glow layer */}
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-500"
            style={{
              opacity: glow.visible ? 1 : 0,
              background: `radial-gradient(circle 180px at ${glow.x}px ${glow.y}px, ${glowColor}22, transparent 70%)`,
            }}
          />

          {/* Top: Icon + badge */}
          <div className="flex items-start justify-between">
            <div
              className={`w-12 h-12 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}
            >
              <Icon className={`w-6 h-6 ${iconColor}`} />
            </div>
            <span
              className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${badgeColor}`}
            >
              {badge}
            </span>
          </div>

          {/* Label */}
          <p className="text-[10px] font-bold tracking-[0.2em] text-white/30 uppercase">
            {label}
          </p>

          {/* Content */}
          <div className="space-y-2 mt-auto">
            <h3 className="text-lg font-bold text-white leading-tight">{title}</h3>
            <p className="text-sm text-white/50 leading-relaxed">{description}</p>
          </div>

          {/* Enter arrow */}
          <div className={`flex items-center gap-1.5 text-xs font-semibold ${iconColor} mt-1`}>
            <span>Enter Portal</span>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
              />
            </svg>
          </div>
        </motion.div>
      </Link>
    </motion.div>
  );
}

/* ── Main page ────────────────────────────────────────────────────── */
export default function Home() {
  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{ background: "#0f172a" }}
    >
      {/* ── CSS Keyframe styles ── */}
      <style>{`
        @keyframes aura-drift-1 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          33%       { transform: translate(60px, -80px) scale(1.15); }
          66%       { transform: translate(-40px, 40px) scale(0.9); }
        }
        @keyframes aura-drift-2 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          33%       { transform: translate(-70px, 50px) scale(1.1); }
          66%       { transform: translate(50px, -60px) scale(0.95); }
        }
        @keyframes aura-drift-3 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          50%       { transform: translate(40px, 70px) scale(1.2); }
        }
        .aura-1 { animation: aura-drift-1 18s ease-in-out infinite; }
        .aura-2 { animation: aura-drift-2 22s ease-in-out infinite; }
        .aura-3 { animation: aura-drift-3 26s ease-in-out infinite; }
        .text-gradient-hero {
          background: linear-gradient(135deg, #10b981 0%, #3b82f6 50%, #8b5cf6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      `}</style>

      {/* ── Background aura orbs ── */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="aura-1 absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full opacity-30"
          style={{
            background: "radial-gradient(circle, #10b98140 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="aura-2 absolute top-[10%] right-[-15%] w-[700px] h-[700px] rounded-full opacity-20"
          style={{
            background: "radial-gradient(circle, #3b82f640 0%, transparent 70%)",
            filter: "blur(80px)",
          }}
        />
        <div
          className="aura-3 absolute bottom-[-20%] left-[30%] w-[500px] h-[500px] rounded-full opacity-25"
          style={{
            background: "radial-gradient(circle, #8b5cf640 0%, transparent 70%)",
            filter: "blur(70px)",
          }}
        />
        {/* Subtle dot grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {/* ── Header ── */}
      <header
        className="relative z-10 border-b border-white/5"
        style={{ background: "rgba(15,23,42,0.8)", backdropFilter: "blur(12px)" }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #10b981, #3b82f6)" }}
            >
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-xl font-black tracking-tight text-white"
                data-testid="text-app-title"
              >
                BENIUS
              </span>
              <span className="text-xs text-white/30 font-medium hidden sm:inline">
                School Management
              </span>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/5">
            <Lock className="w-3 h-3 text-emerald-400" />
            <span className="text-xs text-white/50 font-medium">Secure · Multi-Tenant</span>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-20">
        <div className="max-w-5xl w-full mx-auto">

          {/* Hero */}
          <div className="text-center mb-16 space-y-6">
            {/* Eyebrow pill */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-emerald-500/30 bg-emerald-500/10"
            >
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-400 tracking-wider uppercase">
                Next-Gen School Platform
              </span>
            </motion.div>

            {/* Main heading */}
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              data-testid="text-hero-title"
              className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight text-white"
            >
              The Future of School
              <br />
              <span className="text-gradient-hero">Management, Simplified.</span>
            </motion.h1>

            {/* Subheading */}
            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
              data-testid="text-hero-sub"
              className="text-lg sm:text-xl text-white/50 max-w-2xl mx-auto leading-relaxed"
            >
              Empowering{" "}
              <span className="text-white/80 font-semibold">10,000+ minds</span> with
              real-time attendance, smart timetables, and secure administration.
            </motion.p>
          </div>

          {/* Portal cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {portals.map((portal, i) => (
              <PortalCard key={portal.href} portal={portal} animDelay={0.3 + i * 0.1} />
            ))}
          </div>

          {/* Bottom hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="text-center text-xs text-white/25 mt-10"
          >
            Contact your school administrator for access credentials.
          </motion.p>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/5 py-5">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-white/20" />
            <p className="text-xs text-white/30 font-medium">
              BENIUS: Multi-Tenant Secure Infrastructure
            </p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-white/20">© {new Date().getFullYear()} BENIUS</span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-emerald-500/70 font-medium">
                All Systems Operational
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
