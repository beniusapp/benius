import { useState, useRef, type MouseEvent } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Link } from "wouter";
import { Shield, BookOpen, GraduationCap, ArrowRight } from "lucide-react";

/* ── Portal card data ─────────────────────────────────────────────── */
const portals = [
  {
    href: "/login",
    testId: "link-portal-admin",
    label: "ADMINISTRATION",
    title: "The Command Center",
    description: "Secure operations, faculty mapping, and global school oversight from one powerful interface.",
    Icon: Shield,
    accentFrom: "#6366f1",
    accentTo: "#818cf8",
    glowColor: "#6366f1",
    glowColorHex: "99,102,241",
    badge: "Admin Portal",
    borderColor: "rgba(99,102,241,0.3)",
    borderHoverColor: "rgba(99,102,241,0.6)",
    orb1: "#6366f1",
    orb2: "#4f46e5",
  },
  {
    href: "/teacher-login",
    testId: "link-portal-teacher",
    label: "EDUCATORS",
    title: "The Classroom Hub",
    description: "Manage your schedule, track student growth, and resolve classroom peer reports effortlessly.",
    Icon: BookOpen,
    accentFrom: "#14b8a6",
    accentTo: "#2dd4bf",
    glowColor: "#14b8a6",
    glowColorHex: "20,184,166",
    badge: "Teacher Portal",
    borderColor: "rgba(20,184,166,0.3)",
    borderHoverColor: "rgba(20,184,166,0.6)",
    orb1: "#14b8a6",
    orb2: "#0d9488",
  },
  {
    href: "/student-login",
    testId: "link-portal-student",
    label: "STUDENTS",
    title: "The Learning Path",
    description: "View your daily timetable, track your attendance, and access your full academic profile.",
    Icon: GraduationCap,
    accentFrom: "#8b5cf6",
    accentTo: "#a78bfa",
    glowColor: "#8b5cf6",
    glowColorHex: "139,92,246",
    badge: "Student Portal",
    borderColor: "rgba(139,92,246,0.3)",
    borderHoverColor: "rgba(139,92,246,0.6)",
    orb1: "#8b5cf6",
    orb2: "#7c3aed",
  },
] as const;

