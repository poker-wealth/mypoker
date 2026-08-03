/* FairPlay Telegram Mini App — lobby. Renders live data from /api/lobby and /api/tables. */

// ── Telegram integration (degrades gracefully in a plain browser) ──────────────
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  // Sync the app to the user's Telegram theme.
  const p = tg.themeParams || {};
  const root = document.documentElement.style;
  if (p.bg_color) root.setProperty('--bg', p.bg_color);
  if (p.secondary_bg_color) root.setProperty('--panel', p.secondary_bg_color);
  if (p.text_color) root.setProperty('--text', p.text_color);
  if (p.hint_color) root.setProperty('--dim', p.hint_color);
  if (p.link_color) root.setProperty('--blue', p.link_color);
}

const usd = (micros) =>
  '$' + (micros / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 0 });
// Precise variant for small amounts like table stakes (keeps $0.50, $2, $20).
const usdExact = (micros) => {
  const v = micros / 1_000_000;
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 2 : 0 });
};
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// ── Lobby ──────────────────────────────────────────────────────────────────────
const ICONS = {
  texas: '♠', 'short-deck': '♦', omaha: '♥', baccarat: '🎴', 'niu-niu': '🐂',
  'dou-di-zhu': '👑', 'san-zhang': '🃏', 'red-packet': '🧧', 'cowboy-beauty': '🤠',
  lottery: '🎟️', slots: '🎰',
};

async function loadLobby() {
  const data = await (await fetch('/api/lobby')).json();

  document.getElementById('grand').textContent = usd(data.grandTicker);
  document.getElementById('fairSub').textContent =
    `${data.provableCount} of ${data.totalGames} games fully provable. Tap to verify any hand.`;

  // A little rotating winner ticker so the hero feels alive.
  const winners = [
    ['Wang', '$2,140', 'Texas'], ['Li', '$860', 'Niu Niu'], ['Chen', '$5,300', 'Lottery'],
    ['Zhao', '$1,020', 'Baccarat'], ['Sun', '$430', 'Red Packet'],
  ];
  let wi = 0;
  const ticker = document.getElementById('ticker');
  const rotate = () => {
    const [who, amt, game] = winners[wi % winners.length];
    ticker.innerHTML = `🟢 ${who} won <b>${amt}</b> · ${game}`;
    wi++;
  };
  rotate();
  setInterval(rotate, 2600);

  const rail = document.getElementById('rail');
  rail.innerHTML = '';
  for (const group of data.groups) {
    const section = document.createElement('div');
    section.className = 'group';
    section.innerHTML = `<div class="group-head">${group.icon} ${esc(group.title)}</div>`;
    for (const g of group.games) section.appendChild(gameRow(g));
    rail.appendChild(section);
  }
}

function gameRow(g) {
  const el = document.createElement('button');
  el.className = 'game' + (g.available ? '' : ' down');

  const badge = !g.available
    ? '<span class="badge down">OFFLINE</span>'
    : g.fairness === 'PROVABLE'
      ? '<span class="badge provable">PROVABLE</span>'
      : '<span class="badge vendor">VENDOR</span>';

  const sub = g.available
    ? `<span class="dot"></span> ${g.players.toLocaleString()} playing · ${g.tables} tables`
    : 'Temporarily unavailable';

  el.innerHTML = `
    <div class="game-icon">${ICONS[g.gameId] || '🎲'}</div>
    <div class="game-main">
      <div class="game-name">${esc(g.name)} ${badge}</div>
      <div class="game-sub">${sub}</div>
    </div>
    <div class="game-jp">
      <div class="amt">${usd(g.jackpot)}</div>
      <div class="ppl">jackpot</div>
    </div>`;
  if (g.available) {
    el.onclick = POKER_GAMES[g.gameId]
      ? () => newHand(POKER_GAMES[g.gameId])
      : g.gameId === 'red-packet'
        ? () => openRedPacket()
        : g.gameId === 'dou-di-zhu'
        ? () => openDdz()
        : BETTING_GAMES[g.gameId]
          ? () => openBetting(g)
          : FAST_GAMES[g.gameId]
            ? () => openFast(g)
            : () => openTables(g);
  }
  return el;
}

// Poker games that open the live table, mapped to their variant.
const POKER_GAMES = { texas: 'texas', omaha: 'omaha', 'short-deck': 'short-deck' };

