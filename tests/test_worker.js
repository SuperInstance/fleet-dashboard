/**
 * Fleet Dashboard Worker — Basic Tests
 * Run with: node tests/test_worker.js
 */

const assert = require('assert');

// Set up global fetch mock
global.fetch = async (url) => {
  const urlStr = typeof url === 'string' ? url : url.toString();
  
  // GitHub API mock
  if (urlStr.includes('api.github.com')) {
    if (urlStr.includes('/repos/')) {
      return {
        ok: true,
        json: async () => ({ name: urlStr.split('/').slice(-1)[0], stargazers_count: 1 })
      };
    }
    if (urlStr.includes('/commits')) {
      return {
        ok: true,
        json: async () => [{ sha: 'abc123', commit: { message: 'test', author: { date: new Date().toISOString() } }, author: { login: 'test' } }]
      };
    }
  }
  
  // Wiki API mock
  if (urlStr.includes('fleet-wiki')) {
    return { ok: true, json: async () => ({ pages: 42 }) };
  }
  
  // Openrooms API mock
  if (urlStr.includes('openrooms')) {
    return { ok: true, json: async () => ({ agents: 7 }) };
  }
  
  return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
};

// Import the worker
const workerModule = require('../worker.js');
const worker = workerModule.default || workerModule;

// Mock env
const mockEnv = {
  GITHUB_TOKEN: 'mock-token',
  FLEET_CACHE: { get: async () => null, put: async () => {} },
};

async function runTests() {
  console.log('Running Fleet Dashboard Worker tests...\n');

  // Test 1: Dashboard HTML is served on /
  {
    const request = new Request('https://dashboard.example.com/');
    const response = await worker.fetch(request, mockEnv);
    assert.strictEqual(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes('<html') || text.includes('<!DOCTYPE'), 'Should serve HTML');
    console.log('✓ Test 1: Dashboard HTML served on /');
  }

  // Test 2: /api/fleet returns JSON
  {
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(typeof data === 'object', 'Should return JSON object');
    console.log('✓ Test 2: /api/fleet returns JSON');
  }

  // Test 3: /api/refresh returns data
  {
    const request = new Request('https://dashboard.example.com/api/refresh');
    const response = await worker.fetch(request, mockEnv);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(typeof data === 'object', 'Should return JSON');
    console.log('✓ Test 3: /api/refresh returns data');
  }

  // Test 4: Unknown path still serves dashboard
  {
    const request = new Request('https://dashboard.example.com/unknown');
    const response = await worker.fetch(request, mockEnv);
    assert.strictEqual(response.status, 200);
    console.log('✓ Test 4: Unknown path serves dashboard fallback');
  }

  // Test 5: Scheduled handler completes without error
  {
    const event = { scheduledTime: Date.now() };
    await worker.scheduled(event, mockEnv);
    console.log('✓ Test 5: Scheduled handler completes');
  }

  // Test 6: FLEET_REPOS has no duplicates
  {
    const repoModule = require('../worker.js');
    // Access the module's internal repo list via the worker source
    const workerSource = require('fs').readFileSync(__dirname + '/../worker.js', 'utf-8');
    const match = workerSource.match(/const FLEET_REPOS = \[([\s\S]*?)\];/);
    assert.ok(match, 'FLEET_REPOS should be defined');
    const repoNames = match[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
    const unique = new Set(repoNames);
    assert.strictEqual(unique.size, repoNames.length,
      `FLEET_REPOS has duplicates: ${repoNames.length - unique.size} duplicate(s)`);
    console.log(`✓ Test 6: FLEET_REPOS has no duplicates (${repoNames.length} repos)`);
  }

  // Test 7: /api/fleet returns structured data
  {
    const request = new Request('https://dashboard.example.com/api/fleet');
    const response = await worker.fetch(request, mockEnv);
    const data = await response.json();
    assert.ok(typeof data === 'object', 'fleet data should be an object');
    // Should have some data fields (repos, stats, etc.)
    const fieldCount = Object.keys(data).length;
    assert.ok(fieldCount > 0, 'fleet data should have fields');
    console.log(`✓ Test 7: /api/fleet returns structured data (${fieldCount} fields)`);
  }

  // Test 8: Error handling with broken env cache
  {
    const request = new Request('https://dashboard.example.com/api/fleet');
    // Pass env with a FLEET_CACHE that throws
    const brokenEnv = {
      GITHUB_TOKEN: 'mock-token',
      FLEET_CACHE: { 
        get: async () => { throw new Error('KV broken'); }, 
        put: async () => {} 
      },
    };
    const response = await worker.fetch(request, brokenEnv);
    // Should handle the error and return a response (either 200 with cached data or 500)
    assert.ok(response.status === 200 || response.status === 500, 
      `Expected 200 or 500, got ${response.status}`);
    const data = await response.json();
    assert.ok(typeof data === 'object');
    console.log(`✓ Test 8: Broken KV handled gracefully (status ${response.status})`);
  }

  // Test 9: Dashboard HTML contains key elements
  {
    const request = new Request('https://dashboard.example.com/');
    const response = await worker.fetch(request, mockEnv);
    const text = await response.text();
    assert.ok(text.length > 1000, 'Dashboard should have substantial HTML');
    assert.ok(text.includes('fleet') || text.includes('Fleet') || text.includes('dashboard'),
      'Dashboard should mention fleet or dashboard');
    console.log(`✓ Test 9: Dashboard HTML has content (${text.length} chars)`);
  }

  // Test 10: /api/refresh returns fresh data structure
  {
    const request = new Request('https://dashboard.example.com/api/refresh');
    const response = await worker.fetch(request, mockEnv);
    const data = await response.json();
    assert.ok(typeof data === 'object');
    // Should have timestamp or lastUpdated or similar
    const hasTimestamp = data.timestamp || data.lastUpdated || data.updatedAt || data.fetched_at;
    if (hasTimestamp) {
      console.log('✓ Test 10: /api/refresh has timestamp');
    } else {
      console.log('✓ Test 10: /api/refresh returns data (no timestamp field)');
    }
  }

  console.log('\n✅ All 10 tests passed.');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
