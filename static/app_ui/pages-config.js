(function (ui) {
  "use strict";
  const c = ui.components;

  function configPage() {
    const counts = ui.state.snapshot.counts;
    return '<div class="hub-page">' +
      '<section class="hub-intro"><span>' + c.icon("tune") + '</span><div><h2>配置状态变化</h2><p>字段本身与自动变化集中在这里。</p></div></section>' +
      '<div class="menu-group" aria-label="配置功能">' +
      c.menuRow("settings", "字段设置", "查看、修改字段与数值上下限", "config-fields", counts.fields + " 个") +
      c.menuRow("schedule", "自然变化", "按时间自动增减字段", "natural-settings") +
      c.menuRow("repeat", "每轮变化", "按对话轮次更新字段", "turn-settings") +
      c.menuRow("account_tree", "状态联动", "字段之间按顺序联动计算", "link-settings") +
      "</div></div>";
  }

  function fieldsPage() {
    const page = ui.state.pages.fields;
    const view = ui.state.listViews.fields;
    return '<div class="fields-page">' +
      '<div class="toolbar"><label class="search-field">' + c.icon("search") + '<input type="search" value="' + ui.escapeHtml(view.search) +
      '" placeholder="搜索字段" aria-label="搜索字段" data-list-search-route="config-fields" /></label>' +
      '<button type="button" class="square-action" data-action="new-field" aria-label="新增字段">' + c.icon("add") + "</button></div>" +
      fieldFilters(view) +
      '<div data-management-region="config-fields">' + c.listMeta(page, "个字段", view.page, 5, ui.state.snapshot.counts.fields, c.listViewFiltered(view)) + (page.items.length
        ? '<div class="management-list">' + page.items.map(fieldManagementCard).join("") + "</div>"
        : c.emptyState("add_circle", "还没有字段", "创建第一个字段后，可在状态页查看数值。",
          '<button type="button" class="button primary" data-action="new-field">新增字段</button>')) +
      c.pagination(page, "config-fields", view.page) + "</div></div>";
  }

  function fieldManagementCard(field) {
    const currentValue = field.currentValue === null ? field.initialValue : field.currentValue;
    const current = field.currentValue === null ? "未绑定" : ui.formatNumber(field.currentValue);
    const binding = field.bindingDisplay;
    const view = { theme: { icon: field.icon, color: field.themeColor } };
    return '<article class="management-card range-card" data-range-card="' + ui.escapeHtml(field.id) + '"><header><div>' + c.stateIcon(view) +
      '<span><strong>' + ui.escapeHtml(field.name) + '</strong><small>' + ui.escapeHtml(c.SCOPE_LABELS[field.scope] || field.scope) + " · " + ui.escapeHtml(binding) +
      '</small></span></div><span class="status-dot ' + (field.enabled ? "enabled" : "") + '">' + (field.enabled ? "已启用" : "已停用") + "</span></header>" +
      '<dl class="management-summary"><div><dt>当前值</dt><dd>' + current + '</dd></div><div><dt>数值范围</dt><dd>' + ui.formatNumber(field.minimum) + "–" + ui.formatNumber(field.maximum) + "</dd></div></dl>" +
      '<div class="range-preview" style="--range-position:' + ((currentValue - field.minimum) / (field.maximum - field.minimum) * 100) +
      '%"><span class="range-preview-track"><i></i></span><output data-range-preview>换算后 ' + ui.formatNumber(currentValue) + '</output></div>' +
      '<div class="range-editor"><label>下限<input type="number" inputmode="decimal" step="any" value="' + field.minimum + '" data-range-number="minimum"></label>' +
      '<span class="range-line" aria-hidden="true"></span><label>上限<input type="number" inputmode="decimal" step="any" value="' + field.maximum + '" data-range-number="maximum"></label></div>' +
      '<p class="range-note">保存后按相对位置同步当前值、阶段与关联规则；步进同步换算为 ' + ui.formatNumber(field.step) + '。</p><div class="card-actions">' +
      '<button type="button" class="button ghost" data-action="open-field" data-field-id="' + ui.escapeHtml(field.id) + '">查看</button>' +
      '<button type="button" class="button secondary" data-action="edit-field" data-field-id="' + ui.escapeHtml(field.id) + '">修改</button>' +
      '<button type="button" class="button primary compact" data-action="save-field-range" data-field-id="' + ui.escapeHtml(field.id) + '" disabled>保存范围</button></div>' +
      '<p class="inline-error" role="alert" data-range-error></p></article>';
  }

  function fieldFilters(view) {
    return '<div class="filter-bar" aria-label="筛选字段">' +
      filterSelect("作用域", "scope", "筛选字段作用域", view.filters.scope, [
        ["", "全部作用域"], ["character", "角色"], ["group", "群组"], ["global", "全局"], ["chat", "会话"],
      ]) + filterSelect("类型", "type", "筛选字段类型", view.filters.type, [
        ["", "全部类型"], ["full", "完整数值"], ["stage_only", "仅阶段"], ["hidden", "隐藏"],
      ]) + filterSelect("状态", "enabled", "筛选启用状态", view.filters.enabled, [
        ["", "全部状态"], ["true", "已启用"], ["false", "已停用"],
      ], "boolean") + "</div>";
  }

  function filterSelect(label, key, ariaLabel, current, options, valueType) {
    const value = current === undefined ? "" : String(current);
    return '<label><span>' + label + '</span><select aria-label="' + ariaLabel + '" data-list-filter-route="config-fields" data-list-filter-key="' +
      key + '"' + (valueType ? ' data-filter-value-type="' + valueType + '"' : "") + '>' + options.map(function (option) {
        return '<option value="' + option[0] + '"' + (value === option[0] ? " selected" : "") + '>' + option[1] + "</option>";
      }).join("") + "</select></label>";
  }

  function fieldEditorPage() {
    const id = ui.state.selectedEntityId;
    const field = id ? ui.state.entities.get("field:" + id) : null;
    return '<form class="editor-page" data-form="field-editor"><section class="editor-section">' +
      c.sectionHeading("基础信息", "名称和说明会显示在状态卡片中") + '<div class="form-card"><label>字段名称<input name="name" value="' +
      ui.escapeHtml(field ? field.name : "") + '" placeholder="例如：亲密度" required></label><label>字段说明<textarea name="description" rows="2" placeholder="简短说明这个数值代表什么">' +
      ui.escapeHtml(field ? field.description : "") + "</textarea></label></div></section>" +
      '<section class="editor-section">' + c.sectionHeading("作用范围", "决定每份数值由谁共享") + '<div class="scope-grid">' + scopeButton("character", field) +
      scopeButton("group", field) + scopeButton("global", field) + scopeButton("chat", field) + "</div>" + bindingPicker(field) +
      (field && field.scope === "chat" ? '<div class="binding-summary"><strong>当前会话</strong><span>' + ui.escapeHtml(ui.state.snapshot.contextLabels.chatName) +
        '</span><details><summary>高级绑定设置</summary><p>仅在创建模板或管理多个会话时调整。</p></details></div>' : "") + "</section>" +
      '<section class="editor-section">' + c.sectionHeading("字段外观", "图标与主题色统一呈现") +
      '<div class="form-card two-column"><label>图标<input name="icon" value="' + ui.escapeHtml(field ? field.icon : "favorite") + '"></label><label>主题色<input name="themeColor" type="color" value="' +
      ui.escapeHtml(field ? field.themeColor : "#7058d8") + '"></label></div></section>' +
      '<section class="editor-section">' + c.sectionHeading("详细配置", "阶段、变化和 AI 设置") + '<div class="config-tile-grid">' +
      detailTile("format_list_numbered", "阶段设置", "阶段名称与阈值") + detailTile("schedule", "自然与每轮变化", "配置自动增减") +
      detailTile("magic_button", "AI 自动更新", "置信度与提示") + detailTile("dashboard_customize", "高级选项", "模型可见性与数据管理") +
      '</div></section><div class="editor-submit"><button type="button" class="button secondary" data-action="go-back">取消</button><button type="submit" class="button primary" disabled>保存字段</button></div></form>';
  }

  function bindingPicker(field) {
    const scope = field ? field.scope : "character";
    if (scope !== "character" && scope !== "group") return "";
    const ids = field ? field.bindingIds : [];
    const actor = scope === "character";
    return '<div class="binding-summary"><strong>' + (actor ? "绑定角色" : "绑定群组") + '</strong><span>' +
      (ids.length ? ids.length + (actor ? " 个角色" : " 个群组") : "尚未选择") + '</span><button type="button" class="text-action" data-action="' +
      (actor ? "open-actor-picker" : "open-group-picker") + '" data-picker-key="field-scope-' + scope + '" data-picker-mode="multiple" data-picker-selected="' +
      ui.escapeHtml(JSON.stringify(ids)) + '">搜索选择</button></div>';
  }

  function scopeButton(scope, field) {
    const selected = field ? field.scope === scope : scope === "character";
    const descriptions = {
      character: "每个角色分别保存数值",
      group: "群组成员共享同一数值",
      global: "所有角色与会话共用",
      chat: "默认绑定正在打开的会话",
    };
    return '<button type="button" class="scope-option ' + (selected ? "active" : "") + '" data-scope="' + scope + '"><strong>' +
      ui.escapeHtml(c.SCOPE_LABELS[scope]) + '</strong><small>' + descriptions[scope] + "</small></button>";
  }

  function detailTile(icon, title, description) {
    return '<button type="button" class="config-tile" disabled><span>' + c.icon(icon) + '</span><span><strong>' + title + '</strong><small>' +
      description + "</small></span>" + c.icon("chevron_right") + "</button>";
  }

  function changeSettingsPage(kind) {
    const tabs = c.segmented([
      { id: "natural", label: "自然变化" },
      { id: "turn", label: "每轮变化" },
      { id: "link", label: "状态联动" },
    ], kind, "data-change-route", "变化方式");
    const copy = kind === "natural"
      ? ["按时间改变字段", "为字段配置时间单位和每次变化量。临时效果会按来源过滤后参与计算。"]
      : kind === "turn"
        ? ["按对话轮次改变字段", "分别选择用户、角色或双方消息；控件与字段卡片保持正常间距。"]
        : ["字段之间自动联动", "联动按后端顺序计算，来源字段与目标字段不能相同。"];
    return '<div class="change-page">' + tabs + '<div id="segment-panel-change-mode" role="tabpanel"><section class="selected-field-panel"><span>' + c.icon(kind === "link" ? "account_tree" : "schedule") +
      '</span><div><strong>' + copy[0] + '</strong><p>' + copy[1] + '</p></div></section>' +
      c.emptyState("search", "选择要配置的字段", "字段较多时使用可搜索选择框，不在页面中一次展开全部字段。",
        '<button type="button" class="button primary" data-action="open-field-picker" data-picker-key="change-' + kind + '-field">选择字段</button>') + "</div></div>";
  }

  Object.assign(ui.pages, {
    config: configPage,
    fields: fieldsPage,
    fieldEditor: fieldEditorPage,
    naturalSettings: function () { return changeSettingsPage("natural"); },
    turnSettings: function () { return changeSettingsPage("turn"); },
    linkSettings: function () { return changeSettingsPage("link"); },
  });
}(window.MvuUi));
