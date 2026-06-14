// ─── Data Source Toggle ──────────────────────────────────────────
let useLiveData = false;
let ws = null;

function setDataSource(mode) {
  useLiveData = mode === 'live';
  document.getElementById('btn-sim').className = useLiveData ? '' : 'active';
  document.getElementById('btn-live').className = useLiveData ? 'active' : '';
  document.getElementById('live-indicator').textContent = useLiveData ? '● LIVE' : '● SIMULATED';

  if (useLiveData) {
    connectWS();
    fetchLiveStats();
    fetchLiveRepos();
    fetchLiveCommits();
    fetchLiveGraph();
    fetchLiveAgents();
  } else {
    if (ws) { ws.close(); ws = null; }
    updateWSStatus(false);
    loadSimulatedData();
  }
}

// ─── WebSocket ────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = proto + '//' + location.host + '/ws';
  try {
    ws = new WebSocket(wsUrl);
    ws.onopen = function() { updateWSStatus(true); };
    ws.onclose = function() { updateWSStatus(false); setTimeout(connectWS, 5000); };
    ws.onerror = function() {};
    ws.onmessage = function(ev) {
      try {
        const msg = JSON.parse(ev.data);
        handleWSMessage(msg);
      } catch(e) {}
    };
  } catch(e) {
    updateWSStatus(false);
  }
}

function updateWSStatus(connected) {
  const dot = document.getElementById('ws-dot');
  const label = document.getElementById('ws-status');
  dot.className = 'live-badge ' + (connected ? 'active' : 'inactive');
  label.textContent = connected ? 'Connected' : 'Disconnected';
}

function handleWSMessage(msg) {
  if (msg.type === 'fleet_pulse') {
    if (msg.agents) {
      renderAgents(msg.agents);
    }
  }
  if (msg.type === 'fleet_snapshot') {
    if (msg.stats) updateStats(msg.stats);
    if (msg.agents) renderAgents(msg.agents);
  }
}

// ─── API Fetch Helpers ───────────────────────────────────────────
async function api(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

async function fetchLiveStats() {
  try {
    const stats = await api('/api/stats');
    updateStats(stats);
  } catch(e) {
    console.error('Stats fetch failed:', e);
  }
}

async function fetchLiveRepos() {
  try {
    const repos = await api('/api/repos');
    window._liveRepos = repos;
    updateRepoElements(repos);
    drawGraphFromData(repos);
  } catch(e) {
    console.error('Repos fetch failed:', e);
  }
}

async function fetchLiveCommits() {
  try {
    const commits = await api('/api/commits');
    renderPulse(commits);
  } catch(e) {
    console.error('Commits fetch failed:', e);
  }
}

async function fetchLiveGraph() {
  try {
    const graph = await api('/api/graph');
    if (graph.nodes && graph.nodes.length > 0) {
      drawGraphFromGraphData(graph);
    }
  } catch(e) {
    console.error('Graph fetch failed:', e);
  }
}

async function fetchLiveAgents() {
  try {
    const agents = await api('/api/agents');
    renderAgents(agents);
  } catch(e) {
    console.error('Agents fetch failed:', e);
  }
}

function fetchTernaryLive() {
  if (!useLiveData) return;
  api('/api/ternary-matrix?method=random').then(function(data) {
    if (data.matrix) {
      const TERNARY = new Int8Array(64);
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++)
          TERNARY[i*8 + j] = data.matrix[i][j];
      renderTernaryFrom(TERNARY);
    }
  }).catch(function(e) { console.error('Ternary fetch failed:', e); });
}

// ─── Update UI ───────────────────────────────────────────────────
function updateStats(stats) {
  document.getElementById('stat-repos').textContent = stats.repoCount || 0;
  document.getElementById('stat-languages').textContent = (stats.languages && stats.languages.length) || 0;
  document.getElementById('stat-stars').textContent = stats.totalStars || 0;
}

function updateRepoElements(repos) {}

