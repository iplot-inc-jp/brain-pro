import { describe, it, expect } from 'vitest';
import {
  roomIdForProject,
  projectIdFromRoom,
  shouldShowCursor,
  dedupeByUserId,
  initialsFromName,
  displayName,
} from './presence-helpers';

describe('presence-helpers', () => {
  it('roomIdForProject / projectIdFromRoom round-trip', () => {
    expect(roomIdForProject('p1')).toBe('project:p1');
    expect(projectIdFromRoom('project:p1')).toBe('p1');
    expect(projectIdFromRoom('p1')).toBe('p1'); // tolerant if no prefix
  });

  it('shouldShowCursor: only same page AND non-null cursor', () => {
    const base = { presence: { cursor: { x: 1, y: 2 }, page: '/a' } };
    expect(shouldShowCursor(base, '/a')).toBe(true);
    expect(shouldShowCursor(base, '/b')).toBe(false);
    expect(shouldShowCursor({ presence: { cursor: null, page: '/a' } }, '/a')).toBe(false);
  });

  it('dedupeByUserId keeps first per id', () => {
    const out = dedupeByUserId([{ id: 'u1', n: 1 }, { id: 'u1', n: 2 }, { id: 'u2', n: 3 }]);
    expect(out.map((x) => x.id)).toEqual(['u1', 'u2']);
  });

  it('initialsFromName', () => {
    expect(initialsFromName('Alice Smith')).toBe('AS');
    expect(initialsFromName('Bob')).toBe('B');
    expect(initialsFromName('')).toBe('?');
  });

  it('displayName prefers name, falls back to email local-part, then 匿名', () => {
    expect(displayName({ name: 'Alice', email: 'a@x.com' })).toBe('Alice');
    expect(displayName({ name: null, email: 'bob@x.com' })).toBe('bob');
    expect(displayName({ name: null, email: null })).toBe('匿名');
  });
});
