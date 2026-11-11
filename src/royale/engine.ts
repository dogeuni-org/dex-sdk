// 狗狗大逃杀 · 链上版判定引擎：规则的唯一来源（参数在 ./config.ts；链上数据由调用方读好传入）。
// 网页展示与奖池结算方用同一份引擎复算，任何人拿同样的链上数据都能得出同样的名次、奖金与退款。
// 纯函数：同样的配置 + 同样的链上数据（已入库高度、入池 / 出池转账、开奖块哈希）永远得出同样的结果。
// 金额一律按 WDOGE 最小单位（1e8）的 BigInt 计算（BigInt 写 BigInt(0) 不写 0n，兼容 es2015 目标的调用方）。
//
// 逻辑、随机数与中文原因（`reason`）与本地验证过的参考实现逐行一致，别改；页面展示用的是并列给出的结构化原因
// `why`（code + 参数，供调用方翻译），两者在同一处生成，改规则时一起改。

const UNIT = BigInt(100000000)
const ZERO = BigInt(0)

export type RoyaleActionKind = 'shield' | 'bonk' | 'revive'
export type RoyaleKind = 'ticket' | RoyaleActionKind

export const ROYALE_CODE: Record<RoyaleActionKind, string> = { shield: '01', bonk: '02', revive: '03' }
const KIND_OF: Record<string, RoyaleActionKind> = { '01': 'shield', '02': 'bonk', '03': 'revive' }
export const ROYALE_LABEL: Record<RoyaleKind, string> = { ticket: '门票', shield: '加盾', bonk: '砸一下', revive: '爬回来' }

/** 一场的全部参数（第 1 场由 config.ts 的 ROYALE_FIRST 给，之后由 series 按链上数据自动接续） */
export interface RoyaleConfig {
  /**
   * 规则版本（正整数，见 RoyaleRuleVersion）；改判定逻辑时按它分支，旧场次走旧分支。
   * v1：门票 + 加盾 / 砸 / 爬回来，按被砸次数加权淘汰，第 2 轮起有随机事件。
   * v2：只有门票（没有动作，带尾数的金额一律退回），每轮从活狗里等概率淘汰，没有事件 / 带走。
   */
  version: number
  /** 奖池地址（WDOGE 收款 / 发奖） */
  pool: string
  /** 只认这些地址发出的入池转账；null = 不限（见 config.ts 的 ROYALE_PLAYERS） */
  players: readonly string[] | null
  session: number
  /** 报名截止高度 C：打包在 C 及之前的门票入场 */
  cutoff: number
  /** 门票只认高度 > ticketFrom 的（上一场截止） */
  ticketFrom: number
  /** 动作 / 错单只认高度 > actFrom 的（上一场终局） */
  actFrom: number
  /** 上一场顺延进本场的奖池（WDOGE 十进制串） */
  rollover: string
  /** 价格（WDOGE 整数） */
  ticket: number
  shield: number
  bonk: number
  revive: number
  minDogs: number
  maxSeats: number
  /** 达到这么多只按三名分奖，否则冠军独得 */
  bigRoom: number
  /** 大场保底（WDOGE 整数），0 = 没有 */
  floor: number
  /** 名单 / 开奖块要压的块数 */
  conf: number
  /** 一轮的长度（块）：开奖块 R = 上一轮 R + conf + window */
  window: number
  /** 从第几轮起只能砸 */
  lastBuyRound: number
  killRate: number
  /** 下一场截止取 grid 的整数倍 */
  grid: number
  /** 下一场至少留多少块报名 */
  minOpen: number
}

/** 一个规则版本的全部规则（价格、窗口、分奖、接续……；不含场次衔接状态） */
export type RoyaleRules = Pick<RoyaleConfig,
  'version' | 'ticket' | 'shield' | 'bonk' | 'revive' | 'minDogs' | 'maxSeats' | 'bigRoom' | 'floor'
  | 'conf' | 'window' | 'lastBuyRound' | 'killRate' | 'grid' | 'minOpen'>

/**
 * 规则版本：从第 fromSession 场起生效，直到下一个版本。改规则只能加新版本、且只对还没开始收门票的场次生效，
 * 已有版本一律不改——否则旧场次复算出的名次 / 可领额会变。一场结束时用**它自己的**规则算下一场截止（grid / minOpen）。
 */
export interface RoyaleRuleVersion {
  fromSession: number
  rules: RoyaleRules
}

/** 校验版本表：非空、fromSession 与 version 都严格递增、version 是正整数（不对即抛错，不猜） */
export function checkRuleVersions(versions: readonly RoyaleRuleVersion[]): void {
  if (versions.length === 0) throw new Error('规则版本表为空')
  versions.forEach((v, i) => {
    if (!Number.isInteger(v.rules.version) || v.rules.version < 1) throw new Error(`规则版本号不对：${v.rules.version}`)
    if (!Number.isInteger(v.fromSession) || v.fromSession < 1) throw new Error(`规则生效场次不对：${v.fromSession}`)
    const prev = versions[i - 1]
    if (prev && !(v.fromSession > prev.fromSession && v.rules.version > prev.rules.version)) {
      throw new Error(`规则版本表必须按场次与版本号严格递增（v${prev.rules.version}@${prev.fromSession} → v${v.rules.version}@${v.fromSession}）`)
    }
  })
}

