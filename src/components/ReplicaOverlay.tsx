import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RoleTwinPanel } from "./RoleTwinPanel";
import type { RoleTwin } from "../types/roleTwin";

/**
 * ReplicaOverlay — Interview Coach practice mode.
 *
 * O Refract vira o entrevistador: faz perguntas adaptadas ao perfil/JD do
 * usuário, avalia respostas em tempo real e ao final gera um debrief completo
 * com score, pontos fortes e melhorias.
 *
 * Reaproveita o pipeline de STT existente (onNativeAudioTranscript) para
 * capturar a resposta falada do usuário, e o LLM via IPC (replica:*).
 */

const MODE_OPTIONS = [
  { value: "technical-interview", label: "Technical Interview" },
  { value: "looking-for-work", label: "Behavioral / Job Search" },
  { value: "sales", label: "Sales Role" },
  { value: "recruiting", label: "Recruiting Screen" },
  { value: "general", label: "General Practice" },
];

const LANG_OPTIONS = [
  { value: "en", label: "English" },
  { value: "pt", label: "Portuguese" },
  { value: "es", label: "Spanish" },
];

type Phase = "setup" | "active" | "evaluation" | "done";

interface QuestionHistoryItem {
  question: string;
  difficulty: string;
  category: string;
  userAnswer: string;
  feedback: string;
}

interface CoachEvaluation {
  score: number;
  overallGrade: string;
  summary: string;
  strengths: string[];
  improvements: string[];
}

