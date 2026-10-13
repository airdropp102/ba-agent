#!/usr/bin/env node
import {loadDotEnv} from './load-env.mjs';
await loadDotEnv();
/** SQLite consistent offline/online snapshot using VACUUM INTO (includes WAL state). */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
const sqlite=path.join(dir,'ba-studio.sqlite');
const backupDir=path.resolve(process.env.BA_BACKUP_DIR||path.join(dir,'backups'));
let db;
try{
 await fs.mkdir(backupDir,{recursive:true,mode:0o700});
 // Local SQLite snapshot only; does not include Figma registry or generated design assets.
 db=new DatabaseSync(sqlite,{readOnly:true});
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Database integrity check failed');
 const dest=path.join(backupDir,`ba-studio-${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}.sqlite`);
 db.exec(`VACUUM INTO '${dest.replaceAll("'","''")}'`);
 await fs.chmod(dest,0o600);
 const copy=new DatabaseSync(dest,{readOnly:true});
 try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup verification failed')}finally{copy.close()}
 console.log(`SQLite consistent snapshot: ${dest}`);
 console.log('IMPORTANT: Back up the entire data/projects/ directory and data/.session-handoff/ (if used); SQLite snapshot alone is incomplete.');
}catch(e){console.error('Backup failed:',e.message);process.exitCode=1}
finally{db?.close()}
