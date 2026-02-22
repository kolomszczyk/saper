const root = document.documentElement;
const COOKIE_SETTINGS = "saper_settings";
const MADE_COOKIE_STATE = "saper_made_state";
const MADE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const themeButtons = Array.from(document.querySelectorAll(".theme-picker .theme-button"));
const madeWindowPan = document.querySelector(".made-window-pan");
const madeWindow = document.querySelector(".made-window");
const madeBoard = document.getElementById("made-board");
const madeBoardOverlays = document.getElementById("made-board-overlays");
const madeBoardShell = document.querySelector(".made-board-shell");
const madeBoardZoom = document.querySelector(".made-board-zoom");
const madeBoardStack = document.getElementById("made-board-stack");
const resetButton = document.getElementById("made-reset");
const undoButton = document.getElementById("made-undo");
let startTheme = "dark";

const boardCols = 22;
const boardRows = 14;
const allCells = [];
const chordPreviewCells = [];
const state = new Map();
const historyStack = [];
const LONG_PRESS_MS = 450;
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
  collectCoordPairs,
  coordListToKeySet,
  forEachBoardCoord,
  floodRevealZeroArea,
  hasCoordListFields,
  neighborsByBounds,
  removeClassFromTargets,
  renderBaseCellVisual,
  runChordReveal,
  shuffleInPlace,
} = window.sharedMinesweeperUtils;
let revealAllMines = false;
let gameFinished = false;
let dailyLimitLocked = false;
const debugShowMines = false;
const startAsUnplayed = true;
const openReservedTextTilesAtStart = false;
const autoRevealUnderTextOnStart = true;
const autoRevealExtraSafeClicksMin = 2;
const autoRevealExtraSafeClicksMax = 8;
const autoFlagAroundOpenAreaRatio = 0.8;

const staticMinePositions = [
  [2, 2], [4, 3], [6, 4],
  [18, 5], [23, 5],
  [20, 6],
  [3, 7], [9, 7], [16, 7], [22, 7],
  [6, 8], [13, 8], [19, 8], [24, 8],
  [2, 9], [7, 9], [15, 9], [21, 9],
  [4, 10], [10, 10], [17, 10], [23, 10],
  [6, 11], [12, 11], [19, 11], [24, 11],
  [3, 12], [9, 12], [16, 12], [22, 12],
  [5, 13], [11, 13], [18, 13], [24, 13],
  [8, 14], [20, 14],
  [14, 15], [23, 15],
];
const mineCount = 45;
let minePositions = staticMinePositions.map(([c, r]) => [c, r]);
const initialFlagPositions = [
  [2, 8],
  [22, 9],
  [23, 10],
  [19, 11],
  [20, 12],
  [22, 13],
];

const textZones = [
  {
    c: 7,
    r: 4,
    w: 5,
    h: 1,
    text: "build by",
    centerText: true,
    outlinedText: true,
    href: "https://github.com/kolomszczyk",
    openAtStart: false,
    reserveRuns: [{ c: 7, r: 4, w: 5, h: 1 }],
  },
  {
    c: 9,
    r: 5,
    w: 6,
    h: 1,
    text: "kolomszczyk",
    centerText: true,
    outlinedText: true,
    href: "https://github.com/kolomszczyk",
    openAtStart: false,
    reserveRuns: [{ c: 9, r: 5, w: 6, h: 1 }],
  },
  {
    c: 8,
    r: 9,
    w: 9,
    h: 1,
    text: "with Codex AI",
    centerText: true,
    outlinedText: true,
    href: "https://openai.com/codex",
    openAtStart: false,
    reserveRuns: [{ c: 8, r: 9, w: 9, h: 1 }],
  },
  {
    c: 11,
    r: 11,
    w: 2,
    h: 2,
    reserveOnly: true,
    logoType: "github-square",
    href: "https://github.com/kolomszczyk",
    openAtStart: false,
    logoCopies: [
      { c: 9, r: 11, w: 2, h: 2, logoType: "repo", href: "https://github.com/kolomszczyk/saper" },
      { c: 13, r: 11, w: 2, h: 2, logoType: "avatar-square", href: "https://kolomszczyk.github.io/" },
    ],
  },
];
const reservedTextTileKeys = new Set();
const bombExclusionKeys = new Set();

for (const zone of textZones) {
  const runs = zone.reserveRuns ?? [{ c: zone.c, r: zone.r, w: zone.w, h: zone.h }];
  for (const run of runs) {
    for (let rr = run.r; rr < run.r + run.h; rr += 1) {
      for (let cc = run.c; cc < run.c + run.w; cc += 1) {
        if (!inBounds(cc, rr)) continue;
        reservedTextTileKeys.add(`${cc},${rr}`);
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const nc = cc + dc;
            const nr = rr + dr;
            if (!inBounds(nc, nr)) continue;
            bombExclusionKeys.add(`${nc},${nr}`);
          }
        }
      }
    }
  }

  for (const copy of zone.logoCopies ?? []) {
    for (let rr = copy.r; rr < copy.r + copy.h; rr += 1) {
      for (let cc = copy.c; cc < copy.c + copy.w; cc += 1) {
        if (!inBounds(cc, rr)) continue;
        // Keep a 1-tile buffer including diagonals ("corners") around logos too.
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const nc = cc + dc;
            const nr = rr + dr;
            if (!inBounds(nc, nr)) continue;
            bombExclusionKeys.add(`${nc},${nr}`);
          }
        }
      }
    }
  }
}

