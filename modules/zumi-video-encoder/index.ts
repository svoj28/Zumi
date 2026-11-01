// Re-export the native module. On web, it will be resolved to ZumiVideoEncoderModule.web.ts
// and on native platforms to ZumiVideoEncoderModule.ts
export { default } from './src/ZumiVideoEncoderModule';
export * from './src/ZumiVideoEncoder.types';
