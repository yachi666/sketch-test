import {readFileSync, writeFileSync} from 'node:fs';
const dir=new URL('./',import.meta.url);
const source=JSON.parse(readFileSync(new URL('preflight.json',dir))).results.find(r=>r.path.endsWith('av_d26bc0a0')).data;
// Read-only reproduction of CP's curated schema projection, not a workaround or mutation.
function shape(ref,schemas,depth=0,budget={remaining:64}) {
 if(typeof ref!=='string'||depth>4||budget.remaining--<=0)return undefined;
 const schema=schemas[ref];if(!schema)return undefined;
 const out={};for(const key of ['type','format','required','minimum','maximum','minLength','maxLength','minItems','maxItems','nullable'])if(schema[key]!==undefined)out[key]=schema[key];
 if(schema.properties&&typeof schema.properties==='object')out.properties=Object.fromEntries(Object.entries(schema.properties).slice(0,30).map(([n,v])=>[n,shape(v.ref,schemas,depth+1,budget)]));
 if(schema.items)out.items=shape(schema.items.ref,schemas,depth+1,budget);
 return out;
}
const projection=source.endpoints.map(e=>{
 const notes=JSON.stringify({parameters:e.parameters.map(p=>({name:p.name,in:p.in,required:p.required??false,schema:shape(p.schema?.ref,source.schemas)})),requestBodyRequired:e.requestBodies.some(b=>b.required),requestBodies:e.requestBodies.map(b=>({required:b.required,content:Object.fromEntries(Object.entries(b.content).map(([type,m])=>[type,shape(m.schema?.ref,source.schemas)]))})),responses:e.responses.map(r=>({status:r.statusCode,content:Object.fromEntries(Object.entries(r.content??{}).map(([type,m])=>[type,shape(m.schema?.ref,source.schemas)]))}))});
 return {id:e.id,parameterCount:e.parameters.length,responseStatusCodes:e.responses.map(r=>r.statusCode),contractNotesCharacters:notes.length,contractNotesLimit:4096,exceedsLimit:notes.length>4096};
});
writeFileSync(new URL('official-contract-diagnostic.json',dir),JSON.stringify(projection,null,2));console.log(JSON.stringify(projection,null,2));
