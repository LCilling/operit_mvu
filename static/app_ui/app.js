(function (ui) {
  "use strict";
  const appRoot = document.getElementById("appRoot");
  const backgroundPicker = document.getElementById("backgroundPicker");
  const datasetImportPicker = document.getElementById("datasetImportPicker");
  const toast = document.getElementById("toast");
  const BACKGROUND_KEY = "operit_mvu.customBackground";
  const BACKGROUND_MAX_EDGE = 1600;
  let toastTimer = 0;

  ui.render = render;
  ui.switchStatusMode = switchStatusMode;
  ui.importDatasetText = importDataset;
  ui.exportDataset = exportDataset;

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
    } else if (action === "close-drawer") {
      ui.state.drawerOpen = false;
      render();
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
    errorNode.textContent = "";
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      errorNode.textContent = "请输入有效的上下限数值。";
      return;
    }
    if (minimum >= maximum) {
      errorNode.textContent = "下限必须小于上限。";
      return;
    }
    setBusy(true);
    try {
      await ui.native.call("updateField", { id: button.dataset.fieldId, patch: { minimum, maximum } });
      await ui.loadSnapshot();
      render();
      showToast("字段范围已保存");
    } catch (error) {
      errorNode.textContent = "保存失败，请重新载入后再试。";
    } finally {
      setBusy(false);
    }
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
    const image = stored ? 'url("' + stored.replaceAll('"', "%22") + '")' : 'url("./assets/character-state-theme.png")';
    document.documentElement.style.setProperty("--page-background-image", image);
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
