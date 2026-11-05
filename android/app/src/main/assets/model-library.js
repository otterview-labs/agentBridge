/* Metadata only in the WebView. Keys stay in BridgeStore's sealed storage. */
(function(global) {
  'use strict';
  const $=id=>document.getElementById(id);
  const tx=(zh,en)=>document.documentElement.lang.startsWith('en')?en:zh;
  let api, section, query='', favorites=false, pending=false;
  function node(tag,cls,value) {const e=document.createElement(tag);e.className=cls||'';if(value!==undefined)e.textContent=value;return e;}
  function action(label,callback) {const e=node('button','messageAction',label);e.type='button';e.disabled=pending||api.busy();e.addEventListener('click',callback);return e;}
  async function choose(id, showForm=true) {return change('select',id,showForm);}
  async function change(operation,id,showForm=true) {
    if(pending||api.busy()) return false;
    pending=true; $('modelLibraryStatus').textContent=''; render();
    try {await api.change(operation,id,showForm);return true;}
    catch(e) {$('modelLibraryStatus').textContent=e.message||tx('操作失败，请重试','Action failed; retry');return false;}
    finally {pending=false;render();}
  }
  function profiles() {return (api?.get()?.modelProfiles||[]).slice().sort((a,b)=>Number(b.favorite)-Number(a.favorite));}
  function render() {
    if(!section)return;
    const list=$('modelLibraryList');list.replaceChildren();
    const active=api.get()?.modelSettings?.profileId;
    for(const item of profiles().filter(p=>(!favorites||p.favorite)&&`${p.name} ${p.modelId} ${p.baseUrl}`.toLowerCase().includes(query.toLowerCase()))) {
      const row=node('div','modelLibraryRow');
      row.append(node('strong','',item.name||item.modelId));
      row.append(node('p','',`${item.modelId} · ${item.profileId===active?tx('当前使用','Current'):item.verifiedAt?tx('曾验证成功','Previously verified'):tx('尚未验证','Not verified')}`));
      const buttons=node('div','modelLibraryActions');
      buttons.append(action(item.profileId===active?tx('正在使用','In use'):tx('使用','Use'),()=>choose(item.profileId)));
      buttons.firstChild.disabled ||= item.profileId===active;
      const favorite=action(item.favorite?tx('取消收藏','Unfavorite'):tx('收藏','Favorite'),()=>change('favorite',item.profileId));
      favorite.setAttribute('aria-pressed',String(!!item.favorite));buttons.append(favorite);
      const remove=action(tx('删除','Delete'),()=>{
        if(global.confirm(tx('删除这套模型配置？其密钥也会从此配置移除，聊天记录保留。','Delete this model configuration and its key? Conversations stay.')))void change('delete',item.profileId);
      });remove.disabled ||= item.profileId===active;buttons.append(remove);
      row.append(buttons);list.append(row);
    }
    if(!list.childElementCount)list.append(node('p','',tx('没有匹配的配置，可添加自己的模型。','No matching configurations. Add your own model.')));
    $('newModelProfile').disabled=pending||api.busy();
  }
  function mount(callbacks) {
    api=callbacks;
    if(document.documentElement.lang.startsWith('en')) { $('modelProfileNameLabel').firstChild.textContent='Configuration name';$('modelProfileName').placeholder='For example: Daily chat, Coding'; }
    section=node('section','modelLibrary');
    section.append(node('h3','',tx('我的模型','My models')));
    const controls=node('div','modelLibraryControls');
    const search=node('input');search.type='search';search.placeholder=tx('搜索配置或模型','Search configurations or models');search.setAttribute('aria-label',search.placeholder);
    search.addEventListener('input',()=>{query=search.value.trim();render();});
    const filter=node('label','');const check=node('input');check.type='checkbox';check.addEventListener('change',()=>{favorites=check.checked;render();});filter.append(check,document.createTextNode(tx('只看收藏','Favorites only')));
    controls.append(search,filter);section.append(controls);
    const list=node('div');list.id='modelLibraryList';section.append(list);
    const create=action(tx('添加模型配置','Add model configuration'),()=>api.create());create.id='newModelProfile';section.append(create);
    const status=node('p');status.id='modelLibraryStatus';status.setAttribute('role','status');section.append(status);
    document.querySelector('#cloudForm .modelFormScroll').prepend(section);
  }
  global.ModelLibrary={mount,render,profiles,choose};
})(window);
