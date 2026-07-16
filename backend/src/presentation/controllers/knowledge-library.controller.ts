import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KnowledgeLibraryItemType } from '@prisma/client';
import { KnowledgeFolderService } from '../../infrastructure/knowledge-library/knowledge-folder.service';
import { KnowledgeLibraryService } from '../../infrastructure/knowledge-library/knowledge-library.service';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import {
  AddKnowledgeFolderItemsDto,
  CreateKnowledgeFolderDto,
  KnowledgeFolderTemplateNameDto,
  ReplaceKnowledgeItemFoldersDto,
  SearchKnowledgeLibraryDto,
  UpdateKnowledgeFolderDto,
} from '../dto/knowledge-library';
import { ProjectAccessGuard } from '../guards/project-access.guard';

@ApiTags('ナレッジライブラリ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId')
export class KnowledgeLibraryController {
  constructor(
    private readonly library: KnowledgeLibraryService,
    private readonly folders: KnowledgeFolderService,
  ) {}

  @Get('knowledge-library/search')
  @ApiOperation({ summary: 'RAG・ナレッジ・チャット・リソースを横断検索' })
  search(@Param('projectId') projectId: string, @Query() query: SearchKnowledgeLibraryDto) {
    return this.library.search(projectId, query);
  }

  @Get('knowledge-folders')
  listFolders(@Param('projectId') projectId: string) {
    return this.folders.list(projectId);
  }

  @Post('knowledge-folders')
  createFolder(@Param('projectId') projectId: string, @Body() dto: CreateKnowledgeFolderDto) {
    return this.folders.create(projectId, dto);
  }

  @Patch('knowledge-folders/:folderId')
  async updateFolder(
    @Param('projectId') projectId: string,
    @Param('folderId') folderId: string,
    @Body() dto: UpdateKnowledgeFolderDto,
  ) {
    let result;
    if (dto.name !== undefined) result = await this.folders.rename(projectId, folderId, dto.name);
    if (dto.parentId !== undefined || dto.order !== undefined) {
      result = await this.folders.move(
        projectId,
        folderId,
        dto.parentId,
        dto.order ?? 0,
      );
    }
    return result ?? this.folders.list(projectId);
  }

  @Get('knowledge-folders/:folderId/delete-preview')
  deletePreview(
    @Param('projectId') projectId: string,
    @Param('folderId') folderId: string,
  ) {
    return this.folders.deletePreview(projectId, folderId);
  }

  @Delete('knowledge-folders/:folderId')
  deleteFolder(@Param('projectId') projectId: string, @Param('folderId') folderId: string) {
    return this.folders.remove(projectId, folderId);
  }

  @Put('knowledge-library/items/:itemType/:itemId/folders')
  replaceFolders(
    @Param('projectId') projectId: string,
    @Param('itemType') itemType: KnowledgeLibraryItemType,
    @Param('itemId') itemId: string,
    @Body() dto: ReplaceKnowledgeItemFoldersDto,
  ) {
    return this.folders.replaceItemFolders(projectId, itemType, itemId, dto.folderIds);
  }

  @Post('knowledge-folders/:folderId/items')
  async addFolderItems(
    @Param('projectId') projectId: string,
    @Param('folderId') folderId: string,
    @Body() dto: AddKnowledgeFolderItemsDto,
  ) {
    const results = await Promise.all(
      dto.items.map((entry) =>
        this.folders.addItemToFolders(projectId, entry.itemType, entry.itemId, [folderId]),
      ),
    );
    return { added: results.reduce((total, result) => total + result.count, 0) };
  }

  @Get('knowledge-folder-templates')
  listTemplates(@Param('projectId') projectId: string) {
    return this.folders.listTemplates(projectId);
  }

  @Post('knowledge-folder-templates')
  createTemplate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: KnowledgeFolderTemplateNameDto,
  ) {
    return this.folders.saveCurrentAsTemplate(projectId, dto.name, user.id);
  }

  @Patch('knowledge-folder-templates/:templateId')
  updateTemplate(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
    @Body() dto: KnowledgeFolderTemplateNameDto,
  ) {
    return this.folders.renameTemplate(projectId, templateId, dto.name);
  }

  @Delete('knowledge-folder-templates/:templateId')
  deleteTemplate(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.folders.deleteTemplate(projectId, templateId);
  }

  @Post('knowledge-folder-templates/:templateId/apply')
  applyTemplate(
    @Param('projectId') projectId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.folders.applyTemplate(projectId, templateId);
  }
}
