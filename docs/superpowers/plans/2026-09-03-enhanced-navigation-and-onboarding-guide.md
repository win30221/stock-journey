# 系統導覽與新手旅程導引強化實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 強化「存股退休」系統的導覽體驗與新手旅程導引，包含側邊欄與手機導覽列步驟徽章連動、首頁雙任務旅程進度卡、以及子頁面連貫導引橫幅。

**Architecture:** 
- 狀態層：以純粹狀態推導函式 `getOnboardingState({ budgetItems, transactions })` 統一判斷步驟進度（0/2, 1/2, 2/2），確保無額外非同步全域狀態。
- 介面層：
  1. 導覽列（`nav`）依據狀態掛載 `.nav-badge`（待設定 / 待匯入 / ✓），兩步完成後自動隱藏；
  2. 首頁頂部升級為雙欄任務進度卡（`journey-card`），包含動態進度條與可點擊直達按鈕；
  3. 退休規劃與持股交易頁面頂部在未完成時呈現情境導引橫幅（`contextual-step-banner`）。
- 樣式層：Vanilla CSS 配合既有科技藍設計系統，響應式支援行動裝置抽屜與桌面側邊欄。

**Tech Stack:** Native ES Modules (JavaScript), Vanilla CSS, Node.js Test Runner (`node --test`), `scripts/build-static.cjs`.

## Global Constraints
- 所有檔案路徑必須精確。
- 維持 `ui-structure.test.js` 中的既有約束（導覽按鈕採用完整選中表面，避免 inset edge indicator；手機抽屜保持 a11y 與 sticky 等）。
- 測試命令統一使用 `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test`。
- 修改 `app.js` 或相依模組後，必須執行 `node scripts/build-static.cjs` 保持 `app.bundle.js` 同步。

---

### Task 1: 建立統一的 Onboarding 狀態推導邏輯與單元測試

**Files:**
- Modify: `app.js`
- Test: `ui-structure.test.js`

**Interfaces:**
- Produces: `getOnboardingState(budgetItems, transactions)` 返回 `{ budgetDone: boolean, holdingsDone: boolean, completedCount: number, totalSteps: number, progressPercent: number, isComplete: boolean }`

- [ ] **Step 1: 在 `ui-structure.test.js` 新增狀態推導的測試案例**

```javascript
test('onboarding state accurately derives progress and completion from items and transactions', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  assert.match(source, /function getOnboardingState\(/);
});
```

- [ ] **Step 2: 執行測試驗證失敗**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test --test-name-pattern="onboarding state accurately derives"`
Expected: FAIL (function not found)

- [ ] **Step 3: 在 `app.js` 實作 `getOnboardingState`**

```javascript
function getOnboardingState(items = budgetItems, txs = transactions) {
  const budgetDone = items.some(item => item.isActive !== false && Number(item.occurrenceAmount) > 0);
  const holdingsDone = txs.length > 0;
  const completedCount = Number(budgetDone) + Number(holdingsDone);
  const totalSteps = 2;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);
  const isComplete = completedCount === totalSteps;
  return { budgetDone, holdingsDone, completedCount, totalSteps, progressPercent, isComplete };
}
```

- [ ] **Step 4: 執行測試驗證通過**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test --test-name-pattern="onboarding state accurately derives"`
Expected: PASS

- [ ] **Step 5: 提交變更**

```bash
git add app.js ui-structure.test.js
git commit -m "feat: add unified getOnboardingState helper"
```

---

### Task 2: 側邊欄與手機導覽列步驟徽章連動與視覺強化

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Test: `ui-structure.test.js`

**Interfaces:**
- Consumes: `getOnboardingState()`
- Produces: `<span class="nav-badge ...">` 渲染於導覽按鈕內

- [ ] **Step 1: 在 `ui-structure.test.js` 新增導覽列徽章渲染與樣式測試**

```javascript
test('navigation renders actionable step badges during onboarding and hides them when complete', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const styles = fs.readFileSync('styles.css', 'utf8');
  assert.match(source, /nav-badge/);
  assert.match(styles, /\.nav-badge/);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test --test-name-pattern="navigation renders actionable step badges"`
Expected: FAIL

- [ ] **Step 3: 在 `app.js` 與 `styles.css` 實作導覽列徽章與選中狀態強化**

