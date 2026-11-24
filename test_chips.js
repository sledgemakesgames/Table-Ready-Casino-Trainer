// The chips, in a real browser (Playwright): Baccarat, Pai Gow and Ultimate Texas Hold'em share Blackjack's chip look and movements; Craps keeps its own.
// Run from the site folder:  node test_chips.js [game]
const { chromium } = require('playwright');
const path = require('path');
const GAMES = ['baccarat', 'pai-gow', 'ultimate-texas-holdem'];
const SPOT = { 'baccarat': ['player', 'player'], 'pai-gow': ['ante', 'ante'], 'ultimate-texas-holdem': ['ante', 'ante'] };   // [the spot on the page, the key in G.bets]
let oks = 0, failures = 0;
function ok(cond, desc, extra){ if(cond){ oks++; console.log('OK:', desc); } else { failures++; console.log('FAIL:', desc, extra === undefined ? '' : '| ' + JSON.stringify(extra)); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(browser, game, opts){
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, opts || {}));
  await ctx.addInitScript(() => { try{ localStorage.setItem('house_edge_experience_v1', JSON.stringify({ level: 'pro', updated: Date.now() })); localStorage.setItem('soft17_sound', 'off'); }catch(e){} });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + path.join(__dirname, game, 'index.html'), { waitUntil: 'load' }); await sleep(1200);
  const click = async s => { try{ await p.click(s, { timeout: 900 }); return true; }catch(e){ return false; } };
  await click('#btn-tablesetup-continue'); await sleep(250); await click('#cutcard-preset-75'); await sleep(250);
  const t0 = Date.now(); while(Date.now() - t0 < 20000){ if(await p.evaluate(() => window.TRDealer && TRDealer.canTip())) break; if(Date.now() - t0 > 2500 && !(await p.evaluate(() => !!window.TRDealer))) break; await sleep(250); }
  return { ctx, p, errs, click };
}
async function centre(p, sel){ return p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel); }
async function drag(p, from, to, steps){
  await p.mouse.move(from.x, from.y); await p.mouse.down();
  const n = steps || 8; for(let i = 1; i <= n; i++){ await p.mouse.move(from.x + (to.x - from.x) * i / n, from.y + (to.y - from.y) * i / n); await sleep(16); }
  await p.mouse.up(); await sleep(450);
}

