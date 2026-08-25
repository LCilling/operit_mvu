(function (ui) {
  "use strict";

  const BOTTOM_ROOTS = [
    { id: "status", icon: "favorite", label: "状态" },
    { id: "config", icon: "tune", label: "配置" },
    { id: "rules", icon: "account_tree", label: "规则" },
    { id: "advanced", icon: "settings", label: "高级" },
  ];
  const SCOPE_LABELS = {
    character: "角色（独立）",
    group: "群组（共享）",
    global: "全局共享",
    chat: "会话专属",
  };
  const SOURCE_LABELS = {
    manual: "手动调整",
    natural: "自然变化",
    per_turn: "每轮变化",
    rule: "规则触发",
    ai: "AI 更新",
  };

  function icon(name, label) {
    return '<span class="material-symbols-rounded"' + (label ? ' aria-label="' + ui.escapeHtml(label) + '"' : ' aria-hidden="true"') + '>' + ui.escapeHtml(name) + '</span>';
  }

  function topBar(route) {
    const leading = route.header === "menu"
      ? '<button type="button" class="icon-button menu-button" data-action="open-drawer" aria-label="打开菜单">' + icon("menu") + "</button>"
      : '<button type="button" class="icon-button back-button" data-action="go-back" aria-label="返回">' + icon("arrow_back") + "</button>";
    return '<header class="top-app-bar">' + leading + '<h1>' + ui.escapeHtml(route.title) + '</h1><span class="top-bar-spacer" aria-hidden="true"></span></header>';
  }

  function bottomNav(activeRoot) {
    return '<nav class="bottom-nav" aria-label="插件主导航">' + BOTTOM_ROOTS.map(function (item) {
      const active = item.id === activeRoot;
      return '<button type="button" data-route="' + item.id + '" class="' + (active ? "active" : "") + '"' +
        (active ? ' aria-current="page"' : "") + '>' + icon(item.icon) + '<span>' + item.label + "</span></button>";
    }).join("") + "</nav>";
  }

  function shell(route, page, options) {
    const action = options && options.action ? '<div class="bottom-action">' + options.action + "</div>" : '<div class="bottom-action" hidden></div>';
    const drawer = ui.state.drawerOpen ? renderDrawer(route.owner) : "";
    return '<section class="app-screen" data-current-route="' + ui.escapeHtml(ui.state.route) + '">' +
      topBar(route) + '<main class="screen-scroll" tabindex="-1"><div class="route-content">' + page + "</div></main>" +
      action + bottomNav(route.owner) + drawer + "</section>";
  }

  function renderDrawer(activeRoot) {
    return '<div class="drawer-layer" data-action="close-drawer"><aside class="drawer" role="dialog" aria-modal="true" aria-label="页面导航" data-stop-close>' +
      '<div class="drawer-brand"><span class="brand-mark">MVU</span><div><strong>动态状态</strong><small>角色状态与规则工具</small></div></div>' +
      '<nav class="drawer-links">' + BOTTOM_ROOTS.map(function (item) {
        return '<button type="button" data-route="' + item.id + '" class="' + (item.id === activeRoot ? "active" : "") + '">' +
          icon(item.icon) + '<span>' + item.label + '</span>' + icon("chevron_right") + "</button>";
      }).join("") + "</nav>" +
      '<button type="button" class="drawer-close" data-action="close-drawer">' + icon("close") + "关闭</button>" +
      "</aside></div>";
  }

  function segmented(items, active, attribute, label) {
    return '<div class="segmented-control" role="tablist" aria-label="' + ui.escapeHtml(label || "切换内容") + '" style="--segments:' + items.length + '">' +
      items.map(function (item) {
        const selected = item.id === active;
        return '<button type="button" role="tab" aria-selected="' + selected + '" class="' + (selected ? "active" : "") + '" ' +
          attribute + '="' + ui.escapeHtml(item.id) + '">' + ui.escapeHtml(item.label) + "</button>";
      }).join("") + "</div>";
  }

  function emptyState(symbol, title, message, action) {
    return '<section class="empty-state">' + icon(symbol) + '<h2>' + ui.escapeHtml(title) + '</h2><p>' + ui.escapeHtml(message) + "</p>" +
      (action || "") + "</section>";
  }

  function recoveryState(error) {
    return '<section class="recovery-state" role="alert">' + icon("error") + '<h2>' + ui.escapeHtml(error.title) + '</h2><p>' +
      ui.escapeHtml(error.message) + '</p><button type="button" class="button secondary" data-action="retry">' + icon("refresh") +
      ui.escapeHtml(error.action) + "</button></section>";
  }

  function sectionHeading(title, description, trailing) {
    return '<header class="section-heading"><div><h2>' + ui.escapeHtml(title) + '</h2>' +
      (description ? '<p>' + ui.escapeHtml(description) + "</p>" : "") + '</div>' + (trailing || "") + "</header>";
  }

  function stateIcon(field, size) {
    return '<span class="state-icon ' + (size || "") + '" style="--field-color:' + safeColor(field.theme.color) + '">' +
      icon(field.theme.icon || "favorite") + "</span>";
  }

  function fieldCard(field, options) {
    const current = field.current;
    const value = current ? ui.formatNumber(current.value) : "—";
    const stage = current ? current.stage.name : "当前上下文未绑定";
    const action = options && options.action ? options.action : "open-field";
    return '<article class="field-summary-card" style="--field-color:' + safeColor(field.theme.color) + '">' +
      '<button type="button" class="field-summary-main" data-action="' + action + '" data-field-id="' + ui.escapeHtml(field.id) + '">' +
      stateIcon(field) + '<span class="field-copy"><strong>' + ui.escapeHtml(field.name) + '</strong><span>' + ui.escapeHtml(stage) +
      '</span></span><span class="field-value">' + value + '</span>' + icon("chevron_right") + "</button>" +
      '<div class="range-track" aria-label="' + ui.escapeHtml(field.name) + ' 当前值范围"><span style="width:' +
      percent(current ? current.value : field.range.minimum, field.range.minimum, field.range.maximum) + '%"></span></div></article>';
  }

  function actorSelector(actors, selectedId) {
    if (!actors.length) return "";
    return '<div class="identity-selector actor-selector" aria-label="选择角色">' + actors.map(function (actor) {
      const id = actor.characterId;
      const active = id === selectedId;
      return '<button type="button" class="identity-chip ' + (active ? "active" : "") + '" data-select-actor="' + ui.escapeHtml(id) + '"' +
        (active ? ' aria-current="true"' : "") + '><span class="avatar">' + avatar(actor.name, actor.avatarUri) + '</span><span>' +
        ui.escapeHtml(actor.name) + "</span></button>";
    }).join("") + "</div>";
  }

  function groupSelector(groups, selectedId) {
    if (!groups.length) return "";
    return '<div class="identity-selector group-selector" aria-label="选择群组">' + groups.map(function (group) {
      const id = group.characterGroupId;
      const active = id === selectedId;
      return '<button type="button" class="identity-chip ' + (active ? "active" : "") + '" data-select-group="' + ui.escapeHtml(id) + '"' +
        (active ? ' aria-current="true"' : "") + '><span class="avatar group-avatar">' + avatar(group.name, group.avatarUri) + '</span><span>' +
        ui.escapeHtml(group.name) + "</span></button>";
    }).join("") + "</div>";
  }

  function avatar(name, uri) {
    if (typeof uri === "string" && uri.length > 0) {
      return '<img src="' + ui.escapeHtml(uri) + '" alt="" />';
    }
    return '<span aria-hidden="true">' + ui.escapeHtml(Array.from(name || "?")[0] || "?") + "</span>";
  }

  function menuRow(iconName, title, description, route, meta) {
    return '<button type="button" class="menu-row" data-route="' + ui.escapeHtml(route) + '">' +
      '<span class="menu-row-icon">' + icon(iconName) + '</span><span><strong>' + ui.escapeHtml(title) + '</strong><small>' +
      ui.escapeHtml(description) + '</small></span>' + (meta ? '<em>' + ui.escapeHtml(meta) + "</em>" : "") + icon("chevron_right") + "</button>";
  }

  function listMeta(page, noun) {
    const start = page.loadedCount === 0 ? 0 : 1;
    return '<p class="list-meta" aria-live="polite">本页 ' + start + "–" + page.loadedCount + " / 共 " + page.totalCount + " " + ui.escapeHtml(noun) + "</p>";
  }

  function pagination(page, route, currentPage) {
    const pageNumber = currentPage || 1;
    return '<nav class="pagination" aria-label="分页"><button type="button" data-page="' + (pageNumber - 1) + '" data-page-route="' +
      ui.escapeHtml(route) + '"' + (pageNumber <= 1 ? " disabled" : "") + '>' + icon("chevron_left") + '上一页</button><span>第 ' +
      pageNumber + ' 页</span><button type="button" data-page="' + (pageNumber + 1) + '" data-page-route="' + ui.escapeHtml(route) + '"' +
      (!page.hasMore ? " disabled" : "") + '>下一页' + icon("chevron_right") + "</button></nav>";
  }

  function stagePalette(field) {
    const fallbacks = ["#8a8fe0", "#5b91ff", "#d45fe2", "#ff4f88", "#7058d8"];
    return field.stages.map(function (_stage, index) {
      return index === field.stages.length - 1 ? safeColor(field.themeColor) : fallbacks[index % fallbacks.length];
    });
  }

  function stageStrip(field, value, colors) {
    const stages = field.stages.slice().sort(function (a, b) { return a.threshold - b.threshold; });
    return '<article class="detail-card stage-card"><div class="card-heading"><strong>阶段</strong><span>' +
      ui.formatNumber(field.minimum) + " – " + ui.formatNumber(field.maximum) + '</span></div><div class="stage-labels">' +
      stages.map(function (stage, index) {
        const active = value >= stage.threshold && (index === stages.length - 1 || value < stages[index + 1].threshold);
        return '<span class="' + (active ? "active" : "") + '" style="--stage-color:' + colors[index] + '">' + ui.escapeHtml(stage.name) + "</span>";
      }).join("") + '</div><div class="stage-track">' + stages.map(function (stage, index) {
        return '<i style="left:' + percent(stage.threshold, field.minimum, field.maximum) + '%;--stage-color:' + colors[index] + '" aria-hidden="true"></i>';
      }).join("") + '<b style="left:' + percent(value, field.minimum, field.maximum) + '%" aria-label="当前值位置"></b></div><div class="stage-values">' +
      stages.map(function (stage) { return '<span>' + ui.formatNumber(stage.threshold) + "</span>"; }).join("") + "</div></article>";
  }

  function trendModel(field, records, colors) {
    return {
      minimum: field.minimum,
      maximum: field.maximum,
      thresholds: field.stages.map(function (stage) { return stage.threshold; }),
      colors: colors,
      points: records.slice().reverse().map(function (record) {
        return { value: record.after, occurredAt: record.occurredAt };
      }),
      color: safeColor(field.themeColor),
    };
  }

  function trendY(value, minimum, maximum, height, padding) {
    const ratio = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
    return height - padding - ratio * (height - padding * 2);
  }

  function drawTrend(canvas, model) {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(280, canvas.clientWidth || 320);
    const height = 146;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const padding = 18;
    model.thresholds.forEach(function (threshold, index) {
      const y = trendY(threshold, model.minimum, model.maximum, height, padding);
      context.strokeStyle = withAlpha(model.colors[index] || model.color, 0.22);
      context.lineWidth = 1;
      context.beginPath(); context.moveTo(padding, y); context.lineTo(width - padding, y); context.stroke();
    });
    const points = model.points.length ? model.points : [{ value: model.minimum, occurredAt: Date.now() }];
    const coordinates = points.map(function (point, index) {
      return {
        x: points.length === 1 ? width / 2 : padding + index * (width - padding * 2) / (points.length - 1),
        y: trendY(point.value, model.minimum, model.maximum, height, padding),
        value: point.value,
      };
    });
    context.strokeStyle = model.color;
    context.lineWidth = 2.5;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    coordinates.forEach(function (point, index) { if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); });
    context.stroke();
    coordinates.forEach(function (point) {
      context.fillStyle = "#ffffff"; context.strokeStyle = model.color; context.lineWidth = 2;
      context.beginPath(); context.arc(point.x, point.y, 3.5, 0, Math.PI * 2); context.fill(); context.stroke();
    });
    const last = coordinates[coordinates.length - 1];
    context.fillStyle = model.color;
    context.font = "600 12px system-ui, sans-serif";
    context.textAlign = last.x > width - 58 ? "right" : "left";
    context.fillText(ui.formatNumber(last.value), last.x + (last.x > width - 58 ? -7 : 7), Math.max(14, last.y - 8));
  }

  function trendCard(model, id) {
    ui.state.chartModels.set(id, model);
    return '<article class="detail-card trend-card"><div class="card-heading"><strong>趋势</strong><span>固定字段范围</span></div>' +
      '<canvas class="trend-canvas" role="img" aria-label="状态趋势，纵轴使用字段上下限" data-trend-id="' + ui.escapeHtml(id) + '"></canvas>' +
      '<div class="trend-range"><span>' + ui.formatNumber(model.minimum) + '</span><span>' + ui.formatNumber(model.maximum) + "</span></div></article>";
  }

  function recordRow(record) {
    const positive = record.delta >= 0;
    return '<article class="record-row"><span class="record-delta ' + (positive ? "positive" : "negative") + '">' +
      (positive ? "+" : "") + ui.formatNumber(record.delta) + '</span><span><strong>' + ui.escapeHtml(record.fieldName) + '</strong><small>' +
      ui.escapeHtml(record.reason || SOURCE_LABELS[record.source] || "状态变化") + '</small></span><time>' + ui.formatTime(record.occurredAt) + "</time></article>";
  }

  function safeColor(value) {
    return typeof value === "string" && /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(value) ? value : "#7058d8";
  }

  function withAlpha(color, alpha) {
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      const value = Math.round(alpha * 255).toString(16).padStart(2, "0");
      return color + value;
    }
    return "rgba(112,88,216," + alpha + ")";
  }

  function percent(value, minimum, maximum) {
    return Math.max(0, Math.min(100, (value - minimum) / (maximum - minimum) * 100));
  }

  Object.assign(ui.components, {
    BOTTOM_ROOTS,
    SCOPE_LABELS,
    SOURCE_LABELS,
    icon,
    shell,
    segmented,
    emptyState,
    recoveryState,
    sectionHeading,
    stateIcon,
    fieldCard,
    actorSelector,
    groupSelector,
    menuRow,
    listMeta,
    pagination,
    stagePalette,
    stageStrip,
    trendModel,
    trendY,
    drawTrend,
    trendCard,
    recordRow,
    safeColor,
  });
}(window.MvuUi));
