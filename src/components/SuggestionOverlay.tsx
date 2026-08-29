import React, { useState, useEffect } from 'react';

/**
 * SuggestionOverlay.tsx
 * Overlay de sugestões em tempo real durante reuniões/entrevistas.
 * Exibe transcrições ao vivo e sugestões geradas por AI para ajudar
 * o usuário a formular respostas durante conversas.
 */

interface SuggestionOverlayProps {
    className?: string;
}

interface Transcript {
    speaker: string;
    text: string;
    final: boolean;
}

interface GeneratedSuggestion {
    question: string;
    suggestion: string;
    confidence: number;
}

/**
 * SuggestionOverlay — Componente de overlay de sugestões estilo Refract.
 * Exibe transcrições em tempo real e sugestões geradas por AI.
 */
export const SuggestionOverlay: React.FC<SuggestionOverlayProps> = ({ className }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [currentTranscript, setCurrentTranscript] = useState<Transcript | null>(null);
    const [suggestion, setSuggestion] = useState<GeneratedSuggestion | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Inscreve-se para eventos de áudio nativo
        const cleanups: (() => void)[] = [];

        // Status de conexão
        cleanups.push(
            window.electronAPI.onNativeAudioConnected(() => {
                setIsConnected(true);
                console.log('[SuggestionOverlay] Native audio connected');
            })
        );

        cleanups.push(
            window.electronAPI.onNativeAudioDisconnected(() => {
                setIsConnected(false);
                console.log('[SuggestionOverlay] Native audio disconnected');
            })
        );

        // Transcrições em tempo real
        cleanups.push(
            window.electronAPI.onNativeAudioTranscript((transcript) => {
                setCurrentTranscript(transcript);
                // Limpa após atraso se for uma transcrição final
                if (transcript.final) {
                    setTimeout(() => setCurrentTranscript(null), 3000);
                }
            })
        );

        // Status de processamento
        cleanups.push(
            window.electronAPI.onSuggestionProcessingStart(() => {
                setIsProcessing(true);
                setError(null);
            })
        );

        // Sugestões geradas
        cleanups.push(
            window.electronAPI.onSuggestionGenerated((data) => {
                setSuggestion(data);
                setIsProcessing(false);
            })
        );

        // Erros
        cleanups.push(
            window.electronAPI.onSuggestionError((err) => {
                setError(err.error);
                setIsProcessing(false);
            })
        );

        return () => {
            cleanups.forEach(cleanup => cleanup());
        };
    }, []);

    // Não renderiza se não conectado
    if (!isConnected && !suggestion && !currentTranscript) {
        return null;
    }

    return (
        <div className={`suggestion-overlay ${className || ''}`}>
            {/* Indicador de conexão */}
            <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-xs text-gray-400">
                    {isConnected ? 'Live' : 'Disconnected'}
                </span>
            </div>

            {/* Transcrição atual (fala do entrevistador) */}
            {currentTranscript && (
                <div className="transcript-bubble mb-3 p-3 rounded-lg bg-gray-800/80 backdrop-blur-sm border border-gray-700">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-blue-400">
                            {currentTranscript.speaker === 'interviewer' ? '🎤 Interviewer' : '👤 You'}
                        </span>
                        {!currentTranscript.final && (
                            <span className="text-xs text-gray-500 animate-pulse">listening...</span>
                        )}
                    </div>
                    <p className="text-sm text-gray-200">{currentTranscript.text}</p>
                </div>
            )}

            {/* Indicador de processamento */}
            {isProcessing && (
                <div className="processing-indicator flex items-center gap-2 p-3 rounded-lg bg-purple-900/30 border border-purple-700">
                    <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-purple-300">Generating suggestion...</span>
                </div>
            )}

            {/* AI Suggestion */}
            {suggestion && !isProcessing && (
                <div className="suggestion-card p-4 rounded-lg bg-gradient-to-br from-indigo-900/80 to-purple-900/80 backdrop-blur-sm border border-indigo-500/50 shadow-lg shadow-indigo-500/20">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-indigo-300">💡 Suggested Response</span>
                        <span className="text-xs text-gray-400">
                            {Math.round(suggestion.confidence * 100)}% confidence
                        </span>
                    </div>
                    <p className="text-sm text-gray-100 leading-relaxed">{suggestion.suggestion}</p>
                    <div className="mt-2 pt-2 border-t border-indigo-700/50">
                        <p className="text-xs text-gray-400 italic">
                            Re: "{suggestion.question.substring(0, 50)}..."
                        </p>
                    </div>
                </div>
            )}

            {/* Estado de erro */}
            {error && (
                <div className="error-card p-3 rounded-lg bg-red-900/30 border border-red-700">
                    <span className="text-sm text-red-300">⚠️ {error}</span>
                </div>
            )}

            {/* Instructions */}
            <div className="mt-3 text-xs text-gray-500 text-center">
                <p>Say "rephrase that" or "make it shorter" for follow-ups</p>
            </div>
        </div>
    );
};

export default SuggestionOverlay;
