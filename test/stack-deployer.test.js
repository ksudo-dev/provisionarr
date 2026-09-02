'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {stackBundle}=require('../lib/stack-bundle');
const {loadGeneratedBundle,deployGeneratedBundle}=require('../lib/stack-deployer');

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'provisionarr-deployer-')),bundleDirectory=path.join(root,'bundle'),configRoot=path.join(root,'config'),mediaRoot=path.join(root,'media'),downloadRoot=path.join(root,'downloads');
  fs.mkdirSync(bundleDirectory);
  const bundle=stackBundle({configRoot,mediaRoot,downloadRoot,puid:1000,pgid:1000,timezone:'Etc/UTC'});
  for(const [name,content] of Object.entries(bundle.files))fs.writeFileSync(path.join(bundleDirectory,name),content);
  return {root,bundleDirectory,configRoot,mediaRoot,downloadRoot};
}

test('loader accepts only an unchanged generated bundle',t=>{
  const item=fixture();t.after(()=>fs.rmSync(item.root,{recursive:true,force:true}));
  const loaded=loadGeneratedBundle(item.bundleDirectory);
  assert.equal(loaded.environment.CONFIG_ROOT,item.configRoot);
  fs.appendFileSync(path.join(item.bundleDirectory,'compose.yaml'),'\nprivileged: true\n');
  assert.throws(()=>loadGeneratedBundle(item.bundleDirectory),/does not match/);
});

test('dry run validates Compose without creating directories',async t=>{
  const item=fixture();t.after(()=>fs.rmSync(item.root,{recursive:true,force:true}));
  const calls=[],run=(command,args)=>{calls.push([command,...args]);return {status:0,stdout:'',stderr:''};};
  const result=await deployGeneratedBundle({bundleDirectory:item.bundleDirectory,run});
  assert.equal(result.action,'dry-run');
  assert.equal(fs.existsSync(item.configRoot),false);
  assert.equal(calls.some(call=>call.includes('config')&&call.includes('--quiet')),true);
  assert.equal(calls.some(call=>call.includes('up')),false);
});

test('apply requires confirmation, creates approved directories, and waits for four services',async t=>{
  const item=fixture();t.after(()=>fs.rmSync(item.root,{recursive:true,force:true}));
  await assert.rejects(()=>deployGeneratedBundle({bundleDirectory:item.bundleDirectory,action:'apply',run:()=>({status:0,stdout:''})}),/explicit confirmation/);
  const calls=[],run=(command,args)=>{calls.push([command,...args]);if(args.includes('--status'))return {status:0,stdout:'one\ntwo\nthree\nfour\n'};return {status:0,stdout:'',stderr:''};};
  const result=await deployGeneratedBundle({bundleDirectory:item.bundleDirectory,action:'apply',confirmed:true,run,portProbe:async()=>true,wait:async()=>{},timeoutMs:50});
  assert.equal(result.action,'apply');
  assert.equal(fs.statSync(path.join(item.configRoot,'sonarr')).isDirectory(),true);
  assert.equal(fs.statSync(path.join(item.mediaRoot,'movies')).isDirectory(),true);
  assert.equal(calls.some(call=>call.includes('up')&&call.includes('-d')),true);
});

test('failed startup removes containers and preserves created directories',async t=>{
  const item=fixture();t.after(()=>fs.rmSync(item.root,{recursive:true,force:true}));
  const calls=[],run=(command,args)=>{calls.push([command,...args]);if(args.includes('up'))return {status:1,stdout:'',stderr:'failed'};return {status:0,stdout:'',stderr:''};};
  await assert.rejects(()=>deployGeneratedBundle({bundleDirectory:item.bundleDirectory,action:'apply',confirmed:true,run,portProbe:async()=>true}),/Containers were removed/);
  assert.equal(calls.some(call=>call.includes('down')),true);
  assert.equal(fs.statSync(item.downloadRoot).isDirectory(),true);
});

test('occupied service port stops apply before creating directories',async t=>{
  const item=fixture();t.after(()=>fs.rmSync(item.root,{recursive:true,force:true}));
  const calls=[],run=(command,args)=>{calls.push([command,...args]);return {status:0,stdout:'',stderr:''};};
  await assert.rejects(()=>deployGeneratedBundle({bundleDirectory:item.bundleDirectory,action:'apply',confirmed:true,run,portProbe:async()=>false}),/already in use/);
  assert.equal(fs.existsSync(item.configRoot),false);
  assert.equal(calls.some(call=>call.includes('up')),false);
});

test('running-state timeout removes containers without deleting data',async t=>{
  const item=fixture();t.after(()=>fs.rmSync(item.root,{recursive:true,force:true}));
  const calls=[],run=(command,args)=>{calls.push([command,...args]);if(args.includes('--status'))return {status:0,stdout:'one\n'};return {status:0,stdout:'',stderr:''};};
  await assert.rejects(()=>deployGeneratedBundle({bundleDirectory:item.bundleDirectory,action:'apply',confirmed:true,run,portProbe:async()=>true,wait:async()=>{},timeoutMs:1}),/did not reach running state/);
  assert.equal(calls.some(call=>call.includes('down')),true);
  assert.equal(fs.statSync(item.downloadRoot).isDirectory(),true);
});

test('rollback requires confirmation and removes no data directories',async t=>{
  const item=fixture();t.after(()=>fs.rmSync(item.root,{recursive:true,force:true}));
  fs.mkdirSync(item.downloadRoot,{recursive:true});
  const calls=[],run=(command,args)=>{calls.push([command,...args]);return {status:0,stdout:'',stderr:''};};
  const result=await deployGeneratedBundle({bundleDirectory:item.bundleDirectory,action:'rollback',confirmed:true,run});
  assert.equal(result.action,'rollback');
  assert.equal(calls.some(call=>call.includes('down')),true);
  assert.equal(fs.statSync(item.downloadRoot).isDirectory(),true);
});

test('verification checks four running services, ports, and generated directories',async t=>{
  const item=fixture();t.after(()=>fs.rmSync(item.root,{recursive:true,force:true}));
  for(const directory of loadGeneratedBundle(item.bundleDirectory).directories)fs.mkdirSync(directory,{recursive:true});
  const run=(command,args)=>args.includes('--status')?{status:0,stdout:'one\ntwo\nthree\nfour\n'}:{status:0,stdout:'',stderr:''};
  const result=await deployGeneratedBundle({bundleDirectory:item.bundleDirectory,action:'verify',run,portConnect:async()=>true});
  assert.equal(result.servicesRunning,4);
  assert.equal(result.ports.length,5);
});

test('verification reports unavailable ports without changing the stack',async t=>{
  const item=fixture();t.after(()=>fs.rmSync(item.root,{recursive:true,force:true}));
  for(const directory of loadGeneratedBundle(item.bundleDirectory).directories)fs.mkdirSync(directory,{recursive:true});
  const calls=[],run=(command,args)=>{calls.push([command,...args]);return args.includes('--status')?{status:0,stdout:'one\ntwo\nthree\nfour\n'}:{status:0,stdout:'',stderr:''};};
  await assert.rejects(()=>deployGeneratedBundle({bundleDirectory:item.bundleDirectory,action:'verify',run,portConnect:async()=>false}),/not accepting connections/);
  assert.equal(calls.some(call=>call.includes('up')||call.includes('down')),false);
});
