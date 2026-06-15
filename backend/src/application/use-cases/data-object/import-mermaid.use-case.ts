import { Inject, Injectable } from '@nestjs/common';
import {
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  ValidationError,
  DataObject,
  DataObjectRelation,
} from '../../../domain';
import { RelationCardinalityValue } from '../../../domain/entities/data-object-relation.entity';
import {
  ClaudeService,
  ObjectMapCardinality,
} from '../../../infrastructure/services/claude.service';
import { CompanyKeyService } from '../../../infrastructure/services/company-key.service';
import { authorizeProject } from './data-object-authz';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { ObjectGraphOutput, toObjectGraphOutput } from './data-object.output';

export interface ImportMermaidInput {
  userId: string;
  projectId: string;
  mermaid: string;
}

/** グリッド配置パラメータ（import-from-dfd と同様の単純グリッド） */
const GRID_COLS = 4;
const GRID_DX = 280;
const GRID_DY = 200;
const VALID_CARDINALITIES: ObjectMapCardinality[] = [
  'ONE_TO_ONE',
  'ONE_TO_MANY',
  'MANY_TO_MANY',
];

/**
 * Mermaid（erDiagram / classDiagram / flowchart）を AI で解析し、
 * オブジェクトを get-or-create（グリッド配置）→ 関係を名前解決して作成（冪等）。
 * 鍵未設定時は ValidationError（コントローラで 400 に変換）。
 */
@Injectable()
export class ImportMermaidUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly claude: ClaudeService,
    private readonly companyKey: CompanyKeyService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: ImportMermaidInput): Promise<ObjectGraphOutput> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.userId, this.projectAccess, 'edit');

    const mermaid = input.mermaid?.trim();
    if (!mermaid) {
      throw new ValidationError('Mermaid テキストが空です');
    }

    const apiKey = await this.companyKey.resolveForProject(input.projectId, input.userId);
    if (!apiKey) {
      // コントローラ側で 400 に変換（鍵未設定の分かりやすいメッセージ）
      throw new ValidationError('Anthropic APIキーが未設定です');
    }

    const parsed = await this.claude.parseMermaidToObjectMap(mermaid, apiKey, {
      projectId: input.projectId,
      area: 'MERMAID_OBJECT',
      userId: input.userId,
    });

    // 1. オブジェクトを get-or-create（グリッド配置・order 連番）
    let order = await this.repo.nextOrder(input.projectId);
    const objectByName = new Map<string, DataObject>();
    let gridIndex = 0;

    for (const obj of parsed.objects) {
      const name = obj?.name?.trim();
      if (!name) continue;
      if (objectByName.has(name)) continue;

      const result = await this.repo.getOrCreateByName(input.projectId, name, order);
      let object = result.object;
      if (result.created) {
        // グリッド配置 + 説明を反映して保存
        const col = gridIndex % GRID_COLS;
        const row = Math.floor(gridIndex / GRID_COLS);
        object.updatePosition(col * GRID_DX, row * GRID_DY);
        if (obj.description && obj.description.trim()) {
          object.updateDescription(obj.description.trim());
        }
        await this.repo.save(object);
        order += 1;
        gridIndex += 1;
      }
      objectByName.set(name, object);
    }

    // 既存オブジェクト（再取得せず、名前解決のために一覧から補完）も map に載せる
    const graphBefore = await this.repo.findObjectGraph(input.projectId);
    for (const entry of graphBefore.entries) {
      if (!objectByName.has(entry.object.name)) {
        objectByName.set(entry.object.name, entry.object);
      }
    }

    // 2. 関係を名前解決して作成（source=target / 端点欠落 / 重複はスキップ）
    for (const rel of parsed.relations) {
      const sourceName = rel?.source?.trim();
      const targetName = rel?.target?.trim();
      if (!sourceName || !targetName || sourceName === targetName) continue;

      const source = objectByName.get(sourceName);
      const target = objectByName.get(targetName);
      if (!source || !target) continue;

      const existing = await this.repo.findRelationByEndpoints(
        input.projectId,
        source.id,
        target.id,
      );
      if (existing) continue;

      const cardinality: RelationCardinalityValue =
        rel.cardinality && VALID_CARDINALITIES.includes(rel.cardinality)
          ? rel.cardinality
          : 'ONE_TO_MANY';

      const relation = DataObjectRelation.create(
        {
          projectId: input.projectId,
          sourceObjectId: source.id,
          targetObjectId: target.id,
          cardinality,
          label: rel.label?.trim() || null,
          description: null,
          pathStyle: null,
          sourceHandle: null,
          targetHandle: null,
        },
        this.repo.generateId(),
      );
      await this.repo.saveRelation(relation);
    }

    // 3. 更新後の関係性マップを返す
    const graph = await this.repo.findObjectGraph(input.projectId);
    return toObjectGraphOutput(graph);
  }
}
