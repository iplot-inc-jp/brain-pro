import { Injectable } from '@nestjs/common';
import { KnowledgeLibraryItemType, Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import {
  KnowledgeLibraryResultItem,
  KnowledgeLibrarySearchInput,
  KnowledgeLibrarySearchResult,
  KnowledgeLibrarySearchWarning,
  KnowledgeLibrarySourceFile,
} from './knowledge-library.types';

const ALL_TYPES: KnowledgeLibraryItemType[] = [
  'RAG',
  'KNOWLEDGE_DOCUMENT',
  'KNOWLEDGE_NODE',
  'CHAT',
  'RESOURCE',
];
const RESOURCE_SOURCES = ['document', 'recording', 'project_context', 'project_memory', 'tracker_task'];
const TYPE_ORDER = new Map(ALL_TYPES.map((type, index) => [type, index]));

type Candidate = Omit<KnowledgeLibraryResultItem, 'folderIds' | 'score'> & {
  searchableText: string;
};

@Injectable()
export class KnowledgeLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    projectId: string,
    input: KnowledgeLibrarySearchInput = {},
  ): Promise<KnowledgeLibrarySearchResult> {
    const q = input.q?.trim() ?? '';
    const limit = this.limit(input.limit);
    const enabled = new Set(input.itemTypes?.length ? input.itemTypes : ALL_TYPES);
    const textFilter = q
      ? {
          contains: q,
          mode: Prisma.QueryMode.insensitive,
        }
      : undefined;

    const jobs: Array<{
      source: KnowledgeLibrarySearchWarning['source'];
      run: () => Promise<Candidate[]>;
    }> = [];

    if (enabled.has('RAG')) {
      jobs.push({
        source: 'RAG',
        run: async () => {
          const rows = await this.prisma.ragDocument.findMany({
            where: {
              projectId,
              ...(textFilter
                ? { OR: [{ title: textFilter }, { summary: textFilter }, { searchText: textFilter }] }
                : {}),
            },
            include: { sourceReferences: { orderBy: { order: 'asc' } } },
            orderBy: { generatedAt: 'desc' },
            take: limit * 3,
          });
          return rows.map((row) => ({
            itemType: 'RAG' as const,
            itemId: row.id,
            title: row.title,
            excerpt: row.summary || row.content.slice(0, 300),
            occurredAt: row.generatedAt,
            sourcePageUrl: row.sourceUrl,
            sourceFiles: row.sourceReferences.map((reference) => ({
              label: reference.label,
              url: reference.url,
              filename: reference.filename ?? null,
              mimeType: reference.mimeType ?? null,
            })),
            searchableText: `${row.title}\n${row.summary}\n${row.content}`,
          }));
        },
      });
    }

    if (enabled.has('KNOWLEDGE_DOCUMENT')) {
      jobs.push({
        source: 'KNOWLEDGE_DOCUMENT',
        run: async () => {
          const rows = await this.prisma.knowledgeDocument.findMany({
            where: {
              projectId,
              ...(textFilter
                ? { OR: [{ title: textFilter }, { summary: textFilter }, { contentText: textFilter }] }
                : {}),
            },
            orderBy: { updatedAt: 'desc' },
            take: limit * 3,
          });
          return rows.map((row) => ({
            itemType: 'KNOWLEDGE_DOCUMENT' as const,
            itemId: row.id,
            title: row.title,
            excerpt: row.summary || row.contentText?.slice(0, 300) || '',
            occurredAt: row.updatedAt,
            sourcePageUrl: `/dashboard/projects/${projectId}/knowledge/list?tab=documents&documentId=${row.id}`,
            sourceFiles: row.blobUrl
              ? [{ label: row.title, url: row.blobUrl, filename: row.title, mimeType: row.mimeType }]
              : [],
            searchableText: `${row.title}\n${row.summary ?? ''}\n${row.contentText ?? ''}`,
          }));
        },
      });
    }

    if (enabled.has('KNOWLEDGE_NODE')) {
      jobs.push({
        source: 'KNOWLEDGE_NODE',
        run: async () => {
          const rows = await this.prisma.knowledgeNode.findMany({
            where: {
              projectId,
              ...(textFilter ? { OR: [{ label: textFilter }, { description: textFilter }] } : {}),
            },
            orderBy: { updatedAt: 'desc' },
            take: limit * 3,
          });
          return rows.map((row) => ({
            itemType: 'KNOWLEDGE_NODE' as const,
            itemId: row.id,
            title: row.label,
            excerpt: row.description ?? '',
            occurredAt: row.updatedAt,
            sourcePageUrl: `/dashboard/projects/${projectId}/knowledge/list?tab=nodes&nodeId=${row.id}`,
            sourceFiles: [],
            searchableText: `${row.label}\n${row.description ?? ''}`,
          }));
        },
      });
    }

    if (enabled.has('CHAT') || enabled.has('RESOURCE')) {
      jobs.push({
        source: 'ACTIVITY',
        run: async () => {
          const allowedSources = [
            ...(enabled.has('CHAT') ? ['chat'] : []),
            ...(enabled.has('RESOURCE') ? RESOURCE_SOURCES : []),
          ];
          const rows = await this.prisma.iproActivityDocument.findMany({
            where: {
              projectId,
              source: { in: allowedSources },
              ...(textFilter ? { OR: [{ title: textFilter }, { content: textFilter }] } : {}),
            },
            orderBy: { occurredAt: 'desc' },
            take: limit * 3,
          });
          return rows.map((row) => {
            const itemType: KnowledgeLibraryItemType = row.source === 'chat' ? 'CHAT' : 'RESOURCE';
            const externalUrl = this.metadataUrl(row.metadata);
            const sourceFiles: KnowledgeLibrarySourceFile[] = externalUrl
              ? [{ label: row.title || row.source, url: externalUrl, filename: null, mimeType: null }]
              : [];
            return {
              itemType,
              itemId: row.id,
              title: row.title || row.roomName || (itemType === 'CHAT' ? 'チャット' : '受信リソース'),
              excerpt: row.content.slice(0, 300),
              occurredAt: row.occurredAt,
              sourcePageUrl: `/dashboard/projects/${projectId}/knowledge/${itemType === 'CHAT' ? 'chat-history' : 'resources'}?item=${row.id}`,
              sourceFiles,
              searchableText: `${row.title ?? ''}\n${row.content}`,
            };
          });
        },
      });
    }

    const settled = await Promise.allSettled(jobs.map((job) => job.run()));
    const warnings: KnowledgeLibrarySearchWarning[] = [];
    const candidates: Candidate[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') candidates.push(...result.value);
      else warnings.push({ source: jobs[index].source, message: this.errorMessage(result.reason) });
    });

    const memberships = await this.prisma.knowledgeFolderItem.findMany({
      where: {
        projectId,
        ...(input.folderId ? { folderId: input.folderId } : {}),
      },
      select: { itemType: true, itemId: true, folderId: true },
    });
    const allMemberships = input.folderId
      ? await this.prisma.knowledgeFolderItem.findMany({
          where: { projectId, itemId: { in: candidates.map((item) => item.itemId) } },
          select: { itemType: true, itemId: true, folderId: true },
        })
      : memberships;
    const folderIdsByItem = new Map<string, string[]>();
    for (const membership of allMemberships) {
      const key = this.itemKey(membership.itemType, membership.itemId);
      const ids = folderIdsByItem.get(key) ?? [];
      if (!ids.includes(membership.folderId)) ids.push(membership.folderId);
      folderIdsByItem.set(key, ids);
    }
    const inSelectedFolder = new Set(
      memberships.map((membership) => this.itemKey(membership.itemType, membership.itemId)),
    );

    const items = candidates
      .map((candidate) => {
        const folderIds = folderIdsByItem.get(this.itemKey(candidate.itemType, candidate.itemId)) ?? [];
        return { ...candidate, folderIds, score: this.score(q, candidate.title, candidate.searchableText) };
      })
      .filter((item) => !input.folderId || inSelectedFolder.has(this.itemKey(item.itemType, item.itemId)))
      .filter((item) => !input.unclassified || item.folderIds.length === 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.occurredAt.getTime() - left.occurredAt.getTime() ||
          (TYPE_ORDER.get(left.itemType) ?? 99) - (TYPE_ORDER.get(right.itemType) ?? 99),
      )
      .slice(0, limit)
      .map(({ searchableText: _searchableText, ...item }) => item);

    const totals = Object.fromEntries([...ALL_TYPES.map((type) => [type, 0]), ['all', items.length]]) as
      KnowledgeLibrarySearchResult['totals'];
    for (const item of items) totals[item.itemType] += 1;
    return { items, warnings, totals };
  }

  private score(q: string, title: string, searchableText: string) {
    if (!q) return 0;
    const needle = q.toLocaleLowerCase('ja');
    const normalizedTitle = title.toLocaleLowerCase('ja');
    if (normalizedTitle === needle) return 4;
    return (normalizedTitle.includes(needle) ? 2 : 0) +
      (searchableText.toLocaleLowerCase('ja').includes(needle) ? 1 : 0);
  }

  private metadataUrl(metadata: Prisma.JsonValue | null): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    for (const key of ['url', 'sourceUrl', 'downloadUrl', 'blobUrl']) {
      const value = (metadata as Prisma.JsonObject)[key];
      if (typeof value === 'string' && /^https?:\/\//.test(value)) return value;
    }
    return null;
  }

  private itemKey(itemType: KnowledgeLibraryItemType, itemId: string) {
    return `${itemType}:${itemId}`;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'search source unavailable';
  }

  private limit(value?: number) {
    if (!Number.isFinite(value) || !value || value < 1) return 50;
    return Math.min(100, Math.floor(value));
  }
}
