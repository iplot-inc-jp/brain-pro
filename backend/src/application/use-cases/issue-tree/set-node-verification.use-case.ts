import { Inject, Injectable } from '@nestjs/common';
import {
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

export interface SetNodeVerificationInput {
  userId: string;
  principal: AccessPrincipal;
  treeId: string;
  nodeId: string;
  verification: NodeVerification;
  evidence?: string | null;
}

export interface SetNodeVerificationOutput {
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
 * イシューノード検証状態設定ユースケース
 */
@Injectable()
export class SetNodeVerificationUseCase {
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

  async execute(
    input: SetNodeVerificationInput,
  ): Promise<SetNodeVerificationOutput> {
    // 1. ノード存在確認
    const node = await this.issueNodeRepository.findById(input.nodeId);
    if (!node) {
      throw new EntityNotFoundError('IssueNode', input.nodeId);
    }
    if (node.treeId !== input.treeId) {
      throw new ValidationError('Node does not belong to the specified tree');
    }

    // 2. ツリー存在確認
    const tree = await this.issueTreeRepository.findById(node.treeId);
    if (!tree) {
      throw new EntityNotFoundError('IssueTree', node.treeId);
    }

    // 3. プロジェクト存在確認
    const project = await this.projectRepository.findById(tree.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', tree.projectId);
    }

    // 4. 組織メンバー確認（プロジェクトスコープ認可）
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You do not have access to this project');
    }

    // 4.5 プロジェクト単位 RBAC: 検証状態の設定は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      tree.projectId,
      'edit',
    );

    // 5. ドメインロジックで更新
    node.setVerification(input.verification);
    if (input.evidence !== undefined) {
      node.updateEvidence(input.evidence);
    }

    // 6. 永続化
    await this.issueNodeRepository.save(node);

    // 7. 出力返却
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
