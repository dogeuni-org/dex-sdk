// 狗狗大逃杀判定引擎（src/royale/engine.ts）：移植参考实现的全部用例 + 金额尾数 / 自动接续下一场。
// 期望值来自参考实现在同样输入下的输出（逐场、逐轮、逐笔），引擎是规则唯一来源，数字变了说明规则变了。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  derive, series, decode, walletAmount, ticketAmount, toUnits, fromUnits, nextCutoff, royaleMoves, checkRuleVersions, rulesAt,
  planRound, royaleHasActions, royaleDrawTrace, royaleAliveBefore,
} from '../src/royale/engine.ts'
import { createHash } from 'node:crypto'
import { ROYALE_FIRST, ROYALE_RULES } from '../src/royale/config.ts'

const U = (s) => toUnits(s)
const P = 'DPOOL', A = 'DA', B = 'DB', C3 = 'DC'
const cfg = { version: 1, pool: P, players: [A, B, C3], session: 1, cutoff: 100, ticketFrom: 0, actFrom: 0, ticket: 1, shield: 1, bonk: 1, revive: 2, minDogs: 2, maxSeats: 99, bigRoom: 10, floor: 0, rollover: '0', conf: 2, window: 3, lastBuyRound: 6, killRate: 0.33, grid: 720, minOpen: 60 }
let n = 0
const tx = (from, amt, h, ok = true, to = P) => ({ tx: 'tx' + String(++n).padStart(3, '0'), from, to, amt: U(amt), h, ok })
const hashes = {}
for (let h = 100; h < 400; h++) hashes[h] = ((h * 2654435761) >>> 0).toString(16).padStart(8, '0') + 'ab'.repeat(28)

const inbound = [
  tx(A, '1', 95), tx(B, '1', 99), tx(C3, '1', 100),
  tx(A, '1', 98), // 同一地址第二张
  tx(B, '1.5', 97), // 尾数读不出
  tx(A, walletAmount(1, 1, 1, 'shield'), 103), // 第 1 轮窗口 [103, 105)
  tx(B, walletAmount(1, 1, 1, 'bonk'), 104),
  tx(C3, walletAmount(1, 2, 1, 'bonk'), 104), // 场次不对
  tx(A, walletAmount(1, 1, 1, 'shield'), 101), // 名单 102 才公布
  tx(B, '1', 101, false), // 链上失败
]
const sumAmt = (xs) => xs.reduce((a, t) => a + t.amt, BigInt(0))

test('各高度的阶段 / 狗数 / 轮数 / 奖池', () => {
  const rows = [99, 101, 104, 107, 400].map((tip) => {
    const o = derive(cfg, { tip, inbound, outbound: [], hashes })
    return [tip, o.phase, o.dogs.length, o.rounds.length, fromUnits(o.pot), o.champ ?? '-', o.rollover === null ? '-' : fromUnits(o.rollover)]
  })
  assert.deepEqual(rows, [
    [99, 'lobby', 2, 0, '2', '-', '-'],
    [101, 'roster', 3, 0, '3', '-', '-'],
    [104, 'live', 3, 1, '3', '-', '-'],
    [107, 'live', 3, 2, '5.00020203', '-', '-'],
    [400, 'over', 3, 2, '5.00020203', 1, '0.50002021'],
  ])
})

test('终局：逐轮出局、逐笔状态与原因、账平', () => {
  const o = derive(cfg, { tip: 400, inbound, outbound: [], hashes })
  assert.deepEqual(o.rounds.map((r) => [r.round, r.start, r.R, r.event, r.kills, r.blocked, r.txs.map((t) => t.st).join(',')]), [
    [1, 103, 105, null, [{ no: 3, by: 1 }], [], 'counted,counted'],
    [2, 105, 110, null, [{ no: 2, by: 1 }], [], ''],
  ])
  assert.deepEqual(o.txs.map((t) => [t.tx, t.from, t.amtText, t.h, t.st, t.reason]), [
    ['tx001', 'DA', '1', 95, 'seat', ''],
    ['tx005', 'DB', '1.5', 97, 'refund', '小数前两位不是 00，读不出尾数'],
    ['tx004', 'DA', '1', 98, 'refund', '同一地址的第二张门票'],
    ['tx002', 'DB', '1', 99, 'seat', ''],
    ['tx003', 'DC', '1', 100, 'seat', ''],
    ['tx009', 'DA', '1.00010101', 101, 'refund', '打包在 101，名单 102 才公布'],
    ['tx010', 'DB', '1', 101, 'failed', '链上执行失败，钱没进奖池'],
    ['tx006', 'DA', '1.00010101', 103, 'counted', ''],
    ['tx007', 'DB', '1.00010102', 104, 'counted', ''],
    ['tx008', 'DC', '1.00020102', 104, 'refund', '尾数场次是 02，本场是 01'],
  ])
  // 结构化原因与中文原因同处生成
  assert.deepEqual(o.txs.filter((t) => t.why).map((t) => t.why.code), ['badTail', 'dupTicket', 'beforeRoster', 'chainFailed', 'wrongSession'])
  const sumIn = sumAmt(o.txs.filter((t) => t.ok))
  const sumOwed = sumAmt(o.owed)
  assert.equal(fromUnits(sumIn), '9.50050406')
  assert.equal(fromUnits(sumOwed), '9.00048385')
  assert.equal(sumIn - sumOwed - o.rollover, BigInt(0))
  assert.deepEqual(o.prizes.map((p) => [p.rank, p.no, p.label]), [[0, 1, '冠军']])
  assert.equal(o.owed[0].label, '冠军（1 号）')
})

