import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { DomainError } from '../../domain';
import { domainErrorToStatusAndCode } from '../filters/domain-exception.filter';

/** 記録対象の HTTP メソッド */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** メソッド → action の対応 */
const METHOD_ACTION: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

/** 記録しないパス（クエリ除去後のパスで判定） */
const EXCLUDED_PATTERNS: RegExp[] = [
  /^\/api\/auth\//, // 認証系（パスワード等を扱うため一切記録しない）
  /^\/api\/attachments\/[^/]+\/file$/, // 添付ファイル本体のアップロード/ダウンロード
  /^\/api\/projects\/[^/]+\/change-logs(\/|$)/, // ChangeLog 自身（自己記録の無限増殖防止）
];

interface RequestUserLike {
  id?: string;
  email?: string;
}

/** 全テーブルの id は @default(uuid()) なので UUID（＋念のため数値のみ）を ID とみなす */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIdLike(segment: string): boolean {
  return UUID_RE.test(segment) || /^\d+$/.test(segment);
}

/**
 * パスセグメントから entity（対象種別）を導出する。
 *
 * ID らしきセグメントを除いた「最後のリソース名」を採用する。これにより
 * - POST /api/tasks/:id/comments      → comments（旧実装では tasks と誤記録）
 * - POST /api/tasks/:id/attachments   → attachments
 * - POST /api/business-flows/:id/annotations → annotations
 * - PUT  /api/business-flows/:id/definition  → definition
 * のようにサブリソースが正しくラベルされる。
 */
function resolveEntity(segments: string[]): string | null {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (!isIdLike(segments[i])) return segments[i];
  }
  return segments[0] ?? null;
}

/**
 * トップレベルルート（パスに projectId を含まない）の
 * 「先頭リソース名（列）→ 直後の ID から projectId を引く」対応表。
 *
 * キーは最初の ID らしきセグメントより前のセグメントを '/' 連結したもの。
 * 例: PUT /api/tasks/:id            → キー 'tasks'
 *     DELETE /api/tasks/dependencies/:depId → キー 'tasks/dependencies'
 */
type ProjectIdLookup = (prisma: PrismaService, id: string) => Promise<string | null>;

