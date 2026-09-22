import { describe, expect, it } from "vitest";
import { handicapExpectedChallenger, projectedEloChange } from "@/lib/battle-handicap";
import type { BattleHandicapPreview } from "@/types/app";

const preview: BattleHandicapPreview = {
  challenger_best_ms: 3_500,
  opponent_best_ms: 15_000,
  handicap_user_id: "opponent",
  suggested_handicap_ms: 11_500,
  time_elo_per_doubling: 400,
  battle_elo_factor: 40,
  challenger_elo: 500,
  opponent_elo: 500,
};

describe("battle handicap odds", () => {
  it("makes the suggested handicap a symmetric 50/50 match", () => {
    const expected = handicapExpectedChallenger(preview, "opponent", "challenger", preview.suggested_handicap_ms);
    expect(expected).toBeCloseTo(0.5, 8);
    expect(projectedEloChange(40, expected, 500)).toEqual({ win: 20, loss: -20 });
    expect(projectedEloChange(40, 1 - expected, 500)).toEqual({ win: 20, loss: -20 });
  });

  it("rewards the underdog more when using less than the suggested handicap", () => {
    const challengerExpected = handicapExpectedChallenger(preview, "opponent", "challenger", 5_000);
    const favorite = projectedEloChange(40, challengerExpected, 500);
    const underdog = projectedEloChange(40, 1 - challengerExpected, 500);
    expect(challengerExpected).toBeGreaterThan(0.5);
    expect(favorite.win).toBeLessThan(20);
    expect(favorite.loss).toBeLessThan(-20);
    expect(underdog.win).toBeGreaterThan(20);
    expect(underdog.loss).toBeGreaterThan(-20);
  });

  it("makes the handicap recipient the favorite above the suggestion", () => {
    const challengerExpected = handicapExpectedChallenger(preview, "opponent", "challenger", 13_000);
    const recipient = projectedEloChange(40, 1 - challengerExpected, 500);
    expect(challengerExpected).toBeLessThan(0.5);
    expect(recipient.win).toBeLessThan(20);
    expect(recipient.loss).toBeLessThan(-20);
  });

  it("includes current Elo as well as personal-best times", () => {
    const equalTimes = {
      ...preview,
      challenger_best_ms: 10_000,
      opponent_best_ms: 10_000,
      challenger_elo: 900,
      opponent_elo: 500,
    };
    expect(handicapExpectedChallenger(equalTimes, "opponent", "challenger", 0)).toBeCloseTo(10 / 11, 8);
  });

});

describe("battle Elo projections", () => {
  it("does not cap a winner's gain when the loser is at zero Elo", () => {
    expect(projectedEloChange(40, 0.5, 0)).toEqual({ win: 20, loss: 0 });
  });

  it("allows a sufficiently decayed repeat match to reach zero Elo", () => {
    expect(projectedEloChange(0.4, 0.5, 500)).toEqual({ win: 0, loss: 0 });
  });
});
