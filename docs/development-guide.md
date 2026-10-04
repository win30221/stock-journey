# 開發與 Next.js 遷移指南

本指南供維護者與 AI agent 共用。閱讀順序為根目錄 `AGENTS.md` → 本文件 → 目標模組及相關測試。更新日期：2026-09-08。

## 現在的架構

本專案仍是原生 JavaScript 靜態網頁，沒有 React／Next.js 執行環境。使用者開啟 `index.html`，載入由來源模組產生的 `app.bundle.js`；資料透過瀏覽器 repository 存在 IndexedDB 或本機儲存。

```mermaid
flowchart TD
  Entry[app.js：畫面與操作協調] --> Model[portfolio-model：組合摘要資料]
  Entry --> Settings[settings：正規化與設定 store]
  Entry --> Tasks[async-state：取消與自動儲存]
  Entry --> UI[components / stock-search：瀏覽器互動]
  Entry --> Repositories[repositories/browser：本機資料]
  Entry --> API[services/finmind：市場 API]
  Model --> Domain[domain：計算與驗證]
  Entry -. 注入 repository .-> Settings
```

目錄名稱不是執行環境的保證：`js/app/settings.js` 可在沒有 DOM 的環境匯入；同目錄的 `stock-search.js` 則包含瀏覽器互動。依實際依賴區分。

| 位置 | 責任 | 未來遷移方式 |
| --- | --- | --- |
| `js/domain/` | 持股、配息、退休、趨勢、匯入驗證 | 保留計算與測試，視需要補 TypeScript 型別 |
| `js/app/portfolio-model.js` | 組合持股、價格、股息、資產及預測 | React 頁面或伺服器直接呼叫 |
| `js/app/settings.js` | 預設設定、相容舊資料、序列化寫入與訂閱 | 每個客戶端 Provider 建立 store，注入資料介面 |
| `js/app/async-state.js` | 可取消工作與延遲儲存 | 保留控制邏輯，接上 React 的建立與清理生命週期 |
| `js/repositories/browser.js` | 現有瀏覽器資料存取 | 初期沿用；雲端化時新增有相同契約的介面 |
| `js/services/finmind.js` | 市場請求、逾時與取消 | 決定留在客戶端或由伺服器代理，保留錯誤語意 |
| `app.js`、`js/components/`、`js/app/stock-search.js` | HTML、DOM、路由與 UI 狀態 | 按功能改寫成 React 元件／hooks |
| `styles.css` | 目前樣式與設計 token | 先保留視覺結果，再按元件範圍整理 |
| `scripts/build-static.cjs`、`app.bundle.js` | 支援本機 HTML 的建置 | 正式切換交付方式後交由 Next.js 建置取代 |

## 已建立的核心介面

### 設定

`normaliseSettings(source, { asOfMonth, resetMarketSync })` 負責載入與還原的相容規則；`asOfMonth` 由呼叫端明確提供。載入與還原都使用這個入口，避免兩套規則逐漸不同。

`createSettingsStore({ repository, initialSettings })` 的 repository 只需提供非同步 `save(record)`，因此核心不需要知道資料存在 IndexedDB 還是伺服器。

- `getSnapshot()`：讀取目前設定；未變更時保持同一參照。
- `getRevision()`：讀取資料版本，供載入流程辨識舊快照。
- `subscribe(listener)`：成功更新後通知，回傳解除訂閱函式。
- `save(patch)`：排隊寫入，寫入成功後才更新快照；失敗會拒絕該次 Promise，後續寫入仍可執行。
- `replace(snapshot)`：替換記憶體狀態並通知，不寫入 repository。
- `whenIdle()`：等待已排隊寫入結束；寫入錯誤由各次 `save()` 的呼叫端處理。

快照視為唯讀，不得直接修改 `getSnapshot()` 的屬性。`app.js` 現階段由訂閱更新讀取參照，畫面不再自行修改設定預設值。

載入流程先等待寫入，記住 revision，再讀 repository；資料返回時只有 revision 仍相同才套用設定。清除／還原另須等待舊寫入與資料遷移後再替換。`replace()` 本身不是取消請求或中止寫入的工具。

未來 React 可以使用此訂閱介面搭配 `useSyncExternalStore`。store 要由對應使用者／Provider 持有，避免在 Next.js 伺服器模組中建立跨請求共享的使用者設定。SSR 初始快照需與首次客戶端渲染一致；本機儲存資料在瀏覽器掛載後讀取。

### 投資摘要

`calculatePortfolioSnapshot({ transactions, marketCaches, dividendDateBasis, asOfDate, requiredThroughDate })` 回傳以下資料：

- 持股與各股票最新價格。
- 資產、成本與股息摘要。
- 年股息預測、涵蓋範圍及殖利率。

它不讀 DOM、不存資料、不發請求。`asOfDate` 是報表日期，`requiredThroughDate` 是市場資料應涵蓋的交易日；兩者可能因週末或休市而不同。未取得報價時保留成本估算，股息歷史不足時保留 coverage 資訊，畫面必須呈現這些限制。

