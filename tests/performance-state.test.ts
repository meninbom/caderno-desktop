import {describe,it,expect} from "vitest";
import {shareNoteSnapshot} from "../shared/note-snapshots";
import {rowAtOffset,rowOffsets} from "../shared/virtual-list";
import type {NoteMeta} from "../shared/ipc";
const note=(id:string):NoteMeta=>({id,title:id,notebookId:null,folderId:null,favorited:false,pinned:false,tags:[],createdAt:1,updatedAt:1,deletedAt:null,preview:"Preview"});
describe("stable note snapshots",()=>{
  it("keeps unchanged lists and rows stable, but preserves updates, ordering and search provenance",()=>{
    const a=note("a"),b=note("b"),original=[a,b];
    expect(shareNoteSnapshot(original,[{...a,tags:[]},{...b,tags:[]}])).toBe(original);
    const changed=shareNoteSnapshot(original,[{...b,preview:"New content"},{...a}]);
    expect(changed[0]).not.toBe(b);expect(changed[0].preview).toBe("New content");expect(changed[1]).toBe(a);
    const match=shareNoteSnapshot(original,[{...a,matchSource:"invoice.pdf",matchSnippet:"Search match"}]);
    expect(match[0].matchSource).toBe("invoice.pdf");expect(match).toHaveLength(1);
  });
  it("detects tag color changes and deleted notes instead of returning stale UI",()=>{
    const a={...note("a"),tags:[{id:1,name:"Customer",color:"#ff0000"}]};
    expect(shareNoteSnapshot([a],[{...a,tags:[{...a.tags[0],color:"#00ff00"}]}])[0]).not.toBe(a);
    expect(shareNoteSnapshot([a],[])).toEqual([]);
  });
});
describe("variable-height note windows",()=>{
  it("finds visible rows at boundaries and after actual measurements",()=>{
    const offsets=rowOffsets(["a","b","c"],new Map([["b",150]]),100);
    expect(offsets).toEqual([0,100,250,350]);
    expect(rowAtOffset(offsets,-1)).toBe(0);expect(rowAtOffset(offsets,0)).toBe(0);
    expect(rowAtOffset(offsets,100)).toBe(1);expect(rowAtOffset(offsets,249)).toBe(1);
    expect(rowAtOffset(offsets,250)).toBe(2);expect(rowAtOffset(offsets,10000)).toBe(2);
    expect(rowAtOffset([0],0)).toBe(0);
  });
});
