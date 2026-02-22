const DIFFICULTIES = {
  easy: { rows: 9, cols: 9, mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  hard: { rows: 16, cols: 30, mines: 99 },
};
const CUSTOM_DIFFICULTY_KEY = "custom";

const COOKIE_SETTINGS = "saper_settings";
const COOKIE_STATE = "saper_state";
const COOKIE_UNDO_STATE = "saper_undo_state";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const THEMES = {
  dark: true,
  light: true,
};

const boardEl = document.getElementById("board");
const boardShellEl = document.querySelector(".board-shell");
const boardZoomEl = document.querySelector(".board-zoom");
const mineCounterEl = document.getElementById("mine-counter");
const timerEl = document.getElementById("timer");
const difficultyEl = document.getElementById("difficulty");
const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-button"));
const themeEl = document.getElementById("theme");
const themeButtons = Array.from(document.querySelectorAll(".theme-button"));
const newGameEl = document.getElementById("new-game");
const replayEl = document.getElementById("replay-game");
const CELL_SIZE = 24;
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 4;
const boardInput = window.createBoardInputState({
  longPressMs: LONG_PRESS_MS,
  moveTolerance: LONG_PRESS_MOVE_TOLERANCE,
});
const { getCookie: readCookie, setCookie: writeCookie } = window.sharedCookies;
const { countNeighborsMatching, floodRevealZeroArea, neighborsByBounds, renderBaseCellVisual } =
  window.sharedMinesweeperUtils;
let grid = [];
let rows = 0;
let cols = 0;
let mineCount = 0;
let openedCells = 0;
let flagCount = 0;
let started = false;
let gameOver = false;
let gameOutcome = "idle";
let elapsed = 0;
let timerId = null;
let chordPreviewCells = [];
let undoState = null;

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readCustomBoardConfig() {
  const configHost =
    document.querySelector("[data-board-rows][data-board-cols][data-board-mines]") ?? document.body;
  const rows = parsePositiveInt(configHost?.dataset?.boardRows);
  const cols = parsePositiveInt(configHost?.dataset?.boardCols);
  const mines = parsePositiveInt(configHost?.dataset?.boardMines);

  if (!rows || !cols || !mines) return null;
  const cellCount = rows * cols;
  if (mines >= cellCount) return null;

  return { rows, cols, mines };
}

const customBoardConfig = readCustomBoardConfig();

function getSelectedBoardConfig() {
  if (customBoardConfig) return customBoardConfig;
  return DIFFICULTIES[difficultyEl?.value] ?? DIFFICULTIES.medium;
}

function getPersistedDifficultyKey() {
  return customBoardConfig ? CUSTOM_DIFFICULTY_KEY : (difficultyEl?.value ?? "medium");
}

function matchesBoardSignature(saved, expectedRows, expectedCols, expectedMines) {
  return (
    Number(saved?.rows) === expectedRows &&
    Number(saved?.cols) === expectedCols &&
    Number(saved?.mineCount) === expectedMines
  );
}

function format3(n) {
  return String(n).padStart(3, "0").slice(-3);
}

function inBounds(r, c) {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

function neighbors(r, c) {
  return neighborsByBounds(r, c, inBounds);
}

function setCookie(name, value, maxAge = COOKIE_MAX_AGE) {
  writeCookie(name, value, maxAge);
}

function getCookie(name) {
  return readCookie(name);
}

function clearCookie(name) {
  window.sharedCookies.clearCookie(name);
}

function saveSettings() {
  setCookie(
    COOKIE_SETTINGS,
    JSON.stringify({
      difficulty: difficultyEl?.value ?? "medium",
      theme: themeEl?.value ?? "dark",
    }),
  );
}

function syncDifficultyButtons() {
  for (const btn of difficultyButtons) {
    const isActive = btn.dataset.difficulty === difficultyEl.value;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  }
}

function syncThemeButtons() {
  if (!themeEl) return;
  for (const btn of themeButtons) {
    const isActive = btn.dataset.theme === themeEl.value;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  }
}

function applyThemeSelection() {
  if (!themeEl) return;
  document.documentElement.dataset.theme = themeEl.value;
}

function loadSettings() {
  const raw = getCookie(COOKIE_SETTINGS);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!customBoardConfig && parsed && typeof parsed.difficulty === "string" && DIFFICULTIES[parsed.difficulty]) {
      difficultyEl.value = parsed.difficulty;
      syncDifficultyButtons();
    }
    if (parsed && typeof parsed.theme === "string" && THEMES[parsed.theme]) {
      themeEl.value = parsed.theme;
      syncThemeButtons();
      applyThemeSelection();
    }
  } catch {
    // Ignore invalid cookie payload.
  }
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

function updateReplayButton() {
  replayEl.disabled = !(gameOutcome === "lose" && undoState);
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
  if (timerId || !started || gameOver || document.hidden) return;
  timerId = setInterval(() => {
    elapsed = (elapsed + 1) % 1000;
    updateCounters();
    saveGameState();
  }, 1000);
}

function syncTimerWithPageVisibility() {
  if (document.hidden) {
    stopTimer();
    saveGameState();
    return;
  }
  startTimer();
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
  renderBaseCellVisual(cell.el, {
    isOpen: cell.open,
    isFlagged: cell.flagged,
    showMine: cell.open && cell.mine,
    count: cell.adjacent,
    wrongFlag: cell.flagged && !cell.mine && gameOutcome === "lose",
  });
}

function cellKey(r, c) {
  return `${r},${c}`;
}

function consumeSuppressedClick(r, c) {
  return boardInput.consumeSuppressedClick(cellKey(r, c));
}

function shouldSuppressContextMenu(r, c) {
  return boardInput.consumeSuppressedContextMenu(cellKey(r, c));
}

function cancelLongPress() {
  boardInput.cancelLongPress();
}

function triggerLongPressFlag(r, c) {
  clearChordPreview();
  onRightClick(r, c);
}

function onCellPointerDown(event, r, c) {
  if (
    event.pointerType !== "touch" &&
    event.pointerType !== "pen" &&
    event.pointerType !== "mouse"
  ) {
    return;
  }
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }
  if (!event.isPrimary) return;
  boardInput.startLongPress(event, cellKey(r, c), () => {
    triggerLongPressFlag(r, c);
  });
}

