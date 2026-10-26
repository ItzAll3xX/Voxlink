const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Support large payloads for animated GIFs, avatars, and screen captures
const io = new Server(server, {
  maxHttpBufferSize: 50 * 1024 * 1024,
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, pathUrl) => {
    if (pathUrl.endsWith('.html') || pathUrl.endsWith('.js') || pathUrl.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.post('/api/upload', (req, res) => {
  try {
    const { data, name } = req.body || {};
    if (!data) return res.status(400).json({ error: 'No data provided' });
    const savedUrl = saveBase64Media(data, 'upload', 'http');
    res.json({ url: savedUrl, name: name || 'file' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const DATA_DIR = path.join(__dirname, 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const DMS_FILE = path.join(DATA_DIR, 'dms.json');
const FRIENDS_FILE = path.join(DATA_DIR, 'friends.json');
const GROUPS_FILE = path.join(DATA_DIR, 'dm_groups.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function saveBase64Media(dataUrl, prefix, userId) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return dataUrl;
  try {
    const matches = dataUrl.match(/^data:([A-Za-z0-9\/\-+.]+);base64,([\s\S]+)$/);
    if (!matches || matches.length !== 3) return dataUrl;
    const mime = matches[1].toLowerCase();
    let ext = 'bin';
    if (mime.includes('gif')) ext = 'gif';
    else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
    else if (mime.includes('png')) ext = 'png';
    else if (mime.includes('webp')) ext = 'webp';
    else if (mime.includes('svg')) ext = 'svg';
    else if (mime.includes('mp4')) ext = 'mp4';
    else if (mime.includes('webm')) ext = 'webm';
    else if (mime.includes('quicktime') || mime.includes('mov')) ext = 'mov';
    else if (mime.includes('mkv')) ext = 'mkv';
    else if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
    else if (mime.includes('ogg')) ext = 'ogg';
    else if (mime.includes('wav')) ext = 'wav';
    else if (mime.includes('m4a')) ext = 'm4a';
    else if (mime.includes('aac')) ext = 'aac';
    else if (mime.includes('flac')) ext = 'flac';

    const base64Data = matches[2].replace(/\s/g, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filename = `${prefix}_${userId}_${Date.now()}.${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    return `/uploads/${filename}`;
  } catch (err) {
    console.error('Error saving base64 media:', err);
    return dataUrl;
  }
}

function loadJSON(filePath, defaultVal) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error loading ${filePath}:`, err);
  }
  return defaultVal;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error saving ${filePath}:`, err);
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return testHash === hash;
}

let accounts = loadJSON(ACCOUNTS_FILE, {});
let savedServers = loadJSON(SERVERS_FILE, {});
let savedSessions = loadJSON(SESSIONS_FILE, {});

// Migrate any existing base64 avatars/banners to disk files
let needsAccountSave = false;
for (const uid in accounts) {
  const acc = accounts[uid];
  if (acc.avatarUrl && acc.avatarUrl.startsWith('data:')) {
    acc.avatarUrl = saveBase64Media(acc.avatarUrl, 'avatar', uid);
    needsAccountSave = true;
  }
  if (acc.bannerUrl && acc.bannerUrl.startsWith('data:')) {
    acc.bannerUrl = saveBase64Media(acc.bannerUrl, 'banner', uid);
    needsAccountSave = true;
  }
}
if (needsAccountSave) {
  saveJSON(ACCOUNTS_FILE, accounts);
  console.log('Migrated accounts base64 avatars/banners to disk files.');
}

let needsServerSave = false;
for (const sId in savedServers) {
  const s = savedServers[sId];
  if (sId === 'main-server') {
    if (!s.isOfficial) { s.isOfficial = true; needsServerSave = true; }
    if (!s.inviteCode) { s.inviteCode = 'VOXLINK'; needsServerSave = true; }
  } else {
    if (s.isOfficial === undefined) { s.isOfficial = false; needsServerSave = true; }
    if (!s.inviteCode) { s.inviteCode = 'VOX-' + Math.random().toString(36).substr(2, 6).toUpperCase(); needsServerSave = true; }
  }
}
if (needsServerSave) saveJSON(SERVERS_FILE, savedServers);

const activeSessions = new Map(Object.entries(savedSessions));
const socketUserMap = new Map();
const liveUsers = new Map();

// Persistent DMs & Friends & Groups
const savedDMs = loadJSON(DMS_FILE, {});
const dmStore = new Map(Object.entries(savedDMs));
const savedFriends = loadJSON(FRIENDS_FILE, {}); // { userId: { friends: [ids], incoming: [ids], outgoing: [ids] } }
const savedGroups = loadJSON(GROUPS_FILE, {}); // { groupId: { id, name, ownerId, members: [userIds], avatarUrl, createdAt } }

function persistDMs() {
  const obj = {};
  for (const [k, v] of dmStore.entries()) {
    obj[k] = v;
  }
  saveJSON(DMS_FILE, obj);
}

function persistFriends() {
  saveJSON(FRIENDS_FILE, savedFriends);
}

function persistGroups() {
  saveJSON(GROUPS_FILE, savedGroups);
}

function getFriendData(userId) {
  if (!savedFriends[userId]) {
    savedFriends[userId] = { friends: [], incoming: [], outgoing: [] };
  }
  return savedFriends[userId];
}

const userSlowmodeMap = new Map();

const PERMISSIONS = [
  { id: 'MANAGE_SERVER', label: 'Manage Server' },
  { id: 'MANAGE_CHANNELS', label: 'Manage Channels & Categories' },
  { id: 'MANAGE_ROLES', label: 'Manage Roles & Permissions' },
  { id: 'KICK_MEMBERS', label: 'Kick Members' },
  { id: 'BAN_MEMBERS', label: 'Ban Members' },
  { id: 'SEND_MESSAGES', label: 'Send Messages' },
  { id: 'CONNECT_VOICE', label: 'Connect to Voice' },
  { id: 'SHARE_VIDEO', label: 'Share Camera & Screen' }
];

const AVATAR_COLORS = [
  '#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245',
  '#00B0F4', '#F47B67', '#3BA55D', '#FAA61A', '#7289DA'
];

function getRandomColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function getDmKey(id1, id2) {
  return [id1, id2].sort().join('::');
}

function createServerStructure(id, name, ownerId, icon = null, banner = null) {
  return {
    id,
    name,
    icon: icon || name.substring(0, 2).toUpperCase(),
    iconUrl: null,
    bannerUrl: banner || null,
    ownerId,
    isOfficial: false,
    inviteCode: 'VOX-' + Math.random().toString(36).substring(2, 7).toUpperCase(),
    bans: [], // array of { userId, username, reason, bannedAt }
    categories: [
      {
        id: 'cat-welcome-' + id,
        name: 'WELCOME & RULES',
        channels: [
          { id: 'welcome-' + id, type: 'text', name: 'welcome', topic: 'Welcome to our server!' }
        ]
      },
      {
        id: 'cat-chat-' + id,
        name: 'TEXT CHANNELS',
        channels: [
          { id: 'general-' + id, type: 'text', name: 'general', topic: 'General hangouts and chat' },
          { id: 'gaming-' + id, type: 'text', name: 'gaming-talk', topic: 'Game clips and discussions' }
        ]
      },
      {
        id: 'cat-voice-' + id,
        name: 'VOICE & VIDEO',
        channels: [
          { id: 'lounge-' + id, type: 'voice', name: 'Lounge' },
          { id: 'stream-room-' + id, type: 'voice', name: 'Stream Room' }
        ]
      }
    ],
    roles: [
      {
        id: 'role-owner-' + id,
        name: 'Server Owner',
        color: '#FEE75C',
        badge: '👑',
        permissions: ['ALL'],
        position: 100
      },
      {
        id: 'role-admin-' + id,
        name: 'Admin',
        color: '#EB459E',
        badge: '🛡️',
        permissions: ['MANAGE_SERVER', 'MANAGE_CHANNELS', 'MANAGE_ROLES', 'KICK_MEMBERS', 'BAN_MEMBERS', 'SEND_MESSAGES', 'CONNECT_VOICE', 'SHARE_VIDEO'],
        position: 80
      },
      {
        id: 'role-member-' + id,
        name: 'Member',
        color: '#949BA4',
        badge: '',
        permissions: ['SEND_MESSAGES', 'CONNECT_VOICE', 'SHARE_VIDEO'],
        position: 10
      }
    ],
    memberRoles: {},
    messages: {
      ['welcome-' + id]: [],
      ['general-' + id]: [],
      ['gaming-' + id]: []
    }
  };
}

if (Object.keys(savedServers).length === 0) {
  const mainServer = createServerStructure('main-server', 'VoxLink Official', 'system', 'VL');
  savedServers['main-server'] = mainServer;
  saveJSON(SERVERS_FILE, savedServers);
}

function hasPermission(serverObj, userId, perm) {
  if (serverObj.ownerId === userId) return true;
  const userRoles = serverObj.memberRoles[userId] || ['role-member-' + serverObj.id];
  for (const rId of userRoles) {
    const role = serverObj.roles.find(r => r.id === rId);
    if (!role) continue;
    if (role.permissions.includes('ALL') || role.permissions.includes(perm)) return true;
  }
  return false;
}

io.on('connection', (socket) => {
  // Auth
  socket.on('auth-register', ({ username, password, customStatus, avatarUrl }) => {
    const cleanUser = (username || '').trim().toLowerCase();
    if (!cleanUser || cleanUser.length < 3 || cleanUser.length > 24) {
      return socket.emit('auth-error', 'Username must be between 3 and 24 characters.');
    }
    if (!password || password.length < 4) {
      return socket.emit('auth-error', 'Password must be at least 4 characters.');
    }

    for (const uid in accounts) {
      if (accounts[uid].username.toLowerCase() === cleanUser) {
        return socket.emit('auth-error', 'Username is already taken.');
      }
    }

    const isFirstEverAccount = Object.keys(accounts).length === 0;
    const { salt, hash } = hashPassword(password);
    const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    const globalBadges = isFirstEverAccount ? ['PROJECT_OWNER', 'DEVELOPER'] : [];

    const newAccount = {
      id: userId,
      username: username.trim(),
      salt,
      hash,
      color: getRandomColor(),
      avatarUrl: avatarUrl || null,
      customStatus: customStatus || 'Online',
      globalBadges,
      createdAt: new Date().toISOString()
    };

    accounts[userId] = newAccount;
    saveJSON(ACCOUNTS_FILE, accounts);

    if (isFirstEverAccount && savedServers['main-server'].ownerId === 'system') {
      savedServers['main-server'].ownerId = userId;
      savedServers['main-server'].memberRoles[userId] = ['role-owner-main-server'];
      saveJSON(SERVERS_FILE, savedServers);
    }

    loginSuccess(socket, newAccount);
  });

  socket.on('auth-login', ({ username, password }) => {
    const cleanUser = (username || '').trim().toLowerCase();
    let foundAccount = null;

    for (const uid in accounts) {
      if (accounts[uid].username.toLowerCase() === cleanUser) {
        foundAccount = accounts[uid];
        break;
      }
    }

    if (!foundAccount || !verifyPassword(password, foundAccount.salt, foundAccount.hash)) {
      return socket.emit('auth-error', 'Invalid username or password.');
    }

    loginSuccess(socket, foundAccount);
  });

  socket.on('auth-token', ({ token }) => {
    const userId = activeSessions.get(token);
    if (!userId || !accounts[userId]) {
      return socket.emit('auth-required');
    }
    loginSuccess(socket, accounts[userId], token);
  });

  function getPublicAccounts() {
    return Object.values(accounts).map(a => ({
      id: a.id,
      username: a.username,
      color: a.color,
      avatarUrl: a.avatarUrl,
      bannerUrl: a.bannerUrl || null,
      bannerColor: a.bannerColor || null,
      bio: a.bio || '',
      googleEmail: a.googleEmail || null,
      customStatus: a.customStatus,
      globalBadges: a.globalBadges || []
    }));
  }

  function loginSuccess(sock, account, existingToken = null) {
    const token = existingToken || crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, account.id);
    socketUserMap.set(sock.id, account.id);

    // Save sessions to disk so restarts preserve logins seamlessly
    savedSessions[token] = account.id;
    saveJSON(SESSIONS_FILE, savedSessions);

    // Register into official main-server if not banned or kicked
    if (savedServers['main-server']) {
      const mainSrv = savedServers['main-server'];
      const isBanned = mainSrv.bans && mainSrv.bans.some(b => b.userId === account.id);
      const isKicked = mainSrv.kicks && mainSrv.kicks.includes(account.id);
      if (!isBanned && !isKicked && (!mainSrv.memberRoles || !mainSrv.memberRoles[account.id])) {
        if (!mainSrv.memberRoles) mainSrv.memberRoles = {};
        mainSrv.memberRoles[account.id] = ['role-member-main-server'];
      }
    }
    saveJSON(SERVERS_FILE, savedServers);

    const liveUser = {
      socketId: sock.id,
      id: account.id,
      username: account.username,
      color: account.color,
      avatarUrl: account.avatarUrl,
      bannerUrl: account.bannerUrl || null,
      bannerColor: account.bannerColor || null,
      bio: account.bio || '',
      googleEmail: account.googleEmail || null,
      customStatus: account.customStatus,
      globalBadges: account.globalBadges || [],
      currentVoice: null,
      currentVoiceServer: null,
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
      isVideoOn: false,
      isScreenSharing: false
    };
    liveUsers.set(account.id, liveUser);

    const userServers = Object.values(savedServers).filter(s => (s.memberRoles && s.memberRoles[account.id]) || s.ownerId === account.id);

    sock.emit('auth-success', {
      token,
      self: liveUser,
      servers: userServers,
      users: Array.from(liveUsers.values()),
      allUsers: getPublicAccounts(),
      permissionsList: PERMISSIONS
    });

    sock.broadcast.emit('user-connected', { user: liveUser, allUsers: getPublicAccounts() });
  }

  // Google One-Click / Quick Login
  socket.on('auth-google', ({ email, name, avatarUrl }) => {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) return socket.emit('auth-error', 'Google authentication failed: Email is required.');

    let foundAccount = null;
    for (const uid in accounts) {
      if ((accounts[uid].email && accounts[uid].email.toLowerCase() === cleanEmail) ||
          accounts[uid].username.toLowerCase() === (name || '').trim().toLowerCase()) {
        foundAccount = accounts[uid];
        break;
      }
    }

    if (!foundAccount) {
      const isFirstEverAccount = Object.keys(accounts).length === 0;
      const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const globalBadges = isFirstEverAccount ? ['PROJECT_OWNER', 'DEVELOPER'] : [];
      let baseName = (name || cleanEmail.split('@')[0]).replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 20) || 'GoogleUser';
      let finalName = baseName;
      let counter = 1;
      while (Object.values(accounts).some(a => a.username.toLowerCase() === finalName.toLowerCase())) {
        finalName = `${baseName}_${counter++}`;
      }

      const { salt, hash } = hashPassword(crypto.randomBytes(16).toString('hex'));
      foundAccount = {
        id: userId,
        email: cleanEmail,
        username: finalName,
        salt,
        hash,
        color: getRandomColor(),
        avatarUrl: avatarUrl || 'https://lh3.googleusercontent.com/a/default-user=s96-c',
        customStatus: 'Connected with Google',
        globalBadges,
        createdAt: new Date().toISOString()
      };
      accounts[userId] = foundAccount;
      saveJSON(ACCOUNTS_FILE, accounts);

      if (isFirstEverAccount && savedServers['main-server'].ownerId === 'system') {
        savedServers['main-server'].ownerId = userId;
        savedServers['main-server'].memberRoles[userId] = ['role-owner-main-server'];
        saveJSON(SERVERS_FILE, savedServers);
      }
    }

    loginSuccess(socket, foundAccount);
  });

  // Instant Quick Demo Login
  socket.on('auth-quick', ({ guestName }) => {
    let name = (guestName || '').trim();
    if (!name) name = 'Guest_' + Math.floor(1000 + Math.random() * 9000);
    name = name.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 20);

    let finalName = name;
    let counter = 1;
    while (Object.values(accounts).some(a => a.username.toLowerCase() === finalName.toLowerCase())) {
      finalName = `${name}_${counter++}`;
    }

    const isFirstEverAccount = Object.keys(accounts).length === 0;
    const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const globalBadges = isFirstEverAccount ? ['PROJECT_OWNER', 'DEVELOPER'] : [];
    const { salt, hash } = hashPassword('guest_' + userId);

    const newAccount = {
      id: userId,
      username: finalName,
      salt,
      hash,
      color: getRandomColor(),
      avatarUrl: null,
      customStatus: '⚡ Quick Guest',
      globalBadges,
      createdAt: new Date().toISOString()
    };

    accounts[userId] = newAccount;
    saveJSON(ACCOUNTS_FILE, accounts);

    if (isFirstEverAccount && savedServers['main-server'].ownerId === 'system') {
      savedServers['main-server'].ownerId = userId;
      savedServers['main-server'].memberRoles[userId] = ['role-owner-main-server'];
      saveJSON(SERVERS_FILE, savedServers);
    }

    loginSuccess(socket, newAccount);
  });

  // Global Badges (CREATOR ONLY)
  socket.on('toggle-global-badge', ({ targetUserId, badge }) => {
    const callerId = socketUserMap.get(socket.id);
    const callerAcc = accounts[callerId];
    if (!callerAcc || (!callerAcc.globalBadges.includes('PROJECT_OWNER') && !callerAcc.globalBadges.includes('CREATOR'))) {
      return socket.emit('error-msg', 'Only the Creator can grant or revoke global developer badges.');
    }

    const targetAcc = accounts[targetUserId];
    if (!targetAcc) return;

    if (badge === 'DEVELOPER') {
      if (targetAcc.globalBadges.includes('DEVELOPER')) {
        targetAcc.globalBadges = targetAcc.globalBadges.filter(b => b !== 'DEVELOPER');
      } else {
        targetAcc.globalBadges.push('DEVELOPER');
      }
      saveJSON(ACCOUNTS_FILE, accounts);

      const live = liveUsers.get(targetUserId);
      if (live) live.globalBadges = targetAcc.globalBadges;

      io.emit('global-badge-updated', {
        userId: targetUserId,
        globalBadges: targetAcc.globalBadges
      });
    }
  });

  // Profile Updates (propagates to all past messages, DMs, rosters, and clients)
  socket.on('update-profile', ({ username, avatarUrl, customStatus, bannerUrl, bannerColor, bio }) => {
    const userId = socketUserMap.get(socket.id);
    const account = accounts[userId];
    if (!account) return;

    if (username && username.trim().length >= 3) account.username = username.trim().substring(0, 24);
    if (avatarUrl !== undefined) account.avatarUrl = saveBase64Media(avatarUrl, 'avatar', userId);
    if (bannerUrl !== undefined) account.bannerUrl = saveBase64Media(bannerUrl, 'banner', userId);
    if (bannerColor !== undefined) account.bannerColor = bannerColor;
    if (bio !== undefined) account.bio = bio.trim().substring(0, 300);
    if (customStatus !== undefined) account.customStatus = customStatus.trim().substring(0, 40);

    saveJSON(ACCOUNTS_FILE, accounts);
    console.log(`[Profile Update] User ${account.username} (${userId}) updated: avatar=${Boolean(account.avatarUrl)}, banner=${Boolean(account.bannerUrl)}, color=${account.bannerColor}`);

    // 1. Update all messages stored across all servers
    for (const sId in savedServers) {
      const srv = savedServers[sId];
      if (srv.messages) {
        for (const chId in srv.messages) {
          const list = srv.messages[chId];
          if (Array.isArray(list)) {
            for (const msg of list) {
              if (msg.senderId === userId) {
                if (avatarUrl !== undefined) msg.avatarUrl = account.avatarUrl;
                if (username) msg.username = account.username;
              }
              if (msg.replyTo && msg.replyTo.senderId === userId) {
                if (username) msg.replyTo.username = account.username;
              }
            }
          }
        }
      }
    }
    saveJSON(SERVERS_FILE, savedServers);

    // 2. Update all DMs in memory
    for (const [key, dmMessages] of dmStore.entries()) {
      if (Array.isArray(dmMessages)) {
        for (const dm of dmMessages) {
          if (dm.senderId === userId) {
            if (avatarUrl !== undefined) dm.avatarUrl = account.avatarUrl;
            if (username) dm.username = account.username;
          }
          if (dm.replyTo && dm.replyTo.senderId === userId) {
            if (username) dm.replyTo.username = account.username;
          }
        }
      }
    }

    const live = liveUsers.get(userId);
    if (live) {
      live.username = account.username;
      live.avatarUrl = account.avatarUrl;
      live.bannerUrl = account.bannerUrl;
      live.bannerColor = account.bannerColor;
      live.bio = account.bio;
      live.customStatus = account.customStatus;
      io.emit('user-state-changed', live);
    }

    // 3. Broadcast profile update to all clients to refresh DOM messages and member lists
    io.emit('user-profile-updated', {
      userId,
      username: account.username,
      avatarUrl: account.avatarUrl,
      bannerUrl: account.bannerUrl,
      bannerColor: account.bannerColor,
      bio: account.bio,
      googleEmail: account.googleEmail,
      customStatus: account.customStatus,
      globalBadges: account.globalBadges || []
    });
  });

  // Link Google Account to existing account
  socket.on('link-google-account', ({ googleEmail, googleName, googleAvatar }) => {
    const userId = socketUserMap.get(socket.id);
    const account = accounts[userId];
    if (!account) return;

    const cleanEmail = (googleEmail || '').trim().toLowerCase();
    if (!cleanEmail) return socket.emit('error-msg', 'Invalid Google email.');

    // Check if another account is already linked to this email
    for (const uid in accounts) {
      if (uid !== userId && accounts[uid].googleEmail && accounts[uid].googleEmail.toLowerCase() === cleanEmail) {
        return socket.emit('error-msg', 'This Google account is already linked to another VoxLink user.');
      }
    }

    account.googleEmail = cleanEmail;
    if (googleAvatar && !account.avatarUrl) {
      account.avatarUrl = googleAvatar;
    }
    saveJSON(ACCOUNTS_FILE, accounts);

    socket.emit('google-linked-success', {
      googleEmail: account.googleEmail,
      avatarUrl: account.avatarUrl
    });

    io.emit('user-profile-updated', {
      userId,
      username: account.username,
      avatarUrl: account.avatarUrl,
      bannerUrl: account.bannerUrl,
      bannerColor: account.bannerColor,
      bio: account.bio,
      googleEmail: account.googleEmail,
      customStatus: account.customStatus,
      globalBadges: account.globalBadges || []
    });
  });

  // Server Management & Invites
  socket.on('create-server', ({ name, icon, bannerUrl, iconUrl }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;

    const sName = (name || 'New Server').trim().substring(0, 30);
    const serverId = 'srv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    const newServer = createServerStructure(serverId, sName, userId, icon, bannerUrl);
    newServer.iconUrl = iconUrl || null;
    newServer.memberRoles = {
      [userId]: ['role-owner-' + serverId]
    };
    newServer.isOfficial = false;
    newServer.inviteCode = 'VOX-' + Math.random().toString(36).substring(2, 7).toUpperCase();

    savedServers[serverId] = newServer;
    saveJSON(SERVERS_FILE, savedServers);

    socket.emit('server-created', newServer);
  });

  socket.on('join-server-code', ({ code }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;

    const cleanCode = (code || '').trim().toUpperCase();
    if (!cleanCode) return socket.emit('error-msg', 'Please enter a valid invite code.');

    let targetServer = null;
    for (const sId in savedServers) {
      const s = savedServers[sId];
      if ((s.inviteCode && s.inviteCode.toUpperCase() === cleanCode) || s.id.toUpperCase() === cleanCode) {
        targetServer = s;
        break;
      }
    }

    if (!targetServer) return socket.emit('error-msg', 'Invalid or expired invite code.');

    const isBanned = targetServer.bans && targetServer.bans.some(b => b.userId === userId);
    if (isBanned) return socket.emit('error-msg', 'You are banned from this server.');

    // Clear previous kick flag if rejoining via valid invite
    if (targetServer.kicks && targetServer.kicks.includes(userId)) {
      targetServer.kicks = targetServer.kicks.filter(id => id !== userId);
    }

    if (!targetServer.memberRoles) targetServer.memberRoles = {};
    if (!targetServer.memberRoles[userId]) {
      const defaultRole = targetServer.roles.find(r => r.name === 'Member' || r.position === 10) || targetServer.roles[targetServer.roles.length - 1];
      targetServer.memberRoles[userId] = [defaultRole ? defaultRole.id : ('role-member-' + targetServer.id)];
      saveJSON(SERVERS_FILE, savedServers);
    }

    socket.emit('server-joined', targetServer);
    io.emit('server-updated', targetServer);
  });

  socket.on('send-server-invite-dm', ({ serverId, targetUserId }) => {
    const userId = socketUserMap.get(socket.id);
    const sender = accounts[userId];
    const target = accounts[targetUserId];
    const srv = savedServers[serverId];
    if (!sender || !target || !srv) return;

    const memberCount = Object.keys(srv.memberRoles || {}).length;
    const invitePayload = {
      serverId: srv.id,
      serverName: srv.name,
      iconUrl: srv.iconUrl,
      icon: srv.icon,
      isOfficial: Boolean(srv.isOfficial),
      inviteCode: srv.inviteCode,
      memberCount
    };

    const key = getDmKey(sender.id, target.id);
    const dmMsg = {
      id: 'dm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      senderId: sender.id,
      targetId: target.id,
      username: sender.username,
      color: sender.color,
      avatarUrl: sender.avatarUrl,
      globalBadges: sender.globalBadges || [],
      text: `Join my server **${srv.name}**! Use code: \`${srv.inviteCode}\``,
      serverInvite: invitePayload,
      attachment: null,
      voiceNote: null,
      replyTo: null,
      reactions: {},
      isEdited: false,
      timestamp: new Date().toISOString()
    };

    if (!dmStore.has(key)) dmStore.set(key, []);
    const list = dmStore.get(key);
    list.push(dmMsg);
    if (list.length > 100) list.shift();

    socket.emit('new-dm', { dmKey: key, message: dmMsg, peerId: target.id });
    const liveTarget = liveUsers.get(target.id);
    if (liveTarget) {
      io.to(liveTarget.socketId).emit('new-dm', { dmKey: key, message: dmMsg, peerId: sender.id });
    }
  });

  socket.on('update-server-overview', ({ serverId, name, iconUrl, bannerUrl, isOfficial, inviteCode }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_SERVER')) return;

    if (name && name.trim()) srv.name = name.trim().substring(0, 30);
    if (iconUrl !== undefined) srv.iconUrl = iconUrl;
    if (bannerUrl !== undefined) srv.bannerUrl = bannerUrl;
    if (inviteCode && inviteCode.trim()) srv.inviteCode = inviteCode.trim().toUpperCase().substring(0, 16);

    const userAcc = accounts[userId];
    const isDevOrCreator = Boolean(userAcc && userAcc.globalBadges && (
      userAcc.globalBadges.includes('PROJECT_OWNER') ||
      userAcc.globalBadges.includes('CREATOR') ||
      userAcc.globalBadges.includes('DEVELOPER')
    ));

    // Verified / Official badge can ONLY be granted or revoked by Developers and Creator
    if (isOfficial !== undefined && Boolean(isOfficial) !== Boolean(srv.isOfficial)) {
      if (!isDevOrCreator) {
        return socket.emit('error-msg', 'Only Developers and the Creator role can grant or revoke Verified Server status.');
      }
      srv.isOfficial = Boolean(isOfficial);
    }

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  socket.on('toggle-server-verified', ({ serverId }) => {
    const userId = socketUserMap.get(socket.id);
    const userAcc = accounts[userId];
    const isDevOrCreator = Boolean(userAcc && userAcc.globalBadges && (
      userAcc.globalBadges.includes('PROJECT_OWNER') ||
      userAcc.globalBadges.includes('CREATOR') ||
      userAcc.globalBadges.includes('DEVELOPER')
    ));

    if (!isDevOrCreator) {
      return socket.emit('error-msg', 'Only Developers and the Creator role can grant or revoke Verified Server status.');
    }

    const srv = savedServers[serverId];
    if (!srv) return;

    srv.isOfficial = !srv.isOfficial;
    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  socket.on('delete-server', ({ serverId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || srv.ownerId !== userId) return;

    // Cannot delete main default server
    if (serverId === 'main-server') return socket.emit('error-msg', 'Cannot delete the main official server.');

    delete savedServers[serverId];
    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-deleted', { serverId });
  });

  // Category Operations
  socket.on('create-category', ({ serverId, name }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_CHANNELS')) return;

    const catName = (name || 'NEW CATEGORY').toUpperCase().trim().substring(0, 30);
    const category = { id: 'cat_' + Date.now(), name: catName, channels: [] };
    srv.categories.push(category);

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  socket.on('rename-category', ({ serverId, categoryId, name }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_CHANNELS')) return;

    const cat = srv.categories.find(c => c.id === categoryId);
    if (cat && name) {
      cat.name = name.toUpperCase().trim().substring(0, 30);
      saveJSON(SERVERS_FILE, savedServers);
      io.emit('server-updated', srv);
    }
  });

  socket.on('delete-category', ({ serverId, categoryId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_CHANNELS')) return;

    srv.categories = srv.categories.filter(c => c.id !== categoryId);
    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  // Channel Operations
  socket.on('create-channel', ({ serverId, categoryId, type, name, topic, isPrivate, allowedRoles, rolePermissions, userLimit, slowmode }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_CHANNELS')) return;

    const targetCat = srv.categories.find(c => c.id === categoryId) || srv.categories[0];
    if (!targetCat) return;

    const cleanName = (name || 'channel').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');
    const chId = 'ch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);

    const parsedLimit = type === 'voice' ? Math.max(0, Math.min(99, parseInt(userLimit, 10) || 0)) : 0;
    const parsedSlowmode = type === 'text' ? Math.max(0, Math.min(3600, parseInt(slowmode, 10) || 0)) : 0;

    const newChannel = {
      id: chId,
      type: type === 'voice' ? 'voice' : 'text',
      name: cleanName,
      topic: topic || '',
      isPrivate: Boolean(isPrivate),
      allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [],
      rolePermissions: rolePermissions && typeof rolePermissions === 'object' ? rolePermissions : {},
      userLimit: parsedLimit,
      slowmode: parsedSlowmode
    };

    targetCat.channels.push(newChannel);
    if (newChannel.type === 'text') srv.messages[chId] = [];

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  socket.on('edit-channel', ({ serverId, channelId, name, topic, isPrivate, allowedRoles, rolePermissions, userLimit, slowmode }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_CHANNELS')) return;

    for (const cat of srv.categories) {
      const ch = cat.channels.find(c => c.id === channelId);
      if (ch) {
        if (name) ch.name = name.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');
        if (topic !== undefined) ch.topic = topic;
        if (isPrivate !== undefined) ch.isPrivate = Boolean(isPrivate);
        if (allowedRoles !== undefined && Array.isArray(allowedRoles)) ch.allowedRoles = allowedRoles;
        if (rolePermissions !== undefined && typeof rolePermissions === 'object') ch.rolePermissions = rolePermissions;
        if (userLimit !== undefined && ch.type === 'voice') {
          ch.userLimit = Math.max(0, Math.min(99, parseInt(userLimit, 10) || 0));
        }
        if (slowmode !== undefined && ch.type === 'text') {
          ch.slowmode = Math.max(0, Math.min(3600, parseInt(slowmode, 10) || 0));
        }
        break;
      }
    }
    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  socket.on('delete-channel', ({ serverId, channelId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_CHANNELS')) return;

    for (const cat of srv.categories) {
      cat.channels = cat.channels.filter(c => c.id !== channelId);
    }
    delete srv.messages[channelId];

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  // Reorder categories
  socket.on('reorder-categories', ({ serverId, categoryIds }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_CHANNELS')) return;
    if (!Array.isArray(categoryIds)) return;

    const catMap = new Map(srv.categories.map(c => [c.id, c]));
    const newCategories = [];
    categoryIds.forEach(id => {
      if (catMap.has(id)) {
        newCategories.push(catMap.get(id));
        catMap.delete(id);
      }
    });
    catMap.forEach(c => newCategories.push(c));
    srv.categories = newCategories;

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  // Reorder channels across or within categories
  socket.on('reorder-channels', ({ serverId, targetCategoryId, channelId, targetIndex }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_CHANNELS')) return;

    let foundChannel = null;
    for (const cat of srv.categories) {
      const idx = cat.channels.findIndex(ch => ch.id === channelId);
      if (idx !== -1) {
        foundChannel = cat.channels.splice(idx, 1)[0];
        break;
      }
    }
    if (!foundChannel) return;

    const targetCat = srv.categories.find(c => c.id === targetCategoryId) || srv.categories[0];
    if (!targetCat) return;

    const insertIdx = (typeof targetIndex === 'number' && targetIndex >= 0 && targetIndex <= targetCat.channels.length)
      ? targetIndex
      : targetCat.channels.length;

    targetCat.channels.splice(insertIdx, 0, foundChannel);
    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  // Clear channel messages
  socket.on('clear-channel', ({ serverId, channelId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_CHANNELS')) return;

    const userAcc = accounts[userId];
    const username = userAcc ? userAcc.username : 'Staff';
    srv.messages[channelId] = [];

    const botMsg = {
      id: 'msg_bot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      serverId,
      channelId,
      senderId: 'voxbot',
      username: 'VoxBot',
      color: '#5865F2',
      avatarUrl: '/uploads/voxbot.svg',
      roleBadge: 'BOT',
      roleName: 'System Bot',
      globalBadges: ['SYSTEM_BOT'],
      text: `🧹 Chat was cleared by **@${username}**.`,
      attachment: null,
      voiceNote: null,
      replyTo: null,
      reactions: {},
      isEdited: false,
      timestamp: new Date().toISOString()
    };
    srv.messages[channelId].push(botMsg);
    saveJSON(SERVERS_FILE, savedServers);
    io.emit('channel-cleared', { serverId, channelId, message: botMsg });
  });

  // Moderation: Kick User with Bot Confirmation
  socket.on('kick-user', ({ serverId, targetId, channelId, reason }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'KICK_MEMBERS')) return socket.emit('error-msg', 'You do not have permission to kick members.');

    if (srv.ownerId === targetId) return socket.emit('error-msg', 'Cannot kick the server owner.');

    const targetAcc = accounts[targetId];
    const targetName = targetAcc ? targetAcc.username : 'User';
    const executorAcc = accounts[userId];
    const executorName = executorAcc ? executorAcc.username : 'Staff';

    if (!srv.kicks) srv.kicks = [];
    if (!srv.kicks.includes(targetId)) srv.kicks.push(targetId);

    delete srv.memberRoles[targetId];
    saveJSON(SERVERS_FILE, savedServers);

    const live = liveUsers.get(targetId);
    if (live) {
      io.to(live.socketId).emit('kicked-from-server', { serverId, serverName: srv.name, reason: reason || 'Kicked from server' });
    }

    io.emit('server-updated', srv);

    if (channelId) {
      const botMsg = {
        id: 'msg_bot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        serverId,
        channelId,
        senderId: 'voxbot',
        username: 'VoxBot',
        color: '#5865F2',
        avatarUrl: '/uploads/voxbot.svg',
        roleBadge: 'BOT',
        roleName: 'System Bot',
        globalBadges: ['SYSTEM_BOT'],
        text: `👢 **@${targetName}** has been kicked from the server by **@${executorName}**${reason ? ` • *"${reason}"*` : ''}.`,
        attachment: null,
        voiceNote: null,
        replyTo: null,
        reactions: {},
        isEdited: false,
        timestamp: new Date().toISOString()
      };
      if (!srv.messages[channelId]) srv.messages[channelId] = [];
      srv.messages[channelId].push(botMsg);
      if (srv.messages[channelId].length > 150) srv.messages[channelId].shift();
      saveJSON(SERVERS_FILE, savedServers);
      io.emit('new-message', botMsg);
    }
  });

  // Moderation: Ban User with Bot Confirmation
  socket.on('ban-user', ({ serverId, targetId, channelId, reason }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'BAN_MEMBERS')) return socket.emit('error-msg', 'You do not have permission to ban members.');

    if (srv.ownerId === targetId) return socket.emit('error-msg', 'Cannot ban the server owner.');

    if (!srv.bans) srv.bans = [];
    const targetAcc = accounts[targetId];
    const targetName = targetAcc ? targetAcc.username : 'User';
    const executorAcc = accounts[userId];
    const executorName = executorAcc ? executorAcc.username : 'Staff';

    srv.bans.push({
      userId: targetId,
      username: targetName,
      reason: reason || 'Banned by server staff',
      bannedAt: new Date().toISOString()
    });

    // Remove roles
    delete srv.memberRoles[targetId];
    saveJSON(SERVERS_FILE, savedServers);

    const live = liveUsers.get(targetId);
    if (live) {
      io.to(live.socketId).emit('banned-from-server', { serverId, serverName: srv.name, reason: reason || 'Banned from server' });
    }

    io.emit('server-updated', srv);

    if (channelId) {
      const botMsg = {
        id: 'msg_bot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        serverId,
        channelId,
        senderId: 'voxbot',
        username: 'VoxBot',
        color: '#ED4245',
        avatarUrl: '/uploads/voxbot.svg',
        roleBadge: 'BOT',
        roleName: 'System Bot',
        globalBadges: ['SYSTEM_BOT'],
        text: `🔨 **@${targetName}** has been banned from the server by **@${executorName}**${reason ? ` • *"${reason}"*` : ''}.`,
        attachment: null,
        voiceNote: null,
        replyTo: null,
        reactions: {},
        isEdited: false,
        timestamp: new Date().toISOString()
      };
      if (!srv.messages[channelId]) srv.messages[channelId] = [];
      srv.messages[channelId].push(botMsg);
      if (srv.messages[channelId].length > 150) srv.messages[channelId].shift();
      saveJSON(SERVERS_FILE, savedServers);
      io.emit('new-message', botMsg);
    }
  });

  socket.on('unban-user', ({ serverId, targetId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'BAN_MEMBERS')) return;

    if (srv.bans) {
      srv.bans = srv.bans.filter(b => b.userId !== targetId);
      srv.memberRoles[targetId] = ['role-member-' + serverId];
      saveJSON(SERVERS_FILE, savedServers);
      io.emit('server-updated', srv);
    }
  });

  // Roles & Permissions
  socket.on('create-role', ({ serverId, name, color, badge, permissions }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_ROLES')) return;

    const role = {
      id: 'role_' + Date.now(),
      name: (name || 'New Role').trim().substring(0, 30),
      color: color || '#949BA4',
      badge: badge || '',
      permissions: permissions || ['SEND_MESSAGES', 'CONNECT_VOICE'],
      position: srv.roles.length + 10
    };

    srv.roles.push(role);
    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  socket.on('edit-role', ({ serverId, roleId, name, color, badge, permissions }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_ROLES')) return;

    const role = srv.roles.find(r => r.id === roleId);
    if (!role) return;

    if (name) role.name = name.trim().substring(0, 30);
    if (color) role.color = color;
    if (badge !== undefined) role.badge = badge;
    if (permissions) role.permissions = permissions;

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  socket.on('delete-role', ({ serverId, roleId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_ROLES')) return;

    srv.roles = srv.roles.filter(r => r.id !== roleId);
    for (const uid in srv.memberRoles) {
      srv.memberRoles[uid] = srv.memberRoles[uid].filter(id => id !== roleId);
    }

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  socket.on('toggle-user-role', ({ serverId, targetId, roleId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv || !hasPermission(srv, userId, 'MANAGE_ROLES')) return;

    if (!srv.memberRoles[targetId]) srv.memberRoles[targetId] = [];
    const current = srv.memberRoles[targetId];

    if (current.includes(roleId)) {
      srv.memberRoles[targetId] = current.filter(id => id !== roleId);
    } else {
      current.push(roleId);
    }

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('server-updated', srv);
  });

  // Messages & DMs with Replies, Reactions, Edit, and Delete
  socket.on('send-message', ({ serverId, channelId, text, attachment, voiceNote, p2pFile, replyTo, isThreadStarter, threadName }) => {
    const userId = socketUserMap.get(socket.id);
    const user = accounts[userId];
    const srv = savedServers[serverId];
    if (!user || !srv) return;
    if (!hasPermission(srv, userId, 'SEND_MESSAGES')) return;

    // Channel-level access & write permissions check
    let targetChannel = null;
    for (const cat of srv.categories) {
      const ch = cat.channels.find(c => c.id === channelId);
      if (ch) { targetChannel = ch; break; }
    }
    const isOwnerOrAdmin = srv.ownerId === userId || hasPermission(srv, userId, 'MANAGE_SERVER') || hasPermission(srv, userId, 'MANAGE_CHANNELS');
    if (targetChannel && !isOwnerOrAdmin) {
      const userRoles = srv.memberRoles[userId] || [];
      // 1. Private channel access
      if (targetChannel.isPrivate && targetChannel.allowedRoles && targetChannel.allowedRoles.length > 0) {
        const hasAccess = targetChannel.allowedRoles.some(rId => userRoles.includes(rId));
        if (!hasAccess) return socket.emit('error-msg', 'You do not have access to this private channel.');
      }
      // 2. Read/write channel permissions
      if (targetChannel.rolePermissions) {
        let canWrite = true;
        // Default / @everyone override check
        const everyoneRole = srv.roles.find(r => r.name === '@everyone' || r.isEveryone);
        if (everyoneRole && targetChannel.rolePermissions[everyoneRole.id]) {
          if (targetChannel.rolePermissions[everyoneRole.id].canWrite === false) {
            canWrite = false;
          }
        }
        // Assigned roles overrides
        for (const rId of userRoles) {
          if (targetChannel.rolePermissions[rId] && targetChannel.rolePermissions[rId].canWrite !== undefined) {
            if (targetChannel.rolePermissions[rId].canWrite === true) canWrite = true;
            else if (targetChannel.rolePermissions[rId].canWrite === false && canWrite !== true) canWrite = false;
          }
        }
        if (!canWrite) return socket.emit('error-msg', 'This channel is read-only for your role.');
      }

      // 3. Slowmode rate-limiting check
      if (targetChannel.slowmode && targetChannel.slowmode > 0) {
        const slowKey = `${userId}_${channelId}`;
        const lastTime = userSlowmodeMap.get(slowKey) || 0;
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed < targetChannel.slowmode) {
          const remaining = Math.ceil(targetChannel.slowmode - elapsed);
          return socket.emit('error-msg', `Slowmode is enabled! Please wait ${remaining}s before sending another message.`);
        }
        userSlowmodeMap.set(slowKey, now);
      }
    }

    const userRoleIds = srv.memberRoles[userId] || [];
    const assignedRoles = srv.roles.filter(r => userRoleIds.includes(r.id)).sort((a,b) => b.position - a.position);
    const topRole = assignedRoles[0] || null;

    const cleanReply = replyTo ? {
      id: replyTo.id,
      senderId: replyTo.senderId,
      username: replyTo.username,
      text: (replyTo.text || '').substring(0, 150)
    } : null;

    const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const hasThreadFlag = Boolean(isThreadStarter);
    const cleanThreadName = hasThreadFlag ? (threadName || (text ? text.substring(0, 30) : 'Thread')).trim().substring(0, 50) : null;

    let processedAttachment = attachment || null;
    if (processedAttachment && processedAttachment.dataUrl && typeof processedAttachment.dataUrl === 'string' && processedAttachment.dataUrl.startsWith('data:')) {
      processedAttachment = { ...processedAttachment, dataUrl: saveBase64Media(processedAttachment.dataUrl, 'attach', user.id) };
    }
    let processedVoiceNote = voiceNote || null;
    if (processedVoiceNote && processedVoiceNote.dataUrl && typeof processedVoiceNote.dataUrl === 'string' && processedVoiceNote.dataUrl.startsWith('data:')) {
      processedVoiceNote = { ...processedVoiceNote, dataUrl: saveBase64Media(processedVoiceNote.dataUrl, 'vn', user.id) };
    }

    const message = {
      id: msgId,
      serverId,
      channelId,
      senderId: user.id,
      username: user.username,
      color: topRole && topRole.color !== '#949BA4' ? topRole.color : user.color,
      avatarUrl: user.avatarUrl,
      roleBadge: topRole ? topRole.badge : '',
      roleName: topRole ? topRole.name : '',
      globalBadges: user.globalBadges || [],
      text: (text || '').trim().substring(0, 3000),
      attachment: processedAttachment,
      voiceNote: processedVoiceNote,
      p2pFile: p2pFile || null,
      replyTo: cleanReply,
      reactions: {},
      isEdited: false,
      isPinned: false,
      hasThread: hasThreadFlag,
      threadName: cleanThreadName,
      threadRepliesCount: 0,
      timestamp: new Date().toISOString()
    };

    if (hasThreadFlag) {
      if (!srv.threads) srv.threads = {};
      srv.threads[msgId] = {
        id: msgId,
        serverId,
        channelId,
        parentMessageId: msgId,
        name: cleanThreadName,
        createdAt: new Date().toISOString(),
        creatorId: user.id,
        creatorUsername: user.username,
        replies: []
      };
    }

    if (!srv.messages[channelId]) srv.messages[channelId] = [];
    srv.messages[channelId].push(message);
    if (srv.messages[channelId].length > 150) srv.messages[channelId].shift();

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('new-message', message);
  });

  // Pinning Messages in Channels
  socket.on('toggle-pin-message', ({ serverId, channelId, messageId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv) return;
    const msgs = srv.messages[channelId];
    if (!msgs) return;
    const msg = msgs.find(m => m.id === messageId);
    if (!msg) return;

    msg.isPinned = !Boolean(msg.isPinned);
    msg.pinnedAt = msg.isPinned ? new Date().toISOString() : null;
    msg.pinnedBy = msg.isPinned ? (accounts[userId]?.username || 'User') : null;

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('message-pin-updated', {
      serverId,
      channelId,
      messageId,
      isPinned: msg.isPinned,
      pinnedAt: msg.pinnedAt,
      pinnedBy: msg.pinnedBy
    });
  });

  // Create Thread from Existing Message
  socket.on('create-thread', ({ serverId, channelId, parentMessageId, threadName }) => {
    const userId = socketUserMap.get(socket.id);
    const user = accounts[userId];
    const srv = savedServers[serverId];
    if (!srv || !user) return;
    const msgs = srv.messages[channelId];
    if (!msgs) return;
    const parentMsg = msgs.find(m => m.id === parentMessageId);
    if (!parentMsg) return;

    const tName = (threadName || (parentMsg.text ? parentMsg.text.substring(0, 30) : 'Thread')).trim().substring(0, 50);
    parentMsg.hasThread = true;
    parentMsg.threadName = tName;
    if (parentMsg.threadRepliesCount === undefined) parentMsg.threadRepliesCount = 0;

    if (!srv.threads) srv.threads = {};
    if (!srv.threads[parentMessageId]) {
      srv.threads[parentMessageId] = {
        id: parentMessageId,
        serverId,
        channelId,
        parentMessageId,
        name: tName,
        createdAt: new Date().toISOString(),
        creatorId: user.id,
        creatorUsername: user.username,
        replies: []
      };
    } else {
      srv.threads[parentMessageId].name = tName;
    }

    saveJSON(SERVERS_FILE, savedServers);
    io.emit('thread-created', {
      serverId,
      channelId,
      parentMessageId,
      thread: srv.threads[parentMessageId],
      threadName: tName
    });
  });

  // Get Thread Data (Root Message & Replies)
  socket.on('get-thread-data', ({ serverId, channelId, threadId }) => {
    const srv = savedServers[serverId];
    if (!srv) return;
    const msgs = srv.messages[channelId] || [];
    const rootMsg = msgs.find(m => m.id === threadId);
    if (!rootMsg) return;

    if (!srv.threads) srv.threads = {};
    let thread = srv.threads[threadId];
    if (!thread) {
      thread = {
        id: threadId,
        serverId,
        channelId,
        parentMessageId: threadId,
        name: rootMsg.threadName || 'Thread',
        createdAt: rootMsg.timestamp,
        creatorId: rootMsg.senderId,
        creatorUsername: rootMsg.username,
        replies: []
      };
      srv.threads[threadId] = thread;
      saveJSON(SERVERS_FILE, savedServers);
    }

    socket.emit('thread-data', {
      threadId,
      rootMessage: rootMsg,
      threadMeta: thread,
      replies: thread.replies || []
    });
  });

  // Send Message inside a Thread
  socket.on('send-thread-message', ({ serverId, channelId, threadId, text, attachment, voiceNote, p2pFile }) => {
    const userId = socketUserMap.get(socket.id);
    const user = accounts[userId];
    const srv = savedServers[serverId];
    if (!user || !srv) return;
    if (!hasPermission(srv, userId, 'SEND_MESSAGES')) return;

    if (!srv.threads) srv.threads = {};
    const thread = srv.threads[threadId];
    if (!thread) return;

    const userRoleIds = srv.memberRoles[userId] || [];
    const assignedRoles = srv.roles.filter(r => userRoleIds.includes(r.id)).sort((a,b) => b.position - a.position);
    const topRole = assignedRoles[0] || null;

    let processedAttachment = attachment || null;
    if (processedAttachment && processedAttachment.dataUrl && typeof processedAttachment.dataUrl === 'string' && processedAttachment.dataUrl.startsWith('data:')) {
      processedAttachment = { ...processedAttachment, dataUrl: saveBase64Media(processedAttachment.dataUrl, 'attach', user.id) };
    }
    let processedVoiceNote = voiceNote || null;
    if (processedVoiceNote && processedVoiceNote.dataUrl && typeof processedVoiceNote.dataUrl === 'string' && processedVoiceNote.dataUrl.startsWith('data:')) {
      processedVoiceNote = { ...processedVoiceNote, dataUrl: saveBase64Media(processedVoiceNote.dataUrl, 'vn', user.id) };
    }

    const threadMsg = {
      id: 'thmsg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      threadId,
      serverId,
      channelId,
      senderId: user.id,
      username: user.username,
      color: topRole && topRole.color !== '#949BA4' ? topRole.color : user.color,
      avatarUrl: user.avatarUrl,
      roleBadge: topRole ? topRole.badge : '',
      roleName: topRole ? topRole.name : '',
      globalBadges: user.globalBadges || [],
      text: (text || '').trim().substring(0, 3000),
      attachment: processedAttachment,
      voiceNote: processedVoiceNote,
      p2pFile: p2pFile || null,
      reactions: {},
      isEdited: false,
      timestamp: new Date().toISOString()
    };

    if (!thread.replies) thread.replies = [];
    thread.replies.push(threadMsg);
    if (thread.replies.length > 200) thread.replies.shift();

    // Update parent message replies count
    const msgs = srv.messages[channelId] || [];
    const parentMsg = msgs.find(m => m.id === threadId);
    if (parentMsg) {
      parentMsg.hasThread = true;
      parentMsg.threadRepliesCount = thread.replies.length;
    }

    saveJSON(SERVERS_FILE, savedServers);

    io.emit('new-thread-message', {
      serverId,
      channelId,
      threadId,
      message: threadMsg,
      repliesCount: thread.replies.length
    });
  });

  // Delete a Thread
  socket.on('delete-thread', ({ serverId, channelId, threadId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    if (!srv) return;

    if (!srv.threads) srv.threads = {};
    const thread = srv.threads[threadId];

    const isThreadCreator = Boolean(thread && thread.creatorId === userId);
    const isOwnerOrAdmin = srv.ownerId === userId ||
      hasPermission(srv, userId, 'MANAGE_SERVER') ||
      hasPermission(srv, userId, 'MANAGE_CHANNELS');

    const userAcc = accounts[userId];
    const isPlatformStaff = Boolean(userAcc && userAcc.globalBadges && (
      userAcc.globalBadges.includes('PROJECT_OWNER') ||
      userAcc.globalBadges.includes('CREATOR') ||
      userAcc.globalBadges.includes('DEVELOPER')
    ));

    if (!isThreadCreator && !isOwnerOrAdmin && !isPlatformStaff) {
      return socket.emit('error-msg', 'You do not have permission to delete this thread.');
    }

    // Delete thread
    delete srv.threads[threadId];

    // Reset thread state on parent root message
    const msgs = srv.messages[channelId] || [];
    const parentMsg = msgs.find(m => m.id === threadId);
    if (parentMsg) {
      parentMsg.hasThread = false;
      parentMsg.threadName = null;
      parentMsg.threadRepliesCount = 0;
      parentMsg.threadReplyCount = 0;
    }

    saveJSON(SERVERS_FILE, savedServers);

    io.emit('thread-deleted', {
      serverId,
      channelId,
      threadId
    });
  });

  socket.on('send-dm', ({ targetId, isGroup, text, attachment, voiceNote, p2pFile, replyTo }) => {
    const userId = socketUserMap.get(socket.id);
    const sender = accounts[userId];
    if (!sender || !targetId) return;

    const cleanReply = replyTo ? {
      id: replyTo.id,
      senderId: replyTo.senderId,
      username: replyTo.username,
      text: (replyTo.text || '').substring(0, 150)
    } : null;

    let processedAttachment = attachment || null;
    if (processedAttachment && processedAttachment.dataUrl && typeof processedAttachment.dataUrl === 'string' && processedAttachment.dataUrl.startsWith('data:')) {
      processedAttachment = { ...processedAttachment, dataUrl: saveBase64Media(processedAttachment.dataUrl, 'attach', sender.id) };
    }
    let processedVoiceNote = voiceNote || null;
    if (processedVoiceNote && processedVoiceNote.dataUrl && typeof processedVoiceNote.dataUrl === 'string' && processedVoiceNote.dataUrl.startsWith('data:')) {
      processedVoiceNote = { ...processedVoiceNote, dataUrl: saveBase64Media(processedVoiceNote.dataUrl, 'vn', sender.id) };
    }

    if (isGroup) {
      const group = savedGroups[targetId];
      if (!group || !group.members.includes(userId)) return;

      const key = 'group_' + targetId;
      const dmMsg = {
        id: 'dm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        senderId: sender.id,
        targetId,
        groupId: targetId,
        isGroup: true,
        username: sender.username,
        color: sender.color,
        avatarUrl: sender.avatarUrl,
        globalBadges: sender.globalBadges || [],
        text: (text || '').trim().substring(0, 3000),
        attachment: processedAttachment,
        voiceNote: processedVoiceNote,
        p2pFile: p2pFile || null,
        replyTo: cleanReply,
        reactions: {},
        isEdited: false,
        timestamp: new Date().toISOString()
      };

      if (!dmStore.has(key)) dmStore.set(key, []);
      const history = dmStore.get(key);
      history.push(dmMsg);
      if (history.length > 300) history.shift();
      persistDMs();

      // Emit to all group members
      group.members.forEach(mId => {
        const live = liveUsers.get(mId);
        if (live) {
          io.to(live.socketId).emit('new-dm', {
            dmKey: key,
            message: dmMsg,
            peerId: targetId,
            isGroup: true,
            groupId: targetId
          });
        }
      });
      return;
    }

    const target = accounts[targetId];
    if (!target) return;

    const key = getDmKey(sender.id, target.id);
    const dmMsg = {
      id: 'dm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      senderId: sender.id,
      targetId: target.id,
      username: sender.username,
      color: sender.color,
      avatarUrl: sender.avatarUrl,
      globalBadges: sender.globalBadges || [],
      text: (text || '').trim().substring(0, 3000),
      attachment: processedAttachment,
      voiceNote: processedVoiceNote,
      p2pFile: p2pFile || null,
      replyTo: cleanReply,
      reactions: {},
      isEdited: false,
      timestamp: new Date().toISOString()
    };

    if (!dmStore.has(key)) dmStore.set(key, []);
    const history = dmStore.get(key);
    history.push(dmMsg);
    if (history.length > 200) history.shift();
    persistDMs();

    socket.emit('new-dm', { dmKey: key, message: dmMsg, peerId: target.id });

    const targetLive = liveUsers.get(target.id);
    if (targetLive) {
      io.to(targetLive.socketId).emit('new-dm', { dmKey: key, message: dmMsg, peerId: sender.id });
    }
  });

  // Edit Message
  socket.on('edit-message', ({ serverId, channelId, messageId, newText, isDm, targetId }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;
    const cleanText = (newText || '').trim().substring(0, 3000);
    if (!cleanText) return;

    if (!isDm && serverId && channelId) {
      const srv = savedServers[serverId];
      if (!srv || !srv.messages[channelId]) return;
      const msg = srv.messages[channelId].find(m => m.id === messageId);
      if (!msg || msg.senderId !== userId) return;

      msg.text = cleanText;
      msg.isEdited = true;
      saveJSON(SERVERS_FILE, savedServers);
      io.emit('message-edited', { serverId, channelId, messageId, newText: cleanText, isEdited: true });
    } else if (isDm && targetId) {
      const isGroup = Boolean(savedGroups[targetId]);
      const key = isGroup ? ('group_' + targetId) : getDmKey(userId, targetId);
      const history = dmStore.get(key);
      if (!history) return;
      const msg = history.find(m => m.id === messageId);
      if (!msg || msg.senderId !== userId) return;

      msg.text = cleanText;
      msg.isEdited = true;
      if (isGroup) {
        const grp = savedGroups[targetId];
        grp.members.forEach(mId => {
          const live = liveUsers.get(mId);
          if (live) {
            io.to(live.socketId).emit('dm-message-edited', { dmKey: key, messageId, newText: cleanText, isEdited: true });
          }
        });
      } else {
        socket.emit('dm-message-edited', { dmKey: key, messageId, newText: cleanText, isEdited: true });
        const targetLive = liveUsers.get(targetId);
        if (targetLive) {
          io.to(targetLive.socketId).emit('dm-message-edited', { dmKey: key, messageId, newText: cleanText, isEdited: true });
        }
      }
    }
  });

  // Delete Message
  socket.on('delete-message', ({ serverId, channelId, messageId, isDm, targetId }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;

    if (!isDm && serverId && channelId) {
      const srv = savedServers[serverId];
      if (!srv || !srv.messages[channelId]) return;
      const idx = srv.messages[channelId].findIndex(m => m.id === messageId);
      if (idx === -1) return;
      const msg = srv.messages[channelId][idx];
      const callerAcc = accounts[userId];
      const isCreator = callerAcc && callerAcc.globalBadges && (callerAcc.globalBadges.includes('PROJECT_OWNER') || callerAcc.globalBadges.includes('CREATOR'));
      const canDelete = msg.senderId === userId || srv.ownerId === userId || hasPermission(srv, userId, 'MANAGE_SERVER') || isCreator;
      if (!canDelete) return;

      srv.messages[channelId].splice(idx, 1);
      saveJSON(SERVERS_FILE, savedServers);
      io.emit('message-deleted', { serverId, channelId, messageId });
    } else if (isDm && targetId) {
      const isGroup = Boolean(savedGroups[targetId]);
      const key = isGroup ? ('group_' + targetId) : getDmKey(userId, targetId);
      const history = dmStore.get(key);
      if (!history) return;
      const idx = history.findIndex(m => m.id === messageId);
      if (idx === -1) return;
      const msg = history[idx];
      const grp = isGroup ? savedGroups[targetId] : null;
      const canDelete = msg.senderId === userId || (grp && grp.ownerId === userId);
      if (!canDelete) return;

      history.splice(idx, 1);
      if (isGroup) {
        grp.members.forEach(mId => {
          const live = liveUsers.get(mId);
          if (live) {
            io.to(live.socketId).emit('dm-message-deleted', { dmKey: key, messageId, targetId });
          }
        });
      } else {
        socket.emit('dm-message-deleted', { dmKey: key, messageId, targetId });
        const targetLive = liveUsers.get(targetId);
        if (targetLive) {
          io.to(targetLive.socketId).emit('dm-message-deleted', { dmKey: key, messageId, targetId });
        }
      }
    }
  });

  // Toggle Reaction
  socket.on('toggle-reaction', ({ serverId, channelId, messageId, emoji, isDm, targetId }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId || !emoji) return;

    let msg = null;
    let isServerMsg = false;
    let key = null;
    const isGroup = isDm && Boolean(savedGroups[targetId]);

    if (!isDm && serverId && channelId) {
      const srv = savedServers[serverId];
      if (srv && srv.messages[channelId]) {
        msg = srv.messages[channelId].find(m => m.id === messageId);
        isServerMsg = true;
      }
    } else if (isDm && targetId) {
      key = isGroup ? ('group_' + targetId) : getDmKey(userId, targetId);
      const history = dmStore.get(key);
      if (history) msg = history.find(m => m.id === messageId);
    }

    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

    const userList = msg.reactions[emoji];
    const existingIndex = userList.indexOf(userId);
    if (existingIndex !== -1) {
      userList.splice(existingIndex, 1);
      if (userList.length === 0) delete msg.reactions[emoji];
    } else {
      userList.push(userId);
    }

    if (isServerMsg) {
      saveJSON(SERVERS_FILE, savedServers);
      io.emit('message-reaction-updated', { serverId, channelId, messageId, reactions: msg.reactions });
    } else if (isGroup) {
      const grp = savedGroups[targetId];
      grp.members.forEach(mId => {
        const live = liveUsers.get(mId);
        if (live) {
          io.to(live.socketId).emit('dm-reaction-updated', { dmKey: key, messageId, reactions: msg.reactions });
        }
      });
    } else {
      socket.emit('dm-reaction-updated', { dmKey: key, messageId, reactions: msg.reactions });
      const targetLive = liveUsers.get(targetId);
      if (targetLive) {
        io.to(targetLive.socketId).emit('dm-reaction-updated', { dmKey: key, messageId, reactions: msg.reactions });
      }
    }
  });

  socket.on('get-dm-history', ({ targetId, isGroup }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;

    if (isGroup) {
      const group = savedGroups[targetId];
      if (!group || !group.members.includes(userId)) return;
      const key = 'group_' + targetId;
      const history = dmStore.get(key) || [];
      const memberAccounts = group.members.map(mId => {
        const acc = accounts[mId];
        const live = liveUsers.get(mId);
        return acc ? {
          id: acc.id,
          username: acc.username,
          avatarUrl: acc.avatarUrl,
          color: acc.color,
          customStatus: acc.customStatus,
          isOnline: Boolean(live)
        } : null;
      }).filter(Boolean);

      return socket.emit('dm-history', { targetId, isGroup: true, groupMeta: group, members: memberAccounts, history });
    }

    const key = getDmKey(userId, targetId);
    const history = dmStore.get(key) || [];
    const targetAcc = accounts[targetId];
    const targetLive = liveUsers.get(targetId);
    const peerMeta = targetAcc ? {
      id: targetAcc.id,
      username: targetAcc.username,
      avatarUrl: targetAcc.avatarUrl,
      color: targetAcc.color,
      bio: targetAcc.bio,
      bannerUrl: targetAcc.bannerUrl,
      bannerColor: targetAcc.bannerColor,
      customStatus: targetAcc.customStatus,
      globalBadges: targetAcc.globalBadges,
      isOnline: Boolean(targetLive)
    } : null;

    socket.emit('dm-history', { targetId, isGroup: false, history, peerMeta });
  });

  // Create DM Group
  socket.on('create-dm-group', ({ name, memberIds }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;

    const allMembers = Array.from(new Set([userId, ...(Array.isArray(memberIds) ? memberIds : [])]));
    if (allMembers.length < 1) {
      return socket.emit('error-msg', 'Unable to create group.');
    }

    const groupId = 'grp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const groupName = (name || '').trim() || (allMembers.length > 1 ? allMembers.slice(0, 3).map(id => accounts[id]?.username || 'User').join(', ') : 'Group Chat');

    const newGroup = {
      id: groupId,
      name: groupName,
      ownerId: userId,
      members: allMembers,
      avatarUrl: null,
      createdAt: new Date().toISOString()
    };

    savedGroups[groupId] = newGroup;
    persistGroups();

    // Notify caller directly
    socket.emit('dm-group-created', newGroup);

    // Notify other members
    allMembers.forEach(mId => {
      if (mId === userId) return;
      const live = liveUsers.get(mId);
      if (live) {
        io.to(live.socketId).emit('dm-group-created', newGroup);
      }
    });
  });

  // Add Members to Existing Group DM
  socket.on('add-dm-group-members', ({ groupId, memberIds }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId || !groupId) return;
    const group = savedGroups[groupId];
    if (!group || !group.members.includes(userId)) return;

    const toAdd = Array.isArray(memberIds) ? memberIds : [];
    toAdd.forEach(mId => {
      if (!group.members.includes(mId)) {
        group.members.push(mId);
      }
    });

    persistGroups();

    const memberAccounts = group.members.map(mId => {
      const acc = accounts[mId];
      const live = liveUsers.get(mId);
      return acc ? {
        id: acc.id,
        username: acc.username,
        avatarUrl: acc.avatarUrl,
        color: acc.color,
        customStatus: acc.customStatus,
        isOnline: Boolean(live)
      } : null;
    }).filter(Boolean);

    // Notify caller directly
    socket.emit('dm-group-updated', { groupMeta: group, members: memberAccounts });

    // Notify other members
    group.members.forEach(mId => {
      if (mId === userId) return;
      const live = liveUsers.get(mId);
      if (live) {
        io.to(live.socketId).emit('dm-group-updated', { groupMeta: group, members: memberAccounts });
      }
    });
  });

  // Update Group DM (Name, Description, Avatar, Banner)
  socket.on('update-dm-group', ({ groupId, name, description, avatarData, bannerData }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId || !groupId) return;
    const group = savedGroups[groupId];
    if (!group || !group.members.includes(userId)) return;

    if (name && typeof name === 'string' && name.trim()) {
      group.name = name.trim().substring(0, 40);
    }
    if (typeof description === 'string') {
      group.description = description.trim().substring(0, 300);
    }
    if (avatarData) {
      group.avatarUrl = saveBase64Media(avatarData, 'grp_avatar', groupId);
    }
    if (bannerData) {
      group.bannerUrl = saveBase64Media(bannerData, 'grp_banner', groupId);
    }
    persistGroups();

    const memberAccounts = group.members.map(mId => {
      const acc = accounts[mId];
      const live = liveUsers.get(mId);
      return acc ? {
        id: acc.id,
        username: acc.username,
        avatarUrl: acc.avatarUrl,
        color: acc.color,
        customStatus: acc.customStatus,
        isOnline: Boolean(live)
      } : null;
    }).filter(Boolean);

    // Direct reply to caller first
    socket.emit('dm-group-updated', { groupMeta: group, members: memberAccounts });

    // Emit to all connected sockets of all members
    group.members.forEach(mId => {
      for (const [sId, uId] of socketUserMap.entries()) {
        if (uId === mId && sId !== socket.id) {
          io.to(sId).emit('dm-group-updated', { groupMeta: group, members: memberAccounts });
        }
      }
    });
  });

  // Kick / Remove Member from Group DM
  socket.on('kick-dm-group-member', ({ groupId, memberId }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId || !groupId || !memberId) return;
    const group = savedGroups[groupId];
    if (!group) return;

    // Only owner can kick, but any user can kick themselves (leave)
    if (group.ownerId !== userId && userId !== memberId) {
      return socket.emit('error-msg', 'Only the group creator can remove members.');
    }
    if (memberId === group.ownerId && userId !== memberId) {
      return socket.emit('error-msg', 'Cannot kick the group creator.');
    }

    group.members = group.members.filter(id => id !== memberId);
    persistGroups();

    // Notify kicked member
    const kickedLive = liveUsers.get(memberId);
    if (kickedLive) {
      io.to(kickedLive.socketId).emit('dm-group-removed', { groupId, groupName: group.name });
    }

    const kickedAcc = accounts[memberId];
    const kickedName = kickedAcc ? kickedAcc.username : 'User';
    const removerAcc = accounts[userId];
    const removerName = removerAcc ? removerAcc.username : 'Creator';

    const key = 'group_' + groupId;
    const sysMsg = {
      id: 'dm_sys_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      senderId: 'system',
      username: 'System',
      color: '#5865F2',
      avatarUrl: '/uploads/voxbot.svg',
      text: userId === memberId ? `👋 **@${kickedName}** left the group.` : `👢 **@${kickedName}** was removed from the group by **@${removerName}**.`,
      timestamp: new Date().toISOString()
    };
    if (!dmStore.has(key)) dmStore.set(key, []);
    dmStore.get(key).push(sysMsg);
    persistDMs();

    const memberAccounts = group.members.map(mId => {
      const acc = accounts[mId];
      const live = liveUsers.get(mId);
      return acc ? {
        id: acc.id,
        username: acc.username,
        avatarUrl: acc.avatarUrl,
        color: acc.color,
        customStatus: acc.customStatus,
        isOnline: Boolean(live)
      } : null;
    }).filter(Boolean);

    group.members.forEach(mId => {
      const live = liveUsers.get(mId);
      if (live) {
        io.to(live.socketId).emit('dm-group-updated', { groupMeta: group, members: memberAccounts });
        io.to(live.socketId).emit('new-dm', { dmKey: key, message: sysMsg, peerId: groupId, isGroup: true });
      }
    });
  });

  // Delete Group DM (Creator only)
  socket.on('delete-dm-group', ({ groupId }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId || !groupId) return;
    const group = savedGroups[groupId];
    if (!group) return;
    if (group.ownerId !== userId) {
      return socket.emit('error-msg', 'Only the group creator can delete this group.');
    }

    const members = [...group.members];
    delete savedGroups[groupId];
    persistGroups();

    const key = 'group_' + groupId;
    dmStore.delete(key);
    persistDMs();

    members.forEach(mId => {
      const live = liveUsers.get(mId);
      if (live) {
        io.to(live.socketId).emit('dm-group-deleted', { groupId, groupName: group.name });
      }
    });
  });

  // Clear / Delete 1-on-1 or Group DM Conversation History
  socket.on('clear-dm-conversation', ({ targetId }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId || !targetId) return;

    const isGroup = Boolean(savedGroups[targetId]);
    const key = isGroup ? ('group_' + targetId) : getDmKey(userId, targetId);

    if (isGroup) {
      const group = savedGroups[targetId];
      if (!group || !group.members.includes(userId)) return;
      dmStore.set(key, []);
      persistDMs();
      group.members.forEach(mId => {
        const live = liveUsers.get(mId);
        if (live) io.to(live.socketId).emit('dm-conversation-cleared', { targetId, key, isGroup: true });
      });
    } else {
      dmStore.set(key, []);
      persistDMs();
      socket.emit('dm-conversation-cleared', { targetId, key, isGroup: false });
      const liveTarget = liveUsers.get(targetId);
      if (liveTarget) {
        io.to(liveTarget.socketId).emit('dm-conversation-cleared', { targetId: userId, key, isGroup: false });
      }
    }
  });

  // Get active DM conversation threads (both 1-on-1 and Groups)
  socket.on('get-dm-threads', () => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;

    const threads = [];

    // 1. Group DMs
    for (const gId in savedGroups) {
      const grp = savedGroups[gId];
      if (grp.members.includes(userId)) {
        const key = 'group_' + grp.id;
        const msgs = dmStore.get(key);
        const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : null;

        threads.push({
          id: grp.id,
          peerId: grp.id,
          isGroup: true,
          username: grp.name,
          description: grp.description || '',
          membersCount: grp.members.length,
          memberIds: grp.members,
          avatarUrl: grp.avatarUrl,
          bannerUrl: grp.bannerUrl || null,
          color: '#5865F2',
          customStatus: `${grp.members.length} members`,
          isOnline: true,
          lastMessage: lastMsg ? {
            text: lastMsg.text,
            timestamp: lastMsg.timestamp,
            senderId: lastMsg.senderId,
            username: lastMsg.username
          } : null
        });
      }
    }

    // 2. 1-on-1 DMs
    for (const [key, msgs] of dmStore.entries()) {
      if (key.startsWith('group_')) continue;
      const parts = key.split('::');
      if (parts.length === 2 && parts.includes(userId)) {
        const otherId = parts[0] === userId ? parts[1] : parts[0];
        const otherAcc = accounts[otherId];
        if (otherAcc) {
          const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : null;
          const liveOther = liveUsers.get(otherId);
          threads.push({
            peerId: otherId,
            isGroup: false,
            username: otherAcc.username,
            avatarUrl: otherAcc.avatarUrl,
            color: otherAcc.color,
            customStatus: otherAcc.customStatus,
            isOnline: Boolean(liveOther),
            lastMessage: lastMsg ? {
              text: lastMsg.text,
              timestamp: lastMsg.timestamp,
              senderId: lastMsg.senderId,
              username: lastMsg.username
            } : null
          });
        }
      }
    }
    // Also include friends even if no messages yet
    const fData = getFriendData(userId);
    for (const friendId of fData.friends) {
      if (!threads.some(t => !t.isGroup && t.peerId === friendId)) {
        const friendAcc = accounts[friendId];
        if (friendAcc) {
          const liveOther = liveUsers.get(friendId);
          threads.push({
            peerId: friendId,
            isGroup: false,
            username: friendAcc.username,
            avatarUrl: friendAcc.avatarUrl,
            color: friendAcc.color,
            customStatus: friendAcc.customStatus,
            isOnline: Boolean(liveOther),
            lastMessage: null
          });
        }
      }
    }
    socket.emit('dm-threads', threads);
  });

  // Friend System Handlers
  socket.on('get-friends', () => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;
    const fData = getFriendData(userId);

    const friendsList = fData.friends.map(id => {
      const acc = accounts[id];
      if (!acc) return null;
      const live = liveUsers.get(id);
      return {
        id: acc.id,
        username: acc.username,
        color: acc.color,
        avatarUrl: acc.avatarUrl,
        customStatus: acc.customStatus,
        isOnline: Boolean(live)
      };
    }).filter(Boolean);

    const incoming = fData.incoming.map(id => {
      const acc = accounts[id];
      if (!acc) return null;
      return { id: acc.id, username: acc.username, color: acc.color, avatarUrl: acc.avatarUrl };
    }).filter(Boolean);

    const outgoing = fData.outgoing.map(id => {
      const acc = accounts[id];
      if (!acc) return null;
      return { id: acc.id, username: acc.username, color: acc.color, avatarUrl: acc.avatarUrl };
    }).filter(Boolean);

    socket.emit('friends-data', { friends: friendsList, incoming, outgoing });
  });

  socket.on('send-friend-request', ({ username }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;
    const cleanUser = (username || '').trim().toLowerCase();
    if (!cleanUser) return socket.emit('error-msg', 'Please enter a username.');

    let targetAcc = null;
    for (const uid in accounts) {
      if (accounts[uid].username.toLowerCase() === cleanUser) {
        targetAcc = accounts[uid];
        break;
      }
    }
    if (!targetAcc) return socket.emit('error-msg', `User "@${username}" not found.`);
    if (targetAcc.id === userId) return socket.emit('error-msg', "You cannot add yourself as a friend.");

    const myData = getFriendData(userId);
    const targetData = getFriendData(targetAcc.id);

    if (myData.friends.includes(targetAcc.id)) {
      return socket.emit('error-msg', `You and @${targetAcc.username} are already friends!`);
    }
    if (myData.outgoing.includes(targetAcc.id)) {
      return socket.emit('error-msg', `Friend request already sent to @${targetAcc.username}.`);
    }

    // If target already sent me a request, auto-accept!
    if (myData.incoming.includes(targetAcc.id)) {
      myData.incoming = myData.incoming.filter(id => id !== targetAcc.id);
      targetData.outgoing = targetData.outgoing.filter(id => id !== userId);
      myData.friends.push(targetAcc.id);
      targetData.friends.push(userId);
      persistFriends();

      socket.emit('friend-request-accepted', { friendId: targetAcc.id, username: targetAcc.username });
      const targetLive = liveUsers.get(targetAcc.id);
      if (targetLive) {
        io.to(targetLive.socketId).emit('friend-request-accepted', { friendId: userId, username: accounts[userId].username });
      }
      return;
    }

    myData.outgoing.push(targetAcc.id);
    targetData.incoming.push(userId);
    persistFriends();

    socket.emit('friend-request-sent', { targetId: targetAcc.id, username: targetAcc.username });
    const targetLive = liveUsers.get(targetAcc.id);
    if (targetLive) {
      io.to(targetLive.socketId).emit('friend-request-received', {
        fromUser: { id: userId, username: accounts[userId].username, avatarUrl: accounts[userId].avatarUrl }
      });
    }
  });

  socket.on('accept-friend-request', ({ requesterId }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;
    const myData = getFriendData(userId);
    const reqData = getFriendData(requesterId);

    myData.incoming = myData.incoming.filter(id => id !== requesterId);
    reqData.outgoing = reqData.outgoing.filter(id => id !== userId);

    if (!myData.friends.includes(requesterId)) myData.friends.push(requesterId);
    if (!reqData.friends.includes(userId)) reqData.friends.push(userId);
    persistFriends();

    socket.emit('friend-request-accepted', { friendId: requesterId });
    const reqLive = liveUsers.get(requesterId);
    if (reqLive) {
      io.to(reqLive.socketId).emit('friend-request-accepted', { friendId: userId });
    }
  });

  socket.on('decline-friend-request', ({ requesterId }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId || !requesterId) return;
    const myData = getFriendData(userId);
    const reqData = getFriendData(requesterId);

    // Cancel or decline: removes the pending request from incoming AND outgoing on both sides
    myData.incoming = myData.incoming.filter(id => id !== requesterId);
    myData.outgoing = myData.outgoing.filter(id => id !== requesterId);
    reqData.incoming = reqData.incoming.filter(id => id !== userId);
    reqData.outgoing = reqData.outgoing.filter(id => id !== userId);
    persistFriends();

    socket.emit('friend-request-declined', { requesterId });
    const reqLive = liveUsers.get(requesterId);
    if (reqLive) {
      io.to(reqLive.socketId).emit('friend-request-declined', { requesterId: userId });
    }
  });

  socket.on('remove-friend', ({ friendId }) => {
    const userId = socketUserMap.get(socket.id);
    if (!userId) return;
    const myData = getFriendData(userId);
    const fData = getFriendData(friendId);

    myData.friends = myData.friends.filter(id => id !== friendId);
    fData.friends = fData.friends.filter(id => id !== userId);
    persistFriends();

    socket.emit('friend-removed', { friendId });
    const fLive = liveUsers.get(friendId);
    if (fLive) io.to(fLive.socketId).emit('friend-removed', { friendId: userId });
  });

  // Direct 1-on-1 and Group DM Calling
  socket.on('start-dm-call', ({ targetId, isGroup, hasVideo }) => {
    const userId = socketUserMap.get(socket.id);
    const caller = accounts[userId];
    if (!caller) return;

    if (isGroup) {
      const group = savedGroups[targetId];
      if (!group || !group.members.includes(userId)) return;

      const callChannelId = 'dm_group_call_' + targetId;
      const callerLive = liveUsers.get(userId);
      if (callerLive) {
        callerLive.currentVoice = callChannelId;
        callerLive.currentVoiceServer = null;
        socket.join('voice:' + callChannelId);
      }

      // Ring all other online group members
      group.members.forEach(mId => {
        if (mId !== userId) {
          const live = liveUsers.get(mId);
          if (live) {
            io.to(live.socketId).emit('incoming-dm-call', {
              caller: {
                id: caller.id,
                username: caller.username,
                avatarUrl: caller.avatarUrl,
                color: caller.color
              },
              isGroup: true,
              groupId: targetId,
              groupName: group.name,
              callChannelId,
              hasVideo: Boolean(hasVideo)
            });
          }
        }
      });

      socket.emit('dm-call-outgoing', { targetId, isGroup: true, callChannelId });
      return;
    }

    const targetLive = liveUsers.get(targetId);
    if (!targetLive) {
      return socket.emit('dm-call-failed', { reason: 'User is currently offline.' });
    }

    const callChannelId = 'dm_call_' + getDmKey(userId, targetId);
    const callerLive = liveUsers.get(userId);
    if (callerLive) {
      callerLive.currentVoice = callChannelId;
      callerLive.currentVoiceServer = null;
      socket.join('voice:' + callChannelId);
    }

    // Ring target across all their connected sockets
    for (const [sId, uId] of socketUserMap.entries()) {
      if (uId === targetId) {
        io.to(sId).emit('incoming-dm-call', {
          caller: {
            id: caller.id,
            username: caller.username,
            avatarUrl: caller.avatarUrl,
            color: caller.color
          },
          isGroup: false,
          callChannelId,
          hasVideo: Boolean(hasVideo)
        });
      }
    }

    socket.emit('dm-call-outgoing', { targetId, isGroup: false, callChannelId });
  });

  socket.on('accept-dm-call', ({ callerId, callChannelId, isGroup, groupId }) => {
    const userId = socketUserMap.get(socket.id);
    const receiverLive = liveUsers.get(userId);

    if (receiverLive) {
      receiverLive.currentVoice = callChannelId;
      receiverLive.currentVoiceServer = null;
      socket.join('voice:' + callChannelId);
    }

    // Gather existing members already in this voice room (the caller, or other group members)
    const existingMembers = [];
    for (const [uid, u] of liveUsers.entries()) {
      if (u.currentVoice === callChannelId && uid !== userId) {
        existingMembers.push({
          id: u.id,
          username: u.username,
          color: u.color,
          avatarUrl: u.avatarUrl,
          globalBadges: u.globalBadges || [],
          isMuted: u.isMuted,
          isDeafened: u.isDeafened,
          isSpeaking: u.isSpeaking,
          isVideoOn: u.isVideoOn,
          isScreenSharing: u.isScreenSharing
        });
      }
    }

    const receiverUserInfo = receiverLive ? {
      id: receiverLive.id,
      username: receiverLive.username,
      color: receiverLive.color,
      avatarUrl: receiverLive.avatarUrl,
      globalBadges: receiverLive.globalBadges || [],
      isMuted: Boolean(receiverLive.isMuted),
      isDeafened: Boolean(receiverLive.isDeafened),
      isSpeaking: false,
      isVideoOn: Boolean(receiverLive.isVideoOn),
      isScreenSharing: Boolean(receiverLive.isScreenSharing)
    } : {
      id: userId,
      username: accounts[userId]?.username || 'User',
      color: accounts[userId]?.color || '#5865F2',
      avatarUrl: accounts[userId]?.avatarUrl || null,
      globalBadges: [],
      isMuted: false,
      isDeafened: false,
      isSpeaking: false,
      isVideoOn: false,
      isScreenSharing: false
    };

    // Standard voice channel entry (same as server channels and group calls)
    socket.emit('voice-channel-joined', {
      channelId: callChannelId,
      members: existingMembers
    });

    socket.to('voice:' + callChannelId).emit('user-joined-voice', {
      user: receiverUserInfo,
      channelId: callChannelId
    });

    if (isGroup) {
      socket.emit('dm-group-call-connected', {
        callChannelId,
        groupId,
        members: existingMembers
      });
      return;
    }

    const callerLive = liveUsers.get(callerId);
    const receiverAcc = accounts[userId] || {};
    const callerAcc = accounts[callerId] || {};

    // Notify caller across all connected sockets for dismissal / UI update
    for (const [sId, uId] of socketUserMap.entries()) {
      if (uId === callerId) {
        io.to(sId).emit('dm-call-accepted', {
          receiverId: userId,
          receiver: {
            id: userId,
            username: receiverAcc.username || (receiverLive ? receiverLive.username : 'User'),
            avatarUrl: receiverAcc.avatarUrl || (receiverLive ? receiverLive.avatarUrl : null),
            color: receiverAcc.color || (receiverLive ? receiverLive.color : '#5865F2')
          },
          callChannelId
        });
      }
    }

    socket.emit('dm-call-connected', {
      peerId: callerId,
      peer: {
        id: callerId,
        username: callerAcc.username || (callerLive ? callerLive.username : 'User'),
        avatarUrl: callerAcc.avatarUrl || (callerLive ? callerLive.avatarUrl : null),
        color: callerAcc.color || (callerLive ? callerLive.color : '#5865F2')
      },
      callChannelId
    });
  });

  socket.on('decline-dm-call', ({ callerId }) => {
    const userId = socketUserMap.get(socket.id);
    const callerLive = liveUsers.get(callerId);
    if (callerLive) {
      io.to(callerLive.socketId).emit('dm-call-declined', {
        byUserId: userId,
        username: accounts[userId] ? accounts[userId].username : 'User'
      });
    }
  });

  socket.on('end-dm-call', ({ targetId, callChannelId }) => {
    const userId = socketUserMap.get(socket.id);
    const myLive = liveUsers.get(userId);
    if (myLive && myLive.currentVoice === callChannelId) {
      leaveVoiceInternal(socket, myLive);
    }

    const targetLive = liveUsers.get(targetId);
    if (targetLive) {
      io.to(targetLive.socketId).emit('dm-call-ended', { byUserId: userId });
      if (targetLive.currentVoice === callChannelId) {
        const targetSocket = io.sockets.sockets.get(targetLive.socketId);
        if (targetSocket) leaveVoiceInternal(targetSocket, targetLive);
      }
    }
  });

  // WebRTC
  socket.on('join-voice', ({ serverId, channelId }) => {
    const userId = socketUserMap.get(socket.id);
    const srv = savedServers[serverId];
    const live = liveUsers.get(userId);
    if (!live || !srv || !hasPermission(srv, userId, 'CONNECT_VOICE')) return;

    let targetChannel = null;
    for (const cat of srv.categories) {
      const ch = cat.channels.find(c => c.id === channelId);
      if (ch) { targetChannel = ch; break; }
    }
    if (!targetChannel) return;

    const isOwnerOrAdmin = srv.ownerId === userId || hasPermission(srv, userId, 'MANAGE_SERVER') || hasPermission(srv, userId, 'MANAGE_CHANNELS');

    // Private voice channel permission check
    if (targetChannel.isPrivate && targetChannel.allowedRoles && targetChannel.allowedRoles.length > 0 && !isOwnerOrAdmin) {
      const userRoles = srv.memberRoles[userId] || [];
      const hasAccess = targetChannel.allowedRoles.some(rId => userRoles.includes(rId));
      if (!hasAccess) return socket.emit('error-msg', 'You do not have access to this private voice channel.');
    }

    // Voice channel user limit check
    if (targetChannel.userLimit && targetChannel.userLimit > 0 && !isOwnerOrAdmin) {
      let currentCount = 0;
      for (const [uid, u] of liveUsers.entries()) {
        if (u.currentVoice === channelId && uid !== userId) {
          currentCount++;
        }
      }
      if (currentCount >= targetChannel.userLimit) {
        return socket.emit('error-msg', `This voice channel is full! (${currentCount}/${targetChannel.userLimit})`);
      }
    }

    if (live.currentVoice && live.currentVoice !== channelId) {
      leaveVoiceInternal(socket, live);
    }

    live.currentVoice = channelId;
    live.currentVoiceServer = serverId;
    live.isSpeaking = false;
    socket.join('voice:' + channelId);

    const existingMembers = [];
    for (const [uid, u] of liveUsers.entries()) {
      if (u.currentVoice === channelId && uid !== userId) {
        existingMembers.push({
          id: u.id,
          username: u.username,
          color: u.color,
          avatarUrl: u.avatarUrl,
          globalBadges: u.globalBadges || [],
          isMuted: u.isMuted,
          isDeafened: u.isDeafened,
          isSpeaking: u.isSpeaking,
          isVideoOn: u.isVideoOn,
          isScreenSharing: u.isScreenSharing
        });
      }
    }

    socket.emit('voice-channel-joined', { channelId, members: existingMembers });
    socket.to('voice:' + channelId).emit('user-joined-voice', {
      user: {
        id: live.id,
        username: live.username,
        color: live.color,
        avatarUrl: live.avatarUrl,
        globalBadges: live.globalBadges || [],
        isMuted: live.isMuted,
        isDeafened: live.isDeafened,
        isSpeaking: live.isSpeaking,
        isVideoOn: live.isVideoOn,
        isScreenSharing: live.isScreenSharing
      },
      channelId
    });

    io.emit('user-state-changed', live);
  });

  socket.on('leave-voice', () => {
    const userId = socketUserMap.get(socket.id);
    const live = liveUsers.get(userId);
    if (live && live.currentVoice) {
      leaveVoiceInternal(socket, live);
      io.emit('user-state-changed', live);
    }
  });

  function leaveVoiceInternal(sock, live) {
    const prevChannel = live.currentVoice;
    if (!prevChannel) return;

    sock.leave('voice:' + prevChannel);
    live.currentVoice = null;
    live.currentVoiceServer = null;
    live.isSpeaking = false;
    live.isVideoOn = false;
    live.isScreenSharing = false;

    sock.to('voice:' + prevChannel).emit('user-left-voice', {
      userId: live.id,
      channelId: prevChannel
    });
  }

  socket.on('signal-offer', ({ targetId, offer }) => {
    const senderId = socketUserMap.get(socket.id);
    for (const [sId, uId] of socketUserMap.entries()) {
      if (uId === targetId) {
        io.to(sId).emit('signal-offer', { senderId, offer });
      }
    }
  });

  socket.on('signal-answer', ({ targetId, answer }) => {
    const senderId = socketUserMap.get(socket.id);
    for (const [sId, uId] of socketUserMap.entries()) {
      if (uId === targetId) {
        io.to(sId).emit('signal-answer', { senderId, answer });
      }
    }
  });

  socket.on('signal-ice', ({ targetId, candidate }) => {
    const senderId = socketUserMap.get(socket.id);
    for (const [sId, uId] of socketUserMap.entries()) {
      if (uId === targetId) {
        io.to(sId).emit('signal-ice', { senderId, candidate });
      }
    }
  });

  // Direct Peer-to-Peer Large File Transfer Signaling
  socket.on('p2p-file-signal', ({ targetId, targetSocketId, transferId, type, data }) => {
    let destSocketId = targetSocketId;
    if (!destSocketId && targetId) {
      const targetLive = liveUsers.get(targetId);
      if (targetLive) destSocketId = targetLive.socketId;
    }
    if (destSocketId) {
      io.to(destSocketId).emit('p2p-file-signal', {
        senderId: socketUserMap.get(socket.id),
        senderSocketId: socket.id,
        transferId,
        type,
        data
      });
    } else {
      socket.emit('p2p-file-signal', {
        senderId: targetId,
        transferId,
        type: 'error',
        data: 'The peer is currently offline. P2P transfers require the peer to be online.'
      });
    }
  });

  socket.on('media-state-change', ({ isVideoOn, isScreenSharing }) => {
    const userId = socketUserMap.get(socket.id);
    const live = liveUsers.get(userId);
    if (!live) return;

    if (typeof isVideoOn === 'boolean') live.isVideoOn = isVideoOn;
    if (typeof isScreenSharing === 'boolean') live.isScreenSharing = isScreenSharing;

    if (live.currentVoice) {
      socket.to('voice:' + live.currentVoice).emit('peer-media-state', {
        userId: live.id,
        isVideoOn: live.isVideoOn,
        isScreenSharing: live.isScreenSharing
      });
    }
    io.emit('user-state-changed', live);
  });

  socket.on('voice-status-update', ({ isMuted, isDeafened, isSpeaking }) => {
    const userId = socketUserMap.get(socket.id);
    const live = liveUsers.get(userId);
    if (!live) return;

    if (typeof isMuted === 'boolean') live.isMuted = isMuted;
    if (typeof isDeafened === 'boolean') live.isDeafened = isDeafened;
    if (typeof isSpeaking === 'boolean') live.isSpeaking = isSpeaking;

    if (live.currentVoice) {
      socket.to('voice:' + live.currentVoice).emit('peer-status-update', {
        userId: live.id,
        isMuted: live.isMuted,
        isDeafened: live.isDeafened,
        isSpeaking: live.isSpeaking
      });
    }
    io.emit('user-state-changed', live);
  });

  socket.on('disconnect', () => {
    const userId = socketUserMap.get(socket.id);
    if (userId) {
      const live = liveUsers.get(userId);
      if (live && live.currentVoice) {
        socket.to('voice:' + live.currentVoice).emit('user-left-voice', {
          userId: live.id,
          channelId: live.currentVoice
        });
      }
      liveUsers.delete(userId);
      socketUserMap.delete(socket.id);
      io.emit('user-disconnected', userId);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚀 VoxLink v5.0 Server Online on Port ${PORT}:`);
  console.log(`   🏠 Localhost: http://localhost:${PORT}`);
  console.log(`   📶 Local LAN: http://192.168.0.66:${PORT}`);
  console.log(`   🔒 Secure HTTPS: https://voxlink.servehttp.com`);
  console.log(`===============================================`);
});