/** 第 session 场适用的规则（版本表须已过 checkRuleVersions；早于第一个版本的场次抛错） */
export function rulesAt(versions: readonly RoyaleRuleVersion[], session: number): RoyaleRuleVersion {
  let hit: RoyaleRuleVersion | null = null
  for (const v of versions) if (v.fromSession <= session) hit = v
  if (!hit) throw new Error(`第 ${session} 场没有适用的规则版本`)
  return hit
}

/** 一笔 WDOGE 转账（DRC-20 transfer），amt 为最小单位；h = 打包高度（null = 未入块）；ok = 链上执行成功 */
export interface RoyaleTransfer {
  tx: string
  from: string
  to: string
  amt: bigint
  h: number | null
  ok: boolean
}

export interface RoyaleChainData {
  /** 已入库高度 */
  tip: number
  /** 发往奖池的转账（引擎再按 to / players 过滤） */
  inbound: RoyaleTransfer[]
  /** 奖池发出的转账（领取 / 运营转出，series 按地址记入台账） */
  outbound: RoyaleTransfer[]
  /** 开奖块哈希（高度 → 64 位 hex） */
  hashes: Record<number, string>
}

/** 结构化原因：code 是稳定的原因标识（调用方按它翻译），params 为插值参数 */
export interface RoyaleReason {
  code: string
  params?: Record<string, string | number>
}

export type RoyaleDecoded =
  | { kind: 'ticket'; bad?: undefined }
  | { kind: RoyaleActionKind; session: number; no: number; bad?: undefined }
  | { kind?: undefined; bad: string; why: RoyaleReason }

export type RoyaleTxStatus = 'seen' | 'seat' | 'next' | 'refund' | 'failed' | 'pending' | 'counted'

export interface RoyaleTx extends RoyaleTransfer {
  h: number
  st: RoyaleTxStatus
  reason: string
  why: RoyaleReason | null
  amtText: string
  info: RoyaleDecoded
  round?: number
}

export interface RoyaleDog {
  no: number
  addr: string
  alive: boolean
  shield: number
  heat: number
  kills: number
  revived: boolean
  killer: number | null
  outRound: number
  ticketTx: string
}

export type RoyaleEvent = 'drop' | 'rain' | 'calm' | 'double'

export interface RoyaleRound {
  round: number
  start: number
  R: number
  hash: string | null
  txs: RoyaleTx[]
  event: RoyaleEvent | null
  kills: { no: number; by: number | null }[]
  blocked: number[]
  lucky: number[]
  revived: number[]
}

export interface RoyalePrize {
  no: number
  addr: string
  amt: bigint
  label: string
  /** 0 冠军 / 1 亚军 / 2 季军 */
  rank: number
}

export interface RoyaleOwed {
  kind: 'prize' | 'refund'
  label: string
  to: string
  amt: bigint
  /** 退款：原转入 tx */
  src?: string
  /** 可以领了（奖金：出结果即可；退款：出错那笔入库满 conf 块） */
  ready: boolean
  /** 奖金：名次与狗号 */
  rank?: number
  no?: number
  /** 退款：原单类型与原因 */
  refundKind?: RoyaleKind | null
  why?: RoyaleReason | null
}

export type RoyalePhase = 'lobby' | 'roster' | 'cancelled' | 'live' | 'over'

export interface RoyaleOutcome {
  tip: number
  phase: RoyalePhase
  dogs: RoyaleDog[]
  rounds: RoyaleRound[]
  txs: RoyaleTx[]
  owed: RoyaleOwed[]
  /** 推演缺这个开奖块的哈希（补取后重推） */
  needHash: number | null
  pot: bigint
  prizes: RoyalePrize[]
  rollover: bigint | null
  /** 下一场截止（本场结束 / 取消后才有） */
  nextC: number | null
  key: { cutoff: number; publish: number; R?: number }
  endH?: number
  endR?: number
  champ?: number
  floorPaid?: number
  round?: number
  /** 本场结束的高度（= endH；下一场截止由它推出） */
  settledH?: number
}

const two = (n: number) => String(n % 100).padStart(2, '0')

/** WDOGE 十进制串 → 最小单位（最多 8 位小数，格式不对抛错） */
export function toUnits(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{0,8}))?$/.exec(String(s).trim())
  if (!m) throw new Error(`金额格式不对：${s}`)
  return BigInt(m[1]) * UNIT + BigInt((m[2] || '').padEnd(8, '0') || '0')
}

/** 最小单位 → WDOGE 十进制串（去尾零，精确） */
export function fromUnits(u: bigint): string {
  const neg = u < ZERO
  const a = neg ? -u : u
  const i = a / UNIT
  const f = (a % UNIT).toString().padStart(8, '0').replace(/0+$/, '')
  return (neg ? '-' : '') + i.toString() + (f ? '.' + f : '')
}

