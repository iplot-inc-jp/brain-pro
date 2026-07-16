import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeDetailPanel } from './NodeDetailPanel';
import type { KnowledgeDocument } from '@/lib/knowledge';

const document: KnowledgeDocument = {
  id: 'doc-1',
  projectId: 'project-1',
  ingestionFileId: 'file-1',
  title: '提案資料.pdf',
  summary: '資料全体の要約',
  sourceType: 'UPLOAD',
  sourceRef: null,
  blobUrl: null,
  mimeType: 'application/pdf',
  positionX: null,
  positionY: null,
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
};

function renderDocument() {
  return render(
    <NodeDetailPanel
      selectedNode={null}
      selectedDocument={document}
      nodeById={new Map()}
      onSelectNode={vi.fn()}
      onSelectDocument={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('NodeDetailPanel document pages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads pages only for a selected document and shows retry only for failed pages', async () => {
    const longText = '長い抽出本文'.repeat(80);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: 'page-1',
            pageNumber: 1,
            pageKind: 'PDF_PAGE',
            status: 'SUCCEEDED',
            summary: '要点1',
            contentText: longText,
            error: null,
          },
          {
            id: 'page-2',
            pageNumber: 2,
            pageKind: 'PPTX_SLIDE',
            status: 'FAILED',
            summary: null,
            contentText: null,
            error: 'モデル応答が中断しました',
          },
          {
            id: 'page-3',
            pageNumber: 3,
            pageKind: 'PDF_PAGE',
            status: 'SUCCEEDED',
            summary: '',
            contentText: '',
            error: null,
          },
        ]),
        { status: 200 },
      ),
    );

    renderDocument();

    expect(await screen.findByText('ページ 1')).toBeInTheDocument();
    expect(screen.getByText('スライド 2')).toBeInTheDocument();
    expect(screen.getByText('抽出内容なし')).toBeInTheDocument();
    expect(screen.getByText('モデル応答が中断しました')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /再試行/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '全文を表示' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/api/knowledge-documents/doc-1/pages',
    );
  });

  it('retries one failed page and refreshes only its page list', async () => {
    const user = userEvent.setup();
    const pages = [
      {
        id: 'page-2',
        pageNumber: 2,
        pageKind: 'PDF_PAGE',
        status: 'FAILED',
        summary: null,
        contentText: null,
        error: '失敗',
      },
    ];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(pages), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'child-2', status: 'QUEUED' }), {
          status: 202,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ ...pages[0], status: 'PENDING', error: null }]),
          { status: 200 },
        ),
      );
    renderDocument();

    await user.click(await screen.findByRole('button', { name: 'ページ 2を再試行' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][0]).toContain(
      '/api/knowledge-document-pages/page-2/retry',
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
