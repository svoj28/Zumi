/**
 * Turns thrown errors into messages people can act on. Zumi's own errors already carry a
 * user-facing sentence; native file-system and graphics failures do not ("Calling the 'write'
 * function has failed…"), so those are recognised by their text (including nested causes) and
 * replaced with a plain explanation. Every result carries a recovery step, so no failure is
 * reported without saying what to do next.
 */

export type ErrorKind =
  | 'storage-full'
  | 'permission'
  | 'out-of-memory'
  | 'unsupported-image'
  | 'damaged'
  | 'unknown';

export interface UserFacingError {
  kind: ErrorKind;
  title: string;
  message: string;
  /** What to do next. */
  recovery: string;
}

const PATTERNS: readonly [ErrorKind, RegExp][] = [
  ['storage-full', /ENOSPC|no space left|out of space|disk (is )?full|storage (is )?full|NSFileWriteOutOfSpace|insufficient storage/i],
  ['permission', /EACCES|EPERM|permission|not authori[sz]ed|access (is )?denied/i],
  ['out-of-memory', /out of memory|unable to allocate|not enough memory|OutOfMemory/i],
  ['unsupported-image', /format is not supported|unsupported image|could not decode|cannot decode/i],
  ['damaged', /damaged|corrupt|not a valid|incomplete|cannot be read|could not be read|unexpected end/i],
];

const DETAILS: Record<Exclude<ErrorKind, 'unknown'>, Omit<UserFacingError, 'kind'>> = {
  'storage-full': {
    title: 'Storage is full',
    message: 'There is not enough free space on this device to finish.',
    recovery: 'Free up space (for example by emptying Recently Deleted), then try again. Your artwork stays open and is saved once there is room.',
  },
  permission: {
    title: 'Permission needed',
    message: 'Zumi was not allowed to access the files or photos it needs.',
    recovery: 'Allow access for Zumi in your device settings, then try again.',
  },
  'out-of-memory': {
    title: 'Not enough memory',
    message: 'This device ran out of memory for the canvas.',
    recovery: 'Close other apps, merge or delete some layers, or use a smaller canvas size, then try again.',
  },
  'unsupported-image': {
    title: 'Unsupported image',
    message: 'This image format could not be read.',
    recovery: 'Choose a PNG, JPEG or WebP image instead.',
  },
  damaged: {
    title: 'File is damaged',
    message: 'The file could not be read completely.',
    recovery: 'If you have a backup of this artwork, restore it from the gallery menu.',
  },
};

/** The error's message plus those of its causes, so wrapped native errors can be recognised. */
function messageChain(error: unknown): string[] {
  const out: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (current instanceof Error) {
      out.push(current.message);
      current = current.cause;
    } else {
      out.push(String(current));
      break;
    }
  }
  return out;
}

export function classifyError(error: unknown): ErrorKind {
  const text = messageChain(error).join('\n');
  return PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'unknown';
}

/**
 * Describes a failure for the user. `fallbackTitle` names the action that failed ("Export
 * failed"); it is used when the kind of failure does not have a more specific title.
 */
export function describeError(error: unknown, fallbackTitle = 'Something went wrong'): UserFacingError {
  const kind = classifyError(error);
  const original = messageChain(error)[0]?.trim() ?? '';
  if (kind === 'unknown') {
    return {
      kind,
      title: fallbackTitle,
      message: original || 'An unexpected error occurred.',
      recovery: 'Try again. Artwork that was already saved is kept on this device.',
    };
  }
  const details = DETAILS[kind];
  // Zumi's own messages are specific ("layer “Sky” cannot be read"); keep them over the generic text.
  const ownMessage = /^[A-Z][^\n]{8,200}[.!]$/.test(original) && !/function has failed/i.test(original);
  return { kind, ...details, message: ownMessage ? original : details.message };
}

/** Message and recovery step as one block of text, for alerts. */
export function errorText(error: UserFacingError): string {
  return `${error.message}\n\n${error.recovery}`;
}
