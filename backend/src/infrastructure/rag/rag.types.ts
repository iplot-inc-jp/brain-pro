export const RAG_FEATURE_TYPES = [
  'BUSINESS_FLOW',
  'REQUIREMENT',
  'ISSUE_TREE',
  'TASK',
  'STAKEHOLDER',
  'RISK',
  'KPI',
  'SYSTEM',
  'DATA_CATALOG',
  'MEETING',
] as const;

export type RagFeatureType = (typeof RAG_FEATURE_TYPES)[number];

export interface RagSourceItem {
  sourceKey: string;
  sourceUrl: string;
  title: string;
  facts: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RagSourceBundle {
  featureType: RagFeatureType;
  targetKey: string;
  overview: RagSourceItem;
  components: RagSourceItem[];
  sourceHash: string;
}

export interface RagCompressedDocument {
  sourceKey: string;
  title: string;
  summary: string;
  content: string;
  keywords: string[];
  aliases: string[];
  questions: string[];
}

export interface RagCompressionResult {
  documents: RagCompressedDocument[];
  model: string;
}

interface BatchOptions {
  maxItems: number;
  maxChars: number;
}

const asRequiredText = (value: unknown, field: string, max: number): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`RAG圧縮結果の ${field} が不正です`);
  }
  return value.trim().slice(0, max);
};

const asSearchTerms = (value: unknown, field: string, limit: number): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`RAG圧縮結果の ${field} が配列ではありません`);
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const term = raw.trim().slice(0, field === 'questions' ? 300 : 120);
    if (!term || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= limit) break;
  }
  return terms;
};

const extractJsonObject = (text: string): unknown => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('RAG圧縮結果にJSONオブジェクトがありません');
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
};

export function parseRagCompressionResponse(
  text: string,
  expectedSourceKeys: string[],
): RagCompressedDocument[] {
  const parsed = extractJsonObject(text) as { documents?: unknown };
  if (!parsed || !Array.isArray(parsed.documents)) {
    throw new Error('RAG圧縮結果の documents が配列ではありません');
  }

  const expected = new Set(expectedSourceKeys);
  const seen = new Set<string>();
  const documents = parsed.documents.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`RAG圧縮結果 documents[${index}] が不正です`);
    }
    const row = raw as Record<string, unknown>;
    const sourceKey = asRequiredText(row.sourceKey, 'sourceKey', 300);
    if (!expected.has(sourceKey)) {
      throw new Error(`要求していない sourceKey です: ${sourceKey}`);
    }
    if (seen.has(sourceKey)) {
      throw new Error(`sourceKey が重複しています: ${sourceKey}`);
    }
    seen.add(sourceKey);
    return {
      sourceKey,
      title: asRequiredText(row.title, 'title', 300),
      summary: asRequiredText(row.summary, 'summary', 1_500),
      content: asRequiredText(row.content, 'content', 8_000),
      keywords: asSearchTerms(row.keywords, 'keywords', 20),
      aliases: asSearchTerms(row.aliases, 'aliases', 20),
      questions: asSearchTerms(row.questions, 'questions', 12),
    };
  });

  const missing = expectedSourceKeys.filter((key) => !seen.has(key));
  if (missing.length > 0) {
    throw new Error(`RAG圧縮結果の sourceKey が不足しています: ${missing.join(', ')}`);
  }
  return documents;
}

export function batchRagSourceItems(
  items: RagSourceItem[],
  options: BatchOptions,
): RagSourceItem[][] {
  const maxItems = Math.max(1, Math.floor(options.maxItems));
  const maxChars = Math.max(1, Math.floor(options.maxChars));
  const batches: RagSourceItem[][] = [];
  let current: RagSourceItem[] = [];
  let currentChars = 2;

  for (const item of items) {
    const itemChars = JSON.stringify(item).length + (current.length > 0 ? 1 : 0);
    if (
      current.length > 0 &&
      (current.length >= maxItems || currentChars + itemChars > maxChars)
    ) {
      batches.push(current);
      current = [];
      currentChars = 2;
    }
    current.push(item);
    currentChars += itemChars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function buildRagSearchText(document: RagCompressedDocument): string {
  return [
    document.title,
    document.summary,
    document.content,
    ...document.keywords,
    ...document.aliases,
    ...document.questions,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');
}
