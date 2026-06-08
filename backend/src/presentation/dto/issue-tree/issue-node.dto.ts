import {
  IsString,
  MinLength,
  IsOptional,
  IsEnum,
  IsInt,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NodeVerificationDto,
  NodeRecommendationDto,
  IssueTreePatternDto,
} from './create-issue-tree.dto';

/**
 * ノード種別DTO
 * - ISSUE: 課題/ゴール/対象（汎用ルート）
 * - CAUSE: 原因（なぜ型の掘り下げ）
 * - COUNTERMEASURE: 打ち手（互換: OPTION相当）
 * - POINT: 論点（疑問形・再帰）
 * - HYPOTHESIS: 仮説
 * - VERIFICATION: 検証アクション
 * - RESULT: 検証結果（○×△）
 * - ELEMENT: 構成要素（What）
 * - OPTION: 解決候補（How）
 * - ACTION: 行動（MECEアクション）
 * - METRIC: KPI（数値）
 */
export enum IssueNodeKindDto {
  ISSUE = 'ISSUE',
  CAUSE = 'CAUSE',
  COUNTERMEASURE = 'COUNTERMEASURE',
  POINT = 'POINT',
  HYPOTHESIS = 'HYPOTHESIS',
  VERIFICATION = 'VERIFICATION',
  RESULT = 'RESULT',
  ELEMENT = 'ELEMENT',
  OPTION = 'OPTION',
  ACTION = 'ACTION',
  METRIC = 'METRIC',
}

/**
 * イシューノード追加リクエストDTO
 */
