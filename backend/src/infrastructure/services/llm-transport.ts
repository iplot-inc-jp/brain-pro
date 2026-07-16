import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicUsageLike } from './llm-usage-recorder.service';

/** LLM 1回実行の共通リクエスト。ClaudeService の各メソッドが組み立てる。 */
export interface LlmRunRequest {
  model: string;
  maxTokens: number;
  system?: string;
  messages: Anthropic.MessageParam[];
  taskType: string; // LlmUsageArea 値
  /** ipro-bot の IPLoT頭脳(skill)を明示指定（ゲートウェイ経由時のみ効く）。 */
  skill?: string;
  /** true: ipro-bot 側の意図分類agentに頭脳選択を任せる。 */
  classify?: boolean;
  projectRef?: { orgId?: string; projectId?: string };
}

export interface LlmRunResult {
  text: string;
  model: string;
  usage: AnthropicUsageLike | null;
  stopReason?: string | null;
}

export interface LlmTransport {
  run(req: LlmRunRequest): Promise<LlmRunResult>;
}

/** messages に text 以外の content ブロック（document/image 等）が含まれるか。 */
export function hasNonTextContent(messages: Anthropic.MessageParam[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((b) => (b as { type?: string })?.type !== 'text'),
  );
}

/** 現行どおり Anthropic API を直接呼ぶトランスポート。 */
export class AnthropicTransport implements LlmTransport {
  constructor(private readonly apiKey: string) {}

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const client = new Anthropic({ apiKey: this.apiKey });
    const response = await client.messages.create(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        messages: req.messages,
        ...(req.system ? { system: req.system } : {}),
      },
      { timeout: 4 * 60 * 1000 },
    );
    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map((c) => c.text)
      .join('');
    return {
      text,
      model: req.model,
      usage: (response as any).usage ?? null,
      stopReason: response.stop_reason,
    };
  }
}

export class IproBotGatewayError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`ipro-bot gateway error ${status}: ${body}`);
  }
}

/** ipro-bot の POST /api/ai/run に委譲するトランスポート。リトライは呼び出し元ジョブ基盤の責務。 */
export class IproBotTransport implements LlmTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string,
    private readonly timeoutMs = 240_000,
  ) {}

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/ai/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify({
          taskType: req.taskType,
          model: req.model,
          system: req.system,
          messages: req.messages,
          maxTokens: req.maxTokens,
          skill: req.skill,
          classify: req.classify,
          projectRef: req.projectRef,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new IproBotGatewayError(res.status, body.slice(0, 500));
      }
      const data = (await res.json()) as {
        text: string;
        model: string;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadInputTokens?: number;
          cacheCreationInputTokens?: number;
        };
        stopReason?: string | null;
      };
      return {
        text: data.text,
        model: data.model,
        stopReason: data.stopReason ?? null,
        usage: data.usage
          ? {
              input_tokens: data.usage.inputTokens ?? 0,
              output_tokens: data.usage.outputTokens ?? 0,
              cache_read_input_tokens: data.usage.cacheReadInputTokens ?? null,
              cache_creation_input_tokens: data.usage.cacheCreationInputTokens ?? null,
            }
          : null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
