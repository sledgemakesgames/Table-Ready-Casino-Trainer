/* UTH honors the home page's shared "how well do you know these games?" answer. node test_uth_experience.js [uth.html] */
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const FILE = process.argv[2] || path.join(__dirname, 'index.html');
const HTML = fs.readFileSync(FILE, 'utf8');
let failures = 0;
function check(name, actual, expected){ const ok = JSON.stringify(actual) === JSON.stringify(expected); if(!ok) failures++; console.log((ok ? 'OK: ' : 'FAIL: ') + name + (ok ? '' : '  (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')')); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const XP = 'house_edge_experience_v1', HINTS = 'house_edge_uth_hints_v1';
async function load(storage){
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://tableready.xyz/ultimate-texas-holdem/',
    beforeParse(w){ Object.keys(storage || {}).forEach(k => w.localStorage.setItem(k, storage[k])); } });
  await wait(400);
  return dom.window;
}
const overlayOpen = w => w.document.getElementById('skill-overlay').style.display === 'flex';
const hints = w => JSON.parse(w.localStorage.getItem(HINTS) || 'null');

(async () => {
  console.log('=== no shared answer: UTH asks its own question exactly as before ===');
  let w = await load({});
  check('own prompt is shown', overlayOpen(w), true);
  check('defaults to advanced until answered', w.G.skillLevel, 'advanced');
  w.close();

  for(const [level, expected] of [['new', 'beginner'], ['rules', 'beginner'], ['pro', 'advanced']]){
    console.log('\n=== shared answer "' + level + '": UTH uses it and does not ask again ===');
    w = await load({ [XP]: JSON.stringify({ level }) });
    check(level + ': own prompt stays closed', overlayOpen(w), false);
    check(level + ': UTH skill level becomes ' + expected, w.G.skillLevel, expected);
    check(level + ': prompt is recorded as answered so it never returns', w.G.seenSkillPrompt, true);
    check(level + ': persisted to UTH\'s own storage', hints(w) && [hints(w).skillLevel, hints(w).seenSkillPrompt], [expected, true]);
    check(level + ': beginner hides the outs/odds side panels, advanced shows them', w.document.getElementById('side-panels').style.display, expected === 'beginner' ? 'none' : '');
    w.close();
  }

  console.log('\n=== someone who already answered UTH\'s own prompt keeps their UTH choice ===');
  w = await load({ [XP]: JSON.stringify({ level: 'new' }), [HINTS]: JSON.stringify({ seenChipsHint: true, seenBasicsHint: true, skillLevel: 'advanced', seenSkillPrompt: true }) });
  check('stays advanced even though home page says new', w.G.skillLevel, 'advanced');
  check('prompt stays closed', overlayOpen(w), false);
  w.close();
  w = await load({ [XP]: JSON.stringify({ level: 'pro' }), [HINTS]: JSON.stringify({ skillLevel: 'beginner', seenSkillPrompt: true }) });
  check('stays beginner even though home page says pro', w.G.skillLevel, 'beginner');
  w.close();

  console.log('\n=== bad shared data is ignored: UTH just asks its own question ===');
  for(const raw of ['garbage', '{"level":"constructor"}', '{"level":"__proto__"}', '{"level":"expert"}', 'null', '[]', '{"level":null}']){
    w = await load({ [XP]: raw });
    check('"' + raw + '" -> own prompt shown, nothing auto-answered', [overlayOpen(w), w.G.seenSkillPrompt], [true, false]);
    w.close();
  }

  console.log('\n=== the player can still change level in UTH afterwards ===');
  w = await load({ [XP]: JSON.stringify({ level: 'new' }) });
  w.document.getElementById('btn-level-advanced').click();
  check('Settings toggle still works', w.G.skillLevel, 'advanced');
  check('and the change is saved', hints(w).skillLevel, 'advanced');
  w.close();

  console.log('\n=== changing the answer on the home page later is followed (when the level came from the home page) ===');
  const snap = w2 => w2.localStorage.getItem(HINTS);
  async function reloadWithAnswer(prevHints, level){ return load({ [XP]: JSON.stringify({ level }), [HINTS]: prevHints }); }
  for(const [first, second, expected] of [['new', 'pro', 'advanced'], ['pro', 'rules', 'beginner'], ['pro', 'new', 'beginner'], ['rules', 'pro', 'advanced'], ['new', 'rules', 'beginner'], ['rules', 'new', 'beginner']]){
    w = await load({ [XP]: JSON.stringify({ level: first }) });
    const saved1 = snap(w);
    check(first + ': first visit records where the level came from', [hints(w).skillSource, hints(w).sharedLevel], ['shared', first]);
    w.close();
    w = await reloadWithAnswer(saved1, second);
    check(first + ' -> ' + second + ': UTH follows the new answer (' + expected + ')', w.G.skillLevel, expected);
    check(first + ' -> ' + second + ': no prompt is shown', overlayOpen(w), false);
    check(first + ' -> ' + second + ': new answer is remembered, still marked as from the home page', [hints(w).skillLevel, hints(w).skillSource, hints(w).sharedLevel], [expected, 'shared', second]);
    check(first + ' -> ' + second + ': panels match the level', w.document.getElementById('side-panels').style.display, expected === 'beginner' ? 'none' : '');
    w.close();
  }

  console.log('\n=== a choice made inside UTH is never overridden by the home page ===');
  w = await load({ [XP]: JSON.stringify({ level: 'new' }) });
  w.document.getElementById('btn-level-advanced').click();
  check('Settings toggle marks the level as chosen here', [hints(w).skillLevel, hints(w).skillSource], ['advanced', 'own']);
  let saved = snap(w); w.close();
  for(const lvl of ['pro', 'rules', 'new']){
    w = await reloadWithAnswer(saved, lvl);
    check('toggled to advanced, home page now "' + lvl + '": stays advanced', w.G.skillLevel, 'advanced');
    check('...and the state is untouched', hints(w).skillSource, 'own');
    w.close();
  }
  w = await load({ [XP]: JSON.stringify({ level: 'pro' }) });
  w.document.getElementById('btn-level-beginner').click();
  saved = snap(w); w.close();
  w = await reloadWithAnswer(saved, 'pro');
  check('toggled to beginner while home page says pro: stays beginner', w.G.skillLevel, 'beginner');
  w.close();

  console.log('\n=== answering UTH\'s own prompt (no home page answer) is also a choice made here ===');
  w = await load({});
  check('prompt is up', overlayOpen(w), true);
  w.document.getElementById('btn-skill-advanced').click();
  check('prompt closes and records an own choice', [overlayOpen(w), hints(w).skillLevel, hints(w).skillSource], [false, 'advanced', 'own']);
  saved = snap(w); w.close();
  w = await reloadWithAnswer(saved, 'new');
  check('home page answer arriving later does not override it', [w.G.skillLevel, overlayOpen(w)], ['advanced', false]);
  w.close();

  console.log('\n=== old saves and junk ===');
  w = await load({ [XP]: JSON.stringify({ level: 'pro' }), [HINTS]: JSON.stringify({ skillLevel: 'beginner', seenSkillPrompt: true }) });
  check('older save with no source is treated as a choice made here (not overridden)', [w.G.skillLevel, w.G.skillSource], ['beginner', 'own']);
  w.close();
  w = await load({ [XP]: JSON.stringify({ level: 'pro' }), [HINTS]: JSON.stringify({ skillLevel: 'beginner', seenSkillPrompt: true, skillSource: 'shared', sharedLevel: 'banana' }) });
  check('junk sharedLevel is ignored, so a real answer is adopted', [w.G.skillLevel, w.G.sharedLevel], ['advanced', 'pro']);
  w.close();
  w = await load({ [XP]: JSON.stringify({ level: 'expert' }), [HINTS]: JSON.stringify({ skillLevel: 'beginner', seenSkillPrompt: true, skillSource: 'shared', sharedLevel: 'new' }) });
  check('junk home page answer changes nothing', [w.G.skillLevel, w.G.sharedLevel], ['beginner', 'new']);
  w.close();
  w = await load({ [HINTS]: JSON.stringify({ skillLevel: 'beginner', seenSkillPrompt: true, skillSource: 'shared', sharedLevel: 'new' }) });
  check('home page answer missing: shared-sourced level is kept, no prompt', [w.G.skillLevel, overlayOpen(w)], ['beginner', false]);
  w.close();

  console.log('\n=== the prompt text shows real dashes, not "\\u2014" ===');
  w = await load({});
  const promptText = w.document.getElementById('skill-overlay').textContent;
  const settingsText = w.document.getElementById('btn-level-beginner').parentElement.parentElement.textContent;
  check('prompt screen has no literal \\u2014', /\\u2014/.test(promptText), false);
  check('settings note has no literal \\u2014', /\\u2014/.test(settingsText), false);
  check('prompt screen shows an em dash', promptText.indexOf('—') >= 0, true);
  w.close();

  console.log('\nTOTAL FAILURES:', failures);
  process.exit(failures ? 1 : 0);
})();
