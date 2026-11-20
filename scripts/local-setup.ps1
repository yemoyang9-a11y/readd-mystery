# 로컬(Windows PowerShell) 개발 환경 준비 — 2026-11-20
# 사용: 저장소 최상위에서  powershell -ExecutionPolicy Bypass -File scripts\local-setup.ps1
# local-setup.sh 의 Windows 판. 이미 있는 .env 는 건드리지 않는다.
# git·npm 은 진행 상황을 stderr 로 내보낸다. Stop 으로 두면 Windows PowerShell 5.1 이 그걸 오류로 보고 멈추므로 종료 코드로만 판단한다
$ErrorActionPreference = 'Continue'
$Branch = if ($env:BRANCH) { $env:BRANCH } else { 'claude/handoff-docs-review-4cehil' }
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Say($m) { Write-Host "`n== $m" }
function Run($cmd) { Invoke-Expression $cmd; if ($LASTEXITCODE -ne 0) { throw "실패: $cmd" } }
function Fail($m) { Write-Host $m -ForegroundColor Red; exit 1 }

Say 'Node 버전 확인 (20 이상, 권장 22)'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node 가 없습니다. https://nodejs.org 에서 22 LTS 를 설치하고 PowerShell 을 새로 연 뒤 다시 실행하세요.'
}
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { Fail "Node $(node -v) 는 너무 낮습니다. 20 이상을 설치하세요." }
node -v

Say 'origin 이 올바른 저장소인지 확인'
$url = (git remote get-url origin)
Write-Host $url
if ($url -notmatch 'yemoyang9-a11y/readd-mystery') {
  Fail "origin 이 readd-mystery 저장소가 아닙니다($url). README 의 '새로 받기' 방법으로 readd-mystery 를 따로 받으세요."
}

Say "작업 브랜치 $Branch 로 맞추기"
if (git status --porcelain) { git status --short; Fail '커밋하지 않은 변경이 있어 브랜치를 바꾸지 않습니다.' }
Run "git fetch origin $Branch"
git show-ref --verify --quiet "refs/heads/$Branch"
if ($LASTEXITCODE -eq 0) { Run "git checkout $Branch"; Run "git merge --ff-only origin/$Branch" }
else { Run "git checkout -b $Branch origin/$Branch" }
git log --oneline -1

Say '서버 패키지 설치 (backend)'
Push-Location backend; Run 'npm ci'; Pop-Location

Say '화면 패키지 설치 (frontend)'
Push-Location frontend; Run 'npm ci'; Pop-Location

Say '.env 준비 (있으면 그대로 둔다)'
foreach ($d in 'backend', 'frontend') {
  if (Test-Path "$d\.env") { Write-Host "$d\.env 있음 — 그대로 둠" }
  else { Copy-Item "$d\.env.example" "$d\.env"; Write-Host "$d\.env 새로 만듦 (예시 값). 실제 키는 직접 채우세요" }
}

Say '화면 캡처용 브라우저 (Playwright Chromium)'
if ($env:SKIP_BROWSER -eq '1') { Write-Host 'SKIP_BROWSER=1 — 건너뜀' }
else { Push-Location frontend; Run 'npx playwright install chromium'; Pop-Location }

Say '끝'
Write-Host @'
다음 단계
  1) 화면만 보기:  cd frontend ; $env:VITE_USE_MOCK='true' ; npx vite --port 5191
     -> http://localhost:5191  (로그인 reader@example.com / password123)
  2) Claude 새 세션 첫 메시지:  docs/context/handoff-2026-11-20.md 읽고 이어서
'@
