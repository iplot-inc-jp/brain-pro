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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
            retryable: false,
          },
          {
            id: 'page-2',
            pageNumber: 2,
            pageKind: 'PPTX_SLIDE',
            status: 'FAILED',
            summary: null,
            contentText: null,
            error: 'モデル応答が中断しました',
            retryable: false,
          },
          {
            id: 'page-3',
            pageNumber: 3,
            pageKind: 'PDF_PAGE',
            status: 'SUCCEEDED',
            summary: '',
            contentText: '',
            error: null,
            retryable: false,
          },
          {
            id: 'page-4',
            pageNumber: 4,
            pageKind: 'PDF_PAGE',
            status: 'FAILED',
            summary: null,
            contentText: null,
            error: '再試行待ち',
            retryable: true,
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
    expect(
      screen.getByText('自動再試行中、または現在は再試行できません。'),
    ).toBeInTheDocument();
    const retry = screen.getByRole('button', {
      name: '提案資料.pdf ページ 4を再試行',
    });
    expect(retry).toHaveClass('min-h-11', 'min-w-11');
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
        retryable: true,
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

    await user.click(
      await screen.findByRole('button', {
        name: '提案資料.pdf ページ 2を再試行',
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1][0]).toContain(
      '/api/knowledge-document-pages/page-2/retry',
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('ignores a stale document response after switching documents', async () => {
    const requestA = deferred<Response>();
    const requestB = deferred<Response>();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/doc-b/') ? requestB.promise : requestA.promise,
    );
    const rendered = renderDocument();
    const documentB = { ...document, id: 'doc-b', title: 'B資料.pdf' };

    rendered.rerender(
      <NodeDetailPanel
        selectedNode={null}
        selectedDocument={documentB}
        nodeById={new Map()}
        onSelectNode={vi.fn()}
        onSelectDocument={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    requestB.resolve(
      new Response(
        JSON.stringify([
          {
            id: 'page-b',
            pageNumber: 1,
            pageKind: 'PDF_PAGE',
            status: 'SUCCEEDED',
            summary: 'Bの内容',
            contentText: 'B本文',
            error: null,
            retryable: false,
          },
        ]),
        { status: 200 },
      ),
    );
    expect(await screen.findByText('B本文')).toBeInTheDocument();

    requestA.resolve(
      new Response(
        JSON.stringify([
          {
            id: 'page-a',
            pageNumber: 9,
            pageKind: 'PDF_PAGE',
            status: 'SUCCEEDED',
            summary: 'Aの内容',
            contentText: 'A本文',
            error: null,
            retryable: false,
          },
        ]),
        { status: 200 },
      ),
    );
    await waitFor(() => expect(screen.queryByText('A本文')).not.toBeInTheDocument());
    expect(screen.getByText('B本文')).toBeInTheDocument();
  });

  it('does not reload document A when its retry resolves after switching to B', async () => {
    const retryA = deferred<Response>();
    let pageALoads = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input, init) => {
        const url = String(input);
        if (init?.method === 'POST') return retryA.promise;
        if (url.includes('/doc-b/')) {
          return new Response(
            JSON.stringify([
              {
                id: 'page-b',
                pageNumber: 1,
                pageKind: 'PDF_PAGE',
                status: 'SUCCEEDED',
                summary: null,
                contentText: 'B本文',
                error: null,
                retryable: false,
              },
            ]),
            { status: 200 },
          );
        }
        pageALoads += 1;
        return new Response(
          JSON.stringify([
            {
              id: 'page-a',
              pageNumber: 2,
              pageKind: 'PDF_PAGE',
              status: 'FAILED',
              summary: null,
              contentText: null,
              error: '失敗',
              retryable: true,
            },
          ]),
          { status: 200 },
        );
      },
    );
    const user = userEvent.setup();
    const rendered = renderDocument();
    await user.click(
      await screen.findByRole('button', {
        name: '提案資料.pdf ページ 2を再試行',
      }),
    );

    rendered.rerender(
      <NodeDetailPanel
        selectedNode={null}
        selectedDocument={{ ...document, id: 'doc-b', title: 'B資料.pdf' }}
        nodeById={new Map()}
        onSelectNode={vi.fn()}
        onSelectDocument={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('B本文')).toBeInTheDocument();
    retryA.resolve(
      new Response(JSON.stringify({ id: 'child-a', status: 'QUEUED' }), {
        status: 202,
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(pageALoads).toBe(1);
    expect(screen.getByText('B本文')).toBeInTheDocument();
    expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument();
  });
});
