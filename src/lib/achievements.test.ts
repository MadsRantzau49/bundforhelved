import { describe, expect, it } from "vitest";
import { calculateAchievements } from "@/lib/achievements";
import type { ProfileAttempt } from "@/types/app";

function attempt(
  id: string,
  createdAt: string,
  categoryId = "category-a",
  categoryName = "Flaske",
  status: ProfileAttempt["status"] = "approved",
): ProfileAttempt {
  return {
    id,
    category_id: categoryId,
    clan_id: null,
    elapsed_ms: 12_000,
    confirmed_at: createdAt,
    submitted_for_review_at: createdAt,
    reviewed_by: "reviewer-a",
    status,
    invalidated_reason: null,
    created_at: createdAt,
    categories: { id: categoryId, name: categoryName, icon_key: "bottle", accent_color: "#ffffff" },
    reviewer: { username: "reviewer" },
  };
}

describe("calculateAchievements", () => {
  it("counts only approved attempts and tracks three attempts inside ten minutes", () => {
    const attempts = [
      attempt("1", "2026-09-01T18:00:00Z"),
      attempt("2", "2026-09-01T18:04:00Z"),
      attempt("3", "2026-09-01T18:10:00Z"),
      attempt("4", "2026-09-01T18:11:00Z", "category-a", "Flaske", "pending_review"),
    ];
    const progress = calculateAchievements(attempts, ["category-a"]);

    expect(progress.find((item) => item.key === "trippel")?.unlocked).toBe(true);
    expect(progress.find((item) => item.key === "tre-paa-ti")?.unlocked).toBe(true);
    expect(progress.find((item) => item.key === "kommet-i-gang")?.current).toBe(3);
  });

  it("uses all active categories for the same-day menu challenge", () => {
    const attempts = [
      attempt("1", "2026-09-01T18:00:00Z", "category-a", "Flaske"),
      attempt("2", "2026-09-01T19:00:00Z", "category-b", "Dåse"),
      attempt("3", "2026-09-01T20:00:00Z", "category-c", "Krus"),
    ];
    const progress = calculateAchievements(attempts, ["category-a", "category-b", "category-c"]);
    const menu = progress.find((item) => item.key === "hele-menukortet");

    expect(menu).toMatchObject({ current: 3, target: 3, unlocked: true });
  });

  it("recognizes two Kirsejohn attempts on one day", () => {
    const progress = calculateAchievements([
      attempt("1", "2026-09-01T18:00:00Z", "category-k", "Kirsejohn"),
      attempt("2", "2026-09-01T20:00:00Z", "category-k", "KIRSEJOHN special"),
    ], ["category-k"]);

    expect(progress.find((item) => item.key === "kirsejohn-dobbelt")).toMatchObject({ current: 2, unlocked: true });
  });
});
