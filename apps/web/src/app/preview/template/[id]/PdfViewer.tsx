'use client';

import { Document, PDFViewer } from '@react-pdf/renderer';
import { TEMPLATE_REGISTRY } from '@/components/album/templates/registry';
import type { TemplateData } from '@/components/album/templates/types';

interface Props {
  templateId: string;
  data: TemplateData;
}

export function PdfViewer({ templateId, data }: Props) {
  const entry = TEMPLATE_REGISTRY[templateId];
  if (!entry) return null;
  const { PdfTemplate } = entry;
  return (
    <PDFViewer width={900} height={1100} showToolbar style={{ border: 'none' }}>
      <Document>
        <PdfTemplate data={data} totalPages={30} />
      </Document>
    </PDFViewer>
  );
}
