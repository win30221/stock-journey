import { escapeHtml } from '../lib/format.js';

export function confirmDestructive({ title, description, details = [], confirmLabel = '刪除' }) {
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('div');
    const detailList = details.length ? `<ul>${details.map(detail => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>` : '';
    dialog.className = 'confirmation-backdrop';
    dialog.innerHTML = `<section class="confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmationTitle" aria-describedby="confirmationDescription"><div class="confirmation-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.01M10.3 3.7 2.9 17.2A2 2 0 0 0 4.7 20h14.6a2 2 0 0 0 1.8-2.8L13.7 3.7a2 2 0 0 0-3.4 0Z"/></svg></div><div class="confirmation-copy"><p class="eyebrow">需要確認</p><h2 id="confirmationTitle">${escapeHtml(title)}</h2><p id="confirmationDescription">${escapeHtml(description)}</p>${detailList}</div><div class="confirmation-actions"><button type="button" class="secondary" data-confirm-cancel>取消</button><button type="button" class="danger confirmation-submit" data-confirm-accept>${escapeHtml(confirmLabel)}</button></div></section>`;
    const close = accepted => {
      document.removeEventListener('keydown', onKeyDown);
      dialog.remove();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      resolve(accepted);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(false); return; }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not([disabled])')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.querySelector('[data-confirm-cancel]').addEventListener('click', () => close(false));
    dialog.querySelector('[data-confirm-accept]').addEventListener('click', () => close(true));
    dialog.addEventListener('click', event => { if (event.target === dialog) close(false); });
    document.addEventListener('keydown', onKeyDown);
    document.body.append(dialog);
    dialog.querySelector('[data-confirm-cancel]').focus();
  });
}
