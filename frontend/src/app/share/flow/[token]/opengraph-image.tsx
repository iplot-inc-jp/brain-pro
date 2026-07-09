/**
 * 業務フロー図 共有リンクのOGP画像（URL貼付時のプレビュー）。
 * PUBLICリンクは図の簡易描画、ORG/無効はプレースホルダ（内容を漏らさない）。
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

interface FlowNodeLite {
  id: string;
  type: string;
  label: string;
  positionX: number;
  positionY: number;
  width?: number | null;
  height?: number | null;
  role?: { color?: string } | null;
}

interface SharedFlowLite {
  flow: {
    name: string;
    nodes: FlowNodeLite[];
    edges: { sourceNodeId: string; targetNodeId: string }[];
  };
  projectName: string | null;
}

const DEFAULT_W = 160;
const DEFAULT_H = 60;

export default async function Image({ params }: { params: { token: string } }) {
  const data = await fetchForOg<SharedFlowLite>(
    `/api/business-flows/shared/${params.token}`,
  );
  if (!data) return renderShareOgFallback('業務フロー図');

  const nodes = data.flow.nodes.filter((n) => n.type !== 'lane');
  const boxes: OgBox[] = nodes.map((n) => ({
    x: n.positionX,
    y: n.positionY,
    w: n.width ?? DEFAULT_W,
    h: n.height ?? DEFAULT_H,
    color: n.role?.color || '#64748b',
    label: n.label,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: OgEdgeLine[] = data.flow.edges
    .map((e) => {
      const s = byId.get(e.sourceNodeId);
      const t = byId.get(e.targetNodeId);
      if (!s || !t) return null;
      return {
        x1: s.positionX + (s.width ?? DEFAULT_W) / 2,
        y1: s.positionY + (s.height ?? DEFAULT_H) / 2,
        x2: t.positionX + (t.width ?? DEFAULT_W) / 2,
        y2: t.positionY + (t.height ?? DEFAULT_H) / 2,
      };
    })
    .filter((e): e is OgEdgeLine => e !== null);

  return renderShareOgImage({
    title: data.flow.name || '業務フロー',
    subtitle: data.projectName,
    badge: '業務フロー図',
    boxes,
    edges,
  });
}
