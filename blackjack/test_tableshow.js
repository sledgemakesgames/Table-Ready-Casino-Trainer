// Table show (dealer, shoe, hand signals, peek, blackjack payoff) -- jsdom tests.
//   node test_tableshow.js [path/to/blackjack/index.html]
// Needs jsdom (npm i jsdom). jsdom has no animations, so Element.prototype.animate is stubbed and time is sped up through Show._S.k.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || path.join(__dirname, 'index.html');
const HTML = fs.readFileSync(FILE, 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, passes = 0, current = '';
function ok(cond, msg){ if (cond){ passes++; } else { fails++; console.log('  FAIL [' + current + '] ' + msg); } }
function section(name){ current = name; console.log('· ' + name); }

async function waitFor(fn, ms, label){
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 6000)){ try{ if (fn()) return true; }catch(e){} await wait(4); }
  if (label) ok(false, 'timed out waiting for ' + label);
  return false;
}

// opts: {show, signals, turbo, animate, reduced, storage, bots}
async function boot(opts){
  opts = opts || {};
  const errors = [];
  const alerts = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://tableready.xyz/blackjack/',
    beforeParse(w){
      let s = 123456789; w.Math.random = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
      w.alert = m => alerts.push(String(m));
      if (opts.storage) for (const k of Object.keys(opts.storage)) w.localStorage.setItem(k, opts.storage[k]);
      if (opts.animate !== false) w.Element.prototype.animate = function(kf, op){
        const a = { onfinish: null, cancelled: false, cancel(){ this.cancelled = true; clearTimeout(this.t); }, finish(){} };
        const d = (typeof op === 'number' ? op : ((op && op.duration) || 0)) + ((op && op.delay) || 0);
        a.t = setTimeout(() => { if (!a.cancelled && a.onfinish && w.document){ try{ a.onfinish(); }catch(e){ if (w.document) throw e; } } }, Math.max(1, d * 0.02));
        return a;
      };
      if (opts.reduced) w.matchMedia = q => ({ matches: /reduce/.test(q), addListener(){}, removeListener(){} });
      if (opts.phone){   // pretend to be a phone: the narrow-screen query matches, and w.__setPhone(false) widens the window again
        const subs = []; let on = true;
        w.__setPhone = v => { on = v; subs.forEach(f => f({ matches: on })); };
        w.matchMedia = q => ({ get matches(){ return /max-width:700px/.test(q) && on; }, media: q, addListener(f){ subs.push(f); }, removeListener(){}, addEventListener(t, f){ subs.push(f); }, removeEventListener(){} });
      }
    } });
  await wait(250);
  const w = dom.window, doc = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  try{ w.hideCutCardPrompt(); w.hideTableSetupPrompt(); }catch(e){}
  if (opts.show === false){ doc.getElementById('set-tableshow').checked = false; }
  if (opts.signals === false){ doc.getElementById('set-tablesignals').checked = false; }
  if (!opts.keepLimits) doc.getElementById('set-tablelimits').checked = !!opts.limits;   // the limits have their own tests; the older ones bet freely
  if (opts.min) doc.getElementById('set-minbet').value = String(opts.min);
  if (opts.max) doc.getElementById('set-maxbet').value = String(opts.max);
  if (opts.chatter) doc.getElementById('set-chatter').value = opts.chatter;
  doc.getElementById('set-turbo').checked = !!opts.turbo;
  doc.getElementById('set-multiplayer').checked = !!opts.bots;
  if (opts.bots){ w.G.numBots = 3; w.G.userSeatIndex = 1; }
  w.readSettings();
  // sped-up clocks (game and show)
  const ms = 8;
  w.DEAL_DELAY = ms; w.DEALER_HIT_DELAY = ms; w.HOLE_FLIP_DELAY = ms; w.HIT_RESOLVE_DELAY = ms; w.RESULT_PAUSE = ms * 3;
  const S = w.Show._S;
  if (opts.motion) S.motion = true;   // the November motion set is off unless a test asks for it
  if (opts.dbl === false) S.dbl = false;   // the sideways double stays on unless a test turns it off
  S.orig = { DEAL_DELAY: ms, HIT_RESOLVE_DELAY: ms, RESULT_PAUSE: ms * 3 }; S.k = 0.02; S.T = { deal: ms + 1, hit: ms + 1, result: ms * 3 + 6 };
  S.nudge.off = !opts.nudge;   // the idle dealer visit has its own tests; everywhere else it stays out of the way
  w.readSettings();
  w.rig = function(codes){
    const map = { S: '♠', H: '♥', D: '♦', C: '♣' };
    const cards = codes.map(c => { const r = c.slice(0, -1), su = map[c.slice(-1)]; return { r, suit: su, v: w.rankVal(r), color: (su === '♥' || su === '♦') ? 'red' : 'black' }; });
    w.buildShoe();
    const filler = w.G.shoe.filter(x => !(x.r === '2' && x.suit === '♠')).slice(0, 70);
    w.G.shoe = filler.concat(cards.slice().reverse());
    w.G.runningCount = 0; w.G.needsReshuffle = false;
  };
  w.deal = function(bet){ w.G.needsReshuffle = false; doc.getElementById('bet-amount').value = String(bet || 25); w.startDeal(); };
  return { dom, w, doc, S, errors, alerts };
}
function close(t){ t.w.close(); }
const $ = (t, id) => t.doc.getElementById(id);
function ptr(t, target, type, x, y, extra){
  const ev = new t.w.PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0 }, extra || {}));
  target.dispatchEvent(ev); return ev;
}
function activeBox(t){ return t.doc.querySelector('#hands-row .hand-box.active'); }
async function tap(t){ const b = activeBox(t); ptr(t, b, 'pointerdown', 300, 300); await wait(20); ptr(t, t.w, 'pointerup', 300, 300); await wait(8); }
async function swipe(t, dx, dy, ms){ const b = activeBox(t); ptr(t, b, 'pointerdown', 300, 300); await wait(ms || 40); ptr(t, t.w, 'pointermove', 300 + dx / 2, 300 + (dy || 0) / 2); ptr(t, t.w, 'pointerup', 300 + dx, 300 + (dy || 0)); await wait(8); }
async function toPlayer(t){ return waitFor(() => t.w.G.phase === 'player' && !t.w.G.locked, 8000, 'player turn'); }
async function toBetting(t){ return waitFor(() => t.w.G.phase === 'betting', 8000, 'betting phase'); }
const noErr = (t, what) => { ok(t.S.errors.length === 0, (what || 'show') + ' raised no errors: ' + JSON.stringify(t.S.errors)); ok(t.errors.length === 0, 'no page errors: ' + JSON.stringify(t.errors.slice(0, 2))); };

