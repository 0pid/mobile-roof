let points = [];
let extraLines = [];
let selectedLine = -1;
let dragging = null;
let activeTool = 'magic';
let painting = false;
let paintPoints = [];
let panGesture = null;
let polygonVisible = true;
let mapCenter = { lat: 30.2677, lon: -97.7431 };
let selectedAreaSquareFeet = 0;
let tileRenderId = 0;
const loadedTiles = [];
let mapZoom = 20;
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
    : 'Choose the magic lasso, then drag across a roof surface to paint a sample. Add, remove, or drag vertices to refine the result.';
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
    el.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation();
      if(activeTool==='remove') {
        if(points.length<=3){toast('A roof needs at least three vertices');return;}
        points.splice(index,1);
        extraLines=extraLines.filter(line=>line.a!==index&&line.b!==index).map(line=>({ ...line,a:line.a>index?line.a-1:line.a,b:line.b>index?line.b-1:line.b }));
        selectedLine=-1; render(); toast('Vertex removed'); return;
      }
      dragging=index; el.setPointerCapture(event.pointerId); render();
    });
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
  canvas.classList.toggle('removing-vertex', tool === 'remove');
  canvas.classList.toggle('pan-tool', tool === 'pan');
}

function colorDistance(a, b) {
  const red = a[0]-b[0], green = a[1]-b[1], blue = a[2]-b[2];
  return Math.sqrt(red*red*.3 + green*green*.59 + blue*blue*.11);
}

function samplePaintColor(pixelAt, seed, cols, rows) {
  const samples=[];
  for(let offsetY=-1;offsetY<=1;offsetY++) for(let offsetX=-1;offsetX<=1;offsetX++) {
    const color=pixelAt(Math.max(0,Math.min(cols-1,seed.x+offsetX)),Math.max(0,Math.min(rows-1,seed.y+offsetY)));
    if(color[3]>200)samples.push(color);
  }
  return [0,1,2].map(channel=>samples.reduce((sum,color)=>sum+color[channel],0)/samples.length);
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

function extractMaskContour(mask, cols, rows, step) {
  const edges=[];
  const add=(x1,y1,x2,y2)=>edges.push({from:`${x1},${y1}`,to:`${x2},${y2}`,point:{x:x1*step,y:y1*step}});
  for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) if(mask[y*cols+x]) {
    if(y===0||!mask[(y-1)*cols+x])add(x,y,x+1,y);
    if(x===cols-1||!mask[y*cols+x+1])add(x+1,y,x+1,y+1);
    if(y===rows-1||!mask[(y+1)*cols+x])add(x+1,y+1,x,y+1);
    if(x===0||!mask[y*cols+x-1])add(x,y+1,x,y);
  }
  const outgoing=new Map();
  edges.forEach((edge,index)=>{if(!outgoing.has(edge.from))outgoing.set(edge.from,[]);outgoing.get(edge.from).push(index);});
  const used=new Uint8Array(edges.length), loops=[];
  edges.forEach((edge,startIndex)=>{
    if(used[startIndex])return;
    const loop=[]; let index=startIndex;
    while(index!==undefined&&!used[index]) {
      const current=edges[index]; used[index]=1; loop.push(current.point);
      index=(outgoing.get(current.to)||[]).find(candidate=>!used[candidate]);
    }
    if(loop.length>3)loops.push(loop);
  });
  const area=loop=>Math.abs(loop.reduce((sum,point,index)=>{const next=loop[(index+1)%loop.length];return sum+point.x*next.y-next.x*point.y;},0));
  return loops.sort((a,b)=>area(b)-area(a))[0]||[];
}

function fillEnclosedMaskAreas(mask, cols, rows) {
  const exterior=new Uint8Array(mask.length), queue=new Int32Array(mask.length); let head=0,tail=0;
  const visit=(x,y)=>{const index=y*cols+x;if(!mask[index]&&!exterior[index]){exterior[index]=1;queue[tail++]=index;}};
  for(let x=0;x<cols;x++){visit(x,0);visit(x,rows-1);}
  for(let y=0;y<rows;y++){visit(0,y);visit(cols-1,y);}
  while(head<tail) {
    const index=queue[head++], x=index%cols, y=Math.floor(index/cols);
    if(x>0)visit(x-1,y); if(x<cols-1)visit(x+1,y); if(y>0)visit(x,y-1); if(y<rows-1)visit(x,y+1);
  }
  let filled=0;
  for(let index=0;index<mask.length;index++)if(!mask[index]&&!exterior[index]){mask[index]=1;filled++;}
  return filled;
}

