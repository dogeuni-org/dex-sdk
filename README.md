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
| Pump 曲线 | `quotePumpBuy` / `quotePumpSell` / `isPumpTradingOpen` / `isPumpStuck` / `isPumpFeePayable` / `isPumpSellCovered` / `pumpTradeTotalSpendSats` 等、协议常量、`buildPumpTrade` / `buildPumpDeploy` |
| 钱包 payload | `buildSwapV1` / `buildSwapV2` / `buildWdoge` / `buildAddLiquidity` / `buildRemoveLiquidity` / `buildCreatePool` |
| 解析 | `parse(payload) → TradeIntent`；不认识的 p/op 抛 `UnknownPayloadError`，字段不合法抛 `InvalidPayloadError` |

`TradeIntent` 是钱包审批窗的显示模型：只由上链字段 + 协议公式得出（花什么、多少、至少收到多少、手续费）。swap 的报价 `amt1`（v2 不上链，v1 上链但链上不按它执行）只作为参考值 `quotedOut`，费用一律按公式重算、不读 payload。钱包拿 `TradeIntent` 加上自己取的池子储备跑 `checkMinOut` / `quoteExactIn`，就能独立判断最少收到是否合理。

```js
import { buildSwapV1, parse, WDOGE_TICK } from 'dogeuni-dex-sdk'

const payload = buildSwapV1({ tick0: WDOGE_TICK, tick1: 'CARDI', amt0: '1000000000', amt1: '12345678901', amt1Min: '12283950506', doge: 1 })
parse(payload)
// { kind: 'swap', protocol: 'pair-v1', amountIn: '1000000000', nativeIn: true, minOut: '12283950506', lpFee: '3000000', serviceFee: '50000000', ... }
```

## 狗狗大逃杀（`dogeuni-dex-sdk/royale`）

DogeUni Wow 的 WDOGE 链上小游戏「狗狗大逃杀」的判定引擎与规则参数，单独放在子路径，不进主入口。游戏没有后端：报名 = 向奖池地址转 WDOGE，名次、奖金与退款只由奖池地址的入账 / 出账转账和开奖块哈希按规则推出。网页展示与奖池结算方共用这一份实现，任何人拿同样的链上数据都能复算出同样的结果。

| 内容 | 说明 |
|---|---|
| `series(first, data, { versions, seasons })` | 从第 1 场起逐场推演到当前高度：每场的报名、名单、每轮淘汰、奖金 / 退款，以及按地址的台账（`ledger`：应得 `earned`、未压满确认块的 `pending`、已转出 `claimed`、可领 `claimable`）。缺开奖块哈希时返回 `needHash`，调用方补上后再调用。场数不设默认上限（每场截止严格递增，自然停在当前场）；`maxSessions` 是调用方自选的保险，走满了仍没到当前场即抛错，不返回半截结果 |
| `derive` / `decode` / `planRound` / `nextCutoff` | 单场推演、按金额识别一笔入池转账、单轮开奖、下一场截止高度 |
| `royaleMoves` / `walletAmount` / `ticketAmount` | 某地址此刻按规则能转的单与金额 |
| `ROYALE_POOL` / `ROYALE_TICK` / `ROYALE_FIRST` / `ROYALE_RULES` / `ROYALE_SEASONS` | 奖池地址、代币、第 1 场、按场次生效的规则版本表、换季表 |

规则版本表与换季表**只追加**：已有条目改一个数，旧场次的复算结果就会变。规则变化都在表尾追加新版本，引擎按 `cfg.version` 分支。

```js
import { series, ROYALE_FIRST, ROYALE_RULES, ROYALE_SEASONS } from 'dogeuni-dex-sdk/royale'

// inbound / outbound：奖池的 WDOGE 转账 { tx, from, to, amt: BigInt 最小单位, h: 区块高度, ok: 链上执行成功 }
const r = series(ROYALE_FIRST, { tip, inbound, outbound, hashes }, { versions: ROYALE_RULES, seasons: ROYALE_SEASONS })
```

## 审批对照向量

`test/vectors/approval.json`：DogeUni Trade 按线上池子快照生成的真实 payload（swap pair-v1 / pair-v2、wdoge、add / remove / create、pump trade / deploy），每条附 `parse` 应得的 `intent`、按钱包取到的池子复核 `amt1_min` 的 `quoteExactIn` / `checkMinOut` 结果，以及 Trade 确认弹窗显示的十进制值；另有一组 `parse` 必须拒绝的 payload。字段说明见文件里的 `about`，`test/approval-vectors.test.mjs` 只用本包复算全部向量。钱包接入审批解码时可直接拿它当对照。向量不随 npm 包发布（`files` 不含 `test/`），从本仓库取。

## indexer 黄金数据

`test/vectors/indexer-golden.json`：直接在临时 sqlite 上跑 dogeuni-indexer 的真实 handler（swap pair-v1 / pair-v2、add、remove、pump trade，含 verify 校验）得到的链上结果——成交或失败（附 indexer 的错误信息）、输出数量、平台费、成交后储备，`source.commit` 是所用的 indexer 提交。`test/indexer-golden.test.mjs` 用本包逐位复算，链上的失败条件也一并核对：输出为 0；pump 平台费为 0，或交易者绑定了邀请人、`floor(平台费 ÷ 2)` 为 0；卖出毛额超过储备地址的真实 WDOGE。

indexer 改了这几类逻辑要重新生成（生成器在 `test/indexer-golden/`，只读导出 indexer 的指定提交，不需要数据库或节点）：

```sh
test/indexer-golden/gen.sh <dogeuni-indexer 仓库路径> [ref，默认 origin/main]
```

## 校验来源

每个版本都由本仓库 `.github/workflows/publish.yml` 在 `v*` tag 上构建发布，带 npm provenance，同一个 tarball 和 `SHA256SUMS` 挂在 GitHub Release。

```sh
npm view dogeuni-dex-sdk@<version> dist.integrity   # 与 Release 里 tarball 的 sha512 一致
npm audit signatures                                 # 校验 registry 签名和 provenance
```

## License

MIT
