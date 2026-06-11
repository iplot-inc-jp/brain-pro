/**
 * flow-layout.ts — 業務フロー スイムレーンの決定論的レイアウトエンジン
 *
 * 設計原則:
 *   ノードの「真実」は (ロール = レーン, order = 時系列上の位置) という構造であり、
 *   ピクセル座標ではない。座標はこの純粋関数が構造から一意に算出する。
 *   背景レーン・ヘッダー・ノードは全て computeFlowLayout の返り値という
 *   「単一の座標源」から描かれるため、旧実装の「3つの非同期レンダラーが
 *   別々の座標系でズレる」バグが構造的に発生しない。
 *
 * 時間軸（タイムライン）は各ノードの `order`（昇順）で駆動される。
 * ユーザーがノードを時間軸方向にドラッグして order を変えると並びが追従する
 * （= ORDER ベースのタイムライン）。ロール = レーン。
 *
 * orientation:
 *   - horizontal: レーンは横帯を上→下に積層（ロール毎）。時間は左→右（order が増えると x が増える）。
 *   - vertical:   レーンは縦列を左→右に並置（ロール毎）。時間は上→下（order が増えると y が増える）。
 *
 * React / @xyflow に一切依存しない（単体テスト可能）。
 */

// ===========================================
// 型定義
// ===========================================

export type LayoutNodeType =
  | 'START'
  | 'END'
  | 'PROCESS'
  | 'DECISION'
  | 'SYSTEM_INTEGRATION'
  | 'MANUAL_OPERATION'
  | 'DATA_STORE';

export type FlowOrientation = 'horizontal' | 'vertical';

export interface LayoutInputNode {
  id: string;
  type?: string;
  /** 所属ロール（スイムレーン）。未指定なら「未割当」レーンへ。 */
  roleId?: string | null;
  /** 時系列上の位置。昇順でタイムライン軸が決まる。 */
  order?: number;
  /**
   * このノード個別の描画幅。未指定なら opt.nodeWidth を使う。
   * リサイズされたノードは主軸間隔・クロス軸スロット・PositionedNode.width に反映される。
   */
  width?: number;
  /**
   * このノード個別の描画高さ。未指定なら opt.nodeHeight を使う。
   * リサイズされたノードは主軸間隔・クロス軸スロット・PositionedNode.height に反映される。
   */
  height?: number;
}

export interface LayoutInputEdge {
  id: string;
  source: string;
  target: string;
}

export interface LayoutRole {
  id: string;
  name: string;
  color?: string;
  /** ロールが希望する最小レーン厚（horizontal: 高さ / vertical: 幅）。過密時は自動拡張。 */
  laneHeight?: number;
}

export interface LayoutOptions {
  /** 描画の向き。horizontal=時間が左→右 / vertical=時間が上→下。 */
  orientation: FlowOrientation;
  /** 時間軸 1 ステップ分の長さ（horizontal: 列幅 / vertical: 行高） */
  columnWidth: number;
  /** ノードの描画幅（個別 width を持たないノードのデフォルト） */
  nodeWidth: number;
  /** ノードの描画高さ（個別 height を持たないノードのデフォルト） */
  nodeHeight: number;
  /** 同一セル内でクロス軸方向に積む際のノード間ギャップ */
  verticalGap: number;
  /**
   * 隣接タイムライン列の「ノード端どうしの間」に最低限確保する主軸方向の余白。
   * エッジ中間に表示される「運ぶ情報」チップが隣接ノードに隠れないよう、概ね
   * チップ 1 個分が収まる余白をここで確保する。隣接列の主軸中心間ピッチは
   * max(columnWidth, 前ノード半分 + 後ノード半分 + edgeLabelGap) になる。
   */
  edgeLabelGap: number;
  /** 時間軸先頭マージン（最初のステップ中心までのオフセット） */
  marginX: number;
  /** レーン内のクロス軸方向パディング */
  lanePadding: number;
  /** レーンのデフォルト厚（ロールが laneHeight を持たない場合） */
  defaultLaneHeight: number;
  /**
   * ロール別レーン厚の手動オーバーライド（{ [roleId]: thickness }）。
   * レンダラ（computeLaneBands）の laneHeightOverrides と「同一の意味・同一の値」で
   * 渡すこと。指定があるレーンは「内容に追従した自動厚」と「override」の大きい方を
   * 採用する（max(autoThickness, override)）。これにより 整形 が算出するレーン厚と
   * 背景レーン帯のレンダリングが一致し、整形後にノードがレーン帯の外へはみ出さない。
   */
  laneHeightOverrides: Record<string, number>;
  /** roleId が roles に無い／null のノードを集約する未割当レーンのID */
  unassignedLaneId: string;
  /** 未割当レーンの表示名 */
  unassignedLaneName: string;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  orientation: 'horizontal',
  columnWidth: 210,
  nodeWidth: 156,
  nodeHeight: 52,
  verticalGap: 18,
  edgeLabelGap: 120,
  marginX: 70,
  lanePadding: 22,
  defaultLaneHeight: 120,
  laneHeightOverrides: {},
  unassignedLaneId: '__unassigned__',
  unassignedLaneName: '未割当',
};

