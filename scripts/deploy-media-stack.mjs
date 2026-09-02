#!/usr/bin/env node

import deployer from '../lib/stack-deployer.js';

function usage() {
  process.stdout.write(`Usage:
  node scripts/deploy-media-stack.mjs --bundle PATH --dry-run
  node scripts/deploy-media-stack.mjs --bundle PATH --verify
  node scripts/deploy-media-stack.mjs --bundle PATH --apply --yes
  node scripts/deploy-media-stack.mjs --bundle PATH --rollback --yes

Dry run is the default. Apply creates the generated directories and starts the
four-service Compose project. Rollback removes its containers and network while
preserving configuration, downloads, and media.
`);
}

const args=process.argv.slice(2);
let bundleDirectory='',confirmed=false;
const actions=[];
for(let index=0;index<args.length;index+=1){
  const value=args[index];
  if(value==='--help'||value==='-h'){usage();process.exit(0);}
  if(value==='--bundle'){bundleDirectory=args[index+1]||'';index+=1;continue;}
  if(value==='--dry-run'){actions.push('dry-run');continue;}
  if(value==='--verify'){actions.push('verify');continue;}
  if(value==='--apply'){actions.push('apply');continue;}
  if(value==='--rollback'){actions.push('rollback');continue;}
  if(value==='--yes'){confirmed=true;continue;}
  process.stderr.write(`Unknown option: ${value}\n`);usage();process.exit(2);
}
const selected=[...new Set(actions)];
if(selected.length>1){process.stderr.write('Choose one action: dry run, verify, apply, or rollback.\n');usage();process.exitCode=2;}
else if(!bundleDirectory){usage();process.exitCode=2;}
else deployer.deployGeneratedBundle({bundleDirectory,action:selected[0]||'dry-run',confirmed,message:text=>process.stdout.write(`${text}\n`)}).catch(error=>{process.stderr.write(`Provisionarr deployment stopped: ${error.message}\n`);process.exitCode=1;});
