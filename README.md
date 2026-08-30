# mahou — 派對遊戲

手機當手把、電視當主畫面的 Kahoot 式派對遊戲。跑在 Cloudflare Workers + Durable Objects 上，**免費方案就能跑**（DO 已設定成 SQLite-backed）。無框架、無 build step，前端全部原生 DOM。

目前有四款可玩的遊戲，以及一整套 Phase 0 的網路量測工具。

| | |
|---|---|
| **一二三木頭人** | 10 回合。綠燈時照大螢幕的指令用手機做對得分，鬼一轉身還在動就倒扣。指令有加減法、選顏色、點幾下、搖手機 |
| **滑雪下坡** | 20–120 秒比距離。連點加速、傾斜轉向、抬起手機跳跳台，連三次跳台解鎖超加速。畫面依人數切成 1 / 2 / 2×2 / 4×2 / 4×3，最多 12 人同場 |
| **名畫變色龍** | 4 幅名畫，每幅藏幾隻會眨眼的變色龍。手機當雷射筆（Wii 式指向，或觸控板）移游標蓋章搶快——誰先蓋到就是誰的，DO 用 250ms 結算窗比 client 時間戳。名畫載不到自動退程序化抽象畫 |
| **砸罐子** | 全員齊砸同一座塔。傾斜瞄準＋用力揮＝丟球（力量飽和防摔機）、或拉弓拖放。草捆／木桶／磚牆／鐵桶／炸彈各有 HP 與重量，砸壞什麼算誰的，炸彈連環爆。5 關 |

規則、控制、所有調校常數與實測數字：**[`docs/games.md`](docs/games.md)**
還沒實作的六款提案：[`docs/party-games-spec.md`](docs/party-games-spec.md)
畫面風格規範：[`.claude/skills/pixel-fake3d/SKILL.md`](.claude/skills/pixel-fake3d/SKILL.md)

## 一鍵部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/clarencechien/mahou)

按下去 → 登入 Cloudflare → 自動部署。

> ⚠️ **按鈕的陷阱**：Deploy to Cloudflare 會把這個 repo 當模板**複製一份新 repo** 到你的 GitHub 帳號，CI 接在那份複製品上——之後 push 到本 repo 的 main **不會**觸發部署。要持續開發請改用下面的 Import a repository 連本尊，或在 Worker → Settings → Build 把 Git 連動改指回本 repo（自訂網域綁在 worker 上，不受影響）。注意：切完連動要再 push 一次才會觸發第一個新 build。

其他兩種部署方式：

- **Cloudflare Dashboard 連動**（自己開發用這個）：Dashboard → Workers & Pages → Create → Import a repository → 選這個 repo。它會讀 `wrangler.toml` 自動設好 DO binding 與靜態資源，之後 push 即部署。
- **CLI**：`npm install && npx wrangler deploy`（本機開發用 `npx wrangler dev`，但感測器 API 需要 HTTPS，手機實測請直接用部署出來的 `*.workers.dev` 網址）。

## 現場怎麼跑

1. **電視／筆電**開 `https://<你的>.workers.dev/` → 主控台。按右上角 **⛶**，頂列會在 2.6 秒後自己收起來，畫面只剩遊戲。
2. **手機**掃畫面上的 QR（點一下 QR 可以放大給大家掃）→ 填暱稱（5 字內）→ 加入。
   **從 LINE 掃到的內建瀏覽器會被擋下並提示改用外部瀏覽器**（感測器權限拿不到）。
3. 頂列選遊戲 → 按 **「開始 ⟨遊戲⟩」**。**不會直接開打**，先出說明卡：
   - 大螢幕顯示規則三條，並用系統語音念一次解說（可按「🔊 再念一次」）
   - 同時所有手機切到準備畫面：要感測器權限 → 歸零校準 → **把每個動作試一遍**
   - 說明卡上顯示「N / M 人已就緒」，大家都好了再按 **「開始遊戲」**
4. 玩。要調手感就切到 **測試** 按 **⚙︎ 手感調校**（見下）。
5. 玩完切到 **測試** 按 **「結束房間」** — 會先自動匯出 JSON，再踢掉所有人讓 DO 休眠。

### 主控 HUD 的取捨

大螢幕是給**玩家**看的，不是給主持人看的，所以頂列刻意壓到只剩必要的東西：

