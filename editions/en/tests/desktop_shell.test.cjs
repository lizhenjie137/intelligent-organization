'use strict';
// Execute the real Electron main process with isolated process/OS adapters.
// No app, network listener, child executable or workspace is started by this suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const readline = require('node:readline');

const root = path.resolve(__dirname, '..');
const edition = JSON.parse(fs.readFileSync(path.join(root, 'desktop/edition.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const records = {spawn:[], files:new Map(), mkdir:[], errors:[], windows:[], timers:new Map(), finalQuits:0};
  let nextTimer=0, becomeReady;
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged:options.packaged !== false,
    getPath:() => path.resolve('mock-appdata'),
    setPath:(name,value) => {records[name]=value;},
    setAppUserModelId:value => {records.appId=value;},
    requestSingleInstanceLock:() => options.lock !== false,
    whenReady:() => new Promise(resolve => {becomeReady=resolve;}),
    quit:() => {
      const event={prevented:false,preventDefault(){this.prevented=true;}};
      app.emit('before-quit',event);
      if(!event.prevented)records.finalQuits++;
    }
  });
  class Window extends EventEmitter {
    constructor(settings) {
      super();this.settings=settings;this.loads=[];this.shown=0;this.focused=0;this.restored=0;
      this.webContents=new EventEmitter();
      this.webContents.setWindowOpenHandler=fn => {this.openHandler=fn;};
      records.windows.push(this);
    }
    async loadFile(file){this.loads.push({file});}
    async loadURL(url){this.loads.push({url});}
    show(){this.shown++;}
    focus(){this.focused++;}
    restore(){this.restored++;}
    isMinimized(){return true;}
    isDestroyed(){return false;}
  }
  const defaultSession={
    setPermissionRequestHandler:fn => {records.permissionRequest=fn;},
    setPermissionCheckHandler:fn => {records.permissionCheck=fn;}
  };
  function spawn(executable,args,settings) {
    const child=new EventEmitter();
    Object.assign(child,{pid:4242+records.spawn.length,exitCode:null,signalCode:null,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),input:''});
    child.stdin.on('data',data => {child.input+=data.toString();});
    child.finish=(code=0,signal=null) => {
      child.exitCode=code;child.signalCode=signal;
      child.stdout.end();child.stderr.end();child.emit('exit',code,signal);
    };
    child.kill=() => {child.finish(null,'SIGTERM');};
    records.spawn.push({executable,args,settings,child});
    return child;
  }
  const fakeFS={
    mkdirSync:directory=>records.mkdir.push(directory),
    existsSync:file=>String(file).endsWith('xiaolajiao-server.exe') ? options.runtimePresent!==false : records.files.has(file),
    statSync:file=>({size:(records.files.get(file)||'').length}),
    copyFileSync:(from,to)=>records.files.set(to,records.files.get(from)),
    writeFileSync:(file,data)=>records.files.set(file,String(data)),
    appendFileSync:(file,data)=>records.files.set(file,(records.files.get(file)||'')+data)
  };
  const modules={
    electron:{app,BrowserWindow:Window,dialog:{showErrorBox:(title,message)=>records.errors.push({title,message})},Menu:{setApplicationMenu:value=>{records.menu=value;}},session:{defaultSession}},
    'node:child_process':{spawn},'node:fs':fakeFS,'node:path':path,'node:readline':readline,'./edition.json':edition
  };
  const context=vm.createContext({
    require:name=>{assert.ok(name in modules,`Unexpected main-process dependency: ${name}`);return modules[name];},
    __dirname:path.join(root,'desktop'),URL,Promise,console,
    process:{env:{LOCALAPPDATA:path.resolve('mock-localappdata'),...(options.dataRoot?{XIAOLAJIAO_DATA_DIR:options.dataRoot}:{})},resourcesPath:path.resolve('mock-resources')},
    setTimeout:(fn,ms)=>{const id=++nextTimer;records.timers.set(id,{fn,ms});return id;},
    clearTimeout:id=>records.timers.delete(id)
  });
  vm.runInContext(source,context,{filename:'desktop/main.cjs'});
  return {
    app,records,context,Window,
    async ready(){assert.ok(becomeReady);becomeReady();await tick();await tick();},
    async live(port=49173){await this.ready();records.spawn[0].child.stdout.write('XIAOLAJIAO_RE');records.spawn[0].child.stdout.write('ADY '+JSON.stringify({port})+'\n');await tick();},
    async expire(ms){const timer=[...records.timers.entries()].find(([,t])=>t.ms===ms);assert.ok(timer,`Expected ${ms}ms timer`);records.timers.delete(timer[0]);timer[1].fn();await tick();},
    close(){for(const {child} of records.spawn){child.removeAllListeners();child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();}records.timers.clear();}
  };
}

function securePreferences(settings) {
  assert.equal(settings.webPreferences.nodeIntegration,false);
  assert.equal(settings.webPreferences.contextIsolation,true);
  assert.equal(settings.webPreferences.sandbox,true);
  assert.equal(settings.webPreferences.webSecurity,true);
  assert.equal(settings.webPreferences.preload,undefined);
}

