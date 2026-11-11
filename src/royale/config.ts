// 狗狗大逃杀 · 参数的唯一来源（规则在 ./engine.ts）。
// 只写第 1 场；之后每场由引擎 series 按链上数据自动接续（上一场结束 / 取消即接上，截止 = 上一场终局后至少 minOpen 块的 grid 整数倍）。
// 规则按场次分版本（ROYALE_RULES）：已有版本一个数都别改——改了旧场次复算出的结果就变了。
// 要改规则就在表尾加一个版本（version + 1），fromSession 取还没开始收门票的场次：
// 当前场还在报名（截止前）→ 至少 当前场 + 1；当前场已过截止（下一场的门票已在收）→ 至少 当前场 + 2。
// 判定逻辑要变时，在引擎里按 cfg.version 分支，旧版本走原来的代码。
// 奖池地址 / 起始场 / 发送方名单不属于规则版本，改它们等于另起一套「新的第 1 场」。
// 场次从 1 重新数而账要接着算时用换季（ROYALE_SEASONS，只追加）：上一季到某场为止，新一季带自己的规则表从第 1 场起。
import type { RoyaleConfig, RoyaleRules, RoyaleRuleVersion, RoyaleSeasonBreak } from './engine.ts'
import type { RoyalePrizeSeason } from './prize.ts'

/** 奖池地址：门票 / 动作的 WDOGE 转到这里，奖金与退款从这里领取 / 转出 */
export const ROYALE_POOL = 'DS91v11ASuZmQL3Yu6NqDeDXp9rQuc19T3'

/** 收付用的 DRC-20 代币（WDOGE 原样 tick） */
export const ROYALE_TICK = 'WDOGE(WRAPPED-DOGE)'

/**
 * 只认这些地址发出的入池转账；null = 任何地址都认（现状）。
 * 测试期（2026-11-07 至 2026-11-11）曾写死 2 个地址：当时 dex-api 只能按发送方查转账，看不到名单外的入账。
 * dex-api 加了按收款方查询（`/drc20/info/to/:to_address`）后改为 null，读链改按奖池查入账；
 * 测试期奖池收到的 WDOGE 转账全部来自原名单的 2 个地址，所以改 null 不改变任何已结束场次的复算结果。
 */
export const ROYALE_PLAYERS: readonly string[] | null = null

/** 第 1 季的规则版本表（按场次生效，只追加；第 1 季在第 9 场后结束，v2@11 没有用上，v2 实际从第 2 季第 1 场起用） */
export const ROYALE_RULES: readonly RoyaleRuleVersion[] = [
  {
    fromSession: 1,
    rules: {
      version: 1,
      ticket: 1,
      shield: 1,
      bonk: 1,
      revive: 2,
      minDogs: 2,
      maxSeats: 99,
      bigRoom: 10,
      floor: 0,
      conf: 2,
      window: 3,
      lastBuyRound: 6,
      killRate: 0.33,
      grid: 720,
      minOpen: 60,
    },
  },
  {
    // v2（2026-11-10 决定去掉动作）：只收整数门票，每轮按开奖块哈希等概率淘汰。
    // shield / bonk / revive / lastBuyRound 在 v2 不用（带尾数的金额一律退回），写 0；其余与 v1 相同。
    // 第 10 场在第 9 场截止（6451920）后已开始收门票，所以从第 11 场起生效。
    // 节奏（2026-11-10 定为「10 分钟一场」，在第 10 场截止 6452640 前改的，v2 尚未用于任何场次）：grid 10、minOpen 3。
    // 2 只狗一轮：终局 = 第 1 轮开奖块 = 截止 + conf + window（5 块，再压 conf 块后算出），下一场截止 = ceil((终局 + 3) / 10) × 10 = 截止 + 10；
    // 空场在截止 + conf 取消，下一场截止同样是截止 + 10。狗多时每多一轮 + 5 块。门票在上一场截止后就算下一场，所以报名不只这 3 块。
    // 下一场截止由上一场自己的规则推出：第 11 场的截止仍按第 10 场（v1）的 720 网格，第 12 场起才按 10 块一场。
    fromSession: 11,
    rules: {
      version: 2,
      ticket: 1,
      shield: 0,
      bonk: 0,
      revive: 0,
      minDogs: 2,
      maxSeats: 99,
      bigRoom: 10,
      floor: 0,
      conf: 2,
      window: 3,
      lastBuyRound: 0,
      killRate: 0.33,
      grid: 10,
      minOpen: 3,
    },
  },
]

