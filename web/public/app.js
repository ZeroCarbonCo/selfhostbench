// SelfHostBench site script: renders results from /api/results and handles the signup form.
const TESTS = {
  "ollama|generate": { label: "Ollama · chat generation (Llama 3.2 3B)", unit: "tokens/s" },
  "jellyfin|transcode_4k_1080p": { label: "Jellyfin · 4K → 1080p transcode", unit: "fps" },
  "jellyfin|concurrent_streams": { label: "Jellyfin · simultaneous 4K → 1080p streams at ≥1× real time", unit: "streams" },
  "immich|clip_embeddings": { label: "Immich ML · smart-search (CLIP)", unit: "images/s" },
  "immich|face_detection": { label: "Immich ML · face detection", unit: "images/s" },
};
const ACCEL = { cpu: "CPU", nvidia: "NVIDIA GPU", nvenc: "NVIDIA NVENC", vaapi: "VA-API (iGPU)", qsv: "Intel QSV", none: "—" };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const testLabel = (r) => (TESTS[`${r.app}|${r.test}`] || { label: `${r.app} · ${r.test}` }).label;
const unit = (r) => (TESTS[`${r.app}|${r.test}`] || { unit: r.metric }).unit;
const virtTag = (v) => (v && v !== "none" ? ` <span class="tag" title="Run inside ${esc(v)}; numbers may be lower than bare metal">${v === "wsl" ? "WSL2" : "VM"}</span>` : "");

async function getResults(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`/api/results${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
}

function resultsTable(rows, { showDevice = true } = {}) {
  if (!rows.length) return `<p class="note">No results yet.</p>`;
  const head = `<tr>${showDevice ? "<th>Device</th>" : ""}<th>Test</th><th>Accel</th><th>Median</th><th>Runs</th></tr>`;
  const body = rows.map((r) => `<tr>
    ${showDevice ? `<td><a href="/device?d=${encodeURIComponent(r.device_key)}">${esc(r.device_label)}</a>${virtTag(r.virtualization)}<br><span class="note">${esc(r.cpu)}</span></td>` : ""}
    <td>${esc(testLabel(r))}</td>
    <td>${esc(ACCEL[r.accel] || r.accel)}</td>
    <td class="num"><strong>${esc(r.median)}</strong> ${esc(unit(r))}</td>
    <td class="num" title="Number of submissions behind this figure">${r.count}</td></tr>`).join("");
  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

const order = (a, b) => Object.keys(TESTS).indexOf(`${a.app}|${a.test}`) - Object.keys(TESTS).indexOf(`${b.app}|${b.test}`)
  || a.device_label.localeCompare(b.device_label) || a.accel.localeCompare(b.accel);

async function homePage() {
  const el = $("#latest");
  try {
    const data = await getResults();
    if (!data.latest.length) {
      el.innerHTML = `<p class="note">No submissions yet. Yours could be the first.</p>`;
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Submitted</th><th>Device</th><th></th></tr></thead><tbody>${
      data.latest.map((s) => `<tr><td class="num">${esc(s.created_at.slice(0, 10))}</td>
        <td><a href="/device?d=${encodeURIComponent(s.device_key)}">${esc(s.device_label)}</a>${virtTag(s.virtualization)}
        <br><span class="note">${esc(s.cpu_short)}</span></td>
        <td><a href="/r?id=${esc(s.id)}">full result</a></td></tr>`).join("")
    }</tbody></table></div>`;
  } catch (e) {
    el.innerHTML = `<p class="warn">Could not load results (${esc(e.message)}).</p>`;
  }
}

async function resultsPage() {
  const el = $("#results");
  let data;
  try {
    data = await getResults();
  } catch (e) {
    el.innerHTML = `<p class="warn">Could not load results (${esc(e.message)}).</p>`;
    return;
  }
  const appSel = $("#f-app");
  const testSel = $("#f-test");
  const keys = [...new Set(data.results.map((r) => `${r.app}|${r.test}`))].sort((a, b) => Object.keys(TESTS).indexOf(a) - Object.keys(TESTS).indexOf(b));
  testSel.innerHTML = `<option value="">All tests</option>` + keys.map((k) => `<option value="${esc(k)}">${esc((TESTS[k] || { label: k }).label)}</option>`).join("");
  const params = new URLSearchParams(location.search);
  appSel.value = params.get("app") || "";
  testSel.value = params.get("test") || "";
  const render = () => {
    const rows = data.results
      .filter((r) => !appSel.value || r.app === appSel.value)
      .filter((r) => !testSel.value || `${r.app}|${r.test}` === testSel.value)
      .sort(order);
    el.innerHTML = resultsTable(rows);
    const q = new URLSearchParams();
    if (appSel.value) q.set("app", appSel.value);
    if (testSel.value) q.set("test", testSel.value);
    history.replaceState(null, "", q.toString() ? `?${q}` : location.pathname);
  };
  appSel.onchange = testSel.onchange = render;
  render();
}

