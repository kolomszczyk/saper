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

  function runChordReveal(centerCoord, options) {
    const {
      getCell,
      getNeighbors,
      isOpen,
      isFlagged,
      getRequiredCount,
      countFlaggedNeighbors,
      revealNeighbor,
    } = options;

    const centerCell = getCell(centerCoord);
    if (!centerCell || !isOpen(centerCell)) {
      return { attempted: false, matched: false, hitMine: false };
    }

    const required = getRequiredCount(centerCell);
    if (!(required > 0)) {
      return { attempted: false, matched: false, hitMine: false };
    }

    if (countFlaggedNeighbors(centerCoord) !== required) {
      return { attempted: true, matched: false, hitMine: false };
    }

    let hitMine = false;
    for (const coord of getNeighbors(centerCoord)) {
      const cell = getCell(coord);
      if (!cell || isOpen(cell) || isFlagged(cell)) continue;
      if (revealNeighbor(coord, cell) === true) {
        hitMine = true;
      }
    }

    return { attempted: true, matched: true, hitMine };
  }

  function collectChordPreviewCoords(centerCoord, options) {
    const {
      getCell,
      getNeighbors,
      isOpen,
      isFlagged,
      getRequiredCount,
    } = options;

    const centerCell = getCell(centerCoord);
    if (!centerCell || !isOpen(centerCell)) return [];
    if (!(getRequiredCount(centerCell) > 0)) return [];

    const result = [];
    for (const coord of getNeighbors(centerCoord)) {
      const cell = getCell(coord);
      if (!cell || isOpen(cell) || isFlagged(cell)) continue;
      result.push(coord);
    }
    return result;
  }

  function serializeBitFields(rows, cols, getCell, fieldReaders) {
    const buffers = Object.fromEntries(Object.keys(fieldReaders).map((name) => [name, []]));

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cell = getCell(r, c);
        for (const [fieldName, readField] of Object.entries(fieldReaders)) {
          buffers[fieldName].push(readField(cell, r, c) ? "1" : "0");
        }
      }
    }

    return Object.fromEntries(
      Object.entries(buffers).map(([fieldName, chars]) => [fieldName, chars.join("")]),
    );
  }

  function hasValidBitFieldLengths(payload, rows, cols, fieldNames) {
    const size = Number(rows) * Number(cols);
    if (!Number.isInteger(size) || size <= 0) return false;

    for (const fieldName of fieldNames) {
      if (typeof payload?.[fieldName] !== "string") return false;
      if (payload[fieldName].length !== size) return false;
    }
    return true;
  }

  function hasOnlyBinaryBits(value) {
    return typeof value === "string" && /^[01]*$/.test(value);
  }

  function forEachBitFieldCell(rows, cols, fields, visitCell) {
    let index = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const bits = {};
        for (const [fieldName, source] of Object.entries(fields)) {
          bits[fieldName] = source[index];
        }
        visitCell({ r, c, index, bits });
        index += 1;
      }
    }
  }

  function forEachBoardCoord(rows, cols, visitCell) {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        visitCell({ r, c });
      }
    }
  }

  function removeClassFromTargets(targets, className, getElement = (item) => item) {
    for (const target of targets) {
      const el = getElement(target);
      if (!el) continue;
      el.classList.remove(className);
    }
  }

  function collectCoordPairs(items, predicate, mapItemToCoord) {
    const result = [];
    for (const item of items) {
      if (!predicate(item)) continue;
      result.push(mapItemToCoord(item));
    }
    return result;
  }

  function isValidCoordPair(pair, cols, rows) {
    return (
      Array.isArray(pair) &&
      pair.length === 2 &&
      Number.isInteger(pair[0]) &&
      Number.isInteger(pair[1]) &&
      pair[0] >= 1 &&
      pair[0] <= cols &&
      pair[1] >= 1 &&
      pair[1] <= rows
    );
  }

  function isValidCoordList(list, cols, rows) {
    return Array.isArray(list) && list.every((pair) => isValidCoordPair(pair, cols, rows));
  }

  function coordListToKeySet(list, makeKey) {
    const result = new Set();
    for (const [c, r] of list) {
      result.add(makeKey(c, r));
    }
    return result;
  }

  function hasCoordListFields(payload, fieldNames, cols, rows) {
    return fieldNames.every((fieldName) => isValidCoordList(payload?.[fieldName], cols, rows));
  }

  let preloadedImageAssets = null;

  function preloadImageAssets(assetPaths) {
    if (!Array.isArray(assetPaths) || assetPaths.length === 0) return [];
    if (typeof Image !== "function") return [];

    if (!preloadedImageAssets) {
      preloadedImageAssets = new Map();
    }

    const loadedUrls = [];
    for (const assetPath of assetPaths) {
      if (typeof assetPath !== "string" || assetPath.length === 0) continue;
      const assetUrl = new URL(assetPath, globalScope.location?.href ?? "/").href;
      if (preloadedImageAssets.has(assetUrl)) {
        loadedUrls.push(assetUrl);
        continue;
      }
      const img = new Image();
      img.decoding = "async";
      img.src = assetUrl;
      preloadedImageAssets.set(assetUrl, img);
      loadedUrls.push(assetUrl);
    }

    return loadedUrls;
  }

  globalScope.sharedMinesweeperUtils = {
    collectChordPreviewCoords,
    collectCoordPairs,
    coordListToKeySet,
    forEachBoardCoord,
    forEachBitFieldCell,
    countNeighborsMatching,
    floodRevealZeroArea,
    hasCoordListFields,
    hasOnlyBinaryBits,
    hasValidBitFieldLengths,
    isValidCoordList,
    isValidCoordPair,
    neighborsByBounds,
    preloadImageAssets,
    removeClassFromTargets,
    renderBaseCellVisual,
    runChordReveal,
    serializeBitFields,
    shuffleInPlace,
  };
})(window);
