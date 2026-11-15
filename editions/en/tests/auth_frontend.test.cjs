"use strict";

// Isolated DOM-contract checks: no server, real account, or browser is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(relativePath, setupRequired = false) {
  const handlers = {}, calls = [], nodes = new Map();
  let html = '', currentForm = null, focused = null;
  const node = (id, extra = {}) => ({id, value:'', disabled:false, hidden:false, dataset:{}, textContent:'',
    attrs:{}, setAttribute(key,value){this.attrs[key]=value;}, focus(){focused=this;}, ...extra});
  const app = {
    get innerHTML(){return html;},
    set innerHTML(value){
      html=value;nodes.clear();
      const kind=value.match(/data-form="(auth-[^"]+)"/)[1], fields=new Map();
      currentForm=node('auth-account-form',{dataset:{form:kind},elements:{namedItem:name=>fields.get(name)||null}});
      for(const match of value.matchAll(/<input\b([^>]+)>/g)) {
        const attrs=Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
        const field=node(attrs.id,{attrs,form:currentForm});fields.set(attrs.name,field);nodes.set(attrs.id,field);
      }
      const error=node('auth-confirm-error',{hidden:true}), generalError=node('form-error');
      const label=node('submit-label',{textContent:value.match(/data-auth-submit-label>([^<]*)</)[1]});
      const submit=node('submit');
      for(const mode of ['login','register'])nodes.set(mode,node(mode,{dataset:{authMode:mode}}));
      currentForm.querySelector=selector=>({'#auth-confirm-error':error,'.form-error':generalError,'[data-auth-submit-label]':label})[selector]||null;
      currentForm.querySelectorAll=selector=>selector==='button'?[submit]:[];
      currentForm.closest=()=>currentForm;
    },
    querySelector(selector){
      if(selector.startsWith('form'))return currentForm;
      const mode=selector.match(/data-auth-mode="([^"]+)"/);return mode?nodes.get(mode[1]):null;
    },
    querySelectorAll(selector){return selector==='[data-auth-mode]'?[nodes.get('login'),nodes.get('register')]:[];}
  };
  const context=vm.createContext({app,authState:{authenticated:false,setup_required:setupRequired},busy:false,
    document:{addEventListener(type,fn){(handlers[type]??=[]).push(fn);}},
    resetModelSettings(){},icon(){return '<svg></svg>';},dialog:{open:false},location:{hash:''},
    activeGoal:'old-goal',activeTask:'old-task',selectedDocument:'old-doc',searchText:'old-search',knowledgeScope:'personal',
    api:async(url,payload)=>{calls.push({url,payload});if(context.requestError)throw new Error(context.requestError);return {authenticated:true};},
    load:async()=>{context.loaded=true;currentForm=null;},notify(){},
    FormData:class{constructor(form){this.form=form;}get(name){return this.form.elements.namedItem(name)?.value;}},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',relativePath),'utf8'),context,{filename:relativePath});
  context.renderAuth();
  return {context,calls,app,nodes,get form(){return currentForm;},get focused(){return focused;},
    async switchMode(mode){const target={closest:selector=>selector==='[data-auth-mode]'?nodes.get(mode):null};await handlers.click[0]({target});},
    async submit(){await handlers.submit[0]({target:currentForm,preventDefault(){}});},
    async blur(field){for(const fn of handlers.focusout||[])await fn({target:field});},
    async input(field){for(const fn of handlers.input||[])await fn({target:field});},
    evaluate:source=>vm.runInContext(source,context)};
}

for(const file of ['web/workforce.js']) {
  test(`${file}: first account defaults to registration; existing workspace defaults to login`,()=>{
    const first=harness(file,true),existing=harness(file);
    assert.equal(first.form.dataset.form,'auth-register');
    assert.ok(first.form.elements.namedItem('display_name'));
    assert.equal(first.form.elements.namedItem('password').attrs.minlength,'12');
    assert.equal(first.form.elements.namedItem('confirm_password').attrs.autocomplete,'new-password');
    assert.equal(existing.form.dataset.form,'auth-login');
    assert.equal(existing.form.elements.namedItem('password').attrs.autocomplete,'current-password');
    assert.match(existing.app.innerHTML,/data-auth-mode="register"[^>]*aria-pressed="false"/);
    assert.equal(existing.form.elements.namedItem('username').attrs.pattern,'[A-Za-z0-9_.\\-]{3,40}');
    const pattern=new RegExp(`^(?:${existing.form.elements.namedItem('username').attrs.pattern})$`,'v');
    assert.equal(pattern.test('local.member_1-test'),true);
    assert.equal(pattern.test('local member'),false);
  });
  test(`${file}: switching modes preserves drafts in input values and restores keyboard focus`,async()=>{
    const h=harness(file,true);
    h.form.elements.namedItem('display_name').value='Local member';
    h.form.elements.namedItem('username').value='local.member';
    h.form.elements.namedItem('password').value='Private-password-123';
    h.form.elements.namedItem('confirm_password').value='Private-password-123';
    await h.switchMode('login');await h.switchMode('register');
    assert.equal(h.form.elements.namedItem('display_name').value,'Local member');
    assert.equal(h.form.elements.namedItem('username').value,'local.member');
    assert.equal(h.form.elements.namedItem('password').value,'Private-password-123');
    assert.equal(h.form.elements.namedItem('confirm_password').value,'Private-password-123');
    assert.equal(h.focused,h.nodes.get('register'));
    assert.ok(!h.app.innerHTML.includes('Private-password-123'));
  });
  test(`${file}: mismatched confirmation is inline, focused, and sends no request`,async()=>{
    const h=harness(file,true),password=h.form.elements.namedItem('password'),confirmation=h.form.elements.namedItem('confirm_password');
    password.value='First-password-123';confirmation.value='Other-password-123';
    await h.submit();
    assert.equal(h.calls.length,0);
    assert.equal(confirmation.attrs['aria-invalid'],'true');
    assert.equal(h.form.querySelector('#auth-confirm-error').hidden,false);
    assert.equal(h.focused,confirmation);
    await h.blur(confirmation);confirmation.value=password.value;await h.input(confirmation);
    assert.equal(confirmation.attrs['aria-invalid'],'false');
    assert.equal(h.form.querySelector('#auth-confirm-error').hidden,true);
  });
  test(`${file}: registration failure preserves mode and fields and restores controls`,async()=>{
    const h=harness(file);await h.switchMode('register');
    h.form.elements.namedItem('display_name').value='Local member';
    h.form.elements.namedItem('username').value='taken.name';
    h.form.elements.namedItem('password').value='Private-password-123';
    h.form.elements.namedItem('confirm_password').value='Private-password-123';
    h.context.requestError='Username already exists';await h.submit();
    assert.equal(h.calls[0].url,'/api/auth/register');
    assert.equal(h.form.dataset.form,'auth-register');
    assert.equal(h.form.elements.namedItem('username').value,'taken.name');
    assert.equal(h.form.elements.namedItem('password').value,'Private-password-123');
    assert.equal(h.form.querySelector('.form-error').textContent,'Username already exists');
    assert.equal(h.nodes.get('login').disabled,false);
    assert.equal(h.form.attrs['aria-busy'],'false');
    assert.equal(h.context.busy,false);
  });
  test(`${file}: registration uses the local endpoint and clears sensitive drafts after success`,async()=>{
    const h=harness(file,true);
    h.form.elements.namedItem('display_name').value=' Local member ';
    h.form.elements.namedItem('username').value=' local.member ';
    h.form.elements.namedItem('password').value='Private-password-123';
    h.form.elements.namedItem('confirm_password').value='Private-password-123';
    await h.submit();
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{url:'/api/auth/register',payload:{username:'local.member',display_name:'Local member',password:'Private-password-123'}}]);
    assert.equal(h.context.loaded,true);assert.equal(h.context.location.hash,'collaboration');
    for(const key of ['activeGoal','activeTask','selectedDocument','searchText'])assert.equal(h.context[key],'');
    assert.equal(h.context.knowledgeScope,'all');
    assert.equal(h.evaluate('Object.values(authDrafts).flatMap(Object.values).every(value=>value==="")'),true);
  });
  test(`${file}: pending registration blocks duplicate submissions and mode changes`,async()=>{
    const h=harness(file,true);
    h.form.elements.namedItem('password').value='Private-password-123';
    h.form.elements.namedItem('confirm_password').value='Private-password-123';
    let finish,requests=0;
    h.context.api=async()=>{requests++;await new Promise(resolve=>{finish=resolve;});};
    const pending=h.submit();
    assert.equal(h.context.busy,true);
    assert.equal(h.nodes.get('login').disabled,true);
    assert.equal(h.form.attrs['aria-busy'],'true');
    await h.switchMode('login');await h.submit();
    assert.equal(h.form.dataset.form,'auth-register');
    assert.equal(requests,1);
    finish();await pending;
    assert.equal(h.context.busy,false);
  });
}
