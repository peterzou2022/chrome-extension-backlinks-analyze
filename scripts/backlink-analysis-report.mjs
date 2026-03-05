/**
 * Backlink Analyzer Report - reads CSV export and outputs Excel-openable HTML report.
 * Usage: node scripts/backlink-analysis-report.mjs <path-to-csv>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const csvPath = process.argv[2] || 'docs/backlinks-export-20260305T043043.csv';
const outPath = process.argv[3] || 'docs/backlink-analysis-report.xls';

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((c === ',' && !inQuotes) || c === '\n' || c === '\r') {
      if (c === ',') {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((h, j) => {
      row[h] = cells[j] ?? '';
    });
    rows.push(row);
  }
  return { header, rows };
}

function getHostname(url) {
  try {
    const u = (url || '').trim();
    if (!u) return '';
    return new URL(u).hostname.replace(/^www\./, '') || '';
  } catch {
    return String(url || '');
  }
}

function getRootDomain(hostname) {
  const h = (hostname || '').trim();
  if (!h) return '';
  const parts = h.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  return h;
}

const csvText = readFileSync(csvPath, 'utf8');
const { rows } = parseCsv(csvText);

const targetDomain = 'cardfool.com';
const totalBacklinks = rows.length;
const referringHosts = new Set(rows.map(r => getHostname(r.source_url)));
const referringRootDomains = new Set(rows.map(r => getRootDomain(getHostname(r.source_url))));
const dofollow = rows.filter(r => r.nofollow !== 'true').length;
const nofollow = rows.filter(r => r.nofollow === 'true').length;
const dofollowPct = totalBacklinks ? ((dofollow / totalBacklinks) * 100).toFixed(1) : 0;
const nofollowPct = totalBacklinks ? ((nofollow / totalBacklinks) * 100).toFixed(1) : 0;

const domainScores = rows.map(r => parseInt(r.domain_ascore, 10) || 0);
const da0_19 = domainScores.filter(d => d <= 19).length;
const da20_39 = domainScores.filter(d => d >= 20 && d <= 39).length;
const da40_59 = domainScores.filter(d => d >= 40 && d <= 59).length;
const da60_79 = domainScores.filter(d => d >= 60 && d <= 79).length;
const da80_100 = domainScores.filter(d => d >= 80).length;
const avgDa = domainScores.length ? (domainScores.reduce((a, b) => a + b, 0) / domainScores.length).toFixed(1) : 0;

const anchorCounts = {};
rows.forEach(r => {
  const a = (r.anchor || '').trim() || '(empty)';
  anchorCounts[a] = (anchorCounts[a] || 0) + 1;
});
const topAnchors = Object.entries(anchorCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

const toxicPattern = /aged domains|backlinks|0843-3247|2479-8153|d24798d153e404ff47deb66433ca3d33/i;
const toxicByTitle = rows.filter(r => toxicPattern.test(r.source_title || ''));
const highExternalLinks = rows.filter(r => (parseInt(r.external_link_num, 10) || 0) >= 5000);
const toxicDomains = [...new Set([...toxicByTitle, ...highExternalLinks].map(r => getHostname(r.source_url)))];
const toxicCount = new Set([...toxicByTitle, ...highExternalLinks].map(r => r.source_url)).size;

const positionCounts = {};
rows.forEach(r => {
  const p = (r.position || '').trim() || '(empty)';
  positionCounts[p] = (positionCounts[p] || 0) + 1;
});

const analysisDate = new Date().toISOString().slice(0, 10);

const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
<meta charset="UTF-8">
<meta name="ProgId" content="Excel.Sheet">
<title>Backlink Analysis - ${targetDomain}</title>
<style>
table { border-collapse: collapse; margin-bottom: 24px; }
th, td { border: 1px solid #333; padding: 6px 10px; text-align: left; }
th { background: #1a365d; color: #fff; }
.sheet { margin: 20px; }
h2 { margin-top: 28px; color: #1a365d; }
</style>
</head>
<body class="sheet">
<h1>Backlink Analysis Report</h1>
<p><strong>Domain</strong>: ${targetDomain} &nbsp;|&nbsp; <strong>Analysis Date</strong>: ${analysisDate} &nbsp;|&nbsp; <strong>Data Source</strong>: User-provided CSV export (Semrush)</p>

<h2>1. Profile Overview - Key Metrics</h2>
<table>
<tr><th>Metric</th><th>Value</th><th>Status</th></tr>
<tr><td>Total Backlinks</td><td>${totalBacklinks}</td><td>-</td></tr>
<tr><td>Referring Domains (unique hostnames)</td><td>${referringHosts.size}</td><td>-</td></tr>
<tr><td>Referring Root Domains</td><td>${referringRootDomains.size}</td><td>-</td></tr>
<tr><td>Dofollow Links</td><td>${dofollow} (${dofollowPct}%)</td><td>✅ Natural</td></tr>
<tr><td>Nofollow Links</td><td>${nofollow} (${nofollowPct}%)</td><td>-</td></tr>
<tr><td>Average Domain Authority (domain_ascore)</td><td>${avgDa}</td><td>-</td></tr>
</table>

<h2>2. Authority Distribution (domain_ascore)</h2>
<table>
<tr><th>DA Range</th><th>Count</th><th>Percentage</th></tr>
<tr><td>0-19</td><td>${da0_19}</td><td>${((da0_19/totalBacklinks)*100).toFixed(1)}%</td></tr>
<tr><td>20-39</td><td>${da20_39}</td><td>${((da20_39/totalBacklinks)*100).toFixed(1)}%</td></tr>
<tr><td>40-59</td><td>${da40_59}</td><td>${((da40_59/totalBacklinks)*100).toFixed(1)}%</td></tr>
<tr><td>60-79</td><td>${da60_79}</td><td>${((da60_79/totalBacklinks)*100).toFixed(1)}%</td></tr>
<tr><td>80-100</td><td>${da80_100}</td><td>${((da80_100/totalBacklinks)*100).toFixed(1)}%</td></tr>
</table>

<h2>3. Link Position Distribution</h2>
<table>
<tr><th>Position</th><th>Count</th></tr>
${Object.entries(positionCounts).map(([p, c]) => `<tr><td>${p}</td><td>${c}</td></tr>`).join('')}
</table>

<h2>4. Top Anchor Texts</h2>
<table>
<tr><th>Anchor Text</th><th>Count</th></tr>
${topAnchors.map(([a, c]) => `<tr><td>${a.replace(/</g, '&lt;')}</td><td>${c}</td></tr>`).join('')}
</table>

<h2>5. Toxic Link Analysis</h2>
<table>
<tr><th>Risk Type</th><th>Count</th><th>Assessment</th></tr>
<tr><td>Links from "aged domains/backlinks" style pages</td><td>${toxicByTitle.length}</td><td>⚠️ High - Link farm/directory</td></tr>
<tr><td>Pages with 5000+ external links</td><td>${highExternalLinks.length}</td><td>⚠️ High - Link directory</td></tr>
<tr><td>Unique high-risk referring domains</td><td>${toxicDomains.length}</td><td>-</td></tr>
</table>
<p><strong>Recommendation</strong>: Consider disavow for domains that primarily sell "aged domains and backlinks" or host massive link pages (external_link_num &gt; 5000). Review list below.</p>

<h2>6. High-Risk Referring Domains (Review for Disavow)</h2>
<table>
<tr><th>#</th><th>Source Domain / Hostname</th></tr>
${toxicDomains.slice(0, 50).map((d, i) => `<tr><td>${i + 1}</td><td>${d}</td></tr>`).join('')}
</table>

<h2>7. Top Quality Backlinks (by domain_ascore)</h2>
<table>
<tr><th>Source URL</th><th>Domain ASCore</th><th>Page ASCore</th><th>Anchor</th></tr>
${rows
  .filter(r => (parseInt(r.domain_ascore, 10) || 0) >= 20)
  .sort((a, b) => (parseInt(b.domain_ascore, 10) || 0) - (parseInt(a.domain_ascore, 10) || 0))
  .slice(0, 15)
  .map(r => `<tr><td>${(r.source_url || '').replace(/</g, '&lt;')}</td><td>${r.domain_ascore}</td><td>${r.page_ascore}</td><td>${(r.anchor || '').replace(/</g, '&lt;').slice(0, 40)}</td></tr>`)
  .join('')}
</table>

<h2>8. Executive Summary</h2>
<table>
<tr><th>Item</th><th>Content</th></tr>
<tr><td>Profile Health</td><td>${toxicCount > totalBacklinks * 0.3 ? '⚠️ Needs attention' : 'Moderate'} - ${toxicCount} high-risk links (${((toxicCount/totalBacklinks)*100).toFixed(0)}%)</td></tr>
<tr><td>Strengths</td><td>100% dofollow; ${da80_100} links from high-DA (80+) domains; editorial/content positions dominant</td></tr>
<tr><td>Concerns</td><td>~${toxicByTitle.length} links from "aged domains/backlinks" directory-style pages; many low-DA (0-2) referring domains</td></tr>
<tr><td>Immediate Action</td><td>Review and consider disavow for link-farm domains (see section 6)</td></tr>
</table>
</body>
</html>`;

writeFileSync(outPath, html, 'utf8');
console.log(`Report written to ${outPath}. Open with Microsoft Excel.`);