const PROJECT_ID_LOOKUPS: Record<string, ProjectIdLookup> = {
  // --- projectId を直接持つテーブル ---
  tasks: async (p, id) =>
    (await p.task.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  risks: async (p, id) =>
    (await p.risk.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  'risk-categories': async (p, id) =>
    (await p.riskCategory.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  stakeholders: async (p, id) =>
    (await p.stakeholder.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  meetings: async (p, id) =>
    (await p.meeting.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  systems: async (p, id) =>
    (await p.system.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  constraints: async (p, id) =>
    (await p.constraint.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  'sub-projects': async (p, id) =>
    (await p.subProject.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  'interest-rows': async (p, id) =>
    (await p.interestMatrixRow.findUnique({ where: { id }, select: { projectId: true } }))
      ?.projectId ?? null,
  suppliers: async (p, id) =>
    (await p.supplier.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  products: async (p, id) =>
    (await p.product.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  'demand-data': async (p, id) =>
    (await p.demandData.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  'information-types': async (p, id) =>
    (await p.informationType.findUnique({ where: { id }, select: { projectId: true } }))
      ?.projectId ?? null,
  'gap-items': async (p, id) =>
    (await p.gapItem.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  'asis-memos': async (p, id) =>
    (await p.asisMemo.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  'tobe-visions': async (p, id) =>
    (await p.tobeVision.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  'tobe-roadmaps': async (p, id) =>
    (await p.tobeRoadmap.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  'report-calendars': async (p, id) =>
    (await p.reportCalendar.findUnique({ where: { id }, select: { projectId: true } }))
      ?.projectId ?? null,
  'roadmap-phases': async (p, id) =>
    (await p.roadmapPhase.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  phases: async (p, id) =>
    (await p.projectPhase.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  'flow-folders': async (p, id) =>
    (await p.flowFolder.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  requirements: async (p, id) =>
    (await p.requirement.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  roles: async (p, id) =>
    (await p.role.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  tables: async (p, id) =>
    (await p.table.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  'business-flows': async (p, id) =>
    (await p.businessFlow.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  'issue-trees': async (p, id) =>
    (await p.issueTree.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  attachments: async (p, id) =>
    (await p.attachment.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,
  'api-keys': async (p, id) =>
    (await p.apiKey.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ?? null,
  'dfd-diagrams': async (p, id) =>
    (await p.dfdDiagram.findUnique({ where: { id }, select: { projectId: true } }))?.projectId ??
    null,

  // --- 親をたどって projectId を引くテーブル ---
  'task-comments': async (p, id) =>
    (
      await p.taskComment.findUnique({
        where: { id },
        select: { task: { select: { projectId: true } } },
      })
    )?.task.projectId ?? null,
  'tasks/dependencies': async (p, id) =>
    (
      await p.taskDependency.findUnique({
        where: { id },
        select: { successor: { select: { projectId: true } } },
      })
    )?.successor.projectId ?? null,
  'business-flows/nodes': async (p, id) =>
    (
      await p.flowNode.findUnique({
        where: { id },
        select: { flow: { select: { projectId: true } } },
      })
    )?.flow.projectId ?? null,
  'business-flows/node-links': async (p, id) =>
    (
      await p.flowNodeLink.findUnique({
        where: { id },
        select: { node: { select: { flow: { select: { projectId: true } } } } },
      })
    )?.node.flow.projectId ?? null,
  'tables/crud-mappings': async (p, id) =>
    (
      await p.crudMapping.findUnique({
        where: { id },
        select: { column: { select: { table: { select: { projectId: true } } } } },
      })
    )?.column.table.projectId ?? null,
  'dfd-nodes': async (p, id) =>
    (
      await p.dfdNode.findUnique({
        where: { id },
        select: { diagram: { select: { projectId: true } } },
      })
    )?.diagram.projectId ?? null,
  'dfd-flows': async (p, id) =>
    (
      await p.dfdFlow.findUnique({
        where: { id },
        select: { diagram: { select: { projectId: true } } },
      })
    )?.diagram.projectId ?? null,

  // PUT /api/roles/project/:projectId/order — この UUID 自体が projectId
  'roles/project': (_p, id) => Promise.resolve(id),
};

/**
 * 自動変更履歴インターセプタ。
 *
 * /api/ 配下への書き込み系リクエスト（POST/PUT/PATCH/DELETE）を
 * ChangeLog テーブルに記録する。書き込みは fire-and-forget で行い、
 * リクエストのレイテンシには一切影響を与えない。
 *
 * projectId の解決（優先順）:
 * 1. パス /api/projects/:projectId/...
 * 2. トップレベルルート（/api/tasks/:id 等）は対応表でサーバ側 DB lookup
 *    （ハンドラ実行「前」に発行する。DELETE 後はレコードが消えて引けないため）
 * 3. ハンドラ戻り値の projectId（作成系のトップレベル POST 用）
 *
 * body.projectId は一切信用しない（クライアントが任意の projectId を注入して
 * 無関係なプロジェクトの履歴へ行を偽装できてしまうため）。
 */
@Injectable()
export class ChangeLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const method: string = (request.method ?? '').toUpperCase();
    if (!WRITE_METHODS.has(method)) {
      return next.handle(); // GET 等は記録しない
    }

    // クエリ文字列を除去したパス
    const rawUrl: string = request.originalUrl ?? request.url ?? '';
    const path = rawUrl.split('?')[0];

    if (!path.startsWith('/api/')) {
      return next.handle();
    }
    if (EXCLUDED_PATTERNS.some((re) => re.test(path))) {
      return next.handle();
    }

    const user = (request.user ?? {}) as RequestUserLike;
    const body = (request.body ?? {}) as Record<string, unknown>;

    // /api/ の次のセグメント群
    const segments = path.replace(/^\/api\//, '').split('/').filter(Boolean);
    const entity = resolveEntity(segments);

    // projectId はパス由来のみ信用する（body.projectId は偽装可能なため不使用）
    const pathProjectId =
      segments[0] === 'projects' && segments[1] && isIdLike(segments[1]) ? segments[1] : null;

    // トップレベルルートはハンドラ実行前に projectId を DB から引いておく。
    // await は fire-and-forget の writeLog 内でのみ行うため、レイテンシ影響なし。
    const lookupPromise = pathProjectId ? null : this.lookupProjectId(segments);

    // ハンドラ戻り値から拾った projectId（作成系トップレベル POST 用）
    let handlerProjectId: string | null = null;

    // body.title / name / label / event の先頭 80 文字を summary に
    let summary: string | null = null;
    for (const key of ['title', 'name', 'label', 'event'] as const) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) {
        summary = value.slice(0, 80);
        break;
      }
    }

    const writeLog = (statusCode: number | null): void => {
      // fire-and-forget: await せず、失敗してもリクエストには影響させない
      void (async () => {
        try {
          let projectId = pathProjectId;
          if (!projectId && lookupPromise) projectId = await lookupPromise;
          if (!projectId) projectId = handlerProjectId;
          await this.prisma.changeLog.create({
            data: {
              projectId,
              userId: user.id ?? null,
              userEmail: user.email ?? null,
              method,
              path,
              entity,
              action: METHOD_ACTION[method] ?? null,
              summary,
              statusCode,
            },
          });
        } catch (error) {
          console.error('[ChangeLogInterceptor] failed to write change log:', error);
        }
      })();
    };

    // tap/catchError 時点では Nest が最終ステータスを response に適用する前
    //（Express 既定 200）のため、response の 'finish'（送出完了）後に実コードを
    // 読む。finish が取れない環境ではメソッド/エラー由来の fallback を使う。
    let logged = false;
    const logOnce = (fallbackStatus: number): void => {
      if (logged) return;
      logged = true;
      const response = context.switchToHttp().getResponse() as {
        statusCode?: unknown;
        writableEnded?: unknown;
        once?: (event: string, listener: () => void) => void;
      } | null;
      const readStatus = (): number =>
        response && typeof response.statusCode === 'number'
          ? response.statusCode
          : fallbackStatus;
      if (response && typeof response.once === 'function') {
        if (response.writableEnded === true) {
          writeLog(readStatus());
          return;
        }
        let done = false;
        const onDone = (): void => {
          if (done) return;
          done = true;
          writeLog(readStatus());
        };
        response.once('finish', onDone);
        response.once('close', onDone); // 接続中断時も close で記録する
      } else {
        writeLog(fallbackStatus);
      }
    };

    const successFallback = method === 'POST' ? 201 : 200;

    return next.handle().pipe(
      tap({
        next: (data) => {
          const record = data as { projectId?: unknown; id?: unknown } | null | undefined;
          if (record && typeof record === 'object') {
            if (typeof record.projectId === 'string' && record.projectId) {
              handlerProjectId = record.projectId;
            } else if (entity === 'projects' && typeof record.id === 'string' && record.id) {
              // プロジェクト作成（POST /api/projects 等）は戻り値の id が projectId
              handlerProjectId = record.id;
            }
          }
          logOnce(successFallback);
        },
        complete: () => logOnce(successFallback),
      }),
      catchError((error: unknown) => {
        logOnce(resolveErrorStatus(error));
        return throwError(() => error);
      }),
    );
  }

  /**
   * トップレベルルートのパスから projectId を DB lookup する。
   * 該当する対応表がない・ID セグメントがない場合は null を返す。
   */
  private lookupProjectId(segments: string[]): Promise<string | null> | null {
    let idIndex = -1;
    for (let i = 1; i < segments.length; i += 1) {
      if (isIdLike(segments[i])) {
        idIndex = i;
        break;
      }
    }
    if (idIndex < 1) return null;
    const key = segments.slice(0, idIndex).join('/');
    const lookup = PROJECT_ID_LOOKUPS[key];
    if (!lookup) return null;
    return lookup(this.prisma, segments[idIndex]).catch((error) => {
      console.error('[ChangeLogInterceptor] projectId lookup failed:', error);
      return null;
    });
  }
}

/**
 * エラーから HTTP ステータスコードを推定する。
 * ドメイン例外は DomainExceptionFilter と同じ対応表で変換する
 * （EntityNotFoundError → 404, ForbiddenError → 403 等）。
 */
function resolveErrorStatus(error: unknown): number {
  if (error instanceof DomainError) {
    return domainErrorToStatusAndCode(error).status;
  }
  if (error && typeof error === 'object') {
    const maybe = error as { getStatus?: () => number; status?: unknown };
    if (typeof maybe.getStatus === 'function') {
      try {
        const status = maybe.getStatus();
        if (typeof status === 'number') return status;
      } catch {
        // fall through
      }
    }
    if (typeof maybe.status === 'number') {
      return maybe.status;
    }
  }
  return 500;
}
