export const INPUT_TYPES = {
  STICK: "stick",
  BUTTON: "button",
  TRIGGER: "trigger",
  DPAD: "dpad",
  SYSTEM: "system"
};

export const LIVE_LEARNING_MODES = {
  SAFE_ADAPTATION: "safe_adaptation",
  FULL_ONLINE_UPDATE: "full_online_update",
  SHADOW_MODEL_LEARNING: "shadow_model_learning"
};

export const OUTPUT_BACKENDS = {
  MECHANICAL_RIG: "mechanical_rig",
  NXBT_BLUETOOTH: "nxbt_bluetooth",
  HYBRID: "hybrid"
};

export const TOOLTIP_HELP = [
  {
    fieldId: "cameraCalibration",
    title: "鏡頭校正",
    shortDescription: "讓程式知道螢幕在畫面的哪裡。",
    recommendedValue: "讓整個遊戲畫面清楚入鏡，避免反光。",
    riskWarning: "選錯時 AI 會看錯分數、道路或失敗畫面。",
    moreInfo: "必要時調整攝影機角度，再重新框選畫面。"
  },
  {
    fieldId: "controllerProfile",
    title: "控制器類型",
    shortDescription: "選擇你裝在機械治具上的 Switch 2 手把。",
    recommendedValue: "用實際固定在治具上的那一款。",
    riskWarning: "選錯時馬達位置會對不上按鍵。",
    moreInfo: "Switch 2 Pro 與 Joy-Con 2 握把需要不同校正檔。"
  },
  {
    fieldId: "learningScore",
    title: "學習分數",
    shortDescription: "AI 用來判斷自己有沒有變好的分數。",
    recommendedValue: "使用排名、速度、進度、撞牆與道具效果自動計算。",
    riskWarning: "分數來源錯誤時 AI 可能學到錯的行為。",
    moreInfo: "這是白話版 reward，不需要手動調公式。"
  },
  {
    fieldId: "safeAdaptation",
    title: "安全適應",
    shortDescription: "正式遊玩時只做小幅修正。",
    recommendedValue: "預設開啟。",
    riskWarning: "關閉後 AI 比較可能在遊玩中突然退步。",
    moreInfo: "重大更新會等回合結束後驗證。"
  },
  {
    fieldId: "shadowModel",
    title: "旁邊偷偷練習的備用 AI",
    shortDescription: "主 AI 玩遊戲，備用 AI 在旁邊學。",
    recommendedValue: "預設開啟。",
    riskWarning: "關閉後就少了一層穩定切換保護。",
    moreInfo: "備用 AI 表現比較好時，系統才會切換或提示。"
  },
  {
    fieldId: "fullOnlineUpdate",
    title: "全程即時更新",
    shortDescription: "讓 AI 邊玩邊直接改自己的模型。",
    recommendedValue: "新手不建議開啟。",
    riskWarning: "可能快速進步，也可能突然亂操作。",
    moreInfo: "即使開啟，急停與馬達安全限制仍然有效。"
  },
  {
    fieldId: "emergencyStop",
    title: "急停",
    shortDescription: "立刻停止所有馬達並回到安全狀態。",
    recommendedValue: "正式遊玩時保持可按。",
    riskWarning: "急停失效時不能進入正式遊玩。",
    moreInfo: "硬體也應該有獨立實體急停。"
  },
  {
    fieldId: "videoTraining",
    title: "影片預訓練",
    shortDescription: "用遊戲畫面影片讓 AI 先學路線與時機。",
    recommendedValue: "匯入清楚、完整、少遮擋的遊玩影片。",
    riskWarning: "只有畫面影片不能準確還原真實手把操作。",
    moreInfo: "正式上機後會用畫面回饋繼續修正。"
  },
  {
    fieldId: "visualTraining",
    shortDescription: "CNN 會從連續鏡頭畫格學習賽道、彎道、障礙物與畫面變化，再和 OCR 與遊戲狀態一起交給 PPO。",
    recommendedValue: "保持 4 張連續畫格與視覺融合預設值；先錄製自己的控制器示範再開始探索。",
    riskWarning: "只用少量單一賽道資料可能過度記憶；鏡頭角度改變後需要重新收集資料。",
    moreInfoUrl: "#training"
  },
  {
    fieldId: "nxbtBackend",
    title: "NXBT 藍牙控制",
    shortDescription: "用 NXBT 在 Linux 藍牙環境中模擬 Switch Pro Controller；Windows 與 macOS 依官方方式透過 Linux VM 使用。",
    recommendedValue: "Windows 請準備 USB 藍牙轉接器、VirtualBox、Extension Pack 與 Vagrant，先在 VM 內跑 NXBT demo。",
    riskWarning: "內建藍牙、USB passthrough、BlueZ、root 權限或 Switch 2 相容性不符合時會無法連線。",
    moreInfo: "可取代部分機械按壓，也可和機械治具混合使用。"
  }
];

