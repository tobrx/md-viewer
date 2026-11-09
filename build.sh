#!/bin/zsh
# Baut build/MD Viewer.app (nur Swift Command Line Tools nötig, kein Xcode)
set -e
cd "$(dirname "$0")"
APP="build/MD Viewer.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 app/main.swift -o "$APP/Contents/MacOS/MDViewer" \
  -framework Cocoa -framework WebKit
cp app/Info.plist "$APP/Contents/Info.plist"
cp app/AppIcon.icns app/AppIcon-dunkel.icns app/AppIcon-hell.icns "$APP/Contents/Resources/"
cp -R web "$APP/Contents/Resources/web"
codesign --force --sign - "$APP" 2>/dev/null || true
echo "Fertig: $APP"
