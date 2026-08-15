# Nintendo Switch 2 AI Controller Rig

本專案是第一版本機應用，目標是把「攝影機看遊戲畫面、AI 訓練、完整控制器機械治具、正式遊玩中即時更正」做成一般使用者能操作的流程。

## Run

為了讓瀏覽器正常取得攝影機權限，請使用對應作業系統的啟動器。點擊後會自動啟動 localhost 並開啟瀏覽器：

- Windows：雙擊 `start-windows.cmd`
- macOS：雙擊 `start-macos.command`
- Linux：執行或雙擊 `start-linux.sh`

macOS 或 Linux 如果第一次執行時被系統阻擋，先在終端機執行一次：

```bash
chmod +x start-macos.command start-linux.sh
```

不要直接用 `file://` 開啟 `index.html`。鏡頭權限取決於瀏覽器安全政策，系統不會在未取得真實鏡頭預覽畫面時假裝校正成功。鏡頭頁會以四角框顯示實際偵測到的螢幕範圍；綠色代表後端已驗證。精準驗證會同時檢查四角幾何、至少 3/4 條真實外框邊、框內畫面內容，並要求連續 3 張畫格位置穩定；只有遮住鏡頭、框住任意區域或只移動一個角都不會直接通過。自動偵測不準時，可拖曳編號 1 至 4 的四個角到真正的螢幕外框，放開後系統會重新累積三張驗證。完成前不會把畫格交給 PPO 產生控制動作。鏡頭頁也提供「關閉鏡頭」，會停止 camera tracks 並清除本次校正狀態。

只關閉瀏覽器分頁不會自動停止 localhost 後端。正常結束時，請按網頁上方的 `結束程式`，確認後系統會停止訓練與控制、回到中立、釋放鏡頭與 Serial、斷開 NXBT，最後關閉 localhost 伺服器。若隔離訓練 worker 正忙，結束流程只短暫等待，之後會直接終止 worker，避免程式繼續留在背景；已完成的專案存檔不受影響。看到「程式已結束」後即可關閉分頁。

啟動器會執行 `server/app.py`。專案資料會保存在 `data/`，包含遊戲專案、設定、訓練狀態、快照、日志、重要片段資料夾與回收區。切換或重開專案後，鏡頭、Serial、急停與 NXBT 都必須重新驗證。

若要跑核心邏輯測試：

```bash
npm test
python -m unittest discover -s tests -p "test_*.py" -v
```

## Prototype Scope

- Switch 2 Pro Controller 與 Joy-Con 2 握把 profile
- 完整控制器 slot：雙搖桿、方向鍵、正面鍵、肩鍵/扳機、功能鍵、特殊鍵
- 新手引導流程：設備檢查、控制器選擇、鏡頭校正、完整手把校正、影片匯入、訓練、正式遊玩
- 每個專業設定都有 `i` tooltip，包含這是什麼、推薦怎麼選、選錯會怎樣
- 即時自我修正模式：安全適應、全程即時更新、旁邊偷偷練習的備用 AI
- 安全閘門：急停、行程限制、最大按壓時間、失聯歸零、異常動作偵測
- 可選 NXBT 輸出後端：機械治具、NXBT 藍牙控制、混合模式
- 訓練頁人工控制：在訓練停止時，可操作雙搖桿、方向鍵、A/B/X/Y、L/R/ZL/ZR、`+/-` 與左右搖桿按下，以完成進入遊戲等前置作業；HOME 與截圖鍵永久禁止

這版已具備本機專案記憶、快照、ZIP 備份、日志、進階設定中心、即時監控、AI 助手、OCR 畫格處理，以及隔離 worker 內的 Stable-Baselines3 PPO 視覺融合訓練路徑。PPO 使用 4 張連續灰階畫格交給 CNN，再把 CNN 特徵與速度、進度、排名、辨識信心、碰撞、落後、失敗及學習分數融合後決定雙搖桿與安全按鍵。系統不會把未連線的攝影機、開發板、急停、OCR 套件或訓練套件顯示為正常。實機配對、辨識品質與自學效果仍必須用 Switch 2、遊戲畫面、藍牙或治具驗證後才能確認。

