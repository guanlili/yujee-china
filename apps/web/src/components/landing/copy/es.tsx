import { buildFaq } from './faq';
import type { Copy } from './types';

export const es: Copy = {
  sideHome: 'Inicio',
  sideProjects: 'Mis proyectos',
  navExamples: 'Ejemplos',
  navPricing: 'Precios',
  navFaq: 'Preguntas frecuentes',
  footerStory: 'Nuestra historia',
  login: 'Iniciar sesión',
  menu: 'Menú',
  createTitle: 'Convierte tus fotos dispersas en un fotolibro que puedes leer, tocar y guardar',
  createSub: 'Sube tus fotos y la IA las agrupa, escribe la historia y maqueta automáticamente un fotolibro con estilo de revista. Empiezas gratis, lo editas entero y queda listo para imprimir.',
  sampleCta: 'Ver el ejemplo',
  makeSame: 'Hacer uno así',
  samplesNote: 'Libros de demostración hechos por el equipo de Yujee para enseñar de qué es capaz el producto. El contenido es ficticio, no es trabajo de clientes.',
  heroEyebrow: 'Fotolibros y memorias con IA · de las fotos al libro encuadernado',
  heroTitle: (
    <>
      Convierte tus fotos de cada día
      <br />
      en unas memorias que son solo tuyas
    </>
  ),
  heroSub: 'YUJEE AI convierte tus fotos, tus historias, tus recuerdos y tus ideas en un libro de recuerdos hecho para ti.',
  heroCta: 'Empezar a crear',
  heroExamples: 'Ver ejemplos',
  trust: ['Sin saber diseñar', 'Maquetación editable', 'PDF listo para imprimir'],
  workflowTitle: 'Cómo funciona',
  workflow: ['Agrupación automática de fotos', 'Escritura asistida por IA', 'Maquetación automática tipo revista'],
  polish: 'Puliendo el texto…',
  featuresLabel: 'Qué hace',
  featuresTitle: (
    <>
      Un creador de fotolibros con IA
      <br />
      que ordena las fotos por ti
    </>
  ),
  features: [
    {
      title: 'Maquetación automática en fotolibro',
      body:
        'Suelta un puñado de fotos y la IA maqueta sola las páginas dobles con aire de revista: fotos a sangre, retículas, espacio en blanco. Es diseño de fotolibro sin tener que diseñar, y una maquetación terminada sin arrastrar las fotos una a una.',
      icon: 'layout',
    },
    {
      title: 'Agrupación inteligente y pies de foto',
      body:
        'Detecta el momento y la escena para agrupar tus fotos sola, y redacta para cada grupo un título y una descripción que puedes editar. Tú marcas el tono; ella escribe el primer borrador.',
      icon: 'spark',
    },
    {
      title: 'Vista previa hojeable · PDF listo para imprimir',
      body:
        'Hojea una vista previa en 3D, página a página: lo que ves es lo que te llevas. Guárdalo como fotolibro digital o exporta un PDF a 300 DPI listo para imprimir y encuadernar cuando quieras.',
      icon: 'book',
    },
  ],
  ctaTitle: 'No dejes esas fotos en una carpeta: conviértelas en un libro para guardar',
  ctaSub: 'Haz tu primer fotolibro en unos minutos. Empieza gratis y piensa en exportar e imprimir cuando te enamore.',
  start: 'Empezar gratis',
  faqLabel: 'Preguntas frecuentes',
  faqTitle: 'Tus dudas sobre los fotolibros con IA, resueltas',
  faq: buildFaq('es', 'Ver precios'),
  footerTagline: 'Convierte tus fotos en un álbum con buen diseño.',
  footerProduct: 'Producto',
  footerResources: 'Recursos',
  footerExampleTravel: 'Ejemplo de fotolibro de viaje',
  footerExampleLifeStory: 'Ejemplo de libro de historia de vida',
  footerExamplesAll: 'Todos los ejemplos de memorias',
  footerCompany: 'Sobre nosotros',
  footerAccount: 'Cuenta',
  footerPrivacy: 'Privacidad',
  footerTerms: 'Términos',
  signup: 'Regístrate gratis',
  copyright: '© 2026 Yujee · Recuerdos, bien maquetados',
  samples: [
    {
      title: 'El año en un libro',
      brief: 'Un fotolibro al año, encuadernado cada diciembre',
      body:
        'Mete un año entero en un solo libro. Las fiestas, los viajes y los momentos de siempre se maquetan por meses y siguen año tras año.',
      bullets: ['Agrupado por mes o por evento', 'Un clic para el libro de fin de año', 'Mismo estilo, una colección que hace juego cada año'],
      image: '/landing-redesign/cards/03-year-record.png',
      video: '/landing-redesign/cards/03-year-record.mp4',
    },
    {
      title: 'Historia de vida',
      brief: 'Tus momentos clave, en un libro de historia de vida',
      body:
        'Coloca los momentos clave sobre una línea de tiempo: el nacimiento, los estudios, la gente y los viajes. Cada grupo lleva textos breves editables, encuadernados como una biografía.',
      bullets: ['Agrupación automática por etapa de la vida', 'Texto largo y citas destacadas en cada grupo', 'Un gran regalo de cumpleaños o de recuerdo'],
      image: '/landing-redesign/cards/02-life-story.png',
      video: '/landing-redesign/cards/02-life-story.mp4',
    },
    {
      title: 'Viajes',
      brief: 'Un viaje, encuadernado por sí solo en un fotolibro de viaje',
      body:
        'Se agrupa por sí solo según la fecha, con los lugares y el orden ya resueltos. Una página doble por día, con aire entre las fotos.',
      bullets: ['División automática por línea de tiempo', 'Añade páginas de mapa y notas de ruta', 'Exporta un PDF para compartir con tus compañeros de viaje'],
      image: '/landing-redesign/cards/01-travel.png',
      video: '/landing-redesign/cards/01-travel.mp4',
    },
    {
      title: 'Portafolio',
      brief: 'Tu trabajo, alineado y sin ruido',
      body:
        'Fotografía, ilustración, diseño: todo alineado a una retícula con márgenes constantes para que el protagonista siga siendo el trabajo.',
      bullets: ['Retícula estricta y márgenes uniformes', 'Título, técnica y año en cada página', 'Exporta un PDF de portafolio listo para enviar'],
      image: '/landing-redesign/cards/06-portfolio.png',
      video: '/landing-redesign/cards/06-portfolio.mp4',
    },
    {
      title: 'Revista',
      brief: 'Maqueta el contenido como una revista de verdad',
      body:
        'Más que un álbum: portada, sumario, reportajes y citas destacadas sobre el esqueleto de una revista. Convierte tu vida en un número.',
      bullets: ['Plantillas de portada, sumario y reportaje', 'Maquetación editorial con titulares y citas', 'Exportación lista para imprimir un número físico'],
      image: '/landing-redesign/cards/05-magazine.png',
      video: '/landing-redesign/cards/05-magazine.mp4',
    },
    {
      title: 'Historia de crecimiento',
      brief: 'Una página al mes, todos los cambios',
      body:
        'Se archiva por meses en una línea de tiempo del crecimiento. Los apuntes rápidos, como la altura, el peso y las primeras veces, caen en la página que les toca.',
      bullets: ['Agrupación automática por mes o por hito', 'Añade pequeñas fichas de datos', 'Sigue añadiendo: el álbum crece con el tiempo'],
      image: '/landing-redesign/cards/04-growth-story.png',
      video: '/landing-redesign/cards/04-growth-story.mp4',
    },
  ],
  previewChapters: [
    {
      title: 'La mañana de la salida',
      left: '/landing-redesign/photos/bamboo-grove-path.jpg',
      right: '/landing-redesign/photos/riverside-walk.jpg',
    },
    {
      title: 'La costa en verano',
      left: '/landing-redesign/photos/kamakura-coastal-street.jpg',
      right: '/landing-redesign/photos/seto-inland-sea-pier.jpg',
    },
    {
      title: 'La vuelta a casa',
      left: '/landing-redesign/photos/rainy-kyoto-lane.jpg',
      right: '/landing-redesign/photos/riverside-before-fireworks.jpg',
    },
  ],
};
