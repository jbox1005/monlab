'use strict';

/** 재시도 + 레이트리밋 백오프가 붙은 fetch 래퍼 */
async function req(url, opts = {}, { retries = 4, baseDelay = 500 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
        err.fatal = true;
        throw err;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.fatal || i === retries) break;
      await sleep(baseDelay * 2 ** i);
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { req, sleep };
