package explorer

// Golden data for dogeuni-dex-sdk: runs the real indexer handlers (verify + storage) on a scratch
// sqlite DB and records what the chain would do. Lives in dex-sdk, not in the indexer repo:
// gen.sh copies it into an export of dogeuni-indexer's explorer package and runs
//   GOLDEN_OUT=/path/indexer-golden.json GOLDEN_COMMIT=<sha> go test ./explorer -run TestDexSdkGolden -count=1

import (
	"dogeuni-indexer/models"
	"dogeuni-indexer/storage"
	"encoding/json"
	"math/big"
	"os"
	"strings"
	"testing"
)

const (
	gHolder  = "DHolderAddressxxxxxxxxxxxxxxxxxxxx"
	gReserve = "DReserveAddressxxxxxxxxxxxxxxxxxxx"
	gWdoge   = "WDOGE(WRAPPED-DOGE)"
	gInviter = "DInviterAddressxxxxxxxxxxxxxxxxxxx"
	gHuge    = "1000000000000000000000000000000000000"
)

var gMeme = strings.Repeat("ab", 32) // 64-hex tick_id

var gTables = []interface{}{
	&models.SwapLiquidity{}, &models.SwapV2Liquidity{}, &models.SwapV2Revert{}, &models.PumpLiquidity{}, &models.PumpInfo{},
	&models.PumpRevert{}, &models.InviteCollect{}, &models.Drc20Collect{}, &models.Drc20CollectAddress{}, &models.Drc20Revert{},
	&models.Meme20Collect{}, &models.Meme20CollectAddress{}, &models.Meme20Revert{}, &models.Summary{},
	&models.SwapInfo{}, &models.SwapV2Info{}, &models.PumpInviteReward{}, &models.PumpInviteRewardRevert{},
}

func n(s string) *models.Number {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		panic("bad number " + s)
	}
	return (*models.Number)(v)
}

func bs(v *big.Int) string { return v.String() }

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func drc20Bal(t *testing.T, e *Explorer, tick, holder, amt string) {
	if err := e.dbc.DB.Create(&models.Drc20CollectAddress{Tick: tick, HolderAddress: holder, AmtSum: n(amt)}).Error; err != nil {
		t.Fatal(err)
	}
}

func meme20Bal(t *testing.T, e *Explorer, tickId, holder, amt string) {
	if err := e.dbc.DB.Create(&models.Meme20CollectAddress{TickId: tickId, HolderAddress: holder, Amt: n(amt)}).Error; err != nil {
		t.Fatal(err)
	}
}

func meme20Token(t *testing.T, e *Explorer, tickId string) {
	if err := e.dbc.DB.Create(&models.Meme20Collect{TickId: tickId, Tick: "MEME", Max: n(gHuge), Dec: 8}).Error; err != nil {
		t.Fatal(err)
	}
}

func drc20Of(e *Explorer, tick, holder string) *big.Int {
	r := &models.Drc20CollectAddress{}
	if err := e.dbc.DB.Where("tick = ? and holder_address = ?", tick, holder).First(r).Error; err != nil {
		return big.NewInt(0)
	}
	return r.AmtSum.Int()
}

type gPool struct {
	Tick0 string `json:"tick0"`
	Tick1 string `json:"tick1"`
	Amt0  string `json:"amt0"`
	Amt1  string `json:"amt1"`
}

type swapCase struct {
	Pool   gPool  `json:"pool"`
	TickIn string `json:"tickIn"`
	AmtIn  string `json:"amtIn"`
	Ok     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	AmtOut string `json:"amtOut,omitempty"`
	// verify 的 amt1_min 校验：amt1_min = amtOut 通过、= amtOut + 1 不通过
	MinAtOut     *bool `json:"minAtOut,omitempty"`
	MinAtOutPlus *bool `json:"minAtOutPlus1,omitempty"`
}

func boolp(b bool) *bool { return &b }

func otherTick(p gPool, in string) string {
	if in == p.Tick0 {
		return p.Tick1
	}
	return p.Tick0
}

