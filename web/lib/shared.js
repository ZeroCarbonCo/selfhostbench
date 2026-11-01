// Shared helpers for the SelfHostBench Pages Functions (API).

export const PRIMARY_METRIC = {
  generate: "tokens_per_s",
  transcode_4k_1080p: "fps",
  concurrent_streams: "streams",
  clip_embeddings: "images_per_s",
  face_detection: "images_per_s",
};
// Sanity bounds for the headline numbers; anything outside is rejected as implausible.
const BOUNDS = { tokens_per_s: 2000, fps: 5000, streams: 64, images_per_s: 5000 };

// Smoke test: publish a figure from 1 submission (labelled with its count).
// After launch, if volume allows, raise to 3 agreeing submissions.
export const MIN_SUBMISSIONS = 1;
export const OUTLIER_FACTOR = 3;

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export async function ipHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const data = new TextEncoder().encode(`${env.IP_SALT || "dev-salt"}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Increments today's counter for (ip, kind); returns false when over the limit.
export async function rateLimit(env, hash, kind, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    "INSERT INTO rate (ip_hash, kind, day, count) VALUES (?1, ?2, ?3, 1) " +
      "ON CONFLICT (ip_hash, kind, day) DO UPDATE SET count = count + 1 RETURNING count",
  ).bind(hash, kind, day).first();
  return row.count <= limit;
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

export function deviceKey(hw) {
  const label = hw.device_label;
  return slug(label.toLowerCase().includes(hw.cpu_short.toLowerCase()) ? label : `${label} ${hw.cpu_short}`);
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function isOwner(request, env) {
  const t = request.headers.get("X-SHB-Owner");
  return Boolean(t && env.STATS_TOKEN && t === env.STATS_TOKEN);
}

// ---------------------------------------------------------------- strict schema validation

const str = (max) => (v) => typeof v === "string" && v.length <= max;
const strOrNull = (max) => (v) => v === null || str(max)(v);
const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const num = (min, max) => (v) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const numOrNull = (min, max) => (v) => v === null || num(min, max)(v);
const oneOf = (...xs) => (v) => xs.includes(v);
const arrayOf = (check, max) => (v) => Array.isArray(v) && v.length <= max && v.every(check);

const HARDWARE = {
  cpu_model: str(120), cpu_short: str(80), cpu_threads: int(1, 4096), cpu_cores: int(1, 4096),
  ram_gb: num(0, 65536), system_vendor: str(60), system_model: str(80), arch: str(20), os: str(80),
  kernel: str(80), virtualization: str(30), gpus: arrayOf(str(100), 4), dri_render_nodes: int(0, 16),
  docker_version: str(30), docker_os: str(60), power_source: oneOf("rapl", "not available"),
  device_label: str(100),
};
const METRICS = {
  tokens_per_s: num(0, 1e6), prompt_tokens_per_s: numOrNull(0, 1e7), runs_tokens_per_s: arrayOf(num(0, 1e6), 10),
  gpu_offload_pct: num(0, 100), model: str(80), model_digest: str(80), fps: num(0, 1e6), speed: num(0, 1e5),
  streams: int(0, 64), cap: int(0, 64), images_per_s: num(0, 1e6), images: int(0, 100000),
  seconds: num(0, 1e6), faces_found: int(0, 1e7),
};
const RESOURCES = {
  samples: int(0, 1e7), cpu_pct_peak: numOrNull(0, 1e6), cpu_pct_mean: numOrNull(0, 1e6),
  mem_mb_peak: numOrNull(0, 1e8), power_w_mean: numOrNull(0, 10000),
};
const TEST = {
  app: oneOf("ollama", "jellyfin", "immich"),
  test: oneOf("generate", "transcode_4k_1080p", "concurrent_streams", "clip_embeddings", "face_detection", "all"),
  accel: oneOf("cpu", "nvidia", "vaapi", "nvenc", "qsv", "none"),
  image: str(120), image_digest: str(80), status: oneOf("ok", "failed", "skipped"), reason: strOrNull(300),
  metrics: "METRICS", resources: "RESOURCES", duration_s: int(0, 1e6),
};
const TOP = {
  schema_version: oneOf(1), script_version: str(20), run_id: (v) => typeof v === "string" && /^[0-9a-f]{12}$/.test(v),
  started_at: str(20), hardware: "HARDWARE", tests: "TESTS", duration_s: int(0, 1e7),
};

function checkObject(obj, spec, path, errors, requireAll) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const k of Object.keys(obj)) if (!(k in spec)) errors.push(`unknown field ${path}.${k}`);
  for (const [k, check] of Object.entries(spec)) {
    if (!(k in obj)) {
      if (requireAll) errors.push(`missing field ${path}.${k}`);
      continue;
    }
    if (typeof check === "function" && !check(obj[k])) errors.push(`invalid value for ${path}.${k}`);
  }
}

export function validateSubmission(doc) {
  const errors = [];
  checkObject(doc, TOP, "$", errors, true);
  if (errors.length) return errors;
  checkObject(doc.hardware, HARDWARE, "$.hardware", errors, true);
  if (!Array.isArray(doc.tests) || doc.tests.length === 0 || doc.tests.length > 20) {
    errors.push("$.tests must be a non-empty array of at most 20 tests");
    return errors;
  }
  doc.tests.forEach((t, i) => {
    const p = `$.tests[${i}]`;
    checkObject(t, TEST, p, errors, true);
    if (errors.length) return;
    checkObject(t.metrics, METRICS, `${p}.metrics`, errors, false);
    checkObject(t.resources, RESOURCES, `${p}.resources`, errors, false);
    const metric = PRIMARY_METRIC[t.test];
    if (t.status === "ok") {
      if (!metric || typeof t.metrics[metric] !== "number") errors.push(`${p} is missing its ${metric} result`);
      else if (t.metrics[metric] > BOUNDS[metric]) errors.push(`${p}.${metric} is implausibly high`);
    }
  });
  return errors;
}
