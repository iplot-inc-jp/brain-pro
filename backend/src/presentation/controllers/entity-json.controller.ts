import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import {
  EntityNotFoundError,
  ForbiddenError,
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../domain';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import {
  EntityJsonService,
  FlowBundle,
  DfdBundle,
  IssueTreeBundle,
} from '../../infrastructure/services/entity-json.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { Public } from '../decorators/public.decorator';

// PUT/POST body は self-contained Bundle JSON。
// 形（FlowBundle | DfdBundle | IssueTreeBundle）は service が解釈・検証するため、
// ここでは緩く Record<string, unknown> として受ける（version 不一致は service が弾く）。
type BundleBody = Record<string, unknown>;

/**
 * 単一エンティティ（業務フロー / DFD / イシューツリー）の「丸ごと自己完結 JSON」I/O。
 *
 * 認可:
 *  - /projects/:projectId/... は ProjectAccessGuard が view|edit を判定する。
 *  - /business-flows/:id/json, /issue-trees/:id/json は params が :id のためガードが
 *    projectId を解決できない（素通り）。各ハンドラで対象→projectId を引いてから
 *    org メンバーシップ + ProjectAccessService(view|edit) を明示的に強制する。
 *  - GET /api/entity-json/schema は @Public（AI が事前に形式取得できる）。
 */
