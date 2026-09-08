# 系統導覽與新手旅程導引強化設計規格書

- **日期**：2026-09-03
- **狀態**：已確認（Approved）
- **主題**：導覽列視覺層級提升、步驟徽章連動、首頁旅程進度卡與子頁連貫導引

---

## 1. 背景與目標

「存股退休」系統的核心價值是結合「生活預算目標」與「持股現金流」，即時推算退休覆蓋率與資產軌跡。
目前系統具備基本的新手引導（單行小卡片），但存在以下痛點：
1. **導覽列（Navigation Bar）視覺偏淡且缺乏狀態回饋**：當前頁面 Active 狀態不夠鮮明，且無從得知關鍵步驟（如退休規劃、持股交易）是否已完成。
2. **新手引導卡片太薄弱**：在首頁容易被下方龐大的覆蓋率卡片遮蓋光芒，無法建立清晰的「存股退休旅程地圖」。
3. **跳轉子頁面後引導中斷**：點擊前往「退休規劃」或「持股與交易」後，引導提示完全消失，缺乏跨頁面的操作指引與完成後的「下一步」連結。

本規格旨在打造「全鏈路旅程導引體系（Full-Journey Guided Experience）」，讓導覽列與操作流程具備清晰進度反饋，同時在新手完成設定後自然退居幕後，保持日常使用的專注與整潔。

---

## 2. 核心架構與狀態模型 (State Model)

引導狀態由現有資料結構統一推導，不額外增加多餘全域變數，確保單一真實資料來源（Single Source of Truth）：

```javascript
function getOnboardingState() {
  const budgetDone = budgetItems.some(item => item.isActive !== false && Number(item.occurrenceAmount) > 0);
  const holdingsDone = transactions.length > 0;
  const completedCount = Number(budgetDone) + Number(holdingsDone);
  const isComplete = completedCount === 2;
  const progressPercent = completedCount * 50;

  return {
    budgetDone,
    holdingsDone,
    completedCount,
    totalSteps: 2,
    progressPercent,
    isComplete
  };
}
```

---

## 3. 詳細功能規格

### 3.1 側邊欄與手機導覽列強化 (Sidebar & Mobile Nav Polish)

#### A. 視覺層級與選中狀態
- **Active 狀態優化**：
  - 加強左側 Accent 指示線（例如 3px 深藍指示條或光暈邊框）。
  - 微調文字字重與背景色（採用柔和的藍調背景 `var(--blue-soft)`，提高與未選中按鈕的辨識度）。
- **結構分組與微動效**：
  - Hover 效果平滑自然（160ms ease）。

#### B. 導覽列步驟徽章 (Navigation Badges)
- 在未完全達成（`isComplete === false`）期間：
  - **退休規劃按鈕**：
    - 若 `budgetDone === false`：顯示標籤 `<span class="nav-badge badge-pending">待設定</span>` 或高辨識度小圓點。
    - 若 `budgetDone === true`：顯示精緻的 `<span class="nav-badge badge-done" aria-label="已設定">✓</span>`。
  - **持股與交易按鈕**：
    - 若 `holdingsDone === false`：顯示標籤 `<span class="nav-badge badge-pending">待匯入</span>`。
    - 若 `holdingsDone === true`：顯示 `<span class="nav-badge badge-done" aria-label="已匯入">✓</span>`。
- 當 `isComplete === true` 時：
  - 徽章自動隱藏，導覽列回歸純淨無干擾狀態。

---

### 3.2 首頁「新手旅程卡片」(Overview Hero Journey Card)

取代原本單行的小型 `onboardingChecklist()`，升級為卡片式雙步驟進度儀表板：

#### A. 視覺與版面配置
- 位於首頁頂部（覆蓋率卡片之前）。
- 採用乾淨卡片風格，含淡柔外框與層次陰影。

#### B. 卡片內含元素
1. **頂部進度區（Header & Progress Bar）**：
   - 標題：`🎯 開始您的存股退休旅程`
   - 輔助說明：`完成以下 2 步驟，系統將自動計算退休生活費覆蓋率與資產成長軌跡。`
   - 進度指示：`進度：${completedCount} / 2 (${progressPercent}%)`
   - 動態進度條：具有圓角與品牌藍填充條（`width: ${progressPercent}%`），包含平滑寬度過渡動畫。
