# 連線版 Cloudflare 部署

本文件適用 `codex/online-platform` 分支。`main` 保留既有本機版本；連線版的 Pages 正式部署分支必須設定為 `codex/online-platform`。目前僅完成程式與本機測試，尚未建立線上資源或更動控制台。

## 目錄與部署邊界

- `frontend/`：原生 JavaScript 前端、純計算核心與本機模式。雙擊 `frontend/index.html` 可使用原本的本機儲存。
- `backend/server/`：Google 憑證驗證、session 與個人資料 API。
- `backend/migrations/`：D1 SQL 初始化及後續資料庫遷移。
- `functions/api/[[path]].js`：Pages 必要路由入口，僅轉交 backend；此目錄必須位於 Pages 專案根目錄。
- `scripts/`、`tests/`、`docs/`：共用建置、測試及文件。

`node scripts/build-pages.cjs` 產生 `dist/`，並在 HTML 加入 cloud 模式標記。部署版本不會因 API 失敗而改存本機。公開產物仍只有 HTML、CSS、bundle 和公開範例 CSV；後端由 Pages 另外打包，不能將整個 repository 上傳為靜態資源。

## 1. 建立 Google 登入用戶端

1. 在 Google Cloud Console 建立／選擇專案，設定 Google Auth Platform 的 Branding、Audience 與網站資料。
2. 建立 OAuth 用戶端，類型選「網頁應用程式」。
3. Authorized JavaScript origins 加入完整正式 origin，例如 `https://stock-journey-online.pages.dev`，之後使用自訂網域也須加入。不要加入 hash 或路徑。
4. 本版使用 Google Identity Services 的 JavaScript callback，後端驗證 ID token；不需要 OAuth client secret 或 redirect callback URL。
5. 測試模式下，依 Google 控制台要求加入測試使用者；公開上線前完成相應發布設定。
6. 複製 Client ID（通常以 `.apps.googleusercontent.com` 結尾）。Client ID 為公開識別值；不把登入憑證存進 localStorage。

## 2. 建立 D1

以下命令都在 repository 根目錄、`codex/online-platform` 分支執行。使用有 Cloudflare 權限的帳號：

```sh
npx wrangler login
npx wrangler d1 create stock-journey-online
```

將建立結果的 `database_id` 填入 `backend/wrangler.d1.jsonc` 的同名欄位，再執行：

```sh
npx wrangler d1 execute DB --config backend/wrangler.d1.jsonc --remote --file backend/migrations/0001_accounts.sql
```

第一次 SQL 使用 CREATE IF NOT EXISTS，可重複執行，不會清除既有個人資料。請勿在後續部署時刪除重建資料庫。

## 3. Pages Git 整合

建議為連線版建立獨立 Pages project，例如 `stock-journey-online`，保留原站：

| 設定 | 值 |
| --- | --- |
| Repository | `win30221/stock-journey` |
| Production branch | `codex/online-platform` |
| Framework preset | None |
| Root directory | 留空，使用 repository 根目錄 |
| Build command | `node scripts/build-pages.cjs` |
| Output directory | `dist` |
| NODE_VERSION | `24` |

在 Pages Settings 的 Variables and Secrets 設定 `GOOGLE_CLIENT_ID`；在 Bindings 新增名為 `DB` 的 D1 binding，指向 `stock-journey-online`。設定完成後重新部署。這兩項都必須對應正式環境，不能只設 Preview。

在 Builds 的分支控制中停用其他分支的 Preview 自動部署，或只允許連線版分支。建置腳本另會拒絕 `CF_PAGES_BRANCH` 不是 `codex/online-platform` 的建置。Production branch 是控制台設定，單純建立本機 Git 分支不會自動改變它。

若使用手動 CLI 部署，須先確認目前分支，然後在根目錄執行：

```sh
git switch codex/online-platform
node scripts/build-pages.cjs
npx wrangler pages deploy dist --project-name stock-journey-online --branch codex/online-platform
```

