'use strict';

const fs=require('node:fs');
const net=require('node:net');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {stackBundle}=require('./stack-bundle');

const ENV_KEYS=Object.freeze(['PUID','PGID','TZ','CONFIG_ROOT','MEDIA_ROOT','DOWNLOAD_ROOT']);
const TCP_PORTS=Object.freeze([8989,7878,9696,8080,6881]);

function deploymentError(message,code='DEPLOYMENT_INVALID'){return Object.assign(new Error(message),{code});}

function parseGeneratedEnvironment(text) {
  const values={};
  for(const line of String(text||'').split(/\r?\n/)){
    if(!line)continue;
    const separator=line.indexOf('=');
    if(separator<1)throw deploymentError('Generated environment file is invalid.');
    const key=line.slice(0,separator),value=line.slice(separator+1);
    if(!ENV_KEYS.includes(key)||Object.prototype.hasOwnProperty.call(values,key))throw deploymentError('Generated environment file contains an unsupported or duplicate field.');
    values[key]=value;
  }
  if(ENV_KEYS.some(key=>!Object.prototype.hasOwnProperty.call(values,key)))throw deploymentError('Generated environment file is incomplete.');
  return Object.freeze(values);
}

function regularFile(file,label) {
  let stat;
  try{stat=fs.lstatSync(file);}catch{throw deploymentError(`${label} is missing.`);}
  if(stat.isSymbolicLink()||!stat.isFile())throw deploymentError(`${label} must be a regular file.`);
  return fs.readFileSync(file,'utf8');
}

function loadGeneratedBundle(directory) {
  const requested=path.resolve(String(directory||''));
  let stat;
  try{stat=fs.lstatSync(requested);}catch{throw deploymentError('Bundle directory does not exist.');}
  if(stat.isSymbolicLink()||!stat.isDirectory())throw deploymentError('Bundle path must be a regular directory.');
  const files={
    'compose.yaml':regularFile(path.join(requested,'compose.yaml'),'compose.yaml'),
    '.env':regularFile(path.join(requested,'.env'),'.env'),
    'README.md':regularFile(path.join(requested,'README.md'),'README.md')
  };
  const environment=parseGeneratedEnvironment(files['.env']);
  const expected=stackBundle({configRoot:environment.CONFIG_ROOT,mediaRoot:environment.MEDIA_ROOT,downloadRoot:environment.DOWNLOAD_ROOT,puid:Number(environment.PUID),pgid:Number(environment.PGID),timezone:environment.TZ});
  for(const name of Object.keys(files))if(files[name]!==expected.files[name])throw deploymentError(`${name} does not match the Provisionarr-generated bundle.`,'BUNDLE_CHANGED');
  const directories=[
    ...['sonarr','radarr','prowlarr','qbittorrent'].map(service=>path.join(environment.CONFIG_ROOT,service)),
    path.join(environment.MEDIA_ROOT,'tv'),
    path.join(environment.MEDIA_ROOT,'movies'),
    environment.DOWNLOAD_ROOT
  ];
  return Object.freeze({directory:requested,composeFile:path.join(requested,'compose.yaml'),environmentFile:path.join(requested,'.env'),environment,files:Object.freeze(files),directories:Object.freeze(directories)});
}

function commandResult(command,args,options={}) {
  const result=spawnSync(command,args,{encoding:'utf8',stdio:options.inherit?'inherit':'pipe'});
  return {status:result.status??1,stdout:String(result.stdout||''),stderr:String(result.stderr||''),error:result.error};
}

function dockerArguments(bundle,...args) {
  return ['compose','--project-name','provisionarr-media-stack','--env-file',bundle.environmentFile,'-f',bundle.composeFile,...args];
}

function requireCommand(result,message) {
  if(result.error||result.status!==0)throw deploymentError(message,'DEPLOYMENT_COMMAND_FAILED');
  return result;
}

function defaultPortProbe(port) {
  return new Promise(resolve=>{const server=net.createServer();server.unref();server.once('error',()=>resolve(false));server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(()=>resolve(true)));});
}

function defaultPortConnect(port) {
  return new Promise(resolve=>{let settled=false;const socket=net.createConnection({host:'127.0.0.1',port});const finish=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};socket.setTimeout(2000);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));});
}

