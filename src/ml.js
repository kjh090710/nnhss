'use strict';

const FEATURES = [
  'no_motion_minutes',
  'missed_checkin_count',
  'door_activity_count',
  'recent_contact_success',
  'repeated_alert_count',
  'usual_inactive_minutes',
  'sensor_reliability',
  'alert_hour',
  'temperature_risk',
  'previous_false_alarm_count',
];

const FEATURE_LABELS = {
  no_motion_minutes: '움직임 없음 시간',
  missed_checkin_count: '정기 연락 미응답',
  door_activity_count: '출입문 활동',
  recent_contact_success: '최근 연락 성공',
  repeated_alert_count: '반복 경보',
  usual_inactive_minutes: '평소 비활동 시간',
  sensor_reliability: '센서 신뢰도',
  alert_hour: '경보 발생 시각',
  temperature_risk: '온도 위험',
  previous_false_alarm_count: '과거 오작동',
};

const LABELS = ['low', 'medium', 'high'];

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random, mean = 0, std = 1) {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = Math.max(random(), Number.EPSILON);
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function gammaIntegerShape(random, shape = 2, scale = 1) {
  let total = 0;
  for (let i = 0; i < shape; i += 1) total += -Math.log(Math.max(random(), Number.EPSILON));
  return total * scale;
}

function poisson(random, lambda) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit);
  return count - 1;
}

function weightedChoice(random, values, weights) {
  const value = random();
  let cumulative = 0;
  for (let i = 0; i < values.length; i += 1) {
    cumulative += weights[i];
    if (value <= cumulative) return values[i];
  }
  return values.at(-1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function generateSyntheticData(count = 5200, seed = 20260722) {
  const random = mulberry32(seed);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const row = {
      no_motion_minutes: Math.round(clamp(gammaIntegerShape(random, 2, 110), 0, 1320)),
      missed_checkin_count: weightedChoice(random, [0, 1, 2, 3, 4], [0.55, 0.22, 0.13, 0.07, 0.03]),
      door_activity_count: clamp(poisson(random, 2.8), 0, 14),
      recent_contact_success: weightedChoice(random, [0, 1], [0.25, 0.75]),
      repeated_alert_count: clamp(poisson(random, 1.0), 0, 8),
      usual_inactive_minutes: Math.round(clamp(normal(random, 255, 82), 60, 620)),
      sensor_reliability: Number(clamp(0.78 + normal(random, 0, 0.13), 0.35, 1).toFixed(3)),
      alert_hour: Math.floor(random() * 24),
      temperature_risk: weightedChoice(random, [0, 1, 2], [0.66, 0.24, 0.10]),
      previous_false_alarm_count: clamp(poisson(random, 0.7), 0, 7),
    };

    const ratio = row.no_motion_minutes / Math.max(row.usual_inactive_minutes, 1);
    const sleep = row.alert_hour >= 23 || row.alert_hour <= 6 ? 1 : 0;
    const noDoor = row.door_activity_count === 0 ? 1 : 0;
    const contactFail = 1 - row.recent_contact_success;
    const interaction = ratio >= 1.8 && row.missed_checkin_count >= 2 ? 1 : 0;
    const heatContact = row.temperature_risk === 2 && contactFail === 1 ? 1 : 0;
    const latent =
      1.55 * Math.max(ratio - 1, 0) +
      0.88 * row.missed_checkin_count +
      0.82 * contactFail +
      0.42 * noDoor +
      0.26 * row.repeated_alert_count +
      0.52 * row.temperature_risk +
      0.65 * interaction +
      0.38 * heatContact -
      0.52 * sleep * (ratio < 1.45 ? 1 : 0) -
      0.32 * row.previous_false_alarm_count -
      0.55 * (row.sensor_reliability < 0.58 ? 1 : 0) +
      normal(random, 0, 0.62);

    row.label = latent < 1.4 ? 'low' : latent < 3.45 ? 'medium' : 'high';
    rows.push(row);
  }
  return rows;
}

function shuffle(array, random) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function stratifiedSplit(rows, seed = 42) {
  const random = mulberry32(seed);
  const groups = Object.fromEntries(LABELS.map((label) => [label, []]));
  rows.forEach((row) => groups[row.label].push(row));
  const train = [];
  const validation = [];
  const test = [];
  for (const label of LABELS) {
    shuffle(groups[label], random);
    const trainEnd = Math.floor(groups[label].length * 0.6);
    const validationEnd = Math.floor(groups[label].length * 0.8);
    train.push(...groups[label].slice(0, trainEnd));
    validation.push(...groups[label].slice(trainEnd, validationEnd));
    test.push(...groups[label].slice(validationEnd));
  }
  return { train: shuffle(train, random), validation: shuffle(validation, random), test: shuffle(test, random) };
}

function countsFor(rows) {
  const counts = [0, 0, 0];
  rows.forEach((row) => { counts[LABELS.indexOf(row.label)] += 1; });
  return counts;
}

function gini(counts) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  return 1 - counts.reduce((sum, value) => sum + (value / total) ** 2, 0);
}

