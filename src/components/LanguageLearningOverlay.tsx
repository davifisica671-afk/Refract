import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * LanguageLearningOverlay — Mini painel flutuante para tradução em tempo real.
 *
 * Captura transcrição do system audio (outra pessoa falando), traduz via LLM,
 * e sugere uma resposta na língua-alvo.
 */

const SOURCE_LANGUAGES: Record<string, string> = {
    auto: "Auto-detect",
    en: "English",
    pt: "Portuguese",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ru: "Russian",
    ar: "Arabic",
    hi: "Hindi",
};

const TARGET_LANGUAGES: Record<string, string> = {
    pt: "Portuguese",
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ru: "Russian",
    ar: "Arabic",
    hi: "Hindi",
};

export const LanguageLearningOverlay: React.FC = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [translation, setTranslation] = useState("");
    const [suggestedReply, setSuggestedReply] = useState("");
    const [sourceLanguage, setSourceLanguage] = useState("auto");
    const [targetLanguage, setTargetLanguage] = useState("pt");
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const accumulatedRef = useRef("");

    const requestTranslation = useCallback(
        (transcript: string) => {
            if (!transcript.trim()) return;
            setIsProcessing(true);
            setError(null);
            setTranslation("");
            setSuggestedReply("");
            accumulatedRef.current = "";
            window.electronAPI.languageLearningTranslate({
                transcript,
                sourceLanguage,
                targetLanguage,
            });
        },
        [sourceLanguage, targetLanguage],
    );

    useEffect(() => {
        const cleanups: (() => void)[] = [];

        cleanups.push(
            window.electronAPI.onNativeAudioConnected(() => setIsConnected(true)),
        );
        cleanups.push(
            window.electronAPI.onNativeAudioDisconnected(() => setIsConnected(false)),
        );

        cleanups.push(
            window.electronAPI.onNativeAudioTranscript((t: any) => {
                if (t.final && t.speaker !== "user") {
                    requestTranslation(t.text);
                }
            }),
        );

        cleanups.push(
            window.electronAPI.onLanguageLearningToken((data) => {
                accumulatedRef.current = data.accumulated;
                const parsed = (window as any).__languageLearningParse?.(data.accumulated);
                if (parsed) {
                    setTranslation(parsed.translation);
                    setSuggestedReply(parsed.suggestedReply);
                }
            }),
        );

        cleanups.push(
            window.electronAPI.onLanguageLearningDone((data) => {
                setIsProcessing(false);
                if (data.translation) setTranslation(data.translation);
                if (data.suggestedReply) setSuggestedReply(data.suggestedReply);
            }),
        );

        cleanups.push(
            window.electronAPI.onLanguageLearningError((data) => {
                setIsProcessing(false);
                setError(data.error);
            }),
        );

        return () => cleanups.forEach((c) => c());
    }, [requestTranslation]);

    // Expose parser for streaming partial responses
    useEffect(() => {
        (window as any).__languageLearningParse = (raw: string) => {
            const tMatch = raw.match(/\[TRANSLATION\]\s*([\s\S]*?)\s*\[\/TRANSLATION\]/);
            const sMatch = raw.match(/\[SUGGESTION\]\s*([\s\S]*?)\s*\[\/SUGGESTION\]/);
            if (tMatch && sMatch) {
                return { translation: tMatch[1].trim(), suggestedReply: sMatch[1].trim() };
            }
            return null;
        };
        return () => { delete (window as any).__languageLearningParse; };
    }, []);

    const copyToClipboard = async () => {
        if (!suggestedReply) return;
        await navigator.clipboard.writeText(suggestedReply);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div
            style={{
                width: 360,
                minHeight: 120,
                padding: 14,
                fontFamily: "system-ui, -apple-system, sans-serif",
                color: "#e5e7eb",
                fontSize: 13,
                userSelect: "none",
            }}
        >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                        style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            backgroundColor: isConnected ? "#4ade80" : "#ef4444",
                        }}
                    />
                    <span style={{ fontSize: 11, opacity: 0.6 }}>
                        {isConnected ? "Listening" : "Disconnected"}
                    </span>
                    {isProcessing && (
                        <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 4 }}>
                            ⟳ translating...
                        </span>
                    )}
                </div>
                <button
                    onClick={() => setShowSettings((s) => !s)}
                    style={{
                        background: "none",
                        border: "none",
                        color: "#9ca3af",
                        cursor: "pointer",
                        fontSize: 14,
                        padding: "2px 6px",
                        borderRadius: 4,
                    }}
                >
                    ⚙
                </button>
            </div>

            {/* Settings panel */}
            <AnimatePresence>
                {showSettings && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: "hidden", marginBottom: 8 }}
                    >
                        <div
                            style={{
                                padding: 10,
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.06)",
                                display: "flex",
                                gap: 8,
                            }}
                        >
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 3 }}>FROM</div>
                                <select
                                    value={sourceLanguage}
                                    onChange={(e) => setSourceLanguage(e.target.value)}
                                    style={selectStyle}
                                >
                                    {Object.entries(SOURCE_LANGUAGES).map(([k, v]) => (
                                        <option key={k} value={k}>{v}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 3 }}>TO</div>
                                <select
                                    value={targetLanguage}
                                    onChange={(e) => setTargetLanguage(e.target.value)}
                                    style={selectStyle}
                                >
                                    {Object.entries(TARGET_LANGUAGES).map(([k, v]) => (
                                        <option key={k} value={k}>{v}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Translation */}
            <AnimatePresence>
                {translation && (
                    <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        style={{ marginBottom: 8 }}
                    >
                        <div style={labelStyle}>WHAT THEY SAID</div>
                        <div style={cardStyle}>{translation}</div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Suggested reply */}
            <AnimatePresence>
                {suggestedReply && (
                    <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                    >
                        <div style={labelStyle}>SAY THIS</div>
                        <div style={{ ...cardStyle, borderLeft: "3px solid #3b82f6", background: "rgba(59,130,246,0.15)" }}>
                            {suggestedReply}
                        </div>
                        <button onClick={copyToClipboard} style={copyBtnStyle}>
                            {copied ? "✓ Copied" : "Copy"}
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Error */}
            {error && (
                <div style={{ ...cardStyle, borderLeft: "3px solid #ef4444", background: "rgba(239,68,68,0.15)", marginTop: 8 }}>
                    {error}
                </div>
            )}

            {/* Empty state */}
            {!translation && !suggestedReply && !isProcessing && !error && (
                <div style={{ textAlign: "center", opacity: 0.4, fontSize: 12, padding: "16px 0" }}>
                    Waiting for conversation...
                </div>
            )}
        </div>
    );
};

const labelStyle: React.CSSProperties = {
    fontSize: 10,
    opacity: 0.45,
    letterSpacing: "0.05em",
    marginBottom: 3,
    fontWeight: 600,
};

const cardStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    background: "rgba(255,255,255,0.08)",
    lineHeight: 1.45,
    fontSize: 13,
};

const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "4px 6px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.08)",
    color: "#e5e7eb",
    fontSize: 12,
};

const copyBtnStyle: React.CSSProperties = {
    marginTop: 6,
    padding: "5px 12px",
    background: "rgba(59,130,246,0.4)",
    border: "none",
    borderRadius: 6,
    color: "#e5e7eb",
    fontSize: 11,
    cursor: "pointer",
};

export default LanguageLearningOverlay;
