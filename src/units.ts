// 十进制数量 ↔ 链上最小单位整数串（BigInt，精确，永不出科学计数法）。
// 只收字符串：数量从输入框 / 接口原样传进来，经 number 就可能已经失精（> 2^53、0.1 + 0.2 之类）。

import { toBigInt } from './int.ts'

const DECIMAL_RE = /^(\d*)(?:\.(\d*))?$/

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`Invalid decimals: ${String(decimals)}`)
}

/** 十进制串 → 最小单位整数串，超出精度的部分向下截断。接受 `1`、`1.5`、`.5`、`1.`；空串 / 负数 / 科学计数法抛错 */
export function toBaseUnits(amount: string, decimals: number): string {
  assertDecimals(decimals)
  const m = DECIMAL_RE.exec(amount)
  if (!m || (m[1] === '' && !m[2])) throw new Error(`Invalid decimal amount: ${JSON.stringify(amount)}`)
  const frac = (m[2] ?? '').slice(0, decimals).padEnd(decimals, '0')
  return BigInt((m[1] || '0') + frac).toString()
}

/** 最小单位整数串 → 十进制串（去掉小数尾零，整数不带小数点） */
export function fromBaseUnits(units: string, decimals: number): string {
  assertDecimals(decimals)
  const digits = toBigInt(units, 'units').toString().padStart(decimals + 1, '0')
  const int = digits.slice(0, digits.length - decimals)
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

/** floor(a × b ÷ c)，三者都是非负整数串；c 为 0 时返回 '0'（空池 / 零份额） */
export function mulDivFloor(a: string, b: string, c: string): string {
  const den = toBigInt(c, 'c')
  if (den === BigInt(0)) return '0'
  return ((toBigInt(a, 'a') * toBigInt(b, 'b')) / den).toString()
}
