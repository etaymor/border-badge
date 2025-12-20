import { Share as RNShare, ShareContent, ShareOptions, ShareAction } from 'react-native';

/**
 * Wrapper around React Native's Share to facilitate testing.
 * Mocking react-native's Share directly is difficult with jest-expo.
 */
export const Share = {
  share: (content: ShareContent, options?: ShareOptions): Promise<ShareAction> => {
    return RNShare.share(content, options);
  },
};
