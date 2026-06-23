# GAP選択式化 ＋ 業務定義シート①/個別定義シート③ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GAP追加を業務フロー/ノードの選択式にし、業務フロー単位の業務定義を専用 `FlowDefinition` モデルで管理して「業務定義シート①(全フロー一覧)」と「個別定義シート③(1フロー詳細)」を編集できるようにする。

**Architecture:** バックエンドはクリーンアーキ（既存 `flow-folder.*` スライスをミラー）で `FlowDefinition`(BusinessFlowと1:1) を追加。GAPは既存FK(`asisFlowId/tobeFlowId/asisNodeId/tobeNodeId/businessArea`)を使うのみ（スキーマ変更なし）。フロントは ① 専用ページ + ③ フローエディタ内タブ + GAPフォームの選択式UI。

**Tech Stack:** NestJS + Prisma 5.x(postgres :5460), Next.js 14 app router, React 18, raw fetch + localStorage 'accessToken', vitest(pure functionsのみ), Tailwind(白/navy #050f3e/blue #2563eb)。

**Testing reality (重要):** このリポジトリにはバックエンドのユニットテスト基盤が無い。検証ゲートは **(1) `tsc --noEmit` 0エラー, (2) 純粋関数の `vitest`, (3) ライブ `curl` スモーク**。プランはこの方針に従う（純粋関数のみTDD）。Prisma/tsc コマンドはリポジトリルートの `node_modules/.bin`（`../node_modules/.bin/prisma`, `../node_modules/.bin/tsc`, `../node_modules/.bin/vitest`）を使う（npx は不可）。

**Conventions:** backend クリーンアーキの参照スライス = `backend/src/**/flow-folder.*`(entity/repo/usecase/controller) と `sub-project.*`。frontend は `'use client'`, `API_URL=process.env.NEXT_PUBLIC_API_URL||'http://localhost:5021'`, token=localStorage 'accessToken', 共有 `@/components/ui` + `PageHeader`/`HelpTooltip`/`HowToPanel`, lucide。

**スモーク用ログイン:** `POST /api/auth/login {"email":"demo@iplot.local","password":"password123"}` → `accessToken`。デモ project = `b8310746-320e-449c-96db-169f5a1017ee`。

---

## File Structure

**Backend (新規 — flow-folder.* をミラー):**
- `backend/prisma/schema.prisma` — `FlowDefinition` model 追加 + `BusinessFlow.definition` back-relation。
- `backend/src/domain/entities/flow-definition.entity.ts` — エンティティ。
- `backend/src/domain/repositories/flow-definition.repository.ts` — interface + `FLOW_DEFINITION_REPOSITORY` Symbol。
- `backend/src/infrastructure/persistence/repositories/flow-definition.repository.impl.ts` — Prisma impl。
- `backend/src/application/use-cases/flow-definition/{get-flow-definition,upsert-flow-definition,list-flow-definitions}.use-case.ts` + `index.ts` + `flow-definition.output.ts`。
- `backend/src/presentation/controllers/flow-definition.controller.ts` — 3エンドポイント。
- 各 barrel `index.ts`（entities/repositories/repositories(infra)/use-cases/controllers）に追記。
- `backend/src/app.module.ts` — provider + controller 配線。

**Frontend (新規/編集):**
- `frontend/src/lib/flow-definition.ts` — 型 + APIクライアント + 純粋ヘルパー。
- `frontend/src/lib/flow-definition.test.ts` — 純粋ヘルパーの vitest。
- `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/business-definition/page.tsx` — ① 一覧（新規）。
- `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/flows/[flowId]/page.tsx` — ③「個別定義」タブに置換（既存編集）。
- `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/gap-items/page.tsx` — GAPフォームを選択式に（既存編集）。
- `frontend/src/app/(dashboard)/layout.tsx` — 現状把握グループに「業務定義シート」追加（既存編集）。

---

## Task 1: スキーマに FlowDefinition を追加

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: `FlowDefinition` モデルと back-relation を追加**

`backend/prisma/schema.prisma` の末尾付近（他の model 群と並ぶ位置）に追記:

```prisma
model FlowDefinition {
  id                String   @id @default(uuid())
  flowId            String   @unique @map("flow_id")
  purpose           String?  @db.Text
  owner             String?
  stakeholders      String?  @db.Text
  input             String?  @db.Text
  inputDetail       String?  @db.Text @map("input_detail")
  trigger           String?  @db.Text
  doSteps           Json     @default("[]") @map("do_steps")
  output            String?  @db.Text
  nextProcess       String?  @db.Text @map("next_process")
  exceptionHandling String?  @db.Text @map("exception_handling")
  frequency         String?
  system            String?
  tacitNotes        String?  @db.Text @map("tacit_notes")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  flow BusinessFlow @relation(fields: [flowId], references: [id], onDelete: Cascade)

  @@map("flow_definitions")
}
```

`model BusinessFlow { ... }` のリレーション群に1行追加:

```prisma
  definition          FlowDefinition?
```

- [ ] **Step 2: validate / generate / db push**

Run（`backend/` から）:
```bash
../node_modules/.bin/prisma validate
../node_modules/.bin/prisma generate
../node_modules/.bin/prisma db push --skip-generate
```
Expected: 「valid」「Generated Prisma Client」「Your database is now in sync」。

- [ ] **Step 3: Commit**

```bash
cd /Users/kazuyukijimbo/brain-pro
git add backend/prisma/schema.prisma
git commit -m "feat(schema): add FlowDefinition model (1:1 BusinessFlow)"
```

---

## Task 2: FlowDefinition ドメインエンティティ + リポジトリ interface

**Files:**
- Create: `backend/src/domain/entities/flow-definition.entity.ts`
- Create: `backend/src/domain/repositories/flow-definition.repository.ts`
- Modify: `backend/src/domain/entities/index.ts`, `backend/src/domain/repositories/index.ts`

- [ ] **Step 1: エンティティを作成**（`flow-folder.entity.ts` をミラー。全列は任意で文字列、`doSteps` は `string[]`）

`backend/src/domain/entities/flow-definition.entity.ts`:

```typescript
import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export interface FlowDefinitionFields {
  purpose: string | null;
  owner: string | null;
  stakeholders: string | null;
  input: string | null;
  inputDetail: string | null;
  trigger: string | null;
  doSteps: string[];
  output: string | null;
  nextProcess: string | null;
  exceptionHandling: string | null;
  frequency: string | null;
  system: string | null;
  tacitNotes: string | null;
}

export interface CreateFlowDefinitionProps extends Partial<FlowDefinitionFields> {
  flowId: string;
}

export interface ReconstructFlowDefinitionProps extends FlowDefinitionFields {
  id: string;
  flowId: string;
  createdAt: Date;
  updatedAt: Date;
}

const STR_KEYS: (keyof FlowDefinitionFields)[] = [
  'purpose', 'owner', 'stakeholders', 'input', 'inputDetail', 'trigger',
  'output', 'nextProcess', 'exceptionHandling', 'frequency', 'system', 'tacitNotes',
];

/** 業務フローの業務定義（①一覧/③個別定義で共有する1フロー分の定義） */
export class FlowDefinition extends BaseEntity {
  private readonly _flowId: string;
  private _fields: FlowDefinitionFields;

  private constructor(
    id: string,
    flowId: string,
    fields: FlowDefinitionFields,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._flowId = flowId;
    this._fields = fields;
  }

  private static normalize(props: Partial<FlowDefinitionFields>): FlowDefinitionFields {
    const f: FlowDefinitionFields = {
      purpose: null, owner: null, stakeholders: null, input: null, inputDetail: null,
      trigger: null, doSteps: [], output: null, nextProcess: null,
      exceptionHandling: null, frequency: null, system: null, tacitNotes: null,
    };
    for (const k of STR_KEYS) {
      const v = (props as Record<string, unknown>)[k];
      f[k] = typeof v === 'string' ? v : v == null ? null : String(v);
    }
    if (Array.isArray(props.doSteps)) {
      f.doSteps = props.doSteps.map((s) => String(s));
    }
    return f;
  }

  static create(props: CreateFlowDefinitionProps, id: string): FlowDefinition {
    if (!props.flowId) throw new ValidationError('Flow ID is required');
    const now = new Date();
    return new FlowDefinition(id, props.flowId, FlowDefinition.normalize(props), now, now);
  }

  static reconstruct(props: ReconstructFlowDefinitionProps): FlowDefinition {
    return new FlowDefinition(
      props.id, props.flowId, FlowDefinition.normalize(props), props.createdAt, props.updatedAt,
    );
  }

  /** 部分更新（渡されたキーのみ上書き） */
  update(patch: Partial<FlowDefinitionFields>): void {
    for (const k of STR_KEYS) {
      if (k in patch) {
        const v = (patch as Record<string, unknown>)[k];
        this._fields[k] = typeof v === 'string' ? v : v == null ? null : String(v);
      }
    }
    if ('doSteps' in patch && Array.isArray(patch.doSteps)) {
      this._fields.doSteps = patch.doSteps.map((s) => String(s));
    }
    this.touch();
  }

  get flowId(): string { return this._flowId; }
  get fields(): FlowDefinitionFields { return { ...this._fields, doSteps: [...this._fields.doSteps] }; }
}
```

> 注: `BaseEntity` が `touch()` を持つことを `flow-folder.entity.ts` で確認済み。`ValidationError` は `../errors` から（flow-folder と同様）。

- [ ] **Step 2: リポジトリ interface を作成**

`backend/src/domain/repositories/flow-definition.repository.ts`:

```typescript
import { FlowDefinition } from '../entities/flow-definition.entity';

export const FLOW_DEFINITION_REPOSITORY = Symbol('FLOW_DEFINITION_REPOSITORY');

/** プロジェクト一覧用に、フロー基本情報と定義を結合した行 */
export interface FlowWithDefinition {
  flowId: string;
  flowName: string;
  kind: string;
  definition: FlowDefinition | null;
}

export interface IFlowDefinitionRepository {
  findByFlowId(flowId: string): Promise<FlowDefinition | null>;
  findByProjectId(projectId: string): Promise<FlowWithDefinition[]>;
  save(def: FlowDefinition): Promise<void>;
  generateId(): string;
}
```

- [ ] **Step 3: barrel 追記**

`backend/src/domain/entities/index.ts` に `export * from './flow-definition.entity';`、
`backend/src/domain/repositories/index.ts` に `export * from './flow-definition.repository';` を追加（既存の並びに合わせる）。

- [ ] **Step 4: tsc 確認**

Run（`backend/`）: `../node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: 0 errors。

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain
git commit -m "feat(flow-definition): domain entity + repository interface"
```

---

## Task 3: Prisma リポジトリ実装

**Files:**
- Create: `backend/src/infrastructure/persistence/repositories/flow-definition.repository.impl.ts`
- Modify: `backend/src/infrastructure/persistence/repositories/index.ts`

- [ ] **Step 1: 実装を作成**（reconstruct-on-read / upsert-on-save / randomUUID。`flow-folder.repository.impl.ts` をミラー）

`backend/src/infrastructure/persistence/repositories/flow-definition.repository.impl.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import {
  IFlowDefinitionRepository,
  FlowWithDefinition,
} from '../../../domain/repositories/flow-definition.repository';
import { FlowDefinition } from '../../../domain/entities/flow-definition.entity';

@Injectable()
export class FlowDefinitionRepositoryImpl implements IFlowDefinitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toEntity(r: {
    id: string; flowId: string; purpose: string | null; owner: string | null;
    stakeholders: string | null; input: string | null; inputDetail: string | null;
    trigger: string | null; doSteps: unknown; output: string | null; nextProcess: string | null;
    exceptionHandling: string | null; frequency: string | null; system: string | null;
    tacitNotes: string | null; createdAt: Date; updatedAt: Date;
  }): FlowDefinition {
    return FlowDefinition.reconstruct({
      id: r.id, flowId: r.flowId,
      purpose: r.purpose, owner: r.owner, stakeholders: r.stakeholders,
      input: r.input, inputDetail: r.inputDetail, trigger: r.trigger,
      doSteps: Array.isArray(r.doSteps) ? (r.doSteps as unknown[]).map(String) : [],
      output: r.output, nextProcess: r.nextProcess, exceptionHandling: r.exceptionHandling,
      frequency: r.frequency, system: r.system, tacitNotes: r.tacitNotes,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    });
  }

  async findByFlowId(flowId: string): Promise<FlowDefinition | null> {
    const r = await this.prisma.flowDefinition.findUnique({ where: { flowId } });
    return r ? this.toEntity(r) : null;
  }

  async findByProjectId(projectId: string): Promise<FlowWithDefinition[]> {
    const flows = await this.prisma.businessFlow.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }],
      include: { definition: true },
    });
    return flows.map((f) => ({
      flowId: f.id,
      flowName: f.name,
      kind: f.kind,
      definition: f.definition ? this.toEntity(f.definition) : null,
    }));
  }

  async save(def: FlowDefinition): Promise<void> {
    const f = def.fields;
    const data = {
      purpose: f.purpose, owner: f.owner, stakeholders: f.stakeholders,
      input: f.input, inputDetail: f.inputDetail, trigger: f.trigger,
      doSteps: f.doSteps as unknown as object, output: f.output, nextProcess: f.nextProcess,
      exceptionHandling: f.exceptionHandling, frequency: f.frequency, system: f.system,
      tacitNotes: f.tacitNotes,
    };
    await this.prisma.flowDefinition.upsert({
      where: { flowId: def.flowId },
      create: { id: def.id, flowId: def.flowId, ...data },
      update: data,
    });
  }

  generateId(): string {
    return randomUUID();
  }
}
```

> 注: `prisma.service` のパスは `flow-folder.repository.impl.ts` の import を確認して合わせる（`'../prisma.service'`）。

- [ ] **Step 2: barrel 追記**

`backend/src/infrastructure/persistence/repositories/index.ts` に `export * from './flow-definition.repository.impl';` を追加。

- [ ] **Step 3: tsc 確認**

Run（`backend/`）: `../node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0 errors。

- [ ] **Step 4: Commit**

```bash
git add backend/src/infrastructure
git commit -m "feat(flow-definition): prisma repository impl"
```

---

## Task 4: ユースケース（get / upsert / list-by-project）

**Files:**
- Create: `backend/src/application/use-cases/flow-definition/flow-definition.output.ts`
- Create: `backend/src/application/use-cases/flow-definition/get-flow-definition.use-case.ts`
- Create: `backend/src/application/use-cases/flow-definition/upsert-flow-definition.use-case.ts`
- Create: `backend/src/application/use-cases/flow-definition/list-flow-definitions.use-case.ts`
- Create: `backend/src/application/use-cases/flow-definition/index.ts`
- Modify: `backend/src/application/use-cases/index.ts`

認可は **flow → project → 組織メンバー（`organizationRepository.isMember` は全体管理者バイパス済み）**。`business-flow` のユースケースが flow からどう project を辿るか（`BUSINESS_FLOW_REPOSITORY` で flow を取り `flow.projectId`）を確認して同様に。

- [ ] **Step 1: 出力DTO**

`flow-definition.output.ts`:

```typescript
import { FlowDefinition } from '../../../domain/entities/flow-definition.entity';

export interface FlowDefinitionOutput {
  flowId: string;
  purpose: string | null;
  owner: string | null;
  stakeholders: string | null;
  input: string | null;
  inputDetail: string | null;
  trigger: string | null;
  doSteps: string[];
  output: string | null;
  nextProcess: string | null;
  exceptionHandling: string | null;
  frequency: string | null;
  system: string | null;
  tacitNotes: string | null;
}

export function toFlowDefinitionOutput(flowId: string, def: FlowDefinition | null): FlowDefinitionOutput {
  const f = def?.fields;
  return {
    flowId,
    purpose: f?.purpose ?? null, owner: f?.owner ?? null, stakeholders: f?.stakeholders ?? null,
    input: f?.input ?? null, inputDetail: f?.inputDetail ?? null, trigger: f?.trigger ?? null,
    doSteps: f?.doSteps ?? [], output: f?.output ?? null, nextProcess: f?.nextProcess ?? null,
    exceptionHandling: f?.exceptionHandling ?? null, frequency: f?.frequency ?? null,
    system: f?.system ?? null, tacitNotes: f?.tacitNotes ?? null,
  };
}
```

- [ ] **Step 2: get ユースケース**

`get-flow-definition.use-case.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  FLOW_DEFINITION_REPOSITORY, IFlowDefinitionRepository,
  BUSINESS_FLOW_REPOSITORY, IBusinessFlowRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ForbiddenError,
} from '../../../domain';
import { FlowDefinitionOutput, toFlowDefinitionOutput } from './flow-definition.output';

