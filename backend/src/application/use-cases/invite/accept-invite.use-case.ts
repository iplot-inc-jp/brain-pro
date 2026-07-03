import { Inject, Injectable } from '@nestjs/common';
import {
  OrganizationInviteRepository,
  ORGANIZATION_INVITE_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  evaluateInviteValidity,
  EntityNotFoundError,
  ValidationError,
} from '../../../domain';

export interface AcceptInviteInput {
  token: string;
  userId: string;
}

export interface AcceptInviteOutput {
  organizationId: string;
  alreadyMember: boolean;
}

/**
 * 招待リンクを受理して、現在のユーザーを会社に参加させる（冪等）。
 */
@Injectable()
export class AcceptInviteUseCase {
  constructor(
    @Inject(ORGANIZATION_INVITE_REPOSITORY)
    private readonly inviteRepository: OrganizationInviteRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: AcceptInviteInput): Promise<AcceptInviteOutput> {
    const invite = await this.inviteRepository.findByToken(input.token);
    const validity = evaluateInviteValidity(invite, new Date());

    if (!invite || validity.reason === 'notfound') {
      throw new EntityNotFoundError('Invite', input.token);
    }
    if (!validity.valid) {
      const messages: Record<string, string> = {
        revoked: 'この招待リンクは無効化されています',
        expired: 'この招待リンクは有効期限が切れています',
        maxed: 'この招待リンクは利用上限に達しています',
      };
      throw new ValidationError(messages[validity.reason ?? 'expired'] ?? '無効な招待リンクです');
    }

    const existingRole = await this.organizationRepository.getMemberRole(
      invite.organizationId,
      input.userId,
    );
    if (existingRole) {
      return { organizationId: invite.organizationId, alreadyMember: true };
    }

    await this.organizationRepository.addMember(invite.organizationId, {
      userId: input.userId,
      role: invite.role,
    });
    await this.inviteRepository.incrementUseCount(invite.id);

    return { organizationId: invite.organizationId, alreadyMember: false };
  }
}
