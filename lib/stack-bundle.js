'use strict';

const path=require('node:path');

const IMAGES=Object.freeze({
  sonarr:'lscr.io/linuxserver/sonarr@sha256:60f3b6b5c7647ba2bafd81163acfe34b11117b9b834ebd7fbcc3e5f1b309c7ef',
  radarr:'lscr.io/linuxserver/radarr@sha256:079e48870584baf2a3e7e43e7ba6d3c834555931851a59c82c51cc792d285caf',
  prowlarr:'lscr.io/linuxserver/prowlarr@sha256:a89f252d6a22bd25af14a5380aec0adcc3c3af2e3282164f981680e6844070f3',
  qbittorrent:'lscr.io/linuxserver/qbittorrent@sha256:eeea9f8a8cdde23555186843d26e8ded1222421f31f98a5cc1b50c2882ebcf4e'
});

const STACK_MODES=Object.freeze({EXISTING:'existing',MANAGED:'managed'});
const SERVICES=Object.freeze({
  sonarr:Object.freeze({port:8989,healthPath:'/ping'}),
  radarr:Object.freeze({port:7878,healthPath:'/ping'}),
  prowlarr:Object.freeze({port:9696,healthPath:'/ping'}),
  qbittorrent:Object.freeze({port:8080,healthPath:'/'})
});
const MANAGED_FIELDS=Object.freeze(['configRoot','mediaRoot','downloadRoot','puid','pgid','timezone']);

function inputError(message){return Object.assign(new Error(message),{statusCode:400,code:'BUNDLE_INPUT_INVALID'});}

function safeRoot(value,label) {
  const root=String(value||'').trim();
  if(!root||root.length>1024||/[\u0000-\u001f\u007f]/.test(root)||!path.posix.isAbsolute(root)||path.posix.normalize(root)!==root||root==='/'||['/boot','/dev','/etc','/proc','/root','/run','/sys'].some(blocked=>root===blocked||root.startsWith(`${blocked}/`)))throw inputError(`${label} must be a safe absolute Linux path.`);
  return root;
}

function numericId(value,label) {
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<1||id>2147483647)throw inputError(`${label} must be a positive numeric ID.`);
  return id;
}