// ── Fast games (Cowboy & Beauty / Lottery / Slots) ────────────────────────────
const FAST_GAMES = { 'cowboy-beauty': 1, lottery: 1, slots: 1 };
const fastScreen = document.getElementById('fastScreen');
let fastState = { game: null, pick: null, stake: 10_000_000 };

function openFast(g) {
  fastState.game = g.gameId;
  fastState.stake = 10_000_000;
  document.getElementById('fastTitle').textContent = g.name;
  document.getElementById('fastOutcome').textContent = '';
  document.getElementById('fastErr').textContent = '';
  document.getElementById('fastAmt').textContent = '$10';

  const stage = document.getElementById('fastStage');
  const pickWrap = document.getElementById('fastPickWrap');
  const picks = document.getElementById('fastPicks');
  const pickLabel = document.getElementById('fastPickLabel');

  if (g.gameId === 'cowboy-beauty') {
    stage.innerHTML = `<div class="fast-sides">
      <div class="fast-side cowboy"><div class="emoji">🤠</div><div class="who">Cowboy</div></div>
      <div class="fast-side beauty"><div class="emoji">💃</div><div class="who">Beauty</div></div>
    </div>`;
    pickWrap.hidden = false;
    pickLabel.textContent = 'Back a side';
    fastState.pick = 'COWBOY';
    picks.className = 'bet-options';
    picks.innerHTML = `<button data-pick="COWBOY" class="sel">🤠 Cowboy</button><button data-pick="BEAUTY">💃 Beauty</button>`;
  } else if (g.gameId === 'lottery') {
    stage.innerHTML = `<div class="bet-hint">Pick a number 0–4. Match the draw to win the pool.</div>`;
    pickWrap.hidden = false;
    pickLabel.textContent = 'Your number';
    fastState.pick = 0;
    picks.className = 'bet-options pick-num';
    picks.innerHTML = [0, 1, 2, 3, 4].map((n) => `<button data-pick="${n}" class="${n === 0 ? 'sel' : ''}">${n}</button>`).join('');
  } else {
    // slots
    stage.innerHTML = `<div class="reels"><div class="reel">🍒</div><div class="reel">🔔</div><div class="reel">7️⃣</div></div>`;
    pickWrap.hidden = true;
    fastState.pick = null;
  }
  for (const b of picks.querySelectorAll('button')) {
    b.onclick = () => {
      fastState.pick = g.gameId === 'lottery' ? Number(b.dataset.pick) : b.dataset.pick;
      for (const x of picks.querySelectorAll('button')) x.classList.toggle('sel', x === b);
    };
  }

  const stakes = [10, 50, 100];
  document.getElementById('fastStakes').innerHTML = stakes
    .map((v, i) => `<button data-stake="${v}" class="${i === 0 ? 'sel' : ''}">$${v}</button>`)
    .join('');
  for (const b of document.querySelectorAll('#fastStakes button')) {
    b.onclick = () => {
      fastState.stake = Number(b.dataset.stake) * 1_000_000;
      document.getElementById('fastAmt').textContent = '$' + b.dataset.stake;
      for (const x of document.querySelectorAll('#fastStakes button')) x.classList.toggle('sel', x === b);
    };
  }
  fastScreen.classList.add('open');
  if (tg && tg.BackButton) tg.BackButton.show();
}

