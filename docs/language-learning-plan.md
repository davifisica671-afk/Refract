# Language Learning Mode Implementation Plan

## Overview
Add a new 'language-learning' mode to Refract that enables real-time conversation translation with AI-generated suggested responses, using system audio capture and a minimalist floating overlay.

## Architecture Flow

```
System Audio (other person) → MicrophoneCapture → STT → IntelligenceManager
→ LanguageLearningLLM → streamChat() → IPC 'language-learning-translation'
→ LanguageLearningOverlay (minimalist floating panel)
                                        ↓
                                AI suggests reply in target language
                                        ↓
                                IPC 'language-learning-suggested-reply'
                                        ↓
                                Overlay shows suggested response
```

## Step 1: Extend ModeTemplateType

### File: `electron/services/ModesManager.ts`

**Line 33 - Add to union type:**
```typescript
export type ModeTemplateType = 
  | 'general' 
  | 'coding' 
  | 'sales' 
  | 'brainstorm' 
  | 'research' 
  | 'writing' 
  | 'meeting' 
  | 'language-learning';  // ADD THIS
```

**Line 70 - Add to MODE_TEMPLATES array:**
```typescript
{
  type: 'language-learning' as ModeTemplateType,
  label: 'Language Learning',
  description: 'Real-time conversation translation with AI-suggested responses'
}
```

**Line 85 - Add to TEMPLATE_NOTE_SECTIONS:**
```typescript
'language-learning': ['Vocabulary', 'Phrases', 'Grammar Notes', 'Cultural Notes']
```

### File: `electron/llm/modeProfiles.ts`

**Line 29 - Keep in sync with ModesManager:**
```typescript
export type ModeTemplateType = 
  | 'general' 
  | 'coding' 
  | 'sales' 
  | 'brainstorm' 
  | 'research' 
  | 'writing' 
  | 'meeting' 
  | 'language-learning';
```

**Line 85 - Add to MODE_CONTEXT_PROFILES:**
```typescript
'language-learning': {
  routingPriors: {
    'conversation': 0.9,
    'translation': 0.95,
    'learning': 0.85
  }
}
```

## Step 2: Add Settings for Language Pair

### File: `electron/services/CredentialsManager.ts`

Add fields to the credentials/settings structure:
```typescript
interface LanguageLearningSettings {
  sourceLanguage: string;  // e.g., 'en-US'
  targetLanguage: string;  // e.g., 'pt-BR'
  autoTranslate: boolean;  // auto-translate incoming audio
  showSuggestions: boolean; // show AI-suggested responses
}
```

### File: `src/config/languages.ts`

No changes needed - already has `RECOGNITION_LANGUAGES` and `AI_RESPONSE_LANGUAGES` arrays.

### File: Settings UI (location TBD)

Add language pair dropdowns to settings panel:
- Source Language (what other person says)
- Target Language (what user wants to say)
- Toggle for auto-translate
- Toggle for showing suggestions

## Step 3: Create Language Learning LLM Class

### File: `electron/llm/LanguageLearningLLM.ts` (NEW)

```typescript
import { LLMHelper } from './LLMHelper';
import { ProviderRouter } from './ProviderRouter';
import { LanguageLearningPrompt } from './prompts';

export class LanguageLearningLLM {
  private llmHelper: LLMHelper;
  private providerRouter: ProviderRouter;

  constructor() {
    this.llmHelper = new LLMHelper();
    this.providerRouter = new ProviderRouter();
  }

  /**
   * Translate incoming transcript and generate suggested response
   * @param transcript - What the other person said (in source language)
   * @param targetLanguage - Language code for the user to respond in
   * @param conversationHistory - Context of the conversation
   */
  async *translateAndSuggest(
    transcript: string,
    targetLanguage: string,
    conversationHistory: Array<{role: string, content: string}>
  ): AsyncGenerator<{translation: string, suggestedReply: string}> {
    
    const prompt = LanguageLearningPrompt.buildTranslationPrompt(
      transcript,
      targetLanguage,
      conversationHistory
    );

    const provider = await this.providerRouter.getProvider();
    
    const stream = this.llmHelper.streamChat(
      prompt,
      provider,
      { temperature: 0.7, maxTokens: 500 }
    );

    let fullResponse = '';
    for await (const chunk of stream) {
      fullResponse += chunk;
      
      // Parse the structured response
      const parsed = this.parseTranslationResponse(fullResponse);
      if (parsed) {
        yield parsed;
      }
    }
  }

  private parseTranslationResponse(response: string): {translation: string, suggestedReply: string} | null {
    // Parse format: [TRANSLATION]...[/TRANSLATION] [SUGGESTION]...[/SUGGESTION]
    const translationMatch = response.match(/\[TRANSLATION\]([\s\S]*?)\[\/TRANSLATION\]/);
    const suggestionMatch = response.match(/\[SUGGESTION\]([\s\S]*?)\[\/SUGGESTION\]/);
    
    if (translationMatch && suggestionMatch) {
      return {
        translation: translationMatch[1].trim(),
        suggestedReply: suggestionMatch[1].trim()
      };
    }
    return null;
  }
}
```

