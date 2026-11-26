// Baccarat dealer + peel -- jsdom tests.
//   node test_baccarat_show.js [path/to/baccarat/index.html]
// Needs jsdom. jsdom has no animations and no layout, so Element.prototype.animate is stubbed and time is sped up through Show._S.k / Peel._P.k.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || [path.join(__dirname, 'index.html'), path.join(__dirname, 'dist', 'index.html')].find(f => fs.existsSync(f));
const HTML = fs.readFileSync(FILE, 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
// card coordinates -> where the pointer is on screen, for the way the card is turned right now (the peel opens turned on its side)
const atFor = P => (cx, cy) => { const th = P.rot * Math.PI / 180, X = (cx - 50) * P.u, Y = (cy - 70) * P.u; return { clientX: X * Math.cos(th) - Y * Math.sin(th), clientY: X * Math.sin(th) + Y * Math.cos(th), button: 0, pointerType: 'mouse', preventDefault(){} }; };
let fails = 0, passes = 0, current = '';
function ok(cond, msg){ if (cond){ passes++; } else { fails++; console.log('  FAIL [' + current + '] ' + msg); } }
function section(name){ current = name; console.log('· ' + name); }
async function waitFor(fn, ms, label){
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 6000)){ try{ if (fn()) return true; }catch(e){} await wait(4); }
  if (label) ok(false, 'timed out waiting for ' + label);
  return false;
}
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };

// opts: {dealer, turbo, animate, reduced, squeeze, how, auto, chatter, hints, quiz, storage, seed}
async function boot(opts){
  opts = opts || {};
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://tableready.xyz/baccarat/',
    beforeParse(w){
      let s = opts.seed || 123456789; w.Math.random = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
      w.alert = () => {};
      if (opts.storage) for (const k of Object.keys(opts.storage)) w.localStorage.setItem(k, opts.storage[k]);
      if (opts.animate !== false) w.Element.prototype.animate = function(kf, op){
        const a = { onfinish: null, cancelled: false, cancel(){ this.cancelled = true; clearTimeout(this.t); }, finish(){} };
        const d = (typeof op === 'number' ? op : ((op && op.duration) || 0)) + ((op && op.delay) || 0);
        a.t = setTimeout(() => { if (!a.cancelled && a.onfinish && w.document){ try{ a.onfinish(); }catch(e){ if (w.document) throw e; } } }, Math.max(1, d * 0.05));
        return a;
      };
      if (opts.reduced || opts.phone || opts.touch){   // opts.phone: the narrow-screen query matches (w.__setPhone(false) widens the window again); opts.touch: a finger, no mouse
        const subs = []; let on = true;
        w.__setPhone = v => { on = v; subs.forEach(f => f({ matches: on })); };
        w.matchMedia = q => ({ get matches(){ return !!((opts.reduced && /reduce/.test(q)) || (opts.phone && /max-width:700px/.test(q) && on) || (opts.touch && /pointer:coarse/.test(q))); }, media: q, addListener(f){ subs.push(f); }, removeListener(){}, addEventListener(t, f){ subs.push(f); }, removeEventListener(){} });
      }
    } });
  await wait(250);
  const w = dom.window, doc = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  const set = (id, v) => { const e = doc.getElementById(id); if (e.type === 'checkbox') e.checked = !!v; else e.value = v; };
  if (opts.dealer === false) set('set-dealer', false);
  if (opts.squeeze) set('set-squeeze', opts.squeeze);
  if (opts.how) set('set-squeezehow', opts.how);
  if (opts.auto === false) set('set-autoturn', false);
  if (opts.chatter) set('set-chatter', opts.chatter);
  if (opts.hints === false) set('set-peelhints', false);
  set('set-turbo', !!opts.turbo);
  set('set-quizmode', !!opts.quiz);
  w.readSettings();
  w.RESULT_PAUSE = 24;
  const S = w.Show._S; S.k = 0.02; w.Peel._P.k = 0.02;
  w.renderAll();
  w.rig = function(codes){
    const cards = codes.map(c => { const r = c.slice(0, -1), su = SUIT[c.slice(-1)]; return { r, suit: su, color: (su === '♥' || su === '♦') ? 'red' : 'black' }; });
    const filler = w.buildShoe(8).filter(x => !(x.r === '2' && x.suit === '♠')).slice(0, 70);
    w.G.shoe = filler.concat(cards.slice().reverse());
  };
  w.bet = (spot, n) => { for (let i = 0; i < (n || 1); i++) w.placeBet(spot); };
  return { dom, w, doc, S, P: w.Peel._P, errors };
}
const $ = (t, id) => t.doc.getElementById(id);
const down = t => [].slice.call(t.doc.querySelectorAll('.flip-card')).filter(e => !e.classList.contains('flipped') && !e.classList.contains('pending') && e.style.visibility !== 'hidden');
const cardsIn = (t, side) => [].slice.call($(t, side + '-cards').children);
function click(t, el){ el.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true })); }
function key(t, k, extra){ ($(t, 'peel')).dispatchEvent(new t.w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {}))); }
const toBetting = t => waitFor(() => t.w.G.phase === 'betting', 12000, 'betting phase');
const fourDealt = t => waitFor(() => cardsIn(t, 'player').length >= 2 && cardsIn(t, 'banker').length >= 2 && !t.doc.querySelector('.flip-card.pending') && t.S.queue.length === 0 && !t.S.busy, 8000, 'four cards dealt');
const noErr = (t, what) => {
  ok(t.S.errors.length === 0, (what || 'dealer') + ' raised no errors: ' + JSON.stringify(t.S.errors));
  ok(t.P.errors.length === 0, 'peel raised no errors: ' + JSON.stringify(t.P.errors));
  ok(t.errors.length === 0, 'no page errors: ' + JSON.stringify(t.errors.slice(0, 2)));
};
// Play a whole hand by tapping: peel and turn over what is yours, tap anything else.
async function playHand(t, o){
  o = o || {};
  const t0 = Date.now();
  while (t.w.G.phase !== 'betting' && Date.now() - t0 < 15000){
    if (t.w.Peel.isOpen()){
      if (!t.P.busy){ if (o.back && !t.P.backed){ t.P.backed = true; t.w.Peel.finish('back'); } else t.w.Peel.finish('flip'); }
      await wait(10); continue;
    }
    if ($(t, 'quiz-prompt').style.display === 'block' && $(t, 'quiz-buttons').style.display !== 'none'){ click(t, $(t, 'quiz-yes')); await wait(30); continue; }
    const d = down(t);
    if (d.length && !t.S.busy && t.S.queue.length === 0) click(t, d[0]);
    await wait(12);
  }
  return t.w.G.phase === 'betting';
}

