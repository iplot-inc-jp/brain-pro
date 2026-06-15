import { Injectable } from '@nestjs/common';
import {
  KnowledgeNode,
  KnowledgeDocument,
  KnowledgeNodeTypeValue,
  IngestionSourceTypeValue,
  IKnowledgeRepository,
  KnowledgeGraphData,
  KnowledgeEdgeData,
  KnowledgeNodeDetail,
  KnowledgeMentionData,
  KnowledgeSearchResult,
} from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Knowledge（ナレッジグラフ）リポジトリ実装。
 * read 主体（グラフ/ノード詳細/検索）＋ node・document の編集。
 */
@Injectable()
export class KnowledgeRepositoryImpl implements IKnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  private nodeToDomain(data: {
    id: string;
    projectId: string;
    type: string;
    entityKind: string | null;
    label: string;
    normalizedLabel: string;
    description: string | null;
    color: string | null;
    mentionCount: number;
    positionX: number | null;
    positionY: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): KnowledgeNode {
    return KnowledgeNode.reconstruct({
      id: data.id,
      projectId: data.projectId,
      type: data.type as KnowledgeNodeTypeValue,
      entityKind: data.entityKind,
      label: data.label,
      normalizedLabel: data.normalizedLabel,
      description: data.description,
      color: data.color,
      mentionCount: data.mentionCount,
      positionX: data.positionX,
      positionY: data.positionY,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  private documentToDomain(data: {
    id: string;
    projectId: string;
    ingestionFileId: string | null;
    title: string;
    summary: string | null;
    contentText: string | null;
    sourceType: string;
    sourceRef: string | null;
    blobUrl: string | null;
    mimeType: string | null;
    positionX: number | null;
    positionY: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): KnowledgeDocument {
    return KnowledgeDocument.reconstruct({
      id: data.id,
      projectId: data.projectId,
      ingestionFileId: data.ingestionFileId,
      title: data.title,
      summary: data.summary,
      contentText: data.contentText,
      sourceType: data.sourceType as IngestionSourceTypeValue,
      sourceRef: data.sourceRef,
      blobUrl: data.blobUrl,
      mimeType: data.mimeType,
      positionX: data.positionX,
      positionY: data.positionY,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  private edgeToData(data: {
    id: string;
    projectId: string;
    fromNodeId: string;
    toNodeId: string;
    label: string | null;
    type: string | null;
    confidence: number | null;
    sourceDocumentId: string | null;
  }): KnowledgeEdgeData {
    return {
      id: data.id,
      projectId: data.projectId,
      fromNodeId: data.fromNodeId,
      toNodeId: data.toNodeId,
      label: data.label,
      type: data.type,
      confidence: data.confidence,
      sourceDocumentId: data.sourceDocumentId,
    };
  }

  async getGraph(projectId: string): Promise<KnowledgeGraphData> {
    const [nodes, edges, documents] = await Promise.all([
      this.prisma.knowledgeNode.findMany({
        where: { projectId },
        orderBy: { mentionCount: 'desc' },
      }),
      this.prisma.knowledgeRelation.findMany({ where: { projectId } }),
      this.prisma.knowledgeDocument.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      nodes: nodes.map((n) => this.nodeToDomain(n)),
      edges: edges.map((e) => this.edgeToData(e)),
      documents: documents.map((d) => this.documentToDomain(d)),
    };
  }

  async getNodeDetail(nodeId: string): Promise<KnowledgeNodeDetail | null> {
    const node = await this.prisma.knowledgeNode.findUnique({
      where: { id: nodeId },
    });
    if (!node) return null;

    const [mentions, outRelations, inRelations] = await Promise.all([
      this.prisma.knowledgeMention.findMany({
        where: { nodeId },
        include: {
          document: { select: { title: true, blobUrl: true } },
        },
      }),
      this.prisma.knowledgeRelation.findMany({ where: { fromNodeId: nodeId } }),
      this.prisma.knowledgeRelation.findMany({ where: { toNodeId: nodeId } }),
    ]);

    const mentionData: KnowledgeMentionData[] = mentions.map((m) => ({
      id: m.id,
      documentId: m.documentId,
      nodeId: m.nodeId,
      relevance: m.relevance,
      snippet: m.snippet,
      documentTitle: m.document.title,
      documentBlobUrl: m.document.blobUrl,
    }));

    return {
      node: this.nodeToDomain(node),
      mentions: mentionData,
      outRelations: outRelations.map((e) => this.edgeToData(e)),
      inRelations: inRelations.map((e) => this.edgeToData(e)),
    };
  }

  async findNodeById(nodeId: string): Promise<KnowledgeNode | null> {
    const node = await this.prisma.knowledgeNode.findUnique({
      where: { id: nodeId },
    });
    if (!node) return null;
    return this.nodeToDomain(node);
  }

  async saveNode(node: KnowledgeNode): Promise<void> {
    await this.prisma.knowledgeNode.update({
      where: { id: node.id },
      data: {
        type: node.type,
        entityKind: node.entityKind,
        label: node.label,
        // 改名で再計算された名寄せキーを永続する（entity.update が再計算済み）。
        normalizedLabel: node.normalizedLabel,
        description: node.description,
        color: node.color,
        positionX: node.positionX,
        positionY: node.positionY,
        updatedAt: node.updatedAt,
      },
    });
  }

  async deleteNode(nodeId: string): Promise<void> {
    await this.prisma.knowledgeNode.delete({ where: { id: nodeId } });
  }

  async mergeNodes(sourceId: string, targetId: string): Promise<void> {
    // 破壊的操作の不変条件を repository に寄せる（多層防御。use-case 側にもガードあり）。
    if (sourceId === targetId) {
      throw new Error('Cannot merge a node into itself');
    }
    const [source, target] = await Promise.all([
      this.prisma.knowledgeNode.findUnique({
        where: { id: sourceId },
        select: { id: true, projectId: true, type: true },
      }),
      this.prisma.knowledgeNode.findUnique({
        where: { id: targetId },
        select: { id: true, projectId: true, type: true },
      }),
    ]);
    if (!source) {
      throw new Error(`KnowledgeNode not found: ${sourceId}`);
    }
    if (!target) {
      throw new Error(`KnowledgeNode not found: ${targetId}`);
    }
    if (source.projectId !== target.projectId) {
      throw new Error('Cannot merge nodes across projects');
    }
    if (source.type !== target.type) {
      throw new Error('Cannot merge nodes of different type');
    }

    // 高次数ノード（mention/relation 数百＝名寄せマージの本命）でも 5 秒の
    // 暗黙タイムアウトで P2028 になりにくいよう、集合演算 + 明示タイムアウトで実行。
    await this.prisma.$transaction(
      async (tx) => {
        // ===== 1) mentions（@@unique [documentId, nodeId]）を target に付け替え =====
        // target に既にある documentId と衝突する source 側 mention は付け替え不能
        // → deleteMany でまとめて削除。残りを updateMany で nodeId=source→target。
        const targetMentionDocs = await tx.knowledgeMention.findMany({
          where: { nodeId: targetId },
          select: { documentId: true },
        });
        const targetDocIds = targetMentionDocs.map((m) => m.documentId);
        if (targetDocIds.length > 0) {
          await tx.knowledgeMention.deleteMany({
            where: { nodeId: sourceId, documentId: { in: targetDocIds } },
          });
        }
        await tx.knowledgeMention.updateMany({
          where: { nodeId: sourceId },
          data: { nodeId: targetId },
        });

        // ===== 2) outRelations（fromNodeId = source）を target に付け替え =====
        const outRelations = await tx.knowledgeRelation.findMany({
          where: { fromNodeId: sourceId },
        });
        // 2a) 自己ループ化（付替え後 fromNodeId === toNodeId === target）は削除。
        const outSelfLoopIds = outRelations
          .filter((r) => r.toNodeId === targetId)
          .map((r) => r.id);
        // 2b) @@unique [projectId, fromNodeId, toNodeId, label, sourceDocumentId] の
        //     重複回避。Postgres は NULL を distinct 扱いするので、label と
        //     sourceDocumentId が両方 non-null のときだけ重複判定する。
        //     どちらかが null の関係は IS NULL マッチで誤削除しない＝必ず付替える。
        const outDupCandidates = outRelations.filter(
          (r) =>
            r.toNodeId !== targetId &&
            r.label !== null &&
            r.sourceDocumentId !== null,
        );
        const outDupSourceIds: string[] = [];
        if (outDupCandidates.length > 0) {
          const existing = await tx.knowledgeRelation.findMany({
            where: {
              fromNodeId: targetId,
              toNodeId: { in: outDupCandidates.map((r) => r.toNodeId) },
            },
            select: { toNodeId: true, label: true, sourceDocumentId: true },
          });
          // 既存（target 起点）に加え、付替え後に同キーへ collapse する source 同士の
          // 重複も検出する（updateMany 一括では先勝ちにならず @@unique 違反になるため）。
          const seenKeys = new Set(
            existing.map((e) =>
              this.relationDedupKey(targetId, e.toNodeId, e.label, e.sourceDocumentId),
            ),
          );
          for (const r of outDupCandidates) {
            const key = this.relationDedupKey(
              targetId,
              r.toNodeId,
              r.label,
              r.sourceDocumentId,
            );
            if (seenKeys.has(key)) {
              outDupSourceIds.push(r.id);
            } else {
              seenKeys.add(key);
            }
          }
        }
        const outDeleteIds = [...outSelfLoopIds, ...outDupSourceIds];
        if (outDeleteIds.length > 0) {
          await tx.knowledgeRelation.deleteMany({
            where: { id: { in: outDeleteIds } },
          });
        }
        // 残り（自己ループ・重複は上で削除済み）を updateMany で付替え。
        await tx.knowledgeRelation.updateMany({
          where: { fromNodeId: sourceId },
          data: { fromNodeId: targetId },
        });

        // ===== 3) inRelations（toNodeId = source）を target に付け替え =====
        const inRelations = await tx.knowledgeRelation.findMany({
          where: { toNodeId: sourceId },
        });
        const inSelfLoopIds = inRelations
          .filter((r) => r.fromNodeId === targetId)
          .map((r) => r.id);
        const inDupCandidates = inRelations.filter(
          (r) =>
            r.fromNodeId !== targetId &&
            r.label !== null &&
            r.sourceDocumentId !== null,
        );
        const inDupSourceIds: string[] = [];
        if (inDupCandidates.length > 0) {
          const existing = await tx.knowledgeRelation.findMany({
            where: {
              toNodeId: targetId,
              fromNodeId: { in: inDupCandidates.map((r) => r.fromNodeId) },
            },
            select: { fromNodeId: true, label: true, sourceDocumentId: true },
          });
          const seenKeys = new Set(
            existing.map((e) =>
              this.relationDedupKey(e.fromNodeId, targetId, e.label, e.sourceDocumentId),
            ),
          );
          for (const r of inDupCandidates) {
            const key = this.relationDedupKey(
              r.fromNodeId,
              targetId,
              r.label,
              r.sourceDocumentId,
            );
            if (seenKeys.has(key)) {
              inDupSourceIds.push(r.id);
            } else {
              seenKeys.add(key);
            }
          }
        }
        const inDeleteIds = [...inSelfLoopIds, ...inDupSourceIds];
        if (inDeleteIds.length > 0) {
          await tx.knowledgeRelation.deleteMany({
            where: { id: { in: inDeleteIds } },
          });
        }
        await tx.knowledgeRelation.updateMany({
          where: { toNodeId: sourceId },
          data: { toNodeId: targetId },
        });

        // ===== 4) source ノードを削除 =====
        await tx.knowledgeNode.delete({ where: { id: sourceId } });

        // ===== 5) target の mentionCount を mentions 実数で再計算 =====
        const targetCount = await tx.knowledgeMention.count({
          where: { nodeId: targetId },
        });
        await tx.knowledgeNode.update({
          where: { id: targetId },
          data: { mentionCount: targetCount },
        });
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  /**
   * KnowledgeRelation の @@unique キー（projectId は付替え範囲内で同一なので除外）。
   * label / sourceDocumentId は呼び出し側で両方 non-null のものに限定して使う。
   */
  private relationDedupKey(
    fromNodeId: string,
    toNodeId: string,
    label: string | null,
    sourceDocumentId: string | null,
  ): string {
    return [fromNodeId, toNodeId, label ?? '', sourceDocumentId ?? ''].join(' ');
  }

  async recomputeMentionCount(nodeIds: string[]): Promise<void> {
    const ids = Array.from(new Set(nodeIds)).filter(Boolean);
    if (ids.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      for (const nodeId of ids) {
        // 既に削除済みノード（マージ source 等）は count して 0 にしようとすると
        // 行が無く update が失敗するため、存在確認してから更新する。
        const exists = await tx.knowledgeNode.findUnique({
          where: { id: nodeId },
          select: { id: true },
        });
        if (!exists) continue;
        const count = await tx.knowledgeMention.count({ where: { nodeId } });
        await tx.knowledgeNode.update({
          where: { id: nodeId },
          data: { mentionCount: count },
        });
      }
    });
  }

  async findDocumentById(documentId: string): Promise<KnowledgeDocument | null> {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
    });
    if (!doc) return null;
    return this.documentToDomain(doc);
  }

  async saveDocument(document: KnowledgeDocument): Promise<void> {
    await this.prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        title: document.title,
        summary: document.summary,
        positionX: document.positionX,
        positionY: document.positionY,
        updatedAt: document.updatedAt,
      },
    });
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 削除前に、この文書を出典とする mentions が紐づくノード群を控える
      //（削除後に mentionCount を再計算するため）。
      const mentions = await tx.knowledgeMention.findMany({
        where: { documentId },
        select: { nodeId: true },
      });
      const affectedNodeIds = Array.from(
        new Set(mentions.map((m) => m.nodeId)),
      );

      // 文書削除：mentions は Cascade、relations.sourceDocumentId は SetNull（schema 定義）。
      await tx.knowledgeDocument.delete({ where: { id: documentId } });

      // 関係していたノードの mentionCount を実数で再計算。
      for (const nodeId of affectedNodeIds) {
        const exists = await tx.knowledgeNode.findUnique({
          where: { id: nodeId },
          select: { id: true },
        });
        if (!exists) continue;
        const count = await tx.knowledgeMention.count({ where: { nodeId } });
        await tx.knowledgeNode.update({
          where: { id: nodeId },
          data: { mentionCount: count },
        });
      }
    });
  }

  async search(
    projectId: string,
    query: string,
  ): Promise<KnowledgeSearchResult> {
    const q = query.trim();
    if (!q) {
      return { nodes: [], documents: [] };
    }
    const [nodes, documents] = await Promise.all([
      this.prisma.knowledgeNode.findMany({
        where: {
          projectId,
          label: { contains: q, mode: 'insensitive' },
        },
        orderBy: { mentionCount: 'desc' },
        take: 50,
      }),
      this.prisma.knowledgeDocument.findMany({
        where: {
          projectId,
          title: { contains: q, mode: 'insensitive' },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
    ]);
    return {
      nodes: nodes.map((n) => this.nodeToDomain(n)),
      documents: documents.map((d) => this.documentToDomain(d)),
    };
  }

  async findRelationById(relationId: string): Promise<KnowledgeEdgeData | null> {
    const rel = await this.prisma.knowledgeRelation.findUnique({
      where: { id: relationId },
    });
    if (!rel) return null;
    return this.edgeToData(rel);
  }

  async updateRelation(
    relationId: string,
    props: { label?: string | null; type?: string | null },
  ): Promise<KnowledgeEdgeData> {
    const data: { label?: string | null; type?: string | null } = {};
    if (props.label !== undefined) data.label = props.label;
    if (props.type !== undefined) data.type = props.type;
    const rel = await this.prisma.knowledgeRelation.update({
      where: { id: relationId },
      data,
    });
    return this.edgeToData(rel);
  }

  async deleteRelation(relationId: string): Promise<void> {
    await this.prisma.knowledgeRelation.delete({ where: { id: relationId } });
  }
}
