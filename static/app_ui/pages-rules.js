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
    const view = ui.state.listViews.rules;
    return managementPage("规则设置", "每页 5 条，触发条件与结果分开显示", page, "条规则", "rule", function (rule) {
      const labels = ui.state.ruleLabels.get(rule.id) || { actor: "绑定信息读取中", condition: "条件读取中", actions: rule.actions.length + " 个结果" };
      return '<article class="compact-row management-rule-row"><header><strong>' + ui.escapeHtml(rule.name) + '</strong><span class="status-dot ' +
        (rule.enabled ? "enabled" : "") + '">' + (rule.enabled ? "已启用" : "已停用") + '</span></header><dl class="rule-summary"><div><dt>触发角色</dt><dd>' +
        ui.escapeHtml(labels.actor) + '</dd></div><div><dt>触发条件</dt><dd>' + ui.escapeHtml(labels.condition) + '</dd></div><div><dt>触发结果</dt><dd>' +
        ui.escapeHtml(labels.actions) + '</dd></div></dl><div class="row-actions"><button type="button" class="button ghost" data-open-entity="rule" data-entity-id="' +
        ui.escapeHtml(rule.id) + '">查看</button><button type="button" class="button secondary" data-open-entity="rule" data-entity-id="' +
        ui.escapeHtml(rule.id) + '">修改</button></div></article>';
    }, "rule-library", "新增规则", view, 5);
  }

  function conditionLibraryPage() {
    const page = ui.state.pages.conditions;
    const view = ui.state.listViews.conditions;
    const start = page.loadedCount ? (view.page - 1) * 10 + 1 : 0;
    const end = page.loadedCount ? start + page.loadedCount - 1 : 0;
    const allCount = ui.state.snapshot.counts.conditions;
    const meta = '<p class="list-meta" aria-live="polite">显示 ' + start + "–" + end + " / " +
      (c.listViewFiltered(view) ? "匹配 " + page.totalCount + " / " : "") + "共 " + allCount + " 个条件</p>";
    const rows = page.items.length ? '<div class="compact-list condition-list">' + page.items.map(conditionRow).join("") + "</div>" :
      c.emptyState("inbox", "还没有条件库", "创建后会显示在这里。");
    const recovery = ui.state.conditionListRecovery;
    const staleRecovery = recovery && (recovery.kind === "stale" || recovery.kind === "stale-delete");
    const recoveryPanel = recovery ? '<section class="condition-list-recovery" data-condition-list-recovery role="alert"><span>' + c.icon("sync_problem") +
      '</span><div><strong>' + (recovery.kind === "stale-delete" ? "删除前数据已变化" : staleRecovery ? "检测到修订冲突" : "条件操作已经提交") + '</strong><p>' + ui.escapeHtml(recovery.error || "列表刷新失败，请重新载入权威数据。") +
      '</p></div><button type="button" class="button secondary" data-action="reload-condition-library"' + (recovery.loading ? " disabled" : "") +
      '>' + (recovery.loading ? "正在载入" : recovery.kind === "stale-delete" ? "重新载入 / 重新检查" : staleRecovery ? "重新核对列表" : "只重新载入") + "</button></section>" : "";
    return '<div class="library-page">' + c.sectionHeading("条件库", "可复用、可查看引用的触发条件",
      '<button type="button" class="text-action" data-new-entity="condition">' + c.icon("add") + "新增条件</button>") +
      '<label class="search-field full">' + c.icon("search") + '<input type="search" value="' + ui.escapeHtml(view.search) +
      '" placeholder="搜索条件库" aria-label="搜索条件库" data-list-search-route="condition-library"></label>' +
      recoveryPanel + '<div data-management-region="condition-library">' + meta + rows + c.pagination(page, "condition-library", view.page) + "</div>" +
      renderConditionReferenceDialog() + "</div>";
  }

  function conditionRow(condition) {
    const meta = ui.state.conditionMeta.get(condition.id) || {};
    const expression = meta.expression || condition.expression;
    const summary = expression ? expressionSummary(expression) : expressionLabel(condition.rootKind);
    const referenceText = meta.error ? "引用读取失败" : Number.isSafeInteger(meta.referenceCount)
      ? (meta.referenceCount ? "被 " + meta.referenceCount + " 条规则引用" : "未引用") : "引用读取中";
    const mutationDisabled = ui.state.conditionListRecovery ? " disabled" : "";
    return '<article class="condition-library-row" data-condition-row="' + ui.escapeHtml(condition.id) + '">' +
      '<button type="button" class="condition-row-main" data-open-entity="condition" data-entity-id="' + ui.escapeHtml(condition.id) + '">' +
      '<span class="condition-row-copy"><span><strong>' + ui.escapeHtml(condition.name) + '</strong><em class="status-dot ' +
      (condition.enabled ? "enabled" : "") + '">' + (condition.enabled ? "已启用" : "已停用") + '</em></span><small data-condition-expression-summary>' +
      ui.escapeHtml(summary) + '</small><small class="condition-reference-status">' + ui.escapeHtml(referenceText) + "</small></span>" +
      '<span class="condition-open-copy">查看 / 编辑</span>' + c.icon("chevron_right") + "</button>" +
      '<div class="condition-row-actions"><button type="button" class="condition-toggle" data-action="toggle-condition" data-condition-id="' +
      ui.escapeHtml(condition.id) + '" data-condition-enabled="' + String(condition.enabled) + '" aria-label="' +
      (condition.enabled ? "停用" : "启用") + ui.escapeHtml(condition.name) + '" aria-pressed="' + String(condition.enabled) + '"' + mutationDisabled + '>' +
      c.icon(condition.enabled ? "toggle_on" : "toggle_off") + '<span>' + (condition.enabled ? "已启用" : "已停用") + "</span></button>" +
      '<details class="condition-more" data-condition-more><summary aria-label="更多条件操作">' + c.icon("more_horiz") +
      '</summary><div><button type="button" data-open-entity="condition" data-entity-id="' + ui.escapeHtml(condition.id) + '">编辑</button>' +
      '<button type="button" data-action="copy-condition" data-condition-id="' + ui.escapeHtml(condition.id) + '"' + mutationDisabled + '>复制</button>' +
      '<button type="button" class="danger-text" data-action="delete-condition" data-condition-id="' + ui.escapeHtml(condition.id) +
      '"' + mutationDisabled + '>删除</button></div></details></div></article>';
  }

  function renderConditionReferenceDialog() {
    const dialog = ui.state.conditionDeleteDialog;
    if (!dialog) return "";
    const loading = dialog.loading ? '<p class="dialog-status" role="status">正在检查规则引用…</p>' : "";
    const error = dialog.error ? '<p class="inline-error" role="alert">' + ui.escapeHtml(dialog.error) + "</p>" : "";
    const references = dialog.references || [];
    const search = String(dialog.search || "").trim().toLocaleLowerCase();
    const visibleReferences = search ? references.filter(function (reference) {
      return (reference.name + " " + reference.id).toLocaleLowerCase().includes(search);
    }) : references;
    const list = visibleReferences.length ? '<ul class="condition-reference-list">' + visibleReferences.map(function (reference) {
      return '<li><strong>' + ui.escapeHtml(reference.name) + '</strong><small>' + ui.escapeHtml(reference.id) + "</small></li>";
    }).join("") + "</ul>" : search ? '<p class="dialog-status">本页没有匹配的规则</p>' : "";
    const page = Number.isSafeInteger(dialog.page) ? dialog.page : 1;
    const totalCount = Number.isSafeInteger(dialog.totalCount) ? dialog.totalCount : 0;
    const start = references.length ? (page - 1) * 10 + 1 : 0;
    const end = references.length ? start + references.length - 1 : 0;
    const directory = totalCount > 10 ? '<div class="condition-reference-tools"><label class="search-field full">' + c.icon("search") +
      '<input type="search" value="' + ui.escapeHtml(dialog.search || "") + '" placeholder="搜索本页受影响规则" aria-label="搜索本页受影响规则" data-condition-reference-search></label>' +
      '<p class="list-meta" data-condition-reference-meta>显示 ' + start + "–" + end + " / 共 " + totalCount + " 条</p></div>" : "";
    const paging = totalCount > 10 ? '<nav class="condition-reference-paging" aria-label="受影响规则分页"><button type="button" class="button secondary" data-action="page-condition-references" data-reference-page="previous" data-reference-page-number="' +
      (page - 1) + '" ' + (page <= 1 || dialog.loading ? "disabled" : "") + '>上一页</button><span>第 ' + page + " / " + Math.max(1, Math.ceil(totalCount / 10)) +
      ' 页</span><button type="button" class="button secondary" data-action="page-condition-references" data-reference-page="next" data-reference-page-number="' +
      (page + 1) + '" ' + (!dialog.hasMore || dialog.loading ? "disabled" : "") + ">下一页</button></nav>" : "";
    const guidance = !dialog.loading && !dialog.error && totalCount > 0
      ? '<p class="reference-guidance">此条件仍被规则使用。请先替换条件或停用相关规则，再返回删除。</p>'
      : !dialog.loading && !dialog.error
        ? '<p class="reference-guidance">没有规则引用。删除后无法恢复，请明确确认。</p>' : "";
    return '<div class="condition-dialog-layer" data-action="close-condition-dialog"><section class="condition-reference-dialog" role="dialog" aria-modal="true" aria-labelledby="condition-reference-title" data-stop-close>' +
      '<header><div><h2 id="condition-reference-title">删除「' + ui.escapeHtml(dialog.name) + '」</h2><p>删除前检查受影响的规则</p></div>' +
      '<button type="button" class="icon-button" data-action="close-condition-dialog" aria-label="关闭">' + c.icon("close") + "</button></header>" +
      loading + error + directory + list + paging + guidance + '<footer><button type="button" class="button secondary" data-action="close-condition-dialog">取消</button>' +
      (!dialog.loading && !dialog.error && totalCount === 0
        ? '<button type="button" class="button danger" data-action="confirm-condition-delete" data-condition-id="' + ui.escapeHtml(dialog.id) + '">确认删除</button>' : "") +
      "</footer></section></div>";
  }

  function expressionSummary(expression) {
    if (!expression || typeof expression !== "object") return "条件结构待修复";
    if (expression.kind === "and" || expression.kind === "or") {
      const label = expression.kind === "and" ? "全部满足" : "任一满足";
      const children = Array.isArray(expression.children) ? expression.children : [];
      return label + "：" + (children.length ? children.slice(0, 3).map(expressionSummary).join("；") +
        (children.length > 3 ? " 等 " + children.length + " 项" : "") : "尚未添加判断");
    }
    if (expression.kind === "not") return "不满足：" + expressionSummary(expression.child);
    if (expression.kind !== "predicate" || !expression.predicate) return "条件结构待修复";
    const predicate = expression.predicate;
    const labels = {
      recent_positive: "最近正向互动", long_inactive: "长时间未互动", user_care: "用户表达关心", special_day: "特别的日子",
      high_frequency: "高频互动", field_comparison: "字段比较", message_count: "消息数量", keywords: "关键词",
      sender: "发送者", actor: "指定角色", group: "指定群组", concrete_date: "具体日期", repeating_date: "每年日期", ai_semantic: "AI 语义",
    };
    if (predicate.kind === "ai_semantic") return "AI 语义 · " + predicate.triggerType;
    if (predicate.kind === "field_comparison") return "字段比较 · " + predicate.fieldId + " " + predicate.operator + " " + predicate.value;
    return labels[predicate.kind] || predicate.kind || "未知判断";
  }

  function effectLibraryPage() {
    const page = ui.state.pages.effectGroups;
    const view = ui.state.listViews.effectGroups;
    return managementPage("临时效果", "一个效果组可以影响多个字段", page, "个效果组", "effectGroup", function (effect) {
      const fieldCount = effect.fieldEffects ? effect.fieldEffects.length : effect.fieldCount;
      return '<article class="compact-row"><button type="button" data-open-entity="effectGroup" data-entity-id="' + ui.escapeHtml(effect.id) + '"><span><strong>' +
        ui.escapeHtml(effect.name) + '</strong><small>' + ui.escapeHtml(effect.description || "未填写说明") + '</small></span><span class="type-chip">' +
        fieldCount + " 个字段</span>" + c.icon("chevron_right") + "</button></article>";
    }, "effect-library", "新增效果组", view, 10);
  }

  function managementPage(title, description, page, noun, entityType, row, route, addLabel, view, pageSize) {
    return '<div class="library-page">' + c.sectionHeading(title, description,
      '<button type="button" class="text-action" data-new-entity="' + entityType + '">' + c.icon("add") + addLabel + "</button>") +
      '<label class="search-field full">' + c.icon("search") + '<input type="search" value="' + ui.escapeHtml(view.search) + '" placeholder="搜索' +
      title + '" aria-label="搜索' + title + '" data-list-search-route="' + route + '"></label>' +
      '<div data-management-region="' + route + '">' + c.listMeta(page, noun, view.page, pageSize, ui.state.snapshot.counts[pageCountKey(route)], c.listViewFiltered(view)) +
      (page.items.length ? '<div class="compact-list">' + page.items.map(row).join("") + "</div>" :
        c.emptyState("inbox", "还没有" + title, "创建后会显示在这里。")) + c.pagination(page, route, view.page) + "</div></div>";
  }

  function pageCountKey(route) {
    return { "rule-library": "rules", "condition-library": "conditions", "effect-library": "effectGroups" }[route];
  }

  function ruleEditorPage() {
    const entity = ui.state.selectedEntityId ? ui.state.entities.get("rule:" + ui.state.selectedEntityId) : null;
    const name = entity ? entity.name : "新自动规则";
    return '<form class="editor-page rule-editor"><section class="editor-section">' + c.sectionHeading("基础信息", "规则名称和说明") +
      '<div class="form-card"><label>规则名称<input value="' + ui.escapeHtml(name) + '"></label><label>描述<textarea rows="2">' +
      ui.escapeHtml(entity ? entity.description : "") + "</textarea></label></div></section>" +
      '<section class="editor-section">' + c.sectionHeading("触发角色", "先筛选角色，再判断条件与 AI") +
      '<button type="button" class="picker-trigger" data-action="open-actor-picker" data-picker-key="rule-trigger-actors" data-picker-mode="multiple"><span>' + c.icon("person_search") + '</span><span><strong>任意角色</strong><small>可搜索并绑定一个或多个角色</small></span>' + c.icon("chevron_right") + "</button></section>" +
      '<section class="editor-section">' + c.sectionHeading("当……", "满足以下条件时") +
      '<button type="button" class="picker-trigger" data-action="open-condition-picker" data-picker-key="rule-condition"><span>' + c.icon("schema") + '</span><span><strong>选择条件</strong><small>从完整条件库复用或新建</small></span>' + c.icon("chevron_right") + "</button></section>" +
      '<section class="editor-section result-section">' + c.sectionHeading("触发后改变的字段内容", "效果是结果，不包含触发条件") +
      '<article class="result-card"><label>状态字段<button type="button" class="field-picker" data-action="open-field-picker" data-picker-key="rule-result-field">选择目标字段 ' + c.icon("search") +
      '</button></label><label>变化值<input type="number" value="0"></label><div class="effect-import"><strong>应用临时效果</strong><p>显式导入的效果只参与本条字段结果。</p>' +
      '<button type="button" class="picker-trigger compact" data-action="open-effect-picker" data-picker-key="rule-result-effects" data-picker-mode="multiple">' + c.icon("bolt") + '<span>选择一个或多个效果组</span>' + c.icon("add") +
      '</button></div></article><button type="button" class="button secondary full">' + c.icon("add") + "添加字段变化</button></section>" +
      '<div class="editor-submit"><button type="button" class="button secondary" data-action="go-back">取消</button><button type="submit" class="button primary" disabled>保存规则</button></div></form>';
  }

  function conditionEditorPage() {
    const draft = ui.state.conditionEditorDraft;
    if (!draft) return c.emptyState("progress_activity", "正在准备条件", "正在读取完整条件与规则引用。");
    const committed = draft.mutationCommitted;
    return '<form class="editor-page condition-editor" data-form="condition-editor"><section class="editor-section">' +
      c.sectionHeading("基础信息", "条件可被多个规则复用") + '<div class="form-card"><label>条件名称<input name="conditionName" maxlength="256" value="' +
      ui.escapeHtml(draft.name) + '" autocomplete="off"></label><label>说明<textarea name="conditionDescription" maxlength="4096" rows="2">' +
      ui.escapeHtml(draft.description) + '</textarea></label><label class="switch-line"><input name="conditionEnabled" type="checkbox"' +
      (draft.enabled ? " checked" : "") + '><span>启用此条件</span></label></div></section>' + renderSharedConditionReferences(draft) +
      '<section class="editor-section">' + c.sectionHeading("条件结构", "递归组合 AND、OR、NOT 与完整判断类型；最多 12 层、100 个节点") +
      '<div class="condition-tree">' + renderConditionExpression(draft.expression, [], 0, true, draft) + '</div></section>' +
      '<div class="inline-error condition-editor-error" data-condition-editor-error role="alert">' + ui.escapeHtml(draft.error || "") + "</div>" +
      '<div class="editor-submit"><button type="button" class="button secondary" data-action="go-back">' + (committed ? "返回" : "取消") + "</button>" +
      (committed ? '<button type="button" class="button primary" data-action="reload-condition-after-save">只重新载入列表</button>' :
        '<button type="submit" class="button primary"' + (draft.submitting ? " disabled" : "") + '>' +
        (draft.submitting ? c.icon("progress_activity") + "正在保存" : "保存条件") + "</button>") + "</div></form>";
  }

  function renderSharedConditionReferences(draft) {
    if (!draft.id) return "";
    const response = draft.references;
    const snapshotRevision = ui.state.snapshot && ui.state.snapshot.revision;
    const authoritative = Boolean(response && response.checkedRevision === snapshotRevision);
    const unknown = !authoritative;
    const unknownMessage = draft.referenceError || (draft.referenceLoading
      ? "正在按最新数据修订重新检查规则引用"
      : "尚未完成当前数据修订的引用检查");
    const error = unknown ? '<div class="condition-reference-unknown" role="alert"><p class="inline-error">影响范围未知。' +
      ui.escapeHtml(unknownMessage) + '</p><button type="button" class="button secondary" data-action="retry-condition-references"' +
      (draft.referenceLoading ? " disabled" : "") + '>重试引用检查</button></div>' : "";
    const items = authoritative && Array.isArray(response.items) ? response.items : [];
    const list = unknown ? "" : items.length ? '<ul>' + items.map(function (reference) {
      return '<li><strong>' + ui.escapeHtml(reference.name) + '</strong><small>' + ui.escapeHtml(reference.id) + "</small></li>";
    }).join("") + "</ul>" : '<p class="support-copy">当前没有规则引用，保存只影响此条件本身。</p>';
    return '<section class="editor-section condition-shared-refs" data-condition-shared-refs>' +
      c.sectionHeading("受影响的规则", unknown ? "影响范围未知，检查完成前不能保存" : "编辑前已检查：共 " + response.totalCount + " 条规则引用") +
      '<div class="condition-reference-panel">' + error + list + (authoritative && response.hasMore
        ? '<p class="support-copy">引用较多，可在删除检查中分页搜索查看。</p>' : "") + "</div></section>";
  }

  function conditionPath(path) { return path.join("."); }

  function renderConditionExpression(expression, path, depth, root, draft) {
    const pathValue = conditionPath(path);
    const changing = draft.transitionPath === pathValue ? " is-changing" : "";
    if (expression.kind === "predicate") return renderConditionPredicate(expression.predicate, path, depth, root, changing);
    const label = expression.kind === "and" ? "全部满足（AND）" : expression.kind === "or" ? "任一满足（OR）" : "不满足（NOT）";
    const iconName = expression.kind === "and" ? "done_all" : expression.kind === "or" ? "call_split" : "block";
    const children = expression.kind === "not" ? [expression.child] : expression.children;
    return '<article class="condition-node-card condition-group-card depth-' + (depth % 4) + changing + '" data-condition-node data-condition-kind="' +
      expression.kind + '" data-condition-path="' + pathValue + '" style="--condition-depth:' + depth + '"><header><span>' + c.icon(iconName) +
      '<span><strong>' + label + '</strong><small>第 ' + (depth + 1) + " 层 · " + children.length + " 个子节点</small></span></span>" +
      (root ? '<button type="button" class="icon-button" data-action="reset-condition-root" aria-label="清空根条件">' + c.icon("restart_alt") + "</button>" :
        '<button type="button" class="icon-button danger-text" data-action="remove-condition-node" data-condition-path="' + pathValue + '" aria-label="移除此组合">' + c.icon("delete") + "</button>") +
      '</header><div class="condition-group-toolbar" aria-label="组合操作">' +
      (expression.kind === "and" || expression.kind === "or"
        ? '<button type="button" data-action="change-condition-group" data-condition-path="' + pathValue + '">' + c.icon("swap_horiz") +
          (expression.kind === "and" ? "改为 OR" : "改为 AND") + "</button>"
        : '<span class="not-one-child">NOT 固定一个子节点</span>') +
      '<button type="button" data-action="add-condition-predicate" data-condition-path="' + pathValue + '">' + c.icon("add") + "判断</button>" +
      '<button type="button" data-action="add-condition-group" data-condition-group-kind="and" data-condition-path="' + pathValue + '">' + c.icon("account_tree") + "AND</button>" +
      '<button type="button" data-action="add-condition-group" data-condition-group-kind="or" data-condition-path="' + pathValue + '">' + c.icon("call_split") + "OR</button>" +
      '<button type="button" data-action="add-condition-group" data-condition-group-kind="not" data-condition-path="' + pathValue + '">' + c.icon("block") + "NOT</button></div>" +
      '<div class="condition-children">' + (children.length ? children.map(function (child, index) {
        return renderConditionExpression(child, path.concat(index), depth + 1, false, draft);
      }).join("") : '<div class="condition-root-empty"><span>' + c.icon("add_circle") + '</span><div><strong>还没有判断</strong><p>从上方添加判断或 AND / OR / NOT 组合。</p></div></div>') + "</div></article>";
  }

  function renderConditionPredicate(predicate, path, depth, root, changing) {
    const pathValue = conditionPath(path);
    return '<article class="condition-node-card condition-predicate-card depth-' + (depth % 4) + changing + '" data-condition-node data-condition-kind="predicate" data-condition-path="' +
      pathValue + '" style="--condition-depth:' + depth + '"><header><span>' + c.icon(predicate.kind === "ai_semantic" ? "psychology" : "tune") +
      '<span><strong>' + ui.escapeHtml(predicateLabel(predicate.kind)) + '</strong><small>判断节点 · 第 ' + (depth + 1) + " 层</small></span></span>" +
      (root ? '<button type="button" class="icon-button" data-action="reset-condition-root" aria-label="重置根条件">' + c.icon("restart_alt") + "</button>" :
        '<button type="button" class="icon-button danger-text" data-action="remove-condition-node" data-condition-path="' + pathValue + '" aria-label="移除此判断">' + c.icon("delete") + "</button>") +
      '</header><label>判断类型<select data-condition-predicate-kind data-condition-path="' + pathValue + '">' + predicateTypeOptions(predicate.kind) +
      "</select></label><div class=\"predicate-fields\">" + renderPredicateFields(predicate, pathValue) + "</div></article>";
  }

  function predicateTypeOptions(selected) {
    const types = [
      ["recent_positive", "最近正向互动"], ["long_inactive", "长时间未互动"], ["user_care", "用户表达关心"],
      ["special_day", "特别的日子"], ["high_frequency", "高频互动"], ["field_comparison", "字段比较"],
      ["message_count", "消息数量"], ["keywords", "关键词"], ["sender", "发送者"], ["actor", "指定角色"],
      ["group", "指定群组"], ["concrete_date", "具体日期"], ["repeating_date", "每年重复日期"], ["ai_semantic", "AI 语义判断"],
    ];
    return types.map(function (type) { return '<option value="' + type[0] + '"' + (selected === type[0] ? " selected" : "") + ">" + type[1] + "</option>"; }).join("");
  }

  function predicateLabel(kind) {
    const labels = {
      recent_positive: "最近正向互动", long_inactive: "长时间未互动", user_care: "用户表达关心", special_day: "特别的日子",
      high_frequency: "高频互动", field_comparison: "字段比较", message_count: "消息数量", keywords: "关键词",
      sender: "发送者", actor: "指定角色", group: "指定群组", concrete_date: "具体日期", repeating_date: "每年重复日期", ai_semantic: "AI 语义判断",
    };
    return labels[kind] || "未知判断";
  }

  function numberField(label, property, value, pathValue, options) {
    const opts = options || {};
    return '<label>' + label + '<input type="number" data-condition-prop="' + property + '" data-condition-path="' + pathValue + '"' +
      (opts.optional ? ' data-condition-optional="true"' : "") + (opts.min !== undefined ? ' min="' + opts.min + '"' : "") +
      (opts.max !== undefined ? ' max="' + opts.max + '"' : "") + (opts.step ? ' step="' + opts.step + '"' : "") + (opts.optional ? "" : " required") + ' value="' +
      ui.escapeHtml(value === undefined ? "" : value) + '"></label>';
  }

  function renderPredicateFields(predicate, pathValue) {
    if (predicate.kind === "recent_positive") return numberField("最近正向记录数", "count", predicate.count, pathValue, { min: 0, step: 1 });
    if (predicate.kind === "long_inactive") return numberField("至少未互动（小时）", "hours", predicate.hours, pathValue, { min: 0, step: 0.5 });
    if (predicate.kind === "user_care") return '<p class="predicate-note">识别用户明确表达照顾、担心或关心。</p>';
    if (predicate.kind === "special_day") return '<p class="predicate-note">兼容旧版“特别的日子”语义；需要真实日期时请选择日期判断。</p>';
    if (predicate.kind === "high_frequency") return '<div class="predicate-grid">' +
      numberField("消息数", "messages", predicate.messages, pathValue, { min: 0, step: 1 }) +
      numberField("窗口小时（可选）", "windowHours", predicate.windowHours, pathValue, { min: 0, step: 0.5, optional: true }) +
      numberField("统计桶小时（可选）", "bucketHours", predicate.bucketHours, pathValue, { min: 0.01, step: 0.5, optional: true }) + "</div>";
    if (predicate.kind === "field_comparison") return conditionPicker("field", pathValue, [predicate.fieldId].filter(Boolean)) +
      '<div class="predicate-grid"><label>比较符<select data-condition-prop="operator" data-condition-path="' + pathValue + '">' +
      [[">=", "大于等于"], ["<=", "小于等于"], [">", "大于"], ["<", "小于"], ["==", "等于"]].map(function (item) {
        return '<option value="' + ui.escapeHtml(item[0]) + '"' + (predicate.operator === item[0] ? " selected" : "") + ">" + item[1] + "</option>";
      }).join("") + "</select></label>" + numberField("比较值", "value", predicate.value, pathValue, { step: "any" }) + "</div>";
    if (predicate.kind === "message_count") return '<div class="predicate-grid">' + numberField("消息数", "count", predicate.count, pathValue, { min: 0, step: 1 }) +
      numberField("窗口小时", "windowHours", predicate.windowHours, pathValue, { min: 0, step: 0.5 }) + '</div><label>发送者（可选）<select data-condition-prop="sender" data-condition-optional="true" data-condition-path="' + pathValue + '">' +
      '<option value="">不限</option><option value="user"' + (predicate.sender === "user" ? " selected" : "") + '>用户</option><option value="character"' + (predicate.sender === "character" ? " selected" : "") + ">角色</option></select></label>";
    if (predicate.kind === "keywords") return keywordField("任一关键词", "includeAny", predicate.includeAny, pathValue) +
      keywordField("全部关键词", "includeAll", predicate.includeAll, pathValue) + keywordField("排除词", "exclude", predicate.exclude, pathValue) +
      '<div class="predicate-grid">' + numberField("窗口小时（可选）", "windowHours", predicate.windowHours, pathValue, { min: 0, step: 0.5, optional: true }) +
      '<label class="switch-line predicate-switch"><input type="checkbox" data-condition-prop="caseSensitive" data-condition-path="' + pathValue + '"' +
      (predicate.caseSensitive ? " checked" : "") + '><span>区分大小写</span></label></div>';
    if (predicate.kind === "sender") return '<fieldset class="bounded-choice"><legend>允许的发送者</legend>' +
      senderChoice("user", "用户", predicate.senders, pathValue) + senderChoice("character", "角色", predicate.senders, pathValue) + "</fieldset>";
    if (predicate.kind === "actor") return conditionPicker("actor", pathValue, predicate.actorIds);
    if (predicate.kind === "group") return conditionPicker("group", pathValue, predicate.groupIds);
    if (predicate.kind === "concrete_date") return keywordField("具体日期（YYYY-MM-DD）", "dates", predicate.dates, pathValue);
    if (predicate.kind === "repeating_date") return '<div class="predicate-grid">' + numberField("月份", "month", predicate.month, pathValue, { min: 1, max: 12, step: 1 }) +
      numberField("日期", "day", predicate.day, pathValue, { min: 1, max: 31, step: 1 }) +
      '</div><p class="predicate-note">按每年公历月日匹配；2 月允许 29 日，仅在闰年实际触发。</p>';
    if (predicate.kind === "ai_semantic") return '<div class="ai-predicate-fields"><p class="ai-stable-id">稳定判断 ID <code data-condition-ai-id data-condition-path="' + pathValue + '">' +
      ui.escapeHtml(predicate.id) + '</code></p><label>触发类型<input list="ai-trigger-suggestions" data-condition-prop="triggerType" data-condition-path="' + pathValue + '" maxlength="256" value="' +
      ui.escapeHtml(predicate.triggerType) + '"><datalist id="ai-trigger-suggestions"><option value="情绪变化"><option value="行为意图"><option value="关系事件"><option value="场景事件"></datalist></label>' +
      '<p class="predicate-note">可选内置建议，也可直接输入自定义类型。</p>' +
      '<label>触发要求<textarea rows="3" maxlength="4096" data-condition-prop="requirement" data-condition-path="' + pathValue + '" placeholder="描述模型必须观察到的事实">' +
      ui.escapeHtml(predicate.requirement) + '</textarea></label>' + numberField("最低置信度", "minimumConfidence", predicate.minimumConfidence, pathValue, { min: 0, max: 1, step: 0.05 }) + "</div>";
    return '<p class="inline-error">无法编辑此判断类型。</p>';
  }

  function keywordField(label, property, values, pathValue) {
    return '<label class="bounded-list-field"><span>' + label + '<em>' + values.length + ' 项</em></span><input type="text" data-condition-prop="' + property +
      '" data-condition-path="' + pathValue + '" value="' + ui.escapeHtml(values.join("，")) + '" placeholder="用逗号分隔，最多 100 项"></label>';
  }

  function senderChoice(value, label, selected, pathValue) {
    return '<label><input type="checkbox" data-condition-sender="' + value + '" data-condition-path="' + pathValue + '"' +
      (selected.includes(value) ? " checked" : "") + '><span>' + label + "</span></label>";
  }

  function conditionPicker(kind, pathValue, ids) {
    const settings = kind === "field"
      ? { action: "open-field-picker", title: "选择字段", icon: "search", mode: "single" }
      : kind === "actor"
        ? { action: "open-actor-picker", title: "选择角色", icon: "person_search", mode: "multiple" }
        : { action: "open-group-picker", title: "选择群组", icon: "groups", mode: "multiple" };
    const summary = selectionSummary(kind, ids);
    return '<button type="button" class="picker-trigger compact condition-picker-trigger" data-action="' + settings.action + '" data-picker-key="condition-' +
      kind + "-" + pathValue + '" data-picker-mode="' + settings.mode + '" data-picker-selected="' + ui.escapeHtml(JSON.stringify(ids)) +
      '" data-condition-picker="' + kind + '" data-condition-path="' + pathValue + '"><span>' + c.icon(settings.icon) + '</span><span data-condition-selection-summary><strong>' +
      settings.title + '</strong><small>' + ui.escapeHtml(summary) + "</small></span>" + c.icon("chevron_right") + "</button>";
  }

  function selectionSummary(kind, ids) {
    if (!ids.length) return kind === "field" ? "尚未选择字段" : "尚未选择，可搜索多选";
    const entityType = kind;
    const names = ids.slice(0, 4).map(function (id) {
      const entity = ui.state.entities.get(entityType + ":" + id);
      return entity ? entity.name + " · " + id : id;
    });
    return names.join("、") + (ids.length > 4 ? "，另 " + (ids.length - 4) + " 项" : "");
  }

  function effectEditorPage() {
    const entity = ui.state.selectedEntityId ? ui.state.entities.get("effectGroup:" + ui.state.selectedEntityId) : null;
    const reasonMode = ui.state.effectReasonMode === "custom" ? "custom" : "template";
    return '<form class="editor-page effect-editor"><section class="editor-section">' + c.sectionHeading("基础信息", "临时效果以组为单位复用") +
      '<div class="form-card"><label>效果组名称<input value="' + ui.escapeHtml(entity ? entity.name : "新临时效果") + '"></label><label>说明<textarea rows="2">' +
      ui.escapeHtml(entity ? entity.description : "") + "</textarea></label></div></section>" +
      '<section class="editor-section">' + c.sectionHeading("目标字段", "先按字段设置，再决定字段内哪些角色触发") +
      '<article class="field-effect-card"><button type="button" class="field-picker" data-action="open-field-picker" data-picker-key="effect-target-field">' + c.icon("search") + "选择目标字段</button>" +
      '<div class="segmented-control static" style="--segments:3"><button type="button" class="active">所有绑定角色</button><button type="button">触发角色</button><button type="button">指定角色</button></div>' +
      '<p class="support-copy">默认一个字段的所有绑定角色都生效；选择“触发角色”时，只影响本次事件中的角色。</p>' +
      '<button type="button" class="picker-trigger compact" data-action="open-actor-picker" data-picker-key="effect-target-actors" data-picker-mode="multiple">' + c.icon("person_search") + '<span>搜索指定角色</span>' + c.icon("chevron_right") + '</button>' +
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
  Object.assign(ui.pages, { conditionRow, expressionSummary });
}(window.MvuUi));
