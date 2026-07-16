import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { KnowledgeLibraryItemType } from '@prisma/client';

export class SearchKnowledgeLibraryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  q?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((item) => String(item).split(',')).filter(Boolean);
  })
  @IsArray()
  @IsEnum(KnowledgeLibraryItemType, { each: true })
  itemTypes?: KnowledgeLibraryItemType[];

  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  unclassified?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateKnowledgeFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class UpdateKnowledgeFolderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class ReplaceKnowledgeItemFoldersDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  folderIds!: string[];
}

export class KnowledgeFolderItemDto {
  @IsEnum(KnowledgeLibraryItemType)
  itemType!: KnowledgeLibraryItemType;

  @IsString()
  itemId!: string;
}

export class AddKnowledgeFolderItemsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => KnowledgeFolderItemDto)
  items!: KnowledgeFolderItemDto[];
}

export class KnowledgeFolderTemplateNameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

