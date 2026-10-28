import { ICP_BEIAN_MIIT_URL, ICP_BEIAN_NUMBER } from '@/config/beian';

type Props = {
  className?: string;
};

/** Site chrome footer: ICP filing number for outman.press (all locales). */
export function IcpBeianLink({ className }: Props) {
  return (
    <a
      href={ICP_BEIAN_MIIT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {ICP_BEIAN_NUMBER}
    </a>
  );
}
