// 一輪結束後的罰則（PenaltyView.swift）：罰寫、罰聽寫、罰默寫、罰抄、罰配對、罰重排
(function () {
  'use strict';
  const SW = window.SW;
  const { h, icon, Theme, Speaker, PaperMetrics, Recognizer, PenaltyKind, Ink } = SW;

  /// 依種類開對的罰寫畫面（PenaltyScreen）
  SW.makePenalty = function (store, kind, items, onDone, onClose) {
    if (kind === 'match') return new MatchPenaltyView(store, items, onDone, onClose);
    if (kind === 'rearrange') return new RearrangePenaltyView(items, onDone, onClose);
    return new PenaltyView(store, kind, items, onDone, onClose);
  };

  function topBar(onClose, middle, title) {
    return h('div', { class: 'row', style: { gap: 8, flex: 'none' } },
      SW.closeButton(onClose),
      h('div', { class: 'spacer' }),
      h('div', { class: 'title3 bold soft' }, middle),
      h('div', { class: 'spacer' }),
      h('div', { class: 'tag-capsule', style: { background: Theme.peach } }, title));
  }

  // MARK: - 寫的罰則

  class PenaltyView extends SW.Component {
    constructor(store, kind, items, onDone, onClose) {
      super();
      this.store = store;
      this.kind = kind;
      this.items = items;
      this.onDone = onDone;
      this.onClose = onClose;
      this.rows = PenaltyKind.rows(kind);
      this.rowOK = new Array(this.rows).fill(null);
      this.rowRead = new Array(this.rows).fill(null);
      this.peek = false;
      this.index = 0;
      this.drawing = [];
      this.canvasGen = 0;
      this.checking = false;
      this.erasing = false;
      this.geo = { w: 0, h: 0 };
      this.prefListener = () => this.update();
      SW.Prefs.listeners.add(this.prefListener);
      this.start();
    }

    get item() { return this.items[this.index]; }
    get padKey() { return `${this.index}-${this.canvasGen}`; }
    get allOK() { return this.rowOK.length > 0 && this.rowOK.every(x => x === true); }
    get anyWrong() { return this.rowOK.includes(false); }
    get rowHeight() { return Math.min(170, (this.geo.h || 510) / this.rows); }

    setDrawing(d) { this.drawing = d; this.canvasGen += 1; }

    onDestroy() {
      Speaker.stop();
      SW.Prefs.listeners.delete(this.prefListener);
    }

    render() {
      return [SW.background(), h('div', { class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px', gap: 20 } },
        topBar(() => this.onClose(), `${this.index + 1} / ${this.items.length}`, PenaltyKind.title(this.kind)),
        h('div', { class: 'col', style: { flex: '1 1 0', minHeight: 0, position: 'relative', overflow: 'hidden' } },
          h('div', { key: 'p' + this.index, enter: this.index > 0 ? 'slide' : null, leave: 'slide', class: 'col', style: { gap: 20, height: '100%', width: '100%' } },
            this.prompt(),
            h('div', {
              key: 'geo', style: { flex: '1 1 0', minHeight: 0, position: 'relative' },
              mount: SW.measure('geo', (w, hh) => { this.geo = { w, h: hh }; this.update(); }),
            }, this.board()))),
        this.buttons())];
    }

    prompt() {
      const it = this.item;
      const reveal = PenaltyKind.showsEnglish(this.kind) || this.peek || this.anyWrong || this.allOK;
      return h('div', { class: 'row', style: { gap: 16, justifyContent: 'center', flex: 'none' } },
        h('div', { class: 'col text-center', style: { gap: 4, alignItems: 'center', minWidth: 0 } },
          h('button', { class: 'press', style: { fontSize: 40, fontWeight: 700, color: Theme.starDeep, whiteSpace: 'nowrap' }, onclick: () => { if (reveal) SW.showWordInfo(this.store, it.english); } },
            reveal ? SW.fitText(it.english, 40, Math.max(200, (this.geo.w || 900) - 160)) : '？'),
          PenaltyKind.showsChinese(this.kind) || this.peek || this.allOK ? h('div', { class: 'title2 soft' }, it.chinese) : null),
        SW.speakButton(56, false, () => Speaker.say(it.english)),
        SW.speakButton(44, true, () => Speaker.say(it.english, true)));
    }

    board() {
      const rowH = this.rowHeight;
      const width = (this.geo.w || 900) - 64;
      const m = PaperMetrics.fitting(this.item.english, width - 56, rowH);
      const key = this.padKey;
      const rows = [];
      for (let r = 0; r < this.rows; r++) {
        const ok = this.rowOK[r];
        rows.push(h('div', { style: { position: 'relative', height: rowH, background: ok === true ? Theme.a('mint', 0.45) : ok === false ? Theme.a('bad', 0.12) : 'transparent' } },
          SW.paperSVG(m, width, r === 0 && PenaltyKind.ghostFirst(this.kind) ? this.item.english : null),
          ok != null ? h('div', { class: 'row', style: { position: 'absolute', inset: 0, justifyContent: 'flex-end', paddingRight: 16, gap: 8, pointerEvents: 'none' } },
            !ok && this.rowRead[r] != null ? h('span', { class: 'headline', style: { color: Theme.bad } }, `「${this.rowRead[r]}」`) : null,
            icon(ok ? 'checkmark.circle.fill' : 'xmark.circle.fill', 30, ok ? Theme.good : Theme.bad)) : null));
      }
      return h('div', { class: 'row', style: { gap: 8, alignItems: 'flex-start' } },
        h('div', { class: ['paper', this.allOK ? 'disabled-ink' : ''], style: { width, height: rowH * this.rows, flex: 'none' } },
          h('div', { class: 'col' }, rows),
          SW.inkSlot('pad' + key, {
            strokes: this.drawing,
            erasing: () => this.erasing,
            disabled: () => this.allOK,
            onChange: s => { if (key === this.padKey) { this.drawing = s; this.update(); } },
          })),
        SW.rowEraseColumn(this.rows, rowH, r => this.eraseRow(r), { disabled: this.allOK }));
    }

    buttons() {
      const pill = (t, i, f, a, o = {}) => SW.pill(t, i, f, a, { minWidth: o.wide ? 200 : 130, ...o });
      const kids = [SW.penButton(() => this.update()),
        SW.toolButton(this.erasing ? '橡皮擦' : '筆', this.erasing ? 'eraser.fill' : 'pencil', this.erasing, () => { this.erasing = !this.erasing; this.update(); })];
      if (!PenaltyKind.showsEnglish(this.kind) && !this.allOK) {
        kids.push(SW.toolButton('偷看', 'eye.fill', this.peek, () => { this.peek = !this.peek; this.update(); }));
      }
      kids.push(h('div', { class: 'spacer' }));
      if (this.allOK) {
        kids.push(h('div', { style: { width: 1, height: 64 } }));
      } else if (this.anyWrong) {
        kids.push(pill('擦掉錯的', 'eraser.fill', '#fff', () => this.eraseWrongRows()));
        kids.push(pill('我寫對了', 'hand.thumbsup.fill', Theme.mint, () => this.finishItem()));
        kids.push(pill(this.checking ? '看看你寫的…' : '再檢查', 'star.fill', Theme.star, () => this.check(), { disabled: this.checking }));
      } else {
        kids.push(pill('全部擦掉', 'trash.fill', '#fff', () => { this.setDrawing([]); this.update(); }));
        kids.push(pill(this.checking ? '看看你寫的…' : '檢查', 'star.fill', Theme.star, () => this.check(), { wide: true, disabled: !this.drawing.length || this.checking }));
      }
      return h('div', { class: 'row', style: { gap: 14, flex: 'none' } }, kids);
    }

    // MARK: 流程

    start() {
      this.peek = false;
      this.rowOK = new Array(this.rows).fill(null);
      this.rowRead = new Array(this.rows).fill(null);
      this.setDrawing([]);
      this.erasing = false;
      const i = this.index;
      this.after(350, () => { if (this.index === i) Speaker.say(this.item.english); });
    }

    /// 每一行分開辨識；已經對的行不重判
    async check() {
      const i = this.index;
      this.checking = true;
      this.erasing = false;
      this.update();
      const rowH = this.rowHeight;
      const byRow = Array.from({ length: this.rows }, () => []);
      for (const s of this.drawing) byRow[Ink.rowOf(s, rowH, this.rows)].push(s);
      const width = (this.geo.w || 900) - 64;
      for (let r = 0; r < this.rows; r++) {
        if (this.rowOK[r] === true) continue;
        if (!byRow[r].length) {
          this.rowOK[r] = false;
          this.rowRead[r] = null;
          continue;
        }
        const read = await SW.Handwriting.read(byRow[r], width, rowH);
        if (this.dead || i !== this.index) return;
        const cands = read || [];
        this.rowOK[r] = Recognizer.matches(cands, this.item.english);
        this.rowRead[r] = this.rowOK[r] ? null : (cands[0] ?? null);
      }
      this.checking = false;
      if (this.allOK) this.finishItem();
      else { SW.haptic('warning'); this.update(); }
    }

    eraseRow(r) {
      this.setDrawing(Ink.removingRow(this.drawing, r, this.rowHeight));
      this.rowOK[r] = null;
      this.rowRead[r] = null;
      this.update();
    }

    eraseWrongRows() {
      const rowH = this.rowHeight;
      this.setDrawing(this.drawing.filter(s => this.rowOK[Ink.rowOf(s, rowH, this.rows)] === true));
      for (let r = 0; r < this.rows; r++) {
        if (this.rowOK[r] === false) { this.rowOK[r] = null; this.rowRead[r] = null; }
      }
      this.update();
    }

    finishItem() {
      if (!this.rowOK.length) return;
      this.rowOK = new Array(this.rows).fill(true);
      SW.haptic('success');
      Speaker.say(this.item.english);
      this.update();
      const current = this.index;
      this.after(1000, () => {
        if (this.index !== current) return;
        if (this.index + 1 >= this.items.length) {
          this.onDone();
        } else {
          this.index += 1;
          this.start();
          this.update();
        }
      });
    }
  }

  // MARK: - 四選一錯了：配對

  /// 左邊英文、右邊中文，點一個英文再點它的中文；錯的字至少湊 4 組，不夠的拿別的字當陪練
  class MatchPenaltyView extends SW.Component {
    constructor(store, items, onDone, onClose) {
      super();
      this.store = store;
      this.items = items;
      this.onDone = onDone;
      this.onClose = onClose;
      this.round = 0;
      /// 每組都要連對兩輪
      this.rounds = 2;
      this.wrongID = null;
      this.setup();
    }

    onDestroy() { Speaker.stop(); }

    setup() {
      let list = this.items.slice();
      if (list.length < 4) {
        const have = new Set(list.map(x => x.english));
        const extra = SW.shuffle(this.store.words.filter(w => !have.has(w.english))).slice(0, 4 - list.length);
        list = list.concat(extra.map(w => ({ id: w.id, english: w.english, chinese: w.chinese })));
      }
      this.pairs = SW.shuffle(list);
      this.right = SW.shuffle(list);
      this.matched = new Set();
      this.selected = null;
    }

    render() {
      const card = (text, id, english) => {
        const done = this.matched.has(id);
        const on = english && this.selected === id;
        const bad = !english && this.wrongID === id;
        return h('button', {
          class: 'press keep-opacity', disabled: done, onclick: () => this.tap(id, english),
          style: {
            minHeight: 84, padding: '0 10px', borderRadius: 22, width: '100%', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden',
            background: done ? Theme.mint : bad ? Theme.a('bad', 0.35) : on ? Theme.star : '#fff',
            boxShadow: done ? 'none' : '0 5px 0 var(--shadow)', opacity: done ? 0.55 : 1, transition: 'background .25s, opacity .25s, transform .25s',
          },
        }, SW.fitText(text, english ? 32 : 28, 380));
      };
      return [SW.background(), h('div', { class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px', gap: 28, alignItems: 'center' } },
        h('div', { style: { width: '100%' } }, topBar(() => this.onClose(), `${this.round + 1} / ${this.rounds}`, '罰配對')),
        // 錯很多個時一個畫面放不下，可以上下捲
        h('div', { class: 'scroll', style: { flex: '1 1 0', minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' } },
          h('div', { class: 'spacer' }),
          h('div', { key: 'r' + this.round, enter: this.round > 0 ? 'fade' : null, class: 'row', style: { gap: 40, alignItems: 'flex-start', maxWidth: 900, width: '100%', flex: 'none', padding: '4px 0 10px' } },
            h('div', { class: 'col', style: { gap: 16, flex: '1 1 0' } }, this.pairs.map(p => card(p.english, p.id, true))),
            h('div', { class: 'col', style: { gap: 16, flex: '1 1 0' } }, this.right.map(p => card(p.chinese, p.id, false)))),
          h('div', { class: 'spacer' })))];
    }

    tap(id, english) {
      if (english) {
        this.selected = id;
        const p = this.pairs.find(x => x.id === id);
        if (p) Speaker.say(p.english);
        this.update();
        return;
      }
      if (this.selected == null) return;
      if (this.selected === id) {
        SW.haptic('success');
        this.matched.add(id);
        this.selected = null;
        this.update();
        if (this.matched.size === this.pairs.length) {
          this.after(600, () => {
            if (this.round + 1 >= this.rounds) this.onDone();
            else { this.round += 1; this.setup(); this.update(); }
          });
        }
      } else {
        SW.haptic('warning');
        this.wrongID = id;
        this.update();
        this.after(500, () => { this.wrongID = null; this.update(); });
      }
    }
  }

  // MARK: - 排句子錯了：再排一次

  class RearrangePenaltyView extends SW.Component {
    constructor(items, onDone, onClose) {
      super();
      this.items = items;
      this.onDone = onDone;
      this.onClose = onClose;
      this.index = 0;
      this.prepare();
    }

    get item() { return this.items[this.index]; }
    onDestroy() { Speaker.stop(); }

    prepare() {
      const t = SW.arrangeTokens(this.item.english);
      let sh = SW.shuffle(t);
      if (t.length > 1) while (SW.sameArray(sh, t)) sh = SW.shuffle(t);
      this.tiles = sh;
      this.placed = [];
      this.state = null;
    }

    render() {
      const tile = (text, fill, action, extra = {}) => h('button', {
        class: 'press', onclick: action,
        style: { fontSize: 30, fontWeight: 600, padding: '12px 20px', borderRadius: 18, background: fill, boxShadow: '0 4px 0 var(--shadow)', whiteSpace: 'nowrap', ...extra },
      }, text);
      const placedFill = this.state === false ? Theme.a('bad', 0.3) : this.state === true ? Theme.mint : Theme.a('star', 0.55);
      return [SW.background(), h('div', { class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px', gap: 28, alignItems: 'center' } },
        h('div', { style: { width: '100%' } }, topBar(() => this.onClose(), `${this.index + 1} / ${this.items.length}`, '罰重排')),
        h('div', { class: 'spacer' }),
        h('div', { key: 'i' + this.index, enter: this.index > 0 ? 'slide' : null, class: 'col', style: { gap: 28, width: '100%', alignItems: 'center' } },
          h('div', { class: 'text-center', style: { fontSize: 44, fontWeight: 700 } }, this.item.chinese),
          h('div', { class: 'flow', style: { gap: 12, width: '100%', minHeight: 90 + 48, padding: 24, background: '#fff', borderRadius: 28, alignContent: 'center' } },
            this.placed.map((i, pos) => tile(this.tiles[i], placedFill, () => {
              if (this.state != null) return;
              this.placed.splice(pos, 1);
              this.update();
            }))),
          h('div', { class: 'flow', style: { gap: 12, width: '100%' } }, this.tiles.map((t, i) => {
            const used = this.placed.includes(i);
            return tile(t, Theme.mint, () => {
              if (used || this.state != null) return;
              Speaker.say(t);
              this.placed.push(i);
              if (this.placed.length === this.tiles.length) this.check();
              this.update();
            }, { opacity: used ? 0.2 : 1 });
          })),
          this.state === false ? h('div', { class: 'text-center', style: { fontSize: 34, fontWeight: 700, color: Theme.good } }, this.item.english) : null),
        h('div', { class: 'spacer' }))];
    }

    /// 排錯了看一下答案再重來；排對才換下一句
    check() {
      const ok = SW.sameArray(this.placed.map(i => this.tiles[i]), SW.arrangeTokens(this.item.english));
      Speaker.say(this.item.english);
      this.state = ok;
      SW.haptic(ok ? 'success' : 'warning');
      const current = this.index;
      this.after(ok ? 1000 : 1800, () => {
        if (this.index !== current) return;
        if (ok) {
          if (this.index + 1 >= this.items.length) this.onDone();
          else { this.index += 1; this.prepare(); this.update(); }
        } else {
          this.prepare();
          this.update();
        }
      });
    }
  }
})();
