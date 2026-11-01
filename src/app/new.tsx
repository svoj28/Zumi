import { useLocalSearchParams } from 'expo-router';

import { NewCanvasScreen } from '@/features/new-canvas/NewCanvasScreen';
import { ThemeBoundary } from '@/ui/ThemeBoundary';

export default function NewArtworkRoute() {
  const { folderId } = useLocalSearchParams<{ folderId?: string }>();
  return (
    <ThemeBoundary>
      <NewCanvasScreen folderId={folderId || null} />
    </ThemeBoundary>
  );
}
