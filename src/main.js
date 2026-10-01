let points = [];
let additionalPlanes = [];
let extraLines = [];
let connectingLines = [];
let connectionStart = null;
let selectedLine = -1;
let dragging = null;
let lastVertexTap = null;
let activeTool = 'magic';
let painting = false;
let paintPoints = [];
let traceStartAnchor = null;
let traceEndAnchor = null;
let panGesture = null;
let temporaryPanTool = null;
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
const planeLayer = document.querySelector('#planeLayer');
const selectionMask = document.querySelector('#selectionMask');
const vertexMagnifier = document.querySelector('#vertexMagnifier');
const imageryCanvas = document.createElement('canvas');
const pointIds = new WeakMap();
let nextPointId = 1;

function pointId(point){if(!pointIds.has(point))pointIds.set(point,nextPointId++);return pointIds.get(point);}
function edgeKey(first,second){const ids=[pointId(first),pointId(second)].sort((a,b)=>a-b);return `${ids[0]}:${ids[1]}`;}
function boundaryEdgeCounts(){const counts=new Map();allPlanePointArrays().forEach(plane=>plane.forEach((point,index)=>{const key=edgeKey(point,plane[(index+1)%plane.length]);counts.set(key,(counts.get(key)||0)+1);}));return counts;}
function boundaryEdgeKeys(){return new Set(boundaryEdgeCounts().keys());}

function svgEl(name, attrs={}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key,value]) => el.setAttribute(key,value));
  return el;
}

function updateProgress() {
  const hasRoof = points.length > 2;
  const secondaryEdges=additionalPlanes.reduce((sum,plane)=>sum+plane.points.length,0),uniqueBoundaryCount=boundaryEdgeKeys().size;
  document.querySelector('#lineCount').textContent = hasRoof ? uniqueBoundaryCount + extraLines.length + connectingLines.length : 0;
  document.querySelector('#vertexCount').textContent = points.length + secondaryEdges;
  document.querySelector('#areaValue').textContent = hasRoof && selectedAreaSquareFeet ? Math.round(selectedAreaSquareFeet).toLocaleString() : '—';
  document.querySelector('#progressValue').textContent = hasRoof ? '42%' : '0%';
  document.querySelector('#progressBar').style.width = hasRoof ? '42%' : '0%';
  document.querySelector('#stepLabel').textContent = hasRoof ? 'STEP 2 OF 3' : 'STEP 1 OF 3';
  document.querySelector('#editorTitle').textContent = hasRoof ? 'Refine roof outline' : 'Select the roof';
  document.querySelector('#editorHelp').textContent = hasRoof
    ? 'With Trace active, start or finish on an existing point or line to merge planes; trace-mode taps never select vertices.'
    : 'Paint with the magic lasso, or trace directly over visible roof lines. Use the vertex tools to refine the result.';
}

function render() {
  const pointString = points.map(point => `${point.x},${point.y}`).join(' ');
  roofFill.setAttribute('points', pointString);
  document.querySelector('.roof-shadow').setAttribute('points', pointString);
  lineLayer.innerHTML = '';
  vertexLayer.innerHTML = '';
  planeLayer.innerHTML = '';
  additionalPlanes.forEach((plane,index)=>{
    const polygon=svgEl('polygon',{points:plane.points.map(point=>`${point.x},${point.y}`).join(' '),class:'detected-plane'});
    polygon.style.opacity=String(.35+plane.confidence*.45);
    polygon.addEventListener('pointerdown',event=>{
      if(activeTool==='trace')return;
      event.stopPropagation();
      additionalPlanes[index]={points:[...points],confidence:1}; points=plane.points; selectedLine=-1; render(); toast('Roof plane selected for editing');
    });
    planeLayer.append(polygon);
    if(activeTool==='line')plane.points.forEach(point=>{
      const vertex=svgEl('circle',{cx:point.x,cy:point.y,r:7,class:'vertex secondary-vertex'});
      vertex.addEventListener('pointerdown',event=>{event.preventDefault();event.stopPropagation();pickConnectionVertex(point);});
      planeLayer.append(vertex);
    });
  });
  const edgeCounts=boundaryEdgeCounts();
  const lines = points.length > 2
    ? points.map((point,index) => ({a:index,b:(index+1)%points.length,type:edgeCounts.get(edgeKey(point,points[(index+1)%points.length]))>1?'Ridge':'Eave'})).concat(extraLines)
    : [];
  lines.concat(connectingLines.map(line=>({pointA:line.a,pointB:line.b,type:line.type,connection:true}))).forEach((line,index) => {
    const start=line.connection?line.pointA:points[line.a],end=line.connection?line.pointB:points[line.b];
    const el = svgEl('line', {x1:start.x,y1:start.y,x2:end.x,y2:end.y,class:`roof-line ${index===selectedLine?'selected':''} ${index>=points.length?'internal':''}`});
    if (index === selectedLine) el.style.stroke = colors[line.type];
    el.addEventListener('pointerdown', event => {
      if(activeTool==='trace')return;
      if(line.connection){event.stopPropagation();selectedLine=index;render();selectType(line.type);return;}
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
      if(activeTool==='trace'){
        traceStartAnchor=point;traceEndAnchor=null;painting=true;paintPoints=[{x:point.x,y:point.y}];canvas.setPointerCapture(event.pointerId);
        document.querySelector('#selectionPulse').innerHTML=`<polyline class="paint-stroke trace-stroke" points="${point.x},${point.y}"/>`;
        document.querySelector('#magicTip strong').textContent='Trace from the connected vertex';document.querySelector('#magicTip span').textContent='Finish at another existing point or line to merge the planes.';return;
      }
      if(activeTool==='line'){pickConnectionVertex(point);return;}
      if(activeTool==='remove') {
        if(points.length<=3){toast('A roof needs at least three vertices');return;}
        points.splice(index,1);
        connectingLines=connectingLines.filter(line=>line.a!==point&&line.b!==point);
        extraLines=extraLines.filter(line=>line.a!==index&&line.b!==index).map(line=>({ ...line,a:line.a>index?line.a-1:line.a,b:line.b>index?line.b-1:line.b }));
        selectedLine=-1; render(); toast('Vertex removed'); return;
      }
      if(activeTool!=='move') {
        const now=performance.now(), isDoubleTap=lastVertexTap?.index===index&&now-lastVertexTap.time<500;
        lastVertexTap=isDoubleTap?null:{index,time:now};
        if(!isDoubleTap){toast('Double-tap the point or choose the move vertex tool');return;}
        setTool('move'); toast('Move vertex tool enabled');
      }
      dragging=index; canvas.setPointerCapture(event.pointerId); canvas.classList.add('moving-vertex'); showVertexMagnifier(event); render();
    });
    vertexLayer.append(el);
  });
  updateProgress();
}

