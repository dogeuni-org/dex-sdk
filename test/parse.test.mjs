import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WDOGE_TICK, buildSwapV1, buildSwapV2, buildWdoge, buildAddLiquidity, buildRemoveLiquidity, buildCreatePool,
} from '../src/dex-payload.ts'
import { buildPumpTrade, buildPumpDeploy } from '../src/pump-payload.ts'
import { parse, UnknownPayloadError, InvalidPayloadError } from '../src/parse.ts'

const ID = 'c730c453e2b0011d222744aa3c6bf648f233a5c0f6a6ed3da47726007ba985fa'
const PUMP = 'baf62433d887caf952554020c27c5f73713cf60568438d369b8445e6ced56a46'

test('往返 swap v1：原生 DOGE 支付 → 收服务费；输出原生 DOGE 不收', () => {
  const input = { tick0: WDOGE_TICK, tick1: 'CARDI', amt0: '1000000000', amt1: '12345678901', amt1Min: '12283950506', doge: 1 }
  assert.deepEqual(parse(buildSwapV1(input)), {
    kind: 'swap', protocol: 'pair-v1', pairId: null,
    tickIn: WDOGE_TICK, tickOut: 'CARDI', nameIn: WDOGE_TICK, nameOut: 'CARDI',
    amountIn: '1000000000', nativeIn: true, nativeOut: false,
    minOut: '12283950506', quotedOut: '12345678901',
    lpFee: '3000000', serviceFee: '50000000',
  })
  const out = parse(buildSwapV1({ tick0: 'CARDI', tick1: WDOGE_TICK, amt0: '2100000000000012345678', amt1: '5', amt1Min: '4', doge: 1 }))
  assert.equal(out.nativeIn, false)
  assert.equal(out.nativeOut, true)
  assert.equal(out.serviceFee, '0')
  assert.equal(out.amountIn, '2100000000000012345678') // > 2^53 原样
  // doge = 0：花 / 收 WDOGE 余额，不是原生
  const w = parse(buildSwapV1({ ...input, doge: 0 }))
  assert.equal(w.nativeIn, false)
  assert.equal(w.serviceFee, '0')
})

test('往返 swap v2：tick_id 为身份、显示名单列、pairId 保留', () => {
  const intent = parse(buildSwapV2({ tick0Id: ID, tick1Id: WDOGE_TICK, tick0: 'dpp', tick1: 'DOGE', pairId: 'pair-dpp', amt0: '7000', amt1: '9', amt1Min: '8', doge: 0 }))
  assert.equal(intent.protocol, 'pair-v2')
  assert.equal(intent.pairId, 'pair-dpp')
  assert.equal(intent.tickIn, ID)
  assert.equal(intent.tickOut, WDOGE_TICK)
  assert.equal(intent.nameIn, 'dpp')
  assert.equal(intent.nameOut, 'DOGE')
  assert.equal(intent.minOut, '8')
  assert.equal(intent.lpFee, '21')
  assert.equal(intent.nativeOut, false)
})

test('往返 wdoge：扩展钱包条目与 Telegram 条目都认，费用按公式重算、不读 payload 的 fee', () => {
  assert.deepEqual(parse(buildWdoge('deposit', '100000000000', 'D_ADDR')), { kind: 'wdoge', op: 'deposit', amount: '100000000000', serviceFee: '300000000' })
  assert.deepEqual(parse(buildWdoge('withdraw', '100000000000', null)), { kind: 'wdoge', op: 'withdraw', amount: '100000000000', serviceFee: '50000000' })
  assert.deepEqual(parse({ p: 'wdoge', op: 'deposit', tick: WDOGE_TICK, amt: '1000000000' }), { kind: 'wdoge', op: 'deposit', amount: '1000000000', serviceFee: '50000000' })
  assert.equal(parse({ ...buildWdoge('deposit', '100000000000', 'D'), fee: '1' }).serviceFee, '300000000')
  assert.throws(() => parse({ p: 'wdoge', op: 'deposit', tick: 'CARDI', amt: '1' }), InvalidPayloadError)
})

test('往返 add / remove / create：nativeDoge 只在池子含 WDOGE 时成立', () => {
  assert.deepEqual(parse(buildAddLiquidity({ tick: 'CARDI-SWAP-' + WDOGE_TICK, tick0: 'CARDI', tick1: WDOGE_TICK, amt0: '100000000000', amt1: '8610741135', amt0Min: '99500000000', amt1Min: '8567687429', doge: 1 })), {
    kind: 'add', tick0: 'CARDI', tick1: WDOGE_TICK, amount0: '100000000000', amount1: '8610741135', min0: '99500000000', min1: '8567687429', nativeDoge: true,
  })
  assert.deepEqual(parse(buildRemoveLiquidity({ holderAddress: 'D', tick0: 'CARDI', tick1: WDOGE_TICK, amt0: '5', amt1: '0', liquidity: '12345', doge: 1 })), {
    kind: 'remove', tick0: 'CARDI', tick1: WDOGE_TICK, liquidity: '12345', expected0: '5', expected1: '0', nativeDoge: true,
  })
  assert.equal(parse(buildRemoveLiquidity({ holderAddress: 'D', tick0: 'A', tick1: 'B', amt0: '1', amt1: '1', liquidity: '1', doge: 1 })).nativeDoge, false)
  assert.deepEqual(parse(buildCreatePool({ tick0: 'A', tick1: WDOGE_TICK, amt0: '300', amt1: '400', doge: 0 })), {
    kind: 'create', tick0: 'A', tick1: WDOGE_TICK, amount0: '300', amount1: '400', nativeDoge: false,
  })
})

