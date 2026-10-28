// 滑点（bps，50 = 0.5%）→ 链上 min 字段。合法范围 0 < bps ≤ 5000：
// 0 = min 等于报价本身，任何价格变动都会让订单失败；> 50% 基本等于不设保护。越界说明上游有 bug，直接抛错、不钳制。
import { toBigInt } from './int.ts'

export const MAX_SLIPPAGE_BPS = 5000
const BPS = BigInt(10000)

export function isValidSlippageBps(bps: number): boolean {
  return Number.isInteger(bps) && bps > 0 && bps <= MAX_SLIPPAGE_BPS
}

function applySlippageBps(amount: string, bps: number, name: string): string {
  if (!isValidSlippageBps(bps)) throw new Error(`Invalid slippage bps: ${String(bps)}`)
  return ((toBigInt(amount, name) * (BPS - BigInt(bps))) / BPS).toString()
}

/** swap 的 amt1_min：floor(amtOut × (10000 − bps) ÷ 10000) */
export function minReceived(amtOut: string, slippageBps: number): string {
  return applySlippageBps(amtOut, slippageBps, 'amtOut')
}

/**
 * 加流动性的 amt0_min / amt1_min：floor(amt × (10000 − bps) ÷ 10000)。
 * indexer（storage/swap.go SwapAdd）按当时储备只存一侧满额、另一侧按比例，实际存入低于对应 min 即订单失败。
 * 建池（create）不读 min，别拿它算 create。
 */
export function liquidityMin(amt: string, slippageBps: number): string {
  return applySlippageBps(amt, slippageBps, 'amt')
}
