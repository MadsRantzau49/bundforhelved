import { createHash, createHmac, randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:8000";
const appUrl = "http://localhost:3000";
const anonKey = process.env.ANON_KEY;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY;
const pepper = process.env.AUTH_PASSWORD_PEPPER;
const adminUsername = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin").trim().toLowerCase();

if (!anonKey || !serviceRoleKey || !pepper) {
  throw new Error("Run this test through ./scripts/docker.sh test.");
}
if (!/^[a-z0-9_]{3,24}$/.test(adminUsername)) {
  throw new Error("Configured bootstrap username does not match the application's validation rules.");
}

async function request(url, { expected = [200], ...options } = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method || "GET"} ${url} failed (${response.status}): ${text}`);
  }
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("json") && text ? JSON.parse(text) : text;
}

function authCredentials(username, rawPassword) {
  const normalizedUsername = username.trim().toLowerCase();
  const identity = createHash("sha256").update(normalizedUsername).digest("hex");
  return {
    email: `${identity}@users.bundforhelved.invalid`,
    password: createHmac("sha256", pepper).update(rawPassword).digest("base64url"),
  };
}

async function signIn(username, rawPassword) {
  return request(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(authCredentials(username, rawPassword)),
  });
}

function userHeaders(accessToken) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

const serviceHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};
const temporaryUserIds = [];
const evidencePaths = [];
let attemptId;
const additionalAttemptIds = new Set();
let clanId;
let avatarPath;
let failure;

async function createTemporaryUser() {
  const username = `smoke_${randomBytes(6).toString("hex")}`;
  const rawPassword = randomBytes(24).toString("base64url");
  const credentials = authCredentials(username, rawPassword);
  const user = await request(`${baseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true,
      user_metadata: { username },
      app_metadata: { managed_account: true },
    }),
  });
  temporaryUserIds.push(user.id);
  const token = await signIn(username, rawPassword);
  return {
    id: user.id,
    username,
    headers: userHeaders(token.access_token),
    cookie: await appSessionCookie(token),
  };
}

