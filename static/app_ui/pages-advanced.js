(function (ui) {
  "use strict";
  const c = ui.components;

  function advancedPage() {
    const migration = ui.state.snapshot.migrationStatus;
    const mode = migration.mode === "v3" ? "v3 数据模式" : "v2 兼容模式";
    return '<div class="advanced-page">' +
      '<section class="editor-section">' + c.sectionHeading("页面外观", "背景作用于插件全部页面") +
      '<div class="menu-group"><button type="button" class="menu-row" data-action="choose-background"><span class="menu-row-icon">' + c.icon("image") +
      '</span><span><strong>更换背景照片</strong><small>支持 JPEG、PNG 或 WebP</small></span>' + c.icon("chevron_right") + '</button><button type="button" class="menu-row" data-action="reset-background"><span class="menu-row-icon">' +
      c.icon("restart_alt") + '</span><span><strong>恢复默认背景</strong><small>移除自定义照片并恢复内置主题</small></span>' + c.icon("chevron_right") + "</button></div></section>" +
      '<section class="editor-section">' + c.sectionHeading("导入与导出", "完整备份字段、条件、规则、效果与记录") +
      '<div class="action-grid"><button type="button" class="action-card" data-action="export-dataset">' + c.icon("download") + '<span><strong>导出数据</strong><small>创建 v3 JSON 备份</small></span></button>' +
      '<button type="button" class="action-card" data-action="choose-dataset-import">' + c.icon("upload") + '<span><strong>导入数据</strong><small>支持 v2 与 v3 备份</small></span></button></div></section>' +
      '<details class="maintenance"><summary><span>' + c.icon("build") + '</span><span><strong>高级系统设置</strong><small>迁移、默认条件与诊断</small></span>' + c.icon("expand_more") +
      '</summary><div class="maintenance-body"><div class="diagnostic-row"><span>当前数据模式</span><strong>' + mode + '</strong></div><div class="diagnostic-row"><span>数据修订号</span><strong>' +
      ui.state.snapshot.revision + '</strong></div><div class="diagnostic-row"><span>快照状态</span><strong>' + (ui.state.snapshot.snapshotTruncated ? "已精简" : "完整首屏") +
      '</strong></div><button type="button" class="button secondary full" disabled>恢复默认条件</button><p>恢复操作会先显示将新增的模板，不会静默覆盖现有条件。</p></div></details></div>';
  }

  Object.assign(ui.pages, { advanced: advancedPage });
}(window.MvuUi));
