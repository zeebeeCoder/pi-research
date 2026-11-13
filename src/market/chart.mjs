// Small dependency-free raster chart: PNG RGB, filter 0, bitmap labels.
// No network, browser, external renderer, or second indicator computation.
import { deflateSync } from 'node:zlib';
const glyphs = {
 '0':['01110','10001','10011','10101','11001','10001','01110'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],
 '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '5':['11111','10000','10000','11110','00001','00001','11110'],
 '6':['01110','10000','10000','11110','10001','10001','01110'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','01110'],
 A:['01110','10001','10001','11111','10001','10001','10001'],
 B:['11110','10001','10001','11110','10001','10001','11110'],
 C:['01111','10000','10000','10000','10000','10000','01111'],
 D:['11110','10001','10001','10001','10001','10001','11110'],
 E:['11111','10000','10000','11110','10000','10000','11111'],
 F:['11111','10000','10000','11110','10000','10000','10000'],
 G:['01111','10000','10000','10111','10001','10001','01111'],
 H:['10001','10001','10001','11111','10001','10001','10001'],
 I:['11111','00100','00100','00100','00100','00100','11111'],
 J:['00111','00010','00010','00010','10010','10010','01100'],
 K:['10001','10010','10100','11000','10100','10010','10001'],
 L:['10000','10000','10000','10000','10000','10000','11111'],
 M:['10001','11011','10101','10101','10001','10001','10001'],
 N:['10001','11001','10101','10011','10001','10001','10001'],
 O:['01110','10001','10001','10001','10001','10001','01110'],
 P:['11110','10001','10001','11110','10000','10000','10000'],
 Q:['01110','10001','10001','10001','10101','10010','01101'],
 R:['11110','10001','10001','11110','10100','10010','10001'],
 S:['01111','10000','10000','01110','00001','00001','11110'],
 T:['11111','00100','00100','00100','00100','00100','00100'],
 U:['10001','10001','10001','10001','10001','10001','01110'],
 V:['10001','10001','10001','10001','10001','01010','00100'],
 W:['10001','10001','10001','10101','10101','10101','01010'],
 X:['10001','10001','01010','00100','01010','10001','10001'],
 Y:['10001','10001','01010','00100','00100','00100','00100'],
 Z:['11111','00001','00010','00100','01000','10000','11111'],
 '.':['0','0','0','0','0','1','1'], '-':['000','000','000','111','000','000','000'],
 '/':['00001','00010','00010','00100','01000','01000','10000'],
 ':':['0','1','1','0','1','1','0'], '+':['000','010','010','111','010','010','000'],
 '=':['000','000','111','000','111','000','000'], '?':['111','001','001','010','010','000','010'],
};
const palette={bg:[15,23,38],grid:[49,62,79],text:[224,231,239],up:[48,210,163],down:[255,99,115],sma50:[80,165,255],sma200:[255,185,65],bb:[160,145,210]};
function crc32(bytes) {
 let c=0xffffffff;
 for(const b of bytes) { c^=b; for(let k=0;k<8;k++) c=(c>>>1)^((c&1)?0xedb88320:0); }
 return (c^0xffffffff)>>>0;
}
function chunk(name, data) {
 const type=Buffer.from(name), size=Buffer.alloc(4), crc=Buffer.alloc(4);
 size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type,data])));
 return Buffer.concat([size,type,data,crc]);
}
export function renderChart(instrument,bars,series) {
 const width=1200,height=920, pixels=Buffer.alloc(width*height*3);
 for(let i=0;i<pixels.length;i+=3) { pixels[i]=15;pixels[i+1]=23;pixels[i+2]=38; }
 const pixel=(x,y,color)=>{x=Math.round(x);y=Math.round(y);if(x<0||x>=width||y<0||y>=height)return; const at=(y*width+x)*3;for(let k=0;k<3;k++)pixels[at+k]=color[k];};
 function line(x1,y1,x2,y2,color) {
   const steps=Math.max(1,Math.ceil(Math.max(Math.abs(x2-x1),Math.abs(y2-y1))));
   for(let t=0;t<=steps;t++)pixel(x1+(x2-x1)*t/steps,y1+(y2-y1)*t/steps,color);
 }
 function rect(x,y,w,h,color) {for(let j=Math.round(y);j<=Math.round(y+h);j++)for(let i=Math.round(x);i<=Math.round(x+w);i++)pixel(i,j,color);}
 function text(x,y,message,color=palette.text,scale=2) {
  for(const ch of message.toUpperCase()) {
   const rows=ch===' '?[]:(glyphs[ch]||glyphs['?']);
   rows.forEach((row,j)=>[...row].forEach((bit,i)=>{if(bit==='1')rect(x+i*scale,y+j*scale,scale-1,scale-1,color);})); x+=6*scale;
  }
 }
 const visible=bars.slice(-120), offset=bars.length-visible.length, left=128,right=1170;
 const x=i=>left+(i+0.5)*(right-left)/visible.length;
 const fmt=v=>Math.abs(v)>=1e6?v.toExponential(1):v.toFixed(2);
 function panel(top,bottom,values,label,fixed) {
  const vs=values.filter(v=>v!==null), min=fixed?.[0]??Math.min(...vs), max=fixed?.[1]??Math.max(...vs);
  const pad=fixed?0:Math.max((max-min)*0.06,Math.abs(max)*0.001,0.01);
  const lo=min-pad,hi=max+pad,y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
  text(left,top-22,label);
  for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,py=y(v);line(left,py,right,py,palette.grid);text(8,py-5,fmt(v),palette.text,1);}
  return y;
 }
 function plot(values,y,color) {
  let prev=null;
  values.slice(offset).forEach((v,i)=>{if(v!==null){if(prev)line(prev[0],prev[1],x(i),y(v),color);else pixel(x(i),y(v),color);prev=[x(i),y(v)];}else prev=null;});
 }
 text(24,16,instrument.symbol+' / '+instrument.currency+' / DAILY OHLCV',palette.text,3);
 text(24,46,(instrument.sourceMode==='fixture'?'SYNTHETIC OFFLINE FIXTURE':'YAHOO VIA TICKER-CLI')+' / ADJUSTMENT AND COMPLETION UNKNOWN',palette.text,2);
 text(24,68,'SMA50',palette.sma50);text(115,68,'SMA200',palette.sma200);text(220,68,'BB20 2SD',palette.bb);
 const prices=visible.flatMap(b=>[b.low,b.high]);
 for(const key of ['sma50','sma200','bbUpper','bbLower'])prices.push(...series[key].slice(offset));
 const py=panel(120,430,prices,'PRICE '+instrument.currency);
 const candleWidth=Math.max(1,Math.min(7,(right-left)/visible.length*0.6));
 visible.forEach((b,i)=>{const color=b.close>=b.open?palette.up:palette.down;line(x(i),py(b.low),x(i),py(b.high),color);rect(x(i)-candleWidth/2,py(Math.max(b.open,b.close)),candleWidth,Math.max(1,Math.abs(py(b.open)-py(b.close))),color);});
 for(const [key,color] of [['sma50',palette.sma50],['sma200',palette.sma200],['bbUpper',palette.bb],['bbLower',palette.bb]])plot(series[key],py,color);
 const vy=panel(474,558,visible.map(b=>b.volume),'VOLUME',[0,Math.max(1,...visible.map(b=>b.volume))]);
 visible.forEach((b,i)=>rect(x(i)-candleWidth/2,vy(b.volume),candleWidth,558-vy(b.volume),b.close>=b.open?palette.up:palette.down));
 const ry=panel(600,690,[],'RSI14 / FLAT RSI UNDEFINED',[0,100]);
 for(const v of [30,70])line(left,ry(v),right,ry(v),palette.bb);
 plot(series.rsi14,ry,palette.up);
 const mv=[0,...series.macd.slice(offset),...series.macdSignal.slice(offset),...series.macdHistogram.slice(offset)];
 const my=panel(732,832,mv,'MACD12/26 BLUE / SIGNAL9 GOLD / HISTOGRAM');
 series.macdHistogram.slice(offset).forEach((v,i)=>{if(v!==null)line(x(i),my(0),x(i),my(v),v>=0?palette.up:palette.down);});
 plot(series.macd,my,palette.sma50);plot(series.macdSignal,my,palette.sma200);
 for(const i of [...new Set([0,Math.floor((visible.length-1)/2),visible.length-1])])text(Math.min(right-120,Math.max(left,x(i)-60)),846,visible[i].date);
 text(24,878,'LAST '+visible.length+' BARS / FULL HISTORY SEEDS / GAPS COMPRESSED / NOT A TRADE SIGNAL');
 const scan=Buffer.alloc(height*(width*3+1));
 for(let y=0;y<height;y++)pixels.copy(scan,y*(width*3+1)+1,y*width*3,(y+1)*width*3);
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
