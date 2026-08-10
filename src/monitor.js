(() => {
  const projectId = new URLSearchParams(location.search).get("project") || "";
  let token = "";
  const details = document.querySelector("#popupMonitorDetails");
  const projectName = document.querySelector("#monitorProjectName");
  const toast = document.querySelector("#popupToast");
  const cameraVideo = document.querySelector("#popupMonitorVideo");
  const cameraEmpty = document.querySelector("#popupCameraEmpty");
  let monitorSource = null;

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("X-Session-Token", token);
    headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...options, headers, body: options.json ? JSON.stringify(options.json) : undefined });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function metric(label, value) {
    return `<div class="monitor-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function render(status) {
    const game = status.lastGameState || {};
    details.innerHTML = `
      <h3>即時摘要</h3>
      ${metric("AI 模式", status.mode)}
      ${metric("狀態", status.paused ? "已暫停" : "待命")}
      ${metric("訓練/控制引擎", status.engineReady ? "已接入" : "未接入")}
      ${metric("視覺辨識", status.visionReady ? "已接入" : "未接入")}
      ${metric("控制輸出", status.controllerReady ? "已接入" : "未接入")}
      ${metric("模型", status.modelReady ? "可用" : "未驗證")}
      ${metric("速度", game.speed ?? "等待辨識")}
      ${metric("排名", game.rank ?? "等待辨識")}
      ${metric("進度", game.progress === null || game.progress === undefined ? "等待辨識" : `${game.progress}%`)}
      ${metric("道具", game.itemState || "等待辨識")}
      ${metric("碰撞 / 失敗", game.failed ? "已辨識失敗" : game.crashed ? "可能碰撞" : "未辨識到")}
      ${metric("OCR 信心", game.confidence === undefined ? "等待辨識" : game.confidence)}
      <p>${esc(status.message)}</p>
    `;
  }

  async function fallbackControl(action) {
    if (action === "pause" || action === "stop") {
      await api(`/api/projects/${encodeURIComponent(projectId)}/nxbt/action`, {
        method: "POST",
        json: { durationMs: 120, sticks: { left_stick_x: 0, left_stick_y: 0, right_stick_x: 0, right_stick_y: 0 }, buttons: {} }
      }).catch(() => {});
    }
    if (action === "emergency-stop") {
      await api(`/api/projects/${encodeURIComponent(projectId)}/nxbt/emergency-stop`, { method: "POST", json: {} }).catch(() => {});
    }
    const result = await api(`/api/projects/${encodeURIComponent(projectId)}/control/${encodeURIComponent(action)}`, { method: "POST", json: {} });
    if (action === "stop") await api(`/api/projects/${encodeURIComponent(projectId)}/engine/stop`, { method: "POST", json: {} }).catch(() => {});
    return result;
  }

  async function init() {
    if (!projectId) {
      projectName.textContent = "網址缺少專案 ID。";
      return;
    }
    try {
      token = (await api("/api/bootstrap")).token;
      const project = await api(`/api/projects/${encodeURIComponent(projectId)}`);
      projectName.textContent = `專案：${project.manifest.name}`;
      const openerStream = window.opener?.AppRuntime?.state?.cameraStream;
      document.querySelector(".monitor-roi").hidden = window.opener?.AppRuntime?.state?.runtimeSettings?.monitor?.showAnnotations === false;
      if (openerStream) {
        cameraVideo.srcObject = openerStream;
        cameraEmpty.hidden = true;
        openerStream.getVideoTracks()[0]?.addEventListener("ended", () => {
          cameraVideo.srcObject = null;
          cameraEmpty.hidden = false;
        }, { once: true });
      }
      monitorSource = new EventSource(`/api/projects/${encodeURIComponent(projectId)}/monitor/stream`);
      monitorSource.onmessage = (event) => render(JSON.parse(event.data));
      document.querySelectorAll("[data-control]").forEach((button) => button.addEventListener("click", async () => {
        try {
          const action = button.dataset.control;
          const result = window.opener?.ProjectUI?.sendControl
            ? await window.opener.ProjectUI.sendControl(action)
            : await fallbackControl(action);
          if (button.dataset.control === "stop") {
            if (window.opener?.ProjectUI?.saveState) {
              await window.opener.ProjectUI.saveState("popup_stop_and_save");
              showToast("已記錄停止要求並請主頁保存目前狀態。");
            } else {
              showToast("已記錄停止要求；主頁已關閉，無法補做前端存檔。");
            }
          } else {
            showToast(action === "emergency-stop" && !window.opener
              ? "已要求 NXBT 急停。主頁已關閉，機械治具請立即使用實體急停。"
              : result.message);
          }
        } catch (error) {
          showToast(`操作未執行：${error.message}`);
        }
      }));
      document.querySelector("#popupSnapshot").addEventListener("click", async () => {
        const name = window.prompt("快照名稱", "監控視窗快照");
        if (!name) return;
        try {
          if (window.opener?.ProjectUI?.saveState) await window.opener.ProjectUI.saveState("before_popup_snapshot");
          await api(`/api/projects/${encodeURIComponent(projectId)}/snapshots`, { method: "POST", json: { name } });
          showToast("快照已建立。");
        } catch (error) {
          showToast(`快照未建立：${error.message}`);
        }
      });
    } catch (error) {
      projectName.textContent = `無法載入：${error.message}`;
    }
  }

  window.addEventListener("pagehide", () => {
    monitorSource?.close();
    cameraVideo.srcObject = null;
  });

  init();
})();
