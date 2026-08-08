import type { InterviewCase } from '../interview';

export const es: Record<InterviewCase, readonly [string, string, string]> = {
  timeAndPlace: [
    'Ya te he agrupado estas fotos.',
    'Me encantaría saber un poco más: ¿con quién estabas ese día?',
    '¿Hay alguna persona, algún momento o alguna sensación especial que quieras dejar dentro de este libro?',
  ],
  timeOnly: [
    'Estas fotos tienen algo muy bonito.',
    '¿Dónde las hiciste y con quién estabas?',
    'Cuéntame cualquier recuerdo o estado de ánimo que quieras guardar.',
  ],
  placeOnly: [
    'Ya he mirado estas fotos.',
    '¿Más o menos cuándo las hiciste y con quién estabas?',
    '¿Hay alguna historia o alguna sensación que quieras dejar escrita?',
  ],
  neither: [
    'Me gustaría entender un poco mejor estas fotos.',
    '¿Más o menos cuándo, dónde y con quién las hiciste?',
    'Qué pasó, cómo te sentiste… cuéntame lo que quieras.',
  ],
};