export const ReplicaOverlay: React.FC = () => {
  const [phase, setPhase] = useState<Phase>("setup");
  const [modeType, setModeType] = useState("technical-interview");
  const [language, setLanguage] = useState("en");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number>(0);

  // Conversation
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [currentDifficulty, setCurrentDifficulty] = useState("");
  const [currentCategory, setCurrentCategory] = useState("");
  const [streamingQuestion, setStreamingQuestion] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionHistory, setQuestionHistory] = useState<QuestionHistoryItem[]>([]);
  const [lastFeedback, setLastFeedback] = useState("");

  // Input
  const [userAnswer, setUserAnswer] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isCoachThinking, setIsCoachThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Evaluation
  const [evaluation, setEvaluation] = useState<CoachEvaluation | null>(null);
  const [streamingEval, setStreamingEval] = useState("");

  // Role Twin — oportunidade alvo da prática
  const [roleTwinOpen, setRoleTwinOpen] = useState(false);
  const [activeTwin, setActiveTwin] = useState<RoleTwin | null>(null);

  useEffect(() => {
    window.electronAPI.roleTwinGetActive()
      .then((twin) => setActiveTwin(twin || null))
      .catch(() => {});
  }, []);

  const accumulatedRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Start session ──────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setError(null);
    try {
      const result = await window.electronAPI.replicaStartSession({
        modeType,
        language,
        title: `${MODE_OPTIONS.find((m) => m.value === modeType)?.label ?? modeType} practice`,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.sessionId) {
        setSessionId(result.sessionId);
        setStartTime(Date.now());
        setPhase("active");
        setQuestionIndex(0);
        setQuestionHistory([]);
        setIsCoachThinking(true);
        window.electronAPI.replicaAskQuestion({
          sessionId: result.sessionId,
          userAnswer: "",
          isFirst: true,
          modeType,
          language,
          questionHistory: [],
        });
      }
    } catch (err: any) {
      setError(err.message || "Failed to start session");
    }
  }, [modeType, language]);

  // ── Submit answer ───────────────────────────────────────────────────────
  const submitAnswer = useCallback(
    (answerText: string) => {
      if (!sessionId || !answerText.trim() || isCoachThinking) return;
      const newHistory = [
        ...questionHistory,
        {
          question: currentQuestion,
          difficulty: currentDifficulty,
          category: currentCategory,
          userAnswer: answerText,
          feedback: lastFeedback,
        },
      ];
      setQuestionHistory(newHistory);
      setUserAnswer("");
      setIsCoachThinking(true);
      setStreamingQuestion("");
      accumulatedRef.current = "";

      window.electronAPI.replicaAskQuestion({
        sessionId,
        userAnswer: answerText,
        isFirst: false,
        modeType,
        language,
        questionHistory: newHistory,
      });
    },
    [sessionId, questionHistory, currentQuestion, currentDifficulty, currentCategory, lastFeedback, isCoachThinking, modeType, language],
  );

  // ── End session (request evaluation) ───────────────────────────────────
  const endSession = useCallback(() => {
    if (!sessionId) return;
    setIsCoachThinking(true);
    setPhase("evaluation");
    setStreamingEval("");
    accumulatedRef.current = "";
    window.electronAPI.replicaEndSession({
      sessionId,
      questionHistory,
      modeType,
      startTime,
    });
  }, [sessionId, questionHistory, modeType, startTime]);

  // ── Subscribe to IPC events ────────────────────────────────────────────
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Live transcript (voice input)
    cleanups.push(
      window.electronAPI.onNativeAudioTranscript((t: any) => {
        if (phase !== "active") return;
        setIsListening(true);
        setUserAnswer((prev) => {
          const text = typeof t === "string" ? t : t.text;
          if (typeof t === "object" && t.final === false) {
            return prev + (prev && !prev.endsWith(" ") ? " " : "") + text;
          }
          return text;
        });
        if (typeof t === "object" && t.final) {
          setIsListening(false);
        }
      }),
    );

    // Question streaming
    cleanups.push(
      window.electronAPI.onReplicaQuestionToken((data) => {
        accumulatedRef.current = data.accumulated;
        setStreamingQuestion(data.accumulated);
      }),
    );

    cleanups.push(
      window.electronAPI.onReplicaQuestionDone((data) => {
        setIsCoachThinking(false);
        setStreamingQuestion("");
        setCurrentQuestion(data.question);
        setCurrentDifficulty(data.difficulty);
        setCurrentCategory(data.category);
        if (data.feedback) setLastFeedback(data.feedback);
        setQuestionIndex((i) => i + 1);
        if (data.isEndSession) {
          endSession();
        }
      }),
    );

    cleanups.push(
      window.electronAPI.onReplicaQuestionError((data) => {
        setIsCoachThinking(false);
        setError(data.error);
      }),
    );

    // Evaluation streaming
    cleanups.push(
      window.electronAPI.onReplicaEvaluationToken((data) => {
        accumulatedRef.current = data.accumulated;
        setStreamingEval(data.accumulated);
      }),
    );

    cleanups.push(
      window.electronAPI.onReplicaEvaluationDone((data) => {
        setIsCoachThinking(false);
        setEvaluation(data.evaluation);
        setPhase("done");
      }),
    );

    cleanups.push(
      window.electronAPI.onReplicaEvaluationError((data) => {
        setIsCoachThinking(false);
        setError(data.error);
        setPhase("active");
      }),
    );

    return () => cleanups.forEach((c) => c());
  }, [phase, endSession]);

  // ── Autoscroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [streamingQuestion, currentQuestion, lastFeedback]);

  // ── Restart ─────────────────────────────────────────────────────────────
  const reset = () => {
    setPhase("setup");
    setSessionId(null);
    setCurrentQuestion("");
    setStreamingQuestion("");
    setQuestionHistory([]);
    setQuestionIndex(0);
    setEvaluation(null);
    setStreamingEval("");
    setUserAnswer("");
    setLastFeedback("");
    setError(null);
    accumulatedRef.current = "";
  };

  const difficultyColor = (d: string) =>
    d === "easy" ? "#4ade80" : d === "hard" ? "#f87171" : "#facc15";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...dotStyle, background: phase === "active" ? "#3b82f6" : "#6b7280" }} />
          <span style={headerTitleStyle}>
            {phase === "setup" && "Interview Coach"}
            {phase === "active" && `Q${questionIndex} · Coach Mode`}
            {phase === "evaluation" && "Evaluating..."}
            {phase === "done" && "Session Complete"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(phase === "active" || phase === "evaluation") && (
            <button style={iconBtnStyle} onClick={endSession} title="End session">
              ⏹
            </button>
          )}
          <button
            style={iconBtnStyle}
            onClick={() => setRoleTwinOpen(true)}
            title={activeTwin ? `Role Twin: ${activeTwin.roleTitle} @ ${activeTwin.company}` : "Company & Role Twin"}
          >
            {activeTwin ? "◉" : "◎"}
          </button>
          <button style={iconBtnStyle} onClick={reset} title="Reset">
            ↺
          </button>
          <button
            style={iconBtnStyle}
            onClick={() => {
              window.electronAPI.replicaCloseWindow?.().catch(() => {});
            }}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {phase !== "setup" && (
        <div style={progressBarTrack}>
          <motion.div
            style={progressBarFill}
            animate={{ width: `${Math.min((questionIndex / 8) * 100, 100)}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* SETUP */}
        {phase === "setup" && (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={bodyStyle}
          >
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🎯</div>
              <h2 style={h2Style}>Practice Interview</h2>
              <p style={subtitleStyle}>
                The coach will ask you ~8 questions adapted to your profile and role. Answer by voice or text.
                Get a full evaluation at the end.
              </p>
              {activeTwin && (
                <div style={activeTwinChipStyle}>
                  <strong>{activeTwin.company}</strong>
                  <span> · {activeTwin.roleTitle} · tuned to your active Role Twin</span>
                </div>
              )}
            </div>

            <label style={labelStyle}>Interview type</label>
            <select value={modeType} onChange={(e) => setModeType(e.target.value)} style={selectStyle}>
              {MODE_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>

            <label style={labelStyle}>Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectStyle}>
              {LANG_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={startSession}
              style={startBtnStyle}
            >
              Start practice
            </motion.button>
          </motion.div>
        )}

        {/* ACTIVE */}
        {phase === "active" && (
          <motion.div
            key="active"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ ...bodyStyle, display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            {/* Chat area */}
            <div ref={scrollRef} style={chatScrollStyle}>
              {/* Feedback from previous answer */}
              {lastFeedback && questionIndex > 1 && (
                <div style={feedbackBubbleStyle}>
                  <span style={{ fontSize: 10, opacity: 0.6, marginRight: 4 }}>💬 Feedback:</span>
                  {lastFeedback}
                </div>
              )}

              {/* Coach question */}
              {(streamingQuestion || currentQuestion) && (
                <div style={coachBubbleStyle}>
                  <div style={coachAvatarStyle}>🎯</div>
                  <div style={coachTextStyle}>
                    {streamingQuestion && !currentQuestion ? (
                      <span style={{ opacity: 0.8 }}>
                        {streamingQuestion}
                        <span style={typingDotStyle} />
                      </span>
                    ) : (
                      currentQuestion
                    )}
                  </div>
                </div>
              )}

              {/* Tags */}
              {(currentDifficulty || currentCategory) && !streamingQuestion && (
                <div style={tagRowStyle}>
                  {currentDifficulty && (
                    <span style={{ ...tagStyle, background: difficultyColor(currentDifficulty) + "22", color: difficultyColor(currentDifficulty), borderColor: difficultyColor(currentDifficulty) + "44" }}>
                      {currentDifficulty}
                    </span>
                  )}
                  {currentCategory && (
                    <span style={tagStyle}>{currentCategory}</span>
                  )}
                </div>
              )}

              {/* Previous answers */}
              {questionHistory.slice(-3).map((h, i) => (
                <div key={i} style={userBubbleStyle}>
                  <span style={{ fontSize: 10, opacity: 0.5, marginRight: 4 }}>You:</span>
                  {h.userAnswer}
                </div>
              ))}
            </div>

            {/* Input area */}
            <div style={inputAreaStyle}>
              <textarea
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder={isListening ? "Listening..." : "Type or speak your answer..."}
                style={textareaStyle}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submitAnswer(userAnswer);
                  }
                }}
              />
              <button
                onClick={() => submitAnswer(userAnswer)}
                disabled={!userAnswer.trim() || isCoachThinking}
                style={{
                  ...sendBtnStyle,
                  opacity: (!userAnswer.trim() || isCoachThinking) ? 0.4 : 1,
                }}
              >
                {isCoachThinking ? "…" : "→"}
              </button>
            </div>
            <div style={hintStyle}>⌘/Ctrl + Enter to send · Voice auto-captures when mic is live</div>
          </motion.div>
        )}

        {/* EVALUATION (streaming) */}
        {phase === "evaluation" && (
          <motion.div
            key="eval"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={bodyStyle}
          >
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                style={{ fontSize: 40 }}
              >
                📊
              </motion.div>
              <p style={subtitleStyle}>Compiling your evaluation...</p>
            </div>
            <div style={evalStreamStyle}>{streamingEval}</div>
          </motion.div>
        )}

        {/* DONE (final report) */}
        {phase === "done" && evaluation && (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={bodyStyle}
          >
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{
                fontSize: 56,
                fontWeight: 700,
                background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}>
                {evaluation.score}
                <span style={{ fontSize: 20, opacity: 0.5 }}>/100</span>
              </div>
              <div style={{ ...gradeStyle, color: scoreColor(evaluation.score) }}>
                Grade: {evaluation.overallGrade}
              </div>
            </div>

            <p style={summaryStyle}>{evaluation.summary}</p>

            {evaluation.strengths.length > 0 && (
              <>
                <div style={sectionTitleStyle}><span style={{ color: "#4ade80" }}>✓</span> Strengths</div>
                {evaluation.strengths.map((s, i) => (
                  <div key={i} style={bulletStyle}>{s}</div>
                ))}
              </>
            )}

            {evaluation.improvements.length > 0 && (
              <>
                <div style={sectionTitleStyle}><span style={{ color: "#f87171" }}>!</span> To improve</div>
                {evaluation.improvements.map((s, i) => (
                  <div key={i} style={bulletStyle}>{s}</div>
                ))}
              </>
            )}

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={reset}
              style={startBtnStyle}
            >
              Practice again
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div style={errorStyle}>{error}</div>
      )}

      {/* Company & Role Twin — painel de inteligência da oportunidade */}
      <RoleTwinPanel
        open={roleTwinOpen}
        onClose={() => setRoleTwinOpen(false)}
        onActiveChange={setActiveTwin}
      />
    </div>
  );
};

// ── Style constants ─────────────────────────────────────────────────────────
const scoreColor = (s: number) =>
  s >= 90 ? "#22c55e" : s >= 75 ? "#3b82f6" : s >= 60 ? "#f59e0b" : "#ef4444";

const containerStyle: React.CSSProperties = {
  width: "100%",
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#e5e7eb",
  fontSize: 13,
  userSelect: "none",
  background: "rgba(18, 18, 20, 0.92)",
  backdropFilter: "blur(40px)",
  WebkitBackdropFilter: "blur(40px)",
  borderRadius: 16,
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  flexShrink: 0,
};

const activeTwinChipStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: 10,
  padding: "5px 12px",
  borderRadius: 999,
  border: "1px solid rgba(52, 211, 153, 0.35)",
  background: "rgba(52, 211, 153, 0.08)",
  color: "#6ee7b7",
  fontSize: 11.5,
};

const dotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
};

const iconBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "none",
  color: "#9ca3af",
  cursor: "pointer",
  fontSize: 13,
  padding: "4px 8px",
  borderRadius: 6,
};

const progressBarTrack: React.CSSProperties = {
  height: 3,
  background: "rgba(255,255,255,0.06)",
  flexShrink: 0,
};

const progressBarFill: React.CSSProperties = {
  height: "100%",
  background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
  borderRadius: 2,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  padding: 16,
  overflow: "auto",
};

const chatScrollStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "8px 4px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const coachBubbleStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
};

const coachAvatarStyle: React.CSSProperties = {
  fontSize: 16,
  flexShrink: 0,
  width: 24,
  textAlign: "center",
};

const coachTextStyle: React.CSSProperties = {
  background: "rgba(59, 130, 246, 0.12)",
  border: "1px solid rgba(59, 130, 246, 0.25)",
  borderRadius: "12px 12px 12px 2px",
  padding: "10px 12px",
  lineHeight: 1.5,
  fontSize: 13,
};

const feedbackBubbleStyle: React.CSSProperties = {
  background: "rgba(139, 92, 246, 0.1)",
  border: "1px solid rgba(139, 92, 246, 0.2)",
  borderRadius: 10,
  padding: "8px 10px",
  fontSize: 12,
  opacity: 0.85,
  lineHeight: 1.4,
};

const userBubbleStyle: React.CSSProperties = {
  alignSelf: "flex-end",
  background: "rgba(255,255,255,0.06)",
  borderRadius: "12px 12px 2px 12px",
  padding: "8px 12px",
  maxWidth: "80%",
  fontSize: 12,
  lineHeight: 1.4,
};

const tagRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginLeft: 32,
};

const tagStyle: React.CSSProperties = {
  fontSize: 10,
  padding: "2px 8px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  textTransform: "capitalize",
  fontWeight: 500,
};

const typingDotStyle: React.CSSProperties = {
  display: "inline-block",
  width: 6,
  height: 13,
  background: "#3b82f6",
  marginLeft: 2,
  animation: "blink 1s step-end infinite",
  verticalAlign: "text-bottom",
};

const inputAreaStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "8px 0 4px",
  flexShrink: 0,
  borderTop: "1px solid rgba(255,255,255,0.06)",
  paddingTop: 10,
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  padding: "8px 10px",
  color: "#e5e7eb",
  fontSize: 13,
  fontFamily: "inherit",
  resize: "none",
  outline: "none",
};

const sendBtnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #3b82f6, #6366f1)",
  border: "none",
  color: "white",
  cursor: "pointer",
  borderRadius: 10,
  width: 36,
  fontSize: 16,
  fontWeight: 600,
};

const hintStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.4,
  textAlign: "center",
  padding: "2px 0 6px",
  flexShrink: 0,
};

const h2Style: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  margin: "0 0 6px",
  letterSpacing: -0.3,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.6,
  lineHeight: 1.5,
  margin: "0 auto",
  maxWidth: 320,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  opacity: 0.5,
  marginBottom: 4,
  marginTop: 12,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "#e5e7eb",
  fontSize: 13,
  outline: "none",
  cursor: "pointer",
};

const startBtnStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 20,
  padding: "12px",
  background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
  border: "none",
  color: "white",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const evalStreamStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  borderRadius: 10,
  padding: 12,
  fontSize: 12,
  lineHeight: 1.5,
  opacity: 0.7,
  whiteSpace: "pre-wrap",
  fontFamily: "monospace",
};

const gradeStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  marginTop: 4,
};

const summaryStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  opacity: 0.85,
  background: "rgba(255,255,255,0.04)",
  borderRadius: 10,
  padding: 12,
  marginBottom: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 6,
  marginTop: 12,
};

const bulletStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  opacity: 0.8,
  paddingLeft: 12,
  marginBottom: 4,
  borderLeft: "2px solid rgba(255,255,255,0.15)",
};

const errorStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 12,
  left: 12,
  right: 12,
  background: "rgba(239, 68, 68, 0.15)",
  border: "1px solid rgba(239, 68, 68, 0.3)",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 11,
  color: "#fca5a5",
};

export default ReplicaOverlay;
