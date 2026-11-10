# Cloudflare Pages 部署

本專案是純靜態網站，不需要 React、Next.js 或資料庫。部署後資料仍保存在瀏覽器，不會新增登入或跨裝置同步。

## 連接 GitHub（建議）

1. 將部署相關變更提交並推送至 `win30221/stock-journey`。
2. 在 [Cloudflare 控制台](https://dash.cloudflare.com/) 進入 **Workers & Pages → Create application → Pages → Import an existing Git repository**。請選 Pages；既有同名 Worker 不需要刪除。
3. 連接 GitHub 並選擇 `stock-journey` 儲存庫；需要授權時可只授權此儲存庫。
4. 填入以下設定：

| 欄位 | 值 |
| --- | --- |
| Project name | `stock-journey`（若不可用，可另取名稱） |
| Production branch | `main` |
| Framework preset | `None` |
| Root directory | 留空，使用儲存庫根目錄 |
| Build command | `node scripts/build-pages.cjs` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `24` |

5. 按 **Save and Deploy**，完成後開啟控制台提供的 `https://<project-name>.pages.dev` 網址。之後推送 `main` 會自動部署正式版本，其他分支可產生預覽部署。

市場請求仍由瀏覽器直接呼叫 FinMind；不需要 Cloudflare API 金鑰或伺服器環境變數。

## 手動部署

```sh
node scripts/build-pages.cjs
```

只上傳 `dist/`，不要上傳整個儲存庫，以免公開交易 CSV。產物只含 `index.html`、`styles.css`、`app.bundle.js`，每次建置會清空重建。根目錄 bundle 不會被此指令修改。

不使用 Git 整合時，可在 Pages 選 **Drag and drop your files** 上傳 `dist/`。Direct Upload 專案日後不能直接改成 Git 整合，需要另建專案。

已安裝 Wrangler 並完成登入時，也可以執行：

```sh
node scripts/build-pages.cjs
npx wrangler pages deploy dist --project-name stock-journey
```

Git 整合的建置命令在控制台設定。專案名稱不同時須修改 CLI 指令。此專案不新增 Wrangler 設定，避免影響同一儲存庫既有的 Workers 部署。

## 搬移資料與驗收

1. 在原網站或本機 HTML 的設定頁匯出 JSON 備份。
2. 在正式 Pages 網址的設定頁還原 JSON。不同網域、預覽網址及瀏覽器有各自的 IndexedDB／localStorage，不會自動取得舊資料。
3. 核對交易、設定與持股，執行市場同步，檢查行情、股息、分割與資料不足提示。
4. 檢查首頁、交易、股票比較與設定；重新整理 `/#transactions` 確認頁面正常。現有 hash 路由不需要 `_redirects`。
5. 檢查鍵盤焦點、對話框與行動版，並確認 CSS、腳本與 FinMind 請求沒有載入錯誤。

發布腳本或樣式變更仍須更新 `index.html` 版本參數。沿用 Pages 預設快取。

官方文件：[Static HTML](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)、[建置設定](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)、[路由與快取](https://developers.cloudflare.com/pages/configuration/serving-pages/)。
