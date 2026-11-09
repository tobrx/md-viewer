import Cocoa

// App-Icon: ein durchgehender Strich, das M läuft im rechten Bein in den Pfeil nach unten.
// Aufruf: ./make-icon <ausgabe.iconset> <violett|dunkel|hell>
//         ./make-icon --sheet <vorschau.png>     (alle drei nebeneinander)

func col(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: a).cgColor
}

struct Variant { let tile: UInt32; let mark: UInt32; let rim: CGColor; let shadow: CGFloat }
let variants: [String: Variant] = [
    "violett": Variant(tile: 0x6d4fd0, mark: 0xffffff, rim: col(0xffffff, 0.20), shadow: 0.22),
    "dunkel":  Variant(tile: 0x1b1826, mark: 0xcdbcff, rim: col(0xffffff, 0.09), shadow: 0.35),
    "hell":    Variant(tile: 0xf7f4ee, mark: 0x6d4fd0, rim: col(0x000000, 0.10), shadow: 0.0),
]

func draw(_ ctx: CGContext, _ v: Variant) {
    let rect = CGRect(x: 100, y: 100, width: 824, height: 824)
    let shape = CGPath(roundedRect: rect, cornerWidth: 185, cornerHeight: 185, transform: nil)

    // Kachel mit weichem Schlagschatten, flach gefüllt
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 26, color: col(0x000000, 0.30))
    ctx.addPath(shape); ctx.setFillColor(col(v.tile)); ctx.fillPath()
    ctx.restoreGState()

    // feine Innenkante
    ctx.saveGState()
    ctx.addPath(shape); ctx.clip()
    ctx.addPath(shape); ctx.setStrokeColor(v.rim); ctx.setLineWidth(6); ctx.strokePath()
    ctx.restoreGState()

    // Zeichen: ein Strich, links hoch, Spitzen des M, rechtes Bein runter, Pfeilspitze
    let mark = CGMutablePath()
    mark.move(to: CGPoint(x: 250, y: 300)); mark.addLine(to: CGPoint(x: 250, y: 720))
    mark.addLine(to: CGPoint(x: 420, y: 520)); mark.addLine(to: CGPoint(x: 590, y: 720))
    mark.addLine(to: CGPoint(x: 590, y: 300))
    mark.move(to: CGPoint(x: 500, y: 392)); mark.addLine(to: CGPoint(x: 590, y: 300)); mark.addLine(to: CGPoint(x: 680, y: 392))

    ctx.saveGState()
    ctx.translateBy(x: 512, y: 512); ctx.scaleBy(x: 0.98, y: 0.98); ctx.translateBy(x: -465, y: -510)
    if v.shadow > 0 { ctx.setShadow(offset: CGSize(width: 0, height: -8), blur: 0, color: col(0x000000, v.shadow)) }
    ctx.addPath(mark)
    ctx.setStrokeColor(col(v.mark)); ctx.setLineWidth(64); ctx.setLineCap(.round); ctx.setLineJoin(.round)
    ctx.strokePath()
    ctx.restoreGState()
}

func bitmap(_ px: Int, _ w: Int? = nil) -> (NSBitmapImageRep, CGContext) {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w ?? px, pixelsHigh: px, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let gc = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = gc
    return (rep, gc.cgContext)
}

let args = CommandLine.arguments
if args[1] == "--sheet" {
    let (rep, ctx) = bitmap(552, 1640)
    ctx.setFillColor(col(0xe9e9ea)); ctx.fill(CGRect(x: 0, y: 0, width: 1640, height: 552))
    for (i, name) in ["violett", "dunkel", "hell"].enumerated() {
        ctx.saveGState()
        ctx.translateBy(x: 20 + CGFloat(i) * 540, y: 20); ctx.scaleBy(x: 0.5, y: 0.5)
        draw(ctx, variants[name]!)
        ctx.restoreGState()
    }
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
} else {
    let v = variants[args[2]]!
    try? FileManager.default.createDirectory(atPath: args[1], withIntermediateDirectories: true)
    for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128),
                       ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
        let (rep, ctx) = bitmap(px)
        ctx.scaleBy(x: CGFloat(px) / 1024, y: CGFloat(px) / 1024)
        draw(ctx, v)
        try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(args[1])/icon_\(name).png"))
    }
}
