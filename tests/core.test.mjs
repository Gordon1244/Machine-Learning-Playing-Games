import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CONTROLLER_PROFILES,
  DEFAULT_LIVE_POLICY,
  LIVE_LEARNING_MODES,
  OUTPUT_BACKENDS,
  OUTPUT_BACKEND_PROFILES,
  TOOLTIP_HELP,
  clampActionCommand,
  computeLearningScore,
  createDefaultActionCommand,
  createNxbtCommand,
  createRigConfig,
  evaluateSafetyGate,
  getCompatibleControllerProfileId,
  getTrainingReadiness,
  shouldRollbackModel,
  shouldSwitchToShadowModel
} from "../src/core.js";

test("both Switch 2 controller profiles expose full controller slots", () => {
  const pro = CONTROLLER_PROFILES.switch2_pro;
  const joycon = CONTROLLER_PROFILES.joycon2_grip;

  for (const profile of [pro, joycon]) {
    const slotIds = profile.slots.map((slot) => slot.id);
    assert(slotIds.includes("left_stick_x"));
    assert(slotIds.includes("left_stick_y"));
    assert(slotIds.includes("right_stick_x"));
    assert(slotIds.includes("right_stick_y"));
    assert(slotIds.includes("left_stick_press"));
    assert(slotIds.includes("right_stick_press"));
    assert(slotIds.includes("a"));
    assert(slotIds.includes("zr"));
    assert(slotIds.includes("capture"));
  }

  assert(pro.slots.some((slot) => slot.id === "gl"));
  assert(pro.slots.some((slot) => slot.id === "gr"));
});

test("tooltip entries contain beginner explanation, recommendation, and risk", () => {
  assert(TOOLTIP_HELP.length >= 8);
  for (const help of TOOLTIP_HELP) {
    assert(help.shortDescription.length > 0);
    assert(help.recommendedValue.length > 0);
    assert(help.riskWarning.length > 0);
  }
});

test("rig config creates one motor channel per slot and safety defaults", () => {
  const rig = createRigConfig("switch2_pro");
  assert.equal(rig.slots.length, CONTROLLER_PROFILES.switch2_pro.slots.length);
  assert.equal(rig.safety.emergencyStopRequired, true);
  assert.equal(new Set(rig.slots.map((slot) => slot.motorChannel)).size, rig.slots.length);
});

test("action commands are clamped by safety gate travel and duration", () => {
  const rig = createRigConfig("joycon2_grip");
  const command = createDefaultActionCommand(rig);
  command.durationMs = 9999;
  command.sticks.left_stick_x = 999;
  command.sticks.left_stick_y = -999;

  const clamped = clampActionCommand(command, rig);
  assert.equal(clamped.durationMs, rig.safety.maxCommandMs);
  assert.equal(clamped.sticks.left_stick_x, 100);
  assert.equal(clamped.sticks.left_stick_y, -100);
});

test("pressed system buttons enforce their shorter press duration limit", () => {
  const rig = createRigConfig("switch2_pro");
  const command = createDefaultActionCommand(rig);
  command.durationMs = 1400;
  command.buttons.home = true;

  assert.equal(clampActionCommand(command, rig).durationMs, 500);
});

test("safety gate blocks formal play until all controller slots are calibrated", () => {
  const rig = createRigConfig("joycon2_grip");
  const partial = evaluateSafetyGate({
    rigConfig: rig,
    cameraReady: true,
    cameraCalibrated: true,
    emergencyStopOk: true,
    connectionOk: true,
    externalPowerOk: true,
    calibratedSlotIds: rig.slots.slice(0, 2).map((slot) => slot.id)
  });

  assert.equal(partial.ok, false);
  assert(partial.issues.some((issue) => issue.includes("沒有校正")));

  const complete = evaluateSafetyGate({
    rigConfig: rig,
    cameraReady: true,
    cameraCalibrated: true,
    emergencyStopOk: true,
    connectionOk: true,
    externalPowerOk: true,
    calibratedSlotIds: rig.slots.map((slot) => slot.id)
  });

  assert.equal(complete.ok, true);
});