`asOfDate` 控制持股、價格與分割的計算基準，股息報表仍保留已公告的未來發放項目。因此整份摘要不是只含過去資料的歷史損益報表；歷史資產曲線由 `calculateTrendHistory` 產生。

目前 `app.js` 依交易陣列、快取陣列、日期與股息依據快取摘要。更新資料時必須替換陣列參照，否則快取不會失效。核心輸出為普通資料物件，方便未來作為 API 回應或畫面 props。

## 建議的遷移順序

1. **建立 Next.js 基礎與資料型別。** 新建 layout、頁面路由與型別；沿用 domain、設定與摘要模組。此步才安裝 Next.js／React，現階段不需要框架相依套件。
2. **先遷移設定頁。** 接上 settings store、錯誤／重試與瀏覽器 repository，驗證訂閱及卸載時的儲存處理。
3. **逐頁遷移總覽、交易、預算與試算。** HTML 字串改成 React 元件，事件改成 React handlers，頁面草稿留在元件狀態；計算仍呼叫原核心。
4. **遷移同步及互動生命週期。** 明確定義控制器的建立、取消與清理，涵蓋下列清單。
5. **另一步加入登入與雲端資料。** 實作 API、使用者權限、資料庫及資料遷移，保留備份匯入入口。Next.js 本身不會將本機資料自動上傳或同步。
6. **驗收後移除舊入口與建置。** 保留 domain／store 測試，將 DOM 模擬及字串結構測試逐步換成 React 互動與真實瀏覽器測試。

新專案可採 `src/app/` 放路由，`src/components/` 放 React 元件，`src/domain/` 放計算，`src/application/` 放設定與摘要組合，`src/data/` 放客戶端／伺服器資料介面。這是未來建議布局，目前目錄尚未改成這套結構。

## 尚未完成的生命週期工作

目前 `app.js` 仍有模組層級 UI 狀態，匯入會讀取 DOM、註冊事件並啟動載入。它不能直接匯入 Server Component，也尚未提供可重複 mount/dispose 的介面。

將現有畫面暫時嵌入 React 前，至少需要完成：

- 對 `visibilitychange`、`online`、`hashchange` 註冊與解除成對處理。
- 卸載立即使舊工作失效，取消同步並等待已開始的寫入；舊 callback 不得重新排程或更新新畫面。
- 處理載入、檔案讀取、儲存與還原確認中的 Promise；一般切頁／卸載應保留已輸入設定，清除／還原才丟棄舊待儲存值。
- 清理拖曳期間的 document pointer listeners、長按數字按鈕 interval、Undo timer 及焦點／圖表 animation frame。
- 對話框、確認視窗、toast 與股票搜尋改成由實例管理，清理 body 狀態、inert、焦點、blur timer 及未完成請求。
- DOM 查詢限制在自己的掛載範圍，避免舊實例操作新頁面同 ID 的元素。

須以重複掛載、未完成請求中卸載、拖曳／長按中卸載等測試驗證。較直接的路線是逐頁重建 React UI，沿用計算與資料模組。

## 客戶端、伺服器與本機資料

互動狀態與 `window`、localStorage、IndexedDB 放在客戶端生命週期。`'use client'` 不代表匯入及首次渲染可以任意讀取瀏覽器物件，Client Components 仍可能被預先渲染。

伺服器可使用純計算與摘要模組，但資料必須來自具備使用者權限的介面。各層交界採普通資料物件與明確的日期字串，是本專案方便備份、測試與 API 交換的約定。

現有資料依瀏覽器與網站來源儲存。從 `file://` 換到網站網址，或更換網域時，應提供 JSON 備份匯出／還原流程，不能假設新來源可以直接讀取舊資料。

Next.js 靜態匯出可繼續使用靜態主機，但應規劃透過網址開啟；目前雙擊 HTML 的交付方式不應被視為自動保留。登入、動態寫入 API 等功能則需相應的服務端設施。

