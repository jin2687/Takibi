export interface LogState {
  id: string
  relX: number     // fraction of canvas width from center
  relY: number     // fraction of canvas height ABOVE fire base (positive = up)
  angle: number    // radians
  age: number      // 0 = fresh → 1 = burned out
  lifetime: number // seconds
}

export interface FireState {
  intensity: number
  elapsed: number
  logs: LogState[]
}

interface Particle {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  size: number; wobble: number; wobbleFreq: number
}

interface FallingLog {
  currentRelY: number  // starts high (>0.86), falls to targetRelY
  vy: number           // negative = falling down (relY decreasing)
  settled: boolean
}

const FIRE_BASE_Y = 0.86   // fire base at 86% of canvas height

export class FireEngine {
  private particles: Particle[] = []
  private emitAccum = 0
  private fallingLogs = new Map<string, FallingLog>()
  private seenLogIds = new Set<string>()
  private cur: FireState = { intensity: 0.1, elapsed: 0, logs: [] }

  update(dt: number, state: FireState, w: number, h: number) {
    this.cur = state

    // Register new logs → start falling animation
    for (const log of state.logs) {
      if (!this.seenLogIds.has(log.id)) {
        this.seenLogIds.add(log.id)
        this.fallingLogs.set(log.id, { currentRelY: 1.15, vy: 0, settled: false })
      }
    }

    // Prune stale animation data
    for (const id of [...this.seenLogIds]) {
      if (!state.logs.some(l => l.id === id)) {
        this.seenLogIds.delete(id)
        this.fallingLogs.delete(id)
      }
    }

    // Physics: logs fall downward (relY decreases toward target)
    const GRAVITY = 3.0
    for (const [id, fl] of this.fallingLogs) {
      if (fl.settled) continue
      fl.vy -= GRAVITY * dt
      fl.currentRelY += fl.vy * dt
      const log = state.logs.find(l => l.id === id)
      if (log && fl.currentRelY <= log.relY) {
        fl.currentRelY = log.relY
        fl.vy = 0
        fl.settled = true
        // Landing spark burst
        const bx = w / 2 + log.relX * w
        const by = h * FIRE_BASE_Y - fl.currentRelY * h
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2
          const sp = 40 + Math.random() * 90
          this.particles.push({
            x: bx, y: by,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70,
            life: 0, maxLife: 0.15 + Math.random() * 0.35,
            size: 1.5 + Math.random() * 4,
            wobble: Math.random() * Math.PI * 2, wobbleFreq: 3 + Math.random() * 4,
          })
        }
      }
    }

    // Particle emission
    const fireBaseX = w / 2
    const fireBaseY = h * FIRE_BASE_Y
    const activeLogs = state.logs.filter(l => l.age < 0.95)

    const rate = activeLogs.length === 0
      ? 20 + state.intensity * 40
      : Math.min(160, 45 + state.intensity * 90 + activeLogs.length * 18)

    this.emitAccum += rate * dt
    while (this.emitAccum >= 1) {
      if (this.particles.length < 450) {
        if (activeLogs.length === 0) {
          this.emit(fireBaseX + (Math.random() - 0.5) * w * 0.05, fireBaseY, state.intensity)
        } else {
          const log = activeLogs[Math.floor(Math.random() * activeLogs.length)]
          const fl = this.fallingLogs.get(log.id)
          const ry = fl ? fl.currentRelY : log.relY
          const lx = fireBaseX + log.relX * w
          const ly = fireBaseY - ry * h
          const logW = w * 0.18
          this.emit(
            lx + (Math.random() - 0.5) * logW * 0.85,
            ly + (Math.random() - 0.5) * h * 0.012,
            Math.max(0.1, (1 - log.age) * state.intensity)
          )
        }
      }
      this.emitAccum--
    }
    if (this.emitAccum > 2) this.emitAccum = 0

