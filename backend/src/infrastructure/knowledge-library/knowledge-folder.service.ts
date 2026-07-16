import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeFolder, KnowledgeLibraryItemType, Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import {
  BUILT_IN_KNOWLEDGE_FOLDER_TEMPLATES,
  KnowledgeFolderTemplateTreeNode,
} from './knowledge-folder.templates';

export interface CreateKnowledgeFolderInput {
  name: string;
  parentId?: string | null;
  order?: number;
}

export interface KnowledgeFolderTreeNode {
  id: string;
  name: string;
  order: number;
  parentId: string | null;
  itemCount: number;
  children: KnowledgeFolderTreeNode[];
}

const RESOURCE_SOURCES = ['document', 'recording', 'project_context', 'project_memory', 'tracker_task'];

@Injectable()
export class KnowledgeFolderService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string): Promise<KnowledgeFolderTreeNode[]> {
    await this.requireProject(projectId);
    const folders = await this.prisma.knowledgeFolder.findMany({
      where: { projectId },
      include: { _count: { select: { items: true } } },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    const nodes = new Map<string, KnowledgeFolderTreeNode>();
    for (const folder of folders) {
      nodes.set(folder.id, {
        id: folder.id,
        name: folder.name,
        order: folder.order,
        parentId: folder.parentId,
        itemCount: folder._count.items,
        children: [],
      });
    }
    const roots: KnowledgeFolderTreeNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async create(projectId: string, input: CreateKnowledgeFolderInput) {
    await this.requireProject(projectId);
    const name = this.requireName(input.name);
    if (input.parentId) await this.requireFolder(projectId, input.parentId, true);
    return this.prisma.knowledgeFolder.create({
      data: {
        projectId,
        parentId: input.parentId ?? null,
        name,
        order: input.order ?? 0,
      },
    });
  }

  async rename(projectId: string, folderId: string, name: string) {
    await this.requireFolder(projectId, folderId);
    return this.prisma.knowledgeFolder.update({
      where: { id: folderId },
      data: { name: this.requireName(name) },
    });
  }

  async move(projectId: string, folderId: string, parentId: string | null, order = 0) {
    const folder = await this.requireFolder(projectId, folderId);
    if (parentId === folderId) throw new BadRequestException('folder cannot be its own parent');
    if (parentId) {
      let candidate: KnowledgeFolder | null = await this.requireFolder(projectId, parentId, true);
      while (candidate) {
        if (candidate.id === folder.id || candidate.parentId === folder.id) {
          throw new BadRequestException('folder move would create a cycle');
        }
        candidate = candidate.parentId
          ? await this.prisma.knowledgeFolder.findUnique({ where: { id: candidate.parentId } })
          : null;
        if (candidate && candidate.projectId !== projectId) {
          throw new BadRequestException('parent folder belongs to another project');
        }
      }
    }
    return this.prisma.knowledgeFolder.update({
      where: { id: folderId },
      data: { parentId, order },
    });
  }

  async deletePreview(projectId: string, folderId: string) {
    await this.requireFolder(projectId, folderId);
    const folders = await this.prisma.knowledgeFolder.findMany({
      where: { projectId },
      select: { id: true, parentId: true },
    });
    const ids = new Set([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
          ids.add(folder.id);
          changed = true;
        }
      }
    }
    const itemCount = await this.prisma.knowledgeFolderItem.count({
      where: { projectId, folderId: { in: [...ids] } },
    });
    return { folderCount: ids.size, membershipCount: itemCount, sourceItemsDeleted: 0 };
  }

  async remove(projectId: string, folderId: string) {
    const preview = await this.deletePreview(projectId, folderId);
    await this.prisma.knowledgeFolder.delete({ where: { id: folderId } });
    return preview;
  }

  async addItemToFolders(
    projectId: string,
    itemType: KnowledgeLibraryItemType,
    itemId: string,
    folderIds: string[],
  ) {
    const uniqueFolderIds = [...new Set(folderIds)];
    await Promise.all([
      this.requireItem(projectId, itemType, itemId),
      this.requireFolders(projectId, uniqueFolderIds),
    ]);
    if (uniqueFolderIds.length === 0) return { count: 0 };
    return this.prisma.knowledgeFolderItem.createMany({
      data: uniqueFolderIds.map((folderId) => ({
        projectId,
        folderId,
        itemType,
        itemId,
      })),
      skipDuplicates: true,
    });
  }

  async replaceItemFolders(
    projectId: string,
    itemType: KnowledgeLibraryItemType,
    itemId: string,
    folderIds: string[],
  ) {
    const uniqueFolderIds = [...new Set(folderIds)];
    await Promise.all([
      this.requireItem(projectId, itemType, itemId),
      this.requireFolders(projectId, uniqueFolderIds),
    ]);
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeFolderItem.deleteMany({ where: { projectId, itemType, itemId } });
      if (uniqueFolderIds.length > 0) {
        await tx.knowledgeFolderItem.createMany({
          data: uniqueFolderIds.map((folderId) => ({
            projectId,
            folderId,
            itemType,
            itemId,
          })),
          skipDuplicates: true,
        });
      }
    });
    return { folderIds: uniqueFolderIds };
  }

  async listTemplates(projectId: string) {
    const project = await this.requireProject(projectId);
    const custom = await this.prisma.knowledgeFolderTemplate.findMany({
      where: { organizationId: project.organizationId },
      include: { nodes: { orderBy: [{ order: 'asc' }, { name: 'asc' }] } },
      orderBy: { updatedAt: 'desc' },
    });
    return { builtIn: BUILT_IN_KNOWLEDGE_FOLDER_TEMPLATES, custom };
  }

  async saveCurrentAsTemplate(projectId: string, name: string, userId?: string) {
    const project = await this.requireProject(projectId);
    const folders = await this.prisma.knowledgeFolder.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.knowledgeFolderTemplate.create({
        data: {
          organizationId: project.organizationId,
          createdById: userId,
          name: this.requireName(name),
        },
      });
      const nodeIds = new Map<string, string>();
      const pending = [...folders];
      while (pending.length > 0) {
        const index = pending.findIndex((folder) => !folder.parentId || nodeIds.has(folder.parentId));
        if (index < 0) throw new BadRequestException('folder tree contains a cycle');
        const [folder] = pending.splice(index, 1);
        const node = await tx.knowledgeFolderTemplateNode.create({
          data: {
            templateId: template.id,
            parentNodeId: folder.parentId ? nodeIds.get(folder.parentId) : undefined,
            name: folder.name,
            order: folder.order,
          },
        });
        nodeIds.set(folder.id, node.id);
      }
      return template;
    });
  }

  async deleteTemplate(projectId: string, templateId: string) {
    const project = await this.requireProject(projectId);
    const template = await this.prisma.knowledgeFolderTemplate.findFirst({
      where: { id: templateId, organizationId: project.organizationId },
    });
    if (!template) throw new NotFoundException('folder template not found');
    return this.prisma.knowledgeFolderTemplate.delete({ where: { id: templateId } });
  }

  async applyTemplate(projectId: string, templateId: string) {
    const project = await this.requireProject(projectId);
    const builtIn = BUILT_IN_KNOWLEDGE_FOLDER_TEMPLATES.find((template) => template.id === templateId);
    let nodes: KnowledgeFolderTemplateTreeNode[];
    if (builtIn) {
      nodes = [...builtIn.nodes];
    } else {
      const custom = await this.prisma.knowledgeFolderTemplate.findFirst({
        where: { id: templateId, organizationId: project.organizationId },
        include: { nodes: { orderBy: [{ order: 'asc' }, { name: 'asc' }] } },
      });
      if (!custom) throw new NotFoundException('folder template not found');
      nodes = this.templateNodesToTree(custom.nodes);
    }
    let created = 0;
    await this.prisma.$transaction(async (tx) => {
      created = await this.mergeTemplateNodes(tx, projectId, null, nodes);
    });
    return { created };
  }

  private async mergeTemplateNodes(
    tx: Prisma.TransactionClient,
    projectId: string,
    parentId: string | null,
    nodes: KnowledgeFolderTemplateTreeNode[],
  ): Promise<number> {
    let created = 0;
    for (const [order, node] of nodes.entries()) {
      let folder = await tx.knowledgeFolder.findFirst({
        where: { projectId, parentId, name: node.name },
      });
      if (!folder) {
        folder = await tx.knowledgeFolder.create({
          data: { projectId, parentId, name: node.name, order },
        });
        created += 1;
      }
      if (node.children?.length) {
        created += await this.mergeTemplateNodes(tx, projectId, folder.id, node.children);
      }
    }
    return created;
  }

  private templateNodesToTree(
    rows: Array<{ id: string; parentNodeId: string | null; name: string; order: number }>,
  ): KnowledgeFolderTemplateTreeNode[] {
    const nodes = new Map<string, KnowledgeFolderTemplateTreeNode>();
    for (const row of rows) nodes.set(row.id, { name: row.name, children: [] });
    const roots: KnowledgeFolderTemplateTreeNode[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id)!;
      const parent = row.parentNodeId ? nodes.get(row.parentNodeId) : undefined;
      if (parent) parent.children!.push(node);
      else roots.push(node);
    }
    return roots;
  }

  private async requireProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, organizationId: true },
    });
    if (!project) throw new NotFoundException('project not found');
    return project;
  }

  private async requireFolder(projectId: string, folderId: string, parent = false) {
    const folder = await this.prisma.knowledgeFolder.findUnique({ where: { id: folderId } });
    if (!folder) throw new NotFoundException(`${parent ? 'parent ' : ''}folder not found`);
    if (folder.projectId !== projectId) {
      throw new BadRequestException(`${parent ? 'parent ' : ''}folder belongs to another project`);
    }
    return folder;
  }

  private async requireFolders(projectId: string, folderIds: string[]) {
    if (folderIds.length === 0) return;
    const folders = await this.prisma.knowledgeFolder.findMany({
      where: { projectId, id: { in: folderIds } },
      select: { id: true },
    });
    if (folders.length !== folderIds.length) throw new NotFoundException('folder not found in project');
  }

  private async requireItem(
    projectId: string,
    itemType: KnowledgeLibraryItemType,
    itemId: string,
  ) {
    let count = 0;
    switch (itemType) {
      case 'RAG':
        count = await this.prisma.ragDocument.count({ where: { id: itemId, projectId } });
        break;
      case 'KNOWLEDGE_DOCUMENT':
        count = await this.prisma.knowledgeDocument.count({ where: { id: itemId, projectId } });
        break;
      case 'KNOWLEDGE_NODE':
        count = await this.prisma.knowledgeNode.count({ where: { id: itemId, projectId } });
        break;
      case 'CHAT':
        count = await this.prisma.iproActivityDocument.count({
          where: { id: itemId, projectId, source: 'chat' },
        });
        break;
      case 'RESOURCE':
        count = await this.prisma.iproActivityDocument.count({
          where: { id: itemId, projectId, source: { in: RESOURCE_SOURCES } },
        });
        break;
    }
    if (count !== 1) throw new NotFoundException('knowledge item not found in project');
  }

  private requireName(value: string) {
    const name = value.trim();
    if (!name) throw new BadRequestException('folder name is required');
    if (name.length > 120) throw new BadRequestException('folder name is too long');
    return name;
  }
}
