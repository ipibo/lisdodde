// Differential Line Growth — 3D tube rendering
// p5.js (WEBGL) port of inconvergent/differential-line

const NEARL = 6
const FARL = 40
const STEP = 0.12
const MAX_N = 1200
const SPEED = 1
const TUBE_R = 2 // 4mm tube diameter (2mm radius)
const TUBE_SIDES = 10 // base cross-section resolution
const TUBE_R_MIN = 0.5
const TUBE_R_MAX = 30
const TUBE_R_STEP = 0.25
const NUM_LINES = 1 // fewer tubes for a cleaner silhouette

let pillH, pillR // set in setup() from canvas size
let tubeRadius = TUBE_R
let dlines = [] // array of multiple line structures
let isPaused = false

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
function vnorm(v) {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
function vcross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}
function vlen2(v) {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
}
// Double-reflection parallel transport (avoids frame twist)
function ptransport(N, T1, T2) {
  const v = [T2[0] - T1[0], T2[1] - T1[1], T2[2] - T1[2]]
  const c2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
  if (c2 < 1e-6) return N
  const c1 = (2 * (v[0] * N[0] + v[1] * N[1] + v[2] * N[2])) / c2
  const r = [N[0] - c1 * v[0], N[1] - c1 * v[1], N[2] - c1 * v[2]]
  const w = [T2[0] + T1[0], T2[1] + T1[1], T2[2] + T1[2]]
  const c4 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2]
  if (c4 < 1e-6) return r
  const c3 = (2 * (w[0] * r[0] + w[1] * r[1] + w[2] * r[2])) / c4
  return vnorm([r[0] - c3 * w[0], r[1] - c3 * w[1], r[2] - c3 * w[2]])
}

// ---------------------------------------------------------------------------
// 3D spatial grid
// ---------------------------------------------------------------------------
class Grid3D {
  constructor(cs) {
    this.cs = cs
    this.data = new Map()
  }
  clear() {
    this.data.clear()
  }
  add(id, x, y, z) {
    const k = `${Math.floor(x / this.cs)},${Math.floor(y / this.cs)},${Math.floor(z / this.cs)}`
    let c = this.data.get(k)
    if (!c) {
      c = []
      this.data.set(k, c)
    }
    c.push(id)
  }
  nearby(x, y, z) {
    const cx = Math.floor(x / this.cs),
      cy = Math.floor(y / this.cs),
      cz = Math.floor(z / this.cs)
    const out = []
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const c = this.data.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (c) for (const id of c) out.push(id)
        }
    return out
  }
}

// ---------------------------------------------------------------------------
// DifferentialLine3D
// ---------------------------------------------------------------------------
class DifferentialLine3D {
  constructor() {
    this.x = []
    this.y = []
    this.z = []
    this.grid = new Grid3D(FARL)
    this._init()
  }

  get n() {
    return this.x.length
  }

  _init() {
    const ry = min(width, height) * 0.24
    const count = 28
    // Stagger starting positions slightly for multiple tube effect
    const offsetX = random(
      -min(width, height) * 0.02,
      min(width, height) * 0.02,
    )
    const offsetZ = random(
      -min(width, height) * 0.02,
      min(width, height) * 0.02,
    )

    for (let i = 0; i < count; i++) {
      const t = (i / count) * 2 - 1 // from -1 to 1
      this.x.push(offsetX)
      this.y.push(t * ry)
      this.z.push(offsetZ + random(-1, 1))
    }
  }

  _rebuildGrid() {
    this.grid.clear()
    for (let i = 0; i < this.n; i++)
      this.grid.add(i, this.x[i], this.y[i], this.z[i])
  }

  optimize() {
    this._rebuildGrid()
    const n = this.n
    const sx = new Float32Array(n),
      sy = new Float32Array(n),
      sz = new Float32Array(n)

    for (let v = 0; v < n; v++) {
      const vx = this.x[v],
        vy = this.y[v],
        vz = this.z[v]
      const v1 = (v - 1 + n) % n,
        v2 = (v + 1) % n

      for (const nb of this.grid.nearby(vx, vy, vz)) {
        if (nb === v) continue
        const dx = vx - this.x[nb],
          dy = vy - this.y[nb],
          dz = vz - this.z[nb]
        const nrm = sqrt(dx * dx + dy * dy + dz * dz)

        if (nb === v1 || nb === v2) {
          if (nrm < NEARL || nrm <= 0) continue
          sx[v] -= (dx / nrm) * STEP
          sy[v] -= (dy / nrm) * STEP
          sz[v] -= (dz / nrm) * STEP
        } else {
          if (nrm > FARL || nrm <= 0) continue
          const safe = max(nrm, NEARL * 0.5)
          const f = min((FARL / safe - 1) * STEP, STEP * 4)
          sx[v] += dx * f
          sy[v] += dy * f
          sz[v] += dz * f
        }
      }

      // Pill boundary — capsule along Y axis (narrow for cattail)
      const cy = max(-pillH, min(pillH, vy))
      const pdist = sqrt(vx * vx + (vy - cy) * (vy - cy) + vz * vz)
      if (pdist > pillR * 0.8 && pdist > 0) {
        const bf = min((pdist - pillR * 0.8) / (pillR * 0.2), 2) * 1.2
        sx[v] += (-vx / pdist) * bf
        sy[v] += ((cy - vy) / pdist) * bf
        sz[v] += (-vz / pdist) * bf
      }
      // Vertical growth bias - encourage upward/downward movement
      sy[v] += vy > 0 ? 0.02 : -0.02
    }

    for (let v = 0; v < n; v++) {
      this.x[v] += sx[v]
      this.y[v] += sy[v]
      this.z[v] += sz[v]
    }
  }

