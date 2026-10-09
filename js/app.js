// 開 App：讀內建資料、建存檔、放首頁、註冊 service worker
(function () {
  'use strict';
  const SW = window.SW;

  async function boot() {
    const [builtin, lexicon] = await Promise.all([
      fetch('data/builtin.json').then(r => r.json()),
      fetch('data/lexicon.json').then(r => r.json()),
    ]);
    SW.loadBuiltin(builtin, lexicon);
    const store = new SW.Store(window.localStorage);
    const essays = new SW.EssayStore(window.localStorage);
    SW.store = store;
    SW.essays = essays;
    const home = new SW.HomeView(store, essays);
    document.getElementById('app').appendChild(home.el);
    home.updateNow();
    SW.home = home;
    document.documentElement.setAttribute('data-ready', '1');
  }

  boot();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
