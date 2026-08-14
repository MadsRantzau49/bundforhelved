import { createHash, createHmac } from "node:crypto";

const supabaseUrl = process.env.SUPABASE_INTERNAL_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pepper = process.env.AUTH_PASSWORD_PEPPER;
const username = (process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin").trim().toLowerCase();
const rawPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "123";
const resetPassword = process.env.BOOTSTRAP_RESET_PASSWORD === "true";

if (!supabaseUrl || !serviceRoleKey || !pepper) {
  throw new Error("Bootstrap environment is incomplete.");
}
if (!/^[a-z0-9_]{3,24}$/.test(username)) {
  throw new Error("BOOTSTRAP_ADMIN_USERNAME must match [a-z0-9_]{3,24}.");
}
if (rawPassword.length < 1 || rawPassword.length > 64) {
  throw new Error("BOOTSTRAP_ADMIN_PASSWORD must contain 1-64 characters.");
}

const identity = createHash("sha256").update(username).digest("hex");
const email = `${identity}@users.bundforhelved.invalid`;
const password = createHmac("sha256", pepper).update(rawPassword).digest("base64url");
const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

async function request(path, { retries = 0, ...options } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${supabaseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    const body = await response.text();
    if (response.ok) return body ? JSON.parse(body) : null;
    if (attempt >= retries) {
      throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${body}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const listed = await request("/auth/v1/admin/users?page=1&per_page=1000");
let user = listed.users?.find((candidate) => candidate.email === email);

if (!user) {
  user = await request("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
      app_metadata: { managed_account: true },
    }),
  });
} else if (resetPassword) {
  user = await request(`/auth/v1/admin/users/${user.id}`, {
    method: "PUT",
    body: JSON.stringify({ password }),
  });
}

const updatedProfiles = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
  method: "PATCH",
  retries: 30,
  headers: { Prefer: "return=representation" },
  body: JSON.stringify({ role: "admin" }),
});

if (!Array.isArray(updatedProfiles) || updatedProfiles.length !== 1) {
  throw new Error("The admin Auth user exists, but its application profile is missing.");
}

console.log(`Local admin is ready: ${username}`);