const sharedSlots = [
  { id: "left_stick_x", label: "左搖桿 X", type: INPUT_TYPES.STICK, axis: "x", min: -100, max: 100, neutral: 0 },
  { id: "left_stick_y", label: "左搖桿 Y", type: INPUT_TYPES.STICK, axis: "y", min: -100, max: 100, neutral: 0 },
  { id: "right_stick_x", label: "右搖桿 X", type: INPUT_TYPES.STICK, axis: "x", min: -100, max: 100, neutral: 0 },
  { id: "right_stick_y", label: "右搖桿 Y", type: INPUT_TYPES.STICK, axis: "y", min: -100, max: 100, neutral: 0 },
  { id: "left_stick_press", label: "左搖桿按下", type: INPUT_TYPES.BUTTON, maxPressMs: 700 },
  { id: "right_stick_press", label: "右搖桿按下", type: INPUT_TYPES.BUTTON, maxPressMs: 700 },
  { id: "dpad_up", label: "方向鍵 上", type: INPUT_TYPES.DPAD, maxPressMs: 900 },
  { id: "dpad_down", label: "方向鍵 下", type: INPUT_TYPES.DPAD, maxPressMs: 900 },
  { id: "dpad_left", label: "方向鍵 左", type: INPUT_TYPES.DPAD, maxPressMs: 900 },
  { id: "dpad_right", label: "方向鍵 右", type: INPUT_TYPES.DPAD, maxPressMs: 900 },
  { id: "a", label: "A", type: INPUT_TYPES.BUTTON, maxPressMs: 1200 },
  { id: "b", label: "B", type: INPUT_TYPES.BUTTON, maxPressMs: 1200 },
  { id: "x", label: "X", type: INPUT_TYPES.BUTTON, maxPressMs: 1200 },
  { id: "y", label: "Y", type: INPUT_TYPES.BUTTON, maxPressMs: 1200 },
  { id: "l", label: "L", type: INPUT_TYPES.TRIGGER, maxPressMs: 1500 },
  { id: "r", label: "R", type: INPUT_TYPES.TRIGGER, maxPressMs: 1500 },
  { id: "zl", label: "ZL", type: INPUT_TYPES.TRIGGER, maxPressMs: 1500 },
  { id: "zr", label: "ZR", type: INPUT_TYPES.TRIGGER, maxPressMs: 1500 },
  { id: "plus", label: "+", type: INPUT_TYPES.SYSTEM, maxPressMs: 700 },
  { id: "minus", label: "-", type: INPUT_TYPES.SYSTEM, maxPressMs: 700 },
  { id: "home", label: "HOME", type: INPUT_TYPES.SYSTEM, maxPressMs: 500 },
  { id: "capture", label: "截圖鍵", type: INPUT_TYPES.SYSTEM, maxPressMs: 500 }
];

export const CONTROLLER_PROFILES = {
  switch2_pro: {
    id: "switch2_pro",
    displayName: "Switch 2 Pro Controller",
    beginnerName: "Switch 2 Pro 手把",
    description: "外型固定，最適合長時間 AI 訓練。",
    slots: [
      ...sharedSlots,
      { id: "c_button", label: "C Button", type: INPUT_TYPES.SYSTEM, maxPressMs: 500 },
      { id: "gl", label: "GL", type: INPUT_TYPES.BUTTON, maxPressMs: 1000 },
      { id: "gr", label: "GR", type: INPUT_TYPES.BUTTON, maxPressMs: 1000 }
    ]
  },
  joycon2_grip: {
    id: "joycon2_grip",
    displayName: "Joy-Con 2 Grip",
    beginnerName: "Joy-Con 2 握把",
    description: "貼近主機標配，需要更仔細固定左右控制器。",
    slots: sharedSlots
  }
};

