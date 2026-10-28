// 向已有池子添加流动性的数量联动（链上原始整数串）。
// 与 indexer（dogeuni-indexer explorer/verifys.go 的 amountBOptimal）同口径：另一侧 = floor(本侧 × 对侧储备 ÷ 本侧储备)。
// 别拿 swap 报价（含 0.3% 手续费与价格冲击）推另一侧——那不是链上实际扣款的比例。
import { mulDivFloor } from './units.ts'

export type LiquiditySide = 'base' | 'quote'

export interface PoolReserves {
  /** 池子 tick0 储备（链上原始整数串） */
  base: string
  /** 池子 tick1 储备 */
  quote: string
}

/** 储备不全为正的池子 indexer 直接拒绝添加（"the pool has no liquidity"） */
export function hasReserves(r: PoolReserves): boolean {
  return BigInt(r.base || '0') > BigInt(0) && BigInt(r.quote || '0') > BigInt(0)
}

/** 已输入 side 一侧 amount（原始整数串）→ 另一侧按比例的数量；池子无储备时返回 null */
export function proportionalBaseUnits(amount: string, side: LiquiditySide, reserves: PoolReserves): string | null {
  if (!hasReserves(reserves)) return null
  const [from, to] = side === 'base' ? [reserves.base, reserves.quote] : [reserves.quote, reserves.base]
  return mulDivFloor(amount, to, from)
}
