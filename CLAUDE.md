# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the sketch

Open `index.html` directly in a browser, or serve it with any static file server:

```bash
npx serve .
# or
python3 -m http.server
```

p5.js is loaded from a CDN — no install step required.

## Architecture

This is a single-file p5.js (WEBGL) sketch implementing **differential line growth** rendered as a 3D tube mesh.

**Core simulation — `sketch.js`:**

- `DifferentialLine3D` — the growing line. Stores node positions as three flat arrays (`x`, `y`, `z`). Each frame it runs `optimize()` (force-based relaxation: cohesion to neighbours, separation from non-neighbours, pill-capsule boundary constraint) and `spawn()` (midpoint insertion when edges are too long or too curved). Spatial lookups use `Grid3D` — a hash-map bucketed by cell key.
- `Grid3D` — 3D spatial hash. `add(id, x, y, z)` / `nearby(x, y, z)` return all node IDs in the 3×3×3 neighbourhood.
- `drawTube()` — converts the polyline to a renderable mesh each frame using parallel-transported frames (`ptransport`). Builds `TRIANGLE_STRIP` geometry with per-vertex normals for lighting.

**Key constants (top of `sketch.js`):**

| Constant | Purpose |
|---|---|
| `NEARL` / `FARL` | Min/max rest distances driving repulsion/cohesion |
| `STEP` | Force magnitude per frame |
| `MAX_N` | Node cap |
| `TUBE_R` / `TUBE_SIDES` | Tube cross-section radius and polygon count |
| `SPEED` | Simulation steps per draw frame |

**Interaction:**

- Mouse drag — orbit camera (`orbitControl`)
- `Space` — reset simulation
