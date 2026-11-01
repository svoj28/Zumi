import { ReferenceLibraryScreen } from '@/features/references/ReferenceLibraryScreen';
import { ThemeBoundary } from '@/ui/ThemeBoundary';

export default function ReferencesRoute() {
  return (
    <ThemeBoundary>
      <ReferenceLibraryScreen />
    </ThemeBoundary>
  );
}
