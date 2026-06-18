import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException,
  Param, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

const DIAGRAM_KINDS = ['FLOW', 'DFD', 'OBJECT_MAP'] as const;
const ELEMENT_TYPES = ['IMAGE', 'ICON', 'TEXT', 'SHAPE', 'ARROW'] as const;

class CreateDiagramElementDto {
  @IsIn(DIAGRAM_KINDS) diagramKind!: (typeof DIAGRAM_KINDS)[number];
  @IsString() diagramId!: string;
  @IsOptional() @IsIn(ELEMENT_TYPES) type?: (typeof ELEMENT_TYPES)[number];
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
  @IsOptional() @IsNumber() width?: number;
  @IsOptional() @IsNumber() height?: number;
  @IsOptional() @IsNumber() z?: number;
  @IsOptional() @IsString() attachmentId?: string;
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsString() color?: string;
}

class PatchDiagramElementDto {
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
  @IsOptional() @IsNumber() width?: number;
  @IsOptional() @IsNumber() height?: number;
  @IsOptional() @IsNumber() z?: number;
  @IsOptional() @IsNumber() rotation?: number;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() text?: string;
}

// Undo/Redo の一括復元用: スナップショット1要素（id を保持して upsert する）。
class RestoreElementDto {
  @IsString() id!: string;
  @IsOptional() @IsIn(ELEMENT_TYPES) type?: (typeof ELEMENT_TYPES)[number];
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
  @IsOptional() @IsNumber() width?: number | null;
  @IsOptional() @IsNumber() height?: number | null;
  @IsOptional() @IsNumber() z?: number;
  @IsOptional() @IsNumber() rotation?: number;
  @IsOptional() @IsString() attachmentId?: string | null;
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsString() color?: string | null;
}
class RestoreDiagramElementsDto {
  @IsIn(DIAGRAM_KINDS) diagramKind!: (typeof DIAGRAM_KINDS)[number];
  @IsString() diagramId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RestoreElementDto)
  elements!: RestoreElementDto[];
}

function toDto(e: any) {
  return {
    id: e.id, projectId: e.projectId, diagramKind: e.diagramKind, diagramId: e.diagramId,
    type: e.type, positionX: e.positionX, positionY: e.positionY, width: e.width ?? null,
    height: e.height ?? null, rotation: e.rotation ?? 0, z: e.z ?? 0,
    attachmentId: e.attachmentId ?? null, text: e.text ?? '', color: e.color ?? null,
    createdAt: e.createdAt,
  };
}

@ApiTags('図要素')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/diagram-elements')
export class DiagramElementController {
  constructor(private readonly prisma: PrismaService) {}

