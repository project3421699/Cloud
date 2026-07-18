/* =========================================================
   Chessmaster — user vs bot
   - chess.js  : rules + move generation
   - chessboard.js : UI
   - Custom negamax for levels 0-4
   - Stockfish (via Web Worker) for level 5 (Grandmaster)
   ========================================================= */

const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

/* Piece-square tables (white perspective, board[0] = rank 8). */
const PST = {
  p: [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [ 5,  5, 10, 25, 25, 10,  5,  5],
    [ 0,  0,  0, 20, 20,  0,  0,  0],
    [ 5, -5,-10,  0,  0,-10, -5,  5],
    [ 5, 10, 10,-20,-20, 10, 10,  5],
    [ 0,  0,  0,  0,  0,  0,  0,  0]
  ],
  n: [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
  ],
  b: [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
  ],
  r: [
    [ 0,  0,  0,  0,  0,  0,  0,  0],
    [ 5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [ 0,  0,  0,  5,  5,  0,  0,  0]
  ],
  q: [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [ -5,  0,  5,  5,  5,  5,  0, -5],
    [  0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
  ],
  k: [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [ 20, 20,  0,  0,  0,  0, 20, 20],
    [ 20, 30, 10,  0,  0, 10, 30, 20]
  ]
};

const MATE = 100000;

/* Evaluate from the perspective of the side to move. */
function evaluate(game) {
  const board = game.board();
  let white = 0, black = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const val = PIECE_VALUE[piece.type];
      const pst = PST[piece.type][piece.color === 'w' ? r : 7 - r][c];
      if (piece.color === 'w') white += val + pst;
      else black += val + pst;
    }
  }
  const score = white - black;
  return game.turn() === 'w' ? score : -score;
}

/* MVV-LVA move ordering: captures first, biggest victim first. */
function orderMoves(moves) {
  return moves.sort((a, b) => {
    const av = a.captured ? PIECE_VALUE[a.captured] - PIECE_VALUE[a.piece] / 10 : 0;
    const bv = b.captured ? PIECE_VALUE[b.captured] - PIECE_VALUE[b.piece] / 10 : 0;
    return bv - av;
  });
}

function negamax(game, depth, alpha, beta) {
  if (depth === 0) return evaluate(game);

  const moves = orderMoves(game.moves({ verbose: true }));
  if (moves.length === 0) {
    if (game.in_checkmate()) return -MATE + (10 - depth); // prefer faster mates
    return 0; // stalemate / draw
  }

  let best = -Infinity;
  for (const move of moves) {
    game.move(move);
    const score = -negamax(game, depth - 1, -beta, -alpha);
    game.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/* Pick best move at a given search depth. */
function bestMoveAtDepth(game, depth) {
  const moves = orderMoves(game.moves({ verbose: true }));
  if (moves.length === 0) return null;

  let bestMove = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;

  for (const move of moves) {
    game.move(move);
    const score = -negamax(game, depth - 1, -Infinity, -alpha);
    game.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
  }
  return bestMove;
}

/* =========================================================
   Stockfish Integration (for Grandmaster level)
   ========================================================= */

// Stockfish worker instance
let sfWorker = null;
let sfReady = false;
let sfPendingMove = null;
let sfResolveMove = null;

// Initialise the Stockfish worker (async)
function initStockfish() {
  if (sfWorker) return Promise.resolve();
  return new Promise((resolve) => {
    // Use CDN version of Stockfish 15.1 (lite single-threaded ~7MB)
    sfWorker = new Worker('https://cdn.jsdelivr.net/npm/stockfish@15.1/build/lightweight/stockfish.js');
    sfWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg === 'readyok') {
        sfReady = true;
        resolve();
      } else if (msg.startsWith('bestmove')) {
        const move = msg.split(' ')[1];
        if (sfResolveMove) {
          sfResolveMove(move);
          sfResolveMove = null;
          sfPendingMove = null;
        }
      }
    };
    // Hand-shake
    sfWorker.postMessage('uci');
    sfWorker.postMessage('isready');
  });
}

// Ask Stockfish for best move at given depth
function stockfishBestMove(fen, depth = 20) {
  return new Promise((resolve) => {
    sfResolveMove = resolve;
    sfWorker.postMessage(`position fen ${fen}`);
    sfWorker.postMessage(`go depth ${depth}`);
    // Timeout fallback (in case worker hangs)
    setTimeout(() => {
      if (sfResolveMove === resolve) {
        sfResolveMove = null;
        resolve(null);
      }
    }, 5000);
  });
}

/* Map level -> { depth, randomChance, label, useStockfish } */
const LEVELS = {
  0: { depth: 0, random: 1.0,  label: 'Pawn — Random', useStockfish: false },
  1: { depth: 1, random: 0.5,  label: 'Knight — Depth 1', useStockfish: false },
  2: { depth: 2, random: 0.25, label: 'Bishop — Depth 2', useStockfish: false },
  3: { depth: 3, random: 0.1,  label: 'Rook — Depth 3', useStockfish: false },
  4: { depth: 4, random: 0.0,  label: 'Queen — Depth 4', useStockfish: false },
  5: { depth: 20, random: 0.0, label: 'Grandmaster — Stockfish', useStockfish: true }
};