test('packaged startup loads only the child-reported random loopback origin',async t=>{
  const h=harness();t.after(()=>h.close());await h.live(49173);
  const {records:r}=h,child=r.spawn[0];
  assert.equal(child.executable,path.join(path.resolve('mock-resources'),'backend','xiaolajiao-server.exe'));
  assert.equal(child.args[child.args.indexOf('--port')+1],'0');
  assert.ok(child.args.includes('--desktop-stdio'));
  assert.equal(child.settings.windowsHide,true);
  assert.equal(child.args[child.args.indexOf('--db')+1],path.join(path.resolve('mock-localappdata'),'Xiaolajiao',edition.language,'workspace','harness.db'));
  assert.equal(r.userData,path.join(path.resolve('mock-localappdata'),'Xiaolajiao',edition.language,'profile'));
  assert.equal(r.windows[0].loads.at(-1).url,'http://127.0.0.1:49173');
  securePreferences(r.windows[0].settings);
  assert.equal(r.permissionCheck(),false);
  let permission; r.permissionRequest(null,'camera',value=>{permission=value;});assert.equal(permission,false);
});

test('window navigation stays local; attachment popups inherit sandbox and navigation guards',async t=>{
  const h=harness();t.after(()=>h.close());await h.live();const window=h.records.windows[0];
  for(const [url,expected] of [['https://example.test/',true],['file:///C:/private.txt',true],['http://127.0.0.1:49174/',true],['http://127.0.0.1:49173/#collaboration',false]]){
    let prevented=false;window.webContents.emit('will-navigate',{preventDefault(){prevented=true;}},url);assert.equal(prevented,expected,url);
  }
  assert.equal(window.openHandler({url:'https://example.test/'}).action,'deny');
  assert.equal(window.openHandler({url:'http://127.0.0.1:49173/api/export'}).action,'deny');
  const popup=window.openHandler({url:'http://127.0.0.1:49173/api/attachments/file_123/content'});
  assert.equal(popup.action,'allow');securePreferences(popup.overrideBrowserWindowOptions);
  const child=new h.Window(popup.overrideBrowserWindowOptions);window.webContents.emit('did-create-window',child);
  let blocked=false;child.webContents.emit('will-redirect',{preventDefault(){blocked=true;}},'https://example.test/');assert.equal(blocked,true);
  blocked=false;window.webContents.emit('will-attach-webview',{preventDefault(){blocked=true;}});assert.equal(blocked,true);
});

test('closing waits for graceful stdin shutdown and never kills unrelated processes',async t=>{
  const h=harness();t.after(()=>h.close());await h.live();const child=h.records.spawn[0].child;
  h.app.quit();assert.equal(child.input,'shutdown\n');assert.equal(h.records.finalQuits,0);
  const first=h.context.stopBackend(),second=h.context.stopBackend();assert.equal(first,second);
  child.finish();await tick();assert.equal(h.records.finalQuits,1);assert.equal(h.records.spawn.length,1);
  assert.equal([...h.records.timers.values()].some(x=>x.ms===15000),false);
});

test('shutdown deadline targets only the owned process tree',async t=>{
  const h=harness();t.after(()=>h.close());await h.live();h.app.quit();await h.expire(15000);
  const killer=h.records.spawn[1];assert.equal(killer.executable,'taskkill.exe');
  assert.deepEqual(Array.from(killer.args),['/PID','4242','/T','/F']);assert.equal(killer.settings.windowsHide,true);
  killer.child.finish();await tick();assert.equal(h.records.finalQuits,1);
});

test('a second app instance does not spawn another database owner',async t=>{
  const h=harness({lock:false});t.after(()=>h.close());await tick();
  assert.equal(h.records.spawn.length,0);assert.equal(h.records.windows.length,0);assert.equal(h.records.finalQuits,1);
  const existing=harness();t.after(()=>existing.close());await existing.live();
  existing.app.emit('second-instance');const w=existing.records.windows[0];
  assert.equal(w.restored,1);assert.equal(w.focused,1);assert.equal(existing.records.spawn.length,1);
});

test('invalid readiness and startup timeout never load an arbitrary origin',async t=>{
  const h=harness();t.after(()=>h.close());await h.ready();
  h.records.spawn[0].child.stdout.write('XIAOLAJIAO_READY {"port":"https://example.test"}\n');await tick();
  assert.equal(h.records.errors.length,1);assert.equal(h.records.windows[0].loads.some(x=>x.url),false);
  assert.equal(h.records.spawn[0].child.input,'shutdown\n');
  const slow=harness();t.after(()=>slow.close());await slow.ready();await slow.expire(90000);
  assert.equal(slow.records.errors.length,1);assert.equal(slow.records.windows[0].loads.some(x=>x.url),false);
  assert.equal(slow.records.spawn[0].child.input,'shutdown\n');
});

test('unexpected backend exit is reported and closes the app',async t=>{
  const h=harness();t.after(()=>h.close());await h.live();h.records.spawn[0].child.finish(1);await tick();
  assert.equal(h.records.errors.length,1);assert.equal(h.records.finalQuits,1);
});

test('missing executable fails visibly without starting a process',async t=>{
  const h=harness({runtimePresent:false});t.after(()=>h.close());await h.ready();
  assert.equal(h.records.spawn.length,0);assert.equal(h.records.errors.length,1);assert.equal(h.records.finalQuits,1);
});

test('explicit isolated data directory controls both browser profile and business state',async t=>{
  const isolated=path.resolve('isolated-test-workspace');const h=harness({dataRoot:isolated});t.after(()=>h.close());await h.live();
  const child=h.records.spawn[0];assert.equal(h.records.userData,path.join(isolated,'profile'));
  assert.equal(child.settings.cwd,path.join(isolated,'workspace'));
  assert.equal(child.args[child.args.indexOf('--model-settings')+1],path.join(isolated,'workspace','harness.model-settings.json'));
  assert.ok(h.records.mkdir.every(p=>p.startsWith(isolated+path.sep)));
});
