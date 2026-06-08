import {
  Controller, Get, Post, Patch, Put, Delete, Body, Param, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  GetFlowDfdUseCase,
  GenerateFlowDfdUseCase,
  GetProjectDfdUseCase,
  GenerateProjectDfdUseCase,
  AddDfdNodeUseCase,
  UpdateDfdNodeUseCase,
  DeleteDfdNodeUseCase,
  AddDfdFlowUseCase,
  UpdateDfdFlowUseCase,
  DeleteDfdFlowUseCase,
  SaveDfdPositionsUseCase,
} from '../../application';
import { DfdNodeKindValue } from '../../domain/entities/dfd-node.entity';
import { CurrentUser, CurrentUserPayload } from '../decorators';

const KINDS = ['FUNCTION', 'EXTERNAL_ENTITY', 'DATA_STORE'];

class AddNodeDto {
  @IsIn(KINDS) kind!: DfdNodeKindValue;
  @IsString() label!: string;
  @IsOptional() @IsString() number?: string | null;
  @IsOptional() @IsString() refFlowId?: string | null;
  @IsOptional() @IsString() refNodeId?: string | null;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
}

class UpdateNodeDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() number?: string | null;
  @IsOptional() @IsIn(KINDS) kind?: DfdNodeKindValue;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
}

class AddFlowDto {
  @IsString() sourceNodeId!: string;
  @IsString() targetNodeId!: string;
  @IsOptional() @IsString() sourceHandle?: string | null;
  @IsOptional() @IsString() targetHandle?: string | null;
  @IsOptional() @IsString() dataItem?: string;
  @IsOptional() @IsString() informationTypeId?: string | null;
  @IsOptional() @IsNumber() order?: number;
}

class UpdateFlowDto {
  @IsOptional() @IsString() dataItem?: string;
  @IsOptional() @IsString() informationTypeId?: string | null;
  @IsOptional() @IsString() sourceNodeId?: string;
  @IsOptional() @IsString() targetNodeId?: string;
  @IsOptional() @IsString() sourceHandle?: string | null;
  @IsOptional() @IsString() targetHandle?: string | null;
  @IsOptional() @IsNumber() order?: number;
}

class PositionItemDto {
  @IsString() id!: string;
  @IsNumber() positionX!: number;
  @IsNumber() positionY!: number;
}

class SavePositionsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PositionItemDto)
  positions!: PositionItemDto[];
}

@ApiTags('DFD（データフロー図）')
@ApiBearerAuth()
@Controller()
export class DfdController {
  constructor(
    private readonly getFlowDfd: GetFlowDfdUseCase,
    private readonly generateFlowDfd: GenerateFlowDfdUseCase,
    private readonly getProjectDfd: GetProjectDfdUseCase,
    private readonly generateProjectDfd: GenerateProjectDfdUseCase,
    private readonly addNode: AddDfdNodeUseCase,
    private readonly updateNode: UpdateDfdNodeUseCase,
    private readonly deleteNode: DeleteDfdNodeUseCase,
    private readonly addFlow: AddDfdFlowUseCase,
    private readonly updateFlow: UpdateDfdFlowUseCase,
    private readonly deleteFlow: DeleteDfdFlowUseCase,
    private readonly savePositions: SaveDfdPositionsUseCase,
  ) {}

  // ========== 第2レベル（フロー） ==========

  @Get('business-flows/:flowId/dfd')
  @ApiOperation({ summary: '第2レベルDFD取得（get-or-create）' })
  async getByFlow(@CurrentUser() user: CurrentUserPayload, @Param('flowId') flowId: string) {
    return this.getFlowDfd.execute({ userId: user.id, flowId });
  }

  @Post('business-flows/:flowId/dfd')
  @ApiOperation({ summary: '第2レベルDFD生成（冪等同期）' })
  async generateByFlow(@CurrentUser() user: CurrentUserPayload, @Param('flowId') flowId: string) {
    return this.generateFlowDfd.execute({ userId: user.id, flowId });
  }

  // ========== 第1レベル（プロジェクト） ==========

  @Get('projects/:projectId/dfd')
  @ApiOperation({ summary: '第1レベルDFD取得（get-or-create）' })
  async getByProject(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.getProjectDfd.execute({ userId: user.id, projectId });
  }

  @Post('projects/:projectId/dfd')
  @ApiOperation({ summary: '第1レベルDFD生成（フロー＋FlowNodeLink, 冪等同期）' })
  async generateByProject(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.generateProjectDfd.execute({ userId: user.id, projectId });
  }

  // ========== ノード ==========

  @Post('dfd-diagrams/:diagramId/nodes')
  @ApiOperation({ summary: 'DFDノード追加' })
  async createNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('diagramId') diagramId: string,
    @Body() dto: AddNodeDto,
  ) {
    return this.addNode.execute({ userId: user.id, diagramId, ...dto });
  }

  @Patch('dfd-nodes/:id')
  @ApiOperation({ summary: 'DFDノード更新' })
  async patchNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateNodeDto,
  ) {
    return this.updateNode.execute({ userId: user.id, id, ...dto });
  }

  @Delete('dfd-nodes/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'DFDノード削除' })
  async removeNode(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.deleteNode.execute({ userId: user.id, id });
  }

  // ========== データフロー ==========

  @Post('dfd-diagrams/:diagramId/flows')
  @ApiOperation({ summary: 'データフロー追加' })
  async createFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('diagramId') diagramId: string,
    @Body() dto: AddFlowDto,
  ) {
    return this.addFlow.execute({ userId: user.id, diagramId, ...dto });
  }

  @Patch('dfd-flows/:id')
  @ApiOperation({ summary: 'データフロー更新' })
  async patchFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFlowDto,
  ) {
    return this.updateFlow.execute({ userId: user.id, id, ...dto });
  }

  @Delete('dfd-flows/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'データフロー削除' })
  async removeFlow(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.deleteFlow.execute({ userId: user.id, id });
  }

  // ========== 位置一括保存 ==========

  @Put('dfd-diagrams/:diagramId/positions')
  @HttpCode(204)
  @ApiOperation({ summary: 'ノード位置一括保存' })
  async putPositions(
    @CurrentUser() user: CurrentUserPayload,
    @Param('diagramId') diagramId: string,
    @Body() dto: SavePositionsDto,
  ) {
    await this.savePositions.execute({ userId: user.id, diagramId, positions: dto.positions });
  }
}
