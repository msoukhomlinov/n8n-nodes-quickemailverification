import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionType } from 'n8n-workflow';
import Keyv from 'keyv';
import { QuickEmailVerificationApi } from './QuickEmailVerificationApi.js';
import type { IEmailVerificationResponse } from './QuickEmailVerificationApi.js';

export class QuickEmailVerification implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'QuickEmailVerification',
		name: 'quickEmailVerification',
		icon: 'file:quickemailverification.svg',
		group: ['transform'],
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
						description: 'Verify an email address',
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
		],
	};

	static cache: Keyv = new Keyv({
		ttl: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
	});

	constructor() {
		QuickEmailVerification.cache.on('error', (err: Error) => console.error('Cache Error:', err));
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		// Get credentials
		const credentials = await this.getCredentials('quickEmailVerificationApi');
		const apiKey = credentials.apiKey as string;
		const enableCache = credentials.enableCache as boolean;
		const cacheTTL = (credentials.cacheTTL as number) * 24 * 60 * 60 * 1000;

		if (enableCache && cacheTTL !== QuickEmailVerification.cache.opts.ttl) {
			QuickEmailVerification.cache = new Keyv({
				ttl: cacheTTL,
			});
			QuickEmailVerification.cache.on('error', (err: Error) => console.error('Cache Error:', err));
		}

		const apiHandler = new QuickEmailVerificationApi(apiKey);

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'verifyEmail') {
					const email = this.getNodeParameter('email', i) as string;
					let verificationResult: IEmailVerificationResponse | undefined;

					if (enableCache) {
						const cachedResult = await QuickEmailVerification.cache.get(email);
						if (cachedResult) {
							verificationResult = cachedResult as IEmailVerificationResponse;
						}
					}

					if (!verificationResult) {
						verificationResult = await apiHandler.verifyEmail(email);
						if (enableCache && verificationResult.success) {
							await QuickEmailVerification.cache.set(email, verificationResult);
						}
					}

					returnData.push({
						json: verificationResult as unknown as IDataObject,
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
