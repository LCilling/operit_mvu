(function (ui) {
  "use strict";
  const appRoot = document.getElementById("appRoot");
  const backgroundPicker = document.getElementById("backgroundPicker");
  const datasetImportPicker = document.getElementById("datasetImportPicker");
  const toast = document.getElementById("toast");
  const BACKGROUND_KEY = "operit_mvu.customBackground";
  const BACKGROUND_MAX_EDGE = 1600;
  let toastTimer = 0;
  let pendingSegmentFocusId = "";

  ui.render = render;
  ui.switchStatusMode = switchStatusMode;
  ui.importDatasetText = importDataset;
  ui.exportDataset = exportDataset;
  ui.validateFieldRangeDraft = validateFieldRangeDraft;

  function render(options) {
    const previous = appRoot.querySelector(".screen-scroll");
    const scrollTop = previous && !(options && options.resetScroll) ? previous.scrollTop : 0;
    const route = ui.routes[ui.state.route] || ui.routes.status;
    let content;
    if (ui.state.fatal) {
      content = ui.components.recoveryState(ui.state.fatal);
    } else if (ui.state.routeError) {
      content = ui.components.recoveryState(ui.state.routeError);
    } else {
      const renderer = ui.pages[route.page];
      if (typeof renderer !== "function") {
        content = ui.components.recoveryState({ title: "页面数据有误", message: "页面模块尚未注册。", action: "重试" });
      } else {
        try {
          content = renderer();
        } catch (error) {
          console.error("MVU page render failed", error);
          content = ui.components.recoveryState({ title: "页面数据有误", message: "渲染失败，请重试。", action: "重试" });
        }
      }
    }
    appRoot.innerHTML = ui.components.shell(route, content, pageOptions(route));
    const next = appRoot.querySelector(".screen-scroll");
    if (next) next.scrollTop = scrollTop;
    drawCharts();
    if (pendingSegmentFocusId) {
      const focusTarget = document.getElementById(pendingSegmentFocusId);
      pendingSegmentFocusId = "";
      if (focusTarget && appRoot.contains(focusTarget)) focusTarget.focus();
    }
  }

  function pageOptions(route) {
    if (route.page === "fieldDetail") {
      return { action: '<button type="button" class="button secondary" data-action="edit-current-field">编辑字段</button><button type="button" class="button primary" data-action="save-current-value" disabled>保存数值</button>' };
    }
    return {};
  }

  function drawCharts() {
    appRoot.querySelectorAll("canvas[data-trend-id]").forEach(function (canvas) {
      const model = ui.state.chartModels.get(canvas.dataset.trendId);
      if (model) ui.components.drawTrend(canvas, model);
    });
  }

  async function handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const routeButton = target.closest("[data-route]");
    if (routeButton) {
      await ui.navigate(routeButton.dataset.route);
      return;
    }
    const fieldButton = target.closest("[data-field-id]");
    if (fieldButton && fieldButton.dataset.action === "open-field") {
      ui.state.selectedFieldId = fieldButton.dataset.fieldId;
      await ui.navigate("field-detail");
      return;
    }
    const entityButton = target.closest("[data-open-entity]");
    if (entityButton) {
      ui.state.selectedEntityId = entityButton.dataset.entityId;
      const route = { rule: "rule-editor", condition: "condition-editor", effectGroup: "effect-editor" }[entityButton.dataset.openEntity];
      await ui.navigate(route);
      return;
    }
    const newEntityButton = target.closest("[data-new-entity]");
    if (newEntityButton) {
      ui.state.selectedEntityId = "";
      const route = { rule: "rule-editor", condition: "condition-editor", effectGroup: "effect-editor" }[newEntityButton.dataset.newEntity];
      await ui.navigate(route);
      return;
    }
    const editField = target.closest('[data-action="edit-field"]');
    if (editField) {
      ui.state.selectedEntityId = editField.dataset.fieldId;
      await ui.navigate("field-editor");
      return;
    }
    const statusMode = target.closest("[data-status-mode]");
    if (statusMode) {
      await switchStatusMode(statusMode.dataset.statusMode);
      return;
    }
    const reasonMode = target.closest("[data-reason-mode]");
    if (reasonMode) {
      ui.state.effectReasonMode = reasonMode.dataset.reasonMode === "custom" ? "custom" : "template";
      ui.transition(render);
      return;
    }
    const changeRoute = target.closest("[data-change-route]");
    if (changeRoute) {
      const route = { natural: "natural-settings", turn: "turn-settings", link: "link-settings" }[changeRoute.dataset.changeRoute];
      await ui.navigate(route);
      return;
    }
    const actor = target.closest("[data-select-actor]");
    if (actor) {
      ui.state.statusMode = "character";
      ui.state.lastActorId = actor.dataset.selectActor;
      await reloadContext({ groupId: ui.state.snapshot.activeContext.groupId, actorId: actor.dataset.selectActor });
      return;
    }
    const group = target.closest("[data-select-group]");
    if (group) {
      ui.state.statusMode = "group";
      await reloadContext({ groupId: group.dataset.selectGroup });
      return;
    }
    const actionButton = target.closest("[data-action]");
    if (!actionButton) return;
    if (target.closest("[data-stop-close]") && actionButton.classList.contains("drawer-layer")) return;
    await handleAction(actionButton.dataset.action, actionButton);
  }

  async function handleAction(action, element) {
    if (action === "go-back") {
      await ui.goBack();
    } else if (action === "open-drawer") {
      ui.state.drawerOpen = true;
      render();
      focusDrawerFirst();
    } else if (action === "close-drawer") {
      ui.state.drawerOpen = false;
      render();
      focusMenuButton();
    } else if (action === "retry") {
      await retryCurrent();
    } else if (action === "choose-background") {
      backgroundPicker.click();
    } else if (action === "reset-background") {
      window.localStorage.removeItem(BACKGROUND_KEY);
      applyBackground();
      showToast("已恢复默认背景");
    } else if (action === "choose-dataset-import") {
      datasetImportPicker.click();
    } else if (action === "export-dataset") {
      await exportDataset();
    } else if (action === "save-field-range") {
      await saveFieldRange(element);
    } else if (action === "new-field") {
      ui.state.selectedEntityId = "";
      await ui.navigate("field-editor");
    } else if (action === "edit-current-field") {
      ui.state.selectedEntityId = ui.state.selectedFieldId;
      await ui.navigate("field-editor");
    } else if (action === "open-field-picker" || action === "open-actor-picker" || action === "open-condition-picker" || action === "open-effect-picker") {
      showToast("搜索选择框将在下一步的大数据界面中打开");
    }
  }

  function focusDrawerFirst() {
    Promise.resolve().then(function () {
      const first = appRoot.querySelector(".drawer button");
      if (first) first.focus();
    });
  }

  function focusMenuButton() {
    Promise.resolve().then(function () {
      const menu = appRoot.querySelector('[data-action="open-drawer"]');
      if (menu) menu.focus();
    });
  }

  function handleAppKeydown(event) {
    const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const tabs = Array.from(tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(tab);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
        (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      const nextTab = tabs[next];
      pendingSegmentFocusId = nextTab.id;
      nextTab.focus();
      nextTab.click();
      return;
    }
    if (!ui.state.drawerOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      ui.state.drawerOpen = false;
      render();
      focusMenuButton();
      return;
    }
    if (event.key !== "Tab") return;
    const drawer = appRoot.querySelector(".drawer");
    const focusable = drawer ? Array.from(drawer.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")) : [];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function switchStatusMode(mode) {
    if (mode !== "character" && mode !== "group") throw new Error("MVU_STATUS_MODE_INVALID");
    ui.state.statusMode = mode;
    if (mode === "group") {
      const selected = ui.state.snapshot.activeContext.groupId ||
        (ui.state.snapshot.selected.group && ui.state.snapshot.selected.group.characterGroupId) ||
        (ui.state.directory.groups[0] && ui.state.directory.groups[0].characterGroupId);
      if (!selected) {
        ui.transition(render);
        return;
      }
      await reloadContext({ groupId: selected }, selected);
      return;
    }
    if (ui.state.lastActorId) {
      const groupId = ui.state.snapshot.activeContext.groupId;
      await reloadContext({ groupId, actorId: ui.state.lastActorId }, groupId);
    } else {
      ui.transition(render);
    }
  }

  async function reloadContext(request, directoryGroupId) {
    setBusy(true);
    try {
      await ui.loadSnapshot(request);
      await ui.loadDirectory(directoryGroupId || null);
      await ui.loadRouteData(ui.state.route);
      ui.transition(function () { render({ resetScroll: false }); });
    } catch (error) {
      ui.showFatal(error);
    } finally {
      setBusy(false);
    }
  }

  async function retryCurrent() {
    setBusy(true);
    try {
      await ui.loadSnapshot();
      await ui.loadRouteData(ui.state.route);
      render();
    } catch (error) {
      ui.showFatal(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveFieldRange(button) {
    const card = button.closest("[data-range-card]");
    const errorNode = card && card.querySelector("[data-range-error]");
    if (!card || !errorNode) return;
    const minimum = Number(card.querySelector('[data-range-number="minimum"]').value);
    const maximum = Number(card.querySelector('[data-range-number="maximum"]').value);
    const field = ui.state.entities.get("field:" + button.dataset.fieldId);
    if (!field) {
      errorNode.textContent = "字段定义尚未载入，请重新进入本页。";
      return;
    }
    const summary = ui.state.snapshot.pages.fields.items.find(function (item) { return item.id === field.id; });
    const currentValue = summary && summary.current ? summary.current.value : field.initialValue;
    const validation = validateFieldRangeDraft(field, { minimum, maximum }, currentValue);
    errorNode.textContent = "";
    if (validation.error || !validation.changed) {
      errorNode.textContent = validation.error || "范围未变化，无需保存。";
      return;
    }
    setBusy(true);
    try {
      await ui.native.call("updateField", { id: button.dataset.fieldId, patch: { minimum, maximum } });
      await ui.loadSnapshot();
      await ui.loadRouteData("config-fields");
      render();
      showToast("字段范围已保存");
    } catch (error) {
      errorNode.textContent = "保存失败，请重新载入后再试。";
    } finally {
      setBusy(false);
    }
  }

  function handleRangeInput(event) {
    const input = event.target instanceof Element ? event.target.closest("[data-range-number]") : null;
    if (!input) return;
    const card = input.closest("[data-range-card]");
    const field = card && ui.state.entities.get("field:" + card.dataset.rangeCard);
    if (!card || !field) return;
    const minimum = Number(card.querySelector('[data-range-number="minimum"]').value);
    const maximum = Number(card.querySelector('[data-range-number="maximum"]').value);
    const summary = ui.state.snapshot.pages.fields.items.find(function (item) { return item.id === field.id; });
    const currentValue = summary && summary.current ? summary.current.value : field.initialValue;
    const validation = validateFieldRangeDraft(field, { minimum, maximum }, currentValue);
    const error = card.querySelector("[data-range-error]");
    const save = card.querySelector('[data-action="save-field-range"]');
    const preview = card.querySelector("[data-range-preview]");
    if (error) error.textContent = validation.error;
    if (save) save.disabled = !validation.changed || Boolean(validation.error);
    if (preview) preview.textContent = validation.previewValue === null ? "换算后 —" : "换算后 " + ui.formatNumber(validation.previewValue);
    if (validation.previewValue !== null) {
      const position = (validation.previewValue - minimum) / (maximum - minimum) * 100;
      card.style.setProperty("--range-position", Math.max(0, Math.min(100, position)) + "%");
    }
  }

  function validateFieldRangeDraft(field, draft, currentValue) {
    const changed = draft.minimum !== field.minimum || draft.maximum !== field.maximum;
    if (!Number.isFinite(draft.minimum) || !Number.isFinite(draft.maximum)) {
      return { changed, error: "请输入有效的上下限数值。", previewValue: null, mappedStep: null };
    }
    if (draft.minimum >= draft.maximum) {
      return { changed, error: "下限必须小于上限。", previewValue: null, mappedStep: null };
    }
    const previousSpan = field.maximum - field.minimum;
    const nextSpan = draft.maximum - draft.minimum;
    const scale = nextSpan / previousSpan;
    const mappedStep = field.step * scale;
    const precisionFloor = Math.max(1, Math.abs(draft.minimum), Math.abs(draft.maximum)) * Number.EPSILON * 16;
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(mappedStep) || mappedStep <= precisionFloor) {
      return { changed, error: "范围跨度超出可换算精度。", previewValue: null, mappedStep: null };
    }
    let previousThreshold = Number.NEGATIVE_INFINITY;
    for (const stage of field.stages) {
      const threshold = draft.minimum + ((stage.threshold - field.minimum) / previousSpan) * nextSpan;
      if (!Number.isFinite(threshold) || threshold - previousThreshold <= precisionFloor) {
        return { changed, error: "范围过窄，无法保留现有阶段间隔。", previewValue: null, mappedStep: null };
      }
      previousThreshold = threshold;
    }
    const sourceValue = Number.isFinite(currentValue) ? currentValue : field.initialValue;
    const previewValue = draft.minimum + ((sourceValue - field.minimum) / previousSpan) * nextSpan;
    if (!Number.isFinite(previewValue)) {
      return { changed, error: "当前值换算后超出数值范围。", previewValue: null, mappedStep: null };
    }
    return { changed, error: "", previewValue, mappedStep };
  }

  async function exportDataset() {
    setBusy(true);
    try {
      const result = await ui.native.call("exportDataset", {});
      if (!result || typeof result.fileName !== "string" || typeof result.savedPath !== "string") {
        throw new Error("MVU_EXPORT_RESPONSE_INVALID");
      }
      showToast("已导出到 " + result.savedPath);
      return result;
    } finally {
      setBusy(false);
    }
  }

  backgroundPicker.addEventListener("change", function () {
    const file = backgroundPicker.files && backgroundPicker.files[0];
    if (!file) return;
    void encodeBackground(file).then(function (encoded) {
      window.localStorage.setItem(BACKGROUND_KEY, encoded);
      applyBackground();
      showToast("背景已更新");
    }).catch(function () { showToast("背景处理失败，请选择其他图片"); });
  });

  async function encodeBackground(file) {
    const source = await readFileAsDataUrl(file);
    const image = await loadImage(source);
    const scale = Math.min(1, BACKGROUND_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("MVU_BACKGROUND_CANVAS_UNAVAILABLE");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(reader.error || new Error("MVU_BACKGROUND_READ_FAILED")); };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(source) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("MVU_BACKGROUND_DECODE_FAILED")); };
      image.src = source;
    });
  }

  datasetImportPicker.addEventListener("change", function () {
    const file = datasetImportPicker.files && datasetImportPicker.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () { void importDataset(String(reader.result || "")); };
    reader.readAsText(file);
  });

  async function importDataset(source) {
    setBusy(true);
    try {
      JSON.parse(source);
      await ui.native.call("importDataset", { json: source });
      await ui.loadSnapshot();
      render();
      showToast("数据已导入");
    } catch (error) {
      showToast("导入失败，请检查备份文件");
    } finally {
      setBusy(false);
    }
  }

  function applyBackground() {
    const stored = window.localStorage.getItem(BACKGROUND_KEY);
    if (stored) document.documentElement.style.setProperty("--page-background-image", 'url("' + stored.replaceAll('"', "%22") + '")');
    else document.documentElement.style.removeProperty("--page-background-image");
  }

  function setBusy(value) {
    ui.state.busy = value;
    appRoot.toggleAttribute("aria-busy", value);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("visible");
    toastTimer = window.setTimeout(function () { toast.classList.remove("visible"); }, 2400);
  }

  appRoot.addEventListener("click", function (event) {
    void handleClick(event).catch(function (error) {
      console.error("MVU UI action failed", error);
      showToast("操作失败，请重试");
    });
  });
  appRoot.addEventListener("input", handleRangeInput);
  appRoot.addEventListener("keydown", handleAppKeydown);
  window.addEventListener("resize", drawCharts);

  async function boot() {
    applyBackground();
    appRoot.innerHTML = '<section class="boot-state"><span class="material-symbols-rounded" aria-hidden="true">favorite</span><p>正在连接动态状态…</p></section>';
    try {
      await ui.loadSnapshot();
      await ui.loadRouteData(ui.state.route);
      render({ resetScroll: true });
    } catch (error) {
      console.error("MVU UI boot failed", error);
      ui.showFatal(error);
    }
  }

  void boot();
}(window.MvuUi));
