export function history(symbol="ASML.AS",currency="EUR",n=250,closeAt=i=>100+i*0.2+Math.sin(i/5)*3) {
  const points=[];let date=new Date("2025-01-02T00:00:00Z");
  while(points.length<n) {
    if(date.getUTCDay()!==0 && date.getUTCDay()!==6) {
      const i=points.length,c=closeAt(i);
      points.push({date:date.toISOString().slice(0,10),open:c-0.3,high:c+2,low:c-2,close:c,volume:1000000+i*1000});
    }
    date.setUTCDate(date.getUTCDate()+1);
  }
  return {symbol,currency,name:"Synthetic "+symbol,points};
}
