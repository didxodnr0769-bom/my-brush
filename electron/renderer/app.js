(async () => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const canvas = $("drawing"),
    ctx = canvas.getContext("2d"),
    toolbar = $("toolbar"),
    dialog = $("settingsDialog"),
    textInput = $("textInput"),
    textEditor = $("textEditor");
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const { PALETTE, ACTIONS, bindingError, signature } =
    window.MyBrushPreferences;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const key = (
    code,
    ctrl = false,
    shift = false,
    alt = false,
    meta = false,
  ) => ({ code, ctrl, shift, alt, meta });
  let platform = "darwin",
    prefs = window.MyBrushPreferences.defaults(platform),
    saveQueue = Promise.resolve();
  const pendingFields = new Map();
  let latestPreferences = { revision: -1, preferences: prefs };
  const validateBindings = (value) =>
    window.MyBrushPreferences.validateBindings(value, platform);
  function receivePreferences(remote, revision) {
    if (revision < latestPreferences.revision) return;
    latestPreferences = { revision, preferences: clone(remote) };
    const previous = prefs;
    prefs = clone(remote);
    for (const field of pendingFields.keys()) prefs[field] = previous[field];
    if (draft) {
      if (previous.color !== prefs.color) draft.color = prefs.color;
      if (previous.fontSize !== prefs.fontSize) draft.fontSize = prefs.fontSize;
      syncEditor();
    }
  }
  function persist(patch) {
    const fields = Object.keys(patch);
    for (const field of fields)
      pendingFields.set(field, (pendingFields.get(field) || 0) + 1);
    saveQueue = saveQueue
      .then(() => window.myBrush.save(patch))
      .then((result) => {
        if (result.ok) receivePreferences(result.preferences, result.revision);
        else say(result.error);
        return result;
      })
      .catch((error) => {
        say(`설정을 저장하지 못했습니다: ${error.message}`);
        return { ok: false, error: error.message };
      })
      .finally(() => {
        for (const field of fields) {
          const count = pendingFields.get(field) - 1;
          if (count) pendingFields.set(field, count);
          else pendingFields.delete(field);
        }
        receivePreferences(
          latestPreferences.preferences,
          latestPreferences.revision,
        );
        updateUI();
      });
    return saveQueue;
  }
  let interactionLocked = false,
    initialized = false,
    isActive = true,
    savingSettings = false,
    visible = true,
    tool = "pen",
    objects = [],
    gesture = null,
    controlPressed = false,
    draft = null,
    composing = false,
    compositionEndedAt = 0,
    settingsDraft = null,
    recording = null,
    recordingPrevious = null,
    lastDialogFocus = null,
    nextId = 1,
    viewWidth = 0,
    viewHeight = 0;
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const { normalizeRect, validDeleteDrag, rectsOverlap } =
    window.MyBrushGeometry;
  const hitTestObject = (object, rect) =>
    window.MyBrushGeometry.hitTestObject(object, rect, textLayout);
  function textLayout(object) {
    ctx.save();
    ctx.font = `${object.fontSize}px ${FONT}`;
    const lines = object.text.split("\n"),
      width = Math.max(
        1,
        ...lines.map((line) => ctx.measureText(line || " ").width),
      );
    ctx.restore();
    return {
      x: object.x,
      y: object.y,
      width,
      height: Math.max(1, lines.length) * object.fontSize * 1.35,
    };
  }
  function targetIds() {
    if (
      !gesture ||
      gesture.type !== "delete" ||
      !validDeleteDrag(gesture.start, gesture.current)
    )
      return new Set();
    const r = normalizeRect(gesture.start, gesture.current);
    return new Set(objects.filter((o) => hitTestObject(o, r)).map((o) => o.id));
  }
  function drawObject(o, highlight = false) {
    ctx.save();
    ctx.strokeStyle = highlight ? "#D56958" : o.color;
    ctx.fillStyle = highlight ? "#D56958" : o.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (o.type === "stroke") {
      ctx.lineWidth = o.width;
      ctx.beginPath();
      ctx.moveTo(o.points[0].x, o.points[0].y);
      if (o.points.length === 1) {
        ctx.arc(o.points[0].x, o.points[0].y, o.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (let i = 1; i < o.points.length; i++)
          ctx.lineTo(o.points[i].x, o.points[i].y);
        ctx.stroke();
      }
    } else if (o.type === "rect") {
      ctx.lineWidth = o.lineWidth;
      ctx.strokeRect(o.x, o.y, o.width, o.height);
    } else if (o.type === "text") {
      ctx.font = `${o.fontSize}px ${FONT}`;
      ctx.textBaseline = "top";
      o.text
        .split("\n")
        .forEach((line, index) =>
          ctx.fillText(line, o.x, o.y + index * o.fontSize * 1.35),
        );
    }
    if (highlight) {
      ctx.strokeStyle = "#D5695877";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      if (o.type === "text") {
        const r = textLayout(o);
        ctx.strokeRect(r.x - 3, r.y - 3, r.width + 6, r.height + 6);
      }
    }
    ctx.restore();
  }
  function render() {
    ctx.clearRect(0, 0, viewWidth, viewHeight);
    if (!visible) return;
    const targets = targetIds();
    for (const o of objects) {
      if (draft && draft.originalId === o.id) continue;
      drawObject(o, targets.has(o.id));
    }
    if (gesture) {
      if (gesture.type === "pen")
        drawObject({
          type: "stroke",
          points: gesture.points,
          color: gesture.color,
          width: gesture.width,
        });
      if (gesture.type === "rect") {
        const r = normalizeRect(gesture.start, gesture.current);
        drawObject({
          type: "rect",
          ...r,
          color: gesture.color,
          lineWidth: gesture.width,
        });
      }
      if (gesture.type === "delete") {
        const r = normalizeRect(gesture.start, gesture.current);
        ctx.save();
        ctx.fillStyle = "#D978641B";
        ctx.strokeStyle = "#CF725F";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.fillRect(r.x, r.y, r.width, r.height);
        ctx.strokeRect(r.x, r.y, r.width, r.height);
        ctx.restore();
      }
    }
    updateStatus();
  }
  function say(message) {
    $("announcer").textContent = "";
    requestAnimationFrame(() => ($("announcer").textContent = message));
  }
  function updateStatus() {
    const name = { pen: "펜", rect: "사각형", text: "텍스트" }[tool];
    let message = `${name} · Ctrl+드래그로 영역 삭제`;
    if (!visible) message = "필기 화면 숨김 · 다시 필기로 돌아오기";
    else if (gesture?.type === "delete")
      message = `영역 삭제 · ${targetIds().size}개 대상 · Ctrl을 놓으면 취소`;
    else if (draft) message = "텍스트 입력 · Ctrl+Enter 완료 · Esc 취소";
    else if (tool === "text")
      message = "텍스트 · 클릭해 입력 · 기존 글자를 눌러 편집";
    $("statusbar").textContent = message;
    $("statusbar").classList.toggle("inactive", !visible);
    $("statusbar").hidden = !visible || !isActive;
  }
  const bindingLabel = (value) =>
    window.MyBrushPreferences.bindingLabel(value, platform);
  function updateUI() {
    toolbar.hidden = !visible || !isActive || interactionLocked;
    canvas.classList.toggle("hidden-surface", !visible);
    canvas.setAttribute("aria-hidden", String(!visible));
    canvas.tabIndex = visible ? 0 : -1;
    $("textSizeGroup").hidden = tool !== "text" && !draft;
    $("widthInput").value = prefs.width;
    $("widthOutput").value = String(prefs.width);
    $("widthOutput").textContent = prefs.width;
    $("fontSizeInput").value = draft ? draft.fontSize : prefs.fontSize;
    document.querySelectorAll("[data-tool]").forEach((button) => {
      const id = button.dataset.tool;
      button.setAttribute("aria-pressed", String(tool === id));
      button.title = `${{ pen: "펜", rect: "사각형", text: "텍스트" }[id]} (${bindingLabel(prefs.shortcuts[id])})`;
      const hint = button.querySelector(".key-hint");
      hint.textContent =
        bindingLabel(prefs.shortcuts[id]).length < 5
          ? bindingLabel(prefs.shortcuts[id])
          : "";
    });
    document
      .querySelectorAll(".color-button")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(
            button.dataset.color.toUpperCase() ===
              (draft ? draft.color : prefs.color).toUpperCase(),
          ),
        ),
      );
    $("customColor").value = draft ? draft.color : prefs.color;
    $("settingsButton").title =
      `단축키 설정 (${bindingLabel(prefs.shortcuts.settings)})`;
    $("returnButton").title =
      `작업 복귀 (${bindingLabel(prefs.shortcuts.toggle)})`;
    canvas.style.cursor = tool === "text" ? "text" : "crosshair";
    updateStatus();
  }
  function setColor(color) {
    prefs.color = color.toUpperCase();
    if (draft) {
      draft.color = prefs.color;
      syncEditor();
    }
    persist({ color: prefs.color });
    updateUI();
  }
  function setWidth(width) {
    prefs.width = clamp(Math.round(Number(width) || 1), 1, 32);
    persist({ width: prefs.width });
    updateUI();
  }
  function setFontSize(value) {
    if (!Number.isFinite(Number(value)) || value === "") return;
    prefs.fontSize = clamp(Math.round(Number(value)), 12, 144);
    if (draft) {
      draft.fontSize = prefs.fontSize;
      syncEditor();
    }
    persist({ fontSize: prefs.fontSize });
    updateUI();
  }
  for (const [name, color] of PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-button";
    button.dataset.color = color;
    button.style.setProperty("--swatch", color);
    if (color === "#FFFFFF") button.dataset.light = "true";
    button.setAttribute("aria-label", `${name} ${color}`);
    button.setAttribute("aria-pressed", "false");
    button.title = name;
    button.addEventListener("click", () => setColor(color));
    $("colors").append(button);
  }
  const custom = document.createElement("label");
  custom.className = "custom-color-wrap";
  custom.title = "직접 색상 선택";
  custom.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><input type="color" id="customColor" aria-label="직접 색상 선택">';
  $("colors").append(custom);
  $("customColor").addEventListener("input", (e) => setColor(e.target.value));
  function reportInteraction() {
    window.myBrush.interaction({ modal: dialog.open, composing });
  }
  const inputTrail = [];
  function inputEvent(kind, e = {}) {
    inputTrail.push({
      kind,
      time: e.timeStamp ?? performance.now(),
      pointer: e.pointerId,
      button: e.button,
      buttons: e.buttons,
      control: !!e.ctrlKey,
      captured:
        Number.isFinite(e.pointerId) && canvas.hasPointerCapture(e.pointerId),
      focused:
        typeof document.hasFocus === "function" ? document.hasFocus() : true,
      tool: gesture?.type,
      points: gesture?.points?.length,
      objects: objects.length,
      pending: !!gesture?.awaitingRelease,
    });
    if (inputTrail.length > 16) inputTrail.shift();
  }
  function reportInput(reason) {
    window.myBrush.inputDiagnostic?.({ reason, events: inputTrail.slice() });
  }
  function cancelGesture(reason = "explicit") {
    if (!gesture) return;
    if (reason !== "explicit") reportInput(reason);
    const pointerId = gesture.pointerId;
    gesture = null;
    try {
      if (canvas.hasPointerCapture(pointerId))
        canvas.releasePointerCapture(pointerId);
    } catch (_error) {}
    render();
  }
  function setTool(next) {
    if (interactionLocked) return;
    if (draft) commitText();
    tool = next;
    window.myBrush.selectTool(next);
    updateUI();
    canvas.focus({ preventScroll: true });
  }
  document
    .querySelectorAll("[data-tool]")
    .forEach((button) =>
      button.addEventListener("click", () => setTool(button.dataset.tool)),
    );
  $("widthInput").addEventListener("input", (e) => setWidth(e.target.value));
  $("fontSizeInput").addEventListener("input", (e) => {
    const value = Number(e.target.value);
    if (
      e.target.value !== "" &&
      Number.isFinite(value) &&
      value >= 12 &&
      value <= 144
    )
      setFontSize(value);
  });
  $("fontSizeInput").addEventListener("change", (e) => {
    if (e.target.value === "")
      e.target.value = draft ? draft.fontSize : prefs.fontSize;
    else setFontSize(e.target.value);
  });
  function syncEditor() {
    if (!draft) return;
    draft.text = textInput.value;
    const metrics = textLayout(draft);
    const left = clamp(draft.x, 3, Math.max(3, viewWidth - 60)),
      top = clamp(draft.y, 3, Math.max(3, viewHeight - 55));
    textEditor.style.left = `${left - 2}px`;
    textEditor.style.top = `${top - 1}px`;
    textInput.style.fontSize = `${draft.fontSize}px`;
    textInput.style.color = draft.color;
    textInput.style.width = `${Math.min(Math.max(116, metrics.width + 18), Math.max(55, viewWidth - left - 10))}px`;
    textInput.style.height = `${Math.min(Math.max(draft.fontSize * 1.35, metrics.height + 3), Math.max(draft.fontSize * 1.35, viewHeight - top - 37))}px`;
    render();
  }
  function beginText(position, existing) {
    cancelGesture();
    draft = existing
      ? { ...clone(existing), originalId: existing.id }
      : {
          type: "text",
          x: position.x,
          y: position.y,
          text: "",
          color: prefs.color,
          fontSize: prefs.fontSize,
          originalId: null,
        };
    textInput.value = draft.text;
    textEditor.hidden = false;
    syncEditor();
    updateUI();
    textInput.focus({ preventScroll: true });
    textInput.setSelectionRange(textInput.value.length, textInput.value.length);
  }
  function commitText() {
    if (!draft) return;
    const current = draft;
    current.text = textInput.value;
    const value = current.text.trim().length ? current.text : null;
    if (current.originalId !== null) {
      const index = objects.findIndex((o) => o.id === current.originalId);
      if (index !== -1) {
        if (value !== null)
          objects[index] = {
            id: current.originalId,
            type: "text",
            x: current.x,
            y: current.y,
            text: value,
            color: current.color,
            fontSize: current.fontSize,
          };
        else objects.splice(index, 1);
      }
    } else if (value !== null)
      objects.push({
        id: nextId++,
        type: "text",
        x: current.x,
        y: current.y,
        text: value,
        color: current.color,
        fontSize: current.fontSize,
      });
    draft = null;
    textEditor.hidden = true;
    composing = false;
    reportInteraction();
    updateUI();
    render();
  }
  function cancelText() {
    if (!draft) return;
    draft = null;
    textEditor.hidden = true;
    composing = false;
    reportInteraction();
    updateUI();
    render();
    canvas.focus({ preventScroll: true });
  }
  textInput.addEventListener("input", syncEditor);
  textInput.addEventListener("compositionstart", () => {
    composing = true;
    reportInteraction();
  });
  textInput.addEventListener("compositionend", () => {
    composing = false;
    reportInteraction();
    compositionEndedAt = performance.now();
    syncEditor();
  });
  function prepareHide() {
    cancelGesture();
    controlPressed = false;
    if (draft) commitText();
    if (dialog.open) closeSettings();
    visible = false;
    updateUI();
    render();
  }
  function setVisible(next) {
    if (!next) {
      prepareHide();
      window.myBrush.hide();
    }
  }
  $("returnButton").addEventListener("click", () => setVisible(false));
  const controlHeld = (e) =>
    e.ctrlKey || (platform === "darwin" && controlPressed);
  const matchesGesture = (e) =>
    gesture &&
    e.pointerId === gesture.pointerId &&
    (!Number.isFinite(e.timeStamp) || e.timeStamp >= gesture.startedAt);
  canvas.addEventListener("pointerdown", (e) => {
    inputEvent("down", e);
    if (
      !visible ||
      interactionLocked ||
      dialog.open ||
      (e.button !== 0 &&
        !(platform === "darwin" && controlHeld(e) && e.button === 2)) ||
      gesture
    )
      return;
    // Canceling a mouse pointerdown suppresses Chromium's compatibility mouseup.
    // Keep that release route available; CSS already disables selection/gestures.
    if (e.pointerType && e.pointerType !== "mouse") e.preventDefault();
    canvas.focus({ preventScroll: true });
    if (draft) {
      commitText();
      return;
    }
    const p = point(e);
    // macOS may omit Control on its secondary-click compatibility events.
    // A real Control keyup/blur still cancels deletion immediately.
    if (e.ctrlKey && platform === "darwin") controlPressed = true;
    const input = {
      pointerId: e.pointerId,
      pointerType: e.pointerType || "mouse",
      button: e.button,
      startedAt: Number.isFinite(e.timeStamp) ? e.timeStamp : 0,
    };
    if (controlHeld(e)) {
      gesture = {
        type: "delete",
        ...input,
        start: p,
        current: p,
      };
    } else if (tool === "text") {
      const hit = [...objects].reverse().find(
        (o) =>
          o.type === "text" &&
          rectsOverlap(textLayout(o), {
            x: p.x,
            y: p.y,
            width: 0,
            height: 0,
          }),
      );
      beginText(p, hit);
      return;
    } else {
      gesture = {
        type: tool,
        ...input,
        start: p,
        current: p,
        points: [p],
        color: prefs.color,
        width: prefs.width,
      };
    }
    // Window-level completion also handles a release outside the canvas if
    // native capture was unavailable. Do not leave a half-started gesture on throw.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (_error) {
      inputEvent("capture-error", e);
      reportInput("capture-unavailable");
    }
    render();
  });
  function moveGesture(e) {
    if (!matchesGesture(e) || gesture.awaitingRelease) return;
    e.preventDefault();
    if (gesture.type === "delete" && !controlHeld(e)) {
      cancelGesture("control-flag-lost");
      return;
    }
    gesture.current = point(e);
    if (gesture.type === "pen") {
      const coalesced = e.getCoalescedEvents?.();
      const events = coalesced?.length ? coalesced : [e];
      for (const sample of events) {
        const p = point(sample),
          last = gesture.points.at(-1);
        if (p.x !== last.x || p.y !== last.y) gesture.points.push(p);
      }
    }
    render();
  }
  canvas.addEventListener("pointermove", moveGesture);
  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.target !== canvas) moveGesture(e);
    },
    true,
  );
  function finishGesture(e) {
    if (!matchesGesture(e)) return;
    inputEvent(e.type === "mouseup" ? "mouseup" : "up", e);
    e.preventDefault();
    const finished = gesture;
    finished.current = point(e);
    if (finished.type === "delete") {
      const releasedWithControl = finished.awaitingRelease
        ? finished.releaseCtrl
        : controlHeld(e);
      if (
        releasedWithControl &&
        validDeleteDrag(finished.start, finished.current)
      ) {
        const ids = targetIds();
        objects = objects.filter((o) => !ids.has(o.id));
        say(`${ids.size}개 오브젝트를 삭제했습니다.`);
      }
    } else if (finished.type === "pen") {
      const p = point(e),
        last = finished.points.at(-1);
      if (p.x !== last.x || p.y !== last.y) finished.points.push(p);
      objects.push({
        id: nextId++,
        type: "stroke",
        points: finished.points,
        color: finished.color,
        width: finished.width,
      });
    } else if (finished.type === "rect") {
      const r = normalizeRect(finished.start, finished.current);
      if (r.width > 0 && r.height > 0)
        objects.push({
          id: nextId++,
          type: "rect",
          ...r,
          color: finished.color,
          lineWidth: finished.width,
        });
    }
    inputEvent("finish", e);
    gesture = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_error) {}
    render();
  }
  function finishReleasedGesture(timeStamp) {
    if (!gesture?.awaitingRelease) return;
    finishGesture({
      pointerId: gesture.pointerId,
      timeStamp,
      clientX: gesture.current.x,
      clientY: gesture.current.y,
      ctrlKey: gesture.releaseCtrl,
      preventDefault() {},
    });
  }
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (
        !gesture?.awaitingRelease ||
        gesture.pointerType !== "mouse" ||
        (e.pointerType && e.pointerType !== "mouse") ||
        !matchesGesture(e) ||
        e.button !== gesture.button
      )
        return;
      // A new press proves the previous same-button release. Close it at its last
      // sample before canvas starts a fresh gesture, never at the new press point.
      inputEvent("boundary", e);
      finishReleasedGesture(e.timeStamp);
    },
    true,
  );
  canvas.addEventListener("pointerup", finishGesture);
  // Capture phase observes the valid release before capture cleanup or a target's
  // own event handling. Both routes share one idempotent completion transaction.
  window.addEventListener("pointerup", finishGesture, true);
  window.addEventListener(
    "mouseup",
    (e) => {
      if (!gesture || gesture.pointerType !== "mouse") return;
      const sameButton =
        e.button === gesture.button ||
        (platform === "darwin" &&
          gesture.type === "delete" &&
          gesture.button === 2 &&
          e.button === 0);
      if (!sameButton) return;
      finishGesture({
        type: "mouseup",
        pointerId: gesture.pointerId,
        timeStamp: e.timeStamp,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        preventDefault: () => e.preventDefault(),
      });
    },
    true,
  );
  canvas.addEventListener("pointercancel", (e) => {
    inputEvent("cancel", e);
    if (matchesGesture(e)) cancelGesture("pointer-cancel");
  });
  canvas.addEventListener("lostpointercapture", (e) => {
    inputEvent("lost", e);
    // A delayed capture-loss notification may belong to the previous stroke or
    // another pointer. It must not cancel the current captured mouse transaction.
    if (!matchesGesture(e) || canvas.hasPointerCapture(e.pointerId)) return;
    if (gesture.pointerType === "mouse" && e.buttons === 0) {
      // Capture cleanup is evidence that the button is released, but is not a
      // completion event. Freeze the preview until up or the next same-button
      // down confirms the boundary; scheduling/render frames are not a deadline.
      gesture.awaitingRelease = true;
      gesture.releaseCtrl = controlHeld(e);
      inputEvent("pending-release", e);
      reportInput("capture-release-pending");
    } else cancelGesture("capture-lost");
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("blur", () => {
    inputEvent("blur");
    controlPressed = false;
    cancelGesture("window-blur");
    if (recording) cancelRecording();
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key === "Control" ||
        e.code === "ControlLeft" ||
        e.code === "ControlRight"
      ) {
        inputEvent("control-down", e);
        controlPressed = true;
      }
    },
    true,
  );
  window.addEventListener(
    "keyup",
    (e) => {
      if (
        e.key === "Control" ||
        e.code === "ControlLeft" ||
        e.code === "ControlRight"
      ) {
        inputEvent("control-up", e);
        // When capture already reported buttons=0, this keyup follows the mouse
        // release. Only Control released while the button is held cancels delete.
        if (gesture?.type === "delete" && gesture.awaitingRelease)
          finishReleasedGesture(e.timeStamp);
        controlPressed = false;
        if (gesture?.type === "delete") cancelGesture("control-released");
      }
    },
    true,
  );
  function shortcutMessage(text, isError = false) {
    $("shortcutMessage").textContent = text;
    $("shortcutMessage").classList.toggle("error", isError);
  }
  function renderSettings() {
    const table = $("shortcutTable");
    table.replaceChildren();
    const validation = validateBindings(settingsDraft);
    for (const [id, label] of ACTIONS) {
      const row = document.createElement("div");
      row.className = "shortcut-row";
      const name = document.createElement("span");
      name.className = "shortcut-name";
      name.textContent = label;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shortcut-record";
      button.dataset.action = id;
      button.setAttribute(
        "aria-label",
        `${label} 단축키: ${bindingLabel(settingsDraft[id])}. 눌러서 새 키 기록`,
      );
      button.textContent =
        recording === id
          ? "새 조합을 누르세요…"
          : bindingLabel(settingsDraft[id]);
      button.classList.toggle("recording", recording === id);
      button.classList.toggle("invalid", validation.id === id);
      button.addEventListener("click", () => {
        recording = id;
        recordingPrevious = clone(settingsDraft[id]);
        renderSettings();
        shortcutMessage("원하는 키 조합을 누르세요. Esc는 기록만 취소해요.");
        document.querySelector(`[data-action="${id}"]`)?.focus();
      });
      row.append(name, button);
      table.append(row);
    }
    $("saveSettings").disabled =
      !!validation.error || !!recording || savingSettings;
    document
      .querySelectorAll(".shortcut-record")
      .forEach((b) => (b.disabled = savingSettings));
    $("cancelSettings").disabled = savingSettings;
    $("closeSettings").disabled = savingSettings;
  }
  function openSettings() {
    cancelGesture();
    if (draft) commitText();
    lastDialogFocus = document.activeElement;
    settingsDraft = clone(prefs.shortcuts);
    recording = null;
    renderSettings();
    shortcutMessage("바꿀 동작의 키를 누른 다음 새 조합을 입력하세요.");
    dialog.showModal();
    reportInteraction();
    $("closeSettings").focus({ preventScroll: true });
  }
  function cancelRecording() {
    if (!recording) return;
    const id = recording;
    if (recordingPrevious) settingsDraft[id] = clone(recordingPrevious);
    recording = null;
    recordingPrevious = null;
    renderSettings();
    shortcutMessage("키 기록을 취소했어요.");
    document.querySelector(`[data-action="${id}"]`)?.focus();
  }
  function closeSettings() {
    if (!dialog.open || savingSettings) return;
    recording = null;
    recordingPrevious = null;
    settingsDraft = null;
    dialog.close();
    reportInteraction();
    if (lastDialogFocus && document.contains(lastDialogFocus))
      lastDialogFocus.focus({ preventScroll: true });
  }
  $("settingsButton").addEventListener("click", openSettings);
  $("cancelSettings").addEventListener("click", closeSettings);
  $("closeSettings").addEventListener("click", closeSettings);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (recording) cancelRecording();
    else closeSettings();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        closeSettings();
    }
  });
  $("saveSettings").addEventListener("click", async () => {
    if (recording || savingSettings) return;
    const validation = validateBindings(settingsDraft);
    if (validation.error) {
      shortcutMessage(validation.error, true);
      return;
    }
    const shortcuts = clone(settingsDraft);
    savingSettings = true;
    renderSettings();
    await saveQueue;
    let result;
    try {
      result = await window.myBrush.save({ shortcuts });
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    savingSettings = false;
    if (result.ok) {
      receivePreferences(result.preferences, result.revision);
      closeSettings();
      updateUI();
      say("단축키 설정을 저장했습니다.");
    } else {
      renderSettings();
      shortcutMessage(result.error, true);
    }
  });
  const eventBinding = (e) =>
    key(e.code, e.ctrlKey, e.shiftKey, e.altKey, e.metaKey);
  const isTextTarget = (target) =>
    target instanceof Element &&
    !!target.closest('input,textarea,select,[contenteditable="true"]');
  window.addEventListener("keydown", (e) => {
    if (interactionLocked) {
      e.preventDefault();
      return;
    }
    const ime =
      e.isComposing ||
      e.keyCode === 229 ||
      composing ||
      performance.now() - compositionEndedAt < 25;
    if (ime) return;
    if (dialog.open) {
      if (recording) {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        if (e.key === "Escape") {
          cancelRecording();
          return;
        }
        const binding = eventBinding(e),
          error = bindingError(binding);
        if (error) {
          shortcutMessage(error, true);
          return;
        }
        const id = recording;
        settingsDraft[id] = binding;
        recording = null;
        recordingPrevious = null;
        renderSettings();
        const validation = validateBindings(settingsDraft);
        shortcutMessage(
          validation.error ||
            "새 조합을 기록했어요. 저장할 때 전역 등록을 확인합니다.",
          !!validation.error,
        );
        document.querySelector(`[data-action="${id}"]`)?.focus();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSettings();
      }
      return;
    }
    if (e.key === "Escape") {
      if (e.repeat) return;
      e.preventDefault();
      if (gesture) {
        cancelGesture();
        return;
      }
      if (draft) {
        cancelText();
        return;
      }
      if (visible) setVisible(false);
      return;
    }
    if (
      draft &&
      e.target === textInput &&
      e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      ["Enter", "NumpadEnter"].includes(e.code)
    ) {
      e.preventDefault();
      if (!e.repeat) {
        commitText();
        canvas.focus({ preventScroll: true });
      }
      return;
    }
    if (e.repeat) return;
    const binding = eventBinding(e),
      match = ACTIONS.find(
        ([id]) => signature(prefs.shortcuts[id]) === signature(binding),
      );
    if (!match) return;
    const id = match[0];
    if (id === "toggle") {
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      if (!globalRegistered) setVisible(false);
      return;
    }
    if (!visible || isTextTarget(e.target)) return;
    e.preventDefault();
    if (id === "pen" || id === "rect" || id === "text") setTool(id);
    else if (id === "increase") setWidth(prefs.width + 1);
    else if (id === "decrease") setWidth(prefs.width - 1);
    else if (id === "settings") openSettings();
  });
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    viewWidth = canvas.clientWidth;
    viewHeight = canvas.clientHeight;
    canvas.width = Math.round(viewWidth * dpr);
    canvas.height = Math.round(viewHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (draft) syncEditor();
    render();
  }
  let globalRegistered = false;
  function applyState(state) {
    const needsFocus = !initialized || !visible || (!isActive && state.active);
    initialized = true;
    platform = state.platform;
    isActive = state.active;
    interactionLocked = state.blocked;
    receivePreferences(state.preferences, state.revision);
    if (tool !== state.tool) {
      if (draft) commitText();
      tool = state.tool;
    }
    visible = state.visible;
    globalRegistered = !state.registrationError;
    $("registrationError").hidden = !state.registrationError;
    $("registrationError").textContent = state.registrationError;
    updateUI();
    toolbar.hidden = !visible || !state.active || interactionLocked;
    $("statusbar").hidden = !visible || !state.active;
    render();
    if (needsFocus && visible && state.active && !draft && !dialog.open)
      canvas.focus({ preventScroll: true });
  }
  window.myBrush.onState(applyState);
  window.myBrush.onCommand((command) => {
    if (command.action === "deactivate-display") {
      prepareHide();
      return;
    }
    if (command.action === "prepare-hide") {
      prepareHide();
      window.myBrush.readyToHide(command.token);
      return;
    }
    if (command.action === "settings") {
      if (!dialog.open) openSettings();
      return;
    }
    if (command.action === "toggle") {
      if (
        composing ||
        performance.now() - compositionEndedAt < 25 ||
        savingSettings
      )
        return;
      if (dialog.open) {
        if (recording) {
          settingsDraft[recording] = clone(prefs.shortcuts.toggle);
          recording = null;
          recordingPrevious = null;
          renderSettings();
          shortcutMessage("현재 전역 조합을 기록했습니다.");
        }
        return;
      }
      setVisible(false);
    }
  });
  // Session objects stay in the renderer's memory. They are never restored from disk.
  resize();
  applyState(await window.myBrush.init());
  window.addEventListener("resize", resize);
  window.myBrushDebug = Object.freeze({
    getState: () =>
      clone({
        visible,
        tool,
        preferences: prefs,
        objects,
        gesture,
        draft,
        settingsOpen: dialog.open,
        recording,
        settingsDraft,
      }),
  });
})().catch((error) => {
  document.body.textContent = `My Brush 실행 실패: ${error.message}`;
  console.error(error);
});
