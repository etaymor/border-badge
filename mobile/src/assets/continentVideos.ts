/* eslint-disable @typescript-eslint/no-require-imports */

type ContinentKey = 'Africa' | 'Americas' | 'Asia' | 'Europe' | 'Oceania';

const continentVideos: Record<ContinentKey, number> = {
  Africa: require('../../assets/country-images/continents/africa.mp4'),
  Americas: require('../../assets/country-images/continents/north-america.mp4'),
  Asia: require('../../assets/country-images/continents/asia.mp4'),
  Europe: require('../../assets/country-images/continents/europe.mp4'),
  Oceania: require('../../assets/country-images/continents/oceania.mp4'),
};

const DEFAULT_CONTINENT_KEY: ContinentKey = 'Africa';
export const DEFAULT_CONTINENT_VIDEO = continentVideos[DEFAULT_CONTINENT_KEY];

export function getContinentVideo(region: string): number | null {
  const video = continentVideos[region as ContinentKey];
  return video ?? null;
}
