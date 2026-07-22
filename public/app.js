'use strict';

const app = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const toastRegion = document.getElementById('toastRegion');

const ui = {
  data: null,
  partnerId: Number(localStorage.getItem('hondibom.partnerId') || 1),
  selectedMissionId: null,
  selectedDeviceId: null,
  analysisResult: null,
  loading: false,
};

const riskKo = { low: '낮음', medium: '보통', high: '높음' };
const statusKo = {
  monitoring: '관찰 중', waiting_admin: '관리자 확인 대기', professional_review: '전문 대응 검토',
  reviewed_low: '관찰 확정', reviewed_medium: '지역 확인 확정', mission_offered: '미션 제안 중',
  no_candidate: '후보 없음', accepted: '수락 완료', checking: '확인 중', completed: '완료',
  resolved: '해결 완료', needs_follow_up: '추가 확인 필요', returned_to_admin: '관리자 반환',
  offered: '제안됨', declined: '거절됨', expired: '만료됨', cancelled: '취소됨',
};
const resultKo = { safe: '이상 없음', follow_up: '추가 확인 필요', emergency_suspected: '긴급 상황 의심' };
const featureLabels = {
  no_motion_minutes: '움직임 없음 시간', missed_checkin_count: '정기 연락 미응답', door_activity_count: '출입문 활동',
  recent_contact_success: '최근 연락 성공', repeated_alert_count: '반복 경보', usual_inactive_minutes: '평소 비활동 시간',
  sensor_reliability: '센서 신뢰도', alert_hour: '경보 발생 시각', temperature_risk: '온도 위험', previous_false_alarm_count: '과거 오작동',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function percent(value, digits = 0) {
  const number = Number(value || 0) * 100;
  return `${number.toFixed(digits)}%`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(Number(value || 0));
}

function relativeTime(dateString) {
  const delta = Date.now() - new Date(dateString).getTime();
  if (!Number.isFinite(delta)) return '시간 정보 없음';
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function dateTime(dateString) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(dateString));
}

