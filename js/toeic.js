// 多益風格練習（ToeicView.swift）：應答問題、簡短對話、句子填空
(function () {
  'use strict';
  const SW = window.SW;
  const { h, icon, Theme, Speaker, Data } = SW;

  const ToeicPart = {
    title: { response: '應答問題', conversation: '簡短對話', completion: '句子填空' },
    icon: { response: 'ear.and.waveform', conversation: 'person.2.wave.2.fill', completion: 'text.badge.checkmark' },
  };
  SW.ToeicPart = ToeicPart;
  const letter = i => ['A', 'B', 'C', 'D'][i];

  // Swift 的 hashValue 每次開 App 都不一樣；這裡每次開網頁抽一次
  const salt = Math.floor(Math.random() * 1e9);
  const hashOf = s => { let x = salt; for (const c of s) x = (x * 31 + c.charCodeAt(0)) | 0; return x; };

  class ToeicView extends SW.Component {
    constructor(store, part, onClose) {
      super();
      this.store = store;
      this.part = part;
      this.onClose = onClose;
      this.responses = [];
      this.conversations = [];
      this.completions = [];
      this.index = 0;
      this.picks = [];
      this.results = {};
      this.finished = false;
      /// 罰重聽那一輪：不給星星、不記紀錄
      this.penaltyRound = false;
      this.penaltyDone = false;
      this.copying = false;
      this.flying = null;
      this.bump = null;
      /// 聽力題：按了「開始聽」才播，播之前先倒數
      this.started = false;
      this.countdown = null;
      this.countToken = 0;
      this.newRound();
    }

    get unitIDs() {
      return { response: this.responses, conversation: this.conversations, completion: this.completions }[this.part].map(x => x.id);
    }
    get questionCount() { return this.part === 'conversation' ? (this.conversations.length ? this.conversations[this.index].questions.length : 0) : 1; }
    get answers() {
      if (this.part === 'response') return [this.responses[this.index].answer];
      if (this.part === 'conversation') return this.conversations[this.index].questions.map(q => q.answer);
      return [this.completions[this.index].answer];
    }
    get unitDone() { return this.picks.length > 0 && this.picks.every(p => p != null); }
    showWord(t) { SW.showWordInfo(this.store, t); }

    onDestroy() {
      this.countToken++;
      Speaker.stop();
      if (this.copyComp) this.copyComp.destroy();
    }

    render() {
      let content = null;
      if (this.copying) content = this.copySlot();
      else if (this.finished) content = h('div', { key: 'summary', enter: 'fade', class: 'col center', style: { position: 'absolute', inset: 0 } }, this.summary());
      else if (this.unitIDs.length) {
        const unit = this.part === 'response' ? this.responseUnit() : this.part === 'conversation' ? this.conversationUnit() : this.completionUnit();
        content = h('div', { key: 'play', class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px', gap: 24 } },
          this.topBar(),
          h('div', { class: 'scroll', 'data-scroll': 't', style: { flex: '1 1 0', minHeight: 0, position: 'relative', overflowX: 'hidden' } },
            h('div', { key: `${this.penaltyRound}-${this.index}`, enter: this.index > 0 ? 'slide' : null, leave: 'slide', class: 'col', style: { gap: 24, padding: '8px 0', maxWidth: 900, width: '100%', margin: '0 auto' } }, unit)),
          this.unitDone ? h('div', { class: 'row', style: { justifyContent: 'center', flex: 'none' } },
            SW.pill(this.index + 1 < this.unitIDs.length ? '下一題' : '看結果', 'arrow.right', Theme.star, () => this.next(), { wide: true, minWidth: 220 })) : null);
      }
      return [SW.background(), content];
    }

    topBar() {
      return h('div', { class: 'row', style: { gap: 8, flex: 'none' } },
        SW.closeButton(() => this.onClose()),
        h('div', { class: 'spacer' }),
        SW.starRow(this.unitIDs, this.index, this.results, this.flying, this.bump),
        h('div', { class: 'spacer' }),
        h('div', { class: 'tag-capsule', style: { background: this.penaltyRound ? Theme.peach : Theme.sky } }, this.penaltyRound ? '罰重聽' : ToeicPart.title[this.part]));
    }

    // MARK: Part 2 應答問題

    responseUnit() {
      const item = this.responses[this.index];
      const kids = [h('div', { style: { paddingTop: 20, display: 'flex', justifyContent: 'center' } }, this.listenControls(96, 64, slow => this.playResponse(item, slow))),
        h('div', { class: 'row', style: { gap: 20 } }, [0, 1, 2].map(i => this.letterButton(i, 0, item.answer)))];
      if (this.unitDone) {
        kids.push(h('div', { class: 'col', style: { gap: 14, padding: 22, background: '#fff', borderRadius: 24 } },
          this.transcriptLine(item.question.en, item.question.zh, 'Q'),
          item.options.map((o, i) => this.transcriptLine(o.en, o.zh, letter(i), i === item.answer ? true : (this.picks[0] === i ? false : null)))));
      }
      return h('div', { class: 'col', style: { gap: 28 } }, kids);
    }

    letterButton(i, q, correct) {
      const picked = this.picks[q];
      const fill = picked == null ? '#fff' : (i === correct ? Theme.mint : (picked === i ? Theme.a('bad', 0.35) : Theme.white(0.6)));
      return h('button', {
        class: 'press keep-opacity', disabled: picked != null || !this.started, onclick: () => this.pick(i, q),
        style: { flex: '1 1 0', fontSize: 48, fontWeight: 800, minHeight: 120, borderRadius: 28, background: fill, boxShadow: '0 6px 0 var(--shadow)', opacity: this.started || picked != null ? 1 : 0.4 },
      }, letter(i));
    }

    // MARK: Part 3 簡短對話

    conversationUnit() {
      const item = this.conversations[this.index];
      const kids = [h('div', { style: { display: 'flex', justifyContent: 'center' } }, this.listenControls(80, 56, slow => this.playConversation(item, slow)))];
      item.questions.forEach((question, q) => {
        kids.push(h('div', { class: 'col', style: { gap: 14, padding: 22, background: Theme.white(0.7), borderRadius: 24 } },
          h('div', { style: { fontSize: 26, fontWeight: 700 } }, `${q + 1}. ${question.text.en}`),
          this.unitDone ? h('div', { class: 'soft' }, question.text.zh) : null,
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 } },
            question.options.map((o, i) => this.optionButton(`${letter(i)}. ${o}`, i, q, question.answer)))));
      });
      if (this.unitDone) {
        kids.push(h('div', { class: 'col', style: { gap: 14, padding: 22, background: '#fff', borderRadius: 24 } },
          item.lines.map(l => this.transcriptLine(l.text.en, l.text.zh, l.woman ? 'W' : 'M'))));
      }
      return h('div', { class: 'col', style: { gap: 24 } }, kids);
    }

    // MARK: Part 5 句子填空

    completionUnit() {
      const item = this.completions[this.index];
      const answered = this.picks[0] != null;
      const kids = [
        h('div', { style: { paddingTop: 30 } }, SW.tappableText(item.sentence.split('___').join(answered ? item.options[item.answer] : '＿＿＿'),
          { size: 36, weight: 700, highlight: answered ? item.options[item.answer] : null, centered: true }, t => this.showWord(t))),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 } }, item.options.map((o, i) => this.optionButton(o, i, 0, item.answer, true))),
      ];
      if (this.unitDone) {
        kids.push(h('div', { class: 'col', style: { gap: 12, padding: 22, background: Theme.a('star', 0.22), borderRadius: 24 } },
          h('div', { class: 'row', style: { alignItems: 'flex-start', gap: 8 } },
            h('div', { style: { flex: '1 1 0' } }, SW.tappableText(item.filled, { size: 26 }, t => this.showWord(t))),
            h('button', { class: 'press', style: { color: Theme.starDeep }, onclick: () => Speaker.say(item.filled), 'aria-label': '念' }, icon('speaker.wave.2.fill', 24))),
          h('div', { class: 'title3 soft' }, item.zh),
          h('div', { class: 'row', style: { gap: 10, alignItems: 'flex-start' } }, h('span', { style: { paddingTop: 2 } }, SW.softStar(22)), h('div', { class: 'title3' }, item.tip))));
      }
      return h('div', { class: 'col', style: { gap: 26 } }, kids);
    }

    optionButton(text, i, q, correct, big = false) {
      const picked = this.picks[q];
      const fill = picked == null ? '#fff' : (i === correct ? Theme.mint : (picked === i ? Theme.a('bad', 0.35) : Theme.white(0.6)));
      return h('button', {
        class: 'press keep-opacity', disabled: picked != null && !big,
        // 填空答完之後，選項的字也能點開單字卡
        onclick: () => { if (picked == null) this.pick(i, q); else if (big) this.showWord(text); },
        style: { fontSize: big ? 30 : 22, fontWeight: 700, padding: '6px 12px', minHeight: big ? 96 : 70, borderRadius: 22, background: fill, boxShadow: '0 4px 0 rgba(245,166,36,.15)' },
      }, text);
    }

    transcriptLine(en, zh, prefix, mark = null) {
      return h('div', { class: 'row', style: { gap: 12, alignItems: 'flex-start' } },
        h('div', { class: 'headline', style: { width: 34, height: 34, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: mark === true ? Theme.mint : mark === false ? Theme.a('bad', 0.35) : Theme.cream } }, prefix),
        h('div', { class: 'col', style: { gap: 4, flex: '1 1 0', minWidth: 0 } },
          SW.tappableText(en, { size: 22 }, t => this.showWord(t)),
          zh ? h('div', { class: 'soft' }, zh) : null),
        h('button', { class: 'press', style: { color: Theme.starDeep }, onclick: () => Speaker.say(en), 'aria-label': '念' }, icon('speaker.wave.2.fill', 20)));
    }

    /// 還沒開始：一顆「開始聽」；倒數中：大數字；開始後：重聽和慢速
    listenControls(big, small, play) {
      if (this.countdown != null) {
        return h('div', { key: 'n' + this.countdown, enter: 'count', style: { fontSize: 110, fontWeight: 800, color: Theme.starDeep, height: big + 20, display: 'flex', alignItems: 'center' } }, String(this.countdown));
      }
      if (!this.started) {
        return h('button', {
          key: 'start', class: 'press row', onclick: () => this.startCountdown(play),
          style: { gap: 10, fontSize: 30, fontWeight: 700, color: '#fff', minWidth: 260, minHeight: big, padding: '0 20px', borderRadius: 999, background: Theme.starDeep, boxShadow: `0 5px 0 ${Theme.a('starDeep', 0.35)}`, justifyContent: 'center' },
        }, SW.label('開始聽', 'play.fill', { iconSize: 28 }));
      }
      return h('div', { key: 'listen', class: 'row', style: { gap: 20 } },
        SW.speakButton(big, false, () => play(false), { fill: Theme.starDeep }),
        SW.speakButton(small, true, () => play(true), { fill: Theme.starDeep }));
    }

    async startCountdown(play) {
      const unit = this.index;
      const my = ++this.countToken;
      for (const n of [3, 2, 1]) {
        this.countdown = n;
        this.update();
        await this.sleep(800);
        if (my !== this.countToken || this.index !== unit) return;
      }
      this.countdown = null;
      this.started = true;
      this.update();
      play(false);
    }

    // MARK: 結算

    get missedIDs() { return this.unitIDs.filter(id => this.results[id] !== true); }

    summary() {
      const ids = this.unitIDs;
      const got = ids.filter(id => this.results[id] === true).length;
      const pill = SW.pill;
      return h('div', { class: 'col', style: { gap: 28, alignItems: 'center', padding: 40 } },
        SW.bigStar(170, String(got), 60),
        h('div', { style: { fontSize: 36, fontWeight: 700 } }, this.penaltyRound ? `罰重聽：${got} / ${ids.length}` : `${ToeicPart.title[this.part]}：${got} / ${ids.length} 題`),
        this.missedIDs.length && !this.penaltyDone
          ? (this.part === 'completion'
            ? pill(SW.PenaltyKind.button('copySentence', this.missedIDs.length), 'pencil.line', Theme.peach, () => { this.copying = true; this.update(); }, { wide: true, minWidth: 220 })
            : pill(`罰重聽 ${this.missedIDs.length} 題`, 'ear.fill', Theme.peach, () => this.startPenaltyRound(), { wide: true, minWidth: 220 }))
          : h('div', { class: 'row', style: { gap: 16 } },
            pill('回首頁', 'house.fill', '#fff', () => this.onClose(), { minWidth: 150 }),
            pill('下一輪', 'arrow.right', Theme.star, () => this.newRound(), { wide: true, minWidth: 220 })));
    }

    copySlot() {
      if (!this.copyComp) {
        const missed = this.completions.filter(c => this.results[c.id] !== true).map(c => ({ id: c.id, english: c.filled, chinese: c.zh }));
        this.copyComp = SW.makePenalty(this.store, 'copySentence', missed, () => {
          this.copyComp.destroy();
          this.copyComp = null;
          this.copying = false;
          this.penaltyDone = true;
          this.update();
        }, () => this.onClose());
      }
      const comp = this.copyComp;
      return h('div', { key: 'copy', persist: true, enter: 'fade', style: { position: 'absolute', inset: 0 }, mount: el => { el.appendChild(comp.el); comp.updateNow(); } });
    }

    // MARK: 流程

    newRound() {
      this.penaltyRound = false;
      this.penaltyDone = false;
      const T = Data.toeic;
      if (this.part === 'response') this.responses = this.store.pickByStats(8, T.responses, x => x.id);
      if (this.part === 'conversation') this.conversations = this.store.pickByStats(4, T.conversations, x => x.id);
      if (this.part === 'completion') this.completions = this.store.pickByStats(10, T.completions, x => x.id);
      this.startUnits();
    }

    /// 聽力錯的那幾題再來一輪，全部答對才算罰完
    startPenaltyRound() {
      const missed = new Set(this.missedIDs);
      this.responses = this.responses.filter(x => missed.has(x.id));
      this.conversations = this.conversations.filter(x => missed.has(x.id));
      this.penaltyRound = true;
      this.startUnits();
    }

    startUnits() {
      this.results = {};
      this.index = 0;
      this.finished = false;
      this.prepareUnit();
      this.update();
    }

    prepareUnit() {
      this.picks = new Array(this.questionCount).fill(null);
      this.started = false;
      this.countdown = null;
      this.countToken++;
      Speaker.stop();
    }

    playResponse(item, slow) {
      const asker = hashOf(item.id) % 2 === 0 ? 'woman' : 'man';
      const answerer = asker === 'woman' ? 'man' : 'woman';
      const lines = [[asker, item.question.en]];
      item.options.forEach((o, i) => lines.push([answerer, `${letter(i)}. ${o.en}`]));
      if (slow) Speaker.sayAll(lines.map(l => l[1]), true);
      else Speaker.sayLines(lines, 0.7);
    }

    playConversation(item, slow) {
      if (slow) Speaker.sayAll(item.lines.map(l => l.text.en), true);
      else Speaker.sayLines(item.lines.map(l => [l.woman ? 'woman' : 'man', l.text.en]));
    }

    pick(i, q) {
      if (q >= this.picks.length || this.picks[q] != null) return;
      this.picks[q] = i;
      const ok = i === this.answers[q];
      SW.haptic(ok ? 'success' : 'warning');
      if (this.part === 'completion') Speaker.say(this.completions[this.index].filled);
      this.update();
      if (!this.unitDone) return;
      const id = this.unitIDs[this.index];
      const allRight = this.picks.every((p, k) => p === this.answers[k]);
      this.results[id] = allRight;
      if (!this.penaltyRound) this.store.record(id, allRight);
      if (allRight && !this.penaltyRound) SW.celebrateStar(this, this.index);
      this.update();
    }

    next() {
      if (this.index + 1 >= this.unitIDs.length) {
        if (this.penaltyRound && this.missedIDs.length) {
          // 還有錯的，繼續罰
          this.startPenaltyRound();
          return;
        }
        if (this.penaltyRound) this.penaltyDone = true;
        this.finished = true;
      } else {
        this.index += 1;
        this.prepareUnit();
      }
      this.update();
    }
  }
  SW.ToeicView = ToeicView;
})();
