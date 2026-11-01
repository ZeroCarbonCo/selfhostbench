import {
  json, ipHash, rateLimit, deviceKey, median, isOwner, validateSubmission, PRIMARY_METRIC, OUTLIER_FACTOR,
} from "../../lib/shared.js";

const MAX_BYTES = 64 * 1024;
const PER_DAY = 10;

export async function onRequestPost({ request, env }) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BYTES) return json({ error: "submission larger than 64 KB" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json({ error: "submission larger than 64 KB" }, 413);
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return json({ error: "body is not valid JSON" }, 400);
  }
  const errors = validateSubmission(doc);
  if (errors.length) return json({ error: "submission failed validation", details: errors.slice(0, 20) }, 422);

  const hash = await ipHash(request, env);
  if (!(await rateLimit(env, hash, "submit", PER_DAY))) {
    return json({ error: `rate limit: at most ${PER_DAY} submissions per day` }, 429);
  }
  const dup = await env.DB.prepare("SELECT id FROM submissions WHERE id = ?1").bind(doc.run_id).first();
  if (dup) return json({ id: dup.id, url: `${new URL(request.url).origin}/r?id=${dup.id}`, duplicate: true });

  const now = new Date().toISOString();
  const hw = doc.hardware;
  const key = deviceKey(hw);
  const id = doc.run_id;
  const stmts = [
    env.DB.prepare(
      "INSERT INTO submissions (id, created_at, ip_hash, is_owner, schema_version, script_version, device_key, " +
        "device_label, cpu_short, virtualization, doc) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    ).bind(id, now, hash, isOwner(request, env) ? 1 : 0, doc.schema_version, doc.script_version, key,
      hw.device_label, hw.cpu_short, hw.virtualization, JSON.stringify(doc)),
  ];
  for (const t of doc.tests) {
    if (t.status !== "ok") continue;
    const metric = PRIMARY_METRIC[t.test];
    const value = t.metrics[metric];
    // Outlier flag: more than 3x away from this device model's current median for the same test.
    const prev = await env.DB.prepare(
      "SELECT value FROM results WHERE device_key = ?1 AND app = ?2 AND test = ?3 AND accel = ?4 AND flagged = 0",
    ).bind(key, t.app, t.test, t.accel).all();
    const values = prev.results.map((r) => r.value);
    let flagged = 0;
    if (values.length >= 2) {
      const m = median(values);
      if (m > 0 && (value > m * OUTLIER_FACTOR || value < m / OUTLIER_FACTOR)) flagged = 1;
    }
    stmts.push(env.DB.prepare(
      "INSERT INTO results (submission_id, created_at, device_key, app, test, accel, metric, value, flagged) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    ).bind(id, now, key, t.app, t.test, t.accel, metric, value, flagged));
  }
  await env.DB.batch(stmts);
  const origin = new URL(request.url).origin;
  return json({ id, url: `${origin}/r?id=${id}`, device_url: `${origin}/device?d=${key}` }, 201);
}
