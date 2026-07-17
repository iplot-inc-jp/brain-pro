import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { KnowledgeLibraryController } from './knowledge-library.controller';

describe('KnowledgeLibraryController', () => {
  const library = { search: jest.fn() };
  const folders = {
    list: jest.fn(), create: jest.fn(), rename: jest.fn(), move: jest.fn(), deletePreview: jest.fn(),
    remove: jest.fn(), replaceItemFolders: jest.fn(), addItemToFolders: jest.fn(), listTemplates: jest.fn(),
    saveCurrentAsTemplate: jest.fn(), renameTemplate: jest.fn(), deleteTemplate: jest.fn(), applyTemplate: jest.fn(),
  };
  const controller = new KnowledgeLibraryController(library as never, folders as never);

  beforeEach(() => jest.resetAllMocks());

  const route = (method: keyof KnowledgeLibraryController) => {
    const handler = KnowledgeLibraryController.prototype[method];
    return {
      path: Reflect.getMetadata(PATH_METADATA, handler),
      method: Reflect.getMetadata(METHOD_METADATA, handler),
    };
  };

  it('publishes the project-scoped search, folder, membership, and template routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, KnowledgeLibraryController)).toBe('projects/:projectId');
    expect(route('search')).toEqual({ path: 'knowledge-library/search', method: RequestMethod.GET });
    expect(route('createFolder')).toEqual({ path: 'knowledge-folders', method: RequestMethod.POST });
    expect(route('updateFolder')).toEqual({ path: 'knowledge-folders/:folderId', method: RequestMethod.PATCH });
    expect(route('deletePreview')).toEqual({ path: 'knowledge-folders/:folderId/delete-preview', method: RequestMethod.GET });
    expect(route('replaceFolders')).toEqual({ path: 'knowledge-library/items/:itemType/:itemId/folders', method: RequestMethod.PUT });
    expect(route('addFolderItems')).toEqual({ path: 'knowledge-folders/:folderId/items', method: RequestMethod.POST });
    expect(route('applyTemplate')).toEqual({ path: 'knowledge-folder-templates/:templateId/apply', method: RequestMethod.POST });
  });

  it('normalizes search filters and delegates with the project id', async () => {
    library.search.mockResolvedValue({ items: [] });
    await controller.search('p1', {
      q: '受注', itemTypes: ['RAG', 'CHAT'], folderId: 'f1', unclassified: true, limit: 25,
    });
    expect(library.search).toHaveBeenCalledWith('p1', {
      q: '受注', itemTypes: ['RAG', 'CHAT'], folderId: 'f1', unclassified: true, limit: 25,
    });
  });

  it('delegates folder movement, memberships, and company template creation', async () => {
    await controller.updateFolder('p1', 'f1', { name: '設計', parentId: 'root', order: 3 });
    expect(folders.rename).toHaveBeenCalledWith('p1', 'f1', '設計');
    expect(folders.move).toHaveBeenCalledWith('p1', 'f1', 'root', 3);

    await controller.replaceFolders('p1', 'RAG', 'r1', { folderIds: ['f1', 'f2'] });
    expect(folders.replaceItemFolders).toHaveBeenCalledWith('p1', 'RAG', 'r1', ['f1', 'f2']);

    await controller.createTemplate({ id: 'u1' } as never, 'p1', { name: '標準構成' });
    expect(folders.saveCurrentAsTemplate).toHaveBeenCalledWith('p1', '標準構成', 'u1');
  });
});
