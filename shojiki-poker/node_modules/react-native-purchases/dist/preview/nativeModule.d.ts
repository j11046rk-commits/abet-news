import { CustomerInfo, INTRO_ELIGIBILITY_STATUS, MakePurchaseResult, PurchasesStoreTransaction, WebPurchaseRedemptionResultType, PurchasesStoreProduct, PurchasesOffering, PurchasesOfferings } from '@revenuecat/purchases-typescript-internal';
/**
 * Preview implementation of the native module for Preview API mode, i.e. for environments where native modules are not available
 * (like Expo Go).
 */
export declare const previewNativeModuleRNPurchases: {
    setupPurchases: () => Promise<null>;
    setAllowSharingStoreAccount: () => Promise<null>;
    setSimulatesAskToBuyInSandbox: () => Promise<null>;
    getOfferings: () => Promise<PurchasesOfferings>;
    getCurrentOfferingForPlacement: () => Promise<PurchasesOffering>;
    syncAttributesAndOfferingsIfNeeded: () => Promise<PurchasesOfferings>;
    getProductInfo: () => Promise<PurchasesStoreProduct[]>;
    restorePurchases: () => Promise<CustomerInfo>;
    getAppUserID: () => Promise<string>;
    getStorefront: () => Promise<string>;
    setDebugLogsEnabled: () => Promise<null>;
    setLogLevel: () => Promise<null>;
    setLogHandler: () => Promise<null>;
    getCustomerInfo: () => Promise<CustomerInfo>;
    logIn: () => Promise<{
        customerInfo: CustomerInfo;
        created: boolean;
    }>;
    logOut: () => Promise<CustomerInfo>;
    syncPurchases: () => Promise<void>;
    syncAmazonPurchase: () => Promise<void>;
    syncObserverModeAmazonPurchase: () => Promise<void>;
    recordPurchaseForProductID: () => Promise<PurchasesStoreTransaction>;
    enableAdServicesAttributionTokenCollection: () => Promise<void>;
    purchaseProduct: () => Promise<MakePurchaseResult>;
    purchasePackage: () => Promise<MakePurchaseResult>;
    purchaseSubscriptionOption: () => Promise<void>;
    isAnonymous: () => Promise<boolean>;
    makeDeferredPurchase: () => Promise<null>;
    checkTrialOrIntroductoryPriceEligibility: () => Promise<{
        'preview-product-id': INTRO_ELIGIBILITY_STATUS;
    }>;
    getPromotionalOffer: () => Promise<undefined>;
    eligibleWinBackOffersForProductIdentifier: () => Promise<never[]>;
    purchaseProductWithWinBackOffer: () => Promise<MakePurchaseResult>;
    purchasePackageWithWinBackOffer: () => Promise<MakePurchaseResult>;
    invalidateCustomerInfoCache: () => Promise<void>;
    presentCodeRedemptionSheet: () => Promise<void>;
    setAttributes: () => Promise<void>;
    setEmail: () => Promise<void>;
    setPhoneNumber: () => Promise<void>;
    setDisplayName: () => Promise<void>;
    setPushToken: () => Promise<void>;
    setProxyURLString: () => Promise<void>;
    collectDeviceIdentifiers: () => Promise<void>;
    setAdjustID: () => Promise<void>;
    setAppsflyerID: () => Promise<void>;
    setFBAnonymousID: () => Promise<void>;
    setMparticleID: () => Promise<void>;
    setCleverTapID: () => Promise<void>;
    setMixpanelDistinctID: () => Promise<void>;
    setFirebaseAppInstanceID: () => Promise<void>;
    setTenjinAnalyticsInstallationID: () => Promise<void>;
    setKochavaDeviceID: () => Promise<void>;
    setOnesignalID: () => Promise<void>;
    setAirshipChannelID: () => Promise<void>;
    setMediaSource: () => Promise<void>;
    setMediaCampaign: () => Promise<void>;
    setCampaign: () => Promise<void>;
    setAdGroup: () => Promise<void>;
    setAd: () => Promise<void>;
    setKeyword: () => Promise<void>;
    setCreative: () => Promise<void>;
    canMakePayments: () => Promise<boolean>;
    beginRefundRequestForActiveEntitlement: () => Promise<number>;
    beginRefundRequestForEntitlementId: () => Promise<number>;
    beginRefundRequestForProductId: () => Promise<number>;
    showManageSubscriptions: () => Promise<void>;
    showInAppMessages: () => Promise<void>;
    isWebPurchaseRedemptionURL: () => Promise<null>;
    isConfigured: () => Promise<boolean>;
    redeemWebPurchase: () => Promise<{
        result: WebPurchaseRedemptionResultType;
        customerInfo: CustomerInfo;
    }>;
};
