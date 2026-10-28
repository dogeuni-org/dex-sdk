# dogeuni-dex-sdk

DogeUni DEX protocol functions — swap quotes, wallet payload builders and parsing, fees and amount conversion — bit-for-bit identical to [dogeuni-indexer](https://github.com/dogeuni-org/dogeuni-indexer). Zero dependencies.

DogeUni DEX 协议纯函数：报价、钱包 payload 构造与解析、费用与金额换算。DogeUni Trade、DogeUni Wallet、dogeuni-mcp 共用这一份实现。

> 本仓库是 DogeUni Trade 内 `packages/dex-sdk` 的发布镜像，每个版本由 CI 同步一次、在这里带 provenance 发布到 npm。不在这里直接改代码。

## 安装

```sh
npm install --save-exact dogeuni-dex-sdk
```

ESM 与 CommonJS 都有，带类型声明（ES2020，需要 BigInt）。TypeScript 4.7 起、`moduleResolution` 为 `node` / `node16` / `bundler` 都能用。

## 原则

1. **以 dogeuni-indexer 为唯一事实来源**：公式、取整方向、校验规则都照 indexer 写，indexer 改了这里跟着改。
2. **金额一律最小单位整数串**：入参 / 返回值是 `"12345678901"` 这样的十进制整数字符串，内部用 BigInt，不收 `number`（超过 2^53 会失精）。十进制换算用 `toBaseUnits` / `fromBaseUnits`。
3. **只做协议支持的事**：swap 只有单池（indexer 没有多跳）。
4. **非法输入直接抛错**，不猜默认值。

## 内容

| 模块 | 函数 |
|---|---|
| 金额 | `toBaseUnits` / `fromBaseUnits` / `mulDivFloor` |
| Swap 报价 | `quoteExactIn` / `swapFee` / `checkMinOut` |
| 滑点 | `minReceived` / `liquidityMin` / `isValidSlippageBps` |
| 流动性 | `proportionalBaseUnits` / `lpPooledAmounts` / `lpWithdrawAmounts` |
| WDOGE 费用 | `wdogeServiceFeeSats` / `wdogeDepositFeeSats` / `depositTotalSpendSats` / `maxDepositAmountSats` |
| Pump 曲线 | `quotePumpBuy` / `quotePumpSell` / `isPumpSellCovered` 等、协议常量、`buildPumpTrade` / `buildPumpDeploy` |
| 钱包 payload | `buildSwapV1` / `buildSwapV2` / `buildWdoge` / `buildAddLiquidity` / `buildRemoveLiquidity` / `buildCreatePool` |
| 解析 | `parse(payload) → TradeIntent`；不认识的 p/op 抛 `UnknownPayloadError`，字段不合法抛 `InvalidPayloadError` |

`TradeIntent` 是钱包审批窗的显示模型：只由上链字段 + 协议公式得出（花什么、多少、至少收到多少、手续费）。swap 的报价 `amt1`（v2 不上链，v1 上链但链上不按它执行）只作为参考值 `quotedOut`，费用一律按公式重算、不读 payload。钱包拿 `TradeIntent` 加上自己取的池子储备跑 `checkMinOut` / `quoteExactIn`，就能独立判断最少收到是否合理。

```js
import { buildSwapV1, parse, WDOGE_TICK } from 'dogeuni-dex-sdk'

const payload = buildSwapV1({ tick0: WDOGE_TICK, tick1: 'CARDI', amt0: '1000000000', amt1: '12345678901', amt1Min: '12283950506', doge: 1 })
parse(payload)
// { kind: 'swap', protocol: 'pair-v1', amountIn: '1000000000', nativeIn: true, minOut: '12283950506', lpFee: '3000000', serviceFee: '50000000', ... }
```

## 校验来源

每个版本都由本仓库 `.github/workflows/publish.yml` 在 `v*` tag 上构建发布，带 npm provenance，同一个 tarball 和 `SHA256SUMS` 挂在 GitHub Release。

```sh
npm view dogeuni-dex-sdk@<version> dist.integrity   # 与 Release 里 tarball 的 sha512 一致
npm audit signatures                                 # 校验 registry 签名和 provenance
```

## License

MIT
