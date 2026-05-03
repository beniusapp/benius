import { useState, useRef, type MouseEvent } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Shield, BookOpen, GraduationCap, ArrowRight } from "lucide-react";

const portals = [
  {
    href: "/login",
    testId: "link-portal-admin",
    label: "ADMINISTRATION",
    title: "The Command Center",
    description: "Secure ops, faculty mapping & global school oversight.",
    Icon: Shield,
    accentFrom: "#6366f1",
    accentTo: "#818cf8",
    glowColor: "#6366f1",
    glowColorHex: "99,102,241",
    badge: "Admin Portal",
    borderColor: "rgba(99,102,241,0.25)",
    borderHoverColor: "rgba(99,102,241,0.65)",
    orb1: "#6366f1",
    orb2: "#4f46e5",
  },
  {
    href: "/teacher-login",
    testId: "link-portal-teacher",
    label: "EDUCATORS",
    title: "The Classroom Hub",
    description: "Track student growth, manage schedules & resolve reports.",
    Icon: BookOpen,
    accentFrom: "#14b8a6",
    accentTo: "#2dd4bf",
    glowColor: "#14b8a6",
    glowColorHex: "20,184,166",
    badge: "Teacher Portal",
    borderColor: "rgba(20,184,166,0.25)",
    borderHoverColor: "rgba(20,184,166,0.65)",
    orb1: "#14b8a6",
    orb2: "#0d9488",
  },
  {
    href: "/student-login",
    testId: "link-portal-student",
    label: "STUDENTS",
    title: "The Learning Path",
    description: "View timetables, track attendance & access your profile.",
    Icon: GraduationCap,
    accentFrom: "#8b5cf6",
    accentTo: "#a78bfa",
    glowColor: "#8b5cf6",
    glowColorHex: "139,92,246",
    badge: "Student Portal",
    borderColor: "rgba(139,92,246,0.25)",
    borderHoverColor: "rgba(139,92,246,0.65)",
    orb1: "#8b5cf6",
    orb2: "#7c3aed",
  },
] as const;