export interface GetFlowDefinitionInput { userId: string; flowId: string; }

@Injectable()
export class GetFlowDefinitionUseCase {
  constructor(
    @Inject(FLOW_DEFINITION_REPOSITORY) private readonly repo: IFlowDefinitionRepository,
    @Inject(BUSINESS_FLOW_REPOSITORY) private readonly flowRepo: IBusinessFlowRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: GetFlowDefinitionInput): Promise<FlowDefinitionOutput> {
    const flow = await this.flowRepo.findById(input.flowId);
    if (!flow) throw new EntityNotFoundError('BusinessFlow', input.flowId);
    const project = await this.projectRepo.findById(flow.projectId);
    if (!project) throw new EntityNotFoundError('Project', flow.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, input.userId))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    const def = await this.repo.findByFlowId(input.flowId);
    return toFlowDefinitionOutput(input.flowId, def);
  }
}
```

> 注: `IBusinessFlowRepository` / `BUSINESS_FLOW_REPOSITORY` の正確なエクスポート名と `flow.projectId` の取得方法は `backend/src/domain` の barrel と既存 business-flow ユースケースで確認して合わせる。`EntityNotFoundError`/`ForbiddenError` は domain barrel から。

- [ ] **Step 3: upsert ユースケース**

`upsert-flow-definition.use-case.ts`（同じ認可。`patch` を受けて get→update→save、無ければ create→save）:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  FLOW_DEFINITION_REPOSITORY, IFlowDefinitionRepository,
  BUSINESS_FLOW_REPOSITORY, IBusinessFlowRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ForbiddenError,
} from '../../../domain';
import { FlowDefinition } from '../../../domain/entities/flow-definition.entity';
import { FlowDefinitionFields } from '../../../domain/entities/flow-definition.entity';
import { FlowDefinitionOutput, toFlowDefinitionOutput } from './flow-definition.output';

export interface UpsertFlowDefinitionInput {
  userId: string;
  flowId: string;
  patch: Partial<FlowDefinitionFields>;
}

@Injectable()
export class UpsertFlowDefinitionUseCase {
  constructor(
    @Inject(FLOW_DEFINITION_REPOSITORY) private readonly repo: IFlowDefinitionRepository,
    @Inject(BUSINESS_FLOW_REPOSITORY) private readonly flowRepo: IBusinessFlowRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: UpsertFlowDefinitionInput): Promise<FlowDefinitionOutput> {
    const flow = await this.flowRepo.findById(input.flowId);
    if (!flow) throw new EntityNotFoundError('BusinessFlow', input.flowId);
    const project = await this.projectRepo.findById(flow.projectId);
    if (!project) throw new EntityNotFoundError('Project', flow.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, input.userId))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    let def = await this.repo.findByFlowId(input.flowId);
    if (!def) {
      def = FlowDefinition.create({ flowId: input.flowId, ...input.patch }, this.repo.generateId());
    } else {
      def.update(input.patch);
    }
    await this.repo.save(def);
    return toFlowDefinitionOutput(input.flowId, def);
  }
}
```