test('有冠军即结束：开奖块压满 conf 块时出结果，不需要任何转出就接下一场', () => {
  // 终局开奖块 110，tip 111 还在等开奖，112 出结果
  assert.equal(derive(cfg, { tip: 111, inbound, outbound: [], hashes }).phase, 'live')
  const o = derive(cfg, { tip: 112, inbound, outbound: [], hashes })
  assert.equal(o.phase, 'over')
  assert.equal(o.champ, 1)
  assert.ok(o.endH === 110 && o.settledH === 110)
  assert.equal(o.nextC, nextCutoff(110, cfg))
  assert.equal(o.nextC, 720)
  assert.ok(o.owed.every((w) => !('paid' in w)))
  const s = series(cfg, { tip: 112, inbound, outbound: [], hashes })
  assert.equal(s.sessions.length, 2)
  assert.equal(s.sessions[0].out.phase, 'over')
  assert.ok(s.cfg.session === 2 && s.cfg.cutoff === 720 && s.cfg.ticketFrom === 100 && s.cfg.actFrom === 110)
  assert.equal(s.cfg.rollover, fromUnits(o.rollover))
  assert.equal(s.out.phase, 'lobby')
})

test('台账：按地址汇总应付，对奖池全部转出（部分领、全领、多转、转给无关地址）', () => {
  const o = derive(cfg, { tip: 400, inbound, outbound: [], hashes })
  const prizeA = o.owed.find((w) => w.kind === 'prize').amt
  assert.equal(fromUnits(prizeA), '4.50018182')
  const out = (to, amt, h, ok = true, from = P) => ({ tx: 'o' + String(++n).padStart(3, '0'), from, to, amt: U(amt), h, ok })
  const outbound = [
    out(A, '3', 200), // A 部分领
    out(B, '1.5', 210), // B 全领
    out(C3, '2', 220), // C3 多转
    out('DX', '1', 230), // 转给无关地址
    out(A, '9', 300, false), // 链上失败：不算
    out(A, '9', 401), // 晚于 tip：不算
    out(A, '9', 250, true, 'DOTHER'), // 不是奖池发出：不算
  ]
  const s = series(cfg, { tip: 400, inbound, outbound, hashes })
  const rows = Object.fromEntries(s.ledger.map((r) => [r.addr, [fromUnits(r.earned), fromUnits(r.pending), fromUnits(r.claimed), fromUnits(r.claimable), fromUnits(r.over)]]))
  assert.deepEqual(rows, {
    // 冠军 4.50018182 + 退回第二张门票 1 + 名单前的加盾 1.00010101
    DA: ['6.50028283', '0', '3', '3.50028283', '0'],
    DB: ['1.5', '0', '1.5', '0', '0'],
    DC: ['1.00020102', '0', '2', '0', '0.99979898'],
    DX: ['0', '0', '1', '0', '1'],
  })
  assert.deepEqual(s.ledger.map((r) => r.addr), ['DA', 'DB', 'DC', 'DX'], 'claimable 降序，再按地址')
  const a = s.ledger[0]
  assert.deepEqual(a.items.map((w) => [w.session, w.kind]), [[1, 'prize'], [1, 'refund'], [1, 'refund']])
  assert.deepEqual(a.claims.map((t) => t.h), [200])
  // 不转出：全部可领
  const s0 = series(cfg, { tip: 400, inbound, outbound: [], hashes })
  assert.equal(fromUnits(s0.ledger.find((r) => r.addr === A).claimable), '6.50028283')
  assert.equal(s0.ledger.reduce((x, r) => x + r.claimable, BigInt(0)), o.owed.reduce((x, w) => x + w.amt, BigInt(0)))
})

