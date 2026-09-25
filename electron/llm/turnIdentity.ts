// electron/llm/turnIdentity.ts
//
// REAL logic (not a degraded stub): mints a UUID v4 turn id via node:crypto.
// No importer is modified.

import * as crypto from 'crypto';

export function mintTurnId(): string {
  return crypto.randomUUID();
}
