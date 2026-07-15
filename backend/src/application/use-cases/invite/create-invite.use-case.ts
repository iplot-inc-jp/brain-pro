import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository, USER_REPOSITORY,
  OrganizationRepository, ORGANIZATION_REPOSITORY,
  OrganizationInviteRepository, ORGANIZATION_INVITE_REPOSITORY,
} from '../../../domain';
import { assertOrgAdmin } from './assert-org-admin';
import { assertInviteOrgScope } from './assert-org-scope';
import { normalizeMemberRole } from './normalize-member-role';
import { InviteView, toInviteView } from './invite-view';
import { AccessPrincipal } from '../../../infrastructure/services/project-access.service';

export interface CreateInviteInput {
  organizationId: string;
  requesterUserId: string;
  // リクエスト主体（会社スコープトークン / サービスアカウントAPIキーの越境をここで弾く）。
  principal: AccessPrincipal;
  role?: string;
  expiresInDays?: number;
  maxUses?: number;
}

@Injectable()
export class CreateInviteUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizationRepository: OrganizationRepository,
    @Inject(ORGANIZATION_INVITE_REPOSITORY) private readonly inviteRepository: OrganizationInviteRepository,
  ) {}

  async execute(input: CreateInviteInput): Promise<InviteView> {
    // 会社スコープ越境防止（route param :organizationId はガードで強制されない）。
    assertInviteOrgScope(input.principal, input.organizationId);
    await assertOrgAdmin(this.userRepository, this.organizationRepository, input.organizationId, input.requesterUserId);

    const now = new Date();
    const expiresAt =
      input.expiresInDays && input.expiresInDays > 0
        ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const record = await this.inviteRepository.create({
      id: this.inviteRepository.generateId(),
      organizationId: input.organizationId,
      token: this.inviteRepository.generateToken(),
      role: normalizeMemberRole(input.role),
      createdByUserId: input.requesterUserId,
      expiresAt,
      maxUses: input.maxUses ?? null,
    });

    return toInviteView(record, now);
  }
}
