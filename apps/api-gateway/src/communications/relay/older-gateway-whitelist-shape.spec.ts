/**
 * PR #429 audit (F2): the body a gateway OLDER than the orchestrator answers.
 *
 * The gateway and `services/agent-orchestrator` deploy separately on Railway,
 * with no ordering between them. A new agent sends `restaurantId`,
 * `providerId`, `conversationId` and `orderId`; a gateway binary whose
 * `SendEmailDto` predates them refuses the body in the global ValidationPipe
 * (main.ts) with a 400, before any handler runs. ADR 0099 makes a relay 400
 * final, so the agent recognises THIS shape and releases the draft for retry
 * instead (`_fields_an_older_gateway_refused`, email_composer_service.py).
 *
 * The agent reads it structurally — a 400 whose `message` is a LIST of
 * "property <name> should not exist" — so this pins that shape on the side
 * that produces it, with main.ts's own pipe options.
 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { IsArray, IsString } from "class-validator";

/** A pre-#429 SendEmailDto, cut down to two declared fields. */
class OlderSendEmailDto {
  @IsArray()
  to!: string[];

  @IsString()
  subject!: string;
}

describe("the 400 an older gateway answers for fields it does not declare", () => {
  it("is main.ts's pipe: whitelist plus forbidNonWhitelisted", () => {
    const main = readFileSync(join(__dirname, "..", "..", "main.ts"), "utf8");
    expect(main).toMatch(
      /new ValidationPipe\(\{\s*whitelist: true,\s*forbidNonWhitelisted: true,/,
    );
  });

  it("carries a LIST of 'property <name> should not exist', one per undeclared field", async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    let thrown: unknown;
    try {
      await pipe.transform(
        {
          to: ["orders@vendor-one.example"],
          subject: "Re: your wines",
          restaurantId: "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa",
          orderId: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
        },
        { type: "body", metatype: OlderSendEmailDto },
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      message: [
        "property restaurantId should not exist",
        "property orderId should not exist",
      ],
      error: "Bad Request",
    });
  });
});