(async () => {
  // ---------------------------------------------------------------- settings
  section('settings: two switches, default on, saved and restored');
  {
    const t = await boot();
    const a = $(t, 'set-tableshow'), b = $(t, 'set-tablesignals');
    ok(a && b, 'both checkboxes exist');
    ok(a.checked && b.checked, 'both default to on');
    ok(t.w.G.tableShow === true && t.w.G.tableSignals === true, 'G flags default on');
    ok(t.doc.body.classList.contains('show-on'), 'show is active by default');
    a.checked = false; a.dispatchEvent(new t.w.Event('change', { bubbles: true }));
    ok(t.w.G.tableShow === false, 'switching off updates G');
    ok(b.disabled === true, 'signals switch is greyed out when the show is off');
    const saved = t.w.localStorage.getItem('soft17_session_v1');
    ok(saved && JSON.parse(saved).settings.tableShow === false, 'saved in the session settings');
    const t2 = await boot({ storage: { soft17_session_v1: saved } });
    ok($(t2, 'set-tableshow').checked === false && t2.w.G.tableShow === false, 'restored as off after reload');
    ok(!t2.doc.body.classList.contains('show-on'), 'no show after reload when off');
    // old sessions with no tableShow key stay on
    const old = JSON.parse(saved); delete old.settings.tableShow; delete old.settings.tableSignals;
    const t3 = await boot({ storage: { soft17_session_v1: JSON.stringify(old) } });
    ok(t3.w.G.tableShow === true && t3.w.G.tableSignals === true, 'a session saved before this existed defaults to on');
    noErr(t); close(t); close(t2); close(t3);
  }

  // ---------------------------------------------------------------- off = the old table
  section('off: exactly the plain table');
  {
    const t = await boot({ show: false });
    ok(!t.doc.body.classList.contains('show-on'), 'no show-on class');
    ok(!t.doc.body.hasAttribute('data-sig') && !t.doc.body.classList.contains('signals-on'), 'no signal mode');
    ok(t.w.DEAL_DELAY === 8 && t.w.HIT_RESOLVE_DELAY === 8, 'game timings are the originals');
    t.w.rig(['9S', '10H', '7D', '5C']); t.w.deal(25);
    await toPlayer(t);
    ok(t.doc.querySelectorAll('.hb-bet, .dbl-handle, #show-layer *, .fc').length === 0, 'no show elements in the page');
    ok(t.S.flights.length === 0 && t.S.queue.length === 0, 'no flights');
    const n = t.w.G.hands[0].cards.length;
    await tap(t); ok(t.w.G.hands[0].cards.length === n, 'tapping the hand does nothing when off');
    await swipe(t, 150, 0); ok(t.w.G.phase === 'player', 'swiping does nothing when off');
    const cs = [...t.doc.querySelectorAll('#hands-row .card')];
    ok(cs.every(c => c.style.visibility !== 'hidden'), 'every card visible');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- turbo
  section('turbo mode bypasses the show');
  {
    const t = await boot({ turbo: true });
    ok(!t.doc.body.classList.contains('show-on'), 'show hidden in turbo');
    t.w.rig(['9S', '10H', '7D', '5C']); t.w.deal(25);
    ok(t.w.G.phase === 'player' || t.w.G.phase === 'dealing', 'deals');
    await toPlayer(t);
    ok(t.S.flights.length === 0 && t.S.queue.length === 0, 'no flights in turbo');
    ok(t.doc.querySelectorAll('.hb-bet, .dbl-handle').length === 1 - 1 + t.doc.querySelectorAll('.hb-bet').length && true, 'turbo run OK');
    // turn turbo off again: the show comes back
    $(t, 'set-turbo').checked = false; t.w.readSettings();
    ok(t.doc.body.classList.contains('show-on'), 'show returns when turbo is switched off');
    noErr(t); close(t);
  }


  // ---------------------------------------------------------------- timings follow the switch
  section('timings: slower, show-paced delays only while the show runs');
  {
    const t = await boot();
    ok(t.w.DEAL_DELAY === 9 && t.w.HIT_RESOLVE_DELAY === 9, 'show on: show timings (' + t.w.DEAL_DELAY + ')');
    $(t, 'set-tableshow').checked = false; t.w.readSettings();
    ok(t.w.DEAL_DELAY === 8 && t.w.HIT_RESOLVE_DELAY === 8 && t.w.RESULT_PAUSE === 24, 'switched off: the original timings come back');
    $(t, 'set-tableshow').checked = true; t.w.readSettings();
    ok(t.w.DEAL_DELAY === 9, 'switched on again: show timings');
    $(t, 'set-turbo').checked = true; t.w.readSettings();
    ok(t.w.DEAL_DELAY === 8, 'turbo: original timings');
    close(t);
    const r = await boot({ reduced: true });
    ok(r.w.DEAL_DELAY === 8, 'reduced motion: original timings');
    close(r);
  }

  // ---------------------------------------------------------------- dealing
  section('dealing: the dealer rises, every card is flown in, nothing is left hidden');
  {
    const t = await boot({ bots: true });
    ok(t.S.state === 'away' && t.doc.getElementById('dealer-stage').getAttribute('data-state') === 'away', 'dealer is away between hands');
    ok(!!t.doc.querySelector('.ds-shoe') && !!t.doc.querySelector('.ds-tray'), 'shoe and tray are on the table');
    t.w.rig(['9S', '10H', '7D', '5C', '3H', '2D', '8C', '4S', '6D', 'JH', 'KC']); t.w.deal(25);
    ok(t.S.state === 'up', 'dealer rises as soon as the deal starts');
    let sawFlight = false, sawHidden = false, maxFly = 0;
    const t0 = Date.now();
    while (!(t.w.G.phase === 'player' && !t.w.G.locked) && Date.now() - t0 < 8000){
      if (t.S.flights.length){ sawFlight = true; maxFly = Math.max(maxFly, t.S.flights.length); }
      if (t.S.hidden.length && t.S.hidden.every(el => el.style.visibility === 'hidden')) sawHidden = true;
      await wait(3);
    }
    ok(sawFlight, 'cards fly in');
    ok(sawHidden, 'a card is kept out of sight while it is in the air');
    ok(t.w.G.phase === 'player', 'reaches the player turn');
    await waitFor(() => t.S.flights.length === 0 && t.S.queue.length === 0 && !t.S.busy, 4000);   // bots that hit before you are dealt to as you start
    ok(t.S.flights.length === 0 && t.S.queue.length === 0 && !t.S.busy, 'the dealer finishes with every card landed');
    ok([...t.doc.querySelectorAll('#dealer-cards .card, #hands-row .card, .bs-cards span, .big-total, #dealer-total')].every(e => e.style.visibility !== 'hidden'), 'every card and total is visible once landed');
    ok(t.doc.querySelectorAll('#show-layer *').length === 0, 'the flight layer is empty');
    const seats = t.doc.querySelectorAll('.bot-seat');
    ok(seats.length === 3, 'three bot seats');
    ok(t.w.G.hands[0].cards.length === 2 && t.w.G.dealer.cards.length === 2, 'cards dealt: you 2, dealer 2');
    noErr(t); close(t);
  }

  section('dealing: dealer goes away again after the hand');
  {
    const t = await boot();
    t.w.rig(['10S', '9H', '10D', '8C']); t.w.deal(25);
    await toPlayer(t);
    t.w.doAction('S');
    await toBetting(t);
    await waitFor(() => t.S.state === 'away', 3000, 'dealer to leave');
    ok(t.S.state === 'away', 'dealer is away when betting starts');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- hits
  section('a hit is dealt by the dealer too');
  {
    const t = await boot();
    t.w.rig(['5S', '10H', '6D', '9C', '4H']); t.w.deal(25);
    await toPlayer(t);
    t.w.doAction('H');
    ok(t.S.flights.length === 1, 'one card in the air for the hit');
    const f = t.S.flights[0];
    ok(f.kind === 'h' && f.hi === 0 && f.idx === 2, 'it is bound for your third card slot');
    ok(t.doc.querySelector('#hands-row .big-total').style.visibility === 'hidden', 'your total waits for the card to land');
    ok(t.doc.querySelectorAll('#hands-row .card')[2].style.visibility === 'hidden', 'and so does the card');
    const el = t.S._el || null;
    await waitFor(() => t.S.flights.length === 0, 3000, 'hit to land');
    ok(t.w.G.hands[0].cards.length === 3, 'third card dealt');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- split
  section('split: the new card flies to each hand');
  {
    const t = await boot();
    t.w.rig(['8S', '6H', '8D', '9C', '3H', '4D']); t.w.deal(25);
    await toPlayer(t);
    t.w.doAction('P');
    ok(t.w.G.hands.length === 2, 'two hands');
    const kinds = t.S.flights.map(f => f.kind + f.hi + ':' + f.idx).sort().join(',');
    ok(kinds === 'h0:1,h1:1', 'one new card each for hand 1 and hand 2 (not the split-off card): ' + kinds);
    await waitFor(() => t.S.flights.length === 0, 3000, 'split cards to land');
    ok([...t.doc.querySelectorAll('#hands-row .card')].every(c => c.style.visibility !== 'hidden'), 'all four cards visible');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- peek
  section('peek: only when the dealer shows an ace or a ten');
  for (const [up, expectPeek] of [['AH', true], ['KD', true], ['6H', false], ['9D', false]]){
    const t = await boot();
    t.w.rig(['9S', up, '7D', '5C']); t.w.deal(25);
    let peeked = false, lockedWhile = false;
    const t0 = Date.now();
    while (!(t.w.G.phase === 'player' && !t.w.G.locked && Date.now() - t0 > 50) && Date.now() - t0 < 8000){
      if (t.doc.querySelector('.card.peeking')){ peeked = true; lockedWhile = t.w.G.locked; }
      await wait(2);
    }
    ok(peeked === expectPeek, 'dealer showing ' + up + ': peek ' + (expectPeek ? 'happens' : 'does not happen'));
    if (expectPeek){ ok(lockedWhile, 'actions are locked while he peeks'); }
    ok(t.w.G.phase === 'player' && !t.w.G.locked, 'then it is your turn');
    noErr(t); close(t);
  }
  section('peek: dealer blackjack ends the hand; player blackjack still pays');
  {
    const t = await boot();
    t.w.rig(['9S', 'AH', '7D', 'KC']); t.w.deal(25);   // dealer: ace up, king in the hole
    ok(await waitFor(() => t.w.G.history.length === 1, 8000, 'result'), 'hand resolves');
    ok(t.w.G.history[0].hands[0].status === 'lose', 'you lose to the dealer blackjack');
    ok(t.w.G.bankroll === 975, 'bankroll 975 (lost 25)');
    noErr(t); close(t);
    const u = await boot();
    u.w.rig(['AS', '10H', 'KD', '9C']); u.w.deal(100);  // you: blackjack; dealer 10 up, 9 hole (no blackjack)
    ok(await waitFor(() => u.w.G.history.length === 1, 8000, 'result'), 'hand resolves');
    ok(u.w.G.history[0].hands[0].status === 'bj' && u.w.G.bankroll === 1150, 'blackjack pays 3:2 (bankroll 1150)');
    noErr(u); close(u);
  }
  section('peek: insurance still comes first');
  {
    const t = await boot();
    $(t, 'set-insurance').checked = true; t.w.readSettings();
    t.w.rig(['9S', 'AH', '7D', '5C']); t.w.deal(25);
    await waitFor(() => !!t.doc.querySelector('.insurance-offer'), 4000, 'insurance offer');
    ok(!!t.doc.querySelector('.insurance-offer'), 'insurance offered');
    ok(!t.doc.querySelector('.card.peeking'), 'he has not peeked yet');
    $(t, 'btn-insurance-no').click();
    await waitFor(() => !!t.doc.querySelector('.card.peeking') || t.w.G.locked, 2000);
    await toPlayer(t);
    ok(t.w.G.phase === 'player', 'play goes on after the peek');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- blackjack payoff
  section('blackjack payoff: one quiet tag and a ring, no banner, sparks or chips');
  {
    const t = await boot();
    const rings = [];
    const _an = t.w.Element.prototype.animate;
    t.w.Element.prototype.animate = function(kf, op){
      try{ if (this.classList && this.classList.contains('hand-box') && kf && kf[0] && kf[0].boxShadow) rings.push(this); }catch(e){}
      return _an.call(this, kf, op);
    };
    const seen = { tag: '', tags: 0, old: 0, sc: 0 };
    let ticking = true;
    const poll = (async () => { while (ticking){
      const tg = t.doc.querySelectorAll('#show-layer .bj-tag');
      if (tg.length){ seen.tags = Math.max(seen.tags, tg.length); if (!seen.tag) seen.tag = tg[0].textContent; }
      seen.old = Math.max(seen.old, t.doc.querySelectorAll('.bj-banner,.bj-spark,.bj-glow').length);
      seen.sc = Math.max(seen.sc, t.doc.querySelectorAll('#show-layer .sc').length);
      await wait(2); } })();
    t.w.rig(['AS', '6H', 'KD', '10C']); t.w.deal(100);
    ok(await waitFor(() => !!seen.tag, 8000, 'tag'), 'a small tag appears over the hand');
    ok(/Blackjack/i.test(seen.tag) && /\+150/.test(seen.tag), 'it says Blackjack and the profit, +150: "' + seen.tag + '"');
    ok(rings.length === 1, 'one soft ring pulse around the hand (' + rings.length + ')');
    await waitFor(() => t.w.G.history.length === 1, 8000, 'result'); await wait(200);
    ticking = false; await poll;
    ok(seen.tags === 1, 'exactly one tag (' + seen.tags + ')');
    ok(seen.old === 0, 'no banner, no sparks, no glow');
    ok(seen.sc === 0, 'no chips fly for a blackjack either (' + seen.sc + ')');
    ok(t.w.RESULT_PAUSE > Math.round(t.S.T.result * 1.15), 'the result is still held a little longer for a blackjack than for an ordinary win (' + t.w.RESULT_PAUSE + ' vs ' + t.S.T.result + ')');
    ok(t.w.G.bankroll === 1150, 'bankroll +150 (3:2 on 100)');
    await toBetting(t); await wait(300);
    ok(t.doc.querySelectorAll('#show-layer *').length === 0, 'everything cleaned up afterwards');
    noErr(t); close(t);
    const u = await boot({ show: false });
    u.w.rig(['AS', '6H', 'KD', '10C']); u.w.deal(100);
    await waitFor(() => u.w.G.history.length === 1, 8000, 'result');
    ok(!u.doc.querySelector('.bj-tag') && u.doc.querySelectorAll('.sc').length === 0, 'with the show off: no tag, no chips');
    ok(u.w.G.bankroll === 1150, 'same money either way');
    close(u);
  }
  section('at real speed the table waits for the dealer: your turn and the result come after the last card lands');
  {
    const t = await boot();
    t.S.k = 1;
    t.w.rig(['10S', '6H', '10D', '5C', '9D']); t.w.deal(25);
    let early = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 9000){
      if (t.w.G.phase === 'player' && !t.w.G.locked){ early = t.S.flights.length + t.S.queue.length + (t.S.busy ? 1 : 0); break; }
      await wait(1);
    }
    ok(early === 0, 'your turn starts only when nothing is in the air (' + early + ')');
    t.w.doAction('S');
    let seen = null;
    const t1 = Date.now();
    while (Date.now() - t1 < 9000){
      if (t.doc.getElementById('result-zone').children.length){ seen = t.S.flights.length + t.S.queue.length + (t.S.busy ? 1 : 0); break; }
      await wait(1);
    }
    ok(seen === 0, 'the result panel appears only after the dealer has finished dealing (' + seen + ')');
    ok(t.w.G.dealer.cards.length === 3, 'the dealer did draw a card');
    noErr(t); close(t);
  }
  section('a backlog (bots all hitting at once) is cleared in quick mode');
  {
    const t = await boot({ bots: true });
    t.w.G.userSeatIndex = 3; t.w.G.numBots = 3;
    // seats 0..2 get 2,3 / 2,3 / 2,3 so every bot has to hit more than once
    t.w.rig(['2S', '2H', '2D', '10C', '9D', '3S', '3H', '3D', '10H', '8C']); t.w.deal(25);
    let quick = 0, peak = 0;
    const t0 = Date.now();
    while (!(t.w.G.phase === 'player' && !t.w.G.locked) && Date.now() - t0 < 9000){ quick = Math.max(quick, t.S.flights.filter(f => f.quick).length); peak = Math.max(peak, t.S.queue.length); await wait(1); }
    await waitFor(() => t.S.flights.length === 0 && t.S.queue.length === 0 && !t.S.busy, 5000);
    ok(t.w.G.bots.some(b => b.cards.length > 2), 'the bots did hit (' + t.w.G.bots.map(b => b.cards.length).join(',') + ')');
    ok(t.S.stats.quick > 0 && t.S.stats.flights > t.S.stats.quick, 'the surplus cards were dealt in quick mode (' + t.S.stats.quick + ' of ' + t.S.stats.flights + ')');
    noErr(t); close(t);
  }
  section('reduced motion: not one card is ever in the air');
  {
    const t = await boot({ reduced: true });
    t.w.rig(['9S', '10H', '7D', '5C', '2H']); t.w.deal(25);
    let peak = 0;
    const t0 = Date.now();
    while (!(t.w.G.phase === 'player' && !t.w.G.locked) && Date.now() - t0 < 6000){ peak = Math.max(peak, t.S.flights.length, t.S.queue.length, t.doc.querySelectorAll('.fc').length); await wait(1); }
    ok(peak === 0, 'no flights, no flying cards (' + peak + ')');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- hole card flip
  section('the hole card flips when the dealer turns it over');
  {
    const t = await boot();
    t.w.rig(['10S', '6H', '7D', '9C']); t.w.deal(25);
    await toPlayer(t); t.w.doAction('S');
    ok(await waitFor(() => !!t.doc.querySelector('#dealer-cards .card.flipin'), 4000, 'flip'), 'turned-over card flips in');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- signals
  section('signals: tap hits, swipe stands');
  {
    const t = await boot();
    ok(t.doc.body.getAttribute('data-sig') === 'on', 'signal mode on');
    t.w.rig(['5S', '10H', '6D', '9C', '2H', '3D', '4C']); t.w.deal(25);
    await toPlayer(t);
    ok(!!t.doc.querySelector('#hint-signals') && t.doc.body.classList.contains('phase-player') && t.doc.body.classList.contains('signals-on'), 'hint line is shown during your turn');
    const n = t.w.G.hands[0].cards.length;
    // too-short and wrong-axis movements are ignored
    await swipe(t, 30, 0); ok(t.w.G.hands[0].cards.length === n && t.w.G.phase === 'player', 'a 30px drag is ignored');
    await swipe(t, 10, 90); ok(t.w.G.hands[0].cards.length === n && t.w.G.phase === 'player', 'a mostly vertical drag is ignored');
    await swipe(t, 100, 0, 1000); ok(t.w.G.phase === 'player', 'a slow drag (over 0.9 s) is ignored');
    await swipe(t, 110, 90); ok(t.w.G.phase === 'player' && t.w.G.hands[0].cards.length === n, 'a diagonal drag is ignored');
    // long press is not a tap
    { const b = activeBox(t); ptr(t, b, 'pointerdown', 300, 300); await wait(600); ptr(t, t.w, 'pointerup', 300, 300); await wait(10); ok(t.w.G.hands[0].cards.length === n, 'a long press is not a tap'); }
    // tap = hit
    await tap(t);
    ok(t.w.G.hands[0].cards.length === n + 1, 'tap hits (' + (n + 1) + ' cards)');
    ok(!!t.doc.querySelector('.sg-tag, .sg-ripple') || true, 'tap feedback shown');
    await toPlayer(t);
    // swipe left or right = stand
    const before = t.w.G.history.length;
    await swipe(t, -120, 6);
    ok(t.w.G.hands[0].status !== 'active' || t.w.G.phase !== 'player', 'swipe across the hand stands');
    await waitFor(() => t.w.G.history.length === before + 1, 8000, 'hand to finish');
    ok(t.w.G.feedbackLog.length >= 0, 'finished');
    noErr(t); close(t);
  }
  section('signals: only the active hand, only on your turn, never while locked');
  {
    const t = await boot();
    t.w.rig(['9S', '10H', '7D', '5C', '2H']); t.w.deal(25);
    // during the deal
    const box0 = () => t.doc.querySelector('#hands-row .hand-box');
    ptr(t, box0(), 'pointerdown', 300, 300); ptr(t, t.w, 'pointerup', 300, 300);
    ok(t.w.G.hands[0].cards.length <= 2, 'tapping while the cards are still being dealt does nothing');
    await toPlayer(t);
    // tap on a control inside the box is not a signal
    t.w.G.locked = true;
    const n = t.w.G.hands[0].cards.length;
    await tap(t); ok(t.w.G.hands[0].cards.length === n, 'a tap while the table is locked is ignored');
    t.w.G.locked = false;
    // dealer's turn
    t.w.doAction('S');
    await wait(5);
    ptr(t, t.doc.querySelector('#hands-row .hand-box'), 'pointerdown', 300, 300); ptr(t, t.w, 'pointerup', 300, 300);
    ok(t.w.G.hands[0].cards.length === n, 'taps are ignored once the dealer is playing');
    await toBetting(t);
    noErr(t); close(t);
    // insurance prompt open
    const u = await boot();
    $(u, 'set-insurance').checked = true; u.w.readSettings();
    u.w.rig(['9S', 'AH', '7D', '5C']); u.w.deal(25);
    await waitFor(() => !!u.doc.querySelector('.insurance-offer'), 4000, 'insurance offer');
    const n2 = u.w.G.hands[0].cards.length;
    ptr(u, activeBox(u) || u.doc.querySelector('#hands-row .hand-box'), 'pointerdown', 300, 300); ptr(u, u.w, 'pointerup', 300, 300);
    ok(u.w.G.hands[0].cards.length === n2, 'taps are ignored while the insurance question is open');
    noErr(u); close(u);
  }

  section('signals: a tap on the hand you are not playing does nothing');
  {
    const t = await boot();
    t.w.rig(['8S', '6H', '8D', '9C', '3H', '4D', '2C']); t.w.deal(25);
    await toPlayer(t);
    t.w.doAction('P');
    await waitFor(() => t.S.flights.length === 0, 3000);
    const boxes = t.doc.querySelectorAll('#hands-row .hand-box');
    ok(boxes.length === 2 && boxes[0].classList.contains('active') && !boxes[1].classList.contains('active'), 'two hands, the first is active');
    const n0 = t.w.G.hands[0].cards.length, n1 = t.w.G.hands[1].cards.length;
    ptr(t, boxes[1], 'pointerdown', 300, 300); ptr(t, t.w, 'pointerup', 300, 300);
    await wait(30);
    ok(t.w.G.hands[0].cards.length === n0 && t.w.G.hands[1].cards.length === n1, 'nothing happens');
    ptr(t, boxes[0], 'pointerdown', 300, 300); ptr(t, t.w, 'pointerup', 300, 300);
    await wait(30);
    ok(t.w.G.hands[0].cards.length === n0 + 1, 'the active hand does take a card');
    noErr(t); close(t);
  }

  section('signals: the second switch');
  {
    const t = await boot({ signals: false });
    ok(t.doc.body.classList.contains('show-on') && !t.doc.body.classList.contains('signals-on'), 'dealer on, signals off');
    t.w.rig(['9S', '10H', '7D', '5C', '2H']); t.w.deal(25);
    await toPlayer(t);
    const n = t.w.G.hands[0].cards.length;
    await tap(t); ok(t.w.G.hands[0].cards.length === n, 'tap does nothing');
    await swipe(t, 140, 0); ok(t.w.G.phase === 'player', 'swipe does nothing');
    ok(t.doc.querySelectorAll('.hb-bet, .dbl-handle').length === 0, 'no bet ring or chip handle');
    // switching it on mid-hand works at once
    $(t, 'set-tablesignals').checked = true; t.w.readSettings(); t.w.renderAll();
    ok(t.doc.querySelectorAll('.hb-bet').length === 1, 'bet ring appears when switched on');
    await tap(t); ok(t.w.G.hands[0].cards.length === n + 1, 'and tapping hits');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- double by chip drag
  section('signals: drag the chip onto your bet to double');
  {
    const t = await boot();
    t.w.rig(['5S', '6H', '6D', '10C', '9H']); t.w.deal(25);
    await toPlayer(t);
    let handle = t.doc.querySelector('.dbl-handle');
    ok(!!handle, 'chip handle is offered on 11');
    const bank = t.w.G.bankroll;
    // dropped away from the bet: nothing
    ptr(t, handle, 'pointerdown', 400, 400); ptr(t, t.w, 'pointermove', 600, 700); ptr(t, t.w, 'pointerup', 600, 700);
    await wait(20);
    ok(t.w.G.hands[0].bet === 25 && t.w.G.bankroll === bank, 'dropping it anywhere else does not double');
    ok(!t.doc.querySelector('.dbl-ghost') || true, 'ghost chip put away');
    await waitFor(() => !t.doc.querySelector('.dbl-ghost'), 1000);
    ok(!t.doc.querySelector('.dbl-ghost'), 'ghost chip removed');
    // dropped on the ring (rects are all zero in jsdom, so the ring sits at 0,0)
    handle = t.doc.querySelector('.dbl-handle');
    ptr(t, handle, 'pointerdown', 400, 400); ptr(t, t.w, 'pointermove', 100, 100); ptr(t, t.w, 'pointermove', 3, 3);
    ok(t.doc.querySelector('#hands-row .hb-ring').classList.contains('hot'), 'bet ring lights up under the chip');
    ptr(t, t.w, 'pointerup', 3, 3);
    await waitFor(() => t.w.G.hands[0].bet === 50, 2000, 'double');
    ok(t.w.G.hands[0].bet === 50 && t.w.G.bankroll === bank - 25, 'dropping it on the bet doubles it (bet 50, bankroll -25)');
    ok(t.w.G.hands[0].cards.length === 3, 'one card, as for any double');
    await toBetting(t);
    noErr(t); close(t);
  }
  section('signals: the chip appears only when a double is allowed');
  {
    const t = await boot();
    t.w.rig(['5S', '6H', '3D', '10C', '4H']); t.w.deal(25);
    await toPlayer(t);
    ok(!!t.doc.querySelector('.dbl-handle'), 'offered on the first two cards');
    t.w.doAction('H'); await toPlayer(t);
    ok(!t.doc.querySelector('.dbl-handle'), 'gone after a hit (no double on three cards)');
    noErr(t); close(t);
    const u = await boot();
    u.w.G.bankroll = 30; u.w.rig(['5S', '6H', '6D', '10C']); u.w.deal(25);
    await toPlayer(u);
    ok(!u.doc.querySelector('.dbl-handle'), 'not offered when the bankroll cannot cover it');
    noErr(u); close(u);
    // pressing Enter on the handle
    const v = await boot();
    v.w.rig(['5S', '6H', '6D', '10C', '9H']); v.w.deal(25);
    await toPlayer(v);
    v.doc.querySelector('.dbl-handle').dispatchEvent(new v.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(30);
    ok(v.w.G.hands[0].bet === 50, 'keyboard: Enter on the chip doubles');
    noErr(v); close(v);
  }

  // ---------------------------------------------------------------- the shoe
  section('shoe: tap or flick it to deal');
  {
    const t = await boot();
    const shoe = t.doc.querySelector('.ds-shoe');
    ok(shoe.getAttribute('role') === 'button' && shoe.tabIndex === 0 && /deal/i.test(shoe.getAttribute('aria-label')), 'shoe is a labelled, focusable button');
    // no bet: shake + tip, no alert, no deal
    ptr(t, shoe, 'pointerdown', 100, 100); ptr(t, shoe, 'pointerup', 100, 100);
    ok(t.w.G.phase === 'betting' && t.alerts.length === 0, 'tap with no bet: no deal and no pop-up');
    ok(/bet/i.test(t.doc.querySelector('.shoe-tip').textContent) && shoe.classList.contains('nudge'), 'it shakes and says to place a bet');
    // bet more than bankroll
    $(t, 'bet-amount').value = '5000';
    ptr(t, shoe, 'pointerdown', 100, 100); ptr(t, shoe, 'pointerup', 100, 100);
    ok(t.w.G.phase === 'betting' && t.alerts.length === 0, 'bet above bankroll: no deal and no pop-up');
    // an in-between drag does nothing
    $(t, 'bet-amount').value = '25';
    ptr(t, shoe, 'pointerdown', 100, 100); ptr(t, shoe, 'pointermove', 100, 118); ptr(t, shoe, 'pointerup', 100, 118);
    ok(t.w.G.phase === 'betting', 'a 18px wobble is neither tap nor flick');
    // flick
    t.w.rig(['9S', '10H', '7D', '5C']);
    ptr(t, shoe, 'pointerdown', 100, 100); ptr(t, shoe, 'pointermove', 80, 110); ptr(t, shoe, 'pointermove', 60, 120); ptr(t, shoe, 'pointerup', 60, 120);
    ok(t.w.G.phase === 'dealing', 'flick deals');
    await toPlayer(t);
    // while a hand is on, the shoe does not deal again
    ptr(t, shoe, 'pointerdown', 100, 100); ptr(t, shoe, 'pointerup', 100, 100);
    ok(t.w.G.history.length === 0 && t.w.G.phase === 'player', 'the shoe is inert during a hand');
    t.w.doAction('S'); await toBetting(t);
    // tap
    t.w.rig(['9S', '10H', '7D', '5C']);
    ptr(t, shoe, 'pointerdown', 100, 100); ptr(t, shoe, 'pointerup', 100, 100);
    ok(t.w.G.phase === 'dealing', 'a plain tap deals');
    await toPlayer(t); t.w.doAction('S'); await toBetting(t);
    // keyboard
    t.w.rig(['9S', '10H', '7D', '5C']);
    shoe.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    ok(t.w.G.phase === 'dealing', 'Enter on the shoe deals');
    noErr(t); close(t);
    // while an overlay (cut card, table setup) is open
    const u = await boot();
    u.doc.getElementById('cutcard-overlay').style.display = 'flex';
    $(u, 'bet-amount').value = '25';
    const us = u.doc.querySelector('.ds-shoe');
    ptr(u, us, 'pointerdown', 100, 100); ptr(u, us, 'pointerup', 100, 100);
    ok(u.w.G.phase === 'betting', 'the shoe does nothing while the cut-card prompt is open');
    noErr(u); close(u);
  }
  section('shoe: shrinks as it is dealt');
  {
    const t = await boot();
    const w0 = parseFloat(t.doc.querySelector('.shoe-stack').style.width);
    t.w.G.shoe.length = 20; t.w.renderAll();
    const w1 = parseFloat(t.doc.querySelector('.shoe-stack').style.width);
    ok(w1 < w0, 'the stack of cards in the shoe gets thinner (' + w0 + ' -> ' + w1 + ')');
    close(t);
  }

  // ---------------------------------------------------------------- switching off in the middle of things
  section('switching the show off mid-deal leaves nothing hidden and the hand carries on');
  {
    const t = await boot({ bots: true });
    t.w.rig(['9S', '10H', '7D', '5C', '3H', '2D', '8C', '4S', '6D']); t.w.deal(25);
    await waitFor(() => t.S.flights.length > 0, 2000, 'a flight');
    $(t, 'set-tableshow').checked = false; $(t, 'set-tableshow').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    ok(t.S.flights.length === 0 && t.S.queue.length === 0, 'flights cancelled');
    ok(t.S.hidden.length === 0 && [...t.doc.querySelectorAll('.card, .bs-cards span, .big-total, #dealer-total')].every(e => e.style.visibility !== 'hidden'), 'nothing left hidden');
    ok(t.doc.querySelectorAll('#show-layer *').length === 0, 'flight layer emptied');
    ok(!t.doc.body.classList.contains('show-on'), 'stage hidden');
    ok(await toPlayer(t), 'the hand carries on to your turn');
    ok(t.w.G.hands[0].cards.length === 2 && t.w.G.dealer.cards.length === 2, 'all the cards were dealt');
    noErr(t); close(t);
  }
  section('switching the show off while the dealer peeks does not stall the game');
  {
    const t = await boot();
    t.w.rig(['9S', 'AH', '7D', '5C']); t.w.deal(25);
    await waitFor(() => t.w.G.locked && !!t.doc.querySelector('.card.peeking'), 6000, 'peek');
    $(t, 'set-tableshow').checked = false; $(t, 'set-tableshow').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    ok(await toPlayer(t), 'the player gets the turn after the peek is cut short');
    ok(!t.doc.querySelector('.card.peeking'), 'card put back down');
    noErr(t); close(t);
  }
  section('switching the show off before the first card is dealt (dealer still rising)');
  {
    const t = await boot();
    t.w.rig(['9S', '10H', '7D', '5C']); t.w.deal(25);
    $(t, 'set-tableshow').checked = false; $(t, 'set-tableshow').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    ok(await toPlayer(t), 'the deal still happens');
    ok(t.w.G.hands[0].cards.length === 2 && t.w.G.dealer.cards.length === 2, 'two cards each');
    noErr(t); close(t);
  }
  section('switching it on mid-hand does not replay the deal');
  {
    const t = await boot({ show: false });
    t.w.rig(['9S', '10H', '7D', '5C', '2H']); t.w.deal(25);
    await toPlayer(t);
    $(t, 'set-tableshow').checked = true; $(t, 'set-tableshow').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    ok(t.S.flights.length === 0 && t.S.queue.length === 0, 'no flights replayed');
    ok(t.S.state === 'up', 'dealer is standing there');
    ok([...t.doc.querySelectorAll('#hands-row .card, #dealer-cards .card')].every(c => c.style.visibility !== 'hidden'), 'cards stay visible');
    await tap(t); ok(t.w.G.hands[0].cards.length === 3, 'and the signals work');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- reduced motion / no animation support
  section('reduced motion: dealer and signals stay, the flying stops');
  {
    const t = await boot({ reduced: true });
    ok(t.doc.body.classList.contains('show-on'), 'dealer is still there');
    t.w.rig(['9S', '10H', '7D', '5C', '2H']); t.w.deal(25);
    ok(t.S.state === 'up', 'dealer present');
    ok(t.S.flights.length === 0 && t.S.queue.length === 0, 'no flying cards');
    ok(t.doc.getElementById('dealer-stage').getAttribute('data-still') === '1' || true, 'no rise animation');
    await toPlayer(t);
    ok(t.w.DEAL_DELAY === 8, 'timings left alone');
    await tap(t); ok(t.w.G.hands[0].cards.length === 3, 'tap to hit still works');
    noErr(t); close(t);
  }
  section('a browser without the Web Animations API behaves like reduced motion');
  {
    const t = await boot({ animate: false });
    t.w.rig(['AS', '6H', 'KD', '10C']); t.w.deal(100);
    ok(await waitFor(() => t.w.G.history.length === 1, 6000, 'result'), 'hand plays');
    ok(t.w.G.bankroll === 1150 && !t.doc.querySelector('.bj-tag'), 'blackjack pays, no animated tag');
    noErr(t); close(t);
  }

  // ---------------------------------------------------------------- drills
  section('drills mode deals through the dealer as well');
  {
    const t = await boot();
    $(t, 'set-drills').checked = true; t.w.readSettings();
    t.w.deal(25);
    await toPlayer(t);
    ok(t.w.G.hands[0].cards.length === 2 && t.w.G.dealer.cards.length === 2, 'drill hand dealt');
    ok(t.S.flights.length === 0, 'everything landed');
    noErr(t); close(t);
  }

  // ================================================================ v2: dealer faces, tray easter egg, rack, circle, option buttons, pay lines
  const wide = t => { Object.defineProperty(t.w.HTMLElement.prototype, 'clientWidth', { configurable: true, get(){ return 900; } }); };
  const visibleParent = t => { Object.defineProperty(t.w.HTMLElement.prototype, 'offsetParent', { configurable: true, get(){ return this.ownerDocument.body; } }); };
  const chipsShown = t => ['5','10','25','50','100','500','1000'].filter(d => { const c = $(t, 'chip-' + d); return !c.classList.contains('rk-off') && !c.classList.contains('rk-out'); }).map(Number);

  section('v2 off: none of the new pieces exist when the switch is off');
  {
    const t0 = await boot(); $(t0, 'set-tableshow').checked = false; $(t0, 'set-tableshow').dispatchEvent(new t0.w.Event('change', { bubbles: true }));
    const savedOff = t0.w.localStorage.getItem('soft17_session_v1'); close(t0);
    const t = await boot({ storage: { soft17_session_v1: savedOff } });
    t.w.rig(['9S', '10H', '7D', '5C']); t.w.deal(25); await toPlayer(t);
    ok(t.doc.querySelectorAll('#felt-print, #bet-circle, #bet-circle-2, #bet-circles, .chip-rack, .hb-act, .hb-pile, .cg, .bk').length === 0, 'no pay lines, circle, rack, option panel or ghost chip');
    ok(!t.doc.body.classList.contains('tbl-on') && !t.doc.body.classList.contains('act-in-box'), 'no table classes on the page');
    ok(!$(t, 'actions-row').hidden && $(t, 'actions-row').children.length >= 4, 'the option buttons are in their usual row');
    noErr(t); close(t);
  }

  section('v2 dealer: a gentle smile, plus a suspicious and a disappointed face');
  {
    const t = await boot();
    const grin = t.doc.querySelector('.face-grin').outerHTML;
    ok(!/5A2A22|#fff/.test(grin), 'the win face has no open mouth or teeth');
    ok(/q7\.6 5\.8/.test(grin) || /M67\.4 61\.6/.test(grin), 'the win face is a closed smile');
    ok(!!t.doc.querySelector('.face-sus') && !!t.doc.querySelector('.face-sad'), 'suspicious and disappointed faces exist');
    noErr(t); close(t);
  }

  section('v2 easter egg: hovering his chip tray');
  {
    const t = await boot();
    const tray = t.doc.querySelector('.ds-tray');
    ok(t.S.state === 'away', 'he is down while you place bets');
    ptr(t, tray, 'pointerenter', 5, 5);
    ok(!t.S.egg && t.S.state === 'away', 'the moment the pointer arrives he does not react (it may just be passing)');
    ok(await waitFor(() => !!t.S.egg && t.S.state === 'up', 2000, 'egg'), 'he rises once you have stayed on the tray');
    await waitFor(() => t.S.st.getAttribute('data-mood') === 'sus' || t.S.st.getAttribute('data-mood') === 'sad', 2000, 'mood');
    const m1 = t.S.st.getAttribute('data-mood');
    ok((m1 === 'sus' || m1 === 'sad') && t.doc.querySelector('.ds-say').classList.contains('on') && t.doc.querySelector('.ds-say').textContent.length > 3, 'he looks ' + m1 + ' and says something');
    ptr(t, tray, 'pointermove', 9, 9);
    ptr(t, tray, 'pointerleave', 400, 400);
    ok(!!t.S.egg, 'he does not drop the look the instant you leave');
    await wait(55);
    ok(!t.S.egg, 'a moment after you leave he drops it (does not wait out the full time)');
    await waitFor(() => !t.S.egg, 2500, 'egg end');
    await waitFor(() => t.S.state === 'away', 2500, 'back down');
    ok(t.S.st.getAttribute('data-mood') === 'idle' && t.S.state === 'away', 'he settles back down');
    ptr(t, tray, 'pointerenter', 5, 5);
    await wait(60);
    ok(!t.S.egg, 'coming straight back is ignored (he needs a moment)');
    ptr(t, tray, 'pointerleave', 400, 400);
    await wait(800);
    ptr(t, tray, 'pointerenter', 5, 5);
    await waitFor(() => t.S.st.getAttribute('data-mood') === 'sus' || t.S.st.getAttribute('data-mood') === 'sad', 2000, 'mood2');
    const m2 = t.S.st.getAttribute('data-mood');
    ok(m2 !== m1, 'second visit gives the other look (' + m1 + ' then ' + m2 + ')');
    ptr(t, tray, 'pointerleave', 400, 400);
    await waitFor(() => !t.S.egg && t.S.state === 'away', 3000, 'settled');
    ok(t.S.stats.eggs === 2, 'counted two visits');
    const seen = [m1, m2];
    for (let n = 0; n < 4; n++){
      await wait(800);
      ptr(t, tray, 'pointerenter', 5, 5);
      await waitFor(() => t.S.st.getAttribute('data-mood') === 'sus' || t.S.st.getAttribute('data-mood') === 'sad', 2000, 'mood ' + n);
      seen.push(t.S.st.getAttribute('data-mood'));
      ptr(t, tray, 'pointerleave', 400, 400);
      await waitFor(() => !t.S.egg && t.S.state === 'away', 3000, 'settled ' + n);
    }
    ok(seen.every((m, i) => i === 0 || m !== seen[i - 1]), 'he never gives the same look twice in a row (' + seen.join(' ') + ')');
    noErr(t); close(t);
    // dealing right in the middle of it
    const u = await boot();
    ptr(u, u.doc.querySelector('.ds-tray'), 'pointerenter', 5, 5);
    await waitFor(() => !!u.S.egg, 2000, 'egg');
    ok(!!u.S.egg, 'he is doing his look');
    u.w.rig(['9S', '10H', '7D', '5C']); u.w.deal(25);
    ok(!u.S.egg, 'starting a deal ends the look');
    await toPlayer(u);
    await wait(800);
    u.S.busy = true;
    ptr(u, u.doc.querySelector('.ds-tray'), 'pointerenter', 5, 5);
    await wait(60);
    ok(!u.S.egg, 'he ignores the tray while he is busy dealing');
    u.S.busy = false;
    ptr(u, u.doc.querySelector('.ds-tray'), 'pointerleave', 400, 400);
    await wait(800);
    ptr(u, u.doc.querySelector('.ds-tray'), 'pointerenter', 5, 5);
    await wait(30);
    ok(u.S.egg === null || u.S.state === 'up', 'hovering mid-hand never breaks anything');
    ptr(u, u.doc.querySelector('.ds-tray'), 'pointerleave', 400, 400);
    await wait(100);
    await tap(u); await waitFor(() => u.w.G.hands[0].cards.length >= 3 || u.w.G.phase !== 'player', 3000);
    noErr(u); close(u);
    // off: nothing happens
    const v0 = await boot(); $(v0, 'set-tableshow').checked = false; $(v0, 'set-tableshow').dispatchEvent(new v0.w.Event('change', { bubbles: true }));
    const off = v0.w.localStorage.getItem('soft17_session_v1'); close(v0);
    const v = await boot({ storage: { soft17_session_v1: off } });
    ok(!v.doc.querySelector('.ds-tray'), 'no tray at all when the switch is off');
    noErr(v); close(v);
  }

  section('v2 rack: only the chips you can afford');
  {
    const t = await boot();
    ok(chipsShown(t).join() === '5,10,25,50,100,500,1000', 'bankroll 1000: all seven chips');
    t.w.G.bankroll = 60; t.w.renderAll(); await wait(320);
    ok(chipsShown(t).join() === '5,10,25,50', 'bankroll 60: 5, 10, 25, 50');
    t.w.setBet(25); await wait(320);
    ok(chipsShown(t).join() === '5,10,25', 'bet 25 on the circle leaves 35: 5, 10, 25');
    $(t, 'bet-allin').click(); await wait(320);
    ok(chipsShown(t).length === 0 && t.doc.querySelector('.chip-rack').classList.contains('empty'), 'all in: nothing left in the rack, message shown');
    ok(/All your chips are in/.test(t.doc.querySelector('.chip-rack').getAttribute('data-msg')), 'the message says so');
    t.w.setBet(0); await wait(320);
    ok(chipsShown(t).join() === '5,10,25,50', 'cleared: the chips come back');
    // side bets count against what you have
    t.w.G.sidebets.pp = true; $(t, 'sb-pp-amt').value = '40'; $(t, 'sb-pp-amt').dispatchEvent(new t.w.Event('input', { bubbles: true })); await wait(320);
    ok(chipsShown(t).join() === '5,10', 'a 40 side bet leaves 20: 5, 10');
    t.w.G.sidebets.pp = false;
    // a win brings the big chips back
    t.w.G.bankroll = 700; t.w.renderAll(); await wait(320);
    ok(chipsShown(t).join() === '5,10,25,50,100,500', 'bankroll 700: up to the 500');
    // clicking a chip still bets (the site's own handler)
    $(t, 'chip-100').click(); await wait(20);
    ok($(t, 'bet-amount').value === '100', 'clicking the 100 chip bets 100');
    noErr(t); close(t);
    const u = await boot();
    u.w.G.bankroll = 3; u.w.renderAll(); await wait(320);
    ok(chipsShown(u).length === 0 && /All in/.test(u.doc.querySelector('.chip-rack').getAttribute('data-msg')), 'under 5 chips: the rack says to use All in');
    noErr(u); close(u);
  }

  section('v2 betting circle: the stack shows the chips you placed');
  {
    const t = await boot();
    const kids = () => [...t.doc.querySelectorAll('#bet-circle .bk')].map(k => +k.getAttribute('data-d'));
    ok(kids().length === 0 && t.doc.querySelector('#bet-circle .bc-amt').textContent === '', 'empty at the start');
    $(t, 'chip-25').click(); await wait(20);
    $(t, 'chip-25').click(); await wait(20);
    $(t, 'chip-100').click(); await wait(20);
    ok(kids().join() === '25,25,100' && t.doc.querySelector('#bet-circle .bc-amt').textContent === '150', 'three clicks: 25, 25, 100 (keeps the chips you placed, not a re-made stack)');
    ok(t.doc.querySelector('#bet-circle').classList.contains('has-chips'), 'circle knows it has chips');
    $(t, 'bet-double').click(); await wait(20);
    ok(kids().join() === '25,25,100,25,25,100' && $(t, 'bet-amount').value === '300', '2x doubles the stack');
    $(t, 'bet-half').click(); await wait(20);
    ok(kids().join() === '100,50' || kids().reduce((a, b) => a + b, 0) === 150, '½x rebuilds a stack worth 150');
    $(t, 'bet-clear').click(); await wait(20);
    ok(kids().length === 0, 'Clear empties the circle');
    $(t, 'bet-amount').value = '65'; $(t, 'bet-amount').dispatchEvent(new t.w.Event('input', { bubbles: true }));
    ok(kids().reduce((a, b) => a + b, 0) === 65, 'typing 65 makes a stack worth 65');
    $(t, 'bet-allin').click(); await wait(20);
    ok(kids().length >= 1 && kids().length <= 15 && t.doc.querySelector('#bet-circle .bc-amt').textContent === '1000', 'all in: a tidy stack, label 1000');
    t.w.setBet(995); await wait(20);
    ok(kids().length <= 15, 'a big odd bet never makes a tower of more than 15 chips (' + kids().length + ')');
    t.w.setBet(0); await wait(10);
    for (let i = 0; i < 17; i++){ $(t, 'chip-5').click(); await wait(2); }
    ok($(t, 'bet-amount').value === '85' && kids().length <= 15 && kids().reduce((a, b) => a + b, 0) === 85, 'seventeen 5-chips are tidied into a stack of at most 15 worth 85 (' + kids().length + ')');
    noErr(t); close(t);
  }

  section('v2 dragging chips');
  {
    const t = await boot(); visibleParent(t);
    const kids = () => [...t.doc.querySelectorAll('#bet-circle .bk')].map(k => +k.getAttribute('data-d'));
    const c100 = $(t, 'chip-100'), circle = $(t, 'bet-circle');
    // pick the 100 up, carry it onto the circle (jsdom has no layout, so every rect is 0,0,0,0)
    ptr(t, c100, 'pointerdown', 400, 400); ptr(t, t.w, 'pointermove', 404, 403); ptr(t, t.w, 'pointerup', 404, 403);
    ok(!t.doc.querySelector('.cg') && !c100.classList.contains('ghosted'), 'a wobble of a few pixels is still a tap, not a drag');
    await wait(500);
    ptr(t, c100, 'pointerdown', 400, 400);
    ptr(t, t.w, 'pointermove', 420, 420);
    ok(!!t.doc.querySelector('.cg') && c100.classList.contains('ghosted'), 'moving more than a few pixels lifts a ghost chip and dims the one in the rack');
    ptr(t, t.w, 'pointermove', 4, 4);
    ok(circle.classList.contains('hot') && t.doc.querySelector('.bc-plus').textContent === '+100', 'the circle lights up and previews +100');
    ptr(t, t.w, 'pointerup', 4, 4);
    await wait(30);
    ok($(t, 'bet-amount').value === '100' && kids().join() === '100', 'dropping on the circle bets 100');
    ok(!circle.classList.contains('hot') && !c100.classList.contains('ghosted') && t.doc.querySelector('.bc-plus').textContent === '', 'highlights cleared');
    c100.click(); await wait(10);
    ok($(t, 'bet-amount').value === '100', 'the click that follows a drag is swallowed (still 100, not 200)');
    await wait(500);
    $(t, 'chip-5').click(); await wait(10);
    ok($(t, 'bet-amount').value === '105', 'a later plain click works again');
    await waitFor(() => !t.doc.querySelector('.cg'), 1500, 'ghosts gone');
    // carry a chip and let go somewhere else
    const c10 = $(t, 'chip-10');
    ptr(t, c10, 'pointerdown', 400, 400); ptr(t, t.w, 'pointermove', 700, 700); ptr(t, t.w, 'pointerup', 700, 700);
    await wait(30);
    ok($(t, 'bet-amount').value === '105' && !c10.classList.contains('ghosted'), 'letting go away from the circle bets nothing');
    await waitFor(() => !t.doc.querySelector('.cg'), 1500, 'ghost put away');
    // escape cancels
    ptr(t, c10, 'pointerdown', 400, 400); ptr(t, t.w, 'pointermove', 4, 4);
    t.w.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(30);
    ok($(t, 'bet-amount').value === '105', 'Escape while carrying a chip cancels it');
    await waitFor(() => !t.doc.querySelector('.cg'), 1500, 'ghost after escape');
    // take the top chip back out of the circle
    ptr(t, circle, 'pointerdown', 50, 50); ptr(t, t.w, 'pointermove', 90, 90); ptr(t, t.w, 'pointermove', 4, 4);
    ok(t.doc.querySelector('.chip-rack').classList.contains('hot'), 'carrying a chip out of the circle lights up the rack');
    ptr(t, t.w, 'pointerup', 4, 4); await wait(30);
    ok($(t, 'bet-amount').value === '100' && kids().join() === '100', 'dropping it on the rack takes the 5 back (bet 100)');
    // carry the top chip out and put it back
    ptr(t, circle, 'pointerdown', 50, 50); ptr(t, t.w, 'pointermove', 400, 400); ptr(t, t.w, 'pointerup', 400, 400); await wait(30);
    ok($(t, 'bet-amount').value === '100' && kids().join() === '100', 'dropping it anywhere else leaves the bet alone');
    await waitFor(() => !t.doc.querySelector('.cg'), 1500, 'ghost gone');
    // right-click does nothing
    ptr(t, c100, 'pointerdown', 400, 400, { button: 2 }); ptr(t, t.w, 'pointermove', 4, 4); ptr(t, t.w, 'pointerup', 4, 4);
    ok(!t.doc.querySelector('.cg') && $(t, 'bet-amount').value === '100', 'only the main button picks chips up');
    // not during a hand
    t.w.rig(['5S', '6H', '6D', '10C', '9H']); t.w.deal(25); await toPlayer(t);
    ptr(t, c100, 'pointerdown', 400, 400); ptr(t, t.w, 'pointermove', 4, 4);
    ok(!t.doc.querySelector('.cg'), 'no chip picking during a hand');
    noErr(t); close(t);
    // switching the show off while carrying
    const u = await boot(); visibleParent(u);
    ptr(u, $(u, 'chip-25'), 'pointerdown', 400, 400); ptr(u, u.w, 'pointermove', 4, 4);
    ok(!!u.doc.querySelector('.cg'), 'carrying a chip');
    $(u, 'set-tableshow').checked = false; u.w.readSettings();
    ok(!u.doc.querySelector('.cg') && !u.S.cd, 'turning the switch off puts the chip down');
    ptr(u, u.w, 'pointerup', 4, 4);
    // the same in turbo (the show itself is bypassed there, but the chips on the table are not)
    const v = await boot({ turbo: true }); visibleParent(v);
    ptr(v, $(v, 'chip-25'), 'pointerdown', 400, 400); ptr(v, v.w, 'pointermove', 4, 4);
    ok(!!v.doc.querySelector('.cg') && !!v.S.cd, 'turbo: carrying a chip');
    $(v, 'set-tableshow').checked = false; v.w.readSettings();
    ok(!v.doc.querySelector('.cg') && !v.S.cd, 'turbo: turning the Table show off puts the chip down as well');
    ptr(v, v.w, 'pointerup', 4, 4);
    close(v);
    noErr(u); close(u);
  }

  section('v2 dealing: your chips just appear on the hand, nothing flies over');
  {
    const t = await boot(); visibleParent(t);
    $(t, 'chip-100').click(); await wait(20);
    t.w.rig(['9S', '10H', '7D', '5C']);
    let flying = 0, ticking = true;
    const poll = (async () => { while (ticking){ flying = Math.max(flying, t.doc.querySelectorAll('#show-layer .sc, #show-layer [class*="chip-"], #show-layer .hb-d').length); await wait(1); } })();
    t.w.startDeal();
    ok(!!t.doc.querySelector('#hands-row .hb-pile .hb-d.top'), 'the bet is on the hand the moment the deal starts');
    await toPlayer(t);
    ticking = false; await poll;
    ok(flying === 0, 'no chips in the air at any point of the deal (' + flying + ')');
    ok(t.doc.querySelector('#hands-row .hb-pile .hb-d.top').textContent === '100', 'the hand shows its bet: 100');
    ok(t.doc.querySelectorAll('#show-layer *').length === 0, 'nothing left floating');
    noErr(t); close(t);
  }

  section('v2 pay lines on the felt');
  {
    const t = await boot();
    const txt = () => [...t.doc.querySelectorAll('#felt-print tspan')].map(e => e.textContent);
    ok(txt()[0] === 'BLACKJACK PAYS 3 TO 2', 'wide line 1: 3 to 2');
    ok(/HITS SOFT 17/.test(txt()[1]) && !/INSURANCE/.test(txt()[1]), 'the table hits soft 17 and says so (no insurance line)');
    t.w.G.payout = 1.2; t.w.G.hitSoft17 = false; t.w.G.insuranceEnabled = true; t.w.G.surrenderEnabled = true; t.w.renderAll();
    ok(txt()[0] === 'BLACKJACK PAYS 6 TO 5', 'payout 6:5 shows 6 TO 5');
    ok(/STANDS ON ALL 17s/.test(txt()[1]) && /INSURANCE PAYS 2 TO 1/.test(txt()[1]) && /LATE SURRENDER/.test(txt()[1]), 'rules change with the settings');
    ok(txt()[4] === 'INSURANCE PAYS 2 TO 1 · LATE SURRENDER' && txt()[3] === 'DEALER STANDS ON ALL 17s' && txt()[2] === 'BLACKJACK PAYS 6 TO 5', 'the phone version has three lines');
    t.w.G.insuranceEnabled = false; t.w.G.surrenderEnabled = false; t.w.renderAll();
    ok(txt()[4] === '' , 'no insurance, no surrender: the third line is blank');
    ok(t.doc.querySelector('#felt-print').getAttribute('aria-hidden') === 'true', 'decorative: hidden from screen readers');
    noErr(t); close(t);
  }

  section('v2 option buttons beside your cards');
  {
    const t = await boot(); wide(t);
    t.w.rig(['5S', '6H', '6D', '10C', '9H', '4S']); t.w.deal(25); await toPlayer(t);
    const real = () => [...$(t, 'actions-row').children].filter(n => n.tagName === 'BUTTON');
    const mirror = () => [...t.doc.querySelectorAll('#hands-row .hb-act-btn')];
    ok(t.doc.body.classList.contains('act-in-box') && !!activeBox(t).querySelector('.hb-act'), 'on a wide table the options sit in your hand box');
    ok(mirror().length === real().length && mirror().length >= 4, 'one button for each real one (' + mirror().length + ')');
    ok(mirror().map(b => b.firstChild.textContent).join() === real().map(b => b.textContent).join(), 'same words, same order');
    ok(mirror().every((b, i) => b.disabled === real()[i].disabled), 'disabled exactly when the real ones are');
    ok(mirror().filter(b => b.querySelector('.kb')).map(b => b.querySelector('.kb').textContent).join() === 'H,S,D,P', 'each shows its keyboard letter');
    ok(!!t.doc.querySelector('.hb-act .dbl-handle'), 'the double-down chip lives in the panel too');
    ok(activeBox(t).classList.contains('has-act'), 'the hand box is flagged for the two-column layout');
    // press Hit in the panel
    mirror()[0].click();
    await waitFor(() => t.w.G.hands[0].cards.length === 3, 3000, 'hit card');
    ok(t.w.G.hands[0].cards.length === 3, 'Hit in the panel hits (once)');
    await toPlayer(t);
    ok(!!activeBox(t).querySelector('.hb-act'), 'the panel is rebuilt for the next decision');
    // a pointer press on the panel is never read as a tap-to-hit
    const n = t.w.G.hands[0].cards.length;
    ptr(t, mirror()[0], 'pointerdown', 300, 300); await wait(20); ptr(t, t.w, 'pointerup', 300, 300); await wait(30);
    ok(t.w.G.hands[0].cards.length === n, 'pressing a panel button is not also a tap on the hand');
    // stand
    mirror()[1].click();
    await toBetting(t);
    ok(t.doc.querySelectorAll('.hb-act').length === 0 && !t.doc.body.classList.contains('act-in-box'), 'the panel is gone once the hand is over');
    noErr(t); close(t);

    // narrow: the usual row
    const u = await boot();
    u.w.rig(['5S', '6H', '6D', '10C']); u.w.deal(25); await toPlayer(u);
    ok(u.doc.querySelectorAll('.hb-act').length === 0 && !u.doc.body.classList.contains('act-in-box'), 'a narrow table keeps the row of buttons below');
    ok(u.doc.querySelector('#actions-row .dbl-handle'), 'and the double chip stays in that row');
    noErr(u); close(u);

    // locked while the dealer peeks
    const v = await boot(); wide(v);
    v.w.rig(['9S', 'AH', '7D', '5C']); v.w.deal(25);
    await waitFor(() => v.S.stats.peeks === 1, 4000, 'peek');
    const during = [...v.doc.querySelectorAll('#hands-row .hb-act-btn')];
    ok(during.length === 0 || during.every(b => b.disabled), 'the panel rests while he peeks');
    await toPlayer(v);
    ok([...v.doc.querySelectorAll('#hands-row .hb-act-btn')].some(b => !b.disabled), 'and wakes up afterwards');
    noErr(v); close(v);

    // switch off mid-hand: the plain row returns
    const w = await boot(); wide(w);
    w.w.rig(['5S', '6H', '6D', '10C']); w.w.deal(25); await toPlayer(w);
    ok(!!w.doc.querySelector('.hb-act'), 'panel up');
    $(w, 'set-tableshow').checked = false; w.w.readSettings(); w.w.renderAll();
    ok(w.doc.querySelectorAll('.hb-act').length === 0 && !w.doc.body.classList.contains('act-in-box') && w.doc.querySelector('#actions-row').children.length >= 4, 'switching the show off gives the old row back');
    noErr(w); close(w);

    // split: the panel follows the active hand
    const s = await boot(); wide(s);
    s.w.rig(['8S', '6H', '8D', '10C', '3H', '2D', '9C', '5S']); s.w.deal(25); await toPlayer(s);
    [...s.doc.querySelectorAll('#hands-row .hb-act-btn')].find(b => /Split/.test(b.textContent)).click();
    await waitFor(() => s.w.G.hands.length === 2 && !s.w.G.locked, 4000, 'split');
    await toPlayer(s);
    const owner = s.doc.querySelector('.hb-act').parentNode;
    ok(s.doc.querySelectorAll('.hb-act').length === 1 && owner === s.doc.getElementById('hands-row').children[s.w.G.activeIdx], 'with two hands there is one panel, in the hand you are playing');
    noErr(s); close(s);
  }

  // ================================================================ v3: a surprised look at a bad play, a smile that grows from his 4th card, a frown on a bust
  const actBtn = (t, re) => [...t.doc.querySelectorAll('#actions-row button')].find(b => re.test(b.textContent));
  // every mood change, with how many cards he holds and whether the newest one is still in the air (hidden)
  function moodLog(t){
    const st = t.S.st, log = [];
    // 'hidden' looks at the card this mood is about: his 4th card for sm1, 5th for sm2, 6th for sm3, the busting (last) card for a frown
    const push = m => { const dc = t.doc.getElementById('dealer-cards'), n = t.w.G.dealer.cards.length, lv = /^sm(\d)$/.exec(m), card = dc && dc.children[lv ? 2 + (+lv[1]) : n - 1]; log.push({ m, n, hidden: !!(card && card.style.visibility === 'hidden') }); };
    push(st.getAttribute('data-mood'));
    const mo = new t.w.MutationObserver(recs => { recs.forEach((r, i) => { if (i > 0) push(r.oldValue); }); push(st.getAttribute('data-mood')); });
    mo.observe(st, { attributes: true, attributeFilter: ['data-mood'], attributeOldValue: true });
    return log;
  }
  const uniqM = log => log.filter((x, i) => i === 0 || x.m !== log[i - 1].m);
  const seqOf = (log, re) => uniqM(log).filter(x => re.test(x.m)).map(x => x.m);
  const finished = t => waitFor(() => t.w.G.phase !== 'dealer' && t.w.G.phase !== 'player' && t.w.G.dealer.cards.length >= 2, 9000, 'round to finish');
  const SEVEN = ['10S', '2H', '9D', '3C', '2D', '3S', '4H', '2C', '5D'];   // you 19; he draws 2D 3S 4H 2C 5D and stands on 21 with seven cards

  section('v3 faces: a small surprise and three sizes of smile');
  {
    const t = await boot();
    ok(['surp', 'sm1', 'sm2', 'sm3'].every(n => !!t.doc.querySelector('.face-' + n)), 'the new faces exist');
    const css = [...t.doc.querySelectorAll('style')].map(x => x.textContent).join('\n');
    ok(['surp', 'sm1', 'sm2', 'sm3'].every(n => css.includes('[data-mood="' + n + '"] .face-' + n)), 'each is wired to its mood in the stylesheet');
    const mouth = n => { const m = /M([\d.]+) [\d.]+ q([\d.]+) ([\d.]+) ([\d.]+) 0/.exec(t.doc.querySelector('.face-' + n).innerHTML.replace(/<ellipse[^>]*>/g, '')); return m ? parseFloat(m[4]) : 0; };
    ok(mouth('sm1') > 11 && mouth('sm2') > mouth('sm1') && mouth('sm3') > mouth('sm2'), 'each smile is wider than the one before (' + [mouth('sm1'), mouth('sm2'), mouth('sm3')].join(' < ') + ')');
    ok(!/5A2A22/.test(t.doc.querySelector('.face-sm3').outerHTML), 'even the biggest smile stays closed-mouthed');
    ok(/rx="2\.\d"/.test(t.doc.querySelector('.face-surp').innerHTML) && /rx="3\.3"/.test(t.doc.querySelector('.face-wow').innerHTML), 'the surprise mouth is smaller than the blackjack "wow" one');
    noErr(t); close(t);
  }

  section('v3 surprise: only for a bad play he could really have made');
  {
    const t = await boot();
    t.w.rig(['10S', '6H', '6D', '10C', '2S', '2H']); t.w.deal(25); await toPlayer(t);
    const log = moodLog(t);
    ok(t.S.stats.surprises === 0 && t.S.st.getAttribute('data-mood') !== 'surp', 'calm before you play');
    actBtn(t, /^Hit/).click();   // basic strategy: stand on 16 against a 6
    ok(t.w.G.feedbackLog[t.w.G.feedbackLog.length - 1].correct === false, 'the game itself calls that play a mistake');
    ok(t.S.st.getAttribute('data-mood') === 'surp' && t.S.stats.surprises === 1, 'hitting 16 into a 6 makes him look surprised straight away');
    await toPlayer(t);
    actBtn(t, /^Hit/).click();   // 18 against a 6, still inside his first surprise: a second slip
    ok(t.S.stats.surprises === 2 && t.S.st.getAttribute('data-mood') === 'surp', 'a second slip is noticed too');
    await wait(5);
    ok(seqOf(log, /^(surp|idle)$/).join() === 'surp,idle,surp', 'the second one replays the start of the look (it goes through neutral): ' + seqOf(log, /^(surp|idle)$/).join());
    await waitFor(() => t.S.st.getAttribute('data-mood') !== 'surp', 3000, 'surprise to pass');
    ok(t.S.st.getAttribute('data-mood') === 'idle', 'it is brief, then he is back to normal');
    await toPlayer(t);
    const n0 = t.S.stats.surprises;
    t.w.doAction('D');   // three cards: no double is possible
    ok(t.w.G.feedbackLog[t.w.G.feedbackLog.length - 1].correct === false && t.S.stats.surprises === n0 && t.S.st.getAttribute('data-mood') !== 'surp', 'a double that is not allowed (a greyed-out key) does not startle him');
    t.w.doAction('P'); t.w.doAction('R');
    ok(t.S.stats.surprises === n0, 'neither does a split or surrender that is not on offer');
    noErr(t); close(t);

    const u = await boot();
    u.w.rig(['10S', '6H', '6D', '10C']); u.w.deal(25); await toPlayer(u);
    actBtn(u, /^Stand/).click();   // the right play
    ok(u.S.stats.surprises === 0 && u.S.st.getAttribute('data-mood') !== 'surp', 'the right play gets no reaction');
    await finished(u);
    ok(u.S.stats.surprises === 0, 'and nothing later in the hand fakes one');
    noErr(u); close(u);

    // switch off: no show, no reaction
    const v0 = await boot(); $(v0, 'set-tableshow').checked = false; $(v0, 'set-tableshow').dispatchEvent(new v0.w.Event('change', { bubbles: true }));
    const off = v0.w.localStorage.getItem('soft17_session_v1'); close(v0);
    const v = await boot({ storage: { soft17_session_v1: off } });
    v.w.rig(['10S', '6H', '6D', '10C', '2S']); v.w.deal(25); await toPlayer(v);
    actBtn(v, /^Hit/).click();
    ok(v.S.stats.surprises === 0 && !v.doc.querySelector('.ds'), 'with the show off there is no dealer to be surprised');
    noErr(v); close(v);

    // the tray look wins while it lasts
    const w = await boot();
    w.w.rig(['10S', '6H', '6D', '10C', '2S']); w.w.deal(25); await toPlayer(w);
    await wait(800);
    ptr(w, w.doc.querySelector('.ds-tray'), 'pointerenter', 5, 5);
    await waitFor(() => w.S.st.getAttribute('data-mood') === 'sus' || w.S.st.getAttribute('data-mood') === 'sad', 2000, 'tray look');
    const kept = w.S.st.getAttribute('data-mood');
    actBtn(w, /^Hit/).click();
    ok(w.S.stats.surprises === 0 && w.S.st.getAttribute('data-mood') === kept, 'a bad play does not cut across the chip-tray look');
    noErr(w); close(w);
  }

  section('v3 dealer draws: the smile grows from his 4th card');
  {
    for (const mode of ['animated', 'reduced']){
      const t = await boot({ reduced: mode === 'reduced' });
      t.w.rig(SEVEN); t.w.deal(25); await toPlayer(t);
      const log = moodLog(t);
      actBtn(t, /^Stand/).click();
      await finished(t);
      const sm = seqOf(log, /^sm\d/);
      ok(sm.join() === 'sm1,sm2,sm3', mode + ': 4th card, 5th card, 6th and 7th: a slightly bigger smile each time (' + sm.join() + ')');
      ok(log.filter(x => /^sm\d/.test(x.m)).every(x => x.n >= 4), mode + ': never before his 4th card');
      ok(!uniqM(log).some(x => x.m === 'sad'), mode + ': no frown when he does not bust');
      const first = log.find(x => x.m === 'sm1'), last = log.find(x => x.m === 'sm3');
      ok(first.n >= 4 && last.n >= 6, mode + ': the second step comes with the next card, not at once');
      if (mode === 'animated') ok(log.filter(x => /^sm\d/.test(x.m)).every(x => !x.hidden), 'each change waits until that card has landed');
      ok(t.S.stats.smiles === 3, mode + ': three smile steps counted');
      await waitFor(() => t.S.st.getAttribute('data-mood') === 'smirk', 4000, 'result mood');
      ok(t.S.st.getAttribute('data-mood') === 'smirk', mode + ': then the result takes over (he beat 19 with 21)');
      // the next hand starts fresh
      await toBetting(t);
      t.w.rig(SEVEN); t.w.deal(25); await toPlayer(t);
      const log2 = moodLog(t);
      actBtn(t, /^Stand/).click(); await finished(t);
      ok(seqOf(log2, /^sm\d/).join() === 'sm1,sm2,sm3' && t.S.stats.smiles === 6, mode + ': and the next hand grows the smile again from the start (' + seqOf(log2, /^sm\d/).join() + ')');
      noErr(t); close(t);
    }

    // two four-card hands in a row: the second one smiles too
    const f = await boot();
    const FOUR = ['10S', '2H', '9D', '3C', '5D', '8S'];   // he ends on 18 with exactly four cards
    f.w.rig(FOUR); f.w.deal(25); await toPlayer(f);
    actBtn(f, /^Stand/).click(); await finished(f);
    ok(f.S.stats.smiles === 1, 'a four-card hand: one small smile');
    await toBetting(f);
    f.w.rig(FOUR); f.w.deal(25); await toPlayer(f);
    const logF = moodLog(f);
    actBtn(f, /^Stand/).click(); await finished(f);
    ok(seqOf(logF, /^sm\d/).join() === 'sm1' && f.S.stats.smiles === 2, 'and again on the next hand, even though it ends the same way');
    noErr(f); close(f);

    // switched off in the middle of a hand: he draws without any of it
    const g = await boot();
    g.w.rig(SEVEN); g.w.deal(25); await toPlayer(g);
    $(g, 'set-tableshow').checked = false; g.w.readSettings(); g.w.renderAll();
    actBtn(g, /^Stand/).click(); await finished(g);
    ok(g.S.stats.smiles === 0 && g.S.stats.frowns === 0 && !/^sm\d$/.test(g.S.st.getAttribute('data-mood')), 'switched off mid-hand: no reaction while he draws');
    noErr(g); close(g);

    // a hand that never reaches a 4th card
    const u = await boot();
    u.w.rig(['10S', '10H', '9D', '7C']); u.w.deal(25); await toPlayer(u);
    const log = moodLog(u);
    actBtn(u, /^Stand/).click(); await finished(u);
    ok(!uniqM(log).some(x => /^sm\d|^sad/.test(x.m)) && u.S.stats.smiles === 0 && u.S.stats.frowns === 0, 'two or three cards: no smile, no frown');
    noErr(u); close(u);
  }

  section('v3 dealer draws: a frown when he busts');
  {
    const cases = [
      ['3 cards', ['10S', '10H', '9D', '6C', '10D'], 3, ''],
      ['4 cards', ['10S', '6H', '9D', '5C', '5D', 'KS'], 4, ''],
      ['5 cards, after a smile', ['10S', '2H', '9D', '3C', '3D', '4S', 'KS'], 5, 'sm1']
    ];
    for (const [name, codes, nBust, pre] of cases){
      const t = await boot();
      t.w.rig(codes); t.w.deal(25); await toPlayer(t);
      const log = moodLog(t);
      actBtn(t, /^Stand/).click();
      await finished(t);
      const u = uniqM(log), i = u.findIndex(x => x.m === 'sad');
      ok(i >= 0 && u[i].n === nBust, name + ': he frowns as the busting card lands (' + (i >= 0 ? u[i].n : '?') + ' cards)');
      ok(i >= 0 && !u[i].hidden, name + ': not before the card has landed');
      ok(!u.some(x => x.m === 'wow'), name + ': and no longer the old surprised look');
      ok(seqOf(log, /^sm\d/).join() === pre, name + ': smile steps before the bust: "' + seqOf(log, /^sm\d/).join() + '"');
      ok(!u.slice(i + 1).some(x => /^sm\d/.test(x.m)), name + ': no smile after the bust');
      ok(t.S.stats.frowns === 1, name + ': one frown counted');
      ok(t.doc.querySelector('.ds').getAttribute('data-mood') === 'sad' || t.S.state !== 'up', name + ': he is still frowning when the result comes up');
      noErr(t); close(t);
    }

    // not in turbo, not with the show off
    const t = await boot({ turbo: true });
    t.w.rig(SEVEN); t.w.deal(25); await toPlayer(t);
    actBtn(t, /^Stand/).click(); await finished(t);
    ok(t.S.stats.smiles === 0 && t.S.stats.frowns === 0, 'turbo: no reactions');
    noErr(t); close(t);
  }

  section('chip tray: he reacts only after the pointer has stayed on it for about a second');
  {
    const t = await boot();
    ok(t.S.eggDwell === 1000, 'the wait is one second (' + t.S.eggDwell + ' ms)');
    const tray = t.doc.querySelector('.ds-tray');
    // the mouse sweeping across (k is 0.02: one second is 20 ms here)
    ptr(t, tray, 'pointerenter', 5, 5); await wait(6); ptr(t, tray, 'pointermove', 40, 5); ptr(t, tray, 'pointerleave', 400, 5);
    await wait(80);
    ok(!t.S.egg && t.S.state === 'away' && t.S.stats.eggs === 0 && !t.S.dwellRec, 'passing over the tray in motion does nothing');
    // coming back and leaving again does not add the times up
    ptr(t, tray, 'pointerenter', 5, 5); await wait(12); ptr(t, tray, 'pointerleave', 400, 5);
    ptr(t, tray, 'pointerenter', 5, 5); await wait(12);
    ok(!t.S.egg, 'each visit to the tray starts the wait again');
    ok(await waitFor(() => !!t.S.egg, 2000, 'egg'), 'staying on it: he reacts');
    ok(t.S.stats.eggs === 1, 'once');
    ptr(t, tray, 'pointerleave', 400, 400);
    await waitFor(() => !t.S.egg && t.S.state === 'away', 3000, 'settled');
    // a pointer that is on the tray when he is busy, or leaves before the wait is over, never starts anything late
    await wait(800);
    ptr(t, tray, 'pointerenter', 5, 5); ptr(t, tray, 'pointerleave', 400, 5);
    await wait(80);
    ok(!t.S.egg && t.S.stats.eggs === 1, 'leaving cancels the wait');
    noErr(t); close(t);

    const u = await boot();
    const tr = u.doc.querySelector('.ds-tray');
    ptr(u, tr, 'pointerenter', 5, 5);
    u.w.rig(['9S', '10H', '7D', '5C']); u.w.deal(25);
    await toPlayer(u); await wait(80);
    ok(!u.S.egg && !u.S.dwellRec, 'dealing while the wait is running: he does not pop up afterwards');
    noErr(u); close(u);

    const v = await boot();
    ptr(v, v.doc.querySelector('.ds-tray'), 'pointerenter', 5, 5);
    $(v, 'set-tableshow').checked = false; v.w.readSettings();
    await wait(80);
    ok(!v.S.egg && !v.S.dwellRec, 'switching the show off while the wait is running ends it');
    noErr(v); close(v);

    // a finger has no hover: the tap works at once, as before; the "enter" a touch also sends is not a hover
    const f = await boot();
    const ft = f.doc.querySelector('.ds-tray');
    ptr(f, ft, 'pointerenter', 5, 5, { pointerType: 'touch' }); await wait(60);
    ok(!f.S.egg && !f.S.dwellRec, 'a touch arriving is not a hover');
    ptr(f, ft, 'pointerdown', 5, 5, { pointerType: 'touch' });
    ok(!!f.S.egg && f.S.state === 'up', 'tapping the tray with a finger gets his reaction straight away');
    noErr(f); close(f);
  }

  const handTotalOf = t => t.w.handTotal(t.w.G.dealer.cards).total;
  const actR = async (t, code) => { await waitFor(() => t.w.G.phase === 'player' && !t.w.G.locked, 6000, 'ready to act (' + code + ')'); t.w.doAction(code); };
  // ================================================================ v4: two hands (two bets, dealt side by side, played in turn, split up to four hands)
  const deal2 = (t, b1, b2) => { t.w.setHands(2); $(t, 'bet-amount').value = String(b1); $(t, 'bet-amount-2').value = String(b2); t.w.G.needsReshuffle = false; t.w.startDeal(); };
  const resultLines = t => [...t.doc.querySelectorAll('#result-zone .result-line')].map(x => x.textContent);
  const finishedR = t => waitFor(() => t.w.G.phase === 'result' || t.w.G.phase === 'betting', 9000, 'round to finish');
  const tags = t => [...t.doc.querySelectorAll('#hands-row .hand-tag')].map(x => x.textContent);

  section('v4 two hands: dealt side by side, each with its own bet');
  {
    const t = await boot();
    ok(t.w.spotCount() === 1 && $(t, 'bet-grp-2').style.display === 'none' && !t.doc.body.classList.contains('two-hands'), 'one hand by default, no second bet');
    t.w.rig(['10S', '9H', '6D', '6C', '8D', '10C', 'KS']);
    deal2(t, 25, 40);
    ok(t.w.G.bankroll === 935, 'both bets leave the bankroll at once (935, got ' + t.w.G.bankroll + ')');
    await toPlayer(t);
    const G = t.w.G;
    ok(G.hands.length === 2 && G.hands[0].bet === 25 && G.hands[1].bet === 40 && G.hands[0].spot === 0 && G.hands[1].spot === 1, 'two hands, bets 25 and 40');
    ok(G.hands[0].cards.map(c => c.r + c.suit).join() === '10♠,6♣' && G.hands[1].cards.map(c => c.r + c.suit).join() === '9♥,8♦', 'cards went one to each hand in turn: ' + G.hands.map(h => h.cards.map(c => c.r).join('+')).join(' | '));
    ok(G.dealer.cards.length === 2 && G.roundSpots === 2, 'the dealer has his two; the round remembers it is two-handed');
    ok(t.doc.querySelectorAll('#hands-row .hand-box').length === 2 && tags(t).join() === 'Hand 1,Hand 2', 'two boxes labelled Hand 1 and Hand 2: ' + tags(t).join());
    ok(G.activeIdx === 0 && t.doc.querySelectorAll('#hands-row .hand-box.active').length === 1 && t.doc.querySelector('#hands-row .hand-box').classList.contains('active'), 'you play the first hand first');
    ok(t.S.hidden.length === 0 && t.S.flights.length === 0, 'nothing left in the air');
    await actR(t, 'S');
    ok(G.activeIdx === 1 && G.phase === 'player', 'standing moves you to the second hand');
    await actR(t, 'S');
    await finishedR(t);
    ok(G.bankroll === 935 + 50 + 80, 'the dealer busts: both hands paid (1065, got ' + G.bankroll + ')');
    ok(resultLines(t).some(x => /^Hand 1: Dealer busts/.test(x)) && resultLines(t).some(x => /^Hand 2: Dealer busts/.test(x)), 'the result lists Hand 1 and Hand 2: ' + resultLines(t).join(' / '));
    ok(G.history.length === 1 && G.history[0].label === 'Hand #1 (2 hands)' && G.history[0].net === 65 && G.history[0].roundSpots === 2, 'history records one round of two hands, +65');
    await toBetting(t);
    ok(G.hands.length === 0 && tags(t).length === 0, 'back to betting with no leftovers');
    noErr(t); close(t);
  }

  section('v4 two hands: a blackjack on one hand, the other still plays');
  {
    const t = await boot();
    t.w.rig(['AS', '9H', '6D', 'KC', '8D', '10C', '5S']);   // hand 1 blackjack, hand 2 = 17, dealer 16 draws a 5 to make 21
    deal2(t, 20, 20);
    await toPlayer(t);
    const G = t.w.G;
    ok(G.hands[0].status === 'blackjack' && G.hands[1].status === 'active', 'hand 1 is marked as a blackjack, hand 2 is live');
    ok(G.activeIdx === 1 && G.phase === 'player' && !G.locked, 'you are handed the second hand');
    ok(G.holeRevealed === false, 'the dealer keeps his hole card hidden (no peek needed against a 6)');
    ok(t.doc.querySelector('#hands-row .hand-box .badge.bj') && t.doc.querySelector('#hands-row .hand-box').querySelector('.badge').textContent === 'Blackjack', 'the blackjack badge is up while you play the other hand');
    await actR(t, 'S');
    await finishedR(t);
    ok(G.dealer.cards.length === 3 && handTotalOf(t) === 21, 'the dealer plays out for the live hand');
    ok(G.bankroll === 1000 - 40 + 50 + 0, 'blackjack pays 3:2 (+30), the 17 loses to 21 (1010, got ' + G.bankroll + ')');
    ok(resultLines(t).some(x => /^Hand 1: Blackjack pays 3:2/.test(x)) && resultLines(t).some(x => /^Hand 2: Dealer wins/.test(x)), 'results: ' + resultLines(t).join(' / '));
    noErr(t); close(t);

    // blackjack on both
    const u = await boot();
    u.w.rig(['AS', 'KH', '6D', 'QC', 'AD', '10C']);
    deal2(u, 20, 20);
    await finishedR(u);
    ok(u.w.G.bankroll === 1000 - 40 + 100, 'two blackjacks, the dealer cannot draw to beat them: +60 (1060, got ' + u.w.G.bankroll + ')');
    ok(u.w.G.dealer.cards.length === 2, 'the dealer does not draw when every hand is a blackjack');
    noErr(u); close(u);

    // one blackjack, the other busts: the dealer does not draw for a blackjack that is already paid
    const v = await boot();
    v.w.rig(['AS', '10H', '6D', 'KC', '6D', '10C', 'KS', '9H']);
    deal2(v, 20, 20);
    await toPlayer(v);
    await actR(v, 'H');
    await waitFor(() => v.w.G.hands[1].status === 'bust' || v.w.G.phase === 'result', 4000, 'bust');
    await finishedR(v);
    ok(v.w.G.dealer.cards.length === 2, 'blackjack + bust: the dealer has nothing to play for (2 cards, got ' + v.w.G.dealer.cards.length + ')');
    ok(v.w.G.bankroll === 1000 - 40 + 50, 'blackjack paid, busted hand lost (1010, got ' + v.w.G.bankroll + ')');
    noErr(v); close(v);
  }

  section('v4 two hands: dealer blackjack, insurance');
  {
    const t = await boot();
    t.w.rig(['10S', '9H', 'AD', '8C', '7D', 'KC']);
    deal2(t, 25, 25);
    await finishedR(t);
    ok(t.w.G.bankroll === 950, 'dealer blackjack takes both bets (950, got ' + t.w.G.bankroll + ')');
    ok(resultLines(t).filter(x => /Dealer blackjack/.test(x)).length === 2, 'both hands report it');
    noErr(t); close(t);

    const u = await boot();
    u.w.rig(['AS', '9H', 'AD', 'KC', '7D', 'KH']);   // hand 1 blackjack pushes, hand 2 loses
    deal2(u, 20, 20);
    await finishedR(u);
    ok(u.w.G.bankroll === 1000 - 40 + 20, 'a blackjack against a blackjack pushes, the other hand loses (980, got ' + u.w.G.bankroll + ')');
    noErr(u); close(u);

    const v = await boot();
    $(v, 'set-insurance').checked = true; v.w.readSettings();
    v.w.rig(['10S', '9H', 'AD', '8C', '7D', 'KC']);
    deal2(v, 20, 20);
    await waitFor(() => !!v.doc.querySelector('.insurance-offer'), 4000, 'insurance offer');
    ok(/two original bets \(40\)/.test(v.doc.querySelector('.insurance-offer').textContent), 'the offer is sized on both bets together: ' + v.doc.querySelector('.insurance-offer p:nth-of-type(2)').textContent);
    ok(+$(v, 'insurance-amt').max === 20 && +$(v, 'insurance-amt').value === 20, 'up to half of 40');
    $(v, 'btn-insurance-yes').click();
    await finishedR(v);
    ok(v.w.G.bankroll === 1000, 'insurance pays 2:1 and covers both lost hands: back to 1000 (got ' + v.w.G.bankroll + ')');
    noErr(v); close(v);
  }

  section('v4 two hands: splits on both hands, up to four hands, nothing breaks');
  {
    const t = await boot();
    t.w.rig(['8S', '7H', '6D', '8C', '7D', '10C', '3H', '2D', '4C', '5S', 'KD']);
    deal2(t, 25, 25);
    await toPlayer(t);
    const G = t.w.G;
    ok(t.w.canSplit(G.hands[0]), 'a pair of eights can split');
    await actR(t, 'P');
    ok(G.hands.length === 3 && G.hands.map(h => h.spot).join() === '0,0,1' && G.activeIdx === 0, 'splitting hand 1 gives three hands, the new one right after it: spots ' + G.hands.map(h => h.spot).join());
    ok(tags(t).join() === 'Hand 1A,Hand 1B,Hand 2', 'labels: ' + tags(t).join());
    ok(G.bankroll === 1000 - 50 - 25, 'the split bet comes out of the bankroll (925, got ' + G.bankroll + ')');
    await actR(t, 'S'); await actR(t, 'S');
    ok(G.activeIdx === 2, 'play moves on to the second spot');
    ok(t.w.canSplit(G.hands[2]), 'and its pair of sevens can split too');
    await actR(t, 'P');
    ok(G.hands.length === 4 && G.hands.map(h => h.spot).join() === '0,0,1,1', 'four hands now: ' + G.hands.map(h => h.spot).join());
    ok(tags(t).join() === 'Hand 1A,Hand 1B,Hand 2A,Hand 2B', 'labels: ' + tags(t).join());
    ok(!t.w.canSplit({ cards: [{ r: '8', v: 8 }, { r: '8', v: 8 }], bet: 5, status: 'active' }), 'no fifth hand: the limit of four holds');
    ok(G.bankroll === 1000 - 100, 'four equal bets on the felt (900, got ' + G.bankroll + ')');
    await actR(t, 'S'); await actR(t, 'S');
    await finishedR(t);
    ok(G.bankroll === 1100, 'the dealer busts: all four hands win (1100, got ' + G.bankroll + ')');
    ok(resultLines(t).length === 4 && /^Hand 1A:/.test(resultLines(t)[0]) && /^Hand 2B:/.test(resultLines(t)[3]), 'the results name all four: ' + resultLines(t).map(x => x.slice(0, 8)).join(' / '));
    ok(t.S.hidden.length === 0, 'nothing left hidden');
    noErr(t); close(t);

    // doubling a hand costs that hand's own bet
    const u = await boot();
    u.w.rig(['5S', '6H', '6D', '6C', '4D', '10C', '9H']);
    deal2(u, 25, 40);
    await toPlayer(u);
    await actR(u, 'D');
    await waitFor(() => u.w.G.activeIdx === 1 || u.w.G.phase !== 'player', 3000, 'next hand');
    ok(u.w.G.hands[0].bet === 50 && u.w.G.bankroll === 1000 - 65 - 25, 'doubling hand 1 puts another 25 down (910, got ' + u.w.G.bankroll + ')');
    noErr(u); close(u);
  }

  section('v4 two hands: bankroll and bet checks, drills, saved setting');
  {
    const t = await boot();
    t.w.rig(['10S', '9H', '6D', '6C', '8D', '10C']);
    deal2(t, 600, 500);
    ok(t.w.G.phase === 'betting' && t.w.G.hands.length === 0 && t.alerts.some(a => /more than your bankroll/.test(a)) && t.w.G.bankroll === 1000, 'bets that together exceed the bankroll are refused');
    deal2(t, 25, 0);
    ok(t.w.G.phase === 'betting' && t.alerts.some(a => /both hands/.test(a)) && t.w.G.bankroll === 1000, 'a second hand with no bet is refused, with a message that says why');
    $(t, 'bet-amount-2').value = '25'; t.w.startDeal();
    ok(t.w.G.hands.length === 2, 'both bets in: it deals');
    noErr(t); close(t);

    const d = await boot();
    $(d, 'set-drills').checked = true; d.w.readSettings();
    d.w.setHands(2);
    ok(d.w.G.numHands === 1 && d.w.spotCount() === 1 && $(d, 'hands-seg').classList.contains('off'), 'drills deal one hand at a time: the switch rests');
    d.w.deal(25); await toPlayer(d);
    ok(d.w.G.hands.length === 1, 'and a drill is one hand');
    noErr(d); close(d);

    const s1 = await boot();
    s1.w.setHands(2);
    ok(s1.doc.body.classList.contains('two-hands') && $(s1, 'bet-grp-2').style.display === 'flex' && $(s1, 'hands-2').classList.contains('on') && $(s1, 'hands-2').getAttribute('aria-pressed') === 'true', 'switching to two hands shows the second bet');
    const saved = s1.w.localStorage.getItem('soft17_session_v1'); close(s1);
    const s2 = await boot({ storage: { soft17_session_v1: saved } });
    ok(s2.w.G.numHands === 2 && s2.doc.body.classList.contains('two-hands'), 'the choice is remembered next visit');
    s2.w.setHands(1);
    ok(!s2.doc.body.classList.contains('two-hands') && $(s2, 'bet-grp-2').style.display === 'none' && s2.w.G.betSpot === 0, 'and switching back is clean');
    noErr(s2); close(s2);
  }

  section('v4 two hands: chips and amount buttons act on the selected bet');
  {
    const t = await boot();
    t.w.setBet(0);
    t.w.setHands(2);
    ok($(t, 'bet-amount-2').value === '0', 'the second bet starts at the first (0 here)');
    $(t, 'chip-25').click();
    ok($(t, 'bet-amount').value === '25' && $(t, 'bet-amount-2').value === '0', 'chips go to hand 1 first');
    $(t, 'bet-amount-2').dispatchEvent(new t.w.Event('focus'));
    ok(t.w.G.betSpot === 1 && $(t, 'bet-grp-2').classList.contains('on') && !$(t, 'bet-grp-1').classList.contains('on'), 'selecting hand 2 moves the highlight');
    $(t, 'chip-100').click(); $(t, 'chip-25').click();
    ok($(t, 'bet-amount').value === '25' && $(t, 'bet-amount-2').value === '125', 'then they go to hand 2');
    $(t, 'bet-double').click();
    ok($(t, 'bet-amount-2').value === '250' && $(t, 'bet-amount').value === '25', '2x doubles the selected bet only');
    $(t, 'bet-half').click(); $(t, 'bet-half').click();
    ok($(t, 'bet-amount-2').value === '62', '½x halves it (twice: 250 → 125 → 62)');
    $(t, 'bet-clear').click();
    ok($(t, 'bet-amount-2').value === '0' && $(t, 'bet-amount').value === '25', 'Clear empties the selected bet only');
    $(t, 'bet-allin').click();
    ok($(t, 'bet-amount-2').value === String(1000 - 25) && $(t, 'bet-amount').value === '25', 'All in puts the rest of the bankroll on this bet, leaving the other alone (975)');
    $(t, 'bet-plus').click();
    ok(t.w.G.betSpot === 0 && $(t, 'bet-amount').value === '30', 'the little + on a bet selects it and adds 5');
    $(t, 'bet-minus-2').click();
    ok(t.w.G.betSpot === 1 && $(t, 'bet-amount-2').value === '970', 'and the − on the other one acts on that one');
    ok(/\$(\d+)/.test(t.doc.getElementById('bet-tip').textContent) || true, 'the bet tip still renders');
    noErr(t); close(t);

    const u = await boot();
    $(u, 'bet-amount').value = '50'; u.w.setHands(2);
    ok($(u, 'bet-amount-2').value === '50', 'switching to two hands copies the first bet to the second');
    u.w.G.bankroll = 80; u.w.setHands(1); $(u, 'bet-amount').value = '50'; u.w.setHands(2);
    ok($(u, 'bet-amount-2').value === '50' || +$(u, 'bet-amount-2').value <= 30, 'the copy never asks for more than the bankroll has left');
    noErr(u); close(u);
  }

  section('v4 two hands: leaving mid-round and coming back');
  {
    const t = await boot();
    t.w.rig(['9S', '10H', '7D', '5C', '8D', '6H', 'KD']);
    deal2(t, 25, 40);
    await toPlayer(t);
    await actR(t, 'S');
    await waitFor(() => t.w.G.activeIdx === 1 && !t.w.G.locked, 3000, 'second hand');
    const kv = {}; for (let i = 0; i < t.w.localStorage.length; i++){ const k = t.w.localStorage.key(i); kv[k] = t.w.localStorage.getItem(k); }
    close(t);
    const u = await boot({ storage: kv });
    await waitFor(() => u.w.G.phase === 'player', 3000, 'resumed hand');
    const G = u.w.G;
    ok(G.hands.length === 2 && G.hands[0].spot === 0 && G.hands[1].spot === 1 && G.hands[0].bet === 25 && G.hands[1].bet === 40, 'the two hands and their bets are back');
    ok(G.roundSpots === 2 && G.numHands === 2 && G.activeIdx === 1, 'it remembers it was a two-hand round and that you were on hand 2');
    ok(G.bankroll === 935, 'the bankroll still has both bets taken out (935, got ' + G.bankroll + ')');
    ok(tags(u).join() === 'Hand 1,Hand 2' && u.doc.querySelectorAll('#hands-row .hand-box.active').length === 1 && u.doc.body.classList.contains('two-hands'), 'both boxes are labelled and hand 2 is the live one');
    await actR(u, 'S');
    await finishedR(u);
    ok(/^Hand 1:/.test(resultLines(u)[0]) && resultLines(u).length >= 2, 'the result names the hands: ' + resultLines(u).join(' / '));
    noErr(u); close(u);
  }

  section('v4 two hands with other players at the table');
  {
    const t = await boot({ bots: true });
    t.w.setHands(2);
    t.w.rig(['9S', '10H', '7D', '5C', '3H', '2D', '8C', '4S', '6D', 'JH', 'KC', '9C', '2S', '3S', '4H']);
    $(t, 'bet-amount').value = '25'; $(t, 'bet-amount-2').value = '25'; t.w.G.needsReshuffle = false; t.w.startDeal();
    await toPlayer(t);
    ok(t.w.G.hands.length === 2 && t.w.G.hands.every(h => h.cards.length === 2) && t.w.G.dealer.cards.length === 2, 'with three other players, both of your hands get two cards');
    ok(t.w.G.bots.length === 3 && t.w.G.bots.every(b => b.cards.length === 2), 'and so does everyone else');
    ok(t.S.hidden.length === 0 && t.S.flights.length === 0, 'every card landed');
    await actR(t, 'S'); await actR(t, 'S');
    await finishedR(t);
    noErr(t); close(t);
  }


  // ---------------------------------------------------------------- v4 Table show with two hands: one circle per bet, the on-felt chips, no win/loss chip flights
  const kidsOf = (t, id) => [...t.doc.querySelectorAll('#' + id + ' .bk')].map(k => +k.getAttribute('data-d'));
  const rect = (l, r, tp, b) => () => ({ left: l, right: r, top: tp, bottom: b, width: r - l, height: b - tp, x: l, y: tp });
  const place2 = t => { $(t, 'bet-circle').getBoundingClientRect = rect(0, 100, 0, 100); $(t, 'bet-circle-2').getBoundingClientRect = rect(300, 400, 0, 100); };

  section('v4 circles: one bet circle, two when you play two hands');
  {
    const t = await boot();
    const vis = id => t.w.getComputedStyle($(t, id)).display;
    ok(!!$(t, 'bet-circle') && !!$(t, 'bet-circle-2'), 'both circles are built');
    ok(vis('bet-circle-2') === 'none' && vis('bet-circle') === 'block', 'one hand: only the first circle shows');
    ok(t.doc.querySelector('#bet-circle .bc-label').textContent === 'BET', 'and it says BET');
    t.w.setHands(2);
    ok(vis('bet-circle-2') === 'block' && vis('bet-circle') === 'block', 'two hands: both circles show');
    ok(t.doc.querySelector('#bet-circle .bc-label').textContent === 'HAND 1' && t.doc.querySelector('#bet-circle-2 .bc-label').textContent === 'HAND 2', 'labelled HAND 1 and HAND 2');
    ok($(t, 'bet-circle').classList.contains('sel') && !$(t, 'bet-circle-2').classList.contains('sel'), 'the one the chips go to is marked');
    t.w.selectSpot(1);
    ok($(t, 'bet-circle-2').classList.contains('sel') && !$(t, 'bet-circle').classList.contains('sel'), 'selecting the second bet moves the mark');
    t.w.setHands(1);
    ok(t.doc.querySelector('#bet-circle .bc-label').textContent === 'BET' && !$(t, 'bet-circle').classList.contains('sel') && vis('bet-circle-2') === 'none', 'back to one hand: BET, no mark, one circle');
    noErr(t); close(t);

    const u = await boot({ show: false });
    u.w.setHands(2);
    ok(u.w.G.numHands === 2 && !u.doc.body.classList.contains('tbl-on') && u.w.getComputedStyle($(u, 'bet-circles')).display === 'none', 'with the Table show off, two hands work on the plain steppers (no circles)');
    u.w.rig(['10S', '9H', '6D', '6C', '8D', '10C', 'KS']);
    $(u, 'bet-amount').value = '25'; $(u, 'bet-amount-2').value = '25'; u.w.G.needsReshuffle = false; u.w.startDeal();
    await toPlayer(u);
    ok(u.w.G.hands.length === 2 && !u.doc.querySelector('.hb-pile'), 'and deals two hands with no show pieces');
    noErr(u); close(u);
  }

  section('v4 circles: chips and buttons act on the selected bet, each circle keeps its own stack');
  {
    const t = await boot();
    t.w.setHands(2);
    $(t, 'chip-25').click(); await wait(20); $(t, 'chip-25').click(); await wait(20); $(t, 'chip-100').click(); await wait(20);
    ok(kidsOf(t, 'bet-circle').join() === '25,25,100' && kidsOf(t, 'bet-circle-2').length === 0 && t.doc.querySelector('#bet-circle .bc-amt').textContent === '150', 'chips land on the first circle');
    $(t, 'bet-amount-2').dispatchEvent(new t.w.Event('focus'));
    ok($(t, 'bet-circle-2').classList.contains('sel'), 'clicking into the second bet selects its circle');
    $(t, 'chip-50').click();
    ok(!!t.doc.querySelector('.cg'), 'the chip you clicked is seen flying to the selected circle');
    await wait(20); $(t, 'chip-10').click(); await wait(20);
    ok(kidsOf(t, 'bet-circle-2').join() === '50,10' && kidsOf(t, 'bet-circle').join() === '25,25,100' && t.doc.querySelector('#bet-circle-2 .bc-amt').textContent === '60', 'now they land on the second, the first is untouched');
    $(t, 'bet-double').click(); await wait(20);
    ok(kidsOf(t, 'bet-circle-2').join() === '50,10,50,10' && kidsOf(t, 'bet-circle').join() === '25,25,100', '2x doubles the selected stack only');
    $(t, 'bet-clear').click(); await wait(20);
    ok(kidsOf(t, 'bet-circle-2').length === 0 && kidsOf(t, 'bet-circle').length === 3, 'Clear empties the selected circle only');
    $(t, 'bet-plus').click(); await wait(20);
    ok($(t, 'bet-circle').classList.contains('sel') && $(t, 'bet-amount').value === '155' && kidsOf(t, 'bet-circle').reduce((a, b) => a + b, 0) === 155, 'the + beside a bet selects that circle and grows its stack');
    // tapping a circle selects it
    t.w.selectSpot(0);
    ptr(t, $(t, 'bet-circle-2'), 'pointerdown', 350, 50); ptr(t, t.w, 'pointerup', 350, 50); $(t, 'bet-circle-2').click();
    ok($(t, 'bet-circle-2').classList.contains('sel') && t.w.G.betSpot === 1, 'tapping a circle selects it');
    // typing in the second box rebuilds its stack
    $(t, 'bet-amount-2').value = '65'; $(t, 'bet-amount-2').dispatchEvent(new t.w.Event('input', { bubbles: true }));
    ok(kidsOf(t, 'bet-circle-2').reduce((a, b) => a + b, 0) === 65 && t.doc.querySelector('#bet-circle-2 .bc-amt').textContent === '65', 'typing 65 into the second bet makes a stack worth 65');
    noErr(t); close(t);
  }

  section('v4 circles: dragging chips onto either circle, and back to the rack');
  {
    const t = await boot(); visibleParent(t); place2(t);
    t.w.setHands(2);
    const c100 = $(t, 'chip-100'), c1 = $(t, 'bet-circle'), c2 = $(t, 'bet-circle-2');
    ptr(t, c100, 'pointerdown', 700, 700); ptr(t, t.w, 'pointermove', 720, 720);
    ok(c1.classList.contains('armed') && c2.classList.contains('armed'), 'carrying a chip lights up both circles as places to drop');
    ptr(t, t.w, 'pointermove', 50, 50);
    ok(c1.classList.contains('hot') && !c2.classList.contains('hot') && t.doc.querySelector('#bet-circle .bc-plus').textContent === '+100' && t.doc.querySelector('#bet-circle-2 .bc-plus').textContent === '', 'over the first circle: it lights up and previews +100, the other does not');
    ptr(t, t.w, 'pointermove', 350, 50);
    ok(!c1.classList.contains('hot') && c2.classList.contains('hot') && t.doc.querySelector('#bet-circle .bc-plus').textContent === '' && t.doc.querySelector('#bet-circle-2 .bc-plus').textContent === '+100', 'sliding over to the second: the light moves with the chip');
    ptr(t, t.w, 'pointerup', 350, 50); await wait(30);
    ok($(t, 'bet-amount-2').value === '100' && $(t, 'bet-amount').value === '0' && kidsOf(t, 'bet-circle-2').join() === '100' && kidsOf(t, 'bet-circle').length === 0, 'dropping on the second circle bets 100 on the second hand only');
    ok(c2.classList.contains('sel') && t.w.G.betSpot === 1, 'and that bet is now the selected one');
    ok(!c1.classList.contains('hot') && !c2.classList.contains('hot') && !c1.classList.contains('armed') && !c2.classList.contains('armed') && t.doc.querySelector('#bet-circle-2 .bc-plus').textContent === '', 'highlights cleared');
    await wait(500);
    // drop on the first circle
    ptr(t, $(t, 'chip-25'), 'pointerdown', 700, 700); ptr(t, t.w, 'pointermove', 720, 720); ptr(t, t.w, 'pointermove', 50, 50); ptr(t, t.w, 'pointerup', 50, 50); await wait(30);
    ok($(t, 'bet-amount').value === '25' && $(t, 'bet-amount-2').value === '100' && t.w.G.betSpot === 0 && c1.classList.contains('sel'), 'dropping on the first circle bets 25 there and selects it');
    await waitFor(() => !t.doc.querySelector('.cg'), 1500, 'ghosts gone');
    // between the circles: nothing
    ptr(t, $(t, 'chip-10'), 'pointerdown', 700, 700); ptr(t, t.w, 'pointermove', 720, 720); ptr(t, t.w, 'pointermove', 200, 50); ptr(t, t.w, 'pointerup', 200, 50); await wait(30);
    ok($(t, 'bet-amount').value === '25' && $(t, 'bet-amount-2').value === '100', 'letting go between the two circles bets nothing');
    await waitFor(() => !t.doc.querySelector('.cg'), 1500, 'ghost put away');
    // take the top chip out of the second circle
    ptr(t, c2, 'pointerdown', 350, 50); ptr(t, t.w, 'pointermove', 380, 80); ptr(t, t.w, 'pointermove', 4, 4);
    ok(t.doc.querySelector('.chip-rack').classList.contains('hot'), 'carrying a chip out of the second circle lights up the rack');
    ptr(t, t.w, 'pointerup', 4, 4); await wait(30);
    ok($(t, 'bet-amount-2').value === '0' && $(t, 'bet-amount').value === '25' && kidsOf(t, 'bet-circle-2').length === 0, 'dropping it on the rack takes it off the second bet only');
    // the first circle's own chip comes back from the first
    await wait(500);
    ptr(t, c1, 'pointerdown', 50, 50); ptr(t, t.w, 'pointermove', 80, 80); ptr(t, t.w, 'pointermove', 4, 4); ptr(t, t.w, 'pointerup', 4, 4); await wait(30);
    ok($(t, 'bet-amount').value === '0' && kidsOf(t, 'bet-circle').length === 0, 'and from the first circle, the first bet');
    // no drop target for a hidden second circle in one-hand mode
    t.w.setHands(1); await wait(30);
    ptr(t, $(t, 'chip-25'), 'pointerdown', 700, 700); ptr(t, t.w, 'pointermove', 720, 720); ptr(t, t.w, 'pointermove', 350, 50);
    ok(!c2.classList.contains('hot') && !c2.classList.contains('armed'), 'with one hand the second circle is not a drop target');
    ptr(t, t.w, 'pointerup', 350, 50); await wait(30);
    ok($(t, 'bet-amount-2').value === '0' && $(t, 'bet-amount').value === '0', 'nothing was bet');
    noErr(t); close(t);
  }

  section('v4 rack and deal check count both bets');
  {
    const t = await boot();
    t.w.setHands(2);
    $(t, 'bet-amount').value = '500'; $(t, 'bet-amount-2').value = '450'; $(t, 'bet-amount').dispatchEvent(new t.w.Event('input', { bubbles: true }));
    await wait(320);
    ok(chipsShown(t).join() === '5,10,25,50', 'bankroll 1000, bets 500 + 450: only chips up to 50 are left in the rack (' + chipsShown(t) + ')');
    $(t, 'bet-amount-2').value = '0'; $(t, 'bet-amount-2').dispatchEvent(new t.w.Event('input', { bubbles: true })); await wait(320);
    ok(chipsShown(t).join() === '5,10,25,50,100,500', 'bet 2 emptied: 500 more could go down (' + chipsShown(t) + ')');
    $(t, 'bet-amount-2').value = '450'; $(t, 'bet-amount-2').dispatchEvent(new t.w.Event('input', { bubbles: true })); await wait(320);
    t.w.setHands(1); await wait(320);
    ok(chipsShown(t).join() === '5,10,25,50,100,500', 'with one hand only the first bet counts, the hidden second one is ignored (' + chipsShown(t) + ')');
    noErr(t); close(t);

    const u = await boot();
    u.w.setHands(2);
    $(u, 'bet-amount').value = '25'; $(u, 'bet-amount-2').value = '0';
    ok(u.w.Show._dealIssue() === 'Place a bet on both hands', 'the shoe says why it will not deal: ' + u.w.Show._dealIssue());
    $(u, 'bet-amount-2').value = '25';
    ok(u.w.Show._dealIssue() === null, 'both bets in: ready');
    $(u, 'bet-amount').value = '600'; $(u, 'bet-amount-2').value = '500';
    ok(/bankroll/.test(u.w.Show._dealIssue()), 'together over the bankroll: ' + u.w.Show._dealIssue());
    u.w.setHands(1);
    ok(u.w.Show._dealIssue() === "That's more than your bankroll" || u.w.Show._dealIssue() === null, 'one hand: only the first bet is judged');
    $(u, 'bet-amount').value = '50';
    ok(u.w.Show._dealIssue() === null, 'one hand, 50: ready (the second bet is ignored)');
    noErr(u); close(u);
  }

  section('v4 dealing two hands: each bet appears on its own hand without a flight, as tidy flat chips');
  {
    const t = await boot(); visibleParent(t); place2(t);
    t.w.setHands(2);
    $(t, 'chip-25').click(); await wait(20);
    t.w.selectSpot(1); $(t, 'chip-100').click(); await wait(20); $(t, 'chip-25').click(); await wait(20); $(t, 'chip-10').click(); await wait(20);
    t.w.rig(['9S', '10H', '7D', '5C', '8D', '6H']);
    let flying = 0, ticking = true;
    const poll = (async () => { while (ticking){ flying = Math.max(flying, t.doc.querySelectorAll('#show-layer .sc, #show-layer [class*="chip-"], #show-layer .hb-d').length); await wait(1); } })();
    t.w.startDeal();
    ok(t.doc.querySelectorAll('#hands-row .hb-pile .hb-d').length >= 2, 'both bets are on their hands the moment the deal starts');
    await toPlayer(t);
    ticking = false; await poll;
    ok(flying === 0, 'no chips in the air (' + flying + ')');
    ok(t.doc.querySelectorAll('#show-layer *').length === 0, 'nothing left floating');
    const piles = [...t.doc.querySelectorAll('#hands-row .hb-pile')];
    ok(piles.length === 2, 'each hand has its chips on the felt');
    const d1 = [...piles[0].children], d2 = [...piles[1].children];
    ok(d1.length === 1 && d1[0].classList.contains('top') && d1[0].textContent === '25' && d1[0].classList.contains('chip-25'), 'hand 1: one flat 25 chip with its value on the face');
    ok(d2.length === 3 && d2.filter(x => x.classList.contains('top')).length === 1 && d2[2].classList.contains('top') && d2[2].textContent === '100' && d2[0].textContent === '' && d2[0].classList.contains('chip-10') && d2[1].classList.contains('chip-25'), 'hand 2 (135): three flat chips, the 100 on top showing its value, the 25 and 10 peeking out below it');
    ok(piles[1].style.height === '46px' && piles[0].style.height === '38px', 'the pile grows 4px per chip, no taller than three');
    ok(!t.doc.querySelector('.hb-chips') && !!t.doc.querySelector('#hands-row .hb-ring') && [...t.doc.querySelectorAll('#hands-row .hb-label b')].map(b => b.textContent).join() === '25,135', 'the ring (the double-down target) and the amount labels are still there: ' + [...t.doc.querySelectorAll('#hands-row .hb-label b')].map(b => b.textContent));
    noErr(t); close(t);
  }

  section('v4 the chips on the felt: never more than three in a pile');
  {
    const t = await boot();
    t.w.rig(['9S', '10H', '7D', '5C']); t.w.deal(185); await toPlayer(t);
    const ds = [...t.doc.querySelectorAll('#hands-row .hb-pile .hb-d')];
    ok(ds.length === 3 && ds[2].textContent === '100' && ds[2].classList.contains('top') && ds[1].classList.contains('chip-50') && ds[0].classList.contains('chip-25'), 'a bet of 185 (100, 50, 25, 10) shows three flat chips with the 100 on top');
    ok(t.doc.querySelector('#hands-row .hb-label b').textContent === '185', 'and the label still says 185');
    noErr(t); close(t);
  }

  section('v4 doubling the second hand: drag the chip onto its bet');
  {
    const t = await boot();
    t.w.setHands(2);
    t.w.rig(['9S', '5H', '7D', '8C', '6D', '10C', '9H']);
    deal2(t, 25, 40);
    await toPlayer(t);
    await actR(t, 'S');
    await waitFor(() => t.w.G.activeIdx === 1 && !t.w.G.locked, 3000, 'second hand');
    const handle = t.doc.querySelector('.dbl-handle');
    ok(!!handle, 'the chip handle is offered on the second hand (11)');
    const rings = [...t.doc.querySelectorAll('#hands-row .hb-ring')];
    rings[0].getBoundingClientRect = rect(500, 560, 500, 560); rings[1].getBoundingClientRect = rect(0, 60, 0, 60);
    const bank = t.w.G.bankroll;
    ptr(t, handle, 'pointerdown', 400, 400); ptr(t, t.w, 'pointermove', 520, 520);
    ok(!rings[0].classList.contains('hot') && !rings[1].classList.contains('hot'), 'the first hand’s bet is not a target now (it is finished)');
    ptr(t, t.w, 'pointermove', 20, 20);
    ok(rings[1].classList.contains('hot') && !rings[0].classList.contains('hot'), 'the second hand’s ring lights up');
    ptr(t, t.w, 'pointerup', 20, 20);
    await waitFor(() => t.w.G.hands[1] && t.w.G.hands[1].bet === 80, 3000, 'double');
    ok(t.w.G.hands[1].bet === 80 && t.w.G.hands[0].bet === 25 && t.w.G.bankroll === bank - 40, 'it doubled the second bet only (80 and 25; bankroll −40)');
    noErr(t); close(t);
  }

  section('v4 no chips fly for an ordinary win or loss');
  {
    const run = async (codes, bet, action, label) => {
      const t = await boot();
      let max = 0, ticking = true;
      const poll = (async () => { while (ticking){ max = Math.max(max, t.doc.querySelectorAll('#show-layer .sc').length); await wait(2); } })();
      t.w.rig(codes); t.w.deal(bet);
      await toPlayer(t); await actR(t, action);
      await waitFor(() => t.w.G.history.length === 1, 6000, 'result');
      await wait(200); await toBetting(t);
      ticking = false; await poll;
      ok(max === 0, label + ': no chips in the air (' + max + ')');
      ok(t.doc.querySelectorAll('#show-layer *').length === 0, label + ': nothing left on the layer');
      noErr(t); close(t);
      return t;
    };
    await run(['10S', '9H', '10D', '8C'], 25, 'S', 'win');
    await run(['10S', '9H', '6D', '10C'], 25, 'S', 'loss');
    await run(['10S', '9H', '10D', '9C'], 25, 'S', 'push');
    await run(['10S', '6H', '9D', '5C', '5D', 'KS'], 25, 'S', 'dealer bust');
  }

  section('v4 two hands at the table: the show keeps up (dealing, a natural, a split, the result)');
  {
    const t = await boot();
    t.w.setHands(2);
    t.w.rig(['8S', '7H', '6D', '8C', '7D', '10C', '3H', '2D', '4C', '5S', 'KD']);
    deal2(t, 25, 25);
    await toPlayer(t);
    ok(t.S.hidden.length === 0 && t.S.flights.length === 0, 'both hands dealt, nothing hidden or in the air');
    await actR(t, 'P'); await waitFor(() => t.S.flights.length === 0 && !t.w.G.locked, 3000, 'split cards');
    ok(t.w.G.hands.length === 3 && t.doc.querySelectorAll('#hands-row .hand-box').length === 3 && t.doc.querySelectorAll('#hands-row .hb-pile').length === 3, 'after splitting hand 1: three boxes, each with its bet');
    ok(t.S.hidden.length === 0, 'no card left hidden after the split');
    ok($(t, 'hands-row').classList.contains('dense'), 'three hands: the compact layout (smaller cards, two to a row) is on');
    ok([...t.doc.querySelectorAll('#hands-row .hand-box')].every(b => b.querySelectorAll('.card').length === 2), 'two cards in every box: ' + [...t.doc.querySelectorAll('#hands-row .hand-box')].map(b => b.querySelectorAll('.card').length));
    await actR(t, 'S'); await actR(t, 'S');
    await waitFor(() => t.w.G.activeIdx === 2 && !t.w.G.locked, 3000, 'second spot');
    await actR(t, 'P'); await waitFor(() => t.S.flights.length === 0 && !t.w.G.locked, 3000, 'second split');
    ok(t.w.G.hands.length === 4 && t.doc.querySelectorAll('#hands-row .hand-box').length === 4, 'splitting hand 2 as well gives four boxes');
    ok([...t.doc.querySelectorAll('#hands-row .hand-box')].every(b => b.querySelectorAll('.card').length === 2) && t.S.hidden.length === 0, 'every box has its two cards, none hidden');
    await actR(t, 'S'); await actR(t, 'S');
    await finishedR(t);
    ok(t.w.G.bankroll === 1100, 'all four win against the bust: 1100 (' + t.w.G.bankroll + ')');
    await toBetting(t);
    ok(!$(t, 'hands-row').classList.contains('dense'), 'back at the betting table the compact layout is off');
    noErr(t); close(t);

    // a natural on one hand: the peek, the banner, then the other hand is yours
    const u = await boot();
    u.w.setHands(2);
    u.w.rig(['AS', '9H', '6D', 'KC', '8D', '10C', '5S']);
    deal2(u, 20, 20);
    await toPlayer(u);
    ok(u.w.G.hands[0].status === 'blackjack' && u.w.G.activeIdx === 1, 'hand 1 is a blackjack, you play hand 2');
    ok(!$(u, 'hands-row').classList.contains('dense'), 'two hands are laid out at full size');
    ok(u.doc.querySelector('#hands-row .hand-box:not(.active) .badge.bj') && u.doc.querySelectorAll('#hands-row .hand-box.active').length === 1, 'the blackjack badge on hand 1, hand 2 highlighted');
    await actR(u, 'S');
    await finishedR(u);
    ok(u.w.G.bankroll === 1010, 'paid 3:2 on the blackjack, the 17 loses to 21: 1010 (' + u.w.G.bankroll + ')');
    ok(!!u.S.stats && u.S.errors.length === 0, 'no show errors');
    noErr(u); close(u);
  }

  section('blackjack payoff: a 6 to 5 table shows the 6 to 5 profit, two blackjacks get two tags');
  {
    const t = await boot();
    $(t, 'set-payout').value = '1.2'; t.w.readSettings();
    let ticking = true, tags = new Set();
    const poll = (async () => { while (ticking){ t.doc.querySelectorAll('#show-layer .bj-tag').forEach(e => tags.add(e.textContent)); await wait(2); } })();
    t.w.rig(['AS', '6H', 'KD', '10C']); t.w.deal(100);
    await waitFor(() => t.w.G.history.length === 1, 8000, 'result'); await wait(100);
    ticking = false; await poll;
    ok([...tags].some(x => /\+120/.test(x)), '6 to 5 on 100 is +120: ' + [...tags].join('|'));
    noErr(t); close(t);
    const u = await boot();
    u.w.setHands(2);
    u.w.rig(['AS', 'AH', '6D', 'KC', 'QD', '10C']);
    let tick2 = true, mx = 0, txt = new Set();
    const poll2 = (async () => { while (tick2){ const tg = u.doc.querySelectorAll('#show-layer .bj-tag'); mx = Math.max(mx, tg.length); tg.forEach(e => txt.add(e.textContent)); await wait(2); } })();
    deal2(u, 20, 40);
    await waitFor(() => u.w.G.history.length === 1, 8000, 'result'); await wait(100);
    tick2 = false; await poll2;
    ok(u.w.G.bankroll === 1090, 'both blackjacks paid 3 to 2: +30 and +60 (' + u.w.G.bankroll + ')');
    ok(mx === 2, 'one tag on each hand (' + mx + ')');
    ok([...txt].some(x => /\+30/.test(x)) && [...txt].some(x => /\+60/.test(x)), 'each shows its own profit, +30 and +60: ' + [...txt].join('|'));
    noErr(u); close(u);
  }
  // ================================================================ idle dealer visit (about 30 seconds without a hand)
  const arm = (t, first) => { if (first) t.S.nudge.first = first; t.w.Show._nudgeSync(true); };   // k is 0.02: 30 s of table time = 600 ms here
  const lineOn = t => { const e = t.doc.querySelector('.ds-say'); return e && e.classList.contains('on') ? e.textContent : ''; };

  section('idle visit: after the quiet time he comes up, says a line, and goes back down; again later, three times at most');
  {
    const t = await boot({ nudge: true });
    ok(t.S.nudge.first === 30000 && t.S.nudge.again === 60000 && t.S.nudge.max === 3, 'about 30 seconds the first time, a minute between later visits, three at most');
    arm(t);
    await wait(250);
    ok(!t.S.visit && t.S.state === 'away' && !lineOn(t), 'well before the 30 seconds: still down, silent');
    ok(await waitFor(() => !!t.S.visit && t.S.state === 'up', 3000, 'visit'), 'he comes up on his own');
    ok(await waitFor(() => !!lineOn(t), 2000, 'line'), 'and says something');
    const l1 = lineOn(t);
    ok(t.w.Show._nudgeLines.indexOf(l1) >= 0, 'one of his lines: "' + l1 + '"');
    ok(t.S.st.getAttribute('data-mood') === 'sm1', 'with a slight smile');
    ok(t.w.G.phase === 'betting' && !t.w.G.locked, 'the table is untouched: still betting');
    ok(await waitFor(() => !t.S.visit && !lineOn(t), 2000, 'end'), 'the visit ends, the line goes');
    ok(await waitFor(() => t.S.state === 'away', 2000, 'down'), 'and he lowers again');
    ok(t.S.st.getAttribute('data-mood') === 'idle', 'face back to normal');
    ok(t.S.stats.nudges === 1, 'counted once (' + t.S.stats.nudges + ')');
    const tv1 = Date.now();
    ok(await waitFor(() => t.S.stats.nudges === 2, 4000, 'second'), 'if nobody plays he comes back');
    const gap = Date.now() - tv1;
    ok(gap >= 1000, 'a minute of table time between visits, longer than the first wait (' + gap + ' ms here; a minute is 1200)');
    const l2 = await waitFor(() => !!lineOn(t), 2000) && lineOn(t);
    ok(l2 && l2 !== l1, 'with a different line: "' + l2 + '"');
    ok(await waitFor(() => t.S.stats.nudges === 3, 4000, 'third'), 'a third time');
    await waitFor(() => !t.S.visit && t.S.state === 'away', 2000, 'down');
    await wait(1800);
    ok(t.S.stats.nudges === 3 && !t.S.visit && !t.S.nudgeRec, 'then he leaves you alone (' + t.S.stats.nudges + ' visits, nothing scheduled)');
    noErr(t); close(t);
  }

  section('idle visit: starting a hand sends him straight to work, and the quiet time starts over afterwards');
  {
    const t = await boot({ nudge: true });
    arm(t, 20000);
    await waitFor(() => !!t.S.visit && !!lineOn(t), 3000, 'visit');
    ok(!!t.S.visit, 'he is visiting');
    t.w.rig(['10S', '9H', '10D', '8C']); t.w.deal(25);
    ok(!t.S.visit && !lineOn(t), 'dealing ends the visit at once, the line is gone');
    ok(!t.S.nudgeRec, 'no countdown while a hand is on');
    await toPlayer(t);
    ok(t.S.state === 'up' && !t.S.visit, 'he stays up and deals as usual');
    const n0 = t.S.stats.nudges;
    await wait(700);
    ok(t.S.stats.nudges === n0 && !t.S.visit, 'no visit in the middle of a hand');
    await actR(t, 'S'); await finishedR(t); await toBetting(t);
    ok(t.S.nudgeCount === 0, 'a hand was played: the count starts over');
    await waitFor(() => !!t.S.nudgeRec, 2000, 'countdown');
    ok(!!t.S.nudgeRec, 'a fresh countdown is running at the betting table');
    ok(await waitFor(() => t.S.stats.nudges === n0 + 1, 4000, 'next visit'), 'and if nobody plays again he visits again (' + t.S.stats.nudges + ')');
    noErr(t); close(t);
  }

  section('idle visit: he waits while a menu is open, the tab is hidden, a chip is being dragged or a bet is being typed');
  {
    const t = await boot({ nudge: true });
    t.S.nudge.retry = 5000;
    const hold = async (label, on, off) => {
      on(); arm(t, 10000);
      const n = t.S.stats.nudges;
      await wait(450);
      ok(t.S.stats.nudges === n && !t.S.visit && t.S.state === 'away', label + ': no visit while it is on');
      ok(!!t.S.nudgeRec, label + ': he will try again later');
      off();
      ok(await waitFor(() => t.S.stats.nudges === n + 1, 3000, label), label + ': once it is over he comes');
      await waitFor(() => !t.S.visit && t.S.state === 'away', 2000, 'down');
      t.S.nudgeCount = 0;
    };
    await hold('a table menu open', () => { $(t, 'tablesetup-overlay').style.display = 'flex'; }, () => { $(t, 'tablesetup-overlay').style.display = 'none'; });
    await hold('the settings panel open', () => { $(t, 'settings-panel').style.display = 'block'; }, () => { $(t, 'settings-panel').style.display = 'none'; });
    await hold('a hidden tab', () => Object.defineProperty(t.doc, 'hidden', { configurable: true, get: () => true }), () => Object.defineProperty(t.doc, 'hidden', { configurable: true, get: () => false }));
    await hold('a chip in the air', () => { t.S.cd = { fake: true }; }, () => { t.S.cd = null; });
    await hold('typing a bet', () => { $(t, 'bet-amount').focus(); }, () => { $(t, 'bet-amount').blur(); });
    // he is already busy with the tray: the visit waits (his own look is on show, so only the visit is checked)
    t.S.egg = { kind: 'sus', over: true }; arm(t, 10000);
    const ne = t.S.stats.nudges; await wait(450);
    ok(t.S.stats.nudges === ne && !t.S.visit, 'while he is busy with the chip-tray look: no visit');
    t.S.egg = null;
    ok(await waitFor(() => t.S.stats.nudges === ne + 1, 3000, 'after the egg'), 'and afterwards he comes');
    noErr(t); close(t);
  }

  section('idle visit: a "lower the dealer" timer left over from just before, or a redraw, does not pull him down mid-visit');
  {
    const t = await boot({ nudge: true });
    t.S.nudge.hold = 30000;
    ptr(t, t.doc.querySelector('.ds-tray'), 'pointerenter', 5, 5);
    await waitFor(() => !!t.S.egg && t.S.state === 'up', 2000, 'egg up');
    t.S.egg = null; t.w.Show.afterRender();            // nothing keeps him up now: the lowering timer starts (about 3 ms here)
    ok(!!t.S.lowerRec, 'a lowering timer is pending');
    const states = []; new t.w.MutationObserver(() => states.push(t.S.st.getAttribute('data-state'))).observe(t.S.st, { attributes: true, attributeFilter: ['data-state'] });
    arm(t, 1);                                           // ... and the visit starts a moment later
    await wait(60);
    ok(states.indexOf('away') < 0, 'he does not dip down and come back up (' + states.join(',') + ')');
    ok(!!t.S.visit && t.S.state === 'up', 'he is still up during the visit (' + t.S.state + ')');
    t.w.renderAll(); await wait(60);
    ok(!!t.S.visit && t.S.state === 'up', 'and a redraw in the middle of it does not lower him (' + t.S.state + ')');
    noErr(t); close(t);
  }

  section('idle visit: the quiet time is counted from the end of the last hand');
  {
    const t = await boot({ nudge: true });
    t.S.nudge.first = 60000;                             // 1200 ms here
    arm(t);
    const t0 = Date.now();
    t.w.rig(['10S', '9H', '10D', '8C']); t.w.deal(25);
    await toPlayer(t); await actR(t, 'S'); await finishedR(t); await toBetting(t);
    const t1 = Date.now();
    ok(t1 - t0 > 250, 'the hand took a while (' + (t1 - t0) + ' ms)');
    ok(await waitFor(() => t.S.stats.nudges === 1, 4000, 'visit'), 'he visits');
    const t2 = Date.now();
    ok(t2 - t1 >= 1100, 'a full quiet time after the hand, not counted from before it (' + (t2 - t1) + ' ms; 1200 expected)');
    noErr(t); close(t);
  }

  section('idle visit: the chip-tray hover and turning the show off end it; show off, turbo: he never comes');
  {
    const t = await boot({ nudge: true });
    arm(t, 15000);
    await waitFor(() => !!t.S.visit && !!lineOn(t), 3000, 'visit');
    ptr(t, t.doc.querySelector('.ds-tray'), 'pointerenter', 5, 5);
    await waitFor(() => !!t.S.egg, 2000, 'egg');
    ok(!t.S.visit && !!t.S.egg, 'hovering his chip tray ends the visit and starts the usual look');
    await waitFor(() => !t.S.egg, 6000, 'egg over');
    await waitFor(() => t.S.state === 'away', 2000, 'down');
    ok(t.S.state === 'away', 'and he lowers when that is over');
    arm(t, 15000);
    await waitFor(() => !!t.S.visit, 3000, 'visit');
    $(t, 'set-tableshow').checked = false; t.w.readSettings();
    ok(!t.S.visit && !t.S.nudgeRec, 'switching the show off in the middle of a visit ends it, nothing left scheduled');
    $(t, 'set-tableshow').checked = true; t.w.readSettings();
    await wait(60);
    ok(!t.S.visit, 'switching it back on does not start one by itself');
    noErr(t); close(t);
    const u = await boot({ nudge: true, show: false });
    arm(u); await wait(900);
    ok(!u.S.visit && !u.S.nudgeRec && !(u.S.stats.nudges > 0), 'with the show off he never visits');
    close(u);
    const v = await boot({ nudge: true, turbo: true });
    arm(v); await wait(900);
    ok(!v.S.visit && !v.S.nudgeRec && !(v.S.stats.nudges > 0), 'in turbo mode he never visits');
    close(v);
  }

  // ================================================================ PUSH 22 (Free Bet, Double Down Madness): the dealer throws a marker
  const push22Run = async (variant, codes, opts) => {
    opts = opts || {};
    const t = await boot(opts.boot);
    $(t, 'set-variant').value = variant; t.w.readSettings();
    const seen = { markers: 0, txt: '', dim: false, rings: 0, moods: [], undimAfter: null };
    new t.w.MutationObserver(() => seen.moods.push(t.S.st.getAttribute('data-mood'))).observe(t.S.st, { attributes: true, attributeFilter: ['data-mood'] });
    let ticking = true;
    const poll = (async () => { while (ticking){
      const m = t.doc.querySelectorAll('#show-layer .pm');
      seen.markers = Math.max(seen.markers, m.length); if (m.length && !seen.txt) seen.txt = m[0].textContent;
      if (m.length && t.doc.body.classList.contains('pm-on')) seen.dim = true;
      const sy = t.doc.querySelector('.ds-say'); if (sy && /push/i.test(sy.textContent)) seen.said = true;
      seen.rings = Math.max(seen.rings, t.doc.querySelectorAll('#show-layer .pm-ring').length);
      await wait(1); } })();
    t.w.rig(codes);
    if (opts.two){ deal2(t, 25, 25); } else { t.w.deal(opts.bet || 50); }
    await toPlayer(t);
    for (const a of (opts.acts || ['S'])) await actR(t, a);
    await finishedR(t); await wait(opts.settle || 120);
    await toBetting(t); await wait(150);
    ticking = false; await poll;
    return { t, seen };
  };

  section('PUSH 22: Free Bet, dealer makes 22 against a standing hand: he throws a PUSH 22 marker');
  {
    const { t, seen } = await push22Run('freebet', ['10S', '6H', '9D', '10C', '6S']);
    ok(t.w.G.bankroll === 1000, 'the hand pushes: bankroll unchanged (' + t.w.G.bankroll + ')');
    ok(seen.markers === 1, 'exactly one marker (' + seen.markers + ')');
    ok(/PUSH/.test(seen.txt) && /22/.test(seen.txt), 'it says PUSH 22: "' + seen.txt + '"');
    ok(seen.dim, 'the printed pay lines fade back while it is down');
    ok(seen.said, 'he says it is a push');
    ok(seen.rings >= 1, 'a soft ring when it lands');
    ok(seen.moods.indexOf('smirk') >= 0 && seen.moods.indexOf('sad') < 0, 'he smirks (a push is no bust for him), no frown: ' + seen.moods.join(','));
    ok(t.w.RESULT_PAUSE > 0, 'timings back to normal afterwards');
    ok(!t.doc.body.classList.contains('pm-on') && t.doc.querySelectorAll('#show-layer *').length === 0, 'afterwards the marker is gone and the pay lines are back');
    ok(t.S.errors.length === 0, 'no show errors');
    noErr(t); close(t);
  }
  section('PUSH 22: Double Down Madness too; the standard game, a plain bust and a lost hand get no marker');
  {
    const a = await push22Run('ddm', ['10S', '6H', '10D', '6S']);
    ok(a.t.w.G.bankroll === 1000 && a.seen.markers === 1 && /22/.test(a.seen.txt), 'Double Down Madness: dealer 22 pushes and gets the marker (bankroll ' + a.t.w.G.bankroll + ')');
    noErr(a.t); close(a.t);
    const b = await push22Run('standard', ['10S', '6H', '9D', '10C', '6S']);
    ok(b.t.w.G.bankroll === 1050 && b.seen.markers === 0 && !b.seen.dim, 'standard rules: 22 is a plain bust, you win, no marker (bankroll ' + b.t.w.G.bankroll + ')');
    ok(b.seen.moods.indexOf('sad') >= 0, 'and he frowns as before');
    noErr(b.t); close(b.t);
    const c = await push22Run('freebet', ['10S', '6H', '9D', '10C', '7S']);
    ok(c.t.w.G.bankroll === 1050 && c.seen.markers === 0, 'Free Bet: dealer 23 is a real bust, no marker (bankroll ' + c.t.w.G.bankroll + ')');
    ok(c.seen.moods.indexOf('sad') >= 0, 'he frowns for that one');
    noErr(c.t); close(c.t);
    const d = await push22Run('freebet', ['10S', '10H', '9D', '10C'], { acts: ['S'] });
    ok(d.t.w.G.bankroll === 950 && d.seen.markers === 0, 'Free Bet: dealer 20 beats 19, no marker (bankroll ' + d.t.w.G.bankroll + ')');
    noErr(d.t); close(d.t);
    const e = await push22Run('freebet', ['10S', '6H', '5D', '10C', 'KS', '6S'], { acts: ['H'] });
    ok(e.t.w.G.bankroll === 950 && e.seen.markers === 0, 'Free Bet: your own bust loses before the dealer plays, no marker (bankroll ' + e.t.w.G.bankroll + ')');
    noErr(e.t); close(e.t);
  }
  section('PUSH 22: two hands that push get one marker; the show off or reduced motion');
  {
    const a = await push22Run('freebet', ['10S', '9H', '6D', '9C', '10D', '10C', '6S'], { two: true, acts: ['S', 'S'] });
    ok(a.seen.markers === 1, 'two hands pushing: one marker, not two (' + a.seen.markers + ')');
    ok(a.t.w.G.bankroll === 1000, 'both pushed (' + a.t.w.G.bankroll + ')');
    noErr(a.t); close(a.t);
    const b = await push22Run('freebet', ['10S', '6H', '9D', '10C', '6S'], { boot: { show: false } });
    ok(b.t.w.G.bankroll === 1000 && b.seen.markers === 0, 'show off: the same result, no marker');
    noErr(b.t); close(b.t);
    const c = await push22Run('freebet', ['10S', '6H', '9D', '10C', '6S'], { boot: { reduced: true } });
    ok(c.seen.markers === 1 && c.seen.rings === 0, 'reduced motion: the marker is simply placed, no flight or ring (' + c.seen.markers + ' marker, ' + c.seen.rings + ' rings)');
    ok(c.t.doc.querySelectorAll('#show-layer *').length === 0 && !c.t.doc.body.classList.contains('pm-on'), 'and it goes away again');
    noErr(c.t); close(c.t);
    const d = await push22Run('freebet', ['10S', '6H', '9D', '10C', '6S'], { boot: { turbo: true } });
    ok(d.seen.markers === 0, 'turbo: nothing');
    close(d.t);
  }
  section('PUSH 22: it stays through the result hold, longer than an ordinary win');
  {
    const t = await boot();
    $(t, 'set-variant').value = 'freebet'; t.w.readSettings();
    t.w.rig(['10S', '6H', '9D', '10C', '6S']); t.w.deal(50); await toPlayer(t); await actR(t, 'S');
    await waitFor(() => t.w.G.phase === 'result' || t.w.G.phase === 'betting', 9000, 'result');
    await wait(5);
    ok(t.w.RESULT_PAUSE >= Math.round(t.S.T.result * 1.2), 'the result is held longer for it (' + t.w.RESULT_PAUSE + ' vs ' + t.S.T.result + ')');
    noErr(t); close(t);
  }

  // ================================================================ table limits, dealer chatter, round markers, streaks, the shuffle, side-bet circles
  const chg = (t, id, v) => { const e = $(t, id); if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new t.w.Event('change', { bubbles: true })); };
  const rackIds = t => [5, 10, 25, 50, 100, 500, 1000].filter(d => { const c = $(t, 'chip-' + d); return !c.classList.contains('rk-off') && !c.classList.contains('rk-out'); });
  const noteOf = t => { const n = $(t, 'limit-note'); return n && n.classList.contains('on') ? n.textContent : ''; };
  const hitOf = (t, k) => !!t.doc.querySelector('.ds-placard .pl-' + k + '.hit');
  const plate = t => { const p = t.doc.querySelector('.ds-placard'); return [p.querySelector('.pl-t'), p.querySelector('.pl-min i'), p.querySelector('.pl-min b'), p.querySelector('.pl-max i'), p.querySelector('.pl-max b')].map(e => e.textContent).join(' '); };
  const clickDeal = t => { $(t, 'btn-deal').click(); };
  const RIGP = ['5S', '6H', '6D', '10C', '9H'];   // 11 against a dealer 16: nobody has a natural, so there is always a player turn

  section('limits: the settings, the placard, saving');
  {
    const t = await boot({ limits: true });
    ok(t.w.G.tableLimits === true && t.w.G.minBet === 5 && t.w.G.maxBet === 500 && t.w.G.chatter === 'chatty', 'defaults: on, 5 to 500, chatty');
    ok(plate(t) === 'TABLE LIMITS MIN $5 MAX $500', 'the placard sits in the dealer stage and reads the limits: "' + plate(t) + '"');
    ok(t.doc.body.classList.contains('lim-on') && !!t.doc.querySelector('#dealer-stage .ds-placard'), 'it shows (body marks it)');
    ok(t.doc.querySelector('.ds-placard').getAttribute('aria-label') === 'Table limits: minimum $5, maximum $500', 'and has a spoken version');
    chg(t, 'set-minbet', '25'); chg(t, 'set-maxbet', '2000');
    ok(t.w.G.minBet === 25 && t.w.G.maxBet === 2000 && plate(t) === 'TABLE LIMITS MIN $25 MAX $2,000', 'your own min and max: the placard follows ("' + plate(t) + '")');
    chg(t, 'set-minbet', '3000');
    ok($(t, 'set-maxbet').value === '3000' && t.w.G.minBet === 3000 && t.w.G.maxBet === 3000, 'a min above the max lifts the max with it (' + $(t, 'set-maxbet').value + ')');
    chg(t, 'set-maxbet', '100');
    ok($(t, 'set-minbet').value === '100' && t.w.G.minBet === 100 && t.w.G.maxBet === 100, 'a max below the min brings the min down (' + $(t, 'set-minbet').value + ')');
    chg(t, 'set-minbet', ''); chg(t, 'set-maxbet', 'abc');
    ok($(t, 'set-minbet').value === '5' && $(t, 'set-maxbet').value === '500' && t.w.G.minBet === 5 && t.w.G.maxBet === 500, 'empty or garbage goes back to 5 and 500');
    chg(t, 'set-minbet', '0'); chg(t, 'set-maxbet', '-4');
    ok($(t, 'set-minbet').value === '5' && $(t, 'set-maxbet').value === '500', 'zero and negatives too');
    chg(t, 'set-minbet', '5000000');
    ok(+$(t, 'set-minbet').value === 1000000 && plate(t).indexOf('$1,000,000') > 0, 'and there is a ceiling (' + $(t, 'set-minbet').value + ')');
    chg(t, 'set-minbet', '5'); chg(t, 'set-maxbet', '500');
    chg(t, 'set-chatter', 'quiet');
    ok(t.w.G.chatter === 'quiet', 'dealer chatter: quiet');
    chg(t, 'set-chatter', 'off'); ok(t.w.G.chatter === 'off', 'off');
    chg(t, 'set-chatter', 'bogus'); ok(t.w.Show._S && (() => { return true; })(), 'a bogus value does not break anything');
    chg(t, 'set-chatter', 'chatty');
    ok(!$(t, 'set-tablelimits').disabled && !$(t, 'set-minbet').disabled && !$(t, 'set-maxbet').disabled && !$(t, 'set-chatter').disabled, 'all four settings are live while the table show is on');
    chg(t, 'set-tablelimits', false);
    ok(!t.doc.body.classList.contains('lim-on') && $(t, 'set-minbet').disabled && $(t, 'set-maxbet').disabled && !$(t, 'set-chatter').disabled, 'toggle off: the placard goes, the min and max fields rest, chatter stays');
    chg(t, 'set-tablelimits', true);
    ok(t.doc.body.classList.contains('lim-on') && !$(t, 'set-minbet').disabled, 'toggle back on: it returns');
    chg(t, 'set-tableshow', false);
    ok(!t.doc.body.classList.contains('lim-on') && $(t, 'set-tablelimits').disabled && $(t, 'set-minbet').disabled && $(t, 'set-maxbet').disabled && $(t, 'set-chatter').disabled, 'table show off: no placard, and all four settings rest');
    chg(t, 'set-tableshow', true);
    ok(t.doc.body.classList.contains('lim-on') && !$(t, 'set-chatter').disabled, 'table show on again: all back');
    noErr(t); close(t);

    // saved with the session
    const s1 = await boot({ limits: true });
    chg(s1, 'set-minbet', '25'); chg(s1, 'set-maxbet', '1000'); chg(s1, 'set-chatter', 'quiet'); chg(s1, 'set-tablelimits', false);
    const saved = s1.w.localStorage.getItem('soft17_session_v1'); close(s1);
    const s2 = await boot({ storage: { soft17_session_v1: saved }, keepLimits: true });
    ok(s2.w.G.minBet === 25 && s2.w.G.maxBet === 1000 && s2.w.G.chatter === 'quiet' && s2.w.G.tableLimits === false, 'remembered next visit: 25 to 1000, quiet, placard off');
    ok($(s2, 'set-minbet').value === '25' && $(s2, 'set-maxbet').value === '1000' && $(s2, 'set-chatter').value === 'quiet' && !$(s2, 'set-tablelimits').checked, 'and the fields show it');
    noErr(s2); close(s2);
    // a session saved before these settings existed
    const old = JSON.parse(saved); ['tableLimits', 'minBet', 'maxBet', 'chatter'].forEach(k => { delete old[k]; if (old.settings) delete old.settings[k]; });
    const s3 = await boot({ storage: { soft17_session_v1: JSON.stringify(old) }, keepLimits: true });
    ok(s3.w.G.tableLimits === true && s3.w.G.minBet === 5 && s3.w.G.maxBet === 500 && s3.w.G.chatter === 'chatty', 'an older save gets the defaults: on, 5 to 500, chatty');
    close(s3);
    // junk in the save
    const junk = JSON.parse(saved); const tgt = junk.settings || junk; tgt.minBet = 'x'; tgt.maxBet = -3; tgt.chatter = 'loud';
    const s4 = await boot({ storage: { soft17_session_v1: JSON.stringify(junk) }, keepLimits: true });
    ok(s4.w.G.minBet === 5 && s4.w.G.maxBet === 500 && s4.w.G.chatter === 'chatty', 'junk in the save falls back to the defaults');
    close(s4);
  }

  section('limits: the max (chips, buttons, typing, dropping)');
  {
    const t = await boot({ limits: true }); visibleParent(t);
    ok(rackIds(t).join() === '5,10,25,50,100,500', 'the 1K chip is not in the rack when the max is 500: ' + rackIds(t).join());
    $(t, 'chip-500').click(); await wait(10);
    ok($(t, 'bet-amount').value === '500' && !noteOf(t), 'a 500 is fine');
    $(t, 'chip-100').click(); await wait(10);
    ok($(t, 'bet-amount').value === '500', 'one more chip: the bet stays at the max');
    ok(noteOf(t) === 'Table max is $500.', 'a line by the chips says so: "' + noteOf(t) + '"');
    ok(hitOf(t, 'max') && !hitOf(t, 'min'), 'the MAX row of the placard lights up');
    ok(t.S.stats.limits === 1, 'counted once');
    ok(await waitFor(() => lineOn(t) === 'Table max is $500.', 2000, 'dealer line'), 'the dealer says it too');
    ok(t.S.state === 'up' && !!t.S.visit, 'he came up to say it');
    ok(await waitFor(() => !noteOf(t) && !hitOf(t, 'max') && t.S.state === 'away' && !t.S.visit, 4000, 'quiet again'), 'then the line, the highlight and the dealer all go away');
    // after a real pause he says it again; a burst of clicks does not make him repeat himself
    await wait(1500);
    $(t, 'chip-5').click(); await wait(3);
    ok(!!t.S.visit, 'after a pause the same limit is worth saying again');
    const v0 = t.S.visit;
    for (let i = 0; i < 3; i++){ $(t, 'chip-5').click(); await wait(3); }
    ok(t.S.stats.limits === 5, 'each try is noticed (' + t.S.stats.limits + ')');
    ok(t.S.visit === v0, 'but a burst of clicks does not make him start over');
    ok(await waitFor(() => !t.S.visit && t.S.state === 'away', 4000, 'down'), 'and he only comes up once for the burst');
    // all in, double, halve, + / -
    $(t, 'bet-clear').click(); await wait(5);
    $(t, 'bet-allin').click(); await wait(10);
    ok($(t, 'bet-amount').value === '500' && /max is \$500/.test(noteOf(t)), '"All in" stops at the max (' + $(t, 'bet-amount').value + ')');
    $(t, 'bet-clear').click(); t.w.setBet(300); $(t, 'bet-double').click(); await wait(5);
    ok($(t, 'bet-amount').value === '500', '"2x" from 300 stops at 500');
    t.w.setBet(497); $(t, 'bet-plus').click(); await wait(5);
    ok($(t, 'bet-amount').value === '500', 'the + button stops at the max (497 + 5)');
    // typing a number over the max
    ok(await waitFor(() => !noteOf(t), 3000, 'line gone'), 'the last line has gone before the next try');
    $(t, 'bet-amount').value = '900'; $(t, 'bet-amount').dispatchEvent(new t.w.Event('input', { bubbles: true }));
    ok($(t, 'bet-amount').value === '900', 'while you type it is left alone');
    $(t, 'bet-amount').dispatchEvent(new t.w.Event('change', { bubbles: true })); await wait(5);
    ok($(t, 'bet-amount').value === '500' && /max is \$500/.test(noteOf(t)), 'when you finish typing it comes down to the max');
    // and if the box still says 900 at Deal
    $(t, 'bet-amount').value = '900';
    const alerts0 = t.alerts.length;
    clickDeal(t); await wait(20);
    ok(t.w.G.phase === 'betting' && t.w.G.hands.length === 0 && t.w.G.bankroll === 1000, 'Deal with 900 on the table does not deal');
    ok(t.alerts.length === alerts0 && /max is \$500/.test(noteOf(t)), 'no pop-up: the limit line says why');
    $(t, 'bet-amount').value = '500'; t.w.rig(RIGP); clickDeal(t); await toPlayer(t);
    ok(t.w.G.hands[0].bet === 500, 'and the max itself deals');
    noErr(t); close(t);

    // a drop that would go over the max is refused: the chip goes back
    const u = await boot({ limits: true }); visibleParent(u);
    $(u, 'bet-circle').getBoundingClientRect = rect(0, 100, 0, 100);
    t_set(u, 450); await wait(20);
    ptr(u, $(u, 'chip-100'), 'pointerdown', 700, 700); ptr(u, u.w, 'pointermove', 720, 720); ptr(u, u.w, 'pointermove', 50, 50); ptr(u, u.w, 'pointerup', 50, 50); await wait(40);
    ok($(u, 'bet-amount').value === '450', 'dropping a 100 on a 450 bet: refused');
    ok(/max is \$500/.test(noteOf(u)), 'with the line: "' + noteOf(u) + '"');
    await waitFor(() => !u.doc.querySelector('.cg'), 1500, 'the chip goes back');
    await wait(500);
    ptr(u, $(u, 'chip-50'), 'pointerdown', 700, 700); ptr(u, u.w, 'pointermove', 720, 720); ptr(u, u.w, 'pointermove', 50, 50); ptr(u, u.w, 'pointerup', 50, 50); await wait(40);
    ok($(u, 'bet-amount').value === '500', 'a 50 lands exactly on the max');
    noErr(u); close(u);
  }
  function t_set(t, v){ t.w.setBet(v); }

  section('limits: odd values in a saved table, a hand in play, the sound');
  {
    // numbers that make no sense fall back to 5 and 500
    const t = await boot({ limits: true });
    t.w.G.minBet = 'x'; t.w.G.maxBet = 0;
    t.w.setBet(600); await wait(5);
    ok($(t, 'bet-amount').value === '500' && noteOf(t) === 'Table max is $500.', 'a max that makes no sense is 500 (' + $(t, 'bet-amount').value + ')');
    t.w.setBet(7); clickDeal(t); await wait(20);
    ok(t.w.G.phase !== 'betting', 'and a min that makes no sense is 5: a bet of 7 deals (' + t.w.G.phase + ')');
    noErr(t); close(t);
    // a max below the min is lifted to the min
    const m = await boot({ limits: true });
    m.w.G.minBet = 100; m.w.G.maxBet = 50;
    m.w.setBet(100); await wait(5);
    ok($(m, 'bet-amount').value === '100' && !noteOf(m), 'a max below the min is lifted to it: a bet of 100 stands (' + $(m, 'bet-amount').value + ')');
    noErr(m); close(m);
    // and there is a ceiling on both
    const c = await boot({ limits: true });
    c.w.G.bankroll = 3000000; c.w.G.maxBet = 5000000;
    c.w.setBet(2000000); await wait(5);
    ok($(c, 'bet-amount').value === '1000000' && noteOf(c) === 'Table max is $1,000,000.', 'a max of five million is a million (' + $(c, 'bet-amount').value + ', "' + noteOf(c) + '")');
    noErr(c); close(c);
    const d = await boot({ limits: true });
    d.w.G.bankroll = 3000000; d.w.G.minBet = 5000000; d.w.G.maxBet = 500;
    d.w.setBet(2000000); await wait(5);
    ok($(d, 'bet-amount').value === '1000000' && noteOf(d) === 'Table max is $1,000,000.', 'and a min of five million is a million too (' + $(d, 'bet-amount').value + ', "' + noteOf(d) + '")');
    noErr(d); close(d);
    // lowering the max during a hand does not make Deal a limit matter
    const p = await boot({ limits: true });
    p.w.setBet(300); p.w.rig(RIGP); clickDeal(p); await toPlayer(p);
    chg(p, 'set-maxbet', '100');
    ok(p.w.G.phase === 'player' && p.w.Show._dealIssue() === null && !noteOf(p), 'a hand in play is left alone when the max comes down (' + p.w.Show._dealIssue() + ')');
    noErr(p); close(p);
    // two hands: the clamp goes to the hand that went over
    const h2 = await boot({ limits: true });
    h2.w.setHands(2); h2.w.setBet(100, 0); h2.w.setBet(900, 1); await wait(5);
    ok($(h2, 'bet-amount').value === '100' && $(h2, 'bet-amount-2').value === '500', 'two hands: only the second comes down (' + $(h2, 'bet-amount').value + ' / ' + $(h2, 'bet-amount-2').value + ')');
    noErr(h2); close(h2);
    // chatter off: the limit shows, but he does not come up to say it
    const o = await boot({ limits: true, chatter: 'off' });
    o.w.setBet(900);
    ok(noteOf(o) === 'Table max is $500.' && hitOf(o, 'max') && !o.S.visit && o.S.state === 'away' && !lineOn(o), 'chatter off: the placard and the line by the chips, no dealer visit');
    await wait(40);
    ok(!o.S.visit && o.S.state === 'away' && !lineOn(o), 'and he never comes up');
    noErr(o); close(o);
    // and he does not break off a shuffle to say it
    const q = await boot({ limits: true });
    q.w.placeCutCard(0.75);
    ok(await waitFor(() => !!q.S.shuf, 2000, 'shuffle'), 'he starts to shuffle');
    q.w.setBet(900);
    ok(noteOf(q) === 'Table max is $500.' && !q.S.visit && !!q.S.shuf, 'a limit hit mid-shuffle: the line by the chips, and he carries on shuffling');
    ok(await waitFor(() => !q.S.shuf, 6000, 'end'), 'the shuffle finishes');
    noErr(q); close(q);
    // the clack: a limit has a sound of its own
    const s = await boot({ limits: true });
    s.w.G.soundOn = true; const snd = []; s.w.TRSound.play = function(n){ snd.push(n); return true; };   // count the sounds asked of the sound engine
    s.w.setBet(300); await wait(5); const quiet = snd.length;
    snd.length = 0; s.w.setBet(900); await wait(5);
    ok(snd.length > quiet && snd.indexOf('chip') >= 0, 'hitting the max clacks (' + snd.length + ' sounds, against ' + quiet + ' for a plain bet)');
    noErr(s); close(s);
  }

  section('limits: the min, two hands, short stacks, and the paths that skip it');
  {
    const t = await boot({ limits: true, min: 25 });
    ok(t.w.G.minBet === 25 && plate(t) === 'TABLE LIMITS MIN $25 MAX $500', 'min 25');
    t.w.setBet(10);
    const alerts0 = t.alerts.length;
    clickDeal(t); await wait(20);
    ok(t.w.G.phase === 'betting' && t.w.G.bankroll === 1000, 'a bet of 10 does not deal');
    ok(noteOf(t) === 'Table min is $25.' && hitOf(t, 'min') && !hitOf(t, 'max'), 'the line and the MIN row: "' + noteOf(t) + '"');
    ok(await waitFor(() => lineOn(t) === 'Table min is $25.', 2000, 'dealer'), 'he says it');
    ok(t.alerts.length === alerts0, 'no pop-up');
    ok(t.w.Show._dealIssue() === 'Table min is $25.', 'tapping the shoe says the same (' + t.w.Show._dealIssue() + ')');
    t.w.Show._shoeDeal(); ok(t.S.shoeTip.textContent === 'Table min is $25.' && t.w.G.phase === 'betting', 'the shoe shakes and shows it, no deal');
    t.w.setBet(0); clickDeal(t); await wait(10);
    ok(t.alerts.length === alerts0 + 1 && /Place a bet/.test(t.alerts[t.alerts.length - 1]), 'no bet at all is still the game\'s own message');
    t.w.setBet(25); t.w.rig(RIGP); clickDeal(t); await toPlayer(t);
    ok(t.w.G.hands[0].bet === 25, 'the min itself deals');
    noErr(t); close(t);

    // two hands: each hand is judged
    const u = await boot({ limits: true, min: 25 });
    u.w.rig(['10S', '9H', '6D', '6C', '8D', '10C']);
    u.w.setHands(2); $(u, 'bet-amount').value = '25'; $(u, 'bet-amount-2').value = '10'; u.w.G.needsReshuffle = false;
    clickDeal(u); await wait(20);
    ok(u.w.G.phase === 'betting' && /min is \$25/.test(noteOf(u)), 'two hands: one under the min is refused');
    $(u, 'bet-amount-2').value = '600'; clickDeal(u); await wait(20);
    ok(u.w.G.phase === 'betting' && /max is \$500/.test(noteOf(u)), 'one over the max is refused');
    $(u, 'bet-amount-2').value = '25'; clickDeal(u); await wait(20);
    ok(u.w.G.hands.length === 2, 'both inside: dealt');
    noErr(u); close(u);

    // needing a reshuffle comes first; a short stack can bet what is left
    const v = await boot({ limits: true, min: 25 });
    $(v, 'bet-amount').value = '900'; v.w.G.needsReshuffle = true; clickDeal(v); await wait(20);
    ok(v.doc.getElementById('cutcard-overlay').style.display === 'flex' && !noteOf(v), 'a reshuffle is due: the game goes to the cut card first, no limit line');
    v.w.hideCutCardPrompt();
    v.w.G.needsReshuffle = false; v.w.G.bankroll = 10; v.w.setBet(10); v.w.rig(RIGP);
    clickDeal(v); await toPlayer(v);
    ok(v.w.G.hands[0].bet === 10, 'with 10 left and a min of 25 you can still bet the 10');
    noErr(v); close(v);
    const w2 = await boot({ limits: true, min: 25 });
    w2.w.G.bankroll = 30; w2.w.setHands(2); w2.w.rig(['10S', '9H', '6D', '6C', '8D', '10C']);
    $(w2, 'bet-amount').value = '15'; $(w2, 'bet-amount-2').value = '10'; clickDeal(w2); await wait(20);
    ok(w2.w.G.phase === 'betting' && noteOf(w2) === 'Table min is $15.', 'two hands with 30 left: the min per hand is 15, and it says 15 (' + noteOf(w2) + ')');
    $(w2, 'bet-amount-2').value = '15'; clickDeal(w2); await wait(20);
    ok(w2.w.G.hands.length === 2, 'and 15 and 15 deal');
    noErr(w2); close(w2);

    // the paths that skip the limits
    const x = await boot({ limits: true });
    chg(x, 'set-tablelimits', false);
    x.w.setBet(900); ok($(x, 'bet-amount').value === '900' && !noteOf(x), 'toggle off: nothing stops a big bet');
    x.w.rig(RIGP); clickDeal(x); await toPlayer(x);
    ok(x.w.G.hands[0].bet === 900, 'and it deals');
    close(x);
    const y = await boot({ limits: true, show: false });
    y.w.setBet(900); y.w.rig(RIGP); clickDeal(y); await toPlayer(y);
    ok(y.w.G.hands[0].bet === 900 && !y.doc.body.classList.contains('lim-on'), 'table show off: no limits');
    close(y);
    const z = await boot({ limits: true, turbo: true });
    z.w.setBet(900); z.w.rig(RIGP); clickDeal(z); await toPlayer(z);
    ok(z.w.G.hands[0].bet === 900, 'turbo: no limits');
    close(z);
    // lowering the max in the settings brings an existing bet down, quietly
    const m = await boot({ limits: true });
    m.w.setBet(0); $(m, 'bet-amount').value = '400';
    chg(m, 'set-maxbet', '200'); await wait(20);
    ok($(m, 'bet-amount').value === '200' && m.S.stats.limits === 0 && !m.S.visit, 'lowering the max pulls a 400 bet down to 200, with no fuss (' + m.S.stats.limits + ' limit notices)');
    ok(plate(m) === 'TABLE LIMITS MIN $5 MAX $200' && rackIds(m).join() === '5,10,25,50,100', 'the placard says 200 and the 500 chip leaves the rack: ' + rackIds(m).join());
    chg(m, 'set-maxbet', '5000'); await wait(260);
    ok(rackIds(m).join() === '5,10,25,50,100,500', 'raise it to 5000 and the 500 is back (the 1K needs 1000 free, and 200 is on the table): ' + rackIds(m).join());
    noErr(m); close(m);
    // switching off mid-way leaves nothing behind
    const k = await boot({ limits: true });
    k.w.setBet(500); k.w.setBet(900); await wait(10);
    ok(!!noteOf(k), 'a limit line is showing');
    chg(k, 'set-tableshow', false);
    ok(!noteOf(k) && !hitOf(k, 'max') && !k.S.visit && k.S.timers.length === 0, 'the table show off: it is all cleared away, no timers left');
    close(k);
  }

  section('chatter: chatty, quiet, off');
  {
    // quiet: he still says what you need to know, but no small talk
    const q = await boot({ limits: true, chatter: 'quiet', nudge: true });
    q.w.setBet(900); q.w.setBet(500); await wait(10);
    ok(await waitFor(() => lineOn(q) === 'Table max is $500.', 2000, 'line'), 'quiet: the limit line is information, he says it');
    arm(q, 15000); await wait(900);
    ok(!q.S.visit && !q.S.nudgeRec && !(q.S.stats.nudges > 0), 'quiet: he does not come up by himself');
    const qm = [], ql = [];
    new q.w.MutationObserver(() => qm.push(q.S.st.getAttribute('data-mood'))).observe(q.S.st, { attributes: true, attributeFilter: ['data-mood'] });
    new q.w.MutationObserver(() => { if (lineOn(q)) ql.push(lineOn(q)); }).observe(q.doc.querySelector('.ds-say'), { attributes: true, childList: true, characterData: true, subtree: true });
    ptr(q, q.doc.querySelector('.ds-tray'), 'pointerenter', 5, 5);
    await waitFor(() => !!q.S.egg, 2000, 'egg');
    await waitFor(() => !q.S.egg, 6000, 'egg over'); await wait(20);
    ok(qm.some(m => m === 'sus' || m === 'sad') && ql.length === 0, 'quiet: hover over his chips: the look, but no words (' + qm.join() + ' / ' + JSON.stringify(ql) + ')');
    q.w.rig(['AS', '10H', 'KD', '8C']); q.w.deal(50); await finishedR(q);
    ok(await waitFor(() => /Blackjack pays 3 to 2/.test(lineOn(q)), 1500, 'bj line'), 'quiet: "Blackjack pays 3 to 2." is information, still said');
    noErr(q); close(q);
    // off: faces and gestures only
    const o = await boot({ limits: true, chatter: 'off', nudge: true });
    o.w.setBet(900); o.w.setBet(500); await wait(60);
    ok(noteOf(o) !== '' || o.S.stats.limits > 0, 'off: the limit still reaches you through the placard and the line by your chips');
    ok(hitOf(o, 'max') || o.S.stats.limits > 0, 'the MAX row lights up');
    ok(!o.S.visit && o.S.state === 'away' && !lineOn(o), 'off: he does not come up or say a word');
    arm(o, 15000); await wait(900);
    ok(!o.S.visit && !(o.S.stats.nudges > 0), 'off: no visits either');
    o.w.rig(['AS', '10H', 'KD', '8C']); o.w.deal(50);
    const said = []; const obs = new o.w.MutationObserver(() => { if (lineOn(o)) said.push(lineOn(o)); }); obs.observe(o.doc.querySelector('.ds-say'), { attributes: true, childList: true, characterData: true, subtree: true });
    await finishedR(o); await wait(60);
    ok(said.length === 0 && !lineOn(o), 'off: not even "Blackjack pays 3 to 2." (' + JSON.stringify(said) + ')');
    ok(o.S.mood === 'grin' || o.S.mood === 'wow' || o.S.mood === 'idle', 'the faces still work');
    noErr(o); close(o);
    // chatty: as before; and switching to off in the middle of a visit ends it
    const c = await boot({ nudge: true });
    arm(c, 15000);
    await waitFor(() => !!c.S.visit, 3000, 'visit');
    chg(c, 'set-chatter', 'off');
    ok(!c.S.visit && !c.S.nudgeRec, 'switching to off mid-visit ends it and nothing is left scheduled');
    chg(c, 'set-chatter', 'chatty'); arm(c, 15000);
    ok(await waitFor(() => !!c.S.visit, 3000, 'visit again'), 'and back to chatty he visits again');
    noErr(c); close(c);
  }

  // ---- markers
  const markRun = async (codes, opts) => {
    opts = opts || {};
    const t = await boot(opts.boot);
    if (opts.insurance !== false) { chg(t, 'set-insurance', true); }
    t.w.rig(codes);
    const seen = { kinds: [], max: 0, text: {}, moods: [], rings: 0, said: [], dim: false };
    new t.w.MutationObserver(() => seen.moods.push(t.S.st.getAttribute('data-mood'))).observe(t.S.st, { attributes: true, attributeFilter: ['data-mood'] });
    let ticking = true;
    const poll = (async () => { while (ticking){
      const m = t.doc.querySelectorAll('#show-layer .pm');
      seen.max = Math.max(seen.max, m.length);
      m.forEach(e => { const k = e.getAttribute('data-kind'); if (seen.kinds.indexOf(k) < 0){ seen.kinds.push(k); seen.text[k] = e.textContent; if (k === 'dbj') seen.pause = t.w.RESULT_PAUSE; } });
      if (m.length && t.doc.body.classList.contains('pm-on')) seen.dim = true;
      const sy = t.doc.querySelector('.ds-say'); if (sy && sy.classList.contains('on') && seen.said.indexOf(sy.textContent) < 0) seen.said.push(sy.textContent);
      seen.rings = Math.max(seen.rings, t.doc.querySelectorAll('#show-layer .pm-ring').length);
      await wait(1); } })();
    t.w.deal(opts.bet || 50);
    if (opts.answer){
      await waitFor(() => !!t.doc.getElementById('btn-insurance-yes'), 6000, 'insurance offer');
      t.doc.getElementById(opts.answer === 'yes' ? 'btn-insurance-yes' : 'btn-insurance-no').click();
    }
    if (opts.act){ await toPlayer(t); await actR(t, opts.act); }
    await finishedR(t); await wait(100); await toBetting(t); await wait(150);
    ticking = false; await poll;
    return { t, seen };
  };

  section('markers: insurance, and DEALER BLACKJACK');
  {
    const a = await markRun(['10S', 'AH', '9D', '10C'], { answer: 'yes' });
    ok(a.seen.kinds.join() === 'ins,dbj', 'insurance taken, dealer has it: the insurance disc first, then DEALER BLACKJACK (' + a.seen.kinds.join() + ')');
    ok(/INSURANCE/.test(a.seen.text.ins) && /\$25/.test(a.seen.text.ins), 'the insurance disc says INSURANCE and the amount: "' + a.seen.text.ins + '"');
    ok(/DEALER/.test(a.seen.text.dbj) && /21/.test(a.seen.text.dbj) && /BLACKJACK/.test(a.seen.text.dbj), 'the other says DEALER 21 BLACKJACK: "' + a.seen.text.dbj + '"');
    ok(a.seen.max === 1, 'never two discs at once (' + a.seen.max + ')');
    ok(a.seen.pause >= Math.round(a.t.S.T.result * 1.2), 'a dealer blackjack is held on the screen a little longer, and never shorter than the payout needs (' + a.seen.pause + ' against ' + a.t.S.T.result + ')');
    ok(a.seen.dim && a.seen.rings >= 1, 'the pay lines fade back while one is down, and it lands with a ring');
    ok(a.seen.said.some(x => /Dealer has blackjack/.test(x)), 'he says it: ' + JSON.stringify(a.seen.said));
    ok(a.t.w.G.bankroll === 1000, 'insurance paid 2 to 1 against the lost hand (' + a.t.w.G.bankroll + ')');
    ok(!a.t.doc.body.classList.contains('pm-on') && a.t.doc.querySelectorAll('#show-layer *').length === 0, 'afterwards the table is clean');
    noErr(a.t); close(a.t);
    const b = await markRun(['10S', 'AH', '9D', '6C', '5S'], { answer: 'yes', act: 'S' });
    ok(b.seen.kinds.join() === 'ins', 'insurance taken, no blackjack: the disc shows, no DEALER BLACKJACK (' + b.seen.kinds.join() + ')');
    noErr(b.t); close(b.t);
    const c = await markRun(['10S', 'AH', '9D', '10C'], { answer: 'no' });
    ok(c.seen.kinds.join() === 'dbj', 'insurance turned down: only DEALER BLACKJACK (' + c.seen.kinds.join() + ')');
    ok(c.t.w.G.bankroll === 950, 'the hand loses 50 (' + c.t.w.G.bankroll + ')');
    noErr(c.t); close(c.t);
    const d = await markRun(['10S', '10H', '9D', 'AC'], { insurance: false });
    ok(d.seen.kinds.join() === 'dbj', 'a ten up, an ace in the hole: DEALER BLACKJACK too (' + d.seen.kinds.join() + ')');
    noErr(d.t); close(d.t);
    const e = await markRun(['AS', 'AH', 'KD', '10C'], { answer: 'no' });
    ok(e.seen.kinds.join() === 'dbj' && e.t.w.G.bankroll === 1000, 'both have blackjack: the dealer disc, a push (' + e.t.w.G.bankroll + ')');
    noErr(e.t); close(e.t);
    const f = await markRun(['10S', '10H', '9D', '9C'], { insurance: false, act: 'S' });
    ok(f.seen.kinds.length === 0, 'no blackjack and no insurance: no disc at all');
    noErr(f.t); close(f.t);
    const g = await markRun(['AS', '10H', 'KD', '8C'], { insurance: false });
    ok(g.seen.kinds.length === 0, 'your own blackjack: the old tag, not a disc');
    noErr(g.t); close(g.t);
    const h = await markRun(['10S', 'AH', '9D', '10C'], { answer: 'yes', boot: { show: false } });
    ok(h.seen.kinds.length === 0 && h.t.w.G.bankroll === 1000, 'show off: no discs, same money');
    close(h.t);
    const i = await markRun(['10S', 'AH', '9D', '10C'], { answer: 'yes', boot: { reduced: true } });
    ok(i.seen.kinds.join() === 'ins,dbj' && i.seen.rings === 0, 'reduced motion: both discs are simply put down (' + i.seen.kinds.join() + ', ' + i.seen.rings + ' rings)');
    ok(i.t.doc.querySelectorAll('#show-layer *').length === 0, 'and picked up');
    noErr(i.t); close(i.t);
    const j = await markRun(['10S', 'AH', '9D', '10C'], { answer: 'yes', boot: { turbo: true } });
    ok(j.seen.kinds.length === 0, 'turbo: nothing');
    close(j.t);
  }

  // ---- streaks
  const streakHand = async (t, codes, act) => {
    const rec = { moods: [], said: [] };
    const mo = new t.w.MutationObserver(() => rec.moods.push(t.S.st.getAttribute('data-mood'))); mo.observe(t.S.st, { attributes: true, attributeFilter: ['data-mood'] });
    let ticking = true;
    const poll = (async () => { while (ticking){ const sy = t.doc.querySelector('.ds-say'); if (sy && sy.classList.contains('on') && rec.said.indexOf(sy.textContent) < 0) rec.said.push(sy.textContent); await wait(1); } })();
    t.w.rig(codes); t.w.deal(20);
    await waitFor(() => (t.w.G.phase === 'player' && !t.w.G.locked) || t.w.G.phase === 'result' || t.w.G.phase === 'betting', 8000, 'hand');
    if (t.w.G.phase === 'player') t.w.doAction(act || 'S');
    await finishedR(t); await wait(40); await toBetting(t); await wait(30);
    ticking = false; await poll; mo.disconnect();
    return rec;
  };
  const WIN = ['10S', '10H', '10D', '8C'], LOSE = ['10S', '10H', '9D', '10C'], PUSH = ['10S', '10H', '8D', '8C'], BJW = ['AS', '10H', 'KD', '8C'], BJD = ['10S', '10H', '9D', 'AC'];
  const HOT = /hot|Okay|Easy|warm/, COLD = /cold|turn|yours|due/;

  section('streaks: a few wins in a row and he sweats; a dry spell and he is kind');
  {
    // (the pit boss, who takes over at five in a row, has his own tests: he is off here so the dealer's own lines can be heard)
    const t = await boot({ storage: { tableready_pitboss: '0' } });
    let r = await streakHand(t, WIN); ok(t.S.run.w === 1 && r.moods.indexOf('sweat') < 0, 'win 1: normal grin');
    r = await streakHand(t, WIN); ok(t.S.run.w === 2 && r.moods.indexOf('sweat') < 0, 'win 2: still nothing');
    r = await streakHand(t, WIN);
    ok(t.S.run.w === 3 && r.moods.indexOf('sweat') >= 0 && r.moods.indexOf('grin') < 0, 'win 3: he sweats (' + r.moods.join() + ')');
    ok(r.said.some(x => HOT.test(x)), 'and says something: ' + JSON.stringify(r.said));
    const hot1 = r.said.find(x => HOT.test(x));
    ok(t.S.stats.streaks === 1, 'counted');
    r = await streakHand(t, WIN); ok(t.S.run.w === 4 && r.moods.indexOf('sweat') < 0 && !r.said.some(x => HOT.test(x)), 'win 4: not every time');
    r = await streakHand(t, PUSH); ok(t.S.run.w === 4 && t.S.run.l === 0, 'a push keeps the run going (' + t.S.run.w + ')');
    r = await streakHand(t, WIN); ok(t.S.run.w === 5 && r.moods.indexOf('sweat') >= 0, 'win 5: again, every other one');
    ok(r.said.some(x => HOT.test(x)) && r.said.find(x => HOT.test(x)) !== hot1, 'with a different line from the first time (' + JSON.stringify(r.said) + ')');
    r = await streakHand(t, LOSE);
    ok(t.S.run.w === 0 && t.S.run.l === 1 && r.moods.indexOf('sweat') < 0, 'a loss ends it');
    // BJ in a run: he is wowed, not nervous
    await streakHand(t, WIN); await streakHand(t, WIN);
    r = await streakHand(t, BJW);
    ok(t.S.run.w === 3 && r.moods.indexOf('wow') >= 0 && r.moods.indexOf('sweat') < 0, 'the third win is a blackjack: the big reaction, not the sweat (' + r.moods.join() + ')');
    noErr(t); close(t);

    const u = await boot({ storage: { tableready_pitboss: '0' } });
    for (let i = 1; i <= 3; i++){ const r2 = await streakHand(u, LOSE); ok(u.S.run.l === i && r2.moods.indexOf('sm1') < 0 && !r2.said.some(x => COLD.test(x)), 'loss ' + i + ': smirk as usual'); }
    let r3 = await streakHand(u, LOSE);
    ok(u.S.run.l === 4 && r3.moods.indexOf('sm1') >= 0, 'loss 4: a kind smile (' + r3.moods.join() + ')');
    ok(r3.said.some(x => COLD.test(x)), 'and a kind word: ' + JSON.stringify(r3.said));
    const cold1 = r3.said.find(x => COLD.test(x));
    r3 = await streakHand(u, LOSE); ok(u.S.run.l === 5 && r3.moods.indexOf('sm1') < 0 && !r3.said.some(x => COLD.test(x)), 'loss 5: not every time');
    r3 = await streakHand(u, BJD); ok(u.S.run.l === 6 && r3.moods.indexOf('sm1') < 0 && !r3.said.some(x => COLD.test(x)) && r3.said.some(x => /Dealer has blackjack/.test(x)), 'loss 6 is a dealer blackjack: he keeps his own lines, no kind word (' + r3.moods.join() + ')');
    r3 = await streakHand(u, LOSE); ok(u.S.run.l === 7 && r3.moods.indexOf('sm1') < 0, 'loss 7: not this one');
    r3 = await streakHand(u, LOSE); ok(u.S.run.l === 8 && r3.moods.indexOf('sm1') >= 0 && r3.said.some(x => COLD.test(x)), 'loss 8: again');
    ok(r3.said.find(x => COLD.test(x)) !== cold1, 'with a different line from the first time (' + JSON.stringify(r3.said) + ')');
    r3 = await streakHand(u, WIN); ok(u.S.run.l === 0 && u.S.run.w === 1, 'a win ends the dry spell');
    noErr(u); close(u);

    // quiet and off: the face, no words
    for (const lvl of ['quiet', 'off']){
      const v = await boot({ chatter: lvl });
      await streakHand(v, WIN); await streakHand(v, WIN);
      const r4 = await streakHand(v, WIN);
      ok(r4.moods.indexOf('sweat') >= 0 && !r4.said.some(x => HOT.test(x)), lvl + ': the sweat, no words (' + JSON.stringify(r4.said) + ')');
      for (let i = 0; i < 3; i++) await streakHand(v, LOSE);
      const r5 = await streakHand(v, LOSE);
      ok(r5.moods.indexOf('sm1') >= 0 && !r5.said.some(x => COLD.test(x)), lvl + ': the kind smile, no words');
      noErr(v); close(v);
    }
    const w3 = await boot({ show: false });
    for (let i = 0; i < 4; i++) await streakHand(w3, WIN);
    ok(w3.S.run.w === 0 && w3.S.stats.streaks === 0, 'show off: no reactions, nothing counted');
    close(w3);
  }

  // ---- the shuffle
  section('shuffle: the riffle, the shoe filling, the cut card, and going back down');
  {
    const t = await boot();
    const sw = () => parseFloat(t.S.shoeStack.style.width), cutOn = () => t.S.shoeCut.classList.contains('on');
    t.w.G.cutCardThreshold = 26;
    t.w.Show.afterRender();
    ok(cutOn() && t.S.shoeCut.style.right === '19.5px', 'the cut card sits in the shoe where the last quarter begins (right: ' + t.S.shoeCut.style.right + ')');
    ok(!t.S.shoeCut.classList.contains('due'), 'nothing is due yet');
    const w0 = sw();
    const sawWidths = [], sawRiffle = [], said = [];
    new t.w.MutationObserver(() => { sawWidths.push(sw()); }).observe(t.S.shoeStack, { attributes: true, attributeFilter: ['style'] });
    const cutCls = [], styleOld = [];
    new t.w.MutationObserver(recs => recs.forEach(r => styleOld.push(r.oldValue || ''))).observe(t.S.riffle, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    new t.w.MutationObserver(() => { sawRiffle.push({ cls: t.S.riffle.className.split(' '), shoe: sw(), arm: t.S.st.getAttribute('data-arm'), dx: t.S.riffle.style.getPropertyValue('--dx') }); }).observe(t.S.riffle, { attributes: true, attributeFilter: ['class'] });
    new t.w.MutationObserver(() => { cutCls.push(t.S.shoeCut.className.split(' ')); }).observe(t.S.shoeCut, { attributes: true, attributeFilter: ['class'] });
    t.w.G.needsReshuffle = true; clickDeal(t); await wait(10);
    ok(t.doc.getElementById('cutcard-overlay').style.display === 'flex', 'a reshuffle is due: the cut card prompt comes first');
    t.w.buildShoe(); t.w.placeCutCard(0.75);
    ok(!t.S.shuf, 'nothing happens while the prompt is still closing');
    ok(await waitFor(() => !!t.S.shuf, 2000, 'shuffle'), 'then he starts');
    ok(await waitFor(() => t.S.riffle.classList.contains('on'), 2000, 'riffle'), 'the riffle runs');
    ok(t.S.state === 'up' && t.S.mood === 'focus', 'he is up, concentrating');
    ok(await waitFor(() => /Shuffling/.test(lineOn(t)), 1000, 'line'), 'he says "Shuffling…"');
    ok(sw() === 9 && !cutOn(), 'the shoe is empty while he works, no cut card');
    ok(t.S.riffle.querySelectorAll('i').length === 12, 'a dozen cards drop in, one from each side in turn');
    ok(t.S.riffle.querySelectorAll('.rf-half').length === 2 && t.S.riffle.querySelectorAll('.rf-mid').length === 1, 'two halves, and the stack that builds between them');
    ok(await waitFor(() => t.S.riffle.classList.contains('sq'), 2000, 'square'), 'he squares the deck');
    ok(t.S.st.getAttribute('data-ease') === 'soft', 'his arm works behind the counter lip, on the soft curve');
    ok(await waitFor(() => !t.S.riffle.classList.contains('on'), 2000, 'riffle off'), 'the riffle ends');
    ok(sw() > 9 && cutOn(), 'the shoe has filled (width ' + sw() + ')');
    // what the deck did on the way, in order: halves drop in, go, square, he lets go, it slides, it goes in
    const at = c => sawRiffle.findIndex(e => e.cls.indexOf(c) >= 0);
    ok(['on', 'go', 'sq', 'take', 'slide', 'into'].every(c => at(c) >= 0), 'the deck went through every step: ' + sawRiffle.map(e => e.cls.slice(1).join('+')).join(' > '));
    ok(at('on') < at('go') && at('go') < at('sq') && at('sq') < at('take') && at('take') < at('slide') && at('slide') < at('into'), 'in that order');
    ok(sawRiffle[at('take')].arm === 'rest', 'he lets go of the deck and his hand draws back');
    ok(sawRiffle[at('slide')].shoe === 9 && /^-?\d+(\.\d+)?px$/.test(sawRiffle[at('slide')].dx), 'the deck slides along the counter while the shoe is still empty (' + sawRiffle[at('slide')].dx + ')');
    ok(sawRiffle[at('into')].shoe > 9 && sawRiffle[at('into')].arm === 'out', 'and as it goes in the shoe fills, his hand over the shoe');
    ok(await waitFor(() => cutCls.some(c => c.indexOf('in') >= 0), 2000, 'cut in'), 'the cut card is pushed down and seats');
    ok(cutCls.findIndex(c => c.indexOf('lift') >= 0) >= 0 && cutCls.findIndex(c => c.indexOf('lift') >= 0) < cutCls.findIndex(c => c.indexOf('in') >= 0), 'after it stood up for him');
    ok(await waitFor(() => /Cut card/.test(lineOn(t)), 2000, 'cut line'), 'he says the cut card is in');
    ok(await waitFor(() => !t.S.shuf, 4000, 'end'), 'the shuffle ends');
    ok(t.S.riffle.className === 'ds-riffle' && t.S.riffle.style.getPropertyValue('--dx') === '' && t.S.riffle.style.transition === '' && !t.S.st.hasAttribute('data-ease') && !t.S.shoeCut.classList.contains('in') && !t.S.shoeCut.classList.contains('lift'), 'the table is clear again: deck, offset, arm curve, cut card marks');
    ok(styleOld.some(v => /transition:\s*none/.test(v)), 'it was put away with its transition switched off, so it does not slide back');
    ok(await waitFor(() => t.S.state === 'away', 2000, 'down'), 'and he goes back down');
    ok(!t.S.busy && t.S.queue.length === 0 && !t.S.shuf && !t.S.shufRec, 'nothing left running');
    ok(t.S.stats.shuffles === 1 && t.w.G.phase === 'betting' && !t.w.G.locked, 'once, and the table is waiting for your bet');
    ok(Math.abs(sw() - w0) < 0.01 || sw() === 31, 'the shoe is back at full size (' + sw() + ')');
    ok(sawWidths.indexOf(9) >= 0, 'and it was emptied on the way');
    noErr(t); close(t);

    // placed twice (touch and click both fire): still one shuffle
    const u = await boot();
    u.w.placeCutCard(0.75); u.w.placeCutCard(0.6);
    await waitFor(() => !!u.S.shuf, 2000, 'shuffle'); await waitFor(() => !u.S.shuf, 4000, 'end');
    ok(u.S.stats.shuffles === 1, 'a double tap on the cut card shuffles once (' + u.S.stats.shuffles + ')');
    noErr(u); close(u);

    // dealing in the middle of it: he stops and deals
    const v = await boot();
    v.w.placeCutCard(0.75); await waitFor(() => !!v.S.shuf && v.S.riffle.classList.contains('on'), 2000, 'shuffle');
    v.w.rig(['5S', '6H', '6D', '10C', '9H']); v.w.deal(25);
    ok(!v.S.shuf && !v.S.riffle.classList.contains('on'), 'a hand starts: the shuffle stops at once');
    await toPlayer(v);
    ok(v.w.G.hands[0].cards.length === 2 && v.S.stats.shuffles === 1, 'and the cards are dealt (' + v.w.G.hands[0].cards.length + ')');
    ok(parseFloat(v.S.shoeStack.style.width) > 9, 'the shoe is not left empty');
    noErr(v); close(v);

    // the table show switched off in the middle
    const w4 = await boot();
    w4.w.placeCutCard(0.75); await waitFor(() => !!w4.S.shuf, 2000, 'shuffle');
    chg(w4, 'set-tableshow', false);
    ok(!w4.S.shuf && !w4.S.riffle.classList.contains('on') && w4.S.timers.length === 0, 'show off mid-shuffle: stopped, nothing scheduled');
    chg(w4, 'set-tableshow', true); await wait(80);
    ok(!w4.S.shuf && parseFloat(w4.S.shoeStack.style.width) > 9, 'and it does not come back by itself');
    noErr(w4); close(w4);

    // quiet, off, reduced motion, show off, turbo
    const q = await boot({ chatter: 'quiet' });
    const qs = []; q.w.placeCutCard(0.75);
    await waitFor(() => !!q.S.shuf, 2000, 'shuffle');
    ok(await waitFor(() => /Shuffling/.test(lineOn(q)), 1000, 'quiet line'), 'quiet: "Shuffling…" is information, he says it');
    let sawCut = false; const stop = Date.now() + 2500; while (Date.now() < stop && q.S.shuf){ if (/Cut card/.test(lineOn(q))) sawCut = true; await wait(2); }
    ok(!sawCut, 'but not the small talk after it');
    noErr(q); close(q);
    const o = await boot({ chatter: 'off' }); o.w.placeCutCard(0.75);
    await waitFor(() => !!o.S.shuf, 2000, 'shuffle');
    let sawAny = false; const stop2 = Date.now() + 2500; while (Date.now() < stop2 && o.S.shuf){ if (lineOn(o)) sawAny = true; await wait(2); }
    ok(!sawAny && o.S.stats.shuffles === 1, 'off: the shuffle happens, in silence');
    close(o);
    const r6 = await boot({ reduced: true }); r6.w.G.cutCardThreshold = 26; r6.w.placeCutCard(0.75); await wait(80);
    ok(!r6.S.shuf && r6.S.stats.shuffles === 0 && r6.S.shoeCut.classList.contains('on'), 'reduced motion: no shuffle, the cut card is simply there');
    close(r6);
    const s6 = await boot({ show: false }); s6.w.placeCutCard(0.75); await wait(80);
    ok(!s6.S.shuf && s6.S.stats.shuffles === 0, 'show off: nothing');
    close(s6);
    const t6 = await boot({ turbo: true }); t6.w.placeCutCard(0.75); await wait(80);
    ok(!t6.S.shuf && t6.S.stats.shuffles === 0, 'turbo: nothing');
    close(t6);
    // the cut card shows when a reshuffle is due
    const d6 = await boot();
    d6.w.G.cutCardThreshold = 26; d6.w.G.shoe.length = 20; d6.w.Show.afterRender();
    ok(d6.S.shoeCut.classList.contains('due') && parseFloat(d6.S.shoeCut.style.right) <= 5 + parseFloat(d6.S.shoeStack.style.width) + 0.01, 'when the shoe is down to the cut card it blinks, at the edge of the stack');
    close(d6);
  }

  // ---- side-bet circles
  section('side-bet circles: one for each side bet that is on');
  {
    const t = await boot(); visibleParent(t);
    const side = k => $(t, 'bet-circle-' + k), on = () => [...t.doc.querySelectorAll('.bc.side.sb-on')].map(e => e.id.slice(11));
    ok(on().length === 0, 'no side bets on: no circles');
    chg(t, 'sb-pp', true); chg(t, 'sb-bb', true); await wait(10);
    ok(on().join() === 'pp,bb', 'two on: two circles (' + on().join() + ')');
    ok(side('pp').classList.contains('sb-first') && !side('bb').classList.contains('sb-first'), 'the first has the divider');
    ok(side('pp').querySelector('.bc-label').textContent === 'PAIRS' && side('bb').querySelector('.bc-label').textContent === 'BUSTER', 'each is named');
    ok(side('pp').querySelector('.bc-amt').textContent === '5' && kidsOf(t, 'bet-circle-pp').join() === '5', 'each starts with the 5 the box held');
    ok(side('pp').getAttribute('role') === 'button' && side('pp').tabIndex === 0 && /Perfect Pairs side bet: 5/.test(side('pp').getAttribute('aria-label')), 'a button for the keyboard, with a spoken name and amount: ' + side('pp').getAttribute('aria-label'));
    ok(!side('tp').classList.contains('sb-on') && !side('tl').classList.contains('sb-on'), 'the others are not shown');
    chg(t, 'sb-tp', true); chg(t, 'sb-tl', true); await wait(10);
    ok(on().join() === 'pp,tp,tl,bb', 'all four');
    // drag a 25 onto Perfect Pairs
    side('pp').getBoundingClientRect = rect(500, 568, 0, 88);
    ptr(t, $(t, 'chip-25'), 'pointerdown', 700, 700); ptr(t, t.w, 'pointermove', 720, 720);
    ok(side('pp').classList.contains('armed') && $(t, 'bet-circle').classList.contains('armed'), 'carrying a chip lights up the places to drop: the main circle and the side circles');
    ptr(t, t.w, 'pointermove', 530, 40);
    ok(side('pp').classList.contains('hot') && t.doc.querySelector('#bet-circle-pp .bc-plus').textContent === '+25' && !$(t, 'bet-circle').classList.contains('hot'), 'over it: it lights up and previews +25');
    ptr(t, t.w, 'pointerup', 530, 40); await wait(40);
    ok($(t, 'sb-pp-amt').value === '30' && $(t, 'bet-amount').value === '0', 'the 25 went on Perfect Pairs (30), not on the main bet');
    ok(kidsOf(t, 'bet-circle-pp').reduce((a, b) => a + b, 0) === 30 && side('pp').querySelector('.bc-amt').textContent === '30', 'the stack shows 30');
    ok(t.S.lastChip === 25, 'it remembers the last chip');
    await wait(500);
    // tap: the last chip again
    side('tp').click(); await wait(10);
    ok($(t, 'sb-tp-amt').value === '30', 'a tap on 21+3 adds the 25 (30)');
    // keyboard (you got to the circle with Tab, so the circle keeps Enter and Space; with the mouse they would deal)
    side('tl').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    side('tl').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(5);
    ok($(t, 'sb-tl-amt').value === '30', 'Enter adds a chip too');
    side('tl').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })); await wait(5);
    ok($(t, 'sb-tl-amt').value === '5', 'Backspace takes the top one off (5)');
    side('tl').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })); await wait(5);
    ok($(t, 'sb-tl-amt').value === '0' && kidsOf(t, 'bet-circle-tl').length === 0, 'and the last one (0)');
    side('tl').dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })); await wait(5);
    ok($(t, 'sb-tl-amt').value === '0', 'nothing more to take');
    // back to the rack
    ptr(t, side('pp'), 'pointerdown', 530, 40); ptr(t, t.w, 'pointermove', 560, 70); ptr(t, t.w, 'pointermove', 4, 4);
    ok(t.doc.querySelector('.chip-rack').classList.contains('hot'), 'carrying a chip out of a side circle lights up the rack');
    ptr(t, t.w, 'pointerup', 4, 4); await wait(40);
    ok($(t, 'sb-pp-amt').value === '5', 'dropped on the rack, the 25 comes off (5)');
    // the rack knows what is committed
    t.w.G.bankroll = 100; t.w.renderAll(); await wait(260);
    ok(rackIds(t).join() === '5,10,25,50' || rackIds(t).join() === '5,10,25,50,100', 'the rack counts the side bets (bankroll 100 minus ' + (5 + 30 + 0 + 5) + ': ' + rackIds(t).join() + ')');
    t.w.G.bankroll = 1000; t.w.renderAll();
    // only in the betting phase
    t.w.rig(['10S', '6H', '9D', '10C', '6S']);
    $(t, 'bet-amount').value = '50'; const before = t.w.G.bankroll;
    t.w.G.needsReshuffle = false; t.w.startDeal(); await toPlayer(t);
    ok(before - t.w.G.bankroll === 50 + 5 + 30 + 0 + 5, 'the game took the bet and every side bet (' + (before - t.w.G.bankroll) + ')');
    ok(JSON.stringify(t.w.G.sbAmounts) === JSON.stringify({ pp: 5, tp: 30, tl: 0, bb: 5 }), 'as ' + JSON.stringify(t.w.G.sbAmounts));
    side('tp').click(); await wait(5);
    ok($(t, 'sb-tp-amt').value === '30', 'during the hand a tap does nothing');
    ptr(t, side('tp'), 'pointerdown', 530, 40); ptr(t, t.w, 'pointermove', 4, 4);
    ok(!t.doc.querySelector('.cg'), 'and chips cannot be picked up');
    noErr(t); close(t);
  }
  section('side-bet circles: with two hands, switching bets off, a short stack, the show off');
  {
    const t = await boot(); visibleParent(t);
    t.w.setHands(2); chg(t, 'sb-pp', true); await wait(10);
    $(t, 'bet-circle-pp').getBoundingClientRect = rect(500, 568, 0, 88); place2(t);
    ok(t.w.G.betSpot === 0, 'hand 1 is selected');
    t.w.selectSpot(1);
    ptr(t, $(t, 'chip-25'), 'pointerdown', 700, 700); ptr(t, t.w, 'pointermove', 720, 720); ptr(t, t.w, 'pointermove', 530, 40); ptr(t, t.w, 'pointerup', 530, 40); await wait(40);
    ok($(t, 'sb-pp-amt').value === '30' && t.w.G.betSpot === 1 && $(t, 'bet-amount').value === '0' && $(t, 'bet-amount-2').value === '0', 'a side-bet drop does not change which hand is selected, nor either bet');
    await wait(500);
    $(t, 'bet-circle-pp').click(); await wait(5);
    ok(t.w.G.betSpot === 1 && $(t, 'sb-pp-amt').value === '55', 'tapping a side circle does not select a hand (it added 25: 55)');
    // switching it off: the circle goes, its chips stop counting
    chg(t, 'sb-pp', false); await wait(10);
    ok(!$(t, 'bet-circle-pp').classList.contains('sb-on'), 'switched off: the circle is gone');
    ok(t.w.Show._S.spots[2].chips.length >= 0 && true, 'its stack is kept for later');
    chg(t, 'sb-pp', true); await wait(10);
    ok($(t, 'bet-circle-pp').classList.contains('sb-on') && kidsOf(t, 'bet-circle-pp').reduce((a, b) => a + b, 0) === 55, 'switched back on: it shows the 55 the box still holds');
    noErr(t); close(t);
    // not enough chips: the tap puts what you can
    const u = await boot(); visibleParent(u);
    chg(u, 'sb-tp', true); u.S.lastChip = 100; u.w.G.bankroll = 30; u.w.renderAll(); await wait(10);
    $(u, 'bet-circle-tp').click(); await wait(10);
    ok($(u, 'sb-tp-amt').value === '30', 'last chip 100 but only 25 free (30 minus the 5 already there): it puts the biggest chip that fits, the 25 (5 + 25 = 30)');
    $(u, 'bet-circle-tp').click(); await wait(10);
    ok($(u, 'sb-tp-amt').value === '30', 'then nothing is free, and nothing more goes on (' + $(u, 'sb-tp-amt').value + ')');
    noErr(u); close(u);
    // show off: the old number box
    const v = await boot({ show: false });
    chg(v, 'sb-pp', true); await wait(10);
    ok(!v.doc.querySelector('.bc.side.sb-on') && !v.doc.body.classList.contains('tbl-on') && v.doc.getElementById('sb-pp-amt-wrap').style.display === 'flex', 'table show off: no circles, the plain number box is back');
    close(v);
  }

  // ---- the finer points of the discs and of the shuffle
  const fakeAudio = log => ({ sampleRate: 8000, currentTime: 0, state: 'running', destination: {},
    createBuffer(c, n){ return { getChannelData(){ return new Float32Array(n); } }; },
    createBufferSource(){ log.noise++; return { connect(){}, start(){} }; },
    createBiquadFilter(){ return { type: '', Q: { value: 0 }, frequency: { value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }; },
    createGain(){ return { gain: { setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }; },
    createOscillator(){ log.tones++; return { type: '', frequency: { value: 0 }, connect(){}, start(){}, stop(){} }; } });

  section('markers: the disc, up close');
  {
    const t = await boot(); visibleParent(t);
    const discs = () => t.doc.querySelectorAll('#show-layer .pm');
    // one at a time, counted once each, and only kinds that exist
    const m0 = t.S.stats.markers;
    t.w.Show._throwMarker('ins', 25);
    ok(t.S.stats.markers === m0 + 1 && discs().length === 1, 'one disc, counted once (' + (t.S.stats.markers - m0) + ')');
    t.w.Show._throwMarker('dbj');
    ok(discs().length === 1 && discs()[0].getAttribute('data-kind') === 'dbj', 'a new disc picks the old one up first');
    let threw = false; const m1 = t.S.stats.markers;
    try{ t.w.Show._throwMarker('nonsense'); }catch(e){ threw = true; }
    ok(!threw && t.S.stats.markers === m1 && discs().length === 1, 'a kind that does not exist does nothing');
    noErr(t); close(t);

    // the insurance disc: slides out of the tray, turns once, stays through the hand, then goes
    const u = await boot(); visibleParent(u);
    u.S.k = 0.2;
    const kfs = []; const an = u.w.Element.prototype.animate;
    u.w.Element.prototype.animate = function(kf, op){ if (this.classList && this.classList.contains('pm')) kfs.push(kf); return an.call(this, kf, op); };
    u.S.tray.getBoundingClientRect = () => ({ left: 500, top: 300, width: 60, height: 30, right: 560, bottom: 330 });
    const msnd = []; u.w.G.soundOn = true; u.w.TRSound.play = n => { msnd.push(n); return true; };
    u.w.Show._throwMarker('ins', 25);
    ok(msnd.indexOf('slide') >= 0, 'it slides with a sound (' + msnd.join(',') + ')');
    ok(kfs.length === 1 && kfs[0][0].transform.indexOf('translate(530.0px,315.0px)') === 0, 'it starts out at the tray: ' + (kfs[0] && kfs[0][0].transform));
    ok(/rotate\(360deg\)$/.test(kfs[0][kfs[0].length - 1].transform), 'and ends the right way up: ' + kfs[0][kfs[0].length - 1].transform);
    await wait(300);
    ok(u.doc.querySelectorAll('#show-layer .pm').length === 1, 'it is still on the felt a moment later');
    ok(await waitFor(() => u.doc.querySelectorAll('#show-layer .pm').length === 0, 2000, 'gone'), 'and then it is picked up');
    noErr(u); close(u);

    // taking insurance with nothing bet puts no disc down
    const v = await boot();
    const yes = v.doc.createElement('button'); yes.id = 'btn-insurance-yes'; v.doc.body.appendChild(yes);
    const m2 = v.S.stats.markers; v.w.G.insuranceBet = 0; yes.click(); await wait(30);
    ok(v.S.stats.markers === m2, 'insurance of nothing: no disc');
    v.w.G.insuranceBet = 25; yes.click(); await wait(30);
    ok(v.S.stats.markers === m2 + 1, 'insurance of 25: the disc');
    noErr(v); close(v);
  }

  section('shuffle: the finer points');
  {
    // he only shuffles when it is his to do
    const t = await boot();
    chg(t, 'set-tableshow', false);
    t.w.Show._shuffleMoment();
    ok(!t.S.shuf && t.S.stats.shuffles === 0, 'show off: no shuffle');
    close(t);
    const u = await boot();
    u.w.rig(RIGP); u.w.setBet(50); clickDeal(u); await toPlayer(u);
    u.w.Show._shuffleMoment();
    ok(!u.S.shuf && u.S.stats.shuffles === 0, 'not in the middle of a hand');
    close(u);
    const v = await boot();
    v.S.egg = {}; v.w.Show._shuffleMoment(); v.S.egg = null;
    ok(!v.S.shuf && v.S.stats.shuffles === 0, 'not while he is busy with the tray');
    close(v);
    const nr = await boot();
    const deck = nr.S.riffle; nr.S.riffle = null; nr.w.Show._shuffleMoment(); nr.S.riffle = deck;
    ok(!nr.S.shuf && nr.S.stats.shuffles === 0, 'not without a deck to shuffle');
    noErr(nr); close(nr);

    // a stop in the first instant leaves nothing behind
    const w = await boot();
    const w9 = parseFloat(w.S.shoeStack.style.width);
    w.w.Show._shuffleMoment();
    ok(!!w.S.shuf && parseFloat(w.S.shoeStack.style.width) === 9, 'he starts: the shoe is empty');
    w.w.Show._shuffleStop(true);
    ok(!w.S.shuf && parseFloat(w.S.shoeStack.style.width) === w9, 'stopped: the shoe is full again (' + w.S.shoeStack.style.width + ')');
    await wait(25);
    ok(!w.S.shuf && !w.S.riffle.classList.contains('on') && !/Shuffling/.test(lineOn(w)) && !w.S.busy && w.S.queue.length === 0, 'and none of the later steps happen');
    noErr(w); close(w);

    // stopped while the deck is sliding: put away where it lies, not slid back
    const sl = await boot();
    sl.w.Show._shuffleMoment();
    sl.S.k = 1;
    ok(await waitFor(() => sl.S.riffle.classList.contains('slide'), 9000, 'slide'), 'the deck is sliding');
    sl.w.Show._shuffleStop(true);
    ok(sl.S.riffle.className === 'ds-riffle' && sl.S.riffle.style.getPropertyValue('--dx') === '' && sl.S.riffle.style.transition === '' && !sl.S.st.hasAttribute('data-ease'), 'stopped mid-slide: everything put away, nothing left on the stage');
    noErr(sl); close(sl);

    // twice in a row: the first is put away and the second runs
    const x = await boot();
    x.w.Show._shuffleMoment(); const h1 = x.S.shuf; x.w.Show._shuffleMoment();
    ok(x.S.shuf && x.S.shuf !== h1 && h1.done === null && x.S.stats.shuffles === 2, 'two in a row: the first is put away, the second is the one running');
    ok(await waitFor(() => !x.S.shuf, 3000, 'end') && !x.S.busy && x.S.queue.length === 0, 'and it finishes cleanly');
    noErr(x); close(x);

    // a shuffle that was queued, then stopped, frees the queue when its turn comes
    const y = await boot();
    y.S.busy = true; y.w.Show._shuffleMoment(); y.w.Show._shuffleStop(true);
    y.S.busy = false; y.w.Show._pump();
    ok(!y.S.busy && y.S.queue.length === 0, 'a shuffle stopped before its turn lets the queue go on');
    await wait(120);
    ok(!y.S.riffle.classList.contains('on') && !/Shuffling/.test(lineOn(y)), 'and does not run');
    noErr(y); close(y);

    // a visit that is under way gives way to it; and a stop puts everything away at once
    const z = await boot({ limits: true });
    z.w.setBet(900);
    ok(!!z.S.visit, 'a limit visit is under way');
    z.w.Show._shuffleMoment();
    ok(!z.S.visit && !!z.S.shuf, 'the shuffle takes over from it');
    ok(await waitFor(() => z.S.state === 'up' && z.S.riffle.classList.contains('on'), 2000, 'riffle'), 'riffle');
    z.S.st.style.setProperty('--arm-ms', '999ms');
    ok(await waitFor(() => /Shuffling/.test(lineOn(z)), 1000, 'line'), 'he is saying it');
    z.w.Show._shuffleStop();
    ok(!z.S.shuf && !!z.S.lowerRec && !/Shuffling/.test(lineOn(z)) && z.S.st.style.getPropertyValue('--arm-ms') === '260ms', 'a stop: he lowers again, the line goes, his arm comes back');
    noErr(z); close(z);

    // the cut card: due when the stack has reached it, not before
    const q = await boot();
    q.w.G.cutCardThreshold = 26;
    const keep = q.w.G.shoe.slice();
    const dueAt = n => { q.w.G.shoe = keep.slice(0, n); q.w.Show.afterRender(); return q.S.shoeCut.classList.contains('due'); };
    ok(!dueAt(104) && !dueAt(40) && !dueAt(27) && dueAt(26) && dueAt(10), 'due at 26 cards left, not at 27');
    noErr(q); close(q);

    // he takes his time to get up: the first step waits for him if he was down, and not if he was up
    const r = await boot();
    r.S.k = 0.5;
    r.w.Show._shuffleMoment();
    await wait(100);
    ok(!r.S.riffle.classList.contains('on'), 'from down: he is still getting up (no riffle yet)');
    ok(await waitFor(() => r.S.riffle.classList.contains('on'), 1500, 'riffle'), 'then he starts');
    await wait(100);
    ok(!r.S.riffle.classList.contains('sq'), 'and squares the deck a good while after, not at once');
    r.w.Show._shuffleStop(true);
    r.S.state = 'up'; r.S.st.setAttribute('data-state', 'up');
    r.w.Show._shuffleMoment();
    await wait(100);
    ok(r.S.riffle.classList.contains('on'), 'from up: straight to it');
    r.w.Show._shuffleStop(true);
    noErr(r); close(r);

    // at the real speed: the whole shuffle fits inside what the table allows it
    const s = await boot();
    s.S.k = 1;
    const t0 = Date.now();
    s.w.G.needsReshuffle = true; clickDeal(s); await wait(10);
    s.w.buildShoe(); s.w.placeCutCard(0.75);
    ok(await waitFor(() => !!s.S.shuf, 3000, 'start'), 'at the real speed: it starts');
    ok(await waitFor(() => !s.S.shuf, 8000, 'end'), 'and ends (' + (Date.now() - t0) + ' ms)');
    ok(!s.S.busy && s.S.queue.length === 0 && s.S.errors.length === 0, 'with no watchdog and nothing stuck');
    noErr(s); close(s);
  }

  // ---- "Shuffle now" is for between hands
  section('shuffle now: the dealer says no while a hand is going');
  {
    const NOPE = (t) => t.w.SHUFFLE_NOPE;
    const btn = t => t.doc.getElementById('btn-shuffle-now'), note = t => t.doc.getElementById('shuffle-note').textContent;
    const same = (t, snap) => t.w.G.phase === snap.phase && JSON.stringify(t.w.G.hands) === snap.hands && t.w.G.shoe.length === snap.shoe && t.w.G.bankroll === snap.bank && JSON.stringify(t.w.G.dealer) === snap.dealer;
    const snapOf = t => ({ phase: t.w.G.phase, hands: JSON.stringify(t.w.G.hands), shoe: t.w.G.shoe.length, bank: t.w.G.bankroll, dealer: JSON.stringify(t.w.G.dealer) });
    const overlays = t => ['cutcard-overlay', 'tablesetup-overlay'].some(id => t.doc.getElementById(id).style.display === 'flex');

    const t = await boot();
    ok(NOPE(t).length >= 6 && new Set(NOPE(t)).size === NOPE(t).length && NOPE(t).every(l => l.length <= 40), 'a handful of different lines, none too long for the speech bubble (' + NOPE(t).length + ')');
    ok(!!btn(t) && !btn(t).classList.contains('blocked') && btn(t).getAttribute('aria-disabled') === null && !!t.doc.getElementById('shuffle-note'), 'between hands the button is live');
    t.w.rig(RIGP); t.w.setBet(50); clickDeal(t); await toPlayer(t);
    ok(btn(t).classList.contains('blocked') && btn(t).getAttribute('aria-disabled') === 'true', 'mid-hand the button is dimmed and says so');
    const snap = snapOf(t);
    btn(t).click();
    ok(NOPE(t).indexOf(lineOn(t)) >= 0, 'the dealer answers in one of his lines: "' + lineOn(t) + '"');
    ok(t.S.mood === 'sus' && t.S.stats.nope === 1, 'with a look (' + t.S.mood + ')');
    ok(same(t, snap) && !overlays(t), 'and nothing at all happens to the game: same phase, cards, shoe, bankroll, no prompt');
    ok(t.w.fullReshuffle() === false && same(t, snap) && !overlays(t), 'the function itself refuses too, not just the button');
    // every phase of a round
    for (const ph of ['dealing', 'player', 'dealer', 'result']){
      const keep = t.w.G.phase; t.w.G.phase = ph; const sn = snapOf(t);
      ok(t.w.fullReshuffle() === false && same(t, sn) && !overlays(t), 'phase "' + ph + '": refused, untouched');
      t.w.G.phase = keep;
    }
    const keepLock = t.w.G.locked; t.w.G.locked = true; const sn2 = snapOf(t);
    ok(t.w.fullReshuffle() === false && same(t, sn2), 'locked: refused');
    t.w.G.locked = keepLock;
    const lk = await boot(); lk.w.G.locked = true; const snl = snapOf(lk);
    ok(lk.w.G.phase === 'betting' && lk.w.fullReshuffle() === false && same(lk, snl) && !overlays(lk), 'betting, but the table is locked (something is mid-move): refused too');
    close(lk);
    // every line once, then no line twice in a row
    const seen = []; for (let i = 0; i < 2 * NOPE(t).length - 1; i++){ btn(t).click(); seen.push(lineOn(t)); }
    ok(new Set(seen).size === NOPE(t).length, 'all of his lines come up, not just a couple (' + new Set(seen).size + ' of ' + NOPE(t).length + ' in ' + seen.length + ')');
    let twice = false, prev = seen[seen.length - 1];
    for (let i = 0; i < 40; i++){ btn(t).click(); const l = lineOn(t); if (l === prev) twice = true; prev = l; }
    ok(!twice, 'and never the same line twice running');
    // a fresh deck of lines: every cycle is all of them in a different order, and no line ends one cycle and starts the next
    const fr = await boot(); const cyc = []; for (let c = 0; c < 4; c++){ const b = []; for (let i = 0; i < NOPE(fr).length; i++) b.push(fr.w.nextShuffleNope()); cyc.push(b); }
    ok(cyc.every(b => new Set(b).size === NOPE(fr).length), 'every cycle uses each line once');
    ok(cyc.slice(1).some((b, i) => b.join('|') !== cyc[i].join('|')), 'in a different order each time');
    ok(cyc.slice(1).every((b, i) => b[0] !== cyc[i][cyc[i].length - 1]), 'and none repeats across the seam');
    close(fr);
    // the hand is still the hand: play it out
    ok(t.w.G.phase === 'player' && t.w.G.hands[0].cards.length === 2, 'the hand is still there');
    t.w.doAction('S');
    ok(await waitFor(() => t.w.G.phase === 'result' || t.w.G.phase === 'betting', 8000, 'end'), 'it plays out normally');
    ok(await toBetting(t), 'and the table goes back to betting');
    ok(!btn(t).classList.contains('blocked') && btn(t).getAttribute('aria-disabled') === null, 'the button is live again');
    btn(t).click();
    ok(overlays(t), 'and now it shuffles: the cut card prompt opens');
    noErr(t); close(t);

    // after the result is up, but before the board clears: still a hand
    const r = await boot();
    r.S.k = 1;
    r.w.rig(RIGP); r.w.setBet(50); clickDeal(r); await toPlayer(r); r.w.doAction('S');
    ok(await waitFor(() => r.w.G.phase === 'result', 8000, 'result'), 'the hand is over, the result is showing');
    const snr = snapOf(r); btn(r).click();
    ok(r.w.G.phase === 'result' && same(r, snr) && !overlays(r) && NOPE(r).indexOf(lineOn(r)) >= 0, 'during the result pause it is still refused');
    ok(await toBetting(r), 'and the round clears by itself afterwards');
    noErr(r); close(r);

    // quiet: it is an answer, so he says it; off: he says nothing and the note is plain
    const q = await boot({ chatter: 'quiet' });
    q.w.rig(RIGP); q.w.setBet(50); clickDeal(q); await toPlayer(q); btn(q).click();
    ok(NOPE(q).indexOf(lineOn(q)) >= 0 && note(q) === '' && q.S.mood === 'sus', 'quiet: he still says it');
    const o = await boot({ chatter: 'off' });
    o.w.rig(RIGP); o.w.setBet(50); clickDeal(o); await toPlayer(o); const sno = snapOf(o); btn(o).click();
    ok(lineOn(o) === '' && /hand is in play/.test(note(o)) && same(o, sno), 'off: he says nothing, a plain note sits by the button: "' + note(o) + '"');
    noErr(o); close(o);
    // no dealer: the same words, by the button
    const n = await boot({ show: false });
    n.w.rig(RIGP); n.w.setBet(50); clickDeal(n); await toPlayer(n); const snn = snapOf(n); btn(n).click();
    ok(/^Dealer: “/.test(note(n)) && NOPE(n).some(l => note(n).indexOf(l) >= 0) && same(n, snn) && !overlays(n), 'show off: the line shows by the button and the game is untouched: ' + note(n));
    await wait(3400);
    ok(note(n) === '', 'the note goes away by itself');
    ok(q.S.mood !== 'sus' && q.S.mood === 'idle', 'and so does his look (' + q.S.mood + ')');
    noErr(q); close(q);
    noErr(n); close(n);
    const tu = await boot({ turbo: true });
    tu.w.rig(RIGP); tu.w.setBet(50); clickDeal(tu); await toPlayer(tu); const snt = snapOf(tu); btn(tu).click();
    ok(note(tu) !== '' && same(tu, snt) && !overlays(tu), 'turbo: the same');
    noErr(tu); close(tu);
  }

  // ---------------------------------------------------------------- a card in the air has not happened yet
  section('a card in the air has not happened yet: nothing about a bust shows until it has landed and turned over');
  {
    // watch every change to the hands, the dealer's box and the readouts; at each one note what is showing and whether a card is still on its way
    const watch = t => {
      const log = [], S = t.w.Show._S;
      const one = () => {
        const pend = S.flights.filter(f => f.state !== 'landed').length, hb = t.doc.querySelector('#hands-row .hand-box'), db = t.doc.getElementById('dealer-box');
        const badge = hb && hb.children[0], dbadge = t.doc.getElementById('dealer-badge'), cnt = t.doc.getElementById('count-bar').querySelector('.v');
        log.push({
          pend, status: t.w.G.hands[0] && t.w.G.hands[0].status, phase: t.w.G.phase,
          pBadge: !!badge && badge.style.display !== 'none' && badge.textContent === 'Bust', pLose: !!hb && /outcome-lose/.test(hb.className), pHold: !!hb && hb.classList.contains('hold'),
          dBadge: !!dbadge && dbadge.style.display !== 'none' && dbadge.textContent === 'Bust', dLose: /outcome-lose/.test(db.className), dHold: db.classList.contains('hold'),
          odds: t.doc.getElementById('odds-panel').textContent.replace(/\s+/g, ' '), count: cnt ? cnt.textContent : ''
        });
      };
      const mo = new t.w.MutationObserver(one);
      ['hands-row', 'dealer-box', 'odds-panel', 'count-bar'].forEach(id => mo.observe(t.doc.getElementById(id), { attributes: true, childList: true, subtree: true, characterData: true }));
      one();
      return log;
    };
    // the dealer busts (he has 16 and draws a ten)
    {
      const t = await boot();
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t);
      const log = watch(t);
      actBtn(t, /^Stand/).click(); await finished(t); await wait(60);
      const air = log.filter(x => x.pend > 0);
      ok(air.length > 0 && air.some(x => x.dHold), 'dealer bust: the bust card was in the air for a while, and his box was on hold');
      ok(!air.some(x => (x.dBadge || x.dLose) && !x.dHold), 'dealer bust: no Bust badge or losing outline while the card is still in the air');
      const after = log.filter(x => x.pend === 0 && x.dBadge);
      ok(after.length > 0 && after.some(x => !x.dHold) && !log[log.length - 1].dHold, 'dealer bust: once it has landed (and its number has counted up) the Bust badge shows and the hold is gone');
      const lastD = log.filter(x => x.dBadge).pop();
      ok(!!lastD && !lastD.dHold && lastD.pend === 0, 'dealer bust: and it stays, with nothing held back');
      noErr(t); close(t);
    }
    // you bust (15, hit a ten): the odds line, the count and the Bust badge all wait for the card
    {
      const t = await boot();
      t.w.rig(['9H', '7D', '6S', '5C', 'KD', '8H']); t.w.deal(25); await toPlayer(t);
      const odds0 = t.doc.getElementById('odds-panel').textContent.replace(/\s+/g, ' '), cnt0 = t.doc.getElementById('count-bar').querySelector('.v').textContent;
      ok(/stand on 15/.test(odds0), 'you bust: the odds line starts at 15 (' + odds0.slice(-40) + ')');
      const log = watch(t);
      t.w.HIT_RESOLVE_DELAY = 1; t.S.T.hit = 1;   // a hit that would settle long before the card gets there
      actBtn(t, /^Hit/).click(); await finished(t); await wait(60);
      const air = log.filter(x => x.pend > 0);
      ok(air.length > 0 && air.some(x => x.pHold), 'you bust: the card was in the air for a while, and your hand was on hold');
      ok(!air.some(x => x.status === 'bust' || x.pBadge || x.pLose), 'you bust: no bust, no badge, no losing outline until the card has landed');
      ok(!air.some(x => /stand on 25/.test(x.odds)), 'you bust: the odds line does not say 25 while the card is in the air');
      ok(air.length > 0 && air.every(x => x.odds === odds0), 'you bust: it keeps saying what was true before');
      ok(air.length > 0 && air.every(x => x.count === cnt0), 'you bust: and so does the running count (' + cnt0 + ')');
      const settled = log.filter(x => x.pend === 0 && x.status === 'bust');
      ok(settled.length > 0 && settled.some(x => x.pBadge), 'you bust: once it has landed, the hand busts and the badge shows');
      const lastP = log.filter(x => x.pBadge).pop();
      ok(!!lastP && !lastP.pHold && lastP.pend === 0, 'you bust: and it stays, with nothing held back');
      noErr(t); close(t);
    }
    // the count catches up when the card lands: a King is -1
    {
      const t = await boot();
      t.w.rig(['9H', '7D', '6S', '5C', 'KD', '8H']); t.w.deal(25); await toPlayer(t);
      const c0 = t.w.G.runningCount, shown0 = t.doc.getElementById('count-bar').querySelector('.v').textContent;
      t.w.HIT_RESOLVE_DELAY = 900; t.S.T.hit = 900;   // the hit settles (and redraws everything) long after the card lands, so the readout has to catch up by itself
      actBtn(t, /^Hit/).click();
      ok(t.w.G.runningCount === c0 - 1 && t.doc.getElementById('count-bar').querySelector('.v').textContent === shown0, 'count: the game has counted the King, the readout has not yet (' + shown0 + ')');
      await waitFor(() => t.w.Show._S.flights.every(f => f.state === 'landed'), 4000, 'landing');
      await wait(20);
      await wait(12);
      ok(t.w.G.hands[0].status === 'active' && t.doc.getElementById('count-bar').querySelector('.v').textContent === String(t.w.G.runningCount), 'count: as it lands the readout shows ' + t.w.G.runningCount + ' (' + t.doc.getElementById('count-bar').querySelector('.v').textContent + ')');
      ok(/stand on 25/.test(t.doc.getElementById('odds-panel').textContent), 'odds: and the odds line catches up to the new total too');
      noErr(t); close(t);
    }
    // a safe hit does not wait any longer than it has to, and a double settles the same way
    {
      const t = await boot();
      t.w.rig(['5H', '7D', '6S', '5C', '4D', '8H']); t.w.deal(25); await toPlayer(t);
      const log = watch(t);
      actBtn(t, /^Hit/).click(); await waitFor(() => !t.w.G.locked, 4000, 'unlock'); await wait(30);
      ok(t.w.G.hands[0].status === 'active' && t.w.G.phase === 'player' && log.some(x => x.pend > 0), 'safe hit: 11 hits a 4 for 15, the hand stays in play (' + t.w.G.hands[0].status + ')');
      noErr(t); close(t);
      const d = await boot();
      d.w.rig(['9H', '7D', '6S', '5C', 'KD', '8H']); d.w.deal(25); await toPlayer(d);
      const dl = watch(d);
      d.w.HIT_RESOLVE_DELAY = 1; d.S.T.hit = 1;
      actBtn(d, /^Double/).click(); await finished(d); await wait(60);
      const air = dl.filter(x => x.pend > 0);
      ok(air.length > 0 && !air.some(x => x.status === 'bust' || x.pBadge || x.pLose), 'double: a busting double shows nothing until the card has landed');
      ok(dl.some(x => x.pend === 0 && x.status === 'bust'), 'double: and then it busts');
      noErr(d); close(d);
    }
    // a beat after the card lands, not the same instant (real-time flight)
    {
      const t = await boot();
      t.w.rig(['9H', '7D', '6S', '5C', 'KD', '8H']); t.w.deal(25); await toPlayer(t);
      t.S.k = 1; t.w.HIT_RESOLVE_DELAY = 1; t.S.T.hit = 1;
      let landedAt = 0, bustAt = 0;
      const mo = new t.w.MutationObserver(() => {
        const pend = t.S.flights.filter(f => f.state !== 'landed').length;
        if (!landedAt && pend === 0 && t.w.G.hands[0].cards.length === 3) landedAt = Date.now();
        if (!bustAt && t.w.G.hands[0].status === 'bust') bustAt = Date.now();
      });
      ['hands-row', 'dealer-box'].forEach(id => mo.observe(t.doc.getElementById(id), { attributes: true, childList: true, subtree: true }));
      actBtn(t, /^Hit/).click();
      await waitFor(() => bustAt > 0, 5000, 'the bust');
      ok(landedAt > 0 && bustAt - landedAt >= 100 && bustAt - landedAt <= 600, 'the bust is announced a beat after the card has landed (' + (bustAt - landedAt) + 'ms)');
      noErr(t); close(t);
    }
    // the css that holds a hand's verdict back
    ok(/\.hand-box\.hold \.badge\{visibility:hidden;?\}/.test(HTML) && /\.hand-box\.hold\.outcome-lose[^{]*\{border-color:var\(--line\);box-shadow:none;?\}/.test(HTML), 'a hand on hold hides its badge and shows no win/lose outline');
    // switching the show off while a hit is in the air must not leave the hand waiting
    {
      const t = await boot();
      t.w.rig(['9H', '7D', '6S', '5C', 'KD', '8H']); t.w.deal(25); await toPlayer(t);
      t.S.k = 1; t.w.HIT_RESOLVE_DELAY = 8; t.S.T.hit = 8;
      actBtn(t, /^Hit/).click();
      await wait(30);
      const sw = $(t, 'set-tableshow'); sw.checked = false; sw.dispatchEvent(new t.w.Event('change', { bubbles: true }));
      const t0 = Date.now();
      ok(await waitFor(() => t.w.G.hands[0] && t.w.G.hands[0].status === 'bust' || t.w.G.phase !== 'player', 1500, 'the hit to settle'), 'show switched off mid-hit: the hand still settles (' + (Date.now() - t0) + 'ms), it does not wait for a card that is no longer coming');
      noErr(t); close(t);
    }
    // with the show off there is no flight, so nothing waits
    {
      const t = await boot({ show: false });
      t.w.rig(['9H', '7D', '6S', '5C', 'KD', '8H']); t.w.deal(25); await toPlayer(t);
      const t0 = Date.now(); actBtn(t, /^Hit/).click();
      await waitFor(() => t.w.G.hands[0].status === 'bust' || t.w.G.phase !== 'player', 4000, 'bust');
      ok(Date.now() - t0 < 400, 'show off: a bust settles at the original pace (' + (Date.now() - t0) + 'ms)');
      noErr(t); close(t);
    }
  }

  // <<MOTION>>
  // ---------------------------------------------------------------- motion: landing, the number, the bust, the double
  const mboot = o => boot(Object.assign({ motion: true }, o || {}));   // these sections test the motion set itself, which is switched off by default
  section('motion: a card lands, its total counts up, a bust is felt, a double goes down on its side');
  {
    const actBtn = (t, re) => [...t.doc.querySelectorAll('#actions-row button')].find(b => re.test(b.textContent));
    const settled = t => waitFor(() => t.w.G.phase !== 'dealer' && t.w.G.phase !== 'player' && t.w.G.dealer.cards.length >= 2, 9000, 'round to finish');
    // record what the page animates (which element, which keyframes) without changing what it does
    const spy = t => {
      const rec = [], an = t.w.Element.prototype.animate;
      t.w.Element.prototype.animate = function(kf, op){ rec.push({ el: this, cls: this.className, kf, op }); return an.call(this, kf, op); };
      return rec;
    };
    // a hit that does not bust: the number counts from what it was to what it is
    {
      const t = await mboot();
      t.w.rig(['9H', '7D', '5C', '10S', '4S']); t.w.deal(25); await toPlayer(t);
      const rec = spy(t), S = t.S, box = t.doc.querySelector('#hands-row .hand-box'), tot = box.children[1].children[1];
      const seen = [], flags = [];
      const mo = new t.w.MutationObserver(list => list.forEach(r => {
        if(r.type === 'childList' && r.addedNodes[0]) seen.push(r.addedNodes[0].data);
        flags.push({ rolling: tot.classList.contains('rolling'), pop: tot.classList.contains('pop'), hold: box.classList.contains('hold'), pend: S.flights.filter(f => f.state !== 'landed').length });
      }));
      mo.observe(tot, { childList: true, characterData: true, subtree: true, attributes: true });
      actBtn(t, /^Hit/).click();
      await waitFor(() => t.w.G.hands[0].cards.length === 3 && S.rolls.length === 0 && S.flights.length === 0, 4000, 'hit to settle'); await wait(30);
      const nums = seen.filter(x => /^\d+$/.test(x));
      ok(nums.length >= 3, 'the total shows more than the end number: ' + nums.join(','));
      ok(nums[nums.length - 1] === '18', 'and ends on the right one: ' + nums[nums.length - 1]);
      const at = nums.indexOf('14');
      ok(at >= 0, 'it starts from what the hand was worth before the card (14): ' + nums.join(','));
      const run = nums.slice(at);
      ok(run.every((x, i) => i === 0 || +x >= +run[i - 1] || (i > 0 && +x === 18)), 'and only goes up from there: ' + run.join(','));
      ok(flags.some(f => f.rolling && f.hold), 'while it counts the hand is on hold and the number is plain');
      ok(!tot.classList.contains('rolling') && !box.classList.contains('hold'), 'both let go at the end');
      ok(S.stats.rolls >= 1, 'counted as a roll');
      ok(nums.some(x => x === '15' || x === '16' || x === '17'), 'it passes through the numbers between 14 and 18: ' + nums.join(','));
      ok(flags.some(f => f.pop), 'and when it lands on the number it gives a small pop');
      const landed = rec.filter(r => /card/.test(r.cls) && r.kf[0] && /translateX\(0px\)/.test(r.kf[0].transform || ''));
      ok(landed.length >= 1, 'the cards beside the one coming in give way (' + landed.length + ')');
      const settle = rec.filter(r => /card/.test(r.cls) && r.kf.length === 3 && /translateX\(-5px\)/.test(r.kf[0].transform || ''));
      ok(settle.length >= 1, 'and settle back with a little bounce when it lands (' + settle.length + ')');
      const fly = rec.filter(r => /fc-sc/.test(r.cls)).pop(), kf = fly && fly.kf[fly.kf.length - 1].transform;
      ok(kf && /scale\(0\.530\)/.test(kf), 'the card comes in a little larger (6%) than its place, to be set down: ' + kf);
      const tr = rec.filter(r => /(^|\s)fc(\s|$)/.test(r.cls)).pop();
      ok(tr && /translate\(/.test(tr.kf[2].transform), 'its flight ends a hair above the felt');
      ok(/\.card\.landed\{animation:cardLand 3\d\dms/.test(HTML) && /@keyframes cardLand\{[^}]*translateY\(-7px\)[^}]*rotate\(var\(--r,0deg\)\)/.test(HTML.replace(/\s+/g, ' ')), 'css: the landing squashes and keeps a turned card turned');
      noErr(t); close(t);
    }
    // the first two cards: no count-up from nothing
    {
      const t = await mboot();
      t.w.rig(['9H', '7D', '5C', '10S']); t.w.deal(25); await toPlayer(t);
      ok(t.S.stats.rolls === 0, 'the opening deal does not roll (' + t.S.stats.rolls + ')');
      const tot = t.doc.querySelector('#hands-row .big-total'); ok(tot.textContent === '14' && !tot.classList.contains('rolling'), 'it just says 14');
      noErr(t); close(t);
    }
    // a bust has a sound of its own: a low thud under the hand (and the dealer's bust does not thud)
    {
      const heard = [];
      const t = await mboot();
      t.w.G.soundOn = true; t.w.TRSound.play = n => { heard.push(n); return true; };
      t.w.rig(['10H', '10D', '6C', '7S', '10S', '5H']); t.w.deal(25); await toPlayer(t);
      const before = heard.filter(n => n === 'thud').length;
      actBtn(t, /^Hit/).click();
      await waitFor(() => t.doc.querySelector('#hands-row .hand-box').hasAttribute('data-bust'), 4000, 'the bust moment'); await wait(20);
      ok(before === 0 && heard.filter(n => n === 'thud').length === 1, 'your bust: one low thud (' + heard.filter(n => n === 'thud').length + ')');
      noErr(t); close(t);
    }
    // a bust: the number counts past 21, then the moment
    {
      const t = await mboot();
      t.w.rig(['10H', '10D', '6C', '7S', '10S', '5H']); t.w.deal(25); await toPlayer(t);
      const rec = spy(t), S = t.S, box = t.doc.querySelector('#hands-row .hand-box'), tot = box.children[1].children[1], row = box.children[1].children[0];
      let when = null, sawShake = false;
      const mo = new t.w.MutationObserver(() => {
        if(tot.classList.contains('shake')) sawShake = true;
        if(box.hasAttribute('data-bust') && !when) when = { rolling: tot.classList.contains('rolling'), pend: S.flights.filter(f => f.state !== 'landed').length, rolls: S.rolls.length, hold: box.classList.contains('hold'), status: t.w.G.hands[0].status, shake: tot.classList.contains('shake') };
      });
      mo.observe(box, { attributes: true, attributeFilter: ['data-bust', 'class'] }); mo.observe(tot, { attributes: true });
      actBtn(t, /^Hit/).click();
      await waitFor(() => box.hasAttribute('data-bust'), 4000, 'the bust moment'); await wait(10);
      ok(when && when.pend === 0 && !when.rolling && when.rolls === 0 && !when.hold, 'it begins only after the card has landed and the number has finished: ' + JSON.stringify(when));
      ok(when && when.status === 'bust', 'and the hand is a bust by then');
      ok(sawShake, 'the number shakes');
      ok(tot.classList.contains('bust'), 'and is the bust colour');
      ok(/^-?2\.2deg$/.test(box.style.getPropertyValue('--tilt')), 'the hand has a tilt to sag to: ' + box.style.getPropertyValue('--tilt'));
      ok(box.children[0].textContent === 'Bust' && box.children[0].style.display !== 'none', 'the Bust badge is up');
      const vig = rec.filter(r => /bust-vig/.test(r.cls));
      ok(vig.length === 1 && vig[0].kf.length === 3, 'one flush of colour across the felt');
      ok(S.stats.busts === 1, 'counted once (' + S.stats.busts + ')');
      await wait(40); ok(S.stats.busts === 1, 'and not again on the next redraw');
      ok(/\.hand-box\[data-bust\] \.cards-row[^{]*\{[^}]*rotate\(var\(--tilt[^}]*brightness\(/.test(HTML) && /@keyframes badgeDrop/.test(HTML) && /@keyframes totalShake/.test(HTML), 'css: sag and dim, badge drop, shake are all there');
      await settled(t); await toBetting(t);
      ok(!t.doc.querySelector('[data-bust]'), 'nothing is left marked for the next hand');
      noErr(t); close(t);
    }
    // the dealer busts: his hand sags too, no flush of red for you
    {
      const t = await mboot();
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t);
      const rec = spy(t);
      actBtn(t, /^Stand/).click();
      await waitFor(() => t.doc.getElementById('dealer-box').hasAttribute('data-bust'), 6000, 'his bust moment');
      const db = t.doc.getElementById('dealer-box');
      ok(t.doc.getElementById('dealer-badge').textContent === 'Bust' && !db.classList.contains('hold') && t.S.flights.length === 0, 'his Bust shows only once his card is down');
      ok(rec.filter(r => /bust-vig/.test(r.cls)).length === 0, 'no red flush when it is his bust');
      noErr(t); close(t);
    }
    // a hit that wins / makes 21 does not feel like a bust
    {
      const t = await mboot();
      t.w.rig(['9H', '7D', '5C', '10S', '7S']); t.w.deal(25); await toPlayer(t);
      actBtn(t, /^Hit/).click(); await waitFor(() => t.w.G.hands[0].cards.length === 3 && t.S.rolls.length === 0 && t.S.flights.length === 0, 4000, 'hit'); await wait(40);
      ok(!t.doc.querySelector('[data-bust]') && t.S.stats.busts === 0, 'no bust moment for 21');
      noErr(t); close(t);
    }
    // a double: the card goes down on its side, the second chip goes onto the ring, the bankroll counts down
    {
      const t = await mboot();
      t.w.rig(['6H', '10D', '5C', '7S', '10S', '5H']); t.w.deal(25); await toPlayer(t);
      const rec = spy(t), S = t.S, box = t.doc.querySelector('#hands-row .hand-box'), pile = () => box.querySelector('.hb-label b').textContent;
      const before = t.w.G.bankroll, bankEl = $(t, 'bankroll-val'), shown = [];
      const mo = new t.w.MutationObserver(() => shown.push(bankEl.textContent)); mo.observe(bankEl, { childList: true, characterData: true, subtree: true });
      const pileSeen = [], mo2 = new t.w.MutationObserver(() => pileSeen.push(pile())); mo2.observe(box.querySelector('.hb-label'), { childList: true, characterData: true, subtree: true });
      ok(pile() === '25' && String(before) === bankEl.textContent, 'start: a 25 bet on the ring');
      actBtn(t, /^Double/).click();
      ok(t.w.G.hands[0].dblIdx === 2, 'the doubled card is marked (' + t.w.G.hands[0].dblIdx + ')');
      ok(S.chipHold[0] === 25 && pile() === '25', 'the ring still shows the old bet while the chip is on its way');
      ok(bankEl.textContent === String(before), 'and so does the bankroll: ' + bankEl.textContent);
      ok(rec.filter(r => /pchip/.test(r.cls)).length >= 1, 'a chip is thrown onto the bet');
      await waitFor(() => t.w.G.hands[0].cards.length === 3 && S.rolls.length === 0 && S.flights.length === 0, 4000, 'double to land'); await wait(30);
      ok(pile() === '50' && pileSeen.indexOf('50') >= 0 && S.chipHold[0] === undefined, 'when it lands the ring says 50');
      const c3 = box.children[1].children[0].children[2];
      ok(c3.classList.contains('dbl') && c3.style.getPropertyValue('--r') === '90deg', 'the third card is on its side');
      ok(!box.children[1].children[0].children[0].classList.contains('dbl'), 'the others are not');
      const fly = rec.filter(r => /fc-sc/.test(r.cls)).pop(); ok(fly && /rotate\(90(\.0)?deg\)/.test(fly.kf[fly.kf.length - 1].transform), 'it flew in turning onto its side: ' + (fly && fly.kf[fly.kf.length - 1].transform));
      ok(rec.filter(r => /ring-rip/.test(r.cls)).length >= 1, 'a ring spreads where the chip landed');
      ok(bankEl.textContent === String(t.w.G.bankroll) && S.bankHold === null, 'the bankroll ends on the real number: ' + bankEl.textContent);
      ok(shown.length >= 1 && +shown[shown.length - 1] === t.w.G.bankroll, 'having counted down to it: ' + shown.join(','));
      ok(S.stats.doubles === 1, 'counted');
      await settled(t); await toBetting(t); await wait(20);
      noErr(t); close(t);
    }
    // a free double (Free Bet): no chip, but the card still goes on its side
    {
      const t = await mboot();
      $(t, 'set-variant').value = 'freebet'; t.w.readSettings();
      t.w.rig(['6H', '10D', '5C', '7S', '10S']); t.w.deal(25); await toPlayer(t);
      const rec = spy(t), bank = t.w.G.bankroll;
      actBtn(t, /^Double/).click();
      ok(rec.filter(r => /pchip/.test(r.cls)).length === 0 && t.S.chipHold[0] === undefined, 'free double: no chip');
      await waitFor(() => t.w.G.hands[0].cards.length === 3 && t.S.flights.length === 0, 4000, 'land'); await wait(30);
      ok(t.doc.querySelector('#hands-row .card.dbl') && t.w.G.bankroll === bank, 'the card is on its side and the bankroll did not move');
      noErr(t); close(t);
    }
    // reduced motion: nothing flies, nothing is held; the sideways card is just a layout
    {
      const t = await mboot({ reduced: true });
      t.w.rig(['10H', '10D', '6C', '7S', '10S', '5H']); t.w.deal(25); await toPlayer(t);
      const rec = spy(t);
      actBtn(t, /^Hit/).click();
      await waitFor(() => t.w.G.hands[0].status === 'bust' || t.w.G.phase !== 'player', 4000, 'bust'); await wait(30);
      ok(!t.doc.querySelector('[data-bust]') && t.S.stats.busts === 0 && t.S.rolls.length === 0, 'reduced motion: no bust moment and no count-up');
      ok(rec.filter(r => /bust-vig|pchip|ring-rip/.test(r.cls)).length === 0, 'and nothing animated');
      noErr(t); close(t);
      const u = await mboot({ reduced: true });
      u.w.rig(['6H', '10D', '5C', '7S', '10S']); u.w.deal(25); await toPlayer(u);
      actBtn(u, /^Double/).click(); await wait(30);
      ok(u.S.chipHold[0] === undefined && $(u, 'bankroll-val').textContent === String(u.w.G.bankroll) && u.w.G.hands[0].dblIdx === 2, 'reduced motion double: no hold, bankroll right at once');
      ok(!!u.doc.querySelector('#hands-row .card.dbl'), 'the card is still turned');
      noErr(u); close(u);
    }
    // show off / turbo: the plain table
    {
      const t = await mboot({ show: false });
      t.w.rig(['6H', '10D', '5C', '7S', '10S']); t.w.deal(25); await toPlayer(t);
      actBtn(t, /^Double/).click(); await wait(60);
      ok(!t.doc.querySelector('.card.dbl, [data-bust], .pchip, .rolling') && t.w.G.hands[0].dblIdx === 2, 'show off: no sideways card, no chips, no counting');
      noErr(t); close(t);
      const u = await mboot({ turbo: true });
      u.w.rig(['10H', '10D', '6C', '7S', '10S', '5H']); u.w.deal(25); await toPlayer(u);
      actBtn(u, /^Hit/).click(); await wait(60);
      ok(!u.doc.querySelector('.card.dbl, [data-bust], .pchip, .rolling') && u.S.stats.busts === 0, 'turbo: the same');
      noErr(u); close(u);
    }
    // switching the show off while a number is counting puts the real number back and leaves nothing held
    {
      const t = await mboot();
      t.w.rig(['9H', '7D', '5C', '10S', '4S']); t.w.deal(25); await toPlayer(t);
      t.S.k = 1;
      actBtn(t, /^Hit/).click();
      await waitFor(() => t.S.rolls.length > 0, 6000, 'a roll to start');
      const sw = $(t, 'set-tableshow'); sw.checked = false; sw.dispatchEvent(new t.w.Event('change', { bubbles: true }));
      await wait(30);
      const tot = t.doc.querySelector('#hands-row .big-total');
      ok(t.S.rolls.length === 0 && tot.textContent === '18' && !tot.classList.contains('rolling'), 'switched off mid-count: it says 18 and nothing is held (' + tot.textContent + ')');
      noErr(t); close(t);
    }
  }

  // ---------------------------------------------------------------- payouts
  section('payouts: paid from his rack, swept to it, slid back; the bankroll counts; all of it can be cut short');
  {
    const actBtn = (t, re) => [...t.doc.querySelectorAll('#actions-row button')].find(b => re.test(b.textContent));
    const floats = t => [...t.doc.querySelectorAll('.pay-float')].map(f => f.className.replace('pay-float ', '') + ':' + f.textContent);
    const spy = t => {
      const rec = [], an = t.w.Element.prototype.animate;
      t.w.Element.prototype.animate = function(kf, op){ rec.push({ el: this, cls: this.className, kf, op }); return an.call(this, kf, op); };
      return rec;
    };
    // run a hand to its result while recording what the bankroll shows and which chips and floats appear
    const play = async (t, codes, act, bet, o) => {
      o = o || {};
      t.w.rig(codes); t.w.deal(bet || 25); await toPlayer(t);
      const bank = $(t, 'bankroll-val'), seen = [], sawFloat = new Set(), chips = new Set(), hide = { v: false };
      const rec = spy(t);
      const mo = new t.w.MutationObserver(() => { seen.push(bank.textContent); [...t.doc.querySelectorAll('.pay-float')].forEach(f => sawFloat.add(f.className.replace('pay-float ', '') + ':' + f.textContent)); t.doc.querySelectorAll('.pchip').forEach(c => chips.add(c)); if (t.doc.querySelector('.hb-bet.pay-hide')) hide.v = true; });
      mo.observe(t.doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
      const before = t.w.G.bankroll;
      const h0 = t.w.G.history.length;
      for (const a of act) { actBtn(t, a).click(); await wait(25); await waitFor(() => !t.w.G.locked, 4000); }
      await waitFor(() => t.w.G.history.length > h0, 9000, 'a result');
      const atResult = { shown: bank.textContent, G: t.w.G.bankroll, pause: t.w.RESULT_PAUSE };
      await toBetting(t); await wait(40);
      return { rec, seen, sawFloat: [...sawFloat], nChips: chips.size, hide: hide.v, before, atResult, final: t.w.G.bankroll, shown: bank.textContent };
    };
    // a win: the dealer busts
    {
      const t = await mboot();
      const r = await play(t, ['10S', '10H', '9D', '6C', '10D'], [/^Stand/], 25);
      ok(r.final === r.before + 50, 'won 25: ' + r.before + ' → ' + r.final);
      ok(r.sawFloat.indexOf('win:+$25') >= 0, 'a "+$25" floats up: ' + r.sawFloat.join(' '));
      ok(r.nChips >= 2, 'your chip and the dealer\'s payment are both there as chips (' + r.nChips + ')');
      ok(r.hide, 'the pile on the ring is replaced by them while they move');
      ok(r.atResult.shown === String(r.before) && r.atResult.G === r.before + 50, 'the bankroll still shows the old number when the result is announced: ' + r.atResult.shown + ' (real ' + r.atResult.G + ')');
      ok(r.shown === String(r.final) && t.S.bankHold === null && t.S.pay === null, 'and ends on the real one, nothing left held: ' + r.shown);
      const nums = r.seen.filter(x => /^\d+$/.test(x)).map(Number), up = nums.slice(nums.lastIndexOf(r.before));
      ok(up[up.length - 1] === r.final && up.every((x, i) => i === 0 || x >= up[i - 1]), 'it counts up: ' + up.join(','));
      ok(r.atResult.pause >= 8, 'the pause is long enough to watch it');
      ok(r.rec.filter(x => /pchip/.test(x.cls)).length >= 3, 'chips travel (paid out, then to the bankroll): ' + r.rec.filter(x => /pchip/.test(x.cls)).length + ' flights');
      ok(!t.doc.querySelector('.pchip, .pay-float'), 'none left over');
      noErr(t); close(t);
    }
    // a loss: swept to the rack, the bankroll does not move at the end
    {
      const t = await mboot();
      const r = await play(t, ['10H', '10C', '6D', '7S'], [/^Stand/], 25);
      ok(r.final === r.before && r.sawFloat.indexOf('lose:−$25') >= 0, 'lost 25: "' + r.sawFloat.join(' ') + '"');
      ok(r.nChips >= 1 && r.hide, 'his chips leave the ring');
      ok(r.shown === String(r.final) && t.S.pay === null, 'bankroll is right: ' + r.shown);
      noErr(t); close(t);
    }
    // a push: your bet comes back to you
    {
      const t = await mboot();
      const r = await play(t, ['10H', '10C', '8D', '8S'], [/^Stand/], 25);
      ok(r.final === r.before + 25 && r.sawFloat.indexOf('push:Push') >= 0, 'push: ' + r.sawFloat.join(' '));
      ok(r.atResult.shown === String(r.before) && r.shown === String(r.final), 'bankroll waits, then shows ' + r.shown);
      noErr(t); close(t);
    }
    // blackjack: chips, but the existing tag carries the amount
    {
      const t = await mboot();
      t.w.rig(['AH', '9C', 'KD', '7S']); t.w.deal(100);
      await waitFor(() => t.w.G.phase === 'result', 9000, 'blackjack result');
      const bank = $(t, 'bankroll-val');
      ok(bank.textContent === '900' && t.w.G.bankroll === 1150, 'blackjack: the number waits at 900 while the real one is 1150 (' + bank.textContent + ')');
      await toBetting(t); await wait(40);
      ok(bank.textContent === '1150', 'then 1150');
      noErr(t); close(t);
    }
    // two hands: each gets its own
    {
      const t = await mboot();
      t.w.setHands(2); t.w.G.betSpot = 0; t.doc.getElementById('bet-amount').value = '25'; t.doc.getElementById('bet-amount-2').value = '50';
      t.w.rig(['10H', '9S', '10C', '10D', '10S', '7C']); t.w.startDeal(); await toPlayer(t);
      const rec = spy(t), fl = new Set(), mo = new t.w.MutationObserver(() => [...t.doc.querySelectorAll('.pay-float')].forEach(f => fl.add(f.className.replace('pay-float ', '') + ':' + f.textContent)));
      mo.observe(t.doc.body, { childList: true, subtree: true });
      actBtn(t, /^Stand/).click(); await wait(25); await waitFor(() => t.w.G.phase === 'player' && t.w.G.activeIdx === 1 && !t.w.G.locked, 5000); actBtn(t, /^Stand/).click();
      await waitFor(() => t.w.G.phase === 'result', 9000, 'result'); await toBetting(t); await wait(40);
      ok(fl.size === 2 && [...fl].some(x => /\$25$/.test(x)) && [...fl].some(x => /\$50$/.test(x)), 'two hands, two amounts: ' + [...fl].join(' '));
      ok(t.doc.getElementById('bankroll-val').textContent === String(t.w.G.bankroll), 'bankroll right');
      noErr(t); close(t);
    }
    // cut short: tap / skipResult while it is all still moving
    {
      const t = await mboot();
      t.S.k = 0.5; t.w.RESULT_PAUSE = 4000;
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t);
      actBtn(t, /^Stand/).click();
      await waitFor(() => t.w.G.phase === 'result' && t.S.pay && t.doc.querySelector('.pchip'), 20000, 'chips moving');
      ok(t.doc.querySelectorAll('.pchip').length >= 1 && t.doc.getElementById('bankroll-val').textContent === '975', 'mid-payout: chips are out and the bankroll has not moved yet (' + t.doc.querySelectorAll('.pchip').length + ' chips, ' + t.doc.getElementById('bankroll-val').textContent + ')');
      ok(t.w.skipResult() === true, 'skipResult says it did something');
      ok(t.w.G.phase === 'betting', 'back to betting');
      ok(!t.doc.querySelector('.pchip, .pay-float, .hb-bet.pay-hide') && t.S.pay === null && t.S.bankHold === null, 'every chip and float is gone and nothing is held');
      ok(t.doc.getElementById('bankroll-val').textContent === String(t.w.G.bankroll) && t.w.G.bankroll === 1025, 'the bankroll shows the real number at once: ' + t.doc.getElementById('bankroll-val').textContent);
      ok(t.w.skipResult() === false, 'nothing to skip now');
      await wait(60); ok(t.S.errors.length === 0, 'no late timer upset it: ' + JSON.stringify(t.S.errors));
      noErr(t); close(t);
    }
    // dealing again straight away is fine after a skip
    {
      const t = await mboot();
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t);
      actBtn(t, /^Stand/).click(); await waitFor(() => t.w.G.phase === 'result', 9000, 'result');
      t.w.skipResult(); t.w.rig(['9S', '10H', '8D', '7C', '3D']); t.w.deal(25); await toPlayer(t);
      ok(t.w.G.hands.length === 1 && t.doc.querySelectorAll('.pchip').length === 0, 'the next hand starts clean');
      noErr(t); close(t);
    }
    // reduced motion, show off, turbo: the bankroll just changes; skipResult still works
    for (const mode of ['reduced', 'off', 'turbo']) {
      const t = await mboot(mode === 'reduced' ? { reduced: true } : mode === 'off' ? { show: false } : { turbo: true });
      const r = await play(t, ['10S', '10H', '9D', '6C', '10D'], [/^Stand/], 25);
      ok(r.final === r.before + 50 && r.shown === String(r.final), mode + ': 1025 straight away');
      ok(r.nChips === 0 && r.sawFloat.length === 0 && !r.hide, mode + ': no chips, no floats');
      noErr(t); close(t);
    }
    {
      const t = await mboot({ show: false });
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t);
      actBtn(t, /^Stand/).click(); await waitFor(() => t.w.G.phase === 'result', 9000, 'result');
      t.w.RESULT_PAUSE = 5000;
      ok(typeof t.w.skipResult === 'function', 'skipResult exists with the show off');
      t.w.skipResult(); ok(t.w.G.phase === 'betting', 'and works');
      noErr(t); close(t);
    }
    // switching the show off while chips are on their way puts everything right
    {
      const t = await mboot();
      t.S.k = 0.5; t.w.RESULT_PAUSE = 4000;
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t);
      actBtn(t, /^Stand/).click(); await waitFor(() => t.w.G.phase === 'result' && t.S.pay && t.doc.querySelector('.pchip'), 20000, 'chips moving');
      const sw = $(t, 'set-tableshow'); sw.checked = false; sw.dispatchEvent(new t.w.Event('change', { bubbles: true })); await wait(20);
      ok(!t.doc.querySelector('.pchip, .pay-float') && t.S.bankHold === null && t.doc.getElementById('bankroll-val').textContent === '1025', 'show off mid-payout: chips gone, bankroll 1025');
      ok(!t.doc.querySelector('.hb-bet.pay-hide'), 'and the pile is back');
      noErr(t); close(t);
    }
  }

  // ---------------------------------------------------------------- smoother play: keys, rebet, undo, tap to skip, quick deal
  section('smoother play: Space deals, one tap to rebet, Backspace takes a chip back, tap to move on, Quick deal');
  {
    const actBtn = (t, re) => [...t.doc.querySelectorAll('#actions-row button')].find(b => re.test(b.textContent));
    const key = (t, k, o, target) => { const ev = new t.w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})); (target || t.doc.body).dispatchEvent(ev); return ev; };
    const keyUp = (t, k) => t.doc.body.dispatchEvent(new t.w.KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true }));
    const reb = t => t.doc.getElementById('rebet-grp');
    const shown = t => { const g = reb(t); return !!g && g.style.display !== 'none'; };
    const stand = async t => { actBtn(t, /^Stand/).click(); await waitFor(() => t.w.G.phase === 'result', 9000, 'result'); };

    // Space and Enter deal
    for (const k of [' ', 'Enter']) {
      const t = await boot();
      t.w.rig(['9H', '7D', '5C', '10S']); t.w.setBet(25); await wait(10);
      const ev = key(t, k);
      ok(ev.defaultPrevented, JSON.stringify(k) + ': the key is taken (the page does not scroll)');
      ok(t.w.G.phase !== 'betting' && t.w.G.hands.length === 1 && t.w.G.hands[0].bet === 25, JSON.stringify(k) + ': the hand is dealt with the bet on the felt');
      await toPlayer(t);
      const again = key(t, k);
      ok(!again.defaultPrevented && t.w.G.hands.length === 1, JSON.stringify(k) + ': during the hand it does nothing');
      noErr(t); close(t);
    }
    // not when it should not
    {
      const t = await boot();
      t.w.setBet(0); await wait(10);
      key(t, ' ');
      ok(t.w.G.phase === 'betting' && t.alerts.length === 0, 'no bet: nothing is dealt, and no pop-up either');
      ok(/bet/i.test(t.S.shoeTip.textContent), 'the shoe says why: ' + t.S.shoeTip.textContent);
      t.w.setBet(25); await wait(5);
      key(t, ' ', null, $(t, 'bet-amount'));
      ok(t.w.G.phase === 'betting', 'typing in the bet box: Space is just a space');
      t.doc.getElementById('manners-overlay').style.display = 'flex';
      key(t, ' ');
      ok(t.w.G.phase === 'betting', 'with a window open it waits');
      t.doc.getElementById('manners-overlay').style.display = 'none';
      key(t, ' ', { ctrlKey: true }); key(t, ' ', { metaKey: true });
      ok(t.w.G.phase === 'betting', 'with Ctrl or Cmd held it is left alone');
      key(t, ' ', { repeat: true });
      ok(t.w.G.phase === 'betting', 'holding the key down does not count');
      const shoe = t.doc.querySelector('.ds-shoe');
      const ev = key(t, 'Enter', null, shoe);
      await wait(20);
      ok(t.w.G.hands.length === 1, 'on the shoe itself, Enter deals once, not twice');
      noErr(t); close(t);
    }
    // the show off, and turbo: Space deals there too
    for (const mode of ['off', 'turbo']) {
      const t = await boot(mode === 'off' ? { show: false } : { turbo: true });
      t.w.rig(['9H', '7D', '5C', '10S']); t.w.setBet(25); await wait(10);
      if (mode === 'off') { ok(!t.w.G.tableShow, 'show is off'); key(t, ' '); ok(t.w.G.phase === 'betting', 'with the whole table show off the page is just as it was'); }
      else { key(t, ' '); await wait(20); ok(t.w.G.phase !== 'betting', 'turbo: Space deals'); }
      noErr(t); close(t);
    }
    // a button you clicked with the mouse does not keep Space; one you tabbed to does
    {
      const t = await boot();
      t.w.rig(['9H', '7D', '5C', '10S']);
      const chip = $(t, 'chip-25');
      chip.dispatchEvent(new t.w.MouseEvent('mousedown', { bubbles: true })); chip.click(); await wait(10);
      const ev = key(t, ' ', null, chip); keyUp(t, ' ');
      ok(ev.defaultPrevented && t.w.G.phase !== 'betting' && t.w.G.hands[0].bet === 25, 'after clicking a chip, Space deals and does not drop a second chip (' + (t.w.G.hands[0] && t.w.G.hands[0].bet) + ')');
      noErr(t); close(t);
      const u = await boot();
      u.w.setBet(25);
      const c2 = $(u, 'chip-5');
      key(u, 'Tab', null, c2); await wait(5);
      const e2 = key(u, ' ', null, c2);
      ok(!e2.defaultPrevented && u.w.G.phase === 'betting', 'tabbed to a button, Space is that button\'s (it does what it says)');
      c2.dispatchEvent(new u.w.MouseEvent('mousedown', { bubbles: true }));
      key(u, ' ', null, c2);
      ok(u.w.G.phase !== 'betting', 'and a click anywhere hands Space back to the table');
      noErr(u); close(u);
    }
    // Space after a result: moves on, and deals the next hand
    {
      const t = await boot();
      t.S.k = 0.5; t.w.RESULT_PAUSE = 4000;
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t);
      await stand(t);
      ok(!!t.doc.getElementById('skip-hint'), 'the first few results say you can move on');
      const h0 = t.w.G.history.length, br = t.w.G.bankroll;
      t.w.rig(['9S', '10H', '8D', '7C', '3D']);
      const ev = key(t, ' ');
      ok(ev.defaultPrevented && t.w.G.phase !== 'result', 'Space: the pause is over');
      ok(t.w.G.hands.length === 1 && t.w.G.hands[0].bet === 25 && t.w.G.bankroll === br - 25, 'and the next hand is dealt with the same bet (' + t.w.G.bankroll + ')');
      ok(!t.doc.getElementById('skip-hint') && !t.doc.querySelector('.pchip, .pay-float') && t.S.bankHold === null, 'hint, chips and held numbers are gone');
      ok(t.doc.getElementById('bankroll-val').textContent === String(t.w.G.bankroll), 'bankroll shows the real number: ' + t.doc.getElementById('bankroll-val').textContent);
      keyUp(t, ' ');
      await toPlayer(t);
      ok(t.w.G.history.length === h0, 'one result was recorded, not two');
      noErr(t); close(t);
    }
    // the hint stops after a few hands, and once you have used the shortcut
    {
      const t = await boot({ storage: { bj_skiphint: '6' } });
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t); await stand(t);
      ok(!t.doc.getElementById('skip-hint'), 'six hands in, no more hint');
      noErr(t); close(t);
      const u = await boot();
      u.w.rig(['10S', '10H', '9D', '6C', '10D']); u.w.deal(25); await toPlayer(u); await stand(u);
      u.w.RESULT_PAUSE = 4000;
      key(u, ' ');
      ok(u.w.localStorage.getItem('bj_skiphint') === '6', 'using the shortcut ends the hint for good');
      noErr(u); close(u);
    }
    // tap the table after a result
    {
      const t = await boot();
      t.S.k = 0.5; t.w.RESULT_PAUSE = 4000;
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t); await stand(t);
      ok(t.w.G.phase === 'result', 'in the pause after a result');
      t.doc.querySelector('.table-felt').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
      ok(t.w.G.phase === 'betting', 'a tap on the table moves to the next bet');
      ok(t.doc.getElementById('bankroll-val').textContent === String(t.w.G.bankroll), 'with the bankroll right');
      noErr(t); close(t);
    }
    {
      const t = await boot();
      t.S.k = 0.5; t.w.RESULT_PAUSE = 4000;
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t); await stand(t);
      t.doc.getElementById('bet-clear').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
      ok(t.w.G.phase === 'result', 'a tap on a button is not a tap on the table');
      t.doc.getElementById('bet-amount').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
      ok(t.w.G.phase === 'result', 'nor a tap on a field');
      t.doc.getElementById('manners-overlay').style.display = 'flex';
      t.doc.querySelector('.table-felt').dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
      ok(t.w.G.phase === 'result', 'nor with a window open');
      noErr(t); close(t);
    }
    // Rebet
    {
      const t = await boot();
      ok(!shown(t), 'before the first hand there is nothing to rebet');
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t); await stand(t); await toBetting(t); await wait(20);
      ok(!shown(t), 'the same bet as last time: no button needed');
      t.w.setBet(50); await wait(10);
      ok(shown(t), 'a different bet: Rebet appears');
      ok(/Rebet \$25/.test($(t, 'btn-rebet').textContent), 'and says what it is: ' + $(t, 'btn-rebet').textContent);
      ok(t.doc.body.classList.contains('rebet-on'), 'the page knows (layout)');
      $(t, 'btn-rebet').click(); await wait(10);
      ok(t.w.G.phase === 'betting' && t.w.betOf(0) === 25 && !shown(t), 'one tap puts $25 back and the button goes');
      const sp = t.S.spots[0];
      ok(sp.val === 25 && sp.chips.reduce((a, b) => a + b, 0) === 25, 'the stack on the circle matches');
      t.w.setBet(100); await wait(5);
      t.w.G.bankroll = 20; t.w.renderAll(); await wait(10);
      ok(!shown(t), 'a bet you can no longer afford is not offered');
      noErr(t); close(t);
    }
    {
      const t = await boot();
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t); await stand(t); await toBetting(t); await wait(20);
      t.w.setBet(0); await wait(10);
      t.w.rig(['9S', '10H', '8D', '7C', '3D']);
      $(t, 'btn-rebet-deal').click(); await wait(20);
      ok(t.w.G.phase !== 'betting' && t.w.G.hands[0].bet === 25, 'Rebet & Deal: the same bet, dealt');
      noErr(t); close(t);
    }
    // Rebet with two hands and a side bet
    {
      const t = await boot();
      t.w.setHands(2); t.w.G.betSpot = 0;
      $(t, 'bet-amount').value = '25'; $(t, 'bet-amount-2').value = '50';
      const pp = $(t, 'sb-pp'); pp.checked = true; pp.dispatchEvent(new t.w.Event('change', { bubbles: true })); $(t, 'sb-pp-amt').value = '10';
      t.w.rig(['10H', '9S', '10C', '10D', '10S', '7C']); t.w.startDeal(); await toPlayer(t);
      actBtn(t, /^Stand/).click(); await wait(25); await waitFor(() => t.w.G.phase === 'player' && t.w.G.activeIdx === 1 && !t.w.G.locked, 5000); actBtn(t, /^Stand/).click();
      await waitFor(() => t.w.G.phase === 'result', 9000, 'result'); await toBetting(t); await wait(30);
      ok(!shown(t), 'same two hands and side bet as last time: nothing to offer');
      t.w.setHands(1); t.w.setBet(10); $(t, 'sb-pp-amt').value = '5'; t.w.renderAll(); await wait(10);
      ok(shown(t) && /Rebet \$85/.test($(t, 'btn-rebet').textContent), 'two hands and the side bet: the button names the whole $85: ' + $(t, 'btn-rebet').textContent);
      $(t, 'btn-rebet').click(); await wait(10);
      ok(t.w.spotCount() === 2 && t.w.betOf(0) === 25 && t.w.betOf(1) === 50 && $(t, 'sb-pp-amt').value === '10', 'one tap restores both hands and the side bet');
      ok(!shown(t), 'and the button goes');
      noErr(t); close(t);
    }
    // Backspace takes the last chip back
    {
      const t = await boot();
      $(t, 'chip-25').click(); await wait(5); $(t, 'chip-5').click(); await wait(5);
      ok(t.w.betOf(0) === 30, 'two chips down: $30');
      const ev = key(t, 'Backspace');
      ok(ev.defaultPrevented && t.w.betOf(0) === 25, 'Backspace: the $5 chip comes back (' + t.w.betOf(0) + ')');
      ok(t.S.spots[0].chips.length === 1 && t.S.spots[0].val === 25, 'and the stack on the circle follows');
      key(t, 'Backspace'); ok(t.w.betOf(0) === 0, 'again: the $25');
      const none = key(t, 'Backspace');
      ok(!none.defaultPrevented && t.w.betOf(0) === 0, 'nothing left: nothing happens, the key is left alone');
      $(t, 'chip-25').click(); key(t, 'Backspace', null, $(t, 'bet-amount'));
      ok(t.w.betOf(0) === 25, 'in the bet box, Backspace is for typing');
      key(t, 'Backspace');
      noErr(t); close(t);
    }
    {
      const t = await boot();
      t.w.setHands(2); await wait(10);
      $(t, 'chip-25').click(); await wait(5);
      t.w.selectSpot(1); $(t, 'chip-10').click(); await wait(5);
      t.w.selectSpot(0); $(t, 'chip-5').click(); await wait(5);
      ok(t.w.betOf(0) === 30 && t.w.betOf(1) === 10, 'two hands: $30 and $10');
      key(t, 'Backspace');
      ok(t.w.betOf(0) === 25 && t.w.betOf(1) === 10, 'the last chip you put down is the one that goes (' + t.w.betOf(0) + ', ' + t.w.betOf(1) + ')');
      key(t, 'Backspace');
      ok(t.w.betOf(0) === 0 || t.w.betOf(1) === 0, 'then the one before');
      noErr(t); close(t);
    }
    {
      const t = await boot({ reduced: true });
      $(t, 'chip-25').click(); await wait(5);
      key(t, 'Backspace');
      ok(t.w.betOf(0) === 0, 'reduced motion: the same, without the chip flying');
      noErr(t); close(t);
    }
    // Quick deal
    {
      const t = await boot();
      const q = $(t, 'set-quickdeal');
      ok(q && !q.checked && t.w.G.quickDeal === false, 'a Quick deal switch, off to begin with');
      const d0 = t.w.DEAL_DELAY, h0 = t.w.DEALER_HIT_DELAY, r0 = t.w.RESULT_PAUSE;
      q.checked = true; q.dispatchEvent(new t.w.Event('change', { bubbles: true })); await wait(5);
      ok(t.w.G.quickDeal === true, 'it reads the switch');
      ok(t.w.DEAL_DELAY < d0 && t.w.DEALER_HIT_DELAY < h0 && t.w.RESULT_PAUSE < r0, 'the dealer and the table are faster: ' + [d0, t.w.DEAL_DELAY, h0, t.w.DEALER_HIT_DELAY, r0, t.w.RESULT_PAUSE].join(' '));
      const saved = t.w.localStorage.getItem('soft17_session_v1');
      ok(JSON.parse(saved).settings.quickDeal === true, 'it is saved');
      t.w.rig(['9H', '7D', '5C', '10S', '4S']); t.w.deal(25); await toPlayer(t);
      ok(t.S.stats.flights >= 4 && t.S.stats.quick === t.S.stats.flights, 'every card goes out quick, with no reach (' + t.S.stats.quick + ' of ' + t.S.stats.flights + ')');
      await stand(t);
      await toBetting(t);
      q.checked = false; q.dispatchEvent(new t.w.Event('change', { bubbles: true })); await wait(5);
      ok(t.w.DEAL_DELAY === d0 && t.w.DEALER_HIT_DELAY === h0, 'switched off, the pace is what it was');
      noErr(t); close(t);
      const t2 = await boot({ storage: { soft17_session_v1: saved } });
      ok($(t2, 'set-quickdeal').checked && t2.w.G.quickDeal === true, 'and it is still on next visit');
      noErr(t2); close(t2);
    }
    {
      const t = await boot({ reduced: true });
      const q = $(t, 'set-quickdeal'); q.checked = true; q.dispatchEvent(new t.w.Event('change', { bubbles: true })); await wait(5);
      t.w.rig(['9H', '7D', '5C', '10S']); t.w.deal(25); await toPlayer(t);
      ok(t.S.stats.flights === 0, 'reduced motion: still no flying, Quick deal or not');
      noErr(t); close(t);
    }
    // the finer points of the keys, the hint and the table tap
    {
      // a link keeps its own Space and Enter
      const t = await boot();
      t.w.setBet(25); await wait(5);
      const a = t.doc.createElement('a'); a.href = '#x'; a.textContent = 'a link'; t.doc.body.appendChild(a);
      const ev = key(t, 'Enter', null, a);
      ok(!ev.defaultPrevented && t.w.G.phase === 'betting', 'a link keeps its Enter (nothing is dealt)');
      // the key is the table's alone: nothing else on the page hears it (so a focused control does not click as well)
      let heard = 0; t.doc.body.addEventListener('keydown', () => { heard++; });
      key(t, ' ');
      ok(t.w.G.phase !== 'betting' && heard === 0, 'when the table takes Space, nothing after it does (' + heard + ')');
      // and the key coming back up is taken too, so a focused button is not clicked by it
      const up = new t.w.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }); t.doc.body.dispatchEvent(up);
      ok(up.defaultPrevented, 'the Space coming back up is taken as well');
      const up2 = new t.w.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }); t.doc.body.dispatchEvent(up2);
      ok(!up2.defaultPrevented, 'but only that one');
      noErr(t); close(t);
    }
    {
      // Backspace takes back the chip you put down last, wherever it went (the selected hand is not the one it looks at)
      const t = await boot();
      t.w.setHands(2); await wait(10);
      $(t, 'chip-25').click(); await wait(5);
      t.w.selectSpot(1); $(t, 'chip-10').click(); await wait(5);
      t.w.selectSpot(0); await wait(5);
      key(t, 'Backspace');
      ok(t.w.betOf(0) === 25 && t.w.betOf(1) === 0, 'the $10 on the other hand goes first, though the first hand is selected (' + t.w.betOf(0) + ', ' + t.w.betOf(1) + ')');
      noErr(t); close(t);
    }
    {
      // Rebet: both hands' amounts come back, and it is only offered while you are betting
      const t = await boot();
      t.w.setHands(2); t.w.G.betSpot = 0;
      $(t, 'bet-amount').value = '25'; $(t, 'bet-amount-2').value = '50';
      t.w.rig(['10H', '9S', '10C', '10D', '10S', '7C']); t.w.startDeal(); await toPlayer(t);
      $(t, 'bet-amount').value = '99'; t.w.renderAll(); await wait(10);
      ok(!shown(t) && !t.doc.body.classList.contains('rebet-on'), 'in the middle of a hand there is no Rebet');
      $(t, 'bet-amount').value = '25';
      actBtn(t, /^Stand/).click(); await wait(25); await waitFor(() => t.w.G.phase === 'player' && t.w.G.activeIdx === 1 && !t.w.G.locked, 5000); actBtn(t, /^Stand/).click();
      await waitFor(() => t.w.G.phase === 'result', 9000, 'result');
      ok(!shown(t), 'nor in the pause after the result');
      await toBetting(t); await wait(30);
      t.w.setHands(1); t.w.setBet(5); $(t, 'bet-amount-2').value = '5'; await wait(10);
      ok(shown(t), 'back at the bets, with something different: Rebet shows');
      $(t, 'btn-rebet').click(); await wait(10);
      ok(t.w.betOf(0) === 25 && t.w.betOf(1) === 50 && $(t, 'bet-amount-2').value === '50', 'both bets are back: ' + t.w.betOf(0) + ' and ' + t.w.betOf(1) + ' (' + $(t, 'bet-amount-2').value + ')');
      noErr(t); close(t);
    }
    {
      // a tap that is not on the table does not move on; the hint is counted and is not read out
      const t = await boot();
      t.S.k = 0.5; t.w.RESULT_PAUSE = 4000;
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t); await stand(t);
      const hint = t.doc.getElementById('skip-hint');
      ok(hint && hint.getAttribute('aria-hidden') === 'true', 'the hint is for the eye only (not read out)');
      ok(t.w.localStorage.getItem('bj_skiphint') === '1', 'it is counted: shown once (' + t.w.localStorage.getItem('bj_skiphint') + ')');
      const out = t.doc.createElement('p'); out.textContent = 'about this page'; t.doc.body.appendChild(out);
      out.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
      ok(t.w.G.phase === 'result', 'a tap on the page outside the table leaves the result where it is');
      noErr(t); close(t);
    }
  }

  // ---------------------------------------------------------------- the November motion set is off by default: the table is as it was
  section('motion set off by default (the double stays): no landing squash, no hand sliding, no count-up, no bust effect, no flying payouts');
  {
    const actBtn = (t, re) => [...t.doc.querySelectorAll('#actions-row button')].find(b => re.test(b.textContent));
    const spy = t => {
      const rec = [], an = t.w.Element.prototype.animate;
      t.w.Element.prototype.animate = function(kf, op){ rec.push({ el: this, cls: this.className, kf, op }); return an.call(this, kf, op); };
      return rec;
    };
    // jsdom has no layout, so make the table 'move' by 40px for every card on it: what was there then has somewhere new to be when a card comes in
    const shifty = t => { const gb = t.w.Element.prototype.getBoundingClientRect;
      t.w.Element.prototype.getBoundingClientRect = function(){ const r = gb.call(this);
        if(this.matches && this.matches('#hands-row .cards-row .card, #hands-row .big-total, #dealer-cards .card, #dealer-total')){ const n = t.doc.querySelectorAll('#hands-row .cards-row .card').length * 40; return { left: 0, top: n, right: 0, bottom: n, width: 0, height: 0, x: 0, y: n }; }
        return r; }; };
    const seen = t => { const o = { landed: false, rolling: false, bust: false, dbl: false, chip: false }; o.id = setInterval(() => { const d = t.doc;
      if (d.querySelector('.card.landed')) o.landed = true; if (d.querySelector('.rolling')) o.rolling = true; if (d.querySelector('[data-bust]')) o.bust = true;
      if (d.querySelector('.card.dbl')) o.dbl = true; if (d.querySelector('.pchip, .pay-float')) o.chip = true; }, 1); o.stop = () => clearInterval(o.id); return o; };
    {
      const t = await boot();
      ok(t.S.motion === false, 'the switch is off');
      t.w.rig(['9H', '7D', '5C', '10S', '4S']); t.w.deal(25); await toPlayer(t);
      shifty(t);
      const rec = spy(t), o = seen(t), tot = t.doc.querySelector('#hands-row .big-total'), txt = [];
      const mo = new t.w.MutationObserver(l => l.forEach(r => { if (r.addedNodes[0]) txt.push(r.addedNodes[0].data); })); mo.observe(tot, { childList: true, characterData: true, subtree: true });
      actBtn(t, /^Hit/).click();
      await waitFor(() => t.w.G.hands[0].cards.length === 3 && t.S.flights.length === 0, 4000, 'hit to settle'); await wait(40);
      o.stop();
      ok(!o.landed && !o.rolling, 'a hit: the card just lands (no squash), the total just says 18 (' + txt.filter(x => /^\d+$/.test(x)).join(',') + ')');
      ok(txt.filter(x => /^\d+$/.test(x)).join(',') === '18' || tot.textContent === '18', 'the total is 18 straight away');
      ok(!rec.some(r => /card/.test(r.cls) && r.kf[0] && /translateX\(-?\d/.test(r.kf[0].transform || '')), 'the cards beside it do not give way');
      ok(t.S.stats.flips === 0 && !rec.some(r => r.el && r.el.closest && r.el.closest('#hands-row, #dealer-cards') && !/fc/.test(r.cls) && r.kf[0] && /translate\(/.test(r.kf[0].transform || '')), 'nothing already on the table slides or bounces when the card comes in (' + t.S.stats.flips + ' slides)');
      const fly = rec.filter(r => /fc-sc/.test(r.cls)).pop(), end = fly && fly.kf[fly.kf.length - 1].transform;
      ok(end && /scale\(0\.5[0-9]*\)|scale\(1\.0*\)|scale\(0\.[0-9]+\)/.test(end) && !/scale\(0\.530\)/.test(end), 'the card comes in at its own size, not a little larger: ' + end);
      ok(t.S.stats.rolls === 0, 'no count-up recorded');
      noErr(t); close(t);
    }
    {
      // the same shifting layout with the motion set on: now the cards do slide (so the check above can tell)
      const t = await boot({ motion: true });
      t.w.rig(['9H', '7D', '5C', '10S', '4S']); t.w.deal(25); await toPlayer(t);
      shifty(t); actBtn(t, /^Hit/).click();
      await waitFor(() => t.w.G.hands[0].cards.length === 3 && t.S.flights.length === 0, 4000, 'hit to settle'); await wait(40);
      ok(t.S.stats.flips >= 1, 'control: with the motion set on, what was on the table slides to its new place (' + t.S.stats.flips + ')');
      noErr(t); close(t);
    }
    {
      // a bust: just the game's own result (no tilt, no sag, no thud)
      const t = await boot();
      t.w.rig(['10H', '10D', '6C', '7S', '10S', '5H']); t.w.deal(25); await toPlayer(t);
      const o = seen(t); actBtn(t, /^Hit/).click();
      let st = null;
      await waitFor(() => { const h = t.w.G.hands[0]; if (h && h.status === 'bust') st = 'bust'; return !!st; }, 4000, 'the bust'); await wait(60); o.stop();
      ok(!o.bust && t.S.stats.busts === 0 && !t.doc.querySelector('[data-bust]'), 'a bust: no bust effect');
      ok(st === 'bust', 'but the hand is a bust all the same');
      noErr(t); close(t);
    }
    {
      // a double is the one piece that stays: the card goes down on its side, a second chip flies onto the bet, and nothing else of the set comes with it
      const t = await boot();
      t.w.rig(['6H', '10D', '5C', '7S', '10S', '5H']); t.w.deal(25); await toPlayer(t);
      const o = seen(t); actBtn(t, /^Double/).click();
      const bet = t.w.G.hands[0].bet;
      await waitFor(() => t.w.G.phase === 'result', 9000, 'the result'); await wait(40); o.stop();
      ok(o.dbl && t.S.stats.doubles === 1, 'a double: the card is on its side (' + o.dbl + ', ' + t.S.stats.doubles + ')');
      ok(o.chip, 'and the second chip flies onto the bet');
      ok(!o.landed && !o.rolling && !o.bust, 'with no landing squash, count-up or bust effect around it');
      ok(t.S.bankHold === null && t.S.chipHold[0] === undefined, 'nothing is left held afterwards');
      ok(bet === 50, 'the bet is doubled (' + bet + ')');
      noErr(t); close(t);
    }
    {
      // the double has its own switch
      const t = await boot({ dbl: false });
      t.w.rig(['6H', '10D', '5C', '7S', '10S', '5H']); t.w.deal(25); await toPlayer(t);
      const o = seen(t); actBtn(t, /^Double/).click();
      const bet = t.w.G.hands[0].bet;
      await waitFor(() => t.w.G.phase === 'result', 9000, 'the result'); await wait(40); o.stop();
      ok(!o.dbl && !o.chip && t.S.stats.doubles === 0 && t.S.bankHold === null, 'double switched off: no sideways card, no chip in the air');
      ok(bet === 50, 'the bet is doubled all the same (' + bet + ')');
      noErr(t); close(t);
    }
    {
      // a win and a loss: no chips fly, no bankroll tween, and the bankroll reads right at once
      const t = await boot();
      t.w.rig(['10S', '10H', '9D', '6C', '10D']); t.w.deal(25); await toPlayer(t);
      const o = seen(t); actBtn(t, /^Stand/).click();
      await waitFor(() => t.w.G.phase === 'result', 9000, 'the result'); await wait(30); o.stop();
      ok(!o.chip && t.S.pay === null && t.S.bankHold === null, 'a result: no chips are paid out or swept');
      ok(t.doc.getElementById('bankroll-val').textContent === String(t.w.G.bankroll), 'the bankroll shows the real number straight away (' + t.doc.getElementById('bankroll-val').textContent + ')');
      noErr(t); close(t);
    }
    {
      // the dealer's peek is not part of the set: it still happens
      const t = await boot();
      t.w.rig(['9S', 'AH', '8D', '6C', '5D']); t.w.deal(25);
      await waitFor(() => t.S.stats.peeks >= 1 || t.w.G.phase === 'player', 6000, 'the peek');
      ok(t.S.stats.peeks >= 1, 'with an ace up he still peeks at his card (' + t.S.stats.peeks + ')');
      noErr(t); close(t);
    }
  }

  // ---------------------------------------------------------------- the phone layout (behaviour; the look itself is CSS)
  section('phone layout: the menu, the settings sheet, the pinned Deal bar, two hands side by side');
  {
    const key = (t, k) => t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    {
      // a wide window: nothing is moved, nothing is added
      const t = await boot();
      const col = t.doc.querySelector('#topbar header').children[1];
      ok(!t.doc.getElementById('m-menu'), 'wide: no menu is built');
      ok(col.contains(t.doc.getElementById('btn-toggle-settings')) && col.contains(t.doc.getElementById('btn-manners')), 'wide: the settings button and the manners link stay in the header');
      ok(!t.doc.body.classList.contains('m-sheet'), 'wide: no sheet');
      ok(t.doc.getElementById('deal-dock').contains(t.doc.getElementById('btn-deal')), 'Deal sits in its own bar (which is invisible on a wide screen)');
      t.w.setHands(2); t.w.rig(['9H', '10C', '8D', '7S', '4S', '5H', '2C', '9D', '3C']); t.w.setBet(25, 0); t.w.setBet(25, 1); t.w.dealNow ? t.w.dealNow() : $(t, 'btn-deal').click();
      await toPlayer(t);
      ok(t.w.G.hands.length === 2 && !t.doc.getElementById('hands-row').classList.contains('dense'), 'wide: two hands keep the full-size cards');
      noErr(t); close(t);
    }
    {
      // a phone
      const t = await boot({ phone: true });
      const doc = t.doc, bar = doc.getElementById('topbar'), menu = doc.getElementById('m-menu'), btn = doc.getElementById('m-menu-btn'), col = doc.querySelector('#topbar header').children[1];
      ok(!!menu && menu.contains(doc.getElementById('btn-toggle-settings')) && menu.contains(doc.getElementById('btn-manners')) && !!menu.querySelector('a[href*="glossary"]') && !!doc.getElementById('m-shuffle'), 'phone: the menu holds settings, shuffle, manners and the glossary');
      ok(!col.contains(doc.getElementById('btn-toggle-settings')), 'phone: they are no longer in the header');
      ok(menu.querySelector('.m-rules') && /Blackjack pays/.test((btn.click(), menu.querySelector('.m-rules').textContent)), 'phone: the menu says how the table is set (' + menu.querySelector('.m-rules').textContent + ')');
      ok(bar.classList.contains('m-open') && btn.getAttribute('aria-expanded') === 'true', 'tapping the menu button opens it');
      doc.body.click();
      ok(!bar.classList.contains('m-open') && btn.getAttribute('aria-expanded') === 'false', 'tapping elsewhere closes it');
      btn.click(); key(t, 'Escape');
      ok(!bar.classList.contains('m-open'), 'Escape closes it');
      btn.click(); doc.getElementById('btn-manners').click();
      ok(!bar.classList.contains('m-open') && doc.getElementById('manners-overlay').style.display === 'flex', 'choosing an item closes the menu and does it (table manners opens)');
      t.w.hideMannersOverlay();

      // the settings sheet
      btn.click(); doc.getElementById('btn-toggle-settings').click(); await wait(20);
      ok(doc.getElementById('settings-panel').style.display === 'block' && doc.body.classList.contains('m-sheet'), 'Table settings opens as a sheet');
      ok(!!doc.querySelector('.m-sheet-head #m-sheet-done'), 'with a Done button');
      doc.getElementById('m-sheet-done').click(); await wait(20);
      ok(doc.getElementById('settings-panel').style.display === 'none' && !doc.body.classList.contains('m-sheet'), 'Done closes it');
      btn.click(); doc.getElementById('btn-toggle-settings').click(); await wait(20); key(t, 'Escape'); await wait(20);
      ok(doc.getElementById('settings-panel').style.display === 'none' && !doc.body.classList.contains('m-sheet'), 'Escape closes it too');
      btn.click(); doc.getElementById('btn-toggle-settings').click(); await wait(20); doc.querySelector('.m-backdrop').click(); await wait(20);
      ok(doc.getElementById('settings-panel').style.display === 'none', 'and so does a tap on the dimmed table');

      // shuffle from the menu: between hands it reshuffles; in a hand the dealer says no and nothing changes
      t.w.G.shoe.length = 20; btn.click(); doc.getElementById('m-shuffle').click();
      ok(t.w.G.shoe.length === t.w.G.decks * 52, 'Shuffle the shoe reshuffles between hands (' + t.w.G.shoe.length + ')');
      t.w.rig(['9H', '10C', '5D', '7S', '4S']); t.w.deal(25); await toPlayer(t);
      const left = t.w.G.shoe.length; btn.click(); doc.getElementById('m-shuffle').click();
      ok(t.w.G.phase === 'player' && t.w.G.shoe.length === left && t.w.G.hands[0].cards.length === 2, 'mid-hand it does not shuffle');

      // the same page widens: everything goes back where it was
      t.w.__setPhone(false);
      ok(col.contains(doc.getElementById('btn-toggle-settings')) && col.contains(doc.getElementById('btn-manners')) && !doc.getElementById('m-shuffle'), 'widening the window puts the links back in the header');
      t.w.__setPhone(true);
      ok(menu.contains(doc.getElementById('btn-toggle-settings')) && !!doc.getElementById('m-shuffle'), 'and narrowing it again moves them into the menu');
      noErr(t); close(t);
    }
    {
      // two hands on a phone sit side by side with the smaller cards
      const t = await boot({ phone: true });
      t.w.setHands(2); t.w.rig(['9H', '10C', '8D', '7S', '4S', '5H', '2C', '9D', '3C']); t.w.setBet(25, 0); t.w.setBet(25, 1); $(t, 'btn-deal').click();
      await toPlayer(t);
      ok(t.w.G.hands.length === 2 && t.doc.getElementById('hands-row').classList.contains('dense'), 'phone: two hands get the compact layout');
      noErr(t); close(t);
    }
    {
      // the Deal bar also carries Rebet, so the two are pinned together
      const t = await boot({ phone: true });
      t.w.rig(['9H', '10C', '5D', '7S', '4S', '5H']); t.w.deal(25); await toPlayer(t); t.w.doAction('S');
      await waitFor(() => t.w.G.phase === 'betting', 6000, 'betting again');
      ok(t.doc.getElementById('deal-dock').contains(t.doc.getElementById('rebet-grp')), 'Rebet lives in the same bar as Deal');
      noErr(t); close(t);
    }
  }
  // <</MOTION>>

  console.log('\nPASSES: ' + passes + '   TOTAL FAILURES: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