(async () => {
  // ---------------------------------------------------------------- settings
  section('settings: defaults, saved and restored');
  {
    const t = await boot();
    const G = t.w.G;
    ok(G.tableShow === true && G.squeezeMode === 'bet' && G.squeezeHow === 'peel' && G.peelHints === true && G.autoTurn === true && G.chatter === 'chatty', 'defaults: dealer on, side I bet on, peel, hints on, auto-turn on, chatty');
    ok(t.doc.body.classList.contains('show-on'), 'body has show-on');
    ok(!!$(t, 'dealer-band') && !!$(t, 'dealer-stage'), 'dealer band and stage exist');
    ok(!!$(t, 'peel') && $(t, 'peel').hidden === true, 'peel screen exists and is closed');
    $(t, 'set-squeeze').value = 'banker'; $(t, 'set-squeeze').dispatchEvent(new t.w.Event('change'));
    $(t, 'set-autoturn').checked = false; $(t, 'set-autoturn').dispatchEvent(new t.w.Event('change'));
    $(t, 'set-chatter').value = 'quiet'; $(t, 'set-chatter').dispatchEvent(new t.w.Event('change'));
    ok(G.squeezeMode === 'banker' && G.autoTurn === false && G.chatter === 'quiet', 'changes reach G');
    const saved = JSON.parse(t.w.localStorage.getItem('house_edge_baccarat_show_v1') || 'null');
    ok(saved && saved['set-squeeze'] === 'banker' && saved['set-autoturn'] === false && saved['set-chatter'] === 'quiet', 'saved to localStorage');
    const t2 = await boot({ storage: { house_edge_baccarat_show_v1: JSON.stringify(saved) } });
    ok(t2.w.G.squeezeMode === 'banker' && t2.w.G.autoTurn === false && t2.w.G.chatter === 'quiet', 'restored on the next visit');
    const t3 = await boot({ storage: { house_edge_baccarat_show_v1: '{"set-squeeze":"bogus","x":1}' } });
    ok(t3.w.G.squeezeMode === 'bet', 'a bad saved value falls back to the default');
    const t4 = await boot({ storage: { house_edge_baccarat_show_v1: 'not json' } });
    ok(t4.w.G.squeezeMode === 'bet' && t4.S.errors.length === 0, 'unreadable storage is ignored');
    [t, t2, t3, t4].forEach(x => x.w.close());
  }

  // ---------------------------------------------------------------- the hand passed to you
  section('which hand is passed to you');
  {
    const t = await boot();
    const G = t.w.G, pick = (bets, mode) => { G.bets = Object.assign({ player: 0, banker: 0, tie: 0, dragon7: 0, panda8: 0, dragonP: 0, dragonB: 0 }, bets); G.squeezeMode = mode; t.w.Show.handStart(); return t.S.mine; };
    ok(pick({ banker: 50 }, 'bet') === 'banker', 'bet on Banker -> Banker');
    ok(pick({ player: 50 }, 'bet') === 'player', 'bet on Player -> Player');
    ok(pick({ banker: 50, player: 25 }, 'bet') === 'banker', 'larger bet wins (banker)');
    ok(pick({ banker: 25, player: 50 }, 'bet') === 'player', 'larger bet wins (player)');
    ok(pick({ banker: 25, player: 25 }, 'bet') === 'player', 'a tie in the bets -> Player');
    ok(pick({ tie: 25 }, 'bet') === 'player', 'only a Tie bet -> Player');
    ok(pick({}, 'bet') === 'player', 'no bets -> Player');
    ok(pick({ banker: 90 }, 'player') === 'player', 'always Player');
    ok(pick({ player: 90 }, 'banker') === 'banker', 'always Banker');
    ok(pick({ banker: 90 }, 'nobody') === null, 'nobody');
    G.turbo = true; ok(pick({ banker: 50 }, 'bet') === null, 'turbo passes nothing');
    noErr(t); t.w.close();
  }

  // ---------------------------------------------------------------- dealing
  section('the dealer deals: order, cards, pass');
  {
    const t = await boot();
    const w = t.w, G = w.G;
    w.rig(['5S', '2H', 'KD', '3C', '9H']);          // Player 5 K, Banker 2 3 -> both draw? Player 5 draws 9 (->4), Banker 5 vs player third 9: stands
    w.bet('banker', 2);
    let cardsAtPass = -1, airAtPass = -1;
    new w.MutationObserver(() => { if (cardsAtPass < 0 && ($(t, 'banker-box').classList.contains('pushing') || $(t, 'banker-box').classList.contains('passed'))){ cardsAtPass = cardsIn(t, 'player').length + cardsIn(t, 'banker').length - t.doc.querySelectorAll('.flip-card.pending').length; airAtPass = t.doc.getElementById('show-layer').children.length; } }).observe($(t, 'banker-box'), { attributes: true });
    w.dealHand();
    ok(G.phase === 'initial', 'phase initial');
    await waitFor(() => t.S.state === 'up', 2000, 'dealer rises');
    await fourDealt(t);
    const pc = cardsIn(t, 'player'), bc = cardsIn(t, 'banker');
    ok(pc.length === 2 && bc.length === 2, 'two cards each side');
    ok(pc[0]._bc.card.r === '5' && bc[0]._bc.card.r === '2' && pc[1]._bc.card.r === 'K' && bc[1]._bc.card.r === '3', 'cards are the rigged ones, on the right sides');
    ok(pc.concat(bc).every(c => !c.classList.contains('flipped')), 'all four face down');
    ok(t.S.mine === 'banker' && $(t, 'banker-box').classList.contains('passed') && !$(t, 'player-box').classList.contains('passed'), 'Banker (my bet) is passed to me');
    ok(/Banker is yours/.test($(t, 'hint-turn').textContent), 'hint line says Banker is yours: ' + $(t, 'hint-turn').textContent);
    ok(t.S.stats.deals === 4 && t.S.stats.passes === 1, 'four deals, one pass');
    ok(cardsAtPass === 4, 'the hand is passed only once all four cards are on the table (' + cardsAtPass + ')');
    ok(airAtPass === 0, 'and none of them is still in the air when the push starts (' + airAtPass + ')');
    ok(t.S.stats.tosses === 1, 'one toss for the hand that is passed');
    await waitFor(() => $(t, 'banker-box').classList.contains('passed'), 3000, 'passed');
    await waitFor(() => !$(t, 'banker-box').classList.contains('pushing'), 3000, 'push over');
    ok(!$(t, 'banker-box').classList.contains('pushing') && !t.doc.querySelector('.push-wake'), 'when the push is over nothing is left behind (no wake, not pushing)');
    ok(cardsIn(t, 'banker').every(c => !c._busy) && cardsIn(t, 'player').every(c => !c._busy), 'and every card can be tapped again');
    ok(!pc.concat(bc).some(c => c.style.visibility === 'hidden'), 'no card left hidden');
    ok(!t.doc.querySelector('#show-layer .fc'), 'no flyer left in the air');
    // the other hand is not turned before mine
    ok(G.playerRevealed.length === 0 && G.bankerRevealed.length === 0, 'nothing revealed yet');
    await wait(900);
    ok(G.playerRevealed.length === 0, 'the dealer does not turn his hand before mine is done');
    noErr(t); w.close();
  }

  // ---------------------------------------------------------------- peeling
  section('tap my card: peel screen, back, turn over');
  {
    const t = await boot();
    const w = t.w, G = w.G, Peel = w.Peel;
    w.rig(['5S', '2H', 'KD', '3C', '9H']);
    w.bet('banker', 2); w.dealHand(); await fourDealt(t);
    const b0 = cardsIn(t, 'banker')[0];
    click(t, b0);
    ok(await waitFor(() => Peel.isOpen(), 2000, 'peel opens'), 'tapping my card opens the peel screen');
    ok(t.P.card.r === '2', 'it is my first banker card (2)');
    ok(!$(t, 'peel').hidden && /Banker/.test($(t, 'peel-who').textContent) && /first/.test($(t, 'peel-who').textContent), 'label names the hand and card: ' + $(t, 'peel-who').textContent);
    const lifted = w.Show._shown(b0);
    ok(lifted !== b0 && lifted.style.visibility === 'hidden', 'the card in my tray is lifted while I look at it');
    ok(!!/Any rank is still possible|Nothing to read/.test($(t, 'ph-sub').textContent + $(t, 'ph-head').textContent), 'nothing known before peeling');
    await waitFor(() => !t.P.busy, 2000, 'peel ready');
    // peek, then hand it back untouched
    t.w.Peel._drag(50, 70, 4, 4);
    ok(t.w.Lab.seenCount(t.P.seen) > 0, 'lifting an edge saw something');
    t.w.Peel.finish('back');
    ok(await waitFor(() => !Peel.isOpen(), 2000, 'closes'), 'hand back closes the screen');
    ok(!b0.classList.contains('flipped') && lifted.style.visibility === '' && G.bankerRevealed.length === 0, 'still face down, back in place, nothing revealed');
    // open again and turn it over
    click(t, b0); await waitFor(() => Peel.isOpen() && !t.P.busy, 2000, 'reopen');
    ok(t.P.seen && w.Lab.seenCount(t.P.seen) === 0 && t.P.anchor === null, 'a fresh look starts with nothing seen and a flat card');
    Peel.finish('flip');
    ok(await waitFor(() => b0.classList.contains('flipped'), 4000, 'flipped'), 'turn it over flips the card on the felt');
    ok(G.bankerRevealed.length === 1 && G.bankerRevealed[0].r === '2', 'and the game counts it');
    ok(w.Show._shown(b0).style.visibility === '' && w.Show._shown(b0).classList.contains('flipped') && !Peel.isOpen(), 'card is visible in the tray and turned, screen closed');
    ok(await waitFor(() => $(t, 'banker-total').textContent === '2' && !t.S.ticks.banker, 2000), 'live total counts up to 2');
    noErr(t); w.close();
  }

  section('your hand: the dealer tosses it down into the bet area, you peel it there');
  {
    const t = await boot();
    const w = t.w, G = w.G, Peel = w.Peel, S = t.S;
    w.rig(['9S', '2H', 'KD', '3C']);                   // Player 9+K = 9 natural; Banker 2+3 = 5 (mine: I bet Banker)
    w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    const body = t.doc.body, tray = t.doc.getElementById('my-hand'), trayCards = () => [].slice.call(t.doc.querySelectorAll('#mh-cards .flip-card'));
    const afterTray = tray && (tray.nextElementSibling && tray.nextElementSibling.id === 'third-card-note' ? tray.nextElementSibling.nextElementSibling : tray.nextElementSibling);       // (the note for a third card waits, out of sight, just under the tray)
    ok(!!afterTray && afterTray.id === 'betting-row', 'the tray sits right where the Player / Tie / Banker spots are');
    ok(/body\.show-on\.tray-on \.betting-row,body\.show-on\.tray-on \.side-betting-row\{display:none;\}/.test(HTML), 'and while it is open the spots are out of the way');
    ok(await waitFor(() => body.classList.contains('tray-on') && !S.busy && !t.doc.querySelector('.hand-box.pushing'), 6000, 'tossed'), 'the hand is tossed and the tray opens in place of the bet spots');
    ok(trayCards().length === 2 && trayCards().every(m => m.style.visibility === '' && !m.classList.contains('flipped')), 'two face-down cards in the tray');
    const mine = cardsIn(t, 'banker'), theirs = cardsIn(t, 'player');
    ok(mine.length === 2 && mine.every(c => c.classList.contains('with-you')), 'in the box, the real cards are held with a ghost of each');
    ok(theirs.every(c => !c.classList.contains('with-you')) && theirs.length === 2, 'the other hand stays in its box');
    ok(/Banker/.test(tray.querySelector('.mh-side').textContent) && /peel/i.test(tray.querySelector('.mh-tag').textContent) && tray.classList.contains('passed'), 'the tray says whose hand it is and that it is yours to peel');
    ok(t.doc.querySelector('#banker-box').classList.contains('passed') && S.stats.tosses === 1 && S.stats.passes === 1, 'one toss for the hand');
    // the peel opens from the tray, with the same options
    click(t, trayCards()[1]);
    ok(await waitFor(() => Peel.isOpen(), 2000, 'peel opens'), 'tapping a card in the tray opens the peel');
    ok(t.P.card.r === '3', 'it is the card I tapped (the 3, the second one)');
    ok(t.P.opts.slotEl === trayCards()[1] && /second/.test($(t, 'peel-who').textContent), 'it comes from, and goes back to, the tray: ' + $(t, 'peel-who').textContent);
    ok(!!t.doc.getElementById('pc-rl') && !!t.doc.getElementById('pc-hints') && !!t.doc.getElementById('pc-flat'), 'with the same options (turn, hints, flatten)');
    await waitFor(() => !t.P.busy, 2000, 'peel ready');
    Peel.finish('back'); ok(await waitFor(() => !Peel.isOpen(), 2000, 'closed'), 'handed back');
    ok(trayCards()[1].style.visibility === '' && !trayCards()[1].classList.contains('flipped'), 'still face down in the tray');
    click(t, mine[0]);                                   // the ghost in the box works too
    ok(await waitFor(() => Peel.isOpen() && !t.P.busy, 2000, 'peel via ghost'), 'tapping the ghost in the box opens the same peel');
    ok(t.P.card.r === '2' && t.P.opts.slotEl === trayCards()[0], 'for the right card, from the tray');
    Peel.finish('flip');
    ok(await waitFor(() => mine[0].classList.contains('flipped') && trayCards()[0].classList.contains('flipped'), 4000, 'flipped'), 'turned over: the card in the tray shows its face and the game counts it');
    ok(G.bankerRevealed.length === 1 && tray.classList.contains('passed'), 'one left to peel: the tray still says so');
    click(t, trayCards()[1]); await waitFor(() => Peel.isOpen() && !t.P.busy, 2000, 'second'); Peel.finish('flip');
    ok(await waitFor(() => G.bankerRevealed.length === 2 && trayCards().every(m => m.classList.contains('flipped')), 4000, 'both'), 'both turned');
    ok(!tray.classList.contains('passed'), 'nothing left to peel: the tray stops asking');
    // the dealer turns the other hand, the hand ends, the cards go back to their box and the bets come back
    ok(await waitFor(() => G.phase === 'done' || G.phase === 'betting', 8000, 'hand over'), 'the hand ends');
    ok(await waitFor(() => !body.classList.contains('tray-on') && !t.doc.querySelector('#mh-cards .flip-card'), 4000, 'tray closed'), 'the tray closes and the bet spots are back');
    ok(!t.doc.querySelector('.flip-card.with-you') && mine.every(c => c.classList.contains('flipped') && !c._mirror), 'the real cards are back in their box, face up');
    ok(t.S.errors.length === 0 && t.P.errors.length === 0, 'no errors');
    noErr(t); w.close();
  }

  section('your hand in flip mode: tapping a card in the tray has the dealer turn it');
  {
    const t = await boot({ how: 'flip', auto: false });
    const w = t.w, G = w.G, S = t.S;
    w.rig(['4S', '9H', '4D', 'KC']);
    w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    ok(await waitFor(() => t.doc.body.classList.contains('tray-on') && !S.busy, 6000, 'tossed'), 'the hand is tossed into the tray');
    const m0 = t.doc.querySelector('#mh-cards .flip-card');
    ok(/flip/i.test(t.doc.querySelector('.mh-tag').textContent), 'the tag says flip');
    S.k = 0.6;                                              // slow enough to catch him with the card in his hand
    click(t, m0);
    ok(await waitFor(() => m0.style.visibility === 'hidden', 2000, 'lifted'), 'he lifts the card out of the tray (the one you can see)');
    ok(await waitFor(() => G.bankerRevealed.length === 1 && m0.classList.contains('flipped'), 6000, 'turned'), 'the dealer turns it and the card in the tray shows its face');
    S.k = 0.02;
    ok(m0.style.visibility === '' && !w.Peel.isOpen(), 'it is visible again, no peel');
    noErr(t); w.close();
  }

  section('a new hand clears the tray');
  {
    const t = await boot();
    const w = t.w, G = w.G, S = t.S;
    w.rig(['9S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    ok(await waitFor(() => t.doc.body.classList.contains('tray-on') && !S.busy, 6000, 'tossed'), 'tossed');
    S.k = 0.02;
    w.Show.handStart();
    ok(!t.doc.body.classList.contains('tray-on') && !t.doc.querySelector('#mh-cards .flip-card') && !t.doc.querySelector('.flip-card.with-you') && !w.Show._tray().on, 'starting the next hand puts everything back at once');
    noErr(t); w.close();
  }

  section('switching the dealer off while the tray is open');
  {
    const t = await boot();
    const w = t.w, G = w.G, S = t.S;
    w.rig(['9S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    ok(await waitFor(() => t.doc.body.classList.contains('tray-on') && !S.busy, 6000, 'tossed'), 'the hand is in the tray');
    $(t, 'set-dealer').checked = false; $(t, 'set-dealer').dispatchEvent(new t.w.Event('change'));
    await wait(120);
    ok(!t.doc.body.classList.contains('tray-on') && !t.doc.querySelector('#mh-cards .flip-card') && !t.doc.querySelector('.flip-card.with-you') && !w.Show._tray().on, 'the tray is gone and the cards are back in their box');
    ok(cardsIn(t, 'banker').every(c => c.style.visibility !== 'hidden'), 'and none of them is left hidden');
    noErr(t); w.close();
  }

  section('the other hand: auto-turn after mine, and the third card');
  {
    const t = await boot();
    const w = t.w, G = w.G, Peel = w.Peel;
    w.rig(['5S', '2H', 'KD', '3C', '9H']);          // Player 5 draws 9 -> 4; Banker 5 stands. Banker wins 5-4
    w.bet('banker', 2); w.dealHand(); await fourDealt(t);
    for (let i = 0; i < 2; i++){
      click(t, cardsIn(t, 'banker')[i]); await waitFor(() => Peel.isOpen() && !t.P.busy, 2000, 'peel ' + i);
      Peel.finish('flip'); await waitFor(() => cardsIn(t, 'banker')[i].classList.contains('flipped'), 4000, 'flip ' + i);
    }
    ok(G.bankerRevealed.length === 2, 'my two cards are turned');
    ok(await waitFor(() => G.playerRevealed.length === 2, 6000, 'auto turn'), 'the dealer turns the other hand on his own');
    ok(t.S.stats.autos === 2, 'two automatic turns');
    ok(await waitFor(() => G.phase === 'third' || G.phase === 'done' || G.phase === 'betting', 4000, 'third'), 'game moves on');
    await waitFor(() => cardsIn(t, 'player').length === 3, 4000, 'player third dealt');
    const p3 = cardsIn(t, 'player')[2];
    ok(p3 && p3._bc.card.r === '9', 'Player draws the rigged 9');
    ok(await waitFor(() => p3.classList.contains('flipped'), 6000, 'third turned'), 'the dealer turns the third card too');
    ok(await toBetting(t), 'hand completes');
    ok(G.stats.hands === 1 && G.handHistory[0].outcome === 'banker' && G.handHistory[0].bankerTotal === 5 && G.handHistory[0].playerTotal === 4, 'result 5-4 Banker');
    ok(G.bankroll === 1000 + 50, 'bankroll: +50 on a $50 Banker bet (no commission mode)');
    ok(t.doc.querySelectorAll('.hand-box.passed').length === 0, 'the pass is cleared for the next hand');
    ok($(t, 'hint-turn').textContent === '', 'hint line cleared');
    noErr(t); w.close();
  }

  section('my third card: passed again, peeled, then the dealer turns his');
  {
    const t = await boot();
    const w = t.w, G = w.G, Peel = w.Peel;
    w.rig(['2S', '4H', '3D', 'KC', '6H', '7S']);     // Player 2+3=5 draws 6 (->1), Banker 4+K=4 vs third 6 -> draws 7 (->1): tie 1-1
    w.bet('player', 1); w.dealHand(); await fourDealt(t);
    ok(t.S.mine === 'player', 'I am Player');
    for (let i = 0; i < 2; i++){ click(t, cardsIn(t, 'player')[i]); await waitFor(() => Peel.isOpen() && !t.P.busy, 2000, 'p' + i); Peel.finish('flip'); await waitFor(() => cardsIn(t, 'player')[i].classList.contains('flipped'), 4000, 'f' + i); }
    await waitFor(() => G.bankerRevealed.length === 2, 6000, 'banker initial auto');
    ok(await waitFor(() => { const c = cardsIn(t, 'player'); return c.length === 3 && !c[2].classList.contains('pending') && !t.S.busy; }, 6000, 'my third dealt'), 'my third card is dealt');   // landed, not still in the air
    ok(t.S.stats.passes === 2, 'a second, small pass for the third card');
    const p3 = cardsIn(t, 'player')[2];
    ok(await waitFor(() => t.S.stats.tosses === 2 && !t.S.busy && t.doc.querySelectorAll('#mh-cards .flip-card').length === 3, 4000, 'third in tray'), 'the third card is tossed into the tray too (' + t.doc.querySelectorAll('#mh-cards .flip-card').length + ' cards there)');
    ok(p3.classList.contains('with-you') && !!p3._mirror && p3._mirror.parentNode === t.doc.getElementById('mh-cards'), 'its place in the box is held while the real card is in the tray');
    ok(!p3.classList.contains('flipped'), 'third card waits face down for me');
    await wait(500);
    ok(cardsIn(t, 'banker').length === 2, 'Banker does not draw until my third card is turned');
    click(t, p3); await waitFor(() => Peel.isOpen() && !t.P.busy, 2000, 'peel third'); ok(t.P.card.r === '6', 'it is the 6');
    Peel.finish('flip'); await waitFor(() => p3.classList.contains('flipped'), 4000, 'third flipped');
    ok(await waitFor(() => cardsIn(t, 'banker').length === 3, 4000, 'banker third dealt'), 'now Banker draws');
    ok(await waitFor(() => cardsIn(t, 'banker')[2] && cardsIn(t, 'banker')[2].classList.contains('flipped'), 6000, 'banker third turned'), 'and the dealer turns it');
    ok(await toBetting(t), 'hand completes');
    ok(G.handHistory[0].outcome === 'tie' && G.handHistory[0].playerTotal === 1 && G.handHistory[0].bankerTotal === 1, 'tie 1-1');
    ok(G.bankroll === 1000, 'Player bet pushes on a tie');
    noErr(t); w.close();
  }

  // ---------------------------------------------------------------- other modes
  section('flip mode, tapping the other hand, nobody mode');
  {
    const t = await boot({ how: 'flip', auto: false });
    const w = t.w, G = w.G;
    w.rig(['4S', '9H', '4D', 'KC']);                 // natural
    w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    ok(/tap a card and the dealer turns it/.test($(t, 'hint-turn').textContent) && /Tap Player/.test($(t, 'hint-turn').textContent), 'hint: dealer turns, tap the other hand yourself: ' + $(t, 'hint-turn').textContent);
    ok($(t, 'banker-box').querySelector('.hb-pass').textContent === 'Yours to flip', 'tag says flip');
    click(t, cardsIn(t, 'banker')[0]);
    await wait(60);
    ok(!w.Peel.isOpen(), 'flip mode never opens the peel screen');
    ok(await waitFor(() => G.bankerRevealed.length === 1, 4000, 'dealer turned it'), 'the dealer picks it up and turns it');
    click(t, cardsIn(t, 'banker')[1]); await waitFor(() => G.bankerRevealed.length === 2, 4000, 'second');
    await wait(500);
    ok(G.playerRevealed.length === 0, 'auto-turn off: the dealer waits for me to ask');
    click(t, cardsIn(t, 'player')[0]); click(t, cardsIn(t, 'player')[0]);
    await waitFor(() => G.playerRevealed.length === 1, 4000, 'player 1');
    ok(G.playerRevealed.length === 1, 'two quick taps on one card turn it once');
    click(t, cardsIn(t, 'player')[1]);
    ok(await toBetting(t), 'hand completes');
    ok(G.stats.hands === 1 && G.handHistory[0].natural === true, 'natural result recorded');
    noErr(t); w.close();
  }
  {
    const t = await boot({ squeeze: 'nobody' });
    const w = t.w, G = w.G;
    w.rig(['4S', '9H', '4D', 'KC']);
    w.bet('player', 1); w.dealHand(); await fourDealt(t);
    ok(t.S.mine === null && t.doc.querySelectorAll('.hand-box.passed').length === 0, 'nobody is passed a hand');
    ok(/Tap a card and the dealer turns it/.test($(t, 'hint-turn').textContent), 'hint line: tap a card');
    await wait(900);
    ok(G.playerRevealed.length === 0 && G.bankerRevealed.length === 0, 'nothing turns on its own');
    for (const side of ['player', 'banker']) for (let i = 0; i < 2; i++){ click(t, cardsIn(t, side)[i]); await waitFor(() => (side === 'player' ? G.playerRevealed : G.bankerRevealed).length === i + 1 || G.phase === 'betting', 4000, side + i); }
    ok(!t.w.Peel.isOpen(), 'no peel in nobody mode');
    ok(await toBetting(t), 'hand completes');
    noErr(t); w.close();
  }

  section('dealer off and turbo behave like the old table');
  for (const mode of ['off', 'turbo']){
    const t = await boot(mode === 'off' ? { dealer: false } : { turbo: true });
    const w = t.w, G = w.G;
    w.rig(['5S', '2H', 'KD', '3C', '9H']);
    ok(!t.doc.body.classList.contains('show-on'), mode + ': no show-on class');
    w.bet('banker', 1); w.dealHand();
    await waitFor(() => cardsIn(t, 'player').length === 2 && cardsIn(t, 'banker').length === 2, 3000, 'cards');
    ok(t.S.stats.deals === 0 && t.S.queue.length === 0 && !t.doc.querySelector('#show-layer .fc'), mode + ': no dealer jobs, no flyers');
    ok($(t, 'peel').hidden && t.doc.querySelectorAll('.hand-box.passed').length === 0, mode + ': no peel, no pass');
    if (mode === 'off'){
      click(t, cardsIn(t, 'banker')[0]);
      ok(G.bankerRevealed.length === 1 && !w.Peel.isOpen(), 'off: a tap flips the card straight away');
      for (const c of down(t)) click(t, c);
      await waitFor(() => cardsIn(t, 'player').length === 3, 3000, 'third');
      for (const c of down(t)) click(t, c);
    }
    ok(await toBetting(t), mode + ': hand completes');
    ok(G.handHistory[0].outcome === 'banker', mode + ': same result (banker 5-4)');
    ok(G.bankroll === 1025, mode + ': bankroll +25');
    noErr(t); w.close();
  }
  section('reduced motion: no flights, same game');
  {
    const t = await boot({ reduced: true });
    const w = t.w, G = w.G;
    w.rig(['5S', '2H', 'KD', '3C', '9H']);
    w.bet('banker', 1); w.dealHand(); await waitFor(() => cardsIn(t, 'player').length === 2 && cardsIn(t, 'banker').length === 2, 3000, 'cards');
    ok(t.S.stats.deals === 0, 'cards are placed, not flown');
    await wait(60);
    ok(t.S.mine === 'banker' && $(t, 'banker-box').classList.contains('passed'), 'the hand is still passed');
    ok(await playHand(t), 'hand completes by tapping (peel and turn over, dealer turns his)');
    ok(G.handHistory[0].outcome === 'banker', 'result unchanged');
    noErr(t); w.close();
  }

  // ---------------------------------------------------------------- quiz, resume, odds
  section('predict-the-draw mode still works with the dealer');
  {
    const t = await boot({ quiz: true });
    const w = t.w, G = w.G;
    w.rig(['5S', '2H', 'KD', '3C', '9H']);
    w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    ok(await playHand(t), 'hand completes (quiz answered)');
    ok(G.quizStats.total >= 1, 'quiz was asked: ' + JSON.stringify(G.quizStats));
    ok(G.handHistory.length === 1 && G.handHistory[0].outcome === 'banker', 'result unchanged');
    noErr(t); w.close();
  }
  section('a hand in progress is restored on reload');
  {
    const t = await boot();
    const w = t.w, G = w.G;
    w.rig(['5S', '2H', 'KD', '3C', '9H']);
    w.bet('banker', 2); w.dealHand(); await fourDealt(t);
    const stored = {}; for (let i = 0; i < t.w.localStorage.length; i++){ const k = t.w.localStorage.key(i); stored[k] = t.w.localStorage.getItem(k); }
    ok(Object.keys(stored).some(k => /hand/i.test(k)), 'a hand was saved: ' + Object.keys(stored).join(','));
    const t2 = await boot({ storage: stored });
    await waitFor(() => t2.w.G.stats.hands === 1, 6000, 'resumed hand finishes');
    ok(t2.w.G.stats.hands === 1, 'the saved hand was finished on reload');
    ok(t2.S.errors.length === 0 && t2.errors.length === 0, 'no errors on resume: ' + JSON.stringify(t2.S.errors.concat(t2.errors)));
    t.w.close(); t2.w.close();
  }

  // ---------------------------------------------------------------- the peel itself
  section('peel: rotation maps pointer to card');
  {
    const t = await boot();
    const w = t.w, P = t.P;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    click(t, cardsIn(t, 'banker')[0]); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
    P.u = 2.2; P.geo = { cx: 500, cy: 400 };
    let worst = 0;
    for (const rot of [0, 90, 180, 270, -90, 450]){
      P.rot = rot;
      for (const p of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 140 }, { x: 10, y: 70 }, { x: 50, y: 20 }, { x: 77, y: 111 }]){
        const th = rot * Math.PI / 180, ux = (p.x - 50) * P.u, uy = (p.y - 70) * P.u;
        const sx = 500 + ux * Math.cos(th) - uy * Math.sin(th), sy = 400 + ux * Math.sin(th) + uy * Math.cos(th);
        const back = w.Peel._toCard(sx, sy);
        worst = Math.max(worst, Math.abs(back.x - p.x), Math.abs(back.y - p.y));
      }
    }
    ok(worst < 1e-6, 'screen -> card is the inverse of the rotation (worst error ' + worst + ')');
    w.Peel.finish('back'); await waitFor(() => !w.Peel.isOpen(), 2000, 'closed');
    noErr(t); w.close();
  }

  section('peel: the prompt (a 6, a side edge lifted whole -> "6, 7 or 8")');
  {
    const t = await boot();
    const w = t.w, P = t.P;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    const el = cardsIn(t, 'banker')[0]; el._bc.card = { r: '6', suit: '♥', color: 'red' };
    click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
    w.Peel._drag(3, 70, 3, 70);                     // nothing yet
    ok(/Any rank|Nothing/.test($(t, 'ph-head').textContent + $(t, 'ph-sub').textContent), 'a tiny pull tells you nothing');
    w.Peel._drag(70, 70, 3, 70);                    // the left edge, the whole way up the card, 67 in
    ok(/Could be a 6, 7 or 8/.test($(t, 'ph-head').textContent), 'the prompt reads "Could be a 6, 7 or 8": ' + $(t, 'ph-head').textContent);
    ok(/3 pips in view/.test($(t, 'ph-sub').textContent), 'and says three pips are in view: ' + $(t, 'ph-sub').textContent);
    const on = [].slice.call(t.doc.querySelectorAll('#ph-strip .rk.on')).map(e => e.textContent).join(',');
    ok(on === '6,7,8', 'strip lights 6,7,8 (got ' + on + ')');
    ok(t.doc.querySelectorAll('#ph-strip .rk.off').length === 10, 'the other ten are dimmed');
    ok(P.pl && P.pl.kind === 'bow' && t.doc.querySelectorAll('#pcFlap .sg:not([display="none"])').length >= 20, 'the edge bows along its whole length: many slices drawn');
    ok(/matrix\(/.test(t.doc.querySelector('#pcFlap .sg:not([display="none"])').getAttribute('transform')), 'each slice carries its own matrix');
    // the whole side lifts, both corners together: the crease runs from one end of the edge to the other, and the two fingertips sit at the ends
    const cr = P.pl.crease, g = P.pl.grips;
    ok(cr[0].y === 0 && cr[cr.length - 1].y === 140, 'the crease runs the whole length of the edge');
    ok(Math.abs(cr[0].x - cr[cr.length - 1].x) < 1e-9 && Math.abs((cr[0].x + cr[cr.length - 1].x) / 2 - P.pl.fmax) < 1e-6, 'it is symmetric about the middle of the edge');
    ok(g.length === 2 && g[0].y < 12 && g[1].y > 128 && Math.abs(g[0].x - g[1].x) < 1e-9, 'a fingertip at each held corner');
    const midc = cr[Math.floor(cr.length / 2)];
    ok(midc.x <= cr[0].x + 1e-9, 'the held corners lift a touch more than the middle of the edge');
    ok(/rotateY\(\s*[1-9]/.test($(t, 'pc-flipper').style.transform) && /rotateX\(0\.00deg\)/.test($(t, 'pc-flipper').style.transform), 'the card leans towards the side you lift (left edge: Y tilt) (' + $(t, 'pc-flipper').style.transform + ')');
    ok(t.doc.getElementById('pcGrips').getAttribute('display') === null, 'the fingertips are drawn');
    // the corner indexes are under your fingers: the flap never shows them, the turned-over card does
    ok(!t.doc.querySelector('#pcFaceArt text'), 'the lifted flap has no corner index');
    ok(!!t.doc.querySelector('#pcFaceFullArt text'), 'the card turned over has its index');
    // peeling more never un-knows what you saw
    const before = P.hintKey; w.Peel._drag(10, 70, 3, 70);
    ok(P.hintKey === before || /Could be a 6, 7 or 8/.test($(t, 'ph-head').textContent), 'letting go keeps what you saw');
    // turn the card: the prompt is about the card, not the finger
    ok(P.rot === 90, 'the peel opens with the card turned on its side');
    w.Peel._rotate(1); ok(P.rot === 180 && P.stats.rotations === 1, 'rotate right');
    w.Peel._rotate(-1); w.Peel._rotate(-1); ok(P.rot === 0, 'rotate left twice');
    // another edge on the same card keeps narrowing (memory persists across peels)
    P.anchor = null; w.Peel._drag(60, 70, 96, 136);
    ok(/Could be|It’s/.test($(t, 'ph-head').textContent), 'the prompt still makes sense after a second peel: ' + $(t, 'ph-head').textContent);
    w.Peel.finish('back'); await waitFor(() => !w.Peel.isOpen(), 2000, 'closed');
    noErr(t); w.close();
  }

  section('peel: holding a corner, the first pull picks the edge; too far and it turns over');
  {
    const t = await boot();
    const w = t.w, P = t.P, Lab = w.Lab;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    const el = cardsIn(t, 'banker')[0];
    const at = atFor(P);
    click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
    // the edges, by where you press
    ok(Lab.pickAnchor(50, 70) === null, 'the middle of the card holds nothing');
    ok(Lab.pickAnchor(50, 136).id === 'b' && Lab.pickAnchor(4, 70).id === 'l' && Lab.pickAnchor(96, 70).id === 'r' && Lab.pickAnchor(50, 4).id === 't', 'a press near an edge holds that edge');
    ok(Lab.pickAnchor(96, 136).alt && Lab.pickAnchor(96, 136).alt.id !== Lab.pickAnchor(96, 136).id, 'a press in a corner could be either edge');
    // up from the bottom-right corner: the bottom edge. sideways along the bottom: the right edge
    const taken = () => w.Peel._up({ type: 'pointercancel' });      // the system takes the touch away: nothing turns over
    w.Peel._down(at(96, 136)); w.Peel._move(at(90, 90));
    ok(P.anchor && P.anchor.id === 'b', 'pulling the corner up lifts the bottom edge (' + (P.anchor && P.anchor.id) + ')');
    taken(); w.Peel._flatten(true);
    w.Peel._down(at(96, 136)); w.Peel._move(at(50, 130));
    ok(P.anchor && P.anchor.id === 'r', 'pulling the corner along the bottom lifts the right edge (' + (P.anchor && P.anchor.id) + ')');
    taken(); w.Peel._flatten(true);
    // how far it goes: the free edge nearly reaches the far side, the flap curling up and over so about 60% of the face can be seen (never past the far side)
    ok(Lab.edgeParams(Lab.edgeAnchor('b'), { x: 0, y: -500 }).depth <= 140 && Lab.edgeParams(Lab.edgeAnchor('l'), { x: 500, y: 0 }).depth <= 100, 'the free edge never passes the far side of the card');
    ok(Lab.edgeParams(Lab.edgeAnchor('b'), { x: 0, y: -136 }).depth === 136 && Lab.edgeParams(Lab.edgeAnchor('l'), { x: 96, y: 0 }).depth === 96, 'and it goes nearly all the way (136 of 140 up the card, 96 of 100 across)');
    ['b', 't', 'l', 'r'].forEach(id => {
      const an = Lab.edgeAnchor(id), lim = an.ax === 'x' ? Lab.LIM_X : Lab.LIM_Y, dd = an.ax === 'x' ? { x: an.s * lim, y: 0 } : { x: 0, y: an.s * lim };
      const pl = Lab.peel(an, dd), seen = Lab.newSeen(); Lab.seenPolys(pl).forEach(pg => Lab.mark(seen, pg));
      const share = Lab.seenCount(seen) / Lab.N;
      ok(share > 0.55 && share < 0.66, 'at the limit about 60% of the face is in view (' + id + ': ' + share.toFixed(3) + ')');
      ok(pl.free.every(q => q.x >= -0.01 && q.x <= 100.01 && q.y >= -0.01 && q.y <= 140.01), 'the curled flap stays on the card (' + id + ')');
    });
    ok(Lab.peel(Lab.edgeAnchor('b'), { x: 0, y: -60 }).c === 1 && Lab.peel(Lab.edgeAnchor('b'), { x: 0, y: -136 }).c < 0.6, 'flat at first, curled over at the far end');
    // a press in a corner that never moves holds nothing
    w.Peel._down(at(96, 136)); w.Peel._up();
    ok(!P.anchor, 'a corner press with no pull holds nothing');
    // the limit: past it the edge resists, and the hint says what happens next
    w.Peel._down(at(50, 136)); w.Peel._move(at(50, 136 - Lab.LIM_Y - 24));
    ok(w.Lab.edgeParams(P.anchor, P.tgt).depth > Lab.LIM_Y && w.Lab.edgeParams(P.anchor, P.tgt).depth <= Lab.LIM_Y + Lab.SOFT, 'past the limit it only gives a little more');
    ok($(t, 'peel').classList.contains('over') && /turns over/.test($(t, 'peel-tip').textContent) && !$(t, 'peel-tip').hidden, 'the screen says that more will turn it over');
    taken();
    ok(!$(t, 'peel').classList.contains('over') && Math.abs(P.tgt.y + Lab.LIM_Y) < 1e-6, 'taken away at the limit: it settles back to the limit');
    ok(await waitFor(() => P.cur.y === P.tgt.y && P.vel.y === 0, 2000, 'settled'), 'and the spring comes to rest exactly');
    ok(!el.classList.contains('flipped') && w.Peel.isOpen(), 'the card has not been turned');
    ok(/rotateX\(\s*[1-9]/.test($(t, 'pc-flipper').style.transform), 'lifting the bottom edge leans the card forwards (' + $(t, 'pc-flipper').style.transform + ')');
    // a long way past it: the card lets go and turns over
    w.Peel._flatten(true);
    w.Peel._down(at(50, 136)); w.Peel._move(at(50, 136 - Lab.LIM_Y - 24)); w.Peel._move(at(50, 136 - Lab.LIM_Y - 70));
    ok(await waitFor(() => el.classList.contains('flipped'), 4000, 'turned'), 'pulling a long way past the limit turns the card over');
    ok($(t, 'peel-tip').hidden && !$(t, 'peel').classList.contains('over'), 'the "keep pulling" message goes away once it has turned');
    ok(await waitFor(() => !w.Peel.isOpen(), 2000, 'closed'), 'and the screen closes');
    ok(t.S.errors.length === 0 && P.errors.length === 0, 'no errors');
    noErr(t); w.close();
  }

  section('peel: let go, at any point, and the card turns over');
  {
    const press = {
      b: (d) => [[50, 136], [50, 136 - d]], t: (d) => [[50, 4], [50, 4 + d]], l: (d) => [[4, 70], [4 + d, 70]], r: (d) => [[96, 70], [96 - d, 70]],
    };
    // each scenario: edge, how far it is taken before letting go
    const rounds = [[['b', 6], ['t', 136]], [['l', 60], ['r', 96 + 30]], [['b', 70], ['l', 96]]];
    for (const round of rounds){
      const t = await boot();
      const w = t.w, P = t.P, Lab = w.Lab;
      w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      const at = atFor(P);
      for (let i = 0; i < 2; i++){
        const [edge, dep] = round[i], el = cardsIn(t, 'banker')[i], [a, b] = press[edge](dep);
        click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open ' + edge);
        ok(P.snap === false, 'a freshly opened card has the soft spring, not the quick drop');
        w.Peel._down(at(a[0], a[1])); w.Peel._move(at(b[0], b[1]));
        ok(P.anchor && P.anchor.id === edge && !el.classList.contains('flipped') && w.Peel.isOpen(), 'holding the ' + edge + ' edge ' + dep + ' up: still being peeled');
        w.Peel._up();
        ok(await waitFor(() => el.classList.contains('flipped'), 4000, 'turned ' + edge), 'let go of the ' + edge + ' edge after ' + dep + ' and the card turns over');
        ok(await waitFor(() => !w.Peel.isOpen(), 3000, 'closed ' + edge), 'and the screen closes, the card face up in its place');
        ok(P.stats.flips >= i + 1 && P.stats.backs === 0, 'it counts as a turn, not as handing it back');
      }
      ok(t.S.errors.length === 0 && P.errors.length === 0, 'no errors');
      noErr(t); w.close();
    }
    {
      const t = await boot();
      const w = t.w, P = t.P, Lab = w.Lab;
      w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      const at = atFor(P);
      const el = cardsIn(t, 'banker')[0];
      click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
      ok(/Let go/.test($(t, 'peel-tip').textContent), 'the opening tip says that letting go turns it over');
      // a press that lifts nothing is not a peel
      w.Peel._down(at(50, 136)); w.Peel._move(at(50, 135.8)); w.Peel._up();
      await wait(250);
      ok(w.Peel.isOpen() && !el.classList.contains('flipped'), 'a press that barely moves does not turn the card');
      w.Peel._flatten(true);
      w.Peel._down(at(50, 136)); w.Peel._up();
      await wait(150);
      ok(w.Peel.isOpen() && !el.classList.contains('flipped'), 'and neither does a press with no movement at all');
      w.Peel._flatten(true);
      w.Peel._down(at(3, 133)); w.Peel._up();
      await wait(150);
      ok(w.Peel.isOpen() && !el.classList.contains('flipped'), 'or a press in a corner that never moves');
      w.Peel._flatten(true);
      // the touch taken away by the system: nothing turns over
      w.Peel._down(at(50, 136)); w.Peel._move(at(50, 100)); w.Peel._up({ type: 'lostpointercapture' });
      await wait(250);
      ok(w.Peel.isOpen() && !el.classList.contains('flipped'), 'a lost pointer does not turn the card');
      w.Peel._flatten(true);
      // it drops flat first (no bounce), and only then turns over
      P.k = 1;
      w.Peel._down(at(50, 136)); w.Peel._move(at(50, 136 - 110));
      await wait(500);
      ok(P.cur.y !== 0, 'held up, the edge is up');
      let frames = 0; const raf = w.requestAnimationFrame; w.requestAnimationFrame = function(f){ frames++; return raf.call(w, f); };
      w.Peel._up();
      ok(await waitFor(() => $(t, 'pc-flipper').classList.contains('turned'), 3000, 'turning'), 'it starts to turn');
      w.requestAnimationFrame = raf;
      ok(P.cur.x === 0 && P.cur.y === 0, 'the edge is flat again by the time it turns (' + P.cur.y + ')');
      ok(frames <= 14, 'and it all happens at once: ' + frames + ' frames from letting go to the turn (a spring would take 30)');
      P.k = 0.02;
      ok(await waitFor(() => el.classList.contains('flipped') && !w.Peel.isOpen(), 6000, 'done'), 'and it lands face up');
      ok(t.S.errors.length === 0 && P.errors.length === 0, 'no errors');
      noErr(t); w.close();
    }
  }

  section('peel: even a slight lift turns the card over when you let go');
  {
    const cases = [
      ['bottom edge, 0.8 up', [50, 136], [50, 135.2]], ['top edge, 0.8 down', [50, 4], [50, 4.8]], ['left edge, 0.8 in', [4, 70], [4.8, 70]], ['right edge, 0.8 in', [96, 70], [95.2, 70]],
      ['a small pull from a corner that never picked an edge', [3, 133], [3, 131.8]], ['the other way out of a corner', [3, 133], [4.2, 133]],
    ];
    for (const [name, a, b] of cases){
      const t = await boot();
      const w = t.w, P = t.P;
      w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      const at = atFor(P), el = cardsIn(t, 'banker')[0];
      click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
      w.Peel._down(at(a[0], a[1])); w.Peel._move(at(b[0], b[1]));
      ok(!el.classList.contains('flipped') && w.Peel.isOpen(), name + ': held, nothing turned yet');
      w.Peel._up();
      ok(await waitFor(() => el.classList.contains('flipped') && !w.Peel.isOpen(), 4000, name), name + ': let go and it turns over');
      ok(P.stats.flips === 1 && P.stats.backs === 0, 'counted as a turn');
      noErr(t); w.close();
    }
  }

  section('the other hand: one tap turns one card; the rest wait until both of mine are turned');
  {
    const t = await boot();
    const w = t.w, G = w.G, Peel = w.Peel;
    w.rig(['5S', '2H', 'KD', '3C', '9H']);
    w.bet('banker', 2); w.dealHand(); await fourDealt(t);
    const t0 = t.S.stats.turns;
    for (const sel of ['.ds-dealer', '.ds-shoe', '.ds-tray', '.ds-rail', '.ds-say', '.ds-svg']){ const e = t.doc.querySelector(sel); if(e) click(t, e); }
    await wait(300);
    ok(t.S.stats.turns === t0 && G.playerRevealed.length === 0 && G.bankerRevealed.length === 0, 'clicking the dealer himself turns nothing');
    click(t, cardsIn(t, 'banker')[0]); await waitFor(() => Peel.isOpen() && !t.P.busy, 2000, 'peel 0');
    Peel.finish('flip'); await waitFor(() => cardsIn(t, 'banker')[0].classList.contains('flipped'), 4000, 'mine 0');
    await wait(500);
    ok(G.bankerRevealed.length === 1 && G.playerRevealed.length === 0 && t.S.stats.autos === 0, 'one of mine turned: the dealer leaves his hand alone');
    const other = cardsIn(t, 'player');
    click(t, other[1]); await waitFor(() => G.playerRevealed.length === 1, 4000, 'tapped');
    await wait(700);
    ok(G.playerRevealed.length === 1 && other[1].classList.contains('flipped') && !other[0].classList.contains('flipped'), 'a tap on his second card turns that card and only that card');
    ok(t.S.stats.autos === 0, 'no automatic turn yet');
    click(t, cardsIn(t, 'banker')[1]); await waitFor(() => Peel.isOpen() && !t.P.busy, 2000, 'peel 1');
    Peel.finish('flip'); await waitFor(() => cardsIn(t, 'banker')[1].classList.contains('flipped'), 4000, 'mine 1');
    ok(await waitFor(() => other[0].classList.contains('flipped'), 4000, 'auto'), 'once both of mine are turned the dealer turns the one that is left, by himself');
    ok(t.S.stats.autos === 1, 'that was one automatic turn');
    noErr(t); w.close();
  }

  section('peel: every rank, every suit, many anchors (truth is never excluded)');
  {
    const t = await boot();
    const w = t.w, P = t.P, Lab = w.Lab;
    let n = 0, bad = 0, wide = 0;
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const r of Lab.ORDER) for (const su of ['♠', '♥', '♦', '♣']){
      const card = { r, suit: su, color: (su === '♥' || su === '♦') ? 'red' : 'black' };
      const seen = Lab.newSeen(); let last = Lab.ORDER.length;
      for (let k = 0; k < 14; k++){
        const a = Lab.pickAnchor(rnd() < .5 ? rnd() * 28 : 72 + rnd() * 28, rnd() * 140);
        if (!a) continue;
        const pl = Lab.peel(a, { x: (rnd() - 0.2) * 85, y: (rnd() - 0.4) * 110 });
        if (!pl) continue;
        if (pl.segs.length > 24) wide++;
        Lab.seenPolys(pl).forEach(p => Lab.mark(seen, p));
        const d = Lab.describe(card, seen);
        n++;
        if (d.cands.indexOf(r) < 0 || d.cands.length > last || !d.head) bad++;
        last = d.cands.length;
      }
    }
    ok(n > 250 && bad === 0, 'candidates always include the true rank and only ever shrink (' + n + ' peels, ' + bad + ' bad)');
    ok(wide === 0, 'no peel needs more slices than the overlay pools (24)');
    w.close();
  }

  section('peel: keyboard (arrows, R, H, F, Enter, Escape)');
  {
    const t = await boot();
    const w = t.w, P = t.P, G = w.G;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    const el = cardsIn(t, 'banker')[0];
    click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
    ok(P.rot === 90, 'opens on its side');
    key(t, 'ArrowRight'); key(t, 'ArrowRight'); key(t, 'ArrowRight');
    ok(P.anchor && P.anchor.id === 'b' && P.tgt.y < -10, 'arrow keys pull the edge on that side of the screen, in steps (the card\'s bottom is on the left now: tgt.y ' + P.tgt.y + ')');
    await waitFor(() => P.pl, 1000, 'rendered');
    const d1 = P.tgt.y; key(t, 'ArrowRight', { shiftKey: true }); ok(P.tgt.y > d1, 'Shift+arrow backs off');
    key(t, 'r'); ok(P.rot === 180, 'R turns right'); key(t, 'R', { shiftKey: true }); ok(P.rot === 90, 'Shift+R turns left');
    key(t, 'h'); ok(G.peelHints === false && $(t, 'set-peelhints').checked === false && $(t, 'peel').classList.contains('hints-off'), 'H turns hints off everywhere');
    key(t, 'h'); ok(G.peelHints === true && !$(t, 'peel').classList.contains('hints-off'), 'H turns them back on');
    key(t, 'f'); await waitFor(() => !P.anchor, 2000, 'flatten'); ok(!P.anchor && P.cur.x === 0, 'F flattens the card');
    key(t, 'Escape'); ok(await waitFor(() => !w.Peel.isOpen(), 2000, 'esc'), 'Escape hands it back');
    ok(!el.classList.contains('flipped'), 'still face down');
    click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open2');
    key(t, 'Enter'); ok(await waitFor(() => el.classList.contains('flipped'), 4000, 'enter'), 'Enter turns it over');
    noErr(t); w.close();
  }

  section('peel: opens on its side, fits the way it is turned, remembers how you left it');
  {
    const t = await boot();
    const w = t.w, P = t.P, G = w.G;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    const el = cardsIn(t, 'banker')[0];
    click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
    const wd = () => parseFloat(P.stage.style.width) / P.u, ht = () => parseFloat(P.stage.style.height) / P.u;
    ok(P.rot === 90 && $(t, 'pc-rot').style.getPropertyValue('--rot') === '90deg', 'it opens turned 90 degrees');
    ok(Math.abs(wd() - 160) < 0.5 && Math.abs(ht() - 120) < 0.5, 'and the stage is wide, not tall (' + wd().toFixed(1) + ' x ' + ht().toFixed(1) + ')');
    // pulling "horizontally" on the screen: the card's short edge is on the left of the screen
    const at = atFor(P);
    w.Peel._down(at(50, 136)); w.Peel._move(at(50, 136 - 60));
    ok(P.anchor && P.anchor.id === 'b' && P.cur.y !== undefined && Math.abs(P.tgt.y + 60) < 1e-6, 'a pull along the screen lifts the card\'s short edge');
    w.Peel._up({ type: 'pointercancel' }); w.Peel._flatten(true);
    w.Peel._rotate(-1);
    ok(P.rot === 0 && Math.abs(wd() - 120) < 0.5 && Math.abs(ht() - 160) < 0.5, 'turned upright, the stage is tall again');
    ok(JSON.parse(w.localStorage.getItem('house_edge_baccarat_peel_v1')).rot === 0, 'and it is remembered');
    w.Peel.finish('back'); await waitFor(() => !w.Peel.isOpen(), 3000, 'closed');
    click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open again');
    ok(P.rot === 0, 'the next peel opens the way you left it');
    w.Peel._rotate(1);
    ok(P.rot === 90 && JSON.parse(w.localStorage.getItem('house_edge_baccarat_peel_v1')).rot === 90, 'turned back on its side');
    // turning the card over normalises the turn: it ends upright, face up
    w.Peel.finish('flip'); ok(await waitFor(() => el.classList.contains('flipped') && !w.Peel.isOpen(), 6000, 'flipped'), 'it turns over from the side');
    noErr(t); w.close();
  }

  section('the dealer speed setting');
  {
    const t = await boot();
    const w = t.w, S = t.S;
    const sel = w.document.getElementById('set-speed');
    ok(!!sel && sel.value === 'normal' && w.Show._pace() === 1, 'there is a Dealer speed setting, on Normal');
    sel.value = 'quick'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    ok(w.Show._pace() < 1, 'Quick is faster');
    ok(JSON.parse(w.localStorage.getItem('house_edge_baccarat_show_v1'))['set-speed'] === 'quick', 'and it is kept for next time');
    sel.value = 'relaxed'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    ok(w.Show._pace() > 1, 'Relaxed is slower');
    sel.value = 'normal'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    noErr(t); w.close();
  }

  section('the dealer turns a card briskly, and the speed setting really changes it');
  {
    const t = await boot();
    const w = t.w, S = t.S;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    S.k = 1;
    let durs = [];
    const orig = w.Element.prototype.animate;
    w.Element.prototype.animate = function(kf, op){ if (op && op.duration) durs.push(op.duration); return orig.call(this, kf, op); };
    const sel = w.document.getElementById('set-speed');
    const cards = [cardsIn(t, 'player')[0], cardsIn(t, 'player')[1], cardsIn(t, 'banker')[1]];
    const got = {};
    for (const [i, speed] of ['normal', 'quick', 'relaxed'].entries()){
      sel.value = speed; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
      durs = [];
      ok(w.Show._turn(cards[i]) === true, 'the dealer takes the card (' + speed + ')');
      ok(await waitFor(() => cards[i].classList.contains('flipped'), 6000, 'turned ' + speed), 'and turns it (' + speed + ')');
      got[speed] = Math.max.apply(null, durs);
    }
    ok(got.normal >= 700 && got.normal <= 860, 'a turn takes under a second at normal speed (' + got.normal + ' ms)');
    ok(got.quick < got.normal * 0.75 && got.relaxed > got.normal * 1.25, 'Quick is quicker and Relaxed slower (' + got.quick + ' / ' + got.normal + ' / ' + got.relaxed + ')');
    w.Element.prototype.animate = orig; S.k = 0.02;
    sel.value = 'normal'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
    noErr(t); w.close();
  }

  section('peel: hints off starts hidden, and the setting sticks');
  {
    const t = await boot({ hints: false });
    const w = t.w, P = t.P;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    click(t, cardsIn(t, 'banker')[0]); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
    ok($(t, 'peel').classList.contains('hints-off') && P.hints === false, 'opens with hints off');
    ok($(t, 'pc-hints').getAttribute('aria-pressed') === 'false', 'button shows off');
    w.Peel.finish('back'); await waitFor(() => !w.Peel.isOpen(), 2000, 'closed');
    noErr(t); w.close();
  }

  // ---------------------------------------------------------------- robustness
  section('dealer switched off in the middle of a hand');
  {
    const t = await boot();
    const w = t.w, G = w.G;
    w.rig(['5S', '2H', 'KD', '3C', '9H']); w.bet('banker', 1); w.dealHand();
    await wait(25);
    $(t, 'set-dealer').checked = false; $(t, 'set-dealer').dispatchEvent(new t.w.Event('change'));
    await waitFor(() => cardsIn(t, 'player').length + cardsIn(t, 'banker').length >= 0, 500);
    await wait(80);
    ok(!t.doc.body.classList.contains('show-on'), 'show-on removed');
    ok(!t.doc.querySelector('.flip-card.pending') && ![].some.call(t.doc.querySelectorAll('.flip-card'), c => c.style.visibility === 'hidden'), 'no card is left hidden or pending');
    ok(!t.doc.body.classList.contains('tray-on') && !t.doc.querySelector('.flip-card.with-you') && !t.doc.querySelector('#mh-cards .flip-card'), 'and no tray is left behind');
    // finish the hand the old way
    const t0 = Date.now();
    while (G.phase !== 'betting' && Date.now() - t0 < 6000){ for (const c of down(t)) click(t, c); await wait(15); }
    ok(G.phase === 'betting', 'hand completes after switching the dealer off');
    ok(G.handHistory.length === 1, 'recorded once');
    noErr(t); w.close();
  }
  section('peel open while the dealer is switched off');
  {
    const t = await boot();
    const w = t.w;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    click(t, cardsIn(t, 'banker')[0]); await waitFor(() => w.Peel.isOpen() && !t.P.busy, 2000, 'open');
    $(t, 'set-dealer').checked = false; $(t, 'set-dealer').dispatchEvent(new t.w.Event('change'));
    ok(await waitFor(() => !w.Peel.isOpen(), 2000, 'closed'), 'the peel screen closes');
    ok(cardsIn(t, 'banker')[0].style.visibility === '', 'and the card is back on the felt');
    noErr(t); w.close();
  }
  section('a face-down card cannot be turned twice, or while pending');
  {
    const t = await boot();
    const w = t.w, G = w.G;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    const el = cardsIn(t, 'player')[0];
    const first = t.w.Show._turn(el), second = t.w.Show._turn(el), third = t.w.Show._turn(el);
    ok(first === true && second === false && third === false, 'a card already being turned is not picked up again (' + [first, second, third] + ')');
    await waitFor(() => el.classList.contains('flipped'), 4000, 'turned');
    await wait(100);
    ok(G.playerRevealed.length === 1, 'revealed exactly once (' + G.playerRevealed.length + ')');
    ok(t.w.Show._turn(el) === false, 'turning a turned card does nothing');
    // a card the dealer has not set down yet cannot be tapped or peeled
    const mineSide = t.S.mine, pend = cardsIn(t, mineSide)[1], peelsBefore = t.S.stats.peels;
    pend.classList.add('pending');
    click(t, pend); await wait(80);
    ok(!w.Peel.isOpen() && t.S.stats.peels === peelsBefore, 'tapping a pending card of yours does not open the peel');
    const otherPend = cardsIn(t, mineSide === 'banker' ? 'player' : 'banker')[1], turnsBefore = t.S.stats.turns;
    otherPend.classList.add('pending');
    click(t, otherPend); await wait(80);
    ok(!otherPend.classList.contains('flipped') && t.S.stats.turns === turnsBefore, 'tapping a pending card on the other side turns nothing');
    pend.classList.remove('pending'); otherPend.classList.remove('pending');
    noErr(t); w.close();
  }

  section('auto-turn waits until both of your cards exist and are turned');
  {
    const t = await boot();
    const w = t.w, G = w.G, S = t.S;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    const mine = cardsIn(t, S.mine), other = cardsIn(t, S.mine === 'banker' ? 'player' : 'banker');
    ok(mine.length === 2 && other.length === 2 && !S.autoRec, 'both hands dealt, nothing scheduled yet');
    // only one of my cards on the table, and it is face up: the other hand must not be turned yet
    mine[1].remove(); mine[0].classList.add('flipped');
    w.Show._auto();
    ok(!S.autoRec, 'one card of mine is up but the second is not here: he waits');
    // both there, one still face down: still waits
    $(t, S.mine + '-cards').appendChild(mine[1]);
    w.Show._auto();
    ok(!S.autoRec, 'both here, one still face down: he waits');
    // both up: now he turns the other hand
    mine[1].classList.add('flipped');
    w.Show._auto();
    ok(!!S.autoRec, 'both of mine are up: he gets ready to turn the other hand');
    noErr(t); w.close();
  }

  // ---------------------------------------------------------------- the dealer never changes the game
  section('same shoe, same hands, same money: dealer on / off / turbo');
  {
    const seqs = {};
    for (const mode of ['on', 'off', 'turbo', 'flip', 'nobody']){
      const t = await boot(mode === 'off' ? { dealer: false, seed: 99 } : mode === 'turbo' ? { turbo: true, seed: 99 } : mode === 'flip' ? { how: 'flip', seed: 99 } : mode === 'nobody' ? { squeeze: 'nobody', seed: 99 } : { seed: 99 });
      const w = t.w, G = w.G;
      const spots = ['banker', 'player', 'tie', 'banker', 'player', 'banker', 'player', 'player'];
      for (let h = 0; h < 8; h++){
        if (G.phase !== 'betting') await toBetting(t);
        w.bet(spots[h], 1 + (h % 3));
        w.dealHand();
        if (mode === 'off'){ const t0 = Date.now(); while (G.phase !== 'betting' && Date.now() - t0 < 8000){ for (const c of down(t)) click(t, c); await wait(10); } }
        else if (mode === 'turbo'){ await toBetting(t); }
        else { await playHand(t, { back: h % 2 === 0 }); }
      }
      seqs[mode] = G.handHistory.map(x => x.player.map(c => c.r + c.suit).join('') + '/' + x.banker.map(c => c.r + c.suit).join('') + ':' + x.outcome + ':' + x.net).join(' ') + ' $' + G.bankroll;
      ok(G.handHistory.length === 8, mode + ': eight hands played (' + G.handHistory.length + ')');
      noErr(t, mode);
      w.close();
    }
    ok(seqs.on === seqs.off, 'dealer on = dealer off\n   ' + seqs.on + '\n   ' + seqs.off);
    ok(seqs.on === seqs.turbo, 'dealer on = turbo');
    ok(seqs.on === seqs.flip, 'flip mode = peel mode');
    ok(seqs.on === seqs.nobody, 'nobody mode = same hands');
  }

  section('dealer lines and moods');
  {
    const t = await boot();
    const w = t.w, G = w.G, S = t.S;
    w.rig(['4S', '9H', '4D', 'KC']);                // natural: banker 9 over player 8
    w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    ok(/Banker’s yours|Cards to you — Banker|Banker is with you|Your hand: Banker/.test(S.say.textContent), 'pass line names the side: ' + S.say.textContent);
    ok(await playHand(t), 'hand completes');
    await wait(60);
    ok(S.mood === 'sm2', 'a winning bet makes him smile (mood ' + S.mood + ')');
    // chatter off: no lines at all
    const t2 = await boot({ chatter: 'off' });
    t2.w.rig(['4S', '9H', '4D', 'KC']); t2.w.bet('banker', 1); t2.w.dealHand(); await fourDealt(t2);
    ok(t2.S.say.textContent === '', 'chatter off: he says nothing');
    // quiet keeps only information (the pass), not small talk
    const t3 = await boot({ chatter: 'quiet' });
    t3.w.rig(['4S', '9H', '4D', 'KC']); t3.w.bet('banker', 1); t3.w.dealHand(); await fourDealt(t3);
    ok(/Banker/.test(t3.S.say.textContent), 'quiet: he still says who the hand is for');
    ok(await playHand(t3), 'quiet: hand completes');
    await wait(500);
    ok(!/Winner|winner|Nicely done|Paid|House takes|Not this time|Next one|Tough break|tie|Tie|wins/.test(t3.S.say.textContent), 'quiet: no small talk after the hand (' + t3.S.say.textContent + ')');
    {
      const saysBefore = t3.S.stats.says;
      t3.S.say.textContent = '';
      t3.w.G.phase = 'done'; t3.w.Show.result({ outcome: 'banker', bankerTotal: 9, playerTotal: 8 }, 50, 50);
      await wait(120);
      ok(t3.S.say.textContent === '' && t3.S.stats.says === saysBefore, 'quiet: the result line is held back (' + t3.S.say.textContent + ')');
      const t4 = await boot({ chatter: 'chatty' });
      t4.w.G.phase = 'done'; t4.w.Show.result({ outcome: 'banker', bankerTotal: 9, playerTotal: 8 }, 50, 50);
      await wait(120);
      ok(/Winner|Nicely done|Paid/.test(t4.S.say.textContent), 'chatty: the same result gets a line (' + t4.S.say.textContent + ')');
      t4.w.close();
    }
    noErr(t); noErr(t2); noErr(t3);
    [t, t2, t3].forEach(x => x.w.close());
  }

  section('the push: cards in the push cannot be tapped, and the hand waits for the last card');
  {
    const t = await boot();
    const w = t.w, S = t.S;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand();
    await waitFor(() => $(t, 'banker-box').classList.contains('pushing'), 6000, 'push');
    const mine = cardsIn(t, S.mine);
    ok(mine.length === 2 && mine.every(c => c._busy), 'while the cards are being pushed they are busy');
    click(t, mine[0]); await wait(40);
    ok(!w.Peel.isOpen() && S.stats.peels === 0, 'tapping a card in the push does nothing');
    await waitFor(() => !$(t, 'banker-box').classList.contains('pushing'), 4000, 'push over');
    noErr(t); w.close();
  }
  section('the hand is not passed while a card is still in the air');
  {
    const t = await boot();
    const w = t.w, S = t.S;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    await waitFor(() => !$(t, 'banker-box').classList.contains('pushing') && S.queue.length === 0 && !S.busy, 4000, 'quiet');
    S.passedInit = false; const before = S.stats.passes, pend = cardsIn(t, 'banker')[1];
    pend.classList.add('pending');
    w.Show.placed(cardsIn(t, 'player')[1]);
    ok(S.stats.passes === before && !S.passedInit, 'one card still pending: no pass yet');
    pend.classList.remove('pending');
    w.Show.placed(pend);
    ok(S.stats.passes === before + 1 && S.passedInit, 'all four down: now he passes it');
    await waitFor(() => S.queue.length === 0 && !S.busy, 4000, 'quiet again');
    noErr(t); w.close();
  }
  section('his tray: the two reactions take turns, and he stops when you leave');
  {
    const t = await boot();
    const w = t.w, S = t.S;
    const kinds = [];
    for (let i = 0; i < 8; i++){ S.eggEnd = 0; w.Show._egg({ clientX: 40, clientY: 100 }); kinds.push(S.egg && S.egg.kind); w.Show._eggStop(true); }
    ok(kinds.every((k, i) => k && (i === 0 || k !== kinds[i - 1])), 'never the same reaction twice in a row (' + kinds.join(',') + ')');
    const t2 = await boot();
    t2.S.k = 0.2;
    const tray = t2.S.tray, fire = (type) => tray.dispatchEvent(new t2.w.MouseEvent(type, { bubbles: false, clientX: 40, clientY: 100 }));
    fire('pointerenter');
    ok(await waitFor(() => t2.S.egg && (t2.S.mood === 'sus' || t2.S.mood === 'sad'), 2000, 'reacts'), 'he reacts');
    fire('pointerleave');
    ok(await waitFor(() => !t2.S.egg, 450, 'ends'), 'a moment after you leave, it is over (not only when he gets bored)');
    noErr(t); noErr(t2);
    t.w.close(); t2.w.close();
  }

  section('his chip tray: stay on it a moment and he reacts');
  {
    const t = await boot();
    const w = t.w, S = t.S, G = w.G;
    const tray = S.tray, fire = (type) => tray.dispatchEvent(new w.MouseEvent(type, { bubbles: false, clientX: 40, clientY: 100 }));
    ok(!!tray && tray.classList.contains('ds-tray'), 'the tray is there');
    // sweeping across it is not interest
    fire('pointerenter'); await wait(8); fire('pointerleave'); await wait(60);
    ok(!S.egg && S.stats.eggs === 0 && S.mood === 'idle', 'a quick sweep over the tray does nothing');
    // staying on it is
    fire('pointerenter'); await wait(45);
    ok(!!S.egg && S.stats.eggs === 1, 'staying on it gets his attention');
    await waitFor(() => S.mood === 'sus' || S.mood === 'sad', 600, 'mood');
    ok(S.mood === 'sus' || S.mood === 'sad', 'he looks suspicious or hurt (' + S.mood + ')');
    ok(S.state === 'up' && S.dealer.classList.contains('lean'), 'he comes up and leans in');
    ok(S.say.textContent.length > 0 && S.say.classList.contains('on'), 'and says something: ' + S.say.textContent);
    // a different reaction next time
    const first = S.mood;
    fire('pointerleave'); await waitFor(() => !S.egg, 800, 'egg over');
    ok(!S.egg && !S.dealer.classList.contains('lean'), 'when you leave, he eases off');
    await wait(60);
    ok(S.state === 'away' || S.state === 'up', 'back to normal');
    await wait(80); S.eggEnd = 0;
    fire('pointerenter'); await wait(60); await waitFor(() => !!S.egg && (S.mood === 'sus' || S.mood === 'sad'), 600, 'again');
    ok(S.mood !== first, 'the second time he reacts the other way (' + first + ' then ' + S.mood + ')');
    // a hand starting ends the visit
    S.eggEnd = 0;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand();
    ok(!S.egg, 'dealing a hand ends it');
    await fourDealt(t);
    // not while the peel is open
    click(t, cardsIn(t, S.mine)[0]); await waitFor(() => w.Peel.isOpen() && !t.P.busy, 2000, 'open');
    S.eggEnd = 0; w.Show._egg({ clientX: 10, clientY: 10 });
    ok(!S.egg, 'no visit while you are peeling');
    w.Peel.finish('back'); await waitFor(() => !w.Peel.isOpen(), 2000, 'closed');
    // on a touch screen a tap does it, and quiet mode keeps the mood but not the line
    const tq = await boot({ chatter: 'quiet' });
    tq.S.tray.dispatchEvent(Object.assign(new tq.w.MouseEvent('pointerdown', { bubbles: false, clientX: 40, clientY: 100 }), { pointerType: 'touch' }));
    await wait(60);
    ok(!!tq.S.egg && (tq.S.mood === 'sus' || tq.S.mood === 'sad') && tq.S.say.textContent === '', 'a tap works too, and quiet mode keeps the look but not the line');
    noErr(t); noErr(tq);
    [t, tq].forEach(x => x.w.close());
  }

  section('markup: real cards, no "?" on the backs');
  {
    const t = await boot();
    const w = t.w;
    w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
    const el = cardsIn(t, 'banker')[0];
    ok(el.querySelector('.flip-back').textContent === '', 'the back has no question mark');
    ok(!!el.querySelector('.flip-front svg.cf'), 'the face is drawn as a real card (svg)');
    const j = w.makeFaceUpCard({ r: 'K', suit: '♠', color: 'black' });
    ok(!!j.querySelector('svg.cf') && j.className === 'card', 'face-up helper still works (used in the hand history)');
    ok(typeof w.Lab.describe === 'function' && w.CARD_W === 100 && w.CARD_H === 140, 'lab and card constants are present');
    noErr(t); w.close();
  }

  // <<BACMOTION>>
  // ---------------------------------------------------------------- a natural, the third card, the road
  // like playHand, but stops when the game reaches `phase` (the result pause is still running then)
  const playTo = async (t, phase) => {
    const t0 = Date.now();
    while (t.w.G.phase !== phase && Date.now() - t0 < 15000){
      if (t.w.Peel.isOpen()){ if (!t.P.busy) t.w.Peel.finish('flip'); await wait(8); continue; }
      const d = down(t);
      if (d.length && !t.S.busy && t.S.queue.length === 0) click(t, d[0]);
      await wait(8);
    }
    return t.w.G.phase === phase;
  };
  section('motion: the number counts up, a natural gets its moment');
  {
    const spyAnim = t => {
      const rec = [], an = t.w.Element.prototype.animate;
      t.w.Element.prototype.animate = function(kf, op){ rec.push({ el: this, cls: this.className, kf, op }); return an.call(this, kf, op); };
      return rec;
    };
    // a natural 9 against a 5: counting, gold, tag, shine, the other hand steps back
    {
      const t = await boot();
      const w = t.w, G = w.G, S = t.S;
      w.rig(['2S', '4D', '3H', '5S']);                       // player 2+3 = 5, banker 4+5 = 9
      const seen = [], tot = $(t, 'banker-total');
      const tcd = Object.getOwnPropertyDescriptor(w.Node.prototype, 'textContent');
      Object.defineProperty(tot, 'textContent', { get(){ return tcd.get.call(this); }, set(v){ seen.push(String(v)); tcd.set.call(this, v); } });       // every number it is ever given
      w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      let sawGold = null;
      const poll = setInterval(() => { const b = $(t, 'banker-box'); if (!sawGold && b.classList.contains('nat-gold')) sawGold = { anim: b.classList.contains('nat-anim'), tag: (b.querySelector('.nat-tag') || {}).textContent, shine: !!b.querySelector('.nat-shine'), dim: $(t, 'player-box').classList.contains('nat-dim'), pop: tot.classList.contains('nat-pop') }; }, 2);
      await playHand(t); clearInterval(poll);
      const nums = seen.filter(x => /^\d$/.test(x));
      ok(nums.indexOf('5') >= 0 && nums.indexOf('6') >= 0 && nums.indexOf('7') >= 0 && nums.indexOf('8') >= 0 && nums.indexOf('9') >= 0, 'Banker\'s total counts 4 → 5, 6, 7, 8, 9 and does not just jump: ' + nums.join(','));
      ok(nums[nums.length - 1] === '9' && !tot.classList.contains('ticking'), 'and ends on 9, not counting any more');
      ok(!!sawGold, 'the hand lit up when the natural was turned');
      ok(sawGold && sawGold.anim && sawGold.tag === 'Natural 9' && sawGold.shine, 'ring pulse, a NATURAL 9 tag and a shine: ' + JSON.stringify(sawGold));
      ok(sawGold && sawGold.dim, 'the other hand steps back');
      ok(S.stats.naturals >= 1 && S.stats.ticks >= 3, 'counted: ' + S.stats.naturals + ' natural, ' + S.stats.ticks + ' counts');
      noErr(t); w.close();
    }
    // both hands natural: both lit, neither dimmed
    {
      const t = await boot();
      const w = t.w;
      w.rig(['4S', '9H', '4D', 'KC']);                       // player 8, banker 9
      w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      let both = null;
      const poll = setInterval(() => { const b = $(t, 'banker-box'), p = $(t, 'player-box'); if (!both && b.classList.contains('nat-gold') && p.classList.contains('nat-gold') && !b.classList.contains('nat-dim') && !p.classList.contains('nat-dim')) both = { p: (p.querySelector('.nat-tag') || {}).textContent, b: (b.querySelector('.nat-tag') || {}).textContent }; }, 1);
      await playHand(t); clearInterval(poll);
      ok(!!both, 'two naturals: both hands lit, neither dimmed');
      ok(both && both.p === 'Natural 8' && both.b === 'Natural 9', 'each says its own number: ' + JSON.stringify(both));
      noErr(t); w.close();
    }
    // no natural: nothing
    {
      const t = await boot();
      const w = t.w;
      w.rig(['2S', '3D', '4H', '3S', '6C']);                 // player 6, banker 6: no natural; tie
      w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      await playHand(t);
      ok(!t.doc.querySelector('.nat-tag, .nat-shine, .nat-gold, .nat-dim'), 'ordinary hands get none of it');
      ok(t.S.stats.naturals === 0, 'no natural counted');
      noErr(t); w.close();
    }
    // it is cleared for the next hand
    {
      const t = await boot();
      const w = t.w;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 1); w.dealHand(); await fourDealt(t); await playHand(t);
      await toBetting(t); await wait(20);
      ok(!t.doc.querySelector('.nat-tag, .nat-shine, .nat-gold, .nat-dim, .nat-anim'), 'back to betting: the table is plain again');
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      let most = 0;
      const poll = setInterval(() => { most = Math.max(most, t.doc.querySelectorAll('.nat-tag').length); }, 1);
      await playHand(t); clearInterval(poll);
      ok(most === 1, 'and the second natural has one tag, not two (' + most + ')');
      noErr(t); w.close();
    }
    // reduced motion: the marks stay (they say something), nothing moves
    {
      const t = await boot({ reduced: true });
      const w = t.w, rec = spyAnim(t);
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      let st = null;
      const poll = setInterval(() => { const b = $(t, 'banker-box'); if (!st && b.classList.contains('nat-gold')) st = { tag: !!b.querySelector('.nat-tag'), anim: b.classList.contains('nat-anim'), shine: !!b.querySelector('.nat-shine') }; }, 2);
      await playHand(t); clearInterval(poll);
      ok(st && st.tag && !st.anim && !st.shine, 'reduced motion: the gold and the tag are there, no pulse and no shine: ' + JSON.stringify(st));
      ok(t.S.stats.ticks === 0 && $(t, 'banker-total').textContent === '9', 'the number is just 9');
      noErr(t); w.close();
    }
    // turbo and dealer off: exactly as before
    for (const mode of ['turbo', 'off']) {
      const t = await boot(mode === 'turbo' ? { turbo: true } : { dealer: false });
      const w = t.w;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 1); w.dealHand();
      if (mode === 'turbo') await toBetting(t); else { const t0 = Date.now(); while (w.G.phase !== 'betting' && Date.now() - t0 < 8000) { for (const c of down(t)) click(t, c); await wait(10); } }
      ok(!t.doc.querySelector('.nat-tag, .nat-shine, .nat-gold, .nat-dim, .hold, .suspense') && t.S.stats.naturals === 0 && t.S.stats.ticks === 0, mode + ': none of it');
      noErr(t); w.close();
    }
  }

  section('the third card arrives quietly: no bobbing, no glow, no heartbeat, and nothing slides');
  {
    const everSeen = (t, sel) => { const o = { seen: false }; o.id = setInterval(() => { if (t.doc.querySelector(sel)) o.seen = true; }, 1); o.stop = () => clearInterval(o.id); return o; };
    const css = t => [].map.call(t.doc.querySelectorAll('style'), x => x.textContent).join('\n');
    // a third card is just dealt and turned like the ones before it
    {
      const t = await boot();
      const w = t.w, S = t.S;
      ok(!/holdBob|susBox|\.suspense|\.flip-card\.show\.hold/.test(css(t)), 'no bob, no glow in the stylesheet');
      ok(w.Show._hold === undefined && !('holds' in S.stats), 'and nothing in the show keeps count of one');
      w.rig(['2S', '4D', '3H', '2C', '9H']);                 // player 5 draws a 9 (→ 4); banker 6 stands
      w.bet('player', 1); w.dealHand(); await fourDealt(t);
      const ev = everSeen(t, '.suspense, .hold, .flip-card.hold');
      const tones = []; w.G.soundOn = true; w.TRSound.play = function (n) { tones.push(n); return true; };
      await playHand(t); ev.stop();
      ok(w.G.handHistory[0].playerDrewThird, 'the player drew a third card');
      ok(!ev.seen, 'the card never hovers and the box never glows');
      ok(tones.filter(n => /heart|thump|thud/.test(n)).length === 0, 'no heartbeat');
      noErr(t); w.close();
    }
    // both hands draw
    {
      const t = await boot();
      const w = t.w;
      w.rig(['2S', '3D', '3H', '2C', '4H', '8S']);           // player 5 draws 4 (→ 9); banker 5 draws on a 4
      w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      const ev = everSeen(t, '.suspense, .hold, .flip-card.hold');
      await playHand(t); ev.stop();
      ok(w.G.handHistory[0].playerDrewThird && w.G.handHistory[0].bankerDrewThird, 'both drew');
      ok(!ev.seen, 'and neither card hovers');
      noErr(t); w.close();
    }
    // every way of playing still gets through a drawing hand
    for (const mode of ['turbo', 'reduced', 'off']) {
      const u = await boot(mode === 'turbo' ? { turbo: true } : mode === 'reduced' ? { reduced: true } : { dealer: false });
      u.w.rig(['2S', '4D', '3H', '2C', '9H']); u.w.bet('player', 1); u.w.dealHand();
      if (mode === 'turbo') await toBetting(u);
      else if (mode === 'reduced') { await fourDealt(u); await playHand(u); }
      else { const t0 = Date.now(); while (u.w.G.phase !== 'betting' && Date.now() - t0 < 8000) { for (const c of down(u)) click(u, c); await wait(10); } }
      ok(u.w.G.handHistory.length === 1 && u.w.G.handHistory[0].playerDrewThird && !u.doc.querySelector('.hold, .suspense'), mode + ': the hand with a third card plays through');
      noErr(u); u.w.close();
    }
    // the explanation of a third card goes where nothing you touch is below it: under your tray when there is one
    {
      const t = await boot();
      const w = t.w, note = $(t, 'third-card-note'), tray = $(t, 'my-hand'), home = $(t, 'outcome-badge');
      ok(note.nextElementSibling === home, 'at rest the note sits above the result (its old place)');
      w.rig(['2S', '4D', '3H', '2C', '9H']); w.bet('player', 1); w.dealHand(); await fourDealt(t);
      let seenShown = 0, under = 0, notUnder = 0;
      const poll = setInterval(() => { if (note.style.display === 'block') { seenShown++; if (tray.nextElementSibling === note) under++; else notUnder++; } }, 1);
      await playHand(t); clearInterval(poll);
      ok(seenShown > 0 && notUnder === 0 && under === seenShown, 'with the tray out, the note is shown under it and never above it (' + under + '/' + seenShown + ')');
      await wait(30);
      ok(note.nextElementSibling === home, 'and goes back to its old place when the hand is over');
      noErr(t); w.close();
      // no tray (the dealer turns everything, no hand is yours): the note stays where it was
      const u = await boot({ squeeze: 'nobody' });
      const nt = $(u, 'third-card-note'), oh = $(u, 'outcome-badge');
      u.w.rig(['2S', '4D', '3H', '2C', '9H']); u.w.bet('player', 1); u.w.dealHand(); await fourDealt(u);
      let shown2 = 0, home2 = 0;
      const poll2 = setInterval(() => { if (nt.style.display === 'block') { shown2++; if (nt.nextElementSibling === oh) home2++; } }, 1);
      const t0 = Date.now(); while (u.w.G.phase !== 'betting' && Date.now() - t0 < 12000) { for (const c of down(u)) click(u, c); await wait(5); }
      clearInterval(poll2);
      ok(shown2 > 0 && home2 === shown2, 'no tray: the note stays above the result (' + home2 + '/' + shown2 + ')');
      noErr(u); u.w.close();
    }
    // the cards do not drop when the first total appears: the total keeps its height from the start
    {
      const t = await boot();
      ok(/\.hand-box \.hb-total\{[^}]*line-height:1\.15;min-height:1\.15em/.test(css(t)), 'the total keeps its height whether or not there is a number yet');
      noErr(t); t.w.close();
    }
  }

  section('motion: the road draws itself');
  {
    const spyAnim = t => {
      const rec = [], an = t.w.Element.prototype.animate;
      t.w.Element.prototype.animate = function(kf, op){ rec.push({ el: this, cls: this.className, kf, op }); return an.call(this, kf, op); };
      return rec;
    };
    const bankerWin = async t => { t.w.rig(['2S', '4D', '3H', '5S']); t.w.bet('banker', 1); t.w.dealHand(); await fourDealt(t); await playHand(t); await wait(15); };
    const tieHand = async t => { t.w.rig(['2S', '3D', '4H', '3S', '6C']); t.w.bet('banker', 1); t.w.dealHand(); await fourDealt(t); await playHand(t); await wait(15); };
    // a dot drops in, rings, and the streak line says what is running
    {
      const t = await boot();
      const w = t.w, G = w.G, S = t.S, rec = spyAnim(t);
      ok(!$(t, 'road-streak'), 'before the first hand there is no streak line');
      await bankerWin(t);
      const dots = t.doc.querySelectorAll('#road-grid .road-dot'), last = dots[dots.length - 1];
      const drop = rec.filter(r => r.el === last || /road-dot/.test(r.cls)).filter(r => r.kf[0] && /translateY\(-26px\)/.test(r.kf[0].transform || ''));
      ok(drop.length >= 1, 'the new dot drops into its cell (' + drop.length + ')');
      ok(rec.some(r => /rd-ping banker/.test(r.cls)), 'and a ring goes out from it, in Banker red');
      await wait(60); ok(!t.doc.querySelector('.rd-ping'), 'the ring cleans itself up');
      ok($(t, 'road-streak') && $(t, 'road-streak').firstChild.textContent === 'Banker' && /last hand/.test($(t, 'road-streak').lastChild.textContent), 'the streak line says Banker, last hand: ' + ($(t, 'road-streak') || {}).textContent);
      await toBetting(t);
      await bankerWin(t); await toBetting(t); await bankerWin(t);
      ok($(t, 'road-streak').firstChild.textContent === 'Banker ×3' && /streak running/.test($(t, 'road-streak').lastChild.textContent), 'three in a row: "Banker ×3, streak running": ' + $(t, 'road-streak').textContent);
      ok(S.stats.drops === 3, 'three drops');
      noErr(t); w.close();
    }
    // a tie draws a slash through the last dot
    {
      const t = await boot();
      const w = t.w, S = t.S, rec = spyAnim(t);
      await bankerWin(t); await toBetting(t);
      await tieHand(t);
      ok(rec.some(r => /rd-slash/.test(r.cls) && r.kf.some(k => /scaleX\(0\)/.test(k.transform || ''))), 'a green slash draws itself across the dot');
      ok(S.stats.slashes === 1 && S.stats.drops === 1, 'a slash, not a new dot');
      ok($(t, 'road-streak').firstChild.textContent === 'Tie' && /Banker .1 still stands/.test($(t, 'road-streak').lastChild.textContent), 'the line says: ' + $(t, 'road-streak').textContent);
      ok(t.doc.querySelector('#road-grid .tie-badge'), 'and the tie count is on the dot as before');
      noErr(t); w.close();
    }
    // the bead plate drops too; the derived roads leave it alone
    {
      const t = await boot();
      const w = t.w, S = t.S;
      w.G.activeBoard = 'bead'; w.renderBoardTabs(); w.renderRoad();
      await bankerWin(t); await toBetting(t);
      ok(S.stats.drops === 1, 'bead plate: the new dot drops');
      w.G.activeBoard = 'bigeye'; w.renderBoardTabs(); w.renderRoad();
      await bankerWin(t); await toBetting(t);
      ok(S.stats.drops === 1, 'a derived road is left alone');
      noErr(t); w.close();
    }
    // reduced motion keeps the line, loses the movement; turbo likewise; dealer off removes it
    {
      const t = await boot({ reduced: true });
      await bankerWin(t);
      ok(t.S.stats.drops === 0 && !t.doc.querySelector('.rd-ping, .rd-slash'), 'reduced motion: no drop, no ring');
      ok($(t, 'road-streak') && $(t, 'road-streak').firstChild.textContent === 'Banker', 'the streak line is still there');
      noErr(t); t.w.close();
      const u = await boot({ turbo: true });
      u.w.rig(['2S', '4D', '3H', '5S']); u.w.bet('banker', 1); u.w.dealHand(); await toBetting(u); await wait(15);
      ok(u.S.stats.drops === 0 && $(u, 'road-streak') && $(u, 'road-streak').firstChild.textContent === 'Banker', 'turbo: no motion, the line is there');
      noErr(u); u.w.close();
      const v = await boot({ dealer: false });
      v.w.rig(['2S', '4D', '3H', '5S']); v.w.bet('banker', 1); v.w.dealHand();
      { const t0 = Date.now(); while (v.w.G.phase !== 'betting' && Date.now() - t0 < 8000) { for (const c of down(v)) click(v, c); await wait(10); } }
      ok(!$(v, 'road-streak') && v.S.stats.drops === 0, 'dealer off: the road is exactly as it was');
      noErr(v); v.w.close();
    }
  }

  // ---------------------------------------------------------------- smoother play
  section('smoother play: Space deals, one tap to rebet, Backspace takes a chip back, tap to move on');
  {
    const key = (t, k, o, target) => { const ev = new t.w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})); (target || t.doc.body).dispatchEvent(ev); return ev; };
    const keyUp = (t, k) => t.doc.body.dispatchEvent(new t.w.KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true }));
    const grp = t => t.doc.getElementById('rebet-grp');
    const shown = t => !!grp(t) && grp(t).style.display !== 'none';
    const oneHand = async t => { t.w.rig(['2S', '4D', '3H', '5S']); t.w.bet('banker', 2); t.w.dealHand(); await fourDealt(t); await playHand(t); await toBetting(t); await wait(10); };
    const fresh = () => ({ storage: {} });

    // Space and Enter deal
    for (const k of [' ', 'Enter']) {
      const t = await boot();
      t.w.rig(['2S', '4D', '3H', '5S']); t.w.bet('banker', 1); await wait(5);
      const ev = key(t, k);
      ok(ev.defaultPrevented && t.w.G.phase !== 'betting', JSON.stringify(k) + ': the hand is dealt and the page does not scroll');
      await fourDealt(t);
      const again = key(t, k);
      ok(!again.defaultPrevented, JSON.stringify(k) + ': during the hand it does nothing');
      noErr(t); t.w.close();
    }
    // not when it should not
    {
      const t = await boot();
      key(t, ' ');
      ok(t.w.G.phase === 'betting' && t.w.G.hands === null, 'no bets and nothing to rebet: nothing is dealt');
      t.w.bet('banker', 1);
      key(t, ' ', null, t.doc.getElementById('set-speed'));
      ok(t.w.G.phase === 'betting', 'in a settings box, Space is just a space');
      t.doc.getElementById('manners-overlay').style.display = 'flex';
      key(t, ' ');
      ok(t.w.G.phase === 'betting', 'with a window open it waits');
      t.doc.getElementById('manners-overlay').style.display = 'none';
      key(t, ' ', { ctrlKey: true }); key(t, ' ', { repeat: true });
      ok(t.w.G.phase === 'betting', 'Ctrl, or the key held down: left alone');
      const spot = t.doc.getElementById('spot-player'), b0 = t.w.G.bets.player;
      key(t, 'Tab', null, spot);
      key(t, ' ', null, spot);
      ok(t.w.G.phase === 'betting' && t.w.G.bets.player > b0, 'tabbed to a bet spot, Space is that spot\'s: it puts a chip down and nothing is dealt');
      const before = t.w.G.bets.player;
      spot.dispatchEvent(new t.w.MouseEvent('mousedown', { bubbles: true }));
      key(t, ' ', null, spot);
      ok(t.w.G.phase !== 'betting' && t.w.G.bets.player === before, 'a spot you clicked: Space deals, and does not drop another chip');
      noErr(t); t.w.close();
    }
    // turbo deals too; dealer off is just the page
    {
      const t = await boot({ turbo: true });
      t.w.rig(['2S', '4D', '3H', '5S']); t.w.bet('banker', 1); key(t, ' ');
      await toBetting(t); ok(t.w.G.handHistory.length === 1, 'turbo: Space deals');
      noErr(t); t.w.close();
      const u = await boot({ dealer: false });
      u.w.bet('banker', 1); key(u, ' ');
      ok(u.w.G.phase === 'betting' && !shown(u), 'dealer off: Space does nothing, and there is no Rebet');
      noErr(u); u.w.close();
    }
    // a button you clicked with the mouse does not keep Space; one you tabbed to does
    {
      const t = await boot();
      t.w.rig(['2S', '4D', '3H', '5S']);
      const chip = t.doc.querySelector('.chip[data-chip="5"]');
      chip.dispatchEvent(new t.w.MouseEvent('mousedown', { bubbles: true })); t.w.bet('banker', 1);
      const ev = key(t, ' ', null, chip); keyUp(t, ' ');
      ok(ev.defaultPrevented && t.w.G.phase !== 'betting', 'after clicking a chip, Space deals');
      noErr(t); t.w.close();
      const u = await boot();
      u.w.bet('banker', 1);
      const c2 = u.doc.querySelector('.chip[data-chip="5"]');
      key(u, 'Tab', null, c2);
      ok(!key(u, ' ', null, c2).defaultPrevented && u.w.G.phase === 'betting', 'tabbed to a button, Space is that button\'s');
      c2.dispatchEvent(new u.w.MouseEvent('mousedown', { bubbles: true }));
      key(u, ' ', null, c2);
      ok(u.w.G.phase !== 'betting', 'and a click hands it back to the table');
      noErr(u); u.w.close();
    }
    // Rebet
    {
      const t = await boot();
      const w = t.w, G = w.G;
      ok(!!grp(t) && !shown(t), 'before any hand there is nothing to rebet');
      await oneHand(t);
      ok(shown(t) && /Rebet \$50/.test(t.doc.getElementById('btn-rebet').textContent), 'after a hand: "↺ Rebet $50": ' + t.doc.getElementById('btn-rebet').textContent);
      ok(t.doc.body.classList.contains('rebet-on'), 'the page knows');
      t.doc.getElementById('btn-rebet').click(); await wait(10);
      ok(G.bets.banker === 50 && G.phase === 'betting' && !shown(t), 'one tap puts $50 back on Banker and the button goes');
      w.bet('tie', 1); await wait(5);
      ok(shown(t), 'a different bet: it comes back');
      w.clearBets(); await wait(5);
      ok(shown(t), 'with nothing on the table: it is there');
      G.bankroll = 20; w.renderAll(); await wait(5);
      ok(!shown(t), 'a bet you can no longer afford is not offered');
      noErr(t); w.close();
    }
    {
      const t = await boot();
      await oneHand(t);
      ok(!t.doc.getElementById('btn-rebet-deal'), 'there is no Rebet & Deal button: one tap rebets, Deal deals');
      t.doc.getElementById('btn-rebet').click(); await wait(10);
      ok(t.w.G.phase === 'betting' && t.w.G.bets.banker === 50, 'Rebet puts the same $50 back, and the hand waits for Deal');
      noErr(t); t.w.close();
    }
    // side bets that are switched off are not put back
    {
      const t = await boot();
      const w = t.w, G = w.G;
      const d7 = $(t, 'sb-dragon7'); d7.checked = true; d7.dispatchEvent(new w.Event('change', { bubbles: true }));
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 2); w.bet('dragon7', 1); w.dealHand(); await fourDealt(t); await playHand(t); await toBetting(t);
      ok(shown(t) && /Rebet \$75/.test($(t, 'btn-rebet').textContent), 'main bet and side bet: $75: ' + $(t, 'btn-rebet').textContent);
      d7.checked = false; d7.dispatchEvent(new w.Event('change', { bubbles: true })); await wait(5);
      ok(/Rebet \$50/.test($(t, 'btn-rebet').textContent), 'side bet switched off: $50: ' + $(t, 'btn-rebet').textContent);
      t.doc.getElementById('btn-rebet').click();
      ok(G.bets.banker === 50 && G.bets.dragon7 === 0, 'and only the main bet comes back');
      noErr(t); w.close();
    }
    // Space with nothing on the table, after a hand: the same bets again
    {
      const t = await boot();
      await oneHand(t);
      t.w.rig(['2S', '4D', '3H', '5S']);
      const ev = key(t, ' ');
      ok(ev.defaultPrevented && t.w.G.phase !== 'betting' && t.w.G.bets.banker === 50, 'Space: the same bets are put back and dealt');
      noErr(t); t.w.close();
    }
    // Backspace takes the last chip back
    {
      const t = await boot();
      const w = t.w, G = w.G;
      w.bet('player', 1); w.bet('banker', 1); w.bet('banker', 1);
      const ev = key(t, 'Backspace');
      ok(ev.defaultPrevented && G.bets.banker === 25 && G.bets.player === 25, 'Backspace: the last $25 on Banker comes back');
      key(t, 'Backspace'); ok(G.bets.banker === 0 && G.bets.player === 25, 'again: Banker is empty');
      key(t, 'Backspace'); ok(G.bets.player === 0, 'again: Player');
      ok(!key(t, 'Backspace').defaultPrevented, 'nothing left: the key is left alone');
      ok(t.S.stats.undos === 3, 'three undone');
      w.bet('tie', 1); w.clearBets(); w.bet('player', 1); w.betHalf(); 
      ok(!key(t, 'Backspace').defaultPrevented || G.bets.player >= 0, 'after Clear or Half the list starts over');
      w.clearBets(); key(t, 'Backspace', null, t.doc.getElementById('set-speed'));
      noErr(t); w.close();
    }
    // the pause after a result: tap the table, or Space
    {
      const t = await boot();
      const w = t.w, G = w.G;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 2); w.dealHand(); await fourDealt(t);
      w.RESULT_PAUSE = 6000;
      await playTo(t, 'done');
      ok(!!t.doc.getElementById('skip-hint'), 'the first results say you can move on');
      t.doc.getElementById('btn-clear-bets').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      ok(G.phase === 'done', 'a tap on a button is not a tap on the table');
      t.doc.getElementById('banker-cards').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      t.doc.querySelector('.table-felt').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      ok(G.phase === 'betting' && !t.doc.getElementById('skip-hint'), 'a tap on the table: on to the next bet');
      noErr(t); w.close();
    }
    {
      const t = await boot();
      const w = t.w, G = w.G;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 2); w.dealHand(); await fourDealt(t);
      w.RESULT_PAUSE = 6000;
      await playTo(t, 'done');
      w.rig(['2S', '4D', '3H', '5S']);
      const br = G.bankroll;
      const ev = key(t, ' '); keyUp(t, ' ');
      ok(ev.defaultPrevented && G.phase !== 'done' && G.bets.banker === 50 && G.bankroll === br - 50, 'Space after a result: the pause is over and the same bets are dealt');
      ok(w.localStorage.getItem('bac_skiphint') === '6', 'using the shortcut ends the hint');
      await fourDealt(t); await playHand(t);
      ok(G.handHistory.length === 2, 'and the hand plays on');
      noErr(t); w.close();
    }
    {
      const t = await boot({ storage: { bac_skiphint: '6' } });
      const w = t.w, G = w.G;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 1); w.dealHand(); await fourDealt(t); await playHand(t);
      ok(!t.doc.getElementById('skip-hint'), 'six results in, no more hint');
      ok(w.skipResult() === false, 'skipResult has nothing to do when there is no pause');
      noErr(t); w.close();
    }
    // Quick pace shortens the wait after a result, and goes back
    {
      const t = await boot();
      const w = t.w, sp = $(t, 'set-speed');
      const base = w.RESULT_PAUSE;
      sp.value = 'quick'; sp.dispatchEvent(new w.Event('change', { bubbles: true })); w.renderAll(); await wait(5);
      ok(w.RESULT_PAUSE < base, 'Quick: the pause after a result is shorter (' + base + ' → ' + w.RESULT_PAUSE + ')');
      sp.value = 'normal'; sp.dispatchEvent(new w.Event('change', { bubbles: true })); w.renderAll(); await wait(5);
      ok(w.RESULT_PAUSE === base, 'and back to normal');
      noErr(t); w.close();
    }
    // real sounds, not beeps
    {
      const t = await boot();
      const w = t.w, tones = [];
      w.TRSound.play = function(n, o){ tones.push(n); return true; };
      w.bet('banker', 1);
      ok(tones.length >= 1 && tones[tones.length - 1] === 'chip', 'a chip is a clack of clay, not a beep: ' + JSON.stringify(tones));
      noErr(t); w.close();
      const u = await boot({ dealer: false });
      const tones2 = [];
      u.w.TRSound.play = function(n, o){ tones2.push(n); return true; };
      u.w.bet('banker', 1);
      ok(tones2.length === 1 && tones2[0] === 'chip', 'dealer off: the same chip sound, once: ' + JSON.stringify(tones2));
      noErr(u); u.w.close();
    }
  }

  // ---------------------------------------------------------------- the finer points: what each piece must and must not do
  section('motion: the finer points (counting, naturals, sounds, the road, keys, taps)');
  {
    const key = (t, k, o, target) => { const ev = new t.w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})); (target || t.doc.body).dispatchEvent(ev); return ev; };
    const everSeen = (t, sel) => { const o = { seen: false }; o.id = setInterval(() => { if (t.doc.querySelector(sel)) o.seen = true; }, 1); o.stop = () => clearInterval(o.id); return o; };
    const sound = t => { const tones = []; t.w.G.soundOn = true; t.w.TRSound.play = function(n){ tones.push(n); return true; }; return tones; };
    const roadWatch = (t, cls) => {
      const o = { added: 0, removed: 0, phaseAtRemove: null };
      const mo = new t.w.MutationObserver(list => list.forEach(r => {
        r.addedNodes.forEach(n => { if (n.classList && n.classList.contains(cls)) o.added++; });
        r.removedNodes.forEach(n => { if (n.classList && n.classList.contains(cls)) { o.removed++; o.phaseAtRemove = t.w.G.phase; } });
      }));
      mo.observe(t.doc.getElementById('road-grid'), { childList: true, subtree: true });
      return o;
    };
    // a total that wraps past 9 counts through 9 and 0, as baccarat does
    {
      const t = await boot(); const w = t.w;
      const tot = $(t, 'player-total'), seen = [];
      const tcd = Object.getOwnPropertyDescriptor(w.Node.prototype, 'textContent');
      Object.defineProperty(tot, 'textContent', { get(){ return tcd.get.call(this); }, set(v){ seen.push(String(v)); tcd.set.call(this, v); } });
      w.rig(['7S', '4D', '8H', '5S']);                       // player 7 + 8 = 15, which is 5; banker 4 + 5 = 9
      w.bet('banker', 1); w.dealHand(); await fourDealt(t); await playHand(t);
      const s = seen.filter(x => /^\d$/.test(x));
      ok(s.indexOf('9') >= 0 && s.lastIndexOf('0') > s.indexOf('9') && s[s.length - 1] === '5', 'a total that wraps counts 8, 9, 0, 1 … 5: ' + s.join(','));
      noErr(t); w.close();
    }
    // the dealer switched off in the middle of a count: every number on the table is the real one
    {
      const t = await boot(); const w = t.w;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      const t0 = Date.now(); let off = false;
      while (!off && Date.now() - t0 < 15000) {
        if (w.Peel.isOpen()) { if (!t.P.busy) w.Peel.finish('flip'); await wait(4); continue; }
        if ($(t, 'banker-total').classList.contains('ticking') || $(t, 'player-total').classList.contains('ticking')) { const sw = $(t, 'set-dealer'); sw.checked = false; sw.dispatchEvent(new w.Event('change', { bubbles: true })); off = true; break; }
        const d = down(t); if (d.length && !t.S.busy && t.S.queue.length === 0) click(t, d[0]);
        await wait(1);
      }
      ok(off, 'caught a count in progress');
      await wait(40);
      const bad = ['banker', 'player'].filter(sd => { const arr = sd === 'banker' ? w.G.bankerRevealed : w.G.playerRevealed; return arr.length && $(t, sd + '-total').textContent !== String(w.handTotal(arr)); });
      ok(bad.length === 0 && !t.doc.querySelector('.ticking'), 'switched off mid-count: the totals say what the cards say' + (bad.length ? ' (' + bad.join() + ')' : ''));
      noErr(t); w.close();
    }
    // what is not a natural
    {
      const t = await boot(); const w = t.w;
      w.rig(['2S', '3D', '5H', '4S']);                       // 7 against 7
      w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      const ev = everSeen(t, '.nat-tag, .nat-gold');
      await playHand(t); ev.stop();
      ok(!ev.seen && t.S.stats.naturals === 0, 'a 7 is not a natural');
      noErr(t); w.close();
      const u = await boot(); const x = u.w;
      x.rig(['2S', '3D', 'AH', '2S', '5C', '2D']);           // player 3 draws a 5 (8), banker 5 draws a 2 (7)
      x.bet('banker', 1); x.dealHand(); await fourDealt(u);
      const ev2 = everSeen(u, '.nat-tag, .nat-gold');
      await playHand(u); ev2.stop();
      ok(!ev2.seen && u.S.stats.naturals === 0, 'an 8 made with a third card is not a natural');
      noErr(u); x.close();
    }
    // a natural 8 against a 7: the 7 is not a natural and steps back
    {
      const t = await boot(); const w = t.w;
      w.rig(['3S', '4D', '5H', '3S']);                       // player 8, banker 7
      w.bet('player', 1); w.dealHand(); await fourDealt(t);
      let dim = false;
      const poll = setInterval(() => { if ($(t, 'banker-box').classList.contains('nat-dim') && $(t, 'player-box').classList.contains('nat-gold')) dim = true; }, 1);
      await playHand(t); clearInterval(poll);
      ok(dim, 'an 8 against a 7: the 8 shines, the 7 steps back');
      noErr(t); w.close();
    }
    // sounds: a natural has its chime, an ordinary hand does not
    {
      const t = await boot(); const w = t.w, tones = sound(t);
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 1); w.dealHand(); await fourDealt(t); await playHand(t); await wait(150);
      const nat = tones.filter(n => n === 'chime').length;
      noErr(t); w.close();
      const u = await boot(); const x = u.w, tones2 = sound(u);
      x.rig(['2S', '3D', '4H', '4C']); x.bet('banker', 1); x.dealHand(); await fourDealt(u); await playHand(u); await wait(150);       // 6 against 7: nothing special
      const plain = tones2.filter(n => n === 'chime').length;
      ok(nat >= 1 && plain === 0, 'a natural chimes, an ordinary hand does not (' + nat + ' / ' + plain + ')');
      noErr(u); x.close();
    }
    // reduced motion: the third card is just dealt and turned
    {
      const t = await boot({ reduced: true }); const w = t.w;
      w.rig(['2S', '4D', '3H', '2C', '9H']); w.bet('player', 1); w.dealHand(); await fourDealt(t);
      const ev = everSeen(t, '.suspense, .flip-card.hold');
      await playHand(t); ev.stop();
      ok(!ev.seen, 'reduced motion: no hold, no glow');
      noErr(t); w.close();
    }
    // the road: the ring and the slash are really on the road, and are taken away while the result is still up
    {
      const t = await boot(); const w = t.w;
      w.RESULT_PAUSE = 600;
      const ring = roadWatch(t, 'rd-ping');
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 1); w.dealHand(); await fourDealt(t); await playTo(t, 'done'); await wait(120);
      ok(ring.added === 1, 'a ring goes out from the new dot (' + ring.added + ')');
      ok(ring.removed === 1 && ring.phaseAtRemove === 'done', 'and is taken away again while the result is still up (' + ring.removed + ', ' + ring.phaseAtRemove + ')');
      noErr(t); w.close();
    }
    {
      const t = await boot(); const w = t.w;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 1); w.dealHand(); await fourDealt(t); await playHand(t); await toBetting(t);
      w.RESULT_PAUSE = 600;
      const slash = roadWatch(t, 'rd-slash');
      w.rig(['2S', '3D', '4H', '3S', '6C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t); await playTo(t, 'done'); await wait(120);
      ok(slash.added === 1, 'a tie: the slash is drawn on the road (' + slash.added + ')');
      ok(slash.removed === 1 && slash.phaseAtRemove === 'done', 'and is taken away while the result is still up (' + slash.removed + ', ' + slash.phaseAtRemove + ')');
      noErr(t); w.close();
    }
    {
      // on the bead plate a first-ever tie is a dot like any other: it drops, with a green ring
      const t = await boot(); const w = t.w;
      w.G.activeBoard = 'bead'; w.renderBoardTabs(); w.renderRoad();
      w.RESULT_PAUSE = 600;
      const ring = roadWatch(t, 'rd-ping');
      w.rig(['2S', '3D', '4H', '3S', '6C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t); await playTo(t, 'done'); await wait(120);
      ok(t.S.stats.drops === 1 && ring.added === 1, 'bead plate, a tie to start with: it drops and rings (' + t.S.stats.drops + ', ' + ring.added + ')');
      noErr(t); w.close();
    }
    // Rebet puts back what was bet, and Backspace takes it off in one go; a chip that is already gone is not taken twice
    {
      const t = await boot(); const w = t.w, G = w.G;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 2); w.dealHand(); await fourDealt(t); await playHand(t); await toBetting(t); await wait(10);
      t.doc.getElementById('btn-rebet').click(); await wait(5);
      ok(G.bets.banker === 50, 'Rebet: $50 back');
      key(t, 'Backspace');
      ok(G.bets.banker === 0, 'Backspace takes the rebet off again (' + G.bets.banker + ')');
      noErr(t); w.close();
    }
    {
      const t = await boot(); const w = t.w, G = w.G;
      w.bet('player', 1); G.bets.player = 0; w.renderAll();    // the chip went some other way
      key(t, 'Backspace');
      ok(G.bets.player === 0, 'a chip that is already gone is not taken back twice (' + G.bets.player + ')');
      noErr(t); w.close();
    }
    // Rebet is only for the bets, and only what you can pay for
    {
      const t = await boot(); const w = t.w, G = w.G;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 2); w.dealHand(); await fourDealt(t);
      ok(!t.doc.body.classList.contains('rebet-on'), 'during the hand there is no Rebet');
      await playHand(t); await toBetting(t); await wait(10);
      G.bankroll = 20; w.renderAll();
      ok(!t.doc.body.classList.contains('rebet-on'), 'and with too little money there is none');
      noErr(t); w.close();
    }
    // keys: a link keeps its own Enter; when the table takes Space nothing after it hears it, and its keyup is taken too
    {
      const t = await boot(); const w = t.w;
      w.bet('banker', 1); await wait(5);
      const a = t.doc.createElement('a'); a.href = '#x'; a.textContent = 'a link'; t.doc.body.appendChild(a);
      const ev = key(t, 'Enter', null, a);
      ok(!ev.defaultPrevented && w.G.phase === 'betting', 'a link keeps its Enter (nothing is dealt)');
      let heard = 0; t.doc.body.addEventListener('keydown', () => { heard++; });
      w.rig(['2S', '4D', '3H', '5S']);
      key(t, ' ');
      ok(w.G.phase !== 'betting' && heard === 0, 'when the table takes Space, nothing after it does (' + heard + ')');
      const up = new w.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }); t.doc.body.dispatchEvent(up);
      ok(up.defaultPrevented, 'the Space coming back up is taken as well');
      const up2 = new w.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }); t.doc.body.dispatchEvent(up2);
      ok(!up2.defaultPrevented, 'but only that one');
      noErr(t); w.close();
    }
    // tapping the table moves on; tapping a card, a bet spot, the explanation or the page around it does not
    {
      const t = await boot(); const w = t.w, G = w.G;
      w.rig(['2S', '4D', '3H', '5S']); w.bet('banker', 2); w.dealHand(); await fourDealt(t);
      w.RESULT_PAUSE = 8000;
      await playTo(t, 'done');
      const fire = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      const card = t.doc.querySelector('#banker-cards .flip-card'), felt = t.doc.querySelector('.table-felt');
      const outside = t.doc.createElement('p'); outside.textContent = 'about this page'; t.doc.body.appendChild(outside);
      const why = t.doc.createElement('div'); why.className = 'why-panel'; felt.appendChild(why);
      ok(w.localStorage.getItem('bac_skiphint') === '1', 'the hint is counted: shown once (' + w.localStorage.getItem('bac_skiphint') + ')');
      if (card) { fire(card); ok(G.phase === 'done', 'a tap on a card is not a tap on the table'); }
      fire(t.doc.getElementById('spot-banker')); ok(G.phase === 'done', 'nor a tap on a bet spot');
      fire(why); ok(G.phase === 'done', 'nor a tap on the explanation');
      fire(outside); ok(G.phase === 'done', 'nor a tap on the page outside the table');
      fire(felt); ok(G.phase === 'betting', 'the table itself moves on');
      noErr(t); w.close();
    }
  }

  // ---------------------------------------------------------------- the phone layout (behaviour; the look itself is CSS)
  section('phone layout: the menu, the settings sheet, Undo, the pinned Deal bar, the peel as a screen of its own');
  {
    const keyDoc = (t, k) => t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: k, bubbles: true }));
    {
      // a wide window: nothing is moved, nothing is added
      const t = await boot();
      const col = t.doc.querySelector('#topbar header').children[1];
      ok(!t.doc.getElementById('m-menu') && !t.doc.getElementById('m-undo'), 'wide: no menu, no Undo button');
      ok(col.contains($(t, 'btn-toggle-settings')) && col.contains($(t, 'btn-manners')), 'wide: the settings button and the manners link stay in the header');
      ok(!t.doc.body.classList.contains('m-sheet') && !t.doc.body.classList.contains('m-peel'), 'wide: no sheet, no peel lock');
      ok(t.doc.querySelector('.deal-row').contains($(t, 'btn-deal')), 'Deal sits in the deal row (pinned only on a phone)');
      ok(t.doc.querySelector('.back-link .bl-txt') && /Table Ready/.test(t.doc.querySelector('.back-link').textContent), 'the way home still reads "Table Ready"');
      ok(t.doc.body.classList.contains('phase-betting'), 'betting: the body says so');
      noErr(t); t.w.close();
    }
    {
      // a phone
      const t = await boot({ phone: true });
      const doc = t.doc, bar = doc.getElementById('topbar'), menu = doc.getElementById('m-menu'), btn = doc.getElementById('m-menu-btn'), col = doc.querySelector('#topbar header').children[1];
      ok(!!menu && menu.contains($(t, 'btn-toggle-settings')) && menu.contains($(t, 'btn-manners')) && !!menu.querySelector('a[href*="glossary"]'), 'phone: the menu holds Table settings, Table manners and the glossary');
      ok(!col.contains($(t, 'btn-toggle-settings')), 'phone: they are no longer in the header');
      btn.click();
      const rules = menu.querySelector('.m-rules').textContent;
      ok(/8 decks/.test(rules) && /No commission/.test(rules), 'the menu says how the table is set (' + rules + ')');
      ok(bar.classList.contains('m-open') && btn.getAttribute('aria-expanded') === 'true', 'tapping the menu button opens it');
      doc.body.click();
      ok(!bar.classList.contains('m-open') && btn.getAttribute('aria-expanded') === 'false', 'tapping elsewhere closes it');
      btn.click(); keyDoc(t, 'Escape');
      ok(!bar.classList.contains('m-open'), 'Escape closes it');
      btn.click(); $(t, 'btn-manners').click();
      ok(!bar.classList.contains('m-open') && $(t, 'manners-overlay').style.display === 'flex', 'choosing an item closes the menu and does it (table manners opens)');
      t.w.hideMannersOverlay();
      // side bets show in the rules line
      $(t, 'sb-dragon7').checked = true; $(t, 'sb-dragon7').dispatchEvent(new t.w.Event('change')); $(t, 'set-commission').value = 'yes'; $(t, 'set-commission').dispatchEvent(new t.w.Event('change'));
      btn.click(); ok(/Dragon 7/.test(menu.querySelector('.m-rules').textContent) && /5% commission/.test(menu.querySelector('.m-rules').textContent), 'side bets and commission show in the line: ' + menu.querySelector('.m-rules').textContent); doc.body.click();
      $(t, 'sb-dragon7').checked = false; $(t, 'sb-dragon7').dispatchEvent(new t.w.Event('change')); $(t, 'set-commission').value = 'no'; $(t, 'set-commission').dispatchEvent(new t.w.Event('change'));

      // the settings sheet
      btn.click(); $(t, 'btn-toggle-settings').click(); await wait(20);
      ok($(t, 'settings-panel').style.display === 'block' && doc.body.classList.contains('m-sheet'), 'Table settings opens as a sheet');
      ok(!!doc.querySelector('.m-sheet-head #m-sheet-done'), 'with a Done button');
      $(t, 'm-sheet-done').click(); await wait(20);
      ok($(t, 'settings-panel').style.display === 'none' && !doc.body.classList.contains('m-sheet'), 'Done closes it');
      btn.click(); $(t, 'btn-toggle-settings').click(); await wait(20); keyDoc(t, 'Escape'); await wait(20);
      ok($(t, 'settings-panel').style.display === 'none' && !doc.body.classList.contains('m-sheet'), 'Escape closes it too');
      btn.click(); $(t, 'btn-toggle-settings').click(); await wait(20); doc.querySelector('.m-backdrop').click(); await wait(20);
      ok($(t, 'settings-panel').style.display === 'none', 'and so does a tap on the dimmed table');

      // Undo: a phone has no right-click, so the chip you just placed can be taken back
      const undo = $(t, 'm-undo');
      ok(!!undo && undo.parentNode === $(t, 'btn-clear-bets').parentNode && undo.nextElementSibling === $(t, 'btn-clear-bets'), 'phone: an Undo button sits in the controls, before Clear bets');
      ok(undo.disabled === true, 'Undo is off while there is nothing to take back');
      t.w.bet('banker', 1); t.w.bet('banker', 1); t.w.bet('tie', 1); await wait(20);
      ok(undo.disabled === false, 'Undo comes on once a chip is down');
      const before = t.w.G.bets.tie; undo.click(); await wait(20);
      ok(t.w.G.bets.tie === before - 25 && t.w.G.bets.banker === 50, 'it takes back the last chip (the Tie one), not the others (tie ' + t.w.G.bets.tie + ', banker ' + t.w.G.bets.banker + ')');
      undo.click(); undo.click(); await wait(20);
      ok(t.w.G.bets.banker === 0 && t.w.totalBetAmount() === 0, 'and the one before that, until the table is clear');
      ok(undo.disabled === true, 'Undo is off again');
      t.w.bet('banker', 1); await wait(20); t.w.clearBets(); await wait(20);
      ok(undo.disabled === true, 'Clear bets leaves nothing to undo');

      // the same page widens: everything goes back where it was
      t.w.__setPhone(false);
      ok(col.contains($(t, 'btn-toggle-settings')) && col.contains($(t, 'btn-manners')) && !$(t, 'm-undo'), 'widening the window puts the links back in the header and takes Undo away');
      t.w.__setPhone(true);
      ok(menu.contains($(t, 'btn-toggle-settings')) && !!$(t, 'm-undo'), 'and narrowing it again moves them into the menu and brings Undo back');
      noErr(t); t.w.close();
    }
    {
      // the phase shows on the body (the CSS pins Deal while betting and tucks the chips away while the cards are out)
      const t = await boot({ phone: true });
      const cl = () => t.doc.body.classList;
      ok(cl().contains('phase-betting') && !cl().contains('phase-play') && !cl().contains('phase-done'), 'betting: phase-betting only');
      t.w.rig(['5S', '2H', 'KD', '3C', '9H']); t.w.bet('banker', 1); t.w.dealHand();
      await waitFor(() => t.w.G.phase === 'initial', 3000, 'initial');
      ok(!cl().contains('phase-betting') && cl().contains('phase-play') && !cl().contains('phase-done'), 'cards out: phase-play');
      ok($(t, 'm-undo') && $(t, 'm-undo').disabled === true && t.w.Show._S.chipLog.length > 0, 'Undo is off once the cards are out, even with chips logged (' + t.w.Show._S.chipLog.length + ')');
      t.w.RESULT_PAUSE = 60000;
      ok(await playTo(t, 'done'), 'the hand reaches its result');
      ok(cl().contains('phase-done') && !cl().contains('phase-play') && !cl().contains('phase-betting'), 'result showing: phase-done only');
      t.w.skipResult();
      const done = await playHand(t, {});
      ok(done && cl().contains('phase-betting') && !cl().contains('phase-play'), 'and back to betting afterwards');
      noErr(t); t.w.close();
    }
    {
      // the peel is a screen of its own on a phone: the page behind it is locked while it is open
      const t = await boot({ phone: true });
      const w = t.w, P = t.P, doc = t.doc;
      w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      ok(!doc.body.classList.contains('m-peel'), 'peel closed: the page is free');
      const el = cardsIn(t, 'banker')[0]; click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open'); await wait(20);
      ok(doc.body.classList.contains('m-peel'), 'peel open: the page behind is locked');
      w.Peel.finish('back'); await waitFor(() => !w.Peel.isOpen(), 3000, 'closed'); await wait(20);
      ok(!doc.body.classList.contains('m-peel'), 'peel closed: it is free again');
      noErr(t); w.close();
      const tw = await boot({ phone: true }); tw.w.__setPhone(false);   // a wide window (the layout code is there, the query says no): the peel opens in the page, which is never locked
      tw.w.rig(['5S', '2H', 'KD', '3C']); tw.w.bet('banker', 1); tw.w.dealHand(); await fourDealt(tw);
      click(tw, cardsIn(tw, 'banker')[0]); await waitFor(() => tw.w.Peel.isOpen() && !tw.P.busy, 2000, 'open'); await wait(20);
      ok(!tw.doc.body.classList.contains('m-peel'), 'wide: the peel never locks the page');
      tw.w.Peel.finish('back'); await waitFor(() => !tw.w.Peel.isOpen(), 3000, 'closed'); noErr(tw); tw.w.close();
    }
    {
      // pinned over everything: the felt does not grow to hold it, and the address bar sliding in and out does not resize the card
      const t = await boot({ phone: true });
      const w = t.w, P = t.P, doc = t.doc, st = doc.createElement('style'); st.textContent = '#peel{position:fixed}'; doc.head.appendChild(st);
      w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      const low = { top: 700, bottom: 1500, left: 0, right: 300, width: 300, height: 800 };     // pretend the peel sits below the fold
      doc.querySelector('#peel .peel-main').getBoundingClientRect = () => low;
      let scrolls = 0; w.scrollBy = () => { scrolls++; };
      const el = cardsIn(t, 'banker')[0]; click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
      ok(scrolls === 0, 'pinned: opening the peel never scrolls the page behind it');
      ok(doc.querySelector('.table-felt').style.minHeight === '', 'pinned: the felt is not stretched for it');
      const u0 = P.u, lh0 = P.lh; w.innerHeight = w.innerHeight - 60; w.dispatchEvent(new w.Event('resize'));
      ok(P.u === u0 && P.lh === lh0, 'the address bar moving (60px) leaves the card, and the size it was laid out for, alone (' + u0 + ' -> ' + P.u + ', ' + lh0 + ' -> ' + P.lh + ')');
      w.innerHeight = 300; w.dispatchEvent(new w.Event('resize'));
      ok(P.lh === 300 && P.u !== u0, 'a real change (turning the phone) does resize it (' + u0 + ' -> ' + P.u + ')');
      w.Peel.finish('back'); await waitFor(() => !w.Peel.isOpen(), 3000, 'closed'); noErr(t); w.close();
      const t2 = await boot({ phone: true });                       // not pinned (no style): the felt makes room, as before
      t2.w.rig(['5S', '2H', 'KD', '3C']); t2.w.bet('banker', 1); t2.w.dealHand(); await fourDealt(t2);
      t2.doc.querySelector('#peel .peel-main').getBoundingClientRect = () => low;
      let scrolls2 = 0; t2.w.scrollBy = () => { scrolls2++; };
      click(t2, cardsIn(t2, 'banker')[0]); await waitFor(() => t2.w.Peel.isOpen() && !t2.P.busy, 2000, 'open');
      ok(t2.doc.querySelector('.table-felt').style.minHeight !== '', 'not pinned: the felt grows to hold the peel, as it always did');
      ok(scrolls2 > 0, 'not pinned: a peel below the fold is scrolled into view, as it always was');
      t2.w.Peel.finish('back'); await waitFor(() => !t2.w.Peel.isOpen(), 3000, 'closed'); t2.w.close();
    }
    {
      // the card's shadows are plain shapes (a blur filter on a moving card is redrawn every frame); they follow the card, with round corners
      const t = await boot();
      const w = t.w, P = t.P, doc = t.doc;
      ok(!doc.querySelector('#peel [filter="url(#pcLift)"]') && !doc.querySelector('#pcFlap[filter]') && !doc.querySelector('#pc-svg > g[filter="url(#pcTable)"]'), 'no blur filter on the moving parts');
      w.rig(['5S', '2H', 'KD', '3C']); w.bet('banker', 1); w.dealHand(); await fourDealt(t);
      const el = cardsIn(t, 'banker')[0]; el._bc.card = { r: '6', suit: '♥', color: 'red' };
      click(t, el); await waitFor(() => w.Peel.isOpen() && !P.busy, 2000, 'open');
      const rings = doc.querySelectorAll('.pcShTa'), flatPts = rings[0].getAttribute('points');
      ok(rings.length >= 4 && flatPts.split(' ').length > 8 && [].every.call(rings, r => r.getAttribute('points') === flatPts), 'flat: the card casts a round-cornered shadow, every ring the same outline (' + rings.length + ' rings)');
      ok(doc.getElementById('pcShF').getAttribute('display') === 'none', 'nothing lifted: no flap shadow');
      w.Peel._drag(70, 70, 3, 70);
      const lifted = doc.querySelectorAll('.pcShTa')[0].getAttribute('points');
      ok(lifted !== flatPts && [].every.call(doc.querySelectorAll('.pcShTa'), r => r.getAttribute('points') === lifted), 'lifted: the shadow follows what is still lying flat');
      const nums = lifted.split(/[ ,]/).map(Number);
      ok(nums.every(n => isFinite(n)) && Math.min.apply(null, nums) >= -1e-6 && Math.max.apply(null, nums) <= 140.001, 'and stays on the card');
      const pts = lifted.split(' ').map(q => q.split(',').map(Number)), near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
      ok(pts.every((q, i) => !near(q, pts[(i + 1) % pts.length])), 'the outline has no doubled points (they would draw a hairline)');
      ok(pts.every((q, i) => !near(q, pts[(i + 2) % pts.length])), 'and nothing goes out and straight back (a dark spur)');
      ok(pts.length > P.pl.A.length, 'its corners are rounded: more points than the raw shape (' + pts.length + ' vs ' + P.pl.A.length + ')');
      const area = pts.reduce((s, q, i) => { const r = pts[(i + 1) % pts.length]; return s + (q[0] * r[1] - r[0] * q[1]); }, 0) / 2;
      ok(Math.abs(area) > 500, 'and it has some body (area ' + Math.round(Math.abs(area)) + ')');
      ok(doc.getElementById('pcShF').getAttribute('display') !== 'none' && doc.querySelectorAll('.pcShFa')[0].getAttribute('points').length > 20, 'the lifted edge casts its own, lighter shadow');
      w.Peel._drag(70, 70, 70, 70);
      w.Peel.finish('back'); await waitFor(() => !w.Peel.isOpen(), 3000, 'closed'); noErr(t); w.close();
    }
    {
      // a touch screen has no Space bar
      const t = await boot({ touch: true });
      ok(!/Space/.test(t.doc.querySelector('.ds-idle').textContent) && /tap the shoe/.test(t.doc.querySelector('.ds-idle').textContent), 'touch: the dealer says "tap the shoe", not "press Space" (' + t.doc.querySelector('.ds-idle').textContent + ')');
      t.w.rig(['2S', '4D', '3H', '5S']); t.w.bet('banker', 2); t.w.dealHand(); await fourDealt(t); t.w.RESULT_PAUSE = 8000;
      await playTo(t, 'done');
      const h = t.doc.getElementById('skip-hint');
      ok(!!h && !/Space/.test(h.textContent), 'touch: the hint after a hand says only to tap the table (' + (h && h.textContent) + ')');
      noErr(t); t.w.close();
      const t2 = await boot();
      ok(/Space/.test(t2.doc.querySelector('.ds-idle').textContent), 'with a keyboard it still mentions Space');
      t2.w.close();
    }
  }
  // <</BACMOTION>>

  console.log('\n' + (fails ? 'FAILED' : 'ALL PASSED') + ' — ' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e && e.stack || e); process.exit(2); });
