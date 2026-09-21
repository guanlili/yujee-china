import type { ExampleContent } from './types';

/** The four formats added 2026-09-21 share the same five capabilities (same
 *  wording as travel-journal); the two older entries keep their own lists. */
const MADE_WITH = [
  'Agrupación de fotos con IA',
  'Pies de foto escritos por IA',
  'Maquetación automática tipo revista',
  'Edición conversando',
  'PDF a 300 DPI listo para imprimir',
];

export const es: Record<string, ExampleContent> = {
  'travel-journal': {
    title: 'Diario de viaje',
    tagline: 'Un viaje maquetado como una historia de lugares y de tiempo.',
    metaTitle: 'Ejemplo de fotolibro de viaje — Unas memorias hechas con Yujee AI',
    metaDesc:
      'Mira cómo Yujee convierte las fotos sueltas de un viaje entero en un fotolibro de viaje con estilo de revista: agrupado por lugar, con pies de foto escritos por IA y exportado en PDF listo para imprimir.',
    intro: [
      'Este es un ejemplo de unas memorias de viaje hechas con Yujee. Tomamos las fotos de un solo viaje (paisajes, calles, retratos y los momentos tranquilos de en medio) y dejamos que la IA las agrupara por lugar y por fecha, redactara los pies de foto y los títulos de capítulo, y maquetara cada página doble como una revista que puedes tener en las manos. Aquí no hay nada diseñado a mano.',
      'Úsalo como referencia para tu propio fotolibro de viaje. Da igual que sea una semana en Kioto o un año entero de escapadas de fin de semana: el proceso es el mismo. Subes tus fotos, dejas que Yujee las ordene y monte un primer borrador, cambias lo que quieras conversando y exportas un PDF a 300 DPI para imprimir y encuadernar.',
    ],
    inside: [
      'Una portada y una portadilla hechas con tu mejor foto',
      'Capítulos agrupados por lugar y por día',
      'Pies de foto y textos de capítulo redactados por la IA, todos editables',
      'Paisajes a sangre junto a primeros planos de detalles tranquilos',
    ],
    madeWith: [
      'Agrupación de fotos con IA',
      'Pies de foto escritos por IA',
      'Maquetación automática tipo revista',
      'Edición conversando',
      'PDF a 300 DPI listo para imprimir',
    ],
    galleryAlt: [
      'Portada del Diario de viaje con una foto de banderas de oración junto a un lago',
      'Una página doble de viaje que combina un retrato con un paisaje de montaña',
      'Una página doble de viaje titulada “La calma entre momentos” con una foto de rayos de luz',
      'Una página doble de viaje con caballos en un campo nevado junto a un retrato',
    ],
  },
  'life-story': {
    title: 'Historia de vida',
    tagline: 'Una vida contada en una línea de tiempo: los momentos clave y los días corrientes de en medio.',
    // This page owns the memoir/biography demand. Deliberately NOT the bare
    // terms "best memoir" or "biography": those SERPs are book recommendations
    // and celebrity lookups (Goodreads, Wikipedia, IMDb) — reader and
    // reference intent, not "I want to make one". "memoir book" and
    // "biography book" are the make-intent forms of the same demand.
    metaTitle: 'Ejemplo de libro de historia de vida y biografía — Yujee AI',
    metaDesc:
      'Un libro de memorias de una vida hecho con Yujee: los momentos clave y los días de siempre sobre una línea de tiempo, maquetados por IA. Haz tu propia biografía y exporta un PDF para imprimir.',
    intro: [
      'Este es un ejemplo de un libro de memorias de una vida hecho con Yujee. Reúne los momentos de los que está hecha una vida de verdad (una mesa junto a la ventana, una tarde en casa, esos pequeños rincones con los que convivimos) y los ordena a lo largo de una línea de tiempo tranquila. La IA escribió un primer borrador de los títulos de capítulo y de los pies de foto; todas las palabras siguen siendo editables.',
      'Es un formato que no deja de crecer. Añade un capítulo cada año, o digitaliza las fotos antiguas y deja que Yujee las hilvane en una sola historia continua; luego exporta un PDF a 300 DPI para imprimir y guardar. Es la forma más sencilla de escribir tu propia biografía sin escribir ni una palabra primero: la IA redacta y tú corriges.',
    ],
    inside: [
      'Una línea de tiempo que va de los primeros años hasta hoy',
      'Capítulos para los momentos clave, las casas y los rincones de siempre',
      'Títulos y pies de foto redactados por la IA que puedes reescribir',
      'Sitio para añadir un capítulo nuevo cada año',
    ],
    madeWith: [
      'Agrupación de fotos con IA',
      'Texto de capítulo escrito por IA',
      'Maquetación automática tipo revista',
      'Edición conversando',
      'PDF a 300 DPI listo para imprimir',
    ],
    galleryAlt: [
      'Una página doble de historia de vida titulada “Mesa de tarde” con fotos del interior de una casa',
      'Una página doble que combina “Mesa de tarde” con una foto de un jarrón, “Naturaleza muerta”',
      'Una página doble “Rincón decorado / Naturaleza muerta” con ramas en un jarrón',
      'Una página doble “Rincón decorado / Salón personal” de una habitación vivida',
    ],
  },
  // ---- Added 2026-09-21: the four remaining homepage formats ----------------
  'year-in-review': {
    title: 'Resumen del año',
    tagline: 'Un libro de fotos del año: doce meses, maquetados mes a mes.',
    metaTitle: 'Ejemplo de libro de fotos del año — Hecho con Yujee AI',
    metaDesc:
      'Un libro de fotos del año hecho con Yujee: viajes y días corrientes agrupados por mes, pies de foto de IA, maquetación tipo revista y PDF listo para imprimir.',
    intro: [
      'Este es un ejemplo de libro de fotos del año hecho con Yujee. Tomamos las fotos de un año entero (prados en primavera, un lago en verano, cielos al atardecer, algún fin de semana fuera) y dejamos que la IA las ordenara por mes, redactara un pie de foto y una breve nota de capítulo para cada tramo, y maquetara cada página doble como una revista. Nada de lo que ves en estas páginas se colocó a mano.',
      'Es un formato que no se acaba: haz uno cada diciembre y los libros quedan alineados en la estantería como una colección. Sube las fotos del año, deja que Yujee las agrupe y monte un primer borrador, corrige lo que quieras conversando y exporta un PDF a 300 DPI para imprimir y encuadernar; o déjalo en digital y comparte el enlace.',
    ],
    inside: [
      'Una portada hecha con la mejor foto del año',
      'Capítulos agrupados por mes o por acontecimiento',
      'Pies de foto y notas de capítulo redactados por la IA, todos editables',
      'El mismo estilo cada año, para que los tomos hagan juego en la estantería',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Portada del Resumen del año con un prado junto a un lago bajo un cielo nublado',
      'Página doble de apertura del libro de fotos del año con dos atardeceres sobre un lago',
      'Una página doble titulada “The Quiet Between Moments” con un estanque de lotos y un caballo en un prado',
      'Una página doble de cierre titulada “What We Keep” con una mujer de pie en un prado de montaña',
    ],
  },
  'growth-story': {
    title: 'Historia de crecimiento',
    tagline: 'Un álbum de bebé que no deja de crecer: una página al mes y cada primera vez.',
    metaTitle: 'Ejemplo de álbum de bebé — Historia de crecimiento con Yujee AI',
    metaDesc:
      'Un álbum de bebé hecho con Yujee: meses y primeras veces en una línea de crecimiento, pies de foto redactados por IA, maquetado como recuerdo y en PDF para imprimir.',
    intro: [
      'Este es un ejemplo de historia de crecimiento, un álbum de bebé hecho con Yujee. Las fotos de una familia durante un año (una tienda de campaña junto al lago, la primera hoguera, una tarde en el jardín, hornear con los abuelos) se ordenaron por mes en una línea de crecimiento, y la IA redactó los pies de foto y una breve nota para cada etapa. Cada palabra es un primer borrador editable.',
      'El formato está pensado para seguir añadiendo. Suelta las fotos del mes nuevo y Yujee maqueta la página siguiente con el mismo estilo; las pequeñas fichas de datos (talla, peso, primeras palabras) caen en la página que les toca. Cuando termine el año, exporta un PDF a 300 DPI e imprime una copia para cada abuelo.',
    ],
    inside: [
      'Una línea de crecimiento agrupada por mes o por hito',
      'Sitio para pequeñas fichas de datos: talla, peso, primeras veces',
      'Pies de foto y notas de etapa redactados por la IA, todos editables',
      'Sigue añadiendo páginas: el álbum crece con el niño',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Portada de la historia de crecimiento con una familia montando una tienda junto a un lago',
      'Página doble de apertura con una familia paseando por el bosque y niños junto a un farol de campamento',
      'Una página doble titulada “The Quiet Between Moments” con un niño en el jardín y los abuelos a la mesa',
      'Una página doble de cierre titulada “What We Keep” con un padre y su hija regando plantas y una familia horneando juntos',
    ],
  },
  'photo-magazine': {
    title: 'Revista de fotos',
    tagline: 'Tus fotos compuestas como un editorial de verdad: portada, reportajes a doble página y citas destacadas.',
    metaTitle: 'Ejemplo de revista de fotos personal — Hazla con Yujee AI',
    metaDesc:
      'Una revista de fotos hecha con Yujee: tus fotos compuestas como un número editorial, con portada, reportajes y pies de foto maquetados por IA, en PDF para imprimir.',
    intro: [
      'Este es un ejemplo de revista de fotos hecha con Yujee. Una serie de retratos de invierno (nieve, calles de ciudad, una capa roja de noche) se compuso sobre el esqueleto de una revista: una portada, una página doble de apertura a modo de sumario y páginas de reportaje con titulares y citas destacadas. La IA eligió el orden y redactó los textos; nada se colocó a mano.',
      'Es el formato para las fotos que merecen algo más que una cuadrícula. Sube una sesión, una temporada o un año de tu afición, y Yujee lo maqueta como un número que podrías dejar en la mesa del salón. Cambia cualquier titular conversando, exporta un PDF a 300 DPI y mándalo a imprimir como una revista de verdad; o comparte el enlace para hojearla.',
    ],
    inside: [
      'Una portada y un sumario hechos con tus mejores fotos',
      'Reportajes a doble página con titulares y citas destacadas',
      'Textos editoriales redactados por la IA, todos editables',
      'Páginas listas para imprimir un número físico',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Portada de revista con una figura con abrigo largo en una ladera nevada',
      'Página doble editorial de apertura con dos retratos de moda de invierno en la nieve',
      'Una página doble titulada “The Quiet Between Moments” que combina un abrigo azul en la nieve con un retrato en una calle de ciudad',
      'Una página doble de cierre titulada “What We Keep” con una capa roja y un retrato nocturno en la calle',
    ],
  },
  'portfolio-book': {
    title: 'Portafolio',
    tagline: 'Trabajos seleccionados sobre una cuadrícula estricta: un portafolio en PDF para enviar o imprimir.',
    metaTitle: 'Ejemplo de portafolio de fotografía en PDF — Yujee AI',
    metaDesc:
      'Un portafolio hecho con Yujee: fotos seleccionadas sobre una cuadrícula estricta, márgenes uniformes y un título por página, exportado en PDF listo para enviar.',
    intro: [
      'Este es un ejemplo de portafolio hecho con Yujee. La obra seleccionada de un fotógrafo (una serie de moda de invierno) se alineó sobre una cuadrícula estricta con márgenes uniformes y un título por página, para que el trabajo sea el protagonista y la maquetación no estorbe. La IA se ocupó del orden y de los espacios; las páginas no se diseñaron a mano.',
      'Es el formato para quien necesita enviar su trabajo: fotógrafos, ilustradores, diseñadores. Sube las piezas, deja que Yujee las maquete, cambia cualquier título conversando y exporta un portafolio en PDF listo para presentar; o un archivo a 300 DPI para un libro impreso que entregar en mano.',
    ],
    inside: [
      'Una cuadrícula estricta con márgenes uniformes en todas las páginas',
      'Título, técnica y año de cada pieza',
      'Una portada y una página de cierre sobrias',
      'Un portafolio en PDF para presentar, o un archivo listo para imprimir',
    ],
    madeWith: MADE_WITH,
    galleryAlt: [
      'Portada del portafolio titulada “My Folder” con una figura en una ladera nevada',
      'Página doble de apertura del portafolio con dos fotografías de moda de invierno',
      'Una página doble del portafolio que combina una foto de un abrigo azul en la nieve con un retrato callejero',
      'Una página doble de cierre del portafolio con una capa roja y un retrato nocturno de ciudad',
    ],
  },
};
