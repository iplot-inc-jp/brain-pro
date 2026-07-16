import { createHash } from 'node:crypto';
import { EntityAlreadyExistsError, ValidationError } from '../../../domain';
import { ImportExternalMaterialUseCase } from './import-external-material.use-case';

const PDF_BYTES = Buffer.from(
  'JVBERi0xLjcKJYGBgYEKCjUgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL09ialN0bQovTiA0Ci9GaXJzdCAyMAovTGVuZ3RoIDI1OQo+PgpzdHJlYW0KeJzVUk1LxDAQvedXzFFPmUzTpCul4PbjIsKyeFL2ELZhKchm6Qfov3fSrIoH8SzhkUzem0ySNwoQCLSGDGwBGvKMoCyFfHq/eJA7d/KTkA9DP8ELswh7OAhZh+U8gxJVJb61tZvdaziJlAQqij8VuzH0y9GPUHZt1yFaRDSaYRCp4blmbBjEMXNU8Jph9RW8ZzPE7J65LsHYlBP5VZtf81ueWWuipklaXaT4q26s1aYz6K/7bCohH0PfuNnDTXNHSAatMopyS/nzLX/H6N0c/u/j1vsP4fzrC3/4HO2NJo8+9sDqstz7KSzjkW1nXRX/y/eD24Y37hrkoTDhEMkPR0aN2gplbmRzdHJlYW0KZW5kb2JqCgo2IDAgb2JqCjw8Ci9TaXplIDcKL1Jvb3QgMiAwIFIKL0luZm8gMyAwIFIKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL1R5cGUgL1hSZWYKL0xlbmd0aCAzNAovVyBbIDEgMiAyIF0KL0luZGV4IFsgMCA3IF0KPj4Kc3RyZWFtCnicFcQxDgAgCASwHsbd7/p6CB2K7nLZstV24pF8BkOGAq0KZW5kc3RyZWFtCmVuZG9iagoKc3RhcnR4cmVmCjM3NwolJUVPRg==',
  'base64',
);
const PDF_HASH = createHash('sha256').update(PDF_BYTES).digest('hex');

type Row = Record<string, any>;

function makePrisma() {
  const state = {
    imports: new Map<string, Row>(),
    attachments: new Map<string, Row>(),
    batches: new Map<string, Row>(),
    files: new Map<string, Row>(),
    jobs: new Map<string, Row>(),
  };
  const importKey = (projectId: string, key: string) => `${projectId}:${key}`;
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
          status: 'PENDING',
          error: null,
        };
        state.imports.set(key, row);
        return { ...row };
      }),
      findUnique: jest.fn(
        async ({ where }: any) =>
          [...state.imports.values()].find((row) => row.id === where.id) ??
          null,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = [...state.imports.values()].find((item) =>
          matches(item, where),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    attachment: {
      count: jest.fn(async () => state.attachments.size),
      upsert: jest.fn(async ({ where, create }: any) => {
        const row = state.attachments.get(where.id) ?? { ...create };
        state.attachments.set(where.id, row);
        return { ...row };
      }),
    },
    ingestionBatch: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const row = state.batches.get(where.id) ?? { ...create };
        state.batches.set(where.id, row);
        return { ...row };
      }),
    },
    ingestionFile: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const row = state.files.get(where.id) ?? { ...create };
        state.files.set(where.id, row);
        return { ...row };
      }),
    },
    backgroundJob: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const row = state.jobs.get(where.id) ?? {
          attempts: 0,
          startedAt: null,
          ...create,
        };
        state.jobs.set(where.id, row);
        return { ...row };
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

function prepareInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    principal: { id: 'u1' },
    projectId: 'p1',
    idempotencyKey: 'ipro:line:channel:file:p1',
    sourcePlatform: 'line',
    sourceChannelId: 'channel-1',
    sourceMessageId: 'message-1',
    sourceFileId: 'file-1',
    file: {
      filename: '資料.pdf',
      mimeType: 'application/pdf',
      size: PDF_BYTES.length,
      contentSha256: PDF_HASH,
    },
    ...overrides,
  };
}