function routeInfo() {
  const clean = (location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [route = 'dashboard', id] = clean.split('/');
  return { route, id: id ? Number(id) : null };
}

function setActiveNav(route) {
  const navRoute = route === 'alert' ? 'dashboard' : route;
  document.body.dataset.route = navRoute;
  document.querySelectorAll('[data-route]').forEach((link) => {
    const active = link.dataset.route === navRoute;
    link.classList.toggle('active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
      link.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function pageHeader({ eyebrow, title, mutedTitle = '', description, actions = '' }) {
  return `
    <header class="page-header">
      <div class="page-kicker"><i></i><span>${escapeHtml(eyebrow)}</span></div>
      <div class="page-header-row">
        <div class="page-header-copy">
          <h1>${escapeHtml(title)}${mutedTitle ? `<span>${escapeHtml(mutedTitle)}</span>` : ''}</h1>
          <p>${escapeHtml(description)}</p>
        </div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ''}
      </div>
    </header>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    error.status = response.status;
    error.details = payload.details;
    throw error;
  }
  return payload;
}

function showToast(message, { actionLabel = '', action = null, duration = 4200 } = {}) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<p>${escapeHtml(message)}</p>${actionLabel ? `<button type="button">${escapeHtml(actionLabel)}</button>` : '<span></span>'}`;
  toastRegion.appendChild(node);
  const remove = () => node.remove();
  const timer = setTimeout(remove, duration);
  if (actionLabel && action) {
    node.querySelector('button').addEventListener('click', async () => {
      clearTimeout(timer);
      try { await action(); } finally { remove(); }
    });
  }
}

function showErrorPage(message) {
  app.innerHTML = `
    <section class="card error-state">
      <span class="state-icon">${icon('alert')}</span>
      <h3>화면을 불러오지 못했습니다.</h3>
      <p>${escapeHtml(message)} 서버가 켜져 있는지 확인한 뒤 다시 시도해 주세요.</p>
      <button class="button secondary" data-action="retry-load">다시 불러오기</button>
    </section>`;
}

function openConfirm({ title, description, confirmLabel = '확인', danger = false, typedText = '', onConfirm }) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" role="presentation" data-action="close-modal">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div><h2 id="modalTitle">${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
          <button class="icon-button" type="button" data-action="close-modal" aria-label="닫기">${icon('close')}</button>
        </div>
        <div class="modal-body">
          ${typedText ? `
            <div class="confirm-text">계속하려면 아래에 <strong>${escapeHtml(typedText)}</strong>를 입력하세요.</div>
            <label class="field" style="margin-top:12px">
              <span class="field-label">확인 문구</span>
              <input id="confirmTypedInput" autocomplete="off" placeholder="${escapeHtml(typedText)}">
              <span class="field-error" id="confirmTypedError">문구가 일치하지 않습니다.</span>
            </label>` : ''}
        </div>
        <div class="modal-actions">
          <button class="button secondary" type="button" data-action="close-modal">취소</button>
          <button class="button ${danger ? 'danger' : 'primary'}" type="button" id="modalConfirmButton">${escapeHtml(confirmLabel)}</button>
        </div>
      </section>
    </div>`;
  const confirmButton = document.getElementById('modalConfirmButton');
  confirmButton.addEventListener('click', async () => {
    if (typedText) {
      const input = document.getElementById('confirmTypedInput');
      const errorNode = document.getElementById('confirmTypedError');
      if (input.value.trim() !== typedText) {
        input.classList.add('invalid');
        errorNode.classList.add('visible');
        input.focus();
        return;
      }
    }
    confirmButton.disabled = true;
    confirmButton.classList.add('loading');
    try {
      await onConfirm();
      closeModal();
    } catch (error) {
      showToast(error.message);
      confirmButton.disabled = false;
      confirmButton.classList.remove('loading');
    }
  });
  setTimeout(() => document.getElementById('confirmTypedInput')?.focus(), 30);
}

function closeModal() {
  modalRoot.innerHTML = '';
}

async function loadData({ quiet = false } = {}) {
  if (!quiet) {
    app.innerHTML = `
      <div class="page-skeleton" aria-label="화면 불러오는 중">
        <div class="skeleton-line w-30"></div><div class="skeleton-line title"></div>
        <div class="skeleton-grid"><div></div><div></div><div></div></div><div class="skeleton-panel"></div>
      </div>`;
  }
  try {
    ui.data = await api(`/api/bootstrap?partnerId=${ui.partnerId}`);
    return ui.data;
  } catch (error) {
    if (!quiet) showErrorPage(error.message);
    throw error;
  }
}

async function refreshAndRender() {
  await loadData({ quiet: true });
  renderRoute();
}

function dashboardView(data) {
  const rf = data.metrics.models.randomForest;
  const alerts = data.alerts.slice(0, 8);
  const missions = data.missions.slice().sort((a, b) => b.id - a.id).slice(0, 4);
  return `
    ${pageHeader({
      eyebrow: '2026 제주 SW 인재양성 해커톤',
      title: '운영 현황을 한눈에,',
      mutedTitle: '대응은 필요한 곳부터.',
      description: '센서·AI·관리자 판단·지역 연결을 하나의 흐름으로 관리합니다. 실제 개인정보 대신 가상 생활권과 합성 데이터를 사용합니다.',
      actions: `<a class="button primary" href="#/analyze">${icon('plus')} 새 신호 분석</a>`,
    })}

    <section class="bento-dashboard">
      <article class="card pulse-card">
        <div class="operation-pulse">
          <div class="pulse-lead">
            <span>오늘의 운영 상태</span>
            <strong>${data.summary.activeAlerts}건을<br>확인 중입니다.</strong>
            <p>${data.summary.totalHouseholds}개 가상 가구 · ESP32 ${data.devices.length}대 연결</p>
          </div>
          ${['low','medium','high'].map((risk) => `
            <div class="pulse-metric">
              <span><i class="status-dot ${risk}"></i>${riskKo[risk]}</span>
              <strong>${data.summary.counts[risk]}</strong>
              <small>${risk === 'low' ? '기록·관찰' : risk === 'medium' ? '관리자 검토·연결' : '전문 대응 검토'}</small>
            </div>`).join('')}
        </div>
      </article>

      <article class="card queue-card">
        <div class="card-header">
          <div><span class="eyebrow">Priority queue</span><h2>위험 경보</h2><p>관리자 판단 단계가 있으면 AI 권고보다 우선합니다.</p></div>
          <div class="toolbar">
            <div class="search-field">${icon('search')}<input id="alertSearch" placeholder="가구 또는 지역 검색" aria-label="경보 검색"></div>
            <div class="segmented" aria-label="위험도 필터">
              <button class="segmented-button active" data-action="filter-alerts" data-risk="all">전체</button>
              <button class="segmented-button" data-action="filter-alerts" data-risk="medium">보통</button>
              <button class="segmented-button" data-action="filter-alerts" data-risk="high">높음</button>
            </div>
          </div>
        </div>
        ${alerts.length ? `
          <div class="queue-table-wrap">
            <table class="data-table" id="alertTable">
              <thead><tr><th>단계</th><th>가구</th><th>주요 근거</th><th>확률</th><th>상태</th><th></th></tr></thead>
              <tbody>
                ${alerts.map((alert) => `
                  <tr data-risk="${alert.effectiveLevel}" data-search="${escapeHtml(`${alert.household.code} ${alert.household.maskedArea} ${alert.reasons.join(' ')}`.toLowerCase())}">
                    <td><span class="risk-badge ${alert.effectiveLevel}">${riskKo[alert.effectiveLevel]}</span></td>
                    <td><a class="table-link" href="#/alert/${alert.id}">${escapeHtml(alert.household.code)}</a><span class="subtext">${escapeHtml(alert.household.maskedArea)}</span></td>
                    <td>${escapeHtml(alert.reasons.slice(0,2).join(' · '))}<span class="subtext"><span class="source-chip">${escapeHtml(alert.source)}</span> · ${relativeTime(alert.createdAt)}</span></td>
                    <td><div class="probability"><strong>${percent(alert.probability)}</strong><span class="mini-bar"><i style="width:${percent(alert.probability)}"></i></span></div></td>
                    <td><span class="status-chip">${escapeHtml(statusKo[alert.status] || alert.status)}</span></td>
                    <td><a class="icon-button" style="width:36px;min-height:36px" href="#/alert/${alert.id}" aria-label="경보 상세">${icon('arrow')}</a></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div id="alertEmptyFilter" class="empty-state hidden" style="min-height:170px"><span class="state-icon">${icon('search')}</span><h3>조건에 맞는 경보가 없습니다.</h3><p>검색어나 위험도 필터를 바꿔 보세요.</p></div>` : `
          <div class="empty-state"><span class="state-icon">${icon('bell')}</span><h3>현재 경보가 없습니다.</h3><p>센서 신호를 분석하면 위험 우선순위가 이곳에 표시됩니다.</p><a class="button secondary" href="#/analyze">신호 분석으로 이동</a></div>`}
      </article>

      <article class="card device-card">
        <div class="card-header"><div><span class="eyebrow">Device health</span><h2>ESP32 장치</h2></div><a class="text-button" href="#/devices">전체 보기</a></div>
        <div class="device-list">
          ${data.devices.slice(0,4).map((device) => `
            <a class="device-row" href="#/devices" data-device-id="${escapeHtml(device.id)}">
              <span class="device-icon">${icon('cpu')}</span>
              <span><strong>${escapeHtml(device.id)}</strong><small>${escapeHtml(device.household.code)} · ${escapeHtml(device.sensors.presence.model)}</small></span>
              <span class="device-state ${device.status}"><b>${device.status === 'online' ? '정상' : device.status === 'attention' ? '확인 필요' : '오프라인'}</b><span>${relativeTime(device.lastSeen)}</span></span>
            </a>`).join('')}
        </div>
        <div class="card-footer">온라인 ${data.summary.onlineDevices}대 · 확인 필요 ${data.summary.attentionDevices}대</div>
      </article>

      <article class="card model-card">
        <div class="card-header"><div><span class="eyebrow">Model snapshot</span><h2>JavaScript AI 모델</h2></div><a class="text-button" href="#/model">검증 보기</a></div>
        <div class="model-snapshot">
          <div class="model-main-number"><span>고위험 재현율</span><strong>${percent(rf.highRecall,1)}</strong><small>합성 테스트 데이터 기준</small></div>
          <div class="model-stat-line"><span>Macro F1</span><strong>${percent(rf.macroF1,1)}</strong></div>
          <div class="model-stat-line"><span>운영 임계값</span><strong>${data.metrics.highRiskThreshold}</strong></div>
          <div class="model-stat-line"><span>학습 데이터</span><strong>${formatNumber(data.metrics.dataset.train)}건</strong></div>
        </div>
      </article>

      <article class="card missions-card">
        <div class="card-header"><div><span class="eyebrow">Response timeline</span><h2>최근 대응 흐름</h2></div><a class="text-button" href="#/partners">파트너 화면</a></div>
        ${missions.length ? `<div class="timeline">${missions.map((mission) => `
          <div class="timeline-item"><span class="timeline-dot"></span><strong>${escapeHtml(mission.household.code)} · ${escapeHtml(mission.missionType)}</strong><p>${escapeHtml(statusKo[mission.status] || mission.status)} · 반경 ${mission.radiusM}m · ${relativeTime(mission.createdAt)}</p></div>`).join('')}</div>` : `
          <div class="empty-state" style="min-height:160px"><span class="state-icon">${icon('users')}</span><h3>아직 생성된 미션이 없습니다.</h3><p>보통 위험을 관리자가 확정하면 안심파트너 매칭을 시작할 수 있습니다.</p></div>`}
      </article>
    </section>`;
}

function scenarioValues(type) {
  const household = ui.data.households[0];
  return {
    low: { no_motion_minutes:150, missed_checkin_count:0, door_activity_count:3, recent_contact_success:1, repeated_alert_count:0, usual_inactive_minutes:household.usualInactiveMinutes, sensor_reliability:.96, alert_hour:2, temperature_risk:0, previous_false_alarm_count:1 },
    medium: { no_motion_minutes:370, missed_checkin_count:1, door_activity_count:1, recent_contact_success:0, repeated_alert_count:2, usual_inactive_minutes:household.usualInactiveMinutes, sensor_reliability:.93, alert_hour:14, temperature_risk:0, previous_false_alarm_count:0 },
    high: { no_motion_minutes:680, missed_checkin_count:3, door_activity_count:0, recent_contact_success:0, repeated_alert_count:4, usual_inactive_minutes:household.usualInactiveMinutes, sensor_reliability:.97, alert_hour:15, temperature_risk:1, previous_false_alarm_count:0 },
  }[type];
}

function numberField(name, label, value, { unit = '', min, max, step = 1, help = '' }) {
  return `
    <label class="field">
      <span class="field-label">${escapeHtml(label)}<em>${escapeHtml(min)}–${escapeHtml(max)}</em></span>
      <span class="input-with-unit"><input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}" required>${unit ? `<span>${escapeHtml(unit)}</span>` : ''}</span>
      <span class="field-help">${escapeHtml(help)}</span>
      <span class="field-error" data-error-for="${name}"></span>
    </label>`;
}

function analysisResultMarkup(result) {
  if (!result) return `
    <div class="analysis-placeholder">
      <span class="state-icon">${icon('scan')}</span>
      <h2>아직 분석하지 않았습니다.</h2>
      <p>왼쪽에서 시나리오를 선택하거나 센서 신호를 직접 입력하세요. 분석 중에는 로딩 상태가 표시되고 오류는 입력 항목 바로 아래 안내됩니다.</p>
    </div>`;
  const outputs = result.modelOutputs;
  return `
    <div class="card-header"><div><span class="eyebrow">Explainable result</span><h2>분석 결과</h2></div><span class="status-chip">경보 #${result.id}</span></div>
    <div class="result-hero">
      <span class="result-risk ${result.riskLevel}">${riskKo[result.riskLevel]}</span>
      <div><span>랜덤 포레스트 운영 확률</span><strong>${percent(result.probability)}</strong></div>
      <a class="button secondary small" href="#/alert/${result.id}">상세 검토</a>
    </div>
    <div class="probability-list">
      ${['low','medium','high'].map((risk) => `<div class="probability-row ${risk}"><span>${riskKo[risk]}</span><i><b style="width:${percent(result.probabilities[risk])}"></b></i><em>${percent(result.probabilities[risk])}</em></div>`).join('')}
    </div>
    <div class="model-compare">
      <div class="model-compare-item"><span>규칙 기반 · 기준 모델</span><strong>${riskKo[outputs.ruleBased.level]} · ${outputs.ruleBased.score}점</strong></div>
      <div class="model-compare-item"><span>의사결정나무 · 비교 모델</span><strong>${riskKo[outputs.decisionTree.level]} · ${percent(outputs.decisionTree.probabilities[outputs.decisionTree.level])}</strong></div>
      <div class="model-compare-item selected"><span>랜덤 포레스트 · 운영 모델</span><strong>${riskKo[outputs.randomForest.level]} · ${percent(outputs.randomForest.probabilities[outputs.randomForest.level])}</strong></div>
    </div>
    <div class="explanation-list">
      ${result.explanations.map((item, index) => `<div class="explanation-item"><span class="explanation-index">${String(index+1).padStart(2,'0')}</span><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span><em>${item.contribution > 0 ? `+${(item.contribution*100).toFixed(1)}%p` : '재확인'}</em></div>`).join('')}
    </div>
    <div class="inline-note">AI는 신고나 출동을 자동 결정하지 않습니다. 관리자 상세 검토에서 원본 신호와 판단 근거를 확인한 뒤 대응 단계를 저장합니다.</div>`;
}

function analyzeView(data) {
  const initial = scenarioValues('high');
  return `
    ${pageHeader({
      eyebrow: 'Sensor analysis', title: '신호를 비교하고,', mutedTitle: '판단 근거까지 남깁니다.',
      description: '10개의 AI 특성은 물리 센서값과 서버 계산값을 함께 사용합니다. 단순한 숫자 입력 대신 각 항목의 의미와 허용 범위를 표시했습니다.',
      actions: `<a class="button secondary" href="#/devices">${icon('cpu')} ESP32 시뮬레이터</a>`,
    })}
    <section class="form-layout">
      <form class="card form-card" id="analysisForm" novalidate>
        <div class="form-section">
          <div class="form-section-title"><div><h2>빠른 시나리오</h2><p>시연 상황을 불러온 뒤 값을 직접 조정할 수 있습니다.</p></div>
            <div class="segmented"><button type="button" class="segmented-button" data-action="load-scenario" data-type="low">낮음</button><button type="button" class="segmented-button" data-action="load-scenario" data-type="medium">보통</button><button type="button" class="segmented-button active" data-action="load-scenario" data-type="high">높음</button></div>
          </div>
          <label class="field full"><span class="field-label">대상 가상 가구<em>개인정보 미사용</em></span>
            <select name="householdId" required>${data.households.map((household) => `<option value="${household.id}">${escapeHtml(household.code)} · ${escapeHtml(household.maskedArea)}</option>`).join('')}</select>
            <span class="field-help">정확한 주소 대신 생활권 단위 가상 위치를 사용합니다.</span><span class="field-error" data-error-for="householdId"></span>
          </label>
        </div>
        <div class="form-section">
          <div class="form-section-title"><div><h2>활동·출입 신호</h2><p>LD2410C와 마그네틱 도어 센서에서 파생되는 값입니다.</p></div></div>
          <div class="field-grid">
            ${numberField('no_motion_minutes','움직임 없음',initial.no_motion_minutes,{unit:'분',min:0,max:1440,help:'예: 마지막 재실 감지 후 680분 경과'})}
            ${numberField('door_activity_count','출입문 활동',initial.door_activity_count,{unit:'회',min:0,max:30,help:'최근 분석 구간의 문 열림 횟수'})}
            ${numberField('usual_inactive_minutes','평소 비활동 기준',initial.usual_inactive_minutes,{unit:'분',min:30,max:900,help:'개인별 생활 패턴의 중앙값'})}
            ${numberField('repeated_alert_count','최근 반복 경보',initial.repeated_alert_count,{unit:'회',min:0,max:20,help:'최근 7일 이내 경보 누적'})}
          </div>
        </div>
        <div class="form-section">
          <div class="form-section-title"><div><h2>안부·환경·신뢰도</h2><p>버튼, SHT31, 통신 상태와 과거 기록을 결합합니다.</p></div></div>
          <div class="field-grid">
            ${numberField('missed_checkin_count','정기 연락 미응답',initial.missed_checkin_count,{unit:'회',min:0,max:10,help:'안부 버튼 또는 전화 확인 실패 횟수'})}
            <label class="field"><span class="field-label">최근 연락 결과<em>0 또는 1</em></span><select name="recent_contact_success"><option value="0" selected>확인 실패</option><option value="1">확인 성공</option></select><span class="field-help">버튼 또는 관리자 확인 결과를 반영합니다.</span><span class="field-error" data-error-for="recent_contact_success"></span></label>
            ${numberField('sensor_reliability','센서 신뢰도',initial.sensor_reliability,{unit:'0–1',min:.1,max:1,step:.01,help:'통신·응답·값 범위를 종합한 점수'})}
            ${numberField('alert_hour','발생 시각',initial.alert_hour,{unit:'시',min:0,max:23,help:'수면 시간대 등 생활 패턴 보정'})}
            <label class="field"><span class="field-label">실내 온도 위험<em>서버 계산값</em></span><select name="temperature_risk"><option value="0">정상</option><option value="1" selected>주의</option><option value="2">위험</option></select><span class="field-help">SHT31 원시 온도를 정상·주의·위험으로 단계화합니다.</span><span class="field-error" data-error-for="temperature_risk"></span></label>
            ${numberField('previous_false_alarm_count','과거 오작동',initial.previous_false_alarm_count,{unit:'회',min:0,max:20,help:'관리자가 이상 없음으로 종료한 횟수'})}
          </div>
        </div>
        <div class="form-actions"><p>분석하면 새 경보가 저장됩니다. 실제 개인정보나 실제 주소를 입력하지 마세요.</p><button class="button primary" type="submit" id="analysisSubmit">${icon('scan')} 세 모델 비교 분석</button></div>
      </form>
      <aside class="card sticky" id="analysisResultCard">${analysisResultMarkup(ui.analysisResult)}</aside>
    </section>`;
}

function signalValue(key, value) {
  if (key === 'sensor_reliability') return percent(value);
  if (key === 'recent_contact_success') return value ? '성공' : '실패';
  if (key === 'temperature_risk') return ['정상','주의','위험'][Math.round(value)] || '-';
  if (key === 'alert_hour') return `${Math.round(value)}시`;
  if (key.includes('minutes')) return `${Math.round(value)}분`;
  return `${Math.round(value)}회`;
}

function alertView(data, id) {
  const alert = data.alerts.find((item) => item.id === id);
  if (!alert) return `<section class="card error-state"><span class="state-icon">${icon('alert')}</span><h3>경보를 찾을 수 없습니다.</h3><p>데모가 초기화되었거나 이미 삭제된 경보일 수 있습니다.</p><a class="button secondary" href="#/dashboard">대시보드로 돌아가기</a></section>`;
  const mission = data.missions.find((item) => item.alertId === alert.id);
  const output = alert.modelOutputs;
  const effective = alert.effectiveLevel;
  return `
    ${pageHeader({
      eyebrow: `Alert #${alert.id} · ${dateTime(alert.createdAt)}`,
      title: alert.household.code, mutedTitle: alert.household.maskedArea,
      description: 'AI 결과, 원본 신호, 관리자 판단, 지역 매칭 과정을 한 화면에서 추적합니다.',
      actions: `<a class="button secondary" href="#/dashboard">대시보드로</a><span class="risk-badge ${effective}" style="min-height:44px;padding:0 15px">${riskKo[effective]}</span>`,
    })}
    <section class="detail-layout">
      <div class="detail-top">
        <article class="card">
          <div class="card-header"><div><span class="eyebrow">AI recommendation</span><h2>랜덤 포레스트 권고</h2></div><span class="status-chip">${escapeHtml(statusKo[alert.status] || alert.status)}</span></div>
          <div class="ai-summary">
            <div class="score-ring" style="--score:${percent(alert.probability)}"><strong>${percent(alert.probability)}</strong></div>
            <div class="ai-summary-list">
              ${['low','medium','high'].map((risk) => `<div><span>${riskKo[risk]} 확률</span><strong>${percent(alert.probabilities[risk])}</strong></div>`).join('')}
              <div><span>고위험 안전 임계값</span><strong>${output.randomForest.highThreshold}</strong></div>
            </div>
          </div>
        </article>
        <article class="card">
          <div class="card-header"><div><span class="eyebrow">Human in the loop</span><h2>관리자 최종 확인</h2><p>AI 권고를 조정할 수 있지만 고위험을 낮추려면 근거가 필요합니다.</p></div>${alert.reviewedAt ? '<span class="badge">확인 완료</span>' : ''}</div>
          <form class="review-panel" id="reviewForm">
            <label class="field"><span class="field-label">관리자 판단</span><select name="level"><option value="low" ${effective==='low'?'selected':''}>낮음 · 기록과 관찰</option><option value="medium" ${effective==='medium'?'selected':''}>보통 · 지역 1차 확인</option><option value="high" ${effective==='high'?'selected':''}>높음 · 전문 대응 검토</option></select></label>
            <label class="field"><span class="field-label">판단 메모<em>조정 시 필수</em></span><textarea name="note" placeholder="예: 문 열림 기록과 보호자 통화를 확인해 보통 단계로 조정">${escapeHtml(alert.reviewNote || '')}</textarea><span class="field-error" data-error-for="reviewNote"></span></label>
            <button class="button ${alert.reviewedAt?'secondary':'primary'}" style="width:100%;margin-top:12px" type="submit">${alert.reviewedAt?'관리자 판단 수정':'관리자 판단 저장'}</button>
            ${alert.reviewedAt ? `<div class="review-record"><span>${dateTime(alert.reviewedAt)}</span><p>${escapeHtml(alert.reviewNote || 'AI 권고를 수용했습니다.')}</p></div>` : ''}
          </form>
        </article>
      </div>

      <div class="detail-grid">
        ${[
          ['01 · 기준 모델','규칙 기반',output.ruleBased.level,`${output.ruleBased.score}점`,'사전에 정한 조건을 더해 판단합니다. 설명은 쉽지만 복합 관계를 충분히 반영하기 어렵습니다.'],
          ['02 · 비교 모델','의사결정나무',output.decisionTree.level,percent(output.decisionTree.probabilities[output.decisionTree.level]),'한 개의 나무가 질문을 순서대로 나눕니다. 구조는 명확하지만 데이터 변화에 민감합니다.'],
          ['03 · 운영 모델','랜덤 포레스트',output.randomForest.level,percent(alert.probability),'여러 나무를 종합하고 고위험 안전 임계값을 적용합니다.'],
        ].map((item,index) => `<article class="card model-tile ${index===2?'selected':''}"><span class="eyebrow">${escapeHtml(item[0])}</span><h3>${escapeHtml(item[1])}</h3><div class="model-output"><span class="risk-badge ${item[2]}">${riskKo[item[2]]}</span><strong>${escapeHtml(item[3])}</strong></div><p>${escapeHtml(item[4])}</p></article>`).join('')}
      </div>

      <div class="detail-two">
        <article class="card">
          <div class="card-header"><div><span class="eyebrow">Local explanation</span><h2>개별 판단 근거</h2><p>해당 특성을 개인 기준값으로 바꿨을 때 확률이 얼마나 변하는지 계산합니다.</p></div></div>
          <div class="explanation-list">${alert.explanations.map((item,index) => `<div class="explanation-item"><span class="explanation-index">${String(index+1).padStart(2,'0')}</span><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span><em>+${(item.contribution*100).toFixed(1)}%p</em></div>`).join('')}</div>
        </article>
        <article class="card">
          <div class="card-header"><div><span class="eyebrow">Raw signals</span><h2>원본 입력 신호</h2><p>모델 입력에는 이름·전화번호·실제 주소가 포함되지 않습니다.</p></div></div>
          <div class="signal-grid">${Object.entries(alert.signals).map(([key,value]) => `<div class="signal-item"><span>${escapeHtml(featureLabels[key])}</span><strong>${escapeHtml(signalValue(key,value))}</strong></div>`).join('')}</div>
        </article>
      </div>

      <article class="card">
        <div class="card-header"><div><span class="eyebrow">Next action</span><h2>단계별 대응</h2></div><span class="risk-badge ${effective}">${riskKo[effective]}</span></div>
        <div class="response-panel ${effective}">
          <span class="response-icon">${effective==='low'?icon('check'):effective==='medium'?icon('users'):icon('alert')}</span>
          <div><h3>${effective==='low'?'기록하고 일정 시간 뒤 다시 확인합니다.':effective==='medium'?'인증된 안심파트너에게 비대면 확인을 제안합니다.':'일반 참여자에게 연결하지 않고 전문 대응을 검토합니다.'}</h3><p>${effective==='low'?'지역 참여자에게 위치정보를 전달하지 않습니다.':effective==='medium'?'500m부터 1km, 2km 순으로 확대하며 수락 전에는 생활권만 공개합니다.':'AI나 장치가 119 신고를 자동 실행하지 않으며 관리자가 원본 신호를 확인합니다.'}</p></div>
          ${effective==='medium' && alert.humanLevel==='medium' && !mission ? `<button class="button primary" data-action="create-mission" data-alert-id="${alert.id}">500m 매칭 시작</button>` : ''}
        </div>
        ${effective==='medium' && !alert.humanLevel ? `<div class="inline-note">안심파트너 연결 전에 관리자 판단을 ‘보통’으로 저장해야 합니다.</div>` : ''}
        ${mission ? matchingMarkup(mission) : ''}
      </article>
    </section>`;
}

function matchingMarkup(mission) {
  return `
    <div class="matching-flow">
      <div class="radius-track">${[500,1000,2000].map((radius) => `<div class="radius-step ${mission.radiusM>=radius?'active':''}">${radius===500?'500m':`${radius/1000}km`}</div>`).join('')}</div>
      ${mission.offers.length ? `<div class="offer-list">${mission.offers.map((offer) => `<div class="offer-row"><span><strong>${escapeHtml(offer.partner.name)}</strong><small>${escapeHtml(offer.partner.badge)} · 완료율 ${percent(offer.partner.completionRate)}</small></span><span>${offer.distanceM}m</span><strong>${Math.round(offer.matchScore*100)}점</strong><span class="status-chip">${escapeHtml(statusKo[offer.status] || offer.status)}</span></div>`).join('')}</div>` : `<div class="empty-state" style="min-height:150px"><span class="state-icon">${icon('search')}</span><h3>현재 반경에 새 후보가 없습니다.</h3><p>다음 범위로 확대하거나 관리자에게 반환할 수 있습니다.</p></div>`}
      ${['offered','no_candidate'].includes(mission.status) ? `<div class="matching-footer"><p>현재 제안을 만료하고 기존 후보를 제외한 새 파트너를 찾습니다.</p><button class="button secondary" data-action="expand-mission" data-mission-id="${mission.id}">${mission.radiusM===500?'1km로 확대':mission.radiusM===1000?'2km로 확대':'관리자에게 반환'}</button></div>` : ''}
    </div>`;
}

function partnersView(data) {
  const partner = data.selectedPartner;
  const missions = data.partnerMissions;
  if (!ui.selectedMissionId || !missions.some((item) => item.id === ui.selectedMissionId)) ui.selectedMissionId = missions[0]?.id || null;
  const selected = missions.find((item) => item.id === ui.selectedMissionId) || null;
  return `
    ${pageHeader({
      eyebrow: 'Verified partner portal', title: '가까운 안부를,', mutedTitle: '안전한 절차로 확인합니다.',
      description: '보통 위험의 비대면 1차 확인만 수행합니다. 수락 전에는 생활권과 거리만 보이며 고위험 경보는 배정되지 않습니다.',
      actions: `<label class="field" style="min-width:240px"><span class="field-label">데모 참여자</span><select id="partnerSelect">${data.partners.map((item) => `<option value="${item.id}" ${item.id===partner.id?'selected':''}>${escapeHtml(item.name)} · ${escapeHtml(item.district)}</option>`).join('')}</select></label>`,
    })}
    <section class="partner-layout">
      <div>
        <article class="card partner-profile">
          <span class="partner-avatar">${escapeHtml(partner.name.at(-1))}</span>
          <div><span class="badge">인증 완료</span><h2>${escapeHtml(partner.name)}</h2><p>${escapeHtml(partner.district)} · 미션 적합도 ${percent(partner.missionFit)} · 완료율 ${percent(partner.completionRate)}</p>
            <div class="availability"><label class="switch"><input type="checkbox" id="availabilityToggle" ${partner.available?'checked':''}><i></i></label><span>${partner.available?'현재 미션을 받을 수 있습니다.':'참여 불가 상태입니다.'}</span></div>
          </div>
          <div class="points"><span>누적 포인트</span><strong>${partner.points}P</strong><span class="badge">${escapeHtml(partner.badge)}</span></div>
        </article>
        <article class="card" style="margin-top:12px">
          <div class="card-header"><div><span class="eyebrow">Mission inbox</span><h2>내 미션</h2><p>목록에서 하나를 선택하면 오른쪽에 단일 주요 행동이 표시됩니다.</p></div></div>
          ${missions.length ? `<div class="mission-inbox">${missions.map((mission) => `<button class="mission-select ${mission.id===ui.selectedMissionId?'active':''}" data-action="select-mission" data-mission-id="${mission.id}"><span class="risk-badge ${mission.alert.riskLevel}">${riskKo[mission.alert.riskLevel]}</span><span><strong>${escapeHtml(mission.household.maskedArea)}</strong><small>${escapeHtml(mission.missionType)} · ${mission.viewerOffer.distanceM}m</small></span><span>${escapeHtml(statusKo[mission.viewerOffer.status] || mission.viewerOffer.status)}</span></button>`).join('')}</div>` : `<div class="empty-state"><span class="state-icon">${icon('users')}</span><h3>도착한 미션이 없습니다.</h3><p>관리자 화면에서 보통 위험 경보를 확정한 뒤 매칭을 시작해 주세요.</p><a class="button secondary" href="#/dashboard">관리자 화면으로</a></div>`}
        </article>
      </div>
      <aside class="card mission-detail sticky">${selected ? partnerMissionDetail(selected) : `<div class="empty-state"><span class="state-icon">${icon('arrow')}</span><h3>미션을 선택해 주세요.</h3><p>수락 여부와 수행 결과는 선택한 한 건에 대해서만 처리됩니다.</p></div>`}</aside>
    </section>`;
}

function partnerMissionDetail(mission) {
  const offer = mission.viewerOffer;
  const exactVisible = Boolean(mission.household.exactAddress);
  return `
    <div class="card-header"><div><span class="eyebrow">Mission #${mission.id}</span><h2>${escapeHtml(mission.missionType)}</h2><p>${escapeHtml(statusKo[offer.status] || offer.status)} · 반경 ${mission.radiusM}m</p></div><span class="risk-badge ${mission.alert.riskLevel}">${riskKo[mission.alert.riskLevel]}</span></div>
    <div class="mission-detail-body">
      <div class="location-lock"><span>${exactVisible?'수락 후 공개된 가상 주소':'미션 수락 전 생활권'}</span><strong>${escapeHtml(exactVisible ? mission.household.exactAddress : mission.household.maskedArea)}</strong><p>${exactVisible?'수행에 필요한 최소 범위의 가상 주소만 표시됩니다.':'개인정보 보호를 위해 정확한 주소는 아직 공개하지 않습니다.'}</p></div>
      <div class="fact-grid"><div class="fact"><span>AI 확률</span><strong>${percent(mission.alert.probability)}</strong></div><div class="fact"><span>거리</span><strong>${offer.distanceM}m</strong></div><div class="fact"><span>매칭 점수</span><strong>${Math.round(offer.matchScore*100)}점</strong></div></div>
      <div class="inline-note" style="margin:12px 0 0">전달된 최소 상황 정보: ${escapeHtml(mission.alert.reasons.slice(0,2).join(' · '))}</div>
      ${offer.status==='offered' ? `<div class="mission-actions"><button class="button secondary" data-action="decline-offer" data-offer-id="${offer.id}">이번 미션 거절</button><button class="button primary" data-action="accept-offer" data-offer-id="${offer.id}">미션 수락</button></div>` : ''}
      ${offer.status==='accepted' && mission.status==='accepted' ? `<div class="result-options"><button class="result-option" data-action="complete-mission" data-mission-id="${mission.id}" data-result="safe"><span><strong>이상 없음</strong><small>관리자 경보를 해결 상태로 변경</small></span><b>15P</b></button><button class="result-option" data-action="complete-mission" data-mission-id="${mission.id}" data-result="follow_up"><span><strong>추가 확인 필요</strong><small>관리자에게 재확인 요청</small></span><b>20P</b></button><button class="result-option danger" data-action="complete-mission" data-mission-id="${mission.id}" data-result="emergency_suspected"><span><strong>긴급 상황 의심</strong><small>직접 해결하지 않고 즉시 반환</small></span><b>30P</b></button></div>` : ''}
      ${mission.status==='completed' ? `<div class="empty-state" style="min-height:190px"><span class="state-icon">${icon('check')}</span><h3>${escapeHtml(resultKo[mission.result] || '처리 완료')}</h3><p>${mission.pointsAwarded}P가 지급되었고 관리자 화면에 결과가 반영되었습니다.</p></div>` : ''}
      ${['declined','expired'].includes(offer.status) ? `<div class="empty-state" style="min-height:190px"><span class="state-icon">${icon('clock')}</span><h3>현재 제안은 ${escapeHtml(statusKo[offer.status])} 상태입니다.</h3><p>다른 파트너가 수락했거나 탐색 범위가 확대되었을 수 있습니다.</p></div>` : ''}
    </div>`;
}

function devicesView(data) {
  if (!ui.selectedDeviceId || !data.devices.some((item) => item.id === ui.selectedDeviceId)) ui.selectedDeviceId = data.devices[0]?.id || null;
  const selected = data.devices.find((item) => item.id === ui.selectedDeviceId);
  return `
    ${pageHeader({
      eyebrow: 'ESP32 device hub', title: '센서값을 받는 순간,', mutedTitle: 'AI 특성으로 다시 계산합니다.',
      description: 'ESP32-DevKitC V4에서 LD2410C·도어 센서·SHT31·안부 버튼·SOS 버튼 데이터를 JSON으로 전송하는 흐름을 시뮬레이션합니다.',
      actions: `<a class="button secondary" href="#/analyze">수동 입력 분석</a>`,
    })}
    <section class="device-bento">
      <article class="card fleet-card">
        <div class="card-header"><div><span class="eyebrow">Device fleet</span><h2>등록 장치</h2><p>오프라인 장치도 숨기지 않고 상태와 마지막 통신 시각을 표시합니다.</p></div></div>
        <div class="fleet-grid">${data.devices.map((device) => `<button class="device-tile ${device.id===ui.selectedDeviceId?'active':''}" data-action="select-device" data-device-id="${escapeHtml(device.id)}"><div class="device-tile-top"><strong>${escapeHtml(device.id)}</strong><span class="status-chip">${device.status==='online'?'정상':device.status==='attention'?'확인 필요':'오프라인'}</span></div><p>${escapeHtml(device.household.code)} · ${escapeHtml(device.board)}<br>마지막 통신 ${relativeTime(device.lastSeen)}</p></button>`).join('')}</div>
      </article>
      <article class="card device-detail-card">${selected ? deviceDetailMarkup(selected) : ''}</article>
      <article class="card telemetry-card">
        <div class="card-header"><div><span class="eyebrow">Telemetry simulator</span><h2>ESP32 데이터 전송</h2><p>실제 아두이노 코드가 보내는 JSON 형식을 브라우저에서 시험합니다.</p></div></div>
        ${selected ? telemetryFormMarkup(selected) : ''}
      </article>
    </section>`;
}

function deviceDetailMarkup(device) {
  const env = device.sensors.environment;
  return `
    <div class="card-header"><div><span class="eyebrow">${escapeHtml(device.id)}</span><h2>${escapeHtml(device.household.code)} 센서 상태</h2><p>${escapeHtml(device.household.maskedArea)} · 펌웨어 ${escapeHtml(device.firmware)}</p></div><span class="status-chip">${escapeHtml(device.status)}</span></div>
    <div class="device-sensors">
      <div class="sensor-tile">${icon('wifi')}<span>LD2410C 재실</span><strong>${device.sensors.presence.value===true?'감지':device.sensors.presence.value===false?'미감지':'연결 끊김'}</strong></div>
      <div class="sensor-tile">${icon('map')}<span>AMS39NO 문 열림</span><strong>${device.sensors.door.value===true?'열림':device.sensors.door.value===false?'닫힘':'연결 끊김'}</strong></div>
      <div class="sensor-tile">${icon('thermometer')}<span>SHT31 온습도</span><strong>${env.temperature==null?'연결 끊김':`${env.temperature}℃ · ${env.humidity}%`}</strong></div>
      <div class="sensor-tile">${icon('check')}<span>안부 버튼</span><strong>${device.sensors.checkin.value?'입력됨':'대기'}</strong></div>
      <div class="sensor-tile">${icon('alert')}<span>SOS 버튼</span><strong>${device.sensors.sos.value?'도움 요청':'대기'}</strong></div>
      <div class="sensor-tile">${icon('clock')}<span>마지막 움직임</span><strong>${relativeTime(device.lastMotionAt)}</strong></div>
    </div>`;
}

function telemetryFormMarkup(device) {
  return `
    <form id="telemetryForm" class="telemetry-form" novalidate>
      <input type="hidden" name="deviceId" value="${escapeHtml(device.id)}">
      <div class="checkbox-grid">
        <label class="check-card"><input type="checkbox" name="presenceDetected">LD2410C 재실 감지</label>
        <label class="check-card"><input type="checkbox" name="doorOpened">현관문 열림</label>
        <label class="check-card"><input type="checkbox" name="checkinPressed">안부 버튼 입력</label>
        <label class="check-card"><input type="checkbox" name="sosPressed">SOS 3초 입력</label>
      </div>
      <label class="field" style="margin-top:12px"><span class="field-label">SHT31 온도<em>-10–55℃</em></span><span class="input-with-unit"><input type="number" name="temperatureC" value="${device.sensors.environment.temperature ?? 25.5}" min="-10" max="55" step="0.1" required><span>℃</span></span><span class="field-help">30℃ 이상은 주의, 35℃ 이상은 위험으로 단계화합니다.</span><span class="field-error" data-error-for="temperatureC"></span></label>
      <label class="field"><span class="field-label">SHT31 습도<em>0–100%</em></span><span class="input-with-unit"><input type="number" name="humidity" value="${device.sensors.environment.humidity ?? 60}" min="0" max="100" step="1" required><span>%</span></span><span class="field-help">현재 모델 입력에는 온도 위험만 직접 반영하고 습도는 장치 상태로 기록합니다.</span><span class="field-error" data-error-for="humidity"></span></label>
      <button class="button primary" style="width:100%;margin-top:14px" type="submit" id="telemetrySubmit">${icon('wifi')} 텔레메트리 전송</button>
      <div class="inline-note" style="margin:12px 0 0">POST /api/devices/${escapeHtml(device.id)}/telemetry · SOS는 AI 결과와 별개로 관리자 전문 대응 검토를 생성합니다.</div>
    </form>`;
}

function matrixMarkup(matrix) {
  return `<div class="matrix"><b></b><b>예측 낮음</b><b>예측 보통</b><b>예측 높음</b>${matrix.map((row,rowIndex) => `<b>실제 ${riskKo[['low','medium','high'][rowIndex]]}</b>${row.map((value,columnIndex) => `<span class="${rowIndex===columnIndex?'diagonal':''}">${value}</span>`).join('')}`).join('')}</div>`;
}

function modelView(data) {
  const models = [
    ['ruleBased','규칙 기반 점수','기준 모델'], ['decisionTree','의사결정나무','해석 비교'], ['randomForest','랜덤 포레스트','최종 운영'],
  ];
  const rf = data.metrics.models.randomForest;
  return `
    ${pageHeader({
      eyebrow: 'JavaScript model card', title: '정확도 한 줄보다,', mutedTitle: '비교·검증·한계를 함께.',
      description: '모델 생성, 학습, 예측과 평가까지 Node.js에서 직접 수행합니다. Python 런타임이나 외부 AI API에 의존하지 않습니다.',
      actions: `<a class="button secondary" href="#/analyze">모델 직접 시험</a>`,
    })}
    <section class="report-grid">
      <article class="card comparison-card">
        <div class="card-header"><div><span class="eyebrow">Model comparison</span><h2>동일 테스트 데이터 비교</h2><p>${escapeHtml(data.metrics.dataset.sourceNote)}</p></div><span class="badge">테스트 ${formatNumber(data.metrics.dataset.test)}건</span></div>
        <div class="comparison-table"><table class="data-table"><thead><tr><th>모델</th><th>정확도</th><th>Macro F1</th><th>고위험 정밀도</th><th>고위험 재현율</th><th>역할</th></tr></thead><tbody>${models.map(([key,name,role]) => { const item=data.metrics.models[key]; return `<tr><td><strong>${name}</strong><span class="subtext">${role}</span></td><td>${percent(item.accuracy,1)}</td><td>${percent(item.macroF1,1)}</td><td>${percent(item.highPrecision,1)}</td><td><strong>${percent(item.highRecall,1)}</strong></td><td>${key==='ruleBased'?'단순 기준선':key==='decisionTree'?'구조 해석':'위음성 감소 우선'}</td></tr>`; }).join('')}</tbody></table></div>
      </article>
      <article class="card">
        <div class="metric-highlight"><span>랜덤 포레스트 고위험 재현율</span><strong>${percent(rf.highRecall,1)}</strong><p>실제 고위험 시나리오 가운데 운영 모델이 높음으로 찾은 비율입니다. 합성 데이터 결과이며 현장 성능이 아닙니다.</p><div class="threshold-rail"><span>0</span><div class="threshold-track"><b style="width:${percent(data.metrics.highRiskThreshold)}"></b><i style="left:${percent(data.metrics.highRiskThreshold)}"></i></div><span>1</span></div><span>운영 임계값 ${data.metrics.highRiskThreshold} · ${escapeHtml(data.metrics.thresholdNote)}</span></div>
      </article>
      <article class="card"><div class="card-header"><div><span class="eyebrow">Feature importance</span><h2>주요 특성</h2></div></div><div class="importance-list">${data.metrics.featureImportances.slice(0,8).map((item) => `<div class="importance-row"><span>${escapeHtml(item.label)}</span><i><b style="width:${Math.min(100,item.importance*300)}%"></b></i><em>${percent(item.importance,1)}</em></div>`).join('')}</div></article>
      ${models.map(([key,name]) => `<article class="card"><div class="card-header"><div><span class="eyebrow">Confusion matrix</span><h2>${name}</h2></div>${key==='randomForest'?'<span class="badge">운영 모델</span>':''}</div><div class="matrix-wrap">${matrixMarkup(data.metrics.models[key].confusionMatrix)}</div></article>`).join('')}
    </section>
    <section class="card" style="margin-top:12px"><div class="card-header"><div><span class="eyebrow">Limitations</span><h2>먼저 공개하는 한계</h2></div></div><div class="detail-grid" style="padding:0 18px 18px">${data.metrics.limitations.map((item,index) => `<div class="signal-item"><span>${String(index+1).padStart(2,'0')}</span><strong style="margin-top:8px;line-height:1.55">${escapeHtml(item)}</strong></div>`).join('')}</div></section>`;
}

function safetyView(data) {
  return `
    ${pageHeader({
      eyebrow: 'Safety by design', title: '기능보다 먼저,', mutedTitle: '잘못 작동했을 때의 피해를 줄입니다.',
      description: '고위험 주민 배정, 정확 주소 조기 공개, AI 자동 신고를 막고 주요 변경은 감사 로그로 남깁니다.',
      actions: `<button class="button danger" data-action="open-reset">${icon('refresh')} 데모 초기화</button>`,
    })}
    <section class="safety-bento">
      ${[
        ['01','가상·비식별 데이터','이름·전화번호·실제 주소를 모델 입력에서 제외합니다.','개인 식별정보 제외|가상 주소 사용|합성 데이터 표시'],
        ['02','단계적 위치 공개','수락 전 생활권과 거리만, 수락 후 최소 가상 주소만 표시합니다.','생활권 우선|수락 후 최소 공개|고위험 매칭 차단'],
        ['03','사람의 최종 판단','AI는 우선순위를 제시하고 관리자가 대응 단계를 확정합니다.','고위험 하향 근거 필수|자동 신고 없음|원본 신호 확인'],
        ['04','추적 가능한 기록','분석·검토·매칭·수락·완료를 감사 로그로 보존합니다.','시간 기록|행위자 구분|결과 변경 추적'],
      ].map(([no,title,description,list]) => `<article class="card safety-principle"><span class="eyebrow">${no}</span><h2>${title}</h2><p>${description}</p><ul>${list.split('|').map((item) => `<li>${item}</li>`).join('')}</ul></article>`).join('')}
      <article class="card match-formula"><div class="card-header"><div><span class="eyebrow">Matching logic</span><h2>안심파트너 점수식</h2><p>인증되고 현재 참여 가능한 사람만 후보에 포함합니다.</p></div></div><div class="formula"><strong>매칭 점수</strong><span>=</span><div class="formula-part"><b>거리</b><em>45%</em></div><span>+</span><div class="formula-part"><b>참여 가능</b><em>30%</em></div><span>+</span><div class="formula-part"><b>완료율</b><em>15%</em></div><span>+</span><div class="formula-part"><b>미션 적합도</b><em>10%</em></div></div><div class="card-footer">500m → 1km → 2km 확대 · 기존 제안자 제외 · 상위 3명 제안 · 2km 실패 시 관리자 반환</div></article>
      <article class="card reward-card"><div class="card-header"><div><span class="eyebrow">Participation record</span><h2>포인트·배지</h2></div></div><div class="reward-stack"><div class="reward-row"><span>이상 없음</span><strong>15P</strong></div><div class="reward-row"><span>추가 확인 필요</span><strong>20P</strong></div><div class="reward-row"><span>긴급 상황 의심</span><strong>30P</strong></div><div class="inline-note" style="margin:4px 0 0">현금성 토큰이 아니라 참여 이력을 시각화하는 프로토타입 기록입니다.</div></div></article>
      <article class="card audit-card"><div class="card-header"><div><span class="eyebrow">Audit trail</span><h2>최근 감사 로그</h2><p>최대 200건을 JSON 상태 파일에 저장합니다.</p></div><span class="status-chip">${data.audit.length}건 표시</span></div><div class="audit-list">${data.audit.map((item) => `<div class="audit-row"><span>${dateTime(item.createdAt)}</span><b>${escapeHtml(item.actor)}</b><strong>${escapeHtml(item.action)}</strong><p>${escapeHtml(item.detail)}</p></div>`).join('')}</div></article>
    </section>`;
}

function renderRoute() {
  if (!ui.data) return;
  const { route, id } = routeInfo();
  setActiveNav(route);
  if (route === 'dashboard') app.innerHTML = dashboardView(ui.data);
  else if (route === 'analyze') app.innerHTML = analyzeView(ui.data);
  else if (route === 'alert') app.innerHTML = alertView(ui.data, id);
  else if (route === 'partners') app.innerHTML = partnersView(ui.data);
  else if (route === 'devices') app.innerHTML = devicesView(ui.data);
  else if (route === 'model') app.innerHTML = modelView(ui.data);
  else if (route === 'safety') app.innerHTML = safetyView(ui.data);
  else location.hash = '#/dashboard';
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function clearFieldErrors(form) {
  form.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
  form.querySelectorAll('.field-error').forEach((node) => { node.textContent = ''; node.classList.remove('visible'); });
}

function applyFieldErrors(form, errors = {}) {
  Object.entries(errors).forEach(([name, message]) => {
    const field = form.elements[name];
    const node = form.querySelector(`[data-error-for="${name}"]`);
    field?.classList.add('invalid');
    if (node) { node.textContent = message; node.classList.add('visible'); }
  });
  const first = form.querySelector('.invalid');
  first?.focus();
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function submitAnalysis(form) {
  clearFieldErrors(form);
  const values = formObject(form);
  const payload = Object.fromEntries(Object.entries(values).map(([key,value]) => [key, Number(value)]));
  const button = document.getElementById('analysisSubmit');
  button.disabled = true; button.classList.add('loading'); button.textContent = '분석 중';
  try {
    const result = await api('/api/analyze', { method: 'POST', body: JSON.stringify(payload) });
    ui.analysisResult = result;
    document.getElementById('analysisResultCard').innerHTML = analysisResultMarkup(result);
    ui.data = await api(`/api/bootstrap?partnerId=${ui.partnerId}`);
    showToast(`경보 #${result.id}이 저장되었습니다. 상세 검토에서 관리자 판단을 확정할 수 있습니다.`);
  } catch (error) {
    if (error.details?.fieldErrors) applyFieldErrors(form, error.details.fieldErrors);
    showToast(error.message);
  } finally {
    button.disabled = false; button.classList.remove('loading'); button.innerHTML = `${icon('scan')} 세 모델 비교 분석`;
  }
}

async function submitReview(form) {
  clearFieldErrors(form);
  const { id } = routeInfo();
  const values = formObject(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; button.classList.add('loading');
  try {
    await api(`/api/alerts/${id}/review`, { method: 'POST', body: JSON.stringify(values) });
    showToast('관리자 판단을 저장했습니다. 대응 단계가 즉시 갱신됩니다.');
    await refreshAndRender();
  } catch (error) {
    if (error.status === 422) applyFieldErrors(form, { reviewNote: error.message });
    showToast(error.message);
  } finally { button.disabled = false; button.classList.remove('loading'); }
}

async function submitTelemetry(form) {
  clearFieldErrors(form);
  const values = formObject(form);
  const temperature = Number(values.temperatureC);
  const humidity = Number(values.humidity);
  const errors = {};
  if (!Number.isFinite(temperature) || temperature < -10 || temperature > 55) errors.temperatureC = '-10℃ 이상 55℃ 이하로 입력해 주세요.';
  if (!Number.isFinite(humidity) || humidity < 0 || humidity > 100) errors.humidity = '0% 이상 100% 이하로 입력해 주세요.';
  if (Object.keys(errors).length) return applyFieldErrors(form, errors);
  const payload = {
    presenceDetected: Boolean(form.elements.presenceDetected.checked),
    doorOpened: Boolean(form.elements.doorOpened.checked),
    checkinPressed: Boolean(form.elements.checkinPressed.checked),
    sosPressed: Boolean(form.elements.sosPressed.checked),
    temperatureC: temperature,
    humidity,
    timestamp: new Date().toISOString(),
  };
  const button = document.getElementById('telemetrySubmit');
  button.disabled = true; button.classList.add('loading'); button.textContent = '전송 중';
  try {
    const result = await api(`/api/devices/${encodeURIComponent(values.deviceId)}/telemetry`, { method: 'POST', body: JSON.stringify(payload) });
    showToast(result.alert ? `텔레메트리 수신 후 경보 #${result.alert.id}을 생성했습니다.` : '텔레메트리를 수신했습니다. 현재는 새 경보가 필요하지 않습니다.');
    await refreshAndRender();
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; button.classList.remove('loading'); button.innerHTML = `${icon('wifi')} 텔레메트리 전송`; }
}

function loadScenarioIntoForm(type) {
  const form = document.getElementById('analysisForm');
  if (!form) return;
  const values = scenarioValues(type);
  Object.entries(values).forEach(([key,value]) => { if (form.elements[key]) form.elements[key].value = value; });
  form.querySelectorAll('[data-action="load-scenario"]').forEach((button) => button.classList.toggle('active', button.dataset.type === type));
  clearFieldErrors(form);
  showToast(`${riskKo[type]} 위험 시연값을 불러왔습니다.`);
}

async function resetDemo() {
  openConfirm({
    title: '데모 상태를 초기화할까요?',
    description: '새 경보, 미션, 포인트, 장치 상태와 감사 로그가 기본 시연 상태로 돌아갑니다. 이 작업은 되돌릴 수 없습니다.',
    confirmLabel: '초기화', danger: true, typedText: '초기화',
    onConfirm: async () => {
      await api('/api/reset', { method: 'POST', body: '{}' });
      ui.analysisResult = null; ui.selectedMissionId = null; ui.selectedDeviceId = null;
      await loadData({ quiet: true });
      location.hash = '#/dashboard'; renderRoute();
      showToast('데모 상태를 초기화했습니다.');
    },
  });
}

app.addEventListener('submit', (event) => {
  if (event.target.id === 'analysisForm') { event.preventDefault(); submitAnalysis(event.target); }
  if (event.target.id === 'reviewForm') { event.preventDefault(); submitReview(event.target); }
  if (event.target.id === 'telemetryForm') { event.preventDefault(); submitTelemetry(event.target); }
});

app.addEventListener('input', (event) => {
  if (event.target.id === 'alertSearch') filterAlerts();
  if (event.target.matches('.invalid')) {
    event.target.classList.remove('invalid');
    const node = event.target.form?.querySelector(`[data-error-for="${event.target.name}"]`);
    node?.classList.remove('visible');
  }
});

function filterAlerts() {
  const search = (document.getElementById('alertSearch')?.value || '').trim().toLowerCase();
  const risk = document.querySelector('[data-action="filter-alerts"].active')?.dataset.risk || 'all';
  let visible = 0;
  document.querySelectorAll('#alertTable tbody tr').forEach((row) => {
    const show = (risk === 'all' || row.dataset.risk === risk) && (!search || row.dataset.search.includes(search));
    row.classList.toggle('hidden', !show); if (show) visible += 1;
  });
  document.getElementById('alertEmptyFilter')?.classList.toggle('hidden', visible !== 0);
}

app.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'retry-load') { await loadData(); renderRoute(); }
  if (action === 'filter-alerts') {
    target.parentElement.querySelectorAll('.segmented-button').forEach((button) => button.classList.toggle('active', button === target)); filterAlerts();
  }
  if (action === 'load-scenario') loadScenarioIntoForm(target.dataset.type);
  if (action === 'create-mission') {
    target.disabled = true; target.classList.add('loading');
    try { const result = await api(`/api/alerts/${target.dataset.alertId}/mission`, { method:'POST', body:'{}' }); showToast(result.message); await refreshAndRender(); }
    catch (error) { showToast(error.message); target.disabled=false; target.classList.remove('loading'); }
  }
  if (action === 'expand-mission') {
    openConfirm({ title:'탐색 범위를 확대할까요?', description:'현재 제안은 만료되고 기존 후보를 제외한 새로운 인증 파트너를 다음 거리 범위에서 찾습니다.', confirmLabel:'범위 확대', onConfirm:async()=>{ const result=await api(`/api/missions/${target.dataset.missionId}/expand`,{method:'POST',body:'{}'}); showToast(result.message); await refreshAndRender(); } });
  }
  if (action === 'select-mission') { ui.selectedMissionId=Number(target.dataset.missionId); renderRoute(); }
  if (action === 'accept-offer') {
    target.disabled=true; target.classList.add('loading');
    try { const result=await api(`/api/offers/${target.dataset.offerId}/accept`,{method:'POST',body:'{}'}); showToast(result.message); await refreshAndRender(); }
    catch(error){showToast(error.message);target.disabled=false;target.classList.remove('loading');}
  }
  if (action === 'decline-offer') {
    const offerId=target.dataset.offerId;
    try { const result=await api(`/api/offers/${offerId}/decline`,{method:'POST',body:'{}'}); await loadData({quiet:true}); renderRoute(); showToast(result.message,{actionLabel:'실행 취소',action:async()=>{await api(`/api/offers/${offerId}/restore`,{method:'POST',body:'{}'});await refreshAndRender();showToast('거절을 취소했습니다.');},duration:6000}); }
    catch(error){showToast(error.message);}
  }
  if (action === 'complete-mission') {
    const label=resultKo[target.dataset.result];
    openConfirm({title:`‘${label}’으로 제출할까요?`,description:'결과는 관리자 화면에 즉시 반영되고 참여 포인트가 지급됩니다.',confirmLabel:'결과 제출',danger:target.dataset.result==='emergency_suspected',onConfirm:async()=>{const result=await api(`/api/missions/${target.dataset.missionId}/complete`,{method:'POST',body:JSON.stringify({result:target.dataset.result})});showToast(`${result.points}P가 지급되었습니다.`);await refreshAndRender();}});
  }
  if (action === 'select-device') { ui.selectedDeviceId=target.dataset.deviceId; renderRoute(); }
  if (action === 'open-reset') resetDemo();
});

document.addEventListener('change', async (event) => {
  if (event.target.id === 'partnerSelect') {
    ui.partnerId=Number(event.target.value); localStorage.setItem('hondibom.partnerId',String(ui.partnerId)); ui.selectedMissionId=null; await loadData({quiet:true}); renderRoute();
  }
  if (event.target.id === 'availabilityToggle') {
    try { await api(`/api/partners/${ui.partnerId}/availability`,{method:'POST',body:JSON.stringify({available:event.target.checked})}); showToast(event.target.checked?'참여 가능 상태로 변경했습니다.':'참여 불가 상태로 변경했습니다.'); await loadData({quiet:true}); }
    catch(error){event.target.checked=!event.target.checked;showToast(error.message);}
  }
});

document.addEventListener('click',(event)=>{
  const close=event.target.closest('[data-action="close-modal"]'); if(close) closeModal();
});

document.getElementById('resetButton')?.addEventListener('click', resetDemo);
window.addEventListener('hashchange',renderRoute);

(async function init(){
  if(!location.hash) location.hash='#/dashboard';
  try { await loadData(); renderRoute(); }
  catch (_) {}
})();
