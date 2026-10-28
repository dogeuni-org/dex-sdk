// DEX（pair-v1 / pair-v2 / wdoge）的钱包 createSwap 入参构造。金额一律最小单位整数串，非法即抛错。
// 钱包（@cardinals_org/keyring 1.0.9 的 processInscriptionParam）按 p/op 模板取字段写进铭文，键序以模板为准，
// 模板外的字段直接丢弃；下面每个类型注明哪些字段上链。不上链的字段沿用 Trade 一直传的写法（钱包审批界面 / 兼容），
// 去掉前要先核对钱包审批界面是否读它。
// 注意：keyring 对 amt / amt0 / amt1 走 parseFloat + Math.floor（> 2^53 丢精度，≥ 1e21 变成科学计数法），
// amt1_min / amt0_min / liquidity 原样透传——所以这里只产出纯十进制整数串。
import { wdogeServiceFeeSats } from './wdoge-fees.ts'
import { toBigInt } from './int.ts'

export const WDOGE_TICK = 'WDOGE(WRAPPED-DOGE)'

/** 1 = 涉及原生 DOGE（输入侧：钱包把 amt0 打进 WDOGE 冷钱包并另收服务费；输出 / 提取侧：收原生 DOGE），0 = 用 WDOGE（DRC-20）余额 */
export type DogeFlag = 0 | 1

function intString(value: string, name: string): string {
  toBigInt(value, name)
  return value
}

function positiveIntString(value: string, name: string): string {
  if (toBigInt(value, name) <= BigInt(0)) throw new Error(`${name} must be positive: ${value}`)
  return value
}

// ---------- swap ----------

/** pair-v1 swap。上链：p, op, tick0, tick1, amt0, amt1, amt1_min, doge */
export interface SwapV1Payload {
  tick0: string
  tick1: string
  amt0: string
  amt1: string
  p: 'pair-v1'
  op: 'swap'
  amt1_min: string
  doge: DogeFlag
}

/** tick0 = 输入代币，tick1 = 输出代币（原生 DOGE 一律写 WDOGE_TICK，用 doge 区分）；amt1 = 报价，amt1Min = 最少收到 */
export function buildSwapV1(input: {
  tick0: string; tick1: string; amt0: string; amt1: string; amt1Min: string; doge: DogeFlag
}): SwapV1Payload {
  return {
    tick0: input.tick0,
    tick1: input.tick1,
    amt0: positiveIntString(input.amt0, 'amt0'),
    amt1: intString(input.amt1, 'amt1'),
    p: 'pair-v1',
    op: 'swap',
    amt1_min: intString(input.amt1Min, 'amt1_min'),
    doge: input.doge,
  }
}

/** pair-v2（MEME-20）swap。上链：p, op, pair_id, tick0_id, amt0, amt1_min, doge, tick0, tick1（tick1_id / amt1 不上链） */
export interface SwapV2Payload {
  tick0: string
  tick1: string
  amt0: string
  amt1: string
  p: 'pair-v2'
  op: 'swap'
  amt1_min: string
  tick0_id: string
  tick1_id: string
  pair_id: string
  doge: DogeFlag
}

/** tick0Id / tick1Id = 输入 / 输出代币的 tick_id（WDOGE 为 WDOGE_TICK），tick0 / tick1 = 显示名；pairId = 池子 pair_id */
export function buildSwapV2(input: {
  tick0Id: string; tick1Id: string; tick0: string; tick1: string; pairId: string
  amt0: string; amt1: string; amt1Min: string; doge: DogeFlag
}): SwapV2Payload {
  if (!input.pairId) throw new Error('pair-v2 swap requires pair_id')
  return {
    tick0: input.tick0,
    tick1: input.tick1,
    amt0: positiveIntString(input.amt0, 'amt0'),
    amt1: intString(input.amt1, 'amt1'),
    p: 'pair-v2',
    op: 'swap',
    amt1_min: intString(input.amt1Min, 'amt1_min'),
    tick0_id: input.tick0Id,
    tick1_id: input.tick1Id,
    pair_id: input.pairId,
    doge: input.doge,
  }
}

// ---------- wdoge ----------

