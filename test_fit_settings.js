// Table settings opens above the table and pushes it down. Changing a setting in it must not squeeze the table to its smallest size.
// Run from the site folder:  node test_fit_settings.js [game]
const { chromium } = require('playwright');
const path = require('path');
const GAMES = process.argv[2] ? [process.argv[2]] : ['blackjack', 'baccarat', 'pai-gow', 'ultimate-texas-holdem', 'craps'];
const SIZES = [[1440, 800], [1920, 1000]];
let oks = 0, failures = 0;
function ok(cond, desc, extra){ if(cond){ oks++; console.log('OK:', desc); } else { failures++; console.log('FAIL:', desc, extra === undefined ? '' : '| ' + JSON.stringify(extra)); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  for(const game of GAMES) for(const [W, H] of SIZES){
    const label = game + ' ' + W + 'x' + H;
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.addInitScript(() => { try{ localStorage.setItem('house_edge_experience_v1', JSON.stringify({ level: 'pro', updated: Date.now() })); localStorage.setItem('soft17_sound', 'off'); }catch(e){} });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto('file://' + path.join(process.env.SITE || __dirname, game, 'index.html'), { waitUntil: 'load' }); await sleep(1300);
    const click = async s => { try{ await p.click(s, { timeout: 900 }); return true; }catch(e){ return false; } };
    await click('#btn-tablesetup-continue'); await sleep(250); await click('#cutcard-preset-75'); await sleep(1400);
    const M = () => p.evaluate(() => { const felt = document.querySelector('.table-felt, #felt'); return { fit: Number(getComputedStyle(document.documentElement).getPropertyValue('--fit')), felt: Math.round(felt.getBoundingClientRect().height) }; });
    const before = await M();
    await click('#btn-toggle-settings'); await sleep(900);
    const open = await p.evaluate(() => getComputedStyle(document.getElementById('settings-panel')).display !== 'none');
    ok(open, label + ': Table settings opens');
    const mid = await M();
    ok(Math.abs(mid.fit - before.fit) < 0.001 && mid.felt === before.felt, label + ': opening it leaves the table its size', { before, mid });
    const did = await p.evaluate(() => { const pn = document.getElementById('settings-panel'); const t = pn.querySelector('select, input[type=checkbox]'); if(!t) return null; if(t.tagName === 'SELECT'){ t.selectedIndex = (t.selectedIndex + 1) % t.options.length; t.dispatchEvent(new Event('change', { bubbles: true })); } else t.click(); return t.id; });
    await sleep(1200);
    const after = await M();
    ok(did && after.felt >= before.felt - 40 && (before.fit < 0.02 || after.fit > 0.02), label + ': changing a setting (' + did + ') does not shrink the table', { before, after });
    await click('#btn-toggle-settings'); await sleep(900);
    const closed = await M();
    ok(closed.felt >= before.felt - 40 && (before.fit < 0.02 || closed.fit > 0.02), label + ': and it is still that size once the panel is closed', { before, closed });
    ok(errs.length === 0, label + ': no page errors', errs.slice(0, 2));
    await ctx.close();
  }
  await browser.close();
  console.log('\n' + oks + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
