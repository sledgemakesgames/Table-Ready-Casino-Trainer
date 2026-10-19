/* Craps engine tests.  node test_engine.js  (loads ./engine.js)
   The house-edge section re-derives every published edge by driving the real engine through all 36 dice
   combinations, so a payout or rule mistake anywhere in resolveRoll shows up as a wrong percentage. */
const E = require(process.argv[2] || './engine.js');
let failures = 0, passes = 0;
function check(desc, actual, expected){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(ok) passes++; else { failures++; console.log('FAIL:', desc, '| got', JSON.stringify(actual), 'expected', JSON.stringify(expected)); }
}
function near(desc, actual, expected, tol){
  const ok = Math.abs(actual - expected) <= (tol || 1e-12);
  if(ok) passes++; else { failures++; console.log('FAIL:', desc, '| got', actual, 'expected', expected); }
}
// build a state with the given bets already on the felt
function st(point, bets, opts){
  let s = E.newState(opts); s.point = point;
  bets.forEach(b => { s.bets.push({id:s.nextId++, type:b.type, amount:b.amount, number:b.number === undefined ? null : b.number, odds:b.odds || 0}); });
  return s;
}
function roll(s, d1, d2){ return E.resolveRoll(s, d1, d2); }
function ev(r, type){ return r.events.filter(e => e.type === type); }
// two dice that make a total (non-pair unless hard requested)
function dice(sum, hard){
  if(hard) return [sum/2, sum/2];
  for(let a=1;a<=6;a++){ const b = sum - a; if(b>=1 && b<=6 && a!==b) return [a,b]; }
  return [sum/2, sum/2];
}
function rollSum(s, sum, hard){ const d = dice(sum, hard); return roll(s, d[0], d[1]); }

console.log('=== dice ways ===');
check('36 combinations in total', Object.values(E.WAYS).reduce((a,b)=>a+b,0), 36);
let counted = {}; for(let a=1;a<=6;a++) for(let b=1;b<=6;b++) counted[a+b] = (counted[a+b]||0)+1;
check('ways table matches counting two dice', E.WAYS, counted);

console.log('\n=== Pass Line ===');
let s = st(null, [{type:'pass', amount:10}]);
for(const n of [7,11]){ const r = rollSum(s, n); check('come-out '+n+': pass wins even money', [r.events[0].result, r.events[0].flatNet, r.events[0].credit, r.state.bets.length, r.pointAfter], ['win', 10, 20, 0, null]); }
for(const n of [2,3,12]){ const r = rollSum(s, n); check('come-out '+n+': pass loses', [r.events[0].result, r.events[0].credit, r.state.bets.length, r.pointAfter, r.craps], ['lose', 0, 0, null, true]); }
for(const n of [4,5,6,8,9,10]){ const r = rollSum(s, n); check('come-out '+n+': becomes the point, bet stays', [r.pointAfter, r.state.bets.length, r.events[0].result, r.events[0].resolved, r.pointEstablished], [n, 1, 'point', false, true]); }
s = st(6, [{type:'pass', amount:10, odds:50}]);
let r = rollSum(s, 6); check('point made: flat 1:1 plus 6:5 odds, all returned', [r.events[0].result, r.events[0].flatNet, r.events[0].oddsNet, r.events[0].credit, r.pointAfter, r.pointMade], ['win', 10, 60, 10+10+50+60, null, true]);
r = rollSum(s, 7); check('seven-out: flat and odds both lose', [r.events[0].result, r.events[0].flatNet, r.events[0].oddsNet, r.events[0].credit, r.pointAfter, r.sevenOut], ['lose', -10, -50, 0, null, true]);
r = rollSum(s, 5); check('other number: no action', [r.events.length, r.state.bets.length, r.pointAfter], [0, 1, 6]);
r = rollSum(s, 11); check('11 with a point on does nothing to the pass line', [r.events.length, r.pointAfter], [0, 6]);

console.log('\n=== Don\'t Pass (12 barred) ===');
s = st(null, [{type:'dontpass', amount:10}]);
for(const n of [2,3]){ r = rollSum(s, n); check('come-out '+n+': don\'t pass wins', [r.events[0].result, r.events[0].credit], ['win', 20]); }
for(const n of [7,11]){ r = rollSum(s, n); check('come-out '+n+': don\'t pass loses', r.events[0].result, 'lose'); }
r = rollSum(s, 12); check('come-out 12 is barred: push, stake returned', [r.events[0].result, r.events[0].credit, r.state.bets.length], ['push', 10, 0]);
r = rollSum(s, 5); check('come-out 5: point set, bet stays', [r.pointAfter, r.state.bets.length], [5, 1]);
s = st(4, [{type:'dontpass', amount:10, odds:60}]);
r = rollSum(s, 7); check('seven wins: 1:1 flat and 1:2 lay odds on a 4', [r.events[0].flatNet, r.events[0].oddsNet, r.events[0].credit, r.sevenOut], [10, 30, 10+10+60+30, true]);
r = rollSum(s, 4); check('point made: don\'t pass loses flat and lay odds', [r.events[0].flatNet, r.events[0].oddsNet, r.events[0].credit], [-10, -60, 0]);
s = st(5, [{type:'dontpass', amount:10, odds:60}]);
r = rollSum(s, 7); check('lay 5/9 pays 2:3', r.events[0].oddsNet, 40);
s = st(6, [{type:'dontpass', amount:10, odds:60}]);
r = rollSum(s, 7); check('lay 6/8 pays 5:6', r.events[0].oddsNet, 50);

