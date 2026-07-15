import { Inject, Injectable } from '@nestjs/common';
import {
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  DataObject,
} from '../../../domain';
import { authorizeProject } from './data-object-authz';
import { AccessPrincipal, ProjectAccessService } from '../../../infrastructure/services/project-access.service';

export interface ImportFromDfdInput { userId: string; principal: AccessPrincipal; projectId: string; }

export interface ImportFromDfdOutput {
  /** 新規作成した DataObject 件数 */
  created: number;
  /** オブジェクトに紐づけた DFDノード件数 */
  linked: number;
}

/**
 * 第1レベルDFDの DATA_STORE ノード（dataObjectId=null）を走査し、
 * 同名 DataObject を get-or-create してノードに紐づける（冪等）。
 */
@Injectable()
export class ImportFromDfdUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: ImportFromDfdInput): Promise<ImportFromDfdOutput> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.principal, this.projectAccess, 'edit');

    const nodes = await this.repo.findL1DataStoreNodes(input.projectId);
    const unlinked = nodes.filter((n) => n.dataObjectId === null);

    let created = 0;
    let linked = 0;
    let order = await this.repo.nextOrder(input.projectId);
    // 同名ノードが複数あっても DataObject を重複生成しない
    const byName = new Map<string, DataObject>();

    for (const node of unlinked) {
      const name = node.label.trim();
      if (!name) continue;

      let object = byName.get(name);
      if (!object) {
        // 並行実行・手動POSTとの同名競合は repo 側で一意制約（P2002）を吸収し勝者を返す
        const result = await this.repo.getOrCreateByName(input.projectId, name, order);
        object = result.object;
        if (result.created) {
          order += 1;
          created += 1;
        }
      }
      byName.set(name, object);

      await this.repo.setDfdNodeObject(node.id, object.id);
      linked += 1;
    }

    return { created, linked };
  }
}
