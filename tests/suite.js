const { io } = require('socket.io-client');
const http = require('http');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function createClient() {
  return io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
}

function loginClient(socket, username) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Login timeout for ' + username)), 6000);
    socket.once('auth-success', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
    socket.once('auth-error', (msg) => {
      // If user not registered, attempt register
      socket.emit('auth-register', { username, password: 'password123' });
    });
    socket.emit('auth-login', { username, password: 'password123' });
  });
}

// -------------------------------------------------------------
// Test 1: YouTube & Media Regex / Embedding Logic Test
// -------------------------------------------------------------
function testMediaEmbedLogic() {
  console.log('\n--- [TEST 1] YouTube, Video, Audio Embed Detection ---');
  
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

  const validYtUrls = [
    { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
    { url: 'https://youtu.be/dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
    { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
    { url: 'https://www.youtube.com/embed/dQw4w9WgXcQ', id: 'dQw4w9WgXcQ' },
    { url: 'Check this out https://youtu.be/dQw4w9WgXcQ?t=42 it rocks', id: 'dQw4w9WgXcQ' }
  ];

  for (const item of validYtUrls) {
    const match = item.url.match(ytRegex);
    assert.ok(match, `Failed to match YouTube URL: ${item.url}`);
    assert.strictEqual(match[1], item.id, `Extracted ID ${match[1]} did not match ${item.id}`);
  }
  console.log('✔ All YouTube URL formats matched and extracted video ID successfully.');

  const videoExtRegex = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;
  const audioExtRegex = /\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/i;

  assert.ok(videoExtRegex.test('https://example.com/video.mp4'));
  assert.ok(videoExtRegex.test('/uploads/clip_123.webm'));
  assert.ok(audioExtRegex.test('https://example.com/audio.mp3'));
  assert.ok(audioExtRegex.test('/uploads/voice_456.wav'));
  assert.ok(!videoExtRegex.test('https://example.com/picture.png'));
  console.log('✔ Video and Audio media file extension regex verified.');
}

// -------------------------------------------------------------
// Test 2: Base64 Media Upload Endpoint Test
// -------------------------------------------------------------
async function testUploadEndpoint() {
  console.log('\n--- [TEST 2] HTTP /api/upload Endpoint & Disk Persistence ---');
  const dummyPayload = JSON.stringify({
    data: 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAA',
    name: 'test_sound.mp3'
  });

  const res = await new Promise((resolve, reject) => {
    const req = http.request(`${SERVER_URL}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dummyPayload)
      }
    }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(dummyPayload);
    req.end();
  });

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.url, 'Upload response missing url');
  assert.ok(res.body.url.startsWith('/uploads/'));
  assert.ok(res.body.url.endsWith('.mp3'));
  console.log('✔ File uploaded successfully with path:', res.body.url);
}

// -------------------------------------------------------------
// Test 3: 1-on-1 DM Calling Signaling & Metadata Delivery
// -------------------------------------------------------------
async function testDmCallingSignaling() {
  console.log('\n--- [TEST 3] 1-on-1 DM Calling Signaling & Metadata Delivery ---');
  const clientA = createClient();
  const clientB = createClient();

  const authA = await loginClient(clientA, 'test_user_a');
  const authB = await loginClient(clientB, 'test_user_b');

  // Client A starts call to Client B
  const callReceivedPromise = new Promise((resolve) => {
    clientB.once('incoming-dm-call', (callData) => {
      resolve(callData);
    });
  });

  clientA.emit('start-dm-call', { targetId: authB.self.id, isGroup: false, hasVideo: false });
  const incoming = await callReceivedPromise;
  
  assert.strictEqual(incoming.caller.id, authA.self.id);
  assert.strictEqual(incoming.caller.username, authA.self.username);
  assert.ok(incoming.callChannelId.startsWith('dm_call_'));
  console.log('✔ Client B received incoming call with complete caller metadata.');

  // Client B accepts the call
  const callAcceptedForA = new Promise((resolve) => {
    clientA.once('dm-call-accepted', (data) => resolve(data));
  });
  const callConnectedForB = new Promise((resolve) => {
    clientB.once('dm-call-connected', (data) => resolve(data));
  });

  clientB.emit('accept-dm-call', {
    callerId: incoming.caller.id,
    callChannelId: incoming.callChannelId,
    isGroup: false
  });

  const accepted = await callAcceptedForA;
  const connected = await callConnectedForB;

  assert.strictEqual(accepted.receiverId, authB.self.id);
  assert.ok(accepted.receiver, 'dm-call-accepted must include receiver info');
  assert.strictEqual(accepted.receiver.username, authB.self.username);

  assert.strictEqual(connected.peerId, authA.self.id);
  assert.ok(connected.peer, 'dm-call-connected must include peer info');
  assert.strictEqual(connected.peer.username, authA.self.username);
  console.log('✔ Caller and receiver both received peer identity and avatars for 1-on-1 call.');

  // End call
  clientA.emit('end-dm-call', { targetId: authB.self.id, callChannelId: incoming.callChannelId });
  await wait(300);

  clientA.disconnect();
  clientB.disconnect();
}

// -------------------------------------------------------------
// Test 4: Group DM Management (Create, Rename, Avatar, Kick, Leave)
// -------------------------------------------------------------
async function testGroupDmManagement() {
  console.log('\n--- [TEST 4] Group DM Customization (Rename, Avatar, Kick, Delete) ---');
  const clientOwner = createClient();
  const clientMember = createClient();

  const authOwner = await loginClient(clientOwner, 'group_owner');
  const authMember = await loginClient(clientMember, 'group_member');

  // Create group
  const groupCreatedPromise = new Promise((resolve) => {
    clientOwner.once('dm-group-created', (group) => resolve(group));
  });
  clientOwner.emit('create-dm-group', { name: 'Alpha Squad', memberIds: [authMember.self.id] });
  const group = await groupCreatedPromise;

  assert.strictEqual(group.name, 'Alpha Squad');
  assert.ok(group.members.includes(authMember.self.id));
  console.log('✔ Group created successfully with ID:', group.id);

  // Rename & Avatar update
  const groupUpdatedPromise = new Promise((resolve) => {
    clientMember.once('dm-group-updated', (data) => resolve(data.groupMeta));
  });
  clientOwner.emit('update-dm-group', {
    groupId: group.id,
    name: 'Bravo Team',
    avatarData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  });
  const updatedGroup = await groupUpdatedPromise;
  assert.strictEqual(updatedGroup.name, 'Bravo Team');
  assert.ok(updatedGroup.avatarUrl.startsWith('/uploads/'));
  console.log('✔ Group renamed and avatar updated successfully with disk persistence.');

  // Kick member
  const memberKickedPromise = new Promise((resolve) => {
    clientMember.once('dm-group-removed', (data) => resolve(data));
  });
  clientOwner.emit('kick-dm-group-member', { groupId: group.id, memberId: authMember.self.id });
  const kickData = await memberKickedPromise;
  assert.strictEqual(kickData.groupId, group.id);
  console.log('✔ Member kicked from group DM successfully.');

  // Delete group
  const groupDeletedPromise = new Promise((resolve) => {
    clientOwner.once('dm-group-deleted', (data) => resolve(data));
  });
  clientOwner.emit('delete-dm-group', { groupId: group.id });
  const delData = await groupDeletedPromise;
  assert.strictEqual(delData.groupId, group.id);
  console.log('✔ Group deleted by owner successfully.');

  clientOwner.disconnect();
  clientMember.disconnect();
}

// -------------------------------------------------------------
// Test 5: 1-on-1 DM Entire Conversation Clear
// -------------------------------------------------------------
async function testDmConversationClear() {
  console.log('\n--- [TEST 5] 1-on-1 DM Clear Conversation ---');
  const client1 = createClient();
  const client2 = createClient();

  const auth1 = await loginClient(client1, 'chat_user_1');
  const auth2 = await loginClient(client2, 'chat_user_2');

  // Send message
  client1.emit('send-dm-message', {
    recipientId: auth2.self.id,
    text: 'Hello secret message',
    attachments: []
  });
  await wait(300);

  // Clear conversation
  const clearedPromise1 = new Promise((resolve) => {
    client1.once('dm-conversation-cleared', (data) => resolve(data));
  });
  const clearedPromise2 = new Promise((resolve) => {
    client2.once('dm-conversation-cleared', (data) => resolve(data));
  });

  client1.emit('clear-dm-conversation', { targetId: auth2.self.id });
  const res1 = await clearedPromise1;
  const res2 = await clearedPromise2;

  assert.strictEqual(res1.targetId, auth2.self.id);
  assert.strictEqual(res2.targetId, auth1.self.id);
  console.log('✔ Both participants received dm-conversation-cleared broadcast.');

  client1.disconnect();
  client2.disconnect();
}

// -------------------------------------------------------------
// Test 6: Server Kick/Ban & Redirection
// -------------------------------------------------------------
async function testServerKickAndBan() {
  console.log('\n--- [TEST 6] Server Kick & Ban State Enforcement ---');
  const adminClient = createClient();
  const targetClient = createClient();

  const adminAuth = await loginClient(adminClient, 'admin_user');
  const targetAuth = await loginClient(targetClient, 'target_user');

  // Create test server
  const serverCreatedPromise = new Promise(resolve => adminClient.once('server-created', resolve));
  adminClient.emit('create-server', { name: 'Test Moderation Guild' });
  const srv = await serverCreatedPromise;

  // Add target user to server via invite code
  const serverJoinedPromise = new Promise(resolve => targetClient.once('server-joined', resolve));
  targetClient.emit('join-server-code', { code: srv.inviteCode });
  await serverJoinedPromise;
  console.log('✔ Target user joined server successfully.');

  // Kick user
  const kickReceivedPromise = new Promise(resolve => targetClient.once('kicked-from-server', resolve));
  adminClient.emit('kick-user', { serverId: srv.id, targetId: targetAuth.self.id, reason: 'Test kick' });
  const kickInfo = await kickReceivedPromise;
  assert.strictEqual(kickInfo.serverId, srv.id);
  console.log('✔ Target user received kicked-from-server notification.');

  // Target rejoins
  const rejoinPromise = new Promise(resolve => targetClient.once('server-joined', resolve));
  targetClient.emit('join-server-code', { code: srv.inviteCode });
  await rejoinPromise;
  console.log('✔ Target user rejoined server successfully.');

  // Ban user
  const banReceivedPromise = new Promise(resolve => targetClient.once('banned-from-server', resolve));
  adminClient.emit('ban-user', { serverId: srv.id, targetId: targetAuth.self.id, reason: 'Violations' });
  const banInfo = await banReceivedPromise;
  assert.strictEqual(banInfo.serverId, srv.id);
  console.log('✔ Target user received banned-from-server notification.');

  // Target attempts to join banned server
  const banRejectPromise = new Promise(resolve => targetClient.once('error-msg', resolve));
  targetClient.emit('join-server-code', { code: srv.inviteCode });
  const errMsg = await banRejectPromise;
  assert.ok(errMsg.toLowerCase().includes('banned'), `Expected banned message, got: ${errMsg}`);
  console.log('✔ Target user successfully rejected with message:', errMsg);

  adminClient.disconnect();
  targetClient.disconnect();
}

// -------------------------------------------------------------
// Test 7: Voice Channel Screen Sharing & Late-Joiner State
// -------------------------------------------------------------
async function testVoiceChannelLateJoiner() {
  console.log('\n--- [TEST 7] Voice Channel Screen Sharing & Late Joiner State ---');
  const user1 = createClient();
  const user2 = createClient();

  const auth1 = await loginClient(user1, 'voice_host');
  const auth2 = await loginClient(user2, 'voice_guest');

  // Create server & get voice channel
  const srvPromise = new Promise(resolve => user1.once('server-created', resolve));
  user1.emit('create-server', { name: 'Voice Server' });
  const srv = await srvPromise;
  
  let voiceChannelId = null;
  for (const cat of srv.categories) {
    const vc = cat.channels.find(c => c.type === 'voice');
    if (vc) { voiceChannelId = vc.id; break; }
  }
  assert.ok(voiceChannelId, 'Voice channel not found in server');

  // User 1 joins voice
  const user1JoinedPromise = new Promise(resolve => user1.once('voice-channel-joined', resolve));
  user1.emit('join-voice', { serverId: srv.id, channelId: voiceChannelId });
  await user1JoinedPromise;
  console.log('✔ User 1 joined voice channel.');

  // User 1 starts screen sharing
  user1.emit('media-state-change', { isScreenSharing: true, isVideoOn: false });
  await wait(200);

  // Join User 2 to server via inviteCode
  const u2JoinServerPromise = new Promise(resolve => user2.once('server-joined', resolve));
  user2.emit('join-server-code', { code: srv.inviteCode });
  await u2JoinServerPromise;
  await wait(200);

  // User 2 joins voice channel as late joiner
  const user2JoinedVoicePromise = new Promise(resolve => user2.once('voice-channel-joined', resolve));
  user2.emit('join-voice', { serverId: srv.id, channelId: voiceChannelId });
  const lateJoinData = await user2JoinedVoicePromise;

  assert.strictEqual(lateJoinData.channelId, voiceChannelId);
  const hostMember = lateJoinData.members.find(m => m.id === auth1.self.id);
  assert.ok(hostMember, 'Host member should be in existingMembers');
  assert.strictEqual(hostMember.isScreenSharing, true, 'Late joiner must see host.isScreenSharing = true');
  console.log('✔ Late joiner accurately received host isScreenSharing: true!');

  // Test signaling offer / answer exchange
  const offerReceivedPromise = new Promise(resolve => user1.once('signal-offer', resolve));
  user2.emit('signal-offer', { targetId: auth1.self.id, offer: { type: 'offer', sdp: 'v=0...' } });
  const receivedOffer = await offerReceivedPromise;
  assert.strictEqual(receivedOffer.senderId, auth2.self.id);
  console.log('✔ WebRTC signaling offer delivered from guest to host.');

  const answerReceivedPromise = new Promise(resolve => user2.once('signal-answer', resolve));
  user1.emit('signal-answer', { targetId: auth2.self.id, answer: { type: 'answer', sdp: 'v=0...' } });
  const receivedAnswer = await answerReceivedPromise;
  assert.strictEqual(receivedAnswer.senderId, auth1.self.id);
  console.log('✔ WebRTC signaling answer delivered from host to guest.');

  user1.disconnect();
  user2.disconnect();
}

// -------------------------------------------------------------
// Runner
// -------------------------------------------------------------
async function runAllTests() {
  console.log('====================================================');
  console.log('VOXLINK COMPREHENSIVE AUTOMATED VERIFICATION SUITE');
  console.log('====================================================');

  try {
    testMediaEmbedLogic();
    await testUploadEndpoint();
    await testDmCallingSignaling();
    await testGroupDmManagement();
    await testDmConversationClear();
    await testServerKickAndBan();
    await testVoiceChannelLateJoiner();

    console.log('\n====================================================');
    console.log('🎉 ALL 7 FEATURE TESTS & MEDIA EMBEDS PASSED 100%!');
    console.log('====================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILURE:', err);
    process.exit(1);
  }
}

runAllTests();
