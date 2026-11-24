// "Practice your mistakes": the practice drill rebuilt from the session log (Blackjack hands, Hold'em pre-flop spots), in a real browser.
// Run from the site folder:  node test_mistakes.js [blackjack|ultimate-texas-holdem|report]
const { chromium } = require('playwright');
const path = require('path');
let oks = 0, failures = 0;
function ok(cond, desc, extra){ if(cond){ oks++; console.log('OK:', desc); } else { failures++; console.log('FAIL:', desc, extra === undefined ? '' : '| ' + JSON.stringify(extra)); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now() - 3 * 3600 * 1000;

function session(g, decisions){
  // one hand per decision, 60 seconds apart; row = [secs, wagered, net, edge, mistakes, decisions, bankroll, count]
  const h = decisions.map((d, i) => [60 + i * 60, 10, -10, 0.1, d[3], [d], 990, 1]);
  return {v: 1, s: [{id: 'seed' + g, g, t0: T0, t1: T0 + 60000 * (decisions.length + 2), b0: 1000, h}]};
}
const BJ = [
  ['hard', 'H', 'S', 1.20, 'hard 16 v 10'],
  ['soft', 'S', 'D', 0.80, 'soft 18 v 6'],
  ['pair', 'H', 'P', 0.50, 'pair of 8s v ace'],
  ['hard', 'S', 'H', 0.30, 'hard 12 v 2'],
  ['hard', 'H', 'S', 0.20, 'hard 20 v 5'],         // cannot be rebuilt as a two-card hand: left out
  ['ins', 'INS', 'NOINS', 0.07, 'insurance'],      // not a play spot
  ['side', 'pp', 'none', 0.10, 'Perfect Pairs $5']  // not a play spot
];
const UTH = [
  ['pre', '3x', '4x', 0.90, 'A-K offsuit'],
  ['pre', 'check', '4x', 0.50, 'pair of 7s'],
  ['pre', '4x', 'check', 0.20, '9-4 offsuit'],
  ['flop', 'check', '2x', 0.40, 'A-K offsuit, flop'],   // flops and rivers cannot be rebuilt
  ['river', 'fold', '1x', 0.30, 'two pair']
];

async function open(browser, game, vp, log, hash){
  const ctx = await browser.newContext({viewport: vp, isMobile: vp.width < 600, hasTouch: vp.width < 600});
  await ctx.addInitScript(seed => {
    try{
      localStorage.setItem('house_edge_experience_v1', JSON.stringify({level: 'pro', updated: Date.now()})); localStorage.setItem('soft17_sound', 'off');
      if(seed && !sessionStorage.getItem('seeded')){ if(seed.log) localStorage.setItem('house_edge_log_v1', JSON.stringify(seed.log)); if(seed.prac) localStorage.setItem('house_edge_practice_v1', JSON.stringify(seed.prac)); sessionStorage.setItem('seeded', '1'); }
    }catch(e){}
  }, {log, prac: null});
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + path.join(__dirname, game, 'index.html') + (hash || ''), {waitUntil: 'load'}); await sleep(1100);
  const click = async s => { try{ await p.click(s, {timeout: 900}); return true; }catch(e){ return false; } };
  await click('#btn-tablesetup-continue'); await sleep(250); await click('#cutcard-preset-75'); await sleep(250);
  return {ctx, p, errs, click};
}
const ST = p => p.evaluate(() => TRPractice.state());
const txt = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent : null; }, sel);

