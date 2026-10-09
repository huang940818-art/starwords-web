// 單字和句子的玩法（GameView.swift）
(function () {
  'use strict';
  const SW = window.SW;
  const { h, icon, Theme, Speaker, PaperMetrics, Recognizer, SentenceDiff, Synonyms, PenaltyKind } = SW;

  const GameMode = {
    wordModes: ['listen', 'chinese', 'choice', 'trace'],
    title: { listen: '聽音寫字', chinese: '看中文寫英文', choice: '四選一', trace: '描字練習', arrange: '排句子', sentence: '寫句子', dictation: '聽寫整句' },
    icon: {
      listen: 'ear.fill', chinese: 'character.book.closed.fill', choice: 'square.grid.2x2.fill', trace: 'pencil.and.scribble',
      arrange: 'text.word.spacing', sentence: 'text.line.first.and.arrowtriangle.forward', dictation: 'headphones',
    },
    color: { listen: 'sky', chinese: 'peach', choice: 'mint', trace: 'lilac', arrange: 'mint', sentence: 'peach', dictation: 'lilac' },
    writes: m => m !== 'choice' && m !== 'arrange',
    /// 整句寫的玩法，錯了逐字標
    wholeSentence: m => m === 'sentence' || m === 'dictation',
  };
  SW.GameMode = GameMode;

  const shuffle = a => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  };
  SW.shuffle = shuffle;
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  SW.sameArray = same;

  class GameView extends SW.Component {
    constructor(store, mode, words, nextRound, onClose) {
      super();
      this.store = store;
      this.mode = mode;
      this.words = words;
      this.nextRound = nextRound;
      this.onClose = onClose;
      this.index = 0;
      this.drawing = [];
      this.canvasGen = 0;
      this.feedback = { type: 'none' };
      this.results = {};
      this.checking = false;
      this.tracing = true;
      this.choices = [];
      this.picked = null;
      this.flying = null;
      this.bump = null;
      this.finished = false;
      this.hintLevel = 0;
      this.tiles = [];
      this.placed = [];
      this.penalty = false;
      this.penaltyDone = false;
      this.acceptedAlt = null;
      this.questionID = 0;
      this.marks = [];
      this.area = { w: 0, h: 0 };
      this.prepare();
      this.prefListener = () => this.update();
      SW.Prefs.listeners.add(this.prefListener);
    }

    get word() { return this.words[this.index]; }
    get paperHeight() { return Math.max(240, Math.min(340, window.innerHeight * 0.3)); }

    /// 單字的玩法答完會出例句；句子本身就是例句
    get example() { return GameMode.wordModes.includes(this.mode) ? this.store.example(this.word) : null; }
    get answered() { return this.feedback.type !== 'none' || this.picked != null; }
    get isCorrect() { return this.feedback.type === 'correct'; }
    get maxHint() { return this.mode === 'listen' || this.mode === 'dictation' ? 2 : 1; }
    get showGhost() { return (this.mode === 'trace' && this.tracing) || this.feedback.type === 'gaveUp'; }
    get padKey() { return `${this.questionID}-${this.canvasGen}`; }

    /// 程式改畫布（擦掉、換題）一律換一張新的畫布：舊畫布晚到的筆畫不能寫回來
    setDrawing(d) {
      this.drawing = d;
      this.canvasGen += 1;
    }

    onDestroy() {
      Speaker.stop();
      SW.Prefs.listeners.delete(this.prefListener);
      if (this.penaltyComp) this.penaltyComp.destroy();
    }

    showWord(token) { SW.showWordInfo(this.store, token); }

    // MARK: - 畫面

    render() {
      let content;
      if (this.penalty) {
        content = this.penaltySlot();
      } else if (this.finished) {
        content = h('div', { key: 'summary', class: 'col center', style: { position: 'absolute', inset: 0 }, enter: 'fade' }, this.summary());
      } else {
        content = h('div', { key: 'play', class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px', gap: 24 } },
          this.topBar(),
          h('div', {
            class: 'scroll', key: 'area', 'data-scroll': 'game', style: { flex: '1 1 0', position: 'relative', minHeight: 0, overflowX: 'hidden' },
            mount: SW.measure('area', (w, hh) => { this.area = { w, h: hh }; this.update(); }),
          }, h('div', {
            key: 'q' + this.questionID, enter: this.questionID > 1 ? 'slide' : null, leave: 'slide',
            class: 'col', style: { minHeight: this.area.h || '100%', gap: 24, alignItems: 'center', width: '100%' },
          },
          h('div', { class: 'spacer' }),
          this.prompt(),
          this.exampleCard(),
          h('div', { class: 'spacer' }),
          GameMode.writes(this.mode) ? [this.paper(), this.writeButtons()] : this.mode === 'arrange' ? this.arrangeBoard() : this.choiceGrid(),
          h('div', { class: 'spacer' }))));
      }
      return [SW.background(), content];
    }

    topBar() {
      return h('div', { class: 'row', style: { gap: 8, flex: 'none' } },
        SW.closeButton(() => this.onClose()),
        h('div', { class: 'spacer' }),
        SW.starRow(this.words.map(w => w.id), this.index, this.results, this.flying, this.bump),
        h('div', { class: 'spacer' }),
        GameMode.writes(this.mode) ? SW.penButton(() => this.update()) : null,
        h('div', { class: 'tag-capsule', style: { background: Theme[GameMode.color[this.mode]] } }, GameMode.title[this.mode]));
    }

    prompt() {
      const w = this.word, m = this.mode;
      const parts = [];
      const fb = this.feedback.type;
      if (m === 'listen' || m === 'dictation') {
        parts.push(h('div', { class: 'row', style: { gap: 20 } },
          SW.speakButton(96, false, () => Speaker.say(w.english)),
          SW.speakButton(64, true, () => Speaker.say(w.english, true))));
        if (fb !== 'none') parts.push(this.answerReveal());
        else {
          if (this.hintLevel >= 1) parts.push(h('div', { class: 'text-center', style: { fontSize: 40, fontWeight: 700 }, enter: 'fade' }, w.chinese));
          if (this.hintLevel >= 2) parts.push(this.letterHint());
        }
      } else if (m === 'chinese' || m === 'sentence' || m === 'arrange') {
        parts.push(h('div', { class: 'text-center', style: { fontSize: m === 'chinese' ? 64 : 46, fontWeight: 700 } }, w.chinese));
        if (m !== 'chinese') {
          parts.push(h('div', { class: 'row', style: { gap: 16 } },
            SW.speakButton(56, false, () => Speaker.say(w.english)),
            SW.speakButton(44, true, () => Speaker.say(w.english, true))));
        }
        if (m !== 'arrange') {
          if (fb !== 'none') parts.push(this.answerReveal());
          else if (this.hintLevel >= 1) parts.push(this.letterHint());
        }
      } else if (m === 'choice') {
        parts.push(h('div', { class: 'row', style: { gap: 16, maxWidth: '100%' } },
          // 答完才能點開單字卡，不然等於直接看答案
          h('button', { class: 'press', style: { fontSize: 72, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }, onclick: () => { if (this.answered) this.showWord(w.english); } },
            fitText(w.english, 72, Math.max(200, (this.area.w || 900) - 90))),
          SW.speakButton(56, false, () => Speaker.say(w.english))));
      } else if (m === 'trace') {
        parts.push(h('div', { class: 'row', style: { gap: 16 } },
          h('div', { style: { fontSize: 40, fontWeight: 700 } }, w.chinese),
          SW.speakButton(56, false, () => Speaker.say(w.english))));
        parts.push(h('div', { class: 'title3 semibold soft' }, this.tracing ? '描一次' : '自己寫一次'));
      }
      return h('div', { class: 'col center', style: { gap: 14, minHeight: 180, width: '100%' } }, parts);
    }

    exampleCard() {
      if (!this.answered) return null;
      const ex = this.example;
      if (!ex) return null;
      const [en, zh] = ex;
      return h('div', {
        key: 'example', enter: 'fadedown', class: 'row',
        style: { gap: 14, padding: '14px 22px', maxWidth: 820, width: '100%', background: Theme.a('star', 0.22), borderRadius: 22 },
      },
      h('div', { class: 'col', style: { gap: 4, flex: '1 1 0', minWidth: 0 } },
        SW.tappableText(en, { size: 26, highlight: this.word.english }, t => this.showWord(t)),
        zh ? h('div', { class: 'title3 soft' }, zh) : null),
      SW.speakButton(48, false, () => Speaker.say(en), { noShadow: true, iconSize: 22 }));
    }

    answerReveal() {
      const w = this.word;
      const kids = [];
      if (GameMode.wholeSentence(this.mode)) {
        kids.push(SW.tappableText(w.english, { size: 40, weight: 700, centered: true }, t => this.showWord(t)));
      } else {
        kids.push(h('button', { class: 'press', style: { fontSize: 52, fontWeight: 700, color: this.isCorrect ? Theme.good : Theme.ink, whiteSpace: 'nowrap' }, onclick: () => this.showWord(w.english) },
          fitText(w.english, 52, Math.max(200, (this.area.w || 900) - 40))));
      }
      if (this.mode === 'listen' || this.mode === 'dictation') kids.push(h('div', { class: 'title2 soft' }, w.chinese));
      if (this.acceptedAlt && this.isCorrect) kids.push(h('div', { class: 'title3 semibold', style: { color: Theme.good } }, `${this.acceptedAlt} 也對`));
      return h('div', { key: 'reveal', enter: 'scale', class: 'col text-center', style: { gap: 4, alignItems: 'center', width: '100%' } }, kids);
    }

    /// 第一個字母＋後面幾格，例如 t _ _ _ _
    letterHint() {
      const parts = this.word.english.split(' ').filter(x => x !== '').map(w => {
        const out = [];
        let first = true;
        for (const c of Array.from(w)) {
          if (SW.text.isLetter(c)) { out.push(first ? c : '_'); first = false; } else out.push(c);
        }
        return out.join(' ');
      });
      return h('div', { key: 'hint', enter: 'fade', style: { fontSize: 36, fontWeight: 600, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', color: Theme.starDeep, whiteSpace: 'pre-wrap', textAlign: 'center' } }, parts.join('    '));
    }

    // MARK: 寫字

    paper() {
      const ph = this.paperHeight;
      const width = this.area.w || 900;
      const m = this.showGhost || this.mode === 'trace'
        ? PaperMetrics.fitting(this.word.english, width, ph)
        : (GameMode.wholeSentence(this.mode) ? PaperMetrics(110, ph) : PaperMetrics.fitting('practice', width, ph));
      const key = this.padKey;
      return h('div', { class: ['paper', this.isCorrect ? 'disabled-ink' : ''], key: 'paper', style: { width: '100%', height: ph, flex: 'none' } },
        SW.paperSVG(m, width, this.showGhost ? this.word.english : null),
        SW.inkSlot('pad' + key, {
          strokes: this.drawing,
          disabled: () => this.isCorrect,
          // 每張畫布只能寫回自己那一題：換題時舊畫布還在滑走，它晚到的回報不能蓋掉新題目
          onChange: s => { if (key === this.padKey) { this.drawing = s; this.update(); } },
        }));
    }

    writeButtons() {
      const pill = SW.pill;
      const fb = this.feedback;
      const row = (...kids) => h('div', { class: 'row', style: { gap: 16, justifyContent: 'center', flexWrap: 'wrap' } }, kids);
      switch (fb.type) {
        case 'none': {
          const kids = [pill('擦掉', 'eraser.fill', '#fff', () => { this.setDrawing([]); this.update(); })];
          if (this.mode === 'trace' && this.tracing) {
            kids.push(pill('描好了', 'checkmark', Theme.star, () => { this.tracing = false; this.setDrawing([]); this.update(); }, { wide: true, disabled: !this.drawing.length }));
          } else {
            if (this.mode !== 'trace' && this.hintLevel < this.maxHint) {
              kids.push(pill('提示', 'softstar', '#fff', () => { this.hintLevel += 1; this.update(); }));
            }
            kids.push(pill('我不會', 'questionmark', '#fff', () => this.giveUp()));
            kids.push(pill(this.checking ? '看看你寫的…' : '檢查', 'star.fill', Theme.star, () => this.check(), { wide: true, disabled: !this.drawing.length || this.checking }));
          }
          return row(...kids);
        }
        case 'gaveUp':
          return row(pill('擦掉', 'eraser.fill', '#fff', () => { this.setDrawing([]); this.update(); }),
            pill('下一個', 'arrow.right', Theme.star, () => this.next(), { wide: true }));
        case 'correct':
          if (this.example) return row(pill('下一個', 'arrow.right', Theme.star, () => this.next(), { wide: true }));
          return h('div', { style: { height: 64, flex: 'none' } });
        case 'wrong': {
          let seen;
          if (GameMode.wholeSentence(this.mode) && this.marks.length) {
            seen = SW.wordMarks(this.marks, t => this.showWord(t));
          } else {
            seen = h('div', { class: 'row title3', style: { gap: 10, flexWrap: 'wrap', justifyContent: 'center' } },
              h('span', { class: 'soft' }, '我看到'),
              h('span', { style: { fontWeight: 600, color: Theme.bad } }, fb.read != null ? `「${fb.read}」` : '看不太出來'),
              this.mode === 'trace' ? [h('span', { class: 'soft', style: { paddingLeft: 12 } }, '答案'), h('span', { class: 'bold' }, this.word.english)] : null);
          }
          return h('div', { class: 'col', style: { gap: 14, alignItems: 'center', width: '100%' } }, seen,
            row(pill('再寫一次', 'arrow.counterclockwise', '#fff', () => { this.setDrawing([]); this.feedback = { type: 'none' }; this.update(); }),
              pill('我寫對了', 'hand.thumbsup.fill', Theme.mint, () => { this.results[this.word.id] = true; this.celebrate(true); }),
              pill('下一個', 'arrow.right', Theme.star, () => this.next())));
        }
      }
      return null;
    }

    // MARK: 排句子

    arrangeBoard() {
      const fb = this.feedback.type;
      const tileColor = fb === 'correct' ? Theme.mint : fb === 'wrong' ? Theme.a('bad', 0.3) : Theme.a('star', 0.55);
      const tile = (text, fill, action, extra = {}) => h('button', {
        class: 'press', onclick: action,
        style: { fontSize: 32, fontWeight: 600, padding: '14px 22px', borderRadius: 18, background: fill, boxShadow: '0 4px 0 var(--shadow)', whiteSpace: 'nowrap', ...extra },
      }, text);
      const kids = [h('div', {
        class: 'flow', style: { gap: 12, width: '100%', minHeight: 90 + 48, padding: 24, background: '#fff', borderRadius: 28, boxShadow: '0 6px 0 var(--shadow)', alignContent: 'center' },
      }, this.placed.map((i, pos) => tile(this.tiles[i], tileColor, () => {
        if (this.feedback.type !== 'none') return;
        this.placed.splice(pos, 1);
        this.update();
      })))];
      const pill = SW.pill;
      if (fb === 'none') {
        kids.push(h('div', { class: 'flow', style: { gap: 12, width: '100%' } }, this.tiles.map((t, i) => {
          const used = this.placed.includes(i);
          return tile(t, Theme.mint, () => {
            if (used) return;
            Speaker.say(t);
            this.placed.push(i);
            this.update();
          }, { opacity: used ? 0.2 : 1 });
        })));
        kids.push(h('div', { class: 'row', style: { gap: 16, justifyContent: 'center' } },
          pill('重排', 'arrow.counterclockwise', '#fff', () => { this.placed = []; this.update(); }),
          pill('我不會', 'questionmark', '#fff', () => this.giveUp()),
          pill('檢查', 'star.fill', Theme.star, () => this.checkArrange(), { wide: true, disabled: this.placed.length < this.tiles.length })));
      } else if (!this.isCorrect) {
        kids.push(h('div', { class: 'text-center', style: { fontSize: 40, fontWeight: 700 } }, this.word.english));
        kids.push(h('div', { class: 'row', style: { gap: 16, justifyContent: 'center' } },
          fb !== 'gaveUp' ? pill('再排一次', 'arrow.counterclockwise', '#fff', () => { this.placed = []; this.feedback = { type: 'none' }; this.update(); }) : null,
          pill('下一個', 'arrow.right', Theme.star, () => this.next(), { wide: true })));
      } else {
        kids.push(h('div', { style: { height: 64 } }));
      }
      return h('div', { class: 'col', style: { gap: 24, width: '100%', alignItems: 'center' } }, kids);
    }

    checkArrange() {
      const w = this.word;
      if (same(this.placed.map(i => this.tiles[i]), SW.arrangeTokens(w.english))) {
        const first = this.results[w.id] === undefined;
        if (first) this.results[w.id] = true;
        Speaker.say(w.english);
        this.celebrate(first);
      } else {
        if (this.results[w.id] === undefined) this.results[w.id] = false;
        SW.haptic('warning');
        Speaker.say(w.english);
        this.feedback = { type: 'wrong', read: null };
        this.update();
      }
    }

    // MARK: 四選一

    choiceGrid() {
      const w = this.word;
      const color = c => {
        if (this.picked == null) return '#fff';
        if (c === w.chinese) return Theme.mint;
        if (c === this.picked) return Theme.a('bad', 0.35);
        return Theme.white(0.6);
      };
      return h('div', { class: 'col', style: { gap: 20, width: '100%', alignItems: 'center' } },
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, width: '100%' } }, this.choices.map(c => h('button', {
          class: 'press', onclick: () => { if (this.picked == null) this.pick(c); },
          style: { fontSize: 34, fontWeight: 700, minHeight: 120, borderRadius: 28, background: color(c), boxShadow: '0 6px 0 var(--shadow)', padding: '8px 12px' },
        }, c))),
        this.picked != null && (this.picked !== w.chinese || this.example)
          ? SW.pill('下一個', 'arrow.right', Theme.star, () => this.next(), { wide: true })
          : h('div', { style: { height: 64 } }));
    }

    // MARK: 結算

    summary() {
      const got = Object.values(this.results).filter(x => x).length;
      const missed = this.missed;
      const pill = SW.pill;
      return h('div', { class: 'col', style: { gap: 28, alignItems: 'center', padding: 40, width: '100%', maxHeight: '100%' } },
        SW.bigStar(180, String(got), 64),
        h('div', { style: { fontSize: 40, fontWeight: 700 } }, got === this.words.length ? '全對！' : `拿到 ${got} 顆星星`),
        h('div', { class: 'scroll', style: { maxWidth: 760, width: '100%', maxHeight: 360, padding: '0 4px' } },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 } }, this.words.map(w => {
            const ok = this.results[w.id] === true;
            return h('div', { class: 'row', style: { gap: 10, padding: 14, background: '#fff', borderRadius: 18 } },
              icon(ok ? 'star.fill' : 'xmark.circle.fill', 20, ok ? Theme.star : Theme.bad),
              h('button', { class: 'press col', style: { gap: 2, alignItems: 'flex-start', flex: '1 1 0', minWidth: 0, textAlign: 'left' }, onclick: () => this.showWord(w.english) },
                h('span', { class: 'headline' }, w.english),
                h('span', { class: 'subheadline soft' }, w.chinese)),
              h('button', { class: 'press', style: { color: Theme.starDeep }, onclick: () => Speaker.say(w.english), 'aria-label': '念' }, icon('speaker.wave.2.fill', 20)));
          }))),
        missed.length && !this.penaltyDone
          ? pill(PenaltyKind.button(PenaltyKind.of(this.mode), missed.length), 'pencil.line', Theme.peach, () => { this.penalty = true; this.update(); }, { wide: true })
          : h('div', { class: 'row', style: { gap: 16 } },
            pill('回首頁', 'house.fill', '#fff', () => this.onClose()),
            pill('下一輪', 'arrow.right', Theme.star, () => this.restart(), { wide: true })));
    }

    get missed() {
      return this.words.filter(w => this.results[w.id] !== true).map(w => ({ id: w.id, english: w.english, chinese: w.chinese }));
    }

    penaltySlot() {
      if (!this.penaltyComp) {
        this.penaltyComp = SW.makePenalty(this.store, PenaltyKind.of(this.mode), this.missed, () => {
          this.penaltyComp.destroy();
          this.penaltyComp = null;
          this.penalty = false;
          this.penaltyDone = true;
          this.update();
        }, () => this.onClose());
      }
      const comp = this.penaltyComp;
      return h('div', { key: 'penalty', persist: true, enter: 'fade', style: { position: 'absolute', inset: 0 }, mount: el => { el.appendChild(comp.el); comp.updateNow(); if (comp.didAppear) comp.didAppear(); } });
    }

    // MARK: - 流程

    prepare() {
      this.questionID += 1;
      this.tracing = true;
      this.picked = null;
      this.setDrawing([]);
      this.feedback = { type: 'none' };
      this.hintLevel = 0;
      this.placed = [];
      this.acceptedAlt = null;
      this.marks = [];
      const w = this.word;
      if (this.mode === 'arrange') {
        const t = SW.arrangeTokens(w.english);
        let s = shuffle(t);
        if (t.length > 1) while (same(s, t)) s = shuffle(t);
        this.tiles = s;
      }
      if (this.mode === 'choice') {
        const others = [...new Set(this.store.words.map(x => x.chinese).filter(c => c !== w.chinese))];
        const set = shuffle(others).slice(0, 3);
        set.push(w.chinese);
        this.choices = shuffle(set);
      }
      if (['listen', 'choice', 'trace', 'dictation'].includes(this.mode)) {
        const id = this.questionID;
        this.after(350, () => { if (this.questionID === id) Speaker.say(w.english); });
      }
    }

    async check() {
      const w = this.word;
      const id = this.questionID;
      this.checking = true;
      this.update();
      const alts = this.mode === 'chinese' ? Synonyms.alternatives(w, this.store.words) : [];
      const ph = this.paperHeight;
      const read = await SW.Handwriting.read(this.drawing, this.area.w || 900, ph);
      if (this.dead || id !== this.questionID) return;
      this.checking = false;
      const offline = read == null;
      const cands = read || [];
      const exact = Recognizer.matches(cands, w.english);
      const alt = exact ? null : (alts.find(a => Recognizer.matches(cands, a)) || null);
      if (exact || alt) {
        this.acceptedAlt = alt;
        const first = this.results[w.id] === undefined;
        if (first) this.results[w.id] = true;
        this.celebrate(first);
      } else {
        if (this.results[w.id] === undefined) this.results[w.id] = false;
        SW.haptic('warning');
        this.speakAnswer();
        // 連不上時沒有讀法可以比，就不逐字標，讓她自己按「我寫對了」
        this.marks = GameMode.wholeSentence(this.mode) && !offline ? SentenceDiff.best(w.english, cands) : [];
        this.feedback = { type: 'wrong', read: cands.length ? cands[0] : null };
        this.update();
      }
    }

    giveUp() {
      const w = this.word;
      if (this.results[w.id] === undefined) this.results[w.id] = false;
      this.setDrawing([]);
      this.speakAnswer();
      this.feedback = { type: 'gaveUp' };
      this.update();
    }

    /// 念答案；有例句就接著念例句
    speakAnswer() {
      const ex = this.example;
      if (ex) Speaker.sayAll([this.word.english, ex[0]]);
      else Speaker.say(this.word.english);
    }

    pick(c) {
      this.picked = c;
      const w = this.word;
      if (c === w.chinese) {
        this.results[w.id] = true;
        this.celebrate(true);
      } else {
        this.results[w.id] = false;
        SW.haptic('warning');
        this.speakAnswer();
      }
      this.update();
    }

    celebrate(firstTry) {
      SW.haptic('success');
      this.feedback = { type: 'correct', firstTry };
      const ex = this.example;
      if (ex || this.mode === 'chinese' || GameMode.wholeSentence(this.mode)) this.speakAnswer();
      this.update();
      if (firstTry) SW.celebrateStar(this, this.index);
      // 有例句就停下來讓她看，按下一個再走
      if (ex) return;
      const current = this.index;
      this.after(1300, () => {
        if (this.index !== current || this.finished) return;
        this.next();
      });
    }

    next() {
      const w = this.word;
      if (this.results[w.id] !== undefined) this.store.record(w.id, this.results[w.id]);
      if (this.index + 1 >= this.words.length) {
        this.finished = true;
      } else {
        this.index += 1;
        this.prepare();
      }
      this.update();
    }

    restart() {
      const fresh = this.nextRound();
      if (fresh.length) this.words = fresh;
      this.results = {};
      this.index = 0;
      this.finished = false;
      this.penaltyDone = false;
      this.prepare();
      this.update();
    }
  }
  SW.GameView = GameView;

  /// .lineLimit(1).minimumScaleFactor(0.3)：太長就縮小
  function fitText(text, size, maxWidth) {
    measure.font = `700 ${size}px ${SW.FONT}`;
    const w = measure.measureText(text).width;
    const s = w > maxWidth ? Math.max(size * 0.3, size * maxWidth / w) : size;
    return h('span', { style: { fontSize: s } }, text);
  }
  const measure = document.createElement('canvas').getContext('2d');
  SW.fitText = fitText;
})();
