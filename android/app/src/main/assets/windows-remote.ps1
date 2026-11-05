# Windows PowerShell 5.1 compatible. Invoked over SSH stdin, never a user profile.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$asbUtf8 = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = $asbUtf8

function Asb-Home($tool) {
    if ($tool -eq 'codex' -and $env:CODEX_HOME) { return $env:CODEX_HOME }
    if ($tool -eq 'claude' -and $env:CLAUDE_CONFIG_DIR) { return $env:CLAUDE_CONFIG_DIR }
    return Join-Path $env:USERPROFILE ('.' + $tool)
}

function Asb-Path {
    # An SSH session may predate npm/Claude installation. Do not edit system PATH.
    $env:PATH = (Join-Path $env:USERPROFILE '.local\bin') + ';' +
        (Join-Path $env:APPDATA 'npm') + ';' + $env:PATH
}

function Asb-Prefix($path) {
    $stream = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite, Delete')
    try {
        $bytes = New-Object byte[] 8192
        $count = $stream.Read($bytes, 0, $bytes.Length)
        return $asbUtf8.GetString($bytes, 0, $count).Split([char]10)[0].Trim([char]0xfeff)
    } finally { $stream.Dispose() }
}

function Asb-Recent($path, $tool) {
    # Scan backwards up to 8 MB, skipping large tool records; emit only the
    # latest user/assistant text and Codex lifecycle event, in original order.
    $stream = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite, Delete')
    $found = @{}
    $records = New-Object 'System.Collections.Generic.List[string]'
    try {
        $position = $stream.Length
        $remaining = 8 * 1024 * 1024
        $fragment = New-Object byte[] 0
        while ($position -gt 0 -and $remaining -gt 0) {
            $size = [int][Math]::Min(65536, [Math]::Min($position, $remaining))
            $position -= $size; $remaining -= $size
            [void]$stream.Seek($position, 'Begin')
            $bytes = New-Object byte[] $size
            $offset = 0
            while ($offset -lt $size) {
                $read = $stream.Read($bytes, $offset, $size - $offset)
                if ($read -eq 0) { break }; $offset += $read
            }
            $joined = New-Object byte[] ($offset + $fragment.Length)
            [Array]::Copy($bytes, 0, $joined, 0, $offset)
            [Array]::Copy($fragment, 0, $joined, $offset, $fragment.Length)
            $first = [Array]::IndexOf($joined, [byte]10)
            if ($position -gt 0 -and $first -lt 0) { $fragment = $joined; continue }
            $begin = 0
            if ($position -gt 0) {
                $fragment = New-Object byte[] $first
                [Array]::Copy($joined, $fragment, $first)
                $begin = $first + 1
            }
            $lines = $asbUtf8.GetString($joined, $begin, $joined.Length - $begin).Split([char]10)
            for ($i = $lines.Length - 1; $i -ge 0; $i--) {
                try {
                    $entry = $lines[$i] | ConvertFrom-Json
                    $role = ''; $text = ''
                    if ($tool -eq 'codex') {
                        $p = $entry.payload
                        if ($entry.type -eq 'event_msg' -and $p.type -in @('task_started','task_complete','task_failed','task_cancelled') -and !$found.state) {
                            $records.Add((@{type='event_msg';payload=@{type=$p.type}} | ConvertTo-Json -Compress -Depth 8))
                            $found.state = $true
                        }
                        if ($entry.type -eq 'response_item' -and $p.type -eq 'message') {
                            $role = $p.role
                            $text = (@($p.content | Where-Object { $_.type -in @('input_text','output_text') } | ForEach-Object { $_.text }) -join "`n")
                        } elseif ($entry.type -eq 'event_msg' -and $p.type -in @('user_message','agent_message')) {
                            $role = if ($p.type -eq 'user_message') { 'user' } else { 'assistant' }
                            $text = [string]$p.message
                        }
                    } else {
                        $role = $entry.message.role
                        $content = $entry.message.content
                        $text = if ($content -is [string]) { $content } else {
                            @($content | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join "`n"
                        }
                    }
                    if ($role -in @('user','assistant') -and $text.Trim() -and !$found[$role] -and !($role -eq 'user' -and $text.StartsWith('<'))) {
                        $text = $text.Substring(0, [Math]::Min(2400, $text.Length))
                        $compact = if ($tool -eq 'codex') {
                            @{type='response_item';payload=@{type='message';role=$role;content=@(@{type= $(if ($role -eq 'user') {'input_text'} else {'output_text'});text=$text})}}
                        } else { @{type=$role;message=@{role=$role;content=$text}} }
                        $records.Add(($compact | ConvertTo-Json -Compress -Depth 8)); $found[$role] = $true
                    }
                    if ($found.user -and $found.assistant -and ($tool -eq 'claude' -or $found.state)) { break }
                } catch { continue } # Corrupt/partial lines must not hide other sessions.
            }
            if ($found.user -and $found.assistant -and ($tool -eq 'claude' -or $found.state)) { break }
        }
    } finally { $stream.Dispose() }
    $records.Reverse()
    return $records -join "`n"
}

function Asb-Discover($onlyAgent, $onlyId) {
    $result = New-Object 'System.Collections.Generic.List[object]'
    $uuid = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    if (!$onlyAgent -or $onlyAgent -eq 'codex') {
        $homePath = Asb-Home 'codex'
        $titles = @{}
        $index = Join-Path $homePath 'session_index.jsonl'
        if (Test-Path -LiteralPath $index) {
            Get-Content -LiteralPath $index -Encoding UTF8 -Tail 1000 | ForEach-Object {
                try { $r = $_ | ConvertFrom-Json; if ($r.id -match $uuid) { $titles[$r.id] = $r.thread_name } } catch {}
            }
        }
        $files = @(Get-ChildItem -LiteralPath (Join-Path $homePath 'sessions') -Filter '*.jsonl' -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { !$onlyId -or $_.Name.EndsWith($onlyId + '.jsonl') } |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 100)
        foreach ($file in $files) {
            if ($result.Count -ge 30) { break }
            try {
                $header = (Asb-Prefix $file.FullName) | ConvertFrom-Json
                $meta = $header.payload
                $id = [string]$meta.id
                if ($header.type -ne 'session_meta' -or $id -notmatch $uuid -or !$meta.cwd) { continue }
                if ($meta.thread_source -eq 'subagent' -or $meta.parent_thread_id -or $meta.source.subagent) { continue }
                $result.Add(@{agentType='codex';sessionId=$id;workspace=[string]$meta.cwd;title=[string]$titles[$id];
                    transcriptPath=$file.FullName;transcript=(Asb-Recent $file.FullName 'codex');status='';pid=0})
            } catch { continue }
        }
    }
    if (!$onlyAgent -or $onlyAgent -eq 'claude-code') {
        $homePath = Asb-Home 'claude'
        # Session metadata ties a transcript to a live CLI, rather than matching
        # arbitrary process command lines or returning every historical chat.
        $live = @{}
        foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction Stop)) { $live[[int]$p.ProcessId] = $p }
        $projects = Join-Path $homePath 'projects'
        $files = @(Get-ChildItem -LiteralPath (Join-Path $homePath 'sessions') -Filter '*.json' -File -ErrorAction SilentlyContinue |
            Where-Object { $candidatePid = 0; [int]::TryParse($_.BaseName, [ref]$candidatePid) -and $live[$candidatePid] } |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 30)
        foreach ($file in $files) {
            try {
                $meta = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
                $pidValue = 0
                if (![int]::TryParse($file.BaseName, [ref]$pidValue) -or !$live[$pidValue]) { continue }
                $id = [string]$meta.sessionId
                if ($id -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' -or !$meta.cwd -or ($onlyId -and $id -ne $onlyId)) { continue }
                $process = $live[$pidValue]
                if (($process.Name + ' ' + $process.CommandLine) -notmatch '(?i)claude') { continue }
                $transcript = Get-ChildItem -LiteralPath $projects -Filter ($id + '.jsonl') -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
                $result.Add(@{agentType='claude-code';sessionId=$id;workspace=[string]$meta.cwd;title='';
                    transcriptPath= $(if ($transcript) {$transcript.FullName} else {''});
                    transcript= $(if ($transcript) {Asb-Recent $transcript.FullName 'claude'} else {''});status=[string]$meta.status;pid=$pidValue})
            } catch { continue }
        }
    }
    return ConvertTo-Json -InputObject @($result.ToArray()) -Compress -Depth 10
}

