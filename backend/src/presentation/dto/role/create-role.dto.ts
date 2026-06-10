import { IsString, MinLength, MaxLength, IsOptional, IsEnum, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum RoleTypeDto {
  HUMAN = 'HUMAN',
  SYSTEM = 'SYSTEM',
  OTHER = 'OTHER',
}

/**
 * ロール作成リクエストDTO
 */
export class CreateRoleRequestDto {
  @ApiProperty({ example: 'uuid-project-xxxx', description: 'プロジェクトID' })
  @IsString()
  projectId: string;

  @ApiProperty({ example: '管理者', description: 'ロール名' })
  @IsString()
  @MinLength(1, { message: 'ロール名は必須です' })
  @MaxLength(50, { message: 'ロール名は50文字以内で入力してください' })
  name: string;

  @ApiProperty({
    enum: RoleTypeDto,
    example: 'HUMAN',
    description: 'ロールタイプ（HUMAN: 人、SYSTEM: システム、OTHER: その他）',
  })
  @IsEnum(RoleTypeDto, { message: 'タイプはHUMAN, SYSTEM, OTHERのいずれかを指定してください' })
  type: RoleTypeDto;

  @ApiPropertyOptional({ example: 'システム管理者', description: '説明' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '説明は200文字以内で入力してください' })
  description?: string;

  @ApiPropertyOptional({ example: '#3B82F6', description: 'カラー（HEX形式）' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'カラーは#RRGGBB形式で入力してください',
  })
  color?: string;

  @ApiPropertyOptional({ description: '責務' })
  @IsOptional()
  @IsString()
  responsibility?: string;

  @ApiPropertyOptional({ description: '決裁範囲' })
  @IsOptional()
  @IsString()
  decisionScope?: string;

  @ApiPropertyOptional({ description: 'KPI' })
  @IsOptional()
  @IsString()
  kpi?: string;

  @ApiPropertyOptional({ description: '所属システムID（共通マスタ基盤。任意）', nullable: true })
  @IsOptional()
  @IsString()
  systemId?: string | null;

  @ApiPropertyOptional({ description: '所属サブ領域ID（共通マスタ基盤。任意）', nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

/**
 * ロール更新リクエストDTO
 */
export class UpdateRoleRequestDto {
  @ApiPropertyOptional({ example: '管理者', description: 'ロール名' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'ロール名は必須です' })
  @MaxLength(50, { message: 'ロール名は50文字以内で入力してください' })
  name?: string;

  @ApiPropertyOptional({
    enum: RoleTypeDto,
    example: 'HUMAN',
    description: 'ロールタイプ（HUMAN: 人、SYSTEM: システム、OTHER: その他）',
  })
  @IsOptional()
  @IsEnum(RoleTypeDto, {
    message: 'タイプはHUMAN, SYSTEM, OTHERのいずれかを指定してください',
  })
  type?: RoleTypeDto;

  @ApiPropertyOptional({ example: 'システム管理者', description: '説明' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ example: '#3B82F6', description: 'カラー（HEX形式）' })
  @IsOptional()
  @IsString()
  color?: string | null;

  @ApiPropertyOptional({ description: '責務' })
  @IsOptional()
  @IsString()
  responsibility?: string | null;

  @ApiPropertyOptional({ description: '決裁範囲' })
  @IsOptional()
  @IsString()
  decisionScope?: string | null;

  @ApiPropertyOptional({ description: 'KPI' })
  @IsOptional()
  @IsString()
  kpi?: string | null;

  @ApiPropertyOptional({ description: '所属システムID（共通マスタ基盤。任意。null で解除）', nullable: true })
  @IsOptional()
  @IsString()
  systemId?: string | null;

  @ApiPropertyOptional({ description: '所属サブ領域ID（共通マスタ基盤。任意。null で解除）', nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

/**
 * ロールレスポンスDTO
 */
export class RoleResponseDto {
  @ApiProperty({ example: 'uuid-xxxx-xxxx' })
  id: string;

  @ApiProperty({ example: 'uuid-project-xxxx' })
  projectId: string;

  @ApiProperty({ example: '管理者' })
  name: string;

  @ApiProperty({ enum: RoleTypeDto, example: 'HUMAN' })
  type: RoleTypeDto;

  @ApiProperty({ example: 'システム管理者', nullable: true })
  description: string | null;

  @ApiProperty({ example: '#3B82F6', nullable: true })
  color: string | null;

  @ApiProperty({ example: 0, description: '表示順序' })
  order?: number;

  @ApiProperty({ example: 120, description: 'スイムレーンの高さ' })
  laneHeight?: number;

  @ApiProperty({ description: '責務', nullable: true })
  responsibility?: string | null;

  @ApiProperty({ description: '決裁範囲', nullable: true })
  decisionScope?: string | null;

  @ApiProperty({ description: 'KPI', nullable: true })
  kpi?: string | null;

  @ApiProperty({ description: '所属システムID（共通マスタ基盤）', nullable: true })
  systemId?: string | null;

  @ApiProperty({ description: '所属サブ領域ID（共通マスタ基盤）', nullable: true })
  subProjectId?: string | null;

  @ApiProperty()
  createdAt?: Date;

  @ApiProperty()
  updatedAt?: Date;
}

