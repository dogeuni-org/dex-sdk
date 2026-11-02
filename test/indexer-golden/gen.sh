#!/usr/bin/env bash
# 用 dogeuni-indexer 的真实代码重新生成 test/vectors/indexer-golden.json。
# 用法（dex-sdk 目录）：test/indexer-golden/gen.sh <dogeuni-indexer 仓库路径> [ref，默认 origin/main]
# 只读 indexer 仓库：git archive 导出 ref 到临时目录，放入生成器后跑 go test（sqlite，无需数据库 / 节点）。
set -euo pipefail
repo=${1:?usage: gen.sh <dogeuni-indexer repo> [ref]}
ref=${2:-origin/main}
here=$(cd "$(dirname "$0")" && pwd)
out="$here/../vectors/indexer-golden.json"
commit=$(git -C "$repo" rev-parse "$ref")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git -C "$repo" archive "$commit" | tar -x -C "$work"
cp "$here/dexsdk_golden_test.go" "$work/explorer/zz_dexsdk_golden_test.go"
cd "$work"
# indexer 仓库不提交 go.sum
[ -f go.sum ] || go mod tidy >/dev/null
GOLDEN_OUT="$out" GOLDEN_COMMIT="$commit" go test ./explorer -run '^TestDexSdkGolden$' -count=1
echo "wrote $out @ dogeuni-indexer $commit"
