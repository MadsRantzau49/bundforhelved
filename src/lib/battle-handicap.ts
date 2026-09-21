import type { BattleHandicapPreview } from "@/types/app";

export function handicapExpectedChallenger(preview: BattleHandicapPreview, recipientId: string, challengerId: string, handicapMs: number) {
  const challengerAdjusted = Math.max(1, preview.challenger_best_ms - (recipientId === challengerId ? handicapMs : 0));
  const opponentAdjusted = Math.max(1, preview.opponent_best_ms - (recipientId === challengerId ? 0 : handicapMs));
  const timeAdvantage = preview.time_elo_per_doubling * Math.log2(opponentAdjusted / challengerAdjusted);
  const ratingAdvantage = preview.challenger_elo - preview.opponent_elo + timeAdvantage;
  return Math.max(0.01, Math.min(0.99, 1 / (1 + 10 ** (-ratingAdvantage / 400))));
}

export function projectedEloChange(factor: number, expected: number, ownElo = Number.MAX_SAFE_INTEGER) {
  const win = Math.round(factor * (1 - expected));
  const loss = Math.round(factor * expected);
  const projectedLoss = Math.min(ownElo, loss);
  return {
    win,
    loss: projectedLoss === 0 ? 0 : -projectedLoss,
  };
}
