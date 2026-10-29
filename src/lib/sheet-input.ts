import * as XLSX from 'xlsx';
/** Decode delimited text before SheetJS so BOM-less Chinese CSV / pasted TSV stays Unicode. */
export function readSpreadsheet(data:ArrayBuffer,options:XLSX.ParsingOptions={}){
 const bytes=new Uint8Array(data);
 const binary=(bytes[0]===0x50&&bytes[1]===0x4b)||(bytes[0]===0xd0&&bytes[1]===0xcf)||(bytes[0]===0x09&&[0,2,4,8].includes(bytes[1]));
 if(binary)return XLSX.read(data,{...options,type:'array'});
 let text:string;
 if(bytes[0]===0xff&&bytes[1]===0xfe)text=new TextDecoder('utf-16le').decode(data);
 else if(bytes[0]===0xfe&&bytes[1]===0xff)text=new TextDecoder('utf-16be').decode(data);
 else {try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{text=new TextDecoder('gb18030',{fatal:true}).decode(data);}}
 return XLSX.read(text,{...options,type:'string'});
}
