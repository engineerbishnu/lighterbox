/**
 * LighterBox - Lightweight Lightbox Image Viewer
 * Zero-config lightbox with smooth transitions, hi-res loading, zoom & pan.
 * Add data-lighterbox to any image and include this script.
 */

// ─── Constants ─────────────────────────────────────────────────
const ZOOM = {
  MAX: 4,
  DOUBLE_CLICK_LEVEL: 2.5,
  WHEEL_STEP: 0.5,
  PINCH_SNAP_THRESHOLD: 1.1
};

const TOUCH = {
  TAP_MAX_DISTANCE: 15,
  TAP_MAX_TIME: 300,
  DOUBLE_TAP_MAX_DISTANCE: 30,
  SWIPE_MIN_DISTANCE: 50
};

const ANIM = {
  EXIT_DURATION: 300,
  ENTER_DURATION: 400,
  EXIT_EASING: 'ease-in',
  ENTER_EASING: 'cubic-bezier(0.0, 0, 0.2, 1)'
};

const _clickHandlers = new WeakMap();

class LighterBox extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.groups = new Map();
    this.activeGroup = null;
    this.activePhotos = [];
    this.currentIndex = 0;
    this.isOpen = false;

    // Zoom state
    this.zoom = { level: 1, panX: 0, panY: 0, isPanning: false,
      dragStartX: 0, dragStartY: 0, dragStartPanX: 0, dragStartPanY: 0 };

    // Touch state
    this.touch = { startX: 0, startY: 0, startTime: 0,
      lastTapTime: 0, lastTapX: 0, lastTapY: 0,
      pinchStartDist: 0, pinchStartZoom: 1, pinchCenterX: 0, pinchCenterY: 0,
      isPinching: false, moved: false };

    this._hiResLoader = null;
    this._navTimeout = null;
    this._navId = 0;
    this._imgLoadAC = null;

    // Mouse drag navigation state (at 1x zoom)
    this._navDrag = { active: false, startX: 0, startY: 0 };
    this._boundKeyHandler = this._handleKeydown.bind(this);
    this._boundMouseMove = this._handleMouseMove.bind(this);
    this._boundMouseUp = this._handleMouseUp.bind(this);
  }

  connectedCallback() {
    this.render();
    this.attachEventListeners();
    this.discoverImages();
  }

  disconnectedCallback() {
    this.destroy();
  }

  destroy() {
    // Close if open, restoring document state
    if (this.isOpen) {
      this.isOpen = false;
      this._isShowing = false;
      document.body.style.overflow = '';
    }

    // Cancel any pending loads
    this._cancelHiRes();
    if (this._imgLoadAC) { this._imgLoadAC.abort(); this._imgLoadAC = null; }

    // Remove click handlers from discovered elements
    this.groups.forEach(photos => {
      photos.forEach(photo => {
        if (photo.sourceEl) {
          const handler = _clickHandlers.get(photo.sourceEl);
          if (handler) {
            photo.sourceEl.removeEventListener('click', handler);
            _clickHandlers.delete(photo.sourceEl);
          }
        }
      });
    });
    this.groups.clear();

    // Detach global/shadowRoot event listeners
    this.detachEventListeners();
  }

  // ─── Convenience ──────────────────────────────────────────────

  _$(id) { return this.shadowRoot.getElementById(id); }

  // ─── DOM Discovery & Grouping ─────────────────────────────────

  discoverImages() {
    const elements = document.querySelectorAll('[data-lighterbox]');
    this.groups.clear();

    elements.forEach(el => {
      const groupName = el.getAttribute('data-lighterbox') || 'default';

      // Full-res src
      let src = el.getAttribute('data-lighterbox-src');
      if (!src) {
        if (el.tagName === 'A') src = el.href;
        else if (el.tagName === 'IMG') src = el.src;
        else { const img = el.querySelector('img'); src = img ? img.src : ''; }
      }

      // Thumbnail
      let thumbnail = el.getAttribute('data-lighterbox-thumbnail');
      if (!thumbnail) {
        if (el.tagName === 'IMG') thumbnail = el.src;
        else { const img = el.querySelector('img'); thumbnail = img ? img.src : src; }
      }

      // Caption
      let caption = el.getAttribute('data-lighterbox-caption');
      if (!caption) {
        if (el.tagName === 'IMG') caption = el.alt || el.title || '';
        else { const img = el.querySelector('img'); caption = img ? (img.alt || img.title || '') : (el.title || ''); }
      }

      if (!this.groups.has(groupName)) this.groups.set(groupName, []);

      const group = this.groups.get(groupName);
      const photoIndex = group.length;
      group.push({ src, thumbnail, caption, group: groupName, sourceEl: el });

      // Attach click handler (replace old one if re-discovering)
      const handler = (e) => { e.preventDefault(); this.open(groupName, photoIndex); };
      const prev = _clickHandlers.get(el);
      if (prev) el.removeEventListener('click', prev);
      _clickHandlers.set(el, handler);
      el.addEventListener('click', handler);
    });
  }

  refresh() { this.discoverImages(); }

  addImage({ src, thumbnail, caption, group }) {
    const groupName = group || 'default';
    if (!this.groups.has(groupName)) this.groups.set(groupName, []);
    this.groups.get(groupName).push({
      src, thumbnail: thumbnail || src, caption: caption || '', group: groupName, sourceEl: null
    });
  }

  // ─── Render ───────────────────────────────────────────────────

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --lb-primary: #2563eb;
          --lb-overlay: rgba(0, 0, 0, 0.95);
          --lb-text: #ffffff;
          --lb-text-dim: #94a3b8;
          --lb-border: #334155;
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── Overlay ─────────────────────────── */
        .lb-overlay {
          position: fixed;
          inset: 0;
          background: var(--lb-overlay);
          z-index: 10000;
          backdrop-filter: blur(10px);
          display: flex;
          flex-direction: column;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease;
        }
        .lb-overlay.active {
          opacity: 1;
          visibility: visible;
        }

        /* ── Top bar ─────────────────────────── */
        .lb-topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1.25rem;
          background: linear-gradient(to bottom, rgba(0,0,0,0.6), transparent);
          position: absolute;
          top: 0; left: 0; right: 0;
          z-index: 10;
          pointer-events: none;
        }
        .lb-topbar > * { pointer-events: auto; }

        .lb-counter {
          color: var(--lb-text-dim);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 0.875rem;
          min-width: 3rem;
        }

        .lb-actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .lb-btn {
          background: rgba(255,255,255,0.1);
          border: 1px solid var(--lb-border);
          color: var(--lb-text);
          padding: 0.4rem 0.75rem;
          border-radius: 0.375rem;
          cursor: pointer;
          font-size: 0.8rem;
          font-family: inherit;
          transition: background 0.2s;
        }
        .lb-btn:hover { background: rgba(255,255,255,0.25); }

        .lb-close {
          background: rgba(0,0,0,0.6);
          border: 1px solid var(--lb-border);
          color: var(--lb-text);
          width: 2.25rem; height: 2.25rem;
          border-radius: 50%;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.25rem;
          transition: background 0.2s;
          line-height: 1;
        }
        .lb-close:hover { background: rgba(255,255,255,0.2); }

        /* ── Stage ───────────────────────────── */
        .lb-stage {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          min-height: 0;
          user-select: none;
          -webkit-user-select: none;
        }

        /* ── Image wrapper (overflow clip for zoom) */
        .lb-image-wrap {
          position: relative;
          overflow: hidden;
          line-height: 0;
          border-radius: 0.375rem;
          transform: scale(0.92);
          transition: transform 0.35s ease-out;
        }
        .lb-overlay.active .lb-image-wrap {
          transform: scale(1);
        }

        /* ── Main image ──────────────────────── */
        .lb-image {
          display: block;
          max-width: 90vw;
          max-height: calc(100vh - 160px);
          object-fit: contain;
          -webkit-user-drag: none;
          transform-origin: center center;
        }
        /* Cursor states */
        .lb-image.draggable { cursor: grab; }
        .lb-image.dragging { cursor: grabbing; }
        .lb-image.zoomed { cursor: grab; }
        .lb-image.panning { cursor: grabbing; }

        /* ── Spinner ─────────────────────────── */
        .lb-spinner {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 36px; height: 36px;
          border: 3px solid var(--lb-border);
          border-top-color: var(--lb-primary);
          border-radius: 50%;
          animation: lb-spin 0.8s linear infinite;
          display: none;
          pointer-events: none;
        }
        .lb-spinner.active { display: block; }
        @keyframes lb-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }

        /* ── Error state ────────────────────────── */
        .lb-error {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          color: var(--lb-text-dim);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 0.875rem;
          text-align: center;
          display: none;
          pointer-events: none;
        }
        .lb-error.active { display: block; }

        /* ── Nav buttons ─────────────────────── */
        .lb-nav {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(0,0,0,0.6);
          border: 1px solid var(--lb-border);
          color: var(--lb-text);
          width: 3rem; height: 3rem;
          border-radius: 50%;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 1.25rem;
          transition: background 0.2s;
          z-index: 5;
        }
        .lb-nav:hover { background: rgba(0,0,0,0.85); }
        .lb-nav.prev { left: 1rem; }
        .lb-nav.next { right: 1rem; }
        .lb-nav.hidden, .lb-thumbs.hidden { display: none; }

        /* ── Caption ─────────────────────────── */
        .lb-caption {
          text-align: center;
          padding: 0.5rem 1rem;
          color: var(--lb-text-dim);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 0.875rem;
          background: linear-gradient(to top, rgba(0,0,0,0.4), transparent);
          min-height: 1.75rem;
        }

        /* ── Thumbnails ──────────────────────── */
        .lb-thumbs {
          display: flex;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          overflow-x: auto;
          overflow-y: hidden;
          background: rgba(0,0,0,0.7);
          border-top: 1px solid var(--lb-border);
          scrollbar-width: thin;
          scrollbar-color: var(--lb-border) transparent;
        }
        .lb-thumbs::-webkit-scrollbar { height: 4px; }
        .lb-thumbs::-webkit-scrollbar-track { background: transparent; }
        .lb-thumbs::-webkit-scrollbar-thumb { background: var(--lb-border); border-radius: 2px; }

        .lb-thumb {
          height: 60px; min-width: 60px;
          object-fit: cover;
          border-radius: 0.25rem;
          cursor: pointer;
          opacity: 0.5;
          transition: opacity 0.2s, border-color 0.2s;
          border: 2px solid transparent;
          flex-shrink: 0;
        }
        .lb-thumb:hover { opacity: 0.8; }
        .lb-thumb.active { opacity: 1; border-color: var(--lb-primary); }

        /* ── Responsive ──────────────────────── */
        @media (max-width: 768px) {
          .lb-topbar { padding: 0.5rem 0.75rem; }
          .lb-nav { width: 2.5rem; height: 2.5rem; font-size: 1rem; }
          .lb-nav.prev { left: 0.5rem; }
          .lb-nav.next { right: 0.5rem; }
          .lb-image { max-width: 100vw; max-height: calc(100vh - 140px); border-radius: 0; }
          .lb-image-wrap { border-radius: 0; }
          .lb-thumbs { padding: 0.5rem; }
          .lb-thumb { height: 48px; min-width: 48px; }
          .lb-btn { padding: 0.3rem 0.5rem; font-size: 0.75rem; }
        }
      </style>

      <div class="lb-overlay" id="overlay">
        <div class="lb-topbar">
          <span class="lb-counter" id="counter"></span>
          <div class="lb-actions">
            <button class="lb-btn" id="zoomBtn" title="Toggle zoom">&#8853; Zoom</button>
            <button class="lb-btn" id="downloadBtn" title="Download">&#8615; Download</button>
            <button class="lb-btn" id="fullscreenBtn" title="Fullscreen">&#x26F6; Fullscreen</button>
            <button class="lb-close" id="closeBtn" title="Close">&times;</button>
          </div>
        </div>

        <div class="lb-stage" id="stage">
          <button class="lb-nav prev" id="prevBtn">&#8249;</button>
          <div class="lb-image-wrap" id="imageWrap">
            <img class="lb-image" id="mainImage" alt="" draggable="false" />
            <div class="lb-spinner" id="spinner"></div>
            <div class="lb-error" id="error">&#x26A0; Image failed to load</div>
          </div>
          <button class="lb-nav next" id="nextBtn">&#8250;</button>
        </div>

        <div class="lb-caption" id="caption"></div>
        <div class="lb-thumbs" id="thumbs"></div>
      </div>
    `;
  }

  // ─── Event Listeners ──────────────────────────────────────────

  attachEventListeners() {
    this._$('closeBtn').addEventListener('click', () => this.close());
    this._$('prevBtn').addEventListener('click', () => this.navigate(-1));
    this._$('nextBtn').addEventListener('click', () => this.navigate(1));
    this._$('zoomBtn').addEventListener('click', () => this.toggleZoom());
    this._$('downloadBtn').addEventListener('click', () => this.download());
    this._$('fullscreenBtn').addEventListener('click', () => this.toggleFullscreen());

    // Backdrop click to close (only if clicking the stage itself)
    this._$('stage').addEventListener('click', (e) => {
      if (e.target === this._$('stage')) this.close();
    });

    // Zoom: wheel
    this._$('imageWrap').addEventListener('wheel', (e) => this._handleWheel(e), { passive: false });

    // Zoom: double-click
    this._$('mainImage').addEventListener('dblclick', (e) => this._handleDoubleClick(e));

    // Pan: mouse
    this._$('imageWrap').addEventListener('mousedown', (e) => this._handleMouseDown(e));
    this.shadowRoot.addEventListener('mousemove', this._boundMouseMove);
    this.shadowRoot.addEventListener('mouseup', this._boundMouseUp);

    // Touch: swipe, pinch-zoom, pan
    this._$('stage').addEventListener('touchstart', (e) => this._handleTouchStart(e), { passive: true });
    this._$('stage').addEventListener('touchmove', (e) => this._handleTouchMove(e), { passive: false });
    this._$('stage').addEventListener('touchend', (e) => this._handleTouchEnd(e), { passive: true });

    // Keyboard
    document.addEventListener('keydown', this._boundKeyHandler);
  }

  detachEventListeners() {
    document.removeEventListener('keydown', this._boundKeyHandler);
    this.shadowRoot.removeEventListener('mousemove', this._boundMouseMove);
    this.shadowRoot.removeEventListener('mouseup', this._boundMouseUp);
  }

  _handleKeydown(e) {
    if (!this.isOpen) return;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); this.navigate(-1); break;
      case 'ArrowRight': e.preventDefault(); this.navigate(1); break;
      case 'Escape': this.close(); break;
    }
  }

  // ─── Open / Close ─────────────────────────────────────────────

  open(group, index = 0) {
    const groupName = group || 'default';
    if (!this.groups.has(groupName)) return;

    this.activeGroup = groupName;
    this.activePhotos = this.groups.get(groupName);
    this.currentIndex = index;
    this.isOpen = true;

    this._$('overlay').classList.add('active');
    document.body.style.overflow = 'hidden';

    this.displayPhoto();
    this.renderThumbnails();
    this.preloadAdjacent();

    this.dispatchEvent(new CustomEvent('lighterbox:open', {
      detail: { group: groupName, index }
    }));
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this._isShowing = false;
    this.resetZoom(false);
    this._cancelHiRes();

    // Clear the stale image so it doesn't flash on next open
    const img = this._$('mainImage');
    img.style.opacity = '0';
    if (this._imgLoadAC) { this._imgLoadAC.abort(); this._imgLoadAC = null; }

    this._$('overlay').classList.remove('active');
    document.body.style.overflow = '';

    this.dispatchEvent(new CustomEvent('lighterbox:close'));
  }

  // ─── Navigation ───────────────────────────────────────────────

  navigate(direction) {
    if (!this.activePhotos.length) return;
    this.resetZoom(false);
    this._cancelHiRes();

    this.currentIndex += direction;
    if (this.currentIndex < 0) this.currentIndex = this.activePhotos.length - 1;
    if (this.currentIndex >= this.activePhotos.length) this.currentIndex = 0;

    this.displayPhoto();
    this.updateActiveThumbnail();
    this.preloadAdjacent();

    this.dispatchEvent(new CustomEvent('lighterbox:navigate', {
      detail: { group: this.activeGroup, index: this.currentIndex }
    }));
  }

  goTo(index) {
    if (index < 0 || index >= this.activePhotos.length) return;
    this.resetZoom(false);
    this._cancelHiRes();
    this.currentIndex = index;

    this.displayPhoto();
    this.updateActiveThumbnail();
    this.preloadAdjacent();

    this.dispatchEvent(new CustomEvent('lighterbox:navigate', {
      detail: { group: this.activeGroup, index: this.currentIndex }
    }));
  }

  // ─── Display ──────────────────────────────────────────────────

  async displayPhoto() {
    const photo = this.activePhotos[this.currentIndex];
    if (!photo) return;

    const navId = ++this._navId;
    const img = this._$('mainImage');
    const spinner = this._$('spinner');
    const wrap = this._$('imageWrap');

    // ── Exit: animate the current image out ──
    if (this._isShowing) {
      await wrap.animate([
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'translateY(-10px) scale(0.98)' }
      ], { duration: ANIM.EXIT_DURATION, easing: ANIM.EXIT_EASING }).finished;

      if (this._navId !== navId) return;   // superseded by another navigate
    }

    // ── Load: swap to new image ──
    this._isShowing = false;
    img.style.opacity = '0';
    spinner.classList.add('active');
    this._$('error').classList.remove('active');

    // Abort any prior load listeners before attaching new ones
    if (this._imgLoadAC) this._imgLoadAC.abort();
    this._imgLoadAC = new AbortController();
    const { signal } = this._imgLoadAC;

    const loaded = await new Promise(resolve => {
      img.addEventListener('load', () => resolve(true), { once: true, signal });
      img.addEventListener('error', () => resolve(false), { once: true, signal });
      img.src = photo.thumbnail;
    });

    if (this._navId !== navId) return;     // superseded
    spinner.classList.remove('active');
    if (!loaded) {
      this._$('error').classList.add('active');
      return;
    }

    // ── Enter: animate the new image in ──
    img.style.opacity = '1';
    this._isShowing = true;
    wrap.animate([
      { opacity: 0, transform: 'translateY(16px) scale(0.96)' },
      { opacity: 1, transform: 'scale(1)' }
    ], { duration: ANIM.ENTER_DURATION, easing: ANIM.ENTER_EASING });

    this._updateZoomCursor();
    if (photo.src !== photo.thumbnail) {
      this._loadHiRes(photo.src);
    }

    // Update UI
    this._$('counter').textContent = this.activePhotos.length > 1
      ? `${this.currentIndex + 1} / ${this.activePhotos.length}` : '';
    this._$('caption').textContent = photo.caption || '';

    const single = this.activePhotos.length <= 1;
    this._$('prevBtn').classList.toggle('hidden', single);
    this._$('nextBtn').classList.toggle('hidden', single);
    this._$('thumbs').classList.toggle('hidden', single);
  }

  _loadHiRes(src) {
    this._cancelHiRes();
    this._hiResLoader = new Image();
    this._hiResLoaderAC = new AbortController();
    this._hiResLoader.addEventListener('load', () => {
      const img = this._$('mainImage');
      const current = this.activePhotos[this.currentIndex];
      if (current && src === current.src) {
        img.src = src;
      }
      this._hiResLoader = null;
      this._hiResLoaderAC = null;
    }, { once: true, signal: this._hiResLoaderAC.signal });
    this._hiResLoader.src = src;
  }

  _cancelHiRes() {
    if (this._hiResLoaderAC) {
      this._hiResLoaderAC.abort();
      this._hiResLoaderAC = null;
    }
    this._hiResLoader = null;
  }

  // ─── Thumbnails ───────────────────────────────────────────────

  renderThumbnails() {
    const strip = this._$('thumbs');
    strip.innerHTML = '';

    this.activePhotos.forEach((p, i) => {
      const thumb = document.createElement('img');
      thumb.className = 'lb-thumb' + (i === this.currentIndex ? ' active' : '');
      thumb.src = p.thumbnail;
      thumb.alt = p.caption || '';
      thumb.dataset.index = i;
      thumb.addEventListener('click', () => this.goTo(i));
      strip.appendChild(thumb);
    });
  }

  updateActiveThumbnail() {
    this._$('thumbs').querySelectorAll('.lb-thumb').forEach((thumb, i) => {
      thumb.classList.toggle('active', i === this.currentIndex);
      if (i === this.currentIndex) {
        thumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });
  }

  // ─── Zoom & Pan ───────────────────────────────────────────────

  resetZoom(animate = true) {
    if (this.zoom.level === 1 && this.zoom.panX === 0 && this.zoom.panY === 0) return;
    const img = this._$('mainImage');
    const from = img.style.transform || 'scale(1)';
    this.zoom.level = 1;
    this.zoom.panX = 0;
    this.zoom.panY = 0;
    this.zoom.isPanning = false;
    this._applyTransform();
    if (animate) {
      img.animate([
        { transform: from },
        { transform: 'scale(1)' }
      ], { duration: 300, easing: 'ease' });
    }
    this._updateZoomCursor();
    this._updateZoomBtn();
  }

  /**
   * Zoom toward a specific point (in viewport coordinates).
   * Keeps the point under the cursor stationary during zoom.
   */
  setZoomAtPoint(newLevel, clientX, clientY, animate = false) {
    const wrap = this._$('imageWrap');
    const rect = wrap.getBoundingClientRect();

    // Cursor position relative to the wrapper's center (= transform-origin)
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;

    const oldLevel = this.zoom.level;
    newLevel = Math.max(1, Math.min(this._maxZoom(), newLevel));
    if (newLevel === oldLevel) return;

    const ratio = newLevel / oldLevel;
    this.zoom.panX = cx - (cx - this.zoom.panX) * ratio;
    this.zoom.panY = cy - (cy - this.zoom.panY) * ratio;
    this.zoom.level = newLevel;

    this._clampPan();

    const img = this._$('mainImage');
    const from = img.style.transform || 'scale(1)';
    this._applyTransform();
    if (animate) {
      img.animate([
        { transform: from },
        { transform: img.style.transform || 'scale(1)' }
      ], { duration: 300, easing: 'ease' });
    }
    this._updateZoomCursor();
    this._updateZoomBtn();
  }

  _maxZoom() { return ZOOM.MAX; }

  _clampPan() {
    const img = this._$('mainImage');
    if (!img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    const z = this.zoom.level;
    const maxX = Math.max(0, w * (z - 1) / 2);
    const maxY = Math.max(0, h * (z - 1) / 2);
    this.zoom.panX = Math.max(-maxX, Math.min(maxX, this.zoom.panX));
    this.zoom.panY = Math.max(-maxY, Math.min(maxY, this.zoom.panY));
  }

  _applyTransform() {
    const img = this._$('mainImage');
    if (!img) return;
    if (this.zoom.level <= 1) {
      img.style.transform = '';
    } else {
      img.style.transform = `translate(${this.zoom.panX}px, ${this.zoom.panY}px) scale(${this.zoom.level})`;
    }
  }

  _updateZoomCursor() {
    const img = this._$('mainImage');
    if (!img) return;
    const atBase = this.zoom.level <= 1;
    img.classList.toggle('draggable', atBase && !this._navDrag.active && this.activePhotos.length > 1);
    img.classList.toggle('dragging', atBase && this._navDrag.active);
    img.classList.toggle('zoomed', !atBase && !this.zoom.isPanning);
    img.classList.toggle('panning', !atBase && this.zoom.isPanning);
  }

  toggleZoom() {
    if (!this.isOpen) return;
    const img = this._$('mainImage');
    if (!img) return;
    if (this.zoom.level > 1) {
      this.resetZoom(true);
    } else {
      const rect = img.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      this.setZoomAtPoint(ZOOM.DOUBLE_CLICK_LEVEL, cx, cy, true);
    }
    this._updateZoomBtn();
  }

  _updateZoomBtn() {
    const btn = this._$('zoomBtn');
    if (!btn) return;
    if (this.zoom.level > 1) {
      btn.innerHTML = '&#8854; Reset';
      btn.title = 'Reset zoom';
    } else {
      btn.innerHTML = '&#8853; Zoom';
      btn.title = 'Toggle zoom';
    }
  }

  // ── Zoom: mouse wheel ──

  _handleWheel(e) {
    if (!this.isOpen) return;
    e.preventDefault();

    const delta = e.deltaY < 0 ? ZOOM.WHEEL_STEP : -ZOOM.WHEEL_STEP;
    const newLevel = this.zoom.level + delta;
    this.setZoomAtPoint(newLevel, e.clientX, e.clientY);
  }

  // ── Zoom: double-click ──

  _handleDoubleClick(e) {
    if (!this.isOpen) return;
    if (this.zoom.level > 1) {
      this.resetZoom(true);
    } else {
      this.setZoomAtPoint(ZOOM.DOUBLE_CLICK_LEVEL, e.clientX, e.clientY, true);
    }
  }

  // ── Pan: mouse drag ──

  _handleMouseDown(e) {
    if (!this.isOpen) return;
    e.preventDefault();

    if (this.zoom.level > 1) {
      // Zoomed: pan mode
      this.zoom.isPanning = true;
      this.zoom.dragStartX = e.clientX;
      this.zoom.dragStartY = e.clientY;
      this.zoom.dragStartPanX = this.zoom.panX;
      this.zoom.dragStartPanY = this.zoom.panY;
    } else if (this.activePhotos.length > 1) {
      // 1x zoom with multiple images: drag-to-navigate
      this._navDrag.active = true;
      this._navDrag.startX = e.clientX;
      this._navDrag.startY = e.clientY;
    }
    this._updateZoomCursor();
  }

  _handleMouseMove(e) {
    if (this.zoom.isPanning) {
      this.zoom.panX = this.zoom.dragStartPanX + (e.clientX - this.zoom.dragStartX);
      this.zoom.panY = this.zoom.dragStartPanY + (e.clientY - this.zoom.dragStartY);
      this._clampPan();
      this._applyTransform();
    } else if (this._navDrag.active) {
      this._updateZoomCursor();
    }
  }

  _handleMouseUp(e) {
    if (this.zoom.isPanning) {
      this.zoom.isPanning = false;
      this._updateZoomCursor();
    } else if (this._navDrag.active) {
      this._navDrag.active = false;
      const dx = e.clientX - this._navDrag.startX;
      if (Math.abs(dx) > TOUCH.SWIPE_MIN_DISTANCE) {
        this.navigate(dx < 0 ? 1 : -1);
      }
      this._updateZoomCursor();
    }
  }

  // ─── Touch Handling ───────────────────────────────────────────

  _touchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _handleTouchStart(e) {
    if (!this.isOpen) return;

    if (e.touches.length === 2) {
      // Pinch start
      this.touch.isPinching = true;
      this.touch.pinchStartDist = this._touchDistance(e.touches[0], e.touches[1]);
      this.touch.pinchStartZoom = this.zoom.level;
      this.touch.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      this.touch.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    } else if (e.touches.length === 1) {
      this.touch.startX = e.touches[0].clientX;
      this.touch.startY = e.touches[0].clientY;
      this.touch.startTime = Date.now();
      this.touch.moved = false;

      if (this.zoom.level > 1) {
        this.zoom.isPanning = true;
        this.zoom.dragStartX = e.touches[0].clientX;
        this.zoom.dragStartY = e.touches[0].clientY;
        this.zoom.dragStartPanX = this.zoom.panX;
        this.zoom.dragStartPanY = this.zoom.panY;
      }
    }
  }

  _handleTouchMove(e) {
    if (!this.isOpen) return;

    if (e.touches.length === 2 && this.touch.isPinching) {
      e.preventDefault();
      const dist = this._touchDistance(e.touches[0], e.touches[1]);
      const scale = dist / this.touch.pinchStartDist;
      const newZoom = Math.max(1, Math.min(this._maxZoom(), this.touch.pinchStartZoom * scale));

      // Zoom toward pinch center
      this.setZoomAtPoint(newZoom, this.touch.pinchCenterX, this.touch.pinchCenterY);
    } else if (e.touches.length === 1) {
      this.touch.moved = true;
      if (this.zoom.level > 1 && this.zoom.isPanning) {
        e.preventDefault();
        this.zoom.panX = this.zoom.dragStartPanX + (e.touches[0].clientX - this.zoom.dragStartX);
        this.zoom.panY = this.zoom.dragStartPanY + (e.touches[0].clientY - this.zoom.dragStartY);
        this._clampPan();
        this._applyTransform();
      }
    }
  }

  _handleTouchEnd(e) {
    if (!this.isOpen) return;

    if (this.touch.isPinching) {
      this.touch.isPinching = false;
      // Snap to 1x if close
      if (this.zoom.level < ZOOM.PINCH_SNAP_THRESHOLD) this.resetZoom(true);
      return;
    }

    this.zoom.isPanning = false;

    if (!e.changedTouches.length) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - this.touch.startX;
    const dy = endY - this.touch.startY;
    const elapsed = Date.now() - this.touch.startTime;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Double-tap detection
    if (dist < TOUCH.TAP_MAX_DISTANCE && elapsed < TOUCH.TAP_MAX_TIME) {
      const now = Date.now();
      if (now - this.touch.lastTapTime < TOUCH.TAP_MAX_TIME &&
          Math.abs(endX - this.touch.lastTapX) < TOUCH.DOUBLE_TAP_MAX_DISTANCE &&
          Math.abs(endY - this.touch.lastTapY) < TOUCH.DOUBLE_TAP_MAX_DISTANCE) {
        // Double-tap: toggle zoom
        this.touch.lastTapTime = 0;
        if (this.zoom.level > 1) {
          this.resetZoom(true);
        } else {
          this.setZoomAtPoint(ZOOM.DOUBLE_CLICK_LEVEL, endX, endY, true);
        }
        return;
      }
      this.touch.lastTapTime = now;
      this.touch.lastTapX = endX;
      this.touch.lastTapY = endY;
    }

    // Swipe to navigate (only when not zoomed)
    if (this.zoom.level <= 1 && Math.abs(dx) > TOUCH.SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
      this.navigate(dx < 0 ? 1 : -1);
    }
  }

  // ─── Utilities ────────────────────────────────────────────────

  preloadAdjacent() {
    const len = this.activePhotos.length;
    if (len <= 1) return;
    const prevIdx = (this.currentIndex - 1 + len) % len;
    const nextIdx = (this.currentIndex + 1) % len;
    [prevIdx, nextIdx].forEach(i => { const im = new Image(); im.src = this.activePhotos[i].src; });
  }

  download() {
    const photo = this.activePhotos[this.currentIndex];
    if (!photo) return;
    const a = document.createElement('a');
    a.href = photo.src;
    a.download = photo.caption || 'image';
    a.click();
    this.dispatchEvent(new CustomEvent('lighterbox:download', {
      detail: { group: this.activeGroup, index: this.currentIndex, src: photo.src }
    }));
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.shadowRoot.host.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }
}

// Register
customElements.define('lighter-box', LighterBox);

// Auto-instantiation
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelectorAll('[data-lighterbox]').length && !document.querySelector('lighter-box')) {
    document.body.appendChild(document.createElement('lighter-box'));
  }
});

// Module/CJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LighterBox;
}
