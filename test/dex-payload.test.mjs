import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WDOGE_TICK, buildSwapV1, buildSwapV2, buildWdoge, buildAddLiquidity, buildRemoveLiquidity, buildCreatePool,
} from '../src/dex-payload.ts'

const ID = 'c730c453e2b0011d222744aa3c6bf648f233a5c0f6a6ed3da47726007ba985fa'

test('buildSwapV1：原样写入最小单位整数串，键与钱包 createSwap 入参一致', () => {
  assert.deepEqual(buildSwapV1({ tick0: WDOGE_TICK, tick1: 'CARDI', amt0: '1000000000', amt1: '12345678901', amt1Min: '12283950506', doge: 1 }), {
    tick0: WDOGE_TICK, tick1: 'CARDI', amt0: '1000000000', amt1: '12345678901', p: 'pair-v1', op: 'swap', amt1_min: '12283950506', doge: 1,
  })
  // > 2^53 的金额不经 number，原样保留
  const big = buildSwapV1({ tick0: 'A', tick1: 'B', amt0: '2100000000000012345678', amt1: '9007199254740993', amt1Min: '9007199254740993', doge: 0 })
  assert.equal(big.amt0, '2100000000000012345678')
  assert.equal(big.amt1_min, '9007199254740993')
})

test('buildSwapV2：tick_id + 显示名 + pair_id，缺 pair_id 抛错', () => {
  assert.deepEqual(buildSwapV2({ tick0Id: WDOGE_TICK, tick1Id: ID, tick0: 'DOGE', tick1: 'dpp', pairId: 'pair-dpp', amt0: '1000000000', amt1: '7', amt1Min: '6', doge: 1 }), {
    tick0: 'DOGE', tick1: 'dpp', amt0: '1000000000', amt1: '7', p: 'pair-v2', op: 'swap', amt1_min: '6',
    tick0_id: WDOGE_TICK, tick1_id: ID, pair_id: 'pair-dpp', doge: 1,
  })
  assert.throws(() => buildSwapV2({ tick0Id: WDOGE_TICK, tick1Id: ID, tick0: 'DOGE', tick1: 'dpp', pairId: '', amt0: '1', amt1: '1', amt1Min: '1', doge: 1 }), /pair_id/)
})

test('金额校验：只收非负整数串，输入量必须为正', () => {
  const base = { tick0: 'A', tick1: 'B', amt0: '1', amt1: '1', amt1Min: '0', doge: 0 }
  assert.equal(buildSwapV1(base).amt1_min, '0') // 最少收到可以是 0（报价 1 sat、滑点后向下取整）
  for (const bad of ['0', '-1', '1.5', '1e5', '', ' 1']) {
    assert.throws(() => buildSwapV1({ ...base, amt0: bad }), `amt0 ${JSON.stringify(bad)}`)
  }
  assert.throws(() => buildSwapV1({ ...base, amt1Min: '0.1' }))
  assert.throws(() => buildSwapV1({ ...base, amt1: 1 }))
})

test('buildWdoge：fee 与 wdogeServiceFeeSats 同源（deposit 千三最低 0.5 DOGE，withdraw 固定 0.5 DOGE）', () => {
  assert.deepEqual(buildWdoge('deposit', '100000000000', 'D_ADDR'), { p: 'wdoge', holder_address: 'D_ADDR', op: 'deposit', amt: '100000000000', fee: '300000000' })
  assert.equal(buildWdoge('deposit', '1000000000', 'D_ADDR').fee, '50000000')
  assert.equal(buildWdoge('withdraw', '100000000000', 'D_ADDR').fee, '50000000')
  assert.throws(() => buildWdoge('deposit', '0', 'D_ADDR'))
})

test('buildAddLiquidity / buildRemoveLiquidity / buildCreatePool', () => {
  assert.deepEqual(buildAddLiquidity({ tick: 'CARDI-SWAP-' + WDOGE_TICK, tick0: 'CARDI', tick1: WDOGE_TICK, amt0: '100000000000', amt1: '8610741135', amt0Min: '99500000000', amt1Min: '8567687429', doge: 1 }), {
    op: 'add', p: 'pair-v1', tick: 'CARDI-SWAP-' + WDOGE_TICK, tick0: 'CARDI', tick1: WDOGE_TICK,
    amt0: '100000000000', amt1: '8610741135', amt0_min: '99500000000', amt1_min: '8567687429', doge: 1,
  })
  assert.deepEqual(buildRemoveLiquidity({ holderAddress: 'D_ADDR', tick0: 'CARDI', tick1: WDOGE_TICK, amt0: '5', amt1: '0', liquidity: '12345', doge: 1 }), {
    p: 'pair-v1', op: 'remove', holder_address: 'D_ADDR', tick0: 'CARDI', tick1: WDOGE_TICK, amt0: '5', amt1: '0', liquidity: '12345', doge: 1,
  })
  assert.throws(() => buildRemoveLiquidity({ holderAddress: 'D_ADDR', tick0: 'A', tick1: 'B', amt0: '0', amt1: '0', liquidity: '0', doge: 0 }), /liquidity/)
  // create：min = 存入量本身
  assert.deepEqual(buildCreatePool({ tick0: 'A', tick1: WDOGE_TICK, amt0: '300', amt1: '400', doge: 0 }), {
    op: 'create', p: 'pair-v1', tick0: 'A', tick1: WDOGE_TICK, amt0: '300', amt1: '400', amt0_min: '300', amt1_min: '400', doge: 0,
  })
  assert.throws(() => buildAddLiquidity({ tick: 'T', tick0: 'A', tick1: 'B', amt0: '0', amt1: '1', amt0Min: '0', amt1Min: '0', doge: 0 }))
})
