import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { NestExpressApplication } from "@nestjs/platform-express";
import * as fs from "fs";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Needed for exact-byte HMAC signature verification on webhook routes
    // (Toast, pos-hub/SimPOS) — without this, req.rawBody is always
    // undefined and verification falls back to a re-serialized JSON
    // approximation that can mismatch a real signature.
    rawBody: true,
    cors: {
      origin: [
        ...(process.env.FRONTEND_URL
          ? process.env.FRONTEND_URL.split(",")
          : []),
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        /^https:\/\/.*\.vercel\.app$/, // all Vercel preview + production URLs
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/,
        /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/,
        // Vite falls through to the next free port (3001, 3002, …) whenever
        // 3000 is already taken by another local process, which happens
        // often enough in a dev environment running several projects at
        // once. Without this, that ordinary port bump presents as a broken
        // CORS preflight with no indication the actual cause was "the wrong
        // origin isn't allow-listed". Scoped to non-production only, same as
        // the dev auth bypass this exists alongside.
        ...(process.env.NODE_ENV !== "production"
          ? [/^http:\/\/(localhost|127\.0\.0\.1):\d+$/]
          : []),
      ],
      credentials: true,
    },
  });

  // Body size limit.
  //
  // Express/body-parser defaults to 100 kB, which was never overridden here.
  // Menu and receipt uploads are sent as base64 inside JSON, and base64
  // inflates a file by ~33%, so the default rejected any upload over ~75 kB of
  // real file with a bare `413 request entity too large` — raised before the
  // auth guard runs, so it surfaced in the UI as a generic network failure
  // rather than "file too big". A 1.4 MB menu PDF is ~1.87 MB encoded, 19x
  // over the old cap.
  //
  // 15 MB carries the 10 MB per-file limit the web app enforces
  // (MAX_UPLOAD_BYTES in apps/web/src/lib/uploadAccept.ts) plus base64
  // overhead and JSON envelope. Sized against the real corpus in
  // datasets/annotation_inbox/pdfs: 26 restaurant wine lists, largest 4.4 MB —
  // so 10 MB covers every one of them with >2x headroom while staying well
  // inside Anthropic's 32 MB per-request ceiling once encoded.
  //
  // NOTE: `rawBody: true` above means Nest also retains the raw Buffer for
  // HMAC verification, so a request near the cap holds the body roughly twice
  // in memory. That is the ceiling to revisit if uploads ever move to
  // multipart streaming.
  const bodyLimit = process.env.MAX_REQUEST_BODY_SIZE || "15mb";
  app.useBodyParser("json", { limit: bodyLimit });
  app.useBodyParser("urlencoded", { limit: bodyLimit, extended: true });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix("api/v1");

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle("WineOps AI API")
    .setDescription(
      `
## Overview

Real-time API for Restaurant Wine Inventory & Procurement Management.

### Features

- **Dashboard Aggregation**: Single endpoint for all dashboard data (API Bus pattern)
- **One-Tap Actions**: Quick approval workflows for managers
- **Toast POS Integration**: Proxy endpoints for Toast API
- **Real-time Updates**: WebSocket support for live data sync
- **Rate Limiting**: Per-user and per-restaurant quotas

### Authentication

All endpoints (except public ones) require a Bearer token in the Authorization header.

\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

### Rate Limits

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Default | 100 | 60s |
| Auth | 10 | 60s |
| Upload | 10 | 300s |
| AI | 20 | 60s |

### WebSocket Events

Connect to \`ws://localhost:4000\` and join rooms:
- \`restaurant:{restaurantId}\` - Restaurant-wide events
- \`user:{userId}\` - User-specific events

Events:
- \`notification\` - New notifications
- \`inventory_update\` - Inventory changes
- \`order_update\` - Order status changes
- \`one_tap_action\` - One-tap action updates
    `,
    )
    .setVersion("1.0.0")
    .setContact("WineOps Team", "https://wineops.ai", "support@wineops.ai")
    .setLicense("Proprietary", "https://wineops.ai/license")
    .addServer("http://localhost:4000", "Development")
    .addServer("https://api.wineops.ai", "Production")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Enter your JWT token",
      },
      "JWT-auth",
    )
    .addTag("dashboard", "Aggregated dashboard endpoints (API Bus pattern)")
    .addTag("one-tap-actions", "One-tap action management")
    .addTag("toast", "Toast POS API integration")
    .addTag("auth", "Authentication & Authorization")
    .addTag("inventory", "Inventory Management")
    .addTag("procurement", "Procurement & Orders")
    .addTag("notifications", "Real-time Notifications")
    .addTag("reports", "Reports & Analytics")
    .addTag("websocket", "WebSocket Events")
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Export OpenAPI spec to file (for CI/CD and external tools)
  if (process.env.NODE_ENV !== "production") {
    fs.writeFileSync("./openapi.json", JSON.stringify(document, null, 2));
    console.log("📄 OpenAPI spec exported to openapi.json");
  }

  SwaggerModule.setup("api/docs", app, document, {
    customSiteTitle: "WineOps AI API Documentation",
    customfavIcon: "/favicon.ico",
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 20px 0 }
      .swagger-ui .info .title { font-size: 2em }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: "none",
      filter: true,
      showRequestDuration: true,
    },
  });

  // Start server
  const port = process.env.PORT || 4000;
  await app.listen(port);

  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🍷 WineOps AI - API Gateway                            ║
║                                                          ║
║   🚀 Server running on http://localhost:${port}            ║
║   📚 Swagger docs: http://localhost:${port}/api/docs        ║
║   🔌 WebSocket: ws://localhost:${port}                     ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
}

bootstrap();
