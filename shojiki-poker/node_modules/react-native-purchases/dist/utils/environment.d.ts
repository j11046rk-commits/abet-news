/**
 * Detects if the app is running in an environment where native modules are not available
 * (like Expo Go) or if the required native modules are missing.
 *
 * @returns {boolean} True if the app is running in an environment where native modules are not available
 * (like Expo Go) or if the required native modules are missing.
 */
export declare function shouldUsePreviewAPIMode(): boolean;
declare global {
    var expo: {
        modules?: {
            ExpoGo?: boolean;
        };
    };
}