async function drill(browser, game, decisions, expectTags, expectSpots, answers){
  console.log('\n== ' + game + ' mistakes drill');
  const {ctx, p, errs, click} = await open(browser, game, {width: 1440, height: 900}, session(game, decisions));
  const mist = await p.evaluate(g => TRPractice.mistakes(g).map(m => m.ctx), game);
  ok(mist.length >= expectSpots, 'the log holds the spots as a list, costliest first', mist);

  await click('#btn-practice'); await sleep(300);
  let chooser = await p.evaluate(() => { const m = document.querySelector('#tr-prac [data-k="mine"]'), x = document.querySelector('#tr-prac [data-k="mix"]'); return {mine: m && m.textContent, mix: x && x.textContent, st: TRPractice.state()}; });
  ok(chooser.st && chooser.st.phase === 'choose', 'with mistakes on file, the Practice button opens a chooser first', chooser.st);
  ok(chooser.mine && chooser.mine.indexOf(expectSpots + ' spots') >= 0, 'the chooser counts the spots that can be replayed (' + expectSpots + ')', chooser.mine);
  ok(chooser.mine && /\$\d/.test(chooser.mine), 'and shows what they cost', chooser.mine);
  ok(chooser.mix && /Mixed practice/.test(chooser.mix), 'mixed practice is still one click away');

  // mixed still works and is untouched by the log
  await p.click('#tr-prac [data-k="mix"]'); await sleep(200);
  let s = await ST(p);
  ok(s.mode === 'mix' && s.total === 10 && s.phase === 'ask', 'mixed practice: ten fresh questions', s);
  await p.keyboard.press('Escape'); await sleep(200);
  ok((await ST(p)) === null, 'Escape closes it');

  // the mistakes drill
  await click('#btn-practice'); await sleep(300);
  await p.keyboard.press('1'); await sleep(250);
  s = await ST(p);
  ok(s && s.mode === 'mine' && s.total === expectSpots, 'key 1 starts the mistakes drill, one question per spot', s);
  const meta = await txt(p, '#tr-prac .pp-meta');
  ok(/Your mistake 1 of /.test(meta || ''), 'the counter says these are your mistakes', meta);
  const bars = await p.evaluate(() => document.querySelectorAll('#tr-prac .pp-bar i').length);
  ok(bars === expectSpots, 'the progress bar has one segment per spot', bars);

  const seen = [];
  let wrongOnce = false;
  for(let i = 0; i < 40; i++){
    s = await ST(p);
    if(!s || s.phase === 'done') break;
    if(s.phase !== 'ask') break;
    if(!s.retry) seen.push(s.tag);
    const idx = seen.length - 1;
    const wrongThis = !s.retry && idx === 1 && !wrongOnce;           // miss the second question on purpose
    let key = s.answer;
    if(wrongThis){ const ks = await p.evaluate(() => Array.from(document.querySelectorAll('#tr-prac .pp-opt')).map(b => b.getAttribute('data-k'))); key = ks.find(k => k !== s.answer); wrongOnce = true; }
    await p.click('#tr-prac .pp-opt[data-k="' + key + '"]'); await sleep(120);
    const fb = await txt(p, '#tr-prac .pp-hist');
    if(!s.retry){
      ok(fb && /got this spot wrong \d+ time/.test(fb) && /\$\d/.test(fb), 'feedback says how often you got "' + s.tag + '" wrong and what it cost', fb);
      if(wrongThis) ok(fb && fb.indexOf('Cleared') < 0, 'a miss is not cleared');
      else ok(fb && fb.indexOf('Cleared from your list') >= 0, 'a right answer first time clears the spot', fb);
    }
    await p.click('#tr-prac #pp-next'); await sleep(120);
  }
  ok(JSON.stringify(seen) === JSON.stringify(expectTags), 'the questions come costliest first and match the logged spots', seen);
  const score = await txt(p, '#tr-prac .pp-score .pc-big');
  ok(score === (expectSpots - 1) + ' / ' + expectSpots, 'the score counts the spots, not a fixed ten (' + score + ')');
  const fixed = await p.evaluate(g => { const d = JSON.parse(localStorage.getItem('house_edge_practice_v1') || '{}'); return Object.keys((d._fixed || {})[g] || {}); }, game);
  ok(fixed.length === expectSpots - 1, 'every spot answered right first time is stored as cleared', fixed);
  const saved = await p.evaluate(g => { const d = JSON.parse(localStorage.getItem('house_edge_practice_v1') || '{}'); return d[g] || null; }, game);
  ok(!saved, 'the drill does not touch the best score of the mixed practice', saved);
  const btns = await p.evaluate(() => Array.from(document.querySelectorAll('#tr-prac .pp-act .pp-btn')).map(b => b.textContent));
  ok(btns.some(b => /More of my mistakes \(1 left\)/.test(b)), 'the summary offers the one spot still open', btns);

  // reopen: the cleared spots are gone from the list
  await p.click('#tr-prac #pp-done'); await sleep(250);
  await click('#btn-practice'); await sleep(300);
  chooser = await p.evaluate(() => { const m = document.querySelector('#tr-prac [data-k="mine"]'); return m && m.textContent; });
  ok(chooser && chooser.indexOf('1 spot ') >= 0, 'the chooser now shows only the spot still open', chooser);
  await p.click('#tr-prac [data-k="mine"]'); await sleep(200);
  s = await ST(p);
  ok(s.mode === 'mine' && s.total === 1 && s.tag === seen[1], 'and the drill replays exactly that one', s);
  await p.click('#tr-prac .pp-opt[data-k="' + s.answer + '"]'); await sleep(100); await p.click('#tr-prac #pp-next'); await sleep(150);
  ok((await txt(p, '#tr-prac .pp-score .pc-big')) === '1 / 1', 'cleared on the second drill');
  await p.click('#tr-prac #pp-done'); await sleep(250);

  // nothing left: the Practice button goes back to opening mixed questions directly
  await click('#btn-practice'); await sleep(300);
  s = await ST(p);
  ok(s && s.mode === 'mix' && s.phase === 'ask', 'with every spot cleared the Practice button goes straight to mixed questions', s);
  await p.keyboard.press('Escape'); await sleep(150);

  // a new slip at the table puts the spot back on the list
  await sleep(1300);
  await p.evaluate(g => TRLog.hand(g, {w: 10, n: -10, e: .1, m: 1, d: [['hard', 'H', 'S', 1, 'hard 16 v 10']], b: 990, k: 1}), game).catch(() => {});
  const back = await p.evaluate(g => TRPractice.mistakes(g).map(m => [m.ctx, m.n]), game);
  if(game === 'blackjack'){
    const h16 = back.find(m => m[0] === 'hard 16 v 10');
    ok(h16 && h16[1] === 1, 'a fresh mistake after clearing brings the spot back, counting only the new one', back);
    ok(!back.some(m => m[0] === 'soft 18 v 6' || m[0] === 'pair of 8s v ace'), 'and the other cleared spots stay off the list', back);
  }
  await ctx.close();
  ok(errs.length === 0, 'no page errors', errs);
}

