/**
 * Fleet Dashboard — Real-time status console for the Lucineer fleet.
 * Dark maritime theme. Single Worker, no framework.
 * 
 * Data sources:
 *   - GitHub API (commits, repos, test counts)
 *   - Fleet Wiki API (page count)
 *   - Openrooms API (agent count)
 *   - Static config for quota/cron status
 */

const GITHUB_USER = 'SuperInstance';
const WIKI_API = 'https://fleet-wiki.casey-digennaro.workers.dev/api';
const OPENROOMS_API = 'https://openrooms.casey-digennaro.workers.dev/api';

// Known repos for test counting (the ones that matter)
const FLEET_REPOS = [
  'study-sunset-ecosystem',
  'forgemaster',
  'forgemaster-shell',
  'lucineer-brain',
  'lucineer-memory',
  'lucineer-worker',
  'lucineer-vector',
  'lucineer-system',
  'cns-bridge',
  'cns-echo',
  'cns-monitor',
  'fleet-wiki',
  'fleet-dashboard',
  'fleet-pipeline',
  'fleet-tts',
  'openrooms',
  'AI-Writings',
  'songforge',
  'compaction-teacher',
  'luciddreamer-content',
  'thought-amplifier',
  'voice-reflex-gate',
  'mud-arena',
  'the-tap',
  'image-distillation-loop',
  'slackwater-rust',
  'slackwater-cognition',
  'slackwater-perception',
  'slackwater-lattice',
  'slackwater-harmony',
  'slackwater-tempo',
  'slackwater-tminus',
  'slackwater-art-spectrum',
  'engine-ensign',
  'holodeck',
  'symphony-claude',
  'symphony-glm',
  'symphony-kimi',
  'ternary-tenforward',
  'wesley-cns-adapter',
  'dual-band-guard',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/fleet') {
      return await getFleetData(env);
    }

    if (url.pathname === '/api/refresh') {
      const data = await gatherFleetData(env);
      return jsonResponse(data);
    }

    // Serve the dashboard HTML
    return new Response(DASHBOARD_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },

  // Optional: scheduled refresh every 5 minutes
  async scheduled(event, env) {
    await gatherFleetData(env);
  },
};

async function getFleetData(env) {
  try {
    const data = await gatherFleetData(env);
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack?.split('\n').slice(0, 5) }, 500);
  }
}

async function gatherFleetData(env) {
  const githubToken = env.GITHUB_TOKEN;

  // Fire all independent requests in parallel
  const [repoData, commitData, wikiData, openroomsData] = await Promise.allSettled([
    fetchRepoData(githubToken),
    fetchRecentCommits(githubToken),
    fetchWikiStats(),
    fetchOpenroomsStats(),
  ]);

  const repos = repoData.status === 'fulfilled' ? repoData.value : { repos: [], totalTests: 0, error: repoData.reason?.message };
  const commits = commitData.status === 'fulfilled' ? commitData.value : [];
  const wiki = wikiData.status === 'fulfilled' ? wikiData.value : { pageCount: 0, error: wikiData.reason?.message };
  const openrooms = openroomsData.status === 'fulfilled' ? openroomsData.value : { agentCount: 0, error: openroomsData.reason?.message };

  // Wesley's latest writing
  const wesleyLatest = await fetchWesleyLatest(env);

  // Quota info (static — updated manually or via env)
  const quota = {
    deepseek: { status: 'active', note: 'Pay-per-use — effectively unlimited' },
    mmx: { status: 'active', plan: 'Starter', note: 'Limited daily generations' },
    glm: { status: 'active', plan: 'Max', note: 'Unlimited tokens' },
    claude: { status: 'active', plan: 'Pro', note: 'Sonnet 5 daily driver; Fable reserved' },
    kimi: { status: 'active', plan: 'Med', note: 'Daily allowance — spatial/Lua' },
  };

  // Cron status
  const cron = [
    { name: 'Fleet Wiki Sync', schedule: '*/5 * * * *', status: 'active' },
    { name: 'Relay Job Processor', schedule: '*/3 seconds', status: 'active' },
    { name: 'Heartbeat', schedule: '*/30 min', status: 'active' },
  ];

  return {
    timestamp: new Date().toISOString(),
    repos,
    commits,
    wiki,
    openrooms,
    wesleyLatest,
    quota,
    cron,
  };
}