test('不够最少狗数：本场取消，退回全部（终局后的动作不归本场）', () => {
  const o = derive({ ...cfg, minDogs: 4 }, { tip: 200, inbound, outbound: [], hashes })
  assert.equal(o.phase, 'cancelled')
  assert.equal(o.owed.map((w) => w.to + ' ' + fromUnits(w.amt)).join(' | '), 'DA 1 | DB 1.5 | DA 1 | DB 1 | DC 1 | DA 1.00010101')
  assert.equal(o.txs.find((t) => t.tx === 'tx001').why.code, 'cancelledTicket')
})

test('多场衔接：取消即接下一场，未压满的退款进 pending', () => {
  const inb = [tx(A, '1', 90), tx(B, '1', 101), tx(A, walletAmount(1, 1, 1, 'shield'), 103)]
  const s1 = series(cfg, { tip: 101, inbound: inb, outbound: [], hashes })
  assert.ok(s1.sessions.length === 1 && s1.out.phase === 'roster', '名单公布前还在第1场')
  assert.equal(s1.out.txs.find((t) => t.from === B).st, 'next', 'B 截止后的门票标 next')

  const s2 = series(cfg, { tip: 104, inbound: inb, outbound: [], hashes })
  assert.equal(s2.sessions.length, 2, '第1场取消即接上第2场，不等退款')
  assert.ok(s2.sessions[0].out.phase === 'cancelled' && s2.sessions[0].out.owed.length === 1 && s2.sessions[0].out.owed[0].to === A, '第1场只退 A 的门票')
  assert.ok(s2.cfg.session === 2 && s2.cfg.cutoff === nextCutoff(102, cfg) && s2.cfg.ticketFrom === 100 && s2.cfg.actFrom === 102)
  assert.ok(s2.out.phase === 'lobby' && s2.out.dogs.length === 1 && s2.out.dogs[0].addr === B, '第2场报名中，B 已入场 1 号')
  const actA = s2.out.txs.find((t) => t.info.kind === 'shield')
  assert.ok(actA && actA.st === 'refund' && /场次/.test(actA.reason), '第1场终局后的动作归第2场并退款')
  // 当前场的退款也进台账：103 的加盾 tip 104 还没压满 2 块 → pending
  const rowA = s2.ledger.find((r) => r.addr === A)
  assert.deepEqual([fromUnits(rowA.earned), fromUnits(rowA.pending), fromUnits(rowA.claimable)], ['1', '1.00010101', '1'])
  assert.deepEqual(rowA.items.map((w) => [w.session, w.ready]), [[1, true], [2, false]])
  const s3 = series(cfg, { tip: 105, inbound: inb, outbound: [], hashes })
  assert.equal(fromUnits(s3.ledger.find((r) => r.addr === A).claimable), '2.00010101', '压满后转为可领')
  assert.ok(!s3.ledger.some((r) => r.addr === B), 'B 没有应付也没有转出，不出现')

  const full = derive(cfg, { tip: 400, inbound, outbound: [], hashes })
  const s4 = series(cfg, { tip: 400, inbound, outbound: [], hashes })
  assert.ok(s4.sessions.length === 2 && s4.cfg.rollover === fromUnits(full.rollover), '冠军场后第2场顺延')
  assert.ok(s4.cfg.actFrom === full.endH && s4.cfg.ticketFrom === 100, '第2场动作从终局块后算')
})

test('线上已发生的截止块不变：6446568 → 6446880 → 6447600', () => {
  const s = series(ROYALE_FIRST, { tip: 6447100, inbound: [], outbound: [], hashes: {} }, { versions: ROYALE_RULES })
  assert.deepEqual(s.sessions.map(({ cfg: c, out }) => [c.session, c.cutoff, out.phase]), [
    [1, 6446568, 'cancelled'],
    [2, 6446880, 'cancelled'],
    [3, 6447600, 'lobby'],
  ])
  assert.deepEqual(s.sessions.slice(0, 2).map(({ out }) => out.settledH), [6446570, 6446882])
  assert.equal(s.ledger.length, 0)
})

