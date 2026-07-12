# Abstract Echoes — Bremen Backyard

**브레멘 백야드(Bremen Backyard) 전시용 보이스 리액티브 키오스크 앱.**
관람객이 페달(B 키)을 밟고 마이크에 목소리를 들려주면, 소리가 실시간 제너러티브 캔버스로 그려지고, 마지막에 사운드 웨이브 프린트가 QR 코드로 발급되어 관람객이 자신의 목소리 그림을 가져갈 수 있습니다.

- **프로덕션**: https://abstract-echoes.vercel.app
- **스택**: React 18 + TypeScript + Vite · Canvas 2D 제너러티브 엔진(simplex-noise) · Web Audio · MediaPipe YAMNet(소리 분류) · Vosk WASM(한국어 트리거 워드 인식) · Electron(Windows 배포)

## 체험 흐름 (Phase)

```
idle → pedalHint → intro → listening(15s) → showcase(25s, QR) → idle
```

| Phase | 내용 |
|-------|------|
| `idle` | `title.svg` + Simplex 노이즈 변형 대기 화면, 하단 페달 힌트 |
| `pedalHint` | 페달 안내 연출 후 인트로로 전환 |
| `intro` | 동물 사운드 인트로 시퀀스 → 마이크 권한 요청 |
| `listening` | 마이크 입력을 제너러티브 캔버스로 렌더. YAMNet이 소리 종류를 분류하고, Vosk가 한국어 트리거 워드 7종을 감지해 특수 반응 발동 |
| `showcase` | 오실로스코프 sweep으로 사운드 웨이브 프린트 생성 → imgbb 업로드 → `viewer.html` 링크 QR 표시 |

## 실행

```bash
npm install
npm run setup    # 최초 1회 — MediaPipe WASM + YAMNet 모델 배치 (dev에서 소리 분류에 필요)
npm run dev      # http://localhost:5173
```

`.gitignore`에 `public/wasm`, `public/models`가 포함되어 있어 새 환경에서는 반드시 `npm run setup`을 다시 실행해야 합니다. Vosk 한국어 모델(82MB)은 첫 실행 시 원격에서 받아 IndexedDB에 캐시됩니다.

```bash
npm run build      # 프로덕션 빌드
npm run preview    # 빌드 결과 미리보기
npm test           # vitest
```

## 조작 키

| 키 | 동작 |
|----|------|
| **B** / 클릭·탭 | 페달 입력 — idle→시작, listening→showcase 조기 진입, showcase→idle 복귀 |
| **Space** | listening 중 마이크 정지 |
| **Delete** | 현재 단계 취소·리셋 |
| **Ctrl+Shift+K** | 키오스크 모드 토글(커서 숨김 등) |
| **Q** | 디버그 UI 토글 |
| **`** | 음성인식 디버그 오버레이 토글 (`?debug=1`로도 진입) |
| **O** | 오실로스코프 튜닝 패널 (listening 중) |
| **P** | 프린트 sweep 튜닝 패널 (showcase 중) |

`?preview=qr` 쿼리로 QR(showcase) 장면만 고정 노출하는 확인 모드에 진입할 수 있습니다.

## 전시 운영 (Windows)

| 스크립트 | 용도 |
|----------|------|
| `Bremen_Kiosk.bat` | **운영 기본** — 부팅 후 30초 대기 뒤 Vercel 프로덕션을 Chrome 앱 창으로 실행. 영구 프로필로 마이크 권한·Vosk 모델 캐시 유지 |
| `전시_시작.bat` | 오프라인 대비 — 로컬 빌드 + preview 서버(8080) + Chrome 키오스크 실행 |
| `Bremen_Daily_Reboot_Setup.bat` | 심야 자동 재부팅 스케줄 등록(schtasks) — 장시간 가동 시 WebGL 컨텍스트 손실·화이트아웃 예방 |

Electron 포터블/인스톨러 빌드는 [WINDOWS_DEPLOY.md](WINDOWS_DEPLOY.md) 참조 (`npm run pack:win` / `npm run dist:win`).

## 구조

| 경로 | 설명 |
|------|------|
| `src/components/SoundCanvas.tsx` | Phase 상태 머신, 캔버스, 마이크, QR, 키 입력 — 앱의 중심 |
| `src/lib/generativeEngine.ts` | 캔버스 제너러티브 렌더 |
| `src/lib/audioAnalyzer.ts` | 마이크 입력 + 스펙트럼 분석 |
| `src/lib/yamnetClassifier.ts` | YAMNet 소리 분류 (MediaPipe tasks-audio) |
| `src/lib/speechTrigger.ts` | Vosk WASM 한국어 트리거 워드 인식 |
| `src/lib/oscilloscope.ts` | showcase 오실로스코프 sweep 렌더 |
| `src/lib/instrumentEngine.ts` | 사운드 반응 악기 레이어 |
| `src/lib/tuningParams.ts` | 튜닝 파라미터 정의 |
| `public/viewer.html` | QR 랜딩 — 관람객이 자신의 사운드 웨이브 이미지를 보는 모바일 페이지 |
| `scripts/setup-local-assets.mjs` | WASM·YAMNet 모델 배치 스크립트 |
| `electron/` | Electron 메인/프리로드 (Windows 배포용) |

## 배포

Vercel 자동 배포. `vercel.json`이 빌드 커맨드를 `npm run setup && npm run build`로 지정해 모델·WASM을 빌드 산출물에 포함시킵니다.
