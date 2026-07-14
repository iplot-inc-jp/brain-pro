import { Controller, Get, Post, Delete, Body, Param, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { UserApiTokenService } from '../../infrastructure/services/user-api-token.service';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';

class CreateUserApiTokenDto {
  @IsString()
  @MaxLength(100)
  name: string;
}

/**
 * ユーザー追従APIトークン（JWT）の自己管理。ログイン中のユーザーが自分名義のトークンを発行/一覧/失効する。
 * 発行したトークンは「自分の権限」で brain-pro API を叩ける（プロジェクトはユーザーの会員RBACに追従）。
 * 平文JWTは create のレスポンスでのみ返す。
 */
@ApiTags('APIトークン')
@ApiBearerAuth()
@Controller('user/api-tokens')
export class UserApiTokenController {
  constructor(@Inject(UserApiTokenService) private readonly svc: UserApiTokenService) {}

  @Post()
  @ApiOperation({ summary: 'ユーザー追従APIトークンを発行（平文JWTは一度だけ返却）' })
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateUserApiTokenDto) {
    return this.svc.mint(user.id, dto.name, Date.now());
  }

  @Get()
  @ApiOperation({ summary: 'APIトークン一覧（平文は含まない）' })
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.list(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'APIトークンを失効' })
  async revoke(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.svc.revoke(user.id, id);
    return { success: true };
  }
}
