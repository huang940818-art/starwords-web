// 單字卡（WordInfo.swift）、單字庫（LexiconView.swift）、單字本（WordBankView.swift）、拍照加字（ScanWords.swift）
(function () {
  'use strict';
  const SW = window.SW;
  const { h, icon, Theme, Speaker, Lexicon, VerbForms } = SW;

  /// 長清單只畫看得到的那幾排（SwiftUI 的 List／LazyVGrid 也是用到才畫）
  function virtual(comp, key, count, rowHeight, cols, renderRow, opts = {}) {
    const st = comp['_v_' + key] || (comp['_v_' + key] = { top: 0, height: 800 });
    const rows = Math.ceil(count / cols);
    const first = Math.max(0, Math.floor(st.top / rowHeight) - 6);
    const last = Math.min(rows, Math.ceil((st.top + st.height) / rowHeight) + 6);
    const kids = [];
    for (let r = first; r < last; r++) kids.push(renderRow(r));
    return h('div', {
      class: 'scroll', 'data-scroll': key, style: { flex: '1 1 0', minHeight: 0, ...(opts.style || {}) },
      mount: el => {
        st.height = el.clientHeight || 800;
        let raf = 0;
        el.addEventListener('scroll', () => {
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            const cur = comp['_v_' + key];
            if (!cur) return;
            cur.top = el.scrollTop;
            cur.height = el.clientHeight;
            comp.update();
          });
        });
      },
    }, opts.header || null,
    h('div', { style: { position: 'relative', height: rows * rowHeight + (opts.bottom || 0) } },
      h('div', { style: { position: 'absolute', left: 0, right: 0, top: first * rowHeight } }, kids)));
  }
  SW.virtual = virtual;
  SW.resetVirtual = function (comp, key) {
    const st = comp['_v_' + key];
    if (st) st.top = 0;
    const el = comp.el.querySelector(`[data-scroll="${key}"]`);
    if (el) el.scrollTop = 0;
  };

  // MARK: - 單字介紹（WordInfoSheet）

  class WordInfoSheet extends SW.Component {
    constructor(store, token) {
      super();
      this.store = store;
      this.token = token;
      this.added = false;
      this.entry = Lexicon.lookup(token);
      this.bare = SW.text.trim(token, c => !(SW.text.isLetter(c) || "'’-".includes(c)));
    }

    /// 動詞才有時態；片語（take a nap）看第一個字是不是動詞
    get forms() {
      const e = this.entry;
      const word = e ? e.english : this.bare;
      if (e && VerbForms.isVerb(e.pos)) return VerbForms.of(e.english);
      if (word.includes(' ')) {
        const first = word.split(' ').filter(x => x !== '')[0];
        const fe = first ? Lexicon.entry(first) : null;
        if (VerbForms.isVerb(fe ? fe.pos : null)) return VerbForms.of(word);
      }
      return null;
    }

    get custom() {
      const k = this.bare.toLowerCase();
      return this.store.words.find(w => w.english.toLowerCase() === k) || null;
    }

    didAppear() { Speaker.say(this.entry ? this.entry.english : this.bare); }
    onDestroy() { Speaker.stop(); }

    render() {
      const e = this.entry;
      const word = e ? e.english : this.bare;
      const kids = [];
      kids.push(h('div', { class: 'col', style: { gap: 6 } },
        h('div', { class: 'row', style: { gap: 14 } },
          h('div', { style: { fontSize: 52, fontWeight: 800, whiteSpace: 'nowrap', minWidth: 0 } }, SW.fitText(word, 52, 380)),
          h('div', { class: 'spacer', style: { minWidth: 8 } }),
          e ? h('div', { class: 'headline', style: { padding: '8px 14px', borderRadius: 999, background: SW.levelColor(e.level), whiteSpace: 'nowrap' } }, e.levelLabel) : null),
        e && e.kk ? h('div', { class: 'title2 soft' }, `[${e.kk}]`) : null));
      kids.push(h('div', { class: 'row', style: { gap: 14 } },
        SW.speakButton(60, false, () => Speaker.say(word), { fill: Theme.starDeep, noShadow: true }),
        SW.speakButton(48, true, () => Speaker.say(word, true), { fill: Theme.starDeep, noShadow: true }),
        e && e.english.toLowerCase() !== this.bare.toLowerCase() ? h('div', { class: 'title3 soft', style: { paddingLeft: 8 } }, this.bare) : null));
      if (e) {
        if (e.ms && e.ms.length >= 2) {
          kids.push(h('div', { class: 'col', style: { gap: 10 } }, e.ms.map((m, i) => h('div', { class: 'row', style: { gap: 10, alignItems: 'baseline' } },
            h('span', { class: 'headline', style: { color: '#fff', width: 28, height: 28, borderRadius: '50%', background: Theme.starDeep, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none', alignSelf: 'center' } }, String(i + 1)),
            m.length > 1 && m[0] ? h('span', { class: 'title3 bold', style: { color: Theme.starDeep } }, m[0]) : null,
            h('span', { style: { fontSize: 26, fontWeight: 700 } }, m[m.length - 1] || '')))));
        } else {
          kids.push(h('div', { class: 'row', style: { gap: 10, alignItems: 'baseline' } },
            e.pos ? h('span', { class: 'title3 bold', style: { color: Theme.starDeep } }, e.pos) : null,
            h('span', { style: { fontSize: 30, fontWeight: 700 } }, e.zh)));
        }
        const f = this.forms;
        if (f) kids.push(this.tenseGrid(f));
        if (e.ex != null) kids.push(this.exampleRow(e.ex, e.exz ?? ''));
      } else if (this.custom) {
        const w = this.custom;
        kids.push(h('div', { style: { fontSize: 30, fontWeight: 700 } }, w.chinese));
        const ex = this.store.example(w);
        if (ex) kids.push(this.exampleRow(ex[0], ex[1]));
      }
      if (e) {
        const have = this.added || this.store.hasCustom(e.english);
        kids.push(h('div', { class: 'row', style: { gap: 14 } },
          h('button', {
            class: 'press pill keep-opacity', disabled: have, style: { background: have ? Theme.mint : Theme.star, minWidth: 200, minHeight: 56, boxShadow: 'none', padding: '0 20px' },
            onclick: () => { if (this.store.add(e.english, e.zh)) { this.added = true; this.update(); } },
          }, SW.label(have ? '在單字本裡了' : '加到單字本', have ? 'checkmark' : 'plus'))));
      }
      return h('div', { class: 'scroll', style: { position: 'absolute', inset: 0 } }, h('div', { class: 'col', style: { gap: 22, padding: 32 } }, kids));
    }

    tenseGrid(f) {
      const tense = (label, form) => h('button', {
        class: 'press col', onclick: () => Speaker.say(form.split('/').join(', ')),
        style: { gap: 2, padding: '10px 16px', alignItems: 'flex-start', background: '#fff', borderRadius: 16, textAlign: 'left', minWidth: 0 },
      }, h('span', { class: 'subheadline semibold soft' }, label), h('span', { style: { fontSize: 24, fontWeight: 700, whiteSpace: 'nowrap' } }, SW.fitText(form, 24, 220)));
      return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
        tense('第三人稱', f.third), tense('進行式', f.ing), tense('過去式', f.past), tense('過去分詞', f.participle));
    }

    exampleRow(en, zh) {
      return h('div', { class: 'row', style: { gap: 14, padding: 18, background: Theme.a('star', 0.22), borderRadius: 20 } },
        h('div', { class: 'col', style: { gap: 4, flex: '1 1 0' } },
          h('div', { style: { fontSize: 24, fontWeight: 600 } }, en),
          h('div', { class: 'title3 soft' }, zh)),
        h('button', { class: 'press', style: { color: Theme.starDeep }, onclick: () => Speaker.say(en), 'aria-label': '念' }, icon('speaker.wave.2.fill', 26)));
    }
  }

  SW.showWordInfo = function (store, token) {
    SW.presentSheet(new WordInfoSheet(store, token), { size: 'form' });
  };

  // MARK: - 單字庫（LexiconView）

  class LexiconView extends SW.Component {
    constructor(store, onPractice, onClose) {
      super();
      this.store = store;
      this.onPractice = onPractice;
      this.onClose = onClose;
      this.level = 'baby';
      this.sub = null;
      this.query = '';
      this.cols = 4;
    }

    get list() {
      const q = this.query.trim().toLowerCase();
      if (q) {
        return Lexicon.all.filter(e => e.w.toLowerCase().startsWith(q) || e.zh.includes(q))
          .map((e, i) => [e, i]).sort((a, b) => (a[0].w.length - b[0].w.length) || (a[1] - b[1])).map(x => x[0]);
      }
      let l = Lexicon.entries(this.level);
      if (this.level === 'senior' && this.sub != null) l = l.filter(e => e.sub === this.sub);
      return l.slice().sort((a, b) => { const x = a.w.toLowerCase(), y = b.w.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
    }

    render() {
      const list = this.list;
      const cols = this.cols;
      const header = h('div', { class: 'row', style: { gap: 16, flex: 'none' } },
        SW.closeButton(() => this.onClose()),
        h('div', { style: { fontSize: 40, fontWeight: 800 } }, '單字庫'),
        h('div', { class: 'row', style: { gap: 8, padding: '0 18px', height: 52, borderRadius: 999, background: '#fff', flex: '1 1 0', minWidth: 0 } },
          icon('magnifyingglass', 20, Theme.soft),
          h('input', {
            key: 'q', class: 'text-field title3', placeholder: '搜尋英文或中文', value: this.query, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
            oninput: e => { this.query = e.target.value; SW.resetVirtual(this, 'lex'); this.update(); },
          }),
          this.query ? h('button', { class: 'press', onclick: () => { this.query = ''; this.update(); }, 'aria-label': '清除' }, icon('xmark.circle.fill', 20, Theme.soft)) : null),
        this.query ? null : h('button', { class: 'press pill', style: { background: Theme.star, minWidth: 160, minHeight: 52, boxShadow: 'none' }, onclick: () => this.onPractice(this.level) }, SW.label('練這一級', 'star.fill')));
      const tabs = this.query ? null : h('div', { class: 'row', style: { gap: 12, flex: 'none' } }, SW.Levels.map(l => h('button', {
        class: 'press col center', onclick: () => { this.level = l; this.sub = null; SW.resetVirtual(this, 'lex'); this.update(); },
        style: { flex: '1 1 0', minHeight: 76, gap: 2, borderRadius: 20, background: this.level === l ? SW.levelColor(l) : '#fff', boxShadow: this.level === l ? `inset 0 0 0 2.5px ${Theme.starDeep}` : 'none' },
      }, h('span', { class: 'title2 bold' }, SW.LevelTitle[l]), h('span', { class: 'subheadline soft' }, `${Lexicon.entries(l).length} 字`))));
      const chip = (t, on, act) => h('button', { class: 'press headline', onclick: act, style: { padding: '10px 16px', borderRadius: 999, background: on ? Theme.star : '#fff' } }, t);
      const subs = !this.query && this.level === 'senior' ? h('div', { class: 'row', style: { gap: 10, flex: 'none' } },
        chip('全部', this.sub == null, () => { this.sub = null; SW.resetVirtual(this, 'lex'); this.update(); }),
        [1, 2, 3, 4, 5, 6].map(n => chip(`${n} 級`, this.sub === n, () => { this.sub = n; SW.resetVirtual(this, 'lex'); this.update(); }))) : null;
      const ROW = 112;
      const grid = virtual(this, 'lex', list.length, ROW, cols, r => h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12, height: ROW, paddingBottom: 12 } },
        list.slice(r * cols, r * cols + cols).map(e => this.card(e))), { bottom: 40 });
      return h('div', {
        class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px 0', gap: 20 },
        mount: SW.measure('lexw', w => { const c = Math.max(1, Math.floor((w - 72 + 12) / (230 + 12))); if (c !== this.cols) { this.cols = c; this.update(); } }),
      }, header, tabs, subs, grid);
    }

    card(e) {
      const forms = VerbForms.isVerb(e.pos) ? VerbForms.of(e.english) : null;
      return h('button', {
        class: 'press col', onclick: () => SW.showWordInfo(this.store, e.english),
        style: { gap: 4, padding: 14, alignItems: 'stretch', background: '#fff', borderRadius: 16, textAlign: 'left', position: 'relative', minWidth: 0, overflow: 'hidden' },
      },
      h('div', { class: 'row', style: { gap: 4, alignItems: 'baseline' } },
        h('span', { class: 'title3 bold', style: { whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 } }, SW.fitText(e.w, 20, 160)),
        h('div', { class: 'spacer', style: { minWidth: 4 } }),
        e.pos ? h('span', { class: 'caption bold', style: { color: Theme.starDeep } }, e.pos) : null),
      h('div', { class: 'body soft', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, e.zh),
      forms ? h('div', { class: 'caption semibold', style: { color: Theme.starDeep, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, `${forms.past} · ${forms.participle}`) : null,
      this.store.hasCustom(e.english) ? h('span', { style: { position: 'absolute', top: 6, right: 6, color: Theme.starDeep } }, icon('bookmark.fill', 12)) : null);
    }
  }
  SW.LexiconView = LexiconView;

  // MARK: - 單字本（WordBankView）

  class WordBankView extends SW.Component {
    constructor(store, onDone) {
      super();
      this.store = store;
      this.onDone = onDone;
      this.filter = 'all';
      this.search = '';
      this.newEnglish = '';
      this.newChinese = '';
      this.swiped = null;
      this.listener = () => this.update();
      store.listeners.add(this.listener);
    }

    onDestroy() { this.store.listeners.delete(this.listener); Speaker.stop(); }

    /// 加字時的查詢：打英文查開頭相符的，只打中文就反查
    get suggestions() {
      const en = this.newEnglish.trim().toLowerCase();
      const zh = this.newChinese.trim();
      if (en) {
        return Lexicon.all.filter(e => e.english.toLowerCase().startsWith(en))
          .sort((a, b) => (a.english.length - b.english.length) || (a.english < b.english ? -1 : a.english > b.english ? 1 : 0)).slice(0, 6);
      }
      if (zh) return Lexicon.all.filter(e => e.zh.includes(zh)).map((e, i) => [e, i]).sort((a, b) => (Array.from(a[0].zh).length - Array.from(b[0].zh).length) || (a[1] - b[1])).map(x => x[0]).slice(0, 6);
      return [];
    }

    get shown() {
      const base = this.store.pool({ kind: this.filter });
      const q = this.search.trim().toLowerCase();
      if (!q) return base;
      return base.filter(w => w.english.toLowerCase().includes(q) || w.chinese.includes(q));
    }

    addOne() {
      if (this.store.add(this.newEnglish, this.newChinese)) {
        this.newEnglish = '';
        this.newChinese = '';
        this.update();
        requestAnimationFrame(() => { const i = this.el.querySelector('[data-key="en"]'); if (i) i.focus(); });
      }
    }

    render() {
      const sugg = this.suggestions;
      const canAdd = this.newEnglish.trim() && this.newChinese.trim();
      const addSection = h('div', { class: 'ios-section' },
        h('div', { class: 'ios-row title3' },
          h('input', { key: 'en', class: 'text-field', placeholder: '英文', value: this.newEnglish, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'next',
            oninput: e => { this.newEnglish = e.target.value; this.update(); },
            onkeydown: e => { if (e.key === 'Enter') { const z = this.el.querySelector('[data-key="zh"]'); if (z) z.focus(); } } }),
          h('div', { style: { width: 1, alignSelf: 'stretch', background: 'rgba(60,60,67,.2)' } }),
          h('input', { key: 'zh', class: 'text-field', placeholder: '中文', value: this.newChinese, enterkeyhint: 'done',
            oninput: e => { this.newChinese = e.target.value; this.update(); },
            onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) this.addOne(); } }),
          h('button', { class: 'press', disabled: !canAdd, onclick: () => this.addOne(), 'aria-label': '加' }, icon('plus.circle.fill', 30, Theme.starDeep))),
        sugg.map(e => h('div', {
          class: 'ios-row press', style: { cursor: 'pointer' },
          onclick: ev => {
            if (ev.target.closest('[data-info]')) return;
            this.newEnglish = e.english;
            this.newChinese = e.zh;
            Speaker.say(e.english);
            this.update();
            requestAnimationFrame(() => { const z = this.el.querySelector('[data-key="zh"]'); if (z) z.focus(); });
          },
        },
        icon('magnifyingglass', 18, Theme.soft),
        h('span', { class: 'title3 semibold' }, e.english),
        e.pos ? h('span', { class: 'caption bold', style: { color: Theme.starDeep } }, e.pos) : null,
        h('span', { class: 'soft', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } }, e.zh),
        h('div', { class: 'spacer' }),
        h('span', { class: 'caption semibold', style: { padding: '4px 10px', borderRadius: 999, background: SW.levelColor(e.level), whiteSpace: 'nowrap' } }, e.levelLabel),
        h('button', { class: 'press', 'data-info': '1', onclick: () => SW.showWordInfo(this.store, e.english), 'aria-label': '介紹' }, icon('info.circle', 22, Theme.starDeep)))),
        h('div', { class: 'ios-row', style: { gap: 28 } },
          h('button', { class: 'row', style: { gap: 8, color: Theme.starDeep, fontSize: 17 }, onclick: () => SW.presentSheet(new ScanSheet(this.store), { size: 'page' }) }, SW.label('拍照加字', 'camera.fill')),
          h('button', { class: 'row', style: { gap: 8, color: Theme.starDeep, fontSize: 17 }, onclick: () => SW.presentSheet(new PasteSheet(this.store), { size: 'form' }) }, SW.label('一次貼很多', 'doc.on.clipboard'))));
      const seg = h('div', { class: 'segmented' },
        h('button', { class: this.filter === 'all' ? 'on' : '', onclick: () => { this.filter = 'all'; SW.resetVirtual(this, 'bank'); this.update(); } }, '全部'),
        h('button', { class: this.filter === 'custom' ? 'on' : '', onclick: () => { this.filter = 'custom'; SW.resetVirtual(this, 'bank'); this.update(); } }, '我加的'));
      const shown = this.shown;
      const ROW = 56;
      const header = h('div', null,
        h('div', { class: 'nav-title-large', style: { padding: '0 0 10px' } }, '單字本'),
        h('div', { class: 'search-field', style: { margin: '0 0 18px' } }, icon('magnifyingglass', 17),
          h('input', { key: 'search', placeholder: '找單字', value: this.search, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', type: 'search',
            oninput: e => { this.search = e.target.value; SW.resetVirtual(this, 'bank'); this.update(); } })),
        addSection, seg);
      const list = virtual(this, 'bank', shown.length, ROW, 1, r => this.row(shown[r], ROW, r === 0, r === shown.length - 1),
        { header, style: { padding: '0 20px' }, bottom: 40 });
      return h('div', { class: 'col', style: { position: 'absolute', inset: 0 } },
        h('div', { class: 'row', style: { padding: '14px 20px 0', flex: 'none' } },
          h('div', { class: 'spacer' }),
          h('button', { class: 'nav-btn strong', onclick: () => this.onDone() }, '好了')),
        list);
    }

    row(w, height, first, last) {
      const open = this.swiped === w.id;
      const actions = [];
      if (w.isCustom) actions.push(h('button', { style: { background: Theme.bad }, onclick: () => { this.swiped = null; this.store.delete(new Set([w.id])); } }, icon('trash.fill', 20), '刪除'));
      actions.push(h('button', { style: { background: Theme.starDeep }, onclick: () => { this.swiped = null; this.update(); SW.presentSheet(new EditSheet(this.store, w), { size: 'medium' }); } }, icon('pencil', 20), '改'));
      const shift = open ? actions.length * 80 : 0;
      const content = h('div', {
        class: 'swipe-content ios-row', style: { transform: `translateX(${-shift}px)`, height, minHeight: height },
        mount: el => swipeable(el, () => { this.swiped = w.id; this.update(); }, () => { if (this.swiped === w.id) { this.swiped = null; this.update(); } }),
      },
      h('button', { class: 'press', style: { color: Theme.starDeep }, onclick: () => Speaker.say(w.english), 'aria-label': '念' }, icon('speaker.wave.2.fill', 20)),
      h('button', { class: 'press row', style: { gap: 14, minWidth: 0, overflow: 'hidden' }, onclick: () => SW.showWordInfo(this.store, w.english) },
        h('span', { class: 'title3 semibold', style: { whiteSpace: 'nowrap' } }, w.english),
        h('span', { class: 'soft', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, w.chinese)),
      h('div', { class: 'spacer' }),
      w.correct + w.wrong > 0 ? h('div', { class: 'row subheadline semibold mono-digits', style: { gap: 4 } },
        icon('star.fill', 15, Theme.star), h('span', null, String(w.correct)),
        w.wrong > 0 ? [h('span', { style: { paddingLeft: 6, display: 'inline-flex' } }, icon('xmark', 13, Theme.bad)), h('span', null, String(w.wrong))] : null) : null,
      h('span', { class: 'caption semibold', style: { padding: '4px 10px', borderRadius: 999, background: w.isCustom ? Theme.a('star', 0.5) : Theme.sky, whiteSpace: 'nowrap' } }, w.category));
      return h('div', {
        key: 'w-' + w.id, class: 'swipe-row',
        style: { height, background: '#fff', borderTopLeftRadius: first ? 12 : 0, borderTopRightRadius: first ? 12 : 0, borderBottomLeftRadius: last ? 12 : 0, borderBottomRightRadius: last ? 12 : 0, borderTop: first ? 'none' : '1px solid rgba(60,60,67,.1)' },
      }, h('div', { class: 'swipe-actions' }, actions), content);
    }
  }
  SW.WordBankView = WordBankView;

  /// 往左滑出「改」「刪除」（swipeActions）
  function swipeable(el, onOpen, onClose) {
    let x0 = null, y0 = null, dx = 0, moved = false;
    el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false; });
    el.addEventListener('pointermove', e => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      if (!moved && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(e.clientY - y0)) moved = true;
    });
    el.addEventListener('pointerup', () => {
      if (x0 == null) return;
      x0 = null;
      if (moved) { if (dx < -40) onOpen(); else if (dx > 20) onClose(); }
    });
    el.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  }

  // MARK: - 一次貼很多（PasteSheet）

  class PasteSheet extends SW.Component {
    constructor(store) { super(); this.store = store; this.text = ''; this.added = null; }
    render() {
      return h('div', { class: 'col', style: { position: 'absolute', inset: 0 } },
        h('div', { class: 'row', style: { position: 'relative', padding: '18px 20px 6px', flex: 'none' } },
          h('button', { class: 'nav-btn', onclick: () => SW.dismissComp(this) }, '關掉'),
          h('div', { class: 'nav-title-inline' }, '一次貼很多'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'nav-btn strong', disabled: !this.text, onclick: () => { this.added = this.store.addMany(this.text); if (this.added > 0) this.text = ''; this.update(); } }, '加進去')),
        h('div', { class: 'col', style: { gap: 12, padding: 24, flex: '1 1 0', minHeight: 0 } },
          h('textarea', { key: 'paste', class: 'title3', value: this.text, placeholder: 'apple 蘋果\nbanana 香蕉', style: { flex: '1 1 0', padding: 20, borderRadius: 18, width: '100%' },
            oninput: e => { this.text = e.target.value; this.update(); } }),
          this.added != null ? h('div', { class: 'semibold', style: { color: Theme.good } }, `加了 ${this.added} 個`) : null));
    }
  }

  // MARK: - 改字（EditSheet）

  class EditSheet extends SW.Component {
    constructor(store, word) { super(); this.store = store; this.word = { ...word }; }
    render() {
      return h('div', { class: 'col', style: { position: 'absolute', inset: 0 } },
        h('div', { class: 'row', style: { position: 'relative', padding: '18px 20px 6px', flex: 'none' } },
          h('button', { class: 'nav-btn', onclick: () => SW.dismissComp(this) }, '取消'),
          h('div', { class: 'nav-title-inline' }, this.word.english),
          h('div', { class: 'spacer' }),
          h('button', { class: 'nav-btn strong', onclick: () => { this.store.update(this.word); SW.dismissComp(this); } }, '存')),
        h('div', { class: 'ios-list', style: { paddingTop: 20 } }, h('div', { class: 'ios-section' },
          h('div', { class: 'ios-row' }, h('input', { key: 'en', class: 'text-field body', placeholder: '英文', value: this.word.english, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', oninput: e => { this.word.english = e.target.value; this.update(); } })),
          h('div', { class: 'ios-row' }, h('input', { key: 'zh', class: 'text-field body', placeholder: '中文', value: this.word.chinese, oninput: e => { this.word.chinese = e.target.value; } })))));
    }
  }

  // MARK: - 拍照加字（ScanSheet）

  const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let tesseractLoading = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tesseractLoading) {
      tesseractLoading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = TESSERACT;
        s.onload = () => res(window.Tesseract);
        s.onerror = () => { tesseractLoading = null; rej(new Error('讀不到 tesseract.js')); };
        document.head.appendChild(s);
      });
    }
    return tesseractLoading;
  }

  /// 讀出一張圖上的每一行（由上往下）；langs 例如 'chi_tra+eng'
  async function ocrLines(image, langs) {
    const T = await loadTesseract();
    const worker = await T.createWorker(langs);
    try {
      const { data } = await worker.recognize(image);
      const lines = (data.lines || []).slice().sort((a, b) => {
        const ra = a.bbox, rb = b.bbox;
        const ha = ra.y1 - ra.y0, hb = rb.y1 - rb.y0;
        const ma = (ra.y0 + ra.y1) / 2, mb = (rb.y0 + rb.y1) / 2;
        if (Math.abs(ma - mb) > Math.max(ha, hb) * 0.5) return ma - mb;
        return ra.x0 - rb.x0;
      });
      // 中文字中間 tesseract 常插空格，拿掉 CJK 之間的空白
      return lines.map(l => l.text.replace(/\n/g, ' ').trim().replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, '$1')).filter(x => x);
    } finally {
      await worker.terminate();
    }
  }
  SW.ocrLines = ocrLines;

  class ScanSheet extends SW.Component {
    constructor(store) {
      super();
      this.store = store;
      this.image = null;
      this.hits = [];
      this.picked = new Set();
      this.scanning = false;
      this.hideEasy = true;
      this.added = null;
      this.failed = false;
    }

    get owned() { return new Set(this.store.customWords.map(w => w.english.toLowerCase())); }
    get shown() {
      const junior = SW.Levels.indexOf('junior');
      // 頁面上有中文的是老師列的，不管多簡單都留著
      return this.hits.filter(h => !this.hideEasy || h.fromPage || SW.Levels.indexOf(h.level || 'junior') >= junior);
    }
    get readyCount() { return this.hits.filter(h => this.picked.has(h.id) && h.chinese.trim() !== '').length; }
    get allShownPicked() {
      const owned = this.owned;
      const can = this.shown.filter(h => !owned.has(h.english.toLowerCase()));
      return can.length > 0 && can.every(h => this.picked.has(h.id));
    }

    render() {
      const nav = h('div', { class: 'row', style: { position: 'relative', padding: '18px 20px 6px', flex: 'none' } },
        h('button', { class: 'nav-btn', onclick: () => SW.dismissComp(this) }, '關掉'),
        h('div', { class: 'nav-title-inline' }, '拍照加字'),
        h('div', { class: 'spacer' }),
        this.image ? h('button', { class: 'nav-btn', onclick: () => { this.image = null; this.hits = []; this.picked = new Set(); this.added = null; this.update(); } }, '換一張') : null);
      return h('div', { class: 'col', style: { position: 'absolute', inset: 0 } }, nav, this.image ? this.results() : this.sources());
    }

    sources() {
      const card = (title, iconName, color, capture) => h('label', {
        class: 'press col center', style: { gap: 18, width: 260, height: 220, borderRadius: 32, background: color, cursor: 'pointer' },
      }, icon(iconName, 56), h('span', { style: { fontSize: 30, fontWeight: 700 } }, title),
      h('input', { type: 'file', accept: 'image/*', capture: capture ? 'environment' : null, style: { display: 'none' }, onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.load(f); } }));
      return h('div', { class: 'row center', style: { gap: 24, padding: 40, flex: '1 1 0' } },
        card('拍照', 'camera.fill', Theme.star, true),
        card('從相簿選', 'photo.on.rectangle', Theme.sky, false));
    }

    results() {
      const owned = this.owned;
      const shown = this.shown;
      return h('div', { class: 'col', style: { flex: '1 1 0', minHeight: 0 } },
        h('div', { class: 'row', style: { gap: 16, padding: '16px 24px', flex: 'none' } },
          h('img', { src: this.image, style: { width: 84, height: 84, objectFit: 'cover', borderRadius: 14 } }),
          this.scanning ? [h('div', { class: 'spinner' }), h('span', { class: 'title3 semibold soft' }, '讀取中…')]
            : [h('span', { class: 'title3 bold' }, `找到 ${shown.length} 個`),
              h('div', { class: 'spacer' }),
              h('span', { class: 'headline' }, '藏簡單的'),
              h('button', { class: ['toggle', this.hideEasy ? 'on' : ''], 'aria-pressed': this.hideEasy ? 'true' : 'false', onclick: () => { this.hideEasy = !this.hideEasy; this.update(); } }),
              h('button', { class: 'nav-btn strong', style: { paddingLeft: 12 }, onclick: () => this.toggleAll() }, this.allShownPicked ? '全不選' : '全選')]),
        h('div', { class: 'scroll ios-list', style: { flex: '1 1 0', minHeight: 0 } },
          shown.length ? h('div', { class: 'ios-section' }, shown.map(hit => this.row(hit, owned))) : null),
        h('div', { class: 'row', style: { padding: '16px 24px', flex: 'none' } },
          this.added != null ? h('span', { class: 'title3 bold', style: { color: Theme.good } }, `加了 ${this.added} 個`) : null,
          h('div', { class: 'spacer' }),
          h('button', { class: 'press pill keep-opacity', disabled: this.readyCount === 0, onclick: () => this.addPicked(),
            style: { minWidth: 240, minHeight: 60, background: this.readyCount > 0 ? Theme.star : Theme.a('soft', 0.2), boxShadow: 'none' } },
          SW.label(`加進單字本 ${this.readyCount} 個`, 'plus'))));
    }

    row(hit, owned) {
      const have = owned.has(hit.english.toLowerCase());
      const on = this.picked.has(hit.id);
      return h('div', { class: 'ios-row', key: 'h-' + hit.id, style: { gap: 14, opacity: have ? 0.5 : 1 } },
        h('button', { class: 'press', onclick: () => { if (have) return; if (on) this.picked.delete(hit.id); else this.picked.add(hit.id); this.update(); }, 'aria-label': on ? '取消勾選' : '勾選' },
          icon(have ? 'checkmark.circle' : on ? 'checkmark.circle.fill' : 'circle', 28, have ? Theme.a('soft', 0.4) : on ? Theme.starDeep : Theme.soft)),
        h('button', { class: 'press', style: { color: Theme.starDeep }, onclick: () => Speaker.say(hit.english), 'aria-label': '念' }, icon('speaker.wave.2.fill', 20)),
        h('button', { class: 'press title3 semibold', style: { minWidth: 160, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden' }, onclick: () => SW.showWordInfo(this.store, hit.english) }, hit.english),
        h('input', { key: 'zh-' + hit.id, class: 'text-field title3', placeholder: '中文', value: hit.chinese, style: { color: Theme.soft, flex: '1 1 0' }, oninput: e => { hit.chinese = e.target.value; this.update(); } }),
        hit.levelLabel ? h('span', { class: 'caption semibold', style: { padding: '4px 10px', borderRadius: 999, background: Theme.sky, whiteSpace: 'nowrap' } }, hit.levelLabel) : null,
        have ? h('span', { class: 'caption semibold soft', style: { whiteSpace: 'nowrap' } }, '已經有了') : null);
    }

    toggleAll() {
      const owned = this.owned;
      const can = this.shown.filter(h => !owned.has(h.english.toLowerCase()));
      if (this.allShownPicked) for (const h of can) this.picked.delete(h.id);
      else for (const h of can) this.picked.add(h.id);
      this.update();
    }

    async load(file) {
      this.image = URL.createObjectURL(file);
      this.hits = [];
      this.added = null;
      this.scanning = true;
      this.update();
      let found = [];
      try {
        // 先抓單字表的「英文 中文」那種行，頁面上的中文最準；再抓英文句子裡的每個字
        const pairLines = await ocrLines(file, 'chi_tra+eng');
        const engLines = await ocrLines(file, 'eng');
        found = SW.WordScanner.collect(pairLines, engLines);
      } catch (e) {
        found = [];
      }
      if (this.dead) return;
      this.hits = found;
      const owned = this.owned;
      // 單字表上老師列的先幫她勾好
      this.picked = new Set(found.filter(h => h.fromPage && !owned.has(h.english.toLowerCase())).map(h => h.id));
      this.scanning = false;
      this.update();
    }

    addPicked() {
      let n = 0;
      for (const hit of this.hits) if (this.picked.has(hit.id) && this.store.add(hit.english, hit.chinese)) n += 1;
      this.picked = new Set();
      this.added = n;
      this.update();
    }
  }
  SW.ScanSheet = ScanSheet;
})();