function onCellPointerMove(event) {
  if (!event.isPrimary) return;
  boardInput.updateLongPressMove(event);
}

function onCellTouchStart(event) {
  if (event.touches.length > 1) {
    cancelLongPress();
  }
}

function onCellTouchMove() {
  // Priorytet dla przesuwania planszy jednym palcem: każdy ruch anuluje flagę z long-press.
  cancelLongPress();
}

function onCellPointerUpOrCancel(event, r, c) {
  if (!event.isPrimary) return;
  const result = boardInput.endLongPress({ pointerId: event.pointerId, key: cellKey(r, c) });
  if (!result) return;
  if (!result.wasLongPress) return;
  if (event.cancelable) {
    event.preventDefault();
  }
}

function updateBoardMobileScale() {
  if (!boardEl || !boardZoomEl || !boardShellEl || !rows || !cols) return;

  const boardWidth = cols * CELL_SIZE;
  const boardHeight = rows * CELL_SIZE;
  let scale = 1;

  const isMobileLayout = window.innerWidth <= 900;
  if (isMobileLayout) {
    const bodyStyles = getComputedStyle(document.body);
    const bodyPadX =
      parseFloat(bodyStyles.paddingLeft || "0") + parseFloat(bodyStyles.paddingRight || "0");
    const shellStyles = getComputedStyle(boardShellEl);
    const shellInsetX =
      parseFloat(shellStyles.paddingLeft || "0") +
      parseFloat(shellStyles.paddingRight || "0") +
      parseFloat(shellStyles.borderLeftWidth || "0") +
      parseFloat(shellStyles.borderRightWidth || "0");
    const shellInsetY =
      parseFloat(shellStyles.paddingTop || "0") +
      parseFloat(shellStyles.paddingBottom || "0") +
      parseFloat(shellStyles.borderTopWidth || "0") +
      parseFloat(shellStyles.borderBottomWidth || "0");

    const availableWidth = Math.max(120, window.innerWidth - bodyPadX - shellInsetX);
    const shellTop = boardShellEl.getBoundingClientRect().top;
    const availableHeight = Math.max(120, window.innerHeight - shellTop - 16 - shellInsetY);

    scale = Math.min(1, availableWidth / boardWidth, availableHeight / boardHeight);
  }

  boardZoomEl.style.width = `${Math.ceil(boardWidth * scale)}px`;
  boardZoomEl.style.height = `${Math.ceil(boardHeight * scale)}px`;
  boardZoomEl.style.setProperty("--board-scale", String(scale));
  boardShellEl.classList.toggle("is-mobile-fitted", scale < 1);
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

      cellBtn.addEventListener("click", () => {
        if (consumeSuppressedClick(r, c)) return;
        onLeftClick(r, c);
      });
      cellBtn.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        showChordPreview(r, c);
      });
      cellBtn.addEventListener("mouseup", clearChordPreview);
      cellBtn.addEventListener("mouseleave", clearChordPreview);
      cellBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        clearChordPreview();
        if (shouldSuppressContextMenu(r, c)) return;
        onRightClick(r, c);
      });
      cellBtn.addEventListener("pointerdown", (e) => {
        if (
          e.isPrimary &&
          (e.pointerType === "touch" || e.pointerType === "pen")
        ) {
          showChordPreview(r, c);
        }
        onCellPointerDown(e, r, c);
      });
      cellBtn.addEventListener("pointermove", onCellPointerMove);
      cellBtn.addEventListener("pointerup", (e) => {
        clearChordPreview();
        onCellPointerUpOrCancel(e, r, c);
      });
      cellBtn.addEventListener("pointercancel", (e) => {
        clearChordPreview();
        onCellPointerUpOrCancel(e, r, c);
      });
      cellBtn.addEventListener("pointerleave", () => {
        clearChordPreview();
        cancelLongPress();
      });
      cellBtn.addEventListener("touchstart", onCellTouchStart, { passive: true });
      cellBtn.addEventListener("touchmove", onCellTouchMove, { passive: true });
      cellBtn.addEventListener("touchend", cancelLongPress, { passive: true });
      cellBtn.addEventListener("touchcancel", cancelLongPress, { passive: true });

      grid[r][c].el = cellBtn;
      fragment.appendChild(cellBtn);
    }
  }
  boardEl.appendChild(fragment);
  requestAnimationFrame(updateBoardMobileScale);
}

