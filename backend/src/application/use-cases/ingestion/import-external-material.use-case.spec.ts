import { EntityAlreadyExistsError, ValidationError } from '../../../domain';
import { ImportExternalMaterialUseCase } from './import-external-material.use-case';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

type Row = Record<string, any>;

function makePrisma() {
  const state = {
    imports: new Map<string, Row>(),
    attachments: new Map<string, Row>(),
    batches: new Map<string, Row>(),
    files: new Map<string, Row>(),
    jobs: new Map<string, Row>(),
  };
  const importKey = (projectId: string, idempotencyKey: string) =>
    `${projectId}:${idempotencyKey}`;
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      if (value && typeof value === 'object' && 'in' in value) {
        return value.in.includes(row[key]);
      }
      return row[key] === value;
    });

  const db: any = {
    $executeRawUnsafe: jest.fn(async () => 1),
    externalMaterialImport: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const key = importKey(
          where.projectId_idempotencyKey.projectId,
          where.projectId_idempotencyKey.idempotencyKey,
        );
        const existing = state.imports.get(key);
        if (existing) return { ...existing };
        const row = {
          ...create,
          attachmentId: null,
          ingestionBatchId: null,
          error: null,
          status: 'PENDING',
        };
        state.imports.set(key, row);
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.projectId_idempotencyKey) {
          return (
            state.imports.get(
              importKey(
                where.projectId_idempotencyKey.projectId,
                where.projectId_idempotencyKey.idempotencyKey,
              ),
            ) ?? null
          );
        }
        return (
          [...state.imports.values()].find((row) => row.id === where.id) ?? null
        );
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = [...state.imports.values()].find((candidate) =>
          matches(candidate, where),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    attachment: {
      count: jest.fn(
        async ({ where }: any) =>
          [...state.attachments.values()].filter((row) => matches(row, where))
            .length,
      ),
      upsert: jest.fn(async ({ where, create }: any) => {
        const existing = state.attachments.get(where.id);
        if (existing) return { ...existing };
        state.attachments.set(where.id, { ...create });
        return { ...create };
      }),
      findFirst: jest.fn(
        async ({ where }: any) =>
          [...state.attachments.values()].find((row) => matches(row, where)) ??
          null,
      ),
    },
    ingestionBatch: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const existing = state.batches.get(where.id);
        if (existing) return { ...existing };
        state.batches.set(where.id, { ...create });
        return { ...create };
      }),
      findUnique: jest.fn(
        async ({ where }: any) => state.batches.get(where.id) ?? null,
      ),
    },
    ingestionFile: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const existing = state.files.get(where.id);
        if (existing) return { ...existing };
        state.files.set(where.id, { ...create });
        return { ...create };
      }),
      findUnique: jest.fn(
        async ({ where }: any) => state.files.get(where.id) ?? null,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = [...state.files.values()].find((candidate) =>
          matches(candidate, where),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    backgroundJob: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const existing = state.jobs.get(where.id);
        if (existing) return { ...existing };
        state.jobs.set(where.id, { ...create });
        return { ...create };
      }),
      findUnique: jest.fn(
        async ({ where }: any) => state.jobs.get(where.id) ?? null,
      ),
    },
  };
  db.$transaction = jest.fn(async (callback: (tx: any) => unknown) =>
    callback(db),
  );
  return { db, state };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    principal: { id: 'u1' },
    projectId: 'p1',
    idempotencyKey: 'ipro:line:team:channel:file:p1',
    sourcePlatform: 'line',
    sourceChannelId: 'channel-1',
    sourceMessageId: 'message-1',
    sourceFileId: 'file-1',
    file: {
      filename: '資料.pdf',
      mimeType: 'application/pdf',
      size: 13,
      bytes: Buffer.from('%PDF-1.7 test'),
    },
    ...overrides,
  };
}

function makeUseCase() {
  const { db, state } = makePrisma();
  const blob = {
    save: jest.fn(async (key: string) => ({
      url: `https://store.public.blob.vercel-storage.com/${encodeURIComponent(key)}`,
    })),
  };
  const access = { assertPrincipalAccess: jest.fn(async () => undefined) };
  const jobs = {
    startReserved: jest.fn(async (id: string) => state.jobs.get(id)),
    resumeIngestionParent: jest.fn(async (id: string) => state.jobs.get(id)),
  };
  return {
    useCase: new ImportExternalMaterialUseCase(
      db,
      blob as any,
      access as any,
      jobs as any,
    ),
    db,
    state,
    blob,
    access,
    jobs,
  };
}