function tracePaintedRegion(stagePoints, tolerance=34) {
  const width=imageryCanvas.width, height=imageryCanvas.height;
  if (!width || !height || !stagePoints.length) return null;
  const source=imageryCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
  const step=3, cols=Math.ceil(width/step), rows=Math.ceil(height/step);
  const seeds=stagePoints.map(point=>({x:Math.max(0,Math.min(cols-1,Math.floor(point.x/step))),y:Math.max(0,Math.min(rows-1,Math.floor(point.y/step)))}));
  const pixelAt=(x,y) => { const index=(Math.min(height-1,y*step)*width+Math.min(width-1,x*step))*4; return [source[index],source[index+1],source[index+2],source[index+3]]; };
  if(seeds.some(seed=>pixelAt(seed.x,seed.y)[3]<200))return null;
  const palette=[];
  seeds.forEach(seed=>{
    const color=samplePaintColor(pixelAt,seed,cols,rows);
    if(palette.length<10 && !palette.some(existing=>colorDistance(existing,color)<7))palette.push(color);
  });
  if(!palette.length)return null;
  const matchesPalette=color=>Math.min(...palette.map(sample=>colorDistance(color,sample)))<=tolerance;
  const visited=new Uint8Array(cols*rows), mask=new Uint8Array(cols*rows);
  const queueX=new Int32Array(cols*rows), queueY=new Int32Array(cols*rows); let head=0,tail=0;
  seeds.forEach(seed=>{const index=seed.y*cols+seed.x;if(!visited[index]){visited[index]=1;queueX[tail]=seed.x;queueY[tail++]=seed.y;}});
  let count=0, minX=seeds[0].x, maxX=seeds[0].x, minY=seeds[0].y, maxY=seeds[0].y;
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
      if(!visited[nextIndex] && matchesPalette(pixelAt(nextX,nextY))){visited[nextIndex]=1;queueX[tail]=nextX;queueY[tail++]=nextY;}
    }
  }
  count+=fillEnclosedMaskAreas(mask,cols,rows);
  if(count>maximumPixels)return null;
  const boxWidth=(maxX-minX+1)/cols, boxHeight=(maxY-minY+1)/rows;
  const boxPixelArea=(maxX-minX+1)*(maxY-minY+1), compactness=count/boxPixelArea;
  if(count<8 || boxWidth>.48 || boxHeight>.48 || boxWidth*boxHeight>.16 || compactness<.2) return null;
  const boundary=extractMaskContour(mask,cols,rows,step);
  if(boundary.length<3)return null;
  return {mask,cols,rows,step,count,boundary,palette};
}

function drawSelectionMask(selection) {
  const stage=document.querySelector('#mapStage'), width=stage.clientWidth, height=stage.clientHeight;
  selectionMask.width=width; selectionMask.height=height;
  const context=selectionMask.getContext('2d'); context.clearRect(0,0,width,height); context.fillStyle='rgba(217,239,115,.28)';
  for(let y=0;y<selection.rows;y++) for(let x=0;x<selection.cols;x++) if(selection.mask[y*selection.cols+x]) context.fillRect(x*selection.step,y*selection.step,selection.step,selection.step);
}

