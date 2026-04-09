import type { UpgradeLevels } from '../fire/FireEngine'
import { UPGRADES, upgradeCost, ERA_NAMES, ERA_THRESHOLDS, ERA_COLORS, calcEra } from '../game/economy'

interface ShopProps {
  embers: number
  emberRate: number
  totalEmbers: number
  upgrades: UpgradeLevels
  coopBonusMult: number
  guestCount: number
  onBuy: (id: keyof UpgradeLevels) => void
  onClose: () => void
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return Math.floor(n).toString()
}

export function Shop({ embers, emberRate, totalEmbers, upgrades, coopBonusMult, guestCount, onBuy, onClose }: ShopProps) {
  const era = calcEra(totalEmbers)
  const nextEraThreshold = ERA_THRESHOLDS[era] ?? null
  const eraColor = ERA_COLORS[era - 1]

  return (
    <div className="shop-overlay" onClick={onClose}>
      <div className="shop-panel" onClick={e => e.stopPropagation()}>
        <div className="shop-header">
          <div className="shop-header-left">
            <span className="shop-ember-count">🌟 {formatNumber(embers)}</span>
            <span className="shop-ember-rate">+{emberRate.toFixed(1)}/秒</span>
            {coopBonusMult > 1 && (
              <span className="shop-coop-badge">🤝 協力×{coopBonusMult}</span>
            )}
          </div>
          <button className="shop-close" onClick={onClose}>✕</button>
        </div>

        {/* Era display */}
        <div className="shop-era" style={{ '--era-color': eraColor } as React.CSSProperties}>
          <span className="shop-era-label">時代</span>
          <span className="shop-era-name">{ERA_NAMES[era - 1]}</span>
          {nextEraThreshold && (
            <span className="shop-era-progress">
              次の時代まで: {formatNumber(nextEraThreshold - totalEmbers)} 🌟
            </span>
          )}
          {!nextEraThreshold && <span className="shop-era-progress">最終時代！</span>}
        </div>

        {guestCount > 0 && (
          <div className="shop-player-bonus">
            👥 {guestCount + 1}人参加中 → 火種 ×{(1 + guestCount * 0.4).toFixed(1)}
          </div>
        )}

        {/* Upgrade grid */}
        <div className="shop-grid">
          {UPGRADES.map(def => {
            const level = upgrades[def.id]
            const maxed = level >= def.maxLevel
            const cost = maxed ? 0 : upgradeCost(def, level)
            const canAfford = !maxed && embers >= cost
            return (
              <button
                key={def.id}
                className={['shop-item', canAfford ? 'shop-item--afford' : '', maxed ? 'shop-item--maxed' : ''].filter(Boolean).join(' ')}
                onClick={() => !maxed && canAfford && onBuy(def.id)}
                disabled={maxed || !canAfford}
              >
                <div className="shop-item-icon">{def.icon}</div>
                <div className="shop-item-body">
                  <div className="shop-item-name">{def.name}</div>
                  <div className="shop-item-desc">{def.desc(level + 1)}</div>
                  <div className="shop-item-level">Lv {level}/{def.maxLevel}</div>
                </div>
                <div className="shop-item-cost">
                  {maxed ? '✅' : `🌟${formatNumber(cost)}`}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
