// Shared helpers for the iterative test pages: on-page log and result reporting.
declare global {
  interface Window {
    __result: unknown;
    __errors: string[];
  }
}

export interface PageContext {
  log: (msg: unknown, cls?: string) => void;
  fail: (err: unknown) => void;
  done: (result: unknown) => void;
}

export function createPage(): PageContext {
  const logEl = document.getElementById('log');
  window.__errors = [];
  window.__result = null;

  const log = (msg: unknown, cls?: string) => {
    const text = String(msg);
    if (logEl) {
      const line = document.createElement('div');
      if (cls) line.className = cls;
      line.textContent = text;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
    (cls === 'error' ? console.error : console.log)(text);
  };

  const fail = (err: unknown) => {
    const text = err instanceof Error && err.stack ? err.stack : String(err);
    window.__errors.push(text);
    log(text, 'error');
  };

  window.addEventListener('error', (e) => fail(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => fail(e.reason));

  const done = (result: unknown) => {
    window.__result = result;
    log('RESULT ' + JSON.stringify(result));
  };

  return { log, fail, done };
}
