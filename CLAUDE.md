# LighterBox - Project Guide

## Overview

Zero-config lightbox web component with zoom, hi-res loading, and touch gestures. No runtime dependencies. Built as a Custom Element (`<lighter-box>`). Supports both ES modules and CommonJS.

## Project Structure

- `lighterbox.js` - Main source (single-file web component)
- `lighterbox.min.js` - Minified build output
- `lighterbox.html` - Demo page (loads `lighterbox.js` directly)
- `package.json` - Package config with dual ESM/CJS exports

## Build

```bash
npm install     # Required first time (terser from zip may be broken)
npm run build   # Minify lighterbox.js -> lighterbox.min.js via terser
```

## Architecture

- Custom Elements v1 + Shadow DOM
- Web Animations API for all transitions (no CSS class toggling)
- `AbortController` pattern for image load/error listener cleanup
- `WeakMap` for storing click handlers on discovered elements
- `_navId` counter guards async `displayPhoto()` against rapid navigation races
- Named constants (`ZOOM`, `TOUCH`, `ANIM`) for all thresholds/timings

## Public API

- `open(group, index)`, `close()`, `navigate(direction)`, `goTo(index)`
- `addImage({ src, thumbnail, caption, group })`, `refresh()`
- `toggleZoom()`, `toggleFullscreen()`, `download()`
- `destroy()` — full teardown (listeners, handlers, document state)
- Events: `lighterbox:open`, `lighterbox:navigate`, `lighterbox:close`, `lighterbox:download`
- Themeable via CSS custom properties (`--lb-primary`, `--lb-overlay`, `--lb-text`, etc.)

## Controls

- **Desktop:** arrow keys, mouse drag to navigate, scroll wheel to zoom, double-click to toggle zoom, zoom button in toolbar
- **Touch:** swipe to navigate, pinch to zoom, double-tap to toggle zoom
- **Toolbar:** Zoom toggle, Download, Fullscreen, Close

## Testing

No test suite currently configured.
