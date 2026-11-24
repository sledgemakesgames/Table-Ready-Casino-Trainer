/* Landing page tests (jsdom). Run: node test_landing.js [path/to/index.html] */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, 'index.html');
const HTML = fs.readFileSync(FILE, 'utf8');
let failures = 0;
function check(name, actual, expected){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(!ok) failures++;
  console.log((ok ? 'OK: ' : 'FAIL: ') + name + (ok ? '' : '  (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')'));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function load(opts){
  opts = opts || {};
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: opts.url || 'https://tableready.xyz/',
    beforeParse(window){
      // jsdom has no matchMedia: give the page one whose answers each test can choose
      const answers = Object.assign({ 'prefers-reduced-motion': !!opts.reducedMotion, 'hover:hover': opts.hover !== false }, opts.media || {});
      window.matchMedia = q => {
        const key = Object.keys(answers).find(k => q.includes(k));
        return { matches: key ? !!answers[key] : false, media: q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} };
      };
      if(opts.blockStorage){
        const boom = () => { throw new window.Error('storage blocked'); };
        Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
        Object.defineProperty(window, 'sessionStorage', { get: boom, configurable: true });
      }
      if(opts.storage && !opts.blockStorage){
        Object.keys(opts.storage).forEach(k => { try{ window.localStorage.setItem(k, opts.storage[k]); }catch(e){} });
      }
    }
  });
  return dom.window;
}
const fire = (window, el, type, init) => {
  if(init){ const e = new window.Event(type, { bubbles: !!init.bubbles }); if('relatedTarget' in init) Object.defineProperty(e, 'relatedTarget', { value: init.relatedTarget }); return el.dispatchEvent(e); }
  return el.dispatchEvent(new window.MouseEvent(type, { bubbles: false }));
};
const GAMES = ['blackjack', 'baccarat', 'paigow', 'uth', 'craps'];
const paneOf = (w, g) => w.document.querySelector('.pane[data-game="' + g + '"]');
const panes = w => [...w.document.querySelectorAll('.pane')];
const onPanes = w => panes(w).filter(p => p.classList.contains('on')).map(p => p.dataset.game);

const SUITES = [];
function suite(name, fn){ SUITES.push({ name, fn }); }

const XP = 'house_edge_experience_v1', LEARNED = 'house_edge_learned_v1', SKIPPED = 'house_edge_xp_skipped_v1';
const BANK = 'house_edge_bankroll_v1', THEME = 'house_edge_theme_v1';
const PLAY = { blackjack:'/blackjack/', baccarat:'/baccarat/', paigow:'/pai-gow/', uth:'/ultimate-texas-holdem/', craps:'/craps/' };
const LEARN = g => '/learn/?from=floor#' + g;
const hrefs = w => GAMES.reduce((o, g) => (o[g] = paneOf(w, g).getAttribute('href'), o), {});
const overlay = w => w.document.getElementById('xp-overlay');
const storedLevel = w => { const r = w.localStorage.getItem(XP); return r ? JSON.parse(r).level : null; };
const learnedMap = w => JSON.parse(w.localStorage.getItem(LEARNED) || '{}');
const footLine = w => [w.document.getElementById('xp-status-text').textContent, w.document.getElementById('xp-change').textContent];
const LV = { 'new': "I'm brand new", rules: 'I know the rules', pro: 'I know the games' };
// click an anchor without letting jsdom attempt a real navigation; reports where it would have gone and whether it was held back
function clickLink(w, el){
  let prevented = false;
  const stop = e => { prevented = e.defaultPrevented; e.preventDefault(); };
  el.addEventListener('click', stop);
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  el.removeEventListener('click', stop);
  return el.getAttribute('href');
}
// a click that the page itself held back (first tap on a closed table)
function clickHeldBack(w, el){
  let held = false;
  const probe = e => { held = e.defaultPrevented; e.preventDefault(); };
  el.addEventListener('click', probe);
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  el.removeEventListener('click', probe);
  return held;
}
const key = (w, el, k, shift) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, shiftKey: !!shift, bubbles: true, cancelable: true }));

/* ===================== BANKROLL ===================== */
suite('BANKROLL: the pill shows the shared balance, formatted', async () => {
  let w = load({ storage: { [BANK]: JSON.stringify({ balance: 12345.6, lastUpdated: 'x' }) } });
  check('a saved balance is shown rounded, with a $ and thousands separators', w.document.getElementById('bankroll-amount').textContent, '$12,346');
  w.close();
  w = load({ storage: { [BANK]: JSON.stringify({ balance: 0 }) } });
  check('a zero balance is shown as $0 (not replaced by the default)', w.document.getElementById('bankroll-amount').textContent, '$0');
  w.close();
  w = load();
  check('first visit shows the $1,000 starting bankroll', w.document.getElementById('bankroll-amount').textContent, '$1,000');
  check('and saves it so every table starts from the same place', JSON.parse(w.localStorage.getItem(BANK)).balance, 1000);
  w.close();
  for(const raw of ['not json', '{"balance":"lots"}', '{"balance":null}', 'null', '[]']){
    const x = load({ storage: { [BANK]: raw } });
    check('unreadable saved value ' + raw + ' falls back to $1,000', x.document.getElementById('bankroll-amount').textContent, '$1,000');
    x.close();
  }
  w = load({ blockStorage: true });
  check('blocked storage still shows $1,000', w.document.getElementById('bankroll-amount').textContent, '$1,000');
  w.close();
});

/* ===================== FAMILIARITY DIALOG + ROUTING ===================== */
suite('XP DIALOG: a first-time visitor is asked right away, accessibly', async () => {
  const w = load();
  const d = w.document;
  check('a first-time visitor is asked the moment the page loads (no delay, nothing to click first)', overlay(w).hidden, false);
  await wait(50);
  const dlg = d.querySelector('#xp-overlay .xp-dialog');
  check('is a modal dialog with a label and description', [dlg.getAttribute('role'), dlg.getAttribute('aria-modal'), !!dlg.getAttribute('aria-labelledby'), !!dlg.getAttribute('aria-describedby')], ['dialog', 'true', true, true]);
  check('offers exactly the three levels, in order from no idea to knows the games', [...d.querySelectorAll('.xp-opt')].map(b => b.dataset.level), ['new', 'rules', 'pro']);
  check('keyboard focus lands inside the dialog on the first option', d.activeElement && d.activeElement.dataset.level, 'new');
  check('page behind cannot scroll while it is open', d.body.style.overflow, 'hidden');
  check('nothing is stored until they actually answer', [storedLevel(w), w.localStorage.getItem(LEARNED)], [null, null]);
  check('the footer line offers the question until they answer', footLine(w), ['', 'How well do you know these games?']);
  check('the hero has no level switch any more', [!!d.getElementById('level-seg'), !!d.querySelector('.seglab,.seghint,.ask')], [false, false]);
  w.close();
});

suite('XP DIALOG: a returning visitor who already answered is never asked again', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  await wait(1000);
  check('stays closed', overlay(w).hidden, true);
  check('the footer says their level and offers Change', footLine(w), ['Your level: ' + LV.rules, 'Change']);
  w.close();
});

suite('XP DIALOG: answering closes it for good, and the footer then shows the answer', async () => {
  const w = load();
  w.document.querySelector('.xp-opt[data-level="pro"]').click();
  await wait(1000);
  check('stays closed', overlay(w).hidden, true);
  check('the footer shows the answer', footLine(w), ['Your level: ' + LV.pro, 'Change']);
  w.close();
});

