# Boarder CLI installer (Windows):  irm __SERVER__/install.ps1 | iex
# Puts the CLI in %LOCALAPPDATA%\boarder\cli and boarder.cmd in %USERPROFILE%\.local\bin (your user PATH is not changed), after checking the bundle's SHA-256.
# Uses Node 20+ if this machine has it; otherwise downloads Node 22 (checked against nodejs.org's SHASUMS256) next to the CLI.
# Signing in comes after: `boarder setup` asks you to approve this machine in the browser.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $Server = '__SERVER__'; $Version = '__VERSION__'; $Sha256 = '__SHA256__'
  $Share = Join-Path $env:LOCALAPPDATA 'boarder'
  $Bin = Join-Path $env:USERPROFILE '.local\bin'
  $Tmp = Join-Path ([IO.Path]::GetTempPath()) ('boarder-' + [Guid]::NewGuid().ToString('N'))
  # Folders this installer creates, so `boarder uninstall` can remove them again when empty (no trace left)
  $Made = @((Join-Path $env:USERPROFILE '.local'), $Bin, $Share) | Where-Object { -not (Test-Path $_) }
  New-Item -ItemType Directory -Force -Path $Tmp, $Share, $Bin | Out-Null
  if ($Made) { Add-Content -Encoding UTF8 -Path (Join-Path $Share 'created-dirs') -Value $Made }
  try {
    # Node's major version, parsed here: PowerShell 5.1 drops the inner quotes of a JavaScript argument, so node gets no expression to run
    function Major($exe) { try { $v = & $exe -p 'process.versions.node' 2>$null; return [int](($v -split '\.')[0]) } catch { return 0 } }
    $Node = $null; $NodeCmd = $null
    $sys = Get-Command node -ErrorAction SilentlyContinue
    if ($sys -and (Major $sys.Source) -ge 20) { $Node = $sys.Source; $NodeCmd = 'node' }
    $own = Join-Path $Share 'node\node.exe'
    # A Node this script downloaded before is reused: a running boarder MCP server keeps node.exe locked, so it cannot be replaced
    if (-not $Node -and (Test-Path $own) -and (Major $own) -ge 20) { $Node = $own; $NodeCmd = '"%LOCALAPPDATA%\boarder\node\node.exe"' }
    if (-not $Node) {
      $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
      Write-Host "Node 20+ not found - downloading Node 22 for win-$arch..."
      $D = 'https://nodejs.org/dist/latest-v22.x'
      $sums = (Invoke-WebRequest -UseBasicParsing "$D/SHASUMS256.txt").Content -split "`n"
      $line = $sums | Where-Object { $_ -match "  (node-v22[0-9.]*-win-$arch\.zip)$" } | Select-Object -First 1
      if (-not $line) { throw "no Node 22 build for win-$arch" }
      $want, $f = $line.Trim() -split '\s+', 2
      Invoke-WebRequest -UseBasicParsing "$D/$f" -OutFile (Join-Path $Tmp $f)
      if ((Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $f)).Hash.ToLower() -ne $want) { throw 'Node download checksum mismatch' }
      Expand-Archive (Join-Path $Tmp $f) -DestinationPath (Join-Path $Tmp 'node')
      $nd = Join-Path $Share 'node'; if (Test-Path $nd) { Remove-Item -Recurse -Force $nd }
      Move-Item (Get-ChildItem (Join-Path $Tmp 'node') | Select-Object -First 1).FullName $nd
      $Node = Join-Path $nd 'node.exe'; $NodeCmd = '"%LOCALAPPDATA%\boarder\node\node.exe"'
    }

    Write-Host "Downloading Boarder CLI $Version..."
    $tgz = Join-Path $Tmp 'cli.tgz'
    Invoke-WebRequest -UseBasicParsing "$Server/cli/boarder-cli-$Version.tgz" -OutFile $tgz
    $got = (Get-FileHash -Algorithm SHA256 $tgz).Hash.ToLower()
    if ($got -ne $Sha256) { throw "checksum mismatch (expected $Sha256, got $got) - nothing was installed" }
    $x = Join-Path $Tmp 'x'; New-Item -ItemType Directory -Force -Path $x | Out-Null
    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'; if (-not (Test-Path $tar)) { $tar = 'tar' }   # Windows' own bsdtar: Git's GNU tar reads C:\ as a remote host
    & $tar -xzf $tgz -C $x; if ($LASTEXITCODE) { throw 'could not unpack the CLI (needs tar, Windows 10 1803 or newer)' }
    $cli = Join-Path $Share 'cli'; if (Test-Path $cli) { Remove-Item -Recurse -Force $cli }
    Move-Item (Join-Path $x 'package') $cli

    $cmd = Join-Path $Bin 'boarder.cmd'
    # Paths through %LOCALAPPDATA%, so the file stays ASCII even when the Windows user name is Korean
    Set-Content -Encoding ASCII -Path $cmd -Value "@$NodeCmd `"%LOCALAPPDATA%\boarder\cli\bin\boarder.mjs`" %*"
    & $cmd --version | Out-Null; if ($LASTEXITCODE) { throw "installed, but $cmd --version failed" }
    Write-Host "Installed boarder $Version ($cmd, SHA-256 checked)."

    # The user PATH is never changed: installing Boarder must not change a person's setup. This terminal only.
    if (-not (([Environment]::GetEnvironmentVariable('Path', 'User') -split ';') -contains $Bin)) { Write-Host "$Bin is not on your PATH - run it as $cmd (your settings were not changed)." }
    if (-not (($env:Path -split ';') -contains $Bin)) { $env:Path = "$Bin;$env:Path" }
    Write-Host ''
    Write-Host 'Next: boarder setup   (signs this machine in to your board - approve it in the browser)'
  } finally {
    Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
  }
}