func runSwapV1(t *testing.T, p gPool, tickIn, amtIn string) swapCase {
	c := swapCase{Pool: p, TickIn: tickIn, AmtIn: amtIn}
	tickOut := otherTick(p, tickIn)
	setup := func() *Explorer {
		e := newTestExplorer(t, gTables...)
		pool := &models.SwapLiquidity{Tick: p.Tick0 + "-SWAP-" + p.Tick1, Tick0: p.Tick0, Tick1: p.Tick1, Amt0: n(p.Amt0), Amt1: n(p.Amt1), LiquidityTotal: n("1000"), ReservesAddress: gReserve}
		if err := e.dbc.DB.Create(pool).Error; err != nil {
			t.Fatal(err)
		}
		drc20Bal(t, e, p.Tick0, gReserve, p.Amt0)
		drc20Bal(t, e, p.Tick1, gReserve, p.Amt1)
		drc20Bal(t, e, tickIn, gHolder, gHuge)
		return e
	}
	mk := func(min string) *models.SwapInfo {
		return &models.SwapInfo{Op: "swap", Tick0: tickIn, Tick1: tickOut, Amt0: n(amtIn), Amt1: n("0"), Amt0Min: n("0"), Amt1Min: n(min), HolderAddress: gHolder, TxHash: "tx", BlockNumber: 1}
	}
	e := setup()
	swap := mk("0")
	err := e.verify.verifySwapExec(e.dbc.DB, swap)
	if err == nil {
		err = e.dbc.SwapExec(e.dbc.DB, swap)
	}
	c.Ok, c.Error = err == nil, errStr(err)
	if swap.Amt1Out != nil {
		c.AmtOut = swap.Amt1Out.String()
	}
	if c.Ok {
		out := n(c.AmtOut).Int()
		e2 := setup()
		c.MinAtOut = boolp(e2.verify.verifySwapExec(e2.dbc.DB, mk(bs(out))) == nil)
		c.MinAtOutPlus = boolp(e2.verify.verifySwapExec(e2.dbc.DB, mk(bs(new(big.Int).Add(out, big.NewInt(1))))) == nil)
	}
	return c
}

func runSwapV2(t *testing.T, p gPool, tickIn, amtIn string) swapCase {
	c := swapCase{Pool: p, TickIn: tickIn, AmtIn: amtIn}
	tickOut := otherTick(p, tickIn)
	bal := func(e *Explorer, tick, holder, amt string) {
		if len(tick) == 64 {
			meme20Bal(t, e, tick, holder, amt)
		} else {
			drc20Bal(t, e, tick, holder, amt)
		}
	}
	setup := func() *Explorer {
		e := newTestExplorer(t, gTables...)
		pool := &models.SwapV2Liquidity{PairId: "PAIR", Tick: "LP", Tick0Id: p.Tick0, Tick1Id: p.Tick1, Tick0: "T0", Tick1: "T1", Amt0: n(p.Amt0), Amt1: n(p.Amt1), LiquidityTotal: n("1000"), ReservesAddress: gReserve}
		if err := e.dbc.DB.Create(pool).Error; err != nil {
			t.Fatal(err)
		}
		for _, id := range []string{p.Tick0, p.Tick1} {
			if len(id) == 64 {
				meme20Token(t, e, id)
			}
		}
		bal(e, p.Tick0, gReserve, p.Amt0)
		bal(e, p.Tick1, gReserve, p.Amt1)
		bal(e, tickIn, gHolder, gHuge)
		return e
	}
	mk := func(min string) *models.SwapV2Info {
		return &models.SwapV2Info{Op: "swap", PairId: "PAIR", Tick0Id: tickIn, Tick1Id: tickOut, Amt0: n(amtIn), Amt1: n("0"), Amt0Min: n("0"), Amt1Min: n(min), HolderAddress: gHolder, TxHash: "tx", BlockNumber: 1}
	}
	e := setup()
	swap := mk("0")
	err := e.verify.verifySwapV2Exec(e.dbc.DB, swap)
	if err == nil {
		err = e.dbc.SwapV2Exec(e.dbc.DB, swap)
	}
	c.Ok, c.Error = err == nil, errStr(err)
	if swap.Amt1Out != nil {
		c.AmtOut = swap.Amt1Out.String()
	}
	if c.Ok {
		out := n(c.AmtOut).Int()
		e2 := setup()
		c.MinAtOut = boolp(e2.verify.verifySwapV2Exec(e2.dbc.DB, mk(bs(out))) == nil)
		c.MinAtOutPlus = boolp(e2.verify.verifySwapV2Exec(e2.dbc.DB, mk(bs(new(big.Int).Add(out, big.NewInt(1))))) == nil)
	}
	return c
}

type lpReserves struct {
	Amt0  string `json:"amt0"`
	Amt1  string `json:"amt1"`
	Total string `json:"total"`
}

