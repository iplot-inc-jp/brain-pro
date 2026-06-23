import { Inject, Injectable } from '@nestjs/common';
import {
  Task,
  ITaskRepository,
  TASK_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  IIssueNodeRepository,
  ISSUE_NODE_REPOSITORY,
  IIssueTreeRepository,
  ISSUE_TREE_REPOSITORY,
  IssueNodeKind,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';

/** リポジトリの戻り値からノード型を導出（IssueNode entity を直接 import せずに型を得る）。 */
type IssueNodeLike = Awaited<
  ReturnType<IIssueNodeRepository['findByTreeId']>
>[number];

/** タスク化する「打ち手・行動」ノードの種別。 */
const ACTIONABLE_KINDS: IssueNodeKind[] = ['ACTION', 'COUNTERMEASURE', 'OPTION'];

export interface GenerateTasksFromIssueTreeInput {
  userId: string;
  projectId: string;
  issueTreeId: string;
}

export interface GenerateTasksFromIssueTreeResult {
  /** 今回新規作成したタスク数。 */
  created: number;
  /** 既にタスク化済みでスキップしたノード数。 */
  skipped: number;
}

/**
 * イシューツリー（課題/調査/打ち手ツリー）1本から「一旦のガントチャート」を自動生成する。
 *
 * 打ち手・行動ノード（ACTION / COUNTERMEASURE / OPTION）をタスク化し、
 *  - ラベル → タスク名
 *  - そのノード → 論点(issueNodeId)に自動紐付け
 *  - ツリーの親子 → タスクの親子（直近の対象ノード祖先へ引き継ぎ）
 *  - 日付は空（後から調整）
 * とする。既にタスク化済みのノードはスキップし、再実行で増殖しない。
 */
@Injectable()
export class GenerateTasksFromIssueTreeUseCase {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly taskRepository: ITaskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(ISSUE_NODE_REPOSITORY)
    private readonly issueNodeRepository: IIssueNodeRepository,
    @Inject(ISSUE_TREE_REPOSITORY)
    private readonly issueTreeRepository: IIssueTreeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: GenerateTasksFromIssueTreeInput,
  ): Promise<GenerateTasksFromIssueTreeResult> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) throw new EntityNotFoundError('Project', input.projectId);
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You do not have access to this project');
    }
    await this.projectAccess.assertProjectAccess(
      input.projectId,
      input.userId,
      'edit',
    );

    const tree = await this.issueTreeRepository.findById(input.issueTreeId);
    if (!tree || tree.projectId !== input.projectId) {
      throw new EntityNotFoundError('IssueTree', input.issueTreeId);
    }

    const nodes = await this.issueNodeRepository.findByTreeId(tree.id);
    const nodeById = new Map<string, IssueNodeLike>(
      nodes.map((n) => [n.id, n]),
    );

    // 既に論点として紐付くタスクがあるノードは重複生成しない。
    const existing = await this.taskRepository.findByProjectId(input.projectId);
    const linkedNodeIds = new Set(
      existing
        .map((t) => t.issueNodeId)
        .filter((x): x is string => Boolean(x)),
    );

    const isActionable = (n: IssueNodeLike): boolean =>
      ACTIONABLE_KINDS.includes(n.kind) && n.label.trim().length > 0;

    const targets = nodes.filter(
      (n) => isActionable(n) && !linkedNodeIds.has(n.id),
    );
    const skipped = nodes.filter(
      (n) => isActionable(n) && linkedNodeIds.has(n.id),
    ).length;

    const targetIds = new Set(targets.map((n) => n.id));

    // タスク親子に引き継ぐため、最も近い「対象ノード」の祖先を辿る。
    const nearestTargetAncestor = (n: IssueNodeLike): string | null => {
      let pid = n.parentId;
      const seen = new Set<string>();
      while (pid && !seen.has(pid)) {
        seen.add(pid);
        if (targetIds.has(pid)) return pid;
        pid = nodeById.get(pid)?.parentId ?? null;
      }
      return null;
    };

    const depthOf = (n: IssueNodeLike): number => {
      let d = 0;
      let pid = n.parentId;
      const seen = new Set<string>();
      while (pid && !seen.has(pid)) {
        seen.add(pid);
        d++;
        pid = nodeById.get(pid)?.parentId ?? null;
      }
      return d;
    };

    // 親タスクが先に存在するよう、浅い順 → order 順で生成する。
    const ordered = [...targets].sort(
      (a, b) => depthOf(a) - depthOf(b) || a.order - b.order,
    );

    const nodeIdToTaskId = new Map<string, string>();
    let created = 0;
    for (const node of ordered) {
      const ancestorNodeId = nearestTargetAncestor(node);
      const parentId = ancestorNodeId
        ? nodeIdToTaskId.get(ancestorNodeId) ?? null
        : null;
      const id = this.taskRepository.generateId();
      const task = Task.create(
        {
          projectId: input.projectId,
          parentId,
          title: node.label.trim(),
          issueNodeId: node.id,
          status: 'OPEN',
          priority: 'MEDIUM',
          order: node.order,
        },
        id,
      );
      await this.taskRepository.save(task);
      nodeIdToTaskId.set(node.id, task.id);
      created++;
    }

    return { created, skipped };
  }
}
