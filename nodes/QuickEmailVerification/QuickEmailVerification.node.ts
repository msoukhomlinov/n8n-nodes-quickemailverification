import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';
import Keyv from 'keyv';
import { KeyvFile } from 'keyv-file';
import { QuickEmailVerificationApi } from './QuickEmailVerificationApi.js';
import type { IEmailVerificationResponse } from './QuickEmailVerificationApi.js';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

// Define interfaces for type safety
interface IKeyvStore {
	// Minimal interface to satisfy Keyv store requirements
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown, ttl?: number): Promise<boolean>;
	delete(key: string): Promise<boolean>;
	clear?(): Promise<void>;
}

interface IKeyvOptions {
	store?: IKeyvStore;
	ttl?: number | null;  // Allow null for indefinite TTL
	namespace?: string;
	[key: string]: unknown;
}

// Domain cache entry interface
interface IDomainCacheEntry {
	// Original API response fields
	result: string;            // valid/invalid/unknown
	reason: string;            // Why the domain is valid/invalid/etc.
	disposable: boolean;       // Whether it's a disposable email domain
	accept_all: boolean;       // Always true for entries in this cache
	role: boolean;             // Whether domain typically uses role-based addresses
	free: boolean;             // Whether it's a free email provider
	domain: string;            // The domain itself
	mx_record: boolean;        // Whether the domain has MX records
	mx_domain: string;         // The domain's MX record
	safe_to_send: boolean;     // Whether it's safe to send emails to this domain
	did_you_mean: string;      // Suggested correction for the domain
	success: boolean;          // Whether verification was successful
	message: string | null;    // Any message from the API
	remainingCredits?: number; // Remaining API credits at time of caching

	// Metadata
	verifiedAt: string;        // ISO timestamp when this domain was verified
}