// ─── Graph ───────────────────────────────────────────────────────
function drawGraphFromData(repos) {
  const c = document.getElementById('graph-canvas');
  const ct = document.getElementById('graph-container');
  const r = ct.getBoundingClientRect();
  const d = window.devicePixelRatio||1;
  c.width = r.width*d; c.height = r.height*d;
  c.style.width = r.width+'px'; c.style.height = r.height+'px';
  const ctx = c.getContext('2d');
  ctx.scale(d,d);
  const W = r.width, H = r.height;
  const CM = {'Rust':'#7ee787','TypeScript':'#58a6ff','Python':'#f0883e','C/CUDA':'#bc8cff','Zig':'#39d2c0','Julia':'#a6e22e','Shell':'#8b949e'};

  const nodes = repos.map(function(r) {
    return {
      x: Math.random()*W*0.7+W*0.15, y: Math.random()*H*0.7+H*0.15,
      vx: 0, vy: 0,
      r_: Math.max(4, Math.min(18, 6 + (r.stars||0)*3)),
      c: CM[r.language] || '#8b949e',
      l: r.name,
    };
  });

  for (let iter = 0; iter < 120; iter++) {
    for (let i = 0; i < nodes.length; i++)
      for (let j = i+1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        const dist = Math.max(1, Math.sqrt(dx*dx+dy*dy));
        const f = 5000/(dist*dist);
        nodes[i].vx -= (dx/dist)*f; nodes[i].vy -= (dy/dist)*f;
        nodes[j].vx += (dx/dist)*f; nodes[j].vy += (dy/dist)*f;
      }
    for (const n of nodes) {
      n.vx += (W/2-n.x)*0.01; n.vy += (H/2-n.y)*0.01;
      n.vx *= 0.85; n.vy *= 0.85;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(10, Math.min(W-10, n.x));
      n.y = Math.max(10, Math.min(H-10, n.y));
    }
  }

  ctx.clearRect(0,0,W,H);
  for (let i = 0; i < nodes.length; i++)
    for (let j = 0; j < 2; j++) {
      const t = Math.floor(Math.random()*nodes.length);
      if (t === i) continue;
      ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[t].x, nodes[t].y);
      ctx.strokeStyle='rgba(48,54,61,0.25)'; ctx.lineWidth=0.5; ctx.stroke();
    }
  for (const n of nodes) {
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r_, 0, Math.PI*2);
    ctx.fillStyle = n.c; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#c9d1d9'; ctx.font = '9px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(n.l, n.x, n.y+n.r_+12);
  }
}

function drawGraphFromGraphData(graph) {
  const c = document.getElementById('graph-canvas');
  const ct = document.getElementById('graph-container');
  const r = ct.getBoundingClientRect();
  const d = window.devicePixelRatio||1;
  c.width = r.width*d; c.height = r.height*d;
  c.style.width = r.width+'px'; c.style.height = r.height+'px';
  const ctx = c.getContext('2d');
  ctx.scale(d,d);
  const W = r.width, H = r.height;
  const CM = {'Rust':'#7ee787','TypeScript':'#58a6ff','Python':'#f0883e','C/CUDA':'#bc8cff','Zig':'#39d2c0','Julia':'#a6e22e','Shell':'#8b949e'};

  const N = graph.nodes.map(function(n, idx) {
    return {
      x: Math.random()*W*0.7+W*0.15, y: Math.random()*H*0.7+H*0.15,
      vx: 0, vy: 0,
      r_: Math.max(4, Math.min(18, 6 + (n.stars||0)*3)),
      c: CM[n.language] || '#8b949e',
      l: n.name,
      idx: idx,
    };
  });

  for (let iter = 0; iter < 120; iter++) {
    for (let i = 0; i < N.length; i++)
      for (let j = i+1; j < N.length; j++) {
        const dx = N[j].x - N[i].x, dy = N[j].y - N[i].y;
        const dist = Math.max(1, Math.sqrt(dx*dx+dy*dy));
        const f = 5000/(dist*dist);
        N[i].vx -= (dx/dist)*f; N[i].vy -= (dy/dist)*f;
        N[j].vx += (dx/dist)*f; N[j].vy += (dy/dist)*f;
      }
    for (const n of N) {
      n.vx += (W/2-n.x)*0.01; n.vy += (H/2-n.y)*0.01;
      n.vx *= 0.85; n.vy *= 0.85;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(10, Math.min(W-10, n.x));
      n.y = Math.max(10, Math.min(H-10, n.y));
    }
  }

  const nodeMap = {};
  N.forEach(function(n) { nodeMap[n.idx] = n; });

  ctx.clearRect(0,0,W,H);
  for (const e of graph.edges) {
    const src = graph.nodes.findIndex(function(n) { return n.name === e.source; });
    const tgt = graph.nodes.findIndex(function(n) { return n.name === e.target; });
    const sn = nodeMap[src], tn = nodeMap[tgt];
    if (sn && tn) {
      ctx.beginPath(); ctx.moveTo(sn.x, sn.y); ctx.lineTo(tn.x, tn.y);
      ctx.strokeStyle = 'rgba(48,54,61,' + Math.min(0.5, 0.1 + e.weight * 0.1) + ')';
      ctx.lineWidth = Math.max(0.3, e.weight * 0.5);
      ctx.stroke();
    }
  }
  if (graph.edges.length === 0) {
    for (let i = 0; i < N.length; i++)
      for (let j = 0; j < 2; j++) {
        const t = Math.floor(Math.random()*N.length);
        if (t === i) continue;
        ctx.beginPath(); ctx.moveTo(N[i].x, N[i].y); ctx.lineTo(N[t].x, N[t].y);
        ctx.strokeStyle='rgba(48,54,61,0.25)'; ctx.lineWidth=0.5; ctx.stroke();
      }
  }
  for (const n of N) {
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r_, 0, Math.PI*2);
    ctx.fillStyle = n.c; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#c9d1d9'; ctx.font = '9px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(n.l, n.x, n.y+n.r_+12);
  }
}