/** 钱包里要填的动作金额（WDOGE 十进制）：整数部分是价格，小数 8 位 = 00 + 场次 2 位 + 狗号 2 位 + 动作 2 位 */
export function walletAmount(cost: number, session: number, no: number, kind: RoyaleActionKind): string {
  return `${cost}.00${two(session)}${two(no)}${ROYALE_CODE[kind]}`
}

/** 这一版规则有没有动作（加盾 / 砸 / 爬回来）；页面的按钮与文案唯一按它分支 */
export function royaleHasActions(cfg: Pick<RoyaleConfig, 'version'>): boolean {
  return cfg.version < 2
}

/** 门票金额（WDOGE 十进制）：整数价格、8 位小数全 0 */
export function ticketAmount(cfg: Pick<RoyaleConfig, 'ticket'>): string {
  return `${cfg.ticket}.00000000`
}

const bad = (text: string, why: RoyaleReason): RoyaleDecoded => ({ bad: text, why })

/** 按金额尾数识别一笔入池转账 */
export function decode(amt: bigint, cfg: Pick<RoyaleConfig, 'version' | 'ticket' | RoyaleActionKind>): RoyaleDecoded {
  const int = amt / UNIT
  const frac = (amt % UNIT).toString().padStart(8, '0')
  if (frac === '00000000') {
    return int === BigInt(cfg.ticket)
      ? { kind: 'ticket' }
      : bad(`整数金额 ${fromUnits(amt)} 不是门票价 ${cfg.ticket}`, { code: 'notTicketPrice', params: { amount: fromUnits(amt), price: cfg.ticket } })
  }
  if (!royaleHasActions(cfg)) {
    return bad(`本场规则只收整数门票 ${cfg.ticket}（没有加盾 / 砸 / 爬回来），转了 ${fromUnits(amt)}`, { code: 'ticketOnly', params: { price: cfg.ticket } })
  }
  if (!frac.startsWith('00')) return bad('小数前两位不是 00，读不出尾数', { code: 'badTail' })
  const kind = KIND_OF[frac.slice(6, 8)]
  if (!kind) return bad(`动作码 ${frac.slice(6, 8)} 不存在`, { code: 'badActionCode', params: { code: frac.slice(6, 8) } })
  if (int !== BigInt(cfg[kind])) {
    return bad(`${ROYALE_LABEL[kind]}的价格是 ${cfg[kind]}，这笔整数部分是 ${int}`, { code: 'wrongPrice', params: { kind, price: cfg[kind], int: int.toString() } })
  }
  return { kind, session: Number(frac.slice(2, 4)), no: Number(frac.slice(4, 6)) }
}

// 与原型同一套随机：只由开奖块哈希和已生效的交易决定
const rngFrom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T,>(arr: T[], r: () => number): T => arr[Math.floor(r() * arr.length)]

export interface RoyaleRoundPlan {
  event: RoyaleEvent | null
  results: { v: RoyaleDog; killer: RoyaleDog | null; line: number }[]
  lucky: RoyaleDog[]
}

/**
 * 一轮的抽签：种子 = 开奖块哈希前 8 位（十六进制）。
 * v2：从活狗里等概率抽 n = round(活狗数 × killRate) 只（至少 1、至少留 1），没有事件 / 带走 / 盾。
 * v1：见下方原实现（按被砸次数加权、随机事件、带走），逐行别改。
 */
export function planRound(hash: string, round: number, alive: RoyaleDog[], cfg: Pick<RoyaleConfig, 'version' | 'killRate'>): RoyaleRoundPlan {
  const r = rngFrom(parseInt(hash.slice(0, 8), 16))
  if (!royaleHasActions(cfg)) {
    const n = Math.min(Math.max(1, Math.round(alive.length * cfg.killRate)), alive.length - 1)
    const pool = alive.slice()
    const results: RoyaleRoundPlan['results'] = []
    for (let i = 0; i < n; i++) results.push({ v: pool.splice(Math.floor(r() * pool.length), 1)[0], killer: null, line: 0 })
    return { event: null, results, lucky: [] }
  }
  const killRate = cfg.killRate
  let event: RoyaleEvent | null = null
  if (round >= 2 && alive.length > 3 && r() < 0.24) event = pick<RoyaleEvent>(['drop', 'rain', 'calm', 'double'], r)
  let n = event === 'calm' ? 0 : Math.max(1, Math.round(alive.length * killRate))
  if (event === 'double') n *= 2
  n = Math.min(n, alive.length - 1)
  const pool = alive.slice()
  const victims: RoyaleDog[] = []
  for (let i = 0; i < n; i++) {
    const w = pool.map((d) => 1 + 0.75 * d.heat + (d.kills >= 2 ? 0.5 : 0))
    let x = r() * w.reduce((a, b) => a + b, 0)
    let k = 0
    while (k < w.length - 1 && x >= w[k]) x -= w[k++]
    victims.push(pool.splice(k, 1)[0])
  }
  const seats = alive.slice().sort((a, b) => a.no - b.no)
  const first = Math.floor(r() * seats.length)
  const lucky = event === 'drop' ? [seats[first], seats[(first + 1 + Math.floor(r() * (seats.length - 1))) % seats.length]] : []
  // 字段顺序决定 r() 的调用顺序（killer 先、line 后），别调换
  const results = victims.map((v) => ({ v, killer: pool.length && r() < 0.65 ? pick(pool, r) : null, line: r() }))
  return { event, results, lucky }
}

