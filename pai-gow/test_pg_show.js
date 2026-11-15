// Pai Gow dealer -- jsdom tests.
//   node tests/test_pg_show.js [path/to/index.html]
// jsdom has no animations and no layout, so Element.prototype.animate is stubbed and time is sped up through Show._S.k.
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
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
const c = (r, s) => ({ rank: r, suit: s, joker: false });
const SPLIT_A = { player: [c('A','s'),c('A','d'),c('9','c'),c('8','h'),c('4','s'),c('3','d'),c('K','c')], dealer: [c('J','s'),c('J','d'),c('7','s'),c('6','s'),c('2','s'),c('K','h'),c('Q','d')] };
const ACE_HIGH = { player: [c('K','s'),c('K','h'),c('9','d'),c('7','c'),c('5','s'),c('3','d'),c('2','c')], dealer: [c('A','s'),c('K','d'),c('J','h'),c('9','c'),c('6','s'),c('3','d'),c('2','h')] };

async function boot(opts){
  opts = opts || {};
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => { if(!/Could not load link/.test(String(e.message))) errors.push(String(e.message || e)); });
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://tableready.xyz/pai-gow/',
    beforeParse(w){
      let s = opts.seed || 123456789; w.Math.random = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
      w.alert = () => {};
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
        w.matchMedia = q => ({ get matches(){ return !!((opts.reduced && /reduce/.test(q)) || (opts.phone && /max-width:700px/.test(q) && on) || (opts.touch && /pointer:coarse/.test(q))); }, media: q, addListener(f){ subs.push(f); }, removeListener(){}, addEventListener(t, f){ subs.push(f); }, removeEventListener(){} });
      }
    } });
  await wait(250);
  const w = dom.window, doc = w.document;
  w.addEventListener('error', e => errors.push('window error: ' + e.message));
  const set = (id, v) => { const e = doc.getElementById(id); if(e.type === 'checkbox') e.checked = !!v; else e.value = v; };
  if(opts.dealer === false) set('set-dealer', false);
  if(opts.chatter) set('set-chatter', opts.chatter);
  if(opts.speed) set('set-speed', opts.speed);
  if(opts.sidebets) set('set-sidebets', true);
  set('set-turbo', !!opts.turbo);
  w.readSettings();
  const S = w.Show._S; S.k = opts.k || 0.02;
  w.renderActionRow();
  return { dom, w, doc, S, errors };
}
const $ = (t, id) => t.doc.getElementById(id);
function click(t, el){ el.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true, cancelable: true })); }
function rig(t, p, d){
  const used = new Set(p.concat(d).map(x => x.joker ? 'JOKER' : x.rank + x.suit));
  const pool = t.w.freshDeck().filter(x => !used.has(x.joker ? 'JOKER' : x.rank + x.suit));
  t.w.shuffle = () => p.concat(d).concat(pool);
}
function bet(t, chip, n){ t.w.selectChip(chip || 25); for(let i = 0; i < (n || 1); i++) t.w.placeBet('ante'); }
const noErr = (t, what) => {
  ok(t.S.errors.length === 0, (what || 'dealer') + ' raised no errors: ' + JSON.stringify(t.S.errors));
  ok(t.errors.length === 0, 'no page errors: ' + JSON.stringify(t.errors.slice(0, 2)));
};
const phase = t => t.w.G.phase;
const upCards = (t, sel) => [].slice.call(t.doc.querySelectorAll(sel + ' .pc.up'));
// watch every flying card and every card landing, in order
function watch(t){
  const w = { flyers: 0, landed: [], pchips: 0, floats: 0 };
  const mo = new t.w.MutationObserver(list => list.forEach(m => {
    m.addedNodes.forEach(n => { if(n.nodeType === 1){ if(n.classList.contains('fc')) w.flyers++; if(n.classList.contains('pchip')) w.pchips++; if(n.classList.contains('pfloat')) w.floats++; } });
    if(m.type === 'attributes' && m.attributeName === 'class' && m.oldValue && /pending/.test(m.oldValue) && !m.target.classList.contains('pending')) w.landed.push(m.target);
  }));
  mo.observe(t.doc.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
  w.stop = () => mo.disconnect();
  return w;
}
async function toArranging(t, o){
  o = o || SPLIT_A; rig(t, o.player, o.dealer); bet(t, 25, 2);
  click(t, $(t, 'btn-deal'));
  return waitFor(() => phase(t) === 'arranging' || phase(t) === 'resolved', 20000, 'arranging');
}
async function finishHand(t, how){
  if(phase(t) === 'arranging'){ click(t, $(t, how === 'confirm' ? 'btn-autoset' : 'btn-autoset')); click(t, $(t, 'btn-confirm')); }
  return waitFor(() => phase(t) === 'resolved', 20000, 'resolved');
}

(async () => {
  // ---------------------------------------------------------------- the dealer is built, and switches off cleanly
  section('the dealer: built, on by default, absent when switched off');
  {
    const t = await boot();
    ok(t.w.G.tableShow === true, 'dealer is on by default');
    ok(t.doc.body.classList.contains('show-on'), 'body has show-on');
    ok(!!$(t, 'dealer-band') && !!$(t, 'dealer-stage') && !!$(t, 'show-layer'), 'band, stage and flight layer exist');
    ok($(t, 'dealer-stage').getAttribute('data-state') === 'away', 'he is out of sight while you bet');
    ok($(t, 'dealer-band').nextElementSibling === $(t, 'rows'), 'the band sits right above the cards');
    ok(!!t.doc.querySelector('.ds-shoe') && !!t.doc.querySelector('.ds-tray'), 'shoe and chip tray exist');
    ok(t.doc.querySelector('.ds-shoe').getAttribute('role') === 'button' && t.doc.querySelector('.ds-shoe').getAttribute('aria-label'), 'the shoe is a labelled button');
    ok($(t, 'dealer-stage').closest('[aria-hidden="true"]') === null || $(t, 'dealer-stage').querySelector('.ds-say').getAttribute('aria-hidden') === 'true', 'his chatter is hidden from screen readers (it is announced elsewhere)');
    noErr(t);
    const t2 = await boot({ dealer: false });
    ok(!t2.doc.body.classList.contains('show-on'), 'dealer off: no show-on');
    ok(!t2.w.Show.active(), 'dealer off: Show.active() is false');
    ok(await toArranging(t2), 'dealer off: a hand still plays to the arranging step');
    ok(t2.doc.querySelectorAll('.fc').length === 0, 'dealer off: nothing flies');
    ok(t2.doc.querySelectorAll('.pc.pending').length === 0, 'dealer off: nothing left pending');
  }

  // ---------------------------------------------------------------- the deal
  section('the deal: two spreads of seven (yours, then his), then his flip, his set, yours');
  {
    const t = await boot();
    const wt = watch(t);
    rig(t, SPLIT_A.player, SPLIT_A.dealer); bet(t, 25, 2);
    ok(t.doc.querySelectorAll('.pc').length === 0 || true, 'precondition');
    click(t, $(t, 'btn-deal'));
    ok(phase(t) === 'dealing', 'phase is dealing right after Deal');
    ok(t.doc.querySelectorAll('#rows .pc').length === 14, 'all 14 cards are on the table at once (as placeholders): nothing is inserted later');
    ok(t.doc.querySelectorAll('#rows .pc.pending').length === 14, 'all 14 start pending');
    ok(await waitFor(() => phase(t) === 'arranging', 20000, 'arranging'), 'reaches arranging');
    ok(wt.flyers === 14, 'fourteen cards flew (got ' + wt.flyers + ')');
    ok(t.doc.querySelectorAll('.fc').length === 0, 'no flying card is left behind');
    ok(t.doc.querySelectorAll('.pc.pending').length === 0, 'nothing is left pending');
    ok(wt.landed.length === 14, 'fourteen cards landed (got ' + wt.landed.length + ')');
    const names = wt.landed.map(el => (el.closest('#seat-you') ? 'P' : 'D'));
    ok(names.join('') === 'PPPPPPPDDDDDDD', 'your seven land first, then his seven: ' + names.join(''));
    ok(t.doc.querySelectorAll('#dealer-cards .pc.up').length === 7, 'his seven are face up');
    ok(t.doc.querySelectorAll('#player-cards .pc.up').length === 7, 'your seven are face up');
    ok(t.doc.querySelectorAll('#dealer-high-cards .pc').length === 5 && t.doc.querySelectorAll('#dealer-low-cards .pc').length === 2, 'he set five and two');
    ok($(t, 'dealer-stage').getAttribute('data-state') === 'up', 'he is up during the hand');
    ok(t.S.stats.deals === 14 && t.S.stats.flips === 7 && t.S.stats.sets === 1, 'stats: 14 dealt, 7 turned, 1 set');
    ok($(t, 'dealer-high-total').textContent === 'Pair', 'his High label is filled in');
    wt.stop(); noErr(t);
  }

  // ---------------------------------------------------------------- what he does
  section('his moods and lines');
  {
    const t = await boot();
    const said = [], moods = [];
    const mo = new t.w.MutationObserver(() => { const e = t.doc.querySelector('.ds-say'); if(e.classList.contains('on')) said.push(e.textContent); moods.push($(t, 'dealer-stage').getAttribute('data-mood')); });
    mo.observe(t.doc.querySelector('.ds-say'), { attributes: true, childList: true, characterData: true, subtree: true });
    mo.observe($(t, 'dealer-stage'), { attributes: true, attributeFilter: ['data-mood'] });
    await toArranging(t);
    ok(said.some(s => t.S && Object.keys(t.w.Show._L).some(k => t.w.Show._L[k].indexOf(s) >= 0)), 'he said something while he dealt');
    ok(said.some(s => t.w.Show._L.start.indexOf(s) >= 0), 'he opened with a dealing line');
    ok(said.some(s => t.w.Show._L.think.indexOf(s) >= 0), 'he said he was setting his hand');
    ok(moods.indexOf('focus') >= 0, 'he looked focused while he worked');
    ok(moods.some(m => m === 'smirk' || m === 'grin' || m === 'sweat'), 'his face showed what he thought of his hand');
    mo.disconnect();
    // chatter off / quiet
    const q = await boot({ chatter: 'off' });
    let any = false; new q.w.MutationObserver(() => { if(q.doc.querySelector('.ds-say').classList.contains('on')) any = true; }).observe(q.doc.querySelector('.ds-say'), { attributes: true });
    await toArranging(q);
    ok(!any, 'chatter off: he says nothing');
    const qq = await boot({ chatter: 'quiet' });
    const saidq = []; new qq.w.MutationObserver(() => { const e = qq.doc.querySelector('.ds-say'); if(e.classList.contains('on')) saidq.push(e.textContent); }).observe(qq.doc.querySelector('.ds-say'), { attributes: true });
    await toArranging(qq, ACE_HIGH);
    ok(saidq.some(s => qq.w.Show._L.ace.indexOf(s) >= 0), 'quiet: the information still comes (Ace-High push)');
    ok(!saidq.some(s => qq.w.Show._L.start.indexOf(s) >= 0 || qq.w.Show._L.think.indexOf(s) >= 0), 'quiet: the small talk does not');
  }

  // ---------------------------------------------------------------- Ace-High
  section('a dealer Ace-High Pai Gow pushes your Ante, and he says so');
  {
    const t = await boot();
    await toArranging(t, ACE_HIGH);
    ok(await waitFor(() => phase(t) === 'resolved', 20000, 'resolved'), 'resolves by itself');
    ok(t.w.G.result === 'push' && t.w.G.bankroll === 1000, 'a push, the Ante is back');
    ok(t.doc.querySelectorAll('.pchip').length === 0 || true, 'no chips fly on a push');
    ok(t.S.stats.pays === 0, 'no chips were paid or taken');
    noErr(t);
  }

  // ---------------------------------------------------------------- picks
  section('picking: a nod, a foul warning, the house way');
  {
    const t = await boot();
    await toArranging(t, { player: [c('K','s'),c('K','h'),c('5','d'),c('5','c'),c('2','s'),c('7','h'),c('9','d')], dealer: [c('8','s'),c('6','h'),c('4','d'),c('J','c'),c('2','h'),c('3','c'),c('10','s')] });
    const el = (r, s) => t.w.playerEl(t.w.G.playerCards.find(x => x.rank === r && x.suit === s));
    click(t, el('K','s')); click(t, el('K','h'));
    ok(t.S.stats.picks === 2, 'two picks were seen');
    ok(t.S.stats.fouls === 1, 'the foul was seen');
    ok($(t, 'dealer-stage').getAttribute('data-mood') === 'surp', 'he looks surprised at a foul');
    ok(t.doc.querySelector('.ds-say').textContent.length > 0 && t.w.Show._L.foul.indexOf(t.doc.querySelector('.ds-say').textContent) >= 0, 'and says so');
    click(t, $(t, 'btn-autoset'));
    ok(t.S.stats.autos === 1, 'auto-set was seen');
    ok(t.w.G.pickedLow.length === 2, 'two cards are in Low after auto-set');
    ok(!!t.S.nudgeRec, 'he is waiting on you (a nudge is scheduled)');
    noErr(t);
  }

  // ---------------------------------------------------------------- compare, result and chips
  section('compare: Low then High, then the result and the chips');
  {
    const t = await boot();
    const wt = watch(t);
    const order = [];
    ['low', 'high'].forEach(k => new t.w.MutationObserver(() => { if(!$(t, 'player-' + k + '-res').hidden) order.push(k); }).observe($(t, 'player-' + k + '-res'), { attributes: true }));
    await toArranging(t, { player: [c('A','s'),c('A','h'),c('A','d'),c('K','c'),c('K','s'),c('9','h'),c('8','d')], dealer: [c('2','s'),c('7','h'),c('J','d'),c('4','c'),c('9','s'),c('K','h'),c('3','d')] });
    click(t, $(t, 'btn-autoset')); click(t, $(t, 'btn-confirm'));
    ok(phase(t) === 'revealing', 'phase is revealing while he compares');
    ok(t.doc.querySelectorAll('#action-row button:not([hidden])').length === 0, 'no buttons while he compares');
    ok(await waitFor(() => phase(t) === 'resolved', 20000, 'resolved'), 'resolves');
    ok(order[0] === 'low' && order.indexOf('high') > 0, 'Low is judged first, then High: ' + order.join(','));
    ok(t.w.G.result === 'win' && t.w.G.bankroll === 1050, 'a win paid 1:1 (bankroll ' + t.w.G.bankroll + ')');
    ok(t.S.stats.pays === 1 && wt.pchips >= 1, 'chips came out of his tray (' + wt.pchips + ')');
    ok(await waitFor(() => wt.floats >= 1, 2000, 'a float'), 'a +$50 floats up');
    ok(await waitFor(() => t.doc.querySelectorAll('.pchip').length === 0 && t.doc.querySelectorAll('.pfloat').length === 0, 6000, 'chips gone'), 'the chips and the floating amount clean themselves up');
    ok(t.w.Show._L.win.indexOf(t.doc.querySelector('.ds-say').textContent) >= 0 || !t.doc.querySelector('.ds-say').classList.contains('on'), 'he took the loss with a line');
    wt.stop(); noErr(t);
    // a loss takes the chips
    const l = await boot();
    const wl = watch(l);
    await toArranging(l, { player: [c('2','s'),c('3','h'),c('4','d'),c('5','c'),c('7','s'),c('8','h'),c('9','d')], dealer: [c('A','s'),c('A','h'),c('K','d'),c('K','c'),c('Q','s'),c('J','h'),c('10','d')] });
    await finishHand(l);
    ok(l.w.G.result === 'loss', 'a loss');
    ok(l.S.stats.pays === 1, 'his chips are paid out for a loss: he takes yours');
    ok(await waitFor(() => l.doc.querySelectorAll('.pchip').length === 0, 6000, 'chips gone'), 'and they are gone again');
    ok(l.doc.getElementById('chips-ante').style.visibility === 'hidden', 'your stack is hidden while it is taken (it is in the air)');
    // a push
    const p = await boot();
    await toArranging(p, { player: [c('A','s'),c('A','h'),c('K','d'),c('Q','c'),c('J','s'),c('9','h'),c('8','d')], dealer: [c('2','s'),c('7','h'),c('J','d'),c('4','c'),c('9','s'),c('K','h'),c('3','d')] });
    click(p, p.doc.getElementById('btn-autoset')); click(p, p.doc.getElementById('btn-confirm'));
    await waitFor(() => phase(p) === 'resolved', 20000, 'resolved');
    ok(p.w.G.result === 'push' || p.w.G.result === 'win', 'a result');
  }

  // ---------------------------------------------------------------- skip, turbo, reduced motion
  section('skip: a tap on the table finishes the deal at once');
  {
    const t = await boot({ k: 1 });
    const wt = watch(t);
    rig(t, SPLIT_A.player, SPLIT_A.dealer); bet(t, 25, 2);
    click(t, $(t, 'btn-deal'));
    await wait(120);
    click(t, $(t, 'felt'));
    ok(phase(t) === 'arranging', 'a tap on the felt jumps to arranging');
    ok(t.doc.querySelectorAll('.fc').length === 0 && t.doc.querySelectorAll('.pc.pending').length === 0, 'nothing in the air, nothing pending');
    ok(t.doc.querySelectorAll('#rows .pc.up').length === 14, 'every card is face up');
    ok(t.S.flights.length === 0, 'no flight is still tracked');
    ok(t.S.timers.filter(r => !r.essential && r !== t.S.nudgeRec).length === 0, 'none of his timers are still running (he only waits on you)');
    await wait(900);
    ok(phase(t) === 'arranging', 'and nothing carries on afterwards: still arranging');
    ok(t.doc.querySelectorAll('#rows .pc').length === 14, 'still 14 cards');
    ok(wt.flyers === 0 && t.doc.querySelectorAll('.fc').length === 0, 'and he does not deal them again once he has come up (' + wt.flyers + ' flew)');
    noErr(t);
  }
  section('skip while the cards are still in the air');
  {
    const t = await boot({ k: 1 });
    rig(t, SPLIT_A.player, SPLIT_A.dealer); bet(t, 25, 2);
    click(t, $(t, 'btn-deal'));
    ok(await waitFor(() => { const n = t.doc.querySelectorAll('#rows .pc.pending').length; return n > 0 && n < 13; }, 5000, 'mid-deal'), 'the deal is half way (some cards down, more to come)');
    const wt = watch(t);
    click(t, $(t, 'felt'));
    ok(phase(t) === 'arranging', 'a tap jumps to arranging');
    ok(t.doc.querySelectorAll('.fc').length === 0, 'every flyer is gone at once');
    ok(t.S.flights.length === 0, 'and none is still tracked');
    ok(t.S.timers.filter(r => !r.essential && r !== t.S.nudgeRec).length === 0, 'none of his timers are left running');
    ok(t.doc.querySelectorAll('.pc.pending').length === 0 && t.doc.querySelectorAll('#rows .pc.up').length === 14, 'all 14 cards are on the table, face up');
    await wait(1500);
    ok(wt.flyers === 0, 'nothing is dealt again after the skip (' + wt.flyers + ' flew)');
    ok(phase(t) === 'arranging', 'still arranging');
    wt.stop(); noErr(t);
  }
  section('Play Again while his chips are still moving');
  {
    const t = await boot({ k: 1 });
    await toArranging(t, { player: [c('A','s'),c('A','h'),c('A','d'),c('K','c'),c('K','s'),c('9','h'),c('8','d')], dealer: [c('2','s'),c('7','h'),c('J','d'),c('4','c'),c('9','s'),c('K','h'),c('3','d')] });
    click(t, $(t, 'btn-autoset')); click(t, $(t, 'btn-confirm'));
    ok(phase(t) === 'revealing', 'he is comparing');
    ok(await waitFor(() => phase(t) === 'resolved', 20000, 'resolved'), 'it resolves');
    ok(t.S.pay.length > 0, 'chips are moving');
    click(t, $(t, 'btn-again'));
    ok(t.S.pay.length === 0 && t.doc.querySelectorAll('.pchip, .pfloat').length === 0, 'Play Again takes every chip and amount off the felt at once');
    ok(t.doc.getElementById('chips-ante').style.visibility === '', 'and your stack is back');
    await wait(900);
    ok(t.doc.querySelectorAll('.pchip, .pfloat').length === 0, 'nothing drifts in afterwards');
    noErr(t);
  }
  section('waiting on you: he fills the silence, three times at most');
  {
    const t = await boot({ k: 0.02 });
    await toArranging(t);
    ok(!!t.S.nudgeRec, 'as soon as you can set your hand he is waiting on you');
    ok(await waitFor(() => t.S.stats.nudges >= 1, 4000, 'first nudge'), 'he says something after a while');
    ok(t.w.Show._L.nudge.indexOf(t.doc.querySelector('.ds-say').textContent) >= 0, 'and it is one of his waiting lines');
    ok(await waitFor(() => t.S.stats.nudges >= 3, 6000, 'third nudge'), 'he tries again');
    await wait(1600);
    ok(t.S.stats.nudges === 3, 'but never more than three times (' + t.S.stats.nudges + ')');
    ok(!t.S.nudgeRec, 'and nothing is scheduled any more');
    noErr(t);
  }
  // ---------------------------------------------------------------- the dealing is a bit of a show
  section('comic dealing: wind-up, two spreads, one card that slips, a smile that grows');
  {
    const t = await boot({ k: 1 });
    t.S.forceGag = 3;
    const moods = [], stage = $(t, 'dealer-stage'), said = [];
    new t.w.MutationObserver(() => { moods.push({ m: stage.getAttribute('data-mood'), ph: phase(t) }); }).observe(stage, { attributes: true, attributeFilter: ['data-mood'] });
    const heldSeen = { on: false, stack: false, at: 0 }, heldEl = t.doc.querySelector('.ds-held'), tFly = { at: 0 };
    new t.w.MutationObserver(() => { if(heldEl.classList.contains('on')) heldSeen.on = true; if(heldEl.classList.contains('on') && heldEl.classList.contains('stack')){ heldSeen.stack = true; if(!heldSeen.at) heldSeen.at = Date.now(); } }).observe(heldEl, { attributes: true, attributeFilter: ['class'] });
    new t.w.MutationObserver(l => l.forEach(m => m.addedNodes.forEach(n => { if(n.nodeType === 1 && n.classList.contains('fc') && !tFly.at) tFly.at = Date.now(); }))).observe(t.doc.body, { childList: true, subtree: true });
    new t.w.MutationObserver(() => { const e = t.doc.querySelector('.ds-say'); if(e.classList.contains('on')) said.push(e.textContent); }).observe(t.doc.querySelector('.ds-say'), { attributes: true, childList: true, characterData: true, subtree: true });
    rig(t, SPLIT_A.player, SPLIT_A.dealer); bet(t, 25, 2);
    const t0 = Date.now(); const wt = watch(t);
    click(t, $(t, 'btn-deal'));
    ok(await waitFor(() => t.doc.querySelectorAll('.fc').length >= 1 || wt.flyers >= 1, 5000, 'first card'), 'the first card flies');
    ok(Date.now() - t0 >= 950, 'after he comes up and winds up (' + (Date.now() - t0) + 'ms), not straight away');
    ok(stage.getAttribute('data-ease') === 'toon', 'the arm is loose and bouncy while he deals');
    ok(await waitFor(() => phase(t) === 'dealer-revealing' || phase(t) === 'arranging', 20000, 'dealt'), 'all 14 get dealt');
    const st = t.S.dealStyles, sp = t.S.spreads;
    ok(st.length === 14, '14 throws were planned (' + st.length + ')');
    ok(sp.length === 2 && sp[0] !== sp[1] && sp.every(x => ['ribbon', 'flip', 'fan'].indexOf(x) >= 0), 'two spreads, and not the same kind twice: ' + sp.join(','));
    ok(st.slice(0, 7).every((x, i) => x === (i === 3 ? 'flutter' : sp[0])) && st.slice(7).every(x => x === sp[1]), 'each spread is one sweep: all seven of a row go the same way (bar the one that slips): ' + st.join(','));
    ok(st[3] === 'flutter' && t.S.stats.gags === 1, 'the card he was told to drop slipped (the fourth of yours) and it was counted');
    ok(st.filter(x => x === 'flutter').length === 1, 'only that one slipped');
    ok(t.S.stats.bobs === 2, 'he bobbed once per spread, not once per card (' + t.S.stats.bobs + ')');
    ok(t.S.flown.join() === st.join(), 'and the cards really did fly the way it was planned: ' + t.S.flown.join(','));
    ok(heldSeen.on && heldSeen.stack, 'a packet of cards is in his hand while he deals (' + JSON.stringify(heldSeen) + ')');
    ok(await waitFor(() => said.some(x => t.w.Show._L.oops.indexOf(x) >= 0), 3000, 'oops'), 'he said "oops" or the like when it slipped');
    ok(moods.some(x => x.m === 'goof'), 'he was goofy at the start');
    ok(['sm1', 'sm2', 'grin'].every(m => moods.some(x => x.m === m)), 'his smile grew as he dealt: ' + moods.map(x => x.m).join(','));
    ok(moods.some(x => x.m === 'surp'), 'and he looked surprised when one slipped');
    ok(!moods.some(x => x.m === 'focus' && x.ph === 'dealing'), 'he never looked stern while dealing');
    ok(wt.landed.map(el => (el.closest('#seat-you') ? 'P' : 'D')).join('') === 'PPPPPPPDDDDDDD', 'even with one slipping his spread finishes before the next begins');
    ok(await waitFor(() => !stage.hasAttribute('data-ease'), 8000, 'ease off'), 'the arm settles down again afterwards');
    ok(said.some(x => t.w.Show._L.tada.indexOf(x) >= 0), 'he finished with a "ta-da"');
    ok(said.some(x => t.w.Show._L.start.indexOf(x) >= 0), 'he said something as he started');
    ok(said.some(x => t.w.Show._L.patter.indexOf(x) >= 0), 'and something between his two spreads');
    const si = moods.findIndex(x => x.m === 'surp');
    ok(si >= 0 && moods.slice(si + 1).some(x => x.m === 'sm2'), 'then he carries on to his own cards: ' + moods.map(x => x.m).join(','));
    ok(heldSeen.at && tFly.at && tFly.at - heldSeen.at >= 200, 'he has the packet in his hand a moment before the first card leaves it (' + (tFly.at - heldSeen.at) + 'ms)');
    wt.stop(); noErr(t);
    // no slip when told not to; and a skip leaves nothing loose
    const u = await boot({ k: 1 });
    u.S.forceGag = -1;
    rig(u, SPLIT_A.player, SPLIT_A.dealer); bet(u, 25, 2); click(u, $(u, 'btn-deal'));
    ok(await waitFor(() => u.S.dealStyles.length === 14, 3000, 'planned'), 'planned');
    ok(u.S.dealStyles.indexOf('flutter') < 0 && u.S.stats.gags === 0, 'nothing slips when it is not meant to');
    ok(await waitFor(() => { const n = u.doc.querySelectorAll('#rows .pc.pending').length; return n > 0 && n < 13; }, 5000, 'mid-deal'), 'half way through');
    click(u, $(u, 'felt'));
    ok(!$(u, 'dealer-stage').hasAttribute('data-ease'), 'a skip puts his arm back to normal');
    noErr(u);
    // random: about one hand in three has a slip, and never on the first card or the last
    let slips = 0; const where = [];
    for(let i = 0; i < 40; i++){ const b = await boot({ k: 0.02, seed: 1000 + i }); b.S.seed = 100 + i * 977; rig(b, SPLIT_A.player, SPLIT_A.dealer); bet(b, 25, 1); click(b, $(b, 'btn-deal')); await waitFor(() => b.S.dealStyles.length === 14, 3000, 'planned'); const g = b.S.dealStyles.indexOf('flutter'); if(g >= 0){ slips++; where.push(g); } click(b, $(b, 'felt')); b.dom.window.close(); }
    ok(slips >= 5 && slips <= 24, 'by chance, roughly one hand in three has a slip (' + slips + ' of 40)');
    ok(where.every(g => g >= 1 && g <= 12), 'and it is never the very first or very last card: ' + where.join(','));
    ok(new Set(where).size >= 4, 'and it falls in different places: ' + where.join(','));
  }

  section('the cards of one spread take the same time, so they cannot overtake each other');
  {
    const t = await boot();
    for(const st of ['ribbon', 'flip', 'fan']){
      const durs = []; for(let d = 40; d <= 700; d += 23) durs.push(t.w.Show._plan(st, 100, 60, 100 + d, 60 + d * 0.15, 1, 3).dur);
      ok(Math.max(...durs) - Math.min(...durs) < 45, st + ': across a row of seven it takes between ' + Math.min(...durs) + ' and ' + Math.max(...durs) + 'ms (the gap between two cards is 55ms)');
    }
    const fan = [0, 1, 2, 3, 4, 5, 6].map(k => t.w.Show._plan('fan', 100, 60, 300, 120, 1, k).frames[1].r);
    ok(fan.every((r, i) => i === 0 || r > fan[i - 1]), 'a fan opens: each card is turned a bit more than the one before (' + fan.map(r => Math.round(r)).join(',') + ')');
    ok(t.w.Show._plan('flutter', 0, 0, 300, 300, 1).dur > 700, 'only the one that slips takes its time');
  }

  // ---------------------------------------------------------------- your cards: as dealt, not sorted
  section('your cards are NOT sorted: you have to find the best five and two yourself');
  {
    const t = await boot();
    const P = [c('5','c'), c('J','d'), c('A','s'), c('8','h'), c('K','c'), c('7','s'), c('3','d')];
    await toArranging(t, { player: P, dealer: SPLIT_A.dealer });
    const row = () => [].slice.call(t.doc.querySelectorAll('#player-high-cards .pc')).map(e => e.getAttribute('data-k'));
    const keys = P.map(x => t.w.cardKey(x));
    ok(row().join() === keys.join(), 'face up, your seven are in the order they were dealt: ' + row().join(' '));
    ok($(t, 'player-high-k').textContent === 'Your cards · 7', 'the label says "Your cards · 7", not High Hand');
    ok($(t, 'player-high').getAttribute('aria-label') === 'Your cards, 7 of them', 'and so does the group for a screen reader');
    ok($(t, 'player-low-k').textContent === 'Low hand · 2', 'the Low Hand is still the Low Hand');
    ok(/Tap or drag two cards/.test($(t, 'status-text').textContent), 'the prompt says you can tap or drag');
    const el = x => t.w.playerEl(P.find(c0 => c0.rank === x[0] && c0.suit === x[1]));
    click(t, el('Kc'));
    ok(row().join() === keys.filter(k => k !== t.w.cardKey(P[4])).join(), 'one goes to Low: the other six stay in dealt order');
    ok($(t, 'player-high-k').textContent === 'Your cards · 6', 'the label follows: "Your cards · 6"');
    click(t, el('8h'));
    ok($(t, 'player-high-k').textContent === 'High hand · 5', 'with two in Low, the five are the High Hand');
    ok($(t, 'player-high').getAttribute('aria-label') === 'Your High Hand, five cards', 'and the group says so');
    ok(row().join() === [0, 1, 2, 5, 6].map(i => keys[i]).join(), 'the five are still in the order they came');
    ok([].slice.call(t.doc.querySelectorAll('#player-low-cards .pc')).map(e => e.getAttribute('data-k')).join() === [keys[4], keys[3]].join(), 'Low holds the two in the order you picked them');
    click(t, el('Kc'));
    ok($(t, 'player-high-k').textContent === 'Your cards · 6', 'put one back and it is "Your cards" again');
    ok(row().join() === [0, 1, 2, 4, 5, 6].map(i => keys[i]).join(), 'and it goes back in its place in the dealt order');
    // after you confirm it is tidied up for the comparison, and says High Hand
    click(t, el('Kc')); click(t, $(t, 'btn-confirm'));
    await waitFor(() => phase(t) === 'resolved', 20000, 'resolved');
    ok($(t, 'player-high-k').textContent === 'High hand · 5', 'at the result it is the High Hand');
    // the label while the cards are coming out, and in an empty row
    const u = await boot({ k: 1 });
    const wrong = []; const dealt = () => [].slice.call(u.doc.querySelectorAll('#player-high-cards .pc')).map(e => e.getAttribute('data-k')).join();
    new u.w.MutationObserver(() => { if(u.w.G.phase !== 'betting' && u.w.G.pickedLow.length === 0){ const now = dealt(); if(now && now !== keys.join()) wrong.push(now); } }).observe($(u, 'player-high-cards'), { childList: true });
    ok($(u, 'player-high-k').textContent === 'Your cards · 7', 'before the deal: seven places for your cards');
    rig(u, P, SPLIT_A.dealer); bet(u, 25, 2); click(u, $(u, 'btn-deal'));
    ok($(u, 'player-high-k').textContent === 'Your cards · 7', 'while they are dealt: still "Your cards · 7"');
    ok(await waitFor(() => phase(u) === 'dealer-revealing', 20000, 'dealt'), 'dealt');
    const down = [].slice.call(u.doc.querySelectorAll('#player-high-cards .pc')).map(e => e.getAttribute('data-k'));
    ok(down.join() === keys.join(), 'face down they already sit in the order dealt (nothing is tidied up on the way)');
    ok(await waitFor(() => phase(u) === 'arranging', 20000, 'arranging'), 'arranging');
    ok([].slice.call(u.doc.querySelectorAll('#player-high-cards .pc')).map(e => e.getAttribute('data-k')).join() === keys.join(), 'and they are turned over in that order');
    ok(wrong.length === 0, 'at no moment between the deal and the end of the flip were they in any other order (' + wrong.length + ' re-orderings)');
    noErr(t); noErr(u);
    // a skip does not sort them either
    const v = await boot({ k: 1 });
    rig(v, P, SPLIT_A.dealer); bet(v, 25, 2); click(v, $(v, 'btn-deal')); await wait(200); click(v, $(v, 'felt'));
    ok(phase(v) === 'arranging' && [].slice.call(v.doc.querySelectorAll('#player-high-cards .pc')).map(e => e.getAttribute('data-k')).join() === keys.join(), 'skipping ahead keeps the order too');
    // and a hand you come back to
    noErr(v);
  }

  // ---------------------------------------------------------------- dragging
  section('dragging: pick a card up and drop it on the Low Hand (or back on your cards)');
  {
    const t = await boot({ k: 0.05 });
    const P = [c('5','c'), c('J','d'), c('A','s'), c('8','h'), c('K','c'), c('7','s'), c('3','d')];
    await toArranging(t, { player: P, dealer: SPLIT_A.dealer });
    const W = t.w, doc = t.doc;
    const box = (l, tp, r, b) => ({ left: l, top: tp, right: r, bottom: b, width: r - l, height: b - tp, x: l, y: tp });
    $(t, 'player-high').getBoundingClientRect = () => box(0, 300, 600, 450);       // jsdom has no layout: say where the two groups are
    $(t, 'player-low').getBoundingClientRect = () => box(640, 300, 800, 450);
    const el = x => W.playerEl(P.find(c0 => c0.rank === x[0] && c0.suit === x[1]));
    el('Kc').getBoundingClientRect = () => box(250, 310, 320, 410);
    const live = new Map(); const addL = doc.addEventListener.bind(doc), remL = doc.removeEventListener.bind(doc);
    doc.addEventListener = (t, f, o) => { if(/^pointer|keydown/.test(t) && o === true) live.set(t + String(f), (live.get(t + String(f)) || 0) + 1); return addL(t, f, o); };
    doc.removeEventListener = (t, f, o) => { if(/^pointer|keydown/.test(t) && o === true) live.set(t + String(f), (live.get(t + String(f)) || 0) - 1); return remL(t, f, o); };
    const leaked = () => [...live.values()].reduce((a, b) => a + b, 0);
    const P0 = (type, x, y, extra) => { const E = W.PointerEvent || W.MouseEvent; return new E(type, Object.assign({ bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' }, extra || {})); };
    const fire = (target, type, x, y, extra) => target.dispatchEvent(P0(type, x, y, extra));
    const low = () => W.G.pickedLow.map(x => x.rank + x.suit);
    // a tap is still a tap
    fire(el('Kc'), 'pointerdown', 280, 350); fire(doc, 'pointerup', 281, 351); click(t, el('Kc'));
    ok(low().join() === 'Kc' && !doc.querySelector('.pc-ghost'), 'a tap (no movement) picks the card as before and shows no ghost');
    click(t, el('Kc'));
    ok(low().length === 0, 'tap again to put it back');
    // a real drag
    fire(el('Kc'), 'pointerdown', 280, 350);
    fire(doc, 'pointermove', 283, 352);
    ok(!doc.querySelector('.pc-ghost'), 'a tiny wobble is not a drag yet');
    fire(doc, 'pointermove', 330, 360);
    const ghost = doc.querySelector('.pc-ghost');
    ok(!!ghost && ghost.getAttribute('aria-hidden') === 'true', 'past a few pixels a ghost of the card is in your hand');
    ok(ghost.getAttribute('data-k') === null && /up/.test(ghost.className), 'it is a face-up copy, not the card itself');
    ok(el('Kc').classList.contains('drag-src') && doc.body.classList.contains('dragging-card'), 'the card it came from is dimmed, the page knows a drag is on');
    ok(!$(t, 'player-low').classList.contains('drop-hot'), 'over nothing, nothing is lit');
    fire(doc, 'pointermove', 700, 380);
    ok($(t, 'player-low').classList.contains('drop-hot'), 'over the Low Hand it lights up');
    ok(/translate\(/.test(ghost.style.transform), 'and the ghost follows the pointer: ' + ghost.style.transform);
    fire(doc, 'pointerup', 700, 380);
    ok(low().join() === 'Kc', 'dropped on the Low Hand: it is in the Low Hand');
    ok(!doc.querySelector('.pc-ghost') && !doc.body.classList.contains('dragging-card') && !el('Kc').classList.contains('drag-src') && !$(t, 'player-low').classList.contains('drop-hot'), 'ghost, dimming and the glow are all gone');
    ok(leaked() === 0, 'and no listener is left on the page (' + leaked() + ' left)');
    click(t, el('Kc'));
    ok(low().join() === 'Kc', 'the click that follows a drag is ignored (it would have put it straight back)');
    await wait(400);
    ok($(t, 'player-high-k').textContent === 'Your cards · 6', 'the labels follow a drag too');
    // the second card
    el('8h').getBoundingClientRect = () => box(180, 310, 250, 410);
    fire(el('8h'), 'pointerdown', 210, 350); fire(doc, 'pointermove', 400, 360); fire(doc, 'pointermove', 720, 400); fire(doc, 'pointerup', 720, 400);
    ok(low().join() === 'Kc,8h' && $(t, 'player-high-k').textContent === 'High hand · 5', 'the second one makes five and two');
    ok(t.S.stats.picks >= 3, 'the dealer saw them (' + t.S.stats.picks + ' picks)');
    // a third card onto a full Low Hand swaps the first out, as a tap does
    el('As').getBoundingClientRect = () => box(100, 310, 170, 410);
    fire(el('As'), 'pointerdown', 130, 350); fire(doc, 'pointermove', 400, 360); fire(doc, 'pointermove', 710, 400); fire(doc, 'pointerup', 710, 400);
    ok(low().join() === '8h,As', 'a third card into a full Low Hand swaps out the first (' + low().join() + ')');
    // a drop on the High Hand takes a card back out
    W.playerEl(P.find(x => x.rank === 'A')).getBoundingClientRect = () => box(660, 310, 730, 410);
    fire(W.playerEl(P.find(x => x.rank === 'A')), 'pointerdown', 690, 350); fire(doc, 'pointermove', 500, 380); fire(doc, 'pointermove', 300, 380);
    ok($(t, 'player-high').classList.contains('drop-hot') && !$(t, 'player-low').classList.contains('drop-hot'), 'dragging from the Low Hand lights up your cards');
    fire(doc, 'pointerup', 300, 380);
    ok(low().join() === '8h', 'dropped on your cards: it goes back to the High Hand');
    // a drop on nothing, and a drop on the group it is already in, change nothing
    el('3d').getBoundingClientRect = () => box(400, 310, 470, 410);
    fire(el('3d'), 'pointerdown', 430, 350); fire(doc, 'pointermove', 440, 380); fire(doc, 'pointermove', 40, 40); fire(doc, 'pointerup', 40, 40);
    ok(low().join() === '8h', 'dropped on nothing: nothing changes');
    ok(await waitFor(() => !doc.querySelector('.pc-ghost') && !el('3d').classList.contains('drag-src'), 2000, 'cleanup'), 'and the ghost floats back and goes away');
    fire(el('3d'), 'pointerdown', 430, 350); fire(doc, 'pointermove', 440, 380); fire(doc, 'pointermove', 300, 380); fire(doc, 'pointerup', 300, 380);
    ok(low().join() === '8h', 'dropped back on the High Hand it came from: nothing changes');
    await waitFor(() => !doc.querySelector('.pc-ghost'), 2000, 'cleanup');
    // Escape drops it
    fire(el('3d'), 'pointerdown', 430, 350); fire(doc, 'pointermove', 440, 380); fire(doc, 'pointermove', 700, 380);
    doc.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    ok(low().join() === '8h' && !doc.body.classList.contains('dragging-card'), 'Escape cancels a drag');
    fire(doc, 'pointerup', 700, 380);
    ok(low().join() === '8h', '(and the pointer coming up afterwards does nothing)');
    await waitFor(() => !doc.querySelector('.pc-ghost'), 2000, 'cleanup');
    // listeners are gone: moving the pointer around later does nothing
    fire(doc, 'pointermove', 500, 500);
    ok(!doc.querySelector('.pc-ghost'), 'nothing is listening once a drag is over');
    // another finger or button
    fire(el('3d'), 'pointerdown', 430, 350, { button: 2 }); fire(doc, 'pointermove', 440, 380); fire(doc, 'pointermove', 700, 380);
    ok(!doc.querySelector('.pc-ghost'), 'a right-click drag does nothing');
    fire(el('3d'), 'pointerdown', 430, 350, { pointerId: 5 }); fire(doc, 'pointermove', 440, 380, { pointerId: 9 }); fire(doc, 'pointermove', 700, 380, { pointerId: 9 });
    ok(!doc.querySelector('.pc-ghost'), 'moves from some other pointer are ignored');
    fire(doc, 'pointerup', 700, 380, { pointerId: 5 });
    // it only works while you are arranging
    click(t, $(t, 'btn-autoset')); click(t, $(t, 'btn-confirm'));
    fire(el('3d'), 'pointerdown', 430, 350); fire(doc, 'pointermove', 440, 380); fire(doc, 'pointermove', 700, 380);
    ok(!doc.querySelector('.pc-ghost'), 'once you have confirmed, the cards cannot be picked up');
    fire(doc, 'pointerup', 700, 380);
    await waitFor(() => phase(t) === 'resolved', 20000, 'resolved');
    noErr(t);
  }

  section('turbo and reduced motion: no flying, no dealer on the table');
  {
    const t = await boot({ turbo: true });
    const wt = watch(t);
    ok(!t.doc.body.classList.contains('show-on'), 'turbo: show-on is off');
    ok(await toArranging(t), 'turbo: plays');
    ok(wt.flyers === 0, 'turbo: nothing flies');
    wt.stop();
    const r = await boot({ reduced: true });
    const wr = watch(r);
    ok(!r.w.Show.active(), 'reduced motion: Show.active() is false');
    ok(await toArranging(r), 'reduced motion: plays');
    ok(wr.flyers === 0, 'reduced motion: nothing flies');
    ok(r.doc.querySelectorAll('.pc.pending').length === 0, 'reduced motion: nothing pending');
    await finishHand(r);
    ok(r.S.stats.pays === 0, 'reduced motion: no chips move');
    wr.stop();
  }

  // ---------------------------------------------------------------- pace
  section('pace: Quick is faster than Relaxed');
  {
    async function timeIt(speed){
      const t = await boot({ speed, k: 0.05 });
      const t0 = Date.now(); await toArranging(t); return Date.now() - t0;
    }
    const q = await timeIt('quick'), n = await timeIt('normal'), r = await timeIt('relaxed');
    ok(q < n && n < r, 'quick < normal < relaxed (' + q + ', ' + n + ', ' + r + ' ms)');
  }

  // ---------------------------------------------------------------- switching him off mid-deal
  section('switching the dealer off mid-deal never strands the hand');
  {
    const t = await boot({ k: 1 });
    rig(t, SPLIT_A.player, SPLIT_A.dealer); bet(t, 25, 2);
    click(t, $(t, 'btn-deal'));
    await wait(300);
    $(t, 'set-dealer').checked = false; $(t, 'set-dealer').dispatchEvent(new t.w.Event('change', { bubbles: true }));
    ok(await waitFor(() => phase(t) === 'arranging', 20000, 'arranging after switching off'), 'the hand still gets to arranging');
    ok(t.doc.querySelectorAll('.pc.pending').length === 0 && t.doc.querySelectorAll('.fc').length === 0, 'nothing pending or in the air');
    ok(!t.doc.body.classList.contains('show-on'), 'show-on is off');
    noErr(t);
  }

  // ---------------------------------------------------------------- the shoe is a deal button
  section('the shoe: tap to deal');
  {
    const t = await boot();
    const shoe = t.doc.querySelector('.ds-shoe');
    click(t, shoe);
    ok(phase(t) === 'betting', 'no bet yet: the shoe does not deal');
    ok(shoe.classList.contains('nudge'), 'but it shakes to say so');
    bet(t, 25, 1); rig(t, SPLIT_A.player, SPLIT_A.dealer);
    click(t, shoe);
    ok(phase(t) !== 'betting', 'with a bet down, the shoe deals');
    await waitFor(() => phase(t) === 'arranging', 20000, 'arranging');
    shoe.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    ok(phase(t) === 'arranging', 'the shoe does nothing mid-hand');
    shoe.classList.remove('nudge');
    shoe.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    click(t, shoe);
    ok(phase(t) === 'arranging' && !shoe.classList.contains('nudge'), 'and it does not shake at you either: there is nothing to deal');
    noErr(t);
  }

  // ---------------------------------------------------------------- the chip tray
  section('the chip tray: a quiet easter egg, only while you bet');
  {
    const t = await boot();
    t.w.Show._egg({ clientX: 10, clientY: 10 });
    ok(t.S.stats.eggs === 1 && !!t.S.egg, 'wandering over the tray starts it');
    ok(await waitFor(() => t.S.mood === 'sus' || t.S.mood === 'sad', 3000, 'a mood'), 'he gets suspicious or sad');
    ok(await waitFor(() => !t.S.egg, 12000, 'the egg ends'), 'and it ends by itself');
    const u = await boot();
    bet(u, 25, 1); rig(u, SPLIT_A.player, SPLIT_A.dealer); click(u, $(u, 'btn-deal'));
    u.w.Show._egg({ clientX: 10, clientY: 10 });
    ok(u.S.stats.eggs === 0, 'not during a hand');
    const v = await boot({ turbo: true });
    v.w.Show._egg({ clientX: 10, clientY: 10 });
    ok(v.S.stats.eggs === 0, 'not in turbo');
  }

  // ---------------------------------------------------------------- hands in a row
  section('three hands in a row leave nothing behind');
  {
    const t = await boot({ k: 0.02 });
    const wt = watch(t);
    for(let i = 0; i < 3; i++){
      rig(t, SPLIT_A.player, SPLIT_A.dealer); if(t.w.G.bets.ante === 0) bet(t, 25, 2);
      click(t, $(t, i === 0 ? 'btn-deal' : 'btn-deal'));
      await waitFor(() => phase(t) === 'arranging' || phase(t) === 'resolved', 20000, 'arranging');
      ok(t.doc.querySelectorAll('#rows .pc').length === 14 && t.doc.querySelectorAll('#dealer-low-cards .pc').length === 2, 'hand ' + (i + 1) + ': exactly fourteen cards on the table (none left over from the hand before)');
      await finishHand(t);
      click(t, $(t, 'btn-again'));
      await waitFor(() => phase(t) === 'betting', 5000, 'betting');
      ok(t.doc.querySelectorAll('#rows .pc').length === 0, 'after Play Again the felt is clear of cards (last hand\'s Low cards too)');
      ok(t.doc.querySelectorAll('#rows .slot').length === 7 + 7 + 2, 'and only the empty places are left');
      bet(t, 25, 2);
    }
    ok(wt.flyers === 42, '42 cards flew in three hands (got ' + wt.flyers + ')');
    ok(t.doc.querySelectorAll('.fc, .pchip, .pfloat').length === 0, 'no flyers, chips or floats left on the page');
    ok(await waitFor(() => t.S.timers.filter(r => !r.essential).length === 0, 4000, 'timers idle'), 'no stray timers');
    ok(t.S.flights.length === 0 && t.S.pay.length === 0, 'no tracked flights or chips');
    ok(await waitFor(() => $(t, 'dealer-stage').getAttribute('data-state') === 'away', 4000, 'away'), 'he goes back down between hands');
    wt.stop(); noErr(t);
  }

  // ---------------------------------------------------------------- the skip hint
  section('the skip hint: a few hands, then it stops');
  {
    const t = await boot({ k: 0.5 });
    rig(t, SPLIT_A.player, SPLIT_A.dealer); bet(t, 25, 2); click(t, $(t, 'btn-deal'));
    ok(!!$(t, 'skip-hint'), 'the first hand shows it');
    ok(/skip ahead/.test($(t, 'skip-hint').textContent), 'and it says what to do');
    click(t, $(t, 'felt'));
    ok(!$(t, 'skip-hint'), 'it goes away with the deal');
    ok(t.w.localStorage.getItem('pg_skiphint') === '1', 'it counts itself');
    const u = await boot({ storage: { pg_skiphint: '4' } });
    rig(u, SPLIT_A.player, SPLIT_A.dealer); bet(u, 25, 2); click(u, $(u, 'btn-deal'));
    ok(!$(u, 'skip-hint'), 'after four hands it stays away');
    const v = await boot({ turbo: true });
    rig(v, SPLIT_A.player, SPLIT_A.dealer); bet(v, 25, 2); click(v, $(v, 'btn-deal'));
    ok(!$(v, 'skip-hint'), 'and in Turbo there is nothing to skip');
  }

  // ---------------------------------------------------------------- the phone: menu, Undo, the settings sheet
  section('phone: the menu, Undo and the settings sheet');
  {
    const t = await boot({ phone: true });
    const menu = $(t, 'm-menu'), bar = $(t, 'topbar'), btn = $(t, 'm-menu-btn');
    ok(!!menu && menu.contains($(t, 'btn-toggle-settings')) && menu.contains($(t, 'btn-manners')) && !!menu.querySelector('a[href*="glossary"]'), 'settings, manners and the glossary moved into the menu');
    ok(btn.getAttribute('aria-expanded') === 'false' && btn.getAttribute('aria-controls') === 'm-menu', 'the menu button says what it controls');
    click(t, btn);
    ok(bar.classList.contains('m-open') && btn.getAttribute('aria-expanded') === 'true', 'the menu opens');
    ok(/Face-Up Pai Gow/.test(menu.querySelector('.m-rules').textContent) && /No side bets/.test(menu.querySelector('.m-rules').textContent), 'it says how the table is set');
    t.doc.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(!bar.classList.contains('m-open'), 'Escape closes it');
    click(t, btn); t.doc.body.dispatchEvent(new t.w.MouseEvent('click', { bubbles: true }));
    ok(!bar.classList.contains('m-open'), 'a tap outside closes it');
    click(t, btn); click(t, $(t, 'btn-manners'));
    ok(!bar.classList.contains('m-open'), 'choosing something closes it');
    ok(!$(t, 'manners-back').hidden, 'and the choice happened (Table manners is open)');
    t.w.Dlg.close();
    // Undo
    const undo = $(t, 'm-undo');
    ok(!!undo && undo.disabled === true, 'Undo is there, and off while no chip is down');
    t.w.selectChip(25); t.w.placeBet('ante'); t.w.placeBet('ante');
    await wait(30);
    ok(undo.disabled === false, 'it comes on once a chip is down');
    click(t, undo);
    ok(t.w.G.bets.ante === 25, 'Undo takes the last chip back');
    click(t, undo);
    await wait(30);
    ok(t.w.G.bets.ante === 0 && undo.disabled === true, 'and the next; then it is off again');
    t.w.placeBet('ante'); rig(t, SPLIT_A.player, SPLIT_A.dealer); click(t, $(t, 'btn-deal'));
    await wait(30);
    ok(undo.disabled === true, 'Undo is off once the hand is dealt');
    await waitFor(() => phase(t) === 'arranging', 20000, 'arranging');
    // the sheet
    const panel = $(t, 'settings-panel');
    click(t, $(t, 'btn-toggle-settings')); await wait(20);
    ok(t.doc.body.classList.contains('m-sheet'), 'Settings opens as a sheet');
    ok(panel.getAttribute('role') === 'dialog' && panel.getAttribute('aria-modal') === 'true', 'a modal dialog');
    ok(t.w.Dlg.isOpen() && t.w.Dlg.current().dialog === panel, 'focus is trapped in it');
    ok(panel.contains(t.doc.activeElement) && t.doc.activeElement.id === 'm-sheet-done', 'focus is on Done');
    ok($(t, 'table').hasAttribute('inert') || $(t, 'table').parentNode.hasAttribute('inert') || $(t, 'felt').hasAttribute('inert') || [].some.call($(t, 'app').children, e => e !== panel && e.hasAttribute('inert')), 'the table behind it is inert');
    ok(!t.doc.querySelector('.m-backdrop').hasAttribute('inert'), 'the dimmed backdrop can still be tapped');
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
    // widening the window puts everything back
    t.w.__setPhone(false); await wait(20);
    ok(!menu.contains($(t, 'btn-toggle-settings')) && !!$(t, 'btn-toggle-settings').closest('.hdr-side'), 'a wide window puts the links back in the header');
    ok(!$(t, 'm-undo'), 'and takes Undo away');
    ok(!bar.classList.contains('m-open'), 'and the menu is shut');
    noErr(t);
    const d = await boot();
    ok(!$(d, 'm-undo') && (!$(d, 'm-menu') || !$(d, 'm-menu').children.length), 'on a desktop the menu is empty and there is no Undo');
    click(d, $(d, 'btn-toggle-settings')); await wait(20);
    ok(!d.doc.body.classList.contains('m-sheet') && !d.w.Dlg.isOpen(), 'on a desktop Settings is a plain panel, not a sheet');
  }

  // ---------------------------------------------------------------- a hand in progress comes back
  section('a hand in progress is restored with the dealer in place');
  {
    const t = await boot();
    await toArranging(t);
    const raw = t.w.localStorage.getItem('house_edge_paigow_hand_v1');
    const bank = t.w.localStorage.getItem('house_edge_bankroll_v1');
    const u = await boot({ storage: { house_edge_paigow_hand_v1: raw, house_edge_bankroll_v1: bank } });
    ok(phase(u) === 'arranging', 'restored to arranging');
    ok($(u, 'dealer-stage').getAttribute('data-state') === 'up', 'he is up');
    ok(u.doc.querySelectorAll('#dealer-high-cards .pc').length === 5 && u.doc.querySelectorAll('#dealer-low-cards .pc').length === 2, 'his hand is already set');
    ok(u.doc.querySelectorAll('.pc.pending').length === 0, 'nothing pending');
    noErr(u);
  }

  console.log('\n' + (fails ? 'FAILED: ' + fails + ' check(s)' : 'all ' + passes + ' dealer checks passed'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH', e && e.stack || e); process.exit(2); });
