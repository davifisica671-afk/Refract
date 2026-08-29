/**
 * DevDashboard.tsx
 *
 * Painel de desenvolvimento para indexação e busca em repositórios locais.
 * Permite selecionar um repositório, indexar seus arquivos e consultar
 * o código-fonte por meio de buscas semânticas.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Search, FolderOpen, RefreshCw, X, FileCode, GitBranch, CheckCircle, AlertCircle } from 'lucide-react';

interface DevDashboardProps {
  visible: boolean;
  onClose: () => void;
}

interface IndexStats {
  fileCount: number;
  chunkCount: number;
}

export function DevDashboard({ visible, onClose }: DevDashboardProps) {
  const [repoPath, setRepoPath] = useState('');
  const [indexing, setIndexing] = useState(false);
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [queryResults, setQueryResults] = useState<any[]>([]);

  const addLog = useCallback((msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]), []);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.getRepoPath) api.getRepoPath().then(setRepoPath).catch(() => {});
  }, []);

  const handleSelectFolder = useCallback(async () => {
    const api = (window as any).electronAPI;
    if (!api?.selectFolder) return;
    const folder = await api.selectFolder();
    if (folder) {
      setRepoPath(folder);
      addLog(`Selected repo: ${folder}`);
    }
  }, [addLog]);

  const handleScanRepo = useCallback(async () => {
    if (!repoPath) return;
    setIndexing(true);
    addLog('Scanning repository...');
    try {
      const api = (window as any).electronAPI;
      const result = await api.scanRepo(repoPath);
      setStats(result);
      addLog(`Indexed ${result.fileCount} files (${result.chunkCount} chunks)`);
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
    } finally {
      setIndexing(false);
    }
  }, [repoPath, addLog]);

  const handleQuery = useCallback(async () => {
    if (!query.trim()) return;
    addLog(`Querying: ${query}`);
    try {
      const api = (window as any).electronAPI;
      const results = await api.queryRepo(query, 10);
      setQueryResults(results);
      addLog(`Found ${results.length} results`);
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
    }
  }, [query, addLog]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        >
          <div className="w-[720px] max-h-[85vh] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 bg-gray-800 border-b border-gray-700 rounded-t-xl">
              <div className="flex items-center gap-2 text-emerald-400">
                <GitBranch size={20} />
                <span className="font-semibold">Dev Dashboard</span>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <FolderOpen size={16} /> Repository
                </h3>
                <div className="flex gap-2">
                  <input
                    value={repoPath}
                    onChange={e => setRepoPath(e.target.value)}
                    placeholder="Path to local repository..."
                    className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleSelectFolder}
                    className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg border border-gray-700 transition-colors"
                  >
                    Browse
                  </button>
                  <button
                    onClick={handleScanRepo}
                    disabled={indexing || !repoPath}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {indexing ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
                    {indexing ? 'Indexing...' : 'Index'}
                  </button>
                </div>
                {stats && (
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><FileCode size={14} /> {stats.fileCount} files</span>
                    <span className="flex items-center gap-1"><Database size={14} /> {stats.chunkCount} chunks</span>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                  <Search size={16} /> Search Codebase
                </h3>
                <div className="flex gap-2">
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleQuery()}
                    placeholder="Ask a question about the codebase..."
                    className="flex-1 bg-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleQuery}
                    disabled={!query.trim()}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Search
                  </button>
                </div>
                {queryResults.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {queryResults.map((r, i) => (
                      <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                          <FileCode size={12} />
                          <span>{r.filePath}:{r.line}</span>
                          <span className="text-emerald-500">{(r.score * 100).toFixed(0)}%</span>
                        </div>
                        <pre className="text-gray-200 font-mono text-xs whitespace-pre-wrap line-clamp-3">{r.content}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-300">Activity Log</h3>
                <div className="bg-gray-850 border border-gray-700 rounded-lg p-3 h-32 overflow-y-auto">
                  {log.length === 0 ? (
                    <p className="text-gray-500 text-xs italic">No activity yet</p>
                  ) : (
                    log.map((entry, i) => (
                      <p key={i} className="text-gray-400 text-xs font-mono">{entry}</p>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
