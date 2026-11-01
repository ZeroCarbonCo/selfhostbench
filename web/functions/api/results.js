import { json, median, MIN_SUBMISSIONS } from "../../lib/shared.js";

// Aggregated results: median and count per app x test x accelerator x device model.
// Flagged outliers are excluded. Optional filters: ?device=<key>&app=<app>
export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const where = ["r.flagged = 0"];
  const binds = [];
  if (q.get("device")) {
    binds.push(q.get("device"));
    where.push(`r.device_key = ?${binds.length}`);
  }
  if (q.get("app")) {
    binds.push(q.get("app"));
    where.push(`r.app = ?${binds.length}`);
  }
  const rows = await env.DB.prepare(
    "SELECT r.app, r.test, r.accel, r.metric, r.value, r.device_key, s.device_label, s.cpu_short, s.virtualization " +
      `FROM results r JOIN submissions s ON s.id = r.submission_id WHERE ${where.join(" AND ")}`,
  ).bind(...binds).all();

  const groups = new Map();
  for (const r of rows.results) {
    const k = [r.app, r.test, r.accel, r.device_key].join("|");
    if (!groups.has(k)) {
      groups.set(k, {
        app: r.app, test: r.test, accel: r.accel, metric: r.metric, device_key: r.device_key,
        device_label: r.device_label, cpu: r.cpu_short, virtualization: r.virtualization, values: [],
      });
    }
    groups.get(k).values.push(r.value);
  }
  const results = [...groups.values()]
    .filter((g) => g.values.length >= MIN_SUBMISSIONS)
    .map(({ values, ...g }) => ({ ...g, median: Math.round(median(values) * 100) / 100, count: values.length }));

  const latest = await env.DB.prepare(
    "SELECT id, created_at, device_key, device_label, cpu_short, virtualization FROM submissions " +
      (q.get("device") ? "WHERE device_key = ?1 " : "") + "ORDER BY created_at DESC LIMIT 10",
  ).bind(...(q.get("device") ? [q.get("device")] : [])).all();

  return json(
    { min_submissions: MIN_SUBMISSIONS, results, latest: latest.results },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
}
