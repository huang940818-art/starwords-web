// 首頁（HomeView.swift）＋今日目標（GoalChip）＋設定（匯出／匯入備份）
(function () {
  'use strict';
  const SW = window.SW;
  const { h, icon, Theme, Speaker, Lexicon, Data, GameMode, ToeicPart } = SW;

  const roundSize = 10;
  const sameDeck = (a, b) => a.kind === b.kind && a.level === b.level && a.name === b.name;
  const deckTitle = d => d.kind === 'all' ? '全部' : d.kind === 'custom' ? '我加的' : d.kind === 'category' ? d.name : SW.LevelTitle[d.level];

  class HomeView extends SW.Component {
    constructor(store, essays) {
      super();
      this.store = store;
      this.essays = essays;
      this.goalBurst = 0;
      store.listeners.add(() => { this.update(); this.celebrateGoal(); });
      SW.onStackChange(() => { this.update(); this.celebrateGoal(); });
    }

    get homeVisible() { return SW.layerCount() === 0; }

    celebrateGoal() {
      if (!this.store.goalJustMet || !this.homeVisible) return;
      this.store.goalJustMet = false;
      // 等蓋著的畫面收完再放
      this.after(450, () => {
        SW.haptic('success');
        this.goalBurst += 1;
        const star = this.el.querySelector('[data-goal-star]');
        if (star) SW.starBurst(star, 0.7);
        Speaker.say('Great job!');
        this.update();
        this.after(1400, () => { this.goalBurst = 0; this.update(); });
      });
    }

    render() {
      return [SW.background(), h('div', { class: 'scroll', 'data-scroll': 'home', style: { position: 'absolute', inset: 0 } },
        h('div', { class: 'col', style: { gap: 32, padding: 40, maxWidth: 1000, margin: '0 auto' } },
          this.header(),
          this.sectionTitle('單字'),
          this.deckPicker(),
          this.games(),
          h('div', { class: 'row', style: { gap: 20 } }, this.bankButton(), this.lexiconButton()),
          this.sectionTitle('句子和文法'),
          h('div', { class: 'row', style: { gap: 24 } },
            ['arrange', 'sentence', 'dictation'].map(m => this.card(GameMode.title[m], GameMode.icon[m], Theme[GameMode.color[m]], 200, () => this.start(m))),
            this.card('文法', 'checklist', Theme.sky, 200, () => this.launchGrammar())),
          this.sectionTitle('多益練習'),
          h('div', { class: 'row', style: { gap: 24 } },
            [['response', Theme.sky], ['conversation', Theme.lilac], ['completion', Theme.mint]].map(([p, c]) =>
              this.card(ToeicPart.title[p], ToeicPart.icon[p], c, 180, () => this.openToeic(p)))),
          this.sectionTitle('寫作'),
          this.listButton('doc.richtext.fill', '寫文章', `${Data.articles.length} 篇`, Theme.lilac, () => this.openWriting())))];
    }

    header() {
      return h('div', { class: 'row', style: { gap: 20 } },
        icon('star.fill', 56, Theme.star),
        h('div', { style: { fontSize: 48, fontWeight: 800, whiteSpace: 'nowrap' } }, '星星單字'),
        h('div', { class: 'spacer' }),
        this.goalChip(),
        this.starChip('全部', this.store.totalStars),
        h('button', { class: 'press circle-btn', 'aria-label': '設定', onclick: () => SW.presentSheet(new SettingsSheet(this.store), { size: 'medium' }) }, icon('gearshape.fill', 22, Theme.soft)));
    }

    starChip(title, value) {
      return h('div', { class: 'row', style: { gap: 8, padding: '10px 18px', borderRadius: 999, background: '#fff' } },
        icon('star.fill', 20, Theme.star),
        h('div', { class: 'col' },
          h('span', { class: 'caption semibold soft' }, title),
          h('span', { class: 'title2 heavy mono-digits', style: { lineHeight: 1.1 } }, String(value))));
    }

    /// 首頁的今日目標：星星照進度從下往上填，滿了就亮；旁邊是連續幾天
    goalChip() {
      const s = this.store;
      const done = s.todayAnswered, goal = s.dailyGoal, met = s.goalMetToday;
      const fraction = Math.min(done / Math.max(goal, 1), 1);
      return h('button', {
        class: 'press row', style: { gap: 12, padding: '10px 18px', borderRadius: 999, background: met ? Theme.a('star', 0.35) : '#fff' },
        onclick: e => this.goalPicker(e.currentTarget), 'aria-label': '今天目標',
      },
      h('span', { 'data-goal-star': '1', style: { position: 'relative', width: 34, height: 34, display: 'inline-block', transform: met ? 'scale(1.12)' : 'none', transition: 'transform .4s cubic-bezier(.3,1.9,.5,1)' } },
        h('span', { style: { position: 'absolute', inset: 0 } }, icon('star.fill', 34, Theme.a('soft', 0.2))),
        h('span', { style: { position: 'absolute', inset: 0, clipPath: `inset(${(1 - fraction) * 100}% 0 0 0)` } }, icon('star.fill', 34, Theme.star))),
      h('div', { class: 'col', style: { alignItems: 'flex-start' } },
        h('span', { class: 'caption semibold soft' }, '今天'),
        h('div', { class: 'row mono-digits', style: { gap: 2, alignItems: 'baseline' } },
          h('span', { class: 'title2 heavy', style: { lineHeight: 1.1 } }, String(done)),
          h('span', { class: 'headline soft' }, `/${goal}`))),
      h('span', { style: { width: 1.5, height: 34, background: Theme.a('soft', 0.25) } }),
      h('div', { class: 'col', style: { alignItems: 'flex-start' } },
        h('span', { class: 'caption semibold soft' }, '連續'),
        h('div', { class: 'row mono-digits', style: { gap: 2, alignItems: 'baseline' } },
          h('span', { class: 'title2 heavy', style: { lineHeight: 1.1 } }, String(s.streak)),
          h('span', { class: 'headline soft' }, '天'))));
    }

    goalPicker(anchor) {
      SW.popover(anchor, close => h('div', { class: 'col', style: { gap: 14, padding: 22, alignItems: 'center' } },
        h('div', { class: 'headline' }, '一天幾題'),
        h('div', { class: 'row', style: { gap: 10 } }, [10, 20, 30, 50].map(n => h('button', {
          class: 'press title3 bold', style: { width: 64, height: 52, borderRadius: 999, background: n === this.store.dailyGoal ? Theme.star : Theme.cream },
          onclick: () => { this.store.setGoal(n); close(); },
        }, String(n))))));
    }

    get decks() {
      return [{ kind: 'all' }, { kind: 'custom' }].concat(SW.Levels.map(l => ({ kind: 'level', level: l })));
    }

    deckCount(d) {
      if (d.kind === 'level') {
        const extra = d.level === 'elementary' ? this.store.words.filter(w => !w.isCustom && !Lexicon.keys.has(w.english.toLowerCase())).length : 0;
        return Lexicon.entries(d.level).length + extra;
      }
      if (d.kind === 'all') {
        return SW.Levels.filter(l => l !== 'university').map(l => this.deckCount({ kind: 'level', level: l })).reduce((a, b) => a + b, 0) + this.store.customWords.length;
      }
      return this.store.pool(d).length;
    }

    deckPicker() {
      return h('div', { class: 'hscroll', 'data-scroll': 'decks', style: { margin: '0 -4px' } },
        h('div', { class: 'row', style: { gap: 10, padding: '4px', width: 'max-content' } }, this.decks.map(d => h('button', {
          class: 'press headline', onclick: () => { this.store.deck = d; this.update(); },
          style: { padding: '12px 18px', borderRadius: 999, background: sameDeck(this.store.deck, d) ? Theme.star : '#fff', whiteSpace: 'pre' },
        }, `${deckTitle(d)}  ${this.deckCount(d)}`))));
    }

    games() {
      const empty = this.store.pool(this.store.deck).length === 0;
      return h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 } },
        GameMode.wordModes.map(m => this.card(GameMode.title[m], GameMode.icon[m], Theme[GameMode.color[m]], 220, () => this.start(m), empty)));
    }

    card(title, iconName, color, height, action, disabled) {
      return h('button', {
        class: 'press col', onclick: action, disabled: !!disabled, 'aria-label': title,
        style: {
          flex: '1 1 0', minWidth: 0, gap: 18, padding: 28, minHeight: height, alignItems: 'flex-start', textAlign: 'left',
          borderRadius: 32, background: color, boxShadow: '0 7px 0 var(--shadow)', opacity: disabled ? 0.4 : 1,
        },
      }, icon(iconName, 44, Theme.a('ink', 0.8)), h('div', { class: 'spacer' }), h('span', { style: { fontSize: 30, fontWeight: 700 } }, title));
    }

    listButton(iconName, title, count, color, action) {
      return h('button', {
        class: 'press row', onclick: action,
        style: { flex: '1 1 0', minWidth: 0, gap: 14, padding: 24, borderRadius: 28, background: color },
      }, icon(iconName, 28), h('span', { class: 'title2 bold', style: { whiteSpace: 'nowrap' } }, title), h('div', { class: 'spacer' }),
      h('span', { class: 'soft', style: { whiteSpace: 'nowrap' } }, count), icon('chevron.right', 18, Theme.soft));
    }

    bankButton() {
      return this.listButton('book.fill', '單字本', `${this.store.words.length} 個字`, '#fff', () => {
        const comp = new SW.WordBankView(this.store, () => SW.dismissComp(comp));
        SW.presentSheet(comp, { size: 'page' });
      });
    }

    lexiconButton() {
      return this.listButton('books.vertical.fill', '單字庫', `${Lexicon.all.length} 個字`, Theme.sky, () => {
        const comp = new SW.LexiconView(this.store, l => {
          this.store.deck = { kind: 'level', level: l };
          SW.dismissComp(comp);
        }, () => SW.dismissComp(comp));
        SW.presentCover(comp);
      });
    }

    sectionTitle(t) {
      return h('div', { style: { fontSize: 28, fontWeight: 800, marginBottom: -16 } }, t);
    }

    pickWords(mode) {
      const s = this.store;
      if (mode === 'arrange') {
        // 兩個字以下的句子沒什麼好排
        return s.pick(roundSize, s.sentences.filter(w => w.english.split(' ').filter(x => x).length >= 3));
      }
      if (mode === 'sentence' || mode === 'dictation') return s.pick(roundSize, s.sentences);
      return s.pick(roundSize, s.pool(s.deck));
    }

    start(mode) {
      const comp = new SW.GameView(this.store, mode, this.pickWords(mode), () => this.pickWords(mode), () => SW.dismissComp(comp));
      SW.presentCover(comp);
    }

    launchGrammar() {
      const comp = new SW.GrammarGameView(this.store, this.store.pickGrammar(roundSize), () => this.store.pickGrammar(roundSize), () => SW.dismissComp(comp));
      SW.presentCover(comp);
    }

    openToeic(part) {
      const comp = new SW.ToeicView(this.store, part, () => SW.dismissComp(comp));
      SW.presentCover(comp);
    }

    openWriting() {
      const comp = new SW.ArticleListView(this.store, this.essays, () => SW.dismissComp(comp));
      SW.presentCover(comp);
    }
  }
  SW.HomeView = HomeView;

  // MARK: - 設定：匯出備份／匯入備份（格式跟 App 的 starwords.json 一樣）

  class SettingsSheet extends SW.Component {
    constructor(store) { super(); this.store = store; this.message = null; }
    render() {
      const row = (title, iconName, action, input) => h(input ? 'label' : 'button', {
        class: 'ios-row', style: { gap: 12, width: '100%', color: Theme.starDeep, fontSize: 17, cursor: 'pointer' }, onclick: action,
      }, icon(iconName, 22), h('span', null, title), input || null);
      return h('div', { class: 'col', style: { position: 'absolute', inset: 0 } },
        h('div', { class: 'row', style: { position: 'relative', padding: '18px 20px 6px', flex: 'none' } },
          h('div', { class: 'nav-title-inline' }, '設定'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'nav-btn strong', onclick: () => SW.dismissComp(this) }, '好了')),
        h('div', { class: 'ios-list', style: { paddingTop: 24 } },
          h('div', { class: 'ios-section' },
            row('匯出備份', 'square.and.arrow.up', () => this.exportFile()),
            row('匯入備份', 'square.and.arrow.down', null, h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onchange: e => this.importFile(e) }))),
          this.message ? h('div', { class: 'semibold', style: { color: this.message.ok ? Theme.good : Theme.bad, padding: '0 16px' } }, this.message.text) : null));
    }

    exportFile() {
      const blob = new Blob([this.store.serialize()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'starwords.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    importFile(e) {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      f.text().then(text => {
        try {
          this.store.importFile(text);
          this.message = { ok: true, text: '匯入好了' };
        } catch (err) {
          this.message = { ok: false, text: '讀不進來' };
        }
        this.update();
      });
    }
  }
  SW.SettingsSheet = SettingsSheet;
})();
