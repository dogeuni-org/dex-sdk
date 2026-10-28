import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toBaseUnits, fromBaseUnits, mulDivFloor } from '../src/units.ts'

test('toBaseUnits：超出精度向下截断，大额不失精、不出科学计数法', () => {
  assert.equal(toBaseUnits('1', 8), '100000000')
  assert.equal(toBaseUnits('1.5', 8), '150000000')
  assert.equal(toBaseUnits('.5', 8), '50000000')
  assert.equal(toBaseUnits('1.', 8), '100000000')
  assert.equal(toBaseUnits('0.123456789', 8), '12345678')
  assert.equal(toBaseUnits('0.000000001', 8), '0')
  assert.equal(toBaseUnits('007.10', 8), '710000000')
  assert.equal(toBaseUnits('123456789012.123456789', 8), '12345678901212345678')
  assert.equal(toBaseUnits('50000000000000', 8), '5000000000000000000000') // float 写法会输出 5e+21
  assert.equal(toBaseUnits('7.9', 0), '7')
})

test('toBaseUnits：空串 / 负数 / 科学计数法 / 空白 / 非数字抛错', () => {
  for (const bad of ['', '.', '-1', '1e5', ' 1', '1 ', 'abc', '1.2.3', '0x10']) {
    assert.throws(() => toBaseUnits(bad, 8), undefined, JSON.stringify(bad))
  }
  assert.throws(() => toBaseUnits('1', -1))
  assert.throws(() => toBaseUnits('1', 1.5))
})

test('fromBaseUnits：精确十进制、去尾零', () => {
  assert.equal(fromBaseUnits('150000000', 8), '1.5')
  assert.equal(fromBaseUnits('100000000', 8), '1')
  assert.equal(fromBaseUnits('1', 8), '0.00000001')
  assert.equal(fromBaseUnits('0', 8), '0')
  assert.equal(fromBaseUnits('000123', 2), '1.23')
  assert.equal(fromBaseUnits('12345678901212345678', 8), '123456789012.12345678')
  assert.equal(fromBaseUnits('7', 0), '7')
  for (const bad of ['', '-1', '1.5', '1e5']) assert.throws(() => fromBaseUnits(bad, 8), undefined, bad)
})

test('mulDivFloor：向下取整，除数 0 返回 0', () => {
  assert.equal(mulDivFloor('999', '250', '3000'), '83')
  assert.equal(mulDivFloor('388535076968420000000', '7765323060974', '31061292243897'), '97133769242101872835')
  assert.equal(mulDivFloor('5', '5', '0'), '0')
  assert.throws(() => mulDivFloor('1.5', '1', '1'))
})