type addCase struct {
	Reserves lpReserves `json:"reserves"`
	// 用户在哪一侧输入（另一侧按 Trade 的比例算法得出），只作说明
	Entered string `json:"entered"`
	Amt0    string `json:"amt0"`
	Amt1    string `json:"amt1"`
	Amt0Min string `json:"amt0Min"`
	Amt1Min string `json:"amt1Min"`
	Ok      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
	Amt0Out string `json:"amt0Out,omitempty"`
	Amt1Out string `json:"amt1Out,omitempty"`
}

func mulDiv(a, b, c string) string {
	x := new(big.Int).Mul(n(a).Int(), n(b).Int())
	return x.Div(x, n(c).Int()).String()
}

// floor(x × 9950 ÷ 10000)：0.5% 滑点的最少存入
func min50(x string) string { return mulDiv(x, "9950", "10000") }

func runAdd(t *testing.T, r lpReserves, entered, amt string) addCase {
	c := addCase{Reserves: r, Entered: entered}
	if entered == "base" {
		c.Amt0, c.Amt1 = amt, mulDiv(amt, r.Amt1, r.Amt0)
	} else {
		c.Amt0, c.Amt1 = mulDiv(amt, r.Amt0, r.Amt1), amt
	}
	c.Amt0Min, c.Amt1Min = min50(c.Amt0), min50(c.Amt1)
	e := newTestExplorer(t, gTables...)
	lp := "AAAA-SWAP-BBBB"
	pool := &models.SwapLiquidity{Tick: lp, Tick0: "AAAA", Tick1: "BBBB", Amt0: n(r.Amt0), Amt1: n(r.Amt1), LiquidityTotal: n(r.Total), ReservesAddress: gReserve}
	if err := e.dbc.DB.Create(pool).Error; err != nil {
		t.Fatal(err)
	}
	if err := e.dbc.DB.Create(&models.Drc20Collect{Tick: lp, AmtSum: n(r.Total), Max: n(gHuge), Lim: n(gHuge)}).Error; err != nil {
		t.Fatal(err)
	}
	drc20Bal(t, e, "AAAA", gReserve, r.Amt0)
	drc20Bal(t, e, "BBBB", gReserve, r.Amt1)
	drc20Bal(t, e, "AAAA", gHolder, gHuge)
	drc20Bal(t, e, "BBBB", gHolder, gHuge)
	swap := &models.SwapInfo{Op: "add", Tick0: "AAAA", Tick1: "BBBB", Amt0: n(c.Amt0), Amt1: n(c.Amt1), Amt0Min: n(c.Amt0Min), Amt1Min: n(c.Amt1Min), HolderAddress: gHolder, TxHash: "tx", BlockNumber: 1}
	err := e.verify.verifySwapAdd(e.dbc.DB, swap)
	if err == nil {
		err = e.dbc.SwapAdd(e.dbc.DB, swap)
	}
	c.Ok, c.Error = err == nil, errStr(err)
	if c.Ok {
		c.Amt0Out, c.Amt1Out = swap.Amt0Out.String(), swap.Amt1Out.String()
	}
	return c
}

type removeCase struct {
	Reserves  lpReserves `json:"reserves"`
	Liquidity string     `json:"liquidity"`
	Ok        bool       `json:"ok"`
	Error     string     `json:"error,omitempty"`
	Amt0Out   string     `json:"amt0Out,omitempty"`
	Amt1Out   string     `json:"amt1Out,omitempty"`
}

func runRemove(t *testing.T, r lpReserves, liquidity string) removeCase {
	c := removeCase{Reserves: r, Liquidity: liquidity}
	e := newTestExplorer(t, gTables...)
	lp := "AAAA-SWAP-BBBB"
	pool := &models.SwapLiquidity{Tick: lp, Tick0: "AAAA", Tick1: "BBBB", Amt0: n(r.Amt0), Amt1: n(r.Amt1), LiquidityTotal: n(r.Total), ReservesAddress: gReserve}
	if err := e.dbc.DB.Create(pool).Error; err != nil {
		t.Fatal(err)
	}
	if err := e.dbc.DB.Create(&models.Drc20Collect{Tick: lp, AmtSum: n(r.Total), Max: n(gHuge), Lim: n(gHuge)}).Error; err != nil {
		t.Fatal(err)
	}
	drc20Bal(t, e, "AAAA", gReserve, r.Amt0)
	drc20Bal(t, e, "BBBB", gReserve, r.Amt1)
	drc20Bal(t, e, lp, gHolder, r.Total)
	swap := &models.SwapInfo{Op: "remove", Tick0: "AAAA", Tick1: "BBBB", Liquidity: n(liquidity), HolderAddress: gHolder, TxHash: "tx", BlockNumber: 1}
	err := e.verify.verifySwapRemove(e.dbc.DB, swap)
	if err == nil {
		err = e.dbc.SwapRemove(e.dbc.DB, swap)
	}
	c.Ok, c.Error = err == nil, errStr(err)
	if swap.Amt0Out != nil {
		c.Amt0Out, c.Amt1Out = swap.Amt0Out.String(), swap.Amt1Out.String()
	}
	return c
}