- [ ] **Step 4: list-by-project ユースケース**

`list-flow-definitions.use-case.ts`（project→member 認可。`repo.findByProjectId` を返す）:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  FLOW_DEFINITION_REPOSITORY, IFlowDefinitionRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ForbiddenError,
} from '../../../domain';
import { toFlowDefinitionOutput } from './flow-definition.output';

export interface ListFlowDefinitionsInput { userId: string; projectId: string; }
export interface FlowDefinitionRow {
  flowId: string; flowName: string; kind: string;
  definition: ReturnType<typeof toFlowDefinitionOutput>;
}

@Injectable()
export class ListFlowDefinitionsUseCase {
  constructor(
    @Inject(FLOW_DEFINITION_REPOSITORY) private readonly repo: IFlowDefinitionRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: ListFlowDefinitionsInput): Promise<FlowDefinitionRow[]> {
    const project = await this.projectRepo.findById(input.projectId);
    if (!project) throw new EntityNotFoundError('Project', input.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, input.userId))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    const rows = await this.repo.findByProjectId(input.projectId);
    return rows.map((r) => ({
      flowId: r.flowId, flowName: r.flowName, kind: r.kind,
      definition: toFlowDefinitionOutput(r.flowId, r.definition),
    }));
  }
}
```

- [ ] **Step 5: barrel**

`flow-definition/index.ts`:
```typescript
export * from './flow-definition.output';
export * from './get-flow-definition.use-case';
export * from './upsert-flow-definition.use-case';
export * from './list-flow-definitions.use-case';
```
`backend/src/application/use-cases/index.ts` に `export * from './flow-definition';` を追加。

- [ ] **Step 6: tsc 確認**

Run（`backend/`）: `../node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0 errors（domain barrel のエクスポート名が合っているか確認。違えば import を修正）。

