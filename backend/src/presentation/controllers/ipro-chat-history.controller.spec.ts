import { ForbiddenError } from '../../domain';
import { IproChatHistoryController } from './ipro-chat-history.controller';

function makeDependencies() {
  return {
    service: {
      search: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      facets: jest.fn().mockResolvedValue({ sources: [], platforms: [], rooms: [], authors: [] }),
      context: jest.fn().mockResolvedValue({ selected: {}, before: [], after: [] }),
    } as any,
    projectAccess: {
      assertPrincipalAccess: jest.fn().mockResolvedValue(undefined),
    } as any,
  };
}

const viewer = { id: 'viewer-1', email: 'viewer@example.test' } as any;

describe('IproChatHistoryController', () => {
  it('allows project VIEW access for search, facets, and context', async () => {
    const d = makeDependencies();
    const controller = new IproChatHistoryController(d.service, d.projectAccess);

    await controller.search(viewer, 'project-1', {} as any);
    await controller.facets(viewer, 'project-1', {} as any);
    await controller.context(viewer, 'project-1', 'message-1');

    expect(d.projectAccess.assertPrincipalAccess).toHaveBeenCalledTimes(3);
    expect(d.projectAccess.assertPrincipalAccess).toHaveBeenNthCalledWith(
      1,
      viewer,
      'project-1',
      'view',
    );
    expect(d.service.search).toHaveBeenCalledWith('project-1', {});
    expect(d.service.facets).toHaveBeenCalledWith('project-1', {});
    expect(d.service.context).toHaveBeenCalledWith('project-1', 'message-1');
  });

  it('rejects another project for all three endpoints', async () => {
    const d = makeDependencies();
    d.projectAccess.assertPrincipalAccess.mockRejectedValue(
      new ForbiddenError('You do not have access to this project'),
    );
    const controller = new IproChatHistoryController(d.service, d.projectAccess);

    await expect(controller.search(viewer, 'other-project', {} as any)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(controller.facets(viewer, 'other-project', {} as any)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      controller.context(viewer, 'other-project', 'message-1'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.service.search).not.toHaveBeenCalled();
    expect(d.service.facets).not.toHaveBeenCalled();
    expect(d.service.context).not.toHaveBeenCalled();
  });
});
