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

export interface UpdateIssueNodeInput {
  userId: string;
  principal: AccessPrincipal;
  treeId: string;
  nodeId: string;
  label?: string;
  kind?: IssueNodeKind;
  evidence?: string | null;
  verification?: NodeVerification;
  recommendation?: NodeRecommendation;
  parentId?: string | null;
  order?: number;
  rootCauseNodeId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface UpdateIssueNodeOutput {
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
 * イシューノード更新ユースケース
 */
@Injectable()
export class UpdateIssueNodeUseCase {
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

  async execute(input: UpdateIssueNodeInput): Promise<UpdateIssueNodeOutput> {
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

    // 4.5 プロジェクト単位 RBAC: ノード更新は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      tree.projectId,
      'edit',
    );

    // 5. ドメインロジックで更新
    if (input.label !== undefined) {
      node.updateLabel(input.label);
    }
    if (input.kind !== undefined) {
      node.setKind(input.kind);
    }
    if (input.evidence !== undefined) {
      node.updateEvidence(input.evidence);
    }
    if (input.verification !== undefined) {
      node.setVerification(input.verification);
    }
    if (input.recommendation !== undefined) {
      node.setRecommendation(input.recommendation);
    }
    if (input.rootCauseNodeId !== undefined) {
      node.setRootCauseNodeId(input.rootCauseNodeId);
    }
    if (input.metadata !== undefined) {
      node.updateMetadata(input.metadata);
    }
    if (input.parentId !== undefined) {
      let depth = 0;
      if (input.parentId) {
        if (input.parentId === node.id) {
          throw new ValidationError('A node cannot be its own parent');
        }
        const parent = await this.issueNodeRepository.findById(input.parentId);
        if (!parent) {
          throw new EntityNotFoundError('IssueNode', input.parentId);
        }
        if (parent.treeId !== tree.id) {
          throw new ValidationError('Parent node belongs to a different tree');
        }
        depth = parent.depth + 1;
      }
      node.reparent(input.parentId, depth);
    }
    if (input.order !== undefined) {
      node.reorder(input.order);
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