const byHeight = (a: { h: number | null; tx: string }, b: { h: number | null; tx: string }) =>
  (a.h as number) - (b.h as number) || (a.tx < b.tx ? -1 : a.tx > b.tx ? 1 : 0)

/** 下一场截止：至少留 minOpen 块报名，取 grid 的整数倍 */
export function nextCutoff(h: number, cfg: Pick<RoyaleConfig, 'grid' | 'minOpen'>): number {
  return Math.ceil((h + cfg.minOpen) / cfg.grid) * cfg.grid
}

/** 推一场 */
export function derive(cfg: RoyaleConfig, data: RoyaleChainData): RoyaleOutcome {
  if (!Number.isInteger(cfg.version) || cfg.version < 1) throw new Error(`规则版本号不对：${cfg.version}`)
  const tip = data.tip
  const C = cfg.cutoff, CONF = cfg.conf, WINDOW = cfg.window
  const pool = cfg.pool
  const players = cfg.players ? new Set(cfg.players) : null
  const out: RoyaleOutcome = { tip, phase: 'lobby', dogs: [], rounds: [], txs: [], owed: [], needHash: null, pot: ZERO, prizes: [], rollover: null, nextC: null, key: { cutoff: C, publish: C + CONF } }

  // 入池转账：只认发给奖池、已入库的。归属：门票看 (上一场截止, 本场截止]，截止后的门票留给下一场；
  // 其余（动作 / 金额不对 / 链上失败）看 (上一场终局, 本场终局]，终局后的归下一场
  const isTicket = (t: RoyaleTx) => t.ok && !t.info.bad && t.info.kind === 'ticket'
  const inbound: RoyaleTx[] = data.inbound
    .filter((t) => t.to === pool && (!players || players.has(t.from)) && t.h !== null && t.h <= tip)
    .map((t): RoyaleTx => ({
      ...t,
      h: t.h as number,
      st: 'seen',
      reason: '',
      why: null,
      amtText: fromUnits(t.amt),
      info: t.ok ? decode(t.amt, cfg) : bad('链上执行失败，钱没进奖池', { code: 'chainFailed' }),
    }))
    .filter((t) => t.h > (isTicket(t) ? cfg.ticketFrom : cfg.actFrom))
    .sort(byHeight)
  out.txs = inbound
  const refund = (t: RoyaleTx, reason: string, why: RoyaleReason) => { t.st = 'refund'; t.reason = reason; t.why = why }
  const fail = (t: RoyaleTx) => { t.st = 'failed'; t.reason = t.info.bad ?? ''; t.why = t.info.bad !== undefined ? t.info.why : null }

  // 门票
  const seats: RoyaleTx[] = []
  for (const t of inbound) {
    if (!t.ok) { fail(t); continue }
    if (t.info.bad !== undefined) { refund(t, t.info.bad, t.info.why); continue }
    if (t.info.kind !== 'ticket') continue
    if (t.h > C) { t.st = 'next'; t.reason = `打包在 ${t.h}，晚于截止 ${C}，算下一场的门票`; t.why = { code: 'nextTicket', params: { h: t.h, cutoff: C } } }
    else if (seats.some((s) => s.from === t.from)) refund(t, '同一地址的第二张门票', { code: 'dupTicket' })
    else if (seats.length >= cfg.maxSeats) refund(t, `满 ${cfg.maxSeats} 只，尾数放不下更多狗号`, { code: 'full', params: { max: cfg.maxSeats } })
    else { t.st = 'seat'; seats.push(t) }
  }
  out.dogs = seats.map((t, i) => ({ no: i + 1, addr: t.from, alive: true, shield: 0, heat: 0, kills: 0, revived: false, killer: null, outRound: 0, ticketTx: t.tx }))
  const actions = inbound.filter((t) => t.st === 'seen' && t.info.kind && t.info.kind !== 'ticket')
  for (const t of actions) {
    const info = t.info as { kind: RoyaleActionKind; session: number; no: number }
    if (info.session !== cfg.session % 100) refund(t, `尾数场次是 ${two(info.session)}，本场是 ${two(cfg.session)}`, { code: 'wrongSession', params: { got: two(info.session), want: two(cfg.session) } })
    else if (t.h <= C + CONF) refund(t, `打包在 ${t.h}，名单 ${C + CONF} 才公布`, { code: 'beforeRoster', params: { h: t.h, publish: C + CONF } })
  }

  // 奖池起点 = 结转 + 已收门票；开打时满 bigRoom 再加保底。报名期 / 等名单时就展示这个数（取消则全退、奖池为 0）
  const ticketsPot = toUnits(cfg.rollover) + BigInt(cfg.ticket) * UNIT * BigInt(seats.length)
  if (tip < C) { out.phase = 'lobby'; out.pot = ticketsPot; return finishOwed(out, cfg) }
  if (tip < C + CONF) { out.phase = 'roster'; out.pot = ticketsPot; return finishOwed(out, cfg) }
  if (seats.length < cfg.minDogs) {
    out.phase = 'cancelled'
    out.endH = C + CONF
    seats.forEach((t) => refund(t, `截止时 ${seats.length} 只，不够 ${cfg.minDogs} 只，本场取消`, { code: 'cancelledTicket', params: { count: seats.length, min: cfg.minDogs } }))
    actions.filter((t) => t.st === 'seen').forEach((t) => refund(t, '本场取消', { code: 'cancelled' }))
    return finishOwed(out, cfg)
  }

  // 开打
  out.phase = 'live'
  const dogs = out.dogs
  const byNo = (no: number) => dogs.find((d) => d.no === no)
  const byAddr = (a: string) => dogs.find((d) => d.addr === a)
  let pot = ticketsPot
  out.floorPaid = seats.length >= cfg.bigRoom ? cfg.floor : 0
  pot += BigInt(out.floorPaid) * UNIT
  const order: RoyaleDog[] = [] // 出局顺序
  let start = C + CONF + 1, R = C + CONF + WINDOW, round = 1
  for (; round < 500; round++) {
    const win = actions.filter((t) => t.st === 'seen' && t.h >= start && t.h < R)
    const rd: RoyaleRound = { round, start, R, hash: null, txs: win, event: null, kills: [], blocked: [], lucky: [], revived: [] }
    out.rounds.push(rd)
    out.key.R = R
    if (tip < R + CONF) { win.forEach((t) => { t.st = 'pending'; t.reason = `等开奖块 ${R}`; t.why = { code: 'waitDraw', params: { R } } }); break }
    const hash = data.hashes[R]
    if (!hash) { out.needHash = R; win.forEach((t) => { t.st = 'pending'; t.reason = `等开奖块 ${R} 的哈希`; t.why = { code: 'waitHash', params: { R } } }); break }
    rd.hash = hash
    for (const t of win) {
      const info = t.info as { kind: RoyaleActionKind; session: number; no: number }
      const k = info.kind, d = byNo(info.no), owner = byAddr(t.from), late = round >= cfg.lastBuyRound
      let text = ''
      let why: RoyaleReason | null = null
      const no = (s: string, w: RoyaleReason) => { text = s; why = w }
      if (!owner) no('发送地址不在本场名单', { code: 'notInRoster' })
      else if (!d) no(`本场没有 ${info.no} 号狗`, { code: 'noSuchDog', params: { no: info.no } })
      else if (k === 'bonk') {
        if (!owner.alive) no('自己的狗已出局，不能再砸', { code: 'ownDogOut' })
        else if (owner === d) no('不能砸自己', { code: 'bonkSelf' })
        else if (!d.alive) no('生效时目标已出局', { code: 'targetOut' })
      } else if (owner !== d) no('只能动自己的狗', { code: 'notOwner' })
      else if (k === 'shield') {
        if (!d.alive) no('生效时狗已出局', { code: 'dogOut' })
        else if (late) no(`第 ${cfg.lastBuyRound} 轮起只能砸`, { code: 'lateRound', params: { round: cfg.lastBuyRound } })
        else if (d.shield >= 2) no('盾已满 2 层', { code: 'shieldFull' })
      } else {
        if (d.alive) no('狗还活着', { code: 'stillAlive' })
        else if (d.revived) no('本局已经爬回来过', { code: 'revivedOnce' })
        else if (late) no(`第 ${cfg.lastBuyRound} 轮起只能砸`, { code: 'lateRound', params: { round: cfg.lastBuyRound } })
      }
      if (text) { refund(t, text, why as unknown as RoyaleReason); continue }
      const dog = d as RoyaleDog
      t.st = 'counted'; t.round = round
      pot += t.amt
      if (k === 'shield') dog.shield++
      if (k === 'bonk') dog.heat++
      if (k === 'revive') {
        dog.alive = true; dog.revived = true; dog.heat = 0; dog.outRound = 0
        rd.revived.push(dog.no)
        const i = order.indexOf(dog)
        if (i >= 0) order.splice(i, 1)
      }
    }
    const alive = dogs.filter((d) => d.alive)
    const plan = planRound(hash, round, alive, cfg)
    rd.event = plan.event
    if (plan.event === 'drop' && plan.lucky.length === 2) { plan.lucky.forEach((d) => { d.shield = Math.min(2, d.shield + 1) }); rd.lucky = plan.lucky.map((d) => d.no) }
    if (plan.event === 'rain') alive.forEach((d) => { d.shield = 0 })
    for (const { v, killer } of plan.results) {
      if (v.shield > 0) { v.shield--; rd.blocked.push(v.no); continue }
      v.alive = false; v.killer = killer?.no ?? null; v.outRound = round
      if (killer) killer.kills++
      order.push(v)
      rd.kills.push({ no: v.no, by: killer?.no ?? null })
    }
    dogs.forEach((d) => { d.heat = 0 })
    const left = dogs.filter((d) => d.alive)
    if (left.length === 1) {
      out.champ = left[0].no
      out.endR = R
      out.endH = R
      const endR = R
      actions.filter((t) => t.st === 'seen' && t.h >= endR).forEach((t) => refund(t, `落在终局开奖块 ${endR}`, { code: 'afterFinal', params: { R: endR } }))
      const ranked = [left[0], ...order.slice().reverse()]
      const bps = seats.length < cfg.bigRoom ? [9000] : [5000, 2500, 1500]
      out.prizes = bps.map((b, i) => ({ no: ranked[i].no, addr: ranked[i].addr, amt: (pot * BigInt(b)) / BigInt(10000), label: ['冠军', '亚军', '季军'][i], rank: i }))
      out.rollover = pot - out.prizes.reduce((a, p) => a + p.amt, ZERO)
      out.phase = 'over'
      break
    }
    start = R
    R = R + CONF + WINDOW
  }
  out.pot = pot
  out.round = round
  return finishOwed(out, cfg)
}

