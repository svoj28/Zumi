import { requireOptionalNativeModule } from 'expo';

import type { ZumiVideoEncoderNative } from './ZumiVideoEncoder.types';

/** Null when the running app was built without this module (e.g. Expo Go). */
export default requireOptionalNativeModule<ZumiVideoEncoderNative>('ZumiVideoEncoder');
