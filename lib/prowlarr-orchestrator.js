'use strict';

const SERVICES=Object.freeze({
  sonarr:Object.freeze({label:'Sonarr',implementation:'Sonarr',contract:'SonarrSettings'}),
  radarr:Object.freeze({label:'Radarr',implementation:'Radarr',contract:'RadarrSettings'})
});
const SYNC_LEVELS=new Set(['addOnly','fullSync']);
const TOP_LEVEL_FIELDS=new Set(['id','name','fields','implementationName','implementation','configContract','infoLink','tags','syncLevel']);
const REQUIRED_FIELDS=Object.freeze(['prowlarrUrl','baseUrl','apiKey']);
const SAFE_FIELD_NAME=/^[A-Za-z][A-Za-z0-9.]{0,79}$/;

function fail(message){throw new TypeError(message);}
function clone(value){return JSON.parse(JSON.stringify(value));}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function string(value,label,limit=2048){const result=String(value||'').trim();if(!result||result.length>limit||/[\u0000-\u001f\u007f]/.test(result))fail(`${label} is invalid.`);return result;}
function fieldMap(fields){const result=new Map();for(const field of Array.isArray(fields)?fields:[]){if(!plain(field))continue;const name=String(field.name||'');if(!SAFE_FIELD_NAME.test(name)||result.has(name))continue;result.set(name,clone(field));}return result;}
function fieldValue(application,name){return fieldMap(application?.fields).get(name)?.value;}
function retainedField(application,request,name){const current=fieldValue(application,name),expected=fieldValue(request.body,name);return current===expected||(name==='apiKey'&&typeof current==='string'&&/^\*{4,}$/.test(current));}
function serviceFor(application){const text=[application?.implementation,application?.implementationName,application?.name].map(value=>String(value||'').toLowerCase());return Object.keys(SERVICES).find(id=>text.some(value=>value===id||value.includes(id)))||null;}
function schemaFor(schemas,id){const definition=SERVICES[id],rows=Array.isArray(schemas)?schemas:[];return rows.find(item=>String(item?.implementation||'').toLowerCase()===id)||rows.find(item=>String(item?.configContract||'')===definition.contract)||null;}
function currentFor(applications,id){return (Array.isArray(applications)?applications:[]).find(item=>serviceFor(item)===id)||null;}

function desiredValues(desired,credentials){
  if(!plain(desired)||Object.keys(desired).some(key=>!['prowlarrUrl','sonarrUrl','radarrUrl','syncLevel'].includes(key)))fail('Prowlarr link choices contain an unsupported field.');
  if(!plain(credentials)||Object.keys(credentials).some(key=>!['sonarr','radarr'].includes(key)))fail('Prowlarr link credentials are invalid.');
  const syncLevel=String(desired.syncLevel||'fullSync');
  if(!SYNC_LEVELS.has(syncLevel))fail('Choose add-only or full indexer synchronization.');
  return Object.freeze({
    syncLevel,
    prowlarrUrl:string(desired.prowlarrUrl,'Prowlarr callback URL'),
    sonarr:Object.freeze({baseUrl:string(desired.sonarrUrl,'Sonarr URL'),apiKey:string(credentials.sonarr,'Sonarr API key',256)}),
    radarr:Object.freeze({baseUrl:string(desired.radarrUrl,'Radarr URL'),apiKey:string(credentials.radarr,'Radarr API key',256)})
  });
}

function applicationBody(source,id,values){
  const definition=SERVICES[id],fields=fieldMap(source?.fields);
  for(const required of REQUIRED_FIELDS)if(!fields.has(required))fields.set(required,{name:required});
  fields.get('prowlarrUrl').value=values.prowlarrUrl;
  fields.get('baseUrl').value=values[id].baseUrl;
  fields.get('apiKey').value=values[id].apiKey;
  const body={
    name:definition.label,
    fields:[...fields.values()],
    implementationName:String(source?.implementationName||definition.label),
    implementation:definition.implementation,
    configContract:definition.contract,
    infoLink:String(source?.infoLink||''),
    tags:Array.isArray(source?.tags)?source.tags.filter(Number.isInteger):[],
    syncLevel:values.syncLevel
  };
  if(Number.isInteger(source?.id)&&source.id>0)body.id=source.id;
  return body;
}

