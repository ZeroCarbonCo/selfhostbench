import { json } from "../../lib/shared.js";

// Private totals for the smoke-test pass/fail check. GET /api/stats?token=<STATS_TOKEN>
// "public" counts exclude the maintainer's own runs (submitted with the X-SHB-Owner header).
// Cloudflare Web Analytics (visits, top referrers) since launch, read with a long-lived API token that has only
// "Account Analytics: Read" (Pages secrets CF_ANALYTICS_TOKEN and CF_ACCOUNT_ID). Visits include the owner's own.
const LAUNCH = "2026-11-07T11:00:00Z"; // 2026-11-08 00:00 Pacific/Auckland
const HOST = "selfhostbench.pages.dev";

async function webAnalytics(env) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return { available: false, reason: "CF_ANALYTICS_TOKEN not set" };
  const filter = "{datetime_geq: $start, datetime_leq: $end, requestHost: $host}";
  const query = `query($account: String!, $start: Time!, $end: Time!, $host: String!) { viewer { accounts(filter: {accountTag: $account}) {
    total: rumPageloadEventsAdaptiveGroups(limit: 1, filter: ${filter}) { count sum { visits } }
    referrers: rumPageloadEventsAdaptiveGroups(limit: 10, orderBy: [sum_visits_DESC], filter: ${filter}) { sum { visits } dimensions { refererHost } }
    days: rumPageloadEventsAdaptiveGroups(limit: 60, orderBy: [date_ASC], filter: ${filter}) { sum { visits } dimensions { date } }
  } } }`;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { account: env.CF_ACCOUNT_ID, start: LAUNCH, end: new Date().toISOString(), host: HOST } }),
    });
    const body = await r.json();
    if (body.errors?.length || !body.data) return { available: false, reason: (body.errors?.[0]?.message || `HTTP ${r.status}`).slice(0, 200) };
    const a = body.data.viewer.accounts[0] || {};
    const visits = a.total?.[0]?.sum.visits ?? 0;
    return {
      available: true,
      since: LAUNCH,
      visits,
      page_views: a.total?.[0]?.count ?? 0,
      top_referrers: (a.referrers || []).map((g) => ({
        host: g.dimensions.refererHost || "(direct / none)",
        visits: g.sum.visits,
        pct: visits ? Math.round((100 * g.sum.visits) / visits) : 0,
      })),
      by_day: (a.days || []).map((g) => ({ day: g.dimensions.date, visits: g.sum.visits })),
    };
  } catch (e) {
    return { available: false, reason: String(e).slice(0, 200) };
  }
}

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");
  if (!env.STATS_TOKEN || token !== env.STATS_TOKEN) return json({ error: "forbidden" }, 403);
  const one = (sql) => env.DB.prepare(sql).first();
  const all = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
  const [subs, owner, devices, emails, unsub, flagged, subsByDay, emailsByDay, recentEmails, web] = await Promise.all([
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
    webAnalytics(env),
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
    web_analytics: web,
  }, 200, { "Cache-Control": "no-store" });
}