async function playFast() {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  const body = { amount: fastState.stake };
  if (fastState.game === 'cowboy-beauty') body.side = fastState.pick;
  if (fastState.game === 'lottery') body.pick = fastState.pick;
  const resp = await fetch(`/api/fast/${fastState.game}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const r = await resp.json();
  if (!resp.ok) { document.getElementById('fastErr').textContent = r.error; return; }
  renderFast(r);
}

function renderFast(r) {
  const stage = document.getElementById('fastStage');
  const d = r.detail;
  if (r.game === 'cowboy-beauty') {
    const cw = r.detail.winner === 'COWBOY', bw = r.detail.winner === 'BEAUTY';
    stage.innerHTML = `<div class="fast-sides">
      <div class="fast-side cowboy${cw ? ' win' : ''}">
        <div class="emoji">🤠</div><div class="who">Cowboy</div>
        <div class="odds">${d.oddsCowboy.toFixed(2)}×</div>
        <div class="fast-card">${cardEl(d.cowboyCard)}</div>
      </div>
      <div class="fast-side beauty${bw ? ' win' : ''}">
        <div class="emoji">💃</div><div class="who">Beauty</div>
        <div class="odds">${d.oddsBeauty.toFixed(2)}×</div>
        <div class="fast-card">${cardEl(d.beautyCard)}</div>
      </div>
    </div>`;
  } else if (r.game === 'lottery') {
    stage.innerHTML = `<div class="lotto-result">
      <div class="big">${d.winningNumber}</div>
      <div class="lotto-balls">${[...Array(d.range).keys()]
        .map((n) => `<div class="lotto-ball ${n === d.winningNumber ? 'drawn' : ''} ${n === d.yourNumber ? 'yours' : ''}">${n}</div>`)
        .join('')}</div>
      <div class="hint">Green ring = your pick · Gold = drawn</div>
    </div>`;
  } else {
    const SYM = { CHERRY: '🍒', BELL: '🔔', STAR: '⭐', SEVEN: '7️⃣' };
    stage.innerHTML = `<div class="reels">${d.reels.map((s) => `<div class="reel spin">${SYM[s] || '❔'}</div>`).join('')}</div>`;
  }

  const out = document.getElementById('fastOutcome');
  out.className = 'bet-outcome ' + (r.won ? 'win' : r.youNet < 0 ? 'lose' : '');
  out.textContent = r.won
    ? `${r.outcome} — you win ${usdExact(r.youNet)} 🎉`
    : r.youNet < 0
      ? `${r.outcome} — you lose ${usdExact(-r.youNet)}`
      : `${r.outcome}`;
}

document.getElementById('fastGo').onclick = () => playFast();
document.getElementById('fastBack').onclick = () => {
  fastScreen.classList.remove('open');
  if (tg && tg.BackButton) tg.BackButton.hide();
};

// ── Red Packet Minesweeper ────────────────────────────────────────────────────
const rpScreen = document.getElementById('rpScreen');
let rpState = { roundId: null, cell: null, stake: 10_000_000, revealed: false };

async function openRedPacket() {
  const r = await (await fetch('/api/redpacket/new', { method: 'POST' })).json();
  rpState = { roundId: r.roundId, cell: null, stake: 10_000_000, revealed: false };
  document.getElementById('rpCommitHash').textContent = r.commit;
  document.getElementById('rpOutcome').textContent = '';
  document.getElementById('rpErr').textContent = '';
  document.getElementById('rpHint').textContent =
    `Pick a cell, then reveal. ${r.mineCount} of ${r.size} are mines — a safe cell pays ${r.multiplier}×.`;
  const go = document.getElementById('rpGo');
  go.disabled = true;
  go.textContent = 'Pick a cell first';

  const grid = document.getElementById('rpGrid');
  grid.innerHTML = [...Array(r.size).keys()]
    .map((i) => `<div class="rp-cell" data-cell="${i}">🧧</div>`)
    .join('');
  for (const c of grid.querySelectorAll('.rp-cell')) {
    c.onclick = () => {
      if (rpState.revealed) return;
      rpState.cell = Number(c.dataset.cell);
      for (const x of grid.querySelectorAll('.rp-cell')) x.classList.toggle('picked', x === c);
      go.disabled = false;
      go.innerHTML = 'Reveal · <span>$' + rpState.stake / 1_000_000 + '</span>';
    };
  }

  const stakes = [10, 50, 100];
  document.getElementById('rpStakes').innerHTML = stakes
    .map((v, i) => `<button data-stake="${v}" class="${i === 0 ? 'sel' : ''}">$${v}</button>`)
    .join('');
  for (const b of document.querySelectorAll('#rpStakes button')) {
    b.onclick = () => {
      rpState.stake = Number(b.dataset.stake) * 1_000_000;
      if (rpState.cell !== null) go.innerHTML = 'Reveal · <span>$' + b.dataset.stake + '</span>';
      for (const x of document.querySelectorAll('#rpStakes button')) x.classList.toggle('sel', x === b);
    };
  }

  rpScreen.classList.add('open');
  if (tg && tg.BackButton) tg.BackButton.show();
}

async function revealRedPacket() {
  if (rpState.cell === null || rpState.revealed) return;
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('heavy');
  const resp = await fetch(`/api/redpacket/${rpState.roundId}/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cell: rpState.cell, amount: rpState.stake }),
  });
  const r = await resp.json();
  if (!resp.ok) { document.getElementById('rpErr').textContent = r.error; return; }
  rpState.revealed = true;

  const mineSet = new Set(r.mines);
  for (const c of document.querySelectorAll('#rpGrid .rp-cell')) {
    const idx = Number(c.dataset.cell);
    c.classList.remove('picked');
    if (mineSet.has(idx)) {
      c.textContent = '💣';
      c.classList.add(idx === r.yourCell ? 'your-mine' : 'mine');
    } else {
      c.textContent = '💰';
      c.classList.add('safe');
    }
    if (idx === r.yourCell) c.style.outline = '3px solid ' + (r.hit ? '#ff8a8a' : 'var(--gold)');
  }

  const out = document.getElementById('rpOutcome');
  out.className = 'bet-outcome ' + (r.youNet > 0 ? 'win' : 'lose');
  out.textContent = r.hit
    ? `💥 You hit a mine — lose ${usdExact(-r.youNet)}`
    : `Safe! You win ${usdExact(r.youNet)} 🎉`;

  const go = document.getElementById('rpGo');
  go.textContent = 'Play again';
  go.disabled = false;
  go.onclick = () => openRedPacket();
}

