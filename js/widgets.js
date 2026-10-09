// 各畫面共用的小元件
(function () {
  'use strict';
  const SW = window.SW;
  const { h, icon, softStar, Theme, Prefs, PenWidth, Lexicon } = SW;

  /// 背景零星的小星星（ScatteredStars）
  const spots = [[0.06, 0.08, 26, 0.5], [0.92, 0.12, 18, 0.45], [0.85, 0.42, 14, 0.35],
    [0.04, 0.55, 16, 0.35], [0.95, 0.82, 24, 0.45], [0.12, 0.92, 20, 0.4], [0.5, 0.97, 12, 0.3]];
  SW.background = function (withStars = true) {
    return h('div', { class: 'bg', key: 'bg' }, withStars ? spots.map(([x, y, s, a], i) =>
      h('span', { class: 'scatter', key: 's' + i, style: { left: `${x * 100}%`, top: `${y * 100}%`, opacity: a } }, icon('star.fill', s))) : null);
  };

  /// 星星爆開（StarBurst）：放在 parent 的正中間
  SW.starBurst = function (parent, scale = 1) {
    const box = document.createElement('div');
    box.className = 'burst';
    if (parent !== document.body) {
      box.style.position = 'absolute';
    }
    box.style.transform = `scale(${scale})`;
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * 2 * Math.PI;
      const size = i % 2 === 0 ? 34 : 22;
      const color = i % 3 === 0 ? Theme.starDeep : Theme.star;
      const b = icon('star.fill', size, color);
      b.classList.add('b');
      b.style.setProperty('--dx', Math.cos(a) * 190 + 'px');
      b.style.setProperty('--dy', Math.sin(a) * 190 + 'px');
      box.appendChild(b);
    }
    parent.appendChild(box);
    setTimeout(() => box.remove(), 1100);
    return box;
  };

  /// 答對時中間跳出大星星，停一下，再縮小飛進上面那一格（FlyingStar）
  SW.flyStar = function (slotEl, onLand) {
    const W = window.innerWidth, H = window.innerHeight;
    const from = { x: W / 2, y: H / 2 };
    const r = slotEl ? slotEl.getBoundingClientRect() : { left: W / 2, top: 40, width: 0, height: 0 };
    const to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const size = 150;
    const outer = document.createElement('div');
    outer.className = 'fly-star';
    const inner = icon('star.fill', size, Theme.star);
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const at = p => `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`;
    outer.style.transform = at(from);
    inner.animate([{ transform: 'scale(0.2)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'forwards' });
    setTimeout(() => {
      outer.animate([{ transform: at(from) }, { transform: at(to) }], { duration: 550, easing: 'cubic-bezier(.42,0,1,1)', fill: 'forwards' });
      const a = inner.animate([{ transform: 'scale(1) rotate(0deg)' }, { transform: 'scale(0.18) rotate(144deg)' }], { duration: 550, easing: 'cubic-bezier(.42,0,1,1)', fill: 'forwards' });
      a.onfinish = () => { outer.remove(); onLand(); };
    }, 600);
    return outer;
  };

  /// 答對時的特效：四周爆開＋一顆飛進上排，落地那一格彈一下
  SW.celebrateStar = function (comp, slotIndex) {
    SW.starBurst(document.body);
    comp.flying = slotIndex;
    comp.update();
    const slot = () => comp.el.querySelector(`[data-slot="${slotIndex}"]`);
    // 先等畫面把那一格放好
    requestAnimationFrame(() => {
      SW.flyStar(slot(), () => {
        if (comp.dead) return;
        comp.flying = null;
        comp.bump = slotIndex;
        comp.update();
        comp.after(300, () => { comp.bump = null; comp.update(); });
      });
    });
  };

  /// 上面那排星星
  SW.starRow = function (ids, index, results, flying, bump) {
    return h('div', { class: 'row', style: { gap: 6 } }, ids.map((id, i) => {
      const r = flying === i ? undefined : results[id];
      const size = i === index ? 26 : 20;
      const color = r === true ? Theme.star : r === false ? Theme.a('bad', 0.6) : Theme.a('soft', 0.5);
      return h('span', { class: 'slot-star', 'data-slot': i, key: 'slot' + i, style: { transform: bump === i ? 'scale(1.6)' : null } },
        icon(r === true ? 'star.fill' : 'star', size, color));
    }));
  };

  /// 結算的大星星
  SW.bigStar = function (size, text, fontSize, offsetY = 10) {
    return h('div', { style: { position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      icon('star.fill', size, Theme.star),
      h('div', { class: 'heavy', style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize, color: '#fff', transform: `translateY(${offsetY}px)` } }, text));
  };

  /// 每個字都可以點的句子（TappableText）
  SW.tappableText = function (text, opts, onTap) {
    const size = opts.size || 30;
    const weight = opts.weight || 600;
    const hl = opts.highlight ? opts.highlight.toLowerCase() : null;
    const isTarget = token => {
      if (!hl || hl.includes(' ')) return false;
      const t = SW.text.trim(token.toLowerCase(), c => !SW.text.isLetter(c));
      if (t === hl || (t.startsWith(hl) && Array.from(t).length - Array.from(hl).length <= 3)) return true;
      const e = Lexicon.lookup(t);
      return !!e && e.english.toLowerCase() === hl;
    };
    return h('div', {
      class: ['flow', opts.centered ? '' : 'leading'],
      style: { columnGap: size * 0.28, rowGap: size * 0.25, ...(opts.style || {}) },
    }, text.split(' ').filter(w => w !== '').map((w, i) => h('button', {
      class: ['press', 'tap-word', isTarget(w) ? 'target' : ''],
      style: { fontSize: size, fontWeight: weight },
      onclick: () => { if (!w.includes('＿')) onTap(w); },
    }, w)));
  };

  /// 逐字標好的句子（WordMarksView）
  SW.wordMarks = function (marks, onTap, size = 36) {
    const word = (s, color) => h('button', { class: 'press', style: { fontSize: size, fontWeight: 700, color, whiteSpace: 'nowrap' }, onclick: () => onTap(s) }, s);
    return h('div', { class: 'flow', style: { gap: 14, maxWidth: 900, width: '100%', alignItems: 'flex-start' } }, marks.map(m => {
      switch (m.kind) {
        case 'ok': return word(m.target, Theme.good);
        case 'wrong': return h('div', { class: 'col', style: { alignItems: 'center', gap: 2 } },
          h('div', { style: { padding: '0 6px', borderRadius: 10, background: Theme.a('bad', 0.14) } }, word(m.target, Theme.bad)),
          h('span', { style: { fontSize: size * 0.55, fontWeight: 600, textDecoration: 'line-through', textDecorationColor: Theme.bad, color: Theme.soft } }, m.written));
        case 'missing': return h('div', { class: 'col', style: { alignItems: 'center', gap: 2 } },
          h('div', { style: { padding: '0 6px', borderRadius: 10, border: `2px dashed ${Theme.starDeep}` } }, word(m.target, Theme.starDeep)),
          h('span', { style: { fontSize: size * 0.45, fontWeight: 700, color: Theme.starDeep } }, '漏了'));
        default: return h('div', { class: 'col', style: { alignItems: 'center', gap: 2 } },
          h('span', { style: { fontSize: size * 0.8, fontWeight: 600, textDecoration: 'line-through', textDecorationColor: Theme.bad, color: Theme.soft, whiteSpace: 'nowrap' } }, m.written),
          h('span', { style: { fontSize: size * 0.45, fontWeight: 700, color: Theme.bad } }, '多的'));
      }
    }));
  };

  /// 念的按鈕：一般／慢速（烏龜）
  SW.speakButton = function (size, slow, onClick, opts = {}) {
    const fill = opts.fill || (slow ? Theme.a('starDeep', 0.8) : Theme.starDeep);
    return h('button', {
      class: 'press', onclick: onClick, 'aria-label': slow ? '慢慢念' : '念',
      style: {
        width: size, height: size, borderRadius: '50%', background: fill, color: '#fff', flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: opts.noShadow ? null : `0 5px 0 ${Theme.a('starDeep', 0.35)}`,
      },
    }, icon(slow ? 'tortoise.fill' : 'speaker.wave.2.fill', opts.iconSize || Math.round(size * 0.4)));
  };

  /// 膠囊按鈕
  SW.pill = function (title, iconName, fill, action, opts = {}) {
    return h('button', {
      class: 'press pill', onclick: action, disabled: !!opts.disabled,
      style: { background: fill, minWidth: opts.minWidth || (opts.wide ? 220 : 140), minHeight: opts.minHeight || 64, boxShadow: opts.noShadow ? 'none' : null, fontSize: opts.fontSize || null },
    }, SW.label(title, iconName));
  };

  /// 上方那顆筆按鈕：點開才選粗細、感壓（PenButton + PenWidthPicker）
  SW.penButton = function (refresh) {
    const w = Prefs.get('penWidth', PenWidth.normal);
    const dot = d => h('span', { style: { width: d * 0.9 + 3, height: d * 0.9 + 3, borderRadius: '50%', background: Theme.ink, display: 'inline-block', flex: 'none' } });
    return h('button', {
      class: 'press row', 'aria-label': '筆',
      style: { gap: 8, minWidth: 72, minHeight: 48, padding: '0 12px', borderRadius: 999, background: '#fff', justifyContent: 'center' },
      onclick: e => {
        const anchor = e.currentTarget;
        let close;
        const build = () => {
          const pw = Prefs.get('penWidth', PenWidth.normal), pr = Prefs.get('pressure', true);
          const toggle = (title, on, flip) => h('button', {
            class: 'press', 'aria-pressed': on ? 'true' : 'false', onclick: flip,
            style: {
              fontSize: 15, fontWeight: 700, color: on ? Theme.ink : Theme.soft, padding: '0 12px', height: 40, borderRadius: 999,
              background: on ? Theme.a('star', 0.6) : 'transparent', border: `1.5px solid ${on ? 'transparent' : Theme.a('soft', 0.4)}`,
            },
          }, title);
          return h('div', { style: { padding: 16 } }, h('div', { class: 'row', style: { width: 320, gap: 4 } },
            PenWidth.options.map(o => h('button', {
              class: 'press', 'aria-label': '粗細 ' + o, onclick: () => { Prefs.set('penWidth', o); rebuild(); },
              style: { width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: pw === o ? Theme.a('star', 0.6) : 'transparent' },
            }, dot(o))),
            h('div', { class: 'spacer', style: { minWidth: 12 } }),
            toggle('感壓', pr, () => { Prefs.set('pressure', !pr); rebuild(); })));
        };
        let box;
        const rebuild = () => { if (box) { box.replaceChildren(build()); } if (refresh) refresh(); };
        close = SW.popover(anchor, () => { box = h('div'); box.appendChild(build()); return box; });
        return close;
      },
    }, icon('pencil.tip', 20), dot(w));
  };

  /// 紙右邊一排小橡皮擦，一行一顆，點了只擦那一行（RowEraseColumn）
  SW.rowEraseColumn = function (rows, rowHeight, onErase, opts = {}) {
    const list = [];
    for (let r = 0; r < rows; r++) {
      list.push(h('button', {
        class: 'press', 'aria-label': `擦第${r + 1}行`, onclick: () => onErase(r), disabled: !!opts.disabled,
        style: { height: rowHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', flex: 'none' },
      }, h('span', { class: 'dot' }, icon('eraser.fill', 20))));
    }
    return h('div', { class: 'row-erase', style: { paddingTop: opts.topInset || 0 } }, list);
  };

  /// 等級的顏色（levelColor）
  SW.levelColor = function (l) {
    return { baby: Theme.peach, elementary: Theme.mint, junior: Theme.sky, senior: Theme.lilac, university: Theme.a('star', 0.5) }[l];
  };

  /// 一般的工具鈕（筆／橡皮擦、偷看）
  SW.toolButton = function (title, iconName, on, action) {
    return h('button', {
      class: 'press row', onclick: action, 'aria-pressed': on ? 'true' : 'false',
      style: { gap: 8, minWidth: 110, minHeight: 48, padding: '0 14px', borderRadius: 999, background: on ? Theme.peach : '#fff', justifyContent: 'center', fontSize: 17, fontWeight: 600 },
    }, SW.label(title, iconName));
  };
})();