export const DEFAULT_LIVE_POLICY = {
  modes: [LIVE_LEARNING_MODES.SAFE_ADAPTATION, LIVE_LEARNING_MODES.SHADOW_MODEL_LEARNING],
  updateEverySeconds: 20,
  switchThresholdPercent: 8,
  rollbackDropPercent: 12,
  requireSafetyGate: true
};

export const OUTPUT_BACKEND_PROFILES = {
  [OUTPUT_BACKENDS.MECHANICAL_RIG]: {
    id: OUTPUT_BACKENDS.MECHANICAL_RIG,
    beginnerName: "機械治具",
    description: "用馬達實際推動完整手把，最接近原本計畫，也最不依賴藍牙相容性。",
    requiresRigCalibration: true,
    requiresNxbt: false,
    experimental: false
  },
  [OUTPUT_BACKENDS.NXBT_BLUETOOTH]: {
    id: OUTPUT_BACKENDS.NXBT_BLUETOOTH,
    beginnerName: "NXBT 藍牙控制",
    description: "用 Linux + BlueZ + NXBT 模擬 Switch Pro Controller。Windows 與 macOS 主機依 NXBT 官方方式透過 Linux VM 使用。",
    requiresRigCalibration: false,
    requiresNxbt: true,
    experimental: true
  },
  [OUTPUT_BACKENDS.HYBRID]: {
    id: OUTPUT_BACKENDS.HYBRID,
    beginnerName: "混合模式",
    description: "能用 NXBT 的輸入走藍牙，保留機械治具處理不穩或特殊鍵位。",
    requiresRigCalibration: true,
    requiresNxbt: true,
    experimental: true
  }
};

export function getCompatibleControllerProfileId(profileId, outputBackend) {
  const backendProfile = OUTPUT_BACKEND_PROFILES[outputBackend];
  if (backendProfile?.requiresNxbt) return "switch2_pro";
  return CONTROLLER_PROFILES[profileId] ? profileId : "switch2_pro";
}

export const SETUP_STEPS = [
  {
    id: "device_check",
    name: "設備檢查",
    requiredCheck: "攝影機、開發板、急停都要連線。",
    skippableWhen: "不可跳過。",
    successMessage: "設備已準備好。",
    failureFix: "請檢查 USB 線、外部電源與急停開關。"
  },
  {
    id: "controller_select",
    name: "選擇控制器",
    requiredCheck: "選擇 Switch 2 Pro 或 Joy-Con 2 握把。",
    skippableWhen: "不可跳過。",
    successMessage: "控制器 profile 已載入。",
    failureFix: "請選擇實際固定在治具上的控制器。"
  },
  {
    id: "camera_calibration",
    name: "鏡頭校正",
    requiredCheck: "遊戲畫面要清楚入鏡。",
    skippableWhen: "匯入影片先訓練時可稍後做。",
    successMessage: "鏡頭已看清楚畫面。",
    failureFix: "請移動攝影機，讓螢幕四角都在畫面內。"
  },
  {
    id: "rig_calibration",
    name: "完整手把校正",
    requiredCheck: "每個搖桿、按鍵、肩鍵都要測試到位。",
    skippableWhen: "不可進入正式遊玩前跳過。",
    successMessage: "完整手把校正完成。",
    failureFix: "若按不到，請把對應模組往下或往內調 2-3 mm。"
  },
  {
    id: "video_import",
    name: "影片匯入",
    requiredCheck: "可匯入遊玩影片做預訓練。",
    skippableWhen: "沒有影片也可直接實機自學。",
    successMessage: "影片來源已選擇，等待訓練引擎匯入。",
    failureFix: "請使用清楚且沒有遮擋的遊戲畫面影片。"
  },
  {
    id: "training",
    name: "訓練",
    requiredCheck: "讓 AI 先學習基本路線與不要撞牆。",
    skippableWhen: "正式遊玩前建議至少跑一次。",
    successMessage: "AI 已有可用的起始策略。",
    failureFix: "如果沒有進步，請重新校正鏡頭或降低遊戲難度。"
  },
  {
    id: "live_play",
    name: "正式遊玩",
    requiredCheck: "安全閘門通過後才能啟動。",
    skippableWhen: "不可跳過安全檢查。",
    successMessage: "正式遊玩安全檢查已完成。",
    failureFix: "請確認急停、馬達行程與失聯歸零都正常。"
  }
];

