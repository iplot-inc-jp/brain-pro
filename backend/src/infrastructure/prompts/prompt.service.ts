import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import {
  defaultModelFor,
  getPromptDefinition,
  PROMPT_ALLOWED_MODELS,
  PROMPT_DEFINITIONS,
  PROMPT_MAX_LENGTH,
  PromptDefinition,
} from './prompt-registry';

export interface UpdatePromptInput {
  model: string;
  systemPrompt: string;
}

/** ClaudeService などの実行側へ渡す解決済みプロンプト。 */
export interface ResolvedPrompt {
  model: string;
  systemPrompt: string;
  /** DBのアクティブ版を使ったときの版ID（既定値フォールバック時は null） */
  promptVersionId: string | null;
}

/**
 * システム全体のAIプロンプトをプロジェクト×機能キーで版管理するサービス。
 * 既定値はプロンプトレジストリ（prompt-registry.ts）が持ち、変更は上書きせず
 * 新しい版として prompt_versions（テーブル名は rag_prompt_versions）に積む。
 */
@Injectable()
export class PromptService {
  constructor(private readonly prisma: PrismaService) {}

  /** 実行側の共通入口。projectId 不明の呼び出しではDBに触れず既定値を返す。 */
  async resolve(
    key: string,
    projectId?: string | null,
    createdById?: string | null,
  ): Promise<ResolvedPrompt> {
    const def = this.definition(key);
    if (!projectId) {
      return {
        model: defaultModelFor(def),
        systemPrompt: def.defaultSystemPrompt,
        promptVersionId: null,
      };
    }
    const active = await this.getActive(projectId, key, createdById);
    return {
      model: active.model,
      systemPrompt: active.systemPrompt,
      promptVersionId: active.id,
    };
  }

  async getActive(
    projectId: string,
    key: string,
    createdById?: string | null,
  ): Promise<any> {
    const def = this.definition(key);
    const current = await this.prisma.promptVersion.findFirst({
      where: { projectId, key, isActive: true },
    });
    if (current) return current;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const concurrent = await tx.promptVersion.findFirst({
          where: { projectId, key, isActive: true },
        });
        if (concurrent) return concurrent;
        const latest = await tx.promptVersion.findFirst({
          where: { projectId, key },
          orderBy: { version: 'desc' },
        });
        return tx.promptVersion.create({
          data: {
            projectId,
            key,
            version: (latest?.version ?? 0) + 1,
            model: defaultModelFor(def),
            systemPrompt: def.defaultSystemPrompt,
            isActive: true,
            createdById: createdById ?? null,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const concurrent = await this.prisma.promptVersion.findFirst({
          where: { projectId, key, isActive: true },
        });
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  /** 全プロンプト定義と、その有効設定（未作成なら既定値）のサマリを返す。 */
  async list(projectId: string) {
    const actives = await this.prisma.promptVersion.findMany({
      where: { projectId, isActive: true },
    });
    const activeByKey = new Map(actives.map((row: any) => [row.key, row]));
    return {
      prompts: PROMPT_DEFINITIONS.map((def) => {
        const active: any = activeByKey.get(def.key);
        return {
          key: def.key,
          label: def.label,
          description: def.description,
          category: def.category,
          variables: def.variables ?? [],
          model: active?.model ?? defaultModelFor(def),
          version: active?.version ?? null,
          updatedAt: active?.createdAt ?? null,
          customized: active
            ? active.model !== defaultModelFor(def) ||
              active.systemPrompt !== def.defaultSystemPrompt
            : false,
        };
      }),
      allowedModels: [...PROMPT_ALLOWED_MODELS],
    };
  }

  async getSettings(
    projectId: string,
    key: string,
    createdById?: string | null,
  ) {
    const def = this.definition(key);
    const ensuredActive = await this.getActive(projectId, key, createdById);
    const history = await this.prisma.promptVersion.findMany({
      where: { projectId, key },
      orderBy: { version: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    return {
      definition: {
        key: def.key,
        label: def.label,
        description: def.description,
        category: def.category,
        variables: def.variables ?? [],
      },
      active: history.find((row) => row.isActive) ?? ensuredActive,
      history,
      defaults: {
        model: defaultModelFor(def),
        systemPrompt: def.defaultSystemPrompt,
      },
      allowedModels: [...PROMPT_ALLOWED_MODELS],
      maxLength: PROMPT_MAX_LENGTH,
    };
  }

  async update(
    projectId: string,
    key: string,
    input: UpdatePromptInput,
    createdById?: string | null,
  ): Promise<any> {
    const def = this.definition(key);
    const data = this.validate(def, input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const latest = await tx.promptVersion.findFirst({
          where: { projectId, key },
          orderBy: { version: 'desc' },
        });
        await tx.promptVersion.updateMany({
          where: { projectId, key, isActive: true },
          data: { isActive: false },
        });
        return tx.promptVersion.create({
          data: {
            projectId,
            key,
            version: (latest?.version ?? 0) + 1,
            model: data.model,
            systemPrompt: data.systemPrompt,
            isActive: true,
            createdById: createdById ?? null,
          },
        });
      });
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new ConflictException(
          'プロンプト設定が同時に更新されました。最新の設定を読み直してください',
        );
      }
      throw error;
    }
  }

  reset(
    projectId: string,
    key: string,
    createdById?: string | null,
  ): Promise<any> {
    const def = this.definition(key);
    return this.update(
      projectId,
      key,
      { model: defaultModelFor(def), systemPrompt: def.defaultSystemPrompt },
      createdById,
    );
  }

  private definition(key: string): PromptDefinition {
    const def = getPromptDefinition(key);
    if (!def) {
      throw new NotFoundException(`未知のプロンプトキーです: ${key}`);
    }
    return def;
  }

  private validate(
    def: PromptDefinition,
    input: UpdatePromptInput,
  ): UpdatePromptInput {
    // 環境変数で既定モデルを差し替えている運用（許可リスト外）でも保存できるようにする
    const allowed =
      (PROMPT_ALLOWED_MODELS as readonly string[]).includes(input.model) ||
      input.model === defaultModelFor(def);
    if (!allowed) {
      throw new BadRequestException(`許可されていないモデルです: ${input.model}`);
    }
    const systemPrompt = input.systemPrompt?.trim();
    if (!systemPrompt) {
      throw new BadRequestException('システムプロンプトを空にはできません');
    }
    if (systemPrompt.length > PROMPT_MAX_LENGTH) {
      throw new BadRequestException(
        `システムプロンプトは${PROMPT_MAX_LENGTH}文字以内にしてください`,
      );
    }
    return { model: input.model, systemPrompt };
  }

  private isUniqueConflict(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
  }
}