type pumpReserves struct {
	Amt0 string `json:"amt0"`
	Amt1 string `json:"amt1"`
}

type pumpCase struct {
	Side string `json:"side"`
	// 交易者绑定了邀请人：平台费再按 floor(fee ÷ 2) 转给邀请人，这一笔为 0 也会让交易失败
	Invited  bool         `json:"invited"`
	Reserves pumpReserves `json:"reserves"`
	// 储备地址实际持有的 WDOGE（= amt1 − 3000 DOGE 虚拟储备）
	RealWdoge     string        `json:"realWdoge"`
	AmtIn         string        `json:"amtIn"`
	Ok            bool          `json:"ok"`
	Error         string        `json:"error,omitempty"`
	Fee           string        `json:"fee,omitempty"`
	AmtOut        string        `json:"amtOut,omitempty"`
	ReservesAfter *pumpReserves `json:"reservesAfter,omitempty"`
}

func runPump(t *testing.T, side string, invited bool, r pumpReserves, amtIn string) pumpCase {
	real := new(big.Int).Sub(n(r.Amt1).Int(), n(PumpVirtual).Int())
	c := pumpCase{Side: side, Invited: invited, Reserves: r, RealWdoge: bs(real), AmtIn: amtIn}
	e := newTestExplorer(t, gTables...)
	pl := &models.PumpLiquidity{Tick0: "MEME", Tick0Id: gMeme, Tick1: gWdoge, Tick1Id: gWdoge, Amt0: n(r.Amt0), Amt1: n(r.Amt1), ReservesAddress: gReserve, KingDate: 1}
	if err := e.dbc.DB.Create(pl).Error; err != nil {
		t.Fatal(err)
	}
	meme20Token(t, e, gMeme)
	if invited {
		if err := e.dbc.DB.Create(&models.InviteCollect{HolderAddress: gHolder, InviteAddress: gInviter}).Error; err != nil {
			t.Fatal(err)
		}
	}
	drc20Bal(t, e, gWdoge, gReserve, bs(real))
	meme20Bal(t, e, gMeme, gReserve, r.Amt0)
	tickIn, tickOut := gWdoge, gMeme
	if side == "buy" {
		drc20Bal(t, e, gWdoge, gHolder, gHuge)
	} else {
		tickIn, tickOut = gMeme, gWdoge
		meme20Bal(t, e, gMeme, gHolder, gHuge)
	}
	pump := &models.PumpInfo{Op: "trade", PairId: gMeme, Tick0Id: tickIn, Tick1Id: tickOut, Amt0: n(amtIn), Amt1Min: n("0"), HolderAddress: gHolder, TxHash: "tx", BlockNumber: 1}
	err := e.verify.verifyPumpTrade(e.dbc.DB, pump)
	if err == nil {
		err = e.dbc.PumpTrade(e.dbc.DB, pump)
	}
	c.Ok, c.Error = err == nil, errStr(err)
	if c.Ok {
		// 平台费 = 留在 TxFeeAddress 的 + 分给邀请人的
		c.Fee = bs(new(big.Int).Add(drc20Of(e, gWdoge, storage.TxFeeAddress), drc20Of(e, gWdoge, gInviter)))
		c.AmtOut = pump.Amt1Out.String()
		after := &models.PumpLiquidity{}
		if err := e.dbc.DB.Where("tick0_id = ?", gMeme).First(after).Error; err != nil {
			t.Fatal(err)
		}
		c.ReservesAfter = &pumpReserves{Amt0: after.Amt0.String(), Amt1: after.Amt1.String()}
	}
	return c
}

// indexer 的 pump 虚拟储备（3000 DOGE），deploy 时写进 amt1
const PumpVirtual = "300000000000"

