# My Brush

macOS와 Windows에서 다른 앱 화면 위에 필기하기 위한 데스크톱 앱이다. Python과 Qt Widgets·QPainter를 사용하며, 웹 서버나 웹뷰 없이 실행한다. ScreenBrush의 코드·이미지 자산을 복사하지 않고 선택한 기능을 새로 구현한다.

## 첫 버전 범위

1. 화면 위 자유 필기
2. 선 굵기 변경
3. 색상 변경
4. 단축키 설정
5. 테두리 사각형
6. 화면 텍스트와 글자 크기 조절
7. Control+드래그 영역과 일부라도 겹친 오브젝트 전체 삭제

사용자가 확정한 범위는 [첫 버전 요구사항](docs/requirements/first-version.md), 기본값과 세부 조작은 [입력 설계](docs/design/interaction-design.md)에서 관리한다. `preview/index.html`은 이전 조작 시안이며 데스크톱 앱의 실행 진입점은 `desktop_main.py`다.

## 소스에서 실행

대상은 macOS 14 이상과 Windows 10/11이다. Python 3.10 이상이 필요하며 개발 환경은 Python 3.12를 사용한다. 런타임 의존성은 `PySide6-Essentials==6.12.0`으로 고정한다.

macOS에서는 `run-mac.command`, Windows에서는 `run-windows.cmd`를 실행한다. 프로젝트의 `.venv`가 없으면 가상환경을 만들고 필요한 Python 패키지를 설치한다. 첫 설치에는 인터넷 연결이 필요하다. 이후 패키지가 설치된 상태에서는 로컬에서 실행한다.

직접 실행할 때는 다음 명령을 사용한다.

```sh
# macOS
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python desktop_main.py
```

```bat
rem Windows
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe desktop_main.py
```

## 조작

| 동작 | 기본 입력 |
|---|---|
| 필기 켜기 / 끄기 | macOS: Control+Command+Tab · Windows: Control+Shift+Space · 앱 메뉴 |
| 펜 / 사각형 / 텍스트 | B / R / T |
| 선 굵기 감소 / 증가 | [ / ] |
| 단축키 설정 | Control+, |
| 영역 삭제 | Control을 누른 채 왼쪽 버튼으로 드래그 |
| 텍스트 줄바꿈 / 확정 | Enter / Control+Enter |
| 현재 편집·제스처 취소, 그 외 작업 복귀 | Escape |

**macOS에서도 Control은 ⌃ 키이며 Command(⌘) 키가 아니다.** 도구 키는 필기 중에만 사용하고, 텍스트 편집 중에는 문자 입력에 맡긴다. 전역 조합을 OS에 등록하지 못하면 오류를 표시하고 앱 메뉴를 통해 필기를 시작한다.

도구 막대에서 색상·선 굵기·글자 크기를 바꾼다. 텍스트 도구로 기존 텍스트를 클릭하면 내용과 크기를 다시 편집한다. Control+드래그 삭제는 경계에 일부만 닿아도 한 획·사각형·텍스트 오브젝트 전체를 제거한다. 채움 없는 사각형의 빈 내부만 선택한 경우에는 테두리를 지우지 않는다.

앱을 실행해 둔 채 **Control+Command+Tab(⌃⌘⇥)**을 누르면 필기 화면과 도구 막대가 함께 꺼지고, 다시 누르면 함께 켜진다. 도구 막대의 `필기 끄기`도 같은 숨김 동작을 수행한다. OFF 상태는 앱의 활성화 여부가 바뀌어도 유지하며, 다시 켜려면 토글 단축키나 메뉴를 사용한다. 앱 종료는 메뉴의 `My Brush 종료`로 구분한다.

필기를 끄면 이전 앱으로 돌아가도록 요청한다. 필기 내용은 실행 중 메모리에 유지하며 앱 종료 시 보존하지 않는다. 기본 글꼴은 OS 기본 산세리프이므로 macOS와 Windows의 글자 모양·줄 폭은 다를 수 있다. 색상·굵기·텍스트 크기·단축키는 Qt가 정한 사용자별 설정 디렉터리의 `preferences.json`에 저장한다. macOS에서는 `~/Library/Preferences/MyBrush/MyBrush/preferences.json`이다. 기존에 저장한 사용자 단축키는 유지하며 설정 창에서 변경할 수 있다.

## 앱으로 빌드

빌드할 운영체제에서 다음 명령을 실행한다. [PyInstaller는 운영체제별로 각각 번들해야 한다](https://pyinstaller.org/en/stable/usage.html#supporting-multiple-operating-systems). macOS에서 만든 결과를 Windows 실행 파일로 사용하지 않는다.

```sh
# macOS
.venv/bin/python -m pip install -r requirements-build.txt
.venv/bin/python scripts/build.py
```

```bat
rem Windows
.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.venv\Scripts\python.exe scripts\build.py
```

- macOS 결과: `dist/MyBrush.app`
- Windows 결과: `dist/MyBrush/MyBrush.exe`와 같은 폴더의 실행 의존성

`scripts/build.py`는 창 모드·폴더 번들로 빌드하며 PyInstaller의 표준 Qt 수집을 사용한다. 생성된 spec은 `build/spec/MyBrush.spec`에 둔다. macOS 번들의 식별자는 `dev.mybrush.desktop`, 표시 이름은 `My Brush`다. [공식 `info_plist` 설정](https://pyinstaller.org/en/stable/spec-files.html#spec-file-options-for-a-macos-bundle)을 빌드 시 적용한다. 생성된 번들을 로컬에서 확인하는 단계이며 공증·배포용 서명은 별도 작업이다.

## 검증 기록

실제 macOS 앱 실행과 네이티브 도구·텍스트·단축키 설정·창 숨김을 확인했고 모델·위젯 테스트 54개가 통과했다. 다른 앱에서 실제 Control+Command+Tab으로 필기를 켜고 끄는 동작은 사용자가 확인했다. Control+드래그의 실제 OS 입력, 실제 한글 IME, 여러 화면 배율과 Windows 실행은 추가 확인이 필요하다. [데스크톱 구현·검증 기록](docs/design/native-verification.md)에 통과 항목과 남은 항목을 구분했다. [브라우저 시안 검증 기록](docs/design/preview-verification.md)은 네이티브 앱의 검증 근거로 사용하지 않는다.
