const fs = require('node:fs');
const path = require('node:path');
const { network } = require('hardhat');

function deploymentsPath(networkName = network.name) {
  return path.resolve('deployments', `${networkName}.json`);
}

function loadDeployments(networkName = network.name) {
  const filePath = deploymentsPath(networkName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing deployments file at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveDeployments(data, networkName = network.name) {
  const dir = path.resolve('deployments');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${networkName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

module.exports = {
  deploymentsPath,
  loadDeployments,
  saveDeployments,
};
