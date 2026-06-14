# 🦞 SuperInstance Fleet Dashboard

> **The SuperInstance ecosystem, visualized.** A live, zero-dependency interactive dashboard that makes the fleet tangible.

**[→ Live Demo](http://147.224.38.131:8889/)**

---

## What It Shows

### 🌐 Fleet Topology
Force-directed graph of every repo in the SuperInstance fleet. Node size = stars (community value). Color = language. Hover to see the shape of the ecosystem — which clusters emerge, which crates are foundational, which are leaves.

### 📨 I2I Bottle Dispatch
Click a button and watch a "bottle" route through the A2A agent mesh. The fleet communicates through the **I2I (Instance-to-Instance) protocol**: every action is a bottle with a 3-way shard (action + payload + metadata). This simulation shows the round-trip: dispatch → route → response → delivery confirmation.

#### Supported actions:

| Action | What it does |
|--------|-------------|
| `fleet_status` | Query all agent health + bottle counts |
| `chord_request` | Resolve a chord through the constraint engine |
| `gc_tick` | Trigger a garbage-collection cycle with PID control |
| `baton_sync` | Synchronize baton state across the vessel |
| `ternary_infer` | Run inference through the ternary neural network |
| `echo` | Ping a fleet agent and measure latency |

### 🧮 Ternary NN {-1, 0, +1}
A live 8×8 ternary weight matrix. Each cell is either:
- **+1 (green)** — activate the signal
- **0 (gray)** — pass through (neutral)
- **-1 (orange)** — inhibit the signal

This is the core of **1.58-bit quantization**: no floating-point multiplications, only sign flips and passes. One multiply-accumulate (MAC) operation costs one AND gate instead of hundreds of transistors.

Click **Randomize** to see random weights, or **Gaussian** to simulate a more realistic initialization. The forward pass recomputes instantly — 64 ternary MACs with zero FP operations.

### 🤖 Fleet Agents
The agent mesh: 10 active nodes running the A2A (Agent-to-Agent) protocol. Each agent has:
- **Status dot** — green (online), orange (idle)
- **Role tag** — Orchestrator, Build, ML Engine, Edge Router, etc.
- **Description** — what it actually does

### ⏱️ Fleet Pulse
Real-ish commit activity drawn from actual SuperInstance pushes. Shows which repos are active, what changed, and how recently. Updated as the fleet ships.

---

## Architecture

```
fleet-dashboard/
└── index.html          # Single-file app. Zero dependencies. 23KB.
```

That's it. One file. No build step. No npm install. No framework.

**Design decisions:**
- **Zero dependencies** — loads from any HTTP server or file:// URL
- **Dark theme** — respects the SuperInstance visual identity (inspired by GitHub Dark)
- **Live data simulation** — the bottle dispatch and ternary visualizer run entirely in-browser
- **No analytics** — the fleet doesn't track you

---

## Run It

```bash
# Any HTTP server works
python3 -m http.server 8889
# Or
npx serve .
# Or drop index.html in a browser directly
```

Or deploy to Cloudflare Pages / GitHub Pages / Netlify / any static host.

---

## Why This Exists

The SuperInstance ecosystem had:
- **49 repos** with impressive engineering velocity
- **Zero discoverable demos** for an outsider

This dashboard is the answer to "what does all this actually do?" It makes the conservation law (γ + η = C), the ternary neural network, the A2A protocol, and the fleet topology visible and playable in one page.

The system that builds itself. Now it shows itself too.

---

## Related

- [SuperInstance org](https://github.com/SuperInstance) — the fleet
- [baton-system](https://github.com/SuperInstance/baton-system) — I2I coordination protocol
- [flux-core](https://github.com/SuperInstance/flux-core) — FLUX bytecode runtime
- [ternary-tnn](https://github.com/SuperInstance/ternary-tnn) — ternary neural networks
- [ecosystem-graph](https://github.com/SuperInstance/ecosystem-graph) — crate dependency analyzer

---

Built by the fleet. 🦞
