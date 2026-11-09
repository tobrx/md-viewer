// MD Viewer: Dateien von überall öffnen. Tabs = Dateien, dazu Zuletzt, Merkliste, Notizordner und Orte.
const $ = s => document.querySelector(s);
const N = (a, p = {}) => webkit.messageHandlers.native.postMessage({a, ...p});
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const base = p => p.split('/').at(-1);
const stem = p => base(p).replace(/\.(md|markdown)$/i, '');
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const tilde = p => p.replace(/^\/Users\/[^/]+/, '~');
const slug = t => t.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

const COLORS = {note:'#5b8def',info:'#5b8def',tip:'#2bb3a3',success:'#3fb950',warning:'#e3a008',caution:'#e3a008',danger:'#e5534b',bug:'#e5534b',question:'#e3a008',quote:'#8a8a8a',example:'#a78bfa',abstract:'#2bb3a3',todo:'#5b8def'};

// ---------- Zustand ----------
let S = {recent: [], pins: [], orte: [], notes: null, collapsed: {}};
let tabs = [], active = -1;                 // Tab = {path, hist, hpos, scroll}
let cur = null;                             // {path, mtime} der geladenen Datei
let lists = {};                             // Ordner -> [{path, rel, mtime}]
let resMap = {};                            // Wikilink-Name -> Pfad (aktuelles Dokument)
let tab = 'files', filter = '', contentHits = [], expanded = new Set();
let fileDir = null;                         // Ordner der aktiven Datei, falls nicht schon Notizen/Ort
let outline = [], kb = -1, themeMode = 'system', booted = false;
let editing = false, dirty = false, conflict = false, ed = null, saveTimer = null, statText = '';

const curPath = () => tabs[active]?.path || null;
const searchDirs = () => [S.notes, ...S.orte].filter(Boolean);
const isPinned = p => S.pins.some(x => x.path === p);
function allFiles() {
  const m = new Map();
  for (const d in lists) for (const f of lists[d]) m.set(f.path, f);
  for (const r of S.recent) if (!m.has(r.path)) m.set(r.path, {path: r.path, mtime: 0});
  for (const r of S.pins) if (!m.has(r.path)) m.set(r.path, {path: r.path, mtime: 0});
  for (const t of tabs) if (!m.has(t.path)) m.set(t.path, {path: t.path, mtime: 0});
  return [...m.values()];
}
function save() {
  S.tabs = tabs.map(t => ({path: t.path})); S.active = active;
  return N('setState', {json: JSON.stringify(S)});
}

// ---------- Start ----------
async function boot(ext) {
  if (!booted) {
    booted = true;
    syncTheme();
    try { Object.assign(S, JSON.parse(await N('getState'))); } catch {}
    document.body.classList.toggle('noside', !!S.noside);
    S.recent ??= []; S.pins ??= []; S.orte ??= []; S.collapsed ??= {};
    await loadLists();
    for (const t of (S.tabs || [])) {
      if (t.path && await N('stat', {path: t.path}) != null) tabs.push({path: t.path, hist: [t.path], hpos: 0, scroll: 0});
    }
    active = tabs.length ? Math.min(S.active ?? 0, tabs.length - 1) : -1;
    renderSide(); renderTabs();
    if (!ext?.length) { if (active >= 0) await showActive(); else welcome(); return; }
  }
  if (ext?.length) await handlePaths(ext);
}

async function handlePaths(items) {
  tab = 'files'; document.body.classList.remove('noside');
  let last = null;
  for (const it of items) {
    if (it.dir) await addPlace(it.path);
    else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(it.path)) await insertImagePath(it.path);
    else last = it.path;
  }
  if (last) await openFile(last);
}

async function openDialog() {
  const items = await N('chooseFiles');
  if (items?.length) await handlePaths(items);
}

async function loadList(dir, depth) { try { lists[dir] = await N('list', {dir, depth}); } catch { lists[dir] = []; } }
const covered = d => searchDirs().some(s => d === s || d.startsWith(s + '/'));
async function loadLists() {
  await Promise.all([...searchDirs().map(d => loadList(d)), ...(fileDir ? [loadList(fileDir, 2)] : [])]);
}
async function setFileDir(path) {
  const d = dirOf(path);
  fileDir = d && !covered(d) ? d : null;
  for (const k of Object.keys(lists)) if (k !== fileDir && !searchDirs().includes(k)) delete lists[k];
  if (fileDir) await loadList(fileDir, 2);
}

async function addPlace(dir) {
  if (S.notes === dir) { tab = 'files'; renderSide(); return; }
  if (!S.orte.includes(dir)) S.orte.push(dir);
  S.collapsed['o:' + dir] = false;
  await loadList(dir); tab = 'files'; filter = ''; $('#q').value = '';
  document.body.classList.remove('noside');
  renderSide(); save();
}

// ---------- Tabs ----------
function snapScroll() { if (active >= 0 && tabs[active]) tabs[active].scroll = $('#main').scrollTop; }

async function leaveIfEditing() { return !editing || await leaveEdit(true); }

async function openFile(path, o = {}) {
  if (!await leaveIfEditing()) return;
  snapScroll();
  let i = tabs.findIndex(t => t.path === path);
  if (o.replace && active >= 0 && i < 0) {
    const t = tabs[active];
    t.hist = t.hist.slice(0, t.hpos + 1); t.hist.push(path); t.hpos = t.hist.length - 1; t.path = path; i = active;
  } else if (i < 0) {
    tabs.splice(active + 1, 0, {path, hist: [path], hpos: 0, scroll: 0}); i = active + 1;
  }
  active = i;
  await showActive(o.heading);
}

async function switchTab(i) {
  if (!await leaveIfEditing()) return;
  snapScroll(); active = i;
  await showActive(null, {scroll: tabs[i].scroll});
}

