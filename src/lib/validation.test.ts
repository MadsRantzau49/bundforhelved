import { describe, expect, it } from "vitest";
import { clanNameSchema, passwordSchema, usernameSchema } from "@/lib/validation";

describe("usernameSchema", () => {
  it("normalizes valid usernames", () => {
    expect(usernameSchema.parse("  Ol_Kongen ")).toBe("Ol_Kongen");
  });

  it("allows spaces, Danish letters, and mixed casing", () => {
    expect(usernameSchema.parse("Øl Kongen")).toBe("Øl Kongen");
  });
});

describe("passwordSchema", () => {
  it("accepts the deliberately simple password requirement", () => {
    expect(passwordSchema.parse("123")).toBe("123");
  });

  it("still rejects an empty password", () => {
    expect(() => passwordSchema.parse("")).toThrow();
  });
});

describe("clanNameSchema", () => {
  it("allows Danish clan names", () => {
    expect(clanNameSchema.parse("Sommerhus på Møn")).toBe("Sommerhus på Møn");
  });
});
