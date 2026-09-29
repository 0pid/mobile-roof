let points = [];
let extraLines = [];
let selectedLine = -1;
let dragging = null;
let activeTool = 'magic';
let mapCenter = { lat: 30.2677, lon: -97.7431 };
let selectedAreaSquareFeet = 0;
let tileRenderId = 0;
const loadedTiles = [];
const mapZoom = 19;
const colors = { Eave:'#e8f880', Ridge:'#e4c557', Hip:'#6db5a4', Valley:'#f07d69', Rake:'#728dc4' };
const canvas = document.querySelector('#roofCanvas');
const lineLayer = document.querySelector('#lineLayer');
const vertexLayer = document.querySelector('#vertexLayer');
const roofFill = document.querySelector('#roofFill');
const selectionMask = document.querySelector('#selectionMask');
const imageryCanvas = document.createElement('canvas');

function svgEl(name, attrs={}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key,value]) => el.setAttribute(key,value));
  return el;
}

function updateProgress() {
  const hasRoof = points.length > 2;
  document.querySelector('#lineCount').textContent = hasRoof ? points.length + extraLines.length : 0;
  document.querySelector('#vertexCount').textContent = points.length;
  document.querySelector('#areaValue').textContent = hasRoof && selectedAreaSquareFeet ? Math.round(selectedAreaSquareFeet).toLocaleString() : '—';
  document.querySelector('#progressValue').textContent = hasRoof ? '42%' : '0%';
  document.querySelector('#progressBar').style.width = hasRoof ? '42%' : '0%';
  document.querySelector('#stepLabel').textContent = hasRoof ? 'STEP 2 OF 3' : 'STEP 1 OF 3';
  document.querySelector('#editorTitle').textContent = hasRoof ? 'Refine roof outline' : 'Select the roof';
  document.querySelector('#editorHelp').textContent = hasRoof
    ? 'Drag any point to adjust the outline, or add a vertex for more detail. Then select a line to classify it.'
    : 'Choose the magic lasso and touch a roof surface in the aerial image. Add or drag vertices to refine the result.';
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
function svgToStage(point) {
  const svgPoint=canvas.createSVGPoint(); svgPoint.x=point.x; svgPoint.y=point.y;
  const screenPoint=svgPoint.matrixTransform(canvas.getScreenCTM());
  const stageBounds=document.querySelector('#mapStage').getBoundingClientRect();
  return {x:screenPoint.x-stageBounds.left,y:screenPoint.y-stageBounds.top};
}
function stageToSvg(point) {
  const stageBounds=document.querySelector('#mapStage').getBoundingClientRect();
  const screenPoint=canvas.createSVGPoint(); screenPoint.x=stageBounds.left+point.x; screenPoint.y=stageBounds.top+point.y;
  const svgPoint=screenPoint.matrixTransform(canvas.getScreenCTM().inverse());
  return {x:svgPoint.x,y:svgPoint.y};
}
function selectType(type) { document.querySelectorAll('.line-type').forEach(button => button.classList.toggle('selected',button.dataset.type===type)); }
function toast(message) { const el=document.querySelector('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),1900); }

function setTool(tool) {
  activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('active',button.dataset.tool===tool));
  canvas.classList.toggle('adding-vertex', tool === 'vertex');
}

function colorDistance(a, b) {
  const red = a[0]-b[0], green = a[1]-b[1], blue = a[2]-b[2];
  return Math.sqrt(red*red*.3 + green*green*.59 + blue*blue*.11);
}

function convexHull(source) {
  const sorted = [...source].sort((a,b) => a.x-b.x || a.y-b.y);
  if (sorted.length < 4) return sorted;
  const cross = (origin,a,b) => (a.x-origin.x)*(b.y-origin.y)-(a.y-origin.y)*(b.x-origin.x);
  const lower=[]; for (const point of sorted) { while(lower.length>1 && cross(lower.at(-2),lower.at(-1),point)<=0) lower.pop(); lower.push(point); }
  const upper=[]; for (const point of sorted.reverse()) { while(upper.length>1 && cross(upper.at(-2),upper.at(-1),point)<=0) upper.pop(); upper.push(point); }
  lower.pop(); upper.pop(); return lower.concat(upper);
}

function simplifyHull(hull, maximumPoints=12) {
  const result=[...hull];
  while(result.length>maximumPoints) {
    let removeAt=0, smallest=Infinity;
    result.forEach((point,index) => {
      const before=result[(index-1+result.length)%result.length], after=result[(index+1)%result.length];
      const area=Math.abs((point.x-before.x)*(after.y-before.y)-(point.y-before.y)*(after.x-before.x));
      if(area<smallest){smallest=area;removeAt=index;}
    });
    result.splice(removeAt,1);
  }
  return result;
}

function traceConnectedColor(stageX, stageY, tolerance=34) {
  const width=imageryCanvas.width, height=imageryCanvas.height;
  if (!width || !height) return null;
  const source=imageryCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
  const step=3, cols=Math.ceil(width/step), rows=Math.ceil(height/step);
  const seedX=Math.max(0,Math.min(cols-1,Math.floor(stageX/step)));
  const seedY=Math.max(0,Math.min(rows-1,Math.floor(stageY/step)));
  const pixelAt=(x,y) => { const index=(Math.min(height-1,y*step)*width+Math.min(width-1,x*step))*4; return [source[index],source[index+1],source[index+2],source[index+3]]; };
  const seed=pixelAt(seedX,seedY); if(seed[3]<200)return null;
  const visited=new Uint8Array(cols*rows), mask=new Uint8Array(cols*rows);
  const queueX=new Int32Array(cols*rows), queueY=new Int32Array(cols*rows); let head=0,tail=1;
  queueX[0]=seedX; queueY[0]=seedY; visited[seedY*cols+seedX]=1;
  let count=0, minX=seedX, maxX=seedX, minY=seedY, maxY=seedY;
  const maximumPixels=Math.floor(cols*rows*.12);
  while(head<tail) {
    const x=queueX[head], y=queueY[head++], current=pixelAt(x,y), index=y*cols+x;
    mask[index]=1; count++;
    minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y);
    if(count>maximumPixels)return null;
    const neighbors=[[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
    for(const [nextX,nextY] of neighbors) {
      if(nextX<0||nextY<0||nextX>=cols||nextY>=rows)continue;
      const nextIndex=nextY*cols+nextX;
      if(!visited[nextIndex] && colorDistance(pixelAt(nextX,nextY),seed)<=tolerance){visited[nextIndex]=1;queueX[tail]=nextX;queueY[tail++]=nextY;}
    }
  }
  const boxWidth=(maxX-minX+1)/cols, boxHeight=(maxY-minY+1)/rows;
  if(count<35 || boxWidth>.48 || boxHeight>.48 || boxWidth*boxHeight>.16) return null;
  const boundary=[];
  for(let y=1;y<rows-1;y++) for(let x=1;x<cols-1;x++) if(mask[y*cols+x] && (!mask[y*cols+x-1]||!mask[y*cols+x+1]||!mask[(y-1)*cols+x]||!mask[(y+1)*cols+x])) boundary.push({x:x*step,y:y*step});
  if(boundary.length<3)return null;
  return {mask,cols,rows,step,count,boundary};
}

function drawSelectionMask(selection) {
  const stage=document.querySelector('#mapStage'), width=stage.clientWidth, height=stage.clientHeight;
  selectionMask.width=width; selectionMask.height=height;
  const context=selectionMask.getContext('2d'); context.clearRect(0,0,width,height); context.fillStyle='rgba(217,239,115,.28)';
  for(let y=0;y<selection.rows;y++) for(let x=0;x<selection.cols;x++) if(selection.mask[y*selection.cols+x]) context.fillRect(x*selection.step,y*selection.step,selection.step,selection.step);
}

function magicSelect(point) {
  if (points.length) return;
  const pulse = document.querySelector('#selectionPulse');
  pulse.innerHTML = `<circle class="scan-ring" cx="${point.x}" cy="${point.y}" r="18"/>`;
  document.querySelector('#magicTip strong').textContent = 'Finding matching roof pixels…';
  document.querySelector('#magicTip span').textContent = 'Analyzing color and connected edges';
  window.setTimeout(() => {
    let selection;
    try {
      const stagePoint=svgToStage(point);
      for(const tolerance of [25,31,37,43]) {
        const candidate=traceConnectedColor(stagePoint.x,stagePoint.y,tolerance);
        if(candidate)selection=candidate;
      }
    }
    catch { selection=null; }
    if(!selection) {
      pulse.innerHTML='';
      document.querySelector('#magicTip strong').textContent='No clear roof plane found';
      document.querySelector('#magicTip span').textContent='Tap directly on a roof plane—not the surrounding lawn or road.';
      toast('That color covers too much of the image — tap the roof itself'); return;
    }
    const hull=simplifyHull(convexHull(selection.boundary));
    points=hull.map(stageToSvg);
    extraLines = [];
    const metersPerPixel=Math.cos(mapCenter.lat*Math.PI/180)*156543.03392/2**mapZoom;
    selectedAreaSquareFeet=selection.count*selection.step**2*metersPerPixel**2*10.7639;
    drawSelectionMask(selection);
    selectedLine = 0;
    pulse.innerHTML = '';
    document.querySelector('#magicTip strong').textContent = 'Roof surface selected';
    document.querySelector('#magicTip span').textContent = `${points.length} editable corners found from the selected pixels.`;
    render(); toast('Magic lasso traced the connected roof color');
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
document.querySelector('#addVertexBtn').addEventListener('click',()=>{ if(!points.length){toast('Use the magic lasso on a roof first');return;} setTool('vertex');toast('Tap an outline edge to add a vertex'); });

function lonToX(lon,z){ return (lon+180)/360*2**z; }
function latToY(lat,z){ const rad=lat*Math.PI/180; return (1-Math.asinh(Math.tan(rad))/Math.PI)/2*2**z; }
function renderTiles(){
  const layer=document.querySelector('#tileLayer'); layer.innerHTML='';
  loadedTiles.length=0; const renderId=++tileRenderId;
  const centerX=lonToX(mapCenter.lon,mapZoom); const centerY=latToY(mapCenter.lat,mapZoom);
  const stage=document.querySelector('#mapStage'); const width=stage.clientWidth||900; const height=stage.clientHeight||650;
  imageryCanvas.width=width; imageryCanvas.height=height;
  const startX=Math.floor(centerX-width/512)-1; const endX=Math.ceil(centerX+width/512)+1;
  const startY=Math.floor(centerY-height/512)-1; const endY=Math.ceil(centerY+height/512)+1;
  for(let x=startX;x<=endX;x++) for(let y=startY;y<=endY;y++){
    const image=new Image(); image.alt=''; image.draggable=false;
    image.crossOrigin='anonymous';
    const left=width/2+(x-centerX)*256, top=height/2+(y-centerY)*256;
    image.style.left=`${left}px`; image.style.top=`${top}px`;
    image.addEventListener('load',()=>{
      if(renderId!==tileRenderId)return;
      loadedTiles.push({image,left,top});
      const context=imageryCanvas.getContext('2d',{willReadFrequently:true});
      context.clearRect(0,0,width,height);
      loadedTiles.forEach(tile=>context.drawImage(tile.image,tile.left,tile.top,256,256));
    });
    image.src=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${mapZoom}/${y}/${x}`;
    layer.append(image);
  }
}

function propertyName(address) { return address.split(',')[0].trim() || address; }
function showProperty(address) {
  document.querySelector('#locationAddress').textContent=address;
  document.querySelector('#mapLocation strong').textContent=propertyName(address);
  document.querySelector('#locationStatus').classList.add('visible');
  points=[]; extraLines=[]; selectedLine=-1; selectedAreaSquareFeet=0; selectionMask.getContext('2d').clearRect(0,0,selectionMask.width,selectionMask.height); setTool('magic'); render();
  document.querySelector('#magicTip').classList.remove('hidden');
  document.querySelector('#magicTip strong').textContent='Touch a roof with the magic lasso';
  document.querySelector('#magicTip span').textContent='We’ll follow connected pixels with similar colors.';
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
document.querySelector('#undoBtn').addEventListener('click',()=>{if(!points.length){toast('Nothing to undo');return;}points=[];extraLines=[];selectedLine=-1;selectedAreaSquareFeet=0;selectionMask.getContext('2d').clearRect(0,0,selectionMask.width,selectionMask.height);render();toast('Roof selection removed');});
document.querySelector('#redoBtn').addEventListener('click',()=>toast('Nothing to redo'));
document.querySelector('#zoomIn').addEventListener('click',()=>toast('Imagery is at maximum detail'));
document.querySelector('#zoomOut').addEventListener('click',()=>toast('Zoom out is available in the full map'));
document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>{setTool(button.dataset.tool);toast(`${button.dataset.tool==='magic'?'Magic lasso':button.dataset.tool==='vertex'?'Add vertex':'Pan'} tool active`);}));
window.addEventListener('resize',renderTiles);
renderTiles(); render();
