import { GalleryScreen } from '@/features/gallery/GalleryScreen';
import { ThemeBoundary } from '@/ui/ThemeBoundary';

export default function Index() {
  return (
    <ThemeBoundary>
      <GalleryScreen />
    </ThemeBoundary>
  );
}