影片匯入會真的複製到目前專案的 `datasets/imported/`。安裝 OpenCV 後會抽取暖身畫格；沒有操作標籤的影片只用於畫面暖身、OCR 校正與成功失敗辨識，不會假裝能還原搖桿操作。開發板韌體的 `PING` 回覆必須同時包含 `board_ready` 與 `power_ok`，系統才會允許機械治具流程繼續。

`GET /api/capabilities` 會列出本機選配套件狀態。真實引擎 adapter 的介面在 `server/engines.py`。即使偵測到套件，也不代表鏡頭、硬體或模型已驗證；adapter 必須完成真實檢查後才能回報可用。

首頁的「晶片偵測」會分開顯示實際 CPU、GPU、NPU，以及 PyTorch CUDA、Intel XPU、Apple MPS、AMD ROCm、OpenVINO NPU 和 CPU fallback 是否真的可用。可按「重新偵測晶片」更新結果。

「日志」頁提供手動清除，可分別刪除事件日志、動作日志或全部日志，並可選擇是否一併刪除重要片段資料夾。系統會保留一筆清除操作的稽核紀錄。目前會保存撞牆與失敗的重大事件 JPEG；事件前後短片仍需要補上瀏覽器環形錄影緩衝。

## Local AI Runtime

「進階功能」的「套件管理」會建立 `.runtime/venv`，不修改系統 Python。可逐項安裝，或按「安裝推薦套件」準備 OpenCV、EasyOCR、PyTorch、Torchvision、Stable-Baselines3、Gymnasium、PySerial 與 keyring。OpenVINO 是 Intel 推論加速選配。

OCR 預設每秒讀取一次繁體中文與英文；推論畫格預設每秒五次，資料集抽樣預設每秒兩次。畫格只送到 localhost 後端。專案資料預設上限為 20 GB，超過後先清除最舊的一般抽樣畫格、狀態檔與匯入影片；若仍超標才清除最舊重大事件畫格。模型與快照不在這個自動清理範圍。

工具列的「AI 助手」支援 Ollama `http://localhost:11434/v1`、LM Studio `http://localhost:1234/v1` 與其他 OpenAI-compatible `/v1` URL。LLM 只負責理解文字、整理記憶與提出需確認的變更，不直接控制每一幀操作。Windows 勾選「記住金鑰」後會使用 DPAPI；macOS 使用 Keychain；Linux 使用 keyring。金鑰不會寫入專案 JSON、日志、快照或 ZIP。

LLM 是選配功能。沒有設定 API、Ollama／LM Studio 沒有啟動、連線中斷或模型不支援圖片時，鏡頭、OCR、影片匯入、Gamepad 示範、CNN + PPO、NXBT、機械治具、專案存檔、日志與安全閘門仍可使用。LLM 網路要求由專用背景 worker 執行，不占用鏡頭、控制或本地訓練 worker。LLM 連續失敗三次後會停止自動重試；可在 AI 助手按「重新連線」，這不會停止正在執行的 PPO。

常用繁中指令會先由本機白名單規則理解，不會送到 LLM，例如：

```text
記住 A 是加速
ZR 是使用道具
這一回合優先不要撞牆
增加撞牆扣分
建立快照
暫停
繼續
停止並保存
記住這段選單操作
```

無法確定意思時，離線助手不會猜測，請改用「控制器用途」、「訓練指導」或「選單導航」表單。控制器用途依比賽、選單、全域保存。訓練指導每次最多改變原權重 25%，先預覽，再排程到下一回合生效；版本、checkpoint 與稽核日志會保留。

「選單導航」的「教 AI 一次」會同步保存 OCR、畫面狀態、Gamepad 動作與畫面轉換。選單資料保存在 `menu/`，不會寫入賽車 PPO 的 `datasets/trajectories/`。重播時一次只執行最長 250 ms，回中立後重新看畫面；20 步、60 秒、畫面不符或本地視覺模型連續兩次低信心時會停止。沒有已錄製流程、內建模板或可靠本地視覺模型時，系統會要求使用者接手，不會在陌生選單亂按。只有 localhost 本地視覺模型可以自動收到選單截圖；成功的視覺導航可保存為下次離線重播流程。

