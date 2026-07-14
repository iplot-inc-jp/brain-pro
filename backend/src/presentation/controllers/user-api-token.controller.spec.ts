import { UserApiTokenController } from './user-api-token.controller';

describe('UserApiTokenController', () => {
  const user = { id: 'user-1', email: 'a@b.c' } as any;
  const svc = {
    mint: jest.fn().mockResolvedValue({ id: 'tok-1', name: 'ipro', token: 'jwt.here.sig', createdAt: new Date(0) }),
    list: jest.fn().mockResolvedValue([{ id: 'tok-1', name: 'ipro', lastUsedAt: null, createdAt: new Date(0) }]),
    revoke: jest.fn().mockResolvedValue(undefined),
  } as any;
  const ctl = new UserApiTokenController(svc);

  it('create: 自分(user.id)名義で mint し、平文トークンを1回返す', async () => {
    const out = await ctl.create(user, { name: 'ipro' } as any);
    expect(svc.mint).toHaveBeenCalledWith('user-1', 'ipro', expect.any(Number));
    expect(out.token).toBe('jwt.here.sig');
  });

  it('list: 自分のトークンだけ（平文なし）', async () => {
    const out = await ctl.list(user);
    expect(svc.list).toHaveBeenCalledWith('user-1');
    expect(JSON.stringify(out)).not.toContain('token');
  });

  it('revoke: 自分(user.id)スコープで失効', async () => {
    const out = await ctl.revoke(user, 'tok-1');
    expect(svc.revoke).toHaveBeenCalledWith('user-1', 'tok-1');
    expect(out).toEqual({ success: true });
  });
});
