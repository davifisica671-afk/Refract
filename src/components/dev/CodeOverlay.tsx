/**
 * CodeOverlay.tsx
 *
 * Overlay de assistência de código com múltiplos modos:
 * explicar, gerar, revisar, refatorar e testar código.
 * Envia código ao backend via streaming e exibe o resultado em tempo real.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Code, FileCode, Play, Bug, RefreshCw, X, Zap, TestTube, GitBranch } from 'lucide-react';

interface CodeOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export function CodeOverlay({ visible, onClose }: CodeOverlayProps) {
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('typescript');
  const [mode, setMode] = useState<'explain' | 'generate' | 'review' | 'refactor' | 'test'>('explain');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAction = useCallback(async () => {
    setLoading(true);
    setResult('');
    const channel = `code:${mode}`;
    try {
      const api = (window as any).electronAPI;
      if (!api) return;
      const gen = api[channel](code, language);
      for await (const token of gen) {
        setResult(prev => prev + token);
      }
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [code, language, mode]);

  const languages = ['typescript', 'javascript', 'python', 'rust', 'go', 'java', 'cpp', 'csharp', 'ruby', 'php'];
  const modes = [
    { key: 'explain' as const, icon: FileCode, label: 'Explain' },
    { key: 'generate' as const, icon: Zap, label: 'Generate' },
    { key: 'review' as const, icon: Bug, label: 'Review' },
    { key: 'refactor' as const, icon: RefreshCw, label: 'Refactor' },
    { key: 'test' as const, icon: TestTube, label: 'Tests' },
  ];

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-4 right-4 w-[600px] max-h-[80vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2 text-emerald-400">
              <Code size={18} />
              <span className="font-semibold text-sm">Code Assistant</span>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex gap-2 px-4 py-2 bg-gray-850 border-b border-gray-700 overflow-x-auto">
            {modes.map(m => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  mode === m.key
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                <m.icon size={14} />
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex gap-2">
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                className="bg-gray-800 text-gray-200 text-xs rounded-lg px-2 py-1 border border-gray-700"
              >
                {languages.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <div className="flex-1" />
              <button
                onClick={handleAction}
                disabled={loading || !code.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                {loading ? 'Processing...' : 'Run'}
              </button>
            </div>

            {mode === 'generate' ? (
              <textarea
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="Describe what you want to generate..."
                className="w-full h-24 bg-gray-800 text-gray-200 text-sm rounded-lg p-3 border border-gray-700 resize-none focus:outline-none focus:border-emerald-500"
              />
            ) : (
              <textarea
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder={`Paste your ${language} code here...`}
                className="w-full h-32 bg-gray-800 text-gray-200 text-sm font-mono rounded-lg p-3 border border-gray-700 resize-none focus:outline-none focus:border-emerald-500"
              />
            )}

            {result && (
              <div className="bg-gray-850 border border-gray-700 rounded-lg p-3">
                <pre className="text-gray-200 text-sm font-mono whitespace-pre-wrap">{result}</pre>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