/** 第 1 场（规则取 ROYALE_RULES 里第 1 场适用的版本；series 之后每场按版本表重取） */
export const ROYALE_FIRST: RoyaleConfig = {
  pool: ROYALE_POOL,
  players: ROYALE_PLAYERS,
  session: 1,
  cutoff: 6446568,
  ticketFrom: 6446540,
  actFrom: 6446540,
  rollover: '0',
  ...ROYALE_RULES[0].rules,
}

/** 读链的起点：第 1 场之前的转账不读 */
export const ROYALE_SINCE_HEIGHT = ROYALE_FIRST.ticketFrom

/**
 * 换季（只追加；已有条目一个数都别改）。
 * 第 2 季（2026-11-11 决定「线上重新从第一场开始」）：第 1 季在第 9 场（6451925 出结果）后结束，
 * 第 2 季从第 1 场起按 v2（只收门票、10 块一场）。第 1 季第 10 场已收的门票（第 9 场截止 6451920 之后转入）
 * 与第 9 场顺延的奖池直接算第 2 季第 1 场；第 1 季没领的奖金 / 退款仍在台账里（台账跨季合计）。
 */
export const ROYALE_SEASONS: readonly RoyaleSeasonBreak[] = [
  { afterSession: 9, cutoff: 6452100, versions: [{ fromSession: 1, rules: ROYALE_RULES[1].rules }] },
]

/** prize-v1 奖池（2026-11-11 建池，高度 6452714；结算方 DHio9krmo5VLSjY6JbpRLaNfF9HS1XSNek）。WDOGE 只经 deposit 进池 */
export const ROYALE_PRIZE_POOL_ID = '3c16dc89b63b6ff354b9e6d5265350da4547ed02d60e29f30efe14e08484db06'

/** prize 池的储备地址：只由节点记账，直接往这里转 WDOGE 不算存入、永远取不出来 */
export const ROYALE_PRIZE_RESERVE = 'AArHHsGFL2QNXA8NMsCPv5FhpEACMpAWpW'

/**
 * v3（2026-11-11 决定门票 10 WDOGE）：只把门票从 1 改成 10，其余与 v2 相同（判定逻辑走 v2 分支：只收整数门票、没有动作）。
 * 只用于 prize 赛季，不进第 1 季的 ROYALE_RULES。
 */
export const ROYALE_RULES_V3: RoyaleRules = { ...ROYALE_RULES[1].rules, version: 3, ticket: 10 }

/**
 * 第 3 季 = 第一个 prize 赛季（只追加；上线后一个数都别改）。门票改为对 prize 池 deposit（memo `royale:3:<场>`），
 * 奖金 / 退款由结算方按台账公布累计可领额、用户自己 claim。与转账奖池的第 1–2 季是两套独立的推演
 * （奖池、门票来源都不同，不接顺延奖池），所以不写进 ROYALE_SEASONS。
 * 规则 = v3（门票 10 WDOGE、只收整数门票、10 块一场、没有动作、没有保底）；confirmations 6：一场终局后压满 6 块才计入可领额。
 * 高度：原定 ticketFrom 6453000 / cutoff 6453030，因 DEX 余额与奖池记账分叉暂停、开放前（池子 0 笔存入）推迟到 6453700 / 6453730（0.4.1）。
 * 门票：0.4.1 是 v2（1 WDOGE），开放前（池子 0 笔存入）改为 v3（10 WDOGE，0.4.2）。
 */
export const ROYALE_PRIZE_SEASON: RoyalePrizeSeason = {
  season: 3,
  poolId: ROYALE_PRIZE_POOL_ID,
  cutoff: 6453730,
  ticketFrom: 6453700,
  actFrom: 6453700,
  versions: [{ fromSession: 1, rules: ROYALE_RULES_V3 }],
  confirmations: 6,
}
