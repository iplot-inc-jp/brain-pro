import { Inject, Injectable } from '@nestjs/common';
import {
  IIngestionFileRepository,
  INGESTION_FILE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  IngestionFileOutput,
  toIngestionFileOutput,
} from './ingestion-output';

export interface SkipFileInput {
  userId: string;
  id: string;
  reason?: string | null;
}

/**
 * 個別ファイルの手動スキップ。
 * 当該ファイルを SKIPPED にして理由を step に残す（無音で飛ばさない方針）。
 */
@Injectable()
export class SkipFileUseCase {
  constructor(
    @Inject(INGESTION_FILE_REPOSITORY)
    private readonly fileRepository: IIngestionFileRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: SkipFileInput): Promise<IngestionFileOutput> {
    const file = await this.fileRepository.findById(input.id);
    if (!file) {
      throw new EntityNotFoundError('IngestionFile', input.id);
    }
    await this.projectAccess.assertProjectAccess(
      file.projectId,
      input.userId,
      'edit',
    );

    file.skip(input.reason ?? '手動スキップ');
    await this.fileRepository.save(file);

    return toIngestionFileOutput(file);
  }
}