test('规则版本：按场次生效，加新版本不改旧场次', () => {
  const RULE_KEYS = ['ticket', 'shield', 'bonk', 'revive', 'minDogs', 'maxSeats', 'bigRoom', 'floor', 'conf', 'window', 'lastBuyRound', 'killRate', 'grid', 'minOpen']
  const pick = (c) => Object.fromEntries(['version', ...RULE_KEYS].map((k) => [k, c[k]]))
  const v1 = { fromSession: 1, rules: pick(cfg) }
  const v2 = { fromSession: 2, rules: { ...pick(cfg), version: 2, ticket: 2, grid: 360 } }
  // 第 2 场的门票：1 WDOGE（旧价）与 2 WDOGE（新价）
  const t = (id, from, amt, h) => ({ tx: id, from, to: P, amt: U(amt), h, ok: true })
  const data = { tip: 400, inbound: [...inbound, t('v2a', A, '2', 150), t('v2b', B, '1', 151)], outbound: [], hashes }
  const only1 = series(cfg, data, { versions: [v1] })
  const both = series(cfg, data, { versions: [v1, v2] })
  // 第 1 场：结果逐字段与只有 v1 时相同
  assert.deepEqual(both.sessions[0], only1.sessions[0])
  assert.equal(both.sessions[0].cfg.version, 1)
  // 第 2 场：换成 v2 的价格；截止由第 1 场自己的规则（grid 720）推出
  assert.equal(both.cfg.session, 2)
  assert.deepEqual([both.cfg.version, both.cfg.ticket, both.cfg.grid], [2, 2, 360])
  assert.equal(both.cfg.cutoff, nextCutoff(110, cfg))
  const st = (s, id) => s.out.txs.find((x) => x.tx === id)
  assert.equal(st(both, 'v2a').info.kind, 'ticket')
  assert.equal(st(both, 'v2b').why.code, 'notTicketPrice')
  assert.equal(st(only1, 'v2a').why.code, 'notTicketPrice')
  // 不给版本表 = 全程沿用第 1 场的规则
  assert.deepEqual(series(cfg, data).sessions.map((x) => x.cfg.version), [1, 1])
})

test('规则版本表校验', () => {
  const r = (version) => ({ ...ROYALE_RULES[0].rules, version })
  assert.throws(() => checkRuleVersions([]), /为空/)
  assert.throws(() => checkRuleVersions([{ fromSession: 1, rules: r(0) }]), /版本号/)
  assert.throws(() => checkRuleVersions([{ fromSession: 0, rules: r(1) }]), /生效场次/)
  assert.throws(() => checkRuleVersions([{ fromSession: 1, rules: r(1) }, { fromSession: 1, rules: r(2) }]), /严格递增/)
  assert.throws(() => checkRuleVersions([{ fromSession: 1, rules: r(2) }, { fromSession: 3, rules: r(2) }]), /严格递增/)
  assert.throws(() => rulesAt([{ fromSession: 2, rules: r(1) }], 1), /没有适用/)
  assert.throws(() => derive({ ...cfg, version: 0 }, { tip: 1, inbound: [], outbound: [], hashes: {} }), /版本号/)
  // 线上版本表合法，第 1 场用的就是表里第 1 场的版本
  checkRuleVersions(ROYALE_RULES)
  assert.deepEqual(rulesAt(ROYALE_RULES, ROYALE_FIRST.session).rules, Object.fromEntries(Object.keys(ROYALE_RULES[0].rules).map((k) => [k, ROYALE_FIRST[k]])))
})

test('空场取消后自动开下一场：截止 = ceil((C + conf + minOpen) / grid) × grid', () => {
  for (const C of [100, 6446568, 6446879, 6446880]) {
    const c = { ...cfg, cutoff: C, ticketFrom: C - 28, actFrom: C - 28 }
    const s = series(c, { tip: C + 2, inbound: [], outbound: [], hashes: {} })
    assert.equal(s.sessions.length, 2)
    assert.equal(s.sessions[0].out.phase, 'cancelled')
    assert.equal(s.sessions[0].out.owed.length, 0)
    assert.equal(s.cfg.session, 2)
    assert.equal(s.cfg.cutoff, Math.ceil((C + 2 + 60) / 720) * 720)
    assert.equal(s.cfg.ticketFrom, C)
    assert.equal(s.cfg.actFrom, C + 2)
    assert.equal(s.out.phase, 'lobby')
  }
  // 截止前一块之前还在第 1 场
  assert.equal(series(cfg, { tip: 101, inbound: [], outbound: [], hashes: {} }).sessions.length, 1)
  // 实际第 1 场：6446568 截止，空场则第 2 场截止 6446880
  assert.equal(nextCutoff(6446568 + 2, cfg), 6446880)
})

test('门票金额：整数价、8 位小数全 0', () => {
  assert.equal(ticketAmount(cfg), '1.00000000')
  assert.equal(toUnits(ticketAmount(cfg)), BigInt(100000000))
  assert.deepEqual(decode(U('1'), cfg), { kind: 'ticket' })
  assert.equal(decode(U('2'), cfg).why.code, 'notTicketPrice')
  assert.equal(decode(U('2'), cfg).bad, '整数金额 2 不是门票价 1')
})

