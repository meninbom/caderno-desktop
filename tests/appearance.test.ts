import {describe,it,expect} from "vitest";
import {DEFAULT_APPEARANCE,APPEARANCE_PRESETS,normalizeAppearance,presetAppearance,parseAppearance,exportAppearance} from "../shared/appearance";
describe("Appearance preferences and theme files",()=>{
  it("migrates existing preferences without losing layout or editor choices",()=>{
    const a=normalizeAppearance({sidebarCollapsed:true,listWidth:350,editorFont:"serif",accent:"#00aa99"});
    expect(a.sidebarCollapsed).toBe(true);expect(a.listWidth).toBe(350);expect(a.editorFont).toBe("serif");
    expect(a.backgroundKind).toBe("none");expect(a.panelOpacity).toBe(96);
  });
  it("bounds imported numbers and rejects arbitrary CSS values, enums and unknown fields",()=>{
    const a=normalizeAppearance({panelOpacity:-100,panelRadius:10000,effectSize:NaN,accent:"url(https://example.test)",backgroundColor:"red; color:white",backgroundEffect:"<script>",backgroundKind:"remote",spellcheck:"false",unexpected:true});
    expect(a.panelOpacity).toBe(45);expect(a.panelRadius).toBe(28);expect(a.effectSize).toBe(12);
    expect(a.accent).toBeNull();expect(a.backgroundColor).toBe(DEFAULT_APPEARANCE.backgroundColor);
    expect(a.backgroundKind).toBe("none");expect(a.backgroundEffect).toBe("none");expect(a.spellcheck).toBe(true);expect(a).not.toHaveProperty("unexpected");
  });
  it("round-trips a portable theme and its image",()=>{
    const image="data:image/png;base64,iVBORw0KGgo=";
    const a=normalizeAppearance({...DEFAULT_APPEARANCE,backgroundKind:"image",backgroundEffect:"ascii",effectSize:22});
    const parsed=parseAppearance(exportAppearance(a,"dark",image,"paisagem.png"));
    expect(parsed.appearance).toEqual(a);expect(parsed.theme).toBe("dark");expect(parsed.image).toBe(image);expect(parsed.imageName).toBe("paisagem.png");
  });
  it("rejects unsupported files, remote sources, SVG and oversized imports before applying a theme",()=>{
    expect(()=>parseAppearance("{}")).toThrow();expect(()=>parseAppearance("null")).toThrow();
    for(const image of ["https://example.test/image.jpg","data:image/svg+xml;base64,PHN2Zz4=","data:image/png;base64,<>! "])
      expect(()=>parseAppearance(JSON.stringify({format:"caderno-appearance",version:1,appearance:{},image}))).toThrow();
    expect(()=>parseAppearance("x".repeat(6_000_001))).toThrow();
  });
  it("preserves panel state and zoom when changing a preset and validates every preset",()=>{
    const original={...DEFAULT_APPEARANCE,sidebarCollapsed:true,listWidth:360,editorZoom:150};
    for(const preset of APPEARANCE_PRESETS){const a=presetAppearance(preset,original);expect(a.sidebarCollapsed).toBe(true);expect(a.listWidth).toBe(360);expect(a.editorZoom).toBe(150);expect(normalizeAppearance(a)).toEqual(a);}
  });
});
