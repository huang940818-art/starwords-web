// 寫文章：文章列表、一句一句描（ArticleView.swift）、自由寫（WritingView.swift、Essays.swift）
(function () {
  'use strict';
  const SW = window.SW;
  const { h, icon, Theme, Speaker, Data, Prefs, PaperMetrics, Ink } = SW;

  // MARK: - 文章列表（ArticleListView）

  class ArticleListView extends SW.Component {
    constructor(store, essays, onClose) {
      super();
      this.store = store;
      this.essays = essays;
      this.onClose = onClose;
      this.level = 'baby';
      this.open = null;
      this.articleComp = null;
    }

    get done() { return new Set(String(Prefs.get('articlesDone', '')).split(',').filter(x => x !== '')); }

    onDestroy() { if (this.articleComp) this.articleComp.destroy(); }

    openArticle(a) {
      if (this.articleComp) this.articleComp.destroy();
      this.open = a;
      this.articleComp = new ArticleView(this.store, a, () => {
        const d = this.done;
        d.add(a.id);
        Prefs.set('articlesDone', [...d].sort().join(','));
      }, this.nextArticle(a), () => this.closeArticle());
      this.update();
    }

    closeArticle() {
      this.articleComp.destroy();
      this.articleComp = null;
      this.open = null;
      this.update();
    }

    nextArticle(a) {
      const same = Data.articles.filter(x => x.level === a.level);
      const i = same.findIndex(x => x.id === a.id);
      if (i < 0 || i + 1 >= same.length) return null;
      return () => this.openArticle(same[i + 1]);
    }

    render() {
      const comp = this.articleComp;
      if (comp) {
        return [SW.background(), h('div', {
          key: 'article-' + this.open.id, persist: true, enter: 'push', leave: 'push', style: { position: 'absolute', inset: 0 },
          mount: el => { el.appendChild(comp.el); comp.updateNow(); if (comp.didAppear) comp.didAppear(); },
        })];
      }
      const done = this.done;
      return [SW.background(), h('div', { key: 'list', class: 'col', style: { position: 'absolute', inset: 0, padding: 40, gap: 24 } },
        h('div', { class: 'row', style: { gap: 16, flex: 'none' } },
          SW.closeButton(() => this.onClose()),
          h('div', { style: { fontSize: 40, fontWeight: 800 } }, '寫文章'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'press row', style: { gap: 8, fontSize: 20, fontWeight: 700, minWidth: 150, minHeight: 52, padding: '0 16px', borderRadius: 999, background: '#fff', justifyContent: 'center' }, onclick: () => this.openFree() },
            SW.label('自由寫', 'pencil.line'))),
        h('div', { class: 'row', style: { gap: 12, flex: 'none' } }, SW.Levels.map(l => h('button', {
          class: 'press', onclick: () => { this.level = l; this.update(); },
          style: { flex: '1 1 0', minHeight: 60, fontSize: 22, fontWeight: 700, borderRadius: 18, background: this.level === l ? SW.levelColor(l) : '#fff', boxShadow: this.level === l ? `inset 0 0 0 2.5px ${Theme.starDeep}` : 'none' },
        }, SW.LevelTitle[l]))),
        h('div', { class: 'scroll', 'data-scroll': 'articles-' + this.level, style: { flex: '1 1 0', minHeight: 0 } },
          h('div', { class: 'col', style: { gap: 16, paddingBottom: 40 } }, Data.articles.filter(a => a.level === this.level).map(a => h('button', {
            class: 'press row', onclick: () => this.openArticle(a),
            style: { gap: 16, padding: 24, background: '#fff', borderRadius: 24, boxShadow: '0 5px 0 rgba(245,166,36,.15)', textAlign: 'left' },
          },
          h('div', { class: 'col', style: { gap: 6, minWidth: 0, flex: '1 1 0' } },
            h('div', { style: { fontSize: 28, fontWeight: 700 } }, a.title),
            h('div', { class: 'title3 soft' }, a.titleZh),
            h('div', { class: 'body soft', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, a.lines[0] ? a.lines[0].en : '')),
          h('span', { class: 'soft' }, `${a.lines.length} 句`),
          icon(done.has(a.id) ? 'star.fill' : 'star', 30, done.has(a.id) ? Theme.star : Theme.a('soft', 0.4)))))))];
    }

    openFree() {
      const comp = new WritingListView(this.essays, () => SW.dismissComp(comp));
      SW.presentCover(comp);
    }
  }
  SW.ArticleListView = ArticleListView;

  // MARK: - 一句一句描（ArticleView）

  class ArticleView extends SW.Component {
    constructor(store, article, onFinish, onNext, onClose) {
      super();
      this.store = store;
      this.article = article;
      this.onFinish = onFinish;
      this.onNext = onNext;
      this.onClose = onClose;
      this.index = 0;
      this.drawing = [];
      this.canvasGen = 0;
      this.erasing = false;
      this.showChinese = true;
      this.finished = false;
      this.geo = { w: 0, h: 0 };
      this.prefListener = () => this.update();
      Prefs.listeners.add(this.prefListener);
    }

    get line() { return this.article.lines[this.index]; }
    get padKey() { return `${this.index}-${this.canvasGen}`; }
    setDrawing(d) { this.drawing = d; this.canvasGen += 1; }

    didAppear() { this.speakLine(); }
    onDestroy() { Speaker.stop(); Prefs.listeners.delete(this.prefListener); }
    showWord(t) { SW.showWordInfo(this.store, t); }

    render() {
      const a = this.article;
      const top = h('div', { class: 'row', style: { gap: 16, flex: 'none' } },
        SW.closeButton(() => this.onClose(), 'chevron.left', '返回'),
        h('div', { class: 'col', style: { minWidth: 0 } },
          h('div', { style: { fontSize: 28, fontWeight: 800 } }, a.title),
          h('div', { class: 'subheadline soft' }, a.titleZh)),
        h('div', { class: 'spacer' }),
        this.finished ? null : h('div', { class: 'row', style: { gap: 5 } }, a.lines.map((_, i) =>
          h('span', { style: { width: 12, height: 12, borderRadius: '50%', background: i < this.index ? Theme.star : i === this.index ? Theme.a('starDeep', 0.5) : Theme.a('soft', 0.25) } }))),
        this.toggle('中文', this.showChinese, () => { this.showChinese = !this.showChinese; this.update(); }),
        this.toggle('全文', false, () => this.showWhole()));
      if (this.finished) {
        return h('div', { class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px', gap: 20 } },
          top, h('div', { class: 'spacer' }), this.finishCard(), h('div', { class: 'spacer' }));
      }
      return h('div', { class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px', gap: 20 } },
        top,
        h('div', { style: { flex: '1 1 0', minHeight: 0, position: 'relative', overflow: 'hidden' } },
          h('div', { key: 'l' + this.index, enter: this.index > 0 ? 'slide' : null, leave: 'slide', class: 'col', style: { gap: 20, height: '100%', width: '100%' } },
            this.sentence(),
            h('div', { key: 'geo', style: { flex: '1 1 0', minHeight: 0 }, mount: SW.measure('geo', (w, hh) => { this.geo = { w, h: hh }; this.update(); }) },
              this.paper()))),
        this.bottomBar());
    }

    toggle(t, on, action) {
      return h('button', { class: 'press headline', onclick: action, style: { padding: '0 16px', height: 44, borderRadius: 999, background: on ? Theme.a('star', 0.6) : '#fff', flex: 'none' } }, t);
    }

    sentence() {
      return h('div', { class: 'row', style: { gap: 16, alignItems: 'flex-start', padding: 22, background: '#fff', borderRadius: 24, flex: 'none' } },
        h('div', { class: 'col', style: { gap: 10, flex: '1 1 0', minWidth: 0 } },
          SW.tappableText(this.line.en, { size: 34 }, t => this.showWord(t)),
          this.showChinese ? h('div', { class: 'title2 soft' }, this.line.zh) : null),
        h('div', { class: 'col', style: { gap: 10 } },
          SW.speakButton(52, false, () => Speaker.say(this.line.en), { fill: Theme.starDeep, noShadow: true, iconSize: 20 }),
          SW.speakButton(52, true, () => Speaker.say(this.line.en, true), { fill: Theme.starDeep, noShadow: true, iconSize: 20 })));
    }

    /// 從大字開始試，塞得下就用
    layout(text, width, height) {
      const words = text.split(' ').filter(x => x !== '');
      let size = 90;
      for (;;) {
        const m = PaperMetrics(size, size * 2.0);
        const rows = [];
        let cur = '';
        for (const w of words) {
          const next = cur === '' ? w : cur + ' ' + w;
          if (SW.textWidth(next, size) > width - m.leftPad - 40 && cur !== '') { rows.push(cur); cur = w; } else cur = next;
        }
        if (cur !== '') rows.push(cur);
        if (rows.length * m.height <= height || size <= 40) return [rows, m];
        size -= 6;
      }
    }

    paper() {
      const W = this.geo.w || 900, H = this.geo.h || 400;
      const [chunks, m] = this.layout(this.line.en, W - 64, H);
      const key = this.padKey;
      const pw = W - 64;
      return h('div', { class: 'row', style: { gap: 8, alignItems: 'flex-start' } },
        h('div', { class: 'paper', style: { width: pw, height: m.height * chunks.length, flex: 'none' } },
          h('div', { class: 'col' }, chunks.map(c => h('div', { style: { height: m.height } }, SW.paperSVG(m, pw, c)))),
          SW.inkSlot('pad' + key, {
            strokes: this.drawing,
            erasing: () => this.erasing,
            onChange: s => { if (key === this.padKey) { this.drawing = s; this.update(); } },
          })),
        SW.rowEraseColumn(chunks.length, m.height, r => { this.setDrawing(Ink.removingRow(this.drawing, r, m.height)); this.update(); }));
    }

    bottomBar() {
      const pill = (t, i, f, a, o = {}) => SW.pill(t, i, f, a, { minWidth: o.wide ? 200 : 120, minHeight: 60, ...o });
      return h('div', { class: 'row', style: { gap: 14, flex: 'none' } },
        SW.penButton(() => this.update()),
        SW.toolButton(this.erasing ? '橡皮擦' : '筆', this.erasing ? 'eraser.fill' : 'pencil', this.erasing, () => { this.erasing = !this.erasing; this.update(); }),
        h('div', { class: 'spacer' }),
        pill('擦掉', 'trash.fill', '#fff', () => { this.setDrawing([]); this.update(); }),
        pill(this.index + 1 < this.article.lines.length ? '描好了' : '寫完了', 'checkmark', Theme.star, () => this.advance(), { wide: true, disabled: !this.drawing.length }));
    }

    finishCard() {
      const pill = (t, i, f, a, o = {}) => SW.pill(t, i, f, a, { minWidth: o.wide ? 200 : 120, minHeight: 60, ...o });
      return h('div', { key: 'finish', enter: 'scale', class: 'col', style: { gap: 28, alignItems: 'center' } },
        SW.bigStar(170, `+${this.article.lines.length}`, 52),
        h('div', { style: { fontSize: 40, fontWeight: 700 } }, '整篇寫完了'),
        h('div', { class: 'row', style: { gap: 16 } },
          pill('全文', 'doc.text', '#fff', () => this.showWhole()),
          pill('回列表', 'list.bullet', '#fff', () => this.onClose()),
          this.onNext ? pill('下一篇', 'arrow.right', Theme.star, this.onNext, { wide: true }) : null));
    }

    showWhole() {
      const self = this;
      class Whole extends SW.Component {
        render() {
          const a = self.article;
          return h('div', { class: 'scroll', style: { position: 'absolute', inset: 0 } }, h('div', { class: 'col', style: { gap: 22, padding: 32 } },
            h('div', { class: 'row' },
              h('div', { class: 'col' }, h('div', { style: { fontSize: 34, fontWeight: 800 } }, a.title), h('div', { class: 'title3 soft' }, a.titleZh)),
              h('div', { class: 'spacer' }),
              h('button', { class: 'press row headline', style: { gap: 8, padding: '0 18px', height: 48, borderRadius: 999, background: Theme.star }, onclick: () => Speaker.sayAll(a.lines.map(l => l.en)) },
                SW.label('全部念', 'speaker.wave.2.fill'))),
            a.lines.map(l => h('div', { class: 'col', style: { gap: 6 } },
              h('div', { class: 'row', style: { alignItems: 'flex-start' } },
                h('div', { style: { flex: '1 1 0' } }, SW.tappableText(l.en, { size: 26 }, t => SW.showWordInfo(self.store, t))),
                h('button', { class: 'press', style: { color: Theme.starDeep }, onclick: () => Speaker.say(l.en), 'aria-label': '念' }, icon('speaker.wave.2.fill', 20))),
              self.showChinese ? h('div', { class: 'soft' }, l.zh) : null))));
        }
      }
      SW.presentSheet(new Whole(), { size: 'form' });
    }

    speakLine() {
      const i = this.index;
      this.after(350, () => { if (this.index === i) Speaker.say(this.line.en); });
    }

    advance() {
      this.setDrawing([]);
      this.erasing = false;
      if (this.index + 1 < this.article.lines.length) {
        this.index += 1;
        this.speakLine();
      } else {
        this.store.addStars(this.article.lines.length);
        this.onFinish();
        this.finished = true;
      }
      this.update();
    }
  }
  SW.ArticleView = ArticleView;

  // MARK: - 自由寫的文章（EssayStore）

  class EssayStore {
    constructor(storage, key = 'starwords.essays') {
      this.storage = storage;
      this.key = key;
      this.essays = [];
      try {
        const list = JSON.parse(storage.getItem(key) || '[]');
        if (Array.isArray(list)) this.essays = list;
      } catch (e) { this.essays = []; }
    }
    save() {
      try { this.storage.setItem(this.key, JSON.stringify(this.essays)); } catch (e) { console.log('文章存檔失敗：' + e); }
    }
    get sorted() { return this.essays.slice().sort((a, b) => b.updated - a.updated); }
    essay(id) { return this.essays.find(e => e.id === id) || null; }
    create(title) {
      const now = Date.now();
      const e = { id: crypto.randomUUID ? crypto.randomUUID().toUpperCase() : String(now), title, created: now, updated: now, pages: [[]], text: '' };
      this.essays.push(e);
      this.save();
      return e;
    }
    update(e) {
      const i = this.essays.findIndex(x => x.id === e.id);
      if (i < 0) return;
      this.essays[i] = { ...e, updated: Date.now() };
      this.save();
    }
    delete(id) {
      this.essays = this.essays.filter(e => e.id !== id);
      this.save();
    }
  }
  SW.EssayStore = EssayStore;

  // MARK: - 自由寫的列表（WritingListView）

  class WritingListView extends SW.Component {
    constructor(essays, onClose) {
      super();
      this.essays = essays;
      this.onClose = onClose;
      this.openID = null;
      this.writing = null;
    }

    onDestroy() { if (this.writing) this.writing.destroy(); }

    openEssay(id) {
      if (this.writing) this.writing.destroy();
      this.openID = id;
      this.writing = new WritingView(this.essays, id, () => {
        this.writing.destroy();
        this.writing = null;
        this.openID = null;
        this.update();
      });
      this.update();
    }

    render() {
      if (this.writing) {
        const comp = this.writing;
        return [SW.background(), h('div', { key: 'w-' + this.openID, persist: true, enter: 'push', leave: 'push', style: { position: 'absolute', inset: 0, background: Theme.cream },
          mount: el => { el.appendChild(comp.el); comp.updateNow(); } })];
      }
      const fmt = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric' });
      return [SW.background(), h('div', { key: 'list', class: 'col', style: { position: 'absolute', inset: 0, padding: 40, gap: 28 } },
        h('div', { class: 'row', style: { gap: 8, flex: 'none' } },
          SW.closeButton(() => this.onClose()),
          h('div', { style: { fontSize: 40, fontWeight: 800, paddingLeft: 8 } }, '寫文章'),
          h('div', { class: 'spacer' }),
          SW.pill('新的一篇', 'plus', Theme.star, () => this.chooseTopic(), { minWidth: 200, minHeight: 60 })),
        h('div', { class: 'scroll', style: { flex: '1 1 0', minHeight: 0 } },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, paddingBottom: 40 } },
            this.essays.sorted.map(e => {
              const btn = h('button', {
                class: 'press col', onclick: () => this.openEssay(e.id),
                oncontextmenu: ev => { ev.preventDefault(); this.menu(ev.currentTarget, e); },
                style: { gap: 10, padding: 22, minHeight: 170, textAlign: 'left', alignItems: 'stretch', background: '#fff', borderRadius: 24, boxShadow: '0 5px 0 rgba(245,166,36,.15)' },
              },
              h('div', { class: 'title2 bold', style: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, e.title),
              e.text ? h('div', { class: 'body soft', style: { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, e.text) : null,
              h('div', { class: 'spacer' }),
              h('div', { class: 'row subheadline soft' }, h('span', null, fmt.format(new Date(e.updated))), h('div', { class: 'spacer' }), h('span', null, `${e.pages.length} 頁`)));
              longPress(btn, () => this.menu(btn, e));
              return btn;
            }))))];
    }

    /// 長按出現的選單（contextMenu）
    menu(anchor, e) {
      SW.popover(anchor, close => h('div', { style: { padding: 6, minWidth: 180 } },
        h('button', { class: 'row', style: { gap: 10, width: '100%', padding: '12px 14px', color: Theme.bad, fontSize: 17 }, onclick: () => { close(); this.essays.delete(e.id); this.update(); } },
          h('span', { style: { flex: '1 1 0', textAlign: 'left' } }, '刪掉'), icon('trash', 20))));
    }

    chooseTopic() {
      const self = this;
      let sheet;
      class Topics extends SW.Component {
        render() {
          const btn = (zh, en, fill) => h('button', {
            class: 'press col', style: { gap: 4, padding: 18, alignItems: 'flex-start', background: fill, borderRadius: 18, textAlign: 'left' },
            onclick: () => { const e = self.essays.create(en); SW.dismissComp(sheet); self.openEssay(e.id); },
          }, h('div', { class: 'title3 bold' }, en), h('div', { class: 'soft' }, zh));
          return h('div', { class: 'scroll', style: { position: 'absolute', inset: 0 } }, h('div', { class: 'col', style: { gap: 20, padding: 32 } },
            h('div', { style: { fontSize: 32, fontWeight: 800 } }, '寫什麼'),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 } },
              btn('自由寫', 'Free Writing', Theme.mint),
              Data.essayTopics.map(([zh, en]) => btn(zh, en, '#fff')))));
        }
      }
      sheet = new Topics();
      SW.presentSheet(sheet, { size: 'form' });
    }
  }
  SW.WritingListView = WritingListView;

  function longPress(el, fn) {
    let t = null;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      t = setTimeout(() => { t = null; el._longPressed = true; fn(); }, 550);
    });
    const cancel = () => { if (t) clearTimeout(t); t = null; };
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('click', e => { if (el._longPressed) { el._longPressed = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }

  // MARK: - 寫的那一頁（WritingView）

  const LINE = 110;

  class WritingView extends SW.Component {
    constructor(essays, essayID, onClose) {
      super();
      this.essays = essays;
      this.essayID = essayID;
      this.onClose = onClose;
      const e = essays.essay(essayID);
      this.essay = e ? { ...e } : { title: '' };
      this.pages = e && e.pages.length ? e.pages.map(p => p.slice()) : [[]];
      this.page = 0;
      this.erasing = false;
      this.reading = false;
      this.loaded = !!e;
      this.canvasGen = 0;
      this.geo = { w: 0, h: 0 };
      this.prefListener = () => this.update();
      Prefs.listeners.add(this.prefListener);
    }

    onDestroy() { this.persist(); Prefs.listeners.delete(this.prefListener); Speaker.stop(); }

    render() {
      const rows = Math.max(Math.trunc(((this.geo.h || 600) - 20) / LINE), 1);
      const m = PaperMetrics(64, LINE);
      const p = this.page, gen = this.canvasGen;
      const pw = (this.geo.w || 900) - 64;
      const lines = [];
      for (let i = 0; i < rows; i++) lines.push(h('div', { style: { height: LINE } }, SW.paperSVG(m, pw, null)));
      const small = (title, iconName, on, action, disabled) => h('button', {
        class: 'press row', onclick: action, disabled: !!disabled, 'aria-label': title || iconName,
        style: { gap: 8, justifyContent: 'center', fontSize: 17, fontWeight: 600, minWidth: title ? 110 : 56, minHeight: 52, padding: '0 14px', borderRadius: 999, background: on ? Theme.peach : '#fff', opacity: disabled ? 0.3 : 1 },
      }, title ? SW.label(title, iconName) : icon(iconName, 20));
      return h('div', { class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px', gap: 18 } },
        h('div', { class: 'row', style: { gap: 16, flex: 'none' } },
          SW.closeButton(() => { this.persist(); this.onClose(); }, 'chevron.left', '返回'),
          h('input', {
            key: 'title', class: 'text-field', placeholder: '題目', value: this.essay.title, autocapitalize: 'words',
            style: { fontSize: 30, fontWeight: 700, flex: '1 1 0' },
            oninput: e => { this.essay.title = e.target.value; },
          }),
          h('button', {
            class: 'press pill', disabled: this.reading || this.pages.every(x => !x.length), onclick: () => this.readAll(),
            style: { background: Theme.star, minWidth: 200, minHeight: 60 },
          }, SW.label(this.reading ? '看看你寫的…' : '看我寫的', 'text.viewfinder'))),
        h('div', { key: 'geo', style: { flex: '1 1 0', minHeight: 0 }, mount: SW.measure('geo', (w, hh) => { this.geo = { w, h: hh }; this.update(); }) },
          h('div', { class: 'row', style: { gap: 8, alignItems: 'flex-start', height: '100%' } },
            h('div', { class: 'paper', style: { width: pw, height: '100%', flex: 'none' } },
              h('div', { class: 'col', style: { paddingTop: 10 } }, lines),
              SW.inkSlot(`page${p}-${gen}`, {
                strokes: this.pages[p],
                erasing: () => this.erasing,
                // 綁定建立時的那一頁，換頁時舊畫布晚到的回報不會寫到新的一頁
                onChange: s => { if (gen === this.canvasGen && p < this.pages.length && p === this.page) { this.pages[p] = s; this.update(); } },
              })),
            SW.rowEraseColumn(rows, LINE, r => {
              this.pages[this.page] = Ink.removingRow(this.pages[this.page], r, LINE, 10);
              this.canvasGen += 1;
              this.update();
            }, { topInset: 10 }))),
        h('div', { class: 'row', style: { gap: 14, flex: 'none' } },
          SW.penButton(() => this.update()),
          small(this.erasing ? '橡皮擦' : '筆', this.erasing ? 'eraser.fill' : 'pencil', this.erasing, () => { this.erasing = !this.erasing; this.update(); }),
          h('div', { class: 'spacer' }),
          small('', 'chevron.left', false, () => this.go(this.page - 1), this.page === 0),
          h('div', { class: 'title3 bold mono-digits', style: { minWidth: 70, textAlign: 'center' } }, `${this.page + 1} / ${this.pages.length}`),
          small('', 'chevron.right', false, () => this.go(this.page + 1), this.page + 1 >= this.pages.length),
          small('加一頁', 'plus', false, () => { this.pages.push([]); this.go(this.pages.length - 1); })));
    }

    go(p) {
      if (p < 0 || p >= this.pages.length) return;
      this.persist();
      this.erasing = false;
      this.page = p;
      this.update();
    }

    persist() {
      if (!this.loaded) return;
      const e = this.essays.essay(this.essayID) || this.essay;
      this.essays.update({ ...e, title: this.essay.title, pages: this.pages });
    }

    async readAll() {
      this.reading = true;
      this.update();
      const parts = [];
      let offline = false;
      for (const d of this.pages) {
        const t = await SW.Handwriting.readPage(d, LINE, 10, (this.geo.w || 900) - 64);
        if (t == null) { offline = true; break; }
        if (t !== '') parts.push(t);
      }
      if (this.dead) return;
      this.reading = false;
      this.persist();
      const e = this.essays.essay(this.essayID);
      if (e && !offline) {
        const text = parts.join('\n');
        if (text !== e.text) delete e.review;
        this.essays.update({ ...e, text });
      }
      this.update();
      const result = new EssayResultView(this.essays, this.essayID);
      SW.presentSheet(result, { size: 'form', onDismiss: () => { const x = this.essays.essay(this.essayID); if (x) this.essay.title = x.title; this.update(); } });
    }
  }
  SW.WritingView = WritingView;

  // MARK: - 辨識出來的文字（EssayResultView）

  class EssayResultView extends SW.Component {
    constructor(essays, essayID) {
      super();
      this.essays = essays;
      this.essayID = essayID;
      const e = essays.essay(essayID);
      this.text = e ? e.text : '';
    }

    onDestroy() { this.save(); Speaker.stop(); }

    render() {
      const e = this.essays.essay(this.essayID);
      return h('div', { class: 'scroll', style: { position: 'absolute', inset: 0 } }, h('div', { class: 'col', style: { gap: 24, padding: 32 } },
        h('div', { class: 'row', style: { gap: 8 } },
          h('div', { style: { fontSize: 30, fontWeight: 800, flex: '1 1 0' } }, e ? e.title : ''),
          h('button', { class: 'press row headline', style: { gap: 8, padding: '0 18px', minHeight: 48, borderRadius: 999, background: '#fff' }, onclick: () => Speaker.say(this.text) },
            SW.label('念給我聽', 'speaker.wave.2.fill')),
          h('button', { class: 'press headline', style: { padding: '0 22px', minHeight: 48, borderRadius: 999, background: Theme.star }, onclick: () => { this.save(); SW.dismissComp(this); } }, '好了')),
        // 拼字：iOS 用 UITextChecker 列出拼錯的字；網頁沒有，改用瀏覽器自己的拼字檢查（紅色底線）
        h('textarea', {
          key: 'text', value: this.text, spellcheck: 'true', lang: 'en', autocapitalize: 'off', autocorrect: 'off',
          style: { fontSize: 24, padding: 14, minHeight: 220, borderRadius: 20, width: '100%', fontFamily: 'inherit' },
          oninput: ev => { this.text = ev.target.value; },
        })));
    }

    save() {
      const e = this.essays.essay(this.essayID);
      if (!e) return;
      this.essays.update({ ...e, text: this.text });
    }
  }
})();
