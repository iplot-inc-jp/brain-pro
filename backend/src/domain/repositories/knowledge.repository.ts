import { KnowledgeNode, KnowledgeDocument } from '../entities';

/** グラフのエッジ（KnowledgeRelation の読み取り表現） */
export interface KnowledgeEdgeData {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  type: string | null;
  confidence: number | null;
  sourceDocumentId: string | null;
}

/** グラフ全体（nodes + edges + documents） */
export interface KnowledgeGraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdgeData[];
  documents: KnowledgeDocument[];
}

/** ノードに紐づくメンション（出典文書 + 根拠スニペット） */
export interface KnowledgeMentionData {
  id: string;
  documentId: string;
  nodeId: string;
  relevance: number | null;
  snippet: string | null;
  documentTitle: string;
  documentBlobUrl: string | null;
}

/** ノード詳細（mentions 込み） */
export interface KnowledgeNodeDetail {
  node: KnowledgeNode;
  mentions: KnowledgeMentionData[];
  outRelations: KnowledgeEdgeData[];
  inRelations: KnowledgeEdgeData[];
}

/** 検索結果（ノード + 文書） */
export interface KnowledgeSearchResult {
  nodes: KnowledgeNode[];
  documents: KnowledgeDocument[];
}

/**
 * Knowledge（ナレッジグラフ）リポジトリインターフェース。
 * read 主体（グラフ取得 / ノード詳細 / 検索）＋ node・document の編集。
 */
export interface IKnowledgeRepository {
  /** プロジェクトのグラフ全体（nodes + edges + documents） */
  getGraph(projectId: string): Promise<KnowledgeGraphData>;

  /** ノード詳細（mentions 込み）。無ければ null。 */
  getNodeDetail(nodeId: string): Promise<KnowledgeNodeDetail | null>;

  /** ノード単体（編集用）。無ければ null。 */
  findNodeById(nodeId: string): Promise<KnowledgeNode | null>;

  /** ノードを保存（編集の永続化。entityKind / type も含む） */
  saveNode(node: KnowledgeNode): Promise<void>;

  /** ノード削除（mention/relation は Cascade で削除される） */
  deleteNode(nodeId: string): Promise<void>;

  /**
   * ノードマージ：source の mentions / relations を target に付け替え、
   * 両者の mentionCount を再計算し、source を削除する（$transaction で整合的に）。
   * 重複（@@unique）は skipDuplicates で取りこぼし、付け替え不能な source 側は削除。
   */
  mergeNodes(sourceId: string, targetId: string): Promise<void>;

  /** 指定ノード群の mentionCount を mentions 実数で再計算（$transaction 内向け）。 */
  recomputeMentionCount(nodeIds: string[]): Promise<void>;

  /** 文書単体（位置更新 / 編集用）。無ければ null。 */
  findDocumentById(documentId: string): Promise<KnowledgeDocument | null>;

  /** 文書を保存（位置 / title / summary の永続化） */
  saveDocument(document: KnowledgeDocument): Promise<void>;

  /**
   * 文書削除：文書 + その mentions を削除（relations.sourceDocumentId は SetNull）、
   * 関係していたノードの mentionCount を再計算する（$transaction で整合的に）。
   */
  deleteDocument(documentId: string): Promise<void>;

  /** 関係単体（編集用の読み取り表現）。無ければ null。 */
  findRelationById(relationId: string): Promise<KnowledgeEdgeData | null>;

  /** 関係を更新（label / type）。更新後の表現を返す。 */
  updateRelation(
    relationId: string,
    props: { label?: string | null; type?: string | null },
  ): Promise<KnowledgeEdgeData>;

  /** 関係削除。 */
  deleteRelation(relationId: string): Promise<void>;

  /** ラベル/タイトルの部分一致検索（ノード + 文書） */
  search(
    projectId: string,
    query: string,
  ): Promise<KnowledgeSearchResult>;
}

export const KNOWLEDGE_REPOSITORY = Symbol('KNOWLEDGE_REPOSITORY');
