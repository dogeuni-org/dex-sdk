// 狗狗大逃杀 · prize-v1 奖池赛季：门票 = 对 prize 池的 deposit，奖金 / 退款 = 结算方按引擎台账公布的累计可领额，用户自己 claim。
// 网页与结算方共用这里的映射（存入 → 引擎入池转账、第 1 场参数），保证两边按同一份数据推出同一个结果。
import type { RoyaleConfig, RoyaleRuleVersion, RoyaleTransfer } from './engine.ts'
import { checkRuleVersions, rulesAt, royaleHasActions } from './engine.ts'

/** 接 prize 池的那一季：第 1 场的衔接参数 + 规则版本表 + 确认深度 */
export interface RoyalePrizeSeason {
  /** 赛季编号（接在转账奖池的各季之后；只用于展示与 memo） */
  season: number
  /** prize-v1 奖池 id（64 位 hex） */
  poolId: string
  /** 第 1 场报名截止 */
  cutoff: number
  /** 门票只认高度 > ticketFrom 的存入 */
  ticketFrom: number
  /** 错单只认高度 > actFrom 的存入 */
  actFrom: number
  /** 规则版本表（从第 1 场起；只能用没有动作、floor 为 0 的版本） */
  versions: readonly RoyaleRuleVersion[]
  /** 一场终局后至少压多少块才算定了（结算方据此公布累计可领额；≥ 各版本 conf） */
  confirmations: number
}

const POOL_ID_RE = /^[0-9a-f]{64}$/

/** 校验赛季参数（不合法即抛错）：截止晚于起点、规则从第 1 场起且没有动作 / 保底、确认深度不小于 conf */
export function checkPrizeSeason(s: RoyalePrizeSeason): void {
  if (!Number.isInteger(s.season) || s.season < 1) throw new Error(`prize 赛季编号不对：${s.season}`)
  if (!POOL_ID_RE.test(s.poolId)) throw new Error(`prize 池 id 不对：${s.poolId}`)
  for (const k of ['cutoff', 'ticketFrom', 'actFrom', 'confirmations'] as const) {
    if (!Number.isSafeInteger(s[k]) || s[k] < 0) throw new Error(`prize 赛季参数 ${k} 不对：${s[k]}`)
  }
  if (!(s.ticketFrom < s.cutoff && s.actFrom < s.cutoff)) throw new Error('prize 赛季要求 ticketFrom < cutoff 且 actFrom < cutoff')
  checkRuleVersions(s.versions)
  if (s.versions[0].fromSession !== 1) throw new Error('prize 赛季的规则版本表要从第 1 场起')
  for (const v of s.versions) {
    // 有动作的规则在截止后还要收钱，floor 不是存入、池里付不出——都不能接 prize 池
    if (royaleHasActions(v.rules)) throw new Error(`规则 v${v.rules.version} 有动作，不能用于 prize 赛季`)
    if (v.rules.floor !== 0) throw new Error(`规则 v${v.rules.version} 有保底，不能用于 prize 赛季`)
  }
  const minConf = Math.max(...s.versions.map((v) => v.rules.conf))
  if (s.confirmations < minConf) throw new Error(`prize 赛季的 confirmations（${s.confirmations}）不能小于规则的 conf（${minConf}）`)
}

/** prize 赛季第 1 场（引擎的 pool = prize 池 id，存入映射成发往它的转账；之后每场由 series 接续） */
export function royalePrizeFirst(s: RoyalePrizeSeason): RoyaleConfig {
  return {
    ...rulesAt(s.versions, 1).rules,
    pool: s.poolId,
    players: null,
    session: 1,
    cutoff: s.cutoff,
    ticketFrom: s.ticketFrom,
    actFrom: s.actFrom,
    rollover: '0',
  }
}

/** prize 池的一笔存入（节点只记执行成功的 deposit；refunded = 已经退回、钱不在池里） */
export interface RoyalePrizeDeposit {
  /** reveal txid */
  tx_hash: string
  block_number: number
  address: string
  /** 最小单位整数串 */
  amt: string
  state: string
}

/** 存入 → 引擎的入池转账（跳过已退回的；同一 tx 出现两次即抛错） */
export function royalePrizeInbound(poolId: string, deposits: readonly RoyalePrizeDeposit[]): RoyaleTransfer[] {
  const seen = new Set<string>()
  const out: RoyaleTransfer[] = []
  for (const d of deposits) {
    if (seen.has(d.tx_hash)) throw new Error(`重复的存入：${d.tx_hash}`)
    seen.add(d.tx_hash)
    if (d.state === 'refunded') continue
    if (!/^\d+$/.test(d.amt)) throw new Error(`存入金额不对：${d.amt}`)
    out.push({ tx: d.tx_hash, from: d.address, to: poolId, amt: BigInt(d.amt), h: d.block_number, ok: true })
  }
  return out
}

/** 门票存入的 memo（只作审计，引擎按金额判门票）：`royale:<季>:<场>` */
export function royalePrizeMemo(season: number, session: number): string {
  return `royale:${season}:${session}`
}
