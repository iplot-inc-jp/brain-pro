const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// ========== 型 ==========

/** リレーションの多重度（1対1 / 1対多 / 多対多） */
export type RelationCardinality = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_MANY';

/** UIセレクタ用の選択肢 */
export const RELATION_CARDINALITY_OPTIONS: ReadonlyArray<{ value: RelationCardinality; label: string }> = [
  { value: 'ONE_TO_ONE', label: '1対1' },
  { value: 'ONE_TO_MANY', label: '1対多' },
  { value: 'MANY_TO_MANY', label: '多対多' },
];

/** オブジェクトに紐づく実態テーブルの参照 */
export interface ObjectTableRefDto {
  id: string;
  name: string;
  displayName: string | null;
}

/** オブジェクトに紐づくDFDデータストアノードの参照 */
export interface ObjectDfdNodeRefDto {
  id: string;
  label: string;
}

/**
 * データオブジェクト。
 * DFDのデータストア / オブジェクト関係性マップの「オブジェクト」/ ER図の点線囲み
 * を貫く同一マスタ。
 */
export interface DataObjectDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: string | null;
  /** 所属領域（SubProject）ID。null は未分類。 */
  subProjectId: string | null;
  positionX: number;
  positionY: number;
  order: number;
  tables: ObjectTableRefDto[];
  dfdNodes: ObjectDfdNodeRefDto[];
  updatedAt: string;
}

/** オブジェクト関係性マップの関係線 */
export interface ObjectRelationDto {
  id: string;
  projectId: string;
  sourceObjectId: string;
  targetObjectId: string;
  cardinality: RelationCardinality;
  label: string | null;
  description: string | null;
  /** 線形（'straight' | 'bezier'）。null は既定（直線） */
  pathStyle: string | null;
  /** 始点アンカー辺（'top' | 'right' | 'bottom' | 'left'）。null は自動 */
  sourceHandle: string | null;
  /** 終点アンカー辺（'top' | 'right' | 'bottom' | 'left'）。null は自動 */
  targetHandle: string | null;
}

/** 付箋/メモ/スコープ囲みの種別（STICKY=付箋, COMMENT=メモ, SCOPE=領域囲み） */
export type DataObjectAnnotationKind = 'STICKY' | 'COMMENT' | 'SCOPE';

/**
 * オブジェクト関係性マップ上の付箋/メモ/スコープ囲み（FlowAnnotation / DfdAnnotation と同型）。
 * SCOPE は業務領域（SubProject）を点線/背景色つき矩形でカードの背面に囲う注釈。
 */
export interface DataObjectAnnotationDto {
  id: string;
  projectId: string;
  kind: DataObjectAnnotationKind;
  text: string;
  positionX: number;
  positionY: number;
  width: number | null;
  height: number | null;
  color: string | null;
  /** SCOPE の枠線スタイル（'dashed' | 'solid'）。未設定は dashed 扱い。 */
  borderStyle: 'dashed' | 'solid' | null;
  /** SCOPE の背景塗りの不透明度（0〜1）。未設定は薄め既定。 */
  fillOpacity: number | null;
  /** SCOPE が表す領域（SubProject）ID。null は領域未設定。 */
  subProjectId: string | null;
  /** SCOPE の表示/非表示（false で囲みを隠す）。 */
  visible: boolean | null;
  order: number;
  updatedAt: string;
}

/** オブジェクト関係性マップのグラフ */
export interface ObjectGraphDto {
  objects: DataObjectDto[];
  relations: ObjectRelationDto[];
}

/** ER図のカラム行（order順） */
export interface ErColumnDto {
  id: string;
  name: string;
  displayName: string | null;
  dataType: string;
  description: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isNullable: boolean;
  isUnique: boolean;
  foreignKeyTable: string | null;
  foreignKeyColumn: string | null;
  order: number;
}

/** ER図のテーブル（columns 全件含む） */
export interface ErTableDto {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  dataObjectId: string | null;
  erPositionX: number;
  erPositionY: number;
  columns: ErColumnDto[];
}

/** FK由来のテーブル間エッジ（foreignKeyTable を Table.name で解決済み。未解決はバックエンドでスキップ） */
export interface FkEdgeDto {
  sourceTableId: string;
  sourceColumnId: string;
  targetTableId: string;
  targetColumnName: string | null;
}

/** ER図グラフ（点線囲み=objects ＋ 実態テーブル ＋ FKエッジ ＋ オブジェクト関係線） */
export interface ErGraphDto {
  objects: DataObjectDto[];
  tables: ErTableDto[];
  fkEdges: FkEdgeDto[];
  relations: ObjectRelationDto[];
}

