let points = [];
let extraLines = [];
let selectedLine = -1;
let dragging = null;
let activeTool = 'magic';
let mapCenter = { lat: 30.2677, lon: -97.7431 };
const mapZoom = 19;
const colors = { Eave:'#e8f880', Ridge:'#e4c557', Hip:'#6db5a4', Valley:'#f07d69', Rake:'#728dc4' };
const canvas = document.querySelector('#roofCanvas');
const lineLayer = document.querySelector('#lineLayer');
const vertexLayer = document.querySelector('#vertexLayer');
const roofFill = document.querySelector('#roofFill');

function svgEl(name, attrs={}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key,value]) => el.setAttribute(key,value));
  return el;
}

function updateProgress() {
  const hasRoof = points.length > 2;
  document.querySelector('#lineCount').textContent = hasRoof ? points.length + extraLines.length : 0;
  document.querySelector('#vertexCount').textContent = points.length;
  document.querySelector('#areaValue').textContent = hasRoof ? '2,486' : '—';
  document.querySelector('#progressValue').textContent = hasRoof ? '42%' : '0%';
  document.querySelector('#progressBar').style.width = hasRoof ? '42%' : '0%';
  document.querySelector('#stepLabel').textContent = hasRoof ? 'STEP 2 OF 3' : 'STEP 1 OF 3';
  document.querySelector('#editorTitle').textContent = hasRoof ? 'Refine roof outline' : 'Select the roof';
  document.querySelector('#editorHelp').textContent = hasRoof
    ? 'Drag any point to adjust the outline, or add a vertex for more detail. Then select a line to classify it.'
    : 'Choose magic select and touch a roof surface in the aerial image. Add or drag vertices to refine the result.';
}

function render() {
  const pointString = points.map(point => `${point.x},${point.y}`).join(' ');
  roofFill.setAttribute('points', pointString);
  document.querySelector('.roof-shadow').setAttribute('points', pointString);
  lineLayer.innerHTML = '';
  vertexLayer.innerHTML = '';
  const lines = points.length > 2
    ? points.map((_,index) => ({a:index,b:(index+1)%points.length,type:'Eave'})).concat(extraLines)
    : [];
  lines.forEach((line,index) => {
    const el = svgEl('line', {x1:points[line.a].x,y1:points[line.a].y,x2:points[line.b].x,y2:points[line.b].y,class:`roof-line ${index===selectedLine?'selected':''} ${index>=points.length?'internal':''}`});
    if (index === selectedLine) el.style.stroke = colors[line.type];
    el.addEventListener('pointerdown', event => {
      if (activeTool === 'vertex' && index < points.length) {
        event.stopPropagation();
        const point = toSvg(event);
        points.splice(index + 1, 0, {x:point.x,y:point.y});
        setTool('magic');
        render();
        toast('Vertex added — drag it to refine the edge');
        return;
      }
      event.stopPropagation(); selectedLine=index; render(); selectType(line.type);
    });
    lineLayer.append(el);
  });
  points.forEach((point,index) => {
    const el = svgEl('circle', {cx:point.x,cy:point.y,r:8,class:`vertex ${dragging===index?'selected':''}`});
    el.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); dragging=index; el.setPointerCapture(event.pointerId); render(); });
    el.addEventListener('pointermove', event => { if(dragging!==index)return; const next=toSvg(event); points[index]={x:next.x,y:next.y}; render(); });
    el.addEventListener('pointerup', () => { dragging=null; render(); toast('Vertex updated'); });
    vertexLayer.append(el);
  });
  updateProgress();
}

function toSvg(event) { const point=canvas.createSVGPoint(); point.x=event.clientX; point.y=event.clientY; return point.matrixTransform(canvas.getScreenCTM().inverse()); }
function selectType(type) { document.querySelectorAll('.line-type').forEach(button => button.classList.toggle('selected',button.dataset.type===type)); }
function toast(message) { const el=document.querySelector('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),1900); }

function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('active',button.dataset.tool===tool));
  canvas.classList.toggle('adding-vertex', tool === 'vertex');
}

function magicSelect(point) {
  if (points.length) return;
  const pulse = document.querySelector('#selectionPulse');
  pulse.innerHTML = `<circle class="scan-ring" cx="${point.x}" cy="${point.y}" r="18"/>`;
  document.querySelector('#magicTip strong').textContent = 'Finding matching roof pixels…';
  document.querySelector('#magicTip span').textContent = 'Analyzing color and connected edges';
  window.setTimeout(() => {
    const x=Math.max(155,Math.min(745,point.x)); const y=Math.max(135,Math.min(505,point.y));
    points = [
      {x:x-166,y:y-70},{x:x-42,y:y-124},{x:x+153,y:y-65},
      {x:x+170,y:y+77},{x:x+28,y:y+128},{x:x-157,y:y+72}
    ];
    extraLines = [{a:1,b:4,type:'Ridge'},{a:0,b:4,type:'Hip'},{a:2,b:4,type:'Valley'}];
    selectedLine = 0;
    pulse.innerHTML = '';
    document.querySelector('#magicTip strong').textContent = 'Roof surface selected';
    document.querySelector('#magicTip span').textContent = 'Drag points or use + to add more vertices.';
    render(); toast('Magic select created an editable outline');
  }, 700);
}

