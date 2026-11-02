// 钱包审批对照向量（test/vectors/approval.json）：payload 由 DogeUni Trade 的提交路径按线上池子快照生成，
// 这里只用 SDK 复算——parse 得到 intent、按 walletPool 复核 amt1_min，并核对 dApp 显示值与意图一致。
// 钱包接入 parse / checkMinOut 时可直接拿这份 JSON 当对照（字段说明见 JSON 的 about）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '../src/parse.ts'
import { quoteExactIn, checkMinOut } from '../src/swap.ts'
import { toBaseUnits } from '../src/units.ts'

const data = JSON.parse(readFileSync(new URL('./vectors/approval.json', import.meta.url), 'utf8'))
const units = (decimal, dec = 8) => toBaseUnits(decimal, dec)

test('向量文件版本与基本结构', () => {
  assert.equal(data.version, 1)
  assert.ok(data.vectors.length > 0 && data.invalid.length > 0)
  const ids = [...data.vectors, ...data.invalid].map(v => v.id)
  assert.equal(new Set(ids).size, ids.length, 'id 不重复')
})

for (const v of data.vectors) {
  test(`${v.id}：parse 得到 intent`, () => {
    assert.deepEqual(parse(v.payload), v.intent)
  })
}

for (const v of data.vectors.filter(x => x.intent.kind === 'swap')) {
  test(`${v.id}：按 walletPool 复核 amt1_min，dApp 显示值与意图一致`, () => {
    const { intent, walletPool, quotedPool, review, dapp } = v
    // 意图里的两个代币就是池子两侧
    assert.deepEqual([intent.tickIn, intent.tickOut].sort(), [walletPool.tick0, walletPool.tick1].sort())
    assert.deepEqual(quoteExactIn(walletPool, intent.tickIn, intent.amountIn), review.quote)
    assert.equal(checkMinOut(walletPool, intent.tickIn, intent.amountIn, intent.minOut), review.minOutOk)
    // 报价池上 dApp 报的数量就是 payload amt1，且一定满足它自己算的最少收到
    assert.equal(quoteExactIn(quotedPool, intent.tickIn, intent.amountIn).amtOut, intent.quotedOut)
    assert.equal(checkMinOut(quotedPool, intent.tickIn, intent.amountIn, intent.minOut), true)
    // MEME-20 快照里两侧精度都是 8（indexer 写死），换算统一按 8 位
    assert.equal(units(dapp.fromAmount), intent.amountIn)
    assert.equal(units(dapp.toAmount), intent.quotedOut)
    assert.equal(units(dapp.minimumReceived), intent.minOut)
    assert.equal(units(dapp.lpFee), intent.lpFee)
    assert.equal(dapp.serviceFeeDoge === null ? '0' : units(dapp.serviceFeeDoge), intent.serviceFee)
    assert.equal(dapp.serviceFeeDoge !== null, intent.nativeIn)
  })
}

test('复核向量：储备在滑点内变动通过，超出滑点不通过', () => {
  const byId = Object.fromEntries(data.vectors.map(v => [v.id, v]))
  assert.equal(byId['review-pool-moved-within-slippage'].review.minOutOk, true)
  assert.equal(byId['review-pool-moved-beyond-slippage'].review.minOutOk, false)
  for (const id of ['review-pool-moved-within-slippage', 'review-pool-moved-beyond-slippage']) {
    assert.notDeepEqual(byId[id].walletPool, byId[id].quotedPool)
  }
})

for (const v of data.vectors.filter(x => x.intent.kind === 'wdoge')) {
  test(`${v.id}：dApp 显示的服务费 / 到账与意图一致`, () => {
    assert.equal(units(v.dapp.amount), v.intent.amount)
    assert.equal(units(v.dapp.receive), v.intent.amount)
    assert.equal(units(v.dapp.serviceFeeDoge), v.intent.serviceFee)
  })
}

for (const v of data.vectors.filter(x => x.intent.kind === 'add')) {
  test(`${v.id}：dApp 显示的数量 / 最少存入与意图一致`, () => {
    const { intent, dapp } = v
    assert.equal(units(dapp.amount0), intent.amount0)
    assert.equal(units(dapp.amount1), intent.amount1)
    assert.equal(units(dapp.min0), intent.min0)
    assert.equal(units(dapp.min1), intent.min1)
  })
}

for (const v of data.vectors.filter(x => x.intent.kind === 'remove')) {
  test(`${v.id}：dApp 显示的可提取数量与意图一致`, () => {
    assert.equal(units(v.dapp.withdraw0), v.intent.expected0)
    assert.equal(units(v.dapp.withdraw1), v.intent.expected1)
    assert.equal(units(v.dapp.liquidity), v.intent.liquidity)
  })
}

for (const v of data.vectors.filter(x => x.intent.kind === 'pump-trade' || x.intent.kind === 'pump-deploy')) {
  test(`${v.id}：dApp 显示的费用与意图一致`, () => {
    const { intent, dapp } = v
    const opt = x => (x === null ? null : units(x))
    assert.equal(units(dapp.tipFeeDoge), intent.tipFee)
    assert.equal(opt(dapp.platformFee), intent.platformFee)
    assert.equal(dapp.serviceFeeDoge === null ? '0' : units(dapp.serviceFeeDoge), intent.serviceFee)
    if (intent.kind === 'pump-trade') assert.equal(units(dapp.amount), intent.amountIn)
    else {
      assert.equal(units(dapp.initialBuy), intent.initialBuy)
      assert.equal(units(dapp.createFeeDoge), intent.createFee)
      assert.equal(dapp.reservePercent, intent.reservePercent)
    }
  })
}

for (const v of data.invalid) {
  test(`${v.id}：parse 抛 ${v.error}`, () => {
    assert.throws(() => parse(v.payload), err => err.name === v.error)
  })
}
