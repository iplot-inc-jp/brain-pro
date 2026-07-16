import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundJobsPanel } from './background-jobs-panel';

const rootJob = {
  id: 'root-1',
  parentJobId: null,
  type: 'KG_INGEST_FILE',
  status: 'FAILED',
  result: null,
  error: '2ページ目で停止',
  progress: 50,
  attempts: 1,
  maxAttempts: 4,
  projectId: 'project-1',
  createdById: 'u1',
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
  startedAt: '2026-07-16T00:00:00.000Z',
  finishedAt: '2026-07-16T00:01:00.000Z',
  payload: { fileId: 'file-1' },
  children: [
    {
      id: 'child-1',
      parentJobId: 'root-1',
      type: 'KG_INGEST_PAGE',
      status: 'SUCCEEDED',
      result: null,
      error: null,
      progress: 100,
      attempts: 1,
      maxAttempts: 4,
      projectId: 'project-1',
      createdById: 'u1',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
      startedAt: '2026-07-16T00:00:00.000Z',
      finishedAt: '2026-07-16T00:00:30.000Z',
      knowledgePage: {
        id: 'page-1',
        pageNumber: 1,
        pageKind: 'PDF_PAGE',
        status: 'SUCCEEDED',
        error: null,
      },
    },
    {
      id: 'child-2',
      parentJobId: 'root-1',
      type: 'KG_INGEST_PAGE',
      status: 'FAILED',
      result: null,
      error: 'モデル応答が中断しました',
      progress: 20,
      attempts: 4,
      maxAttempts: 4,
      projectId: 'project-1',
      createdById: 'u1',
      createdAt: '2026-07-16T00:00:01.000Z',
      updatedAt: '2026-07-16T00:00:01.000Z',
      startedAt: '2026-07-16T00:00:01.000Z',
      finishedAt: '2026-07-16T00:01:00.000Z',
      knowledgePage: {
        id: 'page-2',
        pageNumber: 2,
        pageKind: 'PPTX_SLIDE',
        status: 'FAILED',
        error: 'モデル応答が中断しました',
      },
    },
  ],
};

describe('BackgroundJobsPanel hierarchy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders root-only rows and expands ordered page children accessibly', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([rootJob]), { status: 200 }),
    );
    render(<BackgroundJobsPanel projectId="project-1" />);

    const toggle = await screen.findByRole('button', {
      name: '資料取り込みの子ジョブを表示',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByTestId('root-job')).toHaveLength(1);
    expect(screen.queryByText('スライド 2')).not.toBeInTheDocument();
    expect(screen.getByText('1 / 2 ページ成功')).toBeInTheDocument();

    toggle.focus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const page1 = screen.getByText('ページ 1');
    const slide2 = screen.getByText('スライド 2');
    expect(page1.compareDocumentPosition(slide2)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText('4 / 4 回')).toBeInTheDocument();
    expect(screen.getByText('モデル応答が中断しました')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'スライド 2を再試行' }),
    ).toBeInTheDocument();
  });

  it('uses separate parent resume and failed-child retry endpoints', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) =>
        init?.method === 'POST'
          ? new Response(JSON.stringify({ status: 'QUEUED' }), { status: 202 })
          : new Response(JSON.stringify([rootJob]), { status: 200 }),
    );
    render(<BackgroundJobsPanel projectId="project-1" />);

    await user.click(
      await screen.findByRole('button', { name: '未完了ページを再開' }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/projects/project-1/jobs/root-1/resume'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await user.click(
      screen.getByRole('button', { name: '資料取り込みの子ジョブを表示' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'スライド 2を再試行' }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/knowledge-document-pages/page-2/retry'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
