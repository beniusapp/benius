import { motion } from "framer-motion";
import { Lock } from "lucide-react";

interface SessionArchiveBannerProps {
  sessionName: string;
  /** Extra className for the wrapper — useful for spacing overrides */
  className?: string;
}

/**
 * Shown inside every session-scoped student module when the student is
 * browsing a historical (non-active) session.  Import once, render once.
 */
export function SessionArchiveBanner({ sessionName, className = "" }: SessionArchiveBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${className}`}
      style={{
        background: "#fefce8",
        border: "1.5px solid #fde68a",
        boxShadow: "0 2px 10px rgba(234,179,8,0.12)",
      }}
      data-testid="banner-session-archive"
    >
      <Lock className="w-4 h-4 text-amber-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-amber-800 leading-tight">
          Archive Mode — Read Only
        </p>
        <p className="text-xs text-amber-600 mt-0.5 leading-snug">
          Viewing <span className="font-semibold">{sessionName}</span>.
          {" "}All write actions are locked for this session.
        </p>
      </div>
    </motion.div>
  );
}
