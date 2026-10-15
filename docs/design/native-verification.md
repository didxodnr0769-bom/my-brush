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