「進階功能 > AI 助手與訓練指導／選單導航」可調整文字指令預設強度、每步時間、步數、逾時、視覺信心門檻及 Gamepad 方向鍵與 `+/-` 索引。後端仍會強制 25% guidance、250 ms、20 步與 60 秒硬性上限。

影子模型累積後，正式遊玩頁會顯示「試跑備用 AI」。試跑必須由使用者手動確認，且會先保留穩定模型備份；表現下降時可按「回滾穩定模型」。第一版不會直接改寫正在控制的主 AI；即使勾選「全程即時更新要求」，worker 仍使用可回滾的旁路更新並在狀態訊息中說明。

## Visual neural network and demonstrations

目前的 PPO 不再只讀取 8 個整理後數值。Gymnasium observation 使用 `Dict`，包含 `image` 與 `state`：`image` 是 4 張 `144x84` 灰階連續畫格，交給 Stable-Baselines3 的 NatureCNN；`state` 是 8 個遊戲狀態值。`MultiInputPolicy` 會融合兩者，再交給 policy/value 神經網路。

訓練頁的「錄製我的操作示範」會使用瀏覽器 Gamepad API。請把可被電腦辨識的手把連接到電腦，開啟鏡頭後開始錄製；系統會用同一個 frame ID 保存鏡頭畫格、雙搖桿、`A/B/X/Y/L/R/ZL/ZR` 與時間戳。錄製完成後按「用示範暖身 AI」，先做行為模仿，再進入 PPO 實機探索。賽車 PPO 仍鎖住方向鍵、HOME、截圖、`+`、`-`；只有獨立的選單導航可使用方向鍵與 `+`、`-`，HOME 與截圖鍵在所有模式永久禁止。

瀏覽器的標準 Gamepad 按鍵編號可能因驅動或控制器模式不同而交換。正式收集大量資料前，先用短片段確認 A/B/X/Y 與雙搖桿方向是否正確；四個搖桿軸與八個安全按鍵索引可在「進階功能 > AI 訓練」調整。只匯入一般遊戲影片而沒有同步控制日志時，仍只能用於畫面/OCR 暖身，不能可靠推回當時的搖桿操作。

只有控制後端回報實際執行成功的示範會參與暖身；失敗或被安全閘門阻擋的命令不會教給 AI。同步示範索引、執行回報與其畫格不會被一般資料容量清理自動刪除，避免已標記資料失去對應影像或可信執行狀態。

每個 AI 動作現在都有 action ID 和來源 frame ID。`states.jsonl` 保存模型提出的動作，`executions.jsonl` 另外保存控制後端實際成功、失敗或阻止的結果，避免把送出失敗的命令當成正確訓練資料。舊版 8 數值 MLP 模型不會直接套入新的影像 observation；第一次啟動視覺模型時會將舊檔備份到 `models/legacy/`，再建立相容模型。

## Generic Serial Rig

機械治具使用 JSON Lines。尚未選定 ESP32、Arduino 或其他開發板時，可先使用模擬器驗證控制契約：

```bash
python tools/serial_rig_simulator.py
```

範例命令：

```json
{"type":"action","id":"demo-1","durationMs":120,"sticks":{"left_stick_x":25},"buttons":{"a":true}}
{"type":"neutral","id":"demo-2"}
{"type":"emergency_stop","id":"demo-3"}
```

模擬器只驗證協定，不是可燒錄韌體，也不會驅動馬達。

## NXBT Integration