suite('ROUTING: "brand new" sends each game to its lesson first (and says so)', async () => {
  const w = load();
  const d = w.document;
  await wait(900);
  d.querySelector('.xp-opt[data-level="new"]').click();
  check('answer is stored', storedLevel(w), 'new');
  check('dialog closes and the page scrolls again', [overlay(w).hidden, d.body.style.overflow], [true, '']);
  check('every table now points at that game\'s lesson', hrefs(w), { blackjack: LEARN('blackjack'), baccarat: LEARN('baccarat'), paigow: LEARN('paigow'), uth: LEARN('uth'), craps: LEARN('craps') });
  GAMES.forEach(g => {
    const p = paneOf(w, g);
    check(g + ': marked learn-first and says "Learn the basics"', [p.classList.contains('learn-first'), p.querySelector('.enter-label').textContent], [true, 'Learn the basics']);
    check(g + ': screen-reader label tells the truth about where it goes', /^Learn how to play /.test(p.getAttribute('aria-label')), true);
  });
  check('hero button also routes Blackjack to its lesson, with honest text', [d.getElementById('rv-cta').getAttribute('href'), d.getElementById('cta-label').textContent], [LEARN('blackjack'), 'Learn Blackjack first']);
  check('the footer line reflects the answer', footLine(w), ['Your level: ' + LV['new'], 'Change']);
  w.close();
});

suite('ROUTING: "I know the rules" and "I know the games" go straight to the tables', async () => {
  for(const level of ['rules', 'pro']){
    const w = load();
    await wait(900);
    w.document.querySelector('.xp-opt[data-level="' + level + '"]').click();
    check(level + ': answer stored', storedLevel(w), level);
    check(level + ': every table still goes straight to its game', hrefs(w), PLAY);
    check(level + ': nothing is marked learn-first', GAMES.some(g => paneOf(w, g).classList.contains('learn-first')), false);
    check(level + ': hero button unchanged', [w.document.getElementById('rv-cta').getAttribute('href'), w.document.getElementById('cta-label').textContent], ['/blackjack/', 'Sit down at Blackjack']);
    check(level + ': labels read "Sit down"', GAMES.map(g => paneOf(w, g).querySelector('.enter-label').textContent), GAMES.map(() => 'Sit down'));
    w.close();
  }
});

suite('ROUTING: each game\'s lesson is offered once, then it goes to the table', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'new' }) } });
  await wait(300);
  fire(w, paneOf(w, 'baccarat'), 'mouseenter');   // a mouse is over it, so a click goes in
  check('first click on Baccarat goes to its lesson', clickLink(w, paneOf(w, 'baccarat')), LEARN('baccarat'));
  check('and only Baccarat is marked as offered', learnedMap(w), { baccarat: true });
  check('other games are untouched (still lesson-first)', [hrefs(w).blackjack, hrefs(w).paigow, hrefs(w).uth, hrefs(w).craps], [LEARN('blackjack'), LEARN('paigow'), LEARN('uth'), LEARN('craps')]);
  w.dispatchEvent(new w.Event('pageshow'));   // what happens when they come back with the back button
  check('coming back, Baccarat now goes straight to the table', hrefs(w).baccarat, PLAY.baccarat);
  check('and its label reverts to "Sit down"', [paneOf(w, 'baccarat').classList.contains('learn-first'), paneOf(w, 'baccarat').querySelector('.enter-label').textContent], [false, 'Sit down']);
  check('second click on Baccarat goes to the table', clickLink(w, paneOf(w, 'baccarat')), PLAY.baccarat);
  fire(w, paneOf(w, 'blackjack'), 'mouseenter');
  check('Blackjack still goes to its lesson the first time', clickLink(w, paneOf(w, 'blackjack')), LEARN('blackjack'));
  check('now two games are offered, two are not', learnedMap(w), { baccarat: true, blackjack: true });
  w.close();
});

suite('ROUTING: a first tap that only opens a table does NOT use up its lesson', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'new' }) }, hover: false });
  await wait(300);
  const pg = paneOf(w, 'paigow');
  check('first tap is held back by the page (it just opens the table)', clickHeldBack(w, pg), true);
  check('the table is open and nothing was marked offered', [onPanes(w), w.localStorage.getItem(LEARNED)], [['paigow'], null]);
  check('second tap goes to the lesson', clickLink(w, pg), LEARN('paigow'));
  check('and now it is marked offered', learnedMap(w), { paigow: true });
  w.close();
});

suite('ROUTING: the hero button counts for Blackjack too', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'new' }) } });
  await wait(300);
  check('hero click goes to the Blackjack lesson', clickLink(w, w.document.getElementById('rv-cta')), LEARN('blackjack'));
  check('and marks Blackjack as offered', learnedMap(w), { blackjack: true });
  w.dispatchEvent(new w.Event('pageshow'));
  check('hero button then goes to the table', [w.document.getElementById('rv-cta').getAttribute('href'), w.document.getElementById('cta-label').textContent], ['/blackjack/', 'Sit down at Blackjack']);
  w.close();
});

suite('ROUTING: a stale link is corrected at click time (answer changed in another tab)', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'new' }) } });
  await wait(300);
  const uth = paneOf(w, 'uth');
  fire(w, uth, 'mouseenter');
  check('link currently points at the lesson', uth.getAttribute('href'), LEARN('uth'));
  w.localStorage.setItem(LEARNED, JSON.stringify({ uth: true }));   // another tab already offered it
  check('click uses the up-to-date answer and goes to the table', clickLink(w, uth), PLAY.uth);
  w.localStorage.setItem(XP, JSON.stringify({ level: 'pro' }));     // answer changed elsewhere
  const bj = paneOf(w, 'blackjack');
  fire(w, bj, 'mouseenter');
  check('a changed answer also wins at click time', clickLink(w, bj), PLAY.blackjack);
  check('and a game is not marked offered when it went to the table', learnedMap(w).blackjack, undefined);
  w.close();
});

suite('FOOTER: "Change" reopens the question at any time', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  const d = w.document;
  await wait(300);
  check('the footer line is in the footer, and Change is a real button', [!!d.querySelector('footer #xp-status-line'), d.getElementById('xp-change').tagName, d.getElementById('xp-change').getAttribute('type')], [true, 'BUTTON', 'button']);
  check('the dialog is closed while they browse', overlay(w).hidden, true);
  d.getElementById('xp-change').click();
  check('Change opens the dialog with their current answer marked', [overlay(w).hidden, [...d.querySelectorAll('.xp-opt.selected')].map(b => b.dataset.level)], [false, ['rules']]);
  check('and the skip button now says Cancel (there is an answer to keep)', d.getElementById('xp-skip').textContent, 'Cancel');
  d.getElementById('xp-skip').click();
  check('Cancel leaves the answer exactly as it was', [overlay(w).hidden, storedLevel(w), footLine(w)], [true, 'rules', ['Your level: ' + LV.rules, 'Change']]);
  d.getElementById('xp-change').click();
  d.querySelector('.xp-opt[data-level="new"]').click();
  check('choosing "brand new" stores it and re-routes at once', [storedLevel(w), hrefs(w).paigow, footLine(w)], ['new', LEARN('paigow'), ['Your level: ' + LV['new'], 'Change']]);
  d.getElementById('xp-change').click();
  d.querySelector('.xp-opt[data-level="pro"]').click();
  check('choosing "I know the games" sends everything back to the tables', [storedLevel(w), hrefs(w), footLine(w)], ['pro', PLAY, ['Your level: ' + LV.pro, 'Change']]);
  check('Escape while changing also leaves the answer alone', (() => { d.getElementById('xp-change').click(); key(w, d.querySelector('#xp-overlay'), 'Escape'); return [overlay(w).hidden, storedLevel(w)]; })(), [true, 'pro']);
  w.close();
});