test('动作金额 walletAmount 与尾数 decode 互逆', () => {
  assert.equal(walletAmount(1, 1, 1, 'shield'), '1.00010101')
  assert.equal(walletAmount(1, 12, 34, 'bonk'), '1.00123402')
  assert.equal(walletAmount(2, 105, 7, 'revive'), '2.00050703') // 场次取后两位
  for (const [kind, cost] of [['shield', 1], ['bonk', 1], ['revive', 2]]) {
    for (const [session, no] of [[1, 1], [9, 42], [99, 99]]) {
      assert.deepEqual(decode(U(walletAmount(cost, session, no, kind)), cfg), { kind, session, no })
    }
  }
  assert.equal(decode(U('1.10010101'), cfg).why.code, 'badTail')
  assert.equal(decode(U('1.00010104'), cfg).why.code, 'badActionCode')
  const wrong = decode(U('2.00010101'), cfg)
  assert.equal(wrong.why.code, 'wrongPrice')
  assert.equal(wrong.bad, '加盾的价格是 1，这笔整数部分是 2')
})

test('toUnits / fromUnits 精确、拒绝非法格式', () => {
  assert.equal(toUnits('0.00000001'), BigInt(1))
  assert.equal(toUnits('123456789012.5'), BigInt('12345678901250000000'))
  assert.equal(fromUnits(BigInt('12345678901250000000')), '123456789012.5')
  assert.equal(fromUnits(BigInt(-150000000)), '-1.5')
  for (const s of ['1e5', '-1', '1.123456789', '']) assert.throws(() => toUnits(s))
})

test('royaleMoves：报名中只给没票的名单地址门票', () => {
  const o = derive(cfg, { tip: 99, inbound, outbound: [], hashes })
  assert.deepEqual(royaleMoves(cfg, o, C3), [{ kind: 'ticket', no: null, amount: '1.00000000' }])
  assert.deepEqual(royaleMoves(cfg, o, A), [], '已入场')
  assert.deepEqual(royaleMoves(cfg, o, 'DX'), [], '不在名单')
  assert.deepEqual(royaleMoves(cfg, o, null), [])
  assert.deepEqual(royaleMoves(cfg, derive(cfg, { tip: 101, inbound, outbound: [], hashes }), C3), [], '名单公布中不卖票')
})

test('royaleMoves：开打后按当前轮窗口给加盾 / 砸 / 爬回来', () => {
  // tip 103：第 1 轮窗口 [103, 105)，下一块 104 < 105 还能交；A 的加盾（103）待生效
  const o = derive(cfg, { tip: 103, inbound, outbound: [], hashes })
  assert.equal(o.phase, 'live')
  const movesA = royaleMoves(cfg, o, A).map((m) => `${m.kind}:${m.no}:${m.amount}`)
  assert.deepEqual(movesA, ['shield:1:1.00010101', 'bonk:2:1.00010202', 'bonk:3:1.00010302'])
  // tip 104：下一块 105 = 开奖块，窗口已收
  assert.deepEqual(royaleMoves(cfg, derive(cfg, { tip: 104, inbound, outbound: [], hashes }), A), [])
  // tip 106：第 1 轮开奖块 105 还没压满 2 块，窗口仍是第 1 轮（已收）
  assert.deepEqual(royaleMoves(cfg, derive(cfg, { tip: 106, inbound, outbound: [], hashes }), C3), [])
  // tip 107：第 1 轮开奖，第 2 轮窗口 [105, 110)；3 号第 1 轮出局 → 只能爬回来；2 号还活着
  const o2 = derive(cfg, { tip: 107, inbound, outbound: [], hashes })
  assert.deepEqual(royaleMoves(cfg, o2, C3).map((m) => `${m.kind}:${m.no}:${m.amount}`), ['revive:3:2.00010303'])
  assert.deepEqual(royaleMoves(cfg, o2, B).map((m) => m.kind + ':' + m.no), ['shield:2', 'bonk:1'])
  // 已有 1 层盾 + 1 笔待生效 = 2，不再给加盾
  const o3 = derive(cfg, { tip: 108, inbound: [...inbound, tx(A, walletAmount(1, 1, 1, 'shield'), 108)], outbound: [], hashes })
  assert.equal(o3.dogs[0].shield, 1)
  assert.ok(!royaleMoves(cfg, o3, A).some((m) => m.kind === 'shield'))
})

// ---------------------------------------------------------------- 规则 v2：没有动作，等概率淘汰

const cfg2 = { ...cfg, version: 2, shield: 0, bonk: 0, revive: 0, lastBuyRound: 0 }

test('v2 线上版本：第 11 场起生效，去掉动作、10 块一场，其余参数与 v1 相同', () => {
  checkRuleVersions(ROYALE_RULES)
  const [v1, v2] = ROYALE_RULES
  assert.equal(ROYALE_RULES.length, 2)
  assert.deepEqual([v2.fromSession, v2.rules.version], [11, 2])
  assert.equal(rulesAt(ROYALE_RULES, 10).rules.version, 1)
  assert.equal(rulesAt(ROYALE_RULES, 11).rules.version, 2)
  const drop = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !['version', 'shield', 'bonk', 'revive', 'lastBuyRound', 'grid', 'minOpen'].includes(k)))
  assert.deepEqual(drop(v2.rules), drop(v1.rules))
  assert.deepEqual([v1.rules.grid, v1.rules.minOpen, v2.rules.grid, v2.rules.minOpen], [720, 60, 10, 3])
  assert.equal(royaleHasActions(v1.rules), true)
  assert.equal(royaleHasActions(v2.rules), false)
})