function revealCell(r, c) {
  const cell = grid[r][c];
  if (cell.open || cell.flagged) return;

  if (cell.mine) {
    cell.open = true;
    applyCellVisual(cell);
    return;
  }

  if (cell.adjacent > 0) {
    cell.open = true;
    applyCellVisual(cell);
    openedCells += 1;
    return;
  }

  floodRevealZeroArea([r, c], {
    getKey: ([nr, nc]) => cellKey(nr, nc),
    getNeighbors: ([nr, nc]) => neighbors(nr, nc),
    getCell: ([nr, nc]) => grid[nr][nc],
    isOpen: (current) => current.open,
    isFlagged: (current) => current.flagged,
    isMine: (current) => current.mine,
    getCount: (current) => current.adjacent,
    openCell: (current) => {
      current.open = true;
      applyCellVisual(current);
      openedCells += 1;
    },
  });
}

function revealAllMines() {
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = grid[r][c];
      if (!cell.mine || cell.flagged) continue;
      cell.open = true;
      applyCellVisual(cell);
    }
  }
}

function refreshFlagsAfterLoss() {
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = grid[r][c];
      if (!cell.flagged) continue;
      applyCellVisual(cell);
    }
  }
}

function countFlaggedNeighbors(r, c) {
  return countNeighborsMatching(neighbors(r, c), ([nr, nc]) => grid[nr][nc].flagged);
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
    gameOutcome = "lose";
    stopTimer();
    revealAllMines();
    refreshFlagsAfterLoss();
    setFace("lose");
    updateReplayButton();
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
  if (!cell.open || cell.adjacent <= 0) return;

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
  gameOutcome = "win";
  stopTimer();
  setFace("win");
  updateReplayButton();

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

function buildStatePayload() {
  const serialized = serializeGrid();
  return {
    v: 1,
    difficulty: getPersistedDifficultyKey(),
    rows,
    cols,
    mineCount,
    openedCells,
    flagCount,
    started,
    gameOver,
    outcome: gameOutcome,
    elapsed,
    mines: serialized.mines,
    open: serialized.open,
    flags: serialized.flags,
  };
}

function isValidSerializedState(saved, expectedRows, expectedCols) {
  const size = Number(expectedRows) * Number(expectedCols);
  return (
    Number.isInteger(size) &&
    size > 0 &&
    typeof saved?.mines === "string" &&
    typeof saved?.open === "string" &&
    typeof saved?.flags === "string" &&
    saved.mines.length === size &&
    saved.open.length === size &&
    saved.flags.length === size
  );
}

function captureUndoState() {
  if (!rows || !cols || !grid.length || gameOver) return;
  undoState = buildStatePayload();
  updateReplayButton();
}

function saveUndoState() {
  if (!undoState) {
    clearCookie(COOKIE_UNDO_STATE);
    return;
  }
  setCookie(COOKIE_UNDO_STATE, JSON.stringify(undoState));
}

function restoreUndoState(expectedDifficulty, expectedRows, expectedCols, expectedMines) {
  undoState = null;

  const raw = getCookie(COOKIE_UNDO_STATE);
  if (!raw) return;

  try {
    const savedUndo = JSON.parse(raw);
    if (
      !savedUndo ||
      savedUndo.v !== 1 ||
      (!customBoardConfig && savedUndo.difficulty !== expectedDifficulty) ||
      !matchesBoardSignature(savedUndo, expectedRows, expectedCols, expectedMines) ||
      !isValidSerializedState(savedUndo, expectedRows, expectedCols)
    ) {
      return;
    }
    undoState = savedUndo;
  } catch {
    // Ignore invalid undo payload.
  }
}

function applyStateSnapshot(saved) {
  if (!saved) return;

  const size = Number(saved.rows) * Number(saved.cols);
  if (
    !Number.isInteger(size) ||
    size <= 0 ||
    typeof saved.mines !== "string" ||
    typeof saved.open !== "string" ||
    typeof saved.flags !== "string" ||
    saved.mines.length !== size ||
    saved.open.length !== size ||
    saved.flags.length !== size
  ) {
    return;
  }

  rows = Number(saved.rows);
  cols = Number(saved.cols);
  mineCount = Number(saved.mineCount);
  openedCells = 0;
  flagCount = 0;
  started = Boolean(saved.started);
  gameOver = Boolean(saved.gameOver);
  gameOutcome =
    saved.outcome === "win" || saved.outcome === "lose"
      ? saved.outcome
      : "idle";
  elapsed = Math.max(0, Math.min(999, Number(saved.elapsed) || 0));

  clearChordPreview();
  stopTimer();
  createGrid();
  renderBoard();

  let index = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = grid[r][c];
      cell.mine = saved.mines[index] === "1";
      cell.open = saved.open[index] === "1";
      cell.flagged = cell.open ? false : saved.flags[index] === "1";
      if (cell.open && !cell.mine) openedCells += 1;
      if (cell.flagged) flagCount += 1;
      index += 1;
    }
  }

  if (started) calculateAdjacents();

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      applyCellVisual(grid[r][c]);
    }
  }

  if (gameOutcome === "win") {
    setFace("win");
  } else if (gameOutcome === "lose") {
    setFace("lose");
  } else {
    setFace("idle");
  }

  updateCounters();
  updateReplayButton();

  if (started && !gameOver) {
    startTimer();
  }

  saveGameState();
}

