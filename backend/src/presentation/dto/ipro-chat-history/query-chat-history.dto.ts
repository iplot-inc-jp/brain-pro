import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function toStringArray({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  return Array.isArray(value) ? value : [value];
}

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class QueryChatHistoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  q?: string;

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  sources?: string[];

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  platforms?: string[];

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  roomIds?: string[];

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  authors?: string[];

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasMedia?: boolean;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
