// LP 持仓 → 投入数量 / 可提取数量（链上原始整数串，全部向下取整）。
import { mulDivFloor } from './units.ts'

export interface LpShare {
  /** 持有的 LP 数量 */
  lp: string
  /** 池子 tick0 / tick1 储备 */
  poolAmt0: string
  poolAmt1: string
  /** 池子总流动性（liquidity_total） */
  total: string
}

/** 持仓按份额折算的两侧数量：pooledX = 储备X × LP ÷ 总流动性 */
export function lpPooledAmounts(share: LpShare): { amt0: string; amt1: string } {
  return {
    amt0: mulDivFloor(share.poolAmt0, share.lp, share.total),
    amt1: mulDivFloor(share.poolAmt1, share.lp, share.total),
  }
}

/** 移除 percent%（1–100 的整数）：liquidity = LP × percent ÷ 100，amtX = 储备X × liquidity ÷ 总流动性 */
export function lpWithdrawAmounts(share: LpShare, percent: number): { liquidity: string; amt0: string; amt1: string } {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error(`Invalid percent: ${String(percent)}`)
  const liquidity = mulDivFloor(share.lp, String(percent), '100')
  return {
    liquidity,
    amt0: mulDivFloor(share.poolAmt0, liquidity, share.total),
    amt1: mulDivFloor(share.poolAmt1, liquidity, share.total),
  }
}