function loadOrCreateMineLayout() {
  const candidates = [];
  forEachBoardCoord(boardRows, boardCols, ({ r, c }) => {
    const cc = c + 1;
    const rr = r + 1;
    if (bombExclusionKeys.has(key(cc, rr))) return;
    candidates.push([cc, rr]);
  });

  shuffleInPlace(candidates);

  minePositions = candidates.slice(0, Math.min(mineCount, candidates.length));
}

function key(c, r) {
  return `${c},${r}`;
}

function setCookie(name, value, maxAge = MADE_COOKIE_MAX_AGE) {
  writeCookie(name, value, maxAge);
}

function getCookie(name) {
  return readCookie(name);
}

function readSharedSettings() {
  const raw = getCookie(COOKIE_SETTINGS);
  if (!raw) return {};
  try {
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

function getSavedThemeFromSettings() {
  const settings = readSharedSettings();
  return settings.theme === "light" || settings.theme === "dark" ? settings.theme : "dark";
}

function saveThemeToSettings(theme) {
  const settings = readSharedSettings();
  settings.theme = theme;
  setCookie(COOKIE_SETTINGS, JSON.stringify(settings));
}

function getDailyLimitStatus() {
  return dailyGameLimit?.getStatus?.() ?? {
    reached: false,
    remaining: Number.POSITIVE_INFINITY,
    count: 0,
    limit: Number.POSITIVE_INFINITY,
  };
}

function removeMadeDailyLimitMessage() {
  if (!madeBoardStack) return;
  const current = madeBoardStack.querySelector(".daily-limit-message");
  if (current) current.remove();
}

function renderMadeDisabledLimitBoard(_status = getDailyLimitStatus()) {
  if (!madeBoard || !madeBoardOverlays) return;

  // Keep texts/logos visible by reusing the normal board/overlay DOM, then freeze all tiles.
  createBoardDom();
  madeBoard.classList.add("is-daily-limit-board");

  for (const el of allCells) {
    el.className = "cell open daily-limit-cell";
    el.disabled = true;
    el.setAttribute("tabindex", "-1");
    el.setAttribute("aria-hidden", "true");
  }
}

function unlockMadeBoardForDailyLimit() {
  if (!dailyLimitLocked) return;
  dailyLimitLocked = false;
  removeMadeDailyLimitMessage();
  madeBoard?.classList.remove("is-daily-limit-board");
  if (resetButton instanceof HTMLButtonElement) resetButton.disabled = false;
}

function lockMadeBoardForDailyLimit(status = getDailyLimitStatus()) {
  dailyLimitLocked = true;
  clearChordPreview();
  cancelLongPress();
  removeMadeDailyLimitMessage();
  renderMadeDisabledLimitBoard(status);

  if (resetButton instanceof HTMLButtonElement) resetButton.disabled = true;
  if (undoButton instanceof HTMLButtonElement) undoButton.disabled = true;
  requestAnimationFrame(updateMadeBoardMobileScale);
}

function syncMadeBoardAfterDailyLimitSettingsSave() {
  const status = getDailyLimitStatus();

  if (status.reached) {
    lockMadeBoardForDailyLimit(status);
    return;
  }

  if (!dailyLimitLocked) return;

  unlockMadeBoardForDailyLimit();
  createBoardDom();

  if (!restoreGameState()) {
    if (!buildState()) return;
    autoRevealTextZones();
    autoRevealExtraSafeCells();
    autoFlagAroundOpenArea();
  }

  renderBoard();
  saveGameState();
  requestAnimationFrame(updateMadeBoardMobileScale);
}

function isReservedTextTile(c, r) {
  return reservedTextTileKeys.has(key(c, r));
}

function inBounds(c, r) {
  return c >= 1 && c <= boardCols && r >= 1 && r <= boardRows;
}

function neighbors(c, r) {
  return neighborsByBounds(c, r, inBounds);
}

function buildState(reuseCurrentMineLayout = false) {
  if (!reuseCurrentMineLayout) {
    const consumeResult = dailyGameLimit?.consumeGame?.();
    if (consumeResult && !consumeResult.ok) {
      lockMadeBoardForDailyLimit(consumeResult);
      return false;
    }
  }

  unlockMadeBoardForDailyLimit();
  state.clear();
  revealAllMines = false;
  gameFinished = false;
  historyStack.length = 0;
  if (!reuseCurrentMineLayout) loadOrCreateMineLayout();

  forEachBoardCoord(boardRows, boardCols, ({ r, c }) => {
    const cc = c + 1;
    const rr = r + 1;
    state.set(key(cc, rr), {
      c: cc,
      r: rr,
      mine: false,
      count: 0,
      open: false,
      flagged: false,
    });
  });

  for (const [c, r] of minePositions) {
    const cell = state.get(key(c, r));
    if (cell) cell.mine = true;
  }

  if (!startAsUnplayed) {
    for (const [c, r] of initialFlagPositions) {
      const cell = state.get(key(c, r));
      if (cell && !cell.open) cell.flagged = true;
    }
  }

  forEachBoardCoord(boardRows, boardCols, ({ r, c }) => {
    const cc = c + 1;
    const rr = r + 1;
    const cell = state.get(key(cc, rr));
    if (!cell || cell.mine) return;
    let count = 0;
    for (const [nc, nr] of neighbors(cc, rr)) {
      if (state.get(key(nc, nr))?.mine) count += 1;
    }
    cell.count = count;
  });

  for (const zone of textZones) {
    if (!openReservedTextTilesAtStart && !zone.openAtStart) continue;
    const runs = zone.reserveRuns ?? [{ c: zone.c, r: zone.r, w: zone.w, h: zone.h }];
    for (const run of runs) {
      for (let rr = run.r; rr < run.r + run.h; rr += 1) {
        for (let cc = run.c; cc < run.c + run.w; cc += 1) {
          if (!inBounds(cc, rr)) continue;
          const cell = state.get(key(cc, rr));
          if (!cell) continue;
          cell.open = true;
        }
      }
    }
  }

  return true;
}

function snapshotState() {
  return {
    revealAllMines,
    gameFinished,
    cells: Array.from(state.values(), (cell) => ({
      c: cell.c,
      r: cell.r,
      open: cell.open,
      flagged: cell.flagged,
    })),
  };
}

function buildMadeStatePayload() {
  return {
    rows: boardRows,
    cols: boardCols,
    savedAt: Date.now(),
    elapsed: 0,
    revealAllMines,
    gameFinished,
    mines: collectCoordPairs(state.values(), (cell) => cell.mine, (cell) => [cell.c, cell.r]),
    open: collectCoordPairs(state.values(), (cell) => cell.open, (cell) => [cell.c, cell.r]),
    flags: collectCoordPairs(state.values(), (cell) => cell.flagged, (cell) => [cell.c, cell.r]),
  };
}

function buildUndoSnapshotPayload(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.cells)) return null;
  const open = [];
  const flags = [];
  for (const item of snapshot.cells) {
    if (!item) continue;
    if (item.open) open.push([item.c, item.r]);
    if (item.flagged) flags.push([item.c, item.r]);
  }

  return {
    rows: boardRows,
    cols: boardCols,
    savedAt: Date.now(),
    elapsed: 0,
    revealAllMines: Boolean(snapshot.revealAllMines),
    gameFinished: Boolean(snapshot.gameFinished),
    open,
    flags,
  };
}

