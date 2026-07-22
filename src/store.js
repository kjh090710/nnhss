'use strict';
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(filePath, seedFactory) {
    this.filePath = filePath;
    this.seedFactory = seedFactory;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.ensure();
  }

  ensure() {
    if (!fs.existsSync(this.filePath)) this.write(this.seedFactory());
  }

  read() {
    this.ensure();
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      const backup = `${this.filePath}.${Date.now()}.corrupt`;
      try { fs.copyFileSync(this.filePath, backup); } catch (_) {}
      const state = this.seedFactory();
      this.write(state);
      return state;
    }
  }

  write(state) {
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, this.filePath);
    return state;
  }

  update(mutator) {
    const state = this.read();
    const result = mutator(state);
    this.write(state);
    return result;
  }

  reset() {
    const state = this.seedFactory();
    this.write(state);
    return state;
  }
}

module.exports = { JsonStore };
