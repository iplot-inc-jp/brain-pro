import { Injectable } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { CryptoService } from './crypto.service';

export interface ResolvedGateway {
  baseUrl: string;
  apiToken: string;
  strict: boolean;
  organizationId: string | null;
}

/** projectId から組織の ipro-bot ゲートウェイ接続設定を解決する。DB設定 > env、明示OFFは env より優先。 */
@Injectable()
export class IproBotGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async resolveForProject(
    projectId: string | null | undefined,
  ): Promise<ResolvedGateway | null> {
    if (!projectId) return this.envGateway(null);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project) return this.envGateway(null);

    const conn = await this.prisma.iproBotConnection.findUnique({
      where: { organizationId: project.organizationId },
    });
    if (conn) {
      if (!conn.enabled) return null; // 明示OFF
      return {
        baseUrl: conn.baseUrl,
        apiToken: this.crypto.decrypt(conn.apiTokenEnc),
        strict: conn.strict,
        organizationId: project.organizationId,
      };
    }
    return this.envGateway(project.organizationId);
  }

  private envGateway(organizationId: string | null): ResolvedGateway | null {
    const baseUrl = process.env.IPRO_BOT_URL;
    const apiToken = process.env.IPRO_BOT_API_TOKEN;
    if (!baseUrl || !apiToken) return null;
    return { baseUrl, apiToken, strict: false, organizationId };
  }
}
