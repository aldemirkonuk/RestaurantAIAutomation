import {
  MIN_PASSWORD_LENGTH,
  confirmationError,
  emailError,
  isValidResetToken,
  nameError,
  normalizeEmail,
  passwordError,
  passwordStrength,
  resetTokenError,
} from "@/auth/credentials";

describe("normalizeEmail", () => {
  it("trims and lowercases, matching resolveSignInMethods", () => {
    // The gateway does `email.trim().toLowerCase()` before it looks anything
    // up; sending a differently-cased address makes the two disagree about
    // which account is which.
    expect(normalizeEmail("  Chef@Restaurant.COM ")).toBe("chef@restaurant.com");
  });
});

describe("emailError", () => {
  it("accepts ordinary addresses", () => {
    for (const email of [
      "chef@restaurant.com",
      "a.b+tag@sub.domain.co.uk",
      "  Owner@Bistro.fr  ",
    ]) {
      expect(emailError(email)).toBeNull();
    }
  });

  it("asks for an address when empty", () => {
    expect(emailError("")).toMatch(/Enter your email/);
    expect(emailError("   ")).toMatch(/Enter your email/);
  });

  it("rejects the obviously unsendable", () => {
    for (const email of ["chef", "chef@", "@restaurant.com", "chef@host", "a b@c.com"]) {
      expect(emailError(email)).toMatch(/doesn't look like/);
    }
  });
});

describe("passwordError", () => {
  it("mirrors the server minimum and nothing more", () => {
    expect(passwordError("")).toMatch(/Choose a password/);
    expect(passwordError("a".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(
      /at least 8 characters/,
    );
    expect(passwordError("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("does not invent rules the server has not got", () => {
    // No symbol/number/case requirement exists in any auth DTO. Inventing one
    // would refuse passwords the server would happily accept.
    expect(passwordError("passwordpassword")).toBeNull();
    expect(passwordError("        ")).toBeNull();
  });
});

describe("confirmationError", () => {
  it("asks for the second copy", () => {
    expect(confirmationError("hunter2hunter2", "")).toMatch(/Type the password again/);
  });

  it("catches a mismatch", () => {
    expect(confirmationError("hunter2hunter2", "hunter2hunter3")).toMatch(/don't match/);
  });

  it("is case- and whitespace-exact", () => {
    // Trimming a password would silently change it.
    expect(confirmationError("hunter2hunter2 ", "hunter2hunter2")).not.toBeNull();
    expect(confirmationError("Hunter2hunter2", "hunter2hunter2")).not.toBeNull();
  });

  it("passes on an exact match", () => {
    expect(confirmationError("hunter2hunter2", "hunter2hunter2")).toBeNull();
  });
});

describe("passwordStrength", () => {
  it("calls anything under the minimum weak", () => {
    expect(passwordStrength("short")).toBe("weak");
  });

  it("rates a long, mixed password strong", () => {
    expect(passwordStrength("Cellar-Door-9182")).toBe("strong");
  });

  it("rates a valid but plain password fair, not weak", () => {
    expect(passwordStrength("cellardoor9")).toBe("fair");
  });

  it("never blocks a password the server would take", () => {
    // A meter is a hint. This asserts the two never disagree about validity.
    const acceptable = ["aaaaaaaa", "cellardoor9", "Cellar-Door-9182"];
    for (const password of acceptable) {
      expect(passwordError(password)).toBeNull();
      expect(["weak", "fair", "strong"]).toContain(passwordStrength(password));
    }
  });
});

describe("reset tokens", () => {
  const TOKEN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("accepts a UUID in either case", () => {
    expect(isValidResetToken(TOKEN)).toBe(true);
    expect(isValidResetToken(TOKEN.toUpperCase())).toBe(true);
    expect(isValidResetToken(`  ${TOKEN}  `)).toBe(true);
    expect(resetTokenError(TOKEN)).toBeNull();
  });

  it("rejects a truncated or mangled paste before spending it", () => {
    // The token is single-use server-side. A wasted attempt on a bad paste
    // costs the user a whole new email.
    expect(isValidResetToken(TOKEN.slice(0, 20))).toBe(false);
    expect(isValidResetToken(TOKEN.replace(/-/g, ""))).toBe(false);
    expect(isValidResetToken("not-a-token")).toBe(false);
    expect(resetTokenError(TOKEN.slice(0, 20))).toMatch(/right shape/);
  });

  it("asks for the code when the box is empty", () => {
    expect(resetTokenError("")).toMatch(/Paste the code/);
  });
});

describe("nameError", () => {
  it("requires something non-blank", () => {
    expect(nameError("")).toMatch(/Enter your name/);
    expect(nameError("   ")).toMatch(/Enter your name/);
    expect(nameError("Ada")).toBeNull();
  });
});
