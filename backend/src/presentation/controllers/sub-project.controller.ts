import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { v4 as uuid } from 'uuid';

// DTOs
class CreateSubProjectDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  // 親サブ領域（領域→サブ領域の入れ子。任意）
  @IsOptional()
  @IsString()
  parentId?: string | null;
}

class UpdateSubProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  // 親サブ領域（領域→サブ領域の入れ子。任意。null で解除）
  @IsOptional()
  @IsString()
  parentId?: string | null;
}

@ApiTags('サブプロジェクト')
@ApiBearerAuth()
@Controller()
export class SubProjectController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('projects/:projectId/sub-projects')
  @ApiOperation({ summary: 'サブプロジェクト一覧取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async list(@Param('projectId') projectId: string) {
    const subProjects = await this.prisma.subProject.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    return subProjects.map((s) => this.toResponse(s));
  }

  @Post('projects/:projectId/sub-projects')
  @ApiOperation({ summary: 'サブプロジェクト作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSubProjectDto,
  ) {
    const created = await this.prisma.subProject.create({
      data: {
        id: uuid(),
        projectId,
        name: dto.name,
        description: dto.description,
        order: dto.order ?? 0,
        parentId: dto.parentId ?? null,
      },
    });

    return this.toResponse(created);
  }

  @Put('sub-projects/:id')
  @ApiOperation({ summary: 'サブプロジェクト更新' })
  @ApiParam({ name: 'id', description: 'サブプロジェクトID' })
  async update(@Param('id') id: string, @Body() dto: UpdateSubProjectDto) {
    const data: {
      name?: string;
      description?: string;
      order?: number;
      parentId?: string | null;
    } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.order !== undefined) data.order = dto.order;
    if (dto.parentId !== undefined) data.parentId = dto.parentId;

    const updated = await this.prisma.subProject.update({
      where: { id },
      data,
    });

    return this.toResponse(updated);
  }

  @Delete('sub-projects/:id')
  @ApiOperation({ summary: 'サブプロジェクト削除' })
  @ApiParam({ name: 'id', description: 'サブプロジェクトID' })
  async delete(@Param('id') id: string) {
    // 紐づくフローの subProjectId はスキーマの onDelete: SetNull で自動的に NULL になる
    await this.prisma.subProject.delete({ where: { id } });
    return { success: true };
  }

  private toResponse(s: {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    order: number;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: s.id,
      projectId: s.projectId,
      name: s.name,
      description: s.description,
      order: s.order,
      parentId: s.parentId,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}
