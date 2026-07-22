'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { analyze, FEATURES } = require('./src/ml');
const { JsonStore } = require('./src/store');
const { createSeedState, RISK_STATUS, isoNow } = require('./src/seed');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const MODEL_FILE = path.join(ROOT, 'data', 'model.json');
const METRICS_FILE = path.join(ROOT, 'data', 'metrics.json');
const STATE_FILE = process.env.STATE_PATH || path.join(ROOT, 'data', 'state.json');
const PORT = Number(process.env.PORT || 3000);

if (!fs.existsSync(MODEL_FILE) || !fs.existsSync(METRICS_FILE)) {
  console.error('모델 파일이 없습니다. 먼저 npm run build:model을 실행해 주세요.');
  process.exit(1);
}

const model = JSON.parse(fs.readFileSync(MODEL_FILE, 'utf8'));
const metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
const runAnalysis = (signals) => analyze(model, signals);
const store = new JsonStore(STATE_FILE, () => createSeedState(runAnalysis));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const RISK_ORDER = { low: 1, medium: 2, high: 3 };
const RESOLVED_STATUS = new Set(['resolved', 'cancelled']);

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function error(res, status, message, details = undefined) {
  json(res, status, { error: message, ...(details ? { details } : {}) });
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        reject(Object.assign(new Error('요청 데이터가 너무 큽니다.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        reject(Object.assign(new Error('JSON 형식을 확인해 주세요.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function audit(state, actor, action, detail) {
  const item = { id: state.counters.audit++, createdAt: isoNow(), actor, action, detail };
  state.audit.unshift(item);
  state.audit = state.audit.slice(0, 200);
  return item;
}

function nextId(state, key) {
  const id = state.counters[key];
  state.counters[key] += 1;
  return id;
}

function householdFor(state, id) {
  return state.households.find((item) => item.id === Number(id));
}

function partnerFor(state, id) {
  return state.partners.find((item) => item.id === Number(id));
}

function alertFor(state, id) {
  return state.alerts.find((item) => item.id === Number(id));
}

function missionFor(state, id) {
  return state.missions.find((item) => item.id === Number(id));
}

function offerFor(state, id) {
  return state.offers.find((item) => item.id === Number(id));
}

function validateSignals(body) {
  const ranges = {
    no_motion_minutes: [0, 1440],
    missed_checkin_count: [0, 10],
    door_activity_count: [0, 30],
    recent_contact_success: [0, 1],
    repeated_alert_count: [0, 20],
    usual_inactive_minutes: [30, 900],
    sensor_reliability: [0.1, 1],
    alert_hour: [0, 23],
    temperature_risk: [0, 2],
    previous_false_alarm_count: [0, 20],
  };
  const values = {};
  const fieldErrors = {};
  for (const feature of FEATURES) {
    const value = Number(body[feature]);
    const [min, max] = ranges[feature];
    if (!Number.isFinite(value)) fieldErrors[feature] = '숫자 값을 입력해 주세요.';
    else if (value < min || value > max) fieldErrors[feature] = `${min} 이상 ${max} 이하로 입력해 주세요.`;
    else values[feature] = value;
  }
  return { values, fieldErrors, valid: Object.keys(fieldErrors).length === 0 };
}

function createAlert(state, householdId, signals, source = 'manual', overrides = {}) {
  const result = runAnalysis(signals);
  const item = {
    id: nextId(state, 'alert'),
    householdId: Number(householdId),
    createdAt: isoNow(),
    source,
    ...result,
    signals,
    humanLevel: null,
    reviewNote: '',
    reviewedAt: null,
    status: RISK_STATUS[result.riskLevel],
    ...overrides,
  };
  state.alerts.unshift(item);
  audit(state, source === 'device' ? 'device' : 'admin', 'alert_created', `경보 #${item.id} · ${item.riskLevel}`);
  return item;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const radius = 6_371_000;
  const toRad = (value) => (value * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function matchingScore(distance, radius, partner) {
  const distanceScore = Math.max(0, 1 - distance / Math.max(radius, 1));
  const availabilityScore = partner.available ? 1 : 0;
  return distanceScore * 0.45 + availabilityScore * 0.30 + partner.completionRate * 0.15 + partner.missionFit * 0.10;
}

function createOffers(state, mission, radius) {
  const alert = alertFor(state, mission.alertId);
  const household = householdFor(state, alert.householdId);
  const previousPartnerIds = new Set(state.offers.filter((item) => item.missionId === mission.id).map((item) => item.partnerId));
  const candidates = state.partners
    .filter((partner) => partner.available && partner.verified && !previousPartnerIds.has(partner.id))
    .map((partner) => {
      const distance = haversineMeters(household.lat, household.lng, partner.lat, partner.lng);
      return { partner, distance, score: matchingScore(distance, radius, partner) };
    })
    .filter((item) => item.distance <= radius)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const offers = candidates.map((candidate) => {
    const offer = {
      id: nextId(state, 'offer'),
      missionId: mission.id,
      partnerId: candidate.partner.id,
      distanceM: candidate.distance,
      matchScore: candidate.score,
      status: 'offered',
      createdAt: isoNow(),
      respondedAt: null,
    };
    state.offers.push(offer);
    return offer;
  });
  audit(state, 'matching-engine', 'matching_run', `미션 #${mission.id} · ${radius}m · ${offers.length}명 제안`);
  return offers;
}

function badgeFor(points) {
  if (points >= 250) return '혼디 영웅';
  if (points >= 120) return '안심 파트너';
  if (points >= 50) return '이음 파트너';
  return '새싹 파트너';
}

function joinAlert(state, alert) {
  const household = householdFor(state, alert.householdId);
  const mission = state.missions.find((item) => item.alertId === alert.id && item.status !== 'cancelled') || null;
  return {
    ...alert,
    effectiveLevel: alert.humanLevel || alert.riskLevel,
    household: household ? {
      id: household.id, code: household.code, district: household.district,
      maskedArea: household.maskedArea, exactAddress: household.exactAddress,
      lat: household.lat, lng: household.lng,
    } : null,
    mission,
  };
}

function joinMission(state, mission, viewerPartnerId = null) {
  const alert = alertFor(state, mission.alertId);
  const household = alert ? householdFor(state, alert.householdId) : null;
  const acceptedPartner = mission.acceptedPartnerId ? partnerFor(state, mission.acceptedPartnerId) : null;
  const offers = state.offers
    .filter((item) => item.missionId === mission.id)
    .map((offer) => ({ ...offer, partner: partnerFor(state, offer.partnerId) }))
    .sort((a, b) => b.matchScore - a.matchScore);
  const viewerOffer = viewerPartnerId ? offers.find((item) => item.partnerId === Number(viewerPartnerId)) || null : null;
  const maySeeExact = Boolean(viewerOffer && viewerOffer.status === 'accepted');
  return {
    ...mission,
    alert: alert ? { id: alert.id, riskLevel: alert.riskLevel, probability: alert.probability, reasons: alert.reasons, status: alert.status } : null,
    household: household ? {
      id: household.id, code: household.code, district: household.district,
      maskedArea: household.maskedArea,
      exactAddress: maySeeExact || !viewerPartnerId ? household.exactAddress : null,
    } : null,
    acceptedPartner,
    offers,
    viewerOffer,
  };
}

function dashboardPayload(state, partnerId = 1) {
  const alerts = state.alerts.map((item) => joinAlert(state, item)).sort((a, b) => {
    const risk = RISK_ORDER[b.effectiveLevel] - RISK_ORDER[a.effectiveLevel];
    return risk || new Date(b.createdAt) - new Date(a.createdAt);
  });
  const counts = { low: 0, medium: 0, high: 0 };
  alerts.forEach((item) => { counts[item.effectiveLevel] += 1; });
  return {
    generatedAt: isoNow(),
    metrics,
    summary: {
      totalHouseholds: state.households.length,
      activeAlerts: alerts.filter((item) => !RESOLVED_STATUS.has(item.status)).length,
      counts,
      onlineDevices: state.devices.filter((item) => item.status === 'online').length,
      attentionDevices: state.devices.filter((item) => item.status !== 'online').length,
    },
    households: state.households.map(({ exactAddress, ...item }) => item),
    alerts,
    missions: state.missions.map((item) => joinMission(state, item)),
    partners: state.partners.filter((item) => item.verified),
    selectedPartner: partnerFor(state, partnerId) || state.partners.find((item) => item.verified),
    partnerMissions: state.missions.map((item) => joinMission(state, item, partnerId)).filter((item) => item.viewerOffer),
    devices: state.devices.map((device) => ({ ...device, household: householdFor(state, device.householdId) })),
    audit: state.audit.slice(0, 50),
  };
}

function sensorReliability(device, payload) {
  const required = ['presenceDetected', 'doorOpened', 'temperatureC', 'humidity'];
  const valid = required.filter((key) => payload[key] !== undefined && payload[key] !== null).length / required.length;
  const rangeChecks = [
    Number(payload.temperatureC) >= -10 && Number(payload.temperatureC) <= 55,
    Number(payload.humidity) >= 0 && Number(payload.humidity) <= 100,
  ];
  const rangeScore = rangeChecks.filter(Boolean).length / rangeChecks.length;
  return Math.max(0.1, Math.min(1, valid * 0.55 + rangeScore * 0.25 + 0.20));
}

function temperatureRisk(temperature) {
  if (temperature >= 35 || temperature <= 8) return 2;
  if (temperature >= 30 || temperature <= 12) return 1;
  return 0;
}

async function routeApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/health') return json(res, 200, { status: 'ok', runtime: 'node', timestamp: isoNow() });

  if (method === 'GET' && pathname === '/api/bootstrap') {
    const partnerId = Number(url.searchParams.get('partnerId') || 1);
    return json(res, 200, dashboardPayload(store.read(), partnerId));
  }

  if (method === 'GET' && pathname === '/api/metrics') return json(res, 200, metrics);

  let match = pathname.match(/^\/api\/alerts\/(\d+)$/);
  if (method === 'GET' && match) {
    const state = store.read();
    const item = alertFor(state, match[1]);
    if (!item) return error(res, 404, '경보를 찾을 수 없습니다. 대시보드에서 다시 선택해 주세요.');
    return json(res, 200, joinAlert(state, item));
  }

  if (method === 'POST' && pathname === '/api/analyze') {
    const body = await readBody(req);
    const state = store.read();
    const household = householdFor(state, body.householdId);
    if (!household) return error(res, 404, '대상 가구를 찾을 수 없습니다. 가구를 다시 선택해 주세요.');
    const validation = validateSignals(body);
    if (!validation.valid) return error(res, 422, '입력값을 수정한 뒤 다시 분석해 주세요.', { fieldErrors: validation.fieldErrors });
    const item = store.update((draft) => createAlert(draft, household.id, validation.values, 'manual'));
    return json(res, 201, joinAlert(store.read(), item));
  }

  match = pathname.match(/^\/api\/alerts\/(\d+)\/review$/);
  if (method === 'POST' && match) {
    const body = await readBody(req);
    const level = body.level;
    const note = String(body.note || '').trim();
    if (!['low', 'medium', 'high'].includes(level)) return error(res, 422, '관리자 판단 단계를 선택해 주세요.');
    try {
      const updated = store.update((state) => {
        const item = alertFor(state, match[1]);
        if (!item) throw Object.assign(new Error('경보를 찾을 수 없습니다.'), { status: 404 });
        if (item.riskLevel === 'high' && level !== 'high' && !note) {
          throw Object.assign(new Error('AI 고위험 결과를 낮추려면 판단 근거를 입력해 주세요.'), { status: 422 });
        }
        item.humanLevel = level;
        item.reviewNote = note;
        item.reviewedAt = isoNow();
        item.status = level === 'low' ? 'reviewed_low' : level === 'medium' ? 'reviewed_medium' : 'professional_review';
        audit(state, 'admin', 'human_review', `경보 #${item.id} · ${level} · ${note || 'AI 권고 수용'}`);
        return item;
      });
      return json(res, 200, joinAlert(store.read(), updated));
    } catch (cause) {
      return error(res, cause.status || 500, cause.message);
    }
  }

  match = pathname.match(/^\/api\/alerts\/(\d+)\/mission$/);
  if (method === 'POST' && match) {
    try {
      const result = store.update((state) => {
        const item = alertFor(state, match[1]);
        if (!item) throw Object.assign(new Error('경보를 찾을 수 없습니다.'), { status: 404 });
        if (!item.humanLevel) throw Object.assign(new Error('먼저 관리자 판단을 저장해 주세요.'), { status: 409 });
        if (item.humanLevel !== 'medium') throw Object.assign(new Error('안심파트너 연결은 관리자 판단이 보통인 경보만 가능합니다.'), { status: 409 });
        const existing = state.missions.find((mission) => mission.alertId === item.id && !['completed', 'cancelled', 'returned_to_admin'].includes(mission.status));
        if (existing) throw Object.assign(new Error('이미 진행 중인 미션이 있습니다.'), { status: 409 });
        const mission = {
          id: nextId(state, 'mission'), alertId: item.id, missionType: '비대면 1차 안전 확인',
          radiusM: 500, status: 'offered', createdAt: isoNow(), acceptedPartnerId: null,
          acceptedAt: null, result: null, completedAt: null, pointsAwarded: 0,
        };
        state.missions.push(mission);
        const offers = createOffers(state, mission, 500);
        if (!offers.length) mission.status = 'no_candidate';
        item.status = 'mission_offered';
        audit(state, 'admin', 'mission_created', `경보 #${item.id} · 미션 #${mission.id}`);
        return { mission, offers };
      });
      return json(res, 201, { ...joinMission(store.read(), result.mission), message: `500m 이내 인증 파트너 ${result.offers.length}명에게 제안했습니다.` });
    } catch (cause) {
      return error(res, cause.status || 500, cause.message);
    }
  }

  match = pathname.match(/^\/api\/missions\/(\d+)\/expand$/);
  if (method === 'POST' && match) {
    try {
      const result = store.update((state) => {
        const mission = missionFor(state, match[1]);
        if (!mission) throw Object.assign(new Error('미션을 찾을 수 없습니다.'), { status: 404 });
        if (!['offered', 'no_candidate'].includes(mission.status)) throw Object.assign(new Error('현재 상태에서는 탐색 범위를 확대할 수 없습니다.'), { status: 409 });
        state.offers.filter((item) => item.missionId === mission.id && item.status === 'offered').forEach((item) => {
          item.status = 'expired'; item.respondedAt = isoNow();
        });
        const nextRadius = mission.radiusM === 500 ? 1000 : mission.radiusM === 1000 ? 2000 : null;
        if (!nextRadius) {
          mission.status = 'returned_to_admin';
          const alert = alertFor(state, mission.alertId);
          alert.status = 'returned_to_admin';
          audit(state, 'matching-engine', 'mission_returned', `미션 #${mission.id} · 2km 내 수락자 없음`);
          return { mission, returned: true, offers: [] };
        }
        mission.radiusM = nextRadius;
        mission.status = 'offered';
        const offers = createOffers(state, mission, nextRadius);
        if (!offers.length) mission.status = 'no_candidate';
        return { mission, returned: false, offers };
      });
      return json(res, 200, { ...joinMission(store.read(), result.mission), returned: result.returned, message: result.returned ? '2km까지 수락자가 없어 관리자에게 반환했습니다.' : `${result.mission.radiusM}m로 확대해 ${result.offers.length}명에게 새로 제안했습니다.` });
    } catch (cause) {
      return error(res, cause.status || 500, cause.message);
    }
  }

  match = pathname.match(/^\/api\/offers\/(\d+)\/(accept|decline|restore)$/);
  if (method === 'POST' && match) {
    const action = match[2];
    try {
      const result = store.update((state) => {
        const offer = offerFor(state, match[1]);
        if (!offer) throw Object.assign(new Error('미션 제안을 찾을 수 없습니다.'), { status: 404 });
        const mission = missionFor(state, offer.missionId);
        const partner = partnerFor(state, offer.partnerId);
        if (action === 'accept') {
          if (offer.status !== 'offered' || !['offered', 'no_candidate'].includes(mission.status)) throw Object.assign(new Error('이미 처리되었거나 다른 파트너가 수락한 미션입니다.'), { status: 409 });
          if (!partner.verified || !partner.available) throw Object.assign(new Error('현재 참여 가능한 인증 파트너가 아닙니다.'), { status: 403 });
          offer.status = 'accepted'; offer.respondedAt = isoNow();
          state.offers.filter((item) => item.missionId === mission.id && item.id !== offer.id && item.status === 'offered').forEach((item) => { item.status = 'expired'; item.respondedAt = isoNow(); });
          mission.status = 'accepted'; mission.acceptedPartnerId = partner.id; mission.acceptedAt = isoNow();
          alertFor(state, mission.alertId).status = 'checking';
          audit(state, `partner:${partner.id}`, 'mission_accepted', `미션 #${mission.id} 수락 · 상세 가상 주소 공개`);
        } else if (action === 'decline') {
          if (offer.status !== 'offered') throw Object.assign(new Error('현재 제안은 거절할 수 없는 상태입니다.'), { status: 409 });
          offer.status = 'declined'; offer.respondedAt = isoNow();
          audit(state, `partner:${partner.id}`, 'offer_declined', `제안 #${offer.id} 거절`);
        } else {
          if (offer.status !== 'declined' || !['offered', 'no_candidate'].includes(mission.status)) throw Object.assign(new Error('실행 취소 가능 시간이 지났거나 미션이 이미 처리됐습니다.'), { status: 409 });
          offer.status = 'offered'; offer.respondedAt = null;
          audit(state, `partner:${partner.id}`, 'offer_restored', `제안 #${offer.id} 거절 취소`);
        }
        return { offer, mission, partner };
      });
      return json(res, 200, { offer: result.offer, mission: joinMission(store.read(), result.mission, result.partner.id), message: action === 'accept' ? '미션을 수락했습니다. 상세 가상 주소가 공개됩니다.' : action === 'decline' ? '미션 제안을 거절했습니다.' : '거절을 취소했습니다.' });
    } catch (cause) {
      return error(res, cause.status || 500, cause.message);
    }
  }

  match = pathname.match(/^\/api\/missions\/(\d+)\/complete$/);
  if (method === 'POST' && match) {
    const body = await readBody(req);
    const resultType = body.result;
    if (!['safe', 'follow_up', 'emergency_suspected'].includes(resultType)) return error(res, 422, '수행 결과를 선택해 주세요.');
    try {
      const result = store.update((state) => {
        const mission = missionFor(state, match[1]);
        if (!mission) throw Object.assign(new Error('미션을 찾을 수 없습니다.'), { status: 404 });
        if (mission.status !== 'accepted' || !mission.acceptedPartnerId) throw Object.assign(new Error('수락된 미션만 결과를 제출할 수 있습니다.'), { status: 409 });
        const points = { safe: 15, follow_up: 20, emergency_suspected: 30 }[resultType];
        const status = { safe: 'resolved', follow_up: 'needs_follow_up', emergency_suspected: 'professional_review' }[resultType];
        mission.status = 'completed'; mission.result = resultType; mission.completedAt = isoNow(); mission.pointsAwarded = points;
        alertFor(state, mission.alertId).status = status;
        const partner = partnerFor(state, mission.acceptedPartnerId);
        partner.points += points; partner.badge = badgeFor(partner.points);
        audit(state, `partner:${partner.id}`, 'mission_completed', `미션 #${mission.id} · ${resultType} · ${points}P`);
        return { mission, partner, points };
      });
      return json(res, 200, { mission: joinMission(store.read(), result.mission, result.partner.id), partner: result.partner, points: result.points });
    } catch (cause) {
      return error(res, cause.status || 500, cause.message);
    }
  }

  match = pathname.match(/^\/api\/partners\/(\d+)\/availability$/);
  if (method === 'POST' && match) {
    const body = await readBody(req);
    try {
      const partner = store.update((state) => {
        const item = partnerFor(state, match[1]);
        if (!item || !item.verified) throw Object.assign(new Error('인증된 파트너를 찾을 수 없습니다.'), { status: 404 });
        item.available = Boolean(body.available);
        audit(state, `partner:${item.id}`, 'availability_changed', `참여 가능 ${item.available}`);
        return item;
      });
      return json(res, 200, partner);
    } catch (cause) {
      return error(res, cause.status || 500, cause.message);
    }
  }

  match = pathname.match(/^\/api\/devices\/([^/]+)\/telemetry$/);
  if (method === 'POST' && match) {
    const requiredDeviceKey = process.env.DEVICE_API_KEY;
    if (requiredDeviceKey && req.headers['x-device-key'] !== requiredDeviceKey) {
      return error(res, 401, '장치 인증 키가 올바르지 않습니다. X-Device-Key 헤더를 확인해 주세요.');
    }
    const body = await readBody(req);
    const temperatureC = Number(body.temperatureC);
    const humidity = Number(body.humidity);
    if (!Number.isFinite(temperatureC) || temperatureC < -10 || temperatureC > 55) {
      return error(res, 422, 'temperatureC는 -10 이상 55 이하의 숫자로 보내 주세요.');
    }
    if (!Number.isFinite(humidity) || humidity < 0 || humidity > 100) {
      return error(res, 422, 'humidity는 0 이상 100 이하의 숫자로 보내 주세요.');
    }
    try {
      const result = store.update((state) => {
        const device = state.devices.find((item) => item.id === decodeURIComponent(match[1]));
        if (!device) throw Object.assign(new Error('등록된 ESP32 장치를 찾을 수 없습니다.'), { status: 404 });
        const household = householdFor(state, device.householdId);
        const timestamp = body.timestamp ? new Date(body.timestamp) : new Date();
        if (Number.isNaN(timestamp.getTime())) throw Object.assign(new Error('timestamp는 ISO 날짜 형식으로 보내 주세요.'), { status: 422 });
        const reliability = sensorReliability(device, body);
        device.lastSeen = timestamp.toISOString();
        device.status = reliability < 0.65 ? 'attention' : 'online';
        if (body.presenceDetected === true) device.lastMotionAt = timestamp.toISOString();
        if (body.doorOpened === true) device.counters.doorActivity += 1;
        if (body.checkinPressed === true) {
          device.lastCheckinAt = timestamp.toISOString();
          device.counters.missedCheckins = 0;
        }
        device.sensors.presence.value = Boolean(body.presenceDetected);
        device.sensors.door.value = Boolean(body.doorOpened);
        device.sensors.environment.temperature = temperatureC;
        device.sensors.environment.humidity = humidity;
        device.sensors.checkin.value = Boolean(body.checkinPressed);
        device.sensors.sos.value = Boolean(body.sosPressed);
        const noMotionMinutes = Math.max(0, Math.round((timestamp - new Date(device.lastMotionAt)) / 60_000));
        const recentAlerts = state.alerts.filter((item) => item.householdId === household.id && Date.now() - new Date(item.createdAt).getTime() <= 7 * 86400_000).length;
        const previousFalseAlarms = state.alerts.filter((item) => item.householdId === household.id && item.status === 'resolved').length;
        const signals = {
          no_motion_minutes: noMotionMinutes,
          missed_checkin_count: device.counters.missedCheckins,
          door_activity_count: device.counters.doorActivity,
          recent_contact_success: body.checkinPressed === true || Date.now() - new Date(device.lastCheckinAt).getTime() < 12 * 3600_000 ? 1 : 0,
          repeated_alert_count: recentAlerts,
          usual_inactive_minutes: household.usualInactiveMinutes,
          sensor_reliability: reliability,
          alert_hour: (timestamp.getUTCHours() + 9) % 24,
          temperature_risk: temperatureRisk(temperatureC),
          previous_false_alarm_count: previousFalseAlarms,
        };
        let alert = null;
        if (body.sosPressed === true) {
          alert = createAlert(state, household.id, signals, 'sos', {
            riskLevel: 'high', probability: 1, reasons: ['SOS 버튼 3초 이상 입력'],
            humanLevel: 'high', reviewNote: '사용자 직접 도움 요청', reviewedAt: isoNow(), status: 'professional_review',
          });
        } else {
          const analysis = runAnalysis(signals);
          if (analysis.riskLevel !== 'low') alert = createAlert(state, household.id, signals, 'device');
        }
        audit(state, `device:${device.id}`, 'telemetry_received', `신뢰도 ${(reliability * 100).toFixed(0)}% · ${alert ? `경보 #${alert.id}` : '경보 없음'}`);
        return { device, signals, alert };
      });
      return json(res, 200, result);
    } catch (cause) {
      return error(res, cause.status || 500, cause.message);
    }
  }

  if (method === 'POST' && pathname === '/api/reset') {
    store.reset();
    return json(res, 200, { ok: true, message: '데모 상태를 초기화했습니다.' });
  }

  return false;
}

function serveStatic(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === '/') requested = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return error(res, 403, '허용되지 않은 경로입니다.');
  let target = filePath;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(target, (readError, data) => {
    if (readError) return error(res, 404, '페이지를 찾을 수 없습니다.');
    const extension = path.extname(target).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[extension] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await routeApi(req, res, url);
      if (handled === false && !res.writableEnded) error(res, 404, '요청한 API를 찾을 수 없습니다.');
      return;
    }
    serveStatic(req, res, url);
  } catch (cause) {
    console.error(cause);
    if (!res.writableEnded) error(res, cause.status || 500, cause.message || '서버 오류가 발생했습니다.');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`혼디봄 JS 서버: http://localhost:${PORT}`);
  console.log(`상태 저장: ${STATE_FILE}`);
});
