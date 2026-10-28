# My Brush 데스크톱 구현·검증 기록

## 공유 전 재점검 (2026-10-28)

macOS 26.6.2 arm64·Node.js 24.22.1·Electron 45.0.0에서 로직 검사 **69개**, 소스 앱 시나리오 **15개**, 소스·0.2.2 번들의 빠른 입력 회귀 **각 4개**를 재실행해 통과했다. 임시 사용자 설정을 사용했고 기존 일반 사용자 앱은 종료하지 않았다. 이번에는 새 번들을 빌드하지 않았으며 제품 코드를 변경하지 않았다.

추가 경계 점검에서 **화면 오른쪽·아래 가장자리의 텍스트가 확정 후 잘리는 문제 1건**을 VM fixture와 실제 0.2.2 번들에서 확인했다. 편집기만 화면 안으로 보정되고 확정 오브젝트에는 원래 클릭 좌표가 남는다. `electron/renderer/app.js`의 `syncEditor()`와 `commitText()` 사이에서 편집·확정 좌표가 달라지는 경로이며 아직 수정하지 않았다. 아래 기존 정상 시나리오 통과 기록은 이 경계 사례를 포함하지 않았다.

실제 번들에서 펜·사각형·텍스트·Control 영역 삭제·기본 단축키 창을 입력하고 [문서용 캡처](../images/README.md) 3장을 새로 촬영했다. 앱 레이어만 캡처한 뒤 투명 부분을 단색 배경에 합쳤으며, 개인 바탕화면과 업무 자료는 포함하지 않는다. renderer 오류는 없었다.

이번 자동 입력·촬영으로 물리 전역키·실제 한글 IME·바탕화면 합성·혼합 배율·전체 화면 앱·모니터 분리/재연결·Windows의 미검증 상태가 해소되지는 않는다. 날짜는 사용자 시간대 Asia/Seoul의 2026-10-28을 기준으로 기록한다. 로컬 스크립트의 호스트 날짜 표시는 별도일 수 있다.

## 현재 구현 — Electron (2026-10-27)

사용자 요청으로 Python·Qt 실행·빌드 경로를 Electron으로 전환했다. 기능 범위와 입력 규칙은 기존 요구사항·조작 설계를 유지한다. 진입점은 `electron/main.cjs`, 격리된 preload는 `electron/preload.cjs`, 실제 화면은 `electron/renderer/`다. 이전 `preview/index.html`을 앱에서 로드하지 않는다. Python 앱·Qt 전용 검사·PyInstaller 스크립트와 requirements 파일은 제거했다.

### 환경과 명령

- macOS 26.6.2 (25G83), Apple Silicon arm64.
- Node.js 24.22.1, Electron 45.0.0, electron-builder 26.18.0, Playwright 1.64.1.
- 연결된 1920×1080 화면 2개. 각 오버레이의 실제 bounds와 디스플레이 bounds가 일치하고 최상위·표시 상태인 것을 확인했다. 서로 다른 배율·전체 화면 앱·모니터 분리/재연결은 별도 미검증이다.

```sh
npm ci
npm test
npm run test:electron
npm run test:pointer
npm run dist
```

`npm ci`로 잠금 파일 재설치와 Electron 바이너리 설치를 확인했다. GUI 검사는 `MY_BRUSH_USER_DATA` 임시 프로필을 사용하여 사용자 설정을 바꾸지 않고, 검사 후 앱과 임시 프로필을 정리했다. 소스·패키징 앱 실행은 macOS 화면 접근이 가능한 환경에서 수행했다.

### 자동 검사

Node 검사 **69/69 통과**:

