/**
 * オブジェクト関係性マップ 共有リンクのOGP画像（URL貼付時のプレビュー）。
 */
import {
  OG_SIZE,
  fetchForOg,
  renderShareOgImage,
  renderShareOgFallback,
  type OgBox,
  type OgEdgeLine,
} from '@/lib/share-og';

export const runtime = 'nodejs';
export const size = OG_SIZE;
export const contentType = 'image/png';

interface SharedObjectMapLite {
  objects: {
    id: string;
    name: string;
    color: string | null;
    positionX: number;
    positionY: number;
  }[];
  relations: { sourceObjectId: string; targetObjectId: string }[];
  projectName: string | null;
}

// object-map-shared.ts の CARD_W/CARD_H と一致させる
const CARD_W = 200;
const CARD_H = 92;

export default async function Image({ params }: { params: { token: string } }) {
  const data = await fetchForOg<SharedObjectMapLite>(
    `/api/shared/object-map/${params.token}`,
  );
  if (!data) return renderShareOgFallback('オブジェクト関係性マップ');

  const boxes: OgBox[] = data.objects.map((o) => ({
    x: o.positionX,
    y: o.positionY,
    w: CARD_W,
    h: CARD_H,
    color: o.color || '#6366f1',
    label: o.name,
  }));
  const byId = new Map(data.objects.map((o) => [o.id, o]));
  const edges: OgEdgeLine[] = data.relations
    .map((r) => {
      const s = byId.get(r.sourceObjectId);
      const t = byId.get(r.targetObjectId);
      if (!s || !t) return null;
      return {
        x1: s.positionX + CARD_W / 2,
        y1: s.positionY + CARD_H / 2,
        x2: t.positionX + CARD_W / 2,
        y2: t.positionY + CARD_H / 2,
      };
    })
    .filter((e): e is OgEdgeLine => e !== null);

  return renderShareOgImage({
    title: 'オブジェクト関係性マップ',
    subtitle: data.projectName,
    badge: 'オブジェクトマップ',
    boxes,
    edges,
  });
}
