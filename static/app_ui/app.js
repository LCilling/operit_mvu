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
  const listSearchTimers = new Map();

  ui.render = render;
  ui.patchEntityPicker = patchEntityPicker;
  ui.patchManagementList = patchManagementList;
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
    if (ui.state.entityPicker) {
      Promise.resolve().then(function () {
        if (!ui.state.entityPicker) return;
        const pickerSearch = appRoot.querySelector("[data-picker-search]");
        if (pickerSearch) {
          pickerSearch.focus();
          if (typeof pickerSearch.setSelectionRange === "function") {
            const end = pickerSearch.value.length;
            pickerSearch.setSelectionRange(end, end);
          }
        }
      });
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

  function fragmentFromHtml(html, selector) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content.querySelector(selector);
  }

  function patchEntityPicker() {
    const current = appRoot.querySelector(".entity-picker");
    if (!ui.state.entityPicker || !current) {
      render();
      return;
    }
    const results = current.querySelector("[data-picker-results]");
    const search = current.querySelector("[data-picker-search]");
    const active = document.activeElement;
    const activePickerId = active && active.dataset ? active.dataset.pickerId || "" : "";
    const activeAction = active && active.dataset ? active.dataset.action || "" : "";
    const searchActive = active === search;
    const resultsActive = active === results;
    const selection = searchActive && typeof search.selectionStart === "number"
      ? [search.selectionStart, search.selectionEnd, search.selectionDirection]
      : null;
    const scrollTop = results ? results.scrollTop : 0;
    if (results) ui.updateEntityPickerViewport(scrollTop, results.clientHeight);
    const next = fragmentFromHtml(ui.components.renderEntityPicker(ui.state.entityPicker), ".entity-picker");
    if (!next) {
      render();
      return;
    }
    ["[data-picker-pinned-region]", "[data-picker-results]", "[data-picker-footer]"].forEach(function (selector) {
      const currentRegion = current.querySelector(selector);
      const nextRegion = next.querySelector(selector);
      if (currentRegion && nextRegion) currentRegion.innerHTML = nextRegion.innerHTML;
    });
    const nextResults = current.querySelector("[data-picker-results]");
    if (nextResults) nextResults.scrollTop = scrollTop;
    if (searchActive && search) {
      search.focus({ preventScroll: true });
      if (selection && typeof search.setSelectionRange === "function") {
        search.setSelectionRange(selection[0], selection[1], selection[2] || "none");
      }
      return;
    }
    let focusTarget = null;
    if (activePickerId) {
      focusTarget = Array.from(current.querySelectorAll("[data-picker-id]")).find(function (candidate) {
        return candidate.dataset.pickerId === activePickerId;
      }) || null;
    } else if (activeAction) {
      focusTarget = Array.from(current.querySelectorAll("[data-action]")).find(function (candidate) {
        return candidate.dataset.action === activeAction;
      }) || null;
    } else if (resultsActive) {
      focusTarget = nextResults;
    }
    if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus({ preventScroll: true });
  }

  function patchManagementList(routeId) {
    const route = ui.routes[routeId];
    const renderer = route && ui.pages[route.page];
    const current = appRoot.querySelector('[data-management-region="' + routeId + '"]');
    if (!current || typeof renderer !== "function") {
      render();
      return;
    }
    const next = fragmentFromHtml(renderer(), '[data-management-region="' + routeId + '"]');
    if (!next) {
      render();
      return;
    }
    const screenScroll = appRoot.querySelector(".screen-scroll");
    const scrollTop = screenScroll ? screenScroll.scrollTop : 0;
    const focusDescriptor = managementFocusDescriptor(document.activeElement);
    current.innerHTML = next.innerHTML;
    const focusTarget = resolveManagementFocus(focusDescriptor);
    if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus({ preventScroll: true });
    if (screenScroll) screenScroll.scrollTop = scrollTop;
  }

  function managementFocusDescriptor(element) {
    const data = element && element.dataset;
    if (!data) return null;
    if (data.pageRoute && data.pageDirection) {
      return { kind: "page", route: data.pageRoute, direction: data.pageDirection };
    }
    if (data.listFilterRoute && data.listFilterKey) {
      return { kind: "filter", route: data.listFilterRoute, key: data.listFilterKey };
    }
    if (data.listSearchRoute) return { kind: "search", route: data.listSearchRoute };
    return null;
  }

  function resolveManagementFocus(descriptor) {
    if (!descriptor) return null;
    const selector = descriptor.kind === "page" ? "[data-page-route]" :
      descriptor.kind === "filter" ? "[data-list-filter-route]" : "[data-list-search-route]";
    const candidates = Array.from(appRoot.querySelectorAll(selector));
    const exact = candidates.find(function (candidate) {
      if (descriptor.kind === "page") {
        return candidate.dataset.pageRoute === descriptor.route && candidate.dataset.pageDirection === descriptor.direction;
      }
      if (descriptor.kind === "filter") {
        return candidate.dataset.listFilterRoute === descriptor.route && candidate.dataset.listFilterKey === descriptor.key;
      }
      return candidate.dataset.listSearchRoute === descriptor.route;
    }) || null;
    if (descriptor.kind !== "page" || (exact && !exact.disabled)) return exact;
    return candidates.find(function (candidate) {
      return candidate.dataset.pageRoute === descriptor.route && !candidate.disabled;
    }) || null;
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
    const pickerChoice = target.closest("[data-picker-id]");
    if (pickerChoice) {
      ui.toggleEntityPickerSelection(pickerChoice.dataset.pickerId);
      return;
    }
    const pageButton = target.closest("[data-page-route]");
    if (pageButton && !pageButton.disabled) {
      setBusy(true);
      try {
        await ui.updateListView(pageButton.dataset.pageRoute, { page: Number(pageButton.dataset.page) });
        patchManagementList(pageButton.dataset.pageRoute);
      } finally {
        setBusy(false);
      }
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
      await reloadContext(
        { groupId: ui.state.snapshot.activeContext.groupId, actorId: actor.dataset.selectActor },
        ui.state.snapshot.activeContext.groupId,
        "character"
      );
      return;
    }
    const group = target.closest("[data-select-group]");
    if (group) {
      await reloadContext({ groupId: group.dataset.selectGroup }, group.dataset.selectGroup, "group");
      return;
    }
    const actionButton = target.closest("[data-action]");
    if (!actionButton) return;
    if (target.closest("[data-stop-close]") &&
        (actionButton.classList.contains("drawer-layer") || actionButton.classList.contains("picker-layer"))) return;
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
    } else if (action === "open-status-actor-picker" || action === "open-status-group-picker") {
      await openStatusPicker(action, element);
    } else if (action === "open-field-picker" || action === "open-actor-picker" || action === "open-condition-picker" || action === "open-effect-picker" || action === "open-group-picker") {
      await openPickerForTrigger(action, element);
    } else if (action === "close-entity-picker") {
      ui.closeEntityPicker();
    } else if (action === "retry-entity-picker") {
      await ui.retryEntityPicker();
    } else if (action === "confirm-entity-picker") {
      ui.confirmEntityPicker();
    }
  }

  async function openStatusPicker(action, element) {
    const groupMode = action === "open-status-group-picker";
    const activeGroupId = ui.state.snapshot.activeContext.groupId;
    await ui.openEntityPicker({
      entity: groupMode ? "groups" : "actors",
      title: groupMode ? "查找群组" : "查找角色",
      mode: "single",
      filters: !groupMode && activeGroupId ? { groupId: activeGroupId } : {},
      lockedFilterKeys: !groupMode && activeGroupId ? ["groupId"] : [],
      selectedIds: groupMode
        ? [ui.state.snapshot.activeContext.groupId].filter(Boolean)
        : [ui.state.snapshot.activeContext.actorId].filter(Boolean),
      opener: element,
      async onCommit(ids) {
        const id = ids[0];
        if (!id) return;
        if (groupMode) {
          await reloadContext({ groupId: id }, id, "group");
        } else {
          await reloadContext({ groupId: activeGroupId, actorId: id }, activeGroupId, "character");
        }
      },
    });
  }

  async function openPickerForTrigger(action, element) {
    const definitions = {
      "open-field-picker": { entity: "fields", title: "选择字段", mode: "single" },
      "open-actor-picker": { entity: "actors", title: "选择角色", mode: "multiple" },
      "open-group-picker": { entity: "groups", title: "选择群组", mode: "multiple" },
      "open-condition-picker": { entity: "conditions", title: "选择条件", mode: "single" },
      "open-effect-picker": { entity: "effectGroups", title: "选择临时效果", mode: "multiple" },
    };
    const definition = definitions[action];
    const key = element.dataset.pickerKey || action;
    let initialIds = [];
    try {
      const parsed = JSON.parse(element.dataset.pickerSelected || "[]");
      if (Array.isArray(parsed) && parsed.every(function (id) { return typeof id === "string"; })) initialIds = parsed;
    } catch (_error) {
      initialIds = [];
    }
    const previous = ui.state.editorSelections[key] || { ids: initialIds, items: [] };
    await ui.openEntityPicker({
      ...definition,
      mode: element.dataset.pickerMode || definition.mode,
      selectedIds: previous.ids,
      selectedItems: previous.items,
      opener: element,
      onCommit(ids, items) {
        ui.state.editorSelections[key] = { ids, items };
      },
    });
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
    if (ui.state.entityPicker) {
      const picker = appRoot.querySelector(".entity-picker");
      if (event.key === "Escape") {
        event.preventDefault();
        ui.closeEntityPicker();
        return;
      }
      const results = picker ? Array.from(picker.querySelectorAll("[data-picker-id].picker-result")) : [];
      const currentResult = event.target instanceof Element ? event.target.closest(".picker-result") : null;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const search = event.target instanceof Element ? event.target.closest("[data-picker-search]") : null;
        if (search || currentResult) {
          event.preventDefault();
          const current = currentResult ? results.indexOf(currentResult) : (event.key === "ArrowDown" ? -1 : 0);
          const next = Math.max(0, Math.min(results.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
          if (results[next]) results[next].focus();
          return;
        }
      }
      if (event.key === "Tab" && picker) {
        trapFocus(picker, event);
        return;
      }
    }
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
    if (drawer) trapFocus(drawer, event);
  }

  function trapFocus(container, event) {
    const focusable = Array.from(container.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
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

  function handleAppInput(event) {
    handleRangeInput(event);
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const pickerSearch = target.closest("[data-picker-search]");
    if (pickerSearch) {
      ui.searchEntityPicker(pickerSearch.value);
      return;
    }
    const listSearch = target.closest("[data-list-search-route]");
    if (!listSearch) return;
    const route = listSearch.dataset.listSearchRoute;
    if (listSearchTimers.has(route)) window.clearTimeout(listSearchTimers.get(route));
    listSearchTimers.set(route, window.setTimeout(function () {
      listSearchTimers.delete(route);
      void ui.updateListView(route, { search: listSearch.value }).then(function () {
        patchManagementList(route);
      }).catch(function () { showToast("搜索失败，请重试"); });
    }, 180));
  }

  function handleAppChange(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const listFilter = target.closest("[data-list-filter-route]");
    if (listFilter) {
      const route = listFilter.dataset.listFilterRoute;
      const key = listFilter.dataset.listFilterKey;
      const pageKey = {
        "config-fields": "fields",
        "config-rules": "rules",
        "config-conditions": "conditions",
        "config-effects": "effectGroups",
        records: "records",
      }[route];
      const filters = { ...(ui.state.listViews[pageKey]?.filters || {}) };
      if (listFilter.value === "") delete filters[key];
      else filters[key] = listFilter.dataset.filterValueType === "boolean"
        ? listFilter.value === "true"
        : listFilter.value;
      void ui.updateListView(route, { filters, page: 1 }).then(function () {
        patchManagementList(route);
      }).catch(function () { showToast("筛选失败，请重试"); });
      return;
    }
    const pickerFilter = target.closest("[data-picker-filter]");
    if (pickerFilter) {
      void ui.updateEntityPickerFilter(
        pickerFilter.dataset.pickerFilter,
        pickerFilter.value,
        pickerFilter.dataset.filterValueType || "string"
      );
    }
  }

  function handleAppScroll(event) {
    const results = event.target instanceof Element ? event.target.closest("[data-picker-results]") : null;
    if (!results) return;
    const nearBoundary = results.scrollTop + results.clientHeight >= results.scrollHeight - 72;
    if (ui.updateEntityPickerViewport(results.scrollTop, results.clientHeight)) patchEntityPicker();
    if (nearBoundary) {
      void ui.fetchNextEntityPickerPage();
    }
  }

  async function switchStatusMode(mode) {
    if (mode !== "character" && mode !== "group") throw new Error("MVU_STATUS_MODE_INVALID");
    if (mode === "group") {
      if (ui.state.directory.groups.length === 0) {
        await ui.loadDirectory(ui.state.snapshot.activeContext.groupId || null);
      }
      const selected = ui.state.snapshot.activeContext.groupId ||
        (ui.state.snapshot.selected.group && ui.state.snapshot.selected.group.characterGroupId) ||
        (ui.state.directory.groups[0] && ui.state.directory.groups[0].characterGroupId);
      if (!selected) {
        ui.transition(render);
        return;
      }
      await reloadContext({ groupId: selected }, selected, "group");
      return;
    }
    const groupId = ui.state.snapshot.activeContext.groupId;
    await ui.loadDirectory(groupId || null);
    const actorIds = ui.state.directory.actors.map(function (actor) { return actor.characterId; });
    const actorId = actorIds.includes(ui.state.lastActorId) ? ui.state.lastActorId : actorIds[0];
    if (!actorId) throw new Error("MVU_GROUP_MEMBER_MISSING");
    await reloadContext({ groupId, actorId }, groupId, "character", true);
  }

  async function reloadContext(request, directoryGroupId, nextMode, directoryLoaded) {
    setBusy(true);
    try {
      const snapshot = await ui.loadSnapshot(request);
      if (nextMode === "character" && snapshot.activeContext.actorId !== request.actorId) {
        throw new Error("MVU_ACTOR_PROJECTION_MISMATCH");
      }
      if (nextMode === "group" &&
          (snapshot.activeContext.groupId !== request.groupId || snapshot.activeContext.actorId !== null)) {
        throw new Error("MVU_GROUP_PROJECTION_MISMATCH");
      }
      if (!directoryLoaded) await ui.loadDirectory(directoryGroupId || null);
      await ui.loadRouteData(ui.state.route);
      if (nextMode) ui.state.statusMode = nextMode;
      await ui.transition(function () { render({ resetScroll: false }); });
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
    const minimumInput = card.querySelector('[data-range-number="minimum"]').value;
    const maximumInput = card.querySelector('[data-range-number="maximum"]').value;
    const field = ui.state.entities.get("field:" + button.dataset.fieldId);
    if (!field) {
      errorNode.textContent = "字段定义尚未载入，请重新进入本页。";
      return;
    }
    const currentValue = field.currentValue === null ? field.initialValue : field.currentValue;
    const validation = validateFieldRangeDraft(field, { minimum: minimumInput, maximum: maximumInput }, currentValue);
    errorNode.textContent = "";
    if (validation.error || !validation.changed) {
      errorNode.textContent = validation.error || "范围未变化，无需保存。";
      return;
    }
    const minimum = Number(minimumInput);
    const maximum = Number(maximumInput);
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
    const minimumInput = card.querySelector('[data-range-number="minimum"]').value;
    const maximumInput = card.querySelector('[data-range-number="maximum"]').value;
    const currentValue = field.currentValue === null ? field.initialValue : field.currentValue;
    const validation = validateFieldRangeDraft(field, { minimum: minimumInput, maximum: maximumInput }, currentValue);
    const error = card.querySelector("[data-range-error]");
    const save = card.querySelector('[data-action="save-field-range"]');
    const preview = card.querySelector("[data-range-preview]");
    if (error) error.textContent = validation.error;
    if (save) save.disabled = !validation.changed || Boolean(validation.error);
    if (preview) preview.textContent = validation.previewValue === null ? "换算后 —" : "换算后 " + ui.formatNumber(validation.previewValue);
    if (validation.previewValue !== null) {
      const minimum = Number(minimumInput);
      const maximum = Number(maximumInput);
      const position = (validation.previewValue - minimum) / (maximum - minimum) * 100;
      card.style.setProperty("--range-position", Math.max(0, Math.min(100, position)) + "%");
    }
  }

  function validateFieldRangeDraft(field, draft, currentValue) {
    const minimumMissing = typeof draft.minimum === "string" && draft.minimum.trim().length === 0;
    const maximumMissing = typeof draft.maximum === "string" && draft.maximum.trim().length === 0;
    const minimum = minimumMissing ? Number.NaN : Number(draft.minimum);
    const maximum = maximumMissing ? Number.NaN : Number(draft.maximum);
    const changed = minimum !== field.minimum || maximum !== field.maximum;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      return { changed, error: "请输入有效的上下限数值。", previewValue: null, mappedStep: null };
    }
    if (minimum >= maximum) {
      return { changed, error: "下限必须小于上限。", previewValue: null, mappedStep: null };
    }
    const previousSpan = field.maximum - field.minimum;
    const nextSpan = maximum - minimum;
    const scale = nextSpan / previousSpan;
    const mappedStep = field.step * scale;
    const precisionFloor = Math.max(1, Math.abs(minimum), Math.abs(maximum)) * Number.EPSILON * 16;
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(mappedStep) || mappedStep <= precisionFloor) {
      return { changed, error: "范围跨度超出可换算精度。", previewValue: null, mappedStep: null };
    }
    let previousThreshold = Number.NEGATIVE_INFINITY;
    for (const stage of field.stages) {
      const threshold = minimum + ((stage.threshold - field.minimum) / previousSpan) * nextSpan;
      if (!Number.isFinite(threshold) || threshold - previousThreshold <= precisionFloor) {
        return { changed, error: "范围过窄，无法保留现有阶段间隔。", previewValue: null, mappedStep: null };
      }
      previousThreshold = threshold;
    }
    const sourceValue = Number.isFinite(currentValue) ? currentValue : field.initialValue;
    const previewValue = minimum + ((sourceValue - field.minimum) / previousSpan) * nextSpan;
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
  appRoot.addEventListener("input", handleAppInput);
  appRoot.addEventListener("change", handleAppChange);
  appRoot.addEventListener("keydown", handleAppKeydown);
  appRoot.addEventListener("scroll", handleAppScroll, true);
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
