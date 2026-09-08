let activeDialogCleanup = null;

export function clearDialogFocus({ restoreFocus = false } = {}) {
  activeDialogCleanup?.(restoreFocus);
  activeDialogCleanup = null;
}

// Keep custom dialogs usable with a keyboard, including after an app rerender.
export function bindDialogFocus(dialog, { onClose, initialFocus, returnFocus } = {}) {
  clearDialogFocus({ restoreFocus: !dialog });
  if (!dialog) return;
  const background = document.querySelector('.shell');
  const previousInert = background?.inert ?? false;
  if (background) background.inert = true;
  document.body?.classList.add('dialog-open');
  dialog.tabIndex = -1;
  const controls = () => [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
    .filter(element => !element.disabled && element.tabIndex >= 0 && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0);
  const focusInitial = () => {
    if (!dialog.isConnected || dialog.contains(document.activeElement)) return;
    ((initialFocus ? dialog.querySelector(initialFocus) : null) || controls()[0] || dialog).focus();
  };
  const onKeyDown = event => {
    // A combobox consumes Escape to close its suggestions before its dialog.
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); onClose?.(); return; }
    if (event.key !== 'Tab') return;
    const items = controls(), first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); dialog.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };
  dialog.addEventListener('keydown', onKeyDown);
  requestAnimationFrame(focusInitial);
  activeDialogCleanup = restoreFocus => {
    dialog.removeEventListener('keydown', onKeyDown);
    if (background) background.inert = previousInert;
    document.body?.classList.remove('dialog-open');
    if (restoreFocus && returnFocus) requestAnimationFrame(returnFocus);
  };
}
