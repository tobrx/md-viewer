// Markdown-Editor mit "Live Preview" wie in Obsidian:
// Syntax-Zeichen (#, **, *, `, [](), ~~) werden ausgeblendet, solange der Cursor nicht in der Zeile steht.
import {EditorState, EditorSelection} from '@codemirror/state'
import {EditorView, ViewPlugin, Decoration, WidgetType, keymap, drawSelection} from '@codemirror/view'
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands'
import {markdown, markdownLanguage} from '@codemirror/lang-markdown'
import {syntaxTree, HighlightStyle, syntaxHighlighting} from '@codemirror/language'
import {autocompletion} from '@codemirror/autocomplete'
import {tags as t} from '@lezer/highlight'

const MONO = 'ui-monospace,Menlo,monospace'
const hide = Decoration.replace({})

const style = HighlightStyle.define([
  {tag: t.heading, fontWeight: '700'},
  {tag: t.strong, fontWeight: '700'},
  {tag: t.emphasis, fontStyle: 'italic'},
  {tag: t.strikethrough, textDecoration: 'line-through'},
  {tag: t.link, color: 'var(--acc)'},
  {tag: t.url, color: 'var(--mute)'},
  {tag: t.monospace, fontFamily: MONO, fontSize: '.88em', background: 'var(--code)', borderRadius: '4px'},
  {tag: t.quote, color: 'var(--mute)'},
  {tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--mute)'},
])

class ImgWidget extends WidgetType {
  constructor(name, opts) { super(); this.name = name; this.opts = opts }
  eq(o) { return o.name === this.name }
  toDOM() {
    const img = document.createElement('img')
    img.className = 'cm-img'; img.alt = this.name
    const cache = this.opts.cache, name = this.name
    if (cache.has(name)) img.src = cache.get(name)
    else if (this.opts.image) this.opts.image(name).then(u => { if (u) { cache.set(name, u); img.src = u } })
    return img
  }
}

const IMG_RE = /!\[[^\]]*\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)|!\[\[([^\]|]+?\.(?:png|jpe?g|gif|webp|svg))(?:\|[^\]]*)?\]\]/gi

function build(view, opts) {
  const {state} = view
  const doc = state.doc
  const active = new Set()
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number, z = doc.lineAt(r.to).number
    for (let i = a; i <= z; i++) active.add(i)
  }
  const out = []
  const code = new Set()
  const onActive = pos => active.has(doc.lineAt(pos).number)
  for (const {from, to} of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(node) {
        const n = node.name
        if (/^ATXHeading[1-6]$/.test(n)) {
          out.push(Decoration.line({class: 'cm-h' + n.slice(-1)}).range(doc.lineAt(node.from).from))
        } else if (n === 'FencedCode' || n === 'CodeBlock') {
          const a = doc.lineAt(node.from).number, z = doc.lineAt(node.to).number
          for (let i = a; i <= z; i++) { code.add(i); out.push(Decoration.line({class: 'cm-codeline'}).range(doc.line(i).from)) }
        } else if (n === 'Blockquote') {
          const a = doc.lineAt(node.from).number, z = doc.lineAt(node.to).number
          for (let i = a; i <= z; i++) out.push(Decoration.line({class: 'cm-quoteline'}).range(doc.line(i).from))
        } else if (n === 'HeaderMark' || n === 'EmphasisMark' || n === 'StrikethroughMark') {
          if (!onActive(node.from)) {
            let end = node.to
            if (n === 'HeaderMark' && doc.sliceString(end, end + 1) === ' ') end++
            out.push(hide.range(node.from, end))
          }
        } else if (n === 'CodeMark' && node.node.parent?.name === 'InlineCode') {
          if (!onActive(node.from)) out.push(hide.range(node.from, node.to))
        } else if ((n === 'LinkMark' || n === 'URL') && node.node.parent?.name === 'Link') {
          if (!onActive(node.from)) out.push(hide.range(node.from, node.to))
        }
      },
    })
  }
  // Bilder als Vorschau, solange der Cursor nicht in der Zeile steht
  for (const {from, to} of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos)
      if (!active.has(line.number) && !code.has(line.number) && line.text.includes('![')) {
        IMG_RE.lastIndex = 0
        let m
        while ((m = IMG_RE.exec(line.text))) {
          const name = m[1] || m[2]
          out.push(Decoration.replace({widget: new ImgWidget(name, opts)}).range(line.from + m.index, line.from + m.index + m[0].length))
        }
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(out, true)
}

const livePreview = opts => ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view, opts) }
  update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view, opts) }
}, {decorations: v => v.decorations})

