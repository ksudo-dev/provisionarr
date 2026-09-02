'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {STACK_MODES,stackBundle}=require('../lib/stack-bundle');

test('stack generator returns a pinned four-service bundle without host control',()=>{
  const bundle=stackBundle({configRoot:'/srv/provisionarr/config',mediaRoot:'/srv/provisionarr/media',downloadRoot:'/srv/provisionarr/downloads',puid:1000,pgid:1000,timezone:'Etc/UTC'});
  assert.match(bundle.files['compose.yaml'],/sonarr@sha256:[a-f0-9]{64}/);
  assert.match(bundle.files['compose.yaml'],/qbittorrent@sha256:[a-f0-9]{64}/);
  assert.equal(bundle.files['compose.yaml'].includes('/var/run/docker.sock'),false);
  assert.equal(bundle.files['compose.yaml'].includes('privileged:'),false);
  assert.equal(bundle.files['.env'].includes('/srv/provisionarr/media'),true);
  assert.equal(JSON.stringify(bundle).includes('apiKey'),false);
});

test('stack generator validates the two installer modes',()=>{
  const base={configRoot:'/srv/provisionarr/config',mediaRoot:'/srv/provisionarr/media',downloadRoot:'/srv/provisionarr/downloads',puid:1000,pgid:1000,timezone:'Etc/UTC'};
  assert.equal(stackBundle({...base,mode:STACK_MODES.MANAGED}).mode,STACK_MODES.MANAGED);
  assert.equal(stackBundle({mode:STACK_MODES.EXISTING}).manifest.execution,'connect-only');
  assert.equal(stackBundle({mode:'existing-stack'}).mode,STACK_MODES.EXISTING);
  assert.throws(()=>stackBundle({...base,mode:'unsupported'}),/Stack mode must be existing or managed/);
  assert.throws(()=>stackBundle({mode:STACK_MODES.EXISTING,configRoot:'/srv/provisionarr/config'}),/unsupported field/);
});

test('managed output includes health checks, persistent mounts, and safe service addresses',()=>{
  const bundle=stackBundle({mode:STACK_MODES.MANAGED,configRoot:'/srv/provisionarr/config',mediaRoot:'/srv/provisionarr/media',downloadRoot:'/srv/provisionarr/downloads',puid:1000,pgid:1000,timezone:'Etc/UTC'});
  const compose=bundle.files['compose.yaml'];
  assert.equal(bundle.manifest.credentialsIncluded,false);
  assert.deepEqual(bundle.manifest.serviceAddresses,{sonarr:'http://sonarr:8989',radarr:'http://radarr:7878',prowlarr:'http://prowlarr:9696',qbittorrent:'http://qbittorrent:8080'});
  assert.match(compose,/healthcheck:/);
  assert.match(compose,/condition: service_healthy/);
  assert.match(compose,/\$\{CONFIG_ROOT\}\/sonarr:\/config/);
  assert.match(compose,/\$\{MEDIA_ROOT\}\/movies:\/movies/);
  assert.match(compose,/\$\{DOWNLOAD_ROOT\}:\/downloads/);
  assert.deepEqual(bundle.manifest.persistence.config,[
    '/srv/provisionarr/config/sonarr',
    '/srv/provisionarr/config/radarr',
    '/srv/provisionarr/config/prowlarr',
    '/srv/provisionarr/config/qbittorrent'
  ]);
  assert.deepEqual(bundle.manifest.rollback.removeServices,['sonarr','radarr','prowlarr','qbittorrent']);
  assert.deepEqual(bundle.manifest.rollback.preservePaths,[
    '/srv/provisionarr/config/sonarr',
    '/srv/provisionarr/config/radarr',
    '/srv/provisionarr/config/prowlarr',
    '/srv/provisionarr/config/qbittorrent',
    '/srv/provisionarr/media/tv',
    '/srv/provisionarr/media/movies',
    '/srv/provisionarr/downloads'
  ]);
  assert.doesNotMatch(JSON.stringify(bundle),/(?:apiKey|password\s*[:=])/i);
});

test('stack generator rejects broad system paths and unsupported fields',()=>{
  const base={configRoot:'/srv/provisionarr/config',mediaRoot:'/srv/provisionarr/media',downloadRoot:'/srv/provisionarr/downloads',puid:1000,pgid:1000,timezone:'Etc/UTC'};
  assert.throws(()=>stackBundle({...base,mediaRoot:'/'}),/safe absolute Linux path/);
  assert.throws(()=>stackBundle({...base,configRoot:'/etc/provisionarr'}),/safe absolute Linux path/);
  assert.throws(()=>stackBundle({...base,dockerSocket:'/var/run/docker.sock'}),/unsupported field/);
  assert.throws(()=>stackBundle({...base,puid:0}),/positive numeric ID/);
});