| 대상 | 개수 | 검증한 범위 |
|---|---:|---|
| 기하·장면 | 21 | 일부 교차 전체 삭제, 둥근 끝·연결부, 빈 사각형 내부 제외, 경계 접촉, 길고 얇은 영역, 복수 삭제·텍스트 상자 |
| 설정 | 7 | OS별 기본 키, Python 설정 변환, 고정·중복 키 검증, 기존 설정 우선, 원자적 저장 실패 보존 |
| 전역키 교체 | 7 | 등록 실패·예외·저장 실패 복구, 기존 키 유지, 성공 후 이전 키 해제, 초기 실패 재시도 |
| renderer 상태 | 6 | 저장 중 다른 화면 설정 보존, 오래된 revision 무시, 연속 입력·실패 복구, 모달·조합 상태 공유, 잠긴 화면 입력 차단 |
| 포인터 수명주기 | 26 | 지연 release 복구, 다음 down에서 획 분리, 대기 중 hover 제외, Control 해제 순서·명시 취소 유지 |
| 입력 진단 | 2 | 텍스트·좌표·일반 키 제외, 이벤트 허용목록, 비동기 직렬 저장·32건 제한·파일 권한 |

renderer 상태 검사는 VM DOM·지연 IPC fixture를 사용한다. OS 입력기·전역키·화면 합성 검증을 대신하지 않는다.

### 실제 Electron 창 입력 검사

`npm run test:electron`의 **15개 시나리오 통과**:

- 빈 초기 장면, 화면 크기, 투명 배경 알파, 최상위 창, Node 통합 해제·context isolation·renderer sandbox.
- 펜, 새 오브젝트에 색상·굵기 적용, 사각형, 빈 사각형 내부 삭제 제외.
- 여러 줄 한글 텍스트 주입, Control+Enter 확정, 기존 텍스트 크기 변경·편집 취소, 문자 키 입력 보호·외부 클릭 소비.
- 사각형 테두리 일부 교차 시 전체 삭제, Ctrl 선해제·Escape 취소, 여러 종류의 오브젝트 일괄 삭제.
- 단축키 중복 오류·기록 취소·변경 저장·새 도구 키 dispatch.
- 실제 OS에 충돌 키를 선등록한 뒤 변경 거절·기존 키 유지, 사용 가능한 새 전역키 등록·기존 키 해제.
- 다른 화면에서 설정 모달 보호, 합성 composition 이벤트 중 도구 키·토글 보호.
- 필기 끄기·메뉴 켜기 후 내용 유지, 일반 활성화 이벤트 뒤 OFF 유지, 드래그 중 숨김 취소.
- OFF로 재시작한 뒤 저장 설정 복원·장면 비어 있음 확인.

Playwright의 Electron renderer 입력과 실제 OS의 전역키 **등록**을 확인한 결과다. 물리 키 입력으로 다른 앱에서 전역 콜백이 발생하는지, 실제 한글 IME 조합·후보 선택은 확인하지 않았다. 한글 문자열 입력·합성 composition 이벤트를 실제 IME 성공으로 세지 않는다.

초기·필기/텍스트·설정·충돌 오류 화면을 캡처하고 도구 막대·상태 표시·대화상자·오브젝트를 시각 검토했다. 해당 화면에서 잘림·불필요한 페이지 스크롤·겹침을 발견하지 않았다. 캡처는 renderer 투명 레이어이므로 실제 바탕화면 합성의 시각 검증과 구분한다. 로컬 근거는 `output/electron/`에 보관하며 Git에는 포함하지 않는다.

### 0.2.1 — 마우스업 획 소실·Control 삭제 보완

사용자는 **마우스·주 모니터**에서 획이 마우스를 따라오다가 버튼 해제 때 사라지고, Control+드래그도 간헐적으로 실패하며 빠르게 조작할수록 빈도가 늘어난다고 보고했다.

확인된 코드 경로와 수정:

