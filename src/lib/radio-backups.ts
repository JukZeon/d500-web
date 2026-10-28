import type { RadioSnapshot } from './radio';
const DB = 'd500-radio-backups';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reads', { keyPath: 'capturedAt' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法访问备份，请检查存储权限。'));
    request.onblocked = () => reject(new Error('备份库被占用'));
  });
}
export async function saveRadioBackup(snapshot: RadioSnapshot): Promise<void> {
  if (snapshot.source === 'write-ack') throw new Error('写入状态不是读机备份');
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('reads', 'readwrite');
      tx.objectStore('reads').put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('备份保存失败'));
    });
  } finally { db.close(); }
}
export async function listRadioBackups(): Promise<RadioSnapshot[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('reads', 'readonly').objectStore('reads').getAll();
      request.onsuccess = () => resolve((request.result as RadioSnapshot[]).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)));
      request.onerror = () => reject(new Error('备份读取失败'));
    });
  } finally { db.close(); }
}
