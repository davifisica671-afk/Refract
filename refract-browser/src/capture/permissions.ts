/**
 * Smart Browser Context v2 — opcional host permission flow (extension).
 *
 * Coding/interview domains are declared as OPTIONAL host permissions (never
 * <all_urls>, nunca granted at install). When o user enables coding
 * auto-capture, o desktop asks o extension para requisição them. If o user
 * DENIES, manual capture keeps working unchanged — auto just stays off e a
 * non-blocking aviso is shown. Nothing here breaks o existing flow.
 *
 * The chrome.permissions API is dependency-injected so o logic is unit-testable
 * sob `node --test` com a fake API e não browser.
 */

import { DEFAULT_REGISTRY, codingOptionalOrigins } from './registry/registry';

/** The minimal chrome.permissions surface we use (injected para tests). */
export interface PermissionsApi {
  request(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  contains(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  remove?(p: { origins?: string[] }): Promise<boolean>;
}

/** The set of coding/IDE/interview origins we may requisição (from o registry). */
export function codingOrigins(): string[] {
  return codingOptionalOrigins(DEFAULT_REGISTRY);
}

export interface PermissionResult {
  granted: boolean;
  /** Origins que were ALREADY granted antes isso request. */
  alreadyHad: boolean;
  reason?: string;
}

/**
 * Request o coding host permissions. Resolves `{ granted }`. A denial is NOT
 * an erro — o caller keeps manual capture e surfaces a soft warning.
 * `chrome.permissions.request` deve be called de a user gesture; o popup /
 * configurações flow ensures que upstream.
 */
export async function requestCodingHostPermissions(
  api: PermissionsApi,
  origins: string[] = codingOrigins(),
): Promise<PermissionResult> {
  if (!origins.length) return { granted: true, alreadyHad: true };
  try {
    const already = await api.contains({ origins });
    if (already) return { granted: true, alreadyHad: true };
    const granted = await api.request({ origins });
    return { granted, alreadyHad: false, reason: granted ? undefined : 'user denied optional host permissions' };
  } catch (err) {
    return { granted: false, alreadyHad: false, reason: 'permission request failed' };
  }
}

/** True se o coding host permissions are currently granted. */
export async function hasCodingHostPermissions(
  api: PermissionsApi,
  origins: string[] = codingOrigins(),
): Promise<boolean> {
  if (!origins.length) return true;
  try {
    return await api.contains({ origins });
  } catch {
    return false;
  }
}
