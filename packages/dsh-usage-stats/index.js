/**
 * dsh-usage-stats — all-session token usage dashboard for DeepSeek Harness.
 *
 * Host half: folds every persisted session's checkpointed `tokenUsage` and
 * `sessionStats` rows from the profile's projection cache into one summary and
 * serves it to this plugin's page over a loopback-only HTTP route. The Client
 * half (`./client`) renders the sidebar page.
 *//**
 * Host half of the usage statistics bundle.
 *
 * Folds every persisted session's checkpointed `tokenUsage` and `sessionStats`
 * rows into one all-session summary and serves it to the page over a
 * loopback-only HTTP route.
 *
 * Why the projection cache and not the session list: the list API serves a
 * cached block only when the record's Session format matches the running
 * format, so sessions written by an older format (here: format 3, the
 * majority) contribute nothing to the browser's copy. Their checkpoints are
 * still on disk with the same rows, and reading them needs no log replay,
 * migration or 300 MB of zstd decompression.
 *
 * Nothing here writes: the route is read-only, cached for 30 s, and refuses
 * non-loopback peers so a LAN-exposed Web carrier does not publish the stats.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Route prefix owned by this plugin. */
const ROUTE_PREFIX = '/usage-stats';
/** Exact path the page fetches. */
const SUMMARY_PATH = `${ROUTE_PREFIX}/summary`;
/** Reuse a computed summary for this long before folding again. */
const CACHE_TTL_MS = 30_000;
/** Milliseconds in one local day. */
const DAY_MS = 86_400_000;
/** Session rows shipped to the page (the ranking is capped; totals are not). */
const SESSION_LIMIT = 200;

/**
 * Local day key of one instant.
 * @param ts - epoch milliseconds.
 * @returns `YYYY-MM-DD` in local time.
 */
function dayKeyOf(ts) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Whether a socket peer is the local machine.
 * @param address - `req.socket.remoteAddress`.
 * @returns true for IPv4/IPv6 loopback forms.
 */
function isLoopback(address) {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || (typeof address === 'string' && address.startsWith('127.'));
}

/**
 * Read one checkpoint file into the fields the page needs.
 * @param filename - absolute cache file path.
 * @param id - session id taken from the file name.
 * @returns a session row, or undefined for an unreadable/incompatible file.
 */
async function readCheckpoint(filename, id) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filename, 'utf8'));
  } catch {
    return undefined;
  }
  const record = parsed?.record;
  const identity = record?.identity;
  const rows = record?.rows;
  if (identity === undefined || rows === undefined) return undefined;
  const totals = rows.tokenUsage?.val?.totals;
  if (totals === undefined) return undefined;
  const tokens = (totals.uncachedInputTokens ?? 0)
    + (totals.cacheReadTokens ?? 0)
    + (totals.cacheWriteTokens ?? 0)
    + (totals.outputTokens ?? 0);
  if (tokens <= 0) return undefined;
  const lastPromptAt = rows.sessionListMetadata?.val?.lastPromptAt;
  const createdAt = typeof identity.createdAt === 'number' ? identity.createdAt : 0;
  const model = rows.modelSelection?.val?.lastUsed;
  const stats = rows.sessionStats?.val;
  return {
    id,
    title: typeof rows.title?.val === 'string' ? rows.title.val : '',
    cwd: typeof identity.cwd === 'string' ? identity.cwd : '',
    createdAt,
    lastActiveAt: Math.max(createdAt, typeof lastPromptAt === 'number' ? lastPromptAt : 0),
    formatVersion: identity.formatVersion ?? null,
    tokens,
    input: totals.uncachedInputTokens ?? 0,
    cacheRead: totals.cacheReadTokens ?? 0,
    cacheWrite: totals.cacheWriteTokens ?? 0,
    output: totals.outputTokens ?? 0,
    turns: typeof stats?.turns === 'number' ? stats.turns : 0,
    steps: typeof stats?.steps === 'number' ? stats.steps : 0,
    provider: typeof model?.provider === 'string' ? model.provider : '',
    model: typeof model?.model === 'string' ? model.model : '',
  };
}

