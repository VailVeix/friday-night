(() => {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const config=window.WATCH_CONFIG||{};
  let password='',busy=false;
  const setBusy=value=>{busy=value;document.querySelectorAll('button').forEach(button=>button.disabled=value);};
  async function rpc(action,payload={}){
    if(!config.supabaseUrl||!config.supabasePublishableKey)throw new Error('Admin is available on the live website.');
    const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/rest/v1/rpc/watch_admin',{
      method:'POST',headers:{apikey:config.supabasePublishableKey,'Content-Type':'application/json'},
      body:JSON.stringify({p_password:password,p_action:action,p_payload:payload}),signal:AbortSignal.timeout(20000)
    });
    const result=await response.json();
    if(!response.ok){
      const allowed=['Invalid admin password','That name is already on the list','Enter a name between 1 and 40 characters','Group is reserved for shared watch history','Use at least 12 characters, up to 72 bytes','Choose an admin password different from the group code'];
      throw new Error(allowed.includes(result.message)?result.message:'Could not save this change. Please try again.');
    }
    return result;
  }
  function render(people){
    $('#people-count').textContent=people.length;
    $('#people-list').replaceChildren(...people.map(name=>{
      const row=document.createElement('li'),avatar=document.createElement('span'),label=document.createElement('span');
      avatar.className='admin-avatar';avatar.textContent=Array.from(name).slice(0,2).join('');avatar.setAttribute('aria-hidden','true');
      label.textContent=name;row.append(avatar,label);return row;
    }));
  }
  $('#admin-login').onsubmit=async event=>{
    event.preventDefault();if(busy)return;setBusy(true);$('#login-error').textContent='';password=$('#admin-password').value;
    try{render(await rpc('list'));$('#admin-password').value='';$('#login-panel').hidden=true;$('#manage-panel').hidden=false;$('#person-name').focus();}
    catch(error){password='';$('#login-error').textContent=error.message;}
    finally{setBusy(false);}
  };
  $('#admin-logout').onclick=()=>{
    if(busy)return;password='';document.querySelectorAll('form').forEach(form=>form.reset());
    document.querySelectorAll('.error,.admin-status').forEach(node=>node.textContent='');$('#people-list').replaceChildren();
    $('#manage-panel').hidden=true;$('#login-panel').hidden=false;$('#admin-password').focus();
  };
  $('#add-person').onsubmit=async event=>{
    event.preventDefault();if(busy)return;setBusy(true);$('#people-error').textContent='';$('#people-status').textContent='';
    const name=$('#person-name').value.trim().replace(/\s+/g,' ');
    try{render(await rpc('add_person',{name}));$('#person-name').value='';$('#people-status').textContent=name+' added to the watch list.';$('#person-name').focus();}
    catch(error){$('#people-error').textContent=error.message;}finally{setBusy(false);}
  };
  $('#change-password').onsubmit=async event=>{
    event.preventDefault();if(busy)return;$('#password-error').textContent='';$('#password-status').textContent='';
    const next=$('#new-password').value;
    if(next!==$('#confirm-password').value){$('#password-error').textContent='Passwords do not match.';return;}
    setBusy(true);
    try{await rpc('change_password',{password:next});password=next;$('#change-password').reset();$('#password-status').textContent='Admin password updated.';}
    catch(error){$('#password-error').textContent=error.message;}finally{setBusy(false);}
  };
})();
