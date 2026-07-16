import {
  AnthropicTransport,
  IproBotTransport,
  hasNonTextContent,
} from './llm-transport';
import Anthropic from '@anthropic-ai/sdk';

// AnthropicTransport は SDK をモック（default export をクラスとして差し替え）
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
}));

describe('hasNonTextContent', () => {
  it('文字列 content は false', () => {
    expect(hasNonTextContent([{ role: 'user', content: 'hi' }])).toBe(false);
  });
  it('text ブロックのみは false', () => {
    expect(
      hasNonTextContent([{ role: 'user', content: [{ type: 'text', text: 'hi' }] as any }]),
    ).toBe(false);
  });
  it('document/image ブロックを含むと true', () => {
    expect(
      hasNonTextContent([
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'x' } },
          ] as any,
        },
      ]),
    ).toBe(true);
  });
});

describe('AnthropicTransport', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
  });

  it('messages.create を呼び text と usage を返す', async () => {
    const t = new AnthropicTransport('sk-test');
    const res = await t.run({
      model: 'claude-sonnet-4-6',
      maxTokens: 100,
      system: 'SYS',
      messages: [{ role: 'user', content: 'q' }],
      taskType: 'KPI',
    });
    expect(mockCreate).toHaveBeenCalledWith(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 100,
        system: 'SYS',
        messages: [{ role: 'user', content: 'q' }],
      },
      { timeout: 240_000 },
    );
    expect(Anthropic).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      maxRetries: 0,
    });
    expect(res).toEqual({
      text: 'hello',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 1, output_tokens: 2 },
      stopReason: undefined,
    });
  });

  it('system 未指定なら system を渡さない', async () => {
    const t = new AnthropicTransport('sk-test');
    await t.run({
      model: 'm',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'q' }],
      taskType: 'OTHER',
    });
    expect('system' in mockCreate.mock.calls[0][0]).toBe(false);
  });
});

describe('IproBotTransport', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });

  it('/api/ai/run に Bearer 付きでPOSTし、usage を snake_case に正規化して返す', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'T',
        model: 'claude-opus-4-8',
        usage: { inputTokens: 5, outputTokens: 6, cacheReadInputTokens: 7, cacheCreationInputTokens: 8 },
      }),
    });
    const t = new IproBotTransport('https://bot.example.com/', 'aig_x');
    const res = await t.run({
      model: 'claude-sonnet-4-6',
      maxTokens: 100,
      system: 'SYS',
      messages: [{ role: 'user', content: 'q' }],
      taskType: 'KPI',
      projectRef: { projectId: 'p1' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bot.example.com/api/ai/run'); // 末尾スラッシュは除去される
    expect(init.headers.Authorization).toBe('Bearer aig_x');
    expect(JSON.parse(init.body)).toMatchObject({ taskType: 'KPI', model: 'claude-sonnet-4-6' });
    expect(res).toEqual({
      text: 'T',
      model: 'claude-opus-4-8',
      stopReason: null,
      usage: {
        input_tokens: 5,
        output_tokens: 6,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 8,
      },
    });
  });

  it('非2xxは IproBotGatewayError(status) を投げる', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => '{"error":"budget_exceeded"}' });
    const t = new IproBotTransport('https://bot.example.com', 'aig_x');
    await expect(
      t.run({ model: 'm', maxTokens: 10, messages: [{ role: 'user', content: 'q' }], taskType: 'KPI' }),
    ).rejects.toMatchObject({ status: 429 });
  });
});
