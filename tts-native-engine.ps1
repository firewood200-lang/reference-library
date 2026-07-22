# TTS 네이티브 엔진 (System.Speech / SAPI5 직접 제어)
#
# 왜 필요한가: 이 앱의 "읽기 모드" 창은 원래 브라우저 내장 Web Speech API로 음성을 재생했는데,
# 이 PC의 Chromium이 새로 설치/등록된 SAPI5 음성(유미 등)을 인식하지 못하는 문제가 확인됐다.
# 반면 PowerShell의 .NET System.Speech는 같은 음성을 정상적으로 인식하고 재생도 잘 된다.
# 그래서 main.js가 이 스크립트를 자식 프로세스로 띄워두고, 표준입력으로 명령을 보내
# 재생/일시정지/정지를 제어하고, 표준출력으로 상태를 돌려받는 방식으로 우회한다.
#
# 프로토콜(표준입력, 한 줄에 한 명령, "명령:값" 형식):
#   VOICE:<음성 이름>   - 사용할 음성 선택 (System.Speech가 인식하는 이름 그대로)
#   RATE:<-10~10>       - 속도
#   VOLUME:<0~100>      - 볼륨
#   PITCH:<-100~100>    - 음높이(SSML prosody pitch %, 다음 SPEAK부터 적용)
#   SPEAK:<base64 UTF8 텍스트>  - 읽기 시작 (기존 재생은 취소하고 새로 시작)
#   PAUSE / RESUME / STOP / EXIT
#
# 표준출력(한 줄에 하나, "STATUS:값"):
#   SPEAKING / DONE / PAUSED / STOPPED / ERROR:<사유>
#
# 2026-07-20 구조 변경 (3차 수정) - 왜 이렇게 두 스레드로 나눴는가:
# 처음엔 표준입력을 한 스레드에서 읽으면서 그 안에서 바로 $synth.SpeakSsmlAsync() 등을
# 호출했다. 그런데 일시정지/정지 버튼을 눌러도 전혀 반응이 없는 문제가 있었고, 두 차례
# (ReadLine→ReadLineAsync, 그다음 Start-Sleep 폴링) 표준입력 읽는 방식을 고쳐봐도 전혀
# 나아지지 않았다. 남은 유력한 설명은: SPEAK 명령을 처리하는 동안 뭔가(SpeakSsmlAsync
# 계열 호출이 이 환경에서 기대와 달리 즉시 안 돌아오는 등)가 그 스레드를 실제로 오래
# 붙잡고 있어서, 같은 스레드에서 도는 표준입력 읽기 루프 자체가 다음 줄로 넘어가지
# 못했다는 것이다. 정확한 원인을 계속 추정하기보다, 구조적으로 이런 일이 재발해도
# 일시정지/정지가 항상 즉시 반응하도록 만드는 게 더 확실하다고 판단해 아래처럼 나눴다:
#   - 메인 스레드: 표준입력을 읽어서 명령 큐에 넣기만 한다. 재생 관련 로직을 절대
#     직접 실행하지 않으므로, 재생 쪽에서 무슨 일이 있어도 다음 명령을 큐에 넣는 것
#     자체는 항상 즉시 된다 = 일시정지/정지 클릭이 절대 "씹히지" 않는다.
#   - 워커 러너스페이스(별도 스레드): 큐에서 명령을 하나씩 꺼내 $synth를 실제로 조작한다.
#     재생 완료 감지도 이벤트 구독 대신 $synth.State를 짧은 주기로 직접 읽는 폴링 방식을
#     쓴다(이벤트 구독은 "PowerShell 엔진이 한가할 때"만 실행된다는 보장이 약해서 이번
#     문제의 배경으로 의심됐던 부분이라 아예 배제했다 - 프로퍼티 읽기는 그런 전제가 필요 없다).

Add-Type -AssemblyName System.Speech
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)

$cmdQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()

$workerRunspace = [runspacefactory]::CreateRunspace()
# 2026-07-20 (4차 수정): STA로 만들면 SAPI(고전 COM 기반 음성 엔진)가 내부적으로 완료 통지 등에
# 쓰는 히든 윈도우 메시지를 이 스레드가 받아 처리해줘야 하는데, 여기엔 GetMessage/DispatchMessage
# 같은 메시지 펌프가 전혀 없다. SpeakSsmlAsync 호출 자체는 (관찰상) 바로 반환됐지만, 그 직후
# 이 스레드가 "정지"한 것처럼 보인 것도 이 메시지 대기 때문일 가능성이 높다고 보고 MTA로 바꿨다
# ($synth를 이 스레드 안에서 직접 만들고 같은 스레드에서만 호출하므로 아파트먼트 간 마샬링
# 문제는 없다).
$workerRunspace.ApartmentState = [System.Threading.ApartmentState]::MTA
$workerRunspace.Open()
$workerRunspace.SessionStateProxy.SetVariable('cmdQueue', $cmdQueue)

