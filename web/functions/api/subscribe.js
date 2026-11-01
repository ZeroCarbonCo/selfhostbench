import { json, ipHash, rateLimit } from "../../lib/shared.js";

const APPS = ["ollama", "jellyfin", "immich"];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i;

export async function onRequestPost({ request, env }) {
  if (Number(request.headers.get("Content-Length") || 0) > 4096) return json({ error: "too large" }, 413);
  let body;
  try {
    const type = request.headers.get("Content-Type") || "";
    body = type.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
  } catch {
    return json({ error: "could not read the form" }, 400);
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return json({ error: "please enter a valid email address" }, 422);
  const device = String(body.device || "").trim().slice(0, 100) || null;
  const apps = (Array.isArray(body.apps) ? body.apps : String(body.apps || "").split(","))
    .map((a) => String(a).trim()).filter((a) => APPS.includes(a));

  const hash = await ipHash(request, env);
  if (!(await rateLimit(env, hash, "subscribe", 5))) return json({ error: "too many signups today from here" }, 429);

  const token = crypto.randomUUID().replace(/-/g, "");
  const existing = await env.DB.prepare("SELECT unsubscribe_token FROM subscribers WHERE email = ?1").bind(email).first();
  if (existing) {
    await env.DB.prepare("UPDATE subscribers SET device = ?2, apps = ?3, unsubscribed_at = NULL WHERE email = ?1")
      .bind(email, device, apps.join(",")).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO subscribers (email, device, apps, created_at, ip_hash, unsubscribe_token) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    ).bind(email, device, apps.join(","), new Date().toISOString(), hash, token).run();
  }
  const t = existing ? existing.unsubscribe_token : token;
  return json({ ok: true, unsubscribe_url: `${new URL(request.url).origin}/api/unsubscribe?token=${t}` }, 201);
}
