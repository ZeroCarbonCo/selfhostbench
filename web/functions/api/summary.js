import { json } from "../../lib/shared.js";
import { LAUNCH, webAnalytics } from "../../lib/analytics.js";

// Public, counts-only progress of the smoke test (no emails, devices or anything per person). GET /api/summary
// Used by the scheduled Notion metrics routine. Cached for 10 minutes so the Analytics API isn't hit per request.
export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const key = new Request(new URL("/api/summary", request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const one = (sql) => env.DB.prepare(sql).first().then((r) => r.n);
  const [submissions, devices, emails, flagged, web] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM submissions WHERE is_owner = 0"),
    one("SELECT COUNT(DISTINCT device_key) AS n FROM submissions WHERE is_owner = 0"),
    one("SELECT COUNT(*) AS n FROM subscribers WHERE unsubscribed_at IS NULL"),
    one("SELECT COUNT(*) AS n FROM results WHERE flagged = 1"),
    webAnalytics(env),
  ]);
  const res = json({
    generated_at: new Date().toISOString(),
    launch: LAUNCH,
    days_since_launch: Math.floor((Date.now() - Date.parse(LAUNCH)) / 864e5),
    pass_criteria: { submissions: 300, emails: 10, days: 21, kill_if_visits_below: 200 },
    submissions, // excludes the maintainer's own test runs
    unique_devices: devices,
    emails, // count only
    flagged_results: flagged,
    web_analytics: web.available
      ? { available: true, since: web.since, visits: web.visits, page_views: web.page_views, top_referrers: web.top_referrers, by_day: web.by_day }
      : { available: false, reason: web.reason },
  }, 200, { "Cache-Control": "public, max-age=600" });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
