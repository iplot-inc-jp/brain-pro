const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export interface FlowDefinition {
  flowId: string;
  purpose: string | null;
  owner: string | null;
  stakeholders: string | null;
  input: string | null;
  inputDetail: string | null;
  trigger: string | null;
  doSteps: string[];
  output: string | null;
  nextProcess: string | null;
  exceptionHandling: string | null;
  frequency: string | null;
  system: string | null;
  tacitNotes: string | null;
}

export interface FlowDefinitionRow {
  flowId: string;
  flowName: string;
  kind: 'ASIS' | 'TOBE';
  parentId: string | null;
  depth: number;
  definition: FlowDefinition;
  // ノードの情報リンク（NodeInformationLink→InformationType）から集計した INPUT/OUTPUT（これが正）
  inputItems: string[];
  outputItems: string[];
  // フローに紐づく添付ファイル件数（一覧のバッジ表示用。古いAPIレスポンスでは未定義）
  attachmentCount?: number;
}

export const EMPTY_DEFINITION: Omit<FlowDefinition, 'flowId'> = {
  purpose: null, owner: null, stakeholders: null, input: null, inputDetail: null,
  trigger: null, doSteps: [], output: null, nextProcess: null, exceptionHandling: null,
  frequency: null, system: null, tacitNotes: null,
};

/** ①一覧の DO 列用に手順を要約する */
export function summarizeDoSteps(steps: string[]): string {
  if (!steps || steps.length === 0) return '';
  if (steps.length === 1) return steps[0];
  return `${steps[0]} ほか${steps.length - 1}件 (全${steps.length}手順)`;
}

/** ①一覧の1行（表示列）を定義から作る */
export function definitionToRow(def: FlowDefinition) {
  return {
    purpose: def.purpose ?? '',
    owner: def.owner ?? '',
    input: def.input ?? '',
    doSummary: summarizeDoSteps(def.doSteps ?? []),
    output: def.output ?? '',
    frequency: def.frequency ?? '',
    system: def.system ?? '',
  };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export const flowDefinitionApi = {
  async get(flowId: string): Promise<FlowDefinition> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/definition`, { headers: headers() });
    if (!res.ok) throw new Error('業務定義の取得に失敗しました');
    return res.json();
  },
  async upsert(flowId: string, patch: Partial<FlowDefinition>): Promise<FlowDefinition> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/definition`, {
      method: 'PUT', headers: headers(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('業務定義の保存に失敗しました');
    return res.json();
  },
  async listByProject(projectId: string): Promise<FlowDefinitionRow[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/flow-definitions`, { headers: headers() });
    if (!res.ok) throw new Error('業務定義一覧の取得に失敗しました');
    return res.json();
  },
};
