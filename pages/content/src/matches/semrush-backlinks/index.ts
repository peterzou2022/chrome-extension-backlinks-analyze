/**
 * Semrush 反向链接 - 消息桥接（ISOLATED world）
 * 接收 MAIN world hook 通过 postMessage 发来的拦截数据，转发到 background
 */

let lastRequestUrl: string | null = null;
let lastTotal = 0;

const extractDomainFromPageUrl = (): string => {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('q') || '';
  } catch {
    return '';
  }
};

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.data?.type !== 'SEMRUSH_BACKLINKS_RESPONSE') return;

  const { requestUrl, payload } = event.data as {
    requestUrl: string | null;
    payload: {
      backlinks?: {
        target?: string;
        total?: number;
        limit?: number;
        offset?: number;
        data?: unknown[];
        display_limit?: number;
        display_offset?: number;
      };
    };
  };
  const backlinks = payload?.backlinks;
  if (!backlinks || !Array.isArray(backlinks.data)) return;

  const target = backlinks.target || extractDomainFromPageUrl();
  const total = backlinks.total ?? 0;
  const limit = backlinks.limit || backlinks.display_limit || 100;
  const offset = backlinks.offset ?? backlinks.display_offset ?? 0;
  const page = Math.floor(offset / limit);

  if (requestUrl) lastRequestUrl = requestUrl;
  if (total > 0) lastTotal = total;

  chrome.runtime
    .sendMessage({
      type: 'SEMRUSH_BACKLINKS_PAGE_DATA',
      domain: target,
      items: backlinks.data,
      total,
      page,
      requestUrl: requestUrl || undefined,
    })
    .catch(() => {});
});

const CATCHUP_WAIT_MS = 3000;
const CATCHUP_POLL_INTERVAL = 200;

chrome.runtime.onMessage.addListener(
  (msg: { type: string; baseUrl?: string; totalPages?: number }, _sender, sendResponse) => {
    if (msg.type === 'SEMRUSH_GET_REPORT_INFO') {
      if (lastRequestUrl && lastTotal > 0) {
        sendResponse({ baseUrl: lastRequestUrl, total: lastTotal });
        return;
      }

      window.postMessage({ type: 'SEMRUSH_REQUEST_CATCHUP' }, '*');

      let elapsed = 0;
      const timer = setInterval(() => {
        elapsed += CATCHUP_POLL_INTERVAL;
        if ((lastRequestUrl && lastTotal > 0) || elapsed >= CATCHUP_WAIT_MS) {
          clearInterval(timer);
          sendResponse({ baseUrl: lastRequestUrl, total: lastTotal });
        }
      }, CATCHUP_POLL_INTERVAL);

      return true;
    }

    if (msg.type !== 'SEMRUSH_START_FULL_CAPTURE' || !msg.baseUrl || msg.totalPages == null) {
      return;
    }
    window.postMessage({ type: 'SEMRUSH_START_FULL_CAPTURE', baseUrl: msg.baseUrl, totalPages: msg.totalPages }, '*');
  },
);
