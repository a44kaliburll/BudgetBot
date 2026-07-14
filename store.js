// Persistent JSON data store with atomic writes and daily rotating backups.
const fs = require('fs');
const path = require('path');

const BACKUP_KEEP = 14;

class DataStore {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.filePath = path.join(userDataDir, 'nestegg-data.json');
    this.backupDir = path.join(userDataDir, 'backups');
    this._backedUpToday = false;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      // Corrupt primary file: try most recent backup before giving up
      const recovered = this._loadNewestBackup();
      if (recovered) return recovered;
      return null;
    }
  }

  save(data) {
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
      this._maybeBackup();
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
      fs.renameSync(tmp, this.filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  _maybeBackup() {
    if (this._backedUpToday || !fs.existsSync(this.filePath)) return;
    try {
      if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      const dest = path.join(this.backupDir, `nestegg-${stamp}.json`);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(this.filePath, dest);
        this._prune();
      }
      this._backedUpToday = true;
    } catch (_) { /* backups are best-effort */ }
  }

  _prune() {
    const files = fs.readdirSync(this.backupDir)
      .filter(f => /^nestegg-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    while (files.length > BACKUP_KEEP) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(this.backupDir, oldest)); } catch (_) { /* ignore */ }
    }
  }

  _loadNewestBackup() {
    try {
      if (!fs.existsSync(this.backupDir)) return null;
      const files = fs.readdirSync(this.backupDir)
        .filter(f => /^nestegg-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .reverse();
      for (const f of files) {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.backupDir, f), 'utf8'));
        } catch (_) { /* try next */ }
      }
    } catch (_) { /* ignore */ }
    return null;
  }
}

module.exports = DataStore;
