import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Inject,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsArray,
} from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { SyncService } from '../../infrastructure/services/sync.service';
import { CompanyKeyService } from '../../infrastructure/services/company-key.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
  EntityNotFoundError,
  ForbiddenError,
  ValidationError,
} from '../../domain';

// ========== DTOs ==========
class UpdateApiEndpointDto {
  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsString()
  summary?: string;
}

class UpsertApiRolePermissionDto {
  @IsBoolean()
  allowed: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

class CreateTableStatusDto {
  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateTableStatusDto {
  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  order?: number;
}

class UpsertStatusRolePermissionDto {
  @IsArray()
  @IsString({ each: true })
  operations: string[];

  @IsOptional()
  @IsString()
  note?: string;
}

class AnalyzeSchemaDto {
  @IsString()
  schemaText: string;
}

class UpdateEdgeApiLinksDto {
  @IsArray()
  @IsString({ each: true })
  apiEndpointIds: string[];
}

@ApiTags('コード抽出')
@ApiBearerAuth()
@Controller()
export class CodeCatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: SyncService,
    private readonly companyKeyService: CompanyKeyService,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  // ========== API Endpoints ==========

  @Get('projects/:projectId/api-endpoints')
  @ApiOperation({ summary: '抽出されたAPIエンドポイント一覧（ロール権限含む）' })
  async listApiEndpoints(@Param('projectId') projectId: string) {
    return this.prisma.apiEndpoint.findMany({
      where: { projectId },
      include: { rolePermissions: true },
      orderBy: [{ path: 'asc' }, { method: 'asc' }],
    });
  }

  @Put('api-endpoints/:id')
  @ApiOperation({ summary: '抽出されたAPIを編集' })
  async updateApiEndpoint(
    @Param('id') id: string,
    @Body() dto: UpdateApiEndpointDto,
  ) {
    const existing = await this.prisma.apiEndpoint.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new HttpException(
        'APIエンドポイントが見つかりません',
        HttpStatus.NOT_FOUND,
      );
    }

    const data: Record<string, unknown> = {};
    if (dto.method !== undefined) data.method = dto.method;
    if (dto.path !== undefined) data.path = dto.path;
    if (dto.summary !== undefined) data.summary = dto.summary;

    return this.prisma.apiEndpoint.update({ where: { id }, data });
  }

  @Delete('api-endpoints/:id')
  @ApiOperation({ summary: '抽出されたAPIを削除' })
  async deleteApiEndpoint(@Param('id') id: string) {
    await this.prisma.apiEndpoint.delete({ where: { id } });
    return { success: true };
  }

  @Put('api-endpoints/:id/roles/:roleId')
  @ApiOperation({ summary: 'API×ロールの権限をupsert' })
  async upsertApiRolePermission(
    @Param('id') apiEndpointId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpsertApiRolePermissionDto,
  ) {
    return this.prisma.apiRolePermission.upsert({
      where: { apiEndpointId_roleId: { apiEndpointId, roleId } },
      create: {
        apiEndpointId,
        roleId,
        allowed: dto.allowed,
        note: dto.note,
      },
      update: {
        allowed: dto.allowed,
        note: dto.note,
      },
    });
  }

  // ========== 業務フローの矢印 × API 紐づけ ==========

