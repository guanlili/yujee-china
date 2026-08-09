import type { ExampleContent } from './types';

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
};
