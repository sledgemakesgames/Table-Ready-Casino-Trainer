// The Support link: every page points to /support/, and that page sends people to Ko-fi in a new tab, safely.   node test_support.js
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
let oks = 0, failures = 0;
function ok(c, d, x){ if(c){ oks++; console.log('OK:', d); } else { failures++; console.log('FAIL:', d, x === undefined ? '' : '| ' + JSON.stringify(x)); } }
const ROOT = process.env.SITE || __dirname;
const PAGES = ['index.html', 'learn/index.html', 'learn/glossary/index.html', 'report/index.html', 'blackjack/index.html', 'baccarat/index.html', 'craps/index.html', 'pai-gow/index.html', 'ultimate-texas-holdem/index.html'];
for(const p of PAGES){
  const h = fs.readFileSync(path.join(ROOT, p), 'utf8');
  const fi = h.lastIndexOf('<footer'), foot = fi >= 0 ? h.slice(fi) : h.slice(h.lastIndexOf('class="foot-note"') - 100, h.lastIndexOf('class="foot-note"') + 700);   // blackjack closes with a plain foot-note, not a footer tag
  ok(/<a [^>]*href="\/support\/"[^>]*>Support the site<\/a>/.test(foot), p + ': the footer has a "Support the site" link to /support/');
  const hdr = h.slice(0, h.indexOf('</header>') > 0 ? h.indexOf('</header>') : 0);
  const headerLink = /My Report<\/a>\s*<a [^>]*href="\/support\/"[^>]*>Support<\/a>/.test(h.slice(h.indexOf('<header'), h.indexOf('<header') + 6000));
  if(p === 'index.html') ok(headerLink, p + ': \"Support\" sits right after \"My Report\" in the landing page header');
  else ok(!headerLink, p + ': no Support link in the header (it is on the landing page header only; the footer has it)');
  ok(/>My Report</.test(h) && !/>My report</.test(h), p + ': and the link says "My Report"');
  ok(!/ko-fi\.com/.test(h), p + ': and nothing outside /support/ links to Ko-fi directly (one place to change it)');
}
const sup = fs.readFileSync(path.join(ROOT, 'support/index.html'), 'utf8');
ok(/<a [^>]*href="https:\/\/ko-fi\.com\/tableready"[^>]*>/.test(sup), 'the Support page links to ko-fi.com/tableready');
const a = (sup.match(/<a [^>]*ko-fi\.com\/tableready[^>]*>/) || [''])[0];
ok(/target="_blank"/.test(a) && /rel="noopener noreferrer"/.test(a), 'and opens it in a new tab with noopener noreferrer', a);
ok((sup.match(/ko-fi\.com/g) || []).length === 1, 'Ko-fi appears once on the page');
ok(/<link rel="canonical" href="https:\/\/tableready\.xyz\/support\/">/.test(sup) && /<title>Support Table Ready<\/title>/.test(sup), 'it has its own title and canonical address');
ok(/tableready\.xyz\/support\//.test(fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8')), 'it is in the sitemap');
ok(!/\bdonat(e|ion)s?\b/i.test(sup.replace(/<script[\s\S]*?<\/script>/g, '')), 'it says "support", not "donate"');
ok(!/\btip(s|ping)?\b/i.test(sup.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')), 'and never calls it a tip (the tables have their own tip jar)');
const rep = fs.readFileSync(path.join(ROOT, 'report/index.html'), 'utf8');
ok(/id="support-ask"[^>]*>[^<]*<a href="\/support\/"/.test(rep), 'the report page has its one soft line asking for support');
(async () => {
  const b = await chromium.launch();
  for(const [name, opt] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }]]){
    const ctx = await b.newContext(opt); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('file://' + path.join(ROOT, 'support/index.html'), { waitUntil: 'load' });
    const m = await p.evaluate(() => { const r = document.querySelector('.pillbtn').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, h: Math.round(r.height), w: Math.round(r.width), vis: r.width > 0 && r.top < innerHeight * 2 }; });
    ok(m.sw <= m.iw, name + ': the Support page does not scroll sideways', m);
    ok(m.h >= 44, name + ': the button is big enough to tap (' + m.h + 'px)', m);
    ok(errs.length === 0, name + ': no page errors', errs);
    await ctx.close();
  }
  await b.close();
  console.log('\n' + oks + ' passed, ' + failures + ' failed'); process.exit(failures ? 1 : 0);
})();