// 本场应付：奖金 + 退款（记入各地址待领取，由 series 的 ledger 按地址汇总）。
// 一场出结果（有冠军）或取消即结束：settledH = endH，下一场截止由它推出——不等任何转出。
function finishOwed(out: RoyaleOutcome, cfg: RoyaleConfig): RoyaleOutcome {
  const tip = out.tip
  const endH = out.endH
  if (endH !== undefined) out.txs = out.txs.filter((t) => t.st === 'next' || t.st === 'seat' || (t.st === 'refund' && t.info.kind === 'ticket' && t.h <= cfg.cutoff) || t.h <= endH)
  const owed: RoyaleOwed[] = []
  for (const p of out.prizes) owed.push({ kind: 'prize', label: `${p.label}（${p.no} 号）`, to: p.addr, amt: p.amt, ready: true, rank: p.rank, no: p.no })
  for (const t of out.txs.filter((x) => x.st === 'refund')) {
    owed.push({
      kind: 'refund',
      label: `退回${t.info.kind ? ROYALE_LABEL[t.info.kind] : ''}：${t.reason}`,
      to: t.from, amt: t.amt, src: t.tx, ready: tip >= t.h + cfg.conf,
      refundKind: t.info.kind ?? null, why: t.why,
    })
  }
  out.owed = owed
  if ((out.phase === 'over' || out.phase === 'cancelled') && endH !== undefined) {
    out.settledH = endH
    out.nextC = nextCutoff(endH, cfg)
  }
  return out
}