- 확정이 canvas의 `pointerup`에만 있었고, capture loss는 진행 중인 획을 즉시 버렸다. mouse `pointerdown.preventDefault()`는 Chromium의 compatibility `mouseup`도 억제했다. 창 capture 단계에서 release를 처리하고 정상 `mouseup`을 보조 경로로 사용할 수 있도록 했다.
- capture loss·cancel의 pointerId·시작 시각·현재 캡처 상태를 확인해 다른 포인터와 이전 획의 지연 이벤트를 구분한다. 버튼이 이미 해제된 마우스의 capture loss는 동일 release의 `mouseup`을 한 프레임까지 기다린다. 유효한 release가 없으면 취소하며, capture loss만으로 획을 자동 확정하지 않는다.
- macOS 삭제 중 Control 상태를 마우스 플래그 하나에만 의존하지 않고 키 눌림/해제를 함께 추적한다. 실제 Control 해제·Escape·blur·숨김은 계속 미완료 작업을 취소한다.
- 마우스업 보조 경로는 마우스의 시작 버튼만 처리한다. 펜 장치나 다른 버튼의 해제로 임의 확정하지 않는다.

`npm run test:pointer`는 실제 Electron `webContents.sendInputEvent`와 통제된 전달 누락을 사용한다. **소스와 0.2.1 패키징 앱에서 각 3개 검사 통과**:

1. 빠른 100회 그리기 후 100개 유지·Control 영역 삭제 후 0개.
2. Control 키를 유지한 채 마우스 이벤트의 modifier 플래그가 빠지는 조건에서도 삭제 완료.
3. `pointerup` handler 전달을 의도적으로 차단한 상태에서 빠른 100회 그리기·삭제 복구. 수정 전 0.2.0 번들은 100개 중 0개 유지, 수정 후 소스·번들은 100개 유지.

이는 이벤트 누락에 대한 복구 검증이며 **사용자의 물리 마우스에서 실제로 어느 이벤트가 누락되었는지까지 재현한 것은 아니다**. 전달 차단이 없는 빠른 100회 자동 입력은 수정 전에도 정상 통과했다. CUA의 현재 앱 접근성 조회는 시간 초과되어 native UI 도구로 물리 입력과 같은 조건을 확인하지 못했다. 실제 마우스·주 모니터에서의 재발 여부는 추가 확인 대상이다.

획이 release 뒤 남아 있는 renderer 캡처를 검토했고 필기와 도구 막대의 잘림·겹침은 없었다. 기존 15개 앱 시나리오와 패키징 앱의 펜·텍스트·숨김/복귀 검사도 통과했다. 결과물 버전은 **0.2.1**, 패키징 renderer와 현재 소스의 바이트 일치도 확인했다.

### 0.2.2 — 프레임 지연과 다음 획 경계 보완

사용자가 0.2.1에서 개선을 확인했지만 마우스·주 모니터의 빠른 그리기와 Control 삭제 모두에 비슷한 현상이 남았다고 보고했다. 추가로 다음 순서를 VM 회귀검사에서 재현했다.

1. `lostpointercapture(buttons=0) → 한 프레임 경과 → 정상 mouseup`: 0.2.1은 프레임 유예 후 이미 취소하여 정상 release를 버렸다.
2. `lostpointercapture → 다음 pointerdown → move → mouseup`: 0.2.1은 기존 gesture 때문에 새 down을 무시하여 두 획을 연결했다.
3. 버튼이 이미 해제되어 release를 기다리는 삭제에서 Control keyup이 오면 정상적인 버튼 선해제까지 취소했다.

capture loss에서 버튼 0을 확인하면 시간 제한으로 취소하지 않고 release 대기로 전환한다. 그 상태에서는 hover 점을 추가하지 않는다. 같은 마우스·같은 버튼의 다음 down은 이전 버튼 해제를 입증하므로 이전 획을 마지막 좌표에서 닫은 뒤 새 획을 시작한다. Control keyup도 이미 버튼이 해제된 대기 상태이면 당시 Control 상태로 삭제를 완료한다. 버튼이 눌린 상태에서 Control을 먼저 놓거나 실제 blur·Escape·pointercancel·숨김이 오면 계속 취소한다. 캡처 상실이나 시간 경과만으로 임의 확정하지 않는다.