document.getElementById('rpGo').onclick = () => {
  if (rpState.revealed) openRedPacket();
  else revealRedPacket();
};
document.getElementById('rpBack').onclick = () => {
  rpScreen.classList.remove('open');
  if (tg && tg.BackButton) tg.BackButton.hide();
};

// ── Betting games (Baccarat / Niu Niu / San Zhang) ────────────────────────────
const BETTING_GAMES = { baccarat: 1, 'niu-niu': 1, 'san-zhang': 1 };
const betScreen = document.getElementById('betScreen');
let betState = { game: null, side: null, stake: 10_000_000 };

async function openBetting(g) {
  betState.game = g.gameId;
  document.getElementById('betTitle').textContent = g.name;
  document.getElementById('betOutcome').textContent = '';
  document.getElementById('betReveal').innerHTML = '<div class="bet-hint">Place your bet, then deal.</div>';
  document.getElementById('betErr').textContent = '';

  const { betOptions } = await (await fetch(`/api/bet/${g.gameId}/options`)).json();
  betState.side = betOptions[0].id;
  document.getElementById('betOptions').innerHTML = betOptions
    .map((o, i) => `<button data-side="${o.id}" class="${i === 0 ? 'sel' : ''}">${esc(o.label)}</button>`)
    .join('');
  for (const b of document.querySelectorAll('#betOptions button')) {
    b.onclick = () => {
      betState.side = b.dataset.side;
      for (const x of document.querySelectorAll('#betOptions button')) x.classList.toggle('sel', x === b);
    };
  }

  const stakes = [10, 50, 100];
  document.getElementById('betStakes').innerHTML = stakes
    .map((v, i) => `<button data-stake="${v}" class="${i === 0 ? 'sel' : ''}">$${v}</button>`)
    .join('');
  for (const b of document.querySelectorAll('#betStakes button')) {
    b.onclick = () => {
      betState.stake = Number(b.dataset.stake) * 1_000_000;
      document.getElementById('dealAmt').textContent = '$' + b.dataset.stake;
      for (const x of document.querySelectorAll('#betStakes button')) x.classList.toggle('sel', x === b);
    };
  }
  document.getElementById('dealAmt').textContent = '$10';

  betScreen.classList.add('open');
  if (tg && tg.BackButton) tg.BackButton.show();
}

