// indexer golden 数据（test/vectors/indexer-golden.json）：由 dogeuni-indexer 的真实 handler（verify + storage，
// 在临时 sqlite 上执行）生成，记录链上对每笔输入的实际结果——成交 / 失败、输出、平台费、成交后储备。
// 这里只用 SDK 复算，与链上逐位对照。indexer 改了公式要重新生成：test/indexer-golden/gen.sh。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { quoteExactIn, checkMinOut } from '../src/swap.ts'
import { proportionalBaseUnits } from '../src/liquidity.ts'
import { liquidityMin } from '../src/slippage.ts'
import { lpPooledAmounts } from '../src/lp-position.ts'
import { quotePumpBuy, quotePumpSell, isPumpSellCovered, isPumpTradingOpen, isPumpFeePayable, pumpRealWdoge } from '../src/pump-curve.ts'

const data = JSON.parse(readFileSync(new URL('./vectors/indexer-golden.json', import.meta.url), 'utf8'))
const ZERO = BigInt(0)
const label = (c, keys) => keys.map(k => `${k}=${typeof c[k] === 'object' ? JSON.stringify(c[k]) : c[k]}`).join(' ')

test('golden 文件来源与结构', () => {
  assert.equal(data.version, 1)
  assert.match(data.source.commit, /^[0-9a-f]{40}$/)
  for (const k of ['swapV1', 'swapV2', 'add', 'remove', 'pump']) {
    assert.ok(data[k].some(c => c.ok), `${k} 有成交用例`)
  }
  for (const k of ['swapV1', 'swapV2', 'remove', 'pump']) {
    assert.ok(data[k].some(c => !c.ok), `${k} 有失败用例`)
  }
})

// pair-v1 按 tick、pair-v2 按 tick_id 找池子，报价是同一公式
for (const kind of ['swapV1', 'swapV2']) {
  test(`${kind}：quoteExactIn = 链上 amtout；输出为 0 链上失败；amt1_min 边界与 checkMinOut 一致`, () => {
    for (const c of data[kind]) {
      const name = label(c, ['pool', 'tickIn', 'amtIn'])
      const { amtOut } = quoteExactIn(c.pool, c.tickIn, c.amtIn)
      // 输出 0 时 indexer 的转账（amt < 1）报错，整笔失败
      assert.equal(c.ok, BigInt(amtOut) > ZERO, name)
      if (!c.ok) continue
      assert.equal(amtOut, c.amtOut, name)
      assert.equal(checkMinOut(c.pool, c.tickIn, c.amtIn, c.amtOut), c.minAtOut, name)
      assert.equal(checkMinOut(c.pool, c.tickIn, c.amtIn, (BigInt(c.amtOut) + BigInt(1)).toString()), c.minAtOutPlus1, name)
    }
  })
}

test('add：按比例算另一侧、0.5% 最少存入时，链上存入 = (amt0, floor(amt0 × r1 ÷ r0))', () => {
  const reserves = r => ({ base: r.amt0, quote: r.amt1 })
  for (const c of data.add) {
    const name = label(c, ['reserves', 'entered', 'amt0', 'amt1'])
    const entered = c.entered === 'base' ? c.amt0 : c.amt1
    const other = proportionalBaseUnits(entered, c.entered, reserves(c.reserves))
    assert.equal(c.entered === 'base' ? c.amt1 : c.amt0, other, name)
    assert.equal(c.amt0Min, liquidityMin(c.amt0, 50), name)
    assert.equal(c.amt1Min, liquidityMin(c.amt1, 50), name)
    assert.ok(c.ok, name)
    // indexer 先试 amountBOptimal：tick0 侧满额，tick1 侧按比例（≤ 提交量）
    assert.equal(c.amt0Out, c.amt0, name)
    assert.equal(c.amt1Out, proportionalBaseUnits(c.amt0, 'base', reserves(c.reserves)), name)
  }
})

test('remove：lpPooledAmounts = 链上提取量；任一侧为 0 链上失败', () => {
  for (const c of data.remove) {
    const name = label(c, ['reserves', 'liquidity'])
    const out = lpPooledAmounts({ lp: c.liquidity, poolAmt0: c.reserves.amt0, poolAmt1: c.reserves.amt1, total: c.reserves.total })
    assert.deepEqual({ amt0: c.amt0Out, amt1: c.amt1Out }, out, name)
    assert.equal(c.ok, BigInt(out.amt0) > ZERO && BigInt(out.amt1) > ZERO, name)
  }
})

test('pump：quotePumpBuy / quotePumpSell = 链上平台费 / 输出 / 成交后储备；失败条件（含停止交易线）与链上一致', () => {
  for (const c of data.pump) {
    const name = label(c, ['side', 'invited', 'reserves', 'amtIn'])
    const q = c.side === 'buy' ? quotePumpBuy(c.reserves, c.amtIn) : quotePumpSell(c.reserves, c.amtIn)
    assert.equal(pumpRealWdoge(c.reserves.amt1), c.realWdoge, name)
    // 平台费单独转账：为 0 即失败；绑定邀请人时再转 floor(fee ÷ 2) 给邀请人，也必须 ≥ 1
    const feeOk = BigInt(q.fee) >= BigInt(c.invited ? 2 : 1)
    // isPumpFeePayable 按 2 要求：不论有没有邀请人，它放行的都能成交
    if (isPumpFeePayable(q)) assert.ok(feeOk, name)
    const covered = c.side === 'buy' || isPumpSellCovered(c.reserves.amt1, q)
    assert.equal(c.ok, isPumpTradingOpen(c.reserves.amt1) && feeOk && BigInt(q.amountOut) > ZERO && covered, name)
    if (!c.ok) continue
    assert.equal(q.fee, c.fee, name)
    assert.equal(q.amountOut, c.amtOut, name)
    assert.deepEqual(q.reserves, c.reservesAfter, name)
  }
})
