import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { READ_SCOPES } from "../tool-catalog";

/**
 * Minting a key for an assistant.
 *
 * The restaurant is NOT a field. It comes from the caller's JWT, the same rule
 * `mcp-connections.controller.ts:44-59` already establishes: an id a caller can
 * type is an id a caller can substitute.
 */
export class MintMcpKeyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label!: string;

  /**
   * Which reads this key may make. Restricted to the READ vocabulary by
   * `@IsIn`, and that restriction is the guardrail rather than a nicety: no
   * write scope is grantable in this build, and letting one be typed here would
   * write a row promising something `tools/call` will refuse — a grant that
   * reads as a capability and is not one.
   *
   * Omitted means an empty array, which is a real state: a key that may
   * handshake and list, and read nothing until someone says what it may read.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @IsIn(READ_SCOPES as unknown as string[], { each: true })
  scopes?: string[];
}
