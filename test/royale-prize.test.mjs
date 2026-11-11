// 狗狗大逃杀 · prize-v1 赛季（src/royale/prize.ts + config.ts 的 ROYALE_PRIZE_SEASON）与 series 的起始赛季号。
import test from 'node:test'
import assert from 'node:assert/strict'
import { series, toUnits, rulesAt } from '../src/royale/engine.ts'
import { ROYALE_PRIZE_SEASON, ROYALE_PRIZE_POOL_ID, ROYALE_RULES, ROYALE_RULES_V3 } from '../src/royale/config.ts'
import { checkPrizeSeason, royalePrizeFirst, royalePrizeInbound, royalePrizeMemo } from '../src/royale/prize.ts'

test('ROYALE_PRIZE_SEASON：合法、第 3 季、v3（门票 10、其余同 v2）、确认 6 块', () => {
  checkPrizeSeason(ROYALE_PRIZE_SEASON)
  assert.equal(ROYALE_PRIZE_SEASON.season, 3)
  assert.equal(ROYALE_PRIZE_SEASON.poolId, ROYALE_PRIZE_POOL_ID)
  assert.equal(ROYALE_PRIZE_SEASON.versions.length, 1)
  assert.deepEqual(ROYALE_PRIZE_SEASON.versions[0].rules, ROYALE_RULES_V3)
  assert.equal(ROYALE_PRIZE_SEASON.versions[0].rules.version, 3)
  assert.equal(ROYALE_PRIZE_SEASON.versions[0].rules.ticket, 10)
  assert.deepEqual({ ...ROYALE_RULES_V3, version: 2, ticket: 1 }, ROYALE_RULES[1].rules)
  assert.equal(ROYALE_PRIZE_SEASON.versions[0].rules.floor, 0)
  assert.equal(ROYALE_PRIZE_SEASON.confirmations, 6)
})

test('checkPrizeSeason：拒绝有动作 / 保底 / 截止不晚于起点 / 确认深度小于 conf / 坏 pool_id', () => {
  const ok = ROYALE_PRIZE_SEASON
  assert.throws(() => checkPrizeSeason({ ...ok, versions: [{ fromSession: 1, rules: ROYALE_RULES[0].rules }] }), /动作/)
  assert.throws(() => checkPrizeSeason({ ...ok, versions: [{ fromSession: 1, rules: { ...ROYALE_RULES[1].rules, floor: 5 } }] }), /保底/)
  assert.throws(() => checkPrizeSeason({ ...ok, ticketFrom: ok.cutoff }))
  assert.throws(() => checkPrizeSeason({ ...ok, actFrom: ok.cutoff + 1 }))
  assert.throws(() => checkPrizeSeason({ ...ok, confirmations: 1 }), /conf/)
  assert.throws(() => checkPrizeSeason({ ...ok, poolId: 'DS91v11ASuZmQL3Yu6NqDeDXp9rQuc19T3' }))
  assert.throws(() => checkPrizeSeason({ ...ok, versions: [{ fromSession: 2, rules: ROYALE_RULES[1].rules }] }))
})

test('royalePrizeFirst：与结算方同一构造（pool = 池 id、不限地址、不接顺延）', () => {
  const s = ROYALE_PRIZE_SEASON
  assert.deepEqual(royalePrizeFirst(s), {
    ...rulesAt(s.versions, 1).rules, pool: s.poolId, players: null, session: 1,
    cutoff: s.cutoff, ticketFrom: s.ticketFrom, actFrom: s.actFrom, rollover: '0',
  })
})

test('royalePrizeInbound：跳过已退回、重复 tx 与坏金额抛错', () => {
  const P = 'cd'.repeat(32)
  const d = (tx, amt, h, state = 'processed') => ({ tx_hash: tx, block_number: h, address: 'DA', amt, state })
  assert.deepEqual(royalePrizeInbound(P, [d('t1', '100000000', 10), d('t2', '5', 11, 'refunded'), d('t3', '200000000', 12, 'pending')]), [
    { tx: 't1', from: 'DA', to: P, amt: BigInt(100000000), h: 10, ok: true },
    { tx: 't3', from: 'DA', to: P, amt: BigInt(200000000), h: 12, ok: true },
  ])
  assert.throws(() => royalePrizeInbound(P, [d('t1', '1', 10), d('t1', '1', 10)]), /重复/)
  assert.throws(() => royalePrizeInbound(P, [d('t1', '1.5', 10)]))
})

test('royalePrizeMemo', () => {
  assert.equal(royalePrizeMemo(3, 12), 'royale:3:12')
})

test('series 的 firstSeason：只改赛季标注，推演结果与默认相同', () => {
  const s = { ...ROYALE_PRIZE_SEASON, cutoff: 1030, ticketFrom: 1000, actFrom: 1000 }
  const first = royalePrizeFirst(s)
  const hashes = {}
  for (let h = 1000; h < 1200; h++) hashes[h] = ((h * 2654435761) >>> 0).toString(16).padStart(8, '0') + 'ef'.repeat(28)
  const ticket = String(s.versions[0].rules.ticket)
  const deposits = [
    { tx_hash: 'a1', block_number: 1010, address: 'DA', amt: String(toUnits(ticket)), state: 'processed' },
    { tx_hash: 'b1', block_number: 1020, address: 'DB', amt: String(toUnits(ticket)), state: 'processed' },
    { tx_hash: 'c1', block_number: 1025, address: 'DC', amt: String(toUnits(`${ticket}.5`)), state: 'processed' },
  ]
  const data = { tip: 1150, inbound: royalePrizeInbound(s.poolId, deposits), outbound: [], hashes }
  const a = series(first, data, { versions: s.versions })
  const b = series(first, data, { versions: s.versions, firstSeason: 3 })
  assert.equal(a.season, 1)
  assert.equal(b.season, 3)
  assert.ok(b.sessions.every((x) => x.season === 3))
  assert.ok(b.ledger.every((r) => r.items.every((it) => it.season === 3)))
  const strip = (r) => JSON.stringify({ ...r, season: 0, sessions: r.sessions.map((x) => ({ ...x, season: 0 })), ledger: r.ledger.map((l) => ({ ...l, items: l.items.map((it) => ({ ...it, season: 0 })) })) }, (_, v) => (typeof v === 'bigint' ? String(v) : v))
  assert.equal(strip(a), strip(b))
  assert.equal(a.sessions[0].out.phase, 'over')
  assert.throws(() => series(first, data, { versions: s.versions, firstSeason: 0 }))
})
