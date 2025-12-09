/* eslint-disable @typescript-eslint/no-require-imports */

const continentVideos: Record<string, number> = {
  Africa: require('../../assets/country-images/continents/africa.mp4'),
  Americas: require('../../assets/country-images/continents/north-america.mp4'),
  Asia: require('../../assets/country-images/continents/asia.mp4'),
  Europe: require('../../assets/country-images/continents/europe.mp4'),
  Oceania: require('../../assets/country-images/continents/oceania.mp4'),
};

export function getContinentVideo(region: string): number | null {
  return continentVideos[region] || null;
}
