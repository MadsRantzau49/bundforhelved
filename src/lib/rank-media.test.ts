import { describe, expect, it } from "vitest";
import { rankMediaUrl } from "@/lib/rank-media";

describe("rankMediaUrl", () => {
  it("builds a safe proxy URL for rank images", () => {
    expect(rankMediaUrl("550e8400-e29b-41d4-a716-446655440000/image-1780000000000.webp"))
      .toBe("/api/rank-media/550e8400-e29b-41d4-a716-446655440000/image-1780000000000.webp");
  });

  it("rejects invalid and traversal paths", () => {
    expect(rankMediaUrl("../secret.png")).toBeNull();
    expect(rankMediaUrl("550e8400-e29b-41d4-a716-446655440000/not-an-image.svg")).toBeNull();
    expect(rankMediaUrl(null)).toBeNull();
  });
});
