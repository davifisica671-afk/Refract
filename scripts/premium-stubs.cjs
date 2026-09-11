'use strict';
/**
 * premium-stubs.cjs — canonical no-op stubs for the private /premium module.
 *
 * /premium is gitignored ("Local premium dev copy — never commit to public
 * repo"). It holds LicenseManager, the KnowledgeOrchestrator and friends.
 * Several Electron files `require()` those modules at runtime, guarded by
 * try/catch (see electron/premium/featureGate.ts). Because build-electron.js
 * bundles with esbuild (bundle: true), those requires are resolved at BUILD
 * time — so a clean checkout fails to compile unless the real premium copy or
 * these stubs exist.
 *
 * Consumers:
 *   - scripts/build-electron.js    (esbuild onResolve/onLoad fallback — the
 *                                  build self-heals when premium is absent)
 *   - scripts/create-premium-stubs.mjs (writes these stubs as gitignored
 *                                  files under /premium, for local typecheck
 *                                  convenience)
 *
 * The stubs are behavior-preserving no-ops: LicenseManager.isPremium() is
 * false, the orchestrator methods are empty, textHasCompEvidence() is false,
 * and DocType mirrors the premium enum — so the open-source build degrades to
 * "premium not available" at runtime. (`isPremiumAvailable()` in featureGate
 * is never called anywhere, so the no-op stub semantics are safe.)
 */

const STUBS = {
  LicenseManager: `// Open-source fallback for the private premium LicenseManager.
// Reports "not premium" so premium paths degrade to open-source mode.
export class LicenseManager {
  static getInstance() {
    if (!LicenseManager._instance) LicenseManager._instance = new LicenseManager();
    return LicenseManager._instance;
  }
  isPremium() { return false; }
  async activateLicense(_key) { return { success: false, error: 'premium not available (open-source build)' }; }
  async deactivate() {}
  getLicenseDetails() { return null; }
  getHardwareId() { return 'stub'; }
}
export default LicenseManager;
`,
  KnowledgeOrchestrator: `export class KnowledgeOrchestrator {
  constructor(_db) {}
  setKnowledgeMode(_v) {}
  deleteDocumentsByType(_t) {}
  assemblePromptContext() { return ''; }
}
export default KnowledgeOrchestrator;
`,
  KnowledgeDatabaseManager: `export class KnowledgeDatabaseManager {
  constructor(_db) {}
}
export default KnowledgeDatabaseManager;
`,
  NegotiationConversationTracker: `export function textHasCompEvidence(_text) { return false; }
`,
  CompanyResearchEngine: `export class CompanyResearchEngine {
  constructor(_db, _gen) {}
  setSearchProvider(_p) {}
  async researchCompany() { return null; }
}
export default CompanyResearchEngine;
`,
  RefractSearchProvider: `export class RefractSearchProvider {
  constructor(_key) {}
}
export default RefractSearchProvider;
`,
  TavilySearchProvider: `export class TavilySearchProvider {
  constructor(_key) {}
}
export default TavilySearchProvider;
`,
  types: `export enum DocType {
  RESUME = 'resume',
  JD = 'jd',
  NOTES = 'notes',
  DOCUMENT = 'document',
}
`,
};

/** relative path under premium/electron/ for each stub (used by the file writer). */
const STUB_PATHS = {
  LicenseManager: 'services/LicenseManager.ts',
  KnowledgeOrchestrator: 'knowledge/KnowledgeOrchestrator.ts',
  KnowledgeDatabaseManager: 'knowledge/KnowledgeDatabaseManager.ts',
  NegotiationConversationTracker: 'knowledge/NegotiationConversationTracker.ts',
  CompanyResearchEngine: 'knowledge/CompanyResearchEngine.ts',
  RefractSearchProvider: 'knowledge/RefractSearchProvider.ts',
  TavilySearchProvider: 'knowledge/TavilySearchProvider.ts',
  types: 'knowledge/types.ts',
};

/** TypeScript source for a premium stub module, by file basename (no extension). */
function premiumStubContents(basename) {
  return STUBS[basename] || '// Unknown premium module — open-source fallback stub.\nexport {};\n';
}

module.exports = { STUBS, STUB_PATHS, premiumStubContents };
