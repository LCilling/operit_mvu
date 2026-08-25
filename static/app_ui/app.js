(function (ui) {
  "use strict";
  const appRoot = document.getElementById("appRoot");
  const backgroundPicker = document.getElementById("backgroundPicker");
  const datasetImportPicker = document.getElementById("datasetImportPicker");
  const fieldTemplateImportPicker = document.getElementById("fieldTemplateImportPicker");
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
  ui.importFieldTemplateText = importFieldTemplateText;
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
      ui.resetFieldEditorDraft();
      await ui.navigate("field-editor");
      return;
    }
    const scopeOption = target.closest("[data-scope]");
    if (scopeOption && scopeOption.closest('[data-form="field-editor"]')) {
      selectFieldScope(scopeOption.dataset.scope);
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
        (actionButton.classList.contains("drawer-layer") || actionButton.classList.contains("picker-layer") ||
          actionButton.classList.contains("field-template-layer"))) return;
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
      ui.resetFieldEditorDraft();
      await ui.navigate("field-editor");
    } else if (action === "edit-current-field") {
      ui.state.selectedEntityId = ui.state.selectedFieldId;
      ui.resetFieldEditorDraft();
      await ui.navigate("field-editor");
    } else if (action === "add-field-stage") {
      addFieldStage();
    } else if (action === "remove-field-stage") {
      removeFieldStage(Number(element.dataset.stageIndex));
    } else if (action === "open-field-template-import") {
      ui.state.fieldTemplateImportOpener = element;
      fieldTemplateImportPicker.click();
    } else if (action === "open-field-template-export") {
      openFieldTemplateExport(element);
    } else if (action === "close-field-template-flow") {
      closeFieldTemplateFlow();
    } else if (action === "choose-template-export-fields") {
      await chooseTemplateExportFields(element);
    } else if (action === "choose-template-export-targets") {
      await chooseTemplateExportTargets(element);
    } else if (action === "commit-field-template-export") {
      await commitFieldTemplateExport();
    } else if (action === "next-field-template-import") {
      moveFieldTemplateImport(1);
    } else if (action === "previous-field-template-import") {
      moveFieldTemplateImport(-1);
    } else if (action === "choose-template-import-targets") {
      await chooseTemplateImportTargets(element);
    } else if (action === "set-import-field-enabled") {
      setImportFieldEnabled(element.dataset.templateFieldId, element.dataset.importBatchMode);
    } else if (action === "commit-field-template-import") {
      await commitFieldTemplateImport();
    } else if (action === "refresh-field-template-preview") {
      await refreshFieldTemplatePreview();
    } else if (action === "finish-field-template-import") {
      closeFieldTemplateFlow();
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
        if (key === "field-scope-character" || key === "field-scope-group") {
          const draft = ui.state.fieldEditorDraft;
          if (draft) {
            draft.bindingIds = ids.slice();
            draft.error = "";
          }
        }
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
    if (ui.state.fieldTemplateFlow) {
      const dialog = appRoot.querySelector(".field-template-dialog");
      if (event.key === "Escape") {
        event.preventDefault();
        closeFieldTemplateFlow();
        return;
      }
      if (event.key === "Tab" && dialog) {
        trapFocus(dialog, event);
        return;
      }
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
    if (target.closest('[data-form="field-editor"]')) captureFieldEditorControl(target);
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
    if (target.closest('[data-form="field-editor"]')) {
      captureFieldEditorControl(target);
      if (target.name === "bindCurrentChat") {
        const draft = ui.state.fieldEditorDraft;
        draft.chatAutoBind = target.checked;
        draft.bindingIds = target.checked && ui.state.snapshot.activeContext.chatId
          ? [ui.state.snapshot.activeContext.chatId]
          : [];
        render();
      }
      return;
    }
    const exportTargetControl = target.closest("[data-export-target-enabled], [data-export-include-value]");
    if (exportTargetControl) {
      updateExportTargetControl(exportTargetControl);
      return;
    }
    const importStrategyControl = target.closest("[data-import-strategy]");
    if (importStrategyControl) {
      ui.state.fieldTemplateFlow.strategies[importStrategyControl.dataset.importStrategy] = importStrategyControl.value;
      ui.state.fieldTemplateFlow.error = "";
      return;
    }
    const importTargetControl = target.closest("[data-import-target-enabled], [data-import-value-policy]");
    if (importTargetControl) {
      updateImportTargetControl(importTargetControl);
      return;
    }
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

  function selectFieldScope(scope) {
    if (!["character", "group", "global", "chat"].includes(scope)) return;
    const draft = ui.state.fieldEditorDraft;
    if (!draft || draft.scope === scope) return;
    draft.scope = scope;
    draft.error = "";
    draft.bindingIds = [];
    draft.chatAutoBind = false;
    if (scope === "chat" && ui.state.snapshot.activeContext.chatId) {
      draft.chatAutoBind = true;
      draft.bindingIds = [ui.state.snapshot.activeContext.chatId];
    }
    ui.transition(render);
  }

  function captureFieldEditorControl(target) {
    const draft = ui.state.fieldEditorDraft;
    if (!draft) return;
    draft.error = "";
    const stageName = target.dataset.stageName;
    const stageThreshold = target.dataset.stageThreshold;
    const stageDescription = target.dataset.stageDescription;
    if (stageName !== undefined && draft.stages[Number(stageName)]) {
      draft.stages[Number(stageName)].name = target.value;
      return;
    }
    if (stageThreshold !== undefined && draft.stages[Number(stageThreshold)]) {
      draft.stages[Number(stageThreshold)].threshold = target.value;
      return;
    }
    if (stageDescription !== undefined && draft.stages[Number(stageDescription)]) {
      draft.stages[Number(stageDescription)].description = target.value;
      return;
    }
    const numberFields = new Set(["minimum", "maximum", "step", "initialValue"]);
    if (numberFields.has(target.name)) draft[target.name] = target.value;
    else if (["name", "description", "icon", "themeColor", "modelVisibility"].includes(target.name)) draft[target.name] = target.value;
    else if (target.name === "enabled") draft.enabled = target.checked;
    else if (target.name === "naturalEnabled") draft.naturalChange.enabled = target.checked;
    else if (target.name === "naturalUnitMs") draft.naturalChange.unitMs = target.value;
    else if (target.name === "naturalAmount") draft.naturalChange.amount = target.value;
    else if (target.name === "turnEnabled") draft.perTurnChange.enabled = target.checked;
    else if (target.name === "turnInterval") draft.perTurnChange.intervalTurns = target.value;
    else if (target.name === "turnAmount") draft.perTurnChange.amount = target.value;
    else if (target.name === "turnCountMode") draft.perTurnChange.countMode = target.value;
    else if (target.name === "aiEnabled") draft.ai.enabled = target.checked;
    else if (target.name === "aiMinConfidence") draft.ai.minConfidence = target.value;
    else if (target.name === "aiMaxDelta") draft.ai.maxDelta = target.value;
    else if (target.name === "aiPrompt") draft.ai.prompt = target.value;
  }

  function addFieldStage() {
    const draft = ui.state.fieldEditorDraft;
    if (!draft) return;
    const previous = draft.stages.at(-1);
    const threshold = previous ? Number(previous.threshold) + Number(draft.step || 1) : Number(draft.minimum || 0);
    draft.stages.push({ id: "stage-" + Date.now().toString(36) + "-" + draft.stages.length, name: "新阶段", description: "", threshold });
    render();
  }

  function removeFieldStage(index) {
    const draft = ui.state.fieldEditorDraft;
    if (!draft || draft.stages.length <= 1 || !Number.isSafeInteger(index) || index < 0 || index >= draft.stages.length) return;
    draft.stages.splice(index, 1);
    render();
  }

  function numberFromDraft(value, label) {
    if (typeof value === "string" && value.trim().length === 0) throw new Error("请填写" + label + "。");
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(label + "必须是有效数值。");
    return parsed;
  }

  function buildFieldInput(draft) {
    const minimum = numberFromDraft(draft.minimum, "数值下限");
    const maximum = numberFromDraft(draft.maximum, "数值上限");
    const step = numberFromDraft(draft.step, "变化步长");
    const initialValue = numberFromDraft(draft.initialValue, "初始值");
    if (!draft.name.trim()) throw new Error("请填写字段名称。");
    if (minimum >= maximum) throw new Error("数值下限必须小于上限。");
    if (step <= 0 || step > maximum - minimum) throw new Error("变化步长必须大于 0，且不能超过数值范围。");
    if (initialValue < minimum || initialValue > maximum) throw new Error("初始值必须位于数值范围内。");
    const stages = draft.stages.map(function (stage, index) {
      const threshold = numberFromDraft(stage.threshold, "第 " + (index + 1) + " 个阶段起始值");
      if (!String(stage.name).trim()) throw new Error("请填写第 " + (index + 1) + " 个阶段名称。");
      return { id: String(stage.id || "stage-" + (index + 1)), name: String(stage.name).trim(), description: String(stage.description || ""), threshold };
    }).sort(function (left, right) { return left.threshold - right.threshold; });
    if (stages[0].threshold !== minimum) throw new Error("首个阶段起始值必须等于数值下限。");
    if (stages.some(function (stage, index) {
      return stage.threshold < minimum || stage.threshold > maximum || (index > 0 && stage.threshold <= stages[index - 1].threshold);
    })) throw new Error("阶段起始值需在范围内并严格递增。");
    if ((draft.scope === "character" || draft.scope === "group") && draft.bindingIds.length === 0) {
      throw new Error("请选择至少一个" + (draft.scope === "character" ? "角色" : "群组") + "，或改用其它作用范围。");
    }
    return {
      name: draft.name.trim(),
      description: String(draft.description || "").trim(),
      minimum,
      maximum,
      step,
      initialValue,
      icon: String(draft.icon || "favorite").trim() || "favorite",
      themeColor: String(draft.themeColor || "#7058d8"),
      enabled: Boolean(draft.enabled),
      scope: draft.scope,
      modelVisibility: draft.modelVisibility,
      ai: {
        enabled: Boolean(draft.ai.enabled),
        minConfidence: numberFromDraft(draft.ai.minConfidence, "AI 最低置信度"),
        maxDelta: numberFromDraft(draft.ai.maxDelta, "AI 单次最大变化"),
        prompt: String(draft.ai.prompt || ""),
      },
      stages,
      bindingIds: draft.scope === "global" ? [] : draft.bindingIds.slice(),
      naturalChange: {
        enabled: Boolean(draft.naturalChange.enabled),
        unitMs: numberFromDraft(draft.naturalChange.unitMs, "自然变化间隔"),
        amount: numberFromDraft(draft.naturalChange.amount, "自然变化量"),
      },
      perTurnChange: {
        enabled: Boolean(draft.perTurnChange.enabled),
        intervalTurns: numberFromDraft(draft.perTurnChange.intervalTurns, "每轮变化间隔"),
        amount: numberFromDraft(draft.perTurnChange.amount, "每轮变化量"),
        countMode: draft.perTurnChange.countMode,
      },
    };
  }

  async function saveFieldEditor() {
    const draft = ui.state.fieldEditorDraft;
    if (!draft) return;
    try {
      const field = buildFieldInput(draft);
      setBusy(true);
      if (draft.identity === "__new__") await ui.native.call("addField", { field });
      else await ui.native.call("updateField", { id: draft.identity, patch: field });
      await ui.loadSnapshot();
      ui.state.listViews.fields = { ...ui.state.listViews.fields, page: 1, search: field.name, filters: {} };
      ui.resetFieldEditorDraft();
      ui.state.selectedEntityId = "";
      await ui.navigate("config-fields", { replace: true, force: true });
      showToast(draft.identity === "__new__" ? "字段已创建" : "字段已保存");
    } catch (error) {
      draft.error = error instanceof Error ? error.message : "保存失败，请重试。";
      render();
    } finally {
      setBusy(false);
    }
  }

  function fieldTemplateFocusDescriptor(action) {
    return { action };
  }

  function focusFieldTemplateDialog() {
    Promise.resolve().then(function () {
      const dialog = appRoot.querySelector(".field-template-dialog");
      if (!dialog) return;
      const first = dialog.querySelector("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
      if (first && typeof first.focus === "function") first.focus();
    });
  }

  function focusFieldTemplateOpener(restoreFocus, descriptor) {
    let target = restoreFocus;
    if (descriptor && descriptor.action) {
      target = Array.from(appRoot.querySelectorAll("[data-action]")).find(function (candidate) {
        return candidate.dataset.action === descriptor.action;
      }) || target;
    }
    if (target && typeof target.focus === "function") target.focus();
  }

  function openFieldTemplateExport(opener) {
    ui.state.fieldTemplateFlow = {
      mode: "export",
      selectedFields: [],
      exportTargets: {},
      error: "",
      result: null,
      restoreFocus: opener || null,
      restoreFocusDescriptor: fieldTemplateFocusDescriptor("open-field-template-export"),
    };
    render();
    focusFieldTemplateDialog();
  }

  function closeFieldTemplateFlow() {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow) return;
    const restoreFocus = flow.restoreFocus;
    const descriptor = flow.restoreFocusDescriptor;
    ui.state.fieldTemplateFlow = null;
    void ui.transition(render).then(function () {
      focusFieldTemplateOpener(restoreFocus, descriptor);
    });
  }

  async function chooseTemplateExportFields(opener) {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow || flow.mode !== "export") return;
    await ui.openEntityPicker({
      entity: "fields",
      title: "选择要导出的字段",
      mode: "multiple",
      selectedIds: flow.selectedFields.map(function (field) { return field.id; }),
      selectedItems: flow.selectedFields,
      opener,
      onCommit(ids, items) {
        const itemById = new Map(items.map(function (item) { return [item.id, item]; }));
        flow.selectedFields = ids.map(function (id) { return itemById.get(id); }).filter(Boolean);
        const retained = {};
        flow.selectedFields.forEach(function (field) { retained[field.id] = flow.exportTargets[field.id] || []; });
        flow.exportTargets = retained;
        flow.error = "";
      },
    });
  }

  async function chooseTemplateExportTargets(opener) {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow || flow.mode !== "export") return;
    const field = flow.selectedFields.find(function (candidate) { return candidate.id === opener.dataset.templateFieldId; });
    if (!field) return;
    const previous = flow.exportTargets[field.id] || [];
    const group = opener.dataset.templateTargetEntity === "groups";
    await ui.openEntityPicker({
      entity: group ? "groups" : "actors",
      title: group ? "选择已绑定群组" : "选择已绑定角色",
      mode: "multiple",
      selectedIds: previous.map(function (target) { return target.targetId; }),
      selectedItems: previous.map(function (target) {
        return group ? { characterGroupId: target.targetId, name: target.name } : { characterId: target.targetId, name: target.name, enabled: true };
      }),
      opener,
      onCommit(ids, items) {
        const invalid = ids.filter(function (id) { return !field.bindingIds.includes(id); });
        if (invalid.length) {
          flow.error = "只能导出该字段已经绑定的" + (group ? "群组" : "角色") + "；请先修改字段作用范围。";
          return;
        }
        const itemById = new Map(items.map(function (item) { return [group ? item.characterGroupId : item.characterId, item]; }));
        const oldById = new Map(previous.map(function (target) { return [target.targetId, target]; }));
        flow.exportTargets[field.id] = ids.map(function (id) {
          const old = oldById.get(id);
          const item = itemById.get(id);
          return { targetId: id, name: item ? item.name : old ? old.name : id, enabled: old ? old.enabled : true, includeValue: old ? old.includeValue : false };
        });
        flow.error = "";
      },
    });
  }

  function updateExportTargetControl(target) {
    const row = target.closest("[data-template-export-target-id]");
    const flow = ui.state.fieldTemplateFlow;
    if (!row || !flow || flow.mode !== "export") return;
    const matrix = flow.exportTargets[row.dataset.templateFieldId] || [];
    const entry = matrix.find(function (item) { return item.targetId === row.dataset.templateExportTargetId; });
    if (!entry) return;
    if (target.hasAttribute("data-export-target-enabled")) {
      entry.enabled = target.checked;
      if (!entry.enabled) entry.includeValue = false;
      render();
    } else {
      entry.includeValue = target.checked;
    }
    flow.error = "";
  }

  async function commitFieldTemplateExport() {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow || flow.mode !== "export" || flow.selectedFields.length === 0) return;
    const request = {
      fieldIds: flow.selectedFields.map(function (field) { return field.id; }),
      targetSelections: flow.selectedFields.filter(function (field) {
        return field.scope === "character" || field.scope === "group";
      }).map(function (field) {
        return {
          fieldId: field.id,
          targets: (flow.exportTargets[field.id] || []).map(function (target) {
            return { targetId: target.targetId, enabled: Boolean(target.enabled), includeValue: Boolean(target.enabled && target.includeValue) };
          }),
        };
      }),
    };
    flow.error = "";
    setBusy(true);
    try {
      const result = await ui.native.call("exportFieldTemplate", request);
      if (!result || typeof result.fileName !== "string" || typeof result.savedPath !== "string" || !result.summary) {
        throw new Error("宿主返回的导出结果不完整。");
      }
      flow.result = result;
      render();
      showToast("已保存到 " + result.savedPath);
    } catch (error) {
      flow.error = "导出失败：" + (error instanceof Error ? error.message : "请重试");
      render();
    } finally {
      setBusy(false);
    }
  }

  async function importFieldTemplateText(json, fileName) {
    const source = String(json || "");
    const opener = ui.state.fieldTemplateImportOpener;
    ui.state.fieldTemplateImportOpener = null;
    const flow = {
      mode: "import",
      step: 1,
      fileName: fileName || "字段模板.json",
      json: source,
      error: "正在检查模板…",
      result: null,
      refreshing: false,
      staleRevision: false,
      restoreFocus: opener || null,
      restoreFocusDescriptor: fieldTemplateFocusDescriptor("open-field-template-import"),
    };
    ui.state.fieldTemplateFlow = flow;
    render();
    focusFieldTemplateDialog();
    await loadFieldTemplatePreview(flow, false);
  }

  function supportedImportStrategy(field, strategy) {
    if (strategy === "create_copy") return true;
    if (strategy === "update") return field.conflict === "id" && field.updateCompatibility.available;
    return strategy === "replace" && field.conflict === "id";
  }

  function defaultImportMappings(preview) {
    const mappings = {};
    preview.mappingNeeds.forEach(function (need) {
      need.sourceTargets.forEach(function (sourceTarget) {
        const key = need.fieldId + "\u0000" + sourceTarget.sourceId;
        mappings[key] = sourceTarget.suggestedTarget ? [{
          targetId: sourceTarget.suggestedTarget.targetId,
          name: sourceTarget.suggestedTarget.name,
          enabled: true,
          suggestedEnabled: true,
          valuePolicy: sourceTarget.hasValue ? "template_value" : "field_initial",
        }] : [];
      });
      if (need.requiresLocalTargets) mappings[need.fieldId + "\u0000__unbound__"] = [];
    });
    return mappings;
  }

  function repairSummary(preview) {
    const categoryOrder = ["rule", "condition", "link_rule", "effect_group", "other_dependency", "unexpanded", "invalid"];
    const labels = {
      rule: "规则",
      condition: "条件",
      link_rule: "状态联动",
      effect_group: "临时效果",
      other_dependency: "其他依赖",
      unexpanded: "其他未展开依赖",
      invalid: "其他无效引用",
    };
    const counts = new Map();
    const omittedFields = new Set();
    const omittedKeys = new Set();
    let omittedTotal = 0;
    preview.omittedDependencies.forEach(function (group) {
      omittedFields.add(group.fieldId);
      omittedTotal += group.totalCount;
      let displayed = 0;
      const seenItems = new Set();
      group.items.forEach(function (item) {
        const key = group.fieldId + "\u0000" + item.kind + "\u0000" + item.sourceId;
        if (seenItems.has(key)) return;
        seenItems.add(key);
        displayed += 1;
        const category = Object.prototype.hasOwnProperty.call(labels, item.kind) ? item.kind : "other_dependency";
        counts.set(category, (counts.get(category) || 0) + 1);
        omittedKeys.add("OMITTED_DEPENDENCY:" + group.fieldId + ":" + item.kind + ":" + item.sourceId);
      });
      const hidden = Math.max(0, group.totalCount - displayed);
      if (hidden) counts.set("unexpanded", (counts.get("unexpanded") || 0) + hidden);
    });
    const uniqueInvalid = new Set(preview.invalidReferences.filter(function (reference) {
      if (omittedKeys.has(reference)) return false;
      const omittedMatch = /^OMITTED_DEPENDENCY:([^:]+):/.exec(reference);
      if (omittedMatch && omittedFields.has(omittedMatch[1])) return false;
      const truncatedMatch = /^OMITTED_DEPENDENCIES_TRUNCATED:([^:]+):/.exec(reference);
      return !(truncatedMatch && omittedFields.has(truncatedMatch[1]));
    }));
    if (uniqueInvalid.size) counts.set("invalid", uniqueInvalid.size);
    const categories = categoryOrder.filter(function (key) { return counts.has(key); }).map(function (key) {
      return { key, label: labels[key], count: counts.get(key) };
    });
    return { count: omittedTotal + uniqueInvalid.size, categories };
  }

  async function loadFieldTemplatePreview(flow, preserveDecisions) {
    if (!flow || ui.state.fieldTemplateFlow !== flow) return;
    const previousStrategies = preserveDecisions ? { ...(flow.strategies || {}) } : {};
    const previousMappings = preserveDecisions ? { ...(flow.importMappings || {}) } : {};
    const previousStep = flow.step || 1;
    flow.refreshing = preserveDecisions;
    flow.error = preserveDecisions ? "正在用当前文件刷新预览…" : "正在检查模板…";
    render();
    setBusy(true);
    try {
      const preview = await ui.native.call("previewFieldTemplateImport", { json: flow.json });
      if (!preview || preview.valid !== true || !Number.isSafeInteger(preview.revision) || !Array.isArray(preview.fields) ||
          !Array.isArray(preview.mappingNeeds) || !Array.isArray(preview.invalidReferences) || !Array.isArray(preview.omittedDependencies)) {
        throw new Error("模板预览结果不完整。");
      }
      const strategies = {};
      preview.fields.forEach(function (field) {
        const previous = previousStrategies[field.sourceFieldId];
        strategies[field.sourceFieldId] = supportedImportStrategy(field, previous) ? previous : "create_copy";
      });
      const importMappings = defaultImportMappings(preview);
      if (preserveDecisions) {
        Object.keys(importMappings).forEach(function (key) {
          if (Array.isArray(previousMappings[key])) importMappings[key] = previousMappings[key];
        });
      }
      const repairs = repairSummary(preview);
      if (ui.state.fieldTemplateFlow !== flow) return;
      flow.preview = preview;
      flow.previewRevision = preview.revision;
      flow.strategies = strategies;
      flow.importMappings = importMappings;
      flow.repairCount = repairs.count;
      flow.repairCategories = repairs.categories;
      flow.step = preserveDecisions ? Math.max(1, Math.min(3, previousStep)) : 1;
      flow.staleRevision = false;
      flow.refreshing = false;
      flow.error = "";
      flow.result = null;
      render();
    } catch (error) {
      if (ui.state.fieldTemplateFlow === flow) {
        flow.refreshing = false;
        flow.error = (preserveDecisions ? "重新预览失败：" : "无法预览模板：") + (error instanceof Error ? error.message : "文件无效");
        render();
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshFieldTemplatePreview() {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow || flow.mode !== "import" || flow.refreshing) return;
    await loadFieldTemplatePreview(flow, true);
  }

  function moveFieldTemplateImport(delta) {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow || flow.mode !== "import" || !flow.preview) return;
    flow.step = Math.max(1, Math.min(3, flow.step + delta));
    flow.error = "";
    ui.transition(render);
  }

  async function chooseTemplateImportTargets(opener) {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow || flow.mode !== "import") return;
    const fieldId = opener.dataset.templateFieldId;
    const sourceId = opener.dataset.templateSourceId;
    const key = fieldId + "\u0000" + sourceId;
    const previous = flow.importMappings[key] || [];
    const group = opener.dataset.templateTargetEntity === "groups";
    await ui.openEntityPicker({
      entity: group ? "groups" : "actors",
      title: group ? "映射到本地群组" : "映射到本地角色",
      mode: "multiple",
      selectedIds: previous.map(function (target) { return target.targetId; }),
      selectedItems: previous.map(function (target) {
        return group ? { characterGroupId: target.targetId, name: target.name } : { characterId: target.targetId, name: target.name, enabled: true };
      }),
      opener,
      onCommit(ids, items) {
        const itemById = new Map(items.map(function (item) { return [group ? item.characterGroupId : item.characterId, item]; }));
        const oldById = new Map(previous.map(function (target) { return [target.targetId, target]; }));
        const need = flow.preview.mappingNeeds.find(function (item) { return item.fieldId === fieldId; });
        const source = sourceId === "__unbound__" ? null : need.sourceTargets.find(function (item) { return item.sourceId === sourceId; });
        flow.importMappings[key] = ids.map(function (id) {
          const old = oldById.get(id);
          const item = itemById.get(id);
          return {
            targetId: id,
            name: item ? item.name : old ? old.name : id,
            enabled: old ? old.enabled : true,
            suggestedEnabled: old ? old.suggestedEnabled : true,
            valuePolicy: old ? old.valuePolicy : source && source.hasValue ? "template_value" : "field_initial",
          };
        });
        flow.error = "";
      },
    });
  }

  function updateImportTargetControl(target) {
    const row = target.closest("[data-template-import-target-id]");
    const flow = ui.state.fieldTemplateFlow;
    if (!row || !flow || flow.mode !== "import") return;
    const key = row.dataset.templateFieldId + "\u0000" + row.dataset.templateSourceId;
    const entry = (flow.importMappings[key] || []).find(function (item) { return item.targetId === row.dataset.templateImportTargetId; });
    if (!entry) return;
    if (target.hasAttribute("data-import-target-enabled")) entry.enabled = target.checked;
    else if (["template_value", "keep_existing", "field_initial"].includes(target.value)) entry.valuePolicy = target.value;
    flow.error = "";
  }

  function setImportFieldEnabled(fieldId, mode) {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow || flow.mode !== "import" || !fieldId || !["all_on", "all_off", "file_suggestion"].includes(mode)) return;
    Object.keys(flow.importMappings || {}).forEach(function (key) {
      if (!key.startsWith(fieldId + "\u0000")) return;
      flow.importMappings[key].forEach(function (target) {
        target.enabled = mode === "all_on" ? true : mode === "all_off" ? false : target.suggestedEnabled !== false;
      });
    });
    flow.error = "";
    render();
  }

  function buildFieldTemplateImportDecisions(flow) {
    return flow.preview.fields.map(function (field) {
      const strategy = flow.strategies[field.sourceFieldId] || "create_copy";
      const need = flow.preview.mappingNeeds.find(function (item) { return item.fieldId === field.sourceFieldId; });
      const decision = { sourceFieldId: field.sourceFieldId, strategy, mappings: [] };
      if (!need || strategy === "update") return decision;
      if (need.requiresLocalTargets) {
        decision.unboundTargets = (flow.importMappings[field.sourceFieldId + "\u0000__unbound__"] || []).map(importTargetPayload);
      } else {
        decision.mappings = need.sourceTargets.map(function (source) {
          return { sourceTargetId: source.sourceId, targets: (flow.importMappings[field.sourceFieldId + "\u0000" + source.sourceId] || []).map(importTargetPayload) };
        });
      }
      return decision;
    });
  }

  function importTargetPayload(target) {
    return { targetId: target.targetId, enabled: Boolean(target.enabled), valuePolicy: target.valuePolicy };
  }

  async function commitFieldTemplateImport() {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow || flow.mode !== "import" || !flow.preview) return;
    const decisions = buildFieldTemplateImportDecisions(flow);
    flow.error = "";
    setBusy(true);
    try {
      const result = await ui.native.call("importFieldTemplate", {
        json: flow.json,
        expectedRevision: flow.previewRevision,
        decisions: { fields: decisions },
      });
      if (!result || !Number.isSafeInteger(result.revision) || !result.summary) throw new Error("宿主返回的导入结果不完整。");
      flow.result = result;
      await ui.loadSnapshot();
      await ui.loadRouteData("config-fields");
      render();
      showToast("字段模板已导入");
    } catch (error) {
      const message = error instanceof Error ? error.message : "请重试";
      flow.staleRevision = /STALE_REVISION|stale revision|revision mismatch/i.test(message);
      flow.error = flow.staleRevision
        ? "导入前数据已变化，请用同一文件重新预览后再提交。已选策略与映射会尽量保留。"
        : "导入失败：" + message;
      render();
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

  if (fieldTemplateImportPicker) {
    fieldTemplateImportPicker.addEventListener("change", function () {
      const file = fieldTemplateImportPicker.files && fieldTemplateImportPicker.files[0];
      fieldTemplateImportPicker.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () { void importFieldTemplateText(String(reader.result || ""), file.name); };
      reader.onerror = function () {
        const opener = ui.state.fieldTemplateImportOpener;
        ui.state.fieldTemplateImportOpener = null;
        ui.state.fieldTemplateFlow = {
          mode: "import",
          step: 1,
          fileName: file.name,
          error: "无法读取字段模板文件。",
          result: null,
          restoreFocus: opener || null,
          restoreFocusDescriptor: fieldTemplateFocusDescriptor("open-field-template-import"),
        };
        render();
        focusFieldTemplateDialog();
      };
      reader.readAsText(file);
    });
  }

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
  appRoot.addEventListener("submit", function (event) {
    const form = event.target instanceof Element ? event.target.closest('[data-form="field-editor"]') : null;
    if (!form) return;
    event.preventDefault();
    void saveFieldEditor();
  });
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