console.log('\n=== Come bets ===');
s = st(8, [{type:'come', amount:10}]);
for(const n of [7,11]){ r = rollSum(s, n); check('new come bet wins on '+n, [r.events[0].result, r.events[0].credit], ['win', 20]); }
for(const n of [2,3,12]){ r = rollSum(s, n); check('new come bet loses on '+n, r.events[0].result, 'lose'); }
r = rollSum(s, 6); check('new come bet travels to 6', [r.state.bets[0].number, r.events[0].result, r.events[0].resolved, r.pointAfter], [6, 'travel', false, 8]);
r = rollSum(s, 8); check('come bet traveling to the point number does not affect the pass line', [r.state.bets[0].number, r.pointAfter, r.pointMade], [8, null, true]);
s = st(8, [{type:'come', amount:10, number:6, odds:50}]);
r = rollSum(s, 6); check('traveled come wins flat plus 6:5 odds (odds are working)', [r.events[0].flatNet, r.events[0].oddsNet, r.events[0].credit], [10, 60, 130]);
r = rollSum(s, 7); check('seven takes the come bet and its odds', [r.events[0].flatNet, r.events[0].oddsNet, r.events[0].credit], [-10, -50, 0]);
s = st(null, [{type:'come', amount:10, number:6, odds:50}]);
r = rollSum(s, 7); check('come-out 7: flat loses, odds are OFF and come back', [r.events[0].flatNet, r.events[0].oddsNet, r.events[0].oddsMode, r.events[0].credit], [-10, 0, 'return', 50]);
r = rollSum(s, 6); check('come-out 6: flat wins even money, odds returned with no payout', [r.events[0].flatNet, r.events[0].oddsNet, r.events[0].credit], [10, 0, 10+10+50]);
s = st(null, [{type:'come', amount:10, number:6, odds:50}], {comeOddsWork:true});
r = rollSum(s, 7); check('with "odds working" a come-out 7 takes the odds too', [r.events[0].oddsNet, r.events[0].credit], [-50, 0]);
s = st(8, [{type:'dontcome', amount:10, number:4, odds:60}]);
r = rollSum(s, 7); check('don\'t come on 4: seven pays flat + 1:2 lay', [r.events[0].flatNet, r.events[0].oddsNet], [10, 30]);
r = rollSum(s, 4); check('don\'t come loses when its number rolls', [r.events[0].flatNet, r.events[0].oddsNet], [-10, -60]);
s = st(8, [{type:'dontcome', amount:10}]);
r = rollSum(s, 12); check('new don\'t come: 12 is a push', [r.events[0].result, r.events[0].credit], ['push', 10]);
r = rollSum(s, 11); check('new don\'t come loses on 11', r.events[0].result, 'lose');
s = st(8, [{type:'come', amount:10}, {type:'come', amount:25, number:6}]);
r = rollSum(s, 6); check('the roll that sends a new come bet to 6 pays the old one on 6, so they never share a number', [r.state.bets.length, r.state.bets[0].amount, r.state.bets[0].number, r.events.filter(e=>e.result==='win').length, r.events.filter(e=>e.result==='travel').length], [1, 10, 6, 1, 1]);

console.log('\n=== Place bets ===');
s = st(6, [{type:'place', amount:30, number:6}]);
r = rollSum(s, 6); check('place 6 pays 7:6 and stays up', [r.events[0].flatNet, r.events[0].credit, r.events[0].removed, r.state.bets.length], [35, 35, false, 1]);
r = rollSum(s, 7); check('seven loses a place bet', [r.events[0].result, r.state.bets.length], ['lose', 0]);
r = rollSum(s, 8); check('other numbers do nothing', r.events.length, 0);
check('place 5/9 pays 7:5', roll(st(6,[{type:'place',amount:10,number:9}]), 4, 5).events[0].flatNet, 14);
check('place 4/10 pays 9:5', roll(st(6,[{type:'place',amount:10,number:10}]), 5, 5).events[0].flatNet, 18);
check('rounding: $25 on the 6 pays $29 (rounded down)', roll(st(5,[{type:'place',amount:25,number:6}]), 1, 5).events[0].flatNet, 29);
check('rounding: $5 on the 6 pays only $5', roll(st(5,[{type:'place',amount:5,number:6}]), 1, 5).events[0].flatNet, 5);
check('rounding: $30 on the 6 pays a full $35', roll(st(5,[{type:'place',amount:30,number:6}]), 1, 5).events[0].flatNet, 35);
s = st(null, [{type:'place', amount:30, number:6}]);
r = rollSum(s, 7); check('place bets are OFF on a come-out 7 (they stay)', [r.events.length, r.state.bets.length], [0, 1]);
r = rollSum(s, 6); check('place bets are OFF on a come-out 6 (no payout)', [r.events.length, r.pointAfter], [0, 6]);
s = st(null, [{type:'place', amount:30, number:6}], {placeWork:true});
r = rollSum(s, 6); check('placeWork option makes them live on the come-out', r.events[0].flatNet, 35);

