// 钱包 createSwap / createPump 入参 → 交易意图（TradeIntent），供钱包审批弹窗与 agent 复核用。
// 原则：意图只由「上链字段 + 协议公式」得出——钱包 keyring 按 p/op 模板取字段写进铭文、模板外的丢弃（见 dex-payload.ts 各类型注释），
// 不上链的字段（pair-v2 的 tick1_id / amt1、remove 的 amt0 / amt1、wdoge 的 fee / holder_address）只能当 dApp 的说法，
// 字段名里带 quoted / expected 或另行注明；费用一律按 SDK 的公式重算，不读 payload 自带的 fee。
// 不认识的 p / op 抛 UnknownPayloadError，认识但字段不合法抛 InvalidPayloadError——钱包两种都应拒签。
// 金额全部是最小单位整数串（DOGE / WDOGE / DRC-20 为 8 位，MEME-20 为代币 dec，pump 为 8 位）。
import { WDOGE_TICK, type DogeFlag } from './dex-payload.ts'
import { swapFee } from './swap.ts'
import { wdogeDepositFeeSats, wdogeServiceFeeSats } from './wdoge-fees.ts'
import { PUMP_CREATE_FEE, PUMP_DEPLOY_MAX_BUY, PUMP_MAX_RESERVE, PUMP_TIP_FEE, PUMP_WDOGE_TICK_ID } from './pump-curve.ts'
import { toBigInt } from './int.ts'

export class UnknownPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownPayloadError'
  }
}

export class InvalidPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPayloadError'
  }
}

/** 单池 swap（pair-v1 / pair-v2）。钱包复核：按 tickIn / tickOut（v2 按 pairId）取池子，checkMinOut(pool, tickIn, amountIn, minOut) */
export interface SwapIntent {
  kind: 'swap'
  protocol: 'pair-v1' | 'pair-v2'
  /** pair-v2 的 pair_id（链上按它找池）；pair-v1 为 null（按 tick 对找池） */
  pairId: string | null
  /** 输入代币：pair-v1 为 tick，pair-v2 为 tick_id；WDOGE 两种都是 WDOGE_TICK */
  tickIn: string
  /** 输出代币。pair-v2 的 tick1_id 不上链（链上输出由 pair_id 决定），钱包应核对它是 pairId 池子的另一侧 */
  tickOut: string
  /** 显示名：pair-v2 为 payload 的 tick0 / tick1，pair-v1 同 tickIn / tickOut */
  nameIn: string
  nameOut: string
  amountIn: string
  /** 用原生 DOGE 支付（doge = 1 且输入为 WDOGE）：钱包包装 amountIn 并另收 serviceFee */
  nativeIn: boolean
  /** 收原生 DOGE（doge = 1 且输出为 WDOGE），不收费 */
  nativeOut: boolean
  /** 最少收到：链上 amtout < minOut 即订单失败 */
  minOut: string
  /** dApp 给的报价（payload amt1），链上不校验，只作显示 */
  quotedOut: string
  /** LP 手续费 swapFee(amountIn)，单位是输入代币，从 amountIn 里扣 */
  lpFee: string
  /** 包装服务费（原生 DOGE sat），nativeIn 时 = wdogeDepositFeeSats(amountIn)，否则 '0' */
  serviceFee: string
}

/** DOGE ⇄ WDOGE 包装 / 解包 */
export interface WdogeIntent {
  kind: 'wdoge'
  op: 'deposit' | 'withdraw'
  amount: string
  /** 服务费（原生 DOGE sat）= wdogeServiceFeeSats(op, amount)：deposit 千三最低 0.5 DOGE，withdraw 固定 0.5 DOGE */
  serviceFee: string
}

/** 加流动性（pair-v1）。实际存入按当时储备只存一侧满额、另一侧按比例，低于 min 即订单失败 */
export interface AddLiquidityIntent {
  kind: 'add'
  tick0: string
  tick1: string
  amount0: string
  amount1: string
  min0: string
  min1: string
  /** WDOGE 一侧用原生 DOGE 支付（doge = 1 且池子含 WDOGE） */
  nativeDoge: boolean
}

