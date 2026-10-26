const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const accPath = path.join(__dirname, 'data', 'accounts.json');
const accounts = JSON.parse(fs.readFileSync(accPath, 'utf8'));

for (const uid in accounts) {
  const acc = accounts[uid];
  if (acc.avatarUrl && acc.avatarUrl.startsWith('data:')) {
    const matches = acc.avatarUrl.match(/^data:([A-Za-z0-9\/\-+.]+);base64,(.+)$/);
    if (matches) {
      const mime = matches[1].toLowerCase();
      let ext = 'png';
      if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
      const buf = Buffer.from(matches[2], 'base64');
      const filename = 'avatar_' + uid + '.' + ext;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
      acc.avatarUrl = '/uploads/' + filename;
      console.log('Migrated avatar for', acc.username, 'to', acc.avatarUrl, 'file size:', buf.length);
    }
  }
  if (acc.bannerUrl && acc.bannerUrl.startsWith('data:')) {
    const matches = acc.bannerUrl.match(/^data:([A-Za-z0-9\/\-+.]+);base64,(.+)$/);
    if (matches) {
      const mime = matches[1].toLowerCase();
      let ext = 'png';
      if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
      const buf = Buffer.from(matches[2], 'base64');
      const filename = 'banner_' + uid + '.' + ext;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
      acc.bannerUrl = '/uploads/' + filename;
      console.log('Migrated banner for', acc.username, 'to', acc.bannerUrl, 'file size:', buf.length);
    }
  }
}

fs.writeFileSync(accPath, JSON.stringify(accounts, null, 2), 'utf8');
console.log('accounts.json saved, new size:', fs.statSync(accPath).size, 'bytes');