function pickConnectionVertex(point) {
  if(!connectionStart){connectionStart=point;toast('Now choose a vertex on another roof plane');return;}
  if(connectionStart===point){toast('Choose a different vertex');return;}
  if(boundaryEdgeKeys().has(edgeKey(connectionStart,point))){connectionStart=null;toast('Those vertices already share one roof edge');return;}
  if(connectingLines.some(line=>(line.a===connectionStart&&line.b===point)||(line.a===point&&line.b===connectionStart))){connectionStart=null;toast('Those vertices are already connected');return;}
  connectingLines.push({a:connectionStart,b:point,type:'Ridge'});connectionStart=null;selectedLine=points.length+extraLines.length+connectingLines.length-1;render();toast('Roof planes connected');
}

function allPlanePointArrays(){return [points,...additionalPlanes.map(plane=>plane.points)];}

function nearestExistingVertex(event, excluded=null, maximumDistance=22) {
  const eventStage={x:event.clientX-document.querySelector('#mapStage').getBoundingClientRect().left,y:event.clientY-document.querySelector('#mapStage').getBoundingClientRect().top};
  let nearest=null,distance=maximumDistance;
  for(const plane of allPlanePointArrays())for(const point of plane)if(point!==excluded){const stage=svgToStage(point),candidate=Math.hypot(stage.x-eventStage.x,stage.y-eventStage.y);if(candidate<distance){nearest=point;distance=candidate;}}
  return nearest;
}

function mergeTracedPolygon(candidatePoints) {
  const snapDistance=16,edgeDistance=18;
  return candidatePoints.map(candidate=>{
    const candidateStage=svgToStage(candidate);
    for(const plane of allPlanePointArrays())for(const existing of plane)if(Math.hypot(svgToStage(existing).x-candidateStage.x,svgToStage(existing).y-candidateStage.y)<=snapDistance)return existing;
    let best=null;
    for(const plane of allPlanePointArrays())for(let index=0;index<plane.length;index++){
      const start=svgToStage(plane[index]),end=svgToStage(plane[(index+1)%plane.length]),dx=end.x-start.x,dy=end.y-start.y,lengthSquared=dx*dx+dy*dy;
      const t=lengthSquared?Math.max(0,Math.min(1,((candidateStage.x-start.x)*dx+(candidateStage.y-start.y)*dy)/lengthSquared)):0;
      const projected={x:start.x+t*dx,y:start.y+t*dy},distance=Math.hypot(candidateStage.x-projected.x,candidateStage.y-projected.y);
      if(t>.08&&t<.92&&distance<=edgeDistance&&(!best||distance<best.distance))best={plane,index,projected,distance};
    }
    if(best){const shared=stageToSvg(best.projected);best.plane.splice(best.index+1,0,shared);return shared;}
    return candidate;
  }).filter((point,index,array)=>!index||point!==array[index-1]).filter((point,index,array)=>index||point!==array.at(-1));
}

