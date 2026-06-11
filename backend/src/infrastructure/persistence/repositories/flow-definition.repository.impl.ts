import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  IFlowDefinitionRepository,
  FlowWithDefinition,
} from '../../../domain/repositories/flow-definition.repository';
import { FlowDefinition } from '../../../domain/entities/flow-definition.entity';

@Injectable()
export class FlowDefinitionRepositoryImpl implements IFlowDefinitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toEntity(r: {
    id: string; flowId: string; purpose: string | null; owner: string | null;
    stakeholders: string | null; input: string | null; inputDetail: string | null;
    trigger: string | null; doSteps: unknown; output: string | null; nextProcess: string | null;
    exceptionHandling: string | null; frequency: string | null; system: string | null;
    tacitNotes: string | null; createdAt: Date; updatedAt: Date;
  }): FlowDefinition {
    return FlowDefinition.reconstruct({
      id: r.id, flowId: r.flowId,
      purpose: r.purpose, owner: r.owner, stakeholders: r.stakeholders,
      input: r.input, inputDetail: r.inputDetail, trigger: r.trigger,
      doSteps: Array.isArray(r.doSteps) ? (r.doSteps as unknown[]).map(String) : [],
      output: r.output, nextProcess: r.nextProcess, exceptionHandling: r.exceptionHandling,
      frequency: r.frequency, system: r.system, tacitNotes: r.tacitNotes,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    });
  }

  async findByFlowId(flowId: string): Promise<FlowDefinition | null> {
    const r = await this.prisma.flowDefinition.findUnique({ where: { flowId } });
    return r ? this.toEntity(r) : null;
  }

  async findByProjectId(projectId: string): Promise<FlowWithDefinition[]> {
    const flows = await this.prisma.businessFlow.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        definition: true,
        // ノードの情報リンク → 情報種別マスタ（INPUT/OUTPUT 集計の正データ）
        nodes: {
          include: {
            informationLinks: { include: { informationType: true } },
          },
        },
        // フロー添付ファイル件数（一覧バッジ用。実体は持たず件数のみ）
        _count: { select: { attachments: true } },
      },
    });
    return flows.map((f) => {
      // 各フローのノードを横断して INPUT / OUTPUT の情報種別名を重複除去で集計
      const inputSet = new Set<string>();
      const outputSet = new Set<string>();
      for (const node of f.nodes) {
        for (const link of node.informationLinks) {
          const name = link.informationType?.name;
          if (!name) continue;
          if (link.direction === 'INPUT') inputSet.add(name);
          else if (link.direction === 'OUTPUT') outputSet.add(name);
        }
      }
      return {
        flowId: f.id,
        flowName: f.name,
        kind: f.kind,
        parentId: f.parentId,
        depth: f.depth,
        definition: f.definition ? this.toEntity(f.definition) : null,
        inputItems: [...inputSet],
        outputItems: [...outputSet],
        attachmentCount: f._count.attachments,
      };
    });
  }

  async save(def: FlowDefinition): Promise<void> {
    const f = def.fields;
    const data = {
      purpose: f.purpose, owner: f.owner, stakeholders: f.stakeholders,
      input: f.input, inputDetail: f.inputDetail, trigger: f.trigger,
      doSteps: f.doSteps as unknown as object, output: f.output, nextProcess: f.nextProcess,
      exceptionHandling: f.exceptionHandling, frequency: f.frequency, system: f.system,
      tacitNotes: f.tacitNotes,
    };
    await this.prisma.flowDefinition.upsert({
      where: { flowId: def.flowId },
      create: { id: def.id, flowId: def.flowId, ...data },
      update: data,
    });
  }

  generateId(): string {
    return randomUUID();
  }
}