## Step 4: Create Translation System Prompt

### File: `electron/llm/prompts.ts`

Add new prompt constant:
```typescript
export const LANGUAGE_LEARNING_PROMPT = `
You are a real-time conversation translator and language learning assistant.

When the user receives a message in their source language, you must:
1. Translate the message to their target language
2. Suggest a natural response in the target language

Response format (strict):
[TRANSLATION]
The translation of what was said
[/TRANSLATION]
[SUGGESTION]
A natural, conversational response the user can say back in the target language
[/SUGGESTION]

Rules:
- Keep translations natural and colloquial, not literal
- Suggestions should be contextually appropriate and helpful
- Use casual, conversational tone (not formal textbook language)
- Include common idioms or expressions when appropriate
- If the input is already in the target language, translate to source language instead
- Suggest follow-up questions or responses to keep conversation flowing

Target language: {{TARGET_LANGUAGE}}
Context: Language learning conversation
`;
```

### File: `electron/llm/LanguageLearningLLM.ts`

```typescript
export class LanguageLearningPrompt {
  static buildTranslationPrompt(
    transcript: string,
    targetLanguage: string,
    history: Array<{role: string, content: string}>
  ): string {
    const historyContext = history.slice(-5).map(h => 
      `${h.role}: ${h.content}`
    ).join('\n');

    return LANGUAGE_LEARNING_PROMPT
      .replace('{{TARGET_LANGUAGE}}', targetLanguage)
      .replace('{{TRANSCRIPT}}', transcript)
      .replace('{{HISTORY}}', historyContext);
  }
}
```

## Step 5: Add IPC Channels

### File: `electron/ipcHandlers.ts`

**Around line 6584 (near other mode handlers):**

```typescript
// Language Learning IPC Handlers
ipcMain.handle('language-learning-start', async (event, settings) => {
  // Start language learning session with specified language pair
  const { sourceLanguage, targetLanguage } = settings;
  intelligenceManager.startLanguageLearning(sourceLanguage, targetLanguage);
  return { success: true };
});

ipcMain.handle('language-learning-stop', async () => {
  intelligenceManager.stopLanguageLearning();
  return { success: true };
});

ipcMain.on('language-learning-request-translation', async (event, transcript) => {
  // Stream translation back to overlay
  const stream = languageLearningLLM.translateAndSuggest(
    transcript,
    currentTargetLanguage,
    conversationHistory
  );

  for await (const result of stream) {
    event.sender.send('language-learning-translation', result);
  }
});
```

### File: `src/preload.ts`

Add to contextBridge expose:
```typescript
languageLearning: {
  start: (settings: any) => ipcRenderer.invoke('language-learning-start', settings),
  stop: () => ipcRenderer.invoke('language-learning-stop'),
  requestTranslation: (transcript: string) => ipcRenderer.send('language-learning-request-translation', transcript),
  onTranslation: (callback: Function) => ipcRenderer.on('language-learning-translation', callback),
  onSuggestedReply: (callback: Function) => ipcRenderer.on('language-learning-suggested-reply', callback)
}
```

## Step 6: Create Minimalist Overlay Component

### File: `src/components/LanguageLearningOverlay.tsx` (NEW)

