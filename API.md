# 혼디봄 API 요약

## 상태

```text
GET /api/health
GET /api/bootstrap?partnerId=1
GET /api/metrics
```

## AI 분석

```text
POST /api/analyze
GET /api/alerts/:alertId
POST /api/alerts/:alertId/review
```

## 미션

```text
POST /api/alerts/:alertId/mission
POST /api/missions/:missionId/expand
POST /api/offers/:offerId/accept
POST /api/offers/:offerId/decline
POST /api/offers/:offerId/restore
POST /api/missions/:missionId/complete
```

## 파트너와 ESP32

```text
POST /api/partners/:partnerId/availability
POST /api/devices/:deviceId/telemetry
```

## 데모

```text
POST /api/reset
```
