import { ClaudeService } from './claude.service';
import { IproBotGatewayError } from './llm-transport';
import { defaultModelFor, getPromptDefinition } from '../prompts/prompt-registry';

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
}));

const usageRecorder = { record: jest.fn(async () => {}) } as any;

function makeGateway(resolved: any) {
  return { resolveForProject: jest.fn(async () => resolved) } as any;
}

// DBを使わずレジストリ既定値を返すPromptServiceスタブ
const promptStub = {
  resolve: jest.fn(async (key: string) => {
    const def = getPromptDefinition(key);
    if (!def) throw new Error(`unknown prompt key: ${key}`);
    return {
      model: defaultModelFor(def),
      systemPrompt: def.defaultSystemPrompt,
      promptVersionId: null,
    };
  }),
} as any;

const VALID_JSON = '{"requirements":[]}';

describe('ClaudeService runLlm（parseRequirements 経由）', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = fetchMock;
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: VALID_JSON }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
  });

  it('ゲートウェイ未設定(null)なら直接Anthropic', async () => {
    const svc = new ClaudeService(usageRecorder, makeGateway(null), promptStub);
    await svc.parseRequirements('text', 'sk-key', { projectId: 'p1', area: 'REQUIREMENT' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ゲートウェイ設定ありなら /api/ai/run を呼ぶ', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: VALID_JSON,
        model: 'claude-opus-4-8',
        usage: { inputTokens: 3, outputTokens: 4 },
      }),
    });
    const svc = new ClaudeService(
      usageRecorder,
      makeGateway({ baseUrl: 'https://b', apiToken: 'aig_x', strict: false, organizationId: 'o1' }),
      promptStub,
    );
    await svc.parseRequirements('text', 'sk-key', { projectId: 'p1', area: 'REQUIREMENT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
    // usage は実際に使われたモデル名で記録される
    expect(usageRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' }),
      'claude-opus-4-8',
      expect.objectContaining({ input_tokens: 3 }),
    );
  });

  it('ゲートウェイ5xxは直接Anthropicへフォールバック', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => 'boom' });
    const svc = new ClaudeService(
      usageRecorder,
      makeGateway({ baseUrl: 'https://b', apiToken: 'aig_x', strict: false, organizationId: 'o1' }),
      promptStub,
    );
    const res = await svc.parseRequirements('text', 'sk-key', {
      projectId: 'p1',
      area: 'REQUIREMENT',
    });
    expect(res).toEqual({ requirements: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1); // フォールバック実行
  });

  it('strict=true はフォールバックせず throw', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => 'boom' });
    const svc = new ClaudeService(
      usageRecorder,
      makeGateway({ baseUrl: 'https://b', apiToken: 'aig_x', strict: true, organizationId: 'o1' }),
      promptStub,
    );
    await expect(
      svc.parseRequirements('text', 'sk-key', { projectId: 'p1', area: 'REQUIREMENT' }),
    ).rejects.toBeInstanceOf(IproBotGatewayError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('401 はフォールバックせず throw（設定ミスの顕在化）', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' });
    const svc = new ClaudeService(
      usageRecorder,
      makeGateway({ baseUrl: 'https://b', apiToken: 'aig_bad', strict: false, organizationId: 'o1' }),
      promptStub,
    );
    await expect(
      svc.parseRequirements('text', 'sk-key', { projectId: 'p1', area: 'REQUIREMENT' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('マルチモーダル入力（extractKnowledge の PDF）はゲートウェイ設定ありでも直接Anthropic', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"summary":"s","tags":[],"entities":[],"relations":[]}' }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const svc = new ClaudeService(
      usageRecorder,
      makeGateway({ baseUrl: 'https://b', apiToken: 'aig_x', strict: false, organizationId: 'o1' }),
      promptStub,
    );
    await svc.extractKnowledge(
      { filename: 'a.pdf', pdfBase64: 'AAAA' },
      'sk-key',
      undefined,
      { projectId: 'p1', area: 'KNOWLEDGE_EXTRACTION' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
