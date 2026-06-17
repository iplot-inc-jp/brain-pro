import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

const BOARD_KINDS = ['ASIS', 'TOBE'] as const;
type BoardKind = (typeof BOARD_KINDS)[number];

// ========== DTOs ==========

class CreateBoardDto {
  @ApiPropertyOptional({ description: 'ASIS | TOBE（後方互換・UI未使用）' })
  @IsOptional()
  @IsIn(BOARD_KINDS)
  kind?: BoardKind;

  @ApiPropertyOptional({ nullable: true, description: '領域（SubProject）ID。null=未分類' })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  order?: number;
}

class PatchBoardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'ASIS | TOBE（後方互換・UI未使用）' })
  @IsOptional()
  @IsIn(BOARD_KINDS)
  kind?: BoardKind;

  @ApiPropertyOptional({ nullable: true, description: '領域（SubProject）ID。null=未分類へ移動' })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  order?: number;

  // Excalidraw のシーン（{ elements, appState, files }）。任意の JSON を緩く受ける。
  @ApiPropertyOptional({ description: 'Excalidraw シーン JSON' })
  @IsOptional()
  scene?: unknown;
}

type BoardRow = {
  id: string;
  projectId: string;
  kind: string;
  subProjectId: string | null;
  title: string;
  order: number;
  scene: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

function boardToResponse(b: BoardRow) {
  return {
    id: b.id,
    projectId: b.projectId,
    kind: b.kind,
    subProjectId: b.subProjectId,
    title: b.title,
    order: b.order,
    scene: b.scene,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// ========================================================================
// プロジェクト配下ルート（一覧 / 新規作成）
//   :projectId を含むので ProjectAccessGuard が projectId を解決し認可する。
// ========================================================================
@ApiTags('業務イメージボード')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/image-boards')
export class ImageBoardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'プロジェクトの業務イメージボード一覧（全件・領域別・scene除く軽量）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async list(@Param('projectId') projectId: string) {
    const boards = await this.prisma.imageBoard.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      // 一覧は scene を返さない（重いため）。
      select: {
        id: true,
        projectId: true,
        kind: true,
        subProjectId: true,
        title: true,
        order: true,
        updatedAt: true,
      },
    });
    return boards.map((b) => ({
      id: b.id,
      projectId: b.projectId,
      kind: b.kind,
      subProjectId: b.subProjectId,
      title: b.title,
      order: b.order,
      updatedAt: b.updatedAt.toISOString(),
    }));
  }

  @Post()
  @ApiOperation({ summary: '業務イメージボードを新規作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateBoardDto,
  ) {
    const board = await this.prisma.imageBoard.create({
      data: {
        projectId,
        kind: dto.kind ?? 'ASIS',
        subProjectId: dto.subProjectId ?? null,
        title: dto.title ?? '',
        order: dto.order ?? 0,
      },
    });
    return boardToResponse(board as BoardRow);
  }
}

// ========================================================================
// 単一ボードルート（:boardId）。
//   params に projectId が無いため ProjectAccessGuard は素通り。
//   board をロードして projectId を求め、明示的に認可する。
// ========================================================================
@ApiTags('業務イメージボード')
@ApiBearerAuth()
@Controller('image-boards')
export class ImageBoardByIdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get(':boardId')
  @ApiOperation({ summary: 'ボード取得（scene 含む）' })
  @ApiParam({ name: 'boardId', description: 'ボードID' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('boardId') boardId: string,
  ) {
    await this.assertBoardAccess(boardId, user.id, 'view');
    const board = await this.prisma.imageBoard.findUnique({
      where: { id: boardId },
    });
    if (!board) throw new NotFoundException('業務イメージボードが見つかりません');
    return boardToResponse(board as BoardRow);
  }

  @Patch(':boardId')
  @ApiOperation({ summary: 'ボード更新（title/kind/order/scene）' })
  @ApiParam({ name: 'boardId', description: 'ボードID' })
  async patch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('boardId') boardId: string,
    @Body() dto: PatchBoardDto,
  ) {
    await this.assertBoardAccess(boardId, user.id, 'edit');
    const data: Prisma.ImageBoardUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.subProjectId !== undefined) {
      // null=未分類へ移動。relation 経由で接続/切断する。
      data.subProject = dto.subProjectId
        ? { connect: { id: dto.subProjectId } }
        : { disconnect: true };
    }
    if (dto.order !== undefined) data.order = dto.order;
    if (dto.scene !== undefined) {
      data.scene =
        dto.scene === null
          ? Prisma.JsonNull
          : (dto.scene as Prisma.InputJsonValue);
    }
    const board = await this.prisma.imageBoard.update({
      where: { id: boardId },
      data,
    });
    return boardToResponse(board as BoardRow);
  }

  @Delete(':boardId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ボード削除' })
  @ApiParam({ name: 'boardId', description: 'ボードID' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('boardId') boardId: string,
  ) {
    await this.assertBoardAccess(boardId, user.id, 'edit');
    await this.prisma.imageBoard.delete({ where: { id: boardId } });
  }

  /** board をロードして projectId を求め、明示的に認可する。 */
  private async assertBoardAccess(
    boardId: string,
    userId: string,
    required: 'view' | 'edit',
  ): Promise<void> {
    const board = await this.prisma.imageBoard.findUnique({
      where: { id: boardId },
      select: { projectId: true },
    });
    if (!board) throw new NotFoundException('業務イメージボードが見つかりません');
    await this.projectAccess.assertProjectAccess(
      board.projectId,
      userId,
      required,
    );
  }
}