async function pickAIMove(game, level) {
  const cfg = LEVELS[level] || LEVELS[4];
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) return null;

  // Random play (lower levels make mistakes so the player can learn).
  if (Math.random() < cfg.random) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // Use Stockfish for Grandmaster level
  if (cfg.useStockfish) {
    await initStockfish();
    const sfMove = await stockfishBestMove(game.fen(), cfg.depth);
    if (sfMove) {
      // Convert algebraic move to verbose format
      const found = moves.find(m => m.san === sfMove);
      return found || moves[0];
    }
  }

  // Fallback to custom AI
  return bestMoveAtDepth(game, cfg.depth);
}

/* =========================================================
   UI WIRING
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  const levelSelect   = document.getElementById('level');
  const newGameBtn    = document.getElementById('new-game');
  const flipBtn       = document.getElementById('flip');
  const statusText    = document.getElementById('status-text');
  const statusCard    = document.getElementById('status');
  const capturedByBot = document.getElementById('captured-by-bot');
  const capturedByYou = document.getElementById('captured-by-you');
  const moveList      = document.getElementById('move-list');
  const moveCount     = document.getElementById('move-count');

  let game = new Chess();
  let board = null;
  let botThinking = false;
  let capturedByBotCount = 0;
  let capturedByYouCount = 0;

  function renderBoard() {
    board.position(game.fen());
  }

  function renderStatus(text) {
    const turn = game.turn();
    let msg = text;
    if (!msg) {
      if (game.in_checkmate()) msg = (turn === 'w' ? 'Black' : 'White') + ' wins by checkmate';
      else if (game.in_draw()) msg = 'Draw';
      else msg = (turn === 'w' ? 'White' : 'Black') + ' to move';
    }
    statusText.textContent = msg;
    statusCard.classList.toggle('turn-w', turn === 'w');
    statusCard.classList.toggle('turn-b', turn === 'b');
  }

  function updateCaptures(move, byBot) {
    if (!move.captured) return;
    const sym = { p:'♟', n:'♞', b:'♝', r:'♜', q:'♛' }[move.captured];
    if (byBot) { capturedByBotCount++; capturedByBot.textContent = sym.repeat(capturedByBotCount); }
    else       { capturedByYouCount++; capturedByYou.textContent = sym.repeat(capturedByYouCount); }
  }

  function updateMoveLog() {
    const history = game.history({ verbose: true });
    moveList.innerHTML = '';
    let row = null;
    history.forEach((m, i) => {
      if (i % 2 === 0) {
        row = document.createElement('li');
        row.textContent = (i / 2 + 1) + '. ';
        moveList.appendChild(row);
      } else {
        row = moveList.lastChild;
      }
      row.textContent += m.san + '  ';
    });
    moveList.scrollTop = moveList.scrollHeight;
    const n = history.length;
    moveCount.textContent = n + ' move' + (n === 1 ? '' : 's');
  }

  function finishIfOver() {
    if (game.game_over()) {
      botThinking = true; // lock board
      renderStatus();
      return true;
    }
    return false;
  }

  async function makeBotMove() {
    if (game.game_over()) return;
    botThinking = true;
    const currentLevel = parseInt(levelSelect.value, 10);
    const cfg = LEVELS[currentLevel];

    // Show thinking indicator
    renderStatus('Bot is thinking…');
    statusCard.classList.add('thinking');

    try {
      const move = await pickAIMove(game, currentLevel);
      if (move) {
        const res = game.move(move);
        if (res) updateCaptures(res, true);
      }
    } catch (err) {
      console.error('Bot error:', err);
    }

    botThinking = false;
    statusCard.classList.remove('thinking');
    updateMoveLog();
    renderBoard();
    renderStatus();
    finishIfOver();
  }

  function onDrop(source, target) {
    if (botThinking) return 'snapback';
    if (game.turn() !== 'w') return 'snapback'; // human plays white
    if (game.game_over()) return 'snapback';

    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    updateCaptures(move, false);
    updateMoveLog();
    renderBoard();
    renderStatus();

    if (finishIfOver()) return;
    // Use setTimeout to allow UI update before AI computes
    setTimeout(makeBotMove, 10);
  }

  function onDragStart(source, piece) {
    if (botThinking || game.game_over()) return false;
    if (game.turn() !== 'w' || piece.search(/^b/) !== -1) return false;
  }

  function startGame() {
    game = new Chess();
    botThinking = false;
    capturedByBotCount = 0;
    capturedByYouCount = 0;
    capturedByBot.textContent = '—';
    capturedByYou.textContent = '—';
    moveList.innerHTML = '';
    moveCount.textContent = '0 moves';
    board.position('start');
    renderStatus();
  }

  // ---- init ----
  board = Chessboard('board', {
    position: 'start',
    draggable: true,
    orientation: 'white',
    coordinates: true,
    onDragStart,
    onDrop
  });

  newGameBtn.addEventListener('click', startGame);
  flipBtn.addEventListener('click', () => {
    board.flip();
  });
  levelSelect.addEventListener('change', () => {
    document.getElementById('level-hint').textContent =
      'Playing: ' + LEVELS[levelSelect.value].label;
  });

  renderStatus();
});