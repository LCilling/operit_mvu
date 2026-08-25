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
      '<div class="field-template-actions" aria-label="字段导入与导出"><button type="button" class="button secondary" data-action="open-field-template-import">' +
      c.icon("file_open") + '导入字段</button><button type="button" class="button secondary" data-action="open-field-template-export">' +
      c.icon("ios_share") + "导出字段</button></div>" +
      fieldFilters(view) +
      '<div data-management-region="config-fields">' + c.listMeta(page, "个字段", view.page, 5, ui.state.snapshot.counts.fields, c.listViewFiltered(view)) + (page.items.length
        ? '<div class="management-list">' + page.items.map(fieldManagementCard).join("") + "</div>"
        : c.emptyState("add_circle", "还没有字段", "创建第一个字段后，可在状态页查看数值。",
          '<button type="button" class="button primary" data-action="new-field">新增字段</button>')) +
      c.pagination(page, "config-fields", view.page) + "</div>" + fieldTemplateDialog() + "</div>";
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
    const draft = ui.ensureFieldEditorDraft(field);
    return '<form class="editor-page" data-form="field-editor"><section class="editor-section">' +
      c.sectionHeading("基础信息", "名称和说明会显示在状态卡片中") + '<div class="form-card"><label>字段名称<input name="name" value="' +
      ui.escapeHtml(draft.name) + '" placeholder="例如：亲密度" required></label><label>字段说明<textarea name="description" rows="2" placeholder="简短说明这个数值代表什么">' +
      ui.escapeHtml(draft.description) + '</textarea></label><label class="switch-row"><span><strong>启用字段</strong><small>关闭后保留配置，但不参与状态计算</small></span><input name="enabled" type="checkbox"' +
      (draft.enabled ? " checked" : "") + '></label></div></section>' +
      '<section class="editor-section">' + c.sectionHeading("作用范围", "决定数值属于角色、群组还是当前上下文") + '<div class="scope-grid">' + scopeButton("character", draft) +
      scopeButton("group", draft) + scopeButton("global", draft) + scopeButton("chat", draft) + "</div>" + scopeBinding(draft) + "</section>" +
      '<section class="editor-section">' + c.sectionHeading("字段外观", "图标与主题色统一呈现") +
      '<div class="form-card field-appearance-grid"><label>图标<input name="icon" value="' + ui.escapeHtml(draft.icon) +
      '" autocomplete="off"></label><label>主题色<span class="color-control"><input name="themeColor" type="color" value="' +
      ui.escapeHtml(draft.themeColor) + '"><output>' + ui.escapeHtml(draft.themeColor) + '</output></span></label></div></section>' +
      '<section class="editor-section">' + c.sectionHeading("详细配置", "数值范围、阶段与自动变化集中设置") +
      '<div class="form-card field-numeric-grid"><label>数值下限<input name="minimum" type="number" inputmode="decimal" step="any" value="' + draft.minimum +
      '"></label><label>数值上限<input name="maximum" type="number" inputmode="decimal" step="any" value="' + draft.maximum +
      '"></label><label>变化步长<input name="step" type="number" inputmode="decimal" step="any" value="' + draft.step +
      '"></label><label>初始值<input name="initialValue" type="number" inputmode="decimal" step="any" value="' + draft.initialValue +
      '"></label></div>' + stageEditor(draft) + fieldAutomationEditor(draft) + '</section><p class="inline-error editor-error" role="alert" data-field-editor-error>' +
      ui.escapeHtml(draft.error || "") + '</p><div class="editor-submit"><button type="button" class="button secondary" data-action="go-back">取消</button><button type="submit" class="button primary">保存字段</button></div></form>';
  }

  function scopeBinding(draft) {
    if (draft.scope === "global") {
      return '<div class="scope-note"><strong>全局共享</strong><p>所有角色、群组和会话读取同一份数值，适合世界状态与公共进度。</p></div>';
    }
    if (draft.scope === "chat") return chatBinding(draft);
    const actor = draft.scope === "character";
    const key = "field-scope-" + draft.scope;
    const selected = ui.state.editorSelections[key] || { ids: draft.bindingIds, items: [] };
    const itemById = new Map(selected.items.map(function (item) {
      return [actor ? item.characterId : item.characterGroupId, item];
    }));
    return '<div class="binding-summary field-binding-summary" data-field-binding-summary><span><strong>' + (actor ? "绑定角色" : "绑定群组") +
      '</strong><small>使用搜索选择器查找，不在页面展开完整名单</small></span><button type="button" class="text-action" data-action="' +
      (actor ? "open-actor-picker" : "open-group-picker") + '" data-picker-key="' + key + '" data-picker-mode="multiple" data-picker-selected="' +
      ui.escapeHtml(JSON.stringify(draft.bindingIds)) + '">搜索选择</button><div class="binding-chips">' +
      (draft.bindingIds.length && selected.items.length === 0 && draft.bindingDisplay && draft.bindingDisplay !== "未绑定"
        ? '<span><strong>' + ui.escapeHtml(draft.bindingDisplay) + '</strong><small>' + draft.bindingIds.length + (actor ? " 个角色" : " 个群组") + ' · ' +
          ui.escapeHtml(draft.bindingIds.join("、")) + '</small></span>'
        : draft.bindingIds.length ? draft.bindingIds.map(function (bindingId) {
        const item = itemById.get(bindingId);
        const name = item ? item.name : bindingId;
        return '<span><strong>' + ui.escapeHtml(name) + '</strong><small>' + ui.escapeHtml(bindingId) + '</small></span>';
      }).join("") : '<p>尚未绑定；保存后该字段不会在任何' + (actor ? "角色" : "群组") + '中生效。</p>') + "</div></div>";
  }

  function chatBinding(draft) {
    const context = ui.state.snapshot;
    const chatId = context.activeContext.chatId;
    const chatName = context.contextLabels.chatName;
    return '<div class="binding-summary chat-binding" data-chat-binding><span><strong>当前会话</strong><small>' + ui.escapeHtml(chatName) +
      '</small></span><label class="compact-switch"><input name="bindCurrentChat" type="checkbox"' + (draft.chatAutoBind ? " checked" : "") +
      '><span>立即绑定</span></label><details><summary>高级绑定设置</summary><p>默认绑定正在打开的会话“' + ui.escapeHtml(chatName) +
      '”。关闭“立即绑定”可先创建一个暂不生效的字段模板。</p><small>会话标识 · ' + ui.escapeHtml(chatId || "宿主未提供") + "</small></details></div>";
  }

  function scopeButton(scope, draft) {
    const selected = draft.scope === scope;
    const descriptions = {
      character: "每个角色分别保存数值",
      group: "群组成员共享同一数值",
      global: "所有角色与会话共用",
      chat: "默认绑定正在打开的会话",
    };
    return '<button type="button" class="scope-option ' + (selected ? "active" : "") + '" data-scope="' + scope + '" aria-pressed="' + selected + '"><strong>' +
      ui.escapeHtml(c.SCOPE_LABELS[scope]) + '</strong><small>' + descriptions[scope] + "</small></button>";
  }

  function stageEditor(draft) {
    return '<div class="subsection-heading"><span><strong>阶段</strong><small>首个阶段阈值需等于数值下限</small></span><button type="button" class="text-action" data-action="add-field-stage">' +
      c.icon("add") + '添加阶段</button></div><div class="stage-editor-list">' + draft.stages.map(function (stage, index) {
        return '<article class="stage-editor-row" data-stage-index="' + index + '"><span class="stage-index">' + (index + 1) +
          '</span><label>阶段名称<input data-stage-name="' + index + '" value="' + ui.escapeHtml(stage.name) + '"></label><label>起始值<input type="number" inputmode="decimal" step="any" data-stage-threshold="' + index + '" value="' + stage.threshold +
          '"></label><label class="stage-description">说明<input data-stage-description="' + index + '" value="' + ui.escapeHtml(stage.description) +
          '" placeholder="可选"></label><button type="button" class="icon-button stage-remove" data-action="remove-field-stage" data-stage-index="' + index + '" aria-label="删除阶段"' +
          (draft.stages.length === 1 ? " disabled" : "") + '>' + c.icon("delete") + "</button></article>";
      }).join("") + "</div>";
  }

  function fieldAutomationEditor(draft) {
    return '<div class="field-config-panels"><details><summary><span>' + c.icon("visibility") + '</span><span><strong>模型可见性</strong><small>控制 AI 可读取的字段信息</small></span></summary><label>可见内容<select name="modelVisibility">' +
      option("full", "完整数值", draft.modelVisibility) + option("stage_only", "仅阶段", draft.modelVisibility) + option("hidden", "不提供给模型", draft.modelVisibility) +
      '</select></label></details><details><summary><span>' + c.icon("schedule") + '</span><span><strong>自然变化</strong><small>按时间自动增减</small></span></summary><label class="switch-row"><span>启用自然变化</span><input name="naturalEnabled" type="checkbox"' +
      (draft.naturalChange.enabled ? " checked" : "") + '></label><div class="two-field-grid"><label>间隔（毫秒）<input name="naturalUnitMs" type="number" value="' + draft.naturalChange.unitMs +
      '"></label><label>每次变化<input name="naturalAmount" type="number" step="any" value="' + draft.naturalChange.amount +
      '"></label></div></details><details><summary><span>' + c.icon("repeat") + '</span><span><strong>每轮变化</strong><small>按对话轮次更新</small></span></summary><label class="switch-row"><span>启用每轮变化</span><input name="turnEnabled" type="checkbox"' +
      (draft.perTurnChange.enabled ? " checked" : "") + '></label><div class="two-field-grid"><label>间隔轮次<input name="turnInterval" type="number" value="' + draft.perTurnChange.intervalTurns +
      '"></label><label>每次变化<input name="turnAmount" type="number" step="any" value="' + draft.perTurnChange.amount +
      '"></label></div><label>计数消息<select name="turnCountMode">' + option("both", "双方消息", draft.perTurnChange.countMode) + option("user", "仅用户", draft.perTurnChange.countMode) +
      option("character", "仅角色", draft.perTurnChange.countMode) + '</select></label></details><details><summary><span>' + c.icon("magic_button") +
      '</span><span><strong>AI 自动更新</strong><small>置信度、单次幅度与提示</small></span></summary><label class="switch-row"><span>启用 AI 更新</span><input name="aiEnabled" type="checkbox"' +
      (draft.ai.enabled ? " checked" : "") + '></label><div class="two-field-grid"><label>最低置信度<input name="aiMinConfidence" type="number" min="0" max="1" step="0.05" value="' + draft.ai.minConfidence +
      '"></label><label>单次最大变化<input name="aiMaxDelta" type="number" min="0" step="any" value="' + draft.ai.maxDelta +
      '"></label></div><label>判断提示<textarea name="aiPrompt" rows="2">' + ui.escapeHtml(draft.ai.prompt) + "</textarea></label></details></div>";
  }

  function option(value, label, selected) {
    return '<option value="' + value + '"' + (value === selected ? " selected" : "") + '>' + label + "</option>";
  }

  function fieldTemplateDialog() {
    const flow = ui.state.fieldTemplateFlow;
    if (!flow) return "";
    const title = flow.mode === "export" ? "导出字段" : "导入字段";
    return '<div class="field-template-layer" data-action="close-field-template-flow"><section class="field-template-dialog" role="dialog" aria-modal="true" aria-label="' +
      title + '" data-stop-close><header><span><strong>' + title + '</strong><small>' +
      (flow.mode === "export" ? "生成可迁移的字段配置" : "预览后再决定冲突与绑定") +
      '</small></span><button type="button" class="icon-button" data-action="close-field-template-flow" aria-label="关闭">' + c.icon("close") +
      '</button></header>' + (flow.mode === "export" ? exportTemplateFlow(flow) : importTemplateFlow(flow)) +
      '<p class="inline-error template-error" role="alert" data-field-template-error>' + ui.escapeHtml(flow.error || "") + "</p>" +
      (flow.mode === "import" && flow.staleRevision
        ? '<div class="template-recovery"><button type="button" class="button secondary" data-action="refresh-field-template-preview"' +
          (flow.refreshing ? " disabled" : "") + '>' + c.icon("refresh") + '重新预览当前文件</button><small>刷新 revision，并保留仍适用的冲突策略与角色/群组映射；不兼容项会恢复为安全默认值。</small></div>'
        : "") + "</section></div>";
  }

  function exportTemplateFlow(flow) {
    if (flow.result) {
      return '<div class="template-result" data-template-export-result><span>' + c.icon("task_alt") + '</span><h3>字段模板已导出</h3><p>' +
        ui.escapeHtml(flow.result.summary.fieldCount) + ' 个字段，' + ui.escapeHtml(flow.result.summary.targetCount) + ' 个目标，携带 ' +
        ui.escapeHtml(flow.result.summary.valueCount) + ' 份当前值。</p><small>' + ui.escapeHtml(flow.result.savedPath || flow.result.fileName) +
        '</small><button type="button" class="button primary" data-action="close-field-template-flow">返回字段列表</button></div>';
    }
    const fields = flow.selectedFields || [];
    return '<div class="template-flow-body"><section class="template-callout"><span>' + c.icon("info") +
      '</span><p>字段定义（含初始值）始终包含；勾选目标会携带“启用”建议，可另选当前值建议，未勾选目标不会写入模板。导入端仍需重新确认本地映射，不会按源 ID 静默覆盖。</p></section><button type="button" class="picker-trigger compact" data-action="choose-template-export-fields" data-picker-key="template-export-fields" data-picker-mode="multiple">' +
      '<span>' + c.icon("search") + '</span><span><strong>搜索选择字段</strong><small>' + (fields.length ? "已选择 " + fields.length + " 个" : "支持名称与 ID 查找") +
      '</small></span>' + c.icon("chevron_right") + '</button><div class="template-field-list">' +
      (fields.length ? fields.map(function (field) { return exportFieldCard(flow, field); }).join("") : '<p class="template-empty">尚未选择字段。</p>') +
      '</div></div><footer><button type="button" class="button secondary" data-action="close-field-template-flow">取消</button><button type="button" class="button primary" data-action="commit-field-template-export"' +
      (fields.length ? "" : " disabled") + '>导出所选字段</button></footer>';
  }

  function exportFieldCard(flow, field) {
    const scoped = field.scope === "character" || field.scope === "group";
    const targets = (flow.exportTargets && flow.exportTargets[field.id]) || [];
    const targetLabel = field.scope === "group" ? "群组" : "角色";
    return '<article class="template-field-card" data-template-export-field="' + ui.escapeHtml(field.id) + '"><header><span class="field-color-dot" style="--field-color:' +
      ui.escapeHtml(field.themeColor) + '"></span><span><strong>' + ui.escapeHtml(field.name) + '</strong><small>' + ui.escapeHtml(c.SCOPE_LABELS[field.scope] || field.scope) +
      ' · ' + ui.escapeHtml(field.id) + '</small></span><span class="included-badge">定义 / 配置已包含</span></header>' +
      (scoped ? '<button type="button" class="text-action matrix-picker" data-action="choose-template-export-targets" data-template-field-id="' + ui.escapeHtml(field.id) +
        '" data-template-target-entity="' + (field.scope === "group" ? "groups" : "actors") + '">' + c.icon("person_search") + '搜索选择' + targetLabel +
        '</button><div class="target-matrix">' + (targets.length ? targets.map(function (target) { return exportTargetRow(field, target); }).join("") :
          '<p>未选择' + targetLabel + '；此字段将作为未绑定模板导出。</p>') + "</div>" : field.scope === "global"
        ? '<p class="template-scope-copy">全局字段共享一份配置，不显示角色开关，也不携带角色私有值。</p>'
        : '<details class="template-chat-copy"><summary>当前会话导出说明</summary><p>导出字段定义，不导出会话 UUID；导入时默认绑定接收端正在打开的会话。</p></details>') + "</article>";
  }

  function exportTargetRow(field, target) {
    return '<article class="matrix-row" data-template-export-target-id="' + ui.escapeHtml(target.targetId) + '" data-template-field-id="' + ui.escapeHtml(field.id) +
      '"><span><strong>' + ui.escapeHtml(target.name) + '</strong><small>' + ui.escapeHtml(target.targetId) +
      '</small></span><label><input type="checkbox" data-export-target-enabled' + (target.enabled ? " checked" : "") + '>启用 / 包含配置</label><label><input type="checkbox" data-export-include-value' +
      (target.includeValue ? " checked" : "") + (target.enabled ? "" : " disabled") + '>携带当前值</label></article>';
  }

  function importTemplateFlow(flow) {
    if (flow.result) return importResult(flow);
    if (!flow.preview) {
      return '<div class="template-flow-body"><section class="template-callout"><span>' + c.icon(flow.error ? "error" : "progress_activity") +
        '</span><p><strong>' + ui.escapeHtml(flow.fileName || "字段模板") + '</strong><br>' +
        (flow.error ? "文件尚未通过检查，可关闭后重新选择。" : "正在验证格式、冲突和映射信息…") +
        '</p></section></div><footer><button type="button" class="button secondary" data-action="close-field-template-flow">关闭</button></footer>';
    }
    const step = flow.step || 1;
    return '<div class="template-flow-body"><div class="template-steps" aria-label="导入步骤">' +
      templateStep(1, "内容", step) + templateStep(2, "冲突", step) + templateStep(3, "映射", step) + '</div><div class="template-step" data-step="' + step + '">' +
      (step === 1 ? importContentStep(flow) : step === 2 ? importConflictStep(flow) : importMappingStep(flow)) +
      '</div></div><footer><button type="button" class="button secondary" data-action="' + (step === 1 ? "close-field-template-flow" : "previous-field-template-import") + '">' +
      (step === 1 ? "取消" : "上一步") + '</button><button type="button" class="button primary" data-action="' + (step < 3 ? "next-field-template-import" : "commit-field-template-import") +
      '">' + (step < 3 ? "下一步" : "确认导入") + "</button></footer>";
  }

  function templateStep(index, label, current) {
    return '<span class="' + (index === current ? "active" : index < current ? "done" : "") + '"><i>' + index + '</i>' + label + "</span>";
  }

  function importContentStep(flow) {
    const preview = flow.preview;
    const dependencyTotal = preview.omittedDependencies.reduce(function (sum, item) { return sum + item.totalCount; }, 0);
    return '<section data-template-import-step="content"><div class="template-callout"><span>' + c.icon("description") + '</span><p><strong>' +
      ui.escapeHtml(flow.fileName || "字段模板") + '</strong><br>' + preview.fields.length + ' 个字段 · 模板版本 ' + preview.schemaVersion +
      '</p></div><div class="preview-field-list">' + preview.fields.map(function (field) {
        return '<article><span><strong>' + ui.escapeHtml(field.name) + '</strong><small>' + ui.escapeHtml(c.SCOPE_LABELS[field.scope]) + ' · ' +
          ui.escapeHtml(field.sourceFieldId) + '</small></span><span>' + field.config.stages + ' 个阶段</span></article>';
      }).join("") + '</div><details class="dependency-preview"' + (dependencyTotal ? " open" : "") + '><summary>未随字段导入的依赖 · ' + dependencyTotal +
      '</summary>' + (dependencyTotal ? preview.omittedDependencies.map(renderDependencyGroup).join("") : '<p>没有检测到规则、条件、联动或效果依赖。</p>') +
      '</details>' + repairCategoryList(flow) + '</section>';
  }

  function repairCategoryList(flow) {
    const categories = flow.repairCategories || [];
    if (!categories.length) return '<div class="repair-categories clear" data-repair-categories><strong>需修复项</strong><span>无</span></div>';
    return '<div class="repair-categories" data-repair-categories><strong>需修复类别 · ' + flow.repairCount + '</strong><ul>' + categories.map(function (category) {
      return '<li><span>' + ui.escapeHtml(category.label) + '</span><b>' + category.count + '</b></li>';
    }).join("") + "</ul></div>";
  }

  function renderDependencyGroup(group) {
    return '<div><strong>' + ui.escapeHtml(group.fieldId) + '</strong><ul>' + group.items.map(function (item) {
      return '<li>' + ui.escapeHtml(item.readableName) + '<small>' + ui.escapeHtml(item.kind) + ' · ' + ui.escapeHtml(item.sourceId) + '</small></li>';
    }).join("") + '</ul>' + (group.truncated ? '<p>另有 ' + (group.totalCount - group.items.length) + ' 项未展开。</p>' : "") + "</div>";
  }

  function importConflictStep(flow) {
    return '<section data-template-import-step="conflict"><p class="step-copy">默认创建副本，避免覆盖本地配置。只有确认需要同步时再选择更新或替换。</p><div class="conflict-list">' +
      flow.preview.fields.map(function (field) {
        const strategy = flow.strategies[field.sourceFieldId] || "create_copy";
        const hasConflict = field.conflict === "id";
        return '<article><span><strong>' + ui.escapeHtml(field.name) + '</strong><small>' + (hasConflict ? "存在同 ID 字段" : "没有同 ID 字段") +
          ' · 副本 ' + ui.escapeHtml(field.proposedCopyId) + '</small></span><label>处理方式<select data-import-strategy="' + ui.escapeHtml(field.sourceFieldId) + '">' +
          option("create_copy", "创建副本", strategy) + (hasConflict && field.updateCompatibility.available ? option("update", "更新配置（保留本地绑定和值）", strategy) : "") +
          (hasConflict ? option("replace", "替换字段（按新映射绑定）", strategy) : "") + '</select></label>' +
          (!field.updateCompatibility.available && field.updateCompatibility.reason === "scope_mismatch" ? '<p class="warning-copy">本地作用域不同，不能使用“更新配置”。</p>' : "") +
          "</article>";
      }).join("") + "</div></section>";
  }

  function importMappingStep(flow) {
    const needs = flow.preview.mappingNeeds;
    return '<section data-template-import-step="mapping"><p class="step-copy">先按字段确认本地目标；每个目标都能单独决定是否启用和如何处理数值。</p><div class="mapping-list">' +
      (needs.length ? needs.map(function (need) { return importMappingField(flow, need); }).join("") : '<div class="template-callout"><span>' + c.icon("task_alt") +
        '</span><p>全局或会话字段无需角色映射；会话字段将在接收端绑定当前会话。</p></div>') + "</div></section>";
  }

  function importMappingField(flow, need) {
    const sources = need.requiresLocalTargets ? [{ sourceId: "__unbound__", name: "本地目标", hasValue: false, requiresSearch: true }] : need.sourceTargets;
    return '<article class="mapping-field"><header><span><strong>' + ui.escapeHtml(flow.preview.fields.find(function (field) { return field.sourceFieldId === need.fieldId; })?.name || need.fieldId) +
      '</strong><small>' + (need.scope === "group" ? "群组映射" : "角色映射") + '</small></span><div class="mapping-batch" data-import-field-batch>' +
      batchEnableButton(need.fieldId, "all_on", "全部启用") + batchEnableButton(need.fieldId, "all_off", "全部停用") +
      batchEnableButton(need.fieldId, "file_suggestion", "采用文件建议") + '</div></header>' + sources.map(function (source) {
        const key = need.fieldId + "\u0000" + source.sourceId;
        const targets = flow.importMappings[key] || [];
        return '<section class="source-mapping" data-import-source-id="' + ui.escapeHtml(source.sourceId) + '"><div><span><strong>' + ui.escapeHtml(source.name) +
          '</strong><small>' + (source.sourceId === "__unbound__" ? "模板未携带源目标" : ui.escapeHtml(source.sourceId)) + '</small></span><button type="button" class="text-action" data-action="choose-template-import-targets" data-template-field-id="' +
          ui.escapeHtml(need.fieldId) + '" data-template-source-id="' + ui.escapeHtml(source.sourceId) + '" data-template-target-entity="' +
          (need.scope === "group" ? "groups" : "actors") + '">' + c.icon("person_search") + '搜索映射</button></div>' +
          (source.valueAdjustment ? '<p class="adjustment-note">导入值将因' + (source.valueAdjustment.reason === "clamp" ? "范围" : "步长") + '从 ' +
            ui.escapeHtml(source.valueAdjustment.from) + ' 调整为 ' + ui.escapeHtml(source.valueAdjustment.to) + "。</p>" : "") +
          '<div class="mapped-targets">' + (targets.length ? targets.map(function (target) { return importTargetRow(need, source, target); }).join("") :
            '<p>尚未选择本地目标。</p>') + "</div></section>";
      }).join("") + "</article>";
  }

  function batchEnableButton(fieldId, mode, label) {
    return '<button type="button" class="batch-choice" data-action="set-import-field-enabled" data-template-field-id="' + ui.escapeHtml(fieldId) +
      '" data-import-batch-mode="' + mode + '">' + label + "</button>";
  }

  function importTargetRow(need, source, target) {
    return '<article class="matrix-row" data-template-import-target-id="' + ui.escapeHtml(target.targetId) + '" data-template-field-id="' + ui.escapeHtml(need.fieldId) +
      '" data-template-source-id="' + ui.escapeHtml(source.sourceId) + '"><span><strong>' + ui.escapeHtml(target.name) + '</strong><small>' + ui.escapeHtml(target.targetId) +
      '</small></span><label><input type="checkbox" data-import-target-enabled' + (target.enabled ? " checked" : "") + '>启用字段</label><label>数值<select data-import-value-policy>' +
      (source.hasValue ? option("template_value", "使用导入值", target.valuePolicy) : "") + option("keep_existing", "保留本地值", target.valuePolicy) +
      option("field_initial", "使用字段默认值", target.valuePolicy) + "</select></label></article>";
  }

  function importResult(flow) {
    const summary = flow.result.summary;
    return '<div class="template-result" data-template-import-result><span>' + c.icon("task_alt") + '</span><h3>字段导入完成</h3><p>已创建 ' + summary.created.length +
      ' · 已更新 ' + summary.updated.length + ' · 已替换 ' + summary.replaced.length + ' · 跳过 ' + summary.skippedTargets + ' · 写入数值 ' + summary.valueWrites +
      ' · 需修复 ' + flow.repairCount + '</p>' + repairCategoryList(flow) + (flow.repairCount ? '<small>模板仅导入字段；请按以上类别到规则配置中检查引用。</small>' :
        '<small>没有检测到需要手动修复的引用。</small>') + '<button type="button" class="button primary" data-action="finish-field-template-import">返回字段列表</button></div>';
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
