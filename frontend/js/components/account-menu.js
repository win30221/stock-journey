// Disclosure navigation: native Tab order, outside click, and Escape to return focus.
export function bindAccountMenu({ container, toggle, panel, ownerDocument = document }) {
  if (!container || !toggle || !panel) return () => {};
  let open = false;

  function close(restoreFocus = false) {
    open = false;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus && toggle.isConnected) toggle.focus();
  }

  function onToggle() {
    open = !open;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  function onOutside(event) {
    if (open && !container.contains(event.target)) close();
  }

  function onKeyDown(event) {
    if (open && event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      close(true);
    }
  }

  function onFocusOut(event) {
    if (open && event.relatedTarget && !container.contains(event.relatedTarget)) close();
  }

  close();
  toggle.addEventListener('click', onToggle);
  container.addEventListener('focusout', onFocusOut);
  ownerDocument.addEventListener('pointerdown', onOutside);
  ownerDocument.addEventListener('keydown', onKeyDown);
  return () => {
    close();
    toggle.removeEventListener('click', onToggle);
    container.removeEventListener('focusout', onFocusOut);
    ownerDocument.removeEventListener('pointerdown', onOutside);
    ownerDocument.removeEventListener('keydown', onKeyDown);
  };
}
