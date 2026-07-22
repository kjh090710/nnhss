# Flask 버전에서 JavaScript 버전으로 변경된 점

| 영역 | 이전 | 현재 |
|---|---|---|
| 서버 | Python Flask | Node.js 내장 HTTP 서버 |
| AI | scikit-learn | 직접 구현한 JavaScript CART·Random Forest |
| 저장 | SQLite | 원자적 JSON 상태 파일 |
| 화면 | 서버 템플릿 | Vanilla JavaScript SPA |
| 배포 | Gunicorn | `npm start` |
| 센서 | 수동 입력 중심 | ESP32 텔레메트리 API 포함 |
| UX 상태 | 일부 | Loading·Skeleton·Empty·Error·Undo·Confirm 전부 반영 |

외부 npm 패키지가 없어 Render 빌드가 단순하며 `npm run build`가 모델을 다시 학습합니다.
