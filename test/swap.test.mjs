import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkMinOut, quoteExactIn, swapFee } from '../src/swap.ts'

// 期望值按 indexer storage/swap.go swapExec 的 big.Int 公式独立算出
const POOL = { tick0: 'A', tick1: 'B', amt0: '100000000000', amt1: '50000000000' }
const DEEP = { tick0: 'CARDI', tick1: 'WDOGE(WRAPPED-DOGE)', amt0: '388535076968420000000', amt1: '2519580000' }

test('手续费 = floor(amtIn ÷ 1000) × 3，不足 1000 不收', () => {
  assert.equal(swapFee('1999'), '3')
  assert.equal(swapFee('999'), '0')
  assert.equal(swapFee('10000000000'), '30000000')
})

test('quoteExactIn：amtout = floor(amtin × r_out ÷ (r_in + amtin))，两个方向', () => {
  assert.deepEqual(quoteExactIn(POOL, 'A', '1999'), { amtOut: '997', fee: '3', priceImpactBps: 0 })
  assert.deepEqual(quoteExactIn(POOL, 'A', '999'), { amtOut: '499', fee: '0', priceImpactBps: 0 })
  assert.deepEqual(quoteExactIn(POOL, 'B', '10000000000'), { amtOut: '16624979156', fee: '30000000', priceImpactBps: 1667 })
})

test('quoteExactIn：超过 2^53 的储备不失精', () => {
  assert.deepEqual(quoteExactIn(DEEP, 'CARDI', '100000000000000000000'), {
    amtOut: '514510607', fee: '300000000000000000', priceImpactBps: 2047,
  })
  assert.deepEqual(quoteExactIn(DEEP, 'WDOGE(WRAPPED-DOGE)', '100000000'), {
    amtOut: '14789158537365792889', fee: '300000', priceImpactBps: 382,
  })
})

test('quoteExactIn：代币不在池子里 / amtIn 为 0 / 储备非整数串时抛错', () => {
  assert.throws(() => quoteExactIn(POOL, 'C', '1'), /not in pool/)
  assert.throws(() => quoteExactIn(POOL, 'A', '0'), /positive/)
  assert.throws(() => quoteExactIn(POOL, 'A', '1.5'), /amtIn/)
  assert.throws(() => quoteExactIn({ ...POOL, amt1: '' }, 'A', '1'), /reserveOut/)
})

test('checkMinOut：amtout ≥ amt1_min 才通过（链上同一判断）', () => {
  assert.equal(checkMinOut(POOL, 'A', '1999', '997'), true)
  assert.equal(checkMinOut(POOL, 'A', '1999', '998'), false)
})
