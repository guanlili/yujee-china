/** Transactional email copy, one file per locale under ./ — see ./index.ts. */
export interface EmailCopy {
  verification: {
    subject: string;
    title: string;
    greeting: (name: string) => string;
    body: string;
    button: string;
    validity: string;
    fallback: string;
    ignore: string;
  };
  order: {
    subject: string;
    title: string;
    body: string;
    orderId: string;
    amount: string;
    album: string;
    button: string;
    footer: string;
  };
}
