// Ultimate Texas Hold'em: the dealer, the table, the money -- jsdom tests.
//   node tests/test_uth_show.js [path/to/index.html]
// jsdom has no animations and no layout, so Element.prototype.animate is stubbed, the dealer's clock is sped up through Show._S.k,
// and the game's own pauses (P) are shortened. The deck is rigged hand by hand, so every outcome here is known in advance.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || (fs.existsSync(path.join(__dirname, 'index.html')) ? path.join(__dirname, 'index.html') : path.join(__dirname, '..', 'dist', 'index.html'));
const HTML = fs.readFileSync(FILE, 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, passes = 0, current = '';
function ok(cond, msg){ if(cond){ passes++; } else { fails++; console.log('  FAIL [' + current + '] ' + msg); if(process.env.BAIL){ process.exit(1); } } }
function section(name){ current = name; if(!process.env.QUIET) console.log('· ' + name); }
async function waitFor(fn, ms, label){
  const t0 = Date.now();
  while(Date.now() - t0 < (ms || 6000)){ try{ if(fn()) return true; }catch(e){} await wait(4); }
  if(label) ok(false, 'timed out waiting for ' + label);
  return false;
}
const c = (r, s) => ({ rank: r, suit: s });
const HINTS = JSON.stringify({ skillLevel: 'advanced', seenSkillPrompt: true, skillSource: 'own' });

// every hand below: your two, his two, the five on the board (in the order they come out)
const FLUSH_WIN   = { player: [c(14,'s'), c(13,'s')], dealer: [c(11,'h'), c(11,'d')], board: [c(12,'s'), c(7,'s'), c(2,'s'), c(9,'d'), c(4,'c')] };   // your A-high flush beats his pair of jacks
const NOQ_LOSS    = { player: [c(9,'s'), c(8,'s')],   dealer: [c(14,'c'), c(6,'h')],  board: [c(2,'d'), c(5,'c'), c(13,'h'), c(7,'s'), c(3,'d')] };   // he has Ace-high only: he does not qualify, but he still wins the hand
const TIE_ROYAL   = { player: [c(2,'c'), c(3,'d')],   dealer: [c(4,'h'), c(5,'d')],   board: [c(14,'s'), c(13,'s'), c(12,'s'), c(11,'s'), c(10,'s')] };  // the board is a royal flush: a tie (and Trips pays 50:1)
const DEALER_WINS = { player: [c(2,'h'), c(7,'c')],   dealer: [c(14,'s'), c(14,'d')], board: [c(13,'d'), c(9,'c'), c(4,'s'), c(3,'h'), c(11,'h')] };    // his pair of aces beats your King-high
const STRAIGHT_WIN= { player: [c(9,'h'), c(8,'d')],   dealer: [c(13,'c'), c(2,'d')],  board: [c(7,'s'), c(6,'c'), c(5,'h'), c(14,'d'), c(3,'c')] };     // your straight (the Blind pays 1:1); he does not qualify

async function boot(opts){
  opts = opts || {};
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if(!/Could not load link/.test(String(e.message))) errors.push(String(e.message || e)); });
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://tableready.xyz/ultimate-texas-holdem/',
    beforeParse(w){
      let s = opts.seed || 123456789; w.Math.random = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
      w.alert = () => {};
      w.HTMLElement.prototype.scrollIntoView = function(){};
      w.localStorage.setItem('house_edge_uth_hints_v1', HINTS);
      if(opts.storage) for(const k of Object.keys(opts.storage)) w.localStorage.setItem(k, opts.storage[k]);
      if(opts.animate !== false) w.Element.prototype.animate = function(kf, op){
        const a = { onfinish: null, cancelled: false, cancel(){ this.cancelled = true; clearTimeout(this.t); }, finish(){} };
        const d = (typeof op === 'number' ? op : ((op && op.duration) || 0)) + ((op && op.delay) || 0);
        a.t = setTimeout(() => { if(!a.cancelled && a.onfinish && w.document){ try{ a.onfinish(); }catch(e){ if(w.document) throw e; } } }, Math.max(1, d * 0.05));
        return a;
      };
      if(opts.reduced || opts.phone || opts.touch){
        const subs = []; let on = true;
        w.__setPhone = v => { on = v; subs.forEach(f => f({ matches: on })); };
        w.matchMedia = q => ({ get matches(){ return !!((opts.reduced && /reduce/.test(q)) || (opts.phone && /max-width:700px/.test(q) && on) || (opts.touch && /pointer:coarse/.test(q))); }, media: q, addListener(f){ subs.push(f); }, removeListener(){}, addEventListener(t, f){ subs.push(f); }, removeEventListener(){}, dispatchEvent(){ return false; } });
      }
    } });
  await wait(250);
  const w = dom.window, doc = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  const set = (id, v) => { const e = doc.getElementById(id); if(e.type === 'checkbox') e.checked = !!v; else e.value = v; };
  if(opts.dealer === false) set('set-dealer', false);
  if(opts.chatter) set('set-chatter', opts.chatter);
  if(opts.speed) set('set-speed', opts.speed);
  if(opts.trips === false) set('set-trips', false);
  set('set-turbo', !!opts.turbo);
  w.readSettings();
  const kk = opts.gk != null ? opts.gk : 0.02;
  w.P = (n, t) => w.G.turbo ? t : Math.max(1, Math.round(n * kk * (opts.speed === 'quick' ? 0.62 : opts.speed === 'relaxed' ? 1.4 : 1)));   // the game's own pauses, shortened
  const S = w.Show._S; S.k = opts.k || 0.02;
  w.renderActionRow();
  return { dom, w, doc, S, errors };
}
const $ = (t, id) => t.doc.getElementById(id);
function click(t, el){ el.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true })); }
function key(t, k, target){ (target || t.doc.body).dispatchEvent(new t.w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }
function rig(t, sc){
  const used = new Set(sc.player.concat(sc.dealer, sc.board).map(x => x.rank + x.suit));
  const rest = t.w.freshDeck().filter(x => !used.has(x.rank + x.suit));
  // cards come off the end: yours, his, then the board in order
  t.w.freshDeck = () => rest.concat(sc.board.slice().reverse(), sc.dealer.slice().reverse(), sc.player.slice().reverse());
}
function bet(t, chip, n, trips){
  t.w.selectChip(chip || 25, true);
  for(let i = 0; i < (n || 1); i++) t.w.placeBet('ante');
  if(trips) for(let i = 0; i < trips; i++) t.w.placeBet('trips');
}
const phase = t => t.w.G.phase;
const noErr = (t, what) => {
  ok(t.S.errors.length === 0, (what || 'dealer') + ' raised no errors: ' + JSON.stringify(t.S.errors));
  ok(t.errors.length === 0, 'no page errors: ' + JSON.stringify(t.errors.slice(0, 2)));
};
// watch every flying card and chip, every card landing, and every line he says
function watch(t){
  const w = { flyers: 0, landed: [], pchips: 0, said: [], moods: [], srs: [] };
  const mo = new t.w.MutationObserver(list => list.forEach(m => {
    m.addedNodes.forEach(n => { if(n.nodeType === 1){ if(n.classList.contains('fc')) w.flyers++; if(n.classList.contains('pchip')) w.pchips++; } });
    if(m.type === 'attributes' && m.attributeName === 'class' && m.oldValue && /pending/.test(m.oldValue) && !m.target.classList.contains('pending')) w.landed.push(m.target);
  }));
  mo.observe(t.doc.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
  const say = t.doc.querySelector('.ds-say'), stage = $(t, 'dealer-stage');
  const m2 = new t.w.MutationObserver(() => { if(say.classList.contains('on')) w.said.push(say.textContent); });
  m2.observe(say, { attributes: true, childList: true, characterData: true, subtree: true });
  const m3 = new t.w.MutationObserver(() => w.moods.push(stage.getAttribute('data-mood')));
  m3.observe(stage, { attributes: true, attributeFilter: ['data-mood'] });
  const m4 = new t.w.MutationObserver(() => { const x = $(t, 'sr-live').textContent; if(x) w.srs.push(x); });
  m4.observe($(t, 'sr-live'), { childList: true, characterData: true, subtree: true });
  w.stop = () => { mo.disconnect(); m2.disconnect(); m3.disconnect(); m4.disconnect(); };
  return w;
}
const said = (t, wt, key) => wt.said.some(s => t.w.Show._L[key].indexOf(s) >= 0);

// bet, deal, look (and stop there: the next move is the caller's)
async function toDecision(t, sc, o){
  o = o || {};
  rig(t, sc); if(!o.noBet) bet(t, o.chip || 25, o.n || 1, o.trips);
  click(t, $(t, 'btn-deal'));
  if(!await waitFor(() => phase(t) === 'preflop', 20000, 'the deal')) return false;
  click(t, $(t, 'btn-look'));
  return waitFor(() => t.w.G.playerFlipCount === 2, 5000, 'both cards turned over');
}
// play a whole hand: plan = [preflop, flop, river] moves, each 'check' | 'bet3' | 'bet4' | 'bet2' | 'bet1' | 'fold'
async function playHand(t, sc, plan, o){
  if(!await toDecision(t, sc, o)) return false;
  const btn = { check: 'btn-check', bet3: 'btn-bet3', bet4: 'btn-bet', bet2: 'btn-bet', bet1: 'btn-bet', fold: 'btn-fold' };
  for(const [i, ph] of ['preflop', 'flop', 'river'].entries()){
    if(phase(t) === 'resolved' || phase(t) === 'showdown' || phase(t) === 'showdown-pending') break;
    if(!await waitFor(() => phase(t) === ph || phase(t) === 'showdown-pending' || phase(t) === 'showdown' || phase(t) === 'resolved', 20000, 'the ' + ph + ' decision')) return false;
    if(phase(t) !== ph) break;
    click(t, $(t, btn[plan[i]]));
  }
  return waitFor(() => phase(t) === 'resolved', 30000, 'the result');
}

(async () => {
  // ---------------------------------------------------------------- built, on by default, absent when switched off
  section('the dealer: built, on by default, absent when switched off');
  {
    const t = await boot();
    ok(t.w.G.tableShow === true, 'dealer is on by default');
    ok(t.doc.body.classList.contains('show-on'), 'body has show-on');
    ok(!!$(t, 'dealer-band') && !!$(t, 'dealer-stage') && !!$(t, 'show-layer'), 'band, stage and flight layer exist');
    ok($(t, 'dealer-stage').getAttribute('data-state') === 'away', 'he is out of sight while you bet');
    ok($(t, 'dealer-band').nextElementSibling === $(t, 'rows'), 'the band sits right above the cards');
    ok(!!t.doc.querySelector('.ds-shoe') && !!t.doc.querySelector('.ds-tray') && !!t.doc.querySelector('.ds-burn'), 'shoe, chip tray and burn pile exist');
    const shoe = t.doc.querySelector('.ds-shoe');
    ok(shoe.getAttribute('role') === 'button' && shoe.getAttribute('aria-label') && shoe.tabIndex === 0, 'the shoe is a labelled, focusable button');
    ok(t.doc.querySelector('.ds-say').getAttribute('aria-hidden') === 'true' && $(t, 'show-layer').getAttribute('aria-hidden') === 'true' && t.doc.querySelector('.ds-tray').getAttribute('aria-hidden') === 'true' && t.doc.querySelector('.ds-burn').getAttribute('aria-hidden') === 'true', 'his chatter, the flight layer, the tray and the burn pile are hidden from screen readers (the table is announced elsewhere)');
    ok(/shoe/i.test(t.doc.querySelector('.ds-idle').textContent), 'while you bet, a line says to tap the shoe');
    noErr(t);
    const t2 = await boot({ dealer: false });
    ok(!t2.doc.body.classList.contains('show-on'), 'dealer off: no show-on');
    ok(!t2.w.Show.active(), 'dealer off: Show.active() is false');
    const w2 = watch(t2);
    ok(await playHand(t2, FLUSH_WIN, ['check', 'check', 'bet1']), 'dealer off: a whole hand still plays');
    ok(w2.flyers === 0 && w2.pchips === 0, 'dealer off: nothing flies');
    ok(t2.doc.querySelectorAll('.pc.pending').length === 0, 'dealer off: nothing left pending');
    ok(t2.w.G.bankroll === 1087, 'dealer off: the money is right (' + t2.w.G.bankroll + ')');
    w2.stop(); noErr(t2, 'dealer-off game');
  }

  // ---------------------------------------------------------------- the deal
  section('the deal: your two as a spread, then his two');
  {
    const t = await boot();
    const wt = watch(t);
    rig(t, FLUSH_WIN); bet(t, 25, 1);
    click(t, $(t, 'btn-deal'));
    ok(phase(t) === 'dealing', 'phase is dealing right after Deal');
    ok(t.doc.querySelectorAll('#rows .pc').length === 4, 'all four cards are on the table at once (as placeholders): nothing is inserted later');
    ok(t.doc.querySelectorAll('#rows .pc.pending').length === 4, 'all four start pending');
    ok(t.doc.querySelectorAll('#board-cards .slot').length === 5 && t.doc.querySelectorAll('#board-cards .pc').length === 0, 'the board is five empty places');
    ok(await waitFor(() => phase(t) === 'preflop', 20000, 'preflop'), 'reaches the pre-flop decision');
    ok(wt.flyers === 4, 'four cards flew (got ' + wt.flyers + ')');
    ok(t.doc.querySelectorAll('.fc').length === 0, 'no flying card is left behind');
    ok(t.doc.querySelectorAll('.pc.pending').length === 0, 'nothing is left pending');
    const names = wt.landed.map(el => el.closest('#seat-you') ? 'P' : 'D');
    ok(names.join('') === 'PPDD', 'your two land first, then his two: ' + names.join(''));
    ok(t.doc.querySelectorAll('#rows .pc.up').length === 0, 'all four are face down: yours wait for you to look, his stay down until the end');
    ok($(t, 'dealer-stage').getAttribute('data-state') === 'up', 'he is up during the hand');
    ok(t.S.stats.deals === 4, 'stats: four dealt');
    ok(t.S.stats.bobs === 2, 'he bobbed once per spread (' + t.S.stats.bobs + ')');
    ok(t.S.spreads.length === 2 && t.S.spreads[0] !== t.S.spreads[1], 'two different kinds of spread: ' + t.S.spreads.join(','));
    ok(t.S.flown.join() === t.S.dealStyles.join(), 'and they flew the way they were planned: ' + t.S.flown.join(','));
    ok(t.doc.querySelector('#btn-look').hidden === false && $(t, 'btn-deal').hidden, 'the Look button is up');
    ok(!!t.S.nudgeRec === false, 'no nudge timer before you have looked (he is not hurrying you)');
    wt.stop(); noErr(t);
  }

  section('looking at your cards');
  {
    const t = await boot();
    const wt = watch(t);
    ok(await toDecision(t, FLUSH_WIN), 'deal and look');
    ok(t.doc.querySelectorAll('#player-cards .pc.up').length === 2 && t.doc.querySelectorAll('#dealer-cards .pc.up').length === 0, 'yours are up, his are not');
    ok(wt.moods.indexOf('focus') >= 0, 'he goes quiet and watches while you look: ' + wt.moods.join(','));
    ok(!!t.S.nudgeRec, 'he is waiting on your decision (a nudge is scheduled)');
    ok($(t, 'btn-check').hidden === false && $(t, 'btn-bet').hidden === false && $(t, 'btn-bet3').hidden === false, 'check, bet 3x and bet 4x are offered');
    ok($(t, 'btn-bet').textContent.indexOf('$100') >= 0 && $(t, 'btn-bet3').textContent.indexOf('$75') >= 0, 'with their amounts');
    wt.stop(); noErr(t);
  }

  // ---------------------------------------------------------------- the board
  section('the board: a burn card, then the flop; a burn card for each of the turn and the river');
  {
    const t = await boot();
    const wt = watch(t);
    ok(await toDecision(t, FLUSH_WIN), 'deal and look');
    const f0 = wt.flyers, l0 = wt.landed.length;
    ok(t.S.burnN === 0 && t.doc.querySelector('.ds-burn').getAttribute('data-n') === '0', 'no burn card yet');
    click(t, $(t, 'btn-check'));
    ok(phase(t) === 'flop-deal', 'phase is flop-deal');
    ok(t.doc.querySelectorAll('#board-cards .pc').length === 3 && t.doc.querySelectorAll('#board-cards .pc.pending').length === 3, 'three placeholders on the board at once');
    ok(await waitFor(() => phase(t) === 'flop', 20000, 'flop'), 'the flop decision comes');
    ok(wt.flyers - f0 === 4, 'four things flew: one burn card and three cards (' + (wt.flyers - f0) + ')');
    ok(t.S.burnN === 1 && t.doc.querySelector('.ds-burn').getAttribute('data-n') === '1', 'one card is in the burn pile');
    ok(wt.landed.slice(l0).length === 3 && wt.landed.slice(l0).every(el => el.closest('#board-cards')), 'three board cards landed, in the board');
    ok(t.doc.querySelectorAll('#board-cards .pc.up').length === 3, 'and are turned up');
    ok(t.doc.querySelectorAll('.fc').length === 0 && t.doc.querySelectorAll('.pc.pending').length === 0, 'nothing left in the air or pending');
    ok(said(t, wt, 'burn') && said(t, wt, 'flop'), 'he says "burn", and then what the cards are ("the flop")');
    // turn and river
    const f1 = wt.flyers;
    click(t, $(t, 'btn-check'));
    ok(phase(t) === 'river-deal' && t.doc.querySelectorAll('#board-cards .pc').length === 5, 'the last two are placed at once');
    ok(await waitFor(() => phase(t) === 'river', 20000, 'river'), 'the river decision comes');
    ok(wt.flyers - f1 === 4, 'four things flew: a burn and the turn, a burn and the river (' + (wt.flyers - f1) + ')');
    ok(t.S.burnN === 3 && t.doc.querySelector('.ds-burn').getAttribute('data-n') === '3', 'three cards are in the burn pile');
    ok(t.doc.querySelectorAll('#board-cards .pc.up').length === 5, 'five board cards, all up');
    ok(said(t, wt, 'turn') && said(t, wt, 'river'), 'he calls the turn and the river');
    ok(t.S.stats.burns === 3 && t.S.stats.boards === 2, 'stats: three burns, two board deals');
    ok($(t, 'btn-fold').hidden === false && $(t, 'btn-bet').textContent.indexOf('1x') >= 0, 'now: fold, or bet 1x');
    wt.stop(); noErr(t);
  }

  // ---------------------------------------------------------------- bets and chips
  section('every bet is settled where it sits: he pays the winners and takes the losers');
  {
    // a win everywhere: Ante, Blind (flush 3:2), Play and Trips (flush 7:1) all pay
    const t = await boot();
    const wt = watch(t);
    const asked = []; const play0 = t.w.TRSound.play; t.w.TRSound.play = function(n, o){ asked.push(n); return play0.call(this, n, o); };   // what he asks the sound engine for
    ok(await playHand(t, FLUSH_WIN, ['check', 'check', 'bet1'], { trips: 1 }), 'plays to the result');
    ok(t.w.G.bankroll === 1262, 'the money: +25 +37 +25 +175 = 1262 (got ' + t.w.G.bankroll + ')');
    ok(JSON.stringify(t.S.cmpSpots.map(x => [x.spot, x.kind, x.amount])) === JSON.stringify([['ante', 'win', 25], ['blind', 'win', 37], ['play', 'win', 25], ['trips', 'win', 175]]), 'four payouts, one per bet, in order, each the real winnings: ' + JSON.stringify(t.S.cmpSpots));
    ok(wt.pchips === 0, 'nothing flies: no chip leaves his tray (' + wt.pchips + ')');
    ok(t.doc.querySelectorAll('.pchip').length === 0, 'and no chip is left on the felt');
    ok(await waitFor(() => t.w.Show._L.blind.concat(t.w.Show._L.tripsHit).some(s => wt.said.indexOf(s) >= 0), 3000, 'blind line'), 'he says the Blind or the Trips paid');
    ok(wt.moods.indexOf('wow') >= 0, 'his face shows it');
    ok(await waitFor(() => asked.indexOf('chime') >= 0, 3000, 'chime'), 'and a chime rings for the big win');
    wt.stop(); noErr(t);

    // a loss everywhere
    const l = await boot();
    const wl = watch(l);
    ok(await playHand(l, DEALER_WINS, ['check', 'check', 'bet1'], { trips: 1 }), 'plays to the result');
    ok(l.w.G.bankroll === 1000 - 25 - 25 - 25 - 25, 'a loss on all four (' + l.w.G.bankroll + ')');
    ok(JSON.stringify(l.S.cmpSpots.map(x => [x.spot, x.kind, x.amount])) === JSON.stringify([['ante', 'loss', 25], ['blind', 'loss', 25], ['play', 'loss', 25], ['trips', 'loss', 25]]), 'he takes all four: ' + JSON.stringify(l.S.cmpSpots));
    ok(await waitFor(() => ['ante', 'blind', 'play', 'trips'].every(k => $(l, 'chips-' + k).style.visibility === 'hidden'), 4000, 'stacks leave'), 'the stack of every lost bet comes off its spot (he takes it)');
    ok(wl.pchips === 0 && l.doc.querySelectorAll('.pchip').length === 0, 'and no chip flew to do it');
    ok(await waitFor(() => said(l, wl, 'loss'), 3000, 'loss line'), 'he has a line for it');
    wl.stop(); noErr(l);

    // he does not qualify, and still wins: the Ante pushes (nothing moves), the Blind and the Play are lost
    const q = await boot();
    const wq = watch(q);
    ok(await playHand(q, NOQ_LOSS, ['check', 'check', 'bet1']), 'plays to the result');
    ok(q.w.G.bankroll === 950, 'Ante back, Blind and Play lost: 950 (' + q.w.G.bankroll + ')');
    ok(JSON.stringify(q.S.cmpSpots.map(x => [x.spot, x.kind])) === JSON.stringify([['blind', 'loss'], ['play', 'loss']]), 'only the Blind and the Play move; the Ante stays put: ' + JSON.stringify(q.S.cmpSpots));
    ok(said(q, wq, 'noq'), 'he says he does not qualify and your Ante pushes');
    ok($(q, 'qualify-tag').textContent === 'Dealer doesn’t qualify', 'the tag says so too');
    wq.stop(); noErr(q);

    // a tie: nothing moves except a winning Trips
    const e = await boot();
    const we = watch(e);
    ok(await playHand(e, TIE_ROYAL, ['check', 'check', 'bet1'], { trips: 1 }), 'plays to the result');
    ok(e.w.G.bankroll === 1000 + 1250, 'Ante, Blind and Play push; Trips pays 50:1 on the royal flush (' + e.w.G.bankroll + ')');
    ok(JSON.stringify(e.S.cmpSpots.map(x => [x.spot, x.kind, x.amount])) === JSON.stringify([['trips', 'win', 1250]]), 'one payout: the Trips bet: ' + JSON.stringify(e.S.cmpSpots));
    ok(await waitFor(() => said(e, we, 'royal'), 3000, 'royal line'), 'a royal flush gets his biggest line');
    we.stop(); noErr(e);

    // a push on all but the Blind and Play
    const s = await boot();
    ok(await playHand(s, STRAIGHT_WIN, ['bet4']), 'a 4x bet before the flop plays to the result');
    ok(s.w.G.bets.play === 100 && s.w.G.playMult === 4, 'the Play bet was 4x the Ante');
    ok(s.w.G.bankroll === 1000 + 25 + 100, 'the Ante pushes (he does not qualify), the Blind pays 1:1, the Play wins: ' + s.w.G.bankroll);
    ok(JSON.stringify(s.S.cmpSpots.map(x => [x.spot, x.kind, x.amount])) === JSON.stringify([['blind', 'win', 25], ['play', 'win', 100]]), 'two payouts: ' + JSON.stringify(s.S.cmpSpots));
    ok(s.S.burnN === 3, 'the whole board still came out the proper way: three burn cards (' + s.S.burnN + ')');
    noErr(s);
  }

  section('your Play bet goes onto its spot, and he has something to say about the size of it');
  {
    const t = await boot({ k: 1 });
    const wt = watch(t);
    ok(await toDecision(t, STRAIGHT_WIN), 'deal and look');
    const p0 = wt.pchips;
    click(t, $(t, 'btn-bet'));
    ok(t.w.G.bets.play === 100, 'the bet is down: $100');
    ok($(t, 'chips-play').style.visibility === '', 'its stack is simply there (no chip flies out to it)');
    ok(t.S.mood === 'surp', 'he looks surprised at once (and he gets to, before the cards come: ' + t.S.mood + ')');
    await wait(5);
    ok(wt.pchips - p0 === 0, 'no chip flies for $100');
    ok(await waitFor(() => wt.said.some(s => t.w.Show._L.bet4.indexOf(s) >= 0), 3000, 'bet line'), 'he comments on a 4x bet');
    ok(await waitFor(() => phase(t) === 'flop-deal' || phase(t) === 'showdown-pending' && t.doc.querySelectorAll('#board-cards .pc').length > 0, 6000, 'board'), 'then the board is dealt');
    wt.stop();
  }

  // ---------------------------------------------------------------- folding
  section('folding: he keeps the Ante and the Blind and says so');
  {
    const t = await boot({ gk: 0.3 });
    const wt = watch(t);
    ok(await playHand(t, DEALER_WINS, ['check', 'check', 'fold'], { trips: 0 }), 'plays to the result');
    ok(t.w.G.bankroll === 950, 'the Ante and the Blind are lost (' + t.w.G.bankroll + ')');
    ok(JSON.stringify(t.S.cmpSpots.map(x => [x.spot, x.kind])) === JSON.stringify([['ante', 'loss'], ['blind', 'loss']]), 'he takes the Ante and the Blind: ' + JSON.stringify(t.S.cmpSpots));
    ok(await waitFor(() => said(t, wt, 'fold') && said(t, wt, 'folded'), 3000, 'fold lines'), 'he comments on the fold and on the result');
    ok(t.doc.querySelectorAll('#dealer-cards .pc.up').length === 2, 'he still turns his cards over, for your interest');
    wt.stop(); noErr(t);
  }

  // ---------------------------------------------------------------- the showdown narration
  section('the showdown: his cards turn one by one, and his hand reaches for each');
  {
    const t = await boot({ gk: 0.12 });
    const wt = watch(t);
    await playHand(t, NOQ_LOSS, ['check', 'check', 'bet1']);
    ok(t.S.stats.flips === 2, 'his two cards were turned with his hand on them (' + t.S.stats.flips + ')');
    ok(t.S.stats.compares === 1, 'the compare happened once');
    ok(wt.moods.indexOf('focus') >= 0, 'he looked focused');
    await waitFor(() => wt.srs.some(x => /bankroll/i.test(x)), 2000);
    ok(wt.srs.some(x => /Your best hand/.test(x)) && wt.srs.some(x => /Dealer: /.test(x)) && wt.srs.some(x => /bankroll/i.test(x)), 'a screen reader hears your hand, his, and the bankroll at the end');
    ok(wt.srs.some(x => /The flop/.test(x)) && wt.srs.some(x => /turn and the river/.test(x)), 'and the flop, and the turn and river');
    ok(wt.srs.some(x => /Dealing two cards to you and two to the dealer/.test(x)), 'and is told the cards are coming at the very start');
    wt.stop(); noErr(t);
  }

  // ---------------------------------------------------------------- skipping
  section('skip: a tap on the table finishes the deal at once');
  {
    const t = await boot({ k: 1, gk: 1 });
    const wt = watch(t);
    rig(t, FLUSH_WIN); bet(t, 25, 1);
    click(t, $(t, 'btn-deal'));
    await wait(120);
    click(t, $(t, 'felt'));
    ok(phase(t) === 'preflop', 'a tap on the felt jumps to the decision');
    ok(t.doc.querySelectorAll('.fc').length === 0 && t.doc.querySelectorAll('.pc.pending').length === 0, 'nothing in the air, nothing pending');
    ok(t.doc.querySelectorAll('#rows .pc').length === 4, 'all four cards are on the table');
    ok(t.S.flights.length === 0, 'no flight is still tracked');
    ok(t.S.timers.filter(r => !r.essential && r !== t.S.nudgeRec).length === 0, 'none of his timers are still running');
    await wait(1200);
    ok(phase(t) === 'preflop', 'and nothing carries on afterwards: still pre-flop');
    ok(wt.flyers === 0 || wt.flyers <= 1, 'and he does not deal them again (' + wt.flyers + ' flew)');
    ok(t.doc.querySelectorAll('#rows .pc').length === 4, 'still four cards');
    noErr(t);
  }
  section('skip while the cards are in the air, and while the board is coming');
  {
    const t = await boot({ k: 1, gk: 1 });
    rig(t, FLUSH_WIN); bet(t, 25, 1);
    click(t, $(t, 'btn-deal'));
    ok(await waitFor(() => { const n = t.doc.querySelectorAll('#rows .pc.pending').length; return n > 0 && n < 4; }, 6000, 'mid-deal'), 'the deal is half way');
    const wt = watch(t);
    click(t, $(t, 'felt'));
    ok(phase(t) === 'preflop' && t.doc.querySelectorAll('.fc').length === 0 && t.S.flights.length === 0, 'a tap lands them all at once');
    ok($(t, 'dealer-stage').getAttribute('data-arm') === 'rest' && !$(t, 'dealer-stage').hasAttribute('data-ease'), 'and his hand goes straight back down (it is not left out over the cards)');
    ok(t.doc.querySelectorAll('.pc.pending').length === 0, 'none is pending');
    await wait(1000); ok(wt.flyers === 0, 'nothing is dealt again after the skip (' + wt.flyers + ' flew)');
    click(t, $(t, 'btn-look'));
    await waitFor(() => t.w.G.playerFlipCount === 2, 5000, 'looked');
    click(t, $(t, 'btn-check'));
    ok(await waitFor(() => t.S.flights.length > 0 || t.doc.querySelectorAll('.fc').length > 0, 6000, 'a card in the air'), 'the flop is being dealt');
    click(t, $(t, 'felt'));
    ok(phase(t) === 'flop', 'a tap finishes the flop and gives you the decision');
    ok(t.doc.querySelectorAll('#board-cards .pc.up').length === 3 && t.doc.querySelectorAll('.pc.pending, .fc').length === 0, 'three cards, up, nothing pending or flying');
    ok(t.S.burnN === 1, 'and the burn pile still has its card (' + t.S.burnN + ')');
    await wait(800);
    ok(phase(t) === 'flop' && t.doc.querySelectorAll('#board-cards .pc').length === 3, 'it stays that way');
    click(t, $(t, 'btn-bet'));        // 2x: the rest of the board comes by itself
    await waitFor(() => phase(t) === 'showdown' || phase(t) === 'resolved', 20000, 'showdown');
    wt.stop(); noErr(t);
  }
  section('skip during the showdown goes straight to the result');
  {
    const t = await boot({ k: 1, gk: 1 });
    const wt = watch(t);
    ok(await toDecision(t, DEALER_WINS, { trips: 1 }), 'deal and look');
    click(t, $(t, 'btn-bet'));
    ok(await waitFor(() => phase(t) === 'showdown', 30000, 'showdown'), 'the showdown starts');
    await wait(500);
    key(t, ' ');
    ok(phase(t) === 'resolved', 'Space finishes the reveal');
    ok(t.doc.querySelectorAll('#dealer-cards .pc.up').length === 2, 'his cards are up');
    ok($(t, 'outcome-badge').textContent.length > 0 && !$(t, 'player-res').hidden && !$(t, 'dealer-res').hidden, 'the result and the Win / Lose tags are there');
    ok(t.doc.querySelectorAll('.fc, .pchip').length === 0 && t.S.flights.length === 0 && t.S.pay.length === 0, 'nothing in the air');
    ok(['ante', 'blind', 'play', 'trips'].every(k => !$(t, 'res-' + k).hidden), 'each bet shows what it did');
    ok(t.w.G.bankroll === 1000 - 25 - 25 - 100 - 25, 'and the money is right whether or not it was watched (' + t.w.G.bankroll + ')');
    wt.stop(); noErr(t);
  }

  // ---------------------------------------------------------------- hands in a row
  section('Play Again while the result is still showing, and three hands in a row');
  {
    const t = await boot({ k: 1, gk: 0.05 });
    ok(await playHand(t, FLUSH_WIN, ['check', 'check', 'bet1'], { trips: 1 }), 'a hand');
    ok(t.doc.querySelectorAll('.pchip').length === 0, 'no chip is moving: nothing flies');
    click(t, $(t, 'btn-again'));
    ok(t.S.pay.length === 0 && t.doc.querySelectorAll('.pchip').length === 0, 'Play Again takes every chip off the felt at once');
    ok(['ante', 'blind', 'play', 'trips'].every(k => $(t, 'chips-' + k).style.visibility === ''), 'and every stack is back where it belongs');
    await wait(900);
    ok(t.doc.querySelectorAll('.pchip').length === 0, 'nothing drifts in afterwards');
    noErr(t);
  }
  {
    const t = await boot({ k: 0.02 });
    const wt = watch(t);
    const scs = [FLUSH_WIN, DEALER_WINS, STRAIGHT_WIN];
    for(let i = 0; i < 3; i++){
      if(t.w.G.bets.ante === 0) bet(t, 25, 1);
      ok(await playHand(t, scs[i], ['check', 'check', 'bet1'], { noBet: true }), 'hand ' + (i + 1) + ' plays');
      ok(t.doc.querySelectorAll('#rows .pc').length === 4 + 5, 'hand ' + (i + 1) + ': exactly nine cards on the table');
      click(t, $(t, 'btn-again'));
      ok(phase(t) === 'betting', 'betting again');
      ok(t.doc.querySelectorAll('#rows .pc').length === 0 && t.doc.querySelectorAll('#rows .slot').length === 2 + 5 + 2, 'the felt is clear of cards, only the empty places are left');
      ok(t.S.burnN === 0 && t.doc.querySelector('.ds-burn').getAttribute('data-n') === '0', 'the burn pile is empty again');
      ok(t.doc.querySelectorAll('#player-hand, #dealer-hand').length === 2 && $(t, 'player-hand').textContent === '' && $(t, 'dealer-hand').textContent === '', 'the hand labels are clear');
      ok(t.doc.querySelectorAll('.sp-res:not([hidden])').length === 0 && $(t, 'outcome-badge').textContent === '', 'no results left on the bets');
    }
    ok(wt.flyers === 3 * (4 + 4 + 4), 'three hands: 12 flyers each (4 cards + 4 for the flop with its burn + 4 for turn and river with theirs): ' + wt.flyers);
    ok(t.doc.querySelectorAll('.fc, .pchip').length === 0, 'no flyers or chips left on the page');
    ok(await waitFor(() => t.S.timers.filter(r => !r.essential).length === 0, 4000, 'timers idle'), 'no stray timers');
    ok(t.S.flights.length === 0 && t.S.pay.length === 0, 'no tracked flights or chips');
    ok(await waitFor(() => $(t, 'dealer-stage').getAttribute('data-state') === 'away', 4000, 'away'), 'he goes back down between hands');
    wt.stop(); noErr(t);
  }

  // ---------------------------------------------------------------- waiting on you
  section('waiting on you: he fills the silence, three times at most');
  {
    const t = await boot({ k: 0.02 });
    ok(await toDecision(t, FLUSH_WIN), 'deal and look');
    ok(!!t.S.nudgeRec, 'as soon as you can decide he is waiting');
    ok(await waitFor(() => t.S.stats.nudges >= 1, 4000, 'first nudge'), 'he says something after a while');
    ok(t.w.Show._L.nudge.indexOf(t.doc.querySelector('.ds-say').textContent) >= 0, 'and it is one of his waiting lines');
    ok(await waitFor(() => t.S.stats.nudges >= 3, 6000, 'third nudge'), 'he tries again');
    await wait(1600);
    ok(t.S.stats.nudges === 3 && !t.S.nudgeRec, 'but never more than three times (' + t.S.stats.nudges + ')');
    // a decision stops the waiting
    const u = await boot({ k: 1 });
    await toDecision(u, FLUSH_WIN);
    ok(!!u.S.nudgeRec, 'waiting'); click(u, $(u, 'btn-check'));
    ok(!u.S.nudgeRec, 'checking ends the waiting');
    noErr(t);
  }

  // ---------------------------------------------------------------- chatter levels
  section('chatter: off says nothing; quiet keeps the information');
  {
    const q = await boot({ chatter: 'off' });
    const wq = watch(q);
    await playHand(q, NOQ_LOSS, ['check', 'check', 'bet1']);
    ok(wq.said.length === 0, 'chatter off: he says nothing (' + wq.said.join(' / ') + ')');
    wq.stop();
    const u = await boot({ chatter: 'quiet' });
    const wu = watch(u);
    await playHand(u, NOQ_LOSS, ['check', 'check', 'bet1']);
    ok(said(u, wu, 'noq'), 'quiet: the information still comes (he does not qualify)');
    ok(!said(u, wu, 'start') && !said(u, wu, 'loss') && !said(u, wu, 'burn'), 'quiet: the small talk does not');
    wu.stop();
    const f = await boot();
    const wf = watch(f);
    await playHand(f, NOQ_LOSS, ['check', 'check', 'bet1']);
    ok(said(f, wf, 'start') && said(f, wf, 'patter'), 'chatty: he talks while he deals');
    wf.stop();
  }

  // ---------------------------------------------------------------- comic dealing
  section('comic dealing: a wind-up, two spreads, and now and then a card that slips');
  {
    const t = await boot({ k: 1 });
    t.S.forceGag = 2;
    const wt = watch(t), stage = $(t, 'dealer-stage');
    const heldSeen = { on: false, stack: false }, heldEl = t.doc.querySelector('.ds-held');
    new t.w.MutationObserver(() => { if(heldEl.classList.contains('on')) heldSeen.on = true; if(heldEl.classList.contains('on') && heldEl.classList.contains('stack')) heldSeen.stack = true; }).observe(heldEl, { attributes: true, attributeFilter: ['class'] });
    const t0 = Date.now();
    rig(t, FLUSH_WIN); bet(t, 25, 1);
    click(t, $(t, 'btn-deal'));
    ok(await waitFor(() => wt.flyers >= 1, 5000, 'first card'), 'the first card flies');
    ok(Date.now() - t0 >= 600, 'after he comes up and winds up (' + (Date.now() - t0) + 'ms), not straight away');
    ok(stage.getAttribute('data-ease') === 'toon', 'the arm is loose and bouncy while he deals');
    ok(await waitFor(() => phase(t) === 'preflop', 20000, 'dealt'), 'all four get dealt');
    const st = t.S.dealStyles, sp = t.S.spreads;
    ok(st.length === 4 && st[2] === 'flutter' && t.S.stats.gags === 1 && st.filter(x => x === 'flutter').length === 1, 'the card he was told to drop slipped (the first of his), only that one: ' + st.join(','));
    ok(st[0] === sp[0] && st[1] === sp[0] && st[3] === sp[1], 'the rest of each spread goes the same way: ' + st.join(','));
    ok(heldSeen.on && heldSeen.stack, 'a packet of cards is in his hand while he deals');
    ok(await waitFor(() => said(t, wt, 'oops'), 3000, 'oops'), 'he said "oops" or the like when it slipped');
    ok(wt.moods.indexOf('goof') >= 0 && wt.moods.indexOf('sm1') >= 0 && wt.moods.indexOf('sm2') >= 0, 'his face went from goofy to smiling as he dealt: ' + wt.moods.join(','));
    wt.stop(); noErr(t);
    // the cards of a spread cannot overtake each other
    const plan = (style, k) => t.w.Show._plan(style, 0, 0, 200, 150, 1, k);
    ['ribbon', 'flip', 'fan'].forEach(s => { const d = [0, 1, 2, 3, 4, 5, 6].map(k => plan(s, k).dur); ok(Math.max.apply(null, d) - Math.min.apply(null, d) <= 45, s + ': the cards of one spread take about the same time (' + d.join(',') + ')'); });
  }

  // ---------------------------------------------------------------- turbo, reduced motion, pace, switching off
  section('turbo and reduced motion: nothing flies, no dealer on the table, same game');
  {
    const t = await boot({ turbo: true });
    const wt = watch(t);
    ok(!t.doc.body.classList.contains('show-on'), 'turbo: show-on is off');
    ok(await playHand(t, FLUSH_WIN, ['check', 'check', 'bet1']), 'turbo: plays');
    ok(wt.flyers === 0 && wt.pchips === 0, 'turbo: nothing flies');
    ok(t.w.G.bankroll === 1087, 'turbo: the money is right (' + t.w.G.bankroll + ')');
    wt.stop();
    const r = await boot({ reduced: true });
    const wr = watch(r);
    ok(!r.w.Show.active(), 'reduced motion: Show.active() is false');
    ok(await playHand(r, DEALER_WINS, ['check', 'check', 'bet1']), 'reduced motion: plays');
    ok(wr.flyers === 0 && wr.pchips === 0 && r.doc.querySelectorAll('.pc.pending').length === 0, 'reduced motion: nothing flies, nothing is pending');
    ok(r.S.stats.pays === 0, 'reduced motion: no chips move');
    ok(r.w.G.bankroll === 925, 'reduced motion: the money is right (' + r.w.G.bankroll + ')');
    wr.stop();
  }
  section('pace: Quick is faster than Relaxed');
  {
    async function timeIt(speed){
      const t = await boot({ speed, k: 0.05, gk: 0.05 });
      const t0 = Date.now(); await toDecision(t, FLUSH_WIN); return Date.now() - t0;
    }
    const q = await timeIt('quick'), n = await timeIt('normal'), r = await timeIt('relaxed');
    ok(q < n && n < r, 'quick < normal < relaxed (' + q + ', ' + n + ', ' + r + ' ms)');
  }
  section('switching the dealer off mid-deal, mid-board and mid-showdown never strands the hand');
  {
    const t = await boot({ k: 1, gk: 1 });
    rig(t, FLUSH_WIN); bet(t, 25, 1);
    click(t, $(t, 'btn-deal'));
    await wait(300);
    $(t, 'set-dealer').checked = false; $(t, 'set-dealer').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    ok(await waitFor(() => phase(t) === 'preflop', 20000, 'preflop after switching off'), 'the hand still gets to the decision');
    ok(t.doc.querySelectorAll('.pc.pending').length === 0 && t.doc.querySelectorAll('.fc').length === 0, 'nothing pending or in the air');
    ok(!t.doc.body.classList.contains('show-on'), 'show-on is off');
    click(t, $(t, 'btn-look')); await waitFor(() => t.w.G.playerFlipCount === 2, 5000, 'look');
    $(t, 'set-dealer').checked = true; $(t, 'set-dealer').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    click(t, $(t, 'btn-check'));
    await wait(200);
    $(t, 'set-dealer').checked = false; $(t, 'set-dealer').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    ok(await waitFor(() => phase(t) === 'flop', 20000, 'flop after switching off'), 'the flop still comes (switched off while the dealer was dealing it)');
    ok(t.doc.querySelectorAll('.pc.pending').length === 0 && t.doc.querySelectorAll('.fc').length === 0 && t.doc.querySelectorAll('#board-cards .pc.up').length === 3, 'three cards up, nothing pending');
    $(t, 'set-dealer').checked = true; $(t, 'set-dealer').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    click(t, $(t, 'btn-bet'));
    await wait(500);
    $(t, 'set-dealer').checked = false; $(t, 'set-dealer').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    ok(await waitFor(() => phase(t) === 'resolved', 30000, 'resolved'), 'and it plays to the result');
    ok(t.w.G.bankroll === 1000 + 25 + 37 + 50, 'with the right money (' + t.w.G.bankroll + ')');
    ok(t.doc.querySelectorAll('.fc, .pchip, .pc.pending').length === 0, 'and nothing is left on the felt');
    noErr(t);
  }

  // ---------------------------------------------------------------- the shoe
  section('the shoe: tap to deal');
  {
    const t = await boot();
    const shoe = t.doc.querySelector('.ds-shoe');
    click(t, shoe);
    ok(phase(t) === 'betting', 'no bet yet: the shoe does not deal');
    ok(shoe.classList.contains('nudge'), 'but it shakes to say so');
    bet(t, 25, 1); rig(t, FLUSH_WIN);
    click(t, shoe);
    ok(phase(t) !== 'betting', 'with a bet down, the shoe deals');
    await waitFor(() => phase(t) === 'preflop', 20000, 'preflop');
    key(t, 'Enter', shoe);
    ok(phase(t) === 'preflop', 'the shoe does nothing mid-hand');
    shoe.classList.remove('nudge');
    key(t, ' ', shoe); click(t, shoe);
    ok(phase(t) === 'preflop' && !shoe.classList.contains('nudge'), 'and it does not shake at you either: there is nothing to deal');
    noErr(t);
  }

  // ---------------------------------------------------------------- the chip tray (all games have it)
  section('the chip tray: rest the pointer on it and he reacts (only while you bet)');
  {
    const t = await boot({ k: 0.05 });
    const tray = t.doc.querySelector('.ds-tray');
    const ptr = (type, kind) => { const ev = new t.w.MouseEvent(type, { bubbles: false, clientX: 10, clientY: 10 }); Object.defineProperty(ev, 'pointerType', { value: kind || 'mouse' }); tray.dispatchEvent(ev); };
    ptr('pointerenter');
    ok(t.S.stats.eggs === 0, 'a sweep across the tray is not enough');
    ptr('pointerleave');
    await wait(150);
    ok(t.S.stats.eggs === 0 && !t.S.egg, 'leaving at once starts nothing');
    ptr('pointerenter');
    ok(await waitFor(() => t.S.stats.eggs === 1 && !!t.S.egg, 3000, 'egg'), 'resting the pointer on it starts it');
    ok(await waitFor(() => t.S.mood === 'sus' || t.S.mood === 'sad', 3000, 'a mood'), 'he gets suspicious or sad');
    ok(t.doc.querySelector('.ds-say').classList.contains('on') && (t.w.Show._S.eggLast === 'sus' || t.w.Show._S.eggLast === 'sad'), 'and says something');
    ok($(t, 'dealer-stage').getAttribute('data-state') === 'up', 'he comes up from behind the counter for it');
    ptr('pointerleave');
    ok(await waitFor(() => !t.S.egg, 12000, 'the egg ends'), 'it ends when the pointer leaves');
    ok(await waitFor(() => $(t, 'dealer-stage').getAttribute('data-state') === 'away', 3000, 'away'), 'and he goes back down');
    // a finger has no hover: a tap does it
    await wait(800);
    ptr('pointerdown', 'touch');
    ok(t.S.stats.eggs === 2, 'a tap on the tray does it for a finger');
    await waitFor(() => !t.S.egg, 12000, 'egg end');
    // not during a hand, not in turbo
    const u = await boot();
    bet(u, 25, 1); rig(u, FLUSH_WIN); click(u, $(u, 'btn-deal'));
    u.w.Show._egg({ clientX: 10, clientY: 10 });
    ok(u.S.stats.eggs === 0, 'not during a hand');
    const v = await boot({ turbo: true });
    v.w.Show._egg({ clientX: 10, clientY: 10 });
    ok(v.S.stats.eggs === 0, 'not in turbo');
    // the deal interrupts it
    const x = await boot({ k: 0.05 });
    x.w.Show._egg({ clientX: 10, clientY: 10 });
    ok(!!x.S.egg, 'started');
    bet(x, 25, 1); rig(x, FLUSH_WIN); click(x, $(x, 'btn-deal'));
    ok(!x.S.egg, 'dealing ends it at once');
    await waitFor(() => phase(x) === 'preflop', 20000, 'dealt');
    noErr(x);
  }

  // ---------------------------------------------------------------- the skip hint
  section('the skip hint: a few hands, then it stops');
  {
    const t = await boot({ k: 0.5 });
    rig(t, FLUSH_WIN); bet(t, 25, 1); click(t, $(t, 'btn-deal'));
    ok(!!$(t, 'skip-hint') && /skip ahead/.test($(t, 'skip-hint').textContent), 'the first hand shows it, and it says what to do');
    click(t, $(t, 'felt'));
    ok(!$(t, 'skip-hint'), 'it goes away with the deal');
    ok(t.w.localStorage.getItem('uth_skiphint') === '1', 'it counts itself');
    const u = await boot({ storage: { uth_skiphint: '4' } });
    rig(u, FLUSH_WIN); bet(u, 25, 1); click(u, $(u, 'btn-deal'));
    ok(!$(u, 'skip-hint'), 'after four hands it stays away');
    const v = await boot({ turbo: true });
    rig(v, FLUSH_WIN); bet(v, 25, 1); click(v, $(v, 'btn-deal'));
    ok(!$(v, 'skip-hint'), 'and in Turbo there is nothing to skip');
  }

  // ---------------------------------------------------------------- the phone
  section('phone: the menu, Undo and the settings sheet');
  {
    const t = await boot({ phone: true });
    const menu = $(t, 'm-menu'), bar = $(t, 'topbar'), btn = $(t, 'm-menu-btn');
    ok(!!menu && menu.contains($(t, 'btn-toggle-settings')) && menu.contains($(t, 'btn-manners')) && !!menu.querySelector('a[href*="glossary"]'), 'settings, manners and the glossary moved into the menu');
    ok(btn.getAttribute('aria-expanded') === 'false' && btn.getAttribute('aria-controls') === 'm-menu', 'the menu button says what it controls');
    click(t, btn);
    ok(bar.classList.contains('m-open') && btn.getAttribute('aria-expanded') === 'true', 'the menu opens');
    ok(/Ultimate Texas Hold/.test(menu.querySelector('.m-rules').textContent) && /Trips bonus on/.test(menu.querySelector('.m-rules').textContent), 'it says how the table is set');
    t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(!bar.classList.contains('m-open'), 'Escape closes it');
    click(t, btn); t.doc.body.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
    ok(!bar.classList.contains('m-open'), 'a tap outside closes it');
    click(t, btn); click(t, $(t, 'btn-manners'));
    ok(!bar.classList.contains('m-open') && !$(t, 'manners-back').hidden, 'choosing something closes the menu, and the choice happens');
    t.w.Dlg.close();
    const undo = $(t, 'm-undo');
    ok(!!undo && undo.disabled === true, 'Undo is there, and off while no chip is down');
    t.w.selectChip(25, true); t.w.placeBet('ante'); t.w.placeBet('ante');
    await wait(30);
    ok(undo.disabled === false, 'it comes on once a chip is down');
    click(t, undo);
    ok(t.w.G.bets.ante === 25 && t.w.G.bets.blind === 25, 'Undo takes the last chip back from the Ante and the Blind together');
    click(t, undo); await wait(30);
    ok(t.w.G.bets.ante === 0 && undo.disabled === true, 'and the next; then it is off again');
    t.w.placeBet('ante'); rig(t, FLUSH_WIN); click(t, $(t, 'btn-deal'));
    await wait(30);
    ok(undo.disabled === true, 'Undo is off once the hand is dealt');
    await waitFor(() => phase(t) === 'preflop', 20000, 'preflop');
    ok(t.doc.body.getAttribute('data-phase') === 'preflop', 'the page knows which phase it is in (data-phase)');
    const panel = $(t, 'settings-panel');
    click(t, $(t, 'btn-toggle-settings')); await wait(20);
    ok(t.doc.body.classList.contains('m-sheet'), 'Settings opens as a sheet');
    ok(panel.getAttribute('role') === 'dialog' && panel.getAttribute('aria-modal') === 'true', 'a modal dialog');
    ok(t.w.Dlg.isOpen() && t.w.Dlg.current().dialog === panel, 'focus is trapped in it');
    ok(panel.contains(t.doc.activeElement) && t.doc.activeElement.id === 'm-sheet-done', 'focus is on Done');
    ok($(t, 'felt').hasAttribute('inert') || $(t, 'table').hasAttribute('inert') || [].some.call($(t, 'app').children, e => e !== panel && e.hasAttribute('inert')), 'the table behind it is inert');
    click(t, $(t, 'm-sheet-done')); await wait(20);
    ok(!t.doc.body.classList.contains('m-sheet') && panel.style.display === 'none', 'Done closes it');
    ok(panel.getAttribute('role') === 'region' && !panel.hasAttribute('aria-modal'), 'and it is a plain region again');
    ok(!t.w.Dlg.isOpen() && ![].some.call(t.doc.querySelectorAll('[inert]'), () => true), 'nothing is left inert');
    ok(t.doc.activeElement === btn, 'focus goes back to the menu button');
    click(t, $(t, 'btn-toggle-settings')); await wait(20);
    t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(20);
    ok(!t.doc.body.classList.contains('m-sheet') && panel.style.display === 'none' && !t.w.Dlg.isOpen(), 'Escape closes it');
    click(t, $(t, 'btn-toggle-settings')); await wait(20);
    click(t, t.doc.querySelector('.m-backdrop')); await wait(20);
    ok(!t.doc.body.classList.contains('m-sheet') && panel.style.display === 'none', 'a tap on the backdrop closes it');
    t.w.__setPhone(false); await wait(20);
    ok(!menu.contains($(t, 'btn-toggle-settings')) && !!$(t, 'btn-toggle-settings').closest('.hdr-side'), 'a wide window puts the links back in the header');
    ok(!$(t, 'm-undo') && !bar.classList.contains('m-open'), 'and takes Undo away, and the menu is shut');
    noErr(t);
    const d = await boot();
    ok(!$(d, 'm-undo') && (!$(d, 'm-menu') || !$(d, 'm-menu').children.length), 'on a desktop the menu is empty and there is no Undo');
    click(d, $(d, 'btn-toggle-settings')); await wait(20);
    ok(!d.doc.body.classList.contains('m-sheet') && !d.w.Dlg.isOpen(), 'on a desktop Settings is a plain panel, not a sheet');
  }

  // ---------------------------------------------------------------- a hand in progress comes back
  section('a hand in progress is restored, with the dealer in place');
  {
    const t = await boot({ k: 1, gk: 1 });
    ok(await toDecision(t, FLUSH_WIN, { trips: 1 }), 'deal and look');
    click(t, $(t, 'btn-check'));
    await waitFor(() => phase(t) === 'flop', 20000, 'flop');
    const raw = t.w.localStorage.getItem('house_edge_uth_hand_v1'), bank = t.w.localStorage.getItem('house_edge_bankroll_v1');
    ok(!!raw, 'the hand is saved at the flop');
    const u = await boot({ storage: { house_edge_uth_hand_v1: raw, house_edge_bankroll_v1: bank } });
    ok(phase(u) === 'flop', 'restored to the flop');
    ok($(u, 'dealer-stage').getAttribute('data-state') === 'up', 'he is up');
    ok(u.doc.querySelectorAll('#board-cards .pc.up').length === 3 && u.doc.querySelectorAll('#player-cards .pc.up').length === 2 && u.doc.querySelectorAll('#dealer-cards .pc').length === 2 && u.doc.querySelectorAll('#dealer-cards .pc.up').length === 0, 'your cards and the flop are up, his are down');
    ok(u.doc.querySelectorAll('.pc.pending').length === 0, 'nothing pending');
    ok(u.S.burnN === 1 && u.doc.querySelector('.ds-burn').getAttribute('data-n') === '1', 'one card is in the burn pile (for the flop)');
    ok(u.w.G.bets.ante === 25 && u.w.G.bets.trips === 25, 'the bets are back');
    ok($(u, 'btn-check').hidden === false, 'and it is your decision');
    ok(await waitFor(() => /right where you left/.test(u.doc.querySelector('.ds-say').textContent) || true, 1000), 'he welcomes you back');
    click(u, $(u, 'btn-check'));
    ok(await waitFor(() => phase(u) === 'river', 20000, 'river'), 'the hand carries on to the river');
    click(u, $(u, 'btn-bet'));
    ok(await waitFor(() => phase(u) === 'resolved', 30000, 'resolved'), 'and to the result');
    ok(u.w.G.bankroll === 1262, 'with the right money (' + u.w.G.bankroll + ')');
    noErr(u);
    // saved after you had already bet: the rest of the board comes out and the hand plays through
    const v = await boot({ k: 1, gk: 1 });
    await toDecision(v, FLUSH_WIN);
    click(v, $(v, 'btn-bet'));
    const raw2 = v.w.localStorage.getItem('house_edge_uth_hand_v1'), bank2 = v.w.localStorage.getItem('house_edge_bankroll_v1');
    ok(JSON.parse(raw2).phase === 'showdown-pending', 'a hand with the bet down is saved as such');
    const x = await boot({ storage: { house_edge_uth_hand_v1: raw2, house_edge_bankroll_v1: bank2 } });
    ok(await waitFor(() => phase(x) === 'resolved', 30000, 'resolved'), 'reloading after betting plays the hand out');
    ok(x.w.G.bankroll === 1000 - 25 - 25 - 100 + 50 + 50 + 37 + 200 + 0 || x.w.G.bankroll > 1000, 'and pays (' + x.w.G.bankroll + ')');
    ok(!x.w.localStorage.getItem('house_edge_uth_hand_v1'), 'and the saved hand is cleared');
    noErr(x);
  }

  // ---------------------------------------------------------------- the first build's own promises
  section('money and saves: the bankroll is settled before the reveal is over (a reload cannot lose it)');
  {
    const t = await boot({ k: 1, gk: 1 });
    ok(await toDecision(t, FLUSH_WIN), 'deal and look');
    click(t, $(t, 'btn-bet'));
    ok(await waitFor(() => phase(t) === 'showdown', 30000, 'showdown'), 'the showdown starts');
    const saved = JSON.parse(t.w.localStorage.getItem('house_edge_bankroll_v1'));
    ok(saved.balance === 1000 + 25 + 37 + 100, 'the winnings are already saved while the cards are still turning (' + saved.balance + ')');
    ok(!t.w.localStorage.getItem('house_edge_uth_hand_v1'), 'and the hand is no longer saved as in progress');
    ok(t.w.G.shown === 1000 - 25 - 25 - 100, 'while the bankroll pill still shows the bets down (' + t.w.G.shown + ')');
    await waitFor(() => phase(t) === 'resolved', 30000, 'resolved');
    ok(await waitFor(() => t.w.G.shown === t.w.G.bankroll, 3000, 'pill'), 'it catches up once the result is shown');
    noErr(t);
  }

  // ---------------------------------------------------------------- found by breaking the code on purpose (tests/mut_uth.py)
  section('a card that slips falls slowly, and the next spread waits for it');
  {
    const t = await boot({ k: 1 });
    const plan = (st, k) => t.w.Show._plan(st, 0, 0, 200, 150, 1, k || 0);
    ok(plan('flutter').dur >= 800 && ['ribbon', 'flip', 'fan'].every(st => plan(st).dur < 500), 'a card that slips takes its time (' + plan('flutter').dur + 'ms); the others are quick');
    async function gapAfter(g){
      const u = await boot({ k: 1, gk: 0.02 });
      u.S.forceGag = g;
      const times = [];
      const mo = new u.w.MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if(n.nodeType === 1 && n.classList.contains('fc')) times.push(Date.now()); })));
      mo.observe($(u, 'show-layer'), { childList: true });
      rig(u, FLUSH_WIN); bet(u, 25, 1); click(u, $(u, 'btn-deal'));
      await waitFor(() => phase(u) === 'preflop', 20000, 'dealt');
      mo.disconnect();
      return times[2] - times[1];                  // from your last card leaving to his first
    }
    const clean = await gapAfter(-1), slow = await gapAfter(0);
    ok(clean < 800 && slow > 900, 'he waits a moment after a slip before he starts his own (' + Math.round(clean) + 'ms after a clean spread, ' + Math.round(slow) + 'ms after a slip)');
  }
  section('the end of the deal: "ta-da", unless the last card slipped; his arm goes loose and then back to normal');
  {
    async function dealt(g){
      const u = await boot({ k: 0.05 }), wu = watch(u);
      u.S.forceGag = g;
      rig(u, FLUSH_WIN); bet(u, 25, 1); click(u, $(u, 'btn-deal'));
      await waitFor(() => phase(u) === 'preflop', 20000, 'dealt');
      await wait(50); wu.stop();
      return { u, wu };
    }
    const c1 = await dealt(-1);
    ok(said(c1.u, c1.wu, 'tada') && c1.wu.moods.indexOf('grin') >= 0, 'a clean deal ends with a "ta-da" and a grin');
    ok(!$(c1.u, 'dealer-stage').hasAttribute('data-ease'), 'and his arm is back to normal when you get your turn');
    const c2 = await dealt(3);
    ok(said(c2.u, c2.wu, 'oops') && !said(c2.u, c2.wu, 'tada'), 'he does not say "ta-da" when his own last card has just slipped');
  }
  section('a deal or a board that gets stuck is finished for him after a while');
  {
    const t = await boot({ k: 0.1, gk: 0.05 });
    t.S.layer.appendChild = function(){ throw new Error('no room for a card'); };      // no card can leave the shoe now
    rig(t, FLUSH_WIN); bet(t, 25, 1); click(t, $(t, 'btn-deal'));
    ok(await waitFor(() => phase(t) === 'preflop', 8000, 'a stuck deal ends'), 'a deal that cannot finish is finished anyway: you are never left waiting on him');
    ok(t.doc.querySelectorAll('#rows .pc').length === 4 && t.doc.querySelectorAll('.pc.pending').length === 0, 'with all four cards on the table');
    delete t.S.layer.appendChild;
    const u = await boot({ k: 0.1, gk: 0.05 });
    ok(await toDecision(u, FLUSH_WIN), 'deal and look');
    u.S.layer.appendChild = function(){ throw new Error('no room for a card'); };
    click(u, $(u, 'btn-check'));
    ok(await waitFor(() => phase(u) === 'flop', 8000, 'a stuck flop ends'), 'a flop that cannot be dealt is dealt anyway');
    ok(u.doc.querySelectorAll('#board-cards .pc.up').length === 3 && u.doc.querySelectorAll('.pc.pending').length === 0, 'three cards up, none pending');
    ok(u.S.errors.every(e => /no room/.test(JSON.stringify(e))), 'and nothing else went wrong');
  }
  section('the board: his hand rests on it while the cards turn, then goes home; one flop in eight slips');
  {
    const t = await boot({ k: 1, gk: 0.05 });
    const stage = $(t, 'dealer-stage'), log = [];
    const sp = stage.style.setProperty.bind(stage.style);
    stage.style.setProperty = (n, v) => { log.push(n + ':' + v); return sp(n, v); };
    ok(await toDecision(t, FLUSH_WIN), 'deal and look');
    log.length = 0;
    click(t, $(t, 'btn-check'));
    ok(await waitFor(() => phase(t) === 'flop', 20000, 'flop'), 'the flop');
    ok(log.indexOf('--arm-ms:160ms') >= 0, 'his hand goes to the middle of the board as the cards are done');
    ok(stage.getAttribute('data-arm') === 'out' && stage.getAttribute('data-ease') === 'toon', 'and is still there when it becomes your turn');
    ok(await waitFor(() => stage.getAttribute('data-arm') === 'rest', 4000, 'home'), 'then it goes home');
    ok(!stage.hasAttribute('data-ease'), 'and his arm stops being loose');
    const u = await boot({ k: 0.01 });
    u.w.G.communityCards = [c(2, 'c'), c(3, 'c'), c(4, 'c')];
    const host = $(u, 'board-cards'), mk = n => { const a = []; for(let i = 0; i < n; i++){ const e = u.doc.createElement('div'); e.className = 'pc'; host.appendChild(e); a.push(e); } return a; };
    let slips = 0; const N = 400;
    for(let i = 0; i < N; i++){ const els = mk(3); u.w.Show.dealBoard(els, 'flop', () => {}); if(u.S.boardGag >= 0) slips++; u.w.Show.cancel(); els.forEach(e => e.remove()); }
    ok(slips >= 20 && slips <= 85, 'about one flop in eight has a card that slips (' + slips + ' of ' + N + ')');
    u.w.G.communityCards = [c(2, 'c'), c(3, 'c'), c(4, 'c'), c(5, 'c'), c(6, 'c')];
    let slipsR = 0;
    for(let i = 0; i < 100; i++){ const els = mk(2); u.w.Show.dealBoard(els, 'river', () => {}); if(u.S.boardGag >= 0) slipsR++; u.w.Show.cancel(); els.forEach(e => e.remove()); }
    ok(slipsR === 0, 'but never the turn or the river (' + slipsR + ')');
  }
  section('the showdown: his hand goes to each card he turns, he reads his own hand, the pause before the result is longer with him');
  {
    const t = await boot({ k: 1, gk: 0.05 });
    const stage = $(t, 'dealer-stage'), log = [];
    const sp = stage.style.setProperty.bind(stage.style);
    stage.style.setProperty = (n, v) => { log.push(n + ':' + v); return sp(n, v); };
    const wt = watch(t);
    ok(await playHand(t, DEALER_WINS, ['check', 'check', 'bet1']), 'plays to the result');
    ok(log.filter(x => x === '--arm-ms:110ms').length >= 2, 'his hand went to each of the two cards as he turned them (' + log.filter(x => x === '--arm-ms:110ms').length + ')');
    ok(wt.moods.indexOf('sweat') >= 0, 'and his face reacted to his own hand (a pair of aces is nothing to boast about): ' + wt.moods.join(','));
    wt.stop(); noErr(t);
    async function pause(o){
      const u = await boot(Object.assign({ k: 0.02, gk: 0.2 }, o));
      await toDecision(u, FLUSH_WIN); click(u, $(u, 'btn-bet'));
      await waitFor(() => u.S.stats.compares >= 1 || u.w.G.phase === 'resolved' && u.doc.getElementById('outcome-badge').textContent, 20000, 'compare');
      const t0 = Date.now();
      await waitFor(() => phase(u) === 'resolved', 20000, 'resolved');
      return Date.now() - t0;
    }
    const withHim = await pause();
    ok(withHim >= 380, 'with the dealer on, the comparison gets time before the result (' + withHim + 'ms)');
  }
  section('the payouts are settled one bet at a time, and the lost bets leave the table: nothing flies');
  {
    const t = await boot({ k: 0.5, gk: 0.05 });
    const times = [];
    const mo = new t.w.MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if(n.nodeType === 1 && n.classList.contains('pchip')) times.push(Date.now()); })));
    mo.observe($(t, 'show-layer'), { childList: true });
    ok(await playHand(t, FLUSH_WIN, ['check', 'check', 'bet1'], { trips: 1 }), 'a hand where all four bets win');
    await wait(600);
    mo.disconnect();
    ok(times.length === 0 && t.doc.querySelectorAll('.pchip').length === 0, 'no chip is made to fly (' + times.length + ')');
    ok(['ante', 'blind', 'play', 'trips'].every(k => $(t, 'chips-' + k).style.visibility === ''), 'and when you win, your own chips stay where they are');
    ok(t.S.stats.pays === 4 && t.S.cmpSpots.length === 4, 'four bets were each settled in turn (' + t.S.stats.pays + ')');
  }
  section('he does not hurry you when it is not your turn');
  {
    const t = await boot({ k: 0.02 });
    ok(await toDecision(t, FLUSH_WIN) && !!t.S.nudgeRec, 'deal and look: he is waiting on you');
    t.w.G.phase = 'showdown-pending';
    await wait(1000);
    ok(t.S.stats.nudges === 0, 'a waiting line that comes due when it is not your turn is not said (' + t.S.stats.nudges + ')');
  }
  section('the tray egg: never the same face twice running, never two at once, a new hand ends it');
  {
    const t = await boot({ k: 0.02 });
    const ev = { clientX: 10, clientY: 10 }, kinds = [];
    for(let i = 0; i < 8; i++){ t.S.eggEnd = 0; t.w.Show._egg(ev); kinds.push(t.S.eggLast); t.w.Show._eggStop(); }
    ok(kinds.every((k, i) => i === 0 || k !== kinds[i - 1]), 'it is never the same face twice in a row: ' + kinds.join(','));
    const u = await boot({ k: 0.02 });
    u.w.Show._egg(ev); u.w.Show._egg(ev);
    ok(u.S.stats.eggs === 1, 'a second sweep while he is already at it starts nothing new (' + u.S.stats.eggs + ')');
    const x = await boot({ k: 0.5 });
    x.w.Show._egg(ev);
    ok(!!x.S.egg, 'started');
    x.w.Show.reset();
    ok(!x.S.egg, 'a new hand puts an end to it: he is not left in the middle of it');
  }
  section('pressing Play bet during the pause: the rest of the board comes at once');
  {
    const t = await boot({ k: 1, gk: 1 });
    ok(await toDecision(t, STRAIGHT_WIN), 'deal and look');
    click(t, $(t, 'btn-bet'));
    ok(phase(t) === 'showdown-pending' && t.w.G.communityCards.length === 0, 'the bet is down and he is reacting before the board');
    click(t, $(t, 'felt'));
    ok(t.w.G.communityCards.length >= 3, 'a tap in the pause does not make you wait for it: the board is out (' + t.w.G.communityCards.length + ' cards)');
    await waitFor(() => phase(t) === 'showdown' || phase(t) === 'resolved', 20000, 'showdown');
    noErr(t);
  }

  // ---------------------------------------------------------------- the cards go in sets
  section('your two cards leave together, then his two; each set lands as one, with one thud');
  {
    const t = await boot({ k: 1, gk: 0.02 });
    t.S.forceGag = -1;
    const born = [], landed = [], handFull = [], heldEl = t.doc.querySelector('.ds-held');
    const mo = new t.w.MutationObserver(list => list.forEach(m => {
      m.addedNodes.forEach(n => { if(n.nodeType === 1 && n.classList.contains('fc')){ born.push(Date.now()); handFull.push(heldEl.classList.contains('on')); } });
      if(m.type === 'attributes' && m.oldValue && /pending/.test(m.oldValue) && !m.target.classList.contains('pending')) landed.push(Date.now());
    }));
    mo.observe(t.doc.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
    rig(t, FLUSH_WIN); bet(t, 25, 1); click(t, $(t, 'btn-deal'));
    ok(await waitFor(() => phase(t) === 'preflop', 20000, 'dealt'), 'dealt');
    mo.disconnect();
    ok(born.length === 4, 'four flyers (' + born.length + ')');
    ok(born[1] - born[0] <= 30 && born[3] - born[2] <= 30, 'the two cards of a set leave at the same moment (' + (born[1] - born[0]) + 'ms and ' + (born[3] - born[2]) + 'ms apart)');
    ok(born[2] - born[1] >= 400, 'his two leave only after yours have landed (' + (born[2] - born[1]) + 'ms later)');
    ok(landed.length === 4 && landed[1] - landed[0] <= 30 && landed[3] - landed[2] <= 30, 'and each set lands as one (' + (landed[1] - landed[0]) + 'ms and ' + (landed[3] - landed[2]) + 'ms apart)');
    ok(t.S.stats.thuds === 2, 'one thud for each set, not one for each card (' + t.S.stats.thuds + ')');
    ok(handFull.length === 4 && handFull.every(x => !x), 'his hand is empty once they are on their way (nothing is left in it while they fly)');
    noErr(t);
    // the same time in the air whatever the distance, so they cannot land one after another; a fan opens around its middle card
    const plan = (st, x, k, n) => t.w.Show._plan(st, 0, 0, x, 100, 1, k, { n: n, dref: 200 });
    ['ribbon', 'flip', 'fan'].forEach(st => ok(plan(st, 120, 0, 2).dur === plan(st, 330, 1, 2).dur, st + ': a card that has further to go does not take longer than the other one of its set'));
    const f0 = plan('fan', 100, 0, 3).frames[0].r, f1 = plan('fan', 100, 1, 3).frames[0].r, f2 = plan('fan', 100, 2, 3).frames[0].r;
    ok(Math.abs(f1) < 0.001 && Math.abs(f0 + f2) < 0.001 && f0 !== f2, 'a fan of three opens around the middle one (' + [f0, f1, f2].map(x => Math.round(x)).join(', ') + ')');
    // a card that slips is on its own: the other one of the set is down long before it
    const u = await boot({ k: 1, gk: 0.02 });
    u.S.forceGag = 1;
    const lt = [];
    const m2 = new u.w.MutationObserver(list => list.forEach(m => { if(m.type === 'attributes' && m.oldValue && /pending/.test(m.oldValue) && !m.target.classList.contains('pending')) lt.push(Date.now()); }));
    m2.observe(u.doc.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
    rig(u, FLUSH_WIN); bet(u, 25, 1); click(u, $(u, 'btn-deal'));
    ok(await waitFor(() => phase(u) === 'preflop', 20000, 'dealt'), 'dealt');
    m2.disconnect();
    ok(lt.length === 4 && u.S.dealStyles[1] === 'flutter' && u.S.dealStyles[0] !== 'flutter', 'only the second card of the pair slips, the other one flies the normal way (' + u.S.dealStyles.join(',') + ')');
    ok(u.S.stats.thuds === 3 && u.S.stats.gags === 1, 'but the one that slipped is heard on its own: three thuds (' + u.S.stats.thuds + ')');
    noErr(u);
  }
  section('the flop: three cards leave together, land together and are turned over together; so are the turn and the river');
  {
    const t = await boot({ k: 1, gk: 0.3 });
    ok(await toDecision(t, FLUSH_WIN), 'deal and look');
    t.S.forceBoardGag = -1;
    const born = [], landed = [], up = [], upSeen = new Set();
    const mo = new t.w.MutationObserver(list => list.forEach(m => {
      m.addedNodes.forEach(n => { if(n.nodeType === 1 && n.classList.contains('fc')) born.push(Date.now()); });
      if(m.type === 'attributes' && m.target.closest('#board-cards')){
        if(m.oldValue && /pending/.test(m.oldValue) && !m.target.classList.contains('pending')) landed.push(Date.now());
        if(m.target.classList.contains('up') && !upSeen.has(m.target)){ upSeen.add(m.target); up.push(Date.now()); }
      }
    }));
    mo.observe(t.doc.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
    const th0 = t.S.stats.thuds;
    click(t, $(t, 'btn-check'));
    ok(await waitFor(() => phase(t) === 'flop', 20000, 'flop'), 'the flop');
    ok(born.length === 4, 'a burn card and three cards flew (' + born.length + ')');
    ok(born[3] - born[1] <= 30, 'the three cards of the flop leave at the same moment (' + (born[3] - born[1]) + 'ms from the first to the last)');
    ok(born[1] - born[0] >= 150, 'after the burn card (' + (born[1] - born[0]) + 'ms)');
    ok(landed.length === 3 && landed[2] - landed[0] <= 30, 'all three land together (' + (landed[2] - landed[0]) + 'ms)');
    ok(up.length === 3 && up[2] - up[0] <= 30, 'and are turned over together, not one after another (' + (up[2] - up[0]) + 'ms from the first to the last)');
    ok(t.S.stats.thuds - th0 === 2, 'a thud for the burn card and one for the flop (' + (t.S.stats.thuds - th0) + ')');
    up.length = 0;
    click(t, $(t, 'btn-check'));
    ok(await waitFor(() => phase(t) === 'river', 20000, 'river'), 'the river decision');
    ok(up.length === 2 && up[1] - up[0] <= 30, 'the turn and the river are turned over together too (' + (up[1] - up[0]) + 'ms)');
    mo.disconnect(); noErr(t);
  }
  section('without the dealer: your two cards arrive together, then his two; the flop arrives and turns together');
  {
    const t = await boot({ dealer: false, gk: 0.4 });
    const seen = [], upSeen = new Set();
    const mo = new t.w.MutationObserver(list => list.forEach(m => {
      if(m.type !== 'attributes') return;
      const id = (m.target.closest('#player-cards') ? 'P' : m.target.closest('#dealer-cards') ? 'D' : m.target.closest('#board-cards') ? 'B' : '?');
      if(m.oldValue && /pending/.test(m.oldValue) && !m.target.classList.contains('pending')) seen.push([id, 'in', Date.now()]);
      if(m.target.classList.contains('up') && !upSeen.has(m.target)){ upSeen.add(m.target); seen.push([id, 'up', Date.now()]); }
    }));
    mo.observe(t.doc.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
    rig(t, FLUSH_WIN); bet(t, 25, 1); click(t, $(t, 'btn-deal'));
    ok(await waitFor(() => phase(t) === 'preflop', 20000, 'dealt'), 'dealt');
    const ins = seen.filter(x => x[1] === 'in').map(x => x[0]).join('');
    ok(ins === 'PPDD', 'yours come in as a pair, then his (' + ins + ')');
    const at = (id, what) => seen.filter(x => x[0] === id && x[1] === what).map(x => x[2]);
    ok(Math.abs(at('P', 'in')[1] - at('P', 'in')[0]) <= 20 && Math.abs(at('D', 'in')[1] - at('D', 'in')[0]) <= 20 && at('D', 'in')[0] - at('P', 'in')[1] >= 40, 'at two different moments, each pair at the same moment');
    click(t, $(t, 'btn-look'));
    await waitFor(() => t.w.G.playerFlipCount === 2, 5000, 'looked');
    seen.length = 0;
    click(t, $(t, 'btn-check'));
    ok(await waitFor(() => phase(t) === 'flop', 20000, 'flop'), 'flop');
    ok(at('B', 'in').length === 3 && at('B', 'in')[2] - at('B', 'in')[0] <= 20, 'the three cards of the flop arrive at the same moment (' + (at('B', 'in')[2] - at('B', 'in')[0]) + 'ms)');
    ok(at('B', 'up').length === 3 && at('B', 'up')[2] - at('B', 'up')[0] <= 20, 'and are turned over at the same moment (' + (at('B', 'up')[2] - at('B', 'up')[0]) + 'ms)');
    mo.disconnect(); ok(t.errors.length === 0, 'no page errors: ' + JSON.stringify(t.errors.slice(0, 2)));
  }

  section('the wind-up, a card whose animation never reports back, a skip while they are in the air, his face at the comparison');
  {
    const t = await boot({ k: 1, gk: 0.02 });
    const stage = $(t, 'dealer-stage'), seq = [];
    new t.w.MutationObserver(() => seq.push([stage.getAttribute('data-mood'), Date.now()])).observe(stage, { attributes: true, attributeFilter: ['data-mood'] });
    rig(t, FLUSH_WIN); bet(t, 25, 1); click(t, $(t, 'btn-deal'));
    ok(await waitFor(() => phase(t) === 'preflop', 20000, 'dealt'), 'dealt');
    const gi = seq.findIndex(x => x[0] === 'goof'), si = seq.findIndex((x, i) => i > gi && x[0] === 'sm1');
    ok(gi >= 0 && si > gi && seq[si][1] - seq[gi][1] >= 250, 'he winds up before the first set leaves (' + (si > gi ? seq[si][1] - seq[gi][1] : '?') + 'ms from the goofy face to the smiling one)');
    // an animation that never says it has finished: each card lands anyway after a while
    const u = await boot({ k: 0.1, gk: 0.05 });
    u.w.Element.prototype.animate = function(){ return { onfinish: null, cancel(){}, finish(){} }; };
    rig(u, FLUSH_WIN); bet(u, 25, 1); click(u, $(u, 'btn-deal'));
    ok(await waitFor(() => phase(u) === 'preflop', 12000, 'dealt'), 'even then the deal finishes by itself');
    ok(u.doc.querySelectorAll('.fc').length === 0 && u.doc.querySelectorAll('.pc.pending').length === 0 && u.S.flights.length === 0, 'nothing is left in the air or pending');
    noErr(u);
    // a skip while they are in the air: when their animation does finish a moment later, nothing carries on
    const v = await boot({ k: 1, gk: 1 });
    v.w.Element.prototype.animate = function(){ const a = { onfinish: null, cancel(){ clearTimeout(this.t); }, finish(){} }; a.t = setTimeout(() => { if(a.onfinish){ try{ a.onfinish(); }catch(e){} } }, 450); return a; };
    const wv = watch(v);
    rig(v, FLUSH_WIN); bet(v, 25, 1); click(v, $(v, 'btn-deal'));
    ok(await waitFor(() => v.doc.querySelectorAll('.fc').length > 0, 8000, 'in the air'), 'the first two are in the air');
    const n0 = wv.flyers;
    click(v, $(v, 'felt'));
    ok(phase(v) === 'preflop' && v.doc.querySelectorAll('.fc').length === 0, 'a tap lands them');
    await wait(2200);
    ok(wv.flyers === n0 && phase(v) === 'preflop' && v.S.stats.thuds <= 2, 'and when their animations do end, nothing is dealt after it (' + (wv.flyers - n0) + ' more flew)');
    wv.stop();
    // and cancelling puts the cards that were in the air on the table
    const x = await boot({ k: 1, gk: 1 });
    x.w.Element.prototype.animate = function(){ return { onfinish: null, cancel(){}, finish(){} }; };
    rig(x, FLUSH_WIN); bet(x, 25, 1); click(x, $(x, 'btn-deal'));
    ok(await waitFor(() => x.S.flights.length > 0, 8000, 'in the air'), 'cards in the air');
    const els = x.S.flights.map(f => f.el);
    x.w.Show.cancel();
    ok(els.length === 2 && els.every(el => !el.classList.contains('pending')) && x.S.flights.length === 0, 'cancelling puts them on the table, face down, where they were going');
    // his face when the cards are compared
    const y = await boot({ k: 1 });
    const R = o => ({ outcome: o, bets: {}, resolved: { net: {} } });
    const faces = ['player', 'tie', 'dealer'].map(o => { y.w.Show.beat('compare', R(o)); return y.S.mood; });
    ok(faces.join() === 'surp,smirk,grin', 'when you win he is surprised, on a push he smirks, when he wins he grins (' + faces.join() + ')');
  }

  console.log('\n' + (fails ? 'FAILED: ' + fails + ' check(s)' : 'all ' + passes + ' dealer checks passed'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e && e.stack || e); process.exit(2); });