suite('XP DIALOG: skipping and Escape', async () => {
  const w = load();
  const d = w.document;
  await wait(900);
  d.getElementById('xp-skip').click();
  check('skip closes it', overlay(w).hidden, true);
  check('skipping stores no answer', storedLevel(w), null);
  check('skipping remembers it for this visit only (session, not forever)', [w.sessionStorage.getItem(SKIPPED), w.localStorage.getItem(SKIPPED)], ['1', null]);
  check('with no answer, every table goes straight to its game', hrefs(w), PLAY);
  check('and the footer still offers the question, so they can answer from the page', footLine(w), ['', 'How well do you know these games?']);
  check('with an answer to give, the skip button says Skip for now', d.getElementById('xp-skip').textContent, 'Skip for now');
  w.maybeAskExperience();
  await wait(900);
  check('it does not pop up again in the same visit', overlay(w).hidden, true);
  w.openExperienceDialog();
  check('Escape closes it and counts as skipping', (key(w, d.activeElement, 'Escape'), overlay(w).hidden), true);
  d.getElementById('xp-change').click();
  check('the footer question reopens it after a skip', overlay(w).hidden, false);
  d.querySelector('.xp-opt[data-level="new"]').click();
  check('answering later from the footer works and applies immediately', [storedLevel(w), hrefs(w).paigow, footLine(w)], ['new', LEARN('paigow'), ['Your level: ' + LV['new'], 'Change']]);
  w.close();
});

suite('XP DIALOG: a later visit asks again if they only skipped before', async () => {
  const w = load();   // fresh window = fresh session storage, nothing stored
  await wait(900);
  check('skip in session A leaves no permanent trace, so a new visit asks again', overlay(w).hidden, false);
  w.close();
});

suite('XP DIALOG: Escape never erases an existing answer', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'new' }) } });
  const d = w.document;
  await wait(300);
  w.openExperienceDialog();
  check('reopening shows the current answer as selected and focuses it', [[...d.querySelectorAll('.xp-opt.selected')].map(b => b.dataset.level), d.activeElement.dataset.level], [['new'], 'new']);
  key(w, d.activeElement, 'Escape');
  check('Escape keeps their existing answer', storedLevel(w), 'new');
  check('and does not mark this visit as skipped', w.sessionStorage.getItem(SKIPPED), null);
  w.close();
});

suite('XP DIALOG: keyboard focus stays trapped inside while open', async () => {
  const w = load();
  const d = w.document;
  await wait(900);
  const opts = [...d.querySelectorAll('.xp-opt')];
  opts[0].focus();
  key(w, opts[0], 'Tab', true);
  check('Shift+Tab from the first option wraps to the last control (Skip)', d.activeElement.id, 'xp-skip');
  key(w, d.activeElement, 'Tab', false);
  check('Tab from Skip wraps to the first option', d.activeElement.dataset.level, 'new');
  w.close();
});

suite('STORAGE: corrupted or hostile saved values are ignored, never trusted', async () => {
  const bad = ['not json at all', '{"level":"constructor"}', '{"level":"__proto__"}', '{"level":"toString"}', '{"level":null}', '{"level":42}', '[]', '"new"', 'null'];
  for(const raw of bad){
    const w = load({ storage: { [XP]: raw } });
    await wait(900);
    check('experience value ' + raw + ' is treated as unanswered (asks again)', overlay(w).hidden, false);
    check('  ...routing stays safe (all straight to tables) and nothing looks chosen', [hrefs(w), footLine(w)], [PLAY, ['', 'How well do you know these games?']]);
    w.close();
  }
  for(const raw of ['garbage', '[]', '"x"', 'null', '42']){
    const w = load({ storage: { [XP]: JSON.stringify({ level: 'new' }), [LEARNED]: raw } });
    await wait(300);
    check('learned-games value ' + raw + ' is treated as empty (lessons still offered)', hrefs(w), { blackjack: LEARN('blackjack'), baccarat: LEARN('baccarat'), paigow: LEARN('paigow'), uth: LEARN('uth'), craps: LEARN('craps') });
    w.close();
  }
});

suite('STORAGE: fully blocked storage (private window) still works for this visit', async () => {
  const w = load({ blockStorage: true });
  const d = w.document;
  await wait(900);
  check('page still loads and dialog still opens', overlay(w).hidden, false);
  d.querySelector('.xp-opt[data-level="new"]').click();
  check('answer applies for this visit even though it cannot be saved', hrefs(w).blackjack, LEARN('blackjack'));
  fire(w, paneOf(w, 'blackjack'), 'mouseenter');
  clickLink(w, paneOf(w, 'blackjack'));
  w.dispatchEvent(new w.Event('pageshow'));
  check('and the once-per-game rule still works in memory', hrefs(w).blackjack, PLAY.blackjack);
  check('the theme buttons do not throw either', (() => { try{ d.querySelector('.themes button[data-th="midnight"]').click(); return d.documentElement.getAttribute('data-theme'); }catch(e){ return 'threw'; } })(), 'midnight');
  w.close();
});

/* ===================== THE STAGE ===================== */
suite('STAGE: five tables, all closed until one is hovered, focused or tapped, and never more than one open', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  await wait(200);
  const stage = w.document.getElementById('stage'), rest = () => stage.classList.contains('rest');
  const aria = () => panes(w).map(p => p.getAttribute('aria-current'));
  check('five tables in the right order', panes(w).map(p => p.dataset.game), GAMES);
  check('all five rest closed when the page loads', [onPanes(w), rest()], [[], true]);
  check('and none claims to be the current one for assistive tech', aria(), ['false', 'false', 'false', 'false', 'false']);
  for(const g of ['craps', 'baccarat', 'uth', 'paigow', 'blackjack']){
    fire(w, paneOf(w, g), 'mouseenter');
    check('hovering ' + g + ' opens it and closes the rest', [onPanes(w), rest()], [[g], false]);
    check('...and only it says so for assistive tech', aria(), GAMES.map(x => x === g ? 'true' : 'false'));
  }
  for(const g of ['uth', 'craps']){
    paneOf(w, g).focus();
    check('keyboard focus on ' + g + ' opens it', onPanes(w), [g]);
  }
  fire(w, stage, 'focusout', { bubbles: true, relatedTarget: paneOf(w, 'baccarat') });
  check('focus moving to another table keeps one open (the next focus opens that one)', onPanes(w).length, 1);
  fire(w, stage, 'focusout', { bubbles: true, relatedTarget: null });
  check('focus leaving the stage closes everything again', [onPanes(w), rest(), aria()], [[], true, ['false', 'false', 'false', 'false', 'false']]);
  fire(w, paneOf(w, 'uth'), 'mouseenter');
  fire(w, stage, 'mouseleave');
  check('moving the mouse off the stage closes the table: the row goes back to five equal cards', [onPanes(w), rest(), aria()], [[], true, ['false', 'false', 'false', 'false', 'false']]);
  fire(w, paneOf(w, 'craps'), 'mouseenter');
  fire(w, w.document.body, 'pointerdown', { bubbles: true });
  check('pressing anywhere outside the stage closes it too', [onPanes(w), rest()], [[], true]);
  fire(w, paneOf(w, 'craps'), 'mouseenter');
  fire(w, paneOf(w, 'baccarat'), 'pointerdown', { bubbles: true });
  check('pressing inside the stage does not close it', onPanes(w), ['craps']);
  w.close();
});