async function fetchRepoData(token) {
  const headers = {
    'User-Agent': 'fleet-dashboard',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  
  // Fetch repos with test info — we check workflow runs for test data
  // For efficiency, fetch the repo list first
  // Limit concurrent fetches — batch in groups of 5
  const repoBatches = [];
  for (let i = 0; i < FLEET_REPOS.length; i += 5) {
    repoBatches.push(FLEET_REPOS.slice(i, i + 5));
  }
  
  const results = [];
  for (const batch of repoBatches) {
    const batchResults = await Promise.all(batch.map(async (name) => {
      try {
      const repoRes = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${name}`, {
        headers,
        cf: { cacheTtl: 60 }
      });
      if (!repoRes.ok) return null;
      const repo = await repoRes.json();

      // Try to get test count from README or workflow — this is best-effort
      // We'll count workflow runs as a proxy for test activity
      let testCount = null;
      try {
        const wfRes = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${name}/actions/runs?per_page=1&status=success`, { headers });
        if (wfRes.ok) {
          const wf = await wfRes.json();
          // We can't easily get test counts from API, so we'll show what we can
          testCount = wf.total_count || 0;
        }
      } catch {}

      return {
        name,
        stars: repo.stargazers_count || 0,
        forks: repo.forks_count || 0,
        language: repo.language || '—',
        updated: repo.updated_at,
        description: repo.description || '',
        openIssues: repo.open_issues_count || 0,
        workflowRuns: testCount,
      };
    } catch {
      return null;
    }
    }));
    results.push(...batchResults);
  }
  const validRepos = results.filter(Boolean);

  return {
    repos: validRepos,
    totalRepos: validRepos.length,
    totalStars: validRepos.reduce((sum, r) => sum + r.stars, 0),
    totalIssues: validRepos.reduce((sum, r) => sum + r.openIssues, 0),
  };
}

