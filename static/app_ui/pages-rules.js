(function (ui) {
  "use strict";
  const c = ui.components;

  function rulesPage() {
    const counts = ui.state.snapshot.counts;
    return '<div class="hub-page">' +
      '<section class="hub-intro"><span>' + c.icon("account_tree") + '</span><div><h2>规则与效果</h2><p>条件负责判断，结果负责改变状态。</p></div></section>' +
      '<div class="menu-group" aria-label="规则功能">' +
      c.menuRow("rule", "规则总体设置", "绑定触发角色、条件和结果", "rule-library", counts.rules + " 条") +
      c.menuRow("schema", "条件设定", "完整条件库与 AI 触发类型", "condition-library", counts.conditions + " 个") +
      c.menuRow("bolt", "效果设定", "以组为单位的多字段临时效果", "effect-library", counts.effectGroups + " 组") +
      "</div></div>";
  }

  function ruleLibraryPage() {
    const page = ui.state.pages.rules;
    return managementPage("规则设置", "每页 5 条，触发条件与结果分开显示", page, "条规则", "rule", function (rule) {
      return '<article class="compact-row"><button type="button" data-open-entity="rule" data-entity-id="' + ui.escapeHtml(rule.id) + '"><span><strong>' +
        ui.escapeHtml(rule.name) + '</strong><small>条件 ' + ui.escapeHtml(rule.conditionId) + " · " + rule.actionCount + " 个结果</small></span>" +
        '<span class="status-dot ' + (rule.enabled ? "enabled" : "") + '">' + (rule.enabled ? "启用" : "停用") + "</span>" + c.icon("chevron_right") + "</button></article>";
    }, "rule-library", "新增规则");
  }

  function conditionLibraryPage() {
    const page = ui.state.pages.conditions;
    return managementPage("条件库", "可复用、可查看引用的触发条件", page, "个条件", "condition", function (condition) {
      return '<article class="compact-row"><button type="button" data-open-entity="condition" data-entity-id="' + ui.escapeHtml(condition.id) + '"><span><strong>' +
        ui.escapeHtml(condition.name) + '</strong><small>' + ui.escapeHtml(condition.description || expressionLabel(condition.rootKind)) + '</small></span><span class="type-chip">' +
        expressionLabel(condition.rootKind) + "</span>" + c.icon("chevron_right") + "</button></article>";
    }, "condition-library", "新增条件");
  }

  function effectLibraryPage() {
    const page = ui.state.pages.effectGroups;
    return managementPage("临时效果", "一个效果组可以影响多个字段", page, "个效果组", "effectGroup", function (effect) {
      return '<article class="compact-row"><button type="button" data-open-entity="effectGroup" data-entity-id="' + ui.escapeHtml(effect.id) + '"><span><strong>' +
        ui.escapeHtml(effect.name) + '</strong><small>' + ui.escapeHtml(effect.description || "未填写说明") + '</small></span><span class="type-chip">' +
        effect.fieldCount + " 个字段</span>" + c.icon("chevron_right") + "</button></article>";
    }, "effect-library", "新增效果组");
  }

  function managementPage(title, description, page, noun, entityType, row, route, addLabel) {
    return '<div class="library-page">' + c.sectionHeading(title, description,
      '<button type="button" class="text-action" data-new-entity="' + entityType + '">' + c.icon("add") + addLabel + "</button>") +
      '<label class="search-field full">' + c.icon("search") + '<input type="search" placeholder="搜索' + title + '" aria-label="搜索' + title + '"></label>' +
      c.listMeta(page, noun) + (page.items.length ? '<div class="compact-list">' + page.items.map(row).join("") + "</div>" :
        c.emptyState("inbox", "还没有" + title, "创建后会显示在这里。")) + c.pagination(page, route, 1) + "</div>";
  }

  function ruleEditorPage() {
    const entity = ui.state.selectedEntityId ? ui.state.entities.get("rule:" + ui.state.selectedEntityId) : null;
    const name = entity ? entity.name : "新自动规则";
    return '<form class="editor-page rule-editor"><section class="editor-section">' + c.sectionHeading("基础信息", "规则名称和说明") +
      '<div class="form-card"><label>规则名称<input value="' + ui.escapeHtml(name) + '"></label><label>描述<textarea rows="2">' +
      ui.escapeHtml(entity ? entity.description : "") + "</textarea></label></div></section>" +
      '<section class="editor-section">' + c.sectionHeading("触发角色", "先筛选角色，再判断条件与 AI") +
      '<button type="button" class="picker-trigger" data-action="open-actor-picker"><span>' + c.icon("person_search") + '</span><span><strong>任意角色</strong><small>可搜索并绑定一个或多个角色</small></span>' + c.icon("chevron_right") + "</button></section>" +
      '<section class="editor-section">' + c.sectionHeading("当……", "满足以下条件时") +
      '<button type="button" class="picker-trigger" data-action="open-condition-picker"><span>' + c.icon("schema") + '</span><span><strong>选择条件</strong><small>从完整条件库复用或新建</small></span>' + c.icon("chevron_right") + "</button></section>" +
      '<section class="editor-section result-section">' + c.sectionHeading("触发后改变的字段内容", "效果是结果，不包含触发条件") +
      '<article class="result-card"><label>状态字段<button type="button" class="field-picker" data-action="open-field-picker">选择目标字段 ' + c.icon("search") +
      '</button></label><label>变化值<input type="number" value="0"></label><div class="effect-import"><strong>应用临时效果</strong><p>显式导入的效果只参与本条字段结果。</p>' +
      '<button type="button" class="picker-trigger compact" data-action="open-effect-picker">' + c.icon("bolt") + '<span>选择一个或多个效果组</span>' + c.icon("add") +
      '</button></div></article><button type="button" class="button secondary full">' + c.icon("add") + "添加字段变化</button></section>" +
      '<div class="editor-submit"><button type="button" class="button secondary" data-action="go-back">取消</button><button type="submit" class="button primary" disabled>保存规则</button></div></form>';
  }

  function conditionEditorPage() {
    const entity = ui.state.selectedEntityId ? ui.state.entities.get("condition:" + ui.state.selectedEntityId) : null;
    return '<form class="editor-page condition-editor"><section class="editor-section">' + c.sectionHeading("基础信息", "条件可被多个规则复用") +
      '<div class="form-card"><label>条件名称<input value="' + ui.escapeHtml(entity ? entity.name : "新条件") + '"></label><label>说明<textarea rows="2">' +
      ui.escapeHtml(entity ? entity.description : "") + "</textarea></label></div></section>" +
      '<section class="editor-section">' + c.sectionHeading("条件结构", "支持 AND、OR 与 NOT 嵌套组合") +
      '<article class="condition-group"><header><strong>全部满足（AND）</strong><button type="button">' + c.icon("more_horiz") + '</button></header><div class="condition-node">' +
      c.icon("psychology") + '<div><strong>AI 语义判断</strong><small>可视化设置类型、要求与最低置信度</small></div></div><label>触发类型<select><option>情绪变化</option><option>行为意图</option><option>关系事件</option><option>场景事件</option><option>自定义类型</option></select></label>' +
      '<label>触发要求<textarea rows="3" placeholder="描述必须观察到的事实"></textarea></label><label>最低置信度<input type="number" min="0" max="1" step="0.05" value="0.75"></label>' +
      '<div class="inline-actions"><button type="button">' + c.icon("add") + '添加条件</button><button type="button">' + c.icon("account_tree") + "添加组合</button></div></article></section>" +
      '<div class="editor-submit"><button type="button" class="button secondary" data-action="go-back">取消</button><button type="submit" class="button primary" disabled>保存条件</button></div></form>';
  }

  function effectEditorPage() {
    const entity = ui.state.selectedEntityId ? ui.state.entities.get("effectGroup:" + ui.state.selectedEntityId) : null;
    const reasonMode = ui.state.effectReasonMode === "custom" ? "custom" : "template";
    return '<form class="editor-page effect-editor"><section class="editor-section">' + c.sectionHeading("基础信息", "临时效果以组为单位复用") +
      '<div class="form-card"><label>效果组名称<input value="' + ui.escapeHtml(entity ? entity.name : "新临时效果") + '"></label><label>说明<textarea rows="2">' +
      ui.escapeHtml(entity ? entity.description : "") + "</textarea></label></div></section>" +
      '<section class="editor-section">' + c.sectionHeading("目标字段", "先按字段设置，再决定字段内哪些角色触发") +
      '<article class="field-effect-card"><button type="button" class="field-picker" data-action="open-field-picker">' + c.icon("search") + "选择目标字段</button>" +
      '<div class="segmented-control static" style="--segments:3"><button type="button" class="active">所有绑定角色</button><button type="button">触发角色</button><button type="button">指定角色</button></div>' +
      '<p class="support-copy">默认一个字段的所有绑定角色都生效；选择“触发角色”时，只影响本次事件中的角色。</p>' +
      '<div class="operation-row"><label>计算方式<select><option>立即增减</option><option>固定修正</option><option>正向倍率</option><option>负向倍率</option><option>通用倍率</option></select></label><label>效果数值<input type="number" value="1"></label></div>' +
      '<button type="button" class="inline-add">' + c.icon("add") + '添加计算方式</button></article><button type="button" class="button secondary full">' + c.icon("add") + "添加目标字段</button></section>" +
      '<section class="editor-section">' + c.sectionHeading("效果原因", "原因会写入变化记录，便于回看") +
      c.segmented([{ id: "template", label: "默认模板" }, { id: "custom", label: "自定义原因" }], reasonMode, "data-reason-mode", "原因模式") +
      '<div id="segment-panel-reason-mode" role="tabpanel">' + (reasonMode === "custom"
        ? '<div class="form-card reason-settings"><label>自定义原因内容<textarea rows="3" placeholder="说明这次字段变化的原因"></textarea></label><label>原因预览<output>自定义原因将写入变化记录</output></label></div>'
        : '<div class="form-card reason-settings"><label>原因模板<select><option>规则触发</option><option>自然变化修正</option><option>每轮变化修正</option><option>AI 更新修正</option><option>手动应用</option></select></label><label>原因预览<output>由规则触发「新临时效果」</output></label></div>') + '</div></section>' +
      '<section class="editor-section">' + c.sectionHeading("持续时间", "按小时、轮次或手动停用") + '<div class="form-card"><label>持续方式<select><option>手动停用</option><option>指定小时</option><option>指定轮次</option></select></label></div></section>' +
      '<div class="editor-submit"><button type="button" class="button secondary" data-action="go-back">取消</button><button type="submit" class="button primary" disabled>保存效果</button></div></form>';
  }

  function expressionLabel(kind) {
    return { and: "全部满足", or: "任一满足", not: "不满足", predicate: "单一条件" }[kind] || "条件";
  }

  Object.assign(ui.pages, {
    rules: rulesPage,
    ruleLibrary: ruleLibraryPage,
    conditionLibrary: conditionLibraryPage,
    effectLibrary: effectLibraryPage,
    ruleEditor: ruleEditorPage,
    conditionEditor: conditionEditorPage,
    effectEditor: effectEditorPage,
  });
}(window.MvuUi));
