// Validação de IPC separada dos helpers visuais: o ícone da barra não carrega Zod.
import {z} from "zod";
import {isValidNotebookIcon,NOTEBOOK_DESCRIPTION_MAX,NOTEBOOK_LABEL_MAX,NOTEBOOK_LABELS_MAX} from "./notebook-customization";

export const NotebookIconSchema=z.string().max(48).refine(isValidNotebookIcon,"Ícone inválido.");
export const NotebookColorSchema=z.string().regex(/^#[0-9a-f]{6}$/i,"Cor inválida.");
export const NotebookDescriptionSchema=z.string().max(NOTEBOOK_DESCRIPTION_MAX,`Use até ${NOTEBOOK_DESCRIPTION_MAX} caracteres.`);
export const NotebookLabelsSchema=z.array(z.string().max(NOTEBOOK_LABEL_MAX*2)).max(NOTEBOOK_LABELS_MAX*2);
export const CustomizeNotebookInputSchema=z.object({
  id:z.number().int().positive(),icon:NotebookIconSchema.optional(),color:NotebookColorSchema.nullable().optional(),
  description:NotebookDescriptionSchema.optional(),labels:NotebookLabelsSchema.optional(),
});