$workerScript = {
    Add-Type -AssemblyName System.Speech
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.SetOutputToDefaultAudioDevice()
    $pitchPct = 0
    $lastState = 'Ready'
    # 2026-07-22: "지금 읽는 부분 표시" 기능을 처음엔 SpeakProgress 이벤트 구독(add_SpeakProgress)으로
    # 만들었다가, 실제로는 전혀 발동하지 않아 원인을 다시 보니 이 파일 위쪽에 이미 적혀있던 교훈과
    # 정확히 같은 문제였다: 이 워커는 별도 러너스페이스에서 커스텀 busy-loop(아래 while문, 표준입력
    # 스레드와 분리)로 도는데, PowerShell의 이벤트 콜백은 "엔진이 한가할 때"만 처리되는 게 보장이
    # 약해서(SpeakProgress 뿐 아니라 $synth.State 변화 감지도 처음엔 이벤트로 하려다 실패해서
    # 폴링으로 바꿨던 바로 그 이유) 콜백 자체가 안 불렸다. 그래서 이벤트 구독을 걷어내고, 대신
    # main.js(ttsScript)가 문서를 문장/줄 단위로 미리 잘라 한 조각씩 순서대로 SPEAK를 반복 호출하는
    # 방식으로 바꿨다 - 조각 하나가 끝났다는 건 기존에도 신뢰할 수 있었던 State 폴링(DONE 감지)
    # 그대로 알 수 있으므로, 새 이벤트 메커니즘이 전혀 필요 없다.

    # Write-Output(파이프라인)이 아니라 [Console]::Out에 직접 쓴다 - 이 스크립트블록은
    # 별도 러너스페이스에서 BeginInvoke()로 도는데, 그 경우 Write-Output 결과는 기본적으로
    # 이 PowerShell 인스턴스의 출력 컬렉션으로만 모이고 프로세스의 실제 표준출력(Node가
    # 읽는 파이프)으로 자동으로 나가지 않는다. [Console]::Out은 프로세스 전역이라 어느
    # 스레드에서 쓰든 항상 진짜 표준출력으로 간다.
    function Write-Status([string]$s) {
        [Console]::Out.WriteLine("STATUS:$s")
        [Console]::Out.Flush()
    }
    function Escape-Xml([string]$t) {
        if ($null -eq $t) { return '' }
        $t = $t -replace '&', '&amp;'
        $t = $t -replace '<', '&lt;'
        $t = $t -replace '>', '&gt;'
        $t = $t -replace '"', '&quot;'
        $t = $t -replace "'", '&apos;'
        return $t
    }

    $idleTicks = 0
    while ($true) {
        $line = $null
        $got = $cmdQueue.TryDequeue([ref]$line)
        if (-not $got) {
            Start-Sleep -Milliseconds 30
            # 사용자가 일시정지/정지를 누르지 않고 문서를 끝까지 다 읽어서 "자연스럽게"
            # 끝나는 경우를 감지하기 위한 폴링. State는 단순 프로퍼티 읽기라 이벤트
            # 구독과 달리 별도 전제조건 없이 항상 즉시/안전하게 최신값을 준다.
            $state = $synth.State.ToString()
            if ($state -ne $lastState) {
                if ($state -eq 'Ready' -and $lastState -eq 'Speaking') { Write-Status 'DONE' }
                $lastState = $state
            }
            # 진단용 하트비트 - 약 1.5초에 한 번, 이 워커 루프가 살아서 계속 돌고 있다는 걸
            # 눈으로 확인하려는 용도. 만약 SPEAK 이후 이게 뚝 끊기면, State 읽기나 그 주변에서
            # 이 스레드가 멈췄다는 뜻이 된다.
            $idleTicks++
            if ($idleTicks % 50 -eq 0) { Write-Status "WATCHDOG:state=$state" }
            continue
        }
        $idleTicks = 0
        if ($line -eq '__EXIT__') { break }
        $sep = $line.IndexOf(':')
        if ($sep -lt 0) { continue }
        $cmd = $line.Substring(0, $sep)
        $arg = $line.Substring($sep + 1)
        Write-Status "RECEIVED:$cmd"  # 진단용 - 명령이 실제로 도착했는지 렌더러 콘솔에서 바로 확인 가능

        switch ($cmd) {
            'VOICE' {
                if ($arg -ne '') {
                    try { $synth.SelectVoice($arg) } catch { Write-Status "ERROR:$($_.Exception.Message)" }
                }
            }
            'RATE' {
                try { $synth.Rate = [int]$arg } catch { Write-Status "ERROR:$($_.Exception.Message)" }
            }
            'VOLUME' {
                try { $synth.Volume = [int]$arg } catch { Write-Status "ERROR:$($_.Exception.Message)" }
            }
            'PITCH' {
                try { $pitchPct = [int]$arg } catch { $pitchPct = 0 }
            }
            'SPEAK' {
                try {
                    $bytes = [System.Convert]::FromBase64String($arg)
                    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
                    $escaped = Escape-Xml $text
                    $voiceName = Escape-Xml $synth.Voice.Name
                    $ssml = @"
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR"><voice name="$voiceName"><prosody pitch="$($pitchPct)%">$escaped</prosody></voice></speak>
"@
                    $synth.SpeakAsyncCancelAll()
                    $synth.SpeakSsmlAsync($ssml) | Out-Null
                    Write-Status 'SPEAKING'
                    # 2026-07-22: 여기서 곧바로 $lastState를 'Speaking'으로 앞당겨 써두면, 바로 다음
                    # 폴링 틱(약 30ms 뒤)에서 실제 $synth.State가 아직 SpeakSsmlAsync의 비동기 시작
                    # 지연 때문에 'Ready'로 남아있는 경우 "Speaking→Ready로 바뀌었다"고 오판해서
                    # 실제로는 재생이 막 시작했을 뿐인데도 DONE을 즉시 잘못 보내버린다. 그러면 화면은
                    # "다 읽음" 상태로 리셋되어(일시정지 버튼이 다시 비활성화) 정작 오디오는 계속 재생
                    # 중인데도 일시정지를 누를 수 있는 순간이 사실상 없어 보이는 문제가 생긴다(실제로
                    # 이 문제로 "일시정지가 눌러도 반응이 없다"는 버그가 났었다). $lastState는 아래
                    # 폴링 루프가 실제 State를 읽을 때만 갱신하게 두면, 아직 Ready인 동안엔 아무 변화도
                    # 감지되지 않고, 진짜로 Speaking이 된 뒤에야 정상적으로 갱신된다.
                } catch {
                    Write-Status "ERROR:$($_.Exception.Message)"
                }
            }
            'PAUSE' {
                try {
                    if ($synth.State -eq [System.Speech.Synthesis.SynthesizerState]::Speaking) {
                        $synth.Pause(); Write-Status 'PAUSED'; $lastState = 'Paused'
                    } else {
                        Write-Status "ERROR:일시정지할 재생이 없습니다(상태:$($synth.State))"
                    }
                } catch { Write-Status "ERROR:$($_.Exception.Message)" }
            }
            'RESUME' {
                try {
                    if ($synth.State -eq [System.Speech.Synthesis.SynthesizerState]::Paused) {
                        $synth.Resume(); Write-Status 'SPEAKING'; $lastState = 'Speaking'
                    } else {
                        Write-Status "ERROR:이어읽을 대상이 없습니다(상태:$($synth.State))"
                    }
                } catch { Write-Status "ERROR:$($_.Exception.Message)" }
            }
            'STOP' {
                try {
                    $synth.SpeakAsyncCancelAll()
                    Write-Status 'STOPPED'
                    $lastState = 'Ready'
                } catch { Write-Status "ERROR:$($_.Exception.Message)" }
            }
        }
    }
    try { $synth.Dispose() } catch {}
}

$psWorker = [powershell]::Create()
$psWorker.Runspace = $workerRunspace
[void]$psWorker.AddScript($workerScript)
$workerHandle = $psWorker.BeginInvoke()

# 메인 스레드 - 표준입력을 읽어서 큐에 넣기만 한다. 재생 관련 로직은 절대 여기서 직접
# 실행하지 않는다(위 설계 설명 참고) - 그래서 이 while 루프는 블로킹 ReadLine()을 써도
# 안전하다(더 이상 이 스레드에서 처리해야 할 다른 일이 없다).
while ($true) {
    $line = $stdin.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq '') { continue }
    if ($line -eq 'EXIT') { break }
    $cmdQueue.Enqueue($line)
}
$cmdQueue.Enqueue('__EXIT__')
try { $psWorker.EndInvoke($workerHandle) } catch {}
try { $psWorker.Dispose() } catch {}
try { $workerRunspace.Close() } catch {}
