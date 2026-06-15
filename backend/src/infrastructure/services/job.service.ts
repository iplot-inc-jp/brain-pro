import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { assertSafeOutboundUrl } from './url-safety';
import { BackgroundJob, Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { QStashService } from './qstash.service';
import { CompanyKeyService } from './company-key.service';
import { ClaudeService } from './claude.service';
import { CryptoService } from './crypto.service';
import { ImportMermaidUseCase } from '../../application/use-cases/data-object/import-mermaid.use-case';
import { GenerateKpisUseCase } from '../../application/use-cases/kpi/generate-kpis.use-case';
import { TrackerImportService } from './trackers/tracker-import.service';
import { KnowledgeIngestionService } from '../knowledge/knowledge-ingestion.service';

/**
 * 非同期バックグラウンドジョブの起票・実行サービス。
 *
 * トランスポートは Upstash QStash（push型）:
 *   起票 → QStash publish → QStash が POST /api/jobs/run {jobId} を叩く → runJob(id)。
 * QStash env が無いローカルでは inline fallback（enqueue 内で await runJob）し、
 * dev でも全機能が完結するようにする。
 *
 * 冪等性: QStash は at-least-once 配信のため、runJob は QUEUED→RUNNING の遷移を
 * 条件付き updateMany で原子的に行い、遷移を勝ち取った呼び出し（count===1）だけが
 * 実行する（同一 jobId が並行到達しても二重 dispatch しない）。
 * 一過性失敗時は QUEUED へ戻して QStash の自動リトライ(retries:3)に委ね、
 * 試行回数(MAX_ATTEMPTS)を使い切ったら FAILED で確定する。
 *
 * 秘匿情報（APIキー等）は payload に入れない。鍵は実行時に CompanyKeyService で解決する。
 */
@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qstash: QStashService,
    private readonly companyKey: CompanyKeyService,
    private readonly claude: ClaudeService,
    private readonly crypto: CryptoService,
    private readonly importMermaid: ImportMermaidUseCase,
    private readonly generateKpis: GenerateKpisUseCase,
    private readonly trackerImport: TrackerImportService,
    // KnowledgeIngestionService ↔ JobService は相互参照（取り込みパイプラインが子ジョブを起票する）。
    @Inject(forwardRef(() => KnowledgeIngestionService))
    private readonly knowledgeIngestion: KnowledgeIngestionService,
  ) {}

  /**
   * ジョブを QUEUED で起票する。
   *   - QStash が使えるなら publish して QUEUED の job を即返す（実際の実行は別プロセス）。
   *   - 使えない（ローカル）なら await runInline で終端まで実行して完了 job を返す（inline fallback）。
   */
  async enqueue(
    type: string,
    payload: Record<string, unknown> | undefined,
    opts: { projectId?: string | null; createdById?: string | null } = {},
  ): Promise<BackgroundJob> {
    const job = await this.prisma.backgroundJob.create({
      data: {
        type,
        status: 'QUEUED',
        payload: (payload ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        projectId: opts.projectId ?? null,
        createdById: opts.createdById ?? null,
        // 自動リトライ予算を MAX_ATTEMPTS(=4) に揃える。
        // schema 既定(3) のままだと runJob の `attemptsAfter < job.maxAttempts` が
        // 「初回+リトライ2回=3」で確定し、QStash(retries:3=最大4配信) と不整合になる。
        maxAttempts: JobService.MAX_ATTEMPTS,
      },
    });

    if (this.qstash.publishEnabled) {
      // 本番: QStash に実行を委譲。publish 失敗時も例外は握られ、QUEUED のまま残る。
      await this.qstash.publishJob(job.id);
      return job;
    }

    // ローカル/QStash無: その場で終端（SUCCEEDED/FAILED）まで実行して完了 job を返す。
    return this.runInline(job.id);
  }

  /**
   * inline（QStash 無）経路でジョブを終端状態まで実行する。
   *
   * runJob は一過性失敗時に job を QUEUED へ戻す（attempts を増やす）だけで自身では再実行しない
   * 設計のため、本番ではその後 QStash の自動リトライ(retries:3)が QUEUED を再配信して runJob を
   * 再度叩く。QStash が無いローカルでは再配信する主体がいないので、ここでループして
   * 「QUEUED に戻った＝再試行余地あり」の間は runJob を呼び直し、自動リトライを inline で再現する。
   *
   * 終了条件: status が QUEUED 以外（SUCCEEDED/FAILED/RUNNING）になったら返す。
   * 安全弁: maxAttempts を超える反復はしない（万一 QUEUED から進まない場合の無限ループ防止）。
   */
  private async runInline(id: string): Promise<BackgroundJob> {
    // 反復回数の上限。job.maxAttempts を権威に、+1 の余裕を持たせる（取りこぼし防止）。
    const initial = await this.prisma.backgroundJob.findUnique({
      where: { id },
      select: { maxAttempts: true },
    });
    const maxIterations = (initial?.maxAttempts ?? JobService.MAX_ATTEMPTS) + 1;

    let job = await this.runJob(id);
    let iterations = 1;
    while (job.status === 'QUEUED' && iterations < maxIterations) {
      // runJob が一過性失敗で QUEUED に戻した。自動リトライを inline で続行する。
      job = await this.runJob(id);
      iterations += 1;
    }
    return job;
  }

  /**
   * 手動リトライ。FAILED の job を QUEUED に戻して再起票する。
   *   - attempts はリセットしない（試行履歴を保持する）。
   *     ただし自動リトライ上限が消費済みのまま再実行できるよう、maxAttempts を
   *     「現 attempts + 残り猶予(MAX_ATTEMPTS)」まで引き上げ、再びリトライ余地を確保する。
   *   - error/result/finishedAt/startedAt はクリアし、QUEUED の状態へ戻す。
   *   - QStash があれば publish、無ければ inline で即時 runJob。
   *
   * SUCCEEDED は再実行対象にしない:
   *   - 確定済みの成功 result を破棄してしまい、再試行が一過性失敗で FAILED 終端すると
   *     元の成果物が永久に失われる。
   *   - AI_KPI のように dispatch が非冪等（毎回 DRAFT KPI を純加算し Claude API を再課金）な
   *     type では、成功ジョブの再実行が重複データ生成・二重課金を招く。
   *   再実行の目的は FAILED の再試行であり、成功ジョブの「やり直し」は新規起票で行う。
   *
   * 認可はコントローラ側のゲートで行う（ここでは行わない）。
   */
  async retry(id: string): Promise<BackgroundJob> {
    const job = await this.prisma.backgroundJob.findUnique({ where: { id } });
    if (!job) {
      throw new Error(`Job ${id} not found`);
    }
    if (job.status !== 'FAILED') {
      throw new Error(`Job ${id} is ${job.status}; only FAILED jobs can be retried`);
    }

    // QUEUED へ戻す。attempts は保持し、maxAttempts に再試行余地を足す
    // （自動リトライ上限を使い切った FAILED でも、手動再起票後に自動リトライが効く）。
    const requeued = await this.prisma.backgroundJob.update({
      where: { id },
      data: {
        status: 'QUEUED',
        maxAttempts: job.attempts + JobService.MAX_ATTEMPTS,
        error: null,
        result: Prisma.JsonNull,
        progress: 0,
        startedAt: null,
        finishedAt: null,
      },
    });

    if (this.qstash.publishEnabled) {
      await this.qstash.publishJob(requeued.id);
      return requeued;
    }
    // ローカル/QStash無: その場で終端まで実行して完了 job を返す。
    return this.runInline(requeued.id);
  }

  /**
   * 既定の最大試行回数（新規 enqueue でモデル既定 maxAttempts を上書きしたい場合の参考値）。
   * 実際の自動リトライ上限は各 job の BackgroundJob.maxAttempts を権威として使う。
   * QStash の publishJob(retries:3) と整合させ「初回 + リトライ3回 = 4」とする。
   */
  static readonly MAX_ATTEMPTS = 4;

  /**
   * ジョブ本体を実行する。
   * QStash ワーカー(POST /api/jobs/run)と inline fallback の両方から呼ばれる。
   *
   * 冪等: status!=QUEUED ならスキップ（at-least-once の二重実行防止）。
   *
   * 試行記録: 実行開始ごとに BackgroundJobAttempt(RUNNING) を作成し、
   * 成功/失敗で SUCCEEDED/FAILED + finishedAt + durationMs（失敗時は error 全文）を確定する。
   *
   * @param opts.throwOnFailure
   *   true（QStash ワーカー経路）: dispatch が一過性エラーで失敗し、かつ試行回数が
   *   job.maxAttempts 未満なら、job を QUEUED に戻したうえで例外を再 throw する。
   *   これによりワーカーは非2xx を返し、QStash の自動リトライ(retries:3)が発火する。
   *   QUEUED に戻すのは、FAILED のままだと runJob の冪等ガードが再配信をスキップしてしまい、
   *   リトライ経路が成立しないため（= 再試行可能状態に保つ）。
   *   試行回数を使い切った場合は FAILED で確定し、throw せず返す（QStash はリトライを止める）。
   *
   *   false（inline fallback）: 一過性失敗かつ上限未満なら QUEUED に戻すだけで throw せず、
   *   QStash/手動リトライに委ねる（即時再帰はしない）。上限到達なら FAILED の job を返す
   *   （enqueue の戻り値契約・フロントのポーリング前提を変えない）。
   */
  async runJob(
    id: string,
    opts: { throwOnFailure?: boolean } = {},
  ): Promise<BackgroundJob> {
    const job = await this.prisma.backgroundJob.findUnique({ where: { id } });
    if (!job) {
      this.logger.warn(`runJob: job ${id} not found`);
      throw new Error(`Job ${id} not found`);
    }
    if (job.status !== 'QUEUED') {
      // すでに実行中/完了/失敗 → 二重配信なのでスキップして現状を返す。
      this.logger.log(`runJob: job ${id} is ${job.status}, skipping (idempotent)`);
      return job;
    }

    // RUNNING へ遷移（startedAt 記録）。
    // 冪等性の要: check-then-act を非アトミックにすると TOCTOU レース
    // （QStash の at-least-once 配信＋retries で同一 jobId が並行到達した場合、
    //  上の findUnique では両者とも QUEUED を読みうる）で二重 dispatch されるため、
    //  QUEUED→RUNNING の遷移を条件付き updateMany で原子的に行い、
    //  count===1（＝この呼び出しが遷移を勝ち取った）時だけ実行する。
    const claimed = await this.prisma.backgroundJob.updateMany({
      where: { id, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date(), progress: 10 },
    });
    if (claimed.count !== 1) {
      // 別の並行実行が先に QUEUED→RUNNING を確定させた。二重 dispatch しない。
      const current = await this.prisma.backgroundJob.findUnique({ where: { id } });
      this.logger.log(
        `runJob: job ${id} already claimed (now ${current?.status ?? 'unknown'}), skipping (idempotent)`,
      );
      return current ?? job;
    }

    // この実行ぶんの試行番号（1始まり）。job は claim 前に読んだ値なので attempts+1。
    const attemptNo = job.attempts + 1;
    const attemptStartedAt = new Date();
    // 試行記録（RUNNING）を作成。@@unique([jobId, attemptNo]) で二重記録を防ぐが、
    // 万一の重複でも本体実行を止めないよう作成失敗は握りつぶしてログのみ。
    const attempt = await this.createAttempt(id, attemptNo, attemptStartedAt);

    try {
      const result = await this.dispatch(job);
      // 成功: 試行記録を SUCCEEDED で確定。
      await this.finishAttempt(attempt?.id, {
        status: 'SUCCEEDED',
        startedAt: attemptStartedAt,
      });
      return this.prisma.backgroundJob.update({
        where: { id },
        data: {
          status: 'SUCCEEDED',
          result: (result ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          progress: 100,
          error: null,
          finishedAt: new Date(),
        },
      });
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      // エラーは（スタック含め）全文記録する。秘匿値は payload に入れない方針のため
      // 例外メッセージにも通常は鍵等は乗らないが、記録対象は例外文言のみに限定する。
      const errorText = this.extractError(err);
      // 試行記録を FAILED で確定（エラー全文 + 所要時間）。
      await this.finishAttempt(attempt?.id, {
        status: 'FAILED',
        startedAt: attemptStartedAt,
        error: errorText,
      });

      // この実行ぶんの試行回数（= attemptNo）。
      const attemptsAfter = attemptNo;
      // 自動リトライ条件: 上限(maxAttempts)未満であること。
      // ワーカー経路(throwOnFailure)は QStash の自動リトライへ、
      // inline 経路は QUEUED のままにして QStash/手動に委ねる（即時再帰はしない）。
      const canAutoRetry = attemptsAfter < job.maxAttempts;

      if (canAutoRetry) {
        // 再試行可能: QUEUED へ戻し（runJob の冪等ガードを通せるようにする）、
        // attempts/error を記録する。
        this.logger.warn(
          `Job ${id} (${job.type}) failed (attempt ${attemptsAfter}/${job.maxAttempts}), requeueing for retry: ${message}`,
        );
        await this.prisma.backgroundJob.update({
          where: { id },
          data: {
            status: 'QUEUED',
            error: errorText,
            attempts: { increment: 1 },
            progress: 0,
            startedAt: null,
          },
        });

        if (opts.throwOnFailure === true) {
          // ワーカー経路: 例外を再 throw → ワーカーが非2xx を返し QStash 自動リトライが発火。
          throw err instanceof Error ? err : new Error(message);
        }

        // inline 経路: 即時再帰は避け、QUEUED のままにして QStash/手動リトライに委ねる。
        // FAILED ではなく QUEUED の job を返す（呼び出し側のポーリングは継続可能）。
        const requeued = await this.prisma.backgroundJob.findUnique({ where: { id } });
        return requeued ?? job;
      }

      // 試行回数を使い切った → FAILED で確定。
      this.logger.error(
        `Job ${id} (${job.type}) failed permanently (attempt ${attemptsAfter}/${job.maxAttempts}): ${message}`,
      );
      return this.prisma.backgroundJob.update({
        where: { id },
        data: {
          status: 'FAILED',
          error: errorText,
          attempts: { increment: 1 },
          finishedAt: new Date(),
        },
      });
    }
  }

  /**
   * 試行記録（RUNNING）を作成する。
   * @@unique([jobId, attemptNo]) 違反など作成に失敗しても本体実行は止めず、
   * undefined を返して記録だけ欠落させる（実行の冪等性・成功を優先）。
   */
  private async createAttempt(
    jobId: string,
    attemptNo: number,
    startedAt: Date,
  ): Promise<{ id: string } | undefined> {
    try {
      return await this.prisma.backgroundJobAttempt.create({
        data: { jobId, attemptNo, status: 'RUNNING', startedAt },
        select: { id: true },
      });
    } catch (e) {
      this.logger.warn(
        `Failed to create attempt record (job ${jobId}, attempt ${attemptNo}): ${(e as Error)?.message ?? String(e)}`,
      );
      return undefined;
    }
  }

  /**
   * 試行記録を終了状態（SUCCEEDED/FAILED）で確定する。
   * finishedAt と durationMs（startedAt からの経過ms）を埋める。
   */
  private async finishAttempt(
    attemptId: string | undefined,
    args: {
      status: 'SUCCEEDED' | 'FAILED';
      startedAt: Date;
      error?: string | null;
    },
  ): Promise<void> {
    if (!attemptId) return;
    const finishedAt = new Date();
    try {
      await this.prisma.backgroundJobAttempt.update({
        where: { id: attemptId },
        data: {
          status: args.status,
          error: args.error ?? null,
          finishedAt,
          durationMs: finishedAt.getTime() - args.startedAt.getTime(),
        },
      });
    } catch (e) {
      this.logger.warn(
        `Failed to finalize attempt record ${attemptId}: ${(e as Error)?.message ?? String(e)}`,
      );
    }
  }

  /**
   * 例外からエラー全文を抽出する（スタック含む）。
   * 記録は例外文言のみに限定し、payload や鍵などの秘匿値は混ぜない。
   */
  private extractError(err: unknown): string {
    if (err instanceof Error) {
      return err.stack ? `${err.message}\n${err.stack}` : err.message;
    }
    return String(err);
  }

  /** ジョブ type を許可リスト（コントローラの起票検証に使う）。 */
  static readonly ALLOWED_TYPES = [
    'AI_MERMAID_OBJECTMAP',
    'AI_MERMAID_FLOW',
    'AI_KPI',
    'AI_ISSUE_SUGGEST',
    // ナレッジ取り込み（1ファイル=1ジョブ）。
    'KG_INGEST_FILE',
    'KG_EXPAND_ARCHIVE',
  ] as const;

  static isAllowedType(type: string): boolean {
    return (JobService.ALLOWED_TYPES as readonly string[]).includes(type);
  }

  /**
   * type ごとの実処理。result（JSON化可能な構造）を返す。
   *
   * 実装方針:
   *   - 永続まで配線が軽いものは use-case を呼び永続する（AI_MERMAID_OBJECTMAP / AI_KPI）。
   *   - 永続配線が重いものは ClaudeService の parse 結果（構造化JSON）を result に返す
   *     compute ジョブとし、クライアントが既存の同期エンドポイントで適用する
   *     （AI_MERMAID_FLOW / AI_ISSUE_SUGGEST）。
   */
  private async dispatch(job: BackgroundJob): Promise<unknown> {
    const payload = (job.payload ?? {}) as Record<string, unknown>;

    switch (job.type) {
      // ===== 永続ジョブ（use-case 経由） =====
      case 'AI_MERMAID_OBJECTMAP': {
        // 必須実装: Mermaid → オブジェクトマップ parse + 永続。
        const projectId = this.requireString(job.projectId, 'projectId');
        const userId = this.requireString(job.createdById, 'createdById');
        const mermaid = this.requireString(payload.mermaid, 'payload.mermaid');
        const graph = await this.importMermaid.execute({ userId, projectId, mermaid });
        return { kind: 'OBJECT_GRAPH', graph };
      }

      case 'AI_KPI': {
        // KPI 生成（DRAFT で永続）。use-case がクリーンに呼べるので永続まで実施。
        const projectId = this.requireString(job.projectId, 'projectId');
        const userId = this.requireString(job.createdById, 'createdById');
        const kpis = await this.generateKpis.execute({
          userId,
          projectId,
          category: this.requireString(payload.category, 'payload.category') as
            | 'BUSINESS'
            | 'AI_QUALITY',
          flowId: (payload.flowId as string | null) ?? null,
          systemId: (payload.systemId as string | null) ?? null,
          informationTypeIds: Array.isArray(payload.informationTypeIds)
            ? (payload.informationTypeIds as string[])
            : [],
          instructions: (payload.instructions as string | null) ?? null,
          count: typeof payload.count === 'number' ? payload.count : undefined,
        });
        return { kind: 'KPIS', kpis };
      }

      // ===== compute ジョブ（parse 結果を result に返す。永続はクライアント側） =====
      case 'AI_MERMAID_FLOW': {
        const projectId = this.requireString(job.projectId, 'projectId');
        const mermaid = this.requireString(payload.mermaid, 'payload.mermaid');
        const apiKey = await this.resolveKey(projectId, job.createdById);
        const flow = await this.claude.parseMermaidToFlow(mermaid, apiKey);
        return { kind: 'MERMAID_FLOW', flow };
      }

      case 'AI_ISSUE_SUGGEST': {
        // payload に IssueNodeSuggestContext 相当を載せて compute する。
        // （ツリー/ノード文脈の構築はクライアント or 既存エンドポイント側で行う方針）
        const projectId = this.requireString(job.projectId, 'projectId');
        const apiKey = await this.resolveKey(projectId, job.createdById);
        const context = payload.context as Record<string, unknown> | undefined;
        if (!context) {
          throw new Error('payload.context が必要です（IssueNodeSuggestContext）');
        }
        const suggestions = await this.claude.suggestIssueNodes(
          {
            pattern: String(context.pattern ?? ''),
            treeName: String(context.treeName ?? ''),
            rootQuestion: (context.rootQuestion as string | null) ?? null,
            targetLabel: String(context.targetLabel ?? ''),
            targetKind: String(context.targetKind ?? ''),
            parentLabels: Array.isArray(context.parentLabels)
              ? (context.parentLabels as string[])
              : [],
            expectedKind: String(context.expectedKind ?? ''),
            expectedKindLabel: String(context.expectedKindLabel ?? ''),
            gapBusinessArea: (context.gapBusinessArea as string | null) ?? null,
            gapDescription: (context.gapDescription as string | null) ?? null,
            userContext: (context.userContext as string | null) ?? null,
            ideationMethodName: (context.ideationMethodName as string | null) ?? null,
            ideationLenses: Array.isArray(context.ideationLenses)
              ? (context.ideationLenses as string[])
              : null,
          },
          apiKey,
        );
        return { kind: 'ISSUE_SUGGESTIONS', suggestions };
      }

      // ===== 外部トラッカー移行/同期ジョブ（Backlog/Jira → Task） =====
      case 'TRACKER_IMPORT': {
        const connectionId = this.requireString(
          payload.connectionId,
          'payload.connectionId',
        );
        const mode: 'full' | 'incremental' =
          payload.mode === 'incremental' ? 'incremental' : 'full';
        const result = await this.trackerImport.run(
          connectionId,
          mode,
          (progress) => this.updateProgress(job.id, progress),
        );
        return { kind: 'TRACKER_IMPORT', ...result };
      }

      // ===== ナレッジ取り込みジョブ（1ファイル=1ジョブ） =====
      case 'KG_INGEST_FILE': {
        // FETCH→PREPROCESS→EXTRACT→MERGE。IngestionFile.status を各段で更新する。
        const fileId = this.requireString(payload.fileId, 'payload.fileId');
        const result = await this.knowledgeIngestion.processFile(fileId);
        return { kind: 'KG_INGEST_FILE', fileId, ...result };
      }

      case 'KG_EXPAND_ARCHIVE': {
        // ZIP を安全展開し、子 IngestionFile を作成＆ KG_INGEST_FILE を起票する。
        const fileId = this.requireString(payload.fileId, 'payload.fileId');
        const result = await this.knowledgeIngestion.expandArchive(fileId);
        return { kind: 'KG_EXPAND_ARCHIVE', fileId, ...result };
      }

      // ===== Webhook 配信ジョブ（タスクイベントを外部=ipro-kun 等へ POST） =====
      case 'WEBHOOK_DELIVERY': {
        return this.deliverWebhook(payload);
      }

      default:
        throw new Error(`未知のジョブ種別です: ${job.type}`);
    }
  }

  /**
   * Webhook 配信本体。payload.webhookId から Webhook を引き、署名付きで HTTP POST する。
   *
   * - 非アクティブ/未存在の Webhook は no-op で成功扱い（起票後に無効化された等）。
   * - secret があれば本文 JSON を HMAC-SHA256 で署名し
   *   `X-BrainPro-Signature: sha256=<hex>`（＋ X-BrainPro-Event / X-BrainPro-Delivery）を付ける。
   * - 非2xx / 通信失敗は throw して runJob の自動リトライ（QStash retries / inline）に委ねる。
   *
   * 送信 payload は秘匿情報を含めず、{event, deliveryId, occurredAt, projectId, task:{...}} とする。
   * 返り値は試行記録/結果に残る status/ms 等の軽い情報のみ（秘匿値は含めない）。
   */
  private async deliverWebhook(
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const webhookId = this.requireString(payload.webhookId, 'payload.webhookId');
    const event = this.requireString(payload.event, 'payload.event');

    const webhook = await this.prisma.webhook.findUnique({
      where: { id: webhookId },
    });
    if (!webhook || !webhook.active) {
      // 起票後に削除/無効化された Webhook は配信不要。成功扱いで終端する。
      return { kind: 'WEBHOOK_DELIVERY', skipped: true, webhookId };
    }

    // 配信ごとの一意ID（受信側の冪等化/重複検出に使える）。
    const deliveryId = randomUUID();
    const occurredAt =
      typeof payload.occurredAt === 'string'
        ? payload.occurredAt
        : new Date().toISOString();

    const body = JSON.stringify({
      event,
      deliveryId,
      occurredAt,
      projectId: webhook.projectId,
      task: trimTaskForOutbound(payload.task),
    });

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'brain-pro-webhook/1',
      'x-brainpro-event': event,
      'x-brainpro-delivery': deliveryId,
    };

    // 署名（secret 設定時のみ）。受信側はこの署名で正規配信を検証できる。
    if (webhook.secretEnc) {
      try {
        const secret = this.crypto.decrypt(webhook.secretEnc);
        const sig = createHmac('sha256', secret).update(body).digest('hex');
        headers['x-brainpro-signature'] = `sha256=${sig}`;
      } catch (e) {
        // 復号失敗（鍵不一致等）。署名なしでは送らず、リトライ余地を残して失敗させる。
        throw new Error(
          `Webhook シークレットの復号に失敗しました（webhookId=${webhookId}）: ${(e as Error)?.message ?? String(e)}`,
        );
      }
    }

    // SSRF 対策: 配信直前に宛先 URL を再検証する（DNS 解決後の宛先 IP が
    // private/loopback/link-local/メタデータでないこと）。実配信直前に引くことで
    // 設定保存時点との差（DNS リバインディング/TOCTOU）も緩和する。
    await assertSafeOutboundUrl(webhook.targetUrl);

    // タイムアウト付きで POST（受信側の遅延でジョブを長時間ブロックしない）。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const startedAt = Date.now();
    let status: number;
    try {
      const res = await fetch(webhook.targetUrl, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        // SSRF 対策: 302 等で内部アドレスへ誘導されるのを防ぐためリダイレクトを追従しない。
        redirect: 'manual',
      });
      status = res.status;
      if (!res.ok) {
        // 非2xx は失敗。本文の先頭だけ拾って原因の手掛かりを残す（秘匿値は含めない）。
        const text = await res.text().catch(() => '');
        throw new Error(
          `Webhook 配信が非2xxで失敗しました (status=${status}): ${text.slice(0, 500)}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }

    return {
      kind: 'WEBHOOK_DELIVERY',
      webhookId,
      event,
      deliveryId,
      status,
      ms: Date.now() - startedAt,
      url: webhook.targetUrl,
    };
  }

  /** 鍵を解決（無ければ分かりやすい error を throw → runJob で FAILED に記録）。 */
  private async resolveKey(
    projectId: string,
    userId: string | null,
  ): Promise<string> {
    const apiKey = await this.companyKey.resolveForProject(
      projectId,
      userId ?? undefined,
    );
    if (!apiKey) {
      throw new Error(
        'Anthropic APIキーが未設定です（会社設定・個人設定・環境変数のいずれにも見つかりません）',
      );
    }
    return apiKey;
  }

  private requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${name} が必要です`);
    }
    return value;
  }

  /**
   * 実行中ジョブの進捗(0–100)を更新する（長時間ジョブの可視化用）。
   * 失敗は握りつぶす（進捗更新の失敗で本体を止めない）。
   */
  private async updateProgress(id: string, progress: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    try {
      await this.prisma.backgroundJob.update({
        where: { id },
        data: { progress: clamped },
      });
    } catch (e) {
      this.logger.warn(
        `Failed to update progress for job ${id}: ${(e as Error)?.message ?? String(e)}`,
      );
    }
  }
}

/**
 * 外部送信用にタスクスナップショットを安全なフィールドだけに絞る。
 * 秘匿情報は含めない方針なので、業務上必要な公開可能フィールドのみを通す。
 */
function trimTaskForOutbound(task: unknown): Record<string, unknown> | null {
  if (!task || typeof task !== 'object') return null;
  const t = task as Record<string, unknown>;
  const ALLOWED = [
    'id',
    'projectId',
    'parentId',
    'title',
    'description',
    'status',
    'priority',
    'assigneeName',
    'assigneeRoleId',
    'startDate',
    'dueDate',
    'estimatedHours',
    'actualHours',
    'category',
    'milestone',
    'progress',
    'createdAt',
    'updatedAt',
  ] as const;
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    if (key in t) out[key] = t[key];
  }
  return out;
}
