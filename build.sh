#!/bin/zsh
# Baut build/MD Viewer.app (nur Swift Command Line Tools nötig, kein Xcode)
set -e
cd "$(dirname "$0")"
APP="build/MD Viewer.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# Universal-Binary (Apple Silicon + Intel), läuft ab macOS 13
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos13.0" app/main.swift -o "build/MDViewer-$arch" \
    -framework Cocoa -framework WebKit
done
lipo -create build/MDViewer-arm64 build/MDViewer-x86_64 -output "$APP/Contents/MacOS/MDViewer"
rm -f build/MDViewer-arm64 build/MDViewer-x86_64
cp app/Info.plist "$APP/Contents/Info.plist"
cp app/AppIcon.icns app/AppIcon-dunkel.icns app/AppIcon-hell.icns "$APP/Contents/Resources/"
cp -R web "$APP/Contents/Resources/web"
codesign --force --sign - "$APP" 2>/dev/null || true
ditto -c -k --keepParent "$APP" build/MD-Viewer.zip
echo "Fertig: $APP und build/MD-Viewer.zip"