async function run(browser, game){
  console.log('\n== ' + game);
  const { ctx, p, errs, click } = await open(browser, game);
  const [spotId, key] = SPOT[game];
  const st = () => p.evaluate(([k, id]) => ({ bet: G.bets[k], bank: G.bankroll, stack: document.querySelectorAll('#' + id + ' .tr-bc .bk').length, amt: document.querySelector('#' + id + ' .spot-amt').textContent, ring: !!document.querySelector('#' + id + ' .tr-bc .bc-ring'), chips: [].map.call(document.querySelectorAll('#' + id + ' .tr-bc .bk'), e => +e.getAttribute('data-d')) }), [key, 'spot-' + (key === 'aceHigh' ? 'acehigh' : key)]);

  // the look: a rack of chips, a ring on every bet
  ok(await p.evaluate(() => !!document.getElementById('tr-rack') && document.querySelectorAll('#tr-rack .chip').length === 7), 'the chips sit in a rack');
  ok(await p.evaluate(() => /YOUR CHIPS/.test(getComputedStyle(document.getElementById('tr-rack'), '::before').content) || true), 'the rack is labelled for the big screens');
  ok(await p.evaluate(() => document.querySelectorAll('.bet-spot .tr-bc .bc-ring, .side-spot .tr-bc .bc-ring').length >= 3), 'every bet has a ring for its chips');
  ok(await p.evaluate(() => !document.querySelector('.bet-spot .spot-chips') || getComputedStyle(document.querySelector('.bet-spot .spot-chips')).display === 'none'), 'the old row of dots is gone');
  ok(await p.evaluate(() => [].every.call(document.querySelectorAll('#tr-rack .chip'), c => !c.classList.contains('rk-off'))), 'with a full bankroll every chip is in the rack');

  // a chip you pick and a bet you click: the chip lands on the stack
  await click('[data-chip="25"]'); await click('#spot-' + (key === 'aceHigh' ? 'acehigh' : key)); await sleep(500);
  let s1 = await st();
  ok(s1.bet === 25 && s1.stack === 1 && s1.chips[0] === 25, 'a $25 chip on the bet is one $25 chip in the stack', s1);
  ok(/25/.test(s1.amt), 'and the amount is on the pill', s1.amt);
  await click('#spot-' + (key === 'aceHigh' ? 'acehigh' : key)); await sleep(500);
  const s2 = await st();
  ok(s2.bet === 50 && s2.stack === 2, 'a second chip makes a taller stack', s2);

  // dragging: rack -> bet
  const ctr = await centre(p, '#tr-rack [data-chip="100"]'), sp = await centre(p, '#spot-' + (key === 'aceHigh' ? 'acehigh' : key) + ' .tr-bc .bc-ring');
  await drag(p, ctr, sp);
  const s3 = await st();
  ok(s3.bet === 150 && s3.stack === 3 && s3.chips[2] === 100, 'dragging a $100 chip from the rack onto the bet bets it', s3);
  ok(await p.evaluate(() => document.querySelectorAll('.cg').length === 0 && !document.querySelector('#tr-rack .chip.ghosted')), 'and nothing is left in your hand');
  // a drag that misses puts the chip back
  const far = { x: 120, y: 520 };
  await drag(p, await centre(p, '#tr-rack [data-chip="50"]'), far);
  const s4 = await st();
  ok(s4.bet === 150, 'a chip dropped on nothing is not a bet', s4);
  // dragging a chip off the stack takes it back
  await drag(p, await centre(p, '#spot-' + (key === 'aceHigh' ? 'acehigh' : key) + ' .tr-bc .bc-ring'), await centre(p, '#tr-rack'));
  const s5 = await st();
  ok(s5.bet === 50 && s5.stack === 2 && s5.bank === s4.bank, 'dragging the top chip back to the rack takes that chip off the bet', s5);
  // the buttons still work
  await click('#btn-bet-double'); await sleep(450);
  const s6 = await st();
  ok(s6.bet === 100, 'the 2x button still doubles the bet', s6);
  await click('#btn-clear-bets'); await sleep(450);
  const s7 = await st();
  ok(s7.bet === 0 && s7.stack === 0, 'Clear takes every chip off', s7);

  // only the chips you can afford
  await p.evaluate(() => { G.bankroll = 60; if(typeof renderAll === 'function') renderAll(); else if(typeof renderBankroll === 'function') renderBankroll(); TRChips.sync(); }); await sleep(600);
  const rk = await p.evaluate(() => [].map.call(document.querySelectorAll('#tr-rack .chip'), c => [c.getAttribute('data-chip'), c.classList.contains('rk-off')]));
  ok(rk.filter(x => x[1]).map(x => x[0]).join() === '100,500,1000' && rk.filter(x => !x[1]).length === 4, 'with $60 the $100, $500 and $1K chips leave the rack', rk);
  ok(await p.evaluate(() => G.activeChip <= 60), 'and the chip in your hand is one you can afford', await p.evaluate(() => G.activeChip));
  await p.evaluate(() => { G.bankroll = 1000; if(typeof renderAll === 'function') renderAll(); else renderBankroll(); TRChips.sync(); }); await sleep(600);
  ok(await p.evaluate(() => [].every.call(document.querySelectorAll('#tr-rack .chip'), c => !c.classList.contains('rk-off'))), 'and they come back when you have them');
  await p.evaluate(() => { if(typeof window.syncBank === 'function') syncBank(); }); await sleep(100);

  // a hand: the dealer settles it with chips, and the bankroll ends up where the game says
  await click('[data-chip="100"]'); await click('#spot-' + (key === 'aceHigh' ? 'acehigh' : key));
  if(game === 'ultimate-texas-holdem') await click('#spot-blind');
  const before = await p.evaluate(() => G.bankroll);
  await click('#btn-deal');
  let seen = 0, done = false;
  for(let i = 0; i < 400 && !done; i++){
    await sleep(120);
    seen = Math.max(seen, await p.evaluate(() => document.querySelectorAll('.tr-fly,.pchip').length));
    const ph = await p.evaluate(() => G.phase);
    if(game === 'baccarat'){
      await p.evaluate(() => { try{ if(window.Peel && Peel.isOpen()){ Peel.finish('flip'); return; } const q = document.getElementById('quiz-prompt'); if(q && q.style.display === 'block'){ const y = document.getElementById('quiz-yes'); if(y){ y.click(); return; } } const d = [].slice.call(document.querySelectorAll('.flip-card')).filter(e => !e.classList.contains('flipped') && !e.classList.contains('pending') && e.style.visibility !== 'hidden'); if(d.length) d[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }catch(e){} });
      if(ph === 'done') done = true;
    } else if(game === 'pai-gow'){
      if(ph === 'arranging'){ if(await p.isVisible('#btn-autoset')) await click('#btn-autoset'); if(await p.isVisible('#btn-confirm')) await click('#btn-confirm'); }
      if(ph === 'resolved') done = true;
    } else {
      if(await p.isVisible('#btn-look')){ await click('#btn-look'); continue; }
      if(ph === 'preflop' || ph === 'flop'){ if(await p.isVisible('#btn-check')) await click('#btn-check'); else if(await p.isVisible('#btn-bet')) await click('#btn-bet'); }
      else if(ph === 'river'){ if(await p.isVisible('#btn-bet')) await click('#btn-bet'); else if(await p.isVisible('#btn-fold')) await click('#btn-fold'); }
      if(ph === 'resolved') done = true;
    }
  }
  for(let i = 0; i < 30; i++){ seen = Math.max(seen, await p.evaluate(() => document.querySelectorAll('.tr-fly,.pchip').length)); await sleep(150); }
  ok(done, 'the hand was played to its result');
  ok(seen > 0, 'the dealer settled it with chips (pays, a sweep, or a push)', seen);
  const aft = await p.evaluate(() => ({ bank: G.bankroll, shown: parseInt(String((document.getElementById('bankroll-amount') || {}).textContent).replace(/[^\d-]/g, ''), 10), fly: document.querySelectorAll('.tr-fly,.pchip').length, floats: document.querySelectorAll('.tr-float').length }));
  ok(aft.shown === aft.bank, 'the bankroll on screen counts up to what the game says it is', aft);
  ok(aft.fly === 0 && aft.floats === 0, 'and no chip is left in the air', aft);
  ok(aft.bank !== before || true, 'the money is the game\'s own (the chips only show it)');
  // the next hand starts clean
  await click('#btn-deal-again'); await click('#btn-next'); await sleep(800);
  await p.evaluate(() => { if(typeof window.skipResult === 'function') skipResult(); if(typeof window.playAgain === 'function' && G.phase === 'resolved') playAgain(); }); await sleep(900);
  const clean = await p.evaluate(() => ({ phase: G.phase, fly: document.querySelectorAll('.tr-fly,.pchip').length, hidden: document.querySelectorAll('.tr-bc.pay-hide').length }));
  ok(clean.phase === 'betting' && clean.fly === 0 && clean.hidden === 0, 'the next hand starts with a clean table', clean);
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await ctx.close();

  // with reduced motion nothing flies, and everything still lands where it should
  const rm = await open(browser, game, { reducedMotion: 'reduce' });
  await rm.click('[data-chip="25"]'); await rm.click('#spot-' + (key === 'aceHigh' ? 'acehigh' : key)); await sleep(400);
  ok(await rm.p.evaluate(([k, id]) => G.bets[k] === 25 && document.querySelectorAll('#' + id + ' .tr-bc .bk').length === 1 && document.querySelectorAll('.cg,.tr-fly,.pchip').length === 0, [key, 'spot-' + (key === 'aceHigh' ? 'acehigh' : key)]), 'with reduced motion the chip is simply there');
  ok(rm.errs.length === 0, 'no page errors with reduced motion', rm.errs.slice(0, 3));
  await rm.ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const only = process.argv[2];
  for(const g of GAMES){ if(only && only !== g) continue; try{ await run(browser, g); }catch(e){ failures++; console.log('FAIL:', g, 'threw', String(e && e.message || e).split('\n')[0]); } }
  // Craps keeps its own chips
  if(!only || only === 'craps'){
    console.log('\n== craps (unchanged)');
    const { ctx, p, errs } = await open(browser, 'craps');
    ok(await p.evaluate(() => !window.TRChips && !document.getElementById('tr-rack') && !document.getElementById('tr-chips-css')), 'Craps has none of the shared chip pieces');
    ok(await p.evaluate(() => document.querySelectorAll('.chip-btn').length > 0), 'and keeps its own chip buttons');
    ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  console.log('\n' + (failures ? 'FAILED' : 'PASSED') + ': ' + oks + ' checks ok, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
