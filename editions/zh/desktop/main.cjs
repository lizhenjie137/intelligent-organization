'use strict';
const {app, BrowserWindow, dialog, Menu, session} = require('electron');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const config = require('./edition.json');

const isZh = config.language === 'zh';
const text = (zh, en) => isZh ? zh : en;
const base = process.env.XIAOLAJIAO_DATA_DIR
  ? path.resolve(process.env.XIAOLAJIAO_DATA_DIR)
  : path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Xiaolajiao', config.language);
for (const name of ['profile', 'workspace', 'logs']) fs.mkdirSync(path.join(base, name), {recursive:true});
app.setPath('userData', path.join(base, 'profile'));
app.setAppUserModelId(config.appId);
const gotLock = app.requestSingleInstanceLock();
let window, backend, origin, quitting = false, stopping, killTimer;
const logPath = path.join(base, 'logs', 'desktop.log');
if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
  fs.copyFileSync(logPath, logPath + '.previous');
  fs.writeFileSync(logPath, '');
}
function log(value) {
  fs.appendFileSync(logPath, new Date().toISOString() + ' ' + String(value) + '\n');
}
function localPage(url) {
  try { return new URL(url).origin === origin; } catch { return false; }
}
function secureWindow(target) {
  target.webContents.on('will-navigate', (event, url) => { if (!localPage(url)) event.preventDefault(); });
  target.webContents.on('will-redirect', (event, url) => { if (!localPage(url)) event.preventDefault(); });
  target.webContents.setWindowOpenHandler(({url}) => {
    // The existing workboard opens full-size images in a separate window.
    if (localPage(url) && new URL(url).pathname.startsWith('/api/attachments/')) {
      return {action:'allow', overrideBrowserWindowOptions:{
        width:1000,height:760,autoHideMenuBar:true,
        webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}
      }};
    }
    return {action:'deny'};
  });
  target.webContents.on('did-create-window', child => secureWindow(child));
  target.webContents.on('will-attach-webview', event => event.preventDefault());
}
async function startBackend() {
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'xiaolajiao-server.exe')
    : path.join(__dirname, '..', 'build', 'backend', 'xiaolajiao-server', 'xiaolajiao-server.exe');
  if (!fs.existsSync(executable)) throw new Error(text('缺少本地运行文件，请重新安装。','Local runtime files are missing. Please reinstall.'));
  const workspace = path.join(base, 'workspace');
  backend = spawn(executable, ['--port','0','--desktop-stdio',
    '--db',path.join(workspace,'harness.db'),
    '--runtime-root',path.join(workspace,'runtime'),
    '--model-settings',path.join(workspace,'harness.model-settings.json')],
    {cwd:workspace, windowsHide:true, stdio:['pipe','pipe','pipe'], env:{...process.env, PYTHONUTF8:'1'}});
  // A broken stdin during an unexpected backend exit must not crash the shell.
  backend.stdin.on('error', err => log('Backend stdin: '+err.code));
  const lines = readline.createInterface({input:backend.stdout});
  backend.stderr.on('data', data => log(data.toString('utf8')));
  return await new Promise((resolve, reject) => {
    let ready=false;
    const timeout=setTimeout(()=>reject(new Error(text('本地服务启动超时。','The local service did not start in time.'))),90000);
    backend.once('error', error=>{clearTimeout(timeout);reject(error);});
    lines.on('line', line => {
      if(line.startsWith('XIAOLAJIAO_READY ')){
        try {
          const result=JSON.parse(line.slice('XIAOLAJIAO_READY '.length));
          if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) throw new Error('Invalid port');
          if (!ready) {ready=true;clearTimeout(timeout);resolve('http://127.0.0.1:'+result.port);}
        } catch(error) {clearTimeout(timeout);reject(error);}
      } else log(line);
    });
    backend.once('exit', (code,signal)=>{
      clearTimeout(timeout);log('Backend exited '+code+' '+signal);
      if(!ready) reject(new Error(text('本地服务未能启动。','The local service could not start.')));
      else if(!quitting) {
        dialog.showErrorBox(config.productName,text('本地服务已停止。关闭并重新打开应用即可重试。日志：','The local service stopped. Restart the app to retry. Logs: ')+logPath);
        app.quit();
      }
    });
  });
}
function stopBackend() {
  if(stopping) return stopping;
  stopping=new Promise(resolve=>{
    if(!backend || backend.exitCode!==null || backend.signalCode!==null) return resolve();
    backend.once('exit',()=>{clearTimeout(killTimer);resolve();});
    backend.stdin.end('shutdown\n');
    killTimer=setTimeout(()=>{
      // Only terminate this application's child process tree after graceful shutdown times out.
      if(backend.exitCode!==null || backend.signalCode!==null) return resolve();
      const killer=spawn('taskkill.exe',['/PID',String(backend.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.once('error',()=>{backend.kill();resolve();});
      killer.once('exit',resolve);
    },15000);
  });
  return stopping;
}
if(!gotLock) app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.on('before-quit',event=>{
    if(quitting)return;
    event.preventDefault();quitting=true;
    stopBackend().finally(()=>app.quit());
  });
  app.on('window-all-closed',()=>app.quit());
  app.whenReady().then(async()=>{
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    session.defaultSession.setPermissionCheckHandler(()=>false);
    window=new BrowserWindow({
      title:config.productName,width:1440,height:960,minWidth:1100,minHeight:720,
      backgroundColor:'#f7f8fa',autoHideMenuBar:true,show:false,
      icon:path.join(__dirname,'icon.ico'),
      webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}
    });
    window.once('ready-to-show',()=>window.show());
    await window.loadFile(path.join(__dirname,isZh?'starting-zh.html':'starting-en.html'));
    secureWindow(window);
    origin=await startBackend();
    if(!quitting && !window.isDestroyed()) await window.loadURL(origin);
  }).catch(error=>{
    log(error.stack||error);
    dialog.showErrorBox(config.productName,error.message+'\n'+text('日志：','Logs: ')+logPath);
    app.quit();
  });
}