async function deal() {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  document.getElementById('betOutcome').textContent = '';
  const resp = await fetch(`/api/bet/${betState.game}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: betState.stake, side: betState.side }),
  });
  const r = await resp.json();
  if (!resp.ok) { document.getElementById('betErr').textContent = r.error; return; }

  document.getElementById('betBankerPill').textContent = 'Banker: a player';
  document.getElementById('betReveal').innerHTML = r.reveal
    .map((s) => {
      const cls = s.isYou ? ' you' : '';
      const win = s.isBanker && !r.won ? ' win' : s.isYou && r.won ? ' win' : '';
      return `<div class="bet-seat${cls}${win}">
        <div class="bet-seat-label">${esc(s.label)}</div>
        <div class="bet-seat-cards">${s.cards.map((c) => cardEl(c)).join('')}</div>
      </div>`;
    })
    .join('');

  const out = document.getElementById('betOutcome');
  out.className = 'bet-outcome ' + (r.won ? 'win' : r.youNet < 0 ? 'lose' : '');
  out.textContent = r.won
    ? `${r.outcome} — you win ${usdExact(r.youNet)} 🎉`
    : r.youNet < 0
      ? `${r.outcome} — you lose ${usdExact(-r.youNet)}`
      : `${r.outcome} — push`;
}

document.getElementById('dealBtn').onclick = () => deal();
document.getElementById('betBack').onclick = () => {
  betScreen.classList.remove('open');
  if (tg && tg.BackButton) tg.BackButton.hide();
};

// ── Table drawer ─────────────────────────────────────────────────────────────────
const drawer = document.getElementById('drawer');
const scrim = document.getElementById('scrim');

async function openTables(game) {
  document.getElementById('drawerTitle').textContent = game.name;
  const list = document.getElementById('tableList');
  list.innerHTML = '<div class="loading">Loading tables…</div>';
  openDrawer();
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');

  const { tables } = await (await fetch('/api/tables?gameId=' + encodeURIComponent(game.gameId))).json();
  if (!tables.length) {
    list.innerHTML = '<div class="loading">No open tables right now.</div>';
    return;
  }
  list.innerHTML = tables.map(tableRow).join('');
}

function tableRow(t) {
  const label =
    t.status === 'WAITING'
      ? `Waiting for players (${t.waitingFor} more)`
      : `${t.players}/${t.maxPlayers} seated · ${t.seatsFree} free`;
  return `
    <div class="table-row">
      <div class="table-info">
        <div class="stakes">${usdExact(t.stakes)} stakes</div>
        <div class="meta">${label} · jackpot ${usd(t.jackpot)}</div>
      </div>
      <span class="status ${t.status}">${t.status.replace('_', ' ')}</span>
    </div>`;
}

function openDrawer() {
  drawer.classList.add('open');
  scrim.classList.add('open');
  if (tg && tg.BackButton) tg.BackButton.show();
}
function closeDrawer() {
  drawer.classList.remove('open');
  scrim.classList.remove('open');
  if (tg && tg.BackButton) tg.BackButton.hide();
}
document.getElementById('drawerBack').onclick = closeDrawer;
scrim.onclick = closeDrawer;
if (tg && tg.BackButton) tg.BackButton.onClick(closeDrawer);

document.getElementById('fairBanner').onclick = (e) => {
  e.preventDefault();
  const msg = 'Every hand is committed on-chain before the deal and verifiable afterwards. The full verifier opens here.';
  if (tg && tg.showPopup) tg.showPopup({ title: 'Provably Fair', message: msg });
  else alert('Provably Fair — every hand is verifiable on-chain.');
};

// ── Table screen — play a real hand of Texas ──────────────────────────────────
const tableScreen = document.getElementById('tableScreen');
let currentTable = null;

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
function cardEl(card, cls = '') {
  if (!card) return `<div class="card ${cls} back"></div>`;
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1];
  const red = suit === 'h' || suit === 'd' ? ' red' : '';
  return `<div class="card ${cls}${red}">${rank}${SUIT[suit] || ''}</div>`;
}

async function newHand(variant = 'texas') {
  const view = await (
    await fetch('/api/play/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant }),
    })
  ).json();
  currentTable = view.tableId;
  lastVariant = variant;
  document.querySelector('#tableScreen .table-head span:nth-child(2)').textContent =
    `${view.variantName} · $1/$2`;
  document.getElementById('resultSheet').classList.remove('open');
  document.getElementById('verifyOut').innerHTML = '';
  renderTable(view);
  tableScreen.classList.add('open');
  if (tg && tg.BackButton) tg.BackButton.show();
}
let lastVariant = 'texas';

function renderTable(v) {
  document.getElementById('potPill').textContent = 'Pot ' + usdExact(v.pot);
  document.getElementById('youStack').textContent = usdExact(v.you.stack);

  const opps = v.seats.filter((s) => !s.isYou);
  document.getElementById('opponents').innerHTML = opps
    .map((o) => {
      const acting = v.toAct === o.id ? ' acting' : '';
      const cards = v.result
        ? (v.result.showdown.find((s) => s.id === o.id)?.hole || []).map((c) => cardEl(c, 'small')).join('')
        : cardEl(null, 'small') + cardEl(null, 'small');
      return `<div class="opp${acting}">
        <div class="opp-cards">${cards}</div>
        <div class="name">${esc(o.id.replace('bot_', '').replace(/^\w/, (m) => m.toUpperCase()))}</div>
        <div class="stack">${usdExact(o.stack)}</div>
      </div>`;
    })
    .join('');

  const board = document.getElementById('board');
  board.innerHTML = (v.community.length ? v.community : [null, null, null, null, null])
    .map((c) => cardEl(c))
    .join('');

  document.getElementById('hole').innerHTML = (v.you.hole || []).map((c) => cardEl(c)).join('');

  renderActions(v);
  if (v.complete && v.result) showResult(v.result);
}

function renderActions(v) {
  const bar = document.getElementById('actions');
  if (v.complete) { bar.innerHTML = ''; return; }
  if (!v.yourTurn || !v.legal) {
    bar.innerHTML = '<div class="waiting">Waiting for opponents…</div>';
    return;
  }
  const l = v.legal;
  const btns = [];
  if (l.canFold) btns.push(`<button class="act-fold" data-a="fold">Fold</button>`);
  if (l.canCheck) btns.push(`<button class="act-check" data-a="check">Check</button>`);
  if (l.callAmount !== null) btns.push(`<button class="act-call" data-a="call">Call ${usdExact(l.callAmount)}</button>`);
  if (l.minRaiseTo !== null) btns.push(`<button class="act-raise" data-a="raise" data-amt="${l.minRaiseTo}">Raise ${usdExact(l.minRaiseTo)}</button>`);
  bar.innerHTML = btns.join('');
  for (const b of bar.querySelectorAll('button')) {
    b.onclick = () => sendAction(b.dataset.a, b.dataset.amt ? Number(b.dataset.amt) : undefined);
  }
}

async function sendAction(type, amount) {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
  const body = amount !== undefined ? { type, amount } : { type };
  const v = await (
    await fetch(`/api/play/${currentTable}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();
  renderTable(v);
}

function showResult(r) {
  const youNet = (r.payouts.find((p) => p.id === 'you') || {}).net || 0;
  const anyWin = r.payouts.length > 0;
  document.getElementById('resultTitle').textContent = anyWin
    ? youNet > 0
      ? `You won ${usdExact(youNet)} 🎉`
      : `${r.payouts[0].id.replace('bot_', '').replace(/^\w/, (m) => m.toUpperCase())} won the pot`
    : 'Hand complete';

  document.getElementById('resultShowdown').innerHTML = r.showdown
    .map((s) => {
      const won = r.payouts.some((p) => p.id === s.id);
      const name = s.id === 'you' ? 'You' : s.id.replace('bot_', '').replace(/^\w/, (m) => m.toUpperCase());
      return `<div class="sd-row${won ? ' win' : ''}">
        <span>${esc(name)} · ${esc(s.hand)}</span>
        <span class="sd-cards">${s.hole.map((c) => cardEl(c, 'small')).join('')}</span>
      </div>`;
    })
    .join('');

  document.getElementById('verifyBtn').onclick = () => {
    const f = r.fairness;
    document.getElementById('verifyOut').innerHTML = f && f.verified
      ? `<div class="ok">✅ All 6 checks passed — this deal was fixed before the cards and never touched.</div>
         <div style="margin-top:6px">commit <span class="hash">${esc(f.serverCommit)}</span></div>
         <div>revealed seed hashes back to that commit ✓ · future block ${esc(f.futureBlockHash.slice(0, 12))}… · on Merkle root ${esc((f.merkleRoot || '').slice(0, 12))}…</div>`
      : `<div>Verification unavailable.</div>`;
  };
  document.getElementById('resultSheet').classList.add('open');
}

document.getElementById('playCta').onclick = () => newHand('texas');
document.getElementById('againBtn').onclick = () => newHand(lastVariant);
document.getElementById('tableBack').onclick = () => {
  tableScreen.classList.remove('open');
  if (tg && tg.BackButton) tg.BackButton.hide();
};

// ── Wallet ────────────────────────────────────────────────────────────────────
const walletScreen = document.getElementById('walletScreen');
let wallet = null;

async function loadWallet() {
  wallet = await (await fetch('/api/wallet')).json();
  renderWallet();
}

function renderWallet() {
  const b = wallet.balances;
  document.getElementById('walletBalance').textContent = usdExact(b.available);
  document.getElementById('balTotal').textContent = usdExact(wallet.total);
  document.getElementById('balAvail').textContent = usdExact(b.available);
  document.getElementById('balLocked').textContent = usdExact(b.locked);
  document.getElementById('balClearing').textContent = usdExact(b.clearing);
  document.getElementById('depositAddr').textContent = wallet.depositAddress;
  document.getElementById('wdHint').textContent =
    `Available to withdraw: ${usdExact(b.available)}. Funds at a table can't be withdrawn until you leave.`;

  document.getElementById('depositQuick').innerHTML = [50, 100, 500]
    .map((v) => `<button data-amt="${v}">+ $${v}</button>`)
    .join('');
  for (const btn of document.querySelectorAll('#depositQuick button')) {
    btn.onclick = () => deposit(Number(btn.dataset.amt) * 1_000_000);
  }

  const icons = { DEPOSIT: '↓', WITHDRAW: '↑', BUY_IN: '🎲', CASH_OUT: '🏁' };
  document.getElementById('txHistory').innerHTML =
    wallet.history
      .map((t) => {
        const inbound = t.kind === 'DEPOSIT' || t.kind === 'CASH_OUT';
        const pending = t.status === 'PENDING';
        const statusText = pending
          ? `Pending · ${t.confirmations}/20 confirmations`
          : t.status.charAt(0) + t.status.slice(1).toLowerCase();
        return `<div class="tx">
          <div class="tx-main">
            <div class="tx-ic">${icons[t.kind] || '•'}</div>
            <div>
              <div class="tx-kind">${t.kind.replace('_', ' ').toLowerCase().replace(/^\w/, (m) => m.toUpperCase())}</div>
              <div class="tx-status ${pending ? 'tx-pending' : ''}">${esc(statusText)}</div>
            </div>
          </div>
          <div class="tx-amt ${inbound ? 'in' : 'out'}">${inbound ? '+' : '−'}${usdExact(t.amount)}</div>
        </div>`;
      })
      .join('') || '<div class="hint">No activity yet.</div>';
}

async function deposit(amount) {
  if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
  wallet = await (
    await fetch('/api/wallet/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })
  ).json();
  wallet.depositAddress = document.getElementById('depositAddr').textContent;
  renderWallet();
}

async function withdraw(amount) {
  const errEl = document.getElementById('wdErr');
  errEl.textContent = '';
  const resp = await fetch('/api/wallet/withdraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    errEl.textContent = data.error;
    return;
  }
  wallet = data;
  wallet.depositAddress = document.getElementById('depositAddr').textContent;
  document.getElementById('wdAmount').value = '';
  renderWallet();
}

document.getElementById('walletPill').onclick = async () => {
  await loadWallet();
  walletScreen.classList.add('open');
  if (tg && tg.BackButton) tg.BackButton.show();
};
document.getElementById('walletBack').onclick = () => {
  walletScreen.classList.remove('open');
  if (tg && tg.BackButton) tg.BackButton.hide();
};
for (const tab of document.querySelectorAll('.wtab')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('.wtab')) t.classList.toggle('active', t === tab);
    document.getElementById('paneDeposit').hidden = tab.dataset.tab !== 'deposit';
    document.getElementById('paneWithdraw').hidden = tab.dataset.tab !== 'withdraw';
  };
}
document.getElementById('wdSubmit').onclick = () => {
  const val = Number(document.getElementById('wdAmount').value);
  if (val > 0) withdraw(Math.round(val * 1_000_000));
};

