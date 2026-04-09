import type { UpgradeLevels } from '../game/economy'
export type { UpgradeLevels }

export interface LogState {
  id: string
  relX: number     // fraction of canvas width from center
  relY: number     // fraction of canvas height ABOVE fire base (positive = up)
  angle: number    // radians
  age: number      // 0 = fresh → 1 = burned out
  lifetime: number // seconds
  golden?: boolean // rare golden log
}

export interface FireState {
  intensity: number
  elapsed: number
  logs: LogState[]
  // economy
  embers: number
  totalEmbers: number
  upgrades: UpgradeLevels
  coopBonusMult: number   // 1 or 2
  coopBonusEnd: number    // Date.now() ms
}

interface Particle {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  size: number; wobble: number; wobbleFreq: number
  golden?: boolean
}

interface FallingLog {
  currentRelY: number  // starts high (>0.86), falls to targetRelY
  vy: number           // negative = falling down (relY decreasing)
  settled: boolean
  golden: boolean
}

const FIRE_BASE_Y = 0.86   // fire base at 86% of canvas height

export class FireEngine {
  private particles: Particle[] = []
  private emitAccum = 0
  private fallingLogs = new Map<string, FallingLog>()
  private seenLogIds = new Set<string>()
  private cur: FireState = {
    intensity: 0.1, elapsed: 0, logs: [],
    embers: 0, totalEmbers: 0,
    upgrades: { woodSplitter: 0, herbBundle: 0, pineResin: 0, stoneCircle: 0, goldenBell: 0, firePit: 0, fireAlchemy: 0 },
    coopBonusMult: 1, coopBonusEnd: 0,
  }

