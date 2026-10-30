import Highlight from "@tiptap/extension-highlight";
import { parseCssColor, readableInk } from "./text-colors";

/** Marca-texto com tinta contrastante; cor de texto explícita continua prevalecendo via CSS. */
export const NoteHighlight = Highlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      color: {
        default: null,
        parseHTML: element => element.getAttribute("data-color") || element.style.backgroundColor,
        renderHTML: attributes => {
          if (!attributes.color) return {};
          const background = parseCssColor(attributes.color);
          const foreground = background ? readableInk(background) : "inherit";
          return {
            "data-color": attributes.color,
            style: `background-color: ${attributes.color}; color: ${foreground}`,
          };
        },
      },
    };
  },
}).configure({ multicolor: true });