- Node **69개 통과**. 포인터 수명주기 26개에는 새 핵심 순서 4개와 실제 취소·다른 포인터 불간섭이 포함된다.
- 기존 실제 앱 시나리오 **15개 통과**.
- 소스·0.2.2 번들에서 빠른 입력 검사 **각 4개 통과**. 두 프레임 이상 release를 보류하고 100회 연속 시작해도 100개 획이 분리되며 정상 삭제되는지 추가 확인했다.
- 입력 검사 오버레이는 사용자 마우스와 섞이지 않도록 화면 밖에 배치하고 webContents에만 이벤트를 전달한다. 실제 바탕화면 합성 검증을 대신하지 않는다.
- 0.2.2 `.app`·DMG 빌드, 번들의 펜·텍스트·숨김/복귀 검사 통과. 사용자 설정으로 0.2.2를 재실행했다. 사용자는 0.2.2 실행 후 “괜찮아 진듯?”이라고 개선을 확인하고 푸시를 요청했다. 장시간 무재발이나 모든 입력 조건의 완료 확인으로 확대하지 않는다.

실제 사용자 입력의 로컬 진단에서도 네이티브 `mouseUp`이 기록되었으나 renderer에는 확정 `pointerup` 없이 버튼 0의 capture loss가 먼저 기록된 사례가 있었다. 당시 창과 document 포커스는 유지됐다. 따라서 적어도 캡처 종료 시점까지 정상 release 확정 경로가 준비되지 않는다는 근거가 생겼다. 이후 이벤트가 늦게 도착했는지 완전히 누락됐는지, Electron/Chromium/입력 장치 중 어디서 처음 발생했는지까지 확정하지는 않는다. 다른 삭제 기록 1건은 Control keyup이 네이티브 mouseUp보다 먼저 도착해 기존의 Control 선해제 취소 규칙이 적용된 사례였다. 원시 진단에는 좌표·텍스트가 없으며 저장소에 포함하지 않는다.

재발 시 추측 대신 실제 취소 사유를 볼 수 있도록 Electron userData의 `input-diagnostics.jsonl`에 제한된 진단을 저장한다. renderer 이벤트 16개·native 이벤트 12개 이내, 최근 보고 32건만 비동기 저장하며 좌표·텍스트·일반 키는 포함하지 않는다. capture loss·pointercancel·blur·Control 상태 해제·capture 실패와 창 포커스·버튼 상태를 기록한다. 진단 경로는 사용 설명이 아닌 로컬 근거이며 외부 전송하지 않는다. 물리 마우스의 원인 이벤트가 아직 확인된 것은 아니다.

### macOS 패키징 실행

- `npm run dist` 성공: `dist/electron/mac-arm64/My Brush.app`, `dist/electron/My Brush-0.2.2-arm64.dmg`.
- 생성된 `.app`의 실행 파일을 직접 실행해 `app.isPackaged === true`와 `app.asar` 진입점을 확인했다.
- 패키징 앱에서 두 화면 bounds·최상위 창·기본 전역키 등록, 펜·한글 텍스트·Control+Enter, 숨김·메뉴 재표시 후 장면 유지를 확인했다. renderer 오류는 없었다.
- ASAR에는 Electron 소스와 package metadata만 포함되고, Python·테스트·진단·사용자 설정은 포함되지 않았다.
- `mac.identity: null`로 배포용 서명을 생략한 로컬 빌드다. 실행 파일의 linker ad hoc 서명은 배포용 서명·공증 완료를 의미하지 않는다.

### 남은 실제 확인

- macOS 다른 앱 사용 중 물리 Control+Command+Tab의 ON/OFF와 포커스 복귀.
- 실제 Control+왼쪽 드래그, 실제 한글 IME 조합·후보 선택.
- 서로 다른 화면 배율·전체 화면 앱·모니터 분리/재연결과 실제 바탕화면 합성.
- Windows 의존성 설치·NSIS/exe 빌드·실행·전역키·입력·포커스. 이 문서의 macOS 결과는 Windows 결과가 아니다.

