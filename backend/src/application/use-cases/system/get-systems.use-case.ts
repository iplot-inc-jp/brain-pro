import { Inject, Injectable } from '@nestjs/common';
import {
  ISystemRepository,
  SYSTEM_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { SystemOutput, toSystemOutput } from './system.output';

export interface GetSystemsInput {
  userId: string;
  projectId: string;
}

/**
 * プロジェクトのシステム一覧取得ユースケース
 */
@Injectable()
export class GetSystemsUseCase {
  constructor(
    @Inject(SYSTEM_REPOSITORY)
    private readonly systemRepository: ISystemRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: GetSystemsInput): Promise<SystemOutput[]> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const systems = await this.systemRepository.findByProjectId(input.projectId);

    return systems.map((s) => toSystemOutput(s));
  }
}
