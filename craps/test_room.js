// Craps: nothing sits on top of anything else. The dice total, the stickman's call, the puck and the notices keep clear of the dice, the numbers and the top bar.
// Run from the craps folder:  node test_room.js
const { chromium } = require('playwright');
const path = require('path');
let oks = 0, failures = 0;
function ok(cond, desc, extra){ if(cond){ oks++; console.log('OK:', desc); } else { failures++; console.log('FAIL:', desc, extra === undefined ? '' : '| ' + JSON.stringify(extra)); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hit = (a, b) => !!(a && b) && a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;

async function open(browser, vp, mobile){
  const ctx = await browser.newContext({ viewport: vp, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(() => { try{ localStorage.setItem('house_edge_experience_v1', JSON.stringify({ level: 'pro', updated: Date.now() })); localStorage.setItem('soft17_sound', 'off'); }catch(e){} });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + path.join(__dirname, 'index.html'), { waitUntil: 'load' }); await sleep(1300);
  try{ await p.click('#btn-tablesetup-continue', { timeout: 900 }); }catch(e){} await sleep(350);
  return { ctx, p, errs };
}
const boxes = (p, sels) => p.evaluate(sels => { const o = {}; sels.forEach(s => { const e = document.querySelector(s); if(!e || !e.offsetWidth){ o[s] = null; return; } const r = e.getBoundingClientRect(); o[s] = { l: r.left, r: r.right, t: r.top, b: r.bottom }; }); return o; }, sels);

async function desk(browser, w, h){
  console.log('\n== desktop ' + w + 'x' + h);
  const { ctx, p, errs } = await open(browser, { width: w, height: h });
  try{ await p.click('[data-key="pass"] .spot-hit', { timeout: 1500 }); }catch(e){}
  for(const [a, c] of [[3, 4], [4, 4], [3, 3]]){ await p.evaluate(([a, c]) => rollDice(a, c), [a, c]); await sleep(2300); }
  await p.evaluate(() => { const e = document.getElementById('stick-call'); e.textContent = 'Seven! Front line winner!'; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); });
  await sleep(500);
  const b = await boxes(p, ['.rd-pill', '#die-0', '#die-1', '#stick-call', '#puck', '.num[data-number="6"]', '.num[data-number="8"]', '.num[data-number="4"]', '.status-bar', '#roll-strip', '.dice-pick']);
  ok(b['.rd-pill'] && b['#die-0'] && b['#die-1'], 'the dice total and both dice are on screen', b);
  ok(!hit(b['.rd-pill'], b['#die-0']) && !hit(b['.rd-pill'], b['#die-1']), 'the dice total does not cover the dice', [b['.rd-pill'], b['#die-0'], b['#die-1']]);
  ok(!hit(b['.rd-pill'], b['.dice-pick']), 'and does not cover the dice colour button', [b['.rd-pill'], b['.dice-pick']]);
  ok(!hit(b['#stick-call'], b['#die-0']) && !hit(b['#stick-call'], b['#die-1']), 'the stickman\'s call does not cover the dice either', [b['#stick-call'], b['#die-0'], b['#die-1']]);
  // the puck rides on the top corner of the point's box: it sits inside that box, never over a number, and never in the next box
  const pk = await p.evaluate(() => {
    const r = e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const puck = r(document.getElementById('puck')), box = r(document.querySelector('.num[data-number="' + G.table.point + '"]'));
    const labels = Array.from(document.querySelectorAll('.num .num-label')).map(r);
    return { puck, box, labels };
  });
  ok(pk.labels.every(l => !hit(pk.puck, l)), 'the puck does not cover any of the numbers', pk);
  ok(pk.puck.l >= pk.box.l - 1 && pk.puck.r <= pk.box.r + 1, 'it stays inside the point\'s own box, not the next one', pk);
  ok(pk.puck.t <= pk.box.t + 6 && pk.puck.b > pk.box.t, 'and sits on the top edge of that box', pk);
  ok(pk.puck.l > (pk.box.l + pk.box.r) / 2, 'on the right-hand corner, clear of the number', pk);
  const kids = await p.evaluate(() => Array.from(document.querySelectorAll('#roll-strip .rp')).filter(e => e.offsetWidth).length);
  ok(kids <= 10 && kids >= 3, 'the roll strip shows the last ten rolls (' + kids + ')');

  // a reload brings the welcome-back note: it takes the callout's row, not the top bar
  await p.reload({ waitUntil: 'load' }); await sleep(1400);
  try{ await p.click('#btn-tablesetup-continue', { timeout: 700 }); }catch(e){} await sleep(250);
  const n = await p.evaluate(() => { const e = document.getElementById('resume-notice'); const shown = e && getComputedStyle(e).display !== 'none'; const r = (x => x && x.getBoundingClientRect())(e); const c = document.getElementById('callout').getBoundingClientRect(), s = document.querySelector('.status-bar').getBoundingClientRect(), rs = document.getElementById('roll-strip').getBoundingClientRect(); const cv = getComputedStyle(document.getElementById('callout')).visibility; return { shown, n: r && { l: r.left, r: r.right, t: r.top, b: r.bottom }, c: { l: c.left, r: c.right, t: c.top, b: c.bottom }, s: { l: s.left, r: s.right, t: s.top, b: s.bottom }, rs: { l: rs.left, r: rs.right, t: rs.top, b: rs.bottom }, cv }; });
  if(n.shown){
    ok(!hit(n.n, n.s) && !hit(n.n, n.rs), 'the welcome-back note stays off the top bar and the roll strip', n);
    ok(Math.abs(n.n.t - n.c.t) < 3 && Math.abs(n.n.b - n.c.b) < 3, 'it sits in the callout\'s own row', n);
    ok(n.cv === 'hidden', 'and the callout steps aside while it shows', n.cv);
  } else console.log('(no restored bets on this run: the note was not shown)');
  await p.evaluate(() => toast('Tip: the 6 and 8 pay 7:6, so bet in $6 steps ($30, $60...). Otherwise the payout is rounded down.')); await sleep(300);
  const t = await p.evaluate(() => { const e = document.getElementById('table-msg'), r = e.getBoundingClientRect(), d = document.getElementById('die-0').getBoundingClientRect(), s = document.querySelector('.status-bar').getBoundingClientRect(); return { h: r.height, oneLine: r.height < 40, overDice: r.top < d.bottom && r.bottom > d.top && r.left < d.right && r.right > d.left, overBar: r.top < s.bottom && r.bottom > s.top }; });
  ok(t.oneLine && !t.overDice && !t.overBar, 'a long tip shows on one line, clear of the dice and the top bar', t);
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

async function phone(browser){
  console.log('\n== phone');
  const { ctx, p, errs } = await open(browser, { width: 390, height: 844 }, true);
  await p.evaluate(() => toast('Not enough bankroll for odds.')); await sleep(300);
  const r = await p.evaluate(() => { const e = document.getElementById('table-msg'), b = e.getBoundingClientRect(); return { pos: getComputedStyle(e).position, bottom: b.bottom, ih: innerHeight }; });
  ok(r.pos === 'fixed' && r.bottom > r.ih * 0.7, 'on a phone the notice still floats above the bottom dock', r);
  ok(errs.length === 0, 'no page errors', errs);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await desk(browser, 1440, 780);
  await desk(browser, 1366, 657);
  await desk(browser, 1920, 950);
  await phone(browser);
  await browser.close();
  console.log('\n' + oks + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