// ─── Simulated data ──────────────────────────────────────────────
const REPOS = [
  {name:'flux-core',lang:'Rust',desc:'Zero-dep FLUX bytecode runtime VM + A2A',stars:2},
  {name:'flux-realm',lang:'Zig',desc:'A2A orchestration with SAEP veto topology',stars:1},
  {name:'ternary-tnn',lang:'Rust',desc:'Ternary neural nets: {-1,0,+1}, LUT matmul',stars:1},
  {name:'constraint-theory-core',lang:'Rust',desc:'Constraint geometry, 83 tests, zero deps',stars:0},
  {name:'fleet-edge-worker',lang:'TypeScript',desc:'CF Workers edge runtime + PID governor',stars:0},
  {name:'ecosystem-graph',lang:'TypeScript',desc:'Crate dependency analyzer + D1',stars:0},
  {name:'baton-system',lang:'Shell',desc:'I2I coordination — tripartite baton protocol',stars:0},
  {name:'fleet-sim-rs',lang:'Rust',desc:'561M sig/s fleet cancellation simulator',stars:0},
  {name:'native-conservation-core',lang:'C/CUDA',desc:'C + CUDA ternary ALU, ring buffers',stars:0},
  {name:'conservation-languages',lang:'Julia',desc:'Conservation law in 9 languages',stars:0},
  {name:'headspace',lang:'Python',desc:'Context compression + swarm + baton hub',stars:0},
  {name:'gc-pid-bridge',lang:'Rust',desc:'PID bridge: GC ↔ ternary-pid',stars:0},
  {name:'polln',lang:'TypeScript',desc:'Fleet visualized in spreadsheets',stars:1},
  {name:'fleet-health-monitor',lang:'Python',desc:'Daemonized health + necrosis detection',stars:2},
  {name:'fleet-auto-ingest',lang:'TypeScript',desc:'GitHub → Vectorize every 6h',stars:0},
  {name:'the-rotation',lang:'Rust',desc:'ARM NEON engine, 5 crates, 42 tests',stars:0},
  {name:'ternary-search-rs',lang:'Rust',desc:'Ternary vector search: axum+rayon+SIMD',stars:0},
  {name:'harness-experiments',lang:'Python',desc:'Agent productivity experiments',stars:0},
  {name:'cocapn',lang:'Python',desc:'Repo-first agent: muscle memory in git',stars:0},
];
const AGENTS = [
  {n:'oracle2',r:'Orchestrator',s:'online',d:'Co-captain. Memory, GC, baton.'},
  {n:'forgemaster',r:'Build',s:'online',d:'Compiles, tests, releases fleet.'},
  {n:'flux-core-vm',r:'Runtime',s:'online',d:'FLUX bytecode VM + assembler.'},
  {n:'fleet-edge',r:'Edge Router',s:'online',d:'Cloudflare: bottle dispatch.'},
  {n:'constraint-core',r:'Math',s:'online',d:'Eisenstein lattices, rigidity.'},
  {n:'ternary-tnn',r:'ML',s:'online',d:'1.58-bit neural inference.'},
  {n:'eco-graph',r:'Analysis',s:'idle',d:'Dependency graph + D1.'},
  {n:'fleet-health',r:'Monitoring',s:'online',d:'Necrosis detection.'},
  {n:'lever-runner',r:'CI',s:'idle',d:'HTTP API on :8780.'},
  {n:'headspace',r:'Integration',s:'online',d:'HUB: compression + swarm.'},
];
const PULSE = [
  {r:'conservation-languages',m:'Verified Julia zero-alloc: 8.1B sig/s',t:'2h ago'},
  {r:'fleet-sim-rs',m:'561M sig/s concurrent cancellation simulator',t:'3h ago'},
  {r:'ternary-search-rs',m:'Ternary vector search: axum+rayon+SIMD',t:'3h ago'},
  {r:'native-conservation-core',m:'ctypes bindings + ternary ALU + 97KB arch doc',t:'3h ago'},
  {r:'the-rotation',m:'v0.3: Rust + Zig NEON ARM kernel',t:'4h ago'},
  {r:'baton-system',m:'gc-intelligence: PID calibration sync',t:'5m ago'},
  {r:'fleet-edge-worker',m:'PID Fleet Governor: 822-line, 3 routes',t:'5h ago'},
  {r:'headspace',m:'v0.2.2: agent patterns + SYSTEM.md',t:'6h ago'},
  {r:'flux-core',m:'README upgraded to textbook quality',t:'12h ago'},
  {r:'flux-realm',m:'ctypes FFI wrapper for Rotation Zig kernel',t:'14h ago'},
  {r:'ternary-tnn',m:'v0.1.1: SIMD + Zig NEON matmul',t:'15h ago'},
  {r:'ecosystem-graph',m:'Concept layer: concepts, cross-pollination, frontier',t:'1d ago'},
  {r:'cocapn',m:'sync fleet GC config',t:'1d ago'},
  {r:'gc-pid-bridge',m:'First commit: Rust PID wrapper for GC system',t:'1d ago'},
];

