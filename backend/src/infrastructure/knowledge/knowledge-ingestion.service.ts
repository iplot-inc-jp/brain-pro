import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { KnowledgeDocumentPage, Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { BlobStorageService } from '../services/blob-storage.service';
import { CompanyKeyService } from '../services/company-key.service';
import { ClaudeService } from '../services/claude.service';
import { JobService } from '../services/job.service';
import { FileExtractionService, FileKind } from './file-extraction.service';
import { DriveService } from './drive.service';
import { buildMergePlan } from './lib/merge-plan';
import { readPptxSlides, splitPdfPages } from './lib/document-pages';
import { KnowledgePageRepository } from './knowledge-page.repository';
import {
  aggregateBatchStatus,
  FileStatus,
} from './lib/batch-status';
import {
  IngestionFile,
  IngestionBatch,
  IngestionFileStatusValue,
  IIngestionFileRepository,
  INGESTION_FILE_REPOSITORY,
  IIngestionBatchRepository,
  INGESTION_BATCH_REPOSITORY,
} from '../../domain';

interface BackgroundJobReservation {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
}

export class PageJobLeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Page job lease lost: ${jobId}`);
    this.name = 'PageJobLeaseLostError';
  }
}

/**
 * 1ファイルの取り込みパイプライン（FETCH→PREPROCESS→EXTRACT→MERGE）と、
 * アーカイブ（ZIP）の展開（EXPAND）を担う実行サービス。
 *
 * - `processFile(fileId)`: KG_INGEST_FILE ジョブの本体。状態機械として
 *   IngestionFile.status/step/progress を各段で更新し、最終的に SUCCEEDED へ。
 *   失敗は throw（JobService 側で attempts 積み増し＋自動/手動リトライ）。
 * - `expandArchive(fileId)`: KG_EXPAND_ARCHIVE ジョブの本体。ZIP を安全展開し、
 *   各エントリを Blob 保存＋子 IngestionFile(PENDING) として登録し KG_INGEST_FILE を起票。
 *
 * MERGE が冪等（document を ingestionFileId で upsert、既存 mention/relation を削除して再生成、
 * ノードは (projectId,type,normalizedLabel) で get-or-create）なので、リトライ/再開で重複しない。
 *
 * 設定解決は ProjectKnowledgeSettings ∧ batch.options（aiExtractionEnabled / ocrEnabled）。
 * 秘匿情報は payload に載せず、API キーは実行時に CompanyKeyService で解決する。
 */
@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobStorageService,
    private readonly extraction: FileExtractionService,
    private readonly claude: ClaudeService,
    private readonly companyKey: CompanyKeyService,
    private readonly drive: DriveService,
    // JobService ↔ KnowledgeIngestionService は相互参照（dispatch が本サービスを呼ぶ）。
    @Inject(forwardRef(() => JobService))
    private readonly jobService: JobService,
    @Inject(INGESTION_FILE_REPOSITORY)
    private readonly fileRepository: IIngestionFileRepository,
    @Inject(INGESTION_BATCH_REPOSITORY)
    private readonly batchRepository: IIngestionBatchRepository,
    private readonly pageRepository: KnowledgePageRepository,
  ) {}

  // 展開上限（zip-bomb 対策の二重防御。planArchiveEntries 側でも打ち切る）。
  private static readonly EXPAND_MAX_ENTRIES = 500;
  private static readonly EXPAND_MAX_TOTAL_BYTES = 500 * 1024 * 1024;
  // 入口ガード（OOM 防止）: 圧縮サイズがこれを超える zip は全展開せず too_large で打ち切る。
  private static readonly EXPAND_MAX_COMPRESSED_BYTES = 100 * 1024 * 1024;
  // ネスト zip の最大深さ（root の zip = 深さ 1）。これを超える子の展開は行わない。
  private static readonly MAX_ARCHIVE_DEPTH = 3;

  /**
   * KG_INGEST_FILE 本体。1ジョブ = 1 IngestionFile の状態機械。
   * 失敗時は親バッチカウンタを FAILED 反映してから throw（Job 側でリトライ）。
   */
  async processFile(
    fileId: string,
    parentJobId?: string,
  ): Promise<{
    knowledgeDocumentId?: string;
    skipped?: boolean;
    deferred?: boolean;
    pages?: number;
  }> {
    const file = await this.fileRepository.findById(fileId);
    if (!file) {
      throw new Error(`IngestionFile ${fileId} not found`);
    }

    // この試行ぶんの attempts を積む（業務的な可視化。Job 側の attempts とは別系統）。
    file.incrementAttempts();
    file.update({ startedAt: file.startedAt ?? new Date(), finishedAt: null });
    await this.fileRepository.save(file);

    try {
      // ===== FETCHING: 原本 bytes を取得し Blob 保存（既に blobUrl があれば取得のみ） =====
      await this.transition(file, 'FETCHING', '原本を取得しています', 10);
      const { bytes, mimeType } = await this.fetchBytes(file);

      // isArchive はこのパイプラインでは処理しない（展開は expandArchive 側）。
      // 念のためのガード（通常は CreateIngestionBatch が KG_EXPAND_ARCHIVE へ振り分ける）。
      if (file.isArchive) {
        await this.transition(file, 'SUCCEEDED', 'アーカイブ（展開は別ジョブ）', 100);
        file.update({ finishedAt: new Date() });
        await this.fileRepository.save(file);
        await this.refreshBatch(file.batchId);
        return { skipped: true };
      }

      // ===== 設定解決（プロジェクト設定 ∧ バッチ option） =====
      const batch = await this.batchRepository.findById(file.batchId);
      const gate = await this.resolveGate(file.projectId, batch);

      // ===== PREPROCESSING: 型別テキスト抽出（PDF/画像は needsVision） =====
      await this.transition(file, 'PREPROCESSING', '前処理（テキスト抽出）', 35);
      const kind = this.extraction.classify(mimeType ?? file.mimeType, file.filename);

      // PDF / OOXML PowerPoint はファイル一括LLMではなく、再開可能なページ子ジョブへ分割する。
      // 古い .ppt / ODP は document-pages parser の対象外なので既存テキスト経路を維持する。
      if (
        kind === 'pdf' ||
        this.isPptx(file.filename, mimeType ?? file.mimeType)
      ) {
        if (!parentJobId) {
          throw new Error('PDF/PPTX の取り込みには親ジョブIDが必要です');
        }
        return await this.preparePagedFile(
          file,
          bytes,
          kind === 'pdf' ? 'pdf' : 'presentation',
          parentJobId,
        );
      }

      if (kind === 'unsupported') {
        // 未対応 mime は無音で飛ばさず SKIPPED（理由を残す）。
        await this.transition(
          file,
          'SKIPPED',
          `未対応のファイル形式（${file.mimeType ?? mimeType ?? '不明'}）`,
          100,
        );
        file.update({
          error: '未対応の MIME / 拡張子のためスキップしました',
          finishedAt: new Date(),
        });
        await this.fileRepository.save(file);
        await this.refreshBatch(file.batchId);
        return { skipped: true };
      }

      const extracted = await this.extraction.extractText(kind, bytes);
      const needsVision = extracted.needsVision === true;

      // OCR 無効 ∧ vision が必要（PDF/画像）→ 抽出スキップ（理由を step/error に明記）。
      const visionBlocked = needsVision && !gate.ocrEnabled;
      const extractedText = extracted.text ?? null;
      file.update({ extractedText });

      // ===== EXTRACTING: aiExtractionEnabled の時のみ Claude を呼ぶ =====
      let extraction = this.emptyExtraction();
      if (gate.aiExtractionEnabled && !visionBlocked) {
        await this.transition(file, 'EXTRACTING', 'Claude で実体・タグ・関係を抽出', 60);
        const apiKey = await this.companyKey.resolveForProject(
          file.projectId,
          batch?.createdById ?? undefined,
        );
        if (!apiKey) {
          throw new Error(
            'Anthropic APIキーが未設定です（会社設定・個人設定・環境変数のいずれにも見つかりません）',
          );
        }
        const input = this.buildExtractInput(kind, bytes, extractedText, file.filename);
        extraction = await this.claude.extractKnowledge(
          input,
          apiKey,
          gate.model ?? undefined,
          {
            projectId: file.projectId,
            area: 'KNOWLEDGE_EXTRACTION',
            userId: batch?.createdById ?? null,
          },
        );
        file.update({ extractionResult: extraction as unknown as Prisma.InputJsonValue });
      } else {
        // AI OFF / OCR ブロック: Claude を呼ばず空抽出（文書ノードのみ作る）。
        const reason = !gate.aiExtractionEnabled
          ? 'AI抽出が無効のためテキストのみ保持します'
          : 'OCRが無効のため画像/PDFの抽出をスキップしました';
        await this.transition(file, 'EXTRACTING', reason, 60);
        file.update({ error: visionBlocked ? reason : null });
      }

      // ===== MERGING: ナレッジグラフへ冪等反映 =====
      await this.transition(file, 'MERGING', 'ナレッジグラフへ反映', 85);
      // contentText（全文保持の意図, spec §4.2）:
      //   - テキスト系（前処理で全文あり）: extractedText を使う。
      //   - PDF/画像（vision）: AI が書き起こした fullText、無ければ summary を最低限保持する。
      const contentText = needsVision
        ? extraction.fullText?.trim() || extraction.summary || null
        : extractedText;
      const knowledgeDocumentId = await this.merge(file, extraction, {
        kind,
        mimeType: mimeType ?? file.mimeType ?? null,
        contentText,
      });

      // ===== SUCCEEDED =====
      file.update({
        knowledgeDocumentId,
        finishedAt: new Date(),
        // SKIPPED 理由などの一時 error は成功時にクリア（visionBlocked の説明は step に残す）。
        error: null,
      });
      await this.transition(file, 'SUCCEEDED', '完了', 100);
      await this.refreshBatch(file.batchId);
      return { knowledgeDocumentId };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      this.logger.warn(`processFile(${fileId}) failed: ${message}`);
      // 失敗を IngestionFile に確定（status=FAILED + error）。親カウンタも反映。
      const fresh = await this.fileRepository.findById(fileId);
      if (fresh) {
        fresh.update({
          status: 'FAILED',
          step: '失敗',
          error: message,
          finishedAt: new Date(),
        });
        await this.fileRepository.save(fresh);
        await this.refreshBatch(fresh.batchId);
      }
      // Job 側に伝播させ自動/手動リトライへ（MERGE は冪等なので再実行は安全）。
      throw err instanceof Error ? err : new Error(message);
    }
  }

  /**
   * 原本をページ入力へ分割し、全ページ行を先に永続化してから最大2件だけを起動する。
   * 既存ページの upsert は状態/結果/jobId を変更しないため、親再開でも成功ページは再課金しない。
   */
  private async preparePagedFile(
    file: IngestionFile,
    bytes: Buffer,
    kind: 'pdf' | 'presentation',
    parentJobId: string,
  ): Promise<{
    knowledgeDocumentId: string;
    deferred: boolean;
    pages: number;
  }> {
    const title = file.displayName || file.filename;
    const document = await this.prisma.knowledgeDocument.upsert({
      where: { ingestionFileId: file.id },
      create: {
        ingestionFileId: file.id,
        projectId: file.projectId,
        title,
        sourceType: file.sourceType,
        sourceRef: file.sourceRef,
        blobUrl: file.blobUrl,
        mimeType: file.mimeType,
      },
      update: {
        title,
        sourceRef: file.sourceRef,
        blobUrl: file.blobUrl,
        mimeType: file.mimeType,
      },
      select: { id: true },
    });

    const prepared = await this.preparePageInputs(bytes, kind);

    if (prepared.length === 0) {
      return this.completeEmptyPagedFile(file, kind, parentJobId);
    }

    const existingPages = await this.pageRepository.listForFile({
      projectId: file.projectId,
      ingestionFileId: file.id,
    });
    const existingByNumber = new Map(
      existingPages.map((page) => [page.pageNumber, page]),
    );
    for (const page of prepared) {
      // upsertPending は既存行を完全に保持する。入力Blobも既存行があれば再利用できるが、
      // repository API は immutable create-if-absent のため、まず既存一覧で保存の重複を避ける。
      const existing = existingByNumber.get(page.pageNumber);
      let sourceBlobUrl = existing?.sourceBlobUrl ?? null;
      if (!sourceBlobUrl) {
        const saved = await this.blob.save(
          `ingestion/${file.projectId}/${file.id}/pages/${page.pageNumber}.${page.suffix}`,
          page.bytes,
          page.mimeType,
        );
        sourceBlobUrl = saved.url;
      }
      await this.pageRepository.upsertPending({
        projectId: file.projectId,
        ingestionFileId: file.id,
        knowledgeDocumentId: document.id,
        pageNumber: page.pageNumber,
        pageKind: page.pageKind,
        sourceText: page.sourceText,
        sourceBlobUrl,
      });
    }

    file.update({
      status: 'EXTRACTING',
      step: `ページごとに抽出中（${prepared.length}件）`,
      progress: 50,
      knowledgeDocumentId: document.id,
      error: null,
    });
    await this.fileRepository.save(file);

    await this.fillPageWorkerWindow(file, parentJobId, true);
    return {
      knowledgeDocumentId: document.id,
      deferred: true,
      pages: prepared.length,
    };
  }

  private async preparePageInputs(
    bytes: Buffer,
    kind: 'pdf' | 'presentation',
  ) {
    return kind === 'pdf'
      ? (await splitPdfPages(bytes)).map((page) => ({
            pageNumber: page.pageNumber,
            pageKind: 'PDF_PAGE' as const,
            sourceText: null,
            bytes: Buffer.from(page.bytes),
            mimeType: 'application/pdf',
            suffix: 'pdf',
          }))
      : readPptxSlides(bytes).map((slide) => ({
            pageNumber: slide.pageNumber,
            pageKind: 'PPTX_SLIDE' as const,
            sourceText: slide.sourceText,
            bytes: Buffer.from(
              JSON.stringify({
                version: 1,
                images: slide.images.map((image) => ({
                  mimeType: image.mimeType,
                  base64: Buffer.from(image.bytes).toString('base64'),
                })),
              }),
              'utf8',
            ),
            mimeType: 'application/json',
            suffix: 'json',
          }));
  }

  private async completeEmptyPagedFile(
    file: IngestionFile,
    kind: 'pdf' | 'presentation',
    parentJobId: string,
  ): Promise<{
    knowledgeDocumentId: string;
    deferred: false;
    pages: 0;
  }> {
    const empty = {
      ...this.emptyExtraction(),
      summary: '内容なし',
      fullText: '',
    };
    const knowledgeDocumentId = await this.merge(file, empty, {
      kind,
      mimeType: file.mimeType,
      contentText: '',
    });
    file.update({
      status: 'SUCCEEDED',
      step: '完了（0ページ）',
      progress: 100,
      extractedText: '',
      extractionResult: empty,
      knowledgeDocumentId,
      error: null,
      finishedAt: new Date(),
    });
    await this.fileRepository.save(file);
    await this.refreshBatch(file.batchId);
    await this.setParentState(parentJobId, file.projectId, 'SUCCEEDED', 100);
    return { knowledgeDocumentId, deferred: false, pages: 0 };
  }

  /** ページ子ジョブを実行する。pageId は実行ジョブの projectId で必ずスコープする。 */
  async processPage(
    pageId: string,
    childJobId: string,
  ): Promise<{ mergeQueued: boolean; obsolete?: boolean }> {
    const child = await this.prisma.backgroundJob.findUnique({
      where: { id: childJobId },
      select: {
        id: true,
        projectId: true,
        parentJobId: true,
        startedAt: true,
      },
    });
    if (!child?.projectId || !child.parentJobId) {
      throw new Error(
        `Page job ${childJobId} is missing its project or parent`,
      );
    }
    const page = await this.pageRepository.findById({
      id: pageId,
      projectId: child.projectId,
    });
    if (!page || page.jobId !== childJobId) {
      return { mergeQueued: false, obsolete: true };
    }
    if (page.status === 'SUCCEEDED') {
      return this.continueAfterPageSuccess(page, child.parentJobId);
    }

    const claimed = await this.pageRepository.markProcessing({
      id: page.id,
      projectId: page.projectId,
      jobId: childJobId,
    });
    if (!claimed) {
      const current = await this.pageRepository.findById({
        id: pageId,
        projectId: child.projectId,
      });
      if (current?.jobId === childJobId && current.status === 'SUCCEEDED') {
        return this.continueAfterPageSuccess(current, child.parentJobId);
      }
      return { mergeQueued: false, obsolete: true };
    }
    await this.setParentState(child.parentJobId, page.projectId, 'RUNNING');

    let file: IngestionFile;
    let batch: IngestionBatch | null;
    try {
      const foundFile = await this.fileRepository.findById(
        page.ingestionFileId,
      );
      if (!foundFile || foundFile.projectId !== page.projectId) {
        throw new Error(
          `IngestionFile ${page.ingestionFileId} not found in project ${page.projectId}`,
        );
      }
      file = foundFile;
      batch = await this.batchRepository.findById(file.batchId);
      const gate = await this.resolveGate(file.projectId, batch);
      const input = await this.buildPageExtractInput(page, file.filename);
      const emptySlide =
        page.pageKind === 'PPTX_SLIDE' &&
        !(page.sourceText ?? '').trim() &&
        (input.images?.length ?? 0) === 0;

      let extraction = emptySlide
        ? { ...this.emptyExtraction(), fullText: '', summary: '内容なし' }
        : { ...this.emptyExtraction(), fullText: page.sourceText ?? '' };

      const visionBlocked = page.pageKind === 'PDF_PAGE' && !gate.ocrEnabled;
      if (!emptySlide && gate.aiExtractionEnabled && !visionBlocked) {
        const apiKey = await this.companyKey.resolveForProject(
          file.projectId,
          batch?.createdById ?? undefined,
        );
        if (!apiKey) {
          throw new Error(
            'Anthropic APIキーが未設定です（会社設定・個人設定・環境変数のいずれにも見つかりません）',
          );
        }
        const result = await this.claude.extractPageKnowledge(
          input,
          apiKey,
          gate.model ?? undefined,
          {
            projectId: file.projectId,
            area: 'KNOWLEDGE_EXTRACTION',
            userId: batch?.createdById ?? null,
          },
          () => this.heartbeatPageJob(page, childJobId, child.startedAt),
        );
        extraction = {
          ...result,
          fullText:
            result.fullText.trim() ||
            page.sourceText ||
            result.summary ||
            '',
        };
      }

      const persisted = await this.pageRepository.markSucceeded({
        id: page.id,
        projectId: page.projectId,
        jobId: childJobId,
        contentText: extraction.fullText ?? '',
        summary: extraction.summary || (emptySlide ? '内容なし' : ''),
        extractionResult: extraction as unknown as Prisma.InputJsonValue,
      });
      if (!persisted) return { mergeQueued: false, obsolete: true };

    } catch (error) {
      const message = (error as Error)?.message ?? String(error);
      await this.pageRepository.markFailed({
        id: page.id,
        projectId: page.projectId,
        jobId: childJobId,
        error: message,
      });
      throw error instanceof Error ? error : new Error(message);
    }

    // ここから先は課金済み結果のorchestrationだけ。失敗してもpageをFAILEDへ戻さず、
    // 同じ子jobの再試行がSUCCEEDED fast-pathから安全に再開する。
    return this.continueAfterPageSuccess(page, child.parentJobId, file, batch);
  }

  private async continueAfterPageSuccess(
    page: KnowledgeDocumentPage,
    parentJobId: string,
    knownFile?: IngestionFile,
    knownBatch?: IngestionBatch | null,
  ): Promise<{ mergeQueued: boolean }> {
    const file =
      knownFile ?? (await this.fileRepository.findById(page.ingestionFileId));
    if (!file || file.projectId !== page.projectId) {
      throw new Error(
        `IngestionFile ${page.ingestionFileId} not found in project ${page.projectId}`,
      );
    }
    const batch =
      knownBatch === undefined
        ? await this.batchRepository.findById(file.batchId)
        : knownBatch;
    await this.fillPageWorkerWindow(file, parentJobId);
    if (
      !(await this.pageRepository.allSucceeded({
        projectId: page.projectId,
        ingestionFileId: page.ingestionFileId,
      }))
    ) {
      await this.settleFailedPagedFileIfIdle(file, parentJobId);
      return { mergeQueued: false };
    }
    await this.jobService.enqueue(
      'KG_MERGE_INGEST_FILE',
      { fileId: page.ingestionFileId },
      {
        projectId: page.projectId,
        createdById: batch?.createdById ?? null,
        parentJobId,
        dedupeId: this.mergeJobId(page.ingestionFileId),
      },
    );
    return { mergeQueued: true };
  }

  private async heartbeatPageJob(
    page: KnowledgeDocumentPage,
    childJobId: string,
    startedAt: Date | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.knowledgeDocumentPage.findFirst({
        where: {
          id: page.id,
          projectId: page.projectId,
          jobId: childJobId,
          status: 'PROCESSING',
        },
        select: { id: true },
      });
      if (!owned || !startedAt) throw new PageJobLeaseLostError(childJobId);
      const updated = await tx.backgroundJob.updateMany({
        where: {
          id: childJobId,
          projectId: page.projectId,
          status: 'RUNNING',
          startedAt,
        },
        data: { updatedAt: new Date() },
      });
      if (updated.count !== 1) throw new PageJobLeaseLostError(childJobId);
    });
  }

  private async assertMergeLease(
    jobId: string,
    projectId: string,
    startedAt: Date,
  ): Promise<void> {
    const live = await this.prisma.backgroundJob.findFirst({
      where: { id: jobId, projectId, status: 'RUNNING', startedAt },
      select: { id: true },
    });
    if (!live) throw new Error('Merge execution lease is no longer current');
  }

  /** JobService が自動試行上限到達を確定した後だけ呼ぶ。失敗で空いたslotを補充する。 */
  async handlePageJobTerminalFailure(
    pageId: string,
    childJobId: string,
  ): Promise<void> {
    const child = await this.prisma.backgroundJob.findUnique({
      where: { id: childJobId },
      select: { projectId: true, parentJobId: true },
    });
    if (!child?.projectId || !child.parentJobId) return;
    const page = await this.pageRepository.findById({
      id: pageId,
      projectId: child.projectId,
    });
    if (!page || page.jobId !== childJobId || page.status !== 'FAILED') return;
    const file = await this.fileRepository.findById(page.ingestionFileId);
    if (!file || file.projectId !== page.projectId) return;
    await this.setParentState(child.parentJobId, page.projectId, 'FAILED');
    await this.fillPageWorkerWindow(file, child.parentJobId);
    await this.settleFailedPagedFileIfIdle(file, child.parentJobId);
  }

  /** RUNNING parentのcrash復旧: 予約済みQUEUED子を再publishし、空きslotも同じrootへ補充する。 */
  async resumePagedFile(fileId: string, parentJobId: string): Promise<boolean> {
    const file = await this.fileRepository.findById(fileId);
    if (!file) throw new Error(`IngestionFile ${fileId} not found`);
    if (file.status !== 'SUCCEEDED') {
      file.update({
        status: 'EXTRACTING',
        step: 'ページ抽出を再開しています',
        progress: 50,
        error: null,
        finishedAt: null,
      });
      await this.fileRepository.save(file);
    }
    await this.fillPageWorkerWindow(file, parentJobId, true);

    // 全ページ成功後、merge job作成〜publish間で落ちたケースも同じstable IDから回収する。
    let recoveryTriggered = false;
    if (
      await this.pageRepository.allSucceeded({
        projectId: file.projectId,
        ingestionFileId: file.id,
      })
    ) {
      const stableMergeJobId = this.mergeJobId(file.id);
      const existingMerge = await this.prisma.backgroundJob.findUnique({
        where: { id: stableMergeJobId },
      });
      if (existingMerge?.status === 'QUEUED') {
        const started = await this.jobService.startReserved(existingMerge.id);
        recoveryTriggered = ['QUEUED', 'RUNNING'].includes(started.status);
      } else if (existingMerge?.status === 'FAILED') {
        const retried = await this.jobService.retry(existingMerge.id);
        recoveryTriggered = ['QUEUED', 'RUNNING'].includes(retried.status);
      } else if (existingMerge?.status === 'RUNNING') {
        const recovered = await this.jobService.recoverStaleRunning(
          existingMerge.id,
        );
        recoveryTriggered = ['QUEUED', 'RUNNING'].includes(recovered.status);
      } else if (existingMerge?.status === 'SUCCEEDED') {
        await this.setParentState(parentJobId, file.projectId, 'SUCCEEDED', 100);
      } else if (!existingMerge) {
        const batch = await this.batchRepository.findById(file.batchId);
        const enqueued = await this.jobService.enqueue(
          'KG_MERGE_INGEST_FILE',
          { fileId: file.id },
          {
            projectId: file.projectId,
            createdById: batch?.createdById ?? null,
            parentJobId,
            dedupeId: stableMergeJobId,
          },
        );
        recoveryTriggered = ['QUEUED', 'RUNNING'].includes(enqueued.status);
      }
    }
    return recoveryTriggered;
  }

  /** 全ページ結果を既存 merge semantics で文書/グラフへ一度だけ集約する。 */
  async mergePagedFile(
    fileId: string,
    mergeJobId: string,
    leaseStartedAt?: Date,
  ): Promise<{ knowledgeDocumentId: string; skipped?: boolean }> {
    const mergeJob = await this.prisma.backgroundJob.findUnique({
      where: { id: mergeJobId },
      select: { projectId: true, parentJobId: true },
    });
    if (!mergeJob?.projectId || !mergeJob.parentJobId) {
      throw new Error(
        `Merge job ${mergeJobId} is missing its project or parent`,
      );
    }
    if (leaseStartedAt) {
      await this.assertMergeLease(mergeJobId, mergeJob.projectId, leaseStartedAt);
    }
    const file = await this.fileRepository.findById(fileId);
    if (!file || file.projectId !== mergeJob.projectId) {
      throw new Error(
        `IngestionFile ${fileId} not found in project ${mergeJob.projectId}`,
      );
    }
    const pages = await this.pageRepository.listForFile({
      projectId: file.projectId,
      ingestionFileId: file.id,
    });
    if (
      pages.length === 0 ||
      pages.some((page) => page.status !== 'SUCCEEDED')
    ) {
      throw new Error(`IngestionFile ${fileId} still has unfinished pages`);
    }

    const aggregate = pages.reduce((result, page) => {
      const extraction = this.asPageExtraction(page.extractionResult);
      result.tags.push(...extraction.tags);
      result.entities.push(...extraction.entities);
      result.relations.push(...extraction.relations);
      return result;
    }, this.emptyExtraction());
    aggregate.summary = pages
      .filter((page) => (page.summary ?? '').trim())
      .map((page) => `ページ${page.pageNumber}: ${page.summary!.trim()}`)
      .join('\n');
    const contentText = pages
      .map((page) => {
        const heading =
          page.pageKind === 'PDF_PAGE'
            ? `## PDFページ ${page.pageNumber}`
            : `## スライド ${page.pageNumber}`;
        const body = (page.contentText ?? '').trim();
        return body ? `${heading}\n\n${body}` : heading;
      })
      .join('\n\n')
      .trim();
    aggregate.fullText = contentText;

    const kind: FileKind =
      pages[0].pageKind === 'PDF_PAGE' ? 'pdf' : 'presentation';
    const knowledgeDocumentId = await this.merge(file, aggregate, {
      kind,
      mimeType: file.mimeType,
      contentText,
      mergeLease: leaseStartedAt
        ? { jobId: mergeJobId, startedAt: leaseStartedAt }
        : undefined,
    });
    if (leaseStartedAt) {
      await this.assertMergeLease(mergeJobId, file.projectId, leaseStartedAt);
    }
    file.update({
      status: 'SUCCEEDED',
      step: '完了',
      progress: 100,
      extractedText: contentText,
      extractionResult: aggregate,
      knowledgeDocumentId,
      error: null,
      finishedAt: new Date(),
    });
    await this.fileRepository.save(file);
    await this.refreshBatch(file.batchId);
    await this.setParentState(
      mergeJob.parentJobId,
      file.projectId,
      'SUCCEEDED',
      100,
    );
    return { knowledgeDocumentId };
  }

  /**
   * file単位のPostgreSQL advisory transaction lockで、ページworkerのrolling windowを
   * 最大2件に保つ。BackgroundJob作成とpage.jobId claimは同一transactionなので、
   * worker間raceや「claimだけ残る」crash windowがない。
   */
  private async fillPageWorkerWindow(
    file: IngestionFile,
    parentJobId: string,
    recoverQueued = false,
  ): Promise<void> {
    const parent = await this.prisma.backgroundJob.findUnique({
      where: { id: parentJobId },
      select: { id: true, projectId: true, createdById: true },
    });
    if (!parent || parent.projectId !== file.projectId) {
      throw new Error(
        `Parent job ${parentJobId} not found in project ${file.projectId}`,
      );
    }

    const reserved = await this.prisma.$transaction(async (tx) => {
      // Parameterized call: fileId is data, never interpolated into SQL.
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        `knowledge-pages:${file.id}`,
      );
      const pages = await tx.knowledgeDocumentPage.findMany({
        where: { projectId: file.projectId, ingestionFileId: file.id },
        include: {
          job: {
            select: {
              id: true,
              status: true,
              updatedAt: true,
              startedAt: true,
            },
          },
        },
        orderBy: { pageNumber: 'asc' },
      });
      const staleBefore = Date.now() - 10 * 60 * 1000;
      const jobIsStale = (page: (typeof pages)[number]) =>
        page.job?.status === 'RUNNING' &&
        page.job.updatedAt.getTime() < staleBefore;
      const active = pages.filter(
        (page) =>
          page.status !== 'SUCCEEDED' &&
          page.job &&
          (page.job.status === 'QUEUED' ||
            (page.job.status === 'RUNNING' &&
              (!recoverQueued || !jobIsStale(page)))),
      );
      const available = Math.max(0, 2 - active.length);
      const candidates = pages.filter((page) => {
        if (page.status === 'PENDING' && !page.job) return true;
        if (!recoverQueued) return false;
        return (
          (page.status === 'FAILED' &&
            (!page.job ||
              page.job.status === 'FAILED' ||
              jobIsStale(page))) ||
          ((page.status === 'PENDING' || page.status === 'PROCESSING') &&
            (page.job?.status === 'FAILED' || jobIsStale(page)))
        );
      });
      const created: BackgroundJobReservation[] = [];
      for (const page of candidates.slice(0, available)) {
        if (jobIsStale(page) && page.job) {
          const finishedAt = new Date();
          const reason = 'superseded after page worker heartbeat lease expired';
          const superseded = await tx.backgroundJob.updateMany({
            where: {
              id: page.job.id,
              status: 'RUNNING',
              updatedAt: page.job.updatedAt,
            },
            data: {
              status: 'FAILED',
              attempts: { increment: 1 },
              error: reason,
              finishedAt,
            },
          });
          if (superseded.count !== 1) continue;
          await tx.backgroundJobAttempt.updateMany({
            where: { jobId: page.job.id, status: 'RUNNING' },
            data: {
              status: 'FAILED',
              error: reason,
              finishedAt,
              ...(page.job.startedAt
                ? {
                    durationMs: Math.max(
                      0,
                      finishedAt.getTime() - page.job.startedAt.getTime(),
                    ),
                  }
                : {}),
            },
          });
        }
        const id = randomUUID();
        const job = await tx.backgroundJob.create({
          data: {
            id,
            projectId: file.projectId,
            parentJobId,
            type: 'KG_INGEST_PAGE',
            status: 'QUEUED',
            payload: { pageId: page.id },
            createdById: parent.createdById,
            maxAttempts: JobService.MAX_ATTEMPTS,
          },
          select: { id: true, status: true },
        });
        const claimed = await tx.knowledgeDocumentPage.updateMany({
          where: {
            id: page.id,
            projectId: file.projectId,
            status: page.status,
            jobId: page.jobId,
          },
          data: { status: 'PENDING', jobId: id, error: null },
        });
        if (claimed.count !== 1) {
          throw new Error(`Knowledge page ${page.id} could not be claimed`);
        }
        created.push(job);
      }
      const recoverable = recoverQueued
        ? active
            .filter((page) => page.job?.status === 'QUEUED')
            .map((page) => ({ id: page.job!.id, status: 'QUEUED' as const }))
        : [];
      return [...recoverable, ...created];
    });

    const uniqueIds = [...new Set(reserved.map((job) => job.id))];
    await Promise.all(uniqueIds.map((id) => this.jobService.startReserved(id)));
  }

  private async buildPageExtractInput(
    page: KnowledgeDocumentPage,
    filename: string,
  ): Promise<{
    text?: string;
    pdfBase64?: string;
    images?: Array<{ base64: string; mimeType: string }>;
    filename: string;
  }> {
    if (!page.sourceBlobUrl) {
      throw new Error(`Knowledge page ${page.id} has no source input`);
    }
    const bytes = await this.blob.read(page.sourceBlobUrl);
    if (page.pageKind === 'PDF_PAGE') {
      return {
        pdfBase64: bytes.toString('base64'),
        filename: `${filename}#page=${page.pageNumber}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new Error(
        `PPTX slide ${page.pageNumber} input is corrupt: ${(error as Error)?.message ?? String(error)}`,
      );
    }
    const imageRows =
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { images?: unknown }).images)
        ? (parsed as { images: unknown[] }).images
        : [];
    const images = imageRows.filter(
      (image): image is { base64: string; mimeType: string } =>
        !!image &&
        typeof image === 'object' &&
        typeof (image as { base64?: unknown }).base64 === 'string' &&
        typeof (image as { mimeType?: unknown }).mimeType === 'string',
    );
    return {
      text: page.sourceText ?? '',
      images,
      filename: `${filename}#slide=${page.pageNumber}`,
    };
  }

  private async settleFailedPagedFileIfIdle(
    file: IngestionFile,
    parentJobId: string,
  ): Promise<void> {
    const pages = await this.pageRepository.listForFile({
      projectId: file.projectId,
      ingestionFileId: file.id,
    });
    const failedJobIds = pages
      .filter((page) => page.status === 'FAILED' && page.jobId)
      .map((page) => page.jobId!);
    const failedJobs = failedJobIds.length
      ? await this.prisma.backgroundJob.findMany({
          where: { id: { in: failedJobIds } },
          select: { id: true, status: true },
        })
      : [];
    const statusByJob = new Map(failedJobs.map((job) => [job.id, job.status]));
    const hasPermanentFailure = pages.some(
      (page) =>
        page.status === 'FAILED' &&
        !!page.jobId &&
        statusByJob.get(page.jobId) === 'FAILED',
    );
    const hasUnfinished = pages.some(
      (page) =>
        page.status === 'PENDING' ||
        page.status === 'PROCESSING' ||
        (page.status === 'FAILED' &&
          !!page.jobId &&
          ['QUEUED', 'RUNNING'].includes(statusByJob.get(page.jobId) ?? '')),
    );
    if (!hasPermanentFailure || hasUnfinished) return;
    file.update({
      status: 'FAILED',
      step: 'ページ抽出に失敗',
      error: '一部のページ抽出に失敗しました。親ジョブから再開できます。',
      finishedAt: new Date(),
    });
    await this.fileRepository.save(file);
    await this.setParentState(parentJobId, file.projectId, 'FAILED');
    await this.refreshBatch(file.batchId);
  }

  private mergeJobId(fileId: string): string {
    const hash = createHash('sha256')
      .update(`KG_MERGE_INGEST_FILE\0${fileId}`)
      .digest('hex')
      .slice(0, 32)
      .split('');
    // RFC 4122 variant/version bits make logs and DB tooling treat it as a normal stable UUID.
    hash[12] = '5';
    hash[16] = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
    const value = hash.join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  private async setParentState(
    parentJobId: string,
    projectId: string,
    status: 'RUNNING' | 'SUCCEEDED' | 'FAILED',
    progress = status === 'SUCCEEDED' ? 100 : status === 'RUNNING' ? 50 : 0,
  ): Promise<void> {
    await this.prisma.backgroundJob.updateMany({
      where: {
        id: parentJobId,
        projectId,
        status:
          status === 'FAILED'
            ? 'RUNNING'
            : { in: ['RUNNING', 'FAILED'] },
      },
      data: {
        status,
        progress,
        ...(status === 'SUCCEEDED'
          ? { error: null, finishedAt: new Date() }
          : status === 'RUNNING'
            ? { error: null, finishedAt: null }
            : {
                error: '一部のページ抽出に失敗しました。再開してください。',
                finishedAt: new Date(),
              }),
      },
    });
  }

  private asPageExtraction(value: Prisma.JsonValue | null): {
    summary: string;
    fullText?: string;
    tags: string[];
    entities: { label: string; kind: string; description?: string }[];
    relations: { from: string; to: string; label?: string }[];
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return this.emptyExtraction();
    }
    const row = value as Record<string, unknown>;
    return {
      summary: typeof row.summary === 'string' ? row.summary : '',
      fullText: typeof row.fullText === 'string' ? row.fullText : undefined,
      tags: Array.isArray(row.tags)
        ? row.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
      entities: Array.isArray(row.entities)
        ? row.entities.filter(
            (
              entity,
            ): entity is {
              label: string;
              kind: string;
              description?: string;
            } =>
              !!entity &&
              typeof entity === 'object' &&
              typeof (entity as { label?: unknown }).label === 'string' &&
              typeof (entity as { kind?: unknown }).kind === 'string',
          )
        : [],
      relations: Array.isArray(row.relations)
        ? row.relations.filter(
            (
              relation,
            ): relation is { from: string; to: string; label?: string } =>
              !!relation &&
              typeof relation === 'object' &&
              typeof (relation as { from?: unknown }).from === 'string' &&
              typeof (relation as { to?: unknown }).to === 'string',
          )
        : [],
    };
  }

  private isPptx(filename: string, mimeType: string | null): boolean {
    return (
      /\.pptx$/i.test(filename) ||
      /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/i.test(
        mimeType ?? '',
      )
    );
  }

  /**
   * KG_EXPAND_ARCHIVE 本体。ZIP を安全展開し、各エントリを Blob 保存＋子 IngestionFile(PENDING) として
   * 登録し KG_INGEST_FILE を起票する。アーカイブ自身は SUCCEEDED。
   * truncated/skipped は warning として error 欄に記録（無音で飛ばさない）。
   */
  async expandArchive(fileId: string): Promise<{ children: number; truncated: boolean }> {
    const file = await this.fileRepository.findById(fileId);
    if (!file) {
      throw new Error(`IngestionFile ${fileId} not found`);
    }

    file.incrementAttempts();
    file.update({ startedAt: file.startedAt ?? new Date(), finishedAt: null });
    await this.fileRepository.save(file);

    try {
      // ネスト深さ算出（parentFileId チェーンを辿る。root の zip = 深さ 1）。
      // 上限超過なら子展開せず SKIPPED（無音にしない）。
      const depth = await this.computeArchiveDepth(file);
      if (depth > KnowledgeIngestionService.MAX_ARCHIVE_DEPTH) {
        const reason = `アーカイブのネスト深さ上限超過（深さ ${depth} > ${KnowledgeIngestionService.MAX_ARCHIVE_DEPTH}）`;
        await this.transition(file, 'SKIPPED', reason, 100);
        file.update({ error: reason, finishedAt: new Date() });
        await this.fileRepository.save(file);
        await this.refreshBatch(file.batchId);
        return { children: 0, truncated: false };
      }

      await this.transition(file, 'FETCHING', 'アーカイブを取得しています', 10);
      const { bytes } = await this.fetchBytes(file);

      await this.transition(file, 'EXPANDING', 'アーカイブを展開しています', 40);
      const plan = this.extraction.expand(bytes, {
        maxEntries: KnowledgeIngestionService.EXPAND_MAX_ENTRIES,
        maxTotalBytes: KnowledgeIngestionService.EXPAND_MAX_TOTAL_BYTES,
        maxCompressedBytes:
          KnowledgeIngestionService.EXPAND_MAX_COMPRESSED_BYTES,
      });

      // 冪等化: リトライ/再実行で子を二重作成しないよう、この アーカイブ由来の
      // 既存子（parentFileId = file.id）を先に削除してから作り直す。
      // （onDelete: Cascade は親バッチ削除時のみ。ここは親=アーカイブの子掃除を明示的に行う。）
      await this.prisma.ingestionFile.deleteMany({
        where: { parentFileId: file.id },
      });

      // 各エントリを Blob 保存し、子 IngestionFile(PENDING) を作成。
      const children: IngestionFile[] = [];
      for (const entry of plan.entries) {
        const childId = this.fileRepository.generateId();
        const childName = entry.path.split('/').pop() || entry.path;
        const saved = await this.blob.save(
          `ingestion/${file.projectId}/${childId}/${childName}`,
          entry.bytes,
        );
        const child = IngestionFile.create(
          {
            batchId: file.batchId,
            projectId: file.projectId,
            sourceType: 'UPLOAD',
            sourceRef: null,
            filename: childName,
            displayName: entry.path,
            mimeType: this.guessMime(childName),
            size: entry.bytes.length,
            blobUrl: saved.url,
            isArchive: /\.zip$/i.test(childName),
            parentFileId: file.id,
            status: 'PENDING',
          },
          childId,
        );
        children.push(child);
      }
      if (children.length > 0) {
        await this.fileRepository.saveMany(children);
      }

      // 親バッチカウンタは実際の子行から再計算する（blind な加算だとリトライで二重加算になる）。
      // refreshBatch は findByBatchId を全スキャンして total/pending/succeeded/failed を再集計するため冪等。
      await this.refreshBatch(file.batchId);
      const batch = await this.batchRepository.findById(file.batchId);

      // 各子に KG_INGEST_FILE / KG_EXPAND_ARCHIVE を起票（payload=fileId）。
      for (const child of children) {
        const type = child.isArchive ? 'KG_EXPAND_ARCHIVE' : 'KG_INGEST_FILE';
        const job = await this.jobService.enqueue(
          type,
          { fileId: child.id },
          { projectId: child.projectId, createdById: batch?.createdById ?? null },
        );
        // jobId だけ部分更新（enqueue の inline 実行が確定させた子の status を巻き戻さない）。
        await this.fileRepository.setJobId(child.id, job.id);
      }

      // truncated / skipped を warning としてアーカイブ行に残す（無音にしない）。
      const warnings: string[] = [];
      if (plan.truncated) {
        warnings.push('上限超過のため一部のエントリを打ち切りました（zip-bomb 対策）');
      }
      if (plan.skipped.length > 0) {
        const reasons = [...new Set(plan.skipped.map((s) => s.reason))].join(', ');
        warnings.push(
          `${plan.skipped.length} 件のエントリを除外しました（理由: ${reasons}）`,
        );
      }

      const refreshed = await this.fileRepository.findById(file.id);
      const archive = refreshed ?? file;
      archive.update({
        status: 'SUCCEEDED',
        step: `展開完了（子 ${children.length} 件）`,
        progress: 100,
        error: warnings.length ? warnings.join(' / ') : null,
        finishedAt: new Date(),
      });
      await this.fileRepository.save(archive);
      await this.refreshBatch(file.batchId);
      return { children: children.length, truncated: plan.truncated };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      this.logger.warn(`expandArchive(${fileId}) failed: ${message}`);
      const fresh = await this.fileRepository.findById(fileId);
      if (fresh) {
        fresh.update({
          status: 'FAILED',
          step: '展開に失敗',
          error: message,
          finishedAt: new Date(),
        });
        await this.fileRepository.save(fresh);
        await this.refreshBatch(fresh.batchId);
      }
      throw err instanceof Error ? err : new Error(message);
    }
  }

  // ===================== 内部ヘルパ =====================

  /**
   * アーカイブのネスト深さを算出する（parentFileId チェーンを辿る）。
   * root の zip（parentFileId=null）は深さ 1。親が zip でない場合でも、
   * IngestionFile は「アーカイブから展開された子」だけが parentFileId を持つため、
   * チェーン長 +1 がそのまま zip ネスト深さになる。
   * 循環/異常データに対する保険として MAX_ARCHIVE_DEPTH+1 でホップ数を打ち切る。
   */
  private async computeArchiveDepth(file: IngestionFile): Promise<number> {
    let depth = 1;
    let parentId = file.parentFileId;
    const maxHops = KnowledgeIngestionService.MAX_ARCHIVE_DEPTH + 1;
    let hops = 0;
    while (parentId && hops < maxHops) {
      const parent = await this.fileRepository.findById(parentId);
      if (!parent) break;
      depth += 1;
      parentId = parent.parentFileId;
      hops += 1;
    }
    return depth;
  }

  /** IngestionFile の状態を更新して永続する（status/step/progress）。 */
  private async transition(
    file: IngestionFile,
    status: IngestionFileStatusValue,
    step: string,
    progress: number,
  ): Promise<void> {
    file.update({ status, step, progress });
    await this.fileRepository.save(file);
  }

  /**
   * 原本 bytes を取得する。
   *   - blobUrl があれば BlobStorage から読む。
   *   - 無ければソース種別ごとに取得し（ATTACHMENT=DB or ディスク）、Blob 保存して blobUrl を確定。
   */
  private async fetchBytes(
    file: IngestionFile,
  ): Promise<{ bytes: Buffer; mimeType: string | null }> {
    if (file.blobUrl) {
      const bytes = await this.blob.read(file.blobUrl);
      return { bytes, mimeType: file.mimeType };
    }

    if (file.sourceType === 'ATTACHMENT') {
      const { bytes, mimeType } = await this.fetchAttachmentBytes(file);
      const saved = await this.blob.save(
        `ingestion/${file.projectId}/${file.id}/${file.filename}`,
        bytes,
        mimeType ?? undefined,
      );
      file.update({ blobUrl: saved.url });
      await this.fileRepository.save(file);
      // mimeType は IngestionFile に setter が無いため、ローカル判定用に attachment 由来を優先して返す。
      return { bytes, mimeType: file.mimeType ?? mimeType };
    }

    if (file.sourceType === 'DRIVE') {
      // DRIVE: sourceRef = driveFileId。Drive からダウンロード → Blob 保存 → blobUrl 確定。
      // 以後（リトライ含む）は冒頭の blobUrl 分岐で Blob から読むため Drive を再度叩かない。
      if (!file.sourceRef) {
        throw new Error('DRIVE の sourceRef（driveFileId）が未設定です');
      }
      const { bytes, mimeType, filename } = await this.drive.downloadFile(
        file.projectId,
        file.sourceRef,
      );
      const saved = await this.blob.save(
        `ingestion/${file.projectId}/${file.id}/${file.filename || filename}`,
        bytes,
        mimeType ?? undefined,
      );
      file.update({ blobUrl: saved.url });
      await this.fileRepository.save(file);
      // Google ネイティブのエクスポートで mimeType が変わるため、Drive 由来を優先して返す。
      return { bytes, mimeType: mimeType ?? file.mimeType };
    }

    // UPLOAD は作成時に blobUrl が入っている前提。
    throw new Error(
      `原本の取得元が不明です（sourceType=${file.sourceType}, blobUrl 未設定）`,
    );
  }

  /** 既存 Attachment（DB Bytes or ディスク url）から bytes を取得。 */
  private async fetchAttachmentBytes(
    file: IngestionFile,
  ): Promise<{ bytes: Buffer; mimeType: string | null }> {
    if (!file.sourceRef) {
      throw new Error('ATTACHMENT の sourceRef（attachmentId）が未設定です');
    }
    // クロスプロジェクト流出防止: attachment は file.projectId にスコープして取得する。
    // 他プロジェクトの attachmentId を sourceRef に詰めても projectId 不一致で見つからない。
    const att = await this.prisma.attachment.findFirst({
      where: { id: file.sourceRef, projectId: file.projectId },
      select: { data: true, blobUrl: true, url: true, mimeType: true },
    });
    if (!att) {
      throw new Error(
        `Attachment ${file.sourceRef} が見つかりません（プロジェクト不一致の可能性）`,
      );
    }
    if (att.data) {
      return { bytes: Buffer.from(att.data), mimeType: att.mimeType };
    }
    // client直アップロード由来: Vercel Blob 公開URLから読む（read は Blob 公開ホストのみ許可）。
    if (att.blobUrl) {
      const bytes = await this.blob.read(att.blobUrl);
      return { bytes, mimeType: att.mimeType };
    }
    // ディスク参照（既存ローカル行）。url は `/uploads/...` 配信パス。
    // サーバ導出パス（DB 由来）なので readUploadFile（UPLOAD_DIR 限定）で読む。
    const bytes = await this.blob.readUploadFile(this.attachmentDiskPath(att.url));
    return { bytes, mimeType: att.mimeType };
  }

  /** Attachment の配信パス（/uploads/...）をディスク絶対パスへ。 */
  private attachmentDiskPath(url: string): string {
    const uploadDir =
      process.env.UPLOAD_DIR ||
      // 既存 Attachment と同じ場所（cwd/uploads）。
      `${process.cwd()}/uploads`;
    const name = url.replace(/^.*\/uploads\//, '').replace(/^\/+/, '');
    return `${uploadDir}/${name}`;
  }

  /**
   * 設定解決: ProjectKnowledgeSettings（get-or-create 既定）∧ batch.options。
   * バッチ option が明示 false なら AND で OFF にできる（「今回だけ AI OFF」）。
   */
  private async resolveGate(
    projectId: string,
    batch: IngestionBatch | null,
  ): Promise<{ aiExtractionEnabled: boolean; ocrEnabled: boolean; model: string | null }> {
    const settings = await this.prisma.projectKnowledgeSettings.findUnique({
      where: { projectId },
      select: { aiExtractionEnabled: true, ocrEnabled: true, defaultModel: true },
    });
    // 未作成プロジェクトは既定値（全 ON）として扱う。
    const baseAi = settings?.aiExtractionEnabled ?? true;
    const baseOcr = settings?.ocrEnabled ?? true;
    const baseModel = settings?.defaultModel ?? null;

    const opts = (batch?.options ?? {}) as Record<string, unknown>;
    const optAi = typeof opts.aiExtractionEnabled === 'boolean' ? opts.aiExtractionEnabled : true;
    const optOcr = typeof opts.ocrEnabled === 'boolean' ? opts.ocrEnabled : true;
    const optModel = typeof opts.model === 'string' && opts.model.trim() ? opts.model.trim() : null;

    return {
      aiExtractionEnabled: baseAi && optAi,
      ocrEnabled: baseOcr && optOcr,
      model: optModel ?? baseModel,
    };
  }

  /** ファイル種別に応じて Claude への入力（pdf/image/text）を組み立てる。 */
  private buildExtractInput(
    kind: FileKind,
    bytes: Buffer,
    text: string | null,
    filename: string,
  ): {
    text?: string;
    pdfBase64?: string;
    images?: { base64: string; mimeType: string }[];
    filename: string;
  } {
    if (kind === 'pdf') {
      return { pdfBase64: bytes.toString('base64'), filename };
    }
    if (kind === 'image') {
      return {
        images: [{ base64: bytes.toString('base64'), mimeType: this.guessMime(filename) }],
        filename,
      };
    }
    return { text: text ?? '', filename };
  }

  private emptyExtraction(): {
    summary: string;
    fullText?: string;
    tags: string[];
    entities: { label: string; kind: string; description?: string }[];
    relations: { from: string; to: string; label?: string }[];
  } {
    return { summary: '', tags: [], entities: [], relations: [] };
  }

  /**
   * MERGE（冪等）:
   *   1. KnowledgeDocument を ingestionFileId で upsert。
   *   2. 当該文書の既存 mention / (sourceDocumentId=この文書の) relation を削除（再実行のクリーン化）。
   *   3. buildMergePlan のノードを (projectId,type,normalizedLabel) で get-or-create。
   *   4. mention 作成（冪等: @@unique([documentId,nodeId])）。
   *   5. relation を端点ノード解決のうえ作成（冪等: @@unique）。
   * 全体を1トランザクションで実行する。
   */
  private async merge(
    file: IngestionFile,
    extraction: {
      summary: string;
      fullText?: string;
      tags: string[];
      entities: { label: string; kind: string; description?: string }[];
      relations: { from: string; to: string; label?: string }[];
    },
    meta: {
      kind: FileKind;
      mimeType: string | null;
      contentText: string | null;
      mergeLease?: { jobId: string; startedAt: Date };
    },
  ): Promise<string> {
    const projectId = file.projectId;
    const plan = buildMergePlan(extraction);
    const title = file.displayName || file.filename;

    return this.prisma.$transaction(async (tx) => {
      if (meta.mergeLease) {
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          `knowledge-merge:${file.id}`,
        );
        const live = await tx.backgroundJob.findFirst({
          where: {
            id: meta.mergeLease.jobId,
            projectId,
            status: 'RUNNING',
            startedAt: meta.mergeLease.startedAt,
          },
          select: { id: true },
        });
        if (!live) throw new Error('Merge execution lease is no longer current');
      }
      // 1. KnowledgeDocument upsert（1ファイル=1文書）。
      const existingDoc = await tx.knowledgeDocument.findUnique({
        where: { ingestionFileId: file.id },
        select: { id: true },
      });
      const docData = {
        projectId,
        title,
        summary: extraction.summary || null,
        contentText: meta.contentText,
        sourceType: file.sourceType,
        sourceRef: file.sourceRef,
        blobUrl: file.blobUrl,
        mimeType: meta.mimeType,
      };
      const doc = existingDoc
        ? await tx.knowledgeDocument.update({
            where: { id: existingDoc.id },
            data: docData,
          })
        : await tx.knowledgeDocument.create({
            data: { ingestionFileId: file.id, ...docData },
          });

      // 2. 再実行のクリーン化: 既存 mention と この文書発の relation を削除。
      //    削除前に「この文書が mention していた nodeId」を捕捉しておく。
      //    再抽出でその node が外れた場合でも mentionCount を再計算する対象に含めるため
      //    （含めないと旧 node の mentionCount が stale のまま残る）。
      const priorMentionNodes = await tx.knowledgeMention.findMany({
        where: { documentId: doc.id },
        select: { nodeId: true },
      });
      const priorMentionNodeIds = priorMentionNodes.map((m) => m.nodeId);
      await tx.knowledgeMention.deleteMany({ where: { documentId: doc.id } });
      await tx.knowledgeRelation.deleteMany({ where: { sourceDocumentId: doc.id } });

      // 3. ノード get-or-create（normalizedLabel キー）。競合耐性のため upsert を使う。
      //    複合一意キー @@unique([projectId, type, normalizedLabel]) → projectId_type_normalizedLabel。
      //    並行ジョブが同一ラベルを同時 create しても upsert なら一意制約違反で落ちない。
      //    既存ラベル表記は尊重（label は更新しない）。entityKind は未設定なら補完。
      const nodeIdByKey = new Map<string, string>();
      for (const node of plan.nodes) {
        const upserted = await tx.knowledgeNode.upsert({
          where: {
            projectId_type_normalizedLabel: {
              projectId,
              type: node.type,
              normalizedLabel: node.normalizedLabel,
            },
          },
          create: {
            projectId,
            type: node.type,
            entityKind: node.entityKind ?? null,
            label: node.label,
            normalizedLabel: node.normalizedLabel,
            description: node.description ?? null,
          },
          // 既存時は entityKind を補完するのみ（未設定なら埋める。表記ゆれは上書きしない）。
          update: node.entityKind ? { entityKind: node.entityKind } : {},
          select: { id: true },
        });
        nodeIdByKey.set(node.normalizedLabel, upserted.id);
      }

      // 4. mention 作成（この文書 ↔ 各ノード）。冪等のため createMany skipDuplicates。
      const mentionData = plan.mentions
        .map((m) => nodeIdByKey.get(m.normalizedLabel))
        .filter((id): id is string => !!id)
        .map((nodeId) => ({ projectId, documentId: doc.id, nodeId }));
      if (mentionData.length > 0) {
        await tx.knowledgeMention.createMany({
          data: mentionData,
          skipDuplicates: true,
        });
      }

      // 5. relation 作成（端点を normalizedLabel で解決。出所＝この文書）。
      //    @@unique([projectId, fromNodeId, toNodeId, label, sourceDocumentId]) のため
      //    createMany + skipDuplicates で冪等に（並行・再実行で重複しない）。
      const relSeen = new Set<string>();
      const relationData: {
        projectId: string;
        fromNodeId: string;
        toNodeId: string;
        label: string | null;
        sourceDocumentId: string;
      }[] = [];
      for (const rel of plan.relations) {
        const fromId = nodeIdByKey.get(rel.fromKey);
        const toId = nodeIdByKey.get(rel.toKey);
        if (!fromId || !toId || fromId === toId) continue;
        const label = rel.label ?? null;
        const dedupeKey = `${fromId}|${toId}|${label ?? ''}`;
        if (relSeen.has(dedupeKey)) continue;
        relSeen.add(dedupeKey);
        relationData.push({
          projectId,
          fromNodeId: fromId,
          toNodeId: toId,
          label,
          sourceDocumentId: doc.id,
        });
      }
      if (relationData.length > 0) {
        await tx.knowledgeRelation.createMany({
          data: relationData,
          skipDuplicates: true,
        });
      }

      // mentionCount を実 mention 数で再計算（名寄せの可視化用）。
      // 新規 node に加え、再抽出で外れた旧 node（priorMentionNodeIds）も対象に含める
      // ことで、外れた node の count が減算されず stale になるのを防ぐ。
      const nodesToRecount = new Set<string>([
        ...nodeIdByKey.values(),
        ...priorMentionNodeIds,
      ]);
      for (const nodeId of nodesToRecount) {
        const count = await tx.knowledgeMention.count({ where: { nodeId } });
        await tx.knowledgeNode.update({
          where: { id: nodeId },
          data: { mentionCount: count },
        });
      }

      if (meta.mergeLease) {
        const live = await tx.backgroundJob.findFirst({
          where: {
            id: meta.mergeLease.jobId,
            projectId,
            status: 'RUNNING',
            startedAt: meta.mergeLease.startedAt,
          },
          select: { id: true },
        });
        if (!live) throw new Error('Merge execution lease expired during merge');
      }

      // 抽出が空（AI OFF 等）でも文書ノードは作る契約。
      return doc.id;
    });
  }

  /**
   * 親バッチのカウンタ（succeeded/failed/pending/total）と status を、子ファイルの実状態から再計算する。
   * ファイル完了/失敗のたびに呼ぶ。冪等（毎回フルスキャン）。
   */
  private async refreshBatch(batchId: string): Promise<void> {
    const files = await this.fileRepository.findByBatchId(batchId);
    const batch = await this.batchRepository.findById(batchId);
    if (!batch) return;

    // CANCELLED は手動確定状態。集計で上書きしない。
    if (batch.status === 'CANCELLED') return;

    const statuses = files.map((f) => f.status as FileStatus);
    const succeeded = statuses.filter((s) => s === 'SUCCEEDED' || s === 'SKIPPED').length;
    const failed = statuses.filter((s) => s === 'FAILED').length;
    const pending = statuses.filter((s) => s === 'PENDING').length;
    const aggregated = aggregateBatchStatus(statuses);

    const settled = aggregated === 'SUCCEEDED' || aggregated === 'FAILED' || aggregated === 'PARTIAL';
    batch.update({
      status: aggregated,
      totalFiles: files.length,
      succeededFiles: succeeded,
      failedFiles: failed,
      pendingFiles: pending,
      finishedAt: settled ? batch.finishedAt ?? new Date() : null,
    });
    await this.batchRepository.save(batch);
  }

  /** 拡張子から MIME を推定（展開した子ファイルや画像入力の media_type 用）。 */
  private guessMime(filename: string): string {
    const ext = (/\.([a-z0-9]+)$/i.exec(filename || '')?.[1] || '').toLowerCase();
    switch (ext) {
      case 'pdf':
        return 'application/pdf';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      case 'xls':
        return 'application/vnd.ms-excel';
      case 'csv':
        return 'text/csv';
      case 'docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      case 'doc':
        return 'application/msword';
      case 'zip':
        return 'application/zip';
      case 'json':
        return 'application/json';
      case 'md':
      case 'markdown':
        return 'text/markdown';
      case 'txt':
        return 'text/plain';
      default:
        return 'application/octet-stream';
    }
  }
}
