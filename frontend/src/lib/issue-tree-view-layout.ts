// イシューツリー閲覧用の左→右ツリーレイアウト（純関数）。
// 共有閲覧ページ（/share/issue-tree）と OGP画像生成の両方から使う。

export interface TreeLayoutNode {
  id: string;
  parentId: string | null;
  order: number;
}

export interface PlacedNode<T extends TreeLayoutNode> {
  node: T | null; // null = 仮想ルート
  x: number;
  y: number;
}

export const TREE_NODE_W = 240;
export const TREE_NODE_H = 76;
export const TREE_COL_W = 300;
export const TREE_ROW_H = 96;
export const TREE_ROOT_ID = '__root__';

/**
 * 左→右のツリーレイアウト。
 * 葉を上から順に等間隔で置き、内部ノードは子のy中央に置く定番の方式。
 */
export function layoutTree<T extends TreeLayoutNode>(
  nodes: T[],
): {
  placed: PlacedNode<T>[];
  edges: Array<{ from: PlacedNode<T>; to: PlacedNode<T> }>;
  width: number;
  height: number;
} {
  const childrenOf = new Map<string, T[]>();
  for (const n of nodes) {
    const key = n.parentId ?? TREE_ROOT_ID;
    const arr = childrenOf.get(key) ?? [];
    arr.push(n);
    childrenOf.set(key, arr);
  }
  for (const arr of Array.from(childrenOf.values())) {
    arr.sort((a, b) => a.order - b.order);
  }

  const placedById = new Map<string, PlacedNode<T>>();
  let nextLeafSlot = 0;

  const walk = (id: string, depth: number, node: T | null): number => {
    const children = childrenOf.get(id) ?? [];
    let y: number;
    if (children.length === 0) {
      y = nextLeafSlot * TREE_ROW_H;
      nextLeafSlot += 1;
    } else {
      const ys = children.map((c) => walk(c.id, depth + 1, c));
      y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    placedById.set(id, { node, x: depth * TREE_COL_W, y });
    return y;
  };
  walk(TREE_ROOT_ID, 0, null);

  const placed = Array.from(placedById.values());
  const edges: Array<{ from: PlacedNode<T>; to: PlacedNode<T> }> = [];
  for (const n of nodes) {
    const from = placedById.get(n.parentId ?? TREE_ROOT_ID);
    const to = placedById.get(n.id);
    if (from && to) edges.push({ from, to });
  }

  const maxX = Math.max(...placed.map((p) => p.x), 0);
  const maxY = Math.max(...placed.map((p) => p.y), 0);
  return { placed, edges, width: maxX + TREE_NODE_W, height: maxY + TREE_NODE_H };
}