function makeUseCase() {
  const { db, state } = makePrisma();
  const blob = {
    createPrivateUpload: jest.fn(async (pathname: string) => ({
      uploadUrl: 'https://private-upload.example/put',
      pathname,
      expiresAt: 123,
    })),
    headPrivate: jest.fn(async (pathname: string) => ({
      pathname,
      size: PDF_BYTES.length,
      contentType: 'application/pdf',
    })),
    readPrivate: jest.fn(async () => PDF_BYTES),
    deletePrivate: jest.fn(async () => undefined),
    createPrivateDownload: jest.fn(async () => ({
      downloadUrl: 'https://private-download.example/get',
      expiresAt: 456,
    })),
  };
  const access = { assertPrincipalAccess: jest.fn(async () => undefined) };
  const jobs = {
    startReserved: jest.fn(async (id: string) => state.jobs.get(id)),
    retry: jest.fn(async (id: string) => state.jobs.get(id)),
    recoverStaleRunning: jest.fn(async (id: string) => ({
      ...state.jobs.get(id),
      recoveryTriggered: false,
    })),
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

async function prepareAndFinalize(ctx: ReturnType<typeof makeUseCase>) {
  const prepared = await ctx.useCase.prepare(prepareInput());
  await ctx.useCase.finalize({
    userId: 'u1',
    principal: { id: 'u1' },
    projectId: 'p1',
    importId: prepared.importId,
  });
  return prepared;
}

describe('ImportExternalMaterialUseCase direct private flow', () => {
  it('binds fingerprint before issuing an exact-path upload', async () => {
    const { useCase, state, blob } = makeUseCase();
    const result = await useCase.prepare(prepareInput());
    expect(state.imports.size).toBe(1);
    expect([...state.imports.values()][0]).toEqual(
      expect.objectContaining({ contentSha256: PDF_HASH, status: 'PENDING' }),
    );
    expect(blob.createPrivateUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^external-materials\/p1\/[^/]+\/資料\.pdf$/u),
      'application/pdf',
      PDF_BYTES.length,
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'PENDING',
        upload: expect.any(Object),
      }),
    );
  });

  it('rejects idempotency-key reuse with another fingerprint before issuing a PUT', async () => {
    const { useCase, blob } = makeUseCase();
    await useCase.prepare(prepareInput());
    blob.createPrivateUpload.mockClear();
    await expect(
      useCase.prepare(
        prepareInput({
          file: { ...prepareInput().file, contentSha256: 'a'.repeat(64) },
        }),
      ),
    ).rejects.toBeInstanceOf(EntityAlreadyExistsError);
    expect(blob.createPrivateUpload).not.toHaveBeenCalled();
  });

  it('coalesces concurrent prepares to one bound import', async () => {
    const { useCase, state } = makeUseCase();

    const [first, second] = await Promise.all([
      useCase.prepare(prepareInput()),
      useCase.prepare(prepareInput()),
    ]);

    expect(first.importId).toBe(second.importId);
    expect(state.imports.size).toBe(1);
  });

  it('finalizes with HEAD only and reserves one deterministic verifier across retries', async () => {
    const ctx = makeUseCase();
    const prepared = await prepareAndFinalize(ctx);
    await ctx.useCase.finalize({
      userId: 'u1',
      principal: { id: 'u1' },
      projectId: 'p1',
      importId: prepared.importId,
    });
    expect(ctx.blob.headPrivate).toHaveBeenCalledTimes(2);
    expect(ctx.blob.readPrivate).not.toHaveBeenCalled();
    expect(
      [...ctx.state.jobs.values()].filter(
        (job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL',
      ),
    ).toHaveLength(1);
    expect([...ctx.state.imports.values()][0].status).toBe('STORED');
  });

  it('recovers the same stale RUNNING verifier lease', async () => {
    const ctx = makeUseCase();
    const prepared = await prepareAndFinalize(ctx);
    const verifier = [...ctx.state.jobs.values()].find(
      (job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL',
    );
    verifier!.status = 'RUNNING';
    verifier!.startedAt = new Date(0);

    await ctx.useCase.finalize({
      userId: 'u1',
      principal: { id: 'u1' },
      projectId: 'p1',
      importId: prepared.importId,
    });

    expect(ctx.jobs.recoverStaleRunning).toHaveBeenCalledWith(verifier!.id);
    expect(
      [...ctx.state.jobs.values()].filter(
        (job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL',
      ),
    ).toHaveLength(1);
  });

  it('coalesces concurrent finalize calls to one verifier job', async () => {
    const ctx = makeUseCase();
    const prepared = await ctx.useCase.prepare(prepareInput());
    const finalize = () =>
      ctx.useCase.finalize({
        userId: 'u1',
        principal: { id: 'u1' },
        projectId: 'p1',
        importId: prepared.importId,
      });

    const [first, second] = await Promise.all([finalize(), finalize()]);

    expect(first.verifierJobId).toBe(second.verifierJobId);
    expect(
      [...ctx.state.jobs.values()].filter(
        (job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL',
      ),
    ).toHaveLength(1);
  });

  it('recovers the same verifier after crashing with STORED already committed', async () => {
    const ctx = makeUseCase();
    const prepared = await ctx.useCase.prepare(prepareInput());
    ctx.jobs.startReserved.mockRejectedValueOnce(new Error('transport down'));

    await expect(
      ctx.useCase.finalize({
        userId: 'u1',
        principal: { id: 'u1' },
        projectId: 'p1',
        importId: prepared.importId,
      }),
    ).rejects.toThrow('transport down');
    const verifierIds = [...ctx.state.jobs.values()]
      .filter((job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL')
      .map((job) => job.id);
    expect([...ctx.state.imports.values()][0].status).toBe('STORED');

    await ctx.useCase.finalize({
      userId: 'u1',
      principal: { id: 'u1' },
      projectId: 'p1',
      importId: prepared.importId,
    });
    expect(
      [...ctx.state.jobs.values()]
        .filter((job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL')
        .map((job) => job.id),
    ).toEqual(verifierIds);
  });

  it('verifies bytes then transactionally creates one private attachment, batch, file, and root', async () => {
    const ctx = makeUseCase();
    const prepared = await prepareAndFinalize(ctx);
    const verifier = [...ctx.state.jobs.values()].find(
      (job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL',
    );
    const result = await ctx.useCase.verifyAndBatch(
      prepared.importId,
      verifier!.id,
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'BATCHED',
        attachmentId: expect.any(String),
        batchId: expect.any(String),
        rootJobId: expect.any(String),
      }),
    );
    expect([...ctx.state.attachments.values()][0]).toEqual(
      expect.objectContaining({
        folder: 'LINE・Slack',
        blobUrl: expect.stringMatching(/^private-blob:/u),
      }),
    );
    expect(ctx.state.batches.size).toBe(1);
    expect(ctx.state.files.size).toBe(1);
    expect(
      [...ctx.state.jobs.values()].filter(
        (job) => job.type === 'KG_INGEST_FILE',
      ),
    ).toHaveLength(1);
  });

  it('fails and deletes the private object when the measured SHA differs', async () => {
    const ctx = makeUseCase();
    const prepared = await prepareAndFinalize(ctx);
    ctx.blob.readPrivate.mockResolvedValue(Buffer.from('changed'));
    const verifier = [...ctx.state.jobs.values()].find(
      (job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL',
    );
    await expect(
      ctx.useCase.verifyAndBatch(prepared.importId, verifier!.id),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(ctx.blob.deletePrivate).toHaveBeenCalledTimes(1);
    expect([...ctx.state.imports.values()][0].status).toBe('FAILED');
    expect(ctx.state.attachments.size).toBe(0);
  });

  it('recovers the same root after crashing with BATCHED already committed', async () => {
    const ctx = makeUseCase();
    const prepared = await prepareAndFinalize(ctx);
    const verifier = [...ctx.state.jobs.values()].find(
      (job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL',
    );
    ctx.jobs.startReserved.mockRejectedValueOnce(
      new Error('root publish down'),
    );

    await expect(
      ctx.useCase.verifyAndBatch(prepared.importId, verifier!.id),
    ).rejects.toThrow('root publish down');
    const rootIds = [...ctx.state.jobs.values()]
      .filter((job) => job.type === 'KG_INGEST_FILE')
      .map((job) => job.id);
    expect([...ctx.state.imports.values()][0].status).toBe('BATCHED');

    await ctx.useCase.verifyAndBatch(prepared.importId, verifier!.id);
    expect(
      [...ctx.state.jobs.values()]
        .filter((job) => job.type === 'KG_INGEST_FILE')
        .map((job) => job.id),
    ).toEqual(rootIds);
  });

  it('recovers a stale RUNNING root without creating another billable root', async () => {
    const ctx = makeUseCase();
    const prepared = await prepareAndFinalize(ctx);
    const verifier = [...ctx.state.jobs.values()].find(
      (job) => job.type === 'KG_FINALIZE_EXTERNAL_MATERIAL',
    );
    await ctx.useCase.verifyAndBatch(prepared.importId, verifier!.id);
    const root = [...ctx.state.jobs.values()].find(
      (job) => job.type === 'KG_INGEST_FILE',
    );
    root!.status = 'RUNNING';
    root!.startedAt = new Date(0);
    await ctx.useCase.getStatus({
      principal: { id: 'u1' },
      projectId: 'p1',
      importId: prepared.importId,
    });
    await ctx.useCase.finalize({
      userId: 'u1',
      principal: { id: 'u1' },
      projectId: 'p1',
      importId: prepared.importId,
    });
    expect(ctx.jobs.recoverStaleRunning).toHaveBeenCalledWith(root!.id);
    expect(
      [...ctx.state.jobs.values()].filter(
        (job) => job.type === 'KG_INGEST_FILE',
      ),
    ).toHaveLength(1);
  });
});
