import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository, USER_REPOSITORY,
  OrganizationRepository, ORGANIZATION_REPOSITORY,
  OrganizationInviteRepository, ORGANIZATION_INVITE_REPOSITORY,
} from '../../../domain';
import { assertOrgAdmin } from './assert-org-admin';
import { assertInviteOrgScope } from './assert-org-scope';
import { InviteView, toInviteView } from './invite-view';
import { AccessPrincipal } from '../../../infrastructure/services/project-access.service';

export interface ListInvitesInput {
  organizationId: string;
  requesterUserId: string;
  // リクエスト主体（会社スコープトークン / サービスアカウントAPIキーの越境をここで弾く）。
  principal: AccessPrincipal;
}

@Injectable()
export class ListInvitesUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizationRepository: OrganizationRepository,
    @Inject(ORGANIZATION_INVITE_REPOSITORY) private readonly inviteRepository: OrganizationInviteRepository,
  ) {}

  async execute(input: ListInvitesInput): Promise<InviteView[]> {
    // 会社スコープ越境防止（route param :organizationId はガードで強制されない）。
    assertInviteOrgScope(input.principal, input.organizationId);
    await assertOrgAdmin(this.userRepository, this.organizationRepository, input.organizationId, input.requesterUserId);
    const now = new Date();
    const records = await this.inviteRepository.findByOrganizationId(input.organizationId);
    return records.map((r) => toInviteView(r, now));
  }
}
