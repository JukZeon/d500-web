import { useEffect, useRef, useState } from 'react';
/** Flush the latest edit when switching profiles or leaving, including before the debounce fires. */
export function useAutosave(key: string, value: unknown) {
  const latest=useRef(value);latest.current=value;
  const [status,setStatus]=useState('已保存');
  useEffect(()=>{
    setStatus('保存中…');
    const timer=setTimeout(()=>{try{localStorage.setItem(key,JSON.stringify(value));setStatus('已保存');}catch{setStatus('存储已满，请导出备份');}},350);
    return()=>clearTimeout(timer);
  },[key,value]);
  useEffect(()=>{
    const flush=()=>{try{localStorage.setItem(key,JSON.stringify(latest.current));}catch{/* Keep editing available if storage is unavailable. */}};
    window.addEventListener('pagehide',flush);
    return()=>{flush();window.removeEventListener('pagehide',flush);};
  },[key]);
  return status;
}
