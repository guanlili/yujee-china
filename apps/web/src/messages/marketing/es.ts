import { SUPPORT_EMAIL } from '@/config/social';
import type { MarketingMessages } from './types';

export const es: MarketingMessages = {
  nav: {
    brand: 'Yujee',
    home: 'Inicio',
    myProjects: 'Mis proyectos',
    howItWorks: 'Cómo funciona',
    examples: 'Ejemplos',
    guides: 'Guías',
    pricing: 'Precios',
    about: 'Sobre nosotros',
    menuToggle: 'Abrir el menú de navegación',
    login: 'Iniciar sesión',
    getStarted: 'Empezar',
    languageLabel: 'Español',
  },
  landing: {
    // "Free" leads because the free grant is real (FREE_PLAN_CREDITS covers a
    // whole book) and because "layout" is the winnable half of that demand —
    // bare "free photo book maker" is Shutterfly/Canva territory. "Memoir"
    // stays: it is the higher-intent term and the one this site can rank for.
    metaTitle: 'Fotolibro y memorias con IA gratis — Maquetación automática a PDF | Yujee',
    metaDesc:
      'Maquetación gratuita de fotolibros online: la IA de Yujee agrupa tus fotos, escribe la historia y monta un libro con estilo de revista. Edita conversando y exporta un PDF listo para imprimir.',
    composerUploadLabel: 'Subir fotos',
    composerHints: [
      { label: 'Álbum de viaje', fill: 'Hazme un álbum de fotos de mi viaje a Bali la semana pasada; tengo muchas fotos de playas y de templos.' },
      { label: 'Momentos del bebé', fill: 'Quiero un diario de crecimiento de mi hija, con fotos desde que nació hasta su primer cumpleaños.' },
      { label: 'Graduación', fill: 'Un anuario de graduación de la secundaria con las fotos de clase y las despedidas de todo el mundo.' },
      { label: 'Diario gastronómico', fill: 'Reúne las fotos de restaurantes de los últimos seis meses en una revista de comida.' },
    ],
    casesTitle: 'Inspiración',
    casesMore: 'Ver más',
    cases: [
      { title: 'Graduación', desc: 'Convierte cuatro años de fotos de grupo, entradas y conversaciones en un anuario.' },
      { title: 'Recuerdo de boda', desc: 'Guarda los votos, las felicitaciones y cada detalle bonito del día en que dijiste que sí.' },
      { title: 'Momentos del bebé', desc: 'Del nacimiento al primer cumpleaños, recoge cada avance en fotos y en palabras.' },
      { title: 'Memorias de viaje', desc: 'Ordena los momentos sueltos del viaje en una historia con línea de tiempo.' },
      { title: 'Viaje de amigas', desc: 'Convierte el sol, las bromas y las fotos del fin de semana en un número luminoso sobre la amistad.' },
      { title: 'Diario de mascotas', desc: 'Haz un fotolibro solo para tu peludo, con su día a día y sus mejores caras.' },
      { title: 'Recuerdos de una vida', desc: 'Digitaliza las fotos antiguas y conserva las historias de familia que merecen durar.' },
      { title: 'Notas gastronómicas', desc: 'Organiza las fotos de restaurantes en una guía de comida con historia.' },
      { title: 'Diario de amor', desc: 'Reúne las citas tranquilas, las notas pequeñas y el romance de cada día en un solo recuerdo.' },
    ],
  },
  privacy: {
    metaTitle: 'Yujee — Política de privacidad',
    metaDesc:
      'Cómo trata Yujee tus fotos y tus datos personales. Las fotos originales nunca se suben: a la IA solo llegan vistas previas comprimidas para planificar la maquetación, y tus álbumes siguen siendo privados.',
    title: 'Política de privacidad',
    effective: 'Fecha de entrada en vigor: 27 de mayo de 2026',
    sections: [
      {
        h: '1. Introducción',
        body: 'Yujee ("nosotros") valora tu privacidad. Esta Política de privacidad explica cómo recopilamos, usamos, divulgamos y protegemos tu información cuando utilizas outman.press.',
      },
      {
        h: '2. Información que recopilamos',
        body: 'Recopilamos: (a) información de la cuenta (correo electrónico, nombre) cuando te registras; (b) datos de uso sobre cómo interactúas con Yujee; (c) los textos e indicaciones que envías para generar unas memorias; (d) las memorias que produces, es decir, los datos de maquetación, los archivos PDF exportados y las miniaturas de portada, guardados en nuestro almacenamiento en la nube para que puedas volver a abrirlos y descargarlos cuando quieras. No guardamos las fotos originales que subes: se quedan en tu navegador, y a nuestro proveedor de IA solo se envían vistas previas comprimidas para planificar la maquetación. Ten en cuenta que las fotos que coloques en unas memorias quedan incrustadas en el PDF que exportas y guardas.',
      },
      {
        h: '3. Cómo usamos tu información',
        body: 'Usamos la información para ofrecer y mejorar Yujee, procesar los pagos y gestionar los créditos, enviar avisos relacionados con el servicio, seguir las tendencias de uso y detectar o evitar fraudes y abusos.',
      },
      {
        h: '4. Cesión de información',
        body: 'No vendemos tu información personal. Solo compartimos datos con los proveedores que operan el producto en nuestro nombre (alojamiento en la nube, procesamiento de pagos, envío de correo e inferencia de IA) y cuando la ley lo exige.',
      },
      {
        h: '5. Seguridad de los datos',
        body: 'Aplicamos medidas técnicas y organizativas razonables para proteger tus datos. Ninguna transmisión por internet ni ningún almacenamiento electrónico es seguro al 100 %; no podemos garantizar una seguridad absoluta.',
      },
      {
        h: '6. Tus derechos',
        body: 'Según la jurisdicción en la que te encuentres, puedes acceder a tus datos personales, corregirlos, eliminarlos o limitar su tratamiento. Escríbenos para ejercer estos derechos.',
      },
      {
        h: '7. Privacidad de los menores',
        body: 'Yujee no se dirige a menores de 13 años (o la edad equivalente en tu jurisdicción). Si descubrimos que hemos recopilado datos personales de un menor, los eliminaremos sin demora.',
      },
      {
        h: '8. Cambios en esta política',
        body: 'Podemos actualizar esta Política de privacidad en cualquier momento. Los cambios importantes se anunciarán dentro del producto o por correo electrónico.',
      },
      {
        h: '9. Contacto',
        body: '',
      },
    ],
    contactLine: '¿Tienes dudas? Escribe a privacy@outman.press.',
  },
  terms: {
    metaTitle: 'Yujee — Términos del servicio',
    metaDesc:
      'Los términos que aceptas al usar Yujee para convertir tus fotos en unas memorias maquetadas por IA: cuentas, créditos, exportaciones y los derechos que conservas sobre tu propio contenido.',
    title: 'Términos del servicio',
    effective: 'Fecha de entrada en vigor: 8 de agosto de 2026',
    sections: [
      {
        h: '1. Aceptación de los términos',
        body: 'Al acceder a Yujee (outman.press) o utilizarlo, aceptas quedar vinculado por estos Términos del servicio. Si no estás de acuerdo, no uses el servicio.',
      },
      {
        h: '2. Descripción del servicio',
        body: 'Yujee es un generador de memorias con IA. Tú aportas fotos e indicaciones; nosotros maquetamos unas memorias con estilo de revista y te dejamos exportarlas en PDF. No garantizamos un resultado creativo concreto.',
      },
      {
        h: '3. Cuentas de usuario',
        body: 'Eres responsable de la confidencialidad de las credenciales de tu cuenta y de toda la actividad que ocurra en ella. Debes facilitar datos de registro exactos.',
      },
      {
        h: '4. Uso aceptable',
        body: 'Te comprometes a no usar Yujee para generar contenido ilegal, dañino, difamatorio u obsceno, ni que vulnere los derechos de terceros; tampoco a interrumpir el servicio, abusar de los límites de uso o intentar accesos no autorizados.',
      },
      {
        h: '5. Incumplimiento y cierre de la cuenta',
        body:
          'Si incumples estos Términos, en particular la sección 4, o si tenemos motivos razonables para creer que tu uso de Yujee es ilícito, infractor, fraudulento o perjudicial para otras personas usuarias o para la seguridad del servicio, podremos adoptar una o varias de las siguientes medidas, según la gravedad del incumplimiento:\n' +
          '• avisarte y pedirte que soluciones el problema en un plazo determinado;\n' +
          '• restringir o desactivar funciones concretas, como generar, exportar o compartir;\n' +
          '• retirar o bloquear el acceso al contenido afectado y a cualquier enlace para compartirlo;\n' +
          '• suspender tu cuenta;\n' +
          '• cerrar tu cuenta y negarnos a seguir prestando el servicio.\n' +
          '\n' +
          'En caso de incumplimientos graves, de incumplimientos reiterados tras un aviso, o cuando la ley o una autoridad competente lo exija, podremos suspender o cerrar la cuenta de inmediato y sin aviso previo. Salvo que la urgencia o la ley exijan otra cosa, haremos un esfuerzo razonable por explicarte el motivo en el momento de actuar o poco después. Si crees que la decisión fue equivocada, puedes recurrir escribiendo a la dirección de contacto que figura al final de estos Términos y la revisaremos de nuevo.\n' +
          '\n' +
          'Si tu cuenta se cierra por haber incumplido estos Términos, los créditos no utilizados no se reembolsan y no respondemos de las pérdidas derivadas del cierre. Nada de lo dispuesto aquí limita nuestro derecho a ejercer las demás acciones que la ley nos reconozca. Puedes dejar de usar Yujee o pedirnos que eliminemos tu cuenta cuando quieras; tras la eliminación, tus datos se tratan según lo descrito en la Política de privacidad. Las secciones 6, 8, 9 y 11, junto con cualquier disposición que por su naturaleza deba seguir vigente, continúan en vigor tras la extinción.',
      },
      {
        h: '6. Propiedad intelectual',
        body: 'Conservas la titularidad de las fotos y los textos que aportas. En la relación entre tú y Yujee, las memorias generadas te pertenecen: puedes usarlas, reproducirlas y distribuirlas libremente. Nosotros tratamos tu contenido únicamente para prestar el servicio.',
      },
      {
        h: '7. Créditos y pagos',
        body:
          'Generar unas memorias consume créditos foto a foto: un crédito cubre una foto. Cuando inicias una generación retenemos los créditos correspondientes; se cobran en cuanto la maquetación se completa, y la retención se libera sin ningún cargo si la generación falla. Los créditos se obtienen mediante paquetes de pago único: no hay suscripción ni cuota mensual, y por ahora los créditos no caducan. Los precios y los tamaños de paquete vigentes son los que aparecen en la página de precios.\n' +
          '\n' +
          'Una vez cobrados los créditos por una maquetación completada, no son reembolsables, tampoco si el resultado no te convence. Salvo que la ley exija otra cosa, los importes pagados y los paquetes de créditos comprados no admiten devolución. Si compraste a través de una pasarela de pago externa, también se aplican sus propias normas de reembolso, y nada de esta sección afecta a los derechos de consumo que la ley de tu país o región no nos permita excluir.\n' +
          '\n' +
          'Podemos cambiar los precios, los tamaños de paquete y los modelos de facturación en cualquier momento. Los cambios se aplican a las compras nuevas desde su publicación y no afectan a los créditos que ya hayas comprado.',
      },
      {
        h: '8. Exención de garantías',
        body: 'El servicio se presta "tal cual" y "según disponibilidad", sin garantías de ningún tipo. No garantizamos que Yujee funcione sin interrupciones, de forma segura o sin errores.',
      },
      {
        h: '9. Limitación de responsabilidad',
        body: 'En la máxima medida permitida por la ley, Yujee no responderá de ningún daño indirecto, incidental, especial, consecuente o punitivo, incluidos el lucro cesante, la pérdida de datos o el daño a la reputación.',
      },
      {
        h: '10. Cambios en los Términos',
        body: 'Podemos modificar estos Términos en cualquier momento; la versión actualizada entra en vigor al publicarse. Seguir usando el servicio después de los cambios equivale a aceptarlos.',
      },
      {
        h: '11. Ley aplicable y controversias',
        body:
          'Estos Términos —su formación, su validez y su interpretación, así como cualquier controversia que surja de ellos o guarde relación con ellos— se rigen por las leyes de la República Popular China (excluidas las Regiones Administrativas Especiales de Hong Kong y Macao y la región de Taiwán).\n' +
          '\n' +
          'Si surge una controversia, las partes intentarán primero resolverla mediante una negociación de buena fe. Si la negociación no prospera, cualquiera de las partes podrá acudir al tribunal competente del lugar donde se encuentre el operador de Yujee.\n' +
          '\n' +
          'Si la ley de tu país o región te reconoce derechos de consumo que no pueden excluirse, esta sección no afecta a esos derechos.',
      },
      {
        h: '12. Contacto',
        body: '',
      },
    ],
    contactLine: '¿Tienes dudas? Escribe a support@outman.press.',
  },
  story: {
    metaTitle: 'Nuestra historia — Por qué hice Yujee',
    metaDesc:
      'Viví con depresión más de una década, trabajé como consejera astrológica y después pasé un año convirtiendo una IA en consejera. Esto es lo que aprendí, y por qué Yujee prefiere convertir tu vida en un libro.',
    title: 'Después de salir de la depresión, hice una herramienta solo para mí',
    lede: [
      'Me llamo yvaine.',
      'Viví con depresión más de diez años. He trabajado como diseñadora de producto de software y después como consejera astrológica. Ahora hago Yujee.',
      'Yujee es una herramienta que te ayuda a entenderte y a convertir eso en un libro.',
      'Esto es por qué existe.',
    ],
    sections: [
      {
        h: 'Más de diez años a oscuras',
        paras: [
          'Tuve depresión grave y trastorno bipolar.',
          'Desde la escuela primaria hasta la edad adulta, por cosas de casa, fui la niña retraída, la que estaba aparte, la que no tenía ninguna confianza en sí misma.',
          'La luz solo empezó a entrar cuando terminé la universidad.',
          'Al graduarme pasé al diseño de producto de software y por primera vez sentí el gusto de resolver algo juntando lógica y diseño. Pero hubo una pregunta que me acompañó todo ese tiempo. Para qué vive una persona, en realidad.',
        ],
        pull: 'Más de diez años sin luz. Me asomé a ese borde más veces de las que puedo contar.',
      },
      {
        h: 'La astrología me dio un punto de apoyo',
        paras: [
          'Había hecho bastante terapia y bastante consulta psicológica. Casi nada de aquello me sirvió.',
          'Después me metí en la adivinación. Pregunté a astrólogos, a lectores de BaZi, a lectores de Zi Wei. Ninguno supo responder a esa pregunta.',
          'La curiosidad me empujó a aprender astrología por mi cuenta. La aprendí usándola y, en algún punto del camino, me convertí en consejera astrológica.',
          'Cuanto más entraba, mejor entendía de dónde venía mi propia depresión. Hice las paces con una infancia pobre y desdichada.',
          'No vengo a venderte astrología. Lo que de verdad me ayudó es que me dio un punto de apoyo, un ángulo desde el que podía mirarme desde fuera. Eso es lo que significa para mí el Nodo Norte.',
          'Más adelante usé la astrología junto con la psicología para ayudar a la gente de mi entorno, y funcionó mejor de lo que esperaba. Dale a alguien un punto de apoyo y podrá mover su propia vida.',
        ],
      },
      {
        h: 'La niña de trece años',
        paras: [
          'Conocí a una niña de trece años. Sus padres llevaban años trabajando lejos de casa, ella se había quedado con unos parientes y había dejado de ir a la escuela.',
          'Quería ayudarla. Yo crecí igual que ella.',
          'No acepté el caso. Sacar a alguien de ahí exige una cantidad enorme de tiempo y de energía. Yo estaba enterrada en trabajo, tenía mis propias facturas y no podía.',
          'Aquello se me quedó dentro. La mayoría de los niños como ella no puede pagarse una consulta y, además, tampoco se atreve a abrirse delante de una persona real.',
        ],
      },
      {
        h: 'Hice una consejera de IA',
        paras: [
          'Fueron los años en que llegaron ChatGPT y Claude. Descubrí que, con un ajuste cuidadoso, una IA podía trabajar como consejera astrológica de nivel inicial o intermedio, con conocimientos de psicología y de astrología a la vez. Todo lo que había aprendido diseñando software por fin tenía adónde ir.',
          'En 2024 conocí por redes sociales a CC, que estaba haciendo tarot con IA. En 2025 me uní a su equipo y pasé un año entero afinando una IA hasta convertirla en una consejera lo bastante barata, lo bastante paciente para quedarse a largo plazo y libre de sesgos personales.',
          'La sacamos.',
          'Pero después de mirar de cerca durante un año cómo se trataban las personas y esa consejera de IA, vi otra cosa.',
          'Un futuro imaginado y bonito le da al cerebro su dopamina. Pero si nada aterriza, si nada avanza, acabas cargando agua en un cesto. El vacío que viene después duele más que antes.',
          'Así que tiene que aterrizar en algún sitio.',
        ],
        pull: 'La consulta no es la respuesta, y tampoco es el destino. Cuando alguien lleva perdido el tiempo suficiente, la consulta puede convertirse en otra droga. De esas que enganchan poco a poco.',
      },
      {
        h: 'Por qué un libro',
        paras: [
          'Me leí mucha investigación sobre tratamiento psicológico. La arteterapia y la escritura expresiva tienen un efecto claro sobre la depresión y sobre esa sensación de estar perdido. Escribir y dibujar con las manos te sacan del bucle en el que giran tus pensamientos y te devuelven al cuerpo.',
          'Dicho en claro: crear alivia el dolor y hace un trabajo real a la hora de reconstruir el sentido de uno mismo.',
          'En todas aquellas consultas vi algo más. Mucha gente sigue con una persona que no le gusta, en un trabajo que no le gusta, perdida y dolida durante años, y por debajo de todo eso no sabe quién es en realidad. Qué quiere, qué no soporta, en qué es buena, qué le importa. Nada de eso lo tiene claro.',
          'Ese saber no llega de golpe una tarde cualquiera. Necesita rondas de dar forma, de encontrar, de derribar y de volver a comprobar.',
          'Y en esto de crear algo, no se me ocurre nada más atractivo que un libro que solo te pertenece a ti.',
          'Hace visible tu vida. Y dentro de unos años lo abres y descubres que por el camino hubo muchísimos momentos que importaron. Buenos, otros que te hicieron crecer, otros que dolieron.',
          'Lo que de verdad has vivido es el fruto más valioso del árbol de tu vida.',
        ],
      },
      {
        h: 'Qué es Yujee',
        paras: [
          'En 2026 ya no pude seguir aguantándolo.',
          'Quería hacer un producto que fuera de verdad para quien lo usa. Sin juegos de retención, sin anzuelos. Un solo trabajo. Ayudar a alguien a conocerse y a guardarlo.',
          'De ahí salió Yujee. En chino significa encontrarte contigo mismo y también gobernarte a ti mismo.',
          'La forma de hacerlo es concreta. Convierte tus fotos y tus palabras dispersas en un libro que puedes abrir. Y en el acto de elegir y ordenar tu propia vida, vuelves a ver quién eres.',
          'Lo que Yujee hace hoy:',
        ],
        bullets: [
          'Ordena tus fotos automáticamente y agrupa las que se parecen',
          'Maqueta el libro por ti, sin arrastrar nada a mano',
          'Te ayuda a escribir y convierte los fragmentos en una historia que se sostiene',
          'Comparte con un clic, para que lo lea la gente que te importa',
        ],
      },
      {
        h: 'Hecho por una sola persona',
        paras: [
          'Yujee lo construí yo sola, aprendiendo y publicando a la vez. La arquitectura de sistemas que aprendí hace años haciendo integración todavía aguanta. Pregúntame otra vez más adelante.',
          'Durante dos meses apenas dormí y saqué la primera demo que me pareció utilizable. En julio, 20 usuarios pioneros me mandaron sus comentarios, y seguí.',
          'Hacerlo todo sola no es fácil, y hay bastantes cosas que aún están sin pulir. Algunas son porque no me da para más. Otras simplemente no les ha llegado el turno. Pero quería hacer bien esta cosa, y lo quería con muchas ganas.',
          'Lo que Yujee es hoy sigue siendo una versión muy pequeña. Puede que no te cambie nada de inmediato. Aun así quiero poner esta terquedad dentro.',
          `Si algo te chirría al usarlo, o hay algo que te gustaría que hiciera, dímelo en el Discord. También puedes escribirme a ${SUPPORT_EMAIL} o mandarme un mensaje por X. Lo leo todo.`,
        ],
      },
    ],
    closing: 'Y ojalá tú también llegues a sostener tu propio árbol de la vida, y a encontrar el yo que vive más adentro.',
    dateline: 'yvaine, 31 de julio de 2026',
    byline: { author: 'yvaine', date: '31 de julio de 2026', readingTime: '8 min de lectura' },
    tocHead: 'Índice',
    ctaLabel: 'Empieza tu propio libro',
    disclaimer:
      'Yujee no es un producto médico y no sustituye a la terapia. Si ahora mismo estás en peligro, contacta antes con un médico o con una línea de ayuda.',
  },
  examples: {
    metaTitle: 'Ejemplos de fotolibros y memorias — Hechos con Yujee AI',
    metaDesc:
      'Formatos reales que puedes hacer con Yujee: diarios de viaje, historias de vida y mucho más. La IA agrupa, escribe los pies de foto y maqueta cada uno a partir de un montón de fotos, y después lo exportas en PDF listo para imprimir.',
    kicker: 'Ejemplos',
    hubTitle: 'Ejemplos',
    hubIntro:
      'Formatos reales que puedes hacer con Yujee. Cada uno empezó como un montón de fotos y unas pocas palabras: la IA los agrupó, redactó los pies de foto y maquetó todas las páginas dobles. Abre uno para ver cómo va y luego haz el tuyo.',
    moreComing: 'Ya vienen más formatos: mascotas, bodas e historias de amor.',
    insideHead: 'Qué hay dentro',
    madeWithHead: 'Hecho con',
    galleryHead: 'Por dentro',
    flipThrough: 'Hojear',
    makeSame: 'Hacer uno así',
    breadcrumbHome: 'Inicio',
    breadcrumbExamples: 'Ejemplos',
    openLabel: 'Ver el ejemplo',
  },
  guides: {
    metaTitle: 'Guías de fotolibros — Cómo hacer uno | Yujee',
    metaDesc:
      'Guías prácticas para hacer un fotolibro o unas memorias: digitalizar copias antiguas, elegir qué fotos entran, escribir los pies y obtener un archivo listo para imprenta.',
    hubTitle: 'Guías',
    hubIntro:
      'Cómo sacar las fotos de la caja y convertirlas en algo que merezca la pena guardar. Pasos prácticos, escritos para quien lo hace por primera vez.',
    breadcrumbHome: 'Inicio',
    breadcrumbGuides: 'Guías',
    readLabel: 'Leer la guía',
    updatedLabel: 'Actualizado',
    englishOnlyNote: 'Esta guía solo está disponible en inglés por ahora.',
    faqHead: 'Preguntas frecuentes',
    relatedHead: 'Sigue leyendo',
    ctaHead: 'Deja la maquetación a Yujee',
    ctaBody:
      'Sube tus fotos, cuenta qué estaba pasando y recibe un PDF listo para imprenta con las páginas maquetadas y los pies redactados para que los corrijas.',
    ctaButton: 'Empezar gratis',
  },
  pricingPage: {
    metaTitle: 'Precios — Cuánto cuesta un fotolibro con IA | Yujee',
    metaDesc:
      'Un crédito es una foto. Se compran una vez, sin suscripción y sin caducidad. Cuánto cuesta un libro real, qué pasa si falla la generación y qué añade la impresión.',
    title: 'Lo que cuesta de verdad un fotolibro',
    lede:
      'Un crédito es {photos} foto. No hay suscripción ni nada que se renueve: compras un paquete de créditos una vez y los gastas cuando haces un libro.',
    freeLine: 'Al registrarte recibes {credits} créditos gratis. Da para un primer libro entero.',
    packsHead: 'Paquetes de créditos',
    packsCreditsLabel: 'créditos',
    packsPerPhoto: 'por foto',
    workedHead: 'Qué significa eso en un libro real',
    worked: [
      {
        h: 'Un viaje de fin de semana',
        body: 'Unas 24 fotos. Los créditos gratis cubren la mayor parte y el paquete de {packSmall} lo termina con margen de sobra.',
      },
      {
        h: 'Un año en un libro',
        body: 'Unas 60 fotos para el año entero. El paquete de {packMid} lo cubre y deja suficiente para un segundo libro corto.',
      },
      {
        h: 'La vida de un padre o una madre',
        body: 'Unas 90 fotos repartidas por décadas, cerca del límite por libro. El paquete de {packLarge} lo cubre y deja más de la mitad de los créditos sin gastar.',
      },
    ],
    capLine:
      'Un libro admite hasta {max} fotos. A partir de ahí, hazlo en dos volúmenes: se lee mejor y no se pierde nada.',
    includedHead: 'Qué compran los créditos',
    included: [
      'Un PDF listo para imprenta a 300 DPI, sin marca de agua y tuyo para siempre',
      'Maquetación con más de 40 plantillas de revista: nunca arrastras una foto a un hueco',
      'Pies de foto y texto de capítulo redactados a partir de tus fotos y notas, y luego editados conversando',
      'Tus fotos originales no salen del navegador; a la IA solo van vistas previas comprimidas',
    ],
    notIncludedHead: 'Qué no compran: la impresión',
    notIncludedBody:
      'Recibes un archivo, no un paquete. La impresión va aparte y la contratas donde quieras: una tapa dura estándar ronda los 20 a 70 dólares según páginas, papel y encuadernación. Lo desglosamos entero aquí:',
    notIncludedLink: '¿Cuánto cuesta imprimir un fotolibro?',
    failureHead: 'Si la generación falla, no se te cobra',
    failureBody:
      'Los créditos se retienen al empezar la maquetación y solo se descuentan si termina bien. Si falla, la retención se libera y los créditos vuelven a tu saldo.',
    refundHead: 'Reembolsos',
    refundBody:
      'Los paquetes de créditos son una compra única de un producto digital y no son reembolsables, salvo donde la ley obligue a lo contrario. Los créditos ya gastados en un libro que salió bien no se devuelven, ni siquiera si el resultado no te convence. Si pagaste a través de una pasarela de pago, también se aplican sus propias normas de reembolso.',
    noExpiryHead: 'Sin suscripción, sin caducidad',
    noExpiryBody:
      'No se renueva nada ni se vuelve a cobrar. Los créditos se quedan en tu cuenta hasta que los uses: por ahora no tienen fecha de caducidad.',
    faqHead: 'Preguntas frecuentes',
    faq: [
      {
        q: '¿Hay una versión gratuita?',
        a: 'Sí. Al registrarte recibes créditos suficientes para un primer libro completo y puedes exportar el PDF listo para imprenta. No hay reloj de prueba ni hace falta tarjeta.',
      },
      {
        q: '¿Cuántos créditos cuesta un libro?',
        a: 'Exactamente tantos como fotos tenga: un crédito cubre {photos} foto. Un libro de 30 fotos cuesta 30 créditos. El número de páginas lo decide la maquetación; con pocas fotos suele quedar en torno a {pages} páginas.',
      },
      {
        q: '¿Pago otra vez por reexportar o editar?',
        a: 'No. Los créditos se cobran una sola vez, cuando la maquetación termina bien. Editar el libro conversando, reexportar el PDF y volver a descargarlo no cuesta nada.',
      },
      {
        q: '¿Puedo imprimir el PDF donde quiera?',
        a: 'Sí. Es un PDF estándar a 300 DPI, sin marca de agua y sin ataduras: llévalo a cualquier imprenta o servicio online, o quédatelo en digital.',
      },
      {
        q: '¿Qué pasa con mis créditos si dejo de usar Yujee?',
        a: 'Se quedan en tu cuenta. Por ahora no caducan y no hay ninguna suscripción que cancelar.',
      },
    ],
    ctaHead: 'Empieza con los créditos gratis',
    ctaBody: 'Sube una carpeta de fotos y mira el libro ya maquetado antes de decidir si compras algo.',
    ctaButton: 'Hacer un libro',
    buyLink: 'Comprar créditos',
  },
  footer: {
    tagline: 'Convierte las fotos dispersas en una revista que merece guardarse.',
    groups: [
      {
        head: 'Producto',
        items: [
          { label: 'Crear un fotolibro', href: '#homepage-composer' },
          { label: 'Cómo funciona', href: '#features' },
          { label: 'Qué te llevas', href: '#outputs' },
          { label: 'Precios', href: '/pricing' },
        ],
      },
      {
        head: 'Fotolibros',
        items: [
          { label: 'Ejemplo de fotolibro de viaje', href: '/examples/travel-journal' },
          { label: 'Ejemplo de libro de historia de vida', href: '/examples/life-story' },
          { label: 'Todos los ejemplos de memorias', href: '/examples' },
          { label: 'Guías de fotolibros', href: '/guides' },
        ],
      },
      {
        head: 'Soporte',
        items: [
          { label: 'Preguntas frecuentes', href: '#faq' },
          { label: 'Contacto', href: `mailto:${SUPPORT_EMAIL}` },
        ],
      },
      {
        head: 'Sobre nosotros',
        items: [{ label: 'Nuestra historia', href: '/about/story' }],
      },
      {
        head: 'Legal',
        items: [
          { label: 'Privacidad', href: '/privacy' },
          { label: 'Términos', href: '/terms' },
        ],
      },
    ],
    copy: '© 2026 Yujee. Todos los derechos reservados.',
  },
};
