const { spawn, exec } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3000;
let qrcode = null;
try {
  qrcode = require('qrcode-terminal');
} catch (e) {}

console.clear();
console.log('\x1b[36m%s\x1b[0m', '========================================================');
console.log('\x1b[36m%s\x1b[0m', '            VOXLINK ONLINE PUBLIC LAUNCHER              ');
console.log('\x1b[36m%s\x1b[0m', '========================================================\n');

// 1. Ensure local server is running
function checkServer(cb) {
  const req = http.get(`http://localhost:${PORT}`, (res) => {
    cb(true);
  });
  req.on('error', () => {
    cb(false);
  });
}

checkServer((isRunning) => {
  if (!isRunning) {
    console.log('⚡ Starting VoxLink server in background on port 3000...');
    const serverProc = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });
    serverProc.on('error', (err) => console.error('Failed to spawn server:', err));
    setTimeout(startTunnel, 1800);
  } else {
    console.log('✅ Local VoxLink server is already running on port 3000.');
    startTunnel();
  }
});

function copyToClipboard(text) {
  if (process.platform === 'win32') {
    const proc = spawn('clip', { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.stdin.write(text);
    proc.stdin.end();
  }
}

function startTunnel() {
  const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
  if (fs.existsSync(cloudflaredPath)) {
    startCloudflare(cloudflaredPath);
  } else {
    startLocaltunnel();
  }
}

function startCloudflare(binPath) {
  console.log('🌐 Connecting to Cloudflare global network (zero-config, high speed)...');
  const tunnel = spawn(binPath, ['tunnel', '--url', `http://localhost:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let urlFound = false;

  const handleOutput = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !urlFound) {
      urlFound = true;
      const publicUrl = match[0];
      displayPublicInfo(publicUrl);
    }
  };

  tunnel.stdout.on('data', handleOutput);
  tunnel.stderr.on('data', handleOutput);

  tunnel.on('close', (code) => {
    console.log(`\nTunnel closed (code ${code}).`);
  });

  process.on('SIGINT', () => {
    try { tunnel.kill(); } catch (e) {}
    process.exit();
  });
}

function startLocaltunnel() {
  console.log('🌐 Starting localtunnel fallback...');
  try {
    const localtunnel = require('localtunnel');
    localtunnel({ port: PORT }).then((tunnel) => {
      displayPublicInfo(tunnel.url);
      tunnel.on('close', () => console.log('Tunnel closed.'));
    }).catch(err => {
      console.error('Localtunnel error:', err);
    });
  } catch (err) {
    console.error('Neither cloudflared nor localtunnel is available.');
  }
}

function displayPublicInfo(publicUrl) {
  copyToClipboard(publicUrl);

  console.log('\n\x1b[32m%s\x1b[0m', '========================================================================');
  console.log('\x1b[32m%s\x1b[0m', '              🎉 VOXLINK IS LIVE ONLINE AND PUBLIC!                     ');
  console.log('\x1b[32m%s\x1b[0m', '========================================================================\n');

  console.log('\x1b[1m\x1b[33m%s\x1b[0m', '🔗 PUBLIC LINK FOR FRIENDS & MOBILE:');
  console.log('\x1b[1m\x1b[36m   %s\x1b[0m', publicUrl);
  console.log('\x1b[90m%s\x1b[0m\n', '   (Copied to your clipboard automatically! Paste with Ctrl+V)');

  if (qrcode) {
    console.log('\x1b[33m%s\x1b[0m', '📲 SCAN WITH ANDROID / IPHONE TO JOIN INSTANTLY:');
    qrcode.generate(publicUrl, { small: true });
    console.log('');
  }

  console.log('\x1b[35m%s\x1b[0m', '📱 ANDROID / MOBILE:');
  console.log('   - Instant Web/PWA: Open the link above in Chrome, tap "Install App"');
  console.log('   - Native Android App: Install "VoxLink.apk" (from Desktop) for full');
  console.log('     system screen sharing (stream games like Roblox, Minecraft, etc.)!\n');

  console.log('\x1b[34m%s\x1b[0m', '💻 PC / DESKTOP (FRIENDS):');
  console.log('   Send your friends the "VoxLink_Setup.exe" installer.');
  console.log('   When they open VoxLink, they can click "⚙️ Change" next to Server');
  console.log('   and paste your link above to connect to your server!\n');

  console.log('\x1b[32m%s\x1b[0m', '========================================================================');
  console.log('Keep this window open while chatting. Press Ctrl+C to stop.\n');
}
