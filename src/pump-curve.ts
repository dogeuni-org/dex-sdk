// Pump（meme20 曲线发币）协议常量与报价——与 dogeuni-indexer 逐位一致（storage/pump.go、explorer/pump.go、explorer/verifys.go），
// 金额一律链上最小单位整数串，内部用 BigInt，别经 Number。

export const PUMP_WDOGE_TICK_ID = 'WDOGE(WRAPPED-DOGE)'
/** pump 代币与 WDOGE 都是 8 位精度 */
export const PUMP_DECIMALS = 8
/** 总量 1e9 枚（MemeMax） */
export const PUMP_TOTAL_SUPPLY = '100000000000000000'
/** 曲线 WDOGE 侧虚拟储备 3000 DOGE（DogeInit），pump_liquidity.amt1 含此部分 */
export const PUMP_VIRTUAL_WDOGE = '300000000000'
/** 真实 WDOGE ≥ 100,000 DOGE 毕业（DogeMax） */
export const PUMP_GRADUATION_WDOGE = '10000000000000'
/** 真实 WDOGE ≥ 10,000 DOGE 成为 king（DogeKingMax） */
export const PUMP_KING_WDOGE = '1000000000000'
/** 每笔小费 0.1 DOGE（PumpTipFee），deploy 另收创建费 5 DOGE（PumpCreateFee） */
export const PUMP_TIP_FEE = '10000000'
export const PUMP_CREATE_FEE = '500000000'
/** deploy 首笔买入上限 5000 DOGE；创建者保留比例 0–99%，与首笔买入二选一 */
export const PUMP_DEPLOY_MAX_BUY = '500000000000'
export const PUMP_MAX_RESERVE = 99

const FEE_DIVISOR = BigInt(100)
const ZERO = BigInt(0)

export interface PumpReserves {
  /** 曲线代币储备 */
  amt0: string
  /** 曲线 WDOGE 储备（含虚拟储备） */
  amt1: string
}

export interface PumpQuote {
  amountIn: string
  /** 平台费（WDOGE）：买入从输入扣，卖出从输出扣 */
  fee: string
  amountOut: string
  /** 成交后的曲线储备 */
  reserves: PumpReserves
  /** 价格影响（不含 1% 手续费），百分比；0 储备时为 null */
  priceImpact: number | null
}

const big = (v: string) => BigInt(v)

// indexer PumpTrade：amtout = amtin * R_out / (R_in + amtin)，整数向下取整，无 0.997
function curveOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  return (amountIn * reserveOut) / (reserveIn + amountIn)
}

// 成交均价相对现价的偏离：(in/out) / (reserveIn/reserveOut) - 1
function impactPercent(amountIn: bigint, amountOut: bigint, reserveIn: bigint, reserveOut: bigint): number | null {
  if (amountOut === ZERO || reserveIn === ZERO) return null
  const ratio = Number((amountIn * reserveOut * BigInt(1e8)) / (amountOut * reserveIn)) / 1e8
  return (ratio - 1) * 100
}

/** 买入：wdogeIn 为用户支付的 WDOGE（含 1% 手续费） */
export function quotePumpBuy(reserves: PumpReserves, wdogeIn: string): PumpQuote {
  const r0 = big(reserves.amt0)
  const r1 = big(reserves.amt1)
  const amountIn = big(wdogeIn)
  const fee = amountIn / FEE_DIVISOR
  const netIn = amountIn - fee
  const out = curveOut(netIn, r1, r0)
  return {
    amountIn: amountIn.toString(),
    fee: fee.toString(),
    amountOut: out.toString(),
    reserves: { amt0: (r0 - out).toString(), amt1: (r1 + netIn).toString() },
    priceImpact: impactPercent(netIn, out, r1, r0),
  }
}

/** 卖出：所得为扣除 1% 手续费后的 WDOGE */
export function quotePumpSell(reserves: PumpReserves, tokenIn: string): PumpQuote {
  const r0 = big(reserves.amt0)
  const r1 = big(reserves.amt1)
  const amountIn = big(tokenIn)
  const gross = curveOut(amountIn, r0, r1)
  const fee = gross / FEE_DIVISOR
  return {
    amountIn: amountIn.toString(),
    fee: fee.toString(),
    amountOut: (gross - fee).toString(),
    reserves: { amt0: (r0 + amountIn).toString(), amt1: (r1 - gross).toString() },
    priceImpact: impactPercent(amountIn, gross, r0, r1),
  }
}

/** 新币的初始曲线：保留比例 reserve% 归创建者，其余进曲线 */
export function initialPumpReserves(reservePercent = 0): PumpReserves {
  const curve = (big(PUMP_TOTAL_SUPPLY) / FEE_DIVISOR) * BigInt(100 - reservePercent)
  return { amt0: curve.toString(), amt1: PUMP_VIRTUAL_WDOGE }
}

/** 曲线里的真实 WDOGE（储备地址余额）= amt1 − 虚拟储备 */
export function pumpRealWdoge(amt1: string): string {
  const real = big(amt1) - big(PUMP_VIRTUAL_WDOGE)
  return (real > ZERO ? real : ZERO).toString()
}

/** 毕业进度百分比：一位小数、向下取整，封顶 100.0（没到毕业线不会显示 100.0） */
export function pumpProgressPercent(amt1: string): string {
  const permille = (big(pumpRealWdoge(amt1)) * BigInt(1000)) / big(PUMP_GRADUATION_WDOGE)
  const capped = permille > BigInt(1000) ? BigInt(1000) : permille
  const s = capped.toString()
  return `${s.slice(0, -1) || '0'}.${s.slice(-1)}`
}

/** indexer 在 amt1（含虚拟储备）≥ 100,000 DOGE 时拒绝 trade（explorer/verifys.go:1403） */
export function isPumpTradingOpen(amt1: string): boolean {
  return big(amt1) < big(PUMP_GRADUATION_WDOGE)
}

/** 现价：每枚代币多少 WDOGE（两侧同为 8 位精度，储备比即价格）；仅展示 */
export function pumpSpotPrice(reserves: PumpReserves): number | null {
  const r0 = big(reserves.amt0)
  if (r0 === ZERO) return null
  return Number((big(reserves.amt1) * BigInt(1e12)) / r0) / 1e12
}

/** 市值（WDOGE）= 现价 × 总量 1e9 枚；仅展示 */
export function pumpMarketCapDoge(reserves: PumpReserves): number | null {
  const price = pumpSpotPrice(reserves)
  return price === null ? null : price * 1e9
}

/**
 * 卖出的 WDOGE 毛额（手续费 + 实收）都从储备地址转出，储备地址只有真实 WDOGE（amt1 − 虚拟储备）。
 * 创建者保留的代币没经过曲线买入，卖回时毛额可能超过真实余额，indexer 会以 insufficient balance 拒绝
 */
export function isPumpSellCovered(amt1: string, quote: Pick<PumpQuote, 'fee' | 'amountOut'>): boolean {
  return big(quote.fee) + big(quote.amountOut) <= big(pumpRealWdoge(amt1))
}
