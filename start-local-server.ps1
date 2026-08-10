param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$port = 8765
$url = "http://localhost:$port"
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

function Test-LocalServer {
  try {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      $content = & curl.exe --max-time 1 -fsS "$url/api/health"
      return $LASTEXITCODE -eq 0 -and $content -match '"switch2-ai-local"'
    }
    $response = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 1
    return $response.service -eq "switch2-ai-local"
  } catch {
    return $false
  }
}

if (-not (Test-LocalServer)) {
  $pythonPrefix = ""
  if (Test-Path -LiteralPath $bundledPython) {
    $python = $bundledPython
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $python = (Get-Command python).Source
  } elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $python = (Get-Command py).Source
    $pythonPrefix = "-3 "
  } else {
    throw "Python 3 was not found. Install Python 3 and run this launcher again."
  }

  $serverScript = Join-Path $workspace "server\app.py"
  $quotedServerScript = '"' + $serverScript + '"'
  $arguments = "${pythonPrefix}${quotedServerScript} --host 127.0.0.1 --port $port"
  $stdoutLog = Join-Path $workspace ".local-server.out.log"
  $stderrLog = Join-Path $workspace ".local-server.err.log"

  Start-Process -FilePath $python `
    -ArgumentList $arguments `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden

  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-LocalServer) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    throw "Failed to start the local server. Check .local-server.err.log."
  }
}

if (-not $NoBrowser) {
  Start-Process $url
}

Write-Host "Local app server is ready:"
Write-Host $url
