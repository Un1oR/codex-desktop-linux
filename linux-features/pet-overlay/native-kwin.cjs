"use strict";

function codexPetOverlayKWinBridgeFor(window) {
  if (!this.codexPetOverlayKWinBridge) {
    const { KWinBridge } = require(require("node:path").join(process.resourcesPath, "..", ".codex-linux", "features", "pet-overlay", "kwin-bridge.cjs"));
    this.codexPetOverlayKWinBridge = new KWinBridge({
      onNear: near => { if (this.window?.isVisible?.()) this.setPetPointerProximity(near); },
      onError: error => this.logger().warning?.("Mini KWin bridge failed", { safe: {}, sensitive: { error } }),
    });
  }
  if (this.codexPetOverlayKWinBridgeWindow !== window) {
    this.codexPetOverlayKWinBridgeWindow = window;
    const bridge = this.codexPetOverlayKWinBridge;
    const stop = () => { void bridge.invalidate().catch(() => {}); this.setPetPointerProximity?.(false); };
    window.on("hide", stop);
    window.once("closed", stop);
  }
  return this.codexPetOverlayKWinBridge;
}

function codexPetOverlayKWinData(window, bounds) {
  const size = window.getContentBounds();
  return { width: size.width, height: size.height, ...(bounds ? { bounds } : {}), hints: this.codexPetOverlaySettings() };
}

async function codexPetOverlayActivateKWin(window) {
  if (!this.codexPetOverlayIsNativeKWin() || this.codexPetOverlaySettings().mode === "passive") return false;
  this.codexPetOverlayKWinActivation?.cancel();
  const request = { cancelled: false, cancel() { this.cancelled = true; } };
  const bounds = window.getContentBounds(), title = window.getTitle(), sequence = this.windowVisibilitySequence;
  const deadline = Date.now() + 750;
  const valid = () => !request.cancelled && Date.now() <= deadline && this.window === window &&
    this.windowVisibilitySequence === sequence && !window.isDestroyed() && window.isVisible() && window.isFocusable() &&
    window.getTitle() === title && window.getContentBounds().width === bounds.width && window.getContentBounds().height === bounds.height;
  if (!valid()) return false;
  this.codexPetOverlayKWinActivation = request;
  const cancel = () => request.cancel();
  for (const event of ["blur", "hide", "closed"]) window.once(event, cancel);
  try {
    await this.codexPetOverlayKWinBridgeFor(window).request("keyboard", {}, valid, 750);
    return valid();
  } catch (error) {
    if (error.code !== "CANCELLED" && !request.cancelled) throw error;
    return false;
  } finally {
    cancel();
    for (const event of ["blur", "hide", "closed"]) window.removeListener(event, cancel);
    if (this.codexPetOverlayKWinActivation === request) this.codexPetOverlayKWinActivation = null;
  }
}

function codexPetOverlayKWinRun(bounds, move, complete) {
  if (!this.codexPetOverlayIsNativeKWin()) return this.codexPetOverlayKWinLegacyRun(bounds, move, complete);
  const window = this.window, epoch = this.codexPetOverlayKWinEpoch;
  const valid = () => this.window === window && !window?.isDestroyed() && window.isVisible() &&
    this.codexPetOverlayKWinEpoch === epoch && this.codexPetOverlayKWinDragState == null &&
    (!move || ["x", "y", "width", "height"].every(key => bounds?.[key] === this.codexPetOverlayDesiredWindowBounds?.[key]));
  try {
    this.codexPetOverlayKWinBridgeFor(window).request("hints", this.codexPetOverlayKWinData(window, move ? bounds : null), valid)
      .then(() => complete?.(), error => complete?.(error));
  } catch (error) { complete?.(error); }
}

