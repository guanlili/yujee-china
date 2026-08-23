import type { EmailCopy } from './types';

export const es: EmailCopy = {
  verification: {
    subject: 'Verifica tu correo de Yujee',
    title: 'Verifica tu correo',
    greeting: (name: string) => `Hola ${name}:`,
    body: 'Te damos la bienvenida a Yujee. Confirma tu dirección de correo para terminar de configurar tu cuenta.',
    button: 'Verificar el correo',
    validity: 'Este enlace caduca pronto y solo se puede usar una vez.',
    fallback: 'Si el botón no funciona, pega este enlace en tu navegador:',
    ignore: 'Si no creaste ninguna cuenta de Yujee, puedes ignorar este correo.',
  },
  passwordReset: {
    subject: 'Restablece tu contraseña de Yujee',
    title: 'Restablece tu contraseña',
    greeting: (name: string) => `Hola ${name}:`,
    body: 'Hemos recibido una solicitud para establecer una nueva contraseña en tu cuenta de Yujee. Usa el botón de abajo para elegirla.',
    button: 'Establecer una contraseña nueva',
    validity: 'Este enlace caduca en una hora y solo se puede usar una vez.',
    fallback: 'Si el botón no funciona, pega este enlace en tu navegador:',
    ignore: 'Si no pediste restablecer la contraseña, puedes ignorar este correo: tu contraseña seguirá igual.',
  },
  order: {
    subject: 'Confirmación de tu pedido de Yujee',
    title: 'Pedido confirmado',
    body: 'Tu pedido de Yujee está pagado y listo.',
    orderId: 'Número de pedido',
    amount: 'Importe',
    album: 'Álbum',
    button: 'Ver el álbum',
    footer: 'Guarda este correo como recibo.',
  },
};