function mergeMovedVertex(index) {
  const moving=points[index],movingStage=svgToStage(moving);
  let target=null;
  for(const plane of allPlanePointArrays())for(const candidate of plane)if(candidate!==moving&&Math.hypot(svgToStage(candidate).x-movingStage.x,svgToStage(candidate).y-movingStage.y)<=12){target=candidate;break;}
  if(!target)return false;
  allPlanePointArrays().forEach(plane=>{for(let pointIndex=plane.length-1;pointIndex>=0;pointIndex--){if(plane[pointIndex]===moving)plane[pointIndex]=target;if(plane.length>3&&plane[pointIndex]===plane[(pointIndex-1+plane.length)%plane.length])plane.splice(pointIndex,1);}});
  connectingLines.forEach(line=>{if(line.a===moving)line.a=target;if(line.b===moving)line.b=target;});
  const seen=new Set();connectingLines=connectingLines.filter(line=>{if(line.a===line.b)return false;const key=edgeKey(line.a,line.b);if(seen.has(key)||boundaryEdgeKeys().has(key))return false;seen.add(key);return true;});return true;
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
  canvas.classList.toggle('move-vertex-tool', tool === 'move');
  canvas.classList.toggle('pan-tool', tool === 'pan');
}

function showVertexMagnifier(event) {
  const stage=document.querySelector('#mapStage'), bounds=stage.getBoundingClientRect();
  const x=event.clientX-bounds.left, y=event.clientY-bounds.top, size=112, sampleSize=46;
  const context=vertexMagnifier.getContext('2d');
  context.clearRect(0,0,size,size);
  context.drawImage(imageryCanvas,x-sampleSize/2,y-sampleSize/2,sampleSize,sampleSize,0,0,size,size);
  context.strokeStyle='#efff9b'; context.lineWidth=2;
  context.beginPath(); context.moveTo(size/2-11,size/2); context.lineTo(size/2+11,size/2); context.moveTo(size/2,size/2-11); context.lineTo(size/2,size/2+11); context.stroke();
  const left=Math.max(8,Math.min(stage.clientWidth-size-8,x+28));
  const top=Math.max(8,Math.min(stage.clientHeight-size-8,y-size-34));
  vertexMagnifier.style.left=`${left}px`; vertexMagnifier.style.top=`${top}px`; vertexMagnifier.classList.add('visible');
}

function hideVertexMagnifier(){vertexMagnifier.classList.remove('visible');canvas.classList.remove('moving-vertex');}

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

