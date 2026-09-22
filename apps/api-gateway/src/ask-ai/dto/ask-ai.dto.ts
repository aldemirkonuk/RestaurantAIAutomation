import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * The bodies Ask AI accepts, as CLASSES.
 *
 * That word is the whole point. `main.ts` installs a global `ValidationPipe`
 * with `whitelist`, `forbidNonWhitelisted` and `transform` all on, but a pipe
 * can only validate a body whose declared type is a class it can construct.
 * These two routes previously declared their bodies as inline TypeScript
 * types — `@Body() body: { utterance?: string }` — which erase to `Object` at
 * runtime. Nest hands `Object` to the pipe, the pipe has no metatype to work
 * with, and it returns the body untouched. So the pipe was installed, looked
 * installed, and validated nothing on this controller: an unbounded string
 * went straight into a model prompt and an arbitrary object went into the
 * confirm path.
 *
 * This is the same shape as the faults already on this estate's record: the
 * instrument reports health because it was never reached. A type annotation
 * is not a guard.
 */
export class ProposeDto {
  @ApiProperty({
    description: "What the operator asked, in their own words.",
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000)
  utterance!: string;
}

/**
 * The body of both sealed routes — `seal-challenge` (the edit the seal is
 * minted on) and `sealed-confirm` (the same edit, carried back). Absent means
 * "apply exactly what was proposed".
 */
export class ConfirmDto {
  @ApiPropertyOptional({
    description:
      "The operator's edits to the proposal, bound into the seal when it is " +
      "minted and carried back unchanged on the apply. Re-validated through the " +
      "same allowlist and grounding check as a model proposal — an editable " +
      "field is an id-injection hole the moment it is trusted.",
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
