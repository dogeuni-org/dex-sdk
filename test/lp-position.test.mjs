import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lpPooledAmounts, lpWithdrawAmounts } from '../src/lp-position.ts'

test('lpWithdrawAmounts：链上整数向下取整', () => {
  const share = { lp: '1000', poolAmt0: '999', poolAmt1: '7', total: '3000' }
  // liquidity = 1000 × 25 / 100 = 250；amt0 = 999 × 250 / 3000 = 83.25 → 83；amt1 = 7 × 250 / 3000 = 0.58 → 0
  assert.deepEqual(lpWithdrawAmounts(share, 25), { liquidity: '250', amt0: '83', amt1: '0' })
  assert.deepEqual(lpWithdrawAmounts(share, 100), { liquidity: '1000', amt0: '333', amt1: '2' })
  assert.deepEqual(lpPooledAmounts(share), { amt0: '333', amt1: '2' })
})

test('lpWithdrawAmounts：超过 2^53 的储备不失精', () => {
  const share = { lp: '31061292243897', poolAmt0: '388535076968420000000', poolAmt1: '2519580000', total: '31061292243897' }
  assert.deepEqual(lpWithdrawAmounts(share, 25), {
    liquidity: '7765323060974',
    amt0: '97133769242101872835',
    amt1: '629894999',
  })
})

test('lpWithdrawAmounts：percent 只收 0–100 的整数；总流动性为 0 时取 0', () => {
  const share = { lp: '10', poolAmt0: '10', poolAmt1: '10', total: '10' }
  for (const bad of [-1, 101, 12.5, NaN]) assert.throws(() => lpWithdrawAmounts(share, bad), undefined, String(bad))
  assert.deepEqual(lpPooledAmounts({ ...share, total: '0' }), { amt0: '0', amt1: '0' })
})