test('往返 pump trade：买入原生 DOGE 支付带平台费 / 充值费，卖出平台费取决于储备', () => {
  assert.deepEqual(parse(buildPumpTrade('buy', PUMP, '20')), {
    kind: 'pump-trade', side: 'buy', tickId: PUMP, amountIn: '2000000000', nativeIn: true,
    minOut: '0', platformFee: '20000000', tipFee: '10000000', serviceFee: '50000000',
  })
  assert.deepEqual(parse(buildPumpTrade('sell', PUMP, '5245380.48877409')), {
    kind: 'pump-trade', side: 'sell', tickId: PUMP, amountIn: '524538048877409', nativeIn: false,
    minOut: '0', platformFee: null, tipFee: '10000000', serviceFee: '0',
  })
  const bad = { ...buildPumpTrade('sell', PUMP, '1'), tick0_id: ID }
  assert.throws(() => parse(bad), /tick0_id/)
})

test('往返 pump deploy：费用与发币页同口径；indexer 会拒的组合直接拒', () => {
  assert.deepEqual(parse(buildPumpDeploy({ symbol: 'HYPE', name: 'Hype', logo: '', reserve: 20, initialBuy: '' })), {
    kind: 'pump-deploy', symbol: 'HYPE', name: 'Hype', logo: '', reservePercent: 20, initialBuy: '0',
    createFee: '500000000', tipFee: '10000000', platformFee: '0', serviceFee: '0',
  })
  const buy = parse(buildPumpDeploy({ symbol: 'A', name: 'A', logo: 'https://ipfs.dogeuni.com/ipfs/x', reserve: 0, initialBuy: '5000' }))
  assert.equal(buy.initialBuy, '500000000000')
  assert.equal(buy.platformFee, '5000000000')
  assert.equal(buy.serviceFee, '1500000000')
  const base = buildPumpDeploy({ symbol: 'A', name: 'A', logo: '', reserve: 0, initialBuy: '1' })
  assert.throws(() => parse({ ...base, reserve: 5 }), /reserve and initial buy/)
  assert.throws(() => parse({ ...base, amt: '500000000001' }), /exceeds/)
  assert.throws(() => parse({ ...base, reserve: 100, amt: '0' }), /reserve/)
  assert.throws(() => parse({ ...base, tick: 'CARDI' }), /tick/)
  assert.throws(() => parse({ ...base, doge: 0 }), /doge/)
})

test('未知 p / op 抛 UnknownPayloadError', () => {
  for (const bad of [null, [], 'swap', { p: 'pair-v1', op: 'swapx' }, { p: 'pair-v2', op: 'add' }, { p: 'drc-20', op: 'transfer' }, { p: 'invite', op: 'deploy' }, {}]) {
    assert.throws(() => parse(bad), UnknownPayloadError, JSON.stringify(bad))
  }
})

test('认识的 p / op 字段不合法抛 InvalidPayloadError', () => {
  const swap = buildSwapV1({ tick0: WDOGE_TICK, tick1: 'CARDI', amt0: '1', amt1: '1', amt1Min: '1', doge: 1 })
  const cases = [
    { ...swap, amt0: '0' },
    { ...swap, amt0: 1 },
    { ...swap, amt1_min: '1.5' },
    { ...swap, amt1_min: '1e5' },
    { ...swap, amt1_min: undefined },
    { ...swap, doge: '1' },
    { ...swap, doge: 2 },
    { ...swap, tick1: '' },
    { ...swap, tick1: WDOGE_TICK },
    { ...buildSwapV2({ tick0Id: ID, tick1Id: WDOGE_TICK, tick0: 'a', tick1: 'b', pairId: 'x', amt0: '1', amt1: '1', amt1Min: '1', doge: 0 }), pair_id: '' },
    { ...buildRemoveLiquidity({ holderAddress: 'D', tick0: 'A', tick1: 'B', amt0: '1', amt1: '1', liquidity: '1', doge: 0 }), liquidity: '0' },
  ]
  for (const bad of cases) assert.throws(() => parse(bad), InvalidPayloadError, JSON.stringify(bad))
})
