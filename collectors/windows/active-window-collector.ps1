param(
    [string]$OutputPath = "",
    [string]$IngestUrl = "",
    [int]$PollIntervalMs = 1000
)

if (-not $OutputPath -and -not $IngestUrl) {
    $OutputPath = ".\windows-active-window-events.ndjson"
}

if ($OutputPath) {
    $outputDirectory = Split-Path -Parent $OutputPath
    if ($outputDirectory) {
        New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WhatIveDoneWin32
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

function Get-ActiveWindowEvent {
    $windowHandle = [WhatIveDoneWin32]::GetForegroundWindow()
    if ($windowHandle -eq [IntPtr]::Zero) {
        return $null
    }

    $windowTextBuffer = New-Object System.Text.StringBuilder 1024
    [void][WhatIveDoneWin32]::GetWindowText($windowHandle, $windowTextBuffer, $windowTextBuffer.Capacity)

    $processId = 0
    [void][WhatIveDoneWin32]::GetWindowThreadProcessId($windowHandle, [ref]$processId)

    if (-not $processId) {
        return $null
    }

    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process) {
        return $null
    }

    return @{
        source = "desktop"
        sourceEventType = "app.switch"
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        application = $process.ProcessName.ToLowerInvariant()
        windowTitle = $windowTextBuffer.ToString()
        action = "switch"
        metadata = @{
            processId = $processId
            collector = "windows-active-window"
            platform = "windows"
        }
    }
}

function Publish-Event {
    param(
        [hashtable]$Event
    )

    if (-not $Event) {
        return
    }

    if ($OutputPath) {
        $Event | ConvertTo-Json -Compress | Add-Content -LiteralPath $OutputPath
    }

    if ($IngestUrl) {
        $payload = @{
            events = @($Event)
        } | ConvertTo-Json -Depth 6 -Compress

        try {
            Invoke-RestMethod -Uri $IngestUrl -Method Post -ContentType "application/json" -Body $payload | Out-Null
        } catch {
            Write-Warning "Failed to POST event to $IngestUrl. $_"
        }
    }
}

$lastFingerprint = ""

Write-Host "What I've Done Windows collector started."
Write-Host "Poll interval: $PollIntervalMs ms"
if ($OutputPath) {
    Write-Host "NDJSON output: $OutputPath"
}
if ($IngestUrl) {
    Write-Host "Ingest URL: $IngestUrl"
}

while ($true) {
    $event = Get-ActiveWindowEvent
    if ($event) {
        $fingerprint = "$($event.application)|$($event.windowTitle)"
        if ($fingerprint -ne $lastFingerprint) {
            Publish-Event -Event $event
            $lastFingerprint = $fingerprint
        }
    }

    Start-Sleep -Milliseconds $PollIntervalMs
}