function sameLink(application,id,values){
  return Boolean(application)&&application.syncLevel===values.syncLevel&&fieldValue(application,'prowlarrUrl')===values.prowlarrUrl&&fieldValue(application,'baseUrl')===values[id].baseUrl&&fieldValue(application,'apiKey')===values[id].apiKey;
}

function preview(desired,snapshot,credentials){
  if(!plain(snapshot)||Object.keys(snapshot).some(key=>!['applications','schemas'].includes(key)))fail('Prowlarr application inventory is invalid.');
  const values=desiredValues(desired,credentials),changes=[],requests=[];
  for(const id of Object.keys(SERVICES)){
    const current=currentFor(snapshot.applications,id),schema=schemaFor(snapshot.schemas,id);
    if(!current&&!schema)fail(`${SERVICES[id].label} is not supported by this Prowlarr installation.`);
    if(sameLink(current,id,values))continue;
    const source=current||schema,body=applicationBody(source,id,values),method=current?'PUT':'POST';
    requests.push({service:id,method,path:current?`/api/v1/applications/${current.id}`:'/api/v1/applications',body,original:current?clone(current):null});
    changes.push({service:id,action:current?'update':'create',syncLevel:values.syncLevel,prowlarrUrl:values.prowlarrUrl,applicationUrl:values[id].baseUrl});
  }
  return Object.freeze({version:1,mode:'preview',changes:Object.freeze(changes),requests:Object.freeze(requests),isEmpty:changes.length===0});
}

function safeRequest(request){
  if(!plain(request)||!Object.hasOwn(SERVICES,request.service)||!['POST','PUT'].includes(request.method)||!plain(request.body))return false;
  const definition=SERVICES[request.service],expectedPath=request.method==='POST'?'/api/v1/applications':`/api/v1/applications/${request.body.id}`;
  if(request.path!==expectedPath||request.body.implementation!==definition.implementation||request.body.configContract!==definition.contract||request.body.name!==definition.label||!SYNC_LEVELS.has(request.body.syncLevel))return false;
  if(Object.keys(request.body).some(key=>!TOP_LEVEL_FIELDS.has(key))||JSON.stringify(request.body).length>65536)return false;
  const fields=fieldMap(request.body.fields);
  return fields.size===request.body.fields.length&&REQUIRED_FIELDS.every(name=>typeof fields.get(name)?.value==='string'&&fields.get(name).value.length>0);
}

function applicationRequests(plan){
  if(!plan||plan.version!==1||!Array.isArray(plan.requests)||!plan.requests.every(safeRequest))fail('Prowlarr plan is invalid or contains an unsupported request.');
  return clone(plan.requests);
}

function publicPlan(plan){
  if(!plan||plan.version!==1||!Array.isArray(plan.changes))fail('Prowlarr plan is invalid.');
  return {version:1,mode:'preview',changes:clone(plan.changes),isEmpty:plan.changes.length===0};
}

function mismatchFields(plan,applications){
  if(!plan||!Array.isArray(plan.requests))return ['plan'];
  const mismatches=[];
  for(const request of plan.requests){
    const current=currentFor(applications,request.service);
    if(!current){mismatches.push(`${request.service}:missing`);continue;}
    if(current.syncLevel!==request.body.syncLevel)mismatches.push(`${request.service}:syncLevel`);
    for(const name of REQUIRED_FIELDS)if(!retainedField(current,request,name))mismatches.push(`${request.service}:${name}`);
  }
  return mismatches;
}
function matches(plan,applications){return mismatchFields(plan,applications).length===0;}

module.exports=Object.freeze({SERVICES,preview,applicationRequests,publicPlan,matches,mismatchFields,serviceFor,fieldValue});
