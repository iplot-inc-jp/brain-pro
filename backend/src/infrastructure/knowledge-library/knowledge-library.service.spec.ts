import { KnowledgeLibraryService } from './knowledge-library.service';

describe('KnowledgeLibraryService', () => {
  const now = new Date('2026-07-17T00:00:00.000Z');
  const prisma = {
    ragDocument: { findMany: jest.fn() },
    knowledgeDocument: { findMany: jest.fn() },
    knowledgeNode: { findMany: jest.fn() },
    iproActivityDocument: { findMany: jest.fn() },
    knowledgeFolderItem: { findMany: jest.fn() },
  };
  let service: KnowledgeLibraryService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.ragDocument.findMany.mockResolvedValue([]);
    prisma.knowledgeDocument.findMany.mockResolvedValue([]);
    prisma.knowledgeNode.findMany.mockResolvedValue([]);
    prisma.iproActivityDocument.findMany.mockResolvedValue([]);
    prisma.knowledgeFolderItem.findMany.mockResolvedValue([]);
    service = new KnowledgeLibraryService(prisma as never);
  });

  it('merges RAG, documents, nodes, chats, and resources into one ranked result', async () => {
    prisma.ragDocument.findMany.mockResolvedValue([
      {
        id: 'r1',
        title: '受注フロー',
        summary: '受注の概要',
        content: '営業から連携',
        sourceUrl: '/flows/f1',
        generatedAt: now,
        sourceReferences: [
          { kind: 'FILE', label: '要件.pdf', url: 'https://blob/requirements.pdf', filename: '要件.pdf' },
        ],
      },
    ]);
    prisma.knowledgeDocument.findMany.mockResolvedValue([
      { id: 'd1', title: '要件.pdf', summary: '受注要件', contentText: '本文', blobUrl: 'https://blob/req', mimeType: 'application/pdf', updatedAt: now },
    ]);
    prisma.knowledgeNode.findMany.mockResolvedValue([
      { id: 'n1', label: '受注管理', description: '基幹システム', updatedAt: now },
    ]);
    prisma.iproActivityDocument.findMany.mockResolvedValue([
      { id: 'c1', source: 'chat', title: '相談', content: '受注について相談', occurredAt: now, metadata: {} },
      { id: 'x1', source: 'document', title: '外部資料', content: '受注の参考', occurredAt: now, metadata: { url: 'https://example.test/source' } },
    ]);
    prisma.knowledgeFolderItem.findMany.mockResolvedValue([
      { itemType: 'RAG', itemId: 'r1', folderId: 'f1' },
      { itemType: 'RAG', itemId: 'r1', folderId: 'f2' },
    ]);

    const result = await service.search('p1', { q: '受注', limit: 20 });

    expect(new Set(result.items.map((item) => item.itemType))).toEqual(
      new Set(['RAG', 'KNOWLEDGE_DOCUMENT', 'KNOWLEDGE_NODE', 'CHAT', 'RESOURCE']),
    );
    expect(result.items[0].title).toBe('受注フロー');
    expect(result.items.find((item) => item.itemId === 'r1')).toMatchObject({
      sourcePageUrl: '/flows/f1',
      folderIds: ['f1', 'f2'],
      sourceFiles: [{ label: '要件.pdf', url: 'https://blob/requirements.pdf', filename: '要件.pdf', mimeType: null }],
    });
    expect(result.totals.all).toBe(5);
    expect(result.warnings).toEqual([]);
  });

  it('supports type, folder, and unclassified filters', async () => {
    prisma.ragDocument.findMany.mockResolvedValue([
      { id: 'r1', title: 'A', summary: '', content: '', sourceUrl: '/a', generatedAt: now, sourceReferences: [] },
      { id: 'r2', title: 'B', summary: '', content: '', sourceUrl: '/b', generatedAt: now, sourceReferences: [] },
    ]);
    prisma.knowledgeFolderItem.findMany.mockResolvedValue([
      { itemType: 'RAG', itemId: 'r1', folderId: 'f1' },
    ]);

    const inFolder = await service.search('p1', { itemTypes: ['RAG'], folderId: 'f1' });
    expect(inFolder.items.map((item) => item.itemId)).toEqual(['r1']);
    expect(prisma.knowledgeDocument.findMany).not.toHaveBeenCalled();

    const unclassified = await service.search('p1', { itemTypes: ['RAG'], unclassified: true });
    expect(unclassified.items.map((item) => item.itemId)).toEqual(['r2']);
  });

  it('passes RAG feature and scope filters to the RAG source only', async () => {
    await service.search('p1', {
      ragFeatureType: 'BUSINESS_FLOW',
      ragScopeLevel: 'OVERVIEW',
    });

    expect(prisma.ragDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: 'p1',
        featureType: 'BUSINESS_FLOW',
        scopeLevel: 'OVERVIEW',
      }),
    }));
    expect(prisma.knowledgeDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId: 'p1' },
    }));
  });

  it('returns available sources with warnings when one source fails', async () => {
    prisma.ragDocument.findMany.mockRejectedValue(new Error('rag temporarily unavailable'));
    prisma.knowledgeDocument.findMany.mockResolvedValue([
      { id: 'd1', title: '設計書', summary: '', contentText: '', blobUrl: null, mimeType: null, updatedAt: now },
    ]);

    const result = await service.search('p1', { q: '設計' });

    expect(result.items.map((item) => item.itemId)).toContain('d1');
    expect(result.warnings).toEqual([{ source: 'RAG', message: 'rag temporarily unavailable' }]);
  });
});
