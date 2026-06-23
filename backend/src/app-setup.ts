import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';
import type { IncomingMessage } from 'node:http';

/**
 * アプリ共通構成（CORS / ValidationPipe / global prefix 'api' / Swagger / rawBody）。
 * main.ts（ローカル・通常サーバ）と serverless.ts（Vercel Functions）の両方から使う。
 * 例外フィルタ（DomainExceptionFilter）は AppModule の APP_FILTER で登録済み。
 */
export function configureApp(app: INestApplication): void {
  // ===== rawBody 保持（QStash 署名検証用） =====
  // QStash の Upstash-Signature は「生のリクエストボディ」に対する署名なので、
  // JSON parse 前の生文字列が必要。body-parser の verify フックで request に保持する。
  // 既定の JSON パーサより前に登録することで、全ルートで rawBody を得られる。
  // （署名検証は JobController の /api/jobs/run のみが利用する）
  app.use(
    bodyParser.json({
      limit: '10mb',
      verify: (req: IncomingMessage & { rawBody?: string }, _res, buf) => {
        if (buf && buf.length) {
          req.rawBody = buf.toString('utf8');
        }
      },
    }),
  );
  app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

  // Enable CORS
  const allowedOrigins: Array<string | RegExp> = [
    'http://localhost:3000',
    'http://localhost:3003',
    'http://localhost:3007',
    'https://dataflow-frontend-05c3.onrender.com',
    // 自フロントエンド（Vercel プロジェクト brain-pro）の production / preview デプロイのみ許可。
    // 「/\.vercel\.app$/」だと第三者の任意デプロイにも開いてしまうためプロジェクト名で絞る。
    /^https:\/\/brain-pro(-[a-z0-9-]+)?\.vercel\.app$/,
  ];
  // FRONTEND_URL はカンマ区切りで複数オリジン指定可
  if (process.env.FRONTEND_URL) {
    for (const origin of process.env.FRONTEND_URL.split(',')) {
      const trimmed = origin.trim();
      if (trimmed) {
        allowedOrigins.push(trimmed);
      }
    }
  }

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('brain-pro API')
    .setDescription(
      [
        'IPLoT方法論パイプラインAPI: 現状把握/ASIS → 課題(イシューツリー) → TOBE → GAP → 要件/CRUD → 動作確認。',
        '',
        '**認証は2方式**:',
        '1. JWT — `Authorization: Bearer <token>`（Webアプリ）',
        '2. APIキー — `x-api-key: sk_...`（公開API・MCP）。`POST /api-keys` で発行。',
        '',
        '右上の「Authorize」からどちらかを設定してください。',
      ].join('\n'),
    )
    .setVersion('0.2.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  // 認証必須エンドポイントは JWT / APIキー の両方を許可として明示（@Public は対象外）
  for (const pathItem of Object.values(document.paths) as Array<
    Record<string, any>
  >) {
    for (const op of Object.values(pathItem)) {
      if (
        op &&
        typeof op === 'object' &&
        Array.isArray(op.security) &&
        op.security.length
      ) {
        op.security = [{ bearer: [] }, { 'api-key': [] }];
      }
    }
  }

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
