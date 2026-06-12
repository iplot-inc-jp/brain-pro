import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  IDataObjectRepository,
  ObjectGraph,
  ObjectTableRef,
  ObjectDfdNodeRef,
  ErTableRow,
  L1DataStoreNode,
  TableProjectRef,
} from '../../../domain/repositories/data-object.repository';
import { DataObject } from '../../../domain/entities/data-object.entity';
import {
  DataObjectRelation,
  RelationCardinalityValue,
  RelationHandleValue,
  RelationPathStyleValue,
} from '../../../domain/entities/data-object-relation.entity';

interface ObjectRow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: string | null;
  positionX: number;
  positionY: number;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RelationRow {
  id: string;
  projectId: string;
  sourceObjectId: string;
  targetObjectId: string;
  cardinality: string;
  label: string | null;
  description: string | null;
  pathStyle: string | null;
  sourceHandle: string | null;
  targetHandle: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class DataObjectRepositoryImpl implements IDataObjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toObject(r: ObjectRow): DataObject {
    return DataObject.reconstruct({
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      description: r.description,
      color: r.color,
      positionX: r.positionX,
      positionY: r.positionY,
      order: r.order,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  private toRelation(r: RelationRow): DataObjectRelation {
    return DataObjectRelation.reconstruct({
      id: r.id,
      projectId: r.projectId,
      sourceObjectId: r.sourceObjectId,
      targetObjectId: r.targetObjectId,
      cardinality: r.cardinality as RelationCardinalityValue,
      label: r.label,
      description: r.description,
      pathStyle: r.pathStyle as RelationPathStyleValue | null,
      sourceHandle: r.sourceHandle as RelationHandleValue | null,
      targetHandle: r.targetHandle as RelationHandleValue | null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  async findObjectGraph(projectId: string): Promise<ObjectGraph> {
    const [objects, relations] = await Promise.all([
      this.prisma.dataObject.findMany({
        where: { projectId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        include: {
          tables: {
            select: { id: true, name: true, displayName: true },
            orderBy: { name: 'asc' },
          },
          dfdNodes: {
            select: { id: true, label: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.dataObjectRelation.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      entries: objects.map((o) => ({
        object: this.toObject(o),
        tables: o.tables,
        dfdNodes: o.dfdNodes,
      })),
      relations: relations.map((r) => this.toRelation(r)),
    };
  }

  async findById(id: string): Promise<DataObject | null> {
    const r = await this.prisma.dataObject.findUnique({ where: { id } });
    return r ? this.toObject(r) : null;
  }

  async findByName(projectId: string, name: string): Promise<DataObject | null> {
    const r = await this.prisma.dataObject.findUnique({
      where: { projectId_name: { projectId, name } },
    });
    return r ? this.toObject(r) : null;
  }

  async findObjectRefs(
    objectId: string,
  ): Promise<{ tables: ObjectTableRef[]; dfdNodes: ObjectDfdNodeRef[] }> {
    const [tables, dfdNodes] = await Promise.all([
      this.prisma.table.findMany({
        where: { dataObjectId: objectId },
        select: { id: true, name: true, displayName: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.dfdNode.findMany({
        where: { dataObjectId: objectId },
        select: { id: true, label: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { tables, dfdNodes };
  }

  async nextOrder(projectId: string): Promise<number> {
    const agg = await this.prisma.dataObject.aggregate({
      where: { projectId },
      _max: { order: true },
    });
    return agg._max.order === null ? 0 : agg._max.order + 1;
  }

  async save(o: DataObject): Promise<void> {
    const data = {
      projectId: o.projectId,
      name: o.name,
      description: o.description,
      color: o.color,
      positionX: o.positionX,
      positionY: o.positionY,
      order: o.order,
    };
    await this.prisma.dataObject.upsert({
      where: { id: o.id },
      create: { id: o.id, ...data },
      update: data,
    });
  }

  async getOrCreateByName(
    projectId: string,
    name: string,
    order: number,
  ): Promise<{ object: DataObject; created: boolean }> {
    const existing = await this.prisma.dataObject.findUnique({
      where: { projectId_name: { projectId, name } },
    });
    if (existing) return { object: this.toObject(existing), created: false };
    try {
      const created = await this.prisma.dataObject.create({
        data: { id: randomUUID(), projectId, name, order },
      });
      return { object: this.toObject(created), created: true };
    } catch (e) {
      // 並行作成で別リクエストが先に同名を作成（一意制約 P2002）→ 勝者を読み直す
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const winner = await this.prisma.dataObject.findUnique({
          where: { projectId_name: { projectId, name } },
        });
        if (winner) return { object: this.toObject(winner), created: false };
      }
      throw e;
    }
  }

  async delete(id: string): Promise<void> {
    await this.prisma.dataObject.delete({ where: { id } });
  }

  async findRelationById(id: string): Promise<DataObjectRelation | null> {
    const r = await this.prisma.dataObjectRelation.findUnique({ where: { id } });
    return r ? this.toRelation(r) : null;
  }

  async findRelationByEndpoints(
    projectId: string,
    sourceObjectId: string,
    targetObjectId: string,
  ): Promise<DataObjectRelation | null> {
    const r = await this.prisma.dataObjectRelation.findFirst({
      where: { projectId, sourceObjectId, targetObjectId },
      orderBy: { createdAt: 'asc' },
    });
    return r ? this.toRelation(r) : null;
  }

  async saveRelation(r: DataObjectRelation): Promise<void> {
    const data = {
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
    await this.prisma.dataObjectRelation.upsert({
      where: { id: r.id },
      create: { id: r.id, ...data },
      update: data,
    });
  }

  async deleteRelation(id: string): Promise<void> {
    await this.prisma.dataObjectRelation.delete({ where: { id } });
  }

  async bulkSavePositions(
    projectId: string,
    positions: { id: string; positionX: number; positionY: number }[],
  ): Promise<void> {
    await this.prisma.$transaction(
      positions.map((p) =>
        this.prisma.dataObject.updateMany({
          where: { id: p.id, projectId },
          data: { positionX: p.positionX, positionY: p.positionY },
        }),
      ),
    );
  }

  async findErTables(projectId: string): Promise<ErTableRow[]> {
    const tables = await this.prisma.table.findMany({
      where: { projectId },
      orderBy: [{ name: 'asc' }],
      include: { columns: { orderBy: { order: 'asc' } } },
    });
    return tables.map((t) => ({
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      dataObjectId: t.dataObjectId,
      erPositionX: t.erPositionX,
      erPositionY: t.erPositionY,
      columns: t.columns.map((c) => ({
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
      })),
    }));
  }

  async bulkSaveErPositions(
    projectId: string,
    positions: { id: string; positionX: number; positionY: number }[],
  ): Promise<void> {
    await this.prisma.$transaction(
      positions.map((p) =>
        this.prisma.table.updateMany({
          where: { id: p.id, projectId },
          data: { erPositionX: p.positionX, erPositionY: p.positionY },
        }),
      ),
    );
  }

  async findL1DataStoreNodes(projectId: string): Promise<L1DataStoreNode[]> {
    const nodes = await this.prisma.dfdNode.findMany({
      where: { kind: 'DATA_STORE', diagram: { projectId, flowId: null } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, label: true, dataObjectId: true },
    });
    return nodes;
  }

  async setDfdNodeObject(nodeId: string, dataObjectId: string): Promise<void> {
    await this.prisma.dfdNode.update({
      where: { id: nodeId },
      data: { dataObjectId },
    });
  }

  async findTableProjectRef(tableId: string): Promise<TableProjectRef | null> {
    const t = await this.prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, projectId: true },
    });
    return t;
  }

  async linkTableToObject(tableId: string, dataObjectId: string | null): Promise<void> {
    await this.prisma.table.update({
      where: { id: tableId },
      data: { dataObjectId },
    });
  }

  generateId(): string {
    return randomUUID();
  }
}