```typescript
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TranslationResult {
  translation: string;
  suggestedReply: string;
}

export const LanguageLearningOverlay: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [currentTranslation, setCurrentTranslation] = useState<string>('');
  const [suggestedReply, setSuggestedReply] = useState<string>('');
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    // Connect to audio events
    window.electron.onNativeAudioConnected(() => setIsConnected(true));
    window.electron.onNativeAudioDisconnected(() => setIsConnected(false));
    window.electron.onNativeAudioTranscript((transcript: string) => {
      // Request translation for incoming transcript
      window.electron.languageLearning.requestTranslation(transcript);
    });

    // Listen for translations
    window.electron.languageLearning.onTranslation((result: TranslationResult) => {
      setCurrentTranslation(result.translation);
      setSuggestedReply(result.suggestedReply);
    });

    return () => {
      window.electron.removeAllListeners('language-learning-translation');
    };
  }, []);

  return (
    <motion.div
      className="language-learning-overlay"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        width: 350,
        padding: 16,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        borderRadius: 12,
        color: 'white',
        fontFamily: 'system-ui',
        zIndex: 9999,
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)'
      }}
    >
      {/* Status indicator */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: isConnected ? '#4ade80' : '#ef4444',
          marginRight: 8
        }} />
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {isConnected ? 'Listening...' : 'Disconnected'}
        </span>
      </div>

      {/* Translation display */}
      <AnimatePresence>
        {currentTranslation && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ marginBottom: 12 }}
          >
            <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4 }}>
              WHAT THEY SAID:
            </div>
            <div style={{ 
              fontSize: 14, 
              padding: 10,
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              borderRadius: 8,
              lineHeight: 1.4
            }}>
              {currentTranslation}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Suggested reply */}
      <AnimatePresence>
        {suggestedReply && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4 }}>
              SAY THIS:
            </div>
            <div style={{ 
              fontSize: 14, 
              padding: 10,
              backgroundColor: 'rgba(59, 130, 246, 0.3)',
              borderRadius: 8,
              lineHeight: 1.4,
              borderLeft: '3px solid #3b82f6'
            }}>
              {suggestedReply}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(suggestedReply)}
              style={{
                marginTop: 8,
                padding: '6px 12px',
                backgroundColor: 'rgba(59, 130, 246, 0.5)',
                border: 'none',
                borderRadius: 6,
                color: 'white',
                fontSize: 11,
                cursor: 'pointer'
              }}
            >
              Copy to clipboard
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
```

## Step 7: Register Overlay in App Router

### File: `src/App.tsx`

Add route for Language Learning overlay (similar to SuggestionOverlay):
```typescript
// In the query param switch
case 'language-learning':
  return <LanguageLearningOverlay />;
```

## Step 8: Add Keybind

### File: `electron/services/KeybindManager.ts`

**Add to DEFAULT_KEYBINDS array:**
```typescript
{
  id: 'toggle-language-learning',
  label: 'Toggle Language Learning Overlay',
  accelerator: 'CmdOrCtrl+L',
  action: () => {
    windowHelper.toggleLanguageLearningOverlay();
  }
}
```

### File: `electron/WindowHelper.ts`

Add method to toggle Language Learning overlay:
```typescript
async toggleLanguageLearningOverlay() {
  if (this.languageLearningWindow?.isVisible()) {
    this.languageLearningWindow.hide();
  } else {
    this.languageLearningWindow?.show();
    this.languageLearningWindow?.focus();
  }
}

async createLanguageLearningWindow() {
  // Similar to overlay creation at line 436
  // Smaller dimensions, same transparent/always-on-top settings
  this.languageLearningWindow = new BrowserWindow({
    width: 350,
    height: 200,
    transparent: true,
    alwaysOnTop: true,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  this.languageLearningWindow.loadFile('index.html', {
    query: { window: 'language-learning' }
  });
}
```

## Step 9: Wire into IntelligenceManager

### File: `electron/services/IntelligenceManager.ts`

Add language learning session management:
```typescript
private languageLearningMode = false;
private currentSourceLanguage = '';
private currentTargetLanguage = '';
private conversationHistory: Array<{role: string, content: string}> = [];

startLanguageLearning(sourceLanguage: string, targetLanguage: string) {
  this.languageLearningMode = true;
  this.currentSourceLanguage = sourceLanguage;
  this.currentTargetLanguage = targetLanguage;
  this.conversationHistory = [];
}

stopLanguageLearning() {
  this.languageLearningMode = false;
  this.conversationHistory = [];
}

// Modify handleTranscript to check for language learning mode
handleTranscript(transcript: string, source: 'system' | 'microphone') {
  if (this.languageLearningMode && source === 'system') {
    // System audio = other person speaking
    // Request translation via IPC
    this.mainWindow?.webContents.send('language-learning-request-translation', transcript);
  }
  // ... existing logic
}
```

## Step 10: Add to Mode Activation Logic

### File: `electron/services/ModesManager.ts`

