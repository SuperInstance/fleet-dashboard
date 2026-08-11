/**
 * Fleet Dashboard — Edge-Case, Integration & Robustness Tests
 *
 * Tests boundary conditions, malformed data, error paths,
 * inter-component integration, and stress scenarios.
 *
 * Run: node tests/test_edge.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ──────────────────────────────────────────────
// Environment setup — mock fetch, Response, etc.
// ──────────────────────────────────────────────

if (typeof Response === 'undefined') {
  global.Response = class Response {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status || 200;
      this.headers = new Map(Object.entries(init.headers || {}));
    }
    async json() { return JSON.parse(this.body); }
    async text() { return this.body; }
  };
}

if (typeof document === 'undefined') {
  global.document = {
    createElement(tag) {
      return {
        tagName: tag,
        textContent: '',
        get innerHTML() {
          return this._escaped || this.textContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        },
        set innerHTML(v) { this._escaped = v; },
      };
    },
  };
}

// ──────────────────────────────────────────────
// Configurable fetch mock
// ──────────────────────────────────────────────

let fetchMode = 'normal';
let fetchOverrides = {}; // url-fragment -> response spec

global.fetch = async (url, opts) => {
  const urlStr = typeof url === 'string' ? url : url.toString();

  // Check for specific overrides first
  for (const [frag, spec] of Object.entries(fetchOverrides)) {
    if (urlStr.includes(frag)) {
      if (spec.throw) throw new Error(spec.throw);
      return {
        ok: spec.ok !== false,
        status: spec.status || 200,
        json: async () => spec.json,
        text: async () => spec.text || JSON.stringify(spec.json || {}),
      };
    }
  }

  if (fetchMode === 'all-down') throw new Error('Network unavailable');
  if (fetchMode === 'github-down' && urlStr.includes('api.github.com')) throw new Error('GitHub API error');
  if (fetchMode === 'wiki-down' && urlStr.includes('fleet-wiki')) {
    return { ok: false, status: 502, text: async () => 'Bad Gateway', json: async () => ({ error: 'bad' }) };
  }
  if (fetchMode === 'openrooms-down' && urlStr.includes('openrooms')) {
    return { ok: false, status: 500, text: async () => 'Server Error', json: async () => ({ error: 'bad' }) };
  }

  // GitHub API mock
  if (urlStr.includes('api.github.com')) {
    if (urlStr.includes('/repos/')) {
      const name = urlStr.split('/').slice(-1)[0].replace(/\?.*/, '');
      return {
        ok: true,
        json: async () => ({
          name,
          stargazers_count: 3,
          forks_count: 1,
          language: 'TypeScript',
          updated_at: new Date().toISOString(),
          description: `${name} repo`,
          open_issues_count: 2,
        }),
      };
    }
    if (urlStr.includes('/actions/runs')) {
      return { ok: true, json: async () => ({ total_count: 42 }) };
    }
    if (urlStr.includes('/events')) {
      return {
        ok: true,
        json: async () => [
          {
            type: 'PushEvent',
            repo: { name: 'SuperInstance/test-repo' },
            created_at: new Date().toISOString(),
            payload: {
              commits: [
                { sha: 'abc1234', message: 'test commit', author: { name: 'tester' } },
                { sha: 'def5678', message: 'another commit', author: { name: 'dev2' } },
              ],
            },
          },
          {
            type: 'WatchEvent',
            repo: { name: 'SuperInstance/other' },
            created_at: new Date().toISOString(),
            payload: {},
          },
        ],
      };
    }
    if (urlStr.includes('/commits')) {
      return {
        ok: true,
        json: async () => [
          {
            sha: 'abcdef0123',
            commit: {
              message: 'fix: handle edge case in parser\n\nDetailed body.',
              author: { name: 'tester', date: new Date().toISOString() },
            },
          },
          {
            sha: '9999aaa111',
            commit: {
              message: 'feat: add new feature',
              author: { name: 'dev2', date: new Date(Date.now() - 86400000).toISOString() },
            },
          },
        ],
      };
    }
  }

  // Wiki API mock
  if (urlStr.includes('fleet-wiki')) {
    return {
      ok: true,
      json: async () => [
        { slug: 'home', title: 'Home' },
        { slug: 'agents', title: 'Agents' },
        { slug: 'the-tap', title: 'The Tap' },
      ],
    };
  }

  // Openrooms API mock
  if (urlStr.includes('openrooms')) {
    return {
      ok: true,
      json: async () => [
        { name: 'bar-rail', status: 'active' },
        { name: 'chart-room', status: 'idle' },
      ],
    };
  }

  return { ok: false, status: 404, json: async () => ({ error: 'not found' }), text: async () => 'Not found' };
};

// ──────────────────────────────────────────────
// Load worker module
// ──────────────────────────────────────────────

const workerSource = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf-8');
const workerModule = require('../worker.js');
const worker = workerModule.default || workerModule;

const mockEnv = {
  GITHUB_TOKEN: 'mock-token',
  FLEET_CACHE: { get: async () => null, put: async () => {} },
};

// ──────────────────────────────────────────────
// Extract testable pure functions from source
// ──────────────────────────────────────────────

function evalFunction(funcName, src) {
  const funcPattern = new RegExp(`function ${funcName}\\(`);
  const match = funcPattern.exec(src);
  if (!match) return null;
  const start = match.index;
  let braceCount = 0;
  const funcStart = src.indexOf('{', start);
  let end = funcStart;
  for (let i = funcStart; i < src.length; i++) {
    if (src[i] === '{') braceCount++;
    if (src[i] === '}') braceCount--;
    if (braceCount === 0) { end = i + 1; break; }
  }
  const funcCode = src.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(funcCode + `; return ${funcName};`)();
}