官方參考：[Server／Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)、[Static Exports](https://nextjs.org/docs/app/guides/static-exports)、[Project Structure](https://nextjs.org/docs/app/getting-started/project-structure)。採用時核對目標 Next.js 版本。

## 驗證方式

在專案根目錄執行 `node scripts/build-static.cjs`、`node --test`、`node scripts/build-static.cjs --check`、`git diff --check`。本次驗證環境為 Node.js 26.8.1。

- `tests/architecture.test.js`：阻止可重用模組依賴畫面／儲存／網路，檢查無瀏覽器環境匯入。
- `tests/settings-store.test.js`：設定訂閱、寫入排隊、失敗恢復與實例隔離。
- `tests/portfolio-model.test.js`：摘要一致性、估算語意與跨時區日期。
- 其餘測試涵蓋既有計算、同步取消、清除還原、設定競爭、互動及靜態產物。

`tests/support/` 的 VM／模擬 DOM 只用於測試，未被打包。既有部分測試會查看或替換程式字串；後續改寫 React 時應保留它們所保護的行為，逐步改用公開介面驗證。

自動測試通過不能代替實際瀏覽器排版、鍵盤與行動裝置驗收。當工具政策阻擋瀏覽器驗證時，應列出限制，不得宣稱已完成視覺驗收。

## 分割校正與股票比較（2026-09-29）

- `js/domain/splits.js`：純函式，解析分割事件、計算累積股數倍率與價格換算。所有計算接收日期；分割當天的交易已屬新股數基準，只有事件日前的持股乘倍率。多次事件累乘，總取得成本不變。反分割保留小數等值股數，不自行假設零股售出日或現金結算價。
- `TaiwanStockSplitPrice` 以完整清單同步，涵蓋來源提供的分割、反分割及面額變更。參考價會四捨五入，不能直接用前後價相除：以一分錢誤差容許值、分母 1～10／分子 1～1000 尋找唯一比例。這是推得的比例，不是來源直接提供的法定股數比例；沒有唯一解就標記錯誤，不能猜測。來源未列出的事件亦無法自動補出。
- 市場快取新增 `splits`、`splitCheckedThrough`、`splitError`。成功更新以完整快照取代，處理修訂／取消；失敗保留舊事件並標記不完整。舊快取缺少確認日期時會自動補查。這些欄位是可重建快取，JSON 個人資料備份 schema 維持 3。
- 持股、市值、逐筆與群組損益、資產走勢、股息收取及預估股息都使用相同分割規則。`calculateHoldingGroups(transactions, marketCaches, asOfDate)` 支援日期與事件輸入；舊單參數呼叫仍可用。`calculatePortfolioSnapshot` 的持股和最新價格現以 `asOfDate` 截取，價格再換成該日股數基準；已公告的未來股息仍保留供畫面呈現。
- 配息領取按除息資格日持股計算，不以發放日股數代替。近 12 個月預估股息會把歷史每股配息換算成目前股數基準；配息與分割資料都完整時才顯示完整退休試算。行情表保留未還原 OHLC，分割日加標記，行情漲跌幅改用同基準的前收盤價。
- `js/domain/comparison.js`：計算 2～5 檔的共同起訖交易日，以分割調整後價格起算 0%。中間缺價為 `null`，不補 0、不畫連接線。支援 `mode: price | cash | stock | total`，分別為純股價、現金再投入、配股、兩者皆含；未傳 mode 時保留 `reinvestDividends`／`reinvest` 的舊布林入口（true 對應 total）。`normaliseComparisonDividends(rows)` 加總盈餘及公積股利，分別保留 `exDate` 與 `stockExDate`。現金於除息日收盤價買入小數股，股票股利於除權日以每 10 元換算 1 股；同日所有股利使用相同資格股數，不讓同日新股再次領息。現金事件缺當日價格、所選股利缺日期或覆蓋不足時停止計算；其他缺價日保留曲線缺口。
- `js/app/comparison-page.js`：搜尋、多選、日期、股息再投入切換、圖表與浮動 tooltip。依賴透過參數注入；直接沿用 `stockSearch.suggestions()`／`resolve()` 與 FinMind service。提供現金再投入與配股兩個獨立按鈕，均使用 aria-pressed。任一開啟時查詢 `TaiwanStockDividend`（1990-01-01 至 2100-01-01），涵蓋來源已公告的完整資料，避免 API 的權利分派基準日篩選漏掉圖表期末除息；覆蓋僅確認至傳入的市場日期，不宣稱未來資料完整。比較股利只沿用本頁工作階段的完整格式，不沿用持股頁舊快取。切換選項先取消舊工作，等待結束後以固定 mode 重新計算；revision 防止清除／日期修改後復活。成功快照在工作階段內重用，清除或重新開啟會重新取得公告修訂。清除／還原時由 `replaceDataSafely()` 取消比較請求並清空工作階段快取，避免舊回應復活。
- 股票比較使用 `#stock-comparison`，側欄位於「額外工具」。圖表同時提供鍵盤、觸控、文字摘要和每日資料表。切換日期／標的會清除舊結果並取消請求；分割或股息查詢失敗會阻止產生誤導曲線。
- 原本已把分割股數人工當作「配股」記入的資料不會自動刪除或猜測修正；畫面明確提醒核對，避免重複加股。

新增回歸在 `tests/splits-comparison.test.js` 與 `tests/sync-lifecycle-regression.test.js`，涵蓋分割同日買進、多次分割／反分割、舊價格換算、股息基準、浮動 tooltip、缺價、失敗重試與同步取消。根目錄三份過時測試入口改為轉用 `tests/` 的維護版本，避免繼續測試舊版拼接方式。

比較日期是查詢範圍，不受交易日曆最新日期的 `max` 限制。結束日可晚於最新行情，使用範圍內共同可用的起訖交易日並顯示實際區間；分割涵蓋檢查也以實際終日為準。查詢未來／尚無行情日期時，不把尚未涵蓋的日期寫成已完成快取，下次仍能查得新價格。
