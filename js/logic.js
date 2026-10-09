// 不碰畫面的部分：照 Models.swift、Support.swift（Recognizer）、SentenceDiff.swift、Synonyms.swift、
// VerbForms.swift、Lexicon.swift、ScanWords.swift（WordScanner）移植。瀏覽器和 node 測試共用。
(function (root) {
  'use strict';
  const SW = root.SW = root.SW || {};

  const isLetter = c => /\p{L}/u.test(c);
  const isNumber = c => /\p{N}/u.test(c);
  const isCJK = c => {
    const v = c.codePointAt(0);
    return (v >= 0x4E00 && v <= 0x9FFF) || (v >= 0x3400 && v <= 0x4DBF);
  };
  const chars = s => Array.from(s);
  /// Swift 的 trimmingCharacters：兩頭去掉 test 為真的字
  function trim(s, test) {
    const a = chars(s);
    let i = 0, j = a.length;
    while (i < j && test(a[i])) i++;
    while (j > i && test(a[j - 1])) j--;
    return a.slice(i, j).join('');
  }
  const isWS = c => /\s/u.test(c);
  const trimWS = s => trim(s, isWS);
  SW.text = { isLetter, isNumber, isCJK, trim, trimWS, chars };

  // MARK: - 日期（Swift JSONEncoder 預設把 Date 存成 2001-01-01 起算的秒數）

  const REF = 978307200;
  SW.date = {
    nowRef: () => Date.now() / 1000 - REF,
    toRef: ms => ms / 1000 - REF,
    fromRef: s => (s + REF) * 1000,
  };

  function dayKey(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  SW.dayKey = dayKey;

  // MARK: - 看懂手寫（Recognizer）

  const Recognizer = {
    /// 英文單字裡沒有數字：手寫的 l、o、s 常被讀成 1、0、5，換回字母，其他數字拿掉
    lettersOnly(s) {
      const map = { '0': 'o', '1': 'l', '5': 's', '6': 'b', '9': 'g', '2': 'z' };
      return chars(s).map(c => isNumber(c) ? (map[c] || '') : c).join('');
    },
    /// 從幾個候選裡挑：先挑沒有數字的，都有就把數字換掉
    pickLetters(candidates) {
      const clean = candidates.find(s => !chars(s).some(isNumber) && s !== '');
      if (clean !== undefined) return clean;
      if (!candidates.length) return null;
      const f = Recognizer.lettersOnly(candidates[0]);
      return f === '' ? null : f;
    },
    /// 辨識給的候選整理成 App 用的順序：沒有數字的讀法排前面，有數字的換成字母當備用
    clean(raw) {
      const out = [];
      const noDigits = raw.filter(s => !chars(s).some(isNumber));
      for (const s of noDigits.concat(raw.map(Recognizer.lettersOnly))) {
        if (s !== '' && !out.includes(s)) out.push(s);
      }
      return out;
    },
    normalize(s) {
      const allowed = new Set([' ', "'", '-']);
      let kept = '';
      for (const c of chars(s.toLowerCase())) {
        const ch = (c === '’' || c === '‘') ? "'" : c;
        if (isLetter(ch) || isNumber(ch) || allowed.has(ch)) kept += ch;
      }
      return kept.split(' ').filter(x => x !== '').join(' ');
    },
    /// 標點、大小寫、空格、撇號都不算：手寫的 I'm 常被讀成 Im
    matches(candidates, target) {
      const key = s => Recognizer.normalize(s).replace(/ /g, '').replace(/'/g, '');
      const t = key(target);
      return candidates.some(c => key(c) === t);
    },
  };
  SW.Recognizer = Recognizer;

  // MARK: - 整句逐字對（SentenceDiff）

  const SentenceDiff = {
    key: s => Recognizer.normalize(s).replace(/'/g, ''),
    tokens(s) { return s.split(/\s+/u).filter(x => x !== '' && SentenceDiff.key(x) !== ''); },
    letters(a, b) {
      a = chars(a); b = chars(b);
      if (!a.length) return b.length;
      let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i].concat(new Array(b.length).fill(0));
        for (let j = 1; j <= b.length; j++) {
          cur[j] = Math.min(prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), prev[j] + 1, cur[j - 1] + 1);
        }
        prev = cur;
      }
      return prev[b.length];
    },
    /// 拼錯算一格錯；完全不同的字配在一起比較貴，寧可標漏了＋多的
    subCost(a, b) {
      if (a === b) return 0;
      return SentenceDiff.letters(a, b) <= Math.max(1, Math.floor(Math.max(chars(a).length, chars(b).length) / 2)) ? 1 : 1.5;
    },
    compare(target, written) {
      const t = SentenceDiff.tokens(target), w = SentenceDiff.tokens(written);
      const tk = t.map(SentenceDiff.key), wk = w.map(SentenceDiff.key);
      const n = t.length, m = w.length;
      const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      for (let i = 0; i <= n; i++) d[i][0] = i;
      for (let j = 0; j <= m; j++) d[0][j] = j;
      for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
          const sub = d[i - 1][j - 1] + SentenceDiff.subCost(tk[i - 1], wk[j - 1]);
          d[i][j] = Math.min(sub, d[i - 1][j] + 1, d[i][j - 1] + 1);
        }
      }
      const out = [];
      let i = n, j = m;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + SentenceDiff.subCost(tk[i - 1], wk[j - 1])) {
          out.push({ kind: tk[i - 1] === wk[j - 1] ? 'ok' : 'wrong', target: t[i - 1], written: w[j - 1] });
          i--; j--;
        } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
          out.push({ kind: 'missing', target: t[i - 1], written: '' });
          i--;
        } else {
          out.push({ kind: 'extra', target: '', written: w[j - 1] });
          j--;
        }
      }
      return out.reverse();
    },
    errors: marks => marks.filter(m => m.kind !== 'ok').length,
    /// 辨識給好幾種讀法，挑跟答案最接近的那個來標
    best(target, candidates) {
      let best = null;
      for (const c of candidates) {
        const m = SentenceDiff.compare(target, c);
        if (best === null || SentenceDiff.errors(m) < SentenceDiff.errors(best)) best = m;
      }
      return best || SentenceDiff.compare(target, '');
    },
  };
  SW.SentenceDiff = SentenceDiff;

  // MARK: - 同義字（Synonyms）

  const Synonyms = {
    groups: [],
    senses(chinese) {
      let s = chars(chinese);
      for (;;) {
        const open = s.findIndex(c => '（('.includes(c));
        if (open < 0) break;
        let close = -1;
        for (let k = open; k < s.length; k++) if ('）)'.includes(s[k])) { close = k; break; }
        if (close < 0) break;
        s.splice(open, close - open + 1);
      }
      const parts = [];
      let cur = [];
      for (const c of s) {
        if ('；;／/、，, '.includes(c)) { if (cur.length) parts.push(cur.join('')); cur = []; } else cur.push(c);
      }
      if (cur.length) parts.push(cur.join(''));
      const out = new Set();
      for (const p of parts) {
        let t = trim(p, c => c === ' ' || c === '\t');
        if (chars(t).length > 1 && t.endsWith('的')) t = chars(t).slice(0, -1).join('');
        if (t !== '') out.add(t);
      }
      return out;
    },
    /// 這個字以外，也可以接受的寫法
    alternatives(word, words) {
      const key = word.english.toLowerCase();
      let out = [];
      for (const g of Synonyms.groups) if (g.includes(key)) out = out.concat(g.filter(x => x !== key));
      const mine = Synonyms.senses(word.chinese);
      for (const w of words) {
        if (w.id === word.id || w.english.toLowerCase() === key) continue;
        const theirs = Synonyms.senses(w.chinese);
        if ([...mine].some(x => theirs.has(x))) out.push(w.english);
      }
      const seen = new Set();
      return out.filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    },
  };
  SW.Synonyms = Synonyms;

  // MARK: - 動詞時態（VerbForms）

  const vowels = new Set(['a', 'e', 'i', 'o', 'u']);
  const VerbForms = {
    irregular: {},
    doubleList: new Set(),
    isVerb(pos) {
      if (pos == null) return false;
      return /(^|[^a-z])v[ti]?\./.test(pos.toLowerCase());
    },
    third(w) {
      if (w === 'have') return 'has';
      if (w === 'be') return 'is';
      if (w === 'go' || w === 'do') return w + 'es';
      if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
      if (w.endsWith('y') && w.length > 1 && !vowels.has(w[w.length - 2])) return w.slice(0, -1) + 'ies';
      return w + 's';
    },
    doubles(w) {
      if (VerbForms.doubleList.has(w)) return true;
      const c = chars(w);
      if (c.length < 3) return false;
      const groups = w.split(/[^aeiou]+/).filter(x => x !== '').length;
      if (groups !== 1) return false;
      const last = c[c.length - 1], mid = c[c.length - 2], before = c[c.length - 3];
      return !vowels.has(last) && !'wxy'.includes(last) && vowels.has(mid) && !vowels.has(before);
    },
    regularPast(w) {
      if (w.endsWith('e')) return w + 'd';
      if (w.endsWith('y') && w.length > 1 && !vowels.has(w[w.length - 2])) return w.slice(0, -1) + 'ied';
      if (VerbForms.doubles(w)) return w + w[w.length - 1] + 'ed';
      return w + 'ed';
    },
    ing(w) {
      if (w === 'be') return 'being';
      if (w.endsWith('ie')) return w.slice(0, -2) + 'ying';
      if (w.endsWith('ee') || w.endsWith('ye') || w.endsWith('oe')) return w + 'ing';
      if (w.endsWith('e') && w.length > 2) return w.slice(0, -1) + 'ing';
      if (VerbForms.doubles(w)) return w + w[w.length - 1] + 'ing';
      return w + 'ing';
    },
    of(word) {
      const parts = word.split(' ').filter(x => x !== '');
      if (!parts.length) return null;
      const head = parts[0].toLowerCase();
      if (!chars(head).every(isLetter)) return null;
      const rest = parts.slice(1).join(' ');
      const join = h => rest === '' ? h : h + ' ' + rest;
      const irr = VerbForms.irregular[head];
      const past = irr ? irr[0] : VerbForms.regularPast(head);
      const pp = irr ? irr[1] : VerbForms.regularPast(head);
      return { base: word, third: join(VerbForms.third(head)), past: join(past), participle: join(pp), ing: join(VerbForms.ing(head)) };
    },
  };
  SW.VerbForms = VerbForms;

  // MARK: - 分級字庫（Lexicon）

  const Levels = ['baby', 'elementary', 'junior', 'senior', 'university'];
  const LevelTitle = { baby: '寶寶', elementary: '國小', junior: '國中', senior: '高中', university: '大學' };
  SW.Levels = Levels;
  SW.LevelTitle = LevelTitle;

  function lexEnglish(w) {
    const first = w.split('/').filter(x => x !== '')[0] ?? w;
    return first.replace(/\(.*?\)/g, '').replace(/^ +| +$/g, '');
  }

  const Lexicon = {
    all: [],
    index: new Map(),
    keys: new Set(),
    lemmas: new Map(),
    load(list) {
      Lexicon.all = list.map(e => {
        e.english = lexEnglish(e.w);
        e.level = Levels[e.lv] || 'senior';
        e.levelLabel = (e.level === 'senior' && e.sub != null) ? `高中 ${e.sub} 級` : LevelTitle[e.level];
        return e;
      });
      Lexicon.keys = new Set(Lexicon.all.map(e => e.english.toLowerCase()));
      Lexicon.index = new Map();
      for (const e of Lexicon.all) {
        for (const f of Lexicon.forms(e.w)) if (!Lexicon.index.has(f)) Lexicon.index.set(f, e);
      }
      // 原形：iOS 用 NLTagger 查，網頁沒有，改用 VerbForms 的不規則動詞表反查（went→go）
      Lexicon.lemmas = new Map();
      for (const [base, [past, pp]] of Object.entries(VerbForms.irregular)) {
        for (const f of past.split('/').concat(pp.split('/'))) if (!Lexicon.lemmas.has(f)) Lexicon.lemmas.set(f, base);
      }
    },
    forms(w) {
      const out = [];
      for (const part of w.toLowerCase().split('/')) {
        if (part === '') continue;
        const p = part.replace(/^\s+|\s+$/g, '');
        const m = p.match(/\((.*?)\)/);
        if (m) {
          out.push(p.replace(m[0], ''));
          out.push(p.replace(m[0], m[1]));
        } else out.push(p);
      }
      return out.map(x => x.replace(/’/g, "'"));
    },
    entries(level) {
      const lv = Levels.indexOf(level);
      if (level === 'university') return Lexicon.all.filter(e => e.lv === lv || e.u === 1);
      return Lexicon.all.filter(e => e.lv === lv);
    },
    entry(english) { return Lexicon.index.get(english.toLowerCase()) || null; },
    /// 文章裡點到的字：先原樣查，再試原形（went→go、apples→apple）
    lookup(token) {
      const t = trim(token.toLowerCase().replace(/’/g, "'"), c => !(isLetter(c) || c === "'" || c === '-'));
      if (t === '') return null;
      if (Lexicon.index.has(t)) return Lexicon.index.get(t);
      const lemma = Lexicon.lemmas.get(t);
      if (lemma && Lexicon.index.has(lemma)) return Lexicon.index.get(lemma);
      const rules = [['ies', 'y'], ['es', ''], ['s', ''], ['ied', 'y'], ['ed', ''], ['ed', 'e'], ['ing', ''], ['ing', 'e'], ["'s", ''], ['er', ''], ['est', '']];
      for (const [suffix, repl] of rules) {
        if (t.endsWith(suffix) && chars(t).length > suffix.length + 2) {
          const base = t.slice(0, t.length - suffix.length) + repl;
          if (Lexicon.index.has(base)) return Lexicon.index.get(base);
        }
      }
      return null;
    },
  };
  SW.Lexicon = Lexicon;

  // MARK: - 內建資料

  const Data = { words: [], examples: {}, sentences: [], grammar: [], articles: [], toeic: null, essayTopics: [] };
  SW.Data = Data;

  function loadBuiltin(b, lexicon) {
    Data.words = b.words;
    Data.examples = b.examples;
    Data.sentences = b.sentences;
    Data.grammar = b.grammar.map(g => Object.assign(g, {
      answer: g.options[0],
      filled: g.sentence.split('___').join(g.options[0]),
    }));
    Data.articles = b.articles;
    Data.toeic = b.toeic;
    for (const c of Data.toeic.completions) c.filled = c.sentence.split('___').join(c.options[c.answer]);
    Data.essayTopics = b.essayTopics;
    Synonyms.groups = b.synonyms;
    VerbForms.irregular = b.verbForms.irregular;
    VerbForms.doubleList = new Set(b.verbForms.doubleList);
    if (lexicon) Lexicon.load(lexicon);
  }
  SW.loadBuiltin = loadBuiltin;

  const Examples = {
    builtin(english) {
      const raw = Data.examples[english];
      if (raw == null) return null;
      const p = raw.split('|');
      return p.length === 2 ? [p[0], p[1]] : null;
    },
  };
  SW.Examples = Examples;

  // MARK: - 存檔（Store）

  function newWord(id, english, chinese, category, isCustom) {
    return { id, english, chinese, category, isCustom, correct: 0, wrong: 0 };
  }

  /// 照 Word.init(from:) 讀：id、english、chinese 一定要有，其他沒有就用預設值
  function decodeWord(o) {
    if (!o || typeof o.id !== 'string' || typeof o.english !== 'string' || typeof o.chinese !== 'string') throw new Error('單字資料不對');
    const w = newWord(o.id, o.english, o.chinese, typeof o.category === 'string' ? o.category : '我加的',
      typeof o.isCustom === 'boolean' ? o.isCustom : true);
    if (Number.isInteger(o.correct)) w.correct = o.correct;
    if (Number.isInteger(o.wrong)) w.wrong = o.wrong;
    if (typeof o.lastSeen === 'number') w.lastSeen = o.lastSeen;
    if (typeof o.example === 'string') w.example = o.example;
    if (typeof o.exampleChinese === 'string') w.exampleChinese = o.exampleChinese;
    return w;
  }

  function encodeWord(w) {
    const o = { id: w.id, english: w.english, chinese: w.chinese, category: w.category, isCustom: w.isCustom, correct: w.correct, wrong: w.wrong };
    if (w.lastSeen != null) o.lastSeen = w.lastSeen;
    if (w.example != null) o.example = w.example;
    if (w.exampleChinese != null) o.exampleChinese = w.exampleChinese;
    return o;
  }

  function decodeStats(o) {
    const out = {};
    if (!o || typeof o !== 'object') return out;
    for (const [k, v] of Object.entries(o)) {
      const st = { correct: Number.isInteger(v.correct) ? v.correct : 0, wrong: Number.isInteger(v.wrong) ? v.wrong : 0 };
      if (typeof v.lastSeen === 'number') st.lastSeen = v.lastSeen;
      out[k] = st;
    }
    return out;
  }

  function encodeStats(o) {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      const st = { correct: v.correct, wrong: v.wrong };
      if (v.lastSeen != null) st.lastSeen = v.lastSeen;
      out[k] = st;
    }
    return out;
  }

  function intMap(o) {
    const out = {};
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (Number.isInteger(v)) out[k] = v;
    return out;
  }

  class Store {
    constructor(storage, key = 'starwords.json') {
      this.storage = storage;
      this.key = key;
      this.words = [];
      this.totalStars = 0;
      this.starsByDay = {};
      this.deck = { kind: 'all' };
      this.sentences = [];
      this.grammarStats = {};
      this.lexStats = {};
      this.answeredByDay = {};
      this.dailyGoal = 20;
      this.metDays = new Set();
      this.goalJustMet = false;
      this.listeners = new Set();
      this.load();
      this.mergeBuiltins();
    }

    changed() { for (const f of this.listeners) f(); }

    /// 照 Store.load()：整個檔讀不進來就當作沒有
    applyFile(text) {
      const file = JSON.parse(text);
      if (!file || !Array.isArray(file.words) || !Number.isInteger(file.totalStars) || typeof file.starsByDay !== 'object' || file.starsByDay === null) {
        throw new Error('不是星星單字的備份檔');
      }
      const words = file.words.map(decodeWord);
      const sentences = Array.isArray(file.sentences) ? file.sentences.map(decodeWord) : [];
      this.words = words;
      this.totalStars = file.totalStars;
      this.starsByDay = intMap(file.starsByDay);
      this.sentences = sentences;
      this.grammarStats = decodeStats(file.grammarStats);
      this.lexStats = decodeStats(file.lexStats);
      this.answeredByDay = intMap(file.answeredByDay);
      this.dailyGoal = Number.isInteger(file.dailyGoal) ? file.dailyGoal : 20;
      if (Array.isArray(file.metDays)) {
        this.metDays = new Set(file.metDays.filter(x => typeof x === 'string'));
      } else {
        // 這個功能之前的日子只有答對數，答對就夠目標的當作有達標
        this.metDays = new Set(Object.entries(this.starsByDay).filter(([, v]) => v >= this.dailyGoal).map(([k]) => k));
      }
      const today = dayKey();
      if (this.answeredByDay[today] == null && this.starsByDay[today] != null) this.answeredByDay[today] = this.starsByDay[today];
    }

    load() {
      let text = null;
      try { text = this.storage.getItem(this.key); } catch (e) { text = null; }
      if (!text) return;
      try { this.applyFile(text); } catch (e) { /* 讀不進來就當作沒有 */ }
    }

    /// 跟 App 的 starwords.json 一樣的格式
    serialize() {
      return JSON.stringify({
        words: this.words.map(encodeWord),
        totalStars: this.totalStars,
        starsByDay: this.starsByDay,
        sentences: this.sentences.map(encodeWord),
        grammarStats: encodeStats(this.grammarStats),
        lexStats: encodeStats(this.lexStats),
        answeredByDay: this.answeredByDay,
        dailyGoal: this.dailyGoal,
        metDays: [...this.metDays].sort(),
      });
    }

    save() {
      try { this.storage.setItem(this.key, this.serialize()); } catch (e) { console.log('存檔失敗：' + e); }
      this.changed();
    }

    /// 匯入備份：格式不對就丟錯、原本的資料不動
    importFile(text) {
      const backup = this.serialize();
      try {
        this.applyFile(text);
      } catch (e) {
        this.applyFile(backup);
        throw e;
      }
      this.mergeBuiltins(true);
      this.save();
    }

    mergeBuiltins(force) {
      const existing = new Set(this.words.map(w => w.id));
      const missing = Data.words.filter(w => !existing.has(w.id)).map(w => newWord(w.id, w.english, w.chinese, w.category, w.isCustom));
      this.words.push(...missing);
      const have = new Set(this.sentences.map(w => w.id));
      const missingS = Data.sentences.filter(w => !have.has(w.id)).map(w => newWord(w.id, w.english, w.chinese, w.category, w.isCustom));
      this.sentences.push(...missingS);
      if (!force && (missing.length || missingS.length)) this.save();
    }

    // MARK: 星星

    get todayStars() { return this.starsByDay[dayKey()] || 0; }

    record(id, correct) {
      const now = SW.date.nowRef();
      let w = this.words.find(x => x.id === id) || this.sentences.find(x => x.id === id);
      if (w) {
        if (correct) w.correct += 1; else w.wrong += 1;
        w.lastSeen = now;
      } else if (id.startsWith('g:') || id.startsWith('L:')) {
        const bag = id.startsWith('g:') ? this.grammarStats : this.lexStats;
        const st = bag[id] || { correct: 0, wrong: 0 };
        if (correct) st.correct += 1; else st.wrong += 1;
        st.lastSeen = now;
        bag[id] = st;
      } else {
        return;
      }
      if (correct) {
        this.totalStars += 1;
        this.starsByDay[dayKey()] = (this.starsByDay[dayKey()] || 0) + 1;
      }
      this.countAnswered(1);
      this.save();
    }

    // MARK: 每日目標

    get todayAnswered() { return this.answeredByDay[dayKey()] || 0; }
    get goalMetToday() { return this.metDays.has(dayKey()); }

    /// 連續達標幾天；今天還沒達標就從昨天往回算
    streakAt(now = new Date()) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
      if (!this.metDays.has(dayKey(now))) day.setDate(day.getDate() - 1);
      let n = 0;
      while (this.metDays.has(dayKey(day))) {
        n += 1;
        day.setDate(day.getDate() - 1);
      }
      return n;
    }
    get streak() { return this.streakAt(); }

    countAnswered(n) {
      this.answeredByDay[dayKey()] = (this.answeredByDay[dayKey()] || 0) + n;
      this.checkGoal();
    }

    checkGoal() {
      const today = dayKey();
      if (this.todayAnswered >= this.dailyGoal && !this.metDays.has(today)) {
        this.metDays.add(today);
        this.goalJustMet = true;
      }
    }

    setGoal(n) {
      this.dailyGoal = n;
      this.checkGoal();
      this.save();
    }

    // MARK: 單字本

    get categories() {
      const seen = new Set();
      return Data.words.map(w => w.category).filter(c => !seen.has(c) && seen.add(c));
    }

    get customWords() { return this.words.filter(w => w.isCustom); }

    pool(deck) {
      switch (deck.kind) {
        case 'all':
          return this.customWords.concat(...Levels.filter(l => l !== 'university').map(l => this.pool({ kind: 'level', level: l })));
        case 'custom': return this.customWords;
        case 'category': return this.words.filter(w => w.category === deck.name);
        case 'level': {
          const builtins = this.words.filter(w => !w.isCustom);
          const byEnglish = new Map();
          for (const w of builtins) { const k = w.english.toLowerCase(); if (!byEnglish.has(k)) byEnglish.set(k, w); }
          let out = Lexicon.entries(deck.level).map(e => byEnglish.get(e.english.toLowerCase()) || this.lexWord(e));
          if (deck.level === 'elementary') out = out.concat(builtins.filter(w => !Lexicon.keys.has(w.english.toLowerCase())));
          return out;
        }
      }
      return [];
    }

    lexWord(e) {
      const w = newWord('L:' + e.w, e.english, e.zh, e.levelLabel, false);
      const st = this.lexStats[w.id];
      if (st) { w.correct = st.correct; w.wrong = st.wrong; if (st.lastSeen != null) w.lastSeen = st.lastSeen; }
      return w;
    }

    hasCustom(english) {
      const k = english.toLowerCase();
      return this.words.some(w => w.isCustom && w.english.toLowerCase() === k);
    }

    addStars(n) {
      if (n <= 0) return;
      this.totalStars += n;
      this.starsByDay[dayKey()] = (this.starsByDay[dayKey()] || 0) + n;
      this.countAnswered(n);
      this.save();
    }

    add(english, chinese) {
      const en = trimWS(english), zh = trimWS(chinese);
      if (en === '' || zh === '') return false;
      if (this.words.some(w => w.english.toLowerCase() === en.toLowerCase() && w.isCustom)) return false;
      const id = 'c:' + uuid();
      this.words.unshift(newWord(id, en, zh, '我加的', true));
      this.save();
      return true;
    }

    // MARK: 例句

    example(w) {
      const b = Examples.builtin(w.english);
      if (b && !w.isCustom) return b;
      if (w.id.startsWith('L:')) {
        const e = Lexicon.entry(w.id.slice(2));
        if (e && e.ex != null) return [e.ex, e.exz ?? ''];
      }
      if (w.example != null && w.exampleChinese != null) return [w.example, w.exampleChinese];
      if (b) return b;
      const key = ' ' + w.english.toLowerCase() + ' ';
      const s = this.sentences.find(x => (' ' + Recognizer.normalize(x.english) + ' ').includes(key));
      return s ? [s.english, s.chinese] : null;
    }

    /// 一行一個：「apple 蘋果」「apple, 蘋果」「apple	蘋果」都可以
    addMany(text) {
      let n = 0;
      for (const line of text.split(/\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/)) {
        if (line === '') continue;
        const a = chars(line);
        const cut = a.findIndex(isCJK);
        if (cut < 0) continue;
        const en = trim(a.slice(0, cut).join(''), c => ' \t,，:：-='.includes(c) || c === ' ' || c === '\t' || /[\p{Zs}]/u.test(c));
        const zh = trim(a.slice(cut).join(''), c => c === '\t' || /[\p{Zs}]/u.test(c));
        if (this.add(en, zh)) n += 1;
      }
      return n;
    }

    delete(ids) {
      this.words = this.words.filter(w => !ids.has(w.id));
      this.save();
    }

    update(word) {
      const i = this.words.findIndex(w => w.id === word.id);
      if (i < 0) return;
      this.words[i] = word;
      this.save();
    }

    static weight(correct, wrong, lastSeen) {
      if (lastSeen == null) return 3;
      const days = (SW.date.nowRef() - lastSeen) / 86400;
      return Math.max(1 + wrong * 2 - correct * 0.4 + Math.min(days, 14) * 0.3, 0.2);
    }

    weightedPick(count, items) {
      const bag = items.slice();
      const out = [];
      while (out.length < count && bag.length) {
        const total = bag.reduce((a, b) => a + b[1], 0);
        let r = Math.random() * total;
        let idx = bag.length - 1;
        for (let i = 0; i < bag.length; i++) {
          r -= bag[i][1];
          if (r < 0) { idx = i; break; }
        }
        out.push(bag.splice(idx, 1)[0][0]);
      }
      return out;
    }

    /// 沒看過的、常錯的、很久沒碰的比較容易被抽到
    pick(count, pool) {
      return this.weightedPick(count, pool.map(w => [w, Store.weight(w.correct, w.wrong, w.lastSeen)]));
    }

    pickGrammar(count) { return this.pickByStats(count, Data.grammar, g => g.id); }

    pickByStats(count, items, id) {
      return this.weightedPick(count, items.map(item => {
        const st = this.grammarStats[id(item)] || { correct: 0, wrong: 0 };
        return [item, Store.weight(st.correct, st.wrong, st.lastSeen)];
      }));
    }
  }
  SW.Store = Store;

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID().toUpperCase();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    }).toUpperCase();
  }

  // MARK: - 拍照加字（WordScanner）

  const WordScanner = {
    skip: new Set(['a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are',
      'was', 'were', 'be', 'been', 'am', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
      'my', 'your', 'his', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'do', 'does', 'did', 'not', 'no',
      'yes', 'so', 'if', 'than', 'then', 'there', 'here', 'what', 'who', 'how', 'why', 'when', 'where', 'which',
      'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'shall',
      'unit', 'lesson', 'page', 'p', 'n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'vt', 'vi', 'ex', 'eg', 'etc']),

    /// 「apple 蘋果」「environment (n.) 環境」「take a shower 洗澡」
    pair(line) {
      const a = chars(line);
      const cut = a.findIndex(isCJK);
      if (cut < 0) return null;
      let en = a.slice(0, cut).join('');
      en = en.replace(/[(（\[【].*?[)）\]】]/g, ' ');
      const pieces = en.split(/\s+/u).filter(x => x !== '');
      const lastPiece = pieces[pieces.length - 1];
      const parts = pieces.filter(p => {
        const bare = trim(p, c => !isLetter(c)).toLowerCase();
        if (bare === '') return false;
        if (['n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'vt', 'vi', 'phr', 'aux'].includes(bare) && (p.endsWith('.') || p === lastPiece)) return false;
        return true;
      });
      const english = parts.map(p => trim(p, c => !(isLetter(c) || c === "'" || c === '-'))).filter(x => x !== '').join(' ');
      if (chars(english).length < 2 || !chars(english).every(c => isLetter(c) || c === ' ' || c === "'" || c === '-') || english.split(' ').length > 5) return null;
      let zh = trim(a.slice(cut).join(''), c => c === ' ' || c === '\t');
      const zc = chars(zh);
      const back = zc.findIndex(c => /[A-Za-z]/.test(c));
      if (back >= 0) zh = trim(zc.slice(0, back).join(''), c => c === ' ' || c === '\t');
      zh = trim(zh, c => ' ;；,，。.:：'.includes(c));
      if (zh === '') return null;
      return [english, zh];
    },

    words(line) {
      const m = line.match(/[A-Za-z][A-Za-z'’-]*[A-Za-z]/g) || [];
      return m.map(w => w.replace(/’/g, "'")).map(w => w.endsWith("'s") ? w.slice(0, -2) : trim(w, c => c === "'" || c === '-'));
    },

    /// 兩次 OCR 的結果（中英一起讀的行、只讀英文的行）照原檔的順序整理成候選
    collect(pairLines, englishLines) {
      const hits = [];
      const seen = new Set();
      for (const line of pairLines) {
        const p = WordScanner.pair(line);
        if (!p) continue;
        const [en, zh] = p;
        const e = Lexicon.lookup(en);
        const key = en.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ id: key, english: en, chinese: zh, fromPage: true, level: e ? e.level : null, levelLabel: e ? e.levelLabel : null });
      }
      for (const line of englishLines) {
        for (const token of WordScanner.words(line)) {
          const lower = token.toLowerCase();
          if (WordScanner.skip.has(lower)) continue;
          const e = Lexicon.lookup(lower);
          const english = e ? e.english : lower;
          const key = english.toLowerCase();
          if (seen.has(key) || WordScanner.skip.has(key)) continue;
          if (!e && chars(lower).length < 4) continue;
          seen.add(key);
          hits.push({ id: key, english, chinese: e ? e.zh : '', fromPage: false, level: e ? e.level : null, levelLabel: e ? e.levelLabel : null });
        }
      }
      return hits;
    },
  };
  SW.WordScanner = WordScanner;

  // MARK: - 罰則種類（PenaltyKind）

  const PenaltyKind = {
    of(mode) {
      return { chinese: 'copy5', listen: 'dictation', dictation: 'dictation', trace: 'recall', sentence: 'copySentence', choice: 'match', arrange: 'rearrange' }[mode];
    },
    button(kind, n) {
      return {
        copy5: `罰寫 ${n} 個`, dictation: `罰聽寫 ${n} 個`, recall: `罰默寫 ${n} 個`,
        copySentence: `罰抄 ${n} 句`, match: '罰配對', rearrange: `罰重排 ${n} 句`,
      }[kind];
    },
    title(kind) {
      return { copy5: '罰寫', dictation: '罰聽寫', recall: '罰默寫', copySentence: '罰抄', match: '罰配對', rearrange: '罰重排' }[kind];
    },
    rows: kind => kind === 'copy5' ? 5 : 3,
    ghostFirst: kind => kind === 'copy5' || kind === 'copySentence',
    showsEnglish: kind => kind === 'copy5' || kind === 'copySentence',
    showsChinese: kind => kind !== 'dictation',
  };
  SW.PenaltyKind = PenaltyKind;

  /// 排句子的字卡：最後的 .!? 拿掉
  SW.arrangeTokens = function (s) {
    const t = s.split(' ').filter(x => x !== '');
    if (t.length) t[t.length - 1] = t[t.length - 1].replace(/[.!?]+$/, '');
    return t;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SW;
})(typeof globalThis !== 'undefined' ? globalThis : this);