2. **雙任務卡（Two-Column Task Cards）**：
   - **任務 1：規劃生活預算**
     - 圖標/序號：未完成顯示序號 `1`；已完成顯示綠底打勾 `✓`。
     - 標題與簡介：「設定生活預算」— 填寫固定或品質開銷，換算退休每月目標現金流。
     - 按鈕：未完成時為 `前往設定預算 →`（Primary 風格）；已完成時為 `查看預算明細`（Ghost 風格）。
   - **任務 2：登錄持股紀錄**
     - 圖標/序號：未完成顯示序號 `2`；已完成顯示綠底打勾 `✓`。
     - 標題與簡介：「登錄持股紀錄」— 支援券商 CSV 匯入、AI 輔助整理或手動新增買進紀錄。
     - 按鈕：未完成時為 `匯入/新增持股 →`（Primary 風格）；已完成時為 `管理交易紀錄`（Ghost 風格）。
3. **完成狀態（2/2）**：
   - 當兩步皆達成時，首頁自動隱藏新手卡，或若剛完成最後一關時，短暫提供慶祝提示後歸位。

---

### 3.3 子頁面連貫導引橫幅 (Contextual Step Banner)

當使用者在未完全完成新手流程時進入「退休規劃」或「持股與交易」頁面，頂部呈現與目前步驟呼應的輕量引導條：

1. **退休規劃頁（Budget Page）**：
   - 若 `budgetDone === false`：
     - 顯示：「🎯 **新手引導 第 1 步**：請在下方新增至少一項基本生活支出（例：房租、生活費）。」
   - 若在該頁完成新增後（`budgetDone === true` 且 `holdingsDone === false`）：
     - 動態呈現：「🎉 **第 1 步已完成！** 前往第 2 步：[加入持股紀錄 →] 或 [返回投資總覽]」。
2. **持股與交易頁（Transactions Page）**：
   - 若 `holdingsDone === false`：
     - 顯示：「🎯 **新手引導 第 2 步**：請點擊『匯入 CSV』或『新增交易』登錄您的第一筆持股。」
   - 若已完成持股（`holdingsDone === true` 且 `budgetDone === false`）：
     - 顯示：「✅ **持股已登錄！** 別忘了完成第 1 步：[設定生活預算 →]」。
   - 若兩步皆已完成：
     - 顯示：「🎉 **太棒了！基礎資料已備齊**，[返回投資總覽查看退休覆蓋率 →]」。
3. 當兩步驟皆已達成且使用者不是剛從新手導引點過來時，橫幅完全不再顯示，不佔用子頁面空間。

---

## 4. 無障礙（Accessibility / a11y）與互動細節

- **ARIA 標記**：
  - 導覽列徽章具備 `aria-label`（例：`aria-label="退休規劃，待設定"`），確保螢幕閱讀器能清楚傳遞當前狀態。
  - 進度條具備 `role="progressbar"`、`aria-valuenow`、`aria-valuemin="0"`、`aria-valuemax="100"`。
- **色彩對比**：
  - 待處理徽章文字與背景符合 WCAG AA 對比標準（>= 4.5:1）。
  - 已完成狀態採用語意綠色 `var(--success)` 輔以圖標 `✓`，不單純依賴顏色區分狀態。
- **響應式佈局（RWD）**：
  - 手機版導覽抽屜內部無縫整合徽章。
  - 首頁雙任務卡在手機螢幕（<= 800px）自動轉為單欄堆疊，保持文字易讀與按鈕寬度舒適（min-height 40px）。

---

## 5. 驗證與測試計畫 (Verification Plan)

1. **自動化測試**：
   - 擴充 `ui-structure.test.js`：
     - 驗證導覽列按鈕能正確渲染未完成與已完成狀態徽章。
     - 驗證新手卡包含進度條、ARIA 屬性與任務按鈕。
     - 驗證子頁面引導條的狀態渲染邏輯。
   - 執行 `npm test`，確保既有單元測試（`data-safety.test.js`、`domain.test.js`、`format.test.js`、`ui-structure.test.js` 等）全部 100% 通過。
2. **構建與靜態檢查**：
   - 檢查 `app.js` 與 `styles.css` 是否一致，並更新 `app.bundle.js`（若專案有捆綁/快照測試需求）。
