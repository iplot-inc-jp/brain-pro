import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { BlobStorageService } from '../services/blob-storage.service';
import { CompanyKeyService } from '../services/company-key.service';
import { ClaudeService } from '../services/claude.service';
import { JobService } from '../services/job.service';
import { FileExtractionService, FileKind } from './file-extraction.service';
import { DriveService } from './drive.service';
import { buildMergePlan } from './lib/merge-plan';
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
  async processFile(fileId: string): Promise<{ knowledgeDocumentId?: string; skipped?: boolean }> {
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
      select: { data: true, url: true, mimeType: true },
    });
    if (!att) {
      throw new Error(
        `Attachment ${file.sourceRef} が見つかりません（プロジェクト不一致の可能性）`,
      );
    }
    if (att.data) {
      return { bytes: Buffer.from(att.data), mimeType: att.mimeType };
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
    meta: { kind: FileKind; mimeType: string | null; contentText: string | null },
  ): Promise<string> {
    const projectId = file.projectId;
    const plan = buildMergePlan(extraction);
    const title = file.displayName || file.filename;

    return this.prisma.$transaction(async (tx) => {
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
