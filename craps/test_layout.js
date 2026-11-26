// Craps layout checks in a real browser: the table keeps its size while a hand is played, Come / Don't Come tags and long results never stretch it,
// the hops picker fits, and the page never scrolls sideways on a phone.   Run from the craps folder:  node test_layout.js
const { chromium } = require('playwright');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let oks = 0, failures = 0;
function ok(cond, desc, extra){ if(cond){ oks++; console.log('OK:', desc); } else { failures++; console.log('FAIL:', desc, extra === undefined ? '' : '| ' + JSON.stringify(extra)); } }
const PAGE = 'file://' + path.join(process.env.SITE ? path.join(process.env.SITE, 'craps') : __dirname, 'index.html');
const SEED = () => { try{ localStorage.setItem('house_edge_experience_v1', JSON.stringify({ level: 'pro', updated: Date.now() })); localStorage.setItem('soft17_sound', 'off'); }catch(e){} };

(async () => {
  const browser = await chromium.launch();
  // ---- desktop: heights hold still through a busy hand (every kind of bet, a point, odds, Come and Don't Come bets with odds, hops, a seven-out)
  for(const [W, H] of [[1440, 780], [1440, 900], [1366, 768], [1920, 1080]]){
    const label = W + 'x' + H;
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript(SEED);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(PAGE, { waitUntil: 'load' }); await sleep(1200);
    const click = async s => { try{ await p.click(s, { timeout: 800 }); return true; }catch(e){ return false; } };
    await click('#btn-tablesetup-continue'); await sleep(250);
    await click('#level-seg button[data-level="full"]'); await sleep(1400);
    const m = () => p.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, felt: Math.round(document.getElementById('felt').getBoundingClientRect().height), numbers: Math.round(document.getElementById('numbers').getBoundingClientRect().height), top: Math.round(document.getElementById('top-block').getBoundingClientRect().height) }));
    await p.evaluate(() => { window.__q = []; window.randDie = () => window.__q.length ? window.__q.shift() : 1 + Math.floor(Math.random() * 6); });
    const idle = await m();
    await click('#chip-10');
    for(const k of ['pass', 'field', 'hard8', 'any7', 'yo']) await click('[data-key="' + k + '"] .spot-hit');
    for(const n of [6, 8]) await click('#numbers .num[data-number="' + n + '"] .spot-hit');
    await click('#btn-hops'); for(const n of ['25', '33']) await click('.hp-cell[data-n="' + n + '"]'); await sleep(200);
    const open = await m(); await click('#btn-hops'); await sleep(200);
    const shut = await m();
    ok(Math.abs(open.felt - shut.felt) <= 2 && Math.abs(shut.felt - idle.felt) <= 3, label + ': placing bets and opening the hops picker leaves the table its size', { idle: idle.felt, open: open.felt, shut: shut.felt });
    const felts = [], numbers = [], tops = [], sh = [];
    for(const d of [[3, 3], [4, 2], [5, 5], [6, 1], [2, 6], [3, 4], [6, 6], [1, 3], [2, 2], [4, 1]]){
      await p.evaluate(d => { window.__q = d.slice(); }, d);
      await click('#btn-roll'); await sleep(3700);
      if(await click('#btn-maxodds')) await sleep(300);
      await click('[data-key="come"] .spot-hit'); await click('[data-key="dontcome"] .spot-hit'); await sleep(200);
      const x = await m(); felts.push(x.felt); numbers.push(x.numbers); tops.push(x.top); sh.push(x.sh);
    }
    const span = a => Math.max(...a) - Math.min(...a);
    ok(span(felts) <= 4, label + ': the table does not change size through ten rolls, with Come bets travelling to the numbers and winning', felts);
    ok(span(numbers) <= 2, label + ': the strip of numbers keeps its height with Come / Don\'t Come tags on it', numbers);
    ok(span(tops) <= 2, label + ': the dice area stays the same height whatever the result line says', tops);
    ok(Math.max(...sh) <= H + 2, label + ': the table fits the window all the way through (page ' + Math.max(...sh) + ' in ' + H + ')', sh);
    ok((await m()).sw <= W, label + ': no sideways scroll');
    ok(errs.length === 0, label + ': no page errors', errs.slice(0, 2));
    await ctx.close();
  }
  // ---- the puck sits clear of the number, off or on
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(SEED);
    const p = await ctx.newPage(); await p.goto(PAGE, { waitUntil: 'load' }); await sleep(1200);
    try{ await p.click('#btn-tablesetup-continue', { timeout: 800 }); }catch(e){} await sleep(250);
    try{ await p.click('#level-seg button[data-level="full"]', { timeout: 800 }); }catch(e){} await sleep(1400);
    const overlap = () => p.evaluate(() => { const r = e => e.getBoundingClientRect(), pk = r(document.getElementById('puck')); return Array.from(document.querySelectorAll('.num .num-label')).some(l => { const b = r(l); return !(pk.right <= b.left + 2 || pk.left >= b.right - 2 || pk.bottom <= b.top + 2 || pk.top >= b.bottom - 2); }); });
    ok(!(await overlap()), 'the OFF puck does not sit on a number');
    await p.evaluate(() => { window.randDie = () => 3; });
    try{ await p.click('[data-key="pass"] .spot-hit', { timeout: 800 }); await p.click('#btn-roll', { timeout: 800 }); }catch(e){} await sleep(3700);
    ok(await p.evaluate(() => G.table.point === 6), 'a 3 and a 3 makes the point 6');
    ok(!(await overlap()), 'and the ON puck does not sit on a number either');
    await ctx.close();
  }
  // ---- phone: nothing runs off the side, the hops picker opens and fits
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); await ctx.addInitScript(SEED);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(PAGE, { waitUntil: 'load' }); await sleep(1300);
    try{ await p.click('#btn-tablesetup-continue', { timeout: 800 }); }catch(e){} await sleep(250);
    try{ await p.click('#level-seg button[data-level="full"]', { timeout: 800 }); }catch(e){} await sleep(1000);
    const w0 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(w0.sw <= w0.iw, 'phone: no sideways scroll on the table', w0);
    ok(await p.evaluate(() => !document.getElementById('hops').hidden), 'phone: the Hops button is there on the Full table');
    await p.evaluate(() => toggleHops(true)); await sleep(300);
    const g = await p.evaluate(() => { const pk = document.getElementById('hop-picker').getBoundingClientRect(), cells = Array.from(document.querySelectorAll('#hop-picker .hp-cell')).map(c => c.getBoundingClientRect()); return { pk: { l: pk.left, r: pk.right }, iw: innerWidth, n: cells.length, minW: Math.min(...cells.map(c => c.width)), minH: Math.min(...cells.map(c => c.height)), out: cells.filter(c => c.right > innerWidth + 1 || c.left < -1).length }; });
    ok(g.n === 36 && g.out === 0 && g.pk.r <= g.iw + 1, 'phone: all 36 hop cells are on screen', g);
    ok(g.minW >= 40 && g.minH >= 36, 'phone: and each is big enough to tap (' + Math.round(g.minW) + 'x' + Math.round(g.minH) + ')', g);
    await p.evaluate(() => { const c = document.querySelector('#hop-picker .hp-cell[data-n="25"]'); c.scrollIntoView({ block: 'center' }); }); await sleep(200);
    try{ await p.click('#hop-picker .hp-cell[data-n="25"]', { timeout: 1500 }); }catch(e){}
    ok(await p.evaluate(() => G.table.bets.some(b => b.type === 'hop' && b.number === 25)), 'phone: tapping a cell places the hop');
    const w1 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(w1.sw <= w1.iw, 'phone: still no sideways scroll with the picker open', w1);
    ok(errs.length === 0, 'phone: no page errors', errs.slice(0, 2));
    await ctx.close();
  }
  await browser.close();
  console.log('\n' + oks + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
