// Pai Gow in a real browser (Chromium via Playwright): layout stability while cards come in, the phone layout, taps, the settings sheet, dialogs.
//   NODE_PATH=$(npm root -g) node tests/test_pg_browser.js [path/to/index.html]
const { chromium } = require('playwright');
const path = require('path');
const FAST = !!process.env.FAST;       // FAST=1: only the phone checks that matter most (used by the mutation runs)
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html'));
let fails = 0, passes = 0, current = '';
function ok(cond, msg){ if(cond){ passes++; } else { fails++; console.log('  FAIL [' + current + '] ' + msg); if(process.env.BAIL) process.exit(1); } }
function section(n){ current = n; if(!process.env.QUIET) console.log('· ' + n); }
const SPLIT = { p: ['As','Ad','9c','8h','4s','3d','Kc'], d: ['Js','Jd','7s','6s','2s','Kh','Qd'] };
const ACE_HIGH = { p: ['Ks','Kh','9d','7c','5s','3d','2c'], d: ['As','Kd','Jh','9c','6s','3d','2h'] };

async function open(browser, o){
  o = o || {};
  const ctx = await browser.newContext({ viewport: o.vp || { width: 1280, height: 900 }, deviceScaleFactor: 1, hasTouch: !!o.touch, isMobile: !!o.mobile, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  await ctx.route('**/fonts.g*/**', r => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|AudioContext|fonts\./.test(m.text())) errs.push(m.type() + ': ' + m.text()); });
  if(o.storage) await page.addInitScript(s => { for(const k in s) localStorage.setItem(k, s[k]); }, o.storage);
  await page.goto('file://' + FILE);
  await page.waitForTimeout(250);
  if(o.settings) await page.evaluate(s => { for(const k in s){ const e = document.getElementById(k); if(!e) continue; if(e.type === 'checkbox') e.checked = s[k]; else e.value = s[k]; e.dispatchEvent(new Event('change', { bubbles: true })); } }, o.settings);
  return { ctx, page, errs };
}
async function rig(page, p, d){
  await page.evaluate(([p, d]) => {
    const parse = c => c === 'JOKER' ? { rank: 'JOKER', suit: null, joker: true } : { rank: c.slice(0, -1), suit: c.slice(-1), joker: false };
    const P = p.map(parse), D = d.map(parse), key = c => c.joker ? 'JOKER' : c.rank + c.suit, used = new Set(P.concat(D).map(key));
    const pool = freshDeck().filter(c => !used.has(key(c)));
    window.shuffle = () => P.concat(D).concat(pool);
  }, [p, d]);
}
const phase = page => page.evaluate(() => G.phase);
async function untilPhase(page, ph, ms){ try{ await page.waitForFunction(p => G.phase === p, ph, { timeout: ms || 25000 }); return true; }catch(e){ return false; } }
async function tap(page, sel, touch){ if(touch) await page.tap(sel); else await page.click(sel); }
// where a dragged card is, frame by frame, against its ghost: on a drop the real card must take over exactly where the ghost was (a card that appears somewhere else and slides in looks broken)
const trackStart = (page, sel) => page.evaluate(sel => { const el = document.querySelector(sel); window.__tk = []; window.__tkOn = true; (function f(){ const g = document.querySelector('.pc-ghost'), r = el.getBoundingClientRect(), gr = g && g.getBoundingClientRect(); window.__tk.push({ g: gr ? [gr.left + gr.width / 2, gr.top + gr.height / 2] : null, c: [r.left + r.width / 2, r.top + r.height / 2] }); if(window.__tkOn) requestAnimationFrame(f); })(); }, sel);
const dropGap = async page => { const tk = await page.evaluate(() => { window.__tkOn = false; return window.__tk; }); let last = -1; tk.forEach((x, i) => { if(x.g) last = i; }); if(last < 0 || last + 1 >= tk.length) return null; const a = tk[last].g, b = tk[last + 1].c; return Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])); };
async function startHand(page, o){
  o = o || SPLIT;
  await rig(page, o.p, o.d);
  await page.evaluate(() => { selectChip(25); placeBet('ante'); placeBet('ante'); });
}
// sample the layout every animation frame: where the seats, the status line and the band are, and where every card is
function installSampler(page){
  return page.evaluate(() => {
    window.__S = []; window.__go = true;
    const ids = ['dealer-band', 'rows', 'seat-dealer', 'seat-you', 'status-line'];
    function snap(){
      const o = { t: performance.now(), ph: G.phase, el: {}, cards: {} };
      ids.forEach(id => { const e = document.getElementById(id); if(e){ const b = e.getBoundingClientRect(); o.el[id] = [+(b.top + scrollY).toFixed(1), +b.height.toFixed(1), +b.left.toFixed(1), +b.width.toFixed(1)]; } });
      document.querySelectorAll('#rows .pc').forEach(e => { const b = e.getBoundingClientRect(); const seat = e.closest('#seat-you') ? 'p' : 'd'; o.cards[seat + e.dataset.k] = [+(b.left).toFixed(1), +(b.top + scrollY).toFixed(1), e.classList.contains('pending') ? 1 : e.classList.contains('landed') ? 2 : 0]; });      // 2: it is settling (a 200ms scale), which is not a layout move
      window.__S.push(o);
      if(window.__go) requestAnimationFrame(snap);
    }
    requestAnimationFrame(snap);
  });
}
const stopSampler = page => page.evaluate(() => { window.__go = false; return window.__S; });
function rangeOf(samples, from, to, get){
  let lo = Infinity, hi = -Infinity;
  samples.forEach(s => { if(s.ph >= 0 && from(s) && !to(s)){ const v = get(s); if(v != null){ lo = Math.min(lo, v); hi = Math.max(hi, v); } } });
  return [lo, hi];
}

