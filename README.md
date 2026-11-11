# Folio — a PDF reader for Windows

Folio is a desktop PDF reader built with Electron and Mozilla's PDF.js. "Folio" is a placeholder name; change `productName` in `package.json` (and the `<title>` in `src/renderer/index.html`) when you pick a real one.

## What it does (stage 1)

Opens PDFs from the Open button, drag and drop, or by double-clicking a PDF in Windows once it's installed. Each PDF opens in its own tab, and each tab remembers its page, zoom and rotation. You get a page-thumbnail sidebar, a Contents panel for PDFs with bookmarks, text search with highlighting, selectable and copyable text, clickable links (web links open in your browser), fill-in forms, zoom presets, rotation, a two-page view, password-protected PDFs, light and dark themes, and a "dim pages" mode for reading at night.

## Run it

1. Install **Node.js LTS** from https://nodejs.org (accept the defaults).
2. Open a terminal (PowerShell) in this folder.
3. Run `npm install` (first time only, takes a minute).
4. Run `npm start`.

## Build the Windows installer

Run `npm run dist`. When it finishes, the installer is in `dist\Folio Setup 0.1.0.exe`. Run it to install Folio like any other program; it adds Start menu and desktop shortcuts and registers itself as a PDF app.

Windows SmartScreen will warn you the first time because the installer isn't code-signed. Click **More info → Run anyway**. (Signing needs a paid certificate; only worth it if you distribute the app.)

To make Folio your default PDF app: **Settings → Apps → Default apps**, search for `.pdf`, and choose Folio. Or right-click any PDF → **Open with → Choose another app → Folio → Always**.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Open a PDF | Ctrl+O |
| Close tab | Ctrl+W (or middle-click the tab) |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Find | Ctrl+F, then Enter / Shift+Enter (or F3 / Shift+F3) |
| Zoom in / out | Ctrl+= / Ctrl+−, or Ctrl + mouse wheel |
| Fit page / actual size / fit width | Ctrl+0 / Ctrl+1 / Ctrl+2 |
| Rotate clockwise | Ctrl+R |
| Previous / next page | ← / → (when the page fits the width), Page Up / Page Down |
| Show or hide sidebar | F4 |
| Full screen | F11 |
| Developer tools | F12 |

## Project layout

```
package.json            app info, dependencies, installer settings
build/icon.ico          app and installer icon
src/main.js             main process: window, file reading, single instance
src/preload.js          safe bridge between the window and main process
src/renderer/index.html the window's layout
src/renderer/styles.css look and feel, light and dark themes
src/renderer/renderer.js viewer logic (PDF.js, tabs, thumbnails, search, zoom)
```

## Troubleshooting

If the window opens but stays blank, press F12 and check the Console tab for errors. The most common cause is a missing `node_modules` folder; run `npm install` again.

If the installed app is blank but `npm start` works, add `"asar": false` inside the `"build"` section of `package.json` and rebuild.

## Coming next

Stage 2: printing, recent files, and remembering window size.
Stage 3: highlights, notes, drawing and text boxes, saved into the PDF with pdf-lib (each tab already keeps the original file bytes in `tab.bytes` for this).
Stage 4: page tools (reorder, delete, rotate and save, merge, split), saving filled-in forms, and signatures.