function codexPetOverlayStartKWinPointer(window, bounds) {
  const previous = this.codexPetOverlayKWinPointer, sequence = this.windowVisibilitySequence;
  if (previous?.window === window && previous.sequence === sequence && !previous.cancelled && !bounds) return previous;
  const bridge = this.codexPetOverlayKWinBridgeFor(window);
  const lease = { window, sequence }, valid = () => !lease.cancelled && this.window === window &&
    !window.isDestroyed() && this.windowVisibilitySequence === sequence;
  let cleanup;
  const data = this.codexPetOverlayKWinData(window);
  lease.cancel = () => {
    lease.cancelled = true;
    return cleanup ??= bridge.request("pointer", { ...data, enabled: false })
      .then(() => true, error => { if (error.code !== "CANCELLED") this.logger().warning?.("Could not stop Mini pointer policy", { safe: {}, sensitive: { error } }); return false; })
      .finally(() => { if (this.codexPetOverlayKWinPointer === lease) this.codexPetOverlayKWinPointer = null; });
  };
  this.codexPetOverlayKWinPointer = lease;
  lease.ready = (async () => {
    if (previous && !await previous.cancel()) return false;
    await bridge.request(bounds ? "prepare" : "pointer", this.codexPetOverlayKWinData(window, bounds), valid);
    return valid();
  })().catch(error => { if (error.code !== "CANCELLED") this.logger().warning?.("Could not prepare Mini pointer policy", { safe: {}, sensitive: { error } }); return false; });
  return lease;
}

function codexPetOverlayStartKWinDrag(window, pending) {
  if (!this.codexPetOverlayIsNativeKWin()) return this.codexPetOverlayStartLegacyKWinDrag(window, pending);
  const state = { ...pending, window, pending: false, native: true };
  const valid = () => this.codexPetOverlayKWinDragCurrent(state) && !state.released;
  const areas = require("electron").screen.getAllDisplays().map(display => {
    const rect = this.codexPetOverlayDisplayRect(display);
    const first = this.getLayoutForDisplay(display, { ...this.anchor,
      x: rect.x - (this.isQuickChatPresentation ? this.mascotSize.width - 26 : 0), y: rect.y }).anchor;
    const last = this.getLayoutForDisplay(display, { ...this.anchor,
      x: rect.x + rect.width - (this.isQuickChatPresentation ? 26 : 0), y: rect.y + rect.height }).anchor;
    return { display: display.bounds, x: first.x - state.mascot.left, y: first.y - state.mascot.top,
      maxX: last.x - state.mascot.left, maxY: last.y - state.mascot.top };
  });
  const bridge = this.codexPetOverlayKWinBridgeFor(window);
  state.started = Promise.resolve().then(() => bridge.request("drag", { id: state.id, pointer: state.pointer, areas }, valid))
    .then(() => true, error => { state.failed = true; if (error.code !== "CANCELLED") this.logger().warning?.("Could not start Mini drag", { safe: {}, sensitive: { error } }); return false; });
  if (state.position) this.codexPetOverlayKWinPosition = state.position;
  return state;
}

function codexPetOverlayDeferKWinEnd(caller, resume) {
  const state = this.codexPetOverlayKWinDragState;
  if (!state?.resuming && this.codexPetOverlayKWinNextDrag?.caller === caller) this.codexPetOverlayKWinNextDrag.cancelled = true;
  if (!this.codexPetOverlayIsNativeKWin() || !state?.native || state.resuming || this.window?.webContents.id !== caller) return false;
  if (state.ending) return true;
  state.ending = true; state.released = true;
  state.completion = Promise.resolve(state.started).then(() => this.codexPetOverlayKWinBridgeFor(state.window).request("endDrag", {},
    () => this.codexPetOverlayKWinDragCurrent(state))).then(result => { state.result = result; }, error => {
    state.failed = true;
    if (error.code !== "CANCELLED") this.logger().warning?.("Could not stop Mini drag", { safe: {}, sensitive: { error } });
  }).then(() => {
    if (this.codexPetOverlayKWinDragCurrent(state)) { state.resuming = true; state.stopped = true; resume(); }
  });
  return true;
}

function codexPetOverlayDeferKWinStart(caller, gestureId, resume) {
  const state = this.codexPetOverlayKWinDragState, window = this.window, sequence = this.windowVisibilitySequence;
  if (!state?.native || state.resuming || window?.webContents.id !== caller) return false;
  if (!state.ending) this.endDrag(caller, undefined, false, "superseded");
  const request = { caller, rendererGestureId: gestureId };
  this.codexPetOverlayKWinNextDrag = request;
  void state.completion?.then(() => {
    if (this.codexPetOverlayKWinNextDrag !== request || request.cancelled || this.window !== window ||
        window.isDestroyed() || !window.isVisible() || this.windowVisibilitySequence !== sequence) return;
    this.codexPetOverlayKWinNextDrag = null;
    resume();
  });
  return true;
}

