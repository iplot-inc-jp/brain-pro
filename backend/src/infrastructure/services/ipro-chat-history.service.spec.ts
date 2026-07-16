import { Prisma } from '@prisma/client';
import { IproChatHistoryService } from './ipro-chat-history.service';

function documentRow(id: string, occurredAt: string) {
  return {
    id,
    source: 'chat',
    sourceRef: `line:room-1:${id}`,
    platform: 'line',
    roomId: 'room-1',
    roomName: '営業部',
    authorId: 'user-1',
    authorName: '山田',
    title: '営業部',
    content: '見積条件を確認しました',
    hasMedia: false,
    occurredAt: new Date(occurredAt),
    eventId: `evt-${id}`,
    metadata: {},
    messageId: `message-row-${id}`,
  };
}

function sqlText(sql: Prisma.Sql): string {
  return sql.strings.join('?');
}

function makePrisma() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    iproActivityMessage: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;
}

describe('IproChatHistoryService', () => {
  it('parameterizes Japanese partial match, escaped wildcards, and all filters', async () => {
    const prisma = makePrisma();
    const service = new IproChatHistoryService(prisma);

    await service.search('project-1', {
      q: '見積%_\\',
      sources: ['chat', 'document'],
      platforms: ['line', 'slack'],
      roomIds: ['room-1', 'room-2'],
      authors: ['user-1', '山田'],
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-17T23:59:59.999Z',
      hasMedia: true,
      sort: 'desc',
      limit: 25,
    });

    const query = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const text = sqlText(query);
    expect(text).toContain('ILIKE');
    expect(text).toContain('ESCAPE');
    expect(text).toContain('d.source IN');
    expect(text).toContain('d.platform IN');
    expect(text).toContain('d.room_id IN');
    expect(text).toContain('d.author_id IN');
    expect(text).toContain('d.occurred_at >=');
    expect(text).toContain('d.occurred_at <=');
    expect(text).toContain('d.has_media =');
    expect(text).not.toContain('見積');
    expect(query.values).toContain('%見積\\%\\_\\\\%');
    expect(query.values).toEqual(
      expect.arrayContaining([
        'project-1',
        'chat',
        'document',
        'line',
        'slack',
        'room-1',
        'room-2',
        'user-1',
        '山田',
        true,
      ]),
    );
  });

  it('uses stable occurredAt/id cursor ordering and caps limit at 100', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValueOnce(
      Array.from({ length: 101 }, (_, index) =>
        documentRow(`id-${String(index).padStart(3, '0')}`, `2026-07-17T00:${String(index % 60).padStart(2, '0')}:00.000Z`),
      ),
    );
    const service = new IproChatHistoryService(prisma);

    const first = await service.search('project-1', { limit: 500, sort: 'desc' });

    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toEqual(expect.any(String));
    const firstQuery = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sqlText(firstQuery)).toContain('ORDER BY d.occurred_at DESC, d.id DESC');
    expect(firstQuery.values).toContain(101);

    prisma.$queryRaw.mockResolvedValueOnce([]);
    await service.search('project-1', {
      cursor: first.nextCursor!,
      limit: 100,
      sort: 'desc',
    });
    const secondQuery = prisma.$queryRaw.mock.calls[1][0] as Prisma.Sql;
    expect(sqlText(secondQuery)).toContain('(d.occurred_at, d.id) <');
    expect(secondQuery.values).toEqual(
      expect.arrayContaining([expect.any(Date), first.items[99].id]),
    );
  });

  it('returns source/platform/room/author facets under the current non-own filters', async () => {
    const prisma = makePrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ key: 'chat', label: 'chat', count: BigInt(7) }])
      .mockResolvedValueOnce([{ key: 'line', label: 'line', count: BigInt(5) }])
      .mockResolvedValueOnce([{ key: 'room-1', label: '営業部', count: BigInt(4) }])
      .mockResolvedValueOnce([{ key: 'user-1', label: '山田', count: BigInt(3) }]);
    const service = new IproChatHistoryService(prisma);

    const result = await service.facets('project-1', {
      q: '見積',
      sources: ['chat'],
      platforms: ['line'],
      roomIds: ['room-1'],
      authors: ['user-1'],
    });

    expect(result).toEqual({
      sources: [{ key: 'chat', label: 'chat', count: 7 }],
      platforms: [{ key: 'line', label: 'line', count: 5 }],
      rooms: [{ key: 'room-1', label: '営業部', count: 4 }],
      authors: [{ key: 'user-1', label: '山田', count: 3 }],
    });
    const [sourceQuery, platformQuery, roomQuery, authorQuery] =
      prisma.$queryRaw.mock.calls.map(([query]: [Prisma.Sql]) => query);
    expect(sourceQuery.values).not.toContain('chat');
    expect(sourceQuery.values).toContain('line');
    expect(platformQuery.values).not.toContain('line');
    expect(platformQuery.values).toContain('chat');
    expect(roomQuery.values).not.toContain('room-1');
    expect(authorQuery.values).not.toContain('user-1');
  });

  it('returns the selected message with ten chronological messages before and after', async () => {
    const prisma = makePrisma();
    const selected = {
      id: 'message-11',
      projectId: 'project-1',
      activityRoomId: 'room-row-1',
      sentAt: new Date('2026-07-17T01:00:00.000Z'),
    };
    prisma.iproActivityMessage.findFirst.mockResolvedValue(selected);
    const beforeDesc = Array.from({ length: 10 }, (_, index) => ({
      ...selected,
      id: `message-${10 - index}`,
    }));
    const afterAsc = Array.from({ length: 10 }, (_, index) => ({
      ...selected,
      id: `message-${12 + index}`,
    }));
    prisma.iproActivityMessage.findMany
      .mockResolvedValueOnce(beforeDesc)
      .mockResolvedValueOnce(afterAsc);
    const service = new IproChatHistoryService(prisma);

    const result = await service.context('project-1', 'message-11');

    expect(result.selected.id).toBe('message-11');
    expect(result.before.map((item) => item.id)).toEqual([
      'message-1', 'message-2', 'message-3', 'message-4', 'message-5',
      'message-6', 'message-7', 'message-8', 'message-9', 'message-10',
    ]);
    expect(result.after).toHaveLength(10);
    expect(prisma.iproActivityMessage.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 10, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }] }),
    );
    expect(prisma.iproActivityMessage.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ take: 10, orderBy: [{ sentAt: 'asc' }, { id: 'asc' }] }),
    );
  });
});
