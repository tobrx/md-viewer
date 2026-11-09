import Cocoa
import WebKit
import UniformTypeIdentifiers

let defaults = UserDefaults.standard

// MARK: - Darstellung und Icon

var themeItems: [NSMenuItem] = []

func updateIcon() {
    let mode = defaults.string(forKey: "appearance") ?? "system"
    let dark = mode == "dark" || (mode == "system" && NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua)
    if let u = Bundle.main.url(forResource: dark ? "AppIcon-dunkel" : "AppIcon-hell", withExtension: "icns"),
       let img = NSImage(contentsOf: u) { NSApp.applicationIconImage = img }
}

func applyAppearance(_ mode: String) {
    defaults.set(mode, forKey: "appearance")
    NSApp.appearance = mode == "light" ? NSAppearance(named: .aqua) : mode == "dark" ? NSAppearance(named: .darkAqua) : nil
    for i in themeItems { i.state = (i.representedObject as? String) == mode ? .on : .off }
    updateIcon()
}

// MARK: - Helfer

final class Act: NSObject {
    let f: () -> Void
    init(_ f: @escaping () -> Void) { self.f = f }
    @objc func run() { f() }
}

let editors: [(name: String, id: String)] = [
    ("VSCodium", "com.vscodium"), ("Visual Studio Code", "com.microsoft.VSCode"),
    ("Obsidian", "md.obsidian"), ("TextEdit", "com.apple.TextEdit"),
]

func installed(_ id: String) -> URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) }

