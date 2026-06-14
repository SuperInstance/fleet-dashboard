// server.js — Express server with REST API + WebSocket push updates
// ==================================================================

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const gh = require('./lib/gh-cache');
const agents = require('./lib/agents');

const PORT = process.env.PORT || 8890;

const app = express();

// ─── Middleware ────────────────────────────────────────────────────
app.use(cors());
app.use(compression());
app.use(express.json());

// Simple JSON request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// ─── API Routes ───────────────────────────────────────────────────

// Health
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    cache: gh.getCacheStats(),
    rateLimit: gh.getRateLimitStatus(),
    wsClients: wss ? wss.clients.size : 0,
  });
});

// Org stats
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await gh.getOrgStats();
    res.json(stats);
  } catch (err) {
    console.error('[stats]', err.message);
    res.status(500).json({ error: 'Failed to fetch stats', message: err.message });
  }
});

// All repos
app.get('/api/repos', async (req, res) => {
  try {
    const repos = await gh.getOrgRepos();
    if (!Array.isArray(repos)) {
      return res.json([]);
    }
    const mapped = repos.map(r => ({
      name: r.name,
      full_name: r.full_name,
      description: r.description,
      language: r.language || 'Unknown',
      stars: r.stargazers_count || 0,
      forks: r.forks_count || 0,
      open_issues: r.open_issues_count || 0,
      topics: r.topics || [],
      html_url: r.html_url,
      updated_at: r.updated_at,
      pushed_at: r.pushed_at,
      size: r.size,
      is_fork: r.fork,
      is_archived: r.archived,
      license: r.license?.spdx_id || null,
    }));
    res.json(mapped);
  } catch (err) {
    console.error('[repos]', err.message);
    res.status(500).json({ error: 'Failed to fetch repos', message: err.message });
  }
});