function PortalCard({ portal, index }: { portal: (typeof portals)[number]; index: number }) {
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });
  const [glow, setGlow] = useState({ x: 50, y: 50, visible: false });
  const [hovered, setHovered] = useState(false);
  const [magnetXY, setMagnetXY] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const magnetRef = useRef<HTMLDivElement>(null);

  function onMouseMove(e: MouseEvent<HTMLDivElement>) {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    setGlow({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });

    const dx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    setTilt({ rotateX: -dy * 10, rotateY: dx * 10 });

    const magEl = magnetRef.current;
    if (magEl) {
      const mr = magEl.getBoundingClientRect();
      const mcx = mr.left + mr.width / 2;
      const mcy = mr.top + mr.height / 2;
      const dist = Math.hypot(e.clientX - mcx, e.clientY - mcy);
      if (dist < 80) {
        setMagnetXY({ x: (e.clientX - mcx) * 0.45, y: (e.clientY - mcy) * 0.45 });
      } else {
        setMagnetXY({ x: 0, y: 0 });
      }
    }
  }

  function onMouseLeave() {
    setGlow(g => ({ ...g, visible: false }));
    setHovered(false);
    setTilt({ rotateX: 0, rotateY: 0 });
    setMagnetXY({ x: 0, y: 0 });
  }

  const { href, testId, label, title, description, Icon, accentTo, glowColor, glowColorHex, badge, borderColor, borderHoverColor, orb1, orb2 } = portal;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.82 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 18, delay: 0.3 + index * 0.1 }}
      style={{ perspective: "900px" }}
      className="min-h-0"
    >
      <Link href={href} data-testid={testId}>
        {/* ── Desktop card (hidden on mobile) ── */}
        <motion.div
          ref={cardRef}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onMouseEnter={() => setHovered(true)}
          animate={{ rotateX: tilt.rotateX, rotateY: tilt.rotateY, scale: hovered ? 1.03 : 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 22 }}
          className="hidden sm:flex relative rounded-2xl overflow-hidden cursor-pointer p-5 flex-col gap-3 h-full"
          style={{
            transformStyle: "preserve-3d",
            background: "rgba(255,255,255,0.045)",
            backdropFilter: "blur(25px)",
            WebkitBackdropFilter: "blur(25px)",
            border: `1px solid ${hovered ? borderHoverColor : borderColor}`,
            boxShadow: hovered
              ? `0 0 48px 0 ${glowColor}38, 0 24px 64px -12px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.1)`
              : `0 8px 32px -4px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)`,
            transition: "border-color 0.3s, box-shadow 0.3s",
          }}
        >
          {/* Cursor glow */}
          <div className="absolute inset-0 pointer-events-none" style={{
            opacity: glow.visible ? 1 : 0,
            background: `radial-gradient(circle 180px at ${glow.x}px ${glow.y}px, ${glowColor}30, transparent 70%)`,
            transition: "opacity 0.35s",
          }} />
          {/* Top edge glow line */}
          <div className="absolute inset-x-0 top-0 h-px pointer-events-none"
            style={{ background: `linear-gradient(90deg, transparent, ${glowColor}70, transparent)` }} />

          {/* Icon orb + badge */}
          <div className="flex items-start justify-between gap-2">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{
                background: `linear-gradient(145deg, ${orb1}ee, ${orb2}bb)`,
                boxShadow: `0 10px 28px ${glowColor}55, inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.22)`,
              }}>
              <Icon className="w-8 h-8 text-white drop-shadow-lg" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border flex-shrink-0"
              style={{
                background: `rgba(${glowColorHex},0.12)`,
                borderColor: `rgba(${glowColorHex},0.28)`,
                color: accentTo,
              }}>
              {badge}
            </span>
          </div>

          {/* Label */}
          <p className="text-[9px] font-bold tracking-[0.22em] uppercase" style={{ color: accentTo }}>{label}</p>

          {/* Title + description */}
          <div className="flex-1 min-h-0 space-y-1.5">
            <h3 className="text-base font-bold text-white leading-snug">{title}</h3>
            <p className="text-xs text-white/65 leading-relaxed line-clamp-2">{description}</p>
          </div>

          {/* Magnetic Enter Portal */}
          <motion.div
            ref={magnetRef}
            animate={{ x: magnetXY.x, y: magnetXY.y }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: accentTo }}
          >
            <span>Enter Portal</span>
            <motion.div animate={hovered ? { x: 4 } : { x: 0 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
              <ArrowRight className="w-3.5 h-3.5" />
            </motion.div>
          </motion.div>
        </motion.div>

        {/* ── Mobile strip (visible only on mobile) ── */}
        <motion.div
          whileTap={{ scale: 0.97 }}
          className="sm:hidden relative flex items-center gap-4 px-4 py-3.5 rounded-2xl overflow-hidden cursor-pointer"
          style={{
            background: "rgba(255,255,255,0.05)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: `1px solid ${borderColor}`,
            boxShadow: "0 4px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* Left accent bar */}
          <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full" style={{ background: `linear-gradient(to bottom, ${orb1}, ${orb2})` }} />

          {/* Icon */}
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: `linear-gradient(145deg, ${orb1}ee, ${orb2}bb)`,
              boxShadow: `0 6px 18px ${glowColor}50`,
            }}>
            <Icon className="w-5 h-5 text-white" />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold tracking-[0.18em] uppercase mb-0.5" style={{ color: accentTo }}>{label}</p>
            <p className="text-sm font-bold text-white leading-none truncate">{title}</p>
          </div>

          {/* Arrow */}
          <div className="flex items-center gap-1 text-xs font-semibold flex-shrink-0" style={{ color: accentTo }}>
            <span className="hidden xs:inline text-[11px]">Enter</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </motion.div>
      </Link>
    </motion.div>
  );
}

