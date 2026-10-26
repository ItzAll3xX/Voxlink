const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

// Ensure PATH includes cargo directory for Tauri CLI & Rust toolchain
const cargoBin = 'C:\\Users\\Alex\\.cargo\\bin';
if (!process.env.PATH.includes(cargoBin)) {
  process.env.PATH = `${cargoBin};${process.env.PATH}`;
}

const PORT = 3000;

// Check if VoxLink server is reachable without starting it automatically
const testReq = http.get(`http://localhost:${PORT}`, (res) => {
  console.log('✅ VoxLink server is running on http://localhost:3000.');
  launchTauri();
});

testReq.on('error', () => {
  console.log('ℹ️  VoxLink server is not running on localhost:3000.');
  console.log('   (To host a server, run "Start VoxLink.bat" on your Desktop)');
  launchTauri();
});

function launchTauri() {
  console.log('🚀 Launching VoxLink Tauri desktop client...');
  const tauriCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const tauriProcess = spawn(tauriCmd, ['tauri', 'dev'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: process.env,
    shell: true
  });

  tauriProcess.on('exit', (code) => {
    console.log(`VoxLink desktop exited with code ${code}`);
    process.exit(code || 0);
  });

  process.on('SIGINT', () => process.exit());
  process.on('SIGTERM', () => process.exit());
}
