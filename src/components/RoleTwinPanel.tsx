import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  Check,
  CircleAlert,
  FileSearch,
  Globe2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Radar,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import type { RoleTwin } from '../types/roleTwin';

interface RoleTwinPanelProps {
  open: boolean;
  onClose: () => void;
  onActiveChange?: (twin: RoleTwin | null) => void;
}

type RoleForm = {
  id?: string;
  company: string;
  roleTitle: string;
  jobDescription: string;
};

const emptyForm = (): RoleForm => ({ company: '', roleTitle: '', jobDescription: '' });

export const RoleTwinPanel: React.FC<RoleTwinPanelProps> = ({ open, onClose, onActiveChange }) => {
  const [twins, setTwins] = useState<RoleTwin[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<RoleForm>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => twins.find((twin) => twin.id === selectedId) || twins.find((twin) => twin.isActive) || twins[0] || null,
    [selectedId, twins],
  );

  const loadTwins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.roleTwinList();
      const next = Array.isArray(result) ? result : [];
      setTwins(next);
      const active = next.find((twin) => twin.isActive) || next[0] || null;
      setSelectedId(active?.id || null);
      onActiveChange?.(next.find((twin) => twin.isActive) || null);
      if (!next.length) setEditing(true);
    } catch (cause) {
      console.error('Failed to load Role Twins:', cause);
      setError('Your target roles could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [onActiveChange]);

  useEffect(() => {
    if (open) void loadTwins();
  }, [loadTwins, open]);

  const beginNew = () => {
    setError(null);
    setForm(emptyForm());
    setEditing(true);
  };

  const beginEdit = (twin: RoleTwin) => {
    setError(null);
    setForm({ id: twin.id, company: twin.company, roleTitle: twin.roleTitle, jobDescription: twin.jobDescription });
    setEditing(true);
  };

  const analyze = async () => {
    if (!form.company.trim() || !form.roleTitle.trim()) {
      setError('Add the company and role title first.');
      return;
    }
    if (!form.jobDescription.trim()) {
      setError('Paste the job description so Role Twin can map real requirements.');
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      const result = await window.electronAPI.roleTwinAnalyze({ ...form, forceResearch: true });
      if (!result.success || !result.twin) throw new Error(result.error || 'Role Twin could not be built.');
      const exists = twins.some((twin) => twin.id === result.twin!.id);
      const next = (exists
        ? twins.map((twin) => twin.id === result.twin!.id ? result.twin! : { ...twin, isActive: false })
        : [result.twin, ...twins.map((twin) => ({ ...twin, isActive: false }))]);
      setTwins(next);
      setSelectedId(result.twin.id);
      setEditing(false);
      onActiveChange?.(result.twin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Role Twin could not be built.');
    } finally {
      setAnalyzing(false);
    }
  };

  const activate = async (twin: RoleTwin) => {
    const result = await window.electronAPI.roleTwinSetActive(twin.id);
    if (!result.success) {
      setError('This opportunity could not be activated.');
      return;
    }
    const next = twins.map((item) => ({ ...item, isActive: item.id === twin.id }));
    setTwins(next);
    setSelectedId(twin.id);
    onActiveChange?.(next.find((item) => item.id === twin.id) || null);
  };

  const remove = async (twin: RoleTwin) => {
    const result = await window.electronAPI.roleTwinDelete(twin.id);
    if (!result.success) {
      setError('This opportunity could not be removed.');
      return;
    }
    const remaining = twins.filter((item) => item.id !== twin.id);
    setTwins(remaining);
    const nextActive = remaining.find((item) => item.isActive) || null;
    setSelectedId(nextActive?.id || remaining[0]?.id || null);
    onActiveChange?.(nextActive);
    if (!remaining.length) beginNew();
  };

  const requirements = selected?.analysis?.requirements || [];
  const matchedCount = requirements.filter((requirement) => requirement.status === 'matched').length;
  const gapCount = requirements.filter((requirement) => requirement.status === 'gap').length;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="story-bank-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <motion.button type="button" className="story-bank-scrim" aria-label="Close Role Twin" onClick={onClose} />
          <motion.aside
            className="story-bank-panel role-twin-panel"
            initial={{ x: '100%', opacity: 0.72 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.72 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            aria-label="Company and Role Twin"
          >
            <header className="story-bank-header">
              <div>
                <span className="story-bank-mark role-twin-mark"><BriefcaseBusiness size={15} /></span>
                <span>
                  <strong>{editing ? (form.id ? 'Update target role' : 'New target role') : 'Company & Role Twin'}</strong>
                  <small>{editing ? 'Grounded in the real job description' : 'Your opportunity intelligence'}</small>
                </span>
              </div>
              <button type="button" onClick={editing && twins.length ? () => setEditing(false) : onClose} aria-label={editing && twins.length ? 'Back to role' : 'Close'}>
                {editing && twins.length ? <ArrowLeft size={16} /> : <X size={16} />}
              </button>
            </header>

            {editing ? (
              <div className="story-bank-editor role-twin-editor">
                <section className="role-twin-editor-hero">
                  <span><Radar size={18} /></span>
                  <div><strong>Build an opportunity twin</strong><p>Map the hiring bar to evidence you already have — and expose the gaps worth practicing.</p></div>
                </section>

                <div className="role-twin-form-grid">
                  <label>
                    <span>Company</span>
                    <input value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} placeholder="e.g. Stripe" />
                  </label>
                  <label>
                    <span>Role title</span>
                    <input value={form.roleTitle} onChange={(event) => setForm((current) => ({ ...current, roleTitle: event.target.value }))} placeholder="e.g. Senior Product Engineer" />
                  </label>
                </div>

                <label className="role-twin-jd-field">
                  <span>Job description <small>{form.jobDescription.length.toLocaleString()} characters</small></span>
                  <textarea rows={15} value={form.jobDescription} onChange={(event) => setForm((current) => ({ ...current, jobDescription: event.target.value }))} placeholder="Paste the full job description here. Role Twin will extract requirements, seniority signals, interview themes, and evidence gaps." />
                </label>

                <div className="role-twin-analysis-preview">
                  <div><Target size={14} /><span><strong>Requirement map</strong><small>Must-haves versus your evidence</small></span></div>
                  <div><Globe2 size={14} /><span><strong>Company signals</strong><small>Culture, products and recent context</small></span></div>
                  <div><Sparkles size={14} /><span><strong>Practice strategy</strong><small>Questions and gaps to rehearse</small></span></div>
                </div>

                {error && <div className="story-bank-inline-error">{error}</div>}

                <motion.button type="button" className="story-bank-primary role-twin-analyze" onClick={() => void analyze()} disabled={analyzing} whileTap={{ scale: 0.985 }}>
                  <span><strong>{analyzing ? 'Building your Role Twin' : form.id ? 'Rebuild intelligence' : 'Analyze this opportunity'}</strong><small>{analyzing ? 'Researching company and mapping evidence…' : 'Sets this as your active Practice target'}</small></span>
                  {analyzing ? <Loader2 className="practice-spin" size={17} /> : <ArrowUpRight size={17} />}
                </motion.button>
              </div>
            ) : loading ? (
              <div className="story-bank-loading role-twin-full-loading"><Loader2 className="practice-spin" size={20} /><span>Loading opportunity intelligence…</span></div>
            ) : selected ? (
              <div className="role-twin-content">
                <div className="role-twin-switcher">
                  <div className="role-twin-opportunities">
                    {twins.map((twin) => (
                      <button type="button" key={twin.id} className={twin.id === selected.id ? 'is-selected' : ''} onClick={() => setSelectedId(twin.id)} title={`${twin.roleTitle} at ${twin.company}`}>
                        {twin.company.charAt(0).toUpperCase()}
                        {twin.isActive && <i />}
                      </button>
                    ))}
                    <button type="button" className="role-twin-new" onClick={beginNew} aria-label="Add opportunity"><Plus size={14} /></button>
                  </div>
                  <span>{twins.length} {twins.length === 1 ? 'opportunity' : 'opportunities'}</span>
                </div>

                <section className="role-twin-score-hero">
                  <div className="role-twin-company-mark"><Building2 size={21} /><span>{selected.company.slice(0, 1).toUpperCase()}</span></div>
                  <div className="role-twin-title-copy">
                    <p className="practice-eyebrow">{selected.isActive ? 'Active Practice target' : 'Saved opportunity'}</p>
                    <h2>{selected.roleTitle}</h2>
                    <p><strong>{selected.company}</strong>{selected.analysis.location ? <><i /> <MapPin size={10} />{selected.analysis.location}</> : null}</p>
                  </div>
                  <div className="role-twin-coverage"><strong>{selected.analysis.coverageScore}</strong><span>%</span><small>coverage</small></div>
                </section>

                {!selected.isActive && (
                  <button type="button" className="role-twin-activate" onClick={() => void activate(selected)}><Target size={13} /> Use for Practice</button>
                )}

                <section className="role-twin-overview-card">
                  <div className="role-twin-card-label"><FileSearch size={13} /><span>Role intelligence</span><small>{selected.analysis.level || 'Level not specified'}</small></div>
                  <p>{selected.analysis.roleSummary || 'Role Twin mapped this opportunity from the supplied job description.'}</p>
                  {selected.analysis.keywords?.length > 0 && <div className="role-twin-keywords">{selected.analysis.keywords.slice(0, 7).map((keyword) => <span key={keyword}>{keyword}</span>)}</div>}
                </section>

                {selected.companyDossier?.summary && (
                  <section className="role-twin-company-card">
                    <div className="role-twin-card-label"><Globe2 size={13} /><span>Company signal</span>{selected.companyDossier.sources?.length ? <small>{selected.companyDossier.sources.length} sources</small> : null}</div>
                    <p>{selected.companyDossier.summary}</p>
                    {selected.companyDossier.culture && selected.companyDossier.culture.length > 0 && <div className="role-twin-keywords is-company">{selected.companyDossier.culture.slice(0, 5).map((item) => <span key={item}>{item}</span>)}</div>}
                  </section>
                )}

                <section className="role-twin-requirements">
                  <div className="role-twin-section-heading">
                    <div><strong>Hiring bar</strong><small>Requirement → your evidence</small></div>
                    <span><b>{matchedCount}</b> matched <i /> <b>{gapCount}</b> gaps</span>
                  </div>
                  <div className="role-twin-requirement-list">
                    {requirements.map((requirement) => (
                      <article key={requirement.id} className={`is-${requirement.status}`}>
                        <span className="role-requirement-status">
                          {requirement.status === 'matched' ? <Check size={12} /> : requirement.status === 'partial' ? <Target size={11} /> : <CircleAlert size={12} />}
                        </span>
                        <div>
                          <span className="role-requirement-meta"><b>{requirement.priority}</b>{requirement.category}</span>
                          <strong>{requirement.label}</strong>
                          {requirement.evidence.length > 0 ? <p>{requirement.evidence.join(' · ')}</p> : requirement.preparationNote ? <p>{requirement.preparationNote}</p> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                {selected.analysis.interviewThemes?.length > 0 && (
                  <section className="role-twin-themes">
                    <div className="role-twin-card-label"><Sparkles size={13} /><span>Likely interview themes</span></div>
                    <div>{selected.analysis.interviewThemes.slice(0, 6).map((theme, index) => <span key={theme}><i>{index + 1}</i>{theme}</span>)}</div>
                  </section>
                )}

                <div className="role-twin-footer-actions">
                  <button type="button" onClick={() => beginEdit(selected)}><Pencil size={13} /> Edit & refresh</button>
                  <button type="button" onClick={() => void remove(selected)}><Trash2 size={13} /> Remove</button>
                </div>
                {error && <div className="story-bank-inline-error">{error}</div>}
              </div>
            ) : null}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default RoleTwinPanel;