- 品牌、遊戲選單、**開始**（不帶遊戲名，選單上就寫著了）
- 右邊三顆：**連線燈**（點了才展開右下的 DO 落點浮窗）、**⛶**、**正式／測試**一格開關
- **開打後**頂列只剩品牌＋停止；左下的加入卡縮成一個房號（晚到的人點一下還是能放大 QR）
- 回合標籤精簡成 `3/10`、`2/5`、`1/4・星夜`——倒數就在正中央，不重複寫

調校用的東西（手感面板、Phase 0 探針、匯出、結束房間）全部收在**測試**檢視裡。

### ⚙︎ 手感：現場可調的速度感

滑雪的速度感還沒定案，四個旋鈕做成現場可調（記在主控這台電腦的 localStorage）：

| 旋鈕 | 預設 | 生效 |
|---|---|---|
| 速度倍率 0.6–6.0× | 3.2× | 下一場 |
| 地面密度 0.6–6.0× | 3.5× | 立刻 |
| 廣角 0.6–1.6× | 1.0× | 立刻 |
| 比賽長度 20–120 秒 | 60 秒 | 下一場 |

**速度倍率會同時放大前進速度與障礙物間距** —— 每秒遇到的障礙物數量不變，但每個物件掃過畫面的時間變短，所以是「變快」而不是「變難」。調到滿意後按「複製設定」，把那行數字寫回 `public/host.html` 的 `TUNE_DEF`。

## Phase 0：網路量測

**這一段是「量數字」，不是玩法。** 交付物是一份 JSON。管理・測試分頁保留了完整的探針：

- **② Ping 測試** — 即時 RTT 大字＋紅黃綠燈，主控台看全員一覽
- **③ 單點×10 / 狂點 3 秒** — 上下行延遲分布、掉包率與 seq 斷號
- **④ 搖動計數** — 門檻／遲滯／不應期是畫面上的滑桿，可現場調參。重點是同一人拿不同機器各搖 10 下，比兩邊數出來差多少
- **DO 區域選單** — wnam / apac / weur A/B（hint 只在房間第一次建立時生效，換區域會開新房）。落點結果點主控右上的連線燈就看得到
- **匯出 JSON** — 遙測只存在 DO 記憶體，**房間閒置被回收就沒了，測完立刻匯出**

### 已經量到的數字（台灣，2026-08）

| 項目 | 實測 |
|---|---|
| RTT 地板 | **~150ms**（wifi 與 5G 皆然）—— 由 Cloudflare 入網點決定，不是家用 wifi |
| 滑雪 10Hz 上報的上行延遲 | p50 90ms / p95 115ms |
| 掉包率 | 0%（狂點 100 次 / 3 秒） |
| 8 人同場 | DO p95 僅 +9ms |
| 對時漂移 | <9ms/100s；網路切換跳 ±27ms 後 10 秒內回穩 |
| 跨螢幕色差 | ΔE<40 玩家分不出 —— **任何判定都不能靠細微色差** |
| 分割渲染 | 捲動雪地 Mode 7 在 1/2/4/8 格都是 4.3–4.4ms（分割數不是成本，總像素才是）；8 格比賽中 p50 16.5ms 維持 60fps |

**三條全平台鐵律**：

1. **判定用 client 時間戳**（`performance.now() + offset`，已對時到伺服器時間軸）。DO 只做排序、去重、廣播，不看封包到達時間。150ms 的傳輸延遲因此不影響任何公平性判定。
2. **本地先回饋**（0ms），網路結果後到再校正。
3. **每個玩家角色頭上都要有名字** —— 任何遊戲、任何視角，沒有例外。大螢幕上一堆同款小人，只靠配色認不出哪個是自己。名牌用 DOM 疊層而不是畫進 canvas（中文在低解析度像素緩衝裡會糊掉）。分割畫面另外要在每格左上角放該玩家的即時狀態。

### DO 落點診斷

**RTT 地板由「Cloudflare 入網點」決定**：

- HiNet 家用寬頻對這個 zone 在 **SJC（美西）入網** → DO 放美西 ~150ms；DO 放香港反而要繞一圈，~360ms
- **中華 5G 在 SIN（新加坡）入網**（`/cdn-cgi/trace` 實測 `loc=TW colo=SIN`）→ 到 HKG DO ~155ms
- 免費方案不進 TPE；治本方向是 zone 升 Pro/Business 再把 DO 切回 apac