async function closeTab(i = active) {
  if (i < 0 || i >= tabs.length) return;
  if (i === active && !await leaveIfEditing()) return;
  tabs.splice(i, 1);
  if (!tabs.length) { active = -1; cur = null; renderTabs(); renderSide(); welcome(); save(); return; }
  if (i < active) { active--; renderTabs(); save(); return; }
  if (i === active) { active = Math.min(i, tabs.length - 1); await showActive(null, {scroll: tabs[active].scroll}); return; }
  renderTabs(); save();
}
function cycleTab(d) { if (tabs.length > 1) switchTab((active + d + tabs.length) % tabs.length); }

function go(d) {
  const t = tabs[active]; if (!t) return;
  const i = t.hpos + d; if (i < 0 || i >= t.hist.length) return;
  leaveIfEditing().then(ok => { if (!ok) return; t.hpos = i; t.path = t.hist[i]; showActive(); });
}

async function showActive(heading, o = {}) {
  const path = curPath(); if (!path) return;
  let r;
  try { r = await N('read', {path}); }
  catch {
    S.recent = S.recent.filter(x => x.path !== path);
    tabs.splice(active, 1); active = tabs.length ? Math.min(active, tabs.length - 1) : -1;
    renderTabs(); renderSide();
    $('#doc').innerHTML = `<div id="welcome">„${esc(base(path))}“ ist nicht mehr lesbar.<br><small>Die Datei wurde verschoben oder gelöscht.</small></div>`;
    if (active >= 0) { await showActive(); }
    save(); return;
  }
  cur = {path, mtime: r.mtime};
  S.recent = [{path, t: Date.now()}, ...S.recent.filter(x => x.path !== path)].slice(0, 40);
  await setFileDir(path);
  for (const d of [...searchDirs(), fileDir].filter(Boolean)) if (path.startsWith(d + '/')) {
    let acc = d; for (const part of dirOf(path).slice(d.length + 1).split('/').filter(Boolean)) { acc += '/' + part; expanded.add(acc); }
  }
  hideWarn();
  await renderDoc(path, r.text);
  if (heading) scrollToId(slug(heading)); else $('#main').scrollTop = o.scroll || 0;
  renderTabs(); renderSide();
  loadBacklinks(path);
  save();
}

function renderTabs() {
  const bar = $('#tabbar'); bar.innerHTML = '';
  const sb = document.createElement('button'); sb.className = 'tool sbtn'; sb.title = 'Seitenleiste ein/aus (⌥⌘B)'; sb.innerHTML = ICONS.sidebar; sb.onclick = toggleSide; bar.append(sb);
  tabs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'ttab' + (i === active ? ' on' : ''); el.title = tilde(t.path);
    el.innerHTML = `<span>${esc(stem(t.path))}</span><b>×</b>`;
    el.onclick = () => i === active || switchTab(i);
    el.onauxclick = e => { if (e.button === 1) closeTab(i); };
    el.oncontextmenu = e => { e.preventDefault(); N('ctx', {path: t.path, kind: 'file', pinned: isPinned(t.path)}).then(r => handleCtx(r, t.path)); };
    el.querySelector('b').onclick = e => { e.stopPropagation(); closeTab(i); };
    bar.append(el);
  });
  const p = document.createElement('div'); p.className = 'tplus'; p.textContent = '+'; p.title = 'Datei oder Ordner öffnen (⌘O)'; p.onclick = openDialog; bar.append(p);
  const sp = document.createElement('div'); sp.className = 'tspace'; bar.append(sp);
  const st = document.createElement('span'); st.className = 'tstat'; st.id = 'stat'; st.textContent = statText; bar.append(st);
  const tool = (svg, title, fn) => { const b = document.createElement('button'); b.className = 'tool'; b.title = title; b.innerHTML = svg; b.onclick = fn; bar.append(b); };
  if (cur) tool(ICONS.focus, 'Fokusmodus (⇧⌘F)', toggleFocus);
  if (cur) tool(isPinned(cur.path) ? ICONS.pinned : ICONS.pin, isPinned(cur.path) ? 'Aus Merkliste entfernen (⇧⌘D)' : 'Zur Merkliste (⇧⌘D)', togglePinCurrent);
  if (cur) tool(editing ? ICONS.read : ICONS.edit, editing ? 'Lesen (⌘E)' : 'Bearbeiten (⌘E)', toggleEdit);
  tool(ICONS.search, 'Im Dokument suchen (⌘F)', () => cur ? findOpen() : palette());
  tool(ICONS[themeMode], `Darstellung: ${{system: 'System', light: 'Hell', dark: 'Dunkel'}[themeMode]} (Klick zum Wechseln)`, cycleTheme);
}
const ICONS = {
  sidebar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/></svg>',
  focus: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z"/></svg>',
  pinned: '<svg viewBox="0 0 24 24"><path d="M6 4h12v17l-6-4-6 4z" fill="currentColor"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/></svg>',
  read: '<svg viewBox="0 0 24 24"><path d="M3 5.5C5.5 4 8.5 4 12 6c3.5-2 6.5-2 9-.5V19c-2.5-1.5-5.5-1.5-9 .5-3.5-2-6.5-2-9-.5z"/><path d="M12 6v13.5"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/></svg>',
  system: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 010 16z" fill="currentColor"/></svg>',
};
async function cycleTheme() { themeMode = await N('theme', {mode: {system: 'light', light: 'dark', dark: 'system'}[themeMode]}); renderTabs(); }
async function syncTheme() { themeMode = await N('theme'); renderTabs(); }

