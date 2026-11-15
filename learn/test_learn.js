// Formal regression test suite for the learn-to-play page, run via jsdom against the actual page.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(desc, actual, expected){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(!ok){ failures++; console.log('FAIL:', desc, '| got', JSON.stringify(actual), 'expected', JSON.stringify(expected)); }
  else console.log('OK:', desc);
}

function loadPage(){
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  return new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, beforeParse(window){
    // jsdom doesn't implement IntersectionObserver; the page only uses it for scroll-triggered
    // fade-in and progress-dot tracking, neither of which this test suite needs to exercise.
    window.IntersectionObserver = class { constructor(cb){this.cb=cb;} observe(){} unobserve(){} disconnect(){} };
  }});
}
function click(el, window){ el.dispatchEvent(new window.Event('click', {bubbles:true})); }
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

function run(testFn){
  return new Promise((resolve) => {
    const dom = loadPage();
    const { window } = dom;
    const { document } = window;
    setTimeout(async () => {
      try { await testFn(window, document); }
      catch(e){
        failures++;
        console.log('FAIL (exception):', e.message);
        console.log(e.stack.split('\n').slice(0,6).join('\n'));
      }
      resolve();
    }, 150);
  });
}


function loadPageAt(url){
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  return new JSDOM(html, { url, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, beforeParse(window){
    window.IntersectionObserver = class { constructor(cb){this.cb=cb;} observe(){} unobserve(){} disconnect(){} };
  }});
}
function runAt(url, testFn){
  return new Promise((resolve) => {
    const dom = loadPageAt(url);
    const { window } = dom;
    setTimeout(async () => {
      try { await testFn(window, window.document); }
      catch(e){ failures++; console.log('FAIL (exception):', e.message); console.log(e.stack.split('\n').slice(0,6).join('\n')); }
      resolve();
    }, 150);
  });
}

