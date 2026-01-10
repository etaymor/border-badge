/**
 * SharedGroupPreferences - Objective-C Bridge
 *
 * This file exports the SharedGroupPreferences Swift class to React Native.
 */

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SharedGroupPreferences, NSObject)

RCT_EXTERN_METHOD(getItem:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setItem:(NSString *)key
                  value:(NSString *)value
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getTimestamp:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearAll:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getOfflineQueue:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearOfflineQueue:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
