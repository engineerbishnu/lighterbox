# LighterBox

Zero-config lightbox with zoom, hi-res loading, and touch gestures. No dependencies.

[Demo](https://dkovach.github.io/lighterbox/lighterbox.html)

---

## Quick Setup

**1. Include the script**

```html
<script src="lighterbox.min.js"></script>
```

Or as an ES module:

```javascript
import LighterBox from 'lighterbox';
```

Or install via npm:

```bash
npm install lighterbox
```

**2. Add `data-lighterbox` to your images**

```html
<img src="photo.jpg" data-lighterbox alt="A photo">
```

That's it. Click the image and the lightbox opens.

---

## Features

- **Zero configuration** -- add one attribute and include the script
- **Image grouping** -- group images into galleries by attribute value
- **Hi-res loading** -- show the page thumbnail instantly, swap to a full-resolution version in the background
- **Zoom** -- toolbar button, mouse wheel, double-click, or pinch-to-zoom up to 4x
- **Pan** -- mouse drag or touch drag when zoomed
- **Drag to navigate** -- mouse drag left/right to switch images on desktop
- **Touch gestures** -- swipe to navigate, pinch to zoom, double-tap to toggle zoom
- **Smooth transitions** -- Web Animations API-driven fade and fly-in/out on navigate
- **Keyboard navigation** -- left/right arrows, Escape to close
- **Fullscreen** -- toggle native fullscreen mode
- **Download** -- download the current image
- **Thumbnail strip** -- navigable strip with active highlight and auto-scroll
- **Preloading** -- adjacent images are preloaded for instant navigation
- **Responsive** -- optimized layout and touch targets for mobile
- **ES module support** -- works as a `<script>` tag, ES module import, or CommonJS require
- **No dependencies** -- single file, no build step required

---

## Data Attributes

| Attribute | Required | Description |
|---|---|---|
| `data-lighterbox` | Yes | Marks the element as a lightbox trigger. The value is the group name. Empty or omitted value defaults to `"default"`. |
| `data-lighterbox-src` | No | Full-resolution image URL. Falls back to `href` on `<a>` elements or `src` on `<img>` elements. |
| `data-lighterbox-caption` | No | Caption text displayed below the image. Falls back to `alt`, then `title`. |
| `data-lighterbox-thumbnail` | No | Explicit thumbnail URL for the strip. Falls back to the displayed `src`. |

---

## Usage Examples

**Single image**

```html
<img src="photo.jpg" data-lighterbox="hero" alt="Hero image">
```

**Grouped gallery**

Images with the same `data-lighterbox` value form a navigable gallery.

```html
<img src="a-thumb.jpg" data-lighterbox="portfolio" data-lighterbox-src="a-full.jpg" alt="First">
<img src="b-thumb.jpg" data-lighterbox="portfolio" data-lighterbox-src="b-full.jpg" alt="Second">
<img src="c-thumb.jpg" data-lighterbox="portfolio" data-lighterbox-src="c-full.jpg" alt="Third">
```

**Link wrapping a thumbnail**

```html
<a href="full.jpg" data-lighterbox="gallery">
  <img src="thumb.jpg" alt="Preview">
</a>
```

**Custom caption**

```html
<img src="photo.jpg" data-lighterbox data-lighterbox-caption="Sunset over the Pacific">
```

---

## Programmatic API

```javascript
const lb = document.querySelector('lighter-box');

// Add images via JavaScript
lb.addImage({ src: 'full.jpg', thumbnail: 'thumb.jpg', caption: 'A photo', group: 'my-gallery' });

// Open a gallery at a specific index
lb.open('my-gallery', 0);

// Close the lightbox
lb.close();

// Navigate
lb.navigate(1);   // next
lb.navigate(-1);  // previous
lb.goTo(2);       // jump to index

// Re-scan the DOM after dynamic content changes
lb.refresh();

// Toggle zoom
lb.toggleZoom();

// Full teardown (removes all listeners and external handlers)
lb.destroy();
```

---

## Events

All events are standard `CustomEvent` instances dispatched on the `<lighter-box>` element.

| Event | Detail | Description |
|---|---|---|
| `lighterbox:open` | `{ group, index }` | Lightbox opened |
| `lighterbox:navigate` | `{ group, index }` | Navigated to a new image |
| `lighterbox:close` | -- | Lightbox closed |
| `lighterbox:download` | `{ group, index, src }` | Download triggered |

```javascript
lb.addEventListener('lighterbox:open', (e) => {
  console.log('Opened group:', e.detail.group, 'at index:', e.detail.index);
});
```

---

## Theming

Override CSS custom properties on the `<lighter-box>` element to match your site.

```css
lighter-box {
  --lb-primary: #e11d48;
  --lb-overlay: rgba(0, 0, 0, 0.9);
  --lb-text: #ffffff;
  --lb-text-dim: #a1a1aa;
  --lb-border: #3f3f46;
}
```

| Property | Default | Description |
|---|---|---|
| `--lb-primary` | `#2563eb` | Accent color (active thumbnail border) |
| `--lb-overlay` | `rgba(0, 0, 0, 0.95)` | Overlay background |
| `--lb-text` | `#ffffff` | Primary text and icon color |
| `--lb-text-dim` | `#94a3b8` | Secondary text (counter, captions) |
| `--lb-border` | `#334155` | Border color for buttons and dividers |

---

## Controls

| Input | Action |
|---|---|
| Click image on page | Open lightbox |
| Left / Right arrow | Navigate |
| Escape | Close |
| Click backdrop | Close |
| Mouse drag left / right | Navigate (desktop) |
| Scroll wheel (on image) | Zoom in / out |
| Zoom button | Toggle zoom |
| Double-click (on image) | Toggle zoom |
| Mouse drag (when zoomed) | Pan |
| Swipe left / right | Navigate (touch) |
| Pinch | Zoom (touch) |
| Double-tap | Toggle zoom (touch) |

---

## Browser Support

All modern browsers (Chrome, Firefox, Safari, Edge). Requires support for Custom Elements v1 and Shadow DOM.

---

## License

MIT