function restoreUndoSnapshotPayload(payload) {
  if (
    !payload ||
    Number(payload.rows ?? boardRows) !== boardRows ||
    Number(payload.cols ?? boardCols) !== boardCols ||
    !hasCoordListFields(payload, ["open", "flags"], boardCols, boardRows)
  ) {
    return null;
  }

  const openKeys = coordListToKeySet(payload.open, key);
  const flagKeys = coordListToKeySet(payload.flags, key);

  const cells = [];
  forEachBoardCoord(boardRows, boardCols, ({ r, c }) => {
    const cc = c + 1;
    const rr = r + 1;
    const k = key(cc, rr);
    cells.push({
      c: cc,
      r: rr,
      open: openKeys.has(k),
      flagged: flagKeys.has(k),
    });
  });

  return {
    revealAllMines: Boolean(payload.revealAllMines),
    gameFinished: Boolean(payload.gameFinished),
    cells,
  };
}

function saveGameState() {
  if (state.size === 0) return;
  const isLost = gameFinished && revealAllMines;
  const persistedUndo = isLost && historyStack.length > 0
    ? buildUndoSnapshotPayload(historyStack[historyStack.length - 1])
    : null;
  const payload = {
    v: 2,
    rows: boardRows,
    cols: boardCols,
    data: buildMadeStatePayload(),
    undo: persistedUndo,
  };
  setCookie(MADE_COOKIE_STATE, JSON.stringify(payload));
}

function restoreGameState() {
  const raw = getCookie(MADE_COOKIE_STATE);
  if (!raw) return false;

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return false;
  }

  if (
    !saved ||
    saved.v !== 2 ||
    Number(saved.rows) !== boardRows ||
    Number(saved.cols) !== boardCols ||
    !saved.data
  ) {
    return false;
  }

  const isTextCoordData =
    hasCoordListFields(saved.data, ["mines", "open", "flags"], boardCols, boardRows);
  if (!isTextCoordData) return false;

  const restoredMinePositions = [];
  const openKeys = new Set();
  const flagKeys = new Set();

  for (const pair of saved.data.mines) restoredMinePositions.push(pair);
  for (const [c, r] of saved.data.open) openKeys.add(key(c, r));
  for (const [c, r] of saved.data.flags) flagKeys.add(key(c, r));

  minePositions = restoredMinePositions;
  if (!buildState(true)) return false;
  revealAllMines = Boolean(saved.data.revealAllMines);
  gameFinished = Boolean(saved.data.gameFinished);
  for (const cell of state.values()) {
    const k = key(cell.c, cell.r);
    cell.open = openKeys.has(k);
    cell.flagged = flagKeys.has(k);
  }
  historyStack.length = 0;
  const isLost = gameFinished && revealAllMines;
  const restoredUndo = isLost ? restoreUndoSnapshotPayload(saved.undo) : null;
  if (restoredUndo) {
    historyStack.push(restoredUndo);
  }
  return true;
}