/** 移除流动性（pair-v1）。链上只读 liquidity，提取数量由 indexer 按份额算 */
export interface RemoveLiquidityIntent {
  kind: 'remove'
  tick0: string
  tick1: string
  liquidity: string
  /** dApp 的预计提取量（payload amt0 / amt1，不上链），钱包应按池子用 lpWithdrawAmounts 复核 */
  expected0: string
  expected1: string
  /** WDOGE 一侧提成原生 DOGE（doge = 1 且池子含 WDOGE） */
  nativeDoge: boolean
}

/** 建池（pair-v1），按 amount0 / amount1 原样存入 */
export interface CreatePoolIntent {
  kind: 'create'
  tick0: string
  tick1: string
  amount0: string
  amount1: string
  /** WDOGE 一侧用原生 DOGE 支付（doge = 1 且池子含 WDOGE） */
  nativeDoge: boolean
}

/** pump 曲线买卖 */
export interface PumpTradeIntent {
  kind: 'pump-trade'
  side: 'buy' | 'sell'
  /** pump 代币 tick_id（= pair_id） */
  tickId: string
  /** 买入 = 支付的 WDOGE（含 1% 平台费），卖出 = 卖出的代币数量 */
  amountIn: string
  /** 买入且 doge = 1：用原生 DOGE 支付，钱包先充值成 WDOGE 并另收 serviceFee */
  nativeIn: boolean
  /** payload 的 amt1_min。indexer 不校验 pump 的最少收到，任何值都没有滑点保护，别显示成「最少收到」 */
  minOut: string
  /** 平台费 1%（WDOGE）：买入 = floor(amountIn ÷ 100)；卖出从所得里扣，取决于成交时储备，这里为 null（用 quotePumpSell 算） */
  platformFee: string | null
  /** 小费（原生 DOGE sat），每笔 PUMP_TIP_FEE */
  tipFee: string
  /** 充值服务费（原生 DOGE sat），nativeIn 时 = wdogeDepositFeeSats(amountIn)，否则 '0' */
  serviceFee: string
}

/** pump 发币（可带首笔买入，与创建者保留比例二选一） */
export interface PumpDeployIntent {
  kind: 'pump-deploy'
  symbol: string
  name: string
  logo: string
  /** 创建者保留比例 0–99（%） */
  reservePercent: number
  /** 首笔买入支付的 DOGE（含 1% 平台费），'0' = 不买 */
  initialBuy: string
  /** 创建费 PUMP_CREATE_FEE（原生 DOGE sat） */
  createFee: string
  tipFee: string
  /** 首笔买入的平台费 floor(initialBuy ÷ 100)（WDOGE） */
  platformFee: string
  /** 首笔买入的充值服务费（原生 DOGE sat），不买时 '0' */
  serviceFee: string
}

export type TradeIntent =
  | SwapIntent
  | WdogeIntent
  | AddLiquidityIntent
  | RemoveLiquidityIntent
  | CreatePoolIntent
  | PumpTradeIntent
  | PumpDeployIntent

type Fields = Record<string, unknown>

function text(f: Fields, key: string): string {
  const v = f[key]
  if (typeof v !== 'string' || v === '') throw new InvalidPayloadError(`${key} must be a non-empty string: ${JSON.stringify(v)}`)
  return v
}

function int(f: Fields, key: string): string {
  const v = f[key]
  try {
    toBigInt(v as string, key)
  } catch (e) {
    throw new InvalidPayloadError((e as Error).message)
  }
  return v as string
}

function positive(f: Fields, key: string): string {
  const v = int(f, key)
  if (BigInt(v) === BigInt(0)) throw new InvalidPayloadError(`${key} must be positive: ${v}`)
  return v
}

function dogeFlag(f: Fields): DogeFlag {
  const v = f.doge
  if (v !== 0 && v !== 1) throw new InvalidPayloadError(`doge must be 0 or 1: ${JSON.stringify(v)}`)
  return v
}

function hasWdoge(tick0: string, tick1: string): boolean {
  return tick0 === WDOGE_TICK || tick1 === WDOGE_TICK
}

