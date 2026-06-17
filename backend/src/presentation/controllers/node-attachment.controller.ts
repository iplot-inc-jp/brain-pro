import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException,
  Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { DiagramKgBridgeService } from '../../infrastructure/knowledge/diagram-kg-bridge.service';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';

const NODE_KINDS = ['FLOW_NODE', 'DFD_NODE', 'DATA_OBJECT'] as const;
type NodeKind = (typeof NODE_KINDS)[number];

const ATTACHMENT_SELECT = {
  id: true, filename: true, displayName: true, mimeType: true,
  kind: true, size: true, url: true, pageRange: true, blobUrl: true,
} as const;

class CreateNodeAttachmentDto {
  @IsIn(NODE_KINDS) nodeKind!: NodeKind;
  @IsString() nodeId!: string;
  @IsString() attachmentId!: string;
  @IsOptional() @IsString() caption?: string;
}
class PatchNodeAttachmentDto {
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsString() caption?: string;
}

function toDto(r: any) {
  return {
    id: r.id, projectId: r.projectId, nodeKind: r.nodeKind, nodeId: r.nodeId,
    attachmentId: r.attachmentId, order: r.order ?? 0, caption: r.caption ?? null,
    attachment: r.attachment
      ? {
          id: r.attachment.id,
          filename: r.attachment.filename,
          displayName: r.attachment.displayName ?? null,
          mimeType: r.attachment.mimeType,
          kind: r.attachment.kind,
          size: r.attachment.size,
          url: r.attachment.url,
          pageRange: r.attachment.pageRange ?? null,
        }
      : null,
  };
}

@ApiTags('ノード添付')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/node-attachments')
export class NodeAttachmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: DiagramKgBridgeService,
  ) {}

  /** Load the node's label + verify it belongs to projectId. Returns label or throws. */
  private async resolveNode(projectId: string, kind: NodeKind, nodeId: string): Promise<string> {
    if (kind === 'FLOW_NODE') {
      const n = await this.prisma.flowNode.findUnique({ where: { id: nodeId }, select: { label: true, flow: { select: { projectId: true } } } });
      if (!n || n.flow.projectId !== projectId) throw new NotFoundException('ノードが見つかりません');
      return n.label;
    }
    if (kind === 'DFD_NODE') {
      const n = await this.prisma.dfdNode.findUnique({ where: { id: nodeId }, select: { label: true, diagram: { select: { projectId: true } } } });
      if (!n || n.diagram.projectId !== projectId) throw new NotFoundException('ノードが見つかりません');
      return n.label;
    }
    const n = await this.prisma.dataObject.findUnique({ where: { id: nodeId }, select: { name: true, projectId: true } });
    if (!n || n.projectId !== projectId) throw new NotFoundException('オブジェクトが見つかりません');
    return n.name;
  }

  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Query('nodeKind') nodeKind: NodeKind,
    @Query('nodeId') nodeId: string,
  ) {
    // 不正/未指定の query では Prisma が enum 不一致で 500 を投げるため、空配列で返す。
    if (!NODE_KINDS.includes(nodeKind) || !nodeId) return [];
    const rows = await this.prisma.nodeAttachment.findMany({
      where: { projectId, nodeKind, nodeId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { attachment: { select: ATTACHMENT_SELECT } },
    });
    return rows.map(toDto);
  }

  @Post()
  async create(@Param('projectId') projectId: string, @Body() dto: CreateNodeAttachmentDto) {
    const label = await this.resolveNode(projectId, dto.nodeKind, dto.nodeId);
    // 添付は URL の projectId 配下のもののみ許可（クロステナント混入防止）。
    const att = await this.prisma.attachment.findFirst({ where: { id: dto.attachmentId, projectId }, select: ATTACHMENT_SELECT });
    if (!att) throw new NotFoundException('添付ファイルが見つかりません');

    // 同じノードに同じ添付を再度付けた場合は既存行を返す（冪等・二重作成の P2002 500 を回避）。
    const existing = await this.prisma.nodeAttachment.findFirst({
      where: { projectId, nodeKind: dto.nodeKind, nodeId: dto.nodeId, attachmentId: dto.attachmentId },
      include: { attachment: { select: ATTACHMENT_SELECT } },
    });
    if (existing) return toDto(existing);

    const created = await this.prisma.nodeAttachment.create({
      data: { projectId, nodeKind: dto.nodeKind, nodeId: dto.nodeId, attachmentId: dto.attachmentId, caption: dto.caption ?? null },
      include: { attachment: { select: ATTACHMENT_SELECT } },
    });

    // KG 常時登録（無課金・決定的）。失敗しても添付自体は成功させる。
    try {
      const { knowledgeNodeId } = await this.bridge.ensureEntityForNode(projectId, dto.nodeKind, dto.nodeId, label);
      await this.bridge.registerAttachmentDocument({
        projectId, attachmentId: dto.attachmentId,
        title: att.displayName || att.filename, mimeType: att.mimeType,
        blobUrl: att.blobUrl ?? null, linkNodeId: knowledgeNodeId,
      });
    } catch (e) {
      // best-effort; ログのみ
      console.warn('[node-attachment] KG register failed', e);
    }
    return toDto(created);
  }
}

@ApiTags('ノード添付')
@ApiBearerAuth()
@Controller('node-attachments')
export class NodeAttachmentByIdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly bridge: DiagramKgBridgeService,
  ) {}

  private async assert(id: string, userId: string, required: 'view' | 'edit') {
    const row = await this.prisma.nodeAttachment.findUnique({ where: { id }, select: { projectId: true } });
    if (!row) throw new NotFoundException('ノード添付が見つかりません');
    await this.projectAccess.assertProjectAccess(row.projectId, userId, required);
  }

  @Patch(':id')
  async patch(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: PatchNodeAttachmentDto) {
    await this.assert(id, user.id, 'edit');
    const data: { order?: number; caption?: string } = {};
    if (dto.order !== undefined) data.order = dto.order;
    if (dto.caption !== undefined) data.caption = dto.caption;
    const updated = await this.prisma.nodeAttachment.update({
      where: { id }, data, include: { attachment: { select: ATTACHMENT_SELECT } },
    });
    return toDto(updated);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.assert(id, user.id, 'edit');
    const row = await this.prisma.nodeAttachment.findUnique({ where: { id }, select: { projectId: true, attachmentId: true } });
    await this.prisma.nodeAttachment.delete({ where: { id } });
    try {
      if (row) await this.bridge.unregisterAttachmentDocumentIfOrphaned(row.projectId, row.attachmentId);
    } catch (e) {
      console.warn('[node-attachment] KG cleanup failed', e);
    }
  }
}