console.log('\n=== Field ===');
for(const [n, win] of [[3,1],[4,1],[9,1],[10,1],[11,1],[2,2],[12,3]]){ r = rollSum(st(6,[{type:'field',amount:10}]), n); check('field '+n+' pays '+win+':1', [r.events[0].flatNet, r.events[0].removed], [10*win, true]); }
for(const n of [5,6,7,8]){ r = rollSum(st(6,[{type:'field',amount:10}]), n); check('field loses on '+n, r.events[0].flatNet, -10); }
check('field 12 can be set to pay 2:1', rollSum(st(6,[{type:'field',amount:10}],{field12:2}), 12).events[0].flatNet, 20);

console.log('\n=== Hardways ===');
s = st(6, [{type:'hard', amount:10, number:8}]);
r = rollSum(s, 8, true); check('hard 8 (4-4) pays 9:1 and stays', [r.events[0].flatNet, r.state.bets.length], [90, 1]);
r = rollSum(s, 8, false); check('easy 8 loses it', [r.events[0].result, r.state.bets.length], ['lose', 0]);
r = rollSum(s, 7); check('seven loses it', r.events[0].result, 'lose');
r = rollSum(s, 6, true); check('a hard 6 does nothing to a hard 8', r.events.length, 0);
check('hard 4 pays 7:1', rollSum(st(6,[{type:'hard',amount:10,number:4}]), 4, true).events[0].flatNet, 70);
check('hard 10 pays 7:1', rollSum(st(6,[{type:'hard',amount:10,number:10}]), 10, true).events[0].flatNet, 70);
check('hard 6 pays 9:1', rollSum(st(8,[{type:'hard',amount:10,number:6}]), 6, true).events[0].flatNet, 90);
r = rollSum(st(null,[{type:'hard',amount:10,number:6}]), 7); check('hardways are OFF on the come-out roll', r.events.length, 0);

console.log('\n=== One-roll props ===');
for(const [type, sum, pay] of [['any7',7,4],['anycraps',2,7],['anycraps',3,7],['anycraps',12,7],['yo',11,15],['aces',2,30],['boxcars',12,30],['acedeuce',3,15]]){
  r = rollSum(st(6,[{type, amount:10}]), sum); check(type+' wins '+pay+':1 on a '+sum, [r.events[0].flatNet, r.events[0].credit], [10*pay, 10+10*pay]);
}
for(const [type, sum] of [['any7',6],['anycraps',7],['yo',7],['aces',3],['boxcars',11],['acedeuce',2]]){
  r = rollSum(st(6,[{type, amount:10}]), sum); check(type+' loses on a '+sum, r.events[0].flatNet, -10);
}
r = rollSum(st(null,[{type:'any7', amount:10}]), 7); check('props work on a come-out roll too', r.events[0].flatNet, 40);