NXBT 可以當成進階輸出後端，讓 Linux 藍牙環境模擬 Nintendo Switch Pro Controller。Linux 可以原生執行；Windows 與 macOS 依 [NXBT 官方安裝說明](https://github.com/Brikwerk/nxbt/blob/master/docs/Windows-and-macOS-Installation.md) 透過 VirtualBox + Vagrant Linux VM 執行。這可以取代部分機械按壓，也可以和機械治具混合使用。

限制：

- NXBT 官方文件主要描述 Nintendo Switch，不保證 Nintendo Switch 2 一定可配對，必須實機驗證。
- Linux 原生執行常見需求是 BlueZ、可用藍牙轉接器，以及可能需要 root 權限。
- Windows 與 macOS 官方路徑需要 USB 藍牙轉接器、VirtualBox、VirtualBox Extension Pack、Vagrant 與 Python 3。內建藍牙通常無法 passthrough 給 VM。
- 如果只用 NXBT，物理急停和馬達校正不適用，但仍需要軟體安全閘門與回滾。

### `nxbt webapp` 啟動錯誤

依 [NXBT README](https://github.com/Brikwerk/nxbt/blob/master/README.md) 執行：

```bash
sudo nxbt webapp
```

如果遇到以下錯誤：

```text
ImportError: cannot import name 'escape' from 'jinja2'
```

請在執行 NXBT 的 Linux 主機或 VM 內安裝相容版本：

```bash
sudo pip3 install "jinja2==3.0.3"
sudo pip3 install "flask==1.1.2"
sudo pip3 install "werkzeug==2.0.3"
sudo pip3 install "markupsafe==2.0.1"
sudo pip3 install "itsdangerous==2.0.1"
```

安裝後執行版本檢查：

```bash
python3 -c "import flask, jinja2, werkzeug, markupsafe, itsdangerous; print('Flask:', flask.__version__, '\nJinja2:', jinja2.__version__, '\nWerkzeug:', werkzeug.__version__, '\nMarkupSafe:', markupsafe.__version__, '\nitsdangerous:', itsdangerous.__version__)"
```

預期會顯示：

```text
Flask: 1.1.2
Jinja2: 3.0.3
Werkzeug: 2.0.3
MarkupSafe: 2.0.1
itsdangerous: 2.0.1
```

版本一致後，再執行：

```bash
sudo nxbt webapp
```

本專案提供兩種 bridge：

```bash
python tools/nxbt_bridge.py --dry-run
```

上面的 stdin bridge 適合開發與命令驗證。要接到本程式網頁，請使用 HTTP VM bridge。Windows 與 macOS 請在官方建立的 Linux VM 內執行；Linux 原生安裝則可直接在本機執行：

```bash
sudo python tools/nxbt_bridge_server.py --host 0.0.0.0 --port 8766 --token 自己設定一組隨機字串
```

### Windows 與 macOS：複製 bridge 到 NXBT VM

先在 Windows 或 macOS 找到你從 GitHub clone 下來的 `nxbt` 資料夾。這個資料夾內應該已經有 `Vagrantfile` 與 `vagrant_setup.py`。

在 `nxbt` 資料夾內建立 `tools` 資料夾，將本專案的兩個 bridge 檔案複製進去。宿主機的資料夾結構應該是：

```text
nxbt/
  Vagrantfile
  vagrant_setup.py
  tools/
    nxbt_bridge.py
    nxbt_bridge_server.py
```

Windows 範例：

```powershell
cd C:\Users\你的名字\nxbt
New-Item -ItemType Directory -Force tools
Copy-Item "C:\你的專案路徑\A AI real time play games\tools\nxbt_bridge.py" tools\
Copy-Item "C:\你的專案路徑\A AI real time play games\tools\nxbt_bridge_server.py" tools\
vagrant up
vagrant ssh
```

macOS 範例：

```bash
cd ~/nxbt
mkdir -p tools
cp "/你的路徑/A AI real time play games/tools/nxbt_bridge.py" tools/
cp "/你的路徑/A AI real time play games/tools/nxbt_bridge_server.py" tools/
vagrant up
vagrant ssh
```

Vagrant 會將宿主機的 `nxbt` 資料夾掛載到 VM 的 `/vagrant`。進入 VM 後執行：

```bash
cd /vagrant
ls tools
sudo python3 tools/nxbt_bridge_server.py --host 0.0.0.0 --port 8766 --token 自己設定一組隨機字串
```

終端顯示 `NXBT VM bridge ready` 後保持這個 SSH 視窗開啟。Windows 與 macOS 不要直接使用 VM 顯示的 `10.0.2.15` 類 NAT 位址；請繼續完成下一段 localhost 轉送。

### Windows 與 macOS：讓 localhost 連到 VM bridge

NXBT 官方 `Vagrantfile` 預設只轉送 `8000` 與 `9000`，不會自動轉送本專案使用的 `8766`。即使 VM 內已顯示 `NXBT VM bridge ready`，宿主機仍可能無法直接連線。請使用以下其中一種方式。

推薦方式：在宿主機的 `nxbt/Vagrantfile` 中，放在既有 `forwarded_port` 設定旁邊加入：

```ruby
config.vm.network "forwarded_port", guest: 8766, host: 8766, host_ip: "127.0.0.1" # Switch 2 AI localhost bridge
```

接著在宿主機的 `nxbt` 資料夾執行：

```bash
vagrant reload
vagrant ssh
cd /vagrant
sudo python3 tools/nxbt_bridge_server.py --host 0.0.0.0 --port 8766 --token 自己設定一組隨機字串
```

`vagrant reload` 會重新啟動 VM，因此 bridge 必須重新啟動。網頁連接 NXBT 時，本機轉送位址填入 `127.0.0.1`，連接埠填入 `8766`。

臨時方式：不修改 `Vagrantfile`，另外開一個宿主機終端並保持視窗開啟：

```bash
cd ~/nxbt
vagrant ssh -- -N -L 8766:127.0.0.1:8766
```

Windows PowerShell 請將第一行改為你的 NXBT 資料夾，例如：

```powershell
cd C:\Users\你的名字\nxbt
vagrant ssh -- -N -L 8766:127.0.0.1:8766
```

使用臨時方式時，網頁同樣填入 `127.0.0.1` 與 `8766`。關閉 SSH 本機轉送終端後，網頁會失去 NXBT 連線。兩種方式都只把 bridge 開放給目前電腦，避免將 token 或控制介面公開到區域網路。

如果再次啟動 bridge 時看到：

```text
OSError: [Errno 98] Address already in use
```

代表 VM 內已經有另一份 bridge 使用 `8766`。通常不需要再啟動一次，直接保持原本的 bridge 終端開啟並回到網頁連線即可。可在 VM 內確認：

```bash
sudo ss -ltnp | grep 8766
```

只有確定要重啟 bridge 時，才先在原本執行 bridge 的終端按 `Ctrl+C`，再重新執行啟動指令。重啟後 token 可能改變，網頁也必須重新輸入。

不要使用 `Ctrl+Z` 關閉 bridge。`Ctrl+Z` 只會暫停前景程序，可能留下仍占用 `8766` 但無法正常回應的 bridge。如果已經誤按 `Ctrl+Z`，請在同一個 VM 終端執行：

```bash
fg
```

接著按 `Ctrl+C` 正常停止。如果原本終端已關閉，可在 VM 內找出並終止舊程序：

```bash
sudo ss -ltnp | grep 8766
sudo kill 顯示的_python3_PID
```

確認 `sudo ss -ltnp | grep 8766` 不再顯示監聽後，再重新啟動 bridge。

### 接到網頁

1. Windows 或 macOS 完成上一段的 Vagrant 連接埠轉送或 SSH 本機轉送後，輸入 `127.0.0.1`。Linux 原生執行也可使用 `127.0.0.1`。只有自行建立 host-only 網路時，才直接輸入 VM 私人網路 IPv4。
2. 在網頁「開始設定」選擇 `NXBT 藍牙控制` 或 `混合輸出`。
3. 按 `連接 NXBT`，輸入本機轉送位址 `127.0.0.1`、預設連接埠 `8766`、以及啟動 bridge 時設定的 token。
4. 第一次配對時，在 Switch 開啟控制器配對畫面。若第一次配對失敗，到「進階功能」關閉 `NXBT 自動重新連線` 後再試一次。
5. 測試純 NXBT 軟體急停後，bridge 會移除模擬手把。這是預期結果；請再按一次 `連接 NXBT`。

按下 `連接 NXBT` 後，網頁會先顯示「正在等待 Switch 配對」，並每秒檢查一次 bridge 狀態。保持 Switch 控制器配對畫面開啟即可，不需要反覆按連線。只有 bridge 回報控制器已準備完成後，網頁才會顯示 NXBT 已連線。

### 在 Switch 2 測試 NXBT 按鍵與搖桿

NXBT 只模擬 Switch Pro Controller，因此選擇 NXBT 或混合輸出時，程式會自動鎖定為 `Switch 2 Pro 手把`，不提供 Joy-Con 2 握把選項。要使用 Joy-Con 2 握把，必須改用純機械治具輸出。

NXBT 連線且軟體急停測試完成後，到網頁的「完整手把校正」按 `測試 NXBT 按鍵與搖桿`。這個面板只在訓練與正式遊玩都停止時允許送出測試動作，每個動作結束後都會回中立；未驗證急停時，所有非中立測試都會被阻止。

這個測試面板使用最新版 bridge 的 `/test-input`，並呼叫 NXBT 官方高階 `press_buttons`／`tilt_stick` API。若網頁提示 bridge 版本太舊，請重新執行上方「複製 bridge 到 NXBT VM」的兩個 `cp` 指令，同時覆蓋 `tools/nxbt_bridge.py` 與 `tools/nxbt_bridge_server.py`，再用 `Ctrl+C` 停止舊 bridge 並重新啟動。只更新 localhost 網頁而沒有更新 VM 內這兩個檔案，方向鍵、`+/-`、左右搖桿按下或搖桿方向仍可能無法正確測試。

按鍵測試前，先在 Switch 2 開啟：`HOME 選單 → 主機設定 → 控制器與周邊設備 → 測試輸入裝置 → 測試控制器按鍵`。勾選網頁確認框後，再逐一測試方向鍵、A/B/X/Y、L/R/ZL/ZR、`+`、`-` 與左右搖桿按下。Nintendo 官方說明指出 HOME、截圖、C、POWER、音量與 SYNC 不會出現在這個測試；本程式也不允許從測試面板送出 HOME、截圖、C、GL 或 GR。結束官方按鍵測試時，可使用面板的 `按住 B，結束官方按鍵測試`。[Nintendo Switch 2 按鍵測試說明](https://en-americas-support.nintendo.com/app/answers/detail/a_id/68213)

搖桿測試前，先在 Switch 2 開啟：`HOME 選單 → 主機設定 → 控制器與周邊設備 → 校正控制搖桿`。依 Nintendo 官方流程，必須先把要測試的搖桿向任一方向推到底並保持幾秒，主機才會選中該搖桿。因此網頁會強制先按 `先選擇左搖桿` 或 `先選擇右搖桿`，將該搖桿向右推到底約 1.2 秒；完成後才會開放上下左右測試。若 Switch 2 尚未選中搖桿，再按一次選擇按鈕，然後依主機畫面提示檢查。[Nintendo Switch 2 搖桿校正說明](https://en-americas-support.nintendo.com/app/answers/detail/a_id/68192/)

token 只保留在 localhost 後端記憶體，不會寫入專案、快照、匯出檔或日志。只在可信任的私人網路開放 bridge，並確認 VM 防火牆允許 TCP `8766`。

HTTP VM bridge 提供 `/health`、`/connect`、`/disconnect`、`/emergency-stop`、`/action` 與 `/test-input`；localhost 後端以 `/nxbt/test-input` 執行白名單測試。所有 bridge 路徑都需要 Bearer token。本機網頁後端只接受 `localhost` 或私人 IPv4，避免把 token 送到公開位址。

進階診斷時可以在宿主機的 `nxbt` 資料夾執行 `vagrant ssh -c "hostname -I"` 查詢 VM 網路位址。但 VirtualBox 預設顯示的 `10.0.2.15` 通常是 NAT 位址，Windows 與 macOS 一般流程不要將它填入網頁。

賽車 PPO 自動控制只允許 `A/B/X/Y/L/R/ZL/ZR` 與雙搖桿。選單導航另外允許方向鍵與 `+`、`-`，但每步最多 250 ms，且只可在引擎待命、鏡頭辨識、控制器連線與軟體急停驗證都通過時送出。`HOME` 與截圖鍵在 localhost 後端與 VM bridge 都永久拒絕。

## 尚未完成的實機項目

- 重大事件目前保存 JPEG 畫格；事件前後短片需要補瀏覽器環形錄影緩衝。
- `遊戲暫停鍵`、短片前後秒數、旁路更新間隔與可展開監控詳細側欄目前在進階功能標示為預留。
- 回滾與備用 AI 切換目前由使用者按鈕確認，不會自動切換模型。
- 機械治具只有通用 Serial JSON Lines adapter 與模擬器；選定 ESP32、Arduino 或其他開發板後，仍需補對應馬達韌體並做實機行程驗證。