test("NXBT backend does not require mechanical calibration but requires NXBT readiness", () => {
  const rig = createRigConfig("switch2_pro");
  assert.equal(OUTPUT_BACKEND_PROFILES[OUTPUT_BACKENDS.NXBT_BLUETOOTH].requiresNxbt, true);

  const blocked = evaluateSafetyGate({
    rigConfig: rig,
    outputBackend: OUTPUT_BACKENDS.NXBT_BLUETOOTH,
    cameraReady: true,
    cameraCalibrated: true,
    emergencyStopOk: false,
    connectionOk: false,
    nxbtReady: false,
    calibratedSlotIds: []
  });

  assert.equal(blocked.ok, false);
  assert(blocked.issues.some((issue) => issue.includes("NXBT")));

  const ready = evaluateSafetyGate({
    rigConfig: rig,
    outputBackend: OUTPUT_BACKENDS.NXBT_BLUETOOTH,
    cameraReady: true,
    cameraCalibrated: true,
    emergencyStopOk: true,
    connectionOk: false,
    nxbtReady: true,
    calibratedSlotIds: []
  });

  assert.equal(ready.ok, true);
});

test("NXBT and hybrid output allow only the Pro controller profile", () => {
  assert.equal(getCompatibleControllerProfileId("joycon2_grip", OUTPUT_BACKENDS.NXBT_BLUETOOTH), "switch2_pro");
  assert.equal(getCompatibleControllerProfileId("joycon2_grip", OUTPUT_BACKENDS.HYBRID), "switch2_pro");
  assert.equal(getCompatibleControllerProfileId("joycon2_grip", OUTPUT_BACKENDS.MECHANICAL_RIG), "joycon2_grip");

  const incompatible = evaluateSafetyGate({
    rigConfig: createRigConfig("joycon2_grip"),
    outputBackend: OUTPUT_BACKENDS.NXBT_BLUETOOTH,
    cameraReady: true,
    cameraCalibrated: true,
    emergencyStopOk: true,
    connectionOk: false,
    nxbtReady: true,
    calibratedSlotIds: []
  });
  assert.equal(incompatible.ok, false);
  assert(incompatible.issues.some((issue) => issue.includes("只能模擬 Switch Pro Controller")));
});

test("training is blocked before required setup is completed", () => {
  const rig = createRigConfig("switch2_pro");
  const readiness = getTrainingReadiness({
    completedSteps: [],
    cameraReady: false,
    cameraCalibrated: false,
    importedVideoName: "",
    rigConfig: rig,
    outputBackend: OUTPUT_BACKENDS.MECHANICAL_RIG,
    emergencyStopOk: true,
    connectionOk: true,
    externalPowerOk: true,
    nxbtReady: false,
    calibratedSlotIds: []
  });

  assert.equal(readiness.ok, false);
  assert(readiness.issues.includes("請先完成設備檢查。"));
  assert(readiness.issues.includes("請先選擇實際使用的控制器。"));
  assert(readiness.issues.includes("請先開啟真實鏡頭。匯入影片只用於畫面暖身，不能取代實機鏡頭。"));
});

test("training is allowed only after setup and safety requirements pass", () => {
  const rig = createRigConfig("joycon2_grip");
  const readiness = getTrainingReadiness({
    completedSteps: ["device_check", "controller_select", "camera_calibration", "rig_calibration"],
    cameraReady: true,
    cameraCalibrated: true,
    importedVideoName: "",
    rigConfig: rig,
    outputBackend: OUTPUT_BACKENDS.MECHANICAL_RIG,
    emergencyStopOk: true,
    connectionOk: true,
    externalPowerOk: true,
    nxbtReady: false,
    calibratedSlotIds: rig.slots.map((slot) => slot.id)
  });

  assert.equal(readiness.ok, true);
});

test("training is blocked when setup is marked complete but camera was never opened", () => {
  const rig = createRigConfig("joycon2_grip");
  const readiness = getTrainingReadiness({
    completedSteps: ["device_check", "controller_select", "camera_calibration", "rig_calibration"],
    cameraReady: false,
    cameraCalibrated: true,
    importedVideoName: "",
    rigConfig: rig,
    outputBackend: OUTPUT_BACKENDS.MECHANICAL_RIG,
    emergencyStopOk: true,
    connectionOk: true,
    externalPowerOk: true,
    nxbtReady: false,
    calibratedSlotIds: rig.slots.map((slot) => slot.id)
  });

  assert.equal(readiness.ok, false);
  assert(readiness.issues.includes("請先開啟真實鏡頭。匯入影片只用於畫面暖身，不能取代實機鏡頭。"));
});

