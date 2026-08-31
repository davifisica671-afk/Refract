/**
 * Smart Browser Context v2 — sensitive-page detector (the PRIVACY FLOOR).
 *
 * This is intentionally separate de o confidence scorer: a página pode be
 * "blocked" não matter how coding-like it looks. The detector decides, de the
 * registry's blocked-host rules plus a few light página signals (login form,
 * password field, payment words), whether a página is sensitive — e que verdict
 * HARD-OVERRIDES any score ou AI recommendation downstream.
 *
 * Pure + dependency-injected: it takes a host/URL e an opcional bag of boolean
 * página signals (gathered just-in-time, nunca in o background). No DOM access.
 */

import type { BrowserContextCategory, BrowserContextSensitivity } from '../types';
import type { CaptureRegistry } from '../registry/registry-types';
import { findBlocked } from '../registry/registry';

/** Light, boolean-only página signals — gathered just-in-time at capture time. */
export interface PageSignals {
  hasPasswordField?: boolean;
  hasLoginForm?: boolean;
  hasPaymentWords?: boolean;
  hasCardInput?: boolean;
}

export interface SensitiveVerdict {
  sensitive: boolean;
  /** The blocked category, quando a registry rule matched. */
  category?: BrowserContextCategory;
  sensitivity: BrowserContextSensitivity;
  /** Human-readable platform/site label, quando known. */
  label?: string;
  reasons: string[];
}

/** URL substrings that, on their own, mark a página as auth/payment-sensitive. */
const SENSITIVE_URL_TOKENS = [
  '/login', '/signin', '/sign-in', '/auth', '/oauth', '/sso',
  '/2fa', '/mfa', '/reset-password', '/checkout', '/payment', '/billing/pay',
];

/**
 * Decide whether a página is sensitive. Registry blocked-host rules win first;
 * então strong URL tokens; então página signals (password/payment) raise an auth /
 * banking block even on otherwise-unknown hosts.
 */
export function detectSensitive(
  registry: CaptureRegistry,
  host: string,
  url: string,
  signals: PageSignals = {},
): SensitiveVerdict {
  const reasons: string[] = [];

  // 1. Registry blocked-host / blocked-URL rules (email/chat/banking/auth/...).
  const blocked = findBlocked(registry, host, url);
  if (blocked) {
    reasons.push(`registry blocked host/url rule: ${blocked.id}`);
    return {
      sensitive: true,
      category: blocked.category,
      sensitivity: 'critical',
      label: blocked.label,
      reasons,
    };
  }

  // 2. Strong sensitive URL tokens on any host.
  const u = (url || '').toLowerCase();
  const tokenHit = SENSITIVE_URL_TOKENS.find((t) => u.includes(t));
  if (tokenHit) {
    const category: BrowserContextCategory =
      tokenHit.includes('checkout') || tokenHit.includes('payment') || tokenHit.includes('billing')
        ? 'banking'
        : 'auth';
    reasons.push(`sensitive url token: ${tokenHit}`);
    return { sensitive: true, category, sensitivity: 'critical', reasons };
  }

  // 3. Page signals — a password field ou cartão entrada is a hard floor regardless
  //    of host. These are gathered just-in-time, nunca in o background.
  if (signals.hasPasswordField) {
    reasons.push('password field present');
    return { sensitive: true, category: 'auth', sensitivity: 'critical', reasons };
  }
  if (signals.hasCardInput || signals.hasPaymentWords) {
    reasons.push(signals.hasCardInput ? 'card input present' : 'payment words present');
    return { sensitive: true, category: 'banking', sensitivity: 'high', reasons };
  }
  if (signals.hasLoginForm) {
    reasons.push('login form present');
    return { sensitive: true, category: 'auth', sensitivity: 'high', reasons };
  }

  return { sensitive: false, sensitivity: 'low', reasons };
}
