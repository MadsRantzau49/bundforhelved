import { createHash, createHmac, randomBytes } from "node:crypto";

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
  return { id: user.id, username, headers: userHeaders(token.access_token) };
}

try {
  const appHtml = await request(`${appUrl}/login`);
  if (!appHtml.includes("bund forhelved")) throw new Error("The Next.js login page did not render.");

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

  const owner = await createTemporaryUser();
  const observer = await createTemporaryUser();
  const outsider = await createTemporaryUser();
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
  const hiddenClans = await request(`${baseUrl}/rest/v1/clans?id=eq.${clanId}&select=id`, {
    headers: observer.headers,
  });
  if (hiddenClans.length !== 0) throw new Error("RLS exposed a clan to a non-member.");

  await request(`${baseUrl}/rest/v1/rpc/join_clan`, {
    method: "POST",
    headers: observer.headers,
    body: JSON.stringify({ invite_code: clan.invite_code }),
  });

  async function approveAttempt(actor, { player = actor.id, selectedClan = null } = {}) {
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
    return request(`${baseUrl}/rest/v1/rpc/confirm_attempt`, {
      method: "POST",
      headers: actor.headers,
      body: JSON.stringify({ attempt: created.id }),
    });
  }

  const globalAttempt = await approveAttempt(owner);
  const clanAttempt = await approveAttempt(owner, { selectedClan: clanId });
  const globalBoard = await request(`${baseUrl}/rest/v1/rpc/get_leaderboard`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ category: categories[0].id, clan: null }),
  });
  const clanBoard = await request(`${baseUrl}/rest/v1/rpc/get_leaderboard`, {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ category: categories[0].id, clan: clanId }),
  });
  if (!globalBoard.some((entry) => entry.attempt_id === globalAttempt.id)) {
    throw new Error("A Global attempt was missing from the Global leaderboard.");
  }
  if (globalBoard.some((entry) => entry.attempt_id === clanAttempt.id)) {
    throw new Error("A clan attempt leaked onto the Global leaderboard.");
  }
  if (!clanBoard.some((entry) => entry.attempt_id === clanAttempt.id)) {
    throw new Error("A clan attempt was missing from its selected clan leaderboard.");
  }
  if (clanBoard.some((entry) => entry.attempt_id === globalAttempt.id)) {
    throw new Error("A Global attempt leaked onto a clan leaderboard.");
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

console.log("Smoke test passed: app, Auth, scoped timers, guests, clans, RLS, and Storage.");