## 이전 Python·Qt 기록

아래는 전환 전 기록이다. 당시 54개 검사 및 사용자 물리 전역키 확인은 현재 Electron 앱의 확인으로 재사용하지 않는다. 기록에 나오는 Python 진입점·검사·빌드 파일은 Electron 전환으로 제거했다.

<details>
<summary>2026-10-15 Python·Qt 구현·검증 이력</summary>

# 데스크톱 앱 구현·검증 기록

검증일: 2026-10-15

## 실행 결과물

실행 진입점은 `desktop_main.py`, macOS 번들은 `dist/MyBrush.app`이다. Python 3.12.14, PySide6-Essentials 6.12.0의 Qt Widgets·QPainter와 OS API를 사용한다. 브라우저·웹뷰·HTTP 서버를 실행하지 않는다. `preview/index.html`은 이전 시안으로 남겨 두며 앱에서 로드하지 않는다.

[검증 요약·소스 해시](../../output/native/verification.json)를 저장소에 보관했다. 원시 테스트 출력 `output/native/unit-tests.txt`와 빌드 출력 `output/native/build.txt`는 로컬에만 보관한다.

이번 번들은 Apple Silicon **arm64**용이다. 현재 macOS 26.6.2에서 빌드·실행했다. macOS 14 이상을 대상으로 구성했지만 다른 macOS 버전·Intel Mac에서는 실행하지 않았다. Windows용 코드와 실행·빌드 스크립트는 같은 소스에 포함했고, Windows 실행 파일 생성과 실제 실행은 아직 하지 않았다.

## 자동 검증

```sh
QT_QPA_PLATFORM=offscreen .venv/bin/python -m unittest discover -s tests
.venv/bin/python scripts/build.py
codesign --verify --deep --strict dist/MyBrush.app
```

모델 **20개**, Qt 위젯 통합 **34개**, 합계 **54개** 테스트를 통과했다. offscreen 플러그인의 마우스 캡처·창 올리기 미지원 경고는 실제 macOS 기능 검증과 구분한다.

- 모델: 실제 선 굵기·둥근 끝/연결부, 빈 사각형 내부 제외, 경계 접촉·일부 교차, 전체 오브젝트 삭제, 역방향·길고 얇은 영역.
- 위젯: 필기·사각형과 속성 고정, 텍스트 생성·기존 편집·크기·취소, 합성 IME 보호, Ctrl 삭제·선해제·Escape·숨김·캡처 상실 취소, 단축키 중복·저장·실패 시 유지, 설정 복원, 접근성 도구 선택, 전역키 콜백과 모달 우선순위, 앱 활성화 후 OFF 유지, Control+Command+Tab 기록·복원과 물리 키 매핑.
- 투명 렌더링: 빈 부분의 알파 값 1과 `WA_TranslucentBackground`를 검사했다. 알파 1은 Windows 투명 창의 빈 부분에서도 입력을 받을 수 있도록 둔 값이다. 이 검사는 OS별 화면 합성 결과 전체를 보증하지 않는다.

별도 macOS GUI 세션의 OS API 시험에서 Carbon 전역 단축키 최초 등록, 중복 등록 거절, 성공 후 이전 키 해제, 변경 실패 시 기존 키 유지, 종료 해제를 확인했다. 실제 NSWindow의 Spaces·전체 화면 동반 속성도 검사했다. Windows API는 이 환경에서 호출하지 않았다.

자기 프로세스의 Carbon 타깃에만 `CreateEvent`·`SetEventParameter`·`SendEventToEventTarget`으로 눌림·해제 메시지를 전송한 시험도 통과했다. Carbon 콜백과 Qt queued signal이 각각 2회 전달됐고, 눌림 반복은 억제됐다. 실제 키·HID 입력이나 다른 앱 조작을 하지 않은 **OS 메시지 배선 시험**이다.