在 `app.js` 中的導覽渲染函式中：
根據 `pageId` 與 `onboardingState`，若 `!onboardingState.isComplete`：
- `budget`: 若未完成顯示 `<span class="nav-badge pending" aria-label="待設定">待設定</span>`，已完成顯示 `<span class="nav-badge done" aria-label="已設定">✓</span>`
- `transactions`: 若未完成顯示 `<span class="nav-badge pending" aria-label="待匯入">待匯入</span>`，已完成顯示 `<span class="nav-badge done" aria-label="已匯入">✓</span>`

在 `styles.css` 加入相應樣式（`.nav-badge`, `.nav-badge.pending`, `.nav-badge.done`），並優化 `nav button.active` 表面視覺層級。

- [ ] **Step 4: 執行測試確認通過**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test`
Expected: PASS

- [ ] **Step 5: 提交變更**

```bash
git add app.js styles.css ui-structure.test.js
git commit -m "feat: add navigation step badges and active state polish"
```

---

### Task 3: 首頁雙任務旅程卡片（Journey Progress Card）升級

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Test: `ui-structure.test.js`

**Interfaces:**
- Consumes: `getOnboardingState()`
- Produces: `overviewJourneyCard(onboardingState)` 取代舊的 `onboardingChecklist()`

- [ ] **Step 1: 在 `ui-structure.test.js` 新增雙任務旅程卡片測試**

```javascript
test('overview renders comprehensive journey progress card with dual task steps', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const styles = fs.readFileSync('styles.css', 'utf8');
  assert.match(source, /overviewJourneyCard/);
  assert.match(source, /role="progressbar"/);
  assert.match(styles, /\.journey-card/);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test --test-name-pattern="overview renders comprehensive journey progress card"`
Expected: FAIL

- [ ] **Step 3: 實作 `overviewJourneyCard` 與對應 CSS**

在 `app.js` 中實作 `overviewJourneyCard()`，包含：
- 頂部標題與說明文字
- 醒目的進度條（`role="progressbar"`，含 `aria-valuenow`）
- 雙任務卡：任務 1「設定生活預算」與任務 2「登錄持股紀錄」，點擊直達對應頁面
- 綁定對應的導引跳轉事件監聽
在 `styles.css` 新增精美卡片式佈局樣式，支援手機版自適應單欄。

- [ ] **Step 4: 執行測試確認通過**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test`
Expected: PASS

- [ ] **Step 5: 提交變更**

```bash
git add app.js styles.css ui-structure.test.js
git commit -m "feat: implement dual-task journey progress card on overview"
```

---

### Task 4: 子頁面連貫導引橫幅（Contextual Step Banner）

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Test: `ui-structure.test.js`

**Interfaces:**
- Consumes: `getOnboardingState()`
- Produces: `contextualStepBanner(page)` 注入至 `livingBudgetPage()` 與 `transactionsPage()`

- [ ] **Step 1: 在 `ui-structure.test.js` 新增子頁面導引橫幅測試**

```javascript
test('budget and transaction pages render contextual step banners during onboarding', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  assert.match(source, /contextualStepBanner/);
  assert.match(source, /data-step-action/);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test --test-name-pattern="budget and transaction pages render contextual step banners"`
Expected: FAIL

- [ ] **Step 3: 實作 `contextualStepBanner` 與跳轉事件**

在 `app.js` 中：
- 當在預算頁時：未完成提示新增生活支出；完成後提示前往持股或返回首頁。
- 當在持股交易頁時：未完成提示匯入或新增；完成後提示返回首頁查看成果。
- 在 `styles.css` 實作頂部浮貼或面板前綴的精美引導橫幅樣式。

- [ ] **Step 4: 執行測試確認通過**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test`
Expected: PASS

- [ ] **Step 5: 提交變更**

```bash
git add app.js styles.css ui-structure.test.js
git commit -m "feat: implement contextual step banners on budget and transaction pages"
```

---

### Task 5: 靜態建置更新與全套回歸測試

**Files:**
- Modify: `app.bundle.js`
- Test: All tests via `node --test`

- [ ] **Step 1: 執行靜態打包腳本**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node scripts/build-static.cjs`
Expected: "built app.bundle.js"

- [ ] **Step 2: 執行全套單元與結構測試**

Run: `export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin; node --test`
Expected: All tests pass (0 failures)

- [ ] **Step 3: 提交 bundle 更新**

```bash
git add app.bundle.js
git commit -m "chore: rebuild static bundle with enhanced navigation and onboarding guide"
```