export interface PositionedNode {
  id: string;
  /** ノード中心X */
  x: number;
  /** ノード中心Y */
  y: number;
  width: number;
  height: number;
  roleId: string;
  laneIndex: number;
  type: LayoutNodeType;
  /** 入力 order のエコー（タイムライン軸の値） */
  order: number;
}

export interface Lane {
  roleId: string;
  name: string;
  color?: string;
  index: number;
  // --- horizontal レーン（横帯）ジオメトリ ---
  /** 横帯の上端Y（horizontal） */
  top: number;
  /** 横帯の高さ（horizontal） */
  height: number;
  /** 横帯の中心Y（horizontal） */
  centerY: number;
  // --- vertical レーン（縦列）ジオメトリ ---
  /** 縦列の左端X（vertical） */
  left: number;
  /** 縦列の幅（vertical） */
  width: number;
  /** 縦列の中心X（vertical） */
  centerX: number;
}

/** ノードの 4 辺いずれかを指す接続ハンドル側。 */
export type HandleSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * 整形後のノード幾何から導いた「各エッジの最近接サイド接続」。
 * 2 ノードの中心ベクトルから source/target のハンドル辺を一意に決める
 * （向きに依存しない: 実ジオメトリで縦横どちらでも正しい）。
 */
export interface PositionedEdge {
  id: string;
  sourceHandle: HandleSide;
  targetHandle: HandleSide;
}

export interface FlowLayout {
  nodes: PositionedNode[];
  lanes: Lane[];
  /** 整形後の各エッジの最近接サイド接続ハンドル（source/target の辺）。 */
  edges: PositionedEdge[];
  width: number;
  height: number;
  orientation: FlowOrientation;
}

// ===========================================
// エッジDAGの最長経路（補助ユーティリティ）
// ===========================================

/**
 * エッジDAG上の「最長経路」を算出する補助関数。
 *
 * 注意: タイムライン軸はもはやこれでは決まらない（order 駆動になった）。
 * 自己ループ・端点欠落・重複の除去を含む堅牢なグラフ深さ計算として、
 * 補助/外部用途のために残している。循環があっても例外を投げない。
 */