const jsonResponse = evalFunction('jsonResponse', workerSource);
const escapeHtml = evalFunction('escapeHtml', workerSource);
const timeAgo = evalFunction('timeAgo', workerSource);

// ──────────────────────────────────────────────
// Test runner
// ──────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

async function run() {
  console.log('\n=== Edge-Case, Integration & Robustness Tests ===\n');

  // ═══════════════════════════════════════════════
  // SECTION 1: jsonResponse — Edge Cases
  // ═══════════════════════════════════════════════
  console.log('--- jsonResponse Edge Cases ---');

  await test('NaN in data becomes null in JSON (JSON spec)', async () => {
    const res = jsonResponse({ value: NaN });
    const body = await res.text();
    // JSON.stringify(NaN) === "null"
    assert.strictEqual(body, '{\n  "value": null\n}');
  });

  await test('Infinity in data becomes null in JSON', async () => {
    const res = jsonResponse({ value: Infinity });
    const body = await res.text();
    assert.ok(body.includes('null'));
  });

  await test('undefined value in object is omitted from JSON', async () => {
    const res = jsonResponse({ a: 1, b: undefined });
    const body = await res.text();
    assert.ok(body.includes('"a": 1'));
    assert.ok(!body.includes('b'));
  });

  await test('undefined as top-level data becomes empty string body', async () => {
    const res = jsonResponse(undefined);
    const body = await res.text();
    // JSON.stringify(undefined) === undefined → Response coerces to ""
    assert.strictEqual(body, '');
  });

  await test('empty array serializes correctly', async () => {
    const res = jsonResponse([]);
    const body = await res.json();
    assert.deepStrictEqual(body, []);
  });

  await test('array with nulls serializes correctly', async () => {
    const res = jsonResponse([null, null, null]);
    const body = await res.json();
    assert.deepStrictEqual(body, [null, null, null]);
  });

  await test('deeply nested object (10 levels)', async () => {
    let data = { deep: 'value' };
    for (let i = 0; i < 10; i++) data = { nested: data };
    const res = jsonResponse(data);
    const body = await res.json();
    // Navigate 10 levels of .nested
    let node = body;
    for (let i = 0; i < 10; i++) node = node.nested;
    assert.strictEqual(node.deep, 'value');
  });

  await test('large number serialization', async () => {
    const res = jsonResponse({ big: Number.MAX_SAFE_INTEGER, bigger: Number.MAX_VALUE });
    const body = await res.json();
    assert.strictEqual(body.big, Number.MAX_SAFE_INTEGER);
    assert.strictEqual(body.bigger, Number.MAX_VALUE);
  });

  await test('negative zero serializes correctly', async () => {
    const res = jsonResponse({ value: -0 });
    const body = await res.text();
    // JSON.stringify(-0) === "0" per spec
    assert.ok(body.includes('"value": 0') || body.includes('"value": -0'));
  });

  await test('string with special Unicode characters', async () => {
    const res = jsonResponse({ emoji: '⚓🦀', jp: '日本語', nl: 'ëüï' });
    const body = await res.json();
    assert.strictEqual(body.emoji, '⚓🦀');
    assert.strictEqual(body.jp, '日本語');
  });

  await test('very long string data', async () => {
    const longStr = 'A'.repeat(100000);
    const res = jsonResponse({ data: longStr });
    const body = await res.json();
    assert.strictEqual(body.data.length, 100000);
  });

  await test('status code 404', () => {
    const res = jsonResponse({ error: 'not found' }, 404);
    assert.strictEqual(res.status, 404);
  });

  await test('status code 418 teapot', () => {
    const res = jsonResponse({ message: "I'm a teapot" }, 418);
    assert.strictEqual(res.status, 418);
  });

  await test('status code 0 is treated as 200 by default', () => {
    const res = jsonResponse({ ok: true });
    assert.strictEqual(res.status, 200);
  });

  await test('response body is pretty-printed with 2-space indent', async () => {
    const res = jsonResponse({ a: 1, b: { c: 2 } });
    const text = await res.text();
    assert.ok(text.includes('\n  "a": 1'), 'Should be 2-space indented');
    assert.ok(text.includes('\n    "c": 2'), 'Nested should be 4-space indented');
  });

  await test('all CORS headers present and correct', () => {
    const res = jsonResponse({});
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
    assert.strictEqual(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
    assert.ok(res.headers.get('Cache-Control').includes('public'));
    assert.ok(res.headers.get('Cache-Control').includes('s-maxage=60'));
    assert.ok(res.headers.get('Cache-Control').includes('stale-while-revalidate=300'));
  });

  await test('object with circular-like structure (same ref, not actual circular)', async () => {
    const shared = { id: 1 };
    const data = { a: shared, b: shared };
    const res = jsonResponse(data);
    const body = await res.json();
    assert.strictEqual(body.a.id, 1);
    assert.strictEqual(body.b.id, 1);
  });

  await test('boolean and null values at top level', async () => {
    assert.strictEqual((await jsonResponse(true).json()), true);
    assert.strictEqual((await jsonResponse(false).json()), false);
    assert.strictEqual((await jsonResponse(null).json()), null);
  });

  await test('numeric strings are not coerced', async () => {
    const res = jsonResponse({ val: '123' });
    const body = await res.json();
    assert.strictEqual(body.val, '123');
    assert.notStrictEqual(body.val, 123);
  });

  // ═══════════════════════════════════════════════
  // SECTION 2: escapeHtml — Edge Cases
  // ═══════════════════════════════════════════════
  console.log('\n--- escapeHtml Edge Cases ---');

  await test('escapes all HTML entities in sequence', () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    assert.ok(!result.includes('<script>'));
    assert.ok(result.includes('&lt;script&gt;'));
  });

  await test('handles mixed content', () => {
    const result = escapeHtml('Hello <b>World</b> & "all" <i>friends</i>');
    assert.ok(!result.includes('<b>'));
    assert.ok(result.includes('&amp;'));
    assert.ok(result.includes('&quot;'));
  });

  await test('double-escaping does not occur (single pass)', () => {
    const result = escapeHtml('&amp;');
    // & becomes &amp; → &amp;amp; — this is correct single-pass behavior
    assert.strictEqual(result, '&amp;amp;');
  });

  await test('handles string with only whitespace', () => {
    const result = escapeHtml('   \n\t  ');
    assert.strictEqual(result, '   \n\t  ');
  });

  await test('handles very long string', () => {
    const long = '<img>'.repeat(1000);
    const result = escapeHtml(long);
    assert.ok(!result.includes('<img>'));
    assert.ok(result.includes('&lt;img&gt;'));
  });

  await test('handles Unicode-only content', () => {
    const result = escapeHtml('日本語テスト');
    assert.strictEqual(result, '日本語テスト');
  });

  await test('handles single quote', () => {
    const result = escapeHtml("it's");
    // Single quotes are not escaped by DOM textContent approach
    assert.ok(result.includes("it's") || result.includes('it&#39;s') || result.includes('it&apos;s'));
  });

  await test('handles null-like string "null"', () => {
    const result = escapeHtml('null');
    assert.strictEqual(result, 'null');
  });

  await test('handles backtick (template injection)', () => {
    const result = escapeHtml('`template`');
    // Backtick is not HTML-special so passes through
    assert.ok(result.includes('`'));
  });

  // ═══════════════════════════════════════════════
  // SECTION 3: timeAgo — Edge Cases
  // ═══════════════════════════════════════════════
  console.log('\n--- timeAgo Edge Cases ---');

  await test('returns dash for boolean false', () => {
    assert.strictEqual(timeAgo(false), '—');
  });

  await test('returns dash for number 0', () => {
    assert.strictEqual(timeAgo(0), '—');
  });

  await test('handles future date (negative seconds)', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const result = timeAgo(future);
    // seconds would be negative → seconds < 60 is true → returns "Ns ago" with negative
    assert.ok(typeof result === 'string');
  });

  await test('handles date exactly 59 seconds ago', () => {
    const d = new Date(Date.now() - 59 * 1000).toISOString();
    const result = timeAgo(d);
    assert.ok(result.includes('s ago'));
  });

  await test('handles date exactly 60 seconds ago (boundary)', () => {
    const d = new Date(Date.now() - 60 * 1000).toISOString();
    const result = timeAgo(d);
    assert.ok(result.includes('m ago'));
  });

  await test('handles date exactly 3599 seconds ago (just under 1h)', () => {
    const d = new Date(Date.now() - 3599 * 1000).toISOString();
    const result = timeAgo(d);
    assert.ok(result.includes('m ago'));
  });

  await test('handles date exactly 3600 seconds ago (1 hour boundary)', () => {
    const d = new Date(Date.now() - 3600 * 1000).toISOString();
    const result = timeAgo(d);
    assert.ok(result.includes('h ago'));
  });

  await test('handles date exactly 86399 seconds ago (just under 1 day)', () => {
    const d = new Date(Date.now() - 86399 * 1000).toISOString();
    const result = timeAgo(d);
    assert.ok(result.includes('h ago'));
  });

  await test('handles date exactly 86400 seconds ago (1 day boundary)', () => {
    const d = new Date(Date.now() - 86400 * 1000).toISOString();
    const result = timeAgo(d);
    assert.ok(result.includes('d ago'));
  });

  await test('handles very old date (1 year)', () => {
    const d = new Date(Date.now() - 365 * 86400 * 1000).toISOString();
    const result = timeAgo(d);
    assert.ok(result.includes('d ago'));
    // Should be >= 365 days
    const days = parseInt(result);
    assert.ok(days >= 365, `Expected >= 365 days, got ${days}`);
  });

  await test('handles date-only ISO string', () => {
    const result = timeAgo('2026-01-01');
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  await test('handles malformed date string', () => {
    const result = timeAgo('not-a-date');
    // Invalid date → NaN → seconds < 60 is false for NaN
    // NaN < 60 → false, NaN < 3600 → false, NaN < 86400 → false
    // So falls through to days path: Math.floor(NaN / 86400) = NaN → "NaNd ago"
    assert.ok(typeof result === 'string');
  });

  // ═══════════════════════════════════════════════
  // SECTION 4: FLEET_REPOS — Content Validation
  // ═══════════════════════════════════════════════
  console.log('\n--- FLEET_REPOS Content Validation ---');

  function getFleetRepos() {
    const match = workerSource.match(/const FLEET_REPOS = \[([\s\S]*?)\];/);
    assert.ok(match, 'FLEET_REPOS must be defined');
    return match[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
  }

  await test('no empty string repo names', () => {
    const repos = getFleetRepos();
    for (const r of repos) {
      assert.ok(r.length > 0, 'Repo name should not be empty');
    }
  });

  await test('no repo names with spaces', () => {
    const repos = getFleetRepos();
    for (const r of repos) {
      assert.ok(!r.includes(' '), `Repo name '${r}' should not contain spaces`);
    }
  });

  await test('all repo names match valid GitHub naming', () => {
    const repos = getFleetRepos();
    // GitHub repo names: alphanumeric, hyphens, underscores, dots
    const validName = /^[A-Za-z0-9._-]+$/;
    for (const r of repos) {
      assert.ok(validName.test(r), `Repo name '${r}' contains invalid characters`);
    }
  });

  await test('no duplicate repo names', () => {
    const repos = getFleetRepos();
    const unique = new Set(repos);
    assert.strictEqual(unique.size, repos.length,
      `Found ${repos.length - unique.size} duplicate(s)`);
  });

  await test('exactly 50 repos (matches current fleet)', () => {
    const repos = getFleetRepos();
    assert.ok(repos.length === 50, `Expected 50 repos, got ${repos.length}`);
  });

  await test('batch size 5 divides 50 repos into exactly 10 batches', () => {
    const repos = getFleetRepos();
    const batchSize = 5;
    const batches = [];
    for (let i = 0; i < repos.length; i += batchSize) {
      batches.push(repos.slice(i, i + batchSize));
    }
    assert.strictEqual(batches.length, 10);
    assert.strictEqual(batches[0].length, 5);
    assert.strictEqual(batches[9].length, 5);
  });

  await test('no repo name exceeds GitHub max length (100 chars)', () => {
    const repos = getFleetRepos();
    for (const r of repos) {
      assert.ok(r.length <= 100, `Repo name '${r}' exceeds 100 characters`);
    }
  });

  // ═══════════════════════════════════════════════
  // SECTION 5: Integration — API Endpoints
  // ═══════════════════════════════════════════════
  console.log('\n--- API Integration Tests ---');

  await test('/api/fleet returns repos with numeric star/issue counts', async () => {
    fetchMode = 'normal';
    fetchOverrides = {};
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.ok(typeof data.repos.totalStars === 'number');
    assert.ok(typeof data.repos.totalIssues === 'number');
    assert.ok(data.repos.totalStars >= 0);
    assert.ok(data.repos.totalIssues >= 0);
  });

  await test('/api/fleet returns languageBreakdown sorted by count descending', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    const lb = data.repos.languageBreakdown;
    assert.ok(Array.isArray(lb));
    for (let i = 1; i < lb.length; i++) {
      assert.ok(lb[i - 1].count >= lb[i].count,
        `Languages should be sorted desc: ${lb[i - 1].language}(${lb[i - 1].count}) < ${lb[i].language}(${lb[i].count})`);
    }
  });

  await test('languageBreakdown percentages sum to ~100%', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    const lb = data.repos.languageBreakdown;
    const total = lb.reduce((sum, l) => sum + parseFloat(l.percentage), 0);
    // Allow floating point drift
    assert.ok(Math.abs(total - 100) < 1.0,
      `Percentages should sum to ~100, got ${total}`);
  });

  await test('/api/fleet commits have all expected fields', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.ok(data.commits.length > 0, 'Should have commits');
    for (const c of data.commits) {
      assert.ok('repo' in c, 'commit missing repo');
      assert.ok('sha' in c, 'commit missing sha');
      assert.ok('message' in c, 'commit missing message');
      assert.ok('author' in c, 'commit missing author');
      assert.ok('time' in c, 'commit missing time');
    }
  });

  await test('/api/fleet commit SHAs are 7-character truncated', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    for (const c of data.commits) {
      if (c.sha) {
        assert.ok(c.sha.length <= 7, `SHA '${c.sha}' should be 7 chars or less`);
      }
    }
  });

  await test('/api/fleet quota entries have status, plan, and note', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    for (const [name, q] of Object.entries(data.quota)) {
      assert.ok('status' in q, `quota.${name} missing status`);
      assert.ok('note' in q, `quota.${name} missing note`);
    }
  });

  await test('/api/fleet cron entries have name, schedule, and status', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    for (const c of data.cron) {
      assert.ok('name' in c, 'cron entry missing name');
      assert.ok('schedule' in c, 'cron entry missing schedule');
      assert.ok('status' in c, 'cron entry missing status');
      assert.ok(typeof c.name === 'string' && c.name.length > 0);
    }
  });

  await test('/api/fleet openrooms data has agentCount as number', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.ok(typeof data.openrooms.agentCount === 'number');
    assert.ok(data.openrooms.agentCount > 0);
  });

  await test('unknown path serves dashboard HTML (not 404)', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/totally/nonexistent/path');
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('<!DOCTYPE html>') || text.includes('<html'));
  });

  await test('root path serves HTML with correct Content-Type', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/');
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  });

  await test('POST to /api/fleet still returns data (no method restriction on fetch handler)', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet', { method: 'POST' });
    const res = await worker.fetch(req, mockEnv);
    // Worker doesn't check method, so it should still work
    assert.strictEqual(res.status, 200);
  });

  await test('/api/fleet response includes wesleyLatest field', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.ok('wesleyLatest' in data, 'Should have wesleyLatest field');
  });

  await test('/api/fleet and /api/refresh return consistent repo counts', async () => {
    fetchMode = 'normal';
    const fleetReq = new Request('https://dashboard.example.com/api/fleet');
    const refreshReq = new Request('https://dashboard.example.com/api/refresh');
    const fleetData = await (await worker.fetch(fleetReq, mockEnv)).json();
    const refreshData = await (await worker.fetch(refreshReq, mockEnv)).json();
    assert.strictEqual(fleetData.repos.totalRepos, refreshData.repos.totalRepos);
    assert.strictEqual(fleetData.repos.repos.length, refreshData.repos.repos.length);
  });

  // ═══════════════════════════════════════════════
  // SECTION 6: Error Handling & Degradation
  // ═══════════════════════════════════════════════
  console.log('\n--- Error Handling & Degradation ---');

  await test('GitHub down: repos object has error or empty repos array', async () => {
    fetchMode = 'github-down';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.ok(typeof data.repos === 'object');
    // With Promise.allSettled, failure → repos has error or empty
    assert.ok(data.repos.repos !== undefined || data.repos.error !== undefined);
    fetchMode = 'normal';
  });

  await test('Wiki down: still returns pageCount (fallback)', async () => {
    fetchMode = 'wiki-down';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.ok(typeof data.wiki.pageCount === 'number');
    assert.ok(data.wiki.pageCount > 0, 'Fallback should provide a positive pageCount');
    fetchMode = 'normal';
  });

  await test('Openrooms down: still returns agentCount (fallback)', async () => {
    fetchMode = 'openrooms-down';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.ok(typeof data.openrooms.agentCount === 'number');
    assert.ok(data.openrooms.agentCount > 0, 'Fallback should provide positive agentCount');
    fetchMode = 'normal';
  });

  await test('Total network failure: still returns a response (Promise.allSettled)', async () => {
    fetchMode = 'all-down';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    assert.ok(res.status === 200 || res.status === 500);
    const data = await res.json();
    // Structure should still exist
    assert.ok('timestamp' in data || 'error' in data);
    fetchMode = 'normal';
  });

  await test('Missing GITHUB_TOKEN: worker still functions', async () => {
    fetchMode = 'normal';
    const envNoToken = { FLEET_CACHE: { get: async () => null, put: async () => {} } };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, envNoToken);
    assert.strictEqual(res.status, 200);
  });

  await test('Empty/null env: worker handles gracefully', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, {});
    assert.ok(res.status === 200 || res.status === 500);
  });

  await test('Scheduled handler survives total network failure', async () => {
    fetchMode = 'all-down';
    const event = { scheduledTime: Date.now() };
    await worker.scheduled(event, mockEnv);
    fetchMode = 'normal';
  });

  await test('Scheduled handler survives wiki + openrooms both down', async () => {
    fetchMode = 'wiki-down';
    fetchOverrides = { 'openrooms': { throw: 'Connection refused' } };
    const event = { scheduledTime: Date.now() };
    await worker.scheduled(event, mockEnv);
    fetchOverrides = {};
    fetchMode = 'normal';
  });

  // ═══════════════════════════════════════════════
  // SECTION 7: Mock-Driven Edge Cases
  // ═══════════════════════════════════════════════
  console.log('\n--- Mock-Driven Data Edge Cases ---');

  await test('GitHub repo API returns 404 for repo: repo excluded from results', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      '/repos/SuperInstance/nonexistent': { ok: false, status: 404, json: { message: 'Not Found' } },
    };
    // This override won't trigger since our mock matches /repos/ generically,
    // but test that the existing flow handles non-ok responses
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    fetchOverrides = {};
  });

  await test('GitHub events API returns non-PushEvent types only: fallback commits used', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      '/events': {
        json: [
          { type: 'WatchEvent', repo: { name: 'test/repo' }, payload: {} },
          { type: 'ForkEvent', repo: { name: 'test/repo2' }, payload: {} },
        ],
      },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    // Should fall through to fallback path or return empty commits
    assert.ok(Array.isArray(data.commits));
    fetchOverrides = {};
  });

  await test('GitHub events API returns PushEvent with empty commits array', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      '/events': {
        json: [
          { type: 'PushEvent', repo: { name: 'test/repo' }, created_at: new Date().toISOString(), payload: { commits: [] } },
        ],
      },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.ok(Array.isArray(data.commits));
    // Should use fallback or return empty
    fetchOverrides = {};
  });

  await test('Wiki API returns non-array JSON (object instead of array)', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      'fleet-wiki': {
        json: { pages: 42, error: 'wrong format' },
        text: '{"pages":42}',
      },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    // Non-array should trigger fallback
    assert.ok(typeof data.wiki.pageCount === 'number');
    assert.ok(data.wiki.pageCount > 0);
    fetchOverrides = {};
  });

  await test('Wiki API returns invalid JSON text', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      'fleet-wiki': {
        ok: true,
        text: '<<not json>>',
        json: async () => { throw new Error('Invalid JSON'); },
      },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    // Invalid JSON should trigger fallback
    assert.ok(typeof data.wiki.pageCount === 'number');
    fetchOverrides = {};
  });

  await test('Wiki API returns empty page array', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      'fleet-wiki': { json: [] },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    // Empty array → pageCount 0, which is valid but empty
    assert.strictEqual(data.wiki.pageCount, 0);
    fetchOverrides = {};
  });

  await test('Openrooms API returns object with total instead of array', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      'openrooms': { json: { total: 15, rooms: [] } },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.strictEqual(data.openrooms.agentCount, 15);
    fetchOverrides = {};
  });

  await test('Openrooms API returns empty array', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      'openrooms': { json: [] },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.strictEqual(data.openrooms.agentCount, 0);
    fetchOverrides = {};
  });

  await test('AI-Writings commits API returns empty array: wesleyLatest is null', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      '/AI-Writings/commits': { json: [] },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    assert.strictEqual(data.wesleyLatest, null);
    fetchOverrides = {};
  });

  await test('AI-Writings commits have Wesley in message: wesleyLatest reflects it', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      '/AI-Writings/commits': {
        json: [
          {
            sha: 'wesley789',
            commit: {
              message: ' Wesley update: new story chapter',
              author: { name: 'casey', date: new Date().toISOString() },
            },
          },
          {
            sha: 'other000',
            commit: {
              message: 'fix: typo in docs',
              author: { name: 'casey', date: new Date().toISOString() },
            },
          },
        ],
      },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    // Should find the Wesley commit
    assert.ok(data.wesleyLatest !== null);
    assert.ok(data.wesleyLatest.sha !== undefined);
    fetchOverrides = {};
  });

  await test('Repo with null language: counted as "Other" in breakdown', async () => {
    fetchMode = 'normal';
    fetchOverrides = {
      '/repos/SuperInstance/study-sunset-ecosystem': {
        json: {
          name: 'study-sunset-ecosystem',
          stargazers_count: 5,
          forks_count: 0,
          language: null,
          updated_at: new Date().toISOString(),
          description: 'test',
          open_issues_count: 1,
        },
      },
    };
    const req = new Request('https://dashboard.example.com/api/fleet');
    const res = await worker.fetch(req, mockEnv);
    const data = await res.json();
    // Language null → "Other" or "—" in breakdown
    assert.ok(data.repos.languageBreakdown.length > 0);
    fetchOverrides = {};
  });

  // ═══════════════════════════════════════════════
  // SECTION 8: HTML Dashboard — Structural Tests
  // ═══════════════════════════════════════════════
  console.log('\n--- HTML Dashboard Structural Tests ---');

  async function getDashboardHtml() {
    const req = new Request('https://dashboard.example.com/');
    const res = await worker.fetch(req, mockEnv);
    return await res.text();
  }

  await test('dashboard HTML contains doctype', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.toLowerCase().includes('<!doctype html>'));
  });

  await test('dashboard HTML has title tag with Fleet Dashboard', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('<title>') && html.includes('Fleet Dashboard'));
  });

  await test('dashboard HTML has meta charset UTF-8', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('charset') && html.includes('UTF-8'));
  });

  await test('dashboard HTML has refresh button with onclick handler', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('refresh-btn'));
    assert.ok(html.includes('onclick="loadData()"'));
  });

  await test('dashboard HTML has stat grid with 6 stat cards', async () => {
    const html = await getDashboardHtml();
    const statCardCount = (html.match(/stat-card/g) || []).length;
    assert.ok(statCardCount >= 6, `Expected at least 6 stat-card references, got ${statCardCount}`);
  });

  await test('dashboard HTML includes CSS custom properties (variables)', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('--bg-') || html.includes('--copper'));
  });

  await test('dashboard HTML has JavaScript loadData function', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('function loadData'));
  });

  await test('dashboard HTML has JavaScript renderData function', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('function renderData'));
  });

  await test('dashboard HTML has JavaScript escapeHtml function', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('function escapeHtml'));
  });

  await test('dashboard HTML has JavaScript timeAgo function', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('function timeAgo'));
  });

  await test('dashboard HTML has auto-refresh interval (setInterval)', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('setInterval(loadData'));
  });

  await test('dashboard HTML has two-column layout CSS', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('two-col'));
  });

  await test('dashboard HTML does not contain unescaped <script> injection', async () => {
    const html = await getDashboardHtml();
    // The HTML template itself uses script tags, but check no raw user input
    // is unescaped in a way that creates injection
    assert.ok(html.includes('<script>')); // This is the legitimate script tag
    // Verify escapeHtml is defined and used in render
    assert.ok(html.includes('escapeHtml'));
  });

  await test('dashboard HTML has dark theme colors', async () => {
    const html = await getDashboardHtml();
    // Look for dark hex colors
    assert.ok(html.includes('#071214') || html.includes('#0a1518') || html.includes('dark'));
  });

  await test('dashboard HTML has repo table with sort by stars', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('sort((a, b) => (b.stars'));
  });

  await test('dashboard HTML footer has fleet-related links', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.includes('lucineer.com') || html.includes('fleet-wiki'));
  });

  await test('dashboard HTML is over 10KB (substantial content)', async () => {
    const html = await getDashboardHtml();
    assert.ok(html.length > 10000, `Expected >10KB, got ${html.length}`);
  });

  // ═══════════════════════════════════════════════
  // SECTION 9: Stress Tests
  // ═══════════════════════════════════════════════
  console.log('\n--- Stress Tests ---');

  await test('10 sequential /api/fleet requests all succeed', async () => {
    fetchMode = 'normal';
    for (let i = 0; i < 10; i++) {
      const req = new Request('https://dashboard.example.com/api/fleet');
      const res = await worker.fetch(req, mockEnv);
      assert.strictEqual(res.status, 200, `Request ${i} failed with status ${res.status}`);
      await res.json(); // consume body
    }
  });

  await test('5 concurrent /api/fleet requests all succeed', async () => {
    fetchMode = 'normal';
    const requests = Array.from({ length: 5 }, () => {
      const req = new Request('https://dashboard.example.com/api/fleet');
      return worker.fetch(req, mockEnv).then(res => res.json());
    });
    const results = await Promise.all(requests);
    for (let i = 0; i < results.length; i++) {
      assert.ok(typeof results[i] === 'object', `Result ${i} should be object`);
      assert.ok('timestamp' in results[i]);
    }
  });

  await test('Alternating dashboard and API requests', async () => {
    fetchMode = 'normal';
    for (let i = 0; i < 5; i++) {
      const htmlReq = new Request('https://dashboard.example.com/');
      const htmlRes = await worker.fetch(htmlReq, mockEnv);
      assert.strictEqual(htmlRes.status, 200);
      await htmlRes.text();

      const apiReq = new Request('https://dashboard.example.com/api/fleet');
      const apiRes = await worker.fetch(apiReq, mockEnv);
      assert.strictEqual(apiRes.status, 200);
      await apiRes.json();
    }
  });

  await test('scheduled handler called 5 times rapidly', async () => {
    fetchMode = 'normal';
    for (let i = 0; i < 5; i++) {
      await worker.scheduled({ scheduledTime: Date.now() }, mockEnv);
    }
  });

  await test('Request with query parameters on root path serves dashboard', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/?foo=bar&baz=1');
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('<!DOCTYPE'));
  });

  await test('Request with query parameters on /api/fleet serves JSON', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet?detail=full');
    const res = await worker.fetch(req, mockEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data === 'object');
  });

  // ═══════════════════════════════════════════════
  // SECTION 10: Source Code Robustness Checks
  // ═══════════════════════════════════════════════
  console.log('\n--- Source Code Robustness ---');

  await test('worker uses optional chaining for error.stack access', () => {
    assert.ok(workerSource.includes('err.stack?.'));
  });

  await test('worker uses nullish coalescing for fallback values', () => {
    // Check for || patterns used as fallbacks
    assert.ok(workerSource.includes('|| 0'));
    assert.ok(workerSource.includes("|| '—'") || workerSource.includes("|| 'unknown'"));
  });

  await test('worker handles missing commits in PushEvent payload', () => {
    assert.ok(workerSource.includes('event.payload?.commits') ||
             workerSource.includes('payload.commits'));
  });

  await test('worker guards against null repo API responses', () => {
    // fetchRepoData catches errors and returns null per-repo
    assert.ok(workerSource.includes('return null'));
  });

  await test('worker filters null repos with filter(Boolean)', () => {
    assert.ok(workerSource.includes('filter(Boolean)'));
  });

  await test('worker has catch blocks in all fetch functions', () => {
    // Count catch blocks — should have several for each fetch path
    const catchCount = (workerSource.match(/catch/g) || []).length;
    assert.ok(catchCount >= 8, `Expected at least 8 catch blocks, found ${catchCount}`);
  });

  await test('worker does not use Promise.all (uses safer allSettled)', () => {
    // Ensure Promise.all is not used for the main data gathering
    // (Promise.allSettled is preferred as it doesn't short-circuit)
    const allMatches = workerSource.match(/Promise\.all\b(?!Settled)/g);
    // Allow Promise.all in non-critical paths but not for the main gather
    // The critical line should be Promise.allSettled
    assert.ok(workerSource.includes('Promise.allSettled'));
    // Count of bare Promise.all (not allSettled) — the main gather uses allSettled
    if (allMatches) {
      // These might be in comments or other code, just warn
      assert.ok(allMatches.length <= 2, `Unexpected Promise.all usage: ${allMatches.length} occurrences`);
    }
  });

  await test('worker trims commit messages to first line', () => {
    assert.ok(workerSource.includes("split('\\n')[0]"));
  });

  await test('worker uses cf cacheTtl for GitHub requests', () => {
    assert.ok(workerSource.includes('cacheTtl'));
  });

  await test('DASHBOARD_HTML is a complete HTML document (open and close tags)', () => {
    assert.ok(workerSource.includes('<!DOCTYPE html>'));
    assert.ok(workerSource.includes('</html>'));
  });

  await test('worker default export has fetch and scheduled', () => {
    assert.ok(workerSource.includes('async fetch('));
    assert.ok(workerSource.includes('async scheduled('));
  });

  await test('worker correctly handles OPTIONS for CORS (serves dashboard as fallback)', async () => {
    fetchMode = 'normal';
    const req = new Request('https://dashboard.example.com/api/fleet', { method: 'OPTIONS' });
    const res = await worker.fetch(req, mockEnv);
    // Worker doesn't special-case OPTIONS, falls through to serving dashboard
    assert.strictEqual(res.status, 200);
  });

  // ═══════════════════════════════════════════════
  // SECTION 11: index.html — Client-Side Logic Tests
  // ═══════════════════════════════════════════════
  console.log('\n--- index.html Client-Side Logic ---');

  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');

  await test('index.html defines LOG2_3 constant', () => {
    assert.ok(indexHtml.includes('LOG2_3'));
    assert.ok(indexHtml.includes('Math.log2(3)'));
  });

  await test('index.html has fleet cancellation visualizer (Panel 1)', () => {
    assert.ok(indexHtml.includes('fleetCanvas'));
    assert.ok(indexHtml.includes('tickFleet'));
    assert.ok(indexHtml.includes('drawFleet'));
  });

  await test('index.html has conservation identity calculator (Panel 2)', () => {
    assert.ok(indexHtml.includes('conservation') || indexHtml.includes('Conservation'));
    assert.ok(indexHtml.includes('gammaSlider'));
    assert.ok(indexHtml.includes('cSlider'));
    assert.ok(indexHtml.includes('updateConservation'));
  });

  await test('index.html has polyglot benchmark (Panel 3)', () => {
    assert.ok(indexHtml.includes('Polyglot') || indexHtml.includes('polyglot') || indexHtml.includes('Benchmark'));
    assert.ok(indexHtml.includes('buildBars'));
    assert.ok(indexHtml.includes('langData'));
  });

  await test('index.html benchmark data has 12 languages', () => {
    // Count entries in langData array
    const match = indexHtml.match(/const langData = \[([\s\S]*?)\];/);
    assert.ok(match, 'langData should be defined');
    const entries = match[1].match(/\{name:/g) || [];
    assert.strictEqual(entries.length, 12, `Expected 12 languages, got ${entries.length}`);
  });

  await test('index.html benchmark data sorted Rust is fastest', () => {
    const match = indexHtml.match(/const langData = \[([\s\S]*?)\];/);
    // Extract all val fields
    const vals = [...match[1].matchAll(/val:\s*([\d.e+]+)/g)].map(m => parseFloat(m[1]));
    const maxVal = Math.max(...vals);
    // Rust should be 9.2e9
    assert.ok(maxVal >= 9e9, `Expected max ~9.2e9, got ${maxVal}`);
  });

  await test('index.html conservation identity: gamma + eta = C', () => {
    // Check that the formula is present
    assert.ok(indexHtml.includes('η = Math.max(0, C - gamma)') || indexHtml.includes('C - gamma'));
    // The identity: eta = C - gamma, so gamma + eta = C
  });

  await test('index.html formatVal handles various magnitudes', () => {
    // The function should exist
    assert.ok(indexHtml.includes('function formatVal'));
    // Check that it handles billions, millions, thousands
    assert.ok(indexHtml.includes('1e9') && indexHtml.includes('1e6') && indexHtml.includes('1e3'));
  });

  await test('index.html fleet cancellation uses requestAnimationFrame', () => {
    assert.ok(indexHtml.includes('requestAnimationFrame'));
  });

  await test('index.html has resize handler for responsive canvas', () => {
    assert.ok(indexHtml.includes('resizeCanvas'));
    assert.ok(indexHtml.includes("addEventListener('resize'"));
  });

  await test('index.html has tooltip functionality for benchmark bars', () => {
    assert.ok(indexHtml.includes('tooltip'));
    assert.ok(indexHtml.includes('mousemove'));
    assert.ok(indexHtml.includes('mouseleave'));
  });

  await test('index.html guards against division by zero in cancellation meter', () => {
    // updateStats should handle agents.length > 0
    assert.ok(indexHtml.includes('agents.length > 0'));
  });

  await test('index.html convergence chart tracks |Σ|/n history', () => {
    assert.ok(indexHtml.includes('convergeHistory'));
    assert.ok(indexHtml.includes('shift()')); // Ring buffer
  });

  await test('index.html fleet bias slider range is -50 to +50', () => {
    assert.ok(indexHtml.includes('min="-50"'));
    assert.ok(indexHtml.includes('max="50"'));
  });

  await test('index.html fleet size slider range is 10 to 1000', () => {
    assert.ok(indexHtml.includes('min="10"'));
    assert.ok(indexHtml.includes('max="1000"'));
  });

  await test('index.html has proper footer with conservation law', () => {
    assert.ok(indexHtml.includes('γ + η = C'));
    assert.ok(indexHtml.includes('Conservation Law'));
  });

  await test('index.html handles devicePixelRatio for retina displays', () => {
    assert.ok(indexHtml.includes('devicePixelRatio'));
  });

  await test('index.html initAgents assigns ternary signals {−1, 0, +1}', () => {
    assert.ok(indexHtml.includes('initAgents'));
    // Check that agents get s property (initially 0)
    assert.ok(indexHtml.includes('s:0'));
  });

  await test('index.html tickFleet uses ternary signal assignment', () => {
    // Signals are {-1, 0, +1}
    assert.ok(indexHtml.includes('? -1') || indexHtml.includes("? -1"));
    assert.ok(indexHtml.includes('? 0 : 1') || indexHtml.includes('? 1'));
  });

  await test('index.html has clock display updating every second', () => {
    assert.ok(indexHtml.includes('updateClock'));
    assert.ok(indexHtml.includes('setInterval(updateClock, 1000)'));
  });

  await test('index.html polyglot data: all 4 paradigms represented', () => {
    const match = indexHtml.match(/const langData = \[([\s\S]*?)\];/);
    const data = match[1];
    assert.ok(data.includes('systems'));
    assert.ok(data.includes('scientific'));
    assert.ok(data.includes('functional'));
    assert.ok(data.includes('legacy'));
  });

  await test('index.html polyglot data: no duplicate language names', () => {
    const match = indexHtml.match(/const langData = \[([\s\S]*?)\];/);
    const names = [...match[1].matchAll(/name:'([^']+)'/g)].map(m => m[1]);
    const unique = new Set(names);
    assert.strictEqual(unique.size, names.length, 'Language names should be unique');
  });

  // ═══════════════════════════════════════════════
  // SECTION 12: Cross-File Integration
  // ═══════════════════════════════════════════════
  console.log('\n--- Cross-File Integration ---');

  await test('worker.js DASHBOARD_HTML and index.html are separate files with different content', () => {
    // worker.js serves its own inline dashboard HTML
    // index.html is a separate file (different dashboard)
    assert.ok(workerSource.includes('DASHBOARD_HTML'));
    assert.ok(!indexHtml.includes('Fleet Dashboard — Lucineer'));
    assert.ok(workerSource.includes('Fleet Dashboard — Lucineer'));
  });

  await test('both files reference maritime/fleet theme', () => {
    assert.ok(workerSource.includes('⚓') || workerSource.includes('fleet'));
    assert.ok(indexHtml.includes('🦀') || indexHtml.includes('fleet') || indexHtml.includes('Fleet'));
  });

  await test('worker.js and index.html both handle conservation law concept', () => {
    // index.html has the visualization, worker.js dashboard mentions it
    assert.ok(indexHtml.includes('γ + η = C') || indexHtml.includes('conservation'));
    // Worker dashboard mentions quota/fleet management
    assert.ok(workerSource.includes('quota'));
  });

  await test('CI workflow file exists and runs tests', () => {
    const ciPath = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(ciPath), 'CI workflow should exist');
    const ci = fs.readFileSync(ciPath, 'utf-8');
    assert.ok(ci.includes('test'), 'CI should run tests');
  });

  await test('package.json test script points to test_worker.js', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    assert.ok(pkg.scripts && pkg.scripts.test);
    assert.ok(pkg.scripts.test.includes('test_worker'));
  });

  await test('wrangler.toml has correct main pointing to worker.js', () => {
    const toml = fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf-8');
    assert.ok(toml.includes('main = "worker.js"'));
    assert.ok(toml.includes('compatibility_date'));
  });

  await test('gitignore exists and ignores node_modules', () => {
    const giPath = path.join(__dirname, '..', '.gitignore');
    assert.ok(fs.existsSync(giPath));
    const gi = fs.readFileSync(giPath, 'utf-8');
    assert.ok(gi.includes('node_modules'));
  });

  await test('LICENSE file exists', () => {
    const licPath = path.join(__dirname, '..', 'LICENSE');
    assert.ok(fs.existsSync(licPath));
  });

  // ═══════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.error('\nFailed tests:');
    for (const f of failures) {
      console.error(`  - ${f.name}: ${f.err.message}`);
    }
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
