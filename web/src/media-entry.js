// Bündelt mediabunny samt Encoder-Ergänzungen (AAC/MP3/FLAC für Browser ohne eigene Encoder) zu vendor/media.js
export * from 'mediabunny';
export { registerAacEncoder } from '@mediabunny/aac-encoder';
export { registerMp3Encoder } from '@mediabunny/mp3-encoder';
export { registerFlacEncoder } from '@mediabunny/flac-encoder';
