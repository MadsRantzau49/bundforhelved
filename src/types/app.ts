export type ProfileRole = "user" | "admin";
export type AttemptStatus =
  | "running"
  | "awaiting_confirmation"
  | "pending_review"
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
  image_path: string | null;
  guide_text: string;
  guide_video_path: string | null;
  demo_video_path: string | null;
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
  submitted_for_review_at?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  evidence_video_path?: string | null;
  review_note?: string | null;
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
  status: "approved" | "pending_review";
  reviewer_username: string | null;
};

export type PeerReviewAttempt = {
  attempt_id: string;
  user_id: string;
  username: string;
  avatar_path: string | null;
  category_id: string;
  category_name: string;
  category_icon_key: string;
  category_accent_color: string;
  clan_id: string | null;
  clan_name: string | null;
  elapsed_ms: number;
  stopped_at: string;
  submitted_for_review_at: string;
  evidence_video_path: string | null;
  evidence_video_url?: string | null;
};

export type Clan = {
  id: string;
  name: string;
  image_path: string | null;
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

export type GuestAccess = {
  direction: "guest" | "operator";
  other_user_id: string;
  username: string;
  avatar_path: string | null;
  granted_at: string;
};

export type Friendship = {
  friendship_id: string;
  other_user_id: string;
  username: string;
  avatar_path: string | null;
  direction: "friend" | "incoming" | "outgoing";
  created_at: string;
};

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type FormState = {
  error?: string;
  success?: string;
};
