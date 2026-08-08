import {
  FREE_PLAN_CREDITS,
  PAGES_PER_CREDIT_LABEL,
  PHOTOS_PER_CREDIT,
} from '@/config/pricing';
import type { FaqEntry } from './types';

export const ES: readonly FaqEntry[] = [
  // Questions are phrased the way people actually search ("make a photo book",
  // "photo book layout") so the page and its FAQPage JSON-LD match real queries.
  // Facts must stay identical to the product — only the wording carries keywords.
  {
    q: '¿Necesito saber diseñar para hacer un fotolibro?',
    a: 'Para nada. Tú solo eliges las fotos: el creador de fotolibros con IA se encarga de la maquetación, de agrupar las fotos y de escribir un primer borrador de los pies de foto. La maquetación de cada página sigue siendo editable, así que participa tanto como quieras.',
  },
  {
    q: '¿En qué formato se exporta mi fotolibro?',
    a: 'En un PDF a 300 DPI listo para imprimir: descárgalo, compártelo o mándalo directamente a una imprenta para imprimir y encuadernar tu fotolibro.',
  },
  {
    q: '¿Mis fotos están seguras y son privadas?',
    a: 'Las fotos originales nunca se suben: a la IA solo llegan vistas previas comprimidas para planificar la maquetación. Nuestros servidores guardan los datos de maquetación y el PDF y la portada que exportas, para que puedas volver a abrir y descargar tu libro cuando quieras. Tus álbumes solo los ves tú y nunca se hacen públicos.',
  },
  {
    q: '¿Cuánto se tarda en hacer un fotolibro?',
    a: 'A los pocos minutos de subir las fotos tienes un borrador de tu libro que ya puedes hojear, maquetado automáticamente como una revista. Después afina la maquetación todo el tiempo que quieras: los cambios se guardan solos.',
  },
  {
    q: '¿Puedo cambiar la maquetación o añadir fotos más adelante?',
    a: 'Sí. La maquetación de cada página es editable y puedes añadir fotos nuevas cuando quieras: los libros de recuerdos, como un álbum del crecimiento de un bebé, están pensados para seguir creciendo.',
  },
  {
    // Reworded, not added: an "Is Yujee free to use?" entry alongside this one
    // would be two questions with one answer. The grant is interpolated so the
    // claim can never outlive the constant.
    q: '¿Yujee es un creador de fotolibros gratis?',
    a: `Sí, para empezar. Al registrarte recibes ${FREE_PLAN_CREDITS} créditos gratis, un fotolibro entero de principio a fin. 1 crédito = ${PHOTOS_PER_CREDIT} foto${PHOTOS_PER_CREDIT === 1 ? '' : 's'}, y un fotolibro suele tener ${PAGES_PER_CREDIT_LABEL} páginas. Sin suscripción.`,
  },
];
