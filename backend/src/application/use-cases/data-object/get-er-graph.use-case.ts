import { Inject, Injectable } from '@nestjs/common';
import {
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
} from '../../../domain';
import { ErTableRow } from '../../../domain/repositories/data-object.repository';
import { authorizeProject } from './data-object-authz';
import { AccessPrincipal } from '../../../infrastructure/services/project-access.service';
import {
  ErGraphOutput,
  FkEdgeOutput,
  toDataObjectOutput,
  toErTableOutput,
  toObjectRelationOutput,
} from './data-object.output';

export interface GetErGraphInput { userId: string; principal: AccessPrincipal; projectId: string; }

/**
 * ER図グラフ取得。
 * objects（点線囲み）＋ 全 tables（columns 全件 order順）＋
 * fkEdges（Column.foreignKeyTable をプロジェクト内 Table.name で解決。未解決はスキップ）＋ relations。
 */
@Injectable()
export class GetErGraphUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  private buildFkEdges(tables: ErTableRow[]): FkEdgeOutput[] {
    const byName = new Map(tables.map((t) => [t.name, t] as const));
    // 大文字小文字違いのフォールバック（'Users' vs 'users'）。同名衝突は曖昧なので null を入れて使わない
    const byLowerName = new Map<string, ErTableRow | null>();
    for (const t of tables) {
      const key = t.name.toLowerCase();
      byLowerName.set(key, byLowerName.has(key) ? null : t);
    }
    const edges: FkEdgeOutput[] = [];
    for (const table of tables) {
      for (const column of table.columns) {
        if (!column.foreignKeyTable) continue; // 参照先テーブル名なし → 解決不能でスキップ
        const target =
          byName.get(column.foreignKeyTable) ??
          byLowerName.get(column.foreignKeyTable.toLowerCase()) ??
          null;
        if (!target) continue; // プロジェクト内に該当テーブルなし（または大文字小文字違いが曖昧）→ スキップ
        edges.push({
          sourceTableId: table.id,
          sourceColumnId: column.id,
          targetTableId: target.id,
          targetColumnName: column.foreignKeyColumn,
        });
      }
    }
    return edges;
  }

  async execute(input: GetErGraphInput): Promise<ErGraphOutput> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.principal);
    const [graph, tables] = await Promise.all([
      this.repo.findObjectGraph(input.projectId),
      this.repo.findErTables(input.projectId),
    ]);
    return {
      objects: graph.entries.map((e) => toDataObjectOutput(e.object, e.tables, e.dfdNodes)),
      tables: tables.map(toErTableOutput),
      fkEdges: this.buildFkEdges(tables),
      relations: graph.relations.map(toObjectRelationOutput),
    };
  }
}
