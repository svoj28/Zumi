import type { ZumiVideoEncoderNative } from './ZumiVideoEncoder.types';

// Video encoding is not available on the web.
const ZumiVideoEncoder: ZumiVideoEncoderNative | null = null;
export default ZumiVideoEncoder;