  @Put('flow-edges/:id/api-links')
  @ApiOperation({
    summary: '業務フローの矢印に紐づくAPIエンドポイントを全置換',
  })
  async updateEdgeApiLinks(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') edgeId: string,
    @Body() dto: UpdateEdgeApiLinksDto,
  ) {
    const edge = await this.prisma.flowEdge.findUnique({
      where: { id: edgeId },
      include: {
        flow: {
          select: {
            id: true,
            projectId: true,
            project: { select: { organizationId: true } },
          },
        },
      },
    });
    if (!edge) {
      throw new EntityNotFoundError('FlowEdge', edgeId);
    }

    // 認可: edge -> flow -> project -> organization メンバーシップ
    // （business-flows のエッジ更新系と同じパターン）
    const isMember = await this.organizationRepository.isMember(
      edge.flow.project.organizationId,
      user.id,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 指定された ApiEndpoint の存在と、エッジのフローと同一プロジェクトであることを検証
    const uniqueIds = Array.from(new Set(dto.apiEndpointIds));
    const endpoints = await this.prisma.apiEndpoint.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, projectId: true },
    });
    if (endpoints.length !== uniqueIds.length) {
      const found = new Set(endpoints.map((ep) => ep.id));
      const missing = uniqueIds.find((eid) => !found.has(eid));
      throw new EntityNotFoundError('ApiEndpoint', missing ?? '');
    }
    const mismatched = endpoints.find(
      (ep) => ep.projectId !== edge.flow.projectId,
    );
    if (mismatched) {
      throw new ValidationError(
        `ApiEndpoint '${mismatched.id}' はこの業務フローと同じプロジェクトに属していません`,
      );
    }

    // 全置換（delete & insert。order は指定順を保持）
    await this.prisma.$transaction([
      this.prisma.flowEdgeApiLink.deleteMany({ where: { edgeId } }),
      this.prisma.flowEdgeApiLink.createMany({
        data: uniqueIds.map((apiEndpointId, i) => ({
          edgeId,
          apiEndpointId,
          order: i,
        })),
      }),
    ]);

    const links = await this.prisma.flowEdgeApiLink.findMany({
      where: { edgeId },
      include: {
        apiEndpoint: {
          select: { id: true, method: true, path: true, summary: true },
        },
      },
      orderBy: { order: 'asc' },
    });

    return links.map((l) => ({
      id: l.id,
      apiEndpointId: l.apiEndpointId,
      method: l.apiEndpoint.method,
      path: l.apiEndpoint.path,
      summary: l.apiEndpoint.summary,
    }));
  }

  // ========== Table Statuses (ステータス×ロール マトリクス) ==========

  @Get('projects/:projectId/table-statuses')
  @ApiOperation({
    summary: 'テーブルごとのステータス一覧（ロール権限含む・マトリクス用）',
  })
  async listTableStatuses(@Param('projectId') projectId: string) {
    return this.prisma.table.findMany({
      where: { projectId },
      include: {
        statuses: {
          include: { rolePermissions: true },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('tables/:tableId/statuses')
  @ApiOperation({ summary: 'テーブルにステータスを追加' })
  async createStatus(
    @Param('tableId') tableId: string,
    @Body() dto: CreateTableStatusDto,
  ) {
    return this.prisma.tableStatus.create({
      data: {
        tableId,
        value: dto.value,
        label: dto.label,
        color: dto.color,
        order: dto.order ?? 0,
      },
    });
  }

  @Put('statuses/:id')
  @ApiOperation({ summary: 'ステータスを編集' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTableStatusDto,
  ) {
    const existing = await this.prisma.tableStatus.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new HttpException(
        'ステータスが見つかりません',
        HttpStatus.NOT_FOUND,
      );
    }

    const data: Record<string, unknown> = {};
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.order !== undefined) data.order = dto.order;

    return this.prisma.tableStatus.update({ where: { id }, data });
  }

  @Delete('statuses/:id')
  @ApiOperation({ summary: 'ステータスを削除' })
  async deleteStatus(@Param('id') id: string) {
    await this.prisma.tableStatus.delete({ where: { id } });
    return { success: true };
  }

  @Put('statuses/:statusId/roles/:roleId')
  @ApiOperation({ summary: 'ステータス×ロールの権限をupsert' })
  async upsertStatusRolePermission(
    @Param('statusId') tableStatusId: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpsertStatusRolePermissionDto,
  ) {
    return this.prisma.statusRolePermission.upsert({
      where: { tableStatusId_roleId: { tableStatusId, roleId } },
      create: {
        tableStatusId,
        roleId,
        operations: dto.operations,
        note: dto.note,
      },
      update: {
        operations: dto.operations,
        note: dto.note,
      },
    });
  }

  // ========== Catalog: スキーマ貼付 → AI解析 ==========

  @Post('projects/:projectId/catalog/analyze-schema')
  @ApiOperation({
    summary: 'スキーマテキストをAI解析してテーブル/カラム/ステータスを生成',
  })
  async analyzeSchema(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: AnalyzeSchemaDto,
  ) {
    // 会社(Organization)キー → ユーザーキー → 環境変数 の順で解決
    const apiKey = await this.companyKeyService.resolveForProject(
      projectId,
      user.id,
    );
    if (!apiKey) {
      throw new HttpException(
        'Anthropic APIキーが未設定です',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.syncService.analyzeSchema(projectId, dto.schemaText, apiKey);
  }
}