@ApiTags('エンティティJSON I/O')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class EntityJsonController {
  constructor(
    private readonly entityJson: EntityJsonService,
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
  ) {}

  // ========================================================================
  // 業務フロー
  // ========================================================================

  @Get('business-flows/:id/json')
  @ApiOperation({ summary: '業務フローを自己完結 JSON（FlowBundle）で取得' })
  @ApiParam({ name: 'id', description: '業務フローID' })
  async getFlowJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<FlowBundle> {
    const result = await this.entityJson.getFlowBundle(id);
    if (!result) throw new EntityNotFoundError('BusinessFlow', id);
    await this.assertProjectAccess(result.projectId, user, 'view');
    return result.bundle;
  }

  @Put('business-flows/:id/json')
  @ApiOperation({
    summary: '業務フローの中身を FlowBundle で丸ごと置換（nodes/edges/定義/注釈/infoリンク）',
  })
  @ApiParam({ name: 'id', description: '業務フローID' })
  async putFlowJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() body: BundleBody,
  ): Promise<FlowBundle> {
    const flow = await this.prisma.businessFlow.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!flow) throw new EntityNotFoundError('BusinessFlow', id);
    await this.assertProjectAccess(flow.projectId, user, 'edit');
    await this.entityJson.replaceFlowFromBundle(id, body as unknown as FlowBundle);
    const result = await this.entityJson.getFlowBundle(id);
    return result!.bundle;
  }

  @Post('projects/:projectId/flows/json')
  @ApiOperation({ summary: '業務フローを FlowBundle から新規作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async createFlowJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() body: BundleBody,
  ): Promise<FlowBundle> {
    await this.assertProjectAccess(projectId, user, 'edit');
    const { flowId } = await this.entityJson.createFlowFromBundle(
      projectId,
      body as unknown as FlowBundle,
    );
    const result = await this.entityJson.getFlowBundle(flowId);
    return result!.bundle;
  }

  // ========================================================================
  // DFD
  // ========================================================================

  @Get('business-flows/:flowId/dfd/json')
  @ApiOperation({ summary: '第2レベルDFDを DfdBundle で取得（get-or-create）' })
  @ApiParam({ name: 'flowId', description: '業務フローID' })
  async getFlowDfdJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
  ): Promise<DfdBundle> {
    const flow = await this.prisma.businessFlow.findUnique({
      where: { id: flowId },
      select: { projectId: true },
    });
    if (!flow) throw new EntityNotFoundError('BusinessFlow', flowId);
    await this.assertProjectAccess(flow.projectId, user, 'view');
    const { bundle } = await this.entityJson.getDfdBundle(flow.projectId, flowId);
    return bundle;
  }

  @Put('business-flows/:flowId/dfd/json')
  @ApiOperation({ summary: '第2レベルDFDを DfdBundle で丸ごと置換' })
  @ApiParam({ name: 'flowId', description: '業務フローID' })
  async putFlowDfdJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() body: BundleBody,
  ): Promise<DfdBundle> {
    const flow = await this.prisma.businessFlow.findUnique({
      where: { id: flowId },
      select: { projectId: true },
    });
    if (!flow) throw new EntityNotFoundError('BusinessFlow', flowId);
    await this.assertProjectAccess(flow.projectId, user, 'edit');
    await this.entityJson.replaceDfdFromBundle(
      flow.projectId,
      flowId,
      body as unknown as DfdBundle,
    );
    const { bundle } = await this.entityJson.getDfdBundle(flow.projectId, flowId);
    return bundle;
  }

  @Get('projects/:projectId/dfd/json')
  @ApiOperation({ summary: '第1レベルDFDを DfdBundle で取得（get-or-create）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async getProjectDfdJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<DfdBundle> {
    await this.assertProjectAccess(projectId, user, 'view');
    const { bundle } = await this.entityJson.getDfdBundle(projectId, null);
    return bundle;
  }

  @Put('projects/:projectId/dfd/json')
  @ApiOperation({ summary: '第1レベルDFDを DfdBundle で丸ごと置換' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async putProjectDfdJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() body: BundleBody,
  ): Promise<DfdBundle> {
    await this.assertProjectAccess(projectId, user, 'edit');
    await this.entityJson.replaceDfdFromBundle(
      projectId,
      null,
      body as unknown as DfdBundle,
    );
    const { bundle } = await this.entityJson.getDfdBundle(projectId, null);
    return bundle;
  }

  // ========================================================================
  // イシューツリー
  // ========================================================================

  @Get('issue-trees/:id/json')
  @ApiOperation({ summary: 'イシューツリーを自己完結 JSON（IssueTreeBundle）で取得' })
  @ApiParam({ name: 'id', description: 'イシューツリーID' })
  async getIssueTreeJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<IssueTreeBundle> {
    const result = await this.entityJson.getIssueTreeBundle(id);
    if (!result) throw new EntityNotFoundError('IssueTree', id);
    await this.assertProjectAccess(result.projectId, user, 'view');
    return result.bundle;
  }

  @Put('issue-trees/:id/json')
  @ApiOperation({ summary: 'イシューツリーのノードを IssueTreeBundle で丸ごと置換' })
  @ApiParam({ name: 'id', description: 'イシューツリーID' })
  async putIssueTreeJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() body: BundleBody,
  ): Promise<IssueTreeBundle> {
    const tree = await this.prisma.issueTree.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!tree) throw new EntityNotFoundError('IssueTree', id);
    await this.assertProjectAccess(tree.projectId, user, 'edit');
    await this.entityJson.replaceIssueTreeFromBundle(
      id,
      body as unknown as IssueTreeBundle,
    );
    const result = await this.entityJson.getIssueTreeBundle(id);
    return result!.bundle;
  }

  @Post('projects/:projectId/issue-trees/json')
  @ApiOperation({ summary: 'イシューツリーを IssueTreeBundle から新規作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async createIssueTreeJson(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() body: BundleBody,
  ): Promise<IssueTreeBundle> {
    await this.assertProjectAccess(projectId, user, 'edit');
    const { treeId } = await this.entityJson.createIssueTreeFromBundle(
      projectId,
      body as unknown as IssueTreeBundle,
    );
    const result = await this.entityJson.getIssueTreeBundle(treeId);
    return result!.bundle;
  }

  /**
   * project -> organization メンバーシップ + プロジェクト RBAC（view|edit）を強制する。
   * ProjectAccessGuard が projectId を解決できない :id ルートのための明示チェック。
   */
  private async assertProjectAccess(
    projectId: string,
    principal: CurrentUserPayload,
    required: 'view' | 'edit',
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project) throw new EntityNotFoundError('Project', projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, principal.id))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    await this.projectAccess.assertPrincipalAccess(principal, projectId, required);
  }
}

/**
 * 機械可読 JSON Schema（draft-07）。AI が事前に形式取得できるよう @Public。
 * GET /api/entity-json/schema → { version, flow, dfd, issueTree }
 */
@ApiTags('エンティティJSON I/O')
@Controller('entity-json')
export class EntityJsonSchemaController {
  constructor(private readonly entityJson: EntityJsonService) {}

  @Get('schema')
  @Public()
  @ApiOperation({
    summary: '3エンティティ（flow/dfd/issueTree）の機械可読 JSON Schema（draft-07）',
  })
  getSchema(): Record<string, unknown> {
    return this.entityJson.getEntitySchemas();
  }
}