不可使用控制台拖曳純靜態檔案方式部署這個連線版，因為本版需要 Pages Functions。也不要改用 Workers deploy 命令或變更原先獨立 Worker。

## 4. 本機雲端整合開發

本機 HTML 使用本機模式。測試雲端 API 則先建置 dist，使用 Wrangler 的 Pages 開發伺服器與本機 D1；不連正式資料庫：

```sh
node scripts/build-pages.cjs
npx wrangler d1 execute DB --config backend/wrangler.local.jsonc --local --persist-to .wrangler/local-state --file backend/migrations/0001_accounts.sql
npx wrangler pages dev dist --d1 DB=local-stock-journey --persist-to .wrangler/local-state --binding GOOGLE_CLIENT_ID=你的ClientID --local-protocol https
```

Google origin 設定、瀏覽器對本機 HTTPS 憑證的信任與 Secure Cookie 均須確認；不得為測試正式網域而移除後端 HTTPS 或 Origin 驗證。可先以自動測試驗證後端，正式 Google 登入仍需實際瀏覽器驗收。

## 5. 舊資料搬移

1. 在原網站／舊本機 HTML 匯出 JSON 備份。不同 origin 的資料無法由新站直接讀取。
2. 如果使用相同 origin，新登入畫面與登入後設定頁也提供「下載舊本機備份」，只讀取舊本機資料，不會自動上傳或刪除它。
3. 登入正確 Google 帳號，在設定頁匯入 JSON；確認提示中的帳號資料覆蓋範圍。
4. 核對交易、退休計畫及設定，重新同步行情。
5. 換另一個裝置登入相同帳號，核對資料；其他裝置需重新載入才能看到更新。

## 第一版資料契約與限制

- D1 的 `users.id` 使用 Google `sub`，不以 email 作為不可變識別。session token 以 HttpOnly／Secure／SameSite Cookie 傳送，D1 只存 SHA-256 雜湊，七天到期。
- 登入採同源 JSON POST、Google nonce 及後端簽章／audience／issuer／expiry 驗證。資料 API 另綁定目前頁面帳號，避免另一分頁換帳號後誤寫。
- `account_data` 每帳號一列，儲存 `transactions`、`settings`、`budgetPlans`、`budgetItems` 的 JSON 快照。每次儲存以 revision 條件更新；整份資料還原／清除為單一 SQL 原子更新。
- 第一版個人資料上限為 512 KiB；每次個人資料變更會傳送完整快照，適合初期小型帳號。大量交易或頻繁寫入時應再拆成逐筆資料表與 API，不應宣稱此設計適合無限成長。
- 版本衝突或儲存結果不明時保留輸入，請先另外記下草稿，再重新整理確認；不自動合併，也不自動以新版本重試覆蓋。
- 行情、股息、分割仍由瀏覽器向 FinMind 取得，市場快取留在裝置；尚未建立共享行情服務或背景排程。行情資料不足提示保留。
- 本版沒有離線編輯同步、即時跨裝置推播、帳號刪除或強制撤銷所有裝置登入功能。清除個人資料會清除投資快照，不會刪除 Google 帳號或登入身分。

## 驗收

```sh
node scripts/build-static.cjs
node --test
node scripts/build-static.cjs --check
node scripts/build-pages.cjs
npx wrangler pages functions build --outfile .wrangler/cloud-api.js
git diff --check
```

線上另須驗證 Google 登入／登出、未授權 API、兩帳號隔離、跨裝置新增與衝突、JSON 還原、清除、網路斷線、行動裝置與鍵盤操作。自動測試及 Functions 打包通過，不代表 Google／Cloudflare 控制台已設定或實際瀏覽器驗收已完成。

參考：[Pages Functions](https://developers.cloudflare.com/pages/functions/)、[D1 綁定](https://developers.cloudflare.com/pages/functions/bindings/)、[Google 憑證驗證](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)。
