import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  HttpException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import {
  CreateIssueTreeUseCase,
  GetIssueTreesUseCase,
  GetIssueTreeUseCase,
  UpdateIssueTreeUseCase,
  DeleteIssueTreeUseCase,
  AddIssueNodeUseCase,
  UpdateIssueNodeUseCase,
  DeleteIssueNodeUseCase,
  SetNodeVerificationUseCase,
  ListProjectIssueNodesUseCase,
  ProjectIssueNodeListItem,
} from '../../application';
import {
  CreateIssueTreeRequestDto,
  IssueTreeResponseDto,
  IssueTreeTypeDto,
  IssueTreePatternDto,
  IssueNodeKindDto,
  NodeVerificationDto,
  NodeRecommendationDto,
  UpdateIssueTreeRequestDto,
  AddIssueNodeRequestDto,
  UpdateIssueNodeRequestDto,
  SetNodeVerificationRequestDto,
  IssueNodeResponseDto,
  IssueTreeWithNodesResponseDto,
  ProjectIssueNodeListItemDto,
  SuggestIssueNodesRequestDto,
  SuggestIssueNodesResponseDto,
} from '../dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ClaudeService } from '../../infrastructure/services/claude.service';
import { CompanyKeyService } from '../../infrastructure/services/company-key.service';
import { IssueNodeKind } from '../../domain';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