  _curvature(i) {
    const n = this.n,
      p = (i - 1 + n) % n,
      nx = (i + 1) % n
    const ax = this.x[p] - this.x[i],
      ay = this.y[p] - this.y[i],
      az = this.z[p] - this.z[i]
    const bx = this.x[nx] - this.x[i],
      by = this.y[nx] - this.y[i],
      bz = this.z[nx] - this.z[i]
    const la = sqrt(ax * ax + ay * ay + az * az),
      lb = sqrt(bx * bx + by * by + bz * bz)
    if (la < 0.001 || lb < 0.001) return 0
    return (
      ((ax / la) * (bx / lb) +
        (ay / la) * (by / lb) +
        (az / la) * (bz / lb) +
        1) *
      0.5
    )
  }

  spawn() {
    if (this.n >= MAX_N) return
    const n = this.n,
      nx = [],
      ny = [],
      nz = []
    for (let i = 0; i < n; i++) {
      nx.push(this.x[i])
      ny.push(this.y[i])
      nz.push(this.z[i])
      const j = (i + 1) % n
      const edx = this.x[j] - this.x[i],
        edy = this.y[j] - this.y[i],
        edz = this.z[j] - this.z[i]
      const edl = sqrt(edx * edx + edy * edy + edz * edz)
      const curv = max(this._curvature(i), this._curvature(j))
      if ((edl > NEARL * 3.2 && curv > 0.14) || edl > NEARL * 5) {
        nx.push(this.x[i] + edx * 0.5 + random(-0.5, 0.5))
        ny.push(this.y[i] + edy * 0.5 + random(-0.5, 0.5))
        nz.push(this.z[i] + edz * 0.5 + random(-0.5, 0.5))
      }
    }
    this.x = nx
    this.y = ny
    this.z = nz
  }
}

// ---------------------------------------------------------------------------
// Tube renderer — builds a mesh around the line path each frame
// ---------------------------------------------------------------------------
function getTubeSideCount(r) {
  const target = Math.max(TUBE_SIDES, Math.ceil(r * 1.6))
  return Math.min(24, target + (target % 2))
}

function getRenderPath(dl) {
  const n = dl.n
  const path = new Array(n)

  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n
    const nx = (i + 1) % n
    path[i] = [
      dl.x[p] * 0.2 + dl.x[i] * 0.6 + dl.x[nx] * 0.2,
      dl.y[p] * 0.2 + dl.y[i] * 0.6 + dl.y[nx] * 0.2,
      dl.z[p] * 0.2 + dl.z[i] * 0.6 + dl.z[nx] * 0.2,
    ]
  }

  return path
}

function buildTubeGeometry(dl, r = tubeRadius) {
  const path = getRenderPath(dl)
  const n = path.length
  const S = getTubeSideCount(r)

  const T = new Array(n)
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n
    const nx = (i + 1) % n
    T[i] = vnorm([
      path[nx][0] - path[p][0],
      path[nx][1] - path[p][1],
      path[nx][2] - path[p][2],
    ])
  }

  let N = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const d0 = N[0] * T[0][0] + N[1] * T[0][1] + N[2] * T[0][2]
  N = vnorm([N[0] - d0 * T[0][0], N[1] - d0 * T[0][1], N[2] - d0 * T[0][2]])

  const pos = new Array(n)
  const nrm = new Array(n)

  for (let i = 0; i < n; i++) {
    let B = vcross(T[i], N)
    if (vlen2(B) < 1e-8) {
      const up = Math.abs(T[i][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
      B = vcross(T[i], up)
    }
    B = vnorm(B)
    N = vnorm(vcross(B, T[i]))

    pos[i] = new Array(S)
    nrm[i] = new Array(S)
    for (let s = 0; s < S; s++) {
      const a = (TWO_PI / S) * s
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const nx = ca * N[0] + sa * B[0]
      const ny = ca * N[1] + sa * B[1]
      const nz = ca * N[2] + sa * B[2]
      pos[i][s] = [
        path[i][0] + r * nx,
        path[i][1] + r * ny,
        path[i][2] + r * nz,
      ]
      nrm[i][s] = [nx, ny, nz]
    }

    if (i < n - 1) N = ptransport(N, T[i], T[(i + 1) % n])
  }

  return { pos, nrm, sides: S }
}

function drawTube(dl, r = tubeRadius) {
  const { pos, nrm, sides: S } = buildTubeGeometry(dl, r)
  const n = pos.length

  // Draw one TRIANGLE_STRIP per face around the tube
  noStroke()
  fill(220, 200, 180)
  for (let s = 0; s < S; s++) {
    const s1 = (s + 1) % S
    beginShape(TRIANGLE_STRIP)
    for (let i = 0; i <= n; i++) {
      const idx = i % n
      const pa = pos[idx][s],
        na = nrm[idx][s]
      const pb = pos[idx][s1],
        nb = nrm[idx][s1]
      normal(na[0], na[1], na[2])
      vertex(pa[0], pa[1], pa[2])
      normal(nb[0], nb[1], nb[2])
      vertex(pb[0], pb[1], pb[2])
    }
    endShape()
  }
}

function buildTubeMesh(dl, r = tubeRadius) {
  const { pos, sides: S } = buildTubeGeometry(dl, r)
  const n = pos.length
  const vertices = []
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < S; s++) {
      vertices.push(pos[i][s])
    }
  }

  const faces = []
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n
    for (let s = 0; s < S; s++) {
      const s1 = (s + 1) % S
      const a = i * S + s
      const b = i1 * S + s
      const c = i1 * S + s1
      const d = i * S + s1
      faces.push([a + 1, b + 1, c + 1])
      faces.push([a + 1, c + 1, d + 1])
    }
  }

  return { vertices, faces }
}

