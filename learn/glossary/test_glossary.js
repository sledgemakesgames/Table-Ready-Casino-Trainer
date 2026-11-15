// Glossary regression tests (jsdom, runs the real page). Run: node test_glossary.js [path/to/index.html]
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
let failures = 0;
function check(desc, actual, expected){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(!ok){ failures++; console.log('FAIL:', desc, '| got', JSON.stringify(actual), 'expected', JSON.stringify(expected)); }
  else console.log('OK:', desc);
}
const FILE = process.argv[2] || path.join(__dirname, 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
function load(opts){
  opts = opts || {};
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://tableready.xyz/learn/glossary/' + (opts.hash || ''),
    beforeParse(w){
      w.matchMedia = q => ({ matches: q.includes('max-width:900px') ? !!opts.narrow : false, media: q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      if(opts.blockStorage){ const boom = () => { throw new w.Error('blocked'); }; Object.defineProperty(w, 'localStorage', { get: boom, configurable: true }); }
      if(opts.storage) Object.keys(opts.storage).forEach(k => w.localStorage.setItem(k, opts.storage[k]));
    }
  }).window;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const items = d => [...d.querySelectorAll('#list li')];
const names = d => items(d).filter(li => li.style.display !== 'none').map(li => li.querySelector('.it span').textContent);
const type = (w, text) => { const i = w.document.getElementById('q'); i.value = text; i.dispatchEvent(new w.Event('input', { bubbles: true })); };
const chip = (w, g) => w.document.querySelector('.chip[data-g="' + g + '"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const open = d => { const b = d.querySelector('.it[aria-current="true"]'); return b ? b.querySelector('span').textContent : null; };
const detail = d => ({ name: d.getElementById('dName').textContent, def: d.getElementById('dDef').textContent, tag: d.getElementById('dTag').textContent });
const clickItem = (w, name) => { const b = [...w.document.querySelectorAll('.it')].find(x => x.querySelector('span').textContent === name); b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return b; };
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

(async () => {
  let w = load(), d = w.document;
  await sleep(100);

  /* ---------- the words themselves (every term from before is still here, unchanged) ---------- */
  check('page loads without script errors', typeof w.TERMS, 'object');
  check('the filter chips: All, then General, the four card games and Craps', [...d.querySelectorAll('.chip')].map(b => b.dataset.g), ['', 'gen', 'bj', 'bc', 'pg', 'uth', 'cr']);
  check('the Craps chip says Craps', d.querySelector('.chip[data-g="cr"]').textContent.trim(), 'Craps');
  const byTag = t => w.TERMS.filter(x => x.tag === t).length;
  check('the original terms are all still there', [byTag('gen'), byTag('bj'), byTag('bc'), byTag('pg'), byTag('uth')], [4, 12, 10, 10, 7]);
  check('27 craps terms, every one with a name and a real definition', [byTag('cr'), w.TERMS.filter(x => x.tag === 'cr').every(x => x.name.length >= 2 && x.def.length > 25)], [27, true]);
  check('70 terms in all', w.TERMS.length, 70);
  check('no duplicate names inside a game', ['gen','bj','bc','pg','uth','cr'].every(t => { const n = w.TERMS.filter(x => x.tag === t).map(x => x.name); return new Set(n).size === n.length; }), true);
  check('every term is on the page once, with its definition ready for a phone', [items(d).length, items(d).every(li => li.querySelector('.inl').textContent.length > 10)], [70, true]);
  check('the list is alphabetical', (() => { const n = items(d).map(li => li.querySelector('.it span').textContent.toLowerCase()); return n.every((x, i) => i === 0 || n[i - 1].localeCompare(x) <= 0); })(), true);
  check('every term wears its game colour dot (six colours in use)', new Set([...d.querySelectorAll('.it')].map(b => b.style.getPropertyValue('--c'))).size, 6);

  check('no raw \\uXXXX escape shows anywhere on the page', /\\u[0-9a-fA-F]{4}/.test(d.getElementById('list').textContent), false);
  check('the Pai Gow entries show real apostrophes and dashes', [w.TERMS.find(x => x.name === 'Banker copy').def.includes('dealer’s.'), w.TERMS.find(x => x.name === 'Joker').def.includes('—')], [true, true]);

  const def = n => w.TERMS.find(x => x.tag === 'cr' && x.name === n).def;
  check('Pass Line: house edge 1.41%', /1\.41%/.test(def('Pass Line')), true);
  check('Don’t Pass: 1.36% and the barred 12', [/1\.36%/.test(def('Don’t Pass')), /12/.test(def('Don’t Pass'))], [true, true]);
  check('free odds: 2:1, 3:2, 6:5 and no house edge', [/2:1/.test(def('Free odds')), /3:2/.test(def('Free odds')), /6:5/.test(def('Free odds')), /no edge/.test(def('Free odds'))], [true, true, true, true]);
  check('Place pays 9:5, 7:5, 7:6', ['9:5','7:5','7:6'].map(x => def('Place bet').includes(x)), [true, true, true]);
  check('Buy: true odds minus a 5% commission', [/true odds/.test(def('Buy bet')), /5%/.test(def('Buy bet')), /5%/.test(def('Vig'))], [true, true, true]);
  check('Field: 2 pays 2:1, 12 pays 3:1, loses on 5 6 7 8', [/2:1/.test(def('Field')), /3:1/.test(def('Field')), /5, 6, 7 and 8/.test(def('Field'))], [true, true, true]);
  check('hardways pay 7:1 and 9:1', [/7:1 on 4 and 10/.test(def('Hardway')), /9:1 on 6 and 8/.test(def('Hardway'))], [true, true]);
  check('one-roll payouts: Any Seven 4:1 (16.7%), Any Craps 7:1, Yo 15:1, snake eyes 30:1, ace-deuce 15:1, boxcars 30:1', [/4:1/.test(def('Any Seven')) && /16\.7%/.test(def('Any Seven')), /7:1/.test(def('Any Craps')), /15:1/.test(def('Yo')), /30:1/.test(def('Snake eyes')), /15:1/.test(def('Ace-deuce')), /30:1/.test(def('Boxcars'))], [true, true, true, true, true, true]);
  check('3-4-5x odds: 3x, 4x, 5x', [/3x/.test(def('3-4-5x odds')), /4x/.test(def('3-4-5x odds')), /5x/.test(def('3-4-5x odds'))], [true, true, true]);

  /* ---------- the reader ---------- */
  check('opens on the most basic idea, "House edge", in the big panel', [open(d), detail(d).name, /expressed as a percentage/.test(detail(d).def)], ['House edge', 'House edge', true]);
  check('the panel says which game and where it sits in the list', detail(d).tag.replace(/\s+/g, ' ').trim(), 'General · 37 of 70');
  check('and the count line says 70 terms', d.getElementById('count').textContent, '70 terms');
  clickItem(w, 'Soft 17');
  check('clicking a term shows it, with its own definition', [open(d), detail(d).name, detail(d).def === w.TERMS.find(x => x.name === 'Soft 17').def], ['Soft 17', 'Soft 17', true]);
  check('"More in Blackjack" offers other Blackjack terms only, not itself', (() => { const rel = [...d.querySelectorAll('#rel button')].map(b => b.textContent); return [rel.length > 0 && rel.length <= 6, rel.includes('Soft 17'), rel.every(n => w.TERMS.some(x => x.name === n && x.tag === 'bj'))]; })(), [true, false, true]);
  d.querySelector('#rel button').click();
  check('a related term opens when clicked', open(d) !== 'Soft 17' && w.TERMS.find(x => x.name === open(d)).tag === 'bj', true);
  clickItem(w, 'Hit');
  d.getElementById('next').click();
  check('the next arrow moves to the next term in the list', open(d), 'House edge');
  d.getElementById('prev').click(); d.getElementById('prev').click();
  check('previous goes back (twice from House edge lands on High hand / Low hand)', open(d), 'High hand / Low hand');
  clickItem(w, '3-4-5x odds'); d.getElementById('prev').click();
  check('previous from the first term wraps to the last', open(d), 'Yo');
  d.getElementById('next').click();
  check('and next from the last wraps to the first', open(d), '3-4-5x odds');
  const hb = [...d.querySelectorAll('.it')].find(b => b.querySelector('span').textContent === 'Hit');
  hb.focus(); key(w, hb, 'ArrowDown');
  check('the Down arrow key in the list opens the next term and moves focus to it', [open(d), d.activeElement.querySelector('span').textContent], ['House edge', 'House edge']);
  key(w, d.activeElement, 'ArrowUp'); key(w, d.activeElement, 'ArrowUp');
  check('Up arrow goes the other way', open(d), 'High hand / Low hand');

  /* ---------- filtering and search ---------- */
  chip(w, 'cr');
  check('the Craps chip shows only craps terms', [names(d).length, names(d).every(n => w.TERMS.some(x => x.name === n && x.tag === 'cr'))], [27, true]);
  check('the chip is pressed, the others are not', [...d.querySelectorAll('.chip')].map(c => c.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false', 'false', 'false', 'true']);
  check('the count says 27 of 70 and the open term moved into the filter', [d.getElementById('count').textContent, w.TERMS.find(x => x.name === open(d)).tag], ['27 of 70 terms', 'cr']);
  chip(w, 'bc');
  check('the Baccarat chip shows ten', names(d).length, 10);
  chip(w, '');
  check('All shows everything', names(d).length, 70);
  type(w, 'come-out');
  check('searching "come-out" finds the craps terms that mention it', names(d).includes('Come-out roll') && names(d).includes('Natural') && names(d).every(n => w.TERMS.some(x => x.name === n && x.tag === 'cr')), true);
  type(w, 'natural');
  check('"natural" finds the Baccarat, the craps and the Blackjack entry', names(d).filter(n => /natural/i.test(n)).length, 3);
  type(w, 'commission');
  check('"commission" finds Baccarat, Pai Gow and the craps Buy bet', ['Commission','Commission-free','Buy bet','Vig'].every(n => names(d).includes(n)), true);
  check('search is not case sensitive and trims spaces', (type(w, '  COMMISSION '), names(d).includes('Vig')), true);
  type(w, 'zzzz');
  check('no match shows the empty message and hides the panel', [names(d).length, d.getElementById('none').style.display, d.getElementById('detail').style.visibility, d.getElementById('count').textContent], [0, 'block', 'hidden', '0 of 70 terms']);
  type(w, '');
  check('clearing the search brings everything back and hides the message', [names(d).length, d.getElementById('none').style.display, d.getElementById('detail').style.visibility], [70, 'none', '']);
  chip(w, 'cr'); type(w, 'seven');
  check('the Craps chip plus "seven" finds Any Seven and Seven out, and only craps terms', [['Any Seven','Seven out'].every(n => names(d).includes(n)), names(d).every(n => w.TERMS.some(x => x.name === n && x.tag === 'cr'))], [true, true]);
  chip(w, 'bj');
  check('the same search under Blackjack finds none of them', names(d).includes('Any Seven'), false);
  type(w, ''); chip(w, '');
  const q = d.getElementById('q');
  d.body.focus(); key(w, d.body, '/');
  check('pressing / jumps to the search box', d.activeElement.id, 'q');
  key(w, q, '/');
  check('and typing / inside the box does not steal focus again or break typing', d.activeElement.id, 'q');
  const bank = d.getElementById('bankroll-amount');
  check('the header carries the bankroll pill', /^\$[\d,]+$/.test(bank.textContent), true);

  /* ---------- addresses: a term can be shared ---------- */
  const slugs = w.TERMS.map(t => t.slug).filter(Boolean);
  const sl = [...d.querySelectorAll('#list li')].map(li => li.id);
  check('every term has its own address, no two alike', [sl.length, new Set(sl).size], [70, 70]);
  check('the two "Natural" entries are told apart by game', [sl.includes('t-natural'), sl.includes('t-natural-cr')], [true, true]);
  clickItem(w, 'Soft 17');
  check('opening a term puts it in the address bar', w.location.hash, '#soft-17');
  w.close();
  w = load({ hash: '#soft-17' }); d = w.document; await sleep(100);
  check('a shared link opens straight on that term', [open(d), detail(d).name], ['Soft 17', 'Soft 17']);
  w.close();
  w = load({ hash: '#natural-cr' }); d = w.document; await sleep(100);
  check('the craps "Natural" opens from its own address', [open(d), w.TERMS.find(x => x.name === open(d)) && detail(d).tag.includes('Craps')], ['Natural', true]);
  w.close();
  w = load({ hash: '#does-not-exist' }); d = w.document; await sleep(100);
  check('an address that matches nothing just opens the normal first term', open(d), 'House edge');
  w.location.hash = '#bust'; await sleep(60);
  check('changing the address while the page is open follows it', open(d), 'Bust');
  chip(w, 'cr'); w.location.hash = '#hit'; await sleep(60);
  check('even when a filter would have hidden that term (the filter is cleared)', [open(d), names(d).length], ['Hit', 70]);
  w.close();
  w = load({ hash: '#%E0%A4%A' }); d = w.document; await sleep(100);
  check('a malformed address does not break the page', [typeof w.TERMS, open(d)], ['object', 'House edge']);
  w.close();

  /* ---------- on a phone: a closed list that opens one term at a time ---------- */
  w = load({ narrow: true }); d = w.document; await sleep(100);
  check('on a phone every term starts closed', [open(d), items(d).length], [null, 70]);
  clickItem(w, 'Hit');
  check('tapping a term opens it', open(d), 'Hit');
  clickItem(w, 'Hit');
  check('tapping it again closes it', open(d), null);
  clickItem(w, 'Stand'); clickItem(w, 'Split');
  check('opening another closes the first (one at a time)', [open(d), d.querySelectorAll('.it[aria-current="true"]').length], ['Split', 1]);
  w.close();
  w = load({ narrow: true, hash: '#bust' }); d = w.document; await sleep(100);
  check('a shared link opens its term on a phone too', open(d), 'Bust');
  w.close();

  /* ---------- the page around it ---------- */
  w = load(); d = w.document; await sleep(100);
  check('meta description names all five games', ['Blackjack','Baccarat','Pai Gow Poker','Ultimate Texas Hold\'em','Craps'].every(g => d.querySelector('meta[name="description"]').content.includes(g)), true);
  check('title, canonical and social tags', [d.title, d.querySelector('link[rel="canonical"]').href, d.querySelector('meta[property="og:url"]').content, !!d.querySelector('meta[property="og:title"]')], ['Glossary — Table Ready', 'https://tableready.xyz/learn/glossary/', 'https://tableready.xyz/learn/glossary/', true]);
  check('the page says all five games', /all five games/.test(d.querySelector('.sub').textContent), true);
  check('one h1, and the nav marks the Glossary as the current page', [d.querySelectorAll('h1').length, d.querySelector('.nav a[aria-current="page"]').getAttribute('href')], [1, '/learn/glossary/']);
  check('brand, Learn to play and the footer links are absolute', [d.querySelector('.brand').getAttribute('href'), !!d.querySelector('.nav a[href="/learn/"]'), !!d.querySelector('footer a[href="/learn/glossary/"]')], ['/', true, true]);
  check('the disclaimer is still there', /not real-money gambling/.test(d.querySelector('footer').textContent), true);
  w.close();

  /* ---------- the header coin flips ---------- */
  w = load({ storage: {} }); d = w.document; await sleep(60);
  w.Math.random = () => 0.9;
  const coin = d.getElementById('brand-coin'), inner = coin.querySelector('.coin-in');
  check('the coin is a button beside the home link, not inside it', [coin.tagName, !!coin.closest('a'), d.querySelector('a.brand').getAttribute('href')], ['BUTTON', false, '/']);
  coin.click();
  check('a click turns it over to a suit', [inner.style.transform, coin.querySelector('.suit').textContent], ['rotateY(180deg)', '♣']);
  coin.click();
  check('and another turns it the same way round to the front again', [inner.style.transform, coin.getAttribute('data-side')], ['rotateY(360deg)', 'front']);
  w.close();

  /* ---------- bankroll + theme share the landing page's saved values ---------- */
  w = load({ storage: { house_edge_bankroll_v1: JSON.stringify({ balance: 2750 }), house_edge_theme_v1: 'crimson' } }); d = w.document; await sleep(100);
  check('the bankroll pill shows the shared balance', d.getElementById('bankroll-amount').textContent, '$2,750');
  check('the theme chosen on the landing page is used here', [d.documentElement.getAttribute('data-theme'), d.documentElement.style.getPropertyValue('--brass'), [...d.querySelectorAll('.themes button')].map(b => b.getAttribute('aria-pressed')).join()], ['crimson', '#D6935A', 'false,false,false,true']);
  d.querySelector('.themes button[data-th="midnight"]').click();
  check('and changing it here is remembered for the landing page', [w.localStorage.getItem('house_edge_theme_v1'), d.documentElement.style.getPropertyValue('--brass')], ['midnight', '#4FB8E0']);
  w.close();
  for(const bad of ['nope', '__proto__', 'constructor', '']){
    w = load({ storage: { house_edge_theme_v1: bad } }); d = w.document; await sleep(60);
    check('an unknown saved theme "' + bad + '" is ignored: Graphite stays', [d.documentElement.getAttribute('data-theme'), [...d.querySelectorAll('.themes button')].map(b => b.getAttribute('aria-pressed')).join()], ['graphite', 'true,false,false,false']);
    w.close();
  }
  w = load({ blockStorage: true }); d = w.document; await sleep(100);
  check('with storage blocked the page still works', [d.getElementById('bankroll-amount').textContent, names(d).length, (() => { try{ d.querySelector('.themes button[data-th="emerald"]').click(); return d.documentElement.getAttribute('data-theme'); }catch(e){ return 'threw'; } })()], ['$1,000', 70, 'emerald']);
  w.close();

  console.log('\nTOTAL FAILURES:', failures);
  process.exit(failures ? 1 : 0);
})();
