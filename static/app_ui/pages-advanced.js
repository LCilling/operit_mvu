(function (ui) {
  "use strict";
  const c = ui.components;

  function advancedPage() {
    return '<div class="advanced-page">' +
      '<section class="editor-section" data-advanced-primary="appearance">' +
      c.sectionHeading("页面外观", "背景作用于插件全部页面") +
      '<div class="menu-group"><button type="button" class="menu-row" data-action="choose-background"><span class="menu-row-icon">' + c.icon("image") +
      '</span><span><strong>更换背景照片</strong><small>支持 JPEG、PNG 或 WebP</small></span>' + c.icon("chevron_right") + '</button><button type="button" class="menu-row" data-action="reset-background"><span class="menu-row-icon">' +
      c.icon("restart_alt") + '</span><span><strong>恢复默认背景</strong><small>移除自定义照片并恢复内置主题</small></span>' + c.icon("chevron_right") + "</button></div></section>" +
      '<section class="editor-section" data-advanced-primary="backup">' +
      c.sectionHeading("导入与导出", "完整备份字段、条件、规则、效果与记录") +
      '<div class="action-grid"><button type="button" class="action-card" data-action="export-dataset"' + (ui.state.advancedExport.busy ? " disabled" : "") + '>' +
      c.icon(ui.state.advancedExport.busy ? "progress_activity" : "download") + '<span><strong>' + (ui.state.advancedExport.busy ? "正在导出" : "导出完整备份") +
      '</strong><small>保存到 Operit 导出目录</small></span></button>' +
      '<button type="button" class="action-card" data-action="choose-dataset-import">' + c.icon("upload") +
      '<span><strong>导入完整备份</strong><small>先预览，再决定是否替换</small></span></button></div>' +
      renderExportStatus() + "</section>" + renderMaintenance() + renderAdvancedDialog() + "</div>";
  }

  function renderExportStatus() {
    const state = ui.state.advancedExport;
    if (state.busy) return '<div class="advanced-inline-status" role="status"><span class="status-spinner" aria-hidden="true"></span><span>正在创建并写入完整备份，请勿重复操作。</span></div>';
    if (state.error) {
      return '<div class="advanced-inline-status error" role="alert" data-export-error><div><strong>导出失败</strong><p>' + ui.escapeHtml(state.error) +
        '</p></div><button type="button" class="button secondary" data-action="retry-export-dataset">重试导出</button></div>';
    }
    if (!state.result) return '<p class="advanced-section-note">完整备份会保留当前修订及全部变化记录，字段模板导入导出仍在“配置 → 字段设置”。</p>';
    const result = state.result;
    const summary = result.summary;
    return '<div class="backup-result" data-export-result role="status"><header>' + c.icon("check_circle") + '<span><strong>备份已保存</strong><small>来源 r' +
      summary.sourceRevision + " · " + formatBytes(summary.byteCount) + '</small></span></header><dl class="backup-count-grid">' +
      countCell("字段", summary.fieldCount) + countCell("条件", summary.conditionCount) + countCell("规则", summary.ruleCount) +
      countCell("效果组", summary.effectGroupCount) + countCell("活跃效果", summary.activeEffectCount) + countCell("记录", summary.recordCount) +
      '</dl><p><span>文件名</span><strong>' + ui.escapeHtml(result.fileName) + '</strong></p><p><span>保存路径</span><strong>' +
      ui.escapeHtml(result.savedPath) + "</strong></p></div>";
  }

  function renderMaintenance() {
    const snapshot = ui.state.snapshot;
    const migration = snapshot.migrationStatus;
    const budget = snapshot.modelBudget;
    const mode = migration.mode === "v3" ? "v3 数据模式" : "v2 兼容模式";
    const sourceLabel = migration.mode !== "v3" ? "迁移未完成" : ({ existing: "现有 v3 数据", migrated: "已从 v2 迁移", initialized: "全新初始化" })[migration.source];
    const budgetWarning = budget.overflow || budget.referencedIncluded < budget.referencedTotal;
    return '<details class="maintenance"><summary><span>' + c.icon("build") + '</span><span><strong>高级系统设置</strong><small>模型预算、迁移、默认条件与诊断</small></span>' + c.icon("expand_more") +
      '</summary><div class="maintenance-body"><section class="maintenance-block"><div class="maintenance-title"><div><strong>模型字段预算</strong><small>仅影响本轮发送给系统模型的字段</small></div><span class="budget-chip' + (budgetWarning ? " warning" : "") + '">' + budget.used + "/" + budget.limit +
      '</span></div><p class="model-budget-summary" data-model-budget-summary>本轮使用 ' + budget.used + " / 共 " + budget.total + " 个字段</p>" +
      '<p>引用字段 ' + budget.referencedIncluded + " / " + budget.referencedTotal + (budget.overflow ? "；已达到本轮上限。" : "。") + "</p>" +
      renderDiagnostics(budget.diagnostics) + '</section><section class="maintenance-block"><div class="diagnostic-row"><span>当前数据模式</span><strong>' + mode +
      '</strong></div><div class="diagnostic-row"><span>数据来源</span><strong>' + ui.escapeHtml(sourceLabel || "未知") +
      '</strong></div><div class="diagnostic-row"><span>数据修订号</span><strong>r' + snapshot.revision +
      '</strong></div><div class="diagnostic-row"><span>快照状态</span><strong>' + (snapshot.snapshotTruncated ? "快照已精简" : "完整首屏") + "</strong></div>" +
      renderMigrationDetails(migration) + '</section><section class="maintenance-block default-condition-maintenance"><div class="maintenance-title"><div><strong>默认条件模板</strong><small>恢复前会区分缺失、已有与冲突</small></div></div>' +
      '<button type="button" class="button secondary full" data-action="preview-default-conditions">预览并恢复默认条件</button><p>缺失模板默认选中；冲突模板只有明确勾选后才会替换。</p></section>' +
      '<section class="maintenance-block"><div class="maintenance-title"><div><strong>引用诊断</strong><small>按库定位缺失项，不执行不透明的批量修复</small></div></div><div class="maintenance-links">' +
      '<button type="button" class="button secondary" data-route="condition-library">进入条件库</button><button type="button" class="button secondary" data-route="rule-library">进入规则库</button></div></section>' +
      "</div></details>";
  }

  function renderDiagnostics(diagnostics) {
    if (!diagnostics.length) return '<p class="diagnostic-empty">本轮没有模型字段诊断。</p>';
    return '<ul class="diagnostic-list">' + diagnostics.map(function (item) { return "<li>" + ui.escapeHtml(item) + "</li>"; }).join("") + "</ul>";
  }

  function renderMigrationDetails(migration) {
    if (migration.mode === "v2_compat") {
      return '<div class="maintenance-alert error" role="alert"><strong>v2 迁移未完成</strong><p>' + ui.escapeHtml(migration.error.message) +
        '（' + ui.escapeHtml(migration.error.code) + '）</p><button type="button" class="button secondary" data-action="retry">重新加载以重试</button></div>';
    }
    let html = "";
    if (migration.report) {
      const report = migration.report;
      html += '<div class="migration-report"><strong>迁移结果</strong><dl class="backup-count-grid">' + countCell("字段", report.migratedFields) +
        countCell("规则", report.migratedRules) + countCell("条件", report.migratedConditions) + countCell("效果组", report.migratedEffectGroups) + "</dl>" +
        (report.warnings.length ? '<ul class="diagnostic-list">' + report.warnings.map(function (warning) { return "<li>" + ui.escapeHtml(warning) + "</li>"; }).join("") +
          '</ul><p>已显示 ' + report.warnings.length + " / 共 " + report.warningCount + (report.warningsTruncated ? "，列表已截断。" : "。") + "</p>" : '<p>迁移没有产生警告。</p>') + "</div>";
    }
    ["cleanup", "indexing"].forEach(function (key) {
      if (!migration[key]) return;
      const label = key === "cleanup" ? "旧文件清理待重试" : "记录索引待重试";
      html += '<div class="maintenance-alert warning"><strong>' + label + '</strong><p>' + ui.escapeHtml(migration[key].error.message) + "（" +
        ui.escapeHtml(migration[key].error.code) + "）</p></div>";
    });
    return html;
  }

  function renderAdvancedDialog() {
    const dialog = ui.state.advancedDialog;
    if (!dialog) return "";
    return dialog.kind === "dataset-import" ? renderDatasetImportDialog(dialog) : renderDefaultConditionDialog(dialog);
  }

  function renderDialogShell(title, subtitle, body, footer, dataAttribute) {
    return '<div class="advanced-dialog-layer" data-action="close-advanced-dialog"><section class="advanced-dialog" role="dialog" aria-modal="true" aria-labelledby="advanced-dialog-title" data-stop-close ' + dataAttribute +
      '><header><div><h2 id="advanced-dialog-title">' + ui.escapeHtml(title) + '</h2><p>' + ui.escapeHtml(subtitle) +
      '</p></div><button type="button" class="icon-button" data-action="close-advanced-dialog" aria-label="关闭">' + c.icon("close") +
      '</button></header><div class="advanced-dialog-body">' + body + '</div><footer>' + footer + "</footer></section></div>";
  }

  function renderDatasetImportDialog(dialog) {
    let body = '<div class="dialog-file" data-dataset-import-file>' + c.icon("description") + '<span><strong>' + ui.escapeHtml(dialog.fileName || "未读取文件") +
      '</strong><small>文件内容只会发送给 MVU 服务进行权威校验</small></span></div>';
    if (dialog.error) body += '<div class="maintenance-alert error" role="alert" data-dataset-import-error><strong>' + (dialog.stale ? "预览已过期" : "无法继续导入") +
      '</strong><p>' + ui.escapeHtml(dialog.error) + "</p></div>";
    if (dialog.result) {
      body += '<div class="backup-result compact" data-dataset-import-result><header>' + c.icon("check_circle") + '<span><strong>完整数据已恢复</strong><small>新修订 ' +
        dialog.result.revision + " · 记录 " + dialog.result.recordCount + '</small></span></header><p>来源 ' + formatBackupKind(dialog.result.kind) + "，来源修订 " + dialog.result.sourceRevision + "。</p></div>";
    } else if (dialog.preview) {
      const preview = dialog.preview;
      body += '<div class="dataset-preview" data-dataset-import-preview><div class="preview-heading"><span class="status-pill">' + formatBackupKind(preview.kind) +
        '</span><span>来源修订 ' + preview.sourceRevision + "</span></div>" + (preview.exportedAt ? '<p>导出时间 ' + ui.escapeHtml(formatDate(preview.exportedAt)) + "</p>" : '<p>来源格式 v2，导入时会迁移为 v3。</p>') +
        '<dl class="backup-count-grid">' + countCell("字段", preview.summary.fieldCount) + countCell("条件", preview.summary.conditionCount) +
        countCell("规则", preview.summary.ruleCount) + countCell("效果组", preview.summary.effectGroupCount) + countCell("活跃效果", preview.summary.activeEffectCount) +
        countCell("记录", preview.summary.recordCount) + "</dl>" + renderImportWarnings(preview.migrationWarnings) +
        '<div class="replacement-warning"><strong>将替换现有数据</strong><p>' + ui.escapeHtml(preview.replacementWarning) +
        '</p></div><label class="confirmation-check"><input type="checkbox" data-confirm-dataset-replacement' + (dialog.confirmed ? " checked" : "") +
        (dialog.busy || dialog.stale ? " disabled" : "") + '><span>我理解这会替换全部当前 MVU 数据</span></label></div>';
    } else if (dialog.loading) {
      body += '<div class="advanced-loading" role="status"><span class="status-spinner" aria-hidden="true"></span><p>正在由 MVU 服务校验备份内容…</p></div>';
    }
    let footer = '<button type="button" class="button secondary" data-action="close-advanced-dialog"' + (dialog.busy ? " disabled" : "") + ">" + (dialog.result ? "完成" : "取消") + "</button>";
    if (!dialog.result && dialog.json && (dialog.error || dialog.stale)) footer += '<button type="button" class="button secondary" data-action="repreview-dataset-import"' + (dialog.busy ? " disabled" : "") + '>重新预览</button>';
    if (dialog.preview && !dialog.result) footer += '<button type="button" class="button primary" data-action="commit-dataset-import"' + (!dialog.confirmed || dialog.busy || dialog.stale ? " disabled" : "") + ">" + (dialog.busy ? "正在恢复" : "确认替换并导入") + "</button>";
    return renderDialogShell("导入完整备份", "先核对内容，再决定是否替换当前数据", body, footer, "data-dataset-import-dialog");
  }

  function renderImportWarnings(warnings) {
    if (warnings.totalCount === 0) return '<div class="migration-warning-list"><strong>迁移警告</strong><p>没有迁移警告。</p></div>';
    return '<div class="migration-warning-list"><strong>迁移警告</strong><ul>' + warnings.items.map(function (warning) { return "<li>" + ui.escapeHtml(warning) + "</li>"; }).join("") +
      '</ul><p>已显示 ' + warnings.items.length + " / 共 " + warnings.totalCount + (warnings.truncated ? "，列表已截断。" : "。") + "</p></div>";
  }

  function renderDefaultConditionDialog(dialog) {
    let body = "";
    if (dialog.error) body += '<div class="maintenance-alert error" role="alert" data-default-condition-error><strong>无法恢复默认条件</strong><p>' + ui.escapeHtml(dialog.error) + "</p></div>";
    if (dialog.result) {
      body += '<div class="backup-result compact" data-default-condition-result><header>' + c.icon("check_circle") + '<span><strong>默认条件已更新</strong><small>新修订 ' + dialog.result.revision +
        '</small></span></header><p>新增 ' + dialog.result.addedCount + "，替换 " + dialog.result.replacedCount + "，保持 " + dialog.result.unchangedCount + "。</p></div>";
    } else if (dialog.preview) {
      body += '<div class="default-condition-preview" data-default-condition-preview>' + dialog.preview.items.map(function (item) {
        const checked = item.status === "missing" && dialog.selectedMissingIds.includes(item.id) || item.status === "conflict" && dialog.replaceConflictIds.includes(item.id);
        const control = item.status === "existing" ? "" : '<input type="checkbox" data-default-condition-choice="' + item.status + '" data-default-condition-choice-id="' + ui.escapeHtml(item.id) + '"' + (checked ? " checked" : "") + (dialog.busy ? " disabled" : "") + ">";
        const label = item.status === "missing" ? "缺失 · 将新增" : item.status === "existing" ? "已存在 · 保持" : "冲突 · 默认不替换";
        return '<label class="default-condition-row ' + item.status + '" data-default-condition-id="' + ui.escapeHtml(item.id) + '">' + control + '<span><strong>' +
          ui.escapeHtml(item.name) + '</strong><small>' + ui.escapeHtml(item.description) + '</small><em>' + label + (item.currentName && item.status === "conflict" ? "（当前：" + ui.escapeHtml(item.currentName) + "）" : "") + "</em></span></label>";
      }).join("") + '<p class="advanced-section-note">冲突项只有勾选后才会按默认模板替换；已有项不会改写。</p></div>';
    } else body += '<div class="advanced-loading" role="status"><span class="status-spinner" aria-hidden="true"></span><p>正在比较 5 个默认条件模板…</p></div>';
    let footer = '<button type="button" class="button secondary" data-action="close-advanced-dialog"' + (dialog.busy ? " disabled" : "") + ">" + (dialog.result ? "完成" : "取消") + "</button>";
    if (!dialog.result && dialog.error) footer += '<button type="button" class="button secondary" data-action="preview-default-conditions">重新预览</button>';
    if (dialog.preview && !dialog.result) {
      const noSelection = dialog.selectedMissingIds.length + dialog.replaceConflictIds.length === 0;
      footer += '<button type="button" class="button primary" data-action="commit-default-conditions"' + (dialog.busy || noSelection ? " disabled" : "") + ">" + (dialog.busy ? "正在恢复" : "应用所选模板") + "</button>";
    }
    return renderDialogShell("恢复默认条件", "5 个模板按缺失、已有和冲突分别处理", body, footer, "data-default-condition-dialog");
  }

  function countCell(label, value) { return "<div><dt>" + ui.escapeHtml(label) + "</dt><dd>" + value + "</dd></div>"; }
  function formatBackupKind(kind) { return kind === "full_v3" ? "完整 v3 备份" : "旧版 v2 数据"; }
  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
  function formatBytes(value) {
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + " KB";
    return (value / (1024 * 1024)).toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + " MB";
  }

  Object.assign(ui.pages, { advanced: advancedPage });
}(window.MvuUi));