async function main(){

console.log('=== PAGE LOAD AND STRUCTURE ===');
await run(async (window, document) => {
  check('page loads without error', !!document.getElementById('switch-blackjack'), true);
  check('all five switch buttons present', ['switch-blackjack','switch-baccarat','switch-paigow','switch-uth','switch-craps'].every(id => !!document.getElementById(id)), true);
  check('all five game panels present', ['panel-blackjack','panel-baccarat','panel-paigow','panel-uth','panel-craps'].every(id => !!document.getElementById(id)), true);
  check('blackjack is the default active panel', document.getElementById('panel-blackjack').classList.contains('active'), true);
  check('only one panel is active on load', document.querySelectorAll('.game-panel.active').length, 1);
});

console.log('');
console.log('=== SCENE COUNTS: Craps added without disturbing the other four games ===');
await run(async (window, document) => {
  check('blackjack has its original 7 scenes', document.getElementById('blackjack-scenes').children.length, 7);
  check('baccarat has its original 7 scenes', document.getElementById('baccarat-scenes').children.length, 7);
  check('CRITICAL: pai gow has all 9 new scenes', document.getElementById('paigow-scenes').children.length, 9);
  check('uth has its original 10 scenes', document.getElementById('uth-scenes').children.length, 10);
  check('CRITICAL: craps has all 11 scenes', document.getElementById('craps-scenes').children.length, 11);
});

console.log('');
console.log('=== SWITCHING: cycling through all five games lands on the right panel each time, with no leakage ===');
await run(async (window, document) => {
  const order = ['baccarat','paigow','uth','craps','blackjack','craps','paigow'];
  for(const game of order){
    click(document.getElementById('switch-'+game), window);
    await wait(350);
    check('switching to '+game+' activates the correct panel', document.querySelector('.game-panel.active').id, 'panel-'+game);
    check('switching to '+game+' leaves exactly one panel active', document.querySelectorAll('.game-panel.active').length, 1);
    check('switching to '+game+' marks the correct button active', document.getElementById('switch-'+game).classList.contains('active'), true);
    check('switching to '+game+' updates the progress rail to match its scene count', document.getElementById('progress-rail').children.length, document.getElementById(game+'-scenes').children.length);
  }
});

console.log('');
console.log('=== PAI GOW SCENE CONTENT: headings present, sensible card counts per scene ===');
await run(async (window, document) => {
  const scenes = [...document.getElementById('paigow-scenes').children];
  const expectedCardCounts = [7,7,3,7,7,4,5,0,0];
  scenes.forEach((s, i) => {
    const heading = s.querySelector('.scene-text h2');
    check('scene '+(i+1)+' has a non-empty heading', !!heading && heading.textContent.trim().length > 0, true);
    check('scene '+(i+1)+' has the expected card count', s.querySelectorAll('.card').length, expectedCardCounts[i]);
  });
});

console.log('');
console.log('=== JOKER CARD RENDERING (Pai Gow scene 3) ===');
await run(async (window, document) => {
  const scene3 = document.getElementById('paigow-scenes').children[2];
  const jokers = scene3.querySelectorAll('.card.joker');
  check('CRITICAL: exactly 3 joker cards render in the joker-explainer scene', jokers.length, 3);
  check('joker card shows JOKER down both corners and a star in a ring', [jokers[0].textContent.replace(/\s/g, ''), jokers[0].querySelectorAll('svg.cf polygon').length >= 4], ['JOKERJOKER', true]);
  check('CRITICAL: joker card computes to the violet color, not the default text color', window.getComputedStyle(jokers[0]).color, 'var(--violet)');
});

console.log('');
console.log('=== VALUE-HIGHLIGHT GLOW (Pai Gow scene 5, matching the actual game\'s visual language) ===');
await run(async (window, document) => {
  const scene5 = document.getElementById('paigow-scenes').children[4];
  const highlighted = scene5.querySelectorAll('.card.value-highlight');
  check('CRITICAL: exactly the pair (2 cards) gets the value-highlight treatment, not the whole hand', highlighted.length, 2);
  check('highlighted card actually has a visible box-shadow glow', window.getComputedStyle(highlighted[0]).boxShadow !== 'none', true);
});

console.log('');
console.log('=== FOUL EXAMPLE (Pai Gow scene 2) ===');
await run(async (window, document) => {
  const scene2 = document.getElementById('paigow-scenes').children[1];
  check('foul scene shows the correct warning tag text', scene2.querySelector('.win-tag').textContent, 'Fouls \u2014 automatic loss');
  check('foul scene uses the bad (red) tag styling, not the good (green) one', scene2.querySelector('.win-tag').classList.contains('bad'), true);
});

console.log('');
console.log('=== META TAGS: description updated to mention all five games ===');
await run(async (window, document) => {
  const desc = document.querySelector('meta[name="description"]').getAttribute('content');
  check('page description mentions Craps alongside the other four games', desc.includes('Pai Gow') && desc.includes('Blackjack') && desc.includes('Baccarat') && desc.includes('Ultimate Texas') && desc.includes('Craps'), true);
});

console.log('');
console.log('=== FACE CARD ICONS (recurring issue, flagged by user as missing "similar to before") ===');
await run(async (window, document) => {
  const jHtml = window.cardHTML('J','\u2660','');
  const qHtml = window.cardHTML('Q','\u2665','');
  const kHtml = window.cardHTML('K','\u2663','');
  const sevenHtml = window.cardHTML('7','\u2666','');
  const polys = h => { const d = document.createElement('div'); d.innerHTML = h; return d.querySelectorAll('svg.cf polygon').length; };
  const suitGroups = h => (h.match(/<g transform="translate\(/g) || []).length;
  check('CRITICAL: Jack renders with its court figure, not a blank center', polys(jHtml) > 0, true);
  check('CRITICAL: Queen renders with her court figure, not a blank center', polys(qHtml) > 0, true);
  check('CRITICAL: King renders with his court figure, not a blank center', polys(kHtml) > 0, true);
  check('number cards do NOT get a court figure', polys(sevenHtml), 0);
  check('a seven shows seven pips (and two index suits)', suitGroups(sevenHtml), 9);

  const wrap = document.createElement('div');
  wrap.innerHTML = window.cardHTML('K','\u2665','');
  document.body.appendChild(wrap);
  const blackWrap = document.createElement('div');
  blackWrap.innerHTML = window.cardHTML('K','\u2660','');
  document.body.appendChild(blackWrap);
  check('CRITICAL: a red-suit face card icon inherits the coral color via currentColor', window.getComputedStyle(wrap.querySelector('.card')).color, 'var(--coral)');
  check('a black-suit face card icon inherits the default ink color', window.getComputedStyle(blackWrap.querySelector('.card')).color, 'var(--ink)');
});

console.log('');
console.log('=== FACE CARD ICONS: comprehensive scan across every rendered card scene in the four card games ===');
await run(async (window, document) => {
  ['blackjack-scenes','baccarat-scenes','paigow-scenes','uth-scenes'].forEach(containerId => {
    const container = document.getElementById(containerId);
    const allCards = container.querySelectorAll('.card');
    let faceCount = 0, faceWithIcon = 0;
    allCards.forEach(cardEl => {
      const rankSpan = cardEl.querySelector('svg.cf text');
      const rank = rankSpan ? rankSpan.textContent : '';
      if(rank==='J'||rank==='Q'||rank==='K'){
        faceCount++;
        if(cardEl.querySelectorAll('svg.cf polygon').length > 0) faceWithIcon++;
      }
    });
    check('CRITICAL: every face card in '+containerId+' has its icon ('+faceCount+' found)', faceWithIcon, faceCount);
    check(containerId+' has at least one face card to actually verify this against', faceCount > 0, true);
  });
});

console.log('');
console.log('=== DEEP LINKS: /learn/#game opens that game\'s lesson directly ===');
const PANELS = ['blackjack','baccarat','paigow','uth','craps'];
for(const g of PANELS){
  await runAt('https://tableready.xyz/learn/#'+g, async (window, document) => {
    check('#'+g+' makes only the '+g+' panel active', PANELS.filter(x => document.getElementById('panel-'+x).classList.contains('active')), [g]);
    check('#'+g+' highlights the matching switch button', PANELS.filter(x => document.getElementById('switch-'+x).classList.contains('active')), [g]);
    check('#'+g+' shows its panel immediately (fade-in applied, no flash of another game)', document.getElementById('panel-'+g).classList.contains('fade-in'), true);
    check('#'+g+' rebuilds the progress rail for that game', document.getElementById('progress-rail').children.length, document.getElementById(g+'-scenes').children.length);
  });
}
for(const bad of ['', '#', '#nonsense', '#constructor', '#__proto__', '#toString', '#BLACKJACK']){
  await runAt('https://tableready.xyz/learn/'+bad, async (window, document) => {
    check('bad/empty hash "'+bad+'" safely falls back to blackjack', PANELS.filter(x => document.getElementById('panel-'+x).classList.contains('active')), ['blackjack']);
  });
}

console.log('');
console.log('=== DEEP LINKS: the address bar follows the tabs, and back/forward-style hash changes work ===');
await runAt('https://tableready.xyz/learn/', async (window, document) => {
  click(document.getElementById('switch-baccarat'), window);
  await wait(400);
  check('switching tabs updates the hash', window.location.hash, '#baccarat');
  check('and the panel actually switched', document.getElementById('panel-baccarat').classList.contains('active'), true);
  window.location.hash = '#uth';
  await wait(500);
  check('changing the hash directly switches the lesson (hashchange)', document.getElementById('panel-uth').classList.contains('active'), true);
  check('exactly one panel stays active after a hashchange', document.querySelectorAll('.game-panel.active').length, 1);
});
await runAt('https://tableready.xyz/learn/?from=floor#paigow', async (window, document) => {
  click(document.getElementById('switch-uth'), window);
  await wait(400);
  check('the query string survives tab switching (still ?from=floor)', window.location.search, '?from=floor');
});

console.log('');
console.log('=== LANDING HANDOFF NOTE: only for visitors sent here from the floor ===');
await runAt('https://tableready.xyz/learn/', async (window, document) => {
  check('no note for ordinary visitors', document.getElementById('floor-note').classList.contains('show'), false);
});
await runAt('https://tableready.xyz/learn/?from=floor#baccarat', async (window, document) => {
  const note = document.getElementById('floor-note');
  check('note is shown when arriving from the floor', note.classList.contains('show'), true);
  check('note names the game being shown', document.getElementById('floor-note-game').textContent, 'Baccarat');
  check('skip link goes straight to that game\'s table', document.getElementById('floor-note-skip').getAttribute('href'), '/baccarat/');
  click(document.getElementById('switch-paigow'), window);
  await wait(400);
  check('note follows the tab: now names Pai Gow Poker', document.getElementById('floor-note-game').textContent, 'Pai Gow Poker');
  check('and skip link follows too', document.getElementById('floor-note-skip').getAttribute('href'), '/pai-gow/');
  click(document.getElementById('floor-note-dismiss'), window);
  check('dismiss hides the note', note.classList.contains('show'), false);
});
await runAt('https://tableready.xyz/learn/?from=somethingelse', async (window, document) => {
  check('an unrelated "from" value does not show the note', document.getElementById('floor-note').classList.contains('show'), false);
});

console.log('');
console.log('=== LESSON ENDINGS: every game lesson leads somewhere ===');
await run(async (window, document) => {
  const expected = { blackjack:'/blackjack/', baccarat:'/baccarat/', paigow:'/pai-gow/', uth:'/ultimate-texas-holdem/', craps:'/craps/' };
  for(const g of PANELS){
    const btn = document.getElementById('play-btn-'+g);
    check(g+' has a closing play button', !!btn, true);
    check(g+' play button goes to the right table', btn && btn.getAttribute('href'), expected[g]);
    check(g+' play button lives inside its own panel', !!btn && document.getElementById('panel-'+g).contains(btn), true);
  }
  check('canonical URL is the plain /learn/ page (deep links are not duplicate pages)', document.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://tableready.xyz/learn/');
});

console.log('');
console.log('=== CRAPS LESSON CONTENT: eleven scenes, real headings, dice that match what the text says ===');
await run(async (window, document) => {
  const scenes = [...document.getElementById('craps-scenes').children];
  const headings = ['Two dice, one roll','Some totals come up more','The come-out roll','The point','Make the point, or seven out',"Pass and Don't Pass",'Free odds: the best bet in the casino',"Come and Don't Come",'Place and Buy bets','Hardways','The Field and one-roll bets'];
  check('the scene headings, in order', scenes.map(s => s.querySelector('.scene-text h2').textContent), headings);
  scenes.forEach((s, i) => check('scene '+(i+1)+' has body text and a visual', [s.querySelector('.scene-text p').textContent.trim().length > 40, s.querySelector('.scene-visual').children.length > 0], [true, true]));
  const pips = el => [...el.querySelectorAll('.die')].map(d => d.querySelectorAll('i').length);
  check('scene 1: a 6 and a 4 make 10', [pips(scenes[0]), scenes[0].querySelector('.hand-total').textContent], [[6,4], '6 + 4 = 10']);
  check('scene 2: eleven bars with 1,2,3,4,5,6,5,4,3,2,1 ways, the 7 highlighted', [[...scenes[1].querySelectorAll('.ways .col')].map(c => +c.querySelector('.w').textContent), scenes[1].querySelectorAll('.ways .col.seven').length, scenes[1].querySelector('.ways .col.seven .n').textContent], [[1,2,3,4,5,6,5,4,3,2,1], 1, '7']);
  check('scene 2: every bar is as tall as its ways (20px each), so the chart is to scale', [...scenes[1].querySelectorAll('.ways .col')].every(c => parseInt(c.querySelector('.bar').style.height) === 20 * +c.querySelector('.w').textContent), true);
  const chips = (s, kind) => [...s.querySelectorAll('.numchip.'+kind)].map(c => +c.textContent);
  check('scene 3: 7 and 11 win, 2, 3 and 12 lose, 4 5 6 8 9 10 are points', [chips(scenes[2],'win'), chips(scenes[2],'lose'), chips(scenes[2],'pt')], [[7,11],[2,3,12],[4,5,6,8,9,10]]);
  check('scene 4: a 4 and a 2 set the point on the 6, with the puck ON the 6', [pips(scenes[3]), [...scenes[3].querySelectorAll('.numbox')].filter(b => b.querySelector('.puck')).map(b => b.querySelector('.nb-n').textContent)], [[4,2],['6']]);
  check('scene 5: the point made is a 6 (4+2) and the seven out is a 7 (4+3)', [pips(scenes[4]), [...scenes[4].querySelectorAll('.win-tag')].map(t => t.textContent)], [[4,2,4,3], ['Point made','Seven out']]);
  check('scene 6: two even-money chips and the real house edges (1.41% and 1.36%)', [scenes[5].querySelectorAll('.scene-visual div[style*="dashed"]').length, scenes[5].querySelector('.callout').textContent], [2, "House edge: Pass 1.41% · Don't Pass 1.36%"]);
  check('scene 7: true odds 2:1, 3:2, 6:5 and 0% edge', [[...scenes[6].querySelectorAll('.scene-visual div[style*="dashed"]')].map(c => [...c.children].map(x => x.textContent).join(' ')), scenes[6].querySelector('.callout').textContent], [['4 or 10 2:1','5 or 9 3:2','6 or 8 6:5'], 'House edge on the odds: 0%']);
  check('scene 8: a 5 and a 3 move the Come bet to the 8', [pips(scenes[7]), [...scenes[7].querySelectorAll('.numbox')].filter(b => b.querySelector('.minichip')).map(b => b.querySelector('.nb-n').textContent)], [[5,3],['8']]);
  check('scene 9: Buy 4/5/9/10 and Place 6/8, with the real pays', [...scenes[8].querySelectorAll('.numbox')].map(b => b.querySelector('.nb-n').textContent + ' ' + b.querySelector('.nb-cap').textContent), ['4 Buy2:1','5 Buy3:2','6 Place7:6','8 Place7:6','9 Buy3:2','10 Buy2:1']);
  check('scene 10: hard six is 3+3 and wins, easy six is 4+2 and loses', [pips(scenes[9]), [...scenes[9].querySelectorAll('.win-tag')].map(t => t.textContent)], [[3,3,4,2], ['Hardway wins 9:1','Hardway loses']]);
  check('scene 11: the Field wins on 2 3 4 9 10 11 12 and loses on 5 6 7 8', [chips(scenes[10],'win'), chips(scenes[10],'lose')], [[2,3,4,9,10,11,12],[5,6,7,8]]);
  check('scene 11: Any Seven keeps 16.7%', scenes[10].querySelector('.callout').textContent, 'Any Seven pays 4:1 — the casino keeps 16.7%');
  // the dice are drawn with the right number of pips and the aces are red
  const all = [...document.getElementById('craps-scenes').querySelectorAll('.die')];
  check('every die shows 1 to 6 pips', all.every(d => { const n = d.querySelectorAll('i').length; return n >= 1 && n <= 6; }), true);
  check('a die with one pip is marked as an ace; no other die is', all.every(d => d.classList.contains('one') === (d.querySelectorAll('i').length === 1)), true);
  check('the dice are never drawn as a card: no .card elements in the craps lesson', document.getElementById('craps-scenes').querySelectorAll('.card').length, 0);
  check('dice get a tumbling entrance and the reduced-motion rule switches it off', [window.document.documentElement.outerHTML.includes('.in-view .anim-roll{animation:dieRoll'), /prefers-reduced-motion[\s\S]*\.in-view \.anim-roll,\.in-view \.anim-grow\{animation:none !important/.test(window.document.documentElement.outerHTML) || /\.anim-roll,\.in-view \.anim-grow\{animation:none !important/.test(window.document.documentElement.outerHTML)], [true, true]);
});

console.log('');
console.log('=== CRAPS: the lesson is reachable the way the landing page sends people ===');
await runAt('https://tableready.xyz/learn/?from=floor#craps', async (window, document) => {
  check('the floor link opens the craps lesson with the right tab lit', [document.getElementById('panel-craps').classList.contains('active'), document.getElementById('switch-craps').classList.contains('active')], [true, true]);
  check('the handoff note names Craps and skips to the craps table', [document.getElementById('floor-note-game').textContent, document.getElementById('floor-note-skip').getAttribute('href')], ['Craps', '/craps/']);
  check('the progress rail has a dot for every scene', document.getElementById('progress-rail').children.length, 11);
});

console.log('');
console.log('=== RESTYLE: the shared Table Ready header, theme and bankroll ===');
function runWith(url, setup, testFn){
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  return new Promise((resolve) => {
    const dom = new JSDOM(html, { url, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, beforeParse(window){
      window.IntersectionObserver = class { constructor(cb){this.cb=cb;} observe(){} unobserve(){} disconnect(){} };
      window.matchMedia = window.matchMedia || (() => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }));
      if(setup) setup(window);
    }});
    setTimeout(async () => {
      try { await testFn(dom.window, dom.window.document); }
      catch(e){ failures++; console.log('FAIL (exception):', e.message); console.log(e.stack.split('\n').slice(0,6).join('\n')); }
      resolve();
    }, 200);
  });
}
await runWith('https://tableready.xyz/learn/', null, async (window, document) => {
  const hd = document.querySelector('header.top');
  check('the site header is there, with the brand pointing home', [!!hd, hd.querySelector('a.brand').getAttribute('href')], [true, '/']);
  const nav = [...hd.querySelectorAll('nav a')];
  check('the nav has Learn to play (current page), Glossary and My report', nav.map(a => [a.getAttribute('href'), a.getAttribute('aria-current')]), [['/learn/', 'page'], ['/learn/glossary/', null], ['/report/', null]]);
  check('four table themes in the header, Graphite pressed by default', [...hd.querySelectorAll('.themes button')].map(b => b.dataset.th + ':' + b.getAttribute('aria-pressed')), ['graphite:true', 'emerald:false', 'midnight:false', 'crimson:false']);
  check('the bankroll pill shows the shared starting bankroll', document.getElementById('bankroll-amount').textContent, '$1,000');
  check('and stores it under the same key the tables use', JSON.parse(window.localStorage.getItem('house_edge_bankroll_v1')).balance, 1000);
  check('there is a main landmark holding the tabs and lessons', [!!document.querySelector('main#main'), document.querySelector('main').contains(document.getElementById('panel-craps')), document.querySelector('main').contains(document.getElementById('switch-craps'))], [true, true, true]);
  check('the footer links to Learn and the Glossary and says it is for education only', [!!document.querySelector('footer a[href="/learn/"]'), !!document.querySelector('footer a[href="/learn/glossary/"]'), /for education only/i.test(document.querySelector('footer').textContent)], [true, true, true]);
  document.querySelector('.themes button[data-th="crimson"]').click();
  check('choosing Crimson in the header repaints the page and remembers it', [document.documentElement.getAttribute('data-theme'), document.documentElement.style.getPropertyValue('--brass'), window.localStorage.getItem('house_edge_theme_v1')], ['crimson', '#D6935A', 'crimson']);
});
await runWith('https://tableready.xyz/learn/', w => w.localStorage.setItem('house_edge_theme_v1', 'midnight'), async (window, document) => {
  check('a saved theme is applied from the head, before anything is painted', [document.documentElement.getAttribute('data-theme'), document.documentElement.style.getPropertyValue('--brass')], ['midnight', '#4FB8E0']);
});
for(const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'nonsense', '']){
  await runWith('https://tableready.xyz/learn/', w => {
    w.localStorage.setItem('house_edge_theme_v1', bad);
    w.__themeLog = []; const orig = w.Element.prototype.setAttribute;
    w.Element.prototype.setAttribute = function(n, v){ if(n === 'data-theme') w.__themeLog.push(String(v)); return orig.apply(this, arguments); };
  }, async (window, document) => {
    check('a hostile saved theme "' + bad + '" is never painted, not even for a moment (head script)', window.__themeLog.filter(v => v !== 'graphite'), []);
    check('a hostile saved theme "' + bad + '" is ignored (stays Graphite)', [document.documentElement.getAttribute('data-theme'), document.documentElement.style.getPropertyValue('--felt'), [...document.querySelectorAll('.themes button')].map(b => b.getAttribute('aria-pressed')).join()], ['graphite', '#0C0D10', 'true,false,false,false']);
  });
}
await runWith('https://tableready.xyz/learn/', w => w.localStorage.setItem('house_edge_bankroll_v1', '{not json'), async (window, document) => {
  check('a corrupted saved bankroll falls back to $1,000 instead of breaking the page', [document.getElementById('bankroll-amount').textContent, document.querySelectorAll('.scene').length], ['$1,000', 44]);
});
await runWith('https://tableready.xyz/learn/', w => w.localStorage.setItem('house_edge_bankroll_v1', JSON.stringify({balance: 2750})), async (window, document) => {
  check('the bankroll pill follows the real balance', document.getElementById('bankroll-amount').textContent, '$2,750');
});

console.log('');
console.log('=== RESTYLE: game tabs (aria-pressed, one lit at a time) ===');
await runAt('https://tableready.xyz/learn/', async (window, document) => {
  const pressed = () => PANELS.map(g => document.getElementById('switch-'+g).getAttribute('aria-pressed')).join();
  check('on load only Blackjack is pressed', pressed(), 'true,false,false,false,false');
  for(const g of ['craps', 'uth', 'baccarat', 'paigow', 'blackjack']){
    click(document.getElementById('switch-'+g), window); await wait(350);
    check('after choosing '+g+' exactly that tab is pressed and lit', [pressed(), PANELS.filter(x => document.getElementById('switch-'+x).classList.contains('active'))], [PANELS.map(x => String(x === g)).join(), [g]]);
  }
  window.location.hash = '#uth'; await wait(500);
  check('a hash change keeps aria-pressed in step too', pressed(), 'false,false,false,true,false');
  check('the tab buttons are real buttons inside a labelled group', [PANELS.every(g => document.getElementById('switch-'+g).tagName === 'BUTTON' && document.getElementById('switch-'+g).type === 'button'), document.querySelector('.game-switch').getAttribute('role'), !!document.querySelector('.game-switch').getAttribute('aria-label')], [true, 'group', true]);
});
await runAt('https://tableready.xyz/learn/#craps', async (window, document) => {
  check('a deep link marks the right tab pressed from the first paint', PANELS.map(g => document.getElementById('switch-'+g).getAttribute('aria-pressed')).join(), 'false,false,false,false,true');
});

console.log('');
console.log('=== RESTYLE: every lesson step is numbered, fitted and headed correctly ===');
await run(async (window, document) => {
  const counts = { blackjack: 7, baccarat: 7, paigow: 9, uth: 10, craps: 11 };
  for(const g of PANELS){
    const scenes = [...document.getElementById(g+'-scenes').children];
    check(g+': every step carries its own number, in order', scenes.map(s => (s.querySelector('.scene-text .step')||{}).textContent), scenes.map((s, i) => 'Step ' + (i + 1)));
    check(g+': the step label comes before the heading and is not a paragraph (the body text is still the first <p>)', scenes.every(s => s.querySelector('.scene-text').firstElementChild.classList.contains('step') && s.querySelector('.scene-text p') === s.querySelector('.scene-text').querySelectorAll('p')[0] && s.querySelector('.scene-text').children[1].tagName === 'H2'), true);
    check(g+': every picture sits inside a fit box (so it can shrink instead of being cut off)', scenes.every(s => s.querySelector('.scene-visual').firstElementChild.classList.contains('fit') && s.querySelector('.scene-visual').children.length === 1), true);
    check(g+': the hero says how many steps there are', document.querySelector('#panel-'+g+' .hero-n').textContent, ' · ' + counts[g] + ' steps');
    check(g+': the hero heading is the only h1 in its panel', document.querySelectorAll('#panel-'+g+' h1').length, 1);
  }
  const pg = [...document.getElementById('paigow-scenes').children];
  [0, 1, 3, 4].forEach(i => {
    const rows = [...pg[i].querySelectorAll('.hand-row')];
    check('pai gow step '+(i+1)+': the five-card hand and the two-card hand are on their own rows', [rows.length, rows.map(r => r.querySelectorAll('.card').length), rows[1].classList.contains('hand-low')], [2, [5, 2], true]);
  });
  check('no empty spacer divs are left in the pai gow hands', document.getElementById('paigow-scenes').querySelectorAll('div[style*="width:16px"]').length, 0);
});

console.log('');
console.log('=== RESTYLE: pictures shrink to fit their panel (fitVisuals) ===');
await run(async (window, document) => {
  const v = document.querySelector('#blackjack-scenes .scene-visual'), f = v.firstElementChild;
  const def = (el, name, val) => Object.defineProperty(el, name, { configurable: true, get: () => val });
  def(v, 'clientWidth', 300); def(f, 'offsetWidth', 600); def(f, 'offsetHeight', 100);
  const pad = parseFloat(window.getComputedStyle(v).paddingLeft) + parseFloat(window.getComputedStyle(v).paddingRight);
  window.fitVisuals();
  const z = parseFloat(((f.style.transform.match(/scale\(([\d.]+)\)/) || [])[1]));
  check('a picture twice as wide as the room is scaled to exactly fit', Math.abs(z - (300 - pad) / 600) < 0.001 && z < 0.5, true);
  check('and its height is given back, so the panel does not keep empty space', parseFloat(f.style.margin) === +(((z - 1) * 100) / 2).toFixed(1), true);
  def(f, 'offsetWidth', 200); window.fitVisuals();
  check('when it fits again the scale is removed', [f.style.transform, f.style.margin], ['', '']);
  def(f, 'offsetWidth', 300 - pad); window.fitVisuals();
  check('a picture that exactly fits is left alone', f.style.transform, '');
  def(v, 'clientWidth', 0); def(f, 'offsetWidth', 900); window.fitVisuals();
  check('a hidden panel (zero width) is never scaled to nothing', f.style.transform, '');
  check('fitting is re-run when the window is resized, when a tab opens and once the fonts are in', [/addEventListener\('resize'/.test(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')), /fonts\.ready\.then\(fitVisuals\)/.test(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')), (fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').match(/fitVisuals\(\);/g) || []).length >= 3], [true, true, true]);
});

console.log('');
console.log('=== RESTYLE: every colour the page asks for is defined (no silently invalid var()) ===');
await run(async (window, document) => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const used = new Set([...html.matchAll(/var\(--([a-z0-9-]+)\s*([,)])/g)].filter(m => m[2] === ')').map(m => m[1]));
  const defined = new Set([...html.matchAll(/(?:^|[\s{;"'])--([a-z0-9-]+)\s*:/g)].map(m => m[1]));
  Object.keys(window.TR_TH.graphite).forEach(k => defined.add(k));
  defined.add('back-img');   // set from script
  const missing = [...used].filter(n => !defined.has(n));
  check('no var(--x) without a definition (colours, fonts, chips)', missing, []);
  check('the lessons use the shared tokens only: no old Graphite-only names are left', ['--text-muted', '--card-face', '--sage-bright', '--dusty-blue'].filter(n => html.includes(n)), []);
  check('the page has no hard-coded old Graphite panel colour (#131519) left', html.includes('#131519'), false);
});

console.log('');
console.log('=== RESTYLE: head, no-script fallback, and nothing lost from the old page ===');
await run(async (window, document) => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  check('title, canonical and social tags are unchanged', [document.title, document.querySelector('meta[property="og:title"]').getAttribute('content'), document.querySelector('meta[property="og:url"]').getAttribute('content'), document.querySelector('meta[name="twitter:card"]').getAttribute('content')], ['Learn to Play — Table Ready', 'Learn to Play — Table Ready', 'https://tableready.xyz/learn/', 'summary_large_image']);
  check('the page still fades between pages (view transition)', html.includes('@view-transition { navigation: auto; }'), true);
  check('the head loads Space Grotesk and Inter, like the rest of the site', /fonts\.googleapis\.com\/css2\?family=Space\+Grotesk[^"]*&family=Inter/.test(html), true);
  check('the no-script note links straight to all five tables', ['/blackjack/', '/baccarat/', '/pai-gow/', '/ultimate-texas-holdem/', '/craps/'].every(h => new RegExp('<noscript>[\\s\\S]*href="' + h + '"[\\s\\S]*</noscript>').test(html)), true);
  check('the progress rail is decorative (hidden from screen readers)', document.getElementById('progress-rail').getAttribute('aria-hidden'), 'true');
  check('the old top bar and its extra "Back to the floor" link are gone (the brand goes home)', [document.querySelector('.topbar'), html.includes('Back to the floor')], [null, false]);
  check('no leftover css for the removed card index/pip markup', /card-idx|card-pip|face-card-icon/.test(html), false);
});

console.log('');
console.log('=== COIN: the header coin flips ===');
await runWith('https://tableready.xyz/learn/', w => { w.Math.random = () => 0.6; }, async (window, document) => {
  const coin = document.getElementById('brand-coin'), inner = coin.querySelector('.coin-in'), suit = coin.querySelector('.suit');
  check('the coin is a button next to (not inside) the home link', [coin.tagName, coin.getAttribute('aria-label'), !!coin.closest('a'), document.querySelector('a.brand').getAttribute('href')], ['BUTTON', 'Flip the coin', false, '/']);
  coin.click();
  check('a click turns it over and lands on a suit', [inner.style.transform, coin.getAttribute('data-side'), suit.textContent], ['rotateY(180deg)', 'back', '♦']);
  coin.click();
  check('the next click carries on the same way round (360deg) and shows the front', [inner.style.transform, coin.getAttribute('data-side')], ['rotateY(360deg)', 'front']);
  check('flipping it does not leave the lessons page or change the open lesson', [window.location.pathname, document.querySelectorAll('.game-panel.active').length], ['/learn/', 1]);
});

console.log('');
console.log('TOTAL FAILURES:', failures);
process.exit(failures > 0 ? 1 : 0);
}

main();
