import { json } from "../../lib/shared.js";

// One submission, exactly as submitted (it contains no personal data by design).
export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f]{12}$/.test(id)) return json({ error: "bad id" }, 400);
  const row = await env.DB.prepare("SELECT created_at, device_key, doc FROM submissions WHERE id = ?1").bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  const flags = await env.DB.prepare("SELECT app, test, accel, flagged FROM results WHERE submission_id = ?1")
    .bind(id).all();
  return json({ id, created_at: row.created_at, device_key: row.device_key, flags: flags.results, doc: JSON.parse(row.doc) });
}