function Asb-NativeArgument([string]$value) {
    # Windows CommandLineToArgvW / CRT rules; no cmd.exe and no shell evaluation.
    '"' + [regex]::Replace([regex]::Replace($value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Asb-Executable($agent) {
    $name = if ($agent -eq 'codex') {'codex'} elseif ($agent -eq 'claude-code') {'claude'} else { throw 'Unsupported Windows agent' }
    $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$command) { throw ($name + ' was not found. Install it for the SSH user and reconnect.') }
    if ([IO.Path]::GetExtension($command.Source) -eq '.exe') { return @{file=$command.Source;prefix=@()} }
    # npm's .cmd/.ps1 shim would reparse quotes and metacharacters. Invoke its
    # JavaScript entry point directly with node instead.
    $package = if ($agent -eq 'codex') {'@openai\codex\bin\codex.js'} else {'@anthropic-ai\claude-code\cli.js'}
    $scriptPath = Join-Path (Split-Path $command.Source) ('node_modules\' + $package)
    $node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$node -or !(Test-Path -LiteralPath $scriptPath)) { throw 'Unsupported CLI shim. Use the official native or npm installation for this SSH user.' }
    return @{file=$node.Source;prefix=@($scriptPath)}
}

function Asb-RunCli($executable, $arguments, $workspace, $log, $err) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $executable.file
    $info.Arguments = (@(@($executable.prefix) + @($arguments) | ForEach-Object { Asb-NativeArgument $_ }) -join ' ')
    $info.WorkingDirectory = $workspace
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    $outStream = [IO.File]::Open($log, 'Create', 'Write', 'ReadWrite')
    $errStream = [IO.File]::Open($err, 'Create', 'Write', 'ReadWrite')
    try {
        if (!$process.Start()) { throw 'Agent failed to start' }
        $outTask = $process.StandardOutput.BaseStream.CopyToAsync($outStream)
        $errTask = $process.StandardError.BaseStream.CopyToAsync($errStream)
        $process.WaitForExit()
        [void]$outTask.GetAwaiter().GetResult(); [void]$errTask.GetAwaiter().GetResult()
        return $process.ExitCode
    } finally { $outStream.Dispose(); $errStream.Dispose(); $process.Dispose() }
}

function Asb-Worker($agent, $id, $workspace, $message, $log) {
    [IO.File]::WriteAllText(($log + '.started'), '1', $asbUtf8)
    $status = 1
    try {
        Asb-Path
        $exe = Asb-Executable $agent
        $argsList = if ($agent -eq 'codex') { @('exec','resume','--skip-git-repo-check','--',$id,$message) } else { @('--resume',$id,'--print','--',$message) }
        $status = Asb-RunCli $exe $argsList $workspace $log ($log + '.err')
        if ($agent -eq 'codex' -and $status -ne 0) {
            $errorText = Asb-ReadTail ($log + '.err') 64000
            if ($errorText -match 'thread-store conflict|already has an active writer') {
                $status = Asb-RunCli $exe @('queue',('--thread=' + $id),('--message=' + $message)) $workspace $log ($log + '.err')
                if ($status -eq 0) { [IO.File]::AppendAllText($log, "`n__ASB_CODEX_QUEUED__`n", $asbUtf8) }
            }
        }
    } catch { [IO.File]::AppendAllText(($log + '.err'), $_.Exception.Message, $asbUtf8) }
    finally {
        if ($status -lt 0) {
            [IO.File]::AppendAllText(($log + '.err'), ('Native process crashed: ' + $status), $asbUtf8)
            $status = 1
        }
        [IO.File]::WriteAllText(($log + '.exit.tmp'), [string]$status, $asbUtf8)
        [IO.File]::Move(($log + '.exit.tmp'), ($log + '.exit'))
        Remove-Item -LiteralPath ($log + '.ps1') -Force -ErrorAction SilentlyContinue
    }
}

function Asb-Log($id) {
    if ($id -notmatch '^[a-f0-9]{32}$') { throw 'Invalid reply log ID' }
    return Join-Path ([IO.Path]::GetTempPath()) ('asb-reply-' + $id + '.log')
}

function Asb-ReadTail($path, $limit) {
    if (!(Test-Path -LiteralPath $path)) { return '' }
    $stream = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite, Delete')
    try {
        $size = [int][Math]::Min($limit, $stream.Length)
        [void]$stream.Seek(-$size, 'End')
        $bytes = New-Object byte[] $size
        $offset = 0
        while ($offset -lt $size) { $n = $stream.Read($bytes, $offset, $size - $offset); if (!$n) {break}; $offset += $n }
        return $asbUtf8.GetString($bytes, 0, $offset)
    } finally { $stream.Dispose() }
}

function Asb-Start($agent, $id, $workspace, $message) {
    if ($agent -notin @('codex','claude-code') -or $id -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$') { throw 'Invalid reply session' }
    if ($agent -eq 'codex' -and $id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'Invalid Codex thread' }
    if (!(Test-Path -LiteralPath $workspace -PathType Container)) { throw 'The task workspace no longer exists' }
    [void](Asb-Executable $agent)
    # Remove only completed day-old jobs; never interrupt an active reply.
    foreach ($old in @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Filter 'asb-reply-*.log.exit' -File)) {
        if ($old.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddDays(-1) -and $old.Name -match '^asb-reply-([a-f0-9]{32})\.log\.exit$') {
            $oldLog = Asb-Log $Matches[1]
            foreach ($suffix in @('', '.err', '.exit', '.exit.tmp', '.ps1', '.started', '.pid')) { Remove-Item -LiteralPath ($oldLog + $suffix) -Force -ErrorAction SilentlyContinue }
        }
    }
    $jobId = [Guid]::NewGuid().ToString('N'); $log = Asb-Log $jobId
    $worker = "`$ErrorActionPreference='Stop';`$asbUtf8=New-Object Text.UTF8Encoding(`$false);`n"
    foreach ($name in @('USERPROFILE','APPDATA','PATH','CODEX_HOME','CLAUDE_CONFIG_DIR')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($value) { $worker += '$env:' + $name + "='" + $value.Replace("'", "''") + "';`n" }
    }
    foreach ($fn in @('Asb-Path','Asb-NativeArgument','Asb-Executable','Asb-RunCli','Asb-ReadTail','Asb-Worker')) {
        $worker += 'function ' + $fn + ' {' + (Get-Item ('Function:' + $fn)).Definition + "}`n"
    }
    $values = @($agent,$id,$workspace,$message,$log) | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }
    $worker += 'Asb-Worker ' + ($values -join ' ')
    # A BOM makes -File decode Unicode correctly on Windows PowerShell 5.1.
    [IO.File]::WriteAllText(($log + '.ps1'), $worker, (New-Object Text.UTF8Encoding($true)))
    try {
        $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $line = (Asb-NativeArgument $shell) + ' -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + (Asb-NativeArgument ($log + '.ps1'))
        # CIM launches independently of the SSH channel. Break away from WMI's
        # job as well; if policy denies this, report failure instead of pretending
        # delivery succeeded. No password or persistent scheduled task is needed.
        $startup = New-CimInstance Win32_ProcessStartup -ClientOnly -Property @{CreateFlags=[uint32]0x01000000;ShowWindow=[uint16]0}
        $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$line;CurrentDirectory=$workspace;ProcessStartupInformation=$startup}
        if ($created.ReturnValue -ne 0) { throw ('Cannot detach Windows reply (CIM code ' + $created.ReturnValue + ')') }
        # Delivery already happened. A bookkeeping failure must not invite a
        # duplicate resend of a potentially running turn.
        try { [IO.File]::WriteAllText(($log + '.pid'), [string]$created.ProcessId, $asbUtf8) } catch {}
    } catch { Remove-Item -LiteralPath ($log + '.ps1') -Force -ErrorAction SilentlyContinue; throw }
    return $jobId
}