재현 스크립트는 [Carbon 전달 시험](../../output/native/carbon-delivery-smoke.py)이며 macOS GUI 세션에서 `.venv/bin/python output/native/carbon-delivery-smoke.py .`로 실행한다. 이 스크립트는 별도 시험 조합을 등록·해제하며 물리 키 입력을 재생하지 않는다.

## 실제 macOS 앱 UI 확인

패키징된 `MyBrush.app`을 실행해 UI 자동화로 확인한 내용이다. 앱을 실행하려는 시도와 화면에서 확인한 결과를 구분했다.

| 대상 | 확인 결과 |
|---|---|
| 창과 도구 막대 | 실제 앱 창·메뉴·도구·색상·굵기·텍스트 크기 컨트롤 표시 |
| 펜 | 마우스 드래그 후 화면에 획 표시 |
| 굵기·색 | 빨강 선택과 굵기 4→7 변경, 서로 다른 두께의 획 표시 |
| 사각형 | 실제 마우스로 도구 선택 후 테두리 사각형 표시 |
| 텍스트 | 한글 여러 줄 붙여넣기, 기존 텍스트 다시 편집, 28→42 크기 변경, 실제 Control+Enter 확정 |
| 도구 키 | T·B 및 변경한 P 키로 도구 상태가 바뀜 |
| 단축키 설정 | Control+,로 설정 열기, 중복 오류·저장 비활성화, 새 키 저장·도구 호출 |
| 작업 복귀 | 버튼 입력 후 앱의 표시 창이 없어지는 것 확인. 다른 앱이 전면인 상태를 읽었으나 이전 앱 토큰과의 대조 검증은 별도 필요 |

Qt `Tool` 창에서는 앱의 접근성 상태 읽기가 시간 초과했고, 생성 타입을 `Window`로 바꾼 새 프로세스에서 해소됐다. 최상위·프레임 없는 투명 창 속성은 유지했다. 이것만으로 접근성 시간 초과의 내부 원인까지 확정하지는 않는다.

UI 자동화의 앱 입력 대상은 대화상자가 열리면 다시 연결해야 했다. 보조키 유지와 드래그를 조합한 시도는 일반 사각형으로 처리됐다. 입력 API에는 드래그 보조키 인자가 없어 **실제 macOS Control+드래그 성공 여부는 이 시도로 판정하지 않는다.** 관련 Qt 이벤트·삭제 모델 테스트 통과와 실제 OS 입력 경로를 분리해 기록한다.

전역 조합을 OS에 등록하는 것과, 다른 앱에서 누른 실제 키가 콜백으로 전달되는 것도 구분한다. 앱에 직접 보내는 자동화 키 입력은 OS 전역 입력과 동일하다고 가정하지 않는다.

진단 실행에서는 자동화한 Ctrl+Shift+Space의 Shift·Control 이벤트만 관찰됐고 Space와 Carbon 콜백은 포착되지 않았다. 콜백 ABI·ID 파싱·Qt 신호 배선 시험은 통과했으나, 이 관찰만으로 실제 물리 키 성공·실패 또는 자동화 도구의 원인까지 확정하지 않는다. 또한 보조키 이벤트의 native key 값 0을 A로 오인할 수 있던 경로를 수정하고 회귀 테스트를 추가했다. 최종 실행은 진단 환경 변수를 설정하지 않아 입력 로그를 기록하지 않는다.

초기 검증에서 만든 필기는 앱 재시작으로 제거하고 당시 시험 값과 일치한 설정만 기본값으로 복구했다. 이후 사용자 요청으로 현재 맥의 토글만 Control+Command+Tab으로 변경했다. 사용자 필기 파일·다른 앱 데이터는 수정하지 않았다.

## 필기 ON/OFF 수정