suite('STAGE: on a touch screen the first tap opens, the second goes in, and a stray mouseleave does not close it', async () => {
  const w = load({ hover: false, storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  await wait(200);
  const stage = w.document.getElementById('stage');
  fire(w, paneOf(w, 'baccarat'), 'mouseenter');
  check('a stray mouseenter from a tap does not open anything on its own (the click does)', onPanes(w), []);
  // a finger tap focuses the link before it clicks it: that focus must not count as "already open"
  paneOf(w, 'paigow').dispatchEvent(new w.Event('pointerdown', { bubbles: true })); paneOf(w, 'paigow').dispatchEvent(new w.Event('focus'));
  check('the focus that comes with a tap does not open the table by itself', onPanes(w), []);
  check('first tap on Baccarat is held back', clickHeldBack(w, paneOf(w, 'baccarat')), true);
  check('and opens it', onPanes(w), ['baccarat']);
  fire(w, stage, 'mouseleave');
  check('the compatibility mouseleave a phone sends after a tap leaves the table open', onPanes(w), ['baccarat']);
  check('second tap goes to the table', clickLink(w, paneOf(w, 'baccarat')), '/baccarat/');
  check('tapping another table: the first tap opens it, the second goes in', (clickHeldBack(w, paneOf(w, 'blackjack')), onPanes(w).join() + ' ' + clickLink(w, paneOf(w, 'blackjack'))), 'blackjack /blackjack/');
  fire(w, w.document.body, 'pointerdown', { bubbles: true });
  check('tapping outside the stage closes it', onPanes(w), []);
  w.close();
});

suite('STAGE: every table is a real link that works without JavaScript', async () => {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  const d = dom.window.document;
  const ps = [...d.querySelectorAll('.pane')];
  check('five links to the five games', ps.map(p => p.getAttribute('href')), GAMES.map(g => PLAY[g]));
  check('no table is open in the markup: five equal cards, each a working link, nothing is hidden from visitors without scripting', [ps.map(p => p.classList.contains('on')), d.getElementById('stage').classList.contains('rest')], [[false, false, false, false, false], true]);
  check('each has an accessible name and the one-line description', ps.every(p => /^Play /.test(p.getAttribute('aria-label')) && d.getElementById(p.getAttribute('aria-describedby')).textContent.length > 20), true);
  check('hero button points at Blackjack', d.getElementById('rv-cta').getAttribute('href'), '/blackjack/');
  check('the footer question is hidden when scripting is off (the button would do nothing)', /@media \(scripting:none\)\{\.xp-line\{display:none\}\}/.test(HTML), true);
  dom.window.close();
});

suite('DEAL: each table opening deals a fresh hand; hands never repeat a card; dice show real faces', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  await wait(200);
  const faces = p => [...p.querySelectorAll('[data-up]')].map(g => g.querySelector('.rk').textContent + g.querySelector('.su').textContent);
  const counts = { blackjack: 3, baccarat: 4, paigow: 7, uth: 5, craps: 0 };
  for(const g of GAMES){
    const p = paneOf(w, g);
    check(g + ': has the right number of face-up cards and dice', [p.querySelectorAll('[data-up]').length, p.querySelectorAll('[data-die]').length], [counts[g], g === 'craps' ? 2 : 0]);
  }
  // no card twice in one hand, over many deals
  let dupes = 0, valid = 0, total = 0;
  const RK = new Set(['A','2','3','4','5','6','7','8','9','10','J','Q','K']), SU = new Set(['♠','♣','♥','♦']);
  for(let n = 0; n < 60; n++){
    for(const g of ['paigow', 'uth', 'baccarat', 'blackjack']){
      fire(w, paneOf(w, 'craps'), 'mouseenter'); fire(w, paneOf(w, g), 'mouseenter');
      const f = faces(paneOf(w, g)); total += f.length;
      if(new Set(f).size !== f.length) dupes++;
      f.forEach(x => { if(RK.has(x.slice(0, -1)) && SU.has(x.slice(-1))) valid++; });
    }
  }
  check('over 240 deals no hand ever shows the same card twice', dupes, 0);
  check('every dealt face is a real rank and suit', valid, total);
  fire(w, paneOf(w, 'blackjack'), 'mouseenter'); const before = faces(paneOf(w, 'blackjack')).join();
  let changed = false;
  for(let n = 0; n < 12 && !changed; n++){ fire(w, paneOf(w, 'craps'), 'mouseenter'); fire(w, paneOf(w, 'blackjack'), 'mouseenter'); changed = faces(paneOf(w, 'blackjack')).join() !== before; }
  check('and reopening a table deals a different hand', changed, true);
  // suit colours: red suits red, black suits black
  const colours = [...paneOf(w, 'paigow').querySelectorAll('[data-up]')].every(g => { const su = g.querySelector('.su').textContent, f = g.querySelector('.su').getAttribute('fill'); return (su === '♥' || su === '♦') ? f === '#C23B30' : f === '#17231D'; });
  check('red suits are drawn red and black suits black', colours, true);
  // dice
  fire(w, paneOf(w, 'craps'), 'mouseenter');
  await wait(1000);
  const pips = g => g.querySelectorAll('.pp circle').length;
  const dice = [...paneOf(w, 'craps').querySelectorAll('[data-die]')];
  check('after the throw each die shows 1 to 6, and the dots drawn match the number', dice.map(g => { const v = +g.getAttribute('data-die'); return v >= 1 && v <= 6 && pips(g) === v; }), [true, true]);
  const seen = new Set();
  for(let n = 0; n < 80; n++){ fire(w, paneOf(w, 'blackjack'), 'mouseenter'); fire(w, paneOf(w, 'craps'), 'mouseenter'); dice.forEach(g => seen.add(g.getAttribute('data-die'))); await wait(2); }
  check('over many throws every face from 1 to 6 comes up', [...seen].sort(), ['1', '2', '3', '4', '5', '6']);
  w.close();
});

suite('DEAL: leaving mid-throw never leaves dice changing faces afterwards', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  await wait(200);
  const craps = paneOf(w, 'craps');
  const snap = () => [...craps.querySelectorAll('[data-die]')].map(g => g.getAttribute('data-die')).join('');
  const bad = [];
  for(let leaveAfter = 0; leaveAfter <= 700; leaveAfter += 35){
    fire(w, craps, 'mouseenter');
    await wait(leaveAfter);
    fire(w, paneOf(w, 'blackjack'), 'mouseenter');
    const a = snap(); await wait(700); const b = snap();
    if(a !== b) bad.push(leaveAfter);
  }
  check('no leave-time between 0 and 700 ms leaves the dice still rolling', bad, []);
  w.close();
});

