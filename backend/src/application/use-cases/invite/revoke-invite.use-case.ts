import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository, USER_REPOSITORY,
  OrganizationRepository, ORGANIZATION_REPOSITORY,
  OrganizationInviteRepository, ORGANIZATION_INVITE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { assertOrgAdmin } from './assert-org-admin';

export interface RevokeInviteInput {
  organizationId: string;
  requesterUserId: string;
  inviteId: string;
}

@Injectable()
export class RevokeInviteUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizationRepository: OrganizationRepository,
    @Inject(ORGANIZATION_INVITE_REPOSITORY) private readonly inviteRepository: OrganizationInviteRepository,
  ) {}

  async execute(input: RevokeInviteInput): Promise<void> {
    await assertOrgAdmin(this.userRepository, this.organizationRepository, input.organizationId, input.requesterUserId);

    const invite = await this.inviteRepository.findById(input.inviteId);
    if (!invite || invite.organizationId !== input.organizationId) {
      throw new EntityNotFoundError('Invite', input.inviteId);
    }
    await this.inviteRepository.revoke(invite.id);
  }
}
