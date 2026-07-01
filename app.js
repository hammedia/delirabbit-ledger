(function () {
  "use strict";

  const STORE_KEY = "delirabbitLedger.v1";
  const LEGACY_STORE_KEYS = ["parcelLedger.v1"];
  const APP_SCHEMA_VERSION = 2;
  const BACKUP_TYPE = "delirabbit-ledger-profile";
  const LEGACY_BACKUP_TYPES = ["parcel-ledger-profile-v1"];
  const CURRENT_YEAR = new Date().getFullYear();
  const APP_FILES = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
    "./manifest.webmanifest",
    "./service-worker.js"
  ];

  const app = document.getElementById("app");
  let state = loadState();
  let view = "today";
  let unlockedProfileId = null;
  let draft = null;
  let undoState = null;
  let selectedMonth = monthValue(new Date());
  let flashText = "";

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js").catch(function () {});
  }

  function defaultState() {
    return {
      version: 1,
      activeProfileId: null,
      profiles: []
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) {
        const legacyRaw = LEGACY_STORE_KEYS.map(function (key) {
          return localStorage.getItem(key);
        }).find(Boolean);
        if (!legacyRaw) return defaultState();
        const legacyParsed = JSON.parse(legacyRaw);
        const migrated = {
          version: APP_SCHEMA_VERSION,
          activeProfileId: legacyParsed.activeProfileId || null,
          profiles: Array.isArray(legacyParsed.profiles) ? legacyParsed.profiles.map(normalizeProfile) : []
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(migrated));
        return migrated;
      }
      const parsed = JSON.parse(raw);
      return {
        version: APP_SCHEMA_VERSION,
        activeProfileId: parsed.activeProfileId || null,
        profiles: Array.isArray(parsed.profiles) ? parsed.profiles.map(normalizeProfile) : []
      };
    } catch (error) {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function activeProfile() {
    if (!state.activeProfileId && state.profiles.length) {
      state.activeProfileId = state.profiles[0].id;
      saveState();
    }
    return state.profiles.find(function (profile) {
      return profile.id === state.activeProfileId;
    }) || null;
  }

  function createSettings() {
    return {
      baseUnitPrice: 1300,
      defaultPerDeliveryExtra: 200,
      deductionRate: 3.3
    };
  }

  function createEmptyDraft(profile) {
    const settings = profile ? profile.settings : createSettings();
    return {
      id: "",
      date: dateValue(new Date()),
      workerName: profile ? profile.name : "",
      rawText: "",
      assignedCount: 0,
      deliveredCount: 0,
      returnCount: 0,
      undeliveredCount: 0,
      irregularCount: 0,
      statusText: "",
      baseUnitPrice: numberValue(settings.baseUnitPrice, 1300),
      perDeliveryExtra: 0,
      unitPrice: numberValue(settings.baseUnitPrice, 1300),
      allowanceItems: [],
      returnExtra: 0,
      undeliveredExtra: 0,
      irregularExtra: 0,
      memo: ""
    };
  }

  function ensureDraft(profile) {
    if (!draft) draft = createEmptyDraft(profile);
    return draft;
  }

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function rememberDraftUndo(message) {
    if (!draft) return;
    undoState = {
      type: "draft",
      draft: cloneData(draft),
      message: message || "이전 입력으로 되돌렸습니다."
    };
  }

  function rememberRecordsUndo(profile, message) {
    undoState = {
      type: "records",
      profileId: profile.id,
      records: cloneData(profile.records),
      draft: draft ? cloneData(draft) : null,
      message: message || "저장 전 상태로 되돌렸습니다."
    };
  }

  function undoLast(profile) {
    if (!undoState) {
      flash("되돌릴 내용이 없습니다.");
      return;
    }
    if (undoState.type === "draft") {
      draft = cloneData(undoState.draft);
      const message = undoState.message;
      undoState = null;
      flash(message);
      return;
    }
    if (undoState.type === "records") {
      const target = state.profiles.find(function (item) {
        return item.id === undoState.profileId;
      });
      if (!target) {
        undoState = null;
        flash("되돌릴 사용자를 찾지 못했습니다.");
        return;
      }
      target.records = cloneData(undoState.records);
      target.updatedAt = nowIso();
      draft = undoState.draft ? cloneData(undoState.draft) : createEmptyDraft(profile);
      const message = undoState.message;
      undoState = null;
      saveState();
      flash(message);
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function id() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function dateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function monthValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function numberValue(value, fallback) {
    if (value == null || String(value).trim() === "") return fallback;
    const number = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(number) ? number : fallback;
  }

  function integerValue(value) {
    return Math.max(0, Math.floor(numberValue(value, 0)));
  }

  function money(value) {
    return Math.round(numberValue(value, 0)).toLocaleString("ko-KR") + "원";
  }

  function safeFileName(value) {
    return String(value || "user")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_") || "user";
  }

  async function hashPin(pin, salt) {
    const text = `${salt}:${pin}`;
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      const bytes = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    }

    let hash = 5381;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) + hash) + text.charCodeAt(index);
      hash = hash & hash;
    }
    return String(hash >>> 0);
  }

  function computeAmounts(record) {
    const delivered = integerValue(record.deliveredCount);
    const unitPrice = numberValue(record.unitPrice, 0);
    const baseAmount = delivered * unitPrice;
    const extraAmount = allowanceItemsFor(record).reduce(function (sum, item) {
      return sum + numberValue(item.amount, 0);
    }, 0);
    return {
      baseAmount,
      extraAmount,
      grossAmount: baseAmount + extraAmount
    };
  }

  function createAllowanceItem(label) {
    return {
      label: label || "직접 입력",
      count: 1,
      unitPrice: 0,
      amount: 0,
      memo: ""
    };
  }

  function allowanceItemsFor(record) {
    const source = record || {};
    if (Array.isArray(source.allowanceItems)) {
      return source.allowanceItems.map(normalizeAllowanceItem).filter(hasAllowanceValue);
    }
    return legacyAllowanceItems(source);
  }

  function draftAllowanceItemsFor(record) {
    const source = record || {};
    if (Array.isArray(source.allowanceItems)) {
      return source.allowanceItems.map(normalizeAllowanceItem);
    }
    return legacyAllowanceItems(source);
  }

  function legacyAllowanceItems(record) {
    return [
      { label: "반품", amount: numberValue(record.returnExtra, 0) },
      { label: "미배송", amount: numberValue(record.undeliveredExtra, 0) },
      { label: "이형물품", amount: numberValue(record.irregularExtra, 0) }
    ].filter(function (item) {
      return item.amount > 0;
    }).map(function (item) {
      return {
        label: item.label,
        count: 0,
        unitPrice: 0,
        amount: item.amount,
        memo: "구버전 추가금"
      };
    });
  }

  function normalizeAllowanceItem(item) {
    const source = item || {};
    const count = numberValue(source.count, numberValue(source.quantity, 0));
    const unitPrice = numberValue(source.unitPrice, 0);
    const computedAmount = count * unitPrice;
    return {
      label: String(source.label || source.name || "직접 입력").trim() || "직접 입력",
      count,
      unitPrice,
      amount: numberValue(source.amount, computedAmount),
      memo: String(source.memo || "").trim()
    };
  }

  function hasAllowanceValue(item) {
    const label = String(item.label || "").trim();
    return (label && label !== "직접 입력") || numberValue(item.unitPrice, 0) > 0 || numberValue(item.amount, 0) > 0 || Boolean(item.memo);
  }

  function allowanceSummary(record) {
    const items = allowanceItemsFor(record);
    if (!items.length) return "";
    return items.map(function (item) {
      return `${item.label} ${money(item.amount)}`;
    }).join(" · ");
  }

  function recordMonths(profile) {
    const months = new Set();
    (profile.records || []).forEach(function (record) {
      if (record.date && record.date.length >= 7) months.add(record.date.slice(0, 7));
    });
    return Array.from(months).sort().reverse();
  }

  function monthLabel(month) {
    const parts = String(month || "").split("-");
    if (parts.length !== 2) return month;
    return `${Number(parts[0])}년 ${Number(parts[1])}월`;
  }

  function parseKakaoText(rawText, profileName) {
    const rawLines = String(rawText || "").replace(/\r/g, "\n").split("\n");
    const lines = rawLines.map(function (line) {
      return line.trim();
    }).filter(Boolean);

    let date = "";
    let dateIndex = -1;

    for (let index = 0; index < lines.length; index += 1) {
      const parsedDate = parseDateLine(lines[index]);
      if (parsedDate) {
        date = parsedDate;
        dateIndex = index;
        break;
      }
    }

    let workerName = profileName || "";
    if (dateIndex >= 0) {
      const candidate = lines[dateIndex + 1] || "";
      if (candidate && !looksLikeCountLine(candidate) && !parseDateLine(candidate)) {
        workerName = candidate.replace(/[*:：]/g, "").trim();
      }
    }

    const assignedCount = findCount(lines, ["배정건수", "배정"]);
    const deliveredCount = findCount(lines, ["배송건수"]);
    const returnCount = findCount(lines, ["반품건수", "반품"]);
    const undeliveredCount = findCount(lines, ["미배송건수", "미배송"]);
    const irregularCount = findCount(lines, ["이형물품건수", "이형물품", "이형"]);
    const statusText = findStatusText(lines, dateIndex);

    return {
      date: date || dateValue(new Date()),
      workerName,
      assignedCount,
      deliveredCount,
      returnCount,
      undeliveredCount,
      irregularCount,
      statusText
    };
  }

  function parseDateLine(line) {
    const text = String(line || "").trim();
    let match = text.match(/^(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
    if (match) {
      return normalizeDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }
    match = text.match(/^(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\s|$)/);
    if (match) {
      return normalizeDate(CURRENT_YEAR, Number(match[1]), Number(match[2]));
    }
    return "";
  }

  function normalizeDate(year, month, day) {
    if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
      return "";
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function compact(value) {
    return String(value || "").replace(/\s/g, "");
  }

  function looksLikeCountLine(line) {
    const clean = compact(line);
    return /(배정|배송건수|반품|미배송|이형)/.test(clean);
  }

  function findCount(lines, labels) {
    for (const line of lines) {
      const cleanLine = compact(line);
      for (const label of labels) {
        const cleanLabel = compact(label);
        const position = cleanLine.indexOf(cleanLabel);
        if (position < 0) continue;
        const valuePart = cleanLine.slice(position + cleanLabel.length).replace(/^[:：*]+/, "");
        const match = valuePart.match(/\d+/);
        return match ? Number(match[0]) : 0;
      }
    }
    return 0;
  }

  function findStatusText(lines, dateIndex) {
    const candidates = lines.filter(function (line, index) {
      if (index === dateIndex || index === dateIndex + 1) return false;
      if (looksLikeCountLine(line)) return false;
      if (parseDateLine(line)) return false;
      return /완료|배송|마감|확인|종료/.test(line);
    });
    return candidates.length ? candidates[candidates.length - 1] : "";
  }

  function render() {
    const profile = activeProfile();
    if (!state.profiles.length) {
      renderCreateOnly();
      return;
    }
    if (!profile) {
      view = "profiles";
      renderProfiles();
      return;
    }
    if (profile.pinHash && unlockedProfileId !== profile.id && view !== "profiles") {
      renderLock(profile);
      return;
    }
    renderShell(profile);
  }

  function renderCreateOnly() {
    app.innerHTML = `
      <main class="lock-card">
        <section class="panel lock-inner">
          <h1 class="panel-title">딜리래빗 정산 기록</h1>
          ${helpDropdown()}
          ${createProfileForm()}
        </section>
      </main>
    `;
    bindCreateProfileForm();
  }

  function renderLock(profile) {
    app.innerHTML = `
      <main class="lock-card">
        <section class="panel lock-inner">
          <div class="panel-heading">
            <h1 class="panel-title">${escapeHtml(profile.name)}</h1>
            <button class="ghost-button" type="button" data-view="profiles">사용자</button>
          </div>
          ${helpDropdown()}
          <form id="unlock-form" class="grid">
            <label>PIN
              <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required />
            </label>
            <button class="primary-button" type="submit">잠금 해제</button>
          </form>
          <p class="status-line ${flashText ? "is-visible" : ""}">${escapeHtml(flashText)}</p>
        </section>
      </main>
    `;
    bindGlobalButtons();
    const form = document.getElementById("unlock-form");
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const pin = new FormData(form).get("pin");
      const hashed = await hashPin(pin, profile.pinSalt);
      if (hashed === profile.pinHash) {
        unlockedProfileId = profile.id;
        flash("잠금 해제되었습니다.");
      } else {
        flash("PIN을 확인해 주세요.");
      }
    });
  }

  function renderShell(profile) {
    let content = "";
    if (view === "profiles") content = profilesView();
    if (view === "today") content = todayView(profile);
    if (view === "month") content = monthView(profile);
    if (view === "settings") content = settingsView(profile);

    app.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <h1 class="brand-title">딜리래빗 정산 기록</h1>
          <div class="brand-subtitle">${escapeHtml(profile.name)}</div>
        </div>
        <button class="pill-button" type="button" data-action="lock" ${profile.pinHash ? "" : "disabled"}>${profile.pinHash ? "잠금" : "PIN 없음"}</button>
      </header>
      <nav class="tabs" aria-label="화면 선택">
        ${tabButton("today", "오늘")}
        ${tabButton("month", "월 정산")}
        ${tabButton("profiles", "사용자")}
        ${tabButton("settings", "설정")}
      </nav>
      ${helpDropdown()}
      <main class="view">${content}</main>
    `;

    bindGlobalButtons();
    if (view === "profiles") bindCreateProfileForm();
    if (view === "today") bindTodayView(profile);
    if (view === "month") bindMonthView(profile);
    if (view === "settings") bindSettingsView(profile);
  }

  function tabButton(target, label) {
    return `<button class="tab-button ${view === target ? "is-active" : ""}" type="button" data-view="${target}">${label}</button>`;
  }

  function helpDropdown() {
    return `
      <details class="help-dropdown">
        <summary>사용방법</summary>
        <div class="help-content">
          <ol>
            <li>카톡 보고 문자를 복사해서 오늘 화면에 붙여넣습니다.</li>
            <li>자동 읽기를 누른 뒤 숫자가 맞는지 확인합니다.</li>
            <li>기본 단가에 더 붙는 돈은 건당 추가금에 적습니다.</li>
            <li>이형, 반품, 미배송, 특수 수당은 항목을 추가해서 적습니다.</li>
            <li>월 정산에서 이번 달 예상 수령액을 확인합니다.</li>
          </ol>
          <p>버그가 있거나 숫자가 이상하면 함동민에게 카톡 주세요.</p>
        </div>
      </details>
    `;
  }

  function createProfileForm() {
    return `
      <form id="create-profile-form" class="grid">
        <label>사용자 이름
          <input name="name" type="text" autocomplete="name" required />
        </label>
        <label class="check-row">
          <input name="usePin" type="checkbox" />
          PIN 잠금 사용
        </label>
        <label>PIN
          <input name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" />
        </label>
        <button class="primary-button" type="submit">새 사용자 만들기</button>
      </form>
    `;
  }

  function profilesView() {
    const rows = state.profiles.map(function (profile) {
      const count = profile.records.length;
      const active = profile.id === state.activeProfileId;
      return `
        <div class="profile-row">
          <div>
            <div class="profile-name">${escapeHtml(profile.name)} ${active ? '<span class="badge">사용 중</span>' : ""}</div>
            <div class="profile-meta">${count}일 기록 · ${profile.pinHash ? "PIN 사용" : "PIN 없음"}</div>
          </div>
          <button class="ghost-button" type="button" data-action="select-profile" data-id="${escapeHtml(profile.id)}">선택</button>
        </div>
      `;
    }).join("");

    return `
      <section class="panel">
        <h2 class="panel-title">사용자</h2>
        <div class="profile-list">${rows}</div>
      </section>
      <section class="panel">
        <h2 class="panel-title">새 사용자</h2>
        ${createProfileForm()}
      </section>
      <p class="status-line ${flashText ? "is-visible" : ""}">${escapeHtml(flashText)}</p>
    `;
  }

  function todayView(profile) {
    const currentDraft = ensureDraft(profile);
    const amounts = computeAmounts(currentDraft);
    return `
      <section class="panel">
        <div class="panel-heading">
          <h2 class="panel-title">오늘 기록</h2>
          <div class="actions compact-actions">
            <button class="ghost-button" type="button" data-action="undo-last" ${undoState ? "" : "disabled"}>되돌리기</button>
            <button class="ghost-button" type="button" data-action="new-draft">새로 입력</button>
          </div>
        </div>
        <label>카톡 텍스트
          <textarea id="rawText" data-draft="rawText">${escapeHtml(currentDraft.rawText)}</textarea>
        </label>
        <div class="actions">
          <button class="primary-button" type="button" data-action="parse-text">자동 읽기</button>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel-title">자동으로 읽은 결과</h2>
        <div class="grid two">
          <label>날짜
            <input type="date" data-draft="date" value="${escapeHtml(currentDraft.date)}" />
          </label>
          <label>이름
            <input type="text" data-draft="workerName" value="${escapeHtml(currentDraft.workerName)}" />
          </label>
          <label>배정건수
            <input type="number" min="0" inputmode="numeric" data-draft="assignedCount" value="${escapeHtml(currentDraft.assignedCount)}" />
          </label>
          <label>배송건수
            <input type="number" min="0" inputmode="numeric" data-draft="deliveredCount" value="${escapeHtml(currentDraft.deliveredCount)}" />
          </label>
          <label>반품건수
            <input type="number" min="0" inputmode="numeric" data-draft="returnCount" value="${escapeHtml(currentDraft.returnCount)}" />
          </label>
          <label>미배송건수
            <input type="number" min="0" inputmode="numeric" data-draft="undeliveredCount" value="${escapeHtml(currentDraft.undeliveredCount)}" />
          </label>
          <label>이형물품건수
            <input type="number" min="0" inputmode="numeric" data-draft="irregularCount" value="${escapeHtml(currentDraft.irregularCount)}" />
          </label>
          <label>상태
            <input type="text" data-draft="statusText" value="${escapeHtml(currentDraft.statusText)}" />
          </label>
        </div>
      </section>

      <section class="panel">
        <h2 class="panel-title">금액</h2>
        <div class="grid three">
          <label>기본 단가
            <input type="number" min="0" inputmode="numeric" data-draft="baseUnitPrice" value="${escapeHtml(currentDraft.baseUnitPrice)}" />
          </label>
          <label>건당 추가금
            <input type="number" min="0" inputmode="numeric" data-draft="perDeliveryExtra" value="${escapeHtml(currentDraft.perDeliveryExtra)}" />
          </label>
          <label>적용 단가
            <input type="number" min="0" inputmode="numeric" data-draft="unitPrice" value="${escapeHtml(currentDraft.unitPrice)}" readonly />
          </label>
        </div>
        <div class="actions">
          <button class="ghost-button" type="button" data-action="apply-default-extra">추가금 기본값 넣기</button>
        </div>
        <div class="allowance-block">
          <div class="section-heading">
            <h3>추가 수당</h3>
            <button class="ghost-button" type="button" data-action="add-allowance">항목 추가</button>
          </div>
          <datalist id="allowance-presets">
            <option value="이형 1"></option>
            <option value="이형 2"></option>
            <option value="반품"></option>
            <option value="미배송"></option>
            <option value="특수 수당"></option>
            <option value="건당 외 추가"></option>
            <option value="직접 입력"></option>
          </datalist>
          <div class="allowance-list">
            ${allowanceRowsHtml(currentDraft)}
          </div>
        </div>
        <div class="summary-grid" id="today-summary">
          ${todaySummaryHtml(currentDraft, amounts)}
        </div>
        <label>메모
          <input type="text" data-draft="memo" value="${escapeHtml(currentDraft.memo)}" />
        </label>
        <div class="actions">
          <button class="primary-button" type="button" data-action="save-record">저장</button>
        </div>
      </section>
      <p class="status-line ${flashText ? "is-visible" : ""}">${escapeHtml(flashText)}</p>
    `;
  }

  function allowanceRowsHtml(record) {
    const items = draftAllowanceItemsFor(record);
    if (!items.length) {
      return '<div class="empty compact-empty">추가 수당이 있으면 항목을 추가하세요.</div>';
    }
    return items.map(function (item, index) {
      return `
        <div class="allowance-row" data-allowance-index="${index}">
          <label>항목
            <input type="text" list="allowance-presets" data-allowance-field="label" value="${escapeHtml(item.label)}" />
          </label>
          <label>건수
            <input type="number" min="0" step="0.1" inputmode="decimal" data-allowance-field="count" value="${escapeHtml(item.count)}" />
          </label>
          <label>단가
            <input type="number" min="0" inputmode="numeric" data-allowance-field="unitPrice" value="${escapeHtml(item.unitPrice)}" />
          </label>
          <label>금액
            <input type="number" min="0" inputmode="numeric" data-allowance-field="amount" value="${escapeHtml(item.amount)}" />
          </label>
          <button class="danger-button allowance-remove" type="button" data-action="remove-allowance" data-index="${index}">삭제</button>
        </div>
      `;
    }).join("");
  }

  function todaySummaryHtml(record, amounts) {
    return `
      <div class="metric"><span>배송 기준</span><strong>${integerValue(record.deliveredCount).toLocaleString("ko-KR")}건</strong></div>
      <div class="metric"><span>기본 수입</span><strong>${money(amounts.baseAmount)}</strong></div>
      <div class="metric"><span>추가 수입</span><strong>${money(amounts.extraAmount)}</strong></div>
      <div class="metric total"><span>일일 총액</span><strong>${money(amounts.grossAmount)}</strong></div>
    `;
  }

  function monthView(profile) {
    const months = recordMonths(profile);
    if (months.length && !months.includes(selectedMonth)) {
      selectedMonth = months[0];
    }
    const records = profile.records
      .filter(function (record) { return record.date && record.date.slice(0, 7) === selectedMonth; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
    const totals = records.reduce(function (acc, record) {
      const amounts = computeAmounts(record);
      acc.days += 1;
      acc.delivered += integerValue(record.deliveredCount);
      acc.base += amounts.baseAmount;
      acc.extra += amounts.extraAmount;
      acc.gross += amounts.grossAmount;
      return acc;
    }, { days: 0, delivered: 0, base: 0, extra: 0, gross: 0 });
    const rate = numberValue(profile.settings.deductionRate, 3.3) / 100;
    const deduction = totals.gross * rate;
    const net = totals.gross - deduction;
    const rows = records.map(function (record) {
      const amounts = computeAmounts(record);
      const extras = allowanceSummary(record);
      return `
        <div class="record-row">
          <div class="record-top">
            <div class="record-title">${escapeHtml(record.date)} ${numberValue(record.perDeliveryExtra, 0) > 0 ? '<span class="badge">건당 추가</span>' : ""}</div>
            <button class="ghost-button" type="button" data-action="edit-record" data-id="${escapeHtml(record.id)}">수정</button>
          </div>
          <div class="amount-line">
            <span>배송 ${integerValue(record.deliveredCount).toLocaleString("ko-KR")}건</span>
            ${numberValue(record.perDeliveryExtra, 0) > 0 ? `<span>건당 추가 ${money(record.perDeliveryExtra)}</span>` : ""}
            <span>기본 ${money(amounts.baseAmount)}</span>
            <span>추가 ${money(amounts.extraAmount)}</span>
            <span>총액 ${money(amounts.grossAmount)}</span>
          </div>
          ${extras ? `<div class="record-meta">추가 수당: ${escapeHtml(extras)}</div>` : ""}
          ${record.memo ? `<div class="record-meta">${escapeHtml(record.memo)}</div>` : ""}
        </div>
      `;
    }).join("");

    return `
      <section class="panel">
        <div class="panel-heading">
          <h2 class="panel-title">월 정산</h2>
          <label>월
            <input id="month-picker" type="month" value="${escapeHtml(selectedMonth)}" />
          </label>
        </div>
        ${months.length ? `
          <div class="month-shortcuts">
            ${months.map(function (month) {
              return `<button class="month-chip ${month === selectedMonth ? "is-active" : ""}" type="button" data-action="select-month" data-month="${escapeHtml(month)}">${escapeHtml(monthLabel(month))}</button>`;
            }).join("")}
          </div>
        ` : ""}
        <div class="summary-grid">
          <div class="metric"><span>근무일수</span><strong>${totals.days.toLocaleString("ko-KR")}일</strong></div>
          <div class="metric"><span>총 배송건수</span><strong>${totals.delivered.toLocaleString("ko-KR")}건</strong></div>
          <div class="metric"><span>총 기본 수입</span><strong>${money(totals.base)}</strong></div>
          <div class="metric"><span>총 추가 수입</span><strong>${money(totals.extra)}</strong></div>
          <div class="metric total"><span>총액</span><strong>${money(totals.gross)}</strong></div>
          <div class="metric"><span>${numberValue(profile.settings.deductionRate, 3.3)}% 공제액</span><strong>${money(deduction)}</strong></div>
          <div class="metric net"><span>예상 수령액</span><strong>${money(net)}</strong></div>
        </div>
      </section>
      <section class="panel">
        <h2 class="panel-title">일별 상세</h2>
        <div class="record-list">${rows || '<div class="empty">기록 없음</div>'}</div>
      </section>
    `;
  }

  function settingsView(profile) {
    const hasPin = Boolean(profile.pinHash);
    return `
      <section class="panel">
        <h2 class="panel-title">설정</h2>
        <form id="settings-form" class="grid">
          <div class="grid two">
            <label>기본 단가
              <input name="baseUnitPrice" type="number" min="0" inputmode="numeric" value="${escapeHtml(profile.settings.baseUnitPrice)}" />
            </label>
            <label>건당 추가금 기본값
              <input name="defaultPerDeliveryExtra" type="number" min="0" inputmode="numeric" value="${escapeHtml(profile.settings.defaultPerDeliveryExtra)}" />
            </label>
            <label>공제율
              <input name="deductionRate" type="number" min="0" step="0.1" inputmode="decimal" value="${escapeHtml(profile.settings.deductionRate)}" />
            </label>
          </div>
          <button class="primary-button" type="submit">설정 저장</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <h2 class="panel-title">PIN</h2>
          <span class="badge">${hasPin ? "사용 중" : "사용 안 함"}</span>
        </div>
        <form id="pin-form" class="grid">
          <label>새 PIN
            <input name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" />
          </label>
          <div class="actions">
            <button class="ghost-button" type="submit">${hasPin ? "PIN 변경" : "PIN 켜기"}</button>
            ${hasPin ? '<button class="danger-button" type="button" data-action="disable-pin">PIN 끄기</button>' : ""}
          </div>
        </form>
      </section>
      <section class="panel">
        <h2 class="panel-title">백업</h2>
        <div class="actions">
          <button class="primary-button" type="button" data-action="backup-json">JSON 백업</button>
          <label class="file-action">JSON 복원
            <input id="restore-file" type="file" accept="application/json,.json" />
          </label>
        </div>
      </section>
      <p class="status-line ${flashText ? "is-visible" : ""}">${escapeHtml(flashText)}</p>
    `;
  }

  function bindGlobalButtons() {
    app.querySelectorAll("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () {
        view = button.dataset.view;
        flashText = "";
        render();
      });
    });

    app.querySelectorAll("[data-action='lock']").forEach(function (button) {
      button.addEventListener("click", function () {
        unlockedProfileId = null;
        flashText = "";
        render();
      });
    });

    app.querySelectorAll("[data-action='select-profile']").forEach(function (button) {
      button.addEventListener("click", function () {
        state.activeProfileId = button.dataset.id;
        unlockedProfileId = null;
        draft = null;
        view = "today";
        saveState();
        render();
      });
    });
  }

  function bindCreateProfileForm() {
    const forms = app.querySelectorAll("#create-profile-form");
    forms.forEach(function (form) {
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        const data = new FormData(form);
        const name = String(data.get("name") || "").trim();
        const usePin = data.get("usePin") === "on";
        const pin = String(data.get("pin") || "").trim();
        if (!name) {
          flash("사용자 이름을 입력해 주세요.");
          return;
        }
        if (usePin && pin.length < 4) {
          flash("PIN은 4자리 이상으로 입력해 주세요.");
          return;
        }
        const salt = usePin ? id() : "";
        const profile = {
          schemaVersion: APP_SCHEMA_VERSION,
          id: id(),
          name,
          pinSalt: salt,
          pinHash: usePin ? await hashPin(pin, salt) : "",
          settings: createSettings(),
          records: [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        state.profiles.push(profile);
        state.activeProfileId = profile.id;
        unlockedProfileId = profile.id;
        draft = createEmptyDraft(profile);
        view = "today";
        saveState();
        flash("사용자가 만들어졌습니다.");
      });
    });
  }

  function bindTodayView(profile) {
    app.querySelectorAll("[data-draft]").forEach(function (input) {
      const eventName = input.type === "checkbox" ? "change" : "input";
      input.addEventListener(eventName, function () {
        updateDraftFromInputs(profile);
        if (input.dataset.draft === "baseUnitPrice" || input.dataset.draft === "perDeliveryExtra") {
          updateAppliedUnitPrice();
        }
        updateTodaySummary();
      });
    });
    bindAllowanceInputs(profile);

    const parseButton = app.querySelector("[data-action='parse-text']");
    parseButton.addEventListener("click", function () {
      updateDraftFromInputs(profile);
      syncAllowanceItemsFromInputs(profile);
      rememberDraftUndo("자동 읽기 전으로 되돌렸습니다.");
      const parsed = parseKakaoText(draft.rawText, profile.name);
      draft = Object.assign({}, draft, parsed);
      flash("자동 읽기 완료");
    });

    const saveButton = app.querySelector("[data-action='save-record']");
    saveButton.addEventListener("click", function () {
      updateDraftFromInputs(profile);
      updateAppliedUnitPrice();
      syncAllowanceItemsFromInputs(profile);
      if (!confirmZeroDeliverySave(draft)) {
        flash("배송건수를 확인해 주세요.");
        focusDraftInput("deliveredCount");
        return;
      }
      saveRecord(profile);
    });

    const newButton = app.querySelector("[data-action='new-draft']");
    newButton.addEventListener("click", function () {
      updateDraftFromInputs(profile);
      updateAppliedUnitPrice();
      syncAllowanceItemsFromInputs(profile);
      rememberDraftUndo("새로 입력 전으로 되돌렸습니다.");
      draft = createEmptyDraft(profile);
      flashText = "";
      render();
    });

    const undoButton = app.querySelector("[data-action='undo-last']");
    undoButton.addEventListener("click", function () {
      undoLast(profile);
    });

    const defaultExtraButton = app.querySelector("[data-action='apply-default-extra']");
    defaultExtraButton.addEventListener("click", function () {
      updateDraftFromInputs(profile);
      syncAllowanceItemsFromInputs(profile);
      rememberDraftUndo("건당 추가금 적용 전으로 되돌렸습니다.");
      draft.perDeliveryExtra = numberValue(profile.settings.defaultPerDeliveryExtra, 0);
      updateAppliedUnitPrice();
      flash("건당 추가금 기본값을 넣었습니다.");
    });
  }

  function bindAllowanceInputs(profile) {
    app.querySelectorAll("[data-allowance-field]").forEach(function (input) {
      input.addEventListener("input", function () {
        if (input.dataset.allowanceField === "count" || input.dataset.allowanceField === "unitPrice") {
          updateAllowanceRowAmount(input);
        }
        syncAllowanceItemsFromInputs(profile);
        updateTodaySummary();
      });
    });

    const addButton = app.querySelector("[data-action='add-allowance']");
    addButton.addEventListener("click", function () {
      updateDraftFromInputs(profile);
      syncAllowanceItemsFromInputs(profile);
      rememberDraftUndo("수당 항목 추가 전으로 되돌렸습니다.");
      draft.allowanceItems = draftAllowanceItemsFor(draft);
      draft.allowanceItems.push(createAllowanceItem());
      flash("수당 항목을 추가했습니다.");
    });

    app.querySelectorAll("[data-action='remove-allowance']").forEach(function (button) {
      button.addEventListener("click", function () {
        updateDraftFromInputs(profile);
        syncAllowanceItemsFromInputs(profile);
        rememberDraftUndo("수당 항목 삭제 전으로 되돌렸습니다.");
        const index = Number(button.dataset.index);
        draft.allowanceItems = draftAllowanceItemsFor(draft).filter(function (item, itemIndex) {
          return itemIndex !== index;
        });
        flash("수당 항목을 삭제했습니다.");
      });
    });
  }

  function updateAllowanceRowAmount(input) {
    const row = input.closest("[data-allowance-index]");
    if (!row) return;
    const countInput = row.querySelector("[data-allowance-field='count']");
    const unitInput = row.querySelector("[data-allowance-field='unitPrice']");
    const amountInput = row.querySelector("[data-allowance-field='amount']");
    if (!countInput || !unitInput || !amountInput) return;
    amountInput.value = String(numberValue(countInput.value, 0) * numberValue(unitInput.value, 0));
  }

  function syncAllowanceItemsFromInputs(profile) {
    const current = ensureDraft(profile);
    current.allowanceItems = Array.from(app.querySelectorAll("[data-allowance-index]")).map(function (row) {
      return normalizeAllowanceItem({
        label: valueFromAllowanceRow(row, "label"),
        count: valueFromAllowanceRow(row, "count"),
        unitPrice: valueFromAllowanceRow(row, "unitPrice"),
        amount: valueFromAllowanceRow(row, "amount")
      });
    });
    draft = current;
  }

  function updateAppliedUnitPrice() {
    if (!draft) return;
    draft.baseUnitPrice = numberValue(draft.baseUnitPrice, 0);
    draft.perDeliveryExtra = numberValue(draft.perDeliveryExtra, 0);
    draft.unitPrice = draft.baseUnitPrice + draft.perDeliveryExtra;
    const unitInput = app.querySelector("[data-draft='unitPrice']");
    if (unitInput) unitInput.value = String(draft.unitPrice);
  }

  function valueFromAllowanceRow(row, field) {
    const input = row.querySelector(`[data-allowance-field='${field}']`);
    return input ? input.value : "";
  }

  function updateDraftFromInputs(profile) {
    const current = ensureDraft(profile);
    app.querySelectorAll("[data-draft]").forEach(function (input) {
      const key = input.dataset.draft;
      if (input.type === "checkbox") {
        current[key] = input.checked;
      } else if (input.type === "number") {
        current[key] = numberValue(input.value, 0);
      } else {
        current[key] = input.value;
      }
    });
    draft = current;
  }

  function updateTodaySummary() {
    const summary = document.getElementById("today-summary");
    if (!summary) return;
    summary.innerHTML = todaySummaryHtml(draft, computeAmounts(draft));
  }

  function confirmZeroDeliverySave(record) {
    if (integerValue(record.deliveredCount) > 0) return true;
    const assigned = integerValue(record.assignedCount);
    const assignedText = assigned > 0 ? `\n배정건수는 ${assigned.toLocaleString("ko-KR")}건입니다.` : "";
    return window.confirm(`배송건수가 0건입니다.${assignedText}\n0건으로 저장하면 금액도 0원으로 계산됩니다.\n그래도 저장할까요?`);
  }

  function focusDraftInput(key) {
    window.setTimeout(function () {
      const input = app.querySelector(`[data-draft='${key}']`);
      if (!input) return;
      input.focus();
      input.scrollIntoView({ block: "center" });
    }, 0);
  }

  function saveRecord(profile) {
    const amounts = computeAmounts(draft);
    const existingIndex = profile.records.findIndex(function (record) {
      return record.date === draft.date;
    });
    const existing = existingIndex >= 0 ? profile.records[existingIndex] : null;
    rememberRecordsUndo(profile, existing ? "저장 전 기록으로 되돌렸습니다." : "저장 전 상태로 되돌렸습니다.");
    const record = {
      id: existing ? existing.id : id(),
      date: draft.date,
      workerName: draft.workerName || profile.name,
      rawText: draft.rawText || "",
      assignedCount: integerValue(draft.assignedCount),
      deliveredCount: integerValue(draft.deliveredCount),
      returnCount: integerValue(draft.returnCount),
      undeliveredCount: integerValue(draft.undeliveredCount),
      irregularCount: integerValue(draft.irregularCount),
      statusText: draft.statusText || "",
      baseUnitPrice: numberValue(draft.baseUnitPrice, profile.settings.baseUnitPrice),
      perDeliveryExtra: numberValue(draft.perDeliveryExtra, 0),
      unitPrice: numberValue(draft.unitPrice, profile.settings.baseUnitPrice),
      allowanceItems: allowanceItemsFor(draft),
      returnExtra: 0,
      undeliveredExtra: 0,
      irregularExtra: 0,
      baseAmount: amounts.baseAmount,
      extraAmount: amounts.extraAmount,
      grossAmount: amounts.grossAmount,
      memo: draft.memo || "",
      createdAt: existing ? existing.createdAt : nowIso(),
      updatedAt: nowIso()
    };
    if (record.date) {
      selectedMonth = record.date.slice(0, 7);
    }
    if (existingIndex >= 0) {
      profile.records[existingIndex] = record;
      flashText = "기록을 갱신했습니다.";
    } else {
      profile.records.push(record);
      flashText = "저장되었습니다.";
    }
    profile.updatedAt = nowIso();
    saveState();
    render();
  }

  function bindMonthView(profile) {
    const picker = document.getElementById("month-picker");
    picker.addEventListener("change", function () {
      selectedMonth = picker.value || monthValue(new Date());
      render();
    });

    app.querySelectorAll("[data-action='select-month']").forEach(function (button) {
      button.addEventListener("click", function () {
        selectedMonth = button.dataset.month;
        render();
      });
    });

    app.querySelectorAll("[data-action='edit-record']").forEach(function (button) {
      button.addEventListener("click", function () {
        const record = profile.records.find(function (item) { return item.id === button.dataset.id; });
        if (!record) return;
        rememberDraftUndo("수정 화면으로 오기 전 입력으로 되돌렸습니다.");
        draft = Object.assign(createEmptyDraft(profile), record);
        view = "today";
        flashText = "";
        render();
      });
    });
  }

  function bindSettingsView(profile) {
    const settingsForm = document.getElementById("settings-form");
    settingsForm.addEventListener("submit", function (event) {
      event.preventDefault();
      const data = new FormData(settingsForm);
      profile.settings.baseUnitPrice = numberValue(data.get("baseUnitPrice"), 1300);
      profile.settings.defaultPerDeliveryExtra = numberValue(data.get("defaultPerDeliveryExtra"), 200);
      profile.settings.deductionRate = numberValue(data.get("deductionRate"), 3.3);
      profile.updatedAt = nowIso();
      if (draft) {
        draft.baseUnitPrice = profile.settings.baseUnitPrice;
        updateAppliedUnitPrice();
      }
      saveState();
      flash("설정이 저장되었습니다.");
    });

    const pinForm = document.getElementById("pin-form");
    pinForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const pin = String(new FormData(pinForm).get("pin") || "").trim();
      const hadPin = Boolean(profile.pinHash);
      if (pin.length < 4) {
        flash("PIN은 4자리 이상으로 입력해 주세요.");
        return;
      }
      const salt = id();
      profile.pinSalt = salt;
      profile.pinHash = await hashPin(pin, salt);
      profile.updatedAt = nowIso();
      unlockedProfileId = profile.id;
      saveState();
      flash(hadPin ? "PIN이 변경되었습니다." : "PIN이 켜졌습니다.");
    });

    const disablePinButton = app.querySelector("[data-action='disable-pin']");
    if (disablePinButton) {
      disablePinButton.addEventListener("click", function () {
        profile.pinSalt = "";
        profile.pinHash = "";
        profile.updatedAt = nowIso();
        unlockedProfileId = profile.id;
        saveState();
        flash("PIN을 껐습니다.");
      });
    }

    const backupButton = app.querySelector("[data-action='backup-json']");
    backupButton.addEventListener("click", function () {
      const payload = createBackupPayload(profile);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `parcel-ledger-backup_${safeFileName(profile.name)}_${dateValue(new Date())}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    });

    const restoreInput = document.getElementById("restore-file");
    restoreInput.addEventListener("change", function () {
      const file = restoreInput.files && restoreInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        restoreProfile(reader.result);
      };
      reader.readAsText(file);
    });
  }

  function restoreProfile(rawJson) {
    try {
      const payload = JSON.parse(rawJson);
      const imported = migrateBackupPayload(payload);
      const existingIndex = state.profiles.findIndex(function (profile) {
        return profile.id === imported.id;
      });
      if (existingIndex >= 0) {
        if (!window.confirm("같은 사용자를 백업 파일로 바꿀까요?")) return;
        state.profiles[existingIndex] = imported;
      } else {
        state.profiles.push(imported);
      }
      state.activeProfileId = imported.id;
      unlockedProfileId = null;
      draft = null;
      saveState();
      flash("복원되었습니다.");
    } catch (error) {
      flash(error.message || "백업 파일을 확인해 주세요.");
    }
  }

  function createBackupPayload(profile) {
    return {
      backupType: BACKUP_TYPE,
      schemaVersion: APP_SCHEMA_VERSION,
      appName: "딜리래빗 정산 기록",
      exportedAt: nowIso(),
      profile: normalizeProfile(profile)
    };
  }

  function migrateBackupPayload(payload) {
    if (!payload || !payload.profile) {
      throw new Error("백업 파일을 확인해 주세요.");
    }
    const isCurrentType = payload.backupType === BACKUP_TYPE;
    const isLegacyType = LEGACY_BACKUP_TYPES.includes(payload.backupType);
    if (!isCurrentType && !isLegacyType) {
      throw new Error("백업 파일 형식이 다릅니다.");
    }
    const version = numberValue(payload.schemaVersion || 1, 1);
    if (version > APP_SCHEMA_VERSION) {
      throw new Error("이 앱보다 새 버전의 백업입니다. 앱을 먼저 업데이트해 주세요.");
    }
    return normalizeProfile(payload.profile);
  }

  function normalizeProfile(profile) {
    if (!profile || !profile.id || !profile.name) {
      throw new Error("백업 사용자 정보를 확인해 주세요.");
    }
    return {
      schemaVersion: APP_SCHEMA_VERSION,
      id: String(profile.id),
      name: String(profile.name),
      pinSalt: profile.pinSalt || "",
      pinHash: profile.pinHash || "",
      settings: normalizeSettings(profile.settings),
      records: Array.isArray(profile.records) ? profile.records.map(normalizeRecord) : [],
      createdAt: profile.createdAt || nowIso(),
      updatedAt: nowIso()
    };
  }

  function normalizeSettings(settings) {
    const source = settings || {};
    const baseUnitPrice = numberValue(source.baseUnitPrice, 1300);
    const legacyUnitKey = "special" + "UnitPrice";
    const legacyDefaultExtra = Math.max(0, numberValue(source[legacyUnitKey], 1500) - baseUnitPrice);
    return {
      baseUnitPrice,
      defaultPerDeliveryExtra: numberValue(source.defaultPerDeliveryExtra, legacyDefaultExtra),
      deductionRate: numberValue(source.deductionRate, 3.3)
    };
  }

  function normalizeRecord(record) {
    const source = record || {};
    const baseUnitPrice = numberValue(source.baseUnitPrice, 1300);
    const previousUnitPrice = numberValue(source.unitPrice, baseUnitPrice);
    const legacyPerDeliveryExtra = Math.max(0, previousUnitPrice - baseUnitPrice);
    const legacyFlagKey = "is" + "SpecialWork";
    const perDeliveryExtra = numberValue(source.perDeliveryExtra, source[legacyFlagKey] ? legacyPerDeliveryExtra : 0);
    const normalized = Object.assign({}, source, {
      baseUnitPrice,
      perDeliveryExtra,
      unitPrice: baseUnitPrice + perDeliveryExtra,
      allowanceItems: allowanceItemsFor(source)
    });
    const amounts = computeAmounts(normalized);
    return {
      id: source.id || id(),
      date: source.date || dateValue(new Date()),
      workerName: source.workerName || "",
      rawText: source.rawText || "",
      assignedCount: integerValue(source.assignedCount),
      deliveredCount: integerValue(source.deliveredCount),
      returnCount: integerValue(source.returnCount),
      undeliveredCount: integerValue(source.undeliveredCount),
      irregularCount: integerValue(source.irregularCount),
      statusText: source.statusText || "",
      baseUnitPrice,
      perDeliveryExtra,
      unitPrice: baseUnitPrice + perDeliveryExtra,
      allowanceItems: allowanceItemsFor(normalized),
      returnExtra: 0,
      undeliveredExtra: 0,
      irregularExtra: 0,
      baseAmount: amounts.baseAmount,
      extraAmount: amounts.extraAmount,
      grossAmount: amounts.grossAmount,
      memo: source.memo || "",
      createdAt: source.createdAt || nowIso(),
      updatedAt: record.updatedAt || nowIso()
    };
  }

  function flash(message) {
    flashText = message;
    render();
  }

  window.__parcelLedgerTest = {
    parseKakaoText,
    computeAmounts,
    createBackupPayload,
    migrateBackupPayload,
    APP_FILES
  };

  render();
}());
