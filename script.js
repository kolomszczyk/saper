const DIFFICULTIES = {
  easy: { rows: 9, cols: 9, mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  hard: { rows: 16, cols: 30, mines: 99 },
};

const COOKIE_SETTINGS = "saper_settings";
const COOKIE_STATE = "saper_state";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const boardEl = document.getElementById("board");
const mineCounterEl = document.getElementById("mine-counter");
const timerEl = document.getElementById("timer");
const messageEl = document.getElementById("message");
const difficultyEl = document.getElementById("difficulty");
const newGameEl = document.getElementById("new-game");
const CELL_SIZE = 24;
document.documentElement.style.setProperty("--flag-url", `url(\"./flag.svg?v=${Date.now()}\")`);
document.documentElement.style.setProperty("--bomb-url", `url(\"./bomb.svg?v=${Date.now()}\")`);

let grid = [];
let rows = 0;
let cols = 0;
let mineCount = 0;
let openedCells = 0;
let flagCount = 0;
let started = false;
let gameOver = false;
let elapsed = 0;
let timerId = null;
let chordPreviewCells = [];

function format3(n) {
  return String(n).padStart(3, "0").slice(-3);
}

function inBounds(r, c) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function neighbors(r, c) {
  const list = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc)) list.push([nr, nc]);
    }
  }
  return list;
}

function setCookie(name, value, maxAge = COOKIE_MAX_AGE) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
}

function getCookie(name) {
  const prefix = `${name}=`;
  const parts = document.cookie ? document.cookie.split(";") : [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return "";
}

function saveSettings() {
  setCookie(COOKIE_SETTINGS, JSON.stringify({ difficulty: difficultyEl.value }));
}

function loadSettings() {
  const raw = getCookie(COOKIE_SETTINGS);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.difficulty === "string" && DIFFICULTIES[parsed.difficulty]) {
      difficultyEl.value = parsed.difficulty;
    }
  } catch {
    // Ignore invalid cookie payload.
  }
}

function setMessage(text, cls = "") {
  messageEl.textContent = text;
  messageEl.className = "message";
  if (cls) messageEl.classList.add(cls);
}

function setFace(state) {
  if (state === "win") {
    newGameEl.textContent = "😎";
    return;
  }
  if (state === "lose") {
    newGameEl.textContent = "😵";
    return;
  }
  newGameEl.textContent = "🙂";
}

function updateCounters() {
  mineCounterEl.textContent = format3(mineCount - flagCount);
  timerEl.textContent = format3(elapsed);
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function startTimer() {
  if (timerId) return;
  timerId = setInterval(() => {
    elapsed = Math.min(elapsed + 1, 999);
    updateCounters();
    saveGameState();
  }, 1000);
}

function makeEmptyCell() {
  return {
    mine: false,
    open: false,
    flagged: false,
    adjacent: 0,
    el: null,
  };
}

function createGrid() {
  grid = Array.from({ length: rows }, () => Array.from({ length: cols }, makeEmptyCell));
}

function calculateAdjacents() {
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (grid[r][c].mine) {
        grid[r][c].adjacent = 0;
        continue;
      }
      let count = 0;
      for (const [nr, nc] of neighbors(r, c)) {
        if (grid[nr][nc].mine) count += 1;
      }
      grid[r][c].adjacent = count;
    }
  }
}

function placeMines(safeR, safeC) {
  const forbidden = new Set([`${safeR},${safeC}`]);
  for (const [nr, nc] of neighbors(safeR, safeC)) {
    forbidden.add(`${nr},${nc}`);
  }

  let placed = 0;
  while (placed < mineCount) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    const key = `${r},${c}`;
    if (forbidden.has(key) || grid[r][c].mine) continue;
    grid[r][c].mine = true;
    placed += 1;
  }

  calculateAdjacents();
}

function applyCellVisual(cell) {
  cell.el.className = "cell";
  cell.el.textContent = "";

  if (cell.open) {
    cell.el.classList.add("open");
    if (cell.mine) {
      cell.el.classList.add("mine");
      return;
    }
    if (cell.adjacent > 0) {
      cell.el.textContent = String(cell.adjacent);
      cell.el.classList.add(`n${cell.adjacent}`);
    }
    return;
  }

  if (cell.flagged) {
    cell.el.classList.add("flagged");
  }
}

