import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IproActivityMessage, Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { QueryChatHistoryDto } from '../../presentation/dto/ipro-chat-history';

export interface ChatHistoryItem {
  id: string;
  source: string;
  sourceRef: string;
  platform: string | null;
  roomId: string | null;
  roomName: string | null;
  authorId: string | null;
  authorName: string | null;
  title: string | null;
  content: string;
  hasMedia: boolean;
  occurredAt: Date;
  eventId: string;
  metadata: Prisma.JsonValue | null;
  messageId: string | null;
}

export interface ChatHistoryPage {
  items: ChatHistoryItem[];
  nextCursor: string | null;
}

export interface ChatHistoryFacetValue {
  key: string;
  label: string;
  count: number;
}

export interface ChatHistoryFacets {
  sources: ChatHistoryFacetValue[];
  platforms: ChatHistoryFacetValue[];
  rooms: ChatHistoryFacetValue[];
  authors: ChatHistoryFacetValue[];
}

export interface ChatMessageContext {
  selected: IproActivityMessage;
  before: IproActivityMessage[];
  after: IproActivityMessage[];
}

interface FacetRow {
  key: string;
  label: string;
  count: bigint | number;
}

type FacetName = 'sources' | 'platforms' | 'roomIds' | 'authors';

@Injectable()
export class IproChatHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async search(projectId: string, query: QueryChatHistoryDto): Promise<ChatHistoryPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const sort = query.sort === 'asc' ? 'asc' : 'desc';
    const conditions = this.conditions(projectId, query);
    if (query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      conditions.push(
        sort === 'asc'
          ? Prisma.sql`(d.occurred_at, d.id) > (${cursor.occurredAt}, ${cursor.id})`
          : Prisma.sql`(d.occurred_at, d.id) < (${cursor.occurredAt}, ${cursor.id})`,
      );
    }
    const order =
      sort === 'asc'
        ? Prisma.sql`ORDER BY d.occurred_at ASC, d.id ASC`
        : Prisma.sql`ORDER BY d.occurred_at DESC, d.id DESC`;
    const rows = await this.prisma.$queryRaw<ChatHistoryItem[]>(Prisma.sql`
      SELECT
        d.id,
        d.source,
        d.source_ref AS "sourceRef",
        d.platform,
        d.room_id AS "roomId",
        d.room_name AS "roomName",
        d.author_id AS "authorId",
        d.author_name AS "authorName",
        d.title,
        d.content,
        d.has_media AS "hasMedia",
        d.occurred_at AS "occurredAt",
        d.event_id AS "eventId",
        d.metadata,
        m.id AS "messageId"
      FROM ipro_activity_documents d
      LEFT JOIN ipro_activity_messages m
        ON d.source = 'chat'
       AND m.project_id = d.project_id
       AND d.source_ref = concat(m.platform, ':', m.external_room_id, ':', m.external_message_id)
      WHERE ${Prisma.join(conditions, ' AND ')}
      ${order}
      LIMIT ${limit + 1}
    `);
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor:
        rows.length > limit && items.length > 0
          ? this.encodeCursor(items[items.length - 1])
          : null,
    };
  }

  async facets(projectId: string, query: QueryChatHistoryDto): Promise<ChatHistoryFacets> {
    const [sources, platforms, rooms, authors] = await Promise.all([
      this.facetQuery(
        Prisma.sql`d.source`,
        Prisma.sql`d.source`,
        projectId,
        query,
        'sources',
      ),
      this.facetQuery(
        Prisma.sql`d.platform`,
        Prisma.sql`d.platform`,
        projectId,
        query,
        'platforms',
        Prisma.sql`d.platform IS NOT NULL`,
      ),
      this.facetQuery(
        Prisma.sql`d.room_id`,
        Prisma.sql`coalesce(d.room_name, d.room_id)`,
        projectId,
        query,
        'roomIds',
        Prisma.sql`d.room_id IS NOT NULL`,
      ),
      this.facetQuery(
        Prisma.sql`coalesce(d.author_id, d.author_name)`,
        Prisma.sql`coalesce(d.author_name, d.author_id)`,
        projectId,
        query,
        'authors',
        Prisma.sql`coalesce(d.author_id, d.author_name) IS NOT NULL`,
      ),
    ]);
    return { sources, platforms, rooms, authors };
  }

  async context(projectId: string, messageId: string): Promise<ChatMessageContext> {
    const selected = await this.prisma.iproActivityMessage.findFirst({
      where: { id: messageId, projectId },
    });
    if (!selected) throw new NotFoundException('chat message not found');

    const [beforeDescending, after] = await Promise.all([
      this.prisma.iproActivityMessage.findMany({
        where: {
          projectId,
          activityRoomId: selected.activityRoomId,
          OR: [
            { sentAt: { lt: selected.sentAt } },
            { sentAt: selected.sentAt, id: { lt: selected.id } },
          ],
        },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      this.prisma.iproActivityMessage.findMany({
        where: {
          projectId,
          activityRoomId: selected.activityRoomId,
          OR: [
            { sentAt: { gt: selected.sentAt } },
            { sentAt: selected.sentAt, id: { gt: selected.id } },
          ],
        },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
        take: 10,
      }),
    ]);
    return { selected, before: beforeDescending.reverse(), after };
  }

  private async facetQuery(
    key: Prisma.Sql,
    label: Prisma.Sql,
    projectId: string,
    query: QueryChatHistoryDto,
    omit: FacetName,
    extra?: Prisma.Sql,
  ): Promise<ChatHistoryFacetValue[]> {
    const conditions = this.conditions(projectId, query, omit);
    if (extra) conditions.push(extra);
    const rows = await this.prisma.$queryRaw<FacetRow[]>(Prisma.sql`
      SELECT ${key} AS key, ${label} AS label, count(*)::bigint AS count
      FROM ipro_activity_documents d
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY ${key}, ${label}
      ORDER BY count DESC, label ASC
      LIMIT 200
    `);
    return rows.map((row) => ({
      key: row.key,
      label: row.label,
      count: Number(row.count),
    }));
  }

  private conditions(
    projectId: string,
    query: QueryChatHistoryDto,
    omit?: FacetName,
  ): Prisma.Sql[] {
    const conditions = [Prisma.sql`d.project_id = ${projectId}`];
    if (query.q?.trim()) {
      const pattern = `%${this.escapeLike(query.q.trim())}%`;
      conditions.push(Prisma.sql`(
        d.content ILIKE ${pattern} ESCAPE '\\'
        OR coalesce(d.title, '') ILIKE ${pattern} ESCAPE '\\'
        OR coalesce(d.author_name, '') ILIKE ${pattern} ESCAPE '\\'
        OR coalesce(d.room_name, '') ILIKE ${pattern} ESCAPE '\\'
      )`);
    }
    if (omit !== 'sources' && query.sources?.length) {
      conditions.push(Prisma.sql`d.source IN (${Prisma.join(query.sources)})`);
    }
    if (omit !== 'platforms' && query.platforms?.length) {
      conditions.push(Prisma.sql`d.platform IN (${Prisma.join(query.platforms)})`);
    }
    if (omit !== 'roomIds' && query.roomIds?.length) {
      conditions.push(Prisma.sql`d.room_id IN (${Prisma.join(query.roomIds)})`);
    }
    if (omit !== 'authors' && query.authors?.length) {
      conditions.push(Prisma.sql`(
        d.author_id IN (${Prisma.join(query.authors)})
        OR d.author_name IN (${Prisma.join(query.authors)})
      )`);
    }
    if (query.from) conditions.push(Prisma.sql`d.occurred_at >= ${new Date(query.from)}`);
    if (query.to) conditions.push(Prisma.sql`d.occurred_at <= ${new Date(query.to)}`);
    if (query.hasMedia !== undefined) {
      conditions.push(Prisma.sql`d.has_media = ${query.hasMedia}`);
    }
    return conditions;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
  }

  private encodeCursor(item: Pick<ChatHistoryItem, 'id' | 'occurredAt'>): string {
    return Buffer.from(
      JSON.stringify({ occurredAt: item.occurredAt.toISOString(), id: item.id }),
    ).toString('base64url');
  }

  private decodeCursor(value: string): { occurredAt: Date; id: string } {
    try {
      const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
        occurredAt?: unknown;
        id?: unknown;
      };
      const occurredAt = new Date(String(decoded.occurredAt));
      if (typeof decoded.id !== 'string' || Number.isNaN(occurredAt.getTime())) throw new Error();
      return { occurredAt, id: decoded.id };
    } catch {
      throw new BadRequestException('invalid chat history cursor');
    }
  }
}
