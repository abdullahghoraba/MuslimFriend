# Creates the Google Play *upload* key and android/keystore.properties.
# Run it yourself:  powershell -ExecutionPolicy Bypass -File scripts\create-upload-key.ps1
#
# You choose the password; it is written only to android/keystore.properties (git-ignored).
# BACK UP both files somewhere safe (password manager + offline copy). With Play App Signing,
# a lost upload key can be reset through Play Console support, but it takes time.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root 'android'
$keystore = Join-Path $android 'upload-keystore.jks'
$props = Join-Path $android 'keystore.properties'

if (Test-Path $keystore) {
    Write-Host "An upload key already exists at $keystore. Delete it first if you really want a new one." -ForegroundColor Yellow
    exit 1
}

# Prefer the JDK 21 that ships with Android tooling, then JAVA_HOME, then PATH.
$candidates = @('C:\Program Files\Android\openjdk\jdk-21.0.8\bin\keytool.exe')
if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
$keytool = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $keytool) { $keytool = (Get-Command keytool -ErrorAction Stop).Source }

$secure = Read-Host 'Choose an upload-key password (min 8 chars)' -AsSecureString
$confirm = Read-Host 'Repeat the password' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$plain2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm))
if ($plain -ne $plain2) { Write-Host 'Passwords do not match.' -ForegroundColor Red; exit 1 }
if ($plain.Length -lt 8) { Write-Host 'Password too short.' -ForegroundColor Red; exit 1 }

$name = Read-Host 'Your name or organisation (shown in the certificate)'
if (-not $name) { $name = 'Muslim Athkar' }

& $keytool -genkeypair -v `
    -keystore $keystore -storetype JKS `
    -alias upload -keyalg RSA -keysize 4096 -validity 10000 `
    -storepass $plain -keypass $plain `
    -dname "CN=$name, O=$name"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

@"
storeFile=upload-keystore.jks
storePassword=$plain
keyAlias=upload
keyPassword=$plain
"@ | Set-Content -Path $props -Encoding ascii

Write-Host ''
Write-Host "Created $keystore and $props" -ForegroundColor Green
Write-Host 'Back up both files now. Then run: npm run release' -ForegroundColor Green
