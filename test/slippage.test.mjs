import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_SLIPPAGE_BPS, isValidSlippageBps, liquidityMin, minReceived } from '../src/slippage.ts'

test('minReceived / liquidityMin = floor(amt × (10000 − bps) ÷ 10000)', () => {
  assert.equal(minReceived('1000', 50), '995')
  assert.equal(minReceived('99999999', 1), '99989999')
  assert.equal(minReceived('1', 50), '0')
  assert.equal(minReceived('388535076968420000000', 5000), '194267538484210000000')
  assert.equal(liquidityMin('1000', 50), '995')
})

test('合法范围 0 < bps ≤ 5000 且为整数，越界抛错', () => {
  assert.equal(MAX_SLIPPAGE_BPS, 5000)
  assert.equal(isValidSlippageBps(1), true)
  assert.equal(isValidSlippageBps(5000), true)
  for (const bad of [0, -1, 5001, 0.5, NaN]) {
    assert.equal(isValidSlippageBps(bad), false, String(bad))
    assert.throws(() => minReceived('1000', bad), /Invalid slippage/)
  }
  assert.throws(() => liquidityMin('1e5', 50), /amt/)
})
