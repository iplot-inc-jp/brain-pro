const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export type DfdNodeKind = 'FUNCTION' | 'EXTERNAL_ENTITY' | 'DATA_STORE';
export interface DfdNode {
  id: string; kind: DfdNodeKind; label: string; number: string | null;
  refFlowId?: string | null; refNodeId?: string | null;
  /** DATA_STORE のデータオブジェクトマスタ紐づけ（未紐づけなら null）。 */
  dataObjectId?: string | null;
  positionX: number; positionY: number;
}
export interface DfdFlow {
  id: string; sourceNodeId: string; targetNodeId: string;
  dataItem: string; informationTypeId: string | null; order: number;
  /** 接続側（辺）。'top'|'right'|'bottom'|'left'。未保存なら null。 */
  sourceHandle?: string | null; targetHandle?: string | null;
  /** 線の形状。'smoothstep'|'bezier'|'straight'。未保存なら null（既定は smoothstep）。 */
  pathStyle?: string | null;
  /** データ項目ラベルのパス上位置（0〜1）。未保存なら null（既定は 0.5）。 */
  labelT?: number | null;
  /** 情報チップのパス上位置（0〜1）。未保存なら null（既定は 0.5）。 */
  infoT?: number | null;
}
export interface DfdDiagram {
  id: string; projectId: string; flowId: string | null;
  title: string | null; docId: string | null; authorName: string | null; approverName: string | null;
  updatedAt: string; nodes: DfdNode[]; flows: DfdFlow[];
  /** kind=DATA_STORE かつ dataObjectId=null のノード数（オブジェクト統合バナー用）。 */
  unlinkedDataStoreCount: number;
}

/**
 * DFDに貼る注釈（付箋・コメント）。フロー図の FlowAnnotation と同形。
 * GET/POST /dfd-diagrams/:diagramId/annotations・PATCH/DELETE /dfd-annotations/:id に対応。
 */
export type DfdAnnotationKind = 'STICKY' | 'COMMENT' | 'ICON' | 'SCOPE';
export interface DfdAnnotation {
  id: string;
  /**
   * STICKY=付箋（黄色）, COMMENT=コメント（白＋吹き出し風）, ICON=アイコン注釈（透明背景）,
   * SCOPE=スコープ囲み（領域を点線/背景色つき矩形で囲う）。
   */
  kind: DfdAnnotationKind;
  text: string;
  positionX: number;
  positionY: number;
  /** 描画幅（手動リサイズの永続化）。未設定なら既定サイズ。 */
  width?: number | null;
  /** 描画高さ（手動リサイズの永続化）。未設定なら既定サイズ。 */
  height?: number | null;
  color?: string | null;
  /** kind==='ICON' のとき表示する lucide アイコン名。 */
  icon?: string | null;
  /** kind==='SCOPE' のときの枠線スタイル（'dashed' | 'solid'）。未設定は dashed 扱い。 */
  borderStyle?: 'dashed' | 'solid' | null;
  /** kind==='SCOPE' のときの背景塗りの不透明度（0〜1）。未設定は薄め既定。 */
  fillOpacity?: number | null;
  order: number;
}

/** FUNCTIONノードに levelPrefix-連番 を採番（既存numberは保持） */
export function assignFunctionNumbers(nodes: DfdNode[], levelPrefix: number): DfdNode[] {
  let seq = 0;
  return nodes.map((n) => {
    if (n.kind !== 'FUNCTION') return n;
    seq += 1;
    return { ...n, number: n.number ?? `${levelPrefix}-${seq}` };
  });
}