test('v2 decode：只认整数门票，带尾数的金额一律 ticketOnly', () => {
  assert.deepEqual(decode(U('1'), cfg2), { kind: 'ticket' })
  assert.equal(decode(U('2'), cfg2).why.code, 'notTicketPrice')
  for (const amt of [walletAmount(1, 1, 1, 'shield'), walletAmount(1, 1, 2, 'bonk'), walletAmount(2, 1, 1, 'revive'), '1.5', '1.00010104']) {
    assert.deepEqual(decode(U(amt), cfg2).why, { code: 'ticketOnly', params: { price: 1 } }, amt)
  }
  // v1 同样金额照旧识别成动作
  assert.deepEqual(decode(U(walletAmount(1, 1, 1, 'shield')), cfg), { kind: 'shield', session: 1, no: 1 })
})

test('v2 derive：动作金额退回、没有事件 / 带走 / 盾，奖池只有门票', () => {
  const inb = [
    tx(A, '1', 95), tx(B, '1', 99), tx(C3, '1', 100),
    tx(A, walletAmount(1, 1, 1, 'shield'), 103),
    tx(B, walletAmount(1, 1, 1, 'bonk'), 104),
  ]
  const o = derive(cfg2, { tip: 400, inbound: inb, outbound: [], hashes })
  assert.equal(o.phase, 'over')
  assert.equal(fromUnits(o.pot), '3')
  assert.deepEqual(o.txs.filter((t) => t.st === 'refund').map((t) => [t.h, t.why.code]), [[103, 'ticketOnly'], [104, 'ticketOnly']])
  for (const r of o.rounds) {
    assert.equal(r.event, null)
    assert.deepEqual([r.blocked, r.revived, r.lucky ?? []], [[], [], []])
    assert.ok(r.kills.every((k) => k.by === null))
  }
  assert.deepEqual(o.rounds.map((r) => r.R), [105, 110])
  assert.ok(o.dogs.every((d) => d.shield === 0 && d.kills === 0 && d.killer === null))
  assert.equal(o.prizes.length, 1)
  assert.equal(fromUnits(o.prizes[0].amt), '2.7')
  assert.equal(fromUnits(o.rollover), '0.3')
})

test('v2 planRound：等概率（不看被砸 / 带走），至少出局 1 只、至少留 1 只', () => {
  const dog = (no, heat = 0, kills = 0) => ({ no, addr: 'D' + no, alive: true, shield: 0, heat, kills, killer: null, outRound: 0, revived: false })
  const alive = Array.from({ length: 10 }, (_, i) => dog(i + 1, i === 0 ? 9 : 0, i === 1 ? 5 : 0))
  const hits = new Array(11).fill(0)
  const N = 20000
  for (let i = 0; i < N; i++) {
    const hash = createHash('sha256').update(String(i)).digest('hex')
    const p = planRound(hash, 1 + (i % 5), alive, cfg2)
    assert.equal(p.event, null)
    assert.equal(p.results.length, 3) // round(10 × 0.33)
    assert.equal(new Set(p.results.map((x) => x.v.no)).size, 3)
    assert.ok(p.results.every((x) => x.killer === null))
    p.results.forEach((x) => { hits[x.v.no]++ })
  }
  // 每只期望 N × 3 / 10 = 6000，±5% 内（被砸 9 次的 1 号、带走 5 只的 2 号也一样）
  for (let no = 1; no <= 10; no++) assert.ok(Math.abs(hits[no] - 6000) < 300, `${no} 号 ${hits[no]}`)
  // 两只：出局 1 只；一只：不出局
  assert.equal(planRound('00000000', 3, [dog(1), dog(2)], cfg2).results.length, 1)
  assert.equal(planRound('00000000', 3, [dog(1)], cfg2).results.length, 0)
  // 同一哈希同一结果
  const h = 'deadbeef' + 'ab'.repeat(28)
  assert.deepEqual(planRound(h, 2, alive, cfg2).results.map((x) => x.v.no), planRound(h, 2, alive, cfg2).results.map((x) => x.v.no))
})