所以 `locationHint` 預設 **wnam**（跟著入網點）。診斷工具：`GET /whereami/<房號>` 回 `{doColo, edgeColo}`，主控台點右上的連線燈會展開右下浮窗顯示 DO／邊緣落點，兩個值都要寫進報告。

### 假 client 壓力測試

```bash
node tools/fakeclients.mjs wss://<你的網域>/ws <房號> 8 30
```

8 個假 client 各以 300ms/shake + 100ms/tap 上報 30 秒。兩台實機同場開著，看實機延遲在 8 人負載下的增幅。

### 匯出格式

```jsonc
{
  "roomId": "ABCD",
  "clients": [ { "clientId", "name", "device": { /* ua, screen, motionEventRateHz, ... */ }, "sync" } ],
  "events": [
    // join / syncResult / tap / spamSummary / shake / stage / ready
    // freezeRound / freezeTurn / freezeAct（含 verdict）
    // skiStart（含 seed 與 speedMul）/ skiRun / skiDone / skiEnd
  ]
}
```

所有 client 時間戳都已用 clock offset 換算到伺服器時間軸（offset = t1 − (t0+t2)/2，取 RTT 最小樣本）。

## 計費防呆

這個 POC 用非 hibernation 的 WebSocket，**只要還有分頁連著，DO 就一直佔記憶體計費**；client 又有自動重連＋每 10 秒背景對時，忘記關的分頁會永遠戳著 DO。防呆有三層：

- **閒置自動關房**：30 分鐘沒有真實互動（ping／背景對時不算）→ DO 踢掉所有連線後休眠
- **最長壽命 6 小時**：無條件關房
- **主控台「結束房間」鈕**：先自動匯出 JSON，再踢掉所有人。**每輪玩完建議按這顆**

被關房的 client 會看到「房間已結束」且不再重連（WS close code 4000/4001）。房間沒有寫任何持久化儲存，所以連線清空後成本歸零。

## 專案結構

```
worker/index.js       # 路由 + DO binding（/ws/:room、/export/:room、/whereami/:room）
worker/room.js        # RoomDO：房間狀態機、對時 pong、遊戲判定、遙測、匯出、計費防呆
public/host.html      # 主控台：遊戲畫面 + 說明卡 + 手感調校 + 管理・測試分頁
public/client.html    # 手機端：加入、Phase 0 探針、兩款遊戲的控制器
public/shared.js      # 對時、WS 封裝（自動重連）、遙測批次、裝置指紋
public/engine/
  chara.js            #  程序化 32 單位角色（8 套玩家配色、滑雪板、可旋轉）
  mode7.js            #  Mode 7 掃描線地面（草／雪／石／土）＋分割畫面渲染＋座標投影
  course.js           #  滑雪賽道：種子生成、碰撞、跳台判定、路邊標竿
  paint.js            #  名畫載入／像素化＋變色龍渲染（Wikimedia 直連，退程序化抽象畫）
  cans.js             #  砸罐子：pixel 2.5D 材質＋輕量物理（沉降、支撐、炸彈連鎖）
  sfx.js              #  程序化 WebAudio 音效（零音檔）
public/bench.html     # 分割渲染壓測
public/game6.html     # 名畫變色龍原型
tools/fakeclients.mjs # 假 client 壓力測試
```

## 已知限制

- **手感未定案**：滑雪速度、變色龍難度、砸罐子回充都還在調，用 ⚙︎ 手感面板現場決定
- **陀螺儀雷射筆的漂移**：iOS 的 alpha 角會漂，靠「游標回中央」＋觸控板備援；漂多快要真機量
- **iOS 只驗過一部分**：感測器權限與連點防縮放已在 iPhone 上跑過；連點觸發雙擊縮放的修法只在模擬器驗過機制，Safari 本尊要再確認
- **傾斜轉向在劇烈連點下的穩定度**：EMA α=0.16 重低通 ＋ 3.5° 死區，代價是轉向變鈍，真機還要再調
- 遙測存 DO 記憶體，**閒置回收即消失**，測完立刻匯出
- `tShow` 類的顯示延遲含螢幕更新等系統性常數偏差，組間比較有效，絕對值不要拿去跟文獻比