describe('ImportExternalMaterialUseCase', () => {
  it('stores the original, registers a shared attachment, and creates one ATTACHMENT batch', async () => {
    const { useCase, state, blob, access } = makeUseCase();

    const result = await useCase.execute(makeInput());

    expect(access.assertPrincipalAccess).toHaveBeenCalledWith(
      { id: 'u1' },
      'p1',
      'edit',
    );
    expect(blob.save).toHaveBeenCalledWith(
      expect.stringMatching(/^external-materials\/p1\/[^/]+\/資料\.pdf$/),
      Buffer.from('%PDF-1.7 test'),
      'application/pdf',
      { stable: true },
    );
    expect(result).toEqual({
      importId: expect.any(String),
      attachmentId: expect.any(String),
      batchId: expect.any(String),
      status: 'BATCHED',
    });
    expect([...state.attachments.values()]).toEqual([
      expect.objectContaining({
        projectId: 'p1',
        filename: '資料.pdf',
        folder: 'LINE・Slack',
      }),
    ]);
    expect([...state.batches.values()]).toEqual([
      expect.objectContaining({
        projectId: 'p1',
        name: 'LINE資料: 資料.pdf',
        totalFiles: 1,
      }),
    ]);
    expect([...state.files.values()]).toEqual([
      expect.objectContaining({
        projectId: 'p1',
        sourceType: 'ATTACHMENT',
        sourceRef: result.attachmentId,
        mimeType: 'application/pdf',
      }),
    ]);
  });

  it('returns the same completed import without storing or creating artifacts again', async () => {
    const { useCase, state, blob } = makeUseCase();
    const first = await useCase.execute(makeInput());
    blob.save.mockClear();

    const second = await useCase.execute(makeInput());

    expect(second).toEqual(first);
    expect(blob.save).not.toHaveBeenCalled();
    expect(state.attachments.size).toBe(1);
    expect(state.batches.size).toBe(1);
    expect(state.files.size).toBe(1);
    expect(state.jobs.size).toBe(1);
  });

  it('deduplicates concurrent requests to one import, attachment, batch, file, and parent job', async () => {
    const { useCase, state } = makeUseCase();

    const [a, b] = await Promise.all([
      useCase.execute(makeInput()),
      useCase.execute(makeInput()),
    ]);

    expect(a).toEqual(b);
    expect(state.imports.size).toBe(1);
    expect(state.attachments.size).toBe(1);
    expect(state.batches.size).toBe(1);
    expect(state.files.size).toBe(1);
    expect(state.jobs.size).toBe(1);
  });

  it('uses project-scoped idempotency for the same external source', async () => {
    const { useCase, state } = makeUseCase();

    const [p1, p2] = await Promise.all([
      useCase.execute(makeInput()),
      useCase.execute(
        makeInput({
          projectId: 'p2',
          idempotencyKey: 'ipro:line:team:channel:file:p2',
        }),
      ),
    ]);

    expect(p1.importId).not.toBe(p2.importId);
    expect(p1.batchId).not.toBe(p2.batchId);
    expect(state.imports.size).toBe(2);
    expect(
      [...state.batches.values()].map((row) => row.projectId).sort(),
    ).toEqual(['p1', 'p2']);
  });

  it('rejects sequential idempotency-key reuse with a different fingerprint before blob overwrite', async () => {
    const { useCase, blob } = makeUseCase();
    await useCase.execute(makeInput());
    blob.save.mockClear();

    await expect(
      useCase.execute(
        makeInput({
          file: {
            filename: '資料.pdf',
            mimeType: 'application/pdf',
            size: 16,
            bytes: Buffer.from('%PDF-1.7 changed'),
          },
        }),
      ),
    ).rejects.toBeInstanceOf(EntityAlreadyExistsError);
    expect(blob.save).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent conflicting fingerprints to bind the idempotency key', async () => {
    const { useCase, blob, state } = makeUseCase();

    const results = await Promise.allSettled([
      useCase.execute(makeInput()),
      useCase.execute(
        makeInput({
          file: {
            filename: '資料.pdf',
            mimeType: 'application/pdf',
            size: 16,
            bytes: Buffer.from('%PDF-1.7 changed'),
          },
        }),
      ),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(state.imports.size).toBe(1);
    expect(state.batches.size).toBe(1);
    expect(blob.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'wrong MIME',
      {
        filename: '資料.pdf',
        mimeType: 'text/plain',
        size: 13,
        bytes: Buffer.from('%PDF-1.7 test'),
      },
    ],
    [
      'wrong extension',
      {
        filename: '資料.txt',
        mimeType: 'application/pdf',
        size: 13,
        bytes: Buffer.from('%PDF-1.7 test'),
      },
    ],
    [
      'wrong magic',
      {
        filename: '資料.pdf',
        mimeType: 'application/pdf',
        size: 8,
        bytes: Buffer.from('not pdf!'),
      },
    ],
    [
      'too large',
      {
        filename: '資料.pdf',
        mimeType: 'application/pdf',
        size: MAX_FILE_BYTES + 1,
        bytes: Buffer.from('%PDF-1.7 test'),
      },
    ],
  ])('rejects %s before persisting anything', async (_label, file) => {
    const { useCase, state, blob } = makeUseCase();
    await expect(useCase.execute(makeInput({ file }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(blob.save).not.toHaveBeenCalled();
    expect(state.imports.size).toBe(0);
  });

  it('recovers the same queued parent job when the response is lost after DB batching', async () => {
    const { useCase, jobs, state, blob } = makeUseCase();
    jobs.startReserved.mockRejectedValueOnce(
      new Error('publish transport failed'),
    );

    await expect(useCase.execute(makeInput())).rejects.toThrow(
      'publish transport failed',
    );
    const [importRow] = [...state.imports.values()];
    expect(importRow.status).toBe('BATCHED');
    const [originalJobId] = [...state.jobs.keys()];

    const result = await useCase.execute(makeInput());

    expect(result.batchId).toBe(importRow.ingestionBatchId);
    expect([...state.jobs.keys()]).toEqual([originalJobId]);
    expect(jobs.startReserved).toHaveBeenLastCalledWith(originalJobId);
    expect(blob.save).toHaveBeenCalledTimes(1);
  });

  it('resumes a failed import through the same parent without creating another billable job', async () => {
    const { useCase, jobs, state } = makeUseCase();
    await useCase.execute(makeInput());
    const [job] = [...state.jobs.values()];
    job.status = 'FAILED';

    await useCase.execute(makeInput());

    expect(jobs.resumeIngestionParent).toHaveBeenCalledWith(
      job.id,
      expect.any(String),
      'p1',
    );
    expect(state.jobs.size).toBe(1);
  });
});