func TestDexSdkGolden(t *testing.T) {
	out := os.Getenv("GOLDEN_OUT")
	if out == "" {
		t.Skip("GOLDEN_OUT not set")
	}

	v1Pools := []gPool{
		{"AAAA", "BBBB", "100000000", "100000000"},
		{"AAAA", "BBBB", "123456789012", "98765432109876"},
		{"AAAA", "BBBB", "5", "1000000000000"},
		{"AAAA", "BBBB", "100000000000000000000", "3000000000000000000"},
		{"CARDI", gWdoge, "93719519470452", "217453706083"},
	}
	amounts := []string{"1", "999", "1000", "1001", "123456789", "10000000000", "1000000000000000", "10000000000000000000000"}
	var v1 []swapCase
	for _, p := range v1Pools {
		for _, in := range []string{p.Tick0, p.Tick1} {
			for _, a := range amounts {
				v1 = append(v1, runSwapV1(t, p, in, a))
			}
		}
	}

	v2Pools := []gPool{
		{gMeme, gWdoge, "98000000000000000", "300000000000"},
		{gMeme, gWdoge, "123456789012345", "987654321"},
	}
	var v2 []swapCase
	for _, p := range v2Pools {
		for _, in := range []string{p.Tick0, p.Tick1} {
			for _, a := range []string{"999", "1000", "123456789", "10000000000000"} {
				v2 = append(v2, runSwapV2(t, p, in, a))
			}
		}
	}

	lpPools := []lpReserves{
		{"100000000", "300000000", "170000000"},
		{"123456789012", "98765432109876", "3333333333"},
		{"7", "1000000000000", "1000"},
	}
	var adds []addCase
	var removes []removeCase
	for _, r := range lpPools {
		for _, a := range []string{"1", "3", "123456789", "100000000000"} {
			for _, side := range []string{"base", "quote"} {
				c := runAdd(t, r, side, a)
				if c.Amt0 != "0" && c.Amt1 != "0" { // 0 不可提交（payload 构造即拒绝）
					adds = append(adds, c)
				}
			}
		}
		total := n(r.Total).Int()
		third := new(big.Int).Div(total, big.NewInt(3))
		for _, l := range []string{"1", bs(third), bs(new(big.Int).Sub(total, big.NewInt(1))), r.Total} {
			removes = append(removes, runRemove(t, r, l))
		}
	}

	pumpPools := []pumpReserves{
		{"100000000000000000", "300000000000"}, // reserve 0，刚部署
		{"98000000000000000", "300000000000"},  // reserve 2%，刚部署
		{"61234567890123456", "487654321098"},  // 交易过一段
		{"25000000000000000", "1200000000000"}, // 过了 king 线
	}
	var pumps []pumpCase
	for _, r := range pumpPools {
		for _, a := range []string{"99", "100", "100000000", "123456789012", "500000000000"} {
			pumps = append(pumps, runPump(t, "buy", false, r, a))
		}
		for _, a := range []string{"1", "20000000", "50000000", "1000000000000", "1000000000000000", "10000000000000000"} {
			pumps = append(pumps, runPump(t, "sell", false, r, a))
		}
	}
	// verify 的停止交易线：成交前 amt1（含虚拟储备）≥ 3.3e12 即拒绝，买卖都拒；
	// 毕业要储备真实 WDOGE ≥ 1e13（amt1 ≥ 1.03e13），中间的币既不能交易也不毕业
	for _, r := range []pumpReserves{
		{"9090909090912", "3299999999999"},
		{"9090909090909", "3300000000000"},
		{"6000000000000", "5000000000000"},
	} {
		pumps = append(pumps, runPump(t, "buy", false, r, "100000000"), runPump(t, "sell", false, r, "1000000000000"))
	}
	// 绑定邀请人：最小可成交额翻倍（邀请分成 floor(fee ÷ 2) 也必须 ≥ 1）
	for _, r := range pumpPools[2:] {
		for _, a := range []string{"100", "199", "200", "100000000"} {
			pumps = append(pumps, runPump(t, "buy", true, r, a))
		}
		for _, a := range []string{"20000000", "50000000", "1000000000000000"} {
			pumps = append(pumps, runPump(t, "sell", true, r, a))
		}
	}

	doc := map[string]interface{}{
		"version": 1,
		"source": map[string]interface{}{
			"repo":   "dogeuni-indexer",
			"commit": os.Getenv("GOLDEN_COMMIT"),
			"run":    "verify + storage handlers on a scratch sqlite DB",
			"handlers": []string{
				"verifySwapExec + SwapExec", "verifySwapV2Exec + SwapV2Exec", "verifySwapAdd + SwapAdd",
				"verifySwapRemove + SwapRemove", "verifyPumpTrade + PumpTrade",
			},
		},
		"swapV1": v1, "swapV2": v2, "add": adds, "remove": removes, "pump": pumps,
	}
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, append(b, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
}
