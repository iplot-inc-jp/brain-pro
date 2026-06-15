import {
  KnowledgeNode,
  KnowledgeDocument,
  KnowledgeEdgeData,
  KnowledgeGraphData,
  KnowledgeNodeDetail,
  KnowledgeMentionData,
  KnowledgeSearchResult,
} from '../../../domain';

export interface KnowledgeNodeOutput {
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
}

export interface KnowledgeEdgeOutput {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  type: string | null;
  confidence: number | null;
  sourceDocumentId: string | null;
}

export interface KnowledgeDocumentOutput {
  id: string;
  projectId: string;
  ingestionFileId: string | null;
  title: string;
  summary: string | null;
  sourceType: string;
  sourceRef: string | null;
  blobUrl: string | null;
  mimeType: string | null;
  positionX: number | null;
  positionY: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeMentionOutput {
  id: string;
  documentId: string;
  nodeId: string;
  relevance: number | null;
  snippet: string | null;
  documentTitle: string;
  documentBlobUrl: string | null;
}

export interface KnowledgeGraphOutput {
  nodes: KnowledgeNodeOutput[];
  edges: KnowledgeEdgeOutput[];
  documents: KnowledgeDocumentOutput[];
}

export interface KnowledgeNodeDetailOutput {
  node: KnowledgeNodeOutput;
  mentions: KnowledgeMentionOutput[];
  outRelations: KnowledgeEdgeOutput[];
  inRelations: KnowledgeEdgeOutput[];
}

export interface KnowledgeSearchOutput {
  nodes: KnowledgeNodeOutput[];
  documents: KnowledgeDocumentOutput[];
}

export function toKnowledgeNodeOutput(node: KnowledgeNode): KnowledgeNodeOutput {
  return {
    id: node.id,
    projectId: node.projectId,
    type: node.type,
    entityKind: node.entityKind,
    label: node.label,
    normalizedLabel: node.normalizedLabel,
    description: node.description,
    color: node.color,
    mentionCount: node.mentionCount,
    positionX: node.positionX,
    positionY: node.positionY,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

export function toKnowledgeEdgeOutput(
  edge: KnowledgeEdgeData,
): KnowledgeEdgeOutput {
  return {
    id: edge.id,
    projectId: edge.projectId,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    label: edge.label,
    type: edge.type,
    confidence: edge.confidence,
    sourceDocumentId: edge.sourceDocumentId,
  };
}

export function toKnowledgeDocumentOutput(
  doc: KnowledgeDocument,
): KnowledgeDocumentOutput {
  return {
    id: doc.id,
    projectId: doc.projectId,
    ingestionFileId: doc.ingestionFileId,
    title: doc.title,
    summary: doc.summary,
    sourceType: doc.sourceType,
    sourceRef: doc.sourceRef,
    blobUrl: doc.blobUrl,
    mimeType: doc.mimeType,
    positionX: doc.positionX,
    positionY: doc.positionY,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function toKnowledgeMentionOutput(
  mention: KnowledgeMentionData,
): KnowledgeMentionOutput {
  return {
    id: mention.id,
    documentId: mention.documentId,
    nodeId: mention.nodeId,
    relevance: mention.relevance,
    snippet: mention.snippet,
    documentTitle: mention.documentTitle,
    documentBlobUrl: mention.documentBlobUrl,
  };
}

export function toKnowledgeGraphOutput(
  graph: KnowledgeGraphData,
): KnowledgeGraphOutput {
  return {
    nodes: graph.nodes.map(toKnowledgeNodeOutput),
    edges: graph.edges.map(toKnowledgeEdgeOutput),
    documents: graph.documents.map(toKnowledgeDocumentOutput),
  };
}

export function toKnowledgeNodeDetailOutput(
  detail: KnowledgeNodeDetail,
): KnowledgeNodeDetailOutput {
  return {
    node: toKnowledgeNodeOutput(detail.node),
    mentions: detail.mentions.map(toKnowledgeMentionOutput),
    outRelations: detail.outRelations.map(toKnowledgeEdgeOutput),
    inRelations: detail.inRelations.map(toKnowledgeEdgeOutput),
  };
}

export function toKnowledgeSearchOutput(
  result: KnowledgeSearchResult,
): KnowledgeSearchOutput {
  return {
    nodes: result.nodes.map(toKnowledgeNodeOutput),
    documents: result.documents.map(toKnowledgeDocumentOutput),
  };
}
