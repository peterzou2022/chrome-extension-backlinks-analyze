import '@src/Popup.css';
import { t } from '@extension/i18n';
import { PROJECT_URL_OBJECT, useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner, ToggleButton } from '@extension/ui';
import { useEffect, useState } from 'react';

const notificationOptions = {
  type: 'basic',
  iconUrl: chrome.runtime.getURL('icon-34.png'),
  title: 'Injecting content script error',
  message: 'You cannot inject script here!',
} as const;

const SEMRUSH_BACKLINKS_STORAGE_KEY = 'semrush-backlinks-data';

const CSV_COLUMNS = [
  'source_url',
  'source_title',
  'target_url',
  'target_title',
  'anchor',
  'page_ascore',
  'domain_ascore',
  'first_seen',
  'last_seen',
  'nofollow',
  'lostlink',
  'position',
  'response_code',
  'external_link_num',
  'internal_link_num',
] as const;

function escapeCsvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildBacklinksCsv(
  data: Record<string, { items: Record<string, unknown>[] }>,
): string {
  const header = CSV_COLUMNS.join(',');
  const rows: string[] = [header];
  for (const [, { items }] of Object.entries(data)) {
    if (!Array.isArray(items)) continue;
    for (const row of items) {
      const cells = CSV_COLUMNS.map(col => escapeCsvCell(row[col]));
      rows.push(cells.join(','));
    }
  }
  return rows.join('\r\n');
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const isSemrushBacklinksUrl = (url: string | undefined): boolean =>
  !!url &&
  (url.includes('semrush.com') || url.includes('semrush.fun')) &&
  (url.includes('backlinks') || url.includes('backlink'));

const Popup = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const logo = isLight ? 'popup/logo_vertical.svg' : 'popup/logo_vertical_dark.svg';
  const [tabUrl, setTabUrl] = useState<string | null>(null);
  const [backlinksByDomain, setBacklinksByDomain] = useState<Record<string, { count: number; total: number }>>({});
  const [captureAllLoading, setCaptureAllLoading] = useState(false);
  const [captureAllError, setCaptureAllError] = useState<string | null>(null);

  useEffect(() => {
    chrome.tabs.query({ currentWindow: true, active: true }).then(([tab]) => {
      setTabUrl(tab?.url ?? null);
    });
  }, []);

  useEffect(() => {
    const load = () => {
      chrome.storage.local.get(SEMRUSH_BACKLINKS_STORAGE_KEY).then((raw) => {
        const data = raw[SEMRUSH_BACKLINKS_STORAGE_KEY] as Record<string, { items: unknown[]; total: number }> | undefined;
        if (!data) {
          setBacklinksByDomain({});
          return;
        }
        const next: Record<string, { count: number; total: number }> = {};
        for (const [domain, v] of Object.entries(data)) {
          next[domain] = { count: v.items?.length ?? 0, total: v.total ?? 0 };
        }
        setBacklinksByDomain(next);
      });
    };
    load();
    const listener = () => load();
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const goGithubSite = () => chrome.tabs.create(PROJECT_URL_OBJECT);

  const injectContentScript = async () => {
    const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });

    if (tab.url!.startsWith('about:') || tab.url!.startsWith('chrome:')) {
      chrome.notifications.create('inject-error', notificationOptions);
    }

    await chrome.scripting
      .executeScript({
        target: { tabId: tab.id! },
        files: ['/content-runtime/example.iife.js', '/content-runtime/all.iife.js'],
      })
      .catch(err => {
        if (err.message.includes('Cannot access a chrome:// URL')) {
          chrome.notifications.create('inject-error', notificationOptions);
        }
      });
  };

  const directScanBacklinksApi = async (
    tabId: number,
  ): Promise<{ baseUrl: string; total: number; domain: string; items: unknown[] } | null> => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN' as chrome.scripting.ExecutionWorld,
      func: async () => {
        const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        let apiUrl: string | null = null;
        for (let i = entries.length - 1; i >= 0; i--) {
          const name = entries[i].name;
          if (name.indexOf('backlinks') !== -1 && name.indexOf('webapi') !== -1) {
            apiUrl = name;
            break;
          }
        }
        if (!apiUrl) return null;
        try {
          const res = await fetch(apiUrl);
          const data = await res.json();
          const bl = data?.backlinks;
          if (!bl || !Array.isArray(bl.data)) return null;
          return {
            baseUrl: apiUrl,
            total: bl.total ?? 0,
            domain: bl.target ?? '',
            items: bl.data,
          };
        } catch {
          return null;
        }
      },
    });
    return (result?.result as { baseUrl: string; total: number; domain: string; items: unknown[] } | null) ?? null;
  };

  const directFetchAllPages = async (tabId: number, baseUrl: string, totalPages: number): Promise<void> => {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN' as chrome.scripting.ExecutionWorld,
      func: async (url: string, pages: number) => {
        const DELAY_MS = 400;
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        const pageUrl = new URL(url);
        for (let p = 1; p < pages; p++) {
          pageUrl.searchParams.set('display_page', String(p));
          try {
            const res = await fetch(pageUrl.toString());
            const data = await res.json();
            window.postMessage({ type: 'SEMRUSH_BACKLINKS_RESPONSE', requestUrl: pageUrl.toString(), payload: data }, '*');
          } catch {
            /* skip failed pages */
          }
          await sleep(DELAY_MS);
        }
      },
      args: [baseUrl, totalPages],
    });
  };

  const captureAllBacklinks = async () => {
    const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
    if (!tab?.id || !isSemrushBacklinksUrl(tab.url)) {
      setCaptureAllError('请在 Semrush 反向链接报告页打开并刷新后再试');
      return;
    }
    setCaptureAllLoading(true);
    setCaptureAllError(null);
    try {
      const scanResult = await directScanBacklinksApi(tab.id);
      if (!scanResult || !scanResult.baseUrl || scanResult.total <= 0) {
        setCaptureAllError('未在页面中发现 backlinks API 请求。请确保页面已完整加载并显示反向链接列表后重试。');
        return;
      }

      await chrome.runtime.sendMessage({
        type: 'SEMRUSH_BACKLINKS_PAGE_DATA',
        domain: scanResult.domain,
        items: scanResult.items,
        total: scanResult.total,
        page: 0,
        requestUrl: scanResult.baseUrl,
      });

      const limit = 100;
      const totalPages = Math.ceil(scanResult.total / limit);

      if (totalPages <= 1) {
        setCaptureAllError(null);
        return;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['/content/semrush-backlinks.iife.js'],
        });
      } catch {
        /* bridge may already be loaded */
      }

      await directFetchAllPages(tab.id, scanResult.baseUrl, totalPages);
      setCaptureAllError(null);
    } catch (e) {
      setCaptureAllError(e instanceof Error ? e.message : '抓取失败，请刷新页面后重试');
    } finally {
      setCaptureAllLoading(false);
    }
  };

  const exportBacklinksCsv = () => {
    chrome.storage.local.get(SEMRUSH_BACKLINKS_STORAGE_KEY).then((raw) => {
      const data = raw[SEMRUSH_BACKLINKS_STORAGE_KEY] as Record<string, { items: Record<string, unknown>[] }> | undefined;
      if (!data || Object.keys(data).length === 0) {
        setCaptureAllError('暂无已抓取的反向链接数据，请先抓取后再导出');
        return;
      }
      const totalItems = Object.values(data).reduce((sum, v) => sum + (v.items?.length ?? 0), 0);
      if (totalItems === 0) {
        setCaptureAllError('暂无已抓取的反向链接数据，请先抓取后再导出');
        return;
      }
      setCaptureAllError(null);
      const csv = buildBacklinksCsv(data);
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
      downloadCsv(csv, `backlinks-export-${timestamp}.csv`);
    });
  };

  const onSemrushSection = isSemrushBacklinksUrl(tabUrl ?? undefined);
  const domains = Object.entries(backlinksByDomain);

  return (
    <div className={cn('App', isLight ? 'bg-slate-50' : 'bg-gray-800')}>
      <header className={cn('App-header', isLight ? 'text-gray-900' : 'text-gray-100')}>
        <button onClick={goGithubSite}>
          <img src={chrome.runtime.getURL(logo)} className="App-logo" alt="logo" />
        </button>
        <p>
          Edit <code>pages/popup/src/Popup.tsx</code>
        </p>
        <button
          className={cn(
            'mt-4 rounded px-4 py-1 font-bold shadow hover:scale-105',
            isLight ? 'bg-blue-200 text-black' : 'bg-gray-700 text-white',
          )}
          onClick={injectContentScript}>
          {t('injectButton')}
        </button>

        {onSemrushSection && (
          <section className={cn('mt-4 p-3 rounded text-left text-sm', isLight ? 'bg-blue-50' : 'bg-gray-700')}>
            <p className="font-semibold mb-2">Semrush 反向链接</p>
            <p className="mb-2 opacity-90">当前页数据会在加载时自动抓取。若点「抓取全部页」报错，请先刷新本页、等列表加载完成后再试。</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className={cn(
                  'w-full rounded px-3 py-1.5 font-medium',
                  isLight ? 'bg-blue-300 text-black' : 'bg-gray-600 text-white',
                )}
                onClick={captureAllBacklinks}
                disabled={captureAllLoading}>
                {captureAllLoading ? '抓取中…' : '抓取全部页'}
              </button>
              <button
                type="button"
                className={cn(
                  'w-full rounded px-3 py-1.5 font-medium',
                  isLight ? 'bg-green-200 text-black' : 'bg-gray-600 text-white',
                )}
                onClick={exportBacklinksCsv}
                disabled={domains.length === 0}>
                导出 CSV
              </button>
            </div>
            {captureAllError && <p className="mt-2 text-red-500 text-xs">{captureAllError}</p>}
            {domains.length > 0 && (
              <ul className="mt-2 text-xs space-y-1">
                {domains.map(([domain, { count, total }]) => (
                  <li key={domain}>
                    已抓取 <strong>{domain}</strong>: {count} / {total} 条
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <ToggleButton>{t('toggleTheme')}</ToggleButton>
      </header>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
