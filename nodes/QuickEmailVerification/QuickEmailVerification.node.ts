import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';
import { QuickEmailVerificationApi } from './QuickEmailVerificationApi.js';
import type { IEmailVerificationResponse } from './QuickEmailVerificationApi.js';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

interface ICacheFileEntry {
	value: unknown;
	expiresAt: number | null; // epoch ms; null = never expires
}

// Minimal zero-dependency, file-backed TTL cache. Replaces keyv/keyv-file: those packages
// get nested with a mismatched file layout when this node sits alongside other community
// nodes pulling in conflicting keyv versions in n8n's shared node_modules tree, breaking
// the community-node update entirely (#4). Being sync (no I/O await between a read/write
// and the in-memory map update) also means concurrent calls can't interleave mid-operation,
// which removed the need for the init-promise/race-tracking machinery keyv required.
class FileCache {
	private entries = new Map<string, ICacheFileEntry>();
	// Stored as its own JSON field rather than a map key, so it can never collide with a
	// user-supplied email/domain used as a cache key (those have no format validation).
	private version: string | null = null;
	private loaded = false;

	constructor(private readonly filePath: string) {}

	private load(): void {
		if (this.loaded) return;
		this.loaded = true;
		if (!fs.existsSync(this.filePath)) return;
		try {
			const raw = fs.readFileSync(this.filePath, 'utf8');
			const parsed = JSON.parse(raw) as { version?: string; entries?: Record<string, ICacheFileEntry> };
			this.version = parsed.version ?? null;
			for (const [key, entry] of Object.entries(parsed.entries ?? {})) {
				this.entries.set(key, entry);
			}
		} catch (error) {
			console.error('Failed to load cache file:', error);
		}
	}

	private persist(): void {
		// Prune expired entries before every write, otherwise every set() rewrites a
		// file that only ever grows (each call already scans and pays for expired
		// entries anyway; skipping the cleanup here would just defer that cost).
		const now = Date.now();
		for (const [key, entry] of this.entries) {
			if (entry.expiresAt !== null && entry.expiresAt <= now) this.entries.delete(key);
		}
		// Object.fromEntries (rather than assigning entries[key] directly) can't be
		// tripped up by a user-supplied key like "__proto__".
		const entries = Object.fromEntries(this.entries);
		try {
			fs.writeFileSync(this.filePath, JSON.stringify({ version: this.version, entries }), 'utf8');
		} catch (error) {
			console.error('Failed to write cache file:', error);
		}
	}

	// Wipes all entries if the node version has changed since they were written.
	ensureVersion(currentVersion: string): void {
		this.load();
		if (this.version !== currentVersion) {
			console.log(`[QuickEmailVerification] Cache cleared due to version change (${this.version} -> ${currentVersion})`);
			this.entries.clear();
			this.version = currentVersion;
			this.persist();
		}
	}

	get<T>(key: string): T | undefined {
		this.load();
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
			this.entries.delete(key);
			this.persist();
			return undefined;
		}
		return entry.value as T;
	}

	set(key: string, value: unknown, ttl: number): void {
		this.load();
		this.entries.set(key, { value, expiresAt: ttl > 0 ? Date.now() + ttl : null });
		this.persist();
	}
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

	// Lazy cache initialization - only created when needed
	static addressCache: FileCache | null = null;

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

	// Get or create the address cache instance
	static getAddressCache(): FileCache {
		if (!QuickEmailVerification.addressCache) {
			const cache = new FileCache(QuickEmailVerification.getCacheFilePath());
			try {
				cache.ensureVersion(QuickEmailVerification.getNodeVersion());
			} catch (error) {
				console.error('Failed to check per-address cache version:', error);
			}
			QuickEmailVerification.addressCache = cache;
		}
		return QuickEmailVerification.addressCache;
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

	// Lazy domain cache initialization - only created when needed
	static domainAcceptAllCache: FileCache | null = null;

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
	static getDomainAcceptAllCache(): FileCache {
		if (!QuickEmailVerification.domainAcceptAllCache) {
			const cache = new FileCache(QuickEmailVerification.getDomainCacheFilePath());
			try {
				cache.ensureVersion(QuickEmailVerification.getNodeVersion());
			} catch (error) {
				console.error('Failed to check domain cache version:', error);
			}
			QuickEmailVerification.domainAcceptAllCache = cache;
		}
		return QuickEmailVerification.domainAcceptAllCache;
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
		let addressCache: FileCache | null = null;
		if (enablePerAddressCache) {
			addressCache = QuickEmailVerification.getAddressCache();
		} else if (QuickEmailVerification.doesAddressCacheFileExist()) {
			// If per-address cache is disabled but a cache file exists, clean it up
			QuickEmailVerification.cleanupAddressCacheFile();
			QuickEmailVerification.addressCache = null;
		}

		// Handle domain cache based on the enableDomainCache setting (same reasoning as above)
		let domainCache: FileCache | null = null;
		if (enableDomainCache) {
			domainCache = QuickEmailVerification.getDomainAcceptAllCache();
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
						const addressCached = addressCache.get<IEmailVerificationResponse>(email);
						if (addressCached) {
							verificationResult = addressCached as IEmailVerificationResponse;
							addressCachedResult = verificationResult;
						}
					}

					// If not found in address cache, check domain cache
					if (!verificationResult && enableDomainCache && domainCache) {
						const domain = QuickEmailVerification.getDomainFromEmail(email);
						if (domain) {
							const domainCached = domainCache.get<IDomainCacheEntry>(domain);
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
							addressCache.set(email, resultWithTimestamp, perAddressCacheTTL);
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

								domainCache.set(domain, domainEntry, domainCacheTTL);
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
