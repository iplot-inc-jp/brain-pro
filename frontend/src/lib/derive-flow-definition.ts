/**
 * 業務フロー（フローズ）の図構造から業務記述書（FlowDefinition）の各項目を導出する純関数。
 *
 * 「手順（DO）」や「トリガー」「担当」「使用システム」などをノード/ロール/情報リンクから
 * 自動生成し、フロー図と業務定義を相互に反映させるための土台。
 * 副作用なし・React 非依存なのでユニットテスト可能。
 */
import type {
  FlowDataNode,
  FlowDataEdge,
  Role,
} from '@/components/flow-editor/flow-types';

/** フロー図から導出できる業務記述書フィールドのサブセット。 */
export interface DerivedDefinition {
  /** DO（手順を番号順に）: START/END を除く処理ノードを order 昇順に並べたもの。 */
  doSteps: string[];
  /** トリガー（いつ始まるか）: START ノードのラベル。 */
  trigger: string | null;
  /** 担当（主担当）: 処理ノードで最頻の人間ロール。 */
  owner: string | null;
  /** 使用システム: SYSTEM ロール名 + システム連携ノード。 */
  system: string | null;
  /** INPUT: ノードの情報リンク（INPUT 方向）。複数は「、」連結。 */
  input: string | null;
  /** OUTPUT: ノードの情報リンク（OUTPUT 方向）。複数は「、」連結。 */
  output: string | null;
  /** 次工程（渡し先）: OUTPUT 方向のクロスフローリンクの渡し先フロー名。 */
  nextProcess: string | null;
}

const norm = (s: string | null | undefined): string => (s ?? '').trim();
const upper = (s: string | null | undefined): string => norm(s).toUpperCase();

/** 担当（ロール名）をノードの roleId から付与した手順ラベルを作る。 */
function stepLabel(node: FlowDataNode, roleById: Map<string, Role>): string {
  const label = norm(node.label);
  const role = node.roleId ? roleById.get(node.roleId) : undefined;
  const roleName = role ? norm(role.name) : '';
  return roleName ? `【${roleName}】${label}` : label;
}

/**
 * フローのノード/エッジ/ロールから業務記述書フィールドを導出する。
 * @param nodes フローのノード（informationLinks / links を含む完全形が望ましい）
 * @param edges フローのエッジ（現状は導出に未使用だが将来の経路解析用に受ける）
 * @param roles プロジェクトのロール一覧（レーン＝担当の解決に使う）
 */
export function deriveDefinitionFromFlow(
  nodes: FlowDataNode[],
  _edges: FlowDataEdge[],
  roles: Role[],
): DerivedDefinition {
  const roleById = new Map<string, Role>(roles.map((r) => [r.id, r]));
  const sorted = [...nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const isStart = (n: FlowDataNode) => upper(n.type) === 'START';
  const isEnd = (n: FlowDataNode) => upper(n.type) === 'END';

  // 手順: START/END を除く、ラベルのある処理ノードを order 順に。
  const stepNodes = sorted.filter((n) => !isStart(n) && !isEnd(n) && norm(n.label));
  const doSteps = stepNodes.map((n) => stepLabel(n, roleById));

  // トリガー: START ノードのラベル（複数あれば「 / 」連結）。
  const startLabels = sorted.filter(isStart).map((n) => norm(n.label)).filter(Boolean);
  const trigger = startLabels.length ? startLabels.join(' / ') : null;

  // 担当: 処理ノードで最頻の人間ロール（type!=='SYSTEM'）。
  const humanRoleCount = new Map<string, number>();
  for (const n of stepNodes) {
    const role = n.roleId ? roleById.get(n.roleId) : undefined;
    if (!role) continue;
    if (upper(role.type) === 'SYSTEM') continue;
    humanRoleCount.set(role.name, (humanRoleCount.get(role.name) ?? 0) + 1);
  }
  const owner =
    Array.from(humanRoleCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // 使用システム: SYSTEM ロール名 + システム連携ノードのラベル。
  const systemNames = new Set<string>();
  for (const r of roles) if (upper(r.type) === 'SYSTEM' && norm(r.name)) systemNames.add(norm(r.name));
  for (const n of nodes) {
    if (upper(n.type) === 'SYSTEM_INTEGRATION' && norm(n.label)) systemNames.add(norm(n.label));
  }
  const system = systemNames.size ? Array.from(systemNames).join('、') : null;

  // INPUT / OUTPUT: ノードの情報リンクを方向別に集計（情報種別マスタ名）。
  const inputSet = new Set<string>();
  const outputSet = new Set<string>();
  for (const n of nodes) {
    for (const link of n.informationLinks ?? []) {
      const name = norm(link.informationType?.name);
      if (!name) continue;
      if (link.direction === 'INPUT') inputSet.add(name);
      else if (link.direction === 'OUTPUT') outputSet.add(name);
    }
  }
  const input = inputSet.size ? Array.from(inputSet).join('、') : null;
  const output = outputSet.size ? Array.from(outputSet).join('、') : null;

  // 次工程: OUTPUT 方向のクロスフローリンクの渡し先フロー名。
  const nextSet = new Set<string>();
  for (const n of nodes) {
    for (const link of n.links ?? []) {
      if (link.direction === 'OUTPUT' && norm(link.targetFlowName)) {
        nextSet.add(norm(link.targetFlowName));
      }
    }
  }
  const nextProcess = nextSet.size ? Array.from(nextSet).join('、') : null;

  return { doSteps, trigger, owner, system, input, output, nextProcess };
}

/** 導出結果に1つでも中身があるか（取り込みボタンの活性判定に使う）。 */
export function hasDerivableContent(d: DerivedDefinition): boolean {
  return Boolean(
    d.doSteps.length ||
      d.trigger ||
      d.owner ||
      d.system ||
      d.input ||
      d.output ||
      d.nextProcess,
  );
}
