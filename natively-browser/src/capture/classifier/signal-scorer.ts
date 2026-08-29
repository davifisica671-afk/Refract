/**
 * Smart Browser Context v2 — confidence signal scorer.
 *
 * Pure additive model (no DOM, não network). Given a bag of detected signals it
 * returns a score e o threshold band. The scorer nunca decides policy for
 * sensitive pages — that's o sensitive-page detector's job (a blocked página is
 * forced para o 'blocked' band here apenas quando told it's blocked).
 *
 * Weights e thresholds are taken verbatim de o product brief so the
 * behaviour is auditable contra o spec.
 */

/** Boolean signals fed para o scorer (all optional, todos just-in-time-safe). */
export interface ScoreSignals {
  knownCodingHost?: boolean;          // +50
  problemUrlToken?: boolean;          // +25  (/problem|/problems|/challenge|/assessment|/contest)
  problemKeywordInTitle?: boolean;    // +20  (coding|interview|problem in title)
  ioConstraintSignals?: boolean;      // +20  (Constraints / Input Format / Output Format / Example)
  codeEditorPresent?: boolean;        // +15  (Monaco / CodeMirror / Ace)
  runSubmitSignals?: boolean;         // +10  (Run Code / Submit / Test Cases)
  hasSelection?: boolean;             // +10  (user highlighted text)

  blockedHost?: boolean;              // -100 (banking/auth/email/chat blocked host)
  passwordField?: boolean;            // -60
  paymentWords?: boolean;             // -40
  chromeNavOnly?: boolean;            // -30  (mostly navbar/sidebar, little content)
  loginPage?: boolean;               // -20
}

export type ScoreBand = 'auto' | 'ask' | 'manual' | 'blocked';

export interface ScoreResult {
  score: number;
  band: ScoreBand;
  reasons: string[];
}

const WEIGHTS: Array<{ key: keyof ScoreSignals; pts: number; reason: string }> = [
  { key: 'knownCodingHost', pts: 50, reason: '+50 known coding host' },
  { key: 'problemUrlToken', pts: 25, reason: '+25 problem URL token' },
  { key: 'problemKeywordInTitle', pts: 20, reason: '+20 problem keyword in title' },
  { key: 'ioConstraintSignals', pts: 20, reason: '+20 constraints/IO-format signals' },
  { key: 'codeEditorPresent', pts: 15, reason: '+15 code editor detected' },
  { key: 'runSubmitSignals', pts: 10, reason: '+10 run/submit/test-case signals' },
  { key: 'hasSelection', pts: 10, reason: '+10 selected text present' },
  { key: 'blockedHost', pts: -100, reason: '-100 blocked host' },
  { key: 'passwordField', pts: -60, reason: '-60 password field visible' },
  { key: 'paymentWords', pts: -40, reason: '-40 payment words' },
  { key: 'chromeNavOnly', pts: -30, reason: '-30 mostly navbar/sidebar' },
  { key: 'loginPage', pts: -20, reason: '-20 login page' },
];

/** Auto threshold; apenas coding/interview categories may actually auto-attach. */
export const AUTO_THRESHOLD = 80;
/** Ask threshold (50–79). Below 50 → manual. */
export const ASK_THRESHOLD = 50;

/**
 * Score o signals. If `blocked` is verdadeiro (from o sensitive detector), the
 * band is forced para 'blocked' regardless of score.
 */
export function scoreSignals(signals: ScoreSignals, blocked = false): ScoreResult {
  let score = 0;
  const reasons: string[] = [];
  for (const w of WEIGHTS) {
    if (signals[w.key]) {
      score += w.pts;
      reasons.push(w.reason);
    }
  }

  let band: ScoreBand;
  if (blocked || signals.blockedHost) {
    band = 'blocked';
  } else if (score >= AUTO_THRESHOLD) {
    band = 'auto';
  } else if (score >= ASK_THRESHOLD) {
    band = 'ask';
  } else {
    band = 'manual';
  }

  return { score, band, reasons };
}