canvas.addEventListener('pointerdown', event => {
  if (event.target !== canvas && event.target !== roofFill) return;
  if (activeTool === 'magic') magicSelect(toSvg(event));
});

document.querySelectorAll('.line-type').forEach(button => button.addEventListener('click', () => {
  if (selectedLine < 0 || !points.length) { toast('Select the roof first'); return; }
  const type=button.dataset.type;
  if(selectedLine>=points.length) extraLines[selectedLine-points.length].type=type;
  selectType(type); render(); toast(`Line classified as ${type}`);
}));
document.querySelector('#dismissTip').addEventListener('click',()=>document.querySelector('#magicTip').classList.add('hidden'));
document.querySelector('#addVertexBtn').addEventListener('click',()=>{ if(!points.length){toast('Magic select a roof first');return;} setTool('vertex');toast('Tap an outline edge to add a vertex'); });

function lonToX(lon,z){ return (lon+180)/360*2**z; }
function latToY(lat,z){ const rad=lat*Math.PI/180; return (1-Math.asinh(Math.tan(rad))/Math.PI)/2*2**z; }
function renderTiles(){
  const layer=document.querySelector('#tileLayer'); layer.innerHTML='';
  const centerX=lonToX(mapCenter.lon,mapZoom); const centerY=latToY(mapCenter.lat,mapZoom);
  const stage=document.querySelector('#mapStage'); const width=stage.clientWidth||900; const height=stage.clientHeight||650;
  const startX=Math.floor(centerX-width/512)-1; const endX=Math.ceil(centerX+width/512)+1;
  const startY=Math.floor(centerY-height/512)-1; const endY=Math.ceil(centerY+height/512)+1;
  for(let x=startX;x<=endX;x++) for(let y=startY;y<=endY;y++){
    const image=new Image(); image.alt=''; image.draggable=false;
    image.src=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${mapZoom}/${y}/${x}`;
    image.style.left=`${width/2+(x-centerX)*256}px`; image.style.top=`${height/2+(y-centerY)*256}px`; layer.append(image);
  }
}

function propertyName(address) { return address.split(',')[0].trim() || address; }
function showProperty(address) {
  document.querySelector('#locationAddress').textContent=address;
  document.querySelector('#mapLocation strong').textContent=propertyName(address);
  document.querySelector('#locationStatus').classList.add('visible');
  points=[]; extraLines=[]; selectedLine=-1; setTool('magic'); render();
  document.querySelector('#magicTip').classList.remove('hidden');
  document.querySelector('#magicTip strong').textContent='Touch the roof to magic select';
  document.querySelector('#magicTip span').textContent='We’ll group similar-colored roof surfaces.';
}
document.querySelector('#addressForm').addEventListener('submit',async event=>{
  event.preventDefault(); const input=document.querySelector('#address'); const address=input.value.trim(); if(!address){input.focus();toast('Enter a property address first');return;}
  const overlay=document.querySelector('#searchingOverlay'); const submit=event.currentTarget.querySelector('[type="submit"]'); overlay.classList.add('visible'); submit.disabled=true;
  try { const response=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,{headers:{Accept:'application/json'}}); const [result]=await response.json(); if(result) mapCenter={lat:Number(result.lat),lon:Number(result.lon)}; else toast('Address not found — showing the current area'); }
  catch { toast('Could not search right now — showing the current area'); }
  renderTiles(); showProperty(address); overlay.classList.remove('visible'); submit.disabled=false; toast('Aerial imagery centered — touch the roof');
});
document.querySelector('#googleLink').addEventListener('click',()=>window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(document.querySelector('#address').value)}`,'_blank','noopener'));
document.querySelector('#shareBtn').addEventListener('click',async()=>{const data={title:'Roofline measurement',text:'Review this roof measurement',url:location.href};if(navigator.share)await navigator.share(data);else{await navigator.clipboard?.writeText(location.href);toast('Share link copied');}});
document.querySelector('#finishBtn').addEventListener('click',()=>{if(!points.length){toast('Select a roof before finishing');return;}document.querySelector('#progressValue').textContent='100%';document.querySelector('#progressBar').style.width='100%';toast('Measurement saved successfully');});
document.querySelector('#undoBtn').addEventListener('click',()=>{if(!points.length){toast('Nothing to undo');return;}points=[];extraLines=[];selectedLine=-1;render();toast('Roof selection removed');});
document.querySelector('#redoBtn').addEventListener('click',()=>toast('Nothing to redo'));
document.querySelector('#zoomIn').addEventListener('click',()=>toast('Imagery is at maximum detail'));
document.querySelector('#zoomOut').addEventListener('click',()=>toast('Zoom out is available in the full map'));
document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>{setTool(button.dataset.tool);toast(`${button.dataset.tool==='magic'?'Magic select':button.dataset.tool==='vertex'?'Add vertex':'Pan'} tool active`);}));
window.addEventListener('resize',renderTiles);
renderTiles(); render();
