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
const pageEl = document.querySelector(".page");
const gameWindowEl = document.querySelector(".window");
const mineCounterEl = document.getElementById("mine-counter");
const timerEl = document.getElementById("timer");
const difficultyEl = document.getElementById("difficulty");
const difficultyPickerEl = document.querySelector(".difficulty-picker");
const difficultyButtons = Array.from(document.querySelectorAll(".difficulty-button"));
const themeEl = document.getElementById("theme");
const themeButtons = Array.from(document.querySelectorAll(".theme-button"));
const newGameEl = document.getElementById("new-game");
const replayEl = document.getElementById("replay-game");
const zoomValueEl = document.getElementById("zoom-value");
const CELL_SIZE = 24;
const ABS_MIN_BOARD_ZOOM = 0.1;
const MIN_BOARD_ZOOM = 0.5;
const MAX_BOARD_ZOOM = 2;
const BOARD_ZOOM_STEP = 0.1;
const DEFAULT_BOARD_ZOOM = 1;
const FULL_FIT_ZOOM_EPSILON = 0.002;
const FULL_FIT_STATE_EPSILON = 0.01;
const MOBILE_VIEWPORT_BREAKPOINT = 900;
const MOBILE_FULL_FIT_GUTTER_X = 72;
const LONG_PRESS_MS =
  window.matchMedia("(hover: none) and (pointer: coarse)").matches ? 1.25 : 450;
const LONG_PRESS_MOVE_TOLERANCE = 4;
const boardInput = window.createBoardInputState({
  longPressMs: LONG_PRESS_MS,
  moveTolerance: LONG_PRESS_MOVE_TOLERANCE,
});
const { getCookie: readCookie, setCookie: writeCookie } = window.sharedCookies;
const dailyGameLimit = window.sharedDailyGameLimit;
const {
  countNeighborsMatching,
  collectChordPreviewCoords,
  removeClassFromTargets,
  forEachBoardCoord,
  floodRevealZeroArea,
  forEachBitFieldCell,
  hasValidBitFieldLengths,
  neighborsByBounds,
  preloadImageAssets,
  renderBaseCellVisual,
  runChordReveal,
  serializeBitFields,
} = window.sharedMinesweeperUtils;
const SVG_ASSETS_TO_PRELOAD = [
  "./bomb.svg",
  "./bomb-black.svg",
  "./flag.svg",
  "./cross.svg",
  "./favicon-flag-light.svg",
  "./favicon-flag-dark.svg",
];
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
let dailyLimitLocked = false;
const TOUCH_TAP_GUESS_WINDOW_MS = 800;
let pendingTouchTapGuessKey = "";
let pendingTouchTapGuessExpiresAt = 0;
let boardZoom = DEFAULT_BOARD_ZOOM;
let isPinchZooming = false;
let pinchState = null;
let suppressTapAfterPinchUntil = 0;
let boardLayoutRafId = 0;

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampBoardZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_BOARD_ZOOM;
  return clamp(numeric, ABS_MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
}

function formatBoardZoomLabel(value) {
  return `${Math.round(clampBoardZoom(value) * 100)}%`;
}

function updateZoomReadout() {
  if (!zoomValueEl) return;
  zoomValueEl.textContent = formatBoardZoomLabel(boardZoom);
}

function syncMinZoomLayoutState() {
  const fullFitZoom = getFullBoardZoomFloor();
  const isMinZoom = boardZoom <= fullFitZoom + FULL_FIT_STATE_EPSILON;
  pageEl?.classList.toggle("is-min-zoom", isMinZoom);
  gameWindowEl?.classList.toggle("is-min-zoom", isMinZoom);
  boardShellEl?.classList.toggle("is-min-zoom", isMinZoom);
}

function clearPendingTouchTapGuess() {
  pendingTouchTapGuessKey = "";
  pendingTouchTapGuessExpiresAt = 0;
}

function suppressTapAfterPinch(durationMs = 260) {
  suppressTapAfterPinchUntil = performance.now() + durationMs;
}

function isTapSuppressedAfterPinch() {
  return suppressTapAfterPinchUntil > performance.now();
}

