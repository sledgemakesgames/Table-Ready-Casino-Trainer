/* Blackjack bet advice is built on the session's usual bet, not on whatever is in the bet box.
   node test_betadvice.js [path/to/blackjack/index.html]   (needs jsdom: NODE_PATH=.../node_modules) */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const FILE = process.argv[2] || path.join(__dirname, 'index.html');
const HTML = fs.readFileSync(FILE, 'utf8');
let failures = 0, passes = 0;
function check(name, actual, expected){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(ok) passes++; else failures++;
  console.log((ok ? 'OK: ' : 'FAIL: ') + name + (ok ? '' : '  (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const SESSION_KEY_GUESS = /session/i;

async function load(storage){
  const vc = new VirtualConsole(); // silence jsdom "not implemented" noise
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://tableready.xyz/blackjack/',
    beforeParse(w){ Object.keys(storage || {}).forEach(k => w.localStorage.setItem(k, storage[k])); w.alert = () => {}; } });
  await wait(300);
  const w = dom.window;
  w.document.getElementById('set-turbo').checked = true; // instant dealing; readSettings() copies this into G.turbo
  w.document.getElementById('set-showcount').checked = true;
  w.readSettings();
  w.alert = () => {};
  return w;
}
const tip = w => w.document.getElementById('bet-tip').textContent;
function entry(openBet, openTC, extra){ return Object.assign({ label:'Hand', net:0, headline:{text:'Push',cls:'push'}, dealerCards:[], hands:[{cards:[],status:'stand',bet:openBet||10}], results:[], feedback:[], openBet, openTC }, extra || {}); }
async function until(fn, ms){ const t0 = Date.now(); while(Date.now() - t0 < (ms || 3000)){ if(fn()) return true; await wait(10); } return false; }

// Deal one hand with a given opening bet; returns once the player can act (or the round already ended).
async function deal(w, bet){
  w.document.getElementById('bet-amount').value = String(bet);
  w.G.needsReshuffle = false;
  const before = w.G.history.length;
  w.startDeal();
  await until(() => w.G.phase === 'player' || w.G.history.length > before);
  return before;
}
async function finishHand(w, before){
  let guard = 0;
  while(w.G.history.length === before && guard++ < 40){
    if(w.G.phase === 'player' && !w.G.locked) w.doAction('S');
    await wait(15);
  }
  await until(() => w.G.phase === 'betting');
}

(async () => {
  let w = await load({});

  console.log('=== buildBetTip: wording and amounts ===');
  check('flat count, no history yet', w.buildBetTip(0.4, 0, 1000), 'True count 0.4 — a flat bet is fine here.');
  check('flat count shows the usual bet it is built on', w.buildBetTip(0.4, 25, 1000), 'True count 0.4 — a flat bet is fine here (your usual bet is about $25).');
  check('negative count is flat too', w.buildBetTip(-3, 25, 1000), 'True count -3 — a flat bet is fine here (your usual bet is about $25).');
  check('TC 1.9 is still flat (matches the old ramp)', /flat bet/.test(w.buildBetTip(1.9, 25, 1000)), true);
  check('TC 3, usual $25 -> about $75', w.buildBetTip(3.2, 25, 1000), 'True count 3.2 — press to about $75 (3x your usual bet of about $25).');
  check('TC 2, usual $25 -> $50', /press to about \$50 \(2x/.test(w.buildBetTip(2, 25, 1000)), true);
  check('TC 8+ is capped at 8x', /press to about \$200 \(8x/.test(w.buildBetTip(14, 25, 1000)), true);
  check('large amounts snap to the nearest $5 (usual 27, 2x = 54 -> 55)', /press to about \$55 \(2x your usual bet of about \$27\)/.test(w.buildBetTip(2, 27, 1000)), true);
  check('tiny bets stay exact (usual 2, 3x = $6)', /press to about \$6 \(3x your usual bet of about \$2\)/.test(w.buildBetTip(3, 2, 1000)), true);
  check('fractional average is shown rounded (usual 24.6 -> $25)', /about \$25\)/.test(w.buildBetTip(3, 24.6, 1000)), true);
  check('capped by the bankroll that is free', w.buildBetTip(8, 25, 60), 'True count 8 — press to $60, the most you have free (8x your usual bet of about $25 would be $200).');
  check('not capped when it fits exactly', /press to about \$75/.test(w.buildBetTip(3, 25, 75)), true);
  check('no usable room figure -> no cap wording', /press to about \$75/.test(w.buildBetTip(3, 25, 0)), true);
  const noData = w.buildBetTip(3, 0, 1000);
  check('pressing count with no usual bet yet gives no dollar figure', /\$/.test(noData.replace(/^[^$]*(\(the dollar amount[^)]*\))?/, '')) || !/\$\d/.test(noData), true);
  check('pressing count with no usual bet says why', /3x your usual bet/.test(noData) && /once you have played a hand at a low count/.test(noData), true);

  console.log('\n=== sessionUsualBet: what counts ===');
  w.G.history = [];
  check('empty session -> null', w.sessionUsualBet(), null);
  w.G.history = [entry(25, 0), entry(25, 0.5), entry(35, -2)];
  check('averages flat/negative-count opening bets', Math.round(w.sessionUsualBet().amount * 100) / 100, 28.33);
  w.G.history = [entry(25, 0), entry(25, 0), entry(200, 3), entry(150, 2), entry(300, 7.5)];
  check('hands dealt at TC >= 2 (the pressed ones) are left out', w.sessionUsualBet().amount, 25);
  check('...and are not counted in hands', w.sessionUsualBet().hands, 2);
  w.G.history = [entry(25, 1.9)];
  check('TC 1.9 still counts as flat-count', w.sessionUsualBet().amount, 25);
  w.G.history = [entry(25, 2)];
  check('TC exactly 2 is a pressing count -> excluded', w.sessionUsualBet(), null);
  w.G.history = [{ label:'old', net:0, headline:{text:'Push'}, hands:[{bet:100}] }, entry(undefined, 0), entry(25, undefined), entry(0, 0), entry(-5, 0), entry('25', 0), entry(NaN, 0), entry(25, NaN), entry(Infinity, 0), null, entry(25, 0)];
  check('legacy / junk entries are ignored, not guessed at', w.sessionUsualBet().amount, 25);
  check('...only the one valid entry counted', w.sessionUsualBet().hands, 1);

  console.log('\n=== the advice no longer follows the bet box ===');
  w.G.history = [entry(25, 0), entry(25, 0.2)];
  w.G.showCount = true; w.G.phase = 'betting';
  w.buildShoe(); w.G.runningCount = 6; // TC 3.0
  check('rig sanity: 2-deck shoe, TC 3', [w.G.shoe.length, w.trueCount()], [104, 3]);
  w.document.getElementById('bet-amount').value = '5';
  w.renderBetTip();
  const tipSmall = tip(w);
  w.document.getElementById('bet-amount').value = '500';
  w.document.getElementById('bet-amount').dispatchEvent(new w.Event('input'));
  const tipBig = tip(w);
  check('TC 3 + usual $25 -> $75 whatever the box holds (box 5)', /press to about \$75 \(3x your usual bet of about \$25\)/.test(tipSmall), true);
  check('same advice with $500 in the box', tipBig, tipSmall);
  w.document.getElementById('bet-amount').value = '';
  w.renderBetTip();
  check('same advice with an empty box', tip(w), tipSmall);
  w.G.runningCount = 0; w.renderBetTip();
  check('at TC 0 it is a flat-bet message that names the usual bet', tip(w), 'True count 0 — a flat bet is fine here (your usual bet is about $25).');
  w.G.showCount = false; w.renderBetTip();
  check('count display off -> no tip at all', tip(w), '');
  w.G.showCount = true; w.G.phase = 'player'; w.renderBetTip();
  check('only shown while betting', tip(w), '');
  w.G.phase = 'betting';

  console.log('\n=== room for the main bet (bankroll minus side bets) ===');
  w.G.bankroll = 1000; check('no side bets', w.betRoomForMainBet(), 1000);
  w.document.getElementById('sb-pp').checked = true; w.document.getElementById('sb-pp-amt').value = '40';
  check('side bet is held back', w.betRoomForMainBet(), 960);
  w.G.bankroll = 100; w.buildShoe(); w.G.runningCount = 16; // TC 8 -> 8 x $25 = $200, only $60 free
  w.renderBetTip();
  check('tip caps at what is actually free', /press to \$60, the most you have free \(8x your usual bet of about \$25 would be \$200\)/.test(tip(w)), true);
  w.document.getElementById('sb-pp').checked = false; w.G.bankroll = 1000;

  console.log('\n=== no ratchet: following the advice does not inflate the advice ===');
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  w.G.history = [entry(25, 0)];
  let sumAll = 25, nAll = 1, maxAdvised = 0, drift = false;
  for(let i = 0; i < 400; i++){
    const tc = Math.round(((rnd() + rnd() + rnd() - 1.5) * 8) * 10) / 10; // roughly -4..+4 with a fat middle
    const units = w.suggestedBetUnits(tc);
    const usual = w.sessionUsualBet().amount;
    const bet = units > 1 ? w.roundBet(usual * units) : 25; // a player who flat-bets $25 and presses exactly as advised
    if(units > 1) maxAdvised = Math.max(maxAdvised, bet);
    if(Math.abs(usual - 25) > 1e-9) drift = true;
    w.G.history.push(entry(bet, tc)); sumAll += bet; nAll++;
  }
  check('usual bet stays exactly $25 over 400 followed-advice hands', drift, false);
  check('largest advised bet never exceeds 8 units', maxAdvised <= 200, true);
  check('(for contrast) a plain average of all bets would have drifted well above $25', sumAll / nAll > 40, true);

  console.log('\n=== real hands through the UI record opening bet + count ===');
  w.G.history = []; w.G.bankroll = 1000;
  w.buildShoe(); w.G.runningCount = 0;
  let b = await deal(w, 25);
  await finishHand(w, b);
  let last = w.G.history[w.G.history.length - 1];
  check('flat-count hand stores openBet 25', last.openBet, 25);
  check('...and the count it was dealt at', last.openTC, 0);
  check('usual bet is now 25', Math.round(w.sessionUsualBet().amount), 25);
  check('G.openBet is cleared after the round', [w.G.openBet, w.G.openTC], [null, null]);

  // a hand that is doubled must still record the opening bet, not the doubled amount
  let doubledOK = false, tries = 0;
  while(!doubledOK && tries++ < 25){
    w.G.bankroll = Math.max(w.G.bankroll, 1000);
    b = await deal(w, 20);
    if(w.G.phase === 'player' && w.G.hands[0] && w.canDouble(w.G.hands[0]) && !w.isFreeDouble(w.G.hands[0])){
      w.doAction('D');
      await finishHand(w, b);
      last = w.G.history[w.G.history.length - 1];
      if(last.hands.some(h => h.bet === 40)){
        doubledOK = true;
        check('doubled hand: stored hand bet is 40 but openBet stays 20', [last.hands[0].bet, last.openBet], [40, 20]);
      }
    } else { await finishHand(w, b); }
    if(w.G.needsReshuffle || w.G.shoe.length < 40){ w.buildShoe(); }
  }
  check('found a hand to double', doubledOK, true);

  // a hand dealt at a high count is recorded but kept out of the usual bet
  const usualBefore = w.sessionUsualBet().amount;
  w.buildShoe(); w.G.runningCount = 12; // TC 6
  b = await deal(w, 150);
  const tcAtDeal = w.G.openTC;
  await finishHand(w, b);
  last = w.G.history[w.G.history.length - 1];
  check('high-count hand records openBet 150 and TC 6', [last.openBet, last.openTC], [150, 6]);
  check('...but the usual bet does not move', w.sessionUsualBet().amount, usualBefore);
  check('TC was captured before any card was drawn', tcAtDeal, 6);

  console.log('\n=== stats card ===');
  w.renderStats();
  const cards = Array.from(w.document.querySelectorAll('#stats-grid .stat-card')).map(c => [c.querySelector('.sl').textContent, c.querySelector('.sv').textContent]);
  const usualCard = cards.find(c => c[0] === 'Usual bet');
  check('"Usual bet" card is present', !!usualCard, true);
  check('...and matches the number the advice uses', usualCard && usualCard[1], String(Math.round(w.sessionUsualBet().amount)));
  check('...with an explanatory tooltip', /bet advice is built on this/.test(w.document.querySelector('#stats-grid .stat-card[title]').title), true);
  w.G.history = []; w.renderStats();
  check('empty session shows a dash', Array.from(w.document.querySelectorAll('#stats-grid .stat-card')).find(c => c.querySelector('.sl').textContent === 'Usual bet').querySelector('.sv').textContent, '—');

  console.log('\n=== reset stats starts the usual bet over ===');
  w.G.history = [entry(25, 0)]; w.buildShoe(); w.G.runningCount = 6; w.G.phase = 'betting'; w.renderBetTip();
  check('before reset: dollar advice', /press to about \$75/.test(tip(w)), true);
  w.document.getElementById('btn-reset-stats').click();
  check('history cleared', w.G.history.length, 0);
  check('after reset: no dollar figure until a flat-count hand is played', /once you have played a hand at a low count/.test(tip(w)), true);
  w.close();

  console.log('\n=== survives a reload (history is persisted) ===');
  w = await load({});
  w.G.history = [];
  w.buildShoe(); w.G.runningCount = 0;
  b = await deal(w, 40); await finishHand(w, b);
  w.buildShoe(); w.G.runningCount = 0;            // a fresh, flat shoe for the second hand too: otherwise the first hand's cards can leave the count high enough that this hand is not counted as a "usual" bet
  b = await deal(w, 60); await finishHand(w, b);
  const stored = {}; for(let i = 0; i < w.localStorage.length; i++){ const k = w.localStorage.key(i); stored[k] = w.localStorage.getItem(k); }
  const usualBeforeReload = w.sessionUsualBet().amount;
  w.close();
  w = await load(stored);
  check('two hands recorded: usual bet is 50 before reload', usualBeforeReload, 50);
  check('usual bet is still 50 after reload', w.sessionUsualBet() && w.sessionUsualBet().amount, 50);
  w.buildShoe(); w.G.runningCount = 6; w.G.phase = 'betting'; w.renderBetTip();
  check('and the advice is built on it', /press to about \$150 \(3x your usual bet of about \$50\)/.test(tip(w)), true);
  w.close();

  console.log('\n=== refreshing mid-hand keeps the opening bet and count ===');
  w = await load({});
  w.G.history = [];
  let sawPlayer = false, tries2 = 0;
  while(!sawPlayer && tries2++ < 25){
    w.buildShoe(); w.G.runningCount = 0;
    b = await deal(w, 25);
    if(w.G.phase === 'player') sawPlayer = true; else await finishHand(w, b);
  }
  check('reached a hand in progress', sawPlayer, true);
  const midState = {}; for(let i = 0; i < w.localStorage.length; i++){ const k = w.localStorage.key(i); midState[k] = w.localStorage.getItem(k); }
  const saved = JSON.parse(midState['house_edge_blackjack_hand_v1']);
  check('hand-state snapshot carries openBet/openTC', [saved.openBet, saved.openTC], [25, 0]);
  w.close();
  w = await load(midState);
  check('after reload the hand is resumed', w.G.phase, 'player');
  check('opening bet + count restored', [w.G.openBet, w.G.openTC], [25, 0]);
  const hBefore = w.G.history.length;
  let g2 = 0; while(w.G.history.length === hBefore && g2++ < 40){ if(w.G.phase === 'player' && !w.G.locked) w.doAction('S'); await wait(15); }
  last = w.G.history[w.G.history.length - 1];
  check('finishing the resumed hand still records it', [last.openBet, last.openTC], [25, 0]);
  w.close();

  console.log('\n=== a hand saved before this feature (no openBet) still resumes and is just not counted ===');
  w = await load({});
  w.G.history = [];
  sawPlayer = false; tries2 = 0;
  while(!sawPlayer && tries2++ < 25){ w.buildShoe(); w.G.runningCount = 0; b = await deal(w, 25); if(w.G.phase === 'player') sawPlayer = true; else await finishHand(w, b); }
  const old = {}; for(let i = 0; i < w.localStorage.length; i++){ const k = w.localStorage.key(i); old[k] = w.localStorage.getItem(k); }
  const oh = JSON.parse(old['house_edge_blackjack_hand_v1']); delete oh.openBet; delete oh.openTC; old['house_edge_blackjack_hand_v1'] = JSON.stringify(oh);
  w.close();
  w = await load(old);
  check('resumes in the player phase', w.G.phase, 'player');
  check('no openBet restored', [w.G.openBet, w.G.openTC], [null, null]);
  const hb2 = w.G.history.length;
  g2 = 0; while(w.G.history.length === hb2 && g2++ < 40){ if(w.G.phase === 'player' && !w.G.locked) w.doAction('S'); await wait(15); }
  last = w.G.history[w.G.history.length - 1];
  check('hand completes and is saved without openBet', [w.G.history.length === hb2 + 1, last.openBet === undefined], [true, true]);
  w.close();

  console.log('\n=== junk openBet in a saved hand is rejected ===');
  w = await load({});
  w.G.history = [];
  sawPlayer = false; tries2 = 0;
  while(!sawPlayer && tries2++ < 25){ w.buildShoe(); w.G.runningCount = 0; b = await deal(w, 25); if(w.G.phase === 'player') sawPlayer = true; else await finishHand(w, b); }
  const junk = {}; for(let i = 0; i < w.localStorage.length; i++){ const k = w.localStorage.key(i); junk[k] = w.localStorage.getItem(k); }
  const jh = JSON.parse(junk['house_edge_blackjack_hand_v1']); jh.openBet = '25'; jh.openTC = 'x'; junk['house_edge_blackjack_hand_v1'] = JSON.stringify(jh);
  w.close();
  w = await load(junk);
  check('string/garbage values become null', [w.G.openBet, w.G.openTC], [null, null]);
  w.close();

  console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL ' + passes + ' CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
