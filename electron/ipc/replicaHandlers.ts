/**
 * replicaHandlers.ts — Replica / Interview Coach IPC.
 *
 * Interview practice mode: Refract becomes the interviewer, asks questions
 * adapted to the profile/JD, evaluates answers and generates a debrief.
 */
import * as crypto from 'crypto';
import { DatabaseManager } from '../db/DatabaseManager';
import { InterviewCoachLLM } from '../llm/InterviewCoachLLM';
import type { AppState } from '../main';
import type { SafeHandle } from './safeIpc';

export function registerReplicaHandlers(appState: AppState, safeHandle: SafeHandle): void {
  safeHandle(
    'replica:start-session',
    async (
      _event,
      data: {
        modeType: string;
        language: string;
        title?: string;
      },
    ) => {
      try {
        const sessionId = crypto.randomUUID();
        const db = DatabaseManager.getInstance();
        db.createReplicaSession(
          sessionId,
          data.modeType || 'technical-interview',
          data.language || 'en',
          data.title || '',
        );
        return { sessionId };
      } catch (err: any) {
        console.error('[IPC] replica:start-session error:', err);
        return { error: err.message || 'Failed to start session' };
      }
    },
  );

  safeHandle(
    'replica:ask-question',
    async (
      event,
      data: {
        sessionId: string;
        userAnswer: string;
        isFirst: boolean;
        modeType: string;
        language: string;
        questionHistory: Array<{
          question: string;
          difficulty: string;
          category: string;
          userAnswer: string;
          feedback: string;
        }>;
      },
    ) => {
      try {
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        if (!llmHelper) {
          event.sender.send('replica-question-error', { error: 'LLM not available' });
          return;
        }

        // Load user profile from DB
        const db = DatabaseManager.getInstance();
        let profile = '';
        let jd = '';
        try {
          const profileRow = db.getDb()?.prepare('SELECT compact_persona FROM user_profile WHERE id = 1').get() as
            { compact_persona: string } | undefined;
          if (profileRow?.compact_persona) profile = profileRow.compact_persona;

          const jdRow = db
            .getDb()
            ?.prepare("SELECT custom_context FROM modes WHERE is_active = 1 AND custom_context != '' LIMIT 1")
            .get() as { custom_context: string } | undefined;
          if (jdRow?.custom_context) jd = jdRow.custom_context;
        } catch {
          /* profile/jd optional — coach works without them */
        }

        const coachLLM = new InterviewCoachLLM(llmHelper);
        let accumulated = '';

        // Generate appropriate question based on session state
        const history = data.questionHistory || [];
        if (data.isFirst) {
          for await (const chunk of coachLLM.generateFirstQuestion(profile, jd, data.modeType)) {
            accumulated += chunk;
            event.sender.send('replica-question-token', { token: chunk, accumulated });
          }
        } else {
          for await (const chunk of coachLLM.generateFollowUp(profile, jd, data.modeType, history, data.userAnswer)) {
            accumulated += chunk;
            event.sender.send('replica-question-token', { token: chunk, accumulated });
          }
        }

        const parsed = InterviewCoachLLM.parseQuestion(accumulated);
        const feedback = InterviewCoachLLM.parseFeedback(accumulated);
        const isEnd = InterviewCoachLLM.isEndSession(accumulated);

        // Persist the exchange to DB if there was a previous answer
        if (!data.isFirst && data.userAnswer) {
          db.appendReplicaQuestion(data.sessionId, {
            question: history.length > 0 ? history[history.length - 1].question : '',
            difficulty: history.length > 0 ? history[history.length - 1].difficulty : 'medium',
            category: history.length > 0 ? history[history.length - 1].category : 'general',
            userAnswer: data.userAnswer,
            feedback: feedback || '',
          });
        }

        event.sender.send('replica-question-done', {
          full: accumulated,
          question: parsed?.question ?? '',
          difficulty: parsed?.difficulty ?? 'medium',
          category: parsed?.category ?? 'general',
          hint: parsed?.hint,
          feedback: feedback ?? '',
          isEndSession: isEnd,
        });
      } catch (err: any) {
        console.error('[IPC] replica:ask-question error:', err);
        event.sender.send('replica-question-error', { error: err.message || 'Failed to generate question' });
      }
    },
  );

  safeHandle(
    'replica:end-session',
    async (
      event,
      data: {
        sessionId: string;
        questionHistory: Array<{
          question: string;
          difficulty: string;
          category: string;
          userAnswer: string;
          feedback: string;
        }>;
        modeType: string;
        startTime: number;
      },
    ) => {
      try {
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        if (!llmHelper) {
          event.sender.send('replica-evaluation-error', { error: 'LLM not available' });
          return;
        }

        const db = DatabaseManager.getInstance();
        let profile = '';
        let jd = '';
        try {
          const profileRow = db.getDb()?.prepare('SELECT compact_persona FROM user_profile WHERE id = 1').get() as
            { compact_persona: string } | undefined;
          if (profileRow?.compact_persona) profile = profileRow.compact_persona;

          const jdRow = db
            .getDb()
            ?.prepare("SELECT custom_context FROM modes WHERE is_active = 1 AND custom_context != '' LIMIT 1")
            .get() as { custom_context: string } | undefined;
          if (jdRow?.custom_context) jd = jdRow.custom_context;
        } catch {
          /* optional */
        }

        const coachLLM = new InterviewCoachLLM(llmHelper);
        let accumulated = '';

        for await (const chunk of coachLLM.generateEvaluation(profile, jd, data.modeType, data.questionHistory)) {
          accumulated += chunk;
          event.sender.send('replica-evaluation-token', { token: chunk, accumulated });
        }

        const evaluation = InterviewCoachLLM.parseEvaluation(accumulated);
        const durationMs = Date.now() - (data.startTime || Date.now());

        db.finalizeReplicaSession(
          data.sessionId,
          evaluation
            ? {
                score: evaluation.score,
                grade: evaluation.overallGrade,
                summary: evaluation.summary,
                strengths: evaluation.strengths,
                improvements: evaluation.improvements,
              }
            : { score: 0, grade: 'N/A', summary: 'Evaluation could not be parsed.', strengths: [], improvements: [] },
          durationMs,
        );

        event.sender.send('replica-evaluation-done', {
          full: accumulated,
          evaluation: evaluation ?? {
            score: 0,
            overallGrade: 'N/A',
            summary: 'Could not parse evaluation.',
            strengths: [],
            improvements: [],
          },
        });
      } catch (err: any) {
        console.error('[IPC] replica:end-session error:', err);
        event.sender.send('replica-evaluation-error', { error: err.message || 'Failed to generate evaluation' });
      }
    },
  );

  safeHandle('replica:get-sessions', async (_event) => {
    try {
      const db = DatabaseManager.getInstance();
      return db.getReplicaSessions(50);
    } catch (err: any) {
      console.error('[IPC] replica:get-sessions error:', err);
      return [];
    }
  });

  safeHandle('replica:get-session-detail', async (_event, sessionId: string) => {
    try {
      const db = DatabaseManager.getInstance();
      return db.getReplicaSessionDetail(sessionId);
    } catch (err: any) {
      console.error('[IPC] replica:get-session-detail error:', err);
      return null;
    }
  });

  safeHandle('replica:open-window', async () => {
    try {
      // Sem optional chaining silencioso: usa o acessador público do AppState
      // e reporta falha de verdade em vez de responder success sem fazer nada.
      const windowHelper = appState.getWindowHelper();
      if (!windowHelper) {
        console.error('[IPC] replica:open-window — windowHelper unavailable');
        return { success: false, error: 'window_helper_unavailable' };
      }
      windowHelper.createReplicaWindow();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] replica:open-window error:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('replica:close-window', async () => {
    try {
      const windowHelper = appState.getWindowHelper();
      if (!windowHelper) {
        console.error('[IPC] replica:close-window — windowHelper unavailable');
        return { success: false, error: 'window_helper_unavailable' };
      }
      windowHelper.hideReplicaWindow();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] replica:close-window error:', err);
      return { success: false, error: err.message };
    }
  });
}
