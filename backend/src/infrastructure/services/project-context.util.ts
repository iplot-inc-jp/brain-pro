import { PrismaService } from '../persistence/prisma/prisma.service';

/**
 * 自然言語→図生成のプロンプトに注入するプロジェクト前提情報を組み立てる。
 * 既存のロール/システム/情報種別の名前を渡すことで、生成結果の表記ゆれ（同義の新規乱造）を防ぐ。
 */
export async function buildProjectContextText(
  prisma: PrismaService,
  projectId: string,
): Promise<string> {
  const [roles, systems, infoTypes] = await Promise.all([
    prisma.role.findMany({
      where: { projectId },
      select: { name: true },
      orderBy: { name: 'asc' },
      take: 50,
    }),
    prisma.system.findMany({
      where: { projectId },
      select: { name: true },
      orderBy: { name: 'asc' },
      take: 50,
    }),
    prisma.informationType.findMany({
      where: { projectId },
      select: { name: true },
      orderBy: { name: 'asc' },
      take: 100,
    }),
  ]);
  const lines: string[] = [];
  if (roles.length) lines.push(`既存ロール（レーン）: ${roles.map((r) => r.name).join(' / ')}`);
  if (systems.length) lines.push(`既存システム: ${systems.map((s) => s.name).join(' / ')}`);
  if (infoTypes.length)
    lines.push(`情報種別（INPUT/OUTPUT）: ${infoTypes.map((t) => t.name).join(' / ')}`);
  return lines.join('\n');
}