function probabilitiesFromCounts(counts) {
  const smoothed = counts.map((count) => count + 1);
  const total = smoothed.reduce((sum, value) => sum + value, 0);
  return smoothed.map((count) => count / total);
}

function sampleFeatures(random, maxFeatures) {
  const indexes = FEATURES.map((_, index) => index);
  shuffle(indexes, random);
  return indexes.slice(0, maxFeatures);
}

function candidateThresholds(rows, feature, random) {
  const values = [];
  const sampleSize = Math.min(rows.length, 72);
  for (let i = 0; i < sampleSize; i += 1) values.push(rows[Math.floor(random() * rows.length)][feature]);
  values.sort((a, b) => a - b);
  const unique = [...new Set(values)];
  if (unique.length <= 1) return [];
  const candidates = [];
  const slots = Math.min(10, unique.length - 1);
  for (let i = 1; i <= slots; i += 1) {
    const index = Math.min(unique.length - 2, Math.floor((i * unique.length) / (slots + 1)));
    candidates.push((unique[index] + unique[index + 1]) / 2);
  }
  return [...new Set(candidates)];
}

function buildTree(rows, options, random, depth = 0, importance = null) {
  const counts = countsFor(rows);
  const node = { counts, probabilities: probabilitiesFromCounts(counts), samples: rows.length };
  const nonZero = counts.filter((count) => count > 0).length;
  if (depth >= options.maxDepth || rows.length < options.minLeaf * 2 || nonZero <= 1) return node;

  const parentGini = gini(counts);
  const featureIndexes = options.maxFeatures >= FEATURES.length
    ? FEATURES.map((_, index) => index)
    : sampleFeatures(random, options.maxFeatures);
  let best = null;

  for (const featureIndex of featureIndexes) {
    const feature = FEATURES[featureIndex];
    const thresholds = candidateThresholds(rows, feature, random);
    for (const threshold of thresholds) {
      const leftCounts = [0, 0, 0];
      const rightCounts = [0, 0, 0];
      let leftSize = 0;
      for (const row of rows) {
        const target = row[feature] <= threshold ? leftCounts : rightCounts;
        target[LABELS.indexOf(row.label)] += 1;
        if (row[feature] <= threshold) leftSize += 1;
      }
      const rightSize = rows.length - leftSize;
      if (leftSize < options.minLeaf || rightSize < options.minLeaf) continue;
      const splitGini = (leftSize / rows.length) * gini(leftCounts) + (rightSize / rows.length) * gini(rightCounts);
      const gain = parentGini - splitGini;
      if (!best || gain > best.gain) best = { feature, threshold, gain };
    }
  }

  if (!best || best.gain < options.minGain) return node;
  const left = [];
  const right = [];
  rows.forEach((row) => (row[best.feature] <= best.threshold ? left : right).push(row));
  if (importance) importance[best.feature] = (importance[best.feature] || 0) + best.gain * rows.length;
  node.feature = best.feature;
  node.threshold = best.threshold;
  node.gain = best.gain;
  node.left = buildTree(left, options, random, depth + 1, importance);
  node.right = buildTree(right, options, random, depth + 1, importance);
  return node;
}