/** DFD取り込み結果 */
export interface ImportFromDfdResultDto {
  /** 新規作成した DataObject 件数 */
  created: number;
  /** オブジェクトに紐づけた DFDノード件数 */
  linked: number;
}

export interface PositionItem {
  id: string;
  positionX: number;
  positionY: number;
}

// ========== APIクライアント ==========

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export const dataObjectApi = {
  /** オブジェクト関係性マップ取得（objects＋relations）。GET /api/projects/:projectId/data-objects */
  async getGraph(projectId: string): Promise<ObjectGraphDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-objects`, { headers: headers() });
    if (!res.ok) throw new Error('オブジェクト関係性マップの取得に失敗しました');
    return res.json();
  },

  /** データオブジェクト作成。POST /api/projects/:projectId/data-objects */
  async createObject(
    projectId: string,
    body: {
      name: string;
      description?: string | null;
      color?: string | null;
      /** 所属領域（SubProject）ID。未指定/null は未分類。 */
      subProjectId?: string | null;
      positionX?: number;
      positionY?: number;
      order?: number;
    },
  ): Promise<DataObjectDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-objects`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('オブジェクトの作成に失敗しました');
    return res.json();
  },

  /** データオブジェクト更新（name/description/color/subProjectId/order）。PATCH /api/data-objects/:id */
  async updateObject(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      color?: string | null;
      subProjectId?: string | null;
      order?: number;
    },
  ): Promise<DataObjectDto> {
    const res = await fetch(`${API_URL}/api/data-objects/${id}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('オブジェクトの更新に失敗しました');
    return res.json();
  },

  /**
   * オブジェクトを領域（SubProject）へ紐付け/解除。
   * subProjectId=null（または空文字）で未分類に戻す。PUT /api/data-objects/:id/sub-project
   */
  async linkObjectToSubProject(id: string, subProjectId: string | null): Promise<void> {
    const res = await fetch(`${API_URL}/api/data-objects/${id}/sub-project`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ subProjectId }),
    });
    if (!res.ok) throw new Error('領域の紐付けに失敗しました');
  },

  /** データオブジェクト削除。DELETE /api/data-objects/:id */
  async deleteObject(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/data-objects/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('オブジェクトの削除に失敗しました');
  },

  /** 関係線作成（source=target は拒否される）。POST /api/projects/:projectId/data-object-relations */
  async createRelation(
    projectId: string,
    body: {
      sourceObjectId: string;
      targetObjectId: string;
      cardinality?: RelationCardinality;
      label?: string | null;
      description?: string | null;
      pathStyle?: string | null;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ): Promise<ObjectRelationDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-object-relations`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('関係線の作成に失敗しました');
    return res.json();
  },

  /** 関係線更新。PATCH /api/data-object-relations/:id */
  async updateRelation(
    id: string,
    patch: {
      sourceObjectId?: string;
      targetObjectId?: string;
      cardinality?: RelationCardinality;
      label?: string | null;
      description?: string | null;
      /** undefined=変更なし / null=既定（直線・自動アンカー）へ戻す */
      pathStyle?: string | null;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ): Promise<ObjectRelationDto> {
    const res = await fetch(`${API_URL}/api/data-object-relations/${id}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('関係線の更新に失敗しました');
    return res.json();
  },

  /** 関係線削除。DELETE /api/data-object-relations/:id */
  async deleteRelation(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/data-object-relations/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('関係線の削除に失敗しました');
  },

  /** オブジェクト位置一括保存。PUT /api/projects/:projectId/data-objects/positions */
  async savePositions(projectId: string, positions: PositionItem[]): Promise<void> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-objects/positions`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ positions }),
    });
    if (!res.ok) throw new Error('位置の保存に失敗しました');
  },

  /** 第1レベルDFDのデータストアからオブジェクトを取り込み（冪等）。POST /api/projects/:projectId/data-objects/import-from-dfd */
  async importFromDfd(projectId: string): Promise<ImportFromDfdResultDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-objects/import-from-dfd`, {
      method: 'POST', headers: headers(),
    });
    if (!res.ok) throw new Error('DFDからの取り込みに失敗しました');
    return res.json();
  },

  /** ER図グラフ取得（objects＋tables＋fkEdges＋relations）。GET /api/projects/:projectId/er-graph */
  async getErGraph(projectId: string): Promise<ErGraphDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/er-graph`, { headers: headers() });
    if (!res.ok) throw new Error('ER図の取得に失敗しました');
    return res.json();
  },

  /** ER図テーブル位置一括保存。PUT /api/projects/:projectId/er-positions */
  async saveErPositions(projectId: string, positions: PositionItem[]): Promise<void> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/er-positions`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ positions }),
    });
    if (!res.ok) throw new Error('ER図位置の保存に失敗しました');
  },

  /** テーブルをオブジェクトに紐づけ/解除（dataObjectId=null で解除）。PUT /api/tables/:tableId/data-object */
  async linkTableToObject(tableId: string, dataObjectId: string | null): Promise<void> {
    const res = await fetch(`${API_URL}/api/tables/${tableId}/data-object`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ dataObjectId }),
    });
    if (!res.ok) throw new Error('テーブルの紐づけに失敗しました');
  },

  /**
   * Mermaid（erDiagram/classDiagram/flowchart）を解析して objects/relations を一括生成。
   * 生成後の ObjectGraph を返す。POST /api/projects/:projectId/data-objects/import-mermaid
   */
  async importMermaid(projectId: string, mermaid: string): Promise<ObjectGraphDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-objects/import-mermaid`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ mermaid }),
    });
    if (!res.ok) {
      // Anthropic鍵未設定時など、バックエンドが分かりやすい 400 メッセージを返す
      let msg = 'Mermaidからの生成に失敗しました';
      try {
        const data = await res.json();
        if (data?.message) msg = data.message;
        else if (data?.error) msg = data.error;
      } catch {
        /* JSON でなければ既定メッセージ */
      }
      throw new Error(msg);
    }
    return res.json();
  },
};