/* ── Magnetic wrapper ─────────────────────────────────────────────── */
function MagneticWrap({
  children,
  strength = 0.3,
  className = "",
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [xy, setXY] = useState({ x: 0, y: 0 });

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setXY({ x: (e.clientX - cx) * strength, y: (e.clientY - cy) * strength });
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setXY({ x: 0, y: 0 })}
      animate={{ x: xy.x, y: xy.y }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ── Portal card component ────────────────────────────────────────── */
function PortalCard({
  portal,
  index,
}: {
  portal: (typeof portals)[number];
  index: number;
}) {
  const [glow, setGlow] = useState({ x: 50, y: 50, visible: false });
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function onMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setGlow({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
  }

  const { href, testId, label, title, description, Icon, accentFrom, accentTo, glowColor, glowColorHex, badge, borderColor, borderHoverColor, orb1, orb2 } = portal;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ type: "spring", stiffness: 80, damping: 20, delay: index * 0.12 }}
    >
      <MagneticWrap strength={0.15}>
        <Link href={href} data-testid={testId}>
          <motion.div
            ref={ref}
            onMouseMove={onMouseMove}
            onMouseLeave={() => { setGlow((g) => ({ ...g, visible: false })); setHovered(false); }}
            onMouseEnter={() => setHovered(true)}
            whileHover={{ scale: 1.035, y: -6 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="relative rounded-2xl overflow-hidden cursor-pointer min-h-[260px] p-7 flex flex-col gap-5 sm:min-h-[280px]"
            style={{
              background: "rgba(255,255,255,0.04)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: `1px solid ${hovered ? borderHoverColor : borderColor}`,
              boxShadow: hovered
                ? `0 0 40px 0 ${glowColor}30, 0 20px 60px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)`
                : `0 8px 32px -4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
              transition: "border-color 0.3s, box-shadow 0.3s",
            }}
          >
            {/* Cursor-tracking glow */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                opacity: glow.visible ? 1 : 0,
                background: `radial-gradient(circle 200px at ${glow.x}px ${glow.y}px, ${glowColor}28, transparent 70%)`,
                transition: "opacity 0.4s",
              }}
            />

            {/* Subtle inner gradient top */}
            <div
              className="absolute inset-x-0 top-0 h-px pointer-events-none"
              style={{ background: `linear-gradient(90deg, transparent, ${glowColor}60, transparent)` }}
            />

            {/* 3D Gradient Icon Orb */}
            <div className="flex items-start justify-between">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 relative"
                style={{
                  background: `linear-gradient(145deg, ${orb1}dd, ${orb2}aa)`,
                  boxShadow: `0 8px 24px ${glowColor}50, inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.2)`,
                }}
              >
                <Icon className="w-7 h-7 text-white drop-shadow-lg" />
              </div>
              <span
                className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border"
                style={{
                  background: `rgba(${glowColorHex},0.1)`,
                  borderColor: `rgba(${glowColorHex},0.25)`,
                  color: accentTo,
                }}
              >
                {badge}
              </span>
            </div>

            {/* Label */}
            <p className="text-[10px] font-bold tracking-[0.2em] text-white/30 uppercase">{label}</p>

            {/* Content */}
            <div className="space-y-2 mt-auto">
              <h3 className="text-lg font-bold text-white leading-tight">{title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{description}</p>
            </div>

            {/* Enter Portal link */}
            <MagneticWrap strength={0.4} className="flex">
              <div
                className="flex items-center gap-1.5 text-xs font-semibold"
                style={{ color: accentTo }}
              >
                <span>Enter Portal</span>
                <motion.div
                  animate={hovered ? { x: 4 } : { x: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </motion.div>
              </div>
            </MagneticWrap>
          </motion.div>
        </Link>
      </MagneticWrap>
    </motion.div>
  );
}

/* ── Main page ────────────────────────────────────────────────────── */
export default function Home() {
  const [ctaMagnetic, setCtaMagnetic] = useState({ x: 0, y: 0 });
  const ctaRef = useRef<HTMLButtonElement>(null);

  function onCtaMove(e: MouseEvent<HTMLButtonElement>) {
    const el = ctaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setCtaMagnetic({ x: (e.clientX - cx) * 0.35, y: (e.clientY - cy) * 0.35 });
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden" style={{ background: "#080c14" }}>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes mesh-drift-1 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          25%       { transform: translate(80px, -100px) scale(1.2); }
          50%       { transform: translate(-60px, 60px) scale(0.88); }
          75%       { transform: translate(40px, 80px) scale(1.1); }
        }
        @keyframes mesh-drift-2 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          33%       { transform: translate(-90px, 70px) scale(1.15); }
          66%       { transform: translate(70px, -80px) scale(0.9); }
        }
        @keyframes mesh-drift-3 {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          40%       { transform: translate(50px, 90px) scale(1.25); }
          80%       { transform: translate(-80px, -40px) scale(0.92); }
        }
        @keyframes geo-float-1 {
          0%, 100% { transform: translate(0,0) rotate(0deg); }
          50%       { transform: translate(-20px, 30px) rotate(180deg); }
        }
        @keyframes geo-float-2 {
          0%, 100% { transform: translate(0,0) rotate(45deg); }
          50%       { transform: translate(25px, -20px) rotate(225deg); }
        }
        @keyframes geo-float-3 {
          0%, 100% { transform: translate(0,0) rotate(12deg); }
          50%       { transform: translate(-15px, 20px) rotate(192deg); }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 20px 4px rgba(99,102,241,0.4), 0 0 40px 8px rgba(20,184,166,0.2); }
          50%       { box-shadow: 0 0 32px 8px rgba(99,102,241,0.6), 0 0 60px 16px rgba(20,184,166,0.35); }
        }
        @keyframes ring-pulse {
          0%   { transform: scale(1); opacity: 0.7; }
          100% { transform: scale(1.7); opacity: 0; }
        }
        .mesh-1 { animation: mesh-drift-1 24s ease-in-out infinite; }
        .mesh-2 { animation: mesh-drift-2 30s ease-in-out infinite; }
        .mesh-3 { animation: mesh-drift-3 20s ease-in-out infinite; }
        .geo-1  { animation: geo-float-1 28s ease-in-out infinite; }
        .geo-2  { animation: geo-float-2 22s ease-in-out infinite; }
        .geo-3  { animation: geo-float-3 35s ease-in-out infinite; }
        .cta-glow { animation: glow-pulse 2.5s ease-in-out infinite; }
        .ring-anim {
          position: absolute; inset: -1px; border-radius: 9999px;
          border: 1.5px solid rgba(99,102,241,0.6);
          animation: ring-pulse 2s ease-out infinite;
          pointer-events: none;
        }
        .ring-anim-2 {
          animation-delay: 0.7s;
        }
        .text-gradient-hero {
          background: linear-gradient(135deg, #6366f1 0%, #06b6d4 55%, #8b5cf6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .navbar-glass {
          background: rgba(8, 12, 20, 0.7);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
      `}</style>

      {/* ── Animated Background Layer ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        {/* Mesh gradient orbs */}
        <div
          className="mesh-1 absolute top-[-25%] left-[-15%] w-[700px] h-[700px] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, #6366f155 0%, transparent 65%)", filter: "blur(80px)" }}
        />
        <div
          className="mesh-2 absolute top-[5%] right-[-20%] w-[800px] h-[800px] rounded-full opacity-30"
          style={{ background: "radial-gradient(circle, #06b6d445 0%, transparent 65%)", filter: "blur(90px)" }}
        />
        <div
          className="mesh-3 absolute bottom-[-25%] left-[20%] w-[600px] h-[600px] rounded-full opacity-35"
          style={{ background: "radial-gradient(circle, #8b5cf655 0%, transparent 65%)", filter: "blur(80px)" }}
        />
        {/* Extra mid orb */}
        <div
          className="mesh-1 absolute top-[40%] left-[55%] w-[400px] h-[400px] rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #14b8a640 0%, transparent 65%)", filter: "blur(60px)", animationDelay: "8s" }}
        />

        {/* Dot-grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "36px 36px",
          }}
        />

        {/* Floating geometric shapes */}
        <div
          className="geo-1 absolute top-[18%] left-[8%] w-24 h-24 rounded-3xl opacity-[0.06]"
          style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)", border: "1px solid rgba(255,255,255,0.15)" }}
        />
        <div
          className="geo-2 absolute top-[65%] right-[10%] w-16 h-16 rounded-full opacity-[0.07]"
          style={{ background: "linear-gradient(135deg, #8b5cf6, #6366f1)", border: "1px solid rgba(255,255,255,0.12)" }}
        />
        <div
          className="geo-3 absolute bottom-[20%] left-[60%] w-20 h-20 rounded-2xl opacity-[0.05]"
          style={{ background: "linear-gradient(135deg, #06b6d4, #14b8a6)", border: "1px solid rgba(255,255,255,0.1)" }}
        />
      </div>

      {/* ── Fixed Navbar ── */}
      <header className="navbar-glass fixed top-0 left-0 right-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, #6366f1, #06b6d4)", boxShadow: "0 0 16px rgba(99,102,241,0.4)" }}
            >
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black tracking-tight text-white" data-testid="text-app-title">
                BENIUS
              </span>
              <span className="text-xs text-white/30 font-medium hidden sm:inline">School Management</span>
            </div>
          </div>

          {/* Status pill */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8">
            <span
              className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"
              style={{ boxShadow: "0 0 6px 2px rgba(52,211,153,0.6)", animation: "glow-pulse 2s ease-in-out infinite" }}
            />
            <span className="text-xs text-emerald-400 font-semibold tracking-wide">System Status: Operational</span>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pt-32 pb-24">
        <div className="max-w-5xl w-full mx-auto">

          {/* ── Hero Section ── */}
          <div className="text-center mb-20 space-y-8">

            {/* Eyebrow pill */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full"
              style={{
                background: "rgba(99,102,241,0.1)",
                border: "1px solid rgba(99,102,241,0.3)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0"
                style={{ boxShadow: "0 0 6px rgba(129,140,248,0.8)" }}
              />
              <span className="text-xs font-semibold text-indigo-300 tracking-wider uppercase">
                Next-Gen EdTech Platform
              </span>
            </motion.div>

            {/* Main heading */}
            <motion.h1
              initial={{ opacity: 0, y: 48 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
              data-testid="text-hero-title"
              className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.08] text-white"
            >
              The Future of School
              <br />
              <span className="text-gradient-hero">Management, Simplified.</span>
            </motion.h1>

            {/* Subheading */}
            <motion.p
              initial={{ opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
              data-testid="text-hero-sub"
              className="text-lg sm:text-xl text-white/55 max-w-2xl mx-auto leading-[1.75]"
            >
              Empowering{" "}
              <span className="text-white/85 font-semibold">10,000+ minds</span> with
              real-time attendance, smart timetables, and secure administration — all in one place.
            </motion.p>

            {/* Glowing CTA button */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.28 }}
              className="flex justify-center"
            >
              <motion.button
                ref={ctaRef}
                onMouseMove={onCtaMove}
                onMouseLeave={() => setCtaMagnetic({ x: 0, y: 0 })}
                animate={{ x: ctaMagnetic.x, y: ctaMagnetic.y }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                data-testid="button-cta-explore"
                className="relative px-8 py-4 rounded-full text-sm font-bold text-white tracking-wide cta-glow"
                style={{
                  background: "linear-gradient(135deg, #6366f1, #06b6d4)",
                }}
                onClick={() => {
                  document.getElementById("portal-grid")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <span className="ring-anim" />
                <span className="ring-anim ring-anim-2" />
                <span className="relative z-10 flex items-center gap-2">
                  Explore Portals
                  <ArrowRight className="w-4 h-4" />
                </span>
              </motion.button>
            </motion.div>
          </div>

          {/* ── Portal cards grid ── */}
          <div id="portal-grid" className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {portals.map((portal, i) => (
              <PortalCard key={portal.href} portal={portal} index={i} />
            ))}
          </div>

          {/* Bottom hint */}
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-center text-xs text-white/25 mt-12"
          >
            Contact your school administrator for access credentials.
          </motion.p>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 py-5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(8,12,20,0.6)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"
              style={{ boxShadow: "0 0 6px 2px rgba(52,211,153,0.7)" }}
            />
            <span className="text-xs text-white/40 font-medium" data-testid="text-footer-status">
              All Systems Operational
            </span>
          </div>
          <p className="text-xs text-white/25 font-medium" data-testid="text-footer-copyright">
            © {new Date().getFullYear()} BENIUS · Secure Multi-Tenant Infrastructure
          </p>
        </div>
      </footer>
    </div>
  );
}