test("imported warmup video cannot bypass real camera or hardware safety", () => {
  const rig = createRigConfig("switch2_pro");
  const readiness = getTrainingReadiness({
    completedSteps: ["device_check", "controller_select", "camera_calibration", "rig_calibration"],
    cameraReady: false,
    cameraCalibrated: false,
    importedVideoName: "warmup.mp4",
    rigConfig: rig,
    outputBackend: OUTPUT_BACKENDS.MECHANICAL_RIG,
    emergencyStopOk: false,
    connectionOk: false,
    externalPowerOk: false,
    calibratedSlotIds: []
  });
  assert.equal(readiness.ok, false);
  assert(readiness.issues.some((issue) => issue.includes("不能取代實機鏡頭")));
  assert(readiness.issues.some((issue) => issue.includes("開發板連線不穩")));
});

test("mechanical backend is blocked when no development board is connected", () => {
  const rig = createRigConfig("switch2_pro");
  const safety = evaluateSafetyGate({
    rigConfig: rig,
    outputBackend: OUTPUT_BACKENDS.MECHANICAL_RIG,
    cameraReady: true,
    cameraCalibrated: true,
    emergencyStopOk: true,
    connectionOk: false,
    externalPowerOk: true,
    nxbtReady: false,
    calibratedSlotIds: rig.slots.map((slot) => slot.id)
  });

  assert.equal(safety.ok, false);
  assert(safety.issues.some((issue) => issue.includes("開發板連線不穩")));
});

test("formal play is blocked without camera, emergency stop path, or external rig power", () => {
  const rig = createRigConfig("switch2_pro");
  const safety = evaluateSafetyGate({
    rigConfig: rig,
    outputBackend: OUTPUT_BACKENDS.MECHANICAL_RIG,
    cameraReady: false,
    cameraCalibrated: false,
    emergencyStopOk: false,
    connectionOk: true,
    externalPowerOk: false,
    calibratedSlotIds: rig.slots.map((slot) => slot.id)
  });

  assert.equal(safety.ok, false);
  assert(safety.issues.some((issue) => issue.includes("真實鏡頭")));
  assert(safety.issues.some((issue) => issue.includes("急停路徑")));
  assert(safety.issues.some((issue) => issue.includes("外部電源")));
});

test("ActionCommand can be translated to an NXBT-oriented command", () => {
  const rig = createRigConfig("switch2_pro");
  const command = createDefaultActionCommand(rig);
  command.buttons.a = true;
  command.buttons.zr = true;
  command.sticks.left_stick_x = 80;
  command.sticks.left_stick_y = -20;

  const nxbtCommand = createNxbtCommand(command);
  assert.equal(nxbtCommand.backend, OUTPUT_BACKENDS.NXBT_BLUETOOTH);
  assert.equal(nxbtCommand.buttons.a, true);
  assert.equal(nxbtCommand.buttons.zr, true);
  assert.equal(nxbtCommand.sticks.left_stick_x, 80);
  assert.equal(nxbtCommand.sticks.left_stick_y, -20);
});

test("learning score rewards progress and penalizes crash or failure", () => {
  const clean = computeLearningScore({
    rank: 1,
    speedKmh: 180,
    progressPercent: 80,
    crashed: false,
    fallingBehind: false,
    failed: false,
    itemEffectPositive: true
  });

  const failed = computeLearningScore({
    rank: 12,
    speedKmh: 30,
    progressPercent: 10,
    crashed: true,
    fallingBehind: true,
    failed: true,
    itemEffectPositive: false
  });

  assert(clean > failed);
});

test("live learning supports multiple selected modes and rollback logic", () => {
  const policy = {
    ...DEFAULT_LIVE_POLICY,
    modes: [
      LIVE_LEARNING_MODES.SAFE_ADAPTATION,
      LIVE_LEARNING_MODES.FULL_ONLINE_UPDATE,
      LIVE_LEARNING_MODES.SHADOW_MODEL_LEARNING
    ]
  };

  assert.equal(shouldRollbackModel({ previousScore: 80, currentScore: 60, policy }), true);
  assert.equal(shouldSwitchToShadowModel({ mainScore: 70, shadowScore: 80, policy }), true);
});

