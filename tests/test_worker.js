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

  console.log('\n✅ All 5 tests passed.');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
