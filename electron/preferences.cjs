/* Shared keyboard/preferences rules. File access is confined to the main process. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MyBrushPreferences = Object.freeze(api);
})(globalThis, function () {
  "use strict";

  const ACTIONS = [
    ["toggle", "필기 켜기 / 끄기"],
    ["pen", "펜"],
    ["rect", "사각형"],
    ["text", "텍스트"],
    ["increase", "선 굵기 증가"],
    ["decrease", "선 굵기 감소"],
    ["settings", "단축키 설정"],
  ];
  const PALETTE = [
    ["잉크", "#334A42"],
    ["빨강", "#E26159"],
    ["주황", "#E8A04F"],
    ["노랑", "#E4C65B"],
    ["초록", "#7AA675"],
    ["파랑", "#628EBE"],
    ["보라", "#9D83B7"],
    ["흰색", "#FFFFFF"],
  ];
  const FLAGS = ["ctrl", "shift", "alt", "meta"];
  const SYMBOLS = {
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Backquote: "`",
  };
  const defaultPlatform = () =>
    typeof process === "object" ? process.platform : "darwin";
  const binding = (code, flags = {}) => ({
    code,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    ...flags,
  });
  const copy = (value) => JSON.parse(JSON.stringify(value));

  function defaults(platform = defaultPlatform()) {
    return {
      color: PALETTE[0][1],
      width: 4,
      fontSize: 28,
      shortcuts: {
        toggle:
          platform === "darwin"
            ? binding("Tab", { ctrl: true, meta: true })
            : binding("Space", { ctrl: true, shift: true }),
        pen: binding("KeyB"),
        rect: binding("KeyR"),
        text: binding("KeyT"),
        increase: binding("BracketRight"),
        decrease: binding("BracketLeft"),
        settings: binding("Comma", { ctrl: true }),
      },
    };
  }

  function bindingError(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return "올바른 키 조합을 지정하세요.";
    const code = value.code;
    if (
      typeof code !== "string" ||
      !/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Tab|Comma|Period|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote)$/.test(
        code,
      )
    ) {
      return "문자·숫자·기호·Tab·F1~F12 중에서 지정하세요. Enter와 Esc는 고정 입력입니다.";
    }
    if (
      FLAGS.some(
        (flag) => value[flag] !== undefined && typeof value[flag] !== "boolean",
      )
    )
      return "잘못된 보조키 설정입니다.";
    return "";
  }

  function signature(value) {
    return `${FLAGS.map((flag) => (value?.[flag] ? "1" : "0")).join("")}:${value?.code}`;
  }

  function validateBindings(shortcuts, platform = defaultPlatform()) {
    const seen = new Map();
    for (const [id, label] of ACTIONS) {
      const value = shortcuts?.[id];
      const error = bindingError(value);
      if (error) return { error: `${label}: ${error}`, id };
      if (id === "toggle" && !value.ctrl && !value.alt && !value.meta) {
        return {
          error: "전역 토글에는 Ctrl, Alt, Cmd/Win 중 하나를 함께 지정하세요.",
          id,
        };
      }
      if (id === "toggle" && platform === "win32" && value.code === "F12") {
        return {
          error:
            "Windows의 F12는 시스템에 예약되어 전역 토글로 사용할 수 없습니다.",
          id,
        };
      }
      const key = signature(value);
      if (seen.has(key))
        return {
          error: `${seen.get(key)}와 ${label}의 키 조합이 같습니다.`,
          id,
        };
      seen.set(key, label);
    }
    return { error: "" };
  }

  function codeLabel(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    return SYMBOLS[code] || code;
  }

  function bindingLabel(value, platform = defaultPlatform()) {
    return [
      value.ctrl ? "Ctrl" : null,
      value.shift ? "Shift" : null,
      value.alt ? "Alt" : null,
      value.meta ? (platform === "darwin" ? "Cmd" : "Win") : null,
      codeLabel(value.code),
    ]
      .filter(Boolean)
      .join("+");
  }

  function accelerator(value, platform = defaultPlatform()) {
    const error = bindingError(value);
    if (error) throw new TypeError(error);
    return [
      value.ctrl ? "Control" : null,
      value.shift ? "Shift" : null,
      value.alt ? "Alt" : null,
      value.meta ? (platform === "darwin" ? "Command" : "Super") : null,
      codeLabel(value.code),
    ]
      .filter(Boolean)
      .join("+");
  }

  function normalizeBinding(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    let code = value.code;
    if (code === undefined && typeof value.key === "string") {
      code = /^[a-z]$/i.test(value.key)
        ? `Key${value.key.toUpperCase()}`
        : /^\d$/.test(value.key)
          ? `Digit${value.key}`
          : value.key;
    }
    // Preserve invalid flag types until validation; do not silently turn strings into true.
    return binding(
      code,
      Object.fromEntries(
        FLAGS.map((flag) => [
          flag,
          Object.hasOwn(value, flag) ? value[flag] : false,
        ]),
      ),
    );
  }

  function normalizePreferences(raw, platform = defaultPlatform()) {
    const result = defaults(platform);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    if (typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color))
      result.color = raw.color.toUpperCase();
    const number = (value, fallback, minimum, maximum) =>
      typeof value === "number" && Number.isFinite(value)
        ? Math.max(minimum, Math.min(maximum, Math.round(value)))
        : fallback;
    result.width = number(raw.width, result.width, 1, 32);
    result.fontSize = number(
      raw.fontSize ?? raw.font_size,
      result.fontSize,
      12,
      144,
    );
    if (raw.shortcuts && typeof raw.shortcuts === "object") {
      const shortcuts = Object.fromEntries(
        ACTIONS.map(([id]) => [id, normalizeBinding(raw.shortcuts[id])]),
      );
      if (!validateBindings(shortcuts, platform).error)
        result.shortcuts = shortcuts;
    }
    return result;
  }

  function loadPreferences(
    userData,
    legacyPaths = [],
    platform = defaultPlatform(),
  ) {
    const fs = require("node:fs");
    const path = require("node:path");
    const current = path.join(userData, "preferences.json");
    if (fs.existsSync(current)) {
      try {
        return normalizePreferences(
          JSON.parse(fs.readFileSync(current, "utf8")),
          platform,
        );
      } catch {
        return defaults(platform);
      }
    }
    for (const legacyPath of legacyPaths) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
        if (raw && typeof raw === "object" && !Array.isArray(raw))
          return normalizePreferences(raw, platform);
      } catch {
        /* A missing/unreadable legacy file is not a startup failure. */
      }
    }
    return defaults(platform);
  }

  function savePreferences(userData, preferences) {
    const fs = require("node:fs");
    const path = require("node:path");
    fs.mkdirSync(userData, { recursive: true });
    const destination = path.join(userData, "preferences.json");
    const temporary = path.join(userData, `preferences.${process.pid}.tmp`);
    try {
      fs.writeFileSync(
        temporary,
        `${JSON.stringify(copy(preferences), null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
      fs.renameSync(temporary, destination);
    } catch (error) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* Preserve the original write error. */
      }
      throw error;
    }
  }

  return {
    ACTIONS,
    PALETTE,
    defaults,
    normalizePreferences,
    validateBindings,
    bindingError,
    signature,
    bindingLabel,
    accelerator,
    loadPreferences,
    savePreferences,
  };
});