function chooseRepresentativeColors(colors, maximum=10) {
  if(colors.length<=maximum)return colors;
  const selected=[colors[0]];
  while(selected.length<maximum) {
    const next=colors.reduce((best,color)=>{
      const distance=Math.min(...selected.map(sample=>colorDistance(color,sample)));
      return distance>best.distance?{color,distance}:best;
    },{color:colors[0],distance:-1});
    if(next.distance<7)break;
    selected.push(next.color);
  }
  return selected;
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

function extractMaskContours(mask, cols, rows, step) {
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
  return loops.filter(loop=>area(loop)>step*step*6).sort((a,b)=>area(b)-area(a));
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

function buildPaintIntentMask(seeds, cols, rows) {
  const intent=new Uint8Array(cols*rows);
  const paint=(x,y)=>{
    for(let offsetY=-2;offsetY<=2;offsetY++)for(let offsetX=-2;offsetX<=2;offsetX++)if(offsetX*offsetX+offsetY*offsetY<=4) {
      const nextX=x+offsetX,nextY=y+offsetY;if(nextX>=0&&nextY>=0&&nextX<cols&&nextY<rows)intent[nextY*cols+nextX]=1;
    }
  };
  const connect=(from,to)=>{
    const steps=Math.max(Math.abs(to.x-from.x),Math.abs(to.y-from.y),1);
    for(let step=0;step<=steps;step++)paint(Math.round(from.x+(to.x-from.x)*step/steps),Math.round(from.y+(to.y-from.y)*step/steps));
  };
  seeds.forEach((seed,index)=>{paint(seed.x,seed.y);if(index)connect(seeds[index-1],seed);});
  const spanX=Math.max(...seeds.map(seed=>seed.x))-Math.min(...seeds.map(seed=>seed.x));
  const spanY=Math.max(...seeds.map(seed=>seed.y))-Math.min(...seeds.map(seed=>seed.y));
  if(seeds.length>2&&Math.hypot(seeds[0].x-seeds.at(-1).x,seeds[0].y-seeds.at(-1).y)<=Math.max(7,Math.max(spanX,spanY)*.22))connect(seeds.at(-1),seeds[0]);
  fillEnclosedMaskAreas(intent,cols,rows);
  const expansion=Math.max(5,Math.min(14,Math.round(Math.max(1,Math.min(spanX||spanY,spanY||spanX))*.2)));
  const distance=new Int16Array(intent.length);distance.fill(-1);
  const queue=new Int32Array(intent.length);let head=0,tail=0;
  intent.forEach((value,index)=>{if(value){distance[index]=0;queue[tail++]=index;}});
  while(head<tail){const index=queue[head++],x=index%cols,y=Math.floor(index/cols);if(distance[index]>=expansion)continue;for(const next of [index-1,index+1,index-cols,index+cols])if(next>=0&&next<intent.length&&distance[next]===-1&&Math.abs(next%cols-x)+Math.abs(Math.floor(next/cols)-y)===1){distance[next]=distance[index]+1;queue[tail++]=next;}}
  return Uint8Array.from(distance,value=>value>=0?1:0);
}

function tracePaintedRegion(stagePoints, tolerance=34) {
  const width=imageryCanvas.width, height=imageryCanvas.height;
  if (!width || !height || !stagePoints.length) return null;
  const source=imageryCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height).data;
  const step=3, cols=Math.ceil(width/step), rows=Math.ceil(height/step);
  const seeds=stagePoints.map(point=>({x:Math.max(0,Math.min(cols-1,Math.floor(point.x/step))),y:Math.max(0,Math.min(rows-1,Math.floor(point.y/step)))}));
  const allowedMask=buildPaintIntentMask(seeds,cols,rows);
  const pixelAt=(x,y) => { const index=(Math.min(height-1,y*step)*width+Math.min(width-1,x*step))*4; return [source[index],source[index+1],source[index+2],source[index+3]]; };
  const edgeStrengthAt=(x,y)=>Math.max(
    colorDistance(pixelAt(Math.max(0,x-1),y),pixelAt(Math.min(cols-1,x+1),y)),
    colorDistance(pixelAt(x,Math.max(0,y-1)),pixelAt(x,Math.min(rows-1,y+1)))
  );
  if(seeds.some(seed=>pixelAt(seed.x,seed.y)[3]<200))return null;
  const paintedColors=seeds.map(seed=>samplePaintColor(pixelAt,seed,cols,rows));
  const palette=chooseRepresentativeColors(paintedColors);
  if(!palette.length)return null;
  const matchesPalette=color=>Math.min(...palette.map(sample=>colorDistance(color,sample)))<=tolerance;
  const visited=new Uint8Array(cols*rows), mask=new Uint8Array(cols*rows);
  const queueX=new Int32Array(cols*rows), queueY=new Int32Array(cols*rows); let head=0,tail=0;
  seeds.forEach(seed=>{const index=seed.y*cols+seed.x;if(!visited[index]){visited[index]=1;queueX[tail]=seed.x;queueY[tail++]=seed.y;}});
  let count=0, minX=Math.min(...seeds.map(seed=>seed.x)), maxX=Math.max(...seeds.map(seed=>seed.x)), minY=Math.min(...seeds.map(seed=>seed.y)), maxY=Math.max(...seeds.map(seed=>seed.y));
  const maximumPixels=allowedMask.reduce((sum,value)=>sum+value,0);
  while(head<tail) {
    const x=queueX[head], y=queueY[head++], current=pixelAt(x,y), index=y*cols+x;
    mask[index]=1; count++;
    minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y);
    if(count>maximumPixels)break;
    const neighbors=[[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
    for(const [nextX,nextY] of neighbors) {
      if(nextX<0||nextY<0||nextX>=cols||nextY>=rows)continue;
      const nextIndex=nextY*cols+nextX;
      const nextColor=pixelAt(nextX,nextY);
      const crossesEdge=edgeStrengthAt(nextX,nextY)>19 && colorDistance(current,nextColor)>6;
      if(!visited[nextIndex] && allowedMask[nextIndex] && matchesPalette(nextColor) && !crossesEdge){visited[nextIndex]=1;queueX[tail]=nextX;queueY[tail++]=nextY;}
    }
  }
  count+=fillEnclosedMaskAreas(mask,cols,rows);
  count=Math.min(count,maximumPixels);
  const boundaries=extractMaskContours(mask,cols,rows,step);
  if(!boundaries.length)return null;
  const seedPixels=seeds.map(seed=>({x:seed.x*step,y:seed.y*step}));
  const diagonal=Math.hypot(cols*step,rows*step);
  const planes=boundaries.map(boundary=>{
    const relevantSeeds=seedPixels.filter(seed=>{
      let inside=false; for(let i=0,j=boundary.length-1;i<boundary.length;j=i++)if(((boundary[i].y>seed.y)!==(boundary[j].y>seed.y))&&(seed.x<(boundary[j].x-boundary[i].x)*(seed.y-boundary[i].y)/(boundary[j].y-boundary[i].y)+boundary[i].x))inside=!inside; return inside;
    });
    const samples=relevantSeeds.length?relevantSeeds:seedPixels;
    const averageDistance=samples.reduce((sum,seed)=>sum+Math.min(...boundary.map(edge=>Math.hypot(edge.x-seed.x,edge.y-seed.y))),0)/samples.length;
    return {boundary,confidence:Math.max(.2,Math.min(1,1-averageDistance/(diagonal*.18)))};
  });
  return {mask,cols,rows,step,count,planes,palette};
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
      for(const tolerance of [6,10,14,18]) {
        const candidate=tracePaintedRegion(stagePoints,tolerance);
        if(!candidate)continue;
        selection=candidate;
      }
    }
    catch { selection=null; }
    if(!selection) {
      pulse.innerHTML='';
      const stagePoints=stroke.map(svgToStage), padding=12;
      const left=Math.min(...stagePoints.map(point=>point.x))-padding, right=Math.max(...stagePoints.map(point=>point.x))+padding;
      const top=Math.min(...stagePoints.map(point=>point.y))-padding, bottom=Math.max(...stagePoints.map(point=>point.y))+padding;
      points=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}].map(stageToSvg);
      additionalPlanes=[]; selectedLine=0; render();
      document.querySelector('#magicTip strong').textContent='Low-confidence roof outline';
      document.querySelector('#magicTip span').textContent='We kept your painted area and made it editable—adjust the border as needed.';
      toast('Created an editable outline from the painted roof'); return;
    }
    const detected=selection.planes.map(plane=>({points:simplifyHull(plane.boundary,12).map(stageToSvg),confidence:plane.confidence}));
    points=detected[0].points;
    additionalPlanes=detected.slice(1);
    extraLines = [];
    const metersPerPixel=Math.cos(mapCenter.lat*Math.PI/180)*156543.03392/2**mapZoom;
    selectedAreaSquareFeet=selection.count*selection.step**2*metersPerPixel**2*10.7639;
    drawSelectionMask(selection);
    selectedLine = 0;
    pulse.innerHTML = '';
    document.querySelector('#magicTip strong').textContent = 'Roof surface selected';
    document.querySelector('#magicTip span').textContent = `${detected.length} roof plane${detected.length===1?'':'s'} found from your painted samples.`;
    render(); toast('Magic lasso traced the connected roof color');
  }, 700);
}

