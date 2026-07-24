#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTCallInvokerModule.h>

/**
 * Installs the CrossNative JSI proxy.
 *
 * The module exists only to reach the JavaScript runtime. Everything else lives
 * in the shared C++ core, so there is no Objective-C surface beyond `install`.
 *
 * Native modules are created lazily, so JavaScript calls `install()` once at
 * startup rather than relying on when this module happens to be constructed.
 */
@interface CrossNativeModule : NSObject <RCTBridgeModule, RCTCallInvokerModule>
@end
