import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import * as fs from "fs";
import { AppModule } from "./app.module";
import { maybeExportOpenApi } from "./openapi-export";

async function exportOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");

  const config = new DocumentBuilder()
    .setTitle("WineOps AI API")
    .setDescription(
      "Real-time API for Restaurant Wine Inventory & Procurement Management.",
    )
    .setVersion("1.0.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Enter your JWT token",
      },
      "JWT-auth",
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  // Gated on the same flag as the boot path (ADR 0123 / OD-89). The
  // `openapi:export` script sets it; running this file without it writes
  // nothing and says so, rather than surprising the tree with a file.
  const wrote = maybeExportOpenApi(document, {
    write: (path, contents) => fs.writeFileSync(path, contents),
    // eslint-disable-next-line no-console
    log: (message) => console.log(message),
  });
  await app.close();

  if (!wrote) {
    // eslint-disable-next-line no-console
    console.log(
      "EXPORT_OPENAPI is not set to 1 -- nothing was written. Run: pnpm --filter @wineops/api-gateway openapi:export",
    );
    process.exitCode = 1;
  }
}

exportOpenApi().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to export OpenAPI spec:", error);
  process.exit(1);
});
