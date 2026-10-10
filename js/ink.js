// 寫字的紙：四線格、淡字、Apple Pencil 畫布（PencilKit 換成 canvas + Pointer Events）、手寫辨識
(function () {
  'use strict';
  const SW = window.SW;
  const { h, Theme, Prefs } = SW;

  // MARK: - 筆的粗細（PenWidth）

  const PenWidth = { normal: 7, options: [3, 4.5, 7, 9, 12] };
  SW.PenWidth = PenWidth;

  // MARK: - 字型量測（PaperMetrics）

  const measureCtx = document.createElement('canvas').getContext('2d');
  const metricCache = new Map();

  function fontMetrics(size) {
    const k = Math.round(size * 10);
    if (metricCache.has(k)) return metricCache.get(k);
    measureCtx.font = `400 ${size}px ${SW.FONT}`;
    const H = measureCtx.measureText('H'), x = measureCtx.measureText('x'), g = measureCtx.measureText('Hg');
    const m = {
      capHeight: H.actualBoundingBoxAscent || size * 0.705,
      xHeight: x.actualBoundingBoxAscent || size * 0.53,
      ascender: g.fontBoundingBoxAscent || size * 0.95,
      descender: g.fontBoundingBoxDescent || size * 0.24,
    };
    metricCache.set(k, m);
    return m;
  }

  function textWidth(text, size, kern = 6) {
    measureCtx.font = `400 ${size}px ${SW.FONT}`;
    return measureCtx.measureText(text).width + kern * Array.from(text).length;
  }
  SW.textWidth = textWidth;

  /// 英文四線格：線的位置照字型算，描字的範本才會剛好壓在線上
  function PaperMetrics(fontSize, height) {
    const f = fontMetrics(fontSize);
    const baseline = height * 0.66;
    return {
      fontSize, height, leftPad: 48, baseline,
      top: baseline - f.capHeight,
      mid: baseline - f.xHeight,
      bottom: baseline + f.descender,
    };
  }
  PaperMetrics.fitting = function (text, width, height) {
    const byHeight = height * 0.42 / 0.7;
    const w100 = textWidth(text, 100);
    const byWidth = w100 > 0 ? (width - 96) / w100 * 100 : byHeight;
    return PaperMetrics(Math.max(40, Math.min(byHeight, byWidth, 170)), height);
  };
  SW.PaperMetrics = PaperMetrics;

  /// 四線格（PaperLines）＋淡字（GhostText），畫成一張 SVG
  function paperSVG(m, width, ghost) {
    const lines = [
      [m.top, false, 0.6], [m.mid, true, 0.6], [m.baseline, false, 1], [m.bottom, false, 0.6],
    ].map(([y, dashed, a]) =>
      `<line x1="20" x2="${Math.max(20, width - 20)}" y1="${y}" y2="${y}" stroke="${Theme.line}" stroke-opacity="${a}" stroke-width="${dashed ? 1.5 : 2}"${dashed ? ' stroke-dasharray="8 8"' : ''}/>`).join('');
    const text = ghost ? `<text x="${m.leftPad}" y="${m.baseline}" font-size="${m.fontSize}" letter-spacing="6" fill="${Theme.ink}" fill-opacity="0.18" style="font-family:${SW.FONT.replace(/"/g, "'")};white-space:pre">${esc(ghost)}</text>` : '';
    const el = h('div', { class: 'paper-svg', style: { height: m.height } });
    el.innerHTML = `<svg width="100%" height="${m.height}" aria-hidden="true">${lines}${text}</svg>`;
    return el;
  }
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  SW.paperSVG = paperSVG;

  // MARK: - 畫布（HandwritingCanvas）

  /// 一張畫布只屬於一題：screen 用 key（題號＋畫布代數）建，換題、擦掉一律換新的一張
  class InkPad {
    constructor(el, opts) {
      this.el = el;
      this.opts = opts; // { strokes, onChange, erasing: () => bool, disabled: () => bool }
      this.strokes = (opts.strokes || []).map(s => ({ ...s, points: s.points.slice() }));
      this.alive = true;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'ink-canvas';
      el.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.current = null;
      this.lastErase = null;
      this.size = { w: 0, h: 0 };
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(el);
      this.resize();
      const c = this.canvas;
      c.addEventListener('pointerdown', e => this.down(e));
      c.addEventListener('pointermove', e => this.move(e));
      c.addEventListener('pointerup', e => this.up(e));
      c.addEventListener('pointercancel', e => this.up(e));
      // 手指照常捲動；Apple Pencil 碰到畫布不捲動
      const stylusGuard = e => {
        for (const t of e.changedTouches) if (t.touchType === 'stylus') { e.preventDefault(); return; }
      };
      c.addEventListener('touchstart', stylusGuard, { passive: false });
      c.addEventListener('touchmove', stylusGuard, { passive: false });
      el._pad = this;
    }

    kill() {
      this.alive = false;
      this.ro.disconnect();
    }

    resize() {
      const r = this.el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (Math.round(r.width) === this.size.w && Math.round(r.height) === this.size.h) return;
      this.size = { w: Math.round(r.width), h: Math.round(r.height) };
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      this.canvas.style.width = r.width + 'px';
      this.canvas.style.height = r.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.redraw();
    }

    point(e) {
      const r = this.canvas.getBoundingClientRect();
      // 滑鼠、沒感壓的筆 pressure 是 0.5
      const p = e.pressure > 0 ? e.pressure : 0.5;
      return { x: e.clientX - r.left, y: e.clientY - r.top, p, t: Math.round(performance.now()) };
    }

    /// Pencil 的力道每一點都在跳，直接拿來當粗細，線的邊緣就會抖；跟上一點平均一下
    smoothPressure(pt) {
      const pts = this.current.stroke.points;
      const prev = pts[pts.length - 1];
      if (prev) pt.p = prev.p * 0.65 + pt.p * 0.35;
      return pt;
    }

    accepts(e) {
      // 只有 Apple Pencil 畫；手掌、手指不畫
      if (e.pointerType !== 'pen') return false;
      if (!this.alive) return false;
      if (this.opts.disabled && this.opts.disabled()) return false;
      return true;
    }

    down(e) {
      if (!this.accepts(e)) return;
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* 沒關係 */ }
      const pt = this.point(e);
      if (this.opts.erasing && this.opts.erasing()) {
        this.current = { erasing: true, id: e.pointerId };
        this.lastErase = pt;
        this.erase(pt, pt);
        return;
      }
      const pressure = Prefs.get('pressure', true);
      this.current = { id: e.pointerId, stroke: { w: Prefs.get('penWidth', PenWidth.normal), pressure, points: [pt] } };
      this.redraw();
    }

    move(e) {
      if (!this.current || e.pointerId !== this.current.id) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const pt = this.point(ev);
        if (this.current.erasing) {
          this.erase(this.lastErase, pt);
          this.lastErase = pt;
        } else {
          this.current.stroke.points.push(this.smoothPressure(pt));
        }
      }
      this.scheduleDraw();
    }

    /// 一秒會進來兩百多個點，每個都重畫太重；一格畫面只畫一次
    scheduleDraw() {
      if (this.drawPending) return;
      this.drawPending = true;
      requestAnimationFrame(() => { this.drawPending = false; this.redraw(!!this.cacheDirty); });
    }

    up(e) {
      if (!this.current || e.pointerId !== this.current.id) return;
      const cur = this.current;
      this.current = null;
      if (!cur.erasing) this.strokes.push(cur.stroke);
      this.redraw();
      if (this.alive && this.opts.onChange) this.opts.onChange(this.strokes.slice());
    }

    /// 像真的橡皮擦（PKEraserTool(.bitmap, width: 28)）：擦過的地方就消失，不用剛好碰到整筆
    erase(a, b) {
      const R = 14;
      const out = [];
      let changed = false;
      for (const s of this.strokes) {
        const pts = densify(s.points, 2);
        let run = [];
        for (const p of pts) {
          if (distToSeg(p, a, b) <= R + s.w / 2) {
            changed = true;
            if (run.length) out.push({ ...s, points: run });
            run = [];
          } else run.push(p);
        }
        if (run.length) out.push({ ...s, points: run });
      }
      if (changed) { this.strokes = out; this.cacheDirty = true; }
    }

    /// 寫完的筆畫畫在另一張畫布存著，寫字的時候只重畫正在寫的那一筆
    redraw(full = true) {
      const ctx = this.ctx;
      const c = this.canvas;
      if (full) this.cacheDirty = false;
      if (full || !this.cache || this.cache.width !== c.width || this.cache.height !== c.height) {
        if (!this.cache) this.cache = document.createElement('canvas');
        this.cache.width = c.width;
        this.cache.height = c.height;
        const cc = this.cache.getContext('2d');
        cc.setTransform(c.width / Math.max(1, this.size.w), 0, 0, c.height / Math.max(1, this.size.h), 0, 0);
        for (const s of this.strokes) drawStroke(cc, s, true);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(this.cache, 0, 0);
      ctx.restore();
      if (this.current && this.current.stroke) drawStroke(ctx, this.current.stroke, false);
    }
  }
  SW.InkPad = InkPad;

  function densify(points, step) {
    if (points.length < 2) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.floor(d / step);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t, t: Math.round(a.t + (b.t - a.t) * t) });
      }
      out.push(b);
    }
    return out;
  }

  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /// 感壓開著跟著力道變粗細，關掉固定粗細
  function widthAt(s, p) {
    return s.pressure ? s.w * (0.35 + 1.3 * p) : s.w;
  }

  /// 用 perfect-freehand 把一筆算成一個外框再填滿：位置有平滑（streamline），粗細一路連續變化，
  /// 不會像一段一段畫那樣接縫處一粗一細。感壓關掉時 thinning 0＝固定粗細。
  /// 感壓開著時粗細範圍跟原本一樣：筆寬 ×（0.35 ～ 1.65）
  function drawStroke(ctx, s, done) {
    const pts = s.points;
    ctx.fillStyle = Theme.ink;
    if (!pts.length) return;
    const PF = window.PerfectFreehand;
    if (!PF || pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, widthAt(s, pts[0].p) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const outline = PF.getStroke(pts.map(p => [p.x, p.y, p.p]), {
      size: s.w,
      thinning: s.pressure ? 0.65 : 0,
      smoothing: 0.7,
      streamline: 0.6,
      simulatePressure: false,
      last: done,
    });
    if (outline.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.closePath();
    ctx.fill();
  }

  // MARK: - 筆畫的工具

  const Ink = {
    bounds(s) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of s.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      const pad = s.w / 2;
      return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad, midY: (y0 + y1) / 2 };
    },
    /// 拿掉中心點落在第 row 行的筆畫
    removingRow(strokes, row, rowHeight, topInset = 0) {
      return strokes.filter(s => Math.trunc((Ink.bounds(s).midY - topInset) / rowHeight) !== row);
    },
    rowOf(s, rowHeight, rows) {
      return Math.min(Math.max(Math.trunc(Ink.bounds(s).midY / rowHeight), 0), rows - 1);
    },
  };
  SW.Ink = Ink;

  /// 給 screen 用：一個 key 一張畫布
  function inkSlot(key, opts) {
    return h('div', {
      key, persist: true, class: 'ink-slot',
      mount: el => { new InkPad(el, opts); },
      unmount: el => { if (el._pad) el._pad.kill(); },
    });
  }
  SW.inkSlot = inkSlot;

  // MARK: - 看懂手寫：Google Input Tools 手寫端點

  const ENDPOINT = 'https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8';

  const Handwriting = {
    endpoint: ENDPOINT,
    /// 回傳 Google 給的候選；連不上回 null（畫面會照樣讓她按「我寫對了」）
    async raw(strokes, width, height) {
      if (!strokes.length) return [];
      const ink = strokes.filter(s => s.points.length).map(s => [
        s.points.map(p => Math.round(p.x)),
        s.points.map(p => Math.round(p.y)),
        s.points.map(p => p.t - strokes[0].points[0].t),
      ]);
      const body = {
        options: 'enable_pre_space',
        requests: [{
          writing_guide: { writing_area_width: Math.round(width), writing_area_height: Math.round(height) },
          ink, language: 'en',
        }],
      };
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const json = await res.json();
        if (!Array.isArray(json) || json[0] !== 'SUCCESS') return null;
        const cands = json[1] && json[1][0] && json[1][0][1];
        return Array.isArray(cands) ? cands.filter(c => typeof c === 'string') : [];
      } catch (e) {
        return null;
      }
    },
    /// 回傳幾個可能的讀法，最像的排前面；連不上回 null
    async read(strokes, width, height) {
      if (!strokes.length) return [];
      const raw = await Handwriting.raw(strokes, width, height);
      if (raw == null) return null;
      return SW.Recognizer.clean(raw);
    },
    /// 整頁作文：照四線格一行一行讀，行和行之間換行
    async readPage(strokes, lineHeight, topInset, width) {
      if (!strokes.length) return '';
      const rows = new Map();
      for (const s of strokes) {
        const r = Math.max(0, Math.trunc((Ink.bounds(s).midY - topInset) / lineHeight));
        if (!rows.has(r)) rows.set(r, []);
        rows.get(r).push(s);
      }
      const lines = [];
      for (const r of [...rows.keys()].sort((a, b) => a - b)) {
        const list = rows.get(r).slice().sort((a, b) => Ink.bounds(a).x0 - Ink.bounds(b).x0);
        const raw = await Handwriting.raw(list, width, lineHeight);
        if (raw == null) return null;
        if (raw.length) lines.push(raw[0]);
      }
      return lines.join('\n');
    },
  };
  SW.Handwriting = Handwriting;
})();
