# README Architecture Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use Sequential mode for planned tasks or Direct mode if subagents aren't available. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update README architecture documentation to reflect the latest LaPis modular-monolith architecture and add supporting documentation diagrams.

**Architecture:** The README keeps a high-level architecture diagram as the entry point. `docs/ARCHITECTURE.md` gains two supporting diagrams: a detailed module-boundary diagram and a reader-friendly lifecycle/data-flow diagram. Diagram source files live beside the existing README assets or under `docs/diagrams/` with PNG exports for Markdown rendering.

**Tech Stack:** Markdown, SVG, PNG exports via Python/cairosvg, existing LaPis architecture docs.

---

### Task 1: Refresh README architecture figure

**Files:**
- Modify: `memory-layer-architecture.svg`
- Modify: `memory-layer-architecture.png`
- Modify: `README.md`

- [ ] **Step 1: Replace the existing SVG with a high-level modular-monolith architecture diagram**

Create an SVG with these layers: Pi coding agent, Pi extension adapters, Node CLI gateway, feature services, platform/storage, and optional Crosshash boundary.

- [ ] **Step 2: Export PNG**

Run: `python3 -c "import cairosvg; cairosvg.svg2png(url='memory-layer-architecture.svg', write_to='memory-layer-architecture.png', scale=2)"`
Expected: exit 0 and refreshed PNG file.

- [ ] **Step 3: Update README architecture text**

Add concise prose under `## Architecture` explaining the latest modular monolith and linking to deeper docs.

### Task 2: Add detailed module-boundary diagram

**Files:**
- Create: `docs/diagrams/lapis-module-boundaries.svg`
- Create: `docs/diagrams/lapis-module-boundaries.png`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Create the module-boundary SVG**

Show extension host, CLI routers, feature modules, and platform services with allowed dependencies.

- [ ] **Step 2: Export PNG**

Run: `python3 -c "import cairosvg; cairosvg.svg2png(url='docs/diagrams/lapis-module-boundaries.svg', write_to='docs/diagrams/lapis-module-boundaries.png', scale=2)"`
Expected: exit 0 and PNG exists.

- [ ] **Step 3: Embed in architecture doc**

Place the diagram near the runtime layer section and keep existing dependency rules authoritative.

### Task 3: Add Kami-style lifecycle documentation diagram

**Files:**
- Create: `docs/diagrams/lapis-memory-lifecycle.svg`
- Create: `docs/diagrams/lapis-memory-lifecycle.png`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Create the lifecycle SVG**

Show prompt/session capture, memory save/search/context, code/doc index retrieval, trust sync, compaction/dream cleanup, and SQLite persistence.

- [ ] **Step 2: Export PNG**

Run: `python3 -c "import cairosvg; cairosvg.svg2png(url='docs/diagrams/lapis-memory-lifecycle.svg', write_to='docs/diagrams/lapis-memory-lifecycle.png', scale=2)"`
Expected: exit 0 and PNG exists.

- [ ] **Step 3: Embed in architecture doc**

Add a short section explaining this lifecycle view complements the structural module-boundary view.

### Task 4: Verify generated assets and docs

**Files:**
- Verify: `memory-layer-architecture.svg`
- Verify: `docs/diagrams/lapis-module-boundaries.svg`
- Verify: `docs/diagrams/lapis-memory-lifecycle.svg`
- Verify: `README.md`
- Verify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Validate SVG XML**

Run: `python3 - <<'PY' ... ET.parse(...) ... PY`
Expected: all SVG files parse successfully.

- [ ] **Step 2: Confirm Markdown references target existing files**

Run: shell check for referenced PNG files.
Expected: every referenced diagram exists.