test('v2 royaleDrawTrace：逐步过程与 planRound / 引擎出局结果一致，可按 mulberry32 独立复算', () => {
  // 独立实现一遍（不经引擎）：种子 = 前 8 位，mulberry32，活狗升序、每步取 floor(r × 剩余)
  const mulberry = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const dog = (no) => ({ no, addr: 'D' + no, alive: true, shield: 0, heat: 0, kills: 0, killer: null, outRound: 0, revived: false })
  for (let i = 0; i < 2000; i++) {
    const hash = createHash('sha256').update('t' + i).digest('hex')
    const nos = Array.from({ length: 2 + (i % 12) }, (_, k) => k + 1)
    const tr = royaleDrawTrace(hash, nos, cfg2)
    const r = mulberry(parseInt(hash.slice(0, 8), 16))
    const pool = nos.slice()
    const want = []
    for (let k = 0; k < tr.n; k++) want.push(pool.splice(Math.floor(r() * pool.length), 1)[0])
    assert.equal(tr.seed, parseInt(hash.slice(0, 8), 16))
    assert.equal(tr.seedHex, hash.slice(0, 8))
    assert.deepEqual(tr.steps.map((s) => s.no), want)
    assert.ok(tr.steps.every((s) => s.index === Math.floor(s.r * s.pool.length) && s.pool[s.index] === s.no))
    assert.deepEqual(planRound(hash, 1, nos.map(dog), cfg2).results.map((x) => x.v.no), want)
  }
  // 引擎推出的每一轮：开奖前活狗 + 哈希 → 过程里的出局号 = 这一轮的 kills
  const inb = [tx(A, '1', 95), tx(B, '1', 99), tx(C3, '1', 100)]
  const o = derive(cfg2, { tip: 400, inbound: inb, outbound: [], hashes })
  assert.ok(o.rounds.length > 0)
  for (const rd of o.rounds) {
    const tr = royaleDrawTrace(rd.hash, royaleAliveBefore(o, rd.round, cfg2), cfg2)
    assert.deepEqual(tr.steps.map((s) => s.no), rd.kills.map((k) => k.no))
  }
  // v1 有动作：不提供
  assert.equal(royaleDrawTrace('deadbeef', [1, 2, 3], cfg), null)
  assert.equal(royaleAliveBefore(o, 1, cfg), null)
  assert.equal(royaleDrawTrace('deadbeef', [1], cfg2), null)
})

test('v2 royaleMoves：报名照常给门票，开打后什么都不给', () => {
  const inb = [tx(A, '1', 95), tx(B, '1', 99)]
  assert.deepEqual(royaleMoves(cfg2, derive(cfg2, { tip: 99, inbound: inb, outbound: [], hashes }), C3), [{ kind: 'ticket', no: null, amount: '1.00000000' }])
  const o = derive(cfg2, { tip: 103, inbound: inb, outbound: [], hashes })
  assert.equal(o.phase, 'live')
  assert.deepEqual(royaleMoves(cfg2, o, A), [])
  assert.ok(royaleMoves(cfg, derive(cfg, { tip: 103, inbound: inb, outbound: [], hashes }), A).length > 0, 'v1 同样局面有动作')
})

test('v2 接续：版本表里 v1 → v2，v2 场次的动作金额退回', () => {
  const RULE_KEYS = ['ticket', 'shield', 'bonk', 'revive', 'minDogs', 'maxSeats', 'bigRoom', 'floor', 'conf', 'window', 'lastBuyRound', 'killRate', 'grid', 'minOpen']
  const pick = (c) => Object.fromEntries(['version', ...RULE_KEYS].map((k) => [k, c[k]]))
  const versions = [{ fromSession: 1, rules: pick(cfg) }, { fromSession: 2, rules: pick(cfg2) }]
  // 第 1 场 tip 100 前空场取消 → 第 2 场；第 2 场门票 + 一笔动作金额
  const C2 = nextCutoff(100 + cfg.conf, cfg)
  const data = {
    tip: C2 - 1,
    inbound: [tx(A, '1', C2 - 10), tx(B, walletAmount(1, 2, 1, 'shield'), C2 - 9)],
    outbound: [],
    hashes,
  }
  const s = series(cfg, data, { versions })
  assert.deepEqual(s.sessions.map((x) => [x.cfg.session, x.cfg.version, x.out.phase]), [[1, 1, 'cancelled'], [2, 2, 'lobby']])
  const st = s.out.txs.map((t) => [t.from, t.st, t.why?.code ?? ''])
  assert.deepEqual(st, [[A, 'seat', ''], [B, 'refund', 'ticketOnly']])
})

