// lib/agents.js — Agent registry, bottle routing, and status tracking
// =========================================================================

const AGENTS = [
  { name: 'oracle2',       role: 'Orchestrator', desc: 'Co-captain. Memory, GC, baton.' },
  { name: 'forgemaster',   role: 'Build',        desc: 'Compiles, tests, releases fleet.' },
  { name: 'flux-core-vm',  role: 'Runtime',      desc: 'FLUX bytecode VM + assembler.' },
  { name: 'fleet-edge',    role: 'Edge Router',  desc: 'Cloudflare: bottle dispatch.' },
  { name: 'constraint-core', role: 'Math',        desc: 'Eisenstein lattices, rigidity.' },
  { name: 'ternary-tnn',   role: 'ML',           desc: '1.58-bit neural inference.' },
  { name: 'eco-graph',     role: 'Analysis',     desc: 'Dependency graph + D1.' },
  { name: 'fleet-health',  role: 'Monitoring',   desc: 'Necrosis detection.' },
  { name: 'lever-runner',  role: 'CI',           desc: 'HTTP API on :8780.' },
  { name: 'headspace',     role: 'Integration',  desc: 'HUB: compression + swarm.' },
];

// Agent status tracking
const AGENT_STATUS = new Map();
AGENTS.forEach(a => {
  AGENT_STATUS.set(a.name, {
    status: 'online',
    lastSeen: Date.now() - Math.floor(Math.random() * 60000),
    bottlesProcessed: Math.floor(Math.random() * 500 + 100),
    errors: Math.floor(Math.random() * 5),
    latency: Math.floor(Math.random() * 40 + 10),
  });
});

// Action → response templates
const ACTION_RESPONSES = {
  fleet_status:   (a) => ({
    ok: true,
    action: 'fleet_status',
    agents: AGENTS.length,
    health: AGENTS.map(a => ({
      name: a.name,
      role: a.role,
      status: AGENT_STATUS.get(a.name).status,
      bottles: AGENT_STATUS.get(a.name).bottlesProcessed,
      latency: `${AGENT_STATUS.get(a.name).latency}ms`,
    })),
  }),
  chord_request:  (a, payload) => ({
    ok: true,
    action: 'chord_request',
    resolved: true,
    chord: 'γ + η = C',
    confidence: (Math.random() * 0.25 + 0.72).toFixed(3),
    agent: a.name,
    payload: payload || null,
  }),
  gc_tick:        (a) => ({
    ok: true,
    action: 'gc_tick',
    freed: `${Math.floor(Math.random() * 500 + 50)}MB`,
    pid: `${(Math.random() * 4 + 1).toFixed(1)}x`,
    agent: a.name,
  }),
  baton_sync:     (a) => ({
    ok: true,
    action: 'baton_sync',
    synced: true,
    vessel: '/tmp/i2i-vessel/',
    pending: Math.floor(Math.random() * 5),
    agent: a.name,
  }),
  ternary_infer:  (a) => ({
    ok: true,
    action: 'ternary_infer',
    ops: '64 ternary MACs',
    fp_mult: 0,
    agent: a.name,
    result: Math.floor(Math.random() * 10 - 5),
  }),
  echo:           (a) => ({
    ok: true,
    action: 'echo',
    pong: true,
    agent: a.name,
    latency: `${AGENT_STATUS.get(a.name).latency + Math.floor(Math.random() * 5)}ms`,
  }),
};

// Bottle ID counter
let bottleCounter = 0;

// Route a bottle through the agent mesh
function routeBottle(action, payload = null, targetAgent = null) {
  bottleCounter++;
  const bottleId = `b-${Date.now().toString(36)}-${bottleCounter}`;

  // Pick the target agent
  let agent;
  if (targetAgent) {
    agent = AGENTS.find(a => a.name === targetAgent) || AGENTS[Math.floor(Math.random() * AGENTS.length)];
  } else {
    // Route to a random subset of agents (simulates mesh routing)
    agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  }

  // Update agent status
  const status = AGENT_STATUS.get(agent.name);
  if (status) {
    status.bottlesProcessed++;
    status.lastSeen = Date.now();
    // Simulate occasional errors
    if (Math.random() < 0.05) {
      status.errors++;
    }
  }

  // Generate response
  const responder = ACTION_RESPONSES[action];
  const response = responder ? responder(agent, payload) : {
    ok: true,
    action: action || 'unknown',
    echo: payload || {},
    agent: agent.name,
    id: bottleId,
  };

  return {
    bottleId,
    action,
    source: 'fleet-edge',
    target: agent.name,
    hops: Math.floor(Math.random() * 3 + 1),
    response,
    latency: `${status ? status.latency : 0}ms`,
    timestamp: new Date().toISOString(),
  };
}

function getAllAgents() {
  return AGENTS.map(a => ({
    ...a,
    status: AGENT_STATUS.get(a.name)?.status || 'online',
    lastSeen: AGENT_STATUS.get(a.name)?.lastSeen,
    bottlesProcessed: AGENT_STATUS.get(a.name)?.bottlesProcessed || 0,
    errors: AGENT_STATUS.get(a.name)?.errors || 0,
    latency: AGENT_STATUS.get(a.name)?.latency || 0,
  }));
}

function getAgent(name) {
  const a = AGENTS.find(x => x.name === name);
  if (!a) return null;
  return { ...a, ...(AGENT_STATUS.get(name) || {}) };
}

function getAvailableActions() {
  return Object.keys(ACTION_RESPONSES);
}

module.exports = {
  AGENTS,
  AGENT_STATUS,
  routeBottle,
  getAllAgents,
  getAgent,
  getAvailableActions,
};
