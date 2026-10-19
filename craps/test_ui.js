// UI regression tests for the craps table. They load the real page in jsdom (not a hand-kept mock), drive it
// through the same functions the buttons call, and check the bankroll arithmetic, the DOM and what is saved.
// Run:  node test_ui.js [path/to/index.html]      (FAILFAST=1 stops at the first failing check)
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const PAGE = path.resolve(process.argv[2] || path.join(__dirname, 'index.html'));
let failures = 0, passes = 0;
function check(desc, actual, expected){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(!ok){ failures++; console.log('FAIL:', desc, '| got', JSON.stringify(actual), 'expected', JSON.stringify(expected)); if(process.env.FAILFAST) process.exit(1); }
  else { passes++; if(process.env.VERBOSE) console.log('OK:', desc); }
}
function truthy(desc, v){ check(desc, !!v, true); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const K = { bank:'house_edge_bankroll_v1', hand:'house_edge_craps_hand_v1', sess:'house_edge_craps_session_v1', exp:'house_edge_experience_v1' };

function load(seed, opts){
  opts = opts || {};
  const html = fs.readFileSync(PAGE, 'utf8');
  const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://tableready.xyz/craps/',
    beforeParse(w){
      if(opts.audio){
        // a fake Web Audio: records every oscillator (what it plays, when it starts) so the real sound path runs without a speaker
        const rec = w.__audio = { osc:[], noise:0, created:0, now:0 };
        const param = o => ({ setValueAtTime(v, t){ o.f0 = v; o.t0 = t; }, exponentialRampToValueAtTime(v, t){ o.f1 = v; o.t1 = t; } });
        const gainParam = () => ({ setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){} });
        w.AudioContext = function(){
          rec.created++; this.sampleRate = 8000; this.destination = {};
          Object.defineProperty(this, 'currentTime', { get(){ return rec.now; } });
          this.createOscillator = () => { if(opts.audio.throws) throw new Error('audio broke'); const o = { type:'sine', connect(){}, start(t){ o.startAt = t === undefined ? 0 : t; }, stop(t){ o.stopAt = t; } }; o.frequency = param(o); rec.osc.push(o); return o; };
          this.createGain = () => ({ gain:gainParam(), connect(){} });
          this.createBuffer = n => ({ getChannelData: () => new Float32Array(n) });
          this.createBufferSource = () => { rec.noise++; return { connect(){}, start(){}, stop(){} }; };
          this.createBiquadFilter = () => ({ frequency:{}, Q:{}, connect(){} });
        };
      }
      if(opts.noStorage){ Object.defineProperty(w, 'localStorage', { get(){ throw new Error('denied'); } }); return; }
      Object.keys(seed||{}).forEach(k => { if(seed[k] !== null && seed[k] !== undefined) w.localStorage.setItem(k, typeof seed[k]==='string' ? seed[k] : JSON.stringify(seed[k])); });
    } });
  const w = dom.window;
  w.errs = [];
  w.addEventListener('error', e => w.errs.push(e.message));
  return w;
}
function snapshot(w){ const o = {}; for(let i=0;i<w.localStorage.length;i++){ const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; }
async function settle(w){ for(let i=0;i<400;i++){ if(w.G.phase === 'betting') { await sleep(2); return; } await sleep(3); } throw new Error('roll never settled'); }
async function roll(w, a, b){ w.rollDice(a, b); await settle(w); }
function turbo(w){ w.G.settings.turbo = true; w.G.settings.sound = false; w.G.settings.keep = false; }   // keep-bets-out has its own tests below
function click(w, el){ el.dispatchEvent(new w.Event('click', { bubbles:true })); }
function hit(w, key){
  const num = /^(place|buy)(\d+)$/.exec(key);
  if(num) w.setMode(+num[2], num[1]);          // the box's Place / Buy switch
  const el = num ? w.document.querySelector('.num[data-number="'+num[2]+'"] .spot-hit') : w.document.querySelector('.spot[data-key="'+key+'"] .spot-hit');
  click(w, el);
}
function box(w, n){ return w.document.querySelector('.num[data-number="'+n+'"]'); }
function pbBtn(w, n, m){ return box(w, n).querySelector('.pb-switch [data-mode="'+m+'"]'); }
function numBetOf(w, n){ return w.G.table.bets.find(b => (b.type==='place'||b.type==='buy') && b.number===n); }
function readout(w){ const el = $(w,'stage-total'); return { pips:[...el.querySelectorAll('.d2')].map(d => d.querySelectorAll('i').length), total: (el.querySelector('.rd-tot')||{}).textContent }; }
function sub(w){ return $(w,'callout-sub').textContent; }
function spot(w, key){ return w.document.querySelector('.spot[data-key="'+key+'"]'); }
function $(w, id){ return w.document.getElementById(id); }
function money(n){ return (n<0?'-':'')+'$'+Math.abs(n).toLocaleString('en-US'); }
function betOf(w, type, number){ return w.G.table.bets.find(b => b.type===type && (number===undefined || b.number===number)); }
function lsBank(w){ return JSON.parse(w.localStorage.getItem(K.bank)).balance; }
function lsTable(w){ const r = w.localStorage.getItem(K.hand); return r ? JSON.parse(r).table : null; }

// Mulberry32 so the fuzz is reproducible
function rng(seed){ let a = seed>>>0; return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a>>>15, 1|a); t = t + Math.imul(t ^ t>>>7, 61|t) ^ t; return ((t ^ t>>>14) >>> 0) / 4294967296; }; }

// Everything on screen must agree with the game state.
function domMatchesState(w, label){
  const G = w.G, E = w.E, t = G.table, bad = [];
  if(G.phase !== 'betting') return bad;
  if($(w,'bankroll-amount').textContent !== money(G.bankroll)) bad.push('pill '+$(w,'bankroll-amount').textContent+' vs '+money(G.bankroll));
  if($(w,'on-table').textContent !== money(E.exposure(t))) bad.push('on-table '+$(w,'on-table').textContent+' vs '+money(E.exposure(t)));
  const ptxt = $(w,'phase-text').textContent;
  if(ptxt !== (t.point===null ? 'Come-out roll' : 'Point is '+t.point)) bad.push('phase '+ptxt);
  w.document.querySelectorAll('.spot').forEach(el => {
    const key = el.getAttribute('data-key'); if(key.indexOf('place')===0) return;
    const m = /^hard(\d+)$/.exec(key);
    const bet = m ? t.bets.find(b => b.type==='hard' && b.number===+m[1]) : t.bets.find(b => b.type===key && b.number===null);
    const amt = el.querySelector('.spot-chips .amt');
    if(bet && (!amt || amt.textContent !== money(bet.amount))) bad.push(key+' shows '+(amt&&amt.textContent)+' vs '+bet.amount);
    if(!bet && amt) bad.push(key+' shows chips but has no bet');
  });
  [4,5,6,8,9,10].forEach(n => {
    const el = w.document.querySelector('.num[data-number="'+n+'"]');
    const pl = t.bets.find(b => (b.type==='place'||b.type==='buy') && b.number===n);
    const amt = el.querySelector('.num-stack .amt');
    if(pl && (!amt || amt.textContent !== money(pl.amount))) bad.push('place/buy '+n+' shows '+(amt&&amt.textContent));
    if(!pl && amt) bad.push('place/buy '+n+' shows chips but no bet');
    if(pl && el.querySelector('.pb-switch [aria-pressed="true"]').getAttribute('data-mode') !== pl.type) bad.push('switch on '+n+' disagrees with the bet');
    const wantPress = (pl && w.pressAmount(n)>0 && Math.min(w.pressAmount(n), G.bankroll)>0) ? 1 : 0;
    if(el.querySelectorAll('.press-row .tag').length !== wantPress) bad.push('press button on '+n+': '+el.querySelectorAll('.press-row .tag').length+' vs '+wantPress);
    const tags = el.querySelectorAll('.tags .tag').length, want = t.bets.filter(b => (b.type==='come'||b.type==='dontcome') && b.number===n).length;
    if(tags !== want) bad.push('tags on '+n+': '+tags+' vs '+want);
    if(el.classList.contains('is-point') !== (t.point===n)) bad.push('is-point on '+n);
  });
  ['pass','dontpass'].forEach(k => {
    const b = t.bets.find(x => x.type===k), st = spot(w,k).querySelector('.odds-stack');
    const want = (b && t.point!==null && b.odds>0) ? money(b.odds) : null;
    const got = st && st.querySelector('.amt') ? st.querySelector('.amt').textContent : null;
    if(got !== want) bad.push(k+' odds chips show '+got+' vs '+want);
  });
  if($(w,'btn-keep').getAttribute('aria-checked') !== String(!!G.settings.keep)) bad.push('keep switch out of step');
  if($(w,'btn-roll').disabled) bad.push('roll disabled while betting');
  return bad.map(x => label+': '+x);
}
function invariants(w, base, label){
  const G = w.G, E = w.E, bad = [];
  if(G.bankroll < 0) bad.push('negative bankroll '+G.bankroll);
  if(G.bankroll + E.exposure(G.table) !== base + G.session.net) bad.push('money not conserved: '+G.bankroll+' + '+E.exposure(G.table)+' != '+base+' + '+G.session.net);
  if(lsBank(w) !== G.bankroll) bad.push('saved bankroll '+lsBank(w)+' vs '+G.bankroll);
  const st = lsTable(w);
  if(st && JSON.stringify(st) !== JSON.stringify(G.table)) bad.push('saved table differs');
  if(!E.validState(G.table)) bad.push('table state invalid');
  return bad.map(x => label+': '+x);
}

