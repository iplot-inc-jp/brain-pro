import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { TokenService, TOKEN_SERVICE } from '../../domain';
import { PrismaService } from '../persistence/prisma/prisma.service';

/** 共有対象の種別。 */
export const SHARE_KINDS = ['FLOW', 'DFD', 'OBJECT_MAP', 'ISSUE_TREE'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** 公開範囲。PUBLIC=リンクを知っていれば誰でも / ORG=同組織のログインユーザーのみ。 */
export const SHARE_SCOPES = ['PUBLIC', 'ORG'] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

export interface ResolvedShareLink {
  id: string;
  projectId: string;
  kind: string;
  targetId: string;
  scope: string;
}

/**
 * 図の共有リンク（ShareLink テーブル）の共通ロジック。
 *
 * - issueToken: 共有トークンの発行（192bit乱数・base64url）
 * - resolveViewableLink: @Public な閲覧エンドポイントからの解決。
 *   scope=ORG のリンクは Authorization ヘッダの JWT を手動検証し、
 *   リンク先プロジェクトの組織メンバーであることを要求する
 *   （エンドポイント自体は @Public のため、認証はここで任意実施する）。
 */
@Injectable()
export class ShareLinkService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
  ) {}

  /** 共有トークンを生成（URLセーフ・十分に推測不能）。 */
  issueToken(): string {
    return randomBytes(24).toString('base64url');
  }

  /**
   * token + kind から共有リンクを解決し、scope に応じた閲覧可否を検証する。
   * - リンクが無い/種別不一致 → 404
   * - scope=ORG で未ログイン → 401（フロントはログイン誘導を表示）
   * - scope=ORG で別組織のユーザー → 403
   */
  async resolveViewableLink(
    kind: ShareKind,
    token: string,
    authorizationHeader?: string,
  ): Promise<ResolvedShareLink> {
    if (!token || token.length < 16) {
      throw new NotFoundException('共有リンクが無効です');
    }
    const link = await this.prisma.shareLink.findFirst({
      where: { token, kind },
    });
    if (!link) {
      throw new NotFoundException('共有リンクが無効です');
    }

    if (link.scope === 'ORG') {
      const userId = this.verifyBearer(authorizationHeader);
      if (!userId) {
        throw new UnauthorizedException(
          'この共有リンクは組織メンバー限定です。ログインしてから開いてください',
        );
      }
      const project = await this.prisma.project.findUnique({
        where: { id: link.projectId },
        select: { organizationId: true },
      });
      if (!project) {
        throw new NotFoundException('共有リンクが無効です');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      });
      if (!user?.isSuperAdmin) {
        const member = await this.prisma.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId: project.organizationId,
              userId,
            },
          },
          select: { id: true },
        });
        if (!member) {
          throw new ForbiddenException(
            'この共有リンクは組織メンバーのみ閲覧できます',
          );
        }
      }
    }

    return {
      id: link.id,
      projectId: link.projectId,
      kind: link.kind,
      targetId: link.targetId,
      scope: link.scope,
    };
  }

  /** Bearer JWT を検証して userId を返す（無し/不正は null）。 */
  private verifyBearer(header?: string): string | null {
    if (!header || !header.startsWith('Bearer ')) return null;
    const payload = this.tokenService.verifyToken(header.substring(7));
    return payload?.sub ?? null;
  }
}