function predictTree(tree, row) {
  let node = tree;
  while (node.feature) node = row[node.feature] <= node.threshold ? node.left : node.right;
  return node.probabilities;
}

function trainDecisionTree(rows, seed = 11) {
  const random = mulberry32(seed);
  return buildTree(rows, { maxDepth: 7, minLeaf: 10, minGain: 0.0008, maxFeatures: FEATURES.length }, random);
}

function bootstrapRows(rows, random) {
  const byLabel = Object.fromEntries(LABELS.map((label) => [label, rows.filter((row) => row.label === label)]));
  const result = [];
  for (let i = 0; i < rows.length; i += 1) {
    // Slightly oversample rare high-risk examples without flattening the full distribution.
    const selector = random();
    const label = selector < 0.25 ? 'high' : selector < 0.55 ? 'medium' : 'low';
    const source = byLabel[label].length ? byLabel[label] : rows;
    result.push(source[Math.floor(random() * source.length)]);
  }
  return result;
}

function trainRandomForest(rows, options = {}) {
  const treeCount = options.treeCount || 46;
  const random = mulberry32(options.seed || 90);
  const importance = Object.fromEntries(FEATURES.map((feature) => [feature, 0]));
  const trees = [];
  for (let i = 0; i < treeCount; i += 1) {
    const sample = bootstrapRows(rows, random);
    trees.push(buildTree(sample, {
      maxDepth: options.maxDepth || 8,
      minLeaf: options.minLeaf || 8,
      minGain: 0.0006,
      maxFeatures: Math.max(3, Math.round(Math.sqrt(FEATURES.length))),
    }, random, 0, importance));
  }
  const totalImportance = Object.values(importance).reduce((sum, value) => sum + value, 0) || 1;
  Object.keys(importance).forEach((key) => { importance[key] /= totalImportance; });
  return { trees, importance };
}

function predictForest(forest, row) {
  const sums = [0, 0, 0];
  forest.trees.forEach((tree) => {
    const probabilities = predictTree(tree, row);
    probabilities.forEach((probability, index) => { sums[index] += probability; });
  });
  return sums.map((value) => value / forest.trees.length);
}

function rulePrediction(row) {
  const ratio = row.no_motion_minutes / Math.max(row.usual_inactive_minutes, 1);
  let score = 0;
  score += ratio >= 2.5 ? 3 : ratio >= 1.6 ? 2 : ratio >= 1.25 ? 1 : 0;
  score += row.missed_checkin_count >= 2 ? 3 : row.missed_checkin_count === 1 ? 1 : 0;
  score += row.recent_contact_success === 0 ? 2 : 0;
  score += row.door_activity_count === 0 ? 1 : 0;
  score += row.repeated_alert_count >= 3 ? 1 : 0;
  score += row.temperature_risk === 2 ? 2 : row.temperature_risk === 1 ? 1 : 0;
  score -= row.sensor_reliability < 0.6 ? 1 : 0;
  score -= row.previous_false_alarm_count >= 3 ? 1 : 0;
  score -= (row.alert_hour >= 23 || row.alert_hour <= 6) && ratio < 1.5 ? 1 : 0;
  return { label: score >= 7 ? 'high' : score >= 3 ? 'medium' : 'low', score };
}

function highestLabel(probabilities) {
  let index = 0;
  for (let i = 1; i < probabilities.length; i += 1) if (probabilities[i] > probabilities[index]) index = i;
  return LABELS[index];
}

function confusionMatrix(truth, predictions) {
  const matrix = LABELS.map(() => LABELS.map(() => 0));
  truth.forEach((label, index) => { matrix[LABELS.indexOf(label)][LABELS.indexOf(predictions[index])] += 1; });
  return matrix;
}

