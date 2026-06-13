/** Reliable button taps on iOS WKWebView (keyboard + scroll safe) */

export function bindButton(el, handler) {
  if (!el) return () => {};
  el.setAttribute('type', 'button');

  let busy = false;
  const run = async (e) => {
    if (busy || el.disabled || el.classList.contains('is-loading')) return;
    busy = true;
    try {
      await Promise.resolve(handler(e));
    } catch (err) {
      console.error('Button handler failed:', err);
    } finally {
      setTimeout(() => {
        busy = false;
      }, 280);
    }
  };

  let lastTouch = 0;
  const onTouchEnd = (e) => {
    lastTouch = Date.now();
    e.preventDefault();
    void run(e);
  };

  const onClick = (e) => {
    if (Date.now() - lastTouch < 450) {
      e.preventDefault();
      return;
    }
    void run(e);
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
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
    el.blur();
  }
}

export async function dismissKeyboard() {
  blurActiveInput();
  if (window.Capacitor?.isNativePlatform?.()) {
    try {
      const { Keyboard } = await import('@capacitor/keyboard');
      await Keyboard.hide();
    } catch {
      /* optional */
    }
  }
  // WKWebView sometimes leaves a stale viewport after keyboard dismiss
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
  });
}

export function scrollIntoView(el) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