(async () => {
  const browser = await chromium.launch();

  // ---------------------------------------------------------------- stability while the cards come in (desktop and phone)
  for(const dev of [{ n: 'desktop', vp: { width: 1280, height: 900 } }, { n: 'phone 390x664', vp: { width: 390, height: 664 }, touch: true, mobile: true }, { n: 'phone 360x640', vp: { width: 360, height: 640 }, touch: true, mobile: true }].filter(d => !FAST || /360/.test(d.n))){
    section('nothing moves while the cards come in: ' + dev.n);
    const { page, errs, ctx } = await open(browser, dev);
    await startHand(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await installSampler(page);
    await tap(page, '#btn-deal', dev.touch);
    ok(await untilPhase(page, 'arranging'), 'reaches arranging');
    await page.waitForTimeout(400);
    const S = await stopSampler(page);
    const dealing = S.filter(s => s.ph === 'dealing' || s.ph === 'dealer-revealing');
    ok(dealing.length > 30, 'sampled the deal (' + dealing.length + ' frames)');
    // from the first frame of the deal to the arranging step: the seats, the band and the status line stay put
    const firstDeal = S.findIndex(s => s.ph === 'dealing' || s.ph === 'dealer-revealing');
    const after = S.slice(firstDeal);
    ['seat-dealer', 'seat-you', 'dealer-band', 'status-line'].forEach(id => {
      const tops = after.map(s => s.el[id][0]), hs = after.map(s => s.el[id][1]);
      const dt = Math.max(...tops) - Math.min(...tops), dh = Math.max(...hs) - Math.min(...hs);
      ok(dt < 0.6, id + ' does not move up or down during the deal (moved ' + dt.toFixed(1) + 'px)');
      ok(dh < 0.6 || id === 'status-line' && dh < 40, id + ' keeps its height (changed ' + dh.toFixed(1) + 'px)');
    });
    // each card, once it has landed, stays exactly where it is until his flip is done: the window up to 'dealer-revealing' ends
    const landed = {};
    let moved = 0, worst = 0;
    S.forEach((s, i) => {
      if(s.ph !== 'dealing') return;
      Object.keys(s.cards).forEach(k => {
        const cc = s.cards[k];
        if(cc[2] === 0){ if(landed[k]){ const d = Math.abs(cc[0] - landed[k][0]) + Math.abs(cc[1] - landed[k][1]); if(d > 0.6){ moved++; worst = Math.max(worst, d); } } else landed[k] = cc; }
      });
    });
    ok(moved === 0, 'a card that has landed never shifts while the rest are dealt (' + moved + ' frames, worst ' + worst.toFixed(1) + 'px)');
    // and the document does not grow sideways
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- stability while you pick and while he compares
  section('nothing above the controls moves while you pick, confirm and see the result');
  if(!FAST){
    const { page, errs, ctx } = await open(browser, {});
    await startHand(page); await tap(page, '#btn-deal');
    await untilPhase(page, 'arranging');
    await page.waitForTimeout(300);
    await installSampler(page);
    await page.click('#player-high-cards .pc:nth-child(7)'); await page.waitForTimeout(450);
    await page.click('#player-high-cards .pc:nth-child(6)'); await page.waitForTimeout(450);
    await page.click('#btn-confirm');
    ok(await untilPhase(page, 'resolved'), 'resolved');
    await page.waitForTimeout(700);
    const S = await stopSampler(page);
    ['seat-dealer', 'seat-you', 'dealer-band', 'status-line'].forEach(id => {
      const tops = S.map(s => s.el[id][0]), hs = S.map(s => s.el[id][1]);
      ok(Math.max(...tops) - Math.min(...tops) < 0.6, id + ' does not move while picking and comparing');
      ok(Math.max(...hs) - Math.min(...hs) < 0.6, id + ' keeps its height while picking and comparing');
    });
    ok(errs.length === 0, 'no page errors');
    await ctx.close();
  }

  // ---------------------------------------------------------------- the flights land on the cards
  section('a flying card ends exactly where the card is');
  if(!FAST){
    const { page, ctx } = await open(browser, {});
    await startHand(page); await page.evaluate(() => { Show._S.forceGag = -1; });
    await page.evaluate(() => { window.__fl = []; window.__air = 0; const L = document.getElementById('show-layer'); new MutationObserver(l => l.forEach(m => m.addedNodes.forEach(n => { if(n.classList && n.classList.contains('fc')) window.__fl.push(n); }))).observe(L, { childList: true }); window.__iv = setInterval(() => { window.__air = Math.max(window.__air, document.querySelectorAll('.fc').length); }, 25); });
    await tap(page, '#btn-deal');
    await page.waitForTimeout(2300);
    const info = await page.evaluate(() => {
      const els = [...document.querySelectorAll('#rows .pc')];
      const landed = els.filter(e => !e.classList.contains('pending')).length;
      const fc = [...document.querySelectorAll('.fc')].length;
      return { landed, fc, total: els.length };
    });
    ok(info.landed >= 7 && info.landed < 14, 'your seven are down and his are still coming (' + info.landed + ' of 14 after 2.3s)');
    ok(await untilPhase(page, 'arranging'), 'finishes');
    const air = await page.evaluate(() => { clearInterval(window.__iv); return window.__air; });
    ok(air >= 3 && air <= 8, 'a spread has several cards in the air at once, but never more than a row (' + air + ')');
    ok(await page.evaluate(() => document.querySelectorAll('.fc').length === 0 && document.querySelectorAll('.pc.pending').length === 0), 'nothing left in the air or pending');
    await ctx.close();
  }

  // ---------------------------------------------------------------- phone layout
  for(const vp of [{ w: 390, h: 664 }, { w: 375, h: 667 }, { w: 360, h: 640 }, { w: 375, h: 553 }, { w: 412, h: 760 }, { w: 320, h: 568 }].filter(v => !FAST || (v.w === 390 || v.w === 360))){
    section('phone ' + vp.w + 'x' + vp.h + ': everything fits and can be tapped');
    const { page, errs, ctx } = await open(browser, { vp: { width: vp.w, height: vp.h }, touch: true, mobile: true });
    const q = s => page.evaluate(s);
    ok(await q(() => getComputedStyle(document.getElementById('m-menu-btn')).display !== 'none'), 'the menu button is there');
    ok(await q(() => !document.getElementById('btn-toggle-settings').offsetParent), 'the settings button has moved into the menu (hidden until it opens)');
    ok(await q(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll while betting');
    // betting: the spot, the chips and Deal are all on screen without scrolling
    const bet = await q(() => { const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return [b.top, b.bottom, b.left, b.right]; }; return { spot: r('spot-ante'), chips: r('chip-row'), deal: r('btn-deal'), h: innerHeight }; });
    ok(bet.spot[0] > 40 && bet.spot[1] < bet.h, 'betting: the Ante spot is on screen');
    ok(bet.chips[1] <= bet.deal[0] + 1, 'betting: the chip rack is not hidden behind the Deal button (' + Math.round(bet.chips[1]) + ' vs ' + Math.round(bet.deal[0]) + ')');
    ok(bet.deal[1] <= bet.h + 1, 'betting: Deal is on screen');
    // tap targets while betting
    const small = await q(() => [...document.querySelectorAll('#chip-row button, #spot-ante, #btn-deal, #m-menu-btn, #btn-rebet, #m-undo')].filter(e => e.offsetParent && !e.hidden).map(e => { const b = e.getBoundingClientRect(); return { id: e.id || e.className, w: Math.round(b.width), h: Math.round(b.height) }; }).filter(x => x.w < 38 || x.h < 38));
    ok(small.length === 0, 'betting: every control is at least 38px each way: ' + JSON.stringify(small));
    // place a bet by tapping, and take a chip back with Undo
    await page.tap('#chip-50'); await page.tap('#spot-ante'); await page.tap('#spot-ante');
    ok(await q(() => G.bets.ante === 100), 'two taps put $100 down');
    await page.tap('#m-undo');
    ok(await q(() => G.bets.ante === 50), 'Undo takes the last chip back');
    await page.tap('#spot-ante');
    await rig(page, SPLIT.p, SPLIT.d);
    await page.tap('#btn-deal');
    ok(await untilPhase(page, 'arranging'), 'dealt');
    await page.waitForTimeout(500);
    const arr = await q(() => {
      const r = e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      const cards = [...document.querySelectorAll('#player-high-cards .pc')].map(e => ({ r: r(e), hit: (b => { const x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2; const t = document.elementFromPoint(x, y); return t && t.closest('.pc') === e; })(r(e)) }));
      const dealer = [...document.querySelectorAll('#dealer-cards .pc')].map(e => r(e));
      const dock = document.querySelector('.deal-row').getBoundingClientRect();
      const st = document.getElementById('status-line').getBoundingClientRect();
      const lowSlots = [...document.querySelectorAll('#player-low-cards .slot')].map(e => r(e));
      return { cards, dealer, dockTop: dock.top, dockBottom: dock.bottom, statusBottom: st.bottom, statusTop: st.top, h: innerHeight, w: innerWidth, lowSlots, sw: document.documentElement.scrollWidth };
    });
    ok(arr.cards.length === 7 && arr.cards.every(c => c.hit), 'arranging: all seven of your cards can be tapped in the middle (nothing is on top of them)');
    const cw = arr.cards[0].r[2] - arr.cards[0].r[0], ch = arr.cards[0].r[3] - arr.cards[0].r[1];
    ok(vp.w < 340 ? cw >= 36 : cw >= 43, 'arranging: your cards are wide enough to tap (' + cw.toFixed(1) + 'px)');
    ok(ch >= 52, 'arranging: and tall enough (' + ch.toFixed(1) + 'px)');
    ok(arr.cards.every((c, i) => i === 0 || c.r[0] >= arr.cards[i - 1].r[2] - 0.5), 'arranging: your cards do not overlap each other');
    ok(arr.cards[0].r[0] >= 0 && arr.cards[6].r[2] <= arr.w, 'arranging: your row is inside the screen');
    ok(arr.dealer.every(r => r[0] >= 0 && r[2] <= arr.w), 'arranging: his row is inside the screen');
    ok(arr.dockBottom <= arr.h + 1, 'arranging: the buttons are pinned on screen (' + Math.round(arr.dockBottom) + ' of ' + arr.h + ')');
    ok(arr.sw <= arr.w + 1, 'arranging: no sideways scroll');
    // the whole table fits above the pinned buttons on a normal phone
    if(vp.h >= 640) ok(arr.statusBottom <= arr.dockTop + 8, 'arranging: the status line is not under the buttons (' + Math.round(arr.statusBottom) + ' vs ' + Math.round(arr.dockTop) + ')');
    // the buttons stay pinned while the page scrolls; the title is never squeezed; the dealer's head is not under the top bar
    await q(() => window.scrollTo(0, 260)); await page.waitForTimeout(120);
    const pin = await q(() => { const d = document.querySelector('.deal-row').getBoundingClientRect(); return { top: d.top, bottom: d.bottom, h: innerHeight, sy: scrollY }; });
    if(pin.sy > 20) ok(pin.bottom <= pin.h + 1 && pin.top > 60, 'the buttons stay pinned to the bottom while you scroll (' + Math.round(pin.top) + '-' + Math.round(pin.bottom) + ' of ' + pin.h + ')');
    await q(() => window.scrollTo(0, 0)); await page.waitForTimeout(80);
    ok(await q(() => { const h = document.querySelector('.topbar h1'); return h.scrollWidth <= h.clientWidth + 1; }), 'the title is not squeezed by the bankroll');
    ok(await q(() => { const hd = document.querySelector('.ds-head').getBoundingClientRect(), tb = document.getElementById('topbar').getBoundingClientRect(); return hd.top >= tb.bottom + 1; }), 'the dealer\'s head is clear of the top bar');
    // pick two by tapping, see them move to the Low Hand
    await page.tap('#player-high-cards .pc:nth-child(7)'); await page.waitForTimeout(450);
    await page.tap('#player-high-cards .pc:nth-child(6)'); await page.waitForTimeout(500);
    ok(await q(() => document.querySelectorAll('#player-low-cards .pc').length === 2 && document.querySelectorAll('#player-high-cards .pc').length === 5), 'two taps move two cards to the Low Hand');
    const btns = await q(() => [...document.querySelectorAll('#action-row button')].filter(b => !b.hidden).map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent, h: Math.round(r.height), w: Math.round(r.width), vis: r.bottom <= innerHeight + 1 }; }));
    ok(btns.length === 2 && btns.every(b => b.h >= 44 && b.w >= 100 && b.vis), 'the two buttons are big and on screen: ' + JSON.stringify(btns));
    await page.tap('#btn-confirm');
    ok(await untilPhase(page, 'resolved'), 'resolved');
    await page.waitForTimeout(600);
    ok(await q(() => { const b = document.getElementById('btn-again').getBoundingClientRect(); return b.height >= 44 && b.bottom <= innerHeight + 1; }), 'Deal Again is big and on screen');
    await page.tap('#btn-again');
    ok(await untilPhase(page, 'betting', 5000), 'back to betting');
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
    ok(await q(() => [...document.querySelectorAll('#m-menu > *')].filter(e => e.offsetParent).length >= 3), 'it lists settings, table manners and the glossary');
    ok(await q(() => /No commission/.test(document.querySelector('.m-rules').textContent)), 'and says how the table is set');
    await page.keyboard.press('Escape');
    ok(await q(() => !document.getElementById('topbar').classList.contains('m-open') && document.activeElement.id === 'm-menu-btn'), 'Escape closes it and focus goes back to the button');
    await page.tap('#m-menu-btn'); await page.tap('#btn-toggle-settings');
    await page.waitForTimeout(100);
    ok(await q(() => document.body.classList.contains('m-sheet')), 'Settings opens as a sheet');
    const sheet = await q(() => { const p = document.getElementById('settings-panel'); return { role: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), inside: p.contains(document.activeElement), appInert: document.querySelector('.topbar').hasAttribute('inert'), tablesInert: document.getElementById('table').hasAttribute('inert'), h: p.getBoundingClientRect().height, vh: innerHeight }; });
    ok(sheet.role === 'dialog' && sheet.modal === 'true', 'it is a modal dialog for assistive tech');
    ok(sheet.inside, 'focus moved into it');
    ok(sheet.tablesInert, 'the table behind it is inert');
    ok(sheet.h > sheet.vh * 0.6, 'it takes most of the screen');
    // Tab stays inside
    let leaked = 0;
    for(let i = 0; i < 25; i++){ await page.keyboard.press('Tab'); if(!await q(() => document.getElementById('settings-panel').contains(document.activeElement))) leaked++; }
    ok(leaked === 0, 'Tab never leaves the sheet (' + leaked + ' escapes in 25 presses)');
    // tap targets in the sheet
    const small = await q(() => [...document.querySelectorAll('#settings-panel button, #settings-panel select, #settings-panel input')].filter(e => e.offsetParent).map(e => { const b = e.getBoundingClientRect(); const lab = e.type === 'checkbox' ? e.closest('.check-row').getBoundingClientRect() : b; return { id: e.id, h: Math.round(lab.height) }; }).filter(x => x.h < 40));
    ok(small.length === 0, 'every control in the sheet is at least 40px tall: ' + JSON.stringify(small));
    // change a setting inside it
    await page.tap('#set-turbo'); ok(await q(() => G.turbo === true), 'a switch in the sheet works');
    await page.tap('#set-turbo');
    await page.tap('#m-sheet-done');
    ok(await q(() => !document.body.classList.contains('m-sheet') && document.getElementById('settings-panel').style.display === 'none'), 'Done closes it');
    ok(await q(() => document.activeElement.id === 'm-menu-btn' || document.activeElement === document.body), 'focus goes back to the menu button');
    ok(await q(() => !document.getElementById('table').hasAttribute('inert') && !document.getElementById('app').hasAttribute('aria-hidden')), 'the table is live again');
    // Escape, and a tap on the dimmed table
    await page.tap('#m-menu-btn'); await page.tap('#btn-toggle-settings'); await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    ok(await q(() => !document.body.classList.contains('m-sheet') && !document.getElementById('table').hasAttribute('inert')), 'Escape closes the sheet');
    await page.tap('#m-menu-btn'); await page.tap('#btn-toggle-settings'); await page.waitForTimeout(100);
    await page.touchscreen.tap(195, 20);
    await page.waitForTimeout(100);
    ok(await q(() => !document.body.classList.contains('m-sheet')), 'a tap on the dimmed table closes it');
    // table manners dialog
    await page.tap('#m-menu-btn'); await page.tap('#btn-manners'); await page.waitForTimeout(100);
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
    ok(await q(() => !document.getElementById('m-undo')), 'no Undo button');
    ok(await q(() => document.querySelectorAll('#seat-dealer, #seat-you').length === 2 && getComputedStyle(document.getElementById('seat-you')).display !== 'none'), 'both seats are shown while betting');
    await startHand(page); await tap(page, '#btn-deal');
    await untilPhase(page, 'arranging'); await page.waitForTimeout(300);
    const row = await q(() => { const hi = document.getElementById('player-high').getBoundingClientRect(), lo = document.getElementById('player-low').getBoundingClientRect(); return { sameRow: Math.abs(hi.top - lo.top) < 2, cw: document.querySelector('#player-high-cards .pc').getBoundingClientRect().width }; });
    ok(row.sameRow, 'High and Low sit side by side');
    ok(row.cw >= 80, 'cards are big (' + Math.round(row.cw) + 'px)');
    ok(await q(() => getComputedStyle(document.querySelector('.deal-row')).position !== 'sticky'), 'the buttons are not pinned');
    ok(errs.length === 0, 'no page errors');
    await ctx.close();
  }

  // ---------------------------------------------------------------- keyboard, announcements and names
  section('keyboard and screen readers');
  if(!FAST){
    const { page, errs, ctx } = await open(browser, {});
    const q = s => page.evaluate(s);
    ok(await q(() => !!document.querySelector('a.skip-link[href="#table"]') && !!document.querySelector('main#table')), 'skip link and <main>');
    ok(await q(() => { const l = document.getElementById('sr-live'); return l.getAttribute('role') === 'status' && l.getAttribute('aria-live') === 'polite'; }), 'one polite live region');
    await startHand(page);
    await page.keyboard.press('Space');                 // deal by key
    ok(await untilPhase(page, 'arranging'), 'Space deals');
    await page.waitForTimeout(300);
    ok(await q(() => /Your seven cards/.test(document.getElementById('sr-live').textContent)), 'the live region says what you were dealt');
    const names = await q(() => [...document.querySelectorAll('#player-high-cards .pc')].map(e => e.getAttribute('aria-label')));
    ok(names.length === 7 && names.every(n => n && /of (spades|hearts|diamonds|clubs)/.test(n)), 'each of your cards has a name: ' + JSON.stringify(names.slice(0, 2)));
    ok(await q(() => [...document.querySelectorAll('#dealer-cards .pc')].every(e => e.getAttribute('aria-hidden') === 'true')), 'his cards are not read twice (the summary is)');
    // keyboard picking: focus a card and press Enter
    await q(() => document.querySelector('#player-high-cards .pc:nth-child(7)').focus());
    await page.keyboard.press('Enter'); await page.waitForTimeout(450);
    ok(await q(() => G.pickedLow.length === 1), 'Enter on a card moves it to Low');
    ok(await q(() => document.activeElement.classList.contains('pc')), 'focus stays on a card after it moves');
    ok(await q(() => /Moved .* to your Low Hand/.test(document.getElementById('sr-live').textContent)), 'and the move is announced');
    await page.keyboard.press('h'); await page.waitForTimeout(500);
    ok(await q(() => G.pickedLow.length === 2), 'H sets the house way');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- a dealer-off, a turbo and a reduced-motion hand in a real browser
  for(const m of [{ n: 'dealer off', settings: { 'set-dealer': false } }, { n: 'turbo', settings: { 'set-turbo': true } }, { n: 'reduced motion', reduced: true }].filter(() => !FAST)){
    section('a whole hand with ' + m.n);
    const { page, errs, ctx } = await open(browser, m);
    await startHand(page); await tap(page, '#btn-deal');
    ok(await untilPhase(page, 'arranging', 12000), 'deals');
    ok(await page.evaluate(() => document.querySelectorAll('.fc').length === 0 && document.querySelectorAll('.pc.pending').length === 0), 'nothing flying, nothing pending');
    ok(await page.evaluate(() => [...document.querySelectorAll('#rows .pc')].every(e => e.classList.contains('up'))), 'all 14 cards are face up');
    await page.click('#btn-autoset'); await page.click('#btn-confirm');
    ok(await untilPhase(page, 'resolved', 12000), 'resolves');
    ok(await page.evaluate(() => document.getElementById('outcome-badge').textContent.length > 0), 'shows the result');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- hand after hand: nothing left over, nothing pushed
  for(const dev of [{ n: 'desktop', vp: { width: 1280, height: 900 } }, { n: 'phone 390x664', vp: { width: 390, height: 664 }, touch: true, mobile: true }].filter(() => !FAST)){
    section('hand after hand leaves no ghost cards behind and moves nothing: ' + dev.n);
    const { page, errs, ctx } = await open(browser, dev);
    const geo = () => page.evaluate(() => { const r = id => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.height), Math.round(b.width), Math.round(b.top + scrollY)]; }; return { rows: document.querySelectorAll('#rows .pc').length, pLow: document.querySelectorAll('#player-low-cards .pc').length, dLow: document.querySelectorAll('#dealer-low-cards .pc').length, pHigh: document.querySelectorAll('#player-high-cards .pc').length, you: r('seat-you'), dealer: r('seat-dealer'), felt: r('felt'), bets: r('bet-row'), label: document.getElementById('player-high-k').textContent }; });
    const seen = [];
    for(let h = 0; h < 3; h++){
      await rig(page, SPLIT.p, SPLIT.d);
      await page.evaluate(() => { selectChip(25); placeBet('ante'); });
      await tap(page, '#btn-deal', dev.touch);
      ok(await untilPhase(page, 'arranging'), 'hand ' + (h + 1) + ' deals');
      await page.waitForTimeout(450);
      const g = await geo(); seen.push(g);
      ok(g.rows === 14 && g.dLow === 2 && g.pLow === 0 && g.pHigh === 7, 'hand ' + (h + 1) + ': 14 cards, his Low two, your seven (' + JSON.stringify([g.rows, g.dLow, g.pLow, g.pHigh]) + ')');
      await tap(page, '#btn-autoset', dev.touch); await tap(page, '#btn-confirm', dev.touch);
      ok(await untilPhase(page, 'resolved'), 'hand ' + (h + 1) + ' resolves');
      await page.waitForTimeout(500);
      await tap(page, '#btn-again', dev.touch);
      await page.waitForTimeout(500);
      const e = await geo();
      ok(e.rows === 0, 'hand ' + (h + 1) + ': Play Again clears every card off the felt (' + e.rows + ' left)');
    }
    const same = (a, b) => a.every((v, i) => v === b[i]);
    ok(seen.every(g => same(g.you, seen[0].you) && same(g.dealer, seen[0].dealer) && same(g.felt, seen[0].felt) && same(g.bets, seen[0].bets)), 'every hand has exactly the same layout (the table does not grow or shift): ' + JSON.stringify(seen.map(g => [g.you, g.dealer, g.felt])));
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ---------------------------------------------------------------- your cards as dealt, and the label
  for(const dev of [{ n: 'desktop', vp: { width: 1280, height: 900 } }, { n: 'phone 390x664', vp: { width: 390, height: 664 }, touch: true, mobile: true }].filter(d => !FAST || /phone/.test(d.n))){
    section('your cards are dealt unsorted and labelled "Your cards": ' + dev.n);
    const { page, ctx } = await open(browser, dev);
    await startHand(page, { p: ['5c','Jd','As','8h','Kc','7s','3d'], d: SPLIT.d });
    await tap(page, '#btn-deal', dev.touch);
    ok(await untilPhase(page, 'arranging'), 'deals');
    await page.waitForTimeout(450);
    const order = await page.evaluate(() => { const els = G.playerCards.map(c => playerEl(c)); const lefts = els.map(e => e.getBoundingClientRect().left), tops = els.map(e => Math.round(e.getBoundingClientRect().top)); return { inRow: tops.every(t => t === tops[0]), increasing: lefts.every((l, i) => i === 0 || l > lefts[i - 1]), keys: els.map(e => e.dataset.k).join(' ') }; });
    ok(order.inRow && order.increasing, 'on screen, left to right, they are in the order they were dealt (' + order.keys + ')');
    ok(await page.evaluate(() => document.getElementById('player-high-k').textContent === 'Your cards · 7'), 'the label says "Your cards · 7"');
    const lab = await page.evaluate(() => { const k = document.getElementById('player-high-k'), b = k.getBoundingClientRect(), g = document.querySelector('#player-high .grp-label').getBoundingClientRect(); return { fits: k.scrollWidth <= k.clientWidth + 1 && b.right <= g.right + 1, h: Math.round(g.height) }; });
    ok(lab.fits, 'and it fits on one line');
    await tap(page, '#player-high-cards .pc:nth-child(5)', dev.touch); await page.waitForTimeout(450);
    ok(await page.evaluate(() => document.getElementById('player-high-k').textContent === 'Your cards · 6'), 'one picked: "Your cards · 6"');
    await tap(page, '#player-high-cards .pc:nth-child(4)', dev.touch); await page.waitForTimeout(450);
    ok(await page.evaluate(() => document.getElementById('player-high-k').textContent === 'High hand · 5'), 'two picked: "High hand · 5"');
    const lab2 = await page.evaluate(() => document.querySelector('#player-high .grp-label').getBoundingClientRect().height);
    ok(Math.abs(lab2 - lab.h) <= 1, 'the label never changes height (' + lab.h + ' -> ' + lab2 + ')');
    await ctx.close();
  }

  // ---------------------------------------------------------------- the cards land in turn even when one slips (real durations)
  section('with real timing the cards ripple down your row, then his, even when one slips');
  if(!FAST){
    for(const gag of [3, 6, 10, -1]){
      const { page, errs, ctx } = await open(browser, {});
      await startHand(page); await page.evaluate(g => { Show._S.forceGag = g; }, gag);
      await page.evaluate(() => { window.__land = []; window.__fly = []; window.__moods = []; new MutationObserver(() => { window.__moods.push(document.getElementById('dealer-stage').getAttribute('data-mood')); }).observe(document.getElementById('dealer-stage'), { attributes: true, attributeFilter: ['data-mood'] }); new MutationObserver(l => l.forEach(m => m.addedNodes.forEach(n => { if(n.classList && n.classList.contains('fc')) window.__fly.push(Math.round(performance.now())); }))).observe(document.getElementById('show-layer'), { childList: true }); new MutationObserver(l => l.forEach(m => { if(m.attributeName === 'class' && /pending/.test(m.oldValue || '') && !m.target.classList.contains('pending')) window.__land.push((m.target.closest('#seat-you') ? 'P' : 'D') + ':' + Math.round(performance.now()) + ':' + [...m.target.parentNode.children].indexOf(m.target)); })).observe(document.getElementById('rows'), { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] }); });
      const t0 = await page.evaluate(() => performance.now());
      await tap(page, '#btn-deal');
      ok(await untilPhase(page, 'arranging'), 'deals (slip at ' + gag + ')');
      const land = await page.evaluate(() => window.__land);
      ok(land.length === 14 && land.map(x => x[0]).join('') === 'PPPPPPPDDDDDDD', 'all of yours, then all of his (slip at ' + gag + '): ' + land.map(x => x[0]).join(''));
      const times = land.map(x => +x.split(':')[1]), idx = land.map(x => +x.split(':')[2]); let gapOk = true; for(let i = 1; i < times.length; i++) if(times[i] < times[i - 1]) gapOk = false;
      ok(gapOk, 'and each lands after the one before it');
      const fly = await page.evaluate(() => window.__fly);
      if(gag === 3){
        const mo = await page.evaluate(() => window.__moods), k = mo.indexOf('surp');
        ok(k >= 0 && mo[k + 1] === 'sm1' && mo.slice(k + 2).indexOf('sm2') >= 0, 'the surprise passes by itself, then he carries on: ' + mo.join(','));
      }
      ok(fly.length === 14 && fly[7] >= times[6], 'his first card leaves only once all of yours are down (' + fly[7] + ' vs ' + times[6] + ')');
      for(const [lo, name] of [[0, 'yours'], [7, 'his']]){
        const row = idx.slice(lo, lo + 7), slipped = gag >= lo && gag < lo + 7 ? gag - lo : -1;
        const want = slipped < 0 ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4, 5, 6].filter(i => i !== slipped).concat([slipped]);
        ok(row.join() === want.join(), name + ': they ripple left to right' + (slipped < 0 ? '' : ', the one that slipped coming in last') + ' (' + row.join('') + ')');
      }
      if(gag < 0){
        const gaps = []; for(let i = 1; i < 7; i++){ gaps.push(times[i] - times[i - 1], times[i + 7] - times[i + 6]); }
        gaps.sort((a, b) => a - b); const med = gaps[Math.floor(gaps.length / 2)];
        ok(med >= 30 && med <= 100, 'a card lands about every 55ms along a row (median ' + med + 'ms)');
        ok(times[13] - t0 < 3700, 'and the whole deal takes under 3.7s (' + Math.round(times[13] - t0) + 'ms to the last card)');
      }
      ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
      await ctx.close();
    }
  }

  // ---------------------------------------------------------------- dragging, with a mouse and with a finger
  {
    section('dragging a card to the Low Hand with the mouse');
    const { page, errs, ctx } = await open(browser, {});
    await startHand(page, { p: ['5c','Jd','As','8h','Kc','7s','3d'], d: SPLIT.d });
    await tap(page, '#btn-deal');
    ok(await untilPhase(page, 'arranging'), 'deals'); await page.waitForTimeout(450);
    const bx = sel => page.locator(sel).boundingBox();
    const c1 = await bx('#player-high-cards .pc:nth-child(5)'), low = await bx('#player-low');
    await page.mouse.move(c1.x + c1.width / 2, c1.y + c1.height / 2); await page.mouse.down();
    await page.mouse.move(c1.x + c1.width / 2 + 12, c1.y + c1.height / 2 + 16, { steps: 3 });
    await page.mouse.move(low.x + low.width / 2, low.y + low.height / 2, { steps: 8 });
    const mid = await page.evaluate(() => { const g = document.querySelector('.pc-ghost'); if(!g) return null; const b = g.getBoundingClientRect(), s = getComputedStyle(g); return { op: s.opacity, w: Math.round(b.width), pos: s.position, hot: document.getElementById('player-low').classList.contains('drop-hot'), src: document.querySelector('.drag-src') && +getComputedStyle(document.querySelector('.drag-src')).opacity, front: getComputedStyle(g.querySelector('.pc-front')).opacity }; });
    ok(!!mid, 'a ghost card is under the pointer');
    ok(mid && mid.op === '1' && mid.front === '1', 'and it is solid, not faded (opacity ' + (mid && mid.op) + ')');
    ok(mid && mid.pos === 'fixed' && mid.w >= Math.round(c1.width), 'it is as big as the card it came from (' + (mid && mid.w) + ' vs ' + Math.round(c1.width) + ')');
    ok(mid && mid.hot && mid.src < 0.5, 'the Low Hand glows and the card it came from is dimmed');
    await trackStart(page, '#player-high-cards .pc:nth-child(5)');
    await page.mouse.up(); await page.waitForTimeout(450);
    const gap1 = await dropGap(page);
    ok(gap1 != null && gap1 <= 30, 'on the drop the card takes over right where the ghost was (' + gap1 + 'px away), and settles into the Low Hand from there');
    ok(await page.evaluate(() => G.pickedLow.length === 1 && G.pickedLow[0].rank === 'K' && !document.querySelector('.pc-ghost') && !document.querySelector('.drag-src') && !document.body.classList.contains('dragging-card')), 'dropped: the King is in the Low Hand and everything is tidy');
    ok(await page.evaluate(() => document.getElementById('player-high-k').textContent === 'Your cards · 6'), 'the label follows');
    // a bad drop floats back
    const c2 = await bx('#player-high-cards .pc:nth-child(2)');
    await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2); await page.mouse.down();
    await page.mouse.move(60, 60, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => G.pickedLow.length === 1 && !document.querySelector('.pc-ghost') && !document.querySelector('.drag-src')), 'dropped on nothing: it floats back, nothing changes');
    // taking a card out of the Low Hand
    const lc = await bx('#player-low-cards .pc:nth-child(1)'), hi = await bx('#player-high');
    await page.mouse.move(lc.x + lc.width / 2, lc.y + lc.height / 2); await page.mouse.down();
    await page.mouse.move(hi.x + hi.width / 2, hi.y + hi.height / 2, { steps: 10 });
    await trackStart(page, '#player-low-cards .pc:nth-child(1)');
    await page.mouse.up(); await page.waitForTimeout(450);
    const gap2 = await dropGap(page);
    ok(gap2 != null && gap2 <= 30, 'and the same coming back out of the Low Hand (' + gap2 + 'px away)');
    ok(await page.evaluate(() => G.pickedLow.length === 0 && document.getElementById('player-high-k').textContent === 'Your cards · 7'), 'dragged out of the Low Hand and back among your cards');
    // a plain click still picks
    await page.click('#player-high-cards .pc:nth-child(3)'); await page.waitForTimeout(450);
    ok(await page.evaluate(() => G.pickedLow.length === 1), 'a click still picks a card');
    // the keyboard is unchanged, and Escape drops a card
    const c3 = await bx('#player-high-cards .pc:nth-child(1)');
    await page.mouse.move(c3.x + c3.width / 2, c3.y + c3.height / 2); await page.mouse.down(); await page.mouse.move(low.x + 40, low.y + 40, { steps: 6 });
    await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(500);
    ok(await page.evaluate(() => G.pickedLow.length === 1 && !document.querySelector('.pc-ghost')), 'Escape during a drag drops the card where it was');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('#player-high-cards .pc')).touchAction === 'none'), 'cards do not scroll the page when a finger starts on them');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }
  for(const vp of [{ w: 390, h: 664 }, { w: 360, h: 640 }]){
    section('dragging a card with a finger on a phone: ' + vp.w + 'x' + vp.h);
    const { page, errs, ctx } = await open(browser, { vp: { width: vp.w, height: vp.h }, touch: true, mobile: true });
    await startHand(page, { p: ['5c','Jd','As','8h','Kc','7s','3d'], d: SPLIT.d });
    await tap(page, '#btn-deal', true);
    ok(await untilPhase(page, 'arranging'), 'deals'); await page.waitForTimeout(700);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const bx = sel => page.locator(sel).boundingBox();
    const drag = async (from, to, then) => {
      const a = await bx(from), t = await bx(to), ax = a.x + a.width / 2, ay = a.y + a.height / 2, tx = t.x + t.width / 2, ty = t.y + t.height / 2;
      await touch('touchStart', ax, ay);
      for(let i = 1; i <= 10; i++){ await touch('touchMove', ax + (tx - ax) * i / 10, ay + (ty - ay) * i / 10); await page.waitForTimeout(16); }
      const mid = await page.evaluate(() => ({ ghost: !!document.querySelector('.pc-ghost'), scroll: scrollY }));
      await trackStart(page, from);
      await touch('touchEnd'); await page.waitForTimeout(500);
      mid.gap = await dropGap(page);
      return mid;
    };
    const sy = await page.evaluate(() => scrollY);
    let m = await drag('#player-high-cards .pc:nth-child(5)', '#player-low');
    ok(m.ghost && m.scroll === sy, 'the card follows the finger and the page does not scroll');
    ok(m.gap != null && m.gap <= 30, 'on the drop the card takes over where your finger left it (' + m.gap + 'px away)');
    ok(await page.evaluate(() => G.pickedLow.length === 1 && G.pickedLow[0].rank === 'K'), 'dropped on the Low Hand: the King is in it');
    m = await drag('#player-high-cards .pc:nth-child(4)', '#player-low');
    ok(await page.evaluate(() => G.pickedLow.length === 2 && document.getElementById('player-high-k').textContent === 'High hand · 5'), 'the second one makes five and two');
    ok(m.gap != null && m.gap <= 30, 'and it too lands from where the finger left it (' + m.gap + 'px away)');
    m = await drag('#player-low-cards .pc:nth-child(1)', '#player-high-cards');
    ok(await page.evaluate(() => G.pickedLow.length === 1), 'a card dragged back down to your cards leaves the Low Hand');
    ok(await page.evaluate(([y]) => scrollY === y && !document.querySelector('.pc-ghost'), [sy]), 'still no scrolling, no ghost left over');
    ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (fails ? 'FAILED: ' + fails + ' check(s)' : 'all ' + passes + ' browser checks passed'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e && e.stack || e); process.exit(2); });
