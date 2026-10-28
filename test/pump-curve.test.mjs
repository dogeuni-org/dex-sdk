import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  quotePumpBuy, quotePumpSell, initialPumpReserves, pumpRealWdoge, pumpProgressPercent,
  isPumpTradingOpen, pumpSpotPrice, pumpMarketCapDoge, isPumpSellCovered,
} from '../src/pump-curve.ts'

test('quotePumpBuy: 与线上 HYPE 的链上储备逐位一致（保留 20%，买入 20 DOGE）', () => {
  const q = quotePumpBuy(initialPumpReserves(20), '2000000000')
  assert.equal(q.fee, '20000000')
  assert.equal(q.amountOut, '524538048877409')
  // api.dogeuni.com/v4/pump/liquidity 2026-10-23 读到的 HYPE 储备
  assert.deepEqual(q.reserves, { amt0: '79475461951122591', amt1: '301980000000' })
})

test('quotePumpBuy: 手续费按 amt0/100 向下取整，只扣 WDOGE 侧', () => {
  const q = quotePumpBuy(initialPumpReserves(), '199')
  assert.equal(q.fee, '1')
  assert.equal(q.reserves.amt1, '300000000198')
})

test('quotePumpSell: 先按曲线算毛输出，再扣 1%；储备减去毛输出', () => {
  const r = { amt0: '79475461951122591', amt1: '301980000000' }
  const q = quotePumpSell(r, '524538048877409')
  const gross = (524538048877409n * 301980000000n) / (79475461951122591n + 524538048877409n)
  assert.equal(q.fee, (gross / 100n).toString())
  assert.equal(q.amountOut, (gross - gross / 100n).toString())
  assert.equal(q.reserves.amt1, (301980000000n - gross).toString())
  assert.equal(q.reserves.amt0, '80000000000000000')
})

test('买入再全卖：曲线不倒贴（取整与手续费都向协议倾斜）', () => {
  const start = initialPumpReserves()
  const buy = quotePumpBuy(start, '100000000000')
  const sell = quotePumpSell(buy.reserves, buy.amountOut)
  assert.ok(BigInt(sell.amountOut) < 100000000000n)
  assert.ok(BigInt(sell.reserves.amt1) >= BigInt(start.amt1))
})

test('initialPumpReserves: 保留比例按 MemeMax/100*(100-r)', () => {
  assert.deepEqual(initialPumpReserves(), { amt0: '100000000000000000', amt1: '300000000000' })
  assert.equal(initialPumpReserves(99).amt0, '1000000000000000')
})

test('进度：真实 WDOGE = amt1 − 3000 DOGE，向下取整、封顶 100', () => {
  assert.equal(pumpRealWdoge('300000000000'), '0')
  assert.equal(pumpRealWdoge('100'), '0')
  assert.equal(pumpProgressPercent('300000000000'), '0.0')
  assert.equal(pumpProgressPercent('1299990000000'), '9.9') // 9999.9 DOGE 真实
  assert.equal(pumpProgressPercent('10299999999999'), '99.9')
  assert.equal(pumpProgressPercent('10300000000000'), '100.0')
  assert.equal(pumpProgressPercent('99999999999999999'), '100.0')
})

test('isPumpTradingOpen: indexer 按 amt1（含虚拟储备）≥ 100,000 DOGE 停止交易', () => {
  assert.equal(isPumpTradingOpen('9999999999999'), true)
  assert.equal(isPumpTradingOpen('10000000000000'), false)
})

test('价格影响：小额接近 0，大额为正；现价与市值', () => {
  const r = initialPumpReserves()
  assert.ok(quotePumpBuy(r, '100000000').priceImpact < 0.05)
  assert.ok(quotePumpBuy(r, '100000000000').priceImpact > 30)
  assert.equal(pumpSpotPrice(r), 0.000003)
  assert.equal(pumpMarketCapDoge(r), 3000)
  assert.equal(pumpSpotPrice({ amt0: '0', amt1: '1' }), null)
})

test('isPumpSellCovered: 卖出毛额不能超过储备地址的真实 WDOGE（amt1 − 3000 DOGE）', () => {
  // 保留 50%、没人买过：真实 WDOGE = 0，卖创建者保留的代币必然 insufficient balance
  const fresh = initialPumpReserves(50)
  assert.equal(isPumpSellCovered(fresh.amt1, quotePumpSell(fresh, '1000000000000000')), false)
  // 买入后把买到的全卖回：毛额来自自己付进去的 WDOGE，够付
  const buy = quotePumpBuy(fresh, '10000000000')
  assert.equal(isPumpSellCovered(buy.reserves.amt1, quotePumpSell(buy.reserves, buy.amountOut)), true)
  // 再多卖一点创建者的币就超了
  const more = (BigInt(buy.amountOut) * 3n).toString()
  assert.equal(isPumpSellCovered(buy.reserves.amt1, quotePumpSell(buy.reserves, more)), false)
})