function clampBoardShellHeightToViewport() {
  if (!boardShellEl) return;
  if (!rows || !cols) {
    boardShellEl.style.height = "auto";
    boardShellEl.style.maxHeight = "none";
    return;
  }

  const shellStyles = getComputedStyle(boardShellEl);
  const shellInsetY =
    parseFloat(shellStyles.paddingTop || "0") +
    parseFloat(shellStyles.paddingBottom || "0") +
    parseFloat(shellStyles.borderTopWidth || "0") +
    parseFloat(shellStyles.borderBottomWidth || "0");
  const boardHeight = rows * CELL_SIZE * boardZoom;
  const targetHeight = Math.max(140, boardHeight + shellInsetY);

  boardShellEl.style.height = `${targetHeight}px`;
  boardShellEl.style.maxHeight = "none";
}

function getBoardViewportSize() {
  if (!boardShellEl) {
    return { width: 0, height: 0 };
  }
  const shellStyles = getComputedStyle(boardShellEl);
  const padX =
    parseFloat(shellStyles.paddingLeft || "0") +
    parseFloat(shellStyles.paddingRight || "0");
  const padY =
    parseFloat(shellStyles.paddingTop || "0") +
    parseFloat(shellStyles.paddingBottom || "0");
  return {
    width: Math.max(40, boardShellEl.clientWidth - padX),
    height: Math.max(40, boardShellEl.clientHeight - padY),
  };
}

function getBoardFitViewportSize() {
  if (!boardShellEl) {
    return { width: 0, height: 0 };
  }
  const baseViewport = getBoardViewportSize();
  let fitWidth = baseViewport.width;
  if (window.innerWidth <= MOBILE_VIEWPORT_BREAKPOINT) {
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    fitWidth = Math.max(40, Math.floor(viewportWidth - MOBILE_FULL_FIT_GUTTER_X));
  }
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const shellTop = boardShellEl.getBoundingClientRect().top;
  const availableHeight = Math.max(40, Math.floor(viewportHeight - shellTop - 8));
  return {
    width: Math.min(baseViewport.width, fitWidth),
    height: availableHeight,
  };
}

