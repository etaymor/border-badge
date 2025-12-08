import { getContinentVideo } from '../../assets/continentVideos';

describe('continentVideos', () => {
  describe('getContinentVideo', () => {
    it('returns video for Africa', () => {
      const video = getContinentVideo('Africa');
      expect(video).not.toBeNull();
    });

    it('returns video for Americas', () => {
      const video = getContinentVideo('Americas');
      expect(video).not.toBeNull();
    });

    it('returns video for Asia', () => {
      const video = getContinentVideo('Asia');
      expect(video).not.toBeNull();
    });

    it('returns video for Europe', () => {
      const video = getContinentVideo('Europe');
      expect(video).not.toBeNull();
    });

    it('returns video for Oceania', () => {
      const video = getContinentVideo('Oceania');
      expect(video).not.toBeNull();
    });

    it('returns null for Antarctica (no video available)', () => {
      const video = getContinentVideo('Antarctica');
      expect(video).toBeNull();
    });

    it('returns null for invalid region', () => {
      const video = getContinentVideo('InvalidRegion');
      expect(video).toBeNull();
    });

    it('returns null for empty string', () => {
      const video = getContinentVideo('');
      expect(video).toBeNull();
    });

    it('is case sensitive (lowercase returns null)', () => {
      const video = getContinentVideo('africa');
      expect(video).toBeNull();
    });
  });
});