console.log('\n=== placing, odds limits, removing ===');
s = E.newState();
check('pass bet is allowed on the come-out', E.canPlace(s, 'pass', 10).ok, true);
check('come bet is refused with no point', E.canPlace(s, 'come', 10).ok, false);
check('place on 7 refused', E.canPlace(s, 'place', 10, 7).ok, false);
check('hard 5 refused', E.canPlace(s, 'hard', 10, 5).ok, false);
check('zero / fractional / non-number amounts refused', [E.canPlace(s,'pass',0).ok, E.canPlace(s,'pass',2.5).ok, E.canPlace(s,'pass','5').ok, E.canPlace(s,'pass',NaN).ok], [false,false,false,false]);
check('unknown bet type refused', E.canPlace(s, 'horn', 10).ok, false);
let p1 = E.placeBet(s, 'pass', 10); let p2 = E.placeBet(p1.state, 'pass', 15);
check('placing on the same spot adds to it', [p2.state.bets.length, p2.state.bets[0].amount], [1, 25]);
check('placing does not mutate the old state', [s.bets.length, p1.state.bets[0].amount], [0, 10]);
let withPoint = E.clone(p2.state); withPoint.point = 4;
check('after a point, no new pass bets', E.canPlace(withPoint, 'pass', 10).ok, false);
check('after a point, come bets are allowed', E.canPlace(withPoint, 'come', 10).ok, true);
check('no odds before a point', E.canAddOdds(p2.state, p2.state.bets[0].id, 5).ok, false);
const id = withPoint.bets[0].id;
check('3-4-5x: $25 pass, point 4 -> max odds $75', E.maxOdds(withPoint, withPoint.bets[0]), 75);
withPoint.point = 5; check('...point 5 -> $100', E.maxOdds(withPoint, withPoint.bets[0]), 100);
withPoint.point = 6; check('...point 6 -> $125', E.maxOdds(withPoint, withPoint.bets[0]), 125);
check('odds over the limit refused', E.canAddOdds(withPoint, id, 130).ok, false);
let o1 = E.addOdds(withPoint, id, 100); let o2 = E.addOdds(o1.state, id, 25);
check('odds can be built up to the limit', [o1.ok, o2.ok, o2.state.bets[0].odds, E.oddsRoom(o2.state, o2.state.bets[0])], [true, true, 125, 0]);
check('...and not past it', E.addOdds(o2.state, id, 5).ok, false);
let lay = E.newState(); lay = E.placeBet(lay, 'dontpass', 10).state; lay.point = 4;
check('3-4-5x lay: $10 don\'t pass on a 4 may lay $60 (to win $30)', E.maxOdds(lay, lay.bets[0]), 60);
lay.point = 6; check('...on a 6 may lay $60 (to win $50)', E.maxOdds(lay, lay.bets[0]), 60);
let one = E.newState({oddsRule:'1x'}); one = E.placeBet(one,'pass',10).state; one.point = 6;
check('1x odds: $10 max', E.maxOdds(one, one.bets[0]), 10);
let ten = E.newState({oddsRule:'10x'}); ten = E.placeBet(ten,'pass',10).state; ten.point = 6;
check('10x odds: $100 max', E.maxOdds(ten, ten.bets[0]), 100);
let cm = E.newState(); cm.point = 8; cm = E.placeBet(cm,'come',10).state;
check('odds on an un-traveled come bet are refused', E.canAddOdds(cm, cm.bets[0].id, 5).ok, false);
check('pass line can be taken down on the come-out', E.removeBet(p2.state, p2.state.bets[0].id).refund, 25);
check('...but not once a point is set', E.removeBet(withPoint, withPoint.bets[0].id).ok, false);
let pl = E.placeBet(E.newState(), 'place', 30, 6).state;
check('place bets can always be taken down', E.removeBet(pl, pl.bets[0].id).ok, true);
let dpOdds = E.addOdds(lay, lay.bets[0].id, 30).state;
check('removing a bet refunds its odds too', E.removeBet(dpOdds, dpOdds.bets[0].id).refund, 40);
check('odds alone can be taken down', E.removeOdds(o2.state, id).refund, 125);
let ct = E.newState(); ct.point = 8; ct = E.placeBet(ct,'come',10).state; ct = E.resolveRoll(ct, 3, 3).state;
check('a traveled come bet is locked in', E.removeBet(ct, ct.bets[0].id).ok, false);

console.log('\n=== undo helpers: reduceBet / reduceOdds ===');
let ub = E.placeBet(E.newState(), 'place', 30, 6).state;
let ur = E.reduceBet(ub, ub.bets[0].id, 10);
check('reduce part of a bet', [ur.ok, ur.refund, ur.state.bets[0].amount], [true, 10, 20]);
ur = E.reduceBet(ub, ub.bets[0].id, 30);
check('reducing the whole amount removes the bet', [ur.ok, ur.state.bets.length], [true, 0]);
check('cannot reduce by more than is there / zero / fractions', [E.reduceBet(ub, ub.bets[0].id, 31).ok, E.reduceBet(ub, ub.bets[0].id, 0).ok, E.reduceBet(ub, ub.bets[0].id, 2.5).ok], [false, false, false]);
let up = E.placeBet(E.newState(), 'pass', 25).state; up.point = 6;
check('a locked pass line bet cannot be reduced', E.reduceBet(up, up.bets[0].id, 5).ok, false);
let uo = E.placeBet(E.newState(), 'pass', 50).state; uo.point = 6; uo = E.addOdds(uo, uo.bets[0].id, 250).state;
let uo2 = E.clone(uo); uo2.point = null;
check('reduce odds', [E.reduceOdds(uo, uo.bets[0].id, 50).ok, E.reduceOdds(uo, uo.bets[0].id, 50).state.bets[0].odds], [true, 200]);
check('cannot reduce odds by more than are there', E.reduceOdds(uo, uo.bets[0].id, 300).ok, false);
let ud = E.placeBet(E.newState(), 'dontpass', 50).state; ud.point = 6; ud = E.addOdds(ud, ud.bets[0].id, 60).state;
check('don\'t pass can be reduced, but not below what its odds need', [E.reduceBet(ud, ud.bets[0].id, 10).ok, E.reduceBet(ud, ud.bets[0].id, 50).ok], [true, false]);
let ud2 = E.addOdds(ud, ud.bets[0].id, 240).state;
check('...a bet cannot shrink under its own odds limit', E.reduceBet(ud2, ud2.bets[0].id, 10).ok, false);

