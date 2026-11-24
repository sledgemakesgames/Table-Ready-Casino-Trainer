// Sound wiring across the five games (jsdom): one switch, kept in step everywhere; every moment asks the engine for the sound it should.
// Run from the site folder:  node test_sound.js
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

let failures = 0, oks = 0;
function check(desc, actual, expected){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(!ok){ failures++; console.log('FAIL:', desc, '| got', JSON.stringify(actual), 'expected', JSON.stringify(expected)); }
  else { oks++; console.log('OK:', desc); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'house_edge_sound_v1';

// what each game calls its own "sound is on" flag
const GAMES = [
  { dir: 'blackjack', menu: true,            flag: w => w.G.soundOn,          legacy: { key: 'soft17_session_v1',          val: { settings: { soundOn: false } } } },
  { dir: 'baccarat', menu: true,             flag: w => w.G.soundOn,          legacy: null },
  { dir: 'pai-gow', menu: true,              flag: w => w.G.soundOn,          legacy: { key: 'house_edge_paigow_settings_v1', val: { 'set-sound': false } } },
  { dir: 'ultimate-texas-holdem', menu: true, flag: w => w.G.soundOn,         legacy: { key: 'house_edge_uth_settings_v1',   val: { 'set-sound': false } } },
  { dir: 'craps', menu: false,               flag: w => w.G.settings.sound,   legacy: { key: 'house_edge_craps_session_v1',  val: { settings: { sound: false } } } },
];

// a fake Web Audio: counts the nodes made, so "the engine really started to play" is visible without a speaker
function load(g, opts){
  opts = opts || {};
  const html = fs.readFileSync(path.join(__dirname, g.dir, 'index.html'), 'utf8');
  const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://tableready.xyz/' + g.dir + '/',
    beforeParse(w){
      let s = 987654321; w.Math.random = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
      w.alert = () => {};
      w.Element.prototype.animate = function(){ return { onfinish: null, cancel(){}, finish(){} }; };
      if(opts.phone) w.matchMedia = q => ({ matches: /max-width/.test(q), addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
      if(opts.audio){
        const rec = w.__audio = { made: 0, ctx: 0 };
        const P = () => ({ value: 0, setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){}, setTargetAtTime(){}, cancelScheduledValues(){} });
        w.AudioContext = function(){
          rec.ctx++; this.sampleRate = 8000; this.destination = {}; this.currentTime = 0; this.state = 'running'; this.resume = () => Promise.resolve(); this.suspend = () => Promise.resolve();
          const node = () => { rec.made++; return { connect(){}, disconnect(){}, start(){}, stop(){}, frequency: P(), gain: P(), Q: P(), detune: P(), type: 'sine', buffer: null, loop: false, playbackRate: P(), threshold: P(), knee: P(), ratio: P(), attack: P(), release: P(), onended: null }; };
          this.createOscillator = node; this.createGain = node; this.createBufferSource = node; this.createBiquadFilter = node; this.createDynamicsCompressor = node;
          this.createBuffer = n => ({ length: n, getChannelData: () => new Float32Array(n) });
        };
      }
      if(opts.storage) for (const k of Object.keys(opts.storage)) w.localStorage.setItem(k, typeof opts.storage[k] === 'string' ? opts.storage[k] : JSON.stringify(opts.storage[k]));
    } });
  const w = dom.window;
  w.__errors = errors;
  return w;
}
function $(w, id){ return w.document.getElementById(id); }
function press(w, el){ el.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true })); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); }
function change(w, box, on){ box.checked = on; box.dispatchEvent(new w.Event('change', { bubbles: true })); }
// every ask the game makes of the engine, in order (the glue's gate sits on top of this, so a muted game asks nothing)
function spy(w){
  const asks = [];
  const T = w.TRSound, inner = T.play;
  T.play = function(n, o){
    let r = o;
    if (o){ r = Object.assign({}, o); if (typeof r.v === 'number') r.v = Math.round(r.v * 1000) / 1000; }
    asks.push(r ? [n, r] : [n]);
    return inner.call(T, n, o);
  };
  return asks;
}
function stored(w){ try{ return w.localStorage.getItem(KEY); }catch(e){ return 'denied'; } }