async function direct(browser, game, decisions){
  console.log('\n== ' + game + ' #practice-mine link');
  const {ctx, p, errs} = await open(browser, game, {width: 1440, height: 900}, session(game, decisions), '#practice-mine');
  await sleep(900);
  let s = await ST(p);
  ok(s && s.mode === 'mine' && s.phase === 'ask', 'the Report link opens the mistakes drill directly', s);
  await p.keyboard.press('Escape'); await sleep(200);
  ok(!(await p.evaluate(() => location.hash)), 'closing it clears the hash');
  await ctx.close();

  const e = await open(browser, game, {width: 1440, height: 900}, null, '#practice-mine');
  await sleep(900);
  const empty = await txt(e.p, '#tr-prac .pp-q');
  ok(/No open mistakes/.test(empty || ''), 'with nothing on file the link says so and offers mixed practice', empty);
  await e.p.click('#tr-prac #pp-mix'); await sleep(200);
  s = await ST(e.p);
  ok(s && s.mode === 'mix' && s.total === 10, 'and that button starts mixed practice', s);
  await e.ctx.close();
  ok(e.errs.length === 0 && errs.length === 0, 'no page errors', e.errs.concat(errs));
}

async function phone(browser, game, decisions){
  console.log('\n== ' + game + ' on a phone');
  const {ctx, p, errs} = await open(browser, game, {width: 390, height: 780}, session(game, decisions));
  await p.evaluate(() => document.getElementById('btn-practice').click()); await sleep(350);
  const fit = () => p.evaluate(() => { const r = document.querySelector('#tr-prac .pp').getBoundingClientRect(); return {l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth}; });
  let f = await fit();
  ok(f.l >= 0 && f.r <= f.w && f.b <= f.h, 'the chooser fits the phone screen', f);
  await p.click('#tr-prac [data-k="mine"]'); await sleep(250);
  const s = await ST(p);
  await p.click('#tr-prac .pp-opt[data-k="' + s.answer + '"]'); await sleep(200);
  f = await fit();
  ok(f.l >= 0 && f.r <= f.w && f.sw <= f.w + 1, 'a question with its feedback fits the width', f);
  const scroll = await p.evaluate(() => { const n = document.querySelector('#tr-prac #pp-next'); const r = n.getBoundingClientRect(); return {nb: Math.round(r.bottom), h: innerHeight}; });
  ok(scroll.nb <= scroll.h + 1, 'the Next button is on screen', scroll);
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

async function report(browser){
  console.log('\n== report page links');
  const log = session('blackjack', BJ.slice(0, 4));
  const u = session('ultimate-texas-holdem', UTH.slice(0, 3)).s[0]; const bac = {id: 'seedbac', g: 'baccarat', t0: T0, t1: T0 + 600000, b0: 1000, h: [[60, 10, -10, 0.1, 0.5, [['bet', 'player', 'banker', 0.5, 'Player']], 990, 1]]};
  log.s.push(u, bac);
  const {ctx, p, errs} = await open(browser, 'report', {width: 1440, height: 900}, log);
  await sleep(800);
  const links = await p.evaluate(() => Array.from(document.querySelectorAll('.leak')).map(l => ({g: l.querySelector('.gm').textContent, href: l.querySelector('.leak-go').getAttribute('href'), txt: l.querySelector('.leak-go').textContent})));
  ok(links.length >= 3, 'the report lists the leaks', links);
  ok(links.filter(l => /Blackjack/.test(l.g)).every(l => l.href === '/blackjack/#practice-mine'), 'Blackjack play leaks link to the mistakes drill', links);
  ok(links.filter(l => /Hold/.test(l.g)).every(l => l.href === '/ultimate-texas-holdem/#practice-mine'), 'Hold’em pre-flop leaks link to the mistakes drill', links);
  ok(links.filter(l => /Baccarat/.test(l.g)).every(l => l.href === '/baccarat/#practice'), 'games without a replay keep the plain practice link', links);
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

(async () => {
  const only = process.argv[2];
  const browser = await chromium.launch();
  if(!only || only === 'blackjack'){
    await drill(browser, 'blackjack', BJ, ['hard 16 v 10', 'soft 18 v 6', 'pair of 8s v ace', 'hard 12 v 2'].map(x => x), 4);
    await direct(browser, 'blackjack', BJ);
    await phone(browser, 'blackjack', BJ);
  }
  if(!only || only === 'ultimate-texas-holdem'){
    await drill(browser, 'ultimate-texas-holdem', UTH, ['pre-flop A-K offsuit', 'pre-flop pair of 7s', 'pre-flop 9-4 offsuit'], 3);
    await direct(browser, 'ultimate-texas-holdem', UTH);
    await phone(browser, 'ultimate-texas-holdem', UTH);
  }
  if(!only || only === 'report') await report(browser);
  await browser.close();
  console.log('\n' + oks + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