function getFullBoardZoomFloor() {
  if (!boardShellEl || !rows || !cols) return MIN_BOARD_ZOOM;
  const boardWidth = cols * CELL_SIZE;
  const boardHeight = rows * CELL_SIZE;
  if (!boardWidth || !boardHeight) return MIN_BOARD_ZOOM;
  const viewport = getBoardFitViewportSize();
  const fitZoom = Math.min(viewport.width / boardWidth, viewport.height / boardHeight) - FULL_FIT_ZOOM_EPSILON;
  return clamp(Math.min(fitZoom, DEFAULT_BOARD_ZOOM), ABS_MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
}

function fitBoardToViewport() {
  if (!boardShellEl || !rows || !cols) return;
  const fitZoom = getFullBoardZoomFloor();
  setBoardZoom(fitZoom, {
    anchorClientX: boardShellEl.getBoundingClientRect().left + boardShellEl.clientWidth / 2,
    anchorClientY: boardShellEl.getBoundingClientRect().top + boardShellEl.clientHeight / 2,
    minZoom: fitZoom,
  });
}

function applyBoardLayout() {
  if (!boardShellEl || !boardZoomEl) return;
  clampBoardShellHeightToViewport();
  if (!rows || !cols) return;

  const boardWidth = cols * CELL_SIZE;
  const boardHeight = rows * CELL_SIZE;
  boardZoomEl.style.width = `${boardWidth * boardZoom}px`;
  boardZoomEl.style.height = `${boardHeight * boardZoom}px`;
  boardZoomEl.style.setProperty("--board-scale", String(boardZoom));
}

function snapBoardScrollToVisibleEdges() {
  if (!boardShellEl || !rows || !cols) return;
  const viewport = getBoardViewportSize();
  const scaledWidth = cols * CELL_SIZE * boardZoom;
  const scaledHeight = rows * CELL_SIZE * boardZoom;
  if (scaledWidth <= viewport.width + 0.5) {
    boardShellEl.scrollLeft = 0;
  }
  if (scaledHeight <= viewport.height + 0.5) {
    boardShellEl.scrollTop = 0;
  }
}

function scheduleBoardLayout() {
  if (boardLayoutRafId) return;
  boardLayoutRafId = requestAnimationFrame(() => {
    boardLayoutRafId = 0;
    applyBoardLayout();
  });
}

function centerBoardViewport() {
  if (!boardShellEl) return;
  const maxLeft = Math.max(0, boardShellEl.scrollWidth - boardShellEl.clientWidth);
  const maxTop = Math.max(0, boardShellEl.scrollHeight - boardShellEl.clientHeight);
  boardShellEl.scrollLeft = maxLeft / 2;
  boardShellEl.scrollTop = maxTop / 2;
}

function setBoardZoom(nextZoom, options = {}) {
  const fullFitFloor = getFullBoardZoomFloor();
  const minZoom = Number.isFinite(options.minZoom)
    ? Number(options.minZoom)
    : Math.min(MIN_BOARD_ZOOM, fullFitFloor, boardZoom);
  if (!boardShellEl) {
    boardZoom = clamp(Number(nextZoom), minZoom, MAX_BOARD_ZOOM);
    updateZoomReadout();
    syncMinZoomLayoutState();
    if (options.persist !== false) saveSettings();
    return;
  }

  const targetZoom = clamp(Number(nextZoom), minZoom, MAX_BOARD_ZOOM);
  const prevZoom = boardZoom;
  const zoomChanged = Math.abs(targetZoom - prevZoom) > 0.0001;

  const shellRect = boardShellEl.getBoundingClientRect();
  const fallbackOffsetX = boardShellEl.clientWidth / 2;
  const fallbackOffsetY = boardShellEl.clientHeight / 2;
  const anchorOffsetX = clamp(
    Number.isFinite(options.anchorClientX)
      ? options.anchorClientX - shellRect.left
      : fallbackOffsetX,
    0,
    boardShellEl.clientWidth,
  );
  const anchorOffsetY = clamp(
    Number.isFinite(options.anchorClientY)
      ? options.anchorClientY - shellRect.top
      : fallbackOffsetY,
    0,
    boardShellEl.clientHeight,
  );
  const anchorContentX = (boardShellEl.scrollLeft + anchorOffsetX) / prevZoom;
  const anchorContentY = (boardShellEl.scrollTop + anchorOffsetY) / prevZoom;

  boardZoom = targetZoom;
  updateZoomReadout();
  syncMinZoomLayoutState();
  applyBoardLayout();

  const targetLeft = anchorContentX * targetZoom - anchorOffsetX;
  const targetTop = anchorContentY * targetZoom - anchorOffsetY;
  const maxLeft = Math.max(0, boardShellEl.scrollWidth - boardShellEl.clientWidth);
  const maxTop = Math.max(0, boardShellEl.scrollHeight - boardShellEl.clientHeight);
  boardShellEl.scrollLeft = clamp(targetLeft, 0, maxLeft);
  boardShellEl.scrollTop = clamp(targetTop, 0, maxTop);
  snapBoardScrollToVisibleEdges();

  if (zoomChanged && options.persist !== false) {
    saveSettings();
  }
}

function getTouchDistance(firstTouch, secondTouch) {
  const dx = secondTouch.clientX - firstTouch.clientX;
  const dy = secondTouch.clientY - firstTouch.clientY;
  return Math.hypot(dx, dy);
}

function getTouchMidpoint(firstTouch, secondTouch) {
  return {
    x: (firstTouch.clientX + secondTouch.clientX) / 2,
    y: (firstTouch.clientY + secondTouch.clientY) / 2,
  };
}

function beginPinchZoom(event) {
  if (event.touches.length !== 2) return;
  const [firstTouch, secondTouch] = event.touches;
  const startDistance = getTouchDistance(firstTouch, secondTouch);
  if (!Number.isFinite(startDistance) || startDistance <= 0) return;

  const midpoint = getTouchMidpoint(firstTouch, secondTouch);
  const pressedKey = boardInput.getPressedKey();
  if (pressedKey) {
    boardInput.suppressBothFor(pressedKey, 450);
  }
  clearPendingTouchTapGuess();
  clearChordPreview();
  cancelLongPress();
  suppressTapAfterPinch();

  isPinchZooming = true;
  pinchState = {
    startDistance,
    startZoom: boardZoom,
    anchorClientX: midpoint.x,
    anchorClientY: midpoint.y,
  };
  if (event.cancelable) {
    event.preventDefault();
  }
}

function updatePinchZoom(event) {
  if (!isPinchZooming || !pinchState) return;
  if (event.touches.length !== 2) return;
  const [firstTouch, secondTouch] = event.touches;
  const distance = getTouchDistance(firstTouch, secondTouch);
  if (!Number.isFinite(distance) || distance <= 0) return;

  const midpoint = getTouchMidpoint(firstTouch, secondTouch);
  const ratio = distance / pinchState.startDistance;
  if (event.cancelable) {
    event.preventDefault();
  }
  suppressTapAfterPinch();
  const fullFloor = getFullBoardZoomFloor();
  setBoardZoom(pinchState.startZoom * ratio, {
    anchorClientX: midpoint.x,
    anchorClientY: midpoint.y,
    minZoom: fullFloor,
    persist: false,
  });
}

function endPinchZoom() {
  if (!isPinchZooming) return;
  isPinchZooming = false;
  pinchState = null;
  suppressTapAfterPinch();
  saveSettings();
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

function readSettingsObject() {
  const raw = getCookie(COOKIE_SETTINGS);
  if (!raw) return {};
  try {
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

function readSavedCustomBoardConfig() {
  if (customBoardConfig) return null;
  const settings = readSettingsObject();
  if (!settings.customMapEnabled) return null;

  const rows = parsePositiveInt(settings.customMapHeight);
  const cols = parsePositiveInt(settings.customMapWidth);
  const mines = parsePositiveInt(settings.customMapBombCount);
  if (!rows || !cols || mines == null) return null;
  const cellCount = rows * cols;
  if (mines >= cellCount) return null;

  return { rows, cols, mines };
}

function getSelectedBoardConfig() {
  if (customBoardConfig) return customBoardConfig;
  if ((difficultyEl?.value ?? "") === CUSTOM_DIFFICULTY_KEY) {
    return readSavedCustomBoardConfig() ?? DIFFICULTIES.medium;
  }
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
  let currentSettings = {};
  try {
    currentSettings = JSON.parse(getCookie(COOKIE_SETTINGS) || "{}") || {};
  } catch {
    currentSettings = {};
  }

  setCookie(
    COOKIE_SETTINGS,
    JSON.stringify({
      ...currentSettings,
      difficulty: difficultyEl?.value ?? "medium",
      theme: themeEl?.value ?? "dark",
      boardZoom: Number(boardZoom.toFixed(3)),
    }),
  );
}

function getDailyLimitStatus() {
  return dailyGameLimit?.getStatus?.() ?? {
    reached: false,
    remaining: Number.POSITIVE_INFINITY,
    count: 0,
    limit: Number.POSITIVE_INFINITY,
  };
}

function removeDailyLimitMessage() {
  const current = boardEl.querySelector(".daily-limit-message");
  if (current) current.remove();
}

function renderDisabledLimitBoard(_status = getDailyLimitStatus()) {
  const fallbackConfig = getSelectedBoardConfig();
  const limitRows = rows || fallbackConfig.rows;
  const limitCols = cols || fallbackConfig.cols;

  boardEl.innerHTML = "";
  boardEl.classList.add("is-daily-limit-board");
  boardEl.style.gridTemplateColumns = `repeat(${limitCols}, ${CELL_SIZE}px)`;

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < limitRows * limitCols; i += 1) {
    const cellEl = document.createElement("div");
    cellEl.className = "cell open daily-limit-cell";
    cellEl.setAttribute("aria-hidden", "true");
    fragment.appendChild(cellEl);
  }

  boardEl.appendChild(fragment);
}

function unlockDailyLimitBoard() {
  if (!dailyLimitLocked) return;
  dailyLimitLocked = false;
  boardEl.classList.remove("is-daily-limit-board");
  newGameEl.disabled = false;
  replayEl.disabled = !(gameOutcome === "lose" && undoState);
  for (const btn of difficultyButtons) {
    if (customBoardConfig) continue;
    btn.disabled = false;
    btn.removeAttribute("aria-disabled");
  }
}

function lockBoardForDailyLimit(status = getDailyLimitStatus()) {
  dailyLimitLocked = true;
  clearChordPreview();
  stopTimer();
  renderDisabledLimitBoard(status);

  newGameEl.disabled = true;
  replayEl.disabled = true;
  for (const btn of difficultyButtons) {
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
  }
  scheduleBoardLayout();
}

function shouldBlockNewDailyGame() {
  const status = getDailyLimitStatus();
  if (!status.reached) {
    unlockDailyLimitBoard();
    return false;
  }
  lockBoardForDailyLimit(status);
  return true;
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
  if (!raw) {
    boardZoom = DEFAULT_BOARD_ZOOM;
    updateZoomReadout();
    syncMinZoomLayoutState();
    syncCustomDifficultyAvailability();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!customBoardConfig && parsed && typeof parsed.difficulty === "string") {
      const canUseSavedCustom =
        parsed.difficulty === CUSTOM_DIFFICULTY_KEY && Boolean(readSavedCustomBoardConfig());
      if (DIFFICULTIES[parsed.difficulty] || canUseSavedCustom) {
        difficultyEl.value = parsed.difficulty;
        syncDifficultyButtons();
      }
    }
    if (parsed && typeof parsed.theme === "string" && THEMES[parsed.theme]) {
      themeEl.value = parsed.theme;
      syncThemeButtons();
      applyThemeSelection();
    }
    boardZoom = clampBoardZoom(parsed?.boardZoom);
  } catch {
    // Ignore invalid cookie payload.
    boardZoom = DEFAULT_BOARD_ZOOM;
  } finally {
    updateZoomReadout();
    syncMinZoomLayoutState();
    syncCustomDifficultyAvailability();
  }
}

function syncCustomDifficultyAvailability() {
  const customBtn = difficultyButtons.find((btn) => btn.dataset.difficulty === CUSTOM_DIFFICULTY_KEY);
  const syncDifficultyPickerLayout = () => {
    if (!difficultyPickerEl) return;
    difficultyPickerEl.classList.toggle("has-custom", Boolean(customBtn && !customBtn.hidden));
  };
  if (!customBtn) {
    syncDifficultyPickerLayout();
    difficultyPickerEl?.classList.add("is-ready");
    return;
  }
  if (customBoardConfig) {
    customBtn.disabled = true;
    customBtn.setAttribute("aria-disabled", "true");
    syncDifficultyPickerLayout();
    difficultyPickerEl?.classList.add("is-ready");
    return;
  }

  const customConfig = readSavedCustomBoardConfig();
  const canUseCustom = Boolean(customConfig);
  customBtn.hidden = !canUseCustom;
  customBtn.disabled = !canUseCustom;
  customBtn.setAttribute("aria-disabled", String(!canUseCustom));

  if (!canUseCustom && difficultyEl?.value === CUSTOM_DIFFICULTY_KEY) {
    difficultyEl.value = "medium";
    syncDifficultyButtons();
  }

  syncDifficultyPickerLayout();
  difficultyPickerEl?.classList.add("is-ready");
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
  forEachBoardCoord(rows, cols, ({ r, c }) => {
    if (grid[r][c].mine) {
      grid[r][c].adjacent = 0;
      return;
    }
    let count = 0;
    for (const [nr, nc] of neighbors(r, c)) {
      if (grid[nr][nc].mine) count += 1;
    }
    grid[r][c].adjacent = count;
  });
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

function setPendingTouchTapGuess(key) {
  pendingTouchTapGuessKey = key;
  pendingTouchTapGuessExpiresAt = performance.now() + TOUCH_TAP_GUESS_WINDOW_MS;
}

function consumePendingTouchTapGuess(key) {
  if (!pendingTouchTapGuessExpiresAt || performance.now() > pendingTouchTapGuessExpiresAt) {
    clearPendingTouchTapGuess();
    return false;
  }
  if (pendingTouchTapGuessKey !== key) return false;
  clearPendingTouchTapGuess();
  return true;
}

function isSameOrNeighborPressedCell(r, c, pressedKey) {
  if (!pressedKey) return false;
  const [pressedRRaw, pressedCRaw] = String(pressedKey).split(",");
  const pressedR = Number(pressedRRaw);
  const pressedC = Number(pressedCRaw);
  if (!Number.isFinite(pressedR) || !Number.isFinite(pressedC)) return false;
  return Math.abs(pressedR - r) <= 1 && Math.abs(pressedC - c) <= 1;
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
  if ((event.pointerType === "touch" || event.pointerType === "pen") && isTapSuppressedAfterPinch()) {
    return;
  }
  if (!event.isPrimary) return;
  boardInput.startLongPress(event, cellKey(r, c), () => {
    triggerLongPressFlag(r, c);
  });
}

function onCellPointerMove(event) {
  if (!event.isPrimary) return;
  if (event.pointerType === "touch" || event.pointerType === "pen") {
    const pressedKeyBeforeMove = boardInput.getPressedKey();
    boardInput.updateLongPressMove(event);
    if (pressedKeyBeforeMove && !boardInput.getPressedKey()) {
      boardInput.suppressClickFor(pressedKeyBeforeMove, 400);
      clearChordPreview();
      return;
    }
    const currentCell = event.currentTarget;
    if (!(currentCell instanceof HTMLButtonElement)) return;
    const pressedKey = boardInput.getPressedKey();
    if (!pressedKey) return;
    const r = Number(currentCell.dataset.row);
    const c = Number(currentCell.dataset.col);
    if (!isSameOrNeighborPressedCell(r, c, pressedKey)) {
      boardInput.suppressClickFor(pressedKey, 400);
      cancelLongPress();
    }
    return;
  }
  boardInput.updateLongPressMove(event);
}

function onCellTouchStart(event) {
  if (event.touches.length > 1) {
    cancelLongPress();
  }
}

function onCellTouchMove(event) {
  const pressedKey = boardInput.getPressedKey();
  if (!pressedKey) return;
  const touch = event.touches?.[0];
  if (!touch) return;
  const touchedEl = document.elementFromPoint(touch.clientX, touch.clientY);
  const touchedCell = touchedEl instanceof Element ? touchedEl.closest(".cell") : null;
  if (touchedCell instanceof HTMLButtonElement) {
    const r = Number(touchedCell.dataset.row);
    const c = Number(touchedCell.dataset.col);
    if (isSameOrNeighborPressedCell(r, c, pressedKey)) return;
  }
  // Anuluj long-press dopiero po zejściu palcem poza pierwszy klocek lub jego sąsiadów.
  boardInput.suppressClickFor(pressedKey, 400);
  cancelLongPress();
}

function onCellPointerUpOrCancel(event, r, c) {
  if (!event.isPrimary) return;
  const result = boardInput.endLongPress({ pointerId: event.pointerId, key: cellKey(r, c) });
  if (!result) return;
  if (!result.wasLongPress) {
    if (
      event.type === "pointerup" &&
      (event.pointerType === "touch" || event.pointerType === "pen")
    ) {
      setPendingTouchTapGuess(cellKey(r, c));
    }
    return;
  }
  if (event.cancelable) {
    event.preventDefault();
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

      cellBtn.addEventListener("click", () => {
        if (isTapSuppressedAfterPinch()) return;
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
  applyBoardLayout();
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
  forEachBoardCoord(rows, cols, ({ r, c }) => {
    const cell = grid[r][c];
    if (!cell.mine || cell.flagged) return;
    cell.open = true;
    applyCellVisual(cell);
  });
}

function refreshFlagsAfterLoss() {
  forEachBoardCoord(rows, cols, ({ r, c }) => {
    const cell = grid[r][c];
    if (!cell.flagged) return;
    applyCellVisual(cell);
  });
}

function countFlaggedNeighbors(r, c) {
  return countNeighborsMatching(neighbors(r, c), ([nr, nc]) => grid[nr][nc].flagged);
}

function chordOpenCell(r, c) {
  const cell = grid[r][c];
  if (!cell.open || gameOver) return;

  const result = runChordReveal([r, c], {
    getCell: ([nr, nc]) => grid[nr][nc],
    getNeighbors: ([nr, nc]) => neighbors(nr, nc),
    isOpen: (current) => current.open,
    isFlagged: (current) => current.flagged,
    getRequiredCount: (current) => current.adjacent,
    countFlaggedNeighbors: ([nr, nc]) => countFlaggedNeighbors(nr, nc),
    revealNeighbor: ([nr, nc], neighbor) => {
      const hitsMine = neighbor.mine;
      revealCell(nr, nc);
      return hitsMine;
    },
  });
  if (!result.matched) return;

  if (result.hitMine) {
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
  removeClassFromTargets(chordPreviewCells, "chord-preview", (cell) => cell.el);
  chordPreviewCells = [];
}

function showChordPreview(r, c) {
  clearChordPreview();

  if (gameOver) return;
  const previewCoords = collectChordPreviewCoords([r, c], {
    getCell: ([nr, nc]) => grid[nr][nc],
    getNeighbors: ([nr, nc]) => neighbors(nr, nc),
    isOpen: (cell) => cell.open,
    isFlagged: (cell) => cell.flagged,
    getRequiredCount: (cell) => cell.adjacent,
  });

  for (const [nr, nc] of previewCoords) {
    const neighbor = grid[nr][nc];
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
  forEachBoardCoord(rows, cols, ({ r, c }) => {
    const cell = grid[r][c];
    if (cell.mine) {
      cell.flagged = true;
    }
    if (cell.flagged) flagCount += 1;
    applyCellVisual(cell);
  });

  updateCounters();
}

function serializeGrid() {
  return serializeBitFields(rows, cols, (r, c) => grid[r][c], {
    mines: (cell) => cell.mine,
    open: (cell) => cell.open,
    flags: (cell) => cell.flagged,
  });
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
  return hasValidBitFieldLengths(saved, expectedRows, expectedCols, ["mines", "open", "flags"]);
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

  forEachBitFieldCell(rows, cols, { mines: saved.mines, open: saved.open, flags: saved.flags }, ({ r, c, bits }) => {
    const cell = grid[r][c];
    cell.mine = bits.mines === "1";
    cell.open = bits.open === "1";
    cell.flagged = cell.open ? false : bits.flags === "1";
    if (cell.open && !cell.mine) openedCells += 1;
    if (cell.flagged) flagCount += 1;
  });

  if (started) calculateAdjacents();

  forEachBoardCoord(rows, cols, ({ r, c }) => {
    applyCellVisual(grid[r][c]);
  });

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

  const config =
    customBoardConfig ??
    (saved.difficulty === CUSTOM_DIFFICULTY_KEY
      ? readSavedCustomBoardConfig()
      : DIFFICULTIES[saved.difficulty]);
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
  centerBoardViewport();

  openedCells = 0;
  flagCount = 0;
  forEachBitFieldCell(rows, cols, { mines: saved.mines, open: saved.open, flags: saved.flags }, ({ r, c, bits }) => {
    const cell = grid[r][c];
    const mine = bits.mines === "1";
    const open = bits.open === "1";
    const flagged = bits.flags === "1";

    cell.mine = mine;
    cell.open = open;
    cell.flagged = open ? false : flagged;

    if (cell.open && !cell.mine) openedCells += 1;
    if (cell.flagged) flagCount += 1;
  });

  if (started) {
    calculateAdjacents();
  }

  forEachBoardCoord(rows, cols, ({ r, c }) => {
    applyCellVisual(grid[r][c]);
  });

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
  if (dailyLimitLocked) return;
  if (gameOver) return;
  clearChordPreview();
  consumePendingTouchTapGuess(cellKey(r, c));
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
    const consumeResult = dailyGameLimit?.consumeGame?.();
    if (consumeResult && !consumeResult.ok) {
      lockBoardForDailyLimit(consumeResult);
      return;
    }
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
  if (dailyLimitLocked) return;
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
  if (shouldBlockNewDailyGame()) return;
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
  centerBoardViewport();
  updateCounters();
  saveGameState();
}

window.addEventListener("mouseup", clearChordPreview);
document.addEventListener("visibilitychange", syncTimerWithPageVisibility);
boardShellEl?.addEventListener("scroll", cancelLongPress, { passive: true });
boardShellEl?.addEventListener("touchstart", beginPinchZoom, { passive: false });
boardShellEl?.addEventListener("touchmove", updatePinchZoom, { passive: false });
boardShellEl?.addEventListener("touchend", (event) => {
  if ((event.touches?.length ?? 0) < 2) {
    endPinchZoom();
  }
}, { passive: true });
boardShellEl?.addEventListener("touchcancel", () => {
  endPinchZoom();
}, { passive: true });
boardShellEl?.addEventListener("wheel", (event) => {
  if (!boardShellEl) return;
  if (event.ctrlKey) {
    if (event.cancelable) {
      event.preventDefault();
    }
    const zoomStep = event.deltaY < 0 ? BOARD_ZOOM_STEP : -BOARD_ZOOM_STEP;
    setBoardZoom(boardZoom + zoomStep, { anchorClientX: event.clientX, anchorClientY: event.clientY });
    return;
  }
  if (window.innerWidth <= 900) return;

  const maxHorizontalScroll = boardShellEl.scrollWidth - boardShellEl.clientWidth;
  const maxVerticalScroll = boardShellEl.scrollHeight - boardShellEl.clientHeight;
  const canScrollHorizontally = maxHorizontalScroll > 0;
  const canScrollVertically = maxVerticalScroll > 0;
  if (!canScrollHorizontally && !canScrollVertically) return;

  const prevLeft = boardShellEl.scrollLeft;
  const prevTop = boardShellEl.scrollTop;
  const deltaX = event.deltaX;
  const deltaY = event.deltaY;

  if (canScrollHorizontally && deltaX !== 0) {
    boardShellEl.scrollLeft += deltaX;
  }
  if (canScrollVertically && deltaY !== 0) {
    boardShellEl.scrollTop += deltaY;
  } else if (canScrollHorizontally && deltaX === 0 && deltaY !== 0) {
    boardShellEl.scrollLeft += deltaY;
  }

  const didMove = boardShellEl.scrollLeft !== prevLeft || boardShellEl.scrollTop !== prevTop;
  if (didMove) {
    event.preventDefault();
  }
}, { passive: false });
window.addEventListener("resize", () => {
  scheduleBoardLayout();
});
window.addEventListener("orientationchange", () => {
  scheduleBoardLayout();
});
window.addEventListener("scroll", () => {
  if (window.innerWidth <= 900) {
    scheduleBoardLayout();
  }
}, { passive: true });
window.visualViewport?.addEventListener("resize", scheduleBoardLayout, { passive: true });
window.visualViewport?.addEventListener("scroll", scheduleBoardLayout, { passive: true });
newGameEl.addEventListener("click", newGame);
replayEl.addEventListener("click", undoLoss);
for (const btn of difficultyButtons) {
  btn.addEventListener("click", () => {
    if (customBoardConfig) return;
    const nextDifficulty = btn.dataset.difficulty;
    if (!nextDifficulty) return;
    if (nextDifficulty === CUSTOM_DIFFICULTY_KEY) {
      if (!readSavedCustomBoardConfig()) return;
    } else if (!DIFFICULTIES[nextDifficulty]) {
      return;
    }
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
preloadImageAssets?.(SVG_ASSETS_TO_PRELOAD);
if (shouldBlockNewDailyGame()) {
  updateCounters();
} else if (!restoreGameState()) {
  newGame();
}
scheduleBoardLayout();
