import { json } from "../../lib/shared.js";

// Private totals for the smoke-test pass/fail check. GET /api/stats?token=<STATS_TOKEN>
// "public" counts exclude the maintainer's own runs (submitted with the X-SHB-Owner header).
export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");
  if (!env.STATS_TOKEN || token !== env.STATS_TOKEN) return json({ error: "forbidden" }, 403);
  const one = (sql) => env.DB.prepare(sql).first();
  const all = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
  const [subs, owner, devices, emails, unsub, flagged, subsByDay, emailsByDay, recentEmails] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM submissions WHERE is_owner = 0"),
    one("SELECT COUNT(*) AS n FROM submissions WHERE is_owner = 1"),
    one("SELECT COUNT(DISTINCT device_key) AS n FROM submissions WHERE is_owner = 0"),
    one("SELECT COUNT(*) AS n FROM subscribers WHERE unsubscribed_at IS NULL"),
    one("SELECT COUNT(*) AS n FROM subscribers WHERE unsubscribed_at IS NOT NULL"),
    one("SELECT COUNT(*) AS n FROM results WHERE flagged = 1"),
    all("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS submissions, SUM(is_owner) AS owner_runs " +
      "FROM submissions GROUP BY day ORDER BY day"),
    all("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS emails FROM subscribers GROUP BY day ORDER BY day"),
    all("SELECT created_at, device, apps FROM subscribers ORDER BY created_at DESC LIMIT 20"),
  ]);
  return json({
    generated_at: new Date().toISOString(),
    pass_criteria: { submissions: 300, emails: 10, days: 21 },
    submissions: subs.n,
    owner_test_runs_excluded: owner.n,
    unique_devices: devices.n,
    emails: emails.n,
    unsubscribed: unsub.n,
    flagged_results: flagged.n,
    by_day: { submissions: subsByDay, emails: emailsByDay },
    recent_signups: recentEmails,
  }, 200, { "Cache-Control": "no-store" });
}
