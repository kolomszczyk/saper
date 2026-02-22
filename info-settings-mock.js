(() => {
  const DIGITS = 4;
  const MIN_VALUE = 0;
  const MAX_VALUE = 500;
  const SAVE_PRESSED_MS = 3000;
  const SETTINGS_COOKIE = "saper_settings";
  const SETTINGS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
  const selector = "#map-width, #map-height, #games-per-day, #bomb-count";
  const inputs = Array.from(document.querySelectorAll(selector));
  const customMapToggle = document.getElementById("custom-map");
  const mapWidthInput = document.getElementById("map-width");
  const mapHeightInput = document.getElementById("map-height");
  const bombCountInput = document.getElementById("bomb-count");
  const gamesPerDayInput = document.getElementById("games-per-day");
  const saveButton = document.querySelector(".info-settings-save");
  const customMapSwitch = customMapToggle?.closest(".info-settings-switch");
  const leftColumn = document.querySelector(".info-settings-left-col");
  const bombCountField = document.querySelector(".info-settings-bombs-field");
  const dailyGameLimit = window.sharedDailyGameLimit;
  const cookies = window.sharedCookies;
  const customMapControlledInputs = [
    document.getElementById("map-width"),
    document.getElementById("map-height"),
    document.getElementById("bomb-count"),
  ].filter(Boolean);

  if (!inputs.length) return;

  const readSettings = () => {
    const raw = cookies?.getCookie?.(SETTINGS_COOKIE) ?? "";
    if (!raw) return {};
    try {
      return JSON.parse(raw) ?? {};
    } catch {
      return {};
    }
  };

  const writeSettings = (settings) => {
    cookies?.setCookie?.(SETTINGS_COOKIE, JSON.stringify(settings ?? {}), SETTINGS_COOKIE_MAX_AGE);
  };

  const sanitizeDigits = (value) => value.replace(/\D+/g, "");

  const clampValue = (value) => Math.min(MAX_VALUE, Math.max(MIN_VALUE, value));

  const formatDigits = (value) => {
    const digits = sanitizeDigits(value).slice(-DIGITS);
    if (!digits) return String(MIN_VALUE).padStart(DIGITS, "0");
    return String(clampValue(Number(digits))).padStart(DIGITS, "0");
  };

  const moveCaretToEnd = (input) => {
    const pos = input.value.length;
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      // Ignore selection errors on unsupported input states.
    }
  };

  const applyFormattedValue = (input) => {
    input.value = formatDigits(input.value);
    moveCaretToEnd(input);
  };

  for (const input of inputs) {
    applyFormattedValue(input);

    input.addEventListener("focus", () => {
      requestAnimationFrame(() => moveCaretToEnd(input));
    });

    input.addEventListener("keydown", (event) => {
      if (!input.dataset.replaceMinDigit) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!/^\d$/.test(event.key)) return;

      event.preventDefault();
      input.value = formatDigits(event.key);
      delete input.dataset.replaceMinDigit;
      moveCaretToEnd(input);
    });

    input.addEventListener("click", () => {
      requestAnimationFrame(() => moveCaretToEnd(input));
    });

    input.addEventListener("input", () => {
      const rawDigits = sanitizeDigits(input.value);
      if (!rawDigits) {
        input.dataset.replaceMinDigit = "1";
      } else {
        delete input.dataset.replaceMinDigit;
      }
      applyFormattedValue(input);
    });

    input.addEventListener("blur", () => {
      input.value = formatDigits(input.value);
      delete input.dataset.replaceMinDigit;
    });

    input.addEventListener("paste", (event) => {
      event.preventDefault();
      const pastedText = event.clipboardData?.getData("text") ?? "";
      input.value = formatDigits(pastedText);
      moveCaretToEnd(input);
    });
  }

  if (gamesPerDayInput && dailyGameLimit?.getGamesPerDay) {
    gamesPerDayInput.value = String(dailyGameLimit.getGamesPerDay());
    applyFormattedValue(gamesPerDayInput);
  }

  const savedSettings = readSettings();
  if (customMapToggle && typeof savedSettings.customMapEnabled === "boolean") {
    customMapToggle.checked = savedSettings.customMapEnabled;
  }
  if (mapWidthInput && savedSettings.customMapWidth != null) {
    mapWidthInput.value = String(savedSettings.customMapWidth);
    applyFormattedValue(mapWidthInput);
  }
  if (mapHeightInput && savedSettings.customMapHeight != null) {
    mapHeightInput.value = String(savedSettings.customMapHeight);
    applyFormattedValue(mapHeightInput);
  }
  if (bombCountInput && savedSettings.customMapBombCount != null) {
    bombCountInput.value = String(savedSettings.customMapBombCount);
    applyFormattedValue(bombCountInput);
  }

  const syncCustomMapState = () => {
    if (!customMapToggle || !leftColumn) return;
    const isOn = customMapToggle.checked;
    leftColumn.classList.toggle("is-custom-map-off", !isOn);
    bombCountField?.classList.toggle("is-custom-map-off", !isOn);
    for (const input of customMapControlledInputs) {
      input.disabled = !isOn;
    }
  };

  if (customMapToggle) {
    customMapToggle.addEventListener("change", syncCustomMapState);
    syncCustomMapState();
    customMapSwitch?.classList.add("is-ready");
  }

  if (saveButton && gamesPerDayInput && dailyGameLimit?.setGamesPerDay) {
    let savePressedTimerId = null;

    const runSave = () => {
      const settings = readSettings();
      settings.customMapEnabled = Boolean(customMapToggle?.checked);
      if (mapWidthInput) settings.customMapWidth = Number.parseInt(mapWidthInput.value, 10) || 0;
      if (mapHeightInput) settings.customMapHeight = Number.parseInt(mapHeightInput.value, 10) || 0;
      if (bombCountInput) settings.customMapBombCount = Number.parseInt(bombCountInput.value, 10) || 0;
      writeSettings(settings);

      const savedLimit = dailyGameLimit.setGamesPerDay(gamesPerDayInput.value);
      gamesPerDayInput.value = String(savedLimit);
      applyFormattedValue(gamesPerDayInput);
      window.dispatchEvent(new CustomEvent("saper:daily-limit-settings-saved", {
        detail: { gamesPerDay: savedLimit },
      }));
    };

    saveButton.addEventListener("click", (event) => {
      event.preventDefault();
      runSave();

      saveButton.classList.add("is-save-pressed");
      if (savePressedTimerId) {
        clearTimeout(savePressedTimerId);
      }
      savePressedTimerId = setTimeout(() => {
        saveButton.classList.remove("is-save-pressed");
        savePressedTimerId = null;
      }, SAVE_PRESSED_MS);
    });
  }
})();
