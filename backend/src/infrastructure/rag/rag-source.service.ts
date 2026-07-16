import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../persistence/prisma/prisma.service';
import {
  RagFeatureType,
  RagSourceBundle,
  RagSourceFile,
  RagSourceItem,
} from './rag.types';

type JsonRecord = Record<string, unknown>;

const FEATURE_LABELS: Record<RagFeatureType, string> = {
  BUSINESS_FLOW: '業務フロー',
  REQUIREMENT: '要件',
  ISSUE_TREE: 'イシューツリー',
  TASK: 'タスク',
  STAKEHOLDER: 'ステークホルダー',
  RISK: 'リスク',
  KPI: 'KPI',
  SYSTEM: 'システム',
  DATA_CATALOG: 'データカタログ／オブジェクト',
  MEETING: '会議・議事録',
};

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .filter(([, child]) => child !== undefined && child !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function sourceHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function item(
  sourceKey: string,
  sourceUrl: string,
  title: string,
  facts: JsonRecord,
  metadata: JsonRecord = {},
  sourceFiles: RagSourceFile[] = [],
): RagSourceItem {
  const uniqueFiles = new Map<string, RagSourceFile>();
  for (const file of sourceFiles) {
    if (!file.url || uniqueFiles.has(file.url)) continue;
    uniqueFiles.set(file.url, file);
    if (uniqueFiles.size >= 20) break;
  }
  return {
    sourceKey,
    sourceUrl,
    title,
    facts: canonicalize(facts) as JsonRecord,
    metadata,
    sourceFiles: [...uniqueFiles.values()],
  };
}

@Injectable()
export class RagSourceService {
  constructor(private readonly prisma: PrismaService) {}

  async build(
    projectId: string,
    featureType: RagFeatureType,
    targetId?: string | null,
  ): Promise<RagSourceBundle> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) throw new Error('プロジェクトが見つかりません');

    let overviewFacts: JsonRecord;
    let components: RagSourceItem[];
    let overviewUrl: string;
    let overviewTitle: string;

    switch (featureType) {
      case 'BUSINESS_FLOW':
        ({ overviewFacts, components, overviewUrl, overviewTitle } =
          await this.businessFlows(projectId, targetId));
        break;
      case 'REQUIREMENT':
        ({ overviewFacts, components, overviewUrl, overviewTitle } =
          await this.requirements(projectId, targetId));
        break;
      case 'ISSUE_TREE':
        ({ overviewFacts, components, overviewUrl, overviewTitle } =
          await this.issueTrees(projectId, targetId));
        break;
      case 'TASK':
        ({ overviewFacts, components, overviewUrl, overviewTitle } = await this.tasks(projectId));
        break;
      case 'STAKEHOLDER':
        ({ overviewFacts, components, overviewUrl, overviewTitle } =
          await this.stakeholders(projectId));
        break;
      case 'RISK':
        ({ overviewFacts, components, overviewUrl, overviewTitle } = await this.risks(projectId));
        break;
      case 'KPI':
        ({ overviewFacts, components, overviewUrl, overviewTitle } = await this.kpis(projectId));
        break;
      case 'SYSTEM':
        ({ overviewFacts, components, overviewUrl, overviewTitle } = await this.systems(projectId));
        break;
      case 'DATA_CATALOG':
        ({ overviewFacts, components, overviewUrl, overviewTitle } =
          await this.dataCatalog(projectId));
        break;
      case 'MEETING':
        ({ overviewFacts, components, overviewUrl, overviewTitle } = await this.meetings(projectId));
        break;
    }

    if (components.length === 0) {
      throw new Error(`${FEATURE_LABELS[featureType]}にRAG用のデータがありません`);
    }
    components.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
    const targetKey = targetId || 'project';
    const overview = item(
      targetId || `project:${featureType}`,
      overviewUrl,
      overviewTitle || `${project.name}の${FEATURE_LABELS[featureType]}`,
      { projectName: project.name, ...overviewFacts },
      { targetKey, featureType },
      components.flatMap((component) => component.sourceFiles ?? []),
    );
    return {
      featureType,
      targetKey,
      overview,
      components,
      sourceHash: sourceHash({ overview, components }),
    };
  }

  private base(projectId: string): string {
    return `/dashboard/projects/${projectId}`;
  }

  private async businessFlows(projectId: string, targetId?: string | null) {
    const rows: any[] = await this.prisma.businessFlow.findMany({
      where: { projectId, ...(targetId ? { id: targetId } : {}) },
      orderBy: [{ depth: 'asc' }, { name: 'asc' }],
      include: {
        definition: true,
        nodes: {
          orderBy: { order: 'asc' },
          include: {
            role: { select: { name: true, type: true } },
            informationLinks: { include: { informationType: true } },
          },
        },
        edges: { include: { informationType: true } },
        assignees: { include: { stakeholder: { select: { name: true } } } },
        attachments: {
          select: { id: true, filename: true, displayName: true, mimeType: true },
          orderBy: { order: 'asc' },
        },
      },
    } as any);
    if (rows.length === 0) return this.empty(`${this.base(projectId)}/flows`, '業務フロー');
    const flowFacts = (flow: any) => ({
      name: flow.name,
      description: flow.description,
      kind: flow.kind,
      confidence: flow.confidence,
      parentId: flow.parentId,
      depth: flow.depth,
      definition: flow.definition,
      assignees: flow.assignees?.map((a: any) => a.stakeholder?.name).filter(Boolean),
      nodes: flow.nodes?.map((node: any) => ({
        id: node.id,
        label: node.label,
        type: node.type,
        description: node.description,
        role: node.role,
        processingTime: node.processingTime,
        handledCount: node.handledCount,
        supplement: node.supplement,
        information: node.informationLinks?.map((link: any) => ({
          direction: link.direction,
          name: link.informationType?.name,
          category: link.informationType?.category,
        })),
      })),
      edges: flow.edges?.map((edge: any) => ({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        label: edge.label,
        condition: edge.condition,
        information: edge.informationType?.name,
      })),
      updatedAt: flow.updatedAt,
    });
    if (targetId) {
      const flow = rows[0];
      const url = `${this.base(projectId)}/flows/${flow.id}`;
      return {
        overviewFacts: flowFacts(flow),
        components: flow.nodes.map((node: any) =>
          item(node.id, url, node.label, {
            flowName: flow.name,
            type: node.type,
            description: node.description,
            role: node.role,
            processingTime: node.processingTime,
            handledCount: node.handledCount,
            supplement: node.supplement,
            inputsAndOutputs: node.informationLinks,
          }, {}, this.attachmentFiles(flow.attachments)),
        ),
        overviewUrl: url,
        overviewTitle: flow.name,
      };
    }
    return {
      overviewFacts: { flows: rows.map(flowFacts) },
      components: rows.map((flow) =>
        item(
          flow.id,
          `${this.base(projectId)}/flows/${flow.id}`,
          flow.name,
          flowFacts(flow),
          {},
          this.attachmentFiles(flow.attachments),
        ),
      ),
      overviewUrl: `${this.base(projectId)}/flows`,
      overviewTitle: '業務フロー全体',
    };
  }

  private async requirements(projectId: string, targetId?: string | null) {
    const rows: any[] = await this.prisma.requirement.findMany({
      where: { projectId, ...(targetId ? { id: targetId } : {}) },
      orderBy: [{ depth: 'asc' }, { order: 'asc' }],
      include: {
        flowMappings: { include: { flow: { select: { id: true, name: true } }, flowNode: { select: { id: true, label: true } } } },
      },
    } as any);
    const url = `${this.base(projectId)}/requirements`;
    const facts = (row: any) => ({
      code: row.code, title: row.title, description: row.description, originalText: row.originalText,
      type: row.type, priority: row.priority, status: row.status, parentId: row.parentId,
      depth: row.depth, mappings: row.flowMappings, metadata: row.metadata, updatedAt: row.updatedAt,
    });
    return this.collection(rows, url, '要件全体', facts, (row) => row.title);
  }

  private async issueTrees(projectId: string, targetId?: string | null) {
    const rows: any[] = await this.prisma.issueTree.findMany({
      where: { projectId, ...(targetId ? { id: targetId } : {}) },
      orderBy: { updatedAt: 'desc' },
      include: { nodes: { orderBy: [{ depth: 'asc' }, { order: 'asc' }] } },
    } as any);
    if (rows.length === 0) return this.empty(`${this.base(projectId)}/issue-trees`, 'イシューツリー');
    const treeFacts = (tree: any) => ({
      name: tree.name, type: tree.type, pattern: tree.pattern, rootQuestion: tree.rootQuestion,
      nodes: tree.nodes, updatedAt: tree.updatedAt,
    });
    if (targetId) {
      const tree = rows[0];
      const url = `${this.base(projectId)}/issue-trees/${tree.id}`;
      return {
        overviewFacts: treeFacts(tree),
        components: tree.nodes.map((node: any) => item(node.id, url, node.label, { treeName: tree.name, ...node })),
        overviewUrl: url,
        overviewTitle: tree.name,
      };
    }
    return {
      overviewFacts: { trees: rows.map(treeFacts) },
      components: rows.map((tree) => item(tree.id, `${this.base(projectId)}/issue-trees/${tree.id}`, tree.name, treeFacts(tree))),
      overviewUrl: `${this.base(projectId)}/issue-trees`,
      overviewTitle: 'イシューツリー全体',
    };
  }

  private async tasks(projectId: string) {
    const rows: any[] = await this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { order: 'asc' }],
      include: {
        assigneeRole: { select: { name: true } }, subProject: { select: { name: true } },
        issueNode: { select: { label: true } }, risk: { select: { code: true, event: true } },
        gapItem: { select: { businessArea: true, gapDescription: true } },
        attachments: {
          select: { id: true, filename: true, displayName: true, mimeType: true },
          orderBy: { order: 'asc' },
        },
      },
    } as any);
    const url = `${this.base(projectId)}/tasks`;
    const facts = (row: any) => ({
      title: row.title, description: row.description, status: row.status, priority: row.priority,
      issueType: row.issueType, parentId: row.parentId, assigneeName: row.assigneeName,
      assigneeRole: row.assigneeRole?.name, subProject: row.subProject?.name, progress: row.progress,
      startDate: row.startDate, dueDate: row.dueDate, estimatedHours: row.estimatedHours,
      milestone: row.milestone, acceptanceCriteria: row.acceptanceCriteria,
      issue: row.issueNode?.label, risk: row.risk, gap: row.gapItem, updatedAt: row.updatedAt,
    });
    return this.collection(
      rows,
      url,
      'タスク全体',
      facts,
      (row) => row.title,
      (row) => `${url}/${row.id}`,
      (row) => this.attachmentFiles(row.attachments),
    );
  }

  private async stakeholders(projectId: string) {
    const rows: any[] = await this.prisma.stakeholder.findMany({
      where: { projectId }, orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: { subProjectAssignments: { include: { subProject: { select: { name: true } } } } },
    } as any);
    const url = `${this.base(projectId)}/stakeholder-management`;
    const facts = (row: any) => ({
      name: row.name, affiliation: row.affiliation, role: row.role, interest: row.interest,
      concern: row.concern, influence: row.influence, support: row.support, engagement: row.engagement,
      reportFrequency: row.reportFrequency, contactMethod: row.contactMethod, owner: row.owner,
      side: row.side, assignments: row.subProjectAssignments, note: row.note, updatedAt: row.updatedAt,
    });
    return this.collection(rows, url, 'ステークホルダー全体', facts, (row) => row.name);
  }

  private async risks(projectId: string) {
    const rows: any[] = await this.prisma.risk.findMany({
      where: { projectId }, orderBy: [{ order: 'asc' }, { updatedAt: 'desc' }],
      include: {
        category: { select: { name: true } }, subProject: { select: { name: true } },
        ownerStakeholder: { select: { name: true } }, reviewMeeting: { select: { name: true } },
      },
    } as any);
    const url = `${this.base(projectId)}/risk-management`;
    const facts = (row: any) => ({
      code: row.code, event: row.event, type: row.type, category: row.category?.name,
      probability: row.probability, impact: row.impact, probabilityScore: row.probabilityScore,
      impactScore: row.impactScore, priority: row.priority, status: row.status, lifecycle: row.lifecycle,
      owner: row.ownerStakeholder?.name || row.owner, countermeasure: row.countermeasure,
      responsePlan: row.responsePlan, contingencyPlan: row.contingencyPlan, trigger: row.trigger,
      deadline: row.deadline, reviewMeeting: row.reviewMeeting?.name, updatedAt: row.updatedAt,
    });
    return this.collection(rows, url, 'リスク全体', facts, (row) => row.code || row.event || 'リスク');
  }

  private async kpis(projectId: string) {
    const rows: any[] = await this.prisma.kpi.findMany({
      where: { projectId }, orderBy: [{ category: 'asc' }, { order: 'asc' }],
      include: {
        flow: { select: { name: true } }, asisFlow: { select: { name: true } },
        tobeFlow: { select: { name: true } }, system: { select: { name: true } },
        ownerRole: { select: { name: true } },
        informationLinks: { include: { informationType: { select: { name: true, category: true } } } },
      },
    } as any);
    const facts = (row: any) => ({
      name: row.name, category: row.category, description: row.description, definition: row.definition,
      unit: row.unit, baselineValue: row.baselineValue, targetValue: row.targetValue,
      currentValue: row.currentValue, direction: row.direction, frequency: row.frequency,
      measurementMethod: row.measurementMethod, status: row.status, flow: row.flow?.name,
      asisFlow: row.asisFlow?.name, tobeFlow: row.tobeFlow?.name, system: row.system?.name,
      ownerRole: row.ownerRole?.name, informationTypes: row.informationLinks, updatedAt: row.updatedAt,
    });
    const url = `${this.base(projectId)}/business-kpi`;
    return this.collection(rows, url, 'KPI全体', facts, (row) => row.name, (row) =>
      `${this.base(projectId)}/${row.category === 'AI_QUALITY' ? 'ai-accuracy' : 'business-kpi'}`,
    );
  }

  private async systems(projectId: string) {
    const rows: any[] = await this.prisma.system.findMany({
      where: { projectId }, orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: { subProject: { select: { name: true } }, roles: { select: { name: true, type: true, responsibility: true } } },
    } as any);
    const url = `${this.base(projectId)}/systems`;
    const facts = (row: any) => ({
      name: row.name, kind: row.kind, description: row.description,
      subProject: row.subProject?.name, roles: row.roles, updatedAt: row.updatedAt,
    });
    return this.collection(rows, url, 'システム全体', facts, (row) => row.name);
  }

  private async dataCatalog(projectId: string) {
    const [tables, objects]: [any[], any[]] = await Promise.all([
      this.prisma.table.findMany({
        where: { projectId }, orderBy: { name: 'asc' },
        include: { columns: { orderBy: { order: 'asc' } }, statuses: true, dataObject: { select: { name: true } }, informationType: { select: { name: true, category: true } } },
      } as any),
      this.prisma.dataObject.findMany({
        where: { projectId }, orderBy: [{ order: 'asc' }, { name: 'asc' }],
        include: { subProject: { select: { name: true } }, outRelations: true, inRelations: true },
      } as any),
    ]);
    const base = this.base(projectId);
    const tableItems = tables.map((row) => item(`table:${row.id}`, `${base}/catalog/${row.id}`, row.displayName || row.name, {
      kind: 'TABLE', name: row.name, displayName: row.displayName, description: row.description,
      tags: row.tags, dataObject: row.dataObject?.name, informationType: row.informationType,
      columns: row.columns, statuses: row.statuses, updatedAt: row.updatedAt,
    }));
    const objectItems = objects.map((row) => item(`object:${row.id}`, `${base}/object-map`, row.name, {
      kind: 'DATA_OBJECT', name: row.name, description: row.description,
      subProject: row.subProject?.name, outgoingRelations: row.outRelations,
      incomingRelations: row.inRelations, updatedAt: row.updatedAt,
    }));
    return {
      overviewFacts: { tables: tableItems.map((x) => x.facts), dataObjects: objectItems.map((x) => x.facts) },
      components: [...tableItems, ...objectItems],
      overviewUrl: `${base}/catalog`,
      overviewTitle: 'データカタログ／オブジェクト全体',
    };
  }

  private async meetings(projectId: string) {
    const [meetings, occurrences, documents]: [any[], any[], any[]] = await Promise.all([
      this.prisma.meeting.findMany({
        where: { projectId }, orderBy: [{ order: 'asc' }, { name: 'asc' }],
        include: { owner: { select: { name: true } }, stakeholders: { include: { stakeholder: { select: { name: true } } } }, subProjects: { include: { subProject: { select: { name: true } } } } },
      } as any),
      this.prisma.meetingOccurrence.findMany({
        where: { projectId }, orderBy: [{ heldAt: 'desc' }, { createdAt: 'desc' }],
        include: { meeting: { select: { name: true } } },
      } as any),
      this.prisma.meetingDocument.findMany({
        where: { projectId }, orderBy: [{ order: 'asc' }, { updatedAt: 'desc' }],
        include: { meeting: { select: { name: true } } },
      } as any),
    ]);
    const base = this.base(projectId);
    const meetingItems = meetings.map((row) => item(`meeting:${row.id}`, `${base}/meetings`, row.name, {
      kind: 'MEETING', name: row.name, purpose: row.purpose, frequency: row.frequency,
      dayTime: row.dayTime, attendees: row.requiredAttendees, agendaTemplate: row.agendaTemplate,
      decisionMaker: row.decisionMaker, owner: row.owner?.name, status: row.status, goal: row.goal,
      stakeholders: row.stakeholders, subProjects: row.subProjects, updatedAt: row.updatedAt,
    }));
    const occurrenceItems = occurrences.map((row) => item(`occurrence:${row.id}`, `${base}/meeting-occurrences`, row.title, {
      kind: 'OCCURRENCE', meeting: row.meeting?.name, heldAt: row.heldAt, attendees: row.attendees,
      agenda: row.agenda, minutes: row.minutes, decisions: row.decisions,
      nextActions: row.nextActions, source: row.source, updatedAt: row.updatedAt,
    }));
    const documentItems = documents.map((row) => {
      const title = row.title || row.fetchedTitle || '会議資料';
      return item(`document:${row.id}`, `${base}/meeting-documents?doc=${row.id}`, title, {
        kind: 'DOCUMENT', meeting: row.meeting?.name, documentKind: row.kind,
        fetchedTitle: row.fetchedTitle, content: row.fetchedContent, sourceUrl: row.googleDocUrl,
        fetchedAt: row.fetchedAt, updatedAt: row.updatedAt,
      }, {}, row.googleDocUrl ? [{
        kind: 'EXTERNAL', label: title, url: row.googleDocUrl,
        filename: null, mimeType: row.fetchedMime ?? null,
      }] : []);
    });
    const components = [...meetingItems, ...occurrenceItems, ...documentItems];
    return {
      overviewFacts: { meetings: meetingItems.map((x) => x.facts), occurrences: occurrenceItems.map((x) => x.facts), documents: documentItems.map((x) => x.facts) },
      components,
      overviewUrl: `${base}/meetings`,
      overviewTitle: '会議・議事録全体',
    };
  }

  private collection(
    rows: any[],
    overviewUrl: string,
    overviewTitle: string,
    facts: (row: any) => JsonRecord,
    title: (row: any) => string,
    url: (row: any) => string = () => overviewUrl,
    sourceFiles: (row: any) => RagSourceFile[] = () => [],
  ) {
    const components = rows.map((row) =>
      item(row.id, url(row), title(row), facts(row), {}, sourceFiles(row)),
    );
    return { overviewFacts: { items: components.map((component) => component.facts) }, components, overviewUrl, overviewTitle };
  }

  private empty(overviewUrl: string, overviewTitle: string) {
    return { overviewFacts: {}, components: [] as RagSourceItem[], overviewUrl, overviewTitle };
  }

  private attachmentFiles(
    attachments: Array<{ id: string; filename: string; displayName: string | null; mimeType: string }> = [],
  ): RagSourceFile[] {
    return attachments.map((attachment) => ({
      kind: 'FILE',
      label: attachment.displayName || attachment.filename,
      url: `/api/attachments/${attachment.id}/file`,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
    }));
  }
}
