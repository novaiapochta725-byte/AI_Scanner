/** Reliable button taps on iOS WKWebView (keyboard + scroll safe) */
export function bindButton(el, handler) {
  if (!el) return () => {};
  el.setAttribute('type', 'button');

  let locked = false;
  const run = (e) => {
    if (locked) return;
    locked = true;
    setTimeout(() => { locked = false; }, 350);
    if (el.disabled) return;
    handler(e);
  };

  const onTouchEnd = (e) => {
    e.preventDefault();
    run(e);
  };

  const onClick = (e) => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    run(e);
  };

  el.addEventListener('touchend', onTouchEnd, { passive: false });
  el.addEventListener('click', onClick);

  return () => {
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('click', onClick);
  };
}

export function blurActiveInput() {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
    el.blur();
  }
}

export function scrollIntoView(el) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
