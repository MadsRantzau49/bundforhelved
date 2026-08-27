import type { ProfileAttempt } from "@/types/app";

export type AchievementRarity = "bronze" | "silver" | "gold" | "legendary";

export type AchievementDefinition = {
  key: string;
  title: string;
  description: string;
  metric: string;
  target: number;
  rarity: AchievementRarity;
};

export type AchievementProgress = AchievementDefinition & {
  current: number;
  unlocked: boolean;
};

export const achievementDefinitions: AchievementDefinition[] = [
  { key: "foerste-slurk", title: "Første slurk", description: "Få din første tid godkendt.", metric: "total", target: 1, rarity: "bronze" },
  { key: "kommet-i-gang", title: "Kommet i gang", description: "Sæt 5 godkendte tider.", metric: "total", target: 5, rarity: "bronze" },
  { key: "ti-i-tanken", title: "Ti i tanken", description: "Sæt 10 godkendte tider.", metric: "total", target: 10, rarity: "bronze" },
  { key: "halvtreds-hapsere", title: "Halvtreds hapsere", description: "Sæt 50 godkendte tider.", metric: "total", target: 50, rarity: "silver" },
  { key: "hundrede-procent", title: "Hundrede procent", description: "Sæt 100 godkendte tider.", metric: "total", target: 100, rarity: "gold" },
  { key: "kvart-tusind", title: "Kvart tusind", description: "Sæt 250 godkendte tider. Respekt.", metric: "total", target: 250, rarity: "gold" },
  { key: "tusindbenet", title: "Tusindbenet", description: "Sæt 1.000 godkendte tider.", metric: "total", target: 1000, rarity: "legendary" },
  { key: "trippel", title: "Trippel", description: "Sæt 3 godkendte tider på én dag.", metric: "dailyMax", target: 3, rarity: "bronze" },
  { key: "seks-paa-stribe", title: "Seks-pak", description: "Sæt 6 godkendte tider på én dag.", metric: "dailyMax", target: 6, rarity: "silver" },
  { key: "gylden-dag", title: "Gylden dag", description: "Sæt 10 godkendte tider på én dag.", metric: "dailyMax", target: 10, rarity: "gold" },
  { key: "hele-kassen", title: "Hele kassen", description: "Sæt 24 godkendte øltider på én dag.", metric: "dailyMax", target: 24, rarity: "legendary" },
  { key: "tre-paa-ti", title: "Tre på ti", description: "Sæt 3 godkendte tider inden for 10 minutter.", metric: "tenMinuteMax", target: 3, rarity: "gold" },
  { key: "weekendkriger", title: "Weekendkriger", description: "Sæt 10 tider på lørdage eller søndage.", metric: "weekend", target: 10, rarity: "silver" },
  { key: "mandagsmod", title: "Mandagsmod", description: "Sæt 10 tider på mandage.", metric: "monday", target: 10, rarity: "silver" },
  { key: "fredagsbar", title: "Fredagsbar", description: "Sæt 25 tider på fredage.", metric: "friday", target: 25, rarity: "gold" },
  { key: "morgenhanen", title: "Morgenhanen", description: "Sæt 10 tider mellem kl. 05 og 09.", metric: "morning", target: 10, rarity: "silver" },
  { key: "natuglen", title: "Natuglen", description: "Sæt 10 tider mellem midnat og kl. 05.", metric: "night", target: 10, rarity: "silver" },
  { key: "tre-dages-torst", title: "Tre dages tørst", description: "Vær aktiv 3 dage i træk.", metric: "streak", target: 3, rarity: "bronze" },
  { key: "hel-uge", title: "Ingen hviledag", description: "Vær aktiv 7 dage i træk.", metric: "streak", target: 7, rarity: "gold" },
  { key: "maaned-uden-pause", title: "Måned uden pause", description: "Vær aktiv 30 dage i træk.", metric: "streak", target: 30, rarity: "legendary" },
  { key: "kalenderfylder", title: "Kalenderfylder", description: "Sæt tider på 30 forskellige dage.", metric: "activeDays", target: 30, rarity: "silver" },
  { key: "hundrede-dage", title: "Hundrede dage", description: "Sæt tider på 100 forskellige dage.", metric: "activeDays", target: 100, rarity: "legendary" },
  { key: "groen-maskine", title: "Grøn maskine", description: "Lav 5 gyldne dage med mindst 10 tider.", metric: "goldDays", target: 5, rarity: "legendary" },
  { key: "global-borger", title: "Global borger", description: "Sæt 25 globale tider.", metric: "global", target: 25, rarity: "silver" },
  { key: "klan-dyr", title: "Klandyr", description: "Sæt 25 tider i en klan.", metric: "clan", target: 25, rarity: "silver" },
  { key: "vennerne-godkender", title: "Vennerne godkender", description: "Bliv godkendt af 5 forskellige venner.", metric: "reviewers", target: 5, rarity: "gold" },
  { key: "under-minuttet", title: "Under minuttet", description: "Sæt en godkendt tid under 60 sekunder.", metric: "underMinute", target: 1, rarity: "bronze" },
  { key: "lyn-i-glasset", title: "Lyn i glasset", description: "Sæt 3 godkendte tider under 10 sekunder.", metric: "underTenSeconds", target: 3, rarity: "legendary" },
  { key: "kategori-samler", title: "Smag på det hele", description: "Sæt mindst én tid i hver aktiv kategori.", metric: "categories", target: 1, rarity: "gold" },
  { key: "hele-menukortet", title: "Hele menukortet", description: "Sæt én tid i hver aktiv kategori på samme dag.", metric: "dailyCategories", target: 1, rarity: "legendary" },
  { key: "kategori-trippel", title: "Blandede bolsjer", description: "Sæt tider i 3 kategorier på samme dag.", metric: "dailyCategories", target: 3, rarity: "silver" },
  { key: "favoritdrikken", title: "Stamkunde", description: "Sæt 20 tider i den samme kategori.", metric: "categoryMax", target: 20, rarity: "gold" },
  { key: "kirsejohn-dobbelt", title: "Dobbelt Kirsejohn", description: "Sæt 2 Kirsejohn-tider på én dag. Den sagnomspundne prøve.", metric: "dailyKirsejohn", target: 2, rarity: "legendary" },
];

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Copenhagen", weekday: "short" });
const hourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", hourCycle: "h23" });

