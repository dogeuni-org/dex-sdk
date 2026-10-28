import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasReserves, proportionalBaseUnits } from '../src/liquidity.ts'

const POOL = { base: '388535076968420000000', quote: '2519580000' }

test('另一侧 = floor(本侧 × 对侧储备 ÷ 本侧储备)，按原始整数精确计算', () => {
  assert.equal(proportionalBaseUnits('100000000000000', 'base', POOL), '648')
  assert.equal(proportionalBaseUnits('100000000', 'quote', POOL), '15420628714643710459')
  assert.equal(proportionalBaseUnits('0', 'base', POOL), '0')
})

test('储备不全为正的池子返回 null', () => {
  assert.equal(hasReserves({ base: '0', quote: '1' }), false)
  assert.equal(hasReserves({ base: '', quote: '1' }), false)
  assert.equal(hasReserves(POOL), true)
  assert.equal(proportionalBaseUnits('1', 'base', { base: '1', quote: '0' }), null)
})
