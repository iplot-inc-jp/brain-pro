import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import {
  ProjectAccessService,
  RequiredAccess,
} from '../../infrastructure/services/project-access.service';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';

/**
 * プロジェクト単位アクセス制御ガード。
 *
 * 運用: @ProjectScopedAccess() を付けたコントローラに @UseGuards(ProjectAccessGuard)
 * をクラスで適用する。
 *
 * 振る舞い:
 *   - request.params.projectId から projectId を解決
 *     （ProjectController 詳細ルートだけ params.id を許可）。
 *   - projectId が取れないルートは true（素通り。既存チェックに委ねる）。
 *   - メソッド別の必要レベル: GET/HEAD → view、POST/PUT/PATCH/DELETE → edit。
 *   - request.user 不在（@Public / 認証不要 / JwtAuthGuard 未通過）なら素通り。
 *   - 不足なら ForbiddenException(403)。
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  // prisma はフラットなナレッジ系 :id ルートの projectId 解決にのみ使う。
  // 既存テスト（params.projectId を持つルート）は prisma 不要のため optional。
  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 認証情報が無いルート（@Public 等）には干渉しない。JwtAuthGuard に委ねる。
    const user = request.user as { id?: string } | undefined;
    if (!user || !user.id) {
      return true;
    }

    const projectId = await this.resolveProjectId(context, request);
    if (!projectId) {
      // projectId 非依存ルートは素通り（既存チェックに委ねる）。
      return true;
    }

    const required = this.requiredLevel(request.method);
    const level = await this.projectAccess.resolveProjectAccess(
      projectId,
      user.id,
    );
    if (this.projectAccess.satisfies(level, required)) {
      return true;
    }

    throw new ForbiddenException(
      required === 'edit'
        ? 'You do not have edit access to this project'
        : 'You do not have access to this project',
    );
  }

  /**
   * params.projectId を最優先で解決。
   * ProjectByIdController（GET /projects/:id 詳細）だけ params.id を projectId とみなす。
   * フラットなナレッジ系ルート（knowledge-nodes/:id, knowledge-documents/:id,
   * knowledge-relations/:id）は params に projectId が無いため、エンティティを
   * load して projectId を解決する（解決不能だと認可が素通りになるため）。
   */
  private async resolveProjectId(
    context: ExecutionContext,
    request: { params?: Record<string, string> },
  ): Promise<string | undefined> {
    const params = request.params ?? {};
    if (params.projectId) {
      return params.projectId;
    }
    const className = context.getClass().name;
    if (params.id && className === 'ProjectByIdController') {
      return params.id;
    }
    if (params.id) {
      return this.resolveKnowledgeProjectId(className, params.id);
    }
    return undefined;
  }

  /**
   * フラットなナレッジ系コントローラの params.id からエンティティの projectId を解決。
   * 該当エンティティが無い / 対象外コントローラなら undefined（素通り → use-case 側で 404）。
   */
  private async resolveKnowledgeProjectId(
    className: string,
    id: string,
  ): Promise<string | undefined> {
    if (!this.prisma) return undefined;
    let row: { projectId: string } | null = null;
    if (className === 'KnowledgeNodeController') {
      row = await this.prisma.knowledgeNode.findUnique({
        where: { id },
        select: { projectId: true },
      });
    } else if (className === 'KnowledgeDocumentController') {
      row = await this.prisma.knowledgeDocument.findUnique({
        where: { id },
        select: { projectId: true },
      });
    } else if (className === 'KnowledgeRelationController') {
      row = await this.prisma.knowledgeRelation.findUnique({
        where: { id },
        select: { projectId: true },
      });
    }
    return row?.projectId ?? undefined;
  }

  private requiredLevel(method: string): RequiredAccess {
    const m = (method ?? 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD' ? 'view' : 'edit';
  }
}