function magicSelect(stroke) {
  if (points.length) return;
  const pulse = document.querySelector('#selectionPulse');
  pulse.innerHTML = `<polyline class="paint-stroke processing" points="${stroke.map(point=>`${point.x},${point.y}`).join(' ')}"/>`;
  document.querySelector('#magicTip strong').textContent = 'Finding matching roof pixels…';
  document.querySelector('#magicTip span').textContent = 'Fitting straight borders to the highlighted roof region';
  window.setTimeout(() => {
    let selection;
    try {
      const stagePoints=stroke.map(svgToStage);
      for(const tolerance of [8,12,16,22,28]) {
        const candidate=tracePaintedRegion(stagePoints,tolerance);
        if(!candidate)continue;
        if(selection && candidate.count>selection.count*1.65)break;
        selection=candidate;
      }
    }
    catch { selection=null; }
    if(!selection) {
      pulse.innerHTML='';
      document.querySelector('#magicTip strong').textContent='Add a little more roof detail';
      document.querySelector('#magicTip span').textContent='Paint a longer stroke inside the roof, including a light and dark section.';
      toast('Not enough roof detail yet — paint a slightly longer stroke'); return;
    }
    const outline=simplifyHull(selection.boundary,12);
    points=outline.map(stageToSvg);
    extraLines = [];
    const metersPerPixel=Math.cos(mapCenter.lat*Math.PI/180)*156543.03392/2**mapZoom;
    selectedAreaSquareFeet=selection.count*selection.step**2*metersPerPixel**2*10.7639;
    drawSelectionMask(selection);
    selectedLine = 0;
    pulse.innerHTML = '';
    document.querySelector('#magicTip strong').textContent = 'Roof surface selected';
    document.querySelector('#magicTip span').textContent = `${points.length} border corners found from your painted roof sample.`;
    render(); toast('Magic lasso traced the connected roof color');
  }, 700);
}

