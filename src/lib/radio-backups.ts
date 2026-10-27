import type { RadioSnapshot } from './radio';
const DB = 'd500-radio-backups';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reads', { keyPath: 'capturedAt' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本机备份库，请检查浏览器存储权限。'));
    request.onblocked = () => reject(new Error('备份库被其他页面占用，请关闭其他 D500 页面后再试。'));
  });
}
export async function saveRadioBackup(snapshot: RadioSnapshot): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('reads', 'readwrite');
      tx.objectStore('reads').put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('本机备份未保存成功；请下载读取结果后再继续。'));
    });
  } finally { db.close(); }
}
export async function listRadioBackups(): Promise<RadioSnapshot[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('reads', 'readonly').objectStore('reads').getAll();
      request.onsuccess = () => resolve((request.result as RadioSnapshot[]).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)));
      request.onerror = () => reject(new Error('无法读取本机备份库。'));
    });
  } finally { db.close(); }
}
