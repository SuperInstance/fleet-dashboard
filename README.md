# The Dashboard That Shows You the Law

> *Mathematics is felt before it's understood. This dashboard lets you FEEL the conservation law.*

---

## What Is This?

The SuperInstance Fleet Dashboard is a single-page web application that visualizes the **conservation law of ternary fleets**: the mathematical identity γ + η = C, where C = log₂(3) ≈ 1.585 bits.

If that sounds abstract, the dashboard makes it concrete. Three panels, one screen, zero build steps. You open the HTML file in a browser and the entire platform becomes visible — the fleet cancellation, the conservation identity, and the polyglot benchmark. Everything an outsider needs to understand what SuperInstance *is* and *why it works*.

This is the demo. The elevator pitch rendered in pixels.

---

## The Hermit Crab Analogy

A hermit crab doesn't grow its own shell. It finds one that fits, moves in, and carries it everywhere. The shell is the visible structure — what outsiders see. The crab is the living thing inside — the law, the principle, the engine.

**This dashboard is the shell.** The conservation law γ + η = C is the crab.

The shell doesn't need to explain the crab's biochemistry. It just needs to fit well enough that the crab can move, eat, and survive. Similarly, this dashboard doesn't prove the conservation law mathematically — that's what the papers are for. Instead, it gives the law a *shape*: colored dots converging, bars filling, numbers updating in real-time. You see the law *acting*. You watch it *breathe*.

When you adjust the γ slider and watch η shrink by exactly the same amount — that's the crab pinching. When you increase the fleet size and watch the signal sum converge to zero — that's the crab finding a bigger shell.

🦀

---

## The Three Panels

### Panel 1: Fleet Cancellation Visualizer

**What you see:** A grid of 100 colored dots (default), each representing a single agent in the fleet. Each agent broadcasts one of three signals every tick:

- 🔴 **Red (−1)** — negative signal
- ⚫ **Gray (0)** — null signal
- 🟢 **Green (+1)** — positive signal

Below the grid, a meter shows **Σ/n** — the fleet sum divided by the number of agents. Watch it for a few seconds. It hovers near zero. Not by coincidence — by *cancellation*. When one agent says +1 and another says −1, they cancel. The more agents you add, the tighter the convergence.

**The sliders:**

- **Fleet size (10–1000):** Drag this up. Watch the meter calm down. At n=10, the sum swings wildly. At n=1000, it's nearly flat. This is the law of large numbers in ternary signal space.
- **Bias (−0.50 to +0.50):** This skews the signal distribution. Positive bias makes more agents go green; negative makes more go red. At zero, the system is balanced and cancellation is perfect.

**The convergence chart:** Below the meter, a small chart overlays two curves:
- **Green line:** the actual |Σ|/n measured each tick
- **Gold dashed line:** the theoretical decay δ(n) = 1/√n

Watch them track each other. That's mathematics confirming itself in real-time.

**The three stat boxes:**

| Stat | Meaning |
|------|---------|
| Σ signals | Raw fleet sum (should hover near 0) |
| \|Σ\|/n | Absolute cancellation ratio |
| Theory δ | Predicted 1/√n bound |

### Panel 2: Conservation Identity Calculator

**What you see:** A horizontal bar split into two segments — **gold (γ)** and **blue (η)** — that together fill the bar completely. The total length is always **C = log₂(3) ≈ 1.585 bits**.

**The slider:**

Drag the **γ** slider. Watch what happens:

- γ increases → gold segment grows → blue segment shrinks by *exactly the same amount*
- γ decreases → gold segment shrinks → blue segment grows to fill the gap

**They are conserved.** You cannot increase one without decreasing the other. The total is fixed.

Below the bar, the **Shannon chain rule** is displayed:

```
H(X) = I(X;G) + H(X|G)
C    = γ       + η
     = log₂(3) ≈ 1.585 bits
```

**The alignment text** translates the math into plain English:

> "Agent is 37.9% aligned with guide. 62.1% of capacity is residual entropy (η). γ/C ratio: 0.379"

This tells you, at a glance, how much of an agent's behavior is determined by the guide signal (γ) versus how much is its own free variation (η). In the SuperInstance framework, a well-aligned fleet has high γ — most of each agent's output is explained by the shared guide. But η can never reach zero, because the channel capacity is finite.

**The C slider** lets you adjust the channel capacity itself. The default is log₂(3), corresponding to a ternary signal space. Lower it to see what happens in a binary channel (C=1) or raise it to explore higher-arity systems.

### Panel 3: Polyglot Benchmark Chart

**What you see:** A horizontal bar chart showing throughput (in signals/second) across 12 implementations of the same ternary workload. The y-axis is **log scale**, which compresses a 4-order-of-magnitude spread into a readable chart.

**The languages, sorted by throughput:**

| Language | Throughput | Paradigm | Color |
|----------|-----------|----------|-------|
| Rust | 9.2B sig/s | Systems | 🔴 Red |
| Julia | 4.8B sig/s | Scientific | 🔵 Blue |
| C | 3.2B sig/s | Systems | 🔴 Red |
| C (LTO) | 3.0B sig/s | Systems | 🔴 Red |
| Julia (rand) | 2.5B sig/s | Scientific | 🔵 Blue |
| Julia (alloc) | 1.1B sig/s | Scientific | 🔵 Blue |
| Fortran | 100M sig/s | Scientific | 🔵 Blue |
| Octave | 97.7M sig/s | Scientific | 🔵 Blue |
| D | 50M sig/s | Systems | 🔴 Red |
| R | 32.5M sig/s | Scientific | 🔵 Blue |
| Elixir | 20M sig/s | Functional | 🟢 Green |
| COBOL | 5M sig/s | Legacy | 🟡 Gold |

