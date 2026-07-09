/**
 * イシューツリー 共有リンクのOGP画像（URL貼付時のプレビュー）。
 * 閲覧ページと同じ layoutTree（純関数）で左→右ツリーを組む。
 */
import {
  OG_SIZE,
  fetchForOg,
  renderShareOgImage,
  renderShareOgFallback,
  type OgBox,
  type OgEdgeLine,
} from '@/lib/share-og';
import {
  layoutTree,
  TREE_NODE_W,
  TREE_NODE_H,
} from '@/lib/issue-tree-view-layout';

export const runtime = 'nodejs';
export const size = OG_SIZE;
export const contentType = 'image/png';

interface SharedIssueTreeLite {
  name: string;
  rootQuestion: string | null;
  nodes: {
    id: string;
    parentId: string | null;
    order: number;
    label: string;
    kind: string;
  }[];
  projectName: string | null;
}

/** 種別 → アクセント色（KIND_CONFIG の bar 色を hex 化） */
const KIND_COLORS: Record<string, string> = {
  ISSUE: '#334155',
  POINT: '#475569',
  HYPOTHESIS: '#9333ea',
  VERIFICATION: '#0891b2',
  RESULT: '#0e7490',
  CAUSE: '#ea580c',
  OPTION: '#d97706',
  ACTION: '#16a34a',
  ELEMENT: '#2563eb',
  METRIC: '#7c3aed',
};

export default async function Image({ params }: { params: { token: string } }) {
  const data = await fetchForOg<SharedIssueTreeLite>(
    `/api/shared/issue-tree/${params.token}`,
  );
  if (!data) return renderShareOgFallback('イシューツリー');

  const layout = layoutTree(data.nodes);
  const boxes: OgBox[] = layout.placed.map((p) => ({
    x: p.x,
    y: p.y,
    w: TREE_NODE_W,
    h: TREE_NODE_H,
    color: p.node ? (KIND_COLORS[p.node.kind] ?? '#64748b') : '#6366f1',
    label: p.node ? p.node.label : (data.rootQuestion || data.name),
  }));
  const edges: OgEdgeLine[] = layout.edges.map((e) => ({
    x1: e.from.x + TREE_NODE_W,
    y1: e.from.y + TREE_NODE_H / 2,
    x2: e.to.x,
    y2: e.to.y + TREE_NODE_H / 2,
  }));

  return renderShareOgImage({
    title: data.name || 'イシューツリー',
    subtitle: data.projectName,
    badge: 'イシューツリー',
    boxes,
    edges,
  });
}