async function devicePage() {
  const key = new URLSearchParams(location.search).get("d");
  const el = $("#device");
  if (!key) {
    el.innerHTML = `<p>No device given. <a href="/results">Browse all results</a>.</p>`;
    return;
  }
  try {
    const data = await getResults({ device: key });
    if (!data.results.length && !data.latest.length) {
      el.innerHTML = `<p>No results for this device yet.</p>`;
      return;
    }
    const d = data.results[0] || { device_label: data.latest[0].device_label, cpu: data.latest[0].cpu_short, virtualization: data.latest[0].virtualization };
    document.title = `${d.device_label} · SelfHostBench`;
    $("#device-name").innerHTML = esc(d.device_label) + virtTag(d.virtualization);
    el.innerHTML = `<p class="note">${esc(d.cpu)} · ${data.latest.length} submission(s)</p>` +
      resultsTable(data.results.sort(order), { showDevice: false }) +
      `<h2>Submissions</h2><ul>${data.latest.map((s) => `<li><a href="/r?id=${esc(s.id)}">${esc(s.created_at.slice(0, 16).replace("T", " "))} UTC</a></li>`).join("")}</ul>`;
    const dev = $("#signup-device");
    if (dev) dev.value = d.device_label;
  } catch (e) {
    el.innerHTML = `<p class="warn">Could not load results (${esc(e.message)}).</p>`;
  }
}

async function resultPage() {
  const id = new URLSearchParams(location.search).get("id");
  const el = $("#result");
  try {
    const r = await fetch(`/api/result?id=${encodeURIComponent(id || "")}`);
    if (!r.ok) throw new Error(r.status === 404 ? "not found" : `API error ${r.status}`);
    const { doc, created_at, device_key, flags } = await r.json();
    const hw = doc.hardware;
    const flagged = new Set(flags.filter((f) => f.flagged).map((f) => `${f.app}|${f.test}|${f.accel}`));
    const rows = doc.tests.map((t) => {
      const k = `${t.app}|${t.test}`;
      const m = t.metrics || {};
      const main = t.status !== "ok" ? `<span class="warn">${esc(t.status)}</span> ${esc(t.reason || "")}`
        : `<strong>${esc(m.tokens_per_s ?? m.fps ?? m.streams ?? m.images_per_s)}</strong> ${esc((TESTS[k] || {}).unit || "")}`;
      const res = t.resources || {};
      return `<tr><td>${esc(testLabel(t))}${flagged.has(`${k}|${t.accel}`) ? ' <span class="tag warn">flagged outlier</span>' : ""}</td>
        <td>${esc(ACCEL[t.accel] || t.accel)}</td><td class="num">${main}</td>
        <td class="num">${res.cpu_pct_peak ?? "—"}% / ${res.mem_mb_peak ?? "—"} MB${res.power_w_mean != null ? ` / ${res.power_w_mean} W` : ""}</td></tr>`;
    }).join("");
    el.innerHTML = `<p class="note">Submitted ${esc(created_at.slice(0, 16).replace("T", " "))} UTC · script ${esc(doc.script_version)} ·
      <a href="/device?d=${encodeURIComponent(device_key)}">all results for this device</a></p>
      <dl class="kv">
        <dt>Device</dt><dd>${esc(hw.device_label)}${virtTag(hw.virtualization)}</dd>
        <dt>CPU</dt><dd>${esc(hw.cpu_model)} (${hw.cpu_cores} cores / ${hw.cpu_threads} threads)</dd>
        <dt>RAM</dt><dd>${esc(hw.ram_gb)} GB</dd>
        <dt>GPU</dt><dd>${esc(hw.gpus.join(", ") || "none detected")}${hw.dri_render_nodes ? ` · ${hw.dri_render_nodes} /dev/dri render node(s)` : ""}</dd>
        <dt>OS</dt><dd>${esc(hw.os)} · kernel ${esc(hw.kernel)} · ${esc(hw.arch)}</dd>
        <dt>Docker</dt><dd>${esc(hw.docker_version)} (${esc(hw.docker_os)})</dd>
        <dt>CPU power</dt><dd>${esc(hw.power_source)}</dd>
      </dl>
      <h2>Tests</h2>
      <div class="table-wrap"><table><thead><tr><th>Test</th><th>Accel</th><th>Result</th><th>Peak CPU / RAM${""}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Peak CPU is per container; 100% = one CPU thread busy.</p>
      <details><summary>Raw JSON as submitted</summary><pre><code>${esc(JSON.stringify(doc, null, 2))}</code></pre></details>`;
  } catch (e) {
    el.innerHTML = `<p class="warn">Could not load this result (${esc(e.message)}).</p>`;
  }
}

function signupForm() {
  const form = $("form.signup");
  if (!form) return;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = form.querySelector(".msg");
    const fd = new FormData(form);
    const body = { email: fd.get("email"), device: fd.get("device") || "", apps: fd.getAll("apps") };
    msg.textContent = "Sending…";
    try {
      const r = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `error ${r.status}`);
      form.reset();
      msg.innerHTML = `Thanks — you're on the list. To unsubscribe at any time, use <a href="${esc(data.unsubscribe_url)}">this link</a> (save it).`;
    } catch (e) {
      msg.innerHTML = `<span class="warn">${esc(e.message)}</span>`;
    }
  });
}

const page = document.body.dataset.page;
({ home: homePage, results: resultsPage, device: devicePage, result: resultPage }[page] || (() => {}))();
signupForm();
