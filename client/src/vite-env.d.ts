/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TIME: string
}

/** 马良 Drop P1：原生分片完成后回调（交付说明 §六） */
interface Window {
  dropFileChunkComplete?: (payload: unknown) => void
  __dropFileChunkComplete?: (payload: unknown) => void
}
