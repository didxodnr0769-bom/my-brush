# OS별 개발·검증 절차

목적은 다른 컴퓨터에서 기존 소스를 이어서 작업하는 것이다. 명령은 저장소 루트 기준이며 2026-10-16 확인한 코드·스크립트에 맞춘다. Windows 명령은 준비된 절차이며 실제 실행 완료 기록이 아니다.

## 시작

- 비공개 저장소 접근 권한이 있는 GitHub 계정의 Git 인증을 확인한다. 토큰을 문서·명령 인수·저장소에 넣지 않는다.
- `git clone https://github.com/didxodnr0769-bom/my-brush.git` 후 `my-brush` 폴더를 Codex 프로젝트로 열고 `AGENTS.md`, `.agents/README.md`를 읽는다.
- 기존 checkout은 `git status --short --branch`, `git remote -v`부터 본다. 로컬 변경을 보존하고 깨끗한 상태에서 `git pull --ff-only`로 갱신한다.
- OS·아키텍처·Python 실행 경로와 버전을 확인한다. `.venv`는 OS·원래 인터프리터 경로에 종속되므로 다른 컴퓨터에서 재사용하지 않는다. 기존 실행 파일·심볼릭 링크가 깨졌으면 해당 환경에 새로 준비한다. 빌드 폴더·사용자 설정도 자동 동기화 대상이 아니다.

## Windows — PowerShell

Python 3.12와 Git이 준비된 상태에서 저장소 루트에서 실행한다. 가상환경 활성화 대신 실행 파일 경로를 직접 사용한다.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe desktop_main.py
```

간편 실행은 `.\run-windows.cmd`다. Python 3.12 → `py -3` → `python` 순으로 찾아 Python 3.10 이상으로 `.venv`와 런타임 의존성을 준비한다. 빌드 패키지는 따로 설치한다. 앱을 모두 종료한 상태에서 `desktop_main.py --start-hidden`을 사용하면 OFF로 시작한다. 두 번째 인스턴스는 기존 창을 표시한다.

자동 검사와 실제 UI 실행을 분리한다.

```powershell
$env:QT_QPA_PLATFORM = "offscreen"
.\.venv\Scripts\python.exe -m unittest discover -s tests
Remove-Item Env:QT_QPA_PLATFORM
```

실패·skip 목록을 읽는다. 일반 UI 실행 전에 offscreen 변수를 제거해야 한다. 맥 전용 검사 skip을 Windows 동작 확인으로 세지 않는다.

Windows 번들은 Windows에서 만든다.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.venv\Scripts\python.exe scripts/build.py
.\dist\MyBrush\MyBrush.exe
```

결과는 onedir이므로 exe만 옮기지 말고 `dist\MyBrush` 폴더의 의존성도 유지한다. 기존 앱을 종료한 뒤 새 exe인지 확인한다. macOS `.app`을 Windows 결과물로 사용하지 않는다.

## Windows에서 우선 확인

1. 다른 앱 위 투명 화면·필기·도구 막대와 빈 영역에서의 그리기.
2. 다른 앱 사용 중 실제 **Ctrl+Shift+Space**로 ON/OFF, OFF 유지와 일반 앱 조작.
3. 실제 Ctrl+왼쪽 드래그의 일부 교차·복수 전체 삭제, 빈 사각형 내부 제외, Ctrl 선해제·Esc 취소.
4. 한글 IME 조합·후보, Enter 줄바꿈·Ctrl+Enter 완료·Esc 취소, 기존 텍스트 크기 변경.
5. 단축키 변경·중복·OS 등록 실패 시 기존 키 유지·재시작 후 복원. 전역 F12 거절은 현재 Windows backend의 정책이다.
6. 이전 앱의 실제 포커스 복귀, 여러 모니터·서로 다른 배율·전체 화면 동작.
7. 소스와 패키징한 exe의 실행을 각각 기록. 실패는 담당 코드의 최소 수정과 관련 회귀 검사로 해결.

## macOS에서 이어가기

설치·일반 실행은 `README.md`, `run-mac.command`를 따른다. 가상환경 준비 후 검사·빌드한다.

```sh
QT_QPA_PLATFORM=offscreen .venv/bin/python -m unittest discover -s tests
.venv/bin/python -m pip install -r requirements-build.txt
.venv/bin/python scripts/build.py
codesign --verify --deep --strict dist/MyBrush.app
```

기본 전역키는 **Control+Command+Tab**이다. 현재 맥 번들은 로컬 ad hoc 서명이며 공증·배포용 서명을 완료한 것은 아니다.

## 마칠 때

- 관련 검사와 실제 OS 조작을 수행하고 실행하지 못한 항목은 남긴다. 문서만 수정했다면 앱 테스트·재빌드를 반복할 필요는 없다.
- `docs/design/native-verification.md`에 날짜·OS·아키텍처·검사 방식·사용자 확인·미검증을 구분해 기록한다. `output/native/verification.json`을 갱신할 때도 다른 OS의 미확인 항목을 통과로 바꾸지 않는다.
- 새 결정·함정은 `.agents` 담당 파일에, 제품 범위·일반 사용법은 기존 담당 문서에 반영한다.
- `git diff --check`와 커밋 범위를 확인한다. 요청 범위만 커밋·푸시하고 원격 반영과 작업 트리를 확인한다. 생성물·개인 기록 제외는 `.gitignore`를 따른다.
