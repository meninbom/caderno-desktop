import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { inspectMedia, inspectRaster } from "../electron/repo/attachments";

const fixture=(name:string)=>fs.readFileSync(path.join(process.cwd(),"tests/fixtures/media",name));
describe("media attachments",()=>{
  it("recognizes local preview formats and refuses corrupt declared media",()=>{
    expect(inspectMedia(fixture("two-pages.pdf"),"test.pdf")).toBe("application/pdf");
    expect(inspectMedia(fixture("attack.html"),"unsafe.html")).toBe("text/html");
    expect(inspectMedia(fixture("two-seconds.webm"),"video.webm")).toBe("video/webm");
    expect(inspectMedia(fixture("valid.png"),"pixel.png")).toBe("image/png");
    expect(inspectMedia(fixture("corrupt.pdf"),"broken.pdf")).toBe("application/pdf");
    expect(()=>inspectMedia(Buffer.from("not a video"),"broken.webm")).toThrow(/Cabeçalho/);
    expect(()=>inspectMedia(Buffer.alloc(51*1024*1024),"large.pdf")).toThrow(/50 MB/);
    expect(inspectMedia(Buffer.from("opaque"),"archive.bin")).toBe("application/octet-stream");
    expect(inspectRaster(fixture("valid.png")).width).toBe(1);
  });
});