/** WDOGE 包装 / 解包。上链：p, op, tick（钱包强制写 WDOGE_TICK）, amt；holder_address / fee 不上链（fee 与明细展示同源，钱包按 amt 自己扣） */
export interface WdogePayload {
  p: 'wdoge'
  holder_address: string | null | undefined
  op: 'deposit' | 'withdraw'
  amt: string
  fee: string
}

export function buildWdoge(op: 'deposit' | 'withdraw', amt: string, holderAddress: string | null | undefined): WdogePayload {
  return {
    p: 'wdoge',
    holder_address: holderAddress,
    op,
    amt: positiveIntString(amt, 'amt'),
    fee: wdogeServiceFeeSats(op, amt),
  }
}

// ---------- 流动性（pair-v1） ----------

/** 加流动性。上链：p, op, tick0, tick1, amt0, amt1, amt0_min, amt1_min, doge（LP tick 不上链）。min 用 liquidityMin 算 */
export interface AddLiquidityPayload {
  op: 'add'
  p: 'pair-v1'
  tick: string
  tick0: string
  tick1: string
  amt0: string
  amt1: string
  amt0_min: string
  amt1_min: string
  doge: DogeFlag
}

export function buildAddLiquidity(input: {
  tick: string; tick0: string; tick1: string; amt0: string; amt1: string; amt0Min: string; amt1Min: string; doge: DogeFlag
}): AddLiquidityPayload {
  return {
    op: 'add',
    p: 'pair-v1',
    tick: input.tick,
    tick0: input.tick0,
    tick1: input.tick1,
    amt0: positiveIntString(input.amt0, 'amt0'),
    amt1: positiveIntString(input.amt1, 'amt1'),
    amt0_min: intString(input.amt0Min, 'amt0_min'),
    amt1_min: intString(input.amt1Min, 'amt1_min'),
    doge: input.doge,
  }
}

/**
 * 移除流动性。上链：p, op, tick0, tick1, liquidity, doge——提取数量由 indexer 按 liquidity 算，
 * amt0 / amt1（lpWithdrawAmounts 的预计值）与 holder_address 不上链。
 * doge = 1：WDOGE 那一侧提成原生 DOGE（indexer explorer/scanner.go 的 remove 分支）；池子两边都不是 WDOGE 时无效果。
 */
export interface RemoveLiquidityPayload {
  p: 'pair-v1'
  op: 'remove'
  holder_address: string | null | undefined
  tick0: string
  tick1: string
  amt0: string
  amt1: string
  liquidity: string
  doge: DogeFlag
}

export function buildRemoveLiquidity(input: {
  holderAddress: string | null | undefined; tick0: string; tick1: string; amt0: string; amt1: string; liquidity: string; doge: DogeFlag
}): RemoveLiquidityPayload {
  return {
    p: 'pair-v1',
    op: 'remove',
    holder_address: input.holderAddress,
    tick0: input.tick0,
    tick1: input.tick1,
    amt0: intString(input.amt0, 'amt0'),
    amt1: intString(input.amt1, 'amt1'),
    liquidity: positiveIntString(input.liquidity, 'liquidity'),
    doge: input.doge,
  }
}

/**
 * 建池。上链：p, op, tick0, tick1, amt0, amt1, doge。indexer 的 create（storage/swap.go SwapCreate）不读 min，
 * 新池按 amt0 / amt1 原样存入，所以 amt0_min / amt1_min 就是存入量本身（钱包模板也不带它们）。
 */
export interface CreatePoolPayload {
  op: 'create'
  p: 'pair-v1'
  tick0: string
  tick1: string
  amt0: string
  amt1: string
  amt0_min: string
  amt1_min: string
  doge: DogeFlag
}

export function buildCreatePool(input: { tick0: string; tick1: string; amt0: string; amt1: string; doge: DogeFlag }): CreatePoolPayload {
  const amt0 = positiveIntString(input.amt0, 'amt0')
  const amt1 = positiveIntString(input.amt1, 'amt1')
  return { op: 'create', p: 'pair-v1', tick0: input.tick0, tick1: input.tick1, amt0, amt1, amt0_min: amt0, amt1_min: amt1, doge: input.doge }
}