console.log('\n=== exact house edge: every bet re-derived from the engine over all 36 rolls ===');
// V(state): expected NET of the tracked bet per eventual resolution, with the point optionally pinned so a
// Come/Place/Hardway bet's future does not depend on pass-line bookkeeping.
function V(state, trackId, pin, part){
  let num = 0, selfP = 0, move = 0, sub = 0;
  for(let a=1;a<=6;a++) for(let b=1;b<=6;b++){
    const r = E.resolveRoll(state, a, b), p = 1/36;
    const e = r.events.find(x => x.betId === trackId);
    const net = !e ? 0 : (part === 'odds' ? e.oddsNet : part === 'flat' ? e.flatNet : e.flatNet + e.oddsNet);
    if(e && e.resolved){ num += p * net; }
    else {
      const still = r.state.bets.find(x => x.id === trackId);
      if(!still) throw new Error('bet vanished unresolved');
      const next = E.clone(r.state); if(pin !== undefined) next.point = pin;
      if(JSON.stringify(next) === JSON.stringify(state)) selfP += p;
      else { sub += p * V(next, trackId, pin, part); move += p; }
    }
  }
  return (num + sub) / (1 - selfP);
}
function edgeOf(state, amount, pin, part){ return -V(state, state.bets[0].id, pin, part) / amount; }
const A = 60; // multiple of 5 and 6 so no payout is ever rounded
near('Pass Line 7/495 = 1.414%', edgeOf(st(null,[{type:'pass',amount:A}]), A), 7/495);
near('Don\'t Pass 3/220 = 1.364%', edgeOf(st(null,[{type:'dontpass',amount:A}]), A), 3/220);
for(const pt of [4,5,6,8,9,10]){
  near('Come (point '+pt+' pinned) = Pass Line edge', edgeOf(st(pt,[{type:'come',amount:A}]), A, pt, 'flat'), 7/495);
  near('Don\'t Come (point '+pt+' pinned) = Don\'t Pass edge', edgeOf(st(pt,[{type:'dontcome',amount:A}]), A, pt, 'flat'), 3/220);
}
for(const [n, edge, label] of [[6,1/66,'1.52%'],[8,1/66,'1.52%'],[5,1/25,'4.00%'],[9,1/25,'4.00%'],[4,1/15,'6.67%'],[10,1/15,'6.67%']]){
  near('Place '+n+' = '+label, edgeOf(st(6,[{type:'place',amount:A,number:n}]), A, 6), edge);
}
for(const amt of [60, 100]){
  for(const [n, edge, label] of [[4,1/60,'1.67%'],[10,1/60,'1.67%'],[5,1/50,'2.00%'],[9,1/50,'2.00%'],[6,1/44,'2.27%'],[8,1/44,'2.27%']]){
    near('Buy '+n+' with $'+amt+' = '+label+' (true odds less 5% on wins)', edgeOf(st(6,[{type:'buy',amount:amt,number:n}]), amt, 6), edge);
  }
}
near('Field (2:1 on 2, 3:1 on 12) = 1/36 = 2.78%', edgeOf(st(6,[{type:'field',amount:A}]), A, 6), 1/36);
check('Field with 2:1 on both 2 and 12 is 5.56%', Math.round(edgeOf(st(6,[{type:'field',amount:A}],{field12:2}), A, 6)*1e6)/1e6, Math.round(2/36*1e6)/1e6);
near('Hard 4 = 11.11%', edgeOf(st(6,[{type:'hard',amount:A,number:4}]), A, 6), 1/9);
near('Hard 10 = 11.11%', edgeOf(st(6,[{type:'hard',amount:A,number:10}]), A, 6), 1/9);
near('Hard 6 = 9.09%', edgeOf(st(5,[{type:'hard',amount:A,number:6}]), A, 5), 1/11);
near('Hard 8 = 9.09%', edgeOf(st(5,[{type:'hard',amount:A,number:8}]), A, 5), 1/11);
for(const [t, edge, label] of [['any7',1/6,'16.67%'],['anycraps',1/9,'11.11%'],['yo',1/9,'11.11%'],['acedeuce',1/9,'11.11%'],['aces',5/36,'13.89%'],['boxcars',5/36,'13.89%']]){
  near(t+' = '+label, edgeOf(st(6,[{type:t,amount:A}]), A, 6), edge);
}
for(const pt of [4,5,6,8,9,10]){
  near('Pass odds on '+pt+' have exactly 0% edge', V(st(pt,[{type:'pass',amount:A,odds:A}]), 1, undefined, 'odds'), 0);
  near('Lay odds on '+pt+' have exactly 0% edge', V(st(pt,[{type:'dontpass',amount:A,odds:A}]), 1, undefined, 'odds'), 0);
  near('Come odds on '+pt+' have exactly 0% edge', V(st(6,[{type:'come',amount:A,number:pt,odds:A}]), 1, 6, 'odds'), 0);
  near('Don\'t Come odds on '+pt+' have exactly 0% edge', V(st(6,[{type:'dontcome',amount:A,number:pt,odds:A}]), 1, 6, 'odds'), 0);
}
// the ledger table the UI shows agrees with the engine for every row
const ledgerCheck = {
  pass:7/495, dontpass:3/220, place68:1/66, place59:1/25, place410:1/15, field:1/36, hard68:1/11, hard410:1/9,
  any7:1/6, anycraps:1/9, yo:1/9, acedeuce:1/9, aces:5/36, boxcars:5/36, odds:0,
  buy410:1/60, buy59:1/50, buy68:1/44
};
Object.keys(ledgerCheck).forEach(k => near('ledger row "'+k+'" matches the derived edge', E.LEDGER_BY_KEY[k].edge, ledgerCheck[k]));
check('every bet type maps to a ledger row', E.TYPES.every(t => E.LEDGER_BY_KEY[E.ledgerKey(t, (t==='place'||t==='buy'||t==='hard')?6:null)]), true);
check('ledger keys: buy grouping', [E.ledgerKey('buy',4), E.ledgerKey('buy',10), E.ledgerKey('buy',5), E.ledgerKey('buy',9), E.ledgerKey('buy',6), E.ledgerKey('buy',8)], ['buy410','buy410','buy59','buy59','buy68','buy68']);
check('ledger is sorted from cheapest to most expensive bet', E.LEDGER.every((r,i) => i===0 || E.LEDGER[i-1].edge <= r.edge), true);
check('ledger keys: place/hard grouping', [E.ledgerKey('place',4), E.ledgerKey('place',9), E.ledgerKey('place',8), E.ledgerKey('hard',10), E.ledgerKey('hard',6), E.ledgerKey('come',null), E.ledgerKey('dontcome',null)], ['place410','place59','place68','hard410','hard68','pass','dontpass']);

