import { createHash, randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IproWebhookSource } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ForbiddenError } from '../../domain';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/services/crypto.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

class CreateIproWebhookSourceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

class UpdateIproWebhookSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

interface IproWebhookSourceView {
  id: string;
  projectId: string;
  name: string;
  active: boolean;
  lastReceivedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface IssuedIproWebhookSource extends IproWebhookSourceView {
  sourceToken: string;
  secret: string;
  receiverUrl: string;
}

@ApiTags('ipro-db受信設定')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/ipro-webhook-sources')
export class IproWebhookSourceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ipro-db Webhook受信元を一覧（秘密は返さない）' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<IproWebhookSourceView[]> {
    await this.assertAdmin(projectId, user);
    const rows = await this.prisma.iproWebhookSource.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toView(row));
  }

  @Post()
  @ApiOperation({ summary: '受信元を作成し、URLとHMAC秘密鍵を一度だけ返す' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateIproWebhookSourceDto,
  ): Promise<IssuedIproWebhookSource> {
    await this.assertAdmin(projectId, user);
    const issued = this.issueCredentials();
    const row = await this.prisma.iproWebhookSource.create({
      data: {
        projectId,
        name: dto.name.trim(),
        tokenHash: this.hashToken(issued.sourceToken),
        secretEnc: this.crypto.encrypt(issued.secret),
      },
    });
    return this.toIssued(row, issued);
  }

  @Patch(':sourceId')
  @ApiOperation({ summary: '受信元の名称または有効状態を更新' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: UpdateIproWebhookSourceDto,
  ): Promise<IproWebhookSourceView> {
    await this.assertAdmin(projectId, user);
    await this.requireSource(projectId, sourceId);
    const row = await this.prisma.iproWebhookSource.update({
      where: { id: sourceId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return this.toView(row);
  }

  @Delete(':sourceId')
  @ApiOperation({ summary: '受信元を削除' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<{ success: true }> {
    await this.assertAdmin(projectId, user);
    await this.requireSource(projectId, sourceId);
    await this.prisma.iproWebhookSource.delete({ where: { id: sourceId } });
    return { success: true };
  }

  @Post(':sourceId/rotate')
  @ApiOperation({ summary: 'URL tokenとHMAC秘密鍵を再発行し一度だけ返す' })
  async rotate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<IssuedIproWebhookSource> {
    await this.assertAdmin(projectId, user);
    await this.requireSource(projectId, sourceId);
    const issued = this.issueCredentials();
    const row = await this.prisma.iproWebhookSource.update({
      where: { id: sourceId },
      data: {
        tokenHash: this.hashToken(issued.sourceToken),
        secretEnc: this.crypto.encrypt(issued.secret),
        lastError: null,
      },
    });
    return this.toIssued(row, issued);
  }

  private async assertAdmin(
    projectId: string,
    principal: CurrentUserPayload,
  ): Promise<void> {
    await this.projectAccess.assertPrincipalAccess(principal, projectId, 'edit');
    if (!(await this.projectAccess.isProjectAdmin(projectId, principal.id))) {
      throw new ForbiddenError(
        'ipro-db受信設定の管理にはプロジェクト管理者権限が必要です',
      );
    }
  }

  private async requireSource(
    projectId: string,
    sourceId: string,
  ): Promise<IproWebhookSource> {
    const row = await this.prisma.iproWebhookSource.findFirst({
      where: { id: sourceId, projectId },
    });
    if (!row) {
      throw new HttpException('受信元が見つかりません', HttpStatus.NOT_FOUND);
    }
    return row;
  }

  private issueCredentials(): { sourceToken: string; secret: string } {
    return {
      sourceToken: randomBytes(32).toString('base64url'),
      secret: randomBytes(32).toString('base64url'),
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildReceiverUrl(sourceToken: string): string {
    const baseUrl = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
    return `${baseUrl}/api/webhooks/ipro-db/${sourceToken}`;
  }

  private toIssued(
    row: IproWebhookSource,
    issued: { sourceToken: string; secret: string },
  ): IssuedIproWebhookSource {
    return {
      ...this.toView(row),
      ...issued,
      receiverUrl: this.buildReceiverUrl(issued.sourceToken),
    };
  }

  private toView(row: IproWebhookSource): IproWebhookSourceView {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      active: row.active,
      lastReceivedAt: row.lastReceivedAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
