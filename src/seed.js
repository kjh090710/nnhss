'use strict';

const RISK_STATUS = {
  low: 'monitoring',
  medium: 'waiting_admin',
  high: 'professional_review',
};

function isoNow() {
  return new Date().toISOString();
}

function seedHouseholds() {
  return [
    { id: 1, code: 'H-101', district: '노형동', maskedArea: '노형동 서부 생활권', exactAddress: '노형동 가상로 101', lat: 33.4867, lng: 126.4810, usualInactiveMinutes: 250 },
    { id: 2, code: 'H-102', district: '연동', maskedArea: '연동 북부 생활권', exactAddress: '연동 가상로 22', lat: 33.4892, lng: 126.4962, usualInactiveMinutes: 270 },
    { id: 3, code: 'H-103', district: '이도2동', maskedArea: '이도2동 중앙 생활권', exactAddress: '이도2동 가상로 37', lat: 33.4991, lng: 126.5332, usualInactiveMinutes: 235 },
    { id: 4, code: 'H-104', district: '아라동', maskedArea: '아라동 남부 생활권', exactAddress: '아라동 가상로 8', lat: 33.4758, lng: 126.5454, usualInactiveMinutes: 300 },
    { id: 5, code: 'H-105', district: '삼도1동', maskedArea: '삼도1동 동부 생활권', exactAddress: '삼도1동 가상로 15', lat: 33.5062, lng: 126.5180, usualInactiveMinutes: 255 },
    { id: 6, code: 'H-106', district: '화북동', maskedArea: '화북동 서부 생활권', exactAddress: '화북동 가상로 60', lat: 33.5186, lng: 126.5668, usualInactiveMinutes: 240 },
    { id: 7, code: 'H-107', district: '오라동', maskedArea: '오라동 중앙 생활권', exactAddress: '오라동 가상로 19', lat: 33.4956, lng: 126.5074, usualInactiveMinutes: 280 },
    { id: 8, code: 'H-108', district: '도두동', maskedArea: '도두동 해안 생활권', exactAddress: '도두동 가상로 4', lat: 33.5067, lng: 126.4669, usualInactiveMinutes: 245 },
  ];
}

function seedPartners() {
  return [
    { id: 1, name: '안심파트너 A', district: '연동', lat: 33.4903, lng: 126.4990, available: true, verified: true, completionRate: 0.96, missionFit: 0.95, points: 84, badge: '이음 파트너' },
    { id: 2, name: '안심파트너 B', district: '연동', lat: 33.4870, lng: 126.4940, available: true, verified: true, completionRate: 0.91, missionFit: 0.88, points: 42, badge: '새싹 파트너' },
    { id: 3, name: '안심파트너 C', district: '연동', lat: 33.4925, lng: 126.4975, available: true, verified: true, completionRate: 0.88, missionFit: 0.92, points: 135, badge: '안심 파트너' },
    { id: 4, name: '안심파트너 D', district: '오라동', lat: 33.4955, lng: 126.5030, available: true, verified: true, completionRate: 0.94, missionFit: 0.85, points: 210, badge: '안심 파트너' },
    { id: 5, name: '안심파트너 E', district: '오라동', lat: 33.5010, lng: 126.5070, available: true, verified: true, completionRate: 0.86, missionFit: 0.90, points: 18, badge: '새싹 파트너' },
    { id: 6, name: '안심파트너 F', district: '노형동', lat: 33.4877, lng: 126.4840, available: true, verified: true, completionRate: 0.93, missionFit: 0.86, points: 310, badge: '혼디 영웅' },
    { id: 7, name: '안심파트너 G', district: '이도2동', lat: 33.5000, lng: 126.5299, available: true, verified: true, completionRate: 0.89, missionFit: 0.91, points: 98, badge: '이음 파트너' },
    { id: 8, name: '미인증 참여자', district: '연동', lat: 33.4898, lng: 126.4950, available: true, verified: false, completionRate: 0.99, missionFit: 0.99, points: 0, badge: '미인증' },
  ];
}

