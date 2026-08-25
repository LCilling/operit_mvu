(function (ui) {
  "use strict";
  const c = ui.components;

  function statusPage() {
    const snapshot = ui.state.snapshot;
    const groupMode = ui.state.statusMode === "group" && snapshot.activeContext.groupId !== null;
    const hasGroupContext = snapshot.activeContext.groupId !== null || snapshot.counts.groups > 0;
    const modeControl = hasGroupContext ? c.segmented([
      { id: "character", label: "角色状态" },
      { id: "group", label: "群组状态" },
    ], groupMode ? "group" : "character", "data-status-mode", "状态范围") : "";
    const renderGroupSelector = c.groupSelector;
    const renderActorSelector = c.actorSelector;
    const identitySelector = groupMode
      ? renderGroupSelector(ui.state.directory.groups, snapshot.activeContext.groupId)
      : renderActorSelector(ui.state.directory.actors, snapshot.activeContext.actorId);
    const selected = groupMode ? snapshot.selected.group : snapshot.selected.actor;
    const identityName = selected && selected.name ? selected.name :
      groupMode ? (snapshot.contextLabels.groupName || "群组状态") : (snapshot.activeContext.actorName || "当前角色");
    const fields = snapshot.pages.fields.items.filter(function (field) { return field.enabled; });
    const fieldsMarkup = fields.length
      ? '<div class="status-field-list">' + fields.map(function (field) { return c.fieldCard(field); }).join("") + "</div>"
      : c.emptyState("favorite", "当前没有可显示状态", "请前往配置创建字段，并为当前上下文启用。",
        '<button type="button" class="button primary" data-route="config-fields">新增字段</button>');
    return '<div class="status-page">' + modeControl + identitySelector +
      '<section class="context-hero"><span class="context-avatar">' + c.icon(groupMode ? "groups" : "person") + '</span><div><p>' +
      (groupMode ? "群组状态" : "角色状态") + '</p><h2>' + ui.escapeHtml(identityName) + '</h2><span>' +
      ui.escapeHtml(snapshot.contextLabels.chatName) + "</span></div>" +
      '<button type="button" class="text-action" data-route="records">查看记录</button></section>' +
      c.sectionHeading("当前状态", fields.length + " 个字段", '<span class="count-badge">' + snapshot.counts.fields + "</span>") +
      fieldsMarkup + "</div>";
  }

  function fieldDetailPage() {
    const fieldId = ui.state.selectedFieldId;
    const field = ui.state.entities.get("field:" + fieldId);
    const summary = ui.state.snapshot.pages.fields.items.find(function (item) { return item.id === fieldId; });
    if (!field || !summary) {
      return c.emptyState("search_off", "字段暂不可用", "该字段不在当前上下文的首屏状态中，请返回后重新选择。",
        '<button type="button" class="button secondary" data-action="go-back">返回状态</button>');
    }
    const currentValue = summary.current ? summary.current.value : field.initialValue;
    const records = ui.state.snapshot.pages.records.items.filter(function (record) { return record.fieldId === field.id; });
    const colors = c.stagePalette(field);
    const model = c.trendModel({
      minimum: field.minimum,
      maximum: field.maximum,
      thresholds: field.stages.map(function (stage) { return stage.threshold; }),
      colors: colors,
      stages: field.stages,
      themeColor: field.themeColor,
    }, records.length ? records : [{ after: currentValue, occurredAt: Date.now() }], colors);
    const currentStage = currentStageFor(field, currentValue);
    return '<div class="field-detail-stack">' +
      '<article class="detail-card value-card" style="--field-color:' + c.safeColor(field.themeColor) + '"><div class="detail-title">' +
      '<span class="state-icon large" style="--field-color:' + c.safeColor(field.themeColor) + '">' + c.icon(field.icon) + '</span><div><h2>' +
      ui.escapeHtml(field.name) + '</h2><p>范围 ' + ui.formatNumber(field.minimum) + " – " + ui.formatNumber(field.maximum) + "</p></div></div>" +
      '<div class="current-value"><strong>' + ui.formatNumber(currentValue) + '</strong><span>' + ui.escapeHtml(currentStage ? currentStage.name : "未设置阶段") +
      '</span></div><div class="value-track"><span style="width:' + position(currentValue, field.minimum, field.maximum) + '%"></span></div></article>' +
      c.stageStrip(field, currentValue, colors) + c.trendCard(model, "field-" + field.id) +
      '<article class="detail-card following-card"><div class="card-heading"><strong>最近变化</strong><button type="button" data-route="records">全部记录</button></div>' +
      (records.length ? '<div class="record-list compact">' + records.slice(0, 3).map(c.recordRow).join("") + "</div>" : '<p class="card-empty">还没有变化记录。</p>') + "</article>" +
      '<article class="detail-card following-card"><div class="card-heading"><strong>状态说明</strong><span>' + ui.escapeHtml(currentStage ? currentStage.name : "当前") +
      '</span></div><p class="status-description">' + ui.escapeHtml(currentStage && currentStage.description ? currentStage.description : field.description || "此字段尚未填写说明。") +
      "</p></article></div>";
  }

  function recordsPage() {
    const page = ui.state.pages.records;
    return '<div class="records-page">' + c.sectionHeading("变化记录", "每页 10 条，按最新变化排列") +
      c.listMeta(page, "条") + (page.items.length
        ? '<div class="record-list">' + page.items.map(c.recordRow).join("") + "</div>"
        : c.emptyState("history", "还没有变化记录", "字段发生变化后，会在这里显示原因和时间。")) +
      c.pagination(page, "records", 1) + "</div>";
  }

  function currentStageFor(field, value) {
    return field.stages.slice().sort(function (a, b) { return a.threshold - b.threshold; }).reduce(function (selected, stage) {
      return value >= stage.threshold ? stage : selected;
    }, null);
  }

  function position(value, minimum, maximum) {
    return Math.max(0, Math.min(100, (value - minimum) / (maximum - minimum) * 100));
  }

  Object.assign(ui.pages, { status: statusPage, fieldDetail: fieldDetailPage, records: recordsPage });
}(window.MvuUi));