(async function main(){
  // ======================================================== 1. first load
  {
    const w = load({});
    check('keep same bets out is on by default', [w.G.settings.keep, $(w,'btn-keep').getAttribute('aria-checked'), $(w,'set-keep').checked], [true, 'true', true]);
    check('house edge shown by default', [w.G.settings.showEdge, $(w,'btn-edge').getAttribute('aria-pressed'), $(w,'felt').classList.contains('no-edge')], [true, 'true', false]);
    check('auto-press is off by default', w.G.settings.autopress, false);
    turbo(w);
    check('no script errors on load', w.errs, []);
    check('title', w.document.title, 'Table Ready — Craps Trainer');
    check('bankroll starts at $1,000', $(w,'bankroll-amount').textContent, '$1,000');
    check('shared bankroll saved on load', lsBank(w), 1000);
    check('starts on the Starter table', w.G.settings.level, 'starter');
    check('Starter shows Pass and Don\'t Pass only', ['pass','dontpass','come','dontcome','field','hard4','any7','boxcars'].map(k => !spot(w,k).hidden), [true,true,false,false,false,false,false,false]);
    check('Starter hides the one-roll corner', $(w,'props').style.display, 'none');
    truthy('place-bet boxes are not clickable at Starter', w.document.querySelector('.num .spot-hit').style.display === 'none');
    check('numbers are static at Starter', $(w,'numbers').classList.contains('static'), true);
    check('the read-out has a flat 2D die per die and the total', [$(w,'stage-total').className, $(w,'dice-stage').contains($(w,'stage-total'))], ['readout', false]);
    check('keep switch sits with the dice, bottom right', [$(w,'btn-keep').parentNode.className, $(w,'btn-keep').getAttribute('role')], ['stage-wrap', 'switch']);
    check('six faces on each die', [0,1].map(i => $(w,'die-'+i).querySelectorAll('.face').length), [6,6]);
    check('pip counts per face', [1,2,3,4,5,6].map(n => $(w,'die-0').querySelector('.f'+n).querySelectorAll('i').length), [1,2,3,4,5,6]);
    check('come-out phase text', $(w,'phase-text').textContent, 'Come-out roll');
    check('puck shows OFF', $(w,'puck').textContent, 'OFF');
    check('coach tells a new shooter what to do', /Pass Line/.test($(w,'coach-next').textContent), true);
    check('every spot lists its house edge', [...w.document.querySelectorAll('.spot')].every(s => /edge/.test(s.textContent)), true);
    check('edge shown on Pass Line', spot(w,'pass').querySelector('.edge').textContent, '1.41% edge');
    check('edge shown on Don\'t Pass', spot(w,'dontpass').querySelector('.edge').textContent, '1.36% edge');
    check('edge shown on Any Seven', spot(w,'any7').querySelector('.edge').textContent, '16.67% edge');
    check('edge shown on Place 6', w.document.querySelector('.num[data-number="6"] .edge').textContent, '1.52% edge');
    check('edge shown on the 4 (Buy by default)', w.document.querySelector('.num[data-number="4"] .edge').textContent, '1.67% edge');
    check('edge guide has a row per bet type', $(w,'edge-guide').querySelectorAll('.eg-row').length, w.E.LEDGER.length);
    check('roll button enabled', $(w,'btn-roll').disabled, false);
    check('undo/take down/rebet disabled with an empty table', [$(w,'btn-undo').disabled, $(w,'btn-clear').disabled, $(w,'btn-rebet').disabled], [true,true,true]);
    check('reset bankroll allowed on an empty table', $(w,'btn-reset-bankroll-settings').disabled, false);
    check('landing-page glossary link', !!w.document.querySelector('a[href="/learn/glossary/"]'), true);
    w.close();
  }

  // ======================================================== 2. placing, undo, take down
  {
    const w = load({}); turbo(w);
    hit(w,'pass');
    check('placing $25 on Pass Line', [w.G.bankroll, betOf(w,'pass').amount], [975, 25]);
    check('pill follows', $(w,'bankroll-amount').textContent, '$975');
    check('on the table', $(w,'on-table').textContent, '$25');
    w.G.chip = 100; hit(w,'pass');
    check('stacking more chips', [w.G.bankroll, betOf(w,'pass').amount], [875, 125]);
    click(w, $(w,'btn-undo'));
    check('undo removes only the last chips', [w.G.bankroll, betOf(w,'pass').amount], [975, 25]);
    check('chip stack drawn', spot(w,'pass').querySelectorAll('.pchip').length > 0, true);
    click(w, spot(w,'pass').querySelector('.spot-x'));
    check('take-down button returns the money', [w.G.bankroll, w.G.table.bets.length], [1000, 0]);
    check('saved bankroll matches', lsBank(w), 1000);
    check('hand cleared from storage', w.localStorage.getItem(K.hand), null);
    w.G.bankroll = 500; w.G.chip = 1000; hit(w,'pass');
    check('cannot bet more than the bankroll', [w.G.bankroll, w.G.table.bets.length], [500, 0]);
    truthy('says why', /need \$1000/.test($(w,'table-msg').textContent));
    w.G.bankroll = 1000; w.G.chip = 25;
    hit(w,'pass'); hit(w,'dontpass');
    check('Pass and Don\'t Pass can both be bet', w.G.table.bets.map(b => b.type), ['pass','dontpass']);
    click(w, $(w,'btn-clear'));
    check('Take down clears everything removable', [w.G.bankroll, w.G.table.bets.length], [1000, 0]);
    // chip tray selection
    click(w, $(w,'chip-100'));
    check('choosing a chip', [w.G.chip, $(w,'chip-100').classList.contains('active'), $(w,'chip-25').classList.contains('active')], [100, true, false]);
    check('saved chip choice', JSON.parse(w.localStorage.getItem(K.sess)).chip, 100);
    const wc = load(snapshot(w));
    check('chip choice survives a reload', [wc.G.chip, $(wc,'chip-100').classList.contains('active')], [100, true]);
    wc.close();
    w.close();
  }

  // ======================================================== 3. rolls: line bets and odds
  {
    const w = load({}); turbo(w);
    // natural
    hit(w,'pass'); await roll(w,3,4);
    check('7 on the come-out pays the Pass Line', [w.G.bankroll, w.G.table.bets.length, w.G.table.point], [1025, 0, null]);
    check('stats: one roll, net +25', [w.G.session.rolls, w.G.session.net], [1, 25]);
    check('roll strip pill is a 7', [$(w,'roll-strip').querySelectorAll('.rp').length, $(w,'roll-strip').querySelector('.rp').textContent], [1, '7']);
    check('callout names it', /Seven/.test($(w,'callout-big').textContent), true);
    check('Rebet offers the bet that just won', $(w,'btn-rebet').textContent, 'Rebet $25');
    check('the flat read-out shows 3 + 4 = 7', readout(w), { pips:[3,4], total:'7' });
    click(w, $(w,'btn-rebet'));
    check('Rebet puts the same bet back', [w.G.bankroll, betOf(w,'pass').amount], [1000, 25]);
    // point, odds, point made
    await roll(w,2,2);
    check('a 4 on the come-out sets the point', [w.G.table.point, $(w,'phase-text').textContent, $(w,'puck').textContent], [4, 'Point is 4', 'ON']);
    truthy('the 4 box is highlighted', w.document.querySelector('.num[data-number="4"]').classList.contains('is-point'));
    check('line bet keeps its stake on the felt', [betOf(w,'pass').amount, w.G.bankroll], [25, 1000]);
    check('Pass Line closed for new bets', spot(w,'pass').querySelector('.spot-hit').disabled, true);
    check('Pass Line bet cannot be taken down once a point is on', spot(w,'pass').querySelector('.spot-x').classList.contains('can'), false);
    check('odds row appears', spot(w,'pass').querySelector('.odds-row').classList.contains('show'), true);
    check('odds button states the limit (3x on a 4)', /up to \$75/.test(spot(w,'pass').querySelector('.odds-btn').textContent), true);
    check('no odds yet: no chips in the odds row', spot(w,'pass').querySelector('.odds-stack').children.length, 0);
    click(w, spot(w,'pass').querySelector('.odds-btn'));
    check('taking $25 odds', [betOf(w,'pass').odds, w.G.bankroll], [25, 975]);
    check('odds show as chips with the amount', [spot(w,'pass').querySelectorAll('.odds-stack .pchip').length, spot(w,'pass').querySelector('.odds-stack .amt').textContent, spot(w,'pass').querySelector('.odds-stack .pchip').className], [1, '$25', 'pchip c25 drop']);
    w.G.chip = 100; click(w, spot(w,'pass').querySelector('.odds-btn'));
    check('odds are capped at the limit, not the chip', [betOf(w,'pass').odds, w.G.bankroll], [75, 925]);
    check('$75 of odds is drawn as a $50 chip and a $25 chip', [spot(w,'pass').querySelectorAll('.odds-stack .pchip').length, spot(w,'pass').querySelector('.odds-stack .amt').textContent, [...spot(w,'pass').querySelectorAll('.odds-stack .pchip')].map(c => c.className.replace(' drop','')).sort()], [2, '$75', ['pchip c25','pchip c50']]);
    check('odds button at the limit', spot(w,'pass').querySelector('.odds-btn').disabled, true);
    click(w, spot(w,'pass').querySelector('.odds-x'));
    check('taking odds down returns them', [betOf(w,'pass').odds, w.G.bankroll], [0, 1000]);
    check('and clears the chips', spot(w,'pass').querySelector('.odds-stack').children.length, 0);
    w.G.chip = 25; click(w, spot(w,'pass').querySelector('.odds-btn')); click(w, spot(w,'pass').querySelector('.odds-btn'));
    check('odds in two bites', [betOf(w,'pass').odds, w.G.bankroll], [50, 950]);
    click(w, $(w,'btn-undo'));
    check('undo takes back the last odds chip', [betOf(w,'pass').odds, w.G.bankroll], [25, 975]);
    await roll(w,6,6);
    check('no decision on a 12 with a point', [w.G.table.point, w.G.bankroll, betOf(w,'pass').amount], [4, 975, 25]);
    await roll(w,3,1);
    // flat 25 at 1:1 (+25) and 25 odds at 2:1 (+50); stakes come back
    check('point made: Pass pays 1:1 and odds pay 2:1', w.G.bankroll, 975 + 50 + 75);
    check('puck goes back to OFF', [w.G.table.point, $(w,'puck').textContent], [null, 'OFF']);
    check('points made counted', w.G.session.pointsMade, 1);
    check('callout says the point was made', /Point made/.test($(w,'callout-big').textContent), true);
    check('and gives the multipliers: 1:1 on the line, 2:1 on the odds', /Pass Line \+\$75 pays 1:1 \+ odds 2:1/.test(sub(w)), true);
    check('odds recorded in the ledger as no-edge money', [w.G.session.ledger.odds.wagered, w.G.session.ledger.odds.net], [25, 50]);
    check('Pass ledger shows the flat bets', [w.G.session.ledger.pass.wagered, w.G.session.ledger.pass.net], [50, 50]);
    // seven out
    hit(w,'pass'); await roll(w,5,4);
    check('a 9 sets the point', w.G.table.point, 9);
    click(w, spot(w,'pass').querySelector('.odds-btn'));
    const before = w.G.bankroll;
    await roll(w,4,3);
    check('seven-out loses line bet and odds', [w.G.bankroll, w.G.table.bets.length, w.G.table.point], [before, 0, null]);
    check('seven-outs counted and hand length recorded', [w.G.session.sevenOuts, w.G.session.longest], [1, 6]);
    check('seven pill in the strip is red', [...$(w,'roll-strip').querySelectorAll('.rp')].pop().classList.contains('seven'), true);
    check('callout reports it', $(w,'callout-big').textContent, 'Seven out');
    // Don't Pass
    hit(w,'dontpass'); await roll(w,1,2);
    check('Don\'t Pass wins on come-out 3', [w.G.bankroll, w.G.table.bets.length], [before + 25, 0]);
    hit(w,'dontpass'); await roll(w,6,6);
    check('12 on the come-out is a push for Don\'t Pass: stake comes back', [w.G.bankroll, w.G.table.bets.length], [before + 25, 0]);
    check('and Rebet offers it again', $(w,'btn-rebet').textContent, 'Rebet $25');
    w.close();
  }

  // ======================================================== 4. standard table: Place, Come, Field
  {
    const w = load({ [K.exp]:{ level:'rules' } }); turbo(w);
    check('"I know the rules" opens the Standard table', w.G.settings.level, 'standard');
    check('Standard shows Come and Field, not the props', [!spot(w,'come').hidden, !spot(w,'field').hidden, !spot(w,'hard6').hidden], [true, true, false]);
    truthy('place boxes are live', w.document.querySelector('.num .spot-hit').style.display !== 'none');
    check('Come is closed with no point', spot(w,'come').querySelector('.spot-hit').disabled, true);
    hit(w,'come');
    check('clicking a closed bet does nothing', w.G.table.bets.length, 0);
    hit(w,'field'); await roll(w,1,1);
    check('Field pays 2:1 on a 2', [w.G.bankroll, w.G.table.bets.length], [1050, 0]);
    check('and says so', /Field \+\$50 pays 2:1/.test(sub(w)), true);
    check('Rebet remembers the Field', $(w,'btn-rebet').textContent, 'Rebet $25');
    await roll(w,2,3);                                        // point 5, no bets
    check('point can be set with nothing bet', w.G.table.point, 5);
    check('Come is open now', spot(w,'come').querySelector('.spot-hit').disabled, false);
    w.G.chip = 30; hit(w,'place6'); w.G.chip = 25;
    check('Place 6 for $30', [betOf(w,'place',6).amount, w.G.bankroll], [30, 1020]);
    check('place box shows the stack', /\$30/.test(w.document.querySelector('.num[data-number="6"] .num-stack').textContent), true);
    check('tip about $6 steps stays away for a $30 bet', /\$6 steps/.test($(w,'table-msg').textContent), false);
    hit(w,'come'); hit(w,'dontcome');
    await roll(w,4,2);                                       // 6: place 6 wins 35 and stays, come and DC travel to 6? (6 is not the point)
    check('place 6 paid 7:6 and stayed up', [w.G.bankroll, betOf(w,'place',6).amount], [1020 - 50 + 35, 30]);
    check('the callout names the multiplier for the 6', /Place 6 \+\$35 pays 7:6/.test(sub(w)), true);
    check('Come and Don\'t Come moved to the 6', [betOf(w,'come').number, betOf(w,'dontcome').number], [6, 6]);
    check('their tags show on the 6 box', w.document.querySelectorAll('.num[data-number="6"] .tags .tag').length, 2);
    check('Come travels with a callout', /moves to 6/.test($(w,'callout-sub').textContent), true);
    check('the Come tag shows its bet as chips', [w.document.querySelectorAll('.num[data-number="6"] .tags .tag:not(.dc) .stack').length, w.document.querySelector('.num[data-number="6"] .tags .tag:not(.dc) .amt').textContent], [1, '$25']);
    // add odds to the traveled Come bet through its tag
    click(w, w.document.querySelector('.num[data-number="6"] .tags .tag:not(.dc)'));
    check('odds on a Come bet via its tag', [betOf(w,'come').odds, w.G.bankroll], [25, 980]);
    check('the tag now shows the odds as chips too', [w.document.querySelectorAll('.num[data-number="6"] .tags .tag:not(.dc) .stack').length, [...w.document.querySelectorAll('.num[data-number="6"] .tags .tag:not(.dc) .amt')].map(e => e.textContent)], [2, ['$25','$25']]);
    const bank = w.G.bankroll;
    await roll(w,3,3);                                       // 6 again: Come wins (1:1 + 6:5 odds -> floor(30)), DC loses, place 6 pays
    // come: stake 25 back + 25 win + odds 25 back + 30 win ; DC loses 25; place 6 wins 35
    check('Come wins on its number, Don\'t Come loses, Place pays again', w.G.bankroll, bank + (25+25) + (25+30) + 35);
    check('only the Place 6 is left', w.G.table.bets.map(b => b.type), ['place']);
    await roll(w,4,3);                                       // seven out
    check('7 loses Place bets', [w.G.table.bets.length, w.G.table.point], [0, null]);
    check('Place 6 appears in the ledger at its 1.52% edge', [w.G.session.ledger.place68.wagered, Math.round(w.E.LEDGER_BY_KEY.place68.edge*10000)], [90, 152]);
    w.close();
  }

  // ======================================================== 5. full table: hardways and one-roll bets
  {
    const w = load({ [K.exp]:{ level:'pro' } }); turbo(w);
    check('"I play regularly" opens the Full table', w.G.settings.level, 'full');
    check('props visible', [$(w,'props').style.display, !spot(w,'hard8').hidden, !spot(w,'acedeuce').hidden], ['', true, true]);
    w.G.chip = 10; hit(w,'hard8'); hit(w,'any7'); hit(w,'yo'); w.G.chip = 25;
    check('props placed', [w.G.bankroll, w.G.table.bets.length], [970, 3]);
    await roll(w,5,6);                                      // yo 15:1 -> +150, any7 loses
    check('Yo pays 15:1, Any Seven loses, Hard 8 is off but stays', [w.G.bankroll, w.G.table.bets.map(b => b.type).sort()], [970 + 10 + 150, ['hard']]);
    check('the callout says 15:1 for the Yo', /Yo \(11\) \+\$150 pays 15:1/.test(sub(w)), true);
    await roll(w,2,3);                                      // point 5
    await roll(w,4,4);                                      // hard 8 wins 9:1
    check('Hard 8 pays 9:1 and stays up', [w.G.bankroll, betOf(w,'hard',8).amount], [1130 + 90, 10]);
    check('the callout says 9:1', /Hard 8 \+\$90 pays 9:1/.test(sub(w)), true);
    await roll(w,6,2);                                      // easy 8
    check('easy 8 loses the Hard 8', [w.G.bankroll, w.G.table.bets.length], [1220, 0]);
    check('callout says easy eight', /Easy eight/.test($(w,'callout-big').textContent), true);
    check('ledger shows the props', ['yo','any7','hard68'].map(k => !!w.G.session.ledger[k]), [true,true,true]);
    const rows = [...$(w,'ledger-wrap').querySelectorAll('tbody tr')].map(r => r.children[0].textContent);
    check('ledger rows (largest wager first, total last)', rows[rows.length-1], 'All bets');
    check('ledger lists Hard 6 or 8', rows.includes('Hard 6 or 8'), true);
    w.close();
  }

  // ======================================================== 6. no moving the table while the dice are in the air
  {
    const w = load({}); // animation on
    w.G.settings.sound = false; w.G.settings.keep = false;
    hit(w,'pass');
    w.rollDice(3,4);
    check('rolling phase', w.G.phase, 'rolling');
    check('roll button locked mid-roll', $(w,'btn-roll').disabled, true);
    w.G.chip = 25; hit(w,'dontpass');
    check('cannot add a bet mid-roll', w.G.table.bets.length, 0);
    check('the bankroll already has the result', w.G.bankroll, 1025);
    check('but the pill still shows the pre-roll figure', $(w,'bankroll-amount').textContent, '$975');
    check('and the felt still shows the pre-roll bet', [betOf(w,'pass'), spot(w,'pass').querySelector('.amt').textContent], [undefined, '$25']);
    w.rollDice(1,1);
    check('a second roll mid-roll is ignored', w.G.session.rolls, 1);
    click(w, $(w,'btn-undo')); click(w, $(w,'btn-clear')); click(w, $(w,'btn-rebet'));
    check('undo / take down / rebet do nothing mid-roll', [w.G.bankroll, w.G.table.bets.length], [1025, 0]);
    check('state saved before the animation ends', [lsBank(w), lsTable(w).bets.length, JSON.parse(w.localStorage.getItem(K.hand)).last.sum], [1025, 0, 7]);
    await settle(w); await sleep(900);
    check('after the roll the pill catches up', $(w,'bankroll-amount').textContent, '$1,025');
    check('dice show 3 and 4 at rest, read-out pops in', [readout(w), $(w,'stage-total').classList.contains('show')], [{ pips:[3,4], total:'7' }, true]);
    check('felt cleared after the win', spot(w,'pass').querySelector('.amt'), null);
    // reload mid-roll must not rewind the result
    hit(w,'pass');
    w.rollDice(1,1);                                         // craps, loses 25
    const snap = snapshot(w); w.close();
    // betting while the pill is still counting up must not leave a stale figure behind
    const wr = load({}); wr.G.settings.sound = false; wr.G.settings.keep = false;
    hit(wr,'pass'); wr.rollDice(3,4); await settle(wr);
    hit(wr,'pass');                                            // placed while the count-up is running
    await sleep(120);
    check('the count-up stops the moment the balance changes', $(wr,'bankroll-amount').textContent, '$1,000');
    await sleep(900);
    check('bet placed during the count-up: pill ends on the true balance', [$(wr,'bankroll-amount').textContent, wr.G.bankroll], ['$1,000', 1000]);
    check('bankroll pill chip stack redrawn', $(wr,'bankroll-chip-stack').children.length > 0, true);
    wr.close();
    const w2 = load(snap); turbo(w2);
    check('closing the page mid-roll keeps the loss', [w2.G.bankroll, w2.G.table.bets.length], [1000, 0]);
    w2.close();
  }

  // rebet never spends chips the player does not have
  {
    const w = load({ [K.bank]:{ balance:40 } }); turbo(w);
    w.G.rebet = [{ type:'pass', number:null, amount:100 }, { type:'field', number:null, amount:25 }];
    w.renderAll();
    check('Rebet only offers what the bankroll covers', $(w,'btn-rebet').textContent, 'Rebet $25');
    w.doRebet();
    check('Rebet skips the bet it cannot afford', [w.G.bankroll, w.G.table.bets.map(b => b.type)], [15, ['field']]);
    w.G.rebet = [{ type:'pass', number:null, amount:100 }]; w.renderAll();
    check('nothing affordable: Rebet disabled', [$(w,'btn-rebet').disabled, $(w,'btn-rebet').textContent], [true, 'Rebet']);
    w.doRebet();
    check('and doing it anyway changes nothing', [w.G.bankroll, w.G.table.bets.length], [15, 1]);
    w.close();
  }

  // ======================================================== 7. resume
  {
    const w = load({}); turbo(w);
    w.G.chip = 50; hit(w,'pass'); w.G.chip = 25; hit(w,'dontpass');
    await roll(w,3,3);                                       // point 6
    click(w, spot(w,'pass').querySelector('.odds-btn'));
    w.G.chip = 30; hit(w,'place8'); w.G.chip = 25;
    const snap = snapshot(w), want = JSON.stringify(w.G.table), bank = w.G.bankroll; w.close();
    const w2 = load(snap); turbo(w2);
    check('bets, point and odds come back', JSON.stringify(w2.G.table), want);
    check('bankroll comes back', w2.G.bankroll, bank);
    check('welcome-back note shown', $(w2,'resume-notice').style.display, '');
    check('puck is on the 6 after reload', $(w2,'puck').textContent, 'ON');
    check('DOM matches restored state', domMatchesState(w2, 'resume'), []);
    check('callout shows the last roll', /Last roll: 6/.test($(w2,'callout-big').textContent), true);
    check('session stats restored', [w2.G.session.rolls, w2.G.session.counts[6]], [1, 1]);
    // a new shooter after reload still plays
    await roll(w2,6,1);
    check('plays on after a reload', [w2.G.table.point, w2.G.session.rolls], [null, 2]);
    w2.close();
  }

  // ======================================================== 8. bankroll: shared key, bankruptcy, reset
  {
    const w = load({ [K.bank]:{ balance:2500, lastUpdated:'2026-01-01T00:00:00Z' } }); turbo(w);
    check('shared bankroll is picked up from another game', [w.G.bankroll, $(w,'bankroll-amount').textContent], [2500, '$2,500']);
    hit(w,'pass');
    check('shared bankroll written back after betting', lsBank(w), 2475);
    w.close();
    const w1 = load({ [K.bank]:{ balance:25 } }); turbo(w1);
    hit(w1,'pass');
    check('all-in', w1.G.bankroll, 0);
    await roll(w1,1,1);
    check('bust resets to $1,000 with a notice', [w1.G.bankroll, $(w1,'bankroll-amount').textContent, $(w1,'bankruptcy-notice').style.display], [1000, '$1,000', '']);
    check('reset saved', lsBank(w1), 1000);
    w1.close();
    // broke but with a bet still riding is not bankrupt yet
    const w3 = load({ [K.bank]:{ balance:25 } }); turbo(w3);
    hit(w3,'pass'); await roll(w3,2,3);
    check('point on with every chip riding: no reset yet', [w3.G.bankroll, w3.G.table.bets.length, $(w3,'bankruptcy-notice').style.display], [0, 1, 'none']);
    await roll(w3,3,4);
    check('reset after the seven-out', w3.G.bankroll, 1000);
    w3.close();
    // bad balances
    for(const bad of ['{"balance":-50}', '{"balance":"lots"}', 'not json', '{"balance":null}', '[]']){
      const wb = load({ [K.bank]:bad }); turbo(wb);
      check('bad shared bankroll '+bad+' falls back to $1,000', wb.G.bankroll, 1000);
      wb.close();
    }
    const wz = load({ [K.bank]:{ balance:0 } });
    check('a saved balance of 0 gets the reset', wz.G.bankroll, 1000);
    wz.close();
    // reset button
    const wr = load({ [K.bank]:{ balance:310 } }); turbo(wr);
    click(wr, $(wr,'btn-reset-bankroll-settings'));
    check('reset button restores $1,000', wr.G.bankroll, 1000);
    hit(wr,'pass');
    check('reset blocked with bets down', $(wr,'btn-reset-bankroll-settings').disabled, true);
    wr.close();
  }

  // ======================================================== 9. levels and the landing-page answer
  {
    const cases = [['new','starter'],['rules','standard'],['pro','full']];
    for(const [ans, lvl] of cases){
      const w = load({ [K.exp]:{ level:ans } });
      check('landing answer "'+ans+'" starts on '+lvl, [w.G.settings.level, w.document.querySelector('#level-seg [aria-pressed="true"]').getAttribute('data-level')], [lvl, lvl]);
      w.close();
    }
    const w = load({}); turbo(w);
    check('no landing answer: Starter', w.G.settings.level, 'starter');
    click(w, w.document.querySelector('#level-seg [data-level="full"]'));
    check('picking Full table', [w.G.settings.level, !spot(w,'hard6').hidden, w.G.settings.levelSource], ['full', true, 'own']);
    click(w, w.document.querySelector('#level-seg [data-level="starter"]'));
    check('back to Starter hides the rest', [!spot(w,'hard6').hidden, !spot(w,'field').hidden], [false, false]);
    // a bet on a spot that gets hidden stays visible so the money is never lost from view
    click(w, w.document.querySelector('#level-seg [data-level="full"]'));
    w.G.chip = 10; hit(w,'any7'); w.G.chip = 25;
    click(w, w.document.querySelector('#level-seg [data-level="starter"]'));
    check('a bet stays visible after dropping to a simpler table', !spot(w,'any7').hidden, true);
    const snap = snapshot(w); w.close();
    // own choice beats later landing answers; a shared choice follows them
    const own = load(Object.assign({}, snap, { [K.exp]:{ level:'pro' } }));
    check('own pick survives a reload with a different landing answer', own.G.settings.level, 'starter');
    own.close();
    const sharedA = load({ [K.exp]:{ level:'rules' } }); const s1 = snapshot(sharedA); sharedA.close();
    const sharedB = load(Object.assign({}, s1, { [K.exp]:{ level:'pro' } }));
    check('a level that came from the landing page follows it when it changes', sharedB.G.settings.level, 'full');
    sharedB.close();
    const junk = load({ [K.exp]:{ level:'wizard' } });
    check('unknown landing answer ignored', junk.G.settings.level, 'starter');
    junk.close();
    const junk2 = load({ [K.exp]:'}{' });
    check('garbled landing answer ignored', junk2.G.settings.level, 'starter');
    junk2.close();
  }

  // ======================================================== 10. settings
  {
    const w = load({}); turbo(w);
    const odds = $(w,'set-odds'); odds.value = '1x'; odds.dispatchEvent(new w.Event('change'));
    check('odds rule applied to the table', [w.G.table.opts.oddsRule, w.G.settings.oddsRule], ['1x','1x']);
    hit(w,'pass'); await roll(w,3,3);
    check('1x odds limit shown', /up to \$25/.test(spot(w,'pass').querySelector('.odds-btn').textContent), true);
    const th = $(w,'set-theme'); th.value = 'midnight'; th.dispatchEvent(new w.Event('change'));
    check('theme applies', w.document.documentElement.style.getPropertyValue('--felt'), '#0B0F1A');
    $(w,'set-coach').checked = false; $(w,'set-coach').dispatchEvent(new w.Event('change'));
    check('coach can be turned off', $(w,'coach').style.display, 'none');
    $(w,'set-turbo').checked = false; $(w,'set-turbo').dispatchEvent(new w.Event('change'));
    check('turbo toggle', w.G.settings.turbo, false);
    const snap = snapshot(w); w.close();
    const w2 = load(snap); turbo(w2);
    check('settings survive a reload', [w2.G.settings.oddsRule, w2.G.table.opts.oddsRule, w2.G.settings.coach, $(w2,'set-theme').value, w2.document.documentElement.style.getPropertyValue('--felt')], ['1x','1x',false,'midnight','#0B0F1A']);
    w2.close();
    // settings button toggles the panel
    const w3 = load({});
    click(w3, $(w3,'btn-toggle-settings'));
    check('settings panel opens', [$(w3,'settings-panel').style.display, $(w3,'btn-toggle-settings').getAttribute('aria-expanded')], ['block','true']);
    w3.close();
  }

  // ======================================================== 11. panels: stats, ledger, histogram
  {
    const w = load({}); turbo(w);
    check('ledger explains itself when empty', /Once bets are decided/.test($(w,'ledger-wrap').textContent), true);
    check('histogram has 11 columns', $(w,'hist').querySelectorAll('.col').length, 11);
    const dice = [[3,4],[1,1],[2,6],[6,6],[5,5],[3,2],[4,1],[3,4],[6,3]];
    hit(w,'pass');
    for(const d of dice){ if(!w.G.table.bets.length && w.G.table.point===null) hit(w,'pass'); await roll(w, d[0], d[1]); }
    const S = w.G.session;
    check('every roll counted', S.rolls, dice.length);
    const sums = {}; dice.forEach(d => { sums[d[0]+d[1]] = (sums[d[0]+d[1]]||0)+1; });
    check('histogram counts match the dice', [2,3,4,5,6,7,8,9,10,11,12].map(n => S.counts[n]), [2,3,4,5,6,7,8,9,10,11,12].map(n => sums[n]||0));
    check('histogram count labels', [...$(w,'hist').querySelectorAll('.cnt')].map(e => e.textContent), [2,3,4,5,6,7,8,9,10,11,12].map(n => String(sums[n]||0)));
    check('the 7 bar is red', $(w,'hist').querySelectorAll('.bar')[5].getAttribute('style').indexOf('coral')>=0, true);
    check('histogram note mentions the roll count', new RegExp('after '+dice.length+' rolls').test($(w,'hist-note').textContent), true);
    check('strip keeps the most recent rolls', [...$(w,'roll-strip').querySelectorAll('.rp')].map(e => e.textContent), dice.slice(-9).map(d => String(d[0]+d[1])));
    const rows = [...$(w,'ledger-wrap').querySelectorAll('tbody tr')];
    check('ledger: Pass Line row then total', [rows[0].children[0].textContent, rows[rows.length-1].children[0].textContent], ['Pass Line / Come', 'All bets']);
    check('ledger edge cell', rows[0].children[1].textContent, '1.41%');
    check('ledger total edge equals the single bet type', rows[rows.length-1].children[1].textContent, '1.41%');
    const stat = k => [...$(w,'stats-grid').querySelectorAll('.stat')].find(e => e.querySelector('.k').textContent===k).querySelector('.v').textContent;
    check('stats grid', [stat('Rolls'), stat('Seven-outs')], [String(dice.length), String(S.sevenOuts)]);
    check('net shown with sign', stat('Net'), (S.net>=0?'+':'-')+'$'+Math.abs(S.net));
    // keep history bounded
    for(let i=0;i<60;i++) await roll(w,1,2);
    check('history capped at 40 rolls', w.G.session.history.length, 40);
    check('strip shows 14', $(w,'roll-strip').querySelectorAll('.rp').length, 14);
    click(w, $(w,'btn-reset-session'));
    check('reset session clears stats, ledger and strip', [w.G.session.rolls, $(w,'roll-strip').children.length, /Once bets are decided/.test($(w,'ledger-wrap').textContent)], [0, 0, true]);
    check('reset session leaves the bankroll alone', lsBank(w), w.G.bankroll);
    w.close();
  }

  // ======================================================== 12. keyboard
  {
    const w = load({}); turbo(w);
    { let k = 0; w.randDie = () => [3,4][k++ % 2]; }          // every Space roll is a 7, so the outcome never depends on luck
    const key = (el, type, extra) => { const ev = new w.KeyboardEvent(type, Object.assign({ key:' ', code:'Space', bubbles:true, cancelable:true }, extra||{})); el.dispatchEvent(ev); return ev; };
    key(w.document.body, 'keydown');
    await settle(w);
    check('Space rolls the dice', w.G.session.rolls, 1);
    const sel = $(w,'set-theme');
    key(sel, 'keydown'); await sleep(20);
    check('Space inside a form control does not roll', w.G.session.rolls, 1);
    // the reported bug: a bet button still has focus from the last click, and Space used to press it again
    hit(w,'pass');
    const btn = spot(w,'pass').querySelector('.spot-hit'); btn.focus();
    const down = key(btn, 'keydown'); await settle(w);
    check('Space with a bet button focused rolls', w.G.session.rolls, 2);
    check('and does not add to the bet: money is conserved and the bet is still $25 or gone', [w.G.bankroll + w.E.exposure(w.G.table) === 1000 + w.G.session.net, (betOf(w,'pass')||{amount:0}).amount <= 25], [true, true]);
    check('the key press is cancelled so a focused button cannot click itself', down.defaultPrevented, true);
    check('the key release is cancelled too (some browsers click on release)', key(btn, 'keyup').defaultPrevented, true);
    // chip, odds, take-down and roll buttons behave the same way
    for(const id of ['chip-100','btn-undo','btn-clear','btn-rebet','btn-roll','btn-keep']){
      const before = w.G.session.rolls, ev = key($(w,id), 'keydown'); await settle(w);
      check('Space on #'+id+' rolls instead of activating it', [w.G.session.rolls, ev.defaultPrevented], [before+1, true]);
    }
    check('no bet was added by any of those key presses', [w.G.table.bets.length, w.G.chip], [0, 25]);
    // holding the bar down is one roll
    const r0 = w.G.session.rolls; key(w.document.body, 'keydown', { repeat:true }); await sleep(20);
    check('a held key (repeat) does not roll again', w.G.session.rolls, r0);
    // toolbar and settings buttons keep their own keyboard behaviour
    const tb = $(w,'btn-edge'), ev2 = key(tb, 'keydown'); await sleep(20);
    check('Space on a toolbar button is left alone', [w.G.session.rolls, ev2.defaultPrevented], [r0, false]);
    // a mouse click hands focus back to the page, so the next Space is a roll
    const chip = $(w,'chip-50');
    w.document.dispatchEvent(new w.Event('pointerdown'));
    chip.focus(); click(w, chip);
    check('after a mouse click the button no longer holds focus', w.document.activeElement === chip, false);
    const cb = $(w,'set-coach'); w.document.dispatchEvent(new w.Event('pointerdown')); cb.focus(); click(w, cb);
    check('same for a settings checkbox', w.document.activeElement === cb, false);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key:'a' }));
    chip.focus(); click(w, chip);
    check('but a keyboard activation keeps focus where it is', w.document.activeElement === chip, true);
    w.close();
  }

  // ======================================================== 13. corrupted saves and no storage
  {
    const junk = [
      { [K.hand]:'{{{', [K.sess]:'{{{' },
      { [K.hand]:{ table:{ point:99, bets:[{id:1,type:'pass',amount:-5,number:null,odds:0}], nextId:2, opts:{} } }, [K.sess]:{ session:{ rolls:'x' } } },
      { [K.hand]:{ table:null }, [K.sess]:'null' },
      { [K.hand]:{ table:{ point:null, bets:[{id:1,type:'hard',amount:10,number:7,odds:0}], nextId:2, opts:{} } } },
      { [K.sess]:{ session:{ rolls:1, pointsMade:0, sevenOuts:0, shooterRolls:0, longest:0, net:0, best:0, counts:{2:1}, history:[], ledger:{} }, settings:{ level:'x', oddsRule:'99x', sound:'yes' }, theme:'neon', chip:7 } }
    ];
    for(let i=0;i<junk.length;i++){
      const w = load(junk[i]); turbo(w);
      check('corrupted save #'+(i+1)+' loads cleanly', [w.errs, w.G.table.bets.length, w.G.table.point, w.G.bankroll], [[], 0, null, 1000]);
      check('corrupted save #'+(i+1)+': settings fall back', [w.G.settings.level, w.G.settings.oddsRule, w.G.chip], ['starter','345',25]);
      hit(w,'pass'); await roll(w,3,4);
      check('corrupted save #'+(i+1)+' still plays', w.G.bankroll, 1025);
      w.close();
    }
    const w = load({}, { noStorage:true }); turbo(w);
    check('works without storage', w.errs, []);
    hit(w,'pass'); await roll(w,3,4);
    check('plays without storage', w.G.bankroll, 1025);
    w.close();
  }

  // ======================================================== 14. rounding tip and coach
  {
    const w = load({ [K.exp]:{ level:'rules' } }); turbo(w);
    await roll(w,3,2);                                       // point 5
    w.G.chip = 25; hit(w,'place6');
    truthy('tip: place 6/8 in $6 steps', /\$6 steps/.test($(w,'table-msg').textContent));
    w.G.chip = 5; hit(w,'place8');
    truthy('tip again for the 8', /\$6 steps/.test($(w,'table-msg').textContent));
    check('coach tells you about your line bet', /no line bet/.test($(w,'coach-next').textContent), true);
    hit(w,'come');
    check('coach after a come bet', typeof $(w,'coach-next').textContent, 'string');
    w.close();
  }

  // ======================================================== 16. Place and Buy on every number
  {
    const w = load({ [K.exp]:{ level:'rules' } }); turbo(w);
    check('default: Buy on 4 5 9 10, Place on 6 8', [4,5,6,8,9,10].map(n => pbBtn(w,n,'buy').getAttribute('aria-pressed')), ['true','true','false','false','true','true']);
    check('and the other side of each switch is the opposite', [4,5,6,8,9,10].map(n => pbBtn(w,n,'place').getAttribute('aria-pressed')), ['false','false','true','true','false','false']);
    check('Buy text and edge on the 4 by default', [box(w,4).querySelector('.num-sub').textContent, box(w,4).querySelector('.edge').textContent], ['Buy pays 2:1, 5% fee on wins', '1.67% edge']);
    check('Place text and edge on the 6 by default', [box(w,6).querySelector('.num-sub').textContent, box(w,6).querySelector('.edge').textContent], ['Place pays 7:6', '1.52% edge']);
    click(w, pbBtn(w,4,'place'));
    check('Place text and edge on the 4', [box(w,4).querySelector('.num-sub').textContent, box(w,4).querySelector('.edge').textContent], ['Place pays 9:5', '6.67% edge']);
    check('switching the 4 to Place changes only that number', [4,5,6,8,9,10].map(n => pbBtn(w,n,'place').getAttribute('aria-pressed')), ['true','false','true','true','false','false']);
    click(w, pbBtn(w,4,'buy')); click(w, pbBtn(w,6,'buy'));
    check('switching to Buy changes only that number', [4,5,6,8,9,10].map(n => pbBtn(w,n,'buy').getAttribute('aria-pressed')), ['true','true','true','false','true','true']);
    check('Buy text and edge: 4 and 10 are 1.67%, 5 and 9 are 2%, 6 and 8 are 2.27%',
      [4,6,9].map(n => box(w,n).querySelector('.num-sub').textContent+' / '+box(w,n).querySelector('.edge').textContent),
      ['Buy pays 2:1, 5% fee on wins / 1.67% edge', 'Buy pays 6:5, 5% fee on wins / 2.27% edge', 'Buy pays 3:2, 5% fee on wins / 2% edge']);
    check('the box now places Buy bets (key, label)', [box(w,4).querySelector('.spot-hit').getAttribute('data-key'), /^Buy 4/.test(box(w,4).querySelector('.spot-hit').getAttribute('aria-label'))], ['buy4', true]);
    w.G.chip = 25; click(w, box(w,4).querySelector('.spot-hit'));
    check('tap on a Buy box places a Buy bet', [numBetOf(w,4).type, numBetOf(w,4).amount, w.G.bankroll], ['buy', 25, 975]);
    truthy('a $25 buy gets the $20-steps tip', /\$20 steps/.test($(w,'table-msg').textContent));
    check('the little take-down x is visible on a number that holds a bet', w.getComputedStyle(box(w,4).querySelector('.spot-x')).display, 'flex');
    check('the stack shows $25 with chips', [box(w,4).querySelector('.num-stack .amt').textContent, box(w,4).querySelectorAll('.num-stack .pchip').length > 0], ['$25', true]);
    check('the Place side is locked while a Buy bet is on the number', [pbBtn(w,4,'place').disabled, pbBtn(w,4,'buy').disabled], [true, false]);
    click(w, pbBtn(w,4,'place'));
    check('clicking the locked side changes nothing', [w.G.settings.pb[4], numBetOf(w,4).type], ['buy', 'buy']);
    w.placeOnSpot('place4');
    check('a Place bet on a number that holds a Buy bet is refused with a reason', [w.G.table.bets.length, w.G.bankroll, /Buy|Place/.test($(w,'table-msg').textContent)], [1, 975, true]);
    // buy wins only when the point is on: take the 20 step, set a point, then hit the 4
    click(w, box(w,4).querySelector('.spot-x'));
    check('take-down returns the buy', [w.G.table.bets.length, w.G.bankroll], [0, 1000]);
    w.G.chip = 20; click(w, box(w,4).querySelector('.spot-hit'));
    await roll(w,3,2);                                       // point 5; buy 4 is off on the come-out and stays
    check('buy bet rides through a come-out roll', [numBetOf(w,4).amount, w.G.bankroll], [20, 980]);
    await roll(w,2,2);                                       // a 4: 20 at 2:1 = 40, less a $1 fee
    check('Buy 4 for $20 pays $39 (2:1 less the $1 fee) and stays up', [w.G.bankroll, numBetOf(w,4).amount], [980 + 39, 20]);
    check('the callout says 2:1 less the fee', /Buy 4 \+\$39 pays 2:1 less a \$1 fee/.test(sub(w)), true);
    check('the 4 box offers Press for $39', [box(w,4).querySelectorAll('.press-row .tag').length, box(w,4).querySelector('.press-row .tag').textContent], [1, 'Press +$39']);
    check('ledger has a Buy 4 or 10 row at 1.67%', [w.G.session.ledger.buy410.wagered, w.G.session.ledger.buy410.net, Math.round(w.E.LEDGER_BY_KEY.buy410.edge*10000)], [20, 39, 167]);
    click(w, box(w,4).querySelector('.press-row .tag'));
    check('Press puts the $39 onto the Buy bet', [numBetOf(w,4).amount, numBetOf(w,4).type, w.G.bankroll], [59, 'buy', 980]);
    // 7 out: the buy bet loses, Rebet offers it again (in Buy mode)
    await roll(w,4,3);
    check('a 7 takes the Buy bet', [w.G.table.bets.length, w.G.table.point], [0, null]);
    check('Rebet offers the Buy bet', [$(w,'btn-rebet').textContent, w.G.rebet.map(r => r.type+r.number)], ['Rebet $59', ['buy4']]);
    click(w, $(w,'btn-rebet'));
    check('Rebet puts a Buy bet back', [numBetOf(w,4).type, numBetOf(w,4).amount, pbBtn(w,4,'buy').getAttribute('aria-pressed')], ['buy', 59, 'true']);
    click(w, $(w,'btn-undo'));
    check('undo takes it off again', [w.G.table.bets.length, w.G.bankroll], [0, 980]);
    // the switch is remembered
    const snap = snapshot(w); w.close();
    const w2 = load(snap); turbo(w2);
    check('Place / Buy choices survive a reload', [4,5,6,8,9,10].map(n => w2.G.settings.pb[n]), ['buy','buy','buy','place','buy','buy']);
    check('and the boxes show them', [pbBtn(w2,4,'buy').getAttribute('aria-pressed'), box(w2,5).querySelector('.edge').textContent, box(w2,8).querySelector('.edge').textContent], ['true', '2% edge', '1.52% edge']);
    w2.close();
    // Starter hides the switch (numbers are display only there)
    const ws = load({}); 
    check('Starter table: no switch, no Press', [$(ws,'numbers').classList.contains('static'), ws.getComputedStyle(box(ws,6).querySelector('.pb-switch')).display], [true, 'none']);
    ws.close();
  }

  // ======================================================== 16b. The Buy 4/5/9/10 + Place 6/8 default, and what happens to older saves
  {
    const PB = w => [4,5,6,8,9,10].map(n => w.G.settings.pb[n]);
    const DEFAULT = ['buy','buy','place','place','buy','buy'], ALLPLACE = Array(6).fill('place');
    const w0 = load({}); turbo(w0);
    check('a first visit starts with Buy on 4 5 9 10 and Place on 6 8', PB(w0), DEFAULT);
    check('...and a tap on the 5 puts a Buy bet', (() => { w0.G.chip = 25; click(w0, box(w0,5).querySelector('.spot-hit')); return [numBetOf(w0,5).type, numBetOf(w0,5).amount]; })(), ['buy', 25]);
    check('...and a tap on the 8 puts a Place bet', (() => { w0.G.chip = 30; click(w0, box(w0,8).querySelector('.spot-hit')); return [numBetOf(w0,8).type, numBetOf(w0,8).amount]; })(), ['place', 30]);
    w0.persistAll && w0.persistAll();
    check('the default is saved with its version marker', [JSON.parse(w0.localStorage.getItem(K.sess)).settings.pbv, JSON.parse(w0.localStorage.getItem(K.sess)).settings.pb[9]], [2, 'buy']);
    w0.close();
    const oldSave = pb => ({ [K.sess]: { settings:{ level:'rules', pb } } });
    const wa = load(oldSave({4:'place',5:'place',6:'place',8:'place',9:'place',10:'place'}));
    check('an older save that never switched anything (all Place) moves to the new default', PB(wa), DEFAULT);
    wa.close();
    const wb = load(oldSave({4:'buy',5:'place',6:'place',8:'place',9:'place',10:'place'}));
    check('an older save the player had customised is left alone', PB(wb), ['buy','place','place','place','place','place']);
    wb.close();
    const wc = load({ [K.sess]: { settings:{ level:'rules', pbv:2, pb:{4:'place',5:'place',6:'place',8:'place',9:'place',10:'place'} } } });
    check('all Place chosen after the new default exists is kept', PB(wc), ALLPLACE);
    wc.close();
    for(const bad of ['x', 5, null, [], {4:'zzz', 5:7, 6:null}]){
      const wd = load({ [K.sess]: { settings:{ level:'rules', pbv:2, pb:bad } } });
      check('a damaged pb ('+JSON.stringify(bad)+') falls back to the default', PB(wd), DEFAULT);
      wd.close();
    }
    const we = load({ [K.sess]: { settings:{ level:'rules', pbv:2, pb:{4:'place',5:'junk',6:'buy'} } } });
    check('a partly damaged pb keeps the good entries and defaults the rest', PB(we), ['place','buy','buy','place','buy','buy']);
    we.close();
  }

  // ======================================================== 17. Press and auto-press
  {
    const w = load({ [K.exp]:{ level:'rules' } }); turbo(w);
    await roll(w,3,2);                                       // point 5
    w.G.chip = 30; hit(w,'place6'); w.G.chip = 25;
    await roll(w,4,2);                                       // 6 hits: 30 at 7:6 = $35
    check('a hit Place number offers to press its winnings', [box(w,6).querySelector('.press-row .tag').textContent, w.G.last.press], ['Press +$35', { 6:35 }]);
    check('only the number that hit does', [4,5,8,9,10].map(n => box(w,n).querySelectorAll('.press-row .tag').length), [0,0,0,0,0]);
    check('the coach explains pressing', /Press adds that win back/.test($(w,'coach-next').textContent), true);
    check('bankroll before pressing', w.G.bankroll, 1000 - 30 + 35);
    click(w, box(w,6).querySelector('.press-row .tag'));
    check('Press adds every dollar won to the same bet', [numBetOf(w,6).amount, numBetOf(w,6).type, w.G.bankroll], [65, 'place', 1005 - 35]);
    check('the button is gone after use', [box(w,6).querySelectorAll('.press-row .tag').length, w.G.last.press], [0, {}]);
    truthy('a total that is not a multiple of $6 gets the rounding note', /not a multiple of \$6/.test($(w,'table-msg').textContent));
    click(w, $(w,'btn-undo'));
    check('undo takes the pressed chips back off', [numBetOf(w,6).amount, w.G.bankroll], [30, 1005]);
    // the offer disappears with the next roll
    await roll(w,3,6);                                       // a 9, nothing bet on it: the old offer is gone
    check('a new roll clears the offer', [0,1,2,3,4,5].map(i => box(w,[4,5,6,8,9,10][i]).querySelectorAll('.press-row .tag').length), [0,0,0,0,0,0]);
    w.close();
    // limited by what is in the bankroll, hidden when there is nothing
    const wb = load({ [K.exp]:{ level:'rules' } }); turbo(wb);
    await roll(wb,3,2); wb.G.chip = 30; hit(wb,'place6'); await roll(wb,4,2);
    wb.G.bankroll = 10; wb.renderAll();
    check('with $10 in the bankroll the press is $10', box(wb,6).querySelector('.press-row .tag').textContent, 'Press +$10');
    click(wb, box(wb,6).querySelector('.press-row .tag'));
    check('pressing $10', [numBetOf(wb,6).amount, wb.G.bankroll], [40, 0]);
    wb.G.last.press = { 6:35 }; wb.renderAll();
    check('nothing left to press with: no button', box(wb,6).querySelectorAll('.press-row .tag').length, 0);
    wb.close();
    // the offer is saved with the hand
    const wp = load({ [K.exp]:{ level:'rules' } }); turbo(wp);
    await roll(wp,3,2); wp.G.chip = 30; hit(wp,'place6'); await roll(wp,4,2);
    const snap = snapshot(wp); wp.close();
    const wr = load(snap); turbo(wr);
    check('the Press offer survives a reload', [wr.G.last.press, box(wr,6).querySelectorAll('.press-row .tag').length], [{ 6:35 }, 1]);
    wr.close();
    // junk in the saved offer is ignored
    const bad = JSON.parse(snap[K.hand]); bad.last.press = { 6:'lots', 7:50, 5:-3, 4:2.5, 8:12 };
    const wj = load(Object.assign({}, snap, { [K.hand]:JSON.stringify(bad) })); turbo(wj);
    check('only whole positive amounts on real numbers are kept', wj.G.last.press, { 8:12 });
    wj.close();
    // auto-press
    const wa = load({ [K.exp]:{ level:'rules' } }); turbo(wa);
    $(wa,'set-autopress').checked = true; $(wa,'set-autopress').dispatchEvent(new wa.Event('change'));
    check('auto-press setting is on and saved', [wa.G.settings.autopress, JSON.parse(wa.localStorage.getItem(K.sess)).settings.autopress], [true, true]);
    await roll(wa,3,2); wa.G.chip = 30; hit(wa,'place6'); wa.G.chip = 25;
    await roll(wa,4,2);
    check('auto-press: the win goes straight back on the 6', [numBetOf(wa,6).amount, wa.G.bankroll, wa.G.last.press], [65, 970, {}]);
    truthy('and says so', /Auto-press: the 6 \+\$35/.test($(wa,'table-msg').textContent));
    check('no Press button is left to click', box(wa,6).querySelectorAll('.press-row .tag').length, 0);
    wa.close();
    // pressing a Buy number keeps it a Buy bet
    const wy = load({ [K.exp]:{ level:'rules' } }); turbo(wy);
    await roll(wy,3,2); wy.G.chip = 20; hit(wy,'buy10'); await roll(wy,5,5);
    check('Buy 10 hit: $20 at 2:1 less $1', [numBetOf(wy,10).amount, wy.G.bankroll, wy.G.last.press], [20, 1000 - 20 + 39, { 10:39 }]);
    click(wy, box(wy,10).querySelector('.press-row .tag'));
    check('pressed Buy stays Buy', [numBetOf(wy,10).type, numBetOf(wy,10).amount], ['buy', 59]);
    wy.close();
  }

  // ======================================================== 18. keep the same bets out
  {
    const w = load({}); w.G.settings.turbo = true; w.G.settings.sound = false;
    hit(w,'pass'); await roll(w,3,4);                        // natural wins $25
    check('with Keep on, the winning Pass Line goes straight back out', [w.G.table.bets.map(b => b.type), betOf(w,'pass').amount, w.G.bankroll], [['pass'], 25, 1000]);
    check('the felt shows it', [spot(w,'pass').querySelector('.spot-chips .amt').textContent, $(w,'btn-rebet').disabled], ['$25', true]);
    check('stats still count the win', [w.G.session.net, w.G.session.rolls], [25, 1]);
    check('saved with the bet on the table', [lsTable(w).bets.length, lsBank(w)], [1, 1000]);
    click(w, $(w,'btn-undo'));
    check('Undo takes the kept bet off again', [w.G.table.bets.length, w.G.bankroll], [0, 1025]);
    // a lost line bet comes back too, and a point does not duplicate it
    hit(w,'pass'); await roll(w,1,1);                       // craps, loses $25
    check('a losing bet is kept out as well', [betOf(w,'pass').amount, w.G.bankroll], [25, 975]);
    await roll(w,2,3);                                       // point 5
    check('with a point on, the Pass Line just rides (no second bet)', [w.G.table.bets.length, betOf(w,'pass').amount, w.G.bankroll], [1, 25, 975]);
    await roll(w,4,3);                                       // seven out: loses, new come-out, Pass goes back
    check('after a seven-out the Pass Line is back for the new shooter', [w.G.table.point, betOf(w,'pass').amount, w.G.bankroll], [null, 25, 950]);
    // a Field bet and a Place bet on the standard table
    click(w, w.document.querySelector('#level-seg [data-level="standard"]'));
    click(w, $(w,'btn-clear'));
    hit(w,'field'); await roll(w,1,2);                       // 3: the Field wins $25
    check('a winning Field bet is kept out', [betOf(w,'field').amount, w.G.bankroll], [25, 975]);
    await roll(w,2,3);                                       // 5 sets the point; the Field loses and is kept
    check('a lost Field bet is kept out', [betOf(w,'field').amount, w.G.bankroll], [25, 950]);
    w.G.chip = 30; hit(w,'place6'); w.G.chip = 25;
    const bank = w.G.bankroll;
    await roll(w,4,2);                                       // place 6 pays 35, stays; field loses and is kept
    check('Place bets simply stay up, and the Field is kept', [w.G.table.bets.map(b => b.type).sort(), w.G.bankroll], [['field','place'], bank + 35 - 25]);
    // a Come bet cannot be re-made when there is no point, and is not lost from Rebet
    hit(w,'come');
    await roll(w,4,3);                                       // seven out: place, come, field lose
    check('after the seven-out the Field and Place 6 are back; the Come bet needs a point so it waits for Rebet', [w.G.table.bets.map(b => b.type).sort(), w.G.rebet.map(r => r.type).sort()], [['field','place'], ['come']]);
    // can't afford it: skipped, not forced
    w.G.table = w.E.newState(); w.G.table.opts.oddsRule = w.G.settings.oddsRule; w.G.rebet = []; w.G.bankroll = 30; w.renderAll();
    hit(w,'field');                                          // $25 down, $5 left
    await roll(w,4,4);                                       // 8: the Field loses and only $5 is left
    check('with too little left, the bet is not forced back out', [w.G.table.bets.length, w.G.bankroll, w.G.rebet.length], [0, 5, 1]);
    check('Rebet stays disabled (cannot afford it)', $(w,'btn-rebet').disabled, true);
    // the switch
    w.G.bankroll = 1000; w.renderAll();
    click(w, $(w,'btn-keep'));
    check('the switch turns it off, saved, and the settings box follows', [w.G.settings.keep, $(w,'btn-keep').getAttribute('aria-checked'), $(w,'set-keep').checked, JSON.parse(w.localStorage.getItem(K.sess)).settings.keep], [false, 'false', false, false]);
    hit(w,'field'); await roll(w,3,3);
    check('with Keep off, nothing comes back by itself and Rebet offers it', [w.G.table.bets.length, $(w,'btn-rebet').textContent], [0, 'Rebet $25']);
    $(w,'set-keep').checked = true; $(w,'set-keep').dispatchEvent(new w.Event('change'));
    check('the settings box turns it back on', [w.G.settings.keep, $(w,'btn-keep').getAttribute('aria-checked')], [true, 'true']);
    click(w, $(w,'btn-keep')); click(w, $(w,'btn-keep'));
    const snap = snapshot(w); w.close();
    const w2 = load(snap);
    check('the choice survives a reload', [w2.G.settings.keep, $(w2,'btn-keep').getAttribute('aria-checked')], [true, 'true']);
    w2.G.settings.keep = false; w2.G.settings.turbo = true; w2.G.settings.sound = false; w2.saveSession(); const snap2 = snapshot(w2); w2.close();
    const w3 = load(snap2);
    check('Off survives a reload too', [w3.G.settings.keep, $(w3,'btn-keep').getAttribute('aria-checked'), $(w3,'set-keep').checked], [false, 'false', false]);
    w3.close();
  }

  // ======================================================== 19. multipliers on wins, with the animation on
  {
    const w = load({ [K.exp]:{ level:'pro' } }); w.G.settings.sound = false; w.G.settings.keep = false;
    hit(w,'field'); hit(w,'any7'); w.rollDice(1,1); await settle(w);
    const floats = [...w.document.querySelectorAll('.float-amt')].map(f => f.textContent);
    check('floating payouts carry the multiplier', floats.filter(t => /\+\$50/.test(t)).length === 1 && /2:1/.test(floats.join(' ')), true);
    check('the Field win reads 2:1', /Field \+\$50 pays 2:1/.test(sub(w)), true);
    w.close();
  }

  // ======================================================== 20. house edge toggle
  {
    const w = load({}); turbo(w);
    check('edge badges are drawn on every bet', w.document.querySelectorAll('#felt .edge').length > 8, true);
    click(w, $(w,'btn-edge'));
    check('the toolbar toggle hides them, saved, settings box follows', [w.G.settings.showEdge, $(w,'btn-edge').getAttribute('aria-pressed'), $(w,'felt').classList.contains('no-edge'), $(w,'set-edge').checked, JSON.parse(w.localStorage.getItem(K.sess)).settings.showEdge], [false, 'false', true, false, false]);
    check('the page stylesheet really hides a badge when it is off', w.getComputedStyle(spot(w,'pass').querySelector('.edge')).display, 'none');
    check('the edge panels below the table stay', [$(w,'edge-guide').children.length > 0, $(w,'ledger-wrap').textContent.length > 0], [true, true]);
    const snap = snapshot(w); w.close();
    const w2 = load(snap);
    check('Off survives a reload', [w2.G.settings.showEdge, w2.document.getElementById('felt').classList.contains('no-edge')], [false, true]);
    $(w2,'set-edge').checked = true; $(w2,'set-edge').dispatchEvent(new w2.Event('change'));
    check('the settings box turns them back on', [w2.G.settings.showEdge, w2.document.getElementById('felt').classList.contains('no-edge'), $(w2,'btn-edge').getAttribute('aria-pressed')], [true, false, 'true']);
    w2.close();
  }

  // ======================================================== 21. table art, chips, and the easter egg
  {
    const w = load({ [K.exp]:{ level:'pro' } }); turbo(w);
    const dice = k => [...spot(w,k).querySelectorAll('.prop-art .d2')].map(d => d.querySelectorAll('i').length);
    check('hardway boxes show their dice instead of text: 2-2, 3-3, 4-4, 5-5', ['hard4','hard6','hard8','hard10'].map(dice), [[2,2],[3,3],[4,4],[5,5]]);
    check('the hardway words are kept for screen readers only', ['hard4','hard6','hard8','hard10'].map(k => spot(w,k).querySelector('.spot-title').classList.contains('sr-only')), [true,true,true,true]);
    check('hardway boxes still say what they pay', ['hard4','hard6'].map(k => /Pays/.test(spot(w,k).querySelector('.spot-pay').textContent)), [true,true]);
    check('one-roll boxes show the winning dice: Yo 5-6, Aces 1-1, Boxcars 6-6, Ace-Deuce 1-2, Any Seven 4-3', ['yo','aces','boxcars','acedeuce','any7'].map(dice), [[5,6],[1,1],[6,6],[1,2],[4,3]]);
    check('a one on a die is the red pip', [...spot(w,'aces').querySelectorAll('.d2')].map(d => d.classList.contains('one')), [true,true]);
    check('Any Craps shows 2-3-12', spot(w,'anycraps').querySelector('.prop-big').textContent, '2\u00b73\u00b712');
    check('the same chip colours as the other tables', w.DENOM_COLOR, {1:'#6B7079',5:'#B33F3F',10:'#2F6FB0',25:'#2E8F63',50:'#3A3D44',100:'#7C5CC4',500:'#EDEDE6',1000:'#D97B29'});
    check('tray chips use the flat chip classes', [...w.document.querySelectorAll('#chip-row .chip-btn')].map(b => b.className.split(' ')[1]), ['c5','c10','c25','c50','c100','c500','c1000']);
    w.G.chip = 100; hit(w,'field');
    check('a $100 bet is a single violet-class chip', [...spot(w,'field').querySelectorAll('.spot-chips .pchip')].map(c => c.className.replace(' drop','')), ['pchip c100']);
    // Easter egg: tap the P and it pops out; the title splits into a chip and "Ass Line"
    const title = spot(w,'pass').querySelector('.spot-title'), egg = title.querySelector('.egg-p');
    const rest = () => [...title.childNodes].filter(n => n !== egg).map(n => n.textContent).join('');   // the words next to the P
    check('Pass Line reads Pass Line, and the P is its own piece', [title.textContent, egg.textContent, rest(), title.getAttribute('data-egg')], ['Pass Line', 'P', 'ass Line', null]);
    check('the other bets have no egg', w.document.querySelectorAll('.egg-p').length, 1);
    const bets0 = w.G.table.bets.length;
    click(w, egg);
    check('tapping the P separates it out: the word now reads "Ass Line", and no bet is placed', [egg.classList.contains('on'), title.getAttribute('data-egg'), rest(), w.G.table.bets.length], [true, 'on', 'Ass Line', bets0]);
    check('a chip stands apart from the word, and the P is still there to animate away', [egg.querySelectorAll('.egg-chip').length, egg.querySelectorAll('.egg-l').length], [1, 1]);
    click(w, egg);
    check('tapping again puts the P back: Pass Line', [egg.classList.contains('on'), title.getAttribute('data-egg'), rest(), title.textContent], [false, 'off', 'ass Line', 'Pass Line']);
    click(w, egg); click(w, egg); click(w, egg);
    check('it keeps toggling cleanly (three more taps leave it on)', [egg.classList.contains('on'), rest()], [true, 'Ass Line']);
    w.close();
  }

  // ======================================================== 22. dice land with the number on top
  {
    const w = load({});
    const css = w.document.querySelector('style').textContent;
    // turn a vector by a CSS transform list (rightmost function applies first); only rotations matter for a direction
    function turn(v, list){
      const fns = [...list.matchAll(/rotate([XYZ])\((-?[\d.]+)deg\)/g)].map(m => [m[1], +m[2]*Math.PI/180]).reverse();
      let [x,y,z] = v;
      for(const [ax, a] of fns){
        const c = Math.cos(a), s = Math.sin(a);
        if(ax==='X') [y,z] = [y*c - z*s, y*s + z*c];
        if(ax==='Y') [x,z] = [x*c + z*s, -x*s + z*c];
        if(ax==='Z') [x,y] = [x*c - y*s, x*s + y*c];
      }
      return [Math.round(x*1000)/1000, Math.round(y*1000)/1000, Math.round(z*1000)/1000];
    }
    const faceTf = n => (new RegExp('\\.die \\.f'+n+'\\{transform:([^;}]*)')).exec(css)[1];
    const ups = [1,2,3,4,5,6].map(v => {
      const dieTf = w.rotStr(w.ORIENT[v]);
      return [1,2,3,4,5,6].filter(f => { const n = turn(turn([0,0,1], faceTf(f)), dieTf); return n[1] < -0.99; });
    });
    check('for every roll exactly the matching face points straight up', ups, [[1],[2],[3],[4],[5],[6]]);
    check('opposite faces add to seven on the model', [1,2,3].map(f => { const a = turn([0,0,1], faceTf(f)), b = turn([0,0,1], faceTf(7-f)); return a.map((v,i) => v + b[i]).join(); }), ['0,0,0','0,0,0','0,0,0']);
    check('the view looks down on the dice', w.PITCH < -30 && w.PITCH > -80, true);
    w.close();
  }

  // ======================================================== 23. the roll is two dice, not one number from 2 to 12
  {
    const w = load({});
    const src = w.startRoll.toString();
    check('startRoll rolls two separate dice and nothing else', [(src.match(/randDie\(\)/g)||[]).length, /randInt|Math\.random|\b1\+/.test(src.replace(/randDie\(\)/g,''))], [2, false]);
    check('a die is 1 + a uniform 0..5', /return 1\+randInt\(6\)/.test(w.randDie.toString()), true);
    check('the browser crypto generator sits behind randInt, which randDie calls', [/getRandomValues/.test(w.randInt.toString()), /randInt\(6\)/.test(w.randDie.toString()), /getRandomValues|Math\.random/.test(w.randDie.toString())], [true, true, false]);
    // spy: the browser's crypto generator is what feeds it
    let calls = 0; const real = w.crypto.getRandomValues.bind(w.crypto);
    Object.defineProperty(w.crypto, 'getRandomValues', { configurable:true, value(b){ calls++; return real(b); } });
    for(let i=0;i<1000;i++) w.randDie();
    truthy('randDie draws from crypto.getRandomValues', calls >= 1000);
    // distribution of one die, and of what startRoll hands to rollDice
    const N = 60000, one = [0,0,0,0,0,0]; for(let i=0;i<N;i++) one[w.randDie()-1]++;
    const chi = (obs, exp) => obs.reduce((a,o,i) => a + (o-exp[i])*(o-exp[i])/exp[i], 0);
    const chiDie = chi(one, one.map(() => N/6));
    truthy('one die is uniform (chi-square '+chiDie.toFixed(1)+' on 5 d.f., limit 30)', chiDie < 30);
    const seen = []; w.rollDice = (a,b) => seen.push([a,b]);
    const M = 36000; for(let i=0;i<M;i++) w.startRoll();
    const pairs = Array(36).fill(0), sums = Array(11).fill(0); let same = 0;
    seen.forEach(([a,b]) => { pairs[(a-1)*6+(b-1)]++; sums[a+b-2]++; if(a===b) same++; });
    check('startRoll made one roll per call, each with two dice from 1 to 6', [seen.length, seen.every(([a,b]) => a>=1 && a<=6 && b>=1 && b<=6 && Number.isInteger(a) && Number.isInteger(b))], [M, true]);
    const chiPairs = chi(pairs, pairs.map(() => M/36));
    truthy('all 36 (die 1, die 2) pairs are equally likely (chi-square '+chiPairs.toFixed(1)+' on 35 d.f., limit 85)', chiPairs < 85);
    const WAYS = [1,2,3,4,5,6,5,4,3,2,1];
    const chiSums = chi(sums, WAYS.map(k => M*k/36));
    truthy('totals follow 1-2-3-4-5-6-5-4-3-2-1 over 36, because they are sums of two dice (chi-square '+chiSums.toFixed(1)+' on 10 d.f., limit 40)', chiSums < 40);
    truthy('doubles come up about 1 time in 6', Math.abs(same/M - 1/6) < 0.01);
    // the resolver is handed the two dice and adds them itself
    const w2 = load({}); turbo(w2); hit(w2,'pass'); w2.rollDice(2,5); await settle(w2);
    check('the total is computed from the two dice', [w2.G.last.d1, w2.G.last.d2, w2.G.last.sum], [2, 5, 7]);
    w.close(); w2.close();
  }

  // ======================================================== 24. the throw itself (jsdom has no Web Animations, so give it a stand-in)
  {
    const w = load({}); w.G.settings.sound = false; w.G.settings.keep = false;
    w.Element.prototype.animate = function(){ return { cancel(){}, finished:new Promise(r => setTimeout(r, 60)) }; };
    hit(w,'pass'); w.rollDice(3,4);
    await sleep(15);
    check('while the dice are in the air the read-out is empty', [$(w,'stage-total').children.length, $(w,'stage-total').classList.contains('show')], [0, false]);
    await settle(w);
    check('when they land the read-out pops in with 3 + 4 = 7', [readout(w), $(w,'stage-total').classList.contains('show')], [{ pips:[3,4], total:'7' }, true]);
    hit(w,'pass'); w.rollDice(1,2); await sleep(15);
    check('and is cleared again for the next throw (the old total never lingers)', $(w,'stage-total').children.length, 0);
    await settle(w);
    check('then shows 1 + 2 = 3', [readout(w), $(w,'stage-total').classList.contains('show')], [{ pips:[1,2], total:'3' }, true]);
    check('each throw tilts the dice a little differently, but always looks down on them', [w.PITCH, Math.abs(w.yaw[0]) < 40, Math.abs(w.yaw[1]) < 40], [-50, true, true]);
    w.close();
  }

  // ======================================================== 25. dice colors
  {
    const w = load({}); turbo(w);
    const felt = $(w,'felt'), keys = w.DICE_THEMES.map(t => t.key), css = [...w.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    const ticked = () => [...w.document.querySelectorAll('#dice-swatches [aria-checked="true"]')].map(b => b.getAttribute('data-dice'));
    check('seven dice colors, ivory first', [keys.length, keys[0], new Set(keys).size], [7, 'ivory', 7]);
    check('ivory to start: on the table, in the saved settings and in the picker', [felt.getAttribute('data-dice'), w.G.settings.dice, ticked(), w.document.querySelectorAll('#dice-swatches .dice-swatch').length], ['ivory', 'ivory', ['ivory'], 7]);
    const mids = keys.filter(k => k !== 'ivory').map(k => { const m = new RegExp('\\[data-dice="'+k+'"\\]\\{[^}]*--die-mid:(#[0-9A-Fa-f]{6})').exec(css); return m && m[1]; });
    check('every colour has its own face colour in the stylesheet, and no two match', [mids.every(Boolean), new Set(mids).size], [true, 6]);
    check('every colour also sets its pips', keys.filter(k => k !== 'ivory').every(k => new RegExp('\\[data-dice="'+k+'"\\]\\{[^}]*--pip-hi:').test(css)), true);
    check('the 3D dice and the flat read-out and hardway art all read the same colour variables', [/\.die \.face\{[^}]*var\(--die-mid\)/.test(css), /\.d2\{[^}]*var\(--die-mid\)/.test(css), /\.die \.face i\{[^}]*var\(--pip-hi\)/.test(css), /\.d2 i\{[^}]*var\(--pip-hi\)/.test(css)], [true, true, true, true]);
    check('the dice and the read-out sit inside the element that carries the colour', [felt.contains($(w,'die-0')), felt.contains($(w,'stage-total'))], [true, true]);
    check('the picker has a name on every swatch (for screen readers)', [...w.document.querySelectorAll('#dice-swatches .dice-swatch')].map(b => b.getAttribute('aria-label')), ['Ivory', 'Casino red', 'Royal blue', 'Emerald', 'Onyx', 'Gold', 'Violet']);
    click(w, w.document.querySelector('#dice-swatches [data-dice="red"]'));
    check('picking red recolours the table, is saved, and ticks only that swatch', [felt.getAttribute('data-dice'), w.G.settings.dice, JSON.parse(w.localStorage.getItem(K.sess)).settings.dice, ticked()], ['red', 'red', 'red', ['red']]);
    check('the button on the dice names the colour', $(w,'btn-dice').getAttribute('aria-label'), 'Dice color: Casino red. Tap to change.');
    click(w, $(w,'btn-dice'));
    check('the button on the dice goes to the next colour and says which', [w.G.settings.dice, felt.getAttribute('data-dice'), $(w,'table-msg').textContent, ticked()], ['blue', 'blue', 'Dice: Royal blue.', ['blue']]);
    const seen = [];
    for(let i=0;i<6;i++){ click(w, $(w,'btn-dice')); seen.push(w.G.settings.dice); }
    check('it cycles through every colour and wraps back to ivory', seen, ['green', 'onyx', 'gold', 'violet', 'ivory', 'red']);
    w.setDiceTheme('plaid', true);
    check('an unknown colour is ignored', [w.G.settings.dice, felt.getAttribute('data-dice')], ['red', 'red']);
    const grp = $(w,'dice-swatches');
    grp.dispatchEvent(new w.KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true, cancelable:true }));
    grp.dispatchEvent(new w.KeyboardEvent('keydown', { key:'ArrowLeft', bubbles:true, cancelable:true }));
    grp.dispatchEvent(new w.KeyboardEvent('keydown', { key:'ArrowLeft', bubbles:true, cancelable:true }));
    check('arrow keys move through the picker, and wrap', [w.G.settings.dice], ['ivory']);
    grp.dispatchEvent(new w.KeyboardEvent('keydown', { key:'ArrowLeft', bubbles:true, cancelable:true }));
    check('left from ivory wraps to violet', w.G.settings.dice, 'violet');
    check('only the ticked swatch is in the tab order', [...w.document.querySelectorAll('#dice-swatches .dice-swatch')].filter(b => b.tabIndex === 0).map(b => b.getAttribute('data-dice')), ['violet']);
    // the choice survives a reload, and the roll itself is untouched by it
    w.setDiceTheme('gold', false);
    const saved = JSON.parse(w.localStorage.getItem(K.sess));
    const w2 = load({ [K.sess]: saved });
    check('a saved colour comes back after a reload', [w2.G.settings.dice, w2.document.getElementById('felt').getAttribute('data-dice'), [...w2.document.querySelectorAll('#dice-swatches [aria-checked="true"]')].map(b => b.getAttribute('data-dice'))], ['gold', 'gold', ['gold']]);
    for(const bad of ['plaid', 7, null, ['red'], '', '__proto__', 'RED']){
      const w3 = load({ [K.sess]: { settings:{ dice:bad } } });
      check('a damaged saved colour ('+JSON.stringify(bad)+') falls back to ivory', [w3.G.settings.dice, w3.document.getElementById('felt').getAttribute('data-dice'), w3.errs], ['ivory', 'ivory', []]);
      w3.close();
    }
    const w4 = load({ [K.sess]: { settings:{ sound:false } } });
    check('no saved colour means ivory', w4.G.settings.dice, 'ivory');
    w4.close();
    // changing colour never changes the dice rolled or the money
    const w5 = load({}); turbo(w5); hit(w5,'pass'); w5.setDiceTheme('onyx', false);
    const before = [w5.G.bankroll, w5.G.table.bets.length];
    await roll(w5, 3, 4);
    check('a coloured die rolls exactly the same: 3 + 4 wins the Pass Line', [w5.G.last.d1, w5.G.last.d2, w5.G.bankroll, before], [3, 4, 1025 - 0, [975, 1]]);
    check('and the read-out keeps the colour', [w5.document.getElementById('felt').getAttribute('data-dice'), readout(w5)], ['onyx', { pips:[3,4], total:'7' }]);
    const noStore = load({}, { noStorage:true });
    noStore.setDiceTheme('green', true);
    check('without storage the colour still changes for the visit', [noStore.G.settings.dice, noStore.document.getElementById('felt').getAttribute('data-dice'), noStore.errs], ['green', 'green', []]);
    noStore.close();
    // changing the colour must repaint the 3D dice every time (some browsers keep drawing a 3D layer in its old colours)
    {
      const w6 = load({}); turbo(w6);
      const dies = [0,1].map(i => $(w6,'die-'+i)), disp = () => dies.map(d => d.style.display);
      const before = disp();
      for(const key of ['red', 'blue', 'onyx', 'ivory']){ w6.setDiceTheme(key, true); }
      check('changing the colour leaves both dice showing, and with their own display setting untouched', [disp(), before], [before, before]);
      for(const t of ['graphite', 'crimson', 'midnight', 'emerald']) w6.applyTheme(t);
      check('changing the table theme does the same', disp(), before);
      dies.forEach(d => w6.DIE_VARS.forEach(v => d.style.removeProperty(v)));
      w6.getComputedStyle = () => ({ getPropertyValue: n => n === '--die-mid' ? '#654321' : '' });
      w6.applyTheme('emerald');
      check('a new table theme re-spells the dice colours onto each die as well', dies.map(d => d.style.getPropertyValue('--die-mid')), ['#654321', '#654321']);
      dies.forEach(d => w6.DIE_VARS.forEach(v => d.style.removeProperty(v)));
      const asked = []; w6.getComputedStyle = el => ({ getPropertyValue: n => { asked.push(n); return n === '--die-mid' ? '  #123456 ' : (n === '--die-hi' ? '#abcdef' : ''); } });
      w6.repaintDice();
      check('the dice are given the colour the table is wearing, spelled out on each die itself', [dies.map(d => d.style.getPropertyValue('--die-mid')), dies.map(d => d.style.getPropertyValue('--die-hi')), dies.map(d => d.style.getPropertyValue('--pip-lo'))], [['#123456', '#123456'], ['#abcdef', '#abcdef'], ['', '']]);
      check('it reads every colour the dice use', w6.DIE_VARS.every(v => asked.includes(v)), true);
      const cssAll = [...w6.document.querySelectorAll('style')].map(x => x.textContent).join('\n');
      const usedVars = [...new Set((cssAll.match(/var\(--(?:die|pip|one)-[a-z]+\)/g) || []).map(v => v.slice(4, -1)))];
      check('...and that list is every colour variable the dice and their pips are painted with (none left out)', [usedVars.length >= 8, usedVars.filter(v => !w6.DIE_VARS.includes(v))], [true, []]);
      // a redraw really takes each die off the page for a moment and puts it back exactly as it was
      const styleBefore = dies.map(d => d.style.display), seenNone = [];
      const mo = new w6.MutationObserver(list => list.forEach(m => seenNone.push(m.oldValue || '')));
      dies.forEach(d => mo.observe(d, { attributes:true, attributeFilter:['style'], attributeOldValue:true }));
      w6.redrawDice(); await sleep(0);
      mo.disconnect();
      check('a redraw takes each die off the page for an instant and puts it back', [seenNone.some(v => /display:\s*none/.test(v)), dies.map(d => d.style.display)], [true, styleBefore]);
      await sleep(200);                                                 // let the repaints still queued by the changes above finish first
      let redraws = 0; const realRedraw = w6.redrawDice; w6.redrawDice = () => { redraws++; realRedraw(); };
      w6.setDiceTheme('gold', true);
      check('and each colour change forces a fresh paint of the dice at once', redraws, 1);
      for(let i = 0; i < 60 && redraws < 2; i++) await sleep(25);       // two frames (about 33ms, longer if the machine is busy)
      check('...and again once the browser has drawn two frames (and not more often than that)', redraws, 2);
      await sleep(100);
      check('...and then leaves the dice alone', redraws, 2);
      check('no errors from any of it', w6.errs, []);
      w6.close();
    }
    w.close(); w2.close(); w5.close();
  }

  // ======================================================== 26. after a 7 the stickman gathers the dice and sets them back in the middle
  {
    const w = load({}); w.G.settings.sound = false; w.G.settings.keep = false;
    const calls = [];
    w.Element.prototype.animate = function(kf, o){ calls.push({ id:this.id, kf, o }); return { cancel(){ this.cancelled = true; }, finished:new Promise(r => setTimeout(r, o.duration > 2000 ? 600 : 60)) }; };
    const show = () => $(w,'stickman').style.display, pos = i => $(w,'die-pos-'+i).style.transform;
    const sweepCalls = () => calls.filter(c => c.id === 'stickman' || c.id === 'sm-stick' || (c.id.startsWith('die-pos') && c.o.duration > 2000));
    const throwAt = i => calls.find(c => c.id === 'die-pos-'+i && c.o.duration === 1120).kf.map(f => tx(f.transform));
    const g = w.sweepGeom(), R = g.R, tx = s => parseFloat(/translateX\((-?[\d.]+)px\)/.exec(s)[1]);
    const stickOf = f => { const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) rotate\((-?[\d.]+)deg\)/.exec(f.transform); return { h:+m[1], dy:-m[2], rot:+m[3] }; };
    check('the stickman is hidden until a seven', show(), 'none');
    // geometry
    check('desktop: the dice rest a little apart and the hook starts between him and where they will be drawn to', [g.clip, g.xR, g.xG[1] + R + 2 <= g.h0, g.h0 < g.handX], [false, [-46, 46], true, true]);
    check('he can get round the dice: the hook starts behind (left of) the left die, with room, and the tip can lift', [g.hL + R + 2 < g.xR[0], g.tipBack > g.tipY + 20], [true, true]);
    check('the dice are drawn a real distance toward him, not a nudge', [g.xG[0] - g.xR[0] >= 60, g.xG[1] - g.xR[1] >= 60, g.xG[1] - g.xG[0]], [true, true, 92]);
    check('and the dice never touch each other on the way (rest spacing is wider than the dice)', g.sp >= 2*R + g.gap, true);
    check('the hook ends up just behind the dice once they are back at rest', [g.h1, g.hP], [46 + R + 2, g.xG[0] - R - 2]);
    check('the stick is long enough to stay in his hand at its farthest reach', g.len > g.handX - Math.min(g.hL, g.h1), true);
    check('he starts off the stage and has to travel in', g.off >= g.fw + 20, true);
    w.rollDice(3,4);
    await sleep(25);
    check('while the dice are in the air there is no stickman', [show(), sweepCalls().length], ['none', 0]);
    await sleep(120);
    check('a seven comes down exactly like any other roll: the same throw, the same resting place, nothing to give it away', [throwAt(0), throwAt(1), tx(pos(0)), tx(pos(1))], [[240, -46], [290, 46], -46, 46]);
    check('the roll is shown (3 + 4 = 7) and only then does he come on', [readout(w), show(), !!w.sweep], [{ pips:[3,4], total:'7' }, '', true]);
    const sw = sweepCalls(), byId = id => sw.find(c => c.id === id);
    check('four things move together: him, his stick and both dice, over the same time', [sw.length, [...new Set(sw.map(c => c.o.duration))].length, sw.map(c => c.id).sort()], [4, 1, ['die-pos-0', 'die-pos-1', 'sm-stick', 'stickman']]);
    const T = sw[0].o.duration, kfs = byId('stickman').kf, N = kfs.length;
    check('a long, smooth routine (several seconds, a frame every ~40ms, in order, from 0 to 1)', [T >= 3500 && T <= 6000, N >= 80, kfs[0].offset, kfs[N-1].offset, kfs.every((f, i, a) => !i || f.offset > a[i-1].offset)], [true, true, 0, 1, true]);
    const fx = kfs.map(f => tx(f.transform)), st = byId('sm-stick').kf.map(stickOf), p0 = byId('die-pos-0').kf.map(f => tx(f.transform)), p1 = byId('die-pos-1').kf.map(f => tx(f.transform));
    const hk = st.map(s => s.h), dy = st.map(s => s.dy);
    check('he waits a moment, slides in from off-stage, stands at the table, and leaves again', [fx[0] === g.off, fx[1] === g.off, fx[N-1] === g.off, Math.min(...fx), fx.slice(Math.round(N*0.2), Math.round(N*0.8)).every(v => v === 0)], [true, true, true, 0, true]);
    check('the dice begin and end at their resting places', [p0[0], p1[0], p0[N-1], p1[N-1]], [-46, 46, -46, 46]);
    const iMove = p0.findIndex((v, i) => v !== -46 || p1[i] !== 46);
    check('they stay put until the hook is down on the table behind them, with him already in place', [iMove > 10, fx[iMove], dy[iMove], hk[iMove] + R + 2 >= -46 - 0.4], [true, 0, 0, true]);
    check('they are drawn all the way over to him', [Math.max(...p0), Math.max(...p1)], [g.xG[0], g.xG[1]]);
    const iMax = p1.indexOf(Math.max(...p1));
    check('one trip out and one trip back, never a wobble (rises, then falls)', [p1.slice(0, iMax + 1).every((v, i, a) => !i || v >= a[i-1]), p1.slice(iMax).every((v, i, a) => !i || v <= a[i-1]), p0.slice(0, iMax + 1).every((v, i, a) => !i || v >= a[i-1]), p0.slice(iMax).every((v, i, a) => !i || v <= a[i-1])], [true, true, true, true]);
    check('the dice are never inside each other (always at least the resting gap apart)', p0.every((v, i) => p1[i] - v >= g.sp - 0.3), true);
    check('the dice only move while the hook is down on the table (never while it is lifted)', p0.every((v, i) => !i || Math.abs(v - p0[i-1]) < 0.05 || dy[i] <= 3.5) && p1.every((v, i) => !i || Math.abs(v - p1[i-1]) < 0.05 || dy[i] <= 3.5), true);
    check('with the hook down it is never inside a die: it stays to the left of the left die or to the right of the right one', hk.every((h, i) => dy[i] > 3.5 || h <= p0[i] - R - 2 + 0.3 || h >= p1[i] + R + 2 - 0.3), true);
    check('he draws the dice with the hook on their left, then pushes them back with it on their right', [hk.some((h, i) => dy[i] <= 3.5 && p0[i] > -46 + 5 && Math.abs(h - (p0[i] - R - 2)) < 0.4 && i < iMax), hk.some((h, i) => dy[i] <= 3.5 && p1[i] < g.xG[1] - 5 && Math.abs(h - (p1[i] + R + 2)) < 0.4 && i > iMax)], [true, true]);
    const over = (i) => dy[i] >= 25 && hk[i] > p0[i] - R && hk[i] < p1[i] + R;
    check('the hook lifts to go behind the dice, twice: out to the left before they are drawn, and back across before they are pushed', [hk.some((h, i) => i < iMax && over(i)), hk.some((h, i) => i > iMax && i < N && over(i))], [true, true]);
    check('the stick always points at his hand (rotation on every frame, and never steep)', st.every(s => Math.abs(s.rot) < 25), true);
    check('he finishes with the hook back where it started', [hk[0], hk[N-1], dy[0], dy[N-1]], [g.h0, g.h0, 0, 0]);
    await settle(w);
    check('he does not hold up the table: the next roll is allowed while he is still moving', [w.G.phase, !!w.sweep], ['betting', true]);
    await sleep(700);
    check('when he finishes he is gone and the dice rest exactly where they started', [show(), !!w.sweep, tx(pos(0)), tx(pos(1)), w.errs], ['none', false, -46, 46, []]);
    check('the read-out still shows the seven', readout(w), { pips:[3,4], total:'7' });

    // every way to make 7 brings him out; nothing else does
    for(const [a, b] of [[1,6],[2,5],[3,4],[4,3],[5,2],[6,1]]){
      calls.length = 0; w.rollDice(a, b); await sleep(140);
      check('a '+a+' + '+b+' brings the stickman, after a throw identical to every other', [show(), sweepCalls().length, throwAt(0), throwAt(1)], ['', 4, [240, -46], [290, 46]]);
      await settle(w); await sleep(700);
    }
    for(const [a, b] of [[1,1],[1,2],[2,3],[3,3],[4,6],[5,6],[6,6],[2,6],[3,5],[4,4]]){
      calls.length = 0; w.rollDice(a, b); await sleep(120);
      const th = [throwAt(0), throwAt(1)];
      await settle(w);
      check('a '+a+' + '+b+' = '+(a+b)+' has the same throw and no stickman', [th, show(), sweepCalls().length, [tx(pos(0)), tx(pos(1))]], [[[240, -46], [290, 46]], 'none', 0, [-46, 46]]);
    }

    // a new roll cancels him cleanly and a late finish cannot move the new dice
    calls.length = 0; w.rollDice(2,5); await settle(w);
    check('rolling again while he is out: he is there', [show(), !!w.sweep], ['', true]);
    const old = w.sweep; w.rollDice(1,2); await sleep(30);
    check('the new roll sends him away at once and cancels his moves', [show(), w.sweep, old.anims.every(a => a.cancelled)], ['none', null, true]);
    await settle(w); await sleep(700);
    check('and his old timer cannot disturb the new dice', [tx(pos(0)), tx(pos(1)), show()], [-46, 46, 'none']);

    // a second seven rolled while the first sweep is still finishing keeps its own sweep (the first one's late finish must not end it)
    calls.length = 0; w.rollDice(1,6); await settle(w);
    w.rollDice(2,5); await sleep(160);
    check('two sevens in a row: the second sweep is running', [show(), !!w.sweep], ['', true]);
    await sleep(400);
    check('and the first one finishing late does not cut it short', [show(), !!w.sweep], ['', true]);
    await settle(w); await sleep(700);
    check('it then finishes normally', [show(), !!w.sweep, tx(pos(0)), tx(pos(1))], ['none', false, -46, 46]);

    // resizing mid-sweep
    w.rollDice(6,1); await settle(w);
    check('(a 6 + 1 brings him again, and he is still out when the table reopens)', show(), '');
    w.showLastDice();
    check('redrawing the dice mid-sweep ends it and puts them at rest', [show(), w.sweep, tx(pos(0)), tx(pos(1))], ['none', null, -46, 46]);
    await sleep(700);
    check('and nothing is left running afterwards', [show(), w.errs], ['none', []]);

    // switching turbo or reduced motion on while the dice are in the air still skips him
    w.G.settings.turbo = false; calls.length = 0;
    w.rollDice(3,4); await sleep(20); w.G.settings.turbo = true; await settle(w); await sleep(30);
    check('turbo switched on mid-throw: no stickman, dice at rest', [show(), sweepCalls().length, !!w.sweep, tx(pos(0)), tx(pos(1))], ['none', 0, false, -46, 46]);
    w.G.settings.turbo = false; calls.length = 0; w.reducedMotion = false;
    w.rollDice(2,5); await sleep(20); w.reducedMotion = true; await settle(w); await sleep(30);
    check('reduced motion switched on mid-throw: no stickman, dice at rest', [show(), sweepCalls().length, !!w.sweep, tx(pos(0)), tx(pos(1))], ['none', 0, false, -46, 46]);
    w.reducedMotion = false;
    // turbo and reduced motion from the start
    w.G.settings.turbo = true; calls.length = 0;
    await roll(w, 3, 4);
    check('turbo: no stickman', [show(), sweepCalls().length, tx(pos(0)), tx(pos(1))], ['none', 0, -46, 46]);
    w.G.settings.turbo = false; w.reducedMotion = true; calls.length = 0;
    await roll(w, 2, 5);
    check('reduced motion: no stickman', [show(), sweepCalls().length, tx(pos(0)), tx(pos(1))], ['none', 0, -46, 46]);
    w.reducedMotion = false;
    const w2 = load({ [K.hand]: w.localStorage.getItem(K.hand) });
    check('after a reload a seven looks like any other roll: dice at rest, no stickman', [tx($(w2,'die-pos-0').style.transform), tx($(w2,'die-pos-1').style.transform), w2.document.getElementById('stickman').style.display], [-46, 46, 'none']);
    w2.close();
    // phone width: only his arm reaches in, and there is still room for the whole routine
    Object.defineProperty(w, 'innerWidth', { value:375, configurable:true });
    const gp = w.sweepGeom();
    check('phone geometry: arm only; dice rest at +/-36; hook starts behind the left die; they are drawn a visible distance', [gp.clip, gp.xR, gp.hL + gp.R + 2 < gp.xR[0], gp.xG[0] - gp.xR[0] >= 25, gp.xG[1] - gp.xR[1] >= 25], [true, [-36, 36], true, true, true]);
    check('phone: the hook and hand stay inside the stage so the stick is seen entering', [gp.xG[1] + gp.R + 2 <= gp.h0, gp.h0 < gp.handX, gp.h0 < gp.hw - 20, gp.handX < gp.hw], [true, true, true, true]);
    check('phone: the resting gap is wider than the dice, so they never touch', gp.sp >= 2*gp.R + gp.gap, true);
    check('phone: the lowered hook clears the Keep toggle and the lifted stick clears the read-out', [gp.tipY - 22 > 44, 196 - gp.tipBack > 70], [true, true]);
    check('phone: the stick is long enough', gp.len > gp.handX - Math.min(gp.hL, gp.h1), true);
    check('desktop: the lifted stick clears the read-out', 214 - g.tipBack > 70, true);
    w.close();
  }

  // ======================================================== 27. setting the dice by hand: drag a die to place it, tap it to turn it (looks only; the roll is untouched)
  {
    const mk = () => { const w = load({}); w.G.settings.sound = false; w.G.settings.keep = false; w.requestAnimationFrame = () => 0; return w; };   // the physics is stepped by hand (advanceMotion), so a test controls time
    const ptr = (w, el, type, x, y, o) => {
      o = o || {};
      const init = Object.assign({ bubbles:true, cancelable:true, clientX:x, clientY:y, button:0, buttons:type === 'pointerup' ? 0 : 1, pointerId:o.id === undefined ? 1 : o.id, pointerType:o.type || 'mouse' }, o.init || {});
      const ev = new w.PointerEvent(type, init); el.dispatchEvent(ev); return ev;
    };
    // a little kit for one page
    const kit = w => {
      const k = {};
      k.M = () => w.setMetrics();
      k.face = i => $(w,'die-'+i).querySelector('.f1');
      k.at = i => { const s = $(w,'die-pos-'+i).style.transform; let m = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/.exec(s); if(m) return { x:+m[1], y:+m[2] }; m = /translateX\(\s*(-?[\d.]+)px\s*\)/.exec(s); return m ? { x:+m[1], y:0 } : null; };
      k.spin = i => $(w,'die-'+i).style.transform;
      k.hop = i => $(w,'die-pos-'+i).querySelector('.die-hop').style.transform;
      k.shadow = i => $(w,'die-pos-'+i).querySelector('.die-shadow');
      k.down = (i, x, y, o) => ptr(w, k.face(i), 'pointerdown', x, y, o);
      k.move = (i, x, y, o) => { const e = ptr(w, k.face(i), 'pointermove', x, y, o); w.advanceMotion(800); return e; };      // and the dice have caught up with the pointer
      k.up = (i, x, y, o) => { const e = ptr(w, k.face(i), 'pointerup', x, y, o); w.advanceMotion(1500); return e; };         // and have dropped, bounced and settled
      k.tap = (i, o) => { k.down(i, 100, 100, o); k.up(i, 100, 100, o); };
      k.drag = (i, dx, dy, o) => { k.down(i, 300, 300, o); k.move(i, 300 + dx, 300 + dy, o); k.up(i, 300 + dx, 300 + dy, o); };
      k.ell = () => { const a = k.at(0), b = k.at(1), M = k.M(), nx = (a.x - b.x)/M.ax, ny = (a.y - b.y)/M.ay; return nx*nx + ny*ny; };
      k.held = i => $(w,'die-pos-'+i).classList.contains('held');
      k.locked = () => $(w,'dice-stage').classList.contains('locked');
      k.wall = () => $(w,'dice-stage').classList.contains('hand');
      k.faces = () => w.shownFace.slice();
      k.rot = v => w.rotStr(w.ORIENT[v]);
      return k;
    };

    // ---- 27a. tap to turn, drag to move, on a table that is not rolling
    {
      const w = mk(), k = kit(w), M = k.M();
      const css = [...w.document.querySelectorAll('style')].map(s => s.textContent).join('\n');
      const touchAct = css.match(/[^{}]*\{[^}]*touch-action:[^}]*\}/g) || [];
      check('touch-action is only ever set on the dice themselves, so the page still scrolls everywhere else', [touchAct.length, touchAct.every(r => /\.die-pos/.test(r.split('{')[0]))], [2, true]);
      check('a die shows a grab hand, and the dice have a hint for the mouse', [/\.die-pos\{[^}]*cursor:grab;/.test(css), /\.die-pos\.held\{cursor:grabbing/.test(css), $(w,'die-pos-0').title.length > 10, $(w,'die-pos-0').title === $(w,'die-pos-1').title], [true, true, true, true]);
      check('the hint pill sits under the dice, and fades out while they are in the air', [/\.shoot-hint\{[^}]*z-index:1;/.test(css), /\.dice-stage\.hand\.flying \.shoot-hint\{opacity:0;\}/.test(css)], [true, true]);
      check('metrics: the tray is wider than the dice, the dice can move a little down and a good way up', [M.ax, M.ay, M.xmin < -300, M.xmax > 300, M.ymax, M.ymin < -50], [82, 47, true, true, 22, true]);
      check('metrics: the wall stands one cube-width (as wide as a die looks when turned) in from its own face, so a die held against it never pokes into it', [M.wallW, M.wallX, M.xhand, M.wallX + M.R + 2 + M.wallW === M.W / 2], [22, 365, 363, true]);
      check('fresh table: the dice rest showing 4 and 3, nothing set, nothing locked', [k.at(0), k.at(1), k.faces(), w.hasSet(), k.locked()], [{ x:-46, y:0 }, { x:46, y:0 }, [4, 3], false, false]);
      const before = snapshot(w), lastBefore = JSON.stringify(w.G.last), bankBefore = w.G.bankroll;

      w.renderReadout(4, 3, false);
      check('(a read-out of the last roll is showing)', $(w,'stage-total').children.length, 1);
      $(w,'dice-stage').classList.add('settle-pop');
      k.tap(0);
      check('touching a die ends the landing nudge, which would otherwise hold its place for a moment', $(w,'dice-stage').classList.contains('settle-pop'), false);
      check('a tap turns the die to the next number and shows it on top', [k.faces(), k.spin(0) === k.rot(5), k.spin(1) === k.rot(3)], [[5, 3], true, true]);
      check('and the read-out of the last roll goes away, since the dice no longer show it', $(w,'stage-total').children.length, 0);
      check('that die is now "set" where it was, and the other one is untouched', [k.at(0), w.setup.pos[0], w.setup.pos[1], w.hasSet()], [{ x:-46, y:0 }, { x:-46, y:0 }, null, true]);
      check('nothing is held after a tap', [k.held(0), k.held(1), w.setup.drag[0], w.setup.drag[1]], [false, false, null, null]);
      for(const v of [6, 1, 2, 3, 4]){ k.tap(0); check('another tap goes to '+v+' (and wraps from 6 to 1)', k.faces()[0], v); }
      k.tap(0, { init:{ shiftKey:true } });
      check('Shift-click turns it back the other way', k.faces(), [3, 3]);
      k.down(0, 100, 100, { init:{ button:2 } });
      check('a right-click turns it back too, and starts no drag', [k.faces(), w.setup.drag[0]], [[2, 3], null]);
      const cm = new w.MouseEvent('contextmenu', { bubbles:true, cancelable:true }); k.face(0).dispatchEvent(cm);
      const cm2 = new w.MouseEvent('contextmenu', { bubbles:true, cancelable:true }); $(w,'felt').dispatchEvent(cm2);
      check('the right-click menu is held back over a die but nowhere else', [cm.defaultPrevented, cm2.defaultPrevented], [true, false]);
      k.down(0, 100, 100, { init:{ button:1 } }); k.up(0, 100, 100, { init:{ button:1 } });
      check('the middle button does nothing', [k.faces(), w.setup.drag[0]], [[2, 3], null]);
      // slop: a mouse wiggle of a few pixels is still a tap
      k.down(1, 100, 100); k.move(1, 103, 102); k.up(1, 103, 102);
      check('a 3 pixel wiggle with the mouse is still a tap: it turns, and does not move', [k.faces(), k.at(1)], [[2, 4], { x:46, y:0 }]);
      k.down(1, 100, 100, { type:'touch', id:5 }); k.move(1, 107, 103, { type:'touch', id:5 }); k.up(1, 107, 103, { type:'touch', id:5 });
      check('a finger needs a wider berth: 7 pixels is still a tap', [k.faces(), k.at(1)], [[2, 5], { x:46, y:0 }]);
      k.down(1, 100, 100, { type:'touch', id:5 }); k.move(1, 112, 103, { type:'touch', id:5 });
      check('and 12 pixels is a drag', [k.held(1), k.at(1).x > 46], [true, true]);
      k.up(1, 112, 103, { type:'touch', id:5 });

      // a real drag
      w.showDice(4, 3, false);
      check('putting the dice back clears what was set', [w.hasSet(), k.at(0), k.at(1), k.faces(), k.spin(0) === k.rot(4)], [false, { x:-46, y:0 }, { x:46, y:0 }, [4, 3], true]);
      w.renderReadout(4, 3, false);
      let lifts = 0, drops = 0, turns = 0; w.sfxLift = () => lifts++; w.sfxDrop = () => drops++; w.sfxTurn = () => turns++;
      k.down(0, 200, 200);
      check('pressing on a die does not lift it yet', [k.held(0), k.at(0)], [false, { x:-46, y:0 }]);
      k.move(0, 170, 185);
      check('dragging lifts the die: it rises, its shadow shrinks and fades, and it follows the pointer', [k.held(0), k.hop(0), k.shadow(0).style.transform, k.shadow(0).style.opacity, k.at(0), lifts], [true, 'translateY(-18px)', 'scale(0.8)', '0.6', { x:-76, y:-15 }, 1]);
      check('the other die has not moved', [k.at(1), k.held(1)], [{ x:46, y:0 }, false]);
      check('the read-out of the last roll goes away once you pick the dice up', $(w,'stage-total').children.length, 0);
      k.move(0, 120, 190);
      check('it keeps following (not a one-off jump)', k.at(0), { x:-126, y:-10 });
      k.up(0, 120, 190);
      check('letting go sets it down: no longer held, back on the felt, full shadow, one drop sound, same number up', [k.held(0), k.hop(0), k.shadow(0).style.transform, k.shadow(0).style.opacity, drops, k.faces()[0], k.at(0)], [false, 'translateY(0px)', 'scale(1)', '1', 1, 4, { x:-126, y:-10 }]);
      check('the one nearer you is drawn in front', [$(w,'die-pos-0').style.zIndex, $(w,'die-pos-1').style.zIndex], ['2', '3']);
      k.drag(1, -10, -40);
      check('move the other further back and the first comes to the front', [k.at(1), $(w,'die-pos-0').style.zIndex, $(w,'die-pos-1').style.zIndex], [{ x:36, y:-40 }, '3', '2']);
      check('a drag makes no turn sound, a tap makes no drop sound', [turns, drops, lifts], [0, 2, 2]);
      k.tap(1);
      check('tapping a die that was moved turns it where it sits', [k.at(1), k.faces()[1], turns, drops], [{ x:36, y:-40 }, 4, 1, 2]);
      check('all of this is looks only: nothing is saved, the last roll and the bankroll are untouched', [JSON.stringify(snapshot(w)) === JSON.stringify(before), JSON.stringify(w.G.last), w.G.bankroll], [true, lastBefore, bankBefore]);

      // clamps
      w.showDice(4, 3, false);
      k.drag(0, -5000, -5000); k.drag(1, 5000, 5000);
      check('the dice stop at the edges of the tray (left/back and right/front)', [k.at(0), k.at(1)], [{ x:M.xmin, y:M.ymin }, { x:M.xmax, y:M.ymax }]);
      check('which leaves room to see them: back row clear of the top, front row above the bottom', [M.ymin >= -(214 - 44 - 85 - 14) - 0.01, M.ymax <= 44 - 14 - 8], [true, true]);
      // dragging one die toward the other: a gentle push stops at it; round the back is fine; pushing well into it picks both up (see 29)
      w.showDice(4, 3, false);
      k.drag(0, 40, 0);
      check('a die pushed gently up to the other one stops at it (their spacing is the full width of a die)', [k.at(0), k.ell() >= 0.999, k.at(1), w.hasHand()], [{ x:-36.3, y:0 }, true, { x:46, y:0 }, false]);
      w.showDice(4, 3, false);
      k.down(0, 300, 300); k.move(0, 300, 240);
      check('a die can be taken round the back of the other one: up first...', [k.at(0), w.hasHand()], [{ x:-46, y:-60 }, false]);
      k.move(0, 700, 240);
      check('...and across, with the tray deep enough to pass behind it', [k.ell() >= 0.999, k.at(0), w.hasHand()], [true, { x:354, y:-60 }, false]);
      k.up(0, 700, 240);
      check('and put down on the far side of it', [k.at(0), k.at(1), k.ell() >= 0.999], [{ x:354, y:-60 }, { x:46, y:0 }, true]);
      // the die is dragged by the pointer that picked it up, not by any other
      w.showDice(4, 3, false);
      k.down(0, 100, 100, { id:7 }); k.move(0, 160, 100, { id:8 }); k.move(0, 70, 100, { id:7 });
      check('moves from another pointer are ignored', k.at(0), { x:-76, y:0 });
      k.up(0, 70, 100, { id:8 });
      check('and so is another pointer letting go', [k.held(0), w.setup.drag[0] !== null], [true, true]);
      k.up(0, 70, 100, { id:7 });
      check('only its own pointer lets go of it', [k.held(0), w.setup.drag[0]], [false, null]);
      // two fingers, two dice
      w.showDice(4, 3, false);
      k.down(0, 100, 100, { id:1, type:'touch' }); k.down(1, 400, 100, { id:2, type:'touch' });
      k.move(0, 60, 80, { id:1, type:'touch' }); k.move(1, 450, 120, { id:2, type:'touch' });
      check('two fingers move the two dice at once, each with its own', [k.held(0), k.held(1), k.at(0), k.at(1)], [true, true, { x:-86, y:-20 }, { x:96, y:20 }]);
      k.up(0, 60, 80, { id:1, type:'touch' });
      check('one lets go, the other is still held', [k.held(0), k.held(1)], [false, true]);
      k.up(1, 450, 120, { id:2, type:'touch' });
      check('then both are down', [k.held(0), k.held(1), w.setup.drag[0], w.setup.drag[1]], [false, false, null, null]);
      // cancel and blur
      w.showDice(4, 3, false); drops = 0; turns = 0;
      k.down(0, 100, 100); k.move(0, 50, 100); ptr(w, k.face(0), 'pointercancel', 50, 100); w.advanceMotion(1500);
      check('a cancelled drag (the browser took the touch) puts the die down where it was', [k.held(0), w.setup.drag[0], k.at(0), drops, turns], [false, null, { x:-96, y:0 }, 1, 0]);
      k.down(0, 100, 100); ptr(w, k.face(0), 'pointercancel', 100, 100);
      check('a cancelled press that never moved turns nothing', [k.faces(), turns, w.setup.pos[0] !== null], [[4, 3], 0, true]);
      k.down(1, 100, 100); k.move(1, 150, 100);
      w.dispatchEvent(new w.Event('blur')); w.advanceMotion(1500);
      check('losing the window mid-drag puts the die down too', [k.held(1), w.setup.drag[1], k.at(1)], [false, null, { x:96, y:0 }]);
      k.move(1, 300, 100);
      check('and later pointer moves are not followed', k.at(1), { x:96, y:0 });
      w.close();
      // the pointer is claimed while a die is held, and let go of after
      const wc = mk(), kc = kit(wc), cap = [];
      wc.Element.prototype.setPointerCapture = function(id){ cap.push(['set', id, this.id]); };
      wc.Element.prototype.releasePointerCapture = function(id){ cap.push(['release', id, this.id]); };
      const ls = { add:[], del:[] }, realAdd = wc.addEventListener, realDel = wc.removeEventListener;
      wc.addEventListener = function(t, f, o){ if(/^pointer/.test(t)) ls.add.push(t); return realAdd.call(this, t, f, o); };
      wc.removeEventListener = function(t, f, o){ if(/^pointer/.test(t)) ls.del.push(t); return realDel.call(this, t, f, o); };
      const press = kc.down(0, 100, 100, { id:9 }); kc.move(0, 40, 100, { id:9 }); kc.up(0, 40, 100, { id:9 });
      check('the page listens for the pointer only while a die is held: three listeners on the way in, the same three removed at the end', [ls.add.sort(), ls.del.sort()], [['pointercancel', 'pointermove', 'pointerup'], ['pointercancel', 'pointermove', 'pointerup']]);
      wc.addEventListener = realAdd; wc.removeEventListener = realDel;
      check('pressing a die claims the pointer (so a drag follows it off the die and out of the tray) and lets go at the end; the press is not left to scroll or select', [press.defaultPrevented, cap], [true, [['set', 9, 'die-pos-0'], ['release', 9, 'die-pos-0']]]);
      // ...and the same when the pair is picked up in one hand
      const wh = mk(), kh = kit(wh), caph = [];
      wh.Element.prototype.setPointerCapture = function(id){ caph.push(['set', id, this.id]); };
      wh.Element.prototype.releasePointerCapture = function(id){ caph.push(['release', id, this.id]); };
      kh.down(0, 100, 100, { id:9 }); kh.move(0, 160, 100, { id:9 }); kh.up(0, 160, 100, { id:9 });
      check('picking up both dice keeps the one pointer, and lets go of it when the hand opens (once)', caph, [['set', 9, 'die-pos-0'], ['release', 9, 'die-pos-0']]);
      wh.close();
      truthy('the how-it-works list explains setting the dice and says the roll is still random', [...wc.document.querySelectorAll('li')].some(li => /Setting the dice/.test(li.textContent) && /fresh random dice/.test(li.textContent) && /turn/.test(li.textContent)));
      wc.close();
    }

    // ---- 27a2. the two buttons on the tray (colour, keep-bets) are obstacles: a die slides along them, never under them
    {
      const w = mk(), k = kit(w);
      const stub = (id, l, t, wd, ht) => { const el = $(w, id); for(const [key, v] of Object.entries({ offsetLeft:l, offsetTop:t, offsetWidth:wd, offsetHeight:ht })) Object.defineProperty(el, key, { value:v, configurable:true }); };
      stub('btn-dice', 10, 10, 46, 46); stub('btn-keep', 690, 176, 160, 28);
      const M = k.M(), hits = p => w.hitsButton(p, k.M());
      check('both buttons count as obstacles, with a little margin', M.obst, [{ l:6, t:6, r:60, b:60 }, { l:686, t:172, r:854, b:208 }]);
      check('the dice at rest are clear of them', [hits(k.at(0)), hits(k.at(1))], [false, false]);
      k.drag(0, -5000, -5000);
      check('dragged into the top-left corner, under the colour button, the die slides round it', [hits(k.at(0)), k.at(0).x > M.xmin || k.at(0).y > M.ymin], [false, true]);
      k.drag(1, 5000, 5000);
      check('dragged into the bottom-right corner, under the Keep toggle, the die stays clear of it', [hits(k.at(1)), k.at(1).x < M.xmax || k.at(1).y < M.ymax], [false, true]);
      let bad = [];
      w.showDice(4, 3, false);
      k.down(0, 300, 300);
      for(let x = -450; x <= 450; x += 25) for(const y of [-120, -60, -20, 40]) { k.move(0, 300 + x, 300 + y); if(hits(k.at(0)) || k.ell() < 0.999) bad.push([x, y, k.at(0)]); }
      k.up(0, 0, 0);
      check('sweeping a die across the whole tray at four depths: never under a button, never into the other die', bad.slice(0, 3), []);
      // a button that is not showing is no obstacle
      stub('btn-dice', 10, 10, 0, 0);
      check('a button that is hidden is not in the way', k.M().obst.length, 1);
      w.close();
    }

    // ---- 27b. the throw starts from where the dice were set, and the roll never looks at them
    {
      const w = mk(), k = kit(w);
      const calls = [];
      w.Element.prototype.animate = function(kf, o){ calls.push({ id:this.id, cls:this.className, kf, o, el:this }); return { cancel(){ this.cancelled = true; }, finished:new Promise(r => setTimeout(r, o.duration > 2000 ? 600 : (o.duration === 1120 ? 200 : 60))) }; };
      const throwOf = (id, cls) => calls.find(c => c.id === id && c.o.duration === 1120 && (!cls || c.cls === cls));
      const hopOf = i => calls.find(c => c.cls === 'die-hop' && c.el === $(w,'die-pos-'+i).querySelector('.die-hop') && c.o.duration === 1120);
      const ang = s => /rotateX\((-?[\d.]+)deg\) rotateY\((-?[\d.]+)deg\) rotateZ\((-?[\d.]+)deg\)/.exec(s).slice(1).map(Number);
      const same = (a, b) => a.every((v, j) => ((v - b[j]) % 360 + 360) % 360 === 0);
      // animations used by taps and drags
      k.tap(0);
      const turn = calls.find(c => c.id === 'die-0');
      check('a tap tumbles the die from the old number to the new one in a quarter of a second', [turn.kf.map(f => f.transform), turn.o.duration], [[k.rot(4), k.rot(5)], 260]);
      const turnHop = calls.find(c => c.cls === 'die-hop' && c.o.duration === 260), turnShadow = calls.find(c => c.cls === 'die-shadow' && c.o.duration === 260);
      check('...hopping a little as it turns, with its shadow shrinking and fading as it goes up', [!!turnHop, !!turnShadow, turnHop && turnHop.kf.map(f => f.transform), turnShadow && turnShadow.kf[1].opacity < 1], [true, true, ['translateY(0px)', 'translateY(-14.4px)', 'translateY(0px)'], true]);
      calls.length = 0;
      let heights = [], drops2 = 0; w.sfxDrop = () => drops2++;
      k.down(1, 300, 300); k.move(1, 360, 270);
      check('while a die is held it is lifted by the physics, not by an animation', [calls.filter(c => c.cls === 'die-hop' || c.cls === 'die-shadow').length, k.hop(1)], [0, 'translateY(-18px)']);
      ptr(w, k.face(1), 'pointerup', 360, 270);
      for(let t=0; t<60; t++){ w.advanceMotion(10); heights.push(w.bodies[1].z); }
      const peak = Math.max(...heights), firstLand = heights.findIndex((h, j) => j > 0 && h === 0);
      check('letting go drops the die from the lifted height, it lands, and bounces up a little once or twice before it stops', [heights[0] < 18, firstLand > 5 && firstLand < 20, Math.max(...heights.slice(firstLand)) > 1, Math.max(...heights.slice(firstLand)) < 9, heights[heights.length - 1]], [true, true, true, true, 0]);
      check('it makes one drop sound however many times it bounces, and a draw-back of the shadow while it is up', [drops2, k.shadow(1).style.transform, k.shadow(1).style.opacity], [1, 'scale(1)', '1']);
      w.reducedMotion = true; calls.length = 0;
      k.tap(0); k.drag(1, -20, 10);
      check('with reduced motion there is no tumble and no bounce, but it all still works', [calls.length, k.faces()[0], k.at(1).x, w.bodies[1].z], [0, 6, 86, 0]);
      w.showDice(4, 3, false);
      k.down(1, 300, 300); ptr(w, k.face(1), 'pointermove', 380, 300); w.advanceMotion(10);
      check('with reduced motion a held die is at the pointer at once, lifted, with no spring and no lean', [k.at(1).x, w.bodies[1].z, w.bodies[1].lean, w.bodies[1].vx], [126, w.setMetrics().lift, 0, 0]);
      ptr(w, k.face(1), 'pointerup', 380, 300); w.advanceMotion(10);
      check('...and set down the moment it is let go, with no fall', [w.bodies[1].z, k.at(1).x], [0, 126]);
      w.advanceMotion(1500);
      w.reducedMotion = false;
      w.showDice(4, 3, false);

      // set die 0 to a 6 away from the middle and leave die 1 alone
      k.tap(0); k.tap(0);
      k.drag(0, -74, -30);
      check('die 0 is set to a 6, back and to the left; die 1 is still where it was', [k.faces(), k.at(0), k.at(1), w.hasSet()], [[6, 3], { x:-120, y:-30 }, { x:46, y:0 }, true]);
      const yaw0 = w.yaw[0], yaw1 = w.yaw[1];
      calls.length = 0;
      w.rollDice(2, 4);
      await sleep(25);
      const p0 = throwOf('die-pos-0'), p1 = throwOf('die-pos-1'), s0 = throwOf('die-0'), s1 = throwOf('die-1');
      check('the die you set is thrown from where you put it and lands in the usual place', p0.kf.map(f => f.transform), ['translate(-120px,-30px)', 'translate(-46px,0px)']);
      check('the other die comes in from the side exactly as before', p1.kf.map(f => f.transform), ['translateX(290px)', 'translateX(46px)']);
      check('the set die begins the throw still showing the 6 you left it on, and ends on the 2 that was rolled', [same(ang(s0.kf[0].transform), w.ORIENT[6]), s0.kf[s0.kf.length - 1].transform], [true, k.rot(2)]);
      check('it spins a good way in between (never just slides)', s0.kf.slice(0, -1).some(f => ang(f.transform).some((v, j) => Math.abs(v - w.ORIENT[2][j]) >= 270)), true);
      check('the other die starts the throw showing its final number, as always', [same(ang(s1.kf[0].transform), w.ORIENT[4]), s1.kf[s1.kf.length - 1].transform], [true, k.rot(4)]);
      check('it is picked up off the felt (0 then -56) while the other falls in from high up (-80)', [hopOf(0).kf.slice(0, 3).map(f => [f.offset, f.transform]), hopOf(1).kf[0].transform], [[[0, 'translateY(0px)'], [0.07, 'translateY(-56px)'], [0.3, 'translateY(0px)']], 'translateY(-80px)']);
      check('the rest of its bounces are the usual ones', hopOf(0).kf.slice(2).map(f => f.offset).join() === hopOf(1).kf.slice(1).map(f => f.offset).join(), true);
      check('the set die keeps the way it was sitting; the other gets a new angle', [w.yaw[0] === yaw0, w.yaw[1] !== yaw1], [true, true]);
      check('what was set is used up by the throw', [w.hasSet(), w.setup.pos, w.setup.drag, $(w,'die-pos-0').classList.contains('held')], [false, [null, null], [null, null], false]);
      check('and the dice cannot be touched while they are in the air', [k.locked(), w.G.phase], [true, 'rolling']);
      k.tap(0); const air = k.down(1, 5, 5); k.move(1, 99, 99);
      check('a press on a die in the air does nothing, and is left alone so a finger can still scroll the page', [w.hasSet(), k.held(1), w.setup.drag[1], k.faces()[0], air.defaultPrevented], [false, false, null, 6, false]);
      k.up(1, 99, 99);
      await settle(w);
      check('they land at the usual places showing the roll (2 and 4), with the read-out, nothing left set', [k.at(0), k.at(1), k.faces(), readout(w), w.hasSet(), k.locked()], [{ x:-46, y:0 }, { x:46, y:0 }, [2, 4], { pips:[2, 4], total:'6' }, false, false]);
      check('the roll was what was rolled, not what was set', [w.G.last.d1, w.G.last.d2, w.G.last.sum], [2, 4, 6]);

      // a plain roll afterwards is back to the old throw
      w.showDice(2, 4, false); calls.length = 0;
      w.rollDice(1, 1); await sleep(25);
      check('with nothing set the throw is the old one: both dice come in from the side', [throwOf('die-pos-0').kf.map(f => f.transform), throwOf('die-pos-1').kf.map(f => f.transform)], [['translateX(240px)', 'translateX(-46px)'], ['translateX(290px)', 'translateX(46px)']]);
      await settle(w);

      // a drag still going when the throw starts: the die is thrown from where it is, and the rest of the gesture does nothing
      w.showDice(2, 4, false); calls.length = 0;
      k.down(0, 100, 100); k.move(0, 70, 90);
      const mid = k.at(0);
      w.rollDice(3, 3); await sleep(25);
      check('rolling with a die in your hand throws it from the hand', [mid, throwOf('die-pos-0').kf[0].transform, throwOf('die-pos-0').kf[1].transform], [{ x:-76, y:-10 }, 'translate(-76px,-10px)', 'translate(-46px,0px)']);
      check('the hold is let go quietly (not held, no listeners left to follow the pointer)', [w.setup.drag[0], k.held(0)], [null, false]);
      k.move(0, 10, 10); k.up(0, 10, 10); await settle(w);
      check('the pointer moving and lifting afterwards does nothing: no turn, nothing set', [w.hasSet(), k.faces(), k.at(0)], [false, [3, 3], { x:-46, y:0 }]);

      // a seven: the dice are not touchable while the stickman works
      w.showDice(2, 4, false); k.tap(0); k.tap(1);
      w.rollDice(3, 4); await settle(w);
      for(let i=0;i<200 && !w.sweep;i++) await sleep(5);
      check('during the stickman routine the dice cannot be set', [!!w.sweep, k.locked()], [true, true]);
      k.tap(0); k.down(1, 100, 100); k.move(1, 200, 200);
      check('presses are ignored while he works', [w.hasSet(), k.held(1), k.faces()], [false, false, [3, 4]]);
      k.up(1, 200, 200);
      for(let i=0;i<400 && w.sweep;i++) await sleep(10);
      check('when he has left they can be set again', [!!w.sweep, k.locked()], [false, false]);
      k.tap(0);
      check('and a tap turns a die again', [k.faces(), w.hasSet()], [[4, 4], true]);
      w.showDice(2, 5, false);
      w.startSweep();
      check('starting the routine locks the dice at once, even between rolls', [!!w.sweep, k.locked(), w.G.phase], [true, true, 'betting']);
      w.endSweep();
      check('and ending it unlocks them', [!!w.sweep, k.locked()], [false, false]);
      w.close();
    }

    // ---- 27c. turbo and reduced motion; the roll itself; layout changes; the page loading
    {
      const w = mk(), k = kit(w);
      k.tap(0); k.drag(1, 100, -20);
      w.G.settings.turbo = true; w.rollDice(5, 6); await settle(w);
      check('turbo: the dice you set simply go to rest with the roll', [w.hasSet(), k.at(0), k.at(1), k.faces(), k.held(0), k.held(1)], [false, { x:-46, y:0 }, { x:46, y:0 }, [5, 6], false, false]);
      w.G.settings.turbo = false; w.reducedMotion = true;
      k.tap(0); k.drag(1, 100, -20); w.rollDice(1, 6); await settle(w);
      check('reduced motion: same', [w.hasSet(), k.at(0), k.at(1), k.faces()], [false, { x:-46, y:0 }, { x:46, y:0 }, [1, 6]]);
      w.reducedMotion = false; w.G.settings.turbo = true;
      // the roll is two fresh random dice whatever is set
      for(const s of [w.startRoll.toString(), w.rollDice.toString(), w.randDie.toString(), w.randInt.toString()]) check('the code that makes and resolves the roll never looks at how the dice are set', /setup|shownFace|takeSet|hasSet|curPos|setFace|fitPos/.test(s), false);
      w.showDice(4, 3, false);
      k.tap(0); k.tap(0); k.tap(1); k.tap(1); k.tap(1);
      check('both dice set to sixes', k.faces(), [6, 6]);
      const seen = []; const realRoll = w.rollDice; w.rollDice = (a, b) => seen.push([a, b]);
      const N = 36000; for(let i=0;i<N;i++) w.startRoll();
      const pairs = Array(36).fill(0); seen.forEach(([a, b]) => pairs[(a-1)*6 + (b-1)]++);
      const chi = pairs.reduce((a, o) => a + (o - N/36)*(o - N/36)/(N/36), 0);
      truthy('with both dice set to sixes the rolls are still uniform over all 36 pairs (chi-square '+chi.toFixed(1)+', limit 85)', chi < 85);
      check('and 6-6 comes up about 1 time in 36, not every time', Math.abs(pairs[35]/N - 1/36) < 0.006, true);
      w.rollDice = realRoll;
      hit(w, 'pass'); const bank = w.G.bankroll; w.rollDice(1, 2); await settle(w);
      check('a roll with sixes set is worked out from the dice that were rolled (1 + 2 = 3: craps, the Pass Line loses)', [w.G.last.d1, w.G.last.d2, w.G.last.sum, w.G.bankroll === bank], [1, 2, 3, true]);
      // a window resize with dice set
      w.G.settings.turbo = false;
      w.showDice(2, 5, false);
      k.drag(1, 300, 0); k.drag(0, 200, -30);
      const before = [k.at(0), k.at(1), k.faces()];
      Object.defineProperty(w, 'innerWidth', { value:375, configurable:true });
      w.dispatchEvent(new w.Event('resize'));
      const Mp = k.M();
      check('on a narrow screen the dice that were set are brought back inside the tray and stay apart', [k.at(0).x <= Mp.xmax, k.at(1).x <= Mp.xmax, Math.abs(k.at(0).x) <= Mp.xmax, k.ell() >= 0.999, k.faces()], [true, true, true, true, before[2]]);
      check('a resize never throws the set dice back to the last roll', [w.hasSet(), k.faces()], [true, before[2]]);
      w.close();
      // one die set, the other resting: a resize moves the resting one to the new resting place
      const w2 = mk(), k2 = kit(w2);
      k2.drag(0, -60, -20);
      Object.defineProperty(w2, 'innerWidth', { value:375, configurable:true });
      w2.dispatchEvent(new w2.Event('resize'));
      check('a die at rest follows the new resting place (+/-36 on a phone) while the set one stays set', [k2.at(1), w2.hasSet(), w2.setup.pos[1]], [{ x:36, y:0 }, true, null]);
      w2.close();
      // a reload starts with the last roll, not with set dice
      const w3 = mk(), k3 = kit(w3);
      w3.G.settings.turbo = true; await roll(w3, 2, 3);
      k3.tap(0); k3.drag(1, 40, -10);
      const w4 = load({ [K.hand]: w3.localStorage.getItem(K.hand), [K.sess]: w3.localStorage.getItem(K.sess), [K.bank]: w3.localStorage.getItem(K.bank) });
      const k4 = kit(w4);
      check('after a reload the dice show the last roll at rest, nothing set', [w4.hasSet(), k4.at(0), k4.at(1), k4.faces(), k4.locked()], [false, { x:-46, y:0 }, { x:46, y:0 }, [2, 3], false]);
      w3.close(); w4.close();
    }

    // ---- 27d. random handling: anything a hand can do keeps the dice on the tray and apart, and locked at the right times
    {
      const w = mk(), k = kit(w), R = rng(2718);
      for(const [id, l, tp, wd, ht] of [['btn-dice', 10, 10, 46, 46], ['btn-keep', 690, 176, 160, 28]]) for(const [key, v] of Object.entries({ offsetLeft:l, offsetTop:tp, offsetWidth:wd, offsetHeight:ht })) Object.defineProperty($(w, id), key, { value:v, configurable:true });
      w.Element.prototype.animate = function(kf, o){ return { cancel(){}, finished:new Promise(r => setTimeout(r, 40)) }; };
      let bad = [];
      const note = (what, ok) => { if(!ok) bad.push(what); };
      let phone = false;
      for(let n=0;n<700;n++){
        const i = R() < 0.5 ? 0 : 1, id = 1 + Math.floor(R()*3), type = R() < 0.4 ? 'touch' : 'mouse', r = R();
        const x = Math.round(R()*900 - 450), y = Math.round(R()*500 - 250), o = { id, type };
        if(r < 0.30) k.down(i, x, y, o);
        else if(r < 0.65) k.move(i, x, y, o);
        else if(r < 0.85) k.up(i, x, y, o);
        else if(r < 0.88) ptr(w, k.face(i), 'pointercancel', x, y, o);
        else if(r < 0.91) k.tap(i, o);
        else if(r < 0.93){ phone = !phone; Object.defineProperty(w, 'innerWidth', { value:phone ? 375 : 1200, configurable:true }); w.dispatchEvent(new w.Event('resize')); }
        else if(r < 0.95) w.dispatchEvent(new w.Event('blur'));
        else if(r < 0.97){ w.showDice(1 + Math.floor(R()*6), 1 + Math.floor(R()*6), false); }
        else if(w.G.phase === 'betting'){ w.rollDice(1 + Math.floor(R()*6), 1 + Math.floor(R()*6)); await settle(w); for(let q=0;q<150 && w.sweep;q++) await sleep(8); }
        const M = k.M();
        for(const d of [0, 1]){
          const p = k.at(d);
          note('die '+d+' in the tray at step '+n, p && p.x >= M.xmin - 0.01 && p.x <= M.xmax + 0.01 && p.y >= M.ymin - 0.01 - (w.hasHand() ? 1 : 0) && p.y <= M.ymax + 0.01 + (w.hasHand() ? 1 : 0));
          if(w.setup.pos[d] && !w.hasHand()) note('a set die is clear of the buttons at step '+n, !w.hitsButton(p, M));
          note('face '+d+' is 1..6 at step '+n, Number.isInteger(w.shownFace[d]) && w.shownFace[d] >= 1 && w.shownFace[d] <= 6);
          note('die '+d+' spin matches its number at step '+n, k.spin(d) === k.rot(w.shownFace[d]));
          if(k.held(d)) note('a held die is being dragged (or both are in the hand) at step '+n, w.hasHand() || (w.setup.drag[d] !== null && w.setup.pos[d] !== null));
        }
        note('dice never overlap at step '+n, k.ell() >= 0.998);
        note('the wall is up exactly while the dice are in the hand or flying to it at step '+n, $(w,'dice-stage').classList.contains('hand') === (w.hasHand() || w.G.phase === 'rolling' && w.flying === true));
        note('locked exactly when rolling or while he works at step '+n, k.locked() === !(w.G.phase === 'betting' && !w.sweep));
        if(w.hasSet()){ const z0 = $(w,'die-pos-0').style.zIndex, z1 = $(w,'die-pos-1').style.zIndex, y0 = k.at(0).y, y1 = k.at(1).y; note('the die nearer you is drawn in front at step '+n, y0 > y1 ? z0 === '3' : (y1 > y0 ? z1 === '3' : true)); }
      }
      check('700 random presses, drags, taps, resizes, blurs, redraws and rolls: dice always inside the tray, apart, numbered 1-6, and locked at the right times', bad.slice(0, 5), []);
      check('and the page is still healthy', [w.errs, w.G.phase], [[], 'betting']);
      w.close();
    }

    // ---- 27e. push the two dice into each other and you pick them both up; the wall comes in
    {
      const T = { v: 10000 };
      const mkh = () => { const w = mk(); w.nowMs = () => T.v; const k = kit(w); k.wall = () => $(w,'dice-stage').classList.contains('hand'); return [w, k]; };
      const mv = (w, k, x, y, ms, o) => { T.v += ms; const e = ptr(w, k.face(0), 'pointermove', x, y, o); w.advanceMotion(ms); return e; };
      const [w, k] = mkh(), M = k.M();
      const clacks = []; w.sfxClack = p => clacks.push(p);
      const buzzes = []; Object.defineProperty(w.navigator, 'vibrate', { value:ms => { buzzes.push(ms); return true; }, configurable:true });
      w.G.settings.sound = true; w.ensureAudio = () => null;
      check('before anything: no hand, no wall, hint text is the first-time one', [w.hasHand(), k.wall(), $(w,'shoot-hint-text').textContent], [false, false, 'Flick it at the wall']);
      check('the wall and its hint are inside the dice stage', [$(w,'dice-stage').contains($(w,'table-wall')), $(w,'dice-stage').contains($(w,'shoot-hint'))], [true, true]);
      // a push that stays shy of "well into" does not pick them up
      k.down(0, 300, 300); k.move(0, 340, 300);
      check('a push of 40px up to the other die stops at it and picks nothing up (the two dice click as they touch)', [w.hasHand(), k.wall(), k.at(0), clacks.length], [false, false, { x:-36.33, y:0 }, 1]);
      // push on, well into it
      k.move(0, 360, 300);
      check('pushing on, well into the other die, picks up both, with a click and a buzz', [w.hasHand(), k.wall(), w.setup.drag[0], w.setup.drag[1], clacks.length, clacks.slice(-1)[0], buzzes.slice(-1)[0]], [true, true, null, null, 2, 0.8, 14]);
      check('both dice are lifted into the hand and marked held', [k.held(0), k.held(1)], [true, true]);
      check('the wall hint is showing, and a screen reader is told what to do', [$(w,'shoot-hint-text').textContent, /Holding both dice/.test($(w,'sr-live').textContent), /right/.test($(w,'sr-live').textContent)], ['Flick it at the wall', true, true]);
      check('the wall is as wide as the table metrics say', $(w,'table-wall').style.width, M.wallW + 'px');
      w.advanceMotion(900);
      const a = k.at(0), b = k.at(1);
      check('they settle side by side in depth: same place across, one behind the other, clear of each other', [a.x === b.x, b.y - a.y, k.ell() >= 1], [true, 2 * M.hs, true]);
      check('and held up in the air above the felt, with the shadows pulled in', [w.bodies[0].z, w.bodies[1].z, k.hop(0), k.shadow(0).style.opacity < 0.5], [M.hold, M.hold, 'translateY(-' + M.hold + 'px)', true]);
      check('nothing is saved or rolled by picking the dice up', [w.G.phase, w.G.last, w.hasSet()], ['betting', null, true]);
      // it follows the pointer
      const x0 = k.at(0).x, y0 = k.at(0).y;
      mv(w, k, 360 + 80, 300 - 10, 16); w.advanceMotion(700);
      check('the pair follows the pointer: 80 across, 10 up', [Math.round(k.at(0).x - x0), Math.round(k.at(0).y - y0), k.at(1).x === k.at(0).x], [80, -10, true]);
      mv(w, k, 360 + 3000, 300, 16); w.advanceMotion(700);
      check('it can go as far as the wall and no further', [k.at(0).x, k.at(1).x, k.at(0).x === M.xhand], [M.xhand, M.xhand, true]);
      mv(w, k, 360 - 3000, 300 - 3000, 16); w.advanceMotion(700);
      check('and no further than the left edge of the tray or the back of it', [k.at(0).x, k.at(0).y], [M.xmin, M.yhmin - M.hs]);
      mv(w, k, 360, 300 + 3000, 16); w.advanceMotion(700);
      check('nor lower than the front: the nearer die stays on the tray', [k.at(1).y <= M.ymax, k.at(1).y], [true, M.ymax]);
      // the dice cannot be picked at while they are in the hand
      const before = [k.at(0), k.at(1)];
      k.down(1, 5, 5); k.down(1, 5, 5, { init:{ button:2 } });
      check('pressing a die (or right-clicking one) with both in the hand does nothing', [k.faces(), w.setup.drag[0], w.setup.drag[1], [k.at(0), k.at(1)]], [[4, 3], null, null, before]);
      // another pointer is ignored
      mv(w, k, 10, 10, 16, { id: 9 });
      check('moves and lifts from another pointer are ignored', [k.at(0), w.hasHand()], [before[0], true]);
      ptr(w, k.face(0), 'pointerup', 10, 10, { id: 9 });
      check('...the hand stays closed on the dice', w.hasHand(), true);
      // let go gently: they are set down
      mv(w, k, 360 - 100, 300, 16);
      T.v += 200;                                          // the pointer has been still for a moment
      let drops = 0; w.sfxDrop = () => drops++;
      ptr(w, k.face(0), 'pointerup', 260, 300); w.advanceMotion(1500);
      check('letting go gently sets both down: no hand, no wall, no roll', [w.hasHand(), k.wall(), w.G.phase, w.G.last], [false, false, 'betting', null]);
      check('they are on the felt, still one behind the other, and set where they were put', [w.bodies[0].z, w.bodies[1].z, Math.round(k.at(1).y - k.at(0).y), w.hasSet(), w.setup.pos[0] !== null && w.setup.pos[1] !== null], [0, 0, 2 * M.hs, true, true]);
      check('each die lands with its own drop sound', drops, 2);
      check('and its own small buzz on a phone: one 5ms buzz for the die picked up first, 14ms for both in the hand, one 8ms thud per die as it lands', [buzzes.filter(b => b === 5).length, buzzes.filter(b => b === 14).length, buzzes.filter(b => b === 8).length], [1, 1, 2]);
      check('no longer held, pointer let go of', [k.held(0), k.held(1), w.motionLive()], [false, false, false]);
      // while they are being picked up the dice start out close together; they slide into formation and never overlap on the way
      const [wg, kg] = mkh();
      kg.down(0, 300, 300); kg.move(0, 340, 300);
      ptr(wg, kg.face(0), 'pointermove', 372, 300);
      let minEll = 9, steps = 0;
      for(let i = 0; i < 120; i++){ wg.advanceMotion(8.4); minEll = Math.min(minEll, kg.ell()); steps++; }
      check('picked up and moving into formation, the two dice never overlap, not even for one step', [wg.hasHand(), minEll >= 0.998], [true, true]);
      wg.close();
      // a second finger resting on the other die: the first finger takes both, and the second is let go of
      const [w3, k3] = mkh(), caps = [];
      w3.Element.prototype.setPointerCapture = function(id){ caps.push(['set', id]); };
      w3.Element.prototype.releasePointerCapture = function(id){ caps.push(['release', id]); };
      k3.down(1, 400, 300, { type:'touch', id:5 });
      k3.down(0, 300, 300, { type:'touch', id:4 }); k3.move(0, 400, 300, { type:'touch', id:4 });
      check('a second finger resting on the other die is let go of when the first finger picks up the pair', [w3.hasHand(), w3.setup.drag[0], w3.setup.drag[1], caps.filter(c => c[0] === 'release' && c[1] === 5).length], [true, null, null, 1]);
      ptr(w3, k3.face(1), 'pointerup', 400, 300, { type:'touch', id:5 });
      check('...and lifting it later does nothing: no tap that turns a die, the pair stays in the hand', [k3.faces(), w3.hasHand()], [[4, 3], true]);
      w3.close();
      w.close();
    }

    // ---- 27f. a flick throws them at the wall; the roll is the same two random dice as ever
    {
      const T = { v: 20000 };
      const w = mk(); w.nowMs = () => T.v; const k = kit(w), M = k.M();
      const calls = [];
      w.Element.prototype.animate = function(kf, o){ calls.push({ id:this.id, cls:this.className, kf, o, el:this }); return { cancel(){ this.cancelled = true; }, finished:new Promise(r => setTimeout(r, o.duration * 0.55)) }; };
      const mv = (x, y, ms, o) => { T.v += ms; ptr(w, k.face(0), 'pointermove', x, y, o); w.advanceMotion(ms); };
      const gather = () => { w.showDice(4, 3, false); k.down(0, 300, 300); k.move(0, 400, 300); w.advanceMotion(900); };
      const flickAt = (pxPerStep, steps, o) => { const x0 = 400; for(let s=1;s<=steps;s++) mv(x0 + pxPerStep * s, 300, 10, o); T.v += 4; };
      const hops = i => calls.filter(c => c.cls === 'die-hop' && c.el === $(w,'die-pos-'+i).querySelector('.die-hop'));
      const sounds = { wall:0, tick:0, whoosh:[] }; w.sfxWall = () => sounds.wall++; w.sfxTick = () => sounds.tick++; w.sfxWhoosh = s => sounds.whoosh.push(Math.round(s));
      let hits = 0; const hitCls = []; const wl = $(w,'table-wall'); const realHit = w.wallHit; w.wallHit = () => { hits++; realHit(); hitCls.push(wl.classList.contains('hit')); };
      // a hard flick to the right
      w.randDie = (() => { const seq = [3, 5]; let n = 0; return () => seq[n++ % 2]; })();
      gather();
      check('(two dice in the hand)', [w.hasHand(), k.wall()], [true, true]);
      const handAt = [k.at(0), k.at(1)];
      flickAt(20, 8);                                      // 20px every 10ms = 2000px/s
      const handAt2 = [k.at(0), k.at(1)];                  // where the hand is as it lets go
      calls.length = 0;
      ptr(w, k.face(0), 'pointerup', 400 + 160, 300);
      check('letting go with a fast flick to the right starts a roll', [w.G.phase, w.hasHand(), w.pendingShot, calls.length], ['rolling', false, null, 8]);
      check('the roll is the two random dice the page drew (3 and 5), not anything to do with the flick', [w.G.last.d1, w.G.last.d2, w.G.last.sum], [3, 5, 8]);
      check('the wall stays up while the dice fly, the stage is locked, and the hint steps aside', [k.wall(), k.locked(), w.flying, $(w,'dice-stage').classList.contains('flying')], [true, true, true, true]);
      const dur = calls[0].o.duration;
      check('four animations a die (place, height, shadow, spin), all for the same length of time, about a second', [calls.map(c => c.id + '/' + c.cls).sort().join(), new Set(calls.map(c => c.o.duration)).size, dur > 700 && dur < 1600], [['die-0/die', 'die-1/die', 'die-pos-0/die-pos', 'die-pos-1/die-pos', 'die-hop/die-hop'].length === 5 ? calls.map(c => c.id + '/' + c.cls).sort().join() : '', 1, true]);
      const posA = calls.find(c => c.id === 'die-pos-0'), posB = calls.find(c => c.id === 'die-pos-1');
      const xy = s => /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(s).slice(1).map(Number);
      check('the throw starts exactly where the hand was', [xy(posA.kf[0].transform), xy(posB.kf[0].transform)].map(a => ({ x:a[0], y:a[1] })).map(p => [Math.round(p.x), Math.round(p.y)]), handAt2.map(p => [Math.round(p.x), Math.round(p.y)]));
      check('...and ends exactly at the usual resting places', [posA.kf[posA.kf.length - 1].transform, posB.kf[posB.kf.length - 1].transform], ['translate(-46px,0px)', 'translate(46px,0px)']);
      const xsA = posA.kf.map(f => xy(f.transform)[0]), xsB = posB.kf.map(f => xy(f.transform)[0]);
      check('the dice go as far as the wall (and not an inch past it) and come back', [Math.max(...xsA, ...xsB), xsA.indexOf(Math.max(...xsA)) > 0, xsA.indexOf(Math.max(...xsA)) < xsA.length - 5], [M.wallX, true, true]);
      check('the keyframes run from offset 0 to 1 in order', [posA.kf[0].offset, posA.kf[posA.kf.length - 1].offset, posA.kf.every((f, j) => j === 0 || f.offset > posA.kf[j - 1].offset)], [0, 1, true]);
      const heightsA = hops(0)[0].kf.map(f => -/translateY\((-?[\d.]+)px\)/.exec(f.transform)[1]);
      check('the dice never go through the felt, bounce several times (the drop, the kick off the wall, and smaller ones after), and finish on it', [Math.min(...heightsA) >= 0, heightsA[heightsA.length - 1], heightsA.filter((h, j) => j > 0 && j < heightsA.length - 1 && h > heightsA[j-1] && h >= heightsA[j+1] && h > 0.5).length >= 3], [true, 0, true]);
      const spinA = calls.find(c => c.id === 'die-0'), ang = s => /rotateX\((-?[\d.]+)deg\) rotateY\((-?[\d.]+)deg\) rotateZ\((-?[\d.]+)deg\)/.exec(s).slice(1).map(Number);
      check('each die spins on the way and ends showing the number rolled (3 and 5) face up', [spinA.kf[spinA.kf.length - 1].transform, calls.find(c => c.id === 'die-1').kf.slice(-1)[0].transform], [k.rot(3), k.rot(5)]);
      check('...having started on the face it was held on', [ang(spinA.kf[0].transform).every((v, j) => ((v - w.ORIENT[4][j]) % 360 + 360) % 360 === 0), spinA.kf.some(f => ang(f.transform).some((v, j) => Math.abs(v - w.ORIENT[3][j]) >= 360))], [true, true]);
      await sleep(450);
      check('the wall hit is felt and heard once (not once per die)', [hits, sounds.wall, sounds.tick > 0, sounds.whoosh.length, sounds.whoosh[0] >= 1500], [1, 1, true, 1, true]);
      check('...the wall flashes as it is hit, and the flash clears again by itself', [hitCls, wl.classList.contains('hit')], [[true], false]);
      await settle(w);
      check('when they land: wall gone, usual resting places, the numbers rolled, the read-out, nothing left set', [k.wall(), w.flying, k.at(0), k.at(1), k.faces(), readout(w), w.hasSet(), k.locked(), $(w,'dice-stage').classList.contains('flying')], [false, false, { x:-46, y:0 }, { x:46, y:0 }, [3, 5], { pips:[3, 5], total:'8' }, false, false, false]);
      check('after the first throw the hint is the short one: "Flick to throw"', $(w,'shoot-hint-text').textContent, 'Flick to throw');
      gather();
      check('(and it stays that way for the next pick-up)', $(w,'shoot-hint-text').textContent, 'Flick to throw');
      // a harder flick is a quicker, more tumbling throw; the numbers are still the next two from the dice
      flickAt(20, 8); calls.length = 0; ptr(w, k.face(0), 'pointerup', 560, 300);
      const dur2 = calls[0].o.duration; await settle(w);
      gather(); flickAt(5, 8);                             // 5px every 10ms = 500px/s: a gentle flick
      calls.length = 0; ptr(w, k.face(0), 'pointerup', 440, 300);
      const dur3 = calls[0].o.duration;
      check('a gentle flick (500px/s) still throws, and it takes a bit longer to reach the wall than a hard one', [calls.length, dur3 >= dur2], [8, true]);
      check('the roll was still the next two random dice', [w.G.last.d1, w.G.last.d2], [3, 5]);
      await settle(w);
      // from the far end of the tray the flick's speed decides how long the flight is: a gentle one takes much longer to get there
      const flightFrom = async pxPerStep => { w.showDice(4, 3, false); k.down(0, 300, 300); k.move(0, 400, 300); w.advanceMotion(900); mv(40, 300, 16); w.advanceMotion(700); for(let q = 1; q <= 8; q++) mv(40 + pxPerStep * q, 300, 10); T.v += 4; calls.length = 0; ptr(w, k.face(0), 'pointerup', 40 + pxPerStep * 8, 300); const d = calls[0].o.duration; await settle(w); return d; };
      const farHard = await flightFrom(24), farGentle = await flightFrom(5);
      check('a flick that comes straight after a fast pull-back to the left still throws (only the last moments count), and thrown from the far end of the tray a hard flick (2400px/s) gets there sooner than a gentle one (500px/s)', [farGentle - farHard > 80, farHard >= 550], [true, true]);
      // too slow, too sideways, backwards, or cancelled: no throw
      const noThrow = async (desc, f) => { gather(); calls.length = 0; const was = w.G.last.sum; f(); w.advanceMotion(1500); check(desc, [w.G.phase, w.hasHand(), k.wall(), calls.length, w.G.last.sum === was, w.hasSet()], ['betting', false, false, 0, true, true]); };
      await noThrow('a slow push right (300px/s) and let go: set down, not thrown', () => { flickAt(3, 8); ptr(w, k.face(0), 'pointerup', 430, 300); });
      await noThrow('a fast flick to the left: set down, not thrown', () => { flickAt(-20, 8); ptr(w, k.face(0), 'pointerup', 240, 300); });
      await noThrow('a fast flick straight up the table: set down, not thrown', () => { T.v += 10; for(let s=1;s<=8;s++){ T.v += 10; ptr(w, k.face(0), 'pointermove', 400, 300 - 25 * s); w.advanceMotion(10); } T.v += 4; ptr(w, k.face(0), 'pointerup', 400, 100); });
      await noThrow('a flick to the right that the pointer stopped before letting go: set down, not thrown', () => { flickAt(20, 8); T.v += 300; ptr(w, k.face(0), 'pointerup', 560, 300); });
      await noThrow('a flick that the browser cancels (a touch taken over): set down, not thrown', () => { flickAt(20, 8); ptr(w, k.face(0), 'pointercancel', 560, 300); });
      await noThrow('the window losing focus mid-flick: set down, not thrown', () => { flickAt(20, 8); w.dispatchEvent(new w.Event('blur')); });
      await noThrow('letting go without moving at all: set down, not thrown', () => { ptr(w, k.face(0), 'pointerup', 400, 300); });
      // a finger needs a little less speed than a mouse
      const touchFlick = async (pxPerStep, expect, desc) => { w.showDice(4, 3, false); k.down(0, 300, 300, { type:'touch', id:4 }); k.move(0, 400, 300, { type:'touch', id:4 }); w.advanceMotion(900); calls.length = 0; for(let s=1;s<=8;s++){ T.v += 10; ptr(w, k.face(0), 'pointermove', 400 + pxPerStep * s, 300, { type:'touch', id:4 }); w.advanceMotion(10); } T.v += 4; ptr(w, k.face(0), 'pointerup', 400 + pxPerStep * 8, 300, { type:'touch', id:4 }); const threw = w.G.phase === 'rolling'; if(threw) await settle(w); else w.advanceMotion(1500); check(desc, threw, expect); };
      await touchFlick(4, true, 'a finger flick at 400px/s throws');
      await touchFlick(3.4, false, 'a finger flick at 340px/s is a set-down');
      w.close();
    }

    // ---- 27f2. how fast a flick was comes from when the pointer really moved, not from when a busy page got round to hearing about it
    {
      const T = { v: 25000 };
      const w = mk(); w.nowMs = () => T.v; const k = kit(w);
      w.Element.prototype.animate = function(kf, o){ return { cancel(){}, finished:new Promise(r => setTimeout(r, o.duration * 0.55)) }; };
      const evt = (type, x, y, ts, many) => {
        const e = new w.PointerEvent(type, { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0, buttons:type === 'pointerup' ? 0 : 1, pointerId:5, pointerType:'touch' });
        Object.defineProperty(e, 'timeStamp', { value:ts });
        if(many) e.getCoalescedEvents = () => many;
        k.face(0).dispatchEvent(e); return e;
      };
      w.randDie = (() => { const seq = [3, 5]; let n = 0; return () => seq[n++ % 2]; })();
      const gather = () => { w.showDice(4, 3, false); k.down(0, 300, 300, { type:'touch', id:5 }); k.move(0, 400, 300, { type:'touch', id:5 }); w.advanceMotion(900); T.v += 500; };
      const outcome = async desc => { const threw = w.G.phase === 'rolling'; if(threw) await settle(w); else w.advanceMotion(1500); return threw; };
      // the page was busy: all eight moves reach it at the same instant, each stamped with when it happened
      gather();
      for(let q = 1; q <= 8; q++) evt('pointermove', 400 + 20 * q, 300, T.v - 80 + 10 * q);
      evt('pointerup', 560, 300, T.v + 4);
      check('moves that all arrive at once but happened 10ms apart (2000px/s) make a throw', await outcome(), true);
      // the opposite: the page heard about every move on time, but the finger was slow (20px every 100ms)
      gather();
      for(let q = 1; q <= 8; q++){ T.v += 10; evt('pointermove', 400 + 20 * q, 300, T.v - 1000 + 100 * q); }
      evt('pointerup', 560, 300, T.v - 1000 + 804);
      check('moves the page heard about quickly but that happened 100ms apart (200px/s) are only a set-down', await outcome(), false);
      // one pointer event that carries every position the finger passed through since the last frame
      gather();
      const many = []; for(let q = 1; q <= 8; q++) many.push({ clientX:400 + 20 * q, clientY:300, timeStamp:T.v - 80 + 10 * q });
      evt('pointermove', 560, 300, T.v, many);
      evt('pointerup', 560, 300, T.v + 4);
      check('one event carrying eight positions 10ms apart (2000px/s) makes a throw', await outcome(), true);
      // ...and a finger that stopped long before it lifted is not a flick, whatever came before
      gather();
      const old = []; for(let q = 1; q <= 8; q++) old.push({ clientX:400 + 20 * q, clientY:300, timeStamp:T.v - 380 + 10 * q });
      evt('pointermove', 560, 300, T.v - 300, old);
      evt('pointerup', 560, 300, T.v);
      check('positions that are 300ms old when the finger lifts are a set-down', await outcome(), false);
      // a timestamp from some other clock (or none) is ignored: the page's own clock is used
      gather();
      for(let q = 1; q <= 8; q++){ T.v += 10; evt('pointermove', 400 + 20 * q, 300, 1.7e12 + q); }
      T.v += 4; evt('pointerup', 560, 300, 1.7e12 + 9);
      check('a timestamp that is not on the page clock is ignored, and the page clock gives the speed instead', await outcome(), true);
      // the dice are never left in the air: if the browser never reports the animation as finished, they land when it should have been
      {
        const wz = mk(); wz.nowMs = () => T.v; const kz = kit(wz);
        wz.Element.prototype.animate = function(kf, o){ return { cancel(){}, finished:new Promise(() => {}) }; };
        wz.randDie = (() => { const seq = [3, 5]; let n = 0; return () => seq[n++ % 2]; })();
        wz.showDice(4, 3, false); kz.down(0, 300, 300, { type:'touch', id:5 }); kz.move(0, 400, 300, { type:'touch', id:5 }); wz.advanceMotion(900); T.v += 500;
        const ez = (type, x, y, ts) => { const e = new wz.PointerEvent(type, { bubbles:true, cancelable:true, clientX:x, clientY:y, button:0, buttons:type === 'pointerup' ? 0 : 1, pointerId:5, pointerType:'touch' }); Object.defineProperty(e, 'timeStamp', { value:ts }); kz.face(0).dispatchEvent(e); };
        for(let q = 1; q <= 8; q++) ez('pointermove', 400 + 20 * q, 300, T.v - 80 + 10 * q);
        ez('pointerup', 560, 300, T.v + 4);
        check('(the dice are in the air)', [wz.G.phase, wz.flying], ['rolling', true]);
        for(let i = 0; i < 80 && wz.G.phase === 'rolling'; i++) await sleep(25);
        check('and when the browser never says the animation is over, they are put down on the felt anyway a moment after it should have ended', [wz.G.phase, wz.flying, wz.shownFace.slice()], ['betting', false, [3, 5]]);
        wz.close();
      }
      // a flick that rolls a 7: the stickman comes once the dice have landed, not before
      w.randDie = (() => { const seq = [3, 4]; let n = 0; return () => seq[n++ % 2]; })();
      gather();
      for(let q = 1; q <= 8; q++) evt('pointermove', 400 + 20 * q, 300, T.v - 80 + 10 * q);
      evt('pointerup', 560, 300, T.v + 4);
      const during = w.sweep;
      await settle(w);
      check('a flicked 7: no stickman while the dice are flying, and he sets off as soon as they have landed', [w.G.last.sum, during, !!w.sweep, $(w,'stickman').style.display !== 'none'], [7, null, true, true]);
      w.endSweep();
      check('no errors', w.errs, []);
      w.close();
    }

    // ---- 27g. Space or the Roll button with the dice in your hand: thrown from your hand at a middling speed
    {
      const T = { v: 30000 };
      const w = mk(); w.nowMs = () => T.v; const k = kit(w), M = k.M();
      const calls = [];
      w.Element.prototype.animate = function(kf, o){ calls.push({ id:this.id, cls:this.className, kf, o }); return { cancel(){}, finished:new Promise(r => setTimeout(r, 80)) }; };
      k.down(0, 300, 300); k.move(0, 400, 300); w.advanceMotion(900); k.move(0, 340, 280);
      const held = [k.at(0), k.at(1)];
      check('(holding both dice, the pointer still down)', [w.hasHand(), k.wall()], [true, true]);
      w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key:' ', code:'Space', bubbles:true, cancelable:true }));
      await sleep(5);
      check('Space throws them from your hand', [w.G.phase, w.hasHand(), calls.length, calls.find(c => c.id === 'die-pos-0').kf[0].transform], ['rolling', false, 8, 'translate(' + held[0].x + 'px,' + held[0].y + 'px)']);
      check('the pointer is let go of, and the wall stays up for the flight', [w.setup.drag[0], k.wall(), k.held(0), k.held(1)], [null, true, false, false]);
      k.move(0, 300, 300); k.up(0, 300, 300);
      check('the rest of the gesture after that does nothing', [w.hasSet(), w.hasHand()], [false, false]);
      await settle(w);
      check('and they land in the usual places with the wall gone', [k.at(0), k.at(1), k.wall()], [{ x:-46, y:0 }, { x:46, y:0 }, false]);
      // turbo: no flight at all
      w.G.settings.turbo = true; calls.length = 0;
      k.down(0, 300, 300); k.move(0, 400, 300); w.advanceMotion(900);
      w.rollDice(2, 5); await settle(w);
      check('turbo: the dice go straight to rest with the roll; no animation; the wall is gone', [calls.length, k.wall(), k.at(0), k.at(1), k.faces(), w.hasHand()], [0, false, { x:-46, y:0 }, { x:46, y:0 }, [2, 5], false]);
      // reduced motion
      w.G.settings.turbo = false; w.reducedMotion = true;
      k.down(0, 300, 300); k.move(0, 400, 300);
      check('reduced motion: the pair is in the hand at once, without a spring', [w.hasHand(), w.bodies[0].z, w.bodies[0].x === w.bodies[1].x], [true, M.hold, true]);
      w.rollDice(6, 6); await settle(w);
      check('reduced motion: thrown without animation', [calls.length, k.wall(), k.faces(), w.hasHand()], [0, false, [6, 6], false]);
      w.reducedMotion = false;
      w.close();
    }

    // ---- 27h. the feel: a little physics, the same on every screen
    {
      const T = { v: 40000 };
      const w = mk(); w.nowMs = () => T.v; const k = kit(w), M = k.M();
      // time steps: the same motion however the frames come
      const run = chunks => { const x = mk(); const kx = kit(x); kx.down(0, 300, 300); ptr(x, kx.face(0), 'pointermove', 360, 270); for(const c of chunks) x.advanceMotion(c); ptr(x, kx.face(0), 'pointermove', 100, 330); for(const c of chunks) x.advanceMotion(c); const r = [x.bodies[0].x, x.bodies[0].y, x.bodies[0].z]; x.close(); return r; };
      const one = run([1000]), sixty = run(Array(60).fill(1000/60)), thirty = run(Array(30).fill(1000/30));
      check('the physics is stepped at a fixed rate, so a 30, 60 or 1-per-second screen gets the same motion', [Math.abs(one[0] - sixty[0]) < 1.5, Math.abs(one[0] - thirty[0]) < 1.5, Math.abs(one[1] - sixty[1]) < 1.5], [true, true, true]);
      // weight: it does not teleport, it does not overshoot
      k.down(0, 300, 300); ptr(w, k.face(0), 'pointermove', 300 - 150, 300);
      const xs = []; for(let t=0;t<60;t++){ w.advanceMotion(10); xs.push(w.bodies[0].x); }
      const tgt = w.bodies[0].tx;
      check('a held die takes a moment to catch up with the pointer: after 40ms it is partway, after 600ms it is there', [xs[3] < -46, xs[3] > tgt, xs[3] > -46 - 100, xs[xs.length - 1] === tgt], [true, true, true, true]);
      check('it never overshoots the place it is going to', xs.every(x => x >= tgt - 0.001), true);
      check('and it never goes backwards on the way', xs.every((x, j) => j === 0 || x <= xs[j - 1] + 1e-9), true);
      check('moving left, it leans into the move; while moving, the lean is part of the hop transform', [w.bodies[0].lean > 0 || w.bodies[0].lean === 0, xs.length], [true, 60]);
      ptr(w, k.face(0), 'pointermove', 300 + 200, 300);
      w.advanceMotion(60);
      check('moving right, the top trails behind (leans back)', [w.bodies[0].lean < -0.5, /rotate\(-/.test(k.hop(0))], [true, true]);
      w.advanceMotion(800);
      check('at a standstill the lean is gone (the transform has no rotate at all)', [w.bodies[0].lean, /rotate/.test(k.hop(0))], [0, false]);
      ptr(w, k.face(0), 'pointerup', 500, 300); w.advanceMotion(1500);
      // carry: a die let go while moving carries a little way, to about where the pointer was
      w.showDice(4, 3, false);
      k.down(0, 300, 300);
      let px = 300; for(let s=0;s<40;s++){ px += 8; ptr(w, k.face(0), 'pointermove', px, 300); w.advanceMotion(16); }   // 500px/s
      const mid = w.bodies[0].x - (-46 + (px - 300));
      ptr(w, k.face(0), 'pointerup', px, 300); w.advanceMotion(1500);
      const landed = k.at(0).x, wanted = -46 + (px - 300);
      check('let go while moving at 500px/s, the die carries on a little and comes to rest within a few pixels of the pointer', [Math.abs(landed - wanted) < 8, mid < 0, Math.abs(mid) > 3], [true, true, true]);
      // idle means idle
      check('at rest nothing is running: no physics, no frame requests', [w.motionLive(), w.motion.raf], [false, 0]);
      let frames = 0; w.requestAnimationFrame = f => { frames++; return 7; };
      w.cancelAnimationFrame = () => {};
      w.showDice(4, 3, false); k.tap(0);
      check('a tap starts no physics at all', [w.motion.raf, w.motionLive()], [0, false]);
      k.down(1, 300, 300); ptr(w, k.face(1), 'pointermove', 330, 300);
      check('a drag asks for a frame while it is going on', [w.motion.raf, w.motionLive()], [7, true]);
      w.motionFrame(1000); w.motion.raf = 0; w.motionFrame(1016);
      check('every frame asks for the next while the die is held', w.motion.raf, 7);
      ptr(w, k.face(1), 'pointerup', 330, 300);
      for(let i=0;i<200;i++){ w.motion.raf = 0; w.motionFrame(1100 + i * 16); }
      check('...and when everything has come to rest, the frames stop', [w.motion.raf, w.motionLive()], [0, false]);
      // a die held still (the pointer not moving at all) keeps the loop running, whichever die it is
      for(const hold of [0, 1]){
        w.showDice(4, 3, false); w.motion.raf = 0;
        k.down(hold, 300, 300); ptr(w, k.face(hold), 'pointermove', 340, 300);
        for(let i=0;i<120;i++){ w.motion.raf = 0; w.motionFrame(5000 + i * 16); }
        check('a die ' + hold + ' that is held still keeps asking for frames (it is not at rest until it is put down)', [w.motionLive(), w.motion.raf], [true, 7]);
        ptr(w, k.face(hold), 'pointerup', 340, 300);
        for(let i=0;i<200;i++){ w.motion.raf = 0; w.motionFrame(9000 + i * 16); }
      }
      // a die that is sent back to its resting place forgets any speed it had
      w.bodies[0].vx = 900; w.bodies[0].vy = -300; w.bodies[0].vz = 400; w.bodies[0].z = 20; w.bodies[0].hot = true;
      w.setDiceRest(0, 5);
      check('putting a die back at its resting place stops it dead: no speed left in any direction, nothing running', [w.bodies[0].vx, w.bodies[0].vy, w.bodies[0].vz, w.bodies[0].z, w.motionLive()], [0, 0, 0, 0, false]);
      // a long pause (the tab was hidden) is not played out: one frame never runs more than a few hundredths of a second of motion
      w.showDice(4, 3, false); w.motion.raf = 0; w.motion.acc = 0;
      w.bodies[1].z = 18; w.bodies[1].hot = true; w.motion.last = 1000; w.motionFrame(6000);
      check('after a 5 second gap between two frames the die has only fallen for a moment (not landed and settled)', [w.bodies[1].z > 5, w.bodies[1].z < 18], [true, true]);
      w.advanceMotion(60000);
      check('and an enormous catch-up is cut short: no time is saved up to be played later', [w.motion.acc < 9, w.bodies[1].z], [true, 0]);
      w.showDice(4, 3, false);
      w.requestAnimationFrame = () => 0;
      // two free dice that run into each other bounce apart
      const w2 = mk(), k2 = kit(w2); let clacks = 0; w2.sfxClack = () => clacks++;
      w2.setup.pos[0] = { x:-170, y:0 }; w2.bodies[0].x = -170; w2.bodies[0].vx = 1500; w2.bodies[0].hot = true;
      w2.setup.pos[1] = { x:-60, y:0 }; w2.bodies[1].x = -60;
      for(let i = 0; i < 400 && !clacks; i++) w2.advanceMotion(8.4);
      const vHit = [w2.bodies[0].vx, w2.bodies[1].vx];
      check('at the moment they meet the still die is sent off with some of the other\'s speed, and the sliding die slows', [vHit[1] > 100, vHit[0] < 1500 * 0.6], [true, true]);
      w2.advanceMotion(1500);
      check('a die sent sliding into the other one bumps it, clicks once, and they stop apart on the felt', [clacks, k2.ell() >= 0.999, w2.bodies[0].z, w2.bodies[1].z, w2.motionLive()], [1, true, 0, 0, false]);
      check('...the struck die went a little way too', w2.bodies[1].x > -60, true);
      w2.close();
      // the shadow follows the height
      const w3 = mk(), k3 = kit(w3);
      check('on the felt the shadow is full size', [k3.shadow(0).style.transform, k3.shadow(0).style.opacity], ['scale(1)', '1']);
      k3.down(0, 300, 300); k3.move(0, 250, 300);
      check('lifted a little: 80% size, 60% dark', [k3.shadow(0).style.transform, k3.shadow(0).style.opacity], ['scale(0.8)', '0.6']);
      k3.up(0, 250, 300);
      check('put down: back to full', [k3.shadow(0).style.transform, k3.shadow(0).style.opacity], ['scale(1)', '1']);
      w3.close(); w.close();
    }

    // ---- 27i. the flight plan: exact end, never through the wall, never through each other, same plan for the same throw
    {
      const w = mk(), R = rng(1999);
      const plans = [];
      for(const phone of [false, true]){
        const M = phone ? { ax:66, ay:37, ymin:-66, ymax:26, wallX:124, xmin:-127 } : { ax:82, ay:47, ymin:-71, ymax:22, wallX:374, xmin:-381 };
        const hs = Math.round(M.ay * 0.6);
        for(let n=0;n<250;n++){
          const x0 = M.xmin + R() * (M.wallX - M.xmin), cy = M.ymin + hs + R() * (M.ymax - hs - (M.ymin + hs));
          const p = { a:[{ x:x0 + (R()-0.5)*6, y:cy - hs, z:20 + R()*30 }, { x:x0, y:cy + hs, z:20 + R()*30 }], rest:[{ x:phone ? -36 : -46, y:0 }, { x:phone ? 36 : 46, y:0 }],
            wallX:M.wallX, v:{ x:200 + R()*2800, y:(R()-0.5)*700 }, ymin:M.ymin, ymax:M.ymax, ax:M.ax, ay:M.ay, r:[R(), R(), R(), R(), R(), R()] };
          plans.push([p, w.planThrow(p), M]);
        }
      }
      const bad = [];
      for(const [p, pl, M] of plans){
        const [A, B] = pl.samples, L = A.length - 1;
        if(A[0].t !== 0 || B[0].t !== 0 || A[L].t !== pl.dur) bad.push('time span');
        if(A[L].x !== p.rest[0].x || A[L].y !== 0 || A[L].z !== 0 || A[L].k !== 0 || B[L].x !== p.rest[1].x || B[L].y !== 0 || B[L].z !== 0 || B[L].k !== 0) bad.push('does not end at rest');
        if(Math.abs(A[0].x - p.a[0].x) > 1e-9 || Math.abs(B[0].y - p.a[1].y) > 1e-9 || A[0].k !== 1) bad.push('does not start at the hand');
        const wi = A.findIndex(s => s.t === pl.wallT);
        if(wi < 0 || Math.abs(A[wi].x - p.wallX) > 1e-9 || Math.abs(B[wi].x - p.wallX) > 1e-9) bad.push('no wall contact sample');
        A.forEach((s, j) => {
          const t = B[j], nx = (s.x - t.x)/p.ax, ny = (s.y - t.y)/p.ay;
          if(nx*nx + ny*ny < 0.999) bad.push('dice overlap at ' + s.t);
          for(const q of [s, t]){
            if(q.z < 0) bad.push('below the felt');
            if(q.t >= pl.wallT && q.x > p.wallX + 1e-9) bad.push('through the wall');
            if(q.t > 0 && (q.y < p.ymin - 0.01 || q.y > p.ymax + 4.01)) bad.push('off the tray at ' + q.t);
          }
          if(j > 0 && (A[j].k > A[j-1].k + 1e-9 || B[j].k > B[j-1].k + 1e-9)) bad.push('spin runs backwards');
          if(j > 0 && A[j].t <= A[j-1].t) bad.push('time not increasing');
        });
        if(A.some((s, j) => j < L && (A[j+1].x !== s.x || A[j+1].y !== s.y) && !(s.k > 0))) bad.push('spin stops while the die is still sliding');
        if(!(pl.dur >= 550 && pl.dur <= 1500)) bad.push('duration ' + pl.dur);
        if(pl.hits.some((h, j) => j > 0 && h.t < pl.hits[j-1].t) || pl.hits.some(h => h.p < 0.15 || h.p > 1)) bad.push('hits out of order or out of range');
        if(pl.hits.filter(h => h.kind === 'wall').length !== 2 || pl.hits.filter(h => h.kind === 'wall').some(h => h.t !== pl.wallT)) bad.push('wall hits');
      }
      check('500 random throws (desktop and phone, any speed, any aim): ends exactly at rest, starts at the hand, touches the wall, never through it or each other, never under the felt, spin runs one way', [...new Set(bad)].slice(0, 5), []);
      const base = plans[10][0];
      check('the same throw always makes the same plan', JSON.stringify(w.planThrow(base)) === JSON.stringify(w.planThrow(JSON.parse(JSON.stringify(base)))), true);
      const hard = Object.assign({}, base, { v:{ x:2600, y:0 } }), soft = Object.assign({}, base, { v:{ x:520, y:0 } });
      check('a harder flick reaches the wall sooner', w.planThrow(hard).wallT <= w.planThrow(soft).wallT, true);
      const nowhere = Object.assign({}, base, { v:{ x:-300, y:9000 } }), plan0 = w.planThrow(nowhere);
      check('even a nonsense flick (backwards, steep) is turned into a sensible one', [plan0.samples[0].length > 20, plan0.dur >= 550 && plan0.dur <= 1500], [true, true]);
      w.pendingShot = { vx:NaN, vy:3 };
      check('a flick that is not a number is replaced by a middling one', w.takeShot(), { vx:1250, vy:0 });
      check('and a shot is used up by the throw that takes it', [w.pendingShot, w.takeShot()], [null, { vx:1250, vy:0 }]);
      // dice swapped in depth (the throw started while they were still changing places): still no overlap
      const flipped = JSON.parse(JSON.stringify(base)); const ty = flipped.a[0].y; flipped.a[0].y = flipped.a[1].y; flipped.a[1].y = ty;
      const pf = w.planThrow(flipped), ov = pf.samples[0].filter((s, j) => { const t = pf.samples[1][j], nx = (s.x - t.x)/82, ny = (s.y - t.y)/47; return nx*nx + ny*ny < 0.999; }).length;
      check('thrown with the dice the other way round in depth: still never overlapping, still ends at rest', [ov, pf.samples[0].slice(-1)[0].x, pf.samples[1].slice(-1)[0].x], [0, -46, 46]);
      w.close();
    }

    // ---- 27j. fairness: whatever the hand does, the roll is two fair dice
    {
      const T = { v: 50000 };
      const w = mk(); w.nowMs = () => T.v; const k = kit(w); w.G.settings.turbo = true;
      const R = rng(4242), pairs = Array(36).fill(0), byFlick = { soft:[], hard:[] };
      const N = 1500;
      for(let n=0;n<N;n++){
        w.showDice(4, 3, false);
        const hardFlick = R() < 0.5, per = hardFlick ? 8 + R() * 14 : 2 + R() * 4;
        k.down(0, 300, 300); ptr(w, k.face(0), 'pointermove', 420, 300); w.advanceMotion(120);
        for(let s=1;s<=6;s++){ T.v += 10; ptr(w, k.face(0), 'pointermove', 420 + per * s, 300 + (R()-0.5) * 6 * s); w.advanceMotion(10); }
        T.v += 4; ptr(w, k.face(0), 'pointerup', 420 + per * 6, 300);
        if(w.G.phase === 'rolling') await settle(w); else { w.advanceMotion(900); w.startRoll(); await settle(w); }
        const a = w.G.last.d1, b = w.G.last.d2; pairs[(a-1)*6 + (b-1)]++;
        (hardFlick ? byFlick.hard : byFlick.soft).push(a + b);
      }
      const chi = pairs.reduce((s, o) => s + (o - N/36)*(o - N/36)/(N/36), 0);
      truthy('after ' + N + ' hand throws of every speed the 36 pairs are uniform (chi-square ' + chi.toFixed(1) + ', limit 85)', chi < 85);
      const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
      check('hard flicks and soft ones both average a total of 7', [Math.abs(mean(byFlick.hard) - 7) < 0.45, Math.abs(mean(byFlick.soft) - 7) < 0.45], [true, true]);
      check('the page stayed healthy and bankroll untouched (no bets)', [w.errs, w.G.bankroll], [[], 1000]);
      w.close();
    }
  }

  // ======================================================== 28. roll sounds: each total has its own cue, played once when the dice settle (sounds only; the roll is untouched)
  {
    const talkative = w => { w.G.settings.turbo = false; w.G.settings.sound = true; w.G.settings.keep = false; };
    // record every note of the roll cues (toneAt is only used by the cues)
    const spy = w => { const log = w.__log = []; w.toneAt = (f, d, type, v, at, to) => log.push({ f, d, type, v, at, to }); return log; };
    const sig = notes => JSON.stringify(notes);
    // 0. the stickman's voice is gone: no speech anywhere, no voice settings on the page
    const w0 = load({}); talkative(w0);
    let speechTouched = 0; Object.defineProperty(w0, 'speechSynthesis', { get(){ speechTouched++; return undefined; }, configurable:true });
    w0.SpeechSynthesisUtterance = function(){ speechTouched++; };
    await roll(w0,5,5); await roll(w0,4,3);
    check('no speech: nothing ever asks the browser to speak', speechTouched, 0);
    check('no speech: the voice rows, switch and picker are gone from the page', ['voice-row','voice-pick-row','set-voice','set-voice-pick','voice-hint'].map(id => $(w0,id)), [null, null, null, null, null]);
    check('no speech: the voice code and settings are gone', [typeof w0.speak, typeof w0.speechOK, typeof w0.stopSpeech, typeof w0.primeSpeech, 'voice' in w0.G.settings, 'voiceName' in w0.G.settings], ['undefined','undefined','undefined','undefined', false, false]);
    check('no speech: a roll still works with no errors', [w0.G.table.point, w0.errs.length], [null, 0]);
    w0.close();

    // 1. which cue each total gets
    const wn = load({}); talkative(wn);
    check('the cue for each total', [2,3,4,5,6,7,8,9,10,11,12].map(n => wn.rollCueName(n)), ['snake','deuce','number','number','number','seven','number','number','number','yo','boxcars']);
    check('a 7 on the come-out is a natural (positive), a 7 with the point on is the bad one; no other total cares', [wn.rollCueName(7, true), wn.rollCueName(7, false), wn.rollCueName(7), [2,3,4,5,6,8,9,10,11,12].map(n => wn.rollCueName(n, true)).join() === [2,3,4,5,6,8,9,10,11,12].map(n => wn.rollCueName(n, false)).join()], ['natural', 'seven', 'seven', true]);
    check('totals no pair of dice makes get no cue', [wn.rollCueName(0), wn.rollCueName(1), wn.rollCueName(13), wn.rollCueName(NaN), wn.rollCueName(undefined)], [null, null, null, null, null]);
    // 2. what each cue sounds like
    const sigs = {}, log = spy(wn);
    for(let n = 2; n <= 12; n++){ log.length = 0; const len = wn.playRollCue(n); sigs[n] = { notes: log.slice(), len }; }
    log.length = 0; const nlen = wn.playRollCue(7, true); sigs.natural = { notes: log.slice(), len: nlen };
    check('4 5 6 8 9 10 all play exactly the same sound (hard or easy, point or not)', [4,5,6,8,9,10].map(n => sig(sigs[n].notes) === sig(sigs[4].notes) && sigs[n].notes.length > 0), [true,true,true,true,true,true]);
    const kinds = [4, 7, 2, 3, 11, 12];
    check('the bad 7, the come-out 7, 2, 3, 11, 12 and the shared sound are seven different sounds', new Set(kinds.concat(['natural']).map(n => sig(sigs[n].notes))).size, 7);
    check('every cue has notes with a real pitch, length and volume', [2,3,4,7,11,12,'natural'].every(n => sigs[n].notes.every(x => x.f > 20 && x.f < 4000 && x.d > 0 && x.v > 0 && x.v < 0.2 && x.at >= 0)), true);
    check('every cue is short (under three quarters of a second)', [2,3,4,7,11,12,'natural'].every(n => sigs[n].len > 0 && sigs[n].len < 0.75), true);
    check('the shared 4-10 sound is a quick soft ding, shorter than the 7', [sigs[4].len < 0.25, sigs[4].len < sigs[7].len], [true, true]);
    const falls = n => sigs[n].notes.filter(x => x.to).every(x => x.to < x.f), rises = n => sigs[n].notes.filter(x => x.to).every(x => x.to > x.f);
    check('the 7 with the point on is the bad sound: a harsh buzz (sawtooth) that only falls, with a low thud, and the longest cue', [sigs[7].notes.some(x => x.type === 'sawtooth'), falls(7), sigs[7].notes.some(x => x.f < 100), [2,3,4,11,12,'natural'].every(n => sigs[n].len < sigs[7].len)], [true, true, true, true]);
    check('the 7 buzz is the only harsh sound', [2,3,4,11,12,'natural'].some(n => sigs[n].notes.some(x => x.type === 'sawtooth')), false);
    const nt = sigs.natural.notes;
    check('a 7 on the come-out is positive: a bright run of rising notes, in a major key, nothing harsh, nothing falling', [nt.length >= 3, nt.slice(0,3).every((x, i, a) => i === 0 || (x.f > a[i-1].f && x.at > a[i-1].at)), nt.every(x => x.type !== 'sawtooth' && !(x.to && x.to < x.f)), Math.min(...nt.map(x => x.f)) >= 500], [true, true, true, true]);
    check('the come-out 7 is a different sound from the happy yo-eleven and from the bad 7', [sig(sigs.natural.notes) !== sig(sigs[11].notes), sig(sigs.natural.notes) !== sig(sigs[7].notes)], [true, true]);
    check('11 (yo) is the happy one: it only rises', [rises(11), sigs[11].notes.some(x => x.to)], [true, true]);
    check('2 (snake eyes) is two quick blips on the same pitch', [sigs[2].notes.length, sigs[2].notes[0].f === sigs[2].notes[1].f, sigs[2].notes[1].at > sigs[2].notes[0].at], [2, true, true]);
    check('3 (ace-deuce) steps down', [sigs[3].notes.length, sigs[3].notes[1].f < sigs[3].notes[0].f], [2, true]);
    check('12 (boxcars) is a heavy low double thud', [sigs[12].notes.slice(0,2).every(x => x.f < 120 && x.type === 'sine'), sigs[12].notes[1].at > sigs[12].notes[0].at], [true, true]);
    log.length = 0;
    check('a total with no cue plays nothing and takes no time', [wn.playRollCue(13), wn.playRollCue(1), log.length], [0, 0, 0]);
    // gating: sound off, turbo
    wn.G.settings.sound = false; log.length = 0; wn.playRollCue(7); wn.playRollCue(7, true);
    check('sound effects off: the cue is silent', log.length, 0);
    wn.G.settings.sound = true; wn.G.settings.turbo = true; wn.playRollCue(7); wn.playRollCue(7, true);
    check('turbo: the cue is silent (rolls come too fast)', log.length, 0);
    wn.G.settings.turbo = false; wn.playRollCue(7);
    check('and back to normal it plays again', log.length > 0, true);
    wn.close();

    // 3. through real rolls: once per roll, after the dice settle, the right cue, hard or easy
    const w = load({}); talkative(w); const wl = spy(w);
    let order = []; w.sfxWin = () => order.push('win'); w.sfxLose = () => order.push('lose'); w.sfxPoint = () => order.push('point'); w.sfxPush = () => order.push('push');
    w.toneAt = (f, d, type, v, at, to) => { wl.push({ f, d, type, v, at, to }); order.push('note'); };
    const cueFor = n => sig(sigs[n].notes);
    const rolls = [[5,5,10],[6,4,10],[4,3,7],[5,6,11],[1,1,2],[2,1,3],[6,6,12],[3,3,6],[5,6,11],[4,2,6],[1,3,4],[2,2,4],[4,4,8],[3,5,8],[3,3,6],[1,6,7],[2,3,5],[4,5,9],[1,4,5],[2,5,7],[1,5,6],[5,4,9]];
    const perRoll = [];
    for(const [a, b, sum] of rolls){
      const comeOut = w.G.table.point === null;     // no point on: a 7 now is a natural
      wl.length = 0; w.rollDice(a, b);
      const during = wl.length;                 // nothing while the dice are still tumbling
      await settle(w);
      const want = (sum === 7 && comeOut) ? sig(sigs.natural.notes) : cueFor(sum);
      perRoll.push({ sum, comeOut, during, same: sig(wl.slice()) === want, notes: wl.length });
    }
    check('the rolls covered both a come-out 7 and a 7 with the point on', [perRoll.filter(r => r.sum === 7 && r.comeOut).length, perRoll.filter(r => r.sum === 7 && !r.comeOut).length], [2, 1]);
    check('nothing is played by the cue while the dice are still rolling', perRoll.every(r => r.during === 0), true);
    check('every roll plays exactly its own total\'s cue, once, when it settles (hard and easy, come-out and point alike)', perRoll.every(r => r.same), true);
    check('the page stayed healthy through the rolls', w.errs.length, 0);
    // the win / lose chime follows the cue instead of sitting on top of it
    const w4 = load({}); talkative(w4); spy(w4);
    const ord4 = [], at4 = {};
    const mark = (name) => { if(!(name in at4)) at4[name] = Date.now(); ord4.push(name); };
    w4.toneAt = () => mark('note'); w4.sfxWin = () => mark('win'); w4.sfxLose = () => mark('lose'); w4.sfxPoint = () => mark('point');
    const gap = async (a, b, chimeName, minGapMs) => { ord4.length = 0; for(const k of Object.keys(at4)) delete at4[k]; await roll(w4, a, b); return [ord4[0], ord4[ord4.length-1], ord4.filter(x => x === chimeName).length, at4[chimeName] - at4.note >= minGapMs]; };
    hit(w4, 'pass');
    check('a come-out 7 on the Pass Line: the happy run first, then the winning chime only after it has finished (about 0.4 s), never on top of it', await gap(4, 3, 'win', 360), ['note', 'win', 1, true]);
    hit(w4, 'pass');
    check('a point set: the shared ding, then the point chime after the ding has finished (about 0.2 s)', await gap(3, 3, 'point', 180), ['note', 'point', 1, true]);
    check('a seven out: the 7 buzz, then the losing chime after it', await gap(1, 6, 'lose', 600), ['note', 'lose', 1, true]);
    w4.close();
    // sound off / turbo through real rolls
    const w5 = load({}); talkative(w5); const l5 = spy(w5);
    w5.G.settings.sound = false; await roll(w5, 3, 4); await roll(w5, 5, 5);
    check('sound effects off: rolls play no cue', l5.length, 0);
    w5.G.settings.sound = true; w5.G.settings.turbo = true; await roll(w5, 3, 4); await roll(w5, 6, 6);
    check('turbo: rolls play no cue', l5.length, 0);
    w5.close();
    // the roll itself never sees the sounds
    for(const f of ['startRoll', 'rollDice', 'randDie', 'randInt']) check('the code behind ' + f + ' never mentions a roll cue', /playRollCue|rollCueName|ROLL_CUES|toneAt/.test(w[f].toString()), false);
    w.close();

    // 4. the real sound path (a fake Web Audio): the cue is scheduled as oscillators, the 7 is a buzz, nothing breaks
    const wa = load({}, { audio:true }); talkative(wa);
    await roll(wa, 4, 3);                       // a 7 on the come-out: a natural, no buzz
    check('a come-out 7 plays no buzz through the audio engine, only rising triangle notes', [wa.__audio.osc.filter(o => o.type === 'sawtooth').length, wa.__audio.osc.filter(o => o.type === 'triangle').length >= 3], [0, true]);
    await roll(wa, 5, 5); await roll(wa, 4, 3);   // the point is 10, then a 7: seven out
    const buzz = wa.__audio.osc.filter(o => o.type === 'sawtooth');
    check('a 7 with the point on plays two falling sawtooth buzzes through the audio engine, each gliding down in pitch', [buzz.length, buzz.every(o => o.f1 < o.f0 && o.t1 > o.t0)], [2, true]);
    check('the two buzzes are scheduled one after the other (the second starts about 0.2 s after the first), not all at once', [buzz.length === 2 && Math.abs((buzz[1].startAt - buzz[0].startAt) - 0.2) < 0.001], [true]);
    check('the cue is scheduled on the audio clock (starts at or after now, stops after it starts)', wa.__audio.osc.every(o => o.startAt >= 0 && o.stopAt > o.startAt), true);
    const n7 = buzz.length; await roll(wa, 2, 3);
    check('a 5 plays no buzz', wa.__audio.osc.filter(o => o.type === 'sawtooth').length, n7);
    check('the audio engine was created once and no errors', [wa.__audio.created, wa.errs.length], [1, 0]);
    wa.G.settings.sound = false; const nOsc = wa.__audio.osc.length; await roll(wa, 4, 3);
    check('sound off: not a single oscillator is created', wa.__audio.osc.length, nOsc);
    wa.close();
    // audio that throws must not break the table
    const wt = load({}, { audio:{ throws:true } }); talkative(wt);
    await roll(wt, 5, 5); await roll(wt, 4, 3);
    check('an audio engine that throws does not stop the roll finishing', [wt.G.phase, wt.G.table.point, wt.errs.length], ['betting', null, 0]);
    wt.close();
    // a browser with no audio at all
    const wq = load({}); talkative(wq); await roll(wq, 5, 5);
    check('no audio in the browser: the roll finishes quietly', [wq.G.phase, wq.G.table.point, wq.errs.length], ['betting', 10, 0]);
    wq.close();

    // 5. saved games from the voice days still load, and the old voice settings are dropped on the next save
    const wo = load({ [K.sess]: { settings:{ voice:false, voiceName:'Alex', sound:false, coach:false } } });
    check('a saved game with the old voice settings loads cleanly and keeps its other settings', [wo.errs.length, wo.G.settings.sound, wo.G.settings.coach], [0, false, false]);
    wo.G.settings.turbo = false; await roll(wo, 5, 5);
    const saved = JSON.parse(wo.localStorage.getItem(K.sess)).settings;
    check('the next save no longer carries the voice settings', ['voice' in saved, 'voiceName' in saved], [false, false]);
    wo.close();
  }

  // ======================================================== 15. fuzz: random play, invariants after every action
  for(const seed of [11, 202, 3033, 4044]){
    const w = load({ [K.exp]:{ level:'pro' }, [K.bank]:{ balance:100000 } }); turbo(w);
    const R = rng(seed), pick = a => a[Math.floor(R()*a.length)], base = 100000;
    const keys = ['pass','dontpass','come','dontcome','field','hard4','hard6','hard8','hard10','any7','anycraps','yo','aces','boxcars','acedeuce','place4','place5','place6','place8','place9','place10','buy4','buy5','buy6','buy8','buy9','buy10'];
    w.G.settings.keep = (seed % 2 === 1); w.G.settings.autopress = (seed === 3033); w.renderAll();
    let bad = [], rolls = 0, actions = 0;
    for(let i=0;i<300 && bad.length<5;i++){
      const r = R(); actions++;
      if(r < 0.30){ w.G.chip = pick([5,10,25,50,100,500]); hit(w, pick(keys)); }
      else if(r < 0.38){ const t = w.G.table, cand = t.bets.filter(b => (b.type==='pass'||b.type==='dontpass'||b.type==='come'||b.type==='dontcome') && w.E.oddsRoom(t,b)>0); if(cand.length){ const b = pick(cand); w.G.chip = pick([5,25,100]); w.addOddsToBet(b.id); } }
      else if(r < 0.46){ w.takeDown(pick(keys)); }
      else if(r < 0.50){ const b = w.G.table.bets.filter(x => x.odds>0); if(b.length){ const x = pick(b); const k = (x.type==='come'||x.type==='dontcome') ? null : x.type; if(k) w.takeDownOdds(k); } }
      else if(r < 0.56){ click(w, $(w,'btn-undo')); }
      else if(r < 0.59){ click(w, $(w,'btn-clear')); }
      else if(r < 0.62){ click(w, $(w,'btn-rebet')); }
      else if(r < 0.65){ if(R() < 0.5) w.doPress(pick([4,5,6,8,9,10])); else w.placeOnSpot(pick(keys)); }
      else { rolls++; await roll(w, 1+Math.floor(R()*6), 1+Math.floor(R()*6)); }
      bad = bad.concat(invariants(w, base, 'seed '+seed+' step '+i), domMatchesState(w, 'seed '+seed+' step '+i));
      if(w.errs.length){ bad.push('script error '+w.errs[0]); }
    }
    check('fuzz seed '+seed+' ('+actions+' actions, '+rolls+' rolls): money conserved and screen agrees', bad.slice(0,5), []);
    w.close();
  }

  console.log('\n'+(failures ? failures+' FAILED' : 'all passed')+' ('+passes+' checks ok)');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('FAIL (exception):', e.stack); process.exit(1); });
