// Ultimate Texas Hold'em in a real browser (Chromium via Playwright): layout stability while the cards and board come in, the chip tray under a real mouse and a real finger,
// the phone layouts, taps, the settings sheet, dialogs, keyboard and screen-reader behaviour.
//   NODE_PATH=$(npm root -g) node tests/test_uth_browser.js [path/to/index.html]
const { chromium } = require('playwright');
const path = require('path');
const FAST = !!process.env.FAST;       // FAST=1: only the checks that matter most (used by the mutation runs)
const FILE = path.resolve(process.argv[2] || (require('fs').existsSync(path.join(__dirname, 'index.html')) ? path.join(__dirname, 'index.html') : path.join(__dirname, '..', 'dist', 'index.html')));
let fails = 0, passes = 0, current = '';
function ok(cond, msg){ if(cond){ passes++; } else { fails++; console.log('  FAIL [' + current + '] ' + msg); if(process.env.BAIL) process.exit(1); } }
function section(n){ current = n; if(!process.env.QUIET) console.log('· ' + n); }
const c = (rank, suit) => ({ rank, suit });
const FLUSH_WIN = { player: [c(14, 's'), c(13, 's')], dealer: [c(11, 'h'), c(11, 'd')], board: [c(12, 's'), c(7, 's'), c(2, 's'), c(9, 'd'), c(4, 'c')] };
const NOQ_LOSS = { player: [c(9, 'h'), c(3, 'c')], dealer: [c(10, 's'), c(5, 'd')], board: [c(14, 'c'), c(7, 'd'), c(2, 'h'), c(12, 'd'), c(4, 's')] };
const DEALER_WINS = { player: [c(10, 'h'), c(9, 'h')], dealer: [c(14, 'c'), c(14, 'd')], board: [c(13, 's'), c(7, 'c'), c(3, 'd'), c(2, 'c'), c(5, 'h')] };

