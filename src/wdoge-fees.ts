// WDOGE deposit / withdraw 服务费与钱包花费（原生 DOGE，sat 整数串）。

// deposit：max(floor(amt × 3 / 1000), 0.5 DOGE)。来源 @cardinals_org/keyring 的 calculateFee
// （Math.max(Math.floor(amount*3/1e3), 5e7)）：钱包 reveal tx 除 amt 外，另给 WDOGE fee 地址打这一笔 DOGE。
// withdraw：keyring reveal tx 固定给平台 fee 地址 0.5 DOGE（与 drc-20 / pair-v1 同一分支）。
export const WDOGE_MIN_SERVICE_FEE_SATS = '50000000'
export const WDOGE_WITHDRAW_FEE_SATS = '50000000'

export function wdogeDepositFeeSats(amtSats: string): string {
  const pct = BigInt(amtSats) * BigInt(3) / BigInt(1000)
  const min = BigInt(WDOGE_MIN_SERVICE_FEE_SATS)
  return (pct >= min ? pct : min).toString()
}

export function wdogeServiceFeeSats(kind: 'deposit' | 'withdraw', amtSats: string): string {
  return kind === 'deposit' ? wdogeDepositFeeSats(amtSats) : WDOGE_WITHDRAW_FEE_SATS
}

// 用原生 DOGE 支付的 swap（payload doge=1、tick0 / tick0_id = WDOGE，indexer 记为 deposit-swap）与 deposit 同一套花费：
// 钱包 calculateTotalSpend 对 doge=1 的 WDOGE 输入一律 processWDOGE(amt0)——amt0 打进 WDOGE 冷钱包，
// 另付同一笔 calculateFee(amt0) 服务费；输出为原生 DOGE（doge=1、tick1 = WDOGE）的 swap 不收这笔费。
// doge=0 时花的是 WDOGE（DRC-20）余额，不经包装、不收这笔费。

// 钱包构造 deposit / 原生 DOGE 支付的 swap 时额外花掉的网络开销预留（sat）。
// dogeuni-wallet 的 calculateTotalSpend = amt + calculateFee(amt) + floor(networkFee + 1e5) + networkFee，
// 1e5 是 reveal 输出；余额 < 该总额时 executeInscriptionWithAccount 直接拒绝。networkFee 来自 getDogeFeeRate()
// （dogeuni-wallet src/ui/utils/index.ts:481，chrome.storage 的 feeRate，默认 1e8；FeeRateBar 可选 1e6–1e9）。
// 调用方读不到用户在钱包里选的费率，按默认费率预留 2 × 1e8 + 1e5；用户调高费率时由钱包自己拦下。
export const WALLET_NETWORK_OVERHEAD_SATS = '200100000'

/** deposit / 原生 DOGE 支付的 swap 实际从原生 DOGE 余额里花掉的总额（sat） */
export function depositTotalSpendSats(amtSats: string): string {
  return (BigInt(amtSats) + BigInt(wdogeDepositFeeSats(amtSats)) + BigInt(WALLET_NETWORK_OVERHEAD_SATS)).toString()
}

// 余额 balanceSats 下可 deposit 的最大 amt（sat）：满足 amt + fee(amt) + 网络开销 ≤ 余额的最大整数。
// 设 R = 余额 − 开销，需同时满足 amt + 0.5 DOGE ≤ R 与 amt + floor(3amt/1000) ≤ R。
// 后者的最大解落在 {c − 1, c}，c = floor(1000(R+1)/1003)：a ≤ 1000R/1003 必满足；满足时 floor(3a/1000) > 3a/1000 − 1
// 推出 a < 1000(R+1)/1003 即 a ≤ c；两个界相差 1000/1003 < 1。
// 所以取 cand = min(R − 0.5 DOGE, c)，cand 不满足时 cand − 1 必满足。
export function maxDepositAmountSats(balanceSats: string): string {
  const balance = BigInt(balanceSats)
  const overhead = BigInt(WALLET_NETWORK_OVERHEAD_SATS)
  const minFee = BigInt(WDOGE_MIN_SERVICE_FEE_SATS)
  if (balance <= overhead + minFee) return '0'
  const r = balance - overhead
  const byMinFee = r - minFee
  const byPctFee = (r + BigInt(1)) * BigInt(1000) / BigInt(1003)
  const cand = byMinFee <= byPctFee ? byMinFee : byPctFee
  return BigInt(depositTotalSpendSats(cand.toString())) <= balance ? cand.toString() : (cand - BigInt(1)).toString()
}
