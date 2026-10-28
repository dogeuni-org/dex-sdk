// 内部：非负整数串 → BigInt（不经 index 导出）。金额全程只收字符串，非法即抛错，别猜。
const INTEGER_RE = /^\d+$/

export function toBigInt(value: string, name: string): bigint {
  if (typeof value !== 'string' || !INTEGER_RE.test(value)) {
    throw new Error(`${name} must be a non-negative integer string: ${JSON.stringify(value)}`)
  }
  return BigInt(value)
}
