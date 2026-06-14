// lib/gh-cache.js — GitHub API client with token-based auth and in-memory cache
// ============================================================================

const { request } = require('undici');

// SuperInstance is a user, not an org — use /users/ endpoint
const GH_ENTITY = 'SuperInstance';
const GH_ENDPOINT = '/users/';  // or '/orgs/'

const CACHE = new Map();

const TTL = {
  stats:  5 * 60 * 1000,  // 5 min
  repos: 30 * 60 * 1000,  // 30 min
  default: 10 * 60 * 1000,
};

function cacheKey(endpoint)  { return `${GH_ENTITY}:${endpoint}`; }

function cacheGet(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttl = TTL.default) {
  CACHE.set(key, { data, ts: Date.now(), ttl });
  // Evict stale entries if cache grows too large
  if (CACHE.size > 500) {
    const now = Date.now();
    for (const [k, v] of CACHE) {
      if (now - v.ts > v.ttl) CACHE.delete(k);
    }
  }
}

function getToken() {
  const tok = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (tok) return tok;
  // Try reading from gh CLI config
  try {
    const { execSync } = require('child_process');
    return execSync('gh auth token', { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return null;
  }
}

const TOKEN = getToken();
const HEADERS = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'fleet-dashboard/1.0' };
if (TOKEN) HEADERS['Authorization'] = `Bearer ${TOKEN}`;

let rateLimitRemaining = -1;
let rateLimitReset = 0;

async function ghFetch(path) {
  const url = `https://api.github.com${path}`;
  const resp = await request(url, { headers: HEADERS, method: 'GET' });

  // Track rate limit
  const remaining = resp.headers['x-ratelimit-remaining'];
  const reset = resp.headers['x-ratelimit-reset'];
  if (remaining !== undefined) rateLimitRemaining = parseInt(remaining, 10);
  if (reset !== undefined) rateLimitReset = parseInt(reset, 10) * 1000;

  if (resp.statusCode === 403 && rateLimitRemaining === 0) {
    const waitMs = Math.max(0, rateLimitReset - Date.now()) + 1000;
    console.error(`[gh-cache] Rate limited. Resets in ${Math.round(waitMs/1000)}s`);
    return { error: 'rate_limited', resetAt: rateLimitReset };
  }

  if (resp.statusCode === 404) {
    return { error: 'not_found' };
  }

  if (resp.statusCode >= 400) {
    const body = await resp.body.text();
    console.error(`[gh-cache] HTTP ${resp.statusCode} for ${path}: ${body.slice(0,200)}`);
    return { error: `http_${resp.statusCode}` };
  }

  const body = await resp.body.json();
  return body;
}

async function ghFetchAllPages(path, maxPages = 3) {
  const results = [];
  let page = 1;
  while (page <= maxPages) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await ghFetch(`${path}${sep}per_page=100&page=${page}`);
    if (data.error) {
      if (results.length > 0) break; // return what we have
      return data;
    }
    if (!Array.isArray(data)) return data;
    results.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return results;
}

// ─── Public API ───────────────────────────────────────────────────

async function getOrgRepos() {
  const key = cacheKey('repos');
  let data = cacheGet(key);
  if (data) return data;

  data = await ghFetchAllPages(`/users/${GH_ENTITY}/repos`, 5);
  if (data.error && data.error === 'rate_limited') {
    const fallback = cacheGet(key);
    if (fallback) {
      console.error('[gh-cache] Rate limited, using stale cache');
      return fallback;
    }
  }
  if (data.error) {
    console.error(`[gh-cache] Failed to fetch repos: ${data.error}`);
    return [];
  }

  cacheSet(key, data, TTL.repos);
  return data;
}

async function getOrgStats() {
  const key = cacheKey('stats');
  let data = cacheGet(key);
  if (data) return data;

  const repos = await getOrgRepos();
  if (!Array.isArray(repos)) {
    const cached = cacheGet(key);
    return cached || { repoCount: 0, languages: {}, totalStars: 0 };
  }

  const langCount = {};
  let totalStars = 0;
  for (const r of repos) {
    const lang = r.language || 'Unknown';
    langCount[lang] = (langCount[lang] || 0) + 1;
    totalStars += r.stargazers_count || 0;
  }

  const stats = {
    repoCount: repos.length,
    languages: Object.entries(langCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    totalStars,
    fetchedAt: new Date().toISOString(),
  };

  cacheSet(key, stats, TTL.stats);
  return stats;
}

async function getRepo(name) {
  const repos = await getOrgRepos();
  if (!Array.isArray(repos)) return null;
  return repos.find(r => r.name === name) || null;
}

async function getRepoReadme(name) {
  const data = await ghFetch(`/repos/${GH_ENTITY}/${name}/readme`);
  if (data.error === 'not_found') return { error: 'not_found' };
  if (data.error) return { error: 'readme_unavailable' };
  if (data.encoding === 'base64') {
    const decoded = Buffer.from(data.content, 'base64').toString('utf8');
    return {
      name: data.name,
      path: data.path,
      html_url: data.html_url,
      content: decoded,
      size: data.size,
    };
  }
  return data;
}

async function getRecentCommits(since) {
  const repos = await getOrgRepos();
  if (!Array.isArray(repos)) return [];

  const commitPromises = repos.slice(0, 15).map(async (repo) => {
    try {
      const commits = await ghFetch(
        `/repos/${GH_ENTITY}/${repo.name}/commits?since=${encodeURIComponent(since)}&per_page=5`
      );
      if (!Array.isArray(commits)) return [];
      return commits.map(c => ({
        repo: repo.name,
        sha: c.sha.slice(0, 7),
        message: (c.commit?.message || '').split('\n')[0],
        author: c.commit?.author?.name || c.commit?.author?.email || 'unknown',
        date: c.commit?.author?.date || c.commit?.committer?.date || new Date().toISOString(),
        url: c.html_url,
      }));
    } catch {
      return [];
    }
  });

  const nested = await Promise.all(commitPromises);
  const allCommits = nested.flat().sort((a, b) => new Date(b.date) - new Date(a.date));
  return allCommits.slice(0, 50);
}

function getRateLimitStatus() {
  return {
    remaining: rateLimitRemaining,
    resetAt: rateLimitReset,
    authenticated: !!TOKEN,
  };
}

function getCacheStats() {
  const stats = { entries: CACHE.size, byTTL: {} };
  for (const [k, v] of CACHE) {
    const ttlLabel = v.ttl <= TTL.stats ? 'stats' : v.ttl <= TTL.repos ? 'repos' : 'other';
    stats.byTTL[ttlLabel] = (stats.byTTL[ttlLabel] || 0) + 1;
  }
  return stats;
}

module.exports = {
  getOrgRepos,
  getOrgStats,
  getRepo,
  getRepoReadme,
  getRecentCommits,
  getRateLimitStatus,
  getCacheStats,
};
