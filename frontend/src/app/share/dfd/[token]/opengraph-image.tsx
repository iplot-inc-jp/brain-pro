/**
 * DFD 共有リンクのOGP画像（URL貼付時のプレビュー）。
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

interface SharedDfdLite {
  diagram: {
    title: string | null;
    nodes: {
      id: string;
      kind: string;
      label: string;
      positionX: number;
      positionY: number;
    }[];
    flows: { sourceNodeId: string; targetNodeId: string }[];
  };
  projectName: string | null;
}

// DfdCanvas の NODE_W/NODE_H と一致させる
const NODE_W = 168;
const NODE_H = 76;

/** ノード種別 → アクセント色（DfdCanvas の配色に合わせる） */
const KIND_COLORS: Record<string, string> = {
  FUNCTION: '#050f3e',
  EXTERNAL_ENTITY: '#475569',
  DATA_STORE: '#10b981',
};

export default async function Image({ params }: { params: { token: string } }) {
  const data = await fetchForOg<SharedDfdLite>(`/api/shared/dfd/${params.token}`);
  if (!data) return renderShareOgFallback('DFD（データフロー図）');

  const boxes: OgBox[] = data.diagram.nodes.map((n) => ({
    x: n.positionX,
    y: n.positionY,
    w: NODE_W,
    h: NODE_H,
    color: KIND_COLORS[n.kind] ?? '#64748b',
    label: n.label,
  }));
  const byId = new Map(data.diagram.nodes.map((n) => [n.id, n]));
  const edges: OgEdgeLine[] = data.diagram.flows
    .map((f) => {
      const s = byId.get(f.sourceNodeId);
      const t = byId.get(f.targetNodeId);
      if (!s || !t) return null;
      return {
        x1: s.positionX + NODE_W / 2,
        y1: s.positionY + NODE_H / 2,
        x2: t.positionX + NODE_W / 2,
        y2: t.positionY + NODE_H / 2,
      };
    })
    .filter((e): e is OgEdgeLine => e !== null);

  return renderShareOgImage({
    title: data.diagram.title || 'DFD（データフロー図）',
    subtitle: data.projectName,
    badge: 'DFD',
    boxes,
    edges,
  });
}
