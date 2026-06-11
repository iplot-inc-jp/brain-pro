// ステークホルダーマネジメント（REAL tables）用の型・APIヘルパー。
//
// 旧来の RecordSheet（projectId × templateKey, {rows}）ではなく、
// 専用テーブル Stakeholder / Meeting / Role を直接 CRUD する。
// 既存の他ページと同じく API_URL + /api への raw fetch（localStorage の accessToken）を使う。

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function getHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** ステークホルダー（Stakeholder テーブル） */
export interface Stakeholder {
  id: string;
  projectId: string;
  name: string;
  affiliation: string | null;
  role: string | null;
  interest: string | null;
  concern: string | null;
  influence: string | null;
  support: string | null;
  engagement: string | null;
  reportFrequency: string | null;
  contactMethod: string | null;
  owner: string | null;
  reportLine: string | null;
  asisHearing: string | null;
  tobeSparring: string | null;
  note: string | null;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

/** 作成・更新で送る入力（name 以外は任意） */
export type StakeholderInput = Partial<
  Omit<Stakeholder, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
> & { name: string };

/** 会議体（Meeting テーブル） */
export interface Meeting {
  id: string;
  projectId: string;
  name: string;
  purpose: string | null;
  frequency: string | null;
  dayTime: string | null;
  requiredAttendees: string | null;
  optionalAttendees: string | null;
  agendaTemplate: string | null;
  preMaterials: string | null;
  minutesOwner: string | null;
  decisionMaker: string | null;
  /** 形式（対面 / オンライン / ハイブリッド、自由文字列） */
  format: string | null;
  /** 所要時間（分） */
  durationMinutes: number | null;
  /** 場所 or 会議URL */
  locationUrl: string | null;
  /** 主催/ファシリテーター（Stakeholder の FK） */
  ownerStakeholderId: string | null;
  /** ステータス（ACTIVE=開催中 / SUSPENDED=休止） */
  status: string | null;
  /** この会議のゴール/アウトプット */
  goal: string | null;
  note: string | null;
  order: number;
  stakeholderIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** 作成・更新で送る入力（name 以外は任意） */
export type MeetingInput = Partial<
  Omit<
    Meeting,
    'id' | 'projectId' | 'stakeholderIds' | 'createdAt' | 'updatedAt'
  >
> & { name: string };

/** ロール（Role テーブル）。責務・決裁範囲・KPI を含む。 */
export interface Role {
  id: string;
  projectId: string;
  name: string;
  type: string;
  description: string | null;
  color: string | null;
  order?: number;
  laneHeight?: number;
  responsibility?: string | null;
  decisionScope?: string | null;
  kpi?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** 報告・連絡カレンダー（ReportCalendar テーブル） */
export interface ReportCalendar {
  id: string;
  projectId: string;
  /** 報告対象（誰に）。Stakeholder の FK。 */
  stakeholderId: string | null;
  /** 報告対象のフリーテキスト fallback（stakeholderId が無いとき） */
  reportTo: string | null;
  /** 関連会議。Meeting の FK。 */
  meetingId: string | null;
  reportContent: string | null;
  frequency: string | null;
  dayTime: string | null;
  format: string | null;
  medium: string | null;
  drafter: string | null;
  approver: string | null;
  templateRef: string | null;
  note: string | null;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

/** 作成・更新で送る入力（全項目任意） */
export type ReportCalendarInput = Partial<
  Omit<ReportCalendar, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
>;

/** 関心ごとマトリクス行（InterestMatrixRow テーブル、フェーズ×視点） */
export interface InterestMatrixRow {
  id: string;
  projectId: string;
  /** フェーズ */
  phase: string | null;
  /** 期間目安 */
  duration: string | null;
  /** 主要ミーティング体 */
  mainMeetings: string | null;
  /** 現場（実務担当） */
  fieldStaff: string | null;
  /** 先方プロマネ */
  clientPm: string | null;
  /** 役員（経営層） */
  executive: string | null;
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

/** 作成・更新で送る入力（全項目任意） */
export type InterestMatrixRowInput = Partial<
  Omit<InterestMatrixRow, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
>;

// ---------------------------------------------------------------------------
// Stakeholder API
// ---------------------------------------------------------------------------

export async function listStakeholders(
  projectId: string,
): Promise<Stakeholder[]> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/stakeholders`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('ステークホルダーの読み込みに失敗しました');
  return res.json();
}

export async function createStakeholder(
  projectId: string,
  input: StakeholderInput,
): Promise<Stakeholder> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/stakeholders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('ステークホルダーの作成に失敗しました');
  return res.json();
}

export async function updateStakeholder(
  id: string,
  input: Partial<StakeholderInput>,
): Promise<Stakeholder> {
  const res = await fetch(`${API_URL}/api/stakeholders/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('ステークホルダーの更新に失敗しました');
  return res.json();
}

export async function deleteStakeholder(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/stakeholders/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('ステークホルダーの削除に失敗しました');
}

// ---------------------------------------------------------------------------
// Meeting API
// ---------------------------------------------------------------------------

export async function listMeetings(projectId: string): Promise<Meeting[]> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/meetings`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('会議体の読み込みに失敗しました');
  return res.json();
}

export async function createMeeting(
  projectId: string,
  input: MeetingInput,
): Promise<Meeting> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/meetings`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('会議体の作成に失敗しました');
  return res.json();
}

export async function updateMeeting(
  id: string,
  input: Partial<MeetingInput>,
): Promise<Meeting> {
  const res = await fetch(`${API_URL}/api/meetings/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('会議体の更新に失敗しました');
  return res.json();
}

export async function deleteMeeting(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/meetings/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('会議体の削除に失敗しました');
}

/** 会議体の対象ステークホルダーを置き換える（PUT /meetings/:id/stakeholders）。 */
export async function setMeetingStakeholders(
  id: string,
  stakeholderIds: string[],
): Promise<Meeting> {
  const res = await fetch(`${API_URL}/api/meetings/${id}/stakeholders`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ stakeholderIds }),
  });
  if (!res.ok) throw new Error('対象ステークホルダーの更新に失敗しました');
  return res.json();
}

// ---------------------------------------------------------------------------
// Role API（責務・決裁範囲・KPI の参照／更新のみここで使う）
// ---------------------------------------------------------------------------

export async function listRoles(projectId: string): Promise<Role[]> {
  const res = await fetch(`${API_URL}/api/roles/project/${projectId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('ロールの読み込みに失敗しました');
  return res.json();
}

export async function updateRole(
  id: string,
  input: Partial<
    Pick<Role, 'responsibility' | 'decisionScope' | 'kpi' | 'name' | 'description'>
  >,
): Promise<Role> {
  const res = await fetch(`${API_URL}/api/roles/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('ロールの更新に失敗しました');
  return res.json();
}

// ---------------------------------------------------------------------------
// ReportCalendar API（報告・連絡カレンダー）
// ---------------------------------------------------------------------------

export const reportCalendarsApi = {
  async list(projectId: string): Promise<ReportCalendar[]> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/report-calendars`,
      { headers: getHeaders() },
    );
    if (!res.ok) throw new Error('報告・連絡カレンダーの読み込みに失敗しました');
    return res.json();
  },

  async create(
    projectId: string,
    input: ReportCalendarInput = {},
  ): Promise<ReportCalendar> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/report-calendars`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) throw new Error('報告・連絡カレンダーの作成に失敗しました');
    return res.json();
  },

  async update(
    id: string,
    input: ReportCalendarInput,
  ): Promise<ReportCalendar> {
    const res = await fetch(`${API_URL}/api/report-calendars/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('報告・連絡カレンダーの更新に失敗しました');
    return res.json();
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/report-calendars/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('報告・連絡カレンダーの削除に失敗しました');
  },
};

// ---------------------------------------------------------------------------
// InterestMatrixRow API（関心ごとマトリクス）
// ---------------------------------------------------------------------------

export const interestRowsApi = {
  async list(projectId: string): Promise<InterestMatrixRow[]> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/interest-rows`,
      { headers: getHeaders() },
    );
    if (!res.ok) throw new Error('関心ごとマトリクスの読み込みに失敗しました');
    return res.json();
  },

  async create(
    projectId: string,
    input: InterestMatrixRowInput = {},
  ): Promise<InterestMatrixRow> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/interest-rows`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) throw new Error('関心ごとマトリクスの作成に失敗しました');
    return res.json();
  },

