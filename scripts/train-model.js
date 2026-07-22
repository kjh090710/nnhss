'use strict';
const fs = require('fs');
const path = require('path');
const { trainAll } = require('../src/ml');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
console.log('혼디봄 JavaScript 모델 학습을 시작합니다.');
const started = Date.now();
const { model, metrics } = trainAll({ count: 5200, treeCount: 46 });
fs.writeFileSync(path.join(dataDir, 'model.json'), JSON.stringify(model));
fs.writeFileSync(path.join(dataDir, 'metrics.json'), JSON.stringify(metrics, null, 2));
console.log(`완료: ${((Date.now() - started) / 1000).toFixed(1)}초`);
console.log(JSON.stringify({ threshold: metrics.highRiskThreshold, randomForest: metrics.models.randomForest }, null, 2));