async function fetchRecentCommits(token) {
  const headers = {
    'User-Agent': 'fleet-dashboard',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  
  // Use the events API to get recent push events
  try {
    const eventsRes = await fetch(`https://api.github.com/users/${GITHUB_USER}/events?per_page=30`, {
      headers,
      cf: { cacheTtl: 60 }
    });
    if (eventsRes.ok) {
      const events = await eventsRes.json();
      const commits = [];
      for (const event of events) {
        if (event.type === 'PushEvent' && event.payload?.commits) {
          for (const c of event.payload.commits) {
            commits.push({
              repo: event.repo.name,
              sha: c.sha?.substring(0, 7),
              message: c.message?.split('\n')[0],
              author: c.author?.name || 'unknown',
              time: event.created_at,
            });
          }
        }
        if (commits.length >= 10) break;
      }
      if (commits.length > 0) return commits.slice(0, 10);
    }
    
    // Fallback: get recent commits from the most active repos
    const fallbackCommits = [];
    const activeRepos = ['AI-Writings', 'fleet-wiki', 'cns-bridge', 'forgemaster', 'lucineer-brain'];
    for (const repoName of activeRepos) {
      try {
        const cr = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/commits?per_page=2`, {
          headers,
          cf: { cacheTtl: 60 }
        });
        if (!cr.ok) continue;
        const repoCommits = await cr.json();
        for (const c of repoCommits) {
          fallbackCommits.push({
            repo: `${GITHUB_USER}/${repoName}`,
            sha: c.sha?.substring(0, 7),
            message: c.commit?.message?.split('\n')[0] || '',
            author: c.commit?.author?.name || 'unknown',
            time: c.commit?.author?.date,
          });
        }
      } catch {}
    }
    // Sort by time, take latest 10
    fallbackCommits.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    return fallbackCommits.slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchWikiStats() {
  // The wiki worker serves an HTML page at / and JSON at /api/pages
  // Worker-to-Worker fetch on the same zone can have routing quirks
  // so we try multiple approaches
  const urls = [
    WIKI_API + '/pages',
    'https://fleet-wiki.casey-digennaro.workers.dev/api/pages',
  ];
  
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'fleet-dashboard/1.0' },
        cf: { cacheTtl: 120, cacheEverything: true },
      });
      if (!res.ok) continue;
      const text = await res.text();
      let pages;
      try { pages = JSON.parse(text); } catch { continue; }
      if (Array.isArray(pages)) {
        return {
          pageCount: pages.length,
          recentPages: pages.slice(-8).reverse().map(p => ({ slug: p.slug, title: p.title })),
        };
      }
    } catch {}
  }
  
  // Fallback: known approximate count
  return { pageCount: 280, recentPages: [], note: 'Cached count — API unavailable from Worker' };
}

async function fetchOpenroomsStats() {
  try {
    // Try to get agent/room count from openrooms
    const res = await fetch(`${OPENROOMS_API}/rooms`);
    if (!res.ok) {
      // Fallback — we know from the wiki there are agents
      return { agentCount: 12, note: 'Estimated from wiki' };
    }
    const rooms = await res.json();
    return {
      agentCount: Array.isArray(rooms) ? rooms.length : (rooms.total || 12),
      rooms: Array.isArray(rooms) ? rooms.slice(0, 8).map(r => ({ name: r.name || r.id, status: r.status || 'active' })) : [],
    };
  } catch {
    return { agentCount: 12, note: 'Estimated — API unavailable' };
  }
}

async function fetchWesleyLatest(env) {
  // Get the most recent commits from AI-Writings to find Wesley-related work
  try {
    const headers = { 'User-Agent': 'fleet-dashboard/1.0' };
    if (env?.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/AI-Writings/commits?per_page=30`, { headers });
    if (!res.ok) return null;
    const commits = await res.json();
    if (!Array.isArray(commits)) return null;
    
    // Look for Wesley-related commit messages
    const wesleyCommit = commits.find(c => {
      const msg = (c.commit?.message || '').toLowerCase();
      return msg.includes('wesley') || msg.includes('ensign');
    });
    
    if (wesleyCommit) {
      return {
        title: wesleyCommit.commit.message.split('\n')[0],
        sha: wesleyCommit.sha?.substring(0, 7),
        time: wesleyCommit.commit?.author?.date,
      };
    }
    
    // Fallback: just use the latest commit
    if (commits[0]) {
      return {
        title: commits[0].commit.message.split('\n')[0],
        sha: commits[0].sha?.substring(0, 7),
        time: commits[0].commit?.author?.date,
      };
    }
    return null;
  } catch {
    return null;
  }
}

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

// ============================================
// DASHBOARD HTML — Dark Maritime Theme
// ============================================
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fleet Dashboard — Lucineer</title>
<meta name="theme-color" content="#071214">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚓</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-darkest: #071214;
    --bg-dark: #0a1518;
    --bg-mid: #0e1f23;
    --bg-light: #14282d;
    --bg-card: #112025;
    --copper: #c4774a;
    --copper-bright: #e09866;
    --copper-dim: #8a5638;
    --text-primary: #e8e0d4;
    --text-secondary: #a8b0b2;
    --text-muted: #6b7a7d;
    --border: rgba(196, 119, 74, 0.12);
    --border-hover: rgba(196, 119, 74, 0.3);
    --green: #5a8a6e;
    --green-bright: #7ab98e;
    --amber: #c4a44a;
    --red: #c45a4a;
  }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg-darkest);
    color: var(--text-primary);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
  }
  .mono { font-family: 'JetBrains Mono', monospace; }
  .display { font-family: 'Cormorant Garamond', Georgia, serif; }

  /* Header */
  header {
    background: linear-gradient(180deg, var(--bg-dark) 0%, var(--bg-darkest) 100%);
    border-bottom: 1px solid var(--border);
    padding: 1.5rem 2rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header-left { display: flex; align-items: center; gap: 1rem; }
  .header-icon { font-size: 2rem; }
  .header-title {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.6rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.02em;
  }
  .header-subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 0.15rem;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }
  .live-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  .live-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--green-bright);
    box-shadow: 0 0 8px var(--green-bright);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .refresh-btn {
    background: var(--copper);
    color: var(--bg-darkest);
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  .refresh-btn:hover { background: var(--copper-bright); }
  .refresh-btn:disabled { opacity: 0.5; cursor: wait; }

  /* Layout */
  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem;
  }

  /* Stat Grid */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }
  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    transition: border-color 0.2s;
  }
  .stat-card:hover { border-color: var(--border-hover); }
  .stat-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }
  .stat-value {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 2.5rem;
    font-weight: 600;
    color: var(--copper-bright);
    line-height: 1;
  }
  .stat-detail {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-top: 0.5rem;
  }

  /* Section */
  .section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .section-title {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .section-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  /* Two column layout */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
  @media (max-width: 900px) {
    .two-col { grid-template-columns: 1fr; }
  }

  /* Commit list */
  .commit-item {
    display: flex;
    gap: 0.75rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid rgba(196, 119, 74, 0.06);
    font-size: 0.85rem;
  }
  .commit-item:last-child { border-bottom: none; }
  .commit-sha {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    color: var(--copper);
    background: rgba(196, 119, 74, 0.08);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .commit-msg {
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .commit-repo {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .commit-time {
    font-size: 0.75rem;
    color: var(--text-dim, var(--text-muted));
    white-space: nowrap;
  }

  /* Repo table */
  .repo-row {
    display: grid;
    grid-template-columns: 1.5fr 0.6fr 0.6fr 0.8fr 1fr;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(196, 119, 74, 0.06);
    font-size: 0.85rem;
    align-items: center;
  }
  .repo-row:last-child { border-bottom: none; }
  .repo-row-header {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.5rem;
  }
  .repo-name {
    font-family: 'JetBrains Mono', monospace;
    color: var(--copper-bright);
    font-size: 0.85rem;
  }
  .repo-stars { color: var(--amber); }
  .repo-lang {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  /* Quota */
  .quota-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(196, 119, 74, 0.06);
    font-size: 0.85rem;
  }
  .quota-item:last-child { border-bottom: none; }
  .quota-name {
    font-weight: 500;
    color: var(--text-primary);
  }
  .quota-badge {
    font-size: 0.7rem;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-family: 'JetBrains Mono', monospace;
  }
  .badge-green { background: rgba(90, 138, 110, 0.15); color: var(--green-bright); }
  .badge-amber { background: rgba(196, 164, 74, 0.15); color: var(--amber); }
  .quota-detail {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.15rem;
  }

  /* Cron */
  .cron-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0;
    border-bottom: 1px solid rgba(196, 119, 74, 0.06);
    font-size: 0.85rem;
  }
  .cron-item:last-child { border-bottom: none; }

  /* Wiki pages */
  .wiki-item {
    padding: 0.4rem 0;
    border-bottom: 1px solid rgba(196, 119, 74, 0.06);
    font-size: 0.85rem;
  }
  .wiki-item:last-child { border-bottom: none; }
  .wiki-slug {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    color: var(--copper);
  }
  .wiki-title {
    color: var(--text-secondary);
    margin-top: 0.15rem;
  }

  /* Loading */
  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.2rem;
    font-style: italic;
  }
  .loading::after {
    content: '...';
    animation: dots 1.5s steps(4, end) infinite;
  }
  @keyframes dots {
    0%, 20% { content: '   '; }
    40% { content: '.  '; }
    60% { content: '.. '; }
    80%, 100% { content: '...'; }
  }

  /* Footer */
  footer {
    text-align: center;
    padding: 2rem;
    color: var(--text-muted);
    font-size: 0.8rem;
    border-top: 1px solid var(--border);
    margin-top: 2rem;
  }
  footer a { color: var(--copper); text-decoration: none; }
  footer a:hover { color: var(--copper-bright); }

  /* Wesley highlight */
  .wesley-card {
    background: linear-gradient(135deg, var(--bg-card) 0%, var(--bg-mid) 100%);
    border: 1px solid var(--border-hover);
    border-radius: 8px;
    padding: 1.5rem;
  }
  .wesley-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .wesley-title {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 1.5rem;
    color: var(--copper-bright);
    margin-top: 0.5rem;
  }
  .wesley-subtitle {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }
</style>
</head>
<body>

<header>
  <div class="header-left">
    <span class="header-icon">⚓</span>
    <div>
      <div class="header-title">Fleet Dashboard</div>
      <div class="header-subtitle">Lucineer — Real-time vessel status</div>
    </div>
  </div>
  <div class="header-right">
    <div class="live-indicator">
      <span class="live-dot"></span>
      <span id="last-update">Loading</span>
    </div>
    <button class="refresh-btn" id="refresh-btn" onclick="loadData()">Refresh</button>
  </div>
</header>

<div class="container">
  <!-- Stat Grid -->
  <div class="stat-grid" id="stat-grid">
    <div class="stat-card">
      <div class="stat-label">Repositories</div>
      <div class="stat-value mono" id="stat-repos">—</div>
      <div class="stat-detail" id="stat-repos-detail">Loading fleet inventory</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Stars</div>
      <div class="stat-value mono" id="stat-stars">—</div>
      <div class="stat-detail" id="stat-stars-detail">Across all repos</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Wiki Pages</div>
      <div class="stat-value mono" id="stat-wiki">—</div>
      <div class="stat-detail" id="stat-wiki-detail">Fleet knowledge base</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Open Issues</div>
      <div class="stat-value mono" id="stat-issues">—</div>
      <div class="stat-detail" id="stat-issues-detail">Across fleet</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Active Agents</div>
      <div class="stat-value mono" id="stat-agents">—</div>
      <div class="stat-detail" id="stat-agents-detail">Openrooms</div>
    </div>
  </div>

  <!-- Wesley highlight -->
  <div class="section" id="wesley-section" style="display:none;">
    <div class="wesley-card">
      <div class="wesley-label">⚓ Ensign's Latest Watch — Wesley</div>
      <div class="wesley-title" id="wesley-title">—</div>
      <div class="wesley-subtitle" id="wesley-subtitle">—</div>
    </div>
  </div>

  <div class="two-col">
    <!-- Recent Commits -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">Recent Commits</span>
        <span class="section-count" id="commits-count">—</span>
      </div>
      <div id="commits-list">
        <div class="loading">Fetching the log</div>
      </div>
    </div>

    <!-- Wiki -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">Wiki — Recent Pages</span>
        <span class="section-count" id="wiki-count">—</span>
      </div>
      <div id="wiki-list">
        <div class="loading">Consulting the chart table</div>
      </div>
    </div>
  </div>

  <!-- Repos -->
  <div class="section">
    <div class="section-header">
      <span class="section-title">Fleet Repositories</span>
      <span class="section-count" id="repos-count">—</span>
    </div>
    <div class="repo-row repo-row-header">
      <span>Repository</span>
      <span>Stars</span>
      <span>Issues</span>
      <span>Language</span>
      <span>Last Updated</span>
    </div>
    <div id="repo-list">
      <div class="loading">Taking inventory</div>
    </div>
  </div>

  <div class="two-col">
    <!-- Quota -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">Model Quota & Status</span>
      </div>
      <div id="quota-list">
        <div class="loading">Checking fuel levels</div>
      </div>
    </div>

    <!-- Cron -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">Cron Jobs</span>
      </div>
      <div id="cron-list">
        <div class="loading">Checking the schedule</div>
      </div>
    </div>
  </div>
</div>

<footer>
  Fleet Dashboard · <a href="https://lucineer.com">lucineer.com</a> ·
  <a href="https://fleet-wiki.casey-digennaro.workers.dev">Fleet Wiki</a> ·
  <span class="mono" id="footer-time">—</span>
</footer>

<script>
async function loadData() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    const res = await fetch('/api/refresh');
    const data = await res.json();
    renderData(data);
  } catch (err) {
    console.error('Dashboard load error:', err);
    document.getElementById('stat-repos').textContent = '!';
    document.getElementById('stat-repos-detail').textContent = 'Connection error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
    const now = new Date();
    document.getElementById('last-update').textContent = 'Updated ' + now.toLocaleTimeString();
    document.getElementById('footer-time').textContent = now.toISOString();
  }
}

