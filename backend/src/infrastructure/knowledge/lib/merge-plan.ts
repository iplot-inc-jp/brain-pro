import { normalizeLabel } from './normalize-label';

export type KnowledgeNodeType = 'TAG' | 'ENTITY';

export interface ExtractionInput {
  summary: string;
  tags: string[];
  entities: { label: string; kind: string; description?: string }[];
  relations: { from: string; to: string; label?: string }[];
}

export interface MergePlanNode {
  type: KnowledgeNodeType;
  entityKind?: string;
  label: string;
  normalizedLabel: string;
  description?: string;
}

export interface MergePlanMention {
  normalizedLabel: string;
  type: KnowledgeNodeType;
}

export interface MergePlanRelation {
  fromKey: string;
  toKey: string;
  label?: string;
}

export interface MergePlan {
  nodes: MergePlanNode[];
  mentions: MergePlanMention[];
  relations: MergePlanRelation[];
}

/**
 * 抽出結果を、ノードの get-or-create（normalizeLabel キー）・mention・relation の
 * 操作計画に変換する純関数（DB I/O は呼び出し側）。
 * - tag → TAG ノード / entity → ENTITY ノード。normalizeLabel で一意化。
 * - relation の from/to は normalizeLabel で解決し、未知ラベルは TAG ノードとして補完。
 */
export function buildMergePlan(extraction: ExtractionInput): MergePlan {
  // normalizedLabel をキーにノードを一意化（型衝突時は ENTITY を優先しない＝先勝ち）。
  const nodeByKey = new Map<string, MergePlanNode>();

  const addNode = (
    label: unknown,
    type: KnowledgeNodeType,
    entityKind?: unknown,
    description?: unknown,
  ): MergePlanNode | undefined => {
    // 非文字列入力（LLM が数値/オブジェクト/null を返すケース）に対する頑健化。
    if (typeof label !== 'string') return undefined;
    const normalizedLabel = normalizeLabel(label);
    if (!normalizedLabel) return undefined;
    const existing = nodeByKey.get(normalizedLabel);
    if (existing) return existing;
    const node: MergePlanNode = { type, label, normalizedLabel };
    if (type === 'ENTITY' && typeof entityKind === 'string' && entityKind)
      node.entityKind = entityKind;
    if (typeof description === 'string' && description)
      node.description = description;
    nodeByKey.set(normalizedLabel, node);
    return node;
  };

  for (const tag of extraction.tags ?? []) {
    addNode(tag, 'TAG');
  }
  for (const ent of extraction.entities ?? []) {
    addNode(ent.label, 'ENTITY', ent.kind, ent.description);
  }

  // relation の端点を解決。未知ラベルは TAG ノードとして補完。
  const relations: MergePlanRelation[] = [];
  for (const rel of extraction.relations ?? []) {
    const fromNode = addNode(rel.from, 'TAG');
    const toNode = addNode(rel.to, 'TAG');
    if (!fromNode || !toNode) continue;
    relations.push({
      fromKey: fromNode.normalizedLabel,
      toKey: toNode.normalizedLabel,
      label: typeof rel.label === 'string' ? rel.label : undefined,
    });
  }

  const nodes = [...nodeByKey.values()];
  const mentions: MergePlanMention[] = nodes.map((n) => ({
    normalizedLabel: n.normalizedLabel,
    type: n.type,
  }));

  return { nodes, mentions, relations };
}