loadWallet().catch(() => {});
loadLobby().catch((e) => {
  document.getElementById('rail').innerHTML =
    `<div class="loading">Could not load lobby: ${esc(e.message)}</div>`;
});

// ── Dou Di Zhu (Landlord) ─────────────────────────────────────────────────────
const ddzScreen = document.getElementById('ddzScreen');
let ddz = { id: null, bid: 3, selected: new Set() };

const DDZ_SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
function ddzCardEl(card, selected) {
  if (card === 'js') return `<div class="ddz-card joker" data-c="${card}">JOKER</div>`;
  if (card === 'jb') return `<div class="ddz-card joker" data-c="${card}">JOKER★</div>`;
  const rank = card[0] === 'T' ? '10' : card[0];
  const red = card[1] === 'h' || card[1] === 'd' ? ' red' : '';
  return `<div class="ddz-card${red}${selected ? ' sel' : ''}" data-c="${card}">${rank}${DDZ_SUIT[card[1]] || ''}</div>`;
}

async function openDdz() {
  const v = await (await fetch('/api/ddz/new', { method: 'POST' })).json();
  ddz = { id: v.tableId, bid: 3, selected: new Set() };
  document.getElementById('ddzErr').textContent = '';
  document.getElementById('ddzBidWrap').hidden = false;
  document.getElementById('ddzActions').hidden = true;
  for (const b of document.querySelectorAll('#ddzBids button')) {
    b.onclick = () => {
      ddz.bid = Number(b.dataset.bid);
      for (const x of document.querySelectorAll('#ddzBids button')) x.classList.toggle('sel', x === b);
      submitBid();
    };
  }
  renderDdz(v);
  ddzScreen.classList.add('open');
  if (tg && tg.BackButton) tg.BackButton.show();
}

