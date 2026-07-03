import { Inject, Injectable } from '@nestjs/common';
import {
  OrganizationInviteRepository, ORGANIZATION_INVITE_REPOSITORY,
  OrganizationRepository, ORGANIZATION_REPOSITORY,
  evaluateInviteValidity,
} from '../../../domain';

export interface PreviewInviteInput {
  token: string;
}

export interface PreviewInviteOutput {
  valid: boolean;
  reason: string | null;
  organizationName: string | null;
  role: string | null;
}

/**
 * 招待リンクのプレビュー（公開・機微情報を返さない）。
 */
@Injectable()
export class PreviewInviteUseCase {
  constructor(
    @Inject(ORGANIZATION_INVITE_REPOSITORY) private readonly inviteRepository: OrganizationInviteRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: PreviewInviteInput): Promise<PreviewInviteOutput> {
    const invite = await this.inviteRepository.findByToken(input.token);
    const validity = evaluateInviteValidity(invite, new Date());

    if (!invite) {
      return { valid: false, reason: 'notfound', organizationName: null, role: null };
    }

    const org = await this.organizationRepository.findById(invite.organizationId);
    return {
      valid: validity.valid,
      reason: validity.reason,
      organizationName: org?.name ?? null,
      role: invite.role,
    };
  }
}