필기 화면을 숨긴 뒤 `ApplicationActive` 이벤트를 받으면 `show()`를 다시 호출하던 경로를 제거했다. 앱이 활성화되거나 메뉴가 열리는 것만으로 도구 막대를 다시 켜지 않는다. 숨김 상태를 먼저 확정한 뒤 편집·제스처와 창을 정리하며, 메뉴에는 현재 상태에 맞는 `필기 켜기` 또는 `필기 끄기`와 조합을 표시한다.

macOS 기본 토글을 물리 **Control+Command+Tab(⌃⌘⇥)**으로 변경했다. Windows 기본값은 Control+Shift+Space를 유지한다. Tab을 네이티브 키코드·Qt 대체 경로·검증 허용 목록에 추가해 설정 창의 기록·저장·복원에서도 사용할 수 있다. 사용자 설정 파일은 토글 조합만 바꾸고 다른 항목은 유지했다.

수정 전 네 가지 회귀 검사에서 OFF 유지, 새 기본키 처리, Tab 기록, 물리 키 매핑이 실패하는 것을 확인했고 수정 후 전체 54개 검사를 통과했다. 수정 전 검사 출력 `output/native/toggle-red.txt`는 로컬에만 보관한다.

새 번들의 UI에서 `Ctrl+Cmd+Tab`과 `필기 끄기` 표시를 확인했다. 끄기 버튼을 누르면 앱 창이 없어지고 프로세스는 계속 실행된다. OS에서 같은 조합의 중복 등록이 거절되는 것으로 실행 중인 앱의 전역키 점유도 확인했다. 내부 Carbon 눌림·해제 반복과 Qt 신호 전달 검사는 재통과했다.

앱 대상 자동화 `ctrl+super+Tab`에서는 보조키만 관찰됐고 Tab과 Carbon 콜백은 관찰되지 않았다. 단독 Tab은 키코드 48로 도착했다. Finder 대상 자동화에서도 앱 ON을 확인하지 못했다. 이 자동화 결과를 물리 키보드의 성공·실패로 대신하지 않는다. 이후 사용자가 다른 앱을 사용하면서 실제 키보드로 Control+Command+Tab을 두 번 눌러 도구 막대가 정상적으로 켜지고 꺼진다고 확인했다(2026-10-15). 전역키의 실제 ON/OFF는 사용자 확인으로 검증됐다.

## 남은 실제 환경 확인

- macOS에서 실제 Control을 누른 채 드래그해 일부 교차·여러 오브젝트 삭제와 Ctrl 선해제 취소 확인.
- 필기를 끄기 전후 이전 앱 식별자 대조, 다른 앱 활성화·Dock 재진입 후 OFF 상태 유지 확인.
- 실제 한글 IME 조합·후보 선택. 붙여넣기와 합성 preedit 검사는 완료했지만 실제 입력기 시험을 대체하지 않음.
- 여러 모니터·서로 다른 화면 배율·전체 화면 앱에서의 실제 조작.
- Windows에서 의존성 설치·실행·패키징과 동일 시나리오 확인.

## 구현 근거

- [Qt 투명 창](https://doc.qt.io/qtforpython-6/PySide6/QtWidgets/QWidget.html): 투명 속성과 프레임 없는 창을 사용.
- [Qt macOS 입력](https://doc.qt.io/qt-6/macos-issues.html#right-mouse-clicks), [보조키 의미](https://doc.qt.io/qt-6/qt.html#KeyboardModifier-enum): 실제 Control과 Command를 분리하고 컨텍스트 메뉴를 처리.
- [Qt 입력기 이벤트](https://doc.qt.io/qt-6/qinputmethodevent.html): 텍스트 편집과 조합은 네이티브 Qt 편집기에 맡김.
- [Windows 전역키](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey), [이전 창 활성화 제한](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow): 등록 실패와 포커스 복귀 결과를 처리.
- [PyInstaller OS별 빌드](https://pyinstaller.org/en/stable/usage.html#supporting-multiple-operating-systems): 각 OS에서 해당 번들을 생성.

</details>