// ─── Terminal ────────────────────────────────────────────────────
function log(msg, cls, pre) {
  if (typeof cls === 'undefined') cls = 'output';
  if (typeof pre === 'undefined') pre = '$';
  const t = document.getElementById('bottle-term');
  const d = document.createElement('div'); d.className='line';
  d.innerHTML = '<span class="prompt">' + pre + '</span> <span class="' + cls + '">' + msg + '</span>';
  t.appendChild(d); t.scrollTop = t.scrollHeight;
}
function clearLog() {
  document.getElementById('bottle-term').innerHTML = '';
  log('Fleet Terminal ready.','info'); log('Waiting...');
}

// ─── Send Bottle ─────────────────────────────────────────────────
function sendBottle() {
  const a = document.getElementById('bottle-action').value;
  const p = document.getElementById('bottle-payload').value;

  if (useLiveData) {
    const target = (function() {
      try {
        const parsed = JSON.parse(p);
        return parsed.target || null;
      } catch(e) { return null; }
    })();
    fetch('/api/dispatch/' + a + '?payload=' + encodeURIComponent(p) + (target ? '&target=' + encodeURIComponent(target) : ''))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        log('Sending ' + a + ' [' + data.bottleId + ']...', 'highlight');
        setTimeout(function() {
          log('→ ' + JSON.stringify(data.response), 'prompt', '');
          log(data.bottleId + ': delivered ✓ (' + data.latency + ', ' + data.hops + ' hops)', 'info');
        }, 400);
      })
      .catch(function(e) { log('Error: ' + e.message, 'error'); });
    return;
  }

  // Simulated
  const id = 'b-'+Date.now().toString(36);
  log('Sending ' + a + ' [' + id + ']...','highlight');
  setTimeout(function(){ log('fleet-edge: routing...'); },400);
  setTimeout(function() {
    const R={
      fleet_status:'{"agents":10,"online":8,"idle":2,"bottles":' + Math.floor(Math.random()*500+100) + '}',
      chord_request:'{"resolved":true,"chord":"γ+η=C","conf":' + (Math.random()*0.3+0.7).toFixed(2) + '}',
      gc_tick:'{"freed":"' + Math.floor(Math.random()*500+50) + 'MB","pid":' + (Math.random()*4+1).toFixed(1) + 'x}',
      baton_sync:'{"synced":true,"vessel":"/tmp/i2i-vessel/","pending":' + Math.floor(Math.random()*5) + '}',
      ternary_infer:'{"ops":"64 ternary MACs","fp_mult":0}',
      echo:'{"pong":true,"agent":"' + ['oracle2','forgemaster','fleet-edge'][Math.floor(Math.random()*3)] + '","latency":"' + Math.floor(Math.random()*80+10) + 'ms"}',
    };
    log('→ ' + (R[a]||'{"ok":true}'),'prompt','');
    log(id + ': delivered ✓','info');
  },1200);
}

