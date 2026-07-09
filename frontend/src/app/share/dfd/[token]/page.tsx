'use client';

/**
 * DFD（データフロー図）の共有閲覧ページ（/share/dfd/:token）。
 *
 * - データは GET /api/shared/dfd/:token（@Public。scope=ORG はサーバが検証）。
 * - 描画は DfdCanvas を編集系コールバックなしで流用（追加/注釈ボタンは
 *   コールバック未指定で非表示・編集は不可。PNG出力/全画面/ズームは可）。
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DfdCanvas } from '@/components/dfd/DfdCanvas';
import type { DfdDiagram, DfdAnnotation, InformationType } from '@/lib/dfd';
import type { DataObjectDto } from '@/lib/data-objects';
import { SharedViewShell } from '@/components/share/SharedViewShell';
import { fetchSharedView, SharedViewError } from '@/lib/share-view';

interface SharedDfdResponse {
  diagram: DfdDiagram;
  annotations: DfdAnnotation[];
  informationTypes: InformationType[];
  dataObjects: DataObjectDto[];
  projectName: string | null;
}

export default function SharedDfdPage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<SharedDfdResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SharedViewError | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const body = await fetchSharedView<SharedDfdResponse>(
          `/api/shared/dfd/${token}`,
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
      title={data?.diagram.title ?? 'DFD（データフロー図）'}
      subtitle={data?.projectName}
      loading={loading}
      error={error}
    >
      {data && (
        <div className="h-full w-full">
          <DfdCanvas
            diagram={data.diagram}
            annotations={data.annotations}
            informationTypes={data.informationTypes}
            dataObjects={data.dataObjects}
          />
        </div>
      )}
    </SharedViewShell>
  );
}
