import { ForbiddenError } from '../../../domain';
import { IssueLiveblocksTokenUseCase } from './issue-liveblocks-token.use-case';

function makeDeps(opts?: {
  level?: 'EDIT' | 'VIEW' | null;
  user?: { email: string; name: string | null; avatarUrl: string | null } | null;
}) {
  const userRepository = {
    findById: jest.fn(async () =>
      opts?.user === undefined
        ? { email: 'alice@example.com', name: 'Alice', avatarUrl: 'http://img/a.png' }
        : opts.user,
    ),
  };
  const projectAccess = {
    resolveForPrincipal: jest.fn(async () =>
      opts?.level === undefined ? 'EDIT' : opts.level,
    ),
  };
  const liveblocks = {
    mintToken: jest.fn(async () => ({ body: '{"token":"t"}', status: 200 })),
  };
  return { userRepository, projectAccess, liveblocks } as {
    userRepository: { findById: jest.Mock };
    projectAccess: { resolveForPrincipal: jest.Mock };
    liveblocks: { mintToken: jest.Mock };
  };
}

function makeUseCase(d: ReturnType<typeof makeDeps>) {
  return new IssueLiveblocksTokenUseCase(
    d.userRepository as any,
    d.projectAccess as any,
    d.liveblocks as any,
  );
}

describe('IssueLiveblocksTokenUseCase', () => {
  it('rejects API-key callers', async () => {
    const d = makeDeps();
    await expect(
      makeUseCase(d).execute({
        userId: 'u1',
        apiKeyId: 'k1',
        principal: { id: 'u1' },
        projectId: 'p1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.projectAccess.resolveForPrincipal).not.toHaveBeenCalled();
  });

  it('rejects when the user has no project access', async () => {
    const d = makeDeps({ level: null });
    await expect(
      makeUseCase(d).execute({ userId: 'u1', principal: { id: 'u1' }, projectId: 'p1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('mints with FULL_ACCESS for EDIT and a project:{id} room', async () => {
    const d = makeDeps({ level: 'EDIT' });
    const out = await makeUseCase(d).execute({ userId: 'u1', principal: { id: 'u1' }, projectId: 'p1' });
    expect(out).toEqual({ body: '{"token":"t"}', status: 200 });
    const arg = d.liveblocks.mintToken.mock.calls[0][0];
    expect(arg.fullAccess).toBe(true);
    expect(arg.roomId).toBe('project:p1');
    expect(arg.userInfo.name).toBe('Alice');
    expect(arg.userInfo.email).toBe('alice@example.com');
    expect(arg.userInfo.avatarUrl).toBe('http://img/a.png');
    expect(typeof arg.userInfo.color).toBe('string');
  });

  it('mints with read access (fullAccess=false) for VIEW', async () => {
    const d = makeDeps({ level: 'VIEW' });
    await makeUseCase(d).execute({ userId: 'u1', principal: { id: 'u1' }, projectId: 'p1' });
    expect(d.liveblocks.mintToken.mock.calls[0][0].fullAccess).toBe(false);
  });

  it('falls back to the email local-part when name is null', async () => {
    const d = makeDeps({ level: 'EDIT', user: { email: 'bob@example.com', name: null, avatarUrl: null } });
    await makeUseCase(d).execute({ userId: 'u1', principal: { id: 'u1' }, projectId: 'p1' });
    expect(d.liveblocks.mintToken.mock.calls[0][0].userInfo.name).toBe('bob');
  });

  it('rejects when the user record is missing', async () => {
    const d = makeDeps({ level: 'EDIT', user: null });
    await expect(
      makeUseCase(d).execute({ userId: 'u1', principal: { id: 'u1' }, projectId: 'p1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