const theme = EditorView.theme({
  '&': {background: 'transparent', color: 'var(--tx)', fontSize: '16px'},
  '&.cm-focused': {outline: 'none'},
  '.cm-scroller': {fontFamily: 'inherit', lineHeight: '1.65', overflow: 'visible'},
  '.cm-content': {padding: '0', minHeight: '60vh', caretColor: 'var(--tx)'},
  '.cm-line': {padding: '0'},
  '.cm-cursor': {borderLeftColor: 'var(--tx)'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {background: 'color-mix(in srgb, var(--acc) 30%, transparent)'},
  '.cm-h1': {fontSize: '2em', lineHeight: '1.3', paddingTop: '.3em'},
  '.cm-h2': {fontSize: '1.5em', lineHeight: '1.3', paddingTop: '.3em'},
  '.cm-h3': {fontSize: '1.25em', lineHeight: '1.4', paddingTop: '.2em'},
  '.cm-h4, .cm-h5, .cm-h6': {fontSize: '1.05em'},
  '.cm-codeline': {background: 'var(--code)', fontFamily: MONO, fontSize: '.88em', padding: '0 14px'},
  '.cm-codeline *': {fontFamily: MONO, background: 'none'},
  '.cm-tooltip': {background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: '8px', color: 'var(--tx)', overflow: 'hidden'},
  '.cm-tooltip-autocomplete ul': {fontFamily: 'inherit', fontSize: '14px'},
  '.cm-tooltip-autocomplete ul li': {padding: '3px 10px'},
  '.cm-tooltip-autocomplete ul li[aria-selected]': {background: 'var(--acc)', color: 'var(--bg)'},
  '.cm-completionDetail': {opacity: '.65', marginLeft: '1em', fontStyle: 'normal'},
  '.cm-img': {maxWidth: '100%', borderRadius: '6px', verticalAlign: 'middle'},
  '.cm-quoteline': {borderLeft: '3px solid var(--quote)', paddingLeft: '1em'},
})

const wrap = m => ({state, dispatch}) => {
  const L = m.length
  dispatch(state.update(state.changeByRange(r => {
    const before = state.sliceDoc(r.from - L, r.from), after = state.sliceDoc(r.to, r.to + L)
    if (before === m && after === m)
      return {changes: [{from: r.from - L, to: r.from}, {from: r.to, to: r.to + L}], range: EditorSelection.range(r.from - L, r.to - L)}
    return {changes: [{from: r.from, insert: m}, {from: r.to, insert: m}], range: EditorSelection.range(r.from + L, r.to + L)}
  }), {scrollIntoView: true, userEvent: 'input'}))
  return true
}

// [[ -> Auswahl der bekannten Notizen. links() liefert [{label, detail}]
function wikiSource(links) {
  return ctx => {
    const m = ctx.matchBefore(/\[\[[^\]\n]*$/)
    if (!m) return null
    return {
      from: m.from + 2,
      options: links().map(l => ({
        label: l.label, detail: l.detail,
        apply: (view, c, from, to) => {
          const closed = view.state.sliceDoc(to, to + 2) === ']]'
          view.dispatch({changes: {from, to: closed ? to + 2 : to, insert: l.label + ']]'}, selection: {anchor: from + l.label.length + 2}})
        },
      })),
      validFor: /^[^\]\n]*$/,
    }
  }
}

// Fügt Text auf einer eigenen Zeile ein, wenn der Cursor hinter Text steht
function insertBlock(view, text) {
  const sel = view.state.selection.main
  const line = view.state.doc.lineAt(sel.from)
  const pre = line.text.trim() ? '\n\n' : ''
  view.dispatch(view.state.replaceSelection(pre + text + '\n'))
}

export function create(parent, doc, onChange, opts = {}) {
  opts.cache = new Map()
  const imageFiles = list => [...(list || [])].filter(f => f.type && f.type.startsWith('image/'))
  const addImages = async (files, view) => {
    for (const f of files) {
      const rel = opts.saveImage ? await opts.saveImage(f) : null
      if (rel) insertBlock(view, '![](' + rel + ')')
    }
  }
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(), drawSelection(),
        markdown({base: markdownLanguage}),
        autocompletion({override: [wikiSource(opts.links || (() => []))], icons: false}),
        syntaxHighlighting(style), livePreview(opts), theme,
        EditorView.domEventHandlers({
          paste(e, view) { const f = imageFiles(e.clipboardData && e.clipboardData.files); if (!f.length) return false; e.preventDefault(); addImages(f, view); return true },
          drop(e, view) { const f = imageFiles(e.dataTransfer && e.dataTransfer.files); if (!f.length) return false; e.preventDefault(); addImages(f, view); return true },
        }), EditorView.lineWrapping,
        keymap.of([{key: 'Mod-b', run: wrap('**')}, {key: 'Mod-i', run: wrap('*')}, indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(u => { if (u.docChanged) onChange() }),
      ],
    }),
  })
  return {insert: t => insertBlock(view, t), getValue: () => view.state.doc.toString(), focus: () => view.focus(), destroy: () => view.destroy(), view}
}