/**
 * Fold session rows into the page payload.
 * @param dir - the projection cache's session directory.
 * @returns the aggregate summary.
 */
export async function buildSummary(dir) {
  let names;
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  } catch {
    return {
      available: false,
      generatedAt: Date.now(),
      counts: { sessions: 0, checkpoints: 0, turns: 0, steps: 0 },
      totals: { tokens: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      sessions: [],
      daily: [],
      models: [],
      streak: { current: 0, longest: 0 },
      peak: null,
    };
  }

  const rows = [];
  for (const name of names) {
    const row = await readCheckpoint(join(dir, name), name.slice(0, -'.json'.length));
    if (row !== undefined) rows.push(row);
  }

  const totals = { tokens: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const byDay = new Map();
  const byModel = new Map();
  let peak = null;
  let turns = 0;
  let steps = 0;

  for (const row of rows) {
    totals.tokens += row.tokens;
    totals.input += row.input;
    totals.cacheRead += row.cacheRead;
    totals.cacheWrite += row.cacheWrite;
    totals.output += row.output;
    turns += row.turns;
    steps += row.steps;
    if (peak === null || row.tokens > peak.tokens) peak = row;

    const key = dayKeyOf(row.lastActiveAt > 0 ? row.lastActiveAt : row.createdAt);
    const day = byDay.get(key) ?? { date: key, tokens: 0, sessions: 0, turns: 0, steps: 0 };
    day.tokens += row.tokens;
    day.sessions += 1;
    day.turns += row.turns;
    day.steps += row.steps;
    byDay.set(key, day);

    const modelKey = row.model === '' ? '' : `${row.provider}/${row.model}`;
    const bucket = byModel.get(modelKey) ?? { key: modelKey, provider: row.provider, model: row.model, tokens: 0, sessions: 0 };
    bucket.tokens += row.tokens;
    bucket.sessions += 1;
    byModel.set(modelKey, bucket);
  }

  const dayKeys = [...byDay.keys()].sort();
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const key of dayKeys) {
    const ts = new Date(`${key}T00:00:00`).getTime();
    run = previous !== null && Math.round((ts - previous) / DAY_MS) === 1 ? run + 1 : 1;
    previous = ts;
    longest = Math.max(longest, run);
  }
  let current = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cursor = today.getTime();
  if (!byDay.has(dayKeyOf(cursor))) cursor -= DAY_MS;
  while (byDay.has(dayKeyOf(cursor))) {
    current += 1;
    cursor -= DAY_MS;
  }

  rows.sort((left, right) => right.tokens - left.tokens);
  return {
    available: true,
    generatedAt: Date.now(),
    counts: { sessions: rows.length, checkpoints: names.length, turns, steps },
    totals,
    sessions: rows.slice(0, SESSION_LIMIT),
    daily: [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date)),
    models: [...byModel.values()].sort((left, right) => right.tokens - left.tokens),
    streak: { current, longest },
    peak: peak === null ? null : {
      sessionId: peak.id,
      title: peak.title,
      cwd: peak.cwd,
      tokens: peak.tokens,
    },
  };
}

/**
 * Mount the summary route.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const profile = ctx.get('profileContext');
  const dir = profile === undefined
    ? undefined
    : join(profile.home, 'storages', 'session_projcache', 'sessions');

  let cached = null;
  let pending = null;
  const load = () => {
    if (cached !== null && Date.now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.payload);
    if (pending === null) {
      pending = buildSummary(dir)
        .then((payload) => {
          cached = { at: Date.now(), payload };
          return payload;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname !== SUMMARY_PATH) {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (!isLoopback(req.socket.remoteAddress)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const payload = await load();
        const body = JSON.stringify(payload);
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        res.end(body);
      },
    }), 'usage-stats: summary route');
  });
}
