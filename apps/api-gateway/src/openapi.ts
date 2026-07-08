import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import * as fs from "fs";
import { AppModule } from "./app.module";

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
  fs.writeFileSync("./openapi.json", JSON.stringify(document, null, 2));
  await app.close();

  // eslint-disable-next-line no-console
  console.log("📄 OpenAPI spec exported to openapi.json");
}

exportOpenApi().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("❌ Failed to export OpenAPI spec:", error);
  process.exit(1);
});
