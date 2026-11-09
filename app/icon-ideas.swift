import Cocoa

// Erzeugt ein Vorschaublatt mit drei Icon-Ideen. Aufruf: ./icon-ideas <ausgabe.png>

func col(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: a).cgColor
}

func tile(_ ctx: CGContext, top: UInt32, bottom: UInt32) {
    let shape = CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824), cornerWidth: 185, cornerHeight: 185, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 24, color: col(0x000000, 0.28))
    ctx.addPath(shape); ctx.setFillColor(col(top)); ctx.fillPath()
    ctx.restoreGState()
    ctx.saveGState(); ctx.addPath(shape); ctx.clip()
    let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [col(top), col(bottom)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(g, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
    ctx.restoreGState()
}

func bar(_ ctx: CGContext, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ c: CGColor) {
    ctx.addPath(CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: h / 2, cornerHeight: h / 2, transform: nil))
    ctx.setFillColor(c); ctx.fillPath()
}

// A: Seite mit Eselsohr, Überschrift und Textzeilen auf Nachtblau
func ideaA(_ ctx: CGContext) {
    tile(ctx, top: 0x2b3a5e, bottom: 0x18223c)
    let x0: CGFloat = 300, x1: CGFloat = 724, y0: CGFloat = 230, y1: CGFloat = 800, cut: CGFloat = 120
    let page = CGMutablePath()
    page.move(to: CGPoint(x: x0 + 40, y: y0)); page.addLine(to: CGPoint(x: x1 - 40, y: y0))
    page.addQuadCurve(to: CGPoint(x: x1, y: y0 + 40), control: CGPoint(x: x1, y: y0))
    page.addLine(to: CGPoint(x: x1, y: y1 - cut)); page.addLine(to: CGPoint(x: x1 - cut, y: y1))
    page.addLine(to: CGPoint(x: x0 + 40, y: y1))
    page.addQuadCurve(to: CGPoint(x: x0, y: y1 - 40), control: CGPoint(x: x0, y: y1))
    page.addLine(to: CGPoint(x: x0, y: y0 + 40))
    page.addQuadCurve(to: CGPoint(x: x0 + 40, y: y0), control: CGPoint(x: x0, y: y0))
    ctx.addPath(page); ctx.setFillColor(col(0xfaf6ec)); ctx.fillPath()
    let fold = CGMutablePath()
    fold.move(to: CGPoint(x: x1 - cut, y: y1)); fold.addLine(to: CGPoint(x: x1 - cut, y: y1 - cut + 30))
    fold.addQuadCurve(to: CGPoint(x: x1 - cut + 30, y: y1 - cut), control: CGPoint(x: x1 - cut, y: y1 - cut))
    fold.addLine(to: CGPoint(x: x1, y: y1 - cut)); fold.closeSubpath()
    ctx.addPath(fold); ctx.setFillColor(col(0xd9d2c0)); ctx.fillPath()
    bar(ctx, 360, 660, 230, 54, col(0xf2b84b))
    bar(ctx, 360, 560, 304, 30, col(0xbdb6a4))
    bar(ctx, 360, 490, 270, 30, col(0xbdb6a4))
    bar(ctx, 360, 420, 304, 30, col(0xbdb6a4))
    bar(ctx, 360, 350, 180, 30, col(0xbdb6a4))
}

// B: Raute (Überschrift in Markdown) auf Petrolgrün
func ideaB(_ ctx: CGContext) {
    tile(ctx, top: 0x14907f, bottom: 0x0b5b52)
    ctx.setStrokeColor(col(0xffffff)); ctx.setLineWidth(76); ctx.setLineCap(.round)
    ctx.beginPath()
    ctx.move(to: CGPoint(x: 424, y: 270)); ctx.addLine(to: CGPoint(x: 478, y: 754))
    ctx.move(to: CGPoint(x: 600, y: 270)); ctx.addLine(to: CGPoint(x: 654, y: 754))
    ctx.move(to: CGPoint(x: 294, y: 440)); ctx.addLine(to: CGPoint(x: 746, y: 440))
    ctx.move(to: CGPoint(x: 278, y: 600)); ctx.addLine(to: CGPoint(x: 730, y: 600))
    ctx.strokePath()
}

// C: Aufgeschlagenes Buch mit Lesezeichen auf Bernstein
func ideaC(_ ctx: CGContext) {
    tile(ctx, top: 0xf0b04a, bottom: 0xd98a1f)
    func page(_ s: CGFloat) {   // s = -1 links, 1 rechts
        let p = CGMutablePath()
        p.move(to: CGPoint(x: 512, y: 300))
        p.addQuadCurve(to: CGPoint(x: 512 + s * 270, y: 350), control: CGPoint(x: 512 + s * 130, y: 330))
        p.addLine(to: CGPoint(x: 512 + s * 270, y: 700))
        p.addQuadCurve(to: CGPoint(x: 512, y: 650), control: CGPoint(x: 512 + s * 130, y: 680))
        p.closeSubpath()
        ctx.addPath(p); ctx.setFillColor(col(0xfff9ec)); ctx.fillPath()
    }
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 16, color: col(0x6a3d00, 0.35))
    page(-1); page(1)
    ctx.restoreGState()
    ctx.setStrokeColor(col(0xd9c8a4)); ctx.setLineWidth(8)
    ctx.beginPath(); ctx.move(to: CGPoint(x: 512, y: 300)); ctx.addLine(to: CGPoint(x: 512, y: 650)); ctx.strokePath()
    for (i, w) in [170, 150, 170, 120].enumerated() {
        let y = 590 - CGFloat(i) * 62
        bar(ctx, 300, y, CGFloat(w), 26, col(0xd9b97a))
        bar(ctx, 556, y, CGFloat(w - 10), 26, col(0xd9b97a))
    }
    let rib = CGMutablePath()
    rib.move(to: CGPoint(x: 640, y: 690)); rib.addLine(to: CGPoint(x: 710, y: 690)); rib.addLine(to: CGPoint(x: 710, y: 470))
    rib.addLine(to: CGPoint(x: 675, y: 505)); rib.addLine(to: CGPoint(x: 640, y: 470)); rib.closeSubpath()
    ctx.addPath(rib); ctx.setFillColor(col(0x7b2d26)); ctx.fillPath()
}

let size = 512
let sheet = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size * 3 + 80, pixelsHigh: size + 40, bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let gc = NSGraphicsContext(bitmapImageRep: sheet)!
NSGraphicsContext.current = gc
let ctx = gc.cgContext
ctx.setFillColor(col(0xefefef)); ctx.fill(CGRect(x: 0, y: 0, width: size * 3 + 80, height: size + 40))
for (i, f) in [ideaA, ideaB, ideaC].enumerated() {
    ctx.saveGState()
    ctx.translateBy(x: 20 + CGFloat(i) * (CGFloat(size) + 20), y: 20)
    ctx.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    f(ctx)
    ctx.restoreGState()
}
try! sheet.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
