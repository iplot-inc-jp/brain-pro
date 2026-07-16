import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileStatusTable } from './FileStatusTable';
import type { IngestionFile } from '@/lib/knowledge';

const file: IngestionFile = {
  id: 'file-1',
  batchId: 'batch-1',
  projectId: 'project-1',
  sourceType: 'UPLOAD',
  sourceRef: null,
  filename: 'proposal.pdf',
  displayName: null,
  mimeType: 'application/pdf',
  size: 1024,
  blobUrl: null,
  isArchive: false,
  parentFileId: null,
  status: 'FAILED',
  step: 'ページ抽出',
  progress: 67,
  attempts: 1,
  maxAttempts: 4,
  error: '一部ページ失敗',
  jobId: 'root-1',
  knowledgeDocumentId: 'doc-1',
  pageProgress: { succeeded: 2, total: 3, failedPageNumbers: [2] },
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
};

describe('FileStatusTable page progress', () => {
  it('shows succeeded total and failed page numbers from batch aggregate', () => {
    render(
      <FileStatusTable
        files={[file]}
        busy={false}
        canEdit
        onRetry={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText('2 / 3 ページ成功')).toBeInTheDocument();
    expect(screen.getByText('失敗: 2')).toBeInTheDocument();
  });
});
