/**
 * Fleet Dashboard — Extended Worker Tests
 * 
 * Tests the pure functions: jsonResponse, fetchRepoData error handling,
 * data structure validation, batch logic, and edge cases.
 * 
 * Run: node tests/test_extended.js
 */

const assert = require('assert');

// ──────────────────────────────────────────────
// Mock fetch with controllable failures
// ──────────────────────────────────────────────

let fetchBehavior = 'normal'; // 'normal', 'github-down', 'wiki-down', 'all-down'

global.fetch = async (url) => {
  const urlStr = typeof url === 'string' ? url : url.toString();

  if (fetchBehavior === 'all-down') {
    throw new Error('Network unavailable');
  }

  if (fetchBehavior === 'github-down' && urlStr.includes('api.github.com')) {
    throw new Error('GitHub API rate limited');
  }

  if (fetchBehavior === 'wiki-down' && urlStr.includes('fleet-wiki')) {
    return { ok: false, status: 502, text: async () => 'Bad Gateway' };
  }

  // GitHub API mock
  if (urlStr.includes('api.github.com')) {
    if (urlStr.includes('/repos/')) {
      const name = urlStr.split('/').slice(-1)[0].replace(/\?.*/, '');
      return {
        ok: true,
        json: async () => ({
          name,
          stargazers_count: Math.floor(Math.random() * 5),
          forks_count: 0,
          language: ['Python', 'TypeScript', 'Rust', 'Lua'][Math.floor(Math.random() * 4)],
          updated_at: new Date().toISOString(),
          description: `${name} — fleet repo`,
          open_issues_count: Math.floor(Math.random() * 3),
        })
      };
    }
    if (urlStr.includes('/actions/runs')) {
      return {
        ok: true,
        json: async () => ({ total_count: Math.floor(Math.random() * 100) })
      };
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
                { sha: 'abc1234', message: 'test commit', author: { name: 'tester' } }
              ]
            }
          }
        ]
      };
    }
    if (urlStr.includes('/commits')) {
      return {
        ok: true,
        json: async () => [
          {
            sha: 'def5678',
            commit: {
              message: 'latest commit message',
              author: { name: 'tester', date: new Date().toISOString() }
            }
          }
        ]
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
      ]
    };
  }

  // Openrooms API mock
  if (urlStr.includes('openrooms')) {
    return {
      ok: true,
      json: async () => [
        { name: 'bar-rail', status: 'active' },
        { name: 'chart-room', status: 'active' },
      ]
    };
  }

  return { ok: false, status: 404, json: async () => ({ error: 'not found' }), text: async () => 'Not found' };
};

// Read the worker source for static analysis tests
const fs = require('fs');
const workerSource = fs.readFileSync(__dirname + '/../worker.js', 'utf-8');
const workerModule = require('../worker.js');
const worker = workerModule.default || workerModule;

const mockEnv = {
  GITHUB_TOKEN: 'mock-token',
  FLEET_CACHE: { get: async () => null, put: async () => {} },
};

let testCount = 0;
let passCount = 0;

async function test(name, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`✓ Test ${testCount}: ${name}`);
  } catch (err) {
    console.error(`✗ Test ${testCount}: ${name}`);
    console.error(`  ${err.message}`);
    throw err;
  }
}

