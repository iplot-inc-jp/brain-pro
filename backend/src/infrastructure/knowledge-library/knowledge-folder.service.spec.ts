import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KnowledgeFolderService } from './knowledge-folder.service';

describe('KnowledgeFolderService', () => {
  const prisma = {
    project: { findUnique: jest.fn() },
    knowledgeFolder: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    knowledgeFolderItem: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    knowledgeFolderTemplate: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    knowledgeFolderTemplateNode: { create: jest.fn() },
    ragDocument: { count: jest.fn() },
    knowledgeDocument: { count: jest.fn() },
    knowledgeNode: { count: jest.fn() },
    iproActivityDocument: { count: jest.fn() },
    $transaction: jest.fn(),
  };

  let service: KnowledgeFolderService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', organizationId: 'o1' });
    prisma.knowledgeFolder.findMany.mockResolvedValue([]);
    prisma.knowledgeFolder.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    service = new KnowledgeFolderService(prisma as never);
  });

  it('creates a nested folder only below a parent in the same project', async () => {
    prisma.knowledgeFolder.findUnique.mockResolvedValue({ id: 'parent', projectId: 'p1' });
    prisma.knowledgeFolder.create.mockResolvedValue({ id: 'child', name: '設計' });

    await expect(service.create('p1', { name: ' 設計 ', parentId: 'parent' })).resolves.toEqual({
      id: 'child',
      name: '設計',
    });
    expect(prisma.knowledgeFolder.create).toHaveBeenCalledWith({
      data: { projectId: 'p1', parentId: 'parent', name: '設計', order: 0 },
    });

    prisma.knowledgeFolder.findUnique.mockResolvedValue({ id: 'parent', projectId: 'p2' });
    await expect(service.create('p1', { name: 'NG', parentId: 'parent' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects moving a folder below one of its descendants', async () => {
    prisma.knowledgeFolder.findUnique
      .mockResolvedValueOnce({ id: 'root', projectId: 'p1', parentId: null })
      .mockResolvedValueOnce({ id: 'descendant', projectId: 'p1', parentId: 'root' });

    await expect(service.move('p1', 'root', 'descendant', 2)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.knowledgeFolder.update).not.toHaveBeenCalled();
  });

  it('adds the same item to multiple folders without duplicate memberships', async () => {
    prisma.knowledgeFolder.findMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);
    prisma.ragDocument.count.mockResolvedValue(1);
    prisma.knowledgeFolderItem.createMany.mockResolvedValue({ count: 2 });

    await service.addItemToFolders('p1', 'RAG', 'rag1', ['f1', 'f2', 'f2']);

    expect(prisma.knowledgeFolderItem.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: 'p1', folderId: 'f1', itemType: 'RAG', itemId: 'rag1' },
        { projectId: 'p1', folderId: 'f2', itemType: 'RAG', itemId: 'rag1' },
      ],
      skipDuplicates: true,
    });
  });

  it('validates every replacement folder before changing memberships', async () => {
    prisma.knowledgeFolder.findMany.mockResolvedValue([{ id: 'f1' }]);
    prisma.ragDocument.count.mockResolvedValue(1);

    await expect(
      service.replaceItemFolders('p1', 'RAG', 'rag1', ['f1', 'foreign']),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.knowledgeFolderItem.deleteMany).not.toHaveBeenCalled();
  });

  it('applies a built-in template idempotently by reusing same-name siblings', async () => {
    const existing = new Map<string, { id: string; name: string; parentId: string | null }>();
    let sequence = 0;
    prisma.knowledgeFolder.findFirst.mockImplementation(({ where }) => {
      const key = `${where.parentId ?? 'root'}:${where.name}`;
      return Promise.resolve(existing.get(key) ?? null);
    });
    prisma.knowledgeFolder.create.mockImplementation(({ data }) => {
      const folder = { id: `f${++sequence}`, name: data.name, parentId: data.parentId ?? null };
      existing.set(`${folder.parentId ?? 'root'}:${folder.name}`, folder);
      return Promise.resolve(folder);
    });

    await service.applyTemplate('p1', 'builtin:project-standard');
    const firstCreateCount = prisma.knowledgeFolder.create.mock.calls.length;
    await service.applyTemplate('p1', 'builtin:project-standard');

    expect(firstCreateCount).toBeGreaterThan(0);
    expect(prisma.knowledgeFolder.create).toHaveBeenCalledTimes(firstCreateCount);
  });

  it('refuses a custom template owned by another organization', async () => {
    prisma.knowledgeFolderTemplate.findFirst.mockResolvedValue(null);
    await expect(service.applyTemplate('p1', 'custom-template')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