async function codexPetOverlayCompleteRendererDrag(caller, gestureId, altKey) {
  if (!this.codexPetOverlayIsNativeKWin() || !this.codexPetOverlayDragFromCurrentRenderer(caller) ||
      typeof gestureId !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(gestureId) || typeof altKey !== "boolean")
    throw Error("Invalid Mini gesture completion");
  const next = this.codexPetOverlayKWinNextDrag;
  if (next?.caller === caller && next.rendererGestureId === gestureId) {
    next.cancelled = true;
    this.codexPetOverlayKWinNextDrag = null;
    throw Error("Mini gesture ended before compositor handoff");
  }
  const state = this.codexPetOverlayKWinDragState ?? this.codexPetOverlayMascotDragState;
  if (!state || state.rendererGestureId !== gestureId) throw Error("Stale Mini gesture completion");
  // Release must retire a pending start before its placement acknowledgement can resume it.
  if (state.pending) {
    this.endDrag(caller, undefined, altKey);
    throw Error("Mini gesture ended before compositor handoff");
  }
  if (state === this.codexPetOverlayKWinDragState && !state.native) throw Error("Mini gesture is not ready");
  if (!state.ending) this.endDrag(caller, undefined, altKey);
  if (!state.native) return false;
  await state.completion;
  if (state.failed || typeof state.result?.moved !== "boolean") throw Error("Mini gesture was not confirmed");
  return state.result.moved;
}

function codexPetOverlayKWinProximity() {
  const window = this.window;
  if (!window || window.isDestroyed() || !window.isVisible()) { this.setPetPointerProximity(false); return; }
  const enabled = this.shouldPresentWindow() && !this.hiddenForApplicationHide && this.layoutMode === "native" &&
    (this.isNotchEnabled || this.showsPetControls && !this.isQuickChatPresentation);
  if (!enabled && !this.codexPetOverlayKWinBridge) { this.setPetPointerProximity(false); return; }
  const rects = enabled && this.layout?.mascot ? [this.layout.mascot, ...(this.petControlsProximityRects ?? [])] : [];
  const data = { rects, enter: this.petControlsAppearance?.proximityEnterDistance ?? 0,
    exit: this.petControlsAppearance?.proximityExitDistance ?? 0 };
  const key = JSON.stringify(data), bridge = this.codexPetOverlayKWinBridgeFor(window);
  if (bridge.closed) { this.setPetPointerProximity(false); return; }
  if (this.codexPetOverlayKWinProximityKey === key && this.codexPetOverlayKWinProximityEpoch === bridge.epoch) return;
  this.codexPetOverlayKWinProximityKey = key; this.codexPetOverlayKWinProximityEpoch = bridge.epoch;
  // Layouts can arrive in bursts; only publish the latest geometry.
  if (this.codexPetOverlayKWinProximityPending) return;
  this.codexPetOverlayKWinProximityPending = true;
  void Promise.resolve().then(() => {
    this.codexPetOverlayKWinProximityPending = false;
    if (this.window !== window || window.isDestroyed() || !window.isVisible()) return;
    const payload = JSON.parse(this.codexPetOverlayKWinProximityKey);
    void bridge.request("proximity", payload).catch(error => {
      this.codexPetOverlayKWinProximityKey = null;
      if (error.code !== "CANCELLED") this.logger().warning?.("Could not update Mini proximity", { safe: {}, sensitive: { error } });
    });
  });
}

module.exports = { codexPetOverlayKWinBridgeFor, codexPetOverlayKWinData, codexPetOverlayActivateKWin,
  codexPetOverlayKWinRun, codexPetOverlayStartKWinPointer, codexPetOverlayStartKWinDrag,
  codexPetOverlayDeferKWinEnd, codexPetOverlayDeferKWinStart, codexPetOverlayKWinProximity,
  codexPetOverlayCompleteRendererDrag };