/** オブジェクト関係性マップ上の付箋/メモ API */
export const dataObjectAnnotationApi = {
  /** 付箋/メモ一覧。GET /api/projects/:projectId/data-object-annotations */
  async list(projectId: string): Promise<DataObjectAnnotationDto[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-object-annotations`, { headers: headers() });
    if (!res.ok) throw new Error('付箋/メモの取得に失敗しました');
    return res.json();
  },

  /** 付箋/メモ/スコープ囲み作成。POST /api/projects/:projectId/data-object-annotations */
  async create(
    projectId: string,
    body: {
      kind: DataObjectAnnotationKind;
      text: string;
      positionX: number;
      positionY: number;
      width?: number | null;
      height?: number | null;
      color?: string | null;
      /** SCOPE 用: 枠線スタイル */
      borderStyle?: 'dashed' | 'solid' | null;
      /** SCOPE 用: 背景塗りの不透明度（0〜1） */
      fillOpacity?: number | null;
      /** SCOPE 用: 表す領域（SubProject）ID */
      subProjectId?: string | null;
      /** SCOPE 用: 表示/非表示 */
      visible?: boolean | null;
      order?: number;
    },
  ): Promise<DataObjectAnnotationDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-object-annotations`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('付箋/メモの作成に失敗しました');
    return res.json();
  },

  /** 付箋/メモ/スコープ囲み更新。PATCH /api/data-object-annotations/:id */
  async update(
    id: string,
    patch: {
      text?: string;
      positionX?: number;
      positionY?: number;
      width?: number | null;
      height?: number | null;
      color?: string | null;
      /** SCOPE 用: 枠線スタイル */
      borderStyle?: 'dashed' | 'solid' | null;
      /** SCOPE 用: 背景塗りの不透明度（0〜1） */
      fillOpacity?: number | null;
      /** SCOPE 用: 表す領域（SubProject）ID（null で領域未設定へ） */
      subProjectId?: string | null;
      /** SCOPE 用: 表示/非表示 */
      visible?: boolean | null;
      order?: number;
    },
  ): Promise<DataObjectAnnotationDto> {
    const res = await fetch(`${API_URL}/api/data-object-annotations/${id}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('付箋/メモの更新に失敗しました');
    return res.json();
  },

  /** 付箋/メモ/スコープ囲み削除。DELETE /api/data-object-annotations/:id */
  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/data-object-annotations/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('付箋/メモの削除に失敗しました');
  },

  /**
   * SCOPE 注釈の矩形に中心が入る DataObject を、注釈の領域（subProjectId）へ一括紐付け。
   * subProjectId 未設定の注釈では何もしない。POST /api/data-object-annotations/:id/apply-scope-links
   */
  async applyScopeLinks(annotationId: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/data-object-annotations/${annotationId}/apply-scope-links`, {
      method: 'POST', headers: headers(),
    });
    if (!res.ok) throw new Error('囲み内オブジェクトの領域紐付けに失敗しました');
  },
};
