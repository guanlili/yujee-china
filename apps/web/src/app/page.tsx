import { loadDesignPage } from './_design-page/load-design-page';
import { DesignPageMount } from './_design-page/DesignPageMount';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const { style, body, scripts } = loadDesignPage('design-v1/yujee-home2.html');
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: style }} />
      <DesignPageMount body={body} scripts={scripts} />
    </>
  );
}