function welcome() {
  document.title = 'MD Viewer'; cur = null;
  const rec = S.recent.slice(0, 6).map(r => `<span class="rf" data-p="${esc(r.path)}">${esc(stem(r.path))}<small>${esc(tilde(dirOf(r.path)))}</small></span>`).join('');
  $('#doc').innerHTML = `<div id="welcome"><h2>MD Viewer</h2>Markdown-Dateien von überall lesen und bearbeiten.
    <div class="wbtns"><button onclick="openDialog()">Datei oder Ordner öffnen</button><button class="alt" onclick="newNote()">Neue Notiz</button></div>
    <small>Oder eine Datei auf das Fenster ziehen.</small>
    ${rec ? `<div class="wrec">${rec}</div>` : ''}</div>`;
  document.querySelectorAll('.rf').forEach(e => e.onclick = () => openFile(e.dataset.p));
  renderTabs();
}

// ---------- Merkliste, Umbenennen, Papierkorb ----------
function togglePin(path) {
  S.pins = isPinned(path) ? S.pins.filter(x => x.path !== path) : [{path}, ...S.pins];
  renderSide(); renderTabs(); save();
}
function togglePinCurrent() { if (cur) togglePin(cur.path); }

function renamePath(oldP, newP) {
  for (const t of tabs) { t.hist = t.hist.map(h => h === oldP ? newP : h); if (t.path === oldP) t.path = newP; }
  for (const r of S.recent) if (r.path === oldP) r.path = newP;
  for (const r of S.pins) if (r.path === oldP) r.path = newP;
  if (cur?.path === oldP) cur.path = newP;
}
function removePath(p) {
  S.recent = S.recent.filter(x => x.path !== p); S.pins = S.pins.filter(x => x.path !== p);
  const i = tabs.findIndex(t => t.path === p);
  if (i >= 0) { if (i === active) editing = false; if (ed) { ed.destroy(); ed = null; } tabs.splice(i, 1); if (i < active) active--; else if (i === active) active = Math.min(i, tabs.length - 1); }
}
async function afterFileChange() {
  await loadLists(); renderSide(); renderTabs();
  if (!tabs.length) { active = -1; cur = null; welcome(); } else if (!cur || cur.path !== curPath()) await showActive();
  save();
}

async function handleCtx(res, path) {
  if (res === 'pin') togglePin(path);
  else if (res === 'forget') { S.recent = S.recent.filter(x => x.path !== path); renderSide(); save(); }
  else if (res === 'rename') {
    const name = await askName('Umbenennen', stem(path)); if (!name) return;
    try { const np = await N('rename', {path, name: name.endsWith('.md') ? name : name + '.md'}); renamePath(path, np); await afterFileChange(); if (cur) document.title = stem(cur.path); }
    catch { stat('Umbenennen fehlgeschlagen'); }
  } else if (res === 'trashed') { removePath(path); await afterFileChange(); }
}
function askName(title, value) {
  return new Promise(res => {
    const box = $('#dlg'); $('#dlgt').textContent = title; const inp = $('#dlgi'); inp.value = value; box.classList.add('on'); inp.focus(); inp.select();
    const done = v => { box.classList.remove('on'); inp.onkeydown = null; $('#dlg').onclick = null; res(v); };
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim()); if (e.key === 'Escape') done(null); };
    box.onclick = e => { if (e.target === box) done(null); };
  });
}

// ---------- Notizen ----------
async function newNote() {
  if (!await leaveIfEditing()) return;
  if (!S.notes) {
    const d = await N('chooseFolder', {title: 'Ordner für neue Notizen wählen'}); if (!d) return;
    S.orte = S.orte.filter(x => x !== d); S.notes = d; await loadList(d); save();
  }
  let p;
  try { p = await N('newNote', {dir: S.notes}); } catch { stat('Anlegen fehlgeschlagen'); return; }
  await loadList(S.notes);
  await openFile(p);
  await enterEdit(); ed.view.dispatch({selection: {anchor: 2}}); ed.focus();
}
async function autoName() {
  const p = cur?.path;
  if (!p || !ed || !/^Unbenannt( \d+)?\.md$/.test(base(p))) return;
  const m = ed.getValue().match(/^#\s+(.+)$/m); if (!m) return;
  const title = m[1].trim().replace(/[\/:\\]/g, '-').slice(0, 80); if (!title) return;
  try { const np = await N('rename', {path: p, name: title + '.md'}); renamePath(p, np); await loadList(S.notes); } catch {}
}

// ---------- Seitenleiste ----------
function renderSide() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.t === tab));
  const el = $('#tree'); el.innerHTML = '';
  if (filter) renderSearch(el);
  else if (tab === 'outline') renderOutline(el);
  else renderFiles(el);
  if (document.activeElement === el && kb >= 0) kbSet(kb);
}

function fileRow(f, sub) {
  const row = document.createElement('div');
  row.className = 'row' + (curPath() === f.path ? ' active' : '');
  row.innerHTML = esc(stem(f.path)) + (sub ? `<small>${esc(sub)}</small>` : '');
  row.title = tilde(f.path);
  row.onclick = () => openFile(f.path);
  row.oncontextmenu = e => { e.preventDefault(); N('ctx', {path: f.path, kind: 'file', pinned: isPinned(f.path)}).then(r => handleCtx(r, f.path)); };
  return row;
}

function section(el, key, title, o = {}) {
  const collapsed = !!S.collapsed[key];
  const h = document.createElement('div'); h.className = 'sech';
  h.innerHTML = `<span>${collapsed ? '▸' : '▾'} ${esc(title)}</span>`;
  h.onclick = () => { S.collapsed[key] = !collapsed; renderSide(); save(); };
  if (o.action) { const b = document.createElement('button'); b.className = 'secb'; b.title = o.action.title; b.innerHTML = ICONS.plus; b.onclick = e => { e.stopPropagation(); o.action.fn(); }; h.append(b); }
  if (o.ctx) h.oncontextmenu = e => { e.preventDefault(); N('ctx', {path: o.ctx.path, kind: o.ctx.kind}).then(r => handleSectionCtx(r, o.ctx.path)); };
  el.append(h);
  const body = document.createElement('div'); body.className = 'secbody'; body.hidden = collapsed; el.append(body);
  return body;
}
async function handleSectionCtx(res, path) {
  if (res === 'addPlace') await addPlace(path);
  else if (res === 'removePlace') { S.orte = S.orte.filter(x => x !== path); delete lists[path]; renderSide(); save(); }
  else if (res === 'removeNotes') { S.notes = null; delete lists[path]; renderSide(); save(); }
  else if (res === 'changeNotes') {
    const d = await N('chooseFolder', {title: 'Neuen Notizordner wählen'}); if (!d) return;
    S.orte = S.orte.filter(x => x !== d); S.notes = d; await loadList(d); renderSide(); save();
  }
}