    // Advance particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt / p.maxLife
      if (p.life >= 1) { this.particles.splice(i, 1); continue }
      p.x += (p.vx + Math.sin(p.life * p.wobbleFreq + p.wobble) * 14) * dt
      p.y += p.vy * dt
      p.vy -= 28 * dt
    }
  }

  private emit(x: number, y: number, intensity: number) {
    this.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 18,
      vy: -(55 + Math.random() * 110 * intensity),
      life: 0, maxLife: 0.4 + Math.random() * 1.1 * intensity,
      size: 3 + Math.random() * 13 * intensity,
      wobble: Math.random() * Math.PI * 2,
      wobbleFreq: 3 + Math.random() * 7,
    })
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.clearRect(0, 0, w, h)
    const state = this.cur
    const bx = w / 2
    const by = h * FIRE_BASE_Y

    // Ground glow
    const gr = ctx.createRadialGradient(bx, by, 0, bx, by, w * 0.38)
    const ga = 0.22 + state.intensity * 0.32
    gr.addColorStop(0, `rgba(255,80,0,${ga})`)
    gr.addColorStop(0.55, `rgba(200,40,0,${ga * 0.35})`)
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gr
    ctx.beginPath()
    ctx.ellipse(bx, by, w * 0.38, h * 0.065, 0, 0, Math.PI * 2)
    ctx.fill()

    // Log bodies (back→front)
    const sorted = [...state.logs].sort((a, b) => b.relY - a.relY)
    for (const log of sorted) {
      const fl = this.fallingLogs.get(log.id)
      const ry = fl ? fl.currentRelY : log.relY
      this.drawLogBody(ctx, bx + log.relX * w, by - ry * h, log.angle, w, h, log.age)
    }

    // Fire particles (additive)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const p of this.particles) {
      const t = p.life
      const alpha = Math.sin(t * Math.PI) * 0.85
      const rr = 255
      const gg = Math.round(255 * Math.max(0, 1 - t * 1.7))
      const bb = Math.round(170 * Math.max(0, 1 - t * 3.5))
      const radius = Math.max(0.5, p.size * (1 - t * 0.45))
      const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
      pg.addColorStop(0, `rgba(${rr},${gg},${bb},${alpha.toFixed(2)})`)
      pg.addColorStop(1, `rgba(${rr},${gg},${bb},0)`)
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = pg
      ctx.fill()
    }
    ctx.restore()

    // Embers on logs (additive, drawn on top of fire)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const log of sorted) {
      if (log.age < 0.12) continue
      const fl = this.fallingLogs.get(log.id)
      const ry = fl ? fl.currentRelY : log.relY
      if (fl && !fl.settled) continue
      this.drawEmbers(ctx, bx + log.relX * w, by - ry * h, log.angle, w, h, log.age, state.elapsed)
    }
    ctx.restore()
  }

  private drawLogBody(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, angle: number,
    w: number, h: number, age: number
  ) {
    const lw = Math.max(22, w * 0.18)
    const lh = Math.max(8, h * 0.028)
    const cr = lh * 0.48
    const t = Math.min(1, age * 1.15)
    const r = Math.round(118 - t * 82)
    const g = Math.round(63 - t * 48)
    const b = Math.round(24 - t * 17)
    const opacity = age > 0.82 ? Math.max(0, 1 - (age - 0.82) / 0.18) : 1

    ctx.save()
    ctx.globalAlpha = opacity
    ctx.translate(cx, cy)
    ctx.rotate(angle)

    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.55)'
    ctx.shadowBlur = 7
    ctx.shadowOffsetY = 4

    // Body gradient (lit from above)
    const bg = ctx.createLinearGradient(0, -lh / 2, 0, lh / 2)
    bg.addColorStop(0, `rgb(${Math.min(255, r + 55)},${Math.min(255, g + 28)},${b + 16})`)
    bg.addColorStop(0.35, `rgb(${r},${g},${b})`)
    bg.addColorStop(1, `rgb(${Math.max(0, r - 28)},${Math.max(0, g - 14)},${Math.max(0, b - 9)})`)
    ctx.beginPath()
    ctx.roundRect(-lw / 2, -lh / 2, lw, lh, cr)
    ctx.fillStyle = bg
    ctx.fill()

    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    // End caps
    const ec = `rgb(${Math.max(0, r - 32)},${Math.max(0, g - 16)},${Math.max(0, b - 10)})`
    ctx.fillStyle = ec
    ctx.beginPath()
    ctx.ellipse(-lw / 2 + cr * 0.8, 0, cr, lh / 2 - 1, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(lw / 2 - cr * 0.8, 0, cr, lh / 2 - 1, 0, 0, Math.PI * 2)
    ctx.fill()

    // Grain lines
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    ctx.lineWidth = 0.8
    for (let i = -2; i <= 2; i++) {
      const lx = (i / 2.5) * lw * 0.3
      ctx.beginPath()
      ctx.moveTo(lx - 1, -lh / 2 + 2)
      ctx.lineTo(lx + 1, lh / 2 - 2)
      ctx.stroke()
    }

    ctx.restore()
  }

  private drawEmbers(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, angle: number,
    w: number, h: number, age: number, elapsed: number
  ) {
    const lw = Math.max(22, w * 0.18)
    const lh = Math.max(8, h * 0.028)
    const burn = Math.min(1, (age - 0.1) / 0.7)
    if (burn <= 0) return
    const count = 4 + Math.floor(burn * 7)

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)

    for (let i = 0; i < count; i++) {
      const phase = elapsed * (1.3 + i * 0.22) + (i / count) * Math.PI * 2
      const ex = Math.sin(phase * 1.8) * lw * 0.38
      const ey = Math.cos(phase * 2.5) * lh * 0.28
      const sz = (1.4 + Math.sin(phase * 3.1) * 0.7) * (0.5 + burn * 0.6)
      const alpha = burn * (0.35 + Math.sin(phase * 2) * 0.18)
      const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, sz * 3)
      eg.addColorStop(0, `rgba(255,220,90,${Math.min(0.9, alpha * 1.6)})`)
      eg.addColorStop(0.5, `rgba(255,90,0,${alpha * 0.85})`)
      eg.addColorStop(1, 'rgba(255,20,0,0)')
      ctx.beginPath()
      ctx.arc(ex, ey, sz * 3, 0, Math.PI * 2)
      ctx.fillStyle = eg
      ctx.fill()
    }
    ctx.restore()
  }
}