  /** diagramId が projectId 配下か検証（クロステナント防止）。FLOW=BusinessFlow / DFD=DfdDiagram / OBJECT_MAP=projectId 自身。 */
  private async assertDiagramInProject(
    projectId: string,
    kind: (typeof DIAGRAM_KINDS)[number],
    diagramId: string,
  ): Promise<void> {
    if (kind === 'OBJECT_MAP') {
      if (diagramId !== projectId) throw new NotFoundException('図が見つかりません');
      return;
    }
    if (kind === 'FLOW') {
      const f = await this.prisma.businessFlow.findUnique({
        where: { id: diagramId },
        select: { projectId: true },
      });
      if (!f || f.projectId !== projectId) throw new NotFoundException('業務フローが見つかりません');
      return;
    }
    const d = await this.prisma.dfdDiagram.findUnique({
      where: { id: diagramId },
      select: { projectId: true },
    });
    if (!d || d.projectId !== projectId) throw new NotFoundException('DFDが見つかりません');
  }

  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Query('diagramKind') diagramKind: (typeof DIAGRAM_KINDS)[number],
    @Query('diagramId') diagramId: string,
  ) {
    // 不正/未指定の query では Prisma が enum 不一致で 500 を投げるため、空配列で返す。
    if (!DIAGRAM_KINDS.includes(diagramKind) || !diagramId) return [];
    const rows = await this.prisma.diagramElement.findMany({
      where: { projectId, diagramKind, diagramId },
      orderBy: [{ z: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  @Post()
  async create(@Param('projectId') projectId: string, @Body() dto: CreateDiagramElementDto) {
    // diagramId / attachmentId が URL の projectId 配下か検証（クロステナント混入防止）。
    await this.assertDiagramInProject(projectId, dto.diagramKind, dto.diagramId);
    if (dto.attachmentId) {
      const att = await this.prisma.attachment.findFirst({
        where: { id: dto.attachmentId, projectId },
        select: { id: true },
      });
      if (!att) throw new NotFoundException('添付ファイルが見つかりません');
    }
    const created = await this.prisma.diagramElement.create({
      data: {
        projectId, diagramKind: dto.diagramKind, diagramId: dto.diagramId,
        type: dto.type ?? 'IMAGE',
        positionX: dto.positionX ?? 0, positionY: dto.positionY ?? 0,
        width: dto.width ?? null, height: dto.height ?? null, z: dto.z ?? 0,
        attachmentId: dto.attachmentId ?? null, text: dto.text ?? '', color: dto.color ?? null,
      },
    });
    return toDto(created);
  }

  // Undo/Redo: スナップショットに一致するよう id 保持で差分置換する（業務フロー /restore と同型）。
  // - スナップショットに無い既存要素を削除（= undo で「作成」を取り消し）。
  // - 各要素を id 指定で upsert（= undo で「削除」を取り消し＝同一 id で復活、移動/リサイズも復元）。
  // attachmentId は projectId 配下に実在するもののみ採用（削除済み添付は null に落として FK エラー回避）。
  @Put('restore')
  async restore(@Param('projectId') projectId: string, @Body() dto: RestoreDiagramElementsDto) {
    await this.assertDiagramInProject(projectId, dto.diagramKind, dto.diagramId);
    const attIds = dto.elements
      .map((e) => e.attachmentId)
      .filter((a): a is string => !!a);
    const validAtt = new Set<string>();
    if (attIds.length > 0) {
      const rows = await this.prisma.attachment.findMany({
        where: { id: { in: attIds }, projectId },
        select: { id: true },
      });
      for (const r of rows) validAtt.add(r.id);
    }
    const keepIds = dto.elements.map((e) => e.id);
    await this.prisma.$transaction(async (tx) => {
      // この (projectId, diagramKind, diagramId) スコープの現存 id 集合。
      // update は「このスコープに実在する id」だけに限定し、他テナントの要素 id を
      // body に紛れ込ませても upsert の update 分岐で書き換えられないようにする
      // （スコープ外 id は create に回り、グローバル衝突時は PK エラーでロールバック）。
      const existing = await tx.diagramElement.findMany({
        where: { projectId, diagramKind: dto.diagramKind, diagramId: dto.diagramId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((e) => e.id));
      // 削除は IMAGE 要素のみに限定する。restore のスナップショット(extra)はキャンバスが
      // ミラーする IMAGE 要素だけを含むため、type を絞らないと将来 IMAGE 以外の要素を
      // 追加したとき undo がそれらを巻き添えで全削除してしまう（潜在的データ損失）。
      await tx.diagramElement.deleteMany({
        where: {
          projectId, diagramKind: dto.diagramKind, diagramId: dto.diagramId, type: 'IMAGE',
          ...(keepIds.length > 0 ? { id: { notIn: keepIds } } : {}),
        },
      });
      for (const el of dto.elements) {
        const attachmentId = el.attachmentId && validAtt.has(el.attachmentId) ? el.attachmentId : null;
        const fields = {
          type: el.type ?? 'IMAGE',
          positionX: el.positionX ?? 0, positionY: el.positionY ?? 0,
          width: el.width ?? null, height: el.height ?? null,
          z: el.z ?? 0, rotation: el.rotation ?? 0,
          attachmentId, text: el.text ?? '', color: el.color ?? null,
        };
        if (existingIds.has(el.id)) {
          await tx.diagramElement.update({ where: { id: el.id }, data: fields });
        } else {
          await tx.diagramElement.create({
            data: { id: el.id, projectId, diagramKind: dto.diagramKind, diagramId: dto.diagramId, ...fields },
          });
        }
      }
    });
    const out = await this.prisma.diagramElement.findMany({
      where: { projectId, diagramKind: dto.diagramKind, diagramId: dto.diagramId },
      orderBy: [{ z: 'asc' }, { createdAt: 'asc' }],
    });
    return out.map(toDto);
  }
}

@ApiTags('図要素')
@ApiBearerAuth()
@Controller('diagram-elements')
export class DiagramElementByIdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  private async assert(id: string, userId: string, required: 'view' | 'edit') {
    const row = await this.prisma.diagramElement.findUnique({
      where: { id }, select: { projectId: true },
    });
    if (!row) throw new NotFoundException('図要素が見つかりません');
    await this.projectAccess.assertProjectAccess(row.projectId, userId, required);
  }

  @Patch(':id')
  async patch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: PatchDiagramElementDto,
  ) {
    await this.assert(id, user.id, 'edit');
    const data: Prisma.DiagramElementUpdateInput = {};
    for (const k of ['positionX','positionY','width','height','z','rotation','color','text'] as const) {
      if (dto[k] !== undefined) (data as any)[k] = dto[k];
    }
    const updated = await this.prisma.diagramElement.update({ where: { id }, data });
    return toDto(updated);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.assert(id, user.id, 'edit');
    await this.prisma.diagramElement.delete({ where: { id } });
  }
}
