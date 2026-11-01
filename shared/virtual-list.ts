export function rowOffsets(ids:readonly string[],sizes:ReadonlyMap<string,number>,estimate:number):number[]{
  const offsets=[0];for(const id of ids)offsets.push(offsets[offsets.length-1]+(sizes.get(id)??estimate));return offsets;
}
export function rowAtOffset(offsets:readonly number[],value:number):number{
  let low=0,high=Math.max(0,offsets.length-2);
  while(low<high){const middle=Math.ceil((low+high)/2);if(offsets[middle]<=value)low=middle;else high=middle-1;}
  return low;
}
