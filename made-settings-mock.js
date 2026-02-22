(() => {
  const DIGITS = 4;
  const MIN_VALUE = 1;
  const MAX_VALUE = 500;
  const selector = "#map-width, #map-height, #games-per-day, #bomb-count";
  const inputs = Array.from(document.querySelectorAll(selector));
  const customMapToggle = document.getElementById("custom-map");
  const leftColumn = document.querySelector(".made-settings-left-col");
  const customMapControlledInputs = [
    document.getElementById("map-width"),
    document.getElementById("map-height"),
  ].filter(Boolean);

  if (!inputs.length) return;

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

  const syncCustomMapState = () => {
    if (!customMapToggle || !leftColumn) return;
    const isOn = customMapToggle.checked;
    leftColumn.classList.toggle("is-custom-map-off", !isOn);
    for (const input of customMapControlledInputs) {
      input.disabled = !isOn;
    }
  };

  if (customMapToggle) {
    customMapToggle.addEventListener("change", syncCustomMapState);
    syncCustomMapState();
  }
})();
