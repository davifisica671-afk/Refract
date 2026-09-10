#!/usr/bin/env node
/**
 * create-premium-stubs.mjs — generates local, gitignored stubs for the private
 * premium modules so the open-source build (`npm run build:electron`) can
 * resolve the dynamic `require('../../premium/electron/...')` calls that the
 * private /premium directory normally provides.
 *
 * Background
 *   /premium is gitignored ("Local premium dev copy — never commit to public
 *   repo"). It holds LicenseManager, the KnowledgeOrchestrator and friends.
 *   electron/services/PurchaseActivationService.ts, LemonSqueezyManager.ts,
 *   RoleTwinManager.ts and main.ts all `require()` those modules at runtime,
 *   guarded by try/catch (see electron/premium/featureGate.ts). esbuild's
 *   bundle step resolves those requires at build time, so a clean checkout
 *   fails with "Could not resolve .../LicenseManager" unless either the real
 *   premium copy or these stubs exist.
 *
 * What the stubs do
 *   They are minimal, behavior-preserving stand-ins that let the build finish
 *   and make premium paths degrade to open-source mode at runtime:
 *     LicenseManager.isPremium() === false
 *     KnowledgeOrchestrator / KnowledgeDatabaseManager exist but are no-ops
 *     textHasCompEvidence() === false
 *     DocType enum mirrors the premium constants
 *
 *   They live under /premium, which is gitignored, so they never enter git.
 *   On a machine WITH the real premium copy, delete /premium (or don't run
 *   this) and the real modules are bundled instead.
 *
 * Usage
 *     node scripts/create-premium-stubs.mjs
 *     npm run build:electron
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const premiumDir = path.join(root, 'premium', 'electron');

const FILES = {
  'services/LicenseManager.ts': `// LOCAL DEV STUB — lives in gitignored /premium. The real private premium
// module is not committed. This stub exists so the open-source build resolves
// the dynamic require(); it reports "not premium" so premium paths degrade to
// open-source mode (isPremium() === false).
export class LicenseManager {
  private static instance: LicenseManager;
  static getInstance(): LicenseManager {
    if (!LicenseManager.instance) LicenseManager.instance = new LicenseManager();
    return LicenseManager.instance;
  }
  isPremium(): boolean { return false; }
  async activateLicense(_key: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'premium not available (local dev stub)' };
  }
  async deactivate(): Promise<void> {}
  getLicenseDetails(): null { return null; }
  getHardwareId(): string { return 'stub'; }
}
export default LicenseManager;
`,
  'knowledge/KnowledgeDatabaseManager.ts': `export class KnowledgeDatabaseManager {
  constructor(_db: any) {}
}
export default KnowledgeDatabaseManager;
`,
  'knowledge/KnowledgeOrchestrator.ts': `export class KnowledgeOrchestrator {
  constructor(_db: any) {}
  setKnowledgeMode(_v: boolean): void {}
  deleteDocumentsByType(_t: unknown): void {}
  assemblePromptContext(): string { return ''; }
}
export default KnowledgeOrchestrator;
`,
  'knowledge/NegotiationConversationTracker.ts': `export function textHasCompEvidence(_text: string): boolean { return false; }
`,
  'knowledge/CompanyResearchEngine.ts': `export class CompanyResearchEngine {
  private provider: unknown = null;
  constructor(_db: any, _gen: any) {}
  setSearchProvider(p: unknown): void { this.provider = p; }
  async researchCompany(): Promise<null> { return null; }
}
export default CompanyResearchEngine;
`,
  'knowledge/RefractSearchProvider.ts': `export class RefractSearchProvider {
  constructor(_key: string) {}
}
export default RefractSearchProvider;
`,
  'knowledge/TavilySearchProvider.ts': `export class TavilySearchProvider {
  constructor(_key: string) {}
}
export default TavilySearchProvider;
`,
  'knowledge/types.ts': `export enum DocType {
  RESUME = 'resume',
  JD = 'jd',
  NOTES = 'notes',
  DOCUMENT = 'document',
}
`,
};

for (const [rel, content] of Object.entries(FILES)) {
  const full = path.join(premiumDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full)) {
    console.log(`skip   ${rel} (already exists — left untouched)`);
    continue;
  }
  fs.writeFileSync(full, content);
  console.log(`wrote  ${rel}`);
}

console.log('\nDone. /premium is gitignored, so these stubs will not be committed.');
