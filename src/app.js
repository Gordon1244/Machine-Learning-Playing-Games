const {
  CONTROLLER_PROFILES,
  DEFAULT_LIVE_POLICY,
  LIVE_LEARNING_MODES,
  OUTPUT_BACKENDS,
  OUTPUT_BACKEND_PROFILES,
  SETUP_STEPS,
  TOOLTIP_HELP,
  clampActionCommand,
  computeLearningScore,
  createDefaultActionCommand,
  createNxbtCommand,
  createRigConfig,
  evaluateSafetyGate,
  getTrainingReadiness,
  shouldRollbackModel,
  shouldSwitchToShadowModel
} = window.Switch2Core;

const state = {
  currentProjectId: "",
  activeStepId: SETUP_STEPS[0].id,
  completedSteps: new Set(),
  selectedProfileId: "switch2_pro",
  outputBackend: OUTPUT_BACKENDS.MECHANICAL_RIG,
  rigConfig: createRigConfig("switch2_pro"),
  calibratedSlotIds: new Set(),
  emergencyStopOk: false,
  connectionOk: false,
  externalPowerOk: false,
  nxbtReady: false,
  cameraConnected: false,
  cameraReady: false,
  cameraCalibrated: false,
  cameraStream: null,
  cameraStreams: new Set(),
  cameraRequestId: 0,
  cameraOpening: false,
  cameraLastError: "",
  cameraDeviceLabel: "",
  serialPort: null,
  trainingSeconds: 0,
  bestScore: 0,
  currentScore: 0,
  previousStableScore: 0,
  needsRecalibration: false,
  trainingEngineReady: false,
  engineStatusMessage: "尚未檢查本地訓練引擎",
  liveEngineReady: false,
  modelReady: false,
  shadowReady: false,
  engineMode: "idle",
  controlPaused: false,
  latestGameState: {},
  livePolicy: JSON.parse(JSON.stringify(DEFAULT_LIVE_POLICY)),
  runtimeSettings: {},
  importedVideoName: "",
  demonstrationRecording: false,
  trainingGuidance: null
};

const stepList = document.querySelector("#stepList");
const activeStepTitle = document.querySelector("#activeStepTitle");
const stepContent = document.querySelector("#stepContent");
const advancedToggle = document.querySelector("#advancedToggle");
const advancedBox = document.querySelector("#advancedBox");
const fullOnlineAdvanced = document.querySelector("#fullOnlineAdvanced");
const updateInterval = document.querySelector("#updateInterval");
const toast = document.querySelector("#toast");

const statusController = document.querySelector("#statusController");
const statusControllerNote = document.querySelector("#statusControllerNote");
const statusScore = document.querySelector("#statusScore");
const statusScoreNote = document.querySelector("#statusScoreNote");
const statusSafety = document.querySelector("#statusSafety");
const statusSafetyNote = document.querySelector("#statusSafetyNote");
const cameraSessionId = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const cameraChannel = "BroadcastChannel" in window ? new BroadcastChannel("switch2-camera-control") : null;

function init() {
  hydrateTooltips();
  bindFloatingTooltips();
  renderStepList();
  renderActiveStep();
  updateStatus();
  bindGlobalEvents();
  window.setInterval(() => {
    if (state.engineMode === "training" && !state.controlPaused) {
      state.trainingSeconds += 1;
      if (state.activeStepId === "training") renderActiveStep();
    }
  }, 1000);
}

