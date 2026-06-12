import { DataObject } from '../../../domain/entities/data-object.entity';
import {
  DataObjectRelation,
  RelationCardinalityValue,
  RelationHandleValue,
  RelationPathStyleValue,
} from '../../../domain/entities/data-object-relation.entity';
import {
  ObjectGraph,
  ObjectTableRef,
  ObjectDfdNodeRef,
  ErTableRow,
  ErColumnRow,
} from '../../../domain/repositories/data-object.repository';

export interface DataObjectOutput {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: string | null;
  positionX: number;
  positionY: number;
  order: number;
  /** 紐づく実態テーブル（ER図で細分化表示する単位） */
  tables: ObjectTableRef[];
  /** 紐づくDFDデータストアノード */
  dfdNodes: ObjectDfdNodeRef[];
  updatedAt: string;
}

export interface ObjectRelationOutput {
  id: string;
  projectId: string;
  sourceObjectId: string;
  targetObjectId: string;
  cardinality: RelationCardinalityValue;
  label: string | null;
  description: string | null;
  /** 線形: 'straight'（null=既定の直線） | 'bezier'（曲線） */
  pathStyle: RelationPathStyleValue | null;
  /** 接続辺: 'top'|'right'|'bottom'|'left'、null=自動 */
  sourceHandle: RelationHandleValue | null;
  targetHandle: RelationHandleValue | null;
}

export interface ObjectGraphOutput {
  objects: DataObjectOutput[];
  relations: ObjectRelationOutput[];
}

export interface ErColumnOutput {
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

export interface ErTableOutput {
  id: string;
  name: string;
  displayName: string | null;
  description: string | null;
  dataObjectId: string | null;
  erPositionX: number;
  erPositionY: number;
  columns: ErColumnOutput[];
}

/** FK由来のテーブル間エッジ（foreignKeyTable をプロジェクト内 Table.name で解決済み） */
export interface FkEdgeOutput {
  sourceTableId: string;
  sourceColumnId: string;
  targetTableId: string;
  targetColumnName: string | null;
}

export interface ErGraphOutput {
  objects: DataObjectOutput[];
  tables: ErTableOutput[];
  fkEdges: FkEdgeOutput[];
  relations: ObjectRelationOutput[];
}

export function toDataObjectOutput(
  o: DataObject,
  tables: ObjectTableRef[] = [],
  dfdNodes: ObjectDfdNodeRef[] = [],
): DataObjectOutput {
  return {
    id: o.id,
    projectId: o.projectId,
    name: o.name,
    description: o.description,
    color: o.color,
    positionX: o.positionX,
    positionY: o.positionY,
    order: o.order,
    tables,
    dfdNodes,
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function toObjectRelationOutput(r: DataObjectRelation): ObjectRelationOutput {
  return {
    id: r.id,
    projectId: r.projectId,
    sourceObjectId: r.sourceObjectId,
    targetObjectId: r.targetObjectId,
    cardinality: r.cardinality,
    label: r.label,
    description: r.description,
    pathStyle: r.pathStyle,
    sourceHandle: r.sourceHandle,
    targetHandle: r.targetHandle,
  };
}

export function toObjectGraphOutput(graph: ObjectGraph): ObjectGraphOutput {
  return {
    objects: graph.entries.map((e) => toDataObjectOutput(e.object, e.tables, e.dfdNodes)),
    relations: graph.relations.map(toObjectRelationOutput),
  };
}

export function toErColumnOutput(c: ErColumnRow): ErColumnOutput {
  return {
    id: c.id,
    name: c.name,
    displayName: c.displayName,
    dataType: c.dataType,
    description: c.description,
    isPrimaryKey: c.isPrimaryKey,
    isForeignKey: c.isForeignKey,
    isNullable: c.isNullable,
    isUnique: c.isUnique,
    foreignKeyTable: c.foreignKeyTable,
    foreignKeyColumn: c.foreignKeyColumn,
    order: c.order,
  };
}

export function toErTableOutput(t: ErTableRow): ErTableOutput {
  return {
    id: t.id,
    name: t.name,
    displayName: t.displayName,
    description: t.description,
    dataObjectId: t.dataObjectId,
    erPositionX: t.erPositionX,
    erPositionY: t.erPositionY,
    columns: t.columns.map(toErColumnOutput),
  };
}
