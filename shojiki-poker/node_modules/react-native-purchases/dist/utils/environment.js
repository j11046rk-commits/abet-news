"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldUsePreviewAPIMode = void 0;
var react_native_1 = require("react-native");
/**
 * Detects if the app is running in an environment where native modules are not available
 * (like Expo Go) or if the required native modules are missing.
 *
 * @returns {boolean} True if the app is running in an environment where native modules are not available
 * (like Expo Go) or if the required native modules are missing.
 */
function shouldUsePreviewAPIMode() {
    var usePreviewAPIMode = isExpoGo();
    if (usePreviewAPIMode) {
        console.log('Expo Go app detected. Using RevenueCat in Preview API Mode.');
    }
    return usePreviewAPIMode;
}
exports.shouldUsePreviewAPIMode = shouldUsePreviewAPIMode;
/**
 * Detects if the app is running in Expo Go
 */
function isExpoGo() {
    var _a, _b;
    if (!!react_native_1.NativeModules.RNPurchases) {
        return false;
    }
    return !!((_b = (_a = globalThis.expo) === null || _a === void 0 ? void 0 : _a.modules) === null || _b === void 0 ? void 0 : _b.ExpoGo);
}