function simplifyOpenPath(path, epsilon) {
  if(path.length<3)return path;
  const first=path[0],last=path.at(-1),dx=last.x-first.x,dy=last.y-first.y,lengthSquared=dx*dx+dy*dy;
  let furthest=0,index=0;
  for(let i=1;i<path.length-1;i++){
    const t=lengthSquared?Math.max(0,Math.min(1,((path[i].x-first.x)*dx+(path[i].y-first.y)*dy)/lengthSquared)):0;
    const distance=Math.hypot(path[i].x-(first.x+t*dx),path[i].y-(first.y+t*dy));
    if(distance>furthest){furthest=distance;index=i;}
  }
  if(furthest<=epsilon)return [first,last];
  return simplifyOpenPath(path.slice(0,index+1),epsilon).slice(0,-1).concat(simplifyOpenPath(path.slice(index),epsilon));
}

function simplifyClosedPath(path, epsilon) {
  if(path.length<4)return path;
  let first=0,second=1,maxDistance=0;
  for(let i=0;i<path.length;i++)for(let j=i+1;j<path.length;j++){const distance=Math.hypot(path[i].x-path[j].x,path[i].y-path[j].y);if(distance>maxDistance){maxDistance=distance;first=i;second=j;}}
  const arc=(start,end)=>{const result=[];for(let index=start;;index=(index+1)%path.length){result.push(path[index]);if(index===end)break;}return result;};
  return simplifyOpenPath(arc(first,second),epsilon).slice(0,-1).concat(simplifyOpenPath(arc(second,first),epsilon).slice(0,-1));
}

function removeWeakStructuralCorners(path) {
  const result=[...path];let changed=true;
  while(changed&&result.length>3){changed=false;for(let index=0;index<result.length;index++){
    const previous=result[(index-1+result.length)%result.length],point=result[index],next=result[(index+1)%result.length];
    const first={x:point.x-previous.x,y:point.y-previous.y},second={x:next.x-point.x,y:next.y-point.y};
    const lengths=Math.hypot(first.x,first.y)*Math.hypot(second.x,second.y);if(!lengths)continue;
    const bend=Math.abs(first.x*second.y-first.y*second.x)/lengths,direction=(first.x*second.x+first.y*second.y)/lengths;
    if(bend<.32&&direction>.65){result.splice(index,1);changed=true;break;}
  }}
  return result;
}

function fitStructuralLine(samples) {
  const center=samples.reduce((sum,point)=>({x:sum.x+point.x/samples.length,y:sum.y+point.y/samples.length}),{x:0,y:0});
  let xx=0,xy=0,yy=0;samples.forEach(point=>{const x=point.x-center.x,y=point.y-center.y;xx+=x*x;xy+=x*y;yy+=y*y;});
  const angle=.5*Math.atan2(2*xy,xx-yy);
  return {point:center,direction:{x:Math.cos(angle),y:Math.sin(angle)}};
}

