import { User } from './user.entity';

describe('User googleId', () => {
  it('createWithGoogle は password を空・googleId を設定する', () => {
    const u = User.createWithGoogle(
      { email: 'g@example.com', name: 'Google User', avatarUrl: 'http://x/y.png', googleId: 'gid-1' },
      'user-1',
    );
    expect(u.password).toBe('');
    expect(u.googleId).toBe('gid-1');
    expect(u.email).toBe('g@example.com');
    expect(u.name).toBe('Google User');
    expect(u.avatarUrl).toBe('http://x/y.png');
    expect(u.isSuperAdmin).toBe(false);
  });

  it('linkGoogle は googleId を後付けする', () => {
    const u = User.create({ email: 'a@example.com', password: 'x', name: null }, 'hashed', 'user-2');
    expect(u.googleId).toBeNull();
    u.linkGoogle('gid-2');
    expect(u.googleId).toBe('gid-2');
  });

  it('reconstruct は googleId を復元する', () => {
    const now = new Date();
    const u = User.reconstruct({
      id: 'user-3', email: 'b@example.com', password: 'h', name: null,
      avatarUrl: null, isSuperAdmin: false, googleId: 'gid-3', createdAt: now, updatedAt: now,
    });
    expect(u.googleId).toBe('gid-3');
  });
});
