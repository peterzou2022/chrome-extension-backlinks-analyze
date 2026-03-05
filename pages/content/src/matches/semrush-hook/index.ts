/**
 * Semrush 反向链接 fetch/XHR 拦截钩子
 * 以 content_scripts world:"MAIN" 注入，直接运行在页面上下文
 */

const GUARD = '__semrush_backlinks_hook__';

if (!(window as Record<string, unknown>)[GUARD]) {
  (window as Record<string, unknown>)[GUARD] = true;

  let lastBacklinksRequestUrl: string | null = null;

  function isBacklinksReportUrl(url: string): boolean {
    if (url.indexOf('backlinks') === -1) return false;
    return (
      url.indexOf('webapi') !== -1 ||
      url.indexOf('/api/') !== -1 ||
      url.indexOf('display_limit') !== -1 ||
      url.indexOf('display_offset') !== -1
    );
  }

  function emitBacklinksResponse(requestUrl: string | null, data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const d = data as Record<string, unknown>;

    let backlinksPayload: Record<string, unknown> | undefined;

    if (d.backlinks && typeof d.backlinks === 'object') {
      const bl = d.backlinks as Record<string, unknown>;
      if (Array.isArray(bl.data)) {
        backlinksPayload = bl;
      }
    }

    if (!backlinksPayload && Array.isArray(d.data)) {
      backlinksPayload = {
        data: d.data,
        total: d.total,
        target: d.target,
        limit: d.limit ?? d.display_limit,
        offset: d.offset ?? d.display_offset,
      };
    }

    if (!backlinksPayload) return;

    window.postMessage(
      {
        type: 'SEMRUSH_BACKLINKS_RESPONSE',
        requestUrl: requestUrl || lastBacklinksRequestUrl,
        payload: { backlinks: backlinksPayload },
      },
      '*',
    );
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (isBacklinksReportUrl(url)) lastBacklinksRequestUrl = url;
    return originalFetch(input, init).then((res: Response) => {
      if (res.url && isBacklinksReportUrl(res.url)) {
        res
          .clone()
          .json()
          .then((d: unknown) => emitBacklinksResponse(res.url || lastBacklinksRequestUrl, d))
          .catch(() => {});
      }
      return res;
    });
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args: Parameters<typeof origOpen>) {
    const urlStr = String(args[1] || '');
    if (isBacklinksReportUrl(urlStr)) {
      (this as XMLHttpRequest & { __semrushUrl?: string }).__semrushUrl = urlStr;
      this.addEventListener('readystatechange', function (this: XMLHttpRequest & { __semrushUrl?: string }) {
        if (this.readyState === 4 && this.__semrushUrl && this.responseText) {
          try {
            emitBacklinksResponse(this.__semrushUrl, JSON.parse(this.responseText));
          } catch {
            /* ignore parse errors */
          }
        }
      });
    }
    return origOpen.apply(this, args);
  };

  function findUrlInPerformanceEntries(): string | null {
    try {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      for (let i = entries.length - 1; i >= 0; i--) {
        if (isBacklinksReportUrl(entries[i].name)) return entries[i].name;
      }
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (
          (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') &&
          entry.name.indexOf('backlinks') !== -1
        ) {
          return entry.name;
        }
      }
    } catch {
      /* performance API not available */
    }
    return null;
  }

  function constructApiUrlFromPage(): string | null {
    try {
      const pageUrl = new URL(window.location.href);
      const q = pageUrl.searchParams.get('q');
      if (!q) return null;

      const apiUrl = new URL(pageUrl.origin + '/analytics/backlinks/webapi2/backlinks/');
      for (const [key, value] of pageUrl.searchParams) {
        apiUrl.searchParams.set(key, value);
      }
      if (!apiUrl.searchParams.has('display_limit')) {
        apiUrl.searchParams.set('display_limit', '100');
      }
      if (!apiUrl.searchParams.has('display_page')) {
        apiUrl.searchParams.set('display_page', '0');
      }
      return apiUrl.toString();
    } catch {
      return null;
    }
  }

  function tryCatchUp(): void {
    if (lastBacklinksRequestUrl) return;

    const perfUrl = findUrlInPerformanceEntries();
    if (perfUrl) {
      lastBacklinksRequestUrl = perfUrl;
      originalFetch(perfUrl)
        .then(r => r.json())
        .then((d: unknown) => emitBacklinksResponse(perfUrl, d))
        .catch(() => {});
      return;
    }

    const constructed = constructApiUrlFromPage();
    if (constructed) {
      originalFetch(constructed)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d: unknown) => {
          lastBacklinksRequestUrl = constructed;
          emitBacklinksResponse(constructed, d);
        })
        .catch(() => {});
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'SEMRUSH_REQUEST_CATCHUP') {
      tryCatchUp();
      return;
    }

    if (event.data.type !== 'SEMRUSH_START_FULL_CAPTURE') return;
    const { baseUrl, totalPages } = event.data as { baseUrl: string; totalPages: number };
    if (!baseUrl || totalPages == null) return;

    const pageUrl = new URL(baseUrl);
    const DELAY_MS = 400;

    function fetchPage(page: number): void {
      if (page >= totalPages) return;
      pageUrl.searchParams.set('display_page', String(page));
      fetch(pageUrl.toString())
        .then(r => r.json())
        .then((d: unknown) => {
          window.postMessage(
            { type: 'SEMRUSH_BACKLINKS_RESPONSE', requestUrl: pageUrl.toString(), payload: d },
            '*',
          );
        })
        .catch(() => {})
        .finally(() => setTimeout(() => fetchPage(page + 1), DELAY_MS));
    }
    fetchPage(1);
  });

  setTimeout(tryCatchUp, 0);
}