function intersectStructuralLines(first, second, fallback) {
  const cross=first.direction.x*second.direction.y-first.direction.y*second.direction.x;
  if(Math.abs(cross)<.08)return fallback;
  const dx=second.point.x-first.point.x,dy=second.point.y-first.point.y;
  const distance=(dx*second.direction.y-dy*second.direction.x)/cross;
  const point={x:first.point.x+distance*first.direction.x,y:first.point.y+distance*first.direction.y};
  return Math.hypot(point.x-fallback.x,point.y-fallback.y)>32?fallback:point;
}

function pointInsidePolygon(point, polygon) {
  let inside=false;
  for(let index=0,previous=polygon.length-1;index<polygon.length;previous=index++) {
    const current=polygon[index],before=polygon[previous];
    if(((current.y>point.y)!==(before.y>point.y))&&(point.x<(before.x-current.x)*(point.y-current.y)/(before.y-current.y)+current.x))inside=!inside;
  }
  return inside;
}

function sampleInteriorPalette(polygon, pixel, width, height) {
  const left=Math.max(0,Math.floor(Math.min(...polygon.map(point=>point.x)))),right=Math.min(width-1,Math.ceil(Math.max(...polygon.map(point=>point.x))));
  const top=Math.max(0,Math.floor(Math.min(...polygon.map(point=>point.y)))),bottom=Math.min(height-1,Math.ceil(Math.max(...polygon.map(point=>point.y))));
  const buckets=new Map();
  for(let y=top;y<=bottom;y+=4)for(let x=left;x<=right;x+=4)if(pointInsidePolygon({x,y},polygon)){
    const color=pixel(x,y),key=color.map(channel=>Math.round(channel/16)).join(',');
    const bucket=buckets.get(key)||{count:0,total:[0,0,0]};bucket.count++;color.forEach((channel,index)=>bucket.total[index]+=channel);buckets.set(key,bucket);
  }
  return [...buckets.values()].sort((a,b)=>b.count-a.count).slice(0,6).map(bucket=>bucket.total.map(total=>total/bucket.count));
}

function traceRoofLines(stroke) {
  const pulse=document.querySelector('#selectionPulse');
  pulse.innerHTML=`<polyline class="paint-stroke processing" points="${stroke.map(point=>`${point.x},${point.y}`).join(' ')}"/>`;
  document.querySelector('#magicTip strong').textContent='Snapping trace to roof edges…';
  document.querySelector('#magicTip span').textContent='Sampling the enclosed roof colors, then fitting nearby imagery edges.';
  window.setTimeout(()=>{
    const width=imageryCanvas.width,height=imageryCanvas.height,context=imageryCanvas.getContext('2d',{willReadFrequently:true});
    let source; try{source=context.getImageData(0,0,width,height).data;}catch{source=null;}
    const pixel=(x,y)=>{const index=(Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x)))*4;return [source[index],source[index+1],source[index+2]];};
    const edgeAt=(x,y)=>Math.max(colorDistance(pixel(x-2,y),pixel(x+2,y)),colorDistance(pixel(x,y-2),pixel(x,y+2)));
    const stageStroke=stroke.map(svgToStage);
    const guide=removeWeakStructuralCorners(simplifyClosedPath(stageStroke,Math.max(12,Math.min(width,height)*.018)));
    const interiorPalette=source?sampleInteriorPalette(guide,pixel,width,height):[];
    const paletteDistance=color=>interiorPalette.length?Math.min(...interiorPalette.map(sample=>colorDistance(color,sample))):0;
    const winding=guide.reduce((sum,point,index)=>{const next=guide[(index+1)%guide.length];return sum+point.x*next.y-next.x*point.y;},0);
    const fittedLines=guide.map((start,index)=>{
      const end=guide[(index+1)%guide.length],dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy),normal={x:-dy/length,y:dx/length};
      const interiorNormal=winding>0?{x:-dy/length,y:dx/length}:{x:dy/length,y:-dx/length},samples=[];
      const sampleCount=Math.max(4,Math.ceil(length/5));
      const searchRadius=Math.max(18,Math.min(36,Math.round(Math.min(width,height)*.045)));
      for(let sample=0;sample<=sampleCount;sample++){
        const base={x:start.x+dx*sample/sampleCount,y:start.y+dy*sample/sampleCount};
        if(!source){samples.push(base);continue;}
        let best={...base,score:-Infinity};
        for(let offset=-searchRadius;offset<=searchRadius;offset+=2){
          const x=Math.round(base.x+normal.x*offset),y=Math.round(base.y+normal.y*offset);if(x<6||y<6||x>=width-6||y>=height-6)continue;
          const insideColor=pixel(Math.round(x+interiorNormal.x*5),Math.round(y+interiorNormal.y*5));
          const outsideColor=pixel(Math.round(x-interiorNormal.x*5),Math.round(y-interiorNormal.y*5));
          const insideMatch=Math.max(0,28-paletteDistance(insideColor)),outsideSeparation=Math.min(28,paletteDistance(outsideColor));
          const score=edgeAt(x,y)+insideMatch*.8+outsideSeparation*.45-Math.abs(offset)*.45;if(score>best.score)best={x,y,score,offset};
        }
        samples.push({x:best.x,y:best.y,offset:best.offset||0});
      }
      const offsets=samples.map(sample=>sample.offset).sort((a,b)=>a-b),medianOffset=offsets[Math.floor(offsets.length/2)];
      const consistent=samples.filter(sample=>Math.abs(sample.offset-medianOffset)<=7);
      return fitStructuralLine(consistent.length>=3?consistent:samples);
    });
    const outline=guide.map((corner,index)=>intersectStructuralLines(fittedLines[(index-1+fittedLines.length)%fittedLines.length],fittedLines[index],corner));
    if(outline.length<3){pulse.innerHTML='';toast('Trace at least three roof edges');return;}
    for(const anchor of [traceStartAnchor,traceEndAnchor].filter(Boolean)){
      const anchorStage=svgToStage(anchor);let nearestIndex=0;
      outline.forEach((point,index)=>{if(Math.hypot(point.x-anchorStage.x,point.y-anchorStage.y)<Math.hypot(outline[nearestIndex].x-anchorStage.x,outline[nearestIndex].y-anchorStage.y))nearestIndex=index;});
      outline[nearestIndex]=anchorStage;
    }
    const mergedOutline=mergeTracedPolygon(outline.map(stageToSvg));
    if(points.length)additionalPlanes.push({points:[...points],confidence:1});
    points=mergedOutline;extraLines=[];selectedLine=0;
    const areaPixels=Math.abs(outline.reduce((sum,point,index)=>{const next=outline[(index+1)%outline.length];return sum+point.x*next.y-next.x*point.y;},0))/2;
    const metersPerPixel=Math.cos(mapCenter.lat*Math.PI/180)*156543.03392/2**mapZoom;
    selectedAreaSquareFeet=areaPixels*metersPerPixel**2*10.7639;
    pulse.innerHTML='';render();
    document.querySelector('#magicTip strong').textContent='Roof trace snapped';
    document.querySelector('#magicTip span').textContent=`${points.length} edge vertices found near your traced line.`;
    traceStartAnchor=null;traceEndAnchor=null;toast('Trace snapped to nearby roof edges');
  },350);
}

