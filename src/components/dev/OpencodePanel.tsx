/**
 * OpencodePanel.tsx
 *
 * Painel flutuante de integração com o servidor OpenCode.
 * Permite enviar prompts ao OpenCode e exibir respostas em tempo real.
 * Inclui verificação de conexão, indicador de status e histórico de mensagens.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Bot, Send, X, Terminal, RefreshCw, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';

interface OpencodePanelProps {
  visible: boolean;
  onClose: () => void;
}

export function OpencodePanel({ visible, onClose }: OpencodePanelProps) {
  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      const api = (window as any).electronAPI;
      const result = await api?.opencodeHealth();
      setConnected(result?.connected || false);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { checkConnection(); }, [checkConnection]);

  const handleSend = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    const text = prompt.trim();
    setPrompt('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const api = (window as any).electronAPI;
      const result = await api?.opencodePrompt(text);
      if (result?.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: result.output }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${result?.error || 'Unknown error'}` }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [prompt, loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-4 right-4 w-[560px] max-h-[75vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2 text-purple-400">
              <Bot size={18} />
              <span className="font-semibold text-sm">OpenCode</span>
              {checking ? (
                <RefreshCw size={12} className="animate-spin text-gray-500" />
              ) : connected ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle size={10} /> Connected</span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle size={10} /> Offline</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={checkConnection}
                className="text-gray-400 hover:text-white transition-colors"
                title="Reconnect"
              >
                <RefreshCw size={14} />
              </button>
              <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[400px]">
            {!connected && !checking && (
              <div className="text-center py-8 text-gray-500">
                <Terminal size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">OpenCode server not detected</p>
                <p className="text-xs mt-1">Run <code className="bg-gray-800 px-1.5 py-0.5 rounded text-purple-300">opencode serve</code> in your terminal</p>
              </div>
            )}
            {messages.length === 0 && connected && (
              <p className="text-center text-gray-500 text-sm py-8">Ask OpenCode to help with your code</p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-4 py-2 text-sm ${msg.role === 'user' ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-200'}`}>
                  <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 rounded-lg px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-gray-700">
            <div className="flex gap-2">
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={connected ? 'Ask OpenCode to write code, explain, review...' : 'Start opencode serve first...'}
                rows={2}
                disabled={!connected}
                className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 resize-none focus:outline-none focus:border-purple-500 disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!connected || !prompt.trim() || loading}
                className="self-end px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
