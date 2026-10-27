"use strict";

const { accelerator } = require("./preferences.cjs");

/** Keep the working OS shortcut until its replacement is registered and saved. */
function createHotkeys(globalShortcut, callback, platform = process.platform) {
  let current = "";
  const conflict =
    "전역 단축키를 등록하지 못했습니다. 다른 앱·시스템과의 충돌을 확인하세요.";

  function apply(binding, persist) {
    let next;
    let added = false;
    try {
      next = accelerator(binding, platform);
      if (next !== current) {
        if (!globalShortcut.register(next, callback))
          return { ok: false, error: conflict };
        added = true;
      }
    } catch (error) {
      return { ok: false, error: `전역 단축키 등록 실패: ${error.message}` };
    }

    try {
      persist();
    } catch (error) {
      if (added) globalShortcut.unregister(next);
      return {
        ok: false,
        error: `설정을 저장하지 못했습니다: ${error.message}`,
      };
    }

    const previous = current;
    current = next;
    if (added && previous) globalShortcut.unregister(previous);
    return { ok: true, error: "" };
  }

  return {
    get current() {
      return current;
    },
    install(binding) {
      return apply(binding, () => {});
    },
    apply,
  };
}

module.exports = { createHotkeys };
