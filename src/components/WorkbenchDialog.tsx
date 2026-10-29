import { useEffect, useRef, type ReactNode } from 'react';
/** Shared focus and keyboard handling for editing and transfer dialogs. */
export default function WorkbenchDialog({label,onClose,children,className=''}:{label:string;onClose:()=>void;children:ReactNode;className?:string}){
 const dialog=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  dialog.current?.focus();
  const handler=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();close.current();return;}
   if(event.key!=='Tab')return;
   const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]');
   if(!items?.length)return;
   const first=items[0],last=items[items.length-1];
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){event.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',handler);
  return()=>{document.removeEventListener('keydown',handler);previous?.focus();};
 },[]);
 return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className={`modal ${className}`} ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}>{children}</section></div>;
}
