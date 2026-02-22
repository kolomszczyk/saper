(function attachSharedBoardInput(globalScope) {
  function createBoardInputState(options = {}) {
    const longPressMs = Number(options.longPressMs) || 450;
    const moveTolerance = Number(options.moveTolerance) || 4;
    const defaultSuppressMs = Number(options.suppressMs) || 1200;

    let longPressTimerId = null;
    let longPressPointerId = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    let longPressKey = "";
    let longPressTriggered = false;
    let suppressClickKey = "";
    let suppressClickExpiresAt = 0;
    let suppressContextMenuKey = "";
    let suppressContextMenuExpiresAt = 0;

    function now() {
      return performance.now();
    }

    function clearLongPressState() {
      if (longPressTimerId) {
        clearTimeout(longPressTimerId);
        longPressTimerId = null;
      }
      longPressPointerId = null;
      longPressKey = "";
    }

    function cancelLongPress() {
      clearLongPressState();
      longPressTriggered = false;
    }

    function cleanupSuppression(kind) {
      if (kind === "click") {
        if (suppressClickExpiresAt && now() > suppressClickExpiresAt) {
          suppressClickKey = "";
          suppressClickExpiresAt = 0;
        }
        return;
      }
      if (suppressContextMenuExpiresAt && now() > suppressContextMenuExpiresAt) {
        suppressContextMenuKey = "";
        suppressContextMenuExpiresAt = 0;
      }
    }

    function consumeSuppressedClick(key) {
      cleanupSuppression("click");
      if (suppressClickKey !== key) return false;
      suppressClickKey = "";
      suppressClickExpiresAt = 0;
      return true;
    }

    function consumeSuppressedContextMenu(key) {
      cleanupSuppression("contextmenu");
      if (suppressContextMenuKey !== key) return false;
      suppressContextMenuKey = "";
      suppressContextMenuExpiresAt = 0;
      return true;
    }

    function suppressClickFor(key, durationMs = defaultSuppressMs) {
      suppressClickKey = key;
      suppressClickExpiresAt = now() + durationMs;
    }

    function suppressContextMenuFor(key, durationMs = defaultSuppressMs) {
      suppressContextMenuKey = key;
      suppressContextMenuExpiresAt = now() + durationMs;
    }

    function suppressBothFor(key, durationMs = defaultSuppressMs) {
      suppressClickFor(key, durationMs);
      suppressContextMenuFor(key, durationMs);
    }

    function startLongPress(event, key, onTrigger) {
      cancelLongPress();
      longPressKey = key;
      longPressPointerId = event.pointerId ?? null;
      longPressStartX = Number(event.clientX) || 0;
      longPressStartY = Number(event.clientY) || 0;
      longPressTimerId = setTimeout(() => {
        if (longPressKey !== key) return;
        if (event.pointerId != null && longPressPointerId !== event.pointerId) return;
        longPressTimerId = null;
        longPressTriggered = true;
        suppressBothFor(key);
        if (typeof onTrigger === "function") onTrigger();
      }, longPressMs);
    }

    function updateLongPressMove(event) {
      if (!longPressTimerId) return false;
      if (event.pointerId != null && longPressPointerId != null && event.pointerId !== longPressPointerId) {
        return false;
      }
      const movedX = Math.abs((Number(event.clientX) || 0) - longPressStartX);
      const movedY = Math.abs((Number(event.clientY) || 0) - longPressStartY);
      if (movedX > moveTolerance || movedY > moveTolerance) {
        cancelLongPress();
      }
      return true;
    }

    function endLongPress(options = {}) {
      const pointerId = options.pointerId;
      const key = options.key;

      if (pointerId != null && longPressPointerId != null && pointerId !== longPressPointerId) {
        return null;
      }

      const pressedKey = longPressKey;
      const wasLongPress = longPressTriggered && (key == null || key === longPressKey);
      clearLongPressState();
      longPressTriggered = false;

      return { wasLongPress, pressedKey };
    }

    function getPointerId() {
      return longPressPointerId;
    }

    function getPressedKey() {
      return longPressKey;
    }

    return {
      cancelLongPress,
      consumeSuppressedClick,
      consumeSuppressedContextMenu,
      endLongPress,
      getPointerId,
      getPressedKey,
      startLongPress,
      suppressBothFor,
      suppressClickFor,
      suppressContextMenuFor,
      updateLongPressMove,
    };
  }

  globalScope.createBoardInputState = createBoardInputState;
})(window);
