import {
  batchRagSourceItems,
  buildRagSearchText,
  parseRagCompressionResponse,
} from './rag.types';

const source = (sourceKey: string, title = sourceKey) => ({
  sourceKey,
  sourceUrl: `/source/${sourceKey}`,
  title,
  facts: { description: `${title} の説明` },
});

describe('parseRagCompressionResponse', () => {
  const valid = {
    documents: [
      {
        sourceKey: 'a',
        title: '受注受付',
        summary: '注文を受け付ける工程。',
        content: '顧客から注文を受領し、受付担当が内容を確認する。',
        keywords: ['受注', ' 注文 ', '受注'],
        aliases: ['注文受付'],
        questions: ['受注は誰が行うか？'],
      },
    ],
  };

  it('plain JSON と fenced JSON を同じ契約で受け入れる', () => {
    expect(parseRagCompressionResponse(JSON.stringify(valid), ['a'])).toHaveLength(1);
    expect(
      parseRagCompressionResponse(`\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n`, ['a']),
    ).toEqual(parseRagCompressionResponse(JSON.stringify(valid), ['a']));
  });

  it('検索語配列を trim・重複除去し、上限件数へ丸める', () => {
    const noisy = structuredClone(valid);
    noisy.documents[0].keywords = Array.from({ length: 30 }, (_, i) => ` k${i % 22} `);
    const [parsed] = parseRagCompressionResponse(JSON.stringify(noisy), ['a']);
    expect(parsed.keywords).toHaveLength(20);
    expect(parsed.keywords[0]).toBe('k0');
    expect(new Set(parsed.keywords).size).toBe(parsed.keywords.length);
  });

  it('必須文字列が欠けた文書を拒否する', () => {
    const broken = structuredClone(valid) as any;
    delete broken.documents[0].content;
    expect(() => parseRagCompressionResponse(JSON.stringify(broken), ['a'])).toThrow(
      'content',
    );
  });

  it('要求していない sourceKey と重複 sourceKey を拒否する', () => {
    const unknown = structuredClone(valid);
    unknown.documents[0].sourceKey = 'other';
    expect(() => parseRagCompressionResponse(JSON.stringify(unknown), ['a'])).toThrow(
      'sourceKey',
    );

    const duplicate = { documents: [valid.documents[0], valid.documents[0]] };
    expect(() => parseRagCompressionResponse(JSON.stringify(duplicate), ['a'])).toThrow(
      '重複',
    );
  });

  it('要求した sourceKey が応答に無い場合を拒否する', () => {
    expect(() => parseRagCompressionResponse(JSON.stringify(valid), ['a', 'b'])).toThrow(
      '不足',
    );
  });
});

describe('batchRagSourceItems', () => {
  it('件数上限を超えない決定的なバッチに分割する', () => {
    const items = [source('a'), source('b'), source('c'), source('d'), source('e')];
    expect(batchRagSourceItems(items, { maxItems: 2, maxChars: 10_000 })).toEqual([
      items.slice(0, 2),
      items.slice(2, 4),
      items.slice(4),
    ]);
  });

  it('JSON文字数上限を超える直前でバッチを分ける', () => {
    const items = [source('a', '短い'), source('b', '長い'.repeat(80))];
    const maxChars = JSON.stringify(items[0]).length + 10;
    expect(batchRagSourceItems(items, { maxItems: 10, maxChars })).toHaveLength(2);
  });
});

describe('buildRagSearchText', () => {
  it('タイトル・概要・本文・補助語・想定質問を検索本文へまとめる', () => {
    const text = buildRagSearchText({
      sourceKey: 'a',
      title: '受注受付',
      summary: '注文を受ける',
      content: '営業担当が確認する',
      keywords: ['受注'],
      aliases: ['注文受付'],
      questions: ['誰が確認する？'],
    });
    expect(text).toContain('受注受付');
    expect(text).toContain('注文受付');
    expect(text).toContain('誰が確認する？');
  });
});
