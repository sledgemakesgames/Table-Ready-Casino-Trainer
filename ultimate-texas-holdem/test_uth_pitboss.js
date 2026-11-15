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


/* ================= THE PIT BOSS =================
   Five wins in a row, or five losses in a row, and a man in a grey suit walks over to the dealer, says his piece and walks out. These checks cover the streak counting, the switch,
   the scene itself (it plays, it can be cut short, it changes nothing about the game), and the real thing: hands played out at this table.
   The game's own harness above (boot, waitFor, ok, section) is reused; ctx says how this game differs. */
const PB_VERBS = ['enter', 'leave', 'boss', 'dealer', 'bmood', 'dmood', 'look', 'dlook', 'dnod', 'dshrug', 'sfx', 'arm', 'rest', 'tap', 'pat', 'hold', 'give', 'fx', 'dealerarm'];
const PB_KEY = 'tableready_pitboss';

async function pitbossSuite(ctx){
  const q = (t, sel) => t.doc.querySelector(sel);
  const quiet = t => ok(t.S.errors.length === 0 && t.errors.length === 0 && t.w.PitBoss._S.errors.length === 0,
    'no errors (dealer ' + JSON.stringify(t.S.errors) + ', page ' + JSON.stringify(t.errors.slice(0, 2)) + ', boss ' + JSON.stringify(t.w.PitBoss._S.errors) + ')');
  // everything that matters about the game, to show that the boss changed none of it
  const snap = t => JSON.stringify({ bank: t.w.G.bankroll, bets: t.w.G.bets, phase: t.w.G.phase, shoe: (t.w.G.shoe || t.w.G.deck || []).length, stats: t.w.G.stats || null });

  // ---------------------------------------------------------------- in the settings, remembered
  section(ctx.name + ' pit boss: in the settings, on by default, remembered');
  {
    const t = await ctx.boot();
    const P = t.w.PitBoss;
    ok(P && typeof P.hand === 'function' && P.STREAK === 5, 'the pit boss exists and counts to five');
    const box = $(t, 'set-pitboss'), dealerRow = $(t, ctx.dealerToggle).parentNode;
    ok(box && box.type === 'checkbox' && box.checked === true && P.enabled() === true, 'a switch for him is in the settings, on by default');
    ok(box.parentNode.previousElementSibling === dealerRow, 'it sits right under the dealer\'s own switch');
    ok(/five/i.test(box.parentNode.textContent), 'its label says what he does');
    ok(t.doc.querySelectorAll('#set-pitboss').length === 1, 'there is only one');
    box.checked = false; box.dispatchEvent(new t.w.Event('change'));
    ok(P.enabled() === false && t.w.localStorage.getItem(PB_KEY) === '0', 'switching it off is remembered');
    box.checked = true; box.dispatchEvent(new t.w.Event('change'));
    ok(P.enabled() === true && t.w.localStorage.getItem(PB_KEY) === '1', 'and on again');
    const off = await ctx.boot({ storage: { [PB_KEY]: '0' } });
    ok($(off, 'set-pitboss').checked === false && off.w.PitBoss.enabled() === false, 'a table opened after switching him off starts with him off');
    quiet(t); quiet(off);
  }

  // ---------------------------------------------------------------- counting
  section(ctx.name + ' pit boss: five in a row, and only five');
  {
    const t = await ctx.boot();
    const P = t.w.PitBoss;
    const run = seq => { P.reset(); return seq.split('').map(c => P.tally(c === 'w' ? 'win' : c === 'l' ? 'loss' : 'push')).join(','); };
    ok(run('wwww') === ',,,', 'four wins: nothing');
    ok(run('wwwww') === ',,,,hot', 'five wins: the hot scene, on the fifth');
    ok(run('wwwwww') === ',,,,hot,', 'a sixth win does not bring him back');
    ok(run('wwwwwwwwwwww') === ',,,,hot,,,,,,,', 'twelve wins in a row: once');
    ok(run('wwwwpw') === ',,,,,hot', 'a push neither counts nor breaks the run');
    ok(run('wwwlwwww') === ',,,,,,,', 'a loss in the middle starts it over');
    ok(run('lllll') === ',,,,cold', 'five losses: the cold scene');
    ok(run('llllll') === ',,,,cold,', 'a sixth loss does not bring him back');
    ok(run('lllpllll') === ',,,,,cold,,', 'a push does not break a losing run either');
    ok(run('llllwllll') === ',,,,,,,,', 'a win in the middle starts it over');
    ok(run('wwwwwlllll') === ',,,,hot,,,,,cold', 'five wins and then five losses: one scene each');
    ok(run('lllllwwwww') === ',,,,cold,,,,,hot', 'and the other way round');
    ok(run('wwwwwlwwwww') === ',,,,hot,,,,,,hot', 'a scene is earned once per run: a loss ends it, and five more wins bring him again');
    ok(run('wwwwwlwwwwwwwwww') === ',,,,hot,,,,,,hot,,,,,', 'and in the second run he comes once too');
    ok(P.tally('maybe') === '' && P.tally(undefined) === '', 'anything else counts for nothing');
    quiet(t);
  }

  // ---------------------------------------------------------------- the scripts
  section(ctx.name + ' pit boss: the two scenes are well formed');
  {
    const t = await ctx.boot();
    const sc = t.w.PB_SCENES;
    ok(sc && Array.isArray(sc.hot) && Array.isArray(sc.cold), 'a hot scene and a cold scene');
    for(const name of ['hot', 'cold']){
      const s = sc[name];
      ok(s[0][1] === 'enter' && s[s.length - 1][1] === 'leave', name + ': he comes in and he leaves');
      ok(s.every(b => typeof b[0] === 'number' && b[0] >= 0 && PB_VERBS.indexOf(b[1]) >= 0), name + ': every beat is a wait and something he knows how to do');
      const bossLines = s.filter(b => b[1] === 'boss'), dealerLines = s.filter(b => b[1] === 'dealer');
      ok(bossLines.length >= 2 && dealerLines.length >= 1, name + ': he talks (' + bossLines.length + ') and the dealer answers (' + dealerLines.length + ')');
      ok(s.filter(b => b[1] === 'boss' || b[1] === 'dealer').every(b => (Array.isArray(b[2]) ? b[2] : [b[2]]).every(x => typeof x === 'string' && x.length > 3 && x.length < 60) && b[3] >= 800), name + ': every line is short and stays up long enough to read');
      const total = s.reduce((a, b) => a + b[0], 0);
      ok(total >= 6000 && total <= 22000, name + ': the scene lasts ' + (total / 1000).toFixed(1) + ' s');
      ok(!s.some(b => ['tap', 'arm', 'give', 'pat', 'hold', 'rest', 'dealerarm'].indexOf(b[1]) >= 0), name + ': he keeps his hands to himself (no reaching over the table)');
    }
    ok(JSON.stringify(sc.hot) !== JSON.stringify(sc.cold), 'the two scenes are different');
    quiet(t);
  }

  // ---------------------------------------------------------------- when he may come
  section(ctx.name + ' pit boss: only when it is the moment, and only if he is wanted');
  {
    const run5 = (t, kind) => { const P = t.w.PitBoss; P.reset(); let r; for(let i = 0; i < 5; i++) r = P.hand(kind || 'win'); return r; };
    const a = await ctx.boot(); ctx.ready(a);
    ok(run5(a) === true && a.w.PitBoss.active(), 'everything in place: the fifth win sends for him');
    a.w.PitBoss.abort(); ok(!a.w.PitBoss.active(), 'and he can be sent away');
    ok(run5(a, 'loss') === true, 'the same for five losses');
    a.w.PitBoss.abort();
    a.w.PitBoss.reset(); for(let i = 0; i < 4; i++) a.w.PitBoss.hand('win');
    ok(a.w.PitBoss.hand('win') === true, 'five wins');
    a.w.PitBoss.abort();
    // switched off: the run is still counted, he just does not come
    a.w.PitBoss.setEnabled(false); a.w.PitBoss.reset();
    for(let i = 0; i < 5; i++) ok(a.w.PitBoss.hand('win') === false, 'switched off: win ' + (i + 1) + ' does not bring him');
    ok(!a.w.PitBoss.active() && !q(a, '.pb'), 'switched off: nothing was even built');
    ok(a.w.PitBoss._S.win === 5, 'switched off: the run is still counted');
    ok(a.w.PitBoss.play('hot') === false, 'switched off: he cannot be played by hand either');
    a.w.PitBoss.setEnabled(true);
    // the wrong moment
    ctx.unready(a); ok(run5(a) === false, 'not at the result of a hand: he does not come');
    ctx.ready(a);
    // chatter off
    const c = await ctx.boot({ chatter: 'off' }); ctx.ready(c);
    ok(c.w.PitBoss.play('hot') === false, 'dealer chatter off: no scene (it is all talk)');
    const qt = await ctx.boot({ chatter: 'quiet' }); ctx.ready(qt);
    ok(qt.w.PitBoss.play('hot') === true, 'dealer chatter quiet: he still comes');
    qt.w.PitBoss.abort();
    // the dealer is off, turbo, reduced motion
    const d = await ctx.boot({ dealer: false }); ok(run5(d) === false, 'dealer off: no pit boss');
    const tb = await ctx.boot({ turbo: true }); ok(run5(tb) === false, 'turbo: no pit boss');
    const rm = await ctx.boot({ reduced: true }); ctx.ready(rm); ok(run5(rm) === false, 'reduced motion: no pit boss');
    [a, c, qt, d, tb, rm].forEach(quiet);
  }

  // ---------------------------------------------------------------- the scene itself
  for(const name of ['hot', 'cold']){
    section(ctx.name + ' pit boss: the ' + name + ' scene plays through');
    const t = await ctx.boot();
    const P = t.w.PitBoss, G = t.w.G; ctx.ready(t);
    let rngCalls = 0; const r0 = t.w.Math.random; t.w.Math.random = function(){ rngCalls++; return r0.apply(this, arguments); };
    const before = snap(t);
    const bossSaid = [], dealerSaid = [], states = [], moods = [];
    const bubble = () => q(t, '.pb-say');
    const mo = new t.w.MutationObserver(() => { const b = bubble(); if(b && b.classList.contains('on') && b.textContent && bossSaid[bossSaid.length - 1] !== b.textContent) bossSaid.push(b.textContent); const el = q(t, '.pb'); if(el){ const s = el.getAttribute('data-state'); if(states[states.length - 1] !== s) states.push(s); const m = el.getAttribute('data-mood'); if(m && moods[moods.length - 1] !== m) moods.push(m); } });
    mo.observe(t.doc.body, { attributes: true, childList: true, characterData: true, subtree: true });
    const say = q(t, '.ds-say'), mo2 = new t.w.MutationObserver(() => { if(say.classList.contains('on') && say.textContent && dealerSaid[dealerSaid.length - 1] !== say.textContent) dealerSaid.push(say.textContent); });
    mo2.observe(say, { attributes: true, childList: true, characterData: true, subtree: true });
    ok(P.play(name) === true && P.active(), 'it starts');
    ok(await waitFor(() => q(t, '.pb') && q(t, '.pb').getAttribute('data-state') === 'in', 4000, 'him coming in'), 'he comes in');
    ok(q(t, '.pb').parentNode === $(t, ctx.stageId), 'he stands on the dealer\'s stage');
    ok(!!q(t, '.pb svg') && q(t, '.pb').getAttribute('aria-hidden') === 'true', 'he is a drawing, hidden from screen readers');
    // while he is there the dealer says only what the scene gives him
    ctx.say(t, 'A line from the ordinary dealer chatter.');
    ok(say.textContent !== 'A line from the ordinary dealer chatter.', 'the dealer\'s ordinary chatter waits while the boss is at the table');
    ok(await waitFor(() => !P.active(), 40000, 'the scene to end'), 'the scene ends by itself');
    ok(await waitFor(() => q(t, '.pb').getAttribute('data-state') === 'away', 2000, 'him leaving'), 'he has gone');
    mo.disconnect(); mo2.disconnect();
    const lines = t.w.PB_SCENES[name].filter(b => b[1] === 'boss').map(b => Array.isArray(b[2]) ? b[2] : [b[2]]);
    const dl = t.w.PB_SCENES[name].filter(b => b[1] === 'dealer').map(b => Array.isArray(b[2]) ? b[2] : [b[2]]);
    ok(lines.every(alts => alts.some(x => bossSaid.indexOf(x) >= 0)), 'he said every one of his lines (' + bossSaid.length + ' of ' + lines.length + ')');
    ok(dl.every(alts => alts.some(x => dealerSaid.indexOf(x) >= 0)), 'the dealer answered every time (' + dealerSaid.length + ' of ' + dl.length + ')');
    ok(states.indexOf('in') >= 0 && states[states.length - 1] === 'away', 'in, then away: ' + states.join(' > '));
    ok(moods.length >= 2, 'his face changes during the scene: ' + moods.join(' > '));
    ok(q(t, '.pb-prop') === null || t.doc.querySelectorAll('.pb-prop').length <= 1, 'at most the one prop he gave away is left on the table');
    ok(rngCalls === 0, 'the shoe\'s random numbers were not touched (' + rngCalls + ' calls)');
    ok(snap(t) === before, 'the game itself is exactly as it was (money, bets, phase, shoe)');
    ok(P.enabled() && G.phase === ctx.readyPhase, 'and it is still the result of the hand');
    quiet(t);
  }

  // ---------------------------------------------------------------- cut short
  section(ctx.name + ' pit boss: the next hand, or switching him off, sends him away at once');
  {
    const t = await ctx.boot(); const P = t.w.PitBoss; ctx.ready(t);
    P.play('hot');
    ok(await waitFor(() => q(t, '.pb') && q(t, '.pb').getAttribute('data-state') === 'in', 4000, 'him coming in'), 'he is in');
    await wait(150);
    P.abort(true);
    ok(!P.active() && q(t, '.pb').getAttribute('data-state') === 'away', 'abort: he is gone and nothing is running');
    ok(t.doc.querySelectorAll('.pb-prop').length === 0 && !q(t, '.pb-say.on'), 'nothing of his is left on the table');
    // he walks out by himself when the table moves on (the scene checks the moment before every beat)
    P.play('cold');
    ok(await waitFor(() => q(t, '.pb').getAttribute('data-state') === 'in', 4000, 'him coming in'), 'cold: he is in again');
    ctx.unready(t);
    await wait(150);
    ok(!P.active(), 'the hand moves on: he leaves within a beat, he does not finish the scene');
    ctx.ready(t);
    // switching him off in the middle of a scene
    P.play('hot'); await wait(120);
    const box = $(t, 'set-pitboss'); box.checked = false; box.dispatchEvent(new t.w.Event('change'));
    ok(!P.active() && q(t, '.pb').getAttribute('data-state') === 'away', 'switched off mid-scene: gone');
    box.checked = true; box.dispatchEvent(new t.w.Event('change'));
    // a scene that is replaced by another does not leave two of him, nor his first words on the screen
    P.play('hot');
    ok(await waitFor(() => q(t, '.pb-say.on'), 4000, 'his first words'), 'he says his first line');
    P.play('cold');
    ok(!q(t, '.pb-say.on'), 'the new scene starts with a clean bubble');
    await wait(60);
    ok(t.doc.querySelectorAll('.pb').length === 1, 'only ever one pit boss in the DOM');
    P.abort(true);
    // a scene that forgets to leave is still stopped
    t.w.PB_SCENES.tmp = [[0, 'enter', 'stern'], [0, 'boss', 'Hello there.', 800]];
    ok(P.play('tmp') === true && P.active(), 'a scene with no goodbye starts');
    ok(await waitFor(() => !P.active(), 3000, 'the safety net'), 'and ends by itself all the same');
    delete t.w.PB_SCENES.tmp;
    // a pending scene (waiting for the result to settle) is cancelled too
    P.reset(); for(let i = 0; i < 5; i++) P.hand('win');
    const sum = t.w.PB_SCENES.hot.reduce((a, b) => a + (b[0] || 0), 0), want = Math.round((2300 + sum) * t.S.k + 1100);
    ok(P.active() && Math.abs(P.holdMs() - want) <= 3, 'a scene that is on its way holds the table for the length of the whole scene (' + P.holdMs() + ' ms, wanted ' + want + ')');
    P.abort(); ok(!P.active() && P.holdMs() === 0, 'and when it is cancelled it lets go');
    quiet(t);
  }

  // ---------------------------------------------------------------- real hands
  section(ctx.name + ' pit boss: every hand played here is counted as the game itself settled it');
  {
    const t = await ctx.boot(); ctx.prep(t);
    const P = t.w.PitBoss, kinds = [], expect = [];
    const orig = P.hand; let b0 = 0;
    P.hand = function(k){ kinds.push(k); const d = t.w.G.bankroll - b0; expect.push(d > 0 ? 'win' : d < 0 ? 'loss' : 'push'); return orig.apply(this, arguments); };
    const N = ctx.hands || 12;
    for(let i = 0; i < N; i++){
      b0 = t.w.G.bankroll;
      ok(await ctx.playOne(t, () => { b0 = t.w.G.bankroll; }), 'hand ' + (i + 1) + ' is played out');
      await waitFor(() => kinds.length === i + 1, 3000);
      ok(kinds.length === i + 1, 'hand ' + (i + 1) + ': the pit boss was told once (' + kinds.length + ')');
      await ctx.next(t);
    }
    ok(kinds.join() === expect.join(), 'each hand was reported as the game settled it: ' + kinds.join(' ') + ' | money says ' + expect.join(' '));
    ok(kinds.some(k => k === 'win') && kinds.some(k => k === 'loss'), 'the sample has wins and losses (' + kinds.filter(k => k === 'win').length + ' / ' + kinds.filter(k => k === 'loss').length + ' / ' + kinds.filter(k => k === 'push').length + ' pushes)');
    let w = 0, l = 0; kinds.forEach(k => { if(k === 'win'){ w++; l = 0; } else if(k === 'loss'){ l++; w = 0; } });
    ok(P._S.win === w && P._S.loss === l, 'its counters match the end of the list (' + P._S.win + ' wins, ' + P._S.loss + ' losses in a row)');
    if(ctx.pushHand){       // a hand that comes out even, on purpose: it is a push, and a push neither counts nor breaks a run
      P._S.win = 4; P._S.loss = 0; const n0 = kinds.length;
      ok(await ctx.pushHand(t, () => { b0 = t.w.G.bankroll; }), 'a drawn hand is played out');
      await waitFor(() => kinds.length === n0 + 1, 3000);
      ok(kinds[n0] === 'push' && expect[n0] === 'push', 'a hand that comes out even is reported as a push (' + kinds[n0] + ', money says ' + expect[n0] + ')');
      ok(P._S.win === 4 && P._S.loss === 0 && !P.active(), 'it neither counts nor breaks the four wins before it, and he does not come');
    }
    quiet(t);
  }

  for(const [name, kind] of [['hot', 'win'], ['cold', 'loss']]){
    section(ctx.name + ' pit boss: a real ' + (name === 'hot' ? 'fifth win' : 'fifth loss') + ' brings him over, and the game carries on after');
    const t = await ctx.boot(); ctx.prep(t);
    const P = t.w.PitBoss, seen = [];
    const orig = P.hand; let fired = null, wasActive = null, phaseDuring = [], b0 = 0;
    P.hand = function(k){ t.S.k = 0.2; const r = orig.apply(this, arguments); seen.push(k); if(r) fired = k; return r; };       // a slower clock at the result, so the scene is long enough to measure
    P._S.win = kind === 'win' ? 4 : 0; P._S.loss = kind === 'loss' ? 4 : 0;
    let n = 0;
    while(!fired && n < 60){
      P._S.win = kind === 'win' ? 4 : 0; P._S.loss = kind === 'loss' ? 4 : 0;       // four in a row before this hand, whatever the last one was
      b0 = t.w.G.bankroll;
      if(!await ctx.playOne(t, () => { b0 = t.w.G.bankroll; })){ ok(false, 'hand ' + (n + 1) + ' did not finish'); break; }
      n++;
      await waitFor(() => seen.length === n, 3000);
      if(seen.length !== n){ ok(false, 'hand ' + n + ' was never reported to the pit boss'); break; }
      if(!fired) t.S.k = 0.02;
      if(!fired){ await ctx.next(t); }
    }
    ok(fired === kind, 'a ' + kind + ' ended the run after ' + n + ' hand(s) and sent for the pit boss');
    ok(P.active(), 'he is on his way as the result appears');
    ok(await waitFor(() => q(t, '.pb') && q(t, '.pb').getAttribute('data-state') === 'in', 6000, 'him at the table'), 'he comes in at the result');
    ok(!!q(t, '.pb-say') && !!q(t, '.ds-dealer') && q(t, '.pb').parentNode === $(t, ctx.stageId), 'at the dealer\'s side');
    if(ctx.skip && name === 'cold'){
      // tapping the table cuts the pause short, and the pit boss with it
      ok(ctx.skip(t) === true, 'a tap on the table skips the pause');
      ok(!P.active(), 'and he is sent away with it');
      ok(await waitFor(() => t.w.G.phase === 'betting', 4000, 'the next bet'), 'the table is ready for the next bet');
      ok(await waitFor(() => q(t, '.pb').getAttribute('data-state') === 'away', 2000, 'him gone'), 'he is gone');
    } else {
      // for the whole scene the table stays where it is (the result), however the game usually moves on
      const t0 = Date.now(); let moved = false;
      while(P.active() && Date.now() - t0 < 40000){ if(t.w.G.phase !== ctx.readyPhase){ moved = true; break; } await wait(8); }
      ok(!moved, 'the table waited for him (phase stayed "' + ctx.readyPhase + '")');
      ok(await waitFor(() => !P.active(), 40000, 'the scene to end'), 'the scene ended');
      ok(P._S.lastEnd === 'done', 'and it ran to its end: he was not cut short (' + P._S.lastEnd + ')');
      ok(P._S.plays >= 1 && P._S.scene === '', 'it was played once');
    }
    t.S.k = 0.02;
    await ctx.next(t);
    ok(await ctx.playOne(t, () => {}), 'the next hand plays as usual');
    ok(await waitFor(() => !q(t, '.pb') || q(t, '.pb').getAttribute('data-state') === 'away', 2000, 'him gone'), 'and he is not in the way');
    ok(P._S.plays === 1, 'one scene, not more (' + P._S.plays + ')');
    quiet(t);
  }
}


