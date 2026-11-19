/* 텔레그램 sendMessage 공용 — 텔레그램 서버 쪽 일시 오류(5xx·429·네트워크)는 잠시 쉬고 다시 보냄
 *   11/20 아침: api.telegram.org 가 7분가량 HTTP 502 를 돌려줘 공유 채널 내용이 한 번에 모두 빠짐 (재시도 없었음)
 *   400·403 등 설정 문제(채팅 ID·권한)는 다시 보내도 같으므로 바로 실패 */
const WAITS = (process.env.TG_RETRY_MS || '5000,20000,60000').split(',').map(Number).filter(n => n >= 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 일시 오류인지: 네트워크 오류(status 0)·429·5xx */
const transient = status => !status || status === 429 || status >= 500;

/** 반환 { ok, status, tries, error } — 예외를 던지지 않음 */
async function tgPost(token, chat, text, { waits = WAITS } = {}) {
  let last = { ok: false, status: 0, tries: 0, error: '' };
  for (let i = 0; i <= waits.length; i++) {
    let retryAfter = 0;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }), signal: AbortSignal.timeout(20000)
      });
      if (res.ok) return { ok: true, status: res.status, tries: i + 1, error: '' };
      last = { ok: false, status: res.status, tries: i + 1, error: `HTTP ${res.status}` };
      if (res.status === 429 && typeof res.json === 'function') {
        try { retryAfter = ((await res.json()).parameters || {}).retry_after * 1000 || 0; } catch { /* 본문 없음 */ }
      }
    } catch (e) {
      last = { ok: false, status: 0, tries: i + 1, error: e.message };
    }
    if (!transient(last.status) || i === waits.length) break;
    await sleep(Math.min(Math.max(waits[i], retryAfter), 120000));
  }
  return last;
}

/** 실패 사유를 사람이 읽는 한 줄로 */
function failReason(r) {
  const tries = r.tries > 1 ? ` · ${r.tries}번 시도` : '';
  return transient(r.status) ? `텔레그램 서버 일시 오류 ${r.error}${tries}` : r.error;
}

export { tgPost, failReason, transient };