function renderBoard() {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${cols}, ${CELL_SIZE}px)`;

  const fragment = document.createDocumentFragment();
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cellBtn = document.createElement("button");
      cellBtn.type = "button";
      cellBtn.className = "cell";
      cellBtn.setAttribute("role", "gridcell");
      cellBtn.setAttribute("aria-label", `Pole ${r + 1}, ${c + 1}`);
      cellBtn.dataset.row = String(r);
      cellBtn.dataset.col = String(c);

      cellBtn.addEventListener("click", () => onLeftClick(r, c));
      cellBtn.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        showChordPreview(r, c);
      });
      cellBtn.addEventListener("mouseup", clearChordPreview);
      cellBtn.addEventListener("mouseleave", clearChordPreview);
      cellBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        clearChordPreview();
        onRightClick(r, c);
      });

      grid[r][c].el = cellBtn;
      fragment.appendChild(cellBtn);
    }
  }
  boardEl.appendChild(fragment);
}

function revealCell(r, c) {
  const cell = grid[r][c];
  if (cell.open || cell.flagged) return;

  cell.open = true;
  applyCellVisual(cell);

  if (cell.mine) return;

  openedCells += 1;
  if (cell.adjacent > 0) return;

  for (const [nr, nc] of neighbors(r, c)) {
    revealCell(nr, nc);
  }
}

function revealAllMines() {
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = grid[r][c];
      if (!cell.mine) continue;
      cell.open = true;
      applyCellVisual(cell);
    }
  }
}

function countFlaggedNeighbors(r, c) {
  let total = 0;
  for (const [nr, nc] of neighbors(r, c)) {
    if (grid[nr][nc].flagged) total += 1;
  }
  return total;
}

function chordOpenCell(r, c) {
  const cell = grid[r][c];
  if (!cell.open || gameOver) return;

  const flaggedAround = countFlaggedNeighbors(r, c);
  if (flaggedAround !== cell.adjacent) return;

  let hitMine = false;
  for (const [nr, nc] of neighbors(r, c)) {
    const neighbor = grid[nr][nc];
    if (neighbor.open || neighbor.flagged) continue;
    revealCell(nr, nc);
    if (neighbor.mine) hitMine = true;
  }

  if (hitMine) {
    gameOver = true;
    stopTimer();
    revealAllMines();
    setMessage("Przegrana!", "lose");
    setFace("lose");
    saveGameState();
    return;
  }

  checkWin();
}

function clearChordPreview() {
  for (const cell of chordPreviewCells) {
    cell.el.classList.remove("chord-preview");
  }
  chordPreviewCells = [];
}

function showChordPreview(r, c) {
  clearChordPreview();

  if (gameOver) return;
  const cell = grid[r][c];
  if (!cell.open) return;

  const flaggedAround = countFlaggedNeighbors(r, c);
  if (flaggedAround === cell.adjacent) return;

  for (const [nr, nc] of neighbors(r, c)) {
    const neighbor = grid[nr][nc];
    if (neighbor.open || neighbor.flagged) continue;
    neighbor.el.classList.add("chord-preview");
    chordPreviewCells.push(neighbor);
  }
}

function checkWin() {
  const target = rows * cols - mineCount;
  if (openedCells !== target) return;

  gameOver = true;
  stopTimer();
  setMessage("Wygrana!", "win");
  setFace("win");

  flagCount = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = grid[r][c];
      if (cell.mine) {
        cell.flagged = true;
      }
      if (cell.flagged) flagCount += 1;
      applyCellVisual(cell);
    }
  }

  updateCounters();
}

function serializeGrid() {
  const mines = [];
  const open = [];
  const flags = [];

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = grid[r][c];
      mines.push(cell.mine ? "1" : "0");
      open.push(cell.open ? "1" : "0");
      flags.push(cell.flagged ? "1" : "0");
    }
  }

  return {
    mines: mines.join(""),
    open: open.join(""),
    flags: flags.join(""),
  };
}

function saveGameState() {
  if (!rows || !cols || !grid.length) return;

  const messageClass = messageEl.classList.contains("win")
    ? "win"
    : messageEl.classList.contains("lose")
      ? "lose"
      : "";

  const serialized = serializeGrid();
  const payload = {
    v: 1,
    difficulty: difficultyEl.value,
    rows,
    cols,
    mineCount,
    openedCells,
    flagCount,
    started,
    gameOver,
    elapsed,
    message: messageEl.textContent,
    messageClass,
    mines: serialized.mines,
    open: serialized.open,
    flags: serialized.flags,
  };

  setCookie(COOKIE_STATE, JSON.stringify(payload));
  saveSettings();
}

function restoreGameState() {
  const raw = getCookie(COOKIE_STATE);
  if (!raw) return false;

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return false;
  }

  if (!saved || saved.v !== 1 || typeof saved.difficulty !== "string" || !DIFFICULTIES[saved.difficulty]) {
    return false;
  }

  const config = DIFFICULTIES[saved.difficulty];
  const size = config.rows * config.cols;
  if (
    typeof saved.mines !== "string" ||
    typeof saved.open !== "string" ||
    typeof saved.flags !== "string" ||
    saved.mines.length !== size ||
    saved.open.length !== size ||
    saved.flags.length !== size
  ) {
    return false;
  }

  difficultyEl.value = saved.difficulty;
  rows = config.rows;
  cols = config.cols;
  mineCount = config.mines;
  started = Boolean(saved.started);
  gameOver = Boolean(saved.gameOver);
  elapsed = Math.max(0, Math.min(999, Number(saved.elapsed) || 0));

  createGrid();
  renderBoard();

  openedCells = 0;
  flagCount = 0;
  let index = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = grid[r][c];
      const mine = saved.mines[index] === "1";
      const open = saved.open[index] === "1";
      const flagged = saved.flags[index] === "1";

      cell.mine = mine;
      cell.open = open;
      cell.flagged = open ? false : flagged;

      if (cell.open && !cell.mine) openedCells += 1;
      if (cell.flagged) flagCount += 1;
      index += 1;
    }
  }

  if (started) {
    calculateAdjacents();
  }

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      applyCellVisual(grid[r][c]);
    }
  }

  const messageClass = saved.messageClass === "win" || saved.messageClass === "lose" ? saved.messageClass : "";
  const messageText = typeof saved.message === "string" && saved.message.trim() ? saved.message : "Powodzenia!";
  setMessage(messageText, messageClass);

  if (messageClass === "win") {
    setFace("win");
  } else if (messageClass === "lose") {
    setFace("lose");
  } else {
    setFace("idle");
  }

  updateCounters();

  if (started && !gameOver) {
    startTimer();
  } else {
    stopTimer();
  }

  return true;
}

function onLeftClick(r, c) {
  if (gameOver) return;
  clearChordPreview();
  const cell = grid[r][c];
  if (cell.open) {
    chordOpenCell(r, c);
    saveGameState();
    return;
  }
  if (cell.flagged) return;

  if (!started) {
    started = true;
    placeMines(r, c);
    startTimer();
  }

  revealCell(r, c);

  if (cell.mine) {
    gameOver = true;
    stopTimer();
    revealAllMines();
    setMessage("Przegrana!", "lose");
    setFace("lose");
    saveGameState();
    return;
  }

  checkWin();
  saveGameState();
}

function onRightClick(r, c) {
  if (gameOver) return;
  const cell = grid[r][c];
  if (cell.open) return;

  cell.flagged = !cell.flagged;
  if (cell.flagged) {
    flagCount += 1;
  } else {
    flagCount -= 1;
  }

  applyCellVisual(cell);
  updateCounters();
  saveGameState();
}

function newGame() {
  const config = DIFFICULTIES[difficultyEl.value] ?? DIFFICULTIES.medium;
  rows = config.rows;
  cols = config.cols;
  mineCount = config.mines;

  openedCells = 0;
  flagCount = 0;
  started = false;
  gameOver = false;
  elapsed = 0;
  clearChordPreview();
  stopTimer();

  setMessage("Powodzenia!");
  setFace("idle");
  createGrid();
  renderBoard();
  updateCounters();
  saveGameState();
}

window.addEventListener("mouseup", clearChordPreview);
newGameEl.addEventListener("click", newGame);
difficultyEl.addEventListener("change", newGame);

loadSettings();
if (!restoreGameState()) {
  newGame();
}
