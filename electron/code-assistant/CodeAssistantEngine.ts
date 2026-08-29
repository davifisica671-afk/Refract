import { LLMHelper } from '../LLMHelper';
import { isIntelligenceFlagEnabled } from '../intelligence/intelligenceFlags';

export class CodeAssistantEngine {
  private llmHelper: LLMHelper;

  constructor(llmHelper: LLMHelper) {
    this.llmHelper = llmHelper;
  }

  isEnabled(key: 'codeExplain' | 'codeGenerate' | 'codeReview' | 'codeRefactor' | 'testGeneration' | 'sandboxExec'): boolean {
    return isIntelligenceFlagEnabled(key);
  }

  async *explain(code: string, language: string): AsyncGenerator<string> {
    const prompt = `Explain the following ${language} code in detail:\n\n${code}`;
    yield* this.streamLLM(prompt);
  }

  async *generate(description: string, language: string): AsyncGenerator<string> {
    const prompt = `Generate ${language} code that: ${description}\n\nProvide only the code block.`;
    yield* this.streamLLM(prompt);
  }

  async *review(code: string, language: string): AsyncGenerator<string> {
    const prompt = `Review this ${language} code for bugs, security issues, and style:\n\n${code}`;
    yield* this.streamLLM(prompt);
  }

  async *refactor(code: string, language: string, target: string): AsyncGenerator<string> {
    const prompt = `Refactor this ${language} code to ${target}:\n\n${code}`;
    yield* this.streamLLM(prompt);
  }

  async *generateTests(code: string, language: string, framework?: string): AsyncGenerator<string> {
    const fw = framework || (language === 'python' ? 'pytest' : 'jest');
    const prompt = `Write ${fw} tests for this ${language} code:\n\n${code}`;
    yield* this.streamLLM(prompt);
  }

  private async *streamLLM(prompt: string): AsyncGenerator<string> {
    const message = "You are a coding assistant. " + prompt;
    yield* this.llmHelper.streamChat(message);
  }
}
