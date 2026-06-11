// ─────────────────────────────────────────────────────────────────────────────
// Login-free preview of the faithful 1:1 port of the editor design
// (/Users/smalldog/Desktop/yujee-editor/editor.html).
//
// Phase A — static, demo-driven: <EditorPort> transcribes the design's <body>
// markup + <style> + <script> verbatim (see EditorPort.tsx / editor-port.css),
// using the design's hard-coded sample chapters/photos. No backend, no real
// album, no session — open /<locale>/editor-preview to compare against the
// original editor.html side-by-side.
//
// Phase B (later) will wire this surface to real album_pages / chat / export.
// Nothing here touches the protected /album route, middleware, backend, or
// contracts. The old <AlbumEditor> mock preview is preserved untouched under
// src/components/album/ and is simply no longer mounted by this route.
// ─────────────────────────────────────────────────────────────────────────────

import { EditorPort } from '@/components/album/editor-v2/EditorPort';

export default function EditorPreviewPage() {
  return <EditorPort />;
}
