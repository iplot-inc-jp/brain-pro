import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiProperty,
  ApiQuery,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsIn,
  IsDateString,
  Min,
  Max,
} from 'class-validator';
import {
  CreateTaskUseCase,
  GetTasksUseCase,
  GetTaskUseCase,
  UpdateTaskUseCase,
  DeleteTaskUseCase,
  AddTaskDependencyUseCase,
  RemoveTaskDependencyUseCase,
  TaskOutput,
  TaskListOutput,
  TaskDependencyOutput,
} from '../../application';
import { TaskStatus, TaskPriority } from '../../domain';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

const TASK_STATUSES: TaskStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
];
const TASK_PRIORITIES: TaskPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

/** ISO 文字列 (YYYY-MM-DD or full ISO) を Date に変換。空/未指定はそのまま返す。 */
function toDate(value?: string | null): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return new Date(value);
}

// ========== DTOs ==========

class CreateTaskDto {
  @ApiProperty({ description: 'タスク名', example: '要件定義書の作成' })
  @IsString()
  title: string;

  @ApiProperty({ description: '説明', required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({
    description: '親タスクID（subtask 用）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiProperty({
    description: 'ステータス',
    enum: TASK_STATUSES,
    required: false,
  })
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @ApiProperty({
    description: '優先度',
    enum: TASK_PRIORITIES,
    required: false,
  })
  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiProperty({ description: '担当者名', required: false, nullable: true })
  @IsOptional()
  @IsString()
  assigneeName?: string | null;

  @ApiProperty({
    description: '担当ロールID',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  assigneeRoleId?: string | null;

  @ApiProperty({
    description:
      '紐付けるイシューノードID（ISSUE/CAUSE/COUNTERMEASURE）。null で未紐付け',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  issueNodeId?: string | null;

  @ApiProperty({
    description: '紐付けるリスクID（リスク対応タスク）。null で未紐付け',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  riskId?: string | null;

  @ApiProperty({
    description: '開始日（ISO文字列）',
    required: false,
    nullable: true,
    example: '2026-06-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiProperty({
    description: '期限日（ISO文字列）',
    required: false,
    nullable: true,
    example: '2026-06-30',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiProperty({
    description: '進捗（0-100）',
    required: false,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiProperty({ description: '予定工数（時間）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedHours?: number | null;

  @ApiProperty({ description: '実績工数（時間）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualHours?: number | null;

  @ApiProperty({ description: 'マイルストーン', required: false, nullable: true })
  @IsOptional()
  @IsString()
  milestone?: string | null;

  @ApiProperty({ description: 'カテゴリ', required: false, nullable: true })
  @IsOptional()
  @IsString()
  category?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateTaskDto {
  @ApiProperty({ description: 'タスク名', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: '説明', required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({
    description: '親タスクID（null でルート化 / 付け替え）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiProperty({
    description: 'ステータス',
    enum: TASK_STATUSES,
    required: false,
  })
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @ApiProperty({
    description: '優先度',
    enum: TASK_PRIORITIES,
    required: false,
  })
  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @ApiProperty({ description: '担当者名', required: false, nullable: true })
  @IsOptional()
  @IsString()
  assigneeName?: string | null;

  @ApiProperty({
    description: '担当ロールID',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  assigneeRoleId?: string | null;

  @ApiProperty({
    description:
      '紐付けるイシューノードID。指定で紐付け差し替え / null で紐付け解除 / 省略で変更なし',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  issueNodeId?: string | null;

  @ApiProperty({
    description:
      '紐付けるリスクID。指定で紐付け差し替え / null で紐付け解除 / 省略で変更なし',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  riskId?: string | null;

  @ApiProperty({
    description: '開始日（ISO文字列）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiProperty({
    description: '期限日（ISO文字列）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @ApiProperty({
    description: '進捗（0-100）',
    required: false,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiProperty({ description: '予定工数（時間）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedHours?: number | null;

  @ApiProperty({ description: '実績工数（時間）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  actualHours?: number | null;

  @ApiProperty({ description: 'マイルストーン', required: false, nullable: true })
  @IsOptional()
  @IsString()
  milestone?: string | null;

  @ApiProperty({ description: 'カテゴリ', required: false, nullable: true })
  @IsOptional()
  @IsString()
  category?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

class AddDependencyDto {
  @ApiProperty({
    description: '先行タスクID（このタスクが終わってから本タスクを開始する）',
  })
  @IsString()
  predecessorId: string;
}

@ApiTags('タスク')
@ApiBearerAuth()
@Controller('projects/:projectId/tasks')
export class TaskController {
  constructor(
    private readonly getTasksUseCase: GetTasksUseCase,
    private readonly createTaskUseCase: CreateTaskUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'プロジェクトのタスク一覧取得（フラット tasks[] + dependencies[]）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiQuery({
    name: 'issueNodeId',
    required: false,
    description: '指定すると、その紐付けノードのタスクのみに絞り込む',
  })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('issueNodeId') issueNodeId?: string,
  ): Promise<TaskListOutput> {
    return this.getTasksUseCase.execute({
      userId: user.id,
      projectId,
      issueNodeId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'タスク作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskOutput> {
    return this.createTaskUseCase.execute({
      userId: user.id,
      projectId,
      parentId: dto.parentId,
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      assigneeName: dto.assigneeName,
      assigneeRoleId: dto.assigneeRoleId,
      issueNodeId: dto.issueNodeId,
      riskId: dto.riskId,
      startDate: toDate(dto.startDate),
      dueDate: toDate(dto.dueDate),
      progress: dto.progress,
      estimatedHours: dto.estimatedHours,
      actualHours: dto.actualHours,
      milestone: dto.milestone,
      category: dto.category,
      order: dto.order,
    });
  }
}

@ApiTags('タスク')
@ApiBearerAuth()
@Controller('tasks')
export class TaskByIdController {
  constructor(
    private readonly getTaskUseCase: GetTaskUseCase,
    private readonly updateTaskUseCase: UpdateTaskUseCase,
    private readonly deleteTaskUseCase: DeleteTaskUseCase,
    private readonly addTaskDependencyUseCase: AddTaskDependencyUseCase,
    private readonly removeTaskDependencyUseCase: RemoveTaskDependencyUseCase,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'タスク取得' })
  @ApiParam({ name: 'id', description: 'タスクID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'タスクが見つかりません' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<TaskOutput> {
    return this.getTaskUseCase.execute({ userId: user.id, taskId: id });
  }

  @Put(':id')
  @ApiOperation({
    summary:
      'タスク更新（親付け替え / ステータス / 進捗 / 期日 / 担当 / 並び順 など任意フィールド）',
  })
  @ApiParam({ name: 'id', description: 'タスクID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'タスクが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskOutput> {
    return this.updateTaskUseCase.execute({
      userId: user.id,
      taskId: id,
      parentId: dto.parentId,
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      assigneeName: dto.assigneeName,
      assigneeRoleId: dto.assigneeRoleId,
      issueNodeId: dto.issueNodeId,
      riskId: dto.riskId,
      startDate: toDate(dto.startDate),
      dueDate: toDate(dto.dueDate),
      progress: dto.progress,
      estimatedHours: dto.estimatedHours,
      actualHours: dto.actualHours,
      milestone: dto.milestone,
      category: dto.category,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'タスク削除（子タスク・依存関係はカスケード削除）' })
  @ApiParam({ name: 'id', description: 'タスクID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'タスクが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteTaskUseCase.execute({ userId: user.id, taskId: id });
    return { success: true };
  }

  @Post(':id/dependencies')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'タスク依存追加（:id を後続として predecessorId に依存させる）',
  })
  @ApiParam({ name: 'id', description: '後続タスクID（successor）' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'タスクが見つかりません' })
  async addDependency(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AddDependencyDto,
  ): Promise<TaskDependencyOutput> {
    return this.addTaskDependencyUseCase.execute({
      userId: user.id,
      successorId: id,
      predecessorId: dto.predecessorId,
    });
  }

  @Delete('dependencies/:depId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'タスク依存削除（依存IDで削除）' })
  @ApiParam({ name: 'depId', description: '依存関係ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '依存関係が見つかりません' })
  async removeDependency(
    @CurrentUser() user: CurrentUserPayload,
    @Param('depId') depId: string,
  ): Promise<{ success: boolean }> {
    await this.removeTaskDependencyUseCase.execute({
      userId: user.id,
      dependencyId: depId,
    });
    return { success: true };
  }
}