/** 台账里的一条应付明细（带赛季与场次号） */
export interface RoyaleLedgerItem extends RoyaleOwed {
  season: number
  session: number
}

/** 一个地址的待领取台账（全部 WDOGE 最小单位） */
export interface RoyaleLedgerRow {
  addr: string
  /** 已可领的应付合计（ready） */
  earned: bigint
  /** 还不能领的应付合计（退款未压满 conf 块） */
  pending: bigint
  /** 奖池已转给该地址的合计（领取 / 运营转出） */
  claimed: bigint
  /** max(earned − claimed, 0) */
  claimable: bigint
  /** max(claimed − earned, 0)：转多了 / 转给不该转的地址 */
  over: bigint
  items: RoyaleLedgerItem[]
  /** 计入 claimed 的奖池转出 */
  claims: RoyaleTransfer[]
}

/**
 * 换季：上一季在第 afterSession 场出结果 / 取消后结束，新一季从第 1 场重新数、换用自己的规则版本表。
 * 衔接与季内一样（门票从上一季最后一场截止后算、动作从它的终局后算、顺延奖池带过来），只有第 1 场的截止由这里给
 * ——所以上一季最后一场之后已经转进来的门票直接算新一季第 1 场。奖池 / 名单不变，台账跨季合计。
 */
export interface RoyaleSeasonBreak {
  afterSession: number
  /** 新一季第 1 场的报名截止（须晚于上一季最后一场的终局） */
  cutoff: number
  versions: readonly RoyaleRuleVersion[]
}

export interface RoyaleSeries {
  /** 全部场次（旧 → 新，跨季）；season 从 firstSeason（默认 1）数 */
  sessions: { season: number; cfg: RoyaleConfig; out: RoyaleOutcome }[]
  /** 当前场所在的赛季与它的规则版本表（没给 versions 时为 null） */
  season: number
  versions: readonly RoyaleRuleVersion[] | null
  /** 当前场 */
  cfg: RoyaleConfig
  out: RoyaleOutcome
  needHash: number | null
  /** 按地址的待领取台账：claimable 降序，再按地址 */
  ledger: RoyaleLedgerRow[]
}

