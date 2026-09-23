import type { CompanyLead } from "./types";

export const EXPORT_COLUMNS = [
  ["company","Empresa",(r:CompanyLead)=>r.tradeName || r.legalName],
  ["legalName","Razão social",(r:CompanyLead)=>r.legalName],
  ["cnpj","CNPJ",(r:CompanyLead)=>r.cnpjFormatted || r.cnpj],
  ["partners","Sócios",(r:CompanyLead)=>(r.partners||[]).map(partner=>partner.name).join(" | ")],
  ["category","Categoria",(r:CompanyLead)=>r.category || ""],
  ["cnae","CNAE",(r:CompanyLead)=>r.cnae || ""],
  ["companySize","Porte",(r:CompanyLead)=>r.companySize || ""],
  ["capital","Capital social",(r:CompanyLead)=>r.capitalSocialCents == null ? "" : (r.capitalSocialCents/100).toFixed(2)],
  ["openingDate","Abertura",(r:CompanyLead)=>r.openingDate || ""],
  ["age","Tempo (anos)",(r:CompanyLead)=>r.ageYears ?? ""],
  ["city","Cidade",(r:CompanyLead)=>r.city || ""],
  ["state","UF",(r:CompanyLead)=>r.state || ""],
  ["phone","Telefone",(r:CompanyLead)=>r.phone || ""],
  ["email","E-mail",(r:CompanyLead)=>r.email || ""],
  ["website","Site",(r:CompanyLead)=>r.website || ""],
  ["instagram","Instagram",(r:CompanyLead)=>r.social?.instagram?.url || ""],
  ["potential","Potencial",(r:CompanyLead)=>r.potential.level],
  ["maps","Google Maps",(r:CompanyLead)=>r.mapsUrl || ""]
] as const;

function safeCsv(value:unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}

export function toCsv(results:CompanyLead[], ids:string[]) {
  const defs = EXPORT_COLUMNS.filter(([id]) => ids.includes(id));
  const rows = [
    defs.map(([,label])=>label),
    ...results.map(r=>defs.map(([, ,getter])=>getter(r)))
  ];
  return "\uFEFF"+rows.map(row=>row.map(safeCsv).join(";")).join("\r\n");
}


function xmlEscape(v:unknown) {
  return String(v ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&apos;");
}

function colName(n:number) {
  let s="";
  while(n>0){n--;s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26);}
  return s;
}

function crc32(bytes:Uint8Array) {
  let crc=0xFFFFFFFF;
  for(let i=0;i<bytes.length;i++){
    crc^=bytes[i];
    for(let j=0;j<8;j++) crc=(crc>>>1)^(0xEDB88320 & -(crc&1));
  }
  return (crc^0xFFFFFFFF)>>>0;
}
function u16(v:number){const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,v,true);return a;}
function u32(v:number){const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,v,true);return a;}
function concat(parts:Uint8Array[]){
  const total=parts.reduce((n,p)=>n+p.length,0);
  const out=new Uint8Array(total);let off=0;
  for(const p of parts){out.set(p,off);off+=p.length;}
  return out;
}
function utf8(s:string){return new TextEncoder().encode(s);}

function zipStore(files:{name:string;data:string|Uint8Array}[]) {
  const locals:Uint8Array[]=[];const centrals:Uint8Array[]=[];let offset=0;
  for(const file of files){
    const name=utf8(file.name);
    const data=file.data instanceof Uint8Array?file.data:utf8(file.data);
    const crc=crc32(data);
    const local=concat([
      u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),
      u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data
    ]);
    locals.push(local);
    centrals.push(concat([
      u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),
      u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),
      u16(0),u16(0),u32(0),u32(offset),name
    ]));
    offset+=local.length;
  }
  const localBlock=concat(locals),centralBlock=concat(centrals);
  const end=concat([
    u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),
    u32(centralBlock.length),u32(localBlock.length),u16(0)
  ]);
  return concat([localBlock,centralBlock,end]);
}

export function toXlsx(results:CompanyLead[], ids:string[]) {
  const defs=EXPORT_COLUMNS.filter(([id])=>ids.includes(id));
  const rows=[
    defs.map(([,label])=>label),
    ...results.map(r=>defs.map(([, ,getter])=>getter(r)))
  ];
  const sheetRows=rows.map((row,ri)=>{
    const cells=row.map((value,ci)=>{
      const ref=`${colName(ci+1)}${ri+1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${ri+1}">${cells}</row>`;
  }).join("");

  return zipStore([
    {name:"[Content_Types].xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`},
    {name:"_rels/.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {name:"xl/workbook.xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pepita" sheetId="1" r:id="rId1"/></sheets></workbook>`},
    {name:"xl/_rels/workbook.xml.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`},
    {name:"xl/worksheets/sheet1.xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`}
  ]);
}

export function downloadFile(results:CompanyLead[],format:"csv"|"xlsx",ids:string[]){
  const stamp=new Date().toISOString().slice(0,10);
  const blob=format==="xlsx"
    ? new Blob([toXlsx(results,ids)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})
    : new Blob([toCsv(results,ids)],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`pepita-resultados-${stamp}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}