console.log('\n=== Buy bets ===');
check('commission: 5% of the bet, never under $1', [1,5,10,19,20,25,40,100,500].map(E.buyVig), [1,1,1,1,1,1,2,5,25]);
check('buy payouts are true odds less the commission', [[20,4],[25,6],[5,5],[100,10],[40,9],[60,8],[1,6]].map(x => E.buyWin(x[0], x[1])), [39, 29, 6, 195, 58, 69, 0]);
{
  const point = 6;
  let t = st(point, [{type:'buy',amount:20,number:4},{type:'buy',amount:100,number:10},{type:'buy',amount:50,number:9}]);
  let r = rollSum(t, 4);
  check('Buy 4 wins: pays $40 less $1 and stays up', [r.events[0].flatNet, r.events[0].credit, r.events[0].vig, r.events[0].removed, r.events[0].ratio, r.state.bets.length], [39, 39, 1, false, [2,1], 3]);
  r = rollSum(t, 10);
  check('Buy 10 for $100 pays $200 less $5', [r.events[0].flatNet, r.events[0].vig], [195, 5]);
  r = rollSum(t, 9);
  check('Buy 9 for $50 pays $75 less $2', [r.events[0].flatNet, r.events[0].vig, r.events[0].ratio], [73, 2, [3,2]]);
  r = rollSum(t, 7);
  check('a 7 loses every Buy bet', [r.events.map(e => e.result), r.events.map(e => e.flatNet), r.events.map(e => e.credit), r.state.bets.length], [['lose','lose','lose'], [-20,-100,-50], [0,0,0], 0]);
  r = rollSum(t, 5);
  check('other numbers leave Buy bets alone', [r.events.length, r.state.bets.length], [0, 3]);
  const off = st(null, [{type:'buy',amount:20,number:4}]);
  check('Buy bets are off on the come-out: the number does nothing', [rollSum(off, 4).events.length, rollSum(off, 4).state.bets.length], [0, 1]);
  check('Buy bets are off on the come-out: a 7 does not take them', [rollSum(off, 7).events.length, rollSum(off, 7).state.bets.length], [0, 1]);
  check('the point can move while a Buy bet is off', [rollSum(off, 4).pointAfter], [4]);
  let u = E.newState();
  check('Buy goes only on the six numbers', [E.canPlace(u,'buy',20,7).ok, E.canPlace(u,'buy',20,2).ok, E.canPlace(u,'buy',20,null).ok, E.canPlace(u,'buy',20,6).ok], [false,false,false,true]);
  let p1 = E.placeBet(u,'buy',20,6); check('placing a Buy bet', [p1.ok, p1.state.bets[0].type, p1.state.bets[0].number], [true,'buy',6]);
  let p2 = E.placeBet(p1.state,'buy',10,6); check('more chips on the same Buy bet join it', [p2.ok, p2.state.bets.length, p2.state.bets[0].amount], [true,1,30]);
  let p3 = E.placeBet(p1.state,'place',30,6); check('a number cannot hold a Place bet and a Buy bet', [p3.ok, /Buy bet on the 6/.test(p3.reason)], [false,true]);
  let q1 = E.placeBet(u,'place',30,6); let q2 = E.placeBet(q1.state,'buy',20,6);
  check('and the other way round', [q2.ok, /Place bet on the 6/.test(q2.reason)], [false,true]);
  let q3 = E.placeBet(q1.state,'buy',20,8); check('a Place 6 and a Buy 8 can sit together', [q3.ok, q3.state.bets.map(b => b.type)], [true,['place','buy']]);
  check('Buy bets can be taken down for the full amount', [E.removeBet(p1.state, 1).refund, E.removeBet(p1.state, 1).ok], [20, true]);
  check('and reduced (Undo)', [E.reduceBet(p2.state, 1, 10).refund, E.reduceBet(p2.state, 1, 10).state.bets[0].amount], [10, 20]);
  check('a state holding both a Place and a Buy on one number is rejected as corrupt', [E.validState(st(6,[{type:'place',amount:30,number:8},{type:'buy',amount:20,number:8}])), E.validState(st(6,[{type:'place',amount:30,number:6},{type:'buy',amount:20,number:8}])), E.validState(st(6,[{type:'buy',amount:20,number:7}])), E.validState(st(6,[{type:'buy',amount:20,number:null}]))], [false,true,false,false]);
}

