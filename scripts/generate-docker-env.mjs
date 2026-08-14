import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.docker");
const generatedDirectory = path.join(root, "docker", "generated");
const kongTemplatePath = path.join(root, "docker", "kong.yml.template");
const kongConfigPath = path.join(generatedDirectory, "kong.yml");

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createApiKey(role, secret) {
  const now = Math.floor(Date.now() / 1000) - 60;
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    role,
    iss: "supabase",
    iat: now,
    exp: now + 20 * 365 * 24 * 60 * 60,
  });
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function parseEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

let values;
if (existsSync(envPath)) {
  values = parseEnv(await readFile(envPath, "utf8"));
} else {
  const jwtSecret = randomBytes(32).toString("hex");
  values = {
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:8000",
    NEXT_PUBLIC_APP_VERSION: `docker-${Date.now()}`,
    POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
    AUTH_DB_PASSWORD: randomBytes(24).toString("hex"),
    REST_DB_PASSWORD: randomBytes(24).toString("hex"),
    STORAGE_DB_PASSWORD: randomBytes(24).toString("hex"),
    POOLER_DB_PASSWORD: randomBytes(24).toString("hex"),
    JWT_SECRET: jwtSecret,
    ANON_KEY: createApiKey("anon", jwtSecret),
    SERVICE_ROLE_KEY: createApiKey("service_role", jwtSecret),
    AUTH_PASSWORD_PEPPER: randomBytes(32).toString("base64url"),
    S3_PROTOCOL_ACCESS_KEY_ID: randomBytes(16).toString("hex"),
    S3_PROTOCOL_ACCESS_KEY_SECRET: randomBytes(32).toString("hex"),
    BOOTSTRAP_ADMIN_USERNAME: "admin",
    BOOTSTRAP_ADMIN_PASSWORD: "123",
  };
  const contents = [
    "# Generated local secrets. Do not commit this file.",
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n");
  await writeFile(envPath, contents, { mode: 0o600 });
  console.log("Generated .env.docker with unique local keys.");
}

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "POSTGRES_PASSWORD",
  "AUTH_DB_PASSWORD",
  "REST_DB_PASSWORD",
  "STORAGE_DB_PASSWORD",
  "POOLER_DB_PASSWORD",
  "JWT_SECRET",
  "ANON_KEY",
  "SERVICE_ROLE_KEY",
  "AUTH_PASSWORD_PEPPER",
  "S3_PROTOCOL_ACCESS_KEY_ID",
  "S3_PROTOCOL_ACCESS_KEY_SECRET",
  "BOOTSTRAP_ADMIN_USERNAME",
  "BOOTSTRAP_ADMIN_PASSWORD",
];
const missing = required.filter((key) => !values[key]);
if (missing.length) {
  throw new Error(
    `Missing persisted values in .env.docker: ${missing.join(", ")}. Restore the file or run ./scripts/docker.sh reset.`,
  );
}

await chmod(envPath, 0o600);
await mkdir(generatedDirectory, { recursive: true, mode: 0o700 });
await chmod(generatedDirectory, 0o700);
const kongTemplate = await readFile(kongTemplatePath, "utf8");
const kongConfig = kongTemplate
  .replaceAll("__ANON_KEY__", values.ANON_KEY)
  .replaceAll("__SERVICE_ROLE_KEY__", values.SERVICE_ROLE_KEY);
await writeFile(kongConfigPath, kongConfig, { mode: 0o600 });
await chmod(kongConfigPath, 0o644);
