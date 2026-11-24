// Tip the dealer, in a real browser (Playwright), across the four games that have a dealer.
// Run from the site folder:  node test_tip.js [game]
const { chromium } = require('playwright');
const path = require('path');
const GAMES = ['blackjack', 'baccarat', 'pai-gow', 'ultimate-texas-holdem'];
let oks = 0, failures = 0;
function ok(cond, desc, extra){ if(cond){ oks++; console.log('OK:', desc); } else { failures++; console.log('FAIL:', desc, extra === undefined ? '' : '| ' + JSON.stringify(extra)); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(browser, game){
  console.log('\n== ' + game);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try{ localStorage.setItem('house_edge_experience_v1', JSON.stringify({ level: 'pro', updated: Date.now() })); localStorage.setItem('soft17_sound', 'off'); }catch(e){} });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  const url = 'file://' + path.join(__dirname, game, 'index.html');
  const click = async s => { try{ await p.click(s, { timeout: 900 }); return true; }catch(e){ return false; } };
  const ready = async (t) => { const t0 = Date.now(); while(Date.now() - t0 < (t || 20000)){ if(await p.evaluate(() => TRDealer.canTip())) return true; await sleep(250); } return false; };
  const info = () => p.evaluate(() => {
    const st = document.getElementById('dealer-stage'), b = document.getElementById('btn-tip-dealer');
    return { bank: G.bankroll, tot: TRTip.total(), lvl: TRTip.level(), fan: st && st.getAttribute('data-fan'), state: st && st.getAttribute('data-state'), busy: !!TRDealer.current(), off: !!(b && b.classList.contains('off')), chip: !!document.querySelector('.ds-tipchip') };
  });
  async function open(){
    await p.goto(url, { waitUntil: 'load' }); await sleep(1200);
    await click('#btn-tablesetup-continue'); await sleep(250); await click('#cutcard-preset-75'); await sleep(250);
  }
  await open();

  ok(await p.evaluate(() => !!document.getElementById('btn-tip-dealer')), 'the Tip button is on the dealer\'s counter');
  ok(await ready(), 'between hands, tipping becomes available');
  let i0 = await info();
  ok(i0.tot === 0 && i0.lvl === 0 && i0.fan === '0', 'a fresh session has an empty tip jar', i0);
  ok(await p.evaluate(() => TRTip.react('win', false) === null && TRTip.react('lose', false) === null), 'an untipped dealer reacts as he always did (nothing overridden)');

  // one tip
  await click('#btn-tip-dealer'); await sleep(200);
  let i1 = await info();
  ok(i1.bank === i0.bank - 5, 'a tip costs $5 from the bankroll', [i0.bank, i1.bank]);
  ok(i1.tot === 5 && i1.lvl === 1, 'and goes in the jar', i1);
  ok(i1.state === 'up' && i1.busy, 'the dealer comes up to take it', i1);
  ok(await p.evaluate(() => /5/.test(document.getElementById('bankroll-val') ? document.getElementById('bankroll-val').textContent : document.getElementById('bankroll-amount').textContent)), 'the bankroll on screen shows the new figure');
  const t0 = Date.now(); let freed = false; while(Date.now() - t0 < 9000){ if(await p.evaluate(() => TRDealer.canTip())){ freed = true; break; } await sleep(200); }
  ok(freed, 'he finishes his thank-you and is ready for the next tip', Date.now() - t0);
  await sleep(700);
  ok((await info()).state === 'away', 'and goes back down between hands');
  await click('#btn-tip-dealer'); await click('#btn-tip-dealer');          // a second tap while he is busy must not cost anything
  await sleep(300);
  ok((await info()).tot === 10, 'tapping again while he is busy does not double-charge', await info());

  // fan levels
  for(let k = 0; k < 2; k++){ await ready(12000); await click('#btn-tip-dealer'); await sleep(300); }
  await ready(12000);
  const i2 = await info();
  ok(i2.tot === 20 && i2.lvl === 2 && i2.fan === '2', 'at $20 he is a fan', i2);
  const r = await p.evaluate(() => ({ w: TRTip.react('win', false), l: TRTip.react('lose', false), pu: TRTip.react('push', false), b: TRTip.react('big', true) }));
  ok(r.w && r.w.mood === 'joy' && r.w.line, 'a fan is happy when you win', r.w);
  ok(r.l && r.l.mood === 'aww' && r.l.line, 'and kind when you lose', r.l);
  ok(r.pu && r.pu.mood === 'sm2', 'and relieved on a push', r.pu);
  ok(r.b && r.b.mood === 'joy' && r.b.hearts >= 5, 'and over the moon on a big one', r.b);
  ok(await p.evaluate(() => { const e = document.querySelector('.ds-pin .p2'); return !!e && getComputedStyle(e).opacity === '1'; }), 'he wears a heart pin');

  // the money is real: it is still gone after a reload (shared bankroll), and so is the jar (this tab's session)
  await p.reload({ waitUntil: 'load' }); await sleep(1200); await click('#btn-tablesetup-continue'); await sleep(250); await click('#cutcard-preset-75'); await sleep(250);
  const i3 = await info();
  ok(i3.tot === 20 && i3.fan === '2' && i3.bank === 980, 'a reload keeps the jar and the bankroll for this session', i3);

  // a short bankroll cannot tip
  await ready();
  await p.evaluate(() => { G.bankroll = 9; if(typeof syncBank === 'function') syncBank(); else if(typeof renderBankroll === 'function') renderBankroll(); else if(typeof renderCountBar === 'function') renderCountBar(); });
  await sleep(500);
  await click('#btn-tip-dealer'); await sleep(200);
  const i5 = await info();
  ok(i5.tot === 20 && i5.bank === 9, 'with $9 left he does not take a $5 tip', i5);

  // reset: a new session is an empty jar
  await p.evaluate(() => { const b = document.getElementById('btn-reset-bankroll'); if(b) b.click(); });
  await sleep(500);
  const i4 = await info();
  ok(i4.tot === 0 && i4.lvl === 0 && i4.fan === '0', 'resetting the bankroll empties the jar', i4);
  ok(await p.evaluate(() => TRTip.react('win', false) === null), 'and he is just a dealer again');
  ok(await p.evaluate(() => { const e = document.querySelector('.ds-pin .p2'); return !e || getComputedStyle(e).opacity === '0'; }), 'and the pin comes off');

  // not while a hand is in play
  await ready();
  await click('#chip-25');
  if(game === 'baccarat') await click('#spot-player');
  if(game === 'pai-gow') await click('#spot-ante');
  if(game === 'ultimate-texas-holdem'){ await click('#spot-ante'); await click('#spot-blind'); }
  await click('#btn-deal'); await sleep(1500);
  const mid = await p.evaluate(() => ({ phase: G.phase, can: TRDealer.canTip(), bank: G.bankroll, tot: TRTip.total() }));
  ok(mid.phase !== 'betting' && mid.can === false, 'no tipping in the middle of a hand', mid);
  await click('#btn-tip-dealer'); await sleep(200);
  const after = await info();
  ok(after.tot === mid.tot && after.bank === mid.bank, 'and the button does nothing then', after);

  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const only = process.argv[2];
  for(const g of GAMES){ if(only && only !== g) continue; try{ await run(browser, g); }catch(e){ failures++; console.log('FAIL:', g, 'threw', String(e && e.message || e).split('\n')[0]); } }
  await browser.close();
  console.log('\n' + (failures ? 'FAILED' : 'PASSED') + ': ' + oks + ' checks ok, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
