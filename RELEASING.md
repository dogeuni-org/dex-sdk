# 发布清单（npm + GitHub Release）

> 不在 npm 包里（`files` 只带 `dist/ src/`，外加 npm 自动带的 README / LICENSE / package.json）。
> 源码在 DogeUni Trade（私有）的 `packages/dex-sdk`；公开镜像 `dogeuni-org/dex-sdk` 只放发布快照，不在镜像里直接改。
> 流程：Trade 推 tag `dex-sdk-v<版本>` → Trade 的 `.github/workflows/dex-sdk-mirror.yml` 在 workspace 外独立测试 + 构建，把本目录原样同步到镜像 `main` 并打 tag `v<版本>` → 镜像的 `.github/workflows/publish.yml`（就是本目录下那份）测试 → 等 `npm` environment 审批 → 带 provenance 发布 → 核对 integrity → 建 Release。
> 走镜像的原因：npm 只给公开仓库签 provenance，钱包验收要求 provenance 指向公开仓库的 tag 提交。

## 一次性设置（用户做）

1. **建公开仓库** `dogeuni-org/dex-sdk`：创建时勾选「Add a README」（`actions/checkout` 拉不了空仓库；首次同步会用本目录的 README 覆盖它）。
2. **deploy key**：本机 `ssh-keygen -t ed25519 -N '' -f dex-sdk-mirror -C dex-sdk-mirror`。
   - 公钥 `dex-sdk-mirror.pub` → 镜像 Settings → Deploy keys，勾 **Allow write access**；
   - 私钥 `dex-sdk-mirror` → DogeUni Trade 仓库 Settings → Secrets → Actions，名为 `DEX_SDK_MIRROR_DEPLOY_KEY`；
   - 两处都放好后删掉本机这两个文件。
3. **镜像的 GitHub environment `npm`**：Settings → Environments → New → `npm`；Required reviewers 填自己；Deployment branches and tags 只允许 `v*` tag。
4. **镜像的保护**（可选，建议）：开 secret scanning + push protection；ruleset `main` 禁止删除和 force push。若给 `v*` tag 加「只有 admin 能建」的 ruleset，要把 **Deploy keys** 加进 bypass 列表，否则同步推不上 tag。
5. **首发凭据**：npm 账号 `sevenpsong`（与 `dogeuni-mcp` 同一个，已开 2FA）。包 `dogeuni-dex-sdk` 尚不存在，没法先配 trusted publisher，所以首发用 granular access token（只授权发布、有效期 1 天），存为**镜像**仓库的 secret `NPM_TOKEN`。
6. **首发后切 trusted publishing**（npm 包设置 → Trusted Publisher → GitHub Actions）：组织 `dogeuni-org`，仓库 `dex-sdk`，workflow `publish.yml`，environment `npm`。新配置要在 2 天内完成第一次成功发布，否则失效。切换后：
   - 包设置 → Publishing access 选「Require two-factor authentication and disallow tokens」；
   - 在 npm 撤销那个 token，删除镜像的 secret `NPM_TOKEN`。

## 每次发布

1. Trade `main` 干净、`npm test` 全绿。
2. 改 `packages/dex-sdk/package.json` 的 `version`。改了 `devDependencies` 的话，要重新生成本目录的 `package-lock.json`（镜像用它 `npm ci`；Trade 的 `tools/tests/dex-sdk-lock.test.mjs` 会核对两边一致）：在仓库外的空目录放一份 `package.json`，跑 `npm install --package-lock-only --ignore-scripts`，再把生成的 lock 拷回来。
3. 合进 `main` 后，在 `main` 上打 tag：`git tag dex-sdk-v<version>` → `git push origin dex-sdk-v<version>`。
4. 看 Trade 的「dex-sdk mirror」跑完，再到镜像的 Actions 里批准 `npm` environment。
5. 发布后在 npm 页面确认有 Provenance 标记，并按 README「校验来源」走一遍。

## 消费方（钱包）验收

版本精确锁定（不用 `^`）；升级时跑 `npm audit signatures`，并核对 provenance 指向 `dogeuni-org/dex-sdk` 的 `v<版本>` tag 提交。
