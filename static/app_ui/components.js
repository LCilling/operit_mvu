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
    const picker = ui.state.entityPicker ? renderEntityPicker(ui.state.entityPicker) : "";
    return '<section class="app-screen" data-current-route="' + ui.escapeHtml(ui.state.route) + '">' +
      topBar(route) + '<main class="screen-scroll" tabindex="-1"><div class="route-content">' + page + "</div></main>" +
      action + bottomNav(route.owner) + drawer + picker + "</section>";
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
    const group = segmentGroupId(label || "切换内容");
    const panelId = "segment-panel-" + group;
    return '<div class="segmented-control" role="tablist" aria-label="' + ui.escapeHtml(label || "切换内容") +
      '" style="--segments:' + items.length + ';--segment-transition:segment-' + group + '">' +
      items.map(function (item) {
        const selected = item.id === active;
        return '<button type="button" role="tab" id="segment-tab-' + group + '-' + ui.escapeHtml(item.id) + '" aria-controls="' + panelId +
          '" aria-selected="' + selected + '" tabindex="' + (selected ? "0" : "-1") + '" class="' + (selected ? "active" : "") + '" ' +
          attribute + '="' + ui.escapeHtml(item.id) + '">' + ui.escapeHtml(item.label) + "</button>";
      }).join("") + "</div>";
  }

  function segmentGroupId(label) {
    const known = { "状态范围": "status-scope", "变化方式": "change-mode", "原因模式": "reason-mode" };
    if (known[label]) return known[label];
    const value = String(label).normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return value || "content-mode";
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
    if (safeAvatarUri(uri)) {
      return '<img src="' + ui.escapeHtml(uri) + '" alt="" />';
    }
    return '<span aria-hidden="true">' + ui.escapeHtml(Array.from(name || "?")[0] || "?") + "</span>";
  }

  function safeAvatarUri(uri) {
    return typeof uri === "string" && uri.length <= 2048 &&
      (/^(?:content:\/\/|https?:\/\/)/i.test(uri) || /^data:image\/(?:png|jpeg|webp);base64,/i.test(uri));
  }

  function menuRow(iconName, title, description, route, meta) {
    return '<button type="button" class="menu-row" data-route="' + ui.escapeHtml(route) + '">' +
      '<span class="menu-row-icon">' + icon(iconName) + '</span><span><strong>' + ui.escapeHtml(title) + '</strong><small>' +
      ui.escapeHtml(description) + '</small></span>' + (meta ? '<em>' + ui.escapeHtml(meta) + "</em>" : "") + icon("chevron_right") + "</button>";
  }

  function listMeta(page, noun, currentPage, pageSize, totalCount, filtered) {
    const allCount = Number.isSafeInteger(totalCount) ? totalCount : page.totalCount;
    return '<p class="list-meta" aria-live="polite">已显示 ' + page.loadedCount + " " + noun + " / 匹配 " + page.totalCount +
      " " + noun + " / 共 " + allCount + " " + noun + "</p>";
  }

  function listViewFiltered(view) {
    if (!view) return false;
    if (typeof view.search === "string" && view.search.trim()) return true;
    return Boolean(view.filters && Object.keys(view.filters).length);
  }

  function pagination(page, route, currentPage) {
    const pageNumber = currentPage || 1;
    return '<nav class="pagination" aria-label="分页"><button type="button" data-page="' + (pageNumber - 1) + '" data-page-route="' +
      ui.escapeHtml(route) + '" data-page-direction="previous"' + (pageNumber <= 1 ? " disabled" : "") + '>' + icon("chevron_left") + '上一页</button><span>第 ' +
      pageNumber + ' 页</span><button type="button" data-page="' + (pageNumber + 1) + '" data-page-route="' + ui.escapeHtml(route) + '"' +
      ' data-page-direction="next"' + (!page.hasMore ? " disabled" : "") + '>下一页' + icon("chevron_right") + "</button></nav>";
  }

  function renderEntityPicker(picker) {
    const multiple = picker.mode === "multiple";
    const selectedIdList = Array.from(picker.selectedIds);
    const pinnedLimit = 12;
    const pinned = selectedIdList.slice(0, pinnedLimit).map(function (id) {
      const item = picker.selectedItems.get(id) || picker.itemById?.get(id) || picker.items.find(function (candidate) {
        return candidate[picker.definition.idKey] === id;
      });
      return '<span class="picker-pinned-item">' + icon("check_circle") + '<span>' +
        ui.escapeHtml(item ? item.name : "已选项目") + '</span><button type="button" data-picker-id="' + ui.escapeHtml(id) +
        '" aria-label="取消选择 ' + ui.escapeHtml(item ? item.name : "已选项目") + '">' + icon("close") + "</button></span>";
    }).join("");
    const pinnedOverflow = selectedIdList.length > pinnedLimit
      ? '<span class="picker-pinned-overflow" role="status" aria-label="另 ' + (selectedIdList.length - pinnedLimit) +
        ' 项已选择">另 ' + (selectedIdList.length - pinnedLimit) + " 项</span>"
      : "";
    const orderIds = Array.isArray(picker.orderIds)
      ? picker.orderIds
      : picker.items.map(function (item) { return item[picker.definition.idKey]; });
    const itemById = picker.itemById instanceof Map
      ? picker.itemById
      : new Map(picker.items.map(function (item) { return [item[picker.definition.idKey], item]; }));
    const resultIds = orderIds.filter(function (id) { return !picker.selectedIds.has(id); });
    const virtual = picker.virtualWindow || { start: 0, end: Math.min(resultIds.length, 24), rowHeight: 56 };
    const start = Math.max(0, Math.min(resultIds.length, virtual.start || 0));
    const end = Math.max(start, Math.min(resultIds.length, virtual.end === undefined ? start + 24 : virtual.end));
    const rows = resultIds.slice(start, end).map(function (resultId) {
      const item = itemById.get(resultId);
      if (!item) return "";
      const id = item[picker.definition.idKey];
      return '<button type="button" class="picker-result " role="option" aria-selected="false" data-picker-id="' +
        ui.escapeHtml(id) + '"><span class="picker-result-mark">' +
        icon(multiple ? "check_box_outline_blank" : "radio_button_unchecked") +
        '</span><span><strong>' + ui.escapeHtml(item.name) + '</strong><small>' + ui.escapeHtml(pickerItemSummary(picker.entity, item)) +
        "</small></span></button>";
    }).join("");
    const before = start > 0
      ? '<div class="picker-spacer" data-picker-spacer="before" aria-hidden="true" style="height:' + (start * virtual.rowHeight) + 'px"></div>'
      : "";
    const after = end < resultIds.length
      ? '<div class="picker-spacer" data-picker-spacer="after" aria-hidden="true" style="height:' + ((resultIds.length - end) * virtual.rowHeight) + 'px"></div>'
      : "";
    const error = picker.error
      ? '<div class="picker-error" role="alert"><span>' + ui.escapeHtml(picker.error) + '</span>' +
        (picker.errorRetryable === false ? "" : '<button type="button" data-action="retry-entity-picker">重试</button>') + "</div>"
      : "";
    const status = picker.loading && picker.items.length === 0
        ? '<div class="picker-skeleton" aria-label="正在搜索"><i></i><i></i><i></i></div>'
        : resultIds.length === 0
          ? '<p class="picker-empty">没有匹配项目，请调整搜索词。</p>'
          : before + rows + after;
    return '<div class="picker-layer" data-action="close-entity-picker"><section class="entity-picker' + (picker.opening ? " opening" : "") + '" role="dialog" aria-modal="true" aria-labelledby="entity-picker-title" data-stop-close>' +
      '<header><div><h2 id="entity-picker-title">' + ui.escapeHtml(picker.title) + '</h2><p>输入名称搜索，结果接近底部时自动继续读取。</p></div>' +
      '<button type="button" class="icon-button" data-action="close-entity-picker" aria-label="关闭选择框">' + icon("close") + "</button></header>" +
      '<label class="search-field full picker-search">' + icon("search") + '<input type="search" value="' + ui.escapeHtml(picker.search) +
      '" placeholder="搜索名称" aria-label="搜索' + ui.escapeHtml(picker.title) + '" data-picker-search autocomplete="off"></label>' +
      '<div data-picker-filter-region>' + renderPickerFilters(picker) + "</div>" +
      '<div data-picker-pinned-region>' + (pinned ? '<div class="picker-pinned"><div class="picker-pinned-heading"><strong>已选择 ' + picker.selectedIds.size + "</strong>" +
        pinnedOverflow + "</div><div>" + pinned + "</div></div>" : "") + "</div>" +
      '<div class="picker-results" role="listbox" aria-multiselectable="' + multiple + '" data-picker-results tabindex="0">' + error + status +
      (picker.loading && picker.items.length ? '<p class="picker-fetching" aria-live="polite">正在继续读取…</p>' : "") + "</div>" +
      '<footer data-picker-footer><span>已显示 ' + orderIds.length + " / 匹配 " + picker.totalCount + " / 共 " +
      (Number.isSafeInteger(picker.allTotalCount) ? picker.allTotalCount : picker.totalCount) + "</span><div>" +
      '<button type="button" class="button secondary" data-action="close-entity-picker">取消</button>' +
      (multiple ? '<button type="button" class="button primary" data-action="confirm-entity-picker">确认选择（' + picker.selectedIds.size + "）</button>" : "") +
      "</div></footer></section></div>";
  }

  function renderPickerFilters(picker) {
    const filters = picker.filters || {};
    if (picker.entity === "fields") {
      return '<div class="picker-filters" aria-label="字段筛选">' +
        pickerFilter("筛选字段作用域", "scope", filters.scope, [["", "全部作用域"], ["character", "角色"], ["group", "群组"], ["global", "全局"], ["chat", "会话"]]) +
        pickerFilter("筛选字段类型", "type", filters.type, [["", "全部类型"], ["full", "完整数值"], ["stage_only", "仅阶段"], ["hidden", "隐藏"]]) +
        pickerFilter("筛选启用状态", "enabled", filters.enabled, [["", "全部状态"], ["true", "已启用"], ["false", "已停用"]], "boolean") + "</div>";
    }
    if (picker.entity === "actors") {
      const groupId = ui.state.snapshot?.activeContext?.groupId || "";
      const groupLocked = picker.lockedFilterKeys instanceof Set && picker.lockedFilterKeys.has("groupId");
      return '<div class="picker-filters" aria-label="角色筛选">' +
        pickerFilter("筛选启用状态", "enabled", filters.enabled, [["", "全部状态"], ["true", "可用"], ["false", "已停用"]], "boolean") +
        (groupId ? pickerFilter("筛选成员范围", "groupId", filters.groupId,
          groupLocked ? [[groupId, "当前群成员"]] : [["", "全部角色"], [groupId, "当前群成员"]], "string", groupLocked) : "") + "</div>";
    }
    if (picker.entity === "groups") {
      const actorId = ui.state.snapshot?.activeContext?.actorId || "";
      return actorId ? '<div class="picker-filters" aria-label="群组筛选">' +
        pickerFilter("筛选成员范围", "actorId", filters.actorId, [["", "全部群组"], [actorId, "包含当前角色"]]) + "</div>" : "";
    }
    return "";
  }

  function pickerFilter(ariaLabel, key, current, options, valueType, disabled) {
    const value = current === undefined ? "" : String(current);
    return '<label><span class="visually-hidden">' + ariaLabel + '</span><select aria-label="' + ariaLabel + '" data-picker-filter="' + key + '"' +
      (valueType ? ' data-filter-value-type="' + valueType + '"' : "") + (disabled ? " disabled" : "") + '>' + options.map(function (option) {
        return '<option value="' + ui.escapeHtml(option[0]) + '"' + (value === option[0] ? " selected" : "") + '>' + ui.escapeHtml(option[1]) + "</option>";
      }).join("") + "</select></label>";
  }

  function pickerItemSummary(entity, item) {
    if (entity === "fields") return (SCOPE_LABELS[item.scope] || item.scope) + " · " + ui.formatNumber(item.minimum) + "–" + ui.formatNumber(item.maximum);
    if (entity === "actors") return item.enabled ? "可用角色" : "已停用角色";
    if (entity === "groups") return "角色群组";
    if (entity === "rules") return item.enabled ? "已启用规则" : "已停用规则";
    if (entity === "conditions") return item.enabled ? "已启用条件" : "已停用条件";
    if (entity === "effectGroups") return item.enabled ? "已启用效果组" : "已停用效果组";
    return item.description || "";
  }

  function stagePalette(field) {
    const fallbacks = ["#8a8fe0", "#5b91ff", "#d45fe2", "#ff4f88", "#7058d8"];
    return field.stages.map(function (_stage, index) {
      return index === field.stages.length - 1 ? safeColor(field.themeColor) : fallbacks[index % fallbacks.length];
    });
  }

  function stageStrip(field, value, colors) {
    const stages = field.stages.slice().sort(function (a, b) { return a.threshold - b.threshold; });
    const viewportWidth = typeof window !== "undefined" && Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 393;
    const computedBodySize = typeof window !== "undefined" && typeof window.getComputedStyle === "function" &&
      typeof document !== "undefined" && document.body ? Number.parseFloat(window.getComputedStyle(document.body).fontSize) : 14;
    const textScale = Number.isFinite(computedBodySize) && computedBodySize > 0 ? Math.max(0.75, Math.min(2, computedBodySize / 14)) : 1;
    const trackWidth = Math.max(160, viewportWidth - 74 * textScale);
    const markerWidth = Math.min(68 * textScale, Math.max(44 * textScale, viewportWidth * 0.18));
    const laneRightEdges = [];
    const layout = stages.map(function (stage) {
      const position = percent(stage.threshold, field.minimum, field.maximum);
      const positionPx = position / 100 * trackWidth;
      const nameWidth = Math.min(markerWidth, Math.max(22 * textScale, Array.from(stage.name || "").length * 11 * textScale));
      const thresholdWidth = Math.min(markerWidth, Math.max(18 * textScale, String(ui.formatNumber(stage.threshold)).length * 7 * textScale));
      const labelWidth = Math.max(nameWidth, thresholdWidth);
      const left = position <= 0 ? 0 : position >= 100 ? trackWidth - labelWidth : positionPx - labelWidth / 2;
      const right = left + labelWidth;
      let lane = laneRightEdges.findIndex(function (edge) { return edge + 4 * textScale <= left; });
      if (lane < 0) lane = laneRightEdges.length;
      laneRightEdges[lane] = right;
      return { stage, position, lane, laneOffset: lane * 18 };
    });
    const extraHeight = Math.max(0, laneRightEdges.length - 1) * 18;
    return '<article class="detail-card stage-card"><div class="card-heading"><strong>阶段</strong><span>' +
      ui.formatNumber(field.minimum) + " – " + ui.formatNumber(field.maximum) + '</span></div><div class="stage-map" style="--stage-extra-height:' + extraHeight + 'px"><div class="stage-track">' +
      layout.map(function (item, index) {
        const stage = item.stage;
        const active = value >= stage.threshold && (index === stages.length - 1 || value < stages[index + 1].threshold);
        const edge = index === 0 ? " edge-start" : index === stages.length - 1 ? " edge-end" : "";
        return '<span class="stage-marker' + (active ? " active" : "") + edge + '" style="--stage-position:' +
          item.position + '%;--stage-color:' + colors[index] + ';--stage-lane-offset:' + item.laneOffset + 'px" data-stage-lane="' +
          item.lane + '"><span class="stage-name">' + ui.escapeHtml(stage.name) + '</span><i aria-hidden="true"></i><span class="stage-threshold">' +
          ui.formatNumber(stage.threshold) + "</span></span>";
      }).join("") + '<b class="stage-current" style="--stage-position:' + percent(value, field.minimum, field.maximum) +
      '%" aria-label="当前值位置"></b></div></div></article>';
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
    listViewFiltered,
    pagination,
    renderEntityPicker,
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
