import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
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
} from '@nestjs/swagger';
import { IsString } from 'class-validator';
import {
  CreateTaskCommentUseCase,
  GetTaskCommentsUseCase,
  UpdateTaskCommentUseCase,
  DeleteTaskCommentUseCase,
  TaskCommentOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

class CreateTaskCommentDto {
  @ApiProperty({ description: 'コメント本文' })
  @IsString()
  body: string;
}

class UpdateTaskCommentDto {
  @ApiProperty({ description: 'コメント本文' })
  @IsString()
  body: string;
}

@ApiTags('タスクコメント')
@ApiBearerAuth()
@Controller('tasks/:taskId/comments')
export class TaskCommentController {
  constructor(
    private readonly getTaskCommentsUseCase: GetTaskCommentsUseCase,
    private readonly createTaskCommentUseCase: CreateTaskCommentUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'タスクのコメント一覧取得（古い順）' })
  @ApiParam({ name: 'taskId', description: 'タスクID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'タスクが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('taskId') taskId: string,
  ): Promise<TaskCommentOutput[]> {
    return this.getTaskCommentsUseCase.execute({
      userId: user.id,
      principal: user,
      taskId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'タスクにコメントを投稿' })
  @ApiParam({ name: 'taskId', description: 'タスクID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'タスクが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('taskId') taskId: string,
    @Body() dto: CreateTaskCommentDto,
  ): Promise<TaskCommentOutput> {
    return this.createTaskCommentUseCase.execute({
      userId: user.id,
      principal: user,
      taskId,
      body: dto.body,
    });
  }
}

@ApiTags('タスクコメント')
@ApiBearerAuth()
@Controller('task-comments')
export class TaskCommentByIdController {
  constructor(
    private readonly updateTaskCommentUseCase: UpdateTaskCommentUseCase,
    private readonly deleteTaskCommentUseCase: DeleteTaskCommentUseCase,
  ) {}

  @Put(':id')
  @ApiOperation({ summary: 'タスクコメントを更新' })
  @ApiParam({ name: 'id', description: 'コメントID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'コメントが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTaskCommentDto,
  ): Promise<TaskCommentOutput> {
    return this.updateTaskCommentUseCase.execute({
      userId: user.id,
      principal: user,
      commentId: id,
      body: dto.body,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'タスクコメントを削除' })
  @ApiParam({ name: 'id', description: 'コメントID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'コメントが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteTaskCommentUseCase.execute({
      userId: user.id,
      principal: user,
      commentId: id,
    });
    return { success: true };
  }
}