func open(_ u: URL, with id: String) {
    if id == "md.obsidian" {
        var c = URLComponents(string: "obsidian://open")!
        c.queryItems = [URLQueryItem(name: "path", value: u.path)]
        if let url = c.url { NSWorkspace.shared.open(url) }
        return
    }
    guard let app = installed(id) else { NSWorkspace.shared.open(u); return }
    NSWorkspace.shared.open([u], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
}

func fileURL(_ p: String) -> URL { URL(fileURLWithPath: (p as NSString).expandingTildeInPath).resolvingSymlinksInPath() }
func isMD(_ u: URL) -> Bool { ["md", "markdown"].contains(u.pathExtension.lowercased()) }
func isDirectory(_ u: URL) -> Bool { var d: ObjCBool = false; return FileManager.default.fileExists(atPath: u.path, isDirectory: &d) && d.boolValue }
func mtimeOf(_ u: URL) -> Double {
    (try? u.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?.timeIntervalSince1970 ?? 0
}

/// Dateiindex je Ordner (kurz zwischengespeichert): Name → Pfad. Markdown unter "md:<name ohne Endung>", sonst "f:<dateiname>".
final class Indexer {
    private var cache: [String: (Date, [String: String])] = [:]
    private let lock = NSLock()

    func index(_ dir: String, depth: Int) -> [String: String] {
        let key = "\(dir)#\(depth)"
        lock.lock(); let hit = cache[key]; lock.unlock()
        if let hit, Date().timeIntervalSince(hit.0) < 20 { return hit.1 }
        var map: [String: String] = [:]
        if let en = FileManager.default.enumerator(at: URL(fileURLWithPath: dir), includingPropertiesForKeys: nil,
                                                   options: [.skipsHiddenFiles, .skipsPackageDescendants]) {
            var n = 0
            for case let u as URL in en {
                n += 1; if n > 40000 { break }
                if en.level > depth || u.lastPathComponent == "node_modules" { en.skipDescendants(); if en.level > depth { continue } }
                let name = u.lastPathComponent.lowercased()
                if isMD(u) {
                    let k = "md:" + (name as NSString).deletingPathExtension
                    if map[k] == nil { map[k] = u.path }
                } else if map["f:" + name] == nil { map["f:" + name] = u.path }
            }
        }
        lock.lock(); cache[key] = (Date(), map); lock.unlock()
        return map
    }

    func lookup(_ key: String, from: String?, dirs: [String]) -> String? {
        var order: [(String, Int)] = []
        if let from { order.append(((from as NSString).deletingLastPathComponent, 3)) }
        for d in dirs { order.append((d, 99)) }
        for (d, depth) in order { if let p = index(d, depth: depth)[key] { return p } }
        return nil
    }
}

// MARK: - Bridge (Dateizugriff für die Web-Oberfläche)

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    let fm = FileManager.default
    let indexer = Indexer()

    func listMD(_ dir: String, depth: Int = 99) -> [[String: Any]] {
        var out: [[String: Any]] = []
        let base = fileURL(dir)
        guard let en = fm.enumerator(at: base, includingPropertiesForKeys: [.contentModificationDateKey],
                                     options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        var n = 0
        for case let u as URL in en {
            n += 1; if n > 40000 { break }
            if en.level > depth || u.lastPathComponent == "node_modules" { en.skipDescendants(); continue }
            guard isMD(u) else { continue }
            let p = u.standardizedFileURL.path
            out.append(["path": p, "rel": String(p.dropFirst(base.path.count + 1)), "mtime": mtimeOf(u)])
        }
        return out
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let b = message.body as? [String: Any], let a = b["a"] as? String else { replyHandler(nil, "bad"); return }
        let path = b["path"] as? String
        switch a {
        case "getState":
            replyHandler(defaults.string(forKey: "state") ?? "{}", nil)
        case "setState":
            defaults.set(b["json"] as? String, forKey: "state"); replyHandler(true, nil)
        case "theme":
            if let mode = b["mode"] as? String { applyAppearance(mode) }
            replyHandler(defaults.string(forKey: "appearance") ?? "system", nil)

        case "chooseFiles":
            let p = NSOpenPanel()
            p.canChooseFiles = true; p.canChooseDirectories = true; p.allowsMultipleSelection = true
            p.prompt = "Öffnen"; p.message = "Markdown-Dateien oder Ordner wählen"
            var types: [UTType] = [.folder]
            for e in ["md", "markdown"] { if let t = UTType(filenameExtension: e) { types.append(t) } }
            p.allowedContentTypes = types
            if p.runModal() == .OK {
                replyHandler(p.urls.map { ["path": $0.resolvingSymlinksInPath().path, "dir": isDirectory($0)] }, nil)
            } else { replyHandler([], nil) }
        case "chooseFolder":
            let p = NSOpenPanel()
            p.canChooseFiles = false; p.canChooseDirectories = true; p.canCreateDirectories = true
            p.prompt = "Wählen"; p.message = b["title"] as? String ?? "Ordner wählen"
            if p.runModal() == .OK, let u = p.url { replyHandler(u.resolvingSymlinksInPath().path, nil) } else { replyHandler(nil, nil) }

        case "list":
            guard let dir = b["dir"] as? String else { replyHandler([], nil); return }
            DispatchQueue.global().async {
                let r = self.listMD(dir, depth: b["depth"] as? Int ?? 99)
                DispatchQueue.main.async { replyHandler(r, nil) }
            }
        case "stat":
            guard let p = path else { replyHandler(nil, "bad"); return }
            let u = fileURL(p)
            replyHandler(fm.fileExists(atPath: u.path) ? mtimeOf(u) : nil, nil)
        case "read":
            guard let p = path else { replyHandler(nil, "bad"); return }
            let u = fileURL(p)
            if let s = try? String(contentsOf: u, encoding: .utf8) { replyHandler(["text": s, "mtime": mtimeOf(u)], nil) }
            else { replyHandler(nil, "nicht lesbar") }
        case "write":
            guard let p = path, let t = b["text"] as? String else { replyHandler(nil, "bad"); return }
            let u = fileURL(p)
            guard isMD(u), fm.fileExists(atPath: u.path) else { replyHandler(nil, "bad"); return }
            if let e = b["expect"] as? Double, !(b["force"] as? Bool ?? false), abs(mtimeOf(u) - e) > 0.001 {
                replyHandler(nil, "conflict"); return
            }
            do { try t.write(to: u, atomically: true, encoding: .utf8); replyHandler(mtimeOf(u), nil) }
            catch { replyHandler(nil, "Schreiben fehlgeschlagen") }

        case "search":
            let q = (b["q"] as? String ?? "").lowercased()
            let dirs = b["dirs"] as? [String] ?? [], extra = b["files"] as? [String] ?? []
            DispatchQueue.global().async {
                var paths = Set(extra)
                for d in dirs { for f in self.listMD(d) { if let p = f["path"] as? String { paths.insert(p) } } }
                var hits: [String] = []
                for p in paths where hits.count < 200 {
                    if let s = try? String(contentsOf: URL(fileURLWithPath: p), encoding: .utf8), s.lowercased().contains(q) { hits.append(p) }
                }
                DispatchQueue.main.async { replyHandler(hits, nil) }
            }
        case "backlinks":
            guard let p = path else { replyHandler([], nil); return }
            let dirs = b["dirs"] as? [String] ?? [], extra = b["files"] as? [String] ?? []
            let target = fileURL(p)
            let tstem = target.deletingPathExtension().lastPathComponent.lowercased()
            DispatchQueue.global().async {
                var paths = Set(extra)
                for d in dirs { for f in self.listMD(d) { if let q = f["path"] as? String { paths.insert(q) } } }
                let wiki = try! NSRegularExpression(pattern: "\\[\\[([^\\]|#]+)")
                let link = try! NSRegularExpression(pattern: "\\]\\(([^)#]+?)\\.(?:md|markdown)(?:#[^)]*)?\\)", options: .caseInsensitive)
                var out: [[String: Any]] = []
                for q in paths.sorted() where out.count < 100 {
                    if fileURL(q).path == target.path { continue }
                    guard let s = try? String(contentsOf: URL(fileURLWithPath: q), encoding: .utf8) else { continue }
                    var snippet: String?
                    for line in s.split(separator: "\n", omittingEmptySubsequences: true) {
                        guard line.contains("[[") || line.contains("](") else { continue }
                        let l = String(line); let ns = l as NSString; let r = NSRange(location: 0, length: ns.length)
                        var hit = false
                        for re in [wiki, link] {
                            for mt in re.matches(in: l, range: r) {
                                let raw = ns.substring(with: mt.range(at: 1)); let name = ((raw.removingPercentEncoding ?? raw) as NSString).lastPathComponent.lowercased()
                                let nstem = name.hasSuffix(".md") ? String(name.dropLast(3)) : name
                                if nstem.trimmingCharacters(in: .whitespaces) == tstem { hit = true }
                            }
                        }
                        if hit { snippet = String(l.trimmingCharacters(in: .whitespaces).prefix(160)); break }
                    }
                    if let sn = snippet { out.append(["path": q, "snippet": sn]) }
                }
                DispatchQueue.main.async { replyHandler(out, nil) }
            }
        case "resolve":
            let names = b["names"] as? [String] ?? [], from = b["from"] as? String, dirs = b["dirs"] as? [String] ?? []
            DispatchQueue.global().async {
                var out: [String: String] = [:]
                for n in names {
                    var key = (n as NSString).lastPathComponent.lowercased()
                    if key.hasSuffix(".md") { key = String(key.dropLast(3)) } else if key.hasSuffix(".markdown") { key = String(key.dropLast(9)) }
                    if let p = self.indexer.lookup("md:" + key, from: from, dirs: dirs) { out[n] = p }
                }
                DispatchQueue.main.async { replyHandler(out, nil) }
            }
        case "data":
            let name = b["name"] as? String ?? "", from = b["from"] as? String ?? "", dirs = b["dirs"] as? [String] ?? []
            DispatchQueue.global().async {
                var found: URL?
                let rel = URL(fileURLWithPath: ((from as NSString).deletingLastPathComponent as NSString).appendingPathComponent(name)).standardizedFileURL
                if self.fm.fileExists(atPath: rel.path) { found = rel }
                else if let p = self.indexer.lookup("f:" + (name as NSString).lastPathComponent.lowercased(), from: from, dirs: dirs) { found = URL(fileURLWithPath: p) }
                var result: String?
                if let u = found, let d = try? Data(contentsOf: u), d.count < 40_000_000 {
                    let mime = UTType(filenameExtension: u.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                    result = "data:\(mime);base64," + d.base64EncodedString()
                }
                DispatchQueue.main.async { replyHandler(result, nil) }
            }

        case "saveImage", "importImage":
            guard let p = path else { replyHandler(nil, "bad"); return }
            let noteDir = fileURL(p).deletingLastPathComponent()
            let dir = noteDir.appendingPathComponent("bilder")
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let allowed = ["png", "jpg", "jpeg", "gif", "webp", "svg"]
            var name: String, ext: String
            if a == "saveImage" {
                ext = (b["ext"] as? String ?? "png").lowercased()
                guard allowed.contains(ext) else { replyHandler(nil, "Typ nicht unterstützt"); return }
                let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"
                name = "bild-" + f.string(from: Date())
            } else {
                guard let src = b["src"] as? String else { replyHandler(nil, "bad"); return }
                let su = URL(fileURLWithPath: src)
                ext = su.pathExtension.lowercased()
                guard allowed.contains(ext) else { replyHandler(nil, "Typ nicht unterstützt"); return }
                name = su.deletingPathExtension().lastPathComponent.replacingOccurrences(of: " ", with: "-")
            }
            var dest = dir.appendingPathComponent(name + "." + ext), n = 2
            while fm.fileExists(atPath: dest.path) { dest = dir.appendingPathComponent("\(name)-\(n)." + ext); n += 1 }
            do {
                if a == "saveImage" {
                    guard let d = Data(base64Encoded: b["data"] as? String ?? ""), d.count < 60_000_000 else { replyHandler(nil, "zu groß"); return }
                    try d.write(to: dest)
                } else { try fm.copyItem(at: URL(fileURLWithPath: b["src"] as? String ?? ""), to: dest) }
                replyHandler("bilder/" + dest.lastPathComponent, nil)
            } catch { replyHandler(nil, "Speichern fehlgeschlagen") }
        case "newNote":
            guard let dir = b["dir"] as? String else { replyHandler(nil, "bad"); return }
            let base = fileURL(dir)
            var n = 1, u = base.appendingPathComponent("Unbenannt.md")
            while fm.fileExists(atPath: u.path) { n += 1; u = base.appendingPathComponent("Unbenannt \(n).md") }
            do { try "# \n".write(to: u, atomically: true, encoding: .utf8); replyHandler(u.path, nil) }
            catch { replyHandler(nil, "Anlegen fehlgeschlagen") }
        case "rename":
            guard let p = path, var name = b["name"] as? String else { replyHandler(nil, "bad"); return }
            let u = fileURL(p)
            name = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-").trimmingCharacters(in: .whitespaces)
            if !isMD(URL(fileURLWithPath: name)) { name += ".md" }
            var dest = u.deletingLastPathComponent().appendingPathComponent(name)
            if dest.path != u.path, fm.fileExists(atPath: dest.path) {
                let stem = (name as NSString).deletingPathExtension; var n = 2
                repeat { dest = u.deletingLastPathComponent().appendingPathComponent("\(stem) \(n).md"); n += 1 } while fm.fileExists(atPath: dest.path)
            }
            do { if dest.path != u.path { try fm.moveItem(at: u, to: dest) }; replyHandler(dest.path, nil) }
            catch { replyHandler(nil, "Umbenennen fehlgeschlagen") }

        case "reveal", "copyPath", "editor", "ctx", "trash":
            guard let p = path else { replyHandler(nil, "bad"); return }
            let u = fileURL(p)
            switch a {
            case "reveal": NSWorkspace.shared.activateFileViewerSelecting([u]); replyHandler(true, nil)
            case "copyPath":
                NSPasteboard.general.clearContents(); NSPasteboard.general.setString(u.path, forType: .string); replyHandler(true, nil)
            case "editor":
                if let e = editors.first(where: { installed($0.id) != nil && $0.id != "com.apple.TextEdit" && $0.id != "md.obsidian" }) { open(u, with: e.id) }
                else { NSWorkspace.shared.open(u) }
                replyHandler(true, nil)
            case "trash":
                replyHandler(confirmTrash(u), nil)
            default:
                replyHandler(contextMenu(u, kind: b["kind"] as? String ?? "file", pinned: b["pinned"] as? Bool ?? false), nil)
            }
        default:
            replyHandler(nil, "unbekannt")
        }
    }

    /// Fragt nach und legt dann in den Papierkorb (nie endgültig löschen).
    func confirmTrash(_ u: URL) -> Bool {
        let al = NSAlert()
        al.messageText = "„\(u.lastPathComponent)“ in den Papierkorb legen?"
        al.informativeText = "Die Datei kann aus dem Papierkorb wiederhergestellt werden."
        al.alertStyle = .warning
        al.addButton(withTitle: "In den Papierkorb"); al.addButton(withTitle: "Abbrechen")
        guard al.runModal() == .alertFirstButtonReturn else { return false }
        return (try? fm.trashItem(at: u, resultingItemURL: nil)) != nil
    }

    /// Kontextmenü; gibt eine Aktion für die Oberfläche zurück (pin, rename, forget, trashed, removePlace, changeNotes) oder nil.
    func contextMenu(_ u: URL, kind: String, pinned: Bool) -> String? {
        var keep: [Act] = []
        var chosen: String?
        let menu = NSMenu()
        func item(_ t: String, _ f: @escaping () -> Void) {
            let a = Act(f); keep.append(a)
            let i = NSMenuItem(title: t, action: #selector(Act.run), keyEquivalent: ""); i.target = a; menu.addItem(i)
        }
        if kind == "file" {
            item(pinned ? "Aus Merkliste entfernen" : "Zur Merkliste") { chosen = "pin" }
            item("Umbenennen …") { chosen = "rename" }
            menu.addItem(.separator())
        }
        item("Im Finder zeigen") { NSWorkspace.shared.activateFileViewerSelecting([u]) }
        item("Pfad kopieren") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(u.path, forType: .string) }
        if kind == "file" {
            menu.addItem(.separator())
            for e in editors where installed(e.id) != nil { item("Öffnen mit \(e.name)") { open(u, with: e.id) } }
            item("Mit Standardprogramm öffnen") { NSWorkspace.shared.open(u) }
            menu.addItem(.separator())
            item("Aus „Zuletzt“ entfernen") { chosen = "forget" }
            item("In den Papierkorb legen …") { chosen = "trash" }
        } else {
            menu.addItem(.separator())
            if kind == "folder" {
                item("Als Ort merken") { chosen = "addPlace" }
                item("Als Ort für neue Notizen merken") { chosen = "addPlaceNotes" }
            } else {
                item(pinned ? "Nicht mehr für neue Notizen verwenden" : "Für neue Notizen verwenden") { chosen = pinned ? "unsetNotes" : "setNotes" }
                item("Aus Orte entfernen") { chosen = "removePlace" }
            }
        }
        menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
        withExtendedLifetime(keep) {}
        if chosen == "trash" { return confirmTrash(u) ? "trashed" : nil }
        return chosen
    }
}

// MARK: - WebView mit Drag-and-drop für Dateien und Ordner

final class DropWebView: WKWebView {
    var onDrop: (([String]) -> Void)?

    private func urls(_ i: NSDraggingInfo) -> [URL] {
        let all = i.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        return all.filter { isDirectory($0) || isMD($0) || ["png", "jpg", "jpeg", "gif", "webp", "svg"].contains($0.pathExtension.lowercased()) }
    }
    // Nur Dateien und Ordner von außen annehmen; alles andere (z. B. Umsortieren in der Seitenleiste) macht die Seite selbst
    override func draggingEntered(_ s: NSDraggingInfo) -> NSDragOperation { urls(s).isEmpty ? super.draggingEntered(s) : .copy }
    override func draggingUpdated(_ s: NSDraggingInfo) -> NSDragOperation { urls(s).isEmpty ? super.draggingUpdated(s) : .copy }
    override func prepareForDragOperation(_ s: NSDraggingInfo) -> Bool { urls(s).isEmpty ? super.prepareForDragOperation(s) : true }
    override func performDragOperation(_ s: NSDraggingInfo) -> Bool {
        let u = urls(s)
        if u.isEmpty { return super.performDragOperation(s) }
        onDrop?(u.map { $0.resolvingSymlinksInPath().path }); return true
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    let bridge = Bridge()
    var pending: [String] = []
    var loaded = false
    var titleObs: NSKeyValueObservation?
    var appearObs: NSKeyValueObservation?

    func applicationDidFinishLaunching(_ n: Notification) {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")
        let dw = DropWebView(frame: .zero, configuration: cfg)
        dw.onDrop = { [weak self] paths in self?.pending += paths; self?.deliver() }
        web = dw
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.contentView = web
        window.title = "MD Viewer"
        if !window.setFrameUsingName("main") { window.center() }
        window.setFrameAutosaveName("main")
        titleObs = web.observe(\.title) { [weak self] w, _ in
            if let t = w.title, !t.isEmpty { self?.window.title = t }
        }
        buildMenu()
        applyAppearance(defaults.string(forKey: "appearance") ?? "system")
        appearObs = NSApp.observe(\.effectiveAppearance) { _, _ in updateIcon() }
        let res = Bundle.main.resourceURL!.appendingPathComponent("web")
        web.loadFileURL(res.appendingPathComponent("index.html"), allowingReadAccessTo: res)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    func application(_ app: NSApplication, openFile filename: String) -> Bool {
        pending.append(fileURL(filename).path)
        if loaded { deliver() }
        return true
    }

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        loaded = true
        if pending.isEmpty { js("boot(null)") } else { deliver() }
    }

    func deliver() {
        let items = pending.map { ["path": $0, "dir": isDirectory(URL(fileURLWithPath: $0))] as [String: Any] }
        pending = []
        guard !items.isEmpty, let d = try? JSONSerialization.data(withJSONObject: items), let s = String(data: d, encoding: .utf8) else { return }
        js("boot(\(s))")
    }

    func js(_ code: String) { web.evaluateJavaScript(code, completionHandler: nil) }

    // Externe Links im Standardbrowser öffnen
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if a.navigationType == .linkActivated, let u = a.request.url, ["http", "https", "mailto"].contains(u.scheme ?? "") {
            NSWorkspace.shared.open(u); decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { NSWorkspace.shared.open(u) }
        return nil
    }

    // MARK: Menü

    @objc func runJS(_ s: NSMenuItem) { if let c = s.representedObject as? String { js(c) } }
    @objc func setTheme(_ s: NSMenuItem) {
        applyAppearance(s.representedObject as? String ?? "system"); js("syncTheme()")
    }
    @objc func zoom(_ s: NSMenuItem) {
        let d = s.representedObject as? Double ?? 0
        web.pageZoom = d == 0 ? 1 : max(0.5, min(3, web.pageZoom + d))
    }

    func buildMenu() {
        let main = NSMenu()
        func add(_ m: NSMenu, _ title: String, _ sel: Selector, _ key: String, _ rep: Any? = nil,
                 _ mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.representedObject = rep
            i.target = target ?? (sel == #selector(runJS(_:)) || sel == #selector(zoom(_:)) ? self : nil)
            m.addItem(i)
        }
        func submenu(_ title: String, _ build: (NSMenu) -> Void) {
            let item = NSMenuItem(); let m = NSMenu(title: title)
            build(m); item.submenu = m; main.addItem(item)
        }
        submenu("MD Viewer") { m in
            add(m, "Über MD Viewer", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), "")
            m.addItem(.separator())
            add(m, "MD Viewer beenden", #selector(NSApplication.terminate(_:)), "q")
        }
        submenu("Ablage") { m in
            add(m, "Öffnen …", #selector(runJS(_:)), "o", "openDialog()")
            add(m, "Neue Notiz", #selector(runJS(_:)), "n", "newNote()")
            m.addItem(.separator())
            add(m, "Bearbeiten / Lesen", #selector(runJS(_:)), "e", "toggleEdit()")
            add(m, "Speichern", #selector(runJS(_:)), "s", "saveNow()")
            add(m, "Neu laden", #selector(runJS(_:)), "r", "refreshAll(true)")
            m.addItem(.separator())
            add(m, "Zur Merkliste hinzufügen / entfernen", #selector(runJS(_:)), "d", "togglePinCurrent()")
            add(m, "Im Finder zeigen", #selector(runJS(_:)), "r", "revealCurrent()", [.command, .shift])
            add(m, "In Editor öffnen", #selector(runJS(_:)), "e", "editCurrent()", [.command, .shift])
            add(m, "Pfad kopieren", #selector(runJS(_:)), "c", "copyPathCurrent()", [.command, .option])
            m.addItem(.separator())
            add(m, "Tab schließen", #selector(runJS(_:)), "w", "closeTab()")
            add(m, "Fenster schließen", #selector(NSWindow.performClose(_:)), "w", nil, [.command, .shift])
        }
        submenu("Bearbeiten") { m in
            add(m, "Ausschneiden", #selector(NSText.cut(_:)), "x")
            add(m, "Kopieren", #selector(NSText.copy(_:)), "c")
            add(m, "Einsetzen", #selector(NSText.paste(_:)), "v")
            add(m, "Alles auswählen", #selector(NSText.selectAll(_:)), "a")
        }
        submenu("Ansicht") { m in
            add(m, "Seitenleiste ein/aus", #selector(runJS(_:)), "b", "toggleSide()", [.command, .option])
            add(m, "Schnellwechsler", #selector(runJS(_:)), "p", "palette()")
            add(m, "Fokusmodus", #selector(runJS(_:)), "f", "toggleFocus()", [.command, .shift])
            add(m, "Dateiliste filtern", #selector(runJS(_:)), "k", "focusSearch()")
            add(m, "Im Dokument suchen", #selector(runJS(_:)), "f", "findOpen()")
            add(m, "Nächster Treffer", #selector(runJS(_:)), "g", "findStep(1)")
            add(m, "Vorheriger Treffer", #selector(runJS(_:)), "g", "findStep(-1)", [.command, .shift])
            add(m, "Dateien", #selector(runJS(_:)), "1", "setTab('files')")
            add(m, "Gliederung", #selector(runJS(_:)), "2", "setTab('outline')")
            m.addItem(.separator())
            add(m, "Nächster Tab", #selector(runJS(_:)), "]", "cycleTab(1)", [.command, .shift])
            add(m, "Vorheriger Tab", #selector(runJS(_:)), "[", "cycleTab(-1)", [.command, .shift])
            m.addItem(.separator())
            add(m, "Zurück", #selector(runJS(_:)), "[", "go(-1)")
            add(m, "Vor", #selector(runJS(_:)), "]", "go(1)")
            m.addItem(.separator())
            add(m, "Vergrößern", #selector(zoom(_:)), "+", 0.1)
            add(m, "Verkleinern", #selector(zoom(_:)), "-", -0.1)
            add(m, "Originalgröße", #selector(zoom(_:)), "0", 0.0)
            m.addItem(.separator())
            let ti = NSMenuItem(title: "Darstellung", action: nil, keyEquivalent: ""); let tm = NSMenu(title: "Darstellung")
            for (t, k) in [("System", "system"), ("Hell", "light"), ("Dunkel", "dark")] {
                let i = NSMenuItem(title: t, action: #selector(setTheme(_:)), keyEquivalent: "")
                i.target = self; i.representedObject = k; tm.addItem(i); themeItems.append(i)
            }
            ti.submenu = tm; m.addItem(ti)
        }
        submenu("Fenster") { m in
            add(m, "Minimieren", #selector(NSWindow.performMiniaturize(_:)), "m")
        }
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
