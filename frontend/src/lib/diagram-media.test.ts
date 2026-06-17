import { describe, it, expect } from 'vitest';
import { inferMediaKind } from './diagram-media';

describe('inferMediaKind', () => {
  it('classifies by mime type', () => {
    expect(inferMediaKind('image/png')).toBe('image');
    expect(inferMediaKind('image/svg+xml')).toBe('image');
    expect(inferMediaKind('video/mp4')).toBe('video');
    expect(inferMediaKind('application/pdf')).toBe('pdf');
    expect(inferMediaKind('application/zip')).toBe('other');
    expect(inferMediaKind('')).toBe('other');
  });
});
