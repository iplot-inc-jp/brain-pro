'use client';

/**
 * オブジェクト関係性マップの共有閲覧ページ（/share/object-map/:token）。
 *
 * - データは GET /api/shared/object-map/:token（@Public。scope=ORG はサーバが検証）。
 * - 描画は ObjectMapCanvas を readOnly で流用（編集系コールバックは全て no-op）。
 *   ズーム/パン/囲み表示はそのまま使える。
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ObjectMapCanvas } from '@/app/(dashboard)/dashboard/projects/[projectId]/object-map/_components/ObjectMapCanvas';
import type {
  DataObjectDto,
  ObjectRelationDto,
  DataObjectAnnotationDto,
} from '@/lib/data-objects';
import type { SubProjectMaster } from '@/lib/masters';
import { SharedViewShell } from '@/components/share/SharedViewShell';
import { fetchSharedView, SharedViewError } from '@/lib/share-view';

interface SharedObjectMapResponse {
  objects: DataObjectDto[];
  relations: ObjectRelationDto[];
  annotations: DataObjectAnnotationDto[];
  subProjects: SubProjectMaster[];
  projectName: string | null;
}

const noop = () => {};

export default function SharedObjectMapPage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<SharedObjectMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SharedViewError | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const body = await fetchSharedView<SharedObjectMapResponse>(
          `/api/shared/object-map/${token}`,
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
      title="オブジェクト関係性マップ"
      subtitle={data?.projectName}
      loading={loading}
      error={error}
    >
      {data && (
        <div className="h-full w-full">
          <ObjectMapCanvas
            objects={data.objects}
            relations={data.relations}
            annotations={data.annotations}
            subProjects={data.subProjects}
            selectedObjectId={null}
            onSelectObject={noop}
            onObjectMoved={noop}
            onCreateRelation={noop}
            onUpdateRelation={noop}
            onDeleteRelation={noop}
            onAddObject={noop}
            onImportFromDfd={noop}
            importing={false}
            onAddAnnotation={noop}
            onAnnotationMoved={noop}
            onUpdateAnnotationText={noop}
            onDeleteAnnotation={noop}
            onAddScope={noop}
            onScopeGeometryChanged={noop}
            onUpdateScope={noop}
            onDeleteScope={noop}
            onImportMermaid={() => Promise.resolve()}
            readOnly
          />
        </div>
      )}
    </SharedViewShell>
  );
}