  update(dt: number, state: FireState, w: number, h: number) {
    this.cur = state

    // Register new logs → start falling animation
    for (const log of state.logs) {
      if (!this.seenLogIds.has(log.id)) {
        this.seenLogIds.add(log.id)
        this.fallingLogs.set(log.id, {
          currentRelY: 1.15, vy: 0, settled: false, golden: !!log.golden,
        })
        // Golden log: immediate golden burst at top of fall (small anticipation)
        if (log.golden) {
          const bx = w / 2 + log.relX * w
          const by = h * FIRE_BASE_Y - 1.15 * h
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 20 + Math.random() * 50
            this.particles.push({
              x: bx, y: by,
              vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
              life: 0, maxLife: 0.3 + Math.random() * 0.4,
              size: 2 + Math.random() * 5,
              wobble: Math.random() * Math.PI * 2, wobbleFreq: 3 + Math.random() * 4,
              golden: true,
            })
          }
        }
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
      const log = state.logs.find(l => l.id === id)
      if (!log) continue

      // Re-settle: if settled log's target moved lower, restart fall
      if (fl.settled && fl.currentRelY > log.relY + 0.012) {
        fl.settled = false
        fl.vy = 0
      }

      if (fl.settled) continue
      fl.vy -= GRAVITY * dt
      fl.currentRelY += fl.vy * dt
      if (fl.currentRelY <= log.relY) {
        fl.currentRelY = log.relY
        fl.vy = 0
        fl.settled = true
        // Landing spark burst
        const bx = w / 2 + log.relX * w
        const by = h * FIRE_BASE_Y - fl.currentRelY * h
        const count = fl.golden ? 28 : 14
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2
          const sp = 40 + Math.random() * 90
          this.particles.push({
            x: bx, y: by,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70,
            life: 0, maxLife: 0.15 + Math.random() * 0.35,
            size: 1.5 + Math.random() * 4,
            wobble: Math.random() * Math.PI * 2, wobbleFreq: 3 + Math.random() * 4,
            golden: fl.golden,
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
      : Math.min(200, 45 + state.intensity * 90 + activeLogs.length * 18)

    this.emitAccum += rate * dt
    while (this.emitAccum >= 1) {
      if (this.particles.length < 500) {
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
            Math.max(0.1, (1 - log.age) * state.intensity),
            !!log.golden,
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

  private emit(x: number, y: number, intensity: number, golden = false) {
    this.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 18,
      vy: -(55 + Math.random() * 110 * intensity),
      life: 0, maxLife: 0.4 + Math.random() * 1.1 * intensity,
      size: 3 + Math.random() * 13 * intensity,
      wobble: Math.random() * Math.PI * 2,
      wobbleFreq: 3 + Math.random() * 7,
      golden,
    })
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, era = 1) {
    ctx.clearRect(0, 0, w, h)
    const state = this.cur
    const bx = w / 2
    const by = h * FIRE_BASE_Y

    // Era 5: rainbow vignette background pulse
    if (era >= 5) {
      const hue = (state.elapsed * 30) % 360
      const vg = ctx.createRadialGradient(bx, by, 0, bx, by, w * 0.7)
      vg.addColorStop(0, `hsla(${hue},80%,60%,0.12)`)
      vg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)
    }

    // Ground glow — grows with era
    const glowR = w * (0.38 + (era - 1) * 0.06)
    const gr = ctx.createRadialGradient(bx, by, 0, bx, by, glowR)
    const ga = 0.22 + state.intensity * 0.32
    if (era <= 2) {
      gr.addColorStop(0, `rgba(255,80,0,${ga})`)
      gr.addColorStop(0.55, `rgba(200,40,0,${ga * 0.35})`)
    } else if (era === 3) {
      gr.addColorStop(0, `rgba(255,180,0,${ga})`)
      gr.addColorStop(0.55, `rgba(255,80,0,${ga * 0.4})`)
    } else if (era === 4) {
      gr.addColorStop(0, `rgba(120,160,255,${ga})`)
      gr.addColorStop(0.4, `rgba(255,80,200,${ga * 0.5})`)
      gr.addColorStop(0.8, `rgba(80,0,120,${ga * 0.2})`)
    } else {
      const hue2 = (state.elapsed * 40) % 360
      gr.addColorStop(0, `hsla(${hue2},100%,80%,${ga * 1.2})`)
      gr.addColorStop(0.5, `hsla(${(hue2 + 120) % 360},100%,60%,${ga * 0.4})`)
    }
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gr
    ctx.beginPath()
    ctx.ellipse(bx, by, glowR, h * 0.065, 0, 0, Math.PI * 2)
    ctx.fill()

    // Log bodies (back→front)
    const sorted = [...state.logs].sort((a, b) => b.relY - a.relY)
    for (const log of sorted) {
      const fl = this.fallingLogs.get(log.id)
      const ry = fl ? fl.currentRelY : log.relY
      this.drawLogBody(ctx, bx + log.relX * w, by - ry * h, log.angle, w, h, log.age, !!log.golden)
    }

    // Fire particles (additive)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const p of this.particles) {
      const t = p.life
      const alpha = Math.sin(t * Math.PI) * 0.85
      let rr: number, gg: number, bb: number
      if (p.golden) {
        rr = 255
        gg = Math.round(220 * Math.max(0, 1 - t * 0.9))
        bb = Math.round(80 * Math.max(0, 1 - t * 2.5))
      } else if (era === 4) {
        // 業火: blue/violet tones
        rr = Math.round(120 + 135 * Math.max(0, 1 - t * 1.2))
        gg = Math.round(80 * Math.max(0, 1 - t * 2))
        bb = Math.round(255 * Math.max(0, 1 - t * 0.8))
      } else if (era >= 5) {
        // 神の炎: rainbow
        const hue = ((state.elapsed * 60 + t * 120) % 360)
        const [r2, g2, b2] = hslToRgb(hue / 360, 1, 0.7)
        rr = r2; gg = g2; bb = b2
      } else if (era === 3) {
        // 大焚き火: more yellow
        rr = 255
        gg = Math.round(255 * Math.max(0, 1 - t * 1.1))
        bb = Math.round(60 * Math.max(0, 1 - t * 3))
      } else {
        rr = 255
        gg = Math.round(255 * Math.max(0, 1 - t * 1.7))
        bb = Math.round(170 * Math.max(0, 1 - t * 3.5))
      }
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
      this.drawEmbers(ctx, bx + log.relX * w, by - ry * h, log.angle, w, h, log.age, state.elapsed, !!log.golden)
    }
    ctx.restore()
  }

  private drawLogBody(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, angle: number,
    w: number, h: number, age: number, golden: boolean,
  ) {
    const lw = Math.max(22, w * 0.18)
    const lh = Math.max(8, h * 0.028)
    const cr = lh * 0.48
    const t = Math.min(1, age * 1.15)
    const opacity = age > 0.82 ? Math.max(0, 1 - (age - 0.82) / 0.18) : 1

    let r: number, g: number, b: number
    if (golden) {
      // Gold/amber: bright gold → dark amber as it burns
      r = Math.round(220 - t * 100)
      g = Math.round(160 - t * 100)
      b = Math.round(10 - t * 8)
    } else {
      r = Math.round(118 - t * 82)
      g = Math.round(63 - t * 48)
      b = Math.round(24 - t * 17)
    }

    ctx.save()
    ctx.globalAlpha = opacity
    ctx.translate(cx, cy)
    ctx.rotate(angle)

    // Golden glow aura
    if (golden && age < 0.7) {
      const glowA = (1 - age / 0.7) * 0.35
      ctx.shadowColor = `rgba(255,200,0,${glowA})`
      ctx.shadowBlur = 18
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = 7
    }
    ctx.shadowOffsetY = 4

    // Body gradient (lit from above)
    const bg = ctx.createLinearGradient(0, -lh / 2, 0, lh / 2)
    if (golden) {
      bg.addColorStop(0, `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 40)},${Math.min(255, b + 30)})`)
      bg.addColorStop(0.35, `rgb(${r},${g},${b})`)
      bg.addColorStop(1, `rgb(${Math.max(0, r - 30)},${Math.max(0, g - 20)},${Math.max(0, b - 8)})`)
    } else {
      bg.addColorStop(0, `rgb(${Math.min(255, r + 55)},${Math.min(255, g + 28)},${b + 16})`)
      bg.addColorStop(0.35, `rgb(${r},${g},${b})`)
      bg.addColorStop(1, `rgb(${Math.max(0, r - 28)},${Math.max(0, g - 14)},${Math.max(0, b - 9)})`)
    }
    ctx.beginPath()
    ctx.roundRect(-lw / 2, -lh / 2, lw, lh, cr)
    ctx.fillStyle = bg
    ctx.fill()

    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    // End caps
    const ec = golden
      ? `rgb(${Math.max(0, r - 20)},${Math.max(0, g - 30)},0)`
      : `rgb(${Math.max(0, r - 32)},${Math.max(0, g - 16)},${Math.max(0, b - 10)})`
    ctx.fillStyle = ec
    ctx.beginPath()
    ctx.ellipse(-lw / 2 + cr * 0.8, 0, cr, lh / 2 - 1, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(lw / 2 - cr * 0.8, 0, cr, lh / 2 - 1, 0, 0, Math.PI * 2)
    ctx.fill()

    // Grain lines (gold shimmer lines for golden log)
    if (golden) {
      ctx.strokeStyle = 'rgba(255,240,100,0.25)'
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'
    }
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
    w: number, h: number, age: number, elapsed: number, golden: boolean,
  ) {
    const lw = Math.max(22, w * 0.18)
    const lh = Math.max(8, h * 0.028)
    const burn = Math.min(1, (age - 0.1) / 0.7)
    if (burn <= 0) return
    const count = golden ? 8 + Math.floor(burn * 12) : 4 + Math.floor(burn * 7)

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
      if (golden) {
        eg.addColorStop(0, `rgba(255,255,180,${Math.min(0.95, alpha * 2)})`)
        eg.addColorStop(0.4, `rgba(255,200,0,${alpha * 1.2})`)
        eg.addColorStop(1, 'rgba(255,100,0,0)')
      } else {
        eg.addColorStop(0, `rgba(255,220,90,${Math.min(0.9, alpha * 1.6)})`)
        eg.addColorStop(0.5, `rgba(255,90,0,${alpha * 0.85})`)
        eg.addColorStop(1, 'rgba(255,20,0,0)')
      }
      ctx.beginPath()
      ctx.arc(ex, ey, sz * 3, 0, Math.PI * 2)
      ctx.fillStyle = eg
      ctx.fill()
    }
    ctx.restore()
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [f(0), f(8), f(4)]
}