const CTX = {
  name: 'Ultimate Texas Hold\'em', dealerToggle: 'set-dealer', stageId: 'dealer-stage', readyPhase: 'resolved', hands: 10,
  boot: o => boot(o),
  ready: t => { t.S.st.setAttribute('data-state', 'up'); t.S.st.removeAttribute('data-still'); t.S.state = 'up'; t.w.G.phase = 'resolved'; },
  unready: t => { t.w.G.phase = 'betting'; },
  say: (t, s) => t.w.Show._say(s, 3000, false),
  prep: t => { t.w.G.bankroll = 100000; },
  // a hand with whatever the shoe gives: check, check, then bet 1x at the river
  playOne: async (t, mark) => {
    mark(); bet(t, 25, 1); click(t, $(t, 'btn-deal'));
    if(!await waitFor(() => phase(t) === 'preflop', 20000, 'the deal')) return false;
    click(t, $(t, 'btn-look'));
    if(!await waitFor(() => t.w.G.playerFlipCount === 2, 5000, 'both cards turned over')) return false;
    for(const [i, ph] of ['preflop', 'flop', 'river'].entries()){
      if(['resolved', 'showdown', 'showdown-pending'].indexOf(phase(t)) >= 0) break;
      if(!await waitFor(() => phase(t) === ph || ['resolved', 'showdown', 'showdown-pending'].indexOf(phase(t)) >= 0, 20000, 'the ' + ph + ' decision')) return false;
      if(phase(t) !== ph) break;
      click(t, $(t, i < 2 ? 'btn-check' : 'btn-bet'));
    }
    return waitFor(() => phase(t) === 'resolved', 30000, 'the result');
  },
  next: async t => { t.w.playAgain(); await wait(10); },
  pushHand: (t, mark) => { mark(); return playHand(t, TIE_ROYAL, ['check', 'check', 'bet1']); }
};

(async () => {
  await pitbossSuite(CTX);
  console.log('\n' + (fails ? 'FAILED: ' + fails + ' check(s)' : 'all ' + passes + ' pit boss checks passed'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e && e.stack || e); process.exit(2); });