test('v2 节奏：2 只狗终局在截止后 5 块、空场截止后 2 块取消，下一场截止都在 10 块后', () => {
  const live = { ...cfg, ...ROYALE_RULES[1].rules, cutoff: 200, ticketFrom: 190, actFrom: 190 }
  const two = series(live, { tip: 260, inbound: [tx(A, '1', 195), tx(B, '1', 196)], outbound: [], hashes })
  const first = two.sessions[0]
  assert.equal(first.out.phase, 'over')
  assert.equal(first.out.settledH, 205) // 终局 = 第 1 轮开奖块 C + conf + window（压满 conf 块后才算出来）
  assert.equal(first.out.nextC, 210)
  const empty = series(live, { tip: 260, inbound: [], outbound: [], hashes })
  assert.deepEqual(empty.sessions.slice(0, 3).map((x) => [x.out.phase, x.cfg.cutoff, x.out.nextC]), [['cancelled', 200, 210], ['cancelled', 210, 220], ['cancelled', 220, 230]])
})

test('series 不设默认场数上限：v2 空场每 10 块一场，3000 块后照样推到当前场；调用方给的 maxSessions 不够即抛错', () => {
  const V2 = ROYALE_RULES[1].rules
  const first = { pool: P, players: null, session: 1, cutoff: 1000, ticketFrom: 990, actFrom: 990, rollover: '0', ...V2 }
  const data = { tip: 4005, inbound: [], outbound: [], hashes: {} }
  const r = series(first, data, { versions: [{ fromSession: 1, rules: V2 }] })
  // 第 k 场截止 1000 + 10(k−1)：截止 4000 的第 301 场在 4002 取消，当前是截止 4010 的第 302 场
  assert.equal(r.sessions.length, 302)
  assert.deepEqual([r.cfg.session, r.cfg.cutoff, r.out.phase], [302, 4010, 'lobby'])
  assert.equal(series(first, data, { versions: [{ fromSession: 1, rules: V2 }], maxSessions: 302 }).cfg.session, 302)
  assert.throws(() => series(first, data, { versions: [{ fromSession: 1, rules: V2 }], maxSessions: 301 }), /maxSessions/)
  assert.throws(() => series(first, data, { maxSessions: 0 }), /maxSessions/)
})

// series 每场只把一段入池转账交给 derive（上界不够即放宽重推），结果须与「每场用整表 derive」相同；
// 唯一的差别：已结束场次的迟到门票（next）只列到下一场截止为止
test('series 分段推演 = 每场整表 derive；已结束场次的 next 门票只列到下一场截止；resume 与从头推相同', () => {
  const V2 = ROYALE_RULES[1].rules
  const hs = {}
  for (let h = 0; h < 6000; h++) hs[h] = createHash('sha256').update(String(h)).digest('hex')
  const cases = [
    // v1：grid 720，下一场截止远在截止后 64 块之外，走放宽重推；带动作 / 错单 / 链上失败 / 重复门票
    { first: cfg, versions: undefined, tip: 3000 },
    { first: { ...cfg, players: null, cutoff: 1000, ticketFrom: 990, actFrom: 990, ...V2 }, versions: [{ fromSession: 1, rules: V2 }], tip: 2500 },
  ]
  for (const { first, versions, tip } of cases) {
    const rows = []
    let k = 0
    const add = (from, amt, h, ok = true) => rows.push({ tx: 't' + String(++k).padStart(5, '0'), from, to: P, amt: U(amt), h, ok })
    for (let h = 0; h < tip; h += 7) {
      const who = [A, B, C3][h % 3]
      add(who, '1', h)
      if (h % 5 === 0) add(who, walletAmount(1, 1 + (h % 4), 1 + (h % 3), ['shield', 'bonk', 'revive'][h % 3]), h + 2)
      if (h % 11 === 0) add(who, '1.5', h + 3)
      if (h % 13 === 0) add(who, '1', h + 1, false)
    }
    add(A, '1', null)
    const data = { tip, inbound: rows, outbound: [], hashes: hs }
    const opts = versions ? { versions } : {}
    const r = series(first, data, opts)
    assert.ok(r.sessions.length >= 3)
    r.sessions.forEach(({ cfg: c, out }, i) => {
      const full = derive(c, data)
      const nextC = r.sessions[i + 1]?.cfg.cutoff
      if (nextC !== undefined) full.txs = full.txs.filter((t) => t.st !== 'next' || t.h <= nextC)
      assert.deepEqual(out, full, `第 ${c.session} 场`)
      if (nextC !== undefined) assert.ok(out.txs.every((t) => t.st !== 'next' || (t.h > c.cutoff && t.h <= nextC)))
    })
    // 缺开奖块哈希：补一个、从停下的那场接着推，与补齐后从头推相同
    const partial = { ...data, hashes: {} }
    let p = series(first, partial, opts)
    let fills = 0
    while (p.needHash !== null) {
      partial.hashes[p.needHash] = hs[p.needHash]
      p = series(first, partial, { ...opts, resume: p })
      fills++
    }
    assert.ok(fills > 0)
    assert.deepEqual(p, series(first, partial, opts))
  }
})
