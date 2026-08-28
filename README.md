# mahou — 家宴多人互動遊戲 POC（Phase 0）

**這不是在做遊戲，是在量數字。** 手機當手把、大螢幕當主畫面，量測 Cloudflare Workers + Durable Objects 架構在真實家用 wifi + 真實手機上的延遲天花板。

Phase 0 的交付物是一份 **JSON 測試數據**，不是玩法。遊戲一～四（顏色反應、跑酷、接水、打地鼠）在數據出來之後才開工。

## 一鍵部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/clarencechien/mahou)

按下去 → 登入 Cloudflare → 自動部署。**Free plan 可用**（Durable Object 已設定成 SQLite-backed）。

> ⚠️ **按鈕的陷阱**：Deploy to Cloudflare 會把這個 repo 當模板**複製一份新 repo** 到你的 GitHub 帳號，CI 接在那份複製品上——之後 push 到本 repo 的 main **不會**觸發部署。要持續開發請改用下面的 Import a repository 連本尊，或在 Worker → Settings → Build 把 Git 連動改指回本 repo（自訂網域綁在 worker 上，不受影響）。注意：切完連動要再 push 一次才會觸發第一個新 build。

其他兩種部署方式：

- **Cloudflare Dashboard 連動**（自己開發用這個）：Dashboard → Workers & Pages → Create → Import a repository → 選這個 repo。它會讀 `wrangler.toml` 自動設好 DO binding 與靜態資源，之後 push 即部署。
- **CLI**：`npm install && npx wrangler deploy`（本機開發用 `npx wrangler dev`，但感測器 API 需要 HTTPS，手機實測請直接用部署出來的 `*.workers.dev` 網址）。

## 怎麼跑一輪測試（約 10 分鐘）

1. 大螢幕（Chromebook）開 `https://<你的>.workers.dev/` → 自動進主控台，顯示 4 碼房號 + QR。
2. 手機掃 QR → 填暱稱（兩字內）→ 加入。**從 LINE 掃到的內建瀏覽器會被擋下並提示改用外部瀏覽器**（感測器權限拿不到）。
3. 加入後 client 自動對時（10 次 ping 取最小 RTT 的 offset），之後每 10 秒背景重測、記錄 offset 漂移。
4. 主控台依序按關卡按鈕，所有手機同步切換畫面：
   - **② Ping 測試**：手機顯示即時 RTT 大字＋紅黃綠燈（<40 綠 / 40–120 黃 / >120 紅），主控台看全員一覽。
   - **③ 單點×10**：點 10 下，量上行/下行延遲分布（本機立即變色＝零延遲對照組）。
   - **③ 狂點 3 秒**：3 秒內盡量點，量掉包率與 seq 斷號。
   - **④ 搖動計數**：按「啟用感測器」（iOS 權限必須由手勢觸發）→ 搖 10 下。門檻/遲滯/不應期是畫面上的滑桿，可現場調參，最終值會記進遙測。**重點：同一人拿 Pixel 和平板各搖 10 下，比兩邊數出來差多少。**
5. 主控台按 **「匯出 JSON」**。**這是唯一真正的交付物** — 遙測只存在 DO 記憶體，房間閒置被回收就沒了，測完立刻匯出。

## 匯出數據格式

```jsonc
{
  "roomId": "ABCD",
  "clients": [ { "clientId", "name", "device": { /* ua, screen, deviceMemory, motionEventRateHz, ... */ }, "sync" } ],
  "events": [
    // type: join / syncResult / tap / spamSummary / shake / clientRecord / stage ...
    // tap 事件含 tClientSend(伺服器時間軸) / tServerRecv / uplinkMs
    // clientRecord(kind:tapRtt) 含 client 端算的 uplinkMs / downlinkMs — 上下行要分開看，家用 wifi 常不對稱
  ]
}
```

所有 client 時間戳都已用 clock offset 換算到伺服器時間軸（offset = t1 − (t0+t2)/2，取 RTT 最小樣本）。

## Phase 0 要填的驗收表

| 問題 | 數字 | 判斷 |
|---|---|---|
| 家用 wifi 下 RTT p50 / p95 | ___ / ___ ms | p95 > 200ms → 即時互動類全部出局 |
| 上行 vs 下行是否對稱 | ___ | 差距大要調整上報策略 |
| 五分鐘 clock offset 漂移 | ___ ms | > 20ms → 速度計分需要重新對時機制 |
| 狂點模式掉包率 | ___ % | > 1% → 需要 seq 補償 |
| Pixel vs 平板 搖動計數差異 | ___ % | > 15% → 必須做裝置校準 |

（完整 12 項驗收表與遊戲一～四規格見 handoff 文件；其餘項目屬後續 phase。）

## 專案結構

```
worker/index.js    # Worker entry：路由 + DO binding（/ws/:room、/export/:room）
worker/room.js     # RoomDO：房間狀態機、對時 pong、遙測收集（記憶體）、匯出
public/host.html   # 主控台：QR、關卡控制、全員即席統計、匯出 JSON
public/client.html # 手機端：onboarding 四關（加入/Ping/點擊/搖動）
public/shared.js   # 對時、WS 封裝（自動重連）、遙測批次、裝置指紋
wrangler.toml
```

無框架、無 build step，前端全部原生 DOM。

## DO 落點診斷（RTT 地板偏高先看這個）

第一輪實測（台灣家用網路）量到 RTT 地板 ~140ms——這不是 wifi 的鍋，是 **Durable Object 被建立在離台灣很遠的機房**（沒有 hint 時 APAC 使用者的 DO 常落在美西）。已做兩件事：

- 開房時帶 `locationHint: 'apac'`（只對**新建**的房間生效，舊房號換掉重開）
- `GET /whereami/<房號>` 回 `{doColo, edgeColo}`；主控台右上角也會顯示 `DO@XXX·邊緣@YYY`。`doColo` 離現場越遠 RTT 地板越高，報告裡要記這個值

## 假 client 壓力測試（探針 D）

```bash
node tools/fakeclients.mjs wss://<你的網域>/ws <房號> 8 30
```

8 個假 client 各以 300ms/shake + 100ms/tap 上報 30 秒，同時量負載下 RTT。兩台實機同場開著，看實機延遲在 8 人負載下的增幅（§12 表）。

## 計費防呆（DO 不會被忘記關的分頁養著）

這個 POC 用非 hibernation 的 WebSocket，**只要還有分頁連著，DO 就一直佔記憶體計費**；client 又有自動重連＋每 10 秒背景對時，忘記關的分頁會永遠戳著 DO。防呆有三層：

- **閒置自動關房**：30 分鐘沒有真實互動（ping／背景對時不算）→ DO 踢掉所有連線後休眠。中場休息太久被關到的話，重掃新房號即可。
- **最長壽命 6 小時**：無條件關房。
- **主控台「結束房間」鈕**：先自動匯出 JSON，再踢掉所有人。**每輪測完建議按這顆。**

被關房的 client 會看到「房間已結束」且不再重連（WS close code 4000/4001）。房間沒有寫任何持久化儲存，所以連線清空後成本歸零。

## 已知限制（要寫進報告）

- **iOS 未驗證**：測試機隊全是 Chromium（Chromebook + 兩台 Android）。`DeviceMotionEvent.requestPermission()` 的 iOS 路徑已寫好但沒實機跑過；正式場合前要借一支 iPhone 驗證「權限跳得出來、不會白畫面」。
- 遙測存 DO 記憶體，**閒置回收即消失**，測完立刻匯出。
- `tShow` 類的顯示延遲含螢幕更新等系統性常數偏差，組間比較有效，絕對值不要拿去跟文獻比。
