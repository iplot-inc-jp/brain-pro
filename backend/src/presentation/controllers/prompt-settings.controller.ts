import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { PromptService } from '../../infrastructure/prompts/prompt.service';
import {
  PROMPT_ALLOWED_MODELS,
  PROMPT_MAX_LENGTH,
} from '../../infrastructure/prompts/prompt-registry';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

export class UpdatePromptSettingsDto {
  // 許可リスト外でも環境変数の既定モデルは保存できるため、確定検証は PromptService が行う
  @ApiProperty({ enum: PROMPT_ALLOWED_MODELS, description: 'このプロンプトで使うClaudeモデル' })
  @IsString()
  @MaxLength(100)
  model!: string;

  @ApiProperty({ description: 'システムプロンプト', maxLength: PROMPT_MAX_LENGTH })
  @IsString()
  @Matches(/\S/u, { message: 'systemPrompt を空にはできません' })
  @MaxLength(PROMPT_MAX_LENGTH)
  systemPrompt!: string;
}

@ApiTags('プロンプト設定')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/prompts')
export class PromptSettingsController {
  constructor(private readonly prompts: PromptService) {}

  @Get()
  @ApiOperation({ summary: 'システム全体のプロンプト定義と有効設定のサマリを一覧' })
  list(@Param('projectId') projectId: string) {
    return this.prompts.list(projectId);
  }

  @Get(':key')
  @ApiOperation({ summary: '指定プロンプトの有効設定・変更履歴・既定値を取得' })
  settings(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('key') key: string,
  ) {
    return this.prompts.getSettings(projectId, key, user.id);
  }

  @Put(':key')
  @ApiOperation({ summary: '指定プロンプトのモデル・本文を新しい版として保存' })
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('key') key: string,
    @Body() dto: UpdatePromptSettingsDto,
  ) {
    return this.prompts.update(projectId, key, dto, user.id);
  }

  @Post(':key/reset')
  @ApiOperation({ summary: '指定プロンプトを既定値の新しい版として復元' })
  reset(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('key') key: string,
  ) {
    return this.prompts.reset(projectId, key, user.id);
  }
}