function bindFloatingTooltips() {
  const tooltip = document.createElement("div");
  tooltip.className = "floating-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("popover", "manual");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  const supportsPopover = typeof tooltip.showPopover === "function";

  const show = (node) => {
    if (!node?.matches?.(".info[data-tooltip]")) return;
    tooltip.textContent = node.dataset.tooltip;
    tooltip.hidden = false;
    if (supportsPopover && !tooltip.matches(":popover-open")) tooltip.showPopover();
    const anchor = node.getBoundingClientRect();
    const gap = 10;
    const margin = 10;
    const width = Math.min(360, window.innerWidth - margin * 2);
    tooltip.style.width = `${width}px`;
    const box = tooltip.getBoundingClientRect();
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - box.width / 2, margin), window.innerWidth - box.width - margin);
    const fitsAbove = anchor.top >= box.height + gap + margin;
    const top = fitsAbove ? anchor.top - box.height - gap : anchor.bottom + gap;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - box.height - margin))}px`;
  };

  const hide = () => {
    if (supportsPopover && tooltip.matches(":popover-open")) tooltip.hidePopover();
    tooltip.hidden = true;
  };

  document.addEventListener("mouseover", (event) => show(event.target.closest?.(".info[data-tooltip]")));
  document.addEventListener("focusin", (event) => show(event.target.closest?.(".info[data-tooltip]")));
  document.addEventListener("mouseout", (event) => {
    if (event.target.closest?.(".info[data-tooltip]")) hide();
  });
  document.addEventListener("focusout", (event) => {
    if (event.target.closest?.(".info[data-tooltip]")) hide();
  });
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
}

function bindGlobalEvents() {
  cameraChannel?.addEventListener("message", (event) => {
    if (event.data?.type === "stop-camera" && event.data.source !== cameraSessionId) {
      closeCamera({ broadcast: false, silent: true });
    }
  });
  window.addEventListener("pagehide", () => {
    if (state.engineMode !== "idle") window.ProjectUI?.sendControl("emergency-stop");
    closeCamera({ broadcast: false, silent: true });
    closeSerialPort();
  });

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      const route = button.dataset.route;
      if (!state.currentProjectId) {
        window.ProjectUI?.openProjectDialog();
        showToast("請先新增或選擇遊戲專案，才能保存訓練進度。");
        return;
      }
      if (route === "setup") setActiveStep("device_check");
      if (route === "training") {
        const readiness = getCurrentTrainingReadiness();
        if (readiness.ok) {
          setActiveStep("training");
        } else {
          setActiveStep(readiness.nextStepId);
          showToast(`還不能開始訓練：${readiness.issues[0]}`);
        }
      }
      if (route === "live") {
        const safety = getCurrentSafetyGate();
        if (safety.ok) {
          setActiveStep("live_play");
        } else {
          setActiveStep(safety.issues.some((issue) => issue.includes("沒有校正")) ? "rig_calibration" : "device_check");
          showToast(`還不能正式遊玩：${safety.issues[0]}`);
        }
      }
      document.querySelector(".workflow").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.querySelector("#emergencyStopButton").addEventListener("click", async () => {
    state.emergencyStopOk = false;
    showToast("已送出急停要求。若真實控制引擎尚未接入，請立即使用實體急停；之後需重新測試急停。");
    await window.ProjectUI?.sendControl("emergency-stop");
    updateStatus();
    renderActiveStep();
  });

  advancedToggle.addEventListener("click", () => {
    advancedBox.hidden = !advancedBox.hidden;
  });

  fullOnlineAdvanced.addEventListener("change", () => {
    setMode(LIVE_LEARNING_MODES.FULL_ONLINE_UPDATE, fullOnlineAdvanced.checked);
    showToast(fullOnlineAdvanced.checked ? "已記錄全程更新要求。第一版仍只使用可回滾的旁路更新。" : "已關閉全程更新要求。");
    renderActiveStep();
  });

  updateInterval.addEventListener("change", () => {
    state.livePolicy.updateEverySeconds = Math.min(120, Math.max(5, Number(updateInterval.value) || 20));
    updateInterval.value = String(state.livePolicy.updateEverySeconds);
    emitStateChange();
  });
}

function hydrateTooltips() {
  document.querySelectorAll(".info[data-help]").forEach((node) => {
    const help = TOOLTIP_HELP.find((item) => item.fieldId === node.dataset.help);
    if (help) {
      node.dataset.tooltip = formatTooltip(help);
    }
  });
}

function formatTooltip(help) {
  return `${help.shortDescription} 推薦：${help.recommendedValue} 選錯會怎樣：${help.riskWarning}`;
}

function helpIcon(fieldId, label = "說明") {
  const help = TOOLTIP_HELP.find((item) => item.fieldId === fieldId);
  const tooltip = help ? formatTooltip(help) : "這裡會顯示白話說明、推薦值與風險。";
  return `<span class="info" data-tooltip="${escapeHtml(tooltip)}" tabindex="0" aria-label="${escapeHtml(label)}">i</span>`;
}

function renderStepList() {
  stepList.innerHTML = SETUP_STEPS.map((step, index) => {
    const done = state.completedSteps.has(step.id);
    const active = state.activeStepId === step.id;
    return `
      <button class="step-button ${done ? "done" : ""} ${active ? "active" : ""}" type="button" data-step="${step.id}">
        <span class="step-index">${done ? "✓" : index + 1}</span>
        <span>
          <span class="step-name">${step.name}</span>
          <span class="step-sub">${done ? step.successMessage : step.requiredCheck}</span>
        </span>
      </button>
    `;
  }).join("");

  stepList.querySelectorAll("[data-step]").forEach((button) => {
    button.addEventListener("click", () => setActiveStep(button.dataset.step));
  });
}

function setActiveStep(stepId) {
  state.activeStepId = stepId;
  renderStepList();
  renderActiveStep();
  emitStateChange();
}

function renderActiveStep() {
  const step = SETUP_STEPS.find((item) => item.id === state.activeStepId);
  activeStepTitle.textContent = step.name;

  const renderers = {
    device_check: renderDeviceCheck,
    controller_select: renderControllerSelect,
    camera_calibration: renderCameraCalibration,
    rig_calibration: renderRigCalibration,
    video_import: renderVideoImport,
    training: renderTraining,
    live_play: renderLivePlay
  };

  stepContent.innerHTML = renderers[step.id]();
  bindStepEvents(step.id);
}

function renderDeviceCheck() {
  return `
    <p class="step-copy">先確認攝影機、開發板、外部電源與急停。這一步只顯示必要項目，不需要懂硬體細節。</p>
    <div class="choice-grid">
      ${simpleCheck("攝影機", state.cameraConnected ? "已取得鏡頭授權，下一步請確認畫面" : "尚未開啟鏡頭，不能判定畫面清楚", state.cameraConnected, "cameraCalibration")}
      ${simpleCheck("開發板", state.outputBackend === OUTPUT_BACKENDS.NXBT_BLUETOOTH ? "純 NXBT 模式可不使用開發板" : "尚未偵測到開發板，不能判定硬體正常", state.outputBackend === OUTPUT_BACKENDS.NXBT_BLUETOOTH || state.connectionOk)}
      ${simpleCheck("急停", state.emergencyStopOk ? "急停路徑測試通過" : "尚未測試急停路徑，不能正式運作", state.emergencyStopOk, "emergencyStop")}
      ${simpleCheck("NXBT", state.nxbtReady ? "NXBT 已由後端回報可用" : "尚未連線，不能判定 NXBT 可用", state.outputBackend === OUTPUT_BACKENDS.MECHANICAL_RIG || state.nxbtReady, "nxbtBackend")}
      ${simpleCheck("外部電源", state.outputBackend === OUTPUT_BACKENDS.NXBT_BLUETOOTH ? "純 NXBT 模式不需要馬達外部電源" : state.externalPowerOk ? "開發板已回報馬達外部電源正常" : "尚未收到 power_ok，不能判定馬達電源正常", state.outputBackend === OUTPUT_BACKENDS.NXBT_BLUETOOTH || state.externalPowerOk)}
    </div>
    <h3>控制輸出方式 ${helpIcon("nxbtBackend", "NXBT 輸出方式說明")}</h3>
    <div class="choice-grid">
      ${Object.values(OUTPUT_BACKEND_PROFILES).map((backend) => `
        <div class="choice-card ${state.outputBackend === backend.id ? "selected" : ""}">
          <button type="button" data-backend="${backend.id}">
            <strong>${backend.beginnerName}</strong>
            <p>${backend.description}${backend.experimental ? " 這是進階/實驗選項。" : ""}</p>
          </button>
        </div>
      `).join("")}
    </div>
    <div class="step-actions">
      <button class="primary-button" data-action="complete-step" type="button">下一步</button>
      <button class="secondary-button" data-action="open-camera" type="button">開啟鏡頭</button>
      <button class="secondary-button" data-action="close-camera" type="button" ${state.cameraConnected ? "" : "disabled"}>關閉鏡頭</button>
      <button class="secondary-button" data-action="test-board" type="button">檢查開發板</button>
      <button class="secondary-button" data-action="connect-nxbt" type="button">連接 NXBT</button>
      <button class="secondary-button" data-action="reset-estop" type="button">測試急停</button>
    </div>
  `;
}

function simpleCheck(title, note, ok, helpField) {
  return `
    <div class="choice-card ${ok ? "selected" : ""}">
      <strong>${title} ${helpField ? helpIcon(helpField, `${title}說明`) : ""}</strong>
      <p>${note}</p>
    </div>
  `;
}

function renderControllerSelect() {
  return `
    <p class="step-copy">選擇實際固定在機械治具上的控制器。兩種控制器都支援，但校正檔和馬達位置不同。${helpIcon("controllerProfile", "控制器類型說明")}</p>
    <div class="choice-grid">
      ${Object.values(CONTROLLER_PROFILES).map((profile) => `
        <div class="choice-card ${state.selectedProfileId === profile.id ? "selected" : ""}">
          <button type="button" data-profile="${profile.id}">
            <strong>${profile.beginnerName}</strong>
            <p>${profile.description}</p>
          </button>
        </div>
      `).join("")}
    </div>
    <div class="step-actions">
      <button class="primary-button" data-action="complete-step" type="button">使用這個控制器</button>
    </div>
  `;
}

function renderCameraCalibration() {
  const cameraStatus = state.cameraConnected ? "已授權" : "未開啟";
  const previewStatus = state.cameraReady ? "已顯示" : "未顯示";
  const calibrationStatus = state.cameraCalibrated ? "已確認" : "未確認";
  return `
    <p class="step-copy">把攝影機對準 Switch 2 螢幕或掌機畫面。系統必須真的取得鏡頭畫面後，才允許你確認校正。${helpIcon("cameraCalibration", "鏡頭校正說明")}</p>
    ${window.isSecureContext ? "" : `<div class="alert">目前不是安全的瀏覽器環境，鏡頭預覽可能無法播放。請改用 <strong>http://localhost:8765</strong> 開啟。</div>`}
    <div class="alert" id="cameraDiagnostic" ${state.cameraLastError ? "" : "hidden"}><strong>鏡頭診斷：</strong><span id="cameraDiagnosticMessage">${escapeHtml(state.cameraLastError)}</span></div>
    <div class="camera-preview">
      <video id="cameraPreview" autoplay playsinline muted></video>
      <div class="camera-empty" ${state.cameraReady ? "hidden" : ""}>尚未顯示鏡頭畫面</div>
    </div>
    <div class="metric-grid">
      <div class="metric"><span class="status-label">鏡頭狀態</span><strong id="cameraPermissionStatus">${cameraStatus}</strong><p id="cameraPermissionNote">${state.cameraConnected ? escapeHtml(state.cameraDeviceLabel || "瀏覽器已取得鏡頭授權") : "請先按開啟鏡頭"}</p></div>
      <div class="metric"><span class="status-label">預覽畫面</span><strong id="cameraPreviewStatus">${previewStatus}</strong><p id="cameraPreviewNote">${state.cameraReady ? "正在播放真實鏡頭畫面" : "還沒有可確認的影像"}</p></div>
      <div class="metric"><span class="status-label">畫面確認</span><strong>${calibrationStatus}</strong><p>${state.cameraCalibrated ? "使用者已確認螢幕清楚入鏡" : "尚未確認四角與關鍵資訊"}</p></div>
    </div>
    <div class="step-actions">
      <button class="secondary-button" id="cameraOpenButton" data-action="open-camera" type="button" ${state.cameraOpening ? "disabled" : ""}>${state.cameraOpening ? "正在開啟..." : "開啟鏡頭"}</button>
      <button class="secondary-button" id="cameraCloseButton" data-action="close-camera" type="button" ${state.cameraConnected || state.cameraOpening ? "" : "disabled"}>關閉鏡頭</button>
      <button class="primary-button" id="cameraConfirmButton" data-action="complete-step" type="button" ${state.cameraReady ? "" : "disabled"}>我確認畫面清楚</button>
      <button class="secondary-button" data-action="camera-tip" type="button">我看不到畫面</button>
    </div>
  `;
}

function renderRigCalibration() {
  const calibratedCount = state.calibratedSlotIds.size;
  const total = state.rigConfig.slots.length;
  return `
    <p class="step-copy">完整手把校正會逐一測試雙搖桿、方向鍵、正面按鍵、肩鍵/扳機與特殊鍵。按不到時，訊息會直接告訴你要調哪個模組。</p>
    <div class="alert">${calibratedCount === total ? "完整手把校正完成。" : `還有 ${total - calibratedCount} 個輸入沒有校正。範例修正：手把右肩鍵沒有壓到，請把上方模組往下調 2-3 mm。`}</div>
    <div class="controller-slots">
      ${state.rigConfig.slots.map((slot) => `
        <div class="slot-row">
          <span>${slot.label}</span>
          <button class="secondary-button" data-calibrate="${slot.id}" type="button" ${state.connectionOk ? "" : "disabled"}>${state.calibratedSlotIds.has(slot.id) ? "已完成" : "等待硬體回報"}</button>
        </div>
      `).join("")}
    </div>
    <div class="step-actions">
      <button class="primary-button" data-action="complete-step" type="button">校正完成，下一步</button>
    </div>
  `;
}

function renderVideoImport() {
  return `
    <p class="step-copy">可以匯入只有遊戲畫面的影片，先暖身文字識讀與畫面事件辨識。影片沒有搖桿標籤時，不能還原手把角度，也不能取代實機鏡頭、硬體驗證或實機探索。${helpIcon("videoTraining", "影片預訓練說明")}</p>
    <label class="choice-card">
      <strong>遊戲畫面影片</strong>
      <p>${state.importedVideoName ? `已匯入：${escapeHtml(state.importedVideoName)}` : "支援最長 96 MB 的本機影片片段。影片會實際複製到目前專案資料集。"}</p>
      <input id="videoInput" type="file" accept="video/*" />
    </label>
    <div class="step-actions">
      <button class="primary-button" data-action="complete-step" type="button">${state.importedVideoName ? "記錄影片來源，下一步" : "沒有影片，直接下一步"}</button>
    </div>
  `;
}

function renderTraining() {
  const minutes = Math.floor(state.trainingSeconds / 60);
  const seconds = String(state.trainingSeconds % 60).padStart(2, "0");
  const readiness = getCurrentTrainingReadiness();
  const canTrain = readiness.ok && state.trainingEngineReady;
  return `
    <p class="step-copy">訓練必須連到真實訓練引擎後才會開始。這個頁面不會用假資料冒充 AI 正在學習。</p>
    <div class="alert"><strong>視覺神經網路：</strong>4 張連續畫格會由 CNN 轉成特徵，再和速度、排名、進度、碰撞等資料融合。${helpIcon("visualTraining", "視覺神經網路說明")}</div>
    ${state.trainingGuidance ? `<div class="alert"><strong>${state.trainingGuidance.status === "scheduled" ? "下一回合指導" : "目前訓練指導"}：</strong>${escapeHtml(state.trainingGuidance.goalLabel || state.trainingGuidance.goal)}（版本 ${escapeHtml(state.trainingGuidance.version)}）</div>` : ""}
    ${readiness.ok ? "" : `<div class="alert">${readiness.issues.map(escapeHtml).join("<br>")}<p class="error-next-step">${readiness.nextStep}</p></div>`}
    ${readiness.ok && !state.trainingEngineReady ? `<div class="alert">本地訓練引擎目前不可用：${escapeHtml(state.engineStatusMessage)}</div>` : ""}
    <div class="metric-grid">
      <div class="metric"><span class="status-label">學習時間</span><strong>${minutes}:${seconds}</strong><p>可隨時暫停</p></div>
      <div class="metric"><span class="status-label">最好成績</span><strong>${state.bestScore || "尚未訓練"}</strong><p>學習分數越高越好 ${helpIcon("learningScore", "學習分數說明")}</p></div>
      <div class="metric"><span class="status-label">最近狀態</span><strong>${state.trainingEngineReady ? (state.needsRecalibration ? "需校正" : "待訓練") : "引擎不可用"}</strong><p>${state.trainingEngineReady ? "引擎已接入，等待真實訓練資料" : escapeHtml(state.engineStatusMessage)}</p></div>
      <div class="metric"><span class="status-label">控制器示範</span><strong>${state.demonstrationRecording ? "錄製中" : "待命"}</strong><p>同步保存鏡頭與電腦 Gamepad 操作</p></div>
    </div>
    <div class="step-actions">
      <button class="secondary-button" data-action="toggle-demonstration" type="button">${state.demonstrationRecording ? "停止示範錄製" : "錄製我的操作示範"}</button>
      <button class="secondary-button" data-action="pretrain-demonstrations" type="button" ${state.demonstrationRecording ? "disabled" : ""}>用示範暖身 AI</button>
      <button class="primary-button" data-action="start-training" type="button" ${canTrain ? "" : "disabled"}>開始訓練</button>
      <button class="secondary-button" data-action="next-round" type="button" ${state.trainingEngineReady ? "" : "disabled"}>開始下一回合</button>
      <button class="secondary-button" data-action="stop-training" type="button" ${state.trainingEngineReady ? "" : "disabled"}>停止並保存模型</button>
      <button class="secondary-button" data-action="${readiness.ok ? "complete-step" : "go-required-step"}" type="button">${readiness.ok ? "進入正式遊玩" : "去完成必要設定"}</button>
    </div>
  `;
}

function renderLivePlay() {
  const safety = getCurrentSafetyGate();

  const rollback = shouldRollbackModel({
    previousScore: state.previousStableScore,
    currentScore: state.currentScore,
    policy: state.livePolicy
  });

  const switchShadow = shouldSwitchToShadowModel({
    mainScore: state.currentScore,
    shadowScore: state.bestScore,
    policy: state.livePolicy
  });
  const performanceLabel = state.liveEngineReady ? state.currentScore : "尚未啟動";
  const performanceNote = state.liveEngineReady
    ? (rollback ? "表現下降，建議回滾到穩定模型" : "等待真實畫面回饋")
    : "尚未接入正式遊玩控制引擎";

  return `
    <p class="step-copy">正式遊玩會持續用畫面表現修正 AI。預設是「安全適應」加「旁邊偷偷練習的備用 AI」，比較穩定。</p>
    ${!state.liveEngineReady ? `<div class="alert">尚未接入正式遊玩控制引擎。即使安全閘門通過，也不能送出控制命令。</div>` : ""}
    ${!state.modelReady ? `<div class="alert">尚未由真實訓練引擎驗證可用模型，不能開始正式遊玩。</div>` : ""}
    <div class="mode-stack">
      ${modeCheckbox(LIVE_LEARNING_MODES.SAFE_ADAPTATION, "安全適應", "正式遊玩時只做小幅修正。", "safeAdaptation")}
      ${modeCheckbox(LIVE_LEARNING_MODES.SHADOW_MODEL_LEARNING, "旁邊偷偷練習的備用 AI", "主 AI 玩，備用 AI 旁路學習。", "shadowModel")}
      ${modeCheckbox(LIVE_LEARNING_MODES.FULL_ONLINE_UPDATE, "全程即時更新要求", "第一版仍使用可回滾的旁路更新，不直接改寫控制中的主 AI。", "fullOnlineUpdate")}
    </div>
    <div class="metric-grid">
      <div class="metric"><span class="status-label">最近 1 分鐘表現</span><strong>${performanceLabel}</strong><p>${performanceNote}</p></div>
      <div class="metric"><span class="status-label">備用 AI</span><strong>${state.liveEngineReady ? (state.shadowReady ? "可試跑" : "學習中") : "未啟動"}</strong><p>${state.liveEngineReady ? (state.shadowReady ? "試跑前仍需要你手動確認" : "停止訓練保存模型後才可試跑") : "尚未接入正式遊玩控制引擎"}</p></div>
      <div class="metric"><span class="status-label">輸出方式</span><strong>${OUTPUT_BACKEND_PROFILES[state.outputBackend].beginnerName}</strong><p>${OUTPUT_BACKEND_PROFILES[state.outputBackend].experimental ? "進階模式，需實機驗證" : "穩定預設模式"}</p></div>
      <div class="metric"><span class="status-label">安全閘門</span><strong>${safety.ok ? "通過" : "未通過"}</strong><p>${safety.nextStep}</p></div>
    </div>
    ${safety.ok ? "" : `<div class="alert">${safety.issues.map(escapeHtml).join("<br>")}</div>`}
    <div class="step-actions">
      <button class="primary-button" data-action="start-live" type="button" ${safety.ok && state.liveEngineReady && state.modelReady ? "" : "disabled"}>開始正式遊玩</button>
      <button class="secondary-button" data-action="canary-shadow" type="button" ${state.shadowReady && state.liveEngineReady ? "" : "disabled"}>試跑備用 AI</button>
      <button class="secondary-button" data-action="rollback-model" type="button" ${state.modelReady ? "" : "disabled"}>回滾穩定模型</button>
      <button class="danger-button" data-action="local-estop" type="button">急停</button>
    </div>
  `;
}

function modeCheckbox(mode, label, note, helpField) {
  const checked = state.livePolicy.modes.includes(mode);
  return `
    <label class="check-line">
      <input type="checkbox" data-mode="${mode}" ${checked ? "checked" : ""} />
      <strong>${label}</strong>
      <span>${note}</span>
      ${helpIcon(helpField, `${label}說明`)}
    </label>
  `;
}

function bindStepEvents(stepId) {
  stepContent.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action));
  });

  stepContent.querySelectorAll("[data-profile]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedProfileId = button.dataset.profile;
      state.rigConfig = createConfiguredRigConfig(state.selectedProfileId);
      state.calibratedSlotIds.clear();
      showToast(`${CONTROLLER_PROFILES[state.selectedProfileId].beginnerName} profile 已載入。`);
      renderActiveStep();
      updateStatus();
    });
  });

  stepContent.querySelectorAll("[data-backend]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (state.engineMode !== "idle") await window.ProjectUI?.sendControl("stop");
      await closeSerialPort();
      await window.ProjectUI?.disconnectNxbt();
      state.outputBackend = button.dataset.backend;
      state.nxbtReady = false;
      state.emergencyStopOk = false;
      showToast(`已切換輸出方式：${OUTPUT_BACKEND_PROFILES[state.outputBackend].beginnerName}`);
      renderActiveStep();
      updateStatus();
    });
  });

  stepContent.querySelectorAll("[data-calibrate]").forEach((button) => {
    button.addEventListener("click", async () => {
      await calibrateSlot(button.dataset.calibrate);
    });
  });

  stepContent.querySelectorAll("[data-mode]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      setMode(checkbox.dataset.mode, checkbox.checked);
      fullOnlineAdvanced.checked = state.livePolicy.modes.includes(LIVE_LEARNING_MODES.FULL_ONLINE_UPDATE);
      renderActiveStep();
    });
  });

  const videoInput = stepContent.querySelector("#videoInput");
  if (videoInput) {
    videoInput.addEventListener("change", async () => {
      const file = videoInput.files[0];
      state.importedVideoName = "";
      if (file && await window.ProjectUI?.uploadVideo(file)) state.importedVideoName = file.name;
      showToast(state.importedVideoName ? "影片已匯入目前遊戲專案。沒有搖桿標籤的影片只用於畫面暖身。" : "尚未匯入影片。");
      renderActiveStep();
    });
  }

  if (stepId === "live_play") updateStatus();
  if (stepId === "camera_calibration" && state.cameraStream && !state.cameraOpening) attachCameraPreview();
}

async function handleAction(action) {
  if (action === "complete-step") {
    completeCurrentStep();
    return;
  }

  if (action === "go-required-step") {
    const readiness = getCurrentTrainingReadiness();
    setActiveStep(readiness.nextStepId);
    showToast(readiness.issues[0]);
    return;
  }

  if (action === "reset-estop") {
    await testEmergencyStop();
  }

  if (action === "open-camera") {
    await openCamera();
  }

  if (action === "close-camera") {
    closeCamera();
  }

  if (action === "test-board") {
    await connectDevelopmentBoard();
  }

  if (action === "connect-nxbt") {
    state.nxbtReady = Boolean(await window.ProjectUI?.connectNxbt());
    renderActiveStep();
    updateStatus();
  }

  if (action === "camera-tip") {
    showToast("請讓螢幕四角都入鏡，並避開反光；若仍失敗，降低房間光源反射。");
  }

  if (action === "start-training") {
    const readiness = getCurrentTrainingReadiness();
    if (!readiness.ok) {
      setActiveStep(readiness.nextStepId);
      showToast(`訓練已阻止：${readiness.issues[0]}`);
      return;
    }
    if (!state.trainingEngineReady) {
      showToast("訓練已阻止：尚未接入本地訓練引擎。");
      return;
    }
    const started = await window.ProjectUI?.startEngine("start");
    if (!started) return;
    showToast("本地 PPO 引擎已啟動。畫格會寫入資料集；每回合結束後請手動按「開始下一回合」。");
  }

  if (action === "toggle-demonstration") {
    await window.ProjectUI?.toggleDemonstrationCapture();
  }

  if (action === "pretrain-demonstrations") {
    await window.ProjectUI?.pretrainDemonstrations();
  }

  if (action === "next-round") {
    await window.ProjectUI?.startEngine("next-round");
  }

  if (action === "stop-training") {
    await window.ProjectUI?.stopEngine();
  }

  if (action === "start-live") {
    await startLivePlay();
  }

  if (action === "canary-shadow") {
    await window.ProjectUI?.canaryShadow();
  }

  if (action === "rollback-model") {
    await window.ProjectUI?.rollbackModel();
  }

  if (action === "local-estop") {
    state.emergencyStopOk = false;
    showToast("已送出急停要求。若真實控制引擎尚未接入，請立即使用實體急停；之後需重新測試急停與手把位置。");
    await window.ProjectUI?.sendControl("emergency-stop");
  }

  renderStepList();
  renderActiveStep();
  updateStatus();
  emitStateChange();
}

function completeCurrentStep() {
  const stepIndex = SETUP_STEPS.findIndex((step) => step.id === state.activeStepId);
  const validation = validateCurrentStepBeforeComplete();
  if (!validation.ok) {
    showToast(validation.message);
    return;
  }

  if (state.activeStepId === "camera_calibration") state.cameraCalibrated = true;
  state.completedSteps.add(state.activeStepId);
  const next = SETUP_STEPS[Math.min(stepIndex + 1, SETUP_STEPS.length - 1)];
  state.activeStepId = next.id;
  showToast(SETUP_STEPS[stepIndex].successMessage);
  renderStepList();
  renderActiveStep();
  updateStatus();
  emitStateChange();
}

function validateCurrentStepBeforeComplete() {
  if (state.activeStepId === "device_check") {
    const backend = OUTPUT_BACKEND_PROFILES[state.outputBackend];
    if (!state.cameraConnected) return { ok: false, message: "尚未取得鏡頭授權，不能完成設備檢查。" };
    if (backend.requiresRigCalibration && !state.connectionOk) return { ok: false, message: "開發板連線不穩，不能完成設備檢查。" };
    if (backend.requiresRigCalibration && !state.externalPowerOk) return { ok: false, message: "開發板尚未回報 power_ok，不能完成設備檢查。請確認馬達外部電源與韌體。" };
    if (!state.emergencyStopOk) return { ok: false, message: "急停路徑沒有通過測試，不能完成設備檢查。" };
    if (backend.requiresNxbt && !state.nxbtReady) return { ok: false, message: "NXBT 尚未連線，不能完成設備檢查。" };
  }

  if (state.activeStepId === "camera_calibration" && !state.cameraReady) {
    return { ok: false, message: "沒有真實鏡頭畫面，不能標記鏡頭已校正。" };
  }

  if (state.activeStepId === "rig_calibration") {
    const backend = OUTPUT_BACKEND_PROFILES[state.outputBackend];
    if (backend.requiresRigCalibration && state.calibratedSlotIds.size < state.rigConfig.slots.length) {
      return { ok: false, message: "完整手把還沒全部校正，不能進入下一步。" };
    }
  }

  if (state.activeStepId === "training") {
    const readiness = getCurrentTrainingReadiness();
    if (!readiness.ok) return { ok: false, message: `還不能進入正式遊玩：${readiness.issues[0]}` };
    if (!state.modelReady) return { ok: false, message: "尚未完成真實訓練並產生可用模型，不能進入正式遊玩。" };
  }

  return { ok: true, message: "" };
}

async function openCamera() {
  if (!window.isSecureContext) {
    showToast("目前不是安全的瀏覽器環境。請改用 http://localhost:8765 開啟，不能直接用 file://。");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("這個瀏覽器不支援直接開啟鏡頭，請改用支援 getUserMedia 的瀏覽器。");
    return;
  }
  if (state.cameraOpening) {
    showToast("鏡頭正在開啟，請稍候。");
    return;
  }

  const requestId = ++state.cameraRequestId;
  state.cameraOpening = true;
  stopAllCameraStreams();
  state.cameraReady = false;
  state.cameraCalibrated = false;
  state.cameraLastError = "";
  state.cameraDeviceLabel = "";
  refreshCameraCalibrationView();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: cameraConstraints(),
      audio: false
    });
    if (requestId !== state.cameraRequestId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("瀏覽器沒有提供影像 track。");
    }
    state.cameraStreams.add(stream);
    state.cameraStream = stream;
    state.cameraConnected = true;
    state.cameraReady = false;
    state.cameraDeviceLabel = track.label || "已取得鏡頭授權";
    track.addEventListener("ended", () => handleCameraTrackEnded(stream), { once: true });
    window.ProjectUI?.logEvent("camera_opened", { deviceLabel: state.cameraDeviceLabel });
    showToast("已取得鏡頭授權。請到鏡頭校正頁確認預覽畫面是否真的顯示。");
    renderActiveStep();
    await attachCameraPreview();
    updateStatus();
  } catch (error) {
    if (requestId !== state.cameraRequestId) return;
    state.cameraConnected = false;
    state.cameraReady = false;
    state.cameraCalibrated = false;
    state.cameraLastError = describeCameraError(error);
    window.ProjectUI?.logEvent("camera_open_failed", { name: error?.name || "Error", message: error?.message || String(error) }, "error");
    showToast(`無法開啟鏡頭：${state.cameraLastError}`);
  } finally {
    if (requestId === state.cameraRequestId) {
      state.cameraOpening = false;
      refreshCameraCalibrationView();
    }
  }
}

async function attachCameraPreview() {
  const video = document.querySelector("#cameraPreview");
  const stream = state.cameraStream;
  if (!video || !stream) return false;

  try {
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    await new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => reject(new Error("camera metadata timeout")), 5000);
      if (video.readyState >= 1) {
        window.clearTimeout(timeoutId);
        resolve();
        return;
      }
      video.addEventListener("loadedmetadata", () => {
        window.clearTimeout(timeoutId);
        resolve();
      }, { once: true });
    });
    await video.play();
    const hasVideo = video.videoWidth > 0 && video.videoHeight > 0;
    state.cameraReady = hasVideo;
    if (!hasVideo) {
      state.cameraLastError = "鏡頭已授權，但預覽沒有有效影像。請確認攝影機沒有被其他程式占用。";
      showToast(state.cameraLastError);
    } else {
      state.cameraLastError = "";
    window.ProjectUI?.logEvent("camera_preview_ready", { width: video.videoWidth, height: video.videoHeight, deviceLabel: state.cameraDeviceLabel });
      window.ProjectUI?.startVisionCapture();
    }
    refreshCameraCalibrationView();
    return hasVideo;
  } catch (error) {
    state.cameraReady = false;
    state.cameraCalibrated = false;
    state.cameraLastError = `鏡頭已授權，但預覽播放失敗：${error?.message || String(error)}`;
    window.ProjectUI?.logEvent("camera_preview_failed", { name: error?.name || "Error", message: error?.message || String(error) }, "error");
    refreshCameraCalibrationView();
    showToast(state.cameraLastError);
    return false;
  }
}

function refreshCameraCalibrationView() {
  const empty = document.querySelector(".camera-empty");
  if (empty) empty.hidden = state.cameraReady;
  const permissionStatus = document.querySelector("#cameraPermissionStatus");
  if (permissionStatus) permissionStatus.textContent = state.cameraConnected ? "已授權" : "未開啟";
  const permissionNote = document.querySelector("#cameraPermissionNote");
  if (permissionNote) permissionNote.textContent = state.cameraConnected ? (state.cameraDeviceLabel || "瀏覽器已取得鏡頭授權") : "請先按開啟鏡頭";
  const previewStatus = document.querySelector("#cameraPreviewStatus");
  if (previewStatus) previewStatus.textContent = state.cameraReady ? "已顯示" : "未顯示";
  const previewNote = document.querySelector("#cameraPreviewNote");
  if (previewNote) previewNote.textContent = state.cameraReady ? "正在播放真實鏡頭畫面" : "還沒有可確認的影像";
  const confirmButton = document.querySelector("#cameraConfirmButton");
  if (confirmButton) confirmButton.disabled = !state.cameraReady;
  const openButton = document.querySelector("#cameraOpenButton");
  if (openButton) {
    openButton.disabled = state.cameraOpening;
    openButton.textContent = state.cameraOpening ? "正在開啟..." : "開啟鏡頭";
  }
  const closeButton = document.querySelector("#cameraCloseButton");
  if (closeButton) closeButton.disabled = !state.cameraConnected && !state.cameraOpening;
  const diagnostic = document.querySelector("#cameraDiagnostic");
  if (diagnostic) diagnostic.hidden = !state.cameraLastError;
  const diagnosticMessage = document.querySelector("#cameraDiagnosticMessage");
  if (diagnosticMessage) diagnosticMessage.textContent = state.cameraLastError;
}

function closeCamera({ broadcast = true, silent = false } = {}) {
  if (state.engineMode !== "idle") window.ProjectUI?.sendControl("pause");
  state.cameraRequestId += 1;
  state.cameraOpening = false;
  const stoppedTracks = stopAllCameraStreams();
  state.cameraConnected = false;
  state.cameraReady = false;
  state.cameraCalibrated = false;
  state.cameraLastError = "";
  state.cameraDeviceLabel = "";
  if (broadcast) broadcastStopCamera();
  window.ProjectUI?.logEvent("camera_closed", { stoppedTracks });
  window.ProjectUI?.stopVisionCapture();
  if (!silent) showToast(`鏡頭已關閉，已停止 ${stoppedTracks} 個影像 track。若鏡頭燈仍亮，請關閉其他 localhost 分頁或使用鏡頭的程式。`);
  renderActiveStep();
  updateStatus();
  emitStateChange();
}

function handleCameraTrackEnded(stream) {
  if (stream !== state.cameraStream) return;
  stopAllCameraStreams();
  state.cameraConnected = false;
  state.cameraReady = false;
  state.cameraCalibrated = false;
  state.cameraLastError = "鏡頭串流被瀏覽器或作業系統中斷。請確認沒有其他分頁或程式搶用攝影機，再重新開啟。";
  if (state.engineMode !== "idle") window.ProjectUI?.sendControl("pause");
  window.ProjectUI?.stopVisionCapture();
  window.ProjectUI?.logEvent("camera_track_ended", { deviceLabel: state.cameraDeviceLabel }, "error");
  refreshCameraCalibrationView();
  showToast(state.cameraLastError);
}

function describeCameraError(error) {
  const messages = {
    NotAllowedError: "瀏覽器拒絕鏡頭權限。請在網址列允許 localhost 使用攝影機。",
    NotFoundError: "找不到可用攝影機。請確認 USB 或內建鏡頭已連接。",
    NotReadableError: "攝影機目前無法讀取。通常是其他分頁或程式正在占用鏡頭。",
    OverconstrainedError: "攝影機不支援要求的畫面設定。請重新嘗試或更換鏡頭。",
    AbortError: "瀏覽器中止了鏡頭開啟。請關閉其他使用鏡頭的程式後重試。",
    SecurityError: "瀏覽器安全政策阻止鏡頭。請使用 http://localhost:8765。"
  };
  return messages[error?.name] || error?.message || "請確認瀏覽器權限與攝影機是否被其他程式占用。";
}

function broadcastStopCamera() {
  cameraChannel?.postMessage({ type: "stop-camera", source: cameraSessionId });
}

function stopAllCameraStreams() {
  const streams = new Set(state.cameraStreams);
  if (state.cameraStream) streams.add(state.cameraStream);
  state.cameraStreams.clear();
  state.cameraStream = null;
  document.querySelectorAll("video").forEach((video) => {
    if (video.srcObject) video.srcObject = null;
  });
  let stoppedTracks = 0;
  streams.forEach((stream) => {
    stream.getTracks().forEach((track) => {
      if (track.readyState !== "ended") stoppedTracks += 1;
      track.stop();
    });
  });
  return stoppedTracks;
}

async function connectDevelopmentBoard() {
  if (!navigator.serial) {
    showToast("這個瀏覽器不支援 Web Serial，不能檢查開發板。請改用支援 Web Serial 的瀏覽器或桌面後端。");
    return;
  }

  try {
    await closeSerialPort();
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: Number(state.runtimeSettings.controller?.baudRate) || 115200 });
    state.serialPort = port;
    const response = await sendBoardCommand("PING", 1500);
    if (/board_ready|pong/i.test(response)) {
      state.connectionOk = true;
      state.externalPowerOk = /power_ok/i.test(response);
      showToast(state.externalPowerOk
        ? "開發板已回報 board_ready 與 power_ok。"
        : "開發板已連線，但尚未回報 power_ok。請檢查馬達外部電源與韌體。");
    } else {
      state.connectionOk = false;
      state.externalPowerOk = false;
      await closeSerialPort();
      showToast("開發板有回應，但不是預期的 board_ready。請檢查韌體。");
    }
  } catch (error) {
    state.connectionOk = false;
    state.externalPowerOk = false;
    await closeSerialPort();
    showToast("無法驗證開發板：請確認 USB、瀏覽器權限、韌體與序列埠。");
  }

  renderActiveStep();
  updateStatus();
}

async function testEmergencyStop() {
  if (state.outputBackend === OUTPUT_BACKENDS.NXBT_BLUETOOTH) {
    if (!state.nxbtReady) {
      showToast("尚未連接 NXBT，不能測試 NXBT 軟體急停。");
      return;
    }
    try {
      state.emergencyStopOk = Boolean(await window.ProjectUI?.testNxbtEmergencyStop());
      if (state.emergencyStopOk) state.nxbtReady = false;
    } catch (error) {
      state.emergencyStopOk = false;
      showToast("NXBT 軟體急停測試失敗，不能繼續。");
    }
    renderActiveStep();
    updateStatus();
    return;
  }

  if (!state.connectionOk) {
    showToast("尚未驗證開發板，不能測試急停。");
    return;
  }

  try {
    const response = await sendBoardCommand("ESTOP_TEST", 1500);
    state.emergencyStopOk = /emergency_stop_test_ok/i.test(response);
    if (state.emergencyStopOk && state.outputBackend === OUTPUT_BACKENDS.HYBRID) {
      if (!state.nxbtReady) {
        state.emergencyStopOk = false;
        showToast("混合輸出還需要測試 NXBT 軟體急停。請先連接 NXBT，再重新按測試急停。");
      } else {
        state.emergencyStopOk = Boolean(await window.ProjectUI?.testNxbtEmergencyStop());
        if (state.emergencyStopOk) {
          state.nxbtReady = false;
          showToast("機械治具與 NXBT 急停都已通過。NXBT 模擬手把已移除，請重新連接 NXBT 後再繼續。");
        }
      }
    } else {
      showToast(state.emergencyStopOk ? "急停已由開發板回報測試通過。" : "急停沒有回報通過，不能繼續。");
    }
  } catch (error) {
    state.emergencyStopOk = false;
    showToast("急停測試失敗：沒有收到開發板確認。");
  }

  renderActiveStep();
  updateStatus();
}

async function calibrateSlot(slotId) {
  if (!state.connectionOk) {
    showToast("尚未驗證開發板，不能校正手把輸入。");
    return;
  }

  try {
    const response = await sendBoardCommand(`CALIBRATE ${slotId}`, 2500);
    if (/calibration_ok/i.test(response) && response.includes(slotId)) {
      state.calibratedSlotIds.add(slotId);
      showToast("開發板已回報此輸入校正完成。");
    } else {
      showToast("沒有收到此輸入的校正完成回報。");
    }
  } catch (error) {
    showToast("校正失敗：開發板沒有回報 calibration_ok。");
  }

  renderActiveStep();
  updateStatus();
}

async function sendBoardCommand(command, timeoutMs) {
  if (!state.serialPort?.writable || !state.serialPort?.readable) {
    throw new Error("serial port is not open");
  }

  const writer = state.serialPort.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(`${command}\n`));
  } finally {
    writer.releaseLock();
  }

  const reader = state.serialPort.readable.getReader();
  let timeoutId;
  try {
    const readLoop = (async () => {
      const decoder = new TextDecoder();
      let text = "";
      while (!text.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      return text.trim();
    })();

    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error("serial timeout")), timeoutMs);
    });

    return await Promise.race([readLoop, timeout]);
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation errors after timeout.
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    reader.releaseLock();
  }
}

async function closeSerialPort() {
  if (!state.serialPort) return;
  try {
    await state.serialPort.close();
  } catch {
    // The port may already be closed or locked after a failed read.
  } finally {
    state.serialPort = null;
    state.connectionOk = false;
    state.externalPowerOk = false;
  }
}

async function sendBoardEmergencyStop() {
  if (!state.serialPort?.writable) return false;
  const writer = state.serialPort.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode("ESTOP\n"));
    return true;
  } catch {
    showToast("無法送出開發板 ESTOP，請立即按下實體急停。");
    return false;
  } finally {
    writer.releaseLock();
  }
}

function canRouteEngineAction() {
  return !state.controlPaused && getCurrentSafetyGate().ok && (state.trainingEngineReady || state.liveEngineReady);
}

async function routeRigAction(command, { manualDemonstration = false } = {}) {
  const manualAllowed = manualDemonstration
    && state.engineMode === "idle"
    && !state.controlPaused
    && getCurrentSafetyGate().ok;
  if (!(manualAllowed || canRouteEngineAction())) {
    throw new Error("安全閘門未通過，已阻止機械治具動作。");
  }
  const clamped = clampActionCommand({ ...command, sticks: { ...(command.sticks || {}) }, buttons: { ...(command.buttons || {}) } }, state.rigConfig);
  const response = await sendBoardCommand(JSON.stringify({
    type: "action",
    id: window.crypto?.randomUUID?.() ?? String(Date.now()),
    durationMs: clamped.durationMs,
    sticks: clamped.sticks,
    buttons: clamped.buttons
  }), 900);
  if (!/"ok"\s*:\s*true|action_ok/i.test(response)) throw new Error("開發板沒有確認動作命令。");
  return true;
}

async function routeRigNeutral() {
  if (!state.serialPort?.writable || !state.serialPort?.readable) return false;
  const response = await sendBoardCommand(JSON.stringify({
    type: "neutral",
    id: window.crypto?.randomUUID?.() ?? String(Date.now())
  }), 900);
  return /"ok"\s*:\s*true|neutral_ok/i.test(response);
}

function setControlPaused(paused) {
  state.controlPaused = Boolean(paused);
}

function setEngineRuntimeStatus(status = {}) {
  const previous = `${state.trainingEngineReady}:${state.liveEngineReady}:${state.modelReady}:${state.shadowReady}:${state.engineStatusMessage}`;
  state.trainingEngineReady = Boolean(status.ready);
  state.liveEngineReady = Boolean(status.ready);
  state.engineStatusMessage = String(status.message || (status.ready ? "引擎已接入，尚未開始訓練" : "本地訓練 worker 尚未就緒"));
  state.shadowReady = Boolean(status.shadowReady);
  if (["idle", "training", "live", "canary", "error"].includes(status.mode)) state.engineMode = status.mode;
  if (status.stableReady || status.modelSaved) state.modelReady = true;
  if (status.activeGuidance) state.trainingGuidance = status.activeGuidance;
  const current = `${state.trainingEngineReady}:${state.liveEngineReady}:${state.modelReady}:${state.shadowReady}:${state.engineStatusMessage}`;
  if (current !== previous) {
    renderActiveStep();
    updateStatus();
  }
}

function setTrainingGuidance(guidance) {
  state.trainingGuidance = guidance || null;
  renderActiveStep();
}

function setLatestGameState(gameState = {}) {
  state.latestGameState = gameState;
  if (Number.isFinite(Number(gameState.learningScore))) state.currentScore = Number(gameState.learningScore);
  if (state.currentScore > state.bestScore) state.bestScore = state.currentScore;
  state.needsRecalibration = gameState.confidence !== undefined && Number(gameState.confidence) < 0.45;
  updateStatus();
}

function setDemonstrationRecording(recording) {
  state.demonstrationRecording = Boolean(recording);
  renderActiveStep();
  updateStatus();
}

async function startLivePlay() {
  const safety = getCurrentSafetyGate();
  if (!safety.ok) {
    showToast(`正式遊玩已阻止：${safety.issues[0]}`);
    return;
  }
  if (!state.liveEngineReady) {
    showToast("正式遊玩已阻止：尚未接入正式遊玩控制引擎。");
    return;
  }
  if (!state.modelReady) {
    showToast("正式遊玩已阻止：尚未由真實訓練引擎驗證可用模型。");
    return;
  }

  const started = await window.ProjectUI?.startEngine("live");
  if (!started) return;
  const command = clampActionCommand(createDefaultActionCommand(state.rigConfig), state.rigConfig);
  const nxbtCommand = createNxbtCommand(command);
  const backendName = OUTPUT_BACKEND_PROFILES[state.outputBackend].beginnerName;
  showToast(`正式遊玩已啟動：${backendName}。命令時間 ${nxbtCommand.durationMs} ms，安全閘門保持啟用。`);
}

function setMode(mode, enabled) {
  const modes = new Set(state.livePolicy.modes);
  if (enabled) modes.add(mode);
  else modes.delete(mode);
  state.livePolicy.modes = [...modes];
}

function getCurrentTrainingReadiness() {
  return getTrainingReadiness({
    completedSteps: [...state.completedSteps],
    cameraReady: state.cameraReady,
    cameraCalibrated: state.cameraCalibrated,
    importedVideoName: state.importedVideoName,
    rigConfig: state.rigConfig,
    outputBackend: state.outputBackend,
    emergencyStopOk: state.emergencyStopOk,
    connectionOk: state.connectionOk,
    externalPowerOk: state.externalPowerOk,
    nxbtReady: state.nxbtReady,
    calibratedSlotIds: [...state.calibratedSlotIds]
  });
}

function getCurrentSafetyGate() {
  return evaluateSafetyGate({
    rigConfig: state.rigConfig,
    outputBackend: state.outputBackend,
    cameraReady: state.cameraReady,
    cameraCalibrated: state.cameraCalibrated,
    emergencyStopOk: state.emergencyStopOk,
    connectionOk: state.connectionOk,
    externalPowerOk: state.externalPowerOk,
    nxbtReady: state.nxbtReady,
    calibratedSlotIds: [...state.calibratedSlotIds]
  });
}

function updateStatus() {
  const profile = CONTROLLER_PROFILES[state.selectedProfileId];
  statusController.textContent = profile.beginnerName;
  statusControllerNote.textContent = `${state.rigConfig.slots.length} 個完整控制器輸入 slot`;
  statusScore.textContent = state.bestScore > 0 ? String(state.bestScore) : "尚未訓練";
  statusScoreNote.textContent = state.bestScore > 0
    ? (state.needsRecalibration ? "建議重新校正鏡頭" : "已保存的歷史成績")
    : (state.trainingEngineReady ? "引擎已接入，尚未開始訓練" : state.engineStatusMessage);

  const safety = getCurrentSafetyGate();

  statusSafety.textContent = safety.ok ? "通過" : "待檢查";
  statusSafetyNote.textContent = `${OUTPUT_BACKEND_PROFILES[state.outputBackend].beginnerName}：${safety.nextStep}`;
  fullOnlineAdvanced.checked = state.livePolicy.modes.includes(LIVE_LEARNING_MODES.FULL_ONLINE_UPDATE);
  updateInterval.value = String(state.livePolicy.updateEverySeconds);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function emitStateChange() {
  window.dispatchEvent(new CustomEvent("switch2-state-change"));
}

function getPersistentState(saveReason = "autosave") {
  return {
    activeStepId: state.activeStepId,
    completedSteps: [...state.completedSteps],
    selectedProfileId: state.selectedProfileId,
    outputBackend: state.outputBackend,
    trainingSeconds: state.trainingSeconds,
    bestScore: state.bestScore,
    currentScore: state.currentScore,
    previousStableScore: state.previousStableScore,
    needsRecalibration: state.needsRecalibration,
    importedVideoName: state.importedVideoName,
    livePolicy: JSON.parse(JSON.stringify(state.livePolicy)),
    saveReason
  };
}

async function loadPersistentState(projectId, saved = {}) {
  state.cameraRequestId += 1;
  state.cameraOpening = false;
  stopAllCameraStreams();
  await closeSerialPort();
  state.currentProjectId = projectId;
  state.cameraConnected = false;
  state.cameraReady = false;
  state.cameraCalibrated = false;
  state.cameraLastError = "";
  state.cameraDeviceLabel = "";
  state.connectionOk = false;
  state.externalPowerOk = false;
  state.emergencyStopOk = false;
  state.nxbtReady = false;
  state.trainingEngineReady = false;
  state.liveEngineReady = false;
  state.engineStatusMessage = "正在檢查本地訓練引擎";
  state.modelReady = false;
  state.shadowReady = false;
  state.engineMode = "idle";
  state.controlPaused = false;
  state.trainingGuidance = null;
  state.calibratedSlotIds = new Set();
  const runtimeStepIds = new Set(["device_check", "camera_calibration", "rig_calibration"]);
  state.activeStepId = SETUP_STEPS[0].id;
  state.completedSteps = new Set((Array.isArray(saved.completedSteps) ? saved.completedSteps : [])
    .filter((stepId) => !runtimeStepIds.has(stepId)));
  state.selectedProfileId = CONTROLLER_PROFILES[saved.selectedProfileId] ? saved.selectedProfileId : "switch2_pro";
  state.outputBackend = OUTPUT_BACKEND_PROFILES[saved.outputBackend] ? saved.outputBackend : OUTPUT_BACKENDS.MECHANICAL_RIG;
  state.rigConfig = createConfiguredRigConfig(state.selectedProfileId);
  state.trainingSeconds = Number(saved.trainingSeconds) || 0;
  state.bestScore = Number(saved.bestScore) || 0;
  state.currentScore = Number(saved.currentScore) || 0;
  state.previousStableScore = Number(saved.previousStableScore) || 0;
  state.needsRecalibration = Boolean(saved.needsRecalibration);
  state.importedVideoName = typeof saved.importedVideoName === "string" ? saved.importedVideoName : "";
  state.livePolicy = saved.livePolicy && Array.isArray(saved.livePolicy.modes)
    ? JSON.parse(JSON.stringify(saved.livePolicy))
    : JSON.parse(JSON.stringify(DEFAULT_LIVE_POLICY));
  renderStepList();
  renderActiveStep();
  updateStatus();
  emitStateChange();
}

function cameraConstraints() {
  const camera = state.runtimeSettings.camera ?? {};
  const constraints = {
    width: { ideal: Number(camera.width) || 1280 },
    height: { ideal: Number(camera.height) || 720 },
    frameRate: { ideal: Number(camera.fps) || 30 }
  };
  if (typeof camera.deviceId === "string" && camera.deviceId) constraints.deviceId = { exact: camera.deviceId };
  return constraints;
}

function createConfiguredRigConfig(profileId) {
  const rig = createRigConfig(profileId);
  const controller = state.runtimeSettings.controller ?? {};
  rig.safety.maxCommandMs = Number(controller.maxCommandMs) || rig.safety.maxCommandMs;
  rig.safety.lostConnectionReturnHomeMs = Number(controller.lostConnectionReturnHomeMs) || rig.safety.lostConnectionReturnHomeMs;
  rig.safety.maxTravelMm = Number(controller.maxTravelMm) || 12;
  const globalPressLimit = Number(controller.maxPressMs);
  if (globalPressLimit) {
    rig.slots.forEach((slot) => {
      slot.maxPressMs = Math.min(slot.maxPressMs, globalPressLimit);
    });
  }
  return rig;
}

function applyEffectiveSettings(settings = {}, { preserveSelections = false } = {}) {
  const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const previousProfileId = state.selectedProfileId;
  const previousBackend = state.outputBackend;
  state.runtimeSettings = JSON.parse(JSON.stringify(settings));
  if (!preserveSelections && CONTROLLER_PROFILES[settings.controller?.profile]) state.selectedProfileId = settings.controller.profile;
  if (!preserveSelections && OUTPUT_BACKEND_PROFILES[settings.output?.backend]) state.outputBackend = settings.output.backend;
  state.rigConfig = createConfiguredRigConfig(state.selectedProfileId);
  if (previousProfileId !== state.selectedProfileId || previousBackend !== state.outputBackend) state.calibratedSlotIds.clear();
  const live = settings.liveLearning ?? {};
  const modes = [];
  if (live.safeAdaptation !== false) modes.push(LIVE_LEARNING_MODES.SAFE_ADAPTATION);
  if (live.shadowModel !== false) modes.push(LIVE_LEARNING_MODES.SHADOW_MODEL_LEARNING);
  if (live.fullOnlineUpdate === true) modes.push(LIVE_LEARNING_MODES.FULL_ONLINE_UPDATE);
  state.livePolicy = {
    ...state.livePolicy,
    modes,
    updateEverySeconds: numberOr(live.updateEverySeconds, DEFAULT_LIVE_POLICY.updateEverySeconds),
    switchThresholdPercent: numberOr(live.switchThresholdPercent, DEFAULT_LIVE_POLICY.switchThresholdPercent),
    rollbackDropPercent: numberOr(live.rollbackDropPercent, DEFAULT_LIVE_POLICY.rollbackDropPercent)
  };
  renderStepList();
  renderActiveStep();
  updateStatus();
  emitStateChange();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();

window.AppRuntime = {
  state,
  showToast,
  setActiveStep,
  updateStatus,
  getCurrentSafetyGate,
  getCurrentTrainingReadiness,
  getPersistentState,
  loadPersistentState,
  applyEffectiveSettings,
  closeCamera,
  canRouteEngineAction,
  routeRigAction,
  routeRigNeutral,
  sendBoardEmergencyStop,
  setControlPaused,
  setEngineRuntimeStatus,
  setLatestGameState,
  setDemonstrationRecording,
  setTrainingGuidance
};