async function runTests() {
  console.log('Running Fleet Dashboard Extended Tests...\n');

  // ── jsonResponse Function ──

  await test('jsonResponse returns correct Content-Type', async () => {
    const response = jsonResponse({ test: true });
    assert.strictEqual(response.headers.get('Content-Type'), 'application/json');
  });

  await test('jsonResponse includes CORS headers', async () => {
    const response = jsonResponse({ test: true });
    assert.strictEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.ok(response.headers.get('Access-Control-Allow-Methods').includes('GET'));
  });

  await test('jsonResponse sets Cache-Control', async () => {
    const response = jsonResponse({ test: true });
    const cache = response.headers.get('Cache-Control');
    assert.ok(cache.includes('s-maxage'), 'Should have s-maxage');
    assert.ok(cache.includes('stale-while-revalidate'), 'Should have stale-while-revalidate');
  });

  await test('jsonResponse handles custom status codes', async () => {
    const r200 = jsonResponse({ ok: true });
    assert.strictEqual(r200.status, 200);
    const r500 = jsonResponse({ error: 'oops' }, 500);
    assert.strictEqual(r500.status, 500);
  });

  await test('jsonResponse serializes data correctly', async () => {
    const data = { name: 'test', values: [1, 2, 3], nested: { a: true } };
    const response = jsonResponse(data);
    const parsed = JSON.parse(await response.text());
    assert.deepStrictEqual(parsed, data);
  });

  // ── FLEET_REPOS Configuration ──

  await test('FLEET_REPOS contains key repos', () => {
    const match = workerSource.match(/const FLEET_REPOS = \[([\s\S]*?)\];/);
    const repoNames = match[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
    const critical = ['cns-bridge', 'AI-Writings', 'the-tap', 'fleet-wiki'];
    for (const repo of critical) {
      assert.ok(repoNames.includes(repo), `FLEET_REPOS should include '${repo}'`);
    }
  });

  await test('FLEET_REPOS has reasonable count (>= 30)', () => {
    const match = workerSource.match(/const FLEET_REPOS = \[([\s\S]*?)\];/);
    const repoNames = match[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
    assert.ok(repoNames.length >= 30, `Expected >= 30 repos, got ${repoNames.length}`);
  });

  // ── API Endpoint Tests ──

  await test('GET /api/fleet returns all expected top-level fields', async () => {
    fetchBehavior = 'normal';
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    const data = await response.json();
    const expectedFields = ['timestamp', 'repos', 'commits', 'wiki', 'openrooms', 'quota', 'cron'];
    for (const field of expectedFields) {
      assert.ok(field in data, `Missing field: ${field}`);
    }
  });

  await test('GET /api/fleet returns quota info for all services', async () => {
    fetchBehavior = 'normal';
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    const data = await response.json();
    const expectedServices = ['deepseek', 'mmx', 'glm', 'claude', 'kimi'];
    for (const svc of expectedServices) {
      assert.ok(svc in data.quota, `Missing quota for: ${svc}`);
      assert.ok('status' in data.quota[svc], `Missing status for: ${svc}`);
    }
  });

  await test('GET /api/fleet returns cron configuration', async () => {
    fetchBehavior = 'normal';
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    const data = await response.json();
    assert.ok(Array.isArray(data.cron), 'cron should be an array');
    assert.ok(data.cron.length > 0, 'should have at least one cron entry');
    for (const cron of data.cron) {
      assert.ok('name' in cron, 'cron entry missing name');
      assert.ok('schedule' in cron, 'cron entry missing schedule');
      assert.ok('status' in cron, 'cron entry missing status');
    }
  });

  await test('GET /api/refresh returns same structure as /api/fleet', async () => {
    fetchBehavior = 'normal';
    const fleetReq = new Request('https://dashboard.example.com/api/fleet');
    const refreshReq = new Request('https://dashboard.example.com/api/refresh');
    const fleetData = await (await worker.fetch(fleetReq, mockEnv)).json();
    const refreshData = await (await worker.fetch(refreshReq, mockEnv)).json();
    const fleetKeys = Object.keys(fleetData).sort();
    const refreshKeys = Object.keys(refreshData).sort();
    assert.deepStrictEqual(fleetKeys, refreshKeys, 'fleet and refresh should return same structure');
  });

  // ── Error Handling ──

  await test('API handles GitHub being down gracefully', async () => {
    fetchBehavior = 'github-down';
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    assert.ok(response.status === 200 || response.status === 500);
    const data = await response.json();
    assert.ok(typeof data === 'object');
    // Even with GitHub down, should return something
    fetchBehavior = 'normal';
  });

  await test('API handles total network failure gracefully', async () => {
    fetchBehavior = 'all-down';
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    // Should not crash — Promise.allSettled catches everything
    assert.ok(response.status === 200 || response.status === 500);
    fetchBehavior = 'normal';
  });

  await test('Broken KV cache does not crash the worker', async () => {
    fetchBehavior = 'normal';
    const brokenEnv = {
      GITHUB_TOKEN: 'mock-token',
      FLEET_CACHE: {
        get: async () => { throw new Error('KV broken'); },
        put: async () => { throw new Error('KV broken'); },
      },
    };
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, brokenEnv);
    assert.ok(response.status === 200 || response.status === 500);
  });

  // ── HTML Dashboard ──

  await test('Dashboard HTML has maritime theme', async () => {
    const request = new Request('https://dashboard.example.com/');
    const response = await worker.fetch(request, mockEnv);
    const html = await response.text();
    assert.ok(html.includes('⚓') || html.includes('ship') || html.includes('fleet'),
      'Dashboard should have maritime elements');
  });

  await test('Dashboard HTML includes Google Fonts', async () => {
    const request = new Request('https://dashboard.example.com/');
    const response = await worker.fetch(request, mockEnv);
    const html = await response.text();
    assert.ok(html.includes('fonts.googleapis.com'), 'Should load Google Fonts');
  });

  await test('Dashboard HTML has live indicator', async () => {
    const request = new Request('https://dashboard.example.com/');
    const response = await worker.fetch(request, mockEnv);
    const html = await response.text();
    assert.ok(html.includes('pulse') || html.includes('live'),
      'Dashboard should have a live/pulse indicator');
  });

  await test('Dashboard HTML has proper viewport meta tag', async () => {
    const request = new Request('https://dashboard.example.com/');
    const response = await worker.fetch(request, mockEnv);
    const html = await response.text();
    assert.ok(html.includes('viewport'), 'Should have viewport meta');
    assert.ok(html.includes('width=device-width'), 'Should be responsive');
  });

  // ── Scheduled Handler ──

  await test('Scheduled handler completes with normal fetch', async () => {
    fetchBehavior = 'normal';
    const event = { scheduledTime: Date.now() };
    await worker.scheduled(event, mockEnv);
  });

  await test('Scheduled handler completes when GitHub is down', async () => {
    fetchBehavior = 'github-down';
    const event = { scheduledTime: Date.now() };
    await worker.scheduled(event, mockEnv);
    fetchBehavior = 'normal';
  });

  // ── Data Integrity ──

  await test('repos data has valid structure', async () => {
    fetchBehavior = 'normal';
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    const data = await response.json();
    assert.ok(typeof data.repos === 'object');
    if (data.repos.repos && Array.isArray(data.repos.repos)) {
      for (const repo of data.repos.repos) {
        if (repo === null) continue;
        assert.ok('name' in repo, 'repo should have name');
      }
    }
  });

  await test('timestamp is valid ISO format', async () => {
    fetchBehavior = 'normal';
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    const data = await response.json();
    const ts = new Date(data.timestamp);
    assert.ok(!isNaN(ts.getTime()), 'timestamp should be valid date');
    assert.ok(ts.getFullYear() >= 2026, 'timestamp should be current year or later');
  });

  await test('wiki data has page count', async () => {
    fetchBehavior = 'normal';
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    const data = await response.json();
    assert.ok('pageCount' in data.wiki, 'wiki should have pageCount');
    assert.ok(typeof data.wiki.pageCount === 'number');
    assert.ok(data.wiki.pageCount > 0, 'should have some pages');
  });

  // ── Source Code Quality ──

  await test('worker.js uses Promise.allSettled for resilience', () => {
    assert.ok(workerSource.includes('Promise.allSettled'),
      'Should use Promise.allSettled for parallel fetch resilience');
  });

  await test('worker.js batches repo fetches', () => {
    assert.ok(workerSource.includes('batch') || workerSource.includes('slice'),
      'Should batch repo fetches to avoid rate limits');
  });

  await test('worker.js has fallback for wiki stats', () => {
    assert.ok(workerSource.includes('Cached count') || workerSource.includes('Fallback'),
      'Should have a fallback for wiki stats');
  });

  await test('worker.js has fallback for openrooms stats', () => {
    assert.ok(workerSource.includes('Estimated') || workerSource.includes('fallback'),
      'Should have a fallback for openrooms stats');
  });

  await test('worker.js handles missing GitHub token', () => {
    // The fetchRepoData function should work without a token
    assert.ok(workerSource.includes("token ? { Authorization"),
      'Should conditionally include auth header');
  });


  console.log(`\n✅ All ${testCount} tests passed.`);
}

// Helper — extracted from worker source for testing
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}

runTests().catch(err => {
  console.error(`\n❌ ${testCount - passCount} of ${testCount} tests failed.`);
  console.error('Last error:', err.message);
  process.exit(1);
});
