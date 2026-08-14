import { describe, expect, it } from "vitest";
import { clanNameSchema, passwordSchema, usernameSchema } from "@/lib/validation";

describe("usernameSchema", () => {
  it("normalizes valid usernames", () => {
    expect(usernameSchema.parse("  Ol_Kongen ")).toBe("ol_kongen");
  });

  it("rejects spaces and Danish letters in login identities", () => {
    expect(() => usernameSchema.parse("øl kongen")).toThrow();
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
