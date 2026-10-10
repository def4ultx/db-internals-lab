// Usage: import { mountNav } from '/src/shared/nav.js'; mountNav('explore');
import '/src/shared/theme.css';
const ITEMS = [['index','Home','/index.html'],['explore','3D Explorer','/explore.html'],['learn','Learn','/learn.html'],['compare','Compare Systems','/compare.html']];
export function mountNav(active){
  document.body.classList.add('has-nav');
  const n=document.createElement('nav');n.className='dbnav';
  n.innerHTML='<span class="brand">⛁ DB Internals Lab</span>'+ITEMS.map(([k,t,h])=>`<a href="${h}" class="${k===active?'on':''}">${t}</a>`).join('');
  document.body.prepend(n);
}