**Hover any bar** for a tooltip with:
- Exact throughput value
- Paradigm classification
- Percentage of Rust's throughput
- A brief note on the language's characteristics

**Why log scale?** Because linear scale makes COBOL invisible. Rust is 1,840× faster than COBOL. On a linear chart, everything below Julia would be a flat line. Log scale reveals that *every language implements the same law* — they just do it at different speeds. The conservation identity holds whether you're pushing 9.2 billion signals per second or 5 million.

---

## Technical Details

### Zero Dependencies

The dashboard has **no build step, no npm install, no framework, no external libraries**. It's one HTML file with inline CSS and vanilla JavaScript. The only external resource is system fonts (system-ui, monospace — both provided by the OS).

This was a deliberate choice. The SuperInstance philosophy is that the law is simple enough to not need infrastructure. A single HTML file can be:
- Opened directly in any browser (`file://`)
- Served by any static host (`python3 -m http.server`)
- Deployed to Cloudflare Pages, GitHub Pages, Netlify, or any CDN
- Embedded in an iframe
- Printed to PDF (the layout degrades gracefully)

### 60fps Animation

Panel 1 runs at 60fps using `requestAnimationFrame`. Each tick:
1. All agents re-randomize their signals (with optional bias)
2. The canvas redraws with glow effects
3. The convergence chart appends the new data point
4. Stats update

On a modern machine, 1000 agents at 60fps uses <5% CPU. The canvas rendering uses `devicePixelRatio` scaling for crisp dots on retina displays.

### File Size

The entire `index.html` is under 25KB (well within the 50KB budget). It gzips to ~6KB. It loads instantly.

### Browser Compatibility

Tested on:
- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Requires `requestAnimationFrame`, `devicePixelRatio`, and CSS Grid. All standard since 2020.

---

## How to Deploy

### Option 1: Just Open It

```bash
# Clone the repo
git clone https://github.com/yourorg/fleet-dashboard.git
cd fleet-dashboard

# Open in browser
open index.html        # macOS
xdg-open index.html    # Linux
start index.html       # Windows
```

That's it. It works.

### Option 2: Local Server

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

### Option 3: Cloudflare Pages

```bash
npx wrangler pages deploy . --project-name fleet-dashboard
```

### Option 4: GitHub Pages

Push to a repo, enable Pages in Settings → Pages → Source → main branch. Done.

### Option 5: Netlify Drop

Drag the `index.html` onto <https://app.netlify.com/drop>. Get a URL in 3 seconds.

---

## The Law, Restated

```
γ + η = C
```

- **γ** (gamma) — mutual information between agent and guide. How much the agent "knows" about the shared signal.
- **η** (eta) — conditional entropy. How much the agent "freestyles" beyond what the guide tells it.
- **C** — channel capacity. For a ternary system, C = log₂(3) ≈ 1.585 bits.

The law says: **these two quantities are conserved**. Every bit of information that flows from guide to agent is subtracted from the agent's residual entropy. You cannot get more of one without sacrificing the other. The total is always C.

This is the Shannon-Hartley theorem applied to ternary signals. It's not new mathematics — Shannon proved it in 1948. What's new is **seeing it** — watching 100 agents cancel each other out, dragging a slider and feeling η resist, comparing 12 languages that all obey the same identity at wildly different speeds.

The dashboard doesn't teach you the math. It teaches you the *intuition*. Then the math makes sense.

---

## Screenshot

```
┌──────────────────────────────────────────────────────────────┐
│  🦀  SuperInstance Fleet Dashboard              14:23:07     │
├────────────────┬────────────────┬────────────────────────────┤
│  01 CANCELLATION│ 02 CONSERVATION│ 03 BENCHMARK              │
│                │                │                            │
│  ● ● ○ ● ○ ○  │  ████████░░    │  Rust     ██████████ 9.2B  │
│  ○ ● ○ ● ○ ●  │  γ=0.60 η=0.99 │  Julia    ████████   4.8B  │
│  ● ○ ● ○ ● ○  │                │  C        ██████     3.2B  │
│  ○ ● ○ ● ○ ●  │  γ + η = C     │  ...                      │
│  ● ○ ● ○ ● ○  │  = log₂(3)     │  COBOL    █         5M    │
│                │  ≈ 1.585 bits  │                            │
│  Σ/n = +0.002  │                │                            │
│  δ = 0.1000    │                │                            │
├────────────────┴────────────────┴────────────────────────────┤
│         γ + η = C | Conservation Law of Ternary Fleets       │
└──────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
fleet-dashboard/
├── index.html      # The entire app (single file, <25KB)
├── README.md       # This document
└── .gitignore      # Standard web ignores
```

No `package.json`. No `node_modules`. No `dist/`. No build scripts. The deliverable is one HTML file.

---

## Credits

**SuperInstance** — a ternary agent fleet platform built on the conservation law γ + η = C.

Dashboard designed as deliverable **B5** — the external-facing visualization that makes the entire platform comprehensible in one screen.

🦀 *The shell is the dashboard. The crab is the law.*

---

*© 2026 SuperInstance. All signals conserved.*