export default function Home() {
  return (
    <div
      className="flex flex-col relative overflow-hidden"
      style={{ height: "100dvh", minHeight: "100vh", background: "#080c14" }}
    >
      {/* ── CSS keyframes ── */}
      <style>{`
        @keyframes mesh-drift-1 {
          0%,100% { transform: translate(0,0) scale(1); }
          25%      { transform: translate(70px,-90px) scale(1.18); }
          50%      { transform: translate(-55px,55px) scale(0.87); }
          75%      { transform: translate(35px,75px) scale(1.1); }
        }
        @keyframes mesh-drift-2 {
          0%,100% { transform: translate(0,0) scale(1); }
          33%      { transform: translate(-85px,65px) scale(1.14); }
          66%      { transform: translate(65px,-75px) scale(0.9); }
        }
        @keyframes mesh-drift-3 {
          0%,100% { transform: translate(0,0) scale(1); }
          40%      { transform: translate(45px,85px) scale(1.22); }
          80%      { transform: translate(-75px,-38px) scale(0.91); }
        }
        @keyframes geo-spin-1 {
          0%,100% { transform: translate(0,0) rotate(0deg); }
          50%      { transform: translate(-18px,28px) rotate(180deg); }
        }
        @keyframes geo-spin-2 {
          0%,100% { transform: translate(0,0) rotate(30deg); }
          50%      { transform: translate(22px,-18px) rotate(210deg); }
        }
        @keyframes glow-pulse {
          0%,100% { box-shadow: 0 0 18px 3px rgba(99,102,241,0.38), 0 0 36px 6px rgba(20,184,166,0.18); }
          50%      { box-shadow: 0 0 30px 7px rgba(99,102,241,0.58), 0 0 55px 14px rgba(20,184,166,0.32); }
        }
        @keyframes dot-glow {
          0%,100% { box-shadow: 0 0 5px 2px rgba(52,211,153,0.55); }
          50%      { box-shadow: 0 0 9px 4px rgba(52,211,153,0.85); }
        }
        .mesh-1 { animation: mesh-drift-1 26s ease-in-out infinite; will-change: transform; }
        .mesh-2 { animation: mesh-drift-2 32s ease-in-out infinite; will-change: transform; }
        .mesh-3 { animation: mesh-drift-3 22s ease-in-out infinite; will-change: transform; }
        .mesh-4 { animation: mesh-drift-1 38s ease-in-out infinite; animation-delay: -10s; will-change: transform; }
        .geo-1  { animation: geo-spin-1 30s ease-in-out infinite; }
        .geo-2  { animation: geo-spin-2 24s ease-in-out infinite; }
        .status-dot { animation: dot-glow 2.2s ease-in-out infinite; }
        .text-gradient-hero {
          background: linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #6366f1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .navbar-glass {
          background: rgba(8,12,20,0.72);
          backdrop-filter: blur(22px);
          -webkit-backdrop-filter: blur(22px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
      `}</style>

      {/* ── Background ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="mesh-1 absolute top-[-22%] left-[-14%] w-[680px] h-[680px] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, #6366f158 0%, transparent 65%)", filter: "blur(78px)" }} />
        <div className="mesh-2 absolute top-[3%] right-[-18%] w-[760px] h-[760px] rounded-full opacity-28"
          style={{ background: "radial-gradient(circle, #06b6d448 0%, transparent 65%)", filter: "blur(88px)" }} />
        <div className="mesh-3 absolute bottom-[-22%] left-[18%] w-[580px] h-[580px] rounded-full opacity-33"
          style={{ background: "radial-gradient(circle, #8b5cf658 0%, transparent 65%)", filter: "blur(78px)" }} />
        <div className="mesh-4 absolute top-[38%] left-[52%] w-[380px] h-[380px] rounded-full opacity-18"
          style={{ background: "radial-gradient(circle, #14b8a642 0%, transparent 65%)", filter: "blur(58px)" }} />
        <div className="absolute inset-0 opacity-[0.028]"
          style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.9) 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
        <div className="geo-1 absolute top-[20%] left-[7%] w-20 h-20 rounded-3xl opacity-[0.055]"
          style={{ background: "linear-gradient(135deg,#6366f1,#06b6d4)", border: "1px solid rgba(255,255,255,0.14)" }} />
        <div className="geo-2 absolute bottom-[22%] right-[9%] w-14 h-14 rounded-full opacity-[0.065]"
          style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)", border: "1px solid rgba(255,255,255,0.11)" }} />
      </div>

      {/* ── Navbar ── */}
      <header className="navbar-glass relative z-50 flex-shrink-0">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#6366f1,#06b6d4)", boxShadow: "0 0 14px rgba(99,102,241,0.45)" }}>
              <GraduationCap className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-black tracking-tight text-white" data-testid="text-app-title">BENIUS</span>
              <span className="text-[11px] text-white/55 font-medium hidden sm:inline">School Management</span>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ border: "1px solid rgba(52,211,153,0.25)", background: "rgba(52,211,153,0.07)" }}>
            <span className="status-dot w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
            <span className="text-[11px] text-emerald-400 font-semibold tracking-wide">System Status: Operational</span>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="relative z-10 flex-1 min-h-0 flex flex-col items-center justify-center px-4 sm:px-6 py-3 sm:py-4">
        <div className="w-full max-w-5xl flex flex-col gap-4 sm:gap-5 min-h-0">

          {/* Hero */}
          <div className="text-center space-y-2 sm:space-y-3 flex-shrink-0">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full"
              style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.28)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0"
                style={{ boxShadow: "0 0 5px rgba(129,140,248,0.9)" }} />
              <span className="text-[10px] sm:text-xs font-semibold text-indigo-300 tracking-wider uppercase">
                Next-Gen EdTech Platform
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: -28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.07 }}
              data-testid="text-hero-title"
              className="font-black tracking-tight leading-[1.09] text-white"
              style={{ fontSize: "clamp(1.75rem, 5vw, 3.5rem)" }}
            >
              The Future of School
              <br />
              <span className="text-gradient-hero">Management, Simplified.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.16 }}
              data-testid="text-hero-sub"
              className="text-white/70 max-w-xl mx-auto leading-relaxed hidden sm:block"
              style={{ fontSize: "clamp(0.8rem, 1.4vw, 1rem)" }}
            >
              Empowering <span className="text-white/90 font-semibold">10,000+ minds</span> with real-time
              attendance, smart timetables, and secure administration.
            </motion.p>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.26 }}
              className="flex justify-center"
            >
              <Link href="/login">
                <motion.button
                  data-testid="button-cta-explore"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 350, damping: 20 }}
                  className="relative px-6 py-2 rounded-full text-xs font-bold text-white tracking-wide flex items-center gap-2"
                  style={{
                    background: "linear-gradient(135deg, #6366f1, #06b6d4)",
                    boxShadow: "0 0 20px 4px rgba(99,102,241,0.35), 0 0 40px 8px rgba(6,182,212,0.18)",
                  }}
                >
                  Explore Portals
                  <ArrowRight className="w-3.5 h-3.5" />
                </motion.button>
              </Link>
            </motion.div>
          </div>

          {/* Portal grid — desktop 3 cols, mobile flex-col */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-4 min-h-0 flex-1 sm:flex-none">
            {portals.map((portal, i) => (
              <PortalCard key={portal.href} portal={portal} index={i} />
            ))}
          </div>

          {/* Bottom hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.65 }}
            className="text-center text-[10px] sm:text-xs text-white/60 flex-shrink-0"
          >
            Contact your school administrator for access credentials.
          </motion.p>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer
        className="relative z-10 flex-shrink-0"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(8,12,20,0.55)", backdropFilter: "blur(12px)" }}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-9 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"
              style={{ boxShadow: "0 0 5px 2px rgba(52,211,153,0.65)" }} />
            <span className="text-[10px] text-white/70 font-medium" data-testid="text-footer-status">All Systems Operational</span>
          </div>
          <p className="text-[10px] text-white/55 font-medium" data-testid="text-footer-copyright">
            © {new Date().getFullYear()} BENIUS · Secure Multi-Tenant Infrastructure
          </p>
        </div>
      </footer>
    </div>
  );
}
