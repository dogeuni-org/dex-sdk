// 单池 swap 报价（链上原始整数串），与 indexer 逐位一致——
// dogeuni-indexer storage/swap.go（pair-v1）/ storage/swap_v2.go（pair-v2）的 swapExec 与 explorer/verifys.go 的校验是同一公式：
//   fee = floor(amt0 ÷ 1000) × 3，amtin = amt0 − fee，amtout = floor(amtin × r_out ÷ (r_in + amtin))
// 链上 amtout < amt1_min 即订单失败（"the minimum output less than the limit"）。
// 协议只有单池 swap：按 (tick0, tick1) 找一个池子执行，没有多跳，这里也只报单池。
import { toBigInt } from './int.ts'

export interface SwapPool {
  /** pair-v1 为 tick，pair-v2 为 tick_id */
  tick0: string
  tick1: string
  /** 链上原始整数串 */
  amt0: string
  amt1: string
}

export interface SwapQuote {
  /** 输出代币原始整数串（链上 amtout） */
  amtOut: string
  /** LP 手续费，单位是输入代币（从 amtIn 里扣，留在池子里） */
  fee: string
  /** 价格影响（bps，四舍五入）：只反映池子深度，= amtIn ÷ (r_in + amtIn)，不含手续费 */
  priceImpactBps: number
}

const ZERO = BigInt(0)

/** LP 手续费：floor(amtIn ÷ 1000) × 3（千分位向下取整，不是 amtIn × 0.3%） */
export function swapFee(amtIn: string): string {
  return ((toBigInt(amtIn, 'amtIn') / BigInt(1000)) * BigInt(3)).toString()
}

/** 用 amtIn（原始整数串，> 0）的 tickIn 换池子另一侧代币。tickIn 不在池子里时抛错 */
export function quoteExactIn(pool: SwapPool, tickIn: string, amtIn: string): SwapQuote {
  const inIsTick0 = tickIn === pool.tick0
  if (!inIsTick0 && tickIn !== pool.tick1) throw new Error(`Token ${tickIn} not in pool ${pool.tick0}/${pool.tick1}`)
  const a = toBigInt(amtIn, 'amtIn')
  if (a === ZERO) throw new Error('amtIn must be positive')
  const rIn = toBigInt(inIsTick0 ? pool.amt0 : pool.amt1, 'reserveIn')
  const rOut = toBigInt(inIsTick0 ? pool.amt1 : pool.amt0, 'reserveOut')
  const fee = (a / BigInt(1000)) * BigInt(3)
  const net = a - fee
  const amtOut = (net * rOut) / (rIn + net)
  const depth = rIn + a
  const priceImpactBps = Number((a * BigInt(20000) + depth) / (depth * BigInt(2)))
  return { amtOut: amtOut.toString(), fee: fee.toString(), priceImpactBps }
}

/** 按当前储备提交 amt1Min，链上会不会通过 min 校验（钱包复核 amt1_min 用） */
export function checkMinOut(pool: SwapPool, tickIn: string, amtIn: string, amt1Min: string): boolean {
  return toBigInt(quoteExactIn(pool, tickIn, amtIn).amtOut, 'amtOut') >= toBigInt(amt1Min, 'amt1Min')
}