export class QuickEmailVerification implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'QuickEmailVerification',
		name: 'quickEmailVerification',
		icon: 'file:quickemailverification.svg',
		group: ['transform'],
		usableAsTool: true,
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Verify email addresses using QuickEmailVerification API',
		defaults: {
			name: 'QuickEmailVerification',
		},
		inputs: [{ type: NodeConnectionType.Main }],
		outputs: [{ type: NodeConnectionType.Main }],
		credentials: [
			{
				name: 'quickEmailVerificationApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Verify Email',
						value: 'verifyEmail',
						description: 'Returns:\n\n' +
							'- result: valid/invalid/unknown\n' +
							'- reason: accepted_email, invalid_email, invalid_domain, rejected_email, etc.\n' +
							'- disposable: true if disposable email domain\n' +
							'- accept_all: true if domain accepts all emails\n' +
							'- role: true if role-based (admin@, info@)\n' +
							'- safe_to_send: true if safe for deliverability\n' +
							'- email: normalized address\n' +
							'- source: where the result came from ("api", "addressCache", or "domainCache")\n' +
							'- verifiedAt: verification timestamp\n' +
							'- remainingCredits: available API credits\n' +
							'- retryInfo: details about greylisting retries (if performed)',
						action: 'Verify an email address',
					},
				],
				default: 'verifyEmail',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						operation: ['verifyEmail'],
					},
				},
				placeholder: 'name@email.com',
				description: 'Email address to verify',
			},
			{
				displayName: 'Enable Greylisting Retries',
				name: 'enableGreylistRetries',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						operation: ['verifyEmail'],
					},
				},
				description: 'Whether to retry verification for greylisted emails (reason=temporarily_blocked)',
			},
			{
				displayName: 'Retry Delay',
				name: 'retryDelay',
				type: 'number',
				default: 90,
				displayOptions: {
					show: {
						operation: ['verifyEmail'],
						enableGreylistRetries: [true],
					},
				},
				description: 'Delay in seconds before retrying greylisted email verification',
			},
			{
				displayName: 'Maximum Retries',
				name: 'maxRetries',
				type: 'number',
				default: 1,
				displayOptions: {
					show: {
						operation: ['verifyEmail'],
						enableGreylistRetries: [true],
					},
				},
				description: 'Maximum number of retries for greylisted emails',
			},
		],
	};

	static getCacheDirPath(): string {
		// Create a directory for cache files in the user's home directory
		const cacheDirPath = path.join(os.homedir(), '.n8n', 'quickemailverification-address-cache');
		// Ensure directory exists
		if (!fs.existsSync(cacheDirPath)) {
			fs.mkdirSync(cacheDirPath, { recursive: true });
		}
		return cacheDirPath;
	}

	static getCacheFilePath(): string {
		return path.join(QuickEmailVerification.getCacheDirPath(), 'address-cache.json');
	}

	// Create a store instance for Keyv
	static createAddressStore(): IKeyvStore {
		// Using our interface for the store
		return new KeyvFile({
			filename: QuickEmailVerification.getCacheFilePath()
		}) as unknown as IKeyvStore;
	}

	// Lazy cache initialization - only created when needed
	static addressCache: Keyv | null = null;
	// Tracks the in-flight version-check/clear for addressCache so concurrent callers await the same init instead of racing it
	static addressCacheInitPromise: Promise<void> | null = null;

	// Check if cache file exists
	static doesAddressCacheFileExist(): boolean {
		return fs.existsSync(QuickEmailVerification.getCacheFilePath());
	}

	// Clean up the cache file if it exists
	static cleanupAddressCacheFile(): void {
		const cacheFilePath = QuickEmailVerification.getCacheFilePath();
		if (fs.existsSync(cacheFilePath)) {
			try {
				fs.unlinkSync(cacheFilePath);
				console.log('Per-address cache file cleaned up successfully');
			} catch (error) {
				console.error('Error cleaning up per-address cache file:', error);
			}
		}
	}

	// Helper to get node version from package.json
	static getNodeVersion(): string {
		// __dirname at runtime is dist/nodes/QuickEmailVerification; package.json lives 3 levels up, at the package root
		const pkgPath = path.join(__dirname, '../../../package.json');
		const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
		return pkg.version;
	}

	// Helper to initialise cache and check version
	static async initialiseCacheWithVersion(cache: Keyv) {
		const currentVersion = QuickEmailVerification.getNodeVersion();
		const versionKey = '__cache_version__';
		// The email/domain being verified is free text with no format validation, so a value like
		// "x@__cache_version__" would make the domain cache key collide with this marker if it lived
		// in the same namespace. A distinct namespace on the same underlying store rules that out entirely,
		// since Keyv prefixes keys with the namespace before the store ever sees them.
		const metaOptions: IKeyvOptions = {
			store: cache.store as unknown as IKeyvStore,
			namespace: 'qev-cache-meta',
		};
		const metaCache = new Keyv(metaOptions as Record<string, unknown>);
		const cachedVersion = await metaCache.get(versionKey);
		if (cachedVersion !== currentVersion) {
			await cache.clear();
			// ttl 0 overrides the cache's configured TTL so the version marker never expires on its own
			await metaCache.set(versionKey, currentVersion, 0);
			console.log(`[QuickEmailVerification] Cache cleared due to version change (${cachedVersion} -> ${currentVersion})`);
		}
	}

	// Get or create the address cache instance
	static async getAddressCache(ttl: number): Promise<Keyv> {
		// New cache instance needed if none exists yet, or the configured TTL changed
		if (!QuickEmailVerification.addressCache || ttl !== QuickEmailVerification.addressCache.opts.ttl) {
			const store = QuickEmailVerification.createAddressStore();
			const options: IKeyvOptions = {
				store,
				ttl
			};
			const newCache = new Keyv(options as Record<string, unknown>);
			newCache.on('error', (err: Error) => console.error('Per-address cache error:', err));
			QuickEmailVerification.addressCache = newCache;
			// Stored so concurrent callers can await this same in-flight init instead of racing it (see #2 review feedback)
			QuickEmailVerification.addressCacheInitPromise =
				QuickEmailVerification.initialiseCacheWithVersion(newCache).catch(console.error);
		}
		// Read into locals before awaiting so a later call (different TTL) reassigning the statics mid-await can't affect this caller
		const cache = QuickEmailVerification.addressCache;
		const initPromise = QuickEmailVerification.addressCacheInitPromise;
		await initPromise;
		return cache;
	}

	// Extract domain from email
	static getDomainFromEmail(email: string): string {
		const atIndex = email.lastIndexOf('@');
		return atIndex > 0 ? email.slice(atIndex + 1) : '';
	}

	// Domain cache directory
	static getDomainCacheDirPath(): string {
		// Create a directory for domain cache files in the user's home directory
		const cacheDirPath = path.join(os.homedir(), '.n8n', 'quickemailverification-domain-cache');
		// Ensure directory exists
		if (!fs.existsSync(cacheDirPath)) {
			fs.mkdirSync(cacheDirPath, { recursive: true });
		}
		return cacheDirPath;
	}

	// Domain cache file path
	static getDomainCacheFilePath(): string {
		return path.join(QuickEmailVerification.getDomainCacheDirPath(), 'domain-accept-all-cache.json');
	}

	// Create a store instance for domain Keyv
	static createDomainStore(): IKeyvStore {
		return new KeyvFile({
			filename: QuickEmailVerification.getDomainCacheFilePath()
		}) as unknown as IKeyvStore;
	}

	// Lazy domain cache initialization - only created when needed
	static domainAcceptAllCache: Keyv | null = null;
	// Tracks the in-flight version-check/clear for domainAcceptAllCache so concurrent callers await the same init instead of racing it
	static domainAcceptAllCacheInitPromise: Promise<void> | null = null;

	// Check if domain cache file exists
	static doesDomainCacheFileExist(): boolean {
		return fs.existsSync(QuickEmailVerification.getDomainCacheFilePath());
	}

	// Clean up the domain cache file if it exists
	static cleanupDomainCacheFile(): void {
		const cacheFilePath = QuickEmailVerification.getDomainCacheFilePath();
		if (fs.existsSync(cacheFilePath)) {
			try {
				fs.unlinkSync(cacheFilePath);
				console.log('Domain accept-all cache file cleaned up successfully');
			} catch (error) {
				console.error('Error cleaning up domain accept-all cache file:', error);
			}
		}
	}

	// Get or create the domain accept-all cache instance
	static async getDomainAcceptAllCache(ttl: number): Promise<Keyv> {
		// New cache instance needed if none exists yet, or the configured TTL changed
		if (!QuickEmailVerification.domainAcceptAllCache || ttl !== QuickEmailVerification.domainAcceptAllCache.opts.ttl) {
			const store = QuickEmailVerification.createDomainStore();
			const options: IKeyvOptions = {
				store,
				ttl
			};
			const newCache = new Keyv(options as Record<string, unknown>);
			newCache.on('error', (err: Error) => console.error('Domain accept-all cache error:', err));
			QuickEmailVerification.domainAcceptAllCache = newCache;
			// Stored so concurrent callers can await this same in-flight init instead of racing it (see #2 review feedback)
			QuickEmailVerification.domainAcceptAllCacheInitPromise =
				QuickEmailVerification.initialiseCacheWithVersion(newCache).catch(console.error);
		}
		// Read into locals before awaiting so a later call (different TTL) reassigning the statics mid-await can't affect this caller
		const cache = QuickEmailVerification.domainAcceptAllCache;
		const initPromise = QuickEmailVerification.domainAcceptAllCacheInitPromise;
		await initPromise;
		return cache;
	}

	// Helper method for delayed execution
	static async retryWithDelay<T>(fn: () => Promise<T>, delayMs: number): Promise<T> {
		return new Promise((resolve) => {
			setTimeout(async () => {
				resolve(await fn());
			}, delayMs);
		});
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		// Get credentials
		const credentials = await this.getCredentials('quickEmailVerificationApi');
		const apiKey = credentials.apiKey as string;
		const enablePerAddressCache = credentials.enableCache as boolean;
		const perAddressCacheTTL = (credentials.cacheTTL as number) * 24 * 60 * 60 * 1000;
		const enableDomainCache = credentials.enableDomainCache as boolean;
		const domainCacheTTL = (credentials.domainCacheTTL as number) * 24 * 60 * 60 * 1000;

		// Handle per-address cache based on the enableCache setting.
		// The returned instance is used for every read/write below instead of the static field, since a
		// concurrent execution with a different TTL can reassign the static field to a different instance
		// (possibly still mid version-check) while this execution is running.
		let addressCache: Keyv | null = null;
		if (enablePerAddressCache) {
			// Initialize or update per-address cache with the correct TTL
			addressCache = await QuickEmailVerification.getAddressCache(perAddressCacheTTL);
		} else if (QuickEmailVerification.doesAddressCacheFileExist()) {
			// If per-address cache is disabled but a cache file exists, clean it up
			QuickEmailVerification.cleanupAddressCacheFile();
			QuickEmailVerification.addressCache = null;
		}

		// Handle domain cache based on the enableDomainCache setting (same reasoning as above)
		let domainCache: Keyv | null = null;
		if (enableDomainCache) {
			// Initialize or update domain cache with the correct TTL
			domainCache = await QuickEmailVerification.getDomainAcceptAllCache(domainCacheTTL);
		} else if (QuickEmailVerification.doesDomainCacheFileExist()) {
			// If domain cache is disabled but a cache file exists, clean it up
			QuickEmailVerification.cleanupDomainCacheFile();
			QuickEmailVerification.domainAcceptAllCache = null;
		}

		const apiHandler = new QuickEmailVerificationApi(apiKey);

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'verifyEmail') {
					const email = this.getNodeParameter('email', i) as string;
					// Get retry settings if enabled
					const enableGreylistRetries = this.getNodeParameter('enableGreylistRetries', i, false) as boolean;
					let retryDelay = 90; // Default 90 seconds
					let maxRetries = 1; // Default 1 retry
					const retryInfo = { retried: false, retryCount: 0, retrySuccessful: false };

					if (enableGreylistRetries) {
						retryDelay = this.getNodeParameter('retryDelay', i, 90) as number;
						maxRetries = this.getNodeParameter('maxRetries', i, 1) as number;
					}

					let verificationResult: IEmailVerificationResponse | undefined;
					let addressCachedResult: IEmailVerificationResponse | undefined;
					let domainCachedResult: IDomainCacheEntry | undefined;

					// Only check per-address cache if enabled and initialized
					if (enablePerAddressCache && addressCache) {
						const addressCached = await addressCache.get(email);
						if (addressCached) {
							verificationResult = addressCached as IEmailVerificationResponse;
							addressCachedResult = verificationResult;
						}
					}

					// If not found in address cache, check domain cache
					if (!verificationResult && enableDomainCache && domainCache) {
						const domain = QuickEmailVerification.getDomainFromEmail(email);
						if (domain) {
							const domainCached = await domainCache.get(domain);
							if (domainCached) {
								domainCachedResult = domainCached as IDomainCacheEntry;

								// Reconstruct full result from domain cache
								// For domains with accept_all=true, we know they'll accept any email
								// But we still need to provide all expected fields
								const userName = email.substring(0, email.lastIndexOf('@'));
								verificationResult = {
									...domainCachedResult,
									email: email,
									user: userName,
									// Role should be false when using domain cache
									role: false,
									// Set any other fields required by IEmailVerificationResponse
									verifiedAt: domainCachedResult.verifiedAt
								} as IEmailVerificationResponse;
							}
						}
					}

					// If not found in either cache, make API call
					if (!verificationResult) {
						verificationResult = await apiHandler.verifyEmail(email);

						// Handle greylisted email retry if enabled
						if (enableGreylistRetries &&
							verificationResult.reason === 'temporarily_blocked' &&
							maxRetries > 0) {

							let retryCount = 0;
							const delayMs = retryDelay * 1000; // Convert seconds to milliseconds

							while (retryCount < maxRetries) {
								// Wait for the specified delay
								const retryResult = await QuickEmailVerification.retryWithDelay<IEmailVerificationResponse>(
									() => apiHandler.verifyEmail(email),
									delayMs
								);

								// Update retry info
								retryCount++;
								retryInfo.retried = true;
								retryInfo.retryCount = retryCount;

								// If no longer greylisted, break out of retry loop
								if (retryResult.reason !== 'temporarily_blocked') {
									verificationResult = retryResult;
									retryInfo.retrySuccessful = true;
									break;
								}

								// Update verification result for next iteration
								verificationResult = retryResult;
							}
						}

						// Store in per-address cache if enabled and successful
						if (enablePerAddressCache && addressCache && verificationResult.success) {
							const resultWithTimestamp = {
								...verificationResult,
								verifiedAt: new Date().toISOString(),
							};
							await addressCache.set(email, resultWithTimestamp);
							verificationResult = resultWithTimestamp;
						}

						// Normalise accept_all to boolean
						const isAcceptAll = String(verificationResult.accept_all) === 'true';

						// Store domain in domain cache if enabled, successful, and accept_all is true
						if (enableDomainCache &&
							domainCache &&
							verificationResult.success &&
							isAcceptAll) {

							const domain = QuickEmailVerification.getDomainFromEmail(email);
							if (domain) {
								const domainEntry: IDomainCacheEntry = {
									result: verificationResult.result,
									reason: verificationResult.reason,
									disposable: verificationResult.disposable,
									accept_all: true, // Always store as boolean true
									role: verificationResult.role,
									free: verificationResult.free,
									domain: verificationResult.domain,
									mx_record: verificationResult.mx_record,
									mx_domain: verificationResult.mx_domain,
									safe_to_send: verificationResult.safe_to_send,
									did_you_mean: verificationResult.did_you_mean,
									success: verificationResult.success,
									message: verificationResult.message,
									remainingCredits: verificationResult.remainingCredits,
									verifiedAt: new Date().toISOString()
								};

								await domainCache.set(domain, domainEntry);
							}
						}
					}

					const responseWithMetadata = {
						...verificationResult,
						source: addressCachedResult ? 'addressCache' : domainCachedResult ? 'domainCache' : 'api',
						verifiedAt: verificationResult.verifiedAt || new Date().toISOString(),
						// Only include retry info if retries were performed
						...(retryInfo.retried ? { retryInfo } : {})
					};

					returnData.push({
						json: responseWithMetadata as unknown as IDataObject,
					});
				}
			} catch (error) {
				const err = error as { message: string };
				if (this.continueOnFail()) {
					returnData.push({ json: { error: err.message } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
