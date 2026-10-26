// VoxLink v5.0 Full Client Engine
let socket = null;
let currentUser = null;
let sessionToken = null;
let serversMap = new Map();
let currentServerId = null;
let currentView = 'server'; // 'server' or 'dms'
let activeTextChannel = null;
let activeDmPeerId = null;
let currentVoiceChannel = null;
let permissionsList = [];
let collapsedCategories = new Set();
let selectedRoleId = null;
let contextTargetUser = null;
let contextTargetCategory = null;
let isCallStageActive = false;

function resolveMediaUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  let base = (typeof serverHost !== 'undefined' && serverHost) ? serverHost : (localStorage.getItem('voxlink_server_url') || '');
  if (!base || ((typeof isTauriApp !== 'undefined' && isTauriApp || typeof isStandaloneApp !== 'undefined' && isStandaloneApp) && (base.includes('192.168.') || base.includes('localhost') || base.includes('127.0.0.1')))) {
    base = 'https://voxlink.servehttp.com';
  }
  if (base) {
    base = base.replace(/\/+$/, '');
    return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
  }
  return url;
}

// Accounts Registry & Online Status Tracking
const accountsMap = new Map();
const liveUserIds = new Set();

// Active Reply, Reaction & Message State
let activeReplyTarget = null;
let activeReactionMessageId = null;

// Draft image uploads for settings
let draftAvatarUrl = null;
let draftBannerUrl = null;
let draftBannerColor = '#5865F2';
let draftServerIconUrl = null;
let draftServerBannerUrl = null;

// Media & WebRTC State
let localAudioStream = null;
let localVideoStream = null;
let localScreenStream = null;
let isMuted = false;
let isDeafened = false;
let isVideoOn = false;
let isScreenSharing = false;

let audioContext = null;
let analyser = null;
let isSpeaking = false;
let speakingTimeout = null;

const peerConnections = new Map();
const remoteAudios = new Map();
const remoteStreams = new Map();
const remoteScreenStreams = new Map();
const peerMediaStates = new Map();
const pendingIceCandidates = new Map();

const isMobileClient = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || ('ontouchstart' in window || navigator.maxTouchPoints > 0);
try {
  if (isMobileClient && document.body) document.body.classList.add('is-mobile');
} catch (e) {}

async function addIceCandidateSafely(peerId, candidate) {
  const pc = peerConnections.get(peerId);
  if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
    if (!pendingIceCandidates.has(peerId)) pendingIceCandidates.set(peerId, []);
    pendingIceCandidates.get(peerId).push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('addIceCandidate error:', err);
  }
}

async function drainPendingIceCandidates(peerId) {
  const pc = peerConnections.get(peerId);
  if (!pc || !pc.remoteDescription) return;
  const queue = pendingIceCandidates.get(peerId) || [];
  pendingIceCandidates.delete(peerId);
  for (const cand of queue) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(cand));
    } catch (e) {}
  }
}

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

// Pending File & Voice Note State
let pendingAttachment = null;
let pendingP2PFile = null;
const activeP2PFiles = new Map(); // transferId -> File object
const activeDownloaderTransfers = new Map(); // transferId -> { pc, dc, ... }
const activeSenderTransfers = new Map(); // sessionKey -> { pc }
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingSeconds = 0;

// DOM Elements - Auth
const authModal = document.getElementById('auth-modal');
const tabLoginBtn = document.getElementById('tab-login-btn');
const tabRegisterBtn = document.getElementById('tab-register-btn');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authErrorBanner = document.getElementById('auth-error-banner');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const appContainer = document.getElementById('app-container');

// Navigation & Sidebar
const navDms = document.getElementById('nav-dms');
const serverRailList = document.getElementById('server-rail-list');
const btnAddServer = document.getElementById('btn-add-server');
const serverBannerContainer = document.getElementById('server-banner-container');
const serverBannerImg = document.getElementById('server-banner-img');
const serverHeaderBtn = document.getElementById('server-header-btn');
const sidebarTitle = document.getElementById('sidebar-title');
const serverChannelsView = document.getElementById('server-channels-view');
const categoriesContainer = document.getElementById('categories-container');
const dmsView = document.getElementById('dms-view');
const dmConversationsList = document.getElementById('dm-conversations-list');
const channelsSidebar = document.getElementById('channels-sidebar');
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const mobileSidebarClose = document.getElementById('mobile-sidebar-close');

// Views: Call Stage & Chat
const callStageScreen = document.getElementById('call-stage-screen');
const stageChannelTitle = document.getElementById('stage-channel-title');
const callVideoGrid = document.getElementById('call-video-grid');
const toggleStageChatBtn = document.getElementById('toggle-stage-chat-btn');
const toggleFullscreenBtn = document.getElementById('toggle-fullscreen-btn');
const stageToggleMicBtn = document.getElementById('stage-toggle-mic-btn');
const stageToggleVideoBtn = document.getElementById('stage-toggle-video-btn');
const stageToggleScreenBtn = document.getElementById('stage-toggle-screen-btn');
const stageDisconnectBtn = document.getElementById('stage-disconnect-btn');
const chatArea = document.getElementById('chat-area');

// Chat & Header
const activeHeaderIcon = document.getElementById('active-header-icon');
const activeChannelNameEl = document.getElementById('active-channel-name');
const activeChannelTopicEl = document.getElementById('active-channel-topic');
const welcomeIconEl = document.getElementById('welcome-icon');
const welcomeTitleEl = document.getElementById('welcome-title');
const welcomeDescEl = document.getElementById('welcome-desc');
const messagesContainer = document.getElementById('messages-container');
const messagesList = document.getElementById('messages-list');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const fileInput = document.getElementById('file-input');
const attachmentPreviewBar = document.getElementById('attachment-preview-bar');
const previewFilename = document.getElementById('preview-filename');
const previewFilesize = document.getElementById('preview-filesize');
const previewP2PPill = document.getElementById('preview-p2p-pill');
const previewGenericIcon = document.getElementById('attachment-preview-file-icon');
const previewImg = document.getElementById('attachment-preview-img');
const previewCodeBox = document.getElementById('attachment-preview-code-box');
const previewCodeText = document.getElementById('attachment-preview-code-text');
const previewCodeBadge = document.getElementById('attachment-preview-code-badge');
const removeAttachmentBtn = document.getElementById('remove-attachment-btn');

// Reply Bar & Emoji Picker Elements
const replyPreviewBar = document.getElementById('reply-preview-bar');
const replyPreviewAuthor = document.getElementById('reply-preview-author');
const replyPreviewText = document.getElementById('reply-preview-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');
const toggleEmojiBtn = document.getElementById('toggle-emoji-btn');
const emojiPickerPopover = document.getElementById('emoji-picker-popover');
const closeEmojiPicker = document.getElementById('close-emoji-picker');
const emojiGridList = document.getElementById('emoji-grid-list');
const msgReactionPopover = document.getElementById('msg-reaction-popover');

// Thread, Pin & Slowmode State & Elements
let currentSlowmodeSeconds = 0;
let slowmodeCooldownRemaining = 0;
let slowmodeCooldownInterval = null;
let isThreadDraftMode = false;
let currentThreadId = null;
let currentThreadChannelId = null;

const toggleThreadDraftBtn = document.getElementById('toggle-thread-draft-btn');
const threadDraftBanner = document.getElementById('thread-draft-banner');
const threadDraftNameInput = document.getElementById('thread-draft-name-input');
const cancelThreadDraftBtn = document.getElementById('cancel-thread-draft-btn');
const slowmodeCooldownBar = document.getElementById('slowmode-cooldown-bar');
const slowmodeCountdownTimer = document.getElementById('slowmode-countdown-timer');

const togglePinsBtn = document.getElementById('toggle-pins-btn');
const closePinsBtn = document.getElementById('close-pins-btn');
const pinnedMessagesPopover = document.getElementById('pinned-messages-popover');
const pinsCountBadge = document.getElementById('pins-count-badge');
const pinnedMessagesList = document.getElementById('pinned-messages-list');

const toggleThreadsBtn = document.getElementById('toggle-threads-btn');
const closeThreadsListBtn = document.getElementById('close-threads-list-btn');
const threadsListPopover = document.getElementById('threads-list-popover');
const channelThreadsList = document.getElementById('channel-threads-list');

const threadSidebarPanel = document.getElementById('thread-sidebar-panel');
const closeThreadPanelBtn = document.getElementById('close-thread-panel-btn');
const threadPanelName = document.getElementById('thread-panel-name');
const threadPanelSub = document.getElementById('thread-panel-sub');
const threadStarterBody = document.getElementById('thread-starter-body');
const threadMessagesList = document.getElementById('thread-messages-list');
const threadMessagesScrollArea = document.getElementById('thread-messages-scroll-area');
const threadChatForm = document.getElementById('thread-chat-form');
const threadChatInput = document.getElementById('thread-chat-input');
const toggleMembersBtn = document.getElementById('toggle-members-btn');

// Voice Note Banner & Audition Elements
const recordVoiceBtn = document.getElementById('record-voice-btn');
const voiceRecordingBanner = document.getElementById('voice-recording-banner');
const recordingTimer = document.getElementById('recording-timer');
const cancelVoiceBtn = document.getElementById('cancel-voice-btn');
const stopVoiceBtn = document.getElementById('stop-voice-btn');
const voicePreviewBanner = document.getElementById('voice-preview-banner');
const previewVoicePlayBtn = document.getElementById('preview-voice-play-btn');
const previewVoiceTime = document.getElementById('preview-voice-time');
const previewVoiceAudio = document.getElementById('preview-voice-audio');
const discardVoiceBtn = document.getElementById('discard-voice-btn');
const confirmSendVoiceBtn = document.getElementById('confirm-send-voice-btn');

let pendingVoiceNote = null;
let pendingVoiceBlobUrl = null;

// Social & Profile state sets
const friendsSet = new Set();
const mutedUsersSet = new Set();
const blockedUsersSet = new Set();
let activeProfileUser = null;

let cachedDmThreads = [];
let cachedFriends = [];
let cachedIncomingFriends = [];
let cachedOutgoingFriends = [];
let incomingDmCallData = null;

function isCodeFile(filename, mimeType) {
  if (!filename) return false;
  const ext = filename.split('.').pop().toLowerCase();
  const codeExts = [
    'js', 'ts', 'jsx', 'tsx', 'py', 'html', 'htm', 'css', 'scss', 'json',
    'c', 'cpp', 'h', 'hpp', 'cs', 'java', 'rs', 'go', 'php', 'rb', 'sh',
    'bat', 'ps1', 'sql', 'xml', 'yaml', 'yml', 'md', 'txt', 'lua', 'swift'
  ];
  if (codeExts.includes(ext)) return true;
  if (mimeType && (mimeType.startsWith('text/') || mimeType.includes('javascript') || mimeType.includes('json'))) return true;
  return false;
}

function extractBase64Text(dataUrl) {
  if (!dataUrl || !dataUrl.includes(',')) return null;
  try {
    const base64Str = dataUrl.split(',')[1];
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return null;
  }
}

// Helper function to compress images using HTML5 Canvas to prevent multi-megabyte payloads
function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const isGif = file.type === 'image/gif' || (file.name && file.name.toLowerCase().endsWith('.gif'));

    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = (e) => {
      const rawDataUrl = e.target.result;
      if (isGif) {
        // Keep GIF animated frames intact
        return resolve(rawDataUrl);
      }

      try {
        const img = new Image();
        img.onload = () => {
          try {
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
              if (width / height > maxWidth / maxHeight) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              } else {
                width = Math.round((width * maxHeight) / height);
                height = maxHeight;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            const isPng = file.type === 'image/png' || (file.name && file.name.toLowerCase().endsWith('.png'));
            const mime = (isPng && width <= 400) ? 'image/png' : 'image/jpeg';
            const compressedDataUrl = canvas.toDataURL(mime, quality);
            resolve(compressedDataUrl || rawDataUrl);
          } catch (canvasErr) {
            resolve(rawDataUrl);
          }
        };
        img.onerror = () => resolve(rawDataUrl);
        img.src = rawDataUrl;
      } catch (err) {
        resolve(rawDataUrl);
      }
    };
    reader.readAsDataURL(file);
  });
}

window.toggleCodeFilePreview = function(msgId) {
  const preview = document.getElementById(`code-preview-${msgId}`);
  if (!preview) return;
  const isHidden = preview.style.display === 'none';
  preview.style.display = isHidden ? 'block' : 'none';
};

window.openImageLightbox = function(url, filename) {
  const modal = document.getElementById('image-lightbox-modal');
  const img = document.getElementById('lightbox-image');
  const nameEl = document.getElementById('lightbox-filename');
  const dlLink = document.getElementById('lightbox-download-link');
  if (!modal || !img) return;
  img.src = url;
  nameEl.textContent = filename || 'Photo Preview';
  dlLink.href = url;
  dlLink.download = filename || 'voxlink-image.png';
  modal.style.display = 'flex';
};

window.closeLightboxModal = function(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const modal = document.getElementById('image-lightbox-modal');
  if (modal) modal.style.display = 'none';
};


// Voice Connected Bottom Bar
const voiceConnectedBar = document.getElementById('voice-connected-bar');
const voiceBarClickExpand = document.getElementById('voice-bar-click-expand');
const currentVoiceChannelLabel = document.getElementById('current-voice-channel-label');
const toggleVideoBtn = document.getElementById('toggle-video-btn');
const toggleScreenBtn = document.getElementById('toggle-screen-btn');
const disconnectVoiceBtn = document.getElementById('disconnect-voice-btn');

// User Panel & Profile
const userProfileBtn = document.getElementById('user-profile-btn');
const selfAvatar = document.getElementById('self-avatar');
const selfUsername = document.getElementById('self-username');
const selfGlobalBadge = document.getElementById('self-global-badge');
const selfStatusLabel = document.getElementById('self-status-label');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleDeafenBtn = document.getElementById('toggle-deafen-btn');
const micIcon = document.getElementById('mic-icon');
const micMutedIcon = document.getElementById('mic-muted-icon');
const headphoneIcon = document.getElementById('headphone-icon');
const headphoneDeafenedIcon = document.getElementById('headphone-deafened-icon');
const membersList = document.getElementById('members-list');
const remoteAudioContainer = document.getElementById('remote-audio-container');

// Context & Dropdown Menus
const serverDropdownMenu = document.getElementById('server-dropdown-menu');
const menuServerSettings = document.getElementById('menu-server-settings');
const menuCreateCategory = document.getElementById('menu-create-category');
const menuCreateChannel = document.getElementById('menu-create-channel');

const categoryContextMenu = document.getElementById('category-context-menu');
const catCtxRename = document.getElementById('cat-ctx-rename');
const catCtxDelete = document.getElementById('cat-ctx-delete');

const userContextMenu = document.getElementById('user-context-menu');
const ctxSendDm = document.getElementById('ctx-send-dm');
const ctxGlobalDivider = document.getElementById('ctx-global-divider');
const ctxGlobalLabel = document.getElementById('ctx-global-label');
const ctxToggleDev = document.getElementById('ctx-toggle-dev');
const ctxRolesList = document.getElementById('ctx-roles-list');
const ctxKick = document.getElementById('ctx-kick');
const ctxBan = document.getElementById('ctx-ban');

function playChime(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);

    if (type === 'join') {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    } else if (type === 'leave') {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(330, ctx.currentTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    } else if (type === 'mute') {
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    } else if (type === 'call-outgoing') {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(480, ctx.currentTime + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    } else if (type === 'call-incoming') {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(); osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {}
}

window.openModal = function(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
};
window.closeModal = function(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
};
function openModal(id) { window.openModal(id); }
function closeModal(id) { window.closeModal(id); }

// =========================================
// CUSTOM DISCORD CONFIRMATION & TOAST SYSTEM
// =========================================
let confirmResolve = null;

window.showConfirmDialog = function({
  title = 'Are you sure?',
  description = 'This action cannot be undone.',
  previewText = null,
  confirmText = 'Confirm',
  isDanger = true,
  icon = '⚠️'
} = {}) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    const modal = document.getElementById('confirm-warning-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const descEl = document.getElementById('confirm-modal-desc');
    const previewEl = document.getElementById('confirm-modal-preview');
    const iconEl = document.getElementById('confirm-modal-icon');
    const actionBtn = document.getElementById('confirm-modal-action-btn');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = description;
    if (iconEl) iconEl.textContent = icon;

    if (previewText && previewEl) {
      previewEl.textContent = previewText;
      previewEl.style.display = 'block';
    } else if (previewEl) {
      previewEl.style.display = 'none';
    }

    if (actionBtn) {
      actionBtn.textContent = confirmText;
      actionBtn.className = isDanger ? 'btn-danger' : 'btn-primary';
    }

    modal.style.display = 'flex';
  });
};

document.getElementById('confirm-modal-action-btn').addEventListener('click', () => {
  const modal = document.getElementById('confirm-warning-modal');
  modal.style.display = 'none';
  if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
});

document.getElementById('confirm-modal-cancel-btn').addEventListener('click', () => {
  const modal = document.getElementById('confirm-warning-modal');
  modal.style.display = 'none';
  if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
});

window.showToast = function(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const item = document.createElement('div');
  item.className = `toast-item ${type}`;
  const icon = type === 'error' ? '❌' : (type === 'success' ? '✅' : 'ℹ️');
  item.innerHTML = `<span>${icon}</span><span>${escapeHTML(msg)}</span>`;
  container.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(16px)';
    setTimeout(() => item.remove(), 250);
  }, 3200);
};

// PWA & Android Mobile Installation
if ('serviceWorker' in navigator) {
  const isTauriEnv = !!(
    window.__TAURI__ ||
    window.__TAURI_INTERNALS__ ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost'
  );

  if (isTauriEnv) {
    // Unregister any stale service workers in desktop WebView to avoid SSL protocol collisions
    navigator.serviceWorker.getRegistrations().then(regs => {
      for (const r of regs) r.unregister();
    }).catch(() => {});
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

let deferredPwaPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPwaPrompt = e;
  const pwaInstallBtn = document.getElementById('btn-pwa-install');
  if (pwaInstallBtn) pwaInstallBtn.style.display = 'inline-flex';
});

window.installPwaApp = async function() {
  if (deferredPwaPrompt) {
    deferredPwaPrompt.prompt();
    const { outcome } = await deferredPwaPrompt.userChoice;
    if (outcome === 'accepted') {
      const pwaInstallBtn = document.getElementById('btn-pwa-install');
      if (pwaInstallBtn) pwaInstallBtn.style.display = 'none';
    }
    deferredPwaPrompt = null;
  }
};

// =========================================
// 1. AUTHENTICATION & SEAMLESS RECONNECT
// =========================================
window.addEventListener('DOMContentLoaded', () => {
  const isStandaloneApp = !!(
    window.__TAURI__ ||
    window.__TAURI_INTERNALS__ ||
    window.Capacitor ||
    window.AndroidNative ||
    window.location.protocol === 'tauri:' ||
    window.location.protocol === 'capacitor:' ||
    window.location.hostname === 'tauri.localhost' ||
    (window.location.hostname === 'localhost' && window.location.port !== '3000')
  );

  const isTauriApp = Boolean(
    window.__TAURI__ ||
    window.__TAURI_INTERNALS__ ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost'
  );

  const isNativeAndroid = Boolean(
    window.AndroidNative ||
    window.location.protocol === 'capacitor:' ||
    (window.location.hostname === 'localhost' && window.location.port !== '3000' && window.location.protocol === 'http:' && !window.__TAURI__)
  );

  // Distinguish between Mobile Web Browser (Safari/Chrome on phone) and Native Android APK
  if (isNativeAndroid) {
    document.body.classList.add('is-native-android-app');
    document.body.classList.remove('is-mobile-web');
  } else if (isMobileClient || window.innerWidth <= 768) {
    document.body.classList.add('is-mobile-web');
  }

  const defaultHost = (isTauriApp || isStandaloneApp) ? 'https://voxlink.servehttp.com' : '';
  let savedServer = localStorage.getItem('voxlink_server_url');
  if (savedServer && savedServer.startsWith('http://voxlink.')) {
    savedServer = savedServer.replace('http://', 'https://');
    localStorage.setItem('voxlink_server_url', savedServer);
  }
  let serverHost = savedServer || defaultHost;

  // Auto-redirect insecure web access on the public domain to HTTPS (browser-only)
  if (!isTauriApp && !isStandaloneApp && window.location.protocol === 'http:' && window.location.hostname === 'voxlink.servehttp.com') {
    window.location.href = window.location.href.replace('http:', 'https:');
  }

  const hostValEl = document.getElementById('auth-server-host-val');
  if (hostValEl) hostValEl.textContent = serverHost || window.location.origin;

  // Request system notification permission early
  if ('Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission(); } catch (e) {}
  }

  const btnChangeServer = document.getElementById('btn-change-server-url');
  const serverSwitcherModal = document.getElementById('server-switcher-modal');
  const serverSwitcherInput = document.getElementById('server-switcher-input');
  const serverSwitcherForm = document.getElementById('server-switcher-form');
  const presetBtnDomain = document.getElementById('preset-btn-domain');
  const presetBtnWifi = document.getElementById('preset-btn-wifi');
  const presetBtnLocal = document.getElementById('preset-btn-local');

  if (btnChangeServer && serverSwitcherModal) {
    btnChangeServer.addEventListener('click', () => {
      if (serverSwitcherInput) {
        serverSwitcherInput.value = localStorage.getItem('voxlink_server_url') || serverHost || 'https://voxlink.servehttp.com';
      }
      serverSwitcherModal.style.display = 'flex';
      setTimeout(() => { if (serverSwitcherInput) serverSwitcherInput.focus(); }, 50);
    });
  }

  if (presetBtnDomain && serverSwitcherInput) {
    presetBtnDomain.addEventListener('click', () => {
      serverSwitcherInput.value = 'https://voxlink.servehttp.com';
    });
  }

  if (presetBtnWifi && serverSwitcherInput) {
    presetBtnWifi.addEventListener('click', () => {
      serverSwitcherInput.value = 'http://192.168.0.66:3000';
    });
  }

  if (presetBtnLocal && serverSwitcherInput) {
    presetBtnLocal.addEventListener('click', () => {
      serverSwitcherInput.value = 'http://localhost:3000';
    });
  }

  if (serverSwitcherForm) {
    serverSwitcherForm.addEventListener('submit', (e) => {
      e.preventDefault();
      let newHost = serverSwitcherInput.value.trim().replace(/\/+$/, '');
      if (!newHost.startsWith('http://') && !newHost.startsWith('https://')) {
        newHost = 'http://' + newHost;
      }
      localStorage.setItem('voxlink_server_url', newHost);
      serverSwitcherModal.style.display = 'none';
      window.location.reload();
    });
  }

  let fallbackAttempted = false;
  socket = serverHost ? io(serverHost, { reconnection: true, timeout: 5000 }) : io();
  setupSocketListeners();
  setupEmojiPicker();

  socket.on('connect_error', () => {
    // If running in APK or Desktop Client outside the local network, and configured server is an unreachable private LAN IP, automatically fallback to public domain
    if (!fallbackAttempted && (isStandaloneApp || isNativeAndroid || isTauriApp) && serverHost && (serverHost.includes('192.168.') || serverHost.includes('localhost') || serverHost.includes('127.0.0.1'))) {
      console.warn('Private LAN server unreachable (outside network active). Falling back to https://voxlink.servehttp.com...');
      fallbackAttempted = true;
      serverHost = 'https://voxlink.servehttp.com';
      localStorage.setItem('voxlink_server_url', serverHost);
      try { socket.disconnect(); } catch (e) {}
      socket = io(serverHost, { reconnection: true, timeout: 5000 });
      setupSocketListeners();
      const savedToken = localStorage.getItem('voxlink_token');
      if (savedToken) {
        socket.emit('auth-token', { token: savedToken });
      }
      return;
    }

    const statusLabel = document.getElementById('auth-server-status-label');
    if (statusLabel) {
      statusLabel.innerHTML = `<span style="color: #ED4245;">⚠️ Offline:</span> <strong style="color: var(--text-header);">${serverHost || 'localhost:3000'}</strong>`;
    }
  });

  socket.on('connect', () => {
    const statusLabel = document.getElementById('auth-server-status-label');
    if (statusLabel) {
      statusLabel.innerHTML = `<span style="color: #3ba55d;">✓ Online:</span> <strong style="color: var(--text-header);">${serverHost || window.location.origin}</strong>`;
    }
  });

  const savedToken = localStorage.getItem('voxlink_token');
  if (savedToken) {
    // Keep auth modal hidden seamlessly without any visual flashing
    authModal.style.display = 'none';
    socket.emit('auth-token', { token: savedToken });
    // Safety fallback: if no currentUser authenticated after 4 seconds (e.g. server down or wrong address), show auth screen with change server button
    setTimeout(() => {
      if (!currentUser) {
        showAuthModal('login');
      }
    }, 4000);
  } else {
    showAuthModal('login');
  }
});

function showAuthModal(mode) {
  authModal.style.display = 'flex';
  authErrorBanner.style.display = 'none';

  if (mode === 'login') {
    tabLoginBtn.classList.add('active');
    tabRegisterBtn.classList.remove('active');
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    authTitle.textContent = 'Welcome Back!';
    authSubtitle.textContent = "We're so excited to see you again!";
  } else {
    tabRegisterBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
    registerForm.style.display = 'block';
    loginForm.style.display = 'none';
    authTitle.textContent = 'Create an Account';
    authSubtitle.textContent = 'Join and connect with friends anywhere.';
  }
}

tabLoginBtn.addEventListener('click', () => showAuthModal('login'));
tabRegisterBtn.addEventListener('click', () => showAuthModal('register'));

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  authErrorBanner.style.display = 'none';
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  socket.emit('auth-login', { username, password });
});

registerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  authErrorBanner.style.display = 'none';
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const customStatus = document.getElementById('reg-status').value.trim();
  socket.emit('auth-register', { username, password, customStatus });
});

// Continue with Google Modal
document.getElementById('btn-google-login').addEventListener('click', () => {
  document.getElementById('google-auth-modal').style.display = 'flex';
});

// Demo Google Quick Login (Alex)
document.getElementById('google-quick-alex').addEventListener('click', () => {
  closeModal('google-auth-modal');
  socket.emit('auth-google', {
    email: 'alex.developer@gmail.com',
    name: 'Alex Dev',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&auto=format&fit=crop'
  });
});

// Custom Google Account Form
document.getElementById('google-custom-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('google-custom-name').value.trim();
  const email = document.getElementById('google-custom-email').value.trim();
  closeModal('google-auth-modal');
  socket.emit('auth-google', { name, email });
});


document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('voxlink_token');
  window.location.reload();
});

function setupSocketListeners() {
  socket.on('auth-error', (msg) => {
    authErrorBanner.textContent = msg;
    authErrorBanner.style.display = 'block';
  });

  socket.on('auth-required', () => {
    showAuthModal('login');
  });

  socket.on('auth-success', (data) => {
    sessionToken = data.token;
    localStorage.setItem('voxlink_token', sessionToken);
    currentUser = data.self;
    permissionsList = data.permissionsList || [];

    if (data.allUsers) {
      data.allUsers.forEach(a => accountsMap.set(a.id, a));
    }
    liveUserIds.clear();
    if (data.users) {
      data.users.forEach(u => liveUserIds.add(u.id));
    }

    serversMap.clear();
    if (data.servers) {
      data.servers.forEach(s => serversMap.set(s.id, s));
    }
    renderServerRail();

    authModal.style.display = 'none';
    appContainer.style.display = 'flex';

    updateSelfProfileUI();
    if (window.innerWidth > 850 && typeof openMembersSidebar === 'function') {
      openMembersSidebar();
    }

    if (data.servers && data.servers.length > 0) {
      if (!currentServerId || !serversMap.has(currentServerId)) {
        currentServerId = data.servers[0].id;
      }
      switchServer(currentServerId);
    } else {
      currentServerId = null;
      navDms.click();
    }
  });

  socket.on('banned-from-server', async ({ serverId, serverName, reason }) => {
    if (serverId) serversMap.delete(serverId);
    renderServerRail();
    showToast(`You have been banned from ${serverName || 'the server'}. Reason: ${reason || 'Banned by staff'}`, 'error');
    if (currentServerId === serverId || !serversMap.has(currentServerId)) {
      currentServerId = null;
      navDms.click();
    }
  });

  socket.on('kicked-from-server', async ({ serverId, serverName, reason }) => {
    if (serverId) serversMap.delete(serverId);
    renderServerRail();
    showToast(`You have been kicked from ${serverName || 'the server'}. Reason: ${reason || 'Kicked by staff'}`, 'warning');
    if (currentServerId === serverId || !serversMap.has(currentServerId)) {
      currentServerId = null;
      navDms.click();
    }
  });

  socket.on('server-created', (serverObj) => {
    serversMap.set(serverObj.id, serverObj);
    renderServerRail();
    switchServer(serverObj.id);
  });

  socket.on('server-updated', (serverObj) => {
    const isMember = (serverObj.memberRoles && currentUser && serverObj.memberRoles[currentUser.id]) || (currentUser && serverObj.ownerId === currentUser.id);
    if (!isMember) {
      serversMap.delete(serverObj.id);
      renderServerRail();
      if (currentServerId === serverObj.id) {
        currentServerId = null;
        navDms.click();
      }
      return;
    }

    serversMap.set(serverObj.id, serverObj);
    if (currentServerId === serverObj.id) {
      sidebarTitle.textContent = serverObj.name;
      const officialBadgeEl = document.getElementById('server-official-badge');
      if (officialBadgeEl) {
        officialBadgeEl.style.display = serverObj.isOfficial ? 'inline-flex' : 'none';
      }
      renderServerBanner();
      renderCategoriesAndChannels();
      renderMembers();
      if (document.getElementById('server-settings-modal').style.display === 'flex') {
        renderRolesManager();
        renderBansTab();
      }
    }
    renderServerRail();
  });

  socket.on('server-deleted', ({ serverId }) => {
    serversMap.delete(serverId);
    if (currentServerId === serverId) {
      const remaining = Array.from(serversMap.keys());
      if (remaining.length > 0) switchServer(remaining[0]);
    }
    renderServerRail();
  });

  socket.on('user-connected', (payload) => {
    const user = payload.user || payload;
    if (payload.allUsers) {
      payload.allUsers.forEach(a => accountsMap.set(a.id, a));
    }
    accountsMap.set(user.id, user);
    liveUserIds.add(user.id);
    renderMembers();

    if (currentUser && user.id !== currentUser.id) {
      const isFriend = cachedFriends.some(f => f.id === user.id);
      if (isFriend) {
        showToast(`@${user.username} is now online! 🟢`, 'info');
        showDesktopNotification('Friend Online 🟢', `@${user.username} is now active on VoxLink.`);
      }
    }
  });

  socket.on('user-disconnected', (userId) => {
    closePeerConnection(userId);
    liveUserIds.delete(userId);
    renderMembers();
    updateCallGridScaling();
  });

  socket.on('user-state-changed', (user) => {
    accountsMap.set(user.id, user);
    if (currentUser && user.id === currentUser.id) {
      currentUser = user;
      updateSelfProfileUI();
    }
    renderMembers();
    renderCategoriesAndChannels();
    updateCallGridScaling();
  });

  socket.on('user-profile-updated', ({ userId, username, avatarUrl, bannerUrl, bannerColor, bio, googleEmail, customStatus, globalBadges }) => {
    const acc = accountsMap.get(userId) || { id: userId };
    acc.username = username;
    acc.avatarUrl = avatarUrl;
    acc.bannerUrl = bannerUrl;
    acc.bannerColor = bannerColor;
    acc.bio = bio;
    if (googleEmail) acc.googleEmail = googleEmail;
    acc.customStatus = customStatus;
    acc.globalBadges = globalBadges;
    accountsMap.set(userId, acc);

    if (currentUser && currentUser.id === userId) {
      currentUser.username = username;
      currentUser.avatarUrl = avatarUrl;
      currentUser.bannerUrl = bannerUrl;
      currentUser.bannerColor = bannerColor;
      currentUser.bio = bio;
      if (googleEmail) currentUser.googleEmail = googleEmail;
      currentUser.customStatus = customStatus;
      currentUser.globalBadges = globalBadges;
      updateSelfProfileUI();
    }
    renderMembers();

    // Propagate avatar & username update to all previously rendered messages by this user!
    document.querySelectorAll(`.message-row[data-sender-id="${userId}"]`).forEach(row => {
      const avatarEl = row.querySelector('.message-avatar');
      if (avatarEl) {
        if (avatarUrl) {
          avatarEl.style.backgroundImage = `url(${avatarUrl})`;
          avatarEl.textContent = '';
        } else {
          avatarEl.style.backgroundImage = 'none';
          avatarEl.textContent = username.substring(0, 1).toUpperCase();
        }
      }
      const authorEl = row.querySelector('.message-author');
      if (authorEl) authorEl.textContent = username;
    });

    // Propagate to reply headers referencing this user
    document.querySelectorAll(`.message-reply-preview[data-reply-sender-id="${userId}"] .message-reply-author`).forEach(el => {
      el.textContent = '@' + username;
    });

    // If profile card modal is currently open for this user, refresh it immediately!
    const profileCardModal = document.getElementById('user-profile-panel-modal');
    if (profileCardModal && profileCardModal.style.display !== 'none' && activeProfileUser && activeProfileUser.id === userId) {
      openUserProfileCard(acc);
    }
  });

  socket.on('global-badge-updated', ({ userId, globalBadges }) => {
    if (currentUser && currentUser.id === userId) {
      currentUser.globalBadges = globalBadges;
      updateSelfProfileUI();
    }
    const acc = accountsMap.get(userId);
    if (acc) acc.globalBadges = globalBadges;
    renderMembers();
  });

  socket.on('error-msg', (msg) => {
    showToast(msg, 'warning');
  });

  socket.on('new-message', (message) => {
    const srv = serversMap.get(message.serverId);
    if (srv) {
      if (!srv.messages) srv.messages = {};
      if (!srv.messages[message.channelId]) srv.messages[message.channelId] = [];
      if (!srv.messages[message.channelId].some(m => m.id === message.id)) {
        srv.messages[message.channelId].push(message);
      }
    }

    if (currentView === 'server' && message.serverId === currentServerId && message.channelId === activeTextChannel) {
      renderMessage(message);
      scrollToBottom();
      updatePinsCountBadge();
      if (message.hasThread && currentUser && message.senderId === currentUser.id) {
        openThreadPanel(message.id);
      }
    }
  });

  socket.on('message-pin-updated', ({ serverId, channelId, messageId, isPinned, pinnedAt }) => {
    const srv = serversMap.get(serverId);
    if (srv && srv.messages && srv.messages[channelId]) {
      const m = srv.messages[channelId].find(msg => msg.id === messageId);
      if (m) {
        m.isPinned = isPinned;
        m.pinnedAt = pinnedAt;
      }
    }

    if (currentView === 'server' && currentServerId === serverId && activeTextChannel === channelId) {
      const row = document.getElementById(`msg-${messageId}`);
      if (row) {
        const header = row.querySelector('.message-header');
        let pinTag = row.querySelector('.message-pinned-tag');
        if (isPinned && !pinTag && header) {
          const tagEl = document.createElement('span');
          tagEl.className = 'message-pinned-tag';
          tagEl.innerHTML = '📌 Pinned';
          header.appendChild(tagEl);
        } else if (!isPinned && pinTag) {
          pinTag.remove();
        }
        const pinBtn = row.querySelector('.msg-action-btn[title*="Pin"]');
        if (pinBtn) {
          pinBtn.classList.toggle('active', isPinned);
          pinBtn.title = isPinned ? 'Unpin Message' : 'Pin Message';
        }
      }
      updatePinsCountBadge();
      if (pinnedMessagesPopover && pinnedMessagesPopover.style.display !== 'none') {
        renderPinnedMessagesPopover();
      }
    }
    showToast(isPinned ? 'Message pinned! 📌' : 'Message unpinned.', 'info');
  });

  socket.on('thread-created', ({ serverId, channelId, parentMessageId, thread, threadName }) => {
    const srv = serversMap.get(serverId);
    if (srv) {
      if (!srv.threads) srv.threads = {};
      srv.threads[parentMessageId] = thread;
      if (srv.messages && srv.messages[channelId]) {
        const m = srv.messages[channelId].find(msg => msg.id === parentMessageId);
        if (m) {
          m.hasThread = true;
          m.threadName = threadName;
          m.threadReplyCount = 0;
          m.threadRepliesCount = 0;
        }
      }
    }

    if (currentView === 'server' && currentServerId === serverId && activeTextChannel === channelId) {
      const row = document.getElementById(`msg-${parentMessageId}`);
      if (row) {
        let card = row.querySelector('.message-thread-card');
        if (!card) {
          const body = row.querySelector('.message-body');
          if (body) {
            const threadCardEl = document.createElement('div');
            threadCardEl.className = 'message-thread-card';
            threadCardEl.onclick = () => openThreadPanel(parentMessageId);
            threadCardEl.innerHTML = `
              <span class="thread-card-icon">🧵</span>
              <span class="thread-card-name">${escapeHTML(threadName || 'Thread')}</span>
              <span class="thread-card-replies">• 0 replies</span>
              <span class="thread-card-arrow">View Thread ›</span>
            `;
            const contentEl = row.querySelector('.message-content');
            if (contentEl && contentEl.nextSibling) {
              body.insertBefore(threadCardEl, contentEl.nextSibling);
            } else {
              body.appendChild(threadCardEl);
            }
          }
        }
      }
      if (threadsListPopover && threadsListPopover.style.display !== 'none') {
        renderThreadsListPopover();
      }
    }
  });

  socket.on('thread-data', ({ threadId, rootMessage, threadMeta, replies }) => {
    if (currentThreadId !== threadId) return;
    const titleEl = document.getElementById('thread-panel-name') || document.getElementById('thread-panel-title');
    if (titleEl) titleEl.textContent = (threadMeta && threadMeta.name) || (rootMessage && rootMessage.threadName) || 'Thread';

    const subEl = document.getElementById('thread-panel-sub');
    if (subEl) {
      const creatorName = (threadMeta && threadMeta.creatorUsername) || (rootMessage && rootMessage.username) || 'User';
      subEl.textContent = `Started by @${creatorName}`;
    }

    const srv = getCurrentServer();
    const canDelete = currentUser && (
      (rootMessage && rootMessage.senderId === currentUser.id) ||
      (threadMeta && threadMeta.creatorId === currentUser.id) ||
      (srv && srv.ownerId === currentUser.id) ||
      hasPermission(srv, currentUser.id, 'MANAGE_CHANNELS') ||
      hasPermission(srv, currentUser.id, 'MANAGE_SERVER') ||
      (currentUser.globalBadges && (currentUser.globalBadges.includes('PROJECT_OWNER') || currentUser.globalBadges.includes('CREATOR') || currentUser.globalBadges.includes('DEVELOPER')))
    );
    const delBtn = document.getElementById('delete-thread-btn');
    if (delBtn) delBtn.style.display = canDelete ? 'inline-flex' : 'none';

    renderThreadStarterCard(rootMessage);
    if (threadMessagesList) threadMessagesList.innerHTML = '';
    if (replies && replies.length > 0) {
      replies.forEach(r => appendThreadMessageToPanel(r));
    }
  });

  socket.on('thread-deleted', ({ serverId, channelId, threadId }) => {
    const srv = serversMap.get(serverId);
    if (srv) {
      if (srv.threads) delete srv.threads[threadId];
      if (srv.messages && srv.messages[channelId]) {
        const root = srv.messages[channelId].find(m => m.id === threadId);
        if (root) {
          root.hasThread = false;
          root.threadName = null;
          root.threadRepliesCount = 0;
          root.threadReplyCount = 0;
        }
      }
    }

    if (currentThreadId === threadId) {
      closeThreadPanel();
    }

    if (currentView === 'server' && currentServerId === serverId && activeTextChannel === channelId) {
      const row = document.getElementById(`msg-${threadId}`);
      if (row) {
        const card = row.querySelector('.message-thread-card');
        if (card) card.remove();
      }
      if (threadsListPopover && threadsListPopover.style.display !== 'none') {
        renderThreadsListPopover();
      }
    }
    showToast('Thread was deleted. 🗑️', 'info');
  });

  socket.on('new-thread-message', ({ serverId, channelId, threadId, message, repliesCount }) => {
    const srv = serversMap.get(serverId);
    if (srv) {
      if (!srv.threads) srv.threads = {};
      if (!srv.threads[threadId]) {
        srv.threads[threadId] = { replies: [] };
      }
      if (!srv.threads[threadId].replies) srv.threads[threadId].replies = [];
      srv.threads[threadId].replies.push(message);

      if (srv.messages && srv.messages[channelId]) {
        const root = srv.messages[channelId].find(m => m.id === threadId);
        if (root) {
          root.threadReplyCount = repliesCount;
          root.threadRepliesCount = repliesCount;
        }
      }
    }

    if (currentView === 'server' && currentServerId === serverId && activeTextChannel === channelId) {
      const row = document.getElementById(`msg-${threadId}`);
      if (row) {
        const repliesEl = row.querySelector('.thread-card-replies');
        if (repliesEl) {
          repliesEl.textContent = `• ${repliesCount} ${repliesCount === 1 ? 'reply' : 'replies'}`;
        }
      }
      if (threadsListPopover && threadsListPopover.style.display !== 'none') {
        renderThreadsListPopover();
      }
    }

    if (currentThreadId === threadId) {
      appendThreadMessageToPanel(message);
    }
  });

  socket.on('message-edited', ({ serverId, channelId, messageId, newText }) => {
    const targetServerId = serverId || currentServerId;
    const srv = serversMap.get(targetServerId);
    if (srv && srv.messages && srv.messages[channelId]) {
      const msg = srv.messages[channelId].find(m => m.id === messageId);
      if (msg) {
        msg.text = newText;
        msg.isEdited = true;
      }
    }
    if (currentView === 'server' && channelId === activeTextChannel) {
      applyMessageEditInDOM(messageId, newText);
    }
  });

  socket.on('dm-message-edited', ({ messageId, newText }) => {
    if (currentView === 'dms') {
      applyMessageEditInDOM(messageId, newText);
    }
  });

  socket.on('message-deleted', ({ serverId, channelId, messageId }) => {
    serversMap.forEach(s => {
      if (s.messages) {
        for (const chId in s.messages) {
          if (!channelId || chId === channelId) {
            const idx = s.messages[chId].findIndex(m => m.id === messageId);
            if (idx !== -1) {
              s.messages[chId].splice(idx, 1);
            }
          }
        }
      }
    });
    applyMessageDeleteInDOM(messageId);
    updatePinsCountBadge();
    if (pinnedMessagesPopover && pinnedMessagesPopover.style.display !== 'none') {
      renderPinnedMessagesPopover();
    }
  });

  socket.on('dm-message-deleted', ({ messageId }) => {
    if (currentView === 'dms') {
      applyMessageDeleteInDOM(messageId);
    }
  });

  socket.on('channel-cleared', ({ serverId, channelId, message }) => {
    const targetServerId = serverId || currentServerId;
    const srv = serversMap.get(targetServerId);
    if (srv && srv.messages && srv.messages[channelId]) {
      srv.messages[channelId] = message ? [message] : [];
    }
    if (currentView === 'server' && currentServerId === serverId && activeTextChannel === channelId) {
      messagesList.innerHTML = '';
      if (message) {
        renderMessage(message);
      }
      showToast('Chat was cleared by staff. 🧹', 'info');
    }
    updatePinsCountBadge();
  });

  socket.on('server-joined', (joinedSrv) => {
    serversMap.set(joinedSrv.id, joinedSrv);
    renderServerRail();
    switchServer(joinedSrv.id);
    showToast(`Joined ${joinedSrv.name}! 🎉`, 'success');
  });

  socket.on('message-reaction-updated', ({ serverId, channelId, messageId, reactions }) => {
    const targetServerId = serverId || currentServerId;
    const srv = serversMap.get(targetServerId);
    if (srv && srv.messages && srv.messages[channelId]) {
      const msg = srv.messages[channelId].find(m => m.id === messageId);
      if (msg) {
        msg.reactions = reactions;
      }
    }
    if (currentView === 'server' && channelId === activeTextChannel) {
      applyMessageReactionsInDOM(messageId, reactions);
    }
  });

  socket.on('dm-reaction-updated', ({ messageId, reactions }) => {
    if (currentView === 'dms') {
      applyMessageReactionsInDOM(messageId, reactions);
    }
  });

  socket.on('new-dm', ({ dmKey, message, peerId }) => {
    if (currentView === 'dms' && activeDmPeerId === peerId) {
      renderMessage(message);
      scrollToBottom();
    } else {
      showToast(`New message from ${message.username}: "${(message.text || 'Sent an attachment').substring(0, 30)}"`, 'info');
    }
    // Refresh thread list if in DMs view
    if (currentView === 'dms') {
      socket.emit('get-dm-threads');
    }
  });

  socket.on('dm-history', ({ targetId, isGroup, groupMeta, members, history, peerMeta }) => {
    if (currentView === 'dms' && activeDmPeerId === targetId) {
      messagesList.innerHTML = '';
      history.forEach(renderMessage);
      scrollToBottom();

      if (isGroup && groupMeta) {
        currentDmGroupMeta = groupMeta;
        currentDmGroupMembers = members || [];
        renderDmWelcomeBox(groupMeta, true);
        renderDmGroupSidebar(groupMeta, members);
      } else if (peerMeta) {
        currentDmPeerMeta = peerMeta;
        renderDmWelcomeBox(peerMeta, false);
        renderDmUserProfileSidebar(peerMeta);
      }
    }
  });

  socket.on('dm-group-updated', ({ groupMeta, members }) => {
    // 1. Immediately update in cachedDmThreads for instant UI responsiveness
    let existingThread = (cachedDmThreads || []).find(t => t.peerId === groupMeta.id || t.id === groupMeta.id);
    if (existingThread) {
      existingThread.username = groupMeta.name;
      existingThread.avatarUrl = groupMeta.avatarUrl;
      existingThread.bannerUrl = groupMeta.bannerUrl;
      existingThread.description = groupMeta.description;
      existingThread.memberIds = groupMeta.members;
      existingThread.membersCount = groupMeta.members.length;
      existingThread.customStatus = `${groupMeta.members.length} members`;
    } else {
      if (!cachedDmThreads) cachedDmThreads = [];
      cachedDmThreads.unshift({
        id: groupMeta.id,
        peerId: groupMeta.id,
        isGroup: true,
        username: groupMeta.name,
        avatarUrl: groupMeta.avatarUrl,
        bannerUrl: groupMeta.bannerUrl,
        description: groupMeta.description,
        memberIds: groupMeta.members,
        membersCount: groupMeta.members.length,
        customStatus: `${groupMeta.members.length} members`,
        color: '#5865F2',
        isOnline: true
      });
    }
    if (currentView === 'dms') {
      renderDmConversationsList();
    }

    // 2. If actively viewing this group, update header and member roster immediately
    if (currentView === 'dms' && activeDmPeerId === groupMeta.id) {
      currentDmGroupMeta = groupMeta;
      currentDmGroupMembers = members || [];
      activeChannelNameEl.textContent = groupMeta.name;
      activeChannelTopicEl.textContent = groupMeta.description 
        ? `${groupMeta.description} • ${groupMeta.members.length} members`
        : `${groupMeta.members.length} members in this group chat`;
      if (activeHeaderIcon) {
        if (groupMeta.avatarUrl) {
          activeHeaderIcon.innerHTML = `<img src="${resolveMediaUrl(groupMeta.avatarUrl)}" style="width: 22px; height: 22px; border-radius: 50%; object-fit: cover;">`;
        } else {
          activeHeaderIcon.textContent = '👥';
        }
      }
      renderDmWelcomeBox(groupMeta, true);
      renderDmGroupSidebar(groupMeta, members);
    }
    socket.emit('get-dm-threads');
  });

  socket.on('dm-group-removed', ({ groupId, groupName }) => {
    showToast(`You were removed from ${groupName || 'the group'}.`, 'warning');
    if (activeDmPeerId === groupId) {
      activeDmPeerId = null;
      renderFriendsMainStage('online');
    }
    socket.emit('get-dm-threads');
  });

  socket.on('dm-group-deleted', ({ groupId, groupName }) => {
    showToast(`Group "${groupName || 'Chat'}" was deleted.`, 'info');
    if (activeDmPeerId === groupId) {
      activeDmPeerId = null;
      renderFriendsMainStage('online');
    }
    socket.emit('get-dm-threads');
  });

  socket.on('dm-conversation-cleared', ({ targetId, key, isGroup }) => {
    if (currentView === 'dms' && activeDmPeerId === targetId) {
      messagesList.innerHTML = '';
      const welcomeBox = document.getElementById('messages-welcome-box');
      if (welcomeBox) welcomeBox.style.display = 'block';
      showToast('Conversation history deleted.', 'info');
    }
    socket.emit('get-dm-threads');
  });

  socket.on('dm-threads', (threads) => {
    cachedDmThreads = threads || [];
    if (currentView === 'dms') {
      renderDmConversationsList();
    }
  });

  socket.on('friends-data', ({ friends, incoming, outgoing }) => {
    cachedFriends = friends || [];
    cachedIncomingFriends = incoming || [];
    cachedOutgoingFriends = outgoing || [];

    friendsSet.clear();
    cachedFriends.forEach(f => friendsSet.add(f.id));

    const badge = document.getElementById('friends-pending-badge');
    const quickBadge = document.getElementById('quick-friends-pending-badge');
    const count = cachedIncomingFriends.length;
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
    if (quickBadge) {
      if (count > 0) {
        quickBadge.textContent = count;
        quickBadge.style.display = 'inline-block';
      } else {
        quickBadge.style.display = 'none';
      }
    }

    if (currentView === 'dms' && !activeDmPeerId) {
      renderFriendsMainStage();
    }
  });

  socket.on('friend-request-received', ({ fromUser }) => {
    socket.emit('get-friends');

    // Do not show popup if user is blocked or muted
    if (fromUser && (blockedUsersSet.has(fromUser.id) || mutedUsersSet.has(fromUser.id))) {
      return;
    }

    playChime('join');
    showToast(`Friend request received from @${fromUser.username}! 🎉`, 'info');
    showDesktopNotification('Friend Request Received 🔔', `@${fromUser.username} sent you a friend request on VoxLink.`);

    // Display interactive popup dialog modal
    const modal = document.getElementById('incoming-friend-request-modal');
    const uNameEl = document.getElementById('incoming-friend-username');
    const avEl = document.getElementById('incoming-friend-avatar');
    const btnAccept = document.getElementById('btn-accept-friend-prompt');
    const btnDecline = document.getElementById('btn-decline-friend-prompt');

    if (modal && fromUser) {
      if (uNameEl) uNameEl.textContent = '@' + fromUser.username;
      if (avEl) {
        if (fromUser.avatarUrl) {
          avEl.innerHTML = `<img src="${fromUser.avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
        } else {
          avEl.textContent = fromUser.username ? fromUser.username.charAt(0).toUpperCase() : '?';
        }
      }
      if (btnAccept) {
        btnAccept.onclick = () => {
          socket.emit('accept-friend-request', { requesterId: fromUser.id });
          modal.style.display = 'none';
        };
      }
      if (btnDecline) {
        btnDecline.onclick = () => {
          socket.emit('decline-friend-request', { requesterId: fromUser.id });
          modal.style.display = 'none';
        };
      }
      modal.style.display = 'flex';
    }
  });

  socket.on('friend-request-sent', ({ username }) => {
    showToast(`Friend request sent to @${username}! 📨`, 'success');
    socket.emit('get-friends');
  });

  socket.on('friend-request-accepted', ({ friendId, username }) => {
    playChime('join');
    showToast(`You are now friends with @${username || 'User'}! 🤝`, 'success');
    showDesktopNotification('Friend Request Accepted! 🎉', `@${username || 'A friend'} accepted your friend request!`);
    socket.emit('get-friends');
    socket.emit('get-dm-threads');
  });

  socket.on('friend-removed', () => {
    socket.emit('get-friends');
    socket.emit('get-dm-threads');
  });

  socket.on('friend-request-declined', () => {
    socket.emit('get-friends');
    socket.emit('get-dm-threads');
  });

  // Direct 1-on-1 and Group DM Calling Signaling
  socket.on('incoming-dm-call', ({ caller, isGroup, groupId, groupName, callChannelId, hasVideo }) => {
    // Check if caller is blocked or muted
    if (caller && (blockedUsersSet.has(caller.id) || mutedUsersSet.has(caller.id))) {
      return;
    }
    if (caller) {
      accountsMap.set(caller.id, caller);
    }

    incomingDmCallData = { caller, isGroup, groupId, groupName, callChannelId, hasVideo };
    const modal = document.getElementById('incoming-dm-call-modal');
    const avatar = document.getElementById('incoming-call-avatar');
    const nameEl = document.getElementById('incoming-call-username');
    const typeEl = document.getElementById('incoming-call-type');

    if (avatar) {
      if (isGroup) {
        avatar.textContent = '👥';
        avatar.style.backgroundColor = '#5865F2';
      } else if (caller.avatarUrl) {
        avatar.innerHTML = `<img src="${caller.avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
      } else {
        avatar.textContent = caller.username ? caller.username.charAt(0).toUpperCase() : '?';
        avatar.style.backgroundColor = caller.color || '#5865F2';
      }
    }
    if (nameEl) nameEl.textContent = isGroup ? (groupName || 'Group Call') : caller.username;
    if (typeEl) typeEl.textContent = isGroup 
      ? (hasVideo ? `Incoming group video call from @${caller.username}...` : `Incoming group voice call from @${caller.username}...`)
      : (hasVideo ? 'Incoming video call...' : 'Incoming voice call...');
    if (modal) modal.style.display = 'flex';
    playChime('call-incoming');

    const callTitle = isGroup ? `📞 Incoming Group Call: ${groupName || 'Group'}` : `📞 Incoming Call from @${caller.username}`;
    const callBody = hasVideo ? 'Incoming video call. Click to answer!' : 'Incoming voice call. Click to answer!';
    showDesktopNotification(callTitle, callBody);
  });

  socket.on('dm-call-outgoing', async ({ targetId, isGroup, callChannelId }) => {
    playChime('call-outgoing');
    await ensureLocalMediaStream(false);
    currentVoiceChannel = callChannelId;
    updateVoiceUI();
    openCallStageView();
    showToast(isGroup ? 'Group call started! Ringing group members... 📞' : 'Calling... Waiting for friend to answer 📞', 'info');
  });

  socket.on('dm-group-call-connected', async ({ callChannelId, groupId, members }) => {
    currentVoiceChannel = callChannelId;
    updateVoiceUI();
    openCallStageView();
    showToast('Joined group call! 🎉', 'success');
    await ensureLocalMediaStream(false);
    for (const member of (members || [])) {
      await initiatePeerCall(member.id);
    }
    updateCallGridScaling();
  });

  socket.on('dm-group-created', (newGroup) => {
    const createModal = document.getElementById('create-dm-group-modal');
    if (createModal) createModal.style.display = 'none';
    closeModal('create-dm-group-modal');
    showToast(`Group "${newGroup.name}" ready! 👥`, 'success');
    showDesktopNotification('Group Chat Created 👥', `Group "${newGroup.name}" is now ready!`);

    const newThread = {
      peerId: newGroup.id,
      isGroup: true,
      username: newGroup.name,
      membersCount: newGroup.members.length,
      memberIds: newGroup.members,
      avatarUrl: newGroup.avatarUrl || null,
      color: '#5865F2',
      customStatus: `${newGroup.members.length} members`,
      isOnline: true,
      lastMessage: null
    };
    cachedDmThreads = [newThread, ...cachedDmThreads.filter(t => t.peerId !== newGroup.id)];
    if (currentView === 'dms') renderDmConversationsList();
    socket.emit('get-dm-threads');

    openDmWithUser({
      id: newGroup.id,
      isGroup: true,
      name: newGroup.name,
      username: newGroup.name,
      avatarUrl: newGroup.avatarUrl || null,
      memberIds: newGroup.members,
      membersCount: newGroup.members.length
    });
  });

  socket.on('dm-call-accepted', async ({ receiverId, receiver, callChannelId }) => {
    currentVoiceChannel = callChannelId;
    if (receiverId) activeDmPeerId = receiverId;
    if (receiver) accountsMap.set(receiver.id, receiver);
    updateVoiceUI();
    openCallStageView();
    showToast('Call connected! 🎉', 'success');
    showDesktopNotification('Call Connected 📞', 'Your direct call has connected!');
    updateCallGridScaling();
  });

  socket.on('dm-call-connected', async ({ peerId, peer, callChannelId }) => {
    currentVoiceChannel = callChannelId;
    if (peerId) activeDmPeerId = peerId;
    if (peer) accountsMap.set(peer.id, peer);
    updateVoiceUI();
    openCallStageView();
    showToast('Call connected! 🎉', 'success');
    showDesktopNotification('Call Connected 📞', 'Your call is now live.');
    updateCallGridScaling();
  });

  socket.on('dm-call-declined', ({ username }) => {
    showToast(`@${username} declined the call.`, 'warning');
    if (currentVoiceChannel && currentVoiceChannel.startsWith('dm_call_')) {
      leaveVoiceChannel(false);
    }
  });

  socket.on('dm-call-ended', () => {
    showToast('Call ended.', 'info');
    if (currentVoiceChannel && currentVoiceChannel.startsWith('dm_call_')) {
      leaveVoiceChannel(false);
    }
  });

  socket.on('dm-call-failed', ({ reason }) => {
    showToast(reason || 'Call failed.', 'error');
  });

  // P2P File Transfer Signaling
  socket.on('p2p-file-signal', async ({ senderId, senderSocketId, transferId, type, data }) => {
    handleP2PFileSignal(senderId, senderSocketId, transferId, type, data);
  });

  // WebRTC
  socket.on('voice-channel-joined', async ({ channelId, members }) => {
    currentVoiceChannel = channelId;
    updateVoiceUI();
    playChime('join');
    openCallStageView();

    for (const member of members) {
      accountsMap.set(member.id, member);
      peerMediaStates.set(member.id, {
        isVideoOn: Boolean(member.isVideoOn),
        isScreenSharing: Boolean(member.isScreenSharing),
        isMuted: Boolean(member.isMuted),
        isDeafened: Boolean(member.isDeafened)
      });
      await initiatePeerCall(member.id);
    }
    updateCallGridScaling();
  });

  socket.on('user-joined-voice', ({ user, channelId }) => {
    if (channelId === currentVoiceChannel) {
      playChime('join');
      accountsMap.set(user.id, user);
      peerMediaStates.set(user.id, {
        isVideoOn: Boolean(user.isVideoOn),
        isScreenSharing: Boolean(user.isScreenSharing),
        isMuted: Boolean(user.isMuted),
        isDeafened: Boolean(user.isDeafened)
      });
      showToast(`@${user.username} joined the call! 🎧`, 'info');
      showDesktopNotification('Call Update 🎧', `@${user.username} joined your voice call.`);
      if (isScreenSharing || isVideoOn) {
        socket.emit('media-state-change', { isVideoOn, isScreenSharing, isMuted, isDeafened });
        setTimeout(() => renegotiatePeer(user.id), 300);
      }
      updateCallGridScaling();
    }
    renderCategoriesAndChannels();
  });

  socket.on('user-left-voice', ({ userId, channelId }) => {
    closePeerConnection(userId);
    if (channelId === currentVoiceChannel) {
      playChime('leave');
      const u = accountsMap.get(userId);
      const uname = u ? u.username : 'A user';
      showToast(`@${uname} left the call.`, 'info');
      showDesktopNotification('Call Update 🎧', `@${uname} left the voice call.`);
      updateCallGridScaling();
    }
    renderCategoriesAndChannels();
  });

  socket.on('signal-offer', async ({ senderId, offer }) => {
    if (!currentVoiceChannel && incomingDmCallData && incomingDmCallData.callChannelId) {
      currentVoiceChannel = incomingDmCallData.callChannelId;
    }
    if (!currentVoiceChannel) return;
    await handlePeerOffer(senderId, offer);
  });

  socket.on('signal-answer', async ({ senderId, answer }) => {
    const pc = peerConnections.get(senderId);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await drainPendingIceCandidates(senderId);
      } catch (err) {
        console.warn('setRemoteDescription(answer) failed:', err);
      }
    }
  });

  socket.on('signal-ice', async ({ senderId, candidate }) => {
    if (candidate) {
      await addIceCandidateSafely(senderId, candidate);
    }
  });

  socket.on('peer-status-update', ({ userId, isMuted, isDeafened, isSpeaking }) => {
    updatePeerSpeakingVisual(userId, isSpeaking);
  });

  socket.on('peer-media-state', ({ userId, isVideoOn, isScreenSharing }) => {
    peerMediaStates.set(userId, { isVideoOn, isScreenSharing });
    if (!isScreenSharing) {
      const oldScreen = remoteScreenStreams.get(userId);
      if (oldScreen) {
        try { oldScreen.getTracks().forEach(t => t.stop()); } catch (e) {}
      }
      remoteScreenStreams.delete(userId);
    }
    renderCategoriesAndChannels();
    updateCallGridScaling();
  });

  socket.on('google-linked-success', ({ googleEmail, avatarUrl }) => {
    showToast(`Google account (${googleEmail}) successfully linked!`, 'success');
    if (currentUser) {
      currentUser.googleEmail = googleEmail;
      if (avatarUrl && !currentUser.avatarUrl) currentUser.avatarUrl = avatarUrl;
      updateSelfProfileUI();
    }
    const googleStatus = document.getElementById('settings-google-status');
    const googleBtn = document.getElementById('btn-link-google');
    if (googleStatus) googleStatus.textContent = `Linked: ${googleEmail}`;
    if (googleBtn) {
      googleBtn.textContent = 'Linked ✓';
      googleBtn.disabled = true;
    }
  });
}

function getCurrentServer() {
  return serversMap.get(currentServerId);
}

function hasPermission(serverObj, userId, perm) {
  if (!serverObj || !userId) return false;
  if (serverObj.ownerId === userId) return true;
  const userRoles = (serverObj.memberRoles && serverObj.memberRoles[userId]) || ['role-member-' + serverObj.id];
  for (const rId of userRoles) {
    const role = (serverObj.roles || []).find(r => r.id === rId);
    if (!role || !role.permissions) continue;
    if (role.permissions.includes('ALL') || role.permissions.includes(perm)) return true;
  }
  return false;
}

// Compact Tags Generator
function renderGlobalBadgesHTML(badges) {
  if (!badges || badges.length === 0) return '';
  let html = '';
  if (badges.includes('PROJECT_OWNER') || badges.includes('CREATOR')) {
    html += '<span class="badge-creator">👑 Creator</span> ';
  }
  if (badges.includes('DEVELOPER')) {
    html += '<span class="badge-platform-dev">🛠️ Dev</span> ';
  }
  return html;
}

function updateSelfProfileUI() {
  selfUsername.textContent = currentUser.username;
  selfStatusLabel.textContent = currentUser.customStatus || 'Online';
  // Keep bottom user bar clean and uncluttered: only username, no badge crowding the mic/audio controls
  if (selfGlobalBadge) selfGlobalBadge.innerHTML = '';

  if (currentUser.avatarUrl) {
    selfAvatar.style.backgroundImage = `url("${currentUser.avatarUrl}")`;
    selfAvatar.style.backgroundColor = 'transparent';
    selfAvatar.textContent = '';
  } else {
    selfAvatar.style.backgroundImage = 'none';
    selfAvatar.textContent = (currentUser.username || 'U').substring(0, 2).toUpperCase();
    selfAvatar.style.backgroundColor = currentUser.color || '#5865F2';
  }
}

// =========================================
// 2. SERVER BANNER & SERVER RAIL
// =========================================
function renderServerBanner() {
  const srv = getCurrentServer();
  if (srv && srv.bannerUrl) {
    serverBannerImg.style.backgroundImage = `url(${srv.bannerUrl})`;
    serverBannerContainer.style.display = 'block';
  } else {
    serverBannerContainer.style.display = 'none';
  }
}

function renderServerRail() {
  serverRailList.innerHTML = '';
  serversMap.forEach(srv => {
    const iconDiv = document.createElement('div');
    const isActive = currentView === 'server' && currentServerId === srv.id;
    iconDiv.className = `server-icon ${isActive ? 'active' : ''}`;
    iconDiv.title = srv.name + (srv.isOfficial ? ' (Official Server)' : '');

    if (srv.iconUrl) {
      iconDiv.style.backgroundImage = `url(${srv.iconUrl})`;
      iconDiv.textContent = '';
    } else {
      iconDiv.style.backgroundImage = 'none';
      iconDiv.textContent = srv.icon || srv.name.substring(0, 2).toUpperCase();
    }

    if (srv.isOfficial) {
      const dot = document.createElement('div');
      dot.className = 'official-dot';
      dot.title = 'Official Verified Server';
      dot.textContent = '✓';
      iconDiv.appendChild(dot);
    }

    iconDiv.onclick = () => switchServer(srv.id);
    serverRailList.appendChild(iconDiv);
  });
}

function switchServer(srvId) {
  currentView = 'server';
  currentServerId = srvId;
  navDms.classList.remove('active');
  const quickNavBtn = document.getElementById('btn-quick-nav-dms');
  if (quickNavBtn) quickNavBtn.classList.remove('active');

  const srv = getCurrentServer();
  sidebarTitle.textContent = srv ? srv.name : 'VoxLink';

  const officialBadgeEl = document.getElementById('server-official-badge');
  if (officialBadgeEl) {
    officialBadgeEl.style.display = (srv && srv.isOfficial) ? 'inline-flex' : 'none';
  }

  const serverHeaderArrow = document.querySelector('.server-header-arrow');
  if (serverHeaderArrow) serverHeaderArrow.style.display = 'block';

  renderServerBanner();
  serverChannelsView.style.display = 'block';
  dmsView.style.display = 'none';

  renderServerRail();
  renderCategoriesAndChannels();
  renderMembers();

  if (srv && srv.categories) {
    for (const cat of srv.categories) {
      const textCh = cat.channels.find(c => c.type === 'text');
      if (textCh) { selectTextChannel(textCh); break; }
    }
  }
}

window.openJoinServerModalDirect = function() {
  closeMobileDrawer();
  document.getElementById('tab-btn-create-server').classList.remove('active');
  document.getElementById('tab-btn-join-server').classList.add('active');
  document.getElementById('create-server-form').style.display = 'none';
  document.getElementById('join-server-form').style.display = 'block';
  document.getElementById('server-modal-title').textContent = 'Join a Server';
  document.getElementById('create-server-modal').style.display = 'flex';
};

window.openCreateServerModalDirect = function() {
  closeMobileDrawer();
  document.getElementById('tab-btn-create-server').classList.add('active');
  document.getElementById('tab-btn-join-server').classList.remove('active');
  document.getElementById('create-server-form').style.display = 'block';
  document.getElementById('join-server-form').style.display = 'none';
  document.getElementById('server-modal-title').textContent = 'Create Your Server';
  document.getElementById('create-server-modal').style.display = 'flex';
};

const btnTopAddServer = document.getElementById('btn-top-add-server');
if (btnTopAddServer) {
  btnTopAddServer.addEventListener('click', () => {
    window.openJoinServerModalDirect();
  });
}

btnAddServer.addEventListener('click', () => {
  closeMobileDrawer();
  document.getElementById('tab-btn-create-server').classList.add('active');
  document.getElementById('tab-btn-join-server').classList.remove('active');
  document.getElementById('create-server-form').style.display = 'block';
  document.getElementById('join-server-form').style.display = 'none';
  document.getElementById('server-modal-title').textContent = 'Add a Server';
  document.getElementById('create-server-modal').style.display = 'flex';
});

document.getElementById('tab-btn-create-server').addEventListener('click', () => {
  document.getElementById('tab-btn-create-server').classList.add('active');
  document.getElementById('tab-btn-join-server').classList.remove('active');
  document.getElementById('create-server-form').style.display = 'block';
  document.getElementById('join-server-form').style.display = 'none';
  document.getElementById('server-modal-title').textContent = 'Create Your Server';
});

document.getElementById('tab-btn-join-server').addEventListener('click', () => {
  document.getElementById('tab-btn-join-server').classList.add('active');
  document.getElementById('tab-btn-create-server').classList.remove('active');
  document.getElementById('create-server-form').style.display = 'none';
  document.getElementById('join-server-form').style.display = 'block';
  document.getElementById('server-modal-title').textContent = 'Join a Server';
});

document.getElementById('create-server-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('new-server-name').value.trim();
  const icon = document.getElementById('new-server-icon').value.trim();
  if (!name) return;

  socket.emit('create-server', { name, icon });
  closeModal('create-server-modal');
  document.getElementById('new-server-name').value = '';
  document.getElementById('new-server-icon').value = '';
});

document.getElementById('join-server-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = document.getElementById('join-server-code-input').value.trim();
  if (!code) return;
  socket.emit('join-server-code', { code });
  closeModal('create-server-modal');
  document.getElementById('join-server-code-input').value = '';
});

navDms.addEventListener('click', () => {
  currentView = 'dms';
  navDms.classList.add('active');
  const quickNavBtn = document.getElementById('btn-quick-nav-dms');
  if (quickNavBtn) quickNavBtn.classList.add('active');
  renderServerRail();
  sidebarTitle.textContent = 'Direct Messages';

  const officialBadgeEl = document.getElementById('server-official-badge');
  if (officialBadgeEl) officialBadgeEl.style.display = 'none';

  const serverHeaderArrow = document.querySelector('.server-header-arrow');
  if (serverHeaderArrow) serverHeaderArrow.style.display = 'none';

  serverBannerContainer.style.display = 'none';
  serverChannelsView.style.display = 'none';
  dmsView.style.display = 'block';

  if (window.innerWidth <= 850 && typeof closeMembersSidebar === 'function') closeMembersSidebar();

  // If opening DMs fresh, show friends stage instead of previous server channel
  activeDmPeerId = null;
  renderFriendsMainStage('online');
  renderDmConversations();
});

// Quick Direct Messages & Friends Sidebar button
const btnQuickNavDms = document.getElementById('btn-quick-nav-dms');
if (btnQuickNavDms) {
  btnQuickNavDms.addEventListener('click', () => {
    if (navDms) navDms.click();
  });
}

// Global Quick-Switch to DMs (Ctrl+K or Cmd+K)
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (navDms) navDms.click();
    setTimeout(() => {
      const inp = document.getElementById('find-dm-input');
      if (inp) inp.focus();
    }, 50);
  }
});

let currentFriendsTab = 'online';
let friendsSearchFilterText = '';
let dmConversationsSearchText = '';

const dmTabFriendsBtn = document.getElementById('dm-tab-friends');
if (dmTabFriendsBtn) {
  dmTabFriendsBtn.addEventListener('click', () => {
    activeDmPeerId = null;
    renderFriendsMainStage(currentFriendsTab);
    renderDmConversationsList();
    closeMobileDrawer();
  });
}

const findDmInputEl = document.getElementById('find-dm-input');
if (findDmInputEl) {
  findDmInputEl.addEventListener('input', (e) => {
    dmConversationsSearchText = (e.target.value || '').trim().toLowerCase();
    renderDmConversationsList();
  });
}

const friendsMobileMenuToggle = document.getElementById('friends-mobile-menu-toggle');
if (friendsMobileMenuToggle) {
  friendsMobileMenuToggle.addEventListener('click', openMobileDrawer);
}

function renderDmConversations() {
  socket.emit('get-dm-threads');
  socket.emit('get-friends');

  if (!activeDmPeerId) {
    renderFriendsMainStage(currentFriendsTab);
  }
}

function renderDmConversationsList() {
  const container = document.getElementById('dm-conversations-list');
  if (!container) return;
  container.innerHTML = '';

  let list = (cachedDmThreads || []).slice();
  if (dmConversationsSearchText) {
    const q = dmConversationsSearchText.toLowerCase();
    list = list.filter(t => (t.username || '').toLowerCase().includes(q));

    // Also match known users from accountsMap who don't have an active thread yet
    const existingPeerIds = new Set(list.map(t => t.peerId));
    accountsMap.forEach((acc, id) => {
      if (currentUser && id === currentUser.id) return;
      if (!existingPeerIds.has(id) && (acc.username || '').toLowerCase().includes(q)) {
        list.push({
          peerId: acc.id,
          username: acc.username,
          avatarUrl: acc.avatarUrl,
          color: acc.color,
          isOnline: liveUserIds.has(acc.id),
          isGroup: false,
          customStatus: acc.customStatus,
          lastMessage: null
        });
      }
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="padding: 16px 12px; color: var(--text-muted); font-size: 13px; text-align: center; line-height: 1.4;">
        ${dmConversationsSearchText ? 'No conversations found.' : 'No conversations yet.<br>Click <b>+</b> above to start a chat!'}
      </div>
    `;
    return;
  }

  list.forEach(thread => {
    const item = document.createElement('div');
    const isActive = activeDmPeerId === thread.peerId;
    item.className = 'dm-conversation-item' + (isActive ? ' active' : '');

    const avatar = document.createElement('div');
    avatar.className = 'dm-item-avatar';
    avatar.style.backgroundColor = thread.color || '#5865F2';

    if (thread.avatarUrl) {
      avatar.innerHTML = `<img src="${resolveMediaUrl(thread.avatarUrl)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else if (thread.isGroup) {
      avatar.innerHTML = `<span style="font-size: 16px;">👥</span>`;
    } else {
      avatar.textContent = thread.username ? thread.username.charAt(0).toUpperCase() : '?';
    }

    if (!thread.isGroup) {
      const dot = document.createElement('div');
      dot.className = `status-dot ${thread.isOnline ? 'online' : 'offline'}`;
      dot.style.position = 'absolute';
      dot.style.bottom = '-2px';
      dot.style.right = '-2px';
      avatar.appendChild(dot);
    }

    const info = document.createElement('div');
    info.className = 'dm-item-info';

    const nameRow = document.createElement('div');
    nameRow.className = 'dm-item-name';
    nameRow.textContent = thread.username;

    const preview = document.createElement('div');
    preview.className = 'dm-item-sub';
    preview.textContent = thread.lastMessage ? (thread.lastMessage.text || 'Attachment') : (thread.customStatus || (thread.isGroup ? `${thread.membersCount || 2} members` : (thread.isOnline ? 'Online' : 'Offline')));

    info.appendChild(nameRow);
    info.appendChild(preview);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dm-close-thread-btn';
    closeBtn.title = 'Close DM';
    closeBtn.innerHTML = '✕';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      cachedDmThreads = cachedDmThreads.filter(t => t.peerId !== thread.peerId);
      if (activeDmPeerId === thread.peerId) {
        renderFriendsMainStage('online');
      }
      renderDmConversationsList();
    };

    item.appendChild(avatar);
    item.appendChild(info);
    item.appendChild(closeBtn);

    item.onclick = () => {
      openDmWithUser(thread);
    };

    container.appendChild(item);
  });
}

function renderDmWelcomeBox(user, isGroup) {
  const welcomeBox = document.getElementById('messages-welcome-box');
  if (!welcomeBox || !user) return;
  const username = user.username || user.name || (isGroup ? 'Group DM' : 'Friend');
  const peerId = user.id || user.peerId;
  const isFriend = cachedFriends.some(f => f.id === peerId);

  const avatarSrc = user.avatarUrl ? resolveMediaUrl(user.avatarUrl) : null;
  const bannerSrc = (isGroup && user.bannerUrl) ? resolveMediaUrl(user.bannerUrl) : null;

  welcomeBox.innerHTML = `
    <div class="dm-welcome-stage">
      ${bannerSrc ? `<div class="dm-welcome-banner" style="background-image: url('${bannerSrc}');"></div>` : ''}
      <div class="dm-welcome-avatar" style="background-color: ${user.color || '#5865F2'};">
        ${avatarSrc ? `<img src="${avatarSrc}" alt="${escapeHTML(username)}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : (isGroup ? '👥' : (username ? username.charAt(0).toUpperCase() : '?'))}
        ${!isGroup ? `<div class="status-dot ${user.isOnline ? 'online' : 'offline'}"></div>` : ''}
      </div>
      <div class="dm-welcome-title">${isGroup ? escapeHTML(username) : '@' + escapeHTML(username)}</div>
      <div class="dm-welcome-sub">
        ${isGroup 
          ? `Welcome to the beginning of the <b>${escapeHTML(username)}</b> group DM.` 
          : `This is the start of your direct message history with <b>@${escapeHTML(username)}</b>.`}
      </div>
      ${isGroup && user.description ? `<div class="dm-welcome-desc">${escapeHTML(user.description)}</div>` : ''}
      ${!isGroup ? `
        <div class="dm-welcome-actions">
          ${isFriend ? `
            <button type="button" class="dm-welcome-btn remove-friend" onclick="removeFriendById('${peerId}', '${escapeHTML(username)}')">Remove Friend</button>
          ` : `
            <button type="button" class="dm-welcome-btn add-friend" onclick="socket.emit('send-friend-request', { username: '${escapeHTML(username)}' })">Add Friend</button>
          `}
          <button type="button" class="dm-welcome-btn block-user" onclick="toggleBlockUser('${peerId}', '${escapeHTML(username)}')">Block</button>
        </div>
      ` : ''}
    </div>
  `;
  welcomeBox.style.display = 'block';
}

function openDmWithUser(user) {
  if (!user || (!user.id && !user.peerId)) return;
  const peerId = user.id || user.peerId;
  user.id = peerId;
  user.peerId = peerId;
  const isGroup = Boolean(user.isGroup || (peerId && String(peerId).startsWith('grp_')));
  if (isGroup) {
    if (!currentDmGroupMeta || currentDmGroupMeta.id !== peerId) {
      currentDmGroupMeta = { id: peerId, peerId: peerId, name: user.username || user.name || '', avatarUrl: user.avatarUrl || null, bannerUrl: user.bannerUrl || null, description: user.description || '', members: user.memberIds || [] };
    } else {
      if (user.username || user.name) currentDmGroupMeta.name = user.username || user.name;
      if (user.avatarUrl !== undefined) currentDmGroupMeta.avatarUrl = user.avatarUrl;
      if (user.bannerUrl !== undefined) currentDmGroupMeta.bannerUrl = user.bannerUrl;
      if (user.description !== undefined) currentDmGroupMeta.description = user.description;
      if (user.memberIds) currentDmGroupMeta.members = user.memberIds;
    }
  }
  const username = user.username || user.name || (isGroup ? 'Group DM' : 'Friend');

  currentView = 'dms';
  activeDmPeerId = peerId;
  navDms.classList.add('active');
  renderServerRail();
  sidebarTitle.textContent = 'Direct Messages';

  const officialBadgeEl = document.getElementById('server-official-badge');
  if (officialBadgeEl) officialBadgeEl.style.display = 'none';

  serverBannerContainer.style.display = 'none';
  serverChannelsView.style.display = 'none';
  dmsView.style.display = 'block';

  // Toggle stage views: Hide Friends stage, Show Chat stage
  const friendsStage = document.getElementById('friends-main-stage');
  const chatHdr = document.getElementById('chat-header');
  const msgContainer = document.getElementById('messages-container');
  const inputWrap = document.querySelector('.chat-input-wrapper');

  if (friendsStage) friendsStage.style.display = 'none';
  if (chatHdr) chatHdr.style.display = 'flex';
  if (msgContainer) msgContainer.style.display = 'flex';
  if (inputWrap) inputWrap.style.display = 'block';

  const dmTabFriends = document.getElementById('dm-tab-friends');
  if (dmTabFriends) dmTabFriends.classList.remove('active');

  // Close mobile navigation drawer so chat is visible on phones
  closeMobileDrawer();

  // Update Chat Header
  if (isGroup) {
    if (user.avatarUrl) {
      activeHeaderIcon.innerHTML = `<img src="${resolveMediaUrl(user.avatarUrl)}" style="width: 22px; height: 22px; border-radius: 50%; object-fit: cover;">`;
    } else {
      activeHeaderIcon.textContent = '👥';
    }
  } else {
    activeHeaderIcon.textContent = '@';
  }
  activeChannelNameEl.textContent = username;
  activeChannelTopicEl.textContent = isGroup 
    ? (user.description ? `${user.description} • ${user.membersCount || (user.memberIds ? user.memberIds.length : 'Multiple')} members` : `${user.membersCount || (user.memberIds ? user.memberIds.length : 'Multiple')} members in this group chat`)
    : (user.customStatus ? user.customStatus : (user.isOnline ? 'Online' : 'Offline'));

  const serverHeaderArrow = document.querySelector('.server-header-arrow');
  if (serverHeaderArrow) serverHeaderArrow.style.display = 'none';

  // Header Call & Group actions
  const callVoiceBtn = document.getElementById('dm-start-voice-btn');
  const callVideoBtn = document.getElementById('dm-start-video-btn');
  const callScreenBtn = document.getElementById('dm-start-screen-btn');
  const addFriendsBtn = document.getElementById('dm-add-friends-btn');
  const groupSettingsBtn = document.getElementById('dm-group-settings-btn');
  const clearChatBtn = document.getElementById('dm-clear-chat-btn');
  const threadsBtn = document.getElementById('toggle-threads-btn');
  const pinsBtn = document.getElementById('toggle-pins-btn');
  const membersBtn = document.getElementById('toggle-members-btn');

  if (callVoiceBtn) callVoiceBtn.style.display = 'inline-flex';
  if (callVideoBtn) callVideoBtn.style.display = 'inline-flex';
  const isMobileClient = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.innerWidth <= 768 && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
  if (callScreenBtn) callScreenBtn.style.display = isMobileClient ? 'none' : 'inline-flex';
  if (addFriendsBtn) {
    addFriendsBtn.style.display = 'inline-flex';
    addFriendsBtn.title = isGroup ? 'Add Members to Group' : 'Add Friends to DM';
    addFriendsBtn.onclick = () => openAddFriendsToDmModal(peerId, username);
  }
  if (groupSettingsBtn) {
    groupSettingsBtn.style.display = isGroup ? 'inline-flex' : 'none';
    groupSettingsBtn.onclick = () => openGroupSettingsModal(user);
  }
  if (clearChatBtn) {
    clearChatBtn.style.display = 'inline-flex';
    clearChatBtn.title = isGroup ? 'Clear Group Messages' : 'Delete Entire Conversation';
    clearChatBtn.onclick = () => clearActiveDmConversation();
  }
  if (pinsBtn) pinsBtn.style.display = 'inline-flex';
  if (threadsBtn) threadsBtn.style.display = 'none';
  if (membersBtn) membersBtn.style.display = 'inline-flex';

  const slowmode = document.getElementById('channel-slowmode-indicator');
  if (slowmode) slowmode.style.display = 'none';

  // Chat input
  chatInput.placeholder = isGroup ? `Message ${username}` : `Message @${username}`;
  chatInput.disabled = false;

  // Render initial sidebar state for DMs
  if (isGroup) {
    currentDmGroupMeta = user;
    renderDmGroupSidebar(user, user.members || []);
  } else {
    currentDmPeerMeta = user;
    renderDmUserProfileSidebar(user);
  }

  // Render Discord DM Signature Welcome Banner
  renderDmWelcomeBox(user, isGroup);

  // Clear messages and fetch history
  messagesList.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);">Loading conversation...</div>';
  socket.emit('get-dm-history', { targetId: peerId, isGroup });

  renderDmConversationsList();
}

let currentDmPeerMeta = null;
let currentDmGroupMeta = null;
let currentDmGroupMembers = [];
let currentGroupModalContext = null;

function renderDmUserProfileSidebar(user) {
  if (!user) return;
  currentDmPeerMeta = user;
  const titleEl = document.querySelector('.members-sidebar-title');
  if (titleEl) titleEl.textContent = 'User Profile';

  const mb = document.getElementById('members-sidebar');
  if (mb && window.innerWidth > 850) {
    mb.classList.remove('collapsed');
  }

  const isOnline = Boolean(user.isOnline || (user.id && liveUserIds.has(user.id)));
  const bannerStyle = user.bannerUrl 
    ? `background-image: url('${resolveMediaUrl(user.bannerUrl)}'); background-size: cover; background-position: center;`
    : (user.bannerColor ? `background-color: ${user.bannerColor};` : (user.color ? `background-color: ${user.color};` : 'background-color: var(--brand-accent);'));

  const badges = user.globalBadges || user.badges || [];
  const badgesHTML = renderGlobalBadgesHTML(badges);

  membersList.innerHTML = `
    <div class="dm-profile-sidebar-card">
      <div class="dm-profile-sidebar-banner" style="${bannerStyle}"></div>
      <div class="dm-profile-sidebar-avatar-wrap">
        <div class="dm-profile-sidebar-avatar" style="background-color: ${user.color || '#5865F2'};">
          ${user.avatarUrl ? `<img src="${resolveMediaUrl(user.avatarUrl)}" alt="${escapeHTML(user.username || 'User')}">` : (user.username ? user.username.charAt(0).toUpperCase() : '?')}
          <div class="status-dot ${isOnline ? 'online' : 'offline'}"></div>
        </div>
      </div>
      <div class="dm-profile-sidebar-info">
        <div class="dm-profile-sidebar-name">@${escapeHTML(user.username || 'User')}</div>
        ${badgesHTML ? `<div class="dm-profile-sidebar-badges">${badgesHTML}</div>` : ''}
        <div class="dm-profile-sidebar-status">${escapeHTML(user.customStatus || (isOnline ? 'Active Now' : 'Offline'))}</div>
      </div>
      <div class="dm-profile-sidebar-divider"></div>
      <div class="dm-profile-sidebar-section">
        <div class="dm-profile-sidebar-label">About Me</div>
        <div class="dm-profile-sidebar-bio">${user.bio ? escapeHTML(user.bio) : '<span style="color: var(--text-muted); font-style: italic;">No bio set yet.</span>'}</div>
      </div>
      <div class="dm-profile-sidebar-divider"></div>
      <div class="dm-profile-sidebar-actions">
        <button type="button" class="dm-profile-action-btn primary" onclick="start1on1DmCall('${user.id}', false)">
          <span>📞</span> Start Voice Call
        </button>
        <button type="button" class="dm-profile-action-btn secondary" onclick="start1on1DmCall('${user.id}', true)">
          <span>🎥</span> Start Video Call
        </button>
        <button type="button" class="dm-profile-action-btn secondary" onclick="openAddFriendsToDmModal('${user.id}', '${escapeHTML(user.username || 'User')}')">
          <span>👥+</span> Create Group with @${escapeHTML(user.username || 'User')}
        </button>
      </div>
    </div>
  `;
}

function renderDmGroupSidebar(group, members = []) {
  if (!group) return;
  currentDmGroupMeta = group;
  currentDmGroupMembers = members || [];

  const titleEl = document.querySelector('.members-sidebar-title');
  if (titleEl) titleEl.textContent = `Group Members (${currentDmGroupMembers.length})`;

  const mb = document.getElementById('members-sidebar');
  if (mb && window.innerWidth > 850) {
    mb.classList.remove('collapsed');
  }

  const groupBannerStyle = group.bannerUrl
    ? `background-image: url('${resolveMediaUrl(group.bannerUrl)}'); background-size: cover; background-position: center; height: 80px;`
    : `background: linear-gradient(135deg, var(--brand-blurple), #23a55a); height: 55px;`;

  let rosterHTML = '';
  currentDmGroupMembers.forEach(m => {
    const isOnline = Boolean(m.isOnline || (m.id && liveUserIds.has(m.id)));
    const isOwner = group.ownerId === m.id;
    const isSelf = currentUser && currentUser.id === m.id;
    const canKick = currentUser && currentUser.id === group.ownerId && !isSelf;
    rosterHTML += `
      <div class="dm-group-member-item" onclick="openUserProfileCard({ id: '${m.id}', username: '${escapeHTML(m.username)}' })" title="View Profile" style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
          <div class="member-avatar" style="background-color: ${m.color || '#5865F2'}; position: relative; flex-shrink: 0;">
            ${m.avatarUrl ? `<img src="${resolveMediaUrl(m.avatarUrl)}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : (m.username ? m.username.charAt(0).toUpperCase() : '?')}
            <div class="status-dot ${isOnline ? 'online' : 'offline'}"></div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
            <span style="font-weight: 600; font-size: 13.5px; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHTML(m.username)}
            </span>
            ${isOwner ? '<span title="Group Creator" style="font-size: 12px; margin-left: 2px;">👑</span>' : ''}
          </div>
        </div>
        ${canKick ? `
          <button type="button" class="dm-group-kick-btn" title="Kick from Group" onclick="event.stopPropagation(); kickGroupMember('${group.id}', '${m.id}', '${escapeHTML(m.username)}')">
            ✕
          </button>
        ` : ''}
      </div>
    `;
  });

  membersList.innerHTML = `
    <div style="margin: 12px 14px 6px; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08);">
      <div style="${groupBannerStyle}"></div>
      <div style="padding: 10px 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: ${group.color || '#5865F2'}; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff; overflow: hidden; flex-shrink: 0; margin-top: -24px; border: 2.5px solid var(--bg-secondary);">
            ${group.avatarUrl ? `<img src="${resolveMediaUrl(group.avatarUrl)}" style="width: 100%; height: 100%; object-fit: cover;">` : '👥'}
          </div>
          <div style="font-weight: 700; font-size: 14.5px; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(group.name || 'Group DM')}</div>
        </div>
        ${group.description ? `<div style="margin-top: 8px; font-size: 12.5px; color: var(--text-muted); line-height: 1.4; white-space: pre-wrap; word-break: break-word;">${escapeHTML(group.description)}</div>` : ''}
      </div>
    </div>
    <div style="padding: 6px 14px 6px;">
      <div style="display: flex; gap: 8px;">
        <button type="button" class="dm-profile-action-btn primary" style="flex: 1; justify-content: center;" onclick="openAddFriendsToDmModal('${group.id}', '${escapeHTML(group.name)}')">
          <span style="font-size: 15px;">👥+</span> Add Members
        </button>
        <button type="button" class="dm-profile-action-btn secondary" style="flex: 0 0 42px; justify-content: center;" title="Group Settings" onclick="openGroupSettingsModal()">
          <span>⚙️</span>
        </button>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button type="button" class="dm-profile-action-btn secondary" style="flex: 1; justify-content: center;" onclick="startGroupDmCall('${group.id}', false)">
          <span>📞</span> Call
        </button>
        <button type="button" class="dm-profile-action-btn secondary" style="flex: 1; justify-content: center;" onclick="startGroupDmCall('${group.id}', true)">
          <span>🎥</span> Video
        </button>
      </div>
    </div>
    <div class="dm-profile-sidebar-divider" style="margin: 10px 14px;"></div>
    <div class="member-role-group-header" style="padding: 4px 14px 8px;">MEMBERS — ${currentDmGroupMembers.length}</div>
    <div class="dm-group-members-roster">
      ${rosterHTML || '<div style="padding: 10px 14px; font-size: 12px; color: var(--text-muted);">No members found.</div>'}
    </div>
  `;
}

let tempGroupAvatarData = null;
let tempGroupBannerData = null;

function openGroupSettingsModal(group = null) {
  const gId = (group && (group.id || group.peerId)) || (currentDmGroupMeta && currentDmGroupMeta.id) || activeDmPeerId;
  if (!gId) return;

  if (!group) {
    group = currentDmGroupMeta || (cachedDmThreads || []).find(t => t.peerId === gId || t.id === gId) || { id: gId, peerId: gId };
  }
  group.id = gId;
  group.peerId = gId;
  currentDmGroupMeta = group;

  const modal = document.getElementById('dm-group-settings-modal');
  const nameInp = document.getElementById('edit-group-name-input');
  const descInp = document.getElementById('edit-group-desc-input');
  const avatarPreview = document.getElementById('group-avatar-preview');
  const bannerPreview = document.getElementById('group-banner-preview');
  const membersListEl = document.getElementById('group-settings-members-list');
  const deleteBtn = document.getElementById('btn-delete-group');
  const leaveBtn = document.getElementById('btn-leave-group');
  const saveBtn = document.getElementById('btn-save-group-settings');
  const fileInput = document.getElementById('group-avatar-file-input');
  const bannerFileInput = document.getElementById('group-banner-file-input');

  tempGroupAvatarData = null;
  tempGroupBannerData = null;
  if (fileInput) fileInput.value = '';
  if (bannerFileInput) bannerFileInput.value = '';

  const foundThread = (cachedDmThreads || []).find(t => t.peerId === gId || t.id === gId);
  const curName = (group && (group.name || group.username)) || (foundThread && foundThread.username) || (currentDmGroupMeta && currentDmGroupMeta.name) || '';
  const curDesc = (group && group.description) || (foundThread && foundThread.description) || (currentDmGroupMeta && currentDmGroupMeta.description) || '';
  const curAvatar = (group && group.avatarUrl) || (foundThread && foundThread.avatarUrl) || (currentDmGroupMeta && currentDmGroupMeta.avatarUrl) || null;
  const curBanner = (group && group.bannerUrl) || (foundThread && foundThread.bannerUrl) || (currentDmGroupMeta && currentDmGroupMeta.bannerUrl) || null;

  if (nameInp) nameInp.value = curName;
  if (descInp) descInp.value = curDesc;
  if (avatarPreview) {
    if (curAvatar) {
      avatarPreview.style.backgroundImage = `url(${resolveMediaUrl(curAvatar)})`;
      avatarPreview.textContent = '';
    } else {
      avatarPreview.style.backgroundImage = 'none';
      avatarPreview.textContent = '👥';
    }
  }
  if (bannerPreview) {
    if (curBanner) {
      bannerPreview.style.backgroundImage = `url(${resolveMediaUrl(curBanner)})`;
    } else {
      bannerPreview.style.backgroundImage = 'linear-gradient(135deg, var(--brand-blurple), #23a55a)';
    }
  }

  const isOwner = currentUser && group.ownerId === currentUser.id;
  if (deleteBtn) deleteBtn.style.display = isOwner ? 'inline-block' : 'none';
  if (leaveBtn) leaveBtn.style.display = isOwner ? 'none' : 'inline-block';

  // Render members in group settings
  if (membersListEl) {
    let html = '';
    currentDmGroupMembers.forEach(m => {
      const isMemOwner = group.ownerId === m.id;
      const canKick = isOwner && m.id !== currentUser.id;
      html += `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 6px; background: rgba(0,0,0,0.2);">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 28px; height: 28px; border-radius: 50%; background: ${m.color || '#5865F2'}; overflow: hidden; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #fff;">
              ${m.avatarUrl ? `<img src="${resolveMediaUrl(m.avatarUrl)}" style="width: 100%; height: 100%; object-fit: cover;">` : (m.username ? m.username.charAt(0).toUpperCase() : '?')}
            </div>
            <span style="font-size: 13.5px; font-weight: 500; color: var(--text-normal);">${escapeHTML(m.username)}</span>
            ${isMemOwner ? '<span title="Group Creator" style="font-size: 11px;">👑</span>' : ''}
          </div>
          ${canKick ? `<button type="button" class="btn-cancel" style="padding: 2px 8px; font-size: 11.5px; color: #ed4245; border-color: rgba(237,66,69,0.3);" onclick="kickGroupMember('${group.id}', '${m.id}', '${escapeHTML(m.username)}')">Kick</button>` : ''}
        </div>
      `;
    });
    membersListEl.innerHTML = html || '<div style="color: var(--text-muted); font-size: 12px;">No members.</div>';
  }

  if (modal) modal.style.display = 'flex';

  if (fileInput) {
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        showToast('Image size exceeds 8MB limit.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        tempGroupAvatarData = evt.target.result;
        if (avatarPreview) {
          avatarPreview.style.backgroundImage = `url(${tempGroupAvatarData})`;
          avatarPreview.textContent = '';
        }
      };
      reader.readAsDataURL(file);
    };
  }

  if (bannerFileInput) {
    bannerFileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        showToast('Banner size exceeds 8MB limit.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        tempGroupBannerData = evt.target.result;
        if (bannerPreview) {
          bannerPreview.style.backgroundImage = `url(${tempGroupBannerData})`;
        }
      };
      reader.readAsDataURL(file);
    };
  }

  if (saveBtn) {
    saveBtn.onclick = () => {
      const newName = nameInp ? nameInp.value.trim() : '';
      const newDesc = descInp ? descInp.value.trim() : '';
      const targetGroupId = group.id || group.peerId || gId;
      socket.emit('update-dm-group', {
        groupId: targetGroupId,
        name: newName,
        description: newDesc,
        avatarData: tempGroupAvatarData,
        bannerData: tempGroupBannerData
      });

      // Immediate optimistic update of UI
      if (newName) {
        if (group) group.name = newName;
        if (currentDmGroupMeta) currentDmGroupMeta.name = newName;
      }
      if (newDesc !== undefined) {
        if (group) group.description = newDesc;
        if (currentDmGroupMeta) currentDmGroupMeta.description = newDesc;
      }
      if (tempGroupAvatarData) {
        if (group) group.avatarUrl = tempGroupAvatarData;
        if (currentDmGroupMeta) currentDmGroupMeta.avatarUrl = tempGroupAvatarData;
      }
      if (tempGroupBannerData) {
        if (group) group.bannerUrl = tempGroupBannerData;
        if (currentDmGroupMeta) currentDmGroupMeta.bannerUrl = tempGroupBannerData;
      }
      let th = (cachedDmThreads || []).find(t => t.peerId === targetGroupId || t.id === targetGroupId);
      if (th) {
        if (newName) th.username = newName;
        if (newDesc !== undefined) th.description = newDesc;
        if (tempGroupAvatarData) th.avatarUrl = tempGroupAvatarData;
        if (tempGroupBannerData) th.bannerUrl = tempGroupBannerData;
      } else {
        if (!cachedDmThreads) cachedDmThreads = [];
        th = {
          id: targetGroupId,
          peerId: targetGroupId,
          isGroup: true,
          username: newName || (group ? group.name : 'Group DM'),
          avatarUrl: tempGroupAvatarData || (group ? group.avatarUrl : null),
          bannerUrl: tempGroupBannerData || (group ? group.bannerUrl : null),
          description: newDesc || (group ? group.description : ''),
          memberIds: group && group.members ? group.members : [],
          membersCount: group && group.members ? group.members.length : 2,
          customStatus: `${group && group.members ? group.members.length : 2} members`,
          color: '#5865F2',
          isOnline: true
        };
        cachedDmThreads.unshift(th);
      }
      if (currentView === 'dms') {
        renderDmConversationsList();
        if (activeDmPeerId === targetGroupId) {
          if (newName) activeChannelNameEl.textContent = newName;
          activeChannelTopicEl.textContent = (newDesc || (group && group.description))
            ? `${newDesc || group.description} • ${(group && group.members ? group.members.length : 2)} members`
            : `${(group && group.members ? group.members.length : 2)} members in this group chat`;
          if (activeHeaderIcon) {
            const dispAvatar = tempGroupAvatarData || (group && group.avatarUrl) || (th && th.avatarUrl);
            if (dispAvatar) {
              activeHeaderIcon.innerHTML = `<img src="${resolveMediaUrl(dispAvatar)}" style="width: 22px; height: 22px; border-radius: 50%; object-fit: cover;">`;
            } else {
              activeHeaderIcon.textContent = '👥';
            }
          }
          renderDmWelcomeBox(currentDmGroupMeta, true);
          renderDmGroupSidebar(currentDmGroupMeta, currentDmGroupMembers);
        }
      }

      if (modal) modal.style.display = 'none';
      closeModal('dm-group-settings-modal');
      showToast('Group settings updated!', 'success');
    };
  }

  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      const ok = await showConfirmDialog({
        title: 'Delete Group?',
        description: `Are you sure you want to permanently delete "${group.name}"? This will delete all messages and remove all members.`,
        confirmText: 'Delete Group',
        isDanger: true,
        icon: '🗑️'
      });
      if (ok) {
        socket.emit('delete-dm-group', { groupId: group.id });
        closeModal('dm-group-settings-modal');
      }
    };
  }

  if (leaveBtn) {
    leaveBtn.onclick = async () => {
      const ok = await showConfirmDialog({
        title: 'Leave Group?',
        description: `Are you sure you want to leave "${group.name}"?`,
        confirmText: 'Leave Group',
        isDanger: true,
        icon: '🚪'
      });
      if (ok) {
        socket.emit('kick-dm-group-member', { groupId: group.id, memberId: currentUser.id });
        closeModal('dm-group-settings-modal');
      }
    };
  }
}

async function kickGroupMember(groupId, memberId, memberName) {
  const ok = await showConfirmDialog({
    title: 'Remove Member?',
    description: `Are you sure you want to remove @${memberName} from this group?`,
    confirmText: 'Remove',
    isDanger: true,
    icon: '👢'
  });
  if (ok) {
    socket.emit('kick-dm-group-member', { groupId, memberId });
    showToast(`Removed @${memberName} from group.`, 'info');
  }
}

async function clearActiveDmConversation() {
  if (!activeDmPeerId) return;
  const isGroup = Boolean(String(activeDmPeerId).startsWith('grp_'));
  const ok = await showConfirmDialog({
    title: isGroup ? 'Clear Group Messages?' : 'Delete Entire Conversation?',
    description: isGroup 
      ? 'Are you sure you want to clear all messages in this group DM for all members?' 
      : 'Are you sure you want to delete this entire conversation? Messages will be cleared for both users and this cannot be undone.',
    confirmText: 'Delete',
    isDanger: true,
    icon: '🗑️'
  });
  if (ok) {
    socket.emit('clear-dm-conversation', { targetId: activeDmPeerId });
  }
}

window.kickGroupMember = kickGroupMember;
window.openGroupSettingsModal = openGroupSettingsModal;

async function startGroupDmCall(groupId, hasVideo = false) {
  if (!groupId) return;
  const ok = await ensureLocalMediaStream(hasVideo);
  if (!ok) return;
  playChime('call-outgoing');
  socket.emit('start-dm-call', { targetId: groupId, isGroup: true, hasVideo });
}

function openAddFriendsToDmModal(targetId = null, targetName = '') {
  const modal = document.getElementById('create-dm-group-modal');
  if (!modal) return;
  const titleEl = modal.querySelector('h3');
  const descEl = modal.querySelector('p');
  const nameInp = document.getElementById('create-group-name-input');
  const nameLabel = modal.querySelector('label.form-label');
  const searchInp = document.getElementById('create-group-search-input');
  const checklist = document.getElementById('create-group-friends-checklist');
  const submitBtn = document.getElementById('btn-submit-create-group');

  const isExistingGroup = Boolean(targetId && String(targetId).startsWith('grp_'));
  currentGroupModalContext = { targetId, targetName, isExistingGroup };

  if (isExistingGroup) {
    if (titleEl) titleEl.textContent = `Add Members to ${targetName || 'Group'}`;
    if (descEl) descEl.textContent = 'Select friends or users to invite into this group conversation.';
    if (nameInp) nameInp.style.display = 'none';
    if (nameLabel) nameLabel.style.display = 'none';
    if (submitBtn) submitBtn.textContent = 'Add to Group';
  } else {
    if (titleEl) titleEl.textContent = targetName ? `Create Group with @${targetName}` : 'Create Group DM';
    if (descEl) descEl.textContent = 'Select friends or any users to create a private group chat and call.';
    if (nameInp) { nameInp.style.display = 'block'; nameInp.value = ''; }
    if (nameLabel) nameLabel.style.display = 'block';
    if (submitBtn) submitBtn.textContent = 'Create Group';
  }

  if (searchInp) searchInp.value = '';

  function renderChecklist(filterText = '') {
    if (!checklist) return;
    checklist.innerHTML = '';

    const existingMemberIds = (isExistingGroup && currentDmGroupMembers) ? currentDmGroupMembers.map(m => m.id) : [];

    // Collect all candidates: friends first, then known accounts
    const candidateMap = new Map();
    cachedFriends.forEach(f => {
      candidateMap.set(f.id, { ...f, isFriend: true });
    });

    accountsMap.forEach((acc, id) => {
      if (currentUser && id === currentUser.id) return;
      if (!candidateMap.has(id)) {
        candidateMap.set(id, {
          id: acc.id,
          username: acc.username,
          avatarUrl: acc.avatarUrl,
          color: acc.color,
          isOnline: liveUserIds.has(acc.id),
          isFriend: false
        });
      }
    });

    cachedDmThreads.forEach(t => {
      if (t.isGroup || (currentUser && t.peerId === currentUser.id)) return;
      if (!candidateMap.has(t.peerId)) {
        candidateMap.set(t.peerId, {
          id: t.peerId,
          username: t.username,
          avatarUrl: t.avatarUrl,
          color: t.color,
          isOnline: t.isOnline,
          isFriend: false
        });
      }
    });

    let candidates = Array.from(candidateMap.values()).filter(u => !existingMemberIds.includes(u.id));

    if (filterText) {
      const q = filterText.toLowerCase();
      candidates = candidates.filter(u => (u.username || '').toLowerCase().includes(q));
    }

    if (candidates.length === 0) {
      checklist.innerHTML = `
        <div style="color: var(--text-muted); font-size: 13px; padding: 14px; text-align: center; line-height: 1.4;">
          ${filterText ? `No user found matching "${escapeHTML(filterText)}".` : (isExistingGroup ? 'All known users are already in this group!' : 'No other users found on the server.<br>Invite friends or have another user log in!')}
        </div>
      `;
      return;
    }

    // Sort: current target first, then friends, then online status, then alphabetical
    candidates.sort((a, b) => {
      if (targetId && a.id === targetId) return -1;
      if (targetId && b.id === targetId) return 1;
      if (a.isFriend !== b.isFriend) return b.isFriend ? 1 : -1;
      const aOn = Boolean(a.isOnline || liveUserIds.has(a.id));
      const bOn = Boolean(b.isOnline || liveUserIds.has(b.id));
      if (aOn !== bOn) return bOn ? 1 : -1;
      return (a.username || '').localeCompare(b.username || '');
    });

    candidates.forEach(u => {
      const isTargetPeer = (!isExistingGroup && targetId && (targetId === u.id));
      const isOnline = Boolean(u.isOnline || liveUserIds.has(u.id));
      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '10px';
      label.style.padding = '8px 12px';
      label.style.borderRadius = '6px';
      label.style.background = 'var(--bg-surface)';
      label.style.cursor = 'pointer';

      label.innerHTML = `
        <input type="checkbox" value="${u.id}" class="group-friend-checkbox" ${isTargetPeer ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--brand-color); cursor: pointer;">
        <div class="user-avatar" style="width: 30px; height: 30px; background-color: ${u.color || '#5865F2'}; position: relative; flex-shrink: 0;">
          ${u.avatarUrl ? `<img src="${u.avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : (u.username ? u.username.charAt(0).toUpperCase() : '?')}
          <div class="status-dot ${isOnline ? 'online' : 'offline'}" style="position: absolute; bottom: -2px; right: -2px; width: 10px; height: 10px; border: 2px solid var(--bg-surface);"></div>
        </div>
        <div style="display: flex; flex-direction: column; flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-weight: 600; font-size: 13.5px; color: var(--text-header); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              @${escapeHTML(u.username || 'User')}
            </span>
            ${u.isFriend ? '<span style="font-size: 10px; background: rgba(88, 101, 242, 0.2); color: #5865F2; padding: 1px 5px; border-radius: 3px; font-weight: 700;">FRIEND</span>' : ''}
            ${isTargetPeer ? '<span style="font-size: 10px; background: rgba(87, 242, 135, 0.2); color: #57f287; padding: 1px 5px; border-radius: 3px; font-weight: 700;">CURRENT DM</span>' : ''}
          </div>
          <span style="font-size: 11px; color: var(--text-muted);">${isOnline ? '🟢 Online' : '⚪ Offline'}</span>
        </div>
      `;
      checklist.appendChild(label);
    });
  }

  renderChecklist('');

  if (searchInp) {
    searchInp.oninput = () => {
      renderChecklist(searchInp.value.trim());
    };
  }

  openModal('create-dm-group-modal');
  setTimeout(() => { if (searchInp) searchInp.focus(); }, 50);
}

window.renderDmUserProfileSidebar = renderDmUserProfileSidebar;
window.renderDmGroupSidebar = renderDmGroupSidebar;
window.startGroupDmCall = startGroupDmCall;
window.openAddFriendsToDmModal = openAddFriendsToDmModal;


function renderFriendsMainStage(tabName = 'online') {
  currentFriendsTab = tabName;
  activeDmPeerId = null;

  const friendsStage = document.getElementById('friends-main-stage');
  const friendsStageBody = document.getElementById('friends-stage-body');
  const chatHdr = document.getElementById('chat-header');
  const msgContainer = document.getElementById('messages-container');
  const inputWrap = document.querySelector('.chat-input-wrapper');
  const dmTabFriends = document.getElementById('dm-tab-friends');

  if (friendsStage) friendsStage.style.display = 'flex';
  if (chatHdr) chatHdr.style.display = 'none';
  if (msgContainer) msgContainer.style.display = 'none';
  if (inputWrap) inputWrap.style.display = 'none';
  if (dmTabFriends) dmTabFriends.classList.add('active');

  // Update tabs active classes
  document.querySelectorAll('.friends-tab-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.tab === tabName);
  });

  // Update Counters
  const onlineCount = cachedFriends.filter(f => f.isOnline).length;
  const allCount = cachedFriends.length;
  const pendingCount = cachedIncomingFriends.length + cachedOutgoingFriends.length;

  const onlineCountEl = document.getElementById('friends-count-online');
  const allCountEl = document.getElementById('friends-count-all');
  const pendingCountEl = document.getElementById('friends-count-pending');
  const sidePendingBadge = document.getElementById('friends-pending-badge');
  const quickSidePendingBadge = document.getElementById('quick-friends-pending-badge');

  if (onlineCountEl) onlineCountEl.textContent = onlineCount;
  if (allCountEl) allCountEl.textContent = allCount;
  if (pendingCountEl) {
    pendingCountEl.textContent = pendingCount;
    pendingCountEl.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }
  if (sidePendingBadge) {
    sidePendingBadge.textContent = pendingCount;
    sidePendingBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }
  if (quickSidePendingBadge) {
    quickSidePendingBadge.textContent = pendingCount;
    quickSidePendingBadge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
  }

  if (!friendsStageBody) return;
  friendsStageBody.innerHTML = '';

  // Prominently display empty-server state banner and direct Join/Create buttons if user has 0 servers
  if (serversMap.size === 0) {
    const welcomeBanner = document.createElement('div');
    welcomeBanner.className = 'no-servers-welcome-banner';
    welcomeBanner.style.cssText = 'background: linear-gradient(135deg, rgba(88,101,242,0.18), rgba(87,242,135,0.12)); border: 1.5px solid rgba(88,101,242,0.4); border-radius: 12px; padding: 16px 20px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; box-shadow: 0 4px 18px rgba(0,0,0,0.25);';
    welcomeBanner.innerHTML = `
      <div style="flex: 1; min-width: 240px;">
        <div style="font-weight: 700; font-size: 15px; color: #fff; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 20px;">🏰</span> You aren't in any servers yet
        </div>
        <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">
          Direct Messages are active. Join a friend's server with an invite code or create your own community!
        </div>
      </div>
      <div style="display: flex; gap: 10px; flex-shrink: 0;">
        <button type="button" class="btn-primary" style="padding: 7px 16px; font-size: 13px; font-weight: 600;" onclick="window.openJoinServerModalDirect()">
          Join Server
        </button>
        <button type="button" class="btn-secondary" style="padding: 7px 16px; font-size: 13px; font-weight: 500;" onclick="window.openCreateServerModalDirect()">
          + Create Server
        </button>
      </div>
    `;
    friendsStageBody.appendChild(welcomeBanner);
  }

  // Tab: Add Friend
  if (tabName === 'add') {
    const addCard = document.createElement('div');
    addCard.style.maxWidth = '600px';
    addCard.innerHTML = `
      <div class="friends-section-title" style="font-size: 15px; color: #fff; margin-bottom: 6px;">ADD FRIEND</div>
      <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 18px;">You can add friends with their VoxLink username.</p>
      <div style="display: flex; gap: 10px; background: var(--bg-tertiary); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-subtle); align-items: center;">
        <input type="text" id="stage-add-friend-input" placeholder="You can add friends with their username" style="flex: 1; background: transparent; border: none; color: #fff; font-size: 15px; outline: none;">
        <button type="button" id="stage-send-friend-btn" class="friends-tab-pill add-friend-pill" style="border-radius: 4px; padding: 8px 18px; font-size: 13px;">Send Friend Request</button>
      </div>
      <div id="add-friend-status-msg" style="margin-top: 12px; font-size: 13px; display: none;"></div>
      <div style="margin-top: 40px; padding: 20px; border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-subtle); text-align: center;">
        <div style="font-size: 32px; margin-bottom: 10px;">🌟</div>
        <div style="font-weight: 700; color: #fff; margin-bottom: 6px;">Explore VoxLink Communities</div>
        <div style="color: var(--text-muted); font-size: 13px;">Connect with friends, start group voice and video calls, or share games with low-latency screenshare!</div>
      </div>
    `;
    friendsStageBody.appendChild(addCard);

    setTimeout(() => {
      const inp = document.getElementById('stage-add-friend-input');
      const btn = document.getElementById('stage-send-friend-btn');
      const msg = document.getElementById('add-friend-status-msg');
      if (inp) inp.focus();
      if (btn && inp) {
        btn.onclick = () => {
          const val = inp.value.trim();
          if (val) {
            socket.emit('send-friend-request', { username: val });
            inp.value = '';
            if (msg) {
              msg.style.display = 'block';
              msg.style.color = '#57f287';
              msg.textContent = `Friend request sent to @${val}! 🎉`;
            }
          }
        };
        inp.onkeydown = (e) => {
          if (e.key === 'Enter') btn.click();
        };
      }
    }, 50);
    return;
  }

  // Tab: Pending Requests
  if (tabName === 'pending') {
    const wrap = document.createElement('div');

    if (cachedIncomingFriends.length > 0) {
      const incTitle = document.createElement('div');
      incTitle.className = 'friends-section-title';
      incTitle.textContent = `INCOMING FRIEND REQUESTS — ${cachedIncomingFriends.length}`;
      wrap.appendChild(incTitle);

      cachedIncomingFriends.forEach(req => {
        const card = document.createElement('div');
        card.className = 'friend-row-card';
        card.innerHTML = `
          <div class="friend-row-left">
            <div class="friend-row-avatar" style="background-color: ${req.color || '#5865F2'};">
              ${req.avatarUrl ? `<img src="${req.avatarUrl}">` : (req.username ? req.username.charAt(0).toUpperCase() : '?')}
            </div>
            <div class="friend-row-meta">
              <div class="friend-row-name">@${escapeHTML(req.username)}</div>
              <div class="friend-row-status">Incoming Friend Request</div>
            </div>
          </div>
          <div class="friend-row-actions">
            <button type="button" class="friend-action-circle-btn accept" title="Accept" onclick="socket.emit('accept-friend-request', { requesterId: '${req.id}' })">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            </button>
            <button type="button" class="friend-action-circle-btn decline" title="Decline" onclick="window.declineFriendRequest('${req.id}')">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        `;
        wrap.appendChild(card);
      });
    }

    if (cachedOutgoingFriends.length > 0) {
      const outTitle = document.createElement('div');
      outTitle.className = 'friends-section-title';
      outTitle.style.marginTop = '24px';
      outTitle.textContent = `OUTGOING FRIEND REQUESTS — ${cachedOutgoingFriends.length}`;
      wrap.appendChild(outTitle);

      cachedOutgoingFriends.forEach(req => {
        const card = document.createElement('div');
        card.className = 'friend-row-card';
        card.innerHTML = `
          <div class="friend-row-left">
            <div class="friend-row-avatar" style="background-color: ${req.color || '#5865F2'};">
              ${req.avatarUrl ? `<img src="${req.avatarUrl}">` : (req.username ? req.username.charAt(0).toUpperCase() : '?')}
            </div>
            <div class="friend-row-meta">
              <div class="friend-row-name">@${escapeHTML(req.username)}</div>
              <div class="friend-row-status">Outgoing Friend Request</div>
            </div>
          </div>
          <div class="friend-row-actions">
            <button type="button" class="friend-action-circle-btn decline" title="Cancel Request" onclick="window.declineFriendRequest('${req.id}')">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        `;
        wrap.appendChild(card);
      });
    }

    if (cachedIncomingFriends.length === 0 && cachedOutgoingFriends.length === 0) {
      wrap.innerHTML = `
        <div style="text-align: center; padding: 48px 16px; color: var(--text-muted);">
          <div style="font-size: 40px; margin-bottom: 12px;">⏳</div>
          <div style="font-size: 15px; font-weight: 600; color: #fff;">No pending friend requests</div>
          <div style="font-size: 13px; margin-top: 4px;">There are no friend requests waiting for your action.</div>
        </div>
      `;
    }

    friendsStageBody.appendChild(wrap);
    return;
  }

  // Tab: Blocked
  if (tabName === 'blocked') {
    const wrap = document.createElement('div');
    const blockedList = Array.from(blockedUsersSet);

    if (blockedList.length === 0) {
      wrap.innerHTML = `
        <div style="text-align: center; padding: 48px 16px; color: var(--text-muted);">
          <div style="font-size: 40px; margin-bottom: 12px;">🛡️</div>
          <div style="font-size: 15px; font-weight: 600; color: #fff;">You haven't blocked anyone</div>
          <div style="font-size: 13px; margin-top: 4px;">Blocked users cannot message or call you.</div>
        </div>
      `;
    } else {
      const bTitle = document.createElement('div');
      bTitle.className = 'friends-section-title';
      bTitle.textContent = `BLOCKED USERS — ${blockedList.length}`;
      wrap.appendChild(bTitle);

      blockedList.forEach(uId => {
        const card = document.createElement('div');
        card.className = 'friend-row-card';
        card.innerHTML = `
          <div class="friend-row-left">
            <div class="friend-row-avatar" style="background: #da373c;">
              <span>🚫</span>
            </div>
            <div class="friend-row-meta">
              <div class="friend-row-name">User ID: ${uId}</div>
              <div class="friend-row-status">Blocked</div>
            </div>
          </div>
          <div class="friend-row-actions">
            <button type="button" class="btn-primary" style="padding: 6px 14px; font-size: 12px; background: var(--bg-hover);" onclick="unblockUser('${uId}')">Unblock</button>
          </div>
        `;
        wrap.appendChild(card);
      });
    }

    friendsStageBody.appendChild(wrap);
    return;
  }

  // Tab: Online or All
  let friendsToDisplay = tabName === 'online' ? cachedFriends.filter(f => f.isOnline) : cachedFriends;
  if (friendsSearchFilterText) {
    friendsToDisplay = friendsToDisplay.filter(f => (f.username || '').toLowerCase().includes(friendsSearchFilterText));
  }

  // Search box
  const searchWrap = document.createElement('div');
  searchWrap.className = 'friends-search-box';
  searchWrap.innerHTML = `
    <input type="text" id="friends-search-filter" placeholder="Search" value="${escapeHTML(friendsSearchFilterText)}" class="friends-search-input">
    <span class="friends-search-icon">🔍</span>
  `;
  friendsStageBody.appendChild(searchWrap);

  const filterInput = searchWrap.querySelector('#friends-search-filter');
  filterInput.addEventListener('input', (e) => {
    friendsSearchFilterText = (e.target.value || '').trim().toLowerCase();
    renderFriendsMainStage(currentFriendsTab);
  });

  // Section Header
  const countTitle = document.createElement('div');
  countTitle.className = 'friends-section-title';
  countTitle.textContent = `${tabName === 'online' ? 'ONLINE' : 'ALL FRIENDS'} — ${friendsToDisplay.length}`;
  friendsStageBody.appendChild(countTitle);

  if (friendsToDisplay.length === 0) {
    const emptyBox = document.createElement('div');
    emptyBox.style.textAlign = 'center';
    emptyBox.style.padding = '48px 16px';
    emptyBox.style.color = 'var(--text-muted)';
    emptyBox.innerHTML = `
      <div style="font-size: 40px; margin-bottom: 12px;">${tabName === 'online' ? '🌙' : '👥'}</div>
      <div style="font-size: 15px; font-weight: 600; color: #fff;">${tabName === 'online' ? 'No friends are online right now' : 'No friends found'}</div>
      <div style="font-size: 13px; margin-top: 4px;">${tabName === 'online' ? 'When your friends come online, they will appear here.' : 'Add friends using the Add Friend button above!'}</div>
    `;
    friendsStageBody.appendChild(emptyBox);
    return;
  }

  const listCardContainer = document.createElement('div');
  friendsToDisplay.forEach(f => {
    const card = document.createElement('div');
    card.className = 'friend-row-card';

    const left = document.createElement('div');
    left.className = 'friend-row-left';
    left.innerHTML = `
      <div class="friend-row-avatar" style="background-color: ${f.color || '#5865F2'};">
        ${f.avatarUrl ? `<img src="${f.avatarUrl}">` : (f.username ? f.username.charAt(0).toUpperCase() : '?')}
        <div class="status-dot ${f.isOnline ? 'online' : 'offline'}"></div>
      </div>
      <div class="friend-row-meta">
        <div class="friend-row-name">@${escapeHTML(f.username)}</div>
        <div class="friend-row-status">${escapeHTML(f.customStatus || (f.isOnline ? 'Online' : 'Offline'))}</div>
      </div>
    `;
    left.onclick = () => openDmWithUser(f);

    const right = document.createElement('div');
    right.className = 'friend-row-actions';

    // Message button
    const btnMsg = document.createElement('button');
    btnMsg.type = 'button';
    btnMsg.className = 'friend-action-circle-btn';
    btnMsg.title = 'Message';
    btnMsg.innerHTML = '💬';
    btnMsg.onclick = () => openDmWithUser(f);

    // Voice Call button
    const btnCall = document.createElement('button');
    btnCall.type = 'button';
    btnCall.className = 'friend-action-circle-btn';
    btnCall.title = 'Start Voice Call';
    btnCall.innerHTML = '📞';
    btnCall.onclick = () => {
      openDmWithUser(f);
      start1on1DmCall(f.id, false);
    };

    // Video Call button
    const btnVideo = document.createElement('button');
    btnVideo.type = 'button';
    btnVideo.className = 'friend-action-circle-btn';
    btnVideo.title = 'Start Video Call';
    btnVideo.innerHTML = '📹';
    btnVideo.onclick = () => {
      openDmWithUser(f);
      start1on1DmCall(f.id, true);
    };

    // Remove button
    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'friend-action-circle-btn';
    btnRemove.title = 'Remove Friend';
    btnRemove.innerHTML = '✕';
    btnRemove.onclick = async () => {
      await removeFriendById(f.id, f.username);
    };

    right.appendChild(btnMsg);
    right.appendChild(btnCall);
    right.appendChild(btnVideo);
    right.appendChild(btnRemove);

    card.appendChild(left);
    card.appendChild(right);
    listCardContainer.appendChild(card);
  });

  friendsStageBody.appendChild(listCardContainer);
}

// Wire up Friends Navbar Tab Pills
document.querySelectorAll('.friends-tab-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    const tab = pill.dataset.tab;
    if (tab) renderFriendsMainStage(tab);
  });
});

window.removeFriendById = async function(friendId, username) {
  const ok = await showConfirmDialog({
    title: 'Remove Friend',
    description: `Are you sure you want to remove @${username} from your friends list?`,
    confirmText: 'Remove Friend',
    isDanger: true,
    icon: '👥'
  });
  if (ok) {
    socket.emit('remove-friend', { friendId });
  }
};

window.toggleBlockUser = function(userId, username) {
  if (blockedUsersSet.has(userId)) {
    blockedUsersSet.delete(userId);
    showToast(`Unblocked @${username}`, 'info');
  } else {
    blockedUsersSet.add(userId);
    showToast(`Blocked @${username}`, 'warning');
  }
  renderFriendsMainStage(currentFriendsTab);
};

window.unblockUser = function(userId) {
  blockedUsersSet.delete(userId);
  showToast('User unblocked', 'info');
  renderFriendsMainStage('blocked');
};

// Wire up "Add Friends to DM" header action button
const dmAddFriendsBtn = document.getElementById('dm-add-friends-btn');
if (dmAddFriendsBtn) {
  dmAddFriendsBtn.addEventListener('click', () => {
    const peerName = activeChannelNameEl ? activeChannelNameEl.textContent.replace(/^@/, '') : '';
    openAddFriendsToDmModal(activeDmPeerId, peerName);
  });
}

async function start1on1DmCall(targetUserId, hasVideo = false) {
  if (!targetUserId) return;
  const ok = await ensureLocalMediaStream(hasVideo);
  if (!ok) return;
  playChime('call-outgoing');
  socket.emit('start-dm-call', { targetId: targetUserId, hasVideo });
}

function openMobileDrawer() {
  const serverRail = document.getElementById('server-rail') || document.querySelector('.server-rail');
  if (serverRail) serverRail.classList.add('mobile-open');
  if (channelsSidebar) channelsSidebar.classList.add('mobile-open');
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  if (backdrop) backdrop.classList.add('active');
}

function closeMobileDrawer() {
  const serverRail = document.getElementById('server-rail') || document.querySelector('.server-rail');
  if (serverRail) serverRail.classList.remove('mobile-open');
  if (channelsSidebar) channelsSidebar.classList.remove('mobile-open');
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  if (backdrop) backdrop.classList.remove('active');
}

mobileMenuToggle.addEventListener('click', openMobileDrawer);
const stageMobileMenuToggle = document.getElementById('stage-mobile-menu-toggle');
if (stageMobileMenuToggle) stageMobileMenuToggle.addEventListener('click', openMobileDrawer);
mobileSidebarClose.addEventListener('click', closeMobileDrawer);

const mobileDrawerBackdrop = document.getElementById('mobile-drawer-backdrop');
if (mobileDrawerBackdrop) mobileDrawerBackdrop.addEventListener('click', closeMobileDrawer);

serverHeaderBtn.addEventListener('click', (e) => {
  if (currentView !== 'server') return;
  const srv = getCurrentServer();
  const rect = serverHeaderBtn.getBoundingClientRect();
  let left = rect.left + 8;
  if (left + 240 > window.innerWidth) {
    left = Math.max(10, window.innerWidth - 240);
  }
  serverDropdownMenu.style.left = `${left}px`;
  serverDropdownMenu.style.top = `${rect.bottom + 4}px`;

  const isDevOrCreator = Boolean(currentUser && currentUser.globalBadges && (
    currentUser.globalBadges.includes('PROJECT_OWNER') ||
    currentUser.globalBadges.includes('CREATOR') ||
    currentUser.globalBadges.includes('DEVELOPER')
  ));

  const menuToggleVerified = document.getElementById('menu-toggle-verified');
  const menuVerifiedDivider = document.getElementById('menu-verified-divider');
  if (menuToggleVerified && menuVerifiedDivider) {
    if (isDevOrCreator && srv) {
      menuToggleVerified.style.display = 'flex';
      menuVerifiedDivider.style.display = 'block';
      menuToggleVerified.innerHTML = srv.isOfficial ? '🛡️ Revoke Verified Server' : '🛡️ Grant Verified Server';
    } else {
      menuToggleVerified.style.display = 'none';
      menuVerifiedDivider.style.display = 'none';
    }
  }

  serverDropdownMenu.style.display = serverDropdownMenu.style.display === 'block' ? 'none' : 'block';
  e.stopPropagation();
});

document.addEventListener('click', () => {
  serverDropdownMenu.style.display = 'none';
  userContextMenu.style.display = 'none';
  categoryContextMenu.style.display = 'none';
});

menuServerSettings.addEventListener('click', () => {
  closeMobileDrawer();
  openServerSettingsModal();
});
menuCreateCategory.addEventListener('click', () => {
  closeMobileDrawer();
  document.getElementById('create-category-modal').style.display = 'flex';
});
menuCreateChannel.addEventListener('click', () => {
  closeMobileDrawer();
  openCreateChannelModal(null, 'text');
});

const menuAddJoinServer = document.getElementById('menu-add-join-server');
if (menuAddJoinServer) {
  menuAddJoinServer.addEventListener('click', () => {
    closeMobileDrawer();
    openModal('create-server-modal');
  });
}

const menuToggleVerified = document.getElementById('menu-toggle-verified');
if (menuToggleVerified) {
  menuToggleVerified.addEventListener('click', () => {
    if (!currentServerId) return;
    socket.emit('toggle-server-verified', { serverId: currentServerId });
  });
}

// DM Friends tab click
const dmTabFriends = document.getElementById('dm-tab-friends');
if (dmTabFriends) {
  dmTabFriends.addEventListener('click', () => {
    activeDmPeerId = null;
    document.querySelectorAll('#dm-conversations-list .channel-item').forEach(el => el.classList.remove('active'));
    renderFriendsMainStage();
  });
}

// Add Friend / New DM button
const btnOpenAddFriend = document.getElementById('btn-open-add-friend');
if (btnOpenAddFriend) {
  btnOpenAddFriend.addEventListener('click', () => {
    openModal('add-friend-modal');
    // Populate known users list
    const knownList = document.getElementById('known-users-dm-list');
    if (knownList) {
      knownList.innerHTML = '';
      const otherUsers = Array.from(accountsMap.values()).filter(u => !currentUser || u.id !== currentUser.id);
      if (otherUsers.length === 0) {
        knownList.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 8px;">No other users found yet.</div>';
      } else {
        otherUsers.forEach(u => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.justifyContent = 'space-between';
          row.style.padding = '8px 12px';
          row.style.borderRadius = '6px';
          row.style.background = 'var(--bg-surface)';
          row.style.cursor = 'pointer';

          row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
              <div class="user-avatar" style="width: 28px; height: 28px; background-color: ${u.color || '#5865F2'};">
                ${u.avatarUrl ? `<img src="${u.avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%;">` : (u.username ? u.username.charAt(0).toUpperCase() : '?')}
              </div>
              <span style="font-weight: 500;">@${u.username}</span>
            </div>
            <button class="btn-primary" style="padding: 4px 10px; font-size: 12px;">Message</button>
          `;
          row.onclick = () => {
            closeModal('add-friend-modal');
            openDmWithUser(u);
          };
          knownList.appendChild(row);
        });
      }
    }
  });
}

// Send Friend Request form
const formSendFriendRequest = document.getElementById('form-send-friend-request');
if (formSendFriendRequest) {
  formSendFriendRequest.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('add-friend-username-input');
    const val = input ? input.value.trim() : '';
    if (val) {
      socket.emit('send-friend-request', { username: val });
      if (input) input.value = '';
      closeModal('add-friend-modal');
    }
  });
}

// 1-on-1 and Group DM Calling buttons in chat header
const dmStartVoiceBtn = document.getElementById('dm-start-voice-btn');
if (dmStartVoiceBtn) {
  dmStartVoiceBtn.addEventListener('click', async () => {
    if (activeDmPeerId) {
      const isGroup = String(activeDmPeerId).startsWith('grp_');
      const ok = await ensureLocalMediaStream(false);
      if (!ok) return;
      socket.emit('start-dm-call', { targetId: activeDmPeerId, isGroup, hasVideo: false });
    }
  });
}

const dmStartVideoBtn = document.getElementById('dm-start-video-btn');
if (dmStartVideoBtn) {
  dmStartVideoBtn.addEventListener('click', async () => {
    if (activeDmPeerId) {
      const isGroup = String(activeDmPeerId).startsWith('grp_');
      const ok = await ensureLocalMediaStream(true);
      if (!ok) return;
      socket.emit('start-dm-call', { targetId: activeDmPeerId, isGroup, hasVideo: true });
    }
  });
}

const dmStartScreenBtn = document.getElementById('dm-start-screen-btn');
if (dmStartScreenBtn) {
  dmStartScreenBtn.addEventListener('click', async () => {
    if (activeDmPeerId) {
      const isGroup = String(activeDmPeerId).startsWith('grp_');
      if (!currentVoiceChannel) {
        // Start call with screenshare
        const ok = await ensureLocalMediaStream(false);
        if (!ok) return;
        socket.emit('start-dm-call', { targetId: activeDmPeerId, isGroup, hasVideo: false });
      }
      openScreenShareSetupModal();
    }
  });
}

// Group DM Creation Modal Wiring
const btnOpenCreateGroup = document.getElementById('btn-open-create-group');
if (btnOpenCreateGroup) {
  btnOpenCreateGroup.addEventListener('click', () => {
    openAddFriendsToDmModal(null, null);
  });
}

const btnSubmitCreateGroup = document.getElementById('btn-submit-create-group');
if (btnSubmitCreateGroup) {
  btnSubmitCreateGroup.addEventListener('click', () => {
    const checked = Array.from(document.querySelectorAll('.group-friend-checkbox:checked')).map(cb => cb.value);

    if (currentGroupModalContext && currentGroupModalContext.isExistingGroup) {
      if (checked.length === 0) {
        return showToast('Select at least one user to add to the group.', 'warning');
      }
      socket.emit('add-dm-group-members', {
        groupId: currentGroupModalContext.targetId,
        memberIds: checked
      });
      showToast('Adding members to group...', 'info');
    } else {
      const nameInp = document.getElementById('create-group-name-input');
      const name = nameInp ? nameInp.value.trim() : '';
      let memberIds = checked;
      if (currentGroupModalContext && currentGroupModalContext.targetId && !memberIds.includes(currentGroupModalContext.targetId)) {
        memberIds = [currentGroupModalContext.targetId, ...checked];
      }
      if (memberIds.length === 0 && !name) {
        return showToast('Please select at least one friend or enter a group name.', 'warning');
      }
      socket.emit('create-dm-group', { name, memberIds });
      showToast('Creating group...', 'info');
    }

    closeModal('create-dm-group-modal');
    const nameInp = document.getElementById('create-group-name-input');
    if (nameInp) nameInp.value = '';
  });
}

// Incoming Call Accept & Decline
const btnAcceptDmCall = document.getElementById('btn-accept-dm-call');
if (btnAcceptDmCall) {
  btnAcceptDmCall.addEventListener('click', async () => {
    const modal = document.getElementById('incoming-dm-call-modal');
    if (modal) modal.style.display = 'none';
    if (incomingDmCallData) {
      currentVoiceChannel = incomingDmCallData.callChannelId;
      if (incomingDmCallData.caller && incomingDmCallData.caller.id) {
        activeDmPeerId = incomingDmCallData.caller.id;
        accountsMap.set(incomingDmCallData.caller.id, incomingDmCallData.caller);
      }
      updateVoiceUI();
      openCallStageView();
      await ensureLocalMediaStream(incomingDmCallData.hasVideo);
      socket.emit('accept-dm-call', {
        callerId: incomingDmCallData.caller ? incomingDmCallData.caller.id : null,
        callChannelId: incomingDmCallData.callChannelId,
        isGroup: incomingDmCallData.isGroup,
        groupId: incomingDmCallData.groupId
      });
    }
  });
}

const btnDeclineDmCall = document.getElementById('btn-decline-dm-call');
if (btnDeclineDmCall) {
  btnDeclineDmCall.addEventListener('click', () => {
    const modal = document.getElementById('incoming-dm-call-modal');
    if (modal) modal.style.display = 'none';
    if (incomingDmCallData) {
      if (!incomingDmCallData.isGroup && incomingDmCallData.caller) {
        socket.emit('decline-dm-call', {
          callerId: incomingDmCallData.caller.id
        });
      }
      incomingDmCallData = null;
    }
  });
}

// =========================================
// 3. CATEGORIES & CHANNELS
// =========================================
function checkChannelWritePermission(srv, channel) {
  if (!srv || !channel || !currentUser) return true;
  if (srv.ownerId === currentUser.id || hasPermission(srv, currentUser.id, 'MANAGE_SERVER') || hasPermission(srv, currentUser.id, 'MANAGE_CHANNELS')) {
    return true;
  }
  const userRoles = (srv.memberRoles && srv.memberRoles[currentUser.id]) || [];
  if (channel.rolePermissions) {
    let canWrite = true;
    const everyoneRole = srv.roles.find(r => r.name === '@everyone' || r.isEveryone);
    if (everyoneRole && channel.rolePermissions[everyoneRole.id]) {
      if (channel.rolePermissions[everyoneRole.id].canWrite === false) canWrite = false;
    }
    for (const rId of userRoles) {
      if (channel.rolePermissions[rId] && channel.rolePermissions[rId].canWrite !== undefined) {
        if (channel.rolePermissions[rId].canWrite === true) canWrite = true;
        else if (channel.rolePermissions[rId].canWrite === false && canWrite !== true) canWrite = false;
      }
    }
    return canWrite;
  }
  return true;
}

let draggedCategoryId = null;
let draggedChannelId = null;
let draggedFromCatId = null;

function renderCategoriesAndChannels() {
  const srv = getCurrentServer();
  if (!srv) return;

  categoriesContainer.innerHTML = '';

  const isChannelManager = currentUser && (
    srv.ownerId === currentUser.id ||
    hasPermission(srv, currentUser.id, 'MANAGE_CHANNELS') ||
    hasPermission(srv, currentUser.id, 'MANAGE_SERVER')
  );

  const userRoles = (currentUser && srv.memberRoles && srv.memberRoles[currentUser.id]) || [];
  const canViewChannel = (ch) => {
    if (isChannelManager) return true;
    if (!ch.isPrivate) return true;
    if (!ch.allowedRoles || ch.allowedRoles.length === 0) return true;
    return ch.allowedRoles.some(rId => userRoles.includes(rId));
  };

  srv.categories.forEach((cat, catIdx) => {
    const isCollapsed = collapsedCategories.has(cat.id);
    const catWrap = document.createElement('div');
    catWrap.className = 'channel-category-wrap';
    catWrap.setAttribute('data-category-id', cat.id);

    if (isChannelManager) {
      catWrap.setAttribute('draggable', 'true');
      catWrap.ondragstart = (e) => {
        draggedCategoryId = cat.id;
        draggedChannelId = null;
        e.dataTransfer.setData('text/plain', cat.id);
        catWrap.classList.add('dragging');
      };
      catWrap.ondragend = () => {
        draggedCategoryId = null;
        catWrap.classList.remove('dragging');
        document.querySelectorAll('.channel-category-wrap').forEach(el => el.classList.remove('drag-over'));
      };
      catWrap.ondragover = (e) => {
        if (draggedCategoryId && draggedCategoryId !== cat.id) {
          e.preventDefault();
          catWrap.classList.add('drag-over');
        }
      };
      catWrap.ondragleave = () => {
        catWrap.classList.remove('drag-over');
      };
      catWrap.ondrop = (e) => {
        if (draggedCategoryId && draggedCategoryId !== cat.id) {
          e.preventDefault();
          catWrap.classList.remove('drag-over');
          const sourceIdx = srv.categories.findIndex(c => c.id === draggedCategoryId);
          const targetIdx = srv.categories.findIndex(c => c.id === cat.id);
          if (sourceIdx !== -1 && targetIdx !== -1) {
            const [movedCat] = srv.categories.splice(sourceIdx, 1);
            srv.categories.splice(targetIdx, 0, movedCat);
            renderCategoriesAndChannels();
            socket.emit('reorder-categories', {
              serverId: srv.id,
              categoryIds: srv.categories.map(c => c.id)
            });
          }
        }
      };
    }

    const catHeader = document.createElement('div');
    catHeader.className = 'category-header';
    catHeader.innerHTML = `
      <span class="category-chevron">${isCollapsed ? '▸' : '▾'}</span>
      <span class="category-title">${escapeHTML(cat.name)}</span>
      <button class="add-channel-mini-btn" title="Create Channel" onclick="event.stopPropagation(); openCreateChannelModal('${cat.id}', 'text')">+</button>
    `;
    catHeader.onclick = () => {
      if (collapsedCategories.has(cat.id)) collapsedCategories.delete(cat.id);
      else collapsedCategories.add(cat.id);
      renderCategoriesAndChannels();
    };

    if (isChannelManager) {
      catHeader.ondragover = (e) => {
        if (draggedChannelId) {
          e.preventDefault();
          e.stopPropagation();
          catHeader.classList.add('drag-over');
        }
      };
      catHeader.ondragleave = () => {
        catHeader.classList.remove('drag-over');
      };
      catHeader.ondrop = (e) => {
        if (draggedChannelId && draggedFromCatId) {
          e.preventDefault();
          e.stopPropagation();
          catHeader.classList.remove('drag-over');
          socket.emit('reorder-channels', {
            serverId: srv.id,
            targetCategoryId: cat.id,
            channelId: draggedChannelId,
            targetIndex: 0
          });
        }
      };
    }

    // Right-click category to rename or delete
    catHeader.oncontextmenu = (e) => {
      e.preventDefault();
      contextTargetCategory = cat;
      categoryContextMenu.style.left = `${e.clientX}px`;
      categoryContextMenu.style.top = `${e.clientY}px`;
      categoryContextMenu.style.display = 'block';
    };

    catWrap.appendChild(catHeader);

    if (!isCollapsed) {
      const channelsBox = document.createElement('div');
      channelsBox.className = 'category-channels-box';
      channelsBox.setAttribute('data-category-id', cat.id);

      if (isChannelManager) {
        channelsBox.ondragover = (e) => {
          if (draggedChannelId) {
            e.preventDefault();
            e.stopPropagation();
            channelsBox.classList.add('drag-over-empty');
          }
        };
        channelsBox.ondragleave = () => {
          channelsBox.classList.remove('drag-over-empty');
        };
        channelsBox.ondrop = (e) => {
          if (draggedChannelId && draggedFromCatId) {
            e.preventDefault();
            e.stopPropagation();
            channelsBox.classList.remove('drag-over-empty');
            socket.emit('reorder-channels', {
              serverId: srv.id,
              targetCategoryId: cat.id,
              channelId: draggedChannelId,
              targetIndex: cat.channels.length
            });
          }
        };
      }

      const visibleChannels = cat.channels.filter(canViewChannel);
      if (visibleChannels.length === 0) {
        const emptyHint = document.createElement('div');
        emptyHint.className = 'empty-category-drop-hint';
        emptyHint.textContent = isChannelManager ? '📂 Empty Category — Drop channels here' : 'No channels';
        if (isChannelManager) {
          emptyHint.ondragover = (e) => {
            if (draggedChannelId) {
              e.preventDefault();
              e.stopPropagation();
              emptyHint.classList.add('drag-over');
            }
          };
          emptyHint.ondragleave = () => {
            emptyHint.classList.remove('drag-over');
          };
          emptyHint.ondrop = (e) => {
            if (draggedChannelId && draggedFromCatId) {
              e.preventDefault();
              e.stopPropagation();
              emptyHint.classList.remove('drag-over');
              socket.emit('reorder-channels', {
                serverId: srv.id,
                targetCategoryId: cat.id,
                channelId: draggedChannelId,
                targetIndex: 0
              });
            }
          };
        }
        channelsBox.appendChild(emptyHint);
      }

      cat.channels.forEach((ch, chIdx) => {
        if (!canViewChannel(ch)) return;

        const chItem = document.createElement('div');
        const isActive = (ch.type === 'text' && ch.id === activeTextChannel && currentView === 'server') ||
                         (ch.type === 'voice' && ch.id === currentVoiceChannel);
        chItem.className = `channel-item ${isActive ? 'active' : ''}`;
        chItem.setAttribute('data-channel-id', ch.id);

        if (isChannelManager) {
          chItem.setAttribute('draggable', 'true');
          chItem.ondragstart = (e) => {
            e.stopPropagation();
            draggedChannelId = ch.id;
            draggedFromCatId = cat.id;
            draggedCategoryId = null;
            e.dataTransfer.setData('text/plain', ch.id);
            chItem.classList.add('dragging');
          };
          chItem.ondragend = (e) => {
            e.stopPropagation();
            draggedChannelId = null;
            draggedFromCatId = null;
            chItem.classList.remove('dragging');
            document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('drag-over'));
          };
          chItem.ondragover = (e) => {
            if (draggedChannelId && draggedChannelId !== ch.id) {
              e.preventDefault();
              e.stopPropagation();
              chItem.classList.add('drag-over');
            }
          };
          chItem.ondragleave = (e) => {
            e.stopPropagation();
            chItem.classList.remove('drag-over');
          };
          chItem.ondrop = (e) => {
            if (draggedChannelId && draggedChannelId !== ch.id) {
              e.preventDefault();
              e.stopPropagation();
              chItem.classList.remove('drag-over');
              socket.emit('reorder-channels', {
                serverId: srv.id,
                targetCategoryId: cat.id,
                channelId: draggedChannelId,
                targetIndex: chIdx
              });
            }
          };
        }

        const lockIcon = ch.isPrivate ? '<span style="font-size: 11px; margin-right: 2px;" title="Private Channel">🔒</span>' : '';
        const chIcon = ch.type === 'voice' ? '🔊' : '#';

        const voiceMembers = [];
        if (ch.type === 'voice') {
          accountsMap.forEach(acc => {
            if (acc.currentVoice === ch.id && liveUserIds.has(acc.id)) {
              voiceMembers.push(acc);
            }
          });
        }
        const currentCount = voiceMembers.length;
        const hasLimit = ch.type === 'voice' && ch.userLimit && ch.userLimit > 0;
        const isFull = hasLimit && currentCount >= ch.userLimit;
        const limitBadge = hasLimit ? `<span class="voice-user-limit-badge ${isFull ? 'full' : ''}" title="${isFull ? 'Voice Channel Full' : `${currentCount}/${ch.userLimit} Users`}">${currentCount}/${ch.userLimit}</span>` : '';

        if (isFull) {
          chItem.classList.add('voice-channel-item-full');
        }

        chItem.innerHTML = `
          <span class="channel-icon">${lockIcon}${chIcon}</span>
          <span class="channel-name">${escapeHTML(ch.name)}</span>
          ${limitBadge}
          <button class="channel-settings-gear" title="Channel Settings" onclick="event.stopPropagation(); openEditChannelModal('${ch.id}', '${ch.name}', '${ch.topic || ''}')">⚙</button>
        `;

        chItem.onclick = () => {
          if (ch.type === 'text') {
            selectTextChannel(ch);
          } else {
            const isOwnerOrAdmin = srv.ownerId === (currentUser && currentUser.id) ||
              hasPermission(srv, currentUser && currentUser.id, 'MANAGE_SERVER') ||
              hasPermission(srv, currentUser && currentUser.id, 'MANAGE_CHANNELS');
            if (hasLimit && currentCount >= ch.userLimit && currentVoiceChannel !== ch.id && !isOwnerOrAdmin) {
              showToast(`This voice channel is full! (${currentCount}/${ch.userLimit})`, 'warning');
              return;
            }
            joinVoiceChannel(ch.id, ch.name);
          }
          closeMobileDrawer();
        };

        channelsBox.appendChild(chItem);

        // Render connected voice members under voice channel
        if (ch.type === 'voice' && voiceMembers.length > 0) {
          const membersWrap = document.createElement('div');
          membersWrap.className = 'voice-connected-members-list';
          voiceMembers.forEach(vm => {
            const memEl = document.createElement('div');
            memEl.className = `voice-member-subitem ${vm.isSpeaking ? 'speaking' : ''}`;
            const avatarBg = vm.avatarUrl ? `background-image: url('${vm.avatarUrl}');` : `background-color: ${vm.color || '#5865F2'};`;
            memEl.innerHTML = `
              <span class="voice-member-subavatar" style="${avatarBg}"></span>
              <span class="voice-member-subname">${escapeHTML(vm.username)}</span>
              ${vm.isMuted ? '<span class="voice-member-status-icon" title="Muted">🔇</span>' : ''}
              ${vm.isDeafened ? '<span class="voice-member-status-icon" title="Deafened">🎧</span>' : ''}
              ${vm.isVideoOn ? '<span class="voice-member-status-icon" title="Video On">📹</span>' : ''}
              ${vm.isScreenSharing ? '<span class="voice-member-status-icon" title="Screen Sharing">🖥️</span>' : ''}
            `;
            membersWrap.appendChild(memEl);
          });
          channelsBox.appendChild(membersWrap);
        }
      });
      catWrap.appendChild(channelsBox);
    }
    categoriesContainer.appendChild(catWrap);
  });
}

function selectTextChannel(ch) {
  if (!ch) return;
  activeTextChannel = ch.id;
  currentView = 'server';
  activeDmPeerId = null;

  const friendsStage = document.getElementById('friends-main-stage');
  const chatHdr = document.getElementById('chat-header');
  const msgContainer = document.getElementById('messages-container');
  const inputWrap = document.querySelector('.chat-input-wrapper');
  if (friendsStage) friendsStage.style.display = 'none';
  if (chatHdr) chatHdr.style.display = 'flex';
  if (msgContainer) msgContainer.style.display = 'flex';
  if (inputWrap) inputWrap.style.display = 'block';

  // Reset header DM buttons to server buttons
  const callVoiceBtn = document.getElementById('dm-start-voice-btn');
  const callVideoBtn = document.getElementById('dm-start-video-btn');
  const callScreenBtn = document.getElementById('dm-start-screen-btn');
  const addFriendsBtn = document.getElementById('dm-add-friends-btn');
  const groupSettingsBtn = document.getElementById('dm-group-settings-btn');
  const clearChatBtn = document.getElementById('dm-clear-chat-btn');
  const threadsBtn = document.getElementById('toggle-threads-btn');
  if (callVoiceBtn) callVoiceBtn.style.display = 'none';
  if (callVideoBtn) callVideoBtn.style.display = 'none';
  if (callScreenBtn) callScreenBtn.style.display = 'none';
  if (addFriendsBtn) addFriendsBtn.style.display = 'none';
  if (groupSettingsBtn) groupSettingsBtn.style.display = 'none';
  if (clearChatBtn) clearChatBtn.style.display = 'none';
  if (threadsBtn) threadsBtn.style.display = 'inline-flex';

  activeHeaderIcon.textContent = ch.isPrivate ? '🔒 #' : '#';
  activeChannelNameEl.textContent = ch.name;
  activeChannelTopicEl.textContent = ch.topic || '';

  const welcomeBox = document.getElementById('messages-welcome-box');
  if (welcomeBox) {
    welcomeBox.innerHTML = `
      <div class="welcome-icon" id="welcome-icon">${ch.isPrivate ? '🔒' : '#'}</div>
      <h2 id="welcome-title">Welcome to #${escapeHTML(ch.name)}!</h2>
      <p id="welcome-desc">${escapeHTML(ch.topic || 'This is the start of the channel. Send a message to get things rolling.')}</p>
    `;
    welcomeBox.style.display = 'block';
  }

  // Slowmode Indicator update
  const slowIndicator = document.getElementById('channel-slowmode-indicator');
  const slowValEl = document.getElementById('channel-slowmode-val');
  if (ch.slowmode && ch.slowmode > 0) {
    if (slowIndicator) slowIndicator.style.display = 'flex';
    if (slowValEl) slowValEl.textContent = ch.slowmode >= 60 ? `${Math.floor(ch.slowmode / 60)}m` : `${ch.slowmode}s`;
    currentSlowmodeSeconds = ch.slowmode;
  } else {
    if (slowIndicator) slowIndicator.style.display = 'none';
    currentSlowmodeSeconds = 0;
  }

  // Close thread panel if switching to another channel
  if (currentThreadChannelId && currentThreadChannelId !== ch.id) {
    closeThreadPanel();
  }
  closePinnedMessagesPopover();
  closeThreadsListPopover();
  if (window.innerWidth <= 850 && typeof closeMembersSidebar === 'function') closeMembersSidebar();
  updatePinsCountBadge();

  const srv = getCurrentServer();
  const canWrite = checkChannelWritePermission(srv, ch);
  const chatFormEl = document.getElementById('chat-form');

  if (!canWrite) {
    chatInput.placeholder = '🔒 You do not have permission to send messages in this channel (Read-only).';
    chatInput.disabled = true;
    if (chatFormEl) chatFormEl.classList.add('disabled');
  } else {
    chatInput.placeholder = `Message #${ch.name} (use /code for code, /thread for threads)`;
    chatInput.disabled = false;
    if (chatFormEl) chatFormEl.classList.remove('disabled');
  }

  chatArea.style.display = 'flex';
  callStageScreen.style.display = 'none';
  isCallStageActive = false;

  renderCategoriesAndChannels();

  messagesList.innerHTML = '';
  if (srv && srv.messages && srv.messages[ch.id]) {
    srv.messages[ch.id].forEach(renderMessage);
    scrollToBottom();
  }
}

// Slowmode Cooldown Timer
function startSlowmodeCooldown(seconds) {
  if (slowmodeCooldownInterval) clearInterval(slowmodeCooldownInterval);
  slowmodeCooldownRemaining = seconds;
  if (slowmodeCooldownBar) slowmodeCooldownBar.style.display = 'flex';
  if (slowmodeCountdownTimer) slowmodeCountdownTimer.textContent = `${slowmodeCooldownRemaining}s`;

  slowmodeCooldownInterval = setInterval(() => {
    slowmodeCooldownRemaining--;
    if (slowmodeCooldownRemaining <= 0) {
      clearInterval(slowmodeCooldownInterval);
      slowmodeCooldownInterval = null;
      if (slowmodeCooldownBar) slowmodeCooldownBar.style.display = 'none';
    } else {
      if (slowmodeCountdownTimer) slowmodeCountdownTimer.textContent = `${slowmodeCooldownRemaining}s`;
    }
  }, 1000);
}

// Thread Draft Mode UI Helper
function updateThreadDraftUI() {
  if (!toggleThreadDraftBtn) return;
  if (isThreadDraftMode) {
    toggleThreadDraftBtn.classList.add('thread-active');
    if (threadDraftBanner) threadDraftBanner.style.display = 'flex';
    if (threadDraftNameInput) threadDraftNameInput.focus();
  } else {
    toggleThreadDraftBtn.classList.remove('thread-active');
    if (threadDraftBanner) threadDraftBanner.style.display = 'none';
    if (threadDraftNameInput) threadDraftNameInput.value = '';
  }
}

if (toggleThreadDraftBtn) {
  toggleThreadDraftBtn.onclick = () => {
    isThreadDraftMode = !isThreadDraftMode;
    updateThreadDraftUI();
  };
}

if (cancelThreadDraftBtn) {
  cancelThreadDraftBtn.onclick = () => {
    isThreadDraftMode = false;
    updateThreadDraftUI();
  };
}

// =========================================
// PINNED MESSAGES SYSTEM
// =========================================
window.togglePinMessage = function(msgId) {
  if (currentView !== 'server' || !currentServerId || !activeTextChannel) return;
  socket.emit('toggle-pin-message', {
    serverId: currentServerId,
    channelId: activeTextChannel,
    messageId: msgId
  });
};

function updatePinsCountBadge() {
  if (!pinsCountBadge) return;
  const srv = getCurrentServer();
  if (!srv || !srv.messages || !srv.messages[activeTextChannel]) {
    pinsCountBadge.style.display = 'none';
    return;
  }
  const pinnedList = srv.messages[activeTextChannel].filter(m => m.isPinned);
  if (pinnedList.length > 0) {
    pinsCountBadge.textContent = pinnedList.length;
    pinsCountBadge.style.display = 'block';
  } else {
    pinsCountBadge.style.display = 'none';
  }
}

function openPinnedMessagesPopover() {
  if (!pinnedMessagesPopover) return;
  closeThreadsListPopover();
  renderPinnedMessagesPopover();
  pinnedMessagesPopover.style.display = 'flex';
  if (togglePinsBtn) togglePinsBtn.classList.add('active');
}

function closePinnedMessagesPopover() {
  if (!pinnedMessagesPopover) return;
  pinnedMessagesPopover.style.display = 'none';
  if (togglePinsBtn) togglePinsBtn.classList.remove('active');
}

if (togglePinsBtn) {
  togglePinsBtn.onclick = () => {
    if (pinnedMessagesPopover.style.display === 'none') openPinnedMessagesPopover();
    else closePinnedMessagesPopover();
  };
}

if (closePinsBtn) {
  closePinsBtn.onclick = () => closePinnedMessagesPopover();
}

function renderPinnedMessagesPopover() {
  if (!pinnedMessagesList) return;
  pinnedMessagesList.innerHTML = '';
  const srv = getCurrentServer();
  if (!srv || !srv.messages || !srv.messages[activeTextChannel]) {
    pinnedMessagesList.innerHTML = '<div class="popover-empty-state">No pinned messages in this channel yet.</div>';
    return;
  }

  const pinned = srv.messages[activeTextChannel].filter(m => m.isPinned);
  if (pinned.length === 0) {
    pinnedMessagesList.innerHTML = '<div class="popover-empty-state">No pinned messages in this channel yet.</div>';
    return;
  }

  pinned.forEach(m => {
    const card = document.createElement('div');
    card.className = 'pinned-message-card';
    const timeStr = new Date(m.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const avatarStyle = m.avatarUrl ? `background-image: url('${m.avatarUrl}');` : `background-color: ${m.color || '#5865F2'};`;

    card.innerHTML = `
      <div class="pinned-card-header">
        <div class="pinned-card-avatar" style="${avatarStyle}"></div>
        <span class="pinned-card-author" style="color: ${m.color || 'var(--text-header)'};">${escapeHTML(m.username)}</span>
        <span class="pinned-card-time">${timeStr}</span>
      </div>
      <div class="pinned-card-text">${formatDiscordMarkdown(m.text || '')}</div>
      <div class="pinned-card-actions">
        <button type="button" class="pinned-action-btn" onclick="jumpToPinnedMessage('${m.id}')">Jump to Message</button>
        <button type="button" class="pinned-action-btn unpin" onclick="togglePinMessage('${m.id}')">Unpin</button>
      </div>
    `;
    pinnedMessagesList.appendChild(card);
  });
}

window.jumpToPinnedMessage = function(msgId) {
  closePinnedMessagesPopover();
  const el = document.getElementById(`msg-${msgId}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash-highlight');
    setTimeout(() => el.classList.remove('flash-highlight'), 2200);
  } else {
    showToast('Message is further up in history.', 'info');
  }
};

// =========================================
// THREADS SYSTEM
// =========================================
window.openOrCreateThreadForMessage = function(msgId) {
  const srv = getCurrentServer();
  if (!srv || !srv.messages || !srv.messages[activeTextChannel]) return;
  const msg = srv.messages[activeTextChannel].find(m => m.id === msgId);
  if (!msg) return;

  if (msg.hasThread) {
    openThreadPanel(msgId);
  } else {
    const defaultTitle = msg.text ? (msg.text.length > 30 ? msg.text.substring(0, 30) + '...' : msg.text) : 'Thread';
    socket.emit('create-thread', {
      serverId: currentServerId,
      channelId: activeTextChannel,
      parentMessageId: msgId,
      threadName: defaultTitle
    });
    openThreadPanel(msgId);
  }
};

// Thread view mode (docked side-by-side vs fullscreen focused overlay)
let threadViewMode = localStorage.getItem('voxlink_thread_mode') || 'docked';

function applyThreadViewMode() {
  if (!threadSidebarPanel) return;
  const toggleBtn = document.getElementById('toggle-thread-view-mode-btn');
  if (threadViewMode === 'fullscreen') {
    threadSidebarPanel.classList.add('fullscreen-mode');
    if (toggleBtn) {
      toggleBtn.textContent = '⧉';
      toggleBtn.title = 'Dock Thread (Side-by-side View)';
    }
  } else {
    threadSidebarPanel.classList.remove('fullscreen-mode');
    if (toggleBtn) {
      toggleBtn.textContent = '⛶';
      toggleBtn.title = 'Expand Thread (Fullscreen View)';
    }
  }
}

const toggleThreadViewModeBtn = document.getElementById('toggle-thread-view-mode-btn');
if (toggleThreadViewModeBtn) {
  toggleThreadViewModeBtn.addEventListener('click', () => {
    threadViewMode = threadViewMode === 'fullscreen' ? 'docked' : 'fullscreen';
    localStorage.setItem('voxlink_thread_mode', threadViewMode);
    applyThreadViewMode();
  });
}

window.deleteThreadById = async function(threadId) {
  if (!currentServerId || !activeTextChannel || !threadId) return;
  const ok = await showConfirmDialog({
    title: 'Delete Thread',
    description: 'Are you sure you want to delete this thread? All messages and replies in this thread will be permanently deleted.',
    confirmText: 'Delete Thread',
    isDanger: true,
    icon: '🗑️'
  });
  if (!ok) return;

  socket.emit('delete-thread', {
    serverId: currentServerId,
    channelId: activeTextChannel,
    threadId
  });
};

const deleteThreadBtn = document.getElementById('delete-thread-btn');
if (deleteThreadBtn) {
  deleteThreadBtn.addEventListener('click', () => {
    if (currentThreadId) deleteThreadById(currentThreadId);
  });
}

window.openThreadPanel = function(threadId) {
  currentThreadId = threadId;
  currentThreadChannelId = activeTextChannel;
  applyThreadViewMode();
  if (threadSidebarPanel) threadSidebarPanel.style.display = 'flex';

  socket.emit('get-thread-data', {
    serverId: currentServerId,
    channelId: activeTextChannel,
    threadId
  });
};

window.closeThreadPanel = function() {
  currentThreadId = null;
  currentThreadChannelId = null;
  if (threadSidebarPanel) threadSidebarPanel.style.display = 'none';
};

if (closeThreadPanelBtn) {
  closeThreadPanelBtn.onclick = () => closeThreadPanel();
}

function renderThreadStarterCard(rootMsg) {
  if (!threadStarterBody) return;
  const avatarStyle = rootMsg.avatarUrl ? `background-image: url('${rootMsg.avatarUrl}');` : `background-color: ${rootMsg.color || '#5865F2'};`;
  const timeStr = new Date(rootMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatted = formatDiscordMarkdown(rootMsg.text || '');

  let extra = '';
  if (rootMsg.attachment && rootMsg.attachment.type && rootMsg.attachment.type.startsWith('image/')) {
    extra += `<div style="margin-top: 6px;"><img src="${rootMsg.attachment.dataUrl}" style="max-width: 100%; border-radius: 4px;"></div>`;
  }
  if (rootMsg.p2pFile) {
    extra += renderP2PFileCardHTML(rootMsg.p2pFile);
  }

  threadStarterBody.innerHTML = `
    <div style="display: flex; gap: 10px; align-items: flex-start;">
      <div class="message-avatar" style="${avatarStyle}; width: 32px; height: 32px; border-radius: 50%;"></div>
      <div style="flex: 1; overflow: hidden;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-weight: 600; color: ${rootMsg.color}; font-size: 13.5px;">${escapeHTML(rootMsg.username)}</span>
          <span style="font-size: 11px; color: var(--text-muted);">${timeStr}</span>
        </div>
        <div style="font-size: 13px; color: var(--text-normal); margin-top: 2px;">${formatted}</div>
        ${extra}
      </div>
    </div>
  `;
}

function appendThreadMessageToPanel(msg) {
  if (!threadMessagesList) return;
  const row = document.createElement('div');
  row.className = 'message-row';
  row.style.padding = '4px 0';
  const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const avatarStyle = msg.avatarUrl ? `background-image: url('${msg.avatarUrl}');` : `background-color: ${msg.color || '#5865F2'};`;

  let extra = '';
  if (msg.attachment && msg.attachment.type && msg.attachment.type.startsWith('image/')) {
    extra += `<div style="margin-top: 6px;"><img src="${msg.attachment.dataUrl}" style="max-width: 100%; border-radius: 4px;"></div>`;
  }
  if (msg.p2pFile) {
    extra += renderP2PFileCardHTML(msg.p2pFile);
  }

  row.innerHTML = `
    <div style="display: flex; gap: 10px; width: 100%;">
      <div class="message-avatar" style="${avatarStyle}; width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;"></div>
      <div class="message-body" style="flex: 1;">
        <div class="message-header" style="gap: 6px;">
          <span class="message-author" style="color: ${msg.color}; font-size: 13px;">${escapeHTML(msg.username)}</span>
          <span class="message-time" style="font-size: 11px;">${timeStr}</span>
        </div>
        <div class="message-content" style="font-size: 13px;">${formatDiscordMarkdown(msg.text || '')}</div>
        ${extra}
      </div>
    </div>
  `;
  threadMessagesList.appendChild(row);
  if (threadMessagesScrollArea) threadMessagesScrollArea.scrollTop = threadMessagesScrollArea.scrollHeight;
}

if (threadChatForm) {
  threadChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentThreadId) return;
    const text = (threadChatInput.value || '').trim();
    if (!text) return;

    socket.emit('send-thread-message', {
      serverId: currentServerId,
      channelId: activeTextChannel,
      threadId: currentThreadId,
      text
    });
    threadChatInput.value = '';
  });
}

function openThreadsListPopover() {
  if (!threadsListPopover) return;
  closePinnedMessagesPopover();
  renderThreadsListPopover();
  threadsListPopover.style.display = 'flex';
  if (toggleThreadsBtn) toggleThreadsBtn.classList.add('active');
}

function closeThreadsListPopover() {
  if (!threadsListPopover) return;
  threadsListPopover.style.display = 'none';
  if (toggleThreadsBtn) toggleThreadsBtn.classList.remove('active');
}

if (toggleThreadsBtn) {
  toggleThreadsBtn.onclick = () => {
    if (threadsListPopover.style.display === 'none') openThreadsListPopover();
    else closeThreadsListPopover();
  };
}

if (closeThreadsListBtn) {
  closeThreadsListBtn.onclick = () => closeThreadsListPopover();
}

function renderThreadsListPopover() {
  if (!channelThreadsList) return;
  channelThreadsList.innerHTML = '';
  const srv = getCurrentServer();
  if (!srv || !srv.messages || !srv.messages[activeTextChannel]) {
    channelThreadsList.innerHTML = '<div class="popover-empty-state">No active threads in this channel.</div>';
    return;
  }

  const threadMsgs = srv.messages[activeTextChannel].filter(m => m.hasThread);
  if (threadMsgs.length === 0) {
    channelThreadsList.innerHTML = '<div class="popover-empty-state">No active threads in this channel.</div>';
    return;
  }

  threadMsgs.forEach(m => {
    const card = document.createElement('div');
    card.className = 'thread-list-card';
    const replies = m.threadRepliesCount || 0;
    const canDelete = currentUser && (
      m.senderId === currentUser.id ||
      (srv && srv.ownerId === currentUser.id) ||
      hasPermission(srv, currentUser.id, 'MANAGE_CHANNELS') ||
      hasPermission(srv, currentUser.id, 'MANAGE_SERVER') ||
      (currentUser.globalBadges && (currentUser.globalBadges.includes('PROJECT_OWNER') || currentUser.globalBadges.includes('CREATOR') || currentUser.globalBadges.includes('DEVELOPER')))
    );

    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span style="font-weight: 700; color: var(--accent-blurple); font-size: 13.5px;">🧵 ${escapeHTML(m.threadName || 'Thread')}</span>
        <span style="font-size: 11.5px; color: var(--text-muted);">${replies} ${replies === 1 ? 'reply' : 'replies'}</span>
      </div>
      <div style="font-size: 12.5px; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
        ${escapeHTML(m.text || '')}
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
        <span style="font-size: 11px; color: var(--text-muted);">Started by @${escapeHTML(m.username)}</span>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="pinned-action-btn" onclick="closeThreadsListPopover(); openThreadPanel('${m.id}')">Open Thread</button>
          ${canDelete ? `<button type="button" class="pinned-action-btn unpin" onclick="deleteThreadById('${m.id}')" title="Delete Thread">Delete</button>` : ''}
        </div>
      </div>
    `;
    channelThreadsList.appendChild(card);
  });
}

const closeMembersSidebarBtn = document.getElementById('close-members-sidebar-btn');
const membersBackdrop = document.getElementById('members-backdrop');

function openMembersSidebar() {
  const mb = document.getElementById('members-sidebar');
  if (mb) {
    if (window.innerWidth <= 850) {
      mb.classList.add('mobile-open');
    } else {
      mb.classList.remove('collapsed');
    }
    if (toggleMembersBtn) toggleMembersBtn.classList.add('active');
  }
  if (membersBackdrop && window.innerWidth <= 850) {
    membersBackdrop.style.display = 'block';
    setTimeout(() => { membersBackdrop.classList.add('active'); }, 10);
  }
}

function closeMembersSidebar() {
  const mb = document.getElementById('members-sidebar');
  if (mb) {
    mb.classList.remove('mobile-open');
    if (window.innerWidth > 850) {
      mb.classList.add('collapsed');
    }
    if (toggleMembersBtn) toggleMembersBtn.classList.remove('active');
  }
  if (membersBackdrop) {
    membersBackdrop.classList.remove('active');
    setTimeout(() => {
      if (!membersBackdrop.classList.contains('active')) {
        membersBackdrop.style.display = 'none';
      }
    }, 250);
  }
}

function toggleMembersSidebar() {
  const mb = document.getElementById('members-sidebar');
  if (!mb) return;
  if (window.innerWidth <= 850) {
    if (mb.classList.contains('mobile-open')) {
      closeMembersSidebar();
    } else {
      openMembersSidebar();
    }
  } else {
    if (mb.classList.contains('collapsed')) {
      openMembersSidebar();
    } else {
      closeMembersSidebar();
    }
  }
}

if (toggleMembersBtn) {
  toggleMembersBtn.onclick = (e) => {
    e.stopPropagation();
    toggleMembersSidebar();
  };
}

if (closeMembersSidebarBtn) {
  closeMembersSidebarBtn.onclick = (e) => {
    e.stopPropagation();
    closeMembersSidebar();
  };
}

if (membersBackdrop) {
  membersBackdrop.onclick = () => {
    closeMembersSidebar();
  };
}

// Category Context Menu Handlers
catCtxRename.addEventListener('click', () => {
  if (contextTargetCategory) {
    document.getElementById('edit-category-id').value = contextTargetCategory.id;
    document.getElementById('edit-category-name').value = contextTargetCategory.name;
    document.getElementById('edit-category-modal').style.display = 'flex';
  }
});

document.getElementById('edit-category-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const catId = document.getElementById('edit-category-id').value;
  const name = document.getElementById('edit-category-name').value.trim();
  if (name) {
    socket.emit('rename-category', { serverId: currentServerId, categoryId: catId, name });
    closeModal('edit-category-modal');
  }
});

document.getElementById('delete-category-btn').addEventListener('click', async () => {
  const catId = document.getElementById('edit-category-id').value;
  const catName = document.getElementById('edit-category-name').value;
  const ok = await showConfirmDialog({
    title: 'Delete Category',
    description: `Are you sure you want to delete the category "${catName}" and all channels inside it? This cannot be undone.`,
    confirmText: 'Delete Category',
    isDanger: true,
    icon: '📁'
  });
  if (ok) {
    socket.emit('delete-category', { serverId: currentServerId, categoryId: catId });
    closeModal('edit-category-modal');
  }
});

catCtxDelete.addEventListener('click', async () => {
  if (!contextTargetCategory) return;
  const ok = await showConfirmDialog({
    title: 'Delete Category',
    description: `Are you sure you want to delete the category "${contextTargetCategory.name}" and all channels inside it?`,
    confirmText: 'Delete Category',
    isDanger: true,
    icon: '📁'
  });
  if (ok) {
    socket.emit('delete-category', { serverId: currentServerId, categoryId: contextTargetCategory.id });
  }
});

// Channel Roles and Permissions Helpers
function renderChannelRolesAndPermissions(containerRolesId, containerPermsId, selectedRoles = [], rolePerms = {}) {
  const srv = getCurrentServer();
  if (!srv) return;
  const rolesListEl = document.getElementById(containerRolesId);
  const permsListEl = document.getElementById(containerPermsId);

  if (rolesListEl) {
    rolesListEl.innerHTML = '';
    srv.roles.forEach(role => {
      if (role.name === '@everyone' || role.isEveryone) return;
      const isChecked = selectedRoles && selectedRoles.includes(role.id);
      const label = document.createElement('label');
      label.className = 'role-checkbox-item';
      label.innerHTML = `
        <input type="checkbox" value="${role.id}" ${isChecked ? 'checked' : ''} class="ch-role-check">
        <span style="color: ${role.color}; font-weight: 500;">${role.badge ? role.badge + ' ' : ''}${escapeHTML(role.name)}</span>
      `;
      rolesListEl.appendChild(label);
    });
  }

  if (permsListEl) {
    permsListEl.innerHTML = '';
    srv.roles.forEach(role => {
      const perms = (rolePerms && rolePerms[role.id]) || { canRead: true, canWrite: true };
      const row = document.createElement('div');
      row.className = 'perm-matrix-row';
      row.innerHTML = `
        <div class="perm-matrix-role-name" style="color: ${role.color};">
          <span>${role.badge ? role.badge + ' ' : ''}${escapeHTML(role.name)}</span>
        </div>
        <div class="perm-matrix-toggles">
          <label class="perm-check-label">
            <input type="checkbox" data-role-id="${role.id}" data-perm="canRead" ${perms.canRead !== false ? 'checked' : ''}>
            <span>👁️ Read</span>
          </label>
          <label class="perm-check-label">
            <input type="checkbox" data-role-id="${role.id}" data-perm="canWrite" ${perms.canWrite !== false ? 'checked' : ''}>
            <span>✍️ Write</span>
          </label>
        </div>
      `;
      permsListEl.appendChild(row);
    });
  }
}

function collectChannelPermsFromList(permsListId) {
  const permsListEl = document.getElementById(permsListId);
  if (!permsListEl) return {};
  const res = {};
  permsListEl.querySelectorAll('.perm-matrix-row').forEach(row => {
    const readCheck = row.querySelector('input[data-perm="canRead"]');
    const writeCheck = row.querySelector('input[data-perm="canWrite"]');
    if (readCheck && writeCheck) {
      const roleId = readCheck.getAttribute('data-role-id');
      res[roleId] = {
        canRead: readCheck.checked,
        canWrite: writeCheck.checked
      };
    }
  });
  return res;
}

function setVoiceLimitSliderValue(prefix, val) {
  const range = document.getElementById(`${prefix}-channel-voice-limit-range`);
  const valText = document.getElementById(`${prefix}-channel-voice-limit-val`);
  const pills = document.querySelectorAll(`.preset-pill[data-target="${prefix}"]`);
  if (!range || !valText) return;

  const num = Math.max(0, Math.min(99, parseInt(val, 10) || 0));
  range.value = num;
  if (num === 0) {
    valText.textContent = 'No Limit';
    valText.style.color = '#949BA4';
    valText.style.background = 'rgba(148, 155, 164, 0.15)';
  } else {
    valText.textContent = `${num} User${num === 1 ? '' : 's'}`;
    valText.style.color = '#5865F2';
    valText.style.background = 'rgba(88, 101, 242, 0.15)';
  }
  pills.forEach(p => {
    const pVal = parseInt(p.getAttribute('data-val'), 10);
    if (pVal === num) p.classList.add('active');
    else p.classList.remove('active');
  });
}

function initVoiceLimitSlider(prefix) {
  const range = document.getElementById(`${prefix}-channel-voice-limit-range`);
  const pills = document.querySelectorAll(`.preset-pill[data-target="${prefix}"]`);
  if (!range) return;

  range.addEventListener('input', (e) => {
    setVoiceLimitSliderValue(prefix, e.target.value);
  });

  pills.forEach(p => {
    p.addEventListener('click', (e) => {
      e.preventDefault();
      const pVal = parseInt(p.getAttribute('data-val'), 10);
      setVoiceLimitSliderValue(prefix, pVal);
    });
  });
}

// Slowmode Slider Controls
function setSlowmodeSliderValue(prefix, val) {
  const range = document.getElementById(`${prefix}-channel-slowmode-range`);
  const valText = document.getElementById(`${prefix}-channel-slowmode-val`);
  const pills = document.querySelectorAll(`.preset-pill[data-target="${prefix}-slow"]`);
  if (!range || !valText) return;

  const num = Math.max(0, Math.min(3600, parseInt(val, 10) || 0));
  range.value = num;
  if (num === 0) {
    valText.textContent = 'Off';
    valText.style.color = '#949BA4';
    valText.style.background = 'rgba(148, 155, 164, 0.15)';
  } else {
    const label = num >= 60 ? `${Math.floor(num / 60)} Minute${num >= 120 ? 's' : ''}` : `${num} Seconds`;
    valText.textContent = label;
    valText.style.color = '#FAA61A';
    valText.style.background = 'rgba(250, 166, 26, 0.15)';
  }
  pills.forEach(p => {
    const pVal = parseInt(p.getAttribute('data-val'), 10);
    if (pVal === num) p.classList.add('active');
    else p.classList.remove('active');
  });
}

function initSlowmodeSlider(prefix) {
  const range = document.getElementById(`${prefix}-channel-slowmode-range`);
  const pills = document.querySelectorAll(`.preset-pill[data-target="${prefix}-slow"]`);
  if (!range) return;

  range.addEventListener('input', (e) => {
    setSlowmodeSliderValue(prefix, e.target.value);
  });

  pills.forEach(p => {
    p.addEventListener('click', (e) => {
      e.preventDefault();
      const pVal = parseInt(p.getAttribute('data-val'), 10);
      setSlowmodeSliderValue(prefix, pVal);
    });
  });
}

// Channel Modals
initVoiceLimitSlider('new');
initVoiceLimitSlider('edit');
initSlowmodeSlider('new');
initSlowmodeSlider('edit');

document.querySelectorAll('input[name="channelType"]').forEach(r => {
  r.addEventListener('change', () => {
    const isVoice = document.querySelector('input[name="channelType"]:checked')?.value === 'voice';
    const limitWrap = document.getElementById('new-channel-voice-limit-wrap');
    const slowWrap = document.getElementById('new-channel-slowmode-wrap');
    if (limitWrap) limitWrap.style.display = isVoice ? 'block' : 'none';
    if (slowWrap) slowWrap.style.display = isVoice ? 'none' : 'block';
  });
});

window.openCreateChannelModal = function(catId, type) {
  document.getElementById('channel-target-category-id').value = catId || '';
  const radio = document.querySelector(`input[name="channelType"][value="${type}"]`);
  if (radio) radio.checked = true;

  const isVoice = type === 'voice';
  const limitWrap = document.getElementById('new-channel-voice-limit-wrap');
  const slowWrap = document.getElementById('new-channel-slowmode-wrap');
  if (limitWrap) limitWrap.style.display = isVoice ? 'block' : 'none';
  if (slowWrap) slowWrap.style.display = isVoice ? 'none' : 'block';

  setVoiceLimitSliderValue('new', 0);
  setSlowmodeSliderValue('new', 0);

  const isPrivateCheck = document.getElementById('new-channel-is-private');
  if (isPrivateCheck) {
    isPrivateCheck.checked = false;
    isPrivateCheck.onchange = () => {
      document.getElementById('new-channel-roles-wrap').style.display = isPrivateCheck.checked ? 'block' : 'none';
    };
  }
  document.getElementById('new-channel-roles-wrap').style.display = 'none';

  renderChannelRolesAndPermissions('new-channel-roles-list', 'new-channel-perms-list', [], {});
  document.getElementById('create-channel-modal').style.display = 'flex';
};

document.getElementById('create-channel-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const catId = document.getElementById('channel-target-category-id').value;
  const type = document.querySelector('input[name="channelType"]:checked').value;
  const name = document.getElementById('new-channel-name').value.trim();
  const topic = document.getElementById('new-channel-topic').value.trim();

  if (!name) return;

  const userLimit = type === 'voice' ? (parseInt(document.getElementById('new-channel-voice-limit-range')?.value, 10) || 0) : 0;
  const slowmode = type === 'text' ? (parseInt(document.getElementById('new-channel-slowmode-range')?.value, 10) || 0) : 0;
  const isPrivate = document.getElementById('new-channel-is-private').checked;
  const allowedRoles = Array.from(document.querySelectorAll('#new-channel-roles-list .ch-role-check:checked')).map(c => c.value);
  const rolePermissions = collectChannelPermsFromList('new-channel-perms-list');

  socket.emit('create-channel', {
    serverId: currentServerId,
    categoryId: catId,
    type,
    name,
    topic,
    isPrivate,
    allowedRoles,
    rolePermissions,
    userLimit,
    slowmode
  });

  closeModal('create-channel-modal');
  document.getElementById('new-channel-name').value = '';
  document.getElementById('new-channel-topic').value = '';
});

document.getElementById('create-category-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('new-category-name').value.trim();
  if (!name) return;
  socket.emit('create-category', { serverId: currentServerId, name });
  closeModal('create-category-modal');
  document.getElementById('new-category-name').value = '';
});

window.openEditChannelModal = function(chId, name, topic) {
  document.getElementById('edit-channel-id').value = chId;
  document.getElementById('edit-channel-name').value = name;
  document.getElementById('edit-channel-topic').value = topic;

  const srv = getCurrentServer();
  let chObj = null;
  if (srv) {
    for (const cat of srv.categories) {
      const found = cat.channels.find(c => c.id === chId);
      if (found) { chObj = found; break; }
    }
  }

  const editLimitWrap = document.getElementById('edit-channel-voice-limit-wrap');
  if (editLimitWrap) {
    if (chObj && chObj.type === 'voice') {
      editLimitWrap.style.display = 'block';
      setVoiceLimitSliderValue('edit', chObj.userLimit || 0);
    } else {
      editLimitWrap.style.display = 'none';
    }
  }

  const editSlowWrap = document.getElementById('edit-channel-slowmode-wrap');
  if (editSlowWrap) {
    if (chObj && chObj.type === 'text') {
      editSlowWrap.style.display = 'block';
      setSlowmodeSliderValue('edit', chObj.slowmode || 0);
    } else {
      editSlowWrap.style.display = 'none';
    }
  }

  const isPrivateCheck = document.getElementById('edit-channel-is-private');
  if (isPrivateCheck) {
    isPrivateCheck.checked = chObj ? Boolean(chObj.isPrivate) : false;
    isPrivateCheck.onchange = () => {
      document.getElementById('edit-channel-roles-wrap').style.display = isPrivateCheck.checked ? 'block' : 'none';
    };
  }
  document.getElementById('edit-channel-roles-wrap').style.display = (chObj && chObj.isPrivate) ? 'block' : 'none';

  renderChannelRolesAndPermissions(
    'edit-channel-roles-list',
    'edit-channel-perms-list',
    (chObj && chObj.allowedRoles) || [],
    (chObj && chObj.rolePermissions) || {}
  );

  document.getElementById('edit-channel-modal').style.display = 'flex';
};

document.getElementById('edit-channel-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const chId = document.getElementById('edit-channel-id').value;
  const name = document.getElementById('edit-channel-name').value.trim();
  const topic = document.getElementById('edit-channel-topic').value.trim();

  const userLimit = parseInt(document.getElementById('edit-channel-voice-limit-range')?.value, 10) || 0;
  const slowmode = parseInt(document.getElementById('edit-channel-slowmode-range')?.value, 10) || 0;
  const isPrivate = document.getElementById('edit-channel-is-private').checked;
  const allowedRoles = Array.from(document.querySelectorAll('#edit-channel-roles-list .ch-role-check:checked')).map(c => c.value);
  const rolePermissions = collectChannelPermsFromList('edit-channel-perms-list');

  socket.emit('edit-channel', {
    serverId: currentServerId,
    channelId: chId,
    name,
    topic,
    isPrivate,
    allowedRoles,
    rolePermissions,
    userLimit,
    slowmode
  });
  closeModal('edit-channel-modal');
});

document.getElementById('delete-channel-btn').addEventListener('click', async () => {
  const chId = document.getElementById('edit-channel-id').value;
  const name = document.getElementById('edit-channel-name').value;
  const ok = await showConfirmDialog({
    title: 'Delete Channel',
    description: `Are you sure you want to delete #${name}? All message history in this channel will be permanently removed.`,
    confirmText: 'Delete Channel',
    isDanger: true,
    icon: '🗑️'
  });
  if (ok) {
    socket.emit('delete-channel', { serverId: currentServerId, channelId: chId });
    closeModal('edit-channel-modal');
  }
});

// =========================================
// 4. SERVER SETTINGS & BANS
// =========================================
function openServerSettingsModal() {
  const srv = getCurrentServer();
  if (!srv) return;

  document.getElementById('settings-srv-title').textContent = `${srv.name} Settings`;
  document.getElementById('settings-overview-name').value = srv.name;

  draftServerIconUrl = srv.iconUrl || null;
  draftServerBannerUrl = srv.bannerUrl || null;

  const iconPreview = document.getElementById('server-icon-preview');
  if (draftServerIconUrl) {
    iconPreview.style.backgroundImage = `url(${draftServerIconUrl})`;
    iconPreview.textContent = '';
  } else {
    iconPreview.style.backgroundImage = 'none';
    iconPreview.textContent = srv.icon || srv.name.substring(0, 2).toUpperCase();
  }

  const bannerPreview = document.getElementById('server-banner-preview');
  if (draftServerBannerUrl) {
    bannerPreview.style.backgroundImage = `url(${draftServerBannerUrl})`;
    bannerPreview.textContent = '';
  } else {
    bannerPreview.style.backgroundImage = 'none';
    bannerPreview.textContent = 'No Banner';
  }

  const inviteCodeInput = document.getElementById('settings-invite-code-input');
  if (inviteCodeInput) inviteCodeInput.value = srv.inviteCode || 'VOXLINK';

  const isOfficialCheck = document.getElementById('settings-is-official-checkbox');
  if (isOfficialCheck) isOfficialCheck.checked = Boolean(srv.isOfficial);

  const officialBadgeBox = document.getElementById('setting-official-badge-box');
  const isDevOrCreator = Boolean(currentUser && currentUser.globalBadges && (
    currentUser.globalBadges.includes('PROJECT_OWNER') ||
    currentUser.globalBadges.includes('CREATOR') ||
    currentUser.globalBadges.includes('DEVELOPER')
  ));
  if (officialBadgeBox) officialBadgeBox.style.display = isDevOrCreator ? 'flex' : 'none';

  renderRolesManager();
  renderBansTab();
  document.getElementById('server-settings-modal').style.display = 'flex';
}

// Local File Uploads for Server Icon and Banner (Supporting animated GIFs)
document.getElementById('server-icon-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    draftServerIconUrl = await compressImage(file, 256, 256, 0.85);
    const preview = document.getElementById('server-icon-preview');
    preview.style.backgroundImage = `url(${draftServerIconUrl})`;
    preview.textContent = '';
  } catch (err) {}
});

document.getElementById('server-banner-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    draftServerBannerUrl = await compressImage(file, 960, 320, 0.82);
    const preview = document.getElementById('server-banner-preview');
    preview.style.backgroundImage = `url(${draftServerBannerUrl})`;
    preview.textContent = '';
  } catch (err) {}
});

const btnRegenInvite = document.getElementById('btn-settings-regen-invite');
if (btnRegenInvite) {
  btnRegenInvite.addEventListener('click', () => {
    const newCode = 'VOX-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    document.getElementById('settings-invite-code-input').value = newCode;
  });
}

document.getElementById('save-server-overview-btn').addEventListener('click', () => {
  const name = document.getElementById('settings-overview-name').value.trim();
  const inviteCode = document.getElementById('settings-invite-code-input').value.trim();
  const isDevOrCreator = Boolean(currentUser && currentUser.globalBadges && (
    currentUser.globalBadges.includes('PROJECT_OWNER') ||
    currentUser.globalBadges.includes('CREATOR') ||
    currentUser.globalBadges.includes('DEVELOPER')
  ));

  const payload = {
    serverId: currentServerId,
    name,
    iconUrl: draftServerIconUrl,
    bannerUrl: draftServerBannerUrl,
    inviteCode
  };

  const isOfficialCheck = document.getElementById('settings-is-official-checkbox');
  if (isDevOrCreator && isOfficialCheck) {
    payload.isOfficial = isOfficialCheck.checked;
  }

  socket.emit('update-server-overview', payload);
  closeModal('server-settings-modal');
});

// =========================================
// SERVER INVITES & JOIN SYSTEM
// =========================================
window.joinServerFromInviteCard = function(code) {
  if (!code) return;
  socket.emit('join-server-code', { code });
};

const menuInvitePeople = document.getElementById('menu-invite-people');
if (menuInvitePeople) {
  menuInvitePeople.addEventListener('click', () => {
    openServerInviteModal();
  });
}

function openServerInviteModal() {
  const srv = getCurrentServer();
  if (!srv) return;

  const modal = document.getElementById('server-invite-modal');
  const nameEl = document.getElementById('invite-server-name');
  const countEl = document.getElementById('invite-server-members-count');
  const avatarEl = document.getElementById('invite-server-avatar');
  const badgeEl = document.getElementById('invite-server-official-badge');
  const codeInput = document.getElementById('invite-code-display');
  const friendsList = document.getElementById('invite-dm-friends-list');

  nameEl.textContent = srv.name;
  countEl.textContent = `${Object.keys(srv.memberRoles || {}).length} Member(s)`;
  if (badgeEl) badgeEl.style.display = srv.isOfficial ? 'inline-flex' : 'none';

  if (srv.iconUrl) {
    avatarEl.style.backgroundImage = `url("${srv.iconUrl}")`;
    avatarEl.textContent = '';
  } else {
    avatarEl.style.backgroundImage = 'none';
    avatarEl.textContent = srv.icon || srv.name.substring(0, 2).toUpperCase();
  }

  codeInput.value = srv.inviteCode || 'VOXLINK';

  friendsList.innerHTML = '';
  accountsMap.forEach(acc => {
    if (currentUser && acc.id === currentUser.id) return;
    const item = document.createElement('div');
    item.className = 'invite-friend-item';

    const avatarStyle = acc.avatarUrl ? `background-image: url('${acc.avatarUrl}'); background-color: transparent;` : `background-color: ${acc.color || '#5865F2'};`;

    item.innerHTML = `
      <div class="invite-friend-left">
        <div class="invite-friend-avatar" style="${avatarStyle}">
          ${acc.avatarUrl ? '' : acc.username.substring(0, 1).toUpperCase()}
        </div>
        <span class="invite-friend-name">${escapeHTML(acc.username)}</span>
      </div>
      <button type="button" class="btn-invite-send">Invite</button>
    `;

    const sendBtn = item.querySelector('.btn-invite-send');
    sendBtn.onclick = () => {
      socket.emit('send-server-invite-dm', { serverId: srv.id, targetUserId: acc.id });
      sendBtn.textContent = 'Sent ✓';
      sendBtn.classList.add('sent');
      showToast(`Invite sent to @${acc.username}! ✉️`, 'success');
    };

    friendsList.appendChild(item);
  });

  modal.style.display = 'flex';
}

const btnCopyInvite = document.getElementById('btn-copy-invite-code');
if (btnCopyInvite) {
  btnCopyInvite.addEventListener('click', () => {
    const code = document.getElementById('invite-code-display').value;
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        showToast('Invite code copied to clipboard! 📋', 'success');
      });
    }
  });
}

document.getElementById('delete-server-btn').addEventListener('click', async () => {
  const srv = getCurrentServer();
  if (!srv) return;
  const ok = await showConfirmDialog({
    title: 'Delete Server',
    description: `Are you absolutely sure you want to permanently delete "${srv.name}"? This action cannot be undone and will delete all channels and messages.`,
    confirmText: 'Delete Server',
    isDanger: true,
    icon: '💣'
  });
  if (ok) {
    socket.emit('delete-server', { serverId: currentServerId });
    closeModal('server-settings-modal');
  }
});

// Settings Tab Switcher
document.querySelectorAll('.settings-tab-item').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab-item').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.getAttribute('data-tab');

    document.getElementById('tab-overview').style.display = target === 'tab-overview' ? 'flex' : 'none';
    document.getElementById('tab-roles').style.display = target === 'tab-roles' ? 'flex' : 'none';
    document.getElementById('tab-bans').style.display = target === 'tab-bans' ? 'flex' : 'none';

    if (target === 'tab-roles') document.getElementById('settings-tab-heading').textContent = 'Server Roles & Permissions';
    else if (target === 'tab-bans') document.getElementById('settings-tab-heading').textContent = 'Server Bans';
    else document.getElementById('settings-tab-heading').textContent = 'Server Overview';
  });
});

function renderBansTab() {
  const srv = getCurrentServer();
  if (!srv) return;
  const container = document.getElementById('bans-list-container');
  container.innerHTML = '';

  if (!srv.bans || srv.bans.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 13px;">No banned members on this server.</div>';
    return;
  }

  srv.bans.forEach(ban => {
    const card = document.createElement('div');
    card.className = 'ban-row-card';
    card.innerHTML = `
      <div>
        <div class="ban-user-name">${ban.username}</div>
        <div class="ban-user-reason">${ban.reason}</div>
      </div>
      <button class="btn-secondary" style="font-size: 12px; padding: 4px 10px;">Unban</button>
    `;
    card.querySelector('button').onclick = () => {
      socket.emit('unban-user', { serverId: srv.id, targetId: ban.userId });
    };
    container.appendChild(card);
  });
}

// Roles Tab Manager
function renderRolesManager() {
  const srv = getCurrentServer();
  if (!srv) return;

  const rolesItemsList = document.getElementById('roles-items-list');
  rolesItemsList.innerHTML = '';
  const sortedRoles = [...srv.roles].sort((a,b) => b.position - a.position);

  sortedRoles.forEach(role => {
    const item = document.createElement('div');
    item.className = `role-sidebar-item ${selectedRoleId === role.id ? 'active' : ''}`;
    item.innerHTML = `
      <div class="role-color-dot" style="background-color: ${role.color};"></div>
      <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${role.badge ? role.badge + ' ' : ''}${role.name}</span>
    `;
    item.onclick = () => selectRoleForEditing(role);
    rolesItemsList.appendChild(item);
  });

  if (!selectedRoleId && sortedRoles.length > 0) selectRoleForEditing(sortedRoles[0]);
  else if (selectedRoleId) {
    const existing = srv.roles.find(r => r.id === selectedRoleId);
    if (existing) selectRoleForEditing(existing);
    else if (sortedRoles.length > 0) selectRoleForEditing(sortedRoles[0]);
  }
}

function selectRoleForEditing(role) {
  selectedRoleId = role.id;
  document.querySelectorAll('.role-sidebar-item').forEach(el => el.classList.remove('active'));

  document.getElementById('role-editor-empty').style.display = 'none';
  const form = document.getElementById('role-editor-form');
  form.style.display = 'block';

  document.getElementById('edit-role-id').value = role.id;
  document.getElementById('edit-role-name').value = role.name;
  document.getElementById('edit-role-color').value = role.color.startsWith('#') ? role.color : '#949BA4';
  document.getElementById('edit-role-badge').value = role.badge || '';

  const checklist = document.getElementById('permissions-checklist');
  checklist.innerHTML = '';

  permissionsList.forEach(perm => {
    const isChecked = role.permissions.includes('ALL') || role.permissions.includes(perm.id);
    const row = document.createElement('div');
    row.className = 'perm-toggle-row';
    row.innerHTML = `
      <div class="perm-info"><span class="perm-title">${perm.label}</span></div>
      <input type="checkbox" class="perm-checkbox" data-perm="${perm.id}" ${isChecked ? 'checked' : ''} ${role.permissions.includes('ALL') ? 'disabled' : ''}>
    `;
    checklist.appendChild(row);
  });
}

document.getElementById('add-role-btn').addEventListener('click', () => {
  const srv = getCurrentServer();
  if (!srv) return;
  socket.emit('create-role', {
    serverId: srv.id,
    name: 'New Role',
    color: '#949BA4',
    badge: '⭐',
    permissions: ['SEND_MESSAGES', 'CONNECT_VOICE']
  });
});

document.getElementById('role-editor-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const srv = getCurrentServer();
  if (!srv || !selectedRoleId) return;

  const name = document.getElementById('edit-role-name').value.trim();
  const color = document.getElementById('edit-role-color').value;
  const badge = document.getElementById('edit-role-badge').value.trim();

  const selectedPerms = [];
  document.querySelectorAll('.perm-checkbox:checked').forEach(cb => {
    selectedPerms.push(cb.getAttribute('data-perm'));
  });

  socket.emit('edit-role', { serverId: srv.id, roleId: selectedRoleId, name, color, badge, permissions: selectedPerms });
});

document.getElementById('delete-role-btn').addEventListener('click', async () => {
  const srv = getCurrentServer();
  if (!srv || !selectedRoleId) return;
  const role = srv.roles.find(r => r.id === selectedRoleId);
  const ok = await showConfirmDialog({
    title: 'Delete Role',
    description: `Are you sure you want to delete the role "${role ? role.name : 'this role'}"? Members with this role will lose its permissions.`,
    confirmText: 'Delete Role',
    isDanger: true,
    icon: '🛡️'
  });
  if (ok) {
    socket.emit('delete-role', { serverId: srv.id, roleId: selectedRoleId });
    selectedRoleId = null;
  }
});

function renderMemberListBadgeHTML(badges) {
  if (badges && (badges.includes('PROJECT_OWNER') || badges.includes('CREATOR'))) {
    return `<span class="badge-creator" title="Creator of VoxLink">👑 Creator</span>`;
  }
  return '';
}

// =========================================
// 5. MEMBERS LIST (CLEAN DISCORD ROSTERS WITH AVATARS)
// =========================================
function renderMembers() {
  if (currentView === 'dms') {
    if (activeDmPeerId) {
      const isGroup = Boolean(String(activeDmPeerId).startsWith('grp_'));
      if (isGroup && currentDmGroupMeta) {
        renderDmGroupSidebar(currentDmGroupMeta, currentDmGroupMembers);
      } else if (currentDmPeerMeta) {
        renderDmUserProfileSidebar(currentDmPeerMeta);
      }
    } else {
      const titleEl = document.querySelector('.members-sidebar-title');
      if (titleEl) titleEl.textContent = 'Direct Messages';
      membersList.innerHTML = '<div style="padding: 24px 16px; color: var(--text-muted); font-size: 13px; text-align: center;">Select a conversation to view details.</div>';
    }
    return;
  }

  const titleEl = document.querySelector('.members-sidebar-title');
  if (titleEl) titleEl.textContent = 'Server Members';

  const srv = getCurrentServer();
  if (!srv) return;

  membersList.innerHTML = '';

  const sortedRoles = [...srv.roles].sort((a,b) => b.position - a.position);
  const groups = new Map();
  sortedRoles.forEach(r => groups.set(r.id, []));

  // Partition members into their highest role ONLY
  for (const uid in srv.memberRoles) {
    const rIds = srv.memberRoles[uid];
    const topRole = sortedRoles.find(r => rIds.includes(r.id)) || sortedRoles[sortedRoles.length - 1];
    if (topRole) groups.get(topRole.id).push(uid);
  }

  sortedRoles.forEach(role => {
    const memberIds = groups.get(role.id);
    if (!memberIds || memberIds.length === 0) return;

    // Clean section header
    const groupHeader = document.createElement('div');
    groupHeader.className = 'member-role-group-header';
    groupHeader.textContent = `${role.badge ? role.badge + ' ' : ''}${role.name} — ${memberIds.length}`;
    membersList.appendChild(groupHeader);

    memberIds.forEach(uid => {
      const isSelf = currentUser && uid === currentUser.id;
      const account = isSelf ? currentUser : (accountsMap.get(uid) || null);
      const uname = account ? account.username : (isSelf ? currentUser.username : 'User_' + uid.substring(0, 4));
      const uColor = role.color !== '#949BA4' ? role.color : (account ? account.color : '#5865F2');
      const uAvatar = account ? account.avatarUrl : null;
      const isOnline = liveUserIds.has(uid);
      const uStatus = isOnline ? (account && account.customStatus ? account.customStatus : 'Online') : 'Offline';
      const uBadges = account ? (account.globalBadges || []) : [];

      const item = document.createElement('div');
      item.className = 'member-item';
      item.innerHTML = `
        <div class="member-avatar">
          <div class="status-dot ${isOnline ? 'online' : 'offline'}"></div>
        </div>
        <div class="member-info">
          <div class="member-name" style="color: ${uColor};">
            ${escapeHTML(uname)}
            ${renderMemberListBadgeHTML(uBadges)}
          </div>
          <div class="member-status-sub">${escapeHTML(uStatus)}</div>
        </div>
      `;

      const avatarEl = item.querySelector('.member-avatar');
      if (uAvatar) {
        avatarEl.style.backgroundImage = `url("${uAvatar}")`;
        avatarEl.style.backgroundColor = 'transparent';
      } else {
        avatarEl.style.backgroundImage = 'none';
        avatarEl.style.backgroundColor = uColor;
        const letterSpan = document.createElement('span');
        letterSpan.textContent = uname.substring(0, 1).toUpperCase();
        avatarEl.insertBefore(letterSpan, avatarEl.firstChild);
      }

      item.oncontextmenu = (e) => {
        e.preventDefault();
        showMemberContextMenu({ id: uid, username: uname }, e.clientX, e.clientY);
      };
      item.onclick = (e) => {
        openUserProfileCard({ id: uid, username: uname, color: uColor, avatarUrl: uAvatar, customStatus: uStatus, globalBadges: uBadges });
      };

      membersList.appendChild(item);
    });
  });
  updateP2PCardsSenderPresence();
}

function showMemberContextMenu(user, x, y) {
  contextTargetUser = user;
  const srv = getCurrentServer();
  if (!srv) return;

  userContextMenu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  userContextMenu.style.top = `${Math.min(y, window.innerHeight - 260)}px`;
  userContextMenu.style.display = 'block';

  const isPlatformOwner = currentUser && currentUser.globalBadges && (currentUser.globalBadges.includes('PROJECT_OWNER') || currentUser.globalBadges.includes('CREATOR'));
  ctxGlobalDivider.style.display = isPlatformOwner ? 'block' : 'none';
  ctxGlobalLabel.style.display = isPlatformOwner ? 'block' : 'none';
  ctxToggleDev.style.display = isPlatformOwner ? 'block' : 'none';

  ctxRolesList.innerHTML = '';
  const userCurrentRoles = srv.memberRoles[user.id] || [];

  srv.roles.forEach(role => {
    const isAssigned = userCurrentRoles.includes(role.id);
    const row = document.createElement('div');
    row.className = 'ctx-role-checkbox-item';
    row.innerHTML = `
      <input type="checkbox" ${isAssigned ? 'checked' : ''} style="cursor: pointer;">
      <span style="color: ${role.color}; font-weight: 600;">${role.badge ? role.badge + ' ' : ''}${role.name}</span>
    `;
    row.onclick = (e) => {
      e.stopPropagation();
      socket.emit('toggle-user-role', { serverId: srv.id, targetId: user.id, roleId: role.id });
    };
    ctxRolesList.appendChild(row);
  });
}

ctxToggleDev.addEventListener('click', () => {
  if (contextTargetUser) {
    socket.emit('toggle-global-badge', { targetUserId: contextTargetUser.id, badge: 'DEVELOPER' });
  }
});

ctxSendDm.addEventListener('click', () => {
  if (contextTargetUser) openDmWithUser(contextTargetUser);
});

ctxKick.addEventListener('click', async () => {
  if (!contextTargetUser) return;
  const ok = await showConfirmDialog({
    title: 'Kick Member',
    description: `Are you sure you want to kick @${contextTargetUser.username} from the server? They can rejoin with an invite link.`,
    confirmText: 'Kick Member',
    isDanger: true,
    icon: '👢'
  });
  if (ok) {
    socket.emit('kick-user', { serverId: currentServerId, targetId: contextTargetUser.id });
  }
});

ctxBan.addEventListener('click', () => {
  if (contextTargetUser) {
    const reason = prompt(`Enter ban reason for ${contextTargetUser.username}:`, 'Violating server rules');
    if (reason !== null) {
      socket.emit('ban-user', { serverId: currentServerId, targetId: contextTargetUser.id, reason });
    }
  }
});

// =========================================
// 5b. INTERACTIVE USER PROFILE CARD MODAL
// =========================================
window.openUserProfileCard = function(userBrief) {
  if (!userBrief || !userBrief.id) return;
  const isSelf = currentUser && currentUser.id === userBrief.id;
  const fullAccount = isSelf ? currentUser : (accountsMap.get(userBrief.id) || userBrief);
  const isOnline = liveUserIds.has(userBrief.id);
  activeProfileUser = fullAccount;

  const modal = document.getElementById('user-profile-panel-modal');
  const bannerEl = document.getElementById('pcard-banner');
  const avatarEl = document.getElementById('pcard-avatar');
  const statusDot = document.getElementById('pcard-status-dot');
  const usernameEl = document.getElementById('pcard-username');
  const badgesEl = document.getElementById('pcard-badges');
  const statusEl = document.getElementById('pcard-status');
  const bioEl = document.getElementById('pcard-bio');
  const rolesListEl = document.getElementById('pcard-roles-list');
  const modSectionEl = document.getElementById('pcard-mod-section');

  const btnEdit = document.getElementById('pcard-btn-edit');
  const btnDm = document.getElementById('pcard-btn-dm');
  const btnFriend = document.getElementById('pcard-btn-friend');
  const btnMute = document.getElementById('pcard-btn-mute');
  const btnBlock = document.getElementById('pcard-btn-block');

  // 1. Banner
  if (fullAccount.bannerUrl) {
    bannerEl.style.backgroundImage = `url("${fullAccount.bannerUrl}")`;
    bannerEl.style.backgroundColor = fullAccount.bannerColor || 'var(--brand-blurple)';
  } else {
    bannerEl.style.backgroundImage = 'none';
    bannerEl.style.backgroundColor = fullAccount.bannerColor || 'var(--brand-blurple)';
  }

  // 2. Avatar & Status Dot
  if (fullAccount.avatarUrl) {
    avatarEl.style.backgroundImage = `url("${fullAccount.avatarUrl}")`;
    avatarEl.style.backgroundColor = 'transparent';
    avatarEl.textContent = '';
  } else {
    avatarEl.style.backgroundImage = 'none';
    avatarEl.textContent = (fullAccount.username || 'U').substring(0, 1).toUpperCase();
    avatarEl.style.backgroundColor = fullAccount.color || '#5865F2';
  }
  statusDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;

  // 3. Username, Badges, Status, Bio
  usernameEl.textContent = fullAccount.username || 'User';
  badgesEl.innerHTML = renderGlobalBadgesHTML(fullAccount.globalBadges);
  statusEl.textContent = fullAccount.customStatus || (isOnline ? 'Online' : 'Offline');
  bioEl.textContent = fullAccount.bio || 'No bio provided.';

  // 4. Action Buttons (Edit, Friend, Mute, Block, DM)
  if (isSelf) {
    if (btnEdit) {
      btnEdit.style.display = 'inline-block';
      btnEdit.onclick = () => {
        closeModal('user-profile-panel-modal');
        openUserSettingsModal();
      };
    }
    btnDm.style.display = 'none';
    btnFriend.style.display = 'none';
    btnMute.style.display = 'none';
    btnBlock.style.display = 'none';
  } else {
    if (btnEdit) btnEdit.style.display = 'none';
    btnDm.style.display = 'inline-block';
    btnFriend.style.display = 'inline-block';
    btnMute.style.display = 'inline-block';
    btnBlock.style.display = 'inline-block';

    const isFriend = friendsSet.has(userBrief.id);
    btnFriend.textContent = isFriend ? '✓ Friends' : '👥 Add Friend';
    btnFriend.classList.toggle('active', isFriend);

    const isMuted = mutedUsersSet.has(userBrief.id);
    btnMute.textContent = isMuted ? '🔊 Unmute' : '🔇 Mute';
    btnMute.classList.toggle('active', isMuted);

    const isBlocked = blockedUsersSet.has(userBrief.id);
    btnBlock.textContent = isBlocked ? 'Unblock' : '🚫 Block';
    btnBlock.classList.toggle('active', isBlocked);

    btnDm.onclick = () => {
      closeModal('user-profile-panel-modal');
      openDmWithUser(fullAccount);
    };

    btnFriend.onclick = () => {
      if (friendsSet.has(userBrief.id)) {
        socket.emit('remove-friend', { friendId: userBrief.id });
        friendsSet.delete(userBrief.id);
        btnFriend.textContent = '👥 Add Friend';
        btnFriend.classList.remove('active');
      } else {
        socket.emit('send-friend-request', { username: fullAccount.username });
        btnFriend.textContent = '📨 Requested';
        btnFriend.classList.add('active');
      }
    };

    btnMute.onclick = () => {
      if (mutedUsersSet.has(userBrief.id)) {
        mutedUsersSet.delete(userBrief.id);
        btnMute.textContent = '🔇 Mute';
        btnMute.classList.remove('active');
      } else {
        mutedUsersSet.add(userBrief.id);
        btnMute.textContent = '🔊 Unmute';
        btnMute.classList.add('active');
      }
    };

    btnBlock.onclick = () => {
      if (blockedUsersSet.has(userBrief.id)) {
        blockedUsersSet.delete(userBrief.id);
        btnBlock.textContent = '🚫 Block';
        btnBlock.classList.remove('active');
      } else {
        blockedUsersSet.add(userBrief.id);
        btnBlock.textContent = 'Unblock';
        btnBlock.classList.add('active');
      }
    };
  }

  // 5. Server Roles & Permissions
  const srv = getCurrentServer();
  rolesListEl.innerHTML = '';
  if (srv) {
    const userRoles = srv.memberRoles[userBrief.id] || [];
    const canManageRoles = currentUser && (
      srv.ownerId === currentUser.id ||
      (currentUser.globalBadges && (currentUser.globalBadges.includes('PROJECT_OWNER') || currentUser.globalBadges.includes('CREATOR')))
    );

    if (srv.roles && srv.roles.length > 0) {
      srv.roles.forEach(role => {
        const hasRole = userRoles.includes(role.id);
        if (!canManageRoles && !hasRole) return;

        const chip = document.createElement('div');
        chip.className = 'profile-role-chip';
        chip.style.borderColor = role.color;
        chip.innerHTML = `
          <div class="profile-role-dot" style="background-color: ${role.color};"></div>
          <span style="color: ${role.color}; font-weight: 600;">${role.badge ? role.badge + ' ' : ''}${escapeHTML(role.name)}</span>
          ${canManageRoles && !isSelf ? `
            <input type="checkbox" ${hasRole ? 'checked' : ''} style="cursor: pointer; margin-left: 6px;" title="Assign/Unassign Role">
          ` : ''}
        `;

        if (canManageRoles && !isSelf) {
          const chk = chip.querySelector('input');
          if (chk) {
            chk.onchange = (e) => {
              e.stopPropagation();
              socket.emit('toggle-user-role', { serverId: srv.id, targetId: userBrief.id, roleId: role.id });
            };
          }
        }
        rolesListEl.appendChild(chip);
      });
    }

    if (rolesListEl.children.length === 0) {
      rolesListEl.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">No roles assigned.</span>';
    }

    // 6. Moderation Controls
    const canModerate = currentUser && !isSelf && (
      srv.ownerId === currentUser.id ||
      (currentUser.globalBadges && (currentUser.globalBadges.includes('PROJECT_OWNER') || currentUser.globalBadges.includes('CREATOR')))
    );

    if (canModerate) {
      modSectionEl.style.display = 'block';
      const kickBtn = document.getElementById('pcard-btn-kick');
      const banBtn = document.getElementById('pcard-btn-ban');

      kickBtn.onclick = async () => {
        const ok = await showConfirmDialog({
          title: 'Kick Member',
          description: `Are you sure you want to kick ${fullAccount.username} from ${srv.name}?`,
          confirmText: 'Kick Member',
          isDanger: true,
          icon: '👢'
        });
        if (ok) {
          socket.emit('kick-user', { serverId: srv.id, targetId: userBrief.id });
          closeModal('user-profile-panel-modal');
        }
      };

      banBtn.onclick = () => {
        const reason = prompt(`Enter ban reason for ${fullAccount.username}:`, 'Violating server rules');
        if (reason !== null) {
          socket.emit('ban-user', { serverId: srv.id, targetId: userBrief.id, reason });
          closeModal('user-profile-panel-modal');
        }
      };
    } else {
      modSectionEl.style.display = 'none';
    }
  } else {
    modSectionEl.style.display = 'none';
  }

  modal.style.display = 'flex';
};

// =========================================
// 6. CHAT & DISCORD CODE BLOCKS PARSER
// =========================================
function formatDiscordMarkdown(text) {
  if (!text) return '';

  // 1. Triple backtick code blocks ```lang ... ```
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let formatted = text.replace(codeBlockRegex, (match, lang, code) => {
    const cleanLang = (lang || 'CODE').toUpperCase();
    const escaped = escapeHTML(code.trim());
    return `<div class="discord-code-block"><div class="code-block-header"><span>${cleanLang}</span><button type="button" class="code-copy-btn" onclick="copyCode(this)">Copy</button></div><pre><code>${escaped}</code></pre></div>`;
  });

  // 2. Single backtick inline code `code`
  formatted = formatted.replace(/`([^`]+)`/g, (match, inline) => {
    return `<code class="discord-inline-code">${escapeHTML(inline)}</code>`;
  });

  // 3. Normal text breaks
  formatted = formatted.replace(/\n/g, '<br>');
  return formatted;
}

window.copyCode = function(btn) {
  const codeEl = btn.closest('.discord-code-block').querySelector('code');
  if (codeEl) {
    navigator.clipboard.writeText(codeEl.innerText).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
  }
};

function renderReactionsHTML(msgId, reactions) {
  if (!reactions || Object.keys(reactions).length === 0) return '';
  let html = '';
  for (const [emoji, users] of Object.entries(reactions)) {
    if (!users || users.length === 0) continue;
    const hasReacted = currentUser && users.includes(currentUser.id);
    html += `
      <button type="button" class="reaction-chip ${hasReacted ? 'active' : ''}" onclick="toggleReaction('${msgId}', '${emoji}')" title="${users.length} reaction${users.length > 1 ? 's' : ''}">
        <span>${emoji}</span>
        <span class="chip-count">${users.length}</span>
      </button>
    `;
  }
  return html;
}

// =========================================================
// PEER-TO-PEER (P2P) LARGE FILE TRANSFER ENGINE (WEBRTC)
// =========================================================

function getP2PFileEmoji(filename) {
  if (!filename) return '📦';
  const ext = filename.split('.').pop().toLowerCase();
  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) return '🎵';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'bz2', '7zip'].includes(ext)) return '📦';
  if (['exe', 'msi', 'dmg', 'appimage', 'deb', 'rpm'].includes(ext)) return '💻';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
  if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'csv', 'xlsx'].includes(ext)) return '📄';
  if (['js', 'ts', 'py', 'rs', 'c', 'cpp', 'java', 'html', 'css', 'json'].includes(ext)) return '💻';
  return '📁';
}

function updateP2PProgress(transferId, text, percent, speedText) {
  const tray = document.getElementById('p2p-tray-' + transferId);
  const bar = document.getElementById('p2p-bar-' + transferId);
  const textEl = document.getElementById('p2p-prog-text-' + transferId);
  const speedEl = document.getElementById('p2p-prog-speed-' + transferId);

  if (tray) tray.style.display = 'flex';
  if (bar) bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
  if (textEl) textEl.textContent = text;
  if (speedEl) speedEl.textContent = speedText || '';
}

function resetP2PCard(transferId) {
  const btn = document.getElementById('p2p-btn-' + transferId);
  if (btn) {
    btn.disabled = false;
    btn.classList.remove('downloading');
    btn.innerHTML = '<span>⬇️</span> <span>Download</span>';
  }
  const tray = document.getElementById('p2p-tray-' + transferId);
  if (tray) tray.style.display = 'none';
}

function updateP2PCardsSenderPresence() {
  document.querySelectorAll('.p2p-file-card').forEach(card => {
    const transferId = card.id.replace('p2p-card-', '');
    const badge = document.getElementById('p2p-badge-' + transferId);
    const btn = document.getElementById('p2p-btn-' + transferId);
    const row = card.closest('.message-row');
    if (!badge || !row) return;

    const senderId = row.getAttribute('data-sender-id');
    const isSelf = currentUser && senderId === currentUser.id;
    const isHosted = activeP2PFiles.has(transferId);
    const isOnline = isSelf || liveUserIds.has(senderId);

    if (isSelf) {
      badge.className = 'p2p-host-badge ' + (isHosted ? 'online' : 'offline');
      badge.textContent = isHosted ? '🟢 Seeding File' : '🟡 Offline';
    } else {
      badge.className = 'p2p-host-badge ' + (isOnline ? 'online' : 'offline');
      badge.textContent = isOnline ? '🟢 Sender Online' : '⚪ Sender Offline';
      if (btn && !btn.classList.contains('downloading')) {
        btn.disabled = !isOnline;
        btn.title = isOnline ? 'Download via P2P' : 'Sender is offline';
      }
    }
  });
}

function renderP2PFileCardHTML(p2p) {
  if (!p2p) return '';
  const fileIcon = getP2PFileEmoji(p2p.name);
  const isHostedLocally = activeP2PFiles.has(p2p.transferId);
  const isHostOnline = isHostedLocally || liveUserIds.has(p2p.senderId);

  const hostBadgeClass = isHostedLocally ? 'online' : (isHostOnline ? 'online' : 'offline');
  const hostBadgeText = isHostedLocally 
    ? '🟢 Hosting in this window' 
    : (isHostOnline ? '🟢 Host Online' : '⚪ Host Offline');

  const safeName = escapeHTML(p2p.name);
  const jsSafeName = p2p.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const jsSafeType = (p2p.type || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeSocketId = (p2p.senderSocketId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  return `
    <div class="p2p-file-card" id="p2p-card-${p2p.transferId}">
      <div class="p2p-card-header">
        <div class="p2p-file-icon-box">${fileIcon}</div>
        <div class="p2p-file-main-info">
          <div class="p2p-file-title" title="${safeName}">${safeName}</div>
          <div class="p2p-file-sub-meta">
            <span class="p2p-size-tag">${formatBytes(p2p.size)}</span>
            <span class="p2p-speed-pill">⚡ Direct P2P Download</span>
            <span class="p2p-host-badge ${hostBadgeClass}" id="p2p-badge-${p2p.transferId}">
              ${hostBadgeText}
            </span>
          </div>
        </div>
        <div class="p2p-card-action">
          ${isHostedLocally ? `
            <button type="button" class="p2p-action-btn host-status-btn seeding" disabled title="You are hosting and seeding this file from this browser window">
              <span>📡 Seeding</span>
            </button>
          ` : `
            <button type="button" class="p2p-action-btn download-btn" id="p2p-btn-${p2p.transferId}" onclick="startP2PDownload('${p2p.transferId}', '${p2p.senderId}', '${safeSocketId}', '${jsSafeName}', ${p2p.size}, '${jsSafeType}')" ${!isHostOnline ? 'disabled title="Host is currently offline"' : ''}>
              <span>⬇️</span> <span>Download</span>
            </button>
          `}
        </div>
      </div>
      <div class="p2p-progress-tray" id="p2p-tray-${p2p.transferId}" style="display: none;">
        <div class="p2p-progress-track">
          <div class="p2p-progress-bar" id="p2p-bar-${p2p.transferId}"></div>
        </div>
        <div class="p2p-progress-labels">
          <span id="p2p-prog-text-${p2p.transferId}">Connecting P2P...</span>
          <span id="p2p-prog-speed-${p2p.transferId}">0 KB/s</span>
        </div>
      </div>
    </div>
  `;
}

async function startP2PDownload(transferId, senderId, senderSocketId, fileName, fileSize, mimeType) {
  if (activeP2PFiles.has(transferId)) {
    showToast('This browser window is actively hosting this file.', 'info');
    return;
  }

  if (!liveUserIds.has(senderId) && !senderSocketId) {
    showToast('The host is currently offline. P2P transfers require the sender to be online.', 'warning');
    return;
  }

  // Direct disk streaming via File System Access API for multi-gigabyte files (zero RAM footprint)
  let writableStream = null;
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: fileName
      });
      writableStream = await fileHandle.createWritable();
    } catch (err) {
      if (err.name === 'AbortError') {
        // User clicked Cancel in the file picker dialog
        return;
      }
      console.warn('showSaveFilePicker unavailable or failed, falling back to memory chunks', err);
    }
  } else if (fileSize > 1.5 * 1024 * 1024 * 1024) {
    showToast('Note: For large files (> 1.5GB), Chrome, Edge or VoxLink Desktop is recommended for streaming to disk.', 'info');
  }

  const btn = document.getElementById('p2p-btn-' + transferId);
  if (btn) {
    btn.disabled = true;
    btn.classList.add('downloading');
    btn.innerHTML = '<span>⚡</span> <span>Connecting...</span>';
  }
  updateP2PProgress(transferId, 'Initiating WebRTC direct link...', 2, 'Negotiating');

  try {
    const pc = new RTCPeerConnection(rtcConfig);
    const dc = pc.createDataChannel('p2p_' + transferId, { ordered: true });
    dc.binaryType = 'arraybuffer';

    activeDownloaderTransfers.set(transferId, {
      pc,
      dc,
      senderId,
      senderSocketId,
      fileName,
      fileSize,
      mimeType,
      writableStream,
      chunks: [],
      receivedBytes: 0,
      startTime: 0
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('p2p-file-signal', {
          targetId: senderId,
          targetSocketId: senderSocketId || null,
          transferId,
          type: 'ice',
          data: e.candidate
        });
      }
    };

    dc.onopen = () => {
      updateP2PProgress(transferId, 'Connected! Requesting data stream...', 5, '');
      dc.send(JSON.stringify({ action: 'request-file', transferId }));
    };

    dc.onclose = () => {
      console.log('P2P DataChannel closed for', transferId);
    };

    dc.onerror = (err) => {
      console.error('P2P DataChannel error:', err);
      showToast('P2P connection error during file transfer.', 'error');
      resetP2PCard(transferId);
    };

    dc.onmessage = (event) => {
      handleDownloaderMessage(transferId, event);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit('p2p-file-signal', {
      targetId: senderId,
      targetSocketId: senderSocketId || null,
      transferId,
      type: 'offer',
      data: offer
    });
  } catch (err) {
    console.error('Failed to initiate P2P download:', err);
    showToast('Failed to start P2P transfer: ' + err.message, 'error');
    resetP2PCard(transferId);
  }
}

async function handleP2PFileSignal(senderId, senderSocketId, transferId, type, data) {
  if (type === 'error') {
    showToast(data, 'warning');
    resetP2PCard(transferId);
    return;
  }

  // 1. Sender receives OFFER from a downloader
  if (type === 'offer') {
    const file = activeP2PFiles.get(transferId);
    if (!file) {
      socket.emit('p2p-file-signal', {
        targetId: senderId,
        targetSocketId: senderSocketId,
        transferId,
        type: 'error',
        data: 'This file is no longer available in the sender session.'
      });
      return;
    }

    try {
      const pc = new RTCPeerConnection(rtcConfig);
      const sessionKey = `${transferId}_${senderSocketId || senderId}`;
      activeSenderTransfers.set(sessionKey, { pc, file, receiverSocketId: senderSocketId });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('p2p-file-signal', {
            targetId: senderId,
            targetSocketId: senderSocketId,
            transferId,
            type: 'ice',
            data: e.candidate
          });
        }
      };

      pc.ondatachannel = (e) => {
        setupSenderDataChannel(e.channel, file, senderSocketId, transferId);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('p2p-file-signal', {
        targetId: senderId,
        targetSocketId: senderSocketId,
        transferId,
        type: 'answer',
        data: answer
      });
    } catch (err) {
      console.error('Failed to handle incoming P2P offer:', err);
    }
    return;
  }

  // 2. Downloader receives ANSWER from sender
  if (type === 'answer') {
    const transfer = activeDownloaderTransfers.get(transferId);
    if (transfer && transfer.pc) {
      try {
        await transfer.pc.setRemoteDescription(new RTCSessionDescription(data));
      } catch (err) {
        console.error('Failed to set remote description on answer:', err);
      }
    }
    return;
  }

  // 3. ICE candidate exchange
  if (type === 'ice') {
    const dlTransfer = activeDownloaderTransfers.get(transferId);
    if (dlTransfer && dlTransfer.pc) {
      dlTransfer.pc.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
      return;
    }
    const sessionKey = `${transferId}_${senderSocketId || senderId}`;
    const sendTransfer = activeSenderTransfers.get(sessionKey);
    if (sendTransfer && sendTransfer.pc) {
      sendTransfer.pc.addIceCandidate(new RTCIceCandidate(data)).catch(() => {});
    }
  }
}

function setupSenderDataChannel(channel, file, receiverSocketId, transferId) {
  channel.binaryType = 'arraybuffer';

  channel.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.action === 'request-file') {
        // Send initial metadata header
        channel.send(JSON.stringify({
          type: 'header',
          name: file.name,
          size: file.size,
          mime: file.type
        }));

        const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
        let offset = 0;
        channel.bufferedAmountLowThreshold = 512 * 1024;

        showToast(`⚡ Direct P2P streaming "${file.name}" to peer!`, 'info');

        while (offset < file.size) {
          if (channel.readyState !== 'open') return;

          if (channel.bufferedAmount > 1024 * 1024) {
            await new Promise(resolve => {
              channel.onbufferedamountlow = () => {
                channel.onbufferedamountlow = null;
                resolve();
              };
            });
            if (channel.readyState !== 'open') return;
          }

          const slice = file.slice(offset, offset + CHUNK_SIZE);
          offset += CHUNK_SIZE;
          const arrayBuf = await slice.arrayBuffer();
          if (channel.readyState !== 'open') return;
          channel.send(arrayBuf);
        }

        if (channel.readyState === 'open') {
          channel.send(JSON.stringify({ type: 'complete' }));
        }
      }
    } catch (err) {
      console.error('Error in sender DataChannel:', err);
    }
  };
}

async function handleDownloaderMessage(transferId, event) {
  const transfer = activeDownloaderTransfers.get(transferId);
  if (!transfer) return;

  if (typeof event.data === 'string') {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'header') {
        transfer.fileSize = msg.size;
        transfer.fileName = msg.name;
        transfer.mime = msg.mime;
        transfer.chunks = [];
        transfer.receivedBytes = 0;
        transfer.startTime = Date.now();
        updateP2PProgress(transferId, 'Receiving data stream...', 0, '0 KB/s');
      } else if (msg.type === 'complete') {
        if (transfer.writableStream) {
          try {
            await transfer.writableStream.close();
            transfer.writableStream = null;
          } catch (e) {
            console.error('Error closing disk stream:', e);
          }
          updateP2PProgress(transferId, '100% • Saved directly to disk! 🎉', 100, '');
          const btn = document.getElementById('p2p-btn-' + transferId);
          if (btn) {
            btn.disabled = false;
            btn.classList.remove('downloading');
            btn.innerHTML = '<span>✅</span> <span>Saved</span>';
          }
          showToast(`File "${transfer.fileName}" saved successfully to disk! 🚀`, 'success');
        } else {
          const blob = new Blob(transfer.chunks, { type: transfer.mime || 'application/octet-stream' });
          transfer.chunks = [];
          const downloadUrl = URL.createObjectURL(blob);

          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = transfer.fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          updateP2PProgress(transferId, 'Transfer 100% complete! File saved. 🎉', 100, '');

          const btn = document.getElementById('p2p-btn-' + transferId);
          if (btn) {
            btn.disabled = false;
            btn.classList.remove('downloading');
            btn.innerHTML = '<span>💾</span> <span>Save Again</span>';
            btn.onclick = () => {
              const a2 = document.createElement('a');
              a2.href = downloadUrl;
              a2.download = transfer.fileName;
              document.body.appendChild(a2);
              a2.click();
              document.body.removeChild(a2);
            };
          }

          showToast(`P2P file transfer completed: ${transfer.fileName}! 🚀`, 'success');
        }

        if (transfer.pc) {
          setTimeout(() => {
            try { transfer.pc.close(); } catch (e) {}
          }, 1500);
        }
      }
    } catch (e) {
      console.error(e);
    }
  } else if (event.data instanceof ArrayBuffer) {
    if (transfer.writableStream) {
      try {
        await transfer.writableStream.write(event.data);
      } catch (err) {
        console.error('Error writing chunk to disk stream:', err);
      }
    } else {
      transfer.chunks.push(event.data);
    }
    transfer.receivedBytes += event.data.byteLength;

    const total = transfer.fileSize || 1;
    const percent = Math.min(100, Math.round((transfer.receivedBytes / total) * 100));
    const elapsedSec = (Date.now() - (transfer.startTime || Date.now())) / 1000;
    const speed = elapsedSec > 0.1 ? (transfer.receivedBytes / elapsedSec) : 0;

    const progText = `${percent}% • ${formatBytes(transfer.receivedBytes)} / ${formatBytes(total)}`;
    const speedText = `${formatBytes(speed)}/s`;
    updateP2PProgress(transferId, progText, percent, speedText);
  }
}

function extractYouTubeLinks(text) {
  if (!text) return [];
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^\s&]+&)*v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)?/gi;
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m[1] && !matches.includes(m[1])) {
      matches.push(m[1]);
    }
  }
  return matches;
}

function extractSpotifyLinks(text) {
  if (!text) return [];
  const regex = /(?:https?:\/\/)?(?:open\.)?spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)(?:[^\s]*)?/gi;
  const matches = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    const type = m[1].toLowerCase();
    const id = m[2];
    const key = `${type}/${id}`;
    if (!matches.some(item => item.key === key)) {
      matches.push({ type, id, key });
    }
  }
  return matches;
}

function extractDirectMediaLinks(text) {
  if (!text) return { videoLinks: [], audioLinks: [] };
  const urlRegex = /(https?:\/\/[^\s<>'"]+)/gi;
  const videoLinks = [];
  const audioLinks = [];
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    const url = match[1];
    const cleanUrl = url.replace(/[.,!?)]+$/, '');
    if (/\.(mp4|webm|mov|mkv|m4v)(\?.*)?$/i.test(cleanUrl)) {
      if (!videoLinks.includes(cleanUrl)) videoLinks.push(cleanUrl);
    } else if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(cleanUrl)) {
      if (!audioLinks.includes(cleanUrl)) audioLinks.push(cleanUrl);
    }
  }
  return { videoLinks, audioLinks };
}

function renderMessage(msg) {
  const row = document.createElement('div');
  row.className = 'message-row';
  row.id = `msg-${msg.id}`;
  row.setAttribute('data-msg-id', msg.id);
  row.setAttribute('data-sender-id', msg.senderId);
  if (msg.channelId) row.setAttribute('data-channel-id', msg.channelId);
  if (msg.serverId) row.setAttribute('data-server-id', msg.serverId);

  const date = new Date(msg.timestamp);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isMsgSelf = currentUser && msg.senderId === currentUser.id;
  const msgSender = isMsgSelf ? currentUser : accountsMap.get(msg.senderId);
  const effectiveAvatar = (msgSender && msgSender.avatarUrl) || msg.avatarUrl;
  const avatarStyle = effectiveAvatar 
    ? `background-image: url("${effectiveAvatar}"); background-color: transparent; background-size: cover; background-position: center;` 
    : `background-color: ${msg.color};`;

  // 1. Reply Header Quote
  let replyHTML = '';
  if (msg.replyTo) {
    const rSnippet = msg.replyTo.text ? msg.replyTo.text.substring(0, 75) : '[Attachment]';
    replyHTML = `
      <div class="message-reply-preview" data-reply-sender-id="${msg.replyTo.senderId}" onclick="scrollToMessage('${msg.replyTo.id}')" title="Jump to message">
        <span class="message-reply-author">@${escapeHTML(msg.replyTo.username)}</span>
        <span class="message-reply-text">${escapeHTML(rSnippet)}</span>
      </div>
    `;
  }

  // 2. Extra Media (Attachments, Videos, Audio, YouTube, Voice Notes)
  let extraContentHTML = '';
  if (msg.attachment) {
    const isVideo = (msg.attachment.type && msg.attachment.type.startsWith('video/')) || /\.(mp4|webm|mov|mkv|m4v|avi|ogv)$/i.test(msg.attachment.name || '');
    const isAudio = (msg.attachment.type && msg.attachment.type.startsWith('audio/')) || /\.(mp3|wav|ogg|m4a|aac|flac|wma)$/i.test(msg.attachment.name || '');

    if (msg.attachment.type && msg.attachment.type.startsWith('image/')) {
      const cleanImgName = escapeHTML(msg.attachment.name || 'image.png');
      extraContentHTML += `
        <div style="margin-top: 6px;">
          <img src="${msg.attachment.dataUrl}" class="message-image-attachment chat-attachment-img" alt="${cleanImgName}" onclick="openImageLightbox('${msg.attachment.dataUrl}', '${cleanImgName}')">
        </div>
      `;
    } else if (isVideo) {
      const cleanVideoName = escapeHTML(msg.attachment.name || 'video.mp4');
      extraContentHTML += `
        <div class="message-media-embed video-embed">
          <video controls playsinline preload="metadata" class="chat-embedded-video" src="${msg.attachment.dataUrl}">
            Your browser does not support the video tag.
          </video>
          <div class="video-embed-footer">
            <span class="video-embed-name">🎬 ${cleanVideoName}</span>
            <a href="${msg.attachment.dataUrl}" download="${cleanVideoName}" class="media-download-link" title="Download Video">⬇️</a>
          </div>
        </div>
      `;
    } else if (isAudio) {
      const cleanAudioName = escapeHTML(msg.attachment.name || 'audio.mp3');
      const ext = (msg.attachment.name || 'mp3').split('.').pop().toUpperCase();
      extraContentHTML += `
        <div class="message-media-embed audio-embed">
          <div class="audio-embed-header">
            <div class="audio-icon-disc">🎵</div>
            <div class="audio-embed-meta">
              <span class="audio-embed-title">${cleanAudioName}</span>
              <span class="audio-embed-type">${ext} Audio Track</span>
            </div>
            <a href="${msg.attachment.dataUrl}" download="${cleanAudioName}" class="media-download-link" title="Download Audio">⬇️</a>
          </div>
          <audio controls preload="metadata" class="chat-embedded-audio" src="${msg.attachment.dataUrl}"></audio>
        </div>
      `;
    } else if (isCodeFile(msg.attachment.name, msg.attachment.type)) {
      const decodedCode = extractBase64Text(msg.attachment.dataUrl);
      if (decodedCode !== null) {
        extraContentHTML += `
          <div class="code-file-card" id="code-card-${msg.id}">
            <div class="code-file-header">
              <span class="code-file-name">📄 ${escapeHTML(msg.attachment.name)}</span>
              <div class="code-file-actions">
                <button type="button" class="code-file-btn" onclick="toggleCodeFilePreview('${msg.id}')">Preview Code ▾</button>
                <a href="${msg.attachment.dataUrl}" download="${escapeHTML(msg.attachment.name)}" class="code-file-btn">Download</a>
              </div>
            </div>
            <pre class="code-file-preview-body" id="code-preview-${msg.id}" style="display: none;"><code>${escapeHTML(decodedCode)}</code></pre>
          </div>
        `;
      } else {
        extraContentHTML += `
          <a href="${msg.attachment.dataUrl}" download="${escapeHTML(msg.attachment.name)}" class="message-file-chip">
            <span>📁</span>
            <span>${escapeHTML(msg.attachment.name)}</span>
          </a>
        `;
      }
    } else {
      extraContentHTML += `
        <a href="${msg.attachment.dataUrl}" download="${escapeHTML(msg.attachment.name)}" class="message-file-chip">
          <span>📁</span>
          <span>${escapeHTML(msg.attachment.name)}</span>
        </a>
      `;
    }
  }

  // YouTube Videos embedded in chat by link
  const ytVideoIds = extractYouTubeLinks(msg.text);
  ytVideoIds.slice(0, 3).forEach(ytId => {
    extraContentHTML += `
      <div class="message-media-embed youtube-embed">
        <iframe src="https://www.youtube.com/embed/${ytId}" 
                title="YouTube video player" 
                frameborder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                allowfullscreen 
                loading="lazy">
        </iframe>
      </div>
    `;
  });

  // Spotify Songs, Albums, Playlists & Podcasts embedded in chat by link
  const spotifyItems = extractSpotifyLinks(msg.text);
  spotifyItems.slice(0, 3).forEach(item => {
    const isSongOrEpisode = item.type === 'track' || item.type === 'episode';
    const embedHeight = isSongOrEpisode ? '152' : '352';
    extraContentHTML += `
      <div class="message-media-embed spotify-embed">
        <iframe src="https://open.spotify.com/embed/${item.type}/${item.id}?utm_source=generator&theme=0" 
                width="100%" 
                height="${embedHeight}" 
                frameborder="0" 
                allowfullscreen="" 
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
                loading="lazy">
        </iframe>
      </div>
    `;
  });

  // Direct video and audio links inside message text (if no attachment uploaded)
  if (!msg.attachment) {
    const { videoLinks, audioLinks } = extractDirectMediaLinks(msg.text);
    videoLinks.slice(0, 2).forEach(vUrl => {
      const filename = vUrl.split('/').pop().split('?')[0] || 'Video';
      extraContentHTML += `
        <div class="message-media-embed video-embed">
          <video controls playsinline preload="metadata" class="chat-embedded-video" src="${escapeHTML(vUrl)}">
            Your browser does not support the video tag.
          </video>
          <div class="video-embed-footer">
            <span class="video-embed-name">🎬 ${escapeHTML(filename)}</span>
            <a href="${escapeHTML(vUrl)}" target="_blank" rel="noopener noreferrer" class="media-download-link" title="Open Link">🔗</a>
          </div>
        </div>
      `;
    });
    audioLinks.slice(0, 2).forEach(aUrl => {
      const filename = aUrl.split('/').pop().split('?')[0] || 'Audio';
      const ext = filename.split('.').pop().toUpperCase() || 'MP3';
      extraContentHTML += `
        <div class="message-media-embed audio-embed">
          <div class="audio-embed-header">
            <div class="audio-icon-disc">🎵</div>
            <div class="audio-embed-meta">
              <span class="audio-embed-title">${escapeHTML(filename)}</span>
              <span class="audio-embed-type">${ext} Audio Stream</span>
            </div>
            <a href="${escapeHTML(aUrl)}" target="_blank" rel="noopener noreferrer" class="media-download-link" title="Open Link">🔗</a>
          </div>
          <audio controls preload="metadata" class="chat-embedded-audio" src="${escapeHTML(aUrl)}"></audio>
        </div>
      `;
    });
  }

  if (msg.p2pFile) {
    extraContentHTML += renderP2PFileCardHTML(msg.p2pFile);
  }

  if (msg.voiceNote) {
    const mins = String(Math.floor(msg.voiceNote.duration / 60)).padStart(2, '0');
    const secs = String(msg.voiceNote.duration % 60).padStart(2, '0');
    extraContentHTML += `
      <div class="voice-note-card">
        <button class="voice-note-play-btn" onclick="playVoiceNoteAudio('${msg.id}', this)">▶</button>
        <span class="voice-note-duration">${mins}:${secs}</span>
        <audio id="audio-${msg.id}" src="${msg.voiceNote.dataUrl}" onended="resetVoiceNotePlayBtn(this)"></audio>
      </div>
    `;
  }

  if (msg.serverInvite) {
    const inv = msg.serverInvite;
    const isOff = inv.isOfficial ? `<span class="server-official-badge" title="Verified Official Server">✓ Official</span>` : '';
    const iconStyle = inv.iconUrl ? `background-image: url('${inv.iconUrl}'); background-color: transparent;` : '';
    const iconFallback = inv.iconUrl ? '' : escapeHTML(inv.icon || inv.serverName.substring(0, 2).toUpperCase());
    extraContentHTML += `
      <div class="server-invite-card">
        <div class="invite-card-top">
          <div class="invite-card-icon" style="${iconStyle}">${iconFallback}</div>
          <div class="invite-card-details">
            <span class="invite-card-heading">YOU'VE BEEN INVITED TO JOIN A SERVER</span>
            <div class="invite-card-name-row">
              <span class="invite-card-name">${escapeHTML(inv.serverName)}</span>
              ${isOff}
            </div>
            <span style="font-size: 12px; color: var(--text-muted);">${inv.memberCount || 1} Member${(inv.memberCount || 1) > 1 ? 's' : ''}</span>
          </div>
        </div>
        <button type="button" class="invite-card-action-btn" onclick="joinServerFromInviteCard('${escapeHTML(inv.inviteCode)}')">Join Server</button>
      </div>
    `;
  }

  // 3. Formatted Message Content
  const formattedText = formatDiscordMarkdown(msg.text);
  const editedTag = msg.isEdited ? `<span class="message-edited-tag">(edited)</span>` : '';

  // 4. Reactions
  const reactionsHTML = renderReactionsHTML(msg.id, msg.reactions);

  // 5. Discord Hover Action Bar
  const isAuthor = currentUser && currentUser.id === msg.senderId;
  const srv = getCurrentServer();
  const isServerStaff = currentUser && (
    (srv && srv.ownerId === currentUser.id) ||
    (currentUser.globalBadges && (currentUser.globalBadges.includes('PROJECT_OWNER') || currentUser.globalBadges.includes('CREATOR')))
  );
  const canDelete = isAuthor || isServerStaff;

  const rawCleanText = (msg.text || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const cleanUsername = (msg.username || '').replace(/'/g, "\\'");

  const isPinned = Boolean(msg.isPinned);
  const pinTitle = isPinned ? 'Unpin Message' : 'Pin Message';
  const pinBtnClass = isPinned ? 'msg-action-btn active' : 'msg-action-btn';

  const threadReplies = (msg.threadRepliesCount !== undefined) ? msg.threadRepliesCount : (msg.threadReplyCount || 0);
  const threadCardHTML = msg.hasThread ? `
    <div class="message-thread-card" onclick="openThreadPanel('${msg.id}')">
      <span class="thread-card-icon">🧵</span>
      <span class="thread-card-name">${escapeHTML(msg.threadName || 'Thread')}</span>
      <span class="thread-card-replies">• ${threadReplies} ${threadReplies === 1 ? 'reply' : 'replies'}</span>
      <span class="thread-card-arrow">View Thread ›</span>
    </div>
  ` : '';

  const actionBarHTML = `
    <div class="message-action-bar">
      <button type="button" class="msg-action-btn" title="Add Reaction" onclick="openReactionPicker('${msg.id}', event)">😀</button>
      <button type="button" class="msg-action-btn" title="Reply" onclick="startReplyToMessage('${msg.id}', '${cleanUsername}', '${rawCleanText}')">↩️</button>
      <button type="button" class="${pinBtnClass}" title="${pinTitle}" onclick="togglePinMessage('${msg.id}')">📌</button>
      <button type="button" class="msg-action-btn" title="Create / Open Thread" onclick="openOrCreateThreadForMessage('${msg.id}')">🧵</button>
      ${isAuthor ? `<button type="button" class="msg-action-btn" title="Edit Message" onclick="startEditMessage('${msg.id}')">✏️</button>` : ''}
      ${canDelete ? `<button type="button" class="msg-action-btn danger" title="Delete Message" onclick="confirmDeleteMessage('${msg.id}')">🗑️</button>` : ''}
    </div>
  `;

  const pinnedTagHTML = isPinned ? `<span class="message-pinned-tag" title="Pinned Message">📌 Pinned</span>` : '';

  row.innerHTML = `
    ${actionBarHTML}
    ${replyHTML}
    <div style="display: flex; gap: 14px; width: 100%;">
      <div class="message-avatar" style="cursor: pointer;" onclick="openUserProfileCard({ id: '${msg.senderId}', username: '${cleanUsername}' })" title="View Profile">
      </div>
      <div class="message-body">
        <div class="message-header">
          <span class="message-author" style="color: ${msg.color}; cursor: pointer;" onclick="openUserProfileCard({ id: '${msg.senderId}', username: '${cleanUsername}' })" title="View Profile">${escapeHTML(msg.username)}</span>
          ${msg.roleBadge ? `<span class="message-role-tag" style="color: ${msg.color};">${msg.roleBadge} ${escapeHTML(msg.roleName || '')}</span>` : ''}
          ${renderGlobalBadgesHTML(msg.globalBadges)}
          <span class="message-time">${timeStr}</span>
          ${pinnedTagHTML}
        </div>
        <div class="message-content" id="msg-content-${msg.id}">${formattedText}${editedTag}</div>
        ${threadCardHTML}
        ${extraContentHTML}
        <div class="message-reactions-row" id="reactions-${msg.id}">${reactionsHTML}</div>
      </div>
    </div>
  `;

  const msgAvatarEl = row.querySelector('.message-avatar');
  if (msgAvatarEl) {
    if (effectiveAvatar) {
      msgAvatarEl.style.backgroundImage = `url("${effectiveAvatar}")`;
      msgAvatarEl.style.backgroundColor = 'transparent';
      msgAvatarEl.textContent = '';
    } else {
      msgAvatarEl.style.backgroundImage = 'none';
      msgAvatarEl.style.backgroundColor = msg.color || '#5865F2';
      msgAvatarEl.textContent = (msg.username || 'U').substring(0, 1).toUpperCase();
    }
  }

  messagesList.appendChild(row);
}

// Replying
window.startReplyToMessage = function(msgId, username, text) {
  activeReplyTarget = { id: msgId, username, text };
  replyPreviewAuthor.textContent = '@' + username;
  replyPreviewText.textContent = text ? (text.length > 80 ? text.substring(0, 80) + '...' : text) : '[Attachment]';
  replyPreviewBar.style.display = 'flex';
  chatInput.focus();
};

cancelReplyBtn.addEventListener('click', () => {
  activeReplyTarget = null;
  replyPreviewBar.style.display = 'none';
});

window.scrollToMessage = function(targetMsgId) {
  const targetRow = document.getElementById(`msg-${targetMsgId}`);
  if (targetRow) {
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetRow.style.backgroundColor = 'rgba(88, 101, 242, 0.25)';
    setTimeout(() => { targetRow.style.backgroundColor = ''; }, 1600);
  }
};

// Inline Message Editing
window.startEditMessage = function(msgId) {
  const contentEl = document.getElementById(`msg-content-${msgId}`);
  if (!contentEl) return;

  // Retrieve raw text (stripping edited tag if present)
  let rawText = contentEl.innerText.replace(/\(edited\)\s*$/, '').trim();

  contentEl.innerHTML = `
    <div class="message-edit-box">
      <textarea class="message-edit-input" id="edit-input-${msgId}">${escapeHTML(rawText)}</textarea>
      <div class="message-edit-actions">
        <button type="button" class="message-edit-save" onclick="saveEditMessage('${msgId}')">Save</button>
        <button type="button" class="message-edit-cancel" onclick="cancelEditMessage('${msgId}', '${escapeHTML(rawText).replace(/'/g, "\\'")}')">Cancel</button>
        <span style="color: var(--text-muted); font-size: 11px;">escape to cancel • enter to save</span>
      </div>
    </div>
  `;

  const input = document.getElementById(`edit-input-${msgId}`);
  if (input) {
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveEditMessage(msgId);
      } else if (e.key === 'Escape') {
        cancelEditMessage(msgId, rawText);
      }
    });
  }
};

window.saveEditMessage = function(msgId) {
  const input = document.getElementById(`edit-input-${msgId}`);
  if (!input) return;
  const newText = input.value.trim();
  if (!newText) return;

  socket.emit('edit-message', {
    serverId: currentServerId,
    channelId: activeTextChannel,
    messageId: msgId,
    newText,
    isDm: currentView === 'dms',
    targetId: activeDmPeerId
  });
};

window.cancelEditMessage = function(msgId, originalText) {
  const contentEl = document.getElementById(`msg-content-${msgId}`);
  if (contentEl) {
    contentEl.innerHTML = formatDiscordMarkdown(originalText);
  }
};

function applyMessageEditInDOM(msgId, newText) {
  const contentEl = document.getElementById(`msg-content-${msgId}`);
  if (contentEl) {
    contentEl.innerHTML = formatDiscordMarkdown(newText) + `<span class="message-edited-tag">(edited)</span>`;
  }
}

// Message Deleting (Discord-style deletion warning modal with snippet)
window.confirmDeleteMessage = async function(msgId) {
  const row = document.getElementById(`msg-${msgId}`);
  const snippet = row ? (row.querySelector('.message-content')?.innerText || '') : '';
  const srvId = row?.getAttribute('data-server-id') || currentServerId;
  const chId = row?.getAttribute('data-channel-id') || activeTextChannel;
  const isDm = currentView === 'dms' || (!srvId && Boolean(activeDmPeerId));
  const ok = await showConfirmDialog({
    title: 'Delete Message',
    description: 'Are you sure you want to delete this message? This cannot be undone.',
    previewText: snippet ? `"${snippet.substring(0, 140)}"` : null,
    confirmText: 'Delete',
    isDanger: true,
    icon: '🗑️'
  });

  if (ok) {
    socket.emit('delete-message', {
      serverId: srvId,
      channelId: chId,
      messageId: msgId,
      isDm,
      targetId: activeDmPeerId
    });
  }
};

function applyMessageDeleteInDOM(msgId) {
  const row = document.getElementById(`msg-${msgId}`);
  if (row) {
    row.style.opacity = '0';
    row.style.transform = 'scale(0.95)';
    row.style.transition = 'opacity 0.2s, transform 0.2s';
    setTimeout(() => { row.remove(); }, 200);
  }
}

// Reactions
window.toggleReaction = function(msgId, emoji) {
  socket.emit('toggle-reaction', {
    serverId: currentServerId,
    channelId: activeTextChannel,
    messageId: msgId,
    emoji,
    isDm: currentView === 'dms',
    targetId: activeDmPeerId
  });
  if (msgReactionPopover) msgReactionPopover.style.display = 'none';
};

function applyMessageReactionsInDOM(msgId, reactions) {
  const container = document.getElementById(`reactions-${msgId}`);
  if (container) {
    container.innerHTML = renderReactionsHTML(msgId, reactions);
  }
}

// Floating Quick Reaction Popover
window.openReactionPicker = function(msgId, event) {
  event.stopPropagation();
  activeReactionMessageId = msgId;

  const rect = event.target.getBoundingClientRect();
  msgReactionPopover.style.top = `${rect.top - 44}px`;
  msgReactionPopover.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
  msgReactionPopover.style.display = 'flex';
};

// Quick reaction popover clicks
document.querySelectorAll('.reaction-emoji-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const emoji = btn.getAttribute('data-emoji');
    if (activeReactionMessageId && emoji) {
      toggleReaction(activeReactionMessageId, emoji);
    }
    msgReactionPopover.style.display = 'none';
  });
});

document.addEventListener('click', () => {
  if (msgReactionPopover) msgReactionPopover.style.display = 'none';
});

// Emoji Grid for Chat Input
const POPULAR_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','😍','🥰','😘','😋','😛','😜','🤪','🤫','🤔','🤨',
  '😐','😑','😶','🙄','😬','🥱','😴','🤮','🥵','🥶','🤯','🥳','😎','🤓','🧐','🤖','👾','👻','💀','👽',
  '💩','🤡','👏','👍','👎','👊','✊','🤛','🤜','🤞','✌️','🤟','🤘','👌','🤏','👈','👉','👆','👇','☝️',
  '✋','🤚','🖐️','🖖','👋','🤙','🤝','🦾','🦿','🖕','✍️','🙏','🔥','✨','⭐','💯','❤️','🧡','💛','💚',
  '💙','💜','🖤','🤍','🤎','💔','🎉','🚀','💎','👑','🎯','🍿','🍕','🍔','☕','🍻'
];

function setupEmojiPicker() {
  if (!emojiGridList) return;
  emojiGridList.innerHTML = '';
  POPULAR_EMOJIS.forEach(emoji => {
    const el = document.createElement('div');
    el.className = 'emoji-grid-item';
    el.textContent = emoji;
    el.onclick = () => {
      chatInput.value += emoji;
      chatInput.focus();
    };
    emojiGridList.appendChild(el);
  });
}

toggleEmojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (gifPickerPopover) gifPickerPopover.style.display = 'none';
  emojiPickerPopover.style.display = emojiPickerPopover.style.display === 'none' ? 'flex' : 'none';
});

closeEmojiPicker.addEventListener('click', () => {
  emojiPickerPopover.style.display = 'none';
});

// =========================================
// 6b. DISCORD-STYLE GIF BROWSER & PICKER
// =========================================
const toggleGifBtn = document.getElementById('toggle-gif-btn');
const gifPickerPopover = document.getElementById('gif-picker-popover');
const closeGifPicker = document.getElementById('close-gif-picker');
const gifSearchInput = document.getElementById('gif-search-input');
const gifGridContainer = document.getElementById('gif-grid-container');
const gifCategoryTags = document.getElementById('gif-category-tags');

const CURATED_GIFS = {
  "trending": [
    {
      "title": "Excited Party",
      "url": "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif"
    },
    {
      "title": "Cat Dance Vibe",
      "url": "https://media.giphy.com/media/Nm8ZPAGOwZUQM/giphy.gif"
    },
    {
      "title": "Snoop Dogg Dance",
      "url": "https://media.giphy.com/media/wAxlCmeX1ri1y/giphy.gif"
    },
    {
      "title": "Mind Blown",
      "url": "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif"
    },
    {
      "title": "Shaq Shimmy",
      "url": "https://media.giphy.com/media/UO5elnTqo4vSg/giphy.gif"
    },
    {
      "title": "This Is Fine",
      "url": "https://media.giphy.com/media/9M5jK4GXmD5o1irGrF/giphy.gif"
    }
  ],
  "laugh": [
    {
      "title": "Laughing Dog",
      "url": "https://media.giphy.com/media/29HRejgahYenVsohB5/giphy.gif"
    },
    {
      "title": "Ryan Reynolds Laugh",
      "url": "https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif"
    },
    {
      "title": "Crying Laughing",
      "url": "https://media.giphy.com/media/GpyS1lJXJYupG/giphy.gif"
    },
    {
      "title": "Kermit Laugh",
      "url": "https://media.giphy.com/media/9MFsKQ8A6HCN2/giphy.gif"
    },
    {
      "title": "Baby Laugh",
      "url": "https://media.giphy.com/media/13AXYJh2jDt2IE/giphy.gif"
    }
  ],
  "dance": [
    {
      "title": "Cat Dance Vibe",
      "url": "https://media.giphy.com/media/Nm8ZPAGOwZUQM/giphy.gif"
    },
    {
      "title": "Carlton Dance",
      "url": "https://media.giphy.com/media/pa37AAGzKXoek/giphy.gif"
    },
    {
      "title": "Dancing Kermit",
      "url": "https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif"
    },
    {
      "title": "Happy Dance Dog",
      "url": "https://media.giphy.com/media/3o7qDSOvfaCO9b3MlO/giphy.gif"
    },
    {
      "title": "Club Dance Moves",
      "url": "https://media.giphy.com/media/l3V0lsGtTMSB5YNgc/giphy.gif"
    }
  ],
  "applause": [
    {
      "title": "Clapping Citizen Kane",
      "url": "https://media.giphy.com/media/g9582DNuQppxC/giphy.gif"
    },
    {
      "title": "Standing Ovation",
      "url": "https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.gif"
    },
    {
      "title": "Leonardo Slow Clap",
      "url": "https://media.giphy.com/media/7rj2ZgttvgomY/giphy.gif"
    },
    {
      "title": "Friends Clapping",
      "url": "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif"
    }
  ],
  "anime": [
    {
      "title": "Anime Dance Sparkle",
      "url": "https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif"
    },
    {
      "title": "Anime Cat Smile",
      "url": "https://media.giphy.com/media/10t57cXgo7x5kI/giphy.gif"
    },
    {
      "title": "Anime Wow Face",
      "url": "https://media.giphy.com/media/slVWEctHZKvWU/giphy.gif"
    }
  ],
  "cat": [
    {
      "title": "Bongo Cat",
      "url": "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif"
    },
    {
      "title": "Cat Vibing Jam",
      "url": "https://media.giphy.com/media/Nm8ZPAGOwZUQM/giphy.gif"
    },
    {
      "title": "Surprised Cat",
      "url": "https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif"
    },
    {
      "title": "Cat Hug",
      "url": "https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif"
    }
  ],
  "shock": [
    {
      "title": "Surprised Pikachu",
      "url": "https://media.giphy.com/media/6nWhy3ulBL7GSCvKw6/giphy.gif"
    },
    {
      "title": "Mind Blown Space",
      "url": "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif"
    }
  ],
  "party": [
    {
      "title": "Confetti Party",
      "url": "https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif"
    },
    {
      "title": "Kermit Celebration",
      "url": "https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif"
    },
    {
      "title": "Disco Party",
      "url": "https://media.giphy.com/media/pa37AAGzKXoek/giphy.gif"
    }
  ],
  "gaming": [
    {
      "title": "Gamer Rage",
      "url": "https://media.giphy.com/media/11tTNkNy1SdXGg/giphy.gif"
    },
    {
      "title": "Victory Royale",
      "url": "https://media.giphy.com/media/3o7qDEq2bMbcbPRQ2c/giphy.gif"
    },
    {
      "title": "Pro Gamer Move",
      "url": "https://media.giphy.com/media/d3mlE7uhX8KFgEmY/giphy.gif"
    },
    {
      "title": "GG Well Played",
      "url": "https://media.giphy.com/media/L3ERvA6jWCd0qO4NdX/giphy.gif"
    }
  ],
  "sad": [
    {
      "title": "Crying Rain Dog",
      "url": "https://media.giphy.com/media/OPU6wzx8JrHna/giphy.gif"
    },
    {
      "title": "Cat Crying Tears",
      "url": "https://media.giphy.com/media/ISOckXUybVfQ4/giphy.gif"
    },
    {
      "title": "Sad Kermit",
      "url": "https://media.giphy.com/media/9Y5BbDSkSTiY8/giphy.gif"
    }
  ]
};

let currentGifSearchDebounce = null;

async function searchAndRenderGifs(query = 'trending') {
  if (!gifGridContainer) return;
  const cleanQ = (query || '').trim().toLowerCase();
  gifGridContainer.innerHTML = '<div class="gif-loading-state">Finding GIFs...</div>';

  let gifsToRender = [];

  // Check curated categories
  if (CURATED_GIFS[cleanQ]) {
    gifsToRender = CURATED_GIFS[cleanQ];
  } else {
    for (const [cat, list] of Object.entries(CURATED_GIFS)) {
      if (cat.includes(cleanQ)) {
        gifsToRender.push(...list);
      } else {
        const matches = list.filter(g => g.title.toLowerCase().includes(cleanQ));
        gifsToRender.push(...matches);
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  const uniqueGifs = [];
  for (const g of gifsToRender) {
    if (!seen.has(g.url)) {
      seen.add(g.url);
      uniqueGifs.push(g);
    }
  }

  if (uniqueGifs.length === 0) {
    uniqueGifs.push(...CURATED_GIFS.trending);
  }

  gifGridContainer.innerHTML = '';
  uniqueGifs.forEach(gif => {
    const card = document.createElement('div');
    card.className = 'gif-grid-item';
    card.title = gif.title;
    card.innerHTML = `
      <img src="${gif.url}" alt="${escapeHTML(gif.title)}" loading="lazy" onerror="this.closest('.gif-grid-item')?.remove()">
      <div class="gif-grid-item-title">${escapeHTML(gif.title)}</div>
    `;
    card.onclick = () => sendGifMessage(gif.url, gif.title);
    gifGridContainer.appendChild(card);
  });
}

function sendGifMessage(gifUrl, gifTitle) {
  gifPickerPopover.style.display = 'none';
  const cleanTitle = (gifTitle || 'reaction').replace(/[^a-zA-Z0-9_-]/g, '_');
  const payload = {
    text: '',
    attachment: {
      name: `${cleanTitle}.gif`,
      type: 'image/gif',
      dataUrl: gifUrl
    },
    replyTo: activeReplyTarget
  };

  if (currentView === 'server') {
    socket.emit('send-message', { serverId: currentServerId, channelId: activeTextChannel, ...payload });
  } else if (activeDmPeerId) {
    const isGroup = String(activeDmPeerId).startsWith('grp_');
    socket.emit('send-dm', { targetId: activeDmPeerId, isGroup, ...payload });
  }

  activeReplyTarget = null;
  if (replyPreviewBar) replyPreviewBar.style.display = 'none';
  showToast('GIF sent! 🎬', 'success');
}

// Category tag pills click
document.querySelectorAll('#gif-category-tags .gif-tag-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('#gif-category-tags .gif-tag-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    const tag = pill.getAttribute('data-tag');
    if (gifSearchInput) gifSearchInput.value = '';
    searchAndRenderGifs(tag);
  });
});

if (gifSearchInput) {
  gifSearchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(currentGifSearchDebounce);
    currentGifSearchDebounce = setTimeout(() => {
      searchAndRenderGifs(q || 'trending');
    }, 300);
  });
}

if (toggleGifBtn) {
  toggleGifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = gifPickerPopover.style.display === 'none';
    if (isHidden) {
      if (emojiPickerPopover) emojiPickerPopover.style.display = 'none';
      gifPickerPopover.style.display = 'flex';
      searchAndRenderGifs('trending');
      setTimeout(() => gifSearchInput && gifSearchInput.focus(), 60);
    } else {
      gifPickerPopover.style.display = 'none';
    }
  });
}

if (closeGifPicker) {
  closeGifPicker.addEventListener('click', () => {
    gifPickerPopover.style.display = 'none';
  });
}

document.addEventListener('click', (e) => {
  if (gifPickerPopover && !gifPickerPopover.contains(e.target) && e.target !== toggleGifBtn && !toggleGifBtn?.contains(e.target)) {
    gifPickerPopover.style.display = 'none';
  }
});

function playVoiceNoteAudio(id, btn) {
  const audio = document.getElementById(`audio-${id}`);
  if (!audio) return;
  if (audio.paused) { audio.play(); btn.textContent = '⏸'; }
  else { audio.pause(); btn.textContent = '▶'; }
}

function resetVoiceNotePlayBtn(audio) {
  const btn = audio.parentElement.querySelector('.voice-note-play-btn');
  if (btn) btn.textContent = '▶';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.innerText = str;
  return div.innerHTML;
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function resetPendingAttachment() {
  pendingAttachment = null;
  pendingP2PFile = null;
  if (fileInput) fileInput.value = '';
  if (attachmentPreviewBar) {
    attachmentPreviewBar.style.display = 'none';
    attachmentPreviewBar.classList.remove('is-p2p-file');
  }
  if (previewP2PPill) previewP2PPill.style.display = 'none';
  if (previewImg) previewImg.style.display = 'none';
  if (previewCodeBox) previewCodeBox.style.display = 'none';
  if (previewGenericIcon) previewGenericIcon.style.display = 'none';
}

function handleAttachmentFile(file) {
  if (!file) return;

  const isArchive = /\.(tar\.gz|tgz|tar|gz|zip|rar|7z|iso|bz2|exe|msi)$/i.test(file.name);
  const isLarge = file.size > 25 * 1024 * 1024 || isArchive; // > 25MB or binary archives automatically use P2P

  if (isLarge) {
    const transferId = 'p2p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    pendingP2PFile = {
      transferId,
      file,
      name: file.name,
      size: file.size,
      type: file.type
    };
    pendingAttachment = null;

    if (previewFilename) previewFilename.textContent = file.name;
    if (previewFilesize) previewFilesize.textContent = formatBytes(file.size);

    if (previewImg) previewImg.style.display = 'none';
    if (previewCodeBox) previewCodeBox.style.display = 'none';
    if (previewGenericIcon) {
      previewGenericIcon.textContent = getP2PFileEmoji(file.name);
      previewGenericIcon.style.display = 'block';
    }
    if (previewP2PPill) previewP2PPill.style.display = 'inline-flex';

    if (attachmentPreviewBar) {
      attachmentPreviewBar.classList.add('is-p2p-file');
      attachmentPreviewBar.style.display = 'flex';
    }
    showToast(`⚡ Large file (${formatBytes(file.size)}) queued for P2P direct chat transfer!`, 'info');
    return;
  }

  // Normal file under 25MB
  pendingP2PFile = null;
  if (previewP2PPill) previewP2PPill.style.display = 'none';
  if (attachmentPreviewBar) attachmentPreviewBar.classList.remove('is-p2p-file');

  const reader = new FileReader();
  reader.onload = () => {
    pendingAttachment = {
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: reader.result
    };

    if (previewFilename) previewFilename.textContent = file.name;
    if (previewFilesize) previewFilesize.textContent = formatBytes(file.size);

    if (file.type && file.type.startsWith('image/')) {
      if (previewImg) {
        previewImg.src = reader.result;
        previewImg.style.display = 'block';
      }
      if (previewCodeBox) previewCodeBox.style.display = 'none';
      if (previewGenericIcon) previewGenericIcon.style.display = 'none';
    } else if (isCodeFile(file.name, file.type)) {
      if (previewImg) previewImg.style.display = 'none';
      if (previewGenericIcon) previewGenericIcon.style.display = 'none';
      if (previewCodeBox && previewCodeText) {
        const textContent = extractBase64Text(reader.result) || '';
        const peekSnippet = textContent.split('\n').slice(0, 6).join('\n');
        previewCodeText.querySelector('code').textContent = peekSnippet || '// (Empty code/text file)';
        const ext = file.name.split('.').pop().toUpperCase();
        if (previewCodeBadge) previewCodeBadge.textContent = ext;
        previewCodeBox.style.display = 'flex';
      }
    } else {
      if (previewImg) previewImg.style.display = 'none';
      if (previewCodeBox) previewCodeBox.style.display = 'none';
      if (previewGenericIcon) {
        if ((file.type && file.type.startsWith('video/')) || /\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
          previewGenericIcon.textContent = '🎬';
        } else if ((file.type && file.type.startsWith('audio/')) || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
          previewGenericIcon.textContent = '🎵';
        } else {
          previewGenericIcon.textContent = '📄';
        }
        previewGenericIcon.style.display = 'block';
      }
    }

    if (attachmentPreviewBar) attachmentPreviewBar.style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

// Drag & Drop File Upload onto Chat Area
const chatDropzoneOverlay = document.getElementById('chat-dropzone-overlay');
let chatDragDepth = 0;

chatArea.addEventListener('dragenter', (e) => {
  e.preventDefault();
  chatDragDepth++;
  if (chatDropzoneOverlay) chatDropzoneOverlay.style.display = 'flex';
});

chatArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (chatDropzoneOverlay && chatDropzoneOverlay.style.display !== 'flex') {
    chatDropzoneOverlay.style.display = 'flex';
  }
});

chatArea.addEventListener('dragleave', (e) => {
  e.preventDefault();
  chatDragDepth--;
  if (chatDragDepth <= 0) {
    chatDragDepth = 0;
    if (chatDropzoneOverlay) chatDropzoneOverlay.style.display = 'none';
  }
});

chatArea.addEventListener('drop', (e) => {
  e.preventDefault();
  chatDragDepth = 0;
  if (chatDropzoneOverlay) chatDropzoneOverlay.style.display = 'none';
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleAttachmentFile(e.dataTransfer.files[0]);
  }
});

// Submitting chat & Slash Commands
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const rawText = chatInput.value.trim();
  if (!rawText && !pendingAttachment && !pendingP2PFile) return;

  const srv = getCurrentServer();
  const isStaff = currentUser && srv && (
    srv.ownerId === currentUser.id ||
    hasPermission(srv, currentUser.id, 'MANAGE_CHANNELS') ||
    hasPermission(srv, currentUser.id, 'MANAGE_SERVER')
  );

  // Slowmode check for regular members
  if (currentView === 'server' && slowmodeCooldownRemaining > 0 && !isStaff) {
    showToast(`Slowmode is active. Wait ${slowmodeCooldownRemaining}s before sending.`, 'warning');
    return;
  }

  // Slash commands handling
  if (rawText.startsWith('/')) {
    const parts = rawText.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    if (cmd === '/code') {
      // /code [lang] <code>
      if (!args && !pendingAttachment && !pendingP2PFile) {
        showToast('Usage: /code [lang] <code> (e.g. /code js console.log("Hello!"))', 'info');
        return;
      }
      let lang = 'txt';
      let code = args;
      const firstWord = (parts[1] || '').toLowerCase();
      const knownLangs = ['js', 'javascript', 'ts', 'typescript', 'py', 'python', 'html', 'css', 'json', 'sql', 'cpp', 'c', 'cs', 'java', 'rs', 'rust', 'go', 'php', 'sh', 'bash', 'yaml', 'yml'];
      if (knownLangs.includes(firstWord) && parts.length > 2) {
        lang = firstWord;
        code = parts.slice(2).join(' ');
      }
      const formattedCodeBlock = '```' + lang + '\n' + code + '\n```';
      const payload = {
        text: formattedCodeBlock,
        attachment: pendingAttachment,
        p2pFile: pendingP2PFile ? {
          transferId: pendingP2PFile.transferId,
          name: pendingP2PFile.name,
          size: pendingP2PFile.size,
          type: pendingP2PFile.type,
          senderId: currentUser.id,
          senderSocketId: (typeof socket !== 'undefined' && socket) ? socket.id : null,
          senderName: currentUser.username
        } : null,
        replyTo: activeReplyTarget
      };
      if (pendingP2PFile) {
        activeP2PFiles.set(pendingP2PFile.transferId, pendingP2PFile.file);
      }
      if (currentView === 'server') {
        socket.emit('send-message', { serverId: currentServerId, channelId: activeTextChannel, ...payload });
        if (currentSlowmodeSeconds > 0 && !isStaff) {
          startSlowmodeCooldown(currentSlowmodeSeconds);
        }
      } else if (activeDmPeerId) {
        const isGroup = String(activeDmPeerId).startsWith('grp_');
        socket.emit('send-dm', { targetId: activeDmPeerId, isGroup, ...payload });
      }
      chatInput.value = '';
      resetPendingAttachment();
      activeReplyTarget = null;
      replyPreviewBar.style.display = 'none';
      return;
    } else if (cmd === '/thread') {
      if (currentView !== 'server') {
        showToast('Threads can only be created in a server channel.', 'warning');
        return;
      }
      if (!args && !pendingAttachment && !pendingP2PFile) {
        showToast('Usage: /thread [Title] <Message> or /thread <Message>', 'info');
        return;
      }
      let threadTitle = '';
      let threadText = args;
      const match = args.match(/^\[(.*?)\]\s*(.*)$/);
      if (match) {
        threadTitle = match[1].trim();
        threadText = match[2].trim();
      } else {
        threadTitle = threadText.length > 30 ? threadText.substring(0, 30) + '...' : threadText;
      }
      const payload = {
        text: threadText,
        attachment: pendingAttachment,
        p2pFile: pendingP2PFile ? {
          transferId: pendingP2PFile.transferId,
          name: pendingP2PFile.name,
          size: pendingP2PFile.size,
          type: pendingP2PFile.type,
          senderId: currentUser.id,
          senderSocketId: (typeof socket !== 'undefined' && socket) ? socket.id : null,
          senderName: currentUser.username
        } : null,
        replyTo: activeReplyTarget,
        isThreadStarter: true,
        threadName: threadTitle
      };
      if (pendingP2PFile) {
        activeP2PFiles.set(pendingP2PFile.transferId, pendingP2PFile.file);
      }
      socket.emit('send-message', { serverId: currentServerId, channelId: activeTextChannel, ...payload });
      if (currentSlowmodeSeconds > 0 && !isStaff) {
        startSlowmodeCooldown(currentSlowmodeSeconds);
      }
      chatInput.value = '';
      resetPendingAttachment();
      activeReplyTarget = null;
      replyPreviewBar.style.display = 'none';
      if (isThreadDraftMode) {
        isThreadDraftMode = false;
        updateThreadDraftUI();
      }
      return;
    } else if (cmd === '/clear') {
      if (currentView === 'server' && isStaff) {
        socket.emit('clear-channel', { serverId: currentServerId, channelId: activeTextChannel });
      } else {
        messagesList.innerHTML = '';
        showToast('Chat cleared locally. 🧹', 'info');
      }
      chatInput.value = '';
      return;
    } else if (cmd === '/kick') {
      // /kick <username> [reason]
      if (!srv) {
        showToast('/kick can only be used in a server.', 'warning');
        return;
      }
      if (!parts[1]) {
        showToast('Usage: /kick <username> [reason]', 'info');
        return;
      }
      const targetQuery = parts[1].replace(/^@/, '').toLowerCase();
      const reason = parts.slice(2).join(' ').trim();

      let targetUser = null;
      for (const uid in srv.memberRoles) {
        const acc = accountsMap.get(uid);
        if (acc && acc.username.toLowerCase() === targetQuery) {
          targetUser = acc;
          break;
        }
      }
      if (!targetUser) {
        accountsMap.forEach(acc => {
          if (acc.username.toLowerCase() === targetQuery) targetUser = acc;
        });
      }

      if (!targetUser) {
        showToast(`User "@${parts[1]}" not found.`, 'warning');
        chatInput.value = '';
        return;
      }

      socket.emit('kick-user', {
        serverId: currentServerId,
        targetId: targetUser.id,
        channelId: activeTextChannel,
        reason: reason || ''
      });
      chatInput.value = '';
      return;
    } else if (cmd === '/ban') {
      // /ban <username> [reason]
      if (!srv) {
        showToast('/ban can only be used in a server.', 'warning');
        return;
      }
      if (!parts[1]) {
        showToast('Usage: /ban <username> [reason]', 'info');
        return;
      }
      const targetQuery = parts[1].replace(/^@/, '').toLowerCase();
      const reason = parts.slice(2).join(' ').trim();

      let targetUser = null;
      for (const uid in srv.memberRoles) {
        const acc = accountsMap.get(uid);
        if (acc && acc.username.toLowerCase() === targetQuery) {
          targetUser = acc;
          break;
        }
      }
      if (!targetUser) {
        accountsMap.forEach(acc => {
          if (acc.username.toLowerCase() === targetQuery) targetUser = acc;
        });
      }

      if (!targetUser) {
        showToast(`User "@${parts[1]}" not found.`, 'warning');
        chatInput.value = '';
        return;
      }

      socket.emit('ban-user', {
        serverId: currentServerId,
        targetId: targetUser.id,
        channelId: activeTextChannel,
        reason: reason || ''
      });
      chatInput.value = '';
      return;
    }
  }

  const isStartingThread = isThreadDraftMode;
  const draftTitle = (threadDraftNameInput && threadDraftNameInput.value.trim()) || '';

  const payload = {
    text: rawText || '',
    attachment: pendingAttachment,
    p2pFile: pendingP2PFile ? {
      transferId: pendingP2PFile.transferId,
      name: pendingP2PFile.name,
      size: pendingP2PFile.size,
      type: pendingP2PFile.type,
      senderId: currentUser.id,
      senderSocketId: (typeof socket !== 'undefined' && socket) ? socket.id : null,
      senderName: currentUser.username
    } : null,
    replyTo: activeReplyTarget,
    isThreadStarter: isStartingThread,
    threadName: isStartingThread ? (draftTitle || rawText.substring(0, 30)) : undefined
  };

  if (pendingP2PFile) {
    activeP2PFiles.set(pendingP2PFile.transferId, pendingP2PFile.file);
  }

  if (currentView === 'server') {
    socket.emit('send-message', { serverId: currentServerId, channelId: activeTextChannel, ...payload });
    if (currentSlowmodeSeconds > 0 && !isStaff) {
      startSlowmodeCooldown(currentSlowmodeSeconds);
    }
  } else if (activeDmPeerId) {
    const isGroup = String(activeDmPeerId).startsWith('grp_');
    socket.emit('send-dm', { targetId: activeDmPeerId, isGroup, ...payload });
  }

  chatInput.value = '';
  resetPendingAttachment();

  if (isThreadDraftMode) {
    isThreadDraftMode = false;
    updateThreadDraftUI();
  }

  // Clear reply state
  activeReplyTarget = null;
  replyPreviewBar.style.display = 'none';
  if (emojiPickerPopover) emojiPickerPopover.style.display = 'none';
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleAttachmentFile(file);
});

removeAttachmentBtn.addEventListener('click', () => {
  resetPendingAttachment();
});

recordVoiceBtn.addEventListener('click', async () => {
  try {
    if (voicePreviewBanner) voicePreviewBanner.style.display = 'none';
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); };
    mediaRecorder.start();

    recordingSeconds = 0;
    voiceRecordingBanner.style.display = 'flex';
    recordingTimer.textContent = '00:00';

    clearInterval(recordingInterval);
    recordingInterval = setInterval(() => {
      recordingSeconds++;
      const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
      const secs = String(recordingSeconds % 60).padStart(2, '0');
      recordingTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  } catch (err) {
    showToast('Microphone access denied for voice note.', 'error');
  }
});

cancelVoiceBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  clearInterval(recordingInterval);
  voiceRecordingBanner.style.display = 'none';
  audioChunks = [];
});

if (stopVoiceBtn) {
  stopVoiceBtn.addEventListener('click', () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    const duration = recordingSeconds;
    clearInterval(recordingInterval);
    voiceRecordingBanner.style.display = 'none';

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        pendingVoiceNote = { dataUrl: reader.result, duration };
        if (pendingVoiceBlobUrl) URL.revokeObjectURL(pendingVoiceBlobUrl);
        pendingVoiceBlobUrl = URL.createObjectURL(audioBlob);
        if (previewVoiceAudio) previewVoiceAudio.src = pendingVoiceBlobUrl;

        const mins = String(Math.floor(duration / 60)).padStart(2, '0');
        const secs = String(duration % 60).padStart(2, '0');
        if (previewVoiceTime) previewVoiceTime.textContent = `${mins}:${secs}`;
        if (previewVoicePlayBtn) previewVoicePlayBtn.textContent = '▶';
        if (voicePreviewBanner) voicePreviewBanner.style.display = 'flex';
      };
      reader.readAsDataURL(audioBlob);
    };
    mediaRecorder.stop();
  });
}

if (previewVoicePlayBtn) {
  previewVoicePlayBtn.addEventListener('click', () => {
    if (!previewVoiceAudio || !previewVoiceAudio.src) return;
    if (previewVoiceAudio.paused) {
      previewVoiceAudio.play();
      previewVoicePlayBtn.textContent = '⏸';
    } else {
      previewVoiceAudio.pause();
      previewVoicePlayBtn.textContent = '▶';
    }
  });
}

if (previewVoiceAudio) {
  previewVoiceAudio.addEventListener('ended', () => {
    if (previewVoicePlayBtn) previewVoicePlayBtn.textContent = '▶';
  });
}

if (discardVoiceBtn) {
  discardVoiceBtn.addEventListener('click', () => {
    if (previewVoiceAudio && !previewVoiceAudio.paused) previewVoiceAudio.pause();
    if (pendingVoiceBlobUrl) {
      URL.revokeObjectURL(pendingVoiceBlobUrl);
      pendingVoiceBlobUrl = null;
    }
    pendingVoiceNote = null;
    if (previewVoiceAudio) previewVoiceAudio.src = '';
    if (voicePreviewBanner) voicePreviewBanner.style.display = 'none';
  });
}

if (confirmSendVoiceBtn) {
  confirmSendVoiceBtn.addEventListener('click', () => {
    if (!pendingVoiceNote) return;
    if (previewVoiceAudio && !previewVoiceAudio.paused) previewVoiceAudio.pause();

    const srv = getCurrentServer();
    const isStaff = currentUser && srv && (
      srv.ownerId === currentUser.id ||
      hasPermission(srv, currentUser.id, 'MANAGE_CHANNELS') ||
      hasPermission(srv, currentUser.id, 'MANAGE_SERVER')
    );

    if (currentView === 'server' && slowmodeCooldownRemaining > 0 && !isStaff) {
      showToast(`Slowmode is active. Wait ${slowmodeCooldownRemaining}s before sending.`, 'warning');
      return;
    }

    if (currentView === 'server') {
      socket.emit('send-message', { serverId: currentServerId, channelId: activeTextChannel, voiceNote: pendingVoiceNote });
      if (currentSlowmodeSeconds > 0 && !isStaff) {
        startSlowmodeCooldown(currentSlowmodeSeconds);
      }
    } else if (activeDmPeerId) {
      const isGroup = String(activeDmPeerId).startsWith('grp_');
      socket.emit('send-dm', { targetId: activeDmPeerId, isGroup, voiceNote: pendingVoiceNote });
    }

    if (pendingVoiceBlobUrl) {
      URL.revokeObjectURL(pendingVoiceBlobUrl);
      pendingVoiceBlobUrl = null;
    }
    pendingVoiceNote = null;
    if (previewVoiceAudio) previewVoiceAudio.src = '';
    if (voicePreviewBanner) voicePreviewBanner.style.display = 'none';
  });
}

// =========================================
// 7. WEBRTC CALLING & RED MUTE BUTTON
// =========================================
window.declineFriendRequest = (requesterId) => {
  if (!requesterId) return;
  socket.emit('decline-friend-request', { requesterId });
  showToast('Friend request cancelled / declined.', 'info');
};

let mediaAcquisitionPromise = null;
async function ensureLocalMediaStream(hasVideo = false) {
  if (mediaAcquisitionPromise) {
    try { await mediaAcquisitionPromise; } catch (e) {}
  }
  const acquire = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Media devices unavailable. Secure context (HTTPS) is required for voice and video.', 'error');
        return false;
      }
      if (!localAudioStream) {
        localAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 2
          },
          video: false
        });
        setupAudioDetection(localAudioStream);
      }
      if (hasVideo && !localVideoStream) {
        localVideoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30 }
          }
        });
        isVideoOn = true;
        if (toggleVideoBtn) toggleVideoBtn.classList.add('active');
        if (stageToggleVideoBtn) stageToggleVideoBtn.classList.add('active');
      }
      return true;
    } catch (err) {
      console.error('ensureLocalMediaStream error:', err);
      showToast('Microphone/Camera permission required: ' + (err.message || 'Permission denied'), 'error');
      return false;
    }
  };
  mediaAcquisitionPromise = acquire();
  try {
    return await mediaAcquisitionPromise;
  } finally {
    mediaAcquisitionPromise = null;
  }
}

async function joinVoiceChannel(channelId, channelName) {
  if (currentVoiceChannel === channelId) {
    openCallStageView();
    return;
  }

  const ok = await ensureLocalMediaStream(false);
  if (!ok) return;

  if (currentVoiceChannel) leaveVoiceChannel(false);

  currentVoiceChannel = channelId;
  currentVoiceChannelLabel.textContent = channelName;
  socket.emit('join-voice', { serverId: currentServerId, channelId });
}

function leaveVoiceChannel(playAudio = true) {
  if (!currentVoiceChannel) return;
  if (playAudio) playChime('leave');

  if (currentVoiceChannel.startsWith('dm_call_')) {
    socket.emit('end-dm-call', { targetId: activeDmPeerId, callChannelId: currentVoiceChannel });
  } else {
    socket.emit('leave-voice');
  }

  // 1. Release Microphone & Audio processing
  if (localAudioStream) {
    localAudioStream.getTracks().forEach(t => {
      try { t.stop(); } catch (e) {}
    });
    localAudioStream = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    try { audioContext.close(); } catch (e) {}
    audioContext = null;
  }
  analyser = null;

  // 2. Release Camera
  if (localVideoStream) {
    localVideoStream.getTracks().forEach(t => {
      try { t.stop(); } catch (e) {}
    });
    localVideoStream = null;
    isVideoOn = false;
    toggleVideoBtn.classList.remove('active');
    stageToggleVideoBtn.classList.remove('active');
  }

  // 3. Release Screen Share
  if (isScreenSharing || localScreenStream) {
    stopScreenShare();
  }

  peerConnections.forEach(pc => {
    try { pc.close(); } catch (e) {}
  });
  peerConnections.clear();
  pendingIceCandidates.clear();

  remoteAudios.forEach(a => {
    try {
      a.srcObject = null;
      a.remove();
    } catch (e) {}
  });
  remoteAudios.clear();
  remoteStreams.clear();
  remoteScreenStreams.clear();

  currentVoiceChannel = null;
  isCallStageActive = false;
  updateVoiceUI();
  callStageScreen.style.display = 'none';
  chatArea.style.display = 'flex';
  renderCategoriesAndChannels();
}

disconnectVoiceBtn.addEventListener('click', () => leaveVoiceChannel(true));
stageDisconnectBtn.addEventListener('click', () => leaveVoiceChannel(true));

function updateVoiceUI() {
  voiceConnectedBar.style.display = currentVoiceChannel ? 'flex' : 'none';
}

function openCallStageView() {
  isCallStageActive = true;
  callStageScreen.style.display = 'flex';
  chatArea.style.display = 'none';

  const srv = getCurrentServer();
  let chName = 'Voice Room';
  if (srv) {
    for (const cat of srv.categories) {
      const ch = cat.channels.find(c => c.id === currentVoiceChannel);
      if (ch) { chName = ch.name; break; }
    }
  } else if (currentVoiceChannel && currentVoiceChannel.startsWith('dm_call_')) {
    if (currentDmGroupMeta) {
      chName = currentDmGroupMeta.name || 'Group Call';
    } else if (activeDmPeerId) {
      const p = accountsMap.get(activeDmPeerId) || currentDmPeerMeta;
      chName = p ? `@${p.username}` : 'Direct Call';
    } else {
      chName = 'Direct Call';
    }
  }
  stageChannelTitle.textContent = chName;
  updateCallGridScaling();
}

voiceBarClickExpand.addEventListener('click', () => {
  if (currentVoiceChannel) openCallStageView();
});

toggleStageChatBtn.addEventListener('click', () => {
  const isMobile = window.innerWidth <= 850;
  if (isMobile) {
    callStageScreen.style.display = 'none';
    chatArea.style.display = 'flex';
    isCallStageActive = false;
  } else {
    if (chatArea.style.display === 'none') {
      chatArea.style.display = 'flex';
      toggleStageChatBtn.querySelector('span').textContent = 'Hide Chat';
    } else {
      chatArea.style.display = 'none';
      toggleStageChatBtn.querySelector('span').textContent = 'Show Chat';
    }
  }
});

toggleFullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) callStageScreen.requestFullscreen().catch(err => {});
  else document.exitFullscreen();
});

function getCallUserMeta(peerId) {
  if (!peerId) return { username: 'User', avatarUrl: null, color: '#5865F2' };
  if (currentUser && peerId === currentUser.id) {
    return {
      username: currentUser.username,
      avatarUrl: currentUser.avatarUrl,
      color: currentUser.color || '#5865F2'
    };
  }
  const acc = accountsMap.get(peerId);
  if (acc) {
    return {
      username: acc.username || ('User_' + String(peerId).substring(0, 4)),
      avatarUrl: acc.avatarUrl || null,
      color: acc.color || '#5865F2'
    };
  }
  if (currentDmPeerMeta && currentDmPeerMeta.id === peerId) {
    return {
      username: currentDmPeerMeta.username || ('User_' + String(peerId).substring(0, 4)),
      avatarUrl: currentDmPeerMeta.avatarUrl || null,
      color: currentDmPeerMeta.color || '#5865F2'
    };
  }
  return {
    username: 'User_' + String(peerId).substring(0, 4),
    avatarUrl: null,
    color: '#5865F2'
  };
}

function updateCallGridScaling() {
  if (!currentVoiceChannel) return;

  let activeScreenId = null;
  let activeScreenLabel = '';
  let activeScreenStream = null;

  // Local screen share check: must be actively sharing with live track
  if (isScreenSharing && localScreenStream) {
    const liveVideoTracks = localScreenStream.getVideoTracks().filter(t => t.readyState === 'live');
    if (liveVideoTracks.length > 0) {
      activeScreenId = currentUser.id;
      activeScreenLabel = `${currentUser.username}'s Screen`;
      activeScreenStream = localScreenStream;
    } else {
      isScreenSharing = false;
      localScreenStream = null;
    }
  }

  // Check remote peers for screen share: peer MUST have isScreenSharing === true AND live track
  if (!activeScreenStream) {
    peerConnections.forEach((pc, peerId) => {
      if (activeScreenStream) return;
      const pState = peerMediaStates.get(peerId);
      if (!pState || !pState.isScreenSharing) return;

      const screenStream = remoteScreenStreams.get(peerId);
      const camStream = remoteStreams.get(peerId);

      let activeStream = null;
      if (screenStream && screenStream.getVideoTracks().some(t => t.readyState === 'live')) {
        activeStream = screenStream;
      } else if (camStream && camStream.getVideoTracks().some(t => t.readyState === 'live')) {
        activeStream = camStream;
        remoteScreenStreams.set(peerId, camStream);
      }

      if (activeStream) {
        const pMeta = getCallUserMeta(peerId);
        activeScreenId = peerId;
        activeScreenLabel = `${pMeta.username}'s Screen`;
        activeScreenStream = activeStream;
      }
    });
  }

  if (activeScreenStream) {
    callVideoGrid.className = 'call-video-grid has-screenshare';

    // 1. Hero Screen Share Card (Dominates 90%+ of stage)
    const screenCard = createScreenShareCard(activeScreenId, activeScreenLabel, activeScreenStream);
    if (!callVideoGrid.contains(screenCard)) {
      callVideoGrid.innerHTML = '';
      callVideoGrid.appendChild(screenCard);
    }

    // 2. Participant Ribbon Strip (Compact horizontal strip)
    let strip = callVideoGrid.querySelector('.call-participants-strip');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'call-participants-strip custom-scroll';
      callVideoGrid.appendChild(strip);
    }

    strip.innerHTML = '';
    const selfCard = createCallParticipantCard(currentUser.id, currentUser.username, currentUser.avatarUrl, currentUser.color, true, isVideoOn, localVideoStream);
    strip.appendChild(selfCard);

    peerConnections.forEach((pc, peerId) => {
      const stream = remoteStreams.get(peerId);
      const pMeta = getCallUserMeta(peerId);
      const hasRemoteCam = Boolean(stream && stream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled !== false));
      const peerCard = createCallParticipantCard(peerId, pMeta.username, pMeta.avatarUrl, pMeta.color, false, hasRemoteCam, stream);
      strip.appendChild(peerCard);
    });
    return;
  } else {
    // Only direct 1-on-1 DM calls (not server channels, not group DMs) use 1-on-1 PiP layout.
    // Server voice channels ALWAYS use the equal participant grid so all members are equal!
    callVideoGrid.innerHTML = '';
    const isDm1on1 = Boolean(currentVoiceChannel && currentVoiceChannel.startsWith('dm_call_') && !currentVoiceChannel.includes('grp_'));
    let singleRemotePeerId = null;
    if (isDm1on1) {
      if (peerConnections.size === 1) {
        singleRemotePeerId = peerConnections.keys().next().value;
      } else if (activeDmPeerId) {
        singleRemotePeerId = activeDmPeerId;
      }
    }

    if (isDm1on1 && singleRemotePeerId && peerConnections.size <= 1) {
      callVideoGrid.className = 'call-video-grid grid-one-on-one';

      const pMeta = getCallUserMeta(singleRemotePeerId);
      const stream = remoteStreams.get(singleRemotePeerId);
      const hasRemoteVideo = Boolean(stream && stream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled !== false));
      const remoteCard = createCallParticipantCard(singleRemotePeerId, pMeta.username, pMeta.avatarUrl, pMeta.color, false, hasRemoteVideo, stream);
      remoteCard.classList.add('main-peer-card');
      callVideoGrid.appendChild(remoteCard);

      const selfCard = createCallParticipantCard(currentUser.id, currentUser.username, currentUser.avatarUrl, currentUser.color, true, isVideoOn, localVideoStream);
      selfCard.classList.add('self-pip-card');
      callVideoGrid.appendChild(selfCard);
      return;
    }

    // Normal multi-user grid (equal cards for everyone in server channels and group calls)
    callVideoGrid.className = 'call-video-grid';
    let totalCards = 0;

    const selfCard = createCallParticipantCard(currentUser.id, currentUser.username, currentUser.avatarUrl, currentUser.color, true, isVideoOn, localVideoStream);
    callVideoGrid.appendChild(selfCard);
    totalCards++;

    peerConnections.forEach((pc, peerId) => {
      totalCards++;
      const stream = remoteStreams.get(peerId);
      const pMeta = getCallUserMeta(peerId);
      const hasRemoteVideo = stream && stream.getVideoTracks().length > 0;
      const peerCard = createCallParticipantCard(peerId, pMeta.username, pMeta.avatarUrl, pMeta.color, false, hasRemoteVideo, stream);
      callVideoGrid.appendChild(peerCard);
    });

    if (totalCards === 1) callVideoGrid.classList.add('grid-1');
    else if (totalCards === 2) callVideoGrid.classList.add('grid-2');
    else if (totalCards <= 4) callVideoGrid.classList.add('grid-4');
    else callVideoGrid.classList.add('grid-many');
  }
}

function createCallParticipantCard(id, username, avatarUrl, color, isSelf, hasVideo, stream) {
  const card = document.createElement('div');
  card.id = `call-card-${id}`;
  card.className = 'call-card';

  if (hasVideo && stream) {
    const vid = document.createElement('video');
    vid.autoplay = true;
    vid.muted = isSelf;
    vid.defaultMuted = isSelf;
    vid.playsInline = true;
    vid.setAttribute('playsinline', 'true');
    vid.setAttribute('webkit-playsinline', 'true');
    vid.srcObject = stream;
    vid.play().catch(() => {});
    card.appendChild(vid);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'call-card-avatar-placeholder';
    if (avatarUrl) {
      placeholder.style.backgroundImage = `url(${resolveMediaUrl(avatarUrl)})`;
      placeholder.style.backgroundSize = 'cover';
      placeholder.style.backgroundPosition = 'center';
    } else {
      placeholder.style.backgroundColor = color || '#5865F2';
      placeholder.textContent = (username || '?').substring(0, 1).toUpperCase();
    }
    card.appendChild(placeholder);
  }

  const tag = document.createElement('div');
  tag.className = 'call-card-tag';
  tag.innerHTML = `<span>${escapeHTML(username)} ${isSelf ? '(You)' : ''}</span>`;
  card.appendChild(tag);
  return card;
}

function createScreenShareCard(id, label, stream) {
  const existingCard = document.getElementById(`screen-card-${id}`);
  const isSelf = currentUser && id === currentUser.id;
  const isAndroidNativeStream = isSelf && window.AndroidNative && typeof window.AndroidNative.isScreenCapturing === 'function' && window.AndroidNative.isScreenCapturing();
  const isTauriNativeStream = isSelf && isTauriDesktop() && isScreenSharing && nativeScreenCanvas;

  if (existingCard) {
    if ((isAndroidNativeStream || isTauriNativeStream) && nativeScreenCanvas) {
      if (!existingCard.contains(nativeScreenCanvas)) {
        existingCard.innerHTML = '';
        nativeScreenCanvas.className = 'screen-canvas-preview';
        existingCard.appendChild(nativeScreenCanvas);
      }
      return existingCard;
    }
    const existingVid = existingCard.querySelector('video');
    if (existingVid) {
      if (existingVid.srcObject !== stream) {
        existingVid.srcObject = stream;
      }
      if (existingVid.paused) {
        existingVid.play().catch(() => {});
      }
      return existingCard;
    }
  }

  const card = document.createElement('div');
  card.id = `screen-card-${id}`;
  card.className = 'call-card screen-share';

  if ((isAndroidNativeStream || isTauriNativeStream) && nativeScreenCanvas) {
    nativeScreenCanvas.className = 'screen-canvas-preview';
    card.appendChild(nativeScreenCanvas);
  } else {
    const vid = document.createElement('video');
    vid.autoplay = true;
    vid.muted = isSelf;
    vid.defaultMuted = isSelf;
    vid.playsInline = true;
    vid.setAttribute('playsinline', 'true');
    vid.setAttribute('webkit-playsinline', 'true');
    vid.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
    vid.setAttribute('disablepictureinpicture', 'true');
    vid.style.objectFit = 'contain';
    vid.style.width = '100%';
    vid.style.height = '100%';
    vid.srcObject = stream;

    const tryPlay = () => {
      const p = vid.play();
      if (p !== undefined) p.catch(() => {});
    };
    tryPlay();
    vid.addEventListener('loadedmetadata', tryPlay);
    card.addEventListener('click', () => {
      if (vid.paused) vid.play();
    });

    card.appendChild(vid);
  }

  const tag = document.createElement('div');
  tag.className = 'call-card-tag';
  tag.innerHTML = `<span>🖥️ ${label}</span> <span class="screen-live-pill">LIVE</span>`;
  card.appendChild(tag);

  // Screen Controls: Pin & Fullscreen Buttons
  const actionsBar = document.createElement('div');
  actionsBar.className = 'screen-actions-bar';

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'screen-action-btn';
  pinBtn.title = 'Pin Screen (Maximize to 100% stage)';
  pinBtn.innerHTML = '<span>📌</span> <span>Pin</span>';
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isPinned = card.classList.toggle('is-pinned');
    pinBtn.classList.toggle('active', isPinned);
    pinBtn.innerHTML = isPinned ? '<span>📌</span> <span>Unpin</span>' : '<span>📌</span> <span>Pin</span>';
    showToast(isPinned ? 'Screen pinned (Theater Mode)' : 'Screen unpinned', 'info');
  });

  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'screen-action-btn';
  fsBtn.title = 'Fullscreen view';
  fsBtn.innerHTML = '<span>⛶</span>';
  fsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      card.requestFullscreen().catch(() => {});
    }
  });

  actionsBar.appendChild(pinBtn);
  actionsBar.appendChild(fsBtn);
  card.appendChild(actionsBar);

  // Double-clicking card toggles pin/theater mode
  card.addEventListener('dblclick', () => pinBtn.click());

  return card;
}

// RED MUTE BUTTON TOGGLES
toggleMicBtn.addEventListener('click', () => {
  if (!localAudioStream) return;
  isMuted = !isMuted;
  localAudioStream.getAudioTracks().forEach(t => t.enabled = !isMuted);

  if (isMuted) {
    toggleMicBtn.classList.add('muted');
    stageToggleMicBtn.classList.add('muted');
    micIcon.style.display = 'none';
    micMutedIcon.style.display = 'block';
  } else {
    toggleMicBtn.classList.remove('muted');
    stageToggleMicBtn.classList.remove('muted');
    micIcon.style.display = 'block';
    micMutedIcon.style.display = 'none';
  }

  playChime('mute');
  socket.emit('voice-status-update', { isMuted });
  renderCategoriesAndChannels();
});

stageToggleMicBtn.addEventListener('click', () => toggleMicBtn.click());

toggleDeafenBtn.addEventListener('click', () => {
  isDeafened = !isDeafened;
  remoteAudios.forEach(a => a.muted = isDeafened);

  if (isDeafened) {
    toggleDeafenBtn.classList.add('muted');
    headphoneIcon.style.display = 'none';
    headphoneDeafenedIcon.style.display = 'block';
  } else {
    toggleDeafenBtn.classList.remove('muted');
    headphoneIcon.style.display = 'block';
    headphoneDeafenedIcon.style.display = 'none';
  }

  playChime('mute');
  if (isDeafened && !isMuted) toggleMicBtn.click();
  socket.emit('voice-status-update', { isDeafened });
  renderCategoriesAndChannels();
});

function optimizeVideoSender(pc, videoTrack) {
  if (!pc || !videoTrack) return;
  try {
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track === videoTrack || (s.track && s.track.kind === 'video'));
    if (videoSender) {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = 2500000;
      params.encodings[0].maxFramerate = 30;
      params.encodings[0].priority = 'high';
      params.degradationPreference = 'maintain-resolution';
      try { params.encodings[0].degradationPreference = 'maintain-resolution'; } catch (e) {}
      videoSender.setParameters(params).catch(() => {});
    }
  } catch (e) {}
}

toggleVideoBtn.addEventListener('click', async () => {
  if (!currentVoiceChannel) return;
  if (isVideoOn) {
    if (localVideoStream) { localVideoStream.getTracks().forEach(t => t.stop()); localVideoStream = null; }
    isVideoOn = false;
    toggleVideoBtn.classList.remove('active');
    stageToggleVideoBtn.classList.remove('active');
    peerConnections.forEach((pc, peerId) => {
      const senders = pc.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        try { videoSender.replaceTrack(null); } catch (e) {}
      }
    });
    socket.emit('media-state-change', { isVideoOn: false });
  } else {
    try {
      localVideoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 30 }
        }
      });
      isVideoOn = true;
      toggleVideoBtn.classList.add('active');
      stageToggleVideoBtn.classList.add('active');
      const videoTrack = localVideoStream.getVideoTracks()[0];
      peerConnections.forEach((pc, peerId) => {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(videoTrack);
          optimizeVideoSender(pc, videoTrack);
        } else {
          pc.addTrack(videoTrack, localVideoStream);
          optimizeVideoSender(pc, videoTrack);
          renegotiatePeer(peerId);
        }
      });
      socket.emit('media-state-change', { isVideoOn: true });
    } catch (err) { showToast('Could not access camera.', 'error'); }
  }
  updateCallGridScaling();
});

stageToggleVideoBtn.addEventListener('click', () => toggleVideoBtn.click());

// Screen Share Setup & Stream Modal
let selectedStreamRes = 1080;
let selectedStreamFps = 30;
let selectedStreamSurface = 'monitor'; // 'monitor', 'window', or 'browser'

document.querySelectorAll('.stream-source-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.stream-source-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    selectedStreamSurface = card.getAttribute('data-surface') || 'monitor';
  });
});

document.querySelectorAll('#stream-res-selector .stream-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#stream-res-selector .stream-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedStreamRes = parseInt(btn.getAttribute('data-res'), 10) || 1080;
  });
});

document.querySelectorAll('#stream-fps-selector .stream-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#stream-fps-selector .stream-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedStreamFps = parseInt(btn.getAttribute('data-fps'), 10) || 30;
  });
});

let nativeCanvasInterval = null;
let nativeScreenImg = null;
let nativeScreenCanvas = null;
let nativeFramePollTimeout = null;

function startNativeAndroidScreenCapture() {
  showToast('Opening Android system permission prompt...', 'info');

  window.__onNativeScreenCaptureStarted = (port = 8765) => {
    try {
      if (!nativeScreenCanvas) {
        nativeScreenCanvas = document.createElement('canvas');
        nativeScreenCanvas.width = 720;
        nativeScreenCanvas.height = 1280;
      }
      const canvas = nativeScreenCanvas;
      const ctx = canvas.getContext('2d');

      isScreenSharing = true;
      toggleScreenBtn.classList.add('active');
      stageToggleScreenBtn.classList.add('active');

      const nativeStream = canvas.captureStream(30);
      localScreenStream = nativeStream;

      const screenTrack = nativeStream.getVideoTracks()[0];
      if (screenTrack) {
        try { screenTrack.contentHint = 'detail'; } catch (e) {}
        screenTrack.onended = () => stopScreenShare();
      }

      peerConnections.forEach((pc, peerId) => {
        pc.addTrack(screenTrack, localScreenStream);
        optimizeScreenSender(pc, screenTrack);
        renegotiatePeer(peerId);
      });

      socket.emit('media-state-change', { isScreenSharing: true });
      updateCallGridScaling();

      // 1. Direct Native Memory Frame Polling (Instant, Zero Network Latency)
      let lastB64 = null;
      let frameCount = 0;
      let isBridgePolling = false;

      const pollBridge = () => {
        if (!isScreenSharing) return;
        try {
          if (!isBridgePolling && window.AndroidNative && typeof window.AndroidNative.getLatestFrame === 'function') {
            const b64 = window.AndroidNative.getLatestFrame();
            if (b64 && b64.length > 50 && b64 !== lastB64) {
              lastB64 = b64;
              isBridgePolling = true;
              const img = new Image();
              img.onload = () => {
                try {
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
                      canvas.width = img.naturalWidth;
                      canvas.height = img.naturalHeight;
                    }
                  }
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                  frameCount++;
                  if (frameCount === 1) {
                    showToast('Screen share live! 🎮', 'success');
                  }
                } catch (e) {}
                isBridgePolling = false;
              };
              img.onerror = () => { isBridgePolling = false; };
              img.src = 'data:image/jpeg;base64,' + b64;
            }
          }
        } catch (e) {
          isBridgePolling = false;
        }
        if (isScreenSharing) {
          nativeFramePollTimeout = setTimeout(pollBridge, 33);
        }
      };
      pollBridge();

      // Debug monitor: after 3 seconds, if 0 frames received, check native debug status
      setTimeout(() => {
        if (isScreenSharing && frameCount === 0 && window.AndroidNative && typeof window.AndroidNative.getDebugStatus === 'function') {
          const st = window.AndroidNative.getDebugStatus();
          console.warn('Native screen capture diagnostic:', st);
          showToast('Screen diagnostic: ' + st, 'warning');
        }
      }, 3000);
    } catch (e) {
      showToast('Native stream capture error: ' + e.message, 'error');
    }
  };

  window.__onNativeScreenCaptureFailed = (reason) => {
    showToast('Screen share cancelled: ' + (reason || 'Permission denied'), 'warning');
  };

  window.__onNativeScreenCaptureStopped = () => {
    if (isScreenSharing) stopScreenShare();
  };

  window.AndroidNative.startScreenCapture();
}

async function startDirectScreenShare(surface = 'monitor', res = 1080, fps = 30) {
  if (!currentVoiceChannel) {
    showToast('Join a voice channel before sharing your screen.', 'error');
    return;
  }

  // 1. Check if running inside native Android hybrid app with MediaProjection bridge!
  if (window.AndroidNative && typeof window.AndroidNative.isNativeApp === 'function' && window.AndroidNative.isNativeApp()) {
    startNativeAndroidScreenCapture();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    showToast('Screen sharing is not supported by your current browser. On mobile, please use Google Chrome on Android 10+.', 'error');
    return;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) {
    showToast('iOS Safari does not permit screen recording in web apps due to Apple limitations.', 'warning');
    return;
  }

  const isMobile = /Android|Mobile|Tablet/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 850);

  let width = 1920, height = 1080;
  if (res === 720) { width = 1280; height = 720; }
  else if (res === 1440) { width = 2560; height = 1440; }

  let stream = null;

  if (isMobile) {
    // Android Chrome requires pure video constraints with NO system audio and no desktop surface properties
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 24, max: 30 }
        }
      });
    } catch (mErr) {
      if (mErr.name === 'NotAllowedError') return;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      } catch (fallbackErr) {
        if (fallbackErr.name === 'NotAllowedError') return;
        showToast('Screen share could not start on phone: ' + (fallbackErr.message || 'Permission denied'), 'error');
        return;
      }
    }
  } else {
    const audioCheckbox = document.getElementById('stream-include-audio');
    const captureAudio = audioCheckbox ? audioCheckbox.checked : true;

    // Desktop: Allow full desktop screensharing (Entire Screen, Window, and Tab) with system audio
    const videoConstraints = {
      width: { ideal: width, max: width },
      height: { ideal: height, max: height },
      frameRate: { ideal: fps, max: fps }
    };

    const mediaOptions = {
      video: videoConstraints,
      audio: captureAudio ? {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
        channelCount: 2
      } : false,
      systemAudio: captureAudio ? 'include' : 'exclude',
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include'
    };

    try {
      stream = await navigator.mediaDevices.getDisplayMedia(mediaOptions);
    } catch (dErr) {
      if (dErr.name === 'NotAllowedError') return;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps, max: fps } },
          audio: captureAudio
        });
      } catch (fallbackErr) {
        if (fallbackErr.name === 'NotAllowedError') return;
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: captureAudio });
        } catch (finalErr) {
          if (finalErr.name === 'NotAllowedError') return;
          showToast('Screen share could not start: ' + (finalErr.message || 'Permission denied'), 'error');
          return;
        }
      }
    }
  }

  if (!stream) return;

  localScreenStream = stream;
  isScreenSharing = true;
  toggleScreenBtn.classList.add('active');
  stageToggleScreenBtn.classList.add('active');
  showToast('Screen sharing started! You are live 🚀', 'success');

  const screenTrack = localScreenStream.getVideoTracks()[0];
  if (screenTrack) {
    try { screenTrack.contentHint = 'detail'; } catch (e) {}
    screenTrack.onended = () => stopScreenShare();
  }

  peerConnections.forEach((pc, peerId) => {
    localScreenStream.getTracks().forEach(t => {
      try { pc.addTrack(t, localScreenStream); } catch (e) {}
    });
    optimizeScreenSender(pc, screenTrack);
    renegotiatePeer(peerId);
  });

  socket.emit('media-state-change', { isScreenSharing: true });
  updateCallGridScaling();
}

// ========================================================
// TAURI NATIVE DESKTOP SCREEN CAPTURE (DISCORD-STYLE)
// ========================================================
function isTauriDesktop() {
  return typeof window.__TAURI__ !== 'undefined' ||
         typeof window.__TAURI_INTERNALS__ !== 'undefined' ||
         window.location.protocol === 'tauri:' ||
         window.location.hostname === 'tauri.localhost' ||
         (window.location.hostname === 'localhost' && window.location.port !== '3000' && !window.AndroidNative);
}

function tauriInvoke(cmd, args) {
  if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
    return window.__TAURI__.core.invoke(cmd, args);
  }
  if (window.__TAURI__ && typeof window.__TAURI__.invoke === 'function') {
    return window.__TAURI__.invoke(cmd, args);
  }
  if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
    return window.__TAURI_INTERNALS__.invoke(cmd, args);
  }
  return Promise.reject(new Error('Tauri IPC invoke not available in this environment'));
}

let tauriDesktopSources = [];
let selectedTauriSourceId = null;
let currentTauriTab = 'screens'; // 'screens' or 'apps'

async function loadTauriDesktopSources() {
  const grid = document.getElementById('tauri-sources-grid');
  if (grid && (!tauriDesktopSources || tauriDesktopSources.length === 0)) {
    grid.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 24px; text-align: center; width: 100%;">Scanning open displays & windows...</div>';
  }
  try {
    const sources = await tauriInvoke('get_desktop_sources');
    if (Array.isArray(sources)) {
      tauriDesktopSources = sources;
      renderTauriSourceList();
    }
  } catch (err) {
    console.error('Failed to get desktop sources:', err);
    if (grid) {
      grid.innerHTML = '<div style="color: var(--status-red); font-size: 13px; padding: 16px; text-align: center; width: 100%;">⚠️ Could not scan desktop windows: ' + (err?.message || err) + '</div>';
    }
  }
}

function renderTauriSourceList() {
  const grid = document.getElementById('tauri-sources-grid');
  const screensCountEl = document.getElementById('count-tauri-screens');
  const appsCountEl = document.getElementById('count-tauri-apps');

  const screens = tauriDesktopSources.filter(s => !s.is_window);
  const apps = tauriDesktopSources.filter(s => s.is_window);

  if (screensCountEl) screensCountEl.textContent = screens.length;
  if (appsCountEl) appsCountEl.textContent = apps.length;

  const currentList = currentTauriTab === 'screens' ? screens : apps;

  if (currentList.length === 0) {
    grid.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 20px; text-align: center; width: 100%;">No ' + (currentTauriTab === 'screens' ? 'displays' : 'application windows') + ' detected.</div>';
    return;
  }

  if (!selectedTauriSourceId || !tauriDesktopSources.find(s => s.id === selectedTauriSourceId)) {
    selectedTauriSourceId = currentList[0].id;
  }

  grid.innerHTML = '';
  currentList.forEach(src => {
    const tile = document.createElement('div');
    tile.className = 'tauri-source-tile' + (src.id === selectedTauriSourceId ? ' active' : '');
    tile.title = `${src.name} (Click to select, double-click to Go Live)`;
    tile.addEventListener('click', () => {
      selectedTauriSourceId = src.id;
      document.querySelectorAll('.tauri-source-tile').forEach(t => t.classList.remove('active'));
      tile.classList.add('active');
    });
    tile.addEventListener('dblclick', () => {
      selectedTauriSourceId = src.id;
      closeModal('screenshare-modal');
      startTauriDesktopScreenCapture(selectedTauriSourceId, selectedStreamRes, selectedStreamFps);
    });

    const thumb = document.createElement('div');
    thumb.className = 'source-tile-thumb';
    if (src.thumbnail) {
      thumb.style.backgroundImage = `url(${src.thumbnail})`;
    } else {
      thumb.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:32px;">${src.is_window ? '🪟' : '🖥️'}</div>`;
    }

    const info = document.createElement('div');
    info.className = 'source-tile-info';
    info.innerHTML = `
      <div class="source-tile-title">${src.name}</div>
      <div class="source-tile-sub">${src.app_name} • ${src.width}x${src.height}</div>
    `;

    tile.appendChild(thumb);
    tile.appendChild(info);
    grid.appendChild(tile);
  });
}

const tabTauriScreens = document.getElementById('tab-tauri-screens');
const tabTauriApps = document.getElementById('tab-tauri-apps');
if (tabTauriScreens) {
  tabTauriScreens.addEventListener('click', () => {
    currentTauriTab = 'screens';
    tabTauriScreens.classList.add('active');
    if (tabTauriApps) tabTauriApps.classList.remove('active');
    renderTauriSourceList();
  });
}
if (tabTauriApps) {
  tabTauriApps.addEventListener('click', () => {
    currentTauriTab = 'apps';
    tabTauriApps.classList.add('active');
    if (tabTauriScreens) tabTauriScreens.classList.remove('active');
    renderTauriSourceList();
  });
}

let tauriScreenAudioCtx = null;
let tauriScreenAudioDest = null;
let tauriScreenAudioNextTime = 0;
let nativeAudioPollTimeout = null;

function processDesktopAudioChunk(b64) {
  if (!b64 || !tauriScreenAudioCtx || !tauriScreenAudioDest) return;
  try {
    const binary = atob(b64);
    const len = binary.length;
    if (len < 8) return; // at least 1 stereo f32 frame (8 bytes)

    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const float32 = new Float32Array(bytes.buffer);
    const numFrames = Math.floor(float32.length / 2);
    if (numFrames <= 0) return;

    const audioBuf = tauriScreenAudioCtx.createBuffer(2, numFrames, 48000);
    const leftData = audioBuf.getChannelData(0);
    const rightData = audioBuf.getChannelData(1);

    for (let i = 0; i < numFrames; i++) {
      leftData[i] = float32[i * 2];
      rightData[i] = float32[i * 2 + 1];
    }

    const srcNode = tauriScreenAudioCtx.createBufferSource();
    srcNode.buffer = audioBuf;
    srcNode.connect(tauriScreenAudioDest);

    const now = tauriScreenAudioCtx.currentTime;
    // Strict real-time sync: clamp drift to maximum 40ms ahead of now so audio never delays
    if (tauriScreenAudioNextTime < now || tauriScreenAudioNextTime > now + 0.05) {
      tauriScreenAudioNextTime = now + 0.015;
    }
    srcNode.start(tauriScreenAudioNextTime);
    tauriScreenAudioNextTime += audioBuf.duration;
  } catch (err) {
    console.warn('Error processing WASAPI audio chunk:', err);
  }
}

async function startTauriDesktopScreenCapture(sourceId, res = 1080, fps = 30) {
  try {
    const audioCheckbox = document.getElementById('stream-include-audio');
    const captureAudio = audioCheckbox ? audioCheckbox.checked : true;

    await tauriInvoke('start_desktop_capture', { sourceId, fps, res, captureAudio });

    if (!nativeScreenCanvas) {
      nativeScreenCanvas = document.createElement('canvas');
    }
    const canvas = nativeScreenCanvas;
    const targetW = res === 720 ? 1280 : (res === 1440 ? 2560 : 1920);
    const targetH = res === 720 ? 720 : (res === 1440 ? 1440 : 1080);
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');

    isScreenSharing = true;
    toggleScreenBtn.classList.add('active');
    stageToggleScreenBtn.classList.add('active');

    const nativeStream = canvas.captureStream(fps);
    localScreenStream = nativeStream;

    // Windows WASAPI Loopback Audio Capture
    if (captureAudio) {
      try {
        if (!tauriScreenAudioCtx || tauriScreenAudioCtx.state === 'closed') {
          tauriScreenAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        }
        if (tauriScreenAudioCtx.state === 'suspended') {
          await tauriScreenAudioCtx.resume();
        }
        tauriScreenAudioDest = tauriScreenAudioCtx.createMediaStreamDestination();
        tauriScreenAudioNextTime = 0;

        const screenAudioTrack = tauriScreenAudioDest.stream.getAudioTracks()[0];
        if (screenAudioTrack) {
          localScreenStream.addTrack(screenAudioTrack);
        }
      } catch (audioErr) {
        console.warn('Could not initialize Web Audio for screen capture:', audioErr);
      }
    }

    const screenTrack = nativeStream.getVideoTracks()[0];
    if (screenTrack) {
      try { screenTrack.contentHint = 'detail'; } catch (e) {}
      screenTrack.onended = () => stopScreenShare();
    }

    peerConnections.forEach((pc, peerId) => {
      localScreenStream.getTracks().forEach(track => {
        pc.addTrack(track, localScreenStream);
      });
      optimizeScreenSender(pc, screenTrack);
      renegotiatePeer(peerId);
    });

    socket.emit('media-state-change', { isScreenSharing: true });
    updateCallGridScaling();

    let isPolling = false;

    const pollDesktopFrame = async () => {
      if (!isScreenSharing) return;
      try {
        if (!isPolling) {
          isPolling = true;
          const raw = await tauriInvoke('get_latest_desktop_frame');
          if (raw) {
            let blob = null;
            if (raw instanceof ArrayBuffer && raw.byteLength > 0) {
              blob = new Blob([raw], { type: 'image/jpeg' });
            } else if (ArrayBuffer.isView(raw) && raw.byteLength > 0) {
              blob = new Blob([raw.buffer], { type: 'image/jpeg' });
            } else if (Array.isArray(raw) && raw.length > 0) {
              blob = new Blob([new Uint8Array(raw)], { type: 'image/jpeg' });
            } else if (typeof raw === 'string' && raw.length > 0) {
              const bin = atob(raw);
              const u8 = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
              blob = new Blob([u8], { type: 'image/jpeg' });
            }
            if (blob) {
              const bitmap = await createImageBitmap(blob);
              ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
              bitmap.close();
            }
          }
          isPolling = false;
        }
      } catch (e) {
        isPolling = false;
      }
      if (isScreenSharing) {
        nativeFramePollTimeout = setTimeout(pollDesktopFrame, 1000 / fps);
      }
    };
    pollDesktopFrame();

    // Poll WASAPI audio packets
    if (captureAudio && tauriScreenAudioDest) {
      const pollDesktopAudio = async () => {
        if (!isScreenSharing) return;
        try {
          const audioB64 = await tauriInvoke('get_desktop_audio_chunk');
          if (audioB64) {
            processDesktopAudioChunk(audioB64);
          }
        } catch (e) {}
        if (isScreenSharing) {
          nativeAudioPollTimeout = setTimeout(pollDesktopAudio, 15);
        }
      };
      pollDesktopAudio();
    }

    showToast('Direct hardware stream active at ' + fps + ' FPS' + (captureAudio ? ' with WASAPI Audio 🔊' : '') + '! 🚀', 'success');
  } catch (err) {
    showToast('Failed to start desktop capture: ' + err, 'error');
  }
}

function openScreenShareSetupModal() {
  // 1. Android Native App: 1-Tap system permission prompt directly
  if (window.AndroidNative && typeof window.AndroidNative.isNativeApp === 'function' && window.AndroidNative.isNativeApp()) {
    startNativeAndroidScreenCapture();
    return;
  }

  // 2. Mobile Browser: Mobile browsers do not support screen streaming
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.innerWidth <= 768 && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
  if (isMobile) {
    showToast('Screen sharing is not supported on mobile web browsers.', 'warning');
    return;
  }

  // 3. Desktop (Tauri & Web Browser): Open Discord-style Hardware Stream Setup Modal
  const modal = document.getElementById('screenshare-modal');
  const tauriContainer = document.getElementById('tauri-source-selector');
  const webContainer = document.getElementById('web-source-cards');
  const hintEl = document.getElementById('stream-system-hint');
  if (tauriContainer) tauriContainer.style.display = 'none';
  if (webContainer) webContainer.style.display = 'grid';
  if (hintEl) {
    hintEl.innerHTML = '<span>⚡</span> <span>GPU Hardware Acceleration: 1080p @ 60 FPS with Direct3D 11 & QuickSync/NVENC.</span>';
  }
  if (modal) modal.style.display = 'flex';
}

async function handleScreenShareToggle() {
  if (!currentVoiceChannel) {
    showToast('Join a voice channel before sharing your screen.', 'error');
    return;
  }

  if (isScreenSharing) {
    const ok = await showConfirmDialog({
      title: 'Stop Screen Share?',
      description: 'Are you sure you want to stop sharing your screen with this voice channel?',
      confirmText: 'Stop Streaming',
      isDanger: true,
      icon: '🖥️'
    });
    if (ok) stopScreenShare();
  } else {
    openScreenShareSetupModal();
  }
}

toggleScreenBtn.addEventListener('click', handleScreenShareToggle);
stageToggleScreenBtn.addEventListener('click', handleScreenShareToggle);

const btnStartStream = document.getElementById('btn-start-stream');
if (btnStartStream) {
  btnStartStream.addEventListener('click', () => {
    closeModal('screenshare-modal');
    startDirectScreenShare(selectedStreamSurface, selectedStreamRes, selectedStreamFps);
  });
}

function stopScreenShare() {
  if (isTauriDesktop()) {
    try {
      tauriInvoke('stop_desktop_capture').catch(() => {});
    } catch (e) {}
  }
  if (window.AndroidNative && typeof window.AndroidNative.stopScreenCapture === 'function' && window.AndroidNative.isScreenCapturing()) {
    try { window.AndroidNative.stopScreenCapture(); } catch (e) {}
  }
  if (nativeFramePollTimeout) {
    clearTimeout(nativeFramePollTimeout);
    nativeFramePollTimeout = null;
  }
  if (nativeAudioPollTimeout) {
    clearTimeout(nativeAudioPollTimeout);
    nativeAudioPollTimeout = null;
  }
  if (tauriScreenAudioDest) {
    try {
      tauriScreenAudioDest.stream.getTracks().forEach(t => t.stop());
    } catch (e) {}
    tauriScreenAudioDest = null;
  }
  if (tauriScreenAudioCtx) {
    try {
      tauriScreenAudioCtx.close().catch(() => {});
    } catch (e) {}
    tauriScreenAudioCtx = null;
  }
  if (nativeCanvasInterval) {
    clearInterval(nativeCanvasInterval);
    nativeCanvasInterval = null;
  }
  if (nativeScreenImg) {
    nativeScreenImg.src = '';
    nativeScreenImg = null;
  }
  if (nativeScreenCanvas && nativeScreenCanvas.parentNode) {
    nativeScreenCanvas.parentNode.removeChild(nativeScreenCanvas);
  }

  if (localScreenStream) {
    localScreenStream.getTracks().forEach(t => {
      try { t.stop(); } catch (e) {}
    });
    peerConnections.forEach((pc, peerId) => {
      const senders = pc.getSenders();
      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'video' && (!isVideoOn || sender.track !== (localVideoStream && localVideoStream.getVideoTracks()[0]))) {
          try { sender.replaceTrack(null); } catch (e) {}
        }
        if (sender.track && sender.track.kind === 'audio' && (!localAudioStream || !localAudioStream.getAudioTracks().includes(sender.track))) {
          try { sender.replaceTrack(null); } catch (e) {}
        }
      });
    });
    localScreenStream = null;
  }
  isScreenSharing = false;
  toggleScreenBtn.classList.remove('active');
  stageToggleScreenBtn.classList.remove('active');
  socket.emit('media-state-change', { isScreenSharing: false });
  updateCallGridScaling();
  showToast('Screen share stopped.', 'info');
}

function boostVideoBitrateInSdp(sdp) {
  // Let WebRTC handle congestion control dynamically; do not force b=AS/b=TIAS which causes packet loss & bufferbloat
  return sdp;
}

function optimizeOpusAudioInSdp(sdp) {
  if (!sdp || typeof sdp !== 'string') return sdp;
  return sdp.replace(/(a=fmtp:\d+ .*)/g, (match) => {
    if (match.includes('opus') || match.includes('minptime')) {
      if (!match.includes('stereo=1')) match += ';stereo=1;sprop-stereo=1';
      if (!match.includes('maxaveragebitrate')) match += ';maxaveragebitrate=128000;cbr=0;useinbandfec=1';
    }
    return match;
  });
}

function optimizeScreenSender(pc, screenTrack, res = selectedStreamRes || 1080, fps = selectedStreamFps || 60) {
  if (!pc || !screenTrack) return;
  try {
    try { screenTrack.contentHint = 'detail'; } catch (e) {}
    const senders = pc.getSenders();
    const screenSender = senders.find(s => s.track === screenTrack || (s.track && s.track.kind === 'video' && s.track.id === screenTrack.id));
    if (screenSender) {
      const params = screenSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      // Discord-standard balanced bitrates to prevent bufferbloat and packet drops:
      let targetBitrate = 1800000; // 1.8 Mbps default
      if (res >= 1080 && fps >= 60) {
        targetBitrate = 2800000; // 2.8 Mbps for 1080p 60fps (Discord Nitro standard)
      } else if (res >= 1080) {
        targetBitrate = 2000000; // 2.0 Mbps for 1080p 30fps
      } else if (res <= 720) {
        targetBitrate = 1200000; // 1.2 Mbps for 720p
      }
      params.encodings[0].maxBitrate = targetBitrate;
      params.encodings[0].maxFramerate = fps;
      params.encodings[0].priority = 'medium';
      params.degradationPreference = 'balanced';
      try { params.encodings[0].degradationPreference = 'balanced'; } catch (e) {}
      screenSender.setParameters(params).catch(() => {});
    }
  } catch (e) {}
}

async function renegotiatePeer(peerId) {
  const pc = peerConnections.get(peerId);
  if (!pc || ['closed', 'failed'].includes(pc.connectionState)) return;
  if (pc.signalingState !== 'stable') {
    const onStable = () => {
      if (pc.signalingState === 'stable') {
        pc.removeEventListener('signalingstatechange', onStable);
        renegotiatePeer(peerId);
      }
    };
    pc.addEventListener('signalingstatechange', onStable);
    return;
  }
  try {
    const offer = await pc.createOffer();
    if (offer.sdp) offer.sdp = optimizeOpusAudioInSdp(offer.sdp);
    if (pc.signalingState !== 'stable') return;
    await pc.setLocalDescription(offer);
    if (localScreenStream) {
      const screenTrack = localScreenStream.getVideoTracks()[0];
      optimizeScreenSender(pc, screenTrack);
    }
    if (localVideoStream) {
      const videoTrack = localVideoStream.getVideoTracks()[0];
      optimizeVideoSender(pc, videoTrack);
    }
    socket.emit('signal-offer', { targetId: peerId, offer });
  } catch (err) {
    console.warn('Renegotiation failed for peer:', peerId, err);
  }
}

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(rtcConfig);
  if (localAudioStream) {
    localAudioStream.getTracks().forEach(t => {
      const sender = pc.addTrack(t, localAudioStream);
      try {
        const p = sender.getParameters();
        if (p.encodings && p.encodings[0]) {
          p.encodings[0].priority = 'very-high';
          sender.setParameters(p).catch(() => {});
        }
      } catch (e) {}
    });
  }
  if (localVideoStream) {
    localVideoStream.getTracks().forEach(t => pc.addTrack(t, localVideoStream));
    const vt = localVideoStream.getVideoTracks()[0];
    if (vt) optimizeVideoSender(pc, vt);
  }
  if (localScreenStream) {
    localScreenStream.getTracks().forEach(t => pc.addTrack(t, localScreenStream));
    const st = localScreenStream.getVideoTracks()[0];
    if (st) optimizeScreenSender(pc, st);
  }

  // If local user has no video track yet, add recvonly video transceivers so incoming video/screenshare is negotiated
  const hasLocalVideo = (localVideoStream && localVideoStream.getVideoTracks().length > 0) || (localScreenStream && localScreenStream.getVideoTracks().length > 0);
  if (!hasLocalVideo) {
    try {
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
    } catch (e) {}
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('signal-ice', { targetId: peerId, candidate: e.candidate });
  };

  pc.ontrack = (e) => {
    if (e.track.kind === 'audio') {
      const streamId = (e.streams[0] && e.streams[0].id) ? e.streams[0].id : 'stream';
      const audioKey = `${peerId}_${streamId}_${e.track.id}`;
      let a = remoteAudios.get(audioKey);
      if (!a) {
        a = document.createElement('audio');
        a.autoplay = true;
        a.playsInline = true;
        a.setAttribute('playsinline', '');
        a.setAttribute('webkit-playsinline', '');
        a.muted = isDeafened;
        remoteAudioContainer.appendChild(a);
        remoteAudios.set(audioKey, a);
      }
      a.srcObject = e.streams[0] || new MediaStream([e.track]);
      const tryPlay = () => {
        const p = a.play();
        if (p !== undefined) {
          p.catch(() => {
            const unlock = () => {
              a.play().catch(() => {});
              document.removeEventListener('click', unlock);
              document.removeEventListener('touchstart', unlock);
            };
            document.addEventListener('click', unlock, { once: true });
            document.addEventListener('touchstart', unlock, { once: true });
          });
        }
      };
      tryPlay();
    } else if (e.track.kind === 'video') {
      const vStream = (e.streams && e.streams[0]) ? e.streams[0] : new MediaStream([e.track]);
      try { e.track.contentHint = 'detail'; } catch (err) {}
      const pState = peerMediaStates.get(peerId);
      if (pState?.isScreenSharing || remoteStreams.has(peerId)) {
        remoteScreenStreams.set(peerId, vStream);
      } else {
        remoteStreams.set(peerId, vStream);
      }
      e.track.onunmute = () => {
        updateCallGridScaling();
      };
      e.track.onmute = () => {
        // Track mute in WebRTC is temporary (e.g. static screen or packet jitter).
        // Never delete streams here!
      };
      e.track.onended = () => {
        remoteStreams.delete(peerId);
        remoteScreenStreams.delete(peerId);
        updateCallGridScaling();
      };
      updateCallGridScaling();
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected') {
      // Temporary network fluctuation or screen share bitrate change.
      // Do NOT kill the call! Attempt ICE restart after 5s if still disconnected.
      if (!pc._iceRestartTimer) {
        pc._iceRestartTimer = setTimeout(() => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            try { pc.restartIce(); } catch (e) {}
            renegotiatePeer(peerId);
          }
          pc._iceRestartTimer = null;
        }, 5000);
      }
    } else if (pc.connectionState === 'connected') {
      if (pc._iceRestartTimer) {
        clearTimeout(pc._iceRestartTimer);
        pc._iceRestartTimer = null;
      }
    } else if (pc.connectionState === 'failed') {
      // Seamless ICE restart rather than dropping the call:
      try { pc.restartIce(); } catch (e) {}
      renegotiatePeer(peerId);
    } else if (pc.connectionState === 'closed') {
      closePeerConnection(peerId);
    }
  };

  peerConnections.set(peerId, pc);
  return pc;
}

async function initiatePeerCall(peerId) {
  const pc = createPeerConnection(peerId);
  try {
    const offer = await pc.createOffer();
    if (offer.sdp) offer.sdp = optimizeOpusAudioInSdp(offer.sdp);
    await pc.setLocalDescription(offer);
    if (localScreenStream) {
      const screenTrack = localScreenStream.getVideoTracks()[0];
      optimizeScreenSender(pc, screenTrack);
    }
    if (localVideoStream) {
      const videoTrack = localVideoStream.getVideoTracks()[0];
      optimizeVideoSender(pc, videoTrack);
    }
    socket.emit('signal-offer', { targetId: peerId, offer });
  } catch (err) {}
}

async function handlePeerOffer(senderId, offer) {
  await ensureLocalMediaStream(false);
  let pc = peerConnections.get(senderId);
  if (!pc || ['closed', 'failed'].includes(pc.connectionState)) {
    pc = createPeerConnection(senderId);
  }
  try {
    if (pc.signalingState !== 'stable') {
      try {
        await pc.setLocalDescription({ type: 'rollback' });
      } catch (rbErr) {}
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await drainPendingIceCandidates(senderId);
    const answer = await pc.createAnswer();
    if (answer.sdp) answer.sdp = optimizeOpusAudioInSdp(answer.sdp);
    await pc.setLocalDescription(answer);
    if (localScreenStream) {
      const screenTrack = localScreenStream.getVideoTracks()[0];
      optimizeScreenSender(pc, screenTrack);
    }
    if (localVideoStream) {
      const videoTrack = localVideoStream.getVideoTracks()[0];
      optimizeVideoSender(pc, videoTrack);
    }
    socket.emit('signal-answer', { targetId: senderId, answer });
  } catch (err) {
    console.warn('handlePeerOffer failed:', senderId, err);
  }
}

function closePeerConnection(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) { pc.close(); peerConnections.delete(peerId); }
  remoteAudios.forEach((a, k) => {
    if (k === peerId || k.startsWith(peerId + '_')) {
      a.srcObject = null;
      a.remove();
      remoteAudios.delete(k);
    }
  });
  remoteStreams.delete(peerId);
  remoteScreenStreams.delete(peerId);
  updateCallGridScaling();
}

function setupAudioDetection(stream) {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const bufLen = analyser.frequencyBinCount;
    const dataArr = new Uint8Array(bufLen);

    const check = () => {
      if (!isMuted && currentVoiceChannel) {
        analyser.getByteFrequencyData(dataArr);
        let sum = 0;
        for (let i = 0; i < bufLen; i++) sum += dataArr[i];
        if (sum / bufLen > 15) {
          if (!isSpeaking) {
            isSpeaking = true;
            updateSpeakingState(true);
          }
          clearTimeout(speakingTimeout);
          speakingTimeout = setTimeout(() => {
            isSpeaking = false;
            updateSpeakingState(false);
          }, 350);
        }
      }
      requestAnimationFrame(check);
    };
    check();
  } catch (e) {}
}

function updateSpeakingState(speaking) {
  if (currentUser) {
    updatePeerSpeakingVisual(currentUser.id, speaking);
    selfAvatar.classList.toggle('speaking', speaking);
    const selfCard = document.getElementById(`call-card-${currentUser.id}`);
    if (selfCard) selfCard.classList.toggle('speaking', speaking);
    socket.emit('voice-status-update', { isSpeaking: speaking });
  }
}

function updatePeerSpeakingVisual(userId, speaking) {
  const v = document.getElementById(`v-avatar-${userId}`);
  if (v) v.classList.toggle('speaking', speaking);
  const m = document.getElementById(`m-avatar-${userId}`);
  if (m) m.classList.toggle('speaking', speaking);
  const card = document.getElementById(`call-card-${userId}`);
  if (card) card.classList.toggle('speaking', speaking);
}

// Helper functions to update Settings Modal Avatar and Banner Previews
function updateSettingsAvatarPreview(url) {
  const avatarPreview = document.getElementById('settings-avatar-preview');
  const btnRemove = document.getElementById('btn-remove-avatar');
  if (btnRemove) btnRemove.style.display = url ? 'inline-block' : 'none';
  if (!avatarPreview) return;
  if (url) {
    avatarPreview.style.backgroundImage = `url("${url}")`;
    avatarPreview.style.backgroundColor = 'transparent';
    avatarPreview.textContent = '';
  } else {
    avatarPreview.style.backgroundImage = 'none';
    avatarPreview.style.backgroundColor = (currentUser && currentUser.color) || '#5865F2';
    avatarPreview.textContent = ((currentUser && currentUser.username) || 'U').substring(0, 2).toUpperCase();
  }
}

function updateSettingsBannerPreview(url, color) {
  const bannerPreview = document.getElementById('settings-banner-preview');
  const btnRemove = document.getElementById('btn-remove-banner');
  if (btnRemove) btnRemove.style.display = url ? 'inline-block' : 'none';
  if (!bannerPreview) return;
  if (url) {
    bannerPreview.style.backgroundImage = `url("${url}")`;
    bannerPreview.style.backgroundColor = color || '#5865F2';
  } else {
    bannerPreview.style.backgroundImage = 'none';
    bannerPreview.style.backgroundColor = color || '#5865F2';
  }
}

// Open User Profile Settings Modal
function openUserSettingsModal() {
  if (!currentUser) return;
  document.getElementById('settings-username').value = currentUser.username || '';
  document.getElementById('settings-status').value = currentUser.customStatus || '';
  
  const bioEl = document.getElementById('settings-bio');
  if (bioEl) bioEl.value = currentUser.bio || '';

  draftAvatarUrl = currentUser.avatarUrl || null;
  updateSettingsAvatarPreview(draftAvatarUrl);

  draftBannerUrl = currentUser.bannerUrl || null;
  draftBannerColor = currentUser.bannerColor || '#5865F2';

  const bannerColorInput = document.getElementById('settings-banner-color');
  if (bannerColorInput) bannerColorInput.value = draftBannerColor;

  updateSettingsBannerPreview(draftBannerUrl, draftBannerColor);

  // Google Account Sync state
  const googleStatus = document.getElementById('settings-google-status');
  const googleBtn = document.getElementById('btn-link-google');
  if (googleStatus && googleBtn) {
    if (currentUser.googleEmail) {
      googleStatus.textContent = `Linked: ${currentUser.googleEmail}`;
      googleBtn.textContent = 'Linked ✓';
      googleBtn.disabled = true;
    } else {
      googleStatus.textContent = 'Not Linked to Google';
      googleBtn.textContent = 'Link Google Account';
      googleBtn.disabled = false;
    }
  }

  document.getElementById('profile-settings-modal').style.display = 'flex';
}

// User Profile Panel (Discord bottom bar click opens profile card modal with banner)
userProfileBtn.addEventListener('click', () => {
  if (currentUser) {
    openUserProfileCard(currentUser);
  }
});

// Gear icon directly opens settings modal to edit profile & banner
const userSettingsGearBtn = document.getElementById('user-settings-gear-btn');
if (userSettingsGearBtn) {
  userSettingsGearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openUserSettingsModal();
  });
}

// Avatar upload (local file / GIF only)
const btnTriggerAvatarFile = document.getElementById('btn-trigger-avatar-file');
const avatarFileInput = document.getElementById('settings-avatar-file');
if (btnTriggerAvatarFile && avatarFileInput) {
  btnTriggerAvatarFile.addEventListener('click', () => {
    avatarFileInput.value = '';
    avatarFileInput.click();
  });
  avatarFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const res = await compressImage(file, 256, 256, 0.85);
    if (res) {
      draftAvatarUrl = res;
      updateSettingsAvatarPreview(draftAvatarUrl);
    }
  });
}

const btnRemoveAvatar = document.getElementById('btn-remove-avatar');
if (btnRemoveAvatar) {
  btnRemoveAvatar.addEventListener('click', () => {
    draftAvatarUrl = null;
    if (avatarFileInput) avatarFileInput.value = '';
    updateSettingsAvatarPreview(null);
  });
}

// Banner upload (local file / GIF only) & theme color
const btnTriggerBannerFile = document.getElementById('btn-trigger-banner-file');
const bannerFileInput = document.getElementById('settings-banner-file');
if (btnTriggerBannerFile && bannerFileInput) {
  btnTriggerBannerFile.addEventListener('click', () => {
    bannerFileInput.value = '';
    bannerFileInput.click();
  });
  bannerFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const res = await compressImage(file, 960, 320, 0.82);
    if (res) {
      draftBannerUrl = res;
      updateSettingsBannerPreview(draftBannerUrl, draftBannerColor);
    }
  });
}

const bannerColorInput = document.getElementById('settings-banner-color');
if (bannerColorInput) {
  bannerColorInput.addEventListener('input', (e) => {
    draftBannerColor = e.target.value;
    updateSettingsBannerPreview(draftBannerUrl, draftBannerColor);
  });
}

const btnRemoveBanner = document.getElementById('btn-remove-banner');
if (btnRemoveBanner) {
  btnRemoveBanner.addEventListener('click', () => {
    draftBannerUrl = null;
    if (bannerFileInput) bannerFileInput.value = '';
    updateSettingsBannerPreview(null, draftBannerColor);
  });
}

const btnLinkGoogle = document.getElementById('btn-link-google');
if (btnLinkGoogle) {
  btnLinkGoogle.addEventListener('click', () => {
    const googleEmail = prompt('Enter Google Account email to link with VoxLink (e.g. user@gmail.com):');
    if (googleEmail && googleEmail.includes('@')) {
      socket.emit('link-google-account', { googleEmail });
    }
  });
}

document.getElementById('profile-settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const uname = document.getElementById('settings-username').value.trim();
  const cstatus = document.getElementById('settings-status').value.trim();
  const bio = document.getElementById('settings-bio') ? document.getElementById('settings-bio').value.trim() : '';

  if (!uname) return;

  // Optimistically update currentUser and accountsMap immediately without waiting or reloading
  if (currentUser) {
    currentUser.username = uname;
    currentUser.customStatus = cstatus;
    currentUser.bio = bio;
    currentUser.avatarUrl = draftAvatarUrl;
    currentUser.bannerUrl = draftBannerUrl;
    currentUser.bannerColor = draftBannerColor;
    accountsMap.set(currentUser.id, { ...currentUser });
    updateSelfProfileUI();
    renderMembers();

    // Propagate avatar & username update to all previously rendered messages by this user!
    document.querySelectorAll(`.message-row[data-sender-id="${currentUser.id}"]`).forEach(row => {
      const avatarEl = row.querySelector('.message-avatar');
      if (avatarEl) {
        if (currentUser.avatarUrl) {
          avatarEl.style.backgroundImage = `url("${currentUser.avatarUrl}")`;
          avatarEl.style.backgroundColor = 'transparent';
          avatarEl.textContent = '';
        } else {
          avatarEl.style.backgroundImage = 'none';
          avatarEl.style.backgroundColor = currentUser.color || '#5865F2';
          avatarEl.textContent = currentUser.username.substring(0, 1).toUpperCase();
        }
      }
      const authorEl = row.querySelector('.message-author');
      if (authorEl) authorEl.textContent = currentUser.username;
    });

    // If profile card modal is currently open, refresh it immediately with new banner & avatar!
    const profileCardModal = document.getElementById('user-profile-panel-modal');
    if (profileCardModal && profileCardModal.style.display !== 'none' && activeProfileUser && activeProfileUser.id === currentUser.id) {
      openUserProfileCard(currentUser);
    }
  }

  socket.emit('update-profile', {
    username: uname,
    customStatus: cstatus,
    avatarUrl: draftAvatarUrl,
    bannerUrl: draftBannerUrl,
    bannerColor: draftBannerColor,
    bio: bio
  });
  closeModal('profile-settings-modal');
  showToast('Profile and banner updated successfully! ✨', 'success');
});
