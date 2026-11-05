param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows.' }

# CheckOnly never installs features, changes services, or modifies the firewall.
if (-not $CheckOnly) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run PowerShell as Administrator, or use -CheckOnly to inspect without changes.'
    }
    $capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server*'
    if ($capability.State -ne 'Installed') { Add-WindowsCapability -Online -Name $capability.Name | Out-Null }
    Set-Service -Name sshd -StartupType Automatic
    Start-Service -Name sshd
    if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    }
}

$service = Get-Service -Name sshd -ErrorAction SilentlyContinue
$running = $null -ne $service -and $service.Status -eq 'Running'
$ports = @()
if ($running) {
    $processIds = @(Get-CimInstance Win32_Process -Filter "Name='sshd.exe'" | ForEach-Object { $_.ProcessId })
    $ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -in $processIds } |
        Select-Object -ExpandProperty LocalPort -Unique | Sort-Object)
}
$username = $env:USERNAME
if ($env:USERDOMAIN) { $username = "$($env:USERDOMAIN)\$username" }
$username = $username.ToLowerInvariant()
$addresses = @(Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' } |
    ForEach-Object { $_.IPv4Address } | ForEach-Object { $_.IPAddress } |
    Where-Object { $_ -and $_ -ne '127.0.0.1' -and $_ -notlike '169.254.*' } | Sort-Object -Unique)
$connections = @(foreach ($address in $addresses) {
    foreach ($port in $ports) {
        [pscustomobject]@{host=$address; port=[int]$port; username=$username; ssh=('ssh "{0}@{1}" -p {2}' -f $username,$address,$port)}
    }
})
[pscustomobject]@{checkOnly=[bool]$CheckOnly; sshRunning=[bool]$running; connections=$connections} | ConvertTo-Json -Depth 5