function Asb-Main($action, $a = '', $b = '', $c = '', $d = '') {
    Asb-Path
    switch ($action) {
        'probe' {
            if ($env:OS -ne 'Windows_NT') { throw 'This is not a native Windows target' }
            $tools = @()
            foreach ($pair in @(@('claude','claude-code'),@('codex','codex'),@('gemini','gemini'))) {
                if (Get-Command $pair[0] -ErrorAction SilentlyContinue) { $tools += $pair[1] }
            }
            @{os='Windows';tools=$tools;tmuxVersion='';powerShellVersion=$PSVersionTable.PSVersion.ToString()} | ConvertTo-Json -Compress
        }
        'discover' { Asb-Discover $a $b }
        'start' { Asb-Start $a $b $c $d }
        'poll' {
            $log = Asb-Log $a
            # If policy prevents the worker from starting, don't display an
            # endless 'processing' state. A .started marker precedes CLI launch.
            if (!(Test-Path -LiteralPath ($log + '.started')) -and (Test-Path -LiteralPath ($log + '.pid'))) {
                $workerPid = [IO.File]::ReadAllText(($log + '.pid')).Trim()
                if ($workerPid -match '^[0-9]+$' -and !(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $workerPid))) {
                    [Console]::Write("Windows reply worker did not start. Check PowerShell execution policy.`n__ASB_REPLY_EXIT__=1`n")
                    return
                }
            }
            $text = (Asb-ReadTail $log 1500000) + "`n" + (Asb-ReadTail ($log + '.err') 400000)
            [Console]::Write([regex]::Replace($text, '(?m)^__ASB_REPLY_EXIT__=[0-9]+\s*$', ''))
            if (Test-Path -LiteralPath ($log + '.exit')) {
                $code = [IO.File]::ReadAllText(($log + '.exit')).Trim()
                if ($code -match '^[0-9]+$') { [Console]::Write("`n__ASB_REPLY_EXIT__=" + $code + "`n") }
            }
        }
        'cleanup' {
            $log = Asb-Log $a
            foreach ($suffix in @('', '.err', '.exit', '.exit.tmp', '.started', '.pid', '.ps1')) { Remove-Item -LiteralPath ($log + $suffix) -Force -ErrorAction SilentlyContinue }
        }
        default { throw 'Unknown Windows bridge action' }
    }
}