suite('DEAL: with reduced motion the dice land at once', async () => {
  const w = load({ reducedMotion: true, storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  await wait(200);
  fire(w, paneOf(w, 'craps'), 'mouseenter');
  const a = [...paneOf(w, 'craps').querySelectorAll('[data-die]')].map(g => g.getAttribute('data-die')).join('');
  await wait(700);
  const b = [...paneOf(w, 'craps').querySelectorAll('[data-die]')].map(g => g.getAttribute('data-die')).join('');
  check('faces do not change after the first instant', a, b);
  check('the deal and throw animations are switched off', /prefers-reduced-motion:reduce\)\{.*\.dl\{animation:none !important\}/.test(HTML), true);
  w.close();
});

/* ===================== THEMES ===================== */
suite('THEME: Graphite by default, the four table themes switch live and are remembered', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  const d = w.document, root = d.documentElement;
  const btns = [...d.querySelectorAll('.themes button')];
  check('four theme buttons, Graphite first (it is the default)', btns.map(b => b.dataset.th), ['graphite', 'emerald', 'midnight', 'crimson']);
  check('without any script the page already paints in Graphite (the base colours are Graphite\'s)', [/:root\{--felt:#0C0D10;--felt-dark:#08090B;--panel:#15171B;/.test(HTML), /:root\{--felt:#0F3D36/.test(HTML)], [true, false]);
  check('Graphite is pressed by default and the page is using its colours', [btns.map(b => b.getAttribute('aria-pressed')), root.getAttribute('data-theme'), root.style.getPropertyValue('--felt-dark')], [['true', 'false', 'false', 'false'], 'graphite', '#08090B']);
  check('looking at the page does not store a theme (only a choice does)', w.localStorage.getItem(THEME), null);
  btns[3].click();
  check('choosing Crimson sets the colours, marks it pressed and stores the choice', [root.style.getPropertyValue('--felt'), root.style.getPropertyValue('--brass'), btns.map(b => b.getAttribute('aria-pressed')), w.localStorage.getItem(THEME), root.getAttribute('data-theme')], ['#1A0E10', '#D6935A', ['false', 'false', 'false', 'true'], 'crimson', 'crimson']);
  btns[1].click();
  check('choosing Emerald Felt gives its colours', [root.style.getPropertyValue('--felt'), root.style.getPropertyValue('--brass'), w.localStorage.getItem(THEME)], ['#0F3D36', '#C9A24B', 'emerald']);
  btns[0].click();
  check('going back to Graphite restores its colours', [root.style.getPropertyValue('--felt'), root.style.getPropertyValue('--brass'), w.localStorage.getItem(THEME)], ['#0C0D10', '#D6A94B', 'graphite']);
  w.close();
  const w2 = load({ storage: { [THEME]: 'midnight', [XP]: JSON.stringify({ level: 'rules' }) } });
  check('a saved theme is applied before the page is shown (from the head script)', [w2.document.documentElement.getAttribute('data-theme'), w2.document.documentElement.style.getPropertyValue('--brass')], ['midnight', '#4FB8E0']);
  check('and its button is the pressed one', [...w2.document.querySelectorAll('.themes button')].map(b => b.getAttribute('aria-pressed')), ['false', 'false', 'true', 'false']);
  w2.close();
  const w2e = load({ storage: { [THEME]: 'emerald', [XP]: JSON.stringify({ level: 'rules' }) } });
  check('someone who chose Emerald Felt keeps it', [w2e.document.documentElement.getAttribute('data-theme'), w2e.document.documentElement.style.getPropertyValue('--felt'), [...w2e.document.querySelectorAll('.themes button')].map(b => b.getAttribute('aria-pressed')).join()], ['emerald', '#0F3D36', 'false,true,false,false']);
  w2e.close();
  for(const bad of ['nope', '__proto__', 'constructor', '']){
    const w3 = load({ storage: { [THEME]: bad } });
    check('an unknown saved theme "' + bad + '" is ignored (stays Graphite)', [w3.document.documentElement.getAttribute('data-theme'), [...w3.document.querySelectorAll('.themes button')].map(b => b.getAttribute('aria-pressed')).join(), w3.document.documentElement.style.getPropertyValue('--felt')], ['graphite', 'true,false,false,false', '#0C0D10']);
    w3.close();
  }
});

suite('THEME: every theme has a complete, readable colour set', async () => {
  const w = load();
  const TH = w.TR_TH;
  const need = ['felt', 'felt-dark', 'panel', 'panel-2', 'brass', 'brass-bright', 'text', 'muted', 'line', 'card', 'ink'];
  check('four themes, each defining every colour the page uses', Object.keys(TH).map(k => need.every(n => !!TH[k][n])), [true, true, true, true]);
  const lum = c => { const m = c.replace('#', ''); const v = [0, 2, 4].map(i => parseInt(m.substr(i, 2), 16) / 255).map(x => x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4)); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + .05) / (Math.min(A, B) + .05); };
  const rows = [];
  Object.keys(TH).forEach(k => {
    const t = TH[k];
    [['text', 'felt-dark'], ['text', 'panel'], ['muted', 'felt-dark'], ['muted', 'panel'], ['muted', 'panel-2'], ['brass-bright', 'felt-dark'], ['brass-bright', 'panel']].forEach(([f, b]) => { if(ratio(t[f], t[b]) < 4.5) rows.push(k + ' ' + f + ' on ' + b + ' = ' + ratio(t[f], t[b]).toFixed(2)); });
    if(ratio('#1B1608', t.brass) < 4.5) rows.push(k + ' button text on brass');
  });
  check('all text/background pairs the page uses reach 4.5:1 in all four themes', rows, []);
  w.close();
});

/* ===================== PANES + COIN ===================== */
suite('PANES: each one is its game\'s table with just the game\'s name over it', async () => {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  const d = dom.window.document, ps = [...d.querySelectorAll('.pane')];
  const NAMES = ['Blackjack', 'Baccarat', 'Pai Gow Poker', 'Ultimate Texas Hold\u2019em', 'Craps'];
  check('the name is the visible text of each pane, in order', ps.map(p => p.querySelector('.nm').textContent), NAMES);
  check('the sideways name on a closed pane is the same name (and hidden from screen readers)', ps.map(p => [p.querySelector('.vname').textContent, p.querySelector('.vname').getAttribute('aria-hidden')]), NAMES.map(n => [n, 'true']));
  // everything a sighted visitor can read: leave out the screen-reader-only parts and the arrow
  const visible = p => { const c = p.cloneNode(true); c.querySelectorAll('.sr,.go,svg').forEach(e => e.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  check('nothing else is written on a pane: no number, no Cards/Dice label, no description, no "You decide" line', ps.map(p => /^(\S.*?) \1$/.test(visible(p)) || visible(p) === p.querySelector('.nm').textContent + ' ' + p.querySelector('.nm').textContent), [true, true, true, true, true]);
  check('there is no tag, no chip, no blurb line and no decide line left in the markup', [d.querySelectorAll('.tag,.emb,.decide,.beam').length, /You decide|0[1-5] &nbsp;|>Cards<|>Dice</.test(HTML.slice(HTML.indexOf('<nav class="stage"'), HTML.indexOf('</nav>', HTML.indexOf('<nav class="stage"'))))], [0, false]);
  check('the one-line description is still there for screen readers only', ps.map(p => { const b = d.getElementById(p.getAttribute('aria-describedby')); return [b.classList.contains('sr'), b.textContent.length > 20]; }), ps.map(() => [true, true]));
  check('each pane carries its own table drawing, with a real label', ps.map(p => { const sv = p.querySelector('.board svg.tbl'); return !!sv && /table|layout/i.test(sv.getAttribute('aria-label')); }), ps.map(() => true));
  check('the five drawings are all different', new Set(ps.map(p => p.querySelector('.board svg').getAttribute('aria-label'))).size, 5);
  check('the arrow keeps its words for screen readers, and the arrow itself is decoration', ps.map(p => [p.querySelector('.go .enter-label').classList.contains('sr'), p.querySelector('.go b').getAttribute('aria-hidden')]), ps.map(() => [true, 'true']));
  check('the stage sits in a size container, so the panes scale with the page rather than the window', [!!d.querySelector('.stagebox > nav.stage#stage'), /\.stagebox\{container-type:inline-size\}/.test(HTML)], [true, true]);
  // the pane is a window onto a table that keeps one size; the stage is much shorter than before (it used to be 620-700px)
  check('the stage is short (it was 620-700px tall), and never taller than 440px', [/\.stage\{[^}]*height:clamp\(280px,calc\(var\(--ow\) \* \.6\),440px\)/.test(HTML), /clamp\(620px,72vh,700px\)/.test(HTML)], [true, false]);
  dom.window.close();
});

suite('PANES: every game has its own colour and its own picture, so the five are easy to tell apart', async () => {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  const d = dom.window.document, ps = [...d.querySelectorAll('.pane')];
  const cols = ps.map(p => ((p.getAttribute('style') || '').match(/--c:\s*(var\(--chip\w+\))/) || [])[1]);
  check('each pane carries a colour of its own, one of the table chip colours (so it follows the theme)', cols.every(Boolean), true);
  check('the five colours are all different', new Set(cols.map(c => (c || '').toLowerCase())).size, 5);
  check('each pane has exactly one picture, decoration only, holding one drawing', ps.map(p => { const i = p.querySelectorAll('.icon'); return [i.length, i[0] && i[0].getAttribute('aria-hidden'), i[0] && i[0].querySelectorAll('svg').length]; }), ps.map(() => [1, 'true', 1]));
  check('the five pictures are all different', new Set(ps.map(p => p.querySelector('.icon').innerHTML)).size, 5);
  check('a picture has no title, description or id of its own (no clash with the table drawings, nothing for a screen reader)', ps.map(p => p.querySelector('.icon').querySelectorAll('title,desc,[id]').length), [0, 0, 0, 0, 0]);
  check('the picture of a card game is made of cards, the one for Craps of dice', ps.map(p => { const i = p.querySelector('.icon').innerHTML; return /rect/.test(i); }), [true, true, true, true, true]);
  // the look itself (jsdom ignores specificity, so only the rules are checked here; qa_live.js looks at the real thing)
  const css = [...d.querySelectorAll('style')].map(x => x.textContent).join('\n');
  check('a closed pane is a solid strip of its own colour; its table appears when it opens', [/\.pane::before\{[^}]*background:linear-gradient\([^}]*var\(--c\)/.test(css), /\.board\{opacity:0;filter:none\}/.test(css), /\.pane\.on \.board\{opacity:1\}/.test(css)], [true, true, true]);
  check('the picture fades out as a pane opens', [/\.pane\.on \.icon\{opacity:0;/.test(css), /\.icon\{[^}]*pointer-events:none/.test(css)], [true, true]);
  check('the name wraps on a desktop only when it would run into the picture, and stays one line on a phone', [/\.vname\{[^}]*white-space:normal;max-height:calc\(/.test(css), /@media \(min-width:761px\)/.test(css)], [true, true]);
  dom.window.close();
});

suite('PANES: opening a pane still deals its hand, and the closed ones keep their table', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  await wait(200);
  check('every pane has its cards or dice drawn whether it is open or not', panes(w).map(p => p.querySelectorAll('[data-up],[data-die]').length > 0), [true, true, true, true, true]);
  fire(w, paneOf(w, 'craps'), 'mouseenter');
  check('hovering Craps opens it and its name is the visible one', [onPanes(w), paneOf(w, 'craps').querySelector('.nm').textContent], [['craps'], 'Craps']);
  check('the dice on it show real faces', [...paneOf(w, 'craps').querySelectorAll('[data-die]')].every(g => /^[1-6]$/.test(g.getAttribute('data-die'))), true);
  w.close();
});

suite('COIN: the brand coin in the header flips when it is clicked', async () => {
  const r = Math.random;
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  const d = w.document, coin = d.getElementById('brand-coin'), inner = coin.querySelector('.coin-in'), suit = coin.querySelector('.suit');
  check('it is a real button with a name, not part of the home link', [coin.tagName, coin.getAttribute('type'), coin.getAttribute('aria-label'), !!coin.closest('a')], ['BUTTON', 'button', 'Flip the coin. Hold it to let the coin pick a game', false]);
  check('the brand name next to it is still the link home', [d.querySelector('a.brand').getAttribute('href'), d.querySelector('a.brand').textContent, coin.nextElementSibling === d.querySelector('a.brand')], ['/', 'Table Ready', true]);
  check('it has two faces (decoration only) and a suit on the back', [coin.querySelectorAll('.mark').length, [...coin.querySelectorAll('.mark')].every(m => m.getAttribute('aria-hidden') === 'true'), coin.querySelector('.mark.back .suit') !== null], [2, true, true]);
  check('before any click it shows the front', [inner.style.transform, coin.getAttribute('data-side')], ['', null]);
  w.Math.random = () => 0.9;
  coin.click();
  check('one click turns it over (180deg) and puts a suit on the back', [inner.style.transform, coin.getAttribute('data-side'), suit.textContent], ['rotateY(180deg)', 'back', '♣']);
  check('it hops as it turns', coin.querySelector('.coin-hop').classList.contains('hop'), true);
  coin.click(); coin.click();
  w.Math.random = () => 0.3;
  check('it always turns the same way: three clicks is 540deg, landing on the back again', [inner.style.transform, coin.getAttribute('data-side')], ['rotateY(540deg)', 'back']);
  coin.click(); coin.click();
  check('five clicks: 900deg, and the suit is re-picked each time it turns to the back', [inner.style.transform, ['♠', '♥', '♦', '♣'].includes(suit.textContent)], ['rotateY(900deg)', true]);
  // start again from the front (the count above ended on the back): every turn to the back picks from the four suits
  if(coin.getAttribute('data-side') === 'back') coin.click();
  const picks = [0, 0.3, 0.6, 0.9].map(rv => { w.Math.random = () => rv; coin.click(); const sx = suit.textContent; coin.click(); return sx; });
  check('all four suits can come up on the back', picks, ['\u2660', '\u2665', '\u2666', '\u2663']);
  check('flipping the coin does not change the page or the saved theme', [w.location.pathname, w.localStorage.getItem(THEME)], ['/', null]);
  w.close();
  const w2 = load({ reducedMotion: true, storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  const c2 = w2.document.getElementById('brand-coin'); c2.click();
  check('with reduced motion it still flips, but does not hop', [c2.querySelector('.coin-in').style.transform, c2.querySelector('.coin-hop').classList.contains('hop')], ['rotateY(180deg)', false]);
  check('and the css switches its transitions off for reduced motion', /prefers-reduced-motion:reduce\)\{\.coin-in,\.coin-hop\{transition:none!important\}/.test(HTML), true);
  w2.close();
});

/* ===================== THE COIN PICKS A GAME; SOUND ON THE LANDING PAGE ===================== */
const mouse = (w, type, o) => new w.MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0 }, o || {}));
const keyEv = (w, type, k, o) => new w.KeyboardEvent(type, Object.assign({ key: k, bubbles: true, cancelable: true }, o || {}));
const ready = (opts) => load(Object.assign({ storage: { [XP]: JSON.stringify({ level: 'rules' }), house_edge_cointip_v1: '1' } }, opts || {}));
const pickText = w => w.document.getElementById('pick-live').textContent;
const GAME_NAMES = { blackjack: 'Blackjack', baccarat: 'Baccarat', paigow: 'Pai Gow Poker', uth: 'Ultimate Texas Hold’em', craps: 'Craps' };
suite('COIN PICK: a short press still flips, and nothing else happens', async () => {
  const w = ready(), d = w.document, coin = d.getElementById('brand-coin');
  coin.dispatchEvent(mouse(w, 'pointerdown'));
  check('pressing charges the coin', coin.classList.contains('charging'), true);
  coin.dispatchEvent(mouse(w, 'pointerup')); coin.click();
  check('letting go early stops the charge, flips the coin and picks nothing', [coin.classList.contains('charging'), coin.getAttribute('data-side'), w.TR_COIN_PICK.busy(), onPanes(w)], [false, 'back', false, []]);
  await wait(800);
  check('and nothing is picked afterwards either', [w.TR_COIN_PICK.busy(), onPanes(w), pickText(w)], [false, [], '']);
  w.close();
});
suite('COIN PICK: holding the coin picks one table, opens it and says which', async () => {
  const w = ready(), d = w.document, coin = d.getElementById('brand-coin');
  coin.dispatchEvent(mouse(w, 'pointerdown'));
  await wait(300);
  check('still charging before the hold is long enough', [coin.classList.contains('charging'), w.TR_COIN_PICK.busy()], [true, false]);
  await wait(420);
  check('held long enough: the charge is done and the pick is under way', [coin.classList.contains('charging'), w.TR_COIN_PICK.busy()], [false, true]);
  coin.dispatchEvent(mouse(w, 'pointerup')); coin.click();     // the release
  check('letting go after the pick does not also flip the coin', [coin.getAttribute('data-side'), coin.querySelector('.coin-in').style.transform], [null, '']);
  await wait(1100);
  const open = onPanes(w);
  check('exactly one table is open when it lands, and the stage is no longer resting', [open.length, d.getElementById('stage').classList.contains('rest')], [1, false]);
  check('it says which one (for a screen reader) in the game’s own name', pickText(w), 'The coin picked ' + GAME_NAMES[open[0]] + '.');
  check('the pick is finished and the coin is free again', [w.TR_COIN_PICK.busy(), coin.classList.contains('away')], [false, false]);
  check('it does not take you anywhere: the page is still the landing page', w.location.pathname, '/');
  const pane = paneOf(w, open[0]);
  check('the table that opened is the one the coin picked (its pane is the current one)', pane.getAttribute('aria-current'), 'true');
  check('only one table is current', panes(w).filter(p => p.getAttribute('aria-current') === 'true').length, 1);
  w.close();
});
suite('COIN PICK: a finger or mouse that wanders off cancels the hold', async () => {
  const w = ready(), coin = w.document.getElementById('brand-coin');
  coin.dispatchEvent(mouse(w, 'pointerdown'));
  coin.dispatchEvent(mouse(w, 'pointermove', { clientX: 40, clientY: 10 }));
  check('moving more than a thumb’s wobble cancels the charge', coin.classList.contains('charging'), false);
  await wait(800);
  check('and nothing is picked', [w.TR_COIN_PICK.busy(), onPanes(w)], [false, []]);
  coin.dispatchEvent(mouse(w, 'pointerdown')); coin.dispatchEvent(mouse(w, 'pointermove', { clientX: 14, clientY: 15 }));
  check('a small wobble does not', coin.classList.contains('charging'), true);
  coin.dispatchEvent(mouse(w, 'pointerleave'));
  check('sliding off the coin does', coin.classList.contains('charging'), false);
  coin.dispatchEvent(mouse(w, 'pointerdown', { button: 2 }));
  check('a right click does not start it', coin.classList.contains('charging'), false);
  w.close();
});
suite('COIN PICK: never the same table twice in a row, and every table can come up', async () => {
  const w = ready();
  const seen = []; let prev = null, repeat = false;
  for(let i = 0; i < 5; i++){
    w.Math.random = () => 0.0;                      // the worst case: the dice of fate say "the first one" every time
    w.TR_COIN_PICK.go(); await wait(900);
    const g = onPanes(w)[0]; seen.push(g); if(g === prev) repeat = true; prev = g;
  }
  check('even when the random number is the same every time, it never repeats itself', repeat, false);
  const w2 = ready(), got = new Set();
  for(let i = 0; i < 5; i++){
    const rv = [0.0, 0.2, 0.4, 0.6, 0.8][i];
    // lastPick is reset by a fresh page; one pick per page
    const x = ready(); x.Math.random = () => rv; x.TR_COIN_PICK.go(); await wait(900); got.add(onPanes(x)[0]); x.close();
  }
  check('each of the five tables can be the one picked', [...got].sort(), GAMES.slice().sort());
  w.close(); w2.close();
});
suite('COIN PICK: with reduced motion nothing flies, the table just opens', async () => {
  const w = ready({ reducedMotion: true }), coin = w.document.getElementById('brand-coin');
  coin.dispatchEvent(mouse(w, 'pointerdown'));
  check('the charge has no animation class dependency (it just holds)', coin.classList.contains('charging'), true);
  await wait(650);
  check('no coin is thrown across the page', w.document.querySelector('.coin-fly'), null);
  await wait(900);
  check('but the table still opens and is announced', [onPanes(w).length, /^The coin picked /.test(pickText(w))], [1, true]);
  check('and the css stops the charge and the ring from animating', /prefers-reduced-motion:reduce\)\{\.coin\.charging \.coin-hop\{animation:none/.test(HTML), true);
  w.close();
});
suite('COIN PICK: it can be done from the keyboard, and a quick key press is still a flip', async () => {
  const w = ready(), d = w.document, coin = d.getElementById('brand-coin');
  coin.focus();
  const ev = keyEv(w, 'keydown', 'Enter'); coin.dispatchEvent(ev);
  check('Enter does not click the coin by itself any more (it charges first)', [ev.defaultPrevented, coin.classList.contains('charging'), coin.getAttribute('data-side')], [true, true, null]);
  coin.dispatchEvent(keyEv(w, 'keyup', 'Enter'));
  check('a quick press and release is the ordinary flip', [coin.classList.contains('charging'), coin.getAttribute('data-side'), w.TR_COIN_PICK.busy()], [false, 'back', false]);
  coin.dispatchEvent(keyEv(w, 'keydown', ' ')); coin.dispatchEvent(keyEv(w, 'keyup', ' '));
  check('and so is Space', [coin.getAttribute('data-side'), w.TR_COIN_PICK.busy()], ['front', false]);
  coin.dispatchEvent(keyEv(w, 'keydown', ' '));
  await wait(300); coin.dispatchEvent(keyEv(w, 'keydown', ' ', { repeat: true }));
  check('a key held down (auto-repeat) is one hold, not many', [coin.classList.contains('charging'), coin.getAttribute('data-side')], [true, 'front']);
  await wait(400);
  check('held long enough, it picks', w.TR_COIN_PICK.busy(), true);
  coin.dispatchEvent(keyEv(w, 'keyup', ' '));
  check('and letting go does not flip it too', coin.getAttribute('data-side'), 'front');
  await wait(1000);
  check('one table is open and announced', [onPanes(w).length, /^The coin picked /.test(pickText(w))], [1, true]);
  coin.dispatchEvent(keyEv(w, 'keydown', 'Tab'));
  check('other keys are left alone', coin.classList.contains('charging'), false);
  w.close();
});
suite('COIN PICK: a one-time tip, only when nothing else is asking for attention', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  await wait(1000);
  check('not straight away', w.document.querySelector('.coin-tip'), null);
  await wait(2200);
  const tip = w.document.querySelector('.coin-tip');
  check('then a small note appears by the coin saying what to do', [!!tip, tip && /hold the coin/.test(tip.textContent)], [true, true]);
  check('and it is remembered as shown', w.localStorage.getItem('house_edge_cointip_v1'), '1');
  w.document.body.dispatchEvent(mouse(w, 'pointerdown'));
  await wait(450);
  check('any touch of the page dismisses it', w.document.querySelector('.coin-tip'), null);
  w.close();
  const v = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }), house_edge_cointip_v1: '1' } });
  await wait(3300);
  check('a visitor who has seen it never sees it again', v.document.querySelector('.coin-tip'), null);
  v.close();
  const n = load({});            // a brand-new visitor: the experience question comes first
  await wait(3300);
  check('a new visitor is asked the experience question first, with no tip on top of it', [!overlay(n).hidden, n.document.querySelector('.coin-tip')], [true, null]);
  n.close();
  const g = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  g.document.getElementById('brand-coin').dispatchEvent(mouse(g, 'pointerdown'));
  check('using the coin means the tip is never needed', g.localStorage.getItem('house_edge_cointip_v1'), '1');
  g.close();
});
suite('SOUND (landing): the footer switch, the coin’s ring, and a page that stays silent where there is no audio', async () => {
  const w = ready(), d = w.document;
  check('the engine is on the page and starts on', [typeof w.TRSound, w.TRSound.enabled()], ['object', true]);
  check('with no audio in the browser it quietly does nothing (and does not throw)', [w.TRSound.play('coin'), w.TRSound.context()], [false, null]);
  const line = d.getElementById('snd-line');
  check('the footer says the sound is on and offers to turn it off', [line.hidden, d.getElementById('snd-state').textContent, d.getElementById('snd-foot').textContent, d.getElementById('snd-foot').getAttribute('aria-pressed')], [false, 'on', 'Turn off', 'true']);
  d.getElementById('snd-foot').click();
  check('the switch turns it off, says so, and remembers it for every page on the site', [w.TRSound.enabled(), d.getElementById('snd-state').textContent, d.getElementById('snd-foot').textContent, w.localStorage.getItem('house_edge_sound_v1')], [false, 'off', 'Turn on', '0']);
  d.getElementById('snd-foot').click();
  check('and back on again', [w.TRSound.enabled(), w.localStorage.getItem('house_edge_sound_v1'), d.getElementById('snd-foot').getAttribute('aria-pressed')], [true, '1', 'true']);
  const heard = []; w.TRSound.play = (n, o) => { heard.push(n); return true; };
  d.getElementById('brand-coin').click();
  check('flipping the coin makes it ring', heard, ['coin']);
  d.getElementById('brand-coin').dispatchEvent(mouse(w, 'pointerdown'));
  check('holding it plays the charge-up', heard.slice(1), ['charge']);
  await wait(650); d.getElementById('brand-coin').dispatchEvent(mouse(w, 'pointerup'));
  check('the toss is heard when it is thrown', heard.slice(1, 3), ['charge', 'toss']);
  await wait(1000);
  check('and the coin is heard landing, just before the table opens', heard.slice(-1), ['coinLand']);
  d.getElementById('brand-coin').click();
  check('the release does not ring as a flip', heard.filter(n => n === 'coin').length, 1);
  w.close();
  const m = ready({ storage: { [XP]: JSON.stringify({ level: 'rules' }), house_edge_cointip_v1: '1', house_edge_sound_v1: '0' } });
  check('a visitor who muted the site elsewhere finds it muted here', [m.TRSound.enabled(), m.document.getElementById('snd-state').textContent, m.document.getElementById('snd-foot').textContent], [false, 'off', 'Turn on']);
  m.close();
  const b = ready({ blockStorage: true });
  check('with storage blocked it still works for this visit', [b.TRSound.enabled(), typeof b.TR_COIN_PICK.go], [true, 'function']);
  b.document.getElementById('snd-foot').click();
  check('and the switch still switches', b.TRSound.enabled(), false);
  b.close();
});