export function createRigConfig(profileId) {
  const profile = CONTROLLER_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown controller profile: ${profileId}`);
  }

  return {
    controllerType: profile.id,
    displayName: profile.displayName,
    slots: profile.slots.map((slot, index) => ({
      ...slot,
      motorChannel: index + 1,
      calibrated: false,
      homePosition: slot.type === INPUT_TYPES.STICK ? slot.neutral : 0,
      travelLimit: slot.type === INPUT_TYPES.STICK ? { min: slot.min, max: slot.max } : { min: 0, max: 1 },
      maxPressMs: slot.maxPressMs ?? 1000
    })),
    safety: {
      emergencyStopRequired: true,
      maxCommandMs: 1500,
      lostConnectionReturnHomeMs: 500,
      abnormalActionDetection: true
    }
  };
}

export function createDefaultActionCommand(rigConfig) {
  return {
    timestamp: Date.now(),
    durationMs: 120,
    priority: "normal",
    sticks: rigConfig.slots
      .filter((slot) => slot.type === INPUT_TYPES.STICK)
      .reduce((acc, slot) => {
        acc[slot.id] = 0;
        return acc;
      }, {}),
    buttons: rigConfig.slots
      .filter((slot) => slot.type !== INPUT_TYPES.STICK)
      .reduce((acc, slot) => {
        acc[slot.id] = false;
        return acc;
      }, {})
  };
}

export function clampActionCommand(command, rigConfig) {
  const maxCommandMs = rigConfig.safety.maxCommandMs;
  const pressedSlotLimits = rigConfig.slots
    .filter((slot) => slot.type !== INPUT_TYPES.STICK && command.buttons?.[slot.id])
    .map((slot) => slot.maxPressMs);
  const commandLimitMs = Math.min(maxCommandMs, ...pressedSlotLimits);
  const clamped = {
    ...command,
    durationMs: Math.max(20, Math.min(command.durationMs, commandLimitMs)),
    sticks: { ...command.sticks },
    buttons: { ...command.buttons }
  };

  for (const slot of rigConfig.slots) {
    if (slot.type === INPUT_TYPES.STICK && slot.id in clamped.sticks) {
      clamped.sticks[slot.id] = Math.max(slot.travelLimit.min, Math.min(clamped.sticks[slot.id], slot.travelLimit.max));
    }
  }

  return clamped;
}

export function evaluateSafetyGate({
  rigConfig,
  outputBackend = OUTPUT_BACKENDS.MECHANICAL_RIG,
  cameraReady = false,
  cameraCalibrated = false,
  emergencyStopOk,
  connectionOk,
  externalPowerOk = false,
  nxbtReady = false,
  calibratedSlotIds
}) {
  const backendProfile = OUTPUT_BACKEND_PROFILES[outputBackend] ?? OUTPUT_BACKEND_PROFILES[OUTPUT_BACKENDS.MECHANICAL_RIG];
  const missingCalibration = backendProfile.requiresRigCalibration
    ? rigConfig.slots
      .filter((slot) => !calibratedSlotIds.includes(slot.id))
      .map((slot) => slot.label)
    : [];

  const issues = [];
  if (backendProfile.requiresNxbt && rigConfig.controllerType !== "switch2_pro") {
    issues.push("NXBT 只能模擬 Switch Pro Controller，請將控制器改為 Switch 2 Pro 手把。");
  }
  if (!cameraReady) issues.push("尚未取得真實鏡頭畫面，不能正式遊玩。");
  if (!cameraCalibrated) issues.push("鏡頭畫面尚未完成確認，不能正式遊玩。");
  if (!emergencyStopOk) issues.push("急停路徑沒有通過測試，不能正式遊玩。");
  if (backendProfile.requiresRigCalibration && !connectionOk) issues.push("開發板連線不穩，請重新插拔 USB 或更換線材。");
  if (backendProfile.requiresRigCalibration && !externalPowerOk) issues.push("馬達外部電源尚未由開發板回報正常，不能正式遊玩。");
  if (backendProfile.requiresNxbt && !nxbtReady) issues.push("NXBT 尚未連線，請確認 Linux/BlueZ、藍牙轉接器與 Switch 配對畫面。");
  if (missingCalibration.length > 0) {
    issues.push(`還有 ${missingCalibration.length} 個輸入沒有校正：${missingCalibration.slice(0, 4).join("、")}${missingCalibration.length > 4 ? "..." : ""}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    nextStep: issues.length === 0 ? "可以進入正式遊玩。" : "請先完成上面項目，再重新檢查安全閘門。"
  };
}

