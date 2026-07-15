import { Inject, Injectable } from '@nestjs/common';
import {
  IssueNode,
  IssueNodeKind,
  NodeVerification,
  NodeRecommendation,
  IIssueTreeRepository,
  ISSUE_TREE_REPOSITORY,
  IIssueNodeRepository,
  ISSUE_NODE_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
  ValidationError,
} from '../../../domain';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface AddIssueNodeInput {
  userId: string;
  principal: AccessPrincipal;
  treeId: string;
  parentId?: string | null;
  order?: number;
  label: string;
  kind?: IssueNodeKind;
  verification?: NodeVerification;
  recommendation?: NodeRecommendation;
  evidence?: string | null;
  rootCauseNodeId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AddIssueNodeOutput {
  id: string;
  treeId: string;
  parentId: string | null;
  depth: number;
  order: number;
  label: string;
  kind: IssueNodeKind;
  verification: NodeVerification;
  recommendation: NodeRecommendation;
  evidence: string | null;
  rootCauseNodeId: string | null;
  metadata: Record<string, unknown>;
}

/**
 * イシューノード追加ユースケース
 */
@Injectable()
export class AddIssueNodeUseCase {
  constructor(
    @Inject(ISSUE_TREE_REPOSITORY)
    private readonly issueTreeRepository: IIssueTreeRepository,
    @Inject(ISSUE_NODE_REPOSITORY)
    private readonly issueNodeRepository: IIssueNodeRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: AddIssueNodeInput): Promise<AddIssueNodeOutput> {
    // 1. ツリー存在確認
    const tree = await this.issueTreeRepository.findById(input.treeId);
    if (!tree) {
      throw new EntityNotFoundError('IssueTree', input.treeId);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(tree.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', tree.projectId);
    }

    // 3. 組織メンバー確認（プロジェクトスコープ認可）
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You do not have access to this project');
    }

    // 3.5 プロジェクト単位 RBAC: ノード追加は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      tree.projectId,
      'edit',
    );

    // 4. 親ノードの解決（depth算出 / 同一ツリー検証）
    let depth = 0;
    if (input.parentId) {
      const parent = await this.issueNodeRepository.findById(input.parentId);
      if (!parent) {
        throw new EntityNotFoundError('IssueNode', input.parentId);
      }
      if (parent.treeId !== tree.id) {
        throw new ValidationError('Parent node belongs to a different tree');
      }
      depth = parent.depth + 1;
    }

    // 5. ID生成
    const id = this.issueNodeRepository.generateId();

    // 6. エンティティ生成（ドメインロジック）
    const node = IssueNode.create(
      {
        treeId: tree.id,
        parentId: input.parentId ?? null,
        depth,
        order: input.order,
        label: input.label,
        kind: input.kind,
        verification: input.verification,
        recommendation: input.recommendation,
        evidence: input.evidence,
        rootCauseNodeId: input.rootCauseNodeId,
        metadata: input.metadata,
      },
      id,
    );

    // 7. 永続化
    await this.issueNodeRepository.save(node);

    // 8. 出力返却
    return {
      id: node.id,
      treeId: node.treeId,
      parentId: node.parentId,
      depth: node.depth,
      order: node.order,
      label: node.label,
      kind: node.kind,
      verification: node.verification,
      recommendation: node.recommendation,
      evidence: node.evidence,
      rootCauseNodeId: node.rootCauseNodeId,
      metadata: node.metadata,
    };
  }
}