function appendPaintPoint(event) {
  const point=toSvg(event), previous=paintPoints.at(-1);
  if(previous && Math.hypot(point.x-previous.x,point.y-previous.y)<9)return;
  paintPoints.push({x:point.x,y:point.y});
  document.querySelector('#selectionPulse').innerHTML=`<polyline class="paint-stroke ${activeTool==='trace'?'trace-stroke':''}" points="${paintPoints.map(item=>`${item.x},${item.y}`).join(' ')}"/>`;
}
canvas.addEventListener('pointerdown', event => {
  if(event.pointerType==='mouse'&&event.button===1) {
    temporaryPanTool=activeTool;
    setTool('pan');
  }
  if(activeTool==='pan') {
    event.preventDefault();
    panGesture={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,centerX:lonToX(mapCenter.lon,mapZoom),centerY:latToY(mapCenter.lat,mapZoom)};
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('panning');
    return;
  }
  if(!['magic','trace'].includes(activeTool) || (activeTool==='magic'&&points.length))return;
  event.preventDefault(); painting=true; paintPoints=[];if(activeTool==='trace'){traceStartAnchor=null;traceEndAnchor=null;}canvas.setPointerCapture(event.pointerId); appendPaintPoint(event);
  document.querySelector('#magicTip strong').textContent=activeTool==='trace'?'Trace along the roof border':'Paint across the roof plane';
  document.querySelector('#magicTip span').textContent=activeTool==='trace'?'Follow the visible roof lines and release to snap.':'Release when the roof surface is covered.';
});
canvas.addEventListener('pointermove', event=>{
  if(dragging!==null && activeTool==='move') {
    const next=toSvg(event); points[dragging].x=next.x;points[dragging].y=next.y; render(); showVertexMagnifier(event); return;
  }
  if(panGesture && event.pointerId===panGesture.pointerId) {
    const offsetX=event.clientX-panGesture.startX, offsetY=event.clientY-panGesture.startY;
    document.querySelector('#tileLayer').style.transform=`translate(${offsetX}px,${offsetY}px)`;
    selectionMask.style.transform=`translate(${offsetX}px,${offsetY}px)`;
    return;
  }
  if(painting)appendPaintPoint(event);
});
canvas.addEventListener('pointerup', event=>{
  if(dragging!==null) {
    const merged=mergeMovedVertex(dragging);dragging=null; hideVertexMagnifier();
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    render(); toast(merged?'Vertices merged':'Vertex updated'); return;
  }
  if(panGesture && event.pointerId===panGesture.pointerId) {
    const offsetX=event.clientX-panGesture.startX, offsetY=event.clientY-panGesture.startY;
    mapCenter={lon:xToLon(panGesture.centerX-offsetX/256,mapZoom),lat:yToLat(panGesture.centerY-offsetY/256,mapZoom)};
    const translatedPoints=new Set();
    allPlanePointArrays().forEach(plane=>plane.forEach(point=>{
      if(translatedPoints.has(point))return;
      const stagePoint=svgToStage(point),translated=stageToSvg({x:stagePoint.x+offsetX,y:stagePoint.y+offsetY});
      point.x=translated.x;point.y=translated.y;translatedPoints.add(point);
    }));
    if(selectionMask.width&&selectionMask.height){const copy=document.createElement('canvas');copy.width=selectionMask.width;copy.height=selectionMask.height;copy.getContext('2d').drawImage(selectionMask,0,0);const context=selectionMask.getContext('2d');context.clearRect(0,0,selectionMask.width,selectionMask.height);context.drawImage(copy,offsetX,offsetY);}
    panGesture=null; canvas.classList.remove('panning'); document.querySelector('#tileLayer').style.transform=''; selectionMask.style.transform='';
    if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    renderTiles(); render();
    if(temporaryPanTool!==null){const previousTool=temporaryPanTool;temporaryPanTool=null;setTool(previousTool);toast(`${previousTool==='magic'?'Magic lasso':previousTool==='trace'?'Trace roof lines':previousTool==='line'?'Connect roof planes':previousTool==='vertex'?'Add vertex':previousTool==='remove'?'Remove vertex':previousTool==='move'?'Move vertex':'Pan'} tool restored`);}
    else toast('Map repositioned');
    return;
  }
  if(!painting)return; appendPaintPoint(event); painting=false;
  if(activeTool==='trace')traceEndAnchor=nearestExistingVertex(event,traceStartAnchor);
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  const stroke=[...paintPoints]; activeTool==='trace'?traceRoofLines(stroke):magicSelect(stroke);
});
canvas.addEventListener('pointercancel',()=>{painting=false;paintPoints=[];panGesture=null;dragging=null;hideVertexMagnifier();canvas.classList.remove('panning');document.querySelector('#tileLayer').style.transform='';selectionMask.style.transform='';if(temporaryPanTool!==null){setTool(temporaryPanTool);temporaryPanTool=null;}document.querySelector('#selectionPulse').innerHTML='';});
canvas.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});