/* ===================== COPY, SEO, LINKS ===================== */
suite('SAFETY NET: existing page content and SEO tags are unchanged', async () => {
  const w = load({ storage: { [XP]: JSON.stringify({ level: 'rules' }) } });
  const d = w.document;
  check('title', d.title, 'Table Ready — free casino strategy trainer');
  check('meta description names all five games', /Blackjack, Baccarat, Pai Gow Poker, Ultimate Texas Hold'em, and Craps are all live now/.test(d.querySelector('meta[name="description"]').content), true);
  check('og + twitter tags still present', ['og:title', 'og:description', 'og:url'].every(p => !!d.querySelector('meta[property="' + p + '"]')) && ['twitter:title', 'twitter:description', 'twitter:card'].every(n => !!d.querySelector('meta[name="' + n + '"]')), true);
  check('canonical link', /<link rel="canonical" href="https:\/\/tableready\.xyz\/">/.test(HTML), true);
  check('headline intact', d.getElementById('rv-h1').textContent, 'Be table ready.');
  check('exactly one h1, and the five tables sit under a heading for screen readers', [d.querySelectorAll('h1').length, d.querySelector('h2.sr').textContent], [1, 'Five tables']);
  check('bankroll pill still renders a balance', /^\$[\d,]+$/.test(d.getElementById('bankroll-amount').textContent), true);
  check('header and footer link to Learn to play and the Glossary', [['.nav a', '/learn/'], ['.nav a', '/learn/glossary/'], ['footer a', '/learn/'], ['footer a', '/learn/glossary/']].map(([s, h]) => !!d.querySelector(s + '[href="' + h + '"]')), [true, true, true, true]);
  check('the brand links home', d.querySelector('.brand').getAttribute('href'), '/');
  check('the site disclaimer and copyright are still in the footer', [/not real-money gambling/.test(d.querySelector('footer').textContent), /SledgeMakesGames/.test(d.querySelector('footer').textContent)], [true, true]);
  check('dialog animation is switched off for reduced motion', /prefers-reduced-motion:reduce\)\{\.xp-dialog[^}]*animation:none/.test(HTML), true);
  check('no leftovers from the old layout (hero chip, table cards, hero moment)', ['hero-chip', 'table-card', 'hero-moment'].filter(x => HTML.includes(x)), []);
  w.close();
});