// ─── Graph (Simulated) ───────────────────────────────────────────
function drawGraph() {
  const c = document.getElementById('graph-canvas');
  const ct = document.getElementById('graph-container');
  const r = ct.getBoundingClientRect();
  const d = window.devicePixelRatio||1;
  c.width = r.width*d; c.height = r.height*d;
  c.style.width = r.width+'px'; c.style.height = r.height+'px';
  const ctx = c.getContext('2d');
  ctx.scale(d,d);
  const W = r.width, H = r.height;
  const CM = {Rust:'#7ee787',TypeScript:'#58a6ff',Python:'#f0883e','C/CUDA':'#bc8cff',Zig:'#39d2c0',Julia:'#a6e22e',Shell:'#8b949e'};
  const N = REPOS.map(function(r,i){
    return {
      x:Math.random()*W*0.7+W*0.15,y:Math.random()*H*0.7+H*0.15,
      vx:0,vy:0,
      r:Math.max(4,Math.min(18,6+r.stars*3)),
      c:CM[r.lang]||'#8b949e',l:r.name
    };
  });

  for(let iter=0;iter<120;iter++){
    for(let i=0;i<N.length;i++)for(let j=i+1;j<N.length;j++){
      const dx=N[j].x-N[i].x,dy=N[j].y-N[i].y;
      const dist=Math.max(1,Math.sqrt(dx*dx+dy*dy));
      const f=5000/(dist*dist);
      N[i].vx-=(dx/dist)*f;N[i].vy-=(dy/dist)*f;
      N[j].vx+=(dx/dist)*f;N[j].vy+=(dy/dist)*f;
    }
    for(const n of N){
      n.vx+=(W/2-n.x)*0.01;n.vy+=(H/2-n.y)*0.01;
      n.vx*=0.85;n.vy*=0.85;
      n.x+=n.vx;n.y+=n.vy;
      n.x=Math.max(10,Math.min(W-10,n.x));
      n.y=Math.max(10,Math.min(H-10,n.y));
    }
  }

  ctx.clearRect(0,0,W,H);
  for(let i=0;i<N.length;i++)for(let j=0;j<2;j++){
    const t=Math.floor(Math.random()*N.length);
    if(t===i)continue;
    ctx.beginPath();ctx.moveTo(N[i].x,N[i].y);ctx.lineTo(N[t].x,N[t].y);
    ctx.strokeStyle='rgba(48,54,61,0.25)';ctx.lineWidth=0.5;ctx.stroke();
  }
  for(const n of N){
    ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);
    ctx.fillStyle=n.c;ctx.globalAlpha=0.85;ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle='#c9d1d9';ctx.font='9px system-ui,sans-serif';ctx.textAlign='center';
    ctx.fillText(n.l,n.x,n.y+n.r+12);
  }
}

