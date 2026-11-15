// ============ CRAPS CORE ENGINE ============
// Pure rules + payouts, no DOM. Standard Las Vegas craps with free odds.
//
// Rules implemented (cross-checked against the Wizard of Odds craps pages and the published house edges):
//   Pass / Don't Pass     come-out 7,11 | 2,3 (12 barred on Don't) ; any other number becomes the point
//   Come / Don't Come     same, but placed after a point exists and travels to its own number
//   Free odds             pay TRUE odds, so the house has no edge on them (4/10 2:1, 5/9 3:2, 6/8 6:5; lay is the reverse)
//   Place 4,5,6,8,9,10    pays 9:5 / 7:5 / 7:6, loses on a 7, OFF (no action) on a come-out roll
//   Buy 4,5,6,8,9,10      pays TRUE odds (2:1 / 3:2 / 6:5) minus a 5% commission (min $1) taken from the win only;
//                         loses on a 7, OFF on a come-out roll. A number can hold a Place bet or a Buy bet, not both.
//   Field                 3,4,9,10,11 pay 1:1, 2 pays 2:1, 12 pays 3:1, 5,6,7,8 lose (one roll)
//   Hardways 4,6,8,10     win if rolled as a pair before a 7 or the "easy way"; 7:1 on 4/10, 9:1 on 6/8; OFF on come-out
//   One-roll props        Any 7 (4:1), Any Craps (7:1), Yo-eleven (15:1), Aces (30:1), Boxcars (30:1), Ace-Deuce (15:1)
// Come/Don't Come odds are OFF on a come-out roll (the standard house default); a 7 on the come-out takes
// the flat part of a Come bet and returns the odds.
// Payouts that don't divide evenly are rounded DOWN to whole dollars, exactly as a casino pays them.
// All money is whole dollars. Placing a bet is the caller's job to deduct; resolveRoll reports exactly
// how much to credit back (`credit`) so the caller's bankroll arithmetic stays trivial.
(function(root, factory){
  if(typeof module === 'object' && module.exports){ module.exports = factory(); }
  else { root.CrapsEngine = factory(); }
})(typeof self !== 'undefined' ? self : this, function(){
'use strict';

var POINTS = [4,5,6,8,9,10];
var HARD_NUMBERS = [4,6,8,10];
var TYPES = ['pass','dontpass','come','dontcome','place','buy','field','hard','any7','anycraps','yo','aces','boxcars','acedeuce'];
var ONE_ROLL = ['field','any7','anycraps','yo','aces','boxcars','acedeuce'];

// Ways to roll each total with two dice (out of 36).
var WAYS = {2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1};

var PLACE_PAY = {4:[9,5],10:[9,5],5:[7,5],9:[7,5],6:[7,6],8:[7,6]};           // win = amount * a / b
var ODDS_PAY  = {4:[2,1],10:[2,1],5:[3,2],9:[3,2],6:[6,5],8:[6,5]};          // true odds on the point
var LAY_PAY   = {4:[1,2],10:[1,2],5:[2,3],9:[2,3],6:[5,6],8:[5,6]};          // lay (against) is the reverse
var HARD_PAY  = {4:7,10:7,6:9,8:9};
var PROP_PAY  = {any7:4, anycraps:7, yo:15, aces:30, boxcars:30, acedeuce:15};

// Max free odds as a multiple of the flat bet, by the table's odds rule.
var ODDS_RULES = {
  '1x':  {label:'1x odds',          mult:{4:1,5:1,6:1,8:1,9:1,10:1}},
  '2x':  {label:'2x odds',          mult:{4:2,5:2,6:2,8:2,9:2,10:2}},
  '345': {label:'3-4-5x odds',      mult:{4:3,10:3,5:4,9:4,6:5,8:5}},
  '5x':  {label:'5x odds',          mult:{4:5,5:5,6:5,8:5,9:5,10:5}},
  '10x': {label:'10x odds',         mult:{4:10,5:10,6:10,8:10,9:10,10:10}}
};

// House edge per resolved bet (fractions). These are the textbook values, and the tests re-derive every one
// of them by running this engine through all 36 dice combinations.
var LEDGER = [
  {key:'odds',     label:'Free odds',         edge:0,           blurb:'Pays true odds, so the casino has no edge at all.'},
  {key:'dontpass', label:"Don't Pass / Don't Come", edge:3/220,  blurb:'You are betting against the shooter; the barred 12 is the casino\'s only edge.'},
  {key:'pass',     label:'Pass Line / Come', edge:7/495,        blurb:'The best flat bet that does not need odds.'},
  {key:'place68',  label:'Place 6 or 8',      edge:1/66,        blurb:'Cheapest place bet. Bet in multiples of $6 so the 7:6 payout is not rounded down.'},
  {key:'buy410',   label:'Buy 4 or 10',       edge:1/60,        blurb:'True odds (2:1) minus a 5% commission on wins. Far cheaper than a Place 4 or 10. Figures assume $20 steps ($1 commission per $20).'},
  {key:'buy59',    label:'Buy 5 or 9',        edge:1/50,        blurb:'True odds (3:2) minus a 5% commission on wins. Cheaper than Place 5 or 9. Figures assume $20 steps.'},
  {key:'buy68',    label:'Buy 6 or 8',        edge:1/44,        blurb:'Costs more than a Place 6 or 8 because of the commission. Place these instead.'},
  {key:'field',    label:'Field',             edge:1/36,        blurb:'One roll. Wins on 2,3,4,9,10,11,12 (12 pays 3:1) but loses on the most common totals.'},
  {key:'place59',  label:'Place 5 or 9',      edge:1/25,        blurb:'Pays 7:5 on a number that rolls less often than a 6 or 8.'},
  {key:'place410', label:'Place 4 or 10',     edge:1/15,        blurb:'Pays 9:5 while the true odds are 2:1. An expensive way to bet the hardest numbers.'},
  {key:'hard68',   label:'Hard 6 or 8',       edge:1/11,        blurb:'Needs a pair before any 7 or the easy way.'},
  {key:'anycraps', label:'Any Craps',         edge:1/9,         blurb:'One roll. Pays 7:1 on a 2, 3 or 12.'},
  {key:'hard410',  label:'Hard 4 or 10',      edge:1/9,         blurb:'Pays 7:1 but is beaten by 8 of every 9 resolving rolls.'},
  {key:'yo',       label:'Yo (11)',           edge:1/9,         blurb:'One roll. Pays 15:1 when the true odds are 17:1.'},
  {key:'acedeuce', label:'Ace-Deuce (3)',     edge:1/9,         blurb:'One roll. Pays 15:1 when the true odds are 17:1.'},
  {key:'aces',     label:'Aces (2)',          edge:5/36,        blurb:'One roll. Pays 30:1 when the true odds are 35:1.'},
  {key:'boxcars',  label:'Boxcars (12)',      edge:5/36,        blurb:'One roll. Pays 30:1 when the true odds are 35:1.'},
  {key:'any7',     label:'Any Seven',         edge:1/6,         blurb:'The single worst bet on the table. Pays 4:1 when the true odds are 5:1.'}
];
var LEDGER_BY_KEY = {};
LEDGER.forEach(function(r){ LEDGER_BY_KEY[r.key] = r; });

function ledgerKey(type, number){
  if(type==='pass' || type==='come') return 'pass';
  if(type==='dontpass' || type==='dontcome') return 'dontpass';
  if(type==='place') return (number===6||number===8) ? 'place68' : (number===5||number===9) ? 'place59' : 'place410';
  if(type==='buy') return (number===6||number===8) ? 'buy68' : (number===5||number===9) ? 'buy59' : 'buy410';
  if(type==='hard') return (number===6||number===8) ? 'hard68' : 'hard410';
  return type; // field, any7, anycraps, yo, aces, boxcars, acedeuce
}

var BET_LABEL = {
  pass:'Pass Line', dontpass:"Don't Pass", come:'Come', dontcome:"Don't Come", place:'Place', buy:'Buy', field:'Field',
  hard:'Hardway', any7:'Any Seven', anycraps:'Any Craps', yo:'Yo (11)', aces:'Aces', boxcars:'Boxcars', acedeuce:'Ace-Deuce'
};

function defaultOpts(){
  return { oddsRule:'345', comeOddsWork:false, placeWork:false, hardWork:false, field2:2, field12:3 };
}
function newState(opts){
  var o = defaultOpts();
  if(opts) Object.keys(opts).forEach(function(k){ o[k] = opts[k]; });
  return { point:null, bets:[], nextId:1, opts:o };
}
function clone(x){ return JSON.parse(JSON.stringify(x)); }

function isInt(n){ return typeof n==='number' && isFinite(n) && Math.floor(n)===n; }

// Buy-bet commission: 5% of the bet (whole dollars, never less than $1), taken from a winning payout only.
var BUY_VIG_RATE = 0.05;      // $1 for every $20 bet; integer math keeps the rounding exact
function buyVig(amount){ return Math.max(1, Math.floor(amount / 20)); }
function buyWin(amount, number){ return Math.max(0, Math.floor(amount * ODDS_PAY[number][0] / ODDS_PAY[number][1]) - buyVig(amount)); }
function hasBetAt(state, type, number){
  for(var i=0;i<state.bets.length;i++){ if(state.bets[i].type===type && state.bets[i].number===number) return true; }
  return false;
}

function findBet(state, id){
  for(var i=0;i<state.bets.length;i++){ if(state.bets[i].id===id) return state.bets[i]; }
  return null;
}
function exposure(state){
  var t = 0;
  state.bets.forEach(function(b){ t += b.amount + (b.odds||0); });
  return t;
}

// ---------- placing ----------
function canPlace(state, type, amount, number){
  if(TYPES.indexOf(type) < 0) return {ok:false, reason:'Unknown bet.'};
  if(!isInt(amount) || amount < 1) return {ok:false, reason:'Pick a chip first.'};
  if((type==='pass' || type==='dontpass') && state.point !== null) return {ok:false, reason:'Pass and Don\'t Pass bets can only be made on a come-out roll.'};
  if((type==='come' || type==='dontcome') && state.point === null) return {ok:false, reason:'Come bets need a point. Make a Pass Line bet and roll first.'};
  if(type==='place' && POINTS.indexOf(number) < 0) return {ok:false, reason:'Place bets go on 4, 5, 6, 8, 9 or 10.'};
  if(type==='buy' && POINTS.indexOf(number) < 0) return {ok:false, reason:'Buy bets go on 4, 5, 6, 8, 9 or 10.'};
  if(type==='hard' && HARD_NUMBERS.indexOf(number) < 0) return {ok:false, reason:'Hardways are 4, 6, 8 and 10.'};
  if(type==='place' && hasBetAt(state, 'buy', number)) return {ok:false, reason:'You have a Buy bet on the '+number+'. Take it down to switch to Place.'};
  if(type==='buy' && hasBetAt(state, 'place', number)) return {ok:false, reason:'You have a Place bet on the '+number+'. Take it down to switch to Buy.'};
  return {ok:true};
}

function sameSpot(b, type, number){
  if(b.type !== type) return false;
  if(type==='place' || type==='buy' || type==='hard') return b.number === number;
  if(type==='come' || type==='dontcome') return b.number === null; // only the not-yet-traveled one
  return true;
}

function placeBet(state, type, amount, number){
  var chk = canPlace(state, type, amount, number);
  if(!chk.ok) return {ok:false, reason:chk.reason, state:state};
  var s = clone(state);
  var num = (type==='place' || type==='buy' || type==='hard') ? number : null;
  for(var i=0;i<s.bets.length;i++){
    if(sameSpot(s.bets[i], type, num)){ s.bets[i].amount += amount; return {ok:true, state:s, betId:s.bets[i].id}; }
  }
  var bet = {id:s.nextId++, type:type, amount:amount, number:num, odds:0};
  s.bets.push(bet);
  return {ok:true, state:s, betId:bet.id};
}

// ---------- odds ----------
function oddsBase(state, bet){
  if(bet.type==='pass' || bet.type==='dontpass') return state.point;
  if(bet.type==='come' || bet.type==='dontcome') return bet.number;
  return null;
}
function oddsRule(state){ return ODDS_RULES[state.opts.oddsRule] || ODDS_RULES['345']; }
// Largest odds amount allowed behind this bet (0 if odds are not possible yet).
function maxOdds(state, bet){
  var base = oddsBase(state, bet);
  if(base === null || POINTS.indexOf(base) < 0) return 0;
  var mult = oddsRule(state).mult[base];
  if(bet.type==='pass' || bet.type==='come') return bet.amount * mult;
  if(bet.type==='dontpass' || bet.type==='dontcome'){
    // lay: the amount you can WIN is capped at mult x flat, so the amount you lay is win / lay-ratio
    var r = LAY_PAY[base]; // win = lay * r0 / r1
    return Math.floor(bet.amount * mult * r[1] / r[0]);
  }
  return 0;
}
function oddsRoom(state, bet){ return Math.max(0, maxOdds(state, bet) - (bet.odds||0)); }

function canAddOdds(state, betId, amount){
  var bet = findBet(state, betId);
  if(!bet) return {ok:false, reason:'No such bet.'};
  if(!isInt(amount) || amount < 1) return {ok:false, reason:'Pick a chip first.'};
  var base = oddsBase(state, bet);
  if(base === null || POINTS.indexOf(base) < 0){
    return {ok:false, reason: (bet.type==='pass'||bet.type==='dontpass') ? 'Odds open once a point is set.' : 'Odds open once this bet has traveled to a number.'};
  }
  if(amount > oddsRoom(state, bet)) return {ok:false, reason:'That is over the table\'s odds limit ('+oddsRule(state).label+').'};
  return {ok:true};
}
function addOdds(state, betId, amount){
  var chk = canAddOdds(state, betId, amount);
  if(!chk.ok) return {ok:false, reason:chk.reason, state:state};
  var s = clone(state);
  findBet(s, betId).odds += amount;
  return {ok:true, state:s};
}

// ---------- taking down ----------
function canRemove(state, bet){
  if(bet.type==='pass') return state.point === null;                 // the Pass Line is locked in once a point is set
  if(bet.type==='come') return bet.number === null;                  // a Come bet on a number is locked in
  return true;
}
function removeBet(state, betId){
  var bet = findBet(state, betId);
  if(!bet) return {ok:false, reason:'No such bet.', state:state};
  if(!canRemove(state, bet)) return {ok:false, reason:'That bet is locked in until it is decided.', state:state};
  var s = clone(state);
  s.bets = s.bets.filter(function(b){ return b.id !== betId; });
  return {ok:true, state:s, refund:bet.amount + (bet.odds||0)};
}
// Take back part of a bet (used by Undo). Never leaves odds above what the smaller bet allows.
function reduceBet(state, betId, amount){
  var bet = findBet(state, betId);
  if(!bet) return {ok:false, reason:'No such bet.', state:state};
  if(!isInt(amount) || amount < 1 || amount > bet.amount) return {ok:false, reason:'That is more than is on the bet.', state:state};
  if(!canRemove(state, bet)) return {ok:false, reason:'That bet is locked in until it is decided.', state:state};
  var s = clone(state);
  var b = findBet(s, betId);
  b.amount -= amount;
  if(b.amount === 0){
    if(b.odds > 0) return {ok:false, reason:'Take the odds down first.', state:state};
    s.bets = s.bets.filter(function(x){ return x.id !== betId; });
  } else if(b.odds > maxOdds(s, b)){
    return {ok:false, reason:'Take the odds down first.', state:state};
  }
  return {ok:true, state:s, refund:amount};
}
function reduceOdds(state, betId, amount){
  var bet = findBet(state, betId);
  if(!bet || !(bet.odds > 0)) return {ok:false, reason:'No odds on that bet.', state:state};
  if(!isInt(amount) || amount < 1 || amount > bet.odds) return {ok:false, reason:'That is more than the odds on the bet.', state:state};
  var s = clone(state);
  findBet(s, betId).odds -= amount;
  return {ok:true, state:s, refund:amount};
}
function removeOdds(state, betId){
  var bet = findBet(state, betId);
  if(!bet || !(bet.odds > 0)) return {ok:false, reason:'No odds on that bet.', state:state};
  var s = clone(state);
  var b = findBet(s, betId);
  var refund = b.odds; b.odds = 0;
  return {ok:true, state:s, refund:refund};
}

// ---------- payouts ----------
function mulDown(amount, pair){ return Math.floor(amount * pair[0] / pair[1]); }
function oddsWinFor(bet, base){
  if(!(bet.odds > 0)) return 0;
  if(bet.type==='pass' || bet.type==='come') return mulDown(bet.odds, ODDS_PAY[base]);
  return mulDown(bet.odds, LAY_PAY[base]);
}

// ---------- the roll ----------
function resolveRoll(state, d1, d2){
  var s = d1 + d2, hard = (d1 === d2);
  var pb = state.point;
  var comeOut = (pb === null);
  var o = state.opts;
  var comeOddsOn = !comeOut || !!o.comeOddsWork;
  var placeOn = !comeOut || !!o.placeWork;
  var hardOn = !comeOut || !!o.hardWork;

  var next = clone(state);
  var events = [];
  var keep = [];

  function ev(bet, flat, oddsMode, extra){
    // flat: 'win' | 'lose' | 'push' ; oddsMode: 'win' | 'lose' | 'return' | 'none'
    var winFlat = extra && typeof extra.winFlat === 'number' ? extra.winFlat : bet.amount; // even money unless stated
    var oddsAmt = bet.odds || 0;
    var oddsWin = 0;
    if(oddsMode === 'win') oddsWin = oddsWinFor(bet, extra.oddsBase);
    var ratio = flat==='win' ? ((extra && extra.ratio) || [1,1]) : null;
    var oddsRatio = null;
    if(oddsMode === 'win') oddsRatio = (bet.type==='pass' || bet.type==='come') ? ODDS_PAY[extra.oddsBase] : LAY_PAY[extra.oddsBase];
    var credit = (flat==='win' ? bet.amount + winFlat : flat==='push' ? bet.amount : 0) +
                 (oddsMode==='win' ? oddsAmt + oddsWin : oddsMode==='return' ? oddsAmt : 0);
    var e = {
      betId:bet.id, type:bet.type, number:bet.number, amount:bet.amount, odds:oddsAmt,
      result:flat, removed:true, resolved:true,
      flatNet: flat==='win' ? winFlat : flat==='lose' ? -bet.amount : 0,
      oddsNet: oddsMode==='win' ? oddsWin : oddsMode==='lose' ? -oddsAmt : 0,
      oddsMode: oddsMode,
      ratio: ratio, oddsRatio: oddsRatio, vig: 0,
      credit: credit,
      stakeOut: bet.amount + oddsAmt
    };
    events.push(e);
    return e;
  }
  function stays(bet, win, ratio, vig){   // a win that is paid while the bet stays up (place / buy / hardway)
    events.push({
      betId:bet.id, type:bet.type, number:bet.number, amount:bet.amount, odds:0,
      result:'win', removed:false, resolved:true,
      flatNet:win, oddsNet:0, oddsMode:'none', ratio:ratio||null, oddsRatio:null, vig:vig||0, credit:win, stakeOut:0
    });
    keep.push(bet);
  }
  function moves(bet, newNumber, result){   // not decided; reported so the UI can animate it
    events.push({
      betId:bet.id, type:bet.type, number:newNumber, amount:bet.amount, odds:bet.odds||0,
      result:result, removed:false, resolved:false,
      flatNet:0, oddsNet:0, oddsMode:'none', ratio:null, oddsRatio:null, vig:0, credit:0, stakeOut:0
    });
  }

  var i, bet;
  for(i = 0; i < next.bets.length; i++){
    bet = next.bets[i];
    var t = bet.type;

    if(t === 'pass'){
      if(comeOut){
        if(s===7 || s===11) ev(bet,'win','none');
        else if(s===2 || s===3 || s===12) ev(bet,'lose','none');
        else { moves(bet, bet.number, 'point'); keep.push(bet); }
      } else {
        if(s === pb) ev(bet,'win','win',{oddsBase:pb});
        else if(s === 7) ev(bet,'lose','lose');
        else keep.push(bet);
      }
    }
    else if(t === 'dontpass'){
      if(comeOut){
        if(s===2 || s===3) ev(bet,'win','none');
        else if(s===7 || s===11) ev(bet,'lose','none');
        else if(s===12) ev(bet,'push','none');
        else { moves(bet, bet.number, 'point'); keep.push(bet); }
      } else {
        if(s === 7) ev(bet,'win','win',{oddsBase:pb});
        else if(s === pb) ev(bet,'lose','lose');
        else keep.push(bet);
      }
    }
    else if(t === 'come'){
      if(bet.number === null){
        if(s===7 || s===11) ev(bet,'win','none');
        else if(s===2 || s===3 || s===12) ev(bet,'lose','none');
        else { bet.number = s; moves(bet, s, 'travel'); keep.push(bet); }
      } else {
        if(s === bet.number) ev(bet,'win', comeOddsOn ? 'win' : 'return', {oddsBase:bet.number});
        else if(s === 7) ev(bet,'lose', comeOddsOn ? 'lose' : 'return');
        else keep.push(bet);
      }
    }
    else if(t === 'dontcome'){
      if(bet.number === null){
        if(s===2 || s===3) ev(bet,'win','none');
        else if(s===7 || s===11) ev(bet,'lose','none');
        else if(s===12) ev(bet,'push','none');
        else { bet.number = s; moves(bet, s, 'travel'); keep.push(bet); }
      } else {
        if(s === 7) ev(bet,'win', comeOddsOn ? 'win' : 'return', {oddsBase:bet.number});
        else if(s === bet.number) ev(bet,'lose', comeOddsOn ? 'lose' : 'return');
        else keep.push(bet);
      }
    }
    else if(t === 'place'){
      if(!placeOn) keep.push(bet);
      else if(s === bet.number) stays(bet, mulDown(bet.amount, PLACE_PAY[bet.number]), PLACE_PAY[bet.number]);
      else if(s === 7) ev(bet,'lose','none');
      else keep.push(bet);
    }
    else if(t === 'buy'){
      if(!placeOn) keep.push(bet);
      else if(s === bet.number) stays(bet, buyWin(bet.amount, bet.number), ODDS_PAY[bet.number], buyVig(bet.amount));
      else if(s === 7) ev(bet,'lose','none');
      else keep.push(bet);
    }
    else if(t === 'hard'){
      if(!hardOn) keep.push(bet);
      else if(s === bet.number){
        if(hard) stays(bet, bet.amount * HARD_PAY[bet.number], [HARD_PAY[bet.number],1]);
        else ev(bet,'lose','none');
      }
      else if(s === 7) ev(bet,'lose','none');
      else keep.push(bet);
    }
    else if(t === 'field'){
      if(s===2) ev(bet,'win','none',{winFlat:bet.amount * o.field2, ratio:[o.field2,1]});
      else if(s===12) ev(bet,'win','none',{winFlat:bet.amount * o.field12, ratio:[o.field12,1]});
      else if(s===3 || s===4 || s===9 || s===10 || s===11) ev(bet,'win','none');
      else ev(bet,'lose','none');
    }
    else if(t === 'any7'){ if(s===7) ev(bet,'win','none',{winFlat:bet.amount*PROP_PAY.any7, ratio:[PROP_PAY.any7,1]}); else ev(bet,'lose','none'); }
    else if(t === 'anycraps'){ if(s===2||s===3||s===12) ev(bet,'win','none',{winFlat:bet.amount*PROP_PAY.anycraps, ratio:[PROP_PAY.anycraps,1]}); else ev(bet,'lose','none'); }
    else if(t === 'yo'){ if(s===11) ev(bet,'win','none',{winFlat:bet.amount*PROP_PAY.yo, ratio:[PROP_PAY.yo,1]}); else ev(bet,'lose','none'); }
    else if(t === 'aces'){ if(s===2) ev(bet,'win','none',{winFlat:bet.amount*PROP_PAY.aces, ratio:[PROP_PAY.aces,1]}); else ev(bet,'lose','none'); }
    else if(t === 'boxcars'){ if(s===12) ev(bet,'win','none',{winFlat:bet.amount*PROP_PAY.boxcars, ratio:[PROP_PAY.boxcars,1]}); else ev(bet,'lose','none'); }
    else if(t === 'acedeuce'){ if(s===3) ev(bet,'win','none',{winFlat:bet.amount*PROP_PAY.acedeuce, ratio:[PROP_PAY.acedeuce,1]}); else ev(bet,'lose','none'); }
    else { keep.push(bet); }
  }

  // (A new Come bet can never travel onto a number that still holds an older Come bet: the roll that
  // sends it there is the roll that pays the old one, so no two bets ever share a number.)
  next.bets = keep;

  var pointEstablished = comeOut && POINTS.indexOf(s) >= 0;
  var pointMade = !comeOut && s === pb;
  var sevenOut = !comeOut && s === 7;
  next.point = comeOut ? (pointEstablished ? s : null) : ((pointMade || sevenOut) ? null : pb);

  var credit = 0, net = 0;
  events.forEach(function(e){ credit += e.credit; net += e.flatNet + e.oddsNet; });

  return {
    state: next, events: events, sum: s, hard: hard, d1: d1, d2: d2,
    pointBefore: pb, pointAfter: next.point,
    comeOut: comeOut, pointEstablished: pointEstablished, pointMade: pointMade, sevenOut: sevenOut,
    natural: comeOut && (s===7 || s===11), craps: comeOut && (s===2 || s===3 || s===12),
    credit: credit, net: net
  };
}

// ---------- persistence safety ----------
function validState(st){
  try{
    if(!st || typeof st !== 'object') return false;
    if(!(st.point === null || POINTS.indexOf(st.point) >= 0)) return false;
    if(!Array.isArray(st.bets) || !isInt(st.nextId) || st.nextId < 1) return false;
    if(!st.opts || !ODDS_RULES[st.opts.oddsRule]) return false;
    if(!isInt(st.opts.field2) || !isInt(st.opts.field12)) return false;
    var ids = {}, spots = {};
    for(var i=0;i<st.bets.length;i++){
      var b = st.bets[i];
      if(!b || TYPES.indexOf(b.type) < 0) return false;
      if(!isInt(b.id) || ids[b.id] || b.id >= st.nextId) return false;
      ids[b.id] = true;
      if(b.type==='place' || b.type==='buy'){ var other = b.type==='place' ? 'buy' : 'place'; if(spots[other+b.number]) return false; spots[b.type+b.number] = true; }
      if(!isInt(b.amount) || b.amount < 1) return false;
      if(!isInt(b.odds) || b.odds < 0) return false;
      if(b.type==='place' || b.type==='buy'){ if(POINTS.indexOf(b.number) < 0) return false; }
      else if(b.type==='hard'){ if(HARD_NUMBERS.indexOf(b.number) < 0) return false; }
      else if(b.type==='come' || b.type==='dontcome'){ if(!(b.number === null || POINTS.indexOf(b.number) >= 0)) return false; }
      else { if(b.number !== null) return false; }
      if(b.odds > 0){
        if(!(b.type==='pass' || b.type==='dontpass' || b.type==='come' || b.type==='dontcome')) return false;
        if((b.type==='pass' || b.type==='dontpass') && st.point === null) return false;
        if((b.type==='come' || b.type==='dontcome') && b.number === null) return false;
      }
    }
    return true;
  }catch(e){ return false; }
}

return {
  POINTS:POINTS, HARD_NUMBERS:HARD_NUMBERS, TYPES:TYPES, ONE_ROLL:ONE_ROLL, WAYS:WAYS,
  PLACE_PAY:PLACE_PAY, ODDS_PAY:ODDS_PAY, LAY_PAY:LAY_PAY, HARD_PAY:HARD_PAY, PROP_PAY:PROP_PAY,
  ODDS_RULES:ODDS_RULES, LEDGER:LEDGER, LEDGER_BY_KEY:LEDGER_BY_KEY, BET_LABEL:BET_LABEL,
  BUY_VIG_RATE:BUY_VIG_RATE, buyVig:buyVig, buyWin:buyWin, hasBetAt:hasBetAt,
  ledgerKey:ledgerKey, newState:newState, defaultOpts:defaultOpts, clone:clone,
  findBet:findBet, exposure:exposure,
  canPlace:canPlace, placeBet:placeBet,
  maxOdds:maxOdds, oddsRoom:oddsRoom, canAddOdds:canAddOdds, addOdds:addOdds,
  canRemove:canRemove, removeBet:removeBet, removeOdds:removeOdds, reduceBet:reduceBet, reduceOdds:reduceOdds,
  resolveRoll:resolveRoll, validState:validState
};
});
