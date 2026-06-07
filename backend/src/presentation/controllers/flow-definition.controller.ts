import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import {
  GetFlowDefinitionUseCase,
  UpsertFlowDefinitionUseCase,
  ListFlowDefinitionsUseCase,
} from '../../application';
import { CurrentUser, CurrentUserPayload } from '../decorators';

class UpsertFlowDefinitionDto {
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsString() owner?: string;
  @IsOptional() @IsString() stakeholders?: string;
  @IsOptional() @IsString() input?: string;
  @IsOptional() @IsString() inputDetail?: string;
  @IsOptional() @IsString() trigger?: string;
  @IsOptional() @IsArray() doSteps?: string[];
  @IsOptional() @IsString() output?: string;
  @IsOptional() @IsString() nextProcess?: string;
  @IsOptional() @IsString() exceptionHandling?: string;
  @IsOptional() @IsString() frequency?: string;
  @IsOptional() @IsString() system?: string;
  @IsOptional() @IsString() tacitNotes?: string;
}

@ApiTags('業務定義')
@ApiBearerAuth()
@Controller()
export class FlowDefinitionController {
  constructor(
    private readonly getUseCase: GetFlowDefinitionUseCase,
    private readonly upsertUseCase: UpsertFlowDefinitionUseCase,
    private readonly listUseCase: ListFlowDefinitionsUseCase,
  ) {}

  @Get('projects/:projectId/flow-definitions')
  @ApiOperation({ summary: '業務定義シート①（全フロー一覧）' })
  async list(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.listUseCase.execute({ userId: user.id, projectId });
  }

  @Get('business-flows/:flowId/definition')
  @ApiOperation({ summary: '個別定義シート③（1フロー取得）' })
  async get(@CurrentUser() user: CurrentUserPayload, @Param('flowId') flowId: string) {
    return this.getUseCase.execute({ userId: user.id, flowId });
  }

  @Put('business-flows/:flowId/definition')
  @ApiOperation({ summary: '個別定義シート③（1フロー upsert）' })
  async upsert(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() dto: UpsertFlowDefinitionDto,
  ) {
    return this.upsertUseCase.execute({ userId: user.id, flowId, patch: dto });
  }
}