- [ ] **Step 7: Commit**

```bash
git add backend/src/application
git commit -m "feat(flow-definition): get/upsert/list use-cases"
```

---

## Task 5: コントローラ + app.module 配線

**Files:**
- Create: `backend/src/presentation/controllers/flow-definition.controller.ts`
- Modify: `backend/src/presentation/controllers/index.ts`, `backend/src/app.module.ts`

- [ ] **Step 1: コントローラ**（`business-flow.controller.ts` の `@CurrentUser` / DTO / ApiTags パターンに合わせる）

`backend/src/presentation/controllers/flow-definition.controller.ts`:

```typescript
import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import {
  GetFlowDefinitionUseCase,
  UpsertFlowDefinitionUseCase,
  ListFlowDefinitionsUseCase,
} from '../../application';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';

class UpsertFlowDefinitionDto {
  @IsOptional() @IsString() purpose?: string;
  @IsOptional() @IsString() owner?: string;
  @IsOptional() @IsString() stakeholders?: string;
  @IsOptional() @IsString() input?: string;
  @IsOptional() @IsString() inputDetail?: string;
  @IsOptional() @IsString() trigger?: string;
  @IsOptional() @IsArray() doSteps?: string[];
  @IsOptional() @IsString() output?: string;
  @IsOptional() @IsString() nextProcess?: string;
  @IsOptional() @IsString() exceptionHandling?: string;
  @IsOptional() @IsString() frequency?: string;
  @IsOptional() @IsString() system?: string;
  @IsOptional() @IsString() tacitNotes?: string;
}

@ApiTags('業務定義')
@ApiBearerAuth()
@Controller()
export class FlowDefinitionController {
  constructor(
    private readonly getUseCase: GetFlowDefinitionUseCase,
    private readonly upsertUseCase: UpsertFlowDefinitionUseCase,
    private readonly listUseCase: ListFlowDefinitionsUseCase,
  ) {}

  @Get('projects/:projectId/flow-definitions')
  @ApiOperation({ summary: '業務定義シート①（全フロー一覧）' })
  async list(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.listUseCase.execute({ userId: user.id, projectId });
  }

  @Get('business-flows/:flowId/definition')
  @ApiOperation({ summary: '個別定義シート③（1フロー取得）' })
  async get(@CurrentUser() user: CurrentUserPayload, @Param('flowId') flowId: string) {
    return this.getUseCase.execute({ userId: user.id, flowId });
  }

  @Put('business-flows/:flowId/definition')
  @ApiOperation({ summary: '個別定義シート③（1フロー upsert）' })
  async upsert(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() dto: UpsertFlowDefinitionDto,
  ) {
    return this.upsertUseCase.execute({ userId: user.id, flowId, patch: dto });
  }
}
```

