import { RagFeatureType } from './rag.types';
import { RagSourceService } from './rag-source.service';

const at = new Date('2026-07-16T00:00:00.000Z');

function makePrisma() {
  return {
    project: { findUnique: jest.fn(async () => ({ id: 'p1', name: '刷新PJ' })) },
    businessFlow: {
      findMany: jest.fn(async () => [
        {
          id: 'f1', projectId: 'p1', name: '受注', description: '受注処理', kind: 'ASIS',
          confidence: 'CONFIRMED', parentId: null, depth: 0, updatedAt: at,
          definition: { purpose: '注文を受ける', input: '注文書', output: '受注票' },
          nodes: [{ id: 'n1', label: '受付', type: 'PROCESS', description: '内容確認', order: 1, role: { name: '営業' }, informationLinks: [] }],
          edges: [], assignees: [],
        },
      ]),
    },
    requirement: {
      findMany: jest.fn(async () => [
        { id: 'req1', code: 'REQ-1', title: '検索', description: '検索できる', type: 'FUNCTIONAL', priority: 'HIGH', status: 'APPROVED', parentId: null, depth: 0, order: 0, updatedAt: at, flowMappings: [] },
      ]),
    },
    issueTree: {
      findMany: jest.fn(async () => [
        { id: 'tree1', name: '売上課題', type: 'WHY', pattern: 'WHY', rootQuestion: 'なぜ売上が低いか', updatedAt: at, nodes: [{ id: 'in1', parentId: null, depth: 0, order: 0, label: '失注が多い', kind: 'ISSUE', verification: 'CONFIRMED', recommendation: 'NA', evidence: 'CRM集計', updatedAt: at }] },
      ]),
    },
    task: {
      findMany: jest.fn(async () => [
        { id: 'task1', title: '要件確認', description: '担当者と確認', status: 'OPEN', priority: 'HIGH', issueType: 'TASK', parentId: null, assigneeName: '田中', progress: 20, dueDate: at, acceptanceCriteria: '承認済み', updatedAt: at, assigneeRole: { name: 'PM' }, subProject: null, issueNode: null, risk: null, gapItem: null },
      ]),
    },
    stakeholder: {
      findMany: jest.fn(async () => [
        { id: 's1', name: '田中', affiliation: '営業部', role: '責任者', interest: '売上', concern: '工数', influence: 'HIGH', support: 'SUPPORTIVE', engagement: '週次共有', side: 'INTERNAL', updatedAt: at, subProjectAssignments: [] },
      ]),
    },
    risk: {
      findMany: jest.fn(async () => [
        { id: 'risk1', code: 'R-1', event: '移行遅延', type: 'リスク', probability: '高', impact: '高', probabilityScore: 4, impactScore: 5, priority: 'HIGH', status: 'OPEN', lifecycle: 'ANALYZED', owner: '田中', countermeasure: '段階移行', responsePlan: '予備日確保', trigger: '遅延3日', updatedAt: at, category: { name: '技術' }, subProject: null, ownerStakeholder: { name: '田中' }, reviewMeeting: null },
      ]),
    },
    kpi: {
      findMany: jest.fn(async () => [
        { id: 'k1', name: '処理時間', category: 'BUSINESS', description: '受注処理時間', definition: '完了-開始', unit: '分', baselineValue: 30, targetValue: 10, currentValue: 25, direction: 'DECREASE', frequency: 'MONTHLY', measurementMethod: 'ログ', status: 'ACTIVE', updatedAt: at, flow: { name: '受注' }, asisFlow: null, tobeFlow: null, system: null, ownerRole: { name: '営業' }, informationLinks: [] },
      ]),
    },
    system: {
      findMany: jest.fn(async () => [
        { id: 'sys1', name: '販売管理', kind: 'PERIPHERAL', description: '受注を管理', updatedAt: at, subProject: { name: '販売' }, roles: [{ name: '営業' }] },
      ]),
    },
    table: {
      findMany: jest.fn(async () => [
        { id: 'tbl1', name: 'orders', displayName: '注文', description: '注文台帳', tags: ['受注'], updatedAt: at, dataObject: { name: '注文' }, informationType: null, columns: [{ id: 'col1', name: 'id', displayName: 'ID', dataType: 'UUID', description: null, isPrimaryKey: true, isForeignKey: false, isNullable: false, isUnique: true, foreignKeyTable: null, foreignKeyColumn: null, order: 0 }], statuses: [] },
      ]),
    },
    dataObject: {
      findMany: jest.fn(async () => [
        { id: 'obj1', name: '注文', description: '注文情報', updatedAt: at, subProject: { name: '販売' }, outRelations: [], inRelations: [] },
      ]),
    },
    meeting: {
      findMany: jest.fn(async () => [
        { id: 'm1', name: '週次会', purpose: '進捗確認', frequency: '週次', dayTime: '月曜', requiredAttendees: 'PM', agendaTemplate: '進捗', decisionMaker: '田中', status: 'ACTIVE', goal: '課題解消', updatedAt: at, owner: { name: '田中' }, stakeholders: [], subProjects: [] },
      ]),
    },
    meetingOccurrence: {
      findMany: jest.fn(async () => [
        { id: 'mo1', meetingId: 'm1', title: '7月定例', heldAt: at, attendees: '田中', agenda: '移行', minutes: '移行日を確認', decisions: '8月開始', nextActions: '計画更新', source: 'ipro', updatedAt: at, meeting: { name: '週次会' } },
      ]),
    },
    meetingDocument: {
      findMany: jest.fn(async () => [
        { id: 'md1', meetingId: 'm1', title: '移行計画', kind: 'GOOGLE_DOC', googleDocUrl: 'https://example.com', fetchedContent: '移行手順', fetchedTitle: '移行計画', fetchedAt: at, updatedAt: at, meeting: { name: '週次会' } },
      ]),
    },
  };
}

