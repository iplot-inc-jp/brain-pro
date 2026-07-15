import { Inject, Injectable } from '@nestjs/common';
import {
  IssueTreeType,
  IssueTreePattern,
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
} from '../../../domain';
import {
  AccessPrincipal,
  ProjectAccessService,
} from '../../../infrastructure/services/project-access.service';

export interface GetIssueTreeInput {
  userId: string;
  principal: AccessPrincipal;
  treeId: string;
}

export interface IssueNodeDto {
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
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueTreeWithNodesDto {
  id: string;
  projectId: string;
  type: IssueTreeType;
  pattern: IssueTreePattern;
  name: string;
  rootQuestion: string | null;
  createdAt: Date;
  updatedAt: Date;
  nodes: IssueNodeDto[];
}

/**
 * イシューツリー詳細取得ユースケース（ノードを含む）
 */
@Injectable()
export class GetIssueTreeUseCase {
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

  async execute(input: GetIssueTreeInput): Promise<IssueTreeWithNodesDto> {
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

    // 3-2. プロジェクト単位 RBAC（会社スコープ）: 読取のため view 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      tree.projectId,
      'view',
    );

    // 4. ノード取得（depth, order でソート済み）
    const nodes = await this.issueNodeRepository.findByTreeId(tree.id);

    // 5. DTOに変換して返却
    return {
      id: tree.id,
      projectId: tree.projectId,
      type: tree.type,
      pattern: tree.pattern,
      name: tree.name,
      rootQuestion: tree.rootQuestion,
      createdAt: tree.createdAt,
      updatedAt: tree.updatedAt,
      nodes: nodes.map((node) => ({
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
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      })),
    };
  }
}
