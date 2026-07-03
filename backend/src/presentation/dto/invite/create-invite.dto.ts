import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInviteRequestDto {
  @ApiPropertyOptional({ description: 'ロール(OWNER/ADMIN/MEMBER/VIEWER)。既定 MEMBER' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ description: '有効日数。未指定なら無期限' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;

  @ApiPropertyOptional({ description: '最大利用回数。未指定なら無制限' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;
}
