<#
.SYNOPSIS
Збирає та перевіряє NSIS-інсталятор EasyWAR на Windows.

.DESCRIPTION
Debug-режим є лише технічною перевіркою. Release із
-RequireProductionSignature додатково вимагає чистий Git, валідний
Authenticode-підпис, Code Signing EKU, timestamp і довірений certificate chain.
Сертифікати, паролі й signing-конфігурації не записуються до репозиторію.

.PARAMETER TauriConfig
Необов'язковий локальний Tauri JSON/JSON5/TOML overlay із production signing
налаштуваннями. Наприклад:
powershell -File script/build_windows_installer.ps1 -Configuration Release `
  -RequireProductionSignature -TauriConfig C:\secure\easywar-signing.json
#>
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [switch]$RequireProductionSignature,

    [string]$TauriConfig
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw "Збірка NSIS-інсталятора EasyWAR дозволена лише на Windows."
}
if ($RequireProductionSignature -and $Configuration -ne "Release") {
    throw "Production-підпис дозволено перевіряти лише для Release-збірки."
}

function Test-PeHeader {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $firstByte = $stream.ReadByte()
        $secondByte = $stream.ReadByte()
    }
    finally {
        $stream.Dispose()
    }
    if ($firstByte -ne 0x4D -or $secondByte -ne 0x5A) {
        throw "$Label не має PE-заголовка MZ."
    }
}

function Get-CodeSigningEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][bool]$RequireProduction
    )

    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    $hasCodeSigningEku = $false
    if ($null -ne $signature.SignerCertificate) {
        foreach ($extension in $signature.SignerCertificate.Extensions) {
            if ($extension -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
                foreach ($usage in $extension.EnhancedKeyUsages) {
                    if ($usage.Value -eq "1.3.6.1.5.5.7.3.3") {
                        $hasCodeSigningEku = $true
                    }
                }
            }
        }
    }

    if ($RequireProduction) {
        if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
            throw "Authenticode-підпис '$Label' невалідний: $($signature.Status)."
        }
        if ($null -eq $signature.SignerCertificate -or -not $hasCodeSigningEku) {
            throw "Сертифікат '$Label' не має Code Signing EKU."
        }
        if ($null -eq $signature.TimeStamperCertificate) {
            throw "Production-підпис '$Label' не має перевірюваного timestamp."
        }

        $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
        try {
            $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::Online
            $chain.ChainPolicy.RevocationFlag = [System.Security.Cryptography.X509Certificates.X509RevocationFlag]::EntireChain
            $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(30)
            if (-not $chain.Build($signature.SignerCertificate)) {
                $chainErrors = @($chain.ChainStatus | ForEach-Object { $_.Status.ToString() }) -join ", "
                throw "Ланцюжок довіри '$Label' не пройшов перевірку: $chainErrors."
            }
        }
        finally {
            $chain.Dispose()
        }
    }
    elseif ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        Write-Warning "$Label не має валідного production-підпису й не є релізним артефактом."
    }

    return [pscustomobject]@{
        Status = $signature.Status.ToString()
        CodeSigningEku = $hasCodeSigningEku
        TimestampPresent = $null -ne $signature.TimeStamperCertificate
        SignerThumbprint = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Thumbprint }
        TimestampThumbprint = if ($null -eq $signature.TimeStamperCertificate) { $null } else { $signature.TimeStamperCertificate.Thumbprint }
    }
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJsonPath = Join-Path $projectRoot "package.json"
$tauriConfigPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$cargoTomlPath = Join-Path $projectRoot "src-tauri\Cargo.toml"
$tauriCommand = Join-Path $projectRoot "node_modules\.bin\tauri.cmd"

foreach ($requiredPath in @($packageJsonPath, $tauriConfigPath, $cargoTomlPath, $tauriCommand)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Не знайдено обов'язковий файл: $requiredPath"
    }
}

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json
$cargoVersionMatch = Select-String -LiteralPath $cargoTomlPath -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1
$cargoNameMatch = Select-String -LiteralPath $cargoTomlPath -Pattern '^name\s*=\s*"([^"]+)"' | Select-Object -First 1
if ($null -eq $cargoVersionMatch -or $null -eq $cargoNameMatch) {
    throw "Не вдалося прочитати назву або версію пакета з src-tauri/Cargo.toml."
}
$cargoVersion = $cargoVersionMatch.Matches[0].Groups[1].Value
$cargoName = $cargoNameMatch.Matches[0].Groups[1].Value
$versions = @([string]$packageJson.version, [string]$tauriConfig.version, [string]$cargoVersion)
if (($versions | Select-Object -Unique).Count -ne 1) {
    throw "Версії package.json, tauri.conf.json і Cargo.toml не збігаються: $($versions -join ', ')."
}
$version = $versions[0]

if ($RequireProductionSignature) {
    $dirtyPaths = @(& git -C $projectRoot status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
        throw "Не вдалося перевірити стан Git перед production-збіркою."
    }
    if ($dirtyPaths.Count -ne 0) {
        throw "Production-збірка заборонена з незбереженими або неврахованими файлами."
    }
}

$tauriArguments = @("build", "--bundles", "nsis", "--ci")
if ($Configuration -eq "Debug") {
    $tauriArguments += "--debug"
}
if (-not [string]::IsNullOrWhiteSpace($TauriConfig)) {
    $resolvedConfig = (Resolve-Path -LiteralPath $TauriConfig).Path
    $tauriArguments += @("--config", $resolvedConfig)
}

Push-Location $projectRoot
try {
    & $tauriCommand @tauriArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri не зібрав NSIS-інсталятор (код $LASTEXITCODE)."
    }
}
finally {
    Pop-Location
}

$profileDirectory = if ($Configuration -eq "Debug") { "debug" } else { "release" }
$bundleDirectory = Join-Path $projectRoot "src-tauri\target\$profileDirectory\bundle\nsis"
if (-not (Test-Path -LiteralPath $bundleDirectory -PathType Container)) {
    throw "Не знайдено каталог результату NSIS: $bundleDirectory"
}
$installers = @(Get-ChildItem -LiteralPath $bundleDirectory -File -Filter "*.exe")
if ($installers.Count -ne 1) {
    throw "Очікувався рівно один NSIS .exe, знайдено: $($installers.Count)."
}
$installer = $installers[0]
if ($installer.Length -le 0) {
    throw "NSIS-інсталятор порожній."
}
$applicationPath = Join-Path $projectRoot "src-tauri\target\$profileDirectory\$cargoName.exe"
if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) {
    throw "Не знайдено зібраний Windows executable: $applicationPath"
}
$application = Get-Item -LiteralPath $applicationPath
if ($application.Length -le 0) {
    throw "Windows executable порожній."
}

Test-PeHeader -Path $application.FullName -Label "Windows executable"
Test-PeHeader -Path $installer.FullName -Label "NSIS-інсталятор"
$applicationSigning = Get-CodeSigningEvidence -Path $application.FullName -Label "Windows executable" -RequireProduction $RequireProductionSignature.IsPresent
$installerSigning = Get-CodeSigningEvidence -Path $installer.FullName -Label "NSIS-інсталятор" -RequireProduction $RequireProductionSignature.IsPresent
$applicationHash = Get-FileHash -LiteralPath $application.FullName -Algorithm SHA256
$installerHash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
$commitSha = (& git -C $projectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commitSha)) {
    throw "Не вдалося визначити commit SHA для маніфесту інсталятора."
}
$evidencePath = Join-Path (Split-Path -Parent $bundleDirectory) "windows-installer-evidence.json"
$evidence = [ordered]@{
    schemaVersion = 1
    productName = [string]$tauriConfig.productName
    version = $version
    configuration = $Configuration.ToLowerInvariant()
    architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    commitSha = $commitSha
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    executable = [ordered]@{
        name = $application.Name
        bytes = $application.Length
        sha256 = $applicationHash.Hash.ToLowerInvariant()
        signatureStatus = $applicationSigning.Status
        codeSigningEku = $applicationSigning.CodeSigningEku
        timestampPresent = $applicationSigning.TimestampPresent
        signerThumbprint = $applicationSigning.SignerThumbprint
        timestampThumbprint = $applicationSigning.TimestampThumbprint
    }
    installer = [ordered]@{
        name = $installer.Name
        bytes = $installer.Length
        sha256 = $installerHash.Hash.ToLowerInvariant()
        signatureStatus = $installerSigning.Status
        codeSigningEku = $installerSigning.CodeSigningEku
        timestampPresent = $installerSigning.TimestampPresent
        signerThumbprint = $installerSigning.SignerThumbprint
        timestampThumbprint = $installerSigning.TimestampThumbprint
    }
}
$evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding UTF8

Write-Host "NSIS-інсталятор перевірено: $($installer.FullName)"
Write-Host "Executable SHA-256: $($applicationHash.Hash.ToLowerInvariant())"
Write-Host "Installer SHA-256: $($installerHash.Hash.ToLowerInvariant())"
Write-Host "Executable Authenticode: $($applicationSigning.Status)"
Write-Host "Installer Authenticode: $($installerSigning.Status)"
Write-Host "Маніфест: $evidencePath"
