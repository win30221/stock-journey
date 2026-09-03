// Presentation-only helpers. Future UI components can reuse these unchanged.
export const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
export const fmt = value => value == null ? '—' : `${money.format(Math.round(Number(value)))} 元`;
export const fmtSignedMoney = value => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const rounded = Math.round(Number(value));
  return `${rounded > 0 ? '+' : ''}${money.format(rounded)} 元`;
};
const averageCost = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtAverageCost = value => value == null ? '—' : `${averageCost.format(Number(value))} 元`;
const perShare = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 4 });
export const fmtPerShare = value => value == null ? '—' : `${perShare.format(Number(value))} 元`;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[character]));
}
