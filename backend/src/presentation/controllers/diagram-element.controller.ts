import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException,
  Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
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
