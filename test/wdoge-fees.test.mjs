// WDOGE deposit / withdraw 服务费与 Max deposit（与 keyring calculateFee / 钱包 calculateTotalSpend 逐位一致）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  wdogeDepositFeeSats, wdogeServiceFeeSats, depositTotalSpendSats, maxDepositAmountSats,
  WALLET_NETWORK_OVERHEAD_SATS, WDOGE_WITHDRAW_FEE_SATS,
} from '../src/wdoge-fees.ts'

const big = (s) => BigInt(s) // 测试里用 BigInt 做独立的精确校验

// keyring calculateFee 的独立实现：Math.max(Math.floor(amount*3/1e3), 5e7)（sat 级整数，BigInt 精确）
const keyringFee = (amt) => { const p = big(amt) * 3n / 1000n; return p > 50000000n ? p : 50000000n }

test('deposit 服务费：千三向下取整，最低 0.5 DOGE', () => {
  assert.equal(wdogeDepositFeeSats('100000000'), '50000000') // 1 DOGE → 最低 0.5
  assert.equal(wdogeDepositFeeSats('16666666666'), '50000000') // 千三 = 49999999.998 → floor 后仍低于最低
  assert.equal(wdogeDepositFeeSats('16666700000'), '50000100')
  assert.equal(wdogeDepositFeeSats('100000000000'), '300000000') // 1000 DOGE → 3 DOGE
  assert.equal(wdogeDepositFeeSats('123456789012345678901'), String(keyringFee('123456789012345678901')))
  assert.equal(wdogeServiceFeeSats('withdraw', '100000000000'), WDOGE_WITHDRAW_FEE_SATS)
})

test('Max deposit：总花费 ≤ 余额，且再多 1 sat 就超', () => {
  const balances = ['250100001', '300000000', '1000000000', '16916800000', '16916800001', '16917000000', '100000000000',
    '99999999999999', '123456789012345678', '250100000', '1', '0']
  for (const b of balances) {
    const max = maxDepositAmountSats(b)
    const spend = (a) => big(a) + keyringFee(a) + big(WALLET_NETWORK_OVERHEAD_SATS)
    assert.equal(depositTotalSpendSats(max), String(spend(max)), `total(${max})`)
    if (max === '0') {
      assert.ok(spend('1') > big(b), `balance ${b} 应连 1 sat 都存不了`)
      continue
    }
    assert.ok(spend(max) <= big(b), `balance ${b}: max ${max} 超出余额`)
    assert.ok(spend(big(max) + 1n) > big(b), `balance ${b}: max ${max} 不是最大`)
  }
})

test('Max deposit：在千三费档与最低费档交界附近逐 sat 校验', () => {
  // 两档交界 amt ≈ 16666666667 sat，对应余额 ≈ amt + 5e7 + overhead
  const base = 16666666667n + 50000000n + big(WALLET_NETWORK_OVERHEAD_SATS)
  for (let d = -2000n; d <= 2000n; d += 7n) {
    const b = String(base + d)
    const max = big(maxDepositAmountSats(b))
    const spend = (a) => a + keyringFee(a) + big(WALLET_NETWORK_OVERHEAD_SATS)
    assert.ok(spend(max) <= big(b) && spend(max + 1n) > big(b), `balance ${b}`)
  }
})
