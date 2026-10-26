# 🎙️ VoxLink v5.0

**A complete self-hosted Discord alternative featuring animated banners and avatars, markdown code blocks, a responsive call stage, custom role governance, ban moderation, and persistent accounts.**

Built on **Node.js, Express, Socket.io, and WebRTC Mesh**.

---

## ✨ What's New in v5.0

### 🎨 Fixed Tag Sizing & Role Aesthetics
- **Compact Badges:** Restyled badges (`👑 Platform Owner`, `🛠️ Dev`, `👑 Server Owner`) with sleek, compact proportions (`9.5px` font, neat pill padding) so they never overflow the screen or squish usernames.
- **Vibrant Role Pops:** Bold, distinctive role colors throughout the member list and chat headers with custom badge emojis and colored borders.
- **Clean Member Roster:** Removed redundant outer member counts; users are sorted cleanly under their highest role with dedicated section counters.

### 🔴 Red Mute State in Voice & Video Calls
- When muting your microphone (either in the bottom user panel or the floating call stage controls), the button turns **solid red** (`#f23f43`) with a white muted microphone slash icon for instant visual clarity.

### 🖼️ Local Image & Animated GIF Uploads
- **Local Profile Picture Upload:** Upload any image or **animated GIF** directly from your computer in User Settings.
- **Server Icons & Animated Banners:** Upload a server icon and a full-width **Server Banner** (with animated GIF support) that renders seamlessly at the top of the channels sidebar.

### 📁 Category Renaming, Deletion & Server Deletion
- **Edit / Rename Categories:** Right-click any category header to rename it or delete it.
- **Delete Server:** In Server Settings -> Overview -> Danger Zone, server owners can permanently delete custom servers.

### 🔨 Server Ban System
- **Ban Members:** Server staff can right-click any member and select **"🔨 Ban Member"** with a custom reason.
- **Bans Management Tab:** View all banned users in Server Settings -> Bans with an instant **"Unban"** button.

### 💻 Discord Code Formatting
- **Inline Code:** Single backticks (`` `const x = 1` ``) render as clean monospace code pills.
- **Code Blocks:** Triple backticks (```` ```javascript ... ``` ````) render full Discord-style dark code blocks with an uppercase language header and a one-click **"Copy"** button!

---

## 🖥️ Desktop App (Tauri 2.0)

VoxLink comes ported as a native desktop application powered by **Tauri 2.0** and **Rust**!

### Launching the Desktop Client:

```bash
cd C:\Users\Alex\.gemini\antigravity\scratch\voxlink
npm run desktop
```
> This runs [desktop-launcher.js](file:///C:/Users/Alex/.gemini/antigravity/scratch/voxlink/desktop-launcher.js), which automatically ensures the VoxLink server is active on `http://localhost:3000` and opens the native desktop client window with hardware-accelerated WebView2.

### Building Standalone Executable / Installer:
```bash
npm run desktop:build
```
The compiled Windows `.msi` and `.exe` binaries will be output to `src-tauri/target/release/bundle/`.

---

## 🚀 Web Quick Start

```bash
cd C:\Users\Alex\.gemini\antigravity\scratch\voxlink
npm start
```
Open **`http://localhost:3000`** in any web browser.