function undoLoss() {
  if (gameOutcome !== "lose" || !undoState) return;
  const snapshot = undoState;
  undoState = null;
  applyStateSnapshot(snapshot);
}

function saveGameState() {
  if (!rows || !cols || !grid.length) return;

  const payload = buildStatePayload();

  setCookie(COOKIE_STATE, JSON.stringify(payload));
  saveUndoState();
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

  if (!saved || saved.v !== 1 || typeof saved.difficulty !== "string") {
    return false;
  }

  const config = customBoardConfig ?? DIFFICULTIES[saved.difficulty];
  if (!config) return false;
  if (
    !matchesBoardSignature(saved, config.rows, config.cols, config.mines) ||
    !isValidSerializedState(saved, config.rows, config.cols)
  ) {
    return false;
  }

  if (!customBoardConfig && saved.difficulty in DIFFICULTIES) {
    difficultyEl.value = saved.difficulty;
    syncDifficultyButtons();
  }
  rows = config.rows;
  cols = config.cols;
  mineCount = config.mines;
  started = Boolean(saved.started);
  gameOver = Boolean(saved.gameOver);
  elapsed = Math.max(0, Math.min(999, Number(saved.elapsed) || 0));
  gameOutcome =
    saved.outcome === "win" || saved.outcome === "lose"
      ? saved.outcome
      : saved.messageClass === "win" || saved.messageClass === "lose"
        ? saved.messageClass
        : "idle";
  restoreUndoState(customBoardConfig ? CUSTOM_DIFFICULTY_KEY : saved.difficulty, config.rows, config.cols, config.mines);

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

  if (gameOutcome === "win") {
    setFace("win");
  } else if (gameOutcome === "lose") {
    setFace("lose");
  } else {
    setFace("idle");
  }
  updateReplayButton();

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
    captureUndoState();
    chordOpenCell(r, c);
    saveGameState();
    return;
  }
  if (cell.flagged) return;

  captureUndoState();

  if (!started) {
    started = true;
    placeMines(r, c);
    startTimer();
  }

  revealCell(r, c);

  if (cell.mine) {
    gameOver = true;
    gameOutcome = "lose";
    stopTimer();
    revealAllMines();
    refreshFlagsAfterLoss();
    setFace("lose");
    updateReplayButton();
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
  syncDifficultyButtons();
  const config = getSelectedBoardConfig();
  rows = config.rows;
  cols = config.cols;
  mineCount = config.mines;

  openedCells = 0;
  flagCount = 0;
  started = false;
  gameOver = false;
  gameOutcome = "idle";
  elapsed = 0;
  undoState = null;
  clearChordPreview();
  stopTimer();
  setFace("idle");
  updateReplayButton();
  createGrid();
  renderBoard();
  updateCounters();
  saveGameState();
}