// Single repo
app.get('/api/repos/:name', async (req, res) => {
  try {
    const repo = await gh.getRepo(req.params.name);
    if (!repo) {
      return res.status(404).json({ error: 'Repo not found' });
    }
    res.json({
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      language: repo.language || 'Unknown',
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      open_issues: repo.open_issues_count || 0,
      topics: repo.topics || [],
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      ssh_url: repo.ssh_url,
      homepage: repo.homepage,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
      pushed_at: repo.pushed_at,
      size: repo.size,
      default_branch: repo.default_branch,
      is_fork: repo.fork,
      is_archived: repo.archived,
      license: repo.license?.spdx_id || null,
      watchers: repo.watchers_count || 0,
    });
  } catch (err) {
    console.error(`[repo:${req.params.name}]`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Repo README
app.get('/api/repos/:name/readme', async (req, res) => {
  try {
    const readme = await gh.getRepoReadme(req.params.name);
    if (readme.error === 'not_found') {
      return res.status(404).json({ error: 'No README found' });
    }
    if (readme.error) {
      return res.status(502).json({ error: 'Failed to fetch README' });
    }
    res.json(readme);
  } catch (err) {
    console.error(`[readme:${req.params.name}]`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Recent commits (last 24h default)
app.get('/api/commits', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours || '24', 10);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const commits = await gh.getRecentCommits(since);
    res.json(commits);
  } catch (err) {
    console.error('[commits]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Dependency graph
app.get('/api/graph', async (req, res) => {
  try {
    const repos = await gh.getOrgRepos();
    if (!Array.isArray(repos)) {
      return res.json({ nodes: [], edges: [] });
    }

    const nodes = repos.map(r => ({
      id: r.name,
      name: r.name,
      language: r.language || 'Unknown',
      stars: r.stargazers_count || 0,
      description: r.description || '',
      topics: r.topics || [],
    }));

    // Generate edges based on shared topics, naming patterns, and language
    const edges = [];
    const edgeSet = new Set();

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let weight = 0;

        // Same language
        if (a.language === b.language) weight += 0.3;

        // Shared topics
        const sharedTopics = a.topics.filter(t => b.topics.includes(t));
        weight += sharedTopics.length * 0.2;

        // Naming prefix (flux-, ternary-, fleet-, conservation-, gc-)
        const prefixes = ['flux', 'ternary', 'fleet', 'conservation', 'gc', 'eco', 'baton', 'native'];
        const aPrefix = prefixes.find(p => a.id.startsWith(p));
        const bPrefix = prefixes.find(p => b.id.startsWith(p));
        if (aPrefix && aPrefix === bPrefix) weight += 0.5;

        if (weight > 0) {
          // Avoid duplicate edges by using a sorted key
          const key = [a.id, b.id].sort().join('::');
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({
              source: a.id,
              target: b.id,
              weight: Math.round(weight * 10) / 10,
              sharedTopics,
            });
          }
        }
      }
    }

    res.json({ nodes, edges });
  } catch (err) {
    console.error('[graph]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bottle dispatch
app.get('/api/dispatch/:action', (req, res) => {
  const { action } = req.params;
  const payload = req.query.payload ? safeParse(req.query.payload) : null;
  const target = req.query.target || null;

  const available = agents.getAvailableActions();
  if (!available.includes(action)) {
    return res.status(400).json({
      error: `Unknown action "${action}"`,
      available_actions: available,
    });
  }

  const result = agents.routeBottle(action, payload, target);
  res.json(result);
});

// Agent list
app.get('/api/agents', (req, res) => {
  res.json(agents.getAllAgents());
});

// Agent detail
app.get('/api/agents/:name', (req, res) => {
  const a = agents.getAgent(req.params.name);
  if (!a) return res.status(404).json({ error: 'Agent not found' });
  res.json(a);
});

// Available actions
app.get('/api/actions', (req, res) => {
  res.json(agents.getAvailableActions());
});

// Ternary matrix
app.get('/api/ternary-matrix', (req, res) => {
  const method = req.query.method || 'random';
  const size = parseInt(req.query.size || '8', 10);
  const matrix = [];

  for (let i = 0; i < size; i++) {
    const row = [];
    for (let j = 0; j < size; j++) {
      let val;
      if (method === 'gaussian') {
        const g = Math.random() + Math.random() + Math.random() - 1.5;
        val = g > 0.5 ? 1 : g < -0.5 ? -1 : 0;
      } else {
        val = Math.random() < 0.4 ? 1 : Math.random() < 0.5 ? 0 : -1;
      }
      row.push(val);
    }
    matrix.push(row);
  }

  // Input vector
  const input = [1, -1, 0, 1, -1, 0, 1, -1];
  const x = [];
  for (let i = 0; i < size; i++) {
    x.push(input[i % input.length]);
  }

  // Forward pass
  let result = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      result += matrix[i][j] * x[j];
    }
  }

  // Stats
  let plus = 0, minus = 0, zero = 0;
  for (const row of matrix) {
    for (const val of row) {
      if (val === 1) plus++;
      else if (val === -1) minus++;
      else zero++;
    }
  }

  res.json({
    size,
    method,
    matrix,
    input: x,
    forwardPass: result,
    stats: { plus, minus, zero, total: size * size, fpMultiplications: 0 },
    timestamp: new Date().toISOString(),
  });
});

// ─── WebSocket ─────────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log(`[ws] Client connected (total: ${wss.clients.size})`);

  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to Fleet Dashboard Live',
    agents: agents.getAllAgents(),
  }));

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWSMessage(ws, msg);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    console.log(`[ws] Client disconnected (total: ${wss.clients.size})`);
  });

  ws.on('error', (err) => {
    console.error('[ws] Client error:', err.message);
  });
});

async function handleWSMessage(ws, msg) {
  switch (msg.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;

    case 'dispatch': {
      const { action, payload, target } = msg;
      const result = agents.routeBottle(action, payload, target);
      ws.send(JSON.stringify({
        type: 'dispatch_result',
        ...result,
      }));
      break;
    }

    case 'subscribe_fleet': {
      // This would start a periodic push for fleet updates
      // For now, send a snapshot
      const repos = await gh.getOrgRepos();
      const stats = await gh.getOrgStats();
      ws.send(JSON.stringify({
        type: 'fleet_snapshot',
        stats,
        agents: agents.getAllAgents(),
        repoCount: Array.isArray(repos) ? repos.length : 0,
      }));
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
  }
}

// Broadcast to all connected ws clients
function broadcast(data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

// Periodic fleet pulse broadcast (every 30s)
setInterval(() => {
  broadcast({
    type: 'fleet_pulse',
    timestamp: new Date().toISOString(),
    agents: agents.getAllAgents(),
  });
}, 30000);

// ─── Start ────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n  🦞 SuperInstance Fleet Dashboard Backend`);
  console.log(`  ────────────────────────────────────────`);
  console.log(`  REST API   → http://localhost:${PORT}/api/stats`);
  console.log(`  WebSocket  → ws://localhost:${PORT}/ws`);
  console.log(`  Dashboard  → http://localhost:${PORT}/`);
  console.log(`  Health     → http://localhost:${PORT}/health`);
  console.log(`  Cache: ${gh.getCacheStats().entries} entries`);
  console.log(`  Auth: ${gh.getRateLimitStatus().authenticated ? '✅ GitHub token' : '⚠️  No token (unauthenticated)'}`);
  console.log(`\n  Fleet ready. γ + η = C\n`);
});

// ─── Helpers ──────────────────────────────────────────────────────

function safeParse(str) {
  try { return JSON.parse(str); } catch { return str; }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n  Shutting down...');
  wss.close();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  wss.close();
  server.close(() => process.exit(0));
});
