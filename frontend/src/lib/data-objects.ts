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

/** 付箋/メモの種別（STICKY=付箋, COMMENT=メモ） */
export type DataObjectAnnotationKind = 'STICKY' | 'COMMENT';

/** オブジェクト関係性マップ上の付箋/メモ（FlowAnnotation / DfdAnnotation と同型） */
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

  /** データオブジェクト更新（name/description/color/order）。PATCH /api/data-objects/:id */
  async updateObject(
    id: string,
    patch: { name?: string; description?: string | null; color?: string | null; order?: number },
  ): Promise<DataObjectDto> {
    const res = await fetch(`${API_URL}/api/data-objects/${id}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('オブジェクトの更新に失敗しました');
    return res.json();
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
};

/** オブジェクト関係性マップ上の付箋/メモ API */
export const dataObjectAnnotationApi = {
  /** 付箋/メモ一覧。GET /api/projects/:projectId/data-object-annotations */
  async list(projectId: string): Promise<DataObjectAnnotationDto[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-object-annotations`, { headers: headers() });
    if (!res.ok) throw new Error('付箋/メモの取得に失敗しました');
    return res.json();
  },

  /** 付箋/メモ作成。POST /api/projects/:projectId/data-object-annotations */
  async create(
    projectId: string,
    body: {
      kind: DataObjectAnnotationKind;
      text: string;
      positionX: number;
      positionY: number;
      color?: string | null;
      order?: number;
    },
  ): Promise<DataObjectAnnotationDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/data-object-annotations`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('付箋/メモの作成に失敗しました');
    return res.json();
  },

  /** 付箋/メモ更新。PATCH /api/data-object-annotations/:id */
  async update(
    id: string,
    patch: {
      text?: string;
      positionX?: number;
      positionY?: number;
      width?: number | null;
      height?: number | null;
      color?: string | null;
      order?: number;
    },
  ): Promise<DataObjectAnnotationDto> {
    const res = await fetch(`${API_URL}/api/data-object-annotations/${id}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('付箋/メモの更新に失敗しました');
    return res.json();
  },

  /** 付箋/メモ削除。DELETE /api/data-object-annotations/:id */
  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/data-object-annotations/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('付箋/メモの削除に失敗しました');
  },
};
