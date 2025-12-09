#!/usr/bin/env node

require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Get deployment configuration from environment variables
const DEPLOY_PATH = process.env.DEPLOY_PATH || '/opt/cast-magnet-link';
const SERVICE_NAME = process.env.DEPLOY_SERVICE_NAME || 'cast-magnet-link';

console.log('╔════════════════════════════════════════════════╗');
console.log('║      Deploying Cast Magnet Link (Localhost)   ║');
console.log('╚════════════════════════════════════════════════╝');
console.log(`     Deploy Path: ${DEPLOY_PATH.padEnd(28)}`);
console.log(`     Service:     ${SERVICE_NAME.padEnd(28)}`);
console.log();

try {
  // Check if deploying to same directory
  const currentDir = process.cwd();

  if (path.resolve(currentDir) === path.resolve(DEPLOY_PATH)) {
    console.log('ℹ Deploying in the current directory...\n');

    // Step 1: Install dependencies
    console.log('Installing dependencies...');
    execSync('npm install', { stdio: 'inherit' });
    console.log('✓ Dependencies installed successfully\n');

    // Step 2: Create data directory if it doesn't exist
    const dataDir = process.env.DATA_DIR || './data';
    if (!fs.existsSync(dataDir)) {
      console.log('Creating data directory...');
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('✓ Data directory created\n');
    }

    // Step 3: Check if .env exists
    if (!fs.existsSync('.env')) {
      console.log('⚠ Warning: .env file not found!');
      if (fs.existsSync('.env.example')) {
        console.log('   Copying .env.example to .env...');
        fs.copyFileSync('.env.example', '.env');
        console.log('✓ .env file created from .env.example');
        console.log('\n⚠ IMPORTANT: Please edit .env and configure the required values:');
        console.log('   - RD_ACCESS_TOKEN: Your Real-Debrid API token');
        console.log('   - WEBDAV_PASSWORD: Password for WebDAV authentication');
        console.log('   - Other optional settings\n');
        console.log('   Run: nano .env (or use your preferred editor)\n');
        process.exit(1);
      } else {
        console.log('   Error: .env.example not found. Please create .env manually.\n');
        process.exit(1);
      }
    }

    // Step 4: Check if systemd service exists
    const serviceFile = `/etc/systemd/system/${SERVICE_NAME}.service`;
    try {
      fs.accessSync(serviceFile, fs.constants.F_OK);
      console.log('Restarting systemd service...');
      execSync(`sudo systemctl restart ${SERVICE_NAME}`, { stdio: 'inherit' });
      console.log('✓ Service restarted successfully\n');
    } catch (err) {
      console.log('ℹ No systemd service found. You can:');
      console.log(`   1. Install service: sudo cp ${SERVICE_NAME}.service /etc/systemd/system/`);
      console.log(`   2. Enable service: sudo systemctl enable ${SERVICE_NAME}`);
      console.log(`   3. Start service: sudo systemctl start ${SERVICE_NAME}`);
      console.log('   OR');
      console.log('   Run directly: npm start\n');
    }

  } else {
    console.log(`ℹ Deploying from ${currentDir} to ${DEPLOY_PATH}...\n`);

    // Step 1: Create deploy directory if it doesn't exist
    if (!fs.existsSync(DEPLOY_PATH)) {
      console.log('Creating deployment directory...');
      execSync(`sudo mkdir -p ${DEPLOY_PATH}`, { stdio: 'inherit' });
      console.log('✓ Directory created\n');
    }

    // Step 2: Copy files to deployment directory
    console.log('Copying files to deployment directory...');
    const rsyncCmd = `sudo rsync -av --exclude 'node_modules' --exclude 'data' --exclude '.git' --exclude '.env' . ${DEPLOY_PATH}/`;
    execSync(rsyncCmd, { stdio: 'inherit' });
    console.log('✓ Files copied successfully\n');

    // Step 3: Install dependencies
    console.log('Installing dependencies...');
    execSync(`cd ${DEPLOY_PATH} && sudo npm install`, { stdio: 'inherit' });
    console.log('✓ Dependencies installed\n');

    // Step 4: Create data directory
    const dataDir = process.env.DATA_DIR || 'data';
    execSync(`sudo mkdir -p ${DEPLOY_PATH}/${dataDir}`, { stdio: 'inherit' });

    // Step 5: Setup systemd service
    try {
      console.log('Installing systemd service...');
      execSync(`sudo cp ${DEPLOY_PATH}/${SERVICE_NAME}.service /etc/systemd/system/`, { stdio: 'inherit' });
      execSync('sudo systemctl daemon-reload', { stdio: 'inherit' });
      execSync(`sudo systemctl enable ${SERVICE_NAME}`, { stdio: 'inherit' });
      execSync(`sudo systemctl restart ${SERVICE_NAME}`, { stdio: 'inherit' });
      console.log('✓ Service installed and started\n');
    } catch (err) {
      console.log('⚠ Warning: Could not setup systemd service automatically');
      console.log('   Please setup manually using the README instructions\n');
    }
  }

  console.log('✓ Deployment completed successfully.');
  console.log(`\nTo view logs, run: sudo journalctl -u ${SERVICE_NAME} -f`);
  console.log('Or run directly: npm start\n');

} catch (error) {
  console.error('× Deployment failed:', error.message);
  process.exit(1);
}