document.querySelectorAll('.line-type').forEach(button => button.addEventListener('click', () => {
  if (selectedLine < 0 || !points.length) { toast('Select the roof first'); return; }
  const type=button.dataset.type;
  if(selectedLine>=points.length+extraLines.length)connectingLines[selectedLine-points.length-extraLines.length].type=type;
  else if(selectedLine>=points.length)extraLines[selectedLine-points.length].type=type;
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
  points=[]; additionalPlanes=[]; extraLines=[]; connectingLines=[]; connectionStart=null; selectedLine=-1; selectedAreaSquareFeet=0;
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
  document.querySelector('#magicTip span').textContent='Paint the roof’s shape; we’ll preserve it and snap nearby points to visible edges.';
  document.querySelector('#sidePanel').classList.add('panel-collapsed');
  document.querySelector('#panelToggle').setAttribute('aria-expanded','false');
  document.querySelector('#editorPanel').classList.remove('sheet-expanded');
  document.querySelector('#sheetToggle').setAttribute('aria-expanded','false');
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
document.querySelector('#undoBtn').addEventListener('click',()=>{if(!points.length){toast('Nothing to undo');return;}points=[];additionalPlanes=[];extraLines=[];connectingLines=[];connectionStart=null;selectedLine=-1;selectedAreaSquareFeet=0;selectionMask.getContext('2d').clearRect(0,0,selectionMask.width,selectionMask.height);render();toast('Roof selection removed');});
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
document.querySelector('#panelToggle').addEventListener('click',event=>{
  const panel=document.querySelector('#sidePanel'), collapsed=panel.classList.toggle('panel-collapsed');
  event.currentTarget.setAttribute('aria-expanded',String(!collapsed));
});
document.querySelector('#sheetToggle').addEventListener('click',event=>{
  const panel=document.querySelector('#editorPanel'), expanded=panel.classList.toggle('sheet-expanded');
  event.currentTarget.setAttribute('aria-expanded',String(expanded));
});
document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>{
  setTool(button.dataset.tool);
  const names={magic:'Magic lasso',trace:'Trace roof lines',line:'Connect roof planes',vertex:'Add vertex',remove:'Remove vertex',move:'Move vertex',pan:'Pan'};
  toast(`${names[button.dataset.tool]} tool active`);
  if(button.dataset.tool==='line')render();
}));
window.addEventListener('resize',renderTiles);
renderTiles(); render();
