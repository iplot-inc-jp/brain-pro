import { IproActivityIngestService } from './ipro-activity-ingest.service';

const SOURCE = {
  id: 'source-1',
  projectId: 'brain-project-1',
  name: 'ipro production',
};

function event(eventType: string, data: Record<string, unknown>, eventId = 'evt-1') {
  return {
    specVersion: '1.0' as const,
    eventId,
    eventType,
    companyId: 'ipro-company',
    projectIds: [12],
    occurredAt: '2026-07-17T01:59:59.000Z',
    data,
  };
}

function makePrisma() {
  const tx = {
    iproWebhookReceipt: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    iproWebhookSource: { update: jest.fn().mockResolvedValue({}) },
    iproActivityRoom: { upsert: jest.fn().mockResolvedValue({ id: 'room-row-1' }) },
    iproActivityMessage: { upsert: jest.fn().mockResolvedValue({ id: 'message-row-1' }) },
    iproActivityDocument: { upsert: jest.fn().mockResolvedValue({ id: 'document-row-1' }) },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    iproWebhookReceipt: { upsert: jest.fn().mockResolvedValue({}) },
    iproWebhookSource: { update: jest.fn().mockResolvedValue({}) },
  } as any;
  return { prisma, tx };
}

describe('IproActivityIngestService', () => {
  it('upserts a chat room, message, and searchable document', async () => {
    const d = makePrisma();
    const service = new IproActivityIngestService(d.prisma);

    await service.ingest(
      SOURCE as any,
      event('chat.message.created', {
        platform: 'line',
        roomId: 'room-1',
        roomName: '営業部',
        messageId: 'message-1',
        text: '見積条件を確認しました',
        userId: 'user-1',
        userName: '山田',
      }) as any,
    );

    expect(d.tx.iproActivityRoom.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_platform_externalRoomId: {
            projectId: 'brain-project-1',
            platform: 'line',
            externalRoomId: 'room-1',
          },
        },
      }),
    );
    expect(d.tx.iproActivityMessage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_platform_externalRoomId_externalMessageId: {
            projectId: 'brain-project-1',
            platform: 'line',
            externalRoomId: 'room-1',
            externalMessageId: 'message-1',
          },
        },
      }),
    );
    expect(d.tx.iproActivityDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          projectId: 'brain-project-1',
          source: 'chat',
          sourceRef: 'line:room-1:message-1',
          content: '見積条件を確認しました',
          authorName: '山田',
        }),
      }),
    );
  });

  it('uses upsert so a duplicate external message stays one row', async () => {
    const d = makePrisma();
    const service = new IproActivityIngestService(d.prisma);
    const messageEvent = event('chat.message.created', {
      platform: 'slack',
      roomId: 'room-1',
      messageId: 'message-1',
      text: 'same message',
    });

    await service.ingest(SOURCE as any, messageEvent as any);
    await service.ingest(SOURCE as any, { ...messageEvent, eventId: 'evt-2' } as any);

    expect(d.tx.iproActivityMessage.upsert).toHaveBeenCalledTimes(2);
    expect(d.tx.iproActivityMessage.upsert.mock.calls[0][0].where).toEqual(
      d.tx.iproActivityMessage.upsert.mock.calls[1][0].where,
    );
  });

  it('scopes the same incoming event independently to each Brain Pro project source', async () => {
    const d = makePrisma();
    const service = new IproActivityIngestService(d.prisma);
    const incoming = event('project.context.created', {
      id: 508,
      projectId: 12,
      content: '納期は9月末',
    });

    await service.ingest({ ...SOURCE, id: 'source-a', projectId: 'brain-a' } as any, incoming as any);
    await service.ingest({ ...SOURCE, id: 'source-b', projectId: 'brain-b' } as any, incoming as any);

    const projectIds = d.tx.iproWebhookReceipt.createMany.mock.calls.map(
      ([args]) => args.data.projectId,
    );
    expect(projectIds).toEqual(['brain-a', 'brain-b']);
    expect(d.tx.iproActivityDocument.upsert.mock.calls.map(([args]) => args.create.projectId)).toEqual([
      'brain-a',
      'brain-b',
    ]);
  });

  it.each([
    ['document.created', { documentId: 410, contentHash: 'hash', url: 'https://docs/x' }, 'document', '410'],
    ['document.updated', { documentId: 410, contentHash: 'hash-2', url: 'https://docs/x' }, 'document', '410'],
    ['recording.created', { recordingId: 91 }, 'recording', '91'],
    ['recording.ready', { recordingId: 91, mediaStatus: 'done', transcriptStatus: 'done' }, 'recording', '91'],
    ['project.context.created', { id: 508, projectId: 12, content: 'context' }, 'project_context', '508'],
    ['project.memory.created', { id: 620, projectId: 12, content: 'memory' }, 'project_memory', '620'],
    ['tracker.task.created', { tracker: 'linear', externalId: 'PROJ-1', title: 'task', status: 'Todo' }, 'tracker_task', 'linear:PROJ-1'],
    ['tracker.task.updated', { tracker: 'linear', externalId: 'PROJ-1', title: 'task', status: 'Done' }, 'tracker_task', 'linear:PROJ-1'],
  ])('normalizes %s with stable source/sourceRef', async (eventType, data, source, sourceRef) => {
    const d = makePrisma();
    const service = new IproActivityIngestService(d.prisma);

    await service.ingest(SOURCE as any, event(eventType, data) as any);

    expect(d.tx.iproActivityDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_source_sourceRef: {
            projectId: 'brain-project-1',
            source,
            sourceRef,
          },
        },
      }),
    );
  });

  it('marks the receipt processed only after normalization succeeds', async () => {
    const d = makePrisma();
    const service = new IproActivityIngestService(d.prisma);

    await service.ingest(
      SOURCE as any,
      event('project.memory.created', { id: 1, projectId: 12, content: 'memory' }) as any,
    );

    expect(d.tx.iproActivityDocument.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      d.tx.iproWebhookReceipt.update.mock.invocationCallOrder[0],
    );
    expect(d.tx.iproWebhookReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'processed' }) }),
    );
  });

  it('returns duplicate on a project/event unique receipt conflict', async () => {
    const d = makePrisma();
    d.tx.iproWebhookReceipt.createMany.mockResolvedValue({ count: 0 });
    const service = new IproActivityIngestService(d.prisma);

    await expect(
      service.ingest(
        SOURCE as any,
        event('project.memory.created', { id: 1, projectId: 12, content: 'memory' }) as any,
      ),
    ).resolves.toEqual({ duplicate: true });
    expect(d.tx.iproActivityDocument.upsert).not.toHaveBeenCalled();
  });

  it('does not misclassify a normalization unique conflict as a duplicate receipt', async () => {
    const d = makePrisma();
    d.tx.iproActivityDocument.upsert.mockRejectedValue({ code: 'P2002' });
    const service = new IproActivityIngestService(d.prisma);

    await expect(
      service.ingest(
        SOURCE as any,
        event('project.memory.created', { id: 1, projectId: 12, content: 'memory' }) as any,
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(d.prisma.iproWebhookReceipt.upsert).toHaveBeenCalled();
  });

  it('records a bounded receipt/source error when normalization fails', async () => {
    const d = makePrisma();
    d.tx.iproActivityDocument.upsert.mockRejectedValue(new Error('x'.repeat(5000)));
    const service = new IproActivityIngestService(d.prisma);

    await expect(
      service.ingest(
        SOURCE as any,
        event('project.context.created', { id: 1, projectId: 12, content: 'context' }) as any,
      ),
    ).rejects.toThrow();

    expect(d.prisma.iproWebhookReceipt.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'error', error: expect.any(String) }),
      }),
    );
    const storedError = d.prisma.iproWebhookReceipt.upsert.mock.calls[0][0].create.error;
    expect(storedError.length).toBeLessThanOrEqual(1000);
    expect(d.prisma.iproWebhookSource.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastError: storedError } }),
    );
  });
});