check('commission equals floor(5%) in exact integer math for every bet from $1 to $5,000', (() => { let bad = 0; for(let a=1;a<=5000;a++){ const want = Math.max(1, Math.floor(a*5/100)); if(E.buyVig(a) !== want) bad++; } return bad; })(), 0);
check('a Buy bet never pays a negative win', (() => { let bad = 0; for(let a=1;a<=500;a++) for(const n of E.POINTS) if(E.buyWin(a,n) < 0) bad++; return bad; })(), 0);

console.log('\n=== payout ratios reported on every win ===');
{
  const R = (state, a, b) => E.resolveRoll(state, a, b).events;
  check('Pass Line pays 1:1 and odds pay true odds (point 4: 2:1)', [R(st(4,[{type:'pass',amount:10,odds:20}]),2,2)[0].ratio, R(st(4,[{type:'pass',amount:10,odds:20}]),2,2)[0].oddsRatio], [[1,1],[2,1]]);
  check('odds ratios by point', [5,6,8,9,10].map(pt => R(st(pt,[{type:'pass',amount:10,odds:10}]), ...(pt===5?[1,4]:pt===6?[1,5]:pt===8?[2,6]:pt===9?[3,6]:[4,6]))[0].oddsRatio), [[3,2],[6,5],[6,5],[3,2],[2,1]]);
  check('lay odds on a seven: Don\'t Pass 1:1, odds pay the reverse (point 4: 1:2)', [R(st(4,[{type:'dontpass',amount:10,odds:20}]),3,4)[0].ratio, R(st(4,[{type:'dontpass',amount:10,odds:20}]),3,4)[0].oddsRatio], [[1,1],[1,2]]);
  check('Place ratios', [4,5,6,8,9,10].map(n => R(st(6,[{type:'place',amount:30,number:n}]), ...(n===4?[1,3]:n===5?[1,4]:n===6?[1,5]:n===8?[2,6]:n===9?[3,6]:[4,6]))[0].ratio), [[9,5],[7,5],[7,6],[7,6],[7,5],[9,5]]);
  check('Hardway ratios', [4,6,8,10].map(n => R(st(5,[{type:'hard',amount:10,number:n}]), n/2, n/2)[0].ratio), [[7,1],[9,1],[9,1],[7,1]]);
  check('Field: 2 pays 2:1, 12 pays 3:1, 3 pays 1:1', [R(st(6,[{type:'field',amount:10}]),1,1)[0].ratio, R(st(6,[{type:'field',amount:10}]),6,6)[0].ratio, R(st(6,[{type:'field',amount:10}]),1,2)[0].ratio], [[2,1],[3,1],[1,1]]);
  check('one-roll bets', [['any7',3,4],['anycraps',1,2],['yo',5,6],['aces',1,1],['boxcars',6,6],['acedeuce',1,2]].map(x => R(st(6,[{type:x[0],amount:10}]), x[1], x[2])[0].ratio), [[4,1],[7,1],[15,1],[30,1],[30,1],[15,1]]);
  check('losing bets carry no ratio', [R(st(6,[{type:'field',amount:10}]),3,3)[0].ratio, R(st(6,[{type:'pass',amount:10,odds:10}]),3,4)[0].oddsRatio], [null, null]);
}

