// 畫面的底層：建 DOM、比對更新（保留畫布、焦點、捲動位置）、圖示、全螢幕／表單／泡泡、念出聲
(function () {
  'use strict';
  const SW = window.SW;

  // MARK: - 顏色（Support.swift 的 Theme）

  const Theme = {
    cream: 'rgb(255,248,231)',
    star: 'rgb(255,201,60)',
    starDeep: 'rgb(245,166,36)',
    ink: 'rgb(74,63,53)',
    soft: 'rgba(74,63,53,0.55)',
    paper: '#fff',
    line: 'rgb(158,199,242)',
    peach: 'rgb(255,214,201)',
    mint: 'rgb(204,240,224)',
    sky: 'rgb(207,230,255)',
    lilac: 'rgb(230,219,255)',
    good: 'rgb(92,184,120)',
    bad: 'rgb(237,115,107)',
    a(name, alpha) {
      const m = Theme[name].match(/rgba?\(([^)]+)\)/);
      if (!m) return name === 'paper' ? `rgba(255,255,255,${alpha})` : Theme[name];
      const p = m[1].split(',').map(s => s.trim());
      const base = p.length === 4 ? parseFloat(p[3]) : 1;
      return `rgba(${p[0]},${p[1]},${p[2]},${base * alpha})`;
    },
    white: a => `rgba(255,255,255,${a})`,
  };
  SW.Theme = Theme;

  const FONT = 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "PingFang TC", "Noto Sans TC", system-ui, -apple-system, sans-serif';
  SW.FONT = FONT;

  // MARK: - 建元素

  const HANDLERS = ['onclick', 'oninput', 'onchange', 'onkeydown', 'onpointerdown', 'onsubmit', 'onfocus', 'onblur', 'oncontextmenu'];

  function h(tag, props, ...children) {
    const svg = tag.startsWith('svg:');
    const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'key') el.setAttribute('data-key', v);
        else if (k === 'style') {
          if (typeof v === 'string') el.setAttribute('style', v);
          else el.setAttribute('style', styleString(v));
        } else if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
        else if (HANDLERS.includes(k)) { el[k] = v; (el._h = el._h || {})[k] = v; }
        else if (k === 'mount') el._mount = v;
        else if (k === 'unmount') el._unmount = v;
        else if (k === 'persist') el.setAttribute('data-persist', '1');
        else if (k === 'enter') el.setAttribute('data-enter', v);
        else if (k === 'leave') el.setAttribute('data-leave', v);
        else if (k === 'value') { el.value = v; el._value = v; }
        else if (k === 'checked') { el.checked = v; }
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children) {
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) append(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
  }

  const UNITLESS = new Set(['opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight', 'order', 'WebkitLineClamp']);
  function styleString(o) {
    return Object.entries(o).filter(([, v]) => v != null && v !== false)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v}`)
      .join(';');
  }

  // MARK: - 比對更新

  const keyOf = n => n.nodeType === 1 ? n.getAttribute('data-key') : null;

  function sameKind(a, b) {
    return a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);
  }

  function morph(old, nu) {
    if (old.nodeType === 3) {
      if (old.nodeValue !== nu.nodeValue) old.nodeValue = nu.nodeValue;
      return;
    }
    if (old.hasAttribute && old.hasAttribute('data-persist')) return;
    // 屬性
    for (const a of Array.from(old.attributes)) if (!nu.hasAttribute(a.name)) old.removeAttribute(a.name);
    for (const a of Array.from(nu.attributes)) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
    // 事件
    const oh = old._h || {}, nh = nu._h || {};
    for (const k of HANDLERS) {
      if (oh[k] && !nh[k]) old[k] = null;
      if (nh[k]) old[k] = nh[k];
    }
    old._h = nh;
    if (nu._unmount) old._unmount = nu._unmount;
    if ('_value' in nu && old.value !== nu._value) old.value = nu._value;
    if (old.tagName === 'INPUT' && (old.type === 'checkbox')) old.checked = nu.checked;
    morphChildren(old, nu);
  }

  function morphChildren(parent, nuParent) {
    const nuKids = Array.from(nuParent.childNodes);
    const oldKids = Array.from(parent.childNodes).filter(n => !n._leaving);
    const keyed = new Map();
    for (const o of oldKids) { const k = keyOf(o); if (k != null) keyed.set(k, o); }
    const used = new Set();
    const fresh = new Set();
    let cursor = 0;
    const result = [];
    for (const n of nuKids) {
      const k = keyOf(n);
      let match = null;
      if (k != null) {
        const o = keyed.get(k);
        if (o && !used.has(o) && sameKind(o, n)) match = o;
      } else {
        for (let i = cursor; i < oldKids.length; i++) {
          const o = oldKids[i];
          if (used.has(o) || keyOf(o) != null) continue;
          if (sameKind(o, n)) { match = o; cursor = i + 1; }
          break;
        }
      }
      if (match) {
        used.add(match);
        morph(match, n);
        result.push(match);
      } else {
        result.push(n);
        fresh.add(n);
      }
    }
    // 拿掉不要的（有離場動畫的留著播完）
    for (const o of oldKids) if (!used.has(o)) remove(o);
    // 照順序放好
    let ref = parent.firstChild;
    for (const n of result) {
      while (ref && ref._leaving) ref = ref.nextSibling;
      if (n !== ref) {
        parent.insertBefore(n, ref);
        if (fresh.has(n)) mounted(n);
      } else ref = ref.nextSibling;
    }
  }

  function mounted(n) {
    if (n.nodeType !== 1) return;
    const enter = n.getAttribute('data-enter');
    if (enter) {
      n.classList.add('enter-' + enter);
      n.addEventListener('animationend', () => n.classList.remove('enter-' + enter), { once: true });
    }
    if (n._mount) { const f = n._mount; n._mount = null; f(n); }
    for (const c of Array.from(n.children)) mounted(c);
  }

  function unmounted(n) {
    if (n.nodeType !== 1) return;
    if (n._unmount) { const f = n._unmount; n._unmount = null; f(n); }
    for (const c of Array.from(n.children)) unmounted(c);
  }

  function remove(o) {
    const leave = o.nodeType === 1 && o.getAttribute('data-leave');
    if (!leave) { unmounted(o); o.remove(); return; }
    // 離場：釘在原位置，播完動畫再拿掉
    const p = o.parentNode;
    const r = o.getBoundingClientRect(), pr = p.getBoundingClientRect();
    o._leaving = true;
    o.style.position = 'absolute';
    o.style.left = (r.left - pr.left + p.scrollLeft) + 'px';
    o.style.top = (r.top - pr.top + p.scrollTop) + 'px';
    o.style.width = r.width + 'px';
    o.style.height = r.height + 'px';
    o.style.margin = '0';
    o.style.pointerEvents = 'none';
    o.classList.add('leave-' + leave);
    unmounted(o);
    let done = false;
    const finish = () => { if (!done) { done = true; o.remove(); } };
    o.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 900);
  }

  /// 把 container 的內容換成 tree（一個元素或一串）
  function patch(container, tree) {
    const holder = document.createElement(container.nodeName);
    append(holder, [tree]);
    // 記住焦點、捲動位置
    const active = document.activeElement;
    const activeKey = active && container.contains(active) ? active.getAttribute('data-key') : null;
    const sel = activeKey && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const scrolls = new Map();
    container.querySelectorAll('[data-scroll]').forEach(e => scrolls.set(e.getAttribute('data-scroll'), e.scrollTop));
    morphChildren(container, holder);
    container.querySelectorAll('[data-scroll]').forEach(e => {
      const k = e.getAttribute('data-scroll');
      if (scrolls.has(k) && e.scrollTop !== scrolls.get(k)) e.scrollTop = scrolls.get(k);
    });
    if (activeKey && document.activeElement !== active) {
      const again = container.querySelector(`[data-key="${CSS.escape(activeKey)}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        if (sel) try { again.setSelectionRange(sel[0], sel[1]); } catch (e) { /* 有的欄位不能選 */ }
      }
    }
  }

  // MARK: - 元件

  class Component {
    constructor() {
      this.el = document.createElement('div');
      this.el.className = 'screen';
      this._queued = false;
      this.dead = false;
      this.timers = new Set();
    }
    render() { return null; }
    update() {
      if (this._queued || this.dead) return;
      this._queued = true;
      queueMicrotask(() => { this._queued = false; this.updateNow(); });
    }
    updateNow() {
      if (this.dead) return;
      patch(this.el, this.render());
      if (this.didRender) this.didRender();
    }
    /// 跟 Task.sleep 一樣：畫面關掉就不再跑
    after(ms, fn) {
      const t = setTimeout(() => { this.timers.delete(t); if (!this.dead) fn(); }, ms);
      this.timers.add(t);
      return t;
    }
    sleep(ms) { return new Promise(res => this.after(ms, res)); }
    destroy() {
      this.dead = true;
      for (const t of this.timers) clearTimeout(t);
      unmounted(this.el);
      if (this.onDestroy) this.onDestroy();
    }
  }
  SW.Component = Component;
  SW.h = h;
  SW.patch = patch;

  /// 量大小：元素放上畫面、大小變了就叫 cb
  function measure(key, cb) {
    return el => {
      let last = '';
      const ro = new ResizeObserver(() => {
        const r = el.getBoundingClientRect();
        const sig = Math.round(r.width) + 'x' + Math.round(r.height);
        if (sig !== last) { last = sig; cb(r.width, r.height); }
      });
      ro.observe(el);
      el._ro = ro;
    };
  }
  SW.measure = measure;

  // MARK: - 圖示（SF Symbols 在網頁上沒有，照樣子畫）

  function softStarPath(size, inner = 0.5, outerR = 0.16, innerR = 0.07, offset = 0.04) {
    const cx = size / 2, cy = size / 2 + size * offset;
    const R = size / 2, r = R * inner;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rad = i % 2 === 0 ? R : r;
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    // 跟 Path.addArc(tangent1End:tangent2End:radius:) 一樣的圓角
    let d = '';
    const start = [(pts[9][0] + pts[0][0]) / 2, (pts[9][1] + pts[0][1]) / 2];
    d += `M${start[0].toFixed(2)} ${start[1].toFixed(2)}`;
    for (let i = 0; i < 10; i++) {
      const prev = i === 0 ? start : pts[i - 1];
      const p = pts[i], next = pts[(i + 1) % 10];
      const corner = i % 2 === 0 ? R * outerR : R * innerR;
      const v1 = [prev[0] - p[0], prev[1] - p[1]], v2 = [next[0] - p[0], next[1] - p[1]];
      const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
      const u1 = [v1[0] / l1, v1[1] / l1], u2 = [v2[0] / l2, v2[1] / l2];
      const ang = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
      const t = corner / Math.tan(ang / 2);
      const a1 = [p[0] + u1[0] * t, p[1] + u1[1] * t], a2 = [p[0] + u2[0] * t, p[1] + u2[1] * t];
      const cross = u1[0] * u2[1] - u1[1] * u2[0];
      d += `L${a1[0].toFixed(2)} ${a1[1].toFixed(2)}A${corner.toFixed(2)} ${corner.toFixed(2)} 0 0 ${cross > 0 ? 0 : 1} ${a2[0].toFixed(2)} ${a2[1].toFixed(2)}`;
    }
    return d + 'Z';
  }
  SW.softStarPath = softStarPath;

  const STAR = softStarPath(24, 0.47, 0.09, 0.05, 0.03);
  const P = {
    'star.fill': `<path d="${STAR}"/>`,
    'star': `<path d="${STAR}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" transform="translate(2.4 2.4) scale(.8)"/>`,
    'xmark': '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" fill="none"/>',
    'xmark.circle.fill': '<circle cx="12" cy="12" r="10"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>',
    'checkmark': '<path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'checkmark.circle.fill': '<circle cx="12" cy="12" r="10"/><path d="M7.5 12.3l3 3 6-6.3" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'checkmark.circle': '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 12.3l3 3 6-6.3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'circle': '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    'questionmark': '<path d="M8.5 8.5a3.5 3.5 0 1 1 5.2 3.1c-1.1.6-1.7 1.3-1.7 2.6v.6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="12" cy="19" r="1.6"/>',
    'arrow.right': '<path d="M4 12h15M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'arrow.counterclockwise': '<path d="M5.5 9.5A7 7 0 1 1 5 14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/><path d="M4 4.5v5.5h5.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'chevron.right': '<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'chevron.left': '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'plus': '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/>',
    'plus.circle.fill': '<circle cx="12" cy="12" r="10.5"/><path d="M12 7v10M7 12h10" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
    'speaker.wave.2.fill': '<path d="M3 9.5h3.5L11 5.5v13l-4.5-4H3z"/><path d="M14.5 9a4 4 0 0 1 0 6M17 6.5a7.5 7.5 0 0 1 0 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    'tortoise.fill': '<path d="M3 15c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5z"/><circle cx="20.3" cy="12.3" r="2.2"/><path d="M5.5 15.5l-1 3h2.5l1-3M14.5 15.5l1 3H18l-1-3" /><path d="M11 9v5.5M7.5 10.5l1.5 4M14.5 10.5l-1.5 4" stroke="rgba(255,255,255,.55)" stroke-width="1.1" fill="none"/>',
    'ear.fill': '<path d="M12.5 2.5c-4.1 0-7 3-7 6.8 0 1.6.4 2.6 1.2 3.7.7 1 1.3 1.9 1.3 3.5 0 3 1.9 5 4.4 5 2 0 3.4-1.1 3.9-3 .3-1.3 1-2 2-3 1.2-1.3 2.2-2.7 2.2-5.4 0-4.6-3.2-7.6-8-7.6z"/><path d="M10 9.3a3 3 0 0 1 6 .2c0 1.6-1.4 2.3-2 3.3" stroke="rgba(255,255,255,.6)" stroke-width="1.6" stroke-linecap="round" fill="none"/>',
    'character.book.closed.fill': '<path d="M6.5 2.5h12a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H7a1.5 1.5 0 0 0 0 3h12.5v-1.3" /><path d="M5 4.5A2 2 0 0 1 7 2.5v18A2 2 0 0 0 5 22.5z"/><path d="M10.5 15l2.5-8 2.5 8M11.5 12.5h3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'character.book.closed': '<path d="M7 2.5h12v17H7a2 2 0 0 0-2 2V4.5a2 2 0 0 1 2-2zM5 21.5a2 2 0 0 0 2 1h12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M10.2 15l2.3-7.5 2.3 7.5M11.1 12.6h2.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>',
    'square.grid.2x2.fill': '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
    'pencil.and.scribble': '<path d="M15.5 3.5l3 3L9 16l-4 1 1-4z"/><path d="M3 21c2-1.5 3.5-1.6 5-.6 1.3.9 2.6.9 4-.3 1.4-1.2 3-1.4 5-.1 1 .6 2 .7 4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
    'text.word.spacing': '<rect x="2" y="7" width="7" height="10" rx="2"/><rect x="15" y="7" width="7" height="10" rx="2"/><path d="M10.5 12h3M11.5 10.5L10 12l1.5 1.5M12.5 10.5L14 12l-1.5 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'text.line.first.and.arrowtriangle.forward': '<path d="M3 6.5l5 3-5 3z"/><path d="M11 9.5h10M3 15.5h18M3 20h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    'headphones': '<path d="M4 15v-3a8 8 0 0 1 16 0v3" stroke="currentColor" stroke-width="2.2" fill="none"/><rect x="3" y="13.5" width="5" height="8" rx="2"/><rect x="16" y="13.5" width="5" height="8" rx="2"/>',
    'checklist': '<path d="M3 6l1.8 1.8L8 4.5M3 12.5l1.8 1.8L8 11M3 19l1.8 1.8L8 17.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M11 6.5h10M11 13h10M11 19.5h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    'ear.and.waveform': '<path d="M9.5 3c-3.3 0-5.7 2.4-5.7 5.5 0 1.3.3 2.1 1 3 .6.8 1 1.6 1 2.9 0 2.4 1.6 4.1 3.6 4.1 1.6 0 2.8-.9 3.2-2.4.2-1 .8-1.6 1.6-2.5 1-1 1.8-2.2 1.8-4.4C16 5.4 13.4 3 9.5 3z"/><path d="M18.5 7v10M21.5 9.5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    'person.2.wave.2.fill': '<circle cx="8.5" cy="8" r="3.3"/><path d="M2.5 19.5c0-3.4 2.7-5.7 6-5.7s6 2.3 6 5.7z"/><circle cx="16" cy="9" r="2.6"/><path d="M15.5 13.6c3.3 0 5.6 2.1 5.6 5.4h-5c0-2-.5-3.6-1.7-4.9z"/><path d="M19.5 3.5a5 5 0 0 1 1.5 3.6M3.5 3.5A5 5 0 0 0 2 7.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>',
    'text.badge.checkmark': '<path d="M3 6h10M3 11h8M3 16h7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/><circle cx="17.5" cy="15.5" r="5"/><path d="M15.3 15.6l1.6 1.6 2.9-3" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'books.vertical.fill': '<rect x="3" y="3" width="5" height="18" rx="1.3"/><rect x="9.5" y="5" width="4.5" height="16" rx="1.3"/><path d="M15.4 6.2l3.8-1 3 15.4-3.8 1z"/>',
    'doc.richtext.fill': '<path d="M5 2.5h9l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 20V4a1.5 1.5 0 0 1 1-1.5z"/><path d="M7 17l3-3.5 2 2 2.5-3L17 17z" fill="#fff"/><circle cx="9" cy="10" r="1.4" fill="#fff"/>',
    'book.fill': '<path d="M12 6c-2-1.6-5-2-9-1.6V19c4-.4 7 0 9 1.5z"/><path d="M12 6c2-1.6 5-2 9-1.6V19c-4-.4-7 0-9 1.5z"/>',
    'eraser.fill': '<path d="M14 3.5l6.5 6.5-8.5 8.5H7.5L3.5 14.5z"/><path d="M8.5 9l6.5 6.5" stroke="#fff" stroke-width="1.5"/><path d="M12 18.5h8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    'hand.thumbsup.fill': '<path d="M8 10.5l3.6-6.3c.4-.7 1.5-.9 2.2-.2.6.5.8 1.3.6 2L13.6 9.5H19a2 2 0 0 1 2 2.3l-1.2 6.7a2.5 2.5 0 0 1-2.5 2H8z"/><rect x="2.5" y="10" width="4" height="10.5" rx="1"/>',
    'pencil.line': '<path d="M16 3l3.5 3.5-10 10L5 18l1.5-4.5z"/><path d="M3 21.5h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    'pencil': '<path d="M16.5 3l4.5 4.5L8.5 20 3 21l1-5.5z"/>',
    'pencil.tip': '<path d="M12 2l5 11v8H7v-8z"/><path d="M10 7.5h4" stroke="#fff" stroke-width="1.2"/>',
    'house.fill': '<path d="M12 3l9 8h-2.5v9.5H14v-6h-4v6H5.5V11H3z"/>',
    'eye.fill': '<path d="M12 5c-5 0-8.5 4-10 7 1.5 3 5 7 10 7s8.5-4 10-7c-1.5-3-5-7-10-7z"/><circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="1.8"/>',
    'trash.fill': '<path d="M4 6h16M9.5 6V4h5v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M5.5 7.5h13l-1 13a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4z"/>',
    'trash': '<path d="M4 6h16M9.5 6V4h5v2M6 7.5l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'list.bullet': '<circle cx="4.5" cy="6" r="1.6"/><circle cx="4.5" cy="12" r="1.6"/><circle cx="4.5" cy="18" r="1.6"/><path d="M9 6h12M9 12h12M9 18h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
    'doc.text': '<path d="M6 2.5h8l5 5V21.5H6z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="M9 12h7M9 15.5h7M9 19h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    'text.viewfinder': '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M7.5 9h9M7.5 12h9M7.5 15h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    'textformat.abc': '<path d="M2 17l3-9 3 9M3 14.5h4M10.5 8v9h2.8a2.2 2.2 0 0 0 0-4.5h-2.8M10.5 8h2.4a2 2 0 0 1 0 4M22 9.3a3.5 3.5 0 1 0 0 6.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    'magnifyingglass': '<circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2.4" fill="none"/><path d="M15.5 15.5l5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
    'info.circle': '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 11v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.4"/>',
    'camera.fill': '<path d="M3 8.5A2 2 0 0 1 5 6.5h2.5l1.5-2.5h6l1.5 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.8" fill="#fff"/><circle cx="12" cy="13" r="2.4"/>',
    'doc.on.clipboard': '<rect x="4" y="4" width="12" height="16" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="7.5" y="2.5" width="5" height="3" rx="1"/><path d="M10 9h10v13H10z" stroke="currentColor" stroke-width="1.8" fill="#fff" stroke-linejoin="round"/>',
    'bookmark.fill': '<path d="M6 2.5h12V21l-6-4.5L6 21z"/>',
    'play.fill': '<path d="M7 4.5l13 7.5-13 7.5z"/>',
    'photo.on.rectangle': '<rect x="6" y="3" width="15" height="12" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M8.5 13l3.5-4 2.5 2.5 2-2 3 3.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M3 7v12a2 2 0 0 0 2 2h13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    'gearshape.fill': '<path d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.8c.1.6.1 1.3 0 1.9l2 1.8-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-2.9 2-1.8a6 6 0 0 1 0-1.9l-2-1.8 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9z" transform="translate(0 2)"/><circle cx="12" cy="12" r="3.2" fill="#fff"/>',
    'square.and.arrow.up': '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M8 10.5H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 21.5h12a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5h-2" stroke="currentColor" stroke-width="2" fill="none"/>',
    'square.and.arrow.down': '<path d="M12 3v12M7.5 10.5L12 15l4.5-4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M8 7.5H6A1.5 1.5 0 0 0 4.5 9v11A1.5 1.5 0 0 0 6 21.5h12a1.5 1.5 0 0 0 1.5-1.5V9A1.5 1.5 0 0 0 18 7.5h-2" stroke="currentColor" stroke-width="2" fill="none"/>',
  };

  function icon(name, size = 20, color) {
    const s = h('span', { class: 'icon', style: { width: size, height: size, color: color || null } });
    s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${P[name] || ''}</svg>`;
    return s;
  }
  SW.icon = icon;

  /// 角是圓的星星（SoftStar）
  function softStar(size = 24, color = Theme.starDeep) {
    const s = h('span', { class: 'icon', style: { width: size, height: size } });
    s.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path fill="${color}" d="${softStarPath(size)}"/></svg>`;
    return s;
  }
  SW.softStar = softStar;

  // MARK: - 按壓回饋（PressStyle）

  document.addEventListener('pointerdown', e => {
    const b = e.target.closest && e.target.closest('.press');
    if (!b || b.disabled || b.closest('[disabled]')) return;
    b.classList.add('pressed');
    const up = () => {
      b.classList.remove('pressed');
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }, true);

  // MARK: - 共用的按鈕樣子

  /// Label(title, systemImage:)
  function label(title, iconName, opts = {}) {
    if (iconName === 'softstar') return [softStar(22), h('span', null, title)];
    return [iconName ? icon(iconName, opts.iconSize || 20) : null, title ? h('span', null, title) : null];
  }
  SW.label = label;

  /// 白色圓形的 X／返回鈕
  function closeButton(onClick, name = 'xmark', aria = '關掉') {
    return h('button', { class: 'press circle-btn', onclick: onClick, 'aria-label': aria }, icon(name, 20));
  }
  SW.closeButton = closeButton;

  // MARK: - 全螢幕畫面、表單、泡泡

  const layersRoot = () => document.getElementById('layers');
  const stack = [];

  /// fullScreenCover：從下面滑上來，蓋住整個畫面
  function presentCover(comp, opts = {}) {
    const wrap = h('div', { class: 'layer cover enter-cover' });
    wrap.appendChild(comp.el);
    layersRoot().appendChild(wrap);
    const entry = { comp, wrap, kind: 'cover', onDismiss: opts.onDismiss };
    stack.push(entry);
    comp.updateNow();
    if (comp.didAppear) comp.didAppear();
    notify();
    return () => dismiss(entry);
  }

  /// sheet：.form 是中間那種小視窗，.page 是比較大的
  function presentSheet(comp, opts = {}) {
    const card = h('div', { class: 'sheet-card ' + (opts.size === 'page' ? 'sheet-page' : opts.size === 'medium' ? 'sheet-medium' : 'sheet-form') });
    const grab = h('div', { class: 'sheet-grab' });
    card.appendChild(grab);
    card.appendChild(comp.el);
    const wrap = h('div', { class: 'layer sheet' }, h('div', { class: 'sheet-dim' }), card);
    layersRoot().appendChild(wrap);
    wrap.classList.add('enter-sheet');
    const entry = { comp, wrap, kind: 'sheet', onDismiss: opts.onDismiss };
    stack.push(entry);
    // 點外面、往下拉就關（SwiftUI 的 sheet 是往下滑關掉）
    wrap.querySelector('.sheet-dim').addEventListener('click', () => dismiss(entry));
    let startY = null, dy = 0;
    grab.addEventListener('pointerdown', e => { startY = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); });
    grab.addEventListener('pointermove', e => {
      if (startY == null) return;
      dy = Math.max(0, e.clientY - startY);
      card.style.transform = `translateY(${dy}px)`;
    });
    grab.addEventListener('pointerup', () => {
      if (startY == null) return;
      startY = null;
      if (dy > 120) dismiss(entry); else card.style.transform = '';
    });
    comp.updateNow();
    if (comp.didAppear) comp.didAppear();
    notify();
    return () => dismiss(entry);
  }

  function dismiss(entry) {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    // 上面疊著的一起收掉
    for (const e of stack.slice(i + 1).reverse()) dismiss(e);
    stack.splice(stack.indexOf(entry), 1);
    entry.comp.destroy();
    entry.wrap.classList.remove('enter-cover', 'enter-sheet');
    entry.wrap.classList.add(entry.kind === 'cover' ? 'leave-cover' : 'leave-sheet');
    entry.wrap.style.pointerEvents = 'none';
    setTimeout(() => entry.wrap.remove(), 380);
    if (entry.onDismiss) entry.onDismiss();
    notify();
  }

  function dismissComp(comp) {
    const e = stack.find(x => x.comp === comp);
    if (e) dismiss(e);
  }

  const stackListeners = new Set();
  function notify() { for (const f of stackListeners) f(); }

  SW.presentCover = presentCover;
  SW.presentSheet = presentSheet;
  SW.dismissComp = dismissComp;
  SW.layerCount = () => stack.length;
  /// 最上面那一層的畫面（自動測試用來看題目答案）
  SW.topComp = () => (stack.length ? stack[stack.length - 1].comp : null);
  SW.onStackChange = f => stackListeners.add(f);

  /// popover：小泡泡，點外面關掉
  function popover(anchor, build, opts = {}) {
    const r = anchor.getBoundingClientRect();
    const box = h('div', { class: 'popover' });
    const bg = h('div', { class: 'popover-bg' });
    const close = () => { bg.remove(); box.remove(); if (opts.onClose) opts.onClose(); };
    bg.addEventListener('pointerdown', e => { e.preventDefault(); close(); });
    box.appendChild(build(close));
    document.body.appendChild(bg);
    document.body.appendChild(box);
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(12, Math.min(window.innerWidth - bw - 12, left));
    let top = r.bottom + 14;
    let below = true;
    if (top + bh > window.innerHeight - 12) { top = r.top - bh - 14; below = false; }
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    const arrow = h('div', { class: 'popover-arrow ' + (below ? 'up' : 'down') });
    arrow.style.left = (r.left + r.width / 2 - left - 10) + 'px';
    box.appendChild(arrow);
    return close;
  }
  SW.popover = popover;

  // MARK: - 念出聲（AVSpeech → speechSynthesis）

  const Speaker = (() => {
    const synth = window.speechSynthesis;
    let voices = [];
    let narrator = null, woman = null, man = null;
    let token = 0;
    const female = /samantha|ava|allison|susan|victoria|karen|moira|tessa|zoe|nicky|serena|fiona|kate|joelle|noelle|female|woman|zira|aria|jenny|michelle|emma|olivia|google us english/i;
    const male = /alex|tom|daniel|fred|aaron|evan|nathan|oliver|arthur|gordon|rishi|reed|male|man\b|david|mark|guy|ryan|christopher|eric|google uk english male/i;
    const rank = v => (/premium/i.test(v.name) ? 20 : /enhanced/i.test(v.name) ? 10 : 0) + (v.lang.replace('_', '-') === 'en-US' ? 2 : 0);

    function pick() {
      if (!synth) return;
      voices = synth.getVoices();
      const us = voices.filter(v => v.lang.replace('_', '-') === 'en-US');
      narrator = us.find(v => /premium/i.test(v.name)) || us.find(v => /enhanced/i.test(v.name)) || us[0] || null;
      const en = voices.filter(v => v.lang.replace('_', '-').startsWith('en-'));
      const best = list => list.slice().sort((a, b) => rank(b) - rank(a))[0] || null;
      woman = best(en.filter(v => female.test(v.name) && !male.test(v.name))) || narrator;
      man = best(en.filter(v => male.test(v.name))) || null;
      // 認不出男聲時至少跟女聲用不同的 voice
      if (!man) man = en.find(v => v !== woman) || narrator;
    }
    if (synth) {
      pick();
      synth.addEventListener && synth.addEventListener('voiceschanged', pick);
    }

    // AVSpeechUtterance 的 rate 0.5 是正常速度
    const rateOf = r => Math.max(0.1, r / 0.5);

    function queue(items) {
      if (!synth) return;
      stop();
      const my = ++token;
      let i = 0;
      const next = () => {
        if (my !== token || i >= items.length) return;
        const it = items[i++];
        const u = new SpeechSynthesisUtterance(it.text);
        u.lang = 'en-US';
        if (it.voice) u.voice = it.voice;
        u.rate = rateOf(it.rate);
        u.onend = () => setTimeout(next, it.pause * 1000);
        u.onerror = () => setTimeout(next, 0);
        synth.speak(u);
      };
      next();
    }

    function stop() {
      token++;
      if (synth) synth.cancel();
    }

    return {
      say(text, slow = false) { Speaker.sayAll([text], slow); },
      sayAll(texts, slow = false) { queue(texts.map(t => ({ text: t, voice: narrator, rate: slow ? 0.28 : 0.45, pause: 0.35 }))); },
      /// 一句一句換人念（多益對話）
      sayLines(lines, pause = 0.5) {
        queue(lines.map(([who, t]) => ({ text: t, voice: who === 'woman' ? woman : who === 'man' ? man : narrator, rate: 0.47, pause })));
      },
      stop,
      voices: () => ({ narrator, woman, man }),
    };
  })();
  SW.Speaker = Speaker;

  // Safari 要先有一次使用者點擊才肯出聲：第一次點的時候念一個空字串解鎖
  let unlocked = false;
  document.addEventListener('pointerup', () => {
    if (unlocked || !window.speechSynthesis) return;
    unlocked = true;
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }, true);

  // MARK: - 設定（AppStorage）

  const Prefs = {
    get(k, d) {
      try { const v = localStorage.getItem('pref.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('pref.' + k, JSON.stringify(v)); } catch (e) { /* 存不了就算了 */ }
      for (const f of Prefs.listeners) f(k);
    },
    listeners: new Set(),
  };
  SW.Prefs = Prefs;

  /// 震動回饋：iPad 沒有，有的裝置才震
  SW.haptic = kind => { try { if (navigator.vibrate) navigator.vibrate(kind === 'success' ? 15 : kind === 'warning' ? [10, 60, 10] : 8); } catch (e) { /* 沒有就算了 */ } };
})();