function metricsFor(truth, predictions) {
  const matrix = confusionMatrix(truth, predictions);
  const total = truth.length;
  const correct = matrix.reduce((sum, row, index) => sum + row[index], 0);
  const precisions = [];
  const recalls = [];
  const f1s = [];
  for (let index = 0; index < LABELS.length; index += 1) {
    const truePositive = matrix[index][index];
    const predictedPositive = matrix.reduce((sum, row) => sum + row[index], 0);
    const actualPositive = matrix[index].reduce((sum, value) => sum + value, 0);
    const precision = predictedPositive ? truePositive / predictedPositive : 0;
    const recall = actualPositive ? truePositive / actualPositive : 0;
    precisions.push(precision);
    recalls.push(recall);
    f1s.push(precision + recall ? (2 * precision * recall) / (precision + recall) : 0);
  }
  return {
    accuracy: correct / total,
    macroPrecision: precisions.reduce((a, b) => a + b, 0) / LABELS.length,
    macroRecall: recalls.reduce((a, b) => a + b, 0) / LABELS.length,
    macroF1: f1s.reduce((a, b) => a + b, 0) / LABELS.length,
    highPrecision: precisions[2],
    highRecall: recalls[2],
    confusionMatrix: matrix,
  };
}

function operationalLabel(probabilities, threshold) {
  return probabilities[2] >= threshold ? 'high' : highestLabel(probabilities);
}