function parseSwap(f: Fields, protocol: 'pair-v1' | 'pair-v2'): SwapIntent {
  const v2 = protocol === 'pair-v2'
  const nameIn = text(f, 'tick0')
  const nameOut = text(f, 'tick1')
  const tickIn = v2 ? text(f, 'tick0_id') : nameIn
  const tickOut = v2 ? text(f, 'tick1_id') : nameOut
  if (tickIn === tickOut) throw new InvalidPayloadError(`swap input and output are the same token: ${tickIn}`)
  const amountIn = positive(f, 'amt0')
  const doge = dogeFlag(f)
  const nativeIn = doge === 1 && tickIn === WDOGE_TICK
  return {
    kind: 'swap',
    protocol,
    pairId: v2 ? text(f, 'pair_id') : null,
    tickIn,
    tickOut,
    nameIn,
    nameOut,
    amountIn,
    nativeIn,
    nativeOut: doge === 1 && tickOut === WDOGE_TICK,
    minOut: int(f, 'amt1_min'),
    quotedOut: int(f, 'amt1'),
    lpFee: swapFee(amountIn),
    serviceFee: nativeIn ? wdogeDepositFeeSats(amountIn) : '0',
  }
}

// 扩展钱包条目 { p, op, amt, fee, holder_address } 与 Telegram 条目 { p, op, tick, amt } 都认；tick 有则必须是 WDOGE
function parseWdoge(f: Fields, op: 'deposit' | 'withdraw'): WdogeIntent {
  if (f.tick !== undefined && f.tick !== WDOGE_TICK) throw new InvalidPayloadError(`wdoge tick must be ${WDOGE_TICK}: ${JSON.stringify(f.tick)}`)
  const amount = positive(f, 'amt')
  return { kind: 'wdoge', op, amount, serviceFee: wdogeServiceFeeSats(op, amount) }
}

function pairTicks(f: Fields): [string, string] {
  const tick0 = text(f, 'tick0')
  const tick1 = text(f, 'tick1')
  if (tick0 === tick1) throw new InvalidPayloadError(`pool ticks are the same: ${tick0}`)
  return [tick0, tick1]
}

function parseAdd(f: Fields): AddLiquidityIntent {
  const [tick0, tick1] = pairTicks(f)
  return {
    kind: 'add',
    tick0,
    tick1,
    amount0: positive(f, 'amt0'),
    amount1: positive(f, 'amt1'),
    min0: int(f, 'amt0_min'),
    min1: int(f, 'amt1_min'),
    nativeDoge: dogeFlag(f) === 1 && hasWdoge(tick0, tick1),
  }
}

function parseRemove(f: Fields): RemoveLiquidityIntent {
  const [tick0, tick1] = pairTicks(f)
  return {
    kind: 'remove',
    tick0,
    tick1,
    liquidity: positive(f, 'liquidity'),
    expected0: int(f, 'amt0'),
    expected1: int(f, 'amt1'),
    nativeDoge: dogeFlag(f) === 1 && hasWdoge(tick0, tick1),
  }
}

function parseCreate(f: Fields): CreatePoolIntent {
  const [tick0, tick1] = pairTicks(f)
  return {
    kind: 'create',
    tick0,
    tick1,
    amount0: positive(f, 'amt0'),
    amount1: positive(f, 'amt1'),
    nativeDoge: dogeFlag(f) === 1 && hasWdoge(tick0, tick1),
  }
}

