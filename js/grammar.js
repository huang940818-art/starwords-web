// 文法四選一（GrammarGameView.swift）
(function () {
  'use strict';
  const SW = window.SW;
  const { h, icon, Theme, Speaker } = SW;

  class GrammarGameView extends SW.Component {
    constructor(store, items, nextRound, onClose) {
      super();
      this.store = store;
      this.items = items;
      this.nextRound = nextRound;
      this.onClose = onClose;
      this.index = 0;
      this.options = [];
      this.picked = null;
      this.results = {};
      this.flying = null;
      this.bump = null;
      this.finished = false;
      this.penalty = false;
      this.penaltyDone = false;
      this.prepare();
    }

    get item() { return this.items[this.index]; }
    onDestroy() { Speaker.stop(); if (this.penaltyComp) this.penaltyComp.destroy(); }
    showWord(t) { SW.showWordInfo(this.store, t); }

    render() {
      let content;
      if (this.penalty) content = this.penaltySlot();
      else if (this.finished) content = h('div', { key: 'summary', enter: 'fade', class: 'col center', style: { position: 'absolute', inset: 0 } }, this.summary());
      else {
        const it = this.item;
        content = h('div', { key: 'play', class: 'col', style: { position: 'absolute', inset: 0, padding: '24px 36px', gap: 28 } },
          h('div', { class: 'row', style: { gap: 8, flex: 'none' } },
            SW.closeButton(() => this.onClose()),
            h('div', { class: 'spacer' }),
            SW.starRow(this.items.map(x => x.id), this.index, this.results, this.flying, this.bump),
            h('div', { class: 'spacer' }),
            h('div', { class: 'tag-capsule', style: { background: Theme.sky } }, it.topic)),
          h('div', { class: 'scroll', 'data-scroll': 'g', style: { flex: '1 1 0', minHeight: 0, position: 'relative', overflowX: 'hidden' } },
            h('div', { key: 'q' + this.index, enter: this.index > 0 ? 'slide' : null, leave: 'slide', class: 'col', style: { minHeight: '100%', gap: 28, alignItems: 'center', width: '100%' } },
              h('div', { class: 'spacer' }),
              this.question(),
              this.optionButtons(),
              this.tipCard(),
              h('div', { class: 'spacer' }))));
      }
      return [SW.background(), content];
    }

    question() {
      const it = this.item;
      return h('div', { class: 'col', style: { gap: 16, alignItems: 'center', width: '100%' } },
        SW.tappableText(it.sentence.split('___').join(this.picked == null ? '＿＿＿' : it.answer),
          { size: 46, weight: 700, highlight: this.picked == null ? null : it.answer, centered: true }, t => this.showWord(t)),
        h('div', { class: 'title soft text-center' }, it.chinese));
    }

    optionButtons() {
      const it = this.item;
      const color = o => {
        if (this.picked == null) return '#fff';
        if (o === it.answer) return Theme.mint;
        if (o === this.picked) return Theme.a('bad', 0.35);
        return Theme.white(0.6);
      };
      return h('div', { class: 'row', style: { gap: 20, maxWidth: 900, width: '100%' } }, this.options.map(o => h('button', {
        class: 'press', onclick: () => { if (this.picked == null) this.pick(o); else this.showWord(o); },
        style: { flex: '1 1 0', minWidth: 0, fontSize: 36, fontWeight: 700, minHeight: 110, borderRadius: 28, background: color(o), boxShadow: '0 6px 0 var(--shadow)', padding: '0 8px' },
      }, o)));
    }

    tipCard() {
      if (this.picked == null) return h('div', { key: 'tipspace', style: { height: 160, flex: 'none' } });
      const it = this.item;
      return h('div', { key: 'tip', enter: 'fadeup', class: 'col', style: { gap: 20, alignItems: 'center', width: '100%' } },
        h('div', { class: 'row', style: { gap: 14, alignItems: 'flex-start', padding: 24, maxWidth: 900, width: '100%', background: Theme.a('star', 0.25), borderRadius: 24 } },
          SW.softStar(30),
          h('div', { class: 'col', style: { gap: 10, flex: '1 1 0', minWidth: 0 } },
            SW.tappableText(it.filled, { size: 24 }, t => this.showWord(t)),
            h('div', { class: 'title2' }, it.tip))),
        h('button', { class: 'press pill', style: { background: Theme.star, minWidth: 220 }, onclick: () => this.next() }, SW.label('下一題', 'arrow.right')));
    }

    summary() {
      const got = Object.values(this.results).filter(x => x).length;
      const missed = this.missed;
      const btn = (t, i, f, a) => SW.pill(t, i, f, a, { minWidth: 180 });
      return h('div', { class: 'col', style: { gap: 28, alignItems: 'center', padding: 40, width: '100%', maxHeight: '100%' } },
        SW.bigStar(180, String(got), 64),
        h('div', { style: { fontSize: 40, fontWeight: 700 } }, got === this.items.length ? '全對！' : `拿到 ${got} 顆星星`),
        h('div', { class: 'scroll', style: { maxWidth: 760, width: '100%', maxHeight: 380 } },
          h('div', { class: 'col', style: { gap: 10 } }, this.items.map(g => {
            const ok = this.results[g.id] === true;
            return h('div', { class: 'row', style: { gap: 12, padding: 14, background: '#fff', borderRadius: 18, alignItems: 'center' } },
              icon(ok ? 'star.fill' : 'xmark.circle.fill', 20, ok ? Theme.star : Theme.bad),
              h('div', { class: 'col', style: { gap: 2, flex: '1 1 0' } },
                SW.tappableText(g.filled, { size: 18, weight: 700 }, t => this.showWord(t)),
                ok ? null : h('div', { class: 'subheadline soft' }, g.tip)));
          }))),
        missed.length && !this.penaltyDone
          ? btn(SW.PenaltyKind.button('copySentence', missed.length), 'pencil.line', Theme.peach, () => { this.penalty = true; this.update(); })
          : h('div', { class: 'row', style: { gap: 16 } },
            btn('回首頁', 'house.fill', '#fff', () => this.onClose()),
            btn('下一輪', 'arrow.right', Theme.star, () => {
              const fresh = this.nextRound();
              if (fresh.length) this.items = fresh;
              this.results = {};
              this.index = 0;
              this.finished = false;
              this.penaltyDone = false;
              this.prepare();
              this.update();
            })));
    }

    get missed() {
      return this.items.filter(g => this.results[g.id] !== true).map(g => ({ id: g.id, english: g.filled, chinese: g.chinese }));
    }

    penaltySlot() {
      if (!this.penaltyComp) {
        this.penaltyComp = SW.makePenalty(this.store, 'copySentence', this.missed, () => {
          this.penaltyComp.destroy();
          this.penaltyComp = null;
          this.penalty = false;
          this.penaltyDone = true;
          this.update();
        }, () => this.onClose());
      }
      const comp = this.penaltyComp;
      return h('div', { key: 'penalty', persist: true, enter: 'fade', style: { position: 'absolute', inset: 0 }, mount: el => { el.appendChild(comp.el); comp.updateNow(); } });
    }

    prepare() {
      this.picked = null;
      this.options = SW.shuffle(this.item.options);
    }

    pick(o) {
      this.picked = o;
      const it = this.item;
      const ok = o === it.answer;
      this.results[it.id] = ok;
      Speaker.say(it.filled);
      this.update();
      if (ok) {
        SW.haptic('success');
        SW.celebrateStar(this, this.index);
      } else {
        SW.haptic('warning');
      }
    }

    next() {
      const it = this.item;
      if (this.results[it.id] !== undefined) this.store.record(it.id, this.results[it.id]);
      if (this.index + 1 >= this.items.length) this.finished = true;
      else { this.index += 1; this.prepare(); }
      this.update();
    }
  }
  SW.GrammarGameView = GrammarGameView;
})();
