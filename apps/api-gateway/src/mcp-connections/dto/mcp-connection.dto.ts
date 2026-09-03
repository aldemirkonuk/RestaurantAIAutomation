import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * What the operator types when they add a model-context server.
 *
 * Deliberately three fields. A transport picker, a header map and a credential
 * belong to a handshake this product has not decided on yet (see the migration
 * header); adding them now would be a form that collects things nothing reads.
 */
export class CreateMcpConnectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /**
   * `require_tld: false` so `http://localhost:3000` — the address every MCP
   * server is first tried on — is accepted. The scheme restriction is the part
   * that matters and it is enforced here AND by the table's CHECK.
   */
  @IsUrl({ protocols: ["http", "https"], require_tld: false })
  @MaxLength(2000)
  url!: string;

  /**
   * Scopes granted, in the house's own vocabulary. Optional and defaulting to
   * empty: "declared, nothing granted yet" is a real state, and an empty array
   * says it. Each entry is a short slug so a scope list cannot become a place to
   * paste prose.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  @Matches(/^[a-z0-9][a-z0-9._:-]*$/, {
    each: true,
    message:
      "each scope must be a lowercase slug (letters, digits, . _ : -), e.g. inventory:read",
  })
  scopes?: string[];
}

/** One row of the Model context register, as the browser receives it. */
export interface McpConnectionResponse {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  createdAt: string;
  /** NULL until something calls. Nothing in this product does yet. */
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
}