console.log('\n=== money is conserved on every possible roll ===');
// For a spread of table positions, every one of the 36 dice combinations must satisfy:
//   credit - stake that left the felt == the profit the events report   and   felt money after = before - stake out
function conserved(state){
  let bad = 0;
  for(let a=1;a<=6;a++) for(let b=1;b<=6;b++){
    const r = E.resolveRoll(state, a, b);
    let credit = 0, stakeOut = 0, profit = 0;
    r.events.forEach(e => { credit += e.credit; stakeOut += e.removed ? e.stakeOut : 0; profit += e.flatNet + e.oddsNet; });
    if(credit - stakeOut !== profit) bad++;
    if(E.exposure(r.state) !== E.exposure(state) - stakeOut) bad++;
    if(credit !== r.credit || profit !== r.net) bad++;
    if(!E.validState(r.state)) bad++;
  }
  return bad;
}
const fullTable = (pt) => st(pt, [
  {type:'pass',amount:25,odds: pt?50:0},{type:'dontpass',amount:30,odds: pt?60:0},{type:'come',amount:10,number:pt?6:6,odds:30},{type:'dontcome',amount:10,number:9,odds:60},
  {type:'come',amount:15,number:null},{type:'dontcome',amount:15,number:null},
  {type:'place',amount:30,number:6},{type:'place',amount:25,number:5},{type:'place',amount:10,number:10},{type:'buy',amount:20,number:4},{type:'buy',amount:25,number:8},{type:'buy',amount:5,number:9},{type:'field',amount:10},
  {type:'hard',amount:5,number:4},{type:'hard',amount:5,number:6},{type:'any7',amount:5},{type:'anycraps',amount:5},{type:'yo',amount:5},{type:'aces',amount:5},{type:'boxcars',amount:5},{type:'acedeuce',amount:5}
]);
for(const pt of [null,4,5,6,8,9,10]){
  const t = fullTable(pt);
  if(pt===null){ t.bets = t.bets.filter(b => !(b.number===null && (b.type==='come'||b.type==='dontcome'))); }
  if(pt===null){ t.bets.forEach(b => { if(b.type==='pass'||b.type==='dontpass') b.odds = 0; }); }
  check('full table, point '+pt+': all 36 rolls conserve money and leave a valid state', conserved(t), 0);
}

console.log('\n=== fuzz: random play never breaks the books ===');
let seed = 20261010; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
let fuzzBad = 0, rolls = 0, bank = 1000, startMoney = 1000;
let fs = E.newState();
for(let i = 0; i < 4000; i++){
  // random bets
  const k = Math.floor(rnd()*4);
  for(let j=0;j<k;j++){
    const type = E.TYPES[Math.floor(rnd()*E.TYPES.length)];
    const number = (type==='place' || type==='buy') ? E.POINTS[Math.floor(rnd()*6)] : type==='hard' ? E.HARD_NUMBERS[Math.floor(rnd()*4)] : null;
    const amt = [5,10,25][Math.floor(rnd()*3)];
    if(bank >= amt){ const p = E.placeBet(fs, type, amt, number); if(p.ok){ fs = p.state; bank -= amt; } }
  }
  fs.bets.forEach(b => {
    if(rnd() < 0.5){ const room = E.oddsRoom(fs, b); if(room >= 5 && bank >= 5){ const a = E.addOdds(fs, b.id, 5); if(a.ok){ fs = a.state; bank -= 5; } } }
  });
  const before = bank + E.exposure(fs);
  const d1 = 1 + Math.floor(rnd()*6), d2 = 1 + Math.floor(rnd()*6);
  const r = E.resolveRoll(fs, d1, d2); rolls++;
  bank += r.credit; fs = r.state;
  if(!E.validState(fs)) fuzzBad++;
  if(bank + E.exposure(fs) !== before + r.net) fuzzBad++;
  if(bank < 0) fuzzBad++;
  // sometimes sweep the table so the money keeps circulating
  if(bank < 5 && fs.bets.length === 0){ bank = 1000; }
}
check('4000 random rolls: books balance, state always valid, bankroll never negative', fuzzBad, 0);

console.log('\n=== validState rejects junk (so a corrupted save can never crash the table) ===');
const good = st(6, [{type:'pass',amount:10,odds:20},{type:'place',amount:30,number:6}]);
check('a good state validates', E.validState(good), true);
const junk = [null, 'x', {}, {point:7,bets:[],nextId:1,opts:E.defaultOpts()}, {point:null,bets:'no',nextId:1,opts:E.defaultOpts()},
  Object.assign(E.clone(good), {nextId:0}), Object.assign(E.clone(good), {opts:{oddsRule:'99x',field2:2,field12:3}}),
  (()=>{const g=E.clone(good); g.bets[0].amount=-5; return g;})(), (()=>{const g=E.clone(good); g.bets[0].amount=2.5; return g;})(),
  (()=>{const g=E.clone(good); g.bets[1].number=7; return g;})(), (()=>{const g=E.clone(good); g.bets[0].type='horn'; return g;})(),
  (()=>{const g=E.clone(good); g.bets[1].id=g.bets[0].id; return g;})(), (()=>{const g=E.clone(good); g.bets[1].odds=5; return g;})(),
  (()=>{const g=E.clone(good); g.point=null; return g;})(), (()=>{const g=E.clone(good); g.bets[0].odds='20'; return g;})()];
junk.forEach((j, i) => check('junk state #'+(i+1)+' is rejected', E.validState(j), false));

console.log('\n' + (failures ? 'FAILURES: ' + failures + ' (passes ' + passes + ')' : 'ALL ' + passes + ' CHECKS PASSED'));
process.exit(failures ? 1 : 0);