function renderFiles(el) {
  // Bereiche der Seitenleiste; die Reihenfolge legt der Nutzer per Ziehen fest (S.order)
  const blocks = [];
  if (fileDir && lists[fileDir]) blocks.push({key: 'dir', render: w => {
    const b = section(w, 'd:' + fileDir, base(fileDir), {action: {title: 'Ordner als Ort merken', fn: () => addPlace(fileDir)}, ctx: {path: fileDir, kind: 'folder'}});
    renderTreeFor(fileDir, b);
  }});
  const recent = S.recent.filter(r => !isPinned(r.path)).slice(0, 12);
  if (recent.length) blocks.push({key: 'recent', render: w => { const b = section(w, 'recent', 'Zuletzt'); recent.forEach(r => b.append(fileRow(r, tilde(dirOf(r.path))))); }});
  if (S.pins.length) blocks.push({key: 'pins', render: w => { const b = section(w, 'pins', 'Merkliste'); S.pins.forEach(r => b.append(fileRow(r, tilde(dirOf(r.path))))); }});
  blocks.push({key: 'notes', render: w => {
    const nb = section(w, 'notes', 'Notizen', {action: {title: 'Neue Notiz (⌘N)', fn: newNote}, ctx: S.notes ? {path: S.notes, kind: 'notes'} : null});
    if (S.notes) renderTreeFor(S.notes, nb);
    else { const r = document.createElement('div'); r.className = 'none'; r.innerHTML = 'Noch kein Notizordner. <a class="lnk">Neue Notiz</a> fragt danach.'; r.querySelector('a').onclick = newNote; nb.append(r); }
  }});
  for (const d of S.orte) blocks.push({key: 'o:' + d, render: w => { const b = section(w, 'o:' + d, base(d), {ctx: {path: d, kind: 'place'}}); renderTreeFor(d, b); }});
  const order = S.order || [];
  blocks.map((b, i) => [b, i]).sort((x, y) => {
    const ix = order.indexOf(x[0].key), iy = order.indexOf(y[0].key);
    return (ix < 0 ? 1000 + x[1] : ix) - (iy < 0 ? 1000 + y[1] : iy);
  }).forEach(([blk]) => {
    const w = document.createElement('div'); w.className = 'secwrap'; w.dataset.key = blk.key;
    blk.render(w); el.append(w); makeDraggable(w);
  });
  if (!S.orte.length && !recent.length && !S.pins.length && !S.notes) el.insertAdjacentHTML('beforeend', '<div class="none">Öffne eine Datei oder einen Ordner mit ⌘O.</div>');
}

// Bereiche per Ziehen an der Überschrift umsortieren
let dragKey = null;
function makeDraggable(w) {
  const h = w.querySelector('.sech'); if (!h) return;
  h.draggable = true; h.title = h.title || 'Ziehen zum Verschieben';
  h.addEventListener('dragstart', e => {
    dragKey = w.dataset.key; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragKey);
    setTimeout(() => w.classList.add('dragging'), 0);
  });
  h.addEventListener('dragend', () => { dragKey = null; document.querySelectorAll('.secwrap').forEach(x => x.classList.remove('dragging', 'drop-above', 'drop-below')); });
  w.addEventListener('dragover', e => {
    if (!dragKey || dragKey === w.dataset.key) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const r = w.getBoundingClientRect(), above = e.clientY < r.top + r.height / 2;
    w.classList.toggle('drop-above', above); w.classList.toggle('drop-below', !above);
  });
  w.addEventListener('dragleave', e => { if (!w.contains(e.relatedTarget)) w.classList.remove('drop-above', 'drop-below'); });
  w.addEventListener('drop', e => {
    if (!dragKey || dragKey === w.dataset.key) return;
    e.preventDefault();
    const src = $(`.secwrap[data-key="${CSS.escape(dragKey)}"]`); if (!src) return;
    const above = w.classList.contains('drop-above');
    w.parentNode.insertBefore(src, above ? w : w.nextSibling);
    const visible = [...document.querySelectorAll('#tree .secwrap')].map(x => x.dataset.key);
    S.order = [...visible, ...(S.order || []).filter(k => !visible.includes(k))];
    document.querySelectorAll('.secwrap').forEach(x => x.classList.remove('dragging', 'drop-above', 'drop-below'));
    dragKey = null; save();
  });
}

function renderTreeFor(dir, el) {
  const t = {};
  for (const f of (lists[dir] || [])) {
    let n = t; const parts = f.rel.split('/');
    parts.slice(0, -1).forEach(p => n = (n[p] ??= {}));
    n[parts.at(-1)] = f;
  }
  (function render(node, parent, prefix) {
    const keys = Object.keys(node).sort((a, b) => {
      const da = !node[a].path, db = !node[b].path;
      return da === db ? a.localeCompare(b, 'de', {numeric: true}) : da ? -1 : 1;
    });
    for (const k of keys) {
      const v = node[k];
      if (v.path) { parent.append(fileRow(v)); continue; }
      const id = dir + '/' + prefix + k, open = expanded.has(id);
      const row = document.createElement('div');
      row.className = 'row dir'; row.textContent = (open ? '▾ ' : '▸ ') + k; row.dataset.dir = 1; row.dataset.open = open ? 1 : 0;
      row.onclick = () => { open ? expanded.delete(id) : expanded.add(id); renderSide(); };
      parent.append(row);
      if (open) { const kids = document.createElement('div'); kids.className = 'kids'; parent.append(kids); render(v, kids, prefix + k + '/'); }
    }
  })(t, el, '');
  if (!(lists[dir] || []).length) el.innerHTML = '<div class="none">Keine Markdown-Dateien.</div>';
}

