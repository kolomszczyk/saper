(function attachSharedMinesweeperUtils(globalScope) {
  function neighborsByBounds(a, b, inBounds) {
    const result = [];
    for (let da = -1; da <= 1; da += 1) {
      for (let db = -1; db <= 1; db += 1) {
        if (da === 0 && db === 0) continue;
        const na = a + da;
        const nb = b + db;
        if (inBounds(na, nb)) result.push([na, nb]);
      }
    }
    return result;
  }

  function shuffleInPlace(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function countNeighborsMatching(neighborCoords, predicate) {
    let total = 0;
    for (const coords of neighborCoords) {
      if (predicate(coords)) total += 1;
    }
    return total;
  }

  function floodRevealZeroArea(startCoord, options) {
    const {
      getKey,
      getNeighbors,
      getCell,
      isOpen,
      isFlagged,
      isMine,
      getCount,
      openCell,
    } = options;

    const queue = [startCoord];
    const seen = new Set([getKey(startCoord)]);

    while (queue.length > 0) {
      const coord = queue.shift();
      const cell = getCell(coord);
      if (!cell || isFlagged(cell)) continue;

      if (!isOpen(cell)) {
        openCell(cell, coord);
      }

      if (isMine(cell) || getCount(cell) !== 0) continue;

      for (const nextCoord of getNeighbors(coord)) {
        const nextCell = getCell(nextCoord);
        if (!nextCell || isOpen(nextCell) || isFlagged(nextCell) || isMine(nextCell)) continue;

        openCell(nextCell, nextCoord);

        if (getCount(nextCell) !== 0) continue;
        const nextKey = getKey(nextCoord);
        if (seen.has(nextKey)) continue;
        seen.add(nextKey);
        queue.push(nextCoord);
      }
    }
  }

  function renderBaseCellVisual(el, options) {
    const {
      isOpen,
      isFlagged,
      showMine = false,
      count = 0,
      wrongFlag = false,
      baseClass = "cell",
    } = options;

    el.className = baseClass;
    el.textContent = "";

    if (isOpen) {
      el.classList.add("open");
      if (showMine) {
        el.classList.add("mine");
        return;
      }
      if (count > 0) {
        el.classList.add(`n${count}`);
        el.textContent = String(count);
      }
      return;
    }

    if (isFlagged) {
      el.classList.add("flagged");
      if (wrongFlag) {
        el.classList.add("wrong-flag");
      }
    }
  }

  globalScope.sharedMinesweeperUtils = {
    countNeighborsMatching,
    floodRevealZeroArea,
    neighborsByBounds,
    renderBaseCellVisual,
    shuffleInPlace,
  };
})(window);
