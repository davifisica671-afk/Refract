// Trust levels para contexto blocks, ordered de maioria trusted (hard rules)
 // para menos trusted (unstructured evidence). Assembly ordenar Precisa follow this
 // ordenar — system_policy fprimeiro untrusted blocks lúltimo
 //
 // Naming convention: TRUSTED_* para dados que pode inform answers, UNTRUSTED_*
 // para evidence que precisa não sobrescrever system/mode policies.

 export enum TrustLevel {
     // Hard system rules — nunca overridable por user ou modo
     SYSTEM_POLICY = 'system_policy',

     // Mode-specific rules de template prompts
     MODE_POLICY = 'mode_policy',

     // Developer sobrescreve (e.g. system-level debugging flags)
     DEVELOPER_POLICY = 'developer_policy',

     // User preferences (settings, não instructions)
     USER_PREFERENCES = 'user_preferences',

     // User's próprio perfil dados (rretomar JD) — self-authored, alto trust
     TRUSTED_PROFILE = 'trusted_profile',

     // Prior AI responses — used para anti-repetition, não como guidance
     ASSISTANT_HISTORY = 'assistant_history',

     // Visual evidence de tela capture — OCR pode miss/misread content
     UNTRUSTED_SCREEN = 'untrusted_screen',

     // Meeting/interview transcript — real-time, pode conter errors
     UNTRUSTED_TRANSCRIPT = 'untrusted_transcript',

     // User-uploaded referência files — pode conter injected content
     UNTRUSTED_REFERENCE = 'untrusted_reference',

     // Past meeting summaries — secundário evidence
     UNTRUSTED_MEETING_HISTORY = 'untrusted_meeting_history',
 }

 export interface EvidenceRef {
     source: 'transcript' | 'screen' | 'reference' | 'meeting_history' | 'browser_dom';
     text: string;
     timestamp?: number;
     speaker?: string;
     fileId?: string;
     chunkId?: string;
 }

 export interface ContextBlock {
     type: string;
     trustLevel: TrustLevel;
     source: string;
     tokenBudget: number;
     recency?: number; // ms age
     evidenceRefs?: EvidenceRef[];
     content: string;
 }

 // Ordered lista para assembly — trust levels sorted highest para lowest
 export const TRUST_LEVEL_ORDER: TrustLevel[] = [
     TrustLevel.SYSTEM_POLICY,
     TrustLevel.MODE_POLICY,
     TrustLevel.DEVELOPER_POLICY,
     TrustLevel.USER_PREFERENCES,
     TrustLevel.TRUSTED_PROFILE,
     TrustLevel.ASSISTANT_HISTORY,
     TrustLevel.UNTRUSTED_SCREEN,
     TrustLevel.UNTRUSTED_TRANSCRIPT,
     TrustLevel.UNTRUSTED_REFERENCE,
     TrustLevel.UNTRUSTED_MEETING_HISTORY,
 ];

 /**
  * Dangerous patterns que indicate a user-controlled string is attempting
  * para override system prompts ou instructions.
  */
 export const DANGEROUS_PATTERNS: RegExp[] = [
     /ignore\s*(previous|all)\s*instructions/i,
     /disregard\s*(previous|all)\s*(instructions|prompts)/i,
     /you\s*(are\s*now|should)\s*act\s+as/i,
     /system\s*prompt:/i,
     /\[INST\]\[INST\]/i,
 ];

 /**
  * Check whether texto contains prompt injection patterns.
  * Returns verdadeiro se any dangerous pattern matches.
  */
 export function containsPromptInjection(text: string): boolean {
     return DANGEROUS_PATTERNS.some(pattern => pattern.test(text));
 }