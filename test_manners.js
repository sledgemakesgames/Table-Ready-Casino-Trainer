// The real-table rehearsal ("Table manners"), in a real browser (Playwright), in all five games.
// Run from the site folder:  node test_manners.js [game]
const { chromium } = require('playwright');
const path = require('path');
const GAMES = ['blackjack', 'baccarat', 'pai-gow', 'ultimate-texas-holdem', 'craps'];
let oks = 0, failures = 0;
function ok(cond, desc, extra){ if(cond){ oks++; console.log('OK:', desc); } else { failures++; console.log('FAIL:', desc, extra === undefined ? '' : '| ' + JSON.stringify(extra)); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(browser, game, vp, label){
  console.log('\n== ' + game + ' (' + label + ')');
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 600, hasTouch: vp.width < 600 });
  await ctx.addInitScript(() => { try{ localStorage.setItem('house_edge_experience_v1', JSON.stringify({ level: 'pro', updated: Date.now() })); localStorage.setItem('soft17_sound', 'off'); }catch(e){} });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  const url = 'file://' + path.join(__dirname, game, 'index.html');
  const click = async s => { try{ await p.click(s, { timeout: 900 }); return true; }catch(e){ return false; } };
  const phone = vp.width < 600;
  await p.goto(url, { waitUntil: 'load' }); await sleep(1100);
  await click('#btn-tablesetup-continue'); await sleep(250); await click('#cutcard-preset-75'); await sleep(250);

  const ST = () => p.evaluate(() => TRManners.state());
  const isOpen = () => p.evaluate(() => { const o = document.getElementById('manners-overlay'); const b = document.getElementById('manners-back'); if(b) return !b.hidden; return !!o && o.style.display !== 'none' && o.offsetParent !== null || (!!o && getComputedStyle(o).position === 'fixed' && o.style.display !== 'none'); });
  const info = () => p.evaluate(() => {
    const o = document.getElementById('manners-overlay'), c = o.querySelector('.rt-card'), on = o.querySelector('.rt-txt.on'), btn = document.getElementById('btn-manners-close'), back = o.querySelector('.rt-back');
    const r = c.getBoundingClientRect();
    return { title: on && on.querySelector('h2').textContent, kick: o.querySelector('.rt-kick').textContent, btn: btn.textContent, backDisabled: back.disabled, i: TRManners.state().i, h: Math.round(r.height), w: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, vw: innerWidth, sw: c.scrollWidth, cw: c.clientWidth,
      focusIn: o.contains(document.activeElement), role: o.getAttribute('role'), modal: o.getAttribute('aria-modal'), dots: o.querySelectorAll('.rt-dot').length, dotOn: o.querySelectorAll('.rt-dot.on').length };
  });
  const openIt = async () => { if(phone) await p.evaluate(() => document.getElementById('btn-manners').click()); else await p.click('#btn-manners'); await sleep(450); };

  const g = await p.evaluate(() => TRManners.game);
  ok(g === (game === 'pai-gow' ? 'paigow' : game === 'ultimate-texas-holdem' ? 'uth' : game), 'the module knows which game it is in', g);
  ok(await p.evaluate(() => !!document.getElementById('btn-manners')), 'the Table manners link is on the page');
  ok(!(await isOpen()), 'it is closed to begin with');

  await openIt();
  ok(await isOpen(), 'the link opens it');
  let i0 = await info();
  ok(i0.kick === 'Move 1 of 4' && i0.i === 0, 'it starts at move 1 of 4', i0);
  ok(i0.title && i0.title.length > 3, 'with the first move’s title', i0.title);
  ok(i0.btn === 'Next' && i0.backDisabled, 'the button says Next, and there is no Back yet', i0);
  ok(i0.role === 'dialog' && i0.modal === 'true', 'it is a dialog', i0);
  ok(i0.focusIn, 'focus is inside it', i0);
  ok(i0.dots === 5 && i0.dotOn === 1, 'five dots, one lit', i0);
  ok(i0.sw <= i0.cw + 1, 'nothing spills sideways', [i0.sw, i0.cw]);
  ok(i0.top >= 0 && i0.bottom <= i0.vh + 1, 'the card fits on the screen', [i0.top, i0.bottom, i0.vh]);

  // the table behind it must not deal or roll while it is open
  await click('[data-chip="25"]'); await click('#chip-25');
  const before = await p.evaluate(() => ({ phase: G.phase, bank: G.bankroll }));
  await p.evaluate(() => { if(document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await p.keyboard.press('Space'); await sleep(700);
  const afterSpace = await p.evaluate(() => ({ phase: G.phase, bank: G.bankroll, i: TRManners.state().i }));
  ok(afterSpace.phase === before.phase && afterSpace.bank === before.bank, 'Space does not deal or roll behind it', [before, afterSpace]);
  ok(afterSpace.i === 0, 'and does not step it either when focus is elsewhere', afterSpace);

  // Next / Back / arrows / dots
  await p.focus('#btn-manners-close'); await p.keyboard.press('Space'); await sleep(450);
  let i1 = await info();
  ok(i1.i === 1 && i1.kick === 'Move 2 of 4' && i1.title !== i0.title, 'Space on the focused Next goes to move 2', i1);
  ok(await p.evaluate(() => G.phase) === before.phase, 'still nothing dealt', await p.evaluate(() => G.phase));
  ok(!i1.backDisabled, 'Back is there now', i1);
  await p.click('#manners-overlay .rt-back'); await sleep(350);
  ok((await ST()).i === 0, 'Back goes back');
  await p.keyboard.press('ArrowRight'); await sleep(200); await p.keyboard.press('ArrowRight'); await sleep(200);
  ok((await ST()).i === 2, 'the right arrow steps forward');
  await p.keyboard.press('ArrowLeft'); await sleep(200);
  ok((await ST()).i === 1, 'the left arrow steps back');
  await p.click('#manners-overlay .rt-dot[data-i="3"]', { force: true }); await sleep(300);
  ok((await ST()).i === 3, 'a dot jumps to its move');
  await sleep(500);
  ok(await p.evaluate(() => { const t = document.querySelectorAll('#manners-overlay .rt-txt'); return [].filter.call(t, e => getComputedStyle(e).visibility === 'visible').length === 1; }), 'only one move is showing at a time');

  // every move: the card keeps its height, nothing clips
  const hs = []; for(let k = 0; k <= 4; k++){ await p.evaluate(k2 => TRManners.go(k2), k); await sleep(200); const x = await info(); hs.push(x.h); ok(x.sw <= x.cw + 1 && x.bottom <= x.vh + 1 && x.top >= 0, 'move ' + (k + 1) + ' fits (' + x.h + 'px high)', x); }
  ok(Math.max.apply(null, hs) - Math.min.apply(null, hs) <= 1, 'the card does not change height between moves', hs);
  const iL = await info();
  ok(iL.btn === 'Got it' && iL.kick.length > 2 && !/^Move/.test(iL.kick), 'the last card says Got it, and names the game', iL);

  // closing: Got it, then it starts over
  await p.click('#btn-manners-close'); await sleep(350);
  ok(!(await isOpen()), 'Got it closes it');
  if(!phone) ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'btn-manners'), 'and focus goes back to the link', await p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  await openIt();
  ok((await ST()).i === 0 && (await info()).kick === 'Move 1 of 4', 'opened again, it starts at move 1');

  // Escape, the cross, the dim area
  await p.keyboard.press('ArrowRight'); await sleep(150);
  await p.keyboard.press('Escape'); await sleep(350);
  ok(!(await isOpen()), 'Escape closes it');
  if(game === 'pai-gow' || game === 'ultimate-texas-holdem') ok(await p.evaluate(() => !document.getElementById('app').hasAttribute('inert')), 'and the page behind is live again');
  await openIt(); await p.click('#manners-overlay .rt-x'); await sleep(350);
  ok(!(await isOpen()), 'the cross closes it');
  await openIt();
  await p.mouse.click(vp.width - 6, 6); await sleep(350);
  ok(!(await isOpen()), 'a tap on the dim area closes it');

  // the old pop-up text is gone
  await openIt();
  ok(await p.evaluate(() => !document.querySelector('#manners-overlay ul')), 'the old bullet list is gone');
  await p.keyboard.press('Escape'); await sleep(300);

  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const only = process.argv[2];
  for(const g of GAMES){
    if(only && only !== g) continue;
    for(const [vp, label] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 375, height: 667 }, 'phone']]){
      try{ await run(browser, g, vp, label); }catch(e){ failures++; console.log('FAIL:', g, label, 'threw', String(e && e.message || e).split('\n')[0]); }
    }
  }
  await browser.close();
  console.log('\n' + (failures ? 'FAILED' : 'PASSED') + ': ' + oks + ' checks ok, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
