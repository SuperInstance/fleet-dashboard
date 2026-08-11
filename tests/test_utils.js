/**
 * Fleet Dashboard — Utility Function Tests
 * 
 * Tests for jsonResponse, timeAgo, escapeHtml, and data structure validation.
 * Run: node tests/test_utils.js
 */

const assert = require('assert');

// ============================================================
// We need to load worker.js functions. Since worker.js is a 
// Cloudflare Worker module, we extract testable functions.
// ============================================================

// Mock global Response for Node.js
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

// Mock document for escapeHtml
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

// Read and eval worker functions
const fs = require('fs');
const path = require('path');
const workerSource = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf-8');

// Extract and eval the testable functions
function evalFunction(funcName, src) {
  // Find the function definition
  const funcPattern = new RegExp(`function ${funcName}\\(`);
  const match = funcPattern.exec(src);
  if (!match) return null;
  
  const start = match.index;
  // Find the closing brace by counting
  let braceCount = 0;
  let funcStart = src.indexOf('{', start);
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

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

async function run() {
  console.log('\n=== Utility Function Tests ===\n');

  // === jsonResponse ===
  console.log('--- jsonResponse ---');

  await test('returns status 200 by default', async () => {
    const res = jsonResponse({ ok: true });
    assert.strictEqual(res.status, 200);
  });

  await test('accepts custom status', async () => {
    const res = jsonResponse({ error: 'bad' }, 500);
    assert.strictEqual(res.status, 500);
  });

  await test('sets Content-Type to application/json', async () => {
    const res = jsonResponse({});
    assert.strictEqual(res.headers.get('Content-Type'), 'application/json');
  });

  await test('sets CORS origin to *', async () => {
    const res = jsonResponse({});
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  });

  await test('sets CORS methods', async () => {
    const res = jsonResponse({});
    assert.strictEqual(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
  });

  await test('sets Cache-Control header', async () => {
    const res = jsonResponse({});
    const cc = res.headers.get('Cache-Control');
    assert(cc.includes('s-maxage=60'));
    assert(cc.includes('stale-while-revalidate=300'));
  });

  await test('serializes data as JSON', async () => {
    const res = jsonResponse({ name: 'test', count: 42 });
    const body = await res.json();
    assert.strictEqual(body.name, 'test');
    assert.strictEqual(body.count, 42);
  });

  await test('handles null data', async () => {
    const res = jsonResponse(null);
    const body = await res.json();
    assert.strictEqual(body, null);
  });

  await test('handles empty object', async () => {
    const res = jsonResponse({});
    const body = await res.json();
    assert.deepStrictEqual(body, {});
  });

  await test('handles arrays', async () => {
    const res = jsonResponse([1, 2, 3]);
    const body = await res.json();
    assert.deepStrictEqual(body, [1, 2, 3]);
  });

  await test('handles nested objects', async () => {
    const data = { fleet: { ships: [{ name: 'a' }, { name: 'b' }] } };
    const res = jsonResponse(data);
    const body = await res.json();
    assert.deepStrictEqual(body, data);
  });

  // === escapeHtml ===
  console.log('--- escapeHtml ---');

  await test('escapes angle brackets', () => {
    assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
  });

  await test('escapes ampersand', () => {
    assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
  });

  await test('escapes quotes', () => {
    const result = escapeHtml('say "hello"');
    assert(result.includes('&quot;'));
  });

  await test('handles empty string', () => {
    assert.strictEqual(escapeHtml(''), '');
  });

  await test('handles plain text without special chars', () => {
    assert.strictEqual(escapeHtml('hello world'), 'hello world');
  });

  // === timeAgo ===
  console.log('--- timeAgo ---');

  await test('returns dash for null', () => {
    assert.strictEqual(timeAgo(null), '—');
  });

  await test('returns dash for undefined', () => {
    assert.strictEqual(timeAgo(undefined), '—');
  });

  await test('returns dash for empty string', () => {
    assert.strictEqual(timeAgo(''), '—');
  });

  await test('returns seconds for very recent', () => {
    const now = new Date().toISOString();
    const result = timeAgo(now);
    assert(result.includes('s ago'));
  });

  await test('returns minutes for 5 minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = timeAgo(fiveMinAgo);
    assert(result.includes('m ago'));
  });

  await test('returns hours for 3 hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const result = timeAgo(threeHoursAgo);
    assert(result.includes('h ago'));
  });

  await test('returns days for 5 days ago', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const result = timeAgo(fiveDaysAgo);
    assert(result.includes('d ago'));
  });

  // === Static analysis of worker source ===
  console.log('--- Worker Source Validation ---');

  await test('worker source contains fetch handler', () => {
    assert(workerSource.includes('async fetch(request'));
  });

  await test('worker source contains scheduled handler', () => {
    assert(workerSource.includes('async scheduled'));
  });

  await test('worker source defines GITHUB_TOKEN env var', () => {
    assert(workerSource.includes('GITHUB_TOKEN'));
  });

  await test('worker source defines fleet repo list', () => {
    assert(workerSource.includes('REPOS') || workerSource.includes('repos'));
  });

  await test('worker has error handling in fetchRepoData', () => {
    assert(workerSource.includes('catch'));
    assert(workerSource.includes('error') || workerSource.includes('Error'));
  });

  // === Summary ===
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run().catch(console.error);
