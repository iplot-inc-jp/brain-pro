import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

/** 用語の状態。 */
export const GLOSSARY_TERM_STATUSES = ['APPROVED', 'DRAFT', 'DEPRECATED'] as const;
export type GlossaryTermStatus = (typeof GLOSSARY_TERM_STATUSES)[number];

/**
 * 用語対応の文脈。
 * ALIAS      … 現場での言い方（表記ゆれ・略称・誤用を含む）
 * ENGLISH    … 英語名
 * DB         … テーブル.カラム
 * SCREEN     … 画面項目名
 * INTERFACE  … 電文フィールド名（WMS/EDI など）
 * CODE       … コード上の識別子（クラス名・変数名）
 * FORBIDDEN  … 使ってはいけない言い方
 * OTHER      … その他
 */
export const GLOSSARY_MAPPING_CONTEXTS = [
  'ALIAS',
  'ENGLISH',
  'DB',
  'SCREEN',
  'INTERFACE',
  'CODE',
  'FORBIDDEN',
  'OTHER',
] as const;
export type GlossaryMappingContext = (typeof GLOSSARY_MAPPING_CONTEXTS)[number];

export interface CreateGlossaryTermMappingProps {
  termId: string;
  context?: string | null;
  systemName?: string | null;
  value: string;
  note?: string | null;
  order?: number;
}

export interface ReconstructGlossaryTermMappingProps {
  id: string;
  termId: string;
  context: string;
  systemName: string | null;
  value: string;
  note: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 用語対応エンティティ。
 * 1つの用語が、文脈ごとに何と呼ばれるかを1件ずつ表す。
 */
export class GlossaryTermMapping extends BaseEntity {
  private readonly _termId: string;
  private _context: string;
  private _systemName: string | null;
  private _value: string;
  private _note: string | null;
  private _order: number;

  private constructor(
    id: string,
    termId: string,
    context: string,
    systemName: string | null,
    value: string,
    note: string | null,
    order: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._termId = termId;
    this._context = context;
    this._systemName = systemName;
    this._value = value;
    this._note = note;
    this._order = order;
  }

  private static normalizeContext(raw: string | null | undefined): string {
    const v = (raw ?? 'ALIAS').trim().toUpperCase();
    return (GLOSSARY_MAPPING_CONTEXTS as readonly string[]).includes(v) ? v : 'OTHER';
  }

  private static validateValue(raw: string | undefined): string {
    const value = raw?.trim();
    if (!value) {
      throw new ValidationError('Glossary mapping value is required');
    }
    if (value.length > 300) {
      throw new ValidationError('Glossary mapping value must be at most 300 characters');
    }
    return value;
  }

  static create(props: CreateGlossaryTermMappingProps, id: string): GlossaryTermMapping {
    if (!props.termId) {
      throw new ValidationError('Term ID is required');
    }
    const now = new Date();
    return new GlossaryTermMapping(
      id,
      props.termId,
      GlossaryTermMapping.normalizeContext(props.context),
      props.systemName?.trim() || null,
      GlossaryTermMapping.validateValue(props.value),
      props.note ?? null,
      props.order ?? 0,
      now,
      now,
    );
  }

  static reconstruct(props: ReconstructGlossaryTermMappingProps): GlossaryTermMapping {
    return new GlossaryTermMapping(
      props.id,
      props.termId,
      props.context,
      props.systemName,
      props.value,
      props.note,
      props.order,
      props.createdAt,
      props.updatedAt,
    );
  }

  update(props: {
    context?: string | null;
    systemName?: string | null;
    value?: string;
    note?: string | null;
    order?: number;
  }): void {
    if (props.context !== undefined) {
      this._context = GlossaryTermMapping.normalizeContext(props.context);
    }
    if (props.systemName !== undefined) {
      this._systemName = props.systemName?.trim() || null;
    }
    if (props.value !== undefined) {
      this._value = GlossaryTermMapping.validateValue(props.value);
    }
    if (props.note !== undefined) {
      this._note = props.note ?? null;
    }
    if (props.order !== undefined) {
      this._order = props.order;
    }
    this.touch();
  }

  get termId(): string {
    return this._termId;
  }
  get context(): string {
    return this._context;
  }
  get systemName(): string | null {
    return this._systemName;
  }
  get value(): string {
    return this._value;
  }
  get note(): string | null {
    return this._note;
  }
  get order(): number {
    return this._order;
  }
}

export interface CreateGlossaryTermProps {
  projectId: string;
  subProjectId?: string | null;
  termCode?: string | null;
  name: string;
  definition?: string | null;
  sourceOfTruth?: string | null;
  sourceOfTruthNote?: string | null;
  category?: string | null;
  status?: string | null;
  notes?: string | null;
  order?: number;
}

export interface ReconstructGlossaryTermProps {
  id: string;
  projectId: string;
  subProjectId: string | null;
  termCode: string | null;
  name: string;
  definition: string | null;
  sourceOfTruth: string | null;
  sourceOfTruthNote: string | null;
  category: string | null;
  status: string;
  notes: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  mappings?: GlossaryTermMapping[];
}

/**
 * 用語エンティティ（プロジェクト共通語彙の1概念）。
 *
 * 「意味（definition）」「正（sourceOfTruth）」「名前の対応（mappings）」の3点セットで管理する。
 * 名前の対応だけでは、値が食い違ったときにどちらを信じるかが決まらないため、
 * 正（source of truth）を必ず併せて持たせる設計にしている。
 */
export class GlossaryTerm extends BaseEntity {
  private readonly _projectId: string;
  private _subProjectId: string | null;
  private _termCode: string | null;
  private _name: string;
  private _definition: string | null;
  private _sourceOfTruth: string | null;
  private _sourceOfTruthNote: string | null;
  private _category: string | null;
  private _status: string;
  private _notes: string | null;
  private _order: number;
  private _mappings: GlossaryTermMapping[];