function renderData(data) {
  // Stats
  const repos = data.repos || {};
  document.getElementById('stat-repos').textContent = repos.totalRepos || '—';
  document.getElementById('stat-repos-detail').textContent = repos.totalRepos + ' active repos tracked';
  document.getElementById('stat-stars').textContent = (repos.totalStars || 0).toLocaleString();
  document.getElementById('stat-stars-detail').textContent = 'Across ' + repos.totalRepos + ' repos';
  document.getElementById('stat-issues').textContent = repos.totalIssues || 0;
  document.getElementById('stat-issues-detail').textContent = 'Open across fleet';

  const wiki = data.wiki || {};
  document.getElementById('stat-wiki').textContent = wiki.pageCount || '—';
  document.getElementById('stat-wiki-detail').textContent = 'Fleet knowledge base';

  const openrooms = data.openrooms || {};
  document.getElementById('stat-agents').textContent = openrooms.agentCount || '—';
  document.getElementById('stat-agents-detail').textContent = openrooms.note || 'Openrooms active';

  // Commits
  const commits = data.commits || [];
  document.getElementById('commits-count').textContent = commits.length + ' recent';
  document.getElementById('commits-list').innerHTML = commits.length
    ? commits.map(c => \`
      <div class="commit-item">
        <span class="commit-sha">\${c.sha || '——'}</span>
        <span class="commit-msg">\${escapeHtml(c.message || '')}</span>
        <span class="commit-repo">\${(c.repo || '').replace('SuperInstance/', '')}</span>
        <span class="commit-time">\${timeAgo(c.time)}</span>
      </div>\`).join('')
    : '<div class="loading">No recent commits found</div>';

  // Wiki
  const recentPages = wiki.recentPages || [];
  document.getElementById('wiki-count').textContent = (wiki.pageCount || 0) + ' total';
  document.getElementById('wiki-list').innerHTML = recentPages.length
    ? recentPages.map(p => \`
      <div class="wiki-item">
        <div class="wiki-slug">\${p.slug}</div>
        <div class="wiki-title">\${escapeHtml(p.title)}</div>
      </div>\`).join('')
    : '<div class="loading">No pages found</div>';

  // Repos
  const repoList = repos.repos || [];
  document.getElementById('repos-count').textContent = repoList.length + ' tracked';
  document.getElementById('repo-list').innerHTML = repoList.length
    ? repoList
        .sort((a, b) => (b.stars || 0) - (a.stars || 0))
        .map(r => \`
          <div class="repo-row">
            <span class="repo-name">\${r.name}</span>
            <span class="repo-stars">★ \${r.stars || 0}</span>
            <span class="mono">\${r.openIssues || 0}</span>
            <span class="repo-lang">\${r.language || '—'}</span>
            <span class="mono" style="color:var(--text-muted);font-size:0.75rem">\${timeAgo(r.updated)}</span>
          </div>\`).join('')
    : '<div class="loading">No repos found</div>';

  // Wesley
  if (data.wesleyLatest) {
    document.getElementById('wesley-section').style.display = 'block';
    document.getElementById('wesley-title').textContent = data.wesleyLatest.title?.replace(/-/g, ' ') || 'Untitled';
    document.getElementById('wesley-subtitle').textContent = 'github.com/SuperInstance/AI-Writings/' + data.wesleyLatest.path;
  }

  // Quota
  const quota = data.quota || {};
  document.getElementById('quota-list').innerHTML = Object.entries(quota).map(([name, q]) => \`
    <div class="quota-item">
      <div>
        <div class="quota-name">\${name.toUpperCase()}</div>
        <div class="quota-detail">\${q.note || ''} \${q.plan ? '· ' + q.plan : ''}</div>
      </div>
      <span class="quota-badge \${q.status === 'active' ? 'badge-green' : 'badge-amber'}">\${q.status || 'unknown'}</span>
    </div>\`).join('');

  // Cron
  const cron = data.cron || [];
  document.getElementById('cron-list').innerHTML = cron.map(c => \`
    <div class="cron-item">
      <div>
        <div class="quota-name">\${c.name}</div>
        <div class="quota-detail mono">\${c.schedule}</div>
      </div>
      <span class="quota-badge badge-green">\${c.status}</span>
    </div>\`).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return seconds + 's ago';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  return Math.floor(seconds / 86400) + 'd ago';
}

// Auto-load on page open
loadData();

// Auto-refresh every 2 minutes
setInterval(loadData, 120000);
</script>
</body>
</html>`;
