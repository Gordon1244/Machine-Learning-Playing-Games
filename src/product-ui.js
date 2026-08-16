(() => {
  const runtime = window.AppRuntime;
  const categoryLabels = {
    general: "一般與專案",
    camera: "鏡頭與辨識",
    vision: "OCR、畫面與資料集",
    controller: "控制器與治具",
    output: "Serial、NXBT 與混合輸出",
    training: "AI 訓練",
    liveLearning: "即時自我修正",
    reward: "學習分數",
    monitor: "監控視窗",
    assistant: "AI 助手與訓練指導",
    menuNavigation: "選單導航",
    storage: "存檔、快照與備份",
    logging: "日志、重要片段與清理",
    safety: "安全"
  };
  const fieldHelp = {
    autoOpenLastProject: "啟動時自動開啟上次使用的遊戲專案。",
    confidenceThreshold: "辨識信心低於此值時，不把畫面判斷當成可靠結果。",
    maxCommandMs: "單一控制命令最長時間。後端硬性上限為 2000 ms。",
    maxPressMs: "按鍵最長持續按壓時間。後端硬性上限為 2000 ms。",
    maxTravelMm: "機械模組最大行程。後端硬性上限為 20 mm。",
    backend: "選擇機械治具、NXBT 或混合輸出。",
    manualInputRefreshMs: "人工控制多久更新一次方向與按鍵。推薦 120 ms；太高會有延遲，太低會增加 localhost、VM 與 Serial 負載。",
    manualStickDeadzonePercent: "搖桿中心附近忽略輸入的範圍。推薦 8%；太低可能漂移，太高會讓小幅轉向不容易。",
    manualStickSensitivityPercent: "人工搖桿輸出的靈敏度。推薦 100%；太高容易過度轉向，太低可能推不到底。",
    nxbtHost: "Windows 或 macOS 請先依 README 建立 NXBT VM 本機轉送，再填入 127.0.0.1。不要直接填 VirtualBox NAT 位址 10.0.2.15。Linux 原生執行通常也使用 127.0.0.1。",
    nxbtPort: "NXBT VM bridge 監聽的連接埠。推薦維持 8766。",
    nxbtReconnect: "已經配對過 Switch 時可加速重連。第一次配對失敗時請關閉。",
    explorationRate: "AI 嘗試不同做法的比例。過高會讓操作不穩定。",
    captureGamepadDemonstrations: "錄製示範時，從瀏覽器 Gamepad API 讀取雙搖桿與安全按鍵，和鏡頭畫格用同一時間戳保存。",
    demonstrationEpochs: "用同步示範暖身 CNN 與控制策略的次數。太高可能只記住少量示範。",
    gamepadLeftXAxis: "左搖桿左右軸索引。推薦 0；選錯時左右操作會記錄成其他方向。",
    gamepadLeftYAxis: "左搖桿上下軸索引。推薦 1；選錯時加速或方向資料可能不正確。",
    gamepadRightXAxis: "右搖桿左右軸索引。推薦 2；選錯時道具或鏡頭操作可能混入其他軸。",
    gamepadRightYAxis: "右搖桿上下軸索引。推薦 3；選錯時右搖桿示範會不正確。",
    gamepadButtonA: "電腦 Gamepad 對應 A 的按鍵索引。推薦 0；選錯會教成別的按鍵。",
    gamepadButtonB: "電腦 Gamepad 對應 B 的按鍵索引。推薦 1；選錯會教成別的按鍵。",
    gamepadButtonX: "電腦 Gamepad 對應 X 的按鍵索引。推薦 2；選錯會教成別的按鍵。",
    gamepadButtonY: "電腦 Gamepad 對應 Y 的按鍵索引。推薦 3；選錯會教成別的按鍵。",
    gamepadButtonL: "電腦 Gamepad 對應 L 的按鍵索引。推薦 4；選錯會教成別的肩鍵。",
    gamepadButtonR: "電腦 Gamepad 對應 R 的按鍵索引。推薦 5；選錯會教成別的肩鍵。",
    gamepadButtonZL: "電腦 Gamepad 對應 ZL 的按鍵索引。推薦 6；選錯會教成別的扳機。",
    gamepadButtonZR: "電腦 Gamepad 對應 ZR 的按鍵索引。推薦 7；選錯會教成別的扳機。",
    fullOnlineUpdate: "保留全程直接更新主 AI 的要求。第一版 worker 不會直接改寫正在控制的主 AI，仍使用可回滾的旁路更新。",
    rollbackDropPercent: "表現下降多少時回到穩定模型。",
    importantClips: "保存撞牆與失敗時的重大事件畫格。前後短片需要瀏覽器環形錄影緩衝，第一版尚未啟用。",
    abnormalActionDetection: "發現不合理連續動作時立即阻止輸出。",
    defaultGuidanceStrength: "文字指令沒有指定強度時使用的訓練指導幅度。推薦 2；選太高可能偏重單一目標。",
    actionDurationMs: "每一步選單操作持續時間，硬性上限 250 ms。推薦 120 ms；過長可能重複移動。",
    maxSteps: "單次選單任務最多步數，硬性上限 20。推薦 20；太少可能提早要求接手。",
    timeoutSeconds: "單次選單任務逾時秒數，硬性上限 60 秒。推薦 60 秒；太短可能來不及等畫面切換。",
    minimumConfidence: "本地視覺模型執行選單動作的最低信心。推薦 0.6；太低可能在不確定時操作。"
  };
  const dangerousCategories = new Set(["controller", "output", "safety"]);
  const fieldLabels = {
    autoOpenLastProject: "啟動時自動開啟上次專案",
    language: "介面語言",
    pauseButton: "遊戲暫停鍵（預留）",
    gameType: "遊戲類型",
    deviceId: "指定鏡頭",
    width: "鏡頭寬度",
    height: "鏡頭高度",
    fps: "每秒畫面數",
    confidenceThreshold: "最低辨識信心",
    clipSecondsBefore: "事件前短片秒數（預留）",
    clipSecondsAfter: "事件後短片秒數（預留）",
    ocrEnabled: "啟用本地 OCR",
    ocrLanguages: "OCR 語言",
    ocrEverySeconds: "OCR 間隔秒數",
    inferenceFps: "每秒推論畫格",
    datasetSampleFps: "每秒保存抽樣畫格",
    localVisionLlmEverySeconds: "本地視覺 LLM 看圖間隔秒數",
    profile: "控制器類型",
    baudRate: "Serial 速度",
    maxCommandMs: "單次命令最長毫秒",
    maxPressMs: "按鍵最長按壓毫秒",
    maxTravelMm: "馬達最大行程 mm",
    lostConnectionReturnHomeMs: "失聯回中立毫秒",
    backend: "控制輸出方式",
    commandRateHz: "每秒輸出命令數",
    manualInputRefreshMs: "人工控制更新間隔 ms",
    manualStickDeadzonePercent: "人工搖桿死區 %",
    manualStickSensitivityPercent: "人工搖桿靈敏度 %",
    nxbtReconnect: "NXBT 自動重新連線",
    nxbtHost: "NXBT 本機轉送位址",
    nxbtPort: "NXBT VM 連接埠",
    videoPretraining: "允許影片預訓練",
    liveTraining: "允許實機訓練",
    explorationPreset: "探索節奏",
    explorationRate: "嘗試新操作比例",
    captureGamepadDemonstrations: "允許電腦 Gamepad 示範錄製",
    demonstrationEpochs: "示範暖身輪數",
    gamepadLeftXAxis: "左搖桿左右軸索引",
    gamepadLeftYAxis: "左搖桿上下軸索引",
    gamepadRightXAxis: "右搖桿左右軸索引",
    gamepadRightYAxis: "右搖桿上下軸索引",
    gamepadButtonA: "A 按鍵索引",
    gamepadButtonB: "B 按鍵索引",
    gamepadButtonX: "X 按鍵索引",
    gamepadButtonY: "Y 按鍵索引",
    gamepadButtonL: "L 按鍵索引",
    gamepadButtonR: "R 按鍵索引",
    gamepadButtonZL: "ZL 按鍵索引",
    gamepadButtonZR: "ZR 按鍵索引",
    checkpointEveryMinutes: "模型檢查點間隔分鐘",
    safeAdaptation: "安全適應",
    shadowModel: "旁邊練習的備用 AI",
    fullOnlineUpdate: "允許全程即時更新",
    updateEverySeconds: "旁路更新間隔秒數（預留）",
    switchThresholdPercent: "備用 AI 試跑建議門檻 %",
    rollbackDropPercent: "表現下降回滾建議門檻 %",
    rankWeight: "排名分數權重",
    speedWeight: "速度分數權重",
    progressWeight: "進度分數權重",
    crashPenalty: "撞牆扣分",
    fallingBehindPenalty: "落後扣分",
    failurePenalty: "失敗扣分",
    itemEffectBonus: "道具效果加分",
    autoOpen: "自動開啟監控",
    windowMode: "監控顯示方式",
    showAnnotations: "顯示辨識標記",
    showDetails: "顯示可展開詳細側欄（預留）",
    autosaveMode: "自動存檔方式",
    retentionMode: "日志保存方式",
    maxLogGb: "每個專案日志上限 GB",
    trashDays: "回收區保留天數",
    datasetMaxGb: "每個遊戲資料上限 GB",
    events: "保存事件日志",
    actions: "保存動作日志",
    importantClips: "保存重大事件畫格",
    minimumSeverity: "最低日志嚴重度",
    requireCameraPreview: "要求真實鏡頭預覽",
    requireBoardVerification: "要求開發板驗證",
    requireEmergencyStopTest: "要求急停測試",
    abnormalActionDetection: "異常動作偵測",
    defaultGuidanceStrength: "文字指令預設調整強度",
    actionDurationMs: "每步選單動作毫秒",
    maxSteps: "選單任務最多步數",
    timeoutSeconds: "選單任務逾時秒數",
    minimumConfidence: "選單辨識最低信心",
    gamepadDpadUpButton: "方向鍵上按鍵索引",
    gamepadDpadDownButton: "方向鍵下按鍵索引",
    gamepadDpadLeftButton: "方向鍵左按鍵索引",
    gamepadDpadRightButton: "方向鍵右按鍵索引",
    gamepadPlusButton: "+ 按鍵索引",
    gamepadMinusButton: "- 按鍵索引"
  };
  const selectOptions = {
    language: [["zh-Hant", "繁體中文"]],
    gameType: [["racing", "賽車遊戲"]],
    profile: [["switch2_pro", "Switch 2 Pro 手把"], ["joycon2_grip", "Joy-Con 2 握把"]],
    explorationPreset: [["safe", "安全優先"], ["balanced", "平衡模式"], ["fast", "快速探索"]],
    backend: [["mechanical_rig", "機械治具"], ["nxbt_bluetooth", "NXBT 藍牙控制"], ["hybrid", "混合輸出"]],
    windowMode: [["inline", "頁面內視窗"], ["popup", "獨立瀏覽器視窗"]],
    autosaveMode: [["five_minutes_and_round_end", "每 5 分鐘與每回合結束"]],
    retentionMode: [["size_limit", "依容量上限清理"]],
    minimumSeverity: [["info", "一般資訊以上"], ["warning", "警告以上"], ["error", "只保存錯誤"]]
  };
  const nxbtTestButtons = [
    ["dpad_up", "方向鍵 ↑"], ["dpad_down", "方向鍵 ↓"], ["dpad_left", "方向鍵 ←"], ["dpad_right", "方向鍵 →"],
    ["a", "A"], ["b", "B"], ["x", "X"], ["y", "Y"],
    ["l", "L"], ["r", "R"], ["zl", "ZL"], ["zr", "ZR"],
    ["plus", "+"], ["minus", "-"], ["left_stick_press", "左搖桿按下"], ["right_stick_press", "右搖桿按下"]
  ];
  const ui = {
    token: "",
    projects: [],
    trash: [],
    presets: [],
    current: null,
    settings: null,
    monitorSource: null,
    capabilities: null,
    saveTimer: null,
    dirty: false,
    visionTimer: null,
    visionBusy: false,
    visionVideo: null,
    lastOcrAt: 0,
    nxbtPollTimer: null,
    nxbtTestBusy: false,
    nxbtTestPrepared: new Set(),
    manualControlTimer: null,
    manualControlBusy: false,
    manualControlAction: null,
    manualHeldButtons: new Set(),
    manualSticks: {
      left: { x: 0, y: 0 },
      right: { x: 0, y: 0 }
    },
    manualLatchButtons: false,
    manualTakeoverActive: false,
    manualControlSequence: 0,
    lastManualBlockLogAt: 0,
    shuttingDown: false,
    menuTeaching: null,
    menuTaskRunning: false,
    projectLoadSequence: 0
  };

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("X-Session-Token", ui.token);
    if (options.json !== undefined) {
      headers.set("Content-Type", "application/json");
      options.body = JSON.stringify(options.json);
    }
    const response = await fetch(path, { ...options, headers });
    if (!response.ok) {
      let error = {};
      try { error = await response.json(); } catch {}
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    if (options.raw) return response;
    return response.json();
  }

  function createShell() {
    const topbar = document.querySelector(".topbar");
    const tools = document.createElement("div");
    tools.className = "product-tools";
    tools.innerHTML = `
      <button class="secondary-button" id="projectMenuButton" type="button">專案：尚未選擇</button>
      <button class="ghost-button" id="settingsCenterButton" type="button">進階功能</button>
      <button class="ghost-button" id="logsButton" type="button">日志</button>
      <button class="ghost-button" id="monitorButton" type="button">即時監控</button>
      <button class="ghost-button" id="guidanceButton" type="button">訓練指導</button>
      <button class="ghost-button" id="menuNavigatorButton" type="button">選單導航</button>
      <button class="ghost-button" id="assistantButton" type="button">AI 助手</button>
      <button class="ghost-button" id="chipDetectionButton" type="button">晶片偵測</button>
      <button class="shutdown-button" id="shutdownApplicationButton" type="button" title="停止訓練、釋放裝置並關閉 localhost 後端">結束程式</button>
      <span class="engine-badge" id="engineAvailability">真實引擎：檢查中</span>
    `;
    topbar.insertBefore(tools, topbar.lastElementChild);
    document.body.insertAdjacentHTML("beforeend", `
      <dialog class="app-dialog" id="projectDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="settingsDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="logsDialog"></dialog>
      <dialog class="app-dialog monitor-dialog" id="monitorDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="chipDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="dependenciesDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="llmDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="assistantDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="memoriesDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="bindingsDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="guidanceDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="menuDialog"></dialog>
      <dialog class="app-dialog wide-dialog" id="nxbtTestDialog"></dialog>
    `);
    document.querySelector("#projectMenuButton").addEventListener("click", openProjectDialog);
    document.querySelector("#settingsCenterButton").addEventListener("click", openSettings);
    document.querySelector("#logsButton").addEventListener("click", openLogs);
    document.querySelector("#monitorButton").addEventListener("click", openMonitor);
    document.querySelector("#guidanceButton").addEventListener("click", openTrainingGuidance);
    document.querySelector("#menuNavigatorButton").addEventListener("click", openMenuNavigator);
    document.querySelector("#assistantButton").addEventListener("click", openAssistant);
    document.querySelector("#chipDetectionButton").addEventListener("click", openChipDetection);
    document.querySelector("#shutdownApplicationButton").addEventListener("click", shutdownApplication);
  }

  function dialogHeader(title, subtitle = "") {
    return `
      <div class="dialog-header">
        <div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>
        <button class="ghost-button dialog-close" type="button" aria-label="關閉">關閉</button>
      </div>
    `;
  }

  function bindDialogClose(dialog, onClose) {
    dialog.querySelector(".dialog-close")?.addEventListener("click", () => dialog.close());
    if (onClose) dialog.addEventListener("close", onClose, { once: true });
  }

  async function bootstrap() {
    try {
      const data = await api("/api/bootstrap");
      ui.token = data.token;
      ui.projects = data.projects;
      ui.capabilities = null;
      createShell();
      await openProjectDialog({ refresh: false });
      const lastId = data.settings?.lastProjectId;
      window.setInterval(() => saveState("five_minute_autosave"), 5 * 60 * 1000);
      window.addEventListener("switch2-state-change", scheduleSave);
      window.addEventListener("beforeunload", () => saveState("window_close", true));
      window.addEventListener("blur", () => {
        if (manualInputActive() || ui.manualTakeoverActive) void neutralizeManualController();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && (manualInputActive() || ui.manualTakeoverActive)) void neutralizeManualController();
      });
      void hydrateStartup(lastId);
    } catch (error) {
      runtime.showToast(`本機後端尚未啟動：${error.message}`);
    }
  }

  async function hydrateStartup(lastId) {
    if (lastId && ui.projects.some((item) => item.id === lastId)) {
      try {
        await loadProject(lastId, { deferWorkerHealth: true });
      } catch (error) {
        if (!ui.current || ui.current.manifest?.id === lastId) {
          ui.current = null;
          ui.settings = null;
          updateProjectButton();
        }
        runtime.showToast(`無法恢復上次專案：${error.message}。請重新選擇專案。`);
      }
    }
    const dialog = document.querySelector("#projectDialog");
    if (dialog?.open) await openProjectDialog();
    try {
      ui.capabilities = await api("/api/capabilities");
      updateEngineBadge();
      if (ui.current) await refreshWorkerHealth();
    } catch (error) {
      const badge = document.querySelector("#engineAvailability");
      if (badge) badge.textContent = "真實引擎：檢查失敗";
      runtime.showToast(`本地引擎狀態檢查失敗：${error.message}。核心設定仍可使用。`);
    }
  }

  function updateEngineBadge() {
    const badge = document.querySelector("#engineAvailability");
    if (!badge || !ui.capabilities) return;
    const missing = Object.entries(ui.capabilities.modules).filter(([, ready]) => !ready).map(([name]) => name);
    badge.textContent = ui.capabilities.engineConnected ? "真實引擎：已接入" : "真實引擎：未接入";
    if (ui.capabilities.engineConnected) {
      badge.title = missing.length
        ? `本地訓練引擎已接入。尚未安裝的功能套件：${missing.join(", ")}；只有使用對應功能時才需要。${ui.capabilities.note}`
        : ui.capabilities.note;
    } else {
      badge.title = missing.length
        ? `本地訓練引擎目前不可用。缺少套件：${missing.join(", ")}。${ui.capabilities.note}`
        : ui.capabilities.note;
    }
  }

  function openChipDetection() {
    const dialog = document.querySelector("#chipDialog");
    const capabilities = ui.capabilities;
    if (!capabilities) {
      runtime.showToast("晶片與本地引擎仍在背景檢查，請稍後再開啟。");
      return;
    }
    dialog.innerHTML = `
      ${dialogHeader("晶片偵測", "實際晶片與可用執行環境分開顯示。偵測到晶片不代表驅動或訓練套件已經可以使用。")}
      <div class="chip-summary">
        ${chipCard("CPU", capabilities.hardware.cpu.name, capabilities.hardware.cpu.vendor)}
        ${capabilities.hardware.graphics.length
          ? capabilities.hardware.graphics.map((item) => chipCard("顯示晶片", item.name, item.vendor)).join("")
          : chipCard("顯示晶片", "未偵測到", "unknown")}
        ${capabilities.hardware.npuDevices.length
          ? capabilities.hardware.npuDevices.map((item) => chipCard("NPU", item.name, item.vendor)).join("")
          : chipCard("NPU", "未偵測到", "unknown")}
      </div>
      <h3>訓練與即時推論目標 ${info("可用代表目前執行環境已回報可使用。偵測到但不可用時，通常需要安裝驅動、PyTorch 或 OpenVINO。")}</h3>
      <div class="compute-targets">
        ${capabilities.computeTargets.map(computeTargetRow).join("")}
      </div>
      <div class="chip-runtime">
        <p><strong>PyTorch：</strong>${capabilities.runtimes.pytorch.installed ? esc(capabilities.runtimes.pytorch.version) : "尚未安裝"}</p>
        <p><strong>OpenVINO：</strong>${capabilities.runtimes.openvino.installed ? "已安裝" : "尚未安裝"}</p>
        <p><strong>推薦訓練裝置：</strong>${esc(capabilities.recommendedTrainingTarget || "目前沒有可用訓練裝置")}</p>
        <p><strong>推薦即時推論裝置：</strong>${esc(capabilities.recommendedInferenceTarget || "目前沒有可用推論裝置")}</p>
        <p><strong>NXBT 執行方式：</strong>${esc(capabilities.nxbtExecution?.nativeLinux ? "可在 Linux 原生執行" : capabilities.nxbtExecution?.vmHostSupported ? "此主機需透過 Linux VM 執行" : "目前平台未列入 NXBT 官方路徑")}</p>
        <p>${esc(capabilities.nxbtExecution?.note || "")}</p>
      </div>
      <div class="dialog-footer">
        <button class="primary-button" id="refreshChipDetection" type="button">重新偵測晶片</button>
      </div>
    `;
    bindDialogClose(dialog);
    dialog.querySelector("#refreshChipDetection").addEventListener("click", refreshChipDetection);
    if (!dialog.open) dialog.showModal();
  }

  function chipCard(kind, name, vendor) {
    return `<article class="chip-card"><span>${esc(kind)}</span><strong>${esc(name)}</strong><small>${esc(vendor)}</small></article>`;
  }

  function computeTargetRow(item) {
    return `
      <article class="compute-target ${item.usable ? "usable" : ""}">
        <div><strong>${esc(item.label)}</strong><span>${esc(item.role)}</span></div>
        <div><b>${item.usable ? "可用" : item.detected ? "已偵測，尚不可用" : "未偵測"}</b><p>${esc(item.reason)}</p></div>
      </article>
    `;
  }

  async function refreshChipDetection() {
    ui.capabilities = await api("/api/capabilities/refresh", { method: "POST", json: {} });
    updateEngineBadge();
    openChipDetection();
    runtime.showToast("晶片與執行環境已重新偵測。");
  }

  async function refreshProjects() {
    const data = await api("/api/projects");
    ui.projects = data.projects;
    ui.trash = data.trash;
    updateProjectButton();
  }

  function updateProjectButton() {
    const button = document.querySelector("#projectMenuButton");
    if (button) button.textContent = `專案：${ui.current?.manifest?.name || "尚未選擇"}`;
  }

  async function loadProject(id, options = {}) {
    const loadSequence = ++ui.projectLoadSequence;
    ui.menuTeaching = null;
    ui.menuTaskRunning = false;
    stopVisionCapture();
    const project = await api(`/api/projects/${encodeURIComponent(id)}/open`, { method: "POST", json: {} });
    if (loadSequence !== ui.projectLoadSequence) return null;
    ui.current = project;
    ui.settings = project.settings;
    await runtime.loadPersistentState(project.manifest.id, project.state);
    if (loadSequence !== ui.projectLoadSequence) return null;
    runtime.applyEffectiveSettings(project.settings.effective, { preserveSelections: true });
    const guidance = await api(`/api/projects/${project.manifest.id}/training-guidance`);
    if (loadSequence !== ui.projectLoadSequence) return null;
    runtime.setTrainingGuidance(guidance.guidance.slice().reverse().find((item) => ["active", "scheduled"].includes(item.status)) || null);
    updateProjectButton();
    if (!options.deferWorkerHealth) await refreshWorkerHealth();
    runtime.showToast(`已開啟專案：${project.manifest.name}。鏡頭、開發板、急停與 NXBT 請重新驗證。`);
    return project;
  }

  async function openProjectDialog(options = {}) {
    if (options?.refresh !== false) await refreshProjects();
    const dialog = document.querySelector("#projectDialog");
    dialog.innerHTML = `
      ${dialogHeader("遊戲專案", "每個遊戲分開保存設定、訓練進度、快照與日志。")}
      <form class="project-create" id="projectCreateForm">
        <input required maxlength="120" name="name" placeholder="例如：Mario Kart World" />
        <button class="primary-button" type="submit">新增專案</button>
        <label class="secondary-button import-label">匯入 ZIP<input id="projectImport" type="file" accept=".zip,application/zip" hidden /></label>
      </form>
      <div class="project-list">
        ${ui.projects.length ? ui.projects.map(projectRow).join("") : `<p class="empty-state">尚未建立專案。請先新增一個遊戲專案。</p>`}
      </div>
      ${ui.current ? `
        <details class="trash-box">
          <summary>目前專案快照 (${ui.current.snapshots?.length || 0})</summary>
          <div class="row-actions"><button class="secondary-button" id="projectSnapshot" type="button">建立快照</button></div>
          ${ui.current.snapshots?.length ? ui.current.snapshots.map(snapshotRow).join("") : `<p class="empty-state">尚未建立快照。</p>`}
        </details>
      ` : ""}
      <details class="trash-box">
        <summary>回收區 (${ui.trash.length})</summary>
        ${ui.trash.length ? ui.trash.map(trashRow).join("") : `<p class="empty-state">回收區是空的。</p>`}
      </details>
    `;
    bindDialogClose(dialog);
    bindProjectEvents(dialog);
    if (!dialog.open) dialog.showModal();
  }

  function projectRow(project) {
    const active = project.id === ui.current?.manifest?.id;
    return `
      <div class="project-row ${active ? "active-project" : ""}">
        <div><strong>${esc(project.name)}</strong><span>${esc(project.gameType || "racing")} · ${esc(project.updatedAt || "")}</span></div>
        <div class="row-actions">
          <button class="secondary-button" data-project-open="${esc(project.id)}" type="button">${active ? "目前專案" : "開啟"}</button>
          <button class="ghost-button" data-project-rename="${esc(project.id)}" type="button">重新命名</button>
          <button class="ghost-button" data-project-export="${esc(project.id)}" type="button">匯出</button>
          <button class="danger-link" data-project-delete="${esc(project.id)}" type="button">刪除</button>
        </div>
      </div>
    `;
  }

  function trashRow(project) {
    return `
      <div class="project-row">
        <div><strong>${esc(project.name)}</strong><span>刪除時間：${esc(project.deletedAt || "")}</span></div>
        <div class="row-actions">
          <button class="secondary-button" data-trash-restore="${esc(project.id)}" type="button">復原</button>
          <button class="danger-link" data-trash-delete="${esc(project.id)}" type="button">永久刪除</button>
        </div>
      </div>
    `;
  }

  function snapshotRow(snapshot) {
    return `
      <div class="project-row">
        <div><strong>${esc(snapshot.name)}</strong><span>${esc(snapshot.createdAt || "")}</span></div>
        <button class="secondary-button" data-snapshot-restore="${esc(snapshot.id)}" type="button">恢復</button>
      </div>
    `;
  }

  function bindProjectEvents(dialog) {
    dialog.querySelector("#projectCreateForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = new FormData(event.currentTarget).get("name");
      const project = await api("/api/projects", { method: "POST", json: { name } });
      await loadProject(project.manifest.id);
      dialog.close();
    });
    dialog.querySelector("#projectImport").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const project = await api("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: file
      });
      await loadProject(project.manifest.id);
      dialog.close();
    });
    dialog.querySelector("#projectSnapshot")?.addEventListener("click", async () => {
      await createSnapshot();
      ui.current = await api(`/api/projects/${ui.current.manifest.id}`);
      openProjectDialog();
    });
    dialog.querySelectorAll("[data-project-open]").forEach((button) => button.addEventListener("click", async () => {
      await saveState("project_switch");
      await loadProject(button.dataset.projectOpen);
      dialog.close();
    }));
    dialog.querySelectorAll("[data-project-rename]").forEach((button) => button.addEventListener("click", async () => {
      const project = ui.projects.find((item) => item.id === button.dataset.projectRename);
      const name = window.prompt("新的專案名稱", project?.name || "");
      if (!name) return;
      await api(`/api/projects/${button.dataset.projectRename}`, { method: "PUT", json: { name } });
      openProjectDialog();
    }));
    dialog.querySelectorAll("[data-project-export]").forEach((button) => button.addEventListener("click", () => exportProject(button.dataset.projectExport)));
    dialog.querySelectorAll("[data-project-delete]").forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("要將這個專案移到回收區嗎？")) return;
      await api(`/api/projects/${button.dataset.projectDelete}`, { method: "DELETE" });
      if (ui.current?.manifest?.id === button.dataset.projectDelete) {
        ui.current = null;
        await runtime.loadPersistentState("", {});
      }
      openProjectDialog();
    }));
    dialog.querySelectorAll("[data-trash-restore]").forEach((button) => button.addEventListener("click", async () => {
      await api(`/api/trash/${button.dataset.trashRestore}/restore`, { method: "POST", json: {} });
      openProjectDialog();
    }));
    dialog.querySelectorAll("[data-trash-delete]").forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("永久刪除後無法復原。確定要刪除嗎？")) return;
      await api(`/api/trash/${button.dataset.trashDelete}`, { method: "DELETE" });
      openProjectDialog();
    }));
    dialog.querySelectorAll("[data-snapshot-restore]").forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("要恢復這個快照嗎？目前尚未保存的變更會被取代。")) return;
      const project = await api(`/api/projects/${ui.current.manifest.id}/snapshots/${button.dataset.snapshotRestore}/restore`, { method: "POST", json: {} });
      await loadProject(project.manifest.id);
      dialog.close();
    }));
  }

  async function exportProject(id) {
    const response = await api(`/api/projects/${id}/export`, { method: "POST", json: {}, raw: true });
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || `${id}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function openSettings() {
    if (!requireProject()) return;
    const [settings, presets] = await Promise.all([
      api(`/api/projects/${ui.current.manifest.id}/settings`),
      api("/api/settings/presets")
    ]);
    ui.settings = settings;
    ui.presets = presets.presets;
    const displayedSettings = structuredClone(settings.effective);
    displayedSettings.output.backend = runtime.state.outputBackend;
    displayedSettings.controller.profile = runtime.state.selectedProfileId;
    renderSettings(displayedSettings);
  }

  function renderSettings(values, search = "") {
    const dialog = document.querySelector("#settingsDialog");
    dialog.innerHTML = `
      ${dialogHeader("進階功能", "一般使用者可直接使用推薦值。危險設定需要手動解鎖，且無法突破硬性上限。")}
      <div class="settings-toolbar">
        <input id="settingsSearch" placeholder="搜尋設定" value="${esc(search)}" />
        <select id="presetSelect"><option value="">選擇內建或自訂模板</option>${ui.presets.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}</select>
        <button class="secondary-button" id="applyPreset" type="button">套用模板</button>
        <button class="secondary-button" id="savePreset" type="button">另存模板</button>
        <button class="secondary-button" id="dependenciesButton" type="button">套件管理</button>
        <button class="secondary-button" id="llmSettingsButton" type="button">LLM 設定</button>
      </div>
      <label class="danger-unlock"><input id="dangerUnlock" type="checkbox" /> 解鎖危險設定 ${info("危險設定會影響治具動作。推薦維持預設值；選錯可能造成異常按壓，但後端硬性上限仍不會被突破。")}</label>
      <div class="settings-categories">
        ${Object.entries(values).map(([category, fields]) => categoryEditor(category, fields, search, values)).join("")}
      </div>
      <div class="dialog-footer">
        <button class="ghost-button" id="resetAllSettings" type="button">全部重設</button>
        <button class="secondary-button" id="saveGlobalSettings" type="button">存為全域預設</button>
        <button class="primary-button" id="saveProjectSettings" type="button">保存此遊戲設定</button>
      </div>
    `;
    bindDialogClose(dialog);
    bindSettingsEvents(dialog, values);
    if (!dialog.open) dialog.showModal();
  }

  function categoryEditor(category, fields, search, allValues) {
    const label = categoryLabels[category] || category;
    const items = Object.entries(fields).filter(([key]) => `${label} ${key} ${fieldLabels[key] || ""}`.toLowerCase().includes(search.toLowerCase()));
    if (!items.length) return "";
    return `
      <details class="settings-category" open>
        <summary><strong>${esc(label)}</strong><button class="danger-link" data-reset-category="${esc(category)}" type="button">重設分類</button></summary>
        <div class="settings-grid">
          ${items.map(([key, value]) => settingControl(category, key, value, allValues)).join("")}
        </div>
      </details>
    `;
  }

  function settingControl(category, key, value, allValues) {
    const locked = dangerousCategories.has(category) ? "data-dangerous disabled" : "";
    const label = fieldLabels[key] || key;
    const help = fieldHelp[key] || `這是「${label}」設定。推薦先使用預設值；不確定時不需要調整。`;
    if (selectOptions[key]) {
      const nxbtProfileLocked = category === "controller" && key === "profile" && ["nxbt_bluetooth", "hybrid"].includes(allValues.output?.backend);
      return `<label class="setting-row"><span>${esc(label)} ${info(help)}</span><select data-setting="${esc(category)}.${esc(key)}" ${locked} ${nxbtProfileLocked ? "data-nxbt-profile-lock" : ""}>${selectOptions[key].map(([option, text]) => `<option value="${esc(option)}" ${option === value ? "selected" : ""} ${nxbtProfileLocked && option !== "switch2_pro" ? "disabled" : ""}>${esc(text)}</option>`).join("")}</select>${category === "controller" && key === "profile" ? `<small data-nxbt-profile-note ${nxbtProfileLocked ? "" : "hidden"}>NXBT 只能使用 Switch 2 Pro 手把。</small>` : ""}</label>`;
    }
    if (typeof value === "boolean") {
      return `<label class="setting-row"><span>${esc(label)} ${info(help)}</span><input data-setting="${esc(category)}.${esc(key)}" type="checkbox" ${value ? "checked" : ""} ${locked} /></label>`;
    }
    if (typeof value === "number") {
      return `<label class="setting-row"><span>${esc(label)} ${info(help)}</span><input data-setting="${esc(category)}.${esc(key)}" type="number" value="${esc(value)}" ${locked} /></label>`;
    }
    return `<label class="setting-row"><span>${esc(label)} ${info(help)}</span><input data-setting="${esc(category)}.${esc(key)}" value="${esc(value)}" ${locked} /></label>`;
  }

  function info(text) {
    return `<span class="info" data-tooltip="${esc(`${text} 推薦：維持預設值。選錯會怎樣：可能降低辨識、訓練或控制穩定度。`)}" tabindex="0">i</span>`;
  }

  function bindSettingsEvents(dialog, values) {
    const syncControllerBackendCompatibility = () => {
      const backendInput = dialog.querySelector('[data-setting="output.backend"]');
      const profileInput = dialog.querySelector('[data-setting="controller.profile"]');
      if (!backendInput || !profileInput) return;
      const nxbtLocked = ["nxbt_bluetooth", "hybrid"].includes(backendInput.value);
      if (nxbtLocked) profileInput.value = "switch2_pro";
      profileInput.querySelector('option[value="joycon2_grip"]')?.toggleAttribute("disabled", nxbtLocked);
      profileInput.toggleAttribute("data-nxbt-profile-lock", nxbtLocked);
      const dangerUnlocked = Boolean(dialog.querySelector("#dangerUnlock")?.checked);
      profileInput.disabled = nxbtLocked || !dangerUnlocked;
      const note = dialog.querySelector("[data-nxbt-profile-note]");
      if (note) note.hidden = !nxbtLocked;
    };
    dialog.querySelector("#settingsSearch").addEventListener("change", (event) => renderSettings(values, event.target.value));
    dialog.querySelector("#dependenciesButton").addEventListener("click", openDependencies);
    dialog.querySelector("#llmSettingsButton").addEventListener("click", openLlmSettings);
    dialog.querySelector("#dangerUnlock").addEventListener("change", (event) => {
      dialog.querySelectorAll("[data-dangerous]").forEach((input) => { input.disabled = !event.target.checked; });
      syncControllerBackendCompatibility();
    });
    dialog.querySelector('[data-setting="output.backend"]')?.addEventListener("change", syncControllerBackendCompatibility);
    dialog.querySelector("#saveProjectSettings").addEventListener("click", async () => {
      const next = readSettings(dialog, values);
      ui.settings = await api(`/api/projects/${ui.current.manifest.id}/settings`, { method: "PUT", json: next });
      runtime.applyEffectiveSettings(ui.settings.effective);
      runtime.showToast("已保存此遊戲的進階設定。");
      dialog.close();
    });
    dialog.querySelector("#saveGlobalSettings").addEventListener("click", async () => {
      const next = readSettings(dialog, values);
      await api("/api/settings/global", { method: "PUT", json: next });
      runtime.showToast("已更新全域預設。");
      dialog.close();
    });
    dialog.querySelector("#resetAllSettings").addEventListener("click", () => renderSettings(ui.settings.defaults));
    dialog.querySelectorAll("[data-reset-category]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      const next = structuredClone(values);
      next[button.dataset.resetCategory] = structuredClone(ui.settings.defaults[button.dataset.resetCategory]);
      renderSettings(next);
    }));
    dialog.querySelector("#applyPreset").addEventListener("click", () => {
      const preset = ui.presets.find((item) => item.id === dialog.querySelector("#presetSelect").value);
      if (!preset) return;
      renderSettings(deepMerge(values, preset.settings));
    });
    dialog.querySelector("#savePreset").addEventListener("click", async () => {
      const name = window.prompt("模板名稱");
      if (!name) return;
      await api("/api/settings/presets", { method: "POST", json: { name, settings: readSettings(dialog, values) } });
      runtime.showToast("自訂模板已保存。");
      dialog.close();
    });
    syncControllerBackendCompatibility();
  }

  function readSettings(dialog, base) {
    const next = structuredClone(base);
    dialog.querySelectorAll("[data-setting]").forEach((input) => {
      const [category, key] = input.dataset.setting.split(".");
      next[category][key] = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
    });
    return next;
  }

  function deepMerge(base, override) {
    const merged = structuredClone(base);
    Object.entries(override || {}).forEach(([key, value]) => {
      merged[key] = value && typeof value === "object" && !Array.isArray(value) ? deepMerge(merged[key] || {}, value) : value;
    });
    return merged;
  }

  async function openLogs() {
    if (!requireProject()) return;
    const dialog = document.querySelector("#logsDialog");
    dialog.innerHTML = `
      ${dialogHeader("詳細日志", "錯誤、硬體、設定、存檔、快照、回合摘要與控制操作都保存在目前專案。")}
      <form class="logs-filter" id="logsFilter">
        <input name="q" placeholder="搜尋文字" />
        <input name="from" type="datetime-local" aria-label="開始時間" />
        <input name="to" type="datetime-local" aria-label="結束時間" />
        <select name="severity"><option value="">所有嚴重度</option><option>info</option><option>warning</option><option>error</option></select>
        <select name="source"><option value="">所有來源</option><option>project</option><option>storage</option><option>settings</option><option>control</option><option>camera</option><option>ui</option></select>
        <input name="round" placeholder="回合 ID" />
        <input name="errorType" placeholder="錯誤類型" />
        <button class="secondary-button" type="submit">篩選</button>
      </form>
      <div class="logs-clear">
        <select id="logsClearScope">
          <option value="events">只刪除事件日志</option>
          <option value="actions">只刪除動作日志</option>
          <option value="all">刪除全部日志</option>
        </select>
        <label><input id="logsClearClips" type="checkbox" /> 同時刪除重要片段</label>
        <button class="danger-link" id="logsClearButton" type="button">手動清除</button>
      </div>
      <div class="logs-table-wrap"><table class="logs-table"><thead><tr><th>時間</th><th>嚴重度</th><th>來源</th><th>事件</th><th>詳細資料</th></tr></thead><tbody id="logsBody"></tbody></table></div>
    `;
    bindDialogClose(dialog);
    dialog.querySelector("#logsFilter").addEventListener("submit", (event) => {
      event.preventDefault();
      loadLogs(new URLSearchParams(new FormData(event.currentTarget)));
    });
    dialog.querySelector("#logsClearButton").addEventListener("click", clearLogs);
    await loadLogs();
    if (!dialog.open) dialog.showModal();
  }

  async function clearLogs() {
    const scope = document.querySelector("#logsClearScope").value;
    const includeClips = document.querySelector("#logsClearClips").checked;
    const labels = { events: "事件日志", actions: "動作日志", all: "全部日志" };
    const clipNote = includeClips ? "及重要片段" : "";
    if (!window.confirm(`確定要刪除目前專案的${labels[scope]}${clipNote}嗎？此操作無法復原。`)) return;
    const result = await api(`/api/projects/${ui.current.manifest.id}/logs`, {
      method: "DELETE",
      json: { scope, includeClips }
    });
    runtime.showToast(`已清除 ${result.deletedFiles} 個日志檔案與 ${result.deletedClips} 個片段。`);
    await loadLogs();
  }

  async function loadLogs(params = new URLSearchParams()) {
    const data = await api(`/api/projects/${ui.current.manifest.id}/logs?${params}`);
    const body = document.querySelector("#logsBody");
    if (!body) return;
    body.innerHTML = data.logs.length ? data.logs.map((item) => `
      <tr><td>${esc(item.timestamp)}</td><td>${esc(item.severity)}</td><td>${esc(item.source)}</td><td>${esc(item.event)}</td><td><code>${esc(JSON.stringify(item.details))}</code></td></tr>
    `).join("") : `<tr><td colspan="5">沒有符合條件的日志。</td></tr>`;
  }

  async function openMonitor({ forceInline = false } = {}) {
    if (!requireProject()) return;
    const monitorSettings = runtime.state.runtimeSettings.monitor || {};
    if (!forceInline && monitorSettings.windowMode === "popup") {
      const child = window.open(`/monitor.html?project=${encodeURIComponent(ui.current.manifest.id)}`, "switch2-monitor", "width=1120,height=760");
      if (child) return;
      runtime.showToast("瀏覽器阻擋獨立視窗，已退回頁面內監控。");
    }
    const dialog = document.querySelector("#monitorDialog");
    dialog.innerHTML = `
      ${dialogHeader("即時監控", "只有真實引擎回報後才會顯示速度、排名、道具、碰撞與辨識信心。")}
      <div class="monitor-toolbar">
        <button class="secondary-button" data-monitor-control="pause" type="button">暫停</button>
        <button class="secondary-button" data-monitor-control="resume" type="button">繼續</button>
        <button class="secondary-button" data-monitor-control="stop" type="button">停止並存檔</button>
        <button class="danger-button" data-monitor-control="emergency-stop" type="button">急停</button>
        <button class="secondary-button" id="monitorSnapshot" type="button">建立快照</button>
        <button class="ghost-button" id="openMonitorWindow" type="button">獨立視窗</button>
      </div>
      <div class="monitor-layout">
        <div class="monitor-video"><video id="monitorVideo" autoplay playsinline muted></video><div class="monitor-roi" ${monitorSettings.showAnnotations === false ? "hidden" : ""}>ROI</div><p id="monitorCameraNote">鏡頭尚未開啟。</p></div>
        <aside class="monitor-details" id="monitorDetails"></aside>
      </div>
    `;
    bindDialogClose(dialog, () => disconnectMonitor(dialog));
    bindMonitor(dialog);
    attachMonitorCamera(dialog.querySelector("#monitorVideo"), dialog.querySelector("#monitorCameraNote"));
    connectMonitor(dialog.querySelector("#monitorDetails"));
    if (!dialog.open) dialog.showModal();
  }

  function bindMonitor(dialog) {
    dialog.querySelectorAll("[data-monitor-control]").forEach((button) => button.addEventListener("click", async () => {
      await sendControl(button.dataset.monitorControl);
      if (button.dataset.monitorControl === "stop") await saveState("stop_and_save");
    }));
    dialog.querySelector("#monitorSnapshot").addEventListener("click", createSnapshot);
    dialog.querySelector("#openMonitorWindow").addEventListener("click", () => {
      const child = window.open(`/monitor.html?project=${encodeURIComponent(ui.current.manifest.id)}`, "switch2-monitor", "width=1120,height=760");
      if (!child) runtime.showToast("瀏覽器阻擋獨立視窗，已保留頁面內監控。");
    });
  }

  function attachMonitorCamera(video, note) {
    if (runtime.state.cameraStream) {
      video.srcObject = runtime.state.cameraStream;
      note.textContent = runtime.state.cameraReady ? "正在顯示真實鏡頭畫面。" : "鏡頭已授權，但尚未確認有影像。";
    } else {
      note.textContent = "鏡頭尚未開啟。";
    }
  }

  function connectMonitor(target) {
    ui.monitorSource?.close();
    ui.monitorSource = new EventSource(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/monitor/stream`);
    ui.monitorSource.onmessage = (event) => renderMonitorDetails(target, JSON.parse(event.data));
    ui.monitorSource.onerror = () => {
      if (target.isConnected) target.innerHTML = `<p>監控連線暫時中斷，瀏覽器正在重新連線。</p>`;
    };
  }

  function disconnectMonitor(dialog) {
    ui.monitorSource?.close();
    ui.monitorSource = null;
    const video = dialog.querySelector("#monitorVideo");
    if (video) video.srcObject = null;
  }

  function renderMonitorDetails(target, status) {
    const game = status.lastGameState || {};
    target.innerHTML = `
      <h3>即時摘要</h3>
      ${monitorMetric("AI 模式", status.mode)}
      ${monitorMetric("狀態", status.paused ? "已暫停" : "待命")}
      ${monitorMetric("訓練/控制引擎", status.engineReady ? "已接入" : "未接入")}
      ${monitorMetric("視覺辨識", status.visionReady ? "已接入" : "未接入")}
      ${monitorMetric("控制輸出", status.controllerReady ? "已接入" : "未接入")}
      ${monitorMetric("模型", status.modelReady ? "可用" : "未驗證")}
      ${monitorMetric("速度", game.speed ?? "等待辨識")}
      ${monitorMetric("排名", game.rank ?? "等待辨識")}
      ${monitorMetric("進度", game.progress === null || game.progress === undefined ? "等待辨識" : `${game.progress}%`)}
      ${monitorMetric("道具", game.itemState || "等待辨識")}
      ${monitorMetric("碰撞 / 失敗", game.failed ? "已辨識失敗" : game.crashed ? "可能碰撞" : "未辨識到")}
      ${monitorMetric("OCR 信心", game.confidence === undefined ? "等待辨識" : game.confidence)}
      <p>${esc(status.message)}</p>
    `;
  }

  function monitorMetric(label, value) {
    return `<div class="monitor-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  async function openDependencies() {
    const dialog = document.querySelector("#dependenciesDialog");
    const data = await api("/api/dependencies");
    dialog.innerHTML = `
      ${dialogHeader("套件管理", "套件會安裝在專案的 .runtime/venv，不會修改系統 Python。每個套件可以單獨安裝。")}
      <div class="row-actions"><button class="primary-button" data-install-package="recommended" type="button">安裝推薦套件</button></div>
      <div class="dependency-list">
        ${data.packages.map((item) => `
          <div class="dependency-row">
            <div><strong>${esc(item.label)}</strong><p>${esc(item.pip)}${item.recommended ? " · 推薦" : " · 選配"}</p></div>
            <span>${item.installed ? "已安裝" : item.status === "installing" ? "安裝中" : item.status === "failed" ? "安裝失敗" : "尚未安裝"}</span>
            <button class="secondary-button" data-install-package="${esc(item.id)}" type="button" ${item.status === "installing" ? "disabled" : ""}>${item.installed ? "重新安裝" : "安裝"}</button>
          </div>
        `).join("")}
      </div>
      <p class="helper-text">安裝會下載套件，耗時依網路與電腦速度而定。完成後重新開啟此頁確認狀態。</p>
    `;
    bindDialogClose(dialog);
    dialog.querySelectorAll("[data-install-package]").forEach((button) => button.addEventListener("click", async () => {
      const packageId = button.dataset.installPackage;
      const path = packageId === "recommended" ? "/api/dependencies/install" : `/api/dependencies/${encodeURIComponent(packageId)}/install`;
      const result = await api(path, { method: "POST", json: {} });
      runtime.showToast(result.message);
      await refreshWorkerHealth().catch(() => {});
      await openDependencies();
    }));
    if (!dialog.open) dialog.showModal();
  }

  async function openLlmSettings() {
    const dialog = document.querySelector("#llmDialog");
    const settings = await api("/api/settings/llm");
    dialog.innerHTML = `
      ${dialogHeader("LLM 設定", "預設優先使用本機 Ollama 或 LM Studio。LLM 失聯時 OCR、資料收集與訓練仍可繼續。")}
      <div class="row-actions">
        <button class="secondary-button" id="detectLlmButton" type="button">自動偵測本地 LLM</button>
        <button class="secondary-button" id="testLlmButton" type="button">測試連線</button>
      </div>
      <div class="settings-grid">
        <label class="setting-row"><span>OpenAI-compatible URL ${info("Ollama 推薦 http://localhost:11434/v1；LM Studio 推薦 http://localhost:1234/v1。")}</span><input id="llmBaseUrl" value="${esc(settings.baseUrl)}" placeholder="http://localhost:11434/v1" /></label>
        <label class="setting-row"><span>文字模型</span><input id="llmTextModel" value="${esc(settings.textModel)}" placeholder="例如 qwen3:8b" /></label>
        <label class="setting-row"><span>視覺模型</span><input id="llmVisionModel" value="${esc(settings.visionModel)}" placeholder="選填" /></label>
        <label class="setting-row"><span>API key</span><input id="llmApiKey" type="password" placeholder="${settings.hasApiKey ? "已設定；留空可沿用" : "本地模型通常可留空"}" /></label>
        <label class="setting-row"><span>記住金鑰</span><input id="llmRememberKey" type="checkbox" ${settings.rememberApiKey ? "checked" : ""} /></label>
        <label class="setting-row"><span>本地視覺模型可自動看畫面</span><input id="llmAutoVision" type="checkbox" ${settings.localVisionAutoFrames ? "checked" : ""} /></label>
        <label class="setting-row"><span>自動看畫面間隔秒數</span><input id="llmVisionInterval" type="number" min="5" max="3600" value="${esc(settings.visionFrameIntervalSeconds)}" /></label>
      </div>
      <div class="dialog-footer"><button class="primary-button" id="saveLlmSettings" type="button">保存 LLM 設定</button></div>
      <div class="alert" id="llmStatus">尚未執行測試。</div>
    `;
    bindDialogClose(dialog);
    const payload = () => ({
      baseUrl: dialog.querySelector("#llmBaseUrl").value,
      textModel: dialog.querySelector("#llmTextModel").value,
      visionModel: dialog.querySelector("#llmVisionModel").value,
      apiKey: dialog.querySelector("#llmApiKey").value,
      rememberApiKey: dialog.querySelector("#llmRememberKey").checked,
      localVisionAutoFrames: dialog.querySelector("#llmAutoVision").checked,
      visionFrameIntervalSeconds: Number(dialog.querySelector("#llmVisionInterval").value) || 15
    });
    dialog.querySelector("#detectLlmButton").addEventListener("click", async () => {
      const result = await api("/api/llm/detect", { method: "POST", json: {} });
      dialog.querySelector("#llmStatus").textContent = result.message;
      if (result.providers[0]) {
        dialog.querySelector("#llmBaseUrl").value = result.providers[0].baseUrl;
        if (!dialog.querySelector("#llmTextModel").value) dialog.querySelector("#llmTextModel").value = result.providers[0].models[0] || "";
      }
    });
    dialog.querySelector("#testLlmButton").addEventListener("click", async () => {
      try {
        const result = await api("/api/llm/test", { method: "POST", json: payload() });
        dialog.querySelector("#llmStatus").textContent = `${result.message} ${result.reply}`;
      } catch (error) {
        dialog.querySelector("#llmStatus").textContent = `測試失敗：${error.message}`;
      }
    });
    dialog.querySelector("#saveLlmSettings").addEventListener("click", async () => {
      await api("/api/settings/llm", { method: "PUT", json: payload() });
      runtime.showToast("LLM 設定已保存。API key 不會寫入專案 JSON 或匯出檔。");
      dialog.close();
    });
    if (!dialog.open) dialog.showModal();
  }

  async function openAssistant() {
    if (!requireProject()) return;
    const dialog = document.querySelector("#assistantDialog");
    const [data, status] = await Promise.all([
      api(`/api/projects/${ui.current.manifest.id}/assistant/chat`),
      api("/api/assistant/status")
    ]);
    dialog.innerHTML = `
      ${dialogHeader("AI 助手", "常用指令先由本機離線規則理解；只有複雜文字才使用選配 LLM。")}
      <div class="alert ${status.connected ? "success" : "warning"}">${esc(status.message)}</div>
      <div class="row-actions">
        <button class="secondary-button" id="openMemoriesButton" type="button">AI 記憶</button>
        <button class="secondary-button" id="openBindingsButton" type="button">控制器用途</button>
        <button class="secondary-button" id="openGuidanceButton" type="button">訓練指導</button>
        <button class="secondary-button" id="openMenuButton" type="button">選單導航</button>
        <button class="secondary-button" id="assistantLookButton" type="button" ${status.configured ? "" : "disabled"}>讓 LLM 看目前畫面</button>
        ${status.retryPaused ? `<button class="secondary-button" id="assistantReconnectButton" type="button">重新連線</button>` : ""}
        <button class="danger-link" id="clearAssistantButton" type="button">清除對話</button>
      </div>
      <div class="assistant-messages" id="assistantMessages">${renderAssistantMessages(data.messages)}</div>
      <form class="assistant-compose" id="assistantForm">
        <textarea name="message" rows="3" placeholder="例如：記住 A 是加速鍵。或：幫我建立快照。"></textarea>
        <button class="primary-button" type="submit">送出</button>
      </form>
    `;
    bindDialogClose(dialog);
    dialog.querySelector("#openMemoriesButton").addEventListener("click", openMemories);
    dialog.querySelector("#openBindingsButton").addEventListener("click", openControlBindings);
    dialog.querySelector("#openGuidanceButton").addEventListener("click", openTrainingGuidance);
    dialog.querySelector("#openMenuButton").addEventListener("click", openMenuNavigator);
    dialog.querySelector("#assistantReconnectButton")?.addEventListener("click", async () => {
      await api("/api/assistant/reconnect", { method: "POST", json: {} });
      await openAssistant();
    });
    dialog.querySelector("#assistantLookButton").addEventListener("click", async () => {
      try {
        const result = await api(`/api/projects/${ui.current.manifest.id}/assistant/look`, { method: "POST", json: {} });
        runtime.showToast(`LLM 已看目前畫面：${result.message}`);
        await openAssistant();
      } catch (error) {
        runtime.showToast(`LLM 無法查看畫面：${error.message}`);
      }
    });
    dialog.querySelector("#clearAssistantButton").addEventListener("click", async () => {
      if (!window.confirm("確定刪除目前專案的 AI 助手對話嗎？")) return;
      await api(`/api/projects/${ui.current.manifest.id}/assistant/chat`, { method: "DELETE", json: {} });
      await openAssistant();
    });
    dialog.querySelector("#assistantForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = new FormData(event.currentTarget).get("message");
      if (!String(message || "").trim()) return;
      const result = await api(`/api/projects/${ui.current.manifest.id}/assistant/chat`, { method: "POST", json: { message, defaultGuidanceStrength: runtime.state.runtimeSettings.assistant?.defaultGuidanceStrength || 2 } });
      if (result.directive) await runAssistantDirective(result.directive);
      await openAssistant();
    });
    dialog.querySelectorAll("[data-confirm-proposal]").forEach((button) => button.addEventListener("click", async () => {
      const result = await api(`/api/projects/${ui.current.manifest.id}/proposals/${encodeURIComponent(button.dataset.confirmProposal)}/confirm`, { method: "POST", json: {} });
      await runAssistantDirective(result.directive);
      runtime.showToast("已套用確認後的 AI 助手變更。");
      await openAssistant();
    }));
    if (!dialog.open) dialog.showModal();
  }

  function renderAssistantMessages(messages) {
    if (!messages.length) return `<p class="helper-text">尚無對話。沒有 LLM 仍可使用常用文字指令與圖形化表單。</p>`;
    return messages.map((item) => `
      <article class="assistant-message ${item.role === "user" ? "from-user" : "from-assistant"}">
        <strong>${item.role === "user" ? "你" : "AI 助手"}${item.role !== "user" && item.source ? ` · ${item.source === "offline" ? "離線規則理解" : "LLM 理解"}` : ""}</strong>
        <p>${esc(item.content)}</p>
        ${item.proposal?.payload ? `<p class="helper-text">預計變更：${esc(JSON.stringify(item.proposal.payload))}</p>` : ""}
        ${item.proposal?.status === "pending" ? `<button class="primary-button" data-confirm-proposal="${esc(item.proposal.id)}" type="button">確認套用</button>` : ""}
      </article>
    `).join("");
  }

  async function runAssistantDirective(directive) {
    if (!directive?.action) return;
    if (directive.action === "pause" || directive.action === "resume") await sendControl(directive.action);
    if (directive.action === "snapshot") await createSnapshot();
    if (directive.action === "start_training") runtime.showToast("已確認訓練要求。請到訓練頁檢查安全閘門後按「開始實機訓練」。");
    if (directive.action === "start_live") runtime.showToast("已確認正式遊玩要求。請到正式遊玩頁檢查安全閘門後按「開始正式遊玩」。");
    if (directive.action === "stop_and_save") {
      await sendControl("stop");
      await saveState("assistant_stop_and_save");
    }
    if (directive.action === "save_memory") runtime.showToast("AI 記憶已保存。");
    if (directive.action === "update_strategy") runtime.showToast("已保存確認後的策略記憶。");
    if (directive.action === "switch_model") runtime.showToast("已切換確認後的 LLM 文字模型。");
    if (directive.action === "save_control_binding") runtime.showToast("控制器用途已保存到目前遊戲。");
    if (directive.action === "activate_guidance") {
      runtime.showToast(directive.result?.message || "訓練指導已確認，將從下一回合生效。");
      await openTrainingGuidance();
    }
    if (directive.action === "record_menu_workflow") {
      ui.menuTeaching = directive.result?.workflow || null;
      if (ui.menuTeaching) startVisionCapture();
      await openMenuNavigator();
    }
    if (directive.action === "start_menu_task") {
      const task = directive.result?.task;
      await openMenuNavigator();
      if (task && task.status === "paused") await runMenuTask(task.id);
    }
  }

  async function openMemories() {
    if (!requireProject()) return;
    const dialog = document.querySelector("#memoriesDialog");
    const data = await api(`/api/projects/${ui.current.manifest.id}/memories`);
    dialog.innerHTML = `
      ${dialogHeader("AI 記憶", "按鈕用途、目前目標、策略、文字別名與筆記。專案記憶可升為所有遊戲共用。")}
      <div class="row-actions"><button class="secondary-button" id="addMemoryButton" type="button">新增記憶</button><button class="primary-button" id="saveMemoriesButton" type="button">保存修改</button></div>
      <div class="memory-list" id="memoryList">${data.memories.map(memoryEditor).join("") || `<p class="helper-text">目前沒有已確認記憶。</p>`}</div>
    `;
    bindDialogClose(dialog);
    dialog.querySelector("#addMemoryButton").addEventListener("click", () => {
      dialog.querySelector("#memoryList").insertAdjacentHTML("beforeend", memoryEditor({ id: crypto.randomUUID(), scope: "project", type: "user_note", key: "", value: "", note: "" }));
    });
    dialog.querySelector("#saveMemoriesButton").addEventListener("click", async () => {
      const memories = [...dialog.querySelectorAll("[data-memory-row]")].filter((row) => row.dataset.scope !== "global").map((row) => ({
        id: row.dataset.memoryRow, type: row.querySelector("[data-memory-type]").value, key: row.querySelector("[data-memory-key]").value,
        value: row.querySelector("[data-memory-value]").value, note: row.querySelector("[data-memory-note]").value
      }));
      await api(`/api/projects/${ui.current.manifest.id}/memories`, { method: "PUT", json: { memories } });
      runtime.showToast("AI 記憶已保存。");
      dialog.close();
    });
    dialog.querySelectorAll("[data-promote-memory]").forEach((button) => button.addEventListener("click", async () => {
      await api(`/api/projects/${ui.current.manifest.id}/memories/${encodeURIComponent(button.dataset.promoteMemory)}/promote`, { method: "POST", json: {} });
      await openMemories();
    }));
    if (!dialog.open) dialog.showModal();
  }

  function memoryEditor(item) {
    return `<div class="memory-row" data-memory-row="${esc(item.id)}" data-scope="${esc(item.scope)}">
      <select data-memory-type ${item.scope === "global" ? "disabled" : ""}>${["button_mapping","control_binding","menu_workflow","screen_landmark","current_goal","strategy","ocr_alias","user_note"].map((type) => `<option ${type === item.type ? "selected" : ""}>${type}</option>`).join("")}</select>
      <input data-memory-key value="${esc(item.key)}" placeholder="名稱" ${item.scope === "global" ? "disabled" : ""} />
      <input data-memory-value value="${esc(item.value)}" placeholder="內容" ${item.scope === "global" ? "disabled" : ""} />
      <input data-memory-note value="${esc(item.note)}" placeholder="備註" ${item.scope === "global" ? "disabled" : ""} />
      <span>${item.scope === "global" ? "全域" : "目前遊戲"}</span>
      ${item.scope === "project" ? `<button class="secondary-button" data-promote-memory="${esc(item.id)}" type="button">升為全域</button>` : ""}
    </div>`;
  }

  const bindingInputs = [
    "left_stick", "right_stick", "left_stick_x", "left_stick_y", "right_stick_x", "right_stick_y",
    "dpad_up", "dpad_down", "dpad_left", "dpad_right",
    "a", "b", "x", "y", "l", "r", "zl", "zr", "plus", "minus"
  ];

  function bindingRow(item) {
    return `<div class="memory-row" data-binding-row="${esc(item.id || crypto.randomUUID())}">
      <select data-binding-context>${[["race","比賽"],["menu","選單"],["global","全域"]].map(([value,label]) => `<option value="${value}" ${item.context === value ? "selected" : ""}>${label}</option>`).join("")}</select>
      <select data-binding-input>${bindingInputs.map((value) => `<option value="${value}" ${item.input === value ? "selected" : ""}>${value}</option>`).join("")}</select>
      <input data-binding-meaning value="${esc(item.meaning || "")}" placeholder="用途，例如：加速" />
      <input data-binding-conditions value="${esc(item.conditions || "")}" placeholder="使用情境（可留白）" />
      <input data-binding-hold type="number" min="20" max="700" value="${Number(item.holdMs) || 120}" aria-label="按住毫秒" />
      <button class="danger-link" data-remove-binding type="button">刪除</button>
    </div>`;
  }

  async function openControlBindings() {
    if (!requireProject()) return;
    document.querySelector("#assistantDialog")?.close();
    const dialog = document.querySelector("#bindingsDialog");
    const data = await api(`/api/projects/${ui.current.manifest.id}/control-bindings`);
    dialog.innerHTML = `
      ${dialogHeader("控制器用途", "用途依比賽、選單或全域分開保存。HOME 與截圖鍵永久不允許自動操作。")}
      <div class="row-actions"><button class="secondary-button" id="addBindingButton" type="button">新增用途</button><button class="primary-button" id="saveBindingsButton" type="button">保存</button></div>
      <div class="alert warning">按鍵持續時間推薦 120 ms；過長可能重複觸發，系統硬性限制最多 700 ms。 <button class="info" type="button" data-tooltip="這是什麼：一次按鍵保持的時間。推薦：120 ms。選錯：太短可能沒按到，太長可能按兩次。">i</button></div>
      <div id="bindingList">${data.bindings.map(bindingRow).join("") || `<p class="helper-text">尚未保存控制器用途。</p>`}</div>
    `;
    bindDialogClose(dialog);
    const bindRemove = () => dialog.querySelectorAll("[data-remove-binding]").forEach((button) => button.onclick = () => button.closest("[data-binding-row]").remove());
    bindRemove();
    dialog.querySelector("#addBindingButton").addEventListener("click", () => {
      const list = dialog.querySelector("#bindingList");
      if (list.querySelector(".helper-text")) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", bindingRow({ context: "race", input: "a", holdMs: 120 }));
      bindRemove();
    });
    dialog.querySelector("#saveBindingsButton").addEventListener("click", async () => {
      const bindings = [...dialog.querySelectorAll("[data-binding-row]")].map((row) => ({
        id: row.dataset.bindingRow, context: row.querySelector("[data-binding-context]").value,
        input: row.querySelector("[data-binding-input]").value, meaning: row.querySelector("[data-binding-meaning]").value,
        conditions: row.querySelector("[data-binding-conditions]").value, holdMs: Number(row.querySelector("[data-binding-hold]").value), source: "user"
      }));
      await api(`/api/projects/${ui.current.manifest.id}/control-bindings`, { method: "PUT", json: { bindings } });
      runtime.showToast("控制器用途已保存到目前遊戲。");
      dialog.close();
    });
    if (!dialog.open) dialog.showModal();
  }

  async function openTrainingGuidance() {
    if (!requireProject()) return;
    document.querySelector("#assistantDialog")?.close();
    const dialog = document.querySelector("#guidanceDialog");
    const data = await api(`/api/projects/${ui.current.manifest.id}/training-guidance`);
    const shownGuidance = data.active || data.guidance.slice().reverse().find((item) => item.status === "scheduled");
    const defaultStrength = Number(runtime.state.runtimeSettings.assistant?.defaultGuidanceStrength) || 2;
    const goalOptions = [
      ["reduce_crashes", "少撞牆"], ["maintain_speed", "優先保持速度"], ["improve_rank", "優先提升排名"],
      ["avoid_falling_behind", "不要落後"], ["conserve_items", "保守使用道具"], ["use_items_aggressively", "積極使用道具"]
    ];
    dialog.innerHTML = `
      ${dialogHeader("訓練指導", "CNN + PPO 可完全離線訓練。這裡只用白話調整學習方向，所有變更都先預覽。")}
      <div class="alert ${data.active ? "success" : "warning"}">${shownGuidance ? `${shownGuidance.status === "scheduled" ? "等待下一回合" : "目前生效"}：${esc(shownGuidance.goalLabel)}（版本 ${esc(shownGuidance.version)}）` : "目前沒有額外訓練指導，使用專案原本的學習分數。"}</div>
      <form id="guidanceForm" class="settings-grid">
        <label>想改善的行為 <button class="info" type="button" data-tooltip="這是什麼：下一回合最重視的學習方向。推薦：先選少撞牆。選錯：不會破壞安全限制，但可能讓成績改善方向不符合預期。">i</button><select name="goal">${goalOptions.map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
        <label>調整強度 <button class="info" type="button" data-tooltip="這是什麼：單次改變學習權重的幅度。推薦：標準 20%。選錯：太強可能偏重單一目標；硬性上限仍是 25%。">i</button><select name="strength"><option value="1" ${defaultStrength === 1 ? "selected" : ""}>輕微 10%</option><option value="2" ${defaultStrength === 2 ? "selected" : ""}>標準 20%</option><option value="3" ${defaultStrength === 3 ? "selected" : ""}>較強 25%</option></select></label>
        <button class="secondary-button" type="submit">預覽變更</button>
      </form>
      <div id="guidancePreview"></div>
      <div class="memory-list">${data.guidance.slice().reverse().map((item) => `<div class="memory-row"><strong>v${esc(item.version)} ${esc(item.goalLabel)}</strong><span>${esc(item.status)}</span><span>${esc(item.source)}</span></div>`).join("") || `<p class="helper-text">尚無版本記錄。</p>`}</div>
    `;
    bindDialogClose(dialog);
    dialog.querySelector("#guidanceForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const result = await api(`/api/projects/${ui.current.manifest.id}/training-guidance/preview`, { method: "POST", json: { goal: form.get("goal"), strength: Number(form.get("strength")), source: "form" } });
      const preview = dialog.querySelector("#guidancePreview");
      preview.innerHTML = `<div class="alert warning"><strong>套用前確認</strong><p>${esc(result.message)}</p><button class="primary-button" id="activateGuidanceButton" type="button">確認，下一回合生效</button></div>`;
      preview.querySelector("#activateGuidanceButton").addEventListener("click", async () => {
        const activated = await api(`/api/projects/${ui.current.manifest.id}/training-guidance/${encodeURIComponent(result.guidance.id)}/activate`, { method: "POST", json: {} });
        runtime.setTrainingGuidance(activated.guidance);
        runtime.showToast(activated.message);
        await openTrainingGuidance();
      });
    });
    if (!dialog.open) dialog.showModal();
  }

  async function openMenuNavigator() {
    if (!requireProject()) return;
    document.querySelector("#assistantDialog")?.close();
    const dialog = document.querySelector("#menuDialog");
    const data = await api(`/api/projects/${ui.current.manifest.id}/menu/workflows`);
    dialog.innerHTML = `
      ${dialogHeader("選單導航", "優先使用你教過的流程；沒有可靠流程或本地視覺模型時會停止並請你接手。")}
      <div class="alert warning">每一步最多 250 ms，執行後都會回中立並重新確認畫面。HOME 與截圖鍵永久禁止。 <button class="info" type="button" data-tooltip="這是什麼：選單操作安全限制。推薦：保持預設。選錯：此限制不可解除，避免 AI 在陌生畫面連續亂按。">i</button></div>
      <section class="settings-section"><h3>教 AI 一次</h3>
        <div class="row-actions"><input id="workflowName" value="${esc(ui.menuTeaching?.name || "")}" placeholder="例如：進入 150cc 大獎賽" ${ui.menuTeaching ? "disabled" : ""}/>
        <button class="${ui.menuTeaching ? "danger-link" : "primary-button"}" id="toggleMenuTeaching" type="button">${ui.menuTeaching ? "停止並保存" : "開始錄製"}</button></div>
        <p class="helper-text">需要先開啟鏡頭、完成安全檢查並連接電腦 Gamepad。選單資料不會進入賽車 PPO。</p>
      </section>
      <section class="settings-section"><h3>前往選單目標</h3><form id="menuTaskForm" class="row-actions"><input name="target" placeholder="例如：進入 150cc 大獎賽"/><button class="primary-button" type="submit">開始引導</button></form><div id="menuTaskStatus"></div></section>
      <section class="settings-section"><h3>已保存流程</h3><div class="memory-list">${data.workflows.map((item) => `<div class="memory-row"><strong>${esc(item.name)}</strong><span>${item.builtIn ? "內建模板" : `${(item.steps || []).length} 步`}</span><button class="secondary-button" data-replay-workflow="${esc(item.id)}" type="button" ${(item.steps || []).length ? "" : "disabled"}>逐步重播</button></div>`).join("") || `<p class="helper-text">尚無流程。</p>`}</div></section>
    `;
    bindDialogClose(dialog);
    dialog.querySelector("#toggleMenuTeaching").addEventListener("click", async () => {
      if (ui.menuTeaching) {
        const result = await api(`/api/projects/${ui.current.manifest.id}/menu/workflows/record`, { method: "POST", json: { operation: "stop", workflowId: ui.menuTeaching.id } });
        ui.menuTeaching = null;
        await neutralizeOutputs();
        runtime.showToast(result.message);
        await openMenuNavigator();
        return;
      }
      const name = dialog.querySelector("#workflowName").value.trim();
      if (!name) return runtime.showToast("請先替這段選單操作命名。");
      if (!runtime.state.cameraReady) return runtime.showToast("請先開啟鏡頭並確認畫面。");
      if (!readGamepadMenuAction()) return runtime.showToast("找不到電腦 Gamepad，請先連接並按一下按鍵。");
      const result = await api(`/api/projects/${ui.current.manifest.id}/menu/workflows/record`, { method: "POST", json: { operation: "start", name } });
      ui.menuTeaching = result.workflow;
      startVisionCapture();
      runtime.showToast(result.message);
      await openMenuNavigator();
    });
    dialog.querySelector("#menuTaskForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const target = String(new FormData(event.currentTarget).get("target") || "").trim();
      if (!target) return;
      const menu = runtime.state.runtimeSettings.menuNavigation || {};
      const result = await api(`/api/projects/${ui.current.manifest.id}/menu/tasks`, { method: "POST", json: { target, maxSteps: menu.maxSteps, timeoutSeconds: menu.timeoutSeconds, minimumConfidence: menu.minimumConfidence, actionDurationMs: menu.actionDurationMs } });
      dialog.querySelector("#menuTaskStatus").innerHTML = `<div class="alert ${result.task.status === "needs_user" ? "warning" : "success"}">${esc(result.message)}</div>`;
      if (result.task.status === "paused" && window.confirm("流程已準備。要開始逐步執行嗎？")) await runMenuTask(result.task.id);
    });
    dialog.querySelectorAll("[data-replay-workflow]").forEach((button) => button.addEventListener("click", async () => {
      const menu = runtime.state.runtimeSettings.menuNavigation || {};
      const result = await api(`/api/projects/${ui.current.manifest.id}/menu/workflows/${encodeURIComponent(button.dataset.replayWorkflow)}/replay`, { method: "POST", json: { maxSteps: menu.maxSteps, timeoutSeconds: menu.timeoutSeconds, minimumConfidence: menu.minimumConfidence, actionDurationMs: menu.actionDurationMs } });
      if (window.confirm("將逐步重播並在每一步重新確認畫面。要開始嗎？")) await runMenuTask(result.task.id);
    }));
    if (!dialog.open) dialog.showModal();
  }

  async function refreshWorkerHealth() {
    const health = await api(ui.current?.manifest?.id ? `/api/projects/${ui.current.manifest.id}/engine/health` : "/api/worker/health");
    runtime.setEngineRuntimeStatus(health.training || health);
    return health;
  }

  async function startEngine(action = "start") {
    if (!requireProject()) return false;
    try {
      const preset = runtime.state.runtimeSettings.training?.explorationPreset || "safe";
      const modes = runtime.state.livePolicy.modes;
      const result = await api(`/api/projects/${ui.current.manifest.id}/engine/${action}`, {
        method: "POST",
        json: {
          preset,
          checkpointMinutes: runtime.state.runtimeSettings.training?.checkpointEveryMinutes || 5,
          explorationRate: runtime.state.runtimeSettings.training?.explorationRate ?? 0.1,
          livePolicy: {
            safeAdaptation: modes.includes("safe_adaptation"),
            shadowModel: modes.includes("shadow_model_learning"),
            fullOnlineUpdate: modes.includes("full_online_update")
          }
        }
      });
      runtime.setEngineRuntimeStatus(result);
      runtime.showToast(result.message);
      if (result.ready) startVisionCapture();
      if (result.ready && ["start", "live"].includes(action) && runtime.state.runtimeSettings.monitor?.autoOpen !== false) {
        await openMonitor();
      }
      return Boolean(result.ready);
    } catch (error) {
      runtime.showToast(`引擎尚未啟動：${error.message}`);
      return false;
    }
  }

  async function stopEngine() {
    if (!requireProject()) return;
    const result = await api(`/api/projects/${ui.current.manifest.id}/engine/stop`, { method: "POST", json: {} });
    runtime.setEngineRuntimeStatus(result);
    runtime.showToast(result.message);
  }

  function startVisionCapture() {
    stopVisionCapture();
    if (!runtime.state.cameraStream || !ui.current?.manifest?.id) return;
    const settings = runtime.state.runtimeSettings.vision || {};
    const output = runtime.state.runtimeSettings.output || {};
    const fps = Math.max(1, Math.min(15, Number(settings.inferenceFps) || 5, Number(output.commandRateHz) || 10));
    ui.visionVideo = document.createElement("video");
    ui.visionVideo.srcObject = runtime.state.cameraStream;
    ui.visionVideo.muted = true;
    ui.visionVideo.playsInline = true;
    ui.visionVideo.play().catch(() => {});
    ui.visionTimer = window.setInterval(captureVisionFrame, Math.round(1000 / fps));
  }

  function stopVisionCapture() {
    window.clearInterval(ui.visionTimer);
    ui.visionTimer = null;
    if (ui.visionVideo) ui.visionVideo.srcObject = null;
    ui.visionVideo = null;
  }

  async function captureVisionFrame() {
    if (runtime.state.screenCornersManual && runtime.state.screenManualPhase === "adjusting") return;
    if (ui.visionBusy || !ui.visionVideo?.videoWidth || !ui.current?.manifest?.id) return;
    const cameraVerificationId = runtime.state.cameraVerificationId;
    ui.visionBusy = true;
    try {
      const settings = runtime.state.runtimeSettings.vision || {};
      const canvas = document.createElement("canvas");
      canvas.width = ui.visionVideo.videoWidth;
      canvas.height = ui.visionVideo.videoHeight;
      canvas.getContext("2d").drawImage(ui.visionVideo, 0, 0);
      const now = Date.now();
      const runOcr = settings.ocrEnabled !== false && now - ui.lastOcrAt >= (Number(settings.ocrEverySeconds) || 1) * 1000;
      if (runOcr) ui.lastOcrAt = now;
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
      const menuDemonstration = ui.menuTeaching ? readGamepadMenuAction() : null;
      const demonstration = !ui.menuTeaching && runtime.state.demonstrationRecording ? readGamepadDemonstration() : null;
      const result = await api(`/api/projects/${ui.current.manifest.id}/vision/frame`, {
        method: "POST",
        json: {
          imageBase64,
          runOcr,
          languages: String(settings.ocrLanguages || "ch_tra,en").split(","),
          rewardConfig: runtime.state.runtimeSettings.reward || {},
          demonstrationAction: demonstration?.action,
          demonstrationController: demonstration?.controller,
          menuMode: Boolean(ui.menuTeaching || ui.menuTaskRunning),
          menuWorkflowId: ui.menuTeaching?.id || "",
          menuDemonstrationAction: menuDemonstration?.action,
          cameraSessionId: runtime.state.cameraVerificationId,
          screenCorners: runtime.state.screenDetected || runtime.state.screenCandidatePassed || runtime.state.screenCornersManual ? runtime.state.screenCorners : [],
          screenCornerSource: runtime.state.screenCornersManual ? "manual" : "locked_auto"
        }
      });
      if (cameraVerificationId !== runtime.state.cameraVerificationId) return;
      runtime.setLatestGameState(result.state);
      runtime.setEngineRuntimeStatus(result.engine || {});
      if (ui.menuTeaching && menuDemonstration && !isNeutralMenuAction(menuDemonstration.action)) {
        await dispatchMenuAction(menuDemonstration.action);
      } else if (runtime.state.demonstrationRecording && demonstration) {
        demonstration.action.sourceFrameId = result.state?.frameId || "";
        await dispatchDemonstrationAction(demonstration.action);
      } else if (result.action) {
        await dispatchEngineAction(result.action);
      }
    } catch (error) {
      if (cameraVerificationId === runtime.state.cameraVerificationId) {
        runtime.setLatestGameState({ message: `畫格處理暫停：${error.message}`, confidence: 0 });
      }
    } finally {
      ui.visionBusy = false;
    }
  }

  async function requestVisionCapture() {
    if (!ui.visionVideo && runtime.state.cameraStream) startVisionCapture();
    await captureVisionFrame();
  }

  function manualInputTiming() {
    const configured = Number(runtime.state.runtimeSettings.output?.manualInputRefreshMs);
    const refreshMs = Math.round(Math.max(80, Math.min(500, Number.isFinite(configured) ? configured : 120)));
    return { refreshMs, durationMs: Math.max(40, refreshMs - 20) };
  }

  function shapeManualStick(x, y) {
    const output = runtime.state.runtimeSettings.output || {};
    const deadzone = Math.max(0, Math.min(0.3, (Number(output.manualStickDeadzonePercent) || 8) / 100));
    const sensitivity = Math.max(0.5, Math.min(1.5, (Number(output.manualStickSensitivityPercent) || 100) / 100));
    const length = Math.min(1, Math.hypot(x, y) / 100);
    if (length <= deadzone) return { x: 0, y: 0 };
    const shapedLength = Math.min(1, ((length - deadzone) / Math.max(0.01, 1 - deadzone)) * sensitivity);
    const scale = shapedLength / Math.max(length, 0.001);
    return {
      x: Math.round(Math.max(-100, Math.min(100, x * scale))),
      y: Math.round(Math.max(-100, Math.min(100, y * scale)))
    };
  }

  function manualAction() {
    const { durationMs } = manualInputTiming();
    return {
      durationMs,
      priority: "manual",
      sticks: {
        left_stick_x: ui.manualSticks.left.x,
        left_stick_y: ui.manualSticks.left.y,
        right_stick_x: ui.manualSticks.right.x,
        right_stick_y: ui.manualSticks.right.y
      },
      buttons: Object.fromEntries(Array.from(ui.manualHeldButtons, (button) => [button, true]))
    };
  }

  function manualInputActive() {
    return ui.manualHeldButtons.size > 0
      || Object.values(ui.manualSticks).some((stick) => stick.x !== 0 || stick.y !== 0);
  }

  function describeManualAction(action) {
    const sticks = action.sticks || {};
    const activeSticks = ["left", "right"].flatMap((side) => {
      const x = Number(sticks[`${side}_stick_x`] || 0);
      const browserY = Number(sticks[`${side}_stick_y`] || 0);
      if (!x && !browserY) return [];
      const label = side === "left" ? "左" : "右";
      return [`${label}桿 X ${x}, Y ${browserY}（NXBT Y ${-browserY}）`];
    });
    const buttons = Object.keys(action.buttons || {}).filter((key) => action.buttons[key]).map((key) => key.toUpperCase());
    return [...activeSticks, buttons.length ? `按鍵 ${buttons.join("+")}` : ""].filter(Boolean).join("；") || "中立";
  }

  function updateManualStatus(message, error = false) {
    const status = document.querySelector("[data-manual-control-status]");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  async function dispatchManualControllerAction(action) {
    if (!requireProject()) throw new Error("請先選擇遊戲專案。");
    const liveTakeover = runtime.state.engineMode === "live";
    if (!liveTakeover && runtime.state.engineMode !== "idle") throw new Error("人工控制只能在訓練停止時，或正式遊玩人工接管時使用。");
    if (runtime.state.controlPaused) throw new Error("控制目前已暫停，不能送出人工輸入。");
    if (liveTakeover && !runtime.canRouteEngineAction()) throw new Error("正式遊玩的引擎或安全閘門未就緒，不能人工接管。");
    const backend = runtime.state.outputBackend;
    if (backend === "mechanical_rig" || backend === "hybrid") {
      await runtime.routeRigAction(action, liveTakeover ? {} : { manualPreflight: true });
    }
    if (backend === "nxbt_bluetooth" || backend === "hybrid") {
      await api(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/nxbt/manual-action`, {
        method: "POST",
        json: { ...action, manualTakeover: liveTakeover }
      });
    }
  }

  function resetManualInputState() {
    window.clearInterval(ui.manualControlTimer);
    ui.manualControlTimer = null;
    ui.manualControlAction = null;
    ui.manualHeldButtons.clear();
    ui.manualSticks.left = { x: 0, y: 0 };
    ui.manualSticks.right = { x: 0, y: 0 };
    document.querySelectorAll("[data-manual-button].is-active").forEach((button) => button.classList.remove("is-active"));
    document.querySelectorAll(".manual-stick-knob").forEach((knob) => { knob.style.transform = "translate(0px, 0px)"; });
  }

  async function neutralizeManualController() {
    const sequence = ++ui.manualControlSequence;
    const wasTakeover = ui.manualTakeoverActive;
    resetManualInputState();
    try {
      const backend = runtime.state.outputBackend;
      if (backend === "mechanical_rig" || backend === "hybrid") await runtime.routeRigNeutral();
      if ((backend === "nxbt_bluetooth" || backend === "hybrid") && ui.current?.manifest?.id) {
        await api(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/nxbt/manual-action`, {
          method: "POST",
          json: { durationMs: 20, sticks: {}, buttons: {} }
        });
      }
      if (sequence === ui.manualControlSequence) updateManualStatus(wasTakeover ? "已確認回中立，控制已交還 AI。" : "控制器已回到中立。");
    } catch (error) {
      updateManualStatus(`回中立未確認：${error.message}`, true);
    } finally {
      if (sequence === ui.manualControlSequence) ui.manualTakeoverActive = false;
    }
  }

  async function sendCurrentManualAction() {
    if (ui.manualControlBusy || !ui.manualControlAction) return;
    ui.manualControlBusy = true;
    const sequence = ui.manualControlSequence;
    try {
      const action = ui.manualControlAction;
      await dispatchManualControllerAction(action);
      if (sequence === ui.manualControlSequence) updateManualStatus(`${ui.manualTakeoverActive ? "人工接管中" : "人工控制已送出"}：${describeManualAction(action)}。`);
    } catch (error) {
      if (sequence === ui.manualControlSequence) {
        resetManualInputState();
        ui.manualTakeoverActive = false;
        updateManualStatus(`人工控制未送出：${error.message}`, true);
      }
    } finally {
      ui.manualControlBusy = false;
    }
  }

  function refreshManualControl() {
    if (!manualInputActive()) {
      void neutralizeManualController();
      return;
    }
    ui.manualControlSequence += 1;
    ui.manualControlAction = manualAction();
    ui.manualTakeoverActive = runtime.state.engineMode === "live";
    void sendCurrentManualAction();
    if (!ui.manualControlTimer) ui.manualControlTimer = window.setInterval(sendCurrentManualAction, manualInputTiming().refreshMs);
  }

  function bindManualControllerControls(root) {
    const latch = root.querySelector("[data-manual-latch]");
    if (latch) {
      latch.checked = ui.manualLatchButtons;
      latch.addEventListener("change", () => {
        ui.manualLatchButtons = latch.checked;
        if (!ui.manualLatchButtons && ui.manualHeldButtons.size) {
          ui.manualHeldButtons.clear();
          root.querySelectorAll("[data-manual-button].is-active").forEach((button) => button.classList.remove("is-active"));
          refreshManualControl();
        }
      });
    }
    root.querySelectorAll("[data-manual-button]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (button.disabled) return;
        const input = button.dataset.manualButton;
        if (ui.manualLatchButtons) {
          if (ui.manualHeldButtons.has(input)) ui.manualHeldButtons.delete(input);
          else ui.manualHeldButtons.add(input);
          button.classList.toggle("is-active", ui.manualHeldButtons.has(input));
          refreshManualControl();
          return;
        }
        button.setPointerCapture(event.pointerId);
        button.dataset.manualPressed = "true";
        ui.manualHeldButtons.add(input);
        button.classList.add("is-active");
        refreshManualControl();
      });
      const release = () => {
        if (ui.manualLatchButtons || button.dataset.manualPressed !== "true") return;
        delete button.dataset.manualPressed;
        ui.manualHeldButtons.delete(button.dataset.manualButton);
        button.classList.remove("is-active");
        refreshManualControl();
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    });
    root.querySelectorAll("[data-manual-stick]").forEach((stickPad) => {
      const knob = stickPad.querySelector(".manual-stick-knob");
      const side = stickPad.dataset.manualStick;
      let activePointerId = null;
      const move = (event) => {
        const box = stickPad.getBoundingClientRect();
        const radius = Math.max(1, Math.min(box.width, box.height) * 0.37);
        let dx = event.clientX - (box.left + box.width / 2);
        let dy = event.clientY - (box.top + box.height / 2);
        const length = Math.hypot(dx, dy);
        if (length > radius) {
          dx = dx / length * radius;
          dy = dy / length * radius;
        }
        if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
        ui.manualSticks[side] = shapeManualStick(dx / radius * 100, dy / radius * 100);
        refreshManualControl();
      };
      stickPad.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        if (activePointerId !== null) return;
        activePointerId = event.pointerId;
        stickPad.setPointerCapture(event.pointerId);
        move(event);
      });
      stickPad.addEventListener("pointermove", (event) => {
        if (stickPad.hasPointerCapture(event.pointerId)) move(event);
      });
      const release = (event) => {
        if (activePointerId === null || (event?.pointerId !== undefined && event.pointerId !== activePointerId)) return;
        activePointerId = null;
        ui.manualSticks[side] = { x: 0, y: 0 };
        if (knob) knob.style.transform = "translate(0px, 0px)";
        refreshManualControl();
      };
      stickPad.addEventListener("pointerup", release);
      stickPad.addEventListener("pointercancel", release);
      stickPad.addEventListener("lostpointercapture", release);
    });
    root.querySelector("[data-manual-neutral]")?.addEventListener("click", () => void neutralizeManualController());
  }

  async function dispatchEngineAction(action) {
    if (ui.manualTakeoverActive) {
      const now = Date.now();
      if (now - ui.lastManualBlockLogAt >= 1000) {
        ui.lastManualBlockLogAt = now;
        await recordActionFeedback(action, "blocked", "人工接管中，AI 動作未送出。").catch(() => {});
      }
      return;
    }
    if (!runtime.canRouteEngineAction()) return;
    const backend = runtime.state.outputBackend;
    try {
      let preempted = false;
      if (backend === "mechanical_rig" || backend === "hybrid") await runtime.routeRigAction(action);
      if (backend === "nxbt_bluetooth" || backend === "hybrid") {
        const result = await api(`/api/projects/${ui.current.manifest.id}/nxbt/action`, { method: "POST", json: action });
        preempted = Boolean(result.preempted);
      }
      await recordActionFeedback(action, preempted ? "blocked" : "executed", preempted ? "人工接管已中止這次 AI 動作。" : "控制後端已完成命令。");
    } catch (error) {
      await recordActionFeedback(action, "failed", error.message).catch(() => {});
      runtime.setControlPaused(true);
      await neutralizeOutputs();
      throw new Error(`控制輸出失敗，已暫停並要求回中立：${error.message}`);
    }
  }

  function readGamepadDemonstration(ignoreTrainingSetting = false) {
    if (!ignoreTrainingSetting && runtime.state.runtimeSettings.training?.captureGamepadDemonstrations === false) return null;
    const gamepad = Array.from(navigator.getGamepads?.() || []).find(Boolean);
    if (!gamepad) return null;
    const mapping = runtime.state.runtimeSettings.training || {};
    const axis = (index) => {
      const value = Number(gamepad.axes[index] || 0);
      return Math.abs(value) < 0.08 ? 0 : Math.round(Math.max(-1, Math.min(1, value)) * 100);
    };
    const pressed = (index) => Boolean(gamepad.buttons[index]?.pressed || gamepad.buttons[index]?.value > 0.65);
    return {
      controller: `${gamepad.id || "browser-gamepad"} / index ${gamepad.index}`,
      action: {
        id: window.crypto?.randomUUID?.().replaceAll("-", "") || `${Date.now().toString(16).padStart(32, "0")}`,
        durationMs: 120,
        sticks: {
          left_stick_x: axis(mapping.gamepadLeftXAxis ?? 0), left_stick_y: axis(mapping.gamepadLeftYAxis ?? 1),
          right_stick_x: axis(mapping.gamepadRightXAxis ?? 2), right_stick_y: axis(mapping.gamepadRightYAxis ?? 3)
        },
        buttons: {
          a: pressed(mapping.gamepadButtonA ?? 0), b: pressed(mapping.gamepadButtonB ?? 1),
          x: pressed(mapping.gamepadButtonX ?? 2), y: pressed(mapping.gamepadButtonY ?? 3),
          l: pressed(mapping.gamepadButtonL ?? 4), r: pressed(mapping.gamepadButtonR ?? 5),
          zl: pressed(mapping.gamepadButtonZL ?? 6), zr: pressed(mapping.gamepadButtonZR ?? 7)
        }
      }
    };
  }

  function readGamepadMenuAction() {
    const base = readGamepadDemonstration(true);
    if (!base) return null;
    const gamepad = Array.from(navigator.getGamepads?.() || []).find(Boolean);
    const menu = runtime.state.runtimeSettings.menuNavigation || {};
    const pressed = (index) => Boolean(gamepad?.buttons[index]?.pressed || gamepad?.buttons[index]?.value > 0.65);
    return {
      controller: base.controller,
      action: {
        ...base.action,
        durationMs: Number(menu.actionDurationMs) || 120,
        buttons: {
          ...base.action.buttons,
          dpad_up: pressed(menu.gamepadDpadUpButton ?? 12), dpad_down: pressed(menu.gamepadDpadDownButton ?? 13),
          dpad_left: pressed(menu.gamepadDpadLeftButton ?? 14), dpad_right: pressed(menu.gamepadDpadRightButton ?? 15),
          plus: pressed(menu.gamepadPlusButton ?? 9), minus: pressed(menu.gamepadMinusButton ?? 8)
        }
      }
    };
  }

  function isNeutralMenuAction(action) {
    return !Object.values(action?.buttons || {}).some(Boolean) && !Object.values(action?.sticks || {}).some((value) => Number(value) !== 0);
  }

  async function dispatchMenuAction(rawAction) {
    const allowedButtons = new Set(["a", "b", "x", "y", "l", "r", "zl", "zr", "dpad_up", "dpad_down", "dpad_left", "dpad_right", "plus", "minus"]);
    const allowedSticks = new Set(["left_stick_x", "left_stick_y", "right_stick_x", "right_stick_y"]);
    const action = {
      id: /^[a-f0-9]{32}$/.test(String(rawAction?.id || "")) ? rawAction.id : (crypto.randomUUID?.().replaceAll("-", "") || `${Date.now().toString(16).padStart(32, "0")}`),
      durationMs: Math.max(20, Math.min(250, Number(rawAction?.durationMs) || 120)),
      sticks: Object.fromEntries(Object.entries(rawAction?.sticks || {}).filter(([key]) => allowedSticks.has(key)).map(([key, value]) => [key, Math.max(-100, Math.min(100, Number(value) || 0))])),
      buttons: Object.fromEntries(Object.entries(rawAction?.buttons || {}).filter(([key]) => allowedButtons.has(key)).map(([key, value]) => [key, Boolean(value)]))
    };
    if (isNeutralMenuAction(action)) return;
    const minimumConfidence = Number(runtime.state.runtimeSettings.menuNavigation?.minimumConfidence) || 0.6;
    if (Number(runtime.state.latestGameState?.confidence || 0) < minimumConfidence) {
      throw new Error(`畫面辨識信心低於 ${minimumConfidence}，已阻止選單動作。請重新確認鏡頭。`);
    }
    const backend = runtime.state.outputBackend;
    if (backend === "mechanical_rig" || backend === "hybrid") await runtime.routeRigAction(action, { manualDemonstration: true });
    if (backend === "nxbt_bluetooth" || backend === "hybrid") {
      await api(`/api/projects/${ui.current.manifest.id}/nxbt/menu-action`, { method: "POST", json: action });
    }
    await neutralizeOutputs();
  }

  function updateMenuTaskStatus(task) {
    const box = document.querySelector("#menuTaskStatus");
    if (!box || !task) return;
    box.innerHTML = `<div class="alert ${task.status === "needs_user" ? "warning" : task.status === "completed" ? "success" : ""}"><p>${esc(task.message || task.status)}</p><div class="row-actions">
      ${task.status === "running" ? `<button class="secondary-button" data-menu-pause type="button">暫停</button>` : ""}
      ${task.status === "paused" ? `<button class="primary-button" data-menu-resume type="button">繼續</button>` : ""}
      ${!["completed","stopped","needs_user"].includes(task.status) ? `<button class="danger-link" data-menu-stop type="button">停止</button>` : ""}
    </div></div>`;
    box.querySelector("[data-menu-pause]")?.addEventListener("click", () => controlMenuTask(task.id, "pause"));
    box.querySelector("[data-menu-resume]")?.addEventListener("click", () => runMenuTask(task.id));
    box.querySelector("[data-menu-stop]")?.addEventListener("click", () => controlMenuTask(task.id, "stop"));
  }

  async function controlMenuTask(taskId, operation) {
    ui.menuTaskRunning = false;
    const result = await api(`/api/projects/${ui.current.manifest.id}/menu/tasks/${encodeURIComponent(taskId)}/${operation}`, { method: "POST", json: {} });
    await neutralizeOutputs();
    updateMenuTaskStatus(result.task);
  }

  async function runMenuTask(taskId) {
    if (!runtime.state.cameraReady) return runtime.showToast("請先開啟鏡頭並確認畫面，選單流程才可逐步驗證。");
    ui.menuTaskRunning = true;
    startVisionCapture();
    try {
      while (ui.menuTaskRunning) {
        const result = await api(`/api/projects/${ui.current.manifest.id}/menu/tasks/${encodeURIComponent(taskId)}/resume`, { method: "POST", json: {} });
        updateMenuTaskStatus(result.task);
        if (!result.action) break;
        await dispatchMenuAction(result.action);
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        await captureVisionFrame();
      }
    } catch (error) {
      runtime.showToast(`選單導航已停止：${error.message}`);
      await controlMenuTask(taskId, "stop").catch(() => {});
    } finally {
      ui.menuTaskRunning = false;
      await neutralizeOutputs();
    }
  }

  async function dispatchDemonstrationAction(action) {
    const backend = runtime.state.outputBackend;
    try {
      if (backend === "mechanical_rig" || backend === "hybrid") {
        await runtime.routeRigAction(action, { manualDemonstration: true });
      }
      if (backend === "nxbt_bluetooth" || backend === "hybrid") {
        await api(`/api/projects/${ui.current.manifest.id}/nxbt/demonstration-action`, {
          method: "POST",
          json: action
        });
      }
      await recordActionFeedback(action, "executed", "手動示範命令已由控制後端完成。");
    } catch (error) {
      await recordActionFeedback(action, "failed", error.message).catch(() => {});
      runtime.setDemonstrationRecording(false);
      stopVisionCapture();
      await neutralizeOutputs();
      throw new Error(`示範控制失敗，已停止錄製並回中立：${error.message}`);
    }
  }

  async function recordActionFeedback(action, status, message) {
    if (!action?.id || !ui.current?.manifest?.id) return;
    await api(`/api/projects/${ui.current.manifest.id}/trajectory/feedback`, {
      method: "POST",
      json: {
        actionId: action.id,
        sourceFrameId: action.sourceFrameId || "",
        status,
        backend: runtime.state.outputBackend,
        message
      }
    });
  }

  async function toggleDemonstrationCapture() {
    if (!requireProject()) return false;
    if (runtime.state.engineMode !== "idle") {
      runtime.showToast("請先停止訓練或正式遊玩，再錄製手動示範，避免兩套控制同時作用。");
      return false;
    }
    if (!runtime.state.cameraStream || !runtime.state.cameraReady) {
      runtime.showToast("請先開啟鏡頭並確認畫面，再錄製示範。");
      return false;
    }
    if (!runtime.state.demonstrationRecording && !Array.from(navigator.getGamepads?.() || []).find(Boolean)) {
      runtime.showToast("尚未偵測到電腦 Gamepad。請先連接並按任意按鍵，再開始錄製。");
      return false;
    }
    const recording = !runtime.state.demonstrationRecording;
    runtime.setDemonstrationRecording(recording);
    if (recording) startVisionCapture();
    else stopVisionCapture();
    runtime.showToast(recording ? "正在同步錄製鏡頭與完整控制器示範。" : "示範錄製已停止並保存。 ");
    return recording;
  }

  async function pretrainDemonstrations() {
    if (!requireProject()) return false;
    if (runtime.state.demonstrationRecording || runtime.state.engineMode !== "idle") {
      runtime.showToast("請先停止示範錄製、訓練與正式遊玩。");
      return false;
    }
    const result = await api(`/api/projects/${ui.current.manifest.id}/engine/pretrain`, {
      method: "POST",
      json: { epochs: runtime.state.runtimeSettings.training?.demonstrationEpochs || 2 }
    });
    runtime.setEngineRuntimeStatus(result);
    runtime.showToast(result.message);
    return Boolean(result.ok);
  }

  async function uploadVideo(file) {
    if (!requireProject() || !file) return false;
    if (file.size > 96 * 1024 * 1024) {
      runtime.showToast("影片超過 96 MB，請先裁切成較短片段。");
      return false;
    }
    const dataBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const result = await api(`/api/projects/${ui.current.manifest.id}/datasets/video`, { method: "POST", json: { name: file.name, dataBase64 } });
    runtime.showToast(result.worker?.message || "影片已匯入專案資料集。");
    return true;
  }

  async function canaryShadow() {
    if (!requireProject()) return false;
    const path = `/api/projects/${ui.current.manifest.id}/models/shadow/canary`;
    const checked = await api(path, { method: "POST", json: { confirm: false } });
    if (!checked.ok) {
      runtime.showToast(checked.message);
      return false;
    }
    if (!window.confirm(`${checked.message}\n\n確定要讓備用 AI 在下一回合短時間實機試跑嗎？`)) return false;
    const result = await api(path, { method: "POST", json: { confirm: true } });
    runtime.setEngineRuntimeStatus(result);
    runtime.showToast(result.message);
    return Boolean(result.ok);
  }

  async function rollbackModel() {
    if (!requireProject()) return false;
    const result = await api(`/api/projects/${ui.current.manifest.id}/models/stable/rollback`, { method: "POST", json: {} });
    runtime.setEngineRuntimeStatus(result);
    runtime.showToast(result.message);
    return Boolean(result.ok);
  }

  async function sendControl(action) {
    if (!requireProject()) return;
    try {
      if (action === "emergency-stop") {
        resetManualInputState();
        ui.manualTakeoverActive = false;
        runtime.setControlPaused(true);
        await emergencyStopOutputs();
      }
      if (action === "pause" || action === "stop") {
        resetManualInputState();
        ui.manualTakeoverActive = false;
        runtime.setControlPaused(true);
        await neutralizeOutputs();
      }
      if (action === "resume") runtime.setControlPaused(false);
      const result = await api(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/control/${encodeURIComponent(action)}`, { method: "POST", json: {} });
      if (action === "stop") await stopEngine();
      runtime.showToast(result.message || `已送出 ${action}`);
      return result;
    } catch (error) {
      if (action === "resume") runtime.setControlPaused(true);
      runtime.showToast(`操作未執行：${error.message}`);
    }
  }

  async function neutralizeOutputs() {
    const backend = runtime.state.outputBackend;
    const tasks = [];
    if ((backend === "mechanical_rig" || backend === "hybrid") && runtime.state.connectionOk) tasks.push(runtime.routeRigNeutral());
    if ((backend === "nxbt_bluetooth" || backend === "hybrid") && runtime.state.nxbtReady) {
      tasks.push(api(`/api/projects/${ui.current.manifest.id}/nxbt/action`, {
        method: "POST",
        json: { durationMs: 120, sticks: { left_stick_x: 0, left_stick_y: 0, right_stick_x: 0, right_stick_y: 0 }, buttons: {} }
      }));
    }
    await Promise.allSettled(tasks);
  }

  async function emergencyStopOutputs() {
    const backend = runtime.state.outputBackend;
    const tasks = [];
    if ((backend === "mechanical_rig" || backend === "hybrid") && runtime.state.connectionOk) tasks.push(runtime.sendBoardEmergencyStop());
    if ((backend === "nxbt_bluetooth" || backend === "hybrid") && runtime.state.nxbtReady) tasks.push(testNxbtEmergencyStop());
    await Promise.allSettled(tasks);
    runtime.state.nxbtReady = false;
  }

  async function connectNxbt() {
    if (!requireProject()) return false;
    const output = runtime.state.runtimeSettings.output || {};
    const nativeLinux = Boolean(ui.capabilities?.nxbtExecution?.nativeLinux);
    const configuredHost = String(output.nxbtHost || "").trim();
    const hostDefault = nativeLinux
      ? configuredHost || "127.0.0.1"
      : "127.0.0.1";
    if (!nativeLinux) runtime.showToast("Windows 或 macOS 請先依 README 建立 NXBT VM 本機轉送，再使用 127.0.0.1。不要填 VirtualBox NAT 位址 10.0.2.15。");
    const host = window.prompt(
      nativeLinux
        ? "NXBT bridge IP 位址。Linux 原生執行通常使用 127.0.0.1。"
        : "NXBT VM 本機轉送位址。請先依 README 建立轉送，再使用 127.0.0.1。不要填 VirtualBox NAT 位址 10.0.2.15。",
      hostDefault
    );
    if (!host) return false;
    const portText = window.prompt("NXBT VM bridge 連接埠", String(output.nxbtPort || 8766));
    if (!portText) return false;
    const token = window.prompt("輸入啟動 NXBT VM bridge 時設定的 token。token 只在這次執行期間保留，不會存檔。");
    if (!token) {
      runtime.showToast("尚未輸入 NXBT VM token，沒有建立連線。");
      return false;
    }
    try {
      const result = await api(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/nxbt/connect`, {
        method: "POST",
        json: {
          host,
          port: Number(portText),
          token,
          reconnect: Boolean(output.nxbtReconnect)
        }
      });
      runtime.showToast(result.message || "NXBT 已連線。");
      if (result.connecting) pollNxbtStatus();
      return Boolean(result.ready);
    } catch (error) {
      runtime.showToast(`NXBT 連線失敗：${error.message}`);
      return false;
    }
  }

  async function pollNxbtStatus(attempt = 0) {
    window.clearTimeout(ui.nxbtPollTimer);
    if (!ui.current?.manifest?.id) return;
    try {
      const result = await api(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/nxbt/status`);
      runtime.state.nxbtReady = Boolean(result.ready);
      runtime.setActiveStep(runtime.state.activeStepId);
      runtime.updateStatus();
      if (result.ready) {
        runtime.showToast("NXBT 已完成配對並連線。");
        return;
      }
      if (!result.connecting) {
        runtime.showToast(result.message || "NXBT 配對未完成，請檢查 VM bridge 日志。");
        return;
      }
      if (attempt >= 180) {
        runtime.showToast("NXBT 仍在等待配對。請確認 Switch 已開啟控制器配對畫面，或中止後重新連線。");
        return;
      }
      if (attempt > 0 && attempt % 10 === 0) runtime.showToast("NXBT 正在等待 Switch 配對，請保持配對畫面開啟。");
      ui.nxbtPollTimer = window.setTimeout(() => pollNxbtStatus(attempt + 1), 1000);
    } catch (error) {
      runtime.state.nxbtReady = false;
      runtime.showToast(`NXBT 狀態檢查失敗：${error.message}`);
    }
  }

  async function disconnectNxbt() {
    if (!ui.current?.manifest?.id) return false;
    window.clearTimeout(ui.nxbtPollTimer);
    try {
      const result = await api(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/nxbt/disconnect`, {
        method: "POST",
        json: {}
      });
      return !result.ready;
    } catch {
      return false;
    }
  }

  async function testNxbtEmergencyStop() {
    if (!requireProject()) return false;
    try {
      const result = await api(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/nxbt/emergency-stop`, {
        method: "POST",
        json: {}
      });
      runtime.showToast(result.message);
      return Boolean(result.emergencyStopVerified);
    } catch (error) {
      runtime.showToast(`NXBT 軟體急停失敗：${error.message}`);
      return false;
    }
  }

  function nxbtTestParameter(operation) {
    if (operation === "finish_button_test") return "buttons.b=true / 1000 ms";
    if (!operation.includes(":")) return `buttons.${operation}=true / 120 ms`;
    const [side, direction] = operation.split(":");
    const prefix = `${side}_stick`;
    const values = {
      prepare: [`${prefix}_x=+100`, "1200 ms"],
      left: [`${prefix}_x=-100`, "350 ms"],
      right: [`${prefix}_x=+100`, "350 ms"],
      up: [`${prefix}_y=+100`, "350 ms"],
      down: [`${prefix}_y=-100`, "350 ms"]
    }[direction];
    return values ? values.join(" / ") : operation;
  }

  function describeNxbtCommand(command = {}) {
    const buttons = Object.entries(command.buttons || {}).filter(([, pressed]) => pressed).map(([key]) => `buttons.${key}=true`);
    const sticks = Object.entries(command.sticks || {}).filter(([, value]) => Number(value) !== 0).map(([key, value]) => `${key}=${Number(value) > 0 ? "+" : ""}${value}`);
    return [...buttons, ...sticks, `${command.durationMs || 20} ms`].join(" / ");
  }

  function openNxbtInputTest() {
    if (!requireProject()) return;
    const dialog = document.querySelector("#nxbtTestDialog");
    const ready = Boolean(runtime.state.nxbtReady);
    const safeReady = ready && Boolean(runtime.state.emergencyStopOk);
    ui.nxbtTestPrepared = new Set();
    dialog.innerHTML = `
      ${dialogHeader("NXBT 按鍵與搖桿測試", "先在 Switch 2 開啟官方測試畫面，再從這裡逐一送出短動作。測試不會啟動訓練。")}
      ${ready ? "" : `<div class="alert warning">NXBT 尚未連線。請先回到設備檢查按「連接 NXBT」。</div>`}
      ${ready && !runtime.state.emergencyStopOk ? `<div class="alert warning">急停尚未驗證。請先回到設備檢查按「測試急停」。</div>` : ""}
      <div class="alert warning"><strong>重要：</strong>NXBT 模擬的是 Switch Pro Controller。HOME、截圖、C、GL、GR 不會出現在這個測試面板，也不能由此面板送出。${info("這是什麼：NXBT 測試安全限制。推薦：只在官方測試畫面操作。選錯會怎樣：若在遊戲或選單內測試，按鍵可能觸發非預期操作。")}</div>

      <section class="nxbt-test-section" aria-labelledby="nxbtButtonTestTitle">
        <h3 id="nxbtButtonTestTitle">1. 測試按鍵</h3>
        <p class="official-test-path"><strong>Switch 2 請先開啟：</strong>HOME 選單 → 主機設定 → 控制器與周邊設備 → 測試輸入裝置 → 測試控制器按鍵</p>
        <p>畫面開啟後，按下面任一按鍵。Switch 2 畫面應顯示相同圖示。官方測試畫面不會顯示 HOME、截圖、C、POWER、音量或 SYNC。</p>
        <label class="check-line"><input id="nxbtButtonScreenConfirmed" type="checkbox" ${safeReady ? "" : "disabled"}><strong>我已開啟「測試控制器按鍵」畫面</strong><span>勾選後才會啟用測試按鈕。</span></label>
        <div class="nxbt-input-test-grid">
          ${nxbtTestButtons.map(([operation, label]) => `<button class="secondary-button nxbt-parameter-button" type="button" data-nxbt-test-interface="buttons" data-nxbt-test-operation="${operation}" title="${nxbtTestParameter(operation)}" disabled><span>${label}</span><small>${nxbtTestParameter(operation)}</small></button>`).join("")}
        </div>
        <div class="step-actions"><button class="secondary-button nxbt-parameter-button" type="button" data-nxbt-test-interface="buttons" data-nxbt-test-operation="finish_button_test" disabled><span>按住 B，結束官方按鍵測試</span><small>${nxbtTestParameter("finish_button_test")}</small></button></div>
      </section>

      <section class="nxbt-test-section" aria-labelledby="nxbtStickTestTitle">
        <h3 id="nxbtStickTestTitle">2. 測試搖桿</h3>
        <p class="official-test-path"><strong>Switch 2 請先開啟：</strong>HOME 選單 → 主機設定 → 控制器與周邊設備 → 校正控制搖桿</p>
        <div class="alert"><strong>順序不能跳過：</strong>先按「選擇左／右搖桿」，NXBT 會把該搖桿向右推到底約 1.2 秒後回中立。Switch 2 選中該搖桿後，才能按四個方向測試。若主機尚未選中，請再按一次選擇按鈕。</div>
        <label class="check-line"><input id="nxbtStickScreenConfirmed" type="checkbox" ${safeReady ? "" : "disabled"}><strong>我已開啟「校正控制搖桿」畫面</strong><span>測試只送單一方向，結束後自動回中立。</span></label>
        <div class="nxbt-stick-test-layout">
          ${["left", "right"].map((side) => {
            const sideLabel = side === "left" ? "左搖桿" : "右搖桿";
            return `<div class="nxbt-stick-test" data-stick-panel="${side}">
              <strong>${sideLabel}</strong>
              <button class="primary-button nxbt-parameter-button" type="button" data-nxbt-test-interface="sticks" data-nxbt-test-operation="${side}:prepare" disabled><span>先選擇${sideLabel}（向右到底）</span><small>${nxbtTestParameter(`${side}:prepare`)}</small></button>
              <div class="nxbt-stick-directions" aria-label="${sideLabel}方向測試">
                <button class="secondary-button" type="button" data-nxbt-test-interface="sticks" data-nxbt-test-operation="${side}:up" data-stick-direction="${side}" title="${nxbtTestParameter(`${side}:up`)}" disabled>↑</button>
                <button class="secondary-button" type="button" data-nxbt-test-interface="sticks" data-nxbt-test-operation="${side}:left" data-stick-direction="${side}" title="${nxbtTestParameter(`${side}:left`)}" disabled>←</button>
                <button class="secondary-button" type="button" data-nxbt-test-interface="sticks" data-nxbt-test-operation="${side}:down" data-stick-direction="${side}" title="${nxbtTestParameter(`${side}:down`)}" disabled>↓</button>
                <button class="secondary-button" type="button" data-nxbt-test-interface="sticks" data-nxbt-test-operation="${side}:right" data-stick-direction="${side}" title="${nxbtTestParameter(`${side}:right`)}" disabled>→</button>
              </div>
              <small data-stick-ready="${side}">尚未先推到底</small>
            </div>`;
          }).join("")}
        </div>
        <details class="nxbt-parameter-details"><summary>查看 NXBT 實際參數</summary><p>測試路徑直接呼叫 NXBT 原生參數：X 向右為正，Y 向上為正，範圍為 -100 到 +100。網頁人工搖桿採瀏覽器座標（Y 向下為正），bridge 會在送入 NXBT 前反轉一次 Y；畫面與實際方向因此一致。</p></details>
      </section>
      <p class="nxbt-test-status" id="nxbtTestStatus" role="status">${safeReady ? "請先開啟對應的 Switch 2 測試畫面。" : ready ? "等待急停驗證。" : "等待 NXBT 連線。"}</p>
      <div class="dialog-footer"><button class="secondary-button" id="nxbtTestNeutral" type="button" ${ready ? "" : "disabled"}>立即回中立</button></div>
    `;
    bindDialogClose(dialog, () => void neutralizeNxbtTest());
    const refresh = () => refreshNxbtTestControls(dialog, safeReady);
    dialog.querySelector("#nxbtButtonScreenConfirmed")?.addEventListener("change", refresh);
    dialog.querySelector("#nxbtStickScreenConfirmed")?.addEventListener("change", refresh);
    dialog.querySelectorAll("[data-nxbt-test-operation]").forEach((button) => button.addEventListener("click", () => runNxbtInputTest(dialog, button)));
    dialog.querySelector("#nxbtTestNeutral")?.addEventListener("click", async () => {
      await neutralizeNxbtTest();
      ui.nxbtTestPrepared.clear();
      dialog.querySelectorAll("[data-stick-ready]").forEach((node) => { node.textContent = "尚未先推到底"; });
      dialog.querySelector("#nxbtTestStatus").textContent = "已要求 NXBT 回到中立；搖桿方向測試前需重新執行選擇步驟。";
      refresh();
    });
    refresh();
    if (!dialog.open) dialog.showModal();
  }

  function refreshNxbtTestControls(dialog, ready) {
    const buttonConfirmed = Boolean(dialog.querySelector("#nxbtButtonScreenConfirmed")?.checked);
    const stickConfirmed = Boolean(dialog.querySelector("#nxbtStickScreenConfirmed")?.checked);
    dialog.querySelectorAll("[data-nxbt-test-interface='buttons']").forEach((button) => {
      button.disabled = !ready || !buttonConfirmed || ui.nxbtTestBusy;
    });
    dialog.querySelectorAll("[data-nxbt-test-interface='sticks']").forEach((button) => {
      const operation = button.dataset.nxbtTestOperation || "";
      const side = operation.split(":", 1)[0];
      const isDirection = Boolean(button.dataset.stickDirection);
      button.disabled = !ready || !stickConfirmed || ui.nxbtTestBusy || (isDirection && !ui.nxbtTestPrepared.has(side));
    });
  }

  async function runNxbtInputTest(dialog, button) {
    if (ui.nxbtTestBusy || !ui.current?.manifest?.id) return;
    const interfaceName = button.dataset.nxbtTestInterface;
    const operation = button.dataset.nxbtTestOperation;
    const confirmed = interfaceName === "buttons"
      ? Boolean(dialog.querySelector("#nxbtButtonScreenConfirmed")?.checked)
      : Boolean(dialog.querySelector("#nxbtStickScreenConfirmed")?.checked);
    ui.nxbtTestBusy = true;
    refreshNxbtTestControls(dialog, true);
    const status = dialog.querySelector("#nxbtTestStatus");
    status.textContent = operation.endsWith(":prepare") ? "正在把搖桿向右推到底，請不要切換 Switch 2 畫面..." : "正在送出短測試動作...";
    try {
      const result = await api(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/nxbt/test-input`, {
        method: "POST",
        json: { interface: interfaceName, operation, screenConfirmed: confirmed }
      });
      if (operation.endsWith(":prepare")) {
        const side = operation.split(":", 1)[0];
        ui.nxbtTestPrepared.add(side);
        const readyLabel = dialog.querySelector(`[data-stick-ready='${side}']`);
        if (readyLabel) readyLabel.textContent = "已先推到底，可以測試四個方向";
      }
      status.textContent = `${result.message} 實際參數：${describeNxbtCommand(result.command)}。`;
    } catch (error) {
      status.textContent = `測試未送出：${error.message}`;
    } finally {
      ui.nxbtTestBusy = false;
      refreshNxbtTestControls(dialog, Boolean(runtime.state.nxbtReady));
    }
  }

  async function neutralizeNxbtTest() {
    if (!ui.current?.manifest?.id || !runtime.state.nxbtReady) return;
    try {
      await api(`/api/projects/${encodeURIComponent(ui.current.manifest.id)}/nxbt/test-input`, { method: "POST", json: { operation: "neutral" } });
    } catch {
      // The bridge also returns to neutral after every individual test action.
    }
  }

  async function logEvent(event, details = {}, severity = "info") {
    if (!ui.current?.manifest?.id || !ui.token) return;
    try {
      await api(`/api/projects/${ui.current.manifest.id}/logs`, {
        method: "POST",
        json: { severity, source: "camera", event, details }
      });
    } catch {
      // Camera diagnostics must not interrupt preview recovery.
    }
  }

  async function createSnapshot() {
    if (!requireProject()) return;
    await saveState("before_snapshot");
    const name = window.prompt("快照名稱", "手動快照");
    if (!name) return;
    await api(`/api/projects/${ui.current.manifest.id}/snapshots`, { method: "POST", json: { name } });
    runtime.showToast("快照已建立。");
  }

  function scheduleSave() {
    ui.dirty = true;
    window.clearTimeout(ui.saveTimer);
    ui.saveTimer = window.setTimeout(() => saveState("autosave_after_change"), 1800);
  }

  async function saveState(reason = "manual", keepalive = false) {
    if (!runtime.state.currentProjectId || !ui.token) return;
    try {
      const response = await fetch(`/api/projects/${runtime.state.currentProjectId}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Session-Token": ui.token },
        body: JSON.stringify(runtime.getPersistentState(reason)),
        keepalive
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      ui.dirty = false;
    } catch {
      if (!keepalive) runtime.showToast("自動存檔失敗，請檢查本機後端是否仍在執行。");
    }
  }

  async function shutdownApplication() {
    if (ui.shuttingDown) return;
    const confirmed = window.confirm("確定要結束程式嗎？訓練與正式遊玩會停止，控制器回到中立，鏡頭、Serial、NXBT 與 localhost 後端都會關閉。");
    if (!confirmed) return;

    ui.shuttingDown = true;
    const button = document.querySelector("#shutdownApplicationButton");
    if (button) {
      button.disabled = true;
      button.textContent = "正在結束...";
    }

    try {
      stopVisionCapture();
      resetManualInputState();
      ui.manualTakeoverActive = false;
      if (ui.current?.manifest?.id) {
        if (runtime.state.engineMode !== "idle") await sendControl("stop");
        else await neutralizeOutputs();
        await disconnectNxbt();
      }
      runtime.closeCamera({ broadcast: true, silent: true });
      await runtime.closeSerialPort();
      await saveState("application_shutdown");
      const result = await api("/api/shutdown", { method: "POST", json: {} });
      document.body.innerHTML = `
        <main class="shutdown-screen">
          <h1>程式已結束</h1>
          <p>${esc(result.message || "本機後端已關閉。")}</p>
          <p>現在可以安全關閉這個瀏覽器分頁。下次請重新執行平台啟動程式。</p>
        </main>
      `;
    } catch (error) {
      ui.shuttingDown = false;
      if (button) {
        button.disabled = false;
        button.textContent = "結束程式";
      }
      runtime.showToast(`程式未能完整結束：${error.message}`);
    }
  }

  async function saveControllerOutputSelection(profileId, backend) {
    if (!ui.current?.manifest?.id) return { profileId, backend };
    const currentSettings = ui.settings || await api(`/api/projects/${ui.current.manifest.id}/settings`);
    const next = structuredClone(currentSettings.effective);
    next.controller.profile = profileId;
    next.output.backend = backend;
    ui.settings = await api(`/api/projects/${ui.current.manifest.id}/settings`, { method: "PUT", json: next });
    return {
      profileId: ui.settings.effective.controller.profile,
      backend: ui.settings.effective.output.backend
    };
  }

  function requireProject() {
    if (ui.current?.manifest?.id) return true;
    openProjectDialog();
    runtime.showToast("請先新增或選擇遊戲專案。");
    return false;
  }

  window.ProjectUI = {
    openProjectDialog, openMonitor, openNxbtInputTest, sendControl, connectNxbt, disconnectNxbt, testNxbtEmergencyStop, saveState, logEvent,
    uploadVideo, startEngine, stopEngine, startVisionCapture, stopVisionCapture, requestVisionCapture, refreshWorkerHealth,
    canaryShadow, rollbackModel, toggleDemonstrationCapture, pretrainDemonstrations, saveControllerOutputSelection,
    bindManualControllerControls,
    bindTrainingManualControls: bindManualControllerControls,
    releaseManualController: neutralizeManualController,
    isManualControllerActive: () => manualInputActive() || ui.manualTakeoverActive
  };
  bootstrap();
})();