function renderSearch(el) {
  const words = filter.split(/\s+/);
  const names = allFiles().filter(f => words.every(w => f.path.toLowerCase().includes(w)));
  const rest = contentHits.map(p => allFiles().find(f => f.path === p)).filter(f => f && !names.includes(f));
  if (names.length) el.insertAdjacentHTML('beforeend', '<div class="sect">Dateinamen</div>');
  names.slice(0, 100).forEach(f => el.append(fileRow(f, tilde(dirOf(f.path)))));
  if (rest.length) el.insertAdjacentHTML('beforeend', '<div class="sect">Im Text</div>');
  rest.forEach(f => el.append(fileRow(f, tilde(dirOf(f.path)))));
  if (!names.length && !rest.length) el.innerHTML = '<div class="none">Keine Treffer.</div>';
}

// ---------- Rendern ----------
function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return {props: null, body: src};
  const props = []; let last = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w\-äöüÄÖÜ ]+):\s*(.*)$/);
    if (kv) { last = [kv[1].trim(), kv[2].trim()]; props.push(last); }
    else if (last && /^\s*-\s+/.test(line)) last[1] += (last[1] ? ', ' : '') + line.replace(/^\s*-\s+/, '');
  }
  return {props, body: src.slice(m[0].length)};
}

function preprocess(md) {
  const hold = [];
  md = md.replace(/```[\s\S]*?```|`[^`\n]+`/g, m => (hold.push(m), `\u0000${hold.length - 1}\u0000`));
  md = md.replace(/%%[\s\S]*?%%/g, '');
  md = md.replace(/!\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]/g, (_, n, a) =>
    /\.(png|jpe?g|gif|webp|svg)$/i.test(n) ? `<img data-embed="${esc(n.trim())}" alt="${esc(a || n)}">` : `[[${n}]]`);
  md = md.replace(/\[\[#([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, h, a) =>
    `<a class="wiki" data-self="1" data-h="${esc(h.trim())}">${esc(a || h.trim())}</a>`);
  md = md.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, n, h, a) => {
    const name = n.trim();
    return `<a class="wiki${resMap[name] ? '' : ' missing'}" data-wiki="${esc(name)}" data-h="${esc((h || '').slice(1))}">${esc(a || name)}</a>`;
  });
  md = md.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  md = md.replace(/(^|\s)#([\wäöüÄÖÜß\/\-]*[A-Za-zäöüÄÖÜß][\wäöüÄÖÜß\/\-]*)/g, '$1<span class="tag">#$2</span>');
  return md.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[i]);
}

function postprocess(doc) {
  doc.querySelectorAll('blockquote').forEach(bq => {
    const p = bq.querySelector('p'); if (!p) return;
    const m = p.innerHTML.match(/^\[!(\w+)\][+-]?\s*([^\n<]*)/);
    if (!m) return;
    const type = m[1].toLowerCase();
    const div = document.createElement('div'); div.className = 'callout';
    div.style.setProperty('--c', COLORS[type] || COLORS.note);
    const rest = p.innerHTML.slice(m[0].length).replace(/^\s*<br>\s*/, '');
    div.innerHTML = `<div class="ct">${m[2] || type}</div>`;
    if (rest.trim()) div.insertAdjacentHTML('beforeend', `<p>${rest}</p>`);
    [...bq.children].slice(1).forEach(c => div.append(c));
    bq.replaceWith(div);
  });
  doc.querySelectorAll('li').forEach(li => { if (li.querySelector(':scope > input[type=checkbox]')) li.classList.add('task'); });
}

async function renderDoc(path, src) {
  const {props, body} = frontmatter(src);
  const names = [...new Set([...body.matchAll(/\[\[([^\]|#]+)/g)].map(m => m[1].trim()).filter(n => !/\.(png|jpe?g|gif|webp|svg)$/i.test(n)))];
  resMap = {};
  if (names.length) { try { resMap = await N('resolve', {names, from: path, dirs: searchDirs()}); } catch {} }
  const html = DOMPurify.sanitize(marked.parse(preprocess(body), {gfm: true}), {ADD_ATTR: ['data-wiki', 'data-embed']});
  const doc = $('#doc');
  doc.innerHTML = (props?.length
    ? `<div class="props">${props.map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>` : '') + html;
  postprocess(doc);
  doc.querySelectorAll('pre code').forEach(c => { try { hljs.highlightElement(c); } catch {} });
  buildOutline(doc);
  document.title = stem(path);
  doc.querySelectorAll('a.wiki').forEach(a => a.onclick = e => {
    e.preventDefault();
    const h = a.dataset.h;
    if (a.dataset.self) { if (h) scrollToId(slug(h)); return; }
    const p = resMap[a.dataset.wiki]; if (!p) return;
    if (p === curPath()) { if (h) scrollToId(slug(h)); } else openFile(p, {replace: true, heading: h});
  });
  doc.querySelectorAll('a[href]').forEach(a => {
    const h = a.getAttribute('href');
    if (h.startsWith('#')) a.onclick = e => { e.preventDefault(); scrollToId(decodeURIComponent(h.slice(1))); };
    else if (/\.(md|markdown)(#.*)?$/i.test(h) && !/^[a-z]+:/i.test(h)) a.onclick = async e => {
      e.preventDefault();
      const [pth, hh] = h.split('#');
      const r = await N('resolve', {names: [decodeURIComponent(pth)], from: path, dirs: searchDirs()});
      const p = Object.values(r)[0]; if (p) openFile(p, {replace: true, heading: hh && decodeURIComponent(hh)});
    };
  });
  for (const img of doc.querySelectorAll('img')) {
    const name = img.dataset.embed || img.getAttribute('src');
    if (!name || /^(https?:|data:|blob:)/.test(name)) continue;
    N('data', {name: decodeURIComponent(name), from: path, dirs: searchDirs()}).then(u => { if (u) img.src = u; });
    img.onclick = () => img.src && lbOpen(img.src);
  }
  if (tab === 'outline') renderSide();
  if ($('#find').classList.contains('on') && $('#fq').value) runFind(true);
}

// ---------- Backlinks ----------
async function loadBacklinks(path) {
  let r;
  try { r = await N('backlinks', {path, dirs: searchDirs(), files: [...S.recent.map(x => x.path), ...S.pins.map(x => x.path), ...tabs.map(t => t.path)]}); } catch { return; }
  if (curPath() !== path || editing || !r?.length) return;
  $('#doc .backlinks')?.remove();
  const box = document.createElement('div'); box.className = 'backlinks';
  const h = document.createElement('h4'); const list = document.createElement('div'); list.className = 'bllist';
  const paint = () => { h.textContent = `${S.blCollapsed ? '▸' : '▾'} Verlinkt von (${r.length})`; list.hidden = !!S.blCollapsed; };
  h.onclick = () => { S.blCollapsed = !S.blCollapsed; paint(); save(); };
  paint(); box.append(h, list);
  for (const x of r) {
    const row = document.createElement('div'); row.className = 'bl';
    const text = x.snippet.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1').replace(/\]\(.*?\)/g, ']');
    row.innerHTML = `<b>${esc(stem(x.path))}</b><small>${esc(tilde(dirOf(x.path)))}</small><span>${esc(text)}</span>`;
    row.onclick = () => openFile(x.path);
    list.append(row);
  }
  $('#doc').append(box);
}

// ---------- Gliederung & Anker ----------
function buildOutline(doc) {
  outline = []; const used = new Map();
  doc.querySelectorAll('h1,h2,h3,h4').forEach(h => {
    let id = slug(h.textContent) || 'abschnitt'; const n = used.get(id) || 0; used.set(id, n + 1);
    if (n) id += '-' + n;
    h.id = id; outline.push({id, level: +h.tagName[1], text: h.textContent});
  });
}
function scrollToId(id) {
  let el = document.getElementById(id);
  if (!el) { const s = slug(id); el = [...document.querySelectorAll('#doc h1,#doc h2,#doc h3,#doc h4')].find(h => slug(h.textContent) === s); }
  el?.scrollIntoView({block: 'start'});
}
function renderOutline(el) {
  if (!cur) { el.innerHTML = '<div class="none">Keine Datei geöffnet.</div>'; return; }
  if (editing) { el.innerHTML = '<div class="none">Die Gliederung zeigt sich im Lesemodus.</div>'; return; }
  if (!outline.length) { el.innerHTML = '<div class="none">Diese Notiz hat keine Überschriften.</div>'; return; }
  const min = Math.min(...outline.map(o => o.level));
  for (const o of outline) {
    const r = document.createElement('div');
    r.className = 'otl l' + Math.min(4, o.level - min + 1); r.dataset.id = o.id; r.textContent = o.text; r.title = o.text;
    r.onclick = () => scrollToId(o.id);
    el.append(r);
  }
  markOutline();
}
let otlRaf = 0;
function markOutline() {
  const hs = outline.map(o => document.getElementById(o.id)).filter(Boolean);
  let c = null;
  for (const h of hs) if (h.getBoundingClientRect().top <= 90) c = h.id;
  c ??= hs[0]?.id;
  document.querySelectorAll('.otl').forEach(r => r.classList.toggle('on', r.dataset.id === c));
}
$('#main').addEventListener('scroll', () => {
  if (tab !== 'outline' || otlRaf) return;
  otlRaf = requestAnimationFrame(() => { otlRaf = 0; markOutline(); });
});

// ---------- Tastatur in der Seitenleiste ----------
const kbRows = () => [...$('#tree').querySelectorAll('.row,.otl')];
function kbSet(i) {
  const r = kbRows(); if (!r.length) return;
  kb = Math.max(0, Math.min(r.length - 1, i));
  r.forEach(x => x.classList.remove('kb')); r[kb].classList.add('kb'); r[kb].scrollIntoView({block: 'nearest'});
}
$('#tree').tabIndex = 0;
$('#tree').addEventListener('keydown', e => {
  const r = kbRows()[kb];
  if (e.key === 'ArrowDown') { e.preventDefault(); kbSet(kb + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); kb <= 0 ? $('#q').focus() : kbSet(kb - 1); }
  else if (e.key === 'Enter') { r?.click(); }
  else if (e.key === 'ArrowRight' && r?.dataset.dir && r.dataset.open === '0') r.click();
  else if (e.key === 'ArrowLeft' && r?.dataset.dir && r.dataset.open === '1') r.click();
});
$('#tree').addEventListener('blur', () => kbRows().forEach(x => x.classList.remove('kb')));

// ---------- Suche im Dokument ----------
let hits = [], hi = -1;
function clearHits() {
  document.querySelectorAll('#doc mark.hit').forEach(m => { const p = m.parentNode; m.replaceWith(document.createTextNode(m.textContent)); p.normalize(); });
  hits = []; hi = -1;
}
function runFind(keep) {
  const prev = hi; clearHits();
  const q = $('#fq').value;
  if (!q || editing) { $('#fc').textContent = ''; return; }
  const w = document.createTreeWalker($('#doc'), NodeFilter.SHOW_TEXT), nodes = [];
  while (w.nextNode()) nodes.push(w.currentNode);
  const ql = q.toLowerCase();
  for (const n of nodes) {
    const t = n.nodeValue, tl = t.toLowerCase(); let i = tl.indexOf(ql); if (i < 0) continue;
    const frag = document.createDocumentFragment(); let last = 0;
    while (i >= 0) {
      frag.append(t.slice(last, i));
      const m = document.createElement('mark'); m.className = 'hit'; m.textContent = t.slice(i, i + q.length); frag.append(m);
      last = i + q.length; i = tl.indexOf(ql, last);
    }
    frag.append(t.slice(last)); n.replaceWith(frag);
  }
  hits = [...document.querySelectorAll('#doc mark.hit')];
  hi = hits.length ? (keep && prev >= 0 ? Math.min(prev, hits.length - 1) : 0) : -1;
  markHit(!keep);
}
function markHit(scroll = true) {
  hits.forEach(h => h.classList.remove('cur'));
  $('#fc').textContent = hits.length ? `${hi + 1} von ${hits.length}` : 'Kein Treffer';
  if (hi >= 0) { hits[hi].classList.add('cur'); if (scroll) hits[hi].scrollIntoView({block: 'center'}); }
}
async function findOpen() {
  if (editing && !await leaveEdit()) return;
  const sel = getSelection().toString().trim();
  if (sel && sel.length < 80 && !sel.includes('\n')) $('#fq').value = sel;
  $('#find').classList.add('on'); $('#fq').focus(); $('#fq').select();
  if ($('#fq').value) runFind();
}
function findClose() { $('#find').classList.remove('on'); clearHits(); }
function findStep(d) {
  if (!$('#find').classList.contains('on')) return findOpen();
  if (!hits.length) return; hi = (hi + d + hits.length) % hits.length; markHit();
}
$('#fq').oninput = () => runFind();
$('#fq').onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') findClose();
};
$('#fp').onclick = () => findStep(-1); $('#fn').onclick = () => findStep(1); $('#fx').onclick = findClose;

// ---------- Schnellwechsler (⌘P) ----------
let palItems = [], palSel = 0, palTimer = null, palContent = [];
function palette() {
  $('#pal').classList.add('on'); $('#pq').value = ''; palContent = []; palSel = 0; palRender(); $('#pq').focus();
}
function palClose() { $('#pal').classList.remove('on'); }
function palRender() {
  const q = $('#pq').value.trim().toLowerCase();
  const groups = [], files = allFiles();
  const byPath = p => files.find(f => f.path === p);
  if (!q) {
    const rec = S.recent.map(r => byPath(r.path)).filter(Boolean).slice(0, 10);
    const pins = S.pins.map(r => byPath(r.path)).filter(f => f && !rec.includes(f));
    const newest = [...files].sort((a, b) => b.mtime - a.mtime).filter(f => !rec.includes(f) && !pins.includes(f)).slice(0, 8);
    groups.push(['Zuletzt geöffnet', rec], ['Merkliste', pins], ['Zuletzt geändert', newest]);
  } else {
    const words = q.split(/\s+/), scored = [];
    for (const f of files) {
      const p = f.path.toLowerCase(), st = stem(f.path).toLowerCase();
      if (!words.every(w => p.includes(w))) continue;
      scored.push([st === q ? 0 : st.startsWith(q) ? 1 : st.includes(q) ? 2 : 3, f]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].path.length - b[1].path.length);
    const names = scored.slice(0, 30).map(x => x[1]);
    groups.push(['Dateien', names], ['Im Text', palContent.map(byPath).filter(f => f && !names.includes(f)).slice(0, 20)]);
  }
  palItems = []; const box = $('#pres'); box.innerHTML = '';
  for (const [title, list] of groups) {
    if (!list.length) continue;
    box.insertAdjacentHTML('beforeend', `<div class="sect">${esc(title)}</div>`);
    for (const f of list) {
      const r = document.createElement('div'); r.className = 'prow';
      r.innerHTML = `<span>${esc(stem(f.path))}</span><small>${esc(tilde(dirOf(f.path)))}</small>`;
      r.onclick = () => { palClose(); openFile(f.path); };
      palItems.push({f, r}); box.append(r);
    }
  }
  if (!palItems.length) box.innerHTML = '<div class="none">Keine Treffer.</div>';
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1)); palMark();
}
function palMark() {
  palItems.forEach((x, i) => x.r.classList.toggle('sel', i === palSel));
  palItems[palSel]?.r.scrollIntoView({block: 'nearest'});
}
$('#pq').oninput = () => {
  palSel = 0; palRender(); clearTimeout(palTimer);
  const q = $('#pq').value.trim();
  if (q.length > 2) palTimer = setTimeout(async () => {
    palContent = await N('search', {q: q.toLowerCase(), dirs: searchDirs(), files: [...S.recent.map(r => r.path), ...S.pins.map(r => r.path), ...tabs.map(t => t.path)]});
    if ($('#pq').value.trim() === q) palRender();
  }, 250);
};
$('#pq').onkeydown = e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); palMark(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); palMark(); }
  else if (e.key === 'Enter') { const x = palItems[palSel]; if (x) { palClose(); openFile(x.f.path); } }
  else if (e.key === 'Escape') palClose();
};
$('#pal').onclick = e => { if (e.target.id === 'pal') palClose(); };

// ---------- Bilder ----------
function imageLoader(name) {
  if (/^https?:/i.test(name)) return Promise.resolve(name);
  return N('data', {name: decodeURIComponent(name), from: cur.path, dirs: searchDirs()});
}
function fileToBase64(f) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
}
async function saveImage(f) {
  const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  try { return await N('saveImage', {path: cur.path, data: await fileToBase64(f), ext}); }
  catch { stat('Bild konnte nicht gespeichert werden'); return null; }
}
async function insertImagePath(src) {
  if (!editing || !ed) { stat('Zum Einfügen von Bildern erst bearbeiten (⌘E)'); setTimeout(() => stat(''), 3500); return; }
  try { const rel = await N('importImage', {path: cur.path, src}); if (rel) ed.insert('![](' + rel + ')'); }
  catch { stat('Bild konnte nicht eingefügt werden'); }
}
function lbOpen(src) { $('#lbimg').src = src; $('#lb').classList.add('on'); }
function lbClose() { $('#lb').classList.remove('on'); }
$('#lb').onclick = lbClose;

// ---------- Bearbeiten ----------
function wikiNames() {
  const seen = new Set(), out = [];
  for (const f of allFiles()) {
    const s = stem(f.path), k = s.toLowerCase();
    if (seen.has(k) || f.path === cur?.path) continue;
    seen.add(k); out.push({label: s, detail: tilde(dirOf(f.path))});
  }
  return out;
}
function stat(t) { statText = t; const e = $('#stat'); if (e) e.textContent = t; }
function showWarn() { $('#warn').classList.add('on'); }
function hideWarn() { $('#warn').classList.remove('on'); conflict = false; }
async function toggleEdit() { if (!cur) return; editing ? await leaveEdit() : await enterEdit(); }

async function enterEdit() {
  let r;
  try { r = await N('read', {path: cur.path}); } catch { return; }
  if ($('#find').classList.contains('on')) findClose();
  cur.mtime = r.mtime; editing = true; dirty = false; statText = ''; hideWarn();
  const doc = $('#doc'); doc.innerHTML = '';
  ed = MDEditor.create(doc, r.text, () => {
    dirty = true; stat('ungespeichert'); clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNow(), 700);
  }, {links: wikiNames, image: imageLoader, saveImage});
  ed.view.dispatch({selection: {anchor: 0}}); ed.focus();
  renderTabs(); if (tab === 'outline') renderSide();
}
async function saveNow(force) {
  clearTimeout(saveTimer);
  if (!editing || !ed || !dirty || !cur || (conflict && !force)) return;
  const text = ed.getValue();
  try {
    const mt = await N('write', {path: cur.path, text, expect: cur.mtime, force: !!force});
    cur.mtime = mt; hideWarn(); dirty = ed ? ed.getValue() !== text : false;
    stat(dirty ? 'ungespeichert' : 'gespeichert');
    if (dirty) saveTimer = setTimeout(() => saveNow(), 700);
  } catch (e) {
    if (String(e?.message || e).includes('conflict')) { conflict = true; showWarn(); stat('Konflikt'); }
    else stat('Speichern fehlgeschlagen');
  }
}
async function reloadFromDisk() {
  const r = await N('read', {path: cur.path});
  ed.view.dispatch({changes: {from: 0, to: ed.view.state.doc.length, insert: r.text}});
  cur.mtime = r.mtime; dirty = false; clearTimeout(saveTimer); hideWarn(); stat('neu geladen');
}
async function leaveEdit(skipShow) {
  await saveNow();
  if (conflict && dirty) { showWarn(); return false; }
  await autoName();
  ed?.destroy(); ed = null; editing = false; stat('');
  if (!skipShow && cur) { const y = $('#main').scrollTop; await showActive(null, {scroll: y}); } else renderTabs();
  return true;
}
$('#main').addEventListener('click', e => { if (editing && ed && !e.target.closest('.cm-editor')) ed.focus(); });
window.addEventListener('blur', () => { if (editing) saveNow(); });
$('#warnsave').onclick = () => saveNow(true);
$('#warnload').onclick = reloadFromDisk;

// ---------- Datei-Aktionen ----------
const revealCurrent = () => cur && N('reveal', {path: cur.path});
const editCurrent = () => cur && N('editor', {path: cur.path});
const copyPathCurrent = () => cur && N('copyPath', {path: cur.path});

// ---------- Bedienung ----------
function toggleSide() { document.body.classList.toggle('noside'); S.noside = document.body.classList.contains('noside'); save(); }
function toggleFocus() { document.body.classList.toggle('focus'); }
function setTab(t) { tab = t; filter = ''; $('#q').value = ''; document.body.classList.remove('noside'); renderSide(); }
function focusSearch() { document.body.classList.remove('noside'); $('#q').focus(); $('#q').select(); }
document.querySelectorAll('.tab').forEach(t => t.onclick = () => setTab(t.dataset.t));
$('#focusx').onclick = toggleFocus;
let qTimer = null;
$('#q').oninput = e => {
  filter = e.target.value.trim().toLowerCase(); contentHits = [];
  renderSide(); clearTimeout(qTimer);
  if (filter.length > 2) qTimer = setTimeout(async () => {
    contentHits = await N('search', {q: filter, dirs: searchDirs(), files: [...S.recent.map(r => r.path), ...S.pins.map(r => r.path)]});
    if (filter) renderSide();
  }, 250);
};
$('#q').onkeydown = e => {
  if (e.key === 'Escape') { e.target.value = ''; filter = ''; e.target.blur(); renderSide(); }
  if (e.key === 'Enter') { $('#tree .row:not(.dir)')?.click(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); $('#tree').focus(); kbSet(0); }
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (document.body.classList.contains('focus') && !$('#pal').classList.contains('on') && !$('#find').classList.contains('on')) toggleFocus(); palClose(); lbClose(); if (document.activeElement?.id !== 'q') findClose(); } });

async function refreshAll(force) {
  await loadLists(); renderSide();
  const p = curPath();
  if (p && !editing && cur) {
    const st = await N('stat', {path: p});
    if (st != null && (force || st !== cur.mtime)) { const y = $('#main').scrollTop; await showActive(null, {scroll: y}); }
  }
}
window.addEventListener('focus', () => { if (booted) refreshAll(); });
renderTabs();
