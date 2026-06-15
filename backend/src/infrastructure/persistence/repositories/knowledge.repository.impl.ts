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
        positionX: document.positionX,
        positionY: document.positionY,
        updatedAt: document.updatedAt,
      },
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
}