// 多场衔接：一场结束（有冠军）或取消后，下一场随即接上（截止 = nextC，门票从上一场截止后算，动作从上一场终局后算）。
// 每场的规则按所在赛季的 versions 取（rulesAt）；不给 versions = 全程沿用 first 的规则。seasons 依次给出各次换季。
// 奖金 / 退款不逐笔对账，按地址记账：应付（跨场跨季，含当前场）对奖池转给该地址的全部转出。
// 推演一直走到当前场（截止还没到 tip 的那场一定停在报名期），场数不设默认上限：每场截止严格晚于上一场，
// 场数天然不超过 tip − 第 1 场截止 + 1。maxSessions 只作调用方自己的保险，走满了仍没到当前场即抛错——
// 别把半截结果当当前场返回（曾默认 200 场，v2 每 10 块一场，约 2000 块后页面停在第 200 场不再推进）。
export function series(
  first: RoyaleConfig,
  data: RoyaleChainData,
  opts: {
    versions?: readonly RoyaleRuleVersion[]
    seasons?: readonly RoyaleSeasonBreak[]
    maxSessions?: number
    resume?: RoyaleSeries
    /** first 所在赛季的编号（只用于标注 sessions / 台账明细的 season，默认 1；seasons[0] 是它之后的第一次换季） */
    firstSeason?: number
  } = {},
): RoyaleSeries {
  const { seasons = [], maxSessions = Infinity, firstSeason = 1 } = opts
  if (!(maxSessions >= 1)) throw new Error(`maxSessions 不对：${maxSessions}`)
  if (!Number.isInteger(firstSeason) || firstSeason < 1) throw new Error(`firstSeason 不对：${firstSeason}`)
  let versions = opts.versions ?? null
  if (versions) checkRuleVersions(versions)
  for (const b of seasons) {
    checkRuleVersions(b.versions)
    if (b.versions[0].fromSession !== 1) throw new Error('新一季的规则版本表要从第 1 场起')
    if (!Number.isInteger(b.afterSession) || b.afterSession < 1 || !Number.isInteger(b.cutoff)) throw new Error('换季参数不对')
  }
  const withRules = (vs: readonly RoyaleRuleVersion[] | null, c: RoyaleConfig): RoyaleConfig => (vs ? { ...c, ...rulesAt(vs, c.session).rules } : c)
  // 下一场：同季接续，或按换季参数进入新一季第 1 场
  const following = (season: number, cfg: RoyaleConfig, out: RoyaleOutcome) => {
    const carry = { ticketFrom: cfg.cutoff, actFrom: out.endH as number, rollover: out.phase === 'over' ? fromUnits(out.rollover as bigint) : cfg.rollover }
    const brk = seasons[season - firstSeason]
    let next: { season: number; versions: readonly RoyaleRuleVersion[] | null; cfg: RoyaleConfig }
    if (brk && brk.afterSession === cfg.session) {
      if (brk.cutoff <= carry.actFrom) throw new Error(`第 ${season + 1} 季第 1 场的截止（${brk.cutoff}）须晚于上一季最后一场的终局（${carry.actFrom}）`)
      next = { season: season + 1, versions: brk.versions, cfg: withRules(brk.versions, { ...cfg, ...carry, session: 1, cutoff: brk.cutoff }) }
    } else {
      next = { season, versions, cfg: withRules(versions, { ...cfg, ...carry, session: cfg.session + 1, cutoff: out.nextC as number }) }
    }
    if (!(next.cfg.cutoff > cfg.cutoff)) throw new Error(`下一场截止（${next.cfg.cutoff}）没有晚于上一场（${cfg.cutoff}）`)
    return next
  }
  // 每场只把可能用到的一段入池转账交给 derive（全表按高度排一次），推演量随场数线性增长——
  // 曾每场都把全部转账解码一遍，场数 × 转账数，测试数据下 7 天 1.5s、30 天 25s。
  // 下界：门票 / 动作起点（ticketFrom ≤ actFrom 逐场递增）。上界：一场结束前的判定只用到高度 ≤ 终局 endH 的转账，
  // 下一场截止又晚于 endH，所以只要上界 ≥ 下一场截止，结果就与整表推演相同；不够就放宽重推。
  // 已结束的场次只列到下一场截止为止的迟到门票（它们入座下一场）；再往后的门票属于更后面的场次，不列。
  const sorted = data.inbound.filter((t) => t.h !== null && t.h <= data.tip).sort(byHeight)
  const above = (h: number) => {
    let lo = 0, hi = sorted.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if ((sorted[mid].h as number) > h) hi = mid; else lo = mid + 1 }
    return lo
  }
  // resume：同一个 first / opts / data 上一次的结果（data 只多了它要的开奖块哈希）——沿用已结束的场次，从它停下的那场接着推，
  // 补哈希时不必每补一个都从第 1 场重推。data 有别的变化（新区块、新转账）时别传。
  const sessions: RoyaleSeries['sessions'] = opts.resume ? opts.resume.sessions.slice(0, -1) : []
  let season = opts.resume ? opts.resume.season : firstSeason
  if (opts.resume) versions = opts.resume.versions
  let cfg = opts.resume ? opts.resume.cfg : withRules(versions, first)
  for (;;) {
    const lo = above(Math.min(cfg.ticketFrom, cfg.actFrom))
    let span = 64
    let out: RoyaleOutcome
    let next: ReturnType<typeof following> | null = null
    for (;;) {
      next = null
      const hi = above(cfg.cutoff + span)
      out = derive(cfg, { ...data, inbound: sorted.slice(lo, hi) })
      const whole = hi === sorted.length
      if (out.needHash !== null || (out.phase !== 'over' && out.phase !== 'cancelled')) {
        if (whole) break
        span = Infinity
        continue
      }
      next = following(season, cfg, out)
      if (whole || next.cfg.cutoff <= cfg.cutoff + span) break
      span *= 4
    }
    sessions.push({ season, cfg, out })
    if (!next) break
    const nextCutoff = next.cfg.cutoff
    out.txs = out.txs.filter((t) => t.st !== 'next' || t.h <= nextCutoff)
    if (sessions.length >= maxSessions) throw new Error(`推演了 ${maxSessions} 场仍未到当前场（maxSessions 太小）`)
    season = next.season
    versions = next.versions
    cfg = next.cfg
  }
  const last = sessions[sessions.length - 1]
  return { sessions, season: last.season, versions, cfg: last.cfg, out: last.out, needHash: last.out.needHash, ledger: ledger(first, data, sessions) }
}

