'use client';

/**
 * 業務フロー図の共有閲覧ページ。
 *
 * 共有トークン付きURL（/share/flow/:token）で業務フロー図を読み取り専用表示する。
 * 画像出力と違いブラウザのベクタ描画なので、拡大しても画質が劣化しない。
 *
 * - データは GET /api/business-flows/shared/:token（@Public）。
 *   scope=ORG のリンクはログイン済みトークンをサーバが検証する
 *   （fetchSharedView が Authorization を自動付与し、401→ログイン誘導）。
 * - 描画は SwimlaneCanvas を embedded（閲覧用）で流用。編集系コールバックは渡さない。
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { SwimlaneCanvas } from '@/components/flow-editor/SwimlaneCanvas';
import type { FlowData, Role, FlowAnnotation } from '@/components/flow-editor/flow-types';
import { SharedViewShell } from '@/components/share/SharedViewShell';
import { fetchSharedView, SharedViewError } from '@/lib/share-view';

interface SharedFlowResponse {
  flow: FlowData;
  roles: Role[];
  annotations: FlowAnnotation[];
  projectName: string | null;
}

export default function SharedFlowPage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<SharedFlowResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SharedViewError | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const body = await fetchSharedView<SharedFlowResponse>(
          `/api/business-flows/shared/${token}`,
        );
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof SharedViewError
              ? err
              : new SharedViewError('error', '読み込みに失敗しました'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <SharedViewShell
      title={data?.flow.name ?? '業務フロー'}
      subtitle={data?.projectName}
      loading={loading}
      error={error}
    >
      {data && (
        <SwimlaneCanvas
          flowData={data.flow}
          roles={data.roles}
          annotations={data.annotations}
          embedded
        />
      )}
    </SharedViewShell>
  );
}