// indexer verifyPumpTrade：按 pair_id 找曲线，tick0_id = WDOGE 为买入、= pair_id 为卖出，其它值订单失败
function parsePumpTrade(f: Fields): PumpTradeIntent {
  const tickId = text(f, 'pair_id')
  const tick0Id = text(f, 'tick0_id')
  if (tickId === PUMP_WDOGE_TICK_ID) throw new InvalidPayloadError('pump pair_id must be a token tick_id')
  if (tick0Id !== PUMP_WDOGE_TICK_ID && tick0Id !== tickId) {
    throw new InvalidPayloadError(`pump tick0_id must be ${PUMP_WDOGE_TICK_ID} (buy) or pair_id (sell): ${tick0Id}`)
  }
  const side = tick0Id === PUMP_WDOGE_TICK_ID ? 'buy' : 'sell'
  const amountIn = positive(f, 'amt0')
  const doge = dogeFlag(f)
  const nativeIn = side === 'buy' && doge === 1
  return {
    kind: 'pump-trade',
    side,
    tickId,
    amountIn,
    nativeIn,
    minOut: int(f, 'amt1_min'),
    platformFee: side === 'buy' ? (BigInt(amountIn) / BigInt(100)).toString() : null,
    tipFee: PUMP_TIP_FEE,
    serviceFee: nativeIn ? wdogeDepositFeeSats(amountIn) : '0',
  }
}

// indexer verifyPumpDeploy：tick 固定 WDOGE、保留比例 0–99、首笔买入 ≤ 5000 DOGE、两者二选一（不合法的上链即失败）。
// doge 只认 1：SDK builder 恒为 1，doge = 0 的发币在钱包 / indexer 里的花费语义没核实过，不解析成意图
function parsePumpDeploy(f: Fields): PumpDeployIntent {
  if (f.tick !== PUMP_WDOGE_TICK_ID) throw new InvalidPayloadError(`pump deploy tick must be ${PUMP_WDOGE_TICK_ID}: ${JSON.stringify(f.tick)}`)
  if (f.doge !== 1) throw new InvalidPayloadError(`pump deploy doge must be 1: ${JSON.stringify(f.doge)}`)
  const reserve = f.reserve
  if (typeof reserve !== 'number' || !Number.isInteger(reserve) || reserve < 0 || reserve > PUMP_MAX_RESERVE) {
    throw new InvalidPayloadError(`pump reserve must be an integer 0–${PUMP_MAX_RESERVE}: ${JSON.stringify(reserve)}`)
  }
  const initialBuy = int(f, 'amt')
  const buy = BigInt(initialBuy)
  if (buy > BigInt(PUMP_DEPLOY_MAX_BUY)) throw new InvalidPayloadError(`pump initial buy exceeds ${PUMP_DEPLOY_MAX_BUY}: ${initialBuy}`)
  if (buy > BigInt(0) && reserve > 0) throw new InvalidPayloadError('pump deploy cannot have both reserve and initial buy')
  const logo = f.logo
  if (typeof logo !== 'string') throw new InvalidPayloadError(`pump logo must be a string: ${JSON.stringify(logo)}`)
  return {
    kind: 'pump-deploy',
    symbol: text(f, 'symbol'),
    name: text(f, 'name'),
    logo,
    reservePercent: reserve,
    initialBuy,
    createFee: PUMP_CREATE_FEE,
    tipFee: PUMP_TIP_FEE,
    platformFee: (buy / BigInt(100)).toString(),
    serviceFee: buy > BigInt(0) ? wdogeDepositFeeSats(initialBuy) : '0',
  }
}

/** 解析一条 createSwap 入参或 createPump 条目。只认 SDK builder 产出的这几种 p / op */
export function parse(payload: unknown): TradeIntent {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new UnknownPayloadError(`payload must be an object: ${JSON.stringify(payload)}`)
  }
  const f = payload as Fields
  const { p, op } = f
  switch (`${String(p)}:${String(op)}`) {
    case 'pair-v1:swap': return parseSwap(f, 'pair-v1')
    case 'pair-v2:swap': return parseSwap(f, 'pair-v2')
    case 'pair-v1:add': return parseAdd(f)
    case 'pair-v1:remove': return parseRemove(f)
    case 'pair-v1:create': return parseCreate(f)
    case 'wdoge:deposit': return parseWdoge(f, 'deposit')
    case 'wdoge:withdraw': return parseWdoge(f, 'withdraw')
    case 'pump:trade': return parsePumpTrade(f)
    case 'pump:deploy': return parsePumpDeploy(f)
    default: throw new UnknownPayloadError(`unknown payload p=${JSON.stringify(p)} op=${JSON.stringify(op)}`)
  }
}
