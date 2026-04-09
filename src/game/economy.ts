import type { FireState } from '../fire/FireEngine'

export interface UpgradeLevels {
  woodSplitter: number   // 🪓 薪割り斧: クールタイム短縮
  herbBundle: number     // 🌿 よもぎ束: 火種/秒 UP
  pineResin: number      // 🫙 松脂: 薪の燃焼時間延長
  stoneCircle: number    // 🪨 囲い石: 火種倍率UP
  goldenBell: number     // 🔔 黄金の鐘: ゴールデン薪確率UP
  firePit: number        // 🏕️ 焚き火台: 最大薪本数UP
  fireAlchemy: number    // 🔮 炎の秘術: 全火種獲得×倍
}

export const DEFAULT_UPGRADES: UpgradeLevels = {
  woodSplitter: 0, herbBundle: 0, pineResin: 0,
  stoneCircle: 0, goldenBell: 0, firePit: 0, fireAlchemy: 0,
}

export interface UpgradeDef {
  id: keyof UpgradeLevels
  icon: string
  name: string
  desc: (nextLevel: number) => string
  baseCost: number
  costMult: number
  maxLevel: number
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'woodSplitter', icon: '🪓', name: '薪割り斧',
    desc: l => `クールタイム -${l * 8}%`,
    baseCost: 50, costMult: 1.6, maxLevel: 10,
  },
  {
    id: 'herbBundle', icon: '🌿', name: 'よもぎ束',
    desc: l => `火種/秒 +${l * 15}%`,
    baseCost: 80, costMult: 1.7, maxLevel: 10,
  },
  {
    id: 'pineResin', icon: '🫙', name: '松脂',
    desc: l => `薪の燃焼 +${l * 20}%`,
    baseCost: 150, costMult: 1.8, maxLevel: 10,
  },
  {
    id: 'stoneCircle', icon: '🪨', name: '囲い石',
    desc: l => `火種倍率 ×${(1 + l * 0.25).toFixed(2)}`,
    baseCost: 300, costMult: 2.0, maxLevel: 10,
  },
  {
    id: 'goldenBell', icon: '🔔', name: '黄金の鐘',
    desc: l => `ゴールデン確率 +${l * 5}%`,
    baseCost: 600, costMult: 2.2, maxLevel: 10,
  },
  {
    id: 'firePit', icon: '🏕️', name: '焚き火台',
    desc: l => `最大薪 +${l * 3}本`,
    baseCost: 1200, costMult: 2.5, maxLevel: 5,
  },
  {
    id: 'fireAlchemy', icon: '🔮', name: '炎の秘術',
    desc: l => `全火種 ×${Math.pow(1.8, l).toFixed(1)}`,
    baseCost: 5000, costMult: 3.0, maxLevel: 10,
  },
]

export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  return Math.floor(def.baseCost * Math.pow(def.costMult, currentLevel))
}

// 時代の閾値（累計火種）
export const ERA_THRESHOLDS = [0, 1_000, 20_000, 500_000, 10_000_000]
export const ERA_NAMES = ['初火', '炉端', '大焚き火', '業火', '神の炎']
export const ERA_COLORS = ['#ff8c30', '#ffd060', '#60d0ff', '#b060ff', '#ffffff']

export function calcEra(totalEmbers: number): number {
  for (let i = ERA_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalEmbers >= ERA_THRESHOLDS[i]) return i + 1
  }
  return 1
}

export function calcEmberRate(state: FireState, guestCount: number): number {
  const { intensity, logs, upgrades, coopBonusMult } = state
  const activeLogs = logs.filter(l => l.age < 0.95).length
  const base = intensity * 10 + activeLogs * 2
  const herbMult    = 1 + upgrades.herbBundle * 0.15
  const stoneMult   = 1 + upgrades.stoneCircle * 0.25
  const alchemyMult = Math.pow(1.8, upgrades.fireAlchemy)
  const playerMult  = 1 + guestCount * 0.4
  return base * herbMult * stoneMult * alchemyMult * playerMult * coopBonusMult
}

export function effectiveCooldown(baseMs: number, upgrades: UpgradeLevels): number {
  return Math.floor(baseMs * Math.pow(0.92, upgrades.woodSplitter))
}

export function effectiveMaxLogs(base: number, upgrades: UpgradeLevels): number {
  return base + upgrades.firePit * 3
}

export function goldenChance(upgrades: UpgradeLevels): number {
  return Math.min(0.5, 0.15 + upgrades.goldenBell * 0.05)
}

export function logLifetimeMult(upgrades: UpgradeLevels): number {
  return 1 + upgrades.pineResin * 0.20
}