export interface DataFlowRow {
  no: number; source: string; dataItem: string; target: string;
  direction: 'IN' | 'OUT'; relatedFunction: string; informationTypeId: string | null;
}
/** データフロー一覧表の行を作る。方向: 宛先がFUNCTIONならIN、源泉がFUNCTIONならOUT。関連処理=FUNCTION側ラベル */
export function buildDataFlowRows(nodes: DfdNode[], flows: DfdFlow[]): DataFlowRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  return flows
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((f, i) => {
      const s = byId.get(f.sourceNodeId);
      const t = byId.get(f.targetNodeId);
      const targetIsFn = t?.kind === 'FUNCTION';
      const fn = targetIsFn ? t : s?.kind === 'FUNCTION' ? s : t;
      return {
        no: i + 1,
        source: s?.label ?? '?',
        dataItem: f.dataItem,
        target: t?.label ?? '?',
        direction: (targetIsFn ? 'IN' : 'OUT') as 'IN' | 'OUT',
        relatedFunction: fn?.label ?? '',
        informationTypeId: f.informationTypeId,
      };
    });
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}
/** multipart 用: Content-Type はブラウザに boundary 付きで設定させるため付けない */
function authHeader(): Record<string, string> {
  const h: Record<string, string> = {};
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}
export const dfdApi = {
  async getByFlow(flowId: string): Promise<DfdDiagram> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/dfd`, { headers: headers() });
    if (!res.ok) throw new Error('DFD取得に失敗しました');
    return res.json();
  },
  async generateByFlow(flowId: string): Promise<DfdDiagram> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/dfd`, { method: 'POST', headers: headers() });
    if (!res.ok) throw new Error('DFD生成に失敗しました');
    return res.json();
  },
  async getByProject(projectId: string): Promise<DfdDiagram> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/dfd`, { headers: headers() });
    if (!res.ok) throw new Error('DFD取得に失敗しました');
    return res.json();
  },
  async generateByProject(projectId: string): Promise<DfdDiagram> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/dfd`, { method: 'POST', headers: headers() });
    if (!res.ok) throw new Error('DFD生成に失敗しました');
    return res.json();
  },
  async addNode(diagramId: string, body: Partial<DfdNode> & { kind: DfdNodeKind; label: string }): Promise<DfdNode> {
    const res = await fetch(`${API_URL}/api/dfd-diagrams/${diagramId}/nodes`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('ノード追加に失敗しました');
    return res.json();
  },
  async updateNode(id: string, patch: Partial<DfdNode>): Promise<DfdNode> {
    const res = await fetch(`${API_URL}/api/dfd-nodes/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('ノード更新に失敗しました');
    return res.json();
  },
  async deleteNode(id: string): Promise<void> { await fetch(`${API_URL}/api/dfd-nodes/${id}`, { method: 'DELETE', headers: headers() }); },
  async addFlow(
    diagramId: string,
    body: {
      sourceNodeId: string;
      targetNodeId: string;
      dataItem: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ): Promise<DfdFlow> {
    const res = await fetch(`${API_URL}/api/dfd-diagrams/${diagramId}/flows`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('データフロー追加に失敗しました');
    return res.json();
  },
  /**
   * データフロー更新。dataItem/informationTypeId のラベル系編集に加えて、
   * 端点ドラッグの付け替え（sourceNodeId/targetNodeId/sourceHandle/targetHandle）も送れる。
   * PATCH /api/dfd-flows/:id。
   */
  async updateFlow(
    id: string,
    patch: Partial<DfdFlow> & {
      sourceNodeId?: string;
      targetNodeId?: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ): Promise<DfdFlow> {
    const res = await fetch(`${API_URL}/api/dfd-flows/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('データフロー更新に失敗しました');
    return res.json();
  },
  async deleteFlow(id: string): Promise<void> { await fetch(`${API_URL}/api/dfd-flows/${id}`, { method: 'DELETE', headers: headers() }); },
  async savePositions(diagramId: string, positions: { id: string; positionX: number; positionY: number }[]): Promise<void> {
    await fetch(`${API_URL}/api/dfd-diagrams/${diagramId}/positions`, { method: 'PUT', headers: headers(), body: JSON.stringify({ positions }) });
  },

  // ===== 注釈（付箋・コメント） =====

  /** GET /api/dfd-diagrams/:diagramId/annotations — DFDの注釈一覧 */
  async listAnnotations(diagramId: string): Promise<DfdAnnotation[]> {
    const res = await fetch(`${API_URL}/api/dfd-diagrams/${diagramId}/annotations`, { headers: headers() });
    if (!res.ok) throw new Error('注釈の取得に失敗しました');
    return res.json();
  },
  /** POST /api/dfd-diagrams/:diagramId/annotations — 注釈を作成 */
  async addAnnotation(diagramId: string, body: Partial<Omit<DfdAnnotation, 'id'>>): Promise<DfdAnnotation> {
    const res = await fetch(`${API_URL}/api/dfd-diagrams/${diagramId}/annotations`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('注釈の作成に失敗しました');
    return res.json();
  },
  /** PATCH /api/dfd-annotations/:id — 注釈を部分更新 */
  async updateAnnotation(id: string, patch: Partial<Omit<DfdAnnotation, 'id'>>): Promise<DfdAnnotation> {
    const res = await fetch(`${API_URL}/api/dfd-annotations/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('注釈の更新に失敗しました');
    return res.json();
  },
  /** DELETE /api/dfd-annotations/:id — 注釈を削除 */
  async deleteAnnotation(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/dfd-annotations/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('注釈の削除に失敗しました');
  },
};

// ========== 情報種別（InformationType）+ 具体帳票（Attachment 流用） ==========

/** 情報種別の分類: 情報 / 物体 / 帳票。 */
export type InformationCategory = 'INFORMATION' | 'OBJECT' | 'DOCUMENT';

/** 分類コード → 日本語ラベル（UI 表示用）。 */
export const INFORMATION_CATEGORY_LABELS: Record<InformationCategory, string> = {
  INFORMATION: '情報',
  OBJECT: '物体',
  DOCUMENT: '帳票',
};

/** UIセレクタ用の選択肢（情報/物体/帳票）。 */
export const INFORMATION_CATEGORY_OPTIONS: ReadonlyArray<{ value: InformationCategory; label: string }> = [
  { value: 'INFORMATION', label: '情報' },
  { value: 'OBJECT', label: '物体' },
  { value: 'DOCUMENT', label: '帳票' },
];

export interface InformationType {
  id: string;
  projectId: string;
  /** 所属する領域（サブプロジェクト）ID。未指定なら null。 */
  subProjectId: string | null;
  name: string;
  category: InformationCategory;
  description: string | null;
  order: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface InformationTypeAttachment {
  id: string;
  informationTypeId: string | null;
  kind: 'IMAGE' | 'PDF' | 'FILE';
  filename: string;
  /** 表示名（編集可能。null = filename を表示） */
  displayName: string | null;
  /** フォルダ分け（自由入力のフォルダ名。null = 未分類） */
  folder: string | null;
  mimeType: string;
  url: string;
  size: number;
  order: number;
  createdAt: string;
}

export const informationTypeApi = {
  async list(projectId: string): Promise<InformationType[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/information-types`, { headers: headers() });
    if (!res.ok) throw new Error('情報種別の取得に失敗しました');
    return res.json();
  },
  async create(projectId: string, body: { name: string; category?: InformationCategory; description?: string | null; subProjectId?: string | null; order?: number }): Promise<InformationType> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/information-types`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('情報種別の作成に失敗しました');
    return res.json();
  },
  async update(id: string, patch: { name?: string; category?: InformationCategory; description?: string | null; subProjectId?: string | null; order?: number }): Promise<InformationType> {
    const res = await fetch(`${API_URL}/api/information-types/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('情報種別の更新に失敗しました');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/information-types/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('情報種別の削除に失敗しました');
  },
  async listAttachments(informationTypeId: string): Promise<InformationTypeAttachment[]> {
    const res = await fetch(`${API_URL}/api/information-types/${informationTypeId}/attachments`, { headers: headers() });
    if (!res.ok) throw new Error('具体帳票の取得に失敗しました');
    return res.json();
  },
  async upload(informationTypeId: string, file: File): Promise<InformationTypeAttachment> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_URL}/api/information-types/${informationTypeId}/attachments`, { method: 'POST', headers: authHeader(), body: form });
    if (!res.ok) throw new Error('具体帳票のアップロードに失敗しました');
    return res.json();
  },
  /** POST /api/information-types/:id/attachments/link — Drive等の外部リンク（ファイル/フォルダ）を紐付け */
  async addLink(
    informationTypeId: string,
    body: { url: string; displayName?: string | null; folder?: string | null },
  ): Promise<InformationTypeAttachment> {
    const res = await fetch(`${API_URL}/api/information-types/${informationTypeId}/attachments/link`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      throw new Error(b?.message || 'リンクの追加に失敗しました');
    }
    return res.json();
  },
  /** PUT /api/attachments/:id — 表示名・フォルダ等のメタ情報を更新（空文字はサーバ側で null に正規化） */
  async updateAttachment(
    attachmentId: string,
    patch: { displayName?: string | null; folder?: string | null; caption?: string; pageRange?: string; order?: number },
  ): Promise<InformationTypeAttachment> {
    const res = await fetch(`${API_URL}/api/attachments/${attachmentId}`, { method: 'PUT', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('具体帳票の更新に失敗しました');
    return res.json();
  },
  async deleteAttachment(attachmentId: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/attachments/${attachmentId}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('具体帳票の削除に失敗しました');
  },
  /** 添付ファイルの配信URL（@Public, 認証不要） */
  fileUrl(attachmentId: string): string {
    return `${API_URL}/api/attachments/${attachmentId}/file`;
  },
};

/** 外部リンク添付（Drive等）かどうか。mimeType マーカー、または url が http(s) 直リンク。 */
export function isLinkAttachment(a: {
  mimeType: string;
  url: string;
}): boolean {
  return a.mimeType === 'text/uri-list' || /^https?:\/\//i.test(a.url);
}

/** Google Drive のフォルダリンクかどうか（アイコン出し分け用）。 */
export function isDriveFolderLink(url: string): boolean {
  return /drive\.google\.com\/drive\/folders\//i.test(url);
}

/** 添付を開くhref。外部リンクは url そのもの、アップロードは配信URL。 */
export function attachmentHref(a: InformationTypeAttachment): string {
  return isLinkAttachment(a) ? a.url : informationTypeApi.fileUrl(a.id);
}