  async update(
    id: string,
    input: InterestMatrixRowInput,
  ): Promise<InterestMatrixRow> {
    const res = await fetch(`${API_URL}/api/interest-rows/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('関心ごとマトリクスの更新に失敗しました');
    return res.json();
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/interest-rows/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('関心ごとマトリクスの削除に失敗しました');
  },
};

// ---------------------------------------------------------------------------
// 影響度 × 支持度 マトリクスの区分定義（純粋・テスト可能）
// ---------------------------------------------------------------------------

export const INFLUENCE_LEVELS = ['高', '中', '低'] as const;
export const SUPPORT_LEVELS = ['支持', '中立', '反対'] as const;
export type Influence = (typeof INFLUENCE_LEVELS)[number];
export type Support = (typeof SUPPORT_LEVELS)[number];

/**
 * セル値から区分語を取り出す。完全一致のみ採用（前後空白は許容）。
 * 区分に一致しない値（未設定・冗長表記等）は '' を返し、未配置として扱う。
 */
export function pickLevel<T extends string>(
  raw: string | null | undefined,
  levels: readonly T[],
): T | '' {
  const t = (raw ?? '').trim();
  return (levels as readonly string[]).includes(t) ? (t as T) : '';
}

/**
 * 影響度×支持度のセルキー（`影響__支持`）ごとにステークホルダーIDを束ねる。
 * いずれかが未区分の場合は未配置として除外する。純粋関数（テスト可能）。
 */
export function buildInfluenceSupportGrid(
  stakeholders: Stakeholder[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const s of stakeholders) {
    const inf = pickLevel(s.influence, INFLUENCE_LEVELS);
    const sup = pickLevel(s.support, SUPPORT_LEVELS);
    if (!inf || !sup) continue;
    const key = `${inf}__${sup}`;
    const arr = map.get(key) ?? [];
    arr.push(s.id);
    map.set(key, arr);
  }
  return map;
}