function appendPaintPoint(event) {
  const point=toSvg(event), previous=paintPoints.at(-1);
  if(previous && Math.hypot(point.x-previous.x,point.y-previous.y)<9)return;
  paintPoints.push({x:point.x,y:point.y});
  document.querySelector('#selectionPulse').innerHTML=`<polyline class="paint-stroke" points="${paintPoints.map(item=>`${item.x},${item.y}`).join(' ')}"/>`;
}
canvas.addEventListener('pointerdown', event => {
  if(activeTool==='pan') {
    event.preventDefault();
    clearRoofSelection(false);
    panGesture={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,centerX:lonToX(mapCenter.lon,mapZoom),centerY:latToY(mapCenter.lat,mapZoom)};
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('panning');
    return;
  }
  if(activeTool!=='magic' || points.length)return;
  event.preventDefault(); painting=true; paintPoints=[]; canvas.setPointerCapture(event.pointerId); appendPaintPoint(event);
  document.querySelector('#magicTip strong').textContent='Paint across the roof plane';
  document.querySelector('#magicTip span').textContent='Release when the roof surface is covered.';
});
canvas.addEventListener('pointermove', event=>{
  if(panGesture && event.pointerId===panGesture.pointerId) {
    const offsetX=event.clientX-panGesture.startX, offsetY=event.clientY-panGesture.startY;
    document.querySelector('#tileLayer').style.transform=`translate(${offsetX}px,${offsetY}px)`;
    return;
  }
  if(painting)appendPaintPoint(event);
});
canvas.addEventListener('pointerup', event=>{
  if(panGesture && event.pointerId===panGesture.pointerId) {
    const offsetX=event.clientX-panGesture.startX, offsetY=event.clientY-panGesture.startY;
    mapCenter={lon:xToLon(panGesture.centerX-offsetX/256,mapZoom),lat:yToLat(panGesture.centerY-offsetY/256,mapZoom)};
    panGesture=null; canvas.classList.remove('panning'); document.querySelector('#tileLayer').style.transform='';
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    renderTiles(); toast('Map repositioned'); return;
  }
  if(!painting)return; appendPaintPoint(event); painting=false;
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  magicSelect([...paintPoints]);
});
canvas.addEventListener('pointercancel',()=>{painting=false;paintPoints=[];panGesture=null;canvas.classList.remove('panning');document.querySelector('#tileLayer').style.transform='';document.querySelector('#selectionPulse').innerHTML='';});

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
function xToLon(x,z){ return x/2**z*360-180; }
function yToLat(y,z){ return Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI; }
function renderTiles(){
  const layer=document.querySelector('#tileLayer'); layer.innerHTML='';
  loadedTiles.length=0; const renderId=++tileRenderId;
  const sourceZoom=Math.min(mapZoom,20), overzoomScale=2**(mapZoom-sourceZoom), tileSize=256*overzoomScale;
  const centerX=lonToX(mapCenter.lon,sourceZoom); const centerY=latToY(mapCenter.lat,sourceZoom);
  const stage=document.querySelector('#mapStage'); const width=stage.clientWidth||900; const height=stage.clientHeight||650;
  imageryCanvas.width=width; imageryCanvas.height=height;
  const startX=Math.floor(centerX-width/(tileSize*2))-1; const endX=Math.ceil(centerX+width/(tileSize*2))+1;
  const startY=Math.floor(centerY-height/(tileSize*2))-1; const endY=Math.ceil(centerY+height/(tileSize*2))+1;
  for(let x=startX;x<=endX;x++) for(let y=startY;y<=endY;y++){
    const image=new Image(); image.alt=''; image.draggable=false;
    image.crossOrigin='anonymous';
    const left=width/2+(x-centerX)*tileSize, top=height/2+(y-centerY)*tileSize;
    image.style.left=`${left}px`; image.style.top=`${top}px`; image.style.width=`${tileSize}px`; image.style.height=`${tileSize}px`;
    image.addEventListener('load',()=>{
      if(renderId!==tileRenderId)return;
      loadedTiles.push({image,left,top,size:tileSize});
      const context=imageryCanvas.getContext('2d',{willReadFrequently:true});
      context.clearRect(0,0,width,height);
      loadedTiles.forEach(tile=>context.drawImage(tile.image,tile.left,tile.top,tile.size,tile.size));
    });
    image.src=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${sourceZoom}/${y}/${x}`;
    layer.append(image);
  }
}

function clearRoofSelection(activateMagic=true) {
  points=[]; extraLines=[]; selectedLine=-1; selectedAreaSquareFeet=0;
  selectionMask.getContext('2d').clearRect(0,0,selectionMask.width,selectionMask.height);
  document.querySelector('#selectionPulse').innerHTML='';
  polygonVisible=true; canvas.classList.remove('outline-hidden');
  const toggle=document.querySelector('#togglePolygon'); toggle.textContent='◉'; toggle.setAttribute('aria-pressed','true'); toggle.setAttribute('aria-label','Hide roof polygon');
  if(activateMagic)setTool('magic'); render();
}

function updateZoom(delta) {
  const nextZoom=Math.max(18,Math.min(22,mapZoom+delta));
  if(nextZoom===mapZoom){toast(delta>0?'Maximum imagery detail reached':'Minimum imagery detail reached');return;}
  mapZoom=nextZoom; clearRoofSelection(); renderTiles();
  document.querySelector('#zoomLevel').textContent=mapZoom;
  document.querySelector('#zoomIn').disabled=mapZoom===22;
  document.querySelector('#zoomOut').disabled=mapZoom===18;
  toast(`Zoom ${mapZoom}${mapZoom>20?' enhanced':''} — paint the roof again at this scale`);
}

function propertyName(address) { return address.split(',')[0].trim() || address; }
function showProperty(address) {
  document.querySelector('#locationAddress').textContent=address;
  document.querySelector('#mapLocation strong').textContent=propertyName(address);
  document.querySelector('#locationStatus').classList.add('visible');
  clearRoofSelection();
  document.querySelector('#magicTip').classList.remove('hidden');
  document.querySelector('#magicTip strong').textContent='Paint across a roof with the magic lasso';
  document.querySelector('#magicTip span').textContent='Everything you paint is roof; we’ll expand and snap to its outer edge.';
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
document.querySelector('#togglePolygon').addEventListener('click',event=>{
  if(!points.length){toast('Trace a roof before toggling its polygon');return;}
  polygonVisible=!polygonVisible; canvas.classList.toggle('outline-hidden',!polygonVisible);
  event.currentTarget.textContent=polygonVisible?'◉':'○'; event.currentTarget.setAttribute('aria-pressed',String(polygonVisible));
  event.currentTarget.setAttribute('aria-label',polygonVisible?'Hide roof polygon':'Show roof polygon');
  toast(polygonVisible?'Roof polygon shown':'Roof polygon hidden — selection mask visible');
});
document.querySelector('#zoomIn').addEventListener('click',()=>updateZoom(1));
document.querySelector('#zoomOut').addEventListener('click',()=>updateZoom(-1));
document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>{
  setTool(button.dataset.tool);
  const names={magic:'Magic lasso',vertex:'Add vertex',remove:'Remove vertex',pan:'Pan'};
  toast(`${names[button.dataset.tool]} tool active`);
}));
window.addEventListener('resize',renderTiles);
renderTiles(); render();
