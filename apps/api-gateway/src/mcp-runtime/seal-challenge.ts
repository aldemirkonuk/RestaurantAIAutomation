/**
 * The arithmetic of a provable seal — now shared, and still ONE copy.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS NOW A RE-EXPORT (founder, 2026-09-04)
 * ---------------------------------------------------------------------------
 * The founder extended challenge-and-redeem from MCP tool writes to ORDER
 * APPROVAL and to PAYMENT-METHOD writes. Three surfaces need the same token
 * arithmetic, so it moved to `common/seal/seal-token.ts`, which is where a
 * primitive with three callers belongs.
 *
 * This file stays because `mcp-connections/**` imports it and that directory is
 * deliberately not being edited in this pass: re-pointing its import would be a
 * change to a module nobody asked to change, in service of a file move. A
 * re-export costs nothing at runtime and keeps the rule that matters — there is
 * exactly one implementation of `hashCallArgs`, so two surfaces can never
 * disagree about what a given set of arguments hashes to.
 *
 * Do not add anything here. New behaviour goes in `common/seal/`.
 */

export {
  SEAL_TTL_MS,
  newSealToken,
  hashSealToken,
  hashCallArgs,
  digestsMatch,
} from "../common/seal/seal-token";
