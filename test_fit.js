// The desktop fit, in a real browser (Playwright), in all five games: the table uses the window it is in, and nothing moves or changes size while you play a hand.
// Run from the site folder:  node test_fit.js [game]
const { chromium } = require('playwright');
const path = require('path');
const GAMES = ['blackjack', 'baccarat', 'pai-gow', 'ultimate-texas-holdem', 'craps'];
const SIZES = [[1440, 700], [1440, 900], [1920, 1080], [1366, 768]];
let oks = 0, failures = 0;
function ok(cond, desc, extra){ if(cond){ oks++; console.log('OK:', desc); } else { failures++; console.log('FAIL:', desc, extra === undefined ? '' : '| ' + JSON.stringify(extra)); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(browser, game, W, H){
  const label = game + ' ' + W + 'x' + H;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(() => { try{ localStorage.setItem('house_edge_experience_v1', JSON.stringify({ level: 'pro', updated: Date.now() })); localStorage.setItem('soft17_sound', 'off'); }catch(e){} });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + path.join(__dirname, game, 'index.html'), { waitUntil: 'load' }); await sleep(1100);
  const click = async s => { try{ await p.click(s, { timeout: 900 }); return true; }catch(e){ return false; } };
  await click('#btn-tablesetup-continue'); await sleep(250); await click('#cutcard-preset-75'); await sleep(1400);
  const M = () => p.evaluate(() => { const de = document.documentElement; const wrap = document.querySelector('.wrap'); return { over: Math.max(de.scrollHeight, document.body.scrollHeight) - innerHeight, overX: de.scrollWidth - innerWidth, fit: getComputedStyle(de).getPropertyValue('--fit').trim(), wrapBottom: Math.round(wrap.getBoundingClientRect().bottom), ih: innerHeight }; });

  const a = await M();
  ok(a.fit !== '', label + ': the page found a fit for the window', a);
  ok(a.over <= 0, label + ': the whole table is on one screen to begin with', a);
  ok(a.overX <= 0, label + ': nothing spills sideways', a);
  ok(Number(a.fit) > 0.02 || H < 760, label + ': it is not squeezed to the tightest unless the window is short', a);
  ok(a.wrapBottom >= a.ih - 190 || H > 1000, label + ': and it uses the height it was given', a);

  // a hand: the size must not change from the first bet to the last card
  const fits = [a.fit];
  if(game === 'craps'){
    await click('[data-chip="25"]'); await click('[data-key="pass"] .spot-hit'); await sleep(300); fits.push((await M()).fit);
    await p.evaluate(() => rollDice(2, 2)); await sleep(900); const mid = await M(); fits.push(mid.fit);
    ok(mid.over <= 0, label + ': still one screen while the dice are in the air', mid);
    await sleep(3600); const end = await M(); fits.push(end.fit);
    ok(await p.evaluate(() => G.point === 4 || (G.table && G.table.point === 4) || !!document.querySelector('.odds-row.show')), label + ': a point is on (the roughest case: odds buttons are out)');
    ok(end.over <= 1, label + ': and once they have landed', end);
  } else {
    const spot = { 'baccarat': '#spot-player', 'pai-gow': '#spot-ante', 'ultimate-texas-holdem': '#spot-ante' }[game];
    if(game === 'blackjack'){ await click('#chip-25'); await click('#chip-25'); }
    else { await click('[data-chip="25"]'); await click(spot); if(game === 'ultimate-texas-holdem') await click('#spot-blind'); }
    await sleep(500); fits.push((await M()).fit);
    await click('#btn-deal'); await sleep(2800);
    const mid = await M(); fits.push(mid.fit);
    ok(mid.over <= 1, label + ': still one screen with the cards out', mid);
    // play it out
    for(let i = 0; i < 60; i++){
      await sleep(250);
      const ph = await p.evaluate(() => G.phase);
      if(game === 'blackjack'){ await p.evaluate(() => { const b = [].find.call(document.querySelectorAll('button'), x => /^\s*Stand/.test(x.textContent) && x.offsetParent && !x.disabled); if(b) b.click(); }); if(ph === 'done' || ph === 'resolved' || ph === 'over') break; }
      else if(game === 'baccarat'){ await p.evaluate(() => { try{ if(window.Peel && Peel.isOpen()){ Peel.finish('flip'); return; } const q = document.getElementById('quiz-prompt'); if(q && q.style.display === 'block'){ const y = document.getElementById('quiz-yes'); if(y) y.click(); } }catch(e){} }); if(ph === 'done') break; }
      else if(game === 'pai-gow'){ if(ph === 'arranging'){ if(await p.isVisible('#btn-autoset')) await click('#btn-autoset'); if(await p.isVisible('#btn-confirm')) await click('#btn-confirm'); } if(ph === 'resolved') break; }
      else { if(await p.isVisible('#btn-look')){ await click('#btn-look'); continue; } if(ph === 'preflop' || ph === 'flop'){ if(await p.isVisible('#btn-check')) await click('#btn-check'); else if(await p.isVisible('#btn-bet')) await click('#btn-bet'); } else if(ph === 'river'){ if(await p.isVisible('#btn-bet')) await click('#btn-bet'); else if(await p.isVisible('#btn-fold')) await click('#btn-fold'); } if(ph === 'resolved') break; }
    }
    await sleep(1500); fits.push((await M()).fit);
  }
  ok(new Set(fits).size === 1, label + ': the table keeps its size from the first bet to the result', fits);
  ok(errs.length === 0, label + ': no page errors', errs.slice(0, 3));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const only = process.argv[2];
  for(const g of GAMES){
    if(only && only !== g) continue;
    for(const [w, h] of SIZES){
      if(g === 'craps' && w < 1320) continue;
      try{ await run(browser, g, w, h); }catch(e){ failures++; console.log('FAIL:', g, w + 'x' + h, 'threw', String(e && e.message || e).split('\n')[0]); }
    }
  }
  await browser.close();
  console.log('\n' + (failures ? 'FAILED' : 'PASSED') + ': ' + oks + ' checks ok, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
