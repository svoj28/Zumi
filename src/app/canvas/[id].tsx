import { useLocalSearchParams } from 'expo-router';

import { EditorScreen } from '@/features/editor/EditorScreen';
import { ThemeBoundary } from '@/ui/ThemeBoundary';

export default function CanvasRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Keyed so switching projects fully remounts the editor (and its native resources).
  return (
    <ThemeBoundary>
      <EditorScreen key={id} projectId={id} />
    </ThemeBoundary>
  );
}
