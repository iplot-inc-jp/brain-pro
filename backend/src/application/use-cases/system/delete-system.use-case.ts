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

export interface DeleteSystemInput {
  userId: string;
  systemId: string;
}

/**
 * システム削除ユースケース
 * 紐づく Role.systemId は onDelete に従う（schema 定義）。
 */
@Injectable()
export class DeleteSystemUseCase {
  constructor(
    @Inject(SYSTEM_REPOSITORY)
    private readonly systemRepository: ISystemRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: DeleteSystemInput): Promise<void> {
    const system = await this.systemRepository.findById(input.systemId);
    if (!system) {
      throw new EntityNotFoundError('System', input.systemId);
    }

    const project = await this.projectRepository.findById(system.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', system.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    await this.systemRepository.delete(input.systemId);
  }
}
