(function attachSharedDailyGameLimit(globalScope) {
  const SETTINGS_COOKIE = "saper_settings";
  const USAGE_COOKIE = "saper_daily_games_usage";
  const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
  const DEFAULT_GAMES_PER_DAY = 3;

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function getTodayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }

  function readCookie(name) {
    return globalScope.sharedCookies?.getCookie?.(name) ?? "";
  }

  function writeCookie(name, value) {
    globalScope.sharedCookies?.setCookie?.(name, value, COOKIE_MAX_AGE);
  }

  function parseJson(rawValue) {
    if (!rawValue) return null;
    try {
      return JSON.parse(rawValue);
    } catch {
      return null;
    }
  }

  function toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  function readSettings() {
    return parseJson(readCookie(SETTINGS_COOKIE)) ?? {};
  }

  function writeSettings(settings) {
    writeCookie(SETTINGS_COOKIE, JSON.stringify(settings ?? {}));
  }

  function getGamesPerDay() {
    const settings = readSettings();
    return toPositiveInt(settings.gamesPerDay, DEFAULT_GAMES_PER_DAY);
  }

  function setGamesPerDay(limit) {
    const normalized = toPositiveInt(limit, DEFAULT_GAMES_PER_DAY);
    const settings = readSettings();
    settings.gamesPerDay = normalized;
    writeSettings(settings);
    return normalized;
  }

  function readUsage() {
    const todayKey = getTodayKey();
    const payload = parseJson(readCookie(USAGE_COOKIE));
    if (!payload || payload.day !== todayKey) {
      return { day: todayKey, count: 0 };
    }
    return {
      day: todayKey,
      count: Math.max(0, Number.isFinite(Number(payload.count)) ? Number(payload.count) : 0),
    };
  }

  function writeUsage(usage) {
    writeCookie(
      USAGE_COOKIE,
      JSON.stringify({
        day: usage.day,
        count: Math.max(0, Math.floor(Number(usage.count) || 0)),
      }),
    );
  }

  function getStatus() {
    const limit = getGamesPerDay();
    const usage = readUsage();
    return {
      day: usage.day,
      count: usage.count,
      limit,
      remaining: Math.max(0, limit - usage.count),
      reached: usage.count >= limit,
    };
  }

  function consumeGame() {
    const status = getStatus();
    if (status.reached) {
      return { ok: false, ...status };
    }

    const nextUsage = { day: status.day, count: status.count + 1 };
    writeUsage(nextUsage);
    const nextStatus = getStatus();
    return { ok: true, ...nextStatus };
  }

  globalScope.sharedDailyGameLimit = {
    consumeGame,
    getStatus,
    getGamesPerDay,
    setGamesPerDay,
  };
})(window);