test("UI source does not expose fake hardware or fake training success paths", () => {
  const appSource = fs.readFileSync("src/app.js", "utf8");
  const stylesSource = fs.readFileSync("styles.css", "utf8");

  assert.equal(appSource.includes("connectionOk: true"), false);
  assert.equal(appSource.includes("emergencyStopOk: true"), false);
  assert.equal(appSource.includes("bestScore: 62"), false);
  assert.equal(appSource.includes("模擬訓練"), false);
  assert.equal(appSource.includes("模擬 1 分鐘"), false);
  assert.equal(appSource.includes("一鍵模擬"), false);
  assert.equal(appSource.includes("calibratedSlotIds.add(button.dataset.calibrate)"), false);
  assert.equal(appSource.includes('data-action="close-camera"'), true);
  assert.equal(appSource.includes("video.videoWidth > 0 && video.videoHeight > 0"), true);
  assert.equal(appSource.includes("refreshCameraCalibrationView();"), true);
  assert.equal(appSource.includes("cameraStreams: new Set()"), true);
  assert.equal(appSource.includes("externalPowerOk: false"), true);
  assert.equal(appSource.includes("power_ok"), true);
  assert.equal(appSource.includes('const runtimeStepIds = new Set(["device_check", "camera_calibration", "rig_calibration"])'), true);
  assert.equal(appSource.includes("applyEffectiveSettings"), true);
  assert.equal(fs.readFileSync("src/browser-core.js", "utf8").includes("Windows 與 macOS 依官方方式透過 Linux VM 使用"), true);
  assert.equal(appSource.includes("stopAllCameraStreams();"), true);
  assert.equal(appSource.includes("state.cameraRequestId += 1;"), true);
  assert.equal(appSource.includes('new BroadcastChannel("switch2-camera-control")'), true);
  assert.equal(appSource.includes("broadcastStopCamera();"), true);
  assert.equal(appSource.includes('window.addEventListener("pagehide"'), true);
  assert.equal(appSource.includes('data-action="connect-nxbt"'), true);
  assert.equal(appSource.includes('new TextEncoder().encode("ESTOP\\n")'), true);
  assert.equal(appSource.includes("testNxbtEmergencyStop"), true);
  const openCameraBlock = appSource.slice(appSource.indexOf("async function openCamera()"), appSource.indexOf("async function attachCameraPreview()"));
  assert.equal(openCameraBlock.includes("broadcastStopCamera();"), false);
  assert.equal(openCameraBlock.includes("state.cameraOpening)"), true);
  assert.equal(appSource.includes("describeCameraError(error)"), true);
  assert.equal(appSource.includes("handleCameraTrackEnded(stream)"), true);
  assert.equal(appSource.includes("!state.controlPaused && getCurrentSafetyGate().ok"), true);
  assert.equal(appSource.includes("async function routeRigNeutral()"), true);
  assert.equal(appSource.includes("cameraDiagnosticMessage"), true);
  assert.equal(appSource.includes('"camera_open_failed"'), true);
  assert.equal(appSource.includes('tooltip.setAttribute("popover", "manual")'), true);
  assert.equal(stylesSource.includes(".camera-empty[hidden]"), true);
  assert.equal(stylesSource.includes(".floating-tooltip"), true);
});

test("platform launchers start localhost and open the browser", () => {
  const windowsLauncher = fs.readFileSync("start-windows.cmd", "utf8");
  const macLauncher = fs.readFileSync("start-macos.command", "utf8");
  const linuxLauncher = fs.readFileSync("start-linux.sh", "utf8");
  const powershellLauncher = fs.readFileSync("start-local-server.ps1", "utf8");

  assert(windowsLauncher.includes("start-local-server.ps1"));
  assert(macLauncher.includes("server/app.py"));
  assert(macLauncher.includes('open "${URL}"'));
  assert(linuxLauncher.includes("server/app.py"));
  assert(linuxLauncher.includes("xdg-open"));
  assert(powershellLauncher.includes("server\\app.py"));
  assert(powershellLauncher.includes("Start-Process $url"));
  assert(powershellLauncher.includes("Test-LocalServer"));
  assert(powershellLauncher.includes("/api/health"));
});

test("web UI provides an authenticated full application shutdown", () => {
  const source = fs.readFileSync("src/product-ui.js", "utf8");
  const appSource = fs.readFileSync("src/app.js", "utf8");
  const serverSource = fs.readFileSync("server/app.py", "utf8");
  assert(source.includes('id="shutdownApplicationButton"'));
  assert(source.includes('api("/api/shutdown"'));
  assert(source.includes('saveState("application_shutdown")'));
  assert(source.includes("await neutralizeOutputs()"));
  assert(source.includes("runtime.closeCamera"));
  assert(source.includes("runtime.closeSerialPort"));
  assert(source.includes("程式已結束"));
  assert(appSource.includes("closeSerialPort,"));
  assert(serverSource.includes('parts == ["api", "shutdown"]'));
  assert(serverSource.includes("STORE.shutdown_application()"));
  assert(serverSource.includes("class LocalThreadingHTTPServer(ThreadingHTTPServer)"));
  assert(serverSource.includes("allow_reuse_address = False"));
});

