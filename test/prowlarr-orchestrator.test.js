'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const orchestrator=require('../lib/prowlarr-orchestrator');

const schemas=[
  {name:'Sonarr',implementationName:'Sonarr',implementation:'Sonarr',configContract:'SonarrSettings',fields:[{name:'prowlarrUrl'},{name:'baseUrl'},{name:'apiKey'},{name:'syncCategories',value:[5000]}],tags:[]},
  {name:'Radarr',implementationName:'Radarr',implementation:'Radarr',configContract:'RadarrSettings',fields:[{name:'prowlarrUrl'},{name:'baseUrl'},{name:'apiKey'},{name:'syncCategories',value:[2000]}],tags:[]}
];
const desired={prowlarrUrl:'http://prowlarr:9696',sonarrUrl:'http://sonarr:8989',radarrUrl:'http://radarr:7878',syncLevel:'fullSync'};
const credentials={sonarr:'sonarr-test-key',radarr:'radarr-test-key'};

test('creates native Sonarr and Radarr applications from Prowlarr schemas',()=>{
  const plan=orchestrator.preview(desired,{applications:[],schemas},credentials),requests=orchestrator.applicationRequests(plan);
  assert.equal(plan.changes.length,2);
  assert.deepEqual(requests.map(request=>[request.service,request.method,request.path]),[
    ['sonarr','POST','/api/v1/applications'],['radarr','POST','/api/v1/applications']
  ]);
  assert.equal(orchestrator.fieldValue(requests[0].body,'apiKey'),'sonarr-test-key');
  assert.deepEqual(orchestrator.fieldValue(requests[0].body,'syncCategories'),[5000]);
  assert.equal(JSON.stringify(orchestrator.publicPlan(plan)).includes('test-key'),false);
});

test('updates existing applications while preserving native fields',()=>{
  const applications=[
    {...schemas[0],id:11,syncLevel:'addOnly',fields:schemas[0].fields.map(field=>field.name==='apiKey'?{...field,value:'old-key'}:field)},
    {...schemas[1],id:12,syncLevel:'fullSync',fields:schemas[1].fields.map(field=>({...field,value:field.name==='prowlarrUrl'?desired.prowlarrUrl:field.name==='baseUrl'?desired.radarrUrl:field.name==='apiKey'?'radarr-test-key':field.value}))}
  ];
  const plan=orchestrator.preview(desired,{applications,schemas},credentials),requests=orchestrator.applicationRequests(plan);
  assert.equal(requests.length,1);
  assert.equal(requests[0].method,'PUT');
  assert.equal(requests[0].path,'/api/v1/applications/11');
  assert.deepEqual(orchestrator.fieldValue(requests[0].body,'syncCategories'),[5000]);
  assert.equal(requests[0].original.id,11);
});

test('returns an empty plan when both links already match',()=>{
  const initial=orchestrator.preview(desired,{applications:[],schemas},credentials);
  const applications=orchestrator.applicationRequests(initial).map((request,index)=>({...request.body,id:index+1}));
  const plan=orchestrator.preview(desired,{applications,schemas},credentials);
  assert.equal(plan.isEmpty,true);
  assert.deepEqual(orchestrator.applicationRequests(plan),[]);
  assert.equal(orchestrator.matches(initial,applications),true);
});

test('verification accepts Prowlarr secret masking without relaxing URL checks',()=>{
  const plan=orchestrator.preview(desired,{applications:[],schemas},credentials);
  const applications=orchestrator.applicationRequests(plan).map((request,index)=>({...request.body,id:index+1,fields:request.body.fields.map(field=>field.name==='apiKey'?{...field,value:'********'}:field)}));
  assert.equal(orchestrator.matches(plan,applications),true);
  applications[0].fields.find(field=>field.name==='baseUrl').value='http://wrong-service:8989';
  assert.deepEqual(orchestrator.mismatchFields(plan,applications),['sonarr:baseUrl']);
});

test('rejects unknown choices and altered requests',()=>{
  assert.throws(()=>orchestrator.preview({...desired,deleteIndexers:true},{applications:[],schemas},credentials),/unsupported field/);
  assert.throws(()=>orchestrator.preview({...desired,syncLevel:'disabled'},{applications:[],schemas},credentials),/add-only or full/);
  const plan=orchestrator.preview(desired,{applications:[],schemas},credentials);
  const forged={...plan,requests:plan.requests.map((request,index)=>index?request:{...request,path:'/api/v1/indexer'})};
  assert.throws(()=>orchestrator.applicationRequests(forged),/unsupported request/);
});
