const points = [
  {x:210,y:174},{x:450,y:105},{x:674,y:197},{x:694,y:410},{x:490,y:512},{x:194,y:405}
];
let selectedLine = 0;
let dragging = null;
let addingLine = false;
let extraLines = [{a:1,b:4,type:'Ridge'},{a:0,b:4,type:'Hip'},{a:2,b:4,type:'Valley'}];
const colors = {Eave:'#e8f880',Ridge:'#e4c557',Hip:'#6db5a4',Valley:'#f07d69',Rake:'#728dc4'};
const canvas = document.querySelector('#roofCanvas');
const lineLayer = document.querySelector('#lineLayer');
const vertexLayer = document.querySelector('#vertexLayer');
const roofFill = document.querySelector('#roofFill');

function svgEl(name, attrs={}) { const el=document.createElementNS('http://www.w3.org/2000/svg',name); Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v)); return el; }
function render(){
  roofFill.setAttribute('points',points.map(p=>`${p.x},${p.y}`).join(' '));
  document.querySelector('.roof-shadow').setAttribute('points',roofFill.getAttribute('points'));
  lineLayer.innerHTML=''; vertexLayer.innerHTML='';
  const lines=points.map((_,i)=>({a:i,b:(i+1)%points.length,type:'Eave'})).concat(extraLines);
  lines.forEach((line,i)=>{
    const el=svgEl('line',{x1:points[line.a].x,y1:points[line.a].y,x2:points[line.b].x,y2:points[line.b].y,class:`roof-line ${i===selectedLine?'selected':''} ${i>=points.length?'internal':''}`});
    if(i===selectedLine) el.style.stroke=colors[line.type];
    el.addEventListener('pointerdown',e=>{e.stopPropagation(); selectedLine=i; render(); selectType(line.type);});
    lineLayer.append(el);
  });
  points.forEach((p,i)=>{
    const el=svgEl('circle',{cx:p.x,cy:p.y,r:8,class:`vertex ${dragging===i?'selected':''}`});
    el.addEventListener('pointerdown',e=>{e.preventDefault(); dragging=i; el.setPointerCapture(e.pointerId); render();});
    el.addEventListener('pointermove',e=>{if(dragging!==i)return; const pt=toSvg(e); points[i]={x:pt.x,y:pt.y}; render();});
    el.addEventListener('pointerup',()=>{dragging=null; render(); toast('Vertex updated');});
    vertexLayer.append(el);
  });
  document.querySelector('#lineCount').textContent=lines.length;
  document.querySelector('#vertexCount').textContent=points.length;
}
function toSvg(e){const p=canvas.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(canvas.getScreenCTM().inverse())}
function selectType(type){document.querySelectorAll('.line-type').forEach(b=>b.classList.toggle('selected',b.dataset.type===type));}
function toast(message){const t=document.querySelector('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),1900)}

document.querySelectorAll('.line-type').forEach(btn=>btn.addEventListener('click',()=>{
  const type=btn.dataset.type; const edgeCount=points.length;
  if(selectedLine>=edgeCount) extraLines[selectedLine-edgeCount].type=type;
  selectType(type); render(); toast(`Line classified as ${type}`);
}));
document.querySelector('#dismissTip').addEventListener('click',()=>document.querySelector('#magicTip').classList.add('hidden'));
document.querySelector('#addLineBtn').addEventListener('click',()=>{addingLine=!addingLine; toast(addingLine?'Tap two vertices to add a line':'Add line cancelled');});
vertexLayer.addEventListener('click',e=>{
  if(!addingLine||e.target.tagName!=='circle')return;
  const index=[...vertexLayer.children].indexOf(e.target);
  if(vertexLayer.firstPick===undefined){vertexLayer.firstPick=index;toast('Now tap the ending vertex');}
  else if(index!==vertexLayer.firstPick){extraLines.push({a:vertexLayer.firstPick,b:index,type:'Ridge'});vertexLayer.firstPick=undefined;addingLine=false;selectedLine=points.length+extraLines.length-1;render();toast('New roof line added');}
});
document.querySelector('#addressForm').addEventListener('submit',e=>{e.preventDefault();document.querySelector('#magicTip').classList.remove('hidden');toast('Property located — tap the roof to trace');});
document.querySelector('#googleLink').addEventListener('click',()=>window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(document.querySelector('#address').value)}`,'_blank','noopener'));
document.querySelector('#shareBtn').addEventListener('click',async()=>{const data={title:'Roofline measurement',text:'Review this roof measurement',url:location.href};if(navigator.share)await navigator.share(data);else{await navigator.clipboard?.writeText(location.href);toast('Share link copied');}});
document.querySelector('#finishBtn').addEventListener('click',()=>{document.querySelector('#progressValue').textContent='100%';document.querySelector('#progressBar').style.width='100%';toast('Measurement saved successfully');});
document.querySelector('#undoBtn').addEventListener('click',()=>toast('Nothing else to undo'));
document.querySelector('#redoBtn').addEventListener('click',()=>toast('Nothing else to redo'));
document.querySelector('#zoomIn').addEventListener('click',()=>toast('Zoomed in'));
document.querySelector('#zoomOut').addEventListener('click',()=>toast('Zoomed out'));
document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tool]').forEach(x=>x.classList.remove('active'));b.classList.add('active');toast(`${b.dataset.tool==='pan'?'Pan':'Select'} tool active`)}));
render();