function exportOBJ(dl) {
  const mesh = buildTubeMesh(dl, tubeRadius)
  const lines = []
  lines.push("# Differential line tube export")
  lines.push(`# vertices ${mesh.vertices.length}`)
  lines.push(`# faces ${mesh.faces.length}`)

  for (const v of mesh.vertices) {
    lines.push(`v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`)
  }
  for (const f of mesh.faces) {
    lines.push(`f ${f[0]} ${f[1]} ${f[2]}`)
  }

  saveStrings(lines, `differential_line_${Date.now()}`, "obj")
}

function exportOBJMultiple(dlines) {
  const allLines = []
  let vertexOffset = 0

  allLines.push("# Differential line tube export - multiple tubes")

  for (let lineIdx = 0; lineIdx < dlines.length; lineIdx++) {
    const mesh = buildTubeMesh(dlines[lineIdx], tubeRadius)
    allLines.push(
      `# Tube ${lineIdx + 1}: ${mesh.vertices.length} vertices, ${mesh.faces.length} faces`,
    )

    for (const v of mesh.vertices) {
      allLines.push(
        `v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}`,
      )
    }

    for (const f of mesh.faces) {
      allLines.push(
        `f ${f[0] + vertexOffset} ${f[1] + vertexOffset} ${f[2] + vertexOffset}`,
      )
    }

    vertexOffset += mesh.vertices.length
  }

  saveStrings(allLines, `differential_cattail_${Date.now()}`, "obj")
}

// ---------------------------------------------------------------------------
let autoAngle = 0

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL)
  pillH = min(width, height) * 0.45 // 20cm height
  pillR = min(width, height) * 0.04 // narrow for cattail
  dlines = []
  for (let i = 0; i < NUM_LINES; i++) {
    dlines.push(new DifferentialLine3D())
  }
}

function draw() {
  background(10, 10, 10)

  // Keep apparent tube thickness uniform by removing perspective depth scaling.
  const halfW = width * 0.5
  const halfH = height * 0.5
  ortho(-halfW, halfW, -halfH, halfH, -5000, 5000)

  ambientLight(50)
  directionalLight(255, 245, 220, 0.4, 0.8, -0.6)
  directionalLight(60, 80, 120, -0.4, -0.8, 0.6)

  orbitControl(2, 2, 0.05)
  if (!isPaused) autoAngle += 0.004
  rotateY(autoAngle)
  rotateX(0.25)

  if (!isPaused) {
    for (let i = 0; i < SPEED; i++) {
      for (let dl of dlines) {
        dl.optimize()
        dl.spawn()
      }
    }
  }

  for (let dl of dlines) {
    drawTube(dl)
  }
}

function keyPressed() {
  if (key === " ") {
    isPaused = !isPaused
    return
  }

  if (key === "r" || key === "R") {
    dlines = []
    for (let i = 0; i < NUM_LINES; i++) {
      dlines.push(new DifferentialLine3D())
    }
    autoAngle = 0
    isPaused = false
    return
  }

  if (keyCode === UP_ARROW) {
    tubeRadius = min(TUBE_R_MAX, tubeRadius + TUBE_R_STEP)
    return
  }

  if (keyCode === DOWN_ARROW) {
    tubeRadius = max(TUBE_R_MIN, tubeRadius - TUBE_R_STEP)
    return
  }

  if (key === "e" || key === "E") {
    // Export all lines as one mesh
    const allLines = []
    for (let dl of dlines) {
      allLines.push(dl)
    }
    exportOBJMultiple(allLines)
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight)
  pillH = min(width, height) * 0.45
  pillR = min(width, height) * 0.04
}