export function computeLayers(
  nodeIds: string[],
  edges: LayoutInputEdge[],
): Map<string, number> {
  const idSet = new Set(nodeIds);
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
    indegree.set(id, 0);
  }

  // 自己ループ・端点欠落・重複を除いた有効エッジ
  const seen = new Set<string>();
  const validEdges: LayoutInputEdge[] = [];
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    if (e.source === e.target) continue;
    const key = `${e.source}->${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    validEdges.push(e);
    adjacency.get(e.source)!.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  for (const id of nodeIds) layer.set(id, 0);

  // Kahn のトポロジカル順で最長経路を緩和
  const remaining = new Map(indegree);
  const queue: string[] = nodeIds.filter((id) => (remaining.get(id) ?? 0) === 0);
  let processed = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    processed++;
    const lu = layer.get(u)!;
    for (const v of adjacency.get(u)!) {
      if (layer.get(v)! < lu + 1) layer.set(v, lu + 1);
      const d = (remaining.get(v) ?? 0) - 1;
      remaining.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  // 循環で未処理のノード: 処理済み前任の最大layer+1、無ければ0
  if (processed < nodeIds.length) {
    const processedSet = new Set<string>();
    for (const id of nodeIds) {
      if ((remaining.get(id) ?? 0) === 0) processedSet.add(id);
    }
    const predsOf = new Map<string, string[]>();
    for (const e of validEdges) {
      if (!predsOf.has(e.target)) predsOf.set(e.target, []);
      predsOf.get(e.target)!.push(e.source);
    }
    for (const id of nodeIds) {
      if (processedSet.has(id)) continue;
      let best = 0;
      for (const p of predsOf.get(id) ?? []) {
        if (processedSet.has(p)) best = Math.max(best, layer.get(p)! + 1);
      }
      layer.set(id, best);
    }
  }

  return layer;
}

// ===========================================
// メイン: スイムレーン座標の算出
// ===========================================

function normalizeType(t?: string): LayoutNodeType {
  switch (t) {
    case 'START':
    case 'END':
    case 'PROCESS':
    case 'DECISION':
    case 'SYSTEM_INTEGRATION':
    case 'MANUAL_OPERATION':
    case 'DATA_STORE':
      return t;
    default:
      return 'PROCESS';
  }
}

/**
 * 各ノード id → タイムライン列インデックス（0始まり整数）への写像を作る。
 *
 * 時間軸は「矢印の前後関係（エッジの依存）」で駆動される: source→target は
 * 「時間が進む（source は target より前の列）」を意味する。列インデックスは
 * エッジ DAG 上の **最長経路（longest-path layering）** で決まる。これにより
 * 線形チェーン A→B→C は 0,1,2 と厳密に増える列を得る。
 *
 * 循環の扱い: DFS でバックエッジ（現在 DFS スタック上にあるノードへ戻るエッジ）を
 * 除外して残りを DAG にする。除外したバックエッジは列計算に使わないので、
 * n1→n2→n1 のような小さな循環も n1=0, n2=1 と時間軸方向に展開され、左端 1 列に
 * 潰れない（screenshot のバグ）。エッジに一切繋がっていないノード（孤立ノード・
 * 自己ループのみ）は layer 0（先頭列）に置かれ、同列のものはクロス軸に積み上がる
 * （従来どおりの「同 order 非連結ノードは同列で積む」挙動）。
 *
 * 決定性: DFS の根/探索順は (order, inputIndex) 昇順で安定化する。order が無い
 * ノードは 0 として扱う。循環があっても例外を投げない。
 */
function buildTimelineIndex(
  inputNodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
): Map<string, number> {
  const idIndex = new Map<string, number>();
  inputNodes.forEach((n, i) => idIndex.set(n.id, i));
  const idSet = new Set(inputNodes.map((n) => n.id));
  const orderOf = (n: LayoutInputNode) =>
    typeof n.order === 'number' && Number.isFinite(n.order) ? n.order : 0;
  const orderById = new Map<string, number>();
  for (const n of inputNodes) orderById.set(n.id, orderOf(n));

  // (order, inputIndex) 昇順の決定的タイブレーク比較。
  const cmp = (a: string, b: string) => {
    const oa = orderById.get(a) ?? 0;
    const ob = orderById.get(b) ?? 0;
    if (oa !== ob) return oa - ob;
    return (idIndex.get(a) ?? 0) - (idIndex.get(b) ?? 0);
  };

  // --- 隣接リスト source→target（自己ループ・端点欠落・重複を除去） ---
  const adjacency = new Map<string, string[]>();
  for (const n of inputNodes) adjacency.set(n.id, []);
  const seenEdge = new Set<string>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    const k = `${e.source}->${e.target}`;
    if (seenEdge.has(k)) continue;
    seenEdge.add(k);
    adjacency.get(e.source)!.push(e.target);
  }
  // 隣接リストは (order, inputIndex) 昇順で安定化する。
  for (const list of Array.from(adjacency.values())) list.sort(cmp);

  // --- DFS で循環を切る: スタック上のノードへ戻るエッジ（バックエッジ）を除外し、
  //     残りを DAG とみなす。探索順は (order, inputIndex) 昇順で決定的。 ---
  const order = [...inputNodes.map((n) => n.id)].sort(cmp);
  const dagAdj = new Map<string, string[]>();
  for (const id of order) dagAdj.set(id, []);
  const state = new Map<string, 0 | 1 | 2>(); // 0=未訪問 1=スタック上 2=完了
  for (const id of order) state.set(id, 0);

  // 再帰だと深いグラフでスタック溢れし得るため明示スタックの反復 DFS。
  for (const root of order) {
    if (state.get(root) !== 0) continue;
    const stack: Array<{ id: string; childIdx: number }> = [
      { id: root, childIdx: 0 },
    ];
    state.set(root, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = adjacency.get(frame.id)!;
      if (frame.childIdx >= children.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const next = children[frame.childIdx++];
      const st = state.get(next);
      if (st === 1) {
        // バックエッジ（循環）: DAG から除外する。
        continue;
      }
      // 前向き/交差エッジは DAG エッジとして採用する。
      dagAdj.get(frame.id)!.push(next);
      if (st === 0) {
        state.set(next, 1);
        stack.push({ id: next, childIdx: 0 });
      }
    }
  }

  // --- DAG 上の最長経路で layer を割り当てる ---
  // layer[v] = DAG 入辺が無ければ 0、あれば max(layer[u]+1)。孤立ノードは 0。
  const dagIndegree = new Map<string, number>();
  for (const id of order) dagIndegree.set(id, 0);
  for (const id of order) {
    for (const v of dagAdj.get(id)!) {
      dagIndegree.set(v, (dagIndegree.get(v) ?? 0) + 1);
    }
  }
  const layer = new Map<string, number>();
  for (const id of order) layer.set(id, 0);

  // Kahn のトポロジカル順（DAG なので必ず全ノードを処理できる）。
  // キューは (order, inputIndex) 昇順を保つよう挿入後にソートはせず、根集合を
  // 事前ソート済み order から拾うことで決定性を担保する。
  const remaining = new Map(dagIndegree);
  const queue: string[] = order.filter((id) => (remaining.get(id) ?? 0) === 0);
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    const lu = layer.get(u)!;
    for (const v of dagAdj.get(u)!) {
      if (layer.get(v)! < lu + 1) layer.set(v, lu + 1);
      const d = (remaining.get(v) ?? 0) - 1;
      remaining.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  return layer;
}

/**
 * 構造（ロール × order）からスイムレーン図の全座標を算出する。
 *
 * - レーン = ロール（roles の並び順）。roleId 不明/未指定のノードは末尾の
 *   「未割当」レーンへ集約する。
 * - タイムライン軸 = 矢印の前後関係（エッジ DAG の最長経路）で決まる列/行インデックス。
 *   source→target は時間が進む向き。order + inputIndex は同一 (layer, lane) セル内の
 *   クロス軸積み上げ順のタイブレークに使う。
 * - 同一 (timeline, ロール) セルに複数ノードがある場合はクロス軸方向に
 *   並べ、必要に応じてそのレーンの厚みを自動拡張する。
 * - lanes / nodes / width / height は全て同一の laneOffsets から導出され、
 *   描画側（背景・ヘッダー・ノード）が常に一致する。
 * - edges = 整形後のノード幾何から導いた各エッジの「最近接サイド接続」。
 *   2 ノード中心ベクトルの主軸（|dx|>=|dy| なら水平）で source/target の辺を決める。
 *
 * horizontal: 時間=x（左→右）, レーン=横帯（上→下に積層, centerY）。
 * vertical:   時間=y（上→下）, レーン=縦列（左→右に並置, centerX）。
 */
export function computeFlowLayout(
  inputNodes: LayoutInputNode[],
  inputEdges: LayoutInputEdge[],
  inputRoles: LayoutRole[],
  options: Partial<LayoutOptions> = {},
): FlowLayout {
  const opt: LayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const orientation: FlowOrientation = opt.orientation;
  const isHorizontal = orientation === 'horizontal';

  // --- レーン（ロール）の順序を確定 ---
  const roleOrder: LayoutRole[] = [...inputRoles];
  const knownRoleIds = new Set(roleOrder.map((r) => r.id));

  // 未割当ノードがあれば末尾に未割当レーンを足す
  const hasUnassigned = inputNodes.some(
    (n) => !n.roleId || !knownRoleIds.has(n.roleId),
  );
  if (hasUnassigned) {
    roleOrder.push({
      id: opt.unassignedLaneId,
      name: opt.unassignedLaneName,
      color: '#94a3b8',
      laneHeight: opt.defaultLaneHeight,
    });
    knownRoleIds.add(opt.unassignedLaneId);
  }

  const laneIndexOf = new Map<string, number>();
  roleOrder.forEach((r, i) => laneIndexOf.set(r.id, i));

  const resolveRoleId = (roleId?: string | null): string =>
    roleId && knownRoleIds.has(roleId) ? roleId : opt.unassignedLaneId;

  // --- タイムライン軸（order 昇順 + エッジによる同 order 連鎖の展開）を算出 ---
  const timelineIndexOf = buildTimelineIndex(inputNodes, inputEdges);

  // 各ノードの実効サイズ（個別 width/height 優先、無ければ opt のデフォルト）。
  const nodeWidthOf = (n: LayoutInputNode): number =>
    typeof n.width === 'number' && n.width > 0 ? n.width : opt.nodeWidth;
  const nodeHeightOf = (n: LayoutInputNode): number =>
    typeof n.height === 'number' && n.height > 0 ? n.height : opt.nodeHeight;
  // クロス軸 / 主軸方向のノード実効サイズ（向きで入れ替わる）。
  const crossSizeOf = (n: LayoutInputNode): number =>
    isHorizontal ? nodeHeightOf(n) : nodeWidthOf(n);
  const mainSizeOf = (n: LayoutInputNode): number =>
    isHorizontal ? nodeWidthOf(n) : nodeHeightOf(n);

  // --- (timeline, レーン) セルへグルーピング ---
  type Cell = LayoutInputNode & {
    timeline: number;
    laneIndex: number;
    orderValue: number;
  };
  const cells = new Map<string, Cell[]>();
  const cellKey = (timeline: number, laneIndex: number) =>
    `${timeline}:${laneIndex}`;

  let maxTimeline = 0;
  inputNodes.forEach((n) => {
    const rid = resolveRoleId(n.roleId);
    const laneIndex = laneIndexOf.get(rid)!;
    const orderValue = n.order ?? 0;
    const timeline = timelineIndexOf.get(n.id) ?? 0;
    maxTimeline = Math.max(maxTimeline, timeline);
    const key = cellKey(timeline, laneIndex);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push({ ...n, timeline, laneIndex, orderValue });
  });

  // 各セルを order 昇順（同値は元順）で安定ソート
  const cellLists: Cell[][] = Array.from(cells.values());
  for (const list of cellLists) {
    const indexed = list.map((c: Cell, i: number) => ({ c, i }));
    indexed.sort((a, b) => {
      const oa = a.c.orderValue;
      const ob = b.c.orderValue;
      return oa !== ob ? oa - ob : a.i - b.i;
    });
    indexed.forEach((entry, i) => {
      list[i] = entry.c;
    });
  }

  // --- 各レーンの実効厚（過密セルに合わせ自動拡張） ---
  // セル内クロス軸スタックの実長（ノード実サイズ + ギャップ）を求めるヘルパ。
  const cellStackCrossLength = (list: Cell[]): number => {
    if (list.length === 0) return 0;
    let sum = 0;
    for (const c of list) sum += crossSizeOf(c);
    return sum + (list.length - 1) * opt.verticalGap;
  };
  const effectiveSizes: number[] = roleOrder.map((_r, laneIndex) => {
    // レーン内の最も厚いセル（個別サイズを考慮した実クロス軸スタック長）に合わせる。
    let maxStack = 0;
    for (let t = 0; t <= maxTimeline; t++) {
      const list = cells.get(cellKey(t, laneIndex));
      if (list) maxStack = Math.max(maxStack, cellStackCrossLength(list));
    }
    const required = maxStack > 0 ? maxStack + opt.lanePadding * 2 : 0;
    const desired = _r.laneHeight ?? opt.defaultLaneHeight;
    const autoThickness = Math.max(desired, required, opt.defaultLaneHeight);
    // 手動オーバーライドがあれば、自動厚と override の大きい方を採用する。
    // computeLaneBands と同一の max() 規約なので、整形が算出するレーン厚が
    // 背景レーン帯（レンダラ）と一致し、整形後のノードが帯からはみ出さない。
    const override = opt.laneHeightOverrides[_r.id];
    if (typeof override === 'number' && override > 0) {
      return Math.max(autoThickness, override);
    }
    return autoThickness;
  });

  // --- レーンオフセット（単一の座標源） ---
  const lanes: Lane[] = [];
  let crossStart = 0;
  roleOrder.forEach((r, i) => {
    const size = effectiveSizes[i];
    const center = crossStart + size / 2;
    lanes.push(
      isHorizontal
        ? {
            roleId: r.id,
            name: r.name,
            color: r.color,
            index: i,
            top: crossStart,
            height: size,
            centerY: center,
            // vertical 用フィールドは埋めるが非アクティブ
            left: 0,
            width: 0,
            centerX: 0,
          }
        : {
            roleId: r.id,
            name: r.name,
            color: r.color,
            index: i,
            // horizontal 用フィールドは埋めるが非アクティブ
            top: 0,
            height: 0,
            centerY: 0,
            left: crossStart,
            width: size,
            centerX: center,
          },
    );
    crossStart += size;
  });
  const crossTotal = crossStart;

  // --- 時間軸方向の列ごとの主軸中心（個別サイズ + 情報チップ余白を考慮） ---
  // 各タイムライン列の「主軸方向の最大ノードサイズ」を集計する。隣接列の中心間
  // ピッチは max(columnWidth, 前列半分 + 後列半分 + edgeLabelGap) とし、エッジ中間の
  // 情報チップ（可変幅）が概ね 1 個収まる余白を確保する。全ノード既定サイズかつ
  // columnWidth が十分なら従来どおり等ピッチ（= columnWidth）になる。
  const columnMainSize: number[] = [];
  for (let t = 0; t <= maxTimeline; t++) {
    let maxMain = 0;
    for (let laneIndex = 0; laneIndex < roleOrder.length; laneIndex++) {
      const list = cells.get(cellKey(t, laneIndex));
      if (!list) continue;
      for (const c of list) maxMain = Math.max(maxMain, mainSizeOf(c));
    }
    // ノードの無い列でもデフォルトサイズ分の幅を確保（ピッチ計算の半分に使う）。
    columnMainSize[t] = maxMain > 0 ? maxMain : (isHorizontal ? opt.nodeWidth : opt.nodeHeight);
  }
  // 列中心を累積。先頭列は「左端（縦なら上端）＝ marginX」になるよう中心を
  // marginX + 先頭列の実サイズ/2 に置く（中心を marginX にすると半分が
  // レーンラベル帯側へはみ出し、先頭ノードがラベルと重なるため）。
  const columnCenter: number[] = [];
  let mainCursor =
    opt.marginX +
    (columnMainSize[0] ?? (isHorizontal ? opt.nodeWidth : opt.nodeHeight)) / 2;
  for (let t = 0; t <= maxTimeline; t++) {
    if (t === 0) {
      columnCenter[0] = mainCursor;
      continue;
    }
    const pitch = Math.max(
      opt.columnWidth,
      columnMainSize[t - 1] / 2 + columnMainSize[t] / 2 + opt.edgeLabelGap,
    );
    mainCursor += pitch;
    columnCenter[t] = mainCursor;
  }

  // 時間軸方向の中心座標（timeline 列/行 → ピクセル）
  const timeCenter = (timeline: number) =>
    columnCenter[timeline] ?? opt.marginX + timeline * opt.columnWidth;

  // --- ノード座標の確定 ---
  const positioned: PositionedNode[] = [];
  for (const [key, list] of Array.from(cells.entries())) {
    const [timelineStr, laneStr] = key.split(':');
    const timeline = Number(timelineStr);
    const laneIndex = Number(laneStr);
    const lane = lanes[laneIndex];

    const along = timeCenter(timeline); // 時間軸方向の中心
    const laneCenter = isHorizontal ? lane.centerY : lane.centerX;

    // セル内の積み上げ全体の長さ（個別クロス軸サイズ + ギャップ）を求め、
    // レーン中心に対してクロス軸センタリング。各ノードの中心は
    // 「前ノードまでの累積長 + 自ノード半分」で決まる（サイズ差で重ならない）。
    const stackSize = cellStackCrossLength(list);
    const stackStart = laneCenter - stackSize / 2; // スタック上端（クロス軸先頭）
    let crossCursor = stackStart;

    list.forEach((c, i) => {
      if (i > 0) crossCursor += opt.verticalGap;
      const half = crossSizeOf(c) / 2;
      const cross = crossCursor + half; // このノードのクロス軸中心
      crossCursor += crossSizeOf(c);
      positioned.push({
        id: c.id,
        x: isHorizontal ? along : cross,
        y: isHorizontal ? cross : along,
        width: nodeWidthOf(c),
        height: nodeHeightOf(c),
        roleId: roleOrder[laneIndex].id,
        laneIndex,
        type: normalizeType(c.type),
        order: c.orderValue,
      });
    });
  }

  // 安定した出力順（入力ノード順）
  const orderIndex = new Map(inputNodes.map((n, i) => [n.id, i] as const));
  positioned.sort((a, b) => orderIndex.get(a.id)! - orderIndex.get(b.id)!);

  // --- 各エッジの最近接サイド接続ハンドルを、確定したノード中心から導く ---
  // 主軸 = |dx| >= |dy| なら水平。水平なら source = dx>0 ? 'right' : 'left'、
  // target はその反対側。垂直なら source = dy>0 ? 'bottom' : 'top'、target は反対側。
  // ジオメトリ実値から決めるので向き（縦横）に依らず正しい。
  const centerById = new Map<string, { x: number; y: number }>();
  for (const p of positioned) centerById.set(p.id, { x: p.x, y: p.y });
  const opposite: Record<HandleSide, HandleSide> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  const seenEdgeOut = new Set<string>();
  const edges: PositionedEdge[] = [];
  for (const e of inputEdges) {
    if (seenEdgeOut.has(e.id)) continue;
    const s = centerById.get(e.source);
    const t = centerById.get(e.target);
    if (!s || !t) continue; // 端点欠落エッジはスキップ
    seenEdgeOut.add(e.id);
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    let sourceHandle: HandleSide;
    if (Math.abs(dx) >= Math.abs(dy)) {
      sourceHandle = dx > 0 ? 'right' : 'left';
    } else {
      sourceHandle = dy > 0 ? 'bottom' : 'top';
    }
    edges.push({
      id: e.id,
      sourceHandle,
      targetHandle: opposite[sourceHandle],
    });
  }

  // 時間軸方向の全長: 最終列中心 + その列の主軸半分 + 末尾マージン。
  // （個別サイズ・チップ余白で広がった可変ピッチを正しく反映する）
  const lastCenter = columnCenter[maxTimeline] ?? opt.marginX;
  const lastHalfMain = (columnMainSize[maxTimeline] ?? (isHorizontal ? opt.nodeWidth : opt.nodeHeight)) / 2;
  const timeExtent = lastCenter + lastHalfMain + opt.marginX;

  return {
    nodes: positioned,
    lanes,
    edges,
    width: isHorizontal ? timeExtent : crossTotal,
    height: isHorizontal ? crossTotal : timeExtent,
    orientation,
  };
}

// ===========================================
// 自由配置レーン帯の算出（computeLaneBands）
// ===========================================
//
// computeFlowLayout が「構造（order）→ 決定的な座標」を吐くのに対し、
// computeLaneBands は「自由に置かれた（保存済み）ノード座標 → そのノード群を
// 包む背景レーン帯」を吐く純粋関数。
//
// レーン = ロール（roles の並び順）。roleId 不明/未指定のノードは末尾の
// 「未割当」レーンへ集約する（computeFlowLayout と同じ規約）。
//
// horizontal: 各レーンは「全幅の横帯」。帯の高さ = そのロールのノード群の
//   縦方向（Y）の広がり + パディング（minLaneHeight 未満なら minLaneHeight）。
//   帯は上→下に積層する（前レーンの下端から次レーンが始まる）。
// vertical:   軸を入れ替える。各レーンは「全高の縦列」。列の幅 = そのロールの
//   ノード群の横方向（X）の広がり + パディング。列は左→右に並置する。
//
// React / @xyflow に一切依存しない（単体テスト可能）。

/** computeLaneBands に渡す、自由配置された 1 ノードの幾何（中心座標 + サイズ）。 */
export interface BandInputNode {
  id: string;
  /** 所属ロール。未指定/不明なら「未割当」レーンへ。 */
  roleId?: string | null;
  /** ノード中心X。 */
  x: number;
  /** ノード中心Y。 */
  y: number;
  width: number;
  height: number;
}

export interface LaneBandsOptions {
  /** レーン帯の最小厚（horizontal: 高さ / vertical: 幅）。 */
  minLaneHeight: number;
  /** ノード群の外周に足すクロス軸パディング（両側）。 */
  lanePadding: number;
  /** 時間軸方向の余白（horizontal: 右側の幅余白 / vertical: 下側の高さ余白）。 */
  contentMargin: number;
  /** roleId が roles に無い／null のノードを集約する未割当レーンのID。 */
  unassignedLaneId: string;
  /** 未割当レーンの表示名。 */
  unassignedLaneName: string;
  /**
   * ロール別レーン厚の手動オーバーライド（{ [roleId]: thickness }）。
   * 指定があるレーンは「自動算出した内容に追従する厚み」と「このオーバーライド値」の
   * 大きい方を採用する（max(autoContentHeight, override)）。これにより手動で広げた
   * レーンが内容に応じて勝手に縮まず、内容がオーバーライド値を超えたら自動拡張される。
   * 指定が無いレーンは従来どおり完全自動サイズ。
   */
  laneHeightOverrides: Record<string, number>;
}

export const DEFAULT_LANE_BANDS_OPTIONS: LaneBandsOptions = {
  minLaneHeight: 110,
  lanePadding: 24,
  contentMargin: 120,
  unassignedLaneId: '__unassigned__',
  unassignedLaneName: '未割当',
  laneHeightOverrides: {},
};

/** computeLaneBands の戻り値（背景レーン帯 + 全体キャンバスサイズ）。 */
export interface LaneBandsResult {
  lanes: Lane[];
  /** 全ノードを包むキャンバス幅。 */
  width: number;
  /** 全ノードを包むキャンバス高さ。 */
  height: number;
  orientation: FlowOrientation;
}

/**
 * 自由配置されたノード座標から、ロールごとの背景レーン帯を算出する純粋関数。
 *
 * - レーンの並びは roles の順。未割当ノードがあれば末尾に未割当レーンを足す。
 * - horizontal: レーン帯は全幅・高さ自動（その行のノードの縦広がりに追従）、上→下に積層。
 * - vertical:   レーン列は全高・幅自動（その列のノードの横広がりに追従）、左→右に並置。
 * - ノードを持たないレーンは minLaneHeight ぶんの厚みで描く。
 */
export function computeLaneBands(
  inputNodes: BandInputNode[],
  inputRoles: LayoutRole[],
  orientation: FlowOrientation,
  options: Partial<LaneBandsOptions> = {},
): LaneBandsResult {
  const opt: LaneBandsOptions = { ...DEFAULT_LANE_BANDS_OPTIONS, ...options };
  const isHorizontal = orientation === 'horizontal';

  // --- レーン（ロール）の順序を確定（computeFlowLayout と同じ規約） ---
  const roleOrder: LayoutRole[] = [...inputRoles];
  const knownRoleIds = new Set(roleOrder.map((r) => r.id));
  const hasUnassigned = inputNodes.some(
    (n) => !n.roleId || !knownRoleIds.has(n.roleId),
  );
  if (hasUnassigned) {
    roleOrder.push({
      id: opt.unassignedLaneId,
      name: opt.unassignedLaneName,
      color: '#94a3b8',
    });
    knownRoleIds.add(opt.unassignedLaneId);
  }

  const resolveRoleId = (roleId?: string | null): string =>
    roleId && knownRoleIds.has(roleId) ? roleId : opt.unassignedLaneId;

  // --- ロール → 所属ノードへグルーピング ---
  const byRole = new Map<string, BandInputNode[]>();
  for (const r of roleOrder) byRole.set(r.id, []);
  for (const n of inputNodes) {
    byRole.get(resolveRoleId(n.roleId))!.push(n);
  }

  // --- コンテンツ全体の時間軸方向の広がり（全レーン共通の帯の長さに使う） ---
  // horizontal: 帯は全幅 → 全ノードの右端の最大値で決める。
  // vertical:   列は全高 → 全ノードの下端の最大値で決める。
  let contentExtent = 0; // 時間軸方向の最大到達点
  for (const n of inputNodes) {
    const along = isHorizontal ? n.x + n.width / 2 : n.y + n.height / 2;
    contentExtent = Math.max(contentExtent, along);
  }
  // 時間軸方向の全長（ノードが無くても最低限の帯長を確保）
  const bandLength = Math.max(
    contentExtent + opt.contentMargin,
    opt.minLaneHeight * 3,
  );

  // --- 各レーンを contiguous（前レーンの下端から連続）に積み、所属ノードを内包 ---
  //
  // 不変条件: 各ノードのクロス軸中心（と半サイズ）は必ず自レーン帯の内側に収まる。
  //
  // レーンはロール順に「前レーンの下端 = 現在のカーソル」から連続配置する
  // （contiguous & ordered, 重ならない）。これは computeFlowLayout のレーン積層
  // 規約と一致する。各レーンの厚みは「所属ノードのクロス座標スパン + 両側パディング」
  // を minLaneHeight まで底上げし、さらに override があれば override まで拡張する
  // （max を採用 = 手動で広げたレーンが内容で勝手に縮まない / 内容超過時のみ自動拡張）。
  //
  // 重要: 帯は laneStart(=cursor) から thickness ぶん下へ伸ばすだけでなく、
  // 「所属ノードが thickness 内に収まらない」場合は laneEnd を naturalEnd まで
  // 必ず延長する。これにより override で前レーンが押し下がっても、後続レーンの
  // ノードが帯の外（上/下）へはみ出すことが構造的に起きない（band ⊇ content を保証）。
  const lanes: Lane[] = [];
  let cursor = 0;
  roleOrder.forEach((r, i) => {
    const members = byRole.get(r.id)!;
    const override = opt.laneHeightOverrides[r.id];
    const hasOverride = typeof override === 'number' && override > 0;

    // レーンは前レーンの下端から連続して始まる（ordered, non-overlapping）。
    const laneStart = cursor;
    let laneEnd: number;

    if (members.length > 0) {
      let minCross = Infinity;
      let maxCross = -Infinity;
      for (const n of members) {
        const half = (isHorizontal ? n.height : n.width) / 2;
        const center = isHorizontal ? n.y : n.x;
        minCross = Math.min(minCross, center - half);
        maxCross = Math.max(maxCross, center + half);
      }
      const naturalEnd = maxCross + opt.lanePadding;
      // 内容スパン（laneStart からノード下端 + パディングまで）と最小厚の大きい方。
      laneEnd = Math.max(laneStart + opt.minLaneHeight, naturalEnd);
      // 手動オーバーライドがあれば自動厚と override の大きい方まで拡張。
      if (hasOverride) {
        const autoThickness = laneEnd - laneStart;
        laneEnd = laneStart + Math.max(autoThickness, override);
      }
      // band ⊇ content の保証: 何があってもノード下端 + パディングまでは必ず覆う。
      // （override 等で厚みが決まった後も、内容がそれを超えるなら帯を延長する）
      laneEnd = Math.max(laneEnd, naturalEnd);
    } else {
      laneEnd = laneStart + (hasOverride ? Math.max(opt.minLaneHeight, override) : opt.minLaneHeight);
    }

    const thickness = laneEnd - laneStart;
    const center = laneStart + thickness / 2;
    lanes.push(
      isHorizontal
        ? {
            roleId: r.id,
            name: r.name,
            color: r.color,
            index: i,
            top: laneStart,
            height: thickness,
            centerY: center,
            left: 0,
            width: 0,
            centerX: 0,
          }
        : {
            roleId: r.id,
            name: r.name,
            color: r.color,
            index: i,
            top: 0,
            height: 0,
            centerY: 0,
            left: laneStart,
            width: thickness,
            centerX: center,
          },
    );
    cursor = laneEnd;
  });
  const crossTotal = cursor;

  return {
    lanes,
    width: isHorizontal ? bandLength : crossTotal,
    height: isHorizontal ? crossTotal : bandLength,
    orientation,
  };
}
