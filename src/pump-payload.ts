// Pump 的钱包 createPump 条目构造。字段与取值以 DogeUni Node 为准（explorer/pump.go、explorer/verifys.go）。
import { PUMP_DECIMALS, PUMP_WDOGE_TICK_ID } from './pump-curve.ts'
import { toBigInt } from './int.ts'
import { toBaseUnits } from './units.ts'

// window.dogeuni.createPump([item]) 的条目；钱包按字段白名单过滤（dogeuni-wallet ui/utils handleParams）
export interface PumpTradeItem {
  p: 'pump'
  op: 'trade'
  pair_id: string
  tick0_id: string
  amt0: string
  amt1_min: string
  doge: 0 | 1
}

export interface PumpDeployItem {
  p: 'pump'
  op: 'deploy'
  tick: typeof PUMP_WDOGE_TICK_ID
  symbol: string
  name: string
  logo: string
  reserve: number
  amt: string
  doge: 1
}

export type PumpItem = PumpTradeItem | PumpDeployItem

/**
 * 曲线买卖。amount 为用户输入的十进制串：买入 = 支付的 DOGE（含 1% 手续费），卖出 = 卖出的代币数量。
 * 买入 doge: 1（钱包把 DOGE 充值成 WDOGE 再买）；卖出所得进 WDOGE 余额（indexer 只认买入方向的充值）。
 * minimumOut 为扣除平台费后的最低实收量（买入为代币，卖出为 WDOGE），使用链上最小单位。省略时为 '0'。
 */
export function buildPumpTrade(side: 'buy' | 'sell', tickId: string, amount: string, minimumOut = '0'): PumpTradeItem {
  const amt0 = toBaseUnits(amount, PUMP_DECIMALS)
  if (BigInt(amt0) <= BigInt(0)) throw new Error('pump trade amount must be positive')
  return {
    p: 'pump',
    op: 'trade',
    pair_id: tickId,
    tick0_id: side === 'buy' ? PUMP_WDOGE_TICK_ID : tickId,
    amt0,
    amt1_min: toBigInt(minimumOut, 'amt1_min').toString(),
    doge: side === 'buy' ? 1 : 0,
  }
}

/** 发币。initialBuy 为首笔买入的 DOGE（十进制串，'' / '0' = 不买），与 reserve 二选一（indexer 校验） */
export function buildPumpDeploy(input: { symbol: string; name: string; logo: string; reserve: number; initialBuy: string }): PumpDeployItem {
  return {
    p: 'pump',
    op: 'deploy',
    tick: PUMP_WDOGE_TICK_ID,
    symbol: input.symbol,
    name: input.name,
    logo: input.logo,
    reserve: input.reserve,
    amt: input.initialBuy ? toBaseUnits(input.initialBuy, PUMP_DECIMALS) : '0',
    doge: 1,
  }
}
