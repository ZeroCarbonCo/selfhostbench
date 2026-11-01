export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token") || "";
  let msg = "That unsubscribe link is not valid.";
  if (/^[0-9a-f]{32}$/.test(token)) {
    const r = await env.DB.prepare(
      "UPDATE subscribers SET unsubscribed_at = ?2 WHERE unsubscribe_token = ?1 AND unsubscribed_at IS NULL",
    ).bind(token, new Date().toISOString()).run();
    msg = r.meta.changes ? "You are unsubscribed. We will not email you." : "You were already unsubscribed.";
  }
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>Unsubscribe · SelfHostBench</title><link rel="stylesheet" href="/style.css">` +
      `<main class="wrap"><h1>SelfHostBench</h1><p>${msg}</p><p><a href="/">Back to the site</a></p></main>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
