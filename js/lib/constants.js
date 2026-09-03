// Shared configuration, independent from UI and browser storage.
export const BACKUP_SCHEMA_VERSION = 3;
export const APP_VERSION = '1.0.0';
export const ACQUISITIONS = {
  MANUAL_BUY: '自行買進', RECURRING_INVESTMENT: '定期定額',
  DIVIDEND_REINVESTMENT: '股息再投入', STOCK_DIVIDEND: '配股',
};
export const TREND_EVENT_MARKER_SETTINGS = [
  { id: 'showNewStockMarker', label: '顯示新買股票點' },
  { id: 'showManualBuyMarker', label: '顯示自行買進點', type: 'MANUAL_BUY' },
  { id: 'showRecurringInvestmentMarker', label: '顯示定期定額點', type: 'RECURRING_INVESTMENT' },
  { id: 'showDividendReinvestmentMarker', label: '顯示股息再投入點', type: 'DIVIDEND_REINVESTMENT' },
  { id: 'showStockDividendMarker', label: '顯示配股點', type: 'STOCK_DIVIDEND' },
];
export const TAIPEI_TIME_ZONE = 'Asia/Taipei';
export const MARKET_DATA_READY_MINUTES = 18 * 60;
export const MARKET_RETRY_BASE_MINUTES = 5;