@ApiTags('イシューツリー')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class IssueTreeController {
  constructor(
    private readonly createIssueTreeUseCase: CreateIssueTreeUseCase,
    private readonly getIssueTreesUseCase: GetIssueTreesUseCase,
    private readonly getIssueTreeUseCase: GetIssueTreeUseCase,
    private readonly updateIssueTreeUseCase: UpdateIssueTreeUseCase,
    private readonly deleteIssueTreeUseCase: DeleteIssueTreeUseCase,
    private readonly addIssueNodeUseCase: AddIssueNodeUseCase,
    private readonly updateIssueNodeUseCase: UpdateIssueNodeUseCase,
    private readonly deleteIssueNodeUseCase: DeleteIssueNodeUseCase,
    private readonly setNodeVerificationUseCase: SetNodeVerificationUseCase,
    private readonly listProjectIssueNodesUseCase: ListProjectIssueNodesUseCase,
    private readonly prisma: PrismaService,
    private readonly claudeService: ClaudeService,
    private readonly companyKeyService: CompanyKeyService,
  ) {}

  // ===========================================
  // イシューツリー
  // ===========================================

  @Get('projects/:projectId/issue-trees')
  @ApiOperation({ summary: 'イシューツリー一覧取得（任意で型フィルタ）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiQuery({ name: 'type', enum: IssueTreeTypeDto, required: false })
  @ApiResponse({ status: 200, description: '成功', type: [IssueTreeResponseDto] })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('type') type?: IssueTreeTypeDto,
  ): Promise<IssueTreeResponseDto[]> {
    const result = await this.getIssueTreesUseCase.execute({
      userId: user.id,
      projectId,
      type,
    });
    return result.map((tree) => ({
      ...tree,
      type: tree.type as IssueTreeTypeDto,
      pattern: tree.pattern as IssueTreePatternDto,
    }));
  }

  @Get('projects/:projectId/issue-nodes')
  @ApiOperation({
    summary:
      'プロジェクト横断のイシューノード一覧（タスク紐付けセレクタ用 / 任意で種別フィルタ）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiQuery({ name: 'kind', enum: IssueNodeKindDto, required: false })
  @ApiResponse({
    status: 200,
    description: '成功',
    type: [ProjectIssueNodeListItemDto],
  })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async listProjectNodes(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('kind') kind?: IssueNodeKindDto,
  ): Promise<ProjectIssueNodeListItemDto[]> {
    const result: ProjectIssueNodeListItem[] =
      await this.listProjectIssueNodesUseCase.execute({
        userId: user.id,
        projectId,
        kind,
      });
    return result.map((node) => ({
      ...node,
      kind: node.kind as IssueNodeKindDto,
    }));
  }

  @Post('projects/:projectId/issue-trees')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'イシューツリー作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功', type: IssueTreeResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateIssueTreeRequestDto,
  ): Promise<IssueTreeResponseDto> {
    const result = await this.createIssueTreeUseCase.execute({
      userId: user.id,
      projectId,
      type: dto.type ?? IssueTreeTypeDto.WHY,
      pattern: dto.pattern ?? IssueTreePatternDto.ISSUE_POINT,
      name: dto.name,
      rootQuestion: dto.rootQuestion,
      gapItemId: dto.gapItemId,
    });
    return {
      ...result,
      type: result.type as IssueTreeTypeDto,
      pattern: result.pattern as IssueTreePatternDto,
    };
  }

  @Get('issue-trees/:id')
  @ApiOperation({ summary: 'イシューツリー詳細取得（ノードを含む）' })
  @ApiParam({ name: 'id', description: 'イシューツリーID' })
  @ApiResponse({ status: 200, description: '成功', type: IssueTreeWithNodesResponseDto })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'イシューツリーが見つかりません' })
  async findById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<IssueTreeWithNodesResponseDto> {
    const result = await this.getIssueTreeUseCase.execute({
      userId: user.id,
      treeId: id,
    });
    return {
      ...result,
      type: result.type as IssueTreeTypeDto,
      pattern: result.pattern as IssueTreePatternDto,
      nodes: result.nodes.map((node) => ({
        ...node,
        kind: node.kind as IssueNodeKindDto,
        verification: node.verification as NodeVerificationDto,
        recommendation: node.recommendation as NodeRecommendationDto,
      })),
    };
  }

  @Put('issue-trees/:id')
  @ApiOperation({ summary: 'イシューツリー更新' })
  @ApiParam({ name: 'id', description: 'イシューツリーID' })
  @ApiResponse({ status: 200, description: '更新成功', type: IssueTreeResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'イシューツリーが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateIssueTreeRequestDto,
  ): Promise<IssueTreeResponseDto> {
    const result = await this.updateIssueTreeUseCase.execute({
      userId: user.id,
      treeId: id,
      name: dto.name,
      rootQuestion: dto.rootQuestion,
      type: dto.type,
      pattern: dto.pattern,
    });
    return {
      ...result,
      type: result.type as IssueTreeTypeDto,
      pattern: result.pattern as IssueTreePatternDto,
    };
  }

  @Delete('issue-trees/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'イシューツリー削除' })
  @ApiParam({ name: 'id', description: 'イシューツリーID' })
  @ApiResponse({ status: 204, description: '削除成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'イシューツリーが見つかりません' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.deleteIssueTreeUseCase.execute({
      userId: user.id,
      treeId: id,
    });
  }

  // ===========================================
  // イシューノード
  // ===========================================

  @Post('issue-trees/:treeId/nodes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'イシューノード追加' })
  @ApiParam({ name: 'treeId', description: 'イシューツリーID' })
  @ApiResponse({ status: 201, description: '作成成功', type: IssueNodeResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'イシューツリーが見つかりません' })
  async addNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('treeId') treeId: string,
    @Body() dto: AddIssueNodeRequestDto,
  ): Promise<IssueNodeResponseDto> {
    const result = await this.addIssueNodeUseCase.execute({
      userId: user.id,
      treeId,
      parentId: dto.parentId,
      order: dto.order,
      label: dto.label,
      kind: dto.kind,
      verification: dto.verification,
      recommendation: dto.recommendation,
      evidence: dto.evidence,
      rootCauseNodeId: dto.rootCauseNodeId,
      metadata: dto.metadata,
    });
    return {
      ...result,
      kind: result.kind as IssueNodeKindDto,
      verification: result.verification as NodeVerificationDto,
      recommendation: result.recommendation as NodeRecommendationDto,
    };
  }

  @Put('issue-trees/:treeId/nodes/:nodeId')
  @ApiOperation({ summary: 'イシューノード更新' })
  @ApiParam({ name: 'treeId', description: 'イシューツリーID' })
  @ApiParam({ name: 'nodeId', description: 'イシューノードID' })
  @ApiResponse({ status: 200, description: '更新成功', type: IssueNodeResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ノードが見つかりません' })
  async updateNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('treeId') treeId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateIssueNodeRequestDto,
  ): Promise<IssueNodeResponseDto> {
    const result = await this.updateIssueNodeUseCase.execute({
      userId: user.id,
      treeId,
      nodeId,
      label: dto.label,
      kind: dto.kind,
      evidence: dto.evidence,
      verification: dto.verification,
      recommendation: dto.recommendation,
      parentId: dto.parentId,
      order: dto.order,
      rootCauseNodeId: dto.rootCauseNodeId,
      metadata: dto.metadata,
    });
    return {
      ...result,
      kind: result.kind as IssueNodeKindDto,
      verification: result.verification as NodeVerificationDto,
      recommendation: result.recommendation as NodeRecommendationDto,
    };
  }

  @Delete('issue-trees/:treeId/nodes/:nodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'イシューノード削除' })
  @ApiParam({ name: 'treeId', description: 'イシューツリーID' })
  @ApiParam({ name: 'nodeId', description: 'イシューノードID' })
  @ApiResponse({ status: 204, description: '削除成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ノードが見つかりません' })
  async removeNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('treeId') treeId: string,
    @Param('nodeId') nodeId: string,
  ): Promise<void> {
    await this.deleteIssueNodeUseCase.execute({
      userId: user.id,
      treeId,
      nodeId,
    });
  }

  @Put('issue-trees/:treeId/nodes/:nodeId/verification')
  @ApiOperation({ summary: 'イシューノードの検証状態設定' })
  @ApiParam({ name: 'treeId', description: 'イシューツリーID' })
  @ApiParam({ name: 'nodeId', description: 'イシューノードID' })
  @ApiResponse({ status: 200, description: '更新成功', type: IssueNodeResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ノードが見つかりません' })
  async setVerification(
    @CurrentUser() user: CurrentUserPayload,
    @Param('treeId') treeId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: SetNodeVerificationRequestDto,
  ): Promise<IssueNodeResponseDto> {
    const result = await this.setNodeVerificationUseCase.execute({
      userId: user.id,
      treeId,
      nodeId,
      verification: dto.verification,
      evidence: dto.evidence,
    });
    return {
      ...result,
      kind: result.kind as IssueNodeKindDto,
      verification: result.verification as NodeVerificationDto,
      recommendation: result.recommendation as NodeRecommendationDto,
    };
  }

  // ===========================================
  // 生成AI候補
  // ===========================================

  @Post('issue-trees/:treeId/nodes/:nodeId/ai-suggest')
  @ApiOperation({
    summary: '生成AIによる子ノード候補の提案（永続化しない）',
  })
  @ApiParam({ name: 'treeId', description: 'イシューツリーID' })
  @ApiParam({ name: 'nodeId', description: '対象ノードID' })
  @ApiResponse({
    status: 200,
    description: '成功',
    type: SuggestIssueNodesResponseDto,
  })
  @ApiResponse({ status: 400, description: 'AI鍵未設定 / バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ツリー/ノードが見つかりません' })
  @HttpCode(HttpStatus.OK)
  async aiSuggest(
    @CurrentUser() user: CurrentUserPayload,
    @Param('treeId') treeId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: SuggestIssueNodesRequestDto,
  ): Promise<SuggestIssueNodesResponseDto> {
    // 1. 認可 + ツリー/ノード取得（ツリー→project→org メンバー確認は use-case 側で実施）
    const tree = await this.getIssueTreeUseCase.execute({
      userId: user.id,
      treeId,
    });

    // 2. 対象ノードの解決（同一ツリー内）
    const target = tree.nodes.find((n) => n.id === nodeId);
    if (!target) {
      throw new HttpException(
        '対象ノードが見つかりません',
        HttpStatus.NOT_FOUND,
      );
    }

    // 3. 親チェーン（ルート→対象の親）のラベルを集める
    const nodeById = new Map(tree.nodes.map((n) => [n.id, n]));
    const parentLabels: string[] = [];
    let cursor = target.parentId ? nodeById.get(target.parentId) : undefined;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      parentLabels.unshift(cursor.label);
      cursor = cursor.parentId ? nodeById.get(cursor.parentId) : undefined;
    }

    // 4. このツリーに紐づくGAP（あれば）を取得
    let gapBusinessArea: string | null = null;
    let gapDescription: string | null = null;
    const gap = await this.prisma.gapItem.findFirst({
      where: { issueTreeId: treeId },
      select: { businessArea: true, gapDescription: true },
    });
    if (gap) {
      gapBusinessArea = gap.businessArea ?? null;
      gapDescription = gap.gapDescription ?? null;
    }

    // 5. 候補の種別（kind）を文脈から決定
    const expectedKind = this.decideSuggestKind(tree.pattern, target.kind);
    const expectedKindLabel = SUGGEST_KIND_LABELS[expectedKind];

    // 6. APIキー解決（project の org > ユーザー設定 > 環境変数）。無ければ 400。
    const apiKey = await this.companyKeyService.resolveForProject(
      tree.projectId,
      user.id,
    );
    if (!apiKey) {
      // 500にせず、フロントが扱いやすい 400 + { error } で返す
      throw new HttpException({ error: 'AI鍵未設定' }, HttpStatus.BAD_REQUEST);
    }

    // 7. 生成AIで構造化候補を取得（永続化はしない）
    const suggestions = await this.claudeService.suggestIssueNodes(
      {
        pattern: tree.pattern,
        treeName: tree.name,
        rootQuestion: tree.rootQuestion,
        targetLabel: target.label,
        targetKind: target.kind,
        parentLabels,
        expectedKind,
        expectedKindLabel,
        gapBusinessArea,
        gapDescription,
        userContext: dto.context ?? null,
        ideationMethodName: dto.ideationMethodName ?? null,
        ideationLenses: dto.ideationLenses ?? null,
      },
      apiKey,
      { projectId: tree.projectId, area: 'ISSUE_SUGGEST', userId: user.id },
    );

    return {
      suggestions: suggestions.map((s) => ({
        label: s.label,
        kind: expectedKind as IssueNodeKindDto,
      })),
    };
  }

  /**
   * ツリーパターンと対象ノードの種別から、子候補の種別（kind）を決定する。
   * - WHY系（WHYツリー / 対象がCAUSE）→ CAUSE（なぜ候補）
   * - HOW（打ち手・発散）→ OPTION（打ち手候補）
   * - MECE_ACTION（打ち手・網羅）→ ACTION（打ち手候補）
   * - WHAT（対象分割）→ ELEMENT（構成要素）
   * - KPI → METRIC
   * - ISSUE_POINT（論点・調査）/ 対象がPOINT → POINT（論点候補）
   * - 対象がVERIFICATION / HYPOTHESIS → VERIFICATION（検証候補）
   */
  private decideSuggestKind(
    pattern: string,
    targetKind: string,
  ): IssueNodeKind {
    // 対象ノードの種別が強いシグナルになるケースを先に判定
    if (targetKind === 'HYPOTHESIS' || targetKind === 'VERIFICATION') {
      return 'VERIFICATION';
    }
    if (targetKind === 'CAUSE') {
      return 'CAUSE';
    }

    switch (pattern) {
      case 'WHY':
        return 'CAUSE';
      case 'HOW':
        return 'OPTION';
      case 'MECE_ACTION':
        return 'ACTION';
      case 'WHAT':
        return 'ELEMENT';
      case 'KPI':
        return 'METRIC';
      case 'ISSUE_POINT':
      default:
        return 'POINT';
    }
  }
}

/**
 * 候補種別ごとの日本語ラベル（プロンプト・説明用）
 */
const SUGGEST_KIND_LABELS: Record<IssueNodeKind, string> = {
  ISSUE: '課題',
  CAUSE: 'なぜ候補（原因）',
  COUNTERMEASURE: '打ち手候補',
  POINT: '論点候補',
  HYPOTHESIS: '仮説',
  VERIFICATION: '検証候補',
  RESULT: '検証結果',
  ELEMENT: '構成要素',
  OPTION: '打ち手候補（How）',
  ACTION: '打ち手候補（MECEアクション）',
  METRIC: 'KPI（指標）',
};