async function deployGeneratedBundle(options={}) {
  const action=options.action||'dry-run',bundle=loadGeneratedBundle(options.bundleDirectory),run=options.run||commandResult,probe=options.portProbe||defaultPortProbe,connect=options.portConnect||defaultPortConnect,wait=options.wait||((milliseconds)=>new Promise(resolve=>setTimeout(resolve,milliseconds))),message=options.message||(()=>{}),timeoutMs=Number(options.timeoutMs)||120000;
  if(!['dry-run','verify','apply','rollback'].includes(action))throw deploymentError('Deployment action is invalid.');
  if(['apply','rollback'].includes(action)&&options.confirmed!==true)throw deploymentError(`${action} requires explicit confirmation.`,'CONFIRMATION_REQUIRED');
  requireCommand(run('docker',['compose','version']),'Docker Compose is unavailable.');
  requireCommand(run('docker',dockerArguments(bundle,'config','--quiet')),'Generated Compose validation failed.');
  if(action==='dry-run'){
    message('Dry run passed. No directories, containers, networks, or settings were changed.');
    return {ok:true,action,directories:bundle.directories,ports:TCP_PORTS};
  }
  if(action==='verify'){
    const running=requireCommand(run('docker',dockerArguments(bundle,'ps','--status','running','-q')),'Could not inspect the generated stack.').stdout.trim().split(/\r?\n/).filter(Boolean);
    if(running.length!==4)throw deploymentError(`Expected four running services but found ${running.length}.`,'DEPLOYMENT_NOT_RUNNING');
    for(const directory of bundle.directories){try{fs.accessSync(directory,fs.constants.R_OK|fs.constants.W_OK);}catch{throw deploymentError(`Required stack directory is not readable and writable: ${directory}`,'DEPLOYMENT_PATH_UNAVAILABLE');}}
    for(const port of TCP_PORTS)if(!(await connect(port)))throw deploymentError(`Service port ${port} is not accepting connections.`,'DEPLOYMENT_PORT_UNAVAILABLE');
    message('Verification passed. Four containers are running, service ports accept connections, and generated directories are readable and writable.');
    return {ok:true,action,directories:bundle.directories,ports:TCP_PORTS,servicesRunning:running.length};
  }
  if(action==='rollback'){
    requireCommand(run('docker',dockerArguments(bundle,'down','--remove-orphans'),{inherit:true}),'Container rollback failed.');
    message('Containers and the project network were removed. Configuration, downloads, and media were preserved.');
    return {ok:true,action,preserved:bundle.directories};
  }
  const existing=requireCommand(run('docker',dockerArguments(bundle,'ps','-q')),'Could not inspect the generated stack.').stdout.trim();
  if(!existing){
    for(const port of TCP_PORTS)if(!(await probe(port)))throw deploymentError(`Port ${port} is already in use. Nothing was changed.`,'PORT_IN_USE');
  }
  for(const directory of bundle.directories)fs.mkdirSync(directory,{recursive:true,mode:0o750});
  const started=run('docker',dockerArguments(bundle,'up','-d','--remove-orphans'),{inherit:true});
  if(started.error||started.status!==0){run('docker',dockerArguments(bundle,'down','--remove-orphans'),{inherit:true});throw deploymentError('Stack startup failed. Containers were removed and data directories were preserved.','DEPLOYMENT_START_FAILED');}
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const running=run('docker',dockerArguments(bundle,'ps','--status','running','-q'));
    if(running.status===0&&running.stdout.trim().split(/\r?\n/).filter(Boolean).length===4){message('All four media services are running.');return {ok:true,action,directories:bundle.directories};}
    await wait(Math.min(2000,Math.max(1,deadline-Date.now())));
  }
  run('docker',dockerArguments(bundle,'down','--remove-orphans'),{inherit:true});
  throw deploymentError('Services did not reach running state before the timeout. Containers were removed and data directories were preserved.','DEPLOYMENT_HEALTH_TIMEOUT');
}

module.exports=Object.freeze({ENV_KEYS,TCP_PORTS,parseGeneratedEnvironment,loadGeneratedBundle,deployGeneratedBundle,dockerArguments,commandResult,defaultPortProbe,defaultPortConnect});