// ─── Ternary ─────────────────────────────────────────────────────
const TERNARY_VALS = new Int8Array(64);
function renderTernary() {
  const g = document.getElementById('ternary-grid');
  g.innerHTML = '';
  const B = ['cell-minus','cell-zero','cell-plus'];
  for(let i=0;i<64;i++){
    const d = document.createElement('div'); d.className='ternary-cell '+B[TERNARY_VALS[i]+1];
    g.appendChild(d);
  }
  const x = [1,-1,0,1,-1,0,1,-1];
  let r = 0;
  for(let i=0;i<8;i++) for(let j=0;j<8;j++) r += TERNARY_VALS[i*8+j] * x[j];
  document.getElementById('ternary-result').textContent = r;
  const plus = Array.from(TERNARY_VALS).filter(function(v){return v===1;}).length;
  const minus = Array.from(TERNARY_VALS).filter(function(v){return v===-1;}).length;
  const zero = 64-plus-minus;
  document.getElementById('ternary-term').innerHTML =
    '<div class="line"><span class="prompt">$</span> <span class="output">x = [+1,-1,0,+1,-1,0,+1,-1]</span></div>'+
    '<div class="line"><span class="prompt">$</span> <span class="output">W·x = ' + r + '</span></div>'+
    '<div class="line"><span class="prompt">$</span> <span class="info">+1:' + plus + '  0:' + zero + '  -1:' + minus + '  0 FP mult</span></div>';
}
function renderTernaryFrom(data) {
  for(let i=0;i<64;i++) TERNARY_VALS[i] = data[i];
  renderTernary();
}
function randomizeTernary() {
  for(let i=0;i<64;i++) TERNARY_VALS[i] = Math.random()<0.5?1:Math.random()<0.5?0:-1;
  renderTernary();
}
function ternaryGP() {
  for(let i=0;i<64;i++){
    const v = Math.random()+Math.random()+Math.random()-1.5;
    TERNARY_VALS[i] = v>0.5?1:v<-0.5?-1:0;
  }
  renderTernary();
}

// ─── Agents ──────────────────────────────────────────────────────
function renderAgents(agents) {
  document.getElementById('agent-list').innerHTML = agents.map(function(a) {
    return '<li><span class="status-dot ' + (a.status||'online') + '"></span><strong>' + (a.name||a.n) + '</strong><span style="color:var(--text2);font-size:.75rem">' + (a.role||a.r) + '</span><span style="color:var(--text2);font-size:.75rem;margin-left:auto">' + (a.desc||a.d) + '</span></li>';
  }).join('');
}

function loadSimulatedData() {
  // Stats
  document.getElementById('stat-repos').textContent = REPOS.length;
  document.getElementById('stat-languages').textContent = new Set(REPOS.map(function(r){return r.lang;})).size;
  const totalStars = REPOS.reduce(function(s,r){return s+r.stars;},0);
  document.getElementById('stat-stars').textContent = totalStars;

  // Agents
  renderAgents(AGENTS);

  // Pulse
  const pt = document.getElementById('pulse-term');
  pt.innerHTML = '';
  PULSE.forEach(function(p) {
    const d = document.createElement('div'); d.className='line';
    d.innerHTML = '<span class="prompt">$</span> <span class="pulse-repo">' + p.r + '</span> <span class="output">' + p.m + '</span> <span class="pulse-time">' + p.t + '</span>';
    pt.appendChild(d);
  });

  // Graph
  drawGraph();
}

function renderPulse(commits) {
  const pt = document.getElementById('pulse-term');
  pt.innerHTML = '';
  if (!commits || commits.length === 0) {
    pt.innerHTML = '<div class="line"><span class="prompt">$</span> <span class="output">No recent commits found.</span></div>';
    return;
  }
  commits.forEach(function(c) {
    const d = document.createElement('div'); d.className='line';
    d.innerHTML = '<span class="prompt">$</span> <span class="pulse-repo">' + c.repo + '</span> <span class="output">' + c.message + '</span> <span class="pulse-time">' + timeAgo(c.date) + '</span>';
    pt.appendChild(d);
  });
}

function timeAgo(dateStr) {
  const now = new Date();
  const then = new Date(dateStr);
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

// ─── Init ────────────────────────────────────────────────────────
loadSimulatedData();
randomizeTernary();

console.log('SuperInstance Fleet Dashboard loaded.');
console.log(REPOS.length + ' repos, ' + AGENTS.length + ' agents');