function selectHighThreshold(forest, validation) {
  let best = null;
  for (let threshold = 0.18; threshold <= 0.58; threshold += 0.01) {
    const predictions = validation.map((row) => operationalLabel(predictForest(forest, row), threshold));
    const metrics = metricsFor(validation.map((row) => row.label), predictions);
    if (metrics.highRecall >= 0.9) {
      const score = metrics.macroF1 + metrics.highPrecision * 0.05;
      if (!best || score > best.score) best = { threshold: Number(threshold.toFixed(2)), score, metrics };
    }
  }
  return best || { threshold: 0.3, metrics: null };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function trainAll(options = {}) {
  const rows = generateSyntheticData(options.count || 5200, options.seed || 20260722);
  const split = stratifiedSplit(rows, options.splitSeed || 42);
  const decisionTree = trainDecisionTree(split.train);
  const randomForest = trainRandomForest(split.train, { treeCount: options.treeCount || 46, seed: 88 });
  const thresholdResult = selectHighThreshold(randomForest, split.validation);
  const highThreshold = thresholdResult.threshold;

  const truth = split.test.map((row) => row.label);
  const rulePredictions = split.test.map((row) => rulePrediction(row).label);
  const treePredictions = split.test.map((row) => highestLabel(predictTree(decisionTree, row)));
  const forestPredictions = split.test.map((row) => operationalLabel(predictForest(randomForest, row), highThreshold));

  const baselines = Object.fromEntries(FEATURES.map((feature) => [feature, median(split.train.map((row) => row[feature]))]));
  const distribution = Object.fromEntries(LABELS.map((label) => [label, rows.filter((row) => row.label === label).length]));
  const featureImportances = FEATURES
    .map((feature) => ({ feature, label: FEATURE_LABELS[feature], importance: randomForest.importance[feature] }))
    .sort((a, b) => b.importance - a.importance);

  return {
    model: { FEATURES, LABELS, decisionTree, randomForest, highThreshold, baselines },
    metrics: {
      generatedAt: new Date().toISOString(),
      dataset: {
        total: rows.length,
        train: split.train.length,
        validation: split.validation.length,
        test: split.test.length,
        distribution,
        sourceNote: '공개 독거노인 위험감지 데이터에서 확인 가능한 센서 항목 구조를 참고해 생성한 합성 시나리오 데이터',
      },
      models: {
        ruleBased: metricsFor(truth, rulePredictions),
        decisionTree: metricsFor(truth, treePredictions),
        randomForest: metricsFor(truth, forestPredictions),
      },
      highRiskThreshold: highThreshold,
      thresholdNote: '검증 데이터에서 고위험 재현율 90% 이상을 만족하는 값 중 Macro F1이 가장 높은 임계값',
      featureImportances,
      limitations: [
        '합성 데이터 기반이므로 실제 현장 성능으로 해석할 수 없음',
        '센서 고장·생활 습관 변화·지역 환경 차이를 완전히 반영하지 못함',
        'AI 결과는 관리자 판단을 돕는 정보이며 자동 신고 판단으로 사용하지 않음',
      ],
    },
  };
}

function probabilitiesObject(probabilities) {
  return Object.fromEntries(LABELS.map((label, index) => [label, probabilities[index]]));
}

function explain(model, row, selectedLabel) {
  const selectedIndex = LABELS.indexOf(selectedLabel);
  const actual = predictForest(model.randomForest, row)[selectedIndex];
  const items = FEATURES.map((feature) => {
    const altered = { ...row, [feature]: model.baselines[feature] };
    const baseline = predictForest(model.randomForest, altered)[selectedIndex];
    return { feature, label: FEATURE_LABELS[feature], contribution: actual - baseline };
  }).sort((a, b) => b.contribution - a.contribution);

  const ratio = row.no_motion_minutes / Math.max(row.usual_inactive_minutes, 1);
  const details = {
    no_motion_minutes: `비활동 시간이 개인 기준의 ${ratio.toFixed(1)}배`,
    missed_checkin_count: `정기 연락 ${Math.round(row.missed_checkin_count)}회 미응답`,
    door_activity_count: row.door_activity_count === 0 ? '최근 출입문 활동 없음' : `출입문 활동 ${Math.round(row.door_activity_count)}회`,
    recent_contact_success: row.recent_contact_success ? '최근 연락 확인 성공' : '최근 연락 확인 실패',
    repeated_alert_count: `최근 반복 경보 ${Math.round(row.repeated_alert_count)}회`,
    usual_inactive_minutes: `개인별 비활동 기준 ${Math.round(row.usual_inactive_minutes)}분 반영`,
    sensor_reliability: `센서 신뢰도 ${(row.sensor_reliability * 100).toFixed(0)}%`,
    alert_hour: `${String(Math.round(row.alert_hour)).padStart(2, '0')}시 생활 패턴 반영`,
    temperature_risk: ['온도 정상', '온도 주의', '온도 위험'][Math.round(row.temperature_risk)] || '온도 상태 확인',
    previous_false_alarm_count: `과거 오작동 ${Math.round(row.previous_false_alarm_count)}회`,
  };

  const positive = items.filter((item) => item.contribution > 0.0015).slice(0, 4);
  const selected = positive.length ? positive : items.slice(0, 3);
  return selected.map((item) => ({ ...item, detail: details[item.feature] }));
}

function analyze(model, row) {
  const rule = rulePrediction(row);
  const treeProbabilities = predictTree(model.decisionTree, row);
  const forestProbabilities = predictForest(model.randomForest, row);
  const rawForestLabel = highestLabel(forestProbabilities);
  const riskLevel = operationalLabel(forestProbabilities, model.highThreshold);
  const explanations = explain(model, row, riskLevel);
  return {
    riskLevel,
    probability: forestProbabilities[LABELS.indexOf(riskLevel)],
    probabilities: probabilitiesObject(forestProbabilities),
    reasons: explanations.map((item) => item.detail),
    explanations,
    modelOutputs: {
      ruleBased: { level: rule.label, score: rule.score },
      decisionTree: { level: highestLabel(treeProbabilities), probabilities: probabilitiesObject(treeProbabilities) },
      randomForest: {
        level: riskLevel,
        rawLevel: rawForestLabel,
        probabilities: probabilitiesObject(forestProbabilities),
        highThreshold: model.highThreshold,
      },
    },
  };
}

module.exports = {
  FEATURES,
  FEATURE_LABELS,
  LABELS,
  trainAll,
  analyze,
  generateSyntheticData,
};