function restoreSnapshot(snapshot) {
  if (!snapshot) return;
  revealAllMines = snapshot.revealAllMines;
  gameFinished = snapshot.gameFinished;
  for (const item of snapshot.cells) {
    const cell = state.get(key(item.c, item.r));
    if (!cell) continue;
    cell.open = item.open;
    cell.flagged = item.flagged;
  }
}

function pushHistory() {
  historyStack.push(snapshotState());
  if (historyStack.length > 100) historyStack.shift();
}

function undoLastMove() {
  const snapshot = historyStack.pop();
  if (!snapshot) return;
  restoreSnapshot(snapshot);
  renderBoard();
  saveGameState();
}

function resetGame() {
  if (dailyLimitLocked) return;
  if (!buildState()) return;
  autoRevealTextZones();
  autoRevealExtraSafeCells();
  autoFlagAroundOpenArea();
  renderBoard();
  saveGameState();
}

function autoRevealTextZones() {
  if (!autoRevealUnderTextOnStart) return;

  for (const zone of textZones) {
    if (zone.reserveOnly) continue; // skip logo zones
    const runs = zone.reserveRuns ?? [{ c: zone.c, r: zone.r, w: zone.w, h: zone.h }];
    for (const run of runs) {
      for (let rr = run.r; rr < run.r + run.h; rr += 1) {
        for (let cc = run.c; cc < run.c + run.w; cc += 1) {
          if (!inBounds(cc, rr)) continue;
          const cell = state.get(key(cc, rr));
          if (!cell || cell.open || cell.flagged || cell.mine) continue;
          if (cell.count === 0) {
            revealZeros(cell);
          } else {
            cell.open = true;
          }
        }
      }
    }
  }

  checkWin();
}

