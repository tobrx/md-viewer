#!/usr/bin/env node
// Holt alle Feeds aus feeds.json, dedupliziert, clustert gleiche Geschichten
// über Quellen hinweg und schreibt data/news.json.
//   node scripts/fetch-feeds.mjs           -> data/news.json bauen
//   node scripts/fetch-feeds.mjs --check   -> nur Feed-URLs testen
//   node scripts/fetch-feeds.mjs --file x.xml --id test  -> lokale Datei parsen (Test)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENT[n]);
const text = s => decode(decode(s || '')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

export function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.map(b => {
    let link = text(tag(b, 'link'));
    if (!link) link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || '';
    const date = new Date(text(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')));
    const summary = text(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'));
    return {
      title: text(tag(b, 'title')), link: decode(link),
      summary: summary.length > 320 ? summary.slice(0, 317).replace(/\s\S*$/, '') + '…' : summary,
      published: isNaN(date) ? null : date.toISOString(),
    };
  }).filter(i => i.title && i.link);
}

const STOP = new Set('der die das und oder mit von für auf aus bei nach über unter dass sich eine einen einem einer eines sind wird werden wurde nicht auch noch mehr kann sein ihre dem den des ein als wie zum zur vor'.split(' '));
const tokens = t => new Set(t.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
const jaccard = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1); };

export function cluster(items, threshold = 0.4, windowH = 48) {
  const stories = [];
  for (const it of items.sort((a, b) => (b.published || '').localeCompare(a.published || ''))) {
    const tk = tokens(it.title);
    const hit = stories.find(s => !s.sources.some(x => x.id === it.feed.id) &&
      Math.abs(new Date(s.published) - new Date(it.published)) < windowH * 36e5 &&
      jaccard(s._tk, tk) >= threshold);
    const src = { id: it.feed.id, name: it.feed.name, url: it.link, title: it.title };
    if (hit) {
      hit.sources.push(src);
      for (const t of it.feed.topics) if (!hit.topics.includes(t)) hit.topics.push(t);
      hit.tier = Math.max(hit.tier, it.feed.tier);
      if (it.summary.length > hit.summary.length) hit.summary = it.summary;
    } else {
      stories.push({ id: Buffer.from(it.link).toString('base64url').slice(-12), title: it.title, summary: it.summary,
        published: it.published, scope: it.feed.scope, topics: [...it.feed.topics], tier: it.feed.tier,
        sources: [src], _tk: tk });
    }
  }
  return stories.map(({ _tk, ...s }) => s);
}

async function load(feed) {
  const res = await fetch(feed.url, { headers: { 'user-agent': 'newsdesk-prototype/0.1' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return parseFeed(await res.text());
}

const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const { feeds } = JSON.parse(await readFile(join(root, 'feeds.json'), 'utf8'));
  if (args.includes('--check')) {
    for (const f of feeds) {
      try { console.log('OK  ', f.id.padEnd(22), (await load(f)).length, 'Items'); }
      catch (e) { console.log('FAIL', f.id.padEnd(22), e.message); }
    }
  } else {
    const all = [], report = [];
    await Promise.all(feeds.map(async f => {
      try {
        const items = (await load(f)).slice(0, 40);
        items.forEach(i => all.push({ ...i, feed: f })); report.push(`${f.id}: ${items.length}`);
      } catch (e) { report.push(`${f.id}: FEHLER ${e.message}`); }
    }));
    const items = all.filter(i => i.published && Date.now() - new Date(i.published) < 72 * 36e5);
    const stories = cluster(items);
    await writeFile(join(root, 'data/news.json'), JSON.stringify({ generated: new Date().toISOString(), items: stories }, null, 1));
    console.log(report.sort().join('\n'), `\n→ ${items.length} Artikel, ${stories.length} Geschichten`);
  }
}
