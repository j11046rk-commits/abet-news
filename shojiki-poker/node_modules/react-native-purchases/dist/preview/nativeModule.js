"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewNativeModuleRNPurchases = void 0;
var purchases_typescript_internal_1 = require("@revenuecat/purchases-typescript-internal");
var previewCustomerInfo = {
    activeSubscriptions: [],
    allExpirationDates: {},
    allPurchaseDates: {},
    allPurchasedProductIdentifiers: [],
    entitlements: {
        active: {},
        all: {},
        verification: purchases_typescript_internal_1.VERIFICATION_RESULT.NOT_REQUESTED
    },
    firstSeen: new Date().toISOString(),
    latestExpirationDate: null,
    originalAppUserId: 'preview-user-id',
    originalApplicationVersion: null,
    requestDate: new Date().toISOString(),
    managementURL: null,
    originalPurchaseDate: new Date().toISOString(),
    nonSubscriptionTransactions: [],
    subscriptionsByProductIdentifier: {}
};
var previewPurchaseStoreTransaction = {
    transactionIdentifier: 'preview-transaction-id',
    productIdentifier: 'preview-product-id',
    purchaseDate: new Date().toISOString()
};
var previewMakePurchaseResult = {
    productIdentifier: 'preview-product-id',
    customerInfo: previewCustomerInfo,
    transaction: previewPurchaseStoreTransaction
};
var previewStoreProduct = {
    identifier: 'preview-product-id',
    description: 'Preview product description',
    title: 'Preview Product',
    price: 9.99,
    priceString: '$9.99',
    pricePerWeek: 2.50,
    pricePerMonth: 9.99,
    pricePerYear: 99.99,
    pricePerWeekString: '$2.50',
    pricePerMonthString: '$9.99',
    pricePerYearString: '$99.99',
    currencyCode: 'USD',
    introPrice: null,
    discounts: null,
    subscriptionPeriod: 'P1M',
    productCategory: purchases_typescript_internal_1.PRODUCT_CATEGORY.SUBSCRIPTION,
    productType: purchases_typescript_internal_1.PRODUCT_TYPE.AUTO_RENEWABLE_SUBSCRIPTION,
    defaultOption: null,
    subscriptionOptions: null,
    presentedOfferingIdentifier: 'preview-offering',
    presentedOfferingContext: {
        offeringIdentifier: 'preview-offering',
        placementIdentifier: 'preview-placement',
        targetingContext: null
    }
};
var previewPackage = {
    identifier: 'preview-package-id',
    packageType: purchases_typescript_internal_1.PACKAGE_TYPE.MONTHLY,
    product: previewStoreProduct,
    offeringIdentifier: 'preview-offering',
    presentedOfferingContext: {
        offeringIdentifier: 'preview-offering',
        placementIdentifier: 'preview-placement',
        targetingContext: null
    }
};
var previewOffering = {
    identifier: 'preview-offering',
    serverDescription: 'Preview offering for testing',
    metadata: {},
    availablePackages: [previewPackage],
    lifetime: null,
    annual: null,
    sixMonth: null,
    threeMonth: null,
    twoMonth: null,
    monthly: previewPackage,
    weekly: null
};
var previewOfferings = {
    all: {
        'preview-offering': previewOffering
    },
    current: previewOffering
};
/**
 * Preview implementation of the native module for Preview API mode, i.e. for environments where native modules are not available
 * (like Expo Go).
 */
exports.previewNativeModuleRNPurchases = {
    setupPurchases: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, null];
        });
    }); },
    setAllowSharingStoreAccount: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, null];
        });
    }); },
    setSimulatesAskToBuyInSandbox: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, null];
        });
    }); },
    getOfferings: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewOfferings];
        });
    }); },
    getCurrentOfferingForPlacement: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewOffering];
        });
    }); },
    syncAttributesAndOfferingsIfNeeded: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewOfferings];
        });
    }); },
    getProductInfo: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, [previewStoreProduct]];
        });
    }); },
    restorePurchases: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewCustomerInfo];
        });
    }); },
    getAppUserID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, 'preview-user-id'];
        });
    }); },
    getStorefront: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, 'preview-storefront'];
        });
    }); },
    setDebugLogsEnabled: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, null];
        });
    }); },
    setLogLevel: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, null];
        });
    }); },
    setLogHandler: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, null];
        });
    }); },
    getCustomerInfo: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewCustomerInfo];
        });
    }); },
    logIn: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, {
                    customerInfo: previewCustomerInfo,
                    created: false
                }];
        });
    }); },
    logOut: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewCustomerInfo];
        });
    }); },
    syncPurchases: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    syncAmazonPurchase: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    syncObserverModeAmazonPurchase: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    recordPurchaseForProductID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewPurchaseStoreTransaction];
        });
    }); },
    enableAdServicesAttributionTokenCollection: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    purchaseProduct: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewMakePurchaseResult];
        });
    }); },
    purchasePackage: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewMakePurchaseResult];
        });
    }); },
    purchaseSubscriptionOption: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    isAnonymous: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, true];
        });
    }); },
    makeDeferredPurchase: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, null];
        });
    }); },
    checkTrialOrIntroductoryPriceEligibility: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, ({
                    'preview-product-id': purchases_typescript_internal_1.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE
                })];
        });
    }); },
    getPromotionalOffer: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, undefined];
        });
    }); },
    eligibleWinBackOffersForProductIdentifier: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, []];
        });
    }); },
    purchaseProductWithWinBackOffer: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewMakePurchaseResult];
        });
    }); },
    purchasePackageWithWinBackOffer: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, previewMakePurchaseResult];
        });
    }); },
    invalidateCustomerInfoCache: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    presentCodeRedemptionSheet: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setAttributes: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setEmail: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setPhoneNumber: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setDisplayName: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setPushToken: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setProxyURLString: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    collectDeviceIdentifiers: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setAdjustID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setAppsflyerID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setFBAnonymousID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setMparticleID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setCleverTapID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setMixpanelDistinctID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setFirebaseAppInstanceID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setTenjinAnalyticsInstallationID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setKochavaDeviceID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setOnesignalID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setAirshipChannelID: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setMediaSource: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setMediaCampaign: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setCampaign: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setAdGroup: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setAd: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setKeyword: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    setCreative: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    canMakePayments: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, false];
        });
    }); },
    beginRefundRequestForActiveEntitlement: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, 0];
        });
    }); },
    beginRefundRequestForEntitlementId: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, 0];
        });
    }); },
    beginRefundRequestForProductId: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, 0];
        });
    }); },
    showManageSubscriptions: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    showInAppMessages: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/];
        });
    }); },
    isWebPurchaseRedemptionURL: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, null];
        });
    }); },
    isConfigured: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, true];
        });
    }); },
    redeemWebPurchase: function () { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, {
                    result: purchases_typescript_internal_1.WebPurchaseRedemptionResultType.SUCCESS,
                    customerInfo: previewCustomerInfo
                }];
        });
    }); },
};