  private constructor(
    id: string,
    projectId: string,
    subProjectId: string | null,
    termCode: string | null,
    name: string,
    definition: string | null,
    sourceOfTruth: string | null,
    sourceOfTruthNote: string | null,
    category: string | null,
    status: string,
    notes: string | null,
    order: number,
    createdAt: Date,
    updatedAt: Date,
    mappings: GlossaryTermMapping[],
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._subProjectId = subProjectId;
    this._termCode = termCode;
    this._name = name;
    this._definition = definition;
    this._sourceOfTruth = sourceOfTruth;
    this._sourceOfTruthNote = sourceOfTruthNote;
    this._category = category;
    this._status = status;
    this._notes = notes;
    this._order = order;
    this._mappings = mappings;
  }

  private static normalizeStatus(raw: string | null | undefined): string {
    const v = (raw ?? 'APPROVED').trim().toUpperCase();
    return (GLOSSARY_TERM_STATUSES as readonly string[]).includes(v) ? v : 'APPROVED';
  }

  private static validateName(raw: string | undefined): string {
    const name = raw?.trim();
    if (!name) {
      throw new ValidationError('Glossary term name is required');
    }
    if (name.length > 200) {
      throw new ValidationError('Glossary term name must be at most 200 characters');
    }
    return name;
  }

  private static normalizeTermCode(raw: string | null | undefined): string | null {
    const code = raw?.trim();
    if (!code) return null;
    if (code.length > 50) {
      throw new ValidationError('Glossary term code must be at most 50 characters');
    }
    return code;
  }

  static create(props: CreateGlossaryTermProps, id: string): GlossaryTerm {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }
    const now = new Date();
    return new GlossaryTerm(
      id,
      props.projectId,
      props.subProjectId ?? null,
      GlossaryTerm.normalizeTermCode(props.termCode),
      GlossaryTerm.validateName(props.name),
      props.definition ?? null,
      props.sourceOfTruth?.trim() || null,
      props.sourceOfTruthNote ?? null,
      props.category?.trim() || null,
      GlossaryTerm.normalizeStatus(props.status),
      props.notes ?? null,
      props.order ?? 0,
      now,
      now,
      [],
    );
  }

  static reconstruct(props: ReconstructGlossaryTermProps): GlossaryTerm {
    return new GlossaryTerm(
      props.id,
      props.projectId,
      props.subProjectId,
      props.termCode,
      props.name,
      props.definition,
      props.sourceOfTruth,
      props.sourceOfTruthNote,
      props.category,
      props.status,
      props.notes,
      props.order,
      props.createdAt,
      props.updatedAt,
      props.mappings ?? [],
    );
  }

  update(props: {
    subProjectId?: string | null;
    termCode?: string | null;
    name?: string;
    definition?: string | null;
    sourceOfTruth?: string | null;
    sourceOfTruthNote?: string | null;
    category?: string | null;
    status?: string | null;
    notes?: string | null;
    order?: number;
  }): void {
    if (props.subProjectId !== undefined) {
      this._subProjectId = props.subProjectId ?? null;
    }
    if (props.termCode !== undefined) {
      this._termCode = GlossaryTerm.normalizeTermCode(props.termCode);
    }
    if (props.name !== undefined) {
      this._name = GlossaryTerm.validateName(props.name);
    }
    if (props.definition !== undefined) {
      this._definition = props.definition ?? null;
    }
    if (props.sourceOfTruth !== undefined) {
      this._sourceOfTruth = props.sourceOfTruth?.trim() || null;
    }
    if (props.sourceOfTruthNote !== undefined) {
      this._sourceOfTruthNote = props.sourceOfTruthNote ?? null;
    }
    if (props.category !== undefined) {
      this._category = props.category?.trim() || null;
    }
    if (props.status !== undefined) {
      this._status = GlossaryTerm.normalizeStatus(props.status);
    }
    if (props.notes !== undefined) {
      this._notes = props.notes ?? null;
    }
    if (props.order !== undefined) {
      this._order = props.order;
    }
    this.touch();
  }

  get projectId(): string {
    return this._projectId;
  }
  get subProjectId(): string | null {
    return this._subProjectId;
  }
  get termCode(): string | null {
    return this._termCode;
  }
  get name(): string {
    return this._name;
  }
  get definition(): string | null {
    return this._definition;
  }
  get sourceOfTruth(): string | null {
    return this._sourceOfTruth;
  }
  get sourceOfTruthNote(): string | null {
    return this._sourceOfTruthNote;
  }
  get category(): string | null {
    return this._category;
  }
  get status(): string {
    return this._status;
  }
  get notes(): string | null {
    return this._notes;
  }
  get order(): number {
    return this._order;
  }
  get mappings(): GlossaryTermMapping[] {
    return this._mappings;
  }
}
