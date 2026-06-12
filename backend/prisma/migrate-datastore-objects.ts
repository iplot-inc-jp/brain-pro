/**
 * データストア＝オブジェクト統合の backfill マイグレーション（冪等）。
 *
 * kind=DATA_STORE かつ dataObjectId=null の DfdNode を、ラベルと同名の
 * DataObject に get-or-create でリンクする（wave34 以前に作られたノードや
 * 「未設定」解除で外れたノードの救済）。ラベルが空のノードはスキップして報告。
 *
 * 実行: npm run migrate:datastore-objects
 * 本番: DATABASE_URL を本番（Neon は UNPOOLED 推奨）に向けて同コマンド。
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function getOrCreateByName(projectId: string, name: string): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.dataObject.findUnique({
    where: { projectId_name: { projectId, name } },
  });
  if (existing) return { id: existing.id, created: false };
  const agg = await prisma.dataObject.aggregate({ where: { projectId }, _max: { order: true } });
  const order = agg._max.order === null ? 0 : agg._max.order + 1;
  try {
    const created = await prisma.dataObject.create({
      data: { id: randomUUID(), projectId, name, order },
    });
    return { id: created.id, created: true };
  } catch (e) {
    // 並行作成の一意制約（P2002）→ 勝者を読み直す
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const winner = await prisma.dataObject.findUnique({
        where: { projectId_name: { projectId, name } },
      });
      if (winner) return { id: winner.id, created: false };
    }
    throw e;
  }
}

async function main() {
  const orphans = await prisma.dfdNode.findMany({
    where: { kind: 'DATA_STORE', dataObjectId: null },
    include: { diagram: { select: { projectId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`未リンクの DATA_STORE ノード: ${orphans.length} 件`);

  let linked = 0;
  let createdObjects = 0;
  let skipped = 0;
  for (const node of orphans) {
    const name = node.label.trim();
    if (!name) {
      skipped += 1;
      console.warn(`  skip（ラベル空）: node ${node.id}`);
      continue;
    }
    const { id: objectId, created } = await getOrCreateByName(node.diagram.projectId, name);
    await prisma.dfdNode.update({ where: { id: node.id }, data: { dataObjectId: objectId } });
    linked += 1;
    if (created) createdObjects += 1;
    console.log(`  link: "${name}" (node ${node.id}) -> object ${objectId}${created ? ' [新規作成]' : ''}`);
  }
  console.log(
    `完了: リンク ${linked} 件（うちオブジェクト新規作成 ${createdObjects} 件）、スキップ ${skipped} 件`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
