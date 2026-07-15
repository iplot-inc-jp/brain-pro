// backend/src/presentation/controllers/liveblocks.controller.ts
import { Body, Controller, Post, Res, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiPropertyOptional, ApiResponse } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { IssueLiveblocksTokenUseCase } from '../../application/use-cases/liveblocks/issue-liveblocks-token.use-case';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';

class IssueLiveblocksTokenDto {
  @ApiPropertyOptional({ description: 'プレゼンス対象プロジェクトID（room 未指定時）' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description:
      '参加するルーム（project:{projectId} or meetingdoc:{documentId}）。指定時はこちらを優先。',
  })
  @IsOptional()
  @IsString()
  room?: string;
}

/**
 * Liveblocks トークン発行エンドポイント。
 * グローバル JwtAuthGuard 配下（@Public ではない）。秘密鍵はサーバ専用。
 * room を解決して認可対象 projectId を求め、その room だけを付与する
 * （クライアントは任意スコープを送れない＝必ずサーバが project アクセス権を検証する）。
 */
@ApiTags('リアルタイム・プレゼンス')
@ApiBearerAuth()
@Controller('liveblocks')
export class LiveblocksController {
  constructor(
    private readonly useCase: IssueLiveblocksTokenUseCase,
    private readonly prisma: PrismaService,
  ) {}

  @Post('token')
  @ApiOperation({ summary: 'Liveblocks トークン発行（要 project アクセス権）' })
  @ApiResponse({ status: 403, description: 'プロジェクトアクセス権が無い / API キー呼び出し' })
  async token(
    @CurrentUser() user: CurrentUserPayload & { apiKeyId?: string },
    @Body() dto: IssueLiveblocksTokenDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const { projectId, roomId } = await this.resolveRoom(dto);
    const { body, status } = await this.useCase.execute({
      userId: user.id,
      apiKeyId: user.apiKeyId,
      principal: user,
      projectId,
      roomId,
    });
    res.status(status);
    return JSON.parse(body); // Liveblocks の body は JSON 文字列
  }

  /** room を解決して {認可対象 projectId, 付与する roomId} を返す。 */
  private async resolveRoom(
    dto: IssueLiveblocksTokenDto,
  ): Promise<{ projectId: string; roomId: string }> {
    const room = dto.room?.trim();
    // ミーティングドキュメントルーム: doc をロードして projectId を求める。
    if (room?.startsWith('meetingdoc:')) {
      const docId = room.slice('meetingdoc:'.length);
      const doc = await this.prisma.meetingDocument.findUnique({
        where: { id: docId },
        select: { projectId: true },
      });
      if (!doc) throw new BadRequestException('ドキュメントが見つかりません');
      return { projectId: doc.projectId, roomId: `meetingdoc:${docId}` };
    }
    // プロジェクトルーム（プレゼンス）。room=project:{id} か projectId から解決。
    const projectId = room?.startsWith('project:')
      ? room.slice('project:'.length)
      : dto.projectId;
    if (!projectId) {
      throw new BadRequestException('projectId または room が必要です');
    }
    return { projectId, roomId: `project:${projectId}` };
  }
}
