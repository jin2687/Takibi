/** 焚き火の「外部状態」。ホストが管理し全員に配信する。 */
export interface FireState {
  /** 現在の火力 0.0〜1.0 */
  intensity: number
  /** 経過時間（秒） */
  elapsed: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number    // 0.0 → 1.0 (生まれたて→死)
  maxLife: number // 総寿命（秒）
  size: number
  wobble: number  // 横揺れ位相
  wobbleFreq: number
}

const BASE_PARTICLES = 60
const MAX_PARTICLES = 160

export class FireEngine {
  private particles: Particle[] = []
  private emitAccum = 0

  update(dt: number, state: FireState) {
    const { intensity } = state

    // パーティクル放出量
    const rate = BASE_PARTICLES + (MAX_PARTICLES - BASE_PARTICLES) * intensity
    this.emitAccum += rate * dt
    while (this.emitAccum >= 1) {
      this.emit(intensity)
      this.emitAccum--
    }

    // 既存パーティクルを更新
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life += dt / p.maxLife
      if (p.life >= 1) {
        this.particles.splice(i, 1)
        continue
      }
      p.x += (p.vx + Math.sin(p.life * p.wobbleFreq + p.wobble) * 12) * dt
      p.y += p.vy * dt
      p.vy -= 20 * dt // 浮力（上昇を加速）
    }
  }

  private emit(intensity: number) {
    const spread = 40 + intensity * 80
    const p: Particle = {
      x: (Math.random() - 0.5) * spread,
      y: 0,
      vx: (Math.random() - 0.5) * 20,
      vy: -(60 + Math.random() * 120 * intensity),
      life: 0,
      maxLife: 0.5 + Math.random() * 1.2 * intensity,
      size: 4 + Math.random() * 14 * intensity,
      wobble: Math.random() * Math.PI * 2,
      wobbleFreq: 4 + Math.random() * 8,
    }
    this.particles.push(p)
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.clearRect(0, 0, w, h)

    // 地面の残り火（暗い赤の楕円）
    const baseX = w / 2
    const baseY = h - 40
    const grad = ctx.createRadialGradient(baseX, baseY, 0, baseX, baseY, 60)
    grad.addColorStop(0, 'rgba(255, 60, 0, 0.5)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(baseX, baseY, 80, 24, 0, 0, Math.PI * 2)
    ctx.fill()

    // 加算合成でパーティクルを描画（重なるほど白く輝く）
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    for (const p of this.particles) {
      const t = p.life             // 0→1
      const alpha = Math.sin(t * Math.PI) // 生まれ〜消えるまでの滑らか透明度

      // 色遷移: 白→黄→オレンジ→赤 (t=0 で白, t=1 で赤)
      const r = 255
      const g = Math.round(255 * Math.max(0, 1 - t * 1.5))
      const b = Math.round(200 * Math.max(0, 1 - t * 3))

      const px = baseX + p.x
      const py = baseY + p.y
      const radius = p.size * (1 - t * 0.5)

      const pg = ctx.createRadialGradient(px, py, 0, px, py, radius)
      pg.addColorStop(0, `rgba(${r},${g},${b},${alpha.toFixed(3)})`)
      pg.addColorStop(1, `rgba(${r},${g},${b},0)`)

      ctx.beginPath()
      ctx.arc(px, py, radius, 0, Math.PI * 2)
      ctx.fillStyle = pg
      ctx.fill()
    }

    ctx.restore()
  }
}