/* ===================== LINKS: exact letter case (a folder called "Craps" 404s for /craps/ on Vercel) ===================== */
const SITE_DIR = process.env.SITE_DIR || path.dirname(path.resolve(FILE));
function existsExactCase(root, urlPath){
  const segs = urlPath.split('#')[0].split('?')[0].split('/').filter(Boolean);
  let dir = root;
  if(!segs.length) return fs.existsSync(root) && fs.readdirSync(root).includes('index.html');
  for(let i = 0; i < segs.length; i++){
    if(!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
    if(!fs.readdirSync(dir).includes(segs[i])) return false;
    dir = path.join(dir, segs[i]);
  }
  return fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).includes('index.html') : true;
}

suite('LINKS: the checker itself notices a wrong-case folder', async () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'links-'));
  fs.mkdirSync(path.join(tmp, 'Craps')); fs.writeFileSync(path.join(tmp, 'Craps', 'index.html'), 'x');
  fs.mkdirSync(path.join(tmp, 'blackjack')); fs.writeFileSync(path.join(tmp, 'blackjack', 'index.html'), 'x');
  check('a folder named Craps does NOT satisfy /craps/', existsExactCase(tmp, '/craps/'), false);
  check('but it does satisfy /Craps/, and a correctly named folder satisfies its own link', [existsExactCase(tmp, '/Craps/'), existsExactCase(tmp, '/blackjack/')], [true, true]);
  check('a folder with no index.html is not a page', (fs.mkdirSync(path.join(tmp, 'empty')), existsExactCase(tmp, '/empty/')), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

suite('LINKS: every internal link and every sitemap address points at a real page, letter for letter', async () => {
  const pages = ['index.html', 'learn/index.html', 'learn/glossary/index.html', 'blackjack/index.html', 'baccarat/index.html', 'pai-gow/index.html', 'ultimate-texas-holdem/index.html', 'craps/index.html'];
  const missing = [], scanned = [], links = new Set();
  for(const p of pages){
    const f = path.join(SITE_DIR, p);
    const html = p === 'index.html' ? HTML : (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
    if(html === null){ if(p === 'index.html' || p === 'craps/index.html') missing.push('(page file missing) ' + p); continue; }
    scanned.push(p);
    (html.match(/href="\/[^"\/][^"]*"/g) || []).forEach(h => links.add(h.slice(6, -1)));
    (html.match(/(?:play|learn):'\/[^']*'/g) || []).forEach(h => links.add(h.slice(h.indexOf("'") + 1, -1)));
  }
  const sm = path.join(SITE_DIR, 'sitemap.xml');
  if(fs.existsSync(sm)) (fs.readFileSync(sm, 'utf8').match(/<loc>https:\/\/tableready\.xyz(\/[^<]*)<\/loc>/g) || []).forEach(l => links.add(l.replace(/<\/?loc>/g, '').replace('https://tableready.xyz', '')));
  links.forEach(l => { if(!existsExactCase(SITE_DIR, l)) missing.push(l); });
  check('the landing page and the craps page are both present to be checked', [scanned.includes('index.html'), scanned.includes('craps/index.html')], [true, true]);
  check('no internal link, game route or sitemap address points at a name that does not exist exactly as written', missing, []);
  check('the craps link is lowercase everywhere it appears on the landing page', [(HTML.match(/\/[Cc]raps\//g) || []).filter(x => x !== '/craps/').length, HTML.includes('href="/craps/"'), HTML.includes("play:'/craps/'")], [0, true, true]);
  check('and the craps page lives in a folder named exactly craps', fs.existsSync(path.join(SITE_DIR, 'craps')) && fs.readdirSync(SITE_DIR).includes('craps'), true);
});

/* ===================== runner ===================== */
module.exports = { suite, check, wait, load, fire, GAMES, paneOf, SUITES, HTML, FILE, get failures(){ return failures; } };

if(require.main === module){
  (async () => {
    const only = process.env.ONLY;            // e.g. ONLY=DEAL runs just the suites whose name contains it
    for(const s of SUITES){
      if(only && !new RegExp(only).test(s.name)) continue;
      console.log('\n=== ' + s.name + ' ===');
      await s.fn();
    }
    console.log('\nTOTAL FAILURES:', failures);
    process.exit(failures ? 1 : 0);
  })();
}
