import { Inject, Injectable } from '@nestjs/common';
import {
  Role,
  RoleType,
  RoleRepository,
  ROLE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';

export interface UpdateRoleInput {
  id: string;
  name?: string;
  type?: RoleType;
  description?: string | null;
  color?: string | null;
  responsibility?: string | null;
  decisionScope?: string | null;
  kpi?: string | null;
  order?: number;
  laneHeight?: number;
  // 所属システム / サブ領域（共通マスタ基盤。任意）
  systemId?: string | null;
  subProjectId?: string | null;
}

export interface RoleResponse {
  id: string;
  projectId: string;
  name: string;
  type: RoleType;
  description: string | null;
  color: string | null;
  order: number;
  laneHeight: number;
  responsibility: string | null;
  decisionScope: string | null;
  kpi: string | null;
  // 所属システム / サブ領域（共通マスタ基盤。任意）
  systemId: string | null;
  subProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ロール → レスポンス DTO マッパー
 */
export function toRoleResponse(role: Role): RoleResponse {
  return {
    id: role.id,
    projectId: role.projectId,
    name: role.name,
    type: role.type,
    description: role.description,
    color: role.color,
    order: role.order,
    laneHeight: role.laneHeight,
    responsibility: role.responsibility,
    decisionScope: role.decisionScope,
    kpi: role.kpi,
    systemId: role.systemId,
    subProjectId: role.subProjectId,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

/**
 * ロール更新ユースケース
 */
@Injectable()
export class UpdateRoleUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepository: RoleRepository,
  ) {}

  async execute(input: UpdateRoleInput): Promise<RoleResponse> {
    // 1. ロール存在確認
    const role = await this.roleRepository.findById(input.id);
    if (!role) {
      throw new EntityNotFoundError('Role', input.id);
    }

    // 2. ドメインロジック適用
    if (input.name !== undefined) {
      role.changeName(input.name);
    }
    if (input.type !== undefined) {
      role.changeType(input.type);
    }
    if (input.description !== undefined) {
      role.changeDescription(input.description);
    }
    if (input.color !== undefined) {
      role.changeColor(input.color);
    }
    if (input.responsibility !== undefined) {
      role.changeResponsibility(input.responsibility);
    }
    if (input.decisionScope !== undefined) {
      role.changeDecisionScope(input.decisionScope);
    }
    if (input.kpi !== undefined) {
      role.changeKpi(input.kpi);
    }
    if (input.systemId !== undefined) {
      role.changeSystemId(input.systemId);
    }
    if (input.subProjectId !== undefined) {
      role.changeSubProjectId(input.subProjectId);
    }
    if (input.order !== undefined) {
      role.changeOrder(input.order);
    }
    if (input.laneHeight !== undefined) {
      role.changeLaneHeight(input.laneHeight);
    }

    // 3. 永続化
    await this.roleRepository.save(role);

    // 4. 出力返却
    return toRoleResponse(role);
  }
}
