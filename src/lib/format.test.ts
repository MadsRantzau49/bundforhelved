import { describe, expect, it } from "vitest";
import { formatTime, initials } from "@/lib/format";

describe("formatTime", () => {
  it("formats hundredths without rounding up", () => {
    expect(formatTime(8_759)).toBe("8.75");
  });

  it("adds minutes for long attempts", () => {
    expect(formatTime(65_432)).toBe("1:05.43");
  });

  it("never renders negative server durations", () => {
    expect(formatTime(-100)).toBe("0.00");
  });
});

describe("initials", () => {
  it("uses the first two username characters", () => {
    expect(initials("ol_kongen")).toBe("OL");
  });
});
