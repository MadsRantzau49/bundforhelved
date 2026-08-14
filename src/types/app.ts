export type ProfileRole = "user" | "admin";
export type AttemptStatus =
  | "running"
  | "awaiting_confirmation"
  | "approved"
  | "declined"
  | "invalidated";
export type ClanRole = "owner" | "member";

export type Profile = {
  id: string;
  username: string;
  avatar_path: string | null;
  role: ProfileRole;
  created_at: string;
};

export type Category = {
  id: string;
  name: string;
  icon_key: string;
  accent_color: string;
  description: string;
  sort_order: number;
  is_active: boolean;
};

export type Attempt = {
  id: string;
  user_id: string;
  recorded_by: string | null;
  category_id: string;
  clan_id: string | null;
  started_at: string;
  stopped_at: string | null;
  elapsed_ms: number | null;
  status: AttemptStatus;
  confirmed_at: string | null;
  invalidated_reason?: string | null;
};

export type StartedAttempt = {
  attempt: Attempt;
  live_elapsed_ms: number;
};

export type LeaderboardEntry = {
  rank: number;
  user_id: string;
  username: string;
  avatar_path: string | null;
  elapsed_ms: number;
  attempt_id: string;
};

export type Clan = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type ClanMembership = {
  clan_id: string;
  user_id: string;
  role: ClanRole;
  joined_at: string;
  clans: Clan;
};

export type TimerClan = Pick<Clan, "id" | "name">;

export type TimerPlayer = {
  player_id: string;
  username: string;
  avatar_path: string | null;
  is_host: boolean;
  clans: TimerClan[];
  needs_refresh?: boolean;
};

export type GuestRequestStart = {
  request_id: string;
  guest_id: string;
  username: string;
  avatar_path: string | null;
  expires_at: string;
};

export type GuestRequest = {
  request_id: string;
  direction: "incoming" | "outgoing";
  other_user_id: string;
  username: string;
  avatar_path: string | null;
  created_at: string;
  expires_at: string;
  otp_issued: boolean;
};

export type GuestAccess = {
  direction: "guest" | "operator";
  other_user_id: string;
  username: string;
  avatar_path: string | null;
  granted_at: string;
};

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type FormState = {
  error?: string;
  success?: string;
};
