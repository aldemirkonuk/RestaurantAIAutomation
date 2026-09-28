/**
 * The per-connection secret: encrypted, or refused — never stored in the clear.
 *
 * The load-bearing test is the LAST one. `Buffer.from(x, "base64")` silently
 * drops what it cannot decode, so a mistyped key does not throw; it produces a
 * short buffer. If this service stretched that into 32 bytes the way its
 * neighbour `TokenCryptoService` stretches a passphrase, a typo would encrypt
 * successfully and the corrected key would never read it back. It refuses
 * instead, and the refusal names the variable.
 */

import { ConfigService } from "@nestjs/config";
import { McpSecretService } from "./mcp-secret.service";

const KEY_HEX = "a".repeat(64);
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");

function withEnv(values: Record<string, string | undefined>): McpSecretService {
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  return new McpSecretService(config);
}

describe("McpSecretService key resolution", () => {
  it("is unconfigured, and says which variable, when the key is absent", () => {
    const service = withEnv({});
    expect(service.isConfigured).toBe(false);
    expect(service.unavailableReason).toContain("MCP_CONNECTION_SECRET_KEY");
    expect(() => service.encrypt("s")).toThrow(/MCP_CONNECTION_SECRET_KEY/);
  });

  it("accepts 64 hex characters", () => {
    expect(withEnv({ MCP_CONNECTION_SECRET_KEY: KEY_HEX }).isConfigured).toBe(true);
  });

  it("accepts 32 bytes of base64", () => {
    expect(withEnv({ MCP_CONNECTION_SECRET_KEY: KEY_B64 }).isConfigured).toBe(true);
  });

  it("REFUSES a short or mistyped key instead of stretching it", () => {
    const service = withEnv({ MCP_CONNECTION_SECRET_KEY: "not-a-real-key" });
    expect(service.isConfigured).toBe(false);
    expect(service.unavailableReason).toMatch(/32-byte key/);
    // The whole point: nothing was encrypted under a derived key that a
    // corrected key could never read back.
    expect(() => service.encrypt("s")).toThrow();
  });

  it("does not borrow the OAuth token key", () => {
    const service = withEnv({
      INTEGRATION_TOKEN_ENCRYPTION_KEY: KEY_HEX,
      TOKEN_ENCRYPTION_KEY: KEY_HEX,
    });
    expect(service.isConfigured).toBe(false);
  });
});

describe("McpSecretService round trip", () => {
  const service = withEnv({ MCP_CONNECTION_SECRET_KEY: KEY_HEX });

  it("encrypts to the v1 envelope and decrypts back", () => {
    const envelope = service.encrypt("hunter2-but-a-bearer-token");
    expect(envelope.startsWith("v1.")).toBe(true);
    expect(envelope).not.toContain("hunter2");
    expect(envelope.split(".")).toHaveLength(4);
    expect(service.decrypt(envelope)).toBe("hunter2-but-a-bearer-token");
  });

  it("produces a different ciphertext each time (the IV is random)", () => {
    expect(service.encrypt("same")).not.toBe(service.encrypt("same"));
  });

  it("refuses a tampered envelope rather than yielding garbage", () => {
    const envelope = service.encrypt("secret");
    const parts = envelope.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString("base64url");
    expect(() => service.decrypt(parts.join("."))).toThrow();
  });

  it("refuses an envelope written under a different key", () => {
    const other = withEnv({ MCP_CONNECTION_SECRET_KEY: KEY_B64 });
    expect(() => service.decrypt(other.encrypt("secret"))).toThrow();
  });
});

describe("McpSecretService.open", () => {
  it("reports no secret and no reason when the column is null", () => {
    const service = withEnv({ MCP_CONNECTION_SECRET_KEY: KEY_HEX });
    expect(service.open(null)).toEqual({ secret: null, reason: null });
  });

  it("gives a REASON, not a bare null, when the key is missing", () => {
    // The distinction the register depends on: "this server has no secret" and
    // "this server has one we cannot read" must not both render as an anonymous
    // call that quietly succeeds.
    const service = withEnv({});
    const opened = service.open("v1.aa.bb.cc");
    expect(opened.secret).toBeNull();
    expect(opened.reason).toContain("MCP_CONNECTION_SECRET_KEY");
  });

  it("gives a reason when the stored envelope will not decrypt, and never echoes it", () => {
    const service = withEnv({ MCP_CONNECTION_SECRET_KEY: KEY_HEX });
    const opened = service.open("v1.AAAA.BBBB.CCCC");
    expect(opened.secret).toBeNull();
    expect(opened.reason).toMatch(/set again/);
    expect(opened.reason).not.toContain("CCCC");
  });
});