async function submitBid() {
  const v = await postDdz(`/api/ddz/${ddz.id}/bid`, { points: ddz.bid });
  if (!v) return;
  document.getElementById('ddzBidWrap').hidden = true;
  document.getElementById('ddzActions').hidden = false;
  renderDdz(v);
}

async function postDdz(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await resp.json();
  if (!resp.ok) { document.getElementById('ddzErr').textContent = data.error; return null; }
  document.getElementById('ddzErr').textContent = '';
  return data;
}

function renderDdz(v) {
  document.getElementById('ddzRole').textContent =
    v.landlord === 'you' ? '👑 You are Landlord' : v.landlord ? 'You are a Peasant' : 'Bidding…';

  document.getElementById('ddzOpps').innerHTML = Object.entries(v.handCounts)
    .filter(([id]) => id !== 'you')
    .map(([id, n]) => {
      const name = id.replace('bot_', '').replace(/^\w/, (m) => m.toUpperCase());
      const cls = (v.landlord === id ? ' landlord' : '') + (v.turn === id ? ' turn' : '');
      return `<div class="ddz-opp${cls}"><div class="cnt">${n}</div>${esc(name)}</div>`;
    })
    .join('');

  const tbl = document.getElementById('ddzTable');
  if (v.currentPlay) {
    const who = v.currentPlay.by === 'you' ? 'You played' : esc(v.currentPlay.by.replace('bot_', '') + ' played');
    tbl.innerHTML = `<div class="by">${who}</div>` + v.currentPlay.cards.map((c) => ddzCardEl(c, false)).join('');
  } else if (v.landlord) {
    tbl.innerHTML = `<div class="bet-hint">${v.yourTurn ? 'Your lead — pick cards and play.' : 'Waiting…'}</div>`;
  }

  const handEl = document.getElementById('ddzHand');
  handEl.innerHTML = v.yourHand.map((c) => ddzCardEl(c, ddz.selected.has(c))).join('');
  for (const el of handEl.querySelectorAll('.ddz-card')) {
    el.onclick = () => {
      const c = el.dataset.c;
      if (ddz.selected.has(c)) ddz.selected.delete(c);
      else ddz.selected.add(c);
      el.classList.toggle('sel');
      checkSelection();
    };
  }

  document.getElementById('ddzPlay').disabled = true;
  document.getElementById('ddzPass').disabled = !v.yourTurn;

  if (v.complete) {
    const won = (v.youNet || 0) > 0;
    tbl.innerHTML = `<div class="bet-outcome ${won ? 'win' : 'lose'}">${
      won ? `You win ${usdExact(v.youNet)} 🎉` : `You lose ${usdExact(-(v.youNet || 0))}`
    }</div>`;
    document.getElementById('ddzActions').hidden = true;
    document.getElementById('ddzBidWrap').hidden = false;
  }
}

async function checkSelection() {
  const cards = [...ddz.selected];
  const btn = document.getElementById('ddzPlay');
  if (!cards.length) { btn.disabled = true; btn.textContent = 'Play'; return; }
  const r = await postDdz(`/api/ddz/${ddz.id}/check`, { cards });
  btn.disabled = !(r && r.legal);
  btn.textContent = r && r.legal ? `Play ${cards.length}` : 'Not a legal play';
}

document.getElementById('ddzPlay').onclick = async () => {
  const v = await postDdz(`/api/ddz/${ddz.id}/play`, { cards: [...ddz.selected] });
  if (!v) return;
  ddz.selected.clear();
  renderDdz(v);
};
document.getElementById('ddzPass').onclick = async () => {
  const v = await postDdz(`/api/ddz/${ddz.id}/pass`, {});
  if (!v) return;
  ddz.selected.clear();
  renderDdz(v);
};
document.getElementById('ddzBack').onclick = () => {
  ddzScreen.classList.remove('open');
  if (tg && tg.BackButton) tg.BackButton.hide();
};
