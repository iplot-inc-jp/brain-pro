import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IssueTreeTypeDto, IssueTreePatternDto } from './create-issue-tree.dto';

/**
 * イシューツリー更新リクエストDTO
 */
export class UpdateIssueTreeRequestDto {
  @ApiPropertyOptional({ example: '解約率が高い', description: 'ツリー名' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'ツリー名は必須です' })
  @MaxLength(200, { message: 'ツリー名は200文字以内で入力してください' })
  name?: string;

  @ApiPropertyOptional({
    example: 'なぜ解約率が高いのか？',
    description: 'ルートの問い',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  rootQuestion?: string | null;

  @ApiPropertyOptional({
    enum: IssueTreeTypeDto,
    example: 'WHY',
    description: 'ツリー型（WHY: なぜ型、SOLUTION: 打ち手型）',
  })
  @IsOptional()
  @IsEnum(IssueTreeTypeDto, {
    message: '型はWHYまたはSOLUTIONを指定してください',
  })
  type?: IssueTreeTypeDto;

  @ApiPropertyOptional({
    enum: IssueTreePatternDto,
    example: 'ISSUE_POINT',
    description:
      'ツリーパターン（ISSUE_POINT / WHY / WHAT / HOW / MECE_ACTION / KPI）',
  })
  @IsOptional()
  @IsEnum(IssueTreePatternDto)
  pattern?: IssueTreePatternDto;
}