function ledger(first: RoyaleConfig, data: RoyaleChainData, sessions: RoyaleSeries['sessions']): RoyaleLedgerRow[] {
  const rows = new Map<string, RoyaleLedgerRow>()
  const row = (addr: string) => {
    let r = rows.get(addr)
    if (!r) { r = { addr, earned: ZERO, pending: ZERO, claimed: ZERO, claimable: ZERO, over: ZERO, items: [], claims: [] }; rows.set(addr, r) }
    return r
  }
  for (const { season, cfg, out } of sessions) {
    for (const o of out.owed) {
      const r = row(o.to)
      r.items.push({ ...o, season, session: cfg.session })
      if (o.ready) r.earned += o.amt
      else r.pending += o.amt
    }
  }
  const outs = data.outbound.filter((t) => t.from === first.pool && t.ok && t.h !== null && t.h <= data.tip && t.h > first.ticketFrom).sort(byHeight)
  for (const t of outs) {
    const r = row(t.to)
    r.claimed += t.amt
    r.claims.push(t)
  }
  for (const r of rows.values()) {
    r.claimable = r.earned > r.claimed ? r.earned - r.claimed : ZERO
    r.over = r.claimed > r.earned ? r.claimed - r.earned : ZERO
  }
  return [...rows.values()].sort((a, b) => (a.claimable > b.claimable ? -1 : a.claimable < b.claimable ? 1 : a.addr < b.addr ? -1 : a.addr > b.addr ? 1 : 0))
}

// ---------------------------------------------------------------- 参与：当前地址此刻能做什么

export interface RoyaleMove {
  kind: RoyaleKind
  /** 目标狗号（门票没有） */
  no: number | null
  /** 钱包要转的 WDOGE 十进制金额 */
  amount: string
}

/** 该狗在当前轮里还在等开奖的动作数（按类型） */
export function pendingActions(out: RoyaleOutcome, no: number, kind: RoyaleActionKind, from?: string): number {
  const open = out.phase === 'live' ? out.rounds[out.rounds.length - 1] : null
  if (!open) return 0
  return open.txs.filter((t) => t.st === 'pending' && t.info.kind === kind && t.info.no === no && (from === undefined || t.from === from)).length
}

/**
 * 当前地址此刻按规则能转的单（页面一键转账 / 手动金额都只给这些）：
 * - 报名中（tip < 截止）：该地址这一场还没有门票 → 门票；
 * - 开打后：当前轮窗口还没收（下一块仍 < 开奖块）且该地址有狗——
 *   自己的狗活着：加盾（第 lastBuyRound 轮前，已有 + 待生效 < 2）、砸别的活狗；
 *   自己的狗出局：爬回来（一局一次、第 lastBuyRound 轮前、没有待生效的）。
 * 没有动作的规则（v2）开打后什么都不给。不在名单（cfg.players）的地址什么都不给。
 */
export function royaleMoves(cfg: RoyaleConfig, out: RoyaleOutcome, address: string | null): RoyaleMove[] {
  if (!address || (cfg.players && !cfg.players.includes(address))) return []
  if (out.phase === 'lobby') {
    const has = out.txs.some((t) => t.from === address && t.info.kind === 'ticket' && (t.st === 'seat' || t.st === 'next'))
    return has ? [] : [{ kind: 'ticket', no: null, amount: ticketAmount(cfg) }]
  }
  if (out.phase !== 'live' || !royaleHasActions(cfg)) return []
  const open = out.rounds[out.rounds.length - 1]
  if (!open || open.hash !== null || out.tip + 1 >= open.R) return []
  const mine = out.dogs.find((d) => d.addr === address)
  if (!mine) return []
  const late = open.round >= cfg.lastBuyRound
  const moves: RoyaleMove[] = []
  if (mine.alive) {
    if (!late && mine.shield + pendingActions(out, mine.no, 'shield', address) < 2) {
      moves.push({ kind: 'shield', no: mine.no, amount: walletAmount(cfg.shield, cfg.session, mine.no, 'shield') })
    }
    for (const d of out.dogs) {
      if (d !== mine && d.alive) moves.push({ kind: 'bonk', no: d.no, amount: walletAmount(cfg.bonk, cfg.session, d.no, 'bonk') })
    }
  } else if (!mine.revived && !late && pendingActions(out, mine.no, 'revive', address) === 0) {
    moves.push({ kind: 'revive', no: mine.no, amount: walletAmount(cfg.revive, cfg.session, mine.no, 'revive') })
  }
  return moves
}