(async function(){
  for (const g of GAMES){
    console.log('\n=== ' + g.dir.toUpperCase() + ' ===');
    const w = load(g);
    await sleep(60);
    const T = w.TRSound, btn = $(w, 'snd-btn'), box = $(w, 'set-sound');
    check(g.dir + ': the engine is on the page with every recipe', [!!T, ['chip', 'card', 'win', 'lose', 'push', 'riffle', 'chime', 'thud', 'swish', 'tap'].every(n => T.names().indexOf(n) >= 0)], [true, true]);
    check(g.dir + ': no script errors at load', w.__errors, []);
    check(g.dir + ': sound starts on, everywhere', [T.enabled(), !!g.flag(w), box.checked, btn.getAttribute('aria-pressed')], [true, true, true, 'true']);
    check(g.dir + ': the speaker is a labelled button', [btn.classList.contains('snd-btn'), btn.tagName, /Sound on/.test(btn.getAttribute('aria-label'))], [true, 'BUTTON', true]);

    // the header speaker
    press(w, btn);
    check(g.dir + ': the speaker mutes everything at once (engine, game flag, checkbox, label, saved choice)', [T.enabled(), !!g.flag(w), box.checked, btn.getAttribute('aria-pressed'), /Sound off/.test(btn.getAttribute('aria-label')), stored(w)], [false, false, false, 'false', true, '0']);
    press(w, btn);
    check(g.dir + ': and turns it all back on', [T.enabled(), !!g.flag(w), box.checked, btn.getAttribute('aria-pressed'), stored(w)], [true, true, true, 'true', '1']);

    // the settings checkbox
    change(w, box, false);
    check(g.dir + ': the settings checkbox mutes the speaker and the engine too', [T.enabled(), !!g.flag(w), btn.getAttribute('aria-pressed'), stored(w)], [false, false, 'false', '0']);
    change(w, box, true);
    check(g.dir + ': and turns them back on', [T.enabled(), !!g.flag(w), btn.getAttribute('aria-pressed'), stored(w)], [true, true, 'true', '1']);

    // a muted engine plays nothing
    T.set(false);
    check(g.dir + ': a muted engine plays nothing', T.play('win'), false);
    T.set(true, true);

    // the phone menu carries a Sound item that follows the switch
    const wp = load(g, { phone: true });
    await sleep(60);
    const m = $(wp, 'm-sound');
    if (g.menu){
      check(g.dir + ': the phone menu has a Sound item', !!m, true);
      if (m){
        check(g.dir + ': the phone menu Sound item says on', [m.textContent, m.getAttribute('aria-pressed')], ['Sound: on', 'true']);
        press(wp, m);
        check(g.dir + ': pressing it mutes (and the speaker, the checkbox, the flag follow)', [m.textContent, wp.TRSound.enabled(), $(wp, 'snd-btn').getAttribute('aria-pressed'), $(wp, 'set-sound').checked, !!g.flag(wp), stored(wp)], ['Sound: off', false, 'false', false, false, '0']);
        press(wp, m);
        check(g.dir + ': and pressing it again turns everything back on', [m.textContent, wp.TRSound.enabled(), !!g.flag(wp)], ['Sound: on', true, true]);
      }
    } else {
      check(g.dir + ': (no phone menu on this page; the speaker stays in the header)', [!!m, !!$(wp, 'snd-btn')], [false, true]);
    }
    wp.close();

    // a saved choice carries over; a first visit with an old "sound off" setting keeps that choice once
    const off = load(g, { storage: { [KEY]: '0' } }); await sleep(60);
    check(g.dir + ': a saved "off" opens muted everywhere', [off.TRSound.enabled(), !!g.flag(off), $(off, 'set-sound').checked, $(off, 'snd-btn').getAttribute('aria-pressed')], [false, false, false, 'false']);
    off.close();
    const on = load(g, { storage: { [KEY]: '1' } }); await sleep(60);
    check(g.dir + ': a saved "on" opens on everywhere', [on.TRSound.enabled(), !!g.flag(on), $(on, 'set-sound').checked], [true, true, true]);
    on.close();
    if (g.legacy){
      const lg = load(g, { storage: { [g.legacy.key]: g.legacy.val } }); await sleep(80);
      check(g.dir + ': an older "sound off" setting is kept once, and becomes the site-wide choice', [lg.TRSound.enabled(), !!g.flag(lg), $(lg, 'set-sound').checked, stored(lg)], [false, false, false, '0']);
      lg.close();
      const lg2 = load(g, { storage: { [g.legacy.key]: g.legacy.val, [KEY]: '1' } }); await sleep(80);
      check(g.dir + ': ...but a choice already made on the site wins over the old setting', [lg2.TRSound.enabled(), !!g.flag(lg2)], [true, true]);
      lg2.close();
    }
    // no storage at all: still works for the session
    const ns = load(g, { audio: false }); ns.close();

    // with a (fake) audio device the engine really builds sounds, and goes quiet when muted
    const wa = load(g, { audio: true }); await sleep(60);
    wa.TRSound.unlock();
    const afterUnlock = wa.__audio.made;
    check(g.dir + ': there is no background murmur (the first tap builds only the output chain, and the engine has no ambience at all)', [afterUnlock <= 4, typeof wa.TRSound.ambient], [true, 'undefined']);
    const before = wa.__audio.made;
    wa.TRSound.play('chip');
    check(g.dir + ': with an audio device a chip click really makes sound nodes', wa.__audio.made > before, true);
    // the game's own flag gates the engine even if the two ever drifted apart (set the flag only, not the switch)
    const setFlag = v => { if (g.dir === 'craps') wa.G.settings.sound = v; else wa.G.soundOn = v; };
    setFlag(false);
    const gated = wa.__audio.made;
    wa.TRSound.play('chip'); wa.TRSound.play('win');
    check(g.dir + ': with the game flag off the engine makes no sound, though its own switch is on', [wa.__audio.made, wa.TRSound.enabled()], [gated, true]);
    setFlag(true);
    wa.TRSound.play('chip');
    check(g.dir + ': and with the flag back on it plays again', wa.__audio.made > gated, true);
    wa.TRSound.set(false);
    const quiet = wa.__audio.made;
    wa.TRSound.play('chip'); wa.TRSound.play('win');
    check(g.dir + ': and a muted engine makes none', wa.__audio.made, quiet);
    check(g.dir + ': the whole thing made no script errors', wa.__errors, []);
    wa.close();
    const wm = load(g, { audio: true, storage: { [KEY]: '0' } }); await sleep(60);
    wm.TRSound.unlock();
    check(g.dir + ': a muted visitor builds only the output chain too', wm.__audio.made <= 4, true);
    wm.close();
    w.close();
  }

  // ---------------- what each moment asks of the engine (the sfx -> sound mapping) ----------------
  console.log('\n=== WHAT EACH MOMENT ASKS FOR ===');
  async function mapping(dir, calls){
    const g = GAMES.find(x => x.dir === dir);
    const w = load(g); await sleep(60);
    if (w.G && 'tableShow' in w.G) w.G.tableShow = false;   // the dealer's own show answers some of these itself; here we ask the plain ones
    const asks = spy(w);
    for (const [fn, args, expect] of calls){
      asks.length = 0;
      if (typeof w[fn] !== 'function'){ check(dir + ': ' + fn + '() exists', typeof w[fn], 'function'); continue; }
      w[fn].apply(w, args || []);
      check(dir + ': ' + fn + '(' + (args || []).join(',') + ') asks for ' + JSON.stringify(expect), asks, expect);
    }
    w.close();
  }
  await mapping('blackjack', [
    ['sfxCard', [], [['card']]], ['sfxChip', [], [['chip']]], ['sfxWin', [], [['win']]], ['sfxLose', [], [['lose']]], ['sfxPush', [], [['push']]],
    ['sfxHit', [], [['tap', { v: 0.8 }]]], ['sfxStand', [], [['swish', { v: 0.6 }]]], ['sfxDouble', [], [['chips', { n: 2 }]]], ['sfxSplit', [], [['chips', { n: 3, v: 0.8 }]]],
    ['sfxSurrender', [], [['slide']]], ['sfxShuffle', [], [['riffle']]],
  ]);
  await mapping('baccarat', [
    ['sfxFlip', [], [['flip']]], ['sfxChip', [], [['chip']]], ['sfxDeal', [], [['card']]], ['sfxWin', [], [['win']]], ['sfxLose', [], [['lose']]], ['sfxPush', [], [['push']]],
    ['sfxThirdCard', [], [['card', { v: 0.9 }]]],
  ]);
  await mapping('pai-gow', [
    ['sfxFlip', [], [['flip']]], ['sfxChip', [], [['chip']]], ['sfxDeal', [], [['card']]], ['sfxWin', [], [['win']]], ['sfxLose', [], [['lose']]], ['sfxPush', [], [['push']]],
  ]);
  await mapping('ultimate-texas-holdem', [
    ['sfxFlip', [], [['flip']]], ['sfxChip', [], [['chip']]], ['sfxDeal', [], [['card']]], ['sfxWin', [], [['win']]], ['sfxLose', [], [['lose']]], ['sfxPush', [], [['push']]],
  ]);
  await mapping('craps', [
    ['sfxChip', [], [['chip']]], ['sfxWin', [], [['win']]], ['sfxLose', [], [['lose']]], ['sfxPoint', [], [['point']]], ['sfxPush', [], [['push']]],
    ['sfxRoll', [], [['rattle', { dur: 0.34, v: 0.7 }]]], ['sfxSweep', [], [['swish', { v: 0.9 }], ['tap', { v: 0.5 }]]], ['sfxLift', [], [['lift']]],
    ['sfxDrop', [], [['bounce', { n: 2, v: 0.81 }]]], ['sfxDrop', [1], [['bounce', { n: 2, v: 1.05 }]]],
    ['sfxWall', [], [['wall', { v: 0.99 }]]], ['sfxWall', [0], [['wall', { v: 0.5 }]]], ['sfxClack', [], [['wall', { v: 0.6 }]]], ['sfxClack', [1], [['wall', { v: 0.8 }]]],
    ['sfxWhoosh', [2000], [['swish', { v: 0.85 }]]], ['sfxWhoosh', [0], [['swish', { v: 0.45 }]]], ['sfxTick', [], [['bounce', { n: 1, v: 0.6 }]]], ['sfxTurn', [], [['tap', { v: 0.6 }]]],
  ]);


  // ---------------- the engine on its own (the landing page has no game flag in front of it) ----------------
  console.log('\n=== THE ENGINE ON THE LANDING PAGE ===');
  {
    const L = { dir: '.', flag: () => true };
    const w = load(L, { audio: true }); await sleep(60);
    const T = w.TRSound;
    check('landing: the engine is there with a footer switch', [!!T, !!$(w, 'snd-foot'), T.enabled()], [true, true, true]);
    T.unlock();
    const a = w.__audio.made; T.play('chip');
    check('landing: sound on makes sound', w.__audio.made > a, true);
    T.set(false); const q = w.__audio.made;
    T.play('chip'); T.play('win'); T.play('coin');
    check('landing: a muted engine makes none (the engine itself keeps quiet, nothing in front of it)', w.__audio.made, q);
    check('landing: and says so', T.play('chip'), false);
    T.set(true, true); const b = w.__audio.made; T.play('coin');
    check('landing: turned back on, the coin sound plays', w.__audio.made > b, true);
    check('landing: no script errors', w.__errors, []);
    w.close();
    const off = load(L, { audio: true, storage: { [KEY]: '0' } }); await sleep(60);
    off.TRSound.unlock();
    check('landing: a saved "off" builds nothing and the footer says off', [off.TRSound.enabled(), off.__audio.made <= 4, $(off, 'snd-state').textContent, $(off, 'snd-foot').textContent], [false, true, 'off', 'Turn on']);
    off.close();
  }

  // turbo skips the long ones
  {
    const w = load(GAMES[0]); await sleep(60); const asks = spy(w);
    w.G.turbo = true; w.sfxCard();
    check('blackjack: in turbo the card flick stays silent', asks, []);
    w.close();
    const c = load(GAMES[4]); await sleep(60); const a2 = spy(c);
    c.G.settings.turbo = true; c.sfxRoll(); c.sfxSweep();
    check('craps: in turbo the rattle and the sweep stay silent', a2, []);
    c.close();
  }

  console.log('\n' + oks + ' checks ok');
  console.log('TOTAL FAILURES: ' + failures);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.log('CRASH', e && e.stack || e); process.exit(2); });