function timezone(value) {
  const zone=String(value||'Etc/UTC').trim();
  if(!/^[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(zone)||zone.length>100)throw inputError('Timezone is invalid.');
  return zone;
}

function normalizeMode(value) {
  if(value===undefined||value===null||value==='managed'||value==='managed-stack')return STACK_MODES.MANAGED;
  if(value==='existing'||value==='existing-stack')return STACK_MODES.EXISTING;
  throw inputError('Stack mode must be existing or managed.');
}

function validateFields(input,mode) {
  const allowed=new Set(['mode',...(mode===STACK_MODES.MANAGED?MANAGED_FIELDS:[])]);
  if(Object.keys(input).some(key=>!allowed.has(key)))throw inputError('Stack choices contain an unsupported field.');
}

function addresses() {
  return Object.fromEntries(Object.entries(SERVICES).map(([name,service])=>[name,`http://${name}:${service.port}`]));
}

function healthcheck(service) {
  return `wget --no-verbose --tries=1 --spider http://127.0.0.1:${service.port}${service.healthPath} || exit 1`;
}

function existingManifest() {
  return Object.freeze({
    mode:STACK_MODES.EXISTING,
    execution:'connect-only',
    services:Object.freeze(Object.keys(SERVICES)),
    credentialsIncluded:false,
    rollback:Object.freeze({requiresExplicitConfirmation:true,changes:[]})
  });
}

function managedManifest(values) {
  const serviceAddresses=addresses();
  const persistence={
    config:Object.freeze(Object.keys(SERVICES).map(name=>`${values.configRoot}/${name}`)),
    media:Object.freeze([`${values.mediaRoot}/tv`,`${values.mediaRoot}/movies`]),
    downloads:Object.freeze([values.downloadRoot])
  };
  const mounts={
    sonarr:[`${values.configRoot}/sonarr:/config`,`${values.mediaRoot}/tv:/tv`,`${values.downloadRoot}:/downloads`],
    radarr:[`${values.configRoot}/radarr:/config`,`${values.mediaRoot}/movies:/movies`,`${values.downloadRoot}:/downloads`],
    prowlarr:[`${values.configRoot}/prowlarr:/config`],
    qbittorrent:[`${values.configRoot}/qbittorrent:/config`,`${values.downloadRoot}:/downloads`]
  };
  const services=Object.fromEntries(Object.entries(SERVICES).map(([name,service])=>[name,Object.freeze({
    image:IMAGES[name],
    address:serviceAddresses[name],
    healthcheck:`${serviceAddresses[name]}${service.healthPath}`,
    mounts:Object.freeze(mounts[name])
  })]));
  return Object.freeze({
    mode:STACK_MODES.MANAGED,
    execution:'create-and-configure',
    projectName:'provisionarr-media-stack',
    credentialsIncluded:false,
    serviceAddresses:Object.freeze(serviceAddresses),
    services:Object.freeze(services),
    integrations:Object.freeze({
      sonarr:Object.freeze({downloadClient:serviceAddresses.qbittorrent,indexerManager:serviceAddresses.prowlarr}),
      radarr:Object.freeze({downloadClient:serviceAddresses.qbittorrent,indexerManager:serviceAddresses.prowlarr})
    }),
    persistence:Object.freeze(persistence),
    rollback:Object.freeze({
      requiresExplicitConfirmation:true,
      preservePaths:Object.freeze([...persistence.config,...persistence.media,...persistence.downloads]),
      removeServices:Object.freeze(Object.keys(SERVICES))
    })
  });
}

function stackBundle(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw inputError('Stack choices are invalid.');
  const mode=normalizeMode(input.mode);
  validateFields(input,mode);
  if(mode===STACK_MODES.EXISTING)return Object.freeze({version:1,mode,files:Object.freeze({'README.md':'# Existing stack connection\n\nProvisionarr will connect to services you already run. This bundle creates no containers, mounts no host paths, and includes no credentials.\n'}),manifest:existingManifest(),images:IMAGES});

  const values={configRoot:safeRoot(input.configRoot,'Configuration root'),mediaRoot:safeRoot(input.mediaRoot,'Media root'),downloadRoot:safeRoot(input.downloadRoot,'Download root'),puid:numericId(input.puid,'PUID'),pgid:numericId(input.pgid,'PGID'),timezone:timezone(input.timezone)};
  const compose=`name: provisionarr-media-stack

x-service-defaults: &service-defaults
  restart: unless-stopped
  security_opt:
    - no-new-privileges:true
  networks:
    - media-stack
  environment:
    PUID: \${PUID}
    PGID: \${PGID}
    TZ: \${TZ}

services:
  sonarr:
    <<: *service-defaults
    image: ${IMAGES.sonarr}
    volumes:
      - \${CONFIG_ROOT}/sonarr:/config
      - \${MEDIA_ROOT}/tv:/tv
      - \${DOWNLOAD_ROOT}:/downloads
    ports:
      - 127.0.0.1:8989:8989
    healthcheck:
      test: ["CMD-SHELL", "${healthcheck(SERVICES.sonarr)}"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
    depends_on:
      qbittorrent:
        condition: service_healthy

  radarr:
    <<: *service-defaults
    image: ${IMAGES.radarr}
    volumes:
      - \${CONFIG_ROOT}/radarr:/config
      - \${MEDIA_ROOT}/movies:/movies
      - \${DOWNLOAD_ROOT}:/downloads
    ports:
      - 127.0.0.1:7878:7878
    healthcheck:
      test: ["CMD-SHELL", "${healthcheck(SERVICES.radarr)}"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
    depends_on:
      qbittorrent:
        condition: service_healthy

  prowlarr:
    <<: *service-defaults
    image: ${IMAGES.prowlarr}
    volumes:
      - \${CONFIG_ROOT}/prowlarr:/config
    ports:
      - 127.0.0.1:9696:9696
    healthcheck:
      test: ["CMD-SHELL", "${healthcheck(SERVICES.prowlarr)}"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s

  qbittorrent:
    <<: *service-defaults
    image: ${IMAGES.qbittorrent}
    environment:
      PUID: \${PUID}
      PGID: \${PGID}
      TZ: \${TZ}
      WEBUI_PORT: 8080
      TORRENTING_PORT: 6881
    volumes:
      - \${CONFIG_ROOT}/qbittorrent:/config
      - \${DOWNLOAD_ROOT}:/downloads
    ports:
      - 127.0.0.1:8080:8080
      - 6881:6881
      - 6881:6881/udp
    healthcheck:
      test: ["CMD-SHELL", "${healthcheck(SERVICES.qbittorrent)}"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s

networks:
  media-stack:
    name: provisionarr-media-stack
`;
  const environment=`PUID=${values.puid}\nPGID=${values.pgid}\nTZ=${values.timezone}\nCONFIG_ROOT=${values.configRoot}\nMEDIA_ROOT=${values.mediaRoot}\nDOWNLOAD_ROOT=${values.downloadRoot}\n`;
  const instructions=`# Generated media stack\n\nProvisionarr generated this bundle but did not execute it. No Docker socket, API key, password, or host command is included.\n\nFrom a Provisionarr source checkout, validate the downloaded directory first:\n\nnpm run stack:deploy -- --bundle /path/to/bundle --dry-run\n\nApply requires a separate command with explicit confirmation. See docs/STACK-DEPLOYMENT.md before using it.\n\nAfter the services start, connect each service through Provisionarr Guided setup. The generated manifest lists the internal service addresses and the paths preserved by rollback.\n`;
  return Object.freeze({version:1,mode,files:Object.freeze({'compose.yaml':compose,'.env':environment,'README.md':instructions}),manifest:managedManifest(values),images:IMAGES});
}

module.exports=Object.freeze({IMAGES,STACK_MODES,stackBundle,safeRoot});