window.addEventListener("mouseup", clearChordPreview);
document.addEventListener("visibilitychange", syncTimerWithPageVisibility);
boardShellEl?.addEventListener("scroll", cancelLongPress, { passive: true });
window.addEventListener("resize", () => {
  requestAnimationFrame(updateBoardMobileScale);
});
window.addEventListener("orientationchange", () => {
  requestAnimationFrame(updateBoardMobileScale);
});
window.addEventListener("scroll", () => {
  if (window.innerWidth <= 900) {
    requestAnimationFrame(updateBoardMobileScale);
  }
}, { passive: true });
newGameEl.addEventListener("click", newGame);
replayEl.addEventListener("click", undoLoss);
for (const btn of difficultyButtons) {
  btn.addEventListener("click", () => {
    if (customBoardConfig) return;
    const nextDifficulty = btn.dataset.difficulty;
    if (!nextDifficulty || !DIFFICULTIES[nextDifficulty]) return;
    difficultyEl.value = nextDifficulty;
    syncDifficultyButtons();
    newGame();
  });
}

if (customBoardConfig) {
  for (const btn of difficultyButtons) {
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
  }
}
for (const btn of themeButtons) {
  btn.addEventListener("click", () => {
    const nextTheme = btn.dataset.theme;
    if (!nextTheme || !THEMES[nextTheme] || !themeEl) return;
    themeEl.value = nextTheme;
    syncThemeButtons();
    applyThemeSelection();
    saveSettings();
  });
}

loadSettings();
syncThemeButtons();
applyThemeSelection();
if (!restoreGameState()) {
  newGame();
} else {
  requestAnimationFrame(updateBoardMobileScale);
}
