const fs = require('fs');
const path = require('path');

const seedFilesDir = path.join(__dirname, '..', 'seed', 'benchmark-files');

function resolveFilePath(filePath) {
  if (fs.existsSync(filePath)) {
    return filePath;
  }

  const fallbackPath = path.join(seedFilesDir, path.basename(filePath));
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }

  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(resolveFilePath(filePath), 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(resolveFilePath(filePath), 'utf8');
}

module.exports = { readJson, readText };
