# 혼디봄 2.0

AI 기반 독거노인 위험 우선순위 분석 및 안심파트너 연결 해커톤 프로토타입입니다.

이번 버전은 프론트엔드와 백엔드를 모두 JavaScript로 다시 제작했습니다. 외부 AI API나 Python 런타임 없이 Node.js가 합성 데이터를 만들고 의사결정나무와 랜덤 포레스트를 학습합니다.

## 핵심 흐름

```text
ESP32 센서 또는 수동 신호 입력
→ 규칙 기반·의사결정나무·랜덤 포레스트 비교
→ 고위험 안전 임계값 적용
→ 개별 판단 근거 출력
→ 관리자 최종 확인
→ 낮음: 기록 / 보통: 지역 매칭 / 높음: 전문 대응
→ 500m → 1km → 2km 탐색
→ 미션 수락 전 위치 비공개
→ 결과 보고·포인트·배지·감사 로그
```

## 새 디자인에서 반영한 UX 원칙

- Linear·Vercel 계열의 미니멀한 정보 구조
- 의미 없는 그라데이션과 동일한 3열 카드 반복 제거
- 비대칭 Bento Grid와 넉넉한 여백
- 얇은 테두리와 미세한 Hover·Active 인터랙션
- 각 화면에 하나의 강한 Primary CTA
- Loading Skeleton, Empty, Error, Disabled 상태
- 모바일 44px 이상 터치 영역
- 입력 예시·도움말·실시간 오류 영역
- 데모 초기화 2차 확인
- 미션 거절 후 Undo
- 미션 수락 전 생활권만 공개

## 실행

Node.js 20 이상이 필요합니다.

```powershell
npm run build
npm start
```

브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:3000
```

개발 중 자동 재시작:

```powershell
npm run dev
```

## Render 배포

저장소 최상위에 파일을 올린 뒤 Render에서 Blueprint를 선택하면 `render.yaml`이 자동으로 적용됩니다.

```text
Build Command: npm run build
Start Command: npm start
Health Check: /api/health
```

무료 Render에서는 상태 파일을 `/tmp/hondibom-state.json`에 저장하므로 재시작 또는 재배포 시 데모 상태가 초기화될 수 있습니다. 해커톤 시연에는 사용할 수 있지만 실제 서비스에는 영구 데이터베이스와 사용자 인증이 필요합니다.

## ESP32 연동

`examples/esp32_hondibom.ino`에 다음 장치의 전송 예제가 있습니다.

- ESP32-DevKitC V4
- HLK-LD2410C
- AMS39NO 도어 센서
- SHT31
- 안부 확인 버튼
- SOS 버튼

장치가 보내는 JSON 예시:

```json
{
  "presenceDetected": false,
  "doorOpened": false,
  "checkinPressed": false,
  "sosPressed": false,
  "temperatureC": 31.4,
  "humidity": 72
}
```

전송 주소:

```text
POST /api/devices/HB-ESP32-01/telemetry
```

## 주요 폴더

```text
hondibom_js_redesign/
├─ server.js
├─ package.json
├─ render.yaml
├─ scripts/train-model.js
├─ src/
│  ├─ ml.js
│  ├─ seed.js
│  └─ store.js
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ examples/
│  └─ esp32_hondibom.ino
└─ data/
   ├─ model.json
   └─ metrics.json
```

## 주의

- 실제 독거노인 개인정보를 입력하지 마세요.
- 합성 데이터 성능은 실제 현장 성능이 아닙니다.
- SOS와 AI 고위험 결과는 119 자동 신고를 실행하지 않습니다.
- 실제 운영에는 로그인, 권한 관리, 암호화, 영구 DB, 현장 검증이 추가로 필요합니다.