function autoFlagAroundOpenArea() {
  if (!(autoFlagAroundOpenAreaRatio > 0)) return;

  const borderMineCells = [];
  const seen = new Set();

  for (const cell of state.values()) {
    if (!cell.open) continue;
    for (const [nc, nr] of neighbors(cell.c, cell.r)) {
      const k = key(nc, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      const next = state.get(k);
      if (!next || next.open || !next.mine) continue;
      borderMineCells.push(next);
    }
  }

  if (borderMineCells.length === 0) return;

  const targetCount = Math.ceil(borderMineCells.length * autoFlagAroundOpenAreaRatio);
  for (let i = borderMineCells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [borderMineCells[i], borderMineCells[j]] = [borderMineCells[j], borderMineCells[i]];
  }

  for (let i = 0; i < targetCount; i += 1) {
    borderMineCells[i].flagged = true;
  }
}

function autoRevealExtraSafeCells() {
  if (!(autoRevealExtraSafeClicksMax > 0)) return;
  if (gameFinished) return;

  const candidates = [];
  const seen = new Set();
  for (const openCellRef of state.values()) {
    if (!openCellRef.open) continue;
    for (const [nc, nr] of neighbors(openCellRef.c, openCellRef.r)) {
      const k = key(nc, nr);
      if (seen.has(k)) continue;
      seen.add(k);
      const cell = state.get(k);
      if (!cell || cell.open || cell.flagged || cell.mine) continue;
      candidates.push(cell);
    }
  }
  if (candidates.length === 0) return;

  // Shuffle so the extra clicks are truly random and look natural.
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const minClicks = Math.max(0, Math.min(autoRevealExtraSafeClicksMin, autoRevealExtraSafeClicksMax));
  const maxClicks = Math.max(minClicks, autoRevealExtraSafeClicksMax);
  const randomClicks = minClicks + Math.floor(Math.random() * (maxClicks - minClicks + 1));
  const clickCount = Math.min(randomClicks, candidates.length);
  for (let i = 0; i < clickCount; i += 1) {
    const cell = candidates[i];
    if (!cell || cell.open || cell.flagged || cell.mine) continue;
    if (cell.count === 0) {
      revealZeros(cell);
    } else {
      cell.open = true;
    }
  }

  checkWin();
}

function createBoardDom() {
  if (!madeBoard || !madeBoardOverlays) return;
  removeMadeDailyLimitMessage();
  madeBoard.classList.remove("is-daily-limit-board");
  madeBoard.innerHTML = "";
  madeBoardOverlays.innerHTML = "";
  allCells.length = 0;

  forEachBoardCoord(boardRows, boardCols, ({ r, c }) => {
    const cc = c + 1;
    const rr = r + 1;
    const index = r * boardCols + cc;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "cell";
    el.dataset.c = String(cc);
    el.dataset.r = String(rr);
    el.dataset.index = String(index);
    el.setAttribute("role", "gridcell");
    el.setAttribute("aria-label", `Cell ${index} (${cc}, ${rr})`);
    madeBoard.append(el);
    allCells.push(el);
  });

  for (const zone of textZones) {
    if (!zone.reserveOnly) {
      const parts = zone.parts ?? [{ c: zone.c, r: zone.r, w: zone.w, h: zone.h, text: zone.text }];
      for (const part of parts) {
        const overlay = document.createElement("div");
        overlay.className = `made-board-overlay${zone.isLink ? " is-link" : ""}${zone.outlinedText ? " is-text-outline" : ""}`;
        if (zone.href) overlay.classList.add("is-text-clickable");
        overlay.style.gridColumn = `${part.c} / span ${part.w}`;
        overlay.style.gridRow = `${part.r} / span ${part.h}`;
        if (zone.centerText) {
          overlay.style.justifyContent = "center";
          overlay.style.textAlign = "center";
          overlay.style.paddingLeft = "0";
        }

        if (zone.href) {
          const link = document.createElement("a");
          link.href = zone.href;
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          link.textContent = part.text;
          link.setAttribute("aria-label", `Open link: ${part.text}`);
          overlay.append(link);
        } else if (zone.isLink) {
          const link = document.createElement("a");
          link.href = "https://github.com/kolomszczyk/saper";
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          link.textContent = part.text;
          overlay.append(link);
        } else {
          overlay.textContent = part.text;
        }

        madeBoardOverlays.append(overlay);
      }
    } else {
      const overlay = document.createElement("div");
      const mainLogoType = zone.logoType ?? "github";
      overlay.className = `made-board-overlay is-logo${mainLogoType !== "github" ? " is-repo-logo" : ""}`;
      overlay.style.gridColumn = `${zone.c} / span ${zone.w}`;
      overlay.style.gridRow = `${zone.r} / span ${zone.h}`;
      if (zone.href) {
        overlay.classList.add("is-clickable");
        const link = document.createElement("a");
        link.href = zone.href;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        link.setAttribute("aria-label", "Open GitHub profile");
        link.innerHTML = getMadeLogoSvg(mainLogoType);
        overlay.append(link);
      } else {
        overlay.setAttribute("aria-hidden", "true");
        overlay.innerHTML = getMadeLogoSvg(mainLogoType);
      }
      madeBoardOverlays.append(overlay);

      for (const copy of zone.logoCopies ?? []) {
        const copyOverlay = document.createElement("div");
        const copyLogoType = copy.logoType ?? "github";
        copyOverlay.className = `made-board-overlay is-logo${copyLogoType !== "github" ? " is-repo-logo" : ""}`;
        copyOverlay.style.gridColumn = `${copy.c} / span ${copy.w}`;
        copyOverlay.style.gridRow = `${copy.r} / span ${copy.h}`;
        if (copy.href) {
          copyOverlay.classList.add("is-clickable");
          const link = document.createElement("a");
          link.href = copy.href;
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          link.setAttribute("aria-label", "Open repository");
          link.innerHTML = getMadeLogoSvg(copyLogoType);
          copyOverlay.append(link);
        } else {
          copyOverlay.setAttribute("aria-hidden", "true");
          copyOverlay.innerHTML = getMadeLogoSvg(copyLogoType);
        }
        madeBoardOverlays.append(copyOverlay);
      }
    }
  }
}

function getMadeLogoSvg(type) {
  if (type === "repo") {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="5" y="5" width="54" height="54" rx="10" ry="10" fill="#000000" stroke="#000000" stroke-width="2"/><rect x="8" y="8" width="48" height="48" rx="8" ry="8" fill="none" stroke="var(--digit-red)" stroke-width="1.8"/><g fill="none" stroke="var(--digit-red)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M27 22v20"/><path d="M27 33c8 0 13-2 13-8"/><path d="M27 33c10 0 14 4 17 12"/></g><circle cx="27" cy="22" r="3.2" fill="#000000" stroke="var(--digit-red)" stroke-width="2"/><circle cx="40" cy="25" r="3.2" fill="#000000" stroke="var(--digit-red)" stroke-width="2"/><circle cx="27" cy="42" r="3.2" fill="#000000" stroke="var(--digit-red)" stroke-width="2"/><circle cx="44" cy="45" r="3.2" fill="#000000" stroke="var(--digit-red)" stroke-width="2"/></svg>';
  }

  if (type === "github-square") {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="5" y="5" width="54" height="54" rx="10" ry="10" fill="#000000" stroke="#000000" stroke-width="2"/><rect x="8" y="8" width="48" height="48" rx="8" ry="8" fill="none" stroke="var(--digit-red)" stroke-width="1.8"/><path fill="var(--digit-red)" d="M32 17.5c-8.01 0-14.5 6.49-14.5 14.5 0 6.41 4.16 11.85 9.93 13.76.79.15 1.08-.34 1.08-.76v-2.68c-4.04.88-4.89-1.71-4.89-1.71-.66-1.67-1.61-2.11-1.61-2.11-1.31-.9.1-.88.1-.88 1.45.1 2.21 1.49 2.21 1.49 1.29 2.2 3.39 1.56 4.21 1.19.13-.9.5-1.52.91-1.87-3.23-.37-6.62-1.62-6.62-7.18 0-1.58.57-2.88 1.49-3.89-.15-.37-.64-1.89.14-3.93 0 0 1.22-.39 4 .15a13.9 13.9 0 0 1 7.29 0c2.77-.54 3.99-.15 3.99-.15.79 2.04.3 3.56.15 3.93.93 1.01 1.49 2.31 1.49 3.89 0 5.58-3.4 6.81-6.64 7.17.52.45.99 1.33.99 2.68v3.97c0 .42.29.92 1.09.76A14.51 14.51 0 0 0 46.5 32c0-8.01-6.49-14.5-14.5-14.5Z"/></svg>';
  }

  if (type === "avatar-square") {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="5" y="5" width="54" height="54" rx="10" ry="10" fill="#000000" stroke="#000000" stroke-width="2"/><rect x="8" y="8" width="48" height="48" rx="8" ry="8" fill="none" stroke="var(--digit-red)" stroke-width="1.8"/><circle cx="32" cy="28" r="8" fill="none" stroke="var(--digit-red)" stroke-width="3"/><path d="M20 47c2.8-6 8.1-9 12-9s9.2 3 12 9" fill="none" stroke="var(--digit-red)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.35c-2.24.49-2.71-.95-2.71-.95-.36-.93-.9-1.17-.9-1.17-.73-.5.06-.49.06-.49.8.06 1.22.82 1.22.82.72 1.2 1.87.86 2.33.66.07-.5.28-.85.5-1.05-1.78-.2-3.64-.88-3.64-3.9 0-.86.31-1.56.82-2.11-.08-.2-.35-1.02.08-2.12 0 0 .67-.21 2.2.8A7.7 7.7 0 0 1 8 4.07c.68 0 1.37.09 2.01.27 1.53-1.01 2.2-.8 2.2-.8.43 1.1.16 1.92.08 2.12.51.55.82 1.25.82 2.11 0 3.03-1.87 3.7-3.65 3.9.29.24.54.73.54 1.48v2.2c0 .21.14.46.55.38A8 8 0 0 0 8 0Z"/></svg>';
}

function revealZeros(startCell) {
  floodRevealZeroArea([startCell.c, startCell.r], {
    getKey: ([c, r]) => key(c, r),
    getNeighbors: ([c, r]) => neighbors(c, r),
    getCell: ([c, r]) => state.get(key(c, r)),
    isOpen: (cell) => cell.open,
    isFlagged: (cell) => cell.flagged,
    isMine: (cell) => cell.mine,
    getCount: (cell) => cell.count,
    openCell: (cell) => {
      cell.open = true;
    },
  });
}

function revealAllBombs() {
  revealAllMines = true;
  for (const cell of state.values()) {
    if (cell.mine && !cell.flagged) cell.open = true;
  }
}

function countFlaggedNeighbors(c, r) {
  return countNeighborsMatching(neighbors(c, r), ([nc, nr]) => state.get(key(nc, nr))?.flagged);
}

function cancelLongPress() {
  boardInput.cancelLongPress();
}

function consumeSuppressedClick(c, r) {
  return boardInput.consumeSuppressedClick(key(c, r));
}

function shouldSuppressContextMenu(c, r) {
  return boardInput.consumeSuppressedContextMenu(key(c, r));
}

function startMouseLongPress(event, c, r) {
  boardInput.startLongPress(event, key(c, r), () => {
    clearChordPreview();
    toggleFlag(c, r);
  });
}

function updateMouseLongPress(event) {
  boardInput.updateLongPressMove(event);
}

function endMouseLongPress() {
  return boardInput.endLongPress()?.wasLongPress ?? false;
}

function getBoardCellFromEventTarget(target) {
  if (!(target instanceof HTMLElement)) return null;
  const cellEl = target.closest(".cell");
  return cellEl instanceof HTMLButtonElement ? cellEl : null;
}

function onBoardPointerDown(event) {
  if (!event.isPrimary) return;
  if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
  const cellEl = getBoardCellFromEventTarget(event.target);
  if (!cellEl) return;
  const c = Number(cellEl.dataset.c);
  const r = Number(cellEl.dataset.r);
  showChordPreview(c, r);
  startMouseLongPress(event, c, r);
}

function onBoardPointerMove(event) {
  if (!event.isPrimary) return;
  if (event.pointerId !== boardInput.getPointerId()) return;
  updateMouseLongPress(event);
}

function onBoardPointerUpOrCancel(event) {
  if (!event.isPrimary) return;
  if (event.pointerId !== boardInput.getPointerId()) return;
  const pressedCellKey = boardInput.getPressedKey();
  const cellEl = event.type === "pointerup" ? getBoardCellFromEventTarget(event.target) : null;
  clearChordPreview();
  const result = boardInput.endLongPress({ pointerId: event.pointerId });
  const wasLongPress = result?.wasLongPress ?? false;
  if (wasLongPress && event.cancelable) {
    event.preventDefault();
    return;
  }
  if (event.type !== "pointerup") return;
  if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
  if (!cellEl) return;

  const c = Number(cellEl.dataset.c);
  const r = Number(cellEl.dataset.r);
  if (pressedCellKey !== key(c, r)) return;
  if (consumeSuppressedClick(c, r)) return;

  boardInput.suppressClickFor(key(c, r), 400);
  openCell(c, r);
  if (event.cancelable) {
    event.preventDefault();
  }
}

function clearChordPreview() {
  removeClassFromTargets(chordPreviewCells, "chord-preview");
  chordPreviewCells.length = 0;
}

function showChordPreview(c, r) {
  clearChordPreview();
  if (gameFinished) return;
  const previewCoords = collectChordPreviewCoords([c, r], {
    getCell: ([nc, nr]) => state.get(key(nc, nr)),
    getNeighbors: ([nc, nr]) => neighbors(nc, nr),
    isOpen: (cell) => cell.open,
    isFlagged: (cell) => cell.flagged,
    getRequiredCount: (cell) => cell.count,
  });

  for (const [nc, nr] of previewCoords) {
    const el = allCells.find((button) => Number(button.dataset.c) === nc && Number(button.dataset.r) === nr);
    if (!el) continue;
    el.classList.add("chord-preview");
    chordPreviewCells.push(el);
  }
}

function chordOpenCell(c, r) {
  if (dailyLimitLocked) return;
  if (gameFinished) return;
  const result = runChordReveal([c, r], {
    getCell: ([nc, nr]) => state.get(key(nc, nr)),
    getNeighbors: ([nc, nr]) => neighbors(nc, nr),
    isOpen: (current) => current.open,
    isFlagged: (current) => current.flagged,
    getRequiredCount: (current) => current.count,
    countFlaggedNeighbors: ([nc, nr]) => countFlaggedNeighbors(nc, nr),
    revealNeighbor: (_coord, next) => {
      if (next.mine) {
        next.open = true;
        return true;
      }
      if (next.count === 0) {
        revealZeros(next);
      } else {
        next.open = true;
      }
      return false;
    },
  });
  if (!result.matched) return;

  if (result.hitMine) {
    gameFinished = true;
    revealAllBombs();
  } else {
    checkWin();
  }

  clearChordPreview();
  renderBoard();
  saveGameState();
}

function checkWin() {
  for (const cell of state.values()) {
    if (!cell.mine && !cell.open) return false;
  }
  gameFinished = true;
  for (const cell of state.values()) {
    if (cell.mine) cell.flagged = true;
  }
  return true;
}

function openCell(c, r) {
  if (dailyLimitLocked) return;
  if (gameFinished) return;
  const cell = state.get(key(c, r));
  if (!cell) return;
  if (cell.open) {
    pushHistory();
    chordOpenCell(c, r);
    return;
  }
  if (cell.flagged) return;
  pushHistory();

  if (cell.mine) {
    cell.open = true;
    gameFinished = true;
    revealAllBombs();
    renderBoard();
    saveGameState();
    return;
  }

  if (cell.count === 0) {
    revealZeros(cell);
  } else {
    cell.open = true;
  }

  checkWin();
  renderBoard();
  saveGameState();
}

function toggleFlag(c, r) {
  if (dailyLimitLocked) return;
  if (gameFinished) return;
  const cell = state.get(key(c, r));
  if (!cell || cell.open) return;
  pushHistory();
  cell.flagged = !cell.flagged;
  renderBoard();
  saveGameState();
}

function renderBoard() {
  if (dailyLimitLocked) {
    if (undoButton instanceof HTMLButtonElement) {
      undoButton.disabled = true;
    }
    return;
  }
  for (const el of allCells) {
    const c = Number(el.dataset.c);
    const r = Number(el.dataset.r);
    const cell = state.get(key(c, r));
    if (!cell) continue;
    const reservedTextTile = isReservedTextTile(c, r);

    renderBaseCellVisual(el, {
      isOpen: cell.open,
      isFlagged: cell.flagged,
      showMine: cell.open && cell.mine && revealAllMines,
      count: cell.count,
      wrongFlag: gameFinished && revealAllMines && cell.flagged && !cell.mine,
    });

    if (reservedTextTile && cell.open) {
      el.classList.add("is-text-reserved");
    }

    if (debugShowMines && cell.mine) {
      el.classList.add("debug-mine");
    }
  }

  if (undoButton instanceof HTMLButtonElement) {
    undoButton.disabled = historyStack.length === 0;
  }
}

function setTheme(theme) {
  root.dataset.theme = theme;
  saveThemeToSettings(theme);
  for (const button of themeButtons) {
    const active = button.dataset.theme === theme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function updateMadeBoardMobileScale() {
  if (!madeWindow || !madeBoardShell || !madeBoardZoom || !madeBoardStack) return;

  const boardWidth = madeBoardStack.offsetWidth;
  const boardHeight = madeBoardStack.offsetHeight;
  let scale = 1;

  const isTouchMobileLayout =
    window.innerWidth <= 900 &&
    (window.matchMedia("(hover: none)").matches || window.matchMedia("(pointer: coarse)").matches);

  if (isTouchMobileLayout) {
    const bodyStyles = getComputedStyle(document.body);
    const bodyPadX =
      parseFloat(bodyStyles.paddingLeft || "0") + parseFloat(bodyStyles.paddingRight || "0");
    const panStyles = madeWindowPan ? getComputedStyle(madeWindowPan) : null;
    const panInsetX = panStyles
      ? parseFloat(panStyles.paddingLeft || "0") + parseFloat(panStyles.paddingRight || "0")
      : 0;
    const windowStyles = getComputedStyle(madeWindow);
    const windowInsetX =
      parseFloat(windowStyles.paddingLeft || "0") +
      parseFloat(windowStyles.paddingRight || "0") +
      parseFloat(windowStyles.borderLeftWidth || "0") +
      parseFloat(windowStyles.borderRightWidth || "0");
    const shellStyles = getComputedStyle(madeBoardShell);
    const shellInsetX =
      parseFloat(shellStyles.paddingLeft || "0") + parseFloat(shellStyles.paddingRight || "0");
    const shellInsetY =
      parseFloat(shellStyles.paddingTop || "0") +
      parseFloat(shellStyles.paddingBottom || "0") +
      parseFloat(shellStyles.borderTopWidth || "0") +
      parseFloat(shellStyles.borderBottomWidth || "0");

    const availableWidth = Math.max(120, window.innerWidth - bodyPadX - panInsetX - windowInsetX - shellInsetX);
    const shellTop = madeBoardShell.getBoundingClientRect().top;
    const availableHeight = Math.max(120, window.innerHeight - shellTop - 16 - shellInsetY);

    scale = Math.min(1, availableWidth / Math.max(1, boardWidth), availableHeight / Math.max(1, boardHeight));
  }

  madeBoardZoom.style.width = `${Math.ceil(boardWidth * scale)}px`;
  madeBoardZoom.style.height = `${Math.ceil(boardHeight * scale)}px`;
  madeBoardZoom.style.setProperty("--made-board-scale", String(scale));
}

for (const button of themeButtons) {
  button.addEventListener("click", () => setTheme(button.dataset.theme));
}

const initialDailyLimitStatus = getDailyLimitStatus();
let madeBoardInitialized = false;

if (initialDailyLimitStatus.reached) {
  lockMadeBoardForDailyLimit(initialDailyLimitStatus);
} else {
  createBoardDom();
  if (restoreGameState()) {
    madeBoardInitialized = true;
  } else if (buildState()) {
    autoRevealTextZones();
    autoRevealExtraSafeCells();
    autoFlagAroundOpenArea();
    madeBoardInitialized = true;
  }
}

if (madeBoardInitialized) {
  renderBoard();
  saveGameState();
  requestAnimationFrame(updateMadeBoardMobileScale);
}

if (madeBoard) {
  madeBoard.addEventListener("click", (event) => {
    const cellEl = getBoardCellFromEventTarget(event.target);
    if (!cellEl) return;
    clearChordPreview();
    const c = Number(cellEl.dataset.c);
    const r = Number(cellEl.dataset.r);
    if (consumeSuppressedClick(c, r)) return;
    openCell(c, r);
  });

  madeBoard.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    const cellEl = getBoardCellFromEventTarget(event.target);
    if (!cellEl) return;
    const c = Number(cellEl.dataset.c);
    const r = Number(cellEl.dataset.r);
    showChordPreview(c, r);
    startMouseLongPress(event, c, r);
  });

  madeBoard.addEventListener("pointerdown", onBoardPointerDown);
  madeBoard.addEventListener("pointermove", onBoardPointerMove);
  madeBoard.addEventListener("pointerup", onBoardPointerUpOrCancel);
  madeBoard.addEventListener("pointercancel", onBoardPointerUpOrCancel);
  madeBoard.addEventListener("pointerleave", () => {
    clearChordPreview();
    cancelLongPress();
  });

  madeBoard.addEventListener("mousemove", updateMouseLongPress);

  madeBoard.addEventListener("mouseup", () => {
    clearChordPreview();
    endMouseLongPress();
  });

  madeBoard.addEventListener("mouseleave", () => {
    clearChordPreview();
    cancelLongPress();
  });

  madeBoard.addEventListener("contextmenu", (event) => {
    const cellEl = getBoardCellFromEventTarget(event.target);
    if (!cellEl) return;
    event.preventDefault();
    clearChordPreview();
    const c = Number(cellEl.dataset.c);
    const r = Number(cellEl.dataset.r);
    if (shouldSuppressContextMenu(c, r)) return;
    toggleFlag(c, r);
  });

  madeBoard.addEventListener("touchstart", (event) => {
    if (event.touches.length > 1) {
      clearChordPreview();
      cancelLongPress();
    }
  }, { passive: true });
  madeBoard.addEventListener("touchmove", () => {
    clearChordPreview();
    cancelLongPress();
  }, { passive: true });
  madeBoard.addEventListener("touchend", cancelLongPress, { passive: true });
  madeBoard.addEventListener("touchcancel", cancelLongPress, { passive: true });
}

if (resetButton instanceof HTMLButtonElement) {
  resetButton.addEventListener("click", resetGame);
}

if (undoButton instanceof HTMLButtonElement) {
  undoButton.addEventListener("click", undoLastMove);
}

window.addEventListener("resize", () => requestAnimationFrame(updateMadeBoardMobileScale));
window.addEventListener("orientationchange", () => requestAnimationFrame(updateMadeBoardMobileScale));
window.addEventListener("mouseup", cancelLongPress);
window.addEventListener("pointerup", cancelLongPress);
window.addEventListener("pointercancel", cancelLongPress);
window.addEventListener("saper:daily-limit-settings-saved", syncMadeBoardAfterDailyLimitSettingsSave);

startTheme = getSavedThemeFromSettings();
setTheme(startTheme);
