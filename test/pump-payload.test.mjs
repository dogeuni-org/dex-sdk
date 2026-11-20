import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPumpTrade, buildPumpDeploy } from '../src/pump-payload.ts'

const TICK = 'baf62433d887caf952554020c27c5f73713cf60568438d369b8445e6ced56a46'

test('buildPumpTrade: 买卖均写入指定的最低实收量，旧调用可省略', () => {
  assert.deepEqual(buildPumpTrade('buy', TICK, '20', '523000000000000'), {
    p: 'pump', op: 'trade', pair_id: TICK, tick0_id: 'WDOGE(WRAPPED-DOGE)', amt0: '2000000000', amt1_min: '523000000000000', doge: 1,
  })
  const sell = buildPumpTrade('sell', TICK, '5245380.48877409', '1930000000')
  assert.equal(sell.tick0_id, TICK)
  assert.equal(sell.amt0, '524538048877409')
  assert.equal(sell.amt1_min, '1930000000')
  assert.equal(sell.doge, 0)
  assert.equal(buildPumpTrade('buy', TICK, '123456789012.123456789').amt0, '12345678901212345678')
  assert.equal(buildPumpTrade('buy', TICK, '20').amt1_min, '0')
})

test('buildPumpTrade: 最低实收量只接受非负整数串', () => {
  for (const minimum of ['', '-1', '0.1', '1e8', 1]) {
    assert.throws(() => buildPumpTrade('buy', TICK, '20', minimum), /amt1_min/)
  }
})

test('buildPumpTrade: 换算后为 0 的金额拒绝', () => {
  assert.throws(() => buildPumpTrade('buy', TICK, '0.000000001'))
  assert.throws(() => buildPumpTrade('sell', TICK, '0'))
})

test('buildPumpDeploy: tick 固定 WDOGE，首笔买入换算为最小单位，空 = 0', () => {
  assert.deepEqual(buildPumpDeploy({ symbol: 'HYPE', name: 'Hype', logo: '', reserve: 20, initialBuy: '' }), {
    p: 'pump', op: 'deploy', tick: 'WDOGE(WRAPPED-DOGE)', symbol: 'HYPE', name: 'Hype', logo: '', reserve: 20, amt: '0', doge: 1,
  })
  assert.equal(buildPumpDeploy({ symbol: 'A', name: 'A', logo: '', reserve: 0, initialBuy: '5000' }).amt, '500000000000')
})