export function attemptDateKey(attempt: Pick<ProfileAttempt, "created_at">) {
  return dateFormatter.format(new Date(attempt.created_at));
}

function longestDateStreak(dateKeys: string[]) {
  let longest = 0;
  let current = 0;
  let previous: number | undefined;
  for (const key of [...new Set(dateKeys)].sort()) {
    const day = Date.parse(`${key}T12:00:00Z`) / 86_400_000;
    current = previous !== undefined && day - previous === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}

function maxInTenMinutes(attempts: ProfileAttempt[]) {
  const times = attempts.map((attempt) => new Date(attempt.created_at).getTime()).sort((a, b) => a - b);
  let start = 0;
  let best = 0;
  for (let end = 0; end < times.length; end += 1) {
    while (times[end] - times[start] > 10 * 60_000) start += 1;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

export function calculateAchievements(
  attempts: ProfileAttempt[],
  activeCategoryIds: string[],
): AchievementProgress[] {
  const approved = attempts.filter((attempt) => attempt.status === "approved");
  const perDay = new Map<string, ProfileAttempt[]>();
  const perCategory = new Map<string, number>();

  for (const attempt of approved) {
    const day = attemptDateKey(attempt);
    perDay.set(day, [...(perDay.get(day) ?? []), attempt]);
    perCategory.set(attempt.category_id, (perCategory.get(attempt.category_id) ?? 0) + 1);
  }

  const dayAttempts = [...perDay.values()];
  const categoryTarget = Math.max(1, activeCategoryIds.length);
  const attemptedActiveCategories = new Set(
    approved.filter((attempt) => activeCategoryIds.includes(attempt.category_id)).map((attempt) => attempt.category_id),
  ).size;
  const metrics: Record<string, number> = {
    total: approved.length,
    dailyMax: Math.max(0, ...dayAttempts.map((items) => items.length)),
    tenMinuteMax: maxInTenMinutes(approved),
    activeDays: perDay.size,
    streak: longestDateStreak([...perDay.keys()]),
    weekend: approved.filter((attempt) => ["Sat", "Sun"].includes(weekdayFormatter.format(new Date(attempt.created_at)))).length,
    monday: approved.filter((attempt) => weekdayFormatter.format(new Date(attempt.created_at)) === "Mon").length,
    friday: approved.filter((attempt) => weekdayFormatter.format(new Date(attempt.created_at)) === "Fri").length,
    morning: approved.filter((attempt) => { const hour = Number(hourFormatter.format(new Date(attempt.created_at))); return hour >= 5 && hour < 9; }).length,
    night: approved.filter((attempt) => Number(hourFormatter.format(new Date(attempt.created_at))) < 5).length,
    goldDays: dayAttempts.filter((items) => items.length >= 10).length,
    global: approved.filter((attempt) => !attempt.clan_id).length,
    clan: approved.filter((attempt) => Boolean(attempt.clan_id)).length,
    reviewers: new Set(approved.map((attempt) => attempt.reviewed_by).filter(Boolean)).size,
    underMinute: approved.filter((attempt) => attempt.elapsed_ms < 60_000).length,
    underTenSeconds: approved.filter((attempt) => attempt.elapsed_ms < 10_000).length,
    categories: attemptedActiveCategories,
    dailyCategories: Math.max(0, ...dayAttempts.map((items) => new Set(items.filter((attempt) => activeCategoryIds.includes(attempt.category_id)).map((attempt) => attempt.category_id)).size)),
    categoryMax: Math.max(0, ...perCategory.values()),
    dailyKirsejohn: Math.max(0, ...dayAttempts.map((items) => items.filter((attempt) => attempt.categories.name.toLocaleLowerCase("da").includes("kirsejohn")).length)),
  };

  return achievementDefinitions.map((definition) => {
    const dynamicTarget = definition.key === "kategori-samler" || definition.key === "hele-menukortet"
      ? categoryTarget
      : definition.target;
    const current = metrics[definition.metric] ?? 0;
    return { ...definition, target: dynamicTarget, current, unlocked: current >= dynamicTarget };
  }).sort((left, right) => Number(right.unlocked) - Number(left.unlocked));
}