function seedDevices() {
  const now = Date.now();
  return [
    {
      id: 'HB-ESP32-01', householdId: 1, board: 'ESP32-DevKitC V4', status: 'online',
      lastSeen: new Date(now - 35_000).toISOString(), firmware: '1.0.0', battery: 100,
      sensors: {
        presence: { model: 'HLK-LD2410C', value: true, state: 'ok' },
        door: { model: 'AMS39NO', value: 1, state: 'ok' },
        environment: { model: 'SHT31', temperature: 25.8, humidity: 61, state: 'ok' },
        checkin: { model: 'NO momentary button', value: true, state: 'ok' },
        sos: { model: 'NO momentary button', value: false, state: 'ok' },
      },
      counters: { doorActivity: 1, missedCheckins: 0 },
      lastMotionAt: new Date(now - 6 * 60_000).toISOString(), lastCheckinAt: new Date(now - 25 * 60_000).toISOString(),
    },
    {
      id: 'HB-ESP32-02', householdId: 2, board: 'ESP32-DevKitC V4', status: 'attention',
      lastSeen: new Date(now - 7 * 60_000).toISOString(), firmware: '1.0.0', battery: 100,
      sensors: {
        presence: { model: 'HLK-LD2410C', value: false, state: 'ok' },
        door: { model: 'AMS39NO', value: 0, state: 'ok' },
        environment: { model: 'SHT31', temperature: 31.4, humidity: 72, state: 'ok' },
        checkin: { model: 'NO momentary button', value: false, state: 'ok' },
        sos: { model: 'NO momentary button', value: false, state: 'ok' },
      },
      counters: { doorActivity: 0, missedCheckins: 1 },
      lastMotionAt: new Date(now - 370 * 60_000).toISOString(), lastCheckinAt: new Date(now - 15 * 60 * 60_000).toISOString(),
    },
    {
      id: 'HB-ESP32-03', householdId: 3, board: 'ESP32-DevKitC V4', status: 'online',
      lastSeen: new Date(now - 70_000).toISOString(), firmware: '1.0.0', battery: 100,
      sensors: {
        presence: { model: 'HLK-LD2410C', value: false, state: 'ok' },
        door: { model: 'AMS39NO', value: 0, state: 'ok' },
        environment: { model: 'SHT31', temperature: 30.2, humidity: 68, state: 'ok' },
        checkin: { model: 'NO momentary button', value: false, state: 'ok' },
        sos: { model: 'NO momentary button', value: false, state: 'ok' },
      },
      counters: { doorActivity: 0, missedCheckins: 3 },
      lastMotionAt: new Date(now - 680 * 60_000).toISOString(), lastCheckinAt: new Date(now - 27 * 60 * 60_000).toISOString(),
    },
    {
      id: 'HB-ESP32-04', householdId: 4, board: 'ESP32-DevKitC V4', status: 'offline',
      lastSeen: new Date(now - 5 * 60 * 60_000).toISOString(), firmware: '0.9.8', battery: 100,
      sensors: {
        presence: { model: 'HLK-LD2410C', value: null, state: 'offline' },
        door: { model: 'AMS39NO', value: null, state: 'offline' },
        environment: { model: 'SHT31', temperature: null, humidity: null, state: 'offline' },
        checkin: { model: 'NO momentary button', value: null, state: 'offline' },
        sos: { model: 'NO momentary button', value: null, state: 'offline' },
      },
      counters: { doorActivity: 0, missedCheckins: 0 },
      lastMotionAt: new Date(now - 320 * 60_000).toISOString(), lastCheckinAt: new Date(now - 8 * 60 * 60_000).toISOString(),
    },
  ];
}

function scenario(householdId, type, usualInactiveMinutes) {
  const scenarios = {
    low: {
      no_motion_minutes: 150, missed_checkin_count: 0, door_activity_count: 3,
      recent_contact_success: 1, repeated_alert_count: 0, usual_inactive_minutes: usualInactiveMinutes,
      sensor_reliability: 0.96, alert_hour: 2, temperature_risk: 0, previous_false_alarm_count: 1,
    },
    medium: {
      no_motion_minutes: 370, missed_checkin_count: 1, door_activity_count: 1,
      recent_contact_success: 0, repeated_alert_count: 2, usual_inactive_minutes: usualInactiveMinutes,
      sensor_reliability: 0.93, alert_hour: 14, temperature_risk: 0, previous_false_alarm_count: 0,
    },
    high: {
      no_motion_minutes: 680, missed_checkin_count: 3, door_activity_count: 0,
      recent_contact_success: 0, repeated_alert_count: 4, usual_inactive_minutes: usualInactiveMinutes,
      sensor_reliability: 0.97, alert_hour: 15, temperature_risk: 1, previous_false_alarm_count: 0,
    },
  };
  return { householdId, signals: scenarios[type] };
}

function createSeedState(analyze) {
  const households = seedHouseholds();
  const alerts = [];
  let alertId = 1;
  for (const [householdId, type] of [[5, 'low'], [2, 'medium'], [3, 'high']]) {
    const household = households.find((item) => item.id === householdId);
    const item = scenario(householdId, type, household.usualInactiveMinutes);
    const result = analyze(item.signals);
    alerts.push({
      id: alertId++, householdId, createdAt: new Date(Date.now() - (4 - alertId) * 27 * 60_000).toISOString(),
      source: 'demo', ...result, signals: item.signals,
      humanLevel: null, reviewNote: '', reviewedAt: null, status: RISK_STATUS[result.riskLevel],
    });
  }

  return {
    version: 1,
    counters: { alert: alertId, mission: 1, offer: 1, audit: 4 },
    households,
    partners: seedPartners(),
    devices: seedDevices(),
    alerts,
    missions: [],
    offers: [],
    audit: [
      { id: 1, createdAt: isoNow(), actor: 'system', action: 'state_initialized', detail: '가상 데이터와 센서 장치를 초기화함' },
      { id: 2, createdAt: isoNow(), actor: 'model', action: 'model_loaded', detail: 'JavaScript 랜덤 포레스트 모델을 불러옴' },
      { id: 3, createdAt: isoNow(), actor: 'system', action: 'privacy_mode', detail: '상세 주소 단계적 공개 정책 적용' },
    ],
  };
}

module.exports = { createSeedState, RISK_STATUS, isoNow };