Ensure language-learning mode initializes the overlay:
```typescript
async activateMode(modeId: string) {
  const mode = await this.getMode(modeId);
  
  if (mode.templateType === 'language-learning') {
    // Show language learning overlay
    windowHelper.createLanguageLearningWindow();
    
    // Load language pair from mode settings
    const settings = mode.settings || {};
    intelligenceManager.startLanguageLearning(
      settings.sourceLanguage || 'en-US',
      settings.targetLanguage || 'pt-BR'
    );
  }
  
  // ... existing activation logic
}
```

## Step 11: Database Migration

### File: `electron/database/migrations.ts`

If not already done in v11, add default mode:
```typescript
// In migration function
INSERT INTO modes (template_type, label, description, settings) 
VALUES ('language-learning', 'Language Learning', 
        'Real-time conversation translation with AI-suggested responses',
        '{"sourceLanguage": "en-US", "targetLanguage": "pt-BR", "autoTranslate": true, "showSuggestions": true}');
```

## File Summary

### New Files
1. `electron/llm/LanguageLearningLLM.ts` - Translation LLM class
2. `src/components/LanguageLearningOverlay.tsx` - Minimalist overlay UI

### Modified Files
1. `electron/services/ModesManager.ts` - Add template type, MODE_TEMPLATES, NOTE_SECTIONS
2. `electron/llm/modeProfiles.ts` - Add template type (keep in sync)
3. `electron/llm/prompts.ts` - Add LANGUAGE_LEARNING_PROMPT
4. `electron/ipcHandlers.ts` - Add IPC handlers for translation
5. `src/preload.ts` - Expose languageLearning API
6. `src/App.tsx` - Add route for overlay
7. `electron/services/KeybindManager.ts` - Add Ctrl+L keybind
8. `electron/WindowHelper.ts` - Add overlay window creation/toggle
9. `electron/services/IntelligenceManager.ts` - Add language learning session logic
10. `electron/services/CredentialsManager.ts` - Add language pair settings

## Testing Approach

### Unit Tests
1. `LanguageLearningLLM.test.ts` - Test prompt building, response parsing
2. `LanguageLearningOverlay.test.tsx` - Test component rendering, state updates

### Integration Tests
1. Test IPC channel communication
2. Test mode activation flow
3. Test keybind registration and firing

### Manual Testing
1. Start Refract, activate language-learning mode
2. Play audio in source language → verify translation appears
3. Verify suggested reply appears in target language
4. Test copy-to-clipboard functionality
5. Test overlay visibility toggle with Ctrl+L
6. Test settings persistence (language pair)
7. Test with different language pairs (en→pt, en→es, etc.)

### Edge Cases
- Audio in target language (should translate to source)
- Mixed language input
- Long transcripts (test truncation/overflow)
- Network disconnection during streaming
- Multiple rapid translations

## Implementation Order

1. **Phase 1: Core Mode (30 min)**
   - Extend ModeTemplateType in both files
   - Add MODE_TEMPLATES entry
   - Add TEMPLATE_NOTE_SECTIONS entry
   - Add MODE_CONTEXT_PROFILES entry

2. **Phase 2: LLM Integration (45 min)**
   - Create LanguageLearningLLM class
   - Add LANGUAGE_LEARNING_PROMPT
   - Test prompt building

3. **Phase 3: IPC Layer (30 min)**
   - Add IPC handlers
   - Add preload API
   - Test round-trip communication

4. **Phase 4: Overlay UI (45 min)**
   - Create LanguageLearningOverlay component
   - Register in App.tsx
   - Test standalone rendering

5. **Phase 5: Window Management (30 min)**
   - Add window creation in WindowHelper
   - Add toggle method
   - Add keybind
   - Test visibility toggle

6. **Phase 6: Integration (30 min)**
   - Wire into IntelligenceManager
   - Wire into ModesManager activation
   - Add settings fields
   - End-to-end testing

**Total estimated time: ~3.5 hours**

## Future Enhancements

1. **Pronunciation feedback** - Use MicrophoneCapture to analyze user's speech
2. **Vocabulary tracking** - Store words/phrases used in conversation
3. **Difficulty levels** - Adjust suggestion complexity
4. **Multiple target languages** - Quick-switch between languages
5. **Phrase book** - Save suggested replies for later review
6. **Speed control** - Adjust how fast suggestions appear
7. **Grammar explanations** - Add optional grammar notes
