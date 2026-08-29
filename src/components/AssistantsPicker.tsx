import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * AssistantsPicker — Seletor visual de assistentes pré-definidos.
 *
 * Mostra cards com assistentes especializados. Ao clicar, ativa o modo correspondente.
 * Criação de assistentes personalizados é premium.
 */

type AssistantTemplate =
  | "general"
  | "looking-for-work"
  | "technical-interview"
  | "sales"
  | "lecture"
  | "leetcode"
  | "language-learning"
  | "competitive"
  | "coding"
  | "work-daily";

interface AssistantDef {
  id: AssistantTemplate;
  name: string;
  description: string;
  icon: string;
  color: string;
  gradient: string;
}

// Espelho do FREE_MODE_TEMPLATES do backend (electron/services/ModesManager.ts).
// Modos de aprendizado são free; modos que geram dinheiro pro usuário são Pro.
// Visual apenas — o gate real é o backend (pro_required), que também aceita trial.
const FREE_ASSISTANTS: ReadonlySet<AssistantTemplate> = new Set<AssistantTemplate>([
  "general",
  "lecture",
  "language-learning",
]);

const ASSISTANTS: AssistantDef[] = [
  {
    id: "general",
    name: "General Assistant",
    description: "Adaptive copilot for any meeting or conversation.",
    icon: "🤖",
    color: "#6366f1",
    gradient: "from-indigo-500/20 to-violet-500/20",
  },
  {
    id: "technical-interview",
    name: "Tech Candidate",
    description: "Ace technical interviews with code and system design support.",
    icon: "💻",
    color: "#3b82f6",
    gradient: "from-blue-500/20 to-cyan-500/20",
  },
  {
    id: "leetcode",
    name: "LeetCode Assistant",
    description: "Solve coding problems with optimal solutions and explanations.",
    icon: "🧩",
    color: "#f59e0b",
    gradient: "from-amber-500/20 to-orange-500/20",
  },
  {
    id: "sales",
    name: "Sales Assistant",
    description: "Close deals with discovery, objection handling, and follow-ups.",
    icon: "💰",
    color: "#10b981",
    gradient: "from-emerald-500/20 to-teal-500/20",
  },
  {
    id: "lecture",
    name: "Study Assistant",
    description: "Capture key concepts, definitions, and study notes from lectures.",
    icon: "📚",
    color: "#8b5cf6",
    gradient: "from-purple-500/20 to-fuchsia-500/20",
  },
  {
    id: "looking-for-work",
    name: "Job Interview",
    description: "Answer behavioral and fit questions with confidence.",
    icon: "🎯",
    color: "#ec4899",
    gradient: "from-pink-500/20 to-rose-500/20",
  },
  {
    id: "language-learning",
    name: "Language Tutor",
    description: "Real-time translation and conversational response suggestions.",
    icon: "🌍",
    color: "#14b8a6",
    gradient: "from-teal-500/20 to-emerald-500/20",
  },
  {
    id: "competitive",
    name: "Competitive Programming",
    description: "Contest-speed solving for Codeforces, ICPC, and timed rounds.",
    icon: "🏆",
    color: "#eab308",
    gradient: "from-yellow-500/20 to-amber-500/20",
  },
  {
    id: "coding",
    name: "Coding Copilot",
    description: "Pair programming on real code — debugging, reviews, implementation.",
    icon: "⚙️",
    color: "#64748b",
    gradient: "from-slate-500/20 to-zinc-500/20",
  },
  {
    id: "work-daily",
    name: "Work Day",
    description: "Tracks commitments and follow-ups across your entire workday.",
    icon: "📋",
    color: "#0ea5e9",
    gradient: "from-sky-500/20 to-blue-500/20",
  },
];

interface AssistantsPickerProps {
  isPremium: boolean;
  activeModeId?: string | null;
  onSelectMode: (templateType: AssistantTemplate) => void;
  onCreateCustom?: () => void;
  onClose: () => void;
}

export const AssistantsPicker: React.FC<AssistantsPickerProps> = ({
  isPremium,
  activeModeId,
  onSelectMode,
  onCreateCustom,
  onClose,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
      className="fixed inset-0 z-[500] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-[520px] max-h-[80vh] rounded-2xl overflow-hidden"
        style={{
          background: "rgba(17,17,20,0.92)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-[15px] font-semibold text-white tracking-tight">
              Choose an Assistant
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 transition-colors text-sm"
            >
              ✕
            </button>
          </div>
          <p className="text-[12px] text-gray-500">
            Pick a specialized assistant for your current task.
          </p>
        </div>

        {/* Grid */}
        <div className="px-5 pb-4 grid grid-cols-2 gap-2.5 overflow-y-auto max-h-[50vh]">
          {ASSISTANTS.map((a) => {
            const isActive = activeModeId === a.id;
            const isHovered = hoveredId === a.id;
            const isLocked = !isPremium && !FREE_ASSISTANTS.has(a.id);
            return (
              <motion.button
                key={a.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onMouseEnter={() => setHoveredId(a.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelectMode(a.id)}
                className={`relative text-left p-3.5 rounded-xl transition-all duration-200 ${
                  isActive
                    ? "ring-1 ring-white/20"
                    : "hover:ring-1 hover:ring-white/10"
                }`}
                style={{
                  background: isActive
                    ? `linear-gradient(135deg, ${a.color}22, ${a.color}11)`
                    : isHovered
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(255,255,255,0.02)",
                }}
              >
                <div className="flex items-start gap-2.5">
                  <span className={`text-[18px] mt-0.5 ${isLocked ? "opacity-60" : ""}`}>{a.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13px] font-medium truncate ${isLocked ? "text-gray-300" : "text-white"}`}>
                        {a.name}
                      </span>
                      {isActive && (
                        <span
                          className="text-[9px] font-medium px-1.5 py-[1px] rounded-full"
                          style={{
                            background: `${a.color}30`,
                            color: a.color,
                          }}
                        >
                          Active
                        </span>
                      )}
                      {isLocked && !isActive && (
                        <span className="text-[9px] font-medium px-1.5 py-[1px] rounded-full bg-amber-500/15 text-amber-400">
                          Pro
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2 leading-[1.35]">
                      {a.description}
                    </p>
                  </div>
                </div>
              </motion.button>
            );
          })}

          {/* Custom assistant (premium) */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              if (isPremium) {
                onCreateCustom?.();
              }
            }}
            className={`relative text-left p-3.5 rounded-xl transition-all duration-200 border border-dashed ${
              isPremium
                ? "border-white/10 hover:border-white/20 hover:bg-white/[0.03]"
                : "border-white/5 opacity-50 cursor-not-allowed"
            }`}
          >
            <div className="flex items-start gap-2.5">
              <span className="text-[18px] mt-0.5">✨</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-white">
                    Custom Assistant
                  </span>
                  {!isPremium && (
                    <span className="text-[9px] font-medium px-1.5 py-[1px] rounded-full bg-amber-500/15 text-amber-400">
                      Pro
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5 leading-[1.35]">
                  {isPremium
                    ? "Create your own assistant with custom prompts and behavior."
                    : "Unlock with Refract Pro to create custom assistants."}
                </p>
              </div>
            </div>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

export default AssistantsPicker;