export class AddIssueNodeRequestDto {
  @ApiPropertyOptional({
    example: 'uuid-parent-node',
    description: '親ノードID（ルートの場合は省略）',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ example: 0, description: '兄弟内の表示順序' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({ example: 'オンボーディングが分かりにくい', description: 'ラベル' })
  @IsString()
  @MinLength(1, { message: 'ラベルは必須です' })
  label: string;

  @ApiPropertyOptional({
    enum: IssueNodeKindDto,
    example: 'ISSUE',
    description: 'ノード種別（ISSUE: 課題 / CAUSE: 原因 / COUNTERMEASURE: 打ち手）',
  })
  @IsOptional()
  @IsEnum(IssueNodeKindDto)
  kind?: IssueNodeKindDto;

  @ApiPropertyOptional({ enum: NodeVerificationDto, example: 'NA' })
  @IsOptional()
  @IsEnum(NodeVerificationDto)
  verification?: NodeVerificationDto;

  @ApiPropertyOptional({ enum: NodeRecommendationDto, example: 'NA' })
  @IsOptional()
  @IsEnum(NodeRecommendationDto)
  recommendation?: NodeRecommendationDto;

  @ApiPropertyOptional({ example: 'アンケート結果より', description: '根拠', nullable: true })
  @IsOptional()
  @IsString()
  evidence?: string | null;

  @ApiPropertyOptional({
    example: 'uuid-why-node',
    description: '根本原因ノードID（SOLUTION型→WHY型確定ノード参照）',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  rootCauseNodeId?: string | null;

  @ApiPropertyOptional({ example: {}, description: 'メタデータ' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * イシューノード更新リクエストDTO
 */
export class UpdateIssueNodeRequestDto {
  @ApiPropertyOptional({ example: 'オンボーディングが分かりにくい', description: 'ラベル' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'ラベルは必須です' })
  label?: string;

  @ApiPropertyOptional({
    enum: IssueNodeKindDto,
    example: 'CAUSE',
    description: 'ノード種別（ISSUE: 課題 / CAUSE: 原因 / COUNTERMEASURE: 打ち手）',
  })
  @IsOptional()
  @IsEnum(IssueNodeKindDto)
  kind?: IssueNodeKindDto;

  @ApiPropertyOptional({ example: 'アンケート結果より', description: '根拠', nullable: true })
  @IsOptional()
  @IsString()
  evidence?: string | null;

  @ApiPropertyOptional({ enum: NodeVerificationDto, example: 'CONFIRMED' })
  @IsOptional()
  @IsEnum(NodeVerificationDto)
  verification?: NodeVerificationDto;

  @ApiPropertyOptional({ enum: NodeRecommendationDto, example: 'ADOPT' })
  @IsOptional()
  @IsEnum(NodeRecommendationDto)
  recommendation?: NodeRecommendationDto;

  @ApiPropertyOptional({
    example: 'uuid-parent-node',
    description: '親ノードID（ルートにする場合はnull）',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ example: 0, description: '兄弟内の表示順序' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({
    example: 'uuid-why-node',
    description: '根本原因ノードID',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  rootCauseNodeId?: string | null;

  @ApiPropertyOptional({ example: {}, description: 'メタデータ' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * 生成AI候補リクエストDTO
 */
export class SuggestIssueNodesRequestDto {
  @ApiPropertyOptional({
    example: '直近3ヶ月の解約データを踏まえて',
    description: 'AIへの任意の補足コンテキスト',
  })
  @IsOptional()
  @IsString()
  context?: string;
}

/**
 * 生成AI候補の1件（採用時にフロントが node-create で作る）
 */
export class IssueNodeSuggestionDto {
  @ApiProperty({ example: 'なぜオンボーディングが分かりにくいのか？' })
  label: string;

  @ApiProperty({ enum: IssueNodeKindDto, example: 'CAUSE' })
  kind: IssueNodeKindDto;
}

/**
 * 生成AI候補レスポンスDTO
 */
export class SuggestIssueNodesResponseDto {
  @ApiProperty({ type: [IssueNodeSuggestionDto] })
  suggestions: IssueNodeSuggestionDto[];
}

/**
 * イシューノード検証状態設定リクエストDTO
 */
export class SetNodeVerificationRequestDto {
  @ApiProperty({ enum: NodeVerificationDto, example: 'CONFIRMED' })
  @IsEnum(NodeVerificationDto, {
    message:
      '検証状態はCONFIRMED, REJECTED, UNKNOWN, NEEDS_HEARING, NAのいずれかを指定してください',
  })
  verification: NodeVerificationDto;

  @ApiPropertyOptional({ example: 'アンケート結果より', description: '根拠', nullable: true })
  @IsOptional()
  @IsString()
  evidence?: string | null;
}

/**
 * イシューノードレスポンスDTO
 */
export class IssueNodeResponseDto {
  @ApiProperty({ example: 'uuid-xxxx-xxxx' })
  id: string;

  @ApiProperty({ example: 'uuid-tree-xxxx' })
  treeId: string;

  @ApiProperty({ example: 'uuid-parent-node', nullable: true })
  parentId: string | null;

  @ApiProperty({ example: 0, description: '階層の深さ' })
  depth: number;

  @ApiProperty({ example: 0, description: '兄弟内の表示順序' })
  order: number;

  @ApiProperty({ example: 'オンボーディングが分かりにくい' })
  label: string;

  @ApiProperty({ enum: IssueNodeKindDto, example: 'ISSUE' })
  kind: IssueNodeKindDto;

  @ApiProperty({ enum: NodeVerificationDto, example: 'NA' })
  verification: NodeVerificationDto;

  @ApiProperty({ enum: NodeRecommendationDto, example: 'NA' })
  recommendation: NodeRecommendationDto;

  @ApiProperty({ example: 'アンケート結果より', nullable: true })
  evidence: string | null;

  @ApiProperty({ example: 'uuid-why-node', nullable: true })
  rootCauseNodeId: string | null;

  @ApiProperty({ example: {} })
  metadata: Record<string, unknown>;

  @ApiProperty()
  createdAt?: Date;

  @ApiProperty()
  updatedAt?: Date;
}

/**
 * プロジェクト横断イシューノード一覧の要素DTO（タスク紐付けセレクタ用）
 */
export class ProjectIssueNodeListItemDto {
  @ApiProperty({ example: 'uuid-node-xxxx' })
  id: string;

  @ApiProperty({ example: 'オンボーディングが分かりにくい' })
  label: string;

  @ApiProperty({ enum: IssueNodeKindDto, example: 'CAUSE' })
  kind: IssueNodeKindDto;

  @ApiProperty({ example: 'uuid-tree-xxxx', description: '所属イシューツリーID' })
  treeId: string;

  @ApiProperty({ example: '解約率が高い', description: '所属イシューツリー名' })
  treeTitle: string;
}

/**
 * ノード付きイシューツリーレスポンスDTO
 */
export class IssueTreeWithNodesResponseDto {
  @ApiProperty({ example: 'uuid-xxxx-xxxx' })
  id: string;

  @ApiProperty({ example: 'uuid-project-xxxx' })
  projectId: string;

  @ApiProperty({ example: 'WHY' })
  type: string;

  @ApiProperty({ enum: IssueTreePatternDto, example: 'ISSUE_POINT' })
  pattern: IssueTreePatternDto;

  @ApiProperty({ example: '解約率が高い' })
  name: string;

  @ApiProperty({ example: 'なぜ解約率が高いのか？', nullable: true })
  rootQuestion: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [IssueNodeResponseDto] })
  nodes: IssueNodeResponseDto[];
}