export function getTrainingReadiness({
  completedSteps,
  cameraReady = false,
  cameraCalibrated = false,
  importedVideoName = "",
  rigConfig,
  outputBackend = OUTPUT_BACKENDS.MECHANICAL_RIG,
  emergencyStopOk,
  connectionOk,
  externalPowerOk = false,
  nxbtReady = false,
  calibratedSlotIds
}) {
  const completed = new Set(completedSteps);
  const issues = [];

  if (!completed.has("device_check")) issues.push("請先完成設備檢查。");
  if (!completed.has("controller_select")) issues.push("請先選擇實際使用的控制器。");
  if (!cameraReady) issues.push("請先開啟真實鏡頭。匯入影片只用於畫面暖身，不能取代實機鏡頭。");
  if (!cameraCalibrated) issues.push("請先完成真實鏡頭校正。匯入影片不能取代鏡頭校正。");
  const safety = evaluateSafetyGate({
    rigConfig,
    outputBackend,
    cameraReady,
    cameraCalibrated,
    emergencyStopOk,
    connectionOk,
    externalPowerOk,
    nxbtReady,
    calibratedSlotIds
  });
  if (!safety.ok) issues.push(...safety.issues);

  let nextStepId = "device_check";
  if (completed.has("device_check") && !completed.has("controller_select")) nextStepId = "controller_select";
  else if (completed.has("device_check") && completed.has("controller_select") && !cameraCalibrated) nextStepId = "camera_calibration";
  else if (issues.some((issue) => issue.includes("沒有校正"))) nextStepId = "rig_calibration";
  else if (issues.some((issue) => issue.includes("NXBT"))) nextStepId = "device_check";

  return {
    ok: issues.length === 0,
    issues,
    nextStepId,
    nextStep: issues.length === 0 ? "可以開始訓練。" : "請先完成必要設定，系統才會允許訓練。"
  };
}

export function createNxbtCommand(command) {
  return {
    backend: OUTPUT_BACKENDS.NXBT_BLUETOOTH,
    durationMs: command.durationMs,
    buttons: { ...(command.buttons ?? {}) },
    sticks: {
      left_stick_x: command.sticks?.left_stick_x ?? 0,
      left_stick_y: command.sticks?.left_stick_y ?? 0,
      right_stick_x: command.sticks?.right_stick_x ?? 0,
      right_stick_y: command.sticks?.right_stick_y ?? 0
    }
  };
}

export function computeLearningScore(gameState) {
  const speedScore = Math.min(30, Math.max(0, gameState.speedKmh / 5));
  const rankScore = Math.max(0, 28 - gameState.rank);
  const progressScore = Math.min(30, Math.max(0, gameState.progressPercent * 0.3));
  const itemScore = gameState.itemEffectPositive ? 8 : 0;
  const penalties = (gameState.crashed ? 18 : 0) + (gameState.fallingBehind ? 10 : 0) + (gameState.failed ? 35 : 0);
  return Math.max(0, Math.round(speedScore + rankScore + progressScore + itemScore - penalties));
}

export function shouldRollbackModel({ previousScore, currentScore, policy = DEFAULT_LIVE_POLICY }) {
  if (previousScore <= 0) return false;
  const dropPercent = ((previousScore - currentScore) / previousScore) * 100;
  return dropPercent >= policy.rollbackDropPercent;
}

export function shouldSwitchToShadowModel({ mainScore, shadowScore, policy = DEFAULT_LIVE_POLICY }) {
  if (!policy.modes.includes(LIVE_LEARNING_MODES.SHADOW_MODEL_LEARNING)) return false;
  if (mainScore <= 0) return shadowScore > 0;
  return ((shadowScore - mainScore) / mainScore) * 100 >= policy.switchThresholdPercent;
}

export function getHelpByField(fieldId) {
  return TOOLTIP_HELP.find((help) => help.fieldId === fieldId);
}