test("product UI includes persistent projects, snapshots, logs, and realtime monitor", () => {
  const source = fs.readFileSync("src/product-ui.js", "utf8");
  const monitorSource = fs.readFileSync("src/monitor.js", "utf8");
  assert(source.includes("/api/projects"));
  assert(source.includes("/snapshots"));
  assert(source.includes("/logs?"));
  assert(source.includes("/monitor/stream"));
  assert(source.includes('method: "DELETE"'));
  assert(source.includes("logsClearButton"));
  assert(source.includes("logEvent"));
  assert(source.includes("emergency-stop"));
  assert(source.includes("dangerUnlock"));
  assert(source.includes("晶片偵測"));
  assert(source.includes("/api/capabilities/refresh"));
  assert(source.includes("computeTargets"));
  assert(source.includes("控制輸出方式"));
  assert(source.includes("applyEffectiveSettings"));
  assert(source.includes("AI 助手"));
  assert(source.includes("套件管理"));
  assert(source.includes("/api/llm/detect"));
  assert(source.includes("/assistant/chat"));
  assert(source.includes("/vision/frame"));
  assert(source.includes("/datasets/video"));
  assert(source.includes("startVisionCapture"));
  assert(source.includes("讓 LLM 看目前畫面"));
  assert(source.includes("visionFrameIntervalSeconds"));
  assert(source.includes("/models/shadow/canary"));
  assert(source.includes("/models/stable/rollback"));
  assert(source.includes("/engine/health"));
  assert(source.includes("emergencyStopOutputs"));
  assert(source.includes("neutralizeOutputs"));
  assert(source.includes('nxbtHost: "NXBT 本機轉送位址"'));
  assert(source.includes(': "127.0.0.1";'));
  assert(source.includes("不要直接填 VirtualBox NAT 位址 10.0.2.15"));
  assert(source.includes("pollNxbtStatus"));
  assert(source.includes("NXBT 正在等待 Switch 配對"));
  assert(monitorSource.includes("fallbackControl"));
  assert(monitorSource.includes("/nxbt/emergency-stop"));
});

test("optional assistant keeps offline guidance and menu workflows available", () => {
  const source = fs.readFileSync("src/product-ui.js", "utf8");
  const serverSource = fs.readFileSync("server/runtime_services.py", "utf8");
  assert(source.includes("AI 助手未連線，核心功能可正常使用") || serverSource.includes("AI 助手未連線，核心功能可正常使用"));
  assert(source.includes("/control-bindings"));
  assert(source.includes("/training-guidance/preview"));
  assert(source.includes("/menu/workflows/record"));
  assert(source.includes("/nxbt/menu-action"));
  assert(source.includes("menuMode: Boolean"));
  assert(serverSource.includes('LOCKED_ASSISTANT_INPUTS = {"home", "capture"}'));
  assert(serverSource.includes("選單畫格已與賽車 PPO 資料隔離"));
  assert(serverSource.includes("連續兩次不確定"));
});

test("NXBT input test requires official screens and stick preparation", () => {
  const source = fs.readFileSync("src/product-ui.js", "utf8");
  const appSource = fs.readFileSync("src/app.js", "utf8");
  assert(source.includes("/nxbt/test-input"));
  assert(source.includes("測試輸入裝置 → 測試控制器按鍵"));
  assert(source.includes("控制器與周邊設備 → 校正控制搖桿"));
  assert(source.includes("先選擇${sideLabel}（向右到底）"));
  assert(source.includes("finish_button_test"));
  assert(source.includes("HOME、截圖、C、GL、GR"));
  assert(source.includes("syncControllerBackendCompatibility"));
  assert(source.includes("NXBT 只能使用 Switch 2 Pro 手把"));
  assert(source.includes("saveControllerOutputSelection"));
  assert(appSource.includes('data-action="open-nxbt-test"'));
  assert(appSource.includes("Joy-Con 2 握把不適用於 NXBT 或混合輸出"));
  assert(appSource.includes("getCompatibleControllerProfileId(saved.selectedProfileId, state.outputBackend)"));
  assert.equal(appSource.includes('data-action="open-nxbt-test" type="button" disabled'), false);
});
