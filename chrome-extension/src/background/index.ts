import 'webextension-polyfill';
import { exampleThemeStorage } from '@extension/storage';

exampleThemeStorage.get().then(theme => {
  console.log('theme', theme);
});

console.log('Background loaded');
console.log("Edit 'chrome-extension/src/background/index.ts' and save to reload.");

const BACKLINKS_STORAGE_KEY = 'semrush-backlinks-data';

interface BacklinkRow {
  source_url: string;
  target_url: string;
  anchor?: string;
  first_seen?: number;
  last_seen?: number;
  page_ascore?: number;
  domain_ascore?: number;
  nofollow?: boolean;
  lostlink?: boolean;
  source_title?: string;
  [key: string]: unknown;
}

interface DomainBacklinks {
  items: BacklinkRow[];
  total: number;
  updatedAt: number;
}

const mergeBacklinksItems = (existing: BacklinkRow[], incoming: BacklinkRow[]): BacklinkRow[] => {
  const seen = new Set(existing.map(r => `${r.source_url}\t${r.target_url}`));
  const added = incoming.filter(r => !seen.has(`${r.source_url}\t${r.target_url}`));
  added.forEach(r => seen.add(`${r.source_url}\t${r.target_url}`));
  return existing.concat(added);
};

let backlinksProcessQueue: Promise<void> = Promise.resolve();

const processBacklinksPageData = async (msg: {
  domain: string;
  items: BacklinkRow[];
  total?: number;
}): Promise<{ ok: true; domain: string; count: number; total: number } | { ok: false; error: string }> => {
  const raw = await chrome.storage.local.get(BACKLINKS_STORAGE_KEY);
  const all = (raw[BACKLINKS_STORAGE_KEY] as Record<string, DomainBacklinks>) || {};
  const current = all[msg.domain] || { items: [], total: 0, updatedAt: 0 };
  const merged = mergeBacklinksItems(current.items, msg.items);
  const total = msg.total ?? current.total;
  all[msg.domain] = {
    items: merged,
    total,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [BACKLINKS_STORAGE_KEY]: all });
  return { ok: true, domain: msg.domain, count: merged.length, total };
};

chrome.runtime.onMessage.addListener(
  (
    msg: {
      type: string;
      domain?: string;
      items?: BacklinkRow[];
      total?: number;
      page?: number;
      requestUrl?: string;
    },
    _sender,
    sendResponse,
  ) => {
    if (msg.type !== 'SEMRUSH_BACKLINKS_PAGE_DATA' || !msg.domain || !Array.isArray(msg.items)) {
      return;
    }
    backlinksProcessQueue = backlinksProcessQueue.then(async () => {
      try {
        const result = await processBacklinksPageData({
          domain: msg.domain!,
          items: msg.items!,
          total: msg.total,
        });
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    });
    return true;
  },
);
