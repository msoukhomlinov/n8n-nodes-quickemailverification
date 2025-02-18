import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class QuickEmailVerificationApi implements ICredentialType {
	name = 'quickEmailVerificationApi';
	displayName = 'QuickEmailVerification API';
	documentationUrl = 'https://docs.quickemailverification.com/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'API key from QuickEmailVerification',
		},
		{
			displayName: 'Enable Caching',
			name: 'enableCache',
			type: 'boolean',
			default: true,
			description: 'Whether to cache API responses',
		},
		{
			displayName: 'Cache TTL (days)',
			name: 'cacheTTL',
			type: 'number',
			default: 30,
			description: 'Number of days to keep cached results',
			displayOptions: {
				show: {
					enableCache: [true],
				},
			},
		},
	];
}