const cases: Array<[RagFeatureType, number, string]> = [
  ['BUSINESS_FLOW', 1, '/flows/f1'],
  ['REQUIREMENT', 1, '/requirements'],
  ['ISSUE_TREE', 1, '/issue-trees/tree1'],
  ['TASK', 1, '/tasks/task1'],
  ['STAKEHOLDER', 1, '/stakeholder-management'],
  ['RISK', 1, '/risk-management'],
  ['KPI', 1, '/business-kpi'],
  ['SYSTEM', 1, '/systems'],
  ['DATA_CATALOG', 2, '/catalog'],
  ['MEETING', 3, '/meetings'],
];

describe('RagSourceService', () => {
  it.each(cases)('%s を overview + component へ変換する', async (feature, count, urlPart) => {
    const prisma = makePrisma();
    const service = new RagSourceService(prisma as any);
    const bundle = await service.build('p1', feature);

    expect(bundle.featureType).toBe(feature);
    expect(bundle.targetKey).toBe('project');
    expect(bundle.overview.sourceKey).toBe(`project:${feature}`);
    expect(bundle.components).toHaveLength(count);
    expect(bundle.components.some((component) => component.sourceUrl.includes(urlPart))).toBe(true);
    expect(bundle.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('同じ入力は順序によらず同じ sourceHash になる', async () => {
    const prisma = makePrisma();
    const service = new RagSourceService(prisma as any);
    const first = await service.build('p1', 'TASK');
    const second = await service.build('p1', 'TASK');
    expect(first.sourceHash).toBe(second.sourceHash);
  });

  it('対象フローは projectId と id を同時に条件指定し、ノードをcomponentにする', async () => {
    const prisma = makePrisma();
    const bundle = await new RagSourceService(prisma as any).build('p1', 'BUSINESS_FLOW', 'f1');
    expect(prisma.businessFlow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1', id: 'f1' } }),
    );
    expect(bundle.targetKey).toBe('f1');
    expect(bundle.overview.sourceKey).toBe('f1');
    expect(bundle.components[0].sourceKey).toBe('n1');
  });

  it('プロジェクトに存在しない対象は空索引を作らず拒否する', async () => {
    const prisma = makePrisma();
    prisma.businessFlow.findMany.mockResolvedValueOnce([] as any);
    await expect(
      new RagSourceService(prisma as any).build('p1', 'BUSINESS_FLOW', 'outside-flow'),
    ).rejects.toThrow('データがありません');
  });
});