async function appSessionCookie(session) {
  const jar = new Map();
  const supabase = createServerClient(baseUrl, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw error;

  const publicProject = new URL(baseUrl).hostname.split(".")[0];
  const appProject = process.env.APP_SUPABASE_COOKIE_PROJECT || "gateway";
  return [...jar]
    .map(([name, value]) => `${name.replace(`sb-${publicProject}-`, `sb-${appProject}-`)}=${value}`)
    .join("; ");
}

try {
  const appResponse = await fetch(`${appUrl}/login`);
  const appHtml = await appResponse.text();
  if (!appResponse.ok) throw new Error(`The Next.js login page failed (${appResponse.status}).`);
  if (!appHtml.includes("bund forhelved")) throw new Error("The Next.js login page did not render.");
  if (!appResponse.headers.get("permissions-policy")?.includes("camera=(self)")) {
    throw new Error("The application does not allow its own camera capture.");
  }
  const healthResponse = await fetch(`${appUrl}/api/health`, { method: "HEAD", cache: "no-store" });
  if (healthResponse.status !== 204) throw new Error(`The application health check failed (${healthResponse.status}).`);

  const manifest = await request(`${appUrl}/manifest.webmanifest`);
  if (
    manifest.id !== "/" ||
    manifest.scope !== "/" ||
    manifest.start_url !== "/timer" ||
    manifest.display !== "standalone" ||
    !manifest.icons?.some((icon) => icon.sizes === "192x192") ||
    !manifest.icons?.some((icon) => icon.sizes === "512x512") ||
    !manifest.icons?.some((icon) => icon.purpose === "maskable")
  ) {
    throw new Error("The web app manifest is not installable.");
  }

  const serviceWorkerResponse = await fetch(`${appUrl}/sw.js`);
  const serviceWorker = await serviceWorkerResponse.text();
  if (
    !serviceWorkerResponse.ok ||
    serviceWorkerResponse.headers.get("service-worker-allowed") !== "/" ||
    !serviceWorker.includes("/offline-static.html") ||
    !serviceWorker.includes("navigationPreload")
  ) {
    throw new Error("The production service worker is missing required PWA behavior.");
  }
  const offlineShell = await request(`${appUrl}/offline-static.html`);
  if (!offlineShell.includes("Uret venter")) throw new Error("The offline shell did not render.");

  const adminProfiles = await request(
    `${baseUrl}/rest/v1/profiles?username=eq.${encodeURIComponent(adminUsername)}&select=id,username,role`,
    { headers: serviceHeaders },
  );
  if (
    adminProfiles.length !== 1 ||
    adminProfiles[0].username !== adminUsername ||
    adminProfiles[0].role !== "admin"
  ) {
    throw new Error("The bootstrap profile is missing or is not an administrator.");
  }
  const adminSession = await signIn(adminUsername, process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "123");
  const adminPageResponse = await fetch(`${appUrl}/admin`, {
    headers: { Cookie: await appSessionCookie(adminSession) },
    redirect: "manual",
  });
  const adminPage = await adminPageResponse.text();
  if (
    adminPageResponse.status !== 200 ||
    !adminPage.includes("Kontrolrummet") ||
    adminPage.includes("Data kunne ikke hentes lige nu")
  ) {
    throw new Error(`The authenticated administrator page did not render (${adminPageResponse.status}).`);
  }

  const owner = await createTemporaryUser();
  const observer = await createTemporaryUser();
  const outsider = await createTemporaryUser();
  const clanFriend = await createTemporaryUser();
  const ownerProfiles = await request(`${baseUrl}/rest/v1/profiles?id=eq.${owner.id}&select=id,username,role`, {
    headers: owner.headers,
  });
  if (ownerProfiles.length !== 1 || ownerProfiles[0].role !== "user") {
    throw new Error("A new account did not receive a regular user profile.");
  }

  await request(`${baseUrl}/rest/v1/profiles?id=eq.${owner.id}`, {
    method: "PATCH",
    headers: owner.headers,
    body: JSON.stringify({ role: "admin" }),
    expected: [204],
  });
  const unchangedProfile = await request(`${baseUrl}/rest/v1/profiles?id=eq.${owner.id}&select=role`, {
    headers: owner.headers,
  });
  if (unchangedProfile[0]?.role !== "user") throw new Error("RLS allowed a user to grant themselves admin access.");

  const categories = await request(
    `${baseUrl}/rest/v1/categories?is_active=eq.true&select=id,name&order=sort_order&limit=1`,
    { headers: owner.headers },
  );
  if (!categories.length) throw new Error("No active category was seeded.");

  const started = await request(`${baseUrl}/rest/v1/rpc/start_attempt`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ category: categories[0].id, clan: null, player: owner.id }),
  });
  attemptId = started.id;
  const hiddenAttempts = await request(`${baseUrl}/rest/v1/attempts?id=eq.${attemptId}&select=id`, {
    headers: observer.headers,
  });
  if (hiddenAttempts.length !== 0) throw new Error("RLS exposed another user's timer attempt.");

  await new Promise((resolve) => setTimeout(resolve, 40));
  const stopped = await request(`${baseUrl}/rest/v1/rpc/stop_attempt`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ attempt: attemptId }),
  });
  if (stopped.status !== "awaiting_confirmation" || stopped.elapsed_ms <= 0) {
    throw new Error("The server timer did not stop correctly.");
  }
  await request(`${baseUrl}/rest/v1/rpc/decline_attempt`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ attempt: attemptId }),
  });
  await request(`${baseUrl}/rest/v1/attempts?id=eq.${attemptId}`, {
    method: "DELETE",
    headers: serviceHeaders,
    expected: [204],
  });
  attemptId = undefined;

  const clan = await request(`${baseUrl}/rest/v1/rpc/create_clan`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ name: `Docker test ${Date.now()}` }),
  });
  clanId = clan.id;
  if (!/^\d{6}$/.test(clan.invite_code)) throw new Error("Clan invitation code was not reduced to six digits.");
  const hiddenClans = await request(`${baseUrl}/rest/v1/clans?id=eq.${clanId}&select=id`, {
    headers: observer.headers,
  });
  if (hiddenClans.length !== 0) throw new Error("RLS exposed a clan to a non-member.");

  await request(`${baseUrl}/rest/v1/rpc/join_clan`, {
    method: "POST",
    headers: observer.headers,
    body: JSON.stringify({ invite_code: clan.invite_code }),
  });

  async function requestAndAcceptFriend(requester, recipient) {
    const friendshipId = await request(`${baseUrl}/rest/v1/rpc/request_friend`, {
      method: "POST",
      headers: requester.headers,
      body: JSON.stringify({ target_username: recipient.username }),
    });
    const incoming = await request(`${baseUrl}/rest/v1/rpc/list_friendships`, {
      method: "POST",
      headers: recipient.headers,
      body: "{}",
    });
    if (!incoming.some((item) => item.friendship_id === friendshipId && item.direction === "incoming")) {
      throw new Error("A friend request was not visible to its recipient.");
    }
    await request(`${baseUrl}/rest/v1/rpc/respond_friend_request`, {
      method: "POST",
      headers: recipient.headers,
      body: JSON.stringify({ friendship: friendshipId, accept: true }),
    });
    const accepted = await request(`${baseUrl}/rest/v1/rpc/list_friendships`, {
      method: "POST",
      headers: requester.headers,
      body: "{}",
    });
    if (!accepted.some((item) => item.friendship_id === friendshipId && item.direction === "friend")) {
      throw new Error("An accepted friendship was not mutual.");
    }
    return friendshipId;
  }

  await requestAndAcceptFriend(owner, observer);
  await requestAndAcceptFriend(owner, clanFriend);
  await request(`${baseUrl}/rest/v1/rpc/add_friend_to_clan`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ clan: clanId, friend: clanFriend.id }),
  });
  const addedFriendMembership = await request(
    `${baseUrl}/rest/v1/clan_members?clan_id=eq.${clanId}&user_id=eq.${clanFriend.id}&select=user_id`,
    { headers: clanFriend.headers },
  );
  if (addedFriendMembership.length !== 1) throw new Error("A clan owner could not add an accepted friend to the clan.");

  async function approveAttempt(actor, reviewer, {
    player = actor.id,
    selectedClan = null,
    withEvidence = false,
  } = {}) {
    const created = await request(`${baseUrl}/rest/v1/rpc/start_attempt`, {
      method: "POST",
      headers: actor.headers,
      body: JSON.stringify({ category: categories[0].id, clan: selectedClan, player }),
    });
    additionalAttemptIds.add(created.id);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const stoppedAttempt = await request(`${baseUrl}/rest/v1/rpc/stop_attempt`, {
      method: "POST",
      headers: actor.headers,
      body: JSON.stringify({ attempt: created.id }),
    });
    if (stoppedAttempt.elapsed_ms <= 0) throw new Error("A scoped timer did not advance.");
    let evidencePath;
    if (withEvidence) {
      evidencePath = `${created.id}/evidence-${Date.now()}.webm`;
      evidencePaths.push(evidencePath);
      await request(`${baseUrl}/storage/v1/object/attempt-videos/${evidencePath}`, {
        method: "POST",
        headers: { ...actor.headers, "Content-Type": "video/webm", "x-upsert": "false" },
        body: Buffer.from("docker-smoke-video"),
      });
      const withStoredEvidence = await request(`${baseUrl}/rest/v1/rpc/set_attempt_evidence`, {
        method: "POST",
        headers: actor.headers,
        body: JSON.stringify({ attempt: created.id, path: evidencePath }),
      });
      if (withStoredEvidence.evidence_video_path !== evidencePath) {
        throw new Error("Attempt evidence was not associated with its attempt.");
      }
    }
    const submitted = await request(`${baseUrl}/rest/v1/rpc/confirm_attempt`, {
      method: "POST",
      headers: actor.headers,
      body: JSON.stringify({ attempt: created.id }),
    });
    if (submitted.status !== "pending_review" || submitted.review_code !== null) {
      throw new Error("A locally confirmed attempt was not submitted for code-free peer review.");
    }
    const reviewerQueue = await request(`${baseUrl}/rest/v1/rpc/list_peer_review_attempts`, {
      method: "POST",
      headers: reviewer.headers,
      body: "{}",
    });
    if (!reviewerQueue.some((item) => item.attempt_id === created.id)) {
      throw new Error("A friend's pending attempt was missing from the review queue.");
    }
    const outsiderQueue = await request(`${baseUrl}/rest/v1/rpc/list_peer_review_attempts`, {
      method: "POST",
      headers: outsider.headers,
      body: "{}",
    });
    if (outsiderQueue.some((item) => item.attempt_id === created.id)) {
      throw new Error("A pending attempt leaked into an unrelated user's review queue.");
    }
    if (evidencePath) {
      await request(`${baseUrl}/storage/v1/object/attempt-videos/${evidencePath}`, {
        headers: reviewer.headers,
      });
      await request(`${baseUrl}/storage/v1/object/attempt-videos/${evidencePath}`, {
        headers: outsider.headers,
        expected: [400, 401, 403, 404],
      });
      const proxiedVideo = await fetch(`${appUrl}/api/attempt-videos/${evidencePath}`, {
        headers: { Cookie: reviewer.cookie, Range: "bytes=0-5" },
      });
      if (![200, 206].includes(proxiedVideo.status) || !(await proxiedVideo.arrayBuffer()).byteLength) {
        throw new Error(`The same-origin friend video proxy failed (${proxiedVideo.status}).`);
      }
      const hiddenVideo = await fetch(`${appUrl}/api/attempt-videos/${evidencePath}`, {
        headers: { Cookie: outsider.cookie },
      });
      if (hiddenVideo.status !== 403) {
        throw new Error(`The video proxy exposed evidence to a non-friend (${hiddenVideo.status}).`);
      }
      const anonymousVideo = await fetch(`${appUrl}/api/attempt-videos/${evidencePath}`);
      if (anonymousVideo.status !== 401) {
        throw new Error(`The video proxy exposed evidence without a session (${anonymousVideo.status}).`);
      }
    }
    await request(`${baseUrl}/rest/v1/rpc/review_attempt`, {
      method: "POST",
      headers: outsider.headers,
      body: JSON.stringify({ attempt: created.id, approve: true }),
      expected: [400, 401, 403],
    });
    await request(`${baseUrl}/rest/v1/rpc/review_attempt`, {
      method: "POST",
      headers: actor.headers,
      body: JSON.stringify({ attempt: created.id, approve: true }),
      expected: [400, 401, 403],
    });
    const reviewed = await request(`${baseUrl}/rest/v1/rpc/review_attempt`, {
      method: "POST",
      headers: reviewer.headers,
      body: JSON.stringify({ attempt: created.id, approve: true }),
    });
    if (reviewed.status !== "approved" || reviewed.reviewed_by !== reviewer.id) {
      throw new Error("A peer reviewer did not approve the submitted attempt.");
    }
    return reviewed;
  }

  const globalAttempt = await approveAttempt(owner, observer, { withEvidence: true });
  const clanAttempt = await approveAttempt(observer, owner, { selectedClan: clanId });
  const globalBoard = await request(`${baseUrl}/rest/v1/rpc/get_leaderboard`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ category: categories[0].id, clan: null, friends_only: false }),
  });
  const clanBoard = await request(`${baseUrl}/rest/v1/rpc/get_leaderboard`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ category: categories[0].id, clan: clanId, friends_only: false }),
  });
  const friendsBoard = await request(`${baseUrl}/rest/v1/rpc/get_leaderboard`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ category: categories[0].id, clan: null, friends_only: true }),
  });
  if (!globalBoard.some((entry) => entry.attempt_id === globalAttempt.id)) {
    throw new Error("A Global attempt was missing from the Global leaderboard.");
  }
  if (!globalBoard.some((entry) => entry.attempt_id === clanAttempt.id)) {
    throw new Error("A clan attempt was missing from the Global leaderboard.");
  }
  if (!clanBoard.some((entry) => entry.attempt_id === clanAttempt.id)) {
    throw new Error("A clan attempt was missing from its selected clan leaderboard.");
  }
  if (clanBoard.some((entry) => entry.attempt_id === globalAttempt.id)) {
    throw new Error("A Global attempt leaked onto a clan leaderboard.");
  }
  if (!friendsBoard.some((entry) => entry.attempt_id === globalAttempt.id)) {
    throw new Error("The current user's attempt was missing from the Friends leaderboard.");
  }
  if (!friendsBoard.some((entry) => entry.attempt_id === clanAttempt.id)) {
    throw new Error("An accepted friend's attempt was missing from the Friends leaderboard.");
  }

  const declinedFriendshipId = await request(`${baseUrl}/rest/v1/rpc/request_friend`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ target_username: outsider.username }),
  });
  await request(`${baseUrl}/rest/v1/rpc/respond_friend_request`, {
    method: "POST",
    headers: outsider.headers,
    body: JSON.stringify({ friendship: declinedFriendshipId, accept: false }),
  });
  const declinedRelationships = await request(`${baseUrl}/rest/v1/rpc/list_friendships`, {
    method: "POST",
    headers: owner.headers,
    body: "{}",
  });
  if (declinedRelationships.some((item) => item.friendship_id === declinedFriendshipId)) {
    throw new Error("A declined friend request was not removed.");
  }

  const guestRequests = await request(`${baseUrl}/rest/v1/rpc/request_guest_access`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ target_username: observer.username }),
  });
  const guestRequest = guestRequests[0];
  if (!guestRequest?.request_id) throw new Error("A guest request was not created.");
  const otp = await request(`${baseUrl}/rest/v1/rpc/issue_guest_otp`, {
    method: "POST",
    headers: observer.headers,
    body: JSON.stringify({ request: guestRequest.request_id }),
  });
  const redemptionRows = await request(`${baseUrl}/rest/v1/rpc/redeem_guest_access`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ request: guestRequest.request_id, otp }),
  });
  if (!redemptionRows[0]?.success || redemptionRows[0].player_id !== observer.id) {
    throw new Error("The target-approved guest code was not redeemed.");
  }

  const timerPlayers = await request(`${baseUrl}/rest/v1/rpc/get_timer_players`, {
    method: "POST",
    headers: owner.headers,
    body: "{}",
  });
  if (!timerPlayers.some((player) => player.player_id === observer.id)) {
    throw new Error("An authorized guest was missing from the timer player list.");
  }

  await requestAndAcceptFriend(observer, outsider);

  const correctionAttempt = await request(`${baseUrl}/rest/v1/rpc/start_attempt`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ category: categories[0].id, clan: null, player: owner.id }),
  });
  additionalAttemptIds.add(correctionAttempt.id);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await request(`${baseUrl}/rest/v1/rpc/stop_attempt`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ attempt: correctionAttempt.id }),
  });
  const reassigned = await request(`${baseUrl}/rest/v1/rpc/reassign_attempt`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ attempt: correctionAttempt.id, new_player: observer.id }),
  });
  if (reassigned.user_id !== observer.id || reassigned.recorded_by !== owner.id) {
    throw new Error("A stopped attempt was not reassigned without changing its recorder.");
  }
  await request(`${baseUrl}/rest/v1/rpc/confirm_attempt`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ attempt: correctionAttempt.id }),
  });
  await request(`${baseUrl}/rest/v1/rpc/review_attempt`, {
    method: "POST",
    headers: outsider.headers,
    body: JSON.stringify({ attempt: correctionAttempt.id, approve: true }),
  });

  await request(`${baseUrl}/rest/v1/rpc/revoke_guest_access`, {
    method: "POST",
    headers: observer.headers,
    body: JSON.stringify({ other_user: owner.id, access_direction: "operator" }),
  });
  await request(`${baseUrl}/rest/v1/rpc/start_attempt`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ category: categories[0].id, clan: null, player: observer.id }),
    expected: [400, 401, 403],
  });

  const regeneratedCode = await request(`${baseUrl}/rest/v1/rpc/regenerate_clan_code`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ clan: clanId }),
  });
  if (regeneratedCode === clan.invite_code) throw new Error("Clan invitation regeneration returned the old code.");
  await request(`${baseUrl}/rest/v1/rpc/join_clan`, {
    method: "POST",
    headers: outsider.headers,
    body: JSON.stringify({ invite_code: clan.invite_code }),
    expected: [400, 404, 500],
  });
  await request(`${baseUrl}/rest/v1/rpc/join_clan`, {
    method: "POST",
    headers: outsider.headers,
    body: JSON.stringify({ invite_code: regeneratedCode }),
  });

  await request(`${baseUrl}/rest/v1/clans?id=eq.${clanId}`, {
    method: "DELETE",
    headers: owner.headers,
    expected: [204],
  });
  clanId = undefined;

  avatarPath = `${owner.id}/docker-smoke.png`;
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await request(`${baseUrl}/storage/v1/object/avatars/${avatarPath}`, {
    method: "POST",
    headers: { ...owner.headers, "Content-Type": "image/png", "x-upsert": "true" },
    body: pixel,
  });
  await request(`${baseUrl}/storage/v1/object/public/avatars/${avatarPath}`);
  await request(`${baseUrl}/storage/v1/object/avatars/${avatarPath}`, {
    method: "POST",
    headers: { ...observer.headers, "Content-Type": "image/png", "x-upsert": "true" },
    body: pixel,
    expected: [400, 401, 403],
  });
  await request(`${baseUrl}/storage/v1/object/avatars`, {
    method: "DELETE",
    headers: owner.headers,
    body: JSON.stringify({ prefixes: [avatarPath] }),
  });
  avatarPath = undefined;
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  async function cleanup(operation) {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (avatarPath) {
    await cleanup(() =>
      request(`${baseUrl}/storage/v1/object/avatars`, {
        method: "DELETE",
        headers: serviceHeaders,
        body: JSON.stringify({ prefixes: [avatarPath] }),
      }),
    );
  }
  if (evidencePaths.length) {
    await cleanup(() =>
      request(`${baseUrl}/storage/v1/object/attempt-videos`, {
        method: "DELETE",
        headers: serviceHeaders,
        body: JSON.stringify({ prefixes: evidencePaths }),
      }),
    );
  }
  if (clanId) {
    await cleanup(() =>
      request(`${baseUrl}/rest/v1/clans?id=eq.${clanId}`, {
        method: "DELETE",
        headers: serviceHeaders,
        expected: [204],
      }),
    );
  }
  if (attemptId) {
    await cleanup(() =>
      request(`${baseUrl}/rest/v1/attempts?id=eq.${attemptId}`, {
        method: "DELETE",
        headers: serviceHeaders,
        expected: [204],
      }),
    );
  }
  for (const additionalAttemptId of additionalAttemptIds) {
    await cleanup(() =>
      request(`${baseUrl}/rest/v1/attempts?id=eq.${additionalAttemptId}`, {
        method: "DELETE",
        headers: serviceHeaders,
        expected: [204],
      }),
    );
  }
  for (const userId of temporaryUserIds.reverse()) {
    await cleanup(() =>
      request(`${baseUrl}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: serviceHeaders,
        expected: [200, 204],
      }),
    );
  }
  if (failure || cleanupErrors.length) {
    throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], "Docker smoke test failed.");
  }
}

console.log("Smoke test passed: app, Auth, scoped timers, friends, reviews, guests, clans, RLS, and Storage.");
