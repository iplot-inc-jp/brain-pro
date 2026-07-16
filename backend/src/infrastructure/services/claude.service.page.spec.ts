import { ClaudeService } from './claude.service';

function makeService() {
  const usageRecorder = { record: jest.fn(async () => undefined) };
  const service = new ClaudeService(
    usageRecorder as never,
    { resolveForProject: jest.fn(async () => null) } as never,
  );
  return { service, usageRecorder };
}

describe('ClaudeService page extraction', () => {
  it('heartbeats before and after a text-only page LLM call', async () => {
    const { service } = makeService();
    jest.spyOn(service as never, 'runLlm' as never).mockResolvedValueOnce({
      text: JSON.stringify({ summary: 's', tags: [], entities: [], relations: [] }),
      model: 'm',
      usage: null,
    } as never);
    const heartbeat = jest.fn(async () => undefined);

    await service.extractPageKnowledge(
      { filename: 'slide.pptx', text: 'text only' },
      'sk',
      'm',
      undefined,
      heartbeat,
    );

    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it('stops before the next paid continuation when heartbeat reports lease loss', async () => {
    const { service } = makeService();
    const runLlm = jest.spyOn(service as never, 'runLlm' as never)
      .mockResolvedValueOnce({
        text: 'partial',
        model: 'm',
        usage: null,
        stopReason: 'max_tokens',
      } as never);
    const heartbeat = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('lease lost'));

    await expect(service.extractPageKnowledge(
      { filename: 'a.pdf', pdfBase64: 'AAAA' },
      'sk',
      'm',
      undefined,
      heartbeat,
    )).rejects.toThrow('lease lost');
    expect(runLlm).toHaveBeenCalledTimes(1);
  });

  it('continues dense visual transcription and extracts metadata from bounded text chunks', async () => {
    const { service, usageRecorder } = makeService();
    const dense = '資料'.repeat(25_000);
    const runLlm = jest
      .spyOn(
        service as unknown as {
          runLlm(input: unknown): Promise<{
            text: string;
            model: string;
            usage: null;
            stopReason?: string;
          }>;
        },
        'runLlm',
      )
      .mockResolvedValueOnce({
        text: dense,
        model: 'm',
        usage: null,
        stopReason: 'max_tokens',
      })
      .mockResolvedValueOnce({
        text: '終端[[PAGE_COMPLETE]]',
        model: 'm',
        usage: null,
        stopReason: 'end_turn',
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: '要約1',
          tags: ['共通', 'A'],
          entities: [{ label: '会社', kind: 'ORG' }],
          relations: [],
        }),
        model: 'm',
        usage: null,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: '要約2',
          tags: ['共通', 'B'],
          entities: [{ label: '会社', kind: 'ORG' }],
          relations: [{ from: 'A', to: 'B', label: '関連' }],
        }),
        model: 'm',
        usage: null,
      });

    const result = await service.extractPageKnowledge(
      {
        filename: 'deck.pptx#slide=1',
        text: 'SOURCE TEXT',
        images: [{ base64: 'AAAA', mimeType: 'image/png' }],
      },
      'sk-test',
      'm',
      { projectId: 'p1', area: 'KNOWLEDGE_EXTRACTION' },
    );

    expect(result.fullText).toBe(`SOURCE TEXT\n\n${dense}終端`);
    expect(result.fullText.length).toBeGreaterThan(40_000);
    expect(result.summary).toBe('要約1\n要約2');
    expect(result.tags).toEqual(['共通', 'A', 'B']);
    expect(result.entities).toEqual([{ label: '会社', kind: 'ORG' }]);
    expect(result.relations).toEqual([{ from: 'A', to: 'B', label: '関連' }]);
    expect(runLlm).toHaveBeenCalledTimes(4);
    expect(usageRecorder.record).toHaveBeenCalledTimes(4);
    expect(runLlm.mock.calls[0][0]).toEqual(
      expect.objectContaining({ maxTokens: 8192 }),
    );
    expect(runLlm.mock.calls.slice(2)).toEqual(
      expect.arrayContaining([
        [expect.objectContaining({ maxTokens: 4096 })],
      ]),
    );
  });

  it('removes a repeated continuation prefix without losing new text', () => {
    const { service } = makeService();
    const stitch = service as unknown as {
      appendContinuation(current: string, next: string): string;
    };
    const overlap = '重複境界'.repeat(10);

    expect(
      stitch.appendContinuation(`前半${overlap}`, `${overlap}後半`),
    ).toBe(`前半${overlap}後半`);
  });

  it('fails explicitly instead of storing a truncated visual transcript', async () => {
    const { service } = makeService();
    jest
      .spyOn(service as never, 'runLlm' as never)
      .mockResolvedValueOnce({
        text: '途中まで',
        model: 'm',
        usage: null,
        stopReason: 'end_turn',
      } as never);

    await expect(
      service.extractPageKnowledge(
        { filename: 'a.pdf', pdfBase64: 'AAAA' },
        'sk-test',
        'm',
      ),
    ).rejects.toThrow('完了マーカーなし');
  });

  it('processes 25 metadata chunks with bounded concurrency and stable ordering', async () => {
    const { service } = makeService();
    const visualText = 'x'.repeat(999_999);
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    jest
      .spyOn(service as never, 'runLlm' as never)
      .mockImplementation((async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        if (calls === 1) {
          return {
            text: `${visualText}[[PAGE_COMPLETE]]`,
            model: 'm',
            usage: null,
            stopReason: 'end_turn',
          };
        }
        const index = calls - 1;
        return {
          text: JSON.stringify({
            summary: `S${index}`,
            tags: [`T${index}`],
            entities: [],
            relations: [],
          }),
          model: 'm',
          usage: null,
        };
      }) as never);
    const heartbeat = jest.fn(async () => undefined);

    const result = await service.extractPageKnowledge(
      { filename: 'dense.pdf', pdfBase64: 'AAAA' },
      'sk-test',
      'm',
      undefined,
      heartbeat,
    );

    expect(calls).toBe(26);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result.tags).toEqual(
      Array.from({ length: 25 }, (_, index) => `T${index + 1}`),
    );
    expect(heartbeat).toHaveBeenCalledTimes(52);
  });
});