> 注: 既存 business-flow controller のルートと衝突しないこと（`business-flows/:flowId/definition` は静的 `definition` セグメントなので `:nodeId` 等と衝突しない。ただし `business-flows/:id` の GET catch-all より**前**に評価される必要がある場合は、コントローラ登録順/ルート順を確認）。

- [ ] **Step 2: barrel + app.module**

`backend/src/presentation/controllers/index.ts` に `export * from './flow-definition.controller';`。
`backend/src/app.module.ts`:
- import: `FlowDefinitionController`、`GetFlowDefinitionUseCase, UpsertFlowDefinitionUseCase, ListFlowDefinitionsUseCase`、`FLOW_DEFINITION_REPOSITORY`, `FlowDefinitionRepositoryImpl`。
- `controllers: [...]` に `FlowDefinitionController` 追加。
- `providers: [...]` に 3つの use-case と `{ provide: FLOW_DEFINITION_REPOSITORY, useClass: FlowDefinitionRepositoryImpl }` を追加（flow-folder の登録の並びに合わせる）。

- [ ] **Step 3: tsc 確認**

Run（`backend/`）: `../node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0 errors。

- [ ] **Step 4: ライブスモーク**（nest watch がリロードしていることを確認。していなければ `npm run start:dev` を再起動）

```bash
API=http://localhost:5021
TOK=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"email":"demo@iplot.local","password":"password123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
PID=b8310746-320e-449c-96db-169f5a1017ee
FLOW=$(curl -s "$API/api/business-flows/project/$PID/all" -H "Authorization: Bearer $TOK" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')
curl -s -o /dev/null -w "PUT def %{http_code}\n" -X PUT "$API/api/business-flows/$FLOW/definition" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d '{"purpose":"受注を処理する","owner":"営業","doSteps":["受注票を受領","在庫を確認","発注書を作成"]}'
curl -s "$API/api/business-flows/$FLOW/definition" -H "Authorization: Bearer $TOK"
curl -s -o /dev/null -w "list %{http_code}\n" "$API/api/projects/$PID/flow-definitions" -H "Authorization: Bearer $TOK"
```
Expected: `PUT def 200`、GET で purpose/owner/doSteps が往復、`list 200`。

- [ ] **Step 5: Commit**

```bash
git add backend/src/presentation backend/src/app.module.ts
git commit -m "feat(flow-definition): controller (get/upsert/list) + wiring"
```

---

## Task 6: フロント flow-definition ライブラリ（型 + API + 純粋ヘルパー）+ テスト

**Files:**
- Create: `frontend/src/lib/flow-definition.ts`
- Create: `frontend/src/lib/flow-definition.test.ts`

- [ ] **Step 1: 失敗するテストを書く**（純粋ヘルパー `summarizeDoSteps` と `definitionToRow`）

`frontend/src/lib/flow-definition.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { summarizeDoSteps, definitionToRow, EMPTY_DEFINITION } from './flow-definition';

describe('summarizeDoSteps', () => {
  it('空配列は空文字', () => {
    expect(summarizeDoSteps([])).toBe('');
  });
  it('1件はその文を返す', () => {
    expect(summarizeDoSteps(['受注票を受領'])).toBe('受注票を受領');
  });
  it('複数件は先頭＋件数', () => {
    expect(summarizeDoSteps(['a', 'b', 'c'])).toBe('a ほか2件 (全3手順)');
  });
});

describe('definitionToRow', () => {
  it('① 一覧の列を抽出する', () => {
    const row = definitionToRow({
      ...EMPTY_DEFINITION,
      flowId: 'f1',
      purpose: '受注処理', owner: '営業', input: '受注票',
      doSteps: ['x', 'y'], output: '発注書', frequency: '毎日', system: 'ERP',
    });
    expect(row).toEqual({
      purpose: '受注処理', owner: '営業', input: '受注票',
      doSummary: 'x ほか1件 (全2手順)', output: '発注書', frequency: '毎日', system: 'ERP',
    });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run（`frontend/`）: `../node_modules/.bin/vitest run src/lib/flow-definition.test.ts`
Expected: FAIL（モジュール未定義）。

- [ ] **Step 3: 実装**

`frontend/src/lib/flow-definition.ts`:

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export interface FlowDefinition {
  flowId: string;
  purpose: string | null;
  owner: string | null;
  stakeholders: string | null;
  input: string | null;
  inputDetail: string | null;
  trigger: string | null;
  doSteps: string[];
  output: string | null;
  nextProcess: string | null;
  exceptionHandling: string | null;
  frequency: string | null;
  system: string | null;
  tacitNotes: string | null;
}

export interface FlowDefinitionRow {
  flowId: string;
  flowName: string;
  kind: 'ASIS' | 'TOBE';
  definition: FlowDefinition;
}

export const EMPTY_DEFINITION: Omit<FlowDefinition, 'flowId'> = {
  purpose: null, owner: null, stakeholders: null, input: null, inputDetail: null,
  trigger: null, doSteps: [], output: null, nextProcess: null, exceptionHandling: null,
  frequency: null, system: null, tacitNotes: null,
};

/** ①一覧の DO 列用に手順を要約する */
export function summarizeDoSteps(steps: string[]): string {
  if (!steps || steps.length === 0) return '';
  if (steps.length === 1) return steps[0];
  return `${steps[0]} ほか${steps.length - 1}件 (全${steps.length}手順)`;
}

/** ①一覧の1行（表示列）を定義から作る */
export function definitionToRow(def: FlowDefinition) {
  return {
    purpose: def.purpose ?? '',
    owner: def.owner ?? '',
    input: def.input ?? '',
    doSummary: summarizeDoSteps(def.doSteps ?? []),
    output: def.output ?? '',
    frequency: def.frequency ?? '',
    system: def.system ?? '',
  };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export const flowDefinitionApi = {
  async get(flowId: string): Promise<FlowDefinition> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/definition`, { headers: headers() });
    if (!res.ok) throw new Error('業務定義の取得に失敗しました');
    return res.json();
  },
  async upsert(flowId: string, patch: Partial<FlowDefinition>): Promise<FlowDefinition> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/definition`, {
      method: 'PUT', headers: headers(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('業務定義の保存に失敗しました');
    return res.json();
  },
  async listByProject(projectId: string): Promise<FlowDefinitionRow[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/flow-definitions`, { headers: headers() });
    if (!res.ok) throw new Error('業務定義一覧の取得に失敗しました');
    return res.json();
  },
};
```

- [ ] **Step 4: テストが通ることを確認**

Run（`frontend/`）: `../node_modules/.bin/vitest run src/lib/flow-definition.test.ts`
Expected: PASS（3+1 テスト）。

- [ ] **Step 5: 全テスト確認 + Commit**

Run: `../node_modules/.bin/vitest run`（既存68 + 新規4 = 72 が green）。
```bash
git add frontend/src/lib/flow-definition.ts frontend/src/lib/flow-definition.test.ts
git commit -m "feat(flow-definition): frontend lib + pure helpers (vitest)"
```

---

## Task 7: ③ 個別定義タブ（flows/[flowId]）

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/flows/[flowId]/page.tsx`

既存タブ「業務定義」(Phase B の RecordSheet `flow-definition:<flowId>`) を、`flowDefinitionApi` ベースの「個別定義」タブに置換する。

- [ ] **Step 1: 既存タブ構造を確認**

Run: `grep -n "業務定義\|情報の地図\|フロー図\|RecordSheetTable\|Tabs\|tab" "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/flows/[flowId]/page.tsx" | head -30`
→ タブの定義箇所と「業務定義」タブの中身（`flow-definition:`+flowId の RecordSheetTable）を特定。

- [ ] **Step 2: 「個別定義」タブの中身を実装**

「業務定義」タブのラベルを「個別定義」に変更し、中身を以下の編集UIに差し替える（同ファイル内のローカルコンポーネント `FlowDefinitionPanel({ flowId })` として実装可）:
- マウント時 `flowDefinitionApi.get(flowId)` → state。
- 単一文字列項目（purpose/owner/stakeholders/input/inputDetail/trigger/output/nextProcess/frequency/system）は input、長文（exceptionHandling/tacitNotes/inputDetail/stakeholders）は textarea。ラベルは日本語（目的/担当/関係者/INPUT/INPUT詳細(セル範囲)/トリガー/OUTPUT/次工程/頻度/システム/例外処理/暗黙知メモ）。
- `doSteps`（番号付きDO手順）: 番号付きリスト。各行 input + 削除、↑↓で並べ替え、「手順を追加」。
- 「保存」ボタン → `flowDefinitionApi.upsert(flowId, {...state})`（保存中/保存済み表示）。
- 旧 RecordSheet 'flow-definition:'+flowId の参照は削除。「情報の地図(CRUOA)」「フロー図」タブはそのまま。

実装例（DO手順部分の要点）:

```tsx
const move = (i: number, d: -1 | 1) => setSteps((s) => {
  const j = i + d; if (j < 0 || j >= s.length) return s;
  const next = [...s]; [next[i], next[j]] = [next[j], next[i]]; return next;
});
// 行: <span>{i + 1}.</span><input value={step} onChange=...><button onClick={() => move(i,-1)}>↑</button>...<button onClick={() => setSteps(s=>s.filter((_,k)=>k!==i))}>削除</button>
// 追加: <button onClick={() => setSteps(s => [...s, ''])}>手順を追加</button>
```

- [ ] **Step 3: tsc 確認**

Run（`frontend/`）: `../node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0（`.next/types` のスタブエラーが出たら `rm -rf .next/types` 後に再実行）。

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/flows/[flowId]/page.tsx"
git commit -m "feat(flow-definition): ③ 個別定義タブ (flows/[flowId])"
```

---

## Task 8: ① 業務定義シート（全フロー一覧ページ）+ サイドバー導線

**Files:**
- Create: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/business-definition/page.tsx`
- Modify: `frontend/src/app/(dashboard)/layout.tsx`

- [ ] **Step 1: ① ページを実装**

`business-definition/page.tsx`（'use client'）:
- `useParams()` で projectId。`flowDefinitionApi.listByProject(projectId)` → `FlowDefinitionRow[]`。
- 表: 列 = 業務フロー名 / 目的 / 担当 / INPUT / DO / OUTPUT / 頻度 / システム。各行は `definitionToRow(row.definition)` で表示。
- 業務フロー名は `kind` バッジ（ASIS=amber, TOBE=emerald）+ 名前。クリックで `/dashboard/projects/${projectId}/flows/${row.flowId}` へ（個別定義タブ）。
- 単純列（目的/担当/INPUT/OUTPUT/頻度/システム）はインライン編集（input、onBlur で `flowDefinitionApi.upsert(row.flowId, { purpose: ... })` のように該当キーのみ送信）→ ローカル state 更新。
- DO 列は `doSummary` を表示（読み取り専用）＋「編集」リンクで該当フローの個別定義タブへ。
- フローが無い時は空状態（業務フローを作る導線 `/flows`）。
- `PageHeader('業務定義シート', description '全業務フローの業務定義を一覧・編集', help, backHref=プロジェクト)` + `HelpTooltip` + `HowToPanel`。`overflow-x-auto`。

- [ ] **Step 2: サイドバー導線**

`frontend/src/app/(dashboard)/layout.tsx`（READ; stage-grouped projectGroups の '現状把握' グループ）: '現状把握' グループに項目追加
`{ name: '業務定義シート', href: \`/dashboard/projects/${projectId}/business-definition\`, icon: <ClipboardList または FileSpreadsheet> }`（lucide import 追加）。他グループ/FlowTree は不変。

- [ ] **Step 3: tsc 確認**

Run（`frontend/`）: `../node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0（必要なら `rm -rf .next/types`）。

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/business-definition/page.tsx" "frontend/src/app/(dashboard)/layout.tsx"
git commit -m "feat(flow-definition): ① 業務定義シート一覧ページ + サイドバー"
```

---

## Task 9: GAP追加を選択式に（Part 1）

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/projects/[projectId]/gap-items/page.tsx`
- Verify/Modify (backend): `backend/src/presentation/controllers/gap-item.controller.ts` + create/update use-case + DTO（FKを受け付けるか確認）

- [ ] **Step 1: バックエンドが FK を受け付けるか確認**

Run: `grep -n "asisFlowId\|tobeFlowId\|asisNodeId\|tobeNodeId" backend/src/presentation/controllers/gap-item.controller.ts backend/src/application/use-cases/gap-item/create-gap-item.use-case.ts backend/src/application/use-cases/gap-item/update-gap-item.use-case.ts`
- 受け付けていれば Step 2 へ。受け付けていなければ: `CreateGapItemDto`/`UpdateGapItemDto` に `@IsOptional() @IsString() asisFlowId?/asisNodeId?/tobeFlowId?/tobeNodeId?` を追加、create/update use-case の input とエンティティ設定（GapItem エンティティに setter があるか確認、無ければ `business_flows`/`flow_nodes` FK を含めて create）に反映。`tsc` 0 を確認。

- [ ] **Step 2: フロントのフォーム state とフェッチ**

`gap-items/page.tsx`（READ; `newItem`/`FormState` に `businessArea/asisFlowId/asisNodeId/tobeFlowId/tobeNodeId` は既に型としてある）:
- マウント時に `GET /api/business-flows/project/:projectId/all` で全フロー取得 → `flows` state。ASIS用 = `flows.filter(f=>f.kind==='ASIS')`、TOBE用 = `kind==='TOBE'`。
- 選択フローのノードは `GET /api/business-flows/:flowId`（レスポンスの `nodes[]`）で都度取得（asis用/tobe用それぞれ）。

- [ ] **Step 3: フォームUIを選択式に**

作成/編集ダイアログに:
- 対象業務: `<Select>` 全フロー → 選択で `setNewItem({ businessArea: flow.name, ... })`（自由入力も残す: フロー未選択時は従来テキスト）。
- ASIS: `<Select>` ASISフロー → `asisFlowId`。選択後ノード `<Select>`（任意, 「指定なし」含む）→ `asisNodeId`。
- TOBE: `<Select>` TOBEフロー → `tobeFlowId`、ノード任意 → `tobeNodeId`。
- 既存の gapDescription/優先度/担当 は維持。作成 POST / 更新 PUT body に `businessArea, asisFlowId, asisNodeId, tobeFlowId, tobeNodeId` を含める（空は `null`/省略）。

- [ ] **Step 4: 一覧にチップ表示**

GAP一覧の各行に、ASIS/TOBE フロー名のチップ（`flows` から名前解決、`asisFlow.name`）を表示し、クリックで `/dashboard/projects/${projectId}/flows/${asisFlowId}` へ。フロー未設定の行はチップ非表示。

- [ ] **Step 5: tsc + ライブスモーク**

Run（`frontend/`）: `../node_modules/.bin/tsc --noEmit -p tsconfig.json` → 0。
Run（backend が動いていること）:
```bash
API=http://localhost:5021
TOK=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"email":"demo@iplot.local","password":"password123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["accessToken"])')
PID=b8310746-320e-449c-96db-169f5a1017ee
FLOW=$(curl -s "$API/api/business-flows/project/$PID/all" -H "Authorization: Bearer $TOK" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')
curl -s -o /dev/null -w "gap create %{http_code}\n" -X POST "$API/api/projects/$PID/gap-items" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "{\"businessArea\":\"受注処理\",\"asisFlowId\":\"$FLOW\",\"gapDescription\":\"テスト\",\"priority\":\"HIGH\"}"
curl -s "$API/api/projects/$PID/gap-items" -H "Authorization: Bearer $TOK" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("asisFlowId set:", any(x.get("asisFlowId") for x in (d if isinstance(d,list) else d.get("data",[]))))'
```
Expected: `gap create 201`、`asisFlowId set: True`。

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/(dashboard)/dashboard/projects/[projectId]/gap-items/page.tsx" backend/src
git commit -m "feat(gap): 対象業務/ASIS/TOBE を業務フロー・ノードの選択式に"
```

---

## Task 10: 最終検証

- [ ] **Step 1: 全体 tsc + vitest**

Run:
```bash
cd /Users/kazuyukijimbo/brain-pro/backend && ../node_modules/.bin/tsc --noEmit -p tsconfig.json
cd /Users/kazuyukijimbo/brain-pro/frontend && rm -rf .next/types && ../node_modules/.bin/tsc --noEmit -p tsconfig.json && ../node_modules/.bin/vitest run
```
Expected: backend 0 errors、frontend 0 errors、vitest 72 passed。

- [ ] **Step 2: ルートのライブ確認**

```bash
PID=b8310746-320e-449c-96db-169f5a1017ee
for r in business-definition gap-items "flows"; do curl -s -o /dev/null -w "$r: %{http_code}\n" "http://localhost:3007/dashboard/projects/$PID/$r"; done
```
Expected: すべて 200。

- [ ] **Step 3: 仕様充足チェック**（spec 3点：GAP選択式 / ①一覧 / ③編集 がUI上で動くことを目視）

- [ ] **Step 4: 最終 Commit（必要なら）**

```bash
git add -A && git commit -m "chore: GAP選択式＋業務定義シート①/③ 最終検証" || echo "nothing to commit"
```

---

## Self-Review notes
- **Spec coverage:** Part1(GAP選択式)=Task9; Part2 ①=Task8, ③=Task7, データモデル(FlowDefinition案C)=Task1-5, フロントlib=Task6。全要件にタスク対応。
- **型整合:** `FlowDefinitionFields`(entity) / `FlowDefinition`(frontend) / `UpsertFlowDefinitionDto` / `FlowDefinitionRow` のキー名一致を確認済み（purpose/owner/stakeholders/input/inputDetail/trigger/doSteps/output/nextProcess/exceptionHandling/frequency/system/tacitNotes）。エンドポイント名一致（`business-flows/:flowId/definition`, `projects/:projectId/flow-definitions`）。
- **依存確認の明示:** domain barrel のエクスポート名（`IBusinessFlowRepository`/`BUSINESS_FLOW_REPOSITORY` 等）と `prisma.service` パス、GapItem create/update のFK受領可否は、実装時に既存ファイルで確認して合わせる旨をタスク内に明記。
- **テスト方針:** 純粋関数(`summarizeDoSteps`/`definitionToRow`)のみ vitest TDD、他は tsc + ライブスモーク（リポジトリの実態に整合）。