async function open(browser, o){
  o = o || {};
  const ctx = await browser.newContext({ viewport: o.vp || { width: 1280, height: 900 }, deviceScaleFactor: 1, hasTouch: !!o.touch, isMobile: !!o.mobile, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|AudioContext|fonts\./.test(m.text())) errs.push(m.type() + ': ' + m.text()); });
  await page.addInitScript(s => { try{ localStorage.setItem('house_edge_uth_hints_v1', JSON.stringify({ seenChipsHint: true, seenBasicsHint: true, skillLevel: 'beginner', seenSkillPrompt: true, skillSource: 'own', sharedLevel: null })); }catch(e){} for(const k in (s || {})) localStorage.setItem(k, s[k]); }, o.storage || {});
  await page.goto('file://' + FILE);
  await page.waitForTimeout(300);
  if(o.settings) await page.evaluate(s => { for(const k in s){ const e = document.getElementById(k); if(!e) continue; if(e.type === 'checkbox') e.checked = s[k]; else e.value = s[k]; e.dispatchEvent(new Event('change', { bubbles: true })); } }, o.settings);
  return { ctx, page, errs };
}
// records, every animation frame, how far each card has turned (0 = back, 180 = face): how many frames it was seen part of the way round, and where it ended up
const FLIPREC = () => {
  window.__fl = new Map();
  const loop = () => {
    document.querySelectorAll('.pc-in').forEach(e => {
      const m = getComputedStyle(e).transform; let a = 0;
      if(m !== 'none'){ const v = m.match(/matrix3d\(([^)]+)\)/), c = v ? +v[1].split(',')[0] : +m.match(/matrix\(([^,]+)/)[1]; a = Math.round(Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI); }
      let r = window.__fl.get(e); if(!r){ r = { mid: 0, end: 0 }; window.__fl.set(e, r); }
      if(a > 5 && a < 175) r.mid++;
      r.end = a;
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};
async function rig(page, sc){
  await page.evaluate(sc => {
    const used = new Set(sc.player.concat(sc.dealer, sc.board).map(x => x.rank + x.suit));
    const rest = freshDeck().filter(x => !used.has(x.rank + x.suit));
    window.freshDeck = () => rest.concat(sc.board.slice().reverse(), sc.dealer.slice().reverse(), sc.player.slice().reverse());
  }, sc);
}
const phase = page => page.evaluate(() => G.phase);
async function untilPhase(page, ph, ms){ try{ await page.waitForFunction(p => G.phase === p, ph, { timeout: ms || 25000 }); return true; }catch(e){ return false; } }
async function until(page, fn, arg, ms){ try{ await page.waitForFunction(fn, arg, { timeout: ms || 15000 }); return true; }catch(e){ return false; } }
// a real tap or click at the centre of the element, by coordinates: if something were on top of it, the press would land on that instead
async function tap(page, sel, touch){
  const b = await page.evaluate(sel => { const e = document.querySelector(sel); if(!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, in: r.top >= 0 && r.bottom <= innerHeight }; }, sel);
  if(!b) throw new Error('no ' + sel);
  if(!b.in){ await page.evaluate(sel => document.querySelector(sel).scrollIntoView({ block: 'center' }), sel); await page.waitForTimeout(80); Object.assign(b, await page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel)); }
  if(touch) await page.touchscreen.tap(b.x, b.y); else await page.mouse.click(b.x, b.y);
}
async function startHand(page, sc, ante){
  await rig(page, sc || FLUSH_WIN);
  await page.evaluate(a => { selectChip(a || 25, true); placeBet('ante'); }, ante);
}
// a decision button is only pressable when it is shown, enabled and (on the pinned bar) on screen
const ready = (page, sel) => until(page, s => { const b = document.querySelector(s); return b && !b.hidden && !b.disabled && b.offsetParent; }, sel, 20000);
async function look(page, touch){
  ok(await untilPhase(page, 'preflop'), 'reaches the pre-flop decision');
  await page.waitForTimeout(150);
  await until(page, () => { const b = document.getElementById('btn-look'); return G.playerFlipCount >= 2 || (b && !b.hidden && !b.disabled && b.offsetParent); }, null, 20000);       // (in turbo the cards turn over by themselves)
  if(await page.evaluate(() => G.playerFlipCount < 2)) await tap(page, '#btn-look', touch);
  await until(page, () => G.playerFlipCount >= 2, null, 6000); await page.waitForTimeout(200);
}
async function check(page, touch){ await ready(page, '#btn-check'); await tap(page, '#btn-check', touch); }
// sample the layout every animation frame: where each block of the table is, and where every card is
function installSampler(page){
  return page.evaluate(() => {
    window.__S = []; window.__go = true;
    const ids = ['rows', 'seat-dealer', 'seat-board', 'seat-you', 'status-line', 'bet-spots', 'coach-wrap', 'strategy-hint', 'action-row'];
    function snap(){
      const o = { t: performance.now(), ph: G.phase, sy: scrollY, dh: document.documentElement.scrollHeight, el: {}, cards: {} };
      ids.forEach(id => { const e = document.getElementById(id); if(e){ const b = e.getBoundingClientRect(); o.el[id] = [+(b.top + scrollY).toFixed(1), id === 'strategy-hint' ? e.offsetHeight : +b.height.toFixed(1), +b.left.toFixed(1), +b.width.toFixed(1)]; } });
      document.querySelectorAll('#rows .pc').forEach(e => { const b = e.getBoundingClientRect(); const where = e.closest('#seat-you') ? 'p' : e.closest('#seat-board') ? 'b' : 'd'; o.cards[where + e.dataset.k] = [+(b.left).toFixed(1), +(b.top + scrollY).toFixed(1), e.classList.contains('pending') ? 1 : e.classList.contains('landed') ? 2 : 0, e.className]; });
      window.__S.push(o);
      if(window.__go) requestAnimationFrame(snap);
    }
    requestAnimationFrame(snap);
  });
}
const stopSampler = page => page.evaluate(() => { window.__go = false; return window.__S; });
const spread = (S, id, k) => { const v = S.filter(s => s.el[id]).map(s => s.el[id][k]); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
// a whole hand, at the pace a person plays it, with nothing hidden: deal, look, check, check, bet 1x (or fold)
async function playWhole(page, o){
  o = o || {};
  const t = !!o.touch;
  await tap(page, '#btn-deal', t);
  await look(page, t);
  await check(page, t);
  ok(await untilPhase(page, 'flop', 25000), 'the flop comes');
  await page.waitForTimeout(200);
  await check(page, t);
  ok(await untilPhase(page, 'river', 25000), 'the river comes');
  await page.waitForTimeout(200);
  if(o.fold){ await ready(page, '#btn-fold'); await tap(page, '#btn-fold', t); }
  else { await ready(page, '#btn-bet'); await tap(page, '#btn-bet', t); }
  ok(await untilPhase(page, 'resolved', 40000), 'the hand resolves');
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- stability through a whole hand (desktop and phones), at real speed
  for(const dev of [{ n: 'desktop 1280x900', vp: { width: 1280, height: 900 } }, { n: 'phone 390x664', vp: { width: 390, height: 664 }, touch: true, mobile: true }, { n: 'phone 360x640', vp: { width: 360, height: 640 }, touch: true, mobile: true }, { n: 'phone 320x568', vp: { width: 320, height: 568 }, touch: true, mobile: true }].filter(d => !FAST || /360|320/.test(d.n))){
    section('nothing jumps through a whole hand: ' + dev.n);
    const { page, errs, ctx } = await open(browser, dev);
    await startHand(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await installSampler(page);
    await playWhole(page, dev);
    const S = await stopSampler(page);
    ok(S.length > 200, 'sampled the hand (' + S.length + ' frames)');
    const first = S.findIndex(s => s.ph === 'dealing');
    const t0 = S[first].t, settle = S.findIndex(s => s.t > t0 + 650);
    const hand = S.slice(settle);
    ok(S.slice(first, settle).length > 10, 'the one change at Deal (rack away, table opens up) settles inside 650ms');
    // the table's blocks stay where they are from the first card to the result: seats, board, status line, the bet spots and the bar
    ['seat-dealer', 'seat-board', 'seat-you', 'status-line', 'bet-spots'].forEach(id => {
      const dt = spread(hand, id, 0), dh = spread(hand, id, 1);
      ok(dt < 1.5, id + ' does not move up or down in the hand (moved ' + dt.toFixed(1) + 'px)');
      ok(dh < 1.5, id + ' keeps its height in the hand (changed ' + dh.toFixed(1) + 'px)');
    });
    // the page may get longer at the very end (the history under the table gains a line), but it never gets shorter in the hand: a shorter page would pull the table up under a reader at the bottom
    let shrink = 0; hand.forEach((s, i) => { if(i && hand[i - 1].ph !== 'resolved') shrink = Math.max(shrink, hand[i - 1].dh - s.dh); });
    ok(shrink < 1.5, 'the page never gets shorter in the hand (' + shrink.toFixed(1) + 'px)');
    const grow = Math.max(...hand.map(s => s.dh)) - hand[0].dh;
    ok(grow < 170, 'and grows only at the end, by the new line of history (' + grow.toFixed(0) + 'px)');
    // the pinned bar stays at the same place on the screen (its place on the page moves only as the page scrolls)
    const bt = hand.map(s => s.el['action-row'][0] - s.sy), bh = hand.map(s => s.el['action-row'][1]);
    ok(Math.max(...bt) - Math.min(...bt) < 1.5 && Math.max(...bh) - Math.min(...bh) < 1.5, 'the button bar keeps its place and its size on the screen all hand (' + (Math.max(...bt) - Math.min(...bt)).toFixed(1) + 'px)');
    // the page scrolls by itself only to bring the result up at the showdown (and never before it)
    const early = hand.filter(s => s.ph !== 'showdown' && s.ph !== 'resolved').map(s => s.sy), allsy = hand.map(s => s.sy);
    ok(Math.max(...early) - Math.min(...early) < 2, 'the page does not scroll by itself before the showdown');
    ok(Math.max(...allsy) - Math.min(...early) < 140, 'and at the showdown it moves by less than a screen to bring the result up (' + (Math.max(...allsy) - Math.min(...early)).toFixed(0) + 'px)');
    // the strategy hint box keeps its height whatever it says
    const hh = hand.filter(s => s.el['strategy-hint'] && s.el['strategy-hint'][1] > 0).map(s => s.el['strategy-hint'][1]);
    ok(Math.max(...hh) - Math.min(...hh) < 30, 'the hint box (last on the table, so nothing sits below it) grows by a line at most for a longer verdict (' + Math.min(...hh).toFixed(0) + '-' + Math.max(...hh).toFixed(0) + 'px)');
    const ht = hand.filter(s => s.el['strategy-hint']).map(s => s.el['coach-wrap'][0]);
    ok(Math.max(...ht) - Math.min(...ht) < 1.5, 'and its top edge never moves');
    const hs = hand.filter(s => s.el['strategy-hint'] && s.ph !== 'resolved').map(s => s.el['strategy-hint'][1]);
    let hshrink = 0; hs.forEach((v, i) => { if(i) hshrink = Math.max(hshrink, hs[i - 1] - v); });
    ok(hshrink < 1.5, 'and once it has grown it does not shrink again in the hand (' + hshrink.toFixed(1) + 'px)');
    // each card, once it has landed, stays exactly where it is
    const landed = {};
    let moved = 0, worst = 0, what = '';
    hand.forEach(s => Object.keys(s.cards).forEach(k => { const cc = s.cards[k]; if(cc[2] === 0 && !/rel-|nudge|peek|dim/.test(cc[3])){ if(landed[k]){ const d = Math.abs(cc[0] - landed[k][0]) + Math.abs(cc[1] - landed[k][1]); if(d > 1.5){ moved++; if(d > worst){ worst = d; what = k + ' [' + cc[3] + '] in ' + s.ph; } } } else landed[k] = cc; } }));
    ok(moved === 0, 'a card that has landed never shifts (' + moved + ' frames, worst ' + worst.toFixed(1) + 'px: ' + what + ')');
    ok(Object.keys(landed).length >= 8, 'the cards were seen on the felt (' + Object.keys(landed).length + ')');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
    ok(await page.evaluate(() => document.querySelectorAll('.fc').length === 0 && document.querySelectorAll('.pc.pending').length === 0), 'nothing left flying or pending');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- the flights land on the cards
  section('a flying card ends exactly on the card');
  if(!FAST){
    const { page, ctx } = await open(browser, {});
    await startHand(page); await page.evaluate(() => { Show._S.forceGag = -1; Show._S.forceBoardGag = -1; });
    await page.evaluate(() => {
      window.__ends = []; window.__air = 0; window.__last = new Map();
      const L = document.getElementById('show-layer');
      (function f(){
        const fl = [...L.querySelectorAll('.fc')];
        window.__air = Math.max(window.__air, fl.length);
        const now = new Set(fl);
        fl.forEach(n => { const b = n.getBoundingClientRect(); window.__last.set(n, [b.left + b.width / 2, b.top + b.height / 2, b.width]); });
        window.__last.forEach((v, n) => { if(!now.has(n)){ window.__ends.push(v); window.__last.delete(n); } });
        requestAnimationFrame(f);
      })();
    });
    await tap(page, '#btn-deal');
    await look(page);
    await check(page); await untilPhase(page, 'flop'); await page.waitForTimeout(200);
    await check(page); await untilPhase(page, 'river'); await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#rows .pc, .ds-burn')].map(e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.width]; });
      const dists = window.__ends.map(e => Math.min(...cards.map(k => Math.hypot(k[0] - e[0], k[1] - e[1]))));
      return { n: window.__ends.length, worst: Math.max(...dists), air: window.__air, cards: cards.length };
    });
    ok(r.n >= 9, 'cards flew in (' + r.n + ' flights seen)');
    ok(r.worst < 10, 'every flight ended on a card (worst ' + r.worst.toFixed(1) + 'px away)');
    ok(r.air >= 2 && r.air <= 6, 'a spread has a few cards in the air together, never a pile (' + r.air + ')');
    await ctx.close();
  }

  // ---------------------------------------------------------------- his chips: a real mouse and a real finger
  section('the chip tray: a mouse resting on it');
  {
    const { page, errs, ctx } = await open(browser, {});
    const q = s => page.evaluate(s);
    const box = await q(() => { const t = document.querySelector('.ds-tray'), b = t.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, w: b.width, h: b.height, hit: !!(hit && hit.closest('.ds-tray')), vis: getComputedStyle(t).visibility !== 'hidden' && getComputedStyle(t).display !== 'none' && b.width > 10 }; });
    ok(box.vis && box.w > 20 && box.h > 10, 'the chip tray is on screen (' + Math.round(box.w) + 'x' + Math.round(box.h) + ')');
    ok(box.hit, 'nothing is on top of it: a pointer at its centre reaches it');
    await page.mouse.move(5, 5); await page.mouse.move(box.x, box.y, { steps: 6 }); await page.mouse.move(5, 5, { steps: 4 });
    await page.waitForTimeout(1300);
    ok(await q(() => Show._S.stats.eggs === 0 && !Show._S.egg), 'a sweep across it does nothing');
    await page.mouse.move(box.x - 10, box.y - 3, { steps: 5 }); await page.mouse.move(box.x, box.y, { steps: 3 });
    ok(await until(page, () => Show._S.stats.eggs === 1 && !!Show._S.egg, null, 4000), 'resting the pointer on it starts it');
    ok(await until(page, () => document.querySelector('.ds-say').classList.contains('on'), null, 3000), 'and he says something');
    await page.waitForTimeout(500);
    ok(await q(() => { const r = document.getElementById('dealer-stage').getBoundingClientRect(); return r.height > 0; }), 'the stage is intact');
    const before = await q(() => ['seat-dealer', 'seat-you', 'bet-row'].map(id => document.getElementById(id).getBoundingClientRect().top));
    await page.waitForTimeout(800);
    const after = await q(() => ['seat-dealer', 'seat-you', 'bet-row'].map(id => document.getElementById(id).getBoundingClientRect().top));
    ok(before.every((v, i) => Math.abs(v - after[i]) < 1), 'the table does not move while he does it');
    await page.mouse.move(5, 5, { steps: 3 });
    ok(await until(page, () => !Show._S.egg, null, 14000), 'it ends when the pointer leaves');
    // a second go works, and starting a hand while it plays cuts it off
    await page.mouse.move(box.x, box.y, { steps: 3 });
    ok(await until(page, () => Show._S.stats.eggs === 2, null, 4000), 'it can be done again');
    await startHand(page);
    await page.evaluate(() => placeBet('ante'));
    await page.keyboard.press('Space');
    ok(await until(page, () => G.phase === 'dealing' && !Show._S.egg, null, 4000), 'dealing ends it at once');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }
  for(const dev of [{ n: 'phone 390x664', vp: { width: 390, height: 664 } }, { n: 'phone 320x568', vp: { width: 320, height: 568 } }].filter(d => !FAST || /390/.test(d.n))){
    section('the chip tray: a finger on it, ' + dev.n);
    const { page, errs, ctx } = await open(browser, { vp: dev.vp, touch: true, mobile: true });
    const q = s => page.evaluate(s);
    const box = await q(() => { const t = document.querySelector('.ds-tray'), b = t.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, w: b.width, h: b.height, hit: !!(hit && hit.closest('.ds-tray')), inside: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight }; });
    ok(box.w > 20 && box.h > 8 && box.inside, 'the tray is on screen (' + Math.round(box.w) + 'x' + Math.round(box.h) + ' at ' + Math.round(box.x) + ',' + Math.round(box.y) + ')');
    ok(box.hit, 'a finger at its centre reaches it');
    await page.touchscreen.tap(box.x, box.y);
    ok(await until(page, () => Show._S.stats.eggs === 1 && !!Show._S.egg, null, 3000), 'a tap starts it');
    ok(await q(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll while he does it');
    ok(await until(page, () => !Show._S.egg, null, 14000), 'it finishes by itself');
    ok(await q(() => Show._S.stats.eggs === 1), 'and a tap is exactly one go');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- turning cards over
  section('turning your cards over: the turn is animated every time, also while they are wobbling for attention');
  for(const dev of [{ n: 'mouse', o: { vp: { width: 1280, height: 900 } }, touch: false }, { n: 'touch', o: { vp: { width: 390, height: 664 }, touch: true, mobile: true }, touch: true }]){
    const { page, errs, ctx } = await open(browser, dev.o);
    const q = s => page.evaluate(s);
    await startHand(page);
    await tap(page, '#btn-deal', dev.touch);
    ok(await untilPhase(page, 'preflop'), dev.n + ': reaches the pre-flop decision');
    await q(FLIPREC);
    ok(await until(page, () => !!document.querySelector('#player-cards .pc.nudge'), null, 8000), dev.n + ': after a while your cards start to wobble');
    await page.waitForTimeout(350);
    const st = await q(() => { const ins = [...document.querySelectorAll('#player-cards .pc-in')], backs = [...document.querySelectorAll('#player-cards .pc-back')]; return { inAnims: ins.map(e => e.getAnimations().filter(a => a.animationName).length), backAnims: backs.map(b => b.getAnimations().filter(a => a.animationName === 'peekNudge').length) }; });
    ok(st.inAnims.every(n => n === 0), dev.n + ': the wobble is not on the part that turns over (' + st.inAnims.join(',') + '): an animation there stops the turn from animating');
    ok(st.backAnims.every(n => n === 1), dev.n + ': it is on the back of each card (' + st.backAnims.join(',') + ')');
    await tap(page, '#player-cards .pc:nth-child(1)', dev.touch);
    await page.waitForTimeout(250);
    await tap(page, '#player-cards .pc:nth-child(2)', dev.touch);
    ok(await until(page, () => G.playerFlipCount === 2, null, 4000), dev.n + ': both cards are turned over');
    await page.waitForTimeout(700);
    const fr = await q(() => [...document.querySelectorAll('#player-cards .pc-in')].map(e => window.__fl.get(e)));
    ok(fr.every(r => r && r.end === 180 && r.mid >= 5), dev.n + ': you saw each one turn over, in ' + fr.map(r => r && r.mid).join(' and ') + ' frames (it jumped if that is under 5)');
    if(!FAST){
      await check(page, dev.touch);
      await until(page, () => G.phase === 'flop', null, 30000);
      await ready(page, '#btn-check'); await page.waitForTimeout(300);
      await tap(page, '#btn-check', dev.touch);
      await until(page, () => G.phase === 'river', null, 30000);
      await ready(page, '#btn-bet'); await page.waitForTimeout(300);
      await tap(page, '#btn-bet', dev.touch);
      ok(await untilPhase(page, 'resolved', 45000), dev.n + ': the hand is played to the end');
      await page.waitForTimeout(800);
      const all = await q(() => [...document.querySelectorAll('#rows .pc-in, #board-cards .pc-in')].map(e => { const r = window.__fl.get(e); return { up: !!e.parentNode.classList.contains('up'), end: r && r.end, mid: r && r.mid }; }));
      ok(all.length === 9 && all.every(x => x.up && x.end === 180 && x.mid >= 5), dev.n + ': and the other seven cards (his two, the flop, the turn and the river) turned over with their animation too: ' + all.map(x => x.mid).join(','));
    }
    ok(errs.length === 0, dev.n + ': no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- your Play bet
  section('your Play bet: the chips come from your bankroll, not from his tray');
  if(!FAST){
    const { page, errs, ctx } = await open(browser, { vp: { width: 1280, height: 900 } });
    await startHand(page);
    await tap(page, '#btn-deal');
    await look(page);
    const g = await page.evaluate(() => {
      const lay = document.getElementById('show-layer').getBoundingClientRect(), ctr = e => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2 - lay.left, y: b.top + b.height / 2 - lay.top, w: b.width, h: b.height }; };
      const stack = ctr(document.getElementById('bankroll-chip-stack')), tray = ctr(document.querySelector('.ds-tray'));
      const n0 = document.querySelectorAll('.pchip').length;
      document.getElementById('btn-bet').click();
      const chips = [...document.querySelectorAll('.pchip')].slice(n0).map(c => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(c.style.transform); return m ? { x: +m[1] + 11, y: +m[2] + 11 } : null; }).filter(Boolean);
      return { stack, tray, chips };
    });
    ok(g.stack.w > 0 && g.stack.h > 0 && g.chips.length >= 1, 'your Play bet puts chips in the air (' + g.chips.length + ') from a stack that is on screen');
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    ok(g.chips.length > 0 && g.chips.every(ch => d(ch, g.stack) < 40 && d(ch, g.stack) < d(ch, g.tray)), 'and they start at your bankroll stack, not at his tray (' + g.chips.map(ch => Math.round(d(ch, g.stack)) + 'px from your stack, ' + Math.round(d(ch, g.tray)) + 'px from his tray').join('; ') + ')');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- phone layout
  for(const vp of [{ w: 390, h: 664 }, { w: 375, h: 667 }, { w: 360, h: 640 }, { w: 390, h: 844 }, { w: 412, h: 760 }, { w: 320, h: 568 }].filter(v => !FAST || (v.w === 390 && v.h === 664) || v.w === 320)){
    section('phone ' + vp.w + 'x' + vp.h + ': everything fits and can be tapped');
    const { page, errs, ctx } = await open(browser, { vp: { width: vp.w, height: vp.h }, touch: true, mobile: true });
    const q = s => page.evaluate(s);
    ok(await q(() => getComputedStyle(document.getElementById('m-menu-btn')).display !== 'none'), 'the menu button is there');
    ok(await q(() => !document.getElementById('btn-toggle-settings').offsetParent), 'the settings button has moved into the menu (hidden until it opens)');
    ok(await q(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll while betting');
    // betting: the spots, the chips and Deal are all on screen without scrolling
    const bet = await q(() => { const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return [b.top, b.bottom, b.left, b.right]; }; return { ante: r('spot-ante'), blind: r('spot-blind'), chips: r('chip-row'), deal: r('btn-deal'), h: innerHeight, w: innerWidth }; });
    ok(bet.ante[0] > 40 && bet.blind[1] < bet.h, 'betting: the Ante and Blind spots are on screen');
    ok(bet.chips[1] <= bet.deal[0] + 1, 'betting: the chip rack is not hidden behind the Deal button (' + Math.round(bet.chips[1]) + ' vs ' + Math.round(bet.deal[0]) + ')');
    ok(bet.deal[1] <= bet.h + 1, 'betting: Deal is on screen');
    const idle = await q(() => { const r = s => { const e = document.querySelector(s), b = e.getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom]; }; const i = document.querySelector('.ds-idle'); return { idle: r('.ds-idle'), tray: r('.ds-tray'), card: r('.shoe-card'), rail: r('.ds-rail'), op: +getComputedStyle(i).opacity, txt: i.textContent, sh: i.scrollHeight, ch: i.clientHeight }; });
    ok(idle.op > 0.3 && idle.txt.length > 5, 'betting: the dealer\'s "tap the shoe" hint is showing ("' + idle.txt + '")');
    ok(idle.idle[0] >= idle.tray[1] - 1 && idle.idle[1] <= idle.card[0] + 2, 'betting: the hint sits between his chips and the shoe (' + Math.round(idle.tray[1]) + ' < ' + Math.round(idle.idle[0]) + '-' + Math.round(idle.idle[1]) + ' < ' + Math.round(idle.card[0]) + ')');
    ok(idle.idle[3] <= idle.rail[2] + 4, 'betting: and ends above his table rail (' + Math.round(idle.idle[3]) + ' vs ' + Math.round(idle.rail[2]) + ')');
    ok(bet.chips[2] >= 0 && bet.chips[3] <= bet.w + 1, 'betting: the chip rack is inside the screen sideways');
    const small = await q(() => [...document.querySelectorAll('#chip-row button, #spot-ante, #spot-blind, #btn-deal, #m-menu-btn, #btn-rebet, #m-undo')].filter(e => e.offsetParent && !e.hidden).map(e => { const b = e.getBoundingClientRect(); return { id: e.id || e.className, w: Math.round(b.width), h: Math.round(b.height) }; }).filter(x => x.w < 38 || x.h < 38));
    ok(small.length === 0, 'betting: every control is at least 38px each way: ' + JSON.stringify(small));
    // bet by tapping and take a chip back with Undo
    await page.tap('#chip-50'); await page.tap('#spot-ante'); await page.tap('#spot-ante');
    ok(await q(() => G.bets.ante === 100 && G.bets.blind === 100), 'two taps put $100 on the Ante and the Blind');
    await page.tap('#m-undo');
    ok(await q(() => G.bets.ante === 50 && G.bets.blind === 50), 'Undo takes the last chip back');
    await page.tap('#spot-ante');
    await rig(page, FLUSH_WIN);
    await page.tap('#btn-deal');
    ok(await untilPhase(page, 'preflop'), 'dealt');
    await page.waitForTimeout(400);
    const arr = await q(() => {
      const r = e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      const cards = [...document.querySelectorAll('#player-cards .pc')].map(e => ({ r: r(e), hit: (b => { const x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2; const t = document.elementFromPoint(x, y); return t && t.closest('.pc') === e; })(r(e)) }));
      const dealer = [...document.querySelectorAll('#dealer-cards .pc')].map(e => r(e));
      const dock = document.getElementById('action-row').getBoundingClientRect();
      const st = document.getElementById('status-line').getBoundingClientRect();
      const lab = document.querySelector('#seat-you .seat-name').getBoundingClientRect();
      return { cards, dealer, dockTop: dock.top, dockBottom: dock.bottom, statusBottom: st.bottom, statusTop: st.top, h: innerHeight, w: innerWidth, sw: document.documentElement.scrollWidth, labBottom: lab.bottom };
    });
    ok(arr.cards.length === 2 && arr.cards.every(cc => cc.hit), 'pre-flop: both your cards can be tapped in the middle (nothing is on top of them)');
    const cw = arr.cards[0].r[2] - arr.cards[0].r[0], ch = arr.cards[0].r[3] - arr.cards[0].r[1];
    ok(cw >= (vp.w < 340 ? 52 : 58), 'pre-flop: your cards are wide enough to tap (' + cw.toFixed(1) + 'px)');
    ok(ch >= 70, 'pre-flop: and tall enough (' + ch.toFixed(1) + 'px)');
    ok(arr.cards[0].r[0] >= 0 && arr.cards[1].r[2] <= arr.w, 'pre-flop: your cards are inside the screen');
    ok(arr.dealer.every(rr => rr[0] >= 0 && rr[2] <= arr.w), 'pre-flop: his cards are inside the screen');
    ok(arr.dockBottom <= arr.h + 1, 'pre-flop: the buttons are pinned on screen (' + Math.round(arr.dockBottom) + ' of ' + arr.h + ')');
    ok(arr.cards.every(cc => cc.r[3] <= arr.dockTop + 1), 'pre-flop: your cards are above the pinned buttons (' + Math.round(Math.max(...arr.cards.map(cc => cc.r[3]))) + ' vs ' + Math.round(arr.dockTop) + ')');
    ok(arr.sw <= arr.w + 1, 'pre-flop: no sideways scroll');
    await tap(page, '#btn-look', true);
    await until(page, () => G.playerFlipCount >= 2, null, 5000);
    await page.waitForTimeout(250);
    // decision time: the three decision buttons are big and on screen
    const check1 = async label => {
      const btns = await q(() => [...document.querySelectorAll('#action-row button')].filter(b => !b.hidden).map(b => { const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { id: b.id, h: Math.round(r.height), w: Math.round(r.width), vis: r.bottom <= innerHeight + 1 && r.top >= 0, hit: !!t && (t === b || b.contains(t)) }; }));
      ok(btns.length >= 2 && btns.every(b => b.h >= 44 && b.w >= 70 && b.vis && b.hit), label + ': the buttons are big, on screen and not covered: ' + JSON.stringify(btns));
      ok(await q(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ': no sideways scroll');
      const g = await q(() => { const d = document.getElementById('action-row').getBoundingClientRect(), s = document.getElementById('status-line').getBoundingClientRect(); return { dockTop: d.top, stBottom: s.bottom, h: innerHeight }; });
      if(vp.h >= 640) ok(g.stBottom <= g.dockTop + 8, label + ': the status line is not under the buttons (' + Math.round(g.stBottom) + ' vs ' + Math.round(g.dockTop) + ')');
    };
    await check1('pre-flop decision');
    ok(await q(() => { const r = document.querySelector('.rack'); return !r || getComputedStyle(r).display === 'none'; }), 'pre-flop: the chip rack is out of the way (nothing sits behind the buttons)');
    ok(await q(() => [...document.querySelectorAll('#player-cards .pc')].every(e => +getComputedStyle(e).opacity === 1)), 'pre-flop: your cards are shown at full strength (a disabled button is not dimmed)');
    // the buttons stay pinned while the page scrolls
    await q(() => window.scrollTo(0, 260)); await page.waitForTimeout(120);
    const pin = await q(() => { const d = document.getElementById('action-row').getBoundingClientRect(); return { top: d.top, bottom: d.bottom, h: innerHeight, sy: scrollY }; });
    if(pin.sy > 20) ok(pin.bottom <= pin.h + 1 && pin.top > 60, 'the buttons stay pinned to the bottom while you scroll (' + Math.round(pin.top) + '-' + Math.round(pin.bottom) + ' of ' + pin.h + ')');
    await q(() => window.scrollTo(0, 0)); await page.waitForTimeout(80);
    ok(await q(() => { const h = document.querySelector('.topbar h1'), tb = document.getElementById('topbar').getBoundingClientRect(); return h.scrollWidth <= h.clientWidth + 1 && h.scrollHeight <= h.clientHeight + 1 && h.getBoundingClientRect().height <= tb.height - 4; }), 'the whole title is shown beside the bankroll (not cut off, not taller than the bar)');
    ok(await q(() => { const hd = document.querySelector('.ds-head'), tb = document.getElementById('topbar'); if(!hd) return true; return hd.getBoundingClientRect().top >= tb.getBoundingClientRect().bottom + 1; }), 'the dealer\'s head is clear of the top bar');
    await tap(page, '#btn-check', true);
    ok(await untilPhase(page, 'flop', 25000), 'flop');
    await page.waitForTimeout(300);
    await check1('flop decision');
    const board = await q(() => [...document.querySelectorAll('#board-cards .pc')].map(e => { const b = e.getBoundingClientRect(); return [b.left, b.right, b.width, window.innerWidth]; }));
    ok(board.length === 3 && board.every(b => b[0] >= 0 && b[1] <= b[3] && b[2] >= 40), 'the three flop cards are inside the screen and big enough (' + board.map(b => Math.round(b[2])).join(',') + ')');
    await tap(page, '#btn-check', true);
    ok(await untilPhase(page, 'river', 25000), 'river');
    await page.waitForTimeout(300);
    await check1('river decision');
    ok(await q(() => { const bs = [...document.querySelectorAll('#board-cards .pc')].map(e => e.getBoundingClientRect()); return bs.length === 5 && bs.every(b => b.left >= 0 && b.right <= window.innerWidth) && bs.every((b, i) => !i || b.left >= bs[i - 1].right - 0.5); }), 'all five board cards are inside the screen and do not overlap');
    const pre = await q(() => { const bar = document.getElementById('action-row').getBoundingClientRect().top, s = document.getElementById('bet-spots').getBoundingClientRect(); return { sy: scrollY, below: s.bottom > bar + 1 }; });
    await tap(page, '#btn-bet', true);
    ok(await untilPhase(page, 'showdown', 40000), 'showdown');
    await page.waitForTimeout(1000);
    const sd = await q(() => { const bar = document.getElementById('action-row').getBoundingClientRect().top, s = document.getElementById('bet-spots').getBoundingClientRect(); return { sy: scrollY, bottom: s.bottom, bar }; });
    ok(!pre.below || sd.sy > pre.sy + 10, 'showdown: the table comes up by itself so the bets are not left under the buttons (scrolled ' + Math.round(sd.sy - pre.sy) + 'px)');
    ok(await untilPhase(page, 'resolved', 40000), 'resolved');
    await page.waitForTimeout(700);
    ok(await q(() => { const b = document.getElementById('btn-again').getBoundingClientRect(); return b.height >= 44 && b.bottom <= innerHeight + 1; }), 'Deal Again is big and on screen');
    await page.waitForTimeout(1200);
    const resv = await q(() => { const bar = document.getElementById('action-row').getBoundingClientRect().top, b = document.getElementById('outcome-badge').getBoundingClientRect(), tb = document.getElementById('topbar').getBoundingClientRect().bottom, dealer = document.getElementById('dealer-grp').getBoundingClientRect(); return { barTop: bar, badgeBottom: b.bottom, badgeTop: b.top, topbar: tb, dealerTop: dealer.top, txt: document.getElementById('outcome-badge').textContent }; });
    ok(resv.txt.length > 3 && resv.badgeTop >= resv.topbar && resv.badgeBottom <= resv.barTop + 1, 'the result line ("' + resv.txt + '") is on screen above the pinned bar (badge bottom ' + Math.round(resv.badgeBottom) + ', bar top ' + Math.round(resv.barTop) + ')');
    ok(await q(() => { const bar = document.getElementById('action-row').getBoundingClientRect().top; const r = [...document.querySelectorAll('.sp-res:not([hidden])')]; return r.length >= 2 && r.every(e => e.getBoundingClientRect().bottom <= bar + 1); }), 'and so are the win / lose tags on the bets');
    ok(await q(() => { const names = [...document.querySelectorAll('.bet-spot .spot-label')].filter(e => e.offsetParent), tags = [...document.querySelectorAll('.sp-res:not([hidden])')]; return tags.every(t => { const tb = t.getBoundingClientRect(); return names.every(n => { const nb = n.getBoundingClientRect(); return nb.width === 0 || tb.bottom <= nb.top + 1 || tb.top >= nb.bottom || tb.right <= nb.left || tb.left >= nb.right; }); }); }), 'no win / lose tag sits on top of a bet\'s name');
    ok(await q(() => document.documentElement.scrollWidth <= innerWidth + 1), 'the result: no sideways scroll');
    ok(await q(() => { const o = document.querySelectorAll('.sp-res:not([hidden])'); return [...o].every(e => { const b = e.getBoundingClientRect(); return b.left >= -1 && b.right <= innerWidth + 1; }); }), 'every per-spot result badge is inside the screen');
    await page.tap('#btn-again');
    ok(await untilPhase(page, 'betting', 6000), 'back to betting');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- the phone on its side
  for(const vp of [{ w: 667, h: 375 }, { w: 844, h: 390 }].filter(() => !FAST)){
    section('phone on its side ' + vp.w + 'x' + vp.h);
    const { page, errs, ctx } = await open(browser, { vp: { width: vp.w, height: vp.h }, touch: true, mobile: true });
    const q = s => page.evaluate(s);
    await startHand(page);
    ok(await q(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
    ok(await q(() => { document.getElementById('btn-deal').scrollIntoView({ block: 'center' }); const b = document.getElementById('btn-deal').getBoundingClientRect(); return b.bottom <= innerHeight + 1 && b.top >= 0 && b.height >= 38; }), 'Deal can be scrolled to and is big enough');
    await q(() => window.scrollTo(0, 0));
    await page.tap('#btn-deal');
    await page.waitForTimeout(900);
    ok(await q(() => { const d = document.getElementById('dealer-stage').getBoundingClientRect(), vis = Math.min(d.bottom, innerHeight) - Math.max(d.top, 0); return d.height > 40 && vis >= d.height * 0.6; }), 'on its side: the table does not scroll away from him while he deals (most of him is on screen)');
    await look(page, true);
    await page.waitForTimeout(700);
    ok(await q(() => [...document.querySelectorAll('#player-cards .pc')].every(e => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })), 'on its side: your cards are on screen when it is your turn (the table has come up to them)');
    ok(await q(() => { const b = document.getElementById('btn-check'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= innerHeight + 1 && r.height >= 40 && (t === b || b.contains(t)); }), 'the decision buttons can be scrolled to, are big enough and are not covered');
    ok(await q(() => [...document.querySelectorAll('#player-cards .pc')].every(e => { e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return b.width >= 40 && t && t.closest('.pc') === e; })), 'your cards can be scrolled to and are not covered');
    await check(page, true); await untilPhase(page, 'flop'); await page.waitForTimeout(200);
    await check(page, true); await untilPhase(page, 'river'); await page.waitForTimeout(200);
    await ready(page, '#btn-bet'); await tap(page, '#btn-bet', true);
    ok(await untilPhase(page, 'resolved', 40000), 'a whole hand plays on its side');
    ok(await q(() => document.documentElement.scrollWidth <= innerWidth + 1), 'still no sideways scroll');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- the menu and the settings sheet
  section('phone: the menu and the settings sheet are real dialogs');
  if(!FAST){
    const { page, errs, ctx } = await open(browser, { vp: { width: 390, height: 664 }, touch: true, mobile: true });
    const q = s => page.evaluate(s);
    await page.tap('#m-menu-btn');
    ok(await q(() => document.getElementById('m-menu-btn').getAttribute('aria-expanded') === 'true' && document.getElementById('topbar').classList.contains('m-open')), 'the menu opens');
    ok(await q(() => [...document.querySelectorAll('#m-menu > *')].filter(e => e.offsetParent).length >= 3), 'it lists settings, table manners and more');
    ok(await q(() => /Dealer qualifies with a pair/.test(document.querySelector('.m-rules').textContent)), 'and says how the table is set');
    await page.keyboard.press('Escape');
    ok(await q(() => !document.getElementById('topbar').classList.contains('m-open') && document.activeElement.id === 'm-menu-btn'), 'Escape closes it and focus goes back to the button');
    await page.tap('#m-menu-btn'); await page.tap('#btn-toggle-settings');
    await page.waitForTimeout(150);
    ok(await q(() => document.body.classList.contains('m-sheet')), 'Settings opens as a sheet');
    const sheet = await q(() => { const p = document.getElementById('settings-panel'); return { role: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), inside: p.contains(document.activeElement), tablesInert: document.getElementById('table').hasAttribute('inert'), h: p.getBoundingClientRect().height, vh: innerHeight }; });
    ok(sheet.role === 'dialog' && sheet.modal === 'true', 'it is a modal dialog for assistive tech');
    ok(sheet.inside, 'focus moved into it');
    ok(sheet.tablesInert, 'the table behind it is inert');
    ok(sheet.h > sheet.vh * 0.6, 'it takes most of the screen');
    let leaked = 0;
    for(let i = 0; i < 30; i++){ await page.keyboard.press('Tab'); if(!await q(() => document.getElementById('settings-panel').contains(document.activeElement))) leaked++; }
    ok(leaked === 0, 'Tab never leaves the sheet (' + leaked + ' escapes in 30 presses)');
    const small = await q(() => [...document.querySelectorAll('#settings-panel button, #settings-panel select, #settings-panel input')].filter(e => e.offsetParent).map(e => { const b = e.getBoundingClientRect(); const lab = e.type === 'checkbox' ? e.closest('.check-row').getBoundingClientRect() : b; return { id: e.id, h: Math.round(lab.height) }; }).filter(x => x.h < 40));
    ok(small.length === 0, 'every control in the sheet is at least 40px tall: ' + JSON.stringify(small));
    await page.tap('#set-turbo'); ok(await q(() => G.turbo === true), 'a switch in the sheet works');
    await page.tap('#set-turbo');
    ok(await q(() => G.turbo === false), 'and back');
    await page.tap('#m-sheet-done');
    ok(await q(() => !document.body.classList.contains('m-sheet') && document.getElementById('settings-panel').style.display === 'none'), 'Done closes it');
    ok(await q(() => document.activeElement.id === 'm-menu-btn' || document.activeElement === document.body), 'focus goes back to the menu button');
    ok(await q(() => !document.getElementById('table').hasAttribute('inert') && !document.getElementById('app').hasAttribute('aria-hidden')), 'the table is live again');
    await page.tap('#m-menu-btn'); await page.tap('#btn-toggle-settings'); await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    ok(await q(() => !document.body.classList.contains('m-sheet') && !document.getElementById('table').hasAttribute('inert')), 'Escape closes the sheet');
    await page.tap('#m-menu-btn'); await page.tap('#btn-toggle-settings'); await page.waitForTimeout(150);
    await page.touchscreen.tap(195, 20);
    await page.waitForTimeout(150);
    ok(await q(() => !document.body.classList.contains('m-sheet')), 'a tap on the dimmed table closes it');
    await page.tap('#m-menu-btn'); await page.tap('#btn-manners'); await page.waitForTimeout(150);
    ok(await q(() => { const o = document.getElementById('manners-overlay'); return !document.getElementById('manners-back').hidden && o.getAttribute('role') === 'dialog' && o.contains(document.activeElement); }), 'Table manners opens as a dialog with focus inside');
    ok(await q(() => document.getElementById('app').hasAttribute('inert')), 'with the page behind it inert');
    await page.keyboard.press('Escape');
    ok(await q(() => document.getElementById('manners-back').hidden && !document.getElementById('app').hasAttribute('inert')), 'Escape closes it');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- the desktop is the desktop
  section('desktop: no phone furniture, nothing hidden');
  if(!FAST){
    const { page, errs, ctx } = await open(browser, {});
    const q = s => page.evaluate(s);
    ok(await q(() => getComputedStyle(document.getElementById('m-menu-btn')).display === 'none'), 'no menu button');
    ok(await q(() => !!document.getElementById('btn-toggle-settings').offsetParent && !!document.getElementById('btn-manners').offsetParent), 'settings and manners are in the header');
    ok(await q(() => !document.getElementById('m-undo') || !document.getElementById('m-undo').offsetParent), 'no Undo button');
    ok(await q(() => getComputedStyle(document.getElementById('seat-you')).display !== 'none' && getComputedStyle(document.getElementById('seat-dealer')).display !== 'none'), 'both seats are shown while betting');
    await startHand(page); await tap(page, '#btn-deal');
    await look(page);
    const g = await q(() => { const cs = [...document.querySelectorAll('#player-cards .pc')].map(e => e.getBoundingClientRect().width); const d = document.getElementById('action-row').getBoundingClientRect(); return { cw: cs[0], dockBottom: d.bottom, h: innerHeight, sw: document.documentElement.scrollWidth, w: innerWidth }; });
    ok(g.cw >= 52, 'cards are big enough (' + Math.round(g.cw) + 'px; the one-screen desktop layout and auto-fit trade a little card size for no scrolling)');
    ok(g.dockBottom <= g.h + 1, 'the buttons are on screen at 1280x900 (' + Math.round(g.dockBottom) + ' of ' + g.h + ')');
    ok(g.sw <= g.w + 1, 'no sideways scroll');
    ok(errs.length === 0, 'no page errors');
    await ctx.close();
  }

  // ---------------------------------------------------------------- keyboard, announcements and names
  section('keyboard and screen readers');
  {
    const { page, errs, ctx } = await open(browser, {});
    const q = s => page.evaluate(s);
    ok(await q(() => !!document.querySelector('a.skip-link[href="#table"]') && !!document.querySelector('main#table')), 'skip link and <main>');
    ok(await q(() => { const l = document.getElementById('sr-live'); return l.getAttribute('role') === 'status' && l.getAttribute('aria-live') === 'polite'; }), 'one polite live region');
    ok(await q(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.length === new Set(ids).size; }), 'every id is unique');
    ok(await q(() => [...document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]')].every(e => ['aria-labelledby', 'aria-describedby', 'aria-controls'].every(a => !e.getAttribute(a) || e.getAttribute(a).split(/\s+/).every(i => document.getElementById(i))))), 'every aria reference points at something that exists');
    const nameless = await q(() => [...document.querySelectorAll('button, [role=button], select, input')].filter(e => { if(e.type === 'hidden') return false; const n = (e.getAttribute('aria-label') || e.textContent || '').trim() || (e.id && document.querySelector('label[for="' + e.id + '"]')) || e.getAttribute('aria-labelledby') || e.getAttribute('title'); return !n; }).map(e => e.id || e.className));
    ok(nameless.length === 0, 'every control has a name: ' + JSON.stringify(nameless));
    ok(await q(() => ['.ds-say', '#show-layer', '.ds-tray', '.ds-burn'].every(s => { const e = document.querySelector(s); return !e || e.closest('[aria-hidden="true"]'); })), 'the dealer\'s chatter, tray, burn pile and the flight layer are hidden from screen readers');
    ok(await q(() => { const e = document.querySelector('.ds-shoe'); return e.getAttribute('role') === 'button' && e.tabIndex === 0 && !!e.getAttribute('aria-label'); }), 'the shoe is a named, focusable button for those who reach for it');
    ok(await q(() => document.querySelectorAll('#board-grp, #player-grp, #dealer-grp').length === 3 && ['board-grp', 'player-grp', 'dealer-grp'].every(id => document.getElementById(id).getAttribute('aria-label'))), 'the cards are grouped and named');
    // keys: deal, look, check, bet
    await startHand(page);
    await page.keyboard.press('Space');
    ok(await untilPhase(page, 'preflop'), 'Space deals');
    await page.waitForTimeout(300);
    const live1 = await q(() => document.getElementById('sr-live').textContent);
    ok(/pair|high|suited|hole|Ace|cards/i.test(live1) || live1.length > 10, 'the live region says something after the deal: "' + live1.slice(0, 80) + '"');
    const names = await q(() => [...document.querySelectorAll('#player-cards .pc')].map(e => e.getAttribute('aria-label') || e.textContent));
    ok(names.length === 2 && names.every(n => n && /(spades|hearts|diamonds|clubs)|face down|turn|[♠♥♦♣]/i.test(n)), 'each of your cards has a name: ' + JSON.stringify(names));
    ok(await q(() => [...document.querySelectorAll('#dealer-cards .pc')].every(e => e.getAttribute('aria-hidden') === 'true' || e.closest('[aria-hidden="true"]') || e.getAttribute('aria-label'))), 'his cards are not read twice');
    await page.keyboard.press('Space');
    ok(await until(page, () => G.playerFlipCount >= 2, null, 5000), 'Space looks at your cards');
    await page.waitForTimeout(600);
    ok(await q(() => /You have|hand|pair|Ace|King/i.test(document.getElementById('sr-live').textContent)), 'it says what you hold');
    // focus: after the cards turn, focus is somewhere sensible (a button on the pinned bar, or the table), never lost on a hidden thing
    ok(await q(() => { const a = document.activeElement; return a === document.body || a.id === 'table' || !!(a.offsetParent || a.getClientRects().length); }), 'focus is not stranded on something hidden');
    await page.keyboard.press('c');
    ok(await untilPhase(page, 'flop', 25000), 'C checks');
    await page.waitForTimeout(400);
    ok(await q(() => /flop/i.test(document.getElementById('sr-live').textContent) || /flop/i.test(document.getElementById('status-text').textContent)), 'the flop is announced');
    await page.keyboard.press('c');
    ok(await untilPhase(page, 'river', 25000), 'C checks again');
    await page.waitForTimeout(400);
    ok(await q(() => /river|turn|Fold|1 times/i.test(document.getElementById('sr-live').textContent)), 'the river decision is announced');
    // every button on the bar can take focus and, when focused, is not under the bar or off screen
    const focusOk = await q(() => [...document.querySelectorAll('#action-row button')].filter(b => !b.hidden).map(b => { b.focus(); const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { id: b.id, ok: document.activeElement === b && r.top >= 0 && r.bottom <= innerHeight + 1 && t && (t === b || b.contains(t)) }; }));
    ok(focusOk.length >= 2 && focusOk.every(x => x.ok), 'each button on the bar takes focus and is not covered: ' + JSON.stringify(focusOk));
    await page.keyboard.press('b');
    ok(await untilPhase(page, 'resolved', 40000), 'B bets and the hand resolves');
    await page.waitForTimeout(500);
    ok(await q(() => /won|lost|push|win|lose|break|Flush/i.test(document.getElementById('sr-live').textContent)), 'the result is announced');
    ok(await q(() => document.querySelectorAll('.sp-res:not([hidden])').length >= 2 && [...document.querySelectorAll('.sp-res:not([hidden])')].every(e => e.closest('[aria-hidden="true"]') || e.textContent.trim())), 'per-spot results are shown (and are not read twice)');
    await page.keyboard.press('Space');
    ok(await untilPhase(page, 'betting', 6000), 'Space deals again');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- a dealer-off, a turbo and a reduced-motion hand in a real browser
  for(const m of [{ n: 'the dealer off', settings: { 'set-dealer': false } }, { n: 'turbo', settings: { 'set-turbo': true } }, { n: 'reduced motion', reduced: true }].filter(() => !FAST)){
    section('a whole hand with ' + m.n);
    const { page, errs, ctx } = await open(browser, m);
    await startHand(page);
    const t0 = Date.now();
    await playWhole(page, {});
    const took = Date.now() - t0;
    ok(await page.evaluate(() => document.querySelectorAll('.fc').length === 0 && document.querySelectorAll('.pc.pending').length === 0), 'nothing flying, nothing pending');
    ok(await page.evaluate(() => [...document.querySelectorAll('#rows .pc')].every(e => e.classList.contains('up'))), 'all nine cards are face up');
    if(m.settings && m.settings['set-turbo']) ok(took < 9000, 'turbo is quick (' + took + 'ms for a hand with my clicks)');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- the other results, and a fold, at real speed
  for(const m of [{ n: 'he does not qualify', sc: NOQ_LOSS }, { n: 'he wins', sc: DEALER_WINS }, { n: 'you fold on the river', sc: FLUSH_WIN, fold: true }].filter(() => !FAST)){
    section('a hand where ' + m.n);
    const { page, errs, ctx } = await open(browser, {});
    await startHand(page, m.sc);
    await installSampler(page);
    await playWhole(page, { fold: m.fold });
    const S = await stopSampler(page);
    ['seat-dealer', 'seat-you', 'bet-spots'].forEach(id => ok(spread(S, id, 0) < 1.5 && spread(S, id, 1) < 1.5, id + ' stays put'));
    const res = await page.evaluate(() => ({ badge: document.getElementById('outcome-badge').textContent, sr: document.getElementById('sr-live').textContent, spots: [...document.querySelectorAll('.sp-res:not([hidden])')].map(e => e.textContent).join(' ') }));
    ok(/Ante|push|lost|won|fold|break|win|lose/i.test(res.badge + res.sr + res.spots), 'the result is on the table: "' + (res.badge + ' | ' + res.spots).slice(0, 90) + '"');
    ok(await page.evaluate(() => document.querySelectorAll('.sp-res:not([hidden])').length >= 2), 'the bet spots show their results');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- how long the river maths holds up the page
  section('the river decision does not freeze the page');
  {
    const { page, ctx } = await open(browser, {});
    const t = await page.evaluate(() => {
      const hole = [{ rank: 14, suit: 's' }, { rank: 13, suit: 's' }], board = [{ rank: 12, suit: 's' }, { rank: 7, suit: 's' }, { rank: 2, suit: 's' }, { rank: 9, suit: 'd' }, { rank: 4, suit: 'c' }];
      const t0 = performance.now(); let r; for(let i = 0; i < 3; i++) r = riverDecision(hole, board, 25, 25, 25); return { ms: (performance.now() - t0) / 3, r: !!r };
    });
    ok(t.r && t.ms < 120, 'one river decision takes ' + t.ms.toFixed(1) + 'ms (limit 120)');
    await ctx.close();
  }

  await browser.close();
  console.log((fails ? 'FAILED' : 'OK') + ': ' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